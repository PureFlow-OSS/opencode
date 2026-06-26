import { type Accessor } from "solid-js"
import type { ModelKey } from "./local"

export function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

export function resolveConfiguredModelKey(
  configured: string | undefined,
  items: Array<{ providerID: string; modelID: string }>,
) {
  if (!configured) return undefined
  const [providerID, ...rest] = configured.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return undefined
  return items.find((item) => item.providerID === providerID && item.modelID === modelID)
}

export function isModelVisibleBase(input: {
  model: ModelKey
  latest: ReadonlySet<string>
  release: ReadonlyMap<string, { diffNow(): { as(unit: string): number } }>
  visibility: ReadonlyMap<string, "show" | "hide">
  policy?: boolean
}) {
  if (input.policy === false) return false
  const key = modelKey(input.model)
  const forced = input.visibility.get(key)
  if (forced === "show") return true
  if (forced === "hide") return false
  if (input.latest.has(key)) return true
  return input.release.has(key)
}

export function computeForcedVisibleModelKeys(input: {
  items: Array<{ providerID: string; modelID: string }>
  defaults: Array<{ providerID: string; modelID: string }>
  configured: { providerID: string; modelID: string } | undefined
  visible: (model: ModelKey) => boolean
}) {
  const result = new Set<string>()
  for (const item of input.items) {
    const key = modelKey(item)
    if (input.visible(item)) result.add(key)
  }
  for (const item of input.defaults) {
    const key = modelKey(item)
    if (input.visible(item)) result.add(key)
  }
  if (input.configured && input.visible(input.configured)) result.add(modelKey(input.configured))
  return result
}
