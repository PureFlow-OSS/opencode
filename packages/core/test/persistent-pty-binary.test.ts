import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

// Corporate Windows application control permits executables only below C:\Entwicklung.
test.skipIf(process.platform !== "win32")(
  "extracts the packaged terminal helper beside the staged CLI instead of the user cache",
  async () => {
    const parent = "C:\\Entwicklung\\OpenCode-Pty-Probe"
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(path.join(parent, "binary-"))

    try {
      const asset = path.join(directory, "fixture.bin")
      const entry = path.join(directory, "entry.ts")
      const executable = path.join(directory, "opencode-cli.exe")
      const cache = path.join(directory, "user-cache")
      const contents = "Terminal helper fixture; never executed"
      const hash = createHash("sha256").update(contents).digest("hex")
      await writeFile(asset, contents)
      await writeFile(
        entry,
        `import { resolveBinary } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/persistent-pty/binary.bun.ts"))}; console.log(await resolveBinary(${JSON.stringify(cache)}));`,
      )
      const build = await Bun.build({
        entrypoints: [entry],
        target: "bun",
        compile: { outfile: executable },
        plugins: [{
          name: "embedded-terminal-fixture",
          setup(build) {
            build.onLoad({ filter: /persistent-pty[/\\]pty-binding\.ts$/ }, () => ({
              loader: "ts",
              contents: `export default ${JSON.stringify({ path: asset, version: "fixture", sha256: hash })}`,
            }))
          },
        }],
      })
      expect(build.success).toBe(true)
      const child = Bun.spawn([executable], {
        env: { ...process.env, OPENCODE_PTY_BIN: undefined },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code, stderr).toBe(0)
      const expected = path.join(directory, "opencode-pty", `fixture-${hash.slice(0, 16)}`, "opencode-pty.exe")
      expect(stdout.trim()).toBe(expected)
      expect(await readFile(expected, "utf8")).toBe(contents)
      expect(await Bun.file(path.join(cache, "opencode-pty")).exists()).toBe(false)
    } finally {
      if (path.dirname(directory) !== parent) throw new Error("Unexpected terminal probe directory")
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)
