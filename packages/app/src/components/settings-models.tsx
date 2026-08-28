import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { type Component, createResource, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useGlobalSync } from "@/context/global-sync"
import { SettingsList } from "./settings-list"
import { SettingsServerScope } from "./settings-server-picker"
import { usePlatform } from "@/context/platform"

const AIFACTORY_PROVIDER_ID = "aifactory"
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

type ModelCard = {
  model: string
  reasoningVariants?: string[]
  defaultReasoningVariant?: string | null
  context?: number | null
  output?: number | null
  temperature?: boolean | null
  reasoning?: boolean | null
  modalities?: { input?: string[]; output?: string[] } | null
  source?: string
  config?: {
    pattern?: string | null
    context?: number | null
    output?: number | null
    temperature?: boolean | null
    reasoning?: boolean | null
    reasoningVariants?: string[]
    defaultReasoningVariant?: string | null
    modalities?: { input?: string[]; output?: string[] } | null
  } | null
  liteLLM?: {
    name: string
    object?: string | null
    created?: number | null
    ownedBy?: string | null
    mode?: string | null
    provider?: string | null
    providerSpecificEntry?: string | null
    maxInputTokens?: number | null
    maxOutputTokens?: number | null
    inputCostPerMillionTokens?: number | null
    outputCostPerMillionTokens?: number | null
    supportsReasoning?: boolean | null
    modalities?: { input?: string[]; output?: string[] } | null
  } | null
}

type ModelCardResponse = {
  version: string
  generatedAt: string
  aifactory?: {
    models?: ModelCard[]
  } | null
}

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

const ListLoadingState: Component<{ label: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.label}</span>
    </div>
  )
}

const ListEmptyState: Component<{ message: string; filter: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.message}</span>
      <Show when={props.filter}>
        <span class="text-14-regular text-text-strong mt-1">&quot;{props.filter}&quot;</span>
      </Show>
    </div>
  )
}

export const SettingsModels: Component = () => {
  return (
    <SettingsServerScope>
      <SettingsModelsContent />
    </SettingsServerScope>
  )
}

