const DEFAULT_UPDATE_SERVER_BASE_URL = "http://10.53.7.23/opencode"

function baseUrl() {
  try {
    return new URL(process.env.OPENCODE_UPDATE_BASE_URL ?? DEFAULT_UPDATE_SERVER_BASE_URL)
  } catch {
    return new URL(DEFAULT_UPDATE_SERVER_BASE_URL)
  }
}

export function updateServerBaseUrl() {
  return baseUrl().toString().replace(/\/+$/, "")
}

export function shouldTrustUpdateServerCertificate(input: string | URL) {
  const trusted = baseUrl()
  if (trusted.protocol !== "https:") return false
  const url = input instanceof URL ? input : new URL(input.includes("://") ? input : `https://${input}`)
  return url.protocol === "https:" && url.hostname === trusted.hostname
}
