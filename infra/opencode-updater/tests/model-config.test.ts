import { expect, test } from "bun:test"
import { mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Compile-only prerequisite: dotnet build. The server runs against disposable data,
// never the user's Docker container, configuration files, or LiteLLM credentials.
test("promotes model policy through three independent configuration stages", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-model-config-"))
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.endsWith("/key/info")) {
        const key = url.searchParams.get("key") ?? request.headers.get("x-litellm-api-key")
        return Response.json({ info: { username: key === "beta-key" ? "beta-user" : "gilde-user" } })
      }
      return Response.json({ data: [] })
    },
  })
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const base = reservation.url.origin
  reservation.stop(true)
  const policy = {
    pattern: "test-model",
    context: 100000,
    output: 8000,
    reasoning: true,
    reasoning_variants: ["low", "high"],
    default_reasoning_variant: "high",
    document_vision: true,
    document_vision_native: false,
    document_ocr_native_pdf: true,
    native_image_vision: false,
    document_ocr_model: "ocr-worker",
    document_vision_model: "vision-worker",
  }
  const config = (context: number) => ({
    Updater: {
      Version: "2.1.3",
      PublicBaseUrl: base,
      ProviderConfig: {
        model: "aifactory/default-model",
        small_model: "aifactory/small-model",
        aifactory: {
          model_limits: [
            { ...policy, context },
            { pattern: "other-model", context: 1234 },
          ],
          model_visibility: [{ pattern: "test-model", visible: context === 100000 }],
        },
      },
    },
  })
  const file = (name: string) => Bun.file(path.join(directory, name))
  const read = (name: string) => file(name).json()
  await Bun.write(file("appsettings.json"), JSON.stringify(config(60000)))
  await Bun.write(file("appsettings.ai-gilde.json"), JSON.stringify(config(90000)))
  await Bun.write(
    file("appsettings.beta.json"),
    JSON.stringify({
      ...config(100000),
      UpdaterBeta: {
        Enabled: true,
        Users: ["beta-user"],
        AiGildeUsers: ["gilde-user"],
        LiteLLM: {
          BaseUrl: gateway.url.origin,
          ApiKey: "test-admin",
          KeyInfoPath: "key/info",
          ModelInfoPath: "model/info",
        },
      },
    }),
  )
  const server = Bun.spawn(
    [
      "dotnet",
      path.resolve(import.meta.dir, "../bin/Debug/net10.0/OpenCode.UpdaterServer.dll"),
      "--contentRoot",
      directory,
      "--urls",
      base,
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  )
  const stdout = new Response(server.stdout).text()
  const stderr = new Response(server.stderr).text()
  const request = (route: string, init?: RequestInit) => fetch(base + "/opencode" + route, init)
  try {
    const deadline = Date.now() + 20000
    const ready = async (): Promise<void> => {
      if (server.exitCode !== null) throw new Error((await stderr) + (await stdout))
      if (
        await request("/version")
          .then((response) => response.status === 200)
          .catch(() => false)
      )
        return
      if (Date.now() > deadline) throw new Error("The isolated updater did not become ready")
      await Bun.sleep(25)
      return ready()
    }
    await ready()
    const settings = (root: Awaited<ReturnType<typeof read>>) => root.Updater.ProviderConfig.aifactory
    for (const [key, context] of [
      ["", 60000],
      ["beta-key", 100000],
      ["gilde-key", 90000],
    ] as const) {
      const response = await request("/provider-config.json", { headers: { "X-OpenCode-AiFactory-Api-Key": key } })
      expect(response.status).toBe(200)
      expect(
        (await response.json()).aifactory.model_limits.find(
          (item: { pattern: string }) => item.pattern === "test-model",
        ).context,
      ).toBe(context)
    }
    expect((await request("/admin/provider-settings")).status).toBe(200)
    expect((await request("/admin/provider-settings?channel=stable")).status).toBe(200)
    const originalNormal = await read("appsettings.json")
    const promoted = await request("/admin/model-settings/promote?model=test-model&channel=ai-gilde", {
      method: "POST",
    })
    expect(promoted.status).toBe(200)
    expect(
      settings(await read("appsettings.ai-gilde.json")).model_limits.toSorted(
        (a: { pattern: string }, b: { pattern: string }) => a.pattern.localeCompare(b.pattern),
      ),
    ).toEqual([{ pattern: "other-model", context: 1234 }, policy])
    expect(settings(await read("appsettings.ai-gilde.json")).model_visibility).toEqual([
      { pattern: "test-model", visible: true },
    ])
    expect(await read("appsettings.json")).toEqual(originalNormal)

    const updated = await request("/admin/model-settings?model=test-model&channel=beta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, context: 110000, visible: false }),
    })
    expect(updated.status).toBe(200)
    expect(settings(await read("appsettings.beta.json")).model_limits[0].context).toBe(110000)
    expect(
      settings(await read("appsettings.ai-gilde.json")).model_limits.find(
        (item: { pattern: string }) => item.pattern === "test-model",
      ),
    ).toEqual(policy)
    expect(
      (await request("/admin/model-settings/promote?model=test-model&channel=normal", { method: "POST" })).status,
    ).toBe(200)
    expect(
      settings(await read("appsettings.json")).model_limits.find(
        (item: { pattern: string }) => item.pattern === "test-model",
      ),
    ).toEqual(policy)
    expect((await read("appsettings.json")).Updater.ProviderConfig.model).toBe("aifactory/default-model")

    for (const [key, context] of [
      ["beta-key", 110000],
      ["gilde-key", 100000],
    ] as const) {
      const response = await request("/provider-config.json", { headers: { "X-OpenCode-AiFactory-Api-Key": key } })
      expect(response.status).toBe(200)
      expect(
        (await response.json()).aifactory.model_limits.find(
          (item: { pattern: string }) => item.pattern === "test-model",
        ).context,
      ).toBe(context)
    }
    expect(
      (await request("/admin/model-settings/promote?model=test-model&channel=beta", { method: "POST" })).status,
    ).toBe(400)
    expect((await request("/admin/model-settings/promote?model=test-model", { method: "POST" })).status).toBe(400)
    expect(
      (await request("/admin/model-settings/promote?model=test-model&channel=typo", { method: "POST" })).status,
    ).toBe(400)
    expect((await request("/admin/provider-settings?channel=typo")).status).toBe(400)

    const beta = await read("appsettings.beta.json")
    settings(beta).model_limits.push({ pattern: "family-*", context: 2345 }, { pattern: "*", context: 1111 })
    settings(beta).model_visibility.push({ pattern: "family-*", visible: false })
    await Bun.write(file("appsettings.beta.json"), JSON.stringify(beta))
    expect(
      (await request("/admin/model-settings/promote?model=family-a&channel=ai-gilde", { method: "POST" })).status,
    ).toBe(200)
    const gilde = await read("appsettings.ai-gilde.json")
    expect(settings(gilde).model_limits.find((item: { pattern: string }) => item.pattern === "family-a")).toEqual({
      pattern: "family-a",
      context: 2345,
    })
    expect(settings(gilde).model_limits.some((item: { pattern: string }) => item.pattern === "family-*")).toBe(false)
    expect(
      settings(gilde).model_visibility.find((item: { pattern: string }) => item.pattern === "family-a").visible,
    ).toBe(false)
    const normal = await read("appsettings.json")
    const missing = await request("/admin/model-settings/promote?model=missing-rule&channel=normal", { method: "POST" })
    expect((await missing.json()).promoted).toBe(false)
    expect(await read("appsettings.json")).toEqual(normal)

    // Docker's existing data volume also persists the third stage without a new bind mount.
    await rename(
      path.join(directory, "appsettings.ai-gilde.json"),
      path.join(directory, "data", "appsettings.ai-gilde.json"),
    )
    expect(
      (await request("/admin/model-settings/promote?model=fallback-a&channel=ai-gilde", { method: "POST" })).status,
    ).toBe(200)
    expect(
      settings(await read("data/appsettings.ai-gilde.json")).model_limits.find(
        (item: { pattern: string }) => item.pattern === "fallback-a",
      ),
    ).toEqual({ pattern: "fallback-a", context: 1111 })
    expect(await file("appsettings.ai-gilde.json").exists()).toBe(false)
    const policyOnly = await read("data/appsettings.ai-gilde.json")
    delete policyOnly.Updater.Version
    delete policyOnly.Updater.PublicBaseUrl
    await Bun.write(file("data/appsettings.ai-gilde.json"), JSON.stringify(policyOnly))
    expect(await (await request("/version", { headers: { "X-OpenCode-AiFactory-Api-Key": "gilde-key" } })).text()).toBe(
      "2.1.3",
    )
    expect(
      await (await request("/url", { headers: { "X-OpenCode-AiFactory-Api-Key": "gilde-key" } })).text(),
    ).toStartWith(base + "/opencode/feed")
  } finally {
    server.kill()
    await server.exited
    gateway.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
