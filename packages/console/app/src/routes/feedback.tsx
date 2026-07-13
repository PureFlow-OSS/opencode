import { Title } from "@solidjs/meta"
import { createMemo, createResource, createSignal, Show } from "solid-js"

const UPDATE_SERVER_BASE_URL = import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"

type BetaStatus = {
  betaTester: boolean
  userName: string | null
}

type BetaSentiment = "positive" | "negative"

type FeedbackAttachment = {
  name: string
  type: string
  data: string
}

const betaPrefix = {
  positive: "Version erfolgreich getestet",
  negative: "Fehler gefunden",
} satisfies Record<BetaSentiment, string>

const betaPrefixPattern = /^(Version erfolgreich getestet|Fehler gefunden)\s*\n?/i

function composeBetaMessage(sentiment: BetaSentiment, message: string) {
  const body = message.replace(betaPrefixPattern, "").trim()
  return `${betaPrefix[sentiment]}\n${body}`.trimEnd()
}

async function readAttachment(file: File): Promise<FeedbackAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    data: btoa(chunks.join("")),
  }
}

export default function Feedback() {
  const [betaSentiment, setBetaSentiment] = createSignal<BetaSentiment | null>(null)
  const [betaStatus] = createResource(async () => {
    const response = await fetch(`${UPDATE_SERVER_BASE_URL}/admin/beta/status`)

    if (!response.ok) return null
    return (await response.json()) as BetaStatus
  })

  const submitFeedback = async (form: HTMLFormElement, mode: "general" | "beta") => {
    const data = new FormData(form)
    const message = String(data.get("message") ?? "").trim()
    const attachments = await Promise.all(
      Array.from(data.getAll("attachments")).flatMap((value) => (value instanceof File && value.size ? [readAttachment(value)] : [])),
    )
    const payload = {
      text: mode === "beta" && betaSentiment() ? composeBetaMessage(betaSentiment()!, message) : message,
      category: mode === "beta" ? "beta" : "general",
      app_version: String(data.get("appVersion") ?? "").trim() || undefined,
      platform: String(data.get("platform") ?? "").trim() || undefined,
      attachments,
    }

    if (!payload.text) throw new Error("Message is required")

    const response = await fetch(`${UPDATE_SERVER_BASE_URL}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!response.ok) throw new Error(await response.text())
  }

  return (
    <main data-page="feedback">
      <Title>OpenCode Feedback</Title>
      <section data-card>
        <h1>Feedback senden</h1>
        <p>Send general feedback directly to the updater server.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            await submitFeedback(event.currentTarget, "general")
          }}
        >
          <input name="appVersion" placeholder="App version" />
          <input name="platform" placeholder="Platform" />
          <input name="attachments" type="file" multiple />
          <textarea name="message" placeholder="What would you like to tell the team?" />
          <button type="submit">Send feedback</button>
        </form>
        <Show when={betaStatus()?.betaTester}>
          <section data-card>
            <h2>Beta feedback</h2>
            <p>Visible only for beta testers. Failure to validate your key hides this section.</p>
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                await submitFeedback(event.currentTarget, "beta")
              }}
            >
              <input type="hidden" name="channel" value="beta" />
              <input type="hidden" name="betaSentiment" value={betaSentiment() ?? ""} />
              <input name="appVersion" placeholder="Beta version" />
              <input name="platform" placeholder="Platform" />
              <input name="attachments" type="file" multiple />
              <div data-card>
                <button type="button" onClick={() => setBetaSentiment("positive")}>Version erfolgreich getestet</button>
                <button type="button" onClick={() => setBetaSentiment("negative")}>Fehler gefunden</button>
              </div>
              <textarea name="message" placeholder="Write your details here..." />
              <button type="submit" disabled={!betaSentiment()}>Send beta feedback</button>
            </form>
          </section>
        </Show>
      </section>
    </main>
  )
}
