import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { connect } from "node:net"
import path from "node:path"
import { exportJWK, generateKeyPair, SignJWT } from "jose"

// All named external hosts terminate at this local TLS fixture. The child trusts only this
// additional test certificate; TLS verification stays enabled and real credentials are never used.
test.each([
  ...["chatgpt-browser", "chatgpt-token-sharing", "chatgpt-headless", "mcp"].map((method) => ({
    method,
    credentials: "proxy%40user:p%40ss%3Aword",
    decoded: "proxy@user:p@ss:word",
  })),
  { method: "mcp", credentials: "proxy-user", decoded: "proxy-user:" },
  { method: "mcp", credentials: "", decoded: "" },
  { method: "mcp-rejected", credentials: "proxy%40user:p%40ss%3Aword", decoded: "proxy@user:p@ss:word" },
])(
  "$method handles HTTPS CONNECT with credentials '$credentials'",
  async ({ method, credentials, decoded }) => {
    const directory = path.resolve(import.meta.dir, "../fixture/proxy")
    const keys = await generateKeyPair("RS256")
    const publicKey = await exportJWK(keys.publicKey)
    const state = { nonce: "" }
    const requests: { host: string; path: string; body: string; authorization: string | null; proxy: string | null }[] =
      []
    const tunnels: { host: string; authorization: string | string[] | undefined }[] = []
    const control = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        state.nonce = await request.text()
        return new Response(null, { status: 204 })
      },
    })
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { key: Bun.file(path.join(directory, "key.pem")), cert: Bun.file(path.join(directory, "cert.pem")) },
      async fetch(request) {
        const url = new URL(request.url)
        requests.push({
          host: url.hostname,
          path: url.pathname,
          body: await request.text(),
          authorization: request.headers.get("authorization"),
          proxy: request.headers.get("proxy-authorization"),
        })
        if (url.pathname === "/.well-known/jwks.json")
          return Response.json({ keys: [{ ...publicKey, kid: "fixture", alg: "RS256", use: "sig" }] })
        if (url.pathname === "/metadata")
          return Response.json({
            issuer: "https://oauth.hubspot.com",
            authorization_endpoint: "https://oauth.hubspot.com/authorize",
            token_endpoint: "https://oauth.hubspot.com/token",
            response_types_supported: ["code"],
          })
        if (url.pathname === "/redirect") return Response.redirect("https://oauth.hubspot.com/resource")
        if (url.pathname === "/protected")
          return new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.hubspot.com/metadata"' },
          })
        if (url.pathname === "/mcp" || url.pathname === "/resource")
          return Response.json({ authorization: request.headers.get("authorization") })
        if (url.pathname === "/api/accounts/deviceauth/usercode")
          return Response.json({ device_auth_id: "fixture-device", user_code: "CODE", interval: "1" })
        if (url.pathname === "/api/accounts/deviceauth/token")
          return Response.json({ authorization_code: "fixture-code", code_verifier: "fixture-verifier" })
        if (
          url.pathname === "/oauth/token" ||
          url.pathname === "/api/accounts/oauth/token" ||
          url.pathname === "/token"
        )
          return Response.json({
            access_token: "fixture-access",
            refresh_token: "fixture-refresh",
            expires_in: 3600,
            scope: "chatgpt.tokens.use.direct",
            id_token: await new SignJWT({ nonce: state.nonce })
              .setProtectedHeader({ alg: "RS256", kid: "fixture" })
              .setIssuer("https://auth.openai.com")
              .setAudience("fixture-client")
              .setSubject("fixture-user")
              .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
              .sign(keys.privateKey),
          })
        return new Response(null, { status: 404 })
      },
    })
    const authorization = credentials ? `Basic ${Buffer.from(decoded).toString("base64")}` : undefined
    const proxy = createServer((_request, response) => response.writeHead(405).end())
    proxy.on("connect", (request, socket, head) => {
      tunnels.push({ host: request.url ?? "", authorization: request.headers["proxy-authorization"] })
      if (method === "mcp-rejected" || request.headers["proxy-authorization"] !== authorization) {
        socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\nContent-Length: 0\r\n\r\n',
        )
        return
      }
      // Reject unexpected destinations rather than allowing any request onto the external network.
      if (!["auth.openai.com:443", "mcp.hubspot.com:443", "oauth.hubspot.com:443"].includes(request.url ?? "")) {
        socket.destroy()
        return
      }
      const upstream = connect(origin.port!, "127.0.0.1", () => {
        socket.write(`HTTP/${credentials ? "1.1" : "1.0"} 200 Connection Established\r\n\r\n`)
        upstream.write(head)
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      socket.on("error", () => upstream.destroy())
      socket.on("close", () => upstream.destroy())
      upstream.on("error", () => socket.destroy())
      upstream.on("close", () => socket.destroy())
    })
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
    const address = proxy.address()
    if (!address || typeof address === "string") throw new Error("Proxy did not bind")
    try {
      const child = Bun.spawn([process.execPath, "--preload", "./test/preload.ts", path.join(directory, "client.ts")], {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: path.join(directory, "cert.pem"),
          NODE_TLS_REJECT_UNAUTHORIZED: "1",
          HTTP_PROXY: "http://127.0.0.1:9",
          HTTPS_PROXY: "http://127.0.0.1:9",
          http_proxy: "http://127.0.0.1:9",
          https_proxy: "http://127.0.0.1:9",
          NO_PROXY: "localhost,127.0.0.1",
          no_proxy: "localhost,127.0.0.1",
          FIXTURE_PROXY: `http://${credentials ? `${credentials}@` : ""}127.0.0.1:${address.port}`,
          FIXTURE_CONTROL: control.url.toString(),
          FIXTURE_METHOD: method,
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code, stdout + stderr).toBe(0)
      expect(stdout).toContain("PROXY_FIXTURE_OK")
      expect(tunnels.length).toBeGreaterThan(0)
      expect(tunnels.every((item) => item.authorization === authorization)).toBe(true)
      expect(requests.every((item) => item.proxy === null)).toBe(true)
      if (method === "mcp-rejected") {
        expect(requests).toHaveLength(0)
        return
      }
      if (method === "mcp") {
        expect(requests.map((item) => item.path)).toEqual([
          ...(credentials ? [] : ["/protected"]),
          "/metadata",
          "/mcp",
          "/token",
          "/redirect",
          "/resource",
        ])
        expect(requests.find((item) => item.path === "/mcp")?.authorization).toBe("Bearer resource-token")
        return
      }
      const token = requests.find((item) => item.path.endsWith("/oauth/token"))
      expect(new URLSearchParams(token?.body).get("grant_type")).toBe("authorization_code")
      expect(new URLSearchParams(token?.body).get("code")).toBe("fixture-code")
      expect(requests.some((item) => new URLSearchParams(item.body).get("grant_type") === "refresh_token")).toBe(true)
      if (method === "chatgpt-token-sharing")
        expect(requests.some((item) => item.path === "/.well-known/jwks.json")).toBe(true)
      if (method === "chatgpt-headless")
        expect(requests.map((item) => item.path)).toContain("/api/accounts/deviceauth/token")
    } finally {
      origin.stop(true)
      control.stop(true)
      proxy.closeAllConnections()
      proxy.close()
    }
  },
  30000,
)
