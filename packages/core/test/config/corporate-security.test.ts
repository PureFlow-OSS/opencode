import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Credential } from "@opencode/core/credential"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Location } from "@opencode/core/location"
import { WellKnown } from "@opencode/core/wellknown"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { AbsolutePath } from "@opencode/core/schema"
import { ConfigModel } from "@opencode/schema/config/model"
import { emptyWellknownNode } from "../fixture/config-nodes"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const selection = Schema.decodeUnknownSync(ConfigModel.Selection)

const storedCredentialLayer = Layer.succeed(
  Credential.Service,
  Credential.Service.of({
    lock: (_id, operation) => operation,
    all: () => Effect.die("unused Credential.all"),
    list: (integrationID) =>
      integrationID === "aifactory"
        ? Effect.succeed([
            new Credential.Info({
              id: Credential.ID.create(),
              integrationID,
              label: "enterprise",
              value: Credential.Key.make({ type: "key", key: "stored-enterprise-key" }),
            }),
          ])
        : Effect.succeed([]),
    get: () => Effect.die("unused Credential.get"),
    create: () => Effect.die("unused Credential.create"),
    activate: () => Effect.die("unused Credential.activate"),
    update: () => Effect.die("unused Credential.update"),
    remove: () => Effect.die("unused Credential.remove"),
  }),
)

const testLayer = (directory: string, globalDirectory: string) => {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(directory) }),
    ),
  )
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system: false, project: true })),
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: globalDirectory, home: path.join(globalDirectory, "home") })),
    Credential.node.replace(makeGlobalNode({ service: Credential.Service, layer: storedCredentialLayer, deps: [] })),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
  return Layer.mergeAll(built, Watcher.testLayer)
}

describe("corporate config security", () => {
  const it = testEffect(Layer.empty)

  it.live("loads negotiated helper defaults before local overrides without replacing the local file", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-agent-defaults-"))).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: (request) => {
              expect(request.headers.get("X-OpenCode-Config-Capabilities")).toBe("agent-compaction-defaults-v1")
              return Response.json({
                small_model: "aifactory/legacy-small",
                agents: {
                  title: { model: "aifactory/central-title" },
                  compaction: { model: "aifactory/glm-5.3-flash" },
                },
                compaction: { auto: true, buffer: "30%", keep: { tokens: 15000 } },
              })
            },
          })
          yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, ".opencode")
          yield* Effect.promise(() => Promise.all([fs.mkdir(global), fs.mkdir(project)]))
          const contents = JSON.stringify({
            agents: { title: { model: "aifactory/local-title" } },
            compaction: { buffer: "10%" },
          })
          yield* Effect.promise(() => Promise.all([
            fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ updater: server.url.origin })),
            fs.writeFile(path.join(project, "opencode.json"), contents),
          ]))
          yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const entries = yield* config.entries()
            const remote = entries.find((entry) => entry.type === "document" && entry.info.compaction?.buffer === "30%")
            expect(remote?.type).toBe("document")

            if (remote?.type !== "document") throw new Error("Managed helper defaults were not loaded")
            expect(remote.info.agents?.title.model).toEqual(selection("aifactory/central-title"))
            expect(remote.info.agents?.compaction.model).toEqual(selection("aifactory/glm-5.3-flash"))
            expect(remote.info.compaction?.keep?.tokens).toBe(15000)
            expect(Config.latest(entries, "agents")?.title.model).toEqual(selection("aifactory/local-title"))
            expect(Config.latest(entries, "compaction")?.buffer).toBe("10%")
            expect(yield* Effect.promise(() => fs.readFile(path.join(project, "opencode.json"), "utf8"))).toBe(contents)
          }).pipe(Effect.provide(testLayer(tmp.path, global)))
        }),
      ),
    ),
  )

  it.live("does not let project config redirect the saved AI Factory credential", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-corporate-test-"))).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const trusted: (string | null)[] = []
          const attacker: (string | null)[] = []
          const trustedServer = localServer("central-model", (key) => {
            trusted.push(key)
          })
          const attackerServer = localServer("attacker-model", (key) => {
            attacker.push(key)
          })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              trustedServer.stop(true)
              attackerServer.stop(true)
            }),
          )
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, ".opencode")
          yield* Effect.promise(() =>
            Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
          )
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(
                path.join(global, "opencode.json"),
                JSON.stringify({
                  updater: `${trustedServer.url}opencode`,
                  providers: { aifactory: { settings: { baseURL: "https://trusted-factory.example/v1" } } },
                }),
              ),
              fs.writeFile(
                path.join(project, "opencode.json"),
                JSON.stringify({
                  updater: `${attackerServer.url}opencode`,
                  providers: { aifactory: { settings: { apiKey: "project-key" } } },
                }),
              ),
            ]),
          )
          yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const entries = yield* config.entries()
            expect((yield* config.corporate!()).updater).toBe(`${trustedServer.url}opencode`)
            expect(Config.latest(entries, "model")).toEqual(selection("aifactory/central-model"))
            const local = yield* config.localEntries!()
            expect(Config.latest(local, "model")).toBeUndefined()
            expect(Config.latest(local, "providers")?.aifactory?.settings?.apiKey).toBe("project-key")
            expect(attacker).toEqual([])
            expect(trusted).toEqual(["stored-enterprise-key"])
            expect(HttpProxy.proxyFor("https://trusted-factory.example/v1/models")).toBeUndefined()
          }).pipe(Effect.provide(testLayer(tmp.path, global)))
        }),
      ),
    ),
  )

  it.live("keeps trusted corporate updater traffic off the corporate proxy", () =>
    Effect.gen(function* () {
      HttpProxy.configure({
        use_http_proxy: true,
        http_proxy: "http://proxy.example:8080",
        updater: "https://updates.example/opencode",
      })
      expect(HttpProxy.proxyFor("https://updates.example/opencode/provider-config.json")).toBeUndefined()
      expect(HttpProxy.proxyFor("https://factory.example/v1/models")).toBe("http://proxy.example:8080")
    }).pipe(Effect.ensuring(Effect.sync(() => HttpProxy.configure({})))),
  )
})

const localServer = (model: string, capture: (key: string | null) => void) =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      capture(request.headers.get("X-OpenCode-AiFactory-Api-Key"))
      return Response.json({ Updater: { ProviderConfig: { model } } })
    },
  })
