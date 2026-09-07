import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { Persist, persisted } from "@/utils/persist"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

const PROVIDER_ICON_SIZE = 16
const AIFACTORY_PROVIDER_ID = "aifactory"
const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

type ModelCard = {
  model: string
  context?: number | null
  output?: number | null
  reasoning?: boolean | null
  config?: {
    pattern?: string | null
    context?: number | null
    output?: number | null
    reasoning?: boolean | null
  } | null
  price?: { input?: number | null; output?: number | null } | null
  liteLLM?: {
    inputCostPerMillionTokens?: number | null
    outputCostPerMillionTokens?: number | null
    maxInputTokens?: number | null
    maxOutputTokens?: number | null
    supportsReasoning?: boolean | null
  } | null
}

type ModelCardResponse = { aifactory?: { models?: ModelCard[] } | null }

function modelCardsRequestInit(apiKey?: string) {
  if (!apiKey?.trim()) return { cache: "no-store", signal: AbortSignal.timeout(3000) } satisfies RequestInit
  return {
    cache: "no-store",
    headers: { [AIFACTORY_API_KEY_HEADER]: apiKey.trim() },
    signal: AbortSignal.timeout(3000),
  } satisfies RequestInit
}

export const SettingsModelsV2: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const platform = usePlatform()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const [store, setStore] = persisted(
    Persist.serverGlobal(serverSdk().scope, "settings-v2.models.providers"),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  const updateBaseUrl = (import.meta.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode")
    .trim()
    .replace(/\/+$/, "")
  const aifactoryApiKey = () => {
    const key = serverSync().data.config.provider?.[AIFACTORY_PROVIDER_ID]?.options?.apiKey
    return typeof key === "string" && key.trim() ? key.trim() : undefined
  }
  const [modelcards] = createResource(
    () => ({ baseUrl: updateBaseUrl, apiKey: aifactoryApiKey() }),
    (input) =>
      (platform.fetch ?? fetch)(`${input.baseUrl}/modelcards.json`, modelCardsRequestInit(input.apiKey))
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null) ?? null,
    { initialValue: null as ModelCardResponse | null },
  )
  const cards = () =>
    (modelcards()?.aifactory?.models ?? []).filter((card: ModelCard) =>
      models.policyVisible({ providerID: AIFACTORY_PROVIDER_ID, modelID: card.model }),
    )

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.manageable().filter((item) => item.provider.id === AIFACTORY_PROVIDER_ID),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
    },
  })

  const formatNumber = (value?: number | null) =>
    value === undefined || value === null ? "n/a" : new Intl.NumberFormat("de-DE").format(value)
  const formatBoolean = (value?: boolean | null) =>
    value === undefined || value === null ? "n/a" : value ? "yes" : "no"
  const formatMoney = (value?: number | null) =>
    value === undefined || value === null
      ? "n/a"
      : new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "EUR",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value)

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
              {(group) => {
                const searching = () => list.filter().length > 0
                const expanded = () => searching() || !store.collapsed[group.category]

                return (
                  <div
                    class="settings-v2-section"
                    data-component="settings-models-provider"
                    data-expanded={expanded() ? "" : undefined}
                  >
                    <h3 class="settings-v2-models-group-header">
                      <button
                        type="button"
                        class="settings-v2-models-group-trigger"
                        aria-expanded={expanded()}
                        disabled={searching()}
                        onClick={() => setStore("collapsed", group.category, expanded())}
                      >
                        <span class="settings-v2-models-group-chevron">
                          <Show
                            when={expanded()}
                            fallback={
                              <svg width="5" height="6" viewBox="0 0 5 6" fill="none" aria-hidden="true">
                                <path
                                  d="M0.75194 5.31663C0.41861 5.51103 0 5.27063 0 4.88473V0.500754C0 0.114854 0.41861 -0.125577 0.75194 0.0688635L4.5096 2.26084C4.8404 2.45378 4.8404 2.93168 4.5096 3.12462L0.75194 5.31663Z"
                                  fill="currentColor"
                                />
                              </svg>
                            }
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <path
                                d="M5.37624 6.75194C5.18184 6.41861 5.42224 6 5.80814 6H10.1921C10.578 6 10.8184 6.41861 10.624 6.75194L8.43203 10.5096C8.23909 10.8404 7.76119 10.8404 7.56825 10.5096L5.37624 6.75194Z"
                                fill="currentColor"
                              />
                            </svg>
                          </Show>
                        </span>
                        <span class="settings-v2-models-group-label">
                          <ProviderIcon
                            id={group.category}
                            width={PROVIDER_ICON_SIZE}
                            height={PROVIDER_ICON_SIZE}
                            class="settings-v2-models-provider-icon shrink-0"
                          />
                          <span class="settings-v2-section-title">{group.items[0].provider.name}</span>
                        </span>
                      </button>
                    </h3>
                    <Show when={expanded()}>
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
                    </Show>
                  </div>
                )
              }}
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
                        <strong>
                          {formatNumber(card.context ?? card.config?.context ?? card.liteLLM?.maxInputTokens)}
                        </strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Output</small>
                        <strong>
                          {formatNumber(card.output ?? card.config?.output ?? card.liteLLM?.maxOutputTokens)}
                        </strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Thinking</small>
                        <strong>
                          {formatBoolean(card.reasoning ?? card.config?.reasoning ?? card.liteLLM?.supportsReasoning)}
                        </strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Input Cost /1M</small>
                        <strong>{formatMoney(card.price?.input ?? card.liteLLM?.inputCostPerMillionTokens)}</strong>
                      </div>
                      <div class="settings-v2-modelcard-item">
                        <small>Output Cost /1M</small>
                        <strong>{formatMoney(card.price?.output ?? card.liteLLM?.outputCostPerMillionTokens)}</strong>
                      </div>
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
