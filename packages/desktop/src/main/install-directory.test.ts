import { describe, expect, test } from "bun:test"

import { WINDOWS_INSTALL_DIRECTORY, resolveInstallDirectory } from "./install-directory"

describe("install directory", () => {
  test("keeps the corporate Windows install directory", () => {
    expect(resolveInstallDirectory(undefined)).toBe(WINDOWS_INSTALL_DIRECTORY)
    expect(resolveInstallDirectory("C:\\Entwicklung\\OpenCode")).toBe(WINDOWS_INSTALL_DIRECTORY)
    expect(resolveInstallDirectory("C:/Entwicklung/OpenCode")).toBe(WINDOWS_INSTALL_DIRECTORY)
  })

  test("rejects malformed installer paths", () => {
    expect(resolveInstallDirectory("C:EntwicklungOpenCode")).toBeNull()
    expect(resolveInstallDirectory("C:/Entwicklung/OpenCode/")).toBe(WINDOWS_INSTALL_DIRECTORY)
    expect(resolveInstallDirectory("C:/Other/OpenCode")).toBeNull()
  })
})
