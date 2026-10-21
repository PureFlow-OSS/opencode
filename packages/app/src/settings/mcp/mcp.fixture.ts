let ready = Promise.resolve()

export function deferMcpCatalog() {
  const deferred = Promise.withResolvers<void>()
  ready = deferred.promise
  return () => deferred.resolve()
}

export const mcpCatalogReady = () => ready
