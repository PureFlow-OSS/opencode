import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isolatedEnv } from "./fixture/environment"
import { expect, test } from "bun:test"
import { tmpdir } from "../../core/test/fixture/tmpdir"

test("runs AI Factory through the V2 CLI with a real tool roundtrip", async () => {
  await using directory = await tmpdir("opencode-aifactory-cli-")
  const root = directory.path
  const calls: { path: string; authorized: boolean; tools?: string[]; continued?: boolean }[] = []
  const factory = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const call = {
        path: pathname,
        authorized: request.headers.get("authorization") === "Bearer port-test-key",
        tools: undefined as string[] | undefined,
        continued: undefined as boolean | undefined,
      }
      calls.push(call)
      if (pathname.endsWith("provider-config.json"))
        return Response.json({
          model: "port-smoke",
          aifactory: { model_limits: [{ pattern: "*", context: 64000, output: 4096, reasoning: false }] },
        })
      if (pathname.endsWith("/models")) return Response.json({ data: [{ id: "port-smoke" }] })
      if (pathname.endsWith("modelcards.json"))
        return Response.json({ aifactory: { models: [{ model: "port-smoke" }] } })
      if (!pathname.endsWith("/chat/completions"))
        return Response.json({ error: "unknown test endpoint" }, { status: 404 })
      const body = (await request.json()) as {
        stream?: boolean
        messages?: { role?: string; content?: unknown }[]
        tools?: { function?: { name?: string } }[]
      }
      call.tools = body.tools?.flatMap((item) => (item.function?.name ? [item.function.name] : []))
      call.continued = body.messages?.some((item) => item.role === "tool") ?? false
      const invoke = call.tools?.includes("execute") && !call.continued
      const message = invoke
        ? {
            role: "assistant",
            tool_calls: [
              {
                id: "port-tool-call",
                type: "function",
                function: { name: "execute", arguments: JSON.stringify({ code: "return { ported: true }" }) },
              },
            ],
          }
        : { role: "assistant", content: "PORT_OK" }
      const base = { id: "port-test-response", model: "port-smoke", created: 1 }
      if (!body.stream)
        return Response.json({
          ...base,
          object: "chat.completion",
          choices: [{ index: 0, message, finish_reason: invoke ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      const delta = invoke ? { role: "assistant", tool_calls: [{ index: 0, ...message.tool_calls![0] }] } : message
      return new Response(
        [
          `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: invoke ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })

  try {
    await fs.writeFile(
      path.join(root, "bunfig.toml"),
      `preload = [${JSON.stringify(fileURLToPath(import.meta.resolve("@opentui/solid/preload")))}]\n`,
    )
    const env = Object.fromEntries(
      Object.entries(isolatedEnv(root)).filter(
        ([key]) => !/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$/i.test(key),
      ),
    )
    const child = Bun.spawn(
      [
        ...(process.env.OPENCODE_TEST_CLI_BINARY
          ? [process.env.OPENCODE_TEST_CLI_BINARY]
          : [process.execPath, path.join(import.meta.dir, "../src/index.ts")]),
        "--print-logs",
        "run",
        "--standalone",
        "--title",
        "Port smoke",
        "--format",
        "json",
        "--model",
        "aifactory/port-smoke",
        "--auto",
        "Verify the port with one tool call.",
      ],
      {
        cwd: root,
        env: {
          ...env,
          ProgramData: path.join(root, "program-data"),
          HTTP_PROXY: "http://unused-proxy.invalid:8080",
          HTTPS_PROXY: "http://unused-proxy.invalid:8080",
          http_proxy: "http://unused-proxy.invalid:8080",
          https_proxy: "http://unused-proxy.invalid:8080",
          NO_PROXY: "127.0.0.1,localhost",
          no_proxy: "127.0.0.1,localhost",
          OPENCODE_AIFACTORY_API_KEY: "port-test-key",
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            updater: `${factory.url}opencode`,
            aifactory_host: `${factory.url}v1`,
            use_http_proxy: false,
            model: "aifactory/port-smoke",
          }),
        },
        stdout: "pipe",
        stderr: "pipe",
        // Cold Windows runs load the complete V2 runtime twice: CLI and isolated standalone server.
        signal: AbortSignal.timeout(60000),
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, `${stderr}\n${stdout}\nRequests: ${JSON.stringify(calls)}`).toBe(0)
    expect(stdout).toContain("PORT_OK")
    expect(stdout).toContain('"tool":"execute"')
    expect(stdout).toContain('"status":"completed"')
    expect(calls.filter((call) => call.path.endsWith("/chat/completions"))).toHaveLength(2)
    expect(calls.filter((call) => call.path.startsWith("/v1/")).every((call) => call.authorized)).toBe(true)
    expect(calls.some((call) => call.continued)).toBe(true)
  } finally {
    factory.stop(true)
  }
}, 90000)
