import path from "path"
import { Effect } from "effect"

const TOKEN_APPROX = 4 // characters per token (rough estimate)

const FILES = ["skills.md", "guidelines.md", "entities.md"] as const
const SECTION_LABELS: Record<string, string> = {
  "skills.md": "Skills",
  "guidelines.md": "Guidelines",
  "entities.md": "Entities",
}

function approxTokens(text: string) {
  return Math.ceil(text.length / TOKEN_APPROX)
}

function readFile(filepath: string) {
  return Effect.tryPromise(() => Bun.file(filepath).text()).pipe(
    Effect.catchAll(() => Effect.succeed("")),
  )
}

export const inject = Effect.fn("ProjectMemory.inject")(function* (projectDir: string, tokenBudget = 2000) {
  const memoryDir = path.join(projectDir, ".opencode", "memory")
  const parts: string[] = []
  let used = 0
  let overBudget = 0

  for (const filename of FILES) {
    const content = yield* readFile(path.join(memoryDir, filename))
    const trimmed = content.trim()
    if (!trimmed) continue

    const section = `## ${SECTION_LABELS[filename]}\n${trimmed}`
    const tokens = approxTokens(section)

    if (used >= tokenBudget) {
      overBudget += tokens
      continue
    }

    const remaining = tokenBudget - used
    if (tokens <= remaining) {
      parts.push(section)
      used += tokens
    } else {
      parts.push(section.slice(0, remaining * TOKEN_APPROX))
      overBudget += tokens - remaining
      used = tokenBudget
    }
  }

  if (parts.length === 0) return ""

  const body = parts.join("\n\n")
  const suffix = overBudget > 0 ? `\n<!-- memory truncated: ${overBudget} tokens over budget -->` : ""
  return `<project_memory>\n${body}\n</project_memory>${suffix}`
})

export * as ProjectMemory from "./project"
