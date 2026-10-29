export * as Plugin from "./plugin.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"), Schema.annotate({ identifier: "Plugin.ID" }))
export type ID = typeof ID.Type

/** A registry package, optionally pinned to a version or dist-tag; never a local path or URL. */
export const Package = Schema.String.check(
  Schema.isMaxLength(256),
  Schema.isPattern(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9.+_-]*)?(?![\s\S])/),
).annotate({ identifier: "Plugin.Package" })
export type Package = typeof Package.Type

export interface StoreItem extends Schema.Schema.Type<typeof StoreItem> {}
export const StoreItem = Schema.Struct({
  name: Schema.NonEmptyString,
  package: Package,
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "Plugin.StoreItem" })

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  store: Schema.Array(StoreItem),
  /** False when the updater feed is unavailable; local removals remain possible. */
  available: Schema.Boolean,
  /** Global package declarations only, excluding plugin options and project/managed configuration. */
  packages: Schema.Array(Schema.String),
}).annotate({ identifier: "Plugin.Catalog" })

export const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("builtin") }),
  Schema.Struct({
    type: Schema.Literal("package"),
    target: Schema.String,
    version: Schema.String.pipe(optional),
    outdated: Schema.Literal(true).pipe(optional),
    updating: Schema.Literal(true).pipe(optional),
  }),
  Schema.Struct({ type: Schema.Literal("local"), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sdk") }),
]).annotate({ identifier: "Plugin.Source" })
export type Source = typeof Source.Type

export const Features = Schema.Struct({
  server: Schema.Literal(true).pipe(optional),
  tui: Schema.Literal(true).pipe(optional),
  rpc: Schema.Literal(true).pipe(optional),
  /** The package exports `./gui-experimental`, the GUI bundle the desktop app loads. */
  gui: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Plugin.Features" })
export type Features = typeof Features.Type

/** A plugin's prebuilt CommonJS `./gui-experimental` bundle. */
export interface GuiBundle extends Schema.Schema.Type<typeof GuiBundle> {}
export const GuiBundle = Schema.Struct({
  /** The bundle's CommonJS code. */
  code: Schema.String,
  /** An opaque value that changes whenever the plugin, its options or its bundle change. */
  revision: Schema.String,
  /** The plugin's options from its `opencode.json` entry, as its server entry receives them. */
  options: Schema.Record(Schema.String, Schema.Json),
}).annotate({ identifier: "Plugin.GuiBundle" })

export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("active") }),
  Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String, ref: Schema.String.pipe(optional) }),
]).annotate({ identifier: "Plugin.State" })
export type State = typeof State.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID.pipe(optional),
  source: Source,
  features: Features,
  state: State,
}).annotate({ identifier: "Plugin.Info" })

const Updated = ephemeral({
  type: "plugin.updated",
  schema: {},
})
export const Event = { Updated, Definitions: inventory(Updated) }
