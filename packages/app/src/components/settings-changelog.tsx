import { type Component, Match, Show, Switch, createMemo, createResource } from "solid-js"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { SettingsList } from "./settings-list"

const UPDATE_SERVER_BASE_URL = (import.meta.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode")
  .trim()
  .replace(/\/+$/, "")
const CHANGELOG_URL = `${UPDATE_SERVER_BASE_URL}/changelog.md`
const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

function requestInit(apiKey?: string) {
  if (!apiKey?.trim()) return { cache: "no-store", signal: AbortSignal.timeout(3000) } satisfies RequestInit
  return {
    cache: "no-store",
    headers: {
      [AIFACTORY_API_KEY_HEADER]: apiKey.trim(),
    },
    signal: AbortSignal.timeout(3000),
  } satisfies RequestInit
}

export const SettingsChangelog: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()

  const aifactoryApiKey = createMemo(() => {
    const key = globalSync().data.config.provider?.["aifactory"]?.options?.apiKey
    return typeof key === "string" && key.trim() ? key.trim() : undefined
  })

  const [changelog] = createResource(
    () => ({ apiKey: aifactoryApiKey() }),
    async (input) =>
      (platform.fetch ?? fetch)(CHANGELOG_URL, requestInit(input.apiKey))
        .then((result) => (result.ok ? result.text() : result.status === 404 ? "" : Promise.reject(new Error("Request failed"))))
        .catch(() => ""),
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.changelog.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <SettingsList>
          <div class="py-4">
            <Switch>
              <Match when={changelog.loading}>
                <div class="text-14-regular text-text-weak">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              </Match>
              <Match when={!changelog.loading && !changelog.latest?.trim()}>
                <div class="text-14-regular text-text-weak">{language.t("settings.changelog.empty")}</div>
              </Match>
              <Match when={!!changelog.latest?.trim()}>
                <div class="prose prose-sm max-w-none text-text-base">
                  <Markdown text={changelog.latest ?? ""} class="text-14-regular" />
                </div>
              </Match>
            </Switch>
          </div>
        </SettingsList>

        <Show when={CHANGELOG_URL}>
          <div class="text-12-regular text-text-weak">{language.t("settings.changelog.description")}</div>
        </Show>
      </div>
    </div>
  )
}
