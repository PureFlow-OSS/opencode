export * as BackgroundServiceEnvironment from "./background-service-environment"

declare const OPENCODE_UPDATE_BASE_URL: string | undefined

export function make(input: { readonly runtime?: string; readonly embedded?: string }) {
  const updater = input.runtime?.trim() || input.embedded?.trim()

  return updater ? { OPENCODE_UPDATE_BASE_URL: updater } : undefined
}

export function fromProcess() {
  return make({
    runtime: process.env.OPENCODE_UPDATE_BASE_URL,
    // SAFETY: the build replaces this string constant, while direct source tests have no binding to read.
    // eslint-disable-next-line anti-slop/no-runtime-typeof
    embedded: typeof OPENCODE_UPDATE_BASE_URL === "string" ? OPENCODE_UPDATE_BASE_URL : undefined,
  })
}
