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
  let binary = ""
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    data: btoa(binary),
  }
}

export default function Feedback() {
  const [betaSentiment, setBetaSentiment] = createSignal<BetaSentiment | null>(null)
  const [generalFiles, setGeneralFiles] = createSignal<File[]>([])
  const [betaFiles, setBetaFiles] = createSignal<File[]>([])
  const [betaStatus] = createResource(async () => {
    const response = await fetch(`${UPDATE_SERVER_BASE_URL}/admin/beta/status`)

    if (!response.ok) return null
    return (await response.json()) as BetaStatus
  })

  const submitFeedback = async (form: HTMLFormElement, mode: "general" | "beta", attachments: File[]) => {
    const data = new FormData(form)
    const message = String(data.get("message") ?? "").trim()
    const payload = {
      text: mode === "beta" && betaSentiment() ? composeBetaMessage(betaSentiment()!, message) : message,
      category: mode === "beta" ? "beta" : "general",
      app_version: String(data.get("appVersion") ?? "").trim() || undefined,
      platform: String(data.get("platform") ?? "").trim() || undefined,
      attachments: await Promise.all(attachments.map((file) => readAttachment(file))),
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
            await submitFeedback(event.currentTarget, "general", generalFiles())
          }}
        >
          <input name="appVersion" placeholder="App version" />
          <input name="platform" placeholder="Platform" />
          <input
            type="file"
            multiple
            onChange={(event) => {
              setGeneralFiles(Array.from(event.currentTarget.files ?? []))
            }}
          />
          <Show when={generalFiles().length > 0}>
            <div data-card>
              <strong>Attachments</strong>
              <ul>
                {generalFiles().map((file) => (
                  <li>{file.name}</li>
                ))}
              </ul>
            </div>
          </Show>
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
                await submitFeedback(event.currentTarget, "beta", betaFiles())
              }}
            >
              <input type="hidden" name="channel" value="beta" />
              <input type="hidden" name="betaSentiment" value={betaSentiment() ?? ""} />
              <input name="appVersion" placeholder="Beta version" />
              <input name="platform" placeholder="Platform" />
              <input
                type="file"
                multiple
                onChange={(event) => {
                  setBetaFiles(Array.from(event.currentTarget.files ?? []))
                }}
              />
              <Show when={betaFiles().length > 0}>
                <div data-card>
                  <strong>Screenshots / attachments</strong>
                  <ul>
                    {betaFiles().map((file) => (
                      <li>{file.name}</li>
                    ))}
                  </ul>
                </div>
              </Show>
              <div data-card>
                <button type="button" onClick={() => setBetaSentiment("positive")}>
                  Version erfolgreich getestet
                </button>
                <button type="button" onClick={() => setBetaSentiment("negative")}>
                  Fehler gefunden
                </button>
              </div>
              <textarea name="message" placeholder="Write your details here..." />
              <button type="submit" disabled={!betaSentiment()}>
                Send beta feedback
              </button>
            </form>
          </section>
        </Show>
      </section>
    </main>
  )
}
