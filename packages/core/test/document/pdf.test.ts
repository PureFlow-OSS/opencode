import { describe, expect, test } from "bun:test"
import { PDFDocument } from "@napi-rs/canvas"
import { extractPdfText, renderPdfPages } from "@opencode/core/document/pdf"

function pdfFixture() {
  const document = new PDFDocument()
  const page = document.beginPage(300, 150)
  page.font = "20px Arial"
  page.fillText("OpenCode PDF fixture", 20, 80)
  document.endPage()
  return new Uint8Array(document.close())
}

describe("PDF document extraction", () => {
  test("extracts page text with page numbers", async () => {
    const result = await extractPdfText(pdfFixture())
    expect(result.total).toBe(1)
    expect(result.pages).toEqual([{ page: 1, text: expect.stringContaining("OpenCode PDF fixture") }])
  })

  test("renders requested pages as JPEG bytes", async () => {
    const result = await renderPdfPages(pdfFixture(), [1])
    expect(result.total).toBe(1)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]?.page).toBe(1)
    expect(Array.from(result.pages[0]?.image.subarray(0, 3) ?? [])).toEqual([0xff, 0xd8, 0xff])
  })
})
