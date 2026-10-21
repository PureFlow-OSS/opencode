import { useMutation, useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { For, Show, type Component, createMemo, onCleanup } from "solid-js"
import type { Mcp } from "@opencode/schema/mcp"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { useMcpToggle } from "@/providers/connect/mcp"
import { showToast } from "@/shell/notifications/toast"
import { SettingsList } from "@/settings/list"
import { DialogMcpForm, DialogMcpPat, renderMcpError } from "./dialogs"
import { createMcpOperations } from "./operations"
import { patConfig, patValue, serverRows, storeConfig, subtitle } from "./model"
import "@/settings/settings.css"

const statusError = (status: Mcp.Status) =>
  status.status === "failed" || status.status === "needs_auth" ? status.error : undefined


const statusKeys = {
  connected: "mcp.status.connected",
  pending: "settings.mcp.status.pending",
  disabled: "mcp.status.disabled",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
} as const

export const SettingsMcp: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const data = useData()
  const toggle = useMcpToggle(() => undefined)

  const connected = () => serverSdk.connection.status() === "connected"
  const directory = () => data.location.default().directory
  const ref = () => (directory() ? { directory: directory() } : undefined)
  const refresh = async () => {
    await Promise.all([config.refetch(), catalog.refetch()])
    data.location.mcp.server.invalidate(ref())
    await data.location.mcp.server.sync(ref())
    data.location.mcp.resource.invalidate(ref())
    await data.location.mcp.resource.sync(ref()).catch(() => undefined)
  }

  const operations = createMcpOperations({
    configUpdate: (patch) => serverSdk.api.config.update(patch),
    mcpAdd: (input) =>
      serverSdk.api.mcp.add({ server: input.name, config: input.config, location: ref() }),
    mcpRemove: (input) => serverSdk.api.mcp.remove({ server: input.name, location: ref() }),
    refresh,
  })

  const config = useQuery(() => ({
    queryKey: [serverSdk.scope, "settings-mcp-config"],
    enabled: connected(),
    queryFn: () => serverSdk.api.config.get(),
  }))

  const catalog = useQuery(() => ({
    queryKey: [serverSdk.scope, "settings-mcp-catalog"],
    enabled: connected(),
    queryFn: () => serverSdk.api.mcp.catalog({ location: ref() }),
  }))

  const persist = useMutation(() => ({
    mutationFn: async (input: { name: string; config: Mcp.ServerConfig | null }) => {
      if (input.config) {
        await operations.save(input.name, input.config)
        return
      }
      await operations.remove(input.name)
    },
    onError: (error: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: renderMcpError(error),
      }),
  }))

  const rows = createMemo(() =>
    serverRows({
      entries: config.isPending || config.isError ? [] : (config.data ?? []),
      catalog: catalog.isError ? { managed: {}, store: [] } : (catalog.data?.data ?? { managed: {}, store: [] }),
    }),
  )
  const status = (name: string) => data.location.mcp.server.list(ref())?.find((server) => server.name === name)?.status
  const rowsByName = createMemo(() => new Map(rows().map((row) => [row.name, row])))
  const storeItems = createMemo(() =>
    (catalog.data?.data.store ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  const saveForm = async (name: string, configValue: Mcp.ServerConfig) => {
    await persist.mutateAsync({ name, config: configValue })
    showToast({
      variant: "success",
      title: language.t("settings.mcp.toast.saved.title"),
      description: language.t("settings.mcp.toast.saved.description", { name }),
    })
  }

  const savePat = async (row: ReturnType<typeof rows>[number], token: string) => {
    const configValue = patConfig(row, token)
    if (!configValue) return
    await persist.mutateAsync({ name: row.name, config: configValue })
    const runtimeStatus = status(row.name)
    if (runtimeStatus?.status === "connected") {
      showToast({
        variant: "success",
        title: language.t("settings.mcp.toast.connected.title"),
        description: language.t("settings.mcp.toast.connected.description", { name: row.name }),
      })
      return
    }
    if (runtimeStatus?.status === "failed" || runtimeStatus?.status === "needs_auth") {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: runtimeStatus.error,
      })
      return
    }
    showToast({
      variant: "success",
      title: language.t("settings.mcp.toast.saved.title"),
      description: language.t("settings.mcp.toast.saved.description", { name: row.name }),
    })
  }

  const remove = async (row: ReturnType<typeof rows>[number]) => {
    if (row.source !== "local") return
    await persist.mutateAsync({ name: row.name, config: null })
    showToast({
      variant: "success",
      title: language.t("settings.mcp.toast.removed.title"),
      description: language.t("settings.mcp.toast.removed.description", { name: row.name }),
    })
  }

  const showForm = (
    propsInput: {
      name?: string
      config?: Mcp.ServerConfig
      preset?: boolean
      lockedHeaderNames?: string[]
      headerPlaceholder?: string
    } = {},
  ) =>
    void dialog.show(() => (
      <DialogMcpForm
        {...propsInput}
        existingNames={new Set(rows().map((row) => row.name))}
        saving={persist.isPending}
        onSave={saveForm}
      />
    ))

  onCleanup(serverSdk.event.on("config.updated", () => void config.refetch()))
  onCleanup(
    serverSdk.event.on("mcp.status.changed", () => {
      data.location.mcp.server.invalidate(ref())
      void data.location.mcp.server.sync(ref()).catch(() => undefined)
    }),
  )

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.mcp.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.mcp.description")}</span>
          </div>
          <Button variant="outline" icon="plus" onClick={() => showForm()}>
            {language.t("settings.mcp.add")}
          </Button>
        </div>
      </div>
      <div class="settings-tab-body flex flex-col gap-6">
        <SettingsList variant="catalog">
          <For each={rows()}>
            {(row) => (
              <div class="settings-extension-row">
                <div class="settings-extension-lead">
                  <Icon name="mcp" class="text-v2-icon-icon-muted shrink-0" />
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <div class="flex items-center gap-2">
                      <span class="settings-extension-name truncate">{row.name}</span>
                      <Badge>
                        {language.t(
                          row.source === "managed"
                            ? "settings.mcp.managed"
                            : row.config.type === "local"
                              ? "settings.mcp.type.local"
                              : "settings.mcp.type.remote",
                        )}
                      </Badge>
                      <Show when={row.source === "managed" && row.override}>
                        <Badge variant="subtle">{language.t("settings.mcp.configured")}</Badge>
                      </Show>
                    </div>
                    <span class="text-12-regular text-v2-text-text-muted truncate">{subtitle(row)}</span>
                    <Show when={status(row.name)}>
                      {(current) => (
                        <span class="text-11-regular text-v2-text-text-muted">
                          {language.t(statusKeys[current().status])}
                          <Show when={statusError(current())} keyed>
                            {(error) => (
                              <>
                                {": "}
                                {error}
                              </>
                            )}
                          </Show>
                        </span>
                      )}
                    </Show>
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <Show when={row.source === "managed" && row.auth?.type === "pat"}>
                    <Button
                      variant="ghost"
                      disabled={persist.isPending}
                      onClick={() =>
                        void dialog.show(() => (
                          <DialogMcpPat
                            row={{ name: row.name, auth: row.auth!, current: patValue(row) }}
                            saving={persist.isPending}
                            onSave={(token) => savePat(row, token)}
                          />
                        ))
                      }
                    >
                      {language.t(row.override ? "settings.mcp.updateToken" : "common.connect")}
                    </Button>
                  </Show>
                  <Show when={row.source === "managed" && row.auth?.type !== "pat"}>
                    <Button
                      variant="ghost"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ name: row.name, enabled: true })}
                    >
                      {language.t("common.connect")}
                    </Button>
                  </Show>
                  <Show when={row.source === "local"}>
                    <Button
                      variant="ghost"
                      disabled={persist.isPending}
                      onClick={() => showForm({ name: row.name, config: row.config })}
                    >
                      {language.t("common.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={persist.isPending}
                      onClick={() => {
                        void remove(row)
                      }}
                    >
                      {language.t("common.delete")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </SettingsList>

        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-13-medium">{language.t("settings.mcp.store.title")}</h3>
          <Show when={catalog.isError}>
              <Button variant="ghost" onClick={() => void catalog.refetch()}>
                {language.t("common.retry")}
              </Button>
            </Show>
            <Show when={!catalog.isPending && !catalog.isError && storeItems().length === 0}>
              <span class="text-13-regular text-v2-text-text-muted">{language.t("settings.mcp.store.empty")}</span>
            </Show>
          </div>
          <SettingsList variant="catalog">
            <For each={storeItems()}>
              {(item) => (
                <div class="settings-extension-row">
                  <div class="settings-extension-lead">
                    <Icon name="mcp" class="text-v2-icon-icon-muted shrink-0" />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <span class="settings-extension-name truncate">{item.name}</span>
                      <Show when={item.description}>
                        <span class="text-12-regular text-v2-text-text-muted">{item.description}</span>
                      </Show>
                      <span class="text-12-regular text-v2-text-text-muted truncate">{item.url}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <Show
                      when={rowsByName().get(item.name)}
                      keyed
                      fallback={
                        <Button
                          variant="outline"
                          icon="plus"
                          disabled={persist.isPending}
                          onClick={() =>
                            showForm({
                              name: item.name,
                              config: storeConfig(item),
                              preset: true,
                              lockedHeaderNames: item.lockedHeaderNames,
                              headerPlaceholder: item.headerPlaceholder,
                            })
                          }
                        >
                          {language.t("settings.mcp.store.add")}
                        </Button>
                      }
                    >
                      {(row) => (
                        <>
                          <Show when={row.source === "local"}>
                            <Button
                              variant="ghost"
                              icon="check"
                              disabled={persist.isPending}
                              onClick={() =>
                                showForm({
                                  name: row.name,
                                  config: row.config,
                                  preset: true,
                                  lockedHeaderNames: item.lockedHeaderNames,
                                  headerPlaceholder: item.headerPlaceholder,
                                })
                              }
                            >
                              {language.t("common.edit")}
                            </Button>
                            <Button
                              variant="ghost"
                              icon="outline-trash"
                              disabled={persist.isPending}
                              onClick={() => void remove(row)}
                            >
                              {language.t("settings.mcp.store.remove")}
                            </Button>
                          </Show>
                        </>
                      )}
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </SettingsList>
        </div>
      </div>
    </>
  )
}
