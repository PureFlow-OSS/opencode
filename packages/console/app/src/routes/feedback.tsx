import { Title } from "@solidjs/meta"
import { Show, createResource } from "solid-js"

const UPDATE_SERVER_BASE_URL = import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"

type BetaStatus = {
  betaTester: boolean
  userName: string | null
}

export default function Feedback() {
  const [betaStatus] = createResource(async () => {
    const response = await fetch(`${UPDATE_SERVER_BASE_URL}/admin/beta/status`, {
    })

    if (!response.ok) return null
    return (await response.json()) as BetaStatus
  })

  const submitFeedback = async (form: HTMLFormElement) => {
    const data = new FormData(form)
    const payload = {
      text: String(data.get("message") ?? "").trim(),
      category: String(data.get("channel") ?? "general") === "beta" ? "beta" : "general",
      app_version: String(data.get("appVersion") ?? "").trim() || undefined,
      platform: String(data.get("platform") ?? "").trim() || undefined,
      attachments: [],
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
            await submitFeedback(event.currentTarget)
          }}
        >
          <input name="appVersion" placeholder="App version" />
          <input name="platform" placeholder="Platform" />
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
                await submitFeedback(event.currentTarget)
              }}
            >
              <input type="hidden" name="channel" value="beta" />
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
