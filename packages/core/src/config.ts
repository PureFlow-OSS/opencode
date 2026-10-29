export * as Config from "./config.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import path from "path"
import { isDeepStrictEqual } from "node:util"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { Context, Effect, FiberMap, Layer, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect"
import { Directory, Document, Info, type Patch, type Entry, Event } from "@opencode/schema/config"
import { Credential } from "./credential.js"
import { Bus } from "./bus.js"
import { Watcher } from "./filesystem/watcher.js"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "./location.js"
import { AbsolutePath } from "./schema.js"
import { ConfigVariable } from "./config/variable.js"
import { ConfigNormalize } from "./config/normalize.js"
import { ConfigDiscovery } from "./config/discovery.js"
import { ConfigWatch } from "./config/watch.js"
import { ConfigIntegration } from "./config/integration.js"
import { ConfigManaged } from "./config/managed.js"
import { ManagedPolicy } from "./managed-policy.js"
import { Connection } from "@opencode/schema/connection"
import { WellKnown } from "./wellknown.js"
import { AppProcess } from "@opencode/util/process"
import { ChildProcess } from "effect/process"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Integration } from "@opencode/schema/integration"
import { FetchHttpClient } from "effect/http"
import { isRecord } from "@opencode/util/record"

export function latest<K extends keyof Info>(entries: readonly Entry[], key: K): Info[K] | undefined {
  return entries.findLast((entry): entry is Document => entry.type === "document" && entry.info[key] !== undefined)
    ?.info[key]
}

export type Corporate = Pick<Info, "updater" | "aifactory_host" | "use_http_proxy" | "http_proxy" | "providers">

export function corporateSettings(entries: readonly Entry[]): Corporate {
  return {
    updater: latest(entries, "updater"),
    aifactory_host: latest(entries, "aifactory_host"),
    use_http_proxy: latest(entries, "use_http_proxy"),
    http_proxy: latest(entries, "http_proxy"),
    providers: entries
      .filter((entry) => entry.type === "document")
      .reduce(
        (providers, entry) => ({
          ...providers,
          ...Object.fromEntries(
            Object.entries(entry.info.providers ?? {}).map(([id, provider]) => [
              id,
              {
                ...providers[id],
                ...provider,
                settings: { ...providers[id]?.settings, ...provider.settings },
              },
            ]),
          ),
        }),
        {} as NonNullable<Info["providers"]>,
      ),
  }
}

export interface Interface {
  /** Returns location config documents and discovery sources from lowest to highest priority. */
  readonly entries: () => Effect.Effect<Entry[]>
  /** Local documents before the managed remote snapshot is overlaid. */
  readonly localEntries?: () => Effect.Effect<Entry[]>
  /** Trusted global, explicit and system settings; repository files cannot redirect corporate credentials. */
  readonly corporate?: () => Effect.Effect<Corporate>
  /** Compatibility roots consumed by internal compatibility plugins. */
  readonly compatibility?: () => Effect.Effect<{
    readonly claude: readonly AbsolutePath[]
    readonly agents: readonly AbsolutePath[]
  }>
  /**
   * Streams raw filesystem updates under config roots. Config owns root
   * topology and watch reconciliation; domain owners filter this feed for the
   * source files they parse and rebuild their own state.
   */
  readonly changes: () => Stream.Stream<Watcher.Update>
  /** Updates supported global config fields while preserving unrelated JSONC content. */
  readonly update?: (patch: Patch) => Effect.Effect<void, FSUtil.Error>
  /**
   * Replaces, or clears with `undefined`, the document an integration connection contributes. It loads right after
   * managed policies: its settings layer below remote, user, and project config, while its policies outrank theirs.
   * Changing it reloads config like any other source.
   */
  readonly integration?: (
    integrationID: ConfigIntegration.Document["integrationID"],
    document: ConfigIntegration.Document | undefined,
  ) => Effect.Effect<void>
}

