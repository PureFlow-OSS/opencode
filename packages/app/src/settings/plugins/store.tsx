import { For, Show, createMemo, createUniqueId } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation, useQuery } from "@tanstack/solid-query"
import { Plugin } from "@opencode/schema/plugin"
import { Schema } from "effect"
import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { Loader } from "@opencode/ui/loader"
import { TextField } from "@opencode/ui/text-field"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogHeader, DialogTitleGroup, DialogFooter } from "@opencode/ui/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { SettingsList } from "@/settings/list"
import { showToast } from "@/shell/notifications/toast"

const isPackage = Schema.is(Plugin.Package)

const identity = (target: string) => target.replace(/@[^/@]+$/, "")

export function SettingsPluginStore(props: { onChanged: () => void }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()
  const id = createUniqueId()
  const [state, setState] = createStore({ search: "" })
  const directory = () => data.location.default().directory
  const connected = () => sdk.connection.status() === "connected"

  const catalog = useQuery(() => ({
    queryKey: [sdk.scope, "plugin-store", directory()],
    enabled: connected(),
    queryFn: () =>
      sdk.api.plugin
        .catalog({ location: directory() ? { directory: directory() } : undefined })
        .then((result) => result.data),
  }))

  const packages = () => catalog.data?.packages ?? []

  const entries = createMemo(() => {
    const offered = catalog.data?.store ?? []

    // Hidden/deleted offers remain removable when the user already configured the package.
    return [
      ...offered,
      ...packages()
        .filter((target) => isPackage(target) && !offered.some((item) => identity(item.package) === identity(target)))
        .map((target) => ({ name: identity(target), package: target, description: undefined })),
    ].filter((item) =>
      `${item.name} ${item.package} ${item.description ?? ""}`.toLowerCase().includes(state.search.toLowerCase()),
    )
  })

  const configured = (target: string) => packages().some((item) => identity(item) === identity(target))

  const confirmChange = () => {
    if (data.session.active().length === 0) return Promise.resolve(true)

    return new Promise<boolean>((resolve) => {
      void dialog.push(
        () => (
          <Dialog fit>
            <DialogHeader>
              <DialogTitleGroup
                title={language.t("settings.plugins.store.confirm.title")}
                description={language.t("settings.plugins.store.confirm.description")}
              />
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="neutral"
                onClick={() => {
                  resolve(false)
                  dialog.close(id)
                }}
              >
                {language.t("common.cancel")}
              </Button>
              <Button
                variant="contrast"
                onClick={() => {
                  resolve(true)
                  dialog.close(id)
                }}
              >
                {language.t("settings.plugins.store.confirm.continue")}
              </Button>
            </DialogFooter>
          </Dialog>
        ),
        () => resolve(false),
        id,
      )
    })
  }

  const change = useMutation(() => ({
    mutationFn: async (input: { target: string; enabled: boolean }) => {
      if (!(await confirmChange())) return false

      await sdk.api.config.update({ plugins: { [input.target]: input.enabled } })

      return true
    },
    onSuccess: async (changed) => {
      if (!changed) return

      showToast({ variant: "success", title: language.t("settings.plugins.store.saved") })
      props.onChanged()
      await catalog.refetch()
    },
    onError: () => showToast({ variant: "error", title: language.t("settings.plugins.store.failed") }),
  }))

  return (
    <div class="settings-section">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-13-medium">{language.t("settings.plugins.store.title")}</h3>
        <Button
          variant="neutral"
          disabled={!connected() || catalog.isFetching || change.isPending}
          onClick={() => void catalog.refetch()}
        >
          {language.t("settings.plugins.store.refresh")}
        </Button>
      </div>
      <p class="text-13-regular text-v2-text-text-muted">{language.t("settings.plugins.store.description")}</p>
      <TextField
        value={state.search}
        onChange={(value) => setState("search", value)}
        placeholder={language.t("settings.plugins.store.search")}
        aria-label={language.t("settings.plugins.store.search")}
      />
      <Show when={catalog.isFetching}>
        <Loader />
      </Show>
      <Show when={!connected()}>
        <p class="text-13-regular text-v2-text-text-muted">{language.t("settings.plugins.store.disconnected")}</p>
      </Show>
      <Show when={catalog.isError || catalog.data?.available === false}>
        <p role="alert" class="text-13-regular text-v2-text-text-muted">
          {language.t("settings.plugins.store.unavailable")}
        </p>
      </Show>
      <Show
        when={
          !catalog.isPending &&
          !catalog.isError &&
          catalog.data?.available !== false &&
          connected() &&
          entries().length === 0
        }
      >
        <p class="text-13-regular text-v2-text-text-muted">{language.t("settings.plugins.store.empty")}</p>
      </Show>
      <SettingsList variant="catalog">
        <For each={entries()}>
          {(item) => (
            <div class="settings-extension-row">
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="settings-extension-name truncate">{item.name}</span>
                  <Show when={configured(item.package)}>
                    <Badge>{language.t("settings.plugins.store.configured")}</Badge>
                  </Show>
                </div>
                <code class="text-11-regular text-v2-text-text-muted break-all">{item.package}</code>
                <Show when={item.description}>
                  <span class="text-13-regular text-v2-text-text-muted">{item.description}</span>
                </Show>
              </div>
              <div class="flex shrink-0 gap-2">
                <Show when={!packages().includes(item.package)}>
                  <Button
                    variant="neutral"
                    disabled={!connected() || change.isPending || catalog.isError || catalog.data?.available === false}
                    onClick={() => change.mutate({ target: item.package, enabled: true })}
                  >
                    {configured(item.package)
                      ? language.t("settings.plugins.store.update")
                      : language.t("settings.plugins.store.install")}
                  </Button>
                </Show>
                <Show when={configured(item.package)}>
                  <Button
                    variant="neutral"
                    disabled={!connected() || change.isPending || catalog.isError}
                    onClick={() => change.mutate({ target: item.package, enabled: false })}
                  >
                    {language.t("settings.plugins.store.remove")}
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </SettingsList>
    </div>
  )
}
