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

Default upstream artifacts come from:

`https://github.com/anomalyco/opencode/releases/download/v{version}`

`/opencode/url` returns:

`http://10.53.7.23/opencode/feed`

That feed serves Electron updater metadata and assets through proxy.