export const Options = Schema.Struct({
  project: Schema.optional(Schema.Boolean),
  // false skips the system and global config dirs, ~/.claude, and ~/.agents;
  // wellknown, file, and content entries still load.
  global: Schema.optional(Schema.Boolean),
  system: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
  // false skips ~/.claude and project .claude dirs.
  claude: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export interface TestInterface extends Interface {
  /** Replaces the entries returned by subsequent entries() calls. */
  readonly setEntries: (entries: Entry[]) => Effect.Effect<void>
  /** Emits one filesystem update to every changes() subscriber. */
  readonly emitChange: (update: Watcher.Update) => Effect.Effect<void>
}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/Config/Test") {}

/** In-memory config for tests: static entries with replaceable state and a test-driven change feed. */
export const testLayer = (
  initial: Entry[] = [],
  compatibility: { readonly claude: readonly AbsolutePath[]; readonly agents: readonly AbsolutePath[] } = {
    claude: [],
    agents: [],
  },
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const entries = yield* Ref.make(initial)
      const integrations = yield* Ref.make(new Map<string, ConfigIntegration.Document>())
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const service = Test.of({
        entries: () =>
          Effect.all([Ref.get(integrations), Ref.get(entries)]).pipe(
            Effect.map(([documents, entries]) => [...documents.values(), ...entries]),
          ),
        compatibility: () => Effect.succeed(compatibility),
        changes: () => Stream.fromPubSub(updates),
        setEntries: (next) => Ref.set(entries, next),
        emitChange: (update) => PubSub.publish(updates, update).pipe(Effect.asVoid),
        integration: (integrationID, document) =>
          Ref.update(integrations, (current) => {
            const next = new Map(current)
            next.delete(integrationID)
            return document ? next.set(integrationID, document) : next
          }),
      })
      return Context.empty().pipe(Context.add(Service, service), Context.add(Test, service))
    }),
  )

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const watcher = yield* Watcher.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const globalService = yield* Global.Service
      const wellknown = yield* WellKnown.Service
      const processes = yield* AppProcess.Service
      const integrations = new Map<string, ConfigIntegration.Document>()
      // Integrations set their documents from outside this layer, so their reloads run with its services.
      const context = yield* Effect.context<FSUtil.Service | Global.Service | Location.Service>()
      const reloadLock = Semaphore.makeUnsafe(1)
      const updateLock = Semaphore.makeUnsafe(1)
      const corporate = { current: {} as Corporate }
      const localEntries = { current: [] as Entry[] }
      const decodeOptions = { errors: "all", onExcessProperty: "ignore" } as const
      const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
      const parseInfo = Effect.fn("Config.parseInfo")(function* (text: string, source: string) {
        const errors: ParseError[] = []
        const input: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length) {
          yield* Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: "$",
            kind: "invalid",
            action: "rejected malformed JSON or JSONC document",
          })
          return
        }
        const result = ConfigNormalize.normalize(input)
        yield* Effect.forEach(result.diagnostics, (diagnostic) =>
          Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: diagnostic.path[0] === "$" ? "$" : `$.${diagnostic.path.join(".")}`,
            kind: diagnostic.kind,
            action: diagnostic.message,
          }),
        )
        if (result.type === "rejected") return
        const info = Option.getOrUndefined(decodeInfo(result.encoded))
        if (info) return info
        yield* Effect.logWarning("configuration normalization diagnostic", {
          source,
          path: "$",
          kind: "invalid",
          action: "rejected canonical configuration after final validation",
        })
      })

      const loadFile = Effect.fnUntraced(function* (filepath: string) {
        const text = yield* fs.readFileStringSafe(filepath)
        if (text === undefined) return
        const substituted = yield* ConfigVariable.substitute({ type: "path", path: filepath, text })
        const info = yield* parseInfo(substituted, filepath)
        if (!info) return
        return new Document({ type: "document", path: AbsolutePath.make(filepath), info })
      })

      const loadWellknownEntry = Effect.fnUntraced(function* (entry: WellKnown.Entry) {
        const auth = entry.manifest.auth
        const credential = (yield* credentials.list(entry.integrationID)).at(-1)
        const variables = auth && credential?.value.type === "key" ? { [auth.env]: credential.value.key } : undefined
        // A failed refresh, including a missing credential, keeps the last resolved config so remote providers
        // and allowlists do not disappear; only removing the source clears it.
        const configs = yield* (
          variables ? wellknown.resolve(entry, variables) : Effect.fail(new Error("No usable wellknown credential"))
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to load wellknown config", { source: entry.origin, error }).pipe(
              Effect.andThen(wellknown.cached(entry.origin)),
            ),
          ),
        )
        return yield* Effect.forEach(configs, (config) =>
          ConfigVariable.substitute({
            type: "virtual",
            source: entry.origin,
            dir: entry.origin,
            text: JSON.stringify(config),
            env: variables,
          }).pipe(
            Effect.flatMap((text) => parseInfo(text, entry.origin)),
            Effect.map((info) =>
              info
                ? new ConfigIntegration.WellKnownDocument({
                    type: "document",
                    info,
                    integrationID: entry.integrationID,
                  })
                : undefined,
            ),
          ),
        ).pipe(Effect.map((documents) => documents.filter((document) => document !== undefined)))
      })

      const loadWellknown = Effect.fn("Config.loadWellknown")(function* () {
        const entries = yield* wellknown
          .entries()
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to discover wellknown config", { error }).pipe(Effect.as([] as const)),
            ),
          )
        return yield* Effect.forEach(entries, (entry) =>
          loadWellknownEntry(entry).pipe(
            Effect.map((documents) => ({ integrationID: entry.integrationID, documents })),
          ),
        )
      })

      // `integration.use` decides whether an integration may supply anything. Only managed policies can withhold the
      // documents an integration delivers, so a project file can never strip the Console document carrying org policy.
      // A withheld document keeps its policies, so denying an integration never lifts the restrictions it carries.
      const supplies = Effect.fnUntraced(function* (
        lockdown: ReturnType<typeof ManagedPolicy.statements>,
        integrationID: string,
        connection?: Connection.Info,
      ) {
        const stored =
          connection?.type === "credential" ? yield* credentials.get(Credential.ID.make(connection.id)) : undefined
        const resource = ManagedPolicy.integrationResource(
          integrationID,
          stored ? ManagedPolicy.account(stored.value) : undefined,
        )
        return ManagedPolicy.decision(lockdown, "integration.use", resource) !== "deny"
      })

      const loadPreferences = Effect.fn("Config.loadPreferences")(function* (plist: AbsolutePath) {
        const result = yield* processes
          .run(ChildProcess.make("plutil", ["-convert", "json", "-o", "-", plist], { stdin: "ignore" }), {
            timeout: "10 seconds",
          })
          .pipe(Effect.flatMap(AppProcess.requireSuccess), Effect.option)
        if (Option.isNone(result)) {
          yield* Effect.logWarning("failed to convert managed preferences", { source: plist })
          return []
        }
        const text = yield* ConfigVariable.substitute({
          type: "virtual",
          source: plist,
          dir: path.dirname(plist),
          text: ConfigDiscovery.stripPreferenceMetadata(result.value.stdout.toString()),
        })
        const info = yield* parseInfo(text, plist)
        return info ? [new Document({ type: "document", path: plist, info })] : []
      })

      const loadDirectory = Effect.fnUntraced(function* (directory: AbsolutePath) {
        return [
          ...(yield* Effect.forEach(ConfigDiscovery.names, (file) => loadFile(path.join(directory, file))).pipe(
            Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
          )),
          new Directory({ type: "directory", path: directory }),
        ]
      })

      const load = Effect.fn("Config.load")(function* (sources: ConfigDiscovery.Sources) {
        const direct = yield* Effect.forEach(sources.direct, (filepath) => loadFile(filepath)).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.filter((entry): entry is Document => entry !== undefined)),
        )

        const explicit = sources.explicit
          ? yield* loadFile(sources.explicit).pipe(
              Effect.map((config) => (config ? [config] : [])),
              Effect.orDie,
            )
          : []
        const content =
          options?.content !== undefined
            ? yield* ConfigVariable.substitute({
                type: "virtual",
                source: "OPENCODE_CONFIG_CONTENT",
                dir: location.directory,
                text: options.content,
              }).pipe(
                Effect.flatMap((text) => parseInfo(text, "OPENCODE_CONFIG_CONTENT")),
                Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),
                Effect.orDie,
              )
            : []

        // Managed settings load last so they override everything, and MDM
        // preferences outrank the system directory as in V1. Policies evaluate
        // in reverse load order, so managed policies split off and load first
        // to keep final file-based authority.
        const managed = [
          ...(sources.system?.present ? yield* loadDirectory(sources.system.path).pipe(Effect.orDie) : []),
          ...(sources.preferences ? yield* loadPreferences(sources.preferences).pipe(Effect.orDie) : []),
        ]
        const managedPolicies = managed
          .flatMap((entry) =>
            entry.type === "document" && entry.info.policies
              ? [
                  new ConfigManaged.Document({
                    type: "document",
                    path: entry.path,
                    info: new Info({ policies: entry.info.policies }),
                  }),
                ]
              : [],
          )
          .toReversed()
        const managedSettings = managed.map((entry) =>
          entry.type === "document"
            ? new ConfigManaged.Document({ ...entry, info: new Info({ ...entry.info, policies: undefined }) })
            : entry,
        )
        // Integration documents load right after managed policies: every remote, user, and project layer overrides
        // their settings, and since policies evaluate earliest-loaded first, only managed policies outrank theirs.
        // Global entries sit below explicit and direct files; project directories rank above them.
        const globalSupplementary = sources.global ? yield* loadDirectory(sources.global).pipe(Effect.orDie) : []
        const projectSupplementary = yield* Effect.forEach(
          sources.project.filter((root) => root.present),
          (root) => loadDirectory(root.path),
        ).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.flat()),
        )
        const lockdown = ManagedPolicy.statements(managedPolicies)
        const integrated = yield* Effect.forEach(integrations.values(), (document) =>
          supplies(lockdown, document.integrationID, document.connection).pipe(
            Effect.map((allowed) =>
              allowed
                ? document
                : new ConfigIntegration.Document({ ...document, info: new Info({ policies: document.info.policies }) }),
            ),
          ),
        )
        const wellknownDocuments = yield* Effect.forEach(yield* loadWellknown().pipe(Effect.orDie), (entry) =>
          supplies(lockdown, entry.integrationID).pipe(
            Effect.map((allowed) =>
              allowed
                ? entry.documents
                : entry.documents.map(
                    (document) =>
                      new ConfigIntegration.WellKnownDocument({
                        ...document,
                        info: new Info({ policies: document.info.policies }),
                      }),
                  ),
            ),
          ),
        )
        const local = [
          ...managedPolicies,
          ...integrated,
          ...wellknownDocuments.flat(),
          ...globalSupplementary,
          ...explicit,
          ...direct,
          ...projectSupplementary,
          ...content,
          ...managedSettings,
        ]
        corporate.current = corporateSettings([...globalSupplementary, ...explicit, ...content, ...managedSettings])
        const providerURL = corporate.current.providers?.aifactory?.settings?.baseURL
        HttpProxy.configure({
          ...corporate.current,
          aifactory_host:
            typeof providerURL === "string" && providerURL.trim() ? providerURL : corporate.current.aifactory_host,
          use_http_proxy: corporate.current.use_http_proxy ?? true,
          http_proxy: corporate.current.http_proxy || "http://webgwooe.rbgooe.at:8080",
        })
        localEntries.current = local
        if (options?.global === false) return local
        const auth = (yield* credentials.list(Integration.ID.make("aifactory"))).at(-1)?.value
        const settings = corporate.current
        const request = ConfigManaged.providerConfigRequestInit({
          config: settings,
          auth: auth ? { aifactory: auth } : undefined,
        })
        if (!request.headers && !settings.updater && !process.env.OPENCODE_UPDATE_BASE_URL) return local
        const fetch = yield* FetchHttpClient.Fetch
        const remote = yield* Effect.promise(() =>
          ConfigManaged.readProviderConfig(fetch === globalThis.fetch ? HttpProxy.fetch : fetch, request, settings),
        )
        const remoteInfo = yield* parseInfo(
          JSON.stringify({
            ...remote,
            model: ConfigManaged.aiFactoryModel(remote.model),
            small_model: ConfigManaged.aiFactoryModel(remote.small_model),
          }),
          ConfigManaged.providerConfigUrl(settings),
        )
        return remoteInfo ? [new Document({ type: "document", info: remoteInfo }), ...local] : local
      })

      const initial = yield* ConfigDiscovery.discover(options)
      let sources = initial
      let configs = yield* load(initial)
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const reloads = yield* PubSub.sliding<void>(1)
      // Readiness rescans recover writes made before a watch attached.
      const requestReload = PubSub.publish(reloads, undefined).pipe(Effect.asVoid)
      const watched = yield* FiberMap.make<string>()
      const reconcile = Effect.fn("Config.reconcileWatches")(function* (sources: ConfigDiscovery.Sources) {
        const plan = ConfigWatch.plan(sources)
        for (const key of Array.from(watched, ([key]) => key)) {
          if (!plan.has(key)) yield* FiberMap.remove(watched, key)
        }
        for (const [key, target] of plan) {
          yield* watcher
            .subscribe(target, requestReload)
            .pipe(
              Effect.flatMap(
                Stream.runForEach((update) => PubSub.publish(updates, update).pipe(Effect.andThen(requestReload))),
              ),
              FiberMap.run(watched, key, { onlyIfMissing: true, startImmediately: true }),
            )
        }
      })

      const reload = Effect.fn("Config.reload")(
        function* () {
          const discovered = yield* ConfigDiscovery.discover(options)
          const next = yield* load(discovered)
          yield* reconcile(discovered)
          const compatibilityChanged =
            !isDeepStrictEqual(sources.claude, discovered.claude) ||
            !isDeepStrictEqual(sources.agents, discovered.agents)
          if (isDeepStrictEqual(configs, next) && !compatibilityChanged) return
          sources = discovered
          configs = next
          yield* bus.publish(Event.Updated, {})
        },
        (effect) => reloadLock.withPermit(effect),
      )

      // Subscribe eagerly so synchronous watch readiness isn't dropped.
      const pendingReloads = yield* PubSub.subscribe(reloads)
      yield* Stream.fromSubscription(pendingReloads).pipe(
        Stream.debounce("100 millis"),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filterEffect((event) =>
          event.data.integrationID === "aifactory"
            ? Effect.succeed(true)
            : wellknown.entries().pipe(
                Effect.map((entries) => entries.some((entry) => entry.integrationID === event.data.integrationID)),
                Effect.orElseSucceed(() => false),
              ),
        ),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(WellKnown.Event.Updated).pipe(
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown sources", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.sleep("10 minutes").pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (!wellknown.snapshot().length) return Effect.void
            return Effect.gen(function* () {
              const changed = yield* wellknown
                .refresh()
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to refresh wellknown manifests", { error }).pipe(Effect.as(false)),
                  ),
                )
              if (!changed) yield* reload()
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to refresh wellknown config", { cause })))
          }),
        ),
        Effect.forever,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* reloadLock.withPermit(reconcile(initial))

      const update = Effect.fn("Config.update")(
        function* (patch: Patch) {
          const directory = initial.global ?? AbsolutePath.make(globalService.config)
          const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))
          const filepath =
            (yield* Effect.filter(candidates, fs.isFile)).at(-1) ?? path.join(directory, "opencode.jsonc")
          const text = (yield* fs.readFileStringSafe(filepath)) ?? "{}\n"
          const updated = yield* Effect.try({
            try: () => {
              const errors: ParseError[] = []
              const input: unknown = parse(text, errors, { allowTrailingComma: true })
              if (errors.length || !isRecord(input)) throw new Error("Cannot update malformed global configuration")
              const mcp = isRecord(input.mcp) ? input.mcp : undefined
              const changes = [
                ...("shell" in patch ? [{ path: ["shell"], value: patch.shell ?? undefined }] : []),
                ...Object.entries(patch.mcp?.servers ?? {}).flatMap(([name, config]) => [
                  // Remove a matching V1 entry too, without treating the native "servers" container as a server.
                  ...(isRecord(mcp?.[name]) && (mcp[name].type === "local" || mcp[name].type === "remote")
                    ? [{ path: ["mcp", name], value: undefined }]
                    : []),
                  { path: ["mcp", "servers", name], value: config ?? undefined },
                ]),
              ]
              return changes.reduce(
                (current, change) =>
                  applyEdits(
                    current,
                    modify(current, change.path, change.value, {
                      formattingOptions: { tabSize: 2, insertSpaces: true },
                    }),
                  ),
                text,
              )
            },
            catch: (cause) => new FSUtil.FileSystemError({ method: "config.update", cause }),
          })
          yield* fs.writeWithDirs(filepath, updated.endsWith("\n") ? updated : `${updated}\n`)
          yield* requestReload
        },
        (effect) => updateLock.withPermit(effect),
      )

      return Service.of({
        corporate: () => Effect.succeed(corporate.current),
        localEntries: () => Effect.succeed(localEntries.current),
        entries: Effect.fnUntraced(function* () {
          return configs
        }),
        compatibility: () =>
          Effect.all({
            claude: Effect.filter(sources.claude, fs.isDir),
            agents: Effect.filter(sources.agents, fs.isDir),
          }),
        changes: () => Stream.fromPubSub(updates),
        update,
        integration: Effect.fn("Config.integration")(function* (integrationID, document) {
          if (isDeepStrictEqual(integrations.get(integrationID), document)) return
          integrations.delete(integrationID)
          if (document) integrations.set(integrationID, document)
          yield* reload().pipe(
            Effect.provide(context),
            Effect.catchCause((cause) => Effect.logError("failed to reload config", { cause })),
          )
        }),
      })
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [
      Watcher.node,
      Bus.node,
      FSUtil.node,
      Global.node,
      Location.node,
      Credential.node,
      WellKnown.node,
      AppProcess.node,
    ],
  })
}

export const node = configured()
