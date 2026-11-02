import { expect, test } from "bun:test"
import { createServer } from "node:net"
import { HttpProxyWindows } from "../src/http-proxy-windows.js"
import { HttpProxy } from "../src/http-proxy.js"
const verify = process.platform === "win32" ? test : test.skip

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
    expect(error.message).toContain("before receiving response headers: request:")
    expect(error.message).toContain("ConnectionRefused")
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
    expect(error.message).toContain("before receiving response headers: setup:")
    expect(error.message).toContain("UriFormatException")
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
