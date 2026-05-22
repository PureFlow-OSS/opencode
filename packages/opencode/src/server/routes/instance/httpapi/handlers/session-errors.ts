import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"

export class SessionBusyHttpApiError extends Schema.TaggedErrorClass<SessionBusyHttpApiError>()(
  "SessionBusyError",
  {
    sessionID: SessionID,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export function mapBusyError(error: unknown, sessionID: SessionID) {
  if (!(error instanceof Session.BusyError)) return error
  return new SessionBusyHttpApiError({
    sessionID,
    message: `Session is busy: ${sessionID}`,
  })
}
