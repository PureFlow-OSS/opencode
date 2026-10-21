export * as BackgroundServiceEnvironment from "./background-service-environment"

declare const OPENCODE_UPDATE_BASE_URL: string | undefined

export function make(input: { readonly runtime?: string; readonly embedded?: string }) {
  const updater = input.runtime?.trim() || input.embedded?.trim()

  return updater ? { OPENCODE_UPDATE_BASE_URL: updater } : undefined
}

export function fromProcess() {
  return make({
    runtime: process.env.OPENCODE_UPDATE_BASE_URL,
    embedded: typeof OPENCODE_UPDATE_BASE_URL === "string" ? OPENCODE_UPDATE_BASE_URL : undefined,
  })
}
