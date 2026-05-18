# Enterprise Integration — LiteLLM + Keycloak SSO

This document describes how to configure opencode for corporate environments
where AI model access is managed centrally via LiteLLM and user authentication
is handled by Keycloak.

## Overview

opencode supports an enterprise SSO flow using Keycloak PKCE authentication
combined with a Key Exchange Server (KES). This approach requires no LiteLLM
Enterprise license — it works entirely with the open-source LiteLLM proxy.

```
opencode → Keycloak (PKCE login) → JWT access token
        → KES /exchange (Bearer JWT) → LiteLLM virtual key
        → LiteLLM /models (Bearer virtual-key) → allowed model list
        → every LLM call uses the virtual key as Bearer token
```

The KES acts as a secure bridge: it validates the Keycloak JWT via JWKS,
resolves the user's Keycloak group to a LiteLLM virtual key, and returns that
key to opencode. The LiteLLM master key is never exposed to clients.

## Requirements

- LiteLLM proxy (open-source, no enterprise license required)
- Keycloak (any version supporting PKCE / OpenID Connect)
- Key Exchange Server — provided in `packages/kes` (Bun runtime)
- PostgreSQL — required by LiteLLM for virtual key storage

## Infrastructure Setup

### PostgreSQL

LiteLLM requires a PostgreSQL database to persist virtual keys.

```yaml
# docker-compose.yml (example)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: litellm
      POSTGRES_DB: litellm
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U litellm"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
```

### LiteLLM

Create a `litellm_config.yaml` with a master key and your model list:

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  # OpenRouter example
  - model_name: my-model
    litellm_params:
      model: openrouter/provider/model-name
      api_key: os.environ/OPENROUTER_API_KEY

general_settings:
  master_key: "sk-your-master-key-here"
```

> **Important**: do not enable `jwt_auth` — that requires a paid LiteLLM
> Enterprise license. The KES approach works with the free open-source proxy.

Start LiteLLM:

```yaml
# docker-compose.yml (example)
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: "postgresql://litellm:litellm@postgres:5432/litellm"
    volumes:
      - ./litellm_config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    depends_on:
      postgres:
        condition: service_healthy
```

### Keycloak

Start Keycloak (development mode):

```yaml
# docker-compose.yml (example)
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.2
    command: start-dev
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
    ports:
      - "8080:8080"
    volumes:
      - keycloak_data:/opt/keycloak/data

volumes:
  keycloak_data:
```

### Key Exchange Server (KES)

The KES is a small Bun HTTP service in `packages/kes`. It validates Keycloak
JWTs and returns the corresponding LiteLLM virtual key.

```yaml
# docker-compose.yml (example)
services:
  kes:
    build:
      context: ./packages/kes
      dockerfile: Dockerfile
    ports:
      - "5000:5000"
    environment:
      KEYCLOAK_JWKS_URL: "http://keycloak:8080/realms/your-realm/protocol/openid-connect/certs"
      KES_PORT: "5000"
      GROUP_KEY_MAP: '{"developers":"sk-your-virtual-key","admins":"sk-another-key"}'
    depends_on:
      - keycloak
      - litellm
```

| Environment variable | Required | Description |
|---|---|---|
| `KEYCLOAK_JWKS_URL` | yes | Full URL to Keycloak's JWKS endpoint for your realm |
| `KES_PORT` | no | Port to listen on (default: `5000`) |
| `GROUP_KEY_MAP` | yes | JSON mapping Keycloak group names → LiteLLM virtual keys |

The KES **never returns the master key**. If a user's groups do not match any
entry in `GROUP_KEY_MAP`, the exchange returns HTTP 403.

## Configuration Steps

### 1. Keycloak — create the opencode client

1. Open your realm in the Keycloak admin console.
2. Create a new client:
   - **Client ID**: `opencode` (or any name — users can override it in the UI)
   - **Client type**: `Public` (no client secret)
   - **Standard flow**: enabled
   - **Direct access grants**: disabled
3. Under **Valid redirect URIs**, add:
   ```
   http://127.0.0.1:19876/enterprise/oauth/callback
   ```
4. Under the client's **Client scopes** tab, click the dedicated scope →
   **Add mapper** → **Group Membership**:
   - **Name**: `groups`
   - **Token Claim Name**: `groups`
   - **Add to access token**: on
   - **Full group path**: off (recommended)

5. Create a group for each team (e.g. `developers`, `admins`) and assign users to them.

### 2. LiteLLM — create virtual keys per group

Open the LiteLLM UI at `http://localhost:4000/ui` (log in with the master key).

**Create a team** for each Keycloak group:
- Go to **Teams** → **+ Create New Team**
- Set the **Team Name** to match the Keycloak group (e.g. `developers`)
- Optionally restrict which models the team can access

