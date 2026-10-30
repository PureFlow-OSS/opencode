import { expect, sourceURL, story } from "../../stories/playwright/story"

const modules = {
  fixture: sourceURL(new URL("./updater.fixture.tsx", import.meta.url)),
  definition: sourceURL(new URL("../../gui-plugins/src/updater/index.ts", import.meta.url)),
  section: sourceURL(new URL("../../gui-plugins/src/updater/section.tsx", import.meta.url)),
}

story(
  "update settings keep progress visible through download, verification and preparation",
  async ({ page, mount }) => {
    await mount("ui-line-comment--editor")
    await page.evaluate(async (modules) => {
      const [{ mountUpdater, until }, definition, section] = await Promise.all([
        import(modules.fixture), import(modules.definition), import(modules.section),
      ])

      const host = mountUpdater({ definition: definition.default, section: section.default })
      await until(() => host.ready())

      if (host.status("updater") !== "active" || host.failure("updater"))
        throw new Error(JSON.stringify(host.failure("updater")))

      const apply = (event: Event) => {
        if (!(event instanceof CustomEvent)) return
        host.set(event.detail)
      }

      window.addEventListener("updater-fixture-state", apply)
    }, modules)
    const button = page.locator('[data-action="settings-check-updates"]')
    await expect(button).toBeDisabled()
    await expect(button).toHaveText("Downloading…")
    await expect(page.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow")
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("updater-fixture-state", {
          detail: {
            status: "downloading",
            version: "2.2.2",
            progress: {
              phase: "download",
              percent: 25,
              transferred: 25 * 1048576,
              total: 100 * 1048576,
              bytesPerSecond: 800 * 1024,
            },
          },
        }),
      ),
    )
    await expect(button).toHaveText("Downloading 25%")
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25")
    await expect(page.getByText("25 / 100 MiB · 800 KiB/s")).toBeVisible()

    for (const [phase, label] of [
      ["verify", "Verifying update…"],
      ["unpack", "Preparing update…"],
    ]) {
      await page.evaluate(
        (phase) =>
          window.dispatchEvent(
            new CustomEvent("updater-fixture-state", {
              detail: { status: "downloading", version: "2.2.2", progress: { phase } },
            }),
          ),
        phase,
      )
      await expect(button).toHaveText(label)
      await expect(button).toBeDisabled()
    }

    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("updater-fixture-state", {
          detail: { status: "ready", version: "2.2.2" },
        }),
      ),
    )
    await expect(page.getByRole("progressbar")).toHaveCount(0)
    await expect(button).toBeEnabled()
    await expect(button).toHaveText("Install and restart")
  },
)
