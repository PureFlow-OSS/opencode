import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Schema } from "effect"

test.skipIf(process.platform !== "win32")(
  "Windows PowerShell safely installs and removes only the CLI user PATH entry",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-cli-path-"))
    const target = "C:\\Entwicklung\\OpenCode\\bin"
    const long = Array.from({ length: 900 }, (_, index) => `C:\\Tools-${index}`).join(";")

    const cases = [
      { name: "missing", action: "Install", before: null, after: target, changed: true },
      { name: "empty", action: "Install", before: "", after: target, changed: true },
      {
        name: "unicode and expandable",
        action: "Install",
        before: "%SystemRoot%\\System32;C:\\Österreich;;",
        after: target + ";%SystemRoot%\\System32;C:\\Österreich;;",
        changed: true,
      },
      {
        name: "repeat install",
        action: "Install",
        before: target + ";C:\\Tools",
        after: target + ";C:\\Tools",
        changed: false,
      },
      {
        name: "older GUI path",
        action: "Install",
        before: "C:\\Entwicklung\\OpenCode;C:\\Tools;" + target,
        after: target + ";C:\\Entwicklung\\OpenCode;C:\\Tools",
        changed: true,
      },
      {
        name: "duplicate and normalized",
        action: "Install",
        before: `"c:/entwicklung/opencode/bin/";C:\\Tools;${target}`,
        after: target + ";C:\\Tools",
        changed: true,
      },
      { name: "long path", action: "Install", before: long, after: target + ";" + long, changed: true },
      {
        name: "uninstall",
        action: "Uninstall",
        before: `%SystemRoot%\\System32;"${target}\\";C:\\Tools;;`,
        after: "%SystemRoot%\\System32;C:\\Tools;;",
        changed: true,
      },
      {
        name: "unrelated prefix",
        action: "Uninstall",
        before: target + "-other",
        after: target + "-other",
        changed: false,
      },
      { name: "last entry", action: "Uninstall", before: target, after: "", changed: true },
      { name: "too long", action: "Install", before: "x".repeat(32760), error: true },
    ]

    try {
      const file = path.join(dir, "check.ps1")
      const module = path.resolve(import.meta.dir, "../resources/windows/cli-path.psm1").replaceAll("'", "''")
      await Bun.write(
        file,
        `\uFEFF$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Import-Module '${module}' -Force
$cases = ConvertFrom-Json @'
${JSON.stringify(cases)}
'@
$results = @($cases | ForEach-Object {
  $case = $_
  try {
    $result = Get-OpenCodePathUpdate -PathValue $case.before -Directory '${target}' -Action $case.action
    @{ name = $case.name; value = $result.Value; changed = $result.Changed }
  } catch { @{ name = $case.name; error = $true } }
})
ConvertTo-Json -InputObject $results -Depth 4 -Compress
`,
      )

      const child = Bun.spawn(
        [
          path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          file,
        ],
        { stdout: "pipe", stderr: "pipe" },
      )

      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])

      expect(code, stderr).toBe(0)

      const results = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Array(
            Schema.Struct({
              name: Schema.String,
              value: Schema.optionalKey(Schema.String),
              changed: Schema.optionalKey(Schema.Boolean),
              error: Schema.optionalKey(Schema.Boolean),
            }),
          ),
        ),
      )(stdout)

      expect(results).toHaveLength(cases.length)

      for (const input of cases) {
        const result = results.find((row) => row.name === input.name)

        if (input.error) expect(result?.error, input.name).toBe(true)
        else expect(result, input.name).toEqual({ name: input.name, value: input.after, changed: input.changed })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  30000,
)

test.skipIf(process.platform !== "win32")(
  "NSIS skips CLI registration by default and compiles the opt-in hooks without executing an installer",
  async () => {
    const { getMakeNsisPath, getNsisPluginsPath } = await import("app-builder-lib/out/toolsets/windows")
    const { nsisTemplatesDir } = await import("app-builder-lib/out/targets/nsis/nsisUtil")
    const { NsisScriptGenerator } = await import("app-builder-lib/out/targets/nsis/nsisScriptGenerator")
    const config = (await import("../electron-builder.config")).default
    const compiler = await getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary)
    const plugins = await getNsisPluginsPath(config.toolsets?.nsis, config.nsis?.customNsisResources)
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-cli-nsis-"))
    const flags = new NsisScriptGenerator()
    flags.flags(["updated"])

    try {
      for (const enabled of [false, true]) {
        const script = path.join(dir, `compile-${enabled}.nsi`)
        await Bun.write(
          script,
          `Unicode true
RequestExecutionLevel user
OutFile "${path.join(dir, `compile-only-${enabled}.exe`)}"
!addplugindir /x86-unicode "${path.join(plugins, "x86-unicode")}"
!addincludedir "${path.join(nsisTemplatesDir, "include")}"
!include LogicLib.nsh
!include StdUtils.nsh
${flags.build()}
!define APP_EXECUTABLE_FILENAME "OpenCode.exe"
!define APP_ID "ai.opencode.desktop"
!define UNINSTALL_FILENAME "Uninstall OpenCode.exe"
!define SHORTCUT_NAME "OpenCode"
${enabled ? "!define OPENCODE_REGISTER_CLI 1" : ""}
!include "${config.nsis?.include}"
${
  enabled
    ? ""
    : `; Fail compilation if either real lifecycle hook attempts CLI registration.
!macroundef installCliCommand
!macro installCliCommand
  !error "CLI command creation must be disabled by default"
!macroend
!macroundef cliUserPath
!macro cliUserPath ACTION
  !error "CLI PATH changes must be disabled by default"
!macroend`
}
Section
!insertmacro customInstall
SectionEnd
Section Uninstall
!insertmacro customUnInstall
SectionEnd
`,
        )

        const child = Bun.spawn([compiler.path, script], {
          env: { ...process.env, ...compiler.env },
          stdout: "pipe",
          stderr: "pipe",
        })

        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])

        expect(code, stdout + stderr).toBe(0)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  30000,
)
