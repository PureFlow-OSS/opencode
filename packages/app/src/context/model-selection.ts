import { DateTime } from "luxon"

export type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"

export function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

function sameModel(a: ModelKey, b: ModelKey) {
  return a.providerID === b.providerID && a.modelID === b.modelID
}

export function resolveConfiguredModelKey(configured: string | undefined, items: readonly ModelKey[]) {
  if (!configured) return
  if (configured.includes("/")) {
    const [providerID, modelID] = configured.split("/")
    return items.find((item) => item.providerID === providerID && item.modelID === modelID)
  }
  const matches = items.filter((item) => item.modelID === configured)
  return matches.find((item) => item.providerID === "aifactory") ?? matches[0]
}

export function isModelVisibleBase(input: {
  model: ModelKey
  latest: ReadonlySet<string>
  release: ReadonlyMap<string, DateTime>
  visibility: ReadonlyMap<string, Visibility>
  policy?: boolean
}) {
  const key = modelKey(input.model)
  if (input.policy === false) return false
  const state = input.visibility.get(key)
  if (state === "hide") return false
  if (state === "show") return true
  if (input.policy === true) return true
  if (input.latest.has(key)) return true
  const date = input.release.get(key)
  if (!date?.isValid) return true
  return false
}

export function computeForcedVisibleModelKeys(input: {
  items: readonly ModelKey[]
  defaults: readonly ModelKey[]
  configured?: ModelKey
  visible: (model: ModelKey) => boolean
}) {
  const configured = input.configured ? [input.configured] : []
  const preferred = [...configured, ...input.defaults].filter((item, index, list) => {
    if (!input.items.some((candidate) => sameModel(candidate, item))) return false
    return list.findIndex((candidate) => sameModel(candidate, item)) === index
  })
  const fallback = input.items.some(input.visible) || preferred.length > 0 ? [] : input.items.slice(0, 1)
  return new Set([...preferred, ...fallback].map(modelKey))
}
