#!/usr/bin/env bun

const version = Bun.argv[2]?.trim() || "1.14.29"
const sourceDir = Bun.argv[3]?.trim() || "../../packages/desktop-electron/dist-localhost"
const targetDir = Bun.argv[4]?.trim() || "./feed"

await Bun.write(
  `${targetDir}/latest.yml`,
  (await Bun.file(`${sourceDir}/latest.yml`).text())
    .replace(/^version: .+$/m, `version: ${version}`)
    .replace(/^releaseDate: .+$/m, `releaseDate: "${new Date().toISOString()}"`),
)

await Bun.write(
  `${targetDir}/opencode-electron-win-x64.exe`,
  await Bun.file(`${sourceDir}/opencode-electron-win-x64.exe`).arrayBuffer(),
)

await Bun.write(
  `${targetDir}/opencode-electron-win-x64.exe.blockmap`,
  await Bun.file(`${sourceDir}/opencode-electron-win-x64.exe.blockmap`).arrayBuffer(),
)

await Bun.write(`${targetDir}/changelog.md`, await Bun.file(`${sourceDir}/changelog.md`).text())

console.log(`local feed synced to ${targetDir} with version ${version}`)
