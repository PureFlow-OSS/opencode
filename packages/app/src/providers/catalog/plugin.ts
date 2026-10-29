import type { PluginInfo } from "@opencode/client"

export function pluginLabel(plugin: PluginInfo) {
  if (plugin.id) return plugin.id

  if (plugin.source.type === "package") return plugin.source.target

  if (plugin.source.type === "local") return plugin.source.path

  return plugin.source.type
}

export function pluginLabels(plugins: readonly PluginInfo[]) {
  return plugins.flatMap((plugin) => (plugin.source.type === "builtin" ? [] : [pluginLabel(plugin)]))
}

function pluginRepairSource(plugin: PluginInfo) {
  if (plugin.source.type === "package") {
    return plugin.id ? plugin.id + " (" + plugin.source.target + ")" : plugin.source.target
  }

  if (plugin.source.type === "local") {
    return plugin.id ? plugin.id + " (" + plugin.source.path + ")" : plugin.source.path
  }

  return plugin.id ?? plugin.source.type
}

function pluginRepairError(error: string) {
  const firstLine = error.split(/\r?\n/).find((line) => line.trim().length > 0)

  return (firstLine ?? "")
    .replace(/\b(api[-_ ]?key|authorization|password|secret|token)(\s*[:=]\s*)(?:bearer\s+)?\S+/gi, "$1$2[redacted]")
    .replace(/\b(ghp|gho|github_pat|pk|rk|sk)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 240)
}

export function pluginRepairContext(plugin: PluginInfo, directory: string) {
  if (plugin.state.status !== "failed") return

  return {
    directory,
    plugin: pluginRepairSource(plugin),
    error: pluginRepairError(plugin.state.error),
    errorRef: plugin.state.ref,
  }
}
