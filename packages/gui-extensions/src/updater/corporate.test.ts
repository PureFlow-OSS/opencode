import { describe, expect, test } from "bun:test"
import {
  API_KEY_HEADER,
  compareVersions,
  corporateBaseUrl,
  corporateUrls,
  fetchCorporateUpdate,
  isUpdateNewer,
  type Fetch,
} from "./corporate"

function response(body: string, init?: ResponseInit) {
  return Promise.resolve(new Response(body, init))
}

function endpointFetch(versions: Record<string, string>): Fetch {
  return (url) => response(versions[new URL(String(url)).pathname])
}

describe("corporate updater", () => {
  test("derives the trusted update server and route URLs", () => {
    const urls = corporateUrls({ updater: "https://updates.example/opencode/" })

    expect(urls).toEqual({
      baseUrl: "https://updates.example/opencode",
      version: "https://updates.example/opencode/version",
      feed: "https://updates.example/opencode/url",
      config: "https://updates.example/opencode/config",
    })
  })

  test("prefers trusted configured settings over environment and default", () => {
    const previous = process.env.OPENCODE_UPDATE_BASE_URL
    process.env.OPENCODE_UPDATE_BASE_URL = "https://environment.example/opencode"

    try {
      expect(corporateBaseUrl({ updater: " https://managed.example/opencode " })).toBe(
        "https://managed.example/opencode",
      )
      expect(corporateBaseUrl({})).toBe("https://environment.example/opencode")
      delete process.env.OPENCODE_UPDATE_BASE_URL
      expect(corporateBaseUrl({})).toBe("http://10.53.7.23/opencode")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_UPDATE_BASE_URL
      else process.env.OPENCODE_UPDATE_BASE_URL = previous
    }
  })

  test("compares semantic versions", () => {
    expect(compareVersions("2.0.0", "2.0.1")).toBe(1)
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0)
    expect(compareVersions("v2.1.0", "2.0.9")).toBe(-1)
    expect(compareVersions("2.0", "2.0.0")).toBe(0)
  })

test("applies only a newer corporate version", () => {
  expect(isUpdateNewer("2.0.0", "2.0.1")).toBe(true)
  expect(isUpdateNewer("2.0.0", "2.0.0")).toBe(false)
  expect(isUpdateNewer("2.1.0", "2.0.9")).toBe(false)
})

  test("fetches the authenticated version and feed URL", async () => {
    const seen: { url: URL; headers: Headers }[] = []
    const result = await fetchCorporateUpdate(
      {},
      {
        apiKey: " secret ",
        fetchFn: (url, init) => {
          const request = new Request(url, init)
          const target = new URL(request.url)
          seen.push({ url: target, headers: request.headers })
          return response(target.pathname.endsWith("/version") ? "2.1.3" : "http://10.53.7.23/opencode/feed")
        },
      },
    )

    expect(result).toEqual({
      baseUrl: "http://10.53.7.23/opencode",
      version: "2.1.3",
      url: "http://10.53.7.23/opencode/feed",
      configUrl: "http://10.53.7.23/opencode/config",
    })
    expect(seen.map((item) => item.url.pathname)).toEqual(["/opencode/version", "/opencode/url"])
    expect(seen.map((item) => item.headers.get(API_KEY_HEADER))).toEqual(["secret", "secret"])
  })

  test("reports the URL and HTTP status for failed responses", async () => {
    await expect(
      fetchCorporateUpdate({}, { fetchFn: () => response("offline", { status: 503, statusText: "Unavailable" }) }),
    ).rejects.toThrow(
      "Update server request failed for http://10.53.7.23/opencode/version: HTTP 503 Unavailable",
    )
  })

  test("reports an empty corporate response", async () => {
    await expect(fetchCorporateUpdate({}, { fetchFn: () => response(" ") })).rejects.toThrow(
      "Update server returned an empty response for http://10.53.7.23/opencode/version",
    )
  })

  test("rejects a feed URL outside the update server origin", async () => {
    await expect(
      fetchCorporateUpdate({ updater: "https://updates.example/opencode/" }, {
        fetchFn: endpointFetch({
          "/opencode/version": "2.1.3",
          "/opencode/url": "https://evil.example/feed",
        }),
      }),
    ).rejects.toThrow("Update server feed URL is not allowed")
  })

  test("rejects a feed URL in a different path under the update server origin", async () => {
    await expect(
      fetchCorporateUpdate({ updater: "https://updates.example/opencode/" }, {
        fetchFn: endpointFetch({
          "/opencode/version": "2.1.3",
          "/opencode/url": "https://updates.example/other/feed",
        }),
      }),
    ).rejects.toThrow("Update server feed URL is not allowed")
  })
})
