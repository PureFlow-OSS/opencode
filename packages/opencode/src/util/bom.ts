import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

const BOM_CODE = 0xfeff
const BOM = String.fromCharCode(BOM_CODE)
const WINDOWS_1252 = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x2c6, 0x88],
  [0x2030, 0x89],
  [0x160, 0x8a],
  [0x2039, 0x8b],
  [0x152, 0x8c],
  [0x17d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x2dc, 0x98],
  [0x2122, 0x99],
  [0x161, 0x9a],
  [0x203a, 0x9b],
  [0x153, 0x9c],
  [0x17e, 0x9e],
  [0x178, 0x9f],
])

export type Encoding = "utf-8" | "windows-1252"

export function split(text: string) {
  if (text.charCodeAt(0) !== BOM_CODE) return { bom: false, text }
  return { bom: true, text: text.slice(1) }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  if (!bom) return stripped
  return BOM + stripped
}

export function encode(text: string, encoding: Encoding) {
  if (encoding === "utf-8") return new TextEncoder().encode(text)
  return Uint8Array.from(
    Array.from(text, (character) => {
      const code = character.codePointAt(0)!
      const mapped = WINDOWS_1252.get(code)
      if (mapped !== undefined) return mapped
      if (code <= 0xff) return code
      throw new Error(`Cannot preserve Windows-1252 encoding for character ${JSON.stringify(character)}`)
    }),
  )
}

export function detect(bytes: Uint8Array): Encoding {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true })
    return "utf-8"
  } catch {
    return "windows-1252"
  }
}

export const readFile = Effect.fn("Bom.readFile")(function* (fs: FSUtil.Interface, filePath: string) {
  const bytes = yield* fs.readFile(filePath)
  try {
    return {
      ...split(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)),
      encoding: "utf-8" as const,
    }
  } catch {
    return { ...split(new TextDecoder("windows-1252").decode(bytes)), encoding: "windows-1252" as const }
  }
})

export const writeFile = Effect.fn("Bom.writeFile")(function* (
  fs: FSUtil.Interface,
  filePath: string,
  text: string,
  bom: boolean,
  encoding: Encoding,
) {
  yield* fs.writeWithDirs(filePath, encode(join(text, bom), encoding))
})

export const syncFile = Effect.fn("Bom.syncFile")(function* (
  fs: FSUtil.Interface,
  filePath: string,
  bom: boolean,
  encoding: Encoding,
) {
  const current = yield* readFile(fs, filePath)
  if (current.bom === bom && current.encoding === encoding) return current.text
  yield* writeFile(fs, filePath, current.text, bom, encoding)
  return current.text
})
