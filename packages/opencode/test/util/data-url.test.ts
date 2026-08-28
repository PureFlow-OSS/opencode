import { describe, expect, test } from "bun:test"
import { decodeDataUrl, decodeDataUrlBytes } from "../../src/util/data-url"

describe("decodeDataUrl", () => {
  test("decodes base64 data URLs", () => {
    const body = '{\n  "ok": true\n}\n'
    const url = `data:text/plain;base64,${Buffer.from(body).toString("base64")}`
    expect(decodeDataUrl(url)).toBe(body)
  })

  test("decodes plain data URLs", () => {
    expect(decodeDataUrl("data:text/plain,hello%20world")).toBe("hello world")
  })

  test("preserves binary base64 data", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x81, 0xff])
    const url = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`
    expect(decodeDataUrlBytes(url)).toEqual(bytes)
  })
})
