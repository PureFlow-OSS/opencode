// Deep imports: the @effect/platform-node barrel eagerly pulls in undici,
// ioredis, and node:sqlite, which runtimes such as workerd cannot load.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { Effect, FileSystem, Layer, Path } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { makeGlobalNode } from "./app-node.js"
import { HttpProxy } from "../http-proxy.js"

export const filesystem = makeGlobalNode({ service: FileSystem.FileSystem, layer: NodeFileSystem.layer, deps: [] })
export const path = makeGlobalNode({ service: Path.Path, layer: NodePath.layer, deps: [] })
export const httpClient = makeGlobalNode({
  service: HttpClient.HttpClient,
  layer: Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.transform(client, (effect) =>
        Effect.flatMap(FetchHttpClient.Fetch, (current) =>
          Effect.provideService(
            effect,
            FetchHttpClient.Fetch,
            current === globalThis.fetch ? HttpProxy.fetch : current,
          ),
        ),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer)),
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
