import path from "node:path"

// The desktop must read the same registration file the compiled CLI writes. Keep this filename rule in
// sync with the CLI's ServiceConfig.filename without importing the CLI package into Electron startup.
export function serviceRegistrationFile(input: { readonly state: string; readonly channel: string }) {
  const filename =
    input.channel === "latest" ||
    input.channel === "dev" ||
    input.channel === "beta" ||
    input.channel === "next"
      ? "service.json"
      : `service-${input.channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`

  return path.join(input.state, "opencode", filename)
}