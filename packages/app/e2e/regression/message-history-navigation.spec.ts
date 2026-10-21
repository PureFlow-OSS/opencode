import { expect, test } from "@playwright/test"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"

test.use({ viewport: { width: 1440, height: 900 } })

test("navigates the virtualized conversation through the history ribbon", async ({ page }) => {
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
  await overview.getByRole("button", { name: label!, exact: true }).click()
  await expect(page).toHaveURL(/#message-/)
  const id = new URL(page.url()).hash.slice("#message-".length)
  await expect(page.locator(`[id="message-${id}"]`)).toBeInViewport()
  await expect(rail.getByRole("button", { name: label!, exact: true })).toHaveAttribute("aria-current", "true")

  const last = rail.getByRole("button").last()
  await last.focus()
  await last.press("Enter")
  await expect(last).toHaveAttribute("aria-current", "true")
  const lastID = new URL(page.url()).hash.slice("#message-".length)
  await expect(page.locator(`[id="message-${lastID}"]`)).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(rail).toHaveCount(0)
})
