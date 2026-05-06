import { describe, expect, test } from "bun:test"
import {
  defaultModelVisibilityRules,
  parseAiFactoryModelVisibilityRules,
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
})
