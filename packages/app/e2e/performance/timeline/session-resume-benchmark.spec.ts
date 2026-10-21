import { benchmark, expect } from "../benchmark"
import { setupTimelineBenchmark, textPartID } from "./session-timeline-benchmark.fixture"
import { createServer } from "node:http"
import { once } from "node:events"

benchmark("measures session reloads when returning to a healthy stream", async ({ page, report }) => {
  let connections = 0
  const stream = createServer((_request, response) => {
    connections++
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Access-Control-Allow-Origin": "*",
    })
    response.write(`data: ${JSON.stringify({ payload: { type: "server.connected", properties: {} } })}\n\n`)
    response.write(
      `data: ${JSON.stringify({
        directory: "C:/OpenCode/TimelineStateRegression",
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: textPartID,
              sessionID: "ses_timeline_state_regression",
              messageID: "msg_assistant_regression",
              type: "text",
              text: `Stream connection ${connections}`,
            },
          },
        },
      })}\n\n`,
    )
    const heartbeat = setInterval(() => {
      response.write(`data: ${JSON.stringify({ payload: { type: "server.heartbeat", properties: {} } })}\n\n`)
    }, 1_000)
    response.on("close", () => clearInterval(heartbeat))
  })
  stream.listen(0, "127.0.0.1")
  await once(stream, "listening")
  const address = stream.address()
  if (!address || typeof address === "string") throw new Error("Missing event stream address")

  try {
    const requests: string[] = []
    page.on("request", (request) => {
      if (/\/session\/[^/]+\/message$/.test(new URL(request.url()).pathname)) requests.push(request.url())
    })
    const fixture = await setupTimelineBenchmark(page, {
      historyTurns: 72,
      eventBatch: 1,
      eventStream: `http://127.0.0.1:${address.port}/global/event`,
    })
    const composer = page.locator('[contenteditable="true"][data-component="prompt-input"]')
    await expect(composer).toBeEditable()
    await expect
      .poll(async () => (await fixture.text.textContent())?.includes(`Stream connection ${connections}`))
      .toBe(true)
    const before = requests.length
    const durations = []
    for (let index = 0; index < 5; index++) {
      const start = performance.now()
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
        document.dispatchEvent(new Event("visibilitychange"))
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await composer.fill(`Resume input ${index}`)
      await expect(composer).toHaveText(`Resume input ${index}`)
      durations.push(performance.now() - start)
    }
    await expect(fixture.scroller).toBeVisible()
    const reloads = requests.length - before
    await fixture.scroller.hover()
    await page.mouse.wheel(0, -400)
    await expect
      .poll(() =>
        fixture.scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
      )
      .toBeGreaterThan(80)
    await fixture.scrollToBottom()

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    const previous = connections
    stream.closeAllConnections()
    await expect.poll(() => connections).toBeGreaterThan(previous)
    await expect
      .poll(async () => (await fixture.text.textContent())?.includes(`Stream connection ${connections}`))
      .toBe(true)
    const resumed = page.waitForResponse((response) =>
      /\/session\/[^/]+\/message$/.test(new URL(response.url()).pathname),
    )
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await resumed
    await expect(composer).toHaveText("Resume input 4")
    expect(requests.length - before - reloads).toBe(1)
    report(
      { messageReloads: reloads, reconnectReloads: requests.length - before - reloads, inputDurationsMs: durations },
      { historyTurns: 72, switches: 5 },
    )
    expect(reloads).toBe(0)
  } finally {
    stream.closeAllConnections()
    await new Promise<void>((resolve, reject) => stream.close((error) => (error ? reject(error) : resolve())))
  }
})
