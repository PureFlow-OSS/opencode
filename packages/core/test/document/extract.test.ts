import { describe, expect, test } from "bun:test"
import { PDFDocument } from "@napi-rs/canvas"
import { extractDocument } from "@opencode/core/document/extract"

const crcTable = Array.from({ length: 256 }, (_, value) =>
  Array.from({ length: 8 }, () => value).reduce((crc) => ((crc >>> 1) ^ (0xedb88320 & -(crc & 1))) >>> 0, value >>> 0),
)

function zip(entries: Record<string, string>) {
  const encoder = new TextEncoder()
  const files = Object.entries(entries).map(([name, content]) => {
    const raw = encoder.encode(content)
    const nameBytes = encoder.encode(name)
    const local = new Uint8Array(30 + nameBytes.length)
    const header = new DataView(local.buffer)
    header.setUint32(0, 0x04034b50, true)
    header.setUint32(14, crc32(raw), true)
    header.setUint32(18, raw.length, true)
    header.setUint32(22, raw.length, true)
    header.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    return { nameBytes, raw, local }
  })
  let offset = 0
  const central = files.flatMap((file) => {
    const directory = new Uint8Array(46 + file.nameBytes.length)
    const header = new DataView(directory.buffer)
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(4, 20, true)
    header.setUint32(16, crc32(file.raw), true)
    header.setUint32(20, file.raw.length, true)
    header.setUint32(24, file.raw.length, true)
    header.setUint16(28, file.nameBytes.length, true)
    header.setUint32(42, offset, true)
    directory.set(file.nameBytes, 46)
    offset += file.local.length + file.raw.length
    return [directory]
  })
  const end = new Uint8Array(22)
  const endHeader = new DataView(end.buffer)
  endHeader.setUint32(0, 0x06054b50, true)
  endHeader.setUint16(8, files.length, true)
  endHeader.setUint16(10, files.length, true)
  endHeader.setUint32(
    12,
    central.reduce((size, directory) => size + directory.length, 0),
    true,
  )
  endHeader.setUint32(16, offset, true)
  return new Uint8Array([
    ...files.flatMap((file) => [...file.local, ...file.raw]),
    ...central.flatMap((directory) => [...directory]),
    ...end,
  ])
}

function crc32(bytes: Uint8Array) {
  return bytes.reduce((crc, byte) => crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff
}

const docxFixture = () =>
  zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Expenses</w:t></w:r></w:p><w:p><w:r><w:t>800</w:t></w:r></w:p></w:body></w:document>',
  })

const xlsxFixture = () =>
  zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Expenses" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml":
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Expenses</t></is></c></row><row r="2"><c r="A2"><v>800</v></c></row></sheetData></worksheet>',
  })

describe("extractDocument", () => {
  test("returns page-separated text for PDFs", async () => {
    const document = new PDFDocument()
    const page = document.beginPage(300, 150)
    page.font = "20px Arial"
    page.fillText("Document extraction fixture", 20, 80)
    document.endPage()

    const result = await extractDocument(new Uint8Array(document.close()), "fixture.pdf")
    expect(result.pages).toEqual([{ page: 1, text: expect.stringContaining("Document extraction fixture") }])
    expect(result.text).toContain("Document extraction fixture")
  })

  test("extracts real Word documents", async () => {
    const result = await extractDocument(docxFixture(), "expenses.docx")
    expect(result.text).toContain("Expenses")
    expect(result.text).toContain("800")
    expect(result.pages).toEqual([])
  })

  test("extracts real Excel documents", async () => {
    const result = await extractDocument(xlsxFixture(), "expenses.xlsx")
    expect(result.text).toContain("Expenses")
    expect(result.text).toContain("800")
    expect(result.pages).toEqual([])
  })
})
