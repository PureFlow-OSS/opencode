import { describe, expect, test } from "bun:test"
import { DateTime } from "luxon"
import {
  computeForcedVisibleModelKeys,
  isModelVisibleBase,
  modelKey,
  resolveConfiguredModelKey,
} from "./model-selection"

describe("model selection", () => {
  test("resolves providerless configured model to matching aifactory model", () => {
    expect(
      resolveConfiguredModelKey("team-default-model", [
        { providerID: "openai", modelID: "gpt-5" },
        { providerID: "aifactory", modelID: "team-default-model" },
      ]),
    ).toEqual({
      providerID: "aifactory",
      modelID: "team-default-model",
    })
  })

  test("forces configured and provider default models visible", () => {
    const items = [
      { providerID: "aifactory", modelID: "team-default-model" },
      { providerID: "aifactory", modelID: "team-secondary-model" },
    ]
    const visible = (model: { providerID: string; modelID: string }) =>
      isModelVisibleBase({
        model,
        latest: new Set<string>(),
        release: new Map(items.map((item) => [modelKey(item), DateTime.fromISO("2024-01-01")] as const)),
        visibility: new Map(),
      })

    expect(
      computeForcedVisibleModelKeys({
        items,
        defaults: [{ providerID: "aifactory", modelID: "team-default-model" }],
        configured: { providerID: "aifactory", modelID: "team-default-model" },
        visible,
      }),
    ).toEqual(new Set(["aifactory:team-default-model"]))
  })

  test("keeps one non-embedding model visible when base visibility would be empty", () => {
    const items = [
      { providerID: "aifactory", modelID: "team-default-model" },
      { providerID: "aifactory", modelID: "team-secondary-model" },
    ]

    expect(
      computeForcedVisibleModelKeys({
        items,
        defaults: [],
        visible: () => false,
      }),
    ).toEqual(new Set(["aifactory:team-default-model"]))
  })
})
