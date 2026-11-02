export * as HttpProxyWindows from "./http-proxy-windows.js"

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer, type Socket } from "node:net"
import path from "node:path"
import { Readable } from "node:stream"

type Metadata = { status: number; headers: Headers; url: string }

/** Windows curl uses Schannel and SSPI without executing PowerShell code under application-control policies. */
export async function fetch(proxy: string, input: string | Request | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
  request.signal.throwIfAborted()
  if (!URL.canParse(proxy) || !["http:", "https:"].includes(new URL(proxy).protocol))
    throw new Error("Windows proxy transport requires a valid HTTP(S) proxy URL")
  const url = new URL(proxy)
  const credentials =
    url.username || url.password ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` : ":"
  url.username = ""
  url.password = ""
  const body = request.body
    ? Buffer.from(await request.arrayBuffer())
    : request.method === "POST"
      ? Buffer.alloc(0)
      : undefined
  request.signal.throwIfAborted()
  const response = Promise.withResolvers<Metadata>()
  const exited = Promise.withResolvers<number>()
  const state: {
    child?: ChildProcessWithoutNullStreams
    cancel?: (reason?: unknown) => Promise<void>
    url: string
    pending: string
    last?: Metadata
    spawn?: string
  } = {
    url: request.url,
    pending: "",
  }
  // Header and upload pipes keep credentials and binary bodies off disk and out of process arguments.
  const headers = pipe((socket) => {
    socket.on("data", (chunk: Buffer) => {
      try {
        state.pending += chunk.toString("latin1")
        while (true) {
          const end = state.pending.indexOf("\r\n\r\n")
          if (end < 0) return
          const lines = state.pending.slice(0, end).split("\r\n")
          state.pending = state.pending.slice(end + 4)
          const status = /^HTTP\/\S+ (\d{3})/.exec(lines.shift() ?? "")
          if (!status) continue
          const fields = new Headers()
          for (const line of lines) {
            const separator = line.indexOf(":")
            if (separator > 0) fields.append(line.slice(0, separator), line.slice(separator + 1).trim())
          }
          const info = { status: Number(status[1]), headers: fields, url: state.url }
          if (info.status < 200) continue
          state.last = info
          // A proxy challenge can precede an SSPI retry; expose it only if the transfer finishes there.
          if (info.status === 407) continue
          if ([301, 302, 303, 307, 308].includes(info.status)) {
            if (request.redirect === "error") {
              response.reject(new TypeError("Redirect encountered with redirect mode error"))
              stop()
              return
            }
            const location = fields.get("location")
            if (request.redirect === "follow" && location) {
              state.url = new URL(location, state.url).href
              continue
            }
          }
          // curl decompresses the stream, so these describe wire bytes rather than the returned body.
          if (fields.has("content-encoding")) {
            fields.delete("content-encoding")
            fields.delete("content-length")
          }
          response.resolve(info)
        }
      } catch {
        response.reject(new Error("Windows proxy transport received invalid response headers"))
        stop()
      }
    })
  })
  const upload = body ? pipe((socket) => socket.end(body)) : undefined
  const pipes = upload ? [headers, upload] : [headers]
  const stop = () => {
    state.child?.kill()
    for (const channel of pipes) channel.close()
  }
  const abort = () => {
    response.reject(request.signal.reason)
    stop()
    void state.cancel?.(request.signal.reason).catch(() => {})
  }
  const finish = () => request.signal.removeEventListener("abort", abort)
  try {
    await Promise.all(pipes.map((channel) => channel.ready))
    request.signal.throwIfAborted()
    const child = spawn(
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe"),
      ["-q", "--config", "-"],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
    state.child = child
    child.once("error", (error) => {
      if ("code" in error && typeof error.code === "string" && /^[A-Z_]+$/.test(error.code)) state.spawn = error.code
      exited.resolve(1)
    })
    child.once("close", (code) => exited.resolve(code ?? 1))
    child.stdin.on("error", () => child.kill())
    child.stderr.resume()
    const reader = Readable.toWeb(child.stdout).getReader()
    state.cancel = (reason) => reader.cancel(reason)
    const failure = (code: number) => {
      const reason: Record<number, string> = {
        5: "ProxyNameResolutionFailure",
        6: "NameResolutionFailure",
        7: "ConnectFailure",
        28: "Timeout",
        35: "TLSHandshakeFailure",
        56: "ProxyOrReceiveFailure",
        60: "CertificateVerificationFailed",
        67: "AuthenticationFailure",
        97: "ProxyHandshakeFailure",
      }
      return new Error(
        `Windows proxy transport failed (curl ${code}: ${state.spawn ?? reason[code] ?? "TransferFailure"})`,
      )
    }
    void exited.promise.then((code) => {
      for (const channel of pipes) channel.close()
      if (code) return response.reject(failure(code))
      if (state.last) return response.resolve(state.last)
      response.reject(new Error("Windows proxy transport ended without response headers"))
    })
    request.signal.addEventListener("abort", abort, { once: true })
    child.stdin.end(
      [
        "silent",
        "no-buffer",
        "compressed",
        "proxy-anyauth",
        "suppress-connect-headers",
        `proto = "=http,https"`,
        `proto-redir = "=http,https"`,
        `noproxy = ""`,
        `user-agent = ""`,
        `proxy = ${quote(url.href)}`,
        `proxy-user = ${quote(credentials)}`,
        `url = ${quote(request.url)}`,
        `dump-header = ${quote(headers.path)}`,
        ...(request.method === "HEAD"
          ? ["head"]
          : ["GET", "POST"].includes(request.method)
            ? []
            : [`request = ${quote(request.method)}`]),
        ...(request.redirect === "follow" ? ["location", "max-redirs = 20"] : []),
        ...Array.from(request.headers).flatMap(([key, value]) =>
          ["host", "content-length", "connection", "transfer-encoding", "proxy-authorization"].includes(key)
            ? []
            : [`header = ${quote(`${key}: ${value}`)}`],
        ),
        ...(upload ? [`data-binary = ${quote(`@${upload.path}`)}`] : []),
        ...(upload && !request.headers.has("content-type") ? [`header = "Content-Type:"`] : []),
      ].join("\n") + "\n",
    )
    if (request.signal.aborted) abort()
    const info = await response.promise
    request.signal.throwIfAborted()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read()
          request.signal.throwIfAborted()
          if (!next.done) return controller.enqueue(next.value)
          const code = await exited.promise
          finish()
          if (code) throw failure(code)
          controller.close()
        } catch (error) {
          finish()
          stop()
          controller.error(error)
        }
      },
      async cancel() {
        finish()
        stop()
        await reader.cancel()
      },
    })
    const empty = request.method === "HEAD" || [204, 205, 304].includes(info.status)
    if (empty) await stream.cancel()
    const result = new Response(empty ? null : stream, { status: info.status, headers: info.headers })
    Object.defineProperties(result, { url: { value: info.url }, redirected: { value: info.url !== request.url } })
    return result
  } catch (error) {
    finish()
    stop()
    throw error
  }
}

function quote(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "\\r").replaceAll("\n", "\\n").replaceAll("\t", "\\t")}"`
}

function pipe(handle: (socket: Socket) => void) {
  const name = `\\\\.\\pipe\\opencode-http-${randomUUID()}`
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on("error", () => {})
    socket.once("close", () => sockets.delete(socket))
    handle(socket)
  })
  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(name, resolve)
  })
  return {
    path: name,
    ready,
    close() {
      for (const socket of sockets) socket.destroy()
      if (server.listening) server.close()
    },
  }
}
