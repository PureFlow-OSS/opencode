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
  "installer grants sandbox access without changing unrelated permissions",
  async () => {
    const { getMakeNsisPath } = await import("app-builder-lib/out/toolsets/windows")
    const config = (await import("../electron-builder.config")).default
    const compiler = await getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary)
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-installer-"))

    const run = (cmd: string[]) => runNsis(compiler, cmd, dir)

    const acl = (file: string) =>
      run([
        "pwsh",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Acl -LiteralPath (Join-Path $env:OPENCODE_INSTALLER_TEST_ROOT '${file}')).Sddl`,
      ])

    try {
      await Bun.write(path.join(dir, "app/runtime/icudtl.dat"), "runtime fixture")
      await Bun.write(path.join(dir, "unrelated.txt"), "outside the installation")
      await run(["icacls.exe", path.join(dir, "app"), "/grant", "*S-1-15-2-999-999-999:(OI)(CI)(F)"])
      const parent = await acl(".")
      const unrelated = await acl("unrelated.txt")
      await Bun.write(
        path.join(dir, "installer.nsi"),
        `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${path.join(dir, "installer.exe")}"
!include "${config.nsis?.include}"
Section
  StrCpy $INSTDIR "$EXEDIR\\app"
  !insertmacro customInstall
SectionEnd
`,
      )
      await run([compiler.path, path.join(dir, "installer.nsi")])
      await run([path.join(dir, "installer.exe")])
      const installed = await acl("app/runtime/icudtl.dat")
      expect(installed).toContain("(A;ID;0x1200a9;;;S-1-15-2-2)")
      expect(installed).toContain("S-1-15-2-999-999-999")
      await run([path.join(dir, "installer.exe")])
      expect(await acl("app/runtime/icudtl.dat")).toBe(installed)
      expect(await acl(".")).toBe(parent)
      expect(await acl("unrelated.txt")).toBe(unrelated)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  120_000,
)

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
