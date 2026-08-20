import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { type Component, createResource, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { popularProviders } from "@/hooks/use-providers"
import { SettingsList } from "./settings-list"
import { usePlatform } from "@/context/platform"

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
  const language = useLanguage()
  const models = useModels()
  const platform = usePlatform()
  const updateBaseUrl =
    import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:80/opencode" : "http://10.53.7.23/opencode")
  const [modelcards] = createResource(
    () => updateBaseUrl,
    async (baseUrl) =>
      platform.fetch?.(new Request(`${baseUrl}/modelcards.json`, { cache: "no-store" }))
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null) ?? null,
    { initialValue: null as ModelCardResponse | null },
  )
  const formatMoney = (value?: number | null) =>
    value === undefined || value === null ? "n/a" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value)

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.manageable(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex

      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
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
          <div class="flex items-end justify-between gap-4">
            <div class="flex flex-col gap-1">
              <h2 class="text-16-medium text-text-strong">{language.t("settings.models.title")}</h2>
            </div>
          </div>
          <Show
            when={modelcards()?.aifactory?.models?.length}
            fallback={<div class="text-14-regular text-text-weak">No model cards available yet.</div>}
          >
            <div class="grid gap-4 xl:grid-cols-2">
              <For each={modelcards()?.aifactory?.models ?? []}>
                {(card) => (
                  (() => {
                    const context = card.context ?? card.config?.context ?? null
                    const output = card.output ?? card.config?.output ?? null
                    const thinking = card.reasoning ?? card.config?.reasoning ?? null
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
                        <div>{context === null ? "n/a" : context.toLocaleString()}</div>
                      </div>
                      <div>
                        <div class="text-text-strong text-12-medium">Output</div>
                        <div>{output === null ? "n/a" : output.toLocaleString()}</div>
                      </div>
                      <div>
                        <div class="text-text-strong text-12-medium">Thinking</div>
                        <div>{thinking === null ? "n/a" : thinking ? "Yes" : "No"}</div>
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
                          {card.modalities?.input?.join(", ") || "n/a"} {card.modalities?.output?.length ? `→ ${card.modalities.output.join(", ")}` : ""}
                        </div>
                      </div>
                    </Show>
                  </div>
                    )
                  })()
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
