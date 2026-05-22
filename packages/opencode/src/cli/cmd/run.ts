import type { Argv } from "yargs"
import path from "path"
import { pathToFileURL } from "url"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "@opencode-ai/core/flag/flag"
import { bootstrap } from "../bootstrap"
import { EOL } from "os"
import { Filesystem } from "../../util"
import { createOpencodeClient, type Event, type OpencodeClient, type ToolPart } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider"
import { Agent } from "../../agent/agent"
import { Permission } from "../../permission"
import { Tool } from "../../tool"
import { GlobTool } from "../../tool/glob"
import { GrepTool } from "../../tool/grep"
import { ReadTool } from "../../tool/read"
import { WebFetchTool } from "../../tool/webfetch"
import { EditTool } from "../../tool/edit"
import { WriteTool } from "../../tool/write"
import { CodeSearchTool } from "../../tool/codesearch"
import { WebSearchTool } from "../../tool/websearch"
import { TaskTool } from "../../tool/task"
import { SkillTool } from "../../tool/skill"
import { BashTool } from "../../tool/bash"
import { TodoWriteTool } from "../../tool/todo"
import { Locale } from "../../util"
import { AppRuntime } from "@/effect/app-runtime"
import { FormatError, FormatUnknownError } from "../error"
import { collectReplayBlockers, collectReplayItems, collectReplaySnapshot } from "./run-replay"

type ToolProps<T> = {
  input: Tool.InferParameters<T>
  metadata: Tool.InferMetadata<T>
  part: ToolPart
}

function props<T>(part: ToolPart): ToolProps<T> {
  const state = part.state
  return {
    input: state.input as Tool.InferParameters<T>,
    metadata: ("metadata" in state ? state.metadata : {}) as Tool.InferMetadata<T>,
    part,
  }
}

type Inline = {
  icon: string
  title: string
  description?: string
}

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

function fallback(part: ToolPart) {
  const state = part.state
  const input = "input" in state ? state.input : undefined
  const title =
    ("title" in state && state.title ? state.title : undefined) ||
    (input && typeof input === "object" && Object.keys(input).length > 0 ? JSON.stringify(input) : "Unknown")
  inline({
    icon: "⚙",
    title: `${part.tool} ${title}`,
  })
}

