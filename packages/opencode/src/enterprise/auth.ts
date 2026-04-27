import { createHash, randomBytes } from "crypto"
import open from "open"
import { Log } from "../util"
import { Auth } from "../auth"
import { Effect, Context, Layer, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { OAUTH_CALLBACK_PORT, ENTERPRISE_OAUTH_CALLBACK_PATH } from "../mcp/oauth-provider"
import { ensureRunning, waitForCallback } from "../mcp/oauth-callback"

const log = Log.create({ service: "enterprise.auth" })

const ENTERPRISE_AUTH_KEY = "enterprise"
const MODELS_CACHE_FILE = path.join(Global.Path.data, "enterprise-models.json")

export class OidcDiscovery extends Schema.Class<OidcDiscovery>("OidcDiscovery")({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
}) {}

export class EnterpriseTokens extends Schema.Class<EnterpriseTokens>("EnterpriseTokens")({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_at: Schema.optional(Schema.Number),
  token_type: Schema.optional(Schema.String),
}) {}

export class ConnectInput extends Schema.Class<ConnectInput>("EnterpriseConnectInput")({
  litellm_url: Schema.String,
  keycloak_url: Schema.String,
  client_id: Schema.optional(Schema.String),
  kes_url: Schema.optional(Schema.String),
}) {}

export interface EnterpriseModel {
  id: string
  name?: string
}

export interface Interface {
  readonly connect: (input: ConnectInput) => Effect.Effect<void, Error>
  readonly disconnect: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<{ connected: boolean; user?: string; models?: EnterpriseModel[] }>
  readonly getToken: () => Effect.Effect<string | undefined, Error>
  readonly getCachedModels: () => Effect.Effect<EnterpriseModel[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EnterpriseAuth") {}

function generatePKCE() {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

function generateState() {
  return randomBytes(16).toString("hex")
}

async function fetchOidcDiscovery(keycloakUrl: string): Promise<OidcDiscovery> {
  const wellKnown = `${keycloakUrl.replace(/\/$/, "")}/.well-known/openid-configuration`
  const res = await fetch(wellKnown)
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`)
  const data = await res.json()
  return Schema.decodeUnknownSync(OidcDiscovery)(data)
}

async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  verifier: string,
  clientId: string,
  redirectUri: string,
): Promise<EnterpriseTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  })
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
    token_type: data.token_type ?? "Bearer",
  }
}

async function refreshAccessToken(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string,
): Promise<EnterpriseTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Token refresh failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
    token_type: data.token_type ?? "Bearer",
  }
}

// Exchange a Keycloak JWT for a LiteLLM API key via the Key Exchange Server
async function kesExchange(kesUrl: string, keycloakJwt: string): Promise<string> {
  const res = await fetch(`${kesUrl.replace(/\/$/, "")}/exchange`, {
    method: "POST",
    headers: { Authorization: `Bearer ${keycloakJwt}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`KES exchange failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  if (!data.litellm_key) throw new Error("KES returned no litellm_key")
  return data.litellm_key as string
}

async function fetchModels(litellmUrl: string, apiKey: string): Promise<EnterpriseModel[]> {
  const res = await fetch(`${litellmUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`/models fetch failed: ${res.status}`)
  const data = await res.json()
  const items: { id: string }[] = data?.data ?? []
  return items.map((m) => ({ id: m.id }))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const fsys = yield* AppFileSystem.Service

    const connect = Effect.fn("EnterpriseAuth.connect")(function* (input: ConnectInput) {
      const clientId = input.client_id ?? "opencode"
      const redirectUri = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${ENTERPRISE_OAUTH_CALLBACK_PATH}`

      log.info("starting enterprise OIDC connect", {
        keycloak: input.keycloak_url,
        clientId,
        kes: input.kes_url ?? "none",
      })

      const discovery = yield* Effect.tryPromise({
        try: () => fetchOidcDiscovery(input.keycloak_url),
        catch: (e) => new Error(`OIDC discovery: ${e}`),
      })

      const { verifier, challenge } = generatePKCE()
      const state = generateState()

      const authUrl = new URL(discovery.authorization_endpoint)
      authUrl.searchParams.set("client_id", clientId)
      authUrl.searchParams.set("redirect_uri", redirectUri)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("code_challenge", challenge)
      authUrl.searchParams.set("code_challenge_method", "S256")
      authUrl.searchParams.set("state", state)
      authUrl.searchParams.set("scope", "openid profile email offline_access")

      yield* Effect.tryPromise({
        try: () => ensureRunning(),
        catch: (e) => new Error(`Callback server start failed: ${e}`),
      })

      log.info("opening browser for enterprise auth", { url: authUrl.toString() })
      yield* Effect.tryPromise({
        try: () => open(authUrl.toString()),
        catch: (e) => new Error(`Browser open failed: ${e}`),
      })

      const code = yield* Effect.tryPromise({
        try: () => waitForCallback(state, "enterprise"),
        catch: (e) => new Error(`OAuth callback failed: ${e}`),
      })

      const tokens = yield* Effect.tryPromise({
        try: () => exchangeCode(discovery.token_endpoint, code, verifier, clientId, redirectUri),
        catch: (e) => new Error(`Token exchange: ${e}`),
      })

      // If KES URL is configured, exchange the Keycloak JWT for a LiteLLM key
      let litellmKey: string | undefined
      if (input.kes_url) {
        log.info("exchanging Keycloak JWT for LiteLLM key via KES")
        litellmKey = yield* Effect.tryPromise({
          try: () => kesExchange(input.kes_url!, tokens.access_token),
          catch: (e) => new Error(`KES exchange: ${e}`),
        })
        log.info("KES exchange successful")
      }

      yield* auth.set(ENTERPRISE_AUTH_KEY, {
        type: "api",
        // Store the Keycloak JWT as the primary key for refresh purposes
        key: tokens.access_token,
        metadata: {
          refresh_token: tokens.refresh_token ?? "",
          expires_at: String(tokens.expires_at ?? ""),
          token_endpoint: discovery.token_endpoint,
          client_id: clientId,
          litellm_url: input.litellm_url,
          keycloak_url: input.keycloak_url,
          kes_url: input.kes_url ?? "",
          // The actual key used for LiteLLM API calls
          litellm_key: litellmKey ?? "",
        },
      })

      log.info("enterprise auth stored, fetching models")

      const apiKeyForModels = litellmKey ?? tokens.access_token
      const models = yield* Effect.tryPromise({
        try: () => fetchModels(input.litellm_url, apiKeyForModels),
        catch: (e) => new Error(`fetchModels: ${e}`),
      }).pipe(Effect.orElseSucceed(() => [] as EnterpriseModel[]))

      yield* fsys.writeJson(MODELS_CACHE_FILE, models, 0o600).pipe(Effect.orDie)
      log.info("enterprise models cached", { count: models.length })
    })

    const disconnect = Effect.fn("EnterpriseAuth.disconnect")(function* () {
      yield* auth.remove(ENTERPRISE_AUTH_KEY).pipe(Effect.orDie)
      yield* fsys.writeJson(MODELS_CACHE_FILE, [], 0o600).pipe(Effect.orDie)
      log.info("enterprise auth disconnected")
    })

    const getToken = Effect.fn("EnterpriseAuth.getToken")(function* () {
      const stored = yield* auth.get(ENTERPRISE_AUTH_KEY)
      if (!stored || stored.type !== "api") return undefined

      const kesUrl = stored.metadata?.kes_url
      const litellmKey = stored.metadata?.litellm_key
      const expiresAt = stored.metadata?.expires_at ? Number(stored.metadata.expires_at) : undefined
      const refreshToken = stored.metadata?.refresh_token
      const tokenEndpoint = stored.metadata?.token_endpoint
      const clientId = stored.metadata?.client_id ?? "opencode"
      const litellmUrl = stored.metadata?.litellm_url ?? ""

      // Keycloak JWT still valid — return the appropriate key
      if (expiresAt && Date.now() / 1000 < expiresAt - 60) {
        return litellmKey || stored.key
      }

      // No refresh token — return what we have
      if (!refreshToken || !tokenEndpoint) return litellmKey || stored.key

      log.info("access token expired, refreshing via Keycloak")
      const tokens = yield* Effect.tryPromise({
        try: () => refreshAccessToken(tokenEndpoint, refreshToken, clientId),
        catch: (e) => new Error(`Refresh failed: ${e}`),
      })

      // Re-exchange with KES if configured
      let newLitellmKey = litellmKey
      if (kesUrl) {
        log.info("re-exchanging refreshed JWT with KES")
        newLitellmKey = yield* Effect.tryPromise({
          try: () => kesExchange(kesUrl, tokens.access_token),
          catch: (e) => new Error(`KES re-exchange failed: ${e}`),
        })
      }

      yield* auth.set(ENTERPRISE_AUTH_KEY, {
        type: "api",
        key: tokens.access_token,
        metadata: {
          refresh_token: tokens.refresh_token ?? refreshToken,
          expires_at: String(tokens.expires_at ?? ""),
          token_endpoint: tokenEndpoint,
          client_id: clientId,
          litellm_url: litellmUrl,
          keycloak_url: stored.metadata?.keycloak_url ?? "",
          kes_url: kesUrl ?? "",
          litellm_key: newLitellmKey ?? "",
        },
      })

      void fetchModels(litellmUrl, newLitellmKey ?? tokens.access_token)
        .then((models) => Effect.runPromise(fsys.writeJson(MODELS_CACHE_FILE, models, 0o600).pipe(Effect.orDie)))
        .catch(() => undefined)

      return newLitellmKey ?? tokens.access_token
    })

    const getCachedModels = Effect.fn("EnterpriseAuth.getCachedModels")(function* () {
      const data = yield* fsys.readJson(MODELS_CACHE_FILE).pipe(Effect.orElseSucceed(() => []))
      return data as EnterpriseModel[]
    })

    const status = Effect.fn("EnterpriseAuth.status")(function* () {
      const stored = yield* auth.get(ENTERPRISE_AUTH_KEY).pipe(Effect.orDie)
      if (!stored || stored.type !== "api") return { connected: false as const }
      const models = yield* getCachedModels()
      return { connected: true as const, models }
    })

    return Service.of({ connect, disconnect, getToken, getCachedModels, status })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Auth.defaultLayer), Layer.provide(AppFileSystem.defaultLayer))

export * as EnterpriseAuth from "./auth"
