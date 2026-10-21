export * as Bom from "./bom.js"

import { Effect } from "effect"
import type { FSUtil } from "./fs-util.js"

const code = 0xfeff
const value = String.fromCharCode(code)
const windows1252 = new Map([
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
const windows1252CodePoints = new Map(Array.from(windows1252, ([code, byte]) => [byte, code]))

export type Encoding = "utf-8" | "windows-1252"

export class RepresentableError extends Error {
  constructor(readonly character: string) {
    super(`Cannot preserve Windows-1252 encoding: character ${JSON.stringify(character)} cannot be represented.`)
  }
}

export function split(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  return bom ? value + stripped : stripped
}

export function has(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

export function detect(content: Uint8Array, partial = false): Encoding {
  try {
    decode(content, "utf-8", partial)
    return "utf-8"
  } catch {
    return "windows-1252"
  }
}

export function encode(text: string, encoding: Encoding = "utf-8") {
  if (encoding === "utf-8") return new TextEncoder().encode(text)
  const source = split(text).text
  const content = Array.from(
    Array.from(source, (character) => {
      const characterCode = character.codePointAt(0)!
      const mapped = windows1252.get(characterCode)
      if (mapped !== undefined) return mapped
      if (characterCode <= 0xff && !windows1252CodePoints.has(characterCode)) return characterCode
      throw new RepresentableError(character)
    }),
  )
  return Uint8Array.from(split(text).bom ? [0xef, 0xbb, 0xbf, ...content] : content)
}

export function decodeBytes(content: Uint8Array, encoding: Encoding = detect(content)) {
  return { ...split(decode(content, encoding)), encoding }
}

export function syncBytes(content: Uint8Array, bom: boolean, encoding: Encoding = detect(content)) {
  const current = decodeBytes(content)
  const canonical = join(current.text, bom)
  const bytes = encode(canonical, encoding)
  return {
    text: current.text,
    encoding,
    bytes:
      current.encoding === encoding &&
      bytes.length === content.length &&
      bytes.every((byte, index) => byte === content[index])
        ? undefined
        : bytes,
  }
}

export const readFile = Effect.fn("Bom.readFile")(function* (fs: FSUtil.Interface, filepath: string) {
  return decodeBytes(yield* fs.readFile(filepath))
})

export const syncFile = Effect.fn("Bom.syncFile")(function* (
  fs: FSUtil.Interface,
  filepath: string,
  bom: boolean,
  encoding?: Encoding,
) {
  const content = yield* fs.readFile(filepath)
  const synced = syncBytes(content, bom, encoding)
  if (synced.bytes) yield* fs.writeWithDirs(filepath, synced.bytes)
  return synced.text
})

export function decode(content: Uint8Array, encoding: Encoding, partial = false) {
  if (encoding === "windows-1252") return decodeWindows1252(content)
  return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(content, { stream: partial })
}

function decodeWindows1252(content: Uint8Array) {
  const text = has(content) ? content.subarray(3) : content
  return (has(content) ? value : "") + Array.from(text, decodeWindows1252Byte).join("")
}

function decodeWindows1252Byte(byte: number) {
  // These five bytes are undefined in Windows-1252. Keep them as C1 controls
  // instead of letting the decoder silently replace them.
  return String.fromCodePoint(windows1252CodePoints.get(byte) ?? byte)
}
