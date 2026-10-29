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
    ).toBe("C:\\Entwicklung\\ai.opencode.desktop\\updates")
    expect(
      updateCacheDirectory({
        platform: "win32",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "C:/Entwicklung/OpenCode/cache",
      }),
    ).toBe("C:\\Entwicklung\\ai.opencode.desktop\\updates")
  })

  test.each(["", "D:/opencode-cache", "C:/Users/test/AppData/cache", "C:/Entwicklung-other", "C:/Entwicklung/../Temp"])(
    "keeps installer downloads within the allowlisted directory for cache %s",
    (cacheDirectory) => {
      expect(
        updateCacheDirectory({
          platform: "win32",
          installDirectory: "C:/Entwicklung/OpenCode",
          cacheDirectory,
        }),
      ).toBe("C:\\Entwicklung\\ai.opencode.desktop\\updates")
    },
  )

  test("preserves allowed custom subdirectories and ignores a custom cache outside Windows", () => {
    expect(
      updateCacheDirectory({
        platform: "win32",
        installDirectory: "C:/Entwicklung/OpenCode",
        cacheDirectory: "C:/Entwicklung/custom-cache",
      }),
    ).toBe("C:\\Entwicklung\\custom-cache")
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
