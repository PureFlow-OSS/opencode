import type { Component, JSX } from "solid-js"
import { createMemo, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { iconNames, type IconName } from "./provider-icons/types"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const aiFactory = createMemo(() => local.id === "aifactory")
  const resolved = createMemo(() => (iconNames.includes(local.id as IconName) ? local.id : "synthetic"))
  if (aiFactory()) {
    return (
      <svg
        data-component="provider-icon"
        viewBox="0 0 48 48"
        aria-label="RRZ AI Factory"
        {...rest}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        <rect width="48" height="48" rx="10" fill="#F5C400" />
        <text
          x="50%"
          y="50%"
          text-anchor="middle"
          dominant-baseline="central"
          fill="#111111"
          font-size="34"
          font-weight="700"
          font-family="Arial, Helvetica, sans-serif"
        >
          R
        </text>
      </svg>
    )
  }
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${resolved()}`} />
    </svg>
  )
}
