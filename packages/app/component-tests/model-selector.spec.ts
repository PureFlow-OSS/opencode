import { expect, story } from "../../stories/playwright/story"

story("keeps recent and favorite AI Factory models in the first provider group", async ({ mount, page }) => {
  await mount("app-dialog-model-selector--corporate")
  const dialog = page.getByRole("dialog")
  const headers = dialog.locator('[data-slot="search-list-header"]')
  const names = dialog.locator('[data-slot="model-dialog-name"] > span:first-child')
  const selected = dialog.locator('[data-option-key="aifactory:glm-5.3-flash"]')
  const search = dialog.getByRole("combobox", { name: "Search models", exact: true })

  await expect(headers).toHaveText(["RRZ AI Factory", "Recent", "OpenAI"])
  await expect(names).toHaveText(["glm-5.3", "glm-5.3-flash", "qwen3.8-27b-fp8", "GPT-5.6 Sol", "GPT-5.6 Terra"])
  await expect(dialog.getByRole("group", { name: "RRZ AI Factory", exact: true }).getByRole("option")).toHaveCount(3)
  await expect(selected).toHaveAttribute("aria-current", "true")
  await expect(dialog.getByText("hidden-worker", { exact: true })).toHaveCount(0)

  await search.fill("glm")
  await expect(headers).toHaveText(["RRZ AI Factory"])
  await expect(names).toHaveText(["glm-5.3", "glm-5.3-flash"])
  await search.fill("")
  await expect(headers).toHaveText(["RRZ AI Factory", "Recent", "OpenAI"])
  await selected.click()
  await expect(dialog).toBeHidden()
  await page.getByRole("button", { name: "glm-5.3-flash", exact: true }).click()
  await expect(selected).toHaveAttribute("aria-current", "true")
  await expect(headers).toHaveText(["RRZ AI Factory", "Recent", "OpenAI"])
})
