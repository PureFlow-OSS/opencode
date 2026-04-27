# OpenCode Updater Server

Hardcoded route base: `opencode`

Endpoints:

- `GET /opencode/version`
- `GET /opencode/url`
- `GET /opencode/latest.json`
- `GET /opencode/feed/{asset}`

## Use

1. Edit `appsettings.json`
2. Set `Updater.Version`
3. Restart container

Optional env overrides:

- `Updater__Version`
- `Updater__PublicBaseUrl`
- `Updater__ReleaseBaseUrlTemplate`

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
