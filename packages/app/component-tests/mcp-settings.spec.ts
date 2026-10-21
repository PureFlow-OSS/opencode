import { expect, story } from "../../storybook/playwright/story"

story("keeps OAuth off when a remote PAT server has no OAuth configuration", async ({ mount, page }) => {
  const component = await mount("settings-mcp-dialogs--remote-without-oauth")
  await component.getByRole("button", { name: "Edit MCP server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("switch", { name: "OAuth", exact: true })).not.toBeChecked()
  await expect(dialog.getByLabel("Client ID", { exact: true })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  const saved = component.getByRole("status", { name: "Saved MCP configuration" })
  await expect(saved).toContainText('"oauth":false')
  expect(JSON.parse((await saved.textContent())!).config.headers).toEqual({ "X-ADO-PAT": "test-token" })
  await expect(dialog).toHaveCount(0)
})

story("saves an installed store server without treating its existing name as a duplicate", async ({ mount, page }) => {
  const component = await mount("settings-mcp-dialogs--store-edit")
  await component.getByRole("button", { name: "Edit MCP server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  const saved = component.getByRole("status", { name: "Saved MCP configuration" })
  await expect(saved).toContainText('"name":"Company search"')
  expect(JSON.parse((await saved.textContent())!)).toEqual({
    name: "Company search",
    config: {
      type: "remote",
      url: "https://mcp.example/search",
      headers: { "x-company-token": "previous-token" },
      oauth: false,
      codemode: false,
      protocol: "auto",
      timeout: { startup: 3000 },
      disabled: false,
    },
  })
  await expect(dialog).toHaveCount(0)
})

story("preserves quoted local arguments and advanced settings when editing a server", async ({ mount, page }) => {
  const component = await mount("settings-mcp-dialogs--local-edit")
  await component.getByRole("button", { name: "Edit MCP server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  const saved = component.getByRole("status", { name: "Saved MCP configuration" })
  await expect(saved).toContainText('"name":"Local company tools"')
  expect(JSON.parse((await saved.textContent())!)).toEqual({
    name: "Local company tools",
    config: {
      type: "local",
      command: ["C:\\Program Files\\MCP\\server.exe", "--scope", "team space", "O'Brien", ""],
      cwd: "C:\\Company workspace",
      environment: { COMPANY_SCOPE: "local" },
      codemode: false,
      protocol: "auto",
      timeout: { startup: 3000, execution: 12000 },
      disabled: false,
    },
  })
})
