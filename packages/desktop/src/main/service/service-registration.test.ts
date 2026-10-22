import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { serviceRegistrationFile } from "./service-registration"

test.each([
  { channel: "prod", file: "service-prod.json" },
  { channel: "dev", file: "service.json" },
  { channel: "beta", file: "service.json" },
  { channel: "latest", file: "service.json" },
  { channel: "next", file: "service.json" },
  { channel: "local", file: "service-local.json" },
  { channel: "custom/channel", file: "service-custom-channel.json" },
])("channel $channel uses $file", ({ channel, file }) => {
  const state = mkdtempSync(path.join(tmpdir(), "opencode-service-registration-"))

  try {
    expect(serviceRegistrationFile({ state, channel })).toBe(path.join(state, "opencode", file))
  } finally {
    rmSync(state, { recursive: true, force: true })
  }
})