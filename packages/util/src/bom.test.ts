import { describe, expect, test } from "bun:test"
import { Bom } from "./bom.js"

describe("Bom", () => {
  test.each([
    ["UTF-16LE", [0xff, 0xfe, 0x61, 0]],
    ["UTF-16BE", [0xfe, 0xff, 0, 0x61]],
    ["UTF-32LE", [0xff, 0xfe, 0, 0, 0x61, 0, 0, 0]],
    ["UTF-32BE", [0, 0, 0xfe, 0xff, 0, 0, 0, 0x61]],
  ] as const)("rejects a recognized %s BOM", (encoding, bytes) => {
    const content = Uint8Array.from(bytes)
    const message = `Unsupported text encoding: ${encoding} BOM.`
    expect(() => Bom.detect(content)).toThrow(message)
    expect(() => Bom.decodeBytes(content)).toThrow(message)
    expect(() => Bom.decodeBytes(content, "windows-1252")).toThrow(message)
    expect(() => Bom.syncBytes(content, false, "windows-1252")).toThrow(message)
    expect(content).toEqual(Uint8Array.from(bytes))
  })

  test("keeps UTF-8 and BOM bytes unchanged", () => {
    const bytes = new TextEncoder().encode("﻿hello")

    expect(Bom.detect(bytes)).toBe("utf-8")
    expect(Bom.decodeBytes(bytes)).toEqual({ text: "hello", bom: true, encoding: "utf-8" })
    expect(Bom.encode("hello", "utf-8")).toEqual(new TextEncoder().encode("hello"))
    expect(Bom.syncBytes(bytes, true).bytes).toBeUndefined()
    expect(Bom.syncBytes(new TextEncoder().encode("\uFEFF\uFEFF\uFEFFhello"), true).bytes).toEqual(bytes)
    expect(Bom.syncBytes(new TextEncoder().encode("\uFEFF"), false).bytes).toEqual(new Uint8Array())
  })

  test("decodes and round-trips Windows-1252", () => {
    const bytes = Uint8Array.from([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x20, 0x80, 0x93, 0x94, 0x97])

    expect(Bom.detect(bytes)).toBe("windows-1252")
    expect(Bom.decodeBytes(bytes)).toEqual({
      text: "Grüße €“”—",
      bom: false,
      encoding: "windows-1252",
    })
    expect(Bom.encode(Bom.decodeBytes(bytes).text, "windows-1252")).toEqual(bytes)
    expect(Bom.syncBytes(bytes, false, "windows-1252").bytes).toBeUndefined()
    const allBytes = Uint8Array.from({ length: 256 }, (_, byte) => byte)
    expect(Bom.encode(Bom.decodeBytes(allBytes, "windows-1252").text, "windows-1252")).toEqual(allBytes)
  })

  test("preserves a UTF-8 BOM when syncing a Windows-1252 file", () => {
    const bytes = Uint8Array.from([0x47, 0x72, 0xfc, 0xdf, 0x65])
    const decoded = Bom.decodeBytes(bytes)

    expect(decoded).toEqual({ text: "Grüße", bom: false, encoding: "windows-1252" })
    expect(Bom.syncBytes(bytes, false, "windows-1252").bytes).toBeUndefined()
    expect(Bom.syncBytes(bytes, true, "windows-1252").bytes).toEqual(
      Uint8Array.from([0xef, 0xbb, 0xbf, 0x47, 0x72, 0xfc, 0xdf, 0x65]),
    )
    expect(Bom.decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]))).toEqual({
      text: "Grüße",
      bom: true,
      encoding: "windows-1252",
    })
  })

  test("reports the exact character that Windows-1252 cannot represent", () => {
    expect(() => Bom.encode("checked ✓", "windows-1252")).toThrow(
      'Cannot preserve Windows-1252 encoding: character "✓" cannot be represented.',
    )
    expect(() => Bom.encode("\u0080", "windows-1252")).toThrow(Bom.RepresentableError)
  })
})
