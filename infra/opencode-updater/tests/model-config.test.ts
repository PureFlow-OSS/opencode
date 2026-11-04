import { expect, test } from "bun:test"
import { mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { keycloak } from "./support/keycloak"

// Compile-only prerequisite: dotnet build. The server runs against disposable data,
// never the user's Docker container, configuration files, or LiteLLM credentials.
test("promotes model policy through three independent configuration stages", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-model-config-"))
  const idp = await keycloak()
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
    AdminAuthentication: idp.configuration(base),
    Updater: {
      Version: "2.1.3",
      PublicBaseUrl: base,
      ProviderConfig: {
        model: "aifactory/default-model",
        small_model: "aifactory/small-model",
        agents: { title: { model: "aifactory/initial-title", description: "Preserved agent setting" } },
        compaction: { auto: true, buffer: "15%", keep: { tokens: 15000 } },
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
    {
      cwd: directory,
      env: { ...process.env, DOTNET_ENVIRONMENT: "Testing", ASPNETCORE_ENVIRONMENT: "Testing" },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const stdout = new Response(server.stdout).text()
  const stderr = new Response(server.stderr).text()
  const auth: { browser?: Awaited<ReturnType<typeof idp.login>> } = {}
  const request = (route: string, init?: RequestInit) =>
    auth.browser ? auth.browser.request(base + "/opencode" + route, init) : fetch(base + "/opencode" + route, init)
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
    auth.browser = await idp.login(base)
    expect(auth.browser.session.status).toBe(200)
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
    const defaults = [
      { channel: "beta", file: "appsettings.beta.json", key: "beta-key", buffer: "30%", auto: true, keep: 15000 },
      { channel: "ai-gilde", file: "appsettings.ai-gilde.json", key: "gilde-key", buffer: 20000, auto: false, keep: 0 },
      { channel: "normal", file: "appsettings.json", key: "", buffer: "12.5%", auto: true, keep: 12000 },
    ] as const
    for (const row of defaults) {
      const saved = await request(`/admin/provider-settings?channel=${row.channel}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "aifactory/default-model",
          small_model: "aifactory/small-model",
          title_model: `aifactory/${row.channel}-title`,
          compaction_model: "aifactory/glm-5.3-flash",
          compaction_auto: row.auto,
          compaction_buffer: row.buffer,
          compaction_keep_tokens: row.keep,
        }),
      })
      expect(saved.status, await saved.text()).toBe(200)
      const stored = (await read(row.file)).Updater.ProviderConfig
      expect(stored.agents.title).toEqual({
        model: `aifactory/${row.channel}-title`,
        description: "Preserved agent setting",
      })
      expect(stored.agents.compaction.model).toBe("aifactory/glm-5.3-flash")
      expect(stored.compaction).toEqual({ auto: row.auto, buffer: row.buffer, keep: { tokens: row.keep } })
      const admin = await (await request(`/admin/provider-settings?channel=${row.channel}`)).json()
      expect(admin.title_model).toBe(`aifactory/${row.channel}-title`)
      expect(admin.compaction_buffer).toBe(row.buffer)
      const headers = { "X-OpenCode-AiFactory-Api-Key": row.key }
      const legacy = await (await request("/provider-config.json", { headers })).json()
      expect(legacy.agents).toBeUndefined()
      expect(legacy.compaction).toBeUndefined()
      expect(legacy.model).toBe("aifactory/default-model")
      const current = await request("/provider-config.json", {
        headers: { ...headers, "X-OpenCode-Config-Capabilities": "other, agent-compaction-defaults-v1" },
      })
      const config = await current.json()
      expect(config.agents.title.model).toBe(`aifactory/${row.channel}-title`)
      expect(config.compaction).toEqual(stored.compaction)
      expect(current.headers.get("vary")).toContain("X-OpenCode-Config-Capabilities")
      expect(current.headers.get("cache-control")).toContain("no-store")
    }
    const beforeInvalid = await read("appsettings.beta.json")
    for (const patch of [
      { compaction_buffer: "100%" },
      { compaction_buffer: "0%" },
      { compaction_buffer: -1 },
      { compaction_buffer: 1.5 },
      { compaction_buffer: { tokens: 10 } },
      { compaction_keep_tokens: -1 },
      { title_model: "rrz/glm-5.3-flash" },
      { compaction_model: "aifactory/" },
    ]) {
      const invalid = await request("/admin/provider-settings?channel=beta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      expect(invalid.status, JSON.stringify(patch)).toBe(400)
      expect(await read("appsettings.beta.json")).toEqual(beforeInvalid)
    }
    const reset = await request("/admin/provider-settings?channel=beta", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "aifactory/default-model", small_model: "aifactory/small-model" }),
    })
    expect(reset.status).toBe(200)
    const cleared = (await read("appsettings.beta.json")).Updater.ProviderConfig
    expect(cleared.agents.title).toEqual({ description: "Preserved agent setting" })
    expect(cleared.agents.compaction).toBeUndefined()
    expect(cleared.compaction).toBeUndefined()
    const resetConfig = await (await request("/provider-config.json", {
      headers: { "X-OpenCode-AiFactory-Api-Key": "beta-key", "X-OpenCode-Config-Capabilities": "agent-compaction-defaults-v1" },
    })).json()
    expect(resetConfig.agents.title.model).toBeUndefined()
    expect(resetConfig.compaction).toBeUndefined()
    expect((await read("appsettings.ai-gilde.json")).Updater.ProviderConfig.compaction.auto).toBe(false)
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
    idp.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
