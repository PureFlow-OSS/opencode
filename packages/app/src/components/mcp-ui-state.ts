const hiddenMcpNames = new Set<string>()

export function hideMcpName(name: string) {
  hiddenMcpNames.add(name)
}

export function showMcpName(name: string) {
  hiddenMcpNames.delete(name)
}

export function isMcpNameHidden(name: string) {
  return hiddenMcpNames.has(name)
}
