import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./playwright.txt"
import type { Browser, BrowserType, LaunchOptions, Page } from "playwright-core"

const actions = ["navigate", "screenshot", "click", "type", "evaluate", "text", "close"] as const
const DEFAULT_TIMEOUT = 30_000
const MAX_TIMEOUT = 120_000
type Metadata = {
  url?: string
  title?: string
  selector?: string
  truncated?: boolean
}

function output(input: Tool.ExecuteResult<Metadata>) {
  return input
}

export const Parameters = Schema.Struct({
  action: Schema.Literals(actions).annotate({ description: "Browser action to perform" }),
  url: Schema.optional(Schema.String).annotate({ description: "URL to navigate to. Required for navigate." }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector for click, type, or text. Defaults to body for text.",
  }),
  text: Schema.optional(Schema.String).annotate({ description: "Text to type. Required for type." }),
  script: Schema.optional(Schema.String).annotate({
    description: "JavaScript expression or function body to evaluate in the page. Required for evaluate.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in milliseconds (max 120000)" }),
  width: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "Viewport width in pixels",
  }),
  height: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "Viewport height in pixels",
  }),
  full_page: Schema.optional(Schema.Boolean).annotate({ description: "Capture the full page for screenshots" }),
  executable_path: Schema.optional(Schema.String).annotate({
    description:
      "Path to a Chrome, Chromium, or Edge executable. If omitted, OPENCODE_PLAYWRIGHT_EXECUTABLE_PATH or an installed Chrome/Edge channel is used.",
  }),
})

export const PlaywrightTool = Tool.define(
  "playwright",
  Effect.gen(function* () {
    let browser: Browser | undefined
    let page: Page | undefined
    let playwright: typeof import("playwright-core") | undefined

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await page?.close().catch(() => undefined)
        await browser?.close().catch(() => undefined)
      }),
    )

    const launch = async (chromium: BrowserType, options: LaunchOptions[]): Promise<Browser> => {
      for (const item of options) {
        try {
          return await chromium.launch(item)
        } catch {}
      }
      throw new Error(
        [
          "No system browser available for playwright tool.",
          "Install Chrome/Edge or set OPENCODE_PLAYWRIGHT_EXECUTABLE_PATH to a browser executable.",
        ].join("\n"),
      )
    }

    const ensurePage = async (params: Schema.Schema.Type<typeof Parameters>) => {
      playwright = playwright ?? (await import("playwright-core"))
      const activeBrowser =
        browser ??
        (await launch(playwright.chromium, [
          ...(params.executable_path || process.env.OPENCODE_PLAYWRIGHT_EXECUTABLE_PATH
            ? [
                {
                  headless: true,
                  executablePath: params.executable_path ?? process.env.OPENCODE_PLAYWRIGHT_EXECUTABLE_PATH,
                },
              ]
            : []),
          { headless: true, channel: "chrome" },
          { headless: true, channel: "chrome-beta" },
          { headless: true, channel: "chrome-dev" },
          { headless: true, channel: "msedge" },
        ]))
      browser = activeBrowser
      page = page ?? (await activeBrowser.newPage())
      if (params.width || params.height) {
        await page.setViewportSize({ width: params.width ?? 1280, height: params.height ?? 720 })
      }
      return page
    }

    const current = () => {
      if (!page) throw new Error("No browser page is open. Call playwright with action=navigate first.")
      return page
    }

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
          yield* ctx.ask({
            permission: "playwright",
            patterns: params.url ? [params.url] : [params.action],
            always: ["*"],
            metadata: {
              action: params.action,
              url: params.url,
              selector: params.selector,
            },
          })

          switch (params.action) {
            case "navigate": {
              if (!params.url) throw new Error("url is required for navigate")
              const active = yield* Effect.promise(() => ensurePage(params))
              yield* Effect.promise(() => active.goto(params.url!, { waitUntil: "domcontentloaded", timeout }))
              return output({
                title: `navigate ${params.url}`,
                metadata: { url: active.url(), title: yield* Effect.promise(() => active.title()) },
                output: `Navigated to ${active.url()}`,
              })
            }

            case "screenshot": {
              const active = current()
              const bytes = yield* Effect.promise(() =>
                active.screenshot({ fullPage: params.full_page ?? false, timeout }),
              )
              return output({
                title: `screenshot ${active.url()}`,
                metadata: { url: active.url(), truncated: false },
                output: "Screenshot captured",
                attachments: [
                  {
                    type: "file" as const,
                    mime: "image/png",
                    url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
                  },
                ],
              })
            }

            case "click": {
              if (!params.selector) throw new Error("selector is required for click")
              const active = current()
              yield* Effect.promise(() => active.locator(params.selector!).click({ timeout }))
              return output({
                title: `click ${params.selector}`,
                metadata: { url: active.url(), selector: params.selector },
                output: `Clicked ${params.selector}`,
              })
            }

            case "type": {
              if (!params.selector) throw new Error("selector is required for type")
              if (params.text === undefined) throw new Error("text is required for type")
              const active = current()
              yield* Effect.promise(() => active.locator(params.selector!).fill(params.text!, { timeout }))
              return output({
                title: `type ${params.selector}`,
                metadata: { url: active.url(), selector: params.selector },
                output: `Typed into ${params.selector}`,
              })
            }

            case "evaluate": {
              if (!params.script) throw new Error("script is required for evaluate")
              const active = current()
              const result = yield* Effect.promise(() =>
                active.evaluate((script: string) => globalThis.eval(script), params.script!),
              )
              return output({
                title: "evaluate",
                metadata: { url: active.url() },
                output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
              })
            }

            case "text": {
              const active = current()
              const selector = params.selector ?? "body"
              const result = yield* Effect.promise(() => active.locator(selector).innerText({ timeout }))
              return output({
                title: `text ${selector}`,
                metadata: { url: active.url(), selector },
                output: result,
              })
            }

            case "close": {
              yield* Effect.promise(async () => {
                await page?.close()
                await browser?.close()
                page = undefined
                browser = undefined
              })
              return output({
                title: "close",
                metadata: {},
                output: "Browser closed",
              })
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
