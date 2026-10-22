export * as DocumentCache from "./cache.js"

import { createHash } from "node:crypto"
import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { extractDocument } from "./extract.js"

const Manifest = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  mime: Schema.String,
  pages: Schema.optional(Schema.Array(Schema.Struct({ page: Schema.Number, text: Schema.String }))),
  transcript: Schema.optional(Schema.String),
})
export type Manifest = typeof Manifest.Type
const decode = Schema.decodeUnknownPromise(Schema.fromJsonString(Manifest))
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const validID = (id: string) => /^[a-f0-9]{64}$/.test(id)
const limit = 20 * 1024 * 1024

export function make(root: string) {
  const directory = (session: string) => path.join(root, hash(session))
  const folder = (session: string, id: string) => {
    if (!validID(id)) throw new Error("Invalid document cache ID")
    return path.join(directory(session), id)
  }
  const read = async (session: string, id: string) =>
    decode(await Bun.file(path.join(folder(session, id), "manifest.json")).text())
  const source = (session: string, id: string) => Bun.file(path.join(folder(session, id), "source"))
  const pending = new Map<string, Promise<Manifest>>()

  return {
    read,
    source,
    async update(session: string, manifest: Manifest, update: Pick<Manifest, "pages" | "transcript">) {
      const current = await read(session, manifest.id)
      const result = { ...current, ...update }
      await Bun.write(path.join(folder(session, manifest.id), "manifest.json"), JSON.stringify(result))
      return result
    },
    async put(session: string, bytes: Uint8Array, filename: string, mime: string) {
      if (bytes.byteLength > limit) throw new Error("Document exceeds the 20 MiB ingestion limit")
      const id = createHash("sha256").update(mime).update(bytes).digest("hex")
      const target = folder(session, id)
      if (await Bun.file(path.join(target, "manifest.json")).exists()) return read(session, id)
      await mkdir(target, { recursive: true })
      const manifest: Manifest = { id, filename, mime }
      await Bun.write(source(session, id), bytes)
      await Bun.write(path.join(target, "manifest.json"), JSON.stringify(manifest))
      return manifest
    },
    async list(session: string) {
      const target = directory(session)
      if (
        !(await Bun.file(target)
          .stat()
          .catch(() => undefined))
      )
        return []
      const entries = await readdir(target)
      return Promise.all(
        entries
          .filter(validID)
          .sort()
          .map((id) => read(session, id)),
      )
    },
    async index(session: string, manifest: Manifest): Promise<Manifest> {
      if (manifest.pages !== undefined) return manifest
      const key = `${session}:${manifest.id}`
      const active = pending.get(key)
      if (active) return active
      const result = (async () => {
        const bytes = new Uint8Array(await source(session, manifest.id).arrayBuffer())
        const document = await extractDocument(
          bytes,
          manifest.mime === "application/pdf" ? "source.pdf" : manifest.filename,
        )
        const indexed = {
          ...manifest,
          pages: document.pages.length ? document.pages : [{ page: 1, text: document.text }],
        }
        await Bun.write(path.join(folder(session, manifest.id), "manifest.json"), JSON.stringify(indexed))
        return indexed
      })()
      pending.set(key, result)
      try {
        return await result
      } finally {
        pending.delete(key)
      }
    },
  }
}
