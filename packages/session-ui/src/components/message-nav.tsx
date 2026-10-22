import type { FileDiffInfo, SessionMessageUser } from "@opencode/client/promise"
import { HoverCard } from "@kobalte/core/hover-card"
import { ComponentProps, For, Match, Show, createMemo, createUniqueId, splitProps, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useI18n } from "@opencode/ui/context/i18n"

export function MessageNav(
  props: ComponentProps<"ul"> & {
    messages: SessionMessageUser[]
    current?: SessionMessageUser
    size: "normal" | "compact"
    onMessageSelect: (message: SessionMessageUser) => void
    getLabel?: (message: SessionMessageUser) => string | undefined
    getPreview?: (message: SessionMessageUser) => string | undefined
    getChanges?: (message: SessionMessageUser) => FileDiffInfo[] | undefined
  },
) {
  const i18n = useI18n()

  const [local, others] = splitProps(props, [
    "messages",
    "current",
    "size",
    "onMessageSelect",
    "getLabel",
    "getPreview",
    "getChanges",
    "class",
  ])

  const [state, setState] = createStore<{
    open: boolean
    message?: SessionMessageUser
    anchor?: HTMLButtonElement
  }>({ open: false })

  const previewID = createUniqueId()

  const anchorRect = createMemo(() => {
    const anchor = state.anchor

    return () => anchor?.getBoundingClientRect()
  })

  const selectMessage = (message: SessionMessageUser) => {
    setState("open", false)
    local.onMessageSelect(message)
  }

  const content = (className?: string) => (
    <ul
      role="list"
      data-component="message-nav"
      data-size={local.size}
      class={className}
      style={{ "--message-nav-count": local.messages.length }}
      {...others}
    >
      <For each={local.messages}>
        {(message) => {
          const handleClick = () => selectMessage(message)

          return (
            <li data-slot="message-nav-item">
              <Switch>
                <Match when={local.size === "compact"}>
                  <button
                    type="button"
                    data-slot="message-nav-tick-button"
                    data-active={message.id === local.current?.id || undefined}
                    aria-label={local.getLabel?.(message) || i18n.t("ui.messageNav.newMessage")}
                    aria-current={message.id === local.current?.id || undefined}
                    aria-describedby={state.open && state.message?.id === message.id ? previewID : undefined}
                    onClick={handleClick}
                    onPointerEnter={(event) => setState({ message, anchor: event.currentTarget })}
                    onFocus={(event) => setState({ message, anchor: event.currentTarget, open: true })}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setState("open", false)

                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      event.stopPropagation()
                      selectMessage(message)
                    }}
                  >
                    <div data-slot="message-nav-tick-line" />
                  </button>
                </Match>
                <Match when={local.size === "normal"}>
                  <button
                    data-slot="message-nav-message-button"
                    aria-current={message.id === local.current?.id || undefined}
                    onClick={handleClick}
                    type="button"
                  >
                    <MessageDiffBars changes={local.getChanges?.(message) ?? []} />
                    <div
                      data-slot="message-nav-title-preview"
                      data-active={message.id === local.current?.id || undefined}
                    >
                      <Show when={local.getLabel?.(message)} fallback={i18n.t("ui.messageNav.newMessage")}>
                        {local.getLabel?.(message)}
                      </Show>
                    </div>
                  </button>
                </Match>
              </Switch>
            </li>
          )
        }}
      </For>
    </ul>
  )

  return (
    <Switch>
      <Match when={local.size === "compact"}>
        <HoverCard
          open={state.open && !!state.message}
          onOpenChange={(open) => setState("open", open)}
          openDelay={120}
          closeDelay={120}
          placement="right"
          getAnchorRect={anchorRect()}
          gutter={8}
          overflowPadding={24}
          fitViewport
        >
          <HoverCard.Trigger as="div" data-component="message-nav-hovercard" class={local.class}>
            {content()}
          </HoverCard.Trigger>
          <HoverCard.Portal>
            <HoverCard.Content id={previewID} data-slot="message-nav-hovercard-content">
              <Show when={state.message} keyed>
                {(message) => (
                  <button
                    type="button"
                    data-slot="message-nav-preview-button"
                    aria-label={local.getLabel?.(message) || i18n.t("ui.messageNav.newMessage")}
                    onClick={() => selectMessage(message)}
                  >
                    <div data-slot="message-nav-preview-title">
                      {local.getLabel?.(message) || i18n.t("ui.messageNav.newMessage")}
                    </div>
                    <Show when={local.getPreview?.(message)}>
                      {(preview) => <div data-slot="message-nav-preview-body">{preview()}</div>}
                    </Show>
                  </button>
                )}
              </Show>
            </HoverCard.Content>
          </HoverCard.Portal>
        </HoverCard>
      </Match>
      <Match when={local.size === "normal"}>{content(local.class)}</Match>
    </Switch>
  )
}

function MessageDiffBars(props: { changes: { additions: number; deletions: number }[] }) {
  const additions = createMemo(() => props.changes.reduce((total, diff) => total + diff.additions, 0))
  const deletions = createMemo(() => props.changes.reduce((total, diff) => total + diff.deletions, 0))

  const colors = createMemo(() => {
    const added = additions()
    const deleted = deletions()

    if (added === 0 && deleted === 0) return Array(5).fill("var(--icon-weak-base)")

    if (added + deleted < 5) {
      return [
        ...Array(added > 0 ? 1 : 0).fill("var(--icon-diff-add-base)"),
        ...Array(deleted > 0 ? 1 : 0).fill("var(--icon-diff-delete-base)"),
        ...Array(5 - (added > 0 ? 1 : 0) - (deleted > 0 ? 1 : 0)).fill("var(--icon-weak-base)"),
      ]
    }

    const total = added + deleted
    const ratio = added > deleted ? added / deleted : deleted / added
    const colored = total < 20 || ratio < 4 ? 4 : 5
    const addedRaw = (added / total) * colored
    const deletedRaw = (deleted / total) * colored

    const addedBars =
      added === 0 ? 0 : Math.min(added <= 5 ? 1 : added <= 10 ? 2 : colored, Math.max(1, Math.round(addedRaw)))

    const deletedBars =
      deleted === 0 ? 0 : Math.min(deleted <= 5 ? 1 : deleted <= 10 ? 2 : colored, Math.max(1, Math.round(deletedRaw)))

    const overflow = Math.max(0, addedBars + deletedBars - colored)
    const adjustedAdded = overflow > 0 && addedRaw > deletedRaw ? addedBars - overflow : addedBars
    const adjustedDeleted = overflow > 0 && addedRaw <= deletedRaw ? deletedBars - overflow : deletedBars

    return [
      ...Array(adjustedAdded).fill("var(--icon-diff-add-base)"),
      ...Array(adjustedDeleted).fill("var(--icon-diff-delete-base)"),
      ...Array(5 - adjustedAdded - adjustedDeleted).fill("var(--icon-weak-base)"),
    ]
  })

  return (
    <svg data-slot="message-nav-diff-bars" viewBox="0 0 18 14" aria-hidden="true">
      <For each={colors().slice(0, 5)}>
        {(color, index) => <rect x={index() * 4} width="2" height="14" rx="1" fill={color} />}
      </For>
    </svg>
  )
}