const SettingsModelsContent: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const updateBaseUrl = (import.meta.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode").trim().replace(/\/+$/, "")
  const fetcher = platform.fetch ?? fetch
  const aifactoryApiKey = () => {
    const key = globalSync().data.config.provider?.["aifactory"]?.options?.apiKey
    return typeof key === "string" && key.trim() ? key.trim() : undefined
  }
  const [modelcards] = createResource(
    () => ({ baseUrl: updateBaseUrl, apiKey: aifactoryApiKey() }),
    async (input) =>
      fetcher(`${input.baseUrl}/modelcards.json`, requestInit(input.apiKey))
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null) ?? null,
    { initialValue: null as ModelCardResponse | null },
  )
  const cards = () =>
    (modelcards()?.aifactory?.models ?? []).filter((card: ModelCard) =>
      models.policyVisible({ providerID: AIFACTORY_PROVIDER_ID, modelID: card.model }),
    )
  const formatBoolean = (value?: boolean | null) => {
    if (value === undefined || value === null) return "n/a"
    return value ? "yes" : "no"
  }
  const formatMoney = (value?: number | null) =>
    value === undefined || value === null ? "n/a" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value)
  const formatNumber = (value?: number | null) => {
    if (value === undefined || value === null) return "n/a"
    return new Intl.NumberFormat("de-DE").format(value)
  }

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.manageable().filter((item) => item.provider.id === AIFACTORY_PROVIDER_ID),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      if (a.category === AIFACTORY_PROVIDER_ID && b.category !== AIFACTORY_PROVIDER_ID) return -1
      if (a.category !== AIFACTORY_PROVIDER_ID && b.category === AIFACTORY_PROVIDER_ID) return 1
      return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
    },
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 w-full">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.models.title")}</h2>
          <div class="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-base">
            <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
            <TextField
              variant="ghost"
              type="text"
              value={list.filter()}
              onChange={list.onInput}
              placeholder={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="flex-1"
            />
            <Show when={list.filter()}>
              <IconButton icon="circle-x" variant="ghost" onClick={list.clear} />
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <Show
          when={!list.grouped.loading}
          fallback={
            <ListLoadingState label={`${language.t("common.loading")}${language.t("common.loading.ellipsis")}`} />
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={<ListEmptyState message={language.t("dialog.model.empty")} filter={list.filter()} />}
          >
            <For each={list.grouped.latest}>
              {(group) => (
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2 pb-2">
                    <ProviderIcon id={group.category} class="size-5 shrink-0 icon-strong-base" />
                    <span class="text-14-medium text-text-strong">{group.items[0].provider.name}</span>
                  </div>
                  <SettingsList>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        return (
                          <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                            <div class="min-w-0">
                              <span class="text-14-regular text-text-strong truncate block">{item.name}</span>
                            </div>
                            <div class="flex-shrink-0">
                              <Switch
                                checked={models.visible(key)}
                                onChange={(checked) => {
                                  models.setVisibility(key, checked)
                                }}
                                hideLabel
                              >
                                {item.name}
                              </Switch>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </SettingsList>
                </div>
              )}
            </For>
          </Show>
        </Show>

          <div class="flex flex-col gap-4">
            <Show
            when={cards().length}
            fallback={<div class="text-14-regular text-text-weak">No model cards available yet.</div>}
          >
            <div class="grid gap-4 xl:grid-cols-2">
              <For each={cards()}>
                {(card) => {
                  const context = card.context ?? card.config?.context ?? card.liteLLM?.maxInputTokens ?? null
                  const output = card.output ?? card.config?.output ?? card.liteLLM?.maxOutputTokens ?? null
                  const thinking = card.reasoning ?? card.config?.reasoning ?? card.liteLLM?.supportsReasoning ?? null
                  const reasoningVariants = card.reasoningVariants ?? card.config?.reasoningVariants ?? []
                  const defaultReasoningVariant = card.defaultReasoningVariant ?? card.config?.defaultReasoningVariant
                  const inputCost = card.liteLLM?.inputCostPerMillionTokens ?? null
                  const outputCost = card.liteLLM?.outputCostPerMillionTokens ?? null

                  return (
                    <div class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 shadow-sm">
                      <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                          <div class="text-18-medium text-text-strong truncate">{card.model}</div>
                          <div class="text-13-regular text-text-weak truncate">{card.config?.pattern || "All models"}</div>
                        </div>
                      </div>
                      <div class="mt-4 grid grid-cols-2 gap-3 text-13-regular text-text-weak">
                        <div>
                          <div class="text-text-strong text-12-medium">Context</div>
                          <div>{formatNumber(context)}</div>
                        </div>
                        <div>
                          <div class="text-text-strong text-12-medium">Output</div>
                          <div>{formatNumber(output)}</div>
                        </div>
                        <div>
                          <div class="text-text-strong text-12-medium">Thinking</div>
                          <div>{formatBoolean(thinking)}</div>
                        </div>
                        <Show when={thinking && reasoningVariants.length > 0}>
                          <div>
                            <div class="text-text-strong text-12-medium">Reasoning levels</div>
                            <div>{reasoningVariants.join(", ")}</div>
                          </div>
                          <div>
                            <div class="text-text-strong text-12-medium">Default reasoning</div>
                            <div>{defaultReasoningVariant ?? "Provider default"}</div>
                          </div>
                        </Show>
                        <div>
                          <div class="text-text-strong text-12-medium">Input Cost /1M</div>
                          <div>{formatMoney(inputCost)}</div>
                        </div>
                        <div>
                          <div class="text-text-strong text-12-medium">Output Cost /1M</div>
                          <div>{formatMoney(outputCost)}</div>
                        </div>
                      </div>
                      <Show when={card.modalities?.input?.length || card.modalities?.output?.length}>
                        <div class="mt-4 text-13-regular text-text-weak">
                          <div class="text-text-strong text-12-medium mb-1">Modalities</div>
                          <div>
                            {card.modalities?.input?.join(", ") || "n/a"}{" "}
                            {card.modalities?.output?.length ? `→ ${card.modalities.output.join(", ")}` : ""}
                          </div>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
