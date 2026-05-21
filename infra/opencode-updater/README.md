# OpenCode Updater Server

Hardcoded route base: `opencode`

Endpoints:

- `GET /opencode/version`
- `GET /opencode/url`
- `GET /opencode/config`
- `GET /opencode/latest.json`
- `GET /opencode/changelog.md`
- `GET /opencode/provider-config.json`
- `GET /opencode/feed/{asset}`

If client sends `X-OpenCode-AiFactory-Api-Key`, updater can evaluate beta rollout rules from `appsettings.beta.json`.

## Use

1. Edit `appsettings.json`
2. Optionally edit `appsettings.beta.json` for key-based beta rollout
3. Put a `feed/latest.yml` with `version:` if you want stable version to come from local feed
4. Optionally put beta artifacts under `feed/beta/` with its own `latest.yml`
5. `Updater.Version` / `appsettings.beta.json -> Updater.Version` are fallback when no matching local `latest.yml` exists
6. Restart container

## Provider config

The updater can also serve provider-side rollout config for the desktop app.

Set `ProviderConfig.model` to provision the default model. Local or project config can still override it with `model`.
Set `ProviderConfig.small_model` to provision the default small model.
Set `ProviderConfig.aifactory.model_visibility` to override default visibility for AI Factory models in the client.

Requests may include `X-OpenCode-AiFactory-Api-Key`. When `UpdaterBeta.Enabled` is `true`, server calls LiteLLM `key/info`, collects common group fields like `groups`, `group`, `team_id`, `team_alias`, `team`, and `tags`, plus user-like fields such as `username`, `display_name`, `key_alias`, and `key_name`, and serves `appsettings.beta.json` when any configured `UpdaterBeta.Groups` or `UpdaterBeta.Users` value matches.

`/opencode/url` and `/opencode/config` return a feed URL with a short-lived hashed `beta` token for matched beta users so downstream feed requests stay on beta config without exposing raw API keys.

Local feed layout:

- stable: `feed/latest.json`, `feed/latest.yml`, `feed/<asset>`
- stable changelog: `feed/changelog.md`
- beta: `feed/beta/latest.json`, `feed/beta/latest.yml`, `feed/beta/<asset>`
- beta changelog: `feed/beta/changelog.md`

When beta user is matched, updater first looks in `feed/beta/`. Stable users keep using `feed/`. Missing files return `404`.

`GET /opencode/changelog.md` returns markdown changelog from matching feed directory using same stable/beta resolution as update files.

## Beta rollout

The updater only switches a request to beta when all of these are true:

1. `UpdaterBeta.Enabled` is `true`
2. `UpdaterBeta.Groups` or `UpdaterBeta.Users` contains at least one match rule
3. `UpdaterBeta.LiteLLM.BaseUrl` is configured
4. Request contains the configured header, usually `X-OpenCode-AiFactory-Api-Key`
5. `GET {LiteLLM.BaseUrl}{KeyInfoPath}` returns `2xx`
6. At least one configured group or user matches a value found in LiteLLM `key/info`

Important behavior:

- `appsettings.json` stays the stable config
- `appsettings.beta.json` is only used for requests that match beta rollout
- for beta requests, `Updater` values from `appsettings.beta.json` override stable values
- if `Updater.PublicBaseUrl` is missing in `appsettings.beta.json`, beta falls back to the stable `Updater.PublicBaseUrl`
- if `feed/beta/latest.yml` exists, beta users get that version first
- if `feed/beta/latest.yml` does not exist, beta users fall back to `appsettings.beta.json -> Updater.Version`
- if `UpdaterBeta.LiteLLM.ApiKey` is set, updater calls LiteLLM with that admin key and passes the user key as `?key=<user-key>`
- if `UpdaterBeta.LiteLLM.ApiKey` is empty, updater uses the user key itself as `Authorization: Bearer <user-key>`
- URLs in JSON must be quoted strings

### Matching logic

The updater walks the LiteLLM `key/info` JSON recursively and collects string values from these field names:

- `group`
- `groups`
- `team_id`
- `team_alias`
- `team`
- `tags`

It also collects user-like string values from:

- `user`
- `users`
- `username`
- `user_name`
- `display_name`
- `key_alias`
- `key_name`

Matching is case-insensitive.

- `UpdaterBeta.Groups` should contain the exact group or tag names that LiteLLM returns for the API key
- `UpdaterBeta.Users` should contain the exact user names you want to allow
- for `key_alias`, updater also accepts the part before `" - "`, so `Klaus Scheiböck` matches `Klaus Scheiböck - DEV`

### Minimal working setup

Stable config in `appsettings.json`:

```json
{
  "Updater": {
    "Version": "1.14.31",
    "PublicBaseUrl": "http://opencode.pfcicd.local.programmierfabrik.at",
    "Motd": {
      "text": "RRZ AI Factory",
      "enabled": true
    }
  }
}
```

Beta config in `appsettings.beta.json`:

```json
{
  "Updater": {
    "Version": "1.14.38",
    "PublicBaseUrl": "http://opencode.pfcicd.local.programmierfabrik.at",
    "Motd": {
      "text": "RRZ AI Factory",
      "enabled": true
    }
  },
  "UpdaterBeta": {
    "Enabled": true,
    "HeaderName": "X-OpenCode-AiFactory-Api-Key",
    "Groups": [],
    "Users": ["Klaus Scheiböck"],
    "LiteLLM": {
      "BaseUrl": "http://10.53.7.23",
      "KeyInfoPath": "/key/info",
      "ApiKey": "sk-management-key"
    }
  }
}
```

With that setup:

- users without the header stay on stable
- users with a non-matching key stay on stable
- users with a matching key switch to beta and receive version `1.14.38` unless `feed/beta/latest.yml` overrides it

This setup is useful when normal user keys are not allowed to call LiteLLM management routes directly. In that case the updater uses `LiteLLM.ApiKey` for `/key/info` and checks the end-user key passed in the updater header via `?key=<user-key>`.

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
    "Users": ["Klaus Scheiböck"],
    "LiteLLM": {
      "BaseUrl": "https://litellm.example.com",
      "KeyInfoPath": "/key/info",
      "ApiKey": "sk-management-key"
    }
  }
}
```

Only AI Factory key is forwarded by client-side rollout fetches. Other provider keys are ignored.

### Troubleshooting

If beta does not activate, check these first:

1. `PublicBaseUrl` and `LiteLLM.BaseUrl` are valid JSON strings with quotes
2. client really sends the header named in `UpdaterBeta.HeaderName`
3. LiteLLM `key/info` is reachable from the updater container
4. LiteLLM `key/info` returns one of your expected values in `group`, `groups`, `team_id`, `team_alias`, `team`, `tags`, `username`, `display_name`, `key_alias`, or `key_name`
5. `UpdaterBeta.Groups` or `UpdaterBeta.Users` contains that value exactly, apart from letter case
6. `appsettings.beta.json` is mounted into the container and the service was restarted after the change

Helpful checks:

```powershell
curl http://localhost:8080/opencode/version
curl -H "X-OpenCode-AiFactory-Api-Key: <key>" http://localhost:8080/opencode/version
curl -H "Authorization: Bearer <key>" http://opencode.pfcicd.local.programmierfabrik.at/key/info
curl -H "Authorization: Bearer <admin-key>" "http://10.53.7.23/key/info?key=<user-key>"
```

Expected result:

- first call returns stable version
- second call returns beta version only when the key matches `UpdaterBeta.Groups` or `UpdaterBeta.Users`

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
