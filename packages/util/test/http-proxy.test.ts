import { afterEach, describe, expect, test } from "bun:test"
import { createServer } from "node:http"
import { connect } from "node:net"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { HttpProxy } from "../src/http-proxy.js"

afterEach(() => HttpProxy.configure({}))

describe("corporate HTTP proxy", () => {
  test("routes external requests while bypassing AI Factory and local services", () => {
    HttpProxy.configure({
      use_http_proxy: true,
      http_proxy: "http://proxy.example:8080",
      aifactory_host: "https://factory.example/v1",
    })
    expect(HttpProxy.proxyFor("https://external.example/chat")).toBe("http://proxy.example:8080")
    expect(HttpProxy.proxyFor("https://factory.example/v1/models")).toBeUndefined()
    expect(HttpProxy.proxyFor("http://localhost:4096/api")).toBeUndefined()
    expect(HttpProxy.proxyFor("http://127.0.0.1:4096/api")).toBeUndefined()
    HttpProxy.configure({ use_http_proxy: false, http_proxy: "http://proxy.example:8080" })
    expect(HttpProxy.proxyFor("https://external.example/chat")).toBeUndefined()
  })

  test.each(["bun", "node"] as const)("performs a real %s request through the configured proxy", async (runtime) => {
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        Response.json({ authorization: request.headers.get("authorization"), path: new URL(request.url).pathname }),
    })
    const tunnels: string[] = []
    const proxy = createServer((request, response) => {
      tunnels.push(request.url ?? "")
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({ authorization: request.headers.authorization, path: new URL(request.url!).pathname }),
      )
    })
    proxy.on("connect", (request, socket, head) => {
      tunnels.push(request.url ?? "")
      const upstream = connect(origin.port!, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
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
    if (!address || typeof address === "string") throw new Error("Proxy did not bind a TCP port")
    const config = { use_http_proxy: true, http_proxy: `http://127.0.0.1:${address.port}` }
    const file = path.join(import.meta.dir, `.http-proxy-${crypto.randomUUID()}.mjs`)
    try {
      const body = await (async () => {
        if (runtime === "bun") {
          HttpProxy.configure(config)
          const response = await HttpProxy.fetch("http://external.example/proxy-test", {
            headers: { authorization: "Bearer test-token" },
          })
          return response.json()
        }
        const result = await Bun.build({
          entrypoints: [path.join(import.meta.dir, "../src/http-proxy.ts")],
          target: "node",
          format: "esm",
          packages: "external",
        })
        expect(result.success, result.logs.map(String).join("\n")).toBe(true)
        await Bun.write(file, result.outputs[0])
        const child = Bun.spawn(
          [
            Bun.which("node")!,
            "--input-type=module",
            "-e",
            `
          const { HttpProxy } = await import(${JSON.stringify(pathToFileURL(file).href)});
          HttpProxy.configure(${JSON.stringify(config)});
          const response = await HttpProxy.fetch("http://external.example/proxy-test", { headers: { authorization: "Bearer test-token" } });
          console.log(JSON.stringify(await response.json()));
          process.exit(0);
        `,
          ],
          { stdout: "pipe", stderr: "pipe" },
        )
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect(code, stderr).toBe(0)
        return JSON.parse(stdout)
      })()
      expect(body).toEqual({ authorization: "Bearer test-token", path: "/proxy-test" })
      expect(tunnels).toHaveLength(1)
    } finally {
      await fs.rm(file, { force: true })
      origin.stop(true)
      proxy.closeAllConnections()
      proxy.close()
    }
  })
})
