import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { Effect, Layer, Schema } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"
import { requestNotFound, RequestNotFoundHttpApiError } from "./handlers/request-errors"

const root = "/question"

export const QuestionApi = HttpApi.make("question")
  .add(
    HttpApiGroup.make("question")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: Schema.Array(Question.Request),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "question.list",
            summary: "List pending questions",
            description: "Get all pending question requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: QuestionID },
          payload: Question.Reply,
          success: Schema.Boolean,
          error: RequestNotFoundHttpApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "question.reply",
            summary: "Reply to question request",
            description: "Provide answers to a question request from the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("reject", `${root}/:requestID/reject`, {
          params: { requestID: QuestionID },
          success: Schema.Boolean,
          error: RequestNotFoundHttpApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "question.reject",
            summary: "Reject question request",
            description: "Reject a question request from the AI assistant.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "question",
          description: "Question routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode HttpApi",
      version: "0.0.1",
      description: "Effect HttpApi surface for instance routes.",
    }),
  )

export const questionHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const svc = yield* Question.Service

    const list = Effect.fn("QuestionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
      params: { requestID: QuestionID }
      payload: Question.Reply
    }) {
      if (!(yield* svc.list()).find((item) => item.id === ctx.params.requestID)) {
        return HttpServerResponse.jsonUnsafe(requestNotFound("question", String(ctx.params.requestID)), {
          status: 404,
        })
      }
      yield* svc.reply({
        requestID: ctx.params.requestID,
        answers: ctx.payload.answers,
      })
      return true
    })

    const reject = Effect.fn("QuestionHttpApi.reject")(function* (ctx: { params: { requestID: QuestionID } }) {
      if (!(yield* svc.list()).find((item) => item.id === ctx.params.requestID)) {
        return HttpServerResponse.jsonUnsafe(requestNotFound("question", String(ctx.params.requestID)), {
          status: 404,
        })
      }
      yield* svc.reject(ctx.params.requestID)
      return true
    })

    return HttpApiBuilder.group(QuestionApi, "question", (handlers) =>
      handlers.handle("list", list).handle("reply", reply).handle("reject", reject),
    )
  }),
).pipe(Layer.provide(Question.defaultLayer))
