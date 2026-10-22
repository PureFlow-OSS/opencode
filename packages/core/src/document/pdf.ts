export * as DocumentPdf from "./pdf.js"

export const PDF_VISION_PAGE_LIMIT = 4
export const PDF_RENDER_SCALE = 1.75

let loadPdf: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined

async function pdfJs() {
  loadPdf ??= (async () => {
    const canvas = await import("@napi-rs/canvas")
    // PDF.js resolves its Node canvas and fake worker dynamically. Compiled Bun
    // executables have no node_modules tree, so expose the bundled adapters first.
    Object.assign(globalThis, {
      DOMMatrix: canvas.DOMMatrix,
      Path2D: canvas.Path2D,
      ImageData: canvas.ImageData,
    })
    // @ts-expect-error PDF.js does not declare its fake-worker entry point.
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs")
    Object.assign(globalThis, { pdfjsWorker: worker })
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    return pdfjs
  })()
  return loadPdf
}

export async function openPdf(data: Uint8Array) {
  const { getDocument } = await pdfJs()
  const { createCanvas } = await import("@napi-rs/canvas")
  class CanvasFactory {
    create(width: number, height: number) {
      const canvas = createCanvas(width, height)
      return { canvas, context: canvas.getContext("2d") }
    }
    reset(target: { canvas: ReturnType<typeof createCanvas> }, width: number, height: number) {
      target.canvas.width = width
      target.canvas.height = height
    }
    destroy(target: { canvas: ReturnType<typeof createCanvas> }) {
      target.canvas.width = 0
      target.canvas.height = 0
    }
  }
  const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true, CanvasFactory })
  return { pdf: await task.promise, destroy: () => task.destroy() }
}

export async function extractPdfText(data: Uint8Array) {
  const loaded = await openPdf(data)
  const pdf = loaded.pdf
  try {
    const pages = []
    for (const page of Array.from({ length: pdf.numPages }, (_, index) => index + 1)) {
      const content = await (await pdf.getPage(page)).getTextContent()
      pages.push({ page, text: content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" ") })
    }
    return { pages, total: pdf.numPages }
  } finally {
    await loaded.destroy()
  }
}

export async function renderPdfPages(data: Uint8Array, requestedPages?: number[]) {
  const loaded = await openPdf(data)
  const pdf = loaded.pdf
  try {
    const pages = []
    // Render sequentially: four large page canvases must not coexist in memory.
    for (const page of selectedPages(pdf.numPages, requestedPages)) {
      const target = await pdf.getPage(page)
      const unscaled = target.getViewport({ scale: 1 })
      const viewport = target.getViewport({
        scale: Math.min(PDF_RENDER_SCALE, 2400 / Math.max(unscaled.width, unscaled.height)),
      })
      const { createCanvas } = await import("@napi-rs/canvas")
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await target.render({
        canvas: null,
        canvasContext: canvas.getContext("2d") as unknown as Parameters<typeof target.render>[0]["canvasContext"],
        viewport,
      }).promise
      pages.push({ page, image: new Uint8Array(canvas.toBuffer("image/jpeg", 85)) })
      canvas.width = 0
      canvas.height = 0
    }
    return { pages, total: pdf.numPages }
  } finally {
    await loaded.destroy()
  }
}

function selectedPages(total: number, requestedPages?: number[]) {
  if (requestedPages === undefined || requestedPages.length === 0)
    return Array.from({ length: Math.min(total, PDF_VISION_PAGE_LIMIT) }, (_, index) => index + 1)
  return [...new Set(requestedPages)]
    .filter((page) => Number.isInteger(page) && page > 0 && page <= total)
    .slice(0, PDF_VISION_PAGE_LIMIT)
}
