import { Title } from "@solidjs/meta"
import { action } from "@solidjs/router"
import { Database } from "@opencode-ai/console-core/drizzle/index.js"
import { UpdaterAuditTable, UpdaterFeedbackTable } from "@opencode-ai/console-core/schema/updater.sql.js"

const submitFeedback = action(async (form: FormData) => {
  "use server"
  const userName = String(form.get("userName") ?? "").trim()
  const userEmail = String(form.get("userEmail") ?? "").trim()
  const message = String(form.get("message") ?? "").trim()
  const rating = String(form.get("rating") ?? "neutral")

  if (!message) throw new Error("Message is required")

  await Database.use(async (db) => {
    const feedbackID = crypto.randomUUID()
    await db.insert(UpdaterFeedbackTable).values({
      id: feedbackID,
      channel: "general",
      userName: userName || undefined,
      userEmail: userEmail || undefined,
      rating: rating === "positive" || rating === "negative" ? rating : "neutral",
      message,
    })

    await db.insert(UpdaterAuditTable).values({
      feedbackID,
      actor: userEmail || userName || "anonymous",
      action: "created",
      details: JSON.stringify({ channel: "general", rating, message }),
    })
  })
})

export default function Feedback() {
  return (
    <main data-page="feedback">
      <Title>OpenCode Feedback</Title>
      <section data-card>
        <h1>Feedback senden</h1>
        <p>Normal user feedback for the team review queue.</p>
        <form action={submitFeedback}>
          <input name="userName" placeholder="Name" />
          <input name="userEmail" placeholder="Email" />
          <select name="rating">
            <option value="positive">positive</option>
            <option value="neutral">neutral</option>
            <option value="negative">negative</option>
          </select>
          <textarea name="message" placeholder="What would you like to tell the team?" />
          <button type="submit">Send feedback</button>
        </form>
      </section>
    </main>
  )
}
