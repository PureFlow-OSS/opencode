import { Schema } from "effect"

export class InvalidRequestHttpApiError extends Schema.TaggedErrorClass<InvalidRequestHttpApiError>()(
  "InvalidRequestError",
  {
    message: Schema.String,
    kind: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400 },
) {}

export function invalidRequest(message: string, kind?: string) {
  return new InvalidRequestHttpApiError({
    message,
    ...(kind ? { kind } : {}),
  })
}
