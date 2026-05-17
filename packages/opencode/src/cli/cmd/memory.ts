import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Database, eq, and } from "../../storage"
import { MemoryExport } from "../../memory/export"
import { MemoryTable } from "../../memory/memory.sql"
import { UI } from "../ui"
import path from "path"
import fsNode from "fs/promises"
import { EOL } from "os"
import { bootstrap } from "./bootstrap"
import { Server } from "../../server/server"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import readline from "readline"
import LINT_PROMPT from "../../memory/lint-prompt.txt"

const MemoryListCommand = cmd({
  command: "list",
  describe: "list saved memories",
  builder: (yargs: Argv) =>
    yargs
      .option("scope", {
        describe: "filter by scope (user, project)",
        type: "string",
      })
      .option("category", {
        describe: "filter by category (style, preference, correction, ...)",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: async (args) => {
    const rows = Database.use((db) => {
      const conditions: any[] = []
      if (args.scope) conditions.push(eq(MemoryTable.scope, args.scope as string))
      if (args.category) conditions.push(eq(MemoryTable.category, args.category as string))
      if (conditions.length > 0) {
        return db
          .select()
          .from(MemoryTable)
          .where(and(...conditions))
          .all()
      }
      return db.select().from(MemoryTable).all()
    })

    if (args.format === "json") {
      console.log(JSON.stringify(rows, null, 2))
      return
    }

    if (rows.length === 0) {
      UI.println("No memories found.")
      return
    }

    const maxIdWidth = Math.max(8, ...rows.map((r) => r.id.length))
    const maxCatWidth = Math.max(8, ...rows.map((r) => `${r.scope}/${r.category}`.length))
    const header = `${"ID".padEnd(maxIdWidth)}  ${"SCOPE/CAT".padEnd(maxCatWidth)}  CONTENT`
    console.log(header)
    console.log("─".repeat(header.length))
    for (const row of rows) {
      const cat = `${row.scope}/${row.category}`.padEnd(maxCatWidth)
      const content = row.content.length > 60 ? row.content.slice(0, 57) + "..." : row.content
      console.log(`${row.id.padEnd(maxIdWidth)}  ${cat}  ${content}`)
    }
  },
})

const MemoryRemoveCommand = cmd({
  command: "remove <id>",
  describe: "delete a memory by ID",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      describe: "memory ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    Database.transaction((db) => {
      db.delete(MemoryTable).where(eq(MemoryTable.id, args.id as string)).run()
    })
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Memory ${args.id} deleted` + UI.Style.TEXT_NORMAL)
  },
})

const MemoryExportCommand = cmd({
  command: "export",
  describe: "export memories to JSON",
  builder: (yargs: Argv) =>
    yargs
      .option("scope", {
        describe: "filter by scope (user, project)",
        type: "string",
      })
      .option("output", {
        describe: "output file path (default: stdout)",
        type: "string",
      }),
  handler: async (args) => {
    const entries = MemoryExport.exportEntries(args.scope)
    const json = JSON.stringify(entries, null, 2)
    if (args.output) {
      const outPath = path.resolve(args.output as string)
      await fsNode.writeFile(outPath, json, "utf-8")
      UI.println(`Exported ${entries.length} memories to ${outPath}`)
    } else {
      process.stdout.write(json + EOL)
    }
  },
})

const MemoryImportCommand = cmd({
  command: "import <file>",
  describe: "import memories from JSON",
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        describe: "path to JSON file exported by `memory export`",
        type: "string",
        demandOption: true,
      })
      .option("project-id", {
        describe: "project ID to associate with imported memories (optional)",
        type: "string",
      }),
  handler: async (args) => {
    const filePath = path.resolve(args.file as string)
    const raw = await fsNode.readFile(filePath, "utf-8")
    let entries: any[]
    try {
      entries = JSON.parse(raw)
    } catch {
      UI.error("Invalid JSON file")
      process.exit(1)
    }
    if (!Array.isArray(entries)) {
      UI.error("Expected a JSON array of memory entries")
      process.exit(1)
    }
    const count = MemoryExport.importEntries(entries)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Imported ${count} memories` + UI.Style.TEXT_NORMAL)
  },
})

interface LintSuggestion {
  type: string
  file: string
  description: string
  fix: string
  raw: string
}

function parseSuggestions(text: string): LintSuggestion[] {
  const suggestions: LintSuggestion[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("NO_ISSUES")) continue
    const parts = trimmed.split("|").map((p) => p.trim())
    if (parts.length < 4) continue
    const validTypes = ["CONTRADICTION", "STALE", "DUPLICATE", "CROSS_REF", "MISSING_ENTITY"]
    if (!validTypes.includes(parts[0])) continue
    suggestions.push({
      type: parts[0],
      file: parts[1],
      description: parts[2],
      fix: parts[3],
      raw: trimmed,
    })
  }
  return suggestions
}

