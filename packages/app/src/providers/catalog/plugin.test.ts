import { expect, test } from "bun:test"
import type { PluginInfo } from "@opencode/client"
import { pluginRepairContext } from "./plugin"

const plugin = (state: PluginInfo["state"], id = "broken"): PluginInfo => ({
  id,
  source: { type: "package", target: "@example/broken" },
  features: {},
  state,
})

test("builds repair context with a redacted first-line error", () => {
  const context = pluginRepairContext(
    plugin({ status: "failed", error: "Authorization: Bearer abc123456789\nstack frame", ref: "error-ref" }),
    "/tmp/project",
  )

  expect(context).toEqual({
    directory: "/tmp/project",
    plugin: "broken (@example/broken)",
    error: "Authorization: [redacted]",
    errorRef: "error-ref",
  })
})

test("skips blank leading error lines", () => {
  const context = pluginRepairContext(plugin({ status: "failed", error: "\nAPI key: secret-value" }), "/tmp/project")

  expect(context?.error).toBe("API key: [redacted]")
})

test("does not build repair context for an active plugin", () => {
  expect(pluginRepairContext(plugin({ status: "active" }), "/tmp/project")).toBeUndefined()
})
