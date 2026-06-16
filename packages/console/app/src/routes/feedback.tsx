import { Title } from "@solidjs/meta"
import { action } from "@solidjs/router"

const UPDATE_SERVER_BASE_URL = import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"

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
  return (
    <main data-page="feedback">
      <Title>OpenCode Feedback</Title>
      <section data-card>
        <h1>Feedback senden</h1>
        <p>Send general or beta feedback directly to the updater server.</p>
        <form action={submitFeedback}>
          <select name="channel">
            <option value="general">general</option>
            <option value="beta">beta</option>
          </select>
          <input name="apiKey" placeholder="API key" />
          <input name="appVersion" placeholder="App version" />
          <input name="platform" placeholder="Platform" />
          <textarea name="message" placeholder="What would you like to tell the team?" />
          <button type="submit">Send feedback</button>
        </form>
      </section>
    </main>
  )
}