async function readMemoryFiles(memDir: string): Promise<string> {
  let exists = false
  try {
    await fsNode.access(memDir)
    exists = true
  } catch {}
  if (!exists) return ""

  const parts: string[] = []
  const walk = async (dir: string, rel: string) => {
    const entries = await fsNode.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(fullPath, relPath)
      } else if (entry.name.endsWith(".md")) {
        const content = await fsNode.readFile(fullPath, "utf-8").catch(() => "")
        if (content.trim()) {
          parts.push(`\n--- ${relPath} ---\n${content.trim()}`)
        }
      }
    }
  }
  await walk(memDir, "")
  return parts.join("\n")
}

async function runLintSession(sdk: ReturnType<typeof createOpencodeClient>, message: string): Promise<string> {
  const sessionResult = await sdk.session.create({ title: "memory lint analysis" })
  const sessionID = sessionResult.data?.id
  if (!sessionID) throw new Error("Failed to create lint session")

  const events = await sdk.event.subscribe()
  const textParts: string[] = []

  const loopDone = (async () => {
    for await (const event of events.stream) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== sessionID) continue
        if (part.type === "text" && part.time?.end) {
          textParts.push(part.text)
        }
      }
      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle"
      ) {
        break
      }
      if (event.type === "session.error" && event.properties.sessionID === sessionID) break
    }
  })()

  await sdk.session.prompt({
    sessionID,
    parts: [{ type: "text", text: message }],
  })
  await loopDone

  return textParts.join("")
}

function askUserSelection(suggestions: LintSuggestion[]): Promise<number[]> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
    console.error("\nSelect suggestions to apply (comma-separated numbers, 'all', or Enter to skip):")
    rl.question("> ", (answer) => {
      rl.close()
      const trimmed = answer.trim().toLowerCase()
      if (!trimmed || trimmed === "none") return resolve([])
      if (trimmed === "all") return resolve(suggestions.map((_, i) => i))
      const indices = trimmed
        .split(",")
        .map((s) => Number(s.trim()) - 1)
        .filter((i) => i >= 0 && i < suggestions.length)
      resolve(indices)
    })
  })
}

const MemoryLintCommand = cmd({
  command: "lint",
  describe: "review .opencode/memory/ for contradictions, stale entries, and duplicates",
  builder: (yargs: Argv) =>
    yargs.option("dir", {
      describe: "project directory (default: current directory)",
      type: "string",
      default: ".",
    }),
  handler: async (args) => {
    const dir = path.resolve(args.dir as string)
    const memDir = path.join(dir, ".opencode", "memory")

    const memContent = await readMemoryFiles(memDir)
    if (!memContent) {
      UI.println("No memory files found in " + memDir)
      UI.println("Create .opencode/memory/skills.md, guidelines.md, or entities.md to get started.")
      return
    }

    UI.println("Analyzing memory files...")

    const analysisPrompt = [LINT_PROMPT, "\n\nMemory files to review:", memContent].join("\n")

    await bootstrap(dir, async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.Default().app.fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

      const responseText = await runLintSession(sdk, analysisPrompt)

      if (!responseText.trim()) {
        UI.println("No response from LLM. Check your provider configuration.")
        return
      }

      const suggestions = parseSuggestions(responseText)

      if (suggestions.length === 0) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Memory looks good — no issues found." + UI.Style.TEXT_NORMAL)
        UI.empty()
        UI.println(responseText.trim())
        return
      }

      UI.empty()
      UI.println(UI.Style.TEXT_WARNING_BOLD + `Found ${suggestions.length} suggestion(s):` + UI.Style.TEXT_NORMAL)
      UI.empty()
      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i]
        UI.println(
          `  ${UI.Style.TEXT_DIM}${i + 1}.${UI.Style.TEXT_NORMAL} [${s.type}] ${s.file}`,
        )
        UI.println(`     ${UI.Style.TEXT_DIM}${s.description}${UI.Style.TEXT_NORMAL}`)
        UI.println(`     Fix: ${s.fix}`)
        UI.empty()
      }

      const selected = await askUserSelection(suggestions)
      if (selected.length === 0) {
        UI.println("No suggestions selected. Memory unchanged.")
        return
      }

      const selectedList = selected.map((i) => suggestions[i])
      const applyMessage = [
        "Apply the following memory lint suggestions by editing the files in .opencode/memory/ directly.",
        "Make only the changes listed. Do not add commentary.",
        "",
        ...selectedList.map((s, i) => `${i + 1}. [${s.type}] ${s.file}: ${s.description}\n   Fix: ${s.fix}`),
      ].join("\n")

      UI.println("Applying " + selected.length + " suggestion(s)...")
      await runLintSession(sdk, applyMessage)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Done." + UI.Style.TEXT_NORMAL)
    })
  },
})

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage persistent memories",
  builder: (yargs: Argv) =>
    yargs
      .command(MemoryListCommand)
      .command(MemoryRemoveCommand)
      .command(MemoryExportCommand)
      .command(MemoryImportCommand)
      .command(MemoryLintCommand)
      .demandCommand(),
  handler: () => {},
})
