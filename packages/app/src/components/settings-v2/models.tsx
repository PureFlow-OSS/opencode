import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, createResource, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePlatform } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

type ModelCard = {
  model: string
  context?: number | null
  output?: number | null
  reasoning?: boolean | null
  modalities?: { input?: string[]; output?: string[] } | null
  config?: {
    pattern?: string | null
    context?: number | null
    output?: number | null
    reasoning?: boolean | null
    modalities?: { input?: string[]; output?: string[] } | null
  } | null
  price?: {
    input?: number | null
    output?: number | null
  } | null
  liteLLM?: {
    inputCostPerMillionTokens?: number | null
    outputCostPerMillionTokens?: number | null
  } | null
}

type ModelCardResponse = {
  aifactory?: {
    models?: ModelCard[]
  } | null
}

const PROVIDER_ICON_SIZE = 16
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

export const SettingsModelsV2: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const platform = usePlatform()
  const serverSync = useServerSync()
  const updateBaseUrl = (import.meta.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode").trim().replace(/\/+$/, "")
  const fetcher = platform.fetch ?? fetch
  const aifactoryApiKey = () => {
    const key = serverSync().data.config.provider?.["aifactory"]?.options?.apiKey
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

  const formatNumber = (value?: number | null) => {
    if (value === undefined || value === null) return "n/a"
    return new Intl.NumberFormat("de-DE").format(value)
  }

  const formatMoney = (value?: number | null) => {
    if (value === undefined || value === null) return "n/a"
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
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
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <h2 class="settings-v2-tab-title">{language.t("settings.models.title")}</h2>
        <div class="settings-v2-tab-search">
          <TextInputV2
            type="search"
            appearance="base"
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("dialog.model.search.placeholder")}
          />
          <Show when={list.filter()}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="settings-v2-tab-search-clear"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              onClick={() => list.clear()}
            />
          </Show>
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-models">
        <Show
          when={!list.grouped.loading}
          fallback={
            <div class="settings-v2-models-status">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={
              <div class="settings-v2-models-status">
                <span>{language.t("dialog.model.empty")}</span>
                <Show when={list.filter()}>
                  <span class="settings-v2-models-status-filter">&quot;{list.filter()}&quot;</span>
                </Show>
              </div>
            }
          >
            <For each={list.grouped.latest}>
              {(group) => (
                <div class="settings-v2-section" data-component="settings-models-provider">
                  <div class="settings-v2-models-group-header">
                    <ProviderIcon
                      id={group.category}
                      width={PROVIDER_ICON_SIZE}
                      height={PROVIDER_ICON_SIZE}
                      class="settings-v2-models-provider-icon shrink-0"
                    />
                    <h3 class="settings-v2-section-title">{group.items[0].provider.name}</h3>
                  </div>
                  <SettingsListV2>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        return (
                          <SettingsRowV2 title={item.name} description="">
                            <div>
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
                          </SettingsRowV2>
                        )
                      }}
                    </For>
                  </SettingsListV2>
                </div>
              )}
            </For>
          </Show>
        </Show>

        <div class="settings-v2-section settings-v2-modelcards-section">
          <div class="settings-v2-modelcards-header">
            <h3 class="settings-v2-section-title">Model Cards</h3>
            <span class="settings-v2-modelcards-count">Models: {cards().length}</span>
          </div>
          <Show
            when={cards().length}
            fallback={<div class="settings-v2-modelcards-status">No model cards available yet.</div>}
          >
            <div class="settings-v2-modelcards-grid">
              <For each={cards()}>
                {(card) => (
                  <section class="settings-v2-modelcard">
                    <div class="settings-v2-modelcard-head">
                      <div class="settings-v2-modelcard-copy">
                        <strong>{card.model}</strong>
                        <span>{card.config?.pattern || "All models"}</span>
                      </div>
                    </div>
                    <div class="settings-v2-modelcard-meta">
                      <div class="settings-v2-modelcard-item">
                        <small>Context</small>
                        <strong>{formatNumber(card.context ?? card.config?.context ?? card.liteLLM?.maxInputTokens)}</strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Output</small>
                        <strong>{formatNumber(card.output ?? card.config?.output ?? card.liteLLM?.maxOutputTokens)}</strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Thinking</small>
                        <strong>{formatBoolean(card.reasoning ?? card.config?.reasoning ?? card.liteLLM?.supportsReasoning)}</strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Input Cost /1M</small>
                        <strong>{formatMoney(card.price?.input ?? card.liteLLM?.inputCostPerMillionTokens)}</strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Output Cost /1M</small>
                        <strong>{formatMoney(card.price?.output ?? card.liteLLM?.outputCostPerMillionTokens)}</strong>
                      </div>
                      <Show when={card.modalities?.input?.length || card.modalities?.output?.length}>
                        <div class="settings-v2-modelcard-item settings-v2-modelcard-item--wide">
                          <small>Modalities</small>
                          <strong>
                            {card.modalities?.input?.join(", ") || "n/a"}
                            {card.modalities?.output?.length ? ` → ${card.modalities.output.join(", ")}` : ""}
                          </strong>
                        </div>
                      </Show>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </>
  )
}
