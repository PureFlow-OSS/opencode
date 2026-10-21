import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

const builds = new Map<string, Promise<string>>()

// The packaged executable is immutable for this process; share the probe and resolver's hash job.
export function cliBuildID(binary: string) {
  const cached = builds.get(binary)

  if (cached) return cached
  const pending = fingerprint(binary)
  builds.set(binary, pending)

  return pending
}

async function fingerprint(binary: string) {
  const hash = createHash("sha256")

  for await (const chunk of createReadStream(binary)) hash.update(chunk)

  return hash.digest("hex")
}
