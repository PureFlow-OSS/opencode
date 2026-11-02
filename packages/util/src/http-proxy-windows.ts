export * as HttpProxyWindows from "./http-proxy-windows.js"

import { Schema } from "effect"
import { spawn } from "node:child_process"
import { Readable } from "node:stream"

// Windows negotiates proxy credentials; request data stays on stdin, never in command arguments.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Net.Http
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
$handler = New-Object System.Net.Http.HttpClientHandler
$proxyUri = [Uri]$data.proxy
$proxy = New-Object System.Net.WebProxy($proxyUri)
$proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
if ($proxyUri.UserInfo) {
  $parts = $proxyUri.UserInfo.Split(':', 2)
  $password = ''
  if ($parts.Length -gt 1) { $password = [Uri]::UnescapeDataString($parts[1]) }
  $proxy.Credentials = New-Object Net.NetworkCredential([Uri]::UnescapeDataString($parts[0]), $password)
}
$handler.Proxy = $proxy
$handler.UseProxy = $true
$handler.AllowAutoRedirect = $data.redirect -eq 'follow'
$handler.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [Threading.Timeout]::InfiniteTimeSpan
$message = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($data.method)), $data.url)
if ($null -ne $data.body) {
  $message.Content = New-Object System.Net.Http.ByteArrayContent(,[Convert]::FromBase64String($data.body))
}
foreach ($header in $data.headers) {
  if ($header[0] -in @('host', 'content-length', 'proxy-authorization', 'connection')) { continue }
  if (!$message.Headers.TryAddWithoutValidation([string]$header[0], [string]$header[1]) -and $message.Content) {
    [void]$message.Content.Headers.TryAddWithoutValidation([string]$header[0], [string]$header[1])
  }
}
try {
  $response = $client.SendAsync($message, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  $headers = @()
  foreach ($header in $response.Headers) { foreach ($value in $header.Value) { $headers += ,@($header.Key, $value) } }
  foreach ($header in $response.Content.Headers) { foreach ($value in $header.Value) { $headers += ,@($header.Key, $value) } }
  $metadata = @{ status = [int]$response.StatusCode; headers = $headers; url = $response.RequestMessage.RequestUri.AbsoluteUri }
  $output = [Console]::OpenStandardOutput()
  $line = [Text.Encoding]::UTF8.GetBytes(($metadata | ConvertTo-Json -Compress -Depth 8) + [char]10)
  $output.Write($line, 0, $line.Length)
  $output.Flush()
  $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $buffer = New-Object byte[] 8192
  while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $output.Write($buffer, 0, $count)
    $output.Flush()
  }
  $output.Flush()
} catch {
  [Console]::Error.WriteLine('Windows proxy transport failed')
  exit 1
} finally {
  $message.Dispose()
  $client.Dispose()
}
`

const metadata = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Number,
    headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
    url: Schema.String,
  }),
)

export async function fetch(proxy: string, input: string | Request | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
  request.signal.throwIfAborted()
  const body = request.body ? Buffer.from(await request.arrayBuffer()).toString("base64") : null
  request.signal.throwIfAborted()
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  )
  const stop = () => child.kill()
  const exited = new Promise<number>((resolve) => {
    child.once("error", () => resolve(1))
    child.once("close", (code) => resolve(code ?? 1))
  })
  child.stdin.on("error", stop)
  child.stdin.end(
    JSON.stringify({
      proxy,
      url: request.url,
      method: request.method,
      redirect: request.redirect,
      headers: [...request.headers],
      body,
    }),
  )
  // Always drain stderr so transport failures cannot fill the child process pipe.
  child.stderr.resume()
  const reader = Readable.toWeb(child.stdout).getReader()
  const abort = () => {
    stop()
    void reader.cancel(request.signal.reason).catch(() => {})
  }
  request.signal.addEventListener("abort", abort, { once: true })
  const finish = () => request.signal.removeEventListener("abort", abort)
  try {
    const chunks: Uint8Array[] = []
    while (true) {
      const part = await reader.read()
      request.signal.throwIfAborted()
      if (part.done) throw new Error("Windows proxy transport failed before receiving response headers")
      const newline = part.value.indexOf(10)
      if (newline < 0) {
        chunks.push(part.value)
        continue
      }
      chunks.push(part.value.subarray(0, newline))
      const info = metadata(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      if (request.redirect === "error" && [301, 302, 303, 307, 308].includes(info.status))
        throw new TypeError("Redirect encountered with redirect mode error")
      const remaining = part.value.subarray(newline + 1)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (remaining.length) controller.enqueue(remaining)
        },
        async pull(controller) {
          try {
            const next = await reader.read()
            request.signal.throwIfAborted()
            if (!next.done) return controller.enqueue(next.value)
            const code = await exited
            finish()
            if (code) throw new Error("Windows proxy response stream failed")
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
      if (empty) {
        await stream.cancel()
      }
      const response = new Response(empty ? null : stream, {
        status: info.status,
        headers: info.headers.map((item) => [...item]),
      })
      Object.defineProperties(response, { url: { value: info.url }, redirected: { value: info.url !== request.url } })
      return response
    }
  } catch (error) {
    finish()
    stop()
    await reader.cancel()
    throw error
  }
}
