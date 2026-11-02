import { expect, test } from "bun:test"
import { createServer } from "node:net"
import path from "node:path"
import { HttpProxyWindows } from "../src/http-proxy-windows.js"
import { HttpProxy } from "../src/http-proxy.js"
const verify = process.platform === "win32" ? test : test.skip

verify(
  "Windows transport works when its caller runs under ConstrainedLanguage",
  async () => {
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("unauthorized", { status: 401 }),
    })
    try {
      const child = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'; & $env:FIXTURE_BUN -e $env:FIXTURE_CODE",
        ],
        {
          cwd: path.resolve(import.meta.dir, ".."),
          env: {
            ...process.env,
            FIXTURE_BUN: process.execPath,
            FIXTURE_PROXY: proxy.url.href,
            FIXTURE_CODE: `import { HttpProxyWindows } from './src/http-proxy-windows.ts'; const response = await HttpProxyWindows.fetch(process.env.FIXTURE_PROXY, 'http://mcp.invalid'); console.log(response.status + ':' + await response.text());`,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(stderr).toBe("")
      expect(stdout.trim()).toBe("401:unauthorized")
      expect(code).toBe(0)
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)

verify(
  "Windows transport preserves binary bodies and quoted authorization headers",
  async () => {
    const body = Uint8Array.from({ length: 256 }, (_, index) => index)
    const seen: Array<{ body: Uint8Array; authorization: string | null; type: string | null }> = []
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        seen.push({
          body: new Uint8Array(await request.arrayBuffer()),
          authorization: request.headers.get("authorization"),
          type: request.headers.get("content-type"),
        })
        return new Response("ok")
      },
    })
    try {
      const response = await HttpProxyWindows.fetch(proxy.url.href, "http://mcp.invalid", {
        method: "POST",
        headers: { authorization: 'Bearer quote"backslash\\token' },
        body,
      })
      expect(await response.text()).toBe("ok")
      expect(seen).toEqual([{ body, authorization: 'Bearer quote"backslash\\token', type: null }])
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)
verify.each([302, 307])(
  "Windows transport handles POST %s redirects and strips cross-origin authorization",
  async (status) => {
    const seen: Array<{ method: string; body: string; authorization: string | null }> = []
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        seen.push({
          method: request.method,
          body: await request.text(),
          authorization: request.headers.get("authorization"),
        })
        if (new URL(request.url).pathname === "/start") return Response.redirect("http://other.invalid/end", status)
        return new Response("redirected")
      },
    })
    try {
      const response = await HttpProxyWindows.fetch(proxy.url.href, "http://mcp.invalid/start", {
        method: "POST",
        headers: { authorization: "Bearer initial-only" },
        body: "request body",
      })
      expect(await response.text()).toBe("redirected")
      expect(response.url).toBe("http://other.invalid/end")
      expect(response.redirected).toBe(true)
      expect(seen).toEqual([
        { method: "POST", body: "request body", authorization: "Bearer initial-only" },
        { method: status === 302 ? "GET" : "POST", body: status === 302 ? "" : "request body", authorization: null },
      ])
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)

verify.each(["HEAD", "GET"])(
  "Windows transport returns empty %s responses",
  async (method) => {
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null, { status: method === "HEAD" ? 200 : 204 }),
    })
    try {
      const response = await HttpProxyWindows.fetch(proxy.url.href, "http://mcp.invalid", { method })
      expect(response.status).toBe(method === "HEAD" ? 200 : 204)
      expect(response.body).toBeNull()
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)

verify(
  "Windows transport can abort before response headers arrive",
  async () => {
    const received = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch() {
        received.resolve()
        await release.promise
        return new Response("late")
      },
    })
    try {
      const controller = new AbortController()
      const pending = HttpProxyWindows.fetch(proxy.url.href, "http://mcp.invalid", { signal: controller.signal })
      await received.promise
      controller.abort(new Error("AbortError"))
      await expect(pending).rejects.toThrow("AbortError")
    } finally {
      release.resolve()
      proxy.stop(true)
    }
  },
  15000,
)

verify.each(["manual", "error"] as const)(
  "Windows transport respects redirect mode %s",
  async (redirect) => {
    const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.redirect("http://other.invalid") })
    try {
      const pending = HttpProxyWindows.fetch(proxy.url.href, "http://mcp.invalid", { redirect })
      if (redirect === "error") return await expect(pending).rejects.toThrow("Redirect encountered")
      const response = await pending
      expect(response.status).toBe(302)
      expect(response.redirected).toBe(false)
      await response.body?.cancel()
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)

verify(
  "Windows transport returns decompressed bytes with matching headers",
  async () => {
    const body = Bun.gzipSync("compressed response")
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(body, { headers: { "content-encoding": "gzip", "content-length": String(body.length) } }),
    })
    try {
      const response = await HttpProxyWindows.fetch(proxy.url.href, "http://mcp.invalid")
      expect(await response.text()).toBe("compressed response")
      expect(response.headers.has("content-encoding")).toBe(false)
      expect(response.headers.has("content-length")).toBe(false)
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)

