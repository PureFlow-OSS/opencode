import { Database } from "bun:sqlite"
import { mkdir, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, spyOn, test } from "bun:test"
import {
  isZedTerminal,
  offsetToPosition,
  resolveZedDbPath,
  resolveZedSelection,
} from "../../../src/cli/cmd/tui/context/editor-zed"
import { tmpdir } from "../../fixture/fixture"

const originalZedTerm = process.env.ZED_TERM
const originalTermProgram = process.env.TERM_PROGRAM

afterEach(() => {
  if (originalZedTerm === undefined) delete process.env.ZED_TERM
  else process.env.ZED_TERM = originalZedTerm
  if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = originalTermProgram
})

type ZedFixtureOptions = {
  workspacePaths?: string | null
  itemKind?: string
  bufferPath?: string | null
  selectionStart?: number | null
  selectionEnd?: number | null
  editorContents?: string | null
}

test("offsetToPosition converts Zed offsets to 1-based editor positions", () => {
  expect(offsetToPosition("one\ntwo\nthree", 0)).toEqual({ line: 1, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 4)).toEqual({ line: 2, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 6)).toEqual({ line: 2, character: 3 })
  expect(offsetToPosition("one\ntwo\nthree", 100)).toEqual({ line: 3, character: 6 })
})

test("resolveZedDbPath skips candidates that cannot be stated", async () => {
  await using tmp = await tmpdir()
  const dbPath = path.join(tmp.path, "db.sqlite")
  new Database(dbPath).close()

  const inaccessible = path.join(tmp.path, "broken.sqlite")
  await symlink(path.join(tmp.path, "missing.sqlite"), inaccessible)
  process.env.OPENCODE_ZED_DB = inaccessible
  expect(resolveZedDbPath()).toBeUndefined()

  process.env.OPENCODE_ZED_DB = dbPath
  expect(resolveZedDbPath()).toBe(dbPath)
})

test("isZedTerminal only returns true for Zed terminal environments", () => {
  delete process.env.ZED_TERM
  delete process.env.TERM_PROGRAM
  expect(isZedTerminal()).toBeFalse()

  process.env.ZED_TERM = "true"
  expect(isZedTerminal()).toBeTrue()

  process.env.ZED_TERM = "false"
  process.env.TERM_PROGRAM = "zed"
  expect(isZedTerminal()).toBeTrue()
})

test("resolveZedSelection returns active editor selection", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)

  const cwdSpy = spyOn(process, "cwd").mockReturnValue(tmp.path)
  const selection = await resolveZedSelection(fixture.dbPath)
  cwdSpy.mockRestore()
  expect(selection).toEqual({
    filePath: fixture.bufferPath,
    text: "beta",
    selection: {
      start: { line: 2, character: 1 },
      end: { line: 2, character: 5 },
    },
  })
})

test("resolveZedSelection falls back to the file when editor contents are missing", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, { editorContents: null })

  const cwdSpy = spyOn(process, "cwd").mockReturnValue(tmp.path)
  const selection = await resolveZedSelection(fixture.dbPath)
  cwdSpy.mockRestore()
  expect(selection?.text).toBe("beta")
})

test("resolveZedSelection prefers the workspace that contains cwd", async () => {
  await using tmp = await tmpdir()
  const parentWorkspace = path.join(tmp.path, "parent")
  const childWorkspace = path.join(parentWorkspace, "child")
  await mkdir(childWorkspace, { recursive: true })

  const fixture = await writeZedFixture(tmp.path, {
    workspacePaths: JSON.stringify([parentWorkspace]),
    bufferPath: path.join(parentWorkspace, "root.txt"),
    editorContents: "root",
    selectionStart: 0,
    selectionEnd: 4,
  })
  await writeAdditionalWorkspace(fixture.dbPath, {
    workspaceID: 2,
    workspacePaths: JSON.stringify([childWorkspace]),
    bufferPath: path.join(childWorkspace, "nested.txt"),
    editorContents: "nested",
    selectionStart: 0,
    selectionEnd: 6,
  })

  const cwdSpy = spyOn(process, "cwd").mockReturnValue(childWorkspace)
  const selection = await resolveZedSelection(fixture.dbPath)
  cwdSpy.mockRestore()

  expect(selection?.filePath).toBe(path.join(childWorkspace, "nested.txt"))
  expect(selection?.text).toBe("nested")
})

async function writeZedFixture(tmpPath: string, options: ZedFixtureOptions = {}) {
  const dbPath = path.join(tmpPath, "zed.sqlite")
  const bufferPath = options.bufferPath ?? path.join(tmpPath, "buffer.txt")
  const workspacePaths = options.workspacePaths ?? JSON.stringify([tmpPath])
  const itemKind = options.itemKind ?? "Editor"
  const selectionStart = options.selectionStart ?? 6
  const selectionEnd = options.selectionEnd ?? 10
  const editorContents = options.editorContents ?? "alpha\nbeta\ngamma"

  await Bun.write(bufferPath, "alpha\nbeta\ngamma")
  const db = new Database(dbPath)
  db.exec(`
    create table workspaces (workspace_id integer primary key, paths text, timestamp text);
    create table panes (pane_id integer, workspace_id integer, active integer);
    create table items (item_id integer, pane_id integer, workspace_id integer, active integer, kind text);
    create table editors (item_id integer, workspace_id integer, buffer_path text, contents text);
    create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer);
  `)
  db.query("insert into workspaces values (1, ?, '2026-05-20T20:00:00.000Z')").run(workspacePaths)
  db.query("insert into panes values (1, 1, 1)").run()
  db.query("insert into items values (1, 1, 1, 1, ?)").run(itemKind)
  db.query("insert into editors values (1, 1, ?, ?)").run(bufferPath, editorContents)
  db.query("insert into editor_selections values (1, 1, ?, ?)").run(selectionStart, selectionEnd)
  db.close()

  return { dbPath, bufferPath }
}

async function writeAdditionalWorkspace(
  dbPath: string,
  options: {
    workspaceID: number
    workspacePaths: string
    bufferPath: string
    editorContents: string
    selectionStart: number
    selectionEnd: number
  },
) {
  await Bun.write(options.bufferPath, options.editorContents)
  const db = new Database(dbPath)
  db.query("insert into workspaces values (?, ?, '2026-05-20T20:01:00.000Z')").run(
    options.workspaceID,
    options.workspacePaths,
  )
  db.query("insert into panes values (1, ?, 1)").run(options.workspaceID)
  db.query("insert into items values (1, 1, ?, 1, 'Editor')").run(options.workspaceID)
  db.query("insert into editors values (1, ?, ?, ?)").run(
    options.workspaceID,
    options.bufferPath,
    options.editorContents,
  )
  db.query("insert into editor_selections values (1, ?, ?, ?)").run(
    options.workspaceID,
    options.selectionStart,
    options.selectionEnd,
  )
  db.close()
}
