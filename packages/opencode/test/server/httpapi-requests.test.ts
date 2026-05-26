import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return InstanceRoutes(websocket)
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("request HttpApi errors", () => {
  test("returns not found for missing permission and question requests", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }

    const [permission, questionReply, questionReject] = await Promise.all([
      app().request("/permission/per_missing/reply", {
        method: "POST",
        headers,
        body: JSON.stringify({ reply: "reject" }),
      }),
      app().request("/question/que_missing/reply", {
        method: "POST",
        headers,
        body: JSON.stringify({ answers: [["Option 1"]] }),
      }),
      app().request("/question/que_missing/reject", {
        method: "POST",
        headers,
      }),
    ])

    for (const [response, requestType, requestID] of [
      [permission, "permission", "per_missing"],
      [questionReply, "question", "que_missing"],
      [questionReject, "question", "que_missing"],
    ] as const) {
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        _tag: "RequestNotFoundError",
        requestType,
        requestID,
      })
    }
  })
})
