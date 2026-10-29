import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

async function runNsis(
  compiler: { path: string; env: Record<string, string | undefined> },
  cmd: string[],
  root: string,
) {
  const result = Bun.spawn(cmd, {
    env: { ...process.env, ...compiler.env, OPENCODE_INSTALLER_TEST_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ])

  expect(code, `${stdout}\n${stderr}`).toBe(0)

  return stdout.trim()
}

test.skipIf(process.platform !== "win32")(
  "installer forces the corporate install location after earlier path resolution",
  async () => {
    const { getMakeNsisPath } = await import("app-builder-lib/out/toolsets/windows")
    const config = (await import("../electron-builder.config")).default
    const compiler = await getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary)
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-installer-path-"))
    const run = (cmd: string[]) => runNsis(compiler, cmd, dir)

    try {
      await Bun.write(
        path.join(dir, "installer.nsi"),
        `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${path.join(dir, "installer.exe")}"
!include "${config.nsis?.include}"
Function .onInit
  StrCpy $INSTDIR "$EXEDIR\\legacy"
  !insertmacro customInit
FunctionEnd
Section
  FileOpen $0 "$EXEDIR\\installdir.txt" w
  FileWrite $0 $INSTDIR
  FileClose $0
SectionEnd
`,
      )
      await run([compiler.path, path.join(dir, "installer.nsi")])

      const override = path.join(dir, "override")
      await run([path.join(dir, "installer.exe"), "/D=" + override])
      expect(await Bun.file(path.join(dir, "installdir.txt")).text()).toBe("C:\\Entwicklung\\OpenCode")

      await run([path.join(dir, "installer.exe")])
      expect(await Bun.file(path.join(dir, "installdir.txt")).text()).toBe("C:\\Entwicklung\\OpenCode")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  120_000,
)
