import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import { statSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Schema } from "effect"

const { FileMatcher } = createRequire(import.meta.resolve("electron-builder"))("app-builder-lib/out/fileMatcher")

test.each(["package:win", "default CLI with metadata override"])(
  "%s loads corporate output, installer hooks and archive filters",
  async (mode) => {
    const directory = path.resolve(import.meta.dir, "..")

    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
import { createYargs, configureBuildCommand, normalizeOptions } from "electron-builder/out/builder";
import { Packager } from "app-builder-lib";
const pkg = await Bun.file("package.json").json();
const args = ${JSON.stringify(mode)} === "package:win"
  ? pkg.scripts["package:win"].split(/\\s+/).slice(1)
  : ["--win", "--x64", "--publish", "never", "-c.extraMetadata.version=2.2.2"];
const options = normalizeOptions(configureBuildCommand(createYargs()).exitProcess(false).parse(args));
const packager = new Packager({ ...options, projectDir: process.cwd() });
await packager.validateConfig();
const config = packager.config;
console.log("RESULT=" + JSON.stringify({
  output: config.directories.output,
  name: config.productName,
  icon: config.win?.icon,
  oneClick: config.nsis?.oneClick,
  include: config.nsis?.include,
  version: config.extraMetadata?.version,
  artifactName: config.artifactName,
  patterns: config.files.flatMap((item) => item.filter ?? []),
}));
  `,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          OPENCODE_TARGET: "windows-x64",
          OPENCODE_CHANNEL: "prod",
          OPENCODE_VERSION: "2.2.2",
          OPENCODE_ELECTRON_OUTPUT_DIR: "  dist-v2.2.2-ai-signed  ",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(code, stdout + stderr).toBe(0)

    const result = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          output: Schema.String,
          name: Schema.String,
          icon: Schema.String,
          oneClick: Schema.Boolean,
          include: Schema.String,
          version: Schema.String,
          artifactName: Schema.String,
          patterns: Schema.Array(Schema.String),
        }),
      ),
    )(
      stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("RESULT="))
        ?.slice(7),
    )

    expect(result).toMatchObject({
      output: "dist-v2.2.2-ai-signed",
      name: "OpenCode",
      icon: "resources/icons/icon.ico",
      oneClick: false,
      version: "2.2.2",
      artifactName: "opencode-desktop-${os}-${arch}.${ext}",
    })
    expect(result.include).toBe(path.join(directory, "resources/windows/installer.nsh"))
    const filter = new FileMatcher(directory, "", (value: string) => value, result.patterns).createFilter()
    const file = statSync(path.join(directory, "package.json"))

    for (const entry of ["out/main/index.js", "out/renderer/index.html", "resources/icons/icon.ico"])
      expect(filter(path.join(directory, entry), file), entry).toBe(true)

    for (const entry of [
      "dist-v2.1.2-ai-signed/win-unpacked/resources/app.asar",
      "dist-v2.1.2-local-signed/setup.exe",
      "updater-helper/bin/helper.exe",
      "resources/opencode-cli.exe",
      "script/build.ts",
    ])
      expect(filter(path.join(directory, entry), file), entry).toBe(false)
  },
  30000,
)

test.skipIf(process.platform !== "win32")(
  "the real Windows wrapper sends the same resolved output to packaging and changelog copying",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-package-output-"))

    try {
      const desktop = path.join(root, "packages/desktop")
      const cli = path.join(root, "cli/cli-windows-x64-baseline")
      const commands = path.join(root, "commands")
      await Promise.all([
        mkdir(desktop, { recursive: true }),
        mkdir(path.join(cli, "bin"), { recursive: true }),
        mkdir(commands),
      ])
      await Bun.write(path.join(desktop, "package.json"), JSON.stringify({ version: "2.2.2" }))
      await Bun.write(
        path.join(desktop, "electron-builder.config.ts"),
        "// Fixture: actual configuration loading is verified by the CLI test.\n",
      )
      await Bun.write(path.join(cli, "package.json"), JSON.stringify({ version: "2.2.2" }))
      await Bun.write(path.join(cli, "bin/opencode.exe"), "Fixture, never executed")
      await Bun.write(path.join(root, "CHANGELOG.md"), "# Packaging fixture\n")
      await Bun.write(
        path.join(commands, "bunx.cmd"),
        `@echo off\r\n"${process.execPath}" "%~dp0runner.mjs" %*\r\nexit /b %errorlevel%\r\n`,
      )
      await Bun.write(
        path.join(commands, "runner.mjs"),
        `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const raw = process.argv.slice(2);
const args = raw.slice(raw.indexOf("run") + 1);
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ args, output: process.env.OPENCODE_ELECTRON_OUTPUT_DIR }) + "\\n");
if (args[0] === "package:win" && process.env.FIXTURE_ARTIFACT !== "missing") {
  mkdirSync(process.env.OPENCODE_ELECTRON_OUTPUT_DIR, { recursive: true });
  writeFileSync(path.join(process.env.OPENCODE_ELECTRON_OUTPUT_DIR, "opencode-desktop-win-x64.exe"), "Fixture, never executed");
}
`,
      )
      const wrapper = path.resolve(import.meta.dir, "../../../script/package-desktop-electron-win.ps1")
      const harness = path.join(root, "run.ps1")
      await Bun.write(
        harness,
        `$env:PATH = '${commands.replaceAll("'", "''")};' + $env:PATH
