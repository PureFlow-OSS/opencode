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
  if (!modelID) return items.find((item) => item.modelID === configured)
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
  configured?: { providerID: string; modelID: string }
  visible: (model: ModelKey) => boolean
}) {
  const result = new Set<string>()
  for (const item of input.defaults) {
    if (input.items.some((candidate) => candidate.providerID === item.providerID && candidate.modelID === item.modelID)) {
      result.add(modelKey(item))
    }
  }
  if (input.configured) result.add(modelKey(input.configured))
  if (result.size > 0) return result
  const fallback = input.items.find((item) => !/embedding/i.test(item.modelID))
  if (fallback) result.add(modelKey(fallback))
  return result
}
