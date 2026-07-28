import { type Component, createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { SettingsList } from "./settings-list"

const UPDATE_SERVER_BASE_URL = import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"
const FEEDBACK_URL = `${UPDATE_SERVER_BASE_URL}/feedback`
const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"
const FEEDBACK_TEXT_LIMIT = 4000

type FeedbackCategory = "general" | "bug" | "idea"
type BetaSentiment = "positive" | "negative"
type FeedbackAttachment = {
  name: string
  type: string
  data: string
}

type FeedbackFile = {
  name: string
  type: string
  file: File
}

function requestInit(apiKey?: string, body?: Record<string, unknown>) {
  const headers = {
    "content-type": "application/json",
    ...(apiKey?.trim() ? { [AIFACTORY_API_KEY_HEADER]: apiKey.trim() } : {}),
  }

  return {
    cache: "no-store",
    headers,
    method: "POST",
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(5_000),
  } satisfies RequestInit
}

export const SettingsFeedback: Component<{ mode?: "general" | "beta" }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const [store, setStore] = createStore({
    category: (props.mode === "beta" ? "bug" : "general") as FeedbackCategory,
    betaSentiment: undefined as BetaSentiment | undefined,
    text: "",
    files: [] as FeedbackFile[],
    sending: false,
  })

  const aifactoryApiKey = createMemo(() => {
    const key = globalSync.data.config.provider?.["aifactory"]?.options?.apiKey
    return typeof key === "string" && key.trim() ? key.trim() : undefined
  })

  const categories = createMemo(
    () =>
      (
        props.mode === "beta"
          ? [
              { value: "bug" as const, label: "Fehler gefunden" },
              { value: "general" as const, label: "Version erfolgreich getestet" },
            ]
          : [
        { value: "general" as const, label: language.t("settings.feedback.category.general") },
        { value: "bug" as const, label: language.t("settings.feedback.category.bug") },
        { value: "idea" as const, label: language.t("settings.feedback.category.idea") },
            ]
      ) satisfies { value: FeedbackCategory; label: string }[],
  )

  const canSubmit = createMemo(() => store.text.trim().length > 0 && !store.sending)

  const readAttachment = async (file: File): Promise<FeedbackAttachment> => {
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ""
    const chunkSize = 0x8000
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    }
    return {
      name: file.name,
      type: file.type || "application/octet-stream",
      data: btoa(binary),
    }
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const text = store.text.trim()
    if (!text || store.sending) return
    if (props.mode === "beta" && !store.betaSentiment) return

    setStore("sending", true)
    const attachments = await Promise.all(store.files.map((item) => readAttachment(item.file)))
    await (platform.fetch ?? fetch)(
      FEEDBACK_URL,
      requestInit(aifactoryApiKey(), {
        text: text.slice(0, FEEDBACK_TEXT_LIMIT),
        category: props.mode === "beta" ? "beta" : store.category,
        beta_sentiment: props.mode === "beta" ? store.betaSentiment : undefined,
        key: aifactoryApiKey(),
        app_version: platform.version,
        platform: platform.platform,
        attachments,
      }),
    )
      .then((result) => {
        if (!result.ok) return Promise.reject(new Error(`Request failed (${result.status})`))
        setStore("text", "")
        setStore("category", props.mode === "beta" ? "bug" : "general")
        setStore("betaSentiment", undefined)
        setStore("files", [])
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.feedback.toast.sent.title"),
          description: language.t("settings.feedback.toast.sent.description"),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("sending", false))
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-text-strong">
            {props.mode === "beta" ? "Beta Feedback" : language.t("settings.feedback.title")}
          </h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <SettingsList>
          <form class="flex flex-col gap-4 py-4" onSubmit={submit}>
            <div class="flex flex-col gap-1">
              <div class="text-14-medium text-text-strong">
                {props.mode === "beta"
                  ? "Only for beta testers. Send test result, bugs, free text, and screenshots."
                  : language.t("settings.feedback.description")}
              </div>
            </div>

            <Show
              when={props.mode !== "beta"}
              fallback={<input type="hidden" name="channel" value="beta" />}
            >
              <Select
                options={categories()}
                current={categories().find((item) => item.value === store.category)}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setStore("category", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Show>

            <Show when={props.mode === "beta"}>
              <div class="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={store.betaSentiment === "positive" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => {
                    setStore("betaSentiment", "positive")
                  }}
                >
                  Version erfolgreich getestet
                </Button>
                <Button
                  type="button"
                  variant={store.betaSentiment === "negative" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => {
                    setStore("betaSentiment", "negative")
                  }}
                >
                  Fehler gefunden
                </Button>
              </div>
              <div class="text-12-regular text-text-weak">
                Choose one feedback direction before sending.
              </div>
            </Show>

            <div class="flex flex-col gap-2">
              <label class="text-14-medium text-text-strong">
                {props.mode === "beta" ? "Screenshots" : language.t("settings.feedback.field.attachments.label")}
              </label>
              <input
                type="file"
                multiple
                accept="image/*,.txt,.log,.md,.json,.jsonl,.csv,.ts,.tsx,.js,.jsx,.yml,.yaml"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []).map((file) => ({
                    name: file.name,
                    type: file.type,
                    file,
                  }))
                  setStore("files", files)
                }}
                class="block w-full text-12-regular text-text-weak file:mr-3 file:rounded-md file:border-0 file:bg-surface-strong file:px-3 file:py-2 file:text-text-strong file:cursor-pointer"
              />
              <div class="text-12-regular text-text-weak">
                {store.files.length > 0
                  ? language.t("settings.feedback.field.attachments.count", { count: store.files.length })
                  : props.mode === "beta"
                    ? "No screenshots selected."
                    : language.t("settings.feedback.field.attachments.empty")}
              </div>
              <Show when={store.files.length > 0}>
                <div class="flex flex-wrap gap-2">
                  {store.files.map((item, index) => (
                    <button
                      type="button"
                      class="rounded-full bg-surface-strong px-3 py-1 text-12-regular text-text-strong"
                      onClick={() =>
                        setStore(
                          "files",
                          store.files.filter((_, fileIndex) => fileIndex !== index),
                        )
                      }
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </Show>
            </div>

            <TextField
              label={language.t("settings.feedback.field.text.label")}
              description={props.mode === "beta" ? "Describe the result or issue." : language.t("settings.feedback.field.text.description")}
              value={store.text}
              onChange={(value) => setStore("text", value.slice(0, FEEDBACK_TEXT_LIMIT))}
              placeholder={props.mode === "beta" ? "Write details or reproduce steps..." : language.t("settings.feedback.field.text.placeholder")}
              multiline
              class="min-h-32 text-14-regular"
            />

            <div class="flex items-center justify-between gap-3">
              <span class="text-12-regular text-text-weak">
                {props.mode === "beta"
                  ? `${FEEDBACK_TEXT_LIMIT - store.text.length} characters left`
                  : language.t("settings.feedback.field.text.counter", {
                      count: FEEDBACK_TEXT_LIMIT - store.text.length,
                    })}
              </span>
              <Button size="small" variant="secondary" type="submit" disabled={!canSubmit() || (props.mode === "beta" && !store.betaSentiment)}>
                {store.sending ? language.t("common.saving") : language.t("settings.feedback.action.send")}
              </Button>
            </div>
          </form>
        </SettingsList>
      </div>
    </div>
  )
}
