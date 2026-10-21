import { createStore } from "solid-js/store"

export const [mcpActivity, setMcpActivity] = createStore({ running: false, writes: [] as string[] })

export const recordMcpWrite = (value: string) => setMcpActivity("writes", (writes) => [...writes, value])

let ready = Promise.resolve()

export function deferMcpCatalog() {
  const deferred = Promise.withResolvers<void>()
  ready = deferred.promise
  return () => deferred.resolve()
}

export const mcpCatalogReady = () => ready
