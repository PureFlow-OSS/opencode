import { expect, test } from "bun:test"
import { BackgroundServiceEnvironment } from "./background-service-environment"

test("passes the desktop updater URL to newly spawned CLI services", () => {
  expect(
    BackgroundServiceEnvironment.make({
      runtime: " https://runtime.example/opencode/ ",
      embedded: "https://embedded.example/opencode",
    }),
  ).toEqual({ OPENCODE_UPDATE_BASE_URL: "https://runtime.example/opencode/" })

  expect(
    BackgroundServiceEnvironment.make({ embedded: " https://embedded.example/opencode " }),
  ).toEqual({ OPENCODE_UPDATE_BASE_URL: "https://embedded.example/opencode" })
})

test("omits the updater variable when neither runtime nor build supplies a URL", () => {
  expect(BackgroundServiceEnvironment.make({ runtime: " ", embedded: " " })).toBeUndefined()
  expect(BackgroundServiceEnvironment.make({})).toBeUndefined()
})

test("prefers the runtime environment over the embedded updater URL", () => {
  const previous = process.env.OPENCODE_UPDATE_BASE_URL

  try {
    process.env.OPENCODE_UPDATE_BASE_URL = "https://runtime.example/opencode"
    expect(BackgroundServiceEnvironment.fromProcess()).toEqual({
      OPENCODE_UPDATE_BASE_URL: "https://runtime.example/opencode",
    })
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_UPDATE_BASE_URL
    else process.env.OPENCODE_UPDATE_BASE_URL = previous
  }
})
