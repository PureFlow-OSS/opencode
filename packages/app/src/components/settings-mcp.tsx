import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tag } from "@opencode-ai/ui/tag"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { hideMcpName, showMcpName } from "./mcp-ui-state"
import { DialogMcpForm } from "./dialog-mcp-form"
import { SettingsList } from "./settings-list"
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2/client"

type McpConfig = McpLocalConfig | McpRemoteConfig
type ManagedAuth = {
  type: "pat"
  label?: string
  description?: string
  placeholder?: string
  header?: string
  prefix?: string
}

type ManagedServer = {
  config: McpConfig
  auth?: ManagedAuth
}

type ServerItem =
  | { name: string; source: "local"; config: McpConfig; status?: string }
  | { name: string; source: "managed"; managed: ManagedServer; local?: McpConfig; status?: string }

function DialogManagedMcpPat(props: {
  name: string
  managed: ManagedServer
  current?: string
  onSave: (token: string) => Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [store, setStore] = createStore({
    token: props.current ?? "",
    saving: false,
  })

  const save = async (e: SubmitEvent) => {
    e.preventDefault()
    const token = store.token.trim()
    if (!token || store.saving) return
    setStore("saving", true)
    await props
      .onSave(token)
      .then(() => dialog.close())
      .finally(() => setStore("saving", false))
  }

  return (
    <Dialog title={props.managed.auth?.label ?? "PAT"} transition>
      <form onSubmit={save} class="flex flex-col gap-4 px-2.5 pb-3">
        <div class="text-14-regular text-text-weak">
          {props.managed.auth?.description ?? "Enter your personal access token."}
        </div>
        <TextField
          autofocus
          type="password"
          label={props.managed.auth?.label ?? "PAT"}
          placeholder={props.managed.auth?.placeholder ?? "Personal access token"}
          value={store.token}
          onChange={(value) => setStore("token", value)}
        />
        <div class="flex gap-3">
          <Button type="submit" size="large" variant="primary" disabled={!store.token.trim() || store.saving}>
            {store.saving ? language.t("common.saving") : language.t("common.save")}
          </Button>
          <Button type="button" size="large" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export const SettingsMcp: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const params = useParams()
  const dir = createMemo(() => decode64(params.dir) ?? globalSync().data.path.directory ?? "")
  const [managedData] = createResource<Record<string, ManagedServer>>(() =>
    globalSDK().request("/mcp/managed").then((res) =>
      res.ok ? (res.json() as Promise<Record<string, ManagedServer>>) : {},
    ),
  )
  const [mcpStatus, { mutate: setMcpStatus }] = createResource<Record<string, { status: string }>>(() =>
    globalSDK().client.mcp.status().then((res) => res.data ?? {}),
  )
  const managed = createMemo(() => managedData.latest ?? {})
  const prompted = new Set<string>()
  const [deleting, setDeleting] = createStore<Record<string, boolean>>({})

  const servers = createMemo<ServerItem[]>(() => {
    const items: ServerItem[] = []
    const names = Array.from(
      new Set([
        ...Object.keys(globalSync().data.config.mcp ?? {}),
        ...Object.keys(managed()),
      ]),
    )
    for (const name of names) {
      if (deleting[name]) continue
      const local = globalSync().data.config.mcp?.[name]
      const managedServer = managed()[name]
      if (managedServer) {
        items.push({
          name,
          source: "managed",
          managed: managedServer,
          local: local && "type" in local ? (local as McpConfig) : undefined,
          status: mcpStatus.latest?.[name]?.status,
        })
        continue
      }
      if (!local || !("type" in local) || (local.type !== "local" && local.type !== "remote")) continue
      items.push({
        name,
        source: "local",
        config: local as McpConfig,
        status: mcpStatus.latest?.[name]?.status,
      })
    }
    items.sort((a, b) => a.name.localeCompare(b.name))
    return items
  })

  const subtitle = (server: ServerItem) =>
    server.source === "managed"
      ? server.managed.config.type === "local"
        ? server.managed.config.command.join(" ")
        : server.managed.config.url
      : server.config.type === "local"
        ? server.config.command.join(" ")
        : server.config.url

  const patValue = (server: Extract<ServerItem, { source: "managed" }>) => {
    if (server.local?.type !== "remote") return ""
    const header = server.managed.auth?.header ?? "Authorization"
    const prefix = server.managed.auth?.prefix ?? ""
    const value = server.local.headers?.[header] ?? ""
    return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value
  }
  const asManaged = (server: ServerItem) => server as Extract<ServerItem, { source: "managed" }>

  const saveManagedPat = async (server: Extract<ServerItem, { source: "managed" }>, token: string) => {
    if (server.managed.config.type !== "remote") return
    showMcpName(server.name)
    const header = server.managed.auth?.header ?? "Authorization"
    const prefix = server.managed.auth?.prefix ?? ""
    const existing = { ...(globalSync().data.config.mcp ?? {}) }
    existing[server.name] = {
      ...server.managed.config,
      headers: {
        ...(server.managed.config.headers ?? {}),
        ...(server.local?.type === "remote" ? server.local.headers ?? {} : {}),
        [header]: `${prefix}${token}`,
      },
      oauth: server.managed.config.oauth,
    }
    await globalSync().updateConfig({ mcp: existing })
    await globalSDK().client.mcp.connect({ name: server.name }).catch(() => undefined)
    const next = await globalSDK().client.mcp.status().then((res) => res.data ?? {})
    setMcpStatus(next)
    if (dir()) {
      const [, setStore] = globalSync().child(dir(), { bootstrap: false })
      setStore("mcp", next)
      setStore("mcp_ready", true)
    }
    showToast({
      variant: "success",
      icon: "circle-check",
      title: `${server.name} connected`,
      description: "Managed MCP token saved.",
    })
  }

  createEffect(() => {
    const item = servers().find((server) => {
      if (server.source !== "managed") return false
      if (server.managed.auth?.type !== "pat") return false
      if (server.local?.type === "remote") {
        const header = server.managed.auth.header ?? "Authorization"
        if (server.local.headers?.[header]) return false
      }
      return !prompted.has(server.name)
    })
    if (!item || item.source !== "managed") return
    prompted.add(item.name)
    dialog.show(() => (
      <DialogManagedMcpPat
        name={item.name}
        managed={item.managed}
        current={patValue(item)}
        onSave={(token) => saveManagedPat(item, token)}
      />
    ))
  })

  const deleteServer = async (name: string) => {
    if (deleting[name]) return
    const existing = { ...(globalSync().data.config.mcp ?? {}) }
    delete existing[name]
    setDeleting(name, true)
    hideMcpName(name)
    if (dir()) {
      const [, setStore] = globalSync().child(dir(), { bootstrap: false })
      setStore("mcp", (current) => {
        if (!(name in current)) return current
        const next = { ...current }
        delete next[name]
        return next
      })
      setStore("mcp_ready", true)
    }
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.mcp.toast.deleted.title"),
      description: language.t("settings.mcp.toast.deleted.description", { name }),
    })
    await globalSync()
      .updateConfig({ mcp: existing })
      .then(async () => {
        const next = await globalSDK().client.mcp.status().then((res) => res.data ?? {})
        setMcpStatus(next)
        if (dir()) {
          const [, setStore] = globalSync().child(dir(), { bootstrap: false })
          setStore("mcp", next)
          setStore("mcp_ready", true)
        }
      })
      .catch((err: unknown) => {
        setDeleting(name, false)
        showMcpName(name)
        showToast({
          title: language.t("common.requestFailed"),
          description: formatServerError(err, language.t, language.t("common.requestFailed")),
        })
      })
  }

  const showMcpSettings = () => {
    void import("./dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings />)
    })
  }

  const showMcpForm = (props: { name?: string; config?: McpConfig } = {}) => {
    dialog.show(() => <DialogMcpForm {...props} />)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex items-center justify-between pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
          <Button size="large" variant="secondary" icon="plus-small" onClick={() => showMcpForm()}>
            {language.t("settings.mcp.add")}
          </Button>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <SettingsList>
          <Show
            when={servers().length > 0}
            fallback={<div class="py-4 text-14-regular text-text-weak">{language.t("settings.mcp.empty")}</div>}
          >
            <For each={servers()}>
              {(item) => (
                <div class="group flex items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                      <Tag>
                        {item.source === "managed"
                          ? "Managed"
                          : item.config.type === "local"
                            ? language.t("settings.mcp.server.type.local")
                            : language.t("settings.mcp.server.type.remote")}
                      </Tag>
                    </div>
                    <span class="text-12-regular text-text-weak truncate">{subtitle(item)}</span>
                  </div>
                  <Show
                    when={item.source === "local"}
                    fallback={
                      <div class="flex items-center gap-2">
                        <Show when={item.status}>
                          {(status) => <div class="text-12-regular text-text-weak">{status()}</div>}
                        </Show>
                        <Show when={asManaged(item).managed.auth?.type === "pat"}>
                          <Button
                            size="large"
                            variant="ghost"
                            onClick={() =>
                              dialog.show(() => (
                                <DialogManagedMcpPat
                                  name={item.name}
                                  managed={asManaged(item).managed}
                                  current={patValue(asManaged(item))}
                                  onSave={(token) => saveManagedPat(asManaged(item), token)}
                                />
                              ))
                            }
                          >
                            {asManaged(item).local ? "Update token" : "Connect"}
                          </Button>
                        </Show>
                      </div>
                    }
                  >
                    <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <Button
                        size="large"
                        variant="ghost"
                        disabled={deleting[item.name]}
                        onClick={() =>
                          showMcpForm({
                            name: item.name,
                            config: (item as Extract<ServerItem, { source: "local" }>).config,
                          })
                        }
                      >
                        {language.t("common.edit")}
                      </Button>
                      <Button size="large" variant="ghost" disabled={deleting[item.name]} onClick={() => void deleteServer(item.name)}>
                        {language.t("common.delete")}
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </SettingsList>
      </div>
    </div>
  )
}
