import { describe, expect, test } from "bun:test"
import path from "node:path"
import { updateAppAdapter, updateCacheDirectory } from "./cache"

describe("updater cache directory", () => {
  test("allows C:/Entwicklung and normalizes Windows user paths", () => {
    expect(
      updateCacheDirectory({
        platform: "win32",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "C:/Entwicklung",
      }),
    ).toBe(path.win32.resolve("C:/Entwicklung"))
    expect(
      updateCacheDirectory({
        platform: "win32",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "C:\\Entwicklung\\",
      }),
    ).toBe(path.win32.resolve("C:/Entwicklung"))
  })

  test("rejects the fixed installation subtree and compares paths case-insensitively", () => {
    expect(
      updateCacheDirectory({
        platform: "win32",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "c:/entwicklung/opencode",
      }),
    ).toBeUndefined()
    expect(
      updateCacheDirectory({
        platform: "win32",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "C:/Entwicklung/OpenCode/cache",
      }),
    ).toBeUndefined()
  })

  test("allows other drives and ignores a custom cache outside Windows", () => {
    expect(
      updateCacheDirectory({
        platform: "win32",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "D:/opencode-cache",
      }),
    ).toBe(path.win32.resolve("D:/opencode-cache"))
    expect(
      updateCacheDirectory({
        platform: "linux",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "C:/Entwicklung",
      }),
    ).toBeUndefined()
  })

  test("builds the updater app adapter without moving Electron user data", () => {
    const adapter = updateAppAdapter({
      version: "2.1.2",
      name: "OpenCode",
      isPackaged: true,
      resourcesPath: "C:/resources",
      appPath: "C:/app",
      userDataPath: "C:/Users/test/AppData/Roaming/OpenCode",
      cacheDirectory: "C:/Entwicklung",
      whenReady: () => Promise.resolve(),
      relaunch: () => {},
      quit: () => {},
      onQuit: () => {},
    })

    expect(adapter).toMatchObject({
      appUpdateConfigPath: path.join("C:/resources", "app-update.yml"),
      userDataPath: "C:/Users/test/AppData/Roaming/OpenCode",
      baseCachePath: "C:/Entwicklung",
    })
  })
})
