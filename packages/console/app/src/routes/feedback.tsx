import { Title } from "@solidjs/meta"
import { action } from "@solidjs/router"
import { Show, createResource, createSignal } from "solid-js"

const UPDATE_SERVER_BASE_URL = import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"

type BetaStatus = {
  betaTester: boolean
  userName: string | null
}

const submitFeedback = action(async (form: FormData) => {
  "use server"
  const payload = {
    text: String(form.get("message") ?? "").trim(),
    category: String(form.get("channel") ?? "general") === "beta" ? "beta" : "general",
    key: String(form.get("apiKey") ?? "").trim() || undefined,
    app_version: String(form.get("appVersion") ?? "").trim() || undefined,
    platform: String(form.get("platform") ?? "").trim() || undefined,
    attachments: [],
  }

  if (!payload.text) throw new Error("Message is required")

  const response = await fetch(`${UPDATE_SERVER_BASE_URL}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new Error(await response.text())
})

export default function Feedback() {
  const [apiKey, setApiKey] = createSignal("")
  const [betaStatus] = createResource(apiKey, async (key) => {
    if (!key.trim()) return null

    const response = await fetch(`${UPDATE_SERVER_BASE_URL}/admin/beta/status`, {
      headers: {
        "x-opencode-aifactory-api-key": key.trim(),
      },
    })

    if (!response.ok) return null
    return (await response.json()) as BetaStatus
  })

  return (
    <main data-page="feedback">
      <Title>OpenCode Feedback</Title>
      <section data-card>
        <h1>Feedback senden</h1>
        <p>Send general feedback directly to the updater server.</p>
        <form action={submitFeedback}>
          <input
            name="apiKey"
            placeholder="API key"
            autocomplete="off"
            spellcheck={false}
            value={apiKey()}
            onInput={(event) => setApiKey(event.currentTarget.value)}
          />
          <input name="appVersion" placeholder="App version" />
          <input name="platform" placeholder="Platform" />
          <textarea name="message" placeholder="What would you like to tell the team?" />
          <button type="submit">Send feedback</button>
        </form>
        <Show when={betaStatus()?.betaTester}>
          <section data-card>
            <h2>Beta feedback</h2>
            <p>Visible only for beta testers. Failure to validate your key hides this section.</p>
            <form action={submitFeedback}>
              <input type="hidden" name="channel" value="beta" />
              <input type="hidden" name="apiKey" value={apiKey()} />
              <input name="appVersion" placeholder="Beta version" />
              <input name="platform" placeholder="Platform" />
              <textarea name="message" placeholder="Version erfolgreich getestet / Fehler gefunden ..." />
              <button type="submit">Send beta feedback</button>
            </form>
          </section>
        </Show>
      </section>
    </main>
  )
}
