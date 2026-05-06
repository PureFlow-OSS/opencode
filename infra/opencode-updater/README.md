# OpenCode Updater Server

Hardcoded route base: `opencode`

Endpoints:

- `GET /opencode/version`
- `GET /opencode/url`
- `GET /opencode/config`
- `GET /opencode/latest.json`
- `GET /opencode/provider-config.json`
- `GET /opencode/feed/{asset}`

If client sends `X-OpenCode-AiFactory-Api-Key`, updater can evaluate beta rollout rules from `appsettings.beta.json`.

## Use

1. Edit `appsettings.json`
2. Optionally edit `appsettings.beta.json` for key-based beta rollout
2. Put a `feed/latest.yml` with `version:` if you want stable version to come from local feed
3. Optionally put beta artifacts under `feed/beta/` with its own `latest.yml`
4. `Updater.Version` / `appsettings.beta.json -> Updater.Version` are fallback when no matching local `latest.yml` exists
5. Restart container

## Provider config

The updater can also serve provider-side rollout config for the desktop app.

Set `ProviderConfig.model` to provision the default model. Local or project config can still override it with `model`.
Set `ProviderConfig.small_model` to provision the default small model.
Set `ProviderConfig.aifactory.model_visibility` to override default visibility for AI Factory models in the client.

Requests may include `X-OpenCode-AiFactory-Api-Key`. When `UpdaterBeta.Enabled` is `true`, server calls LiteLLM `key/info` with that key, collects common group fields like `groups`, `group`, `team_id`, `team_alias`, and serves `appsettings.beta.json` when any configured `UpdaterBeta.Groups` value matches.

`/opencode/url` and `/opencode/config` return a feed URL with a short-lived hashed `beta` token for matched beta users so downstream feed requests stay on beta config without exposing raw API keys.

Local feed layout:

- stable: `feed/latest.json`, `feed/latest.yml`, `feed/<asset>`
- beta: `feed/beta/latest.json`, `feed/beta/latest.yml`, `feed/beta/<asset>`

When beta user is matched, updater first looks in `feed/beta/`. Stable users keep using `feed/`. Missing files return `404`.

## Beta rollout

Example `appsettings.beta.json`:

```json
{
  "Updater": {
    "Version": "1.14.99",
    "ProviderConfig": {
      "model": "aifactory/Qwen3.6-35B-A3B-FP8",
      "aifactory": {
        "model_visibility": [
          {
            "pattern": "all-team-models",
            "visible": true
          }
        ]
      }
    }
  },
  "UpdaterBeta": {
    "Enabled": true,
    "HeaderName": "X-OpenCode-AiFactory-Api-Key",
    "Groups": ["desktop-beta", "early-access"],
    "LiteLLM": {
      "BaseUrl": "https://litellm.example.com",
      "KeyInfoPath": "/key/info"
    }
  }
}
```

Only AI Factory key is forwarded by client-side rollout fetches. Other provider keys are ignored.

## Full sample config

This is a complete example with:

- RRZ AI Factory model rollout rules
- managed MCP servers
- PAT auth metadata for a managed DevOps MCP

```json
{
  "Updater": {
    "Version": "1.14.33",
    "PublicBaseUrl": "http://10.53.7.23",
    "Motd": {
      "text": "RRZ AI Factory",
      "enabled": true
    },
    "ProviderConfig": {
      "model": "aifactory/Qwen3.6-35B-A3B-FP8",
      "aifactory": {
        "model_visibility": [
          {
            "pattern": "all-team-models",
            "visible": true
          }
        ],
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

## Desktop config

`/opencode/config` returns the update version, feed URL, and the desktop boot MOTD:

```json
{
  "version": "1.14.33",
  "url": "http://10.53.7.23/opencode/feed",
  "motd": {
    "text": "RRZ AI Factory",
    "enabled": true
  }
}
```

If `Updater.Motd` is not configured, the server defaults to `RRZ AI Factory`. Set `Updater.Motd.enabled` to `false` to hide it.

## Model rollout example

Example `appsettings.json`:

```json
{
  "Updater": {
    "ProviderConfig": {
      "aifactory": {
        "model_visibility": [
          {
            "pattern": "all-proxy-models",
            "visible": true
          }
        ],
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

Client default hides AI Factory models matching `*embedding*`, `all-proxy-models`, and `all-team-models`. `model_visibility` can override that per pattern. Last matching visibility rule wins.

Supported per-rule overrides:

- `context`
- `output`
- `temperature`
- `reasoning`
- `modalities.input`
- `modalities.output`

## Model visibility example

Example `appsettings.json`:

```json
{
  "Updater": {
    "ProviderConfig": {
      "aifactory": {
        "model_visibility": [
          {
            "pattern": "*embedding*",
            "visible": false
          },
          {
            "pattern": "all-proxy-models",
            "visible": false
          },
          {
            "pattern": "all-team-models",
            "visible": false
          },
          {
            "pattern": "all-team-models",
            "visible": true
          }
        ]
      }
    }
  }
}
```

Useful for hiding embedding or aggregate models by default, while selectively re-enabling individual patterns from server config.

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

For local development or alternate deployments, the desktop and server code derive the provider config feed from `OPENCODE_UPDATE_BASE_URL`. When packaging the Electron desktop app, set this env before the `../opencode` server build runs so the bundled sidecar picks it up.

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
$env:Updater__Motd__text = "RRZ AI Factory"
$env:Updater__Motd__enabled = "true"
$env:Updater__ProviderConfig__aifactory__model_visibility__0__pattern = "all-team-models"
$env:Updater__ProviderConfig__aifactory__model_visibility__0__visible = "true"
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
- `Updater__Motd__text`
- `Updater__Motd__enabled`
- `Updater__PublicBaseUrl`
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

If file exists in matching feed directory, server serves local file directly.

If `feed/latest.yml` exists and contains a `version:` line, stable `/opencode/version` uses that value first.

If `feed/beta/latest.yml` exists and contains a `version:` line, matched beta users use that value first.

`Updater.Version` is fallback for stable when no local stable `latest.yml` can be read. `appsettings.beta.json -> Updater.Version` is fallback for beta when no local beta `latest.yml` can be read.

`/opencode/url` returns:

`http://10.53.7.23/opencode/feed`

That feed serves Electron updater metadata and assets from local feed files only.
