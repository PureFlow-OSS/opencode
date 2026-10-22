import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, Exit, Fiber } from "effect"
import { NetAddress } from "effect/net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ServiceRegistration } from "../src/services/service-registration"

const registration = (file: string) =>
  ServiceRegistration.register({
    address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 4321),
    password: "regression-only",
    id: "new-owner",
    file,
    shutdown: Effect.never,
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer))

async function lockedFile() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-registration-lock-"))
  const file = path.join(root, "service-prod.json")
  await writeFile(file, "previous-registration")
  await writeFile(
    path.join(root, "lock.ps1"),
    `
param([string]$File)
$ErrorActionPreference = 'Stop'
$handle = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
try { [Console]::WriteLine('LOCKED'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null }
finally { $handle.Dispose() }
`,
  )
  const locker = Bun.spawn(["pwsh", "-NoProfile", "-File", path.join(root, "lock.ps1"), "-File", file], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stderr = Bun.readableStreamToText(locker.stderr)
  const timer = setTimeout(() => locker.kill(), 8000)
  const dispose = async () => {
    clearTimeout(timer)
    locker.kill()
    await locker.exited
    await stderr
    await rm(root, { recursive: true, force: true })
  }
  try {
    const ready = await locker.stdout.getReader().read()
    expect(new TextDecoder().decode(ready.value)).toContain("LOCKED")
    return {
      file,
      temp: file + ".new-owner.tmp",
      release: async () => {
        locker.stdin.write("\n")
        locker.stdin.end()
        expect(await locker.exited).toBe(0)
      },
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}

test.skipIf(process.platform !== "win32")(
  "registration survives a temporary Windows sharing lock",
  async () => {
    const lock = await lockedFile()
    try {
      const pending = Effect.runPromise(registration(lock.file).pipe(Effect.exit))
      // Deliberately hold the real deny-delete handle beyond the initial rename attempt.
      await Bun.sleep(300)
      expect(await Bun.file(lock.file).text()).toBe("previous-registration")
      await lock.release()
      expect(Exit.isSuccess(await pending)).toBe(true)
      expect(await Bun.file(lock.file).json()).toMatchObject({ id: "new-owner", password: "regression-only" })
      expect(await Bun.file(lock.temp).exists()).toBe(false)
    } finally {
      await lock.dispose()
    }
  },
  10000,
)

test.skipIf(process.platform !== "win32")(
  "a persistent registration lock fails without deleting the old registration or leaking a temp file",
  async () => {
    const lock = await lockedFile()
    try {
      const start = Date.now()
      const exit = await Effect.runPromise(registration(lock.file).pipe(Effect.exit))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Date.now() - start).toBeGreaterThanOrEqual(1500)
      expect(Date.now() - start).toBeLessThan(5000)
      expect(await Bun.file(lock.file).text()).toBe("previous-registration")
      expect(await Bun.file(lock.temp).exists()).toBe(false)
    } finally {
      await lock.dispose()
    }
  },
  10000,
)

test.skipIf(process.platform !== "win32")(
  "interrupting a registration retry cleans its own temp file",
  async () => {
    const lock = await lockedFile()
    const fiber = Effect.runFork(registration(lock.file))
    try {
      const deadline = Date.now() + 2000
      while (!(await Bun.file(lock.temp).exists())) {
        if (Date.now() > deadline) throw new Error("Registration never wrote its temporary file")
        await Bun.sleep(10)
      }
      await Effect.runPromise(Fiber.interrupt(fiber))
      expect(await Bun.file(lock.file).text()).toBe("previous-registration")
      expect(await Bun.file(lock.temp).exists()).toBe(false)
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber))
      await lock.dispose()
    }
  },
  10000,
)
