import { createRemoteJWKSet, jwtVerify } from "jose"

const KEYCLOAK_JWKS_URL = process.env.KEYCLOAK_JWKS_URL
const PORT = Number(process.env.KES_PORT ?? 5000)

// Required: map Keycloak groups to LiteLLM virtual keys — master key must NOT be here
// Format: '{"admins":"sk-abc123","developers":"sk-def456"}'
const GROUP_KEY_MAP: Record<string, string> = process.env.GROUP_KEY_MAP
  ? JSON.parse(process.env.GROUP_KEY_MAP)
  : {}

if (!KEYCLOAK_JWKS_URL) {
  console.error("KEYCLOAK_JWKS_URL is required")
  process.exit(1)
}
if (Object.keys(GROUP_KEY_MAP).length === 0) {
  console.warn("WARNING: GROUP_KEY_MAP is empty — all authenticated users will be denied. Set GROUP_KEY_MAP to map Keycloak groups to LiteLLM virtual keys.")
}

const jwks = createRemoteJWKSet(new URL(KEYCLOAK_JWKS_URL))

function resolveLitellmKey(groups: string[]): string | null {
  for (const group of groups) {
    const name = group.replace(/^\//, "")
    if (GROUP_KEY_MAP[name]) return GROUP_KEY_MAP[name]
  }
  return null
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" })
    }

    if (url.pathname === "/exchange" && req.method === "POST") {
      const authHeader = req.headers.get("Authorization")
      if (!authHeader?.startsWith("Bearer ")) {
        return Response.json({ error: "Missing Bearer token" }, { status: 401 })
      }

      const token = authHeader.slice(7)

      try {
        const { payload } = await jwtVerify(token, jwks)

        const groups: string[] = Array.isArray(payload["groups"])
          ? (payload["groups"] as string[])
          : []

        const litellmKey = resolveLitellmKey(groups)

        if (!litellmKey) {
          console.warn(`[exchange] DENIED sub=${payload.sub} groups=[${groups.join(",")}] — no matching group in GROUP_KEY_MAP`)
          return Response.json(
            { error: `Access denied: none of your groups [${groups.join(", ")}] are authorized` },
            { status: 403 },
          )
        }

        console.log(`[exchange] GRANTED sub=${payload.sub} groups=[${groups.join(",")}] → key=***${litellmKey.slice(-6)}`)

        return Response.json({ litellm_key: litellmKey })
      } catch (err) {
        console.error(`[exchange] JWT validation failed: ${err}`)
        return Response.json({ error: `JWT validation failed: ${err}` }, { status: 401 })
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 })
  },
})

console.log(`Key Exchange Server listening on http://0.0.0.0:${PORT}`)
console.log(`  JWKS:     ${KEYCLOAK_JWKS_URL}`)
console.log(`  Groups mapped: ${Object.keys(GROUP_KEY_MAP).join(", ") || "none — all users will be denied"}`)
