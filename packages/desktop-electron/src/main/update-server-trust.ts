const DEFAULT_UPDATE_SERVER_BASE_URL = "http://10.53.7.23/opencode"

const UPDATE_SERVER_BASE_URL =
  process.env.OPENCODE_UPDATE_BASE_URL ?? import.meta.env.OPENCODE_UPDATE_BASE_URL ?? DEFAULT_UPDATE_SERVER_BASE_URL

function baseUrl() {
  try {
    return new URL(UPDATE_SERVER_BASE_URL)
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

  if (input instanceof URL) {
    return input.protocol === "https:" && input.hostname === trusted.hostname
  }

  if (!input.includes("://")) return input === trusted.hostname

  const url = new URL(input)
  return url.protocol === "https:" && url.hostname === trusted.hostname
}
