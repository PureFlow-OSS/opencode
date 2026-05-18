import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Component, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"

type ModelState = ReturnType<typeof useLocal>["model"]

export const DialogSelectModelUnpaid: Component<{ model?: ModelState }> = (props) => {
  const model = props.model ?? useLocal().model
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()
  const items = () => model.list().filter((item) => model.visible({ modelID: item.id, providerID: item.provider.id }))
  const connectable = () => {
    const connected = new Set(providers.connected().map((item) => item.id))
    return providers.popular().filter((item) => !connected.has(item.id))
  }

  const connect = (provider: string) => {
    void import("./dialog-connect-provider").then((x) => {
      dialog.show(() => <x.DialogConnectProvider provider={provider} />)
    })
  }

  let listRef: ListRef | undefined
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      class="overflow-y-auto [&_[data-slot=dialog-body]]:overflow-visible [&_[data-slot=dialog-body]]:flex-none"
    >
      <div class="flex flex-col gap-3 px-2.5" onKeyDown={handleKeyDown}>
        <List
          class="[&_[data-slot=list-scroll]]:overflow-visible"
          ref={(ref) => (listRef = ref)}
          items={items}
          current={model.current()}
          key={(x) => `${x.provider.id}:${x.id}`}
          itemWrapper={(item, node) => (
            <Tooltip
              class="w-full"
              placement="right-start"
              gutter={12}
              value={
                <ModelTooltip
                  model={item}
                  latest={item.latest}
                  free={item.provider.id === "opencode" && (!item.cost || item.cost.input === 0)}
                />
              }
            >
              {node}
            </Tooltip>
          )}
          onSelect={(x) => {
            void model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
              recent: true,
            })
            dialog.close()
          }}
        >
          {(i) => (
            <div class="w-full flex items-center gap-x-2.5">
              <ProviderIcon id={i.provider.id} class="size-4 shrink-0 icon-strong-base" />
              <span>{i.name}</span>
              <Show when={i.latest}>
                <Tag>{language.t("model.tag.latest")}</Tag>
              </Show>
            </div>
          )}
        </List>
      </div>
      <div class="px-1.5 pb-1.5">
        <div class="w-full rounded-sm border border-border-weak-base bg-surface-raised-base">
          <div class="w-full flex flex-col items-start gap-4 px-1.5 pt-4 pb-4">
            <div class="px-2 text-14-medium text-text-base">{language.t("dialog.model.unpaid.addMore.title")}</div>
            <div class="w-full">
              <List
                class="w-full px-0"
                key={(x) => x?.id}
                items={connectable}
                activeIcon="plus-small"
                sortBy={(a, b) => {
                  if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
                    return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
                  return a.name.localeCompare(b.name)
                }}
                onSelect={(x) => {
                  if (!x) return
                  connect(x.id)
                }}
              >
                {(i) => (
                  <div class="w-full flex items-center gap-x-3">
                    <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
                    <span>{i.name}</span>
                    <Show when={i.id === "aifactory"}>
                      <div class="text-14-regular text-text-weak">AI Modelle der RRZ AI Factory</div>
                    </Show>
                    <Show when={popularProviders.includes(i.id)}>
                      <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                    </Show>
                    <Show when={i.id.startsWith("github-copilot")}>
                      <div class="text-14-regular text-text-weak">{language.t("dialog.provider.copilot.note")}</div>
                    </Show>
                  </div>
                )}
              </List>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
