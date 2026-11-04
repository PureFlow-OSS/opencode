import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto"

type Claims = {
  badSignature?: boolean
  nonce?: string
  group?: string | string[]
  groups?: string[]
  realm_access?: { roles: string[] }
  iss?: string
  aud?: string
  exp?: number
}

/** Disposable OIDC provider: exercises the real server code flow, PKCE, cookies and CSRF without a test auth bypass. */
export async function keycloak() {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "fixture", use: "sig", alg: "RS256" }
  const grants = new Map<string, { nonce: string; challenge: string; redirect: string; claims: Claims }>()
  const identity: { claims: Claims; signedOut: boolean } = { claims: { group: ["opencodeAdmin"] }, signedOut: false }
  const exchanges: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const issuer = `${url.origin}/realms/test`
      if (url.pathname.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/logout`,
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          code_challenge_methods_supported: ["S256"],
        })
      if (url.pathname.endsWith("/jwks")) return Response.json({ keys: [jwk] })
      if (url.pathname.endsWith("/authorize")) {
        if (identity.signedOut)
          return new Response("<h1>Keycloak sign-in</h1>", { headers: { "content-type": "text/html" } })
        if (
          url.searchParams.get("client_id") !== "opencode-admin" ||
          url.searchParams.get("code_challenge_method") !== "S256"
        )
          return new Response("Invalid client or missing PKCE", { status: 400 })
        const code = randomUUID()
        const redirect = url.searchParams.get("redirect_uri") ?? ""
        grants.set(code, {
          nonce: url.searchParams.get("nonce") ?? "",
          challenge: url.searchParams.get("code_challenge") ?? "",
          redirect,
          claims: identity.claims,
        })
        const callback = new URL(redirect)
        callback.searchParams.set("code", code)
        callback.searchParams.set("state", url.searchParams.get("state") ?? "")
        return Response.redirect(callback.href)
      }
      if (url.pathname.endsWith("/token")) {
        const form = new URLSearchParams(await request.text())
        const code = form.get("code") ?? ""
        const grant = grants.get(code)
        grants.delete(code)
        if (
          !grant ||
          form.get("client_id") !== "opencode-admin" ||
          form.get("client_secret") !== "fixture-secret" ||
          form.get("redirect_uri") !== grant.redirect ||
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") !== grant.challenge
        )
          return Response.json({ error: "invalid_grant" }, { status: 400 })
        exchanges.push(code)
        const now = Math.floor(Date.now() / 1000)
        const payload = Buffer.from(
          JSON.stringify({
            iss: issuer,
            aud: "opencode-admin",
            sub: "fixture-user",
            preferred_username: "Administrator test",
            nonce: grant.nonce,
            iat: now,
            exp: now + 300,
            ...grant.claims,
          }),
        ).toString("base64url")
        const unsigned = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString("base64url")}.${payload}`
        const signingKey = grant.claims.badSignature
          ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
          : keys.privateKey
        const token = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), signingKey).toString("base64url")}`
        return Response.json({ access_token: "fixture-access", id_token: token, expires_in: 300, token_type: "Bearer" })
      }
      if (url.pathname.endsWith("/logout")) {
        identity.signedOut = true
        const callback = new URL(url.searchParams.get("post_logout_redirect_uri")!)
        callback.searchParams.set("state", url.searchParams.get("state") ?? "")
        return Response.redirect(callback.href)
      }
      return new Response("Not found", { status: 404 })
    },
  })
  return {
    exchanges,
    identity(claims: Claims) {
      identity.claims = claims
      identity.signedOut = false
    },
    configuration(base: string) {
      return {
        Authority: `${server.url.origin}/realms/test`,
        ClientId: "opencode-admin",
        ClientSecret: "fixture-secret",
        PublicOrigin: base,
        GroupClaim: "group",
        RequiredGroup: "opencodeAdmin",
        AllowHttpLoopback: true,
      }
    },
    async login(base: string, claims: Claims = { group: ["opencodeAdmin"] }) {
      identity.claims = claims
      identity.signedOut = false
      const cookies = new Map<string, string>()
      const state = { csrf: "" }
      const request = async (route: string, init: RequestInit = {}, csrf = true) => {
        const url = route.startsWith("/") ? base + route : route
        const headers = new Headers(init.headers)
        if (new URL(url).origin === base && cookies.size)
          headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "))
        if (csrf && state.csrf && !["GET", "HEAD", "OPTIONS"].includes(init.method ?? "GET"))
          headers.set("X-OpenCode-CSRF", state.csrf)
        const response = await fetch(url, { ...init, headers, redirect: "manual" })
        if (new URL(url).origin === base)
          for (const value of response.headers.getSetCookie()) {
            const pair = value.split(";", 1)[0]
            const separator = pair.indexOf("=")
            const name = pair.slice(0, separator)
            const content = pair.slice(separator + 1)
            if (content) cookies.set(name, content)
            if (!content) cookies.delete(name)
          }
        return response
      }
      const challenge = await request("/opencode/auth/login")
      if (!challenge.headers.get("location"))
        throw new Error(`Login did not challenge: ${challenge.status} ${await challenge.text()}`)
      const authorize = await request(challenge.headers.get("location")!)
      if (!authorize.headers.get("location"))
        throw new Error(`OIDC fixture did not authorize: ${await authorize.text()}`)
      const callback = await request(authorize.headers.get("location")!)
      const session = await request("/opencode/auth/session")
      if (session.ok) state.csrf = (await session.json()).csrfToken
      return { request, callback, session, cookies, state }
    },
    close() {
      server.stop(true)
    },
  }
}
