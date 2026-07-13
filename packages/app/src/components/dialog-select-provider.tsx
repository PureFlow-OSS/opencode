import { type Accessor, Component, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useProviders } from "@/hooks/use-providers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { DialogConnectProvider, useProviderConnectController } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"

const CUSTOM_ID = "_custom"
const AIFACTORY_PROVIDER_ID = "aifactory"

export const DialogSelectProvider: Component<{ directory?: Accessor<string | undefined> }> = (props) => {
  const dialog = useDialog()
  const providers = useProviders(props.directory)
  const language = useLanguage()

  const customLabel = () => language.t("settings.providers.tag.custom")

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        class="px-3"
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return [{ id: CUSTOM_ID, name: customLabel() }, ...providers.all().values()].filter(
            (item) => item.id === CUSTOM_ID || item.id === AIFACTORY_PROVIDER_ID,
          )
        }}
        filterKeys={["id", "name"]}
        sortBy={(a, b) => {
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          return a.name.localeCompare(b.name)
        }}
        onSelect={(x) => {
          if (!x) return
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider onBack={() => dialog.show(() => <DialogSelectProvider directory={props.directory} />)} />)
            return
          }
          const controller = useProviderConnectController()
          controller.select(x.id)
          dialog.show(() => <DialogConnectProvider controller={controller} directory={props.directory} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
            <Show when={i.id === AIFACTORY_PROVIDER_ID}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
