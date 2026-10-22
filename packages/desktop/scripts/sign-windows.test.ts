import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test.skipIf(process.platform !== "win32").each([
  { name: "released sharing violation", hresult: "80070020", release: true, attempts: 2, success: true },
  { name: "persistent sharing violation", hresult: "80070020", release: false, attempts: 5, success: false },
  { name: "timestamp failure", hresult: "80072EE7", release: false, attempts: 1, success: false },
])(
  "Windows signing handles $name",
  async (input) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-sign-retry-"))
    try {
      await Bun.write(path.join(dir, "installer.exe"), "signing test fixture")
      await Bun.write(
        path.join(dir, "AzureSignTool.cmd"),
        [
          "@echo off",
          'echo attempt>>"%~dp0attempts.txt"',
          ...(input.release ? ['if exist "%~dp0seen" exit /b 0', 'echo seen>"%~dp0seen"'] : []),
          `echo Signing failed with error ${input.hresult}.`,
          "exit /b 23",
          "",
        ].join("\r\n"),
      )
      const child = Bun.spawn(
        [
          "pwsh",
          "-NoLogo",
          "-NoProfile",
          "-File",
          path.resolve(import.meta.dir, "../../../script/sign-windows.ps1"),
          path.join(dir, "installer.exe"),
        ],
        {
          env: {
            ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path")),
            PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
            AZURE_KEYVAULT_URL: "https://signing-test.invalid",
            AZURE_KEYVAULT_CLIENT_ID: "test-client",
            AZURE_KEYVAULT_CLIENT_SECRET: "test-secret",
            AZURE_KEYVAULT_TENANT_ID: "test-tenant",
            AZURE_KEYVAULT_CERT: "test-certificate",
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
      expect(code === 0, stdout + stderr).toBe(input.success)
      expect(await Bun.file(path.join(dir, "attempts.txt")).exists(), stdout + stderr).toBe(true)
      expect((await Bun.file(path.join(dir, "attempts.txt")).text()).trim().split(/\r?\n/)).toHaveLength(input.attempts)
      expect(stdout).toContain(input.hresult)
      if (!input.success) expect(stderr).toContain(`after ${input.attempts} attempt(s)`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  20_000,
)
