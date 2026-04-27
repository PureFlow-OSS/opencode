import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, createResource, createSignal, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { SettingsList } from "./settings-list"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
] as const

const EnterpriseSection: Component = () => {
  const globalSDK = useGlobalSDK()
  const [litellmUrl, setLitellmUrl] = createSignal("")
  const [keycloakUrl, setKeycloakUrl] = createSignal("")
  const [clientId, setClientId] = createSignal("")
  const [connecting, setConnecting] = createSignal(false)

  const [status, { refetch }] = createResource(async () => {
    const res = await globalSDK.client.global.enterprise.auth.status()
    return res.data
  })

  const connect = async () => {
    if (!litellmUrl() || !keycloakUrl()) {
      showToast({ title: "LiteLLM URL and Keycloak URL are required" })
      return
    }
    setConnecting(true)
    try {
      await globalSDK.client.global.enterprise.auth.connect({
        litellm_url: litellmUrl(),
        keycloak_url: keycloakUrl(),
        client_id: clientId() || undefined,
      }, { throwOnError: true })
      await globalSDK.client.global.dispose()
      await refetch()
      showToast({ variant: "success", icon: "circle-check", title: "Connected to enterprise" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: "Connection failed", description: message })
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    await globalSDK.client.global.enterprise.auth.delete()
    await globalSDK.client.global.dispose()
    await refetch()
    showToast({ variant: "success", icon: "circle-check", title: "Disconnected from enterprise" })
  }

  return (
    <div class="flex flex-col gap-4 max-w-[720px]">
      <h3 class="text-14-medium text-text-strong">Enterprise (LiteLLM + Keycloak SSO)</h3>
      <Show
        when={status()?.connected}
        fallback={
          <SettingsList>
            <div class="flex flex-col gap-3 py-4">
              <div class="flex flex-col gap-1">
                <label class="text-12-regular text-text-weak">LiteLLM URL</label>
                <input
                  class="rounded border border-border-weak-base bg-surface-base px-3 py-2 text-14-regular text-text-strong focus:outline-none focus:ring-1 focus:ring-border-base"
                  placeholder="https://litellm.corp.com"
                  value={litellmUrl()}
                  onInput={(e) => setLitellmUrl(e.currentTarget.value)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-12-regular text-text-weak">Keycloak Realm URL</label>
                <input
                  class="rounded border border-border-weak-base bg-surface-base px-3 py-2 text-14-regular text-text-strong focus:outline-none focus:ring-1 focus:ring-border-base"
                  placeholder="https://keycloak.corp.com/realms/corp"
                  value={keycloakUrl()}
                  onInput={(e) => setKeycloakUrl(e.currentTarget.value)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-12-regular text-text-weak">Client ID (optional, default: opencode)</label>
                <input
                  class="rounded border border-border-weak-base bg-surface-base px-3 py-2 text-14-regular text-text-strong focus:outline-none focus:ring-1 focus:ring-border-base"
                  placeholder="opencode"
                  value={clientId()}
                  onInput={(e) => setClientId(e.currentTarget.value)}
                />
              </div>
              <Button
                size="large"
                variant="secondary"
                onClick={() => void connect()}
                disabled={connecting()}
              >
                {connecting() ? "Opening browser..." : "Connect via SSO"}
              </Button>
            </div>
          </SettingsList>
        }
      >
        <SettingsList>
          <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3">
            <div class="flex items-center gap-3">
              <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
              <span class="text-14-medium text-text-strong">Enterprise (LiteLLM)</span>
              <Tag>SSO</Tag>
              <Show when={status()?.models?.length}>
                {(count) => (
                  <span class="text-12-regular text-text-weak">{count()} models</span>
                )}
              </Show>
            </div>
            <Button size="large" variant="ghost" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        </SettingsList>
      </Show>
    </div>
  )
}

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const providers = useProviders()

  const connected = createMemo(() => {
    return providers.connected()
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") return language.t("settings.providers.tag.config")
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => source(item) !== "env"

  const note = (id: string) =>
    id === "aifactory" ? "OpenAI-compatible models from Ai-Factory" : PROVIDER_NOTES.find((item) => item.match(id))?.key

  const disconnect = async (providerID: string, name: string) => {
    await globalSDK.client.auth
      .remove({ providerID })
      .then(async () => {
        await globalSDK.client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.providers.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <EnterpriseSection />

        <div class="flex flex-col gap-1" data-component="connected-providers-section">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex items-center gap-3 min-w-0">
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                      <Tag>{type(item)}</Tag>
                    </div>
                    <Show
                      when={canDisconnect(item)}
                      fallback={
                        <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
                          {language.t("settings.providers.connected.environmentDescription")}
                        </span>
                      }
                    >
                      <Button size="large" variant="ghost" onClick={() => void disconnect(item.id, item.name)}>
                        {language.t("common.disconnect")}
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList>
            <For each={popular()}>
              {(item) => (
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-x-3">
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{item.name}</span>
                      <Show when={popularProviders.includes(item.id)}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                    </div>
                    <Show when={note(item.id)}>
                      {(key) => (
                        <span class="text-12-regular text-text-weak pl-8">
                          {key().startsWith("dialog.") ? language.t(key()) : key()}
                        </span>
                      )}
                    </Show>
                  </div>
                  <Button
                    size="large"
                    variant="secondary"
                    icon="plus-small"
                    onClick={() => {
                      dialog.show(() => <DialogConnectProvider provider={item.id} />)
                    }}
                  >
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}
