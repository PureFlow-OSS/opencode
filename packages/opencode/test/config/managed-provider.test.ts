import { test, expect } from "bun:test"
import { ConfigManaged } from "../../src/config"

test("providerConfigPayload accepts bare provider config", () => {
  const payload = {
    aifactory: {
      model_limits: [{ pattern: "*", context: 60_000 }],
    },
  }

  expect(ConfigManaged.providerConfigPayload(payload)).toBe(payload)
})

test("providerConfigPayload accepts nested updater provider config", () => {
  expect(
    ConfigManaged.providerConfigPayload({
      Updater: {
        Version: "1.14.29",
        PublicBaseURl: "http://10.53.7.23",
        ProviderConfig: {
          aifactory: {
            model_limits: [{ pattern: "qwen*", context: 200_000 }],
          },
        },
      },
    }),
  ).toEqual({
    aifactory: {
      model_limits: [{ pattern: "qwen*", context: 200_000 }],
    },
  })
})

test("providerConfigPayload accepts lower camel updater payload", () => {
  expect(
    ConfigManaged.providerConfigPayload({
      updater: {
        providerConfig: {
          mcp: {
            docs: {
              type: "remote",
              url: "http://10.53.7.23/mcp/docs",
            },
          },
        },
      },
    }),
  ).toEqual({
    mcp: {
      docs: {
        type: "remote",
        url: "http://10.53.7.23/mcp/docs",
      },
    },
  })
})
