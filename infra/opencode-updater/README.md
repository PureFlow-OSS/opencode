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
2. Put a `feed/latest.yml` with `version:` if you want server version to come from the feed
3. `Updater.Version` is fallback if no local `feed/latest.yml` version exists
3. Restart container

## Provider config

The updater can also serve provider-side rollout config for the desktop app.

## Full sample config

This is a complete example with:

- RRZ AI Factory model rollout rules
- managed MCP servers
- PAT auth metadata for a managed DevOps MCP

```json
{
  "Updater": {
    "Version": "1.14.28",
    "PublicBaseUrl": "http://10.53.7.23",
    "ReleaseBaseUrlTemplate": "https://github.com/anomalyco/opencode/releases/download/v{{version}}",
    "ProviderConfig": {
      "aifactory": {
        "model_limits": [
          {
            "pattern": "qwen*",
            "context": 200000,
            "output": 32000,
            "temperature": true,
            "reasoning": false,
            "modalities": {
              "input": ["text", "image", "pdf"],
              "output": ["text"]
            }
          },
          {
            "pattern": "*",
            "context": 60000,
            "output": 32000,
            "temperature": true
          }
        ]
      },
      "mcp": {
        "rrz-docs": {
          "type": "remote",
          "url": "http://10.53.7.23/mcp/docs",
          "enabled": true
        },
        "rrz-devops": {
          "type": "remote",
          "url": "http://10.53.7.23/mcp/devops",
          "enabled": true,
          "auth": {
            "type": "pat",
            "label": "DevOps PAT",
            "description": "Enter your personal access token for the RRZ DevOps MCP.",
            "placeholder": "Personal access token",
            "header": "Authorization",
            "prefix": "Bearer "
          }
        }
      }
    }
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
```

## Model rollout example

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
- `modalities.input`
- `modalities.output`

You can also push managed MCP servers:

```json
{
  "Updater": {
    "ProviderConfig": {
      "mcp": {
        "rrz-docs": {
          "type": "remote",
          "url": "http://10.53.7.23/mcp/docs",
          "enabled": true
        },
        "rrz-devops": {
          "type": "remote",
          "url": "http://10.53.7.23/mcp/devops",
          "enabled": true,
          "auth": {
            "type": "pat",
            "label": "DevOps PAT",
            "description": "Enter your personal access token for the RRZ DevOps MCP.",
            "placeholder": "Personal access token",
            "header": "Authorization",
            "prefix": "Bearer "
          }
        }
      }
    }
  }
}
```

These MCP entries are runtime-managed by the updater feed. Local user config can still define its own MCP servers and will override pushed ones with the same name.

Supported managed MCP auth metadata:

- `auth.type = "pat"`
- `auth.label`
- `auth.description`
- `auth.placeholder`
- `auth.header`
- `auth.prefix`

## Env var example

If you want to override a small part without replacing the full JSON file:

```powershell
$env:Updater__Version = "1.14.29"
$env:Updater__ProviderConfig__aifactory__model_limits__0__pattern = "qwen*"
$env:Updater__ProviderConfig__aifactory__model_limits__0__context = "200000"
$env:Updater__ProviderConfig__aifactory__model_limits__1__pattern = "*"
$env:Updater__ProviderConfig__aifactory__model_limits__1__context = "60000"
$env:Updater__ProviderConfig__mcp__rrz-devops__type = "remote"
$env:Updater__ProviderConfig__mcp__rrz-devops__url = "http://10.53.7.23/mcp/devops"
$env:Updater__ProviderConfig__mcp__rrz-devops__auth__type = "pat"
$env:Updater__ProviderConfig__mcp__rrz-devops__auth__label = "DevOps PAT"
$env:Updater__ProviderConfig__mcp__rrz-devops__auth__header = "Authorization"
$env:Updater__ProviderConfig__mcp__rrz-devops__auth__prefix = "Bearer "
```

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

If `feed/latest.yml` exists and contains a `version:` line, `/opencode/version` and upstream proxy version resolution use that value first. `Updater.Version` is only fallback when no local feed version can be read.

Default upstream artifacts come from:

`https://github.com/anomalyco/opencode/releases/download/v{version}`

`/opencode/url` returns:

`http://10.53.7.23/opencode/feed`

That feed serves Electron updater metadata and assets through proxy.
