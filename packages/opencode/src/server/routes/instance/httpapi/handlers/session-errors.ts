import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage"
import { Schema } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"

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

export function mapNotFoundError(error: unknown) {
  if (!NotFoundError.isInstance(error)) return error
  return new HttpApiError.NotFound({})
}

export function mapSessionRouteError(error: unknown, sessionID: SessionID) {
  return mapNotFoundError(mapBusyError(error, sessionID))
}
