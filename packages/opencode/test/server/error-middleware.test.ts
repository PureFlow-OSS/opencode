import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { ErrorMiddleware } from "../../src/server/middleware"

function app() {
  return new Hono().onError(ErrorMiddleware)
}

describe("ErrorMiddleware", () => {
  test("returns a safe unknown error body with a reference id", async () => {
    const response = await app()
      .get("/boom", () => {
        throw new Error("secret stack marker")
      })
      .request("/boom")

    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      name: "UnknownError",
      data: {
        message: "Unexpected server error. Check server logs for details.",
      },
    })
    expect((body as { data?: { ref?: unknown } }).data?.ref).toMatch(/^err_[0-9a-f-]{8}$/)
    expect(serialized).not.toContain("secret stack marker")
  })
})