**Generate a virtual key** for the team:
- Go to **Virtual Keys** → **+ Create New Key**
- Set **Key Alias** (e.g. `group-developers`)
- Assign it to the team you created
- Copy the generated key — you will need it for `GROUP_KEY_MAP`

### 3. KES — configure group-to-key mapping

Set the `GROUP_KEY_MAP` environment variable on the KES container. The key is
the Keycloak group name (without leading `/`), the value is the LiteLLM virtual
key generated in the previous step:

```json
{"developers": "sk-abc123", "admins": "sk-def456"}
```

Restart the KES container after changing `GROUP_KEY_MAP`.

### 4. opencode — connect via the Settings UI

1. Open opencode and go to **Settings → Providers**.
2. At the top you will see the **Enterprise (LiteLLM + Keycloak SSO)** section.
3. Fill in:
   - **LiteLLM URL**: base URL of your proxy (e.g. `https://litellm.corp.com`)
   - **Keycloak Realm URL**: full realm URL (e.g. `https://keycloak.corp.com/realms/corp`)
   - **Client ID** (optional): defaults to `opencode`
   - **Key Exchange Server URL** (optional): URL of your KES (e.g. `http://kes.corp.com`). If omitted, opencode will try to use the Keycloak JWT directly as the Bearer token for LiteLLM.
4. Click **Connect via SSO** — a browser window opens with the Keycloak login page.
5. Log in with your corporate credentials.
6. The browser closes automatically and opencode shows the connected state along
   with the number of models available to your account.

## How It Works

### Authentication flow

1. opencode generates a PKCE `code_verifier` and `code_challenge`.
2. A local HTTP callback server starts on `http://127.0.0.1:19876`.
3. The browser opens to Keycloak's authorization endpoint with the PKCE challenge and a random `state` parameter (CSRF protection).
4. After the user logs in, Keycloak redirects to the callback URL with an authorization `code`.
5. opencode exchanges the code for an `access_token` (JWT) and a `refresh_token` by calling Keycloak's token endpoint.
6. opencode sends the JWT to the KES `/exchange` endpoint.
7. The KES verifies the JWT signature against Keycloak's JWKS endpoint, reads the `groups` claim, and returns the matching LiteLLM virtual key.
8. The virtual key and tokens are stored in `~/.local/share/opencode/auth.json` (mode 0600).

### Model discovery

After a successful login, opencode calls `GET /models` on LiteLLM with the
virtual key as the Bearer token. LiteLLM returns only the models the team is
allowed to use. The list is cached in
`~/.local/share/opencode/enterprise-models.json` and loaded on every startup.

### Token refresh

Before each LLM request, opencode checks the token's `exp` claim. If the
token is within 60 seconds of expiry, it requests a new one from Keycloak
using the stored `refresh_token`. After a successful refresh the KES exchange
is re-run to obtain a fresh virtual key. The refresh happens transparently —
the user is not prompted again.

If the `refresh_token` itself expires (typically after ~30 days of inactivity),
opencode prompts the user to reconnect via SSO.

### Security properties

- The LiteLLM master key never leaves the server — it is used only to generate virtual keys via the LiteLLM admin API.
- The KES validates JWT signatures via Keycloak's JWKS endpoint. A forged or expired token will be rejected.
- Virtual keys can be scoped to specific models and teams in LiteLLM, giving fine-grained access control per group.
- Revoking a Keycloak account prevents refresh — the user's virtual key access expires with the current `access_token` (up to its configured lifetime).

## Disconnecting

Click **Disconnect** in **Settings → Providers**, or run:

```bash
curl -X DELETE http://localhost:4096/global/enterprise/auth
```

This removes the stored tokens and virtual key and clears the model cache.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser opens but login page shows "Invalid redirect URI" | The redirect URI `http://127.0.0.1:19876/enterprise/oauth/callback` is missing from the Keycloak client |
| Login succeeds but no models appear | KES URL not set, or `GROUP_KEY_MAP` does not contain a key for the user's group |
| KES returns 403 | The user's Keycloak groups do not match any entry in `GROUP_KEY_MAP` — check the group name (no leading `/`) |
| KES logs show JWT validation failed | `KEYCLOAK_JWKS_URL` is wrong or Keycloak is not reachable from the KES container |
| "OIDC discovery failed" error | The Keycloak realm URL is wrong or the server is not reachable |
| Models disappear after token expiry | Token refresh is failing — verify the Keycloak client has the `offline_access` scope |
| LiteLLM returns 401 for virtual key | The virtual key was deleted from LiteLLM, or the key in `GROUP_KEY_MAP` is wrong |
