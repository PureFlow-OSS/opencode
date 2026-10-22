export * as DocumentExtract from "./extract.js"

// @ts-ignore Bun embeds the WASM asset when compiling the CLI.
import anydocWasm from "@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm" with { type: "file" }
import { extractPdfText } from "./pdf.js"

export interface ExtractedDocument {
  text: string
  pages: readonly { page: number; text: string }[]
}

let anydocPromise: Promise<typeof import("@firecrawl/anydoc-wasm")> | undefined

function loadAnydoc() {
  anydocPromise ??= (async () => {
    const anydoc = await import("@firecrawl/anydoc-wasm")
    anydoc.initSync({ module: new Uint8Array(await Bun.file(anydocWasm).arrayBuffer()) })
    return anydoc
  })()
  return anydocPromise
}

export async function extractDocument(bytes: Uint8Array, filename: string): Promise<ExtractedDocument> {
  if (/\.pdf$/i.test(filename)) {
    const pdf = await extractPdfText(bytes)
    return { text: pdf.pages.map((page) => page.text).join("\n\n"), pages: pdf.pages }
  }

  const { toMarkdownBytes } = await loadAnydoc()
  return { text: toMarkdownBytes(bytes), pages: [] }
}
