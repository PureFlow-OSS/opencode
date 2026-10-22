import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Base64 } from "../src/prompt.js"

describe("Prompt.Base64", () => {
  test("accepts large varied-byte attachments without regex backtracking", () => {
    const data = Buffer.alloc(12 * 1024 * 1024, Buffer.from(Array.from({ length: 256 }, (_, index) => index)))

    const encoded = data.toString("base64")
    expect(Schema.decodeUnknownSync(Base64)(encoded) === encoded).toBe(true)
  })

  test("preserves base64 padding rules and rejects invalid alphabets and lengths", () => {
    for (const value of ["", "aGVsbG8=", "YWJjZA==", "aGVsbG8h", "QUJDRA=="])
      expect(Schema.decodeUnknownSync(Base64)(value)).toBe(value)

    for (const value of [
      "aGVsbG8==",
      "QUJDRA",
      "aGVsbG",
      "aGVsb G8=",
      "aGVsbG8-",
      "====",
      "aGVsbG8=~",
      "AA=A",
      "AAA_",
      "AAAA\n",
      "AAA\n",
      "AA\r\n",
    ])
      expect(() => Schema.decodeUnknownSync(Base64)(value)).toThrow()
  })

  test("exports exact base64 constraints as valid JSON Schema", () => {
    const schema = Schema.toJsonSchemaDocument(Base64)

    expect(schema.definitions["Prompt.Base64"]).toEqual({
      type: "string",
      pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
    })
  })
})
