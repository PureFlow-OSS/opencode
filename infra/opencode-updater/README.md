# OpenCode Updater Server

Hardcoded route base: `opencode`

Endpoints:

- `GET /opencode/version`
- `GET /opencode/url`
- `GET /opencode/latest.json`
- `GET /opencode/provider-config.json`
- `GET /opencode/feed/{asset}`

## Use

1. Edit `appsettings.json`
2. Set `Updater.Version`
3. Restart container

## Provider config

The updater can also serve provider-side rollout config for the desktop app.

Example `appsettings.json`:

```json
{
  "Updater": {
    "ProviderConfig": {
      "aifactory": {
        "model_limits": [
          {
            "pattern": "qwen*",
            "context": 200000,
            "output": 32000,
            "temperature": true,
            "reasoning": false
          },
          {
            "pattern": "*",
            "context": 60000,
            "output": 32000,
            "temperature": true
          }
        ]
      }
    }
  }
}
```

Rules are ordered. First match wins. `*` acts as fallback.

Supported per-rule overrides:

- `context`
- `output`
- `temperature`
- `reasoning`

Container image CI publishes to:

`ghcr.io/<owner>/opencode-updater`

Optional env overrides:

- `Updater__Version`
- `Updater__PublicBaseUrl`
- `Updater__ReleaseBaseUrlTemplate`
- `Updater__ProviderConfig__aifactory__model_limits__0__pattern`
- `Updater__ProviderConfig__aifactory__model_limits__0__context`

## Local fake feed

Build Electron package first, then:

```powershell
bun ./scripts/sync-local-feed.ts 1.14.29
docker build -t opencode-updater-local .
docker run -d --name opencode-updater-test -p 8080:8080 `
  -e Updater__Version=1.14.29 `
  -e Updater__PublicBaseUrl=http://127.0.0.1:8080 `
  opencode-updater-local
```

If file exists in `feed/`, server serves local file instead of proxying GitHub.

Default upstream artifacts come from:

`https://github.com/anomalyco/opencode/releases/download/v{version}`

`/opencode/url` returns:

`http://10.53.7.23/opencode/feed`

That feed serves Electron updater metadata and assets through proxy.
