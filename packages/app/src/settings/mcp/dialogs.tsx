import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { Show, For, type Component } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Mcp } from "@opencode/schema/mcp"
import { useLanguage } from "@/runtime/i18n/language"
import { isValidRemoteUrl } from "./model"

type HeaderRow = { key: string; value: string; error?: string }

const headerRow = (key = "", value = "") => ({ key, value })

const headersFromRecord = (record?: Record<string, string>) =>
  record && Object.keys(record).length
    ? Object.entries(record).map(([key, value]) => headerRow(key, value))
    : [headerRow()]

const headersToRecord = (rows: readonly HeaderRow[]) => {
  const headers = Object.fromEntries(rows.flatMap((row) => (row.key.trim() ? [[row.key.trim(), row.value]] : [])))
  return Object.keys(headers).length ? headers : undefined
}

const usesAifactoryApiKey = (key: string) => key.trim().toLowerCase() === "x-litellm-api-key"

function formatCommand(command: readonly string[]) {
  return command.map((argument) => `'${argument.replaceAll("'", `'"'"'`)}'`).join(" ")
}

// MCP commands are argv, not shell programs. Quotes group arguments without expanding variables or executing operators.
function commandArgs(command: string) {
  const args: string[] = []
  let argument = ""
  let quote: string | undefined
  let started = false
  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    if (quote) {
      if (character === quote) {
        quote = undefined
        continue
      }
      if (quote === '"' && character === "\\" && ['"', "\\"].includes(command[index + 1])) {
        argument += command[++index]
        continue
      }
      argument += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) args.push(argument)
      argument = ""
      started = false
      continue
    }
    argument += character
    started = true
  }
  if (quote) return
  if (started) args.push(argument)
  return args
}

type FormState = {
  name: string
  type: "local" | "remote"
  command: string
  url: string
  headers: HeaderRow[]
  oauthEnabled: boolean
  oauth: { client_id: string; client_secret: string; scope: string }
  disabled: boolean
  nameError?: string
  commandError?: string
  urlError?: string
}

