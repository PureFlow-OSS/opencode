import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Config } from "@/config"
import * as Process from "@/util/process"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.optional(Schema.Literals(["text", "markdown", "html"])).annotate({
    description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(HttpClient.followRedirects(http))
    const config = yield* Effect.serviceOption(Config.Service)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          const url = params.url.startsWith("http://") ? `https://${params.url.slice("http://".length)}` : params.url

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url, url],
            always: ["*"],
            metadata: {
              url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
          const format = params.format ?? "markdown"

          // Build Accept header based on requested format with q parameters for fallbacks
          let acceptHeader = "*/*"
          switch (format) {
            case "markdown":
              acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
              break
            case "text":
              acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
              break
            case "html":
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              break
            default:
              acceptHeader =
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          }
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const proxy =
            config._tag === "Some"
              ? ((yield* config.value.get()).use_http_proxy === false ? undefined : (yield* config.value.get()).http_proxy)
              : envProxy

          if (process.platform === "win32" && proxy) {
            const script = [
              "$ErrorActionPreference = 'Stop'",
              "$ProgressPreference = 'SilentlyContinue'",
              `$headers = @{ 'User-Agent' = '${headers["User-Agent"]}'; 'Accept' = '${headers.Accept}'; 'Accept-Language' = '${headers["Accept-Language"]}' }`,
              "$response = $null",
              "for ($i = 0; $i -lt 2; $i++) { try {",
              `  $response = Invoke-WebRequest -UseBasicParsing -MaximumRedirection 10 -Uri '${url}' -Headers $headers -Proxy '${proxy}' -ProxyUseDefaultCredentials -TimeoutSec ${Math.max(1, Math.ceil(timeout / 1000))}`,
              "  break",
              "} catch {",
              "  if ($i -eq 1) { throw }",
              "  Start-Sleep -Milliseconds 300",
              "} }",
              "$content = [string]$response.Content",
              "$contentType = [string]$response.Headers['Content-Type']",
              "$finalUrl = if ($response.BaseResponse -and $response.BaseResponse.ResponseUri) { [string]$response.BaseResponse.ResponseUri.AbsoluteUri } else { '' }",
              "Write-Output $finalUrl",
              "Write-Output $contentType",
              "Write-Output $content",
            ].join("; ")
            const raw = yield* Effect.promise(() =>
              Process.text(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script]),
            )
            if (!raw.text.trim()) {
              throw new Error("PowerShell webfetch returned no output")
            }
            const [finalUrl = url, contentType = "", ...contentLines] = raw.text.replace(/\r/g, "").trimEnd().split("\n")
            if (!finalUrl.trim()) {
              throw new Error("PowerShell webfetch did not return a final URL")
            }
            const content = contentLines.join("\n")
            const title = `${finalUrl} (${contentType})`

            switch (format) {
              case "markdown":
                if (contentType.includes("text/html")) {
                  return {
                    output: formatFetchedContent({
                      url: finalUrl,
                      format,
                      contentType,
                      content,
                      output: convertHTMLToMarkdown(content),
                    }),
                    title,
                    metadata: {},
                  }
                }
                return {
                  output: formatFetchedContent({
                    url: finalUrl,
                    format,
                    contentType,
                    content,
                    output: content,
                  }),
                  title,
                  metadata: {},
                }

              case "text":
                if (contentType.includes("text/html")) {
                  const text = yield* Effect.promise(() => extractTextFromHTML(content))
                  return {
                    output: formatFetchedContent({
                      url: finalUrl,
                      format,
                      contentType,
                      content,
                      output: text,
                    }),
                    title,
                    metadata: {},
                  }
                }
                return {
                  output: formatFetchedContent({
                    url: finalUrl,
                    format,
                    contentType,
                    content,
                    output: content,
                  }),
                  title,
                  metadata: {},
                }

              case "html":
                return {
                  output: formatFetchedContent({
                    url: finalUrl,
                    format,
                    contentType,
                    content,
                    output: content,
                  }),
                  title,
                  metadata: {},
                }

              default:
                return {
                  output: formatFetchedContent({
                    url: finalUrl,
                    format,
                    contentType,
                    content,
                    output: content,
                  }),
                  title,
                  metadata: {},
                }
            }
          }

          const request = HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers))

          // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
          const response = yield* httpOk.execute(request).pipe(
            Effect.catchIf(
              (err) =>
                err.reason._tag === "StatusCodeError" &&
                err.reason.response.status === 403 &&
                err.reason.response.headers["cf-mitigated"] === "challenge",
              () =>
                httpOk.execute(
                  HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders({ ...headers, "User-Agent": "opencode" })),
                ),
            ),
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
          )

          // Check content length
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const arrayBuffer = yield* response.arrayBuffer
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const contentType = response.headers["content-type"] || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const finalUrl = response.request.url
          const title = `${finalUrl} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(arrayBuffer).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = new TextDecoder().decode(arrayBuffer)

          // Handle content based on requested format and actual content type
          switch (format) {
            case "markdown":
              if (contentType.includes("text/html")) {
                const markdown = convertHTMLToMarkdown(content)
                return {
                  output: formatFetchedContent({
                    url: finalUrl,
                    format,
                    contentType,
                    content,
                    output: markdown,
                  }),
                  title,
                  metadata: {},
                }
              }
              return {
                output: formatFetchedContent({
                  url: finalUrl,
                  format,
                  contentType,
                  content,
                  output: content,
                }),
                title,
                metadata: {},
              }

            case "text":
              if (contentType.includes("text/html")) {
                const text = yield* Effect.promise(() => extractTextFromHTML(content))
                return {
                  output: formatFetchedContent({
                    url: finalUrl,
                    format,
                    contentType,
                    content,
                    output: text,
                  }),
                  title,
                  metadata: {},
                }
              }
              return {
                output: formatFetchedContent({
                  url: finalUrl,
                  format,
                  contentType,
                  content,
                  output: content,
                }),
                title,
                metadata: {},
              }

            case "html":
              return {
                output: formatFetchedContent({
                  url: finalUrl,
                  format,
                  contentType,
                  content,
                  output: content,
                }),
                title,
                metadata: {},
              }

            default:
              return {
                output: formatFetchedContent({
                  url: finalUrl,
                  format,
                  contentType,
                  content,
                  output: content,
                }),
                title,
                metadata: {},
              }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

async function extractTextFromHTML(html: string) {
  return sanitizeHTML(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(sanitizeHTML(html))
}

function formatFetchedContent(input: {
  url: string
  format: "text" | "markdown" | "html"
  contentType: string
  content: string
  output: string
}) {
  if (input.output.trim()) return input.output

  if (input.format === "html" && input.content.trim()) return input.content

  const text = extractTextFallback(input.content)
  if (text) return text

  if (input.content.trim()) {
    return [
      `Fetched ${input.url} successfully, but the ${input.format} conversion produced no readable text.`,
      `Content-Type: ${input.contentType || "unknown"}`,
      `Raw content length: ${input.content.length} bytes`,
    ].join("\n")
  }

  return [
    `Fetched ${input.url} successfully, but the response body was empty.`,
    `Content-Type: ${input.contentType || "unknown"}`,
  ].join("\n")
}

function extractTextFallback(content: string) {
  return sanitizeHTML(content)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function sanitizeHTML(html: string) {
  return [
    /<script[\s\S]*?<\/script>/gi,
    /<style[\s\S]*?<\/style>/gi,
    /<noscript[\s\S]*?<\/noscript>/gi,
    /<iframe[\s\S]*?<\/iframe>/gi,
    /<form[^>]+(?:consent|cookie|privacy|gdpr|onetrust|didomi|trustarc|fundingchoices|fc-consent-root|sp_message_container)[^>]*>[\s\S]*?<\/form>/gi,
    /<section[^>]+(?:consent|cookie|privacy|gdpr|onetrust|didomi|trustarc|fundingchoices|fc-consent-root|sp_message_container)[^>]*>[\s\S]*?<\/section>/gi,
    /<div[^>]+(?:consent|cookie|privacy|gdpr|onetrust|didomi|trustarc|fundingchoices|fc-consent-root|sp_message_container)[^>]*>[\s\S]*?<\/div>/gi,
    /<aside[^>]+(?:consent|cookie|privacy|gdpr|onetrust|didomi|trustarc|fundingchoices|fc-consent-root|sp_message_container)[^>]*>[\s\S]*?<\/aside>/gi,
    /<dialog[^>]*>[\s\S]*?<\/dialog>/gi,
    /<div[^>]+aria-modal=["']true["'][^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]+role=["']dialog["'][^>]*>[\s\S]*?<\/div>/gi,
    /<title>\s*(Before you continue|Datenschutz|Privacy settings|Cookie Settings|Consent)[\s\S]*?<\/title>/gi,
  ].reduce((output, pattern) => output.replace(pattern, " "), html)
}
