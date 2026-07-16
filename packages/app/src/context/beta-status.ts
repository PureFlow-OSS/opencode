import { createResource, createSignal, onCleanup, onMount } from "solid-js"
import { useGlobalSync } from "./global-sync"
import { usePlatform } from "./platform"

const UPDATE_SERVER_BASE_URL = (import.meta.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode")
  .trim()
  .replace(/\/+$/, "")
const BETA_STATUS_URL = `${UPDATE_SERVER_BASE_URL}/admin/beta/status`
const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"
const LOCAL_BETA_CHANNELS = new Set(["dev", "beta"])

export function useBetaTester() {
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const [desktopStatus, setDesktopStatus] = createSignal(
    typeof window !== "undefined" && window.__OPENCODE__?.betaTester === true,
  )
  const [status] = createResource(
    () => {
      const key = globalSync().data.config.provider?.["aifactory"]?.options?.apiKey
      return [typeof key === "string" && key.trim() ? key.trim() : undefined] as const
    },
    async ([apiKey]) => {
      const response = await (platform.fetch ?? fetch)(BETA_STATUS_URL, {
        cache: "no-store",
        ...(apiKey ? { headers: { [AIFACTORY_API_KEY_HEADER]: apiKey } } : {}),
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined)
      if (!response?.ok) return false
      const payload: unknown = await response.json().catch(() => undefined)
      return typeof payload === "object" && payload !== null && "betaTester" in payload && payload.betaTester === true
    },
    { initialValue: false },
  )

  onMount(() => {
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ betaTester?: boolean }>).detail
      setDesktopStatus(detail?.betaTester === true)
    }
    window.addEventListener("opencode:beta-status", handleStatus)
    onCleanup(() => window.removeEventListener("opencode:beta-status", handleStatus))
  })

  return () =>
    LOCAL_BETA_CHANNELS.has(import.meta.env.VITE_OPENCODE_CHANNEL) || desktopStatus() || status() === true
}
