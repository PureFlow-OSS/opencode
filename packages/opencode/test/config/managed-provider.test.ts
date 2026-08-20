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

test("uses the updater URL from opencode.json before the embedded default", () => {
  expect(ConfigManaged.providerConfigUrl({ updater: "http://localhost/opencode/" })).toBe(
    "http://localhost/opencode/provider-config.json",
  )
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

test("providerConfigRequestInit sends only aifactory api key", () => {
  expect(
    ConfigManaged.providerConfigRequestInit({
      config: {
        provider: {
          aifactory: {
            options: {
              apiKey: "rrz-key",
            },
          },
          litellm: {
            options: {
              apiKey: "ignored",
            },
          },
        },
      },
    }),
  ).toEqual({
    headers: {
      [ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER]: "rrz-key",
    },
  })
})

test("providerConfigRequestInit prefers auth store aifactory key", () => {
  expect(
    ConfigManaged.providerConfigRequestInit({
      config: {
        provider: {
          aifactory: {
            options: {
              apiKey: "config-key",
            },
          },
        },
      },
      auth: {
        aifactory: {
          type: "api",
          key: "auth-key",
        },
      },
    }),
  ).toEqual({
    headers: {
      [ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER]: "auth-key",
    },
  })
})
