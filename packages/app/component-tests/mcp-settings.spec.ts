import { expect, story } from "../../stories/playwright/story"

story("generates, saves and edits a fixed OAuth redirect URI", async ({ mount, page }) => {
  const component = await mount("settings-mcp-dialogs--remote-with-oauth")
  const edit = component.getByRole("button", { name: "Edit MCP server", exact: true })
  await edit.click()
  const dialog = page.getByRole("dialog")
  const redirect = dialog.getByLabel("OAuth Redirect URI", { exact: true })
  await expect(redirect).toHaveValue("http://127.0.0.1:23456/mcp/oauth/callback")
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = component.getByRole("status", { name: "Saved MCP configuration" })
  expect(JSON.parse((await saved.textContent())!).config.oauth).toEqual({
    client_id: "crm-client",
    client_secret: "crm-secret",
    scope: "read",
    redirect_uri: "http://127.0.0.1:23456/mcp/oauth/callback",
  })
  await edit.click()
  await expect(redirect).toHaveValue("http://127.0.0.1:23456/mcp/oauth/callback")
  await redirect.click()
  await expect(redirect).toBeFocused()
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0)
  await redirect.press("ControlOrMeta+A")
  await redirect.press("Backspace")
  await redirect.pressSequentially("http://127.0.0.1:19876/mcp/oauth/callback")
  await expect(redirect).toHaveValue("http://127.0.0.1:19876/mcp/oauth/callback")
  await redirect.fill("https://127.0.0.1:19876/callback")
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(redirect).toHaveAttribute("aria-invalid", "true")
  await redirect.fill(" http://127.0.0.1:19876/mcp/oauth/callback ")
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(JSON.parse((await saved.textContent())!).config.oauth).toEqual({
    client_id: "crm-client",
    client_secret: "crm-secret",
    scope: "read",
    redirect_uri: "http://127.0.0.1:19876/mcp/oauth/callback",
  })
  await edit.click()
  await expect(redirect).toHaveValue("http://127.0.0.1:19876/mcp/oauth/callback")
  await redirect.fill("")
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(JSON.parse((await saved.textContent())!).config.oauth).toEqual({
    client_id: "crm-client",
    client_secret: "crm-secret",
    scope: "read",
  })
})

story("prefills a fixed callback when enabling OAuth", async ({ mount, page }) => {
  const component = await mount("settings-mcp-dialogs--remote-without-oauth")
  await component.getByRole("button", { name: "Edit MCP server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("OAuth", { exact: true }).click()
  await expect(dialog.getByLabel("OAuth Redirect URI", { exact: true })).toHaveValue(
    "http://127.0.0.1:19876/mcp/oauth/callback",
  )
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = component.getByRole("status", { name: "Saved MCP configuration" })
  expect(JSON.parse((await saved.textContent())!).config.oauth).toEqual({
    redirect_uri: "http://127.0.0.1:19876/mcp/oauth/callback",
  })
})

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
