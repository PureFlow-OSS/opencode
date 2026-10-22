import { expect, test } from "@playwright/test"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"

test.use({ viewport: { width: 1440, height: 900 } })

test("navigates the virtualized conversation through the history ribbon", async ({ page }, testInfo) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page, { sessionIDs: [fixture.targetID] })
  await page.goto(sessionHref(fixture.targetID))
  const rail = page.locator('[data-component="message-nav"][data-size="compact"]')
  await expect(rail).toBeVisible()
  const first = rail.getByRole("button").first()
  const label = await first.getAttribute("aria-label")
  expect(label).toBeTruthy()
  await first.hover()
  const overview = page.locator('[data-slot="message-nav-hovercard-content"]')
  await expect(overview).toBeVisible()
  await expect(overview.getByRole("button")).toHaveCount(1)
  await expect(overview.locator('[data-slot="message-nav-preview-title"]')).toHaveText(label!)
  await expect(overview.locator('[data-slot="message-nav-preview-body"]')).not.toBeEmpty()
  const firstY = (await overview.boundingBox())!.y
  const second = rail.getByRole("button").nth(1)
  const secondLabel = await second.getAttribute("aria-label")
  await second.hover()
  await expect(overview.locator('[data-slot="message-nav-preview-title"]')).toHaveText(secondLabel!)
  await expect.poll(async () => (await overview.boundingBox())!.y).toBeGreaterThan(firstY)
  await first.hover()
  await expect(overview.locator('[data-slot="message-nav-preview-title"]')).toHaveText(label!)
  await overview.hover()
  await expect(overview).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("message-history-hover.png") })
  await overview.getByRole("button", { name: label!, exact: true }).click()
  await expect(page).toHaveURL(/#message-/)
  const id = new URL(page.url()).hash.slice("#message-".length)
  await expect(page.locator(`[id="message-${id}"]`)).toBeInViewport()
  await expect(rail.getByRole("button", { name: label!, exact: true })).toHaveAttribute("aria-current", "true")

  const keyboardTarget = rail.getByRole("button").nth(2)
  const keyboardLabel = await keyboardTarget.getAttribute("aria-label")

  const keyboardID = fixture.messages[fixture.targetID].find(
    (message) => message.type === "user" && message.text === keyboardLabel,
  )?.id

  expect(keyboardID).toBeTruthy()
  await keyboardTarget.focus()
  await expect(overview).toBeVisible()
  await keyboardTarget.press("Escape")
  await expect(overview).toBeHidden()
  await keyboardTarget.press("Enter")
  await expect(keyboardTarget).toHaveAttribute("aria-current", "true")
  await expect(page).toHaveURL(new RegExp(`#message-${keyboardID}$`))
  await expect(page.locator(`[id="message-${keyboardID}"]`)).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(rail).toHaveCount(0)
})
