import { createResource } from "solid-js"
import { useGlobalSync } from "./global-sync"
import { usePlatform } from "./platform"

const UPDATE_SERVER_BASE_URL = (import.meta.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode")
  .trim()
  .replace(/\/+$/, "")
const BETA_STATUS_URL = `${UPDATE_SERVER_BASE_URL}/admin/beta/status`
const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

export function useBetaTester() {
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const [status] = createResource(
    () => {
      const key = globalSync().data.config.provider?.["aifactory"]?.options?.apiKey
      return typeof key === "string" && key.trim() ? key.trim() : undefined
    },
    async (apiKey) => {
      if (!apiKey) return false
      const response = await (platform.fetch ?? fetch)(BETA_STATUS_URL, {
        cache: "no-store",
        headers: { [AIFACTORY_API_KEY_HEADER]: apiKey },
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined)
      if (!response?.ok) return false
      const payload: unknown = await response.json().catch(() => undefined)
      return typeof payload === "object" && payload !== null && "betaTester" in payload && payload.betaTester === true
    },
    { initialValue: false },
  )

  return () => (typeof window !== "undefined" && window.__OPENCODE__?.betaTester === true) || status() === true
}
