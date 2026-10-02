import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"

import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)
const systemHook = "experimental.chat.system.transform"

function withProject<A, E, R>(source: string | string[], self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const sources = Array.isArray(source) ? source : [source]
    const files = sources.map((_, index) => path.join(test.directory, `plugin-${index}.ts`))
    yield* Effect.all(
      [
        ...files.map((file, index) => Effect.promise(() => Bun.write(file, sources[index]))),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: files.map((file) => pathToFileURL(file).href),
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: 2 },
    )
    return yield* self
  })
}

const triggerSystemTransform = Effect.fn("PluginTriggerTest.triggerSystemTransform")(function* () {
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    systemHook,
    {
      model: {
        providerID: ProviderV2.ID.anthropic,
        modelID: ModelV2.ID.make("claude-sonnet-4-6"),
      },
    },
    out,
  )
  return out.system
})

describe("plugin.trigger", () => {
  it.instance("runs synchronous hooks without crashing", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["sync"])
      }),
    ),
  )

  it.instance("awaits asynchronous hooks", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: async (_input, output) => {`,
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["async"])
      }),
    ),
  )

  it.instance("disables a failing plugin without blocking other hooks", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const attempts = path.join(test.directory, "attempts.txt")
      yield* withProject(
        [
          [
            "export default async () => ({",
            `  ${JSON.stringify(systemHook)}: async () => {`,
            `    const file = Bun.file(${JSON.stringify(attempts)})`,
            '    await Bun.write(file, String(Number(await file.text().catch(() => "0")) + 1))',
            '    throw new Error("missing dependency")',
            "  },",
            "})",
            "",
          ].join("\n"),
          [
            "export default async () => ({",
            `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
            '    output.system.push("healthy")',
            "  },",
            "})",
            "",
          ].join("\n"),
        ],
        Effect.gen(function* () {
          expect(yield* triggerSystemTransform()).toEqual(["healthy"])
          expect(yield* triggerSystemTransform()).toEqual(["healthy"])
          expect(yield* Effect.promise(() => Bun.file(attempts).text())).toBe("1")

          const plugin = yield* Plugin.Service
          expect((yield* plugin.list()).length).toBe(1)
        }),
      )
    }),
  )
})
