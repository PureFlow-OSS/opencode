import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { batch, createContext, getOwner, onCleanup, onMount, type ParentProps, untrack, useContext } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { bootstrapDirectory, bootstrapGlobal, clearProviderRev } from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent } from "./global-sync/event-reducer"
import { createRefreshQueue } from "./global-sync/queue"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import type { ProjectMeta } from "./global-sync/types"
import { directoryKey } from "./global-sync/utils"
import { debugServerError, formatUserFacingServerError } from "@/utils/server-errors"
import { queryOptions, skipToken, useQueryClient } from "@tanstack/solid-query"
import { Persist, persisted } from "@/utils/persist"
import { makeEventListener } from "@solid-primitives/event-listener"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export const loadSessionsQuery = (directory: string) =>
  queryOptions<null>({ queryKey: [directory, "loadSessions"], queryFn: skipToken })

export const loadMcpQuery = (directory: string, sdk?: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "mcp"],
    queryFn: sdk ? () => sdk.mcp.status().then((r) => r.data ?? {}) : skipToken,
  })

export const loadLspQuery = (directory: string, sdk?: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "lsp"],
    queryFn: sdk ? () => sdk.lsp.status().then((r) => r.data ?? []) : skipToken,
  })

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const [providerCache, setProviderCache] = persisted(
    Persist.global("provider-cache", ["provider-cache.v1"]),
    createStore<ProviderListResponse>({ all: [], connected: [], default: {} }),
  )

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    ready: false,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: [],
    session_todo: {},
    provider: providerCache,
    provider_auth: {},
    config: {},
    reload: undefined,
  })
  const queryClient = useQueryClient()

  let bootedAt = 0
  let bootingRoot = false
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore(
      "project",
      reconcile(typeof next === "function" ? next(globalStore.project) : next, {
        key: "worktree",
      }),
    )
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    bootstrap,
    bootstrapInstance,
    key: directoryKey,
  })

  const sdkFor = (directory: string) => {
    const cached = sdkCache.get(directory)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(directory, sdk)
    return sdk
  }

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      queue.clear(directory)
      sdkCache.delete(directory)
      clearProviderRev(directory)
      clearSessionPrefetchDirectory(directory)
    },
    translate: language.t,
  })

  async function loadSessions(directory: string) {
    const key = directoryKey(directory)
    const pending = sessionLoads.get(key)
    if (pending) return pending

    children.pin(directory)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const promise = queryClient
      .fetchQuery({
        ...loadSessionsQuery(directory),
        queryFn: () =>
          loadRootSessionsWithFallback({
            directory,
            limit: store.limit,
            list: (query) => globalSDK.client.session.list(query),
          })
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              if (nonArchived.length === 0 && store.session.some((session) => !session.parentID)) {
                console.warn("Ignoring an empty session list while sessions are already loaded", { directory })
                return
              }
              // A server can briefly return an incomplete root list while it is
              // reconnecting after sleep. Treat that response as a refresh, not
              // as proof that locally known sessions were deleted: deleting the
              // entry also drops its message cache and makes the active composer
              // unable to resolve its own session.
              const localSessions = store.session.filter((session) => !session.time?.archived)
              const sessions = [
                ...new Map([...localSessions, ...nonArchived].map((session) => [session.id, session])).values(),
              ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              batch(() => {
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(sessions, { key: "id" }))
              })
            })
            .catch((err) => {
              console.error("Failed to load sessions", {
                directory,
                queryLimit: store.limit,
                error: debugServerError(err),
              })
              const project = getFilename(directory)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatUserFacingServerError(err, language.t),
              })
            })
            .then(() => null),
      })
      .then(() => {})

    sessionLoads.set(key, promise)
    void promise.finally(() => {
      sessionLoads.delete(key)
      children.unpin(directory)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    if (!directory) return
    const key = directoryKey(directory)
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(directory)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        setGlobalProvider: setProviderCache,
        queryClient,
      })
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(directory)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (event.type === "session.error") {
      const error = event.properties.error
      if (error?.name !== "MessageAbortedError") {
        console.error("[global-sync] session error", {
          scope: directory === "global" ? "global" : "workspace",
          directory: directory === "global" ? undefined : directory,
          project: directory === "global" ? undefined : getFilename(directory),
          sessionID: event.properties.sessionID,
          error,
        })
      }
    }

    if (directory === "global") {
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          queue.refresh()
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        for (const directory of Object.keys(children.children)) {
          queue.push(directory)
        }
      }
      return
    }

    const key = directoryKey(directory)
    const existing = children.children[key]
    if (!existing) return
    children.mark(directory)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(key),
      loadLsp: () => {
        void sdkFor(directory)
          .lsp.status()
          .then((x) => {
            setStore("lsp", x.data ?? [])
            setStore("lsp_ready", true)
          })
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  async function bootstrap() {
    bootingRoot = true
    try {
      await bootstrapGlobal({
        globalSDK: globalSDK.client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        setProviderCache,
        queryClient,
      })
      bootedAt = Date.now()
    } finally {
      bootingRoot = false
    }
  }

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void globalSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void globalSDK.event.start()
      }, 0)
    }
    void bootstrap()
    const refreshAfterResume = () => {
      for (const directory of Object.keys(children.children)) {
        void bootstrapInstance(directory)
      }
    }
    makeEventListener(document, "visibilitychange", () => {
      if (document.visibilityState !== "visible") return
      refreshAfterResume()
    })
  })

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfig = async (config: Config) => {
    setGlobalStore("reload", "pending")
    return globalSDK.client.global.config
      .update({ config })
      .then(bootstrap)
      .then(() => {
        queue.refresh()
        setGlobalStore("reload", undefined)
        queue.refresh()
      })
      .catch((error) => {
        setGlobalStore("reload", undefined)
        throw error
      })
  }

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    bootstrap,
    updateConfig,
    project: projectApi,
    todo: {
      set: setSessionTodo,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}
