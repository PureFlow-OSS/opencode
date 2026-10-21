import { unwrap } from "solid-js/store"
import { mcpStoryState } from "./server-sdk"

const data = {
  location: {
    default: () => ({ directory: "/tmp/story" }),
    syncInfo: async () => {},
    mcp: {
      server: {
        list: () => structuredClone(unwrap(mcpStoryState.runtime)),
        sync: async () => {},
        invalidate: () => {},
      },
      resource: {
        list: () => [],
        sync: async () => {},
        invalidate: () => {},
      },
    },
    skill: {
      list: () => [{ name: "Storybook skill", path: "/skills/storybook" }],
      sync: async () => {},
    },
    integration: {
      list: () => undefined,
      sync: async () => {},
    },
  },
}

export function useServer() {
  return { ctx: { data } }
}

export function useData() {
  return data
}

export function ServerProvider(props: { children?: unknown }) {
  return props.children
}