verify(
  "Windows proxy failures report connection codes without exposing request secrets",
  async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Expected a TCP address")
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    const error = await HttpProxyWindows.fetch(
      `http://proxy-secret:password-secret@127.0.0.1:${address.port}`,
      "https://origin.invalid/private-secret?token=token-secret",
      { headers: { Authorization: "Bearer bearer-secret" } },
    ).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error("Expected proxy failure")
    expect(error.message).toContain("curl 7: ConnectFailure")
    expect(error.message).not.toContain("secret")
    expect(error.message).not.toContain("origin.invalid")
  },
  15000,
)

verify(
  "Windows proxy setup failures include sanitized diagnostics",
  async () => {
    const error = await HttpProxyWindows.fetch("http://[invalid-secret", "https://origin.invalid").catch(
      (error: unknown) => error,
    )
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error("Expected proxy failure")
    expect(error.message).toContain("requires a valid HTTP(S) proxy URL")
    expect(error.message).not.toContain("invalid-secret")
  },
  15000,
)

verify(
  "OAuth fetch retries a proxy 407 through Windows with the original request intact",
  async () => {
    const seen: { body: string; authorization: string | null; agent: string | null }[] = []
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        seen.push({
          body: await request.text(),
          authorization: request.headers.get("authorization"),
          agent: request.headers.get("user-agent"),
        })
        if (seen.length === 1) return new Response(null, { status: 407 })
        return Response.json({ error: "authorization_pending" }, { status: 403 })
      },
    })
    HttpProxy.configure({ use_http_proxy: true, http_proxy: proxy.url.href })
    try {
      const response = await HttpProxy.fetchAuthenticated("http://oauth.invalid/token", {
        method: "POST",
        headers: { authorization: "Bearer origin-only" },
        body: new URLSearchParams({ code: "a'&é", grant_type: "authorization_code" }),
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "authorization_pending" })
      expect(seen).toHaveLength(2)
      expect(seen.map(({ body }) => body)).toEqual([
        "code=a%27%26%C3%A9&grant_type=authorization_code",
        "code=a%27%26%C3%A9&grant_type=authorization_code",
      ])
      expect(seen.every((item) => item.authorization === "Bearer origin-only")).toBe(true)
      expect(seen[0]?.agent).toContain("Bun/")
      expect(seen[1]?.agent).toBeNull()
    } finally {
      HttpProxy.configure({})
      proxy.stop(true)
    }
  },
  15000,
)

verify(
  "Windows proxy fetch preserves OAuth bodies, origin authorization and HTTP errors",
  async () => {
    const seen: Array<{ url: string; authorization: string | null; body: string }> = []
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        seen.push({ url: request.url, authorization: request.headers.get("authorization"), body: await request.text() })
        return Response.json(
          { error: "authorization_pending" },
          { status: 403, headers: { "x-proxy-test": "preserved" } },
        )
      },
    })
    try {
      const request = (input: RequestInfo | URL, init?: RequestInit) =>
        HttpProxyWindows.fetch(`http://127.0.0.1:${proxy.port}`, input, init)
      const response = await request("http://oauth.invalid/token", {
        method: "POST",
        headers: { Authorization: "Bearer origin-only", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: "a'&é", grant_type: "authorization_code" }),
      })
      expect(response.status).toBe(403)
      expect(response.headers.get("x-proxy-test")).toBe("preserved")
      expect(await response.json()).toEqual({ error: "authorization_pending" })
      expect(seen).toEqual([
        {
          url: "http://oauth.invalid/token",
          authorization: "Bearer origin-only",
          body: "code=a%27%26%C3%A9&grant_type=authorization_code",
        },
      ])
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)

verify(
  "Windows proxy fetch streams MCP events before completion and supports cancellation",
  async () => {
    const gate = Promise.withResolvers<void>()
    const state = { cancelled: false }
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: first\n\n"))
              void gate.promise.then(() => {
                if (!state.cancelled) controller.close()
              })
            },
            cancel() {
              state.cancelled = true
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    })
    try {
      const abort = new AbortController()
      const response = await HttpProxyWindows.fetch(`http://127.0.0.1:${proxy.port}`, "http://mcp.invalid/events", {
        signal: abort.signal,
      })
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n")
      const pending = reader.read()
      abort.abort()
      await expect(pending).rejects.toThrow()
    } finally {
      gate.resolve()
      proxy.stop(true)
    }
  },
  15000,
)

verify(
  "Windows proxy fetch negotiates proxy credentials without sending them as origin auth",
  async () => {
    const seen: string[] = []
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const authorization = request.headers.get("proxy-authorization") ?? ""
        seen.push(authorization)
        if (!authorization)
          return new Response(null, { status: 407, headers: { "Proxy-Authenticate": 'Basic realm="test"' } })
        expect(request.headers.get("authorization")).toBeNull()
        return new Response("authenticated")
      },
    })
    try {
      const response = await HttpProxyWindows.fetch(
        `http://test:password@127.0.0.1:${proxy.port}`,
        "http://mcp.invalid/initialize",
      )
      expect(await response.text()).toBe("authenticated")
      expect(seen).toContain(`Basic ${btoa("test:password")}`)
    } finally {
      proxy.stop(true)
    }
  },
  15000,
)