& '${wrapper.replaceAll("'", "''")}' -WorkingDirectory '${desktop.replaceAll("'", "''")}' -SkipCliBuild
if ($Error.Count) { exit 1 }
Write-Output ('ENV=' + (@{ output = $env:OPENCODE_ELECTRON_OUTPUT_DIR; target = $env:OPENCODE_TARGET } | ConvertTo-Json -Compress))
`,
      )

      const cases = [
        { value: "  dist-v2.2.2-ai signed  ", output: path.join(desktop, "dist-v2.2.2-ai signed") },
        { value: path.join(root, "absolute output [signed]"), output: path.join(root, "absolute output [signed]") },
        { value: "", output: path.join(desktop, "dist") },
        { value: "missing", output: path.join(desktop, "missing"), missing: true },
      ]

      for (const input of cases) {
        const log = path.join(root, "calls.jsonl")
        await Bun.write(log, "")

        const child = Bun.spawn(["pwsh", "-NoLogo", "-NoProfile", "-File", harness], {
          env: {
            ...process.env,
            OPENCODE_ELECTRON_OUTPUT_DIR: input.value,
            OPENCODE_CLI_DIST: path.dirname(cli),
            OPENCODE_VERSION: "2.2.2",
            OPENCODE_TARGET: "original-target",
            FIXTURE_LOG: log,
            FIXTURE_ARTIFACT: input.missing ? "missing" : "present",
          },
          stdout: "pipe",
          stderr: "pipe",
        })

        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])

        expect((await Bun.file(log).text()).trim(), stdout + stderr).not.toBe("")

        const calls = Schema.decodeUnknownSync(
          Schema.Array(Schema.Struct({ args: Schema.Array(Schema.String), output: Schema.String })),
        )(
          (await Bun.file(log).text())
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line)),
        )

        expect(calls).toEqual([
          { args: ["build"], output: input.output },
          { args: ["package:win"], output: input.output },
        ])

        if (input.missing) {
          expect(code).not.toBe(0)
          expect(stderr).toContain("The configured Windows installer was not produced")
          expect(await Bun.file(path.join(input.output, "changelog.md")).exists()).toBe(false)
          continue
        }

        expect(code, stdout + stderr).toBe(0)
        expect(await Bun.file(path.join(input.output, "changelog.md")).text()).toBe("# Packaging fixture\n")

        const restored = Schema.decodeUnknownSync(
          Schema.fromJsonString(Schema.Struct({ output: Schema.NullOr(Schema.String), target: Schema.String })),
        )(
          stdout
            .split(/\r?\n/)
            .find((line) => line.startsWith("ENV="))
            ?.slice(4),
        )

        expect(restored.target).toBe("original-target")
        expect(restored.output ?? "").toBe(input.value)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  30000,
)
