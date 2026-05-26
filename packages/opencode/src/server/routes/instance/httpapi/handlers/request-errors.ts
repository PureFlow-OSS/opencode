import { Schema } from "effect"

export class InvalidRequestHttpApiError extends Schema.TaggedErrorClass<InvalidRequestHttpApiError>()(
  "InvalidRequestError",
  {
    message: Schema.String,
    kind: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400 },
) {}

export class RequestNotFoundHttpApiError extends Schema.TaggedErrorClass<RequestNotFoundHttpApiError>()(
  "RequestNotFoundError",
  {
    requestID: Schema.String,
    requestType: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export function invalidRequest(message: string, kind?: string) {
  return new InvalidRequestHttpApiError({
    message,
    ...(kind ? { kind } : {}),
  })
}

export function requestNotFound(requestType: string, requestID: string) {
  return new RequestNotFoundHttpApiError({
    requestID,
    requestType,
    message: `${requestType} request not found: ${requestID}`,
  })
}