function glob(info: ToolProps<typeof GlobTool>) {
  const root = info.input.path ?? ""
  const title = `Glob "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.count
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function grep(info: ToolProps<typeof GrepTool>) {
  const root = info.input.path ?? ""
  const title = `Grep "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.matches
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function read(info: ToolProps<typeof ReadTool>) {
  const file = normalizePath(info.input.filePath)
  const pairs = Object.entries(info.input).filter(([key, value]) => {
    if (key === "filePath") return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  const description = pairs.length ? `[${pairs.map(([key, value]) => `${key}=${value}`).join(", ")}]` : undefined
  inline({
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  })
}

function write(info: ToolProps<typeof WriteTool>) {
  block(
    {
      icon: "←",
      title: `Write ${normalizePath(info.input.filePath)}`,
    },
    info.part.state.status === "completed" ? info.part.state.output : undefined,
  )
}

function webfetch(info: ToolProps<typeof WebFetchTool>) {
  inline({
    icon: "%",
    title: `WebFetch ${info.input.url}`,
  })
}

function edit(info: ToolProps<typeof EditTool>) {
  const title = normalizePath(info.input.filePath)
  const diff = info.metadata.diff
  block(
    {
      icon: "←",
      title: `Edit ${title}`,
    },
    diff,
  )
}

function codesearch(info: ToolProps<typeof CodeSearchTool>) {
  inline({
    icon: "◇",
    title: `Exa Code Search "${info.input.query}"`,
  })
}

function websearch(info: ToolProps<typeof WebSearchTool>) {
  inline({
    icon: "◈",
    title: `Exa Web Search "${info.input.query}"`,
  })
}

function task(info: ToolProps<typeof TaskTool>) {
  const input = info.part.state.input
  const status = info.part.state.status
  const subagent =
    typeof input.subagent_type === "string" && input.subagent_type.trim().length > 0 ? input.subagent_type : "unknown"
  const agent = Locale.titlecase(subagent)
  const desc =
    typeof input.description === "string" && input.description.trim().length > 0 ? input.description : undefined
  const icon = status === "error" ? "✗" : status === "running" ? "•" : "✓"
  const name = desc ?? `${agent} Task`
  inline({
    icon,
    title: name,
    description: desc ? `${agent} Agent` : undefined,
  })
}

function skill(info: ToolProps<typeof SkillTool>) {
  inline({
    icon: "→",
    title: `Skill "${info.input.name}"`,
  })
}

function bash(info: ToolProps<typeof BashTool>) {
  const output = info.part.state.status === "completed" ? info.part.state.output?.trim() : undefined
  block(
    {
      icon: "$",
      title: `${info.input.command}`,
    },
    output,
  )
}

function todo(info: ToolProps<typeof TodoWriteTool>) {
  block(
    {
      icon: "#",
      title: "Todos",
    },
    info.input.todos.map((item) => `${item.status === "completed" ? "[x]" : "[ ]"} ${item.content}`).join("\n"),
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) return path.relative(process.cwd(), input) || "."
  return input
}

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
}

function eventSessionID(event: Event) {
  if (event.type === "message.updated") return event.properties.info.sessionID
  if (event.type === "message.part.delta") return event.properties.sessionID
  if (event.type === "message.part.updated") return event.properties.part.sessionID
  if (event.type === "session.error") return event.properties.sessionID
  if (event.type === "session.status") return event.properties.sessionID
  if (event.type === "permission.asked") return event.properties.sessionID
  if (event.type === "question.asked") return event.properties.sessionID
  return undefined
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running opencode server (e.g., http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to OPENCODE_SERVER_PASSWORD)",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on remote server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
        default: false,
      })
      .option("replay", {
        type: "boolean",
        describe: "replay recent session history before continuing",
        default: false,
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap replay to the newest N messages",
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
  },
  handler: async (args) => {
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const directory = (() => {
      if (!args.dir) return undefined
      if (args.attach) return args.dir
      try {
        process.chdir(args.dir)
        return process.cwd()
      } catch {
        UI.error("Failed to change directory to " + args.dir)
        process.exit(1)
      }
    })()

    const files: { type: "file"; url: string; filename: string; mime: string }[] = []
    if (args.file) {
      const list = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of list) {
        const resolvedPath = path.resolve(process.cwd(), filePath)
        if (!(await Filesystem.exists(resolvedPath))) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }

        const mime = (await Filesystem.isDir(resolvedPath)) ? "application/x-directory" : "text/plain"

        files.push({
          type: "file",
          url: pathToFileURL(resolvedPath).href,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    if (args.fork && !args.continue && !args.session) {
      UI.error("--fork requires --continue or --session")
      process.exit(1)
    }

    if ((args.replay || args["replay-limit"] !== undefined) && !args.continue && !args.session) {
      UI.error("--replay requires --continue or --session")
      process.exit(1)
    }

    if ((args.replay || args["replay-limit"] !== undefined) && args.format === "json") {
      UI.error("--replay is not supported with --format json")
      process.exit(1)
    }

    if (
      args["replay-limit"] !== undefined &&
      (!Number.isInteger(args["replay-limit"]) || args["replay-limit"] <= 0)
    ) {
      UI.error("--replay-limit must be a positive integer")
      process.exit(1)
    }

    const rules: Permission.Ruleset = [
      {
        permission: "question",
        action: "deny",
        pattern: "*",
      },
      {
        permission: "plan_enter",
        action: "deny",
        pattern: "*",
      },
      {
        permission: "plan_exit",
        action: "deny",
        pattern: "*",
      },
    ]

    function title() {
      if (args.title === undefined) return
      if (args.title !== "") return args.title
      return message.slice(0, 50) + (message.length > 50 ? "..." : "")
    }

    async function session(sdk: OpencodeClient) {
      const baseID = args.continue ? (await sdk.session.list()).data?.find((s) => !s.parentID)?.id : args.session

      if (baseID && args.fork) {
        const forked = await sdk.session.fork({ sessionID: baseID })
        return forked.data?.id
      }

      if (baseID) return baseID

      const name = title()
      const result = await sdk.session.create({ title: name, permission: rules })
      return result.data?.id
    }

    async function share(sdk: OpencodeClient, sessionID: string) {
      const cfg = await sdk.config.get()
      if (!cfg.data) return
      if (cfg.data.share !== "auto" && !Flag.OPENCODE_AUTO_SHARE && !args.share) return
      const res = await sdk.session.share({ sessionID }).catch((error) => {
        if (error instanceof Error && error.message.includes("disabled")) {
          UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
        }
        return { error }
      })
      if (!res.error && "data" in res && res.data?.share?.url) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + res.data.share.url)
      }
    }

    async function execute(sdk: OpencodeClient) {
      function tool(part: ToolPart) {
        try {
          if (part.tool === "bash") return bash(props<typeof BashTool>(part))
          if (part.tool === "glob") return glob(props<typeof GlobTool>(part))
          if (part.tool === "grep") return grep(props<typeof GrepTool>(part))
          if (part.tool === "read") return read(props<typeof ReadTool>(part))
          if (part.tool === "write") return write(props<typeof WriteTool>(part))
          if (part.tool === "webfetch") return webfetch(props<typeof WebFetchTool>(part))
          if (part.tool === "edit") return edit(props<typeof EditTool>(part))
          if (part.tool === "codesearch") return codesearch(props<typeof CodeSearchTool>(part))
          if (part.tool === "websearch") return websearch(props<typeof WebSearchTool>(part))
          if (part.tool === "task") return task(props<typeof TaskTool>(part))
          if (part.tool === "todowrite") return todo(props<typeof TodoWriteTool>(part))
          if (part.tool === "skill") return skill(props<typeof SkillTool>(part))
          return fallback(part)
        } catch {
          return fallback(part)
        }
      }

      function emit(type: string, data: Record<string, unknown>) {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      const eventsAbort = new AbortController()
      const events = await sdk.event.subscribe(undefined, { signal: eventsAbort.signal })
      let error: string | undefined
      const replayedMessageIDs = new Set<string>()
      const replayedPartIDs = new Set<string>()
      const replayedPartText = new Map<string, string>()
      const settledBlockers = new Set<string>()
      const buffered: Event[] = []
      const toggles = new Map<string, boolean>()
      let booting = true
      let turnArmed = false
      let turnLive = false

      async function sessionIdle(fallback: boolean) {
        if (!sessionID) return fallback
        return sdk.session
          .status()
          .then((result) => {
            const item = result.data?.[sessionID]
            return !item || item.type === "idle"
          })
          .catch(() => fallback)
      }

      async function handle(event: Event) {
        if (
          event.type === "message.updated" &&
          event.properties.info.role === "assistant" &&
          args.format !== "json" &&
          toggles.get("start") !== true
        ) {
          if (turnArmed) turnLive = true
          if (replayedMessageIDs.delete(event.properties.info.id)) return false
          UI.empty()
          UI.println(`> ${event.properties.info.agent} · ${event.properties.info.modelID}`)
          UI.empty()
          toggles.set("start", true)
        }

        if (event.type === "message.part.delta") {
          if (event.properties.sessionID !== sessionID) return false
          if (turnArmed) turnLive = true
          if (replayedPartText.has(event.properties.partID)) {
            const seen = replayedPartText.get(event.properties.partID) ?? ""
            if (seen.endsWith(event.properties.delta)) return false
            replayedPartText.delete(event.properties.partID)
            replayedPartIDs.delete(event.properties.partID)
          }
        }

        if (event.type === "message.part.updated") {
          const part = event.properties.part
          if (part.sessionID !== sessionID) return false
          if (turnArmed) turnLive = true
          replayedPartText.delete(part.id)
          if (replayedPartIDs.delete(part.id)) return false

          if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
            if (emit("tool_use", { part })) return false
            if (part.state.status === "completed") {
              tool(part)
              return false
            }
            inline({
              icon: "✗",
              title: `${part.tool} failed`,
            })
            UI.error(part.state.error)
          }

          if (part.type === "tool" && part.tool === "task" && part.state.status === "running" && args.format !== "json") {
            if (toggles.get(part.id) === true) return false
            task(props<typeof TaskTool>(part))
            toggles.set(part.id, true)
          }

          if (part.type === "step-start") {
            if (emit("step_start", { part })) return false
          }

          if (part.type === "step-finish") {
            if (emit("step_finish", { part })) return false
          }

          if (part.type === "text" && part.time?.end) {
            if (emit("text", { part })) return false
            const text = part.text.trim()
            if (!text) return false
            if (!process.stdout.isTTY) {
              process.stdout.write(text + EOL)
              return false
            }
            UI.empty()
            UI.println(text)
            UI.empty()
          }

          if (part.type === "reasoning" && part.time?.end && args.thinking) {
            if (emit("reasoning", { part })) return false
            const text = part.text.trim()
            if (!text) return false
            const line = `Thinking: ${text}`
            if (process.stdout.isTTY) {
              UI.empty()
              UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
              UI.empty()
              return false
            }
            process.stdout.write(line + EOL)
          }
        }

        if (event.type === "session.error") {
          const props = event.properties
          if (props.sessionID !== sessionID || !props.error) return false
          if (turnArmed) turnLive = true
          let err = String(props.error.name)
          if ("data" in props.error && props.error.data && "message" in props.error.data) {
            err = String(props.error.data.message)
          }
          error = error ? error + EOL + err : err
          if (emit("error", { error: props.error })) return false
          UI.error(err)
        }

        if (
          event.type === "session.status" &&
          event.properties.sessionID === sessionID &&
          event.properties.status.type === "idle" &&
          turnArmed &&
          turnLive &&
          (await sessionIdle(true))
        ) {
          return true
        }

        if (event.type === "permission.asked") {
          const permission = event.properties
          if (permission.sessionID !== sessionID || settledBlockers.has(permission.id)) return false
          if (turnArmed) turnLive = true

          if (args["dangerously-skip-permissions"]) {
            await sdk.permission.reply({
              requestID: permission.id,
              reply: "once",
            })
            return false
          }
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL +
              `permission requested: ${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`,
          )
          await sdk.permission.reply({
            requestID: permission.id,
            reply: "reject",
          })
          return false
        }

        if (event.type === "question.asked") {
          const question = event.properties
          if (question.sessionID !== sessionID || settledBlockers.has(question.id)) return false
          if (turnArmed) turnLive = true

          for (const item of question.questions) {
            UI.println(
              UI.Style.TEXT_WARNING_BOLD + "!",
              UI.Style.TEXT_NORMAL + `question requested: ${item.header} - ${item.question}; auto-rejecting`,
            )
          }
          await sdk.question.reject({
            requestID: question.id,
          })
        }

        return false
      }

      async function drainBuffered() {
        const pending = buffered.splice(0)
        for (const event of pending) {
          if ((await handle(event)) === true) return true
        }
        return false
      }

      async function loop() {
        for await (const event of events.stream) {
          if (booting) {
            if (eventSessionID(event) === sessionID) buffered.push(event)
            continue
          }
          if (eventSessionID(event) !== sessionID) continue
          if ((await handle(event)) === true) break
        }

        return error
      }

      async function replay(sessionID: string) {
        if (!args.replay && args["replay-limit"] === undefined) return
        const history = await sdk.session.messages({ sessionID })
        const snapshot = collectReplaySnapshot(history.data ?? [], {
          thinking: args.thinking,
          limit: args["replay-limit"],
        })
        const items = collectReplayItems(history.data ?? [], {
          thinking: args.thinking,
          limit: args["replay-limit"],
        })
        if (items.length === 0) return
        for (const id of snapshot.assistantMessageIDs) replayedMessageIDs.add(id)
        for (const id of snapshot.partIDs) replayedPartIDs.add(id)
        for (const [id, text] of Object.entries(snapshot.partText)) replayedPartText.set(id, text)

        UI.empty()
        UI.println(UI.Style.TEXT_DIM + "Replaying session history" + UI.Style.TEXT_NORMAL)
        UI.empty()

        for (const item of items) {
          if (item.type === "assistant-header") {
            UI.empty()
            UI.println(`> ${item.agent} · ${item.modelID}`)
            UI.empty()
            continue
          }

          if (item.type === "user") {
            UI.println(`${UI.Style.TEXT_DIM}> ${item.text}${UI.Style.TEXT_NORMAL}`)
            UI.empty()
            continue
          }

          if (item.type === "text") {
            UI.println(item.text)
            UI.empty()
            continue
          }

          if (item.type === "reasoning") {
            UI.println(`${UI.Style.TEXT_DIM}\u001b[3mThinking: ${item.text}\u001b[0m${UI.Style.TEXT_NORMAL}`)
            UI.empty()
            continue
          }

          if (item.type === "tool") {
            tool(item.part)
            continue
          }

          UI.error(item.text)
        }
      }

      async function settlePendingBlockers(sessionID: string) {
        const [permissions, questions] = await Promise.all([sdk.permission.list(), sdk.question.list()])
        const blockers = collectReplayBlockers({
          sessionID,
          permissions: permissions.data ?? [],
          questions: questions.data ?? [],
        })
        if (blockers.length === 0) return

        UI.empty()
        UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + " pending blockers found on resumed session")
        UI.empty()

        for (const blocker of blockers) {
          if (blocker.type === "permission") {
            const message = `${blocker.permission} (${blocker.patterns.join(", ")})`
            if (args["dangerously-skip-permissions"]) {
              UI.println(UI.Style.TEXT_WARNING_BOLD + "~", UI.Style.TEXT_NORMAL + ` auto-approving pending permission: ${message}`)
              settledBlockers.add(blocker.id)
              await sdk.permission.reply({
                requestID: blocker.id,
                reply: "once",
              })
              continue
            }

            UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL + ` auto-rejecting pending permission: ${message}`)
            settledBlockers.add(blocker.id)
            await sdk.permission.reply({
              requestID: blocker.id,
              reply: "reject",
            })
            continue
          }

          UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL + ` auto-rejecting pending question: ${blocker.header} - ${blocker.question}`)
          settledBlockers.add(blocker.id)
          await sdk.question.reject({
            requestID: blocker.id,
          })
        }

        UI.empty()
      }

      // Validate agent if specified
      const agent = await (async () => {
        if (!args.agent) return undefined
        const name = args.agent

        // When attaching, validate against the running server instead of local Instance state.
        if (args.attach) {
          const modes = await sdk.app
            .agents(undefined, { throwOnError: true })
            .then((x) => x.data ?? [])
            .catch(() => undefined)

          if (!modes) {
            UI.println(
              UI.Style.TEXT_WARNING_BOLD + "!",
              UI.Style.TEXT_NORMAL,
              `failed to list agents from ${args.attach}. Falling back to default agent`,
            )
            return undefined
          }

          const agent = modes.find((a) => a.name === name)
          if (!agent) {
            UI.println(
              UI.Style.TEXT_WARNING_BOLD + "!",
              UI.Style.TEXT_NORMAL,
              `agent "${name}" not found. Falling back to default agent`,
            )
            return undefined
          }

          if (agent.mode === "subagent") {
            UI.println(
              UI.Style.TEXT_WARNING_BOLD + "!",
              UI.Style.TEXT_NORMAL,
              `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
            )
            return undefined
          }

          return name
        }

        const entry = await AppRuntime.runPromise(Agent.Service.use((svc) => svc.get(name)))
        if (!entry) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (entry.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return name
      })()

      const sessionID = await session(sdk)
      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }
      await share(sdk, sessionID)
      const completed = loop().catch((e) => {
        console.error(e)
        process.exit(1)
      })
      await settlePendingBlockers(sessionID)
      await replay(sessionID)
      booting = false
      if (await drainBuffered()) {
        const loopError = await completed
        if (loopError) process.exitCode = 1
        return
      }

      if (args.command) {
        turnArmed = true
        turnLive = false
        const result = await sdk.session.command({
          sessionID,
          agent,
          model: args.model,
          command: args.command,
          arguments: message,
          variant: args.variant,
        })
        if (result.error) {
          eventsAbort.abort()
          if (!emit("error", { error: result.error })) UI.error(formatRunError(result.error))
          process.exitCode = 1
          await completed.catch(() => undefined)
          return
        }
        const loopError = await completed
        if (loopError) process.exitCode = 1
      } else {
        const model = args.model ? Provider.parseModel(args.model) : undefined
        turnArmed = true
        turnLive = false
        const result = await sdk.session.prompt({
          sessionID,
          agent,
          model,
          variant: args.variant,
          parts: [...files, { type: "text", text: message }],
        })
        if (result.error) {
          eventsAbort.abort()
          if (!emit("error", { error: result.error })) UI.error(formatRunError(result.error))
          process.exitCode = 1
          await completed.catch(() => undefined)
          return
        }
        const loopError = await completed
        if (loopError) process.exitCode = 1
      }
    }

    if (args.attach) {
      const headers = (() => {
        const password = args.password ?? process.env.OPENCODE_SERVER_PASSWORD
        if (!password) return undefined
        const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
        const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
        return { Authorization: auth }
      })()
      const sdk = createOpencodeClient({ baseUrl: args.attach, directory, headers })
      return await execute(sdk)
    }

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.Default().app.fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })
      await execute(sdk)
    })
  },
})
