export const popularProviders = ["aifactory", "openai", "github-copilot"]

export function providerOrder(id: string) {
  const index = popularProviders.indexOf(id)

  return index < 0 ? popularProviders.length : index
}
