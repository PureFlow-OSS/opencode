import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { useParams } from "@solidjs/router"
import { batch, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2/client"

type McpConfig = McpLocalConfig | McpRemoteConfig

type HeaderRow = { key: string; value: string; err: { key?: string; value?: string } }

function headerRow(key = "", value = ""): HeaderRow {
  return { key, value, err: {} }
}

function headersFromRecord(record?: Record<string, string>): HeaderRow[] {
  if (!record || Object.keys(record).length === 0) return [headerRow()]
  return Object.entries(record).map(([k, v]) => headerRow(k, v))
}

function headersToRecord(rows: HeaderRow[]): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const row of rows) {
    if (row.key.trim()) result[row.key.trim()] = row.value
  }
  return Object.keys(result).length ? result : undefined
}

type OAuthState = {
  clientId: string
  clientSecret: string
  scope: string
}

type FormState = {
  name: string
  type: "local" | "remote"
  command: string
  url: string
  headers: HeaderRow[]
  oauthEnabled: boolean
  oauth: OAuthState
  enabled: boolean
  err: {
    name?: string
    command?: string
    url?: string
  }
}

type Props = {
  name?: string
  config?: McpConfig
  onBack?: () => void
}

export function DialogMcpForm(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const params = useParams()
  const dir = () => decode64(params.dir) ?? globalSync.data.path.directory ?? ""

  const isEditing = () => !!props.name

  const initialOAuth: OAuthState = (() => {
    if (props.config?.type === "remote" && props.config.oauth) {
      return {
        clientId: props.config.oauth.clientId ?? "",
        clientSecret: props.config.oauth.clientSecret ?? "",
        scope: props.config.oauth.scope ?? "",
      }
    }
    return { clientId: "", clientSecret: "", scope: "" }
  })()

  const [form, setForm] = createStore<FormState>({
    name: props.name ?? "",
    type: props.config?.type ?? "local",
    command: props.config?.type === "local" ? props.config.command.join(" ") : "",
    url: props.config?.type === "remote" ? props.config.url : "",
    headers: headersFromRecord(props.config?.type === "remote" ? props.config.headers : undefined),
    oauthEnabled: props.config?.type === "remote" && !!props.config.oauth,
    oauth: initialOAuth,
    enabled: props.config?.enabled ?? true,
    err: {},
  })

  const addHeader = () =>
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) {
      setForm("headers", 0, { key: "", value: "", err: {} })
      return
    }
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = (): McpConfig | null => {
    const errs: FormState["err"] = {}

    if (!form.name.trim()) errs.name = language.t("settings.mcp.form.validation.nameRequired")
    if (!isEditing() && form.name.trim() && (globalSync.data.config.mcp ?? {})[form.name.trim()])
      errs.name = language.t("settings.mcp.form.validation.nameTaken")

    if (form.type === "local" && !form.command.trim())
      errs.command = language.t("settings.mcp.form.validation.commandRequired")

    if (form.type === "remote" && !form.url.trim())
      errs.url = language.t("settings.mcp.form.validation.urlRequired")

    setForm("err", errs)
    if (Object.keys(errs).length) return null

    if (form.type === "local") {
      return {
        type: "local",
        command: form.command.trim().split(/\s+/).filter(Boolean),
        enabled: form.enabled,
      }
    }

    return {
      type: "remote",
      url: form.url.trim(),
      headers: headersToRecord(form.headers),
      oauth: form.oauthEnabled
        ? {
            clientId: form.oauth.clientId.trim() || undefined,
            clientSecret: form.oauth.clientSecret.trim() || undefined,
            scope: form.oauth.scope.trim() || undefined,
          }
        : undefined,
      enabled: form.enabled,
    }
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (config: McpConfig) => {
      const name = form.name.trim()
      const existing = { ...(globalSync.data.config.mcp ?? {}) }
      existing[name] = config
      if (dir()) {
        const [store, setStore] = globalSync.child(dir(), { bootstrap: false })
        setStore("mcp_ready", true)
        setStore(
          "mcp",
          name,
          store.mcp[name] ??
            ({
              status: config.enabled === false ? "disabled" : "disabled",
            } as (typeof store.mcp)[string]),
        )
      }
      await globalSync.updateConfig({ mcp: existing })
      return name
    },
    onSuccess: (name) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(isEditing() ? "settings.mcp.toast.updated.title" : "settings.mcp.toast.added.title"),
        description: language.t(
          isEditing() ? "settings.mcp.toast.updated.description" : "settings.mcp.toast.added.description",
          { name },
        ),
      })
    },
    onError: (err: unknown) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const submit = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return
    const config = validate()
    if (!config) return
    saveMutation.mutate(config)
  }

  return (
    <Dialog
      size="x-large"
      fit={form.type === "local"}
      class={form.type === "local" ? "[&_[data-slot=dialog-body]]:overflow-visible" : undefined}
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={() => (props.onBack ? props.onBack() : dialog.close())}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div
        class={
          form.type === "local"
            ? "flex flex-col gap-6 px-2.5 pb-3"
            : "flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[70vh]"
        }
      >
        <div class="px-2.5 text-16-medium text-text-strong">
          {language.t(isEditing() ? "settings.mcp.form.title.edit" : "settings.mcp.form.title.add")}
        </div>

        <form onSubmit={submit} class="px-2.5 pb-6 flex flex-col gap-6">
          <TextField
            autofocus
            label={language.t("settings.mcp.form.field.name.label")}
            placeholder={language.t("settings.mcp.form.field.name.placeholder")}
            description={language.t("settings.mcp.form.field.name.description")}
            value={form.name}
            readOnly={isEditing()}
            onChange={(v) => {
              setForm("name", v)
              setForm("err", "name", undefined)
            }}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />

          <div class="flex flex-col gap-2">
            <span class="text-12-medium text-text-weak">{language.t("settings.mcp.form.field.type.label")}</span>
            <div class="flex gap-2">
              <Button
                type="button"
                size="large"
                variant={form.type === "local" ? "primary" : "secondary"}
                onClick={() => setForm("type", "local")}
                disabled={isEditing()}
              >
                {language.t("settings.mcp.server.type.local")}
              </Button>
              <Button
                type="button"
                size="large"
                variant={form.type === "remote" ? "primary" : "secondary"}
                onClick={() => setForm("type", "remote")}
                disabled={isEditing()}
              >
                {language.t("settings.mcp.server.type.remote")}
              </Button>
            </div>
          </div>

          <Show when={form.type === "local"}>
            <TextField
              label={language.t("settings.mcp.form.field.command.label")}
              placeholder={language.t("settings.mcp.form.field.command.placeholder")}
              description={language.t("settings.mcp.form.field.command.description")}
              value={form.command}
              onChange={(v) => {
                setForm("command", v)
                setForm("err", "command", undefined)
              }}
              validationState={form.err.command ? "invalid" : undefined}
              error={form.err.command}
            />
          </Show>

          <Show when={form.type === "remote"}>
            <div class="flex flex-col gap-6">
              <TextField
                label={language.t("settings.mcp.form.field.url.label")}
                placeholder={language.t("settings.mcp.form.field.url.placeholder")}
                value={form.url}
                onChange={(v) => {
                  setForm("url", v)
                  setForm("err", "url", undefined)
                }}
                validationState={form.err.url ? "invalid" : undefined}
                error={form.err.url}
              />

              <div class="flex flex-col gap-3">
                <label class="text-12-medium text-text-weak">
                  {language.t("settings.mcp.form.field.headers.label")}
                </label>
                <For each={form.headers}>
                  {(h, i) => (
                    <div class="flex gap-2 items-start">
                      <div class="flex-1">
                        <TextField
                          label={language.t("settings.mcp.form.field.headers.key.placeholder")}
                          hideLabel
                          placeholder={language.t("settings.mcp.form.field.headers.key.placeholder")}
                          value={h.key}
                          onChange={(v) => setHeader(i(), "key", v)}
                          validationState={h.err.key ? "invalid" : undefined}
                          error={h.err.key}
                        />
                      </div>
                      <div class="flex-1">
                        <TextField
                          label={language.t("settings.mcp.form.field.headers.value.placeholder")}
                          hideLabel
                          placeholder={language.t("settings.mcp.form.field.headers.value.placeholder")}
                          value={h.value}
                          onChange={(v) => setHeader(i(), "value", v)}
                        />
                      </div>
                      <IconButton
                        type="button"
                        icon="trash"
                        variant="ghost"
                        class="mt-1.5"
                        onClick={() => removeHeader(i())}
                        aria-label={language.t("settings.mcp.form.field.headers.remove")}
                      />
                    </div>
                  )}
                </For>
                <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
                  {language.t("settings.mcp.form.field.headers.add")}
                </Button>
              </div>

              <div class="flex flex-col gap-4">
                <Switch
                  checked={form.oauthEnabled}
                  onChange={(v) => setForm("oauthEnabled", v)}
                  description={language.t("settings.mcp.form.field.oauth.description")}
                >
                  {language.t("settings.mcp.form.field.oauth.label")}
                </Switch>

                <Show when={form.oauthEnabled}>
                  <div class="flex flex-col gap-4 pl-4 border-l border-border-weak-base">
                    <TextField
                      label={language.t("settings.mcp.form.field.oauth.clientId.label")}
                      placeholder={language.t("settings.mcp.form.field.oauth.clientId.placeholder")}
                      value={form.oauth.clientId}
                      onChange={(v) => setForm("oauth", "clientId", v)}
                    />
                    <TextField
                      label={language.t("settings.mcp.form.field.oauth.clientSecret.label")}
                      value={form.oauth.clientSecret}
                      onChange={(v) => setForm("oauth", "clientSecret", v)}
                    />
                    <TextField
                      label={language.t("settings.mcp.form.field.oauth.scope.label")}
                      placeholder={language.t("settings.mcp.form.field.oauth.scope.placeholder")}
                      value={form.oauth.scope}
                      onChange={(v) => setForm("oauth", "scope", v)}
                    />
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          <Switch
            checked={form.enabled}
            onChange={(v) => setForm("enabled", v)}
            description={language.t("settings.mcp.form.field.enabled.description")}
          >
            {language.t("settings.mcp.form.field.enabled.label")}
          </Switch>

          <div class="flex gap-3">
            <Button class="self-start" type="submit" size="large" variant="primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
            </Button>
            <Button type="button" size="large" variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}