export const DialogMcpForm: Component<{
  name?: string
  config?: Mcp.ServerConfig
  preset?: boolean
  lockedHeaderNames?: string[]
  headerPlaceholder?: string
  existingNames?: ReadonlySet<string>
  saving?: boolean
  onSave: (name: string, config: Mcp.ServerConfig) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const editing = () => !!props.name && (props.existingNames?.has(props.name) ?? !props.preset)
  const lockedHeader = (key: string) => props.lockedHeaderNames?.includes(key) ?? false

  const [form, setForm] = createStore<FormState>({
    name: props.name ?? "",
    type: props.config?.type ?? "local",
    command: props.config?.type === "local" ? formatCommand(props.config.command) : "",
    url: props.config?.type === "remote" ? props.config.url : "",
    headers: headersFromRecord(props.config?.type === "remote" ? props.config.headers : undefined),
    oauthEnabled: props.config?.type === "remote" && props.config.oauth !== false,
    oauth:
      props.config?.type === "remote" && !!props.config.oauth
        ? {
            client_id: props.config.oauth.client_id ?? "",
            client_secret: props.config.oauth.client_secret ?? "",
            scope: props.config.oauth.scope ?? "",
          }
        : { client_id: "", client_secret: "", scope: "" },
    disabled: props.config?.disabled ?? false,
  })

  const validate = () => {
    const name = form.name.trim()
    let nameError: string | undefined
    if (!name) nameError = language.t("settings.mcp.form.error.nameRequired")
    if (!editing() && name && props.existingNames?.has(name))
      nameError = language.t("settings.mcp.form.error.nameTaken")
    setForm("nameError", nameError)

    const command = form.type === "local" ? commandArgs(form.command) : undefined
    const commandError =
      form.type !== "local"
        ? undefined
        : !form.command.trim() || !command?.[0]
          ? language.t(command ? "settings.mcp.form.error.commandRequired" : "settings.mcp.form.error.commandFormat")
          : undefined
    setForm("commandError", commandError)

    const url = form.url.trim()
    const urlError =
      form.type === "remote" && !url
        ? language.t("settings.mcp.form.error.urlRequired")
        : form.type === "remote" && url && !isValidRemoteUrl(url)
          ? language.t("settings.mcp.form.error.urlFormat")
          : undefined
    setForm("urlError", urlError)

    let headerError = false
    form.headers.forEach((row, index) => {
      const invalid = lockedHeader(row.key) && !row.value.trim() && !usesAifactoryApiKey(row.key)
      headerError ||= invalid
      setForm("headers", index, "error", invalid ? language.t("settings.mcp.form.error.headerRequired") : undefined)
    })
    if (nameError || commandError || urlError || headerError) return

    if (form.type === "local") {
      return {
        ...(props.config?.type === "local" ? props.config : {}),
        type: "local" as const,
        command: command ?? [],
        disabled: form.disabled,
      }
    }
    const oauth = form.oauthEnabled
      ? {
          ...(props.config?.type === "remote" && props.config.oauth ? props.config.oauth : {}),
          client_id: form.oauth.client_id.trim() || undefined,
          client_secret: form.oauth.client_secret.trim() || undefined,
          scope: form.oauth.scope.trim() || undefined,
        }
      : (false as const)
    return {
      ...(props.config?.type === "remote" ? props.config : {}),
      type: "remote" as const,
      url,
      headers: headersToRecord(form.headers),
      oauth,
      disabled: form.disabled,
    }
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (props.saving) return
    const config = validate()
    if (!config) return
    await props.onSave(form.name.trim(), config)
    dialog.close()
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t(props.name ? "settings.mcp.form.title.edit" : "settings.mcp.form.title.add")}
          description={language.t("settings.mcp.form.description")}
        />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-5">
        <form class="flex flex-col gap-5" onSubmit={submit}>
          <TextField
            autofocus
            label={language.t("settings.mcp.form.name")}
            value={form.name}
            readOnly={editing() || !!props.preset}
            onChange={(value) => setForm({ name: value, nameError: undefined })}
            validationState={form.nameError ? "invalid" : undefined}
            error={form.nameError}
          />
          <div class="flex gap-2">
            <Button
              type="button"
              variant={form.type === "local" ? "contrast" : "ghost"}
              disabled={editing() || !!props.preset}
              onClick={() => setForm("type", "local")}
            >
              {language.t("settings.mcp.type.local")}
            </Button>
            <Button
              type="button"
              variant={form.type === "remote" ? "contrast" : "ghost"}
              disabled={editing() || !!props.preset}
              onClick={() => setForm("type", "remote")}
            >
              {language.t("settings.mcp.type.remote")}
            </Button>
          </div>
          <Show when={form.type === "local"}>
            <TextField
              label={language.t("settings.mcp.form.command")}
              value={form.command}
              onChange={(value) => setForm({ command: value, commandError: undefined })}
              validationState={form.commandError ? "invalid" : undefined}
              error={form.commandError}
            />
          </Show>
          <Show when={form.type === "remote"}>
            <TextField
              label={language.t("settings.mcp.form.url")}
              value={form.url}
              readOnly={props.preset}
              onChange={(value) => setForm({ url: value, urlError: undefined })}
              validationState={form.urlError ? "invalid" : undefined}
              error={form.urlError}
            />
            <div class="flex flex-col gap-2">
              <span class="text-13-medium">{language.t("settings.mcp.form.headers")}</span>
              <For each={form.headers}>
                {(row, index) => (
                  <div class="flex items-start gap-2">
                    <TextField
                      class="flex-1"
                      hideLabel
                      label={language.t("settings.mcp.form.headerName")}
                      value={row.key}
                      readOnly={lockedHeader(row.key)}
                      onChange={(value) => setForm("headers", index(), { key: value, error: undefined })}
                    />
                    <TextField
                      class="flex-1"
                      hideLabel
                      label={language.t("settings.mcp.form.headerValue")}
                      value={row.value}
                      placeholder={
                        usesAifactoryApiKey(row.key)
                          ? language.t("settings.mcp.form.aifactoryPlaceholder")
                          : (props.headerPlaceholder ?? undefined)
                      }
                      onChange={(value) => setForm("headers", index(), { value, error: undefined })}
                      validationState={row.error ? "invalid" : undefined}
                      error={row.error}
                    />
                    <Show when={!lockedHeader(row.key)}>
                      <IconButton
                        type="button"
                        icon={<Icon name="outline-trash" size="small" />}
                        variant="ghost"
                        aria-label={language.t("settings.mcp.form.removeHeader")}
                        onClick={() =>
                          setForm(
                            "headers",
                            produce((rows) => {
                              if (rows.length === 1) {
                                rows[0] = headerRow()
                                return
                              }
                              rows.splice(index(), 1)
                            }),
                          )
                        }
                      />
                    </Show>
                  </div>
                )}
              </For>
              <Button
                type="button"
                size="small"
                variant="ghost"
                icon="plus"
                class="self-start"
                onClick={() =>
                  setForm(
                    "headers",
                    produce((rows) => rows.push(headerRow())),
                  )
                }
              >
                {language.t("settings.mcp.form.addHeader")}
              </Button>
            </div>
            <Switch
              checked={form.oauthEnabled}
              onChange={(value) => setForm("oauthEnabled", value)}
              description={language.t("settings.mcp.form.oauthDescription")}
            >
              {language.t("settings.mcp.form.oauth")}
            </Switch>
            <Show when={form.oauthEnabled}>
              <div class="flex flex-col gap-3 border-l border-border pl-4">
                <TextField
                  label={language.t("settings.mcp.form.oauthClientId")}
                  value={form.oauth.client_id}
                  onChange={(value) => setForm("oauth", "client_id", value)}
                />
                <TextField
                  label={language.t("settings.mcp.form.oauthClientSecret")}
                  value={form.oauth.client_secret}
                  onChange={(value) => setForm("oauth", "client_secret", value)}
                />
                <TextField
                  label={language.t("settings.mcp.form.oauthScope")}
                  value={form.oauth.scope}
                  onChange={(value) => setForm("oauth", "scope", value)}
                />
              </div>
            </Show>
          </Show>
          <Switch
            checked={!form.disabled}
            onChange={(value) => setForm("disabled", !value)}
            description={language.t("settings.mcp.form.enabledDescription")}
          >
            {language.t("settings.mcp.form.enabled")}
          </Switch>
          <div class="flex gap-2">
            <Button type="submit" variant="contrast" disabled={props.saving}>
              {props.saving ? language.t("common.saving") : language.t("common.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
          </div>
        </form>
      </DialogBody>
    </Dialog>
  )
}

export const DialogMcpPat: Component<{
  row: { name: string; auth: Mcp.PatAuth; current: string }
  saving?: boolean
  onSave: (token: string) => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [token, setToken] = createStore({ value: props.row.current })

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitleGroup
          title={props.row.auth.label ?? props.row.name}
          description={props.row.auth.description ?? language.t("settings.mcp.pat.description")}
        />
      </DialogHeader>
      <DialogBody>
        <form
          class="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            const value = token.value.trim()
            if (!value || props.saving) return
            await props.onSave(value)
            dialog.close()
          }}
        >
          <TextField
            autofocus
            type="password"
            label={props.row.auth.label ?? language.t("settings.mcp.pat.label")}
            placeholder={props.row.auth.placeholder ?? language.t("settings.mcp.pat.placeholder")}
            value={token.value}
            onChange={(value) => setToken("value", value)}
          />
          <Button type="submit" variant="contrast" disabled={!token.value.trim() || props.saving}>
            {props.saving ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </form>
      </DialogBody>
    </Dialog>
  )
}

export const renderMcpError = (error: unknown) => (error instanceof Error ? error.message : String(error))
