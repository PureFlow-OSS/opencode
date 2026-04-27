# Enterprise Integration — LiteLLM + Keycloak SSO

This document describes how to configure opencode for corporate environments
where AI model access is managed centrally via LiteLLM and user authentication
is handled by Keycloak.

## Overview

Instead of each user manually configuring API keys and model lists, opencode
can authenticate against your company's Keycloak instance using PKCE OAuth and
then automatically discover the models available to that user from LiteLLM.

```
opencode → Keycloak (PKCE login) → JWT access token
        → LiteLLM /models (Bearer JWT) → allowed model list
        → every LLM call uses the JWT as Bearer token
```

No virtual key distribution is needed. LiteLLM validates the JWT against
Keycloak's JWKS endpoint and applies the team's model permissions automatically.

## Requirements

- LiteLLM proxy (open-source, no enterprise license required)
- Keycloak (any version that supports PKCE / OpenID Connect)
- The two services must be reachable from the user's machine

## Setup

### 1. Keycloak — create the opencode client

1. Open your realm in the Keycloak admin console.
2. Create a new client:
   - **Client ID**: `opencode` (or any name — users can override it)
   - **Client type**: `Public` (no client secret)
   - **Standard flow**: enabled
   - **Direct access grants**: disabled
3. Under **Valid redirect URIs**, add:
   ```
   http://127.0.0.1:19876/enterprise/oauth/callback
   ```
4. Under **Client scopes → Add mapper**, add a **Group Membership** mapper:
   - **Name**: `groups`
   - **Token Claim Name**: `groups`
   - **Add to access token**: on
   - **Full group path**: off (optional)

   This puts the user's group memberships into the JWT so LiteLLM can map them
   to teams.

### 2. LiteLLM — enable JWT authentication

Add the following to your `litellm_config.yaml`:

```yaml
general_settings:
  enable_jwt_auth: true

environment_variables:
  # Point to your Keycloak realm's JWKS endpoint
  JWT_PUBLIC_KEY_URL: "https://keycloak.corp.com/realms/corp/protocol/openid-connect/certs"
  # Must match the client_id configured in Keycloak
  JWT_AUDIENCE: "opencode"
```

Restart the LiteLLM proxy after changing the config.

To restrict which models each Keycloak group can access, use LiteLLM's router
policies with the `groups` JWT claim. See the
[LiteLLM JWT auth docs](https://docs.litellm.ai/docs/proxy/token_auth) for details.

### 3. opencode — connect via the Settings UI

1. Open opencode and go to **Settings → Providers**.
2. At the top you will see the **Enterprise (LiteLLM + Keycloak SSO)** section.
3. Fill in:
   - **LiteLLM URL**: the base URL of your proxy (e.g. `https://litellm.corp.com`)
   - **Keycloak Realm URL**: the full realm URL (e.g. `https://keycloak.corp.com/realms/corp`)
   - **Client ID** (optional): defaults to `opencode`
4. Click **Connect via SSO** — a browser window opens with the Keycloak login page.
5. Log in with your corporate credentials.
6. The browser closes automatically and opencode shows the connected state along
   with the number of models available to your account.

Alternatively, set the URLs in your opencode config file to pre-fill the form:

```jsonc
// ~/.config/opencode/config.json
{
  "enterprise": {
    "url": "https://litellm.corp.com",
    "keycloak_url": "https://keycloak.corp.com/realms/corp",
    "client_id": "opencode"
  }
}
```

## How it works

### Authentication flow

1. opencode generates a PKCE `code_verifier` and `code_challenge`.
2. A local HTTP callback server starts on `http://127.0.0.1:19876`.
3. The browser opens to Keycloak's authorization endpoint with the PKCE
   challenge and a random `state` parameter (CSRF protection).
4. After the user logs in, Keycloak redirects to the callback URL with an
   authorization `code`.
5. opencode exchanges the code for an `access_token` (JWT, ~15 min) and a
   `refresh_token` (~30 days) by calling Keycloak's token endpoint directly.
6. Both tokens are stored in `~/.local/share/opencode/auth.json` (mode 0600)
   under the key `enterprise`.

### Model discovery

After a successful login, opencode calls `GET /models` on LiteLLM with the
JWT as the Bearer token. LiteLLM returns only the models the user's team is
allowed to use. The list is cached in
`~/.local/share/opencode/enterprise-models.json` and loaded on every startup.

### Token refresh

Before each LLM request, opencode checks the token's `exp` claim. If the
token is within 60 seconds of expiry, it requests a new one from Keycloak
using the stored `refresh_token`. The refresh happens transparently — the user
is not prompted again. The model list is also refreshed in the background after
a successful token refresh.

If the `refresh_token` itself expires (after ~30 days of inactivity), opencode
shows a "Session expired — please reconnect" prompt and the user repeats the
browser login.

### Token revocation

Because LiteLLM validates the JWT signature rather than checking a revocation
list, a revoked Keycloak account remains effective until the current
`access_token` expires (up to 15 minutes). The `refresh_token` is invalidated
immediately when an admin disables the Keycloak account, so the user will be
unable to refresh after the current token expires.

To reduce the window, set a shorter access token lifetime in Keycloak
(Realm Settings → Tokens → Access Token Lifespan).

## Disconnecting

Click **Disconnect** in Settings → Providers, or run:

```bash
curl -X DELETE http://localhost:4096/global/enterprise/auth
```

This removes the stored tokens and clears the model cache. The enterprise
provider disappears from the model selector immediately after restarting the
opencode server.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser opens but login page shows "Invalid redirect URI" | The redirect URI in Keycloak does not include `http://127.0.0.1:19876/enterprise/oauth/callback` |
| Login succeeds but no models appear | The `groups` claim is missing from the JWT — check the Keycloak group mapper |
| LiteLLM returns 401 for every request | `JWT_PUBLIC_KEY_URL` or `JWT_AUDIENCE` is misconfigured in LiteLLM |
| "OIDC discovery failed" error | The Keycloak realm URL is wrong or the server is not reachable |
| Models disappear after ~15 minutes | Token refresh is failing — check that `offline_access` scope is granted |
