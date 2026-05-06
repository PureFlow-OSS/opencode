import { describe, expect, test } from "bun:test"
import {
  defaultModelVisibilityRules,
  parseAiFactoryModelVisibilityRules,
  readAiFactoryModelVisibilityRules,
  resolveAiFactoryModelVisibility,
} from "./model-visibility"

describe("model visibility", () => {
  test("default rules hide embeddings and aggregate proxy models", () => {
    const rules = defaultModelVisibilityRules()

    expect(resolveAiFactoryModelVisibility({ id: "text-embedding-3-large", name: "text-embedding-3-large" }, rules)).toBe(
      false,
    )
    expect(resolveAiFactoryModelVisibility({ id: "all-proxy-models", name: "all-proxy-models" }, rules)).toBe(false)
    expect(resolveAiFactoryModelVisibility({ id: "all-team-models", name: "all-team-models" }, rules)).toBe(false)
  })

  test("server rules parse from updater payload and can override defaults", () => {
    const rules = parseAiFactoryModelVisibilityRules({
      Updater: {
        ProviderConfig: {
          aifactory: {
            model_visibility: [{ pattern: "all-team-models", visible: true }],
          },
        },
      },
    })

    expect(rules).toEqual([{ pattern: "all-team-models", visible: true }])
    expect(
      resolveAiFactoryModelVisibility(
        { id: "all-team-models", name: "all-team-models" },
        [...defaultModelVisibilityRules(), ...rules],
      ),
    ).toBe(true)
  })

  test("embedding aliases are hidden by default", () => {
    expect(
      resolveAiFactoryModelVisibility(
        { id: "qwen/qwen3-embedding-4b", name: "qwen/qwen3-embedding-4b" },
        defaultModelVisibilityRules(),
      ),
    ).toBe(false)
  })

  test("provider config fetch sends aifactory header", async () => {
    let headers: Headers | undefined
    const fetchFn = Object.assign(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        headers = new Headers(init?.headers)
        return new Response(JSON.stringify({ aifactory: { model_visibility: [] } }), {
          headers: {
            "content-type": "application/json",
          },
        })
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch
    await readAiFactoryModelVisibilityRules(
      fetchFn,
      { apiKey: "rrz-key" },
    )
    expect(headers?.get("X-OpenCode-AiFactory-Api-Key")).toBe("rrz-key")
  })
})
