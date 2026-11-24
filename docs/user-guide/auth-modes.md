# Authentication modes

[English](./auth-modes.md) | [日本語](./auth-modes.ja.md) · [Documentation](./README.md)

`auth.mode` selects where AuthVeil gets a user identity. It is independent of `identityProxy`, which controls the headers sent upstream.

| Mode   | Identity source                     | Best for                                                  |
| ------ | ----------------------------------- | --------------------------------------------------------- |
| `mock` | Users in the configuration file     | Daily development and role-specific UI or API testing     |
| `oidc` | An external OpenID Connect provider | Integration checks using a real login and ID-token claims |

Without an active session, OIDC and interactive mock mode redirect ordinary requests to `/_authveil/login`.

## Mock mode

Set `auth.mockUser` for a fixed identity with no login screen:

```yaml
auth:
  mode: mock
  mockUser: admin

mockUsers:
  - id: admin
    subject: local-admin-001
    email: admin@example.test
    name: Local Admin
    claims:
      groups: [administrators, developers]
      department: engineering
```

Remove `mockUser` to choose a configured user in the browser. Open the proxied application or link directly to a user:

```text
http://127.0.0.1:3080/_authveil/login?user=admin&returnTo=/
```

| User field      | Purpose                                                         |
| --------------- | --------------------------------------------------------------- |
| `id`            | Required selector used by `auth.mockUser` and the login URL.    |
| `subject`       | Required identity `sub` value.                                  |
| `email`, `name` | Optional standard identity fields.                              |
| `claims`        | Optional JSON-compatible custom claims such as groups or roles. |

`auth.mockUser` must match a `mockUsers[].id`. Fixed mock identity injection works for HTTP and WebSocket requests.

## OIDC mode

Register AuthVeil's callback URL with your provider, then configure the client:

```yaml
auth:
  mode: oidc
  oidc:
    issuer: https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0
    clientId: ${OIDC_CLIENT_ID}
    clientSecret: ${OIDC_CLIENT_SECRET}
    redirectUri: http://127.0.0.1:3080/_authveil/callback
    scopes: [openid, profile, email]
    claimMapping:
      subject: sub
      email: preferred_username
      name: name
```

The provider registration and `redirectUri` must match exactly. Change the URI when you change the listen port or `server.controlPrefix`.

AuthVeil uses Authorization Code Flow with PKCE and validates state and nonce. The default scopes are `openid profile email`; add provider-specific scopes only when needed.

| Key                      | Required | Purpose                                                                    |
| ------------------------ | -------- | -------------------------------------------------------------------------- |
| `auth.oidc.issuer`       | yes      | Issuer used for OpenID Connect discovery.                                  |
| `auth.oidc.clientId`     | yes      | Registered client ID.                                                      |
| `auth.oidc.clientSecret` | no       | Client secret, if the provider requires one. Use an environment reference. |
| `auth.oidc.redirectUri`  | yes      | Registered callback URL.                                                   |
| `auth.oidc.scopes`       | no       | Requested scopes.                                                          |
| `auth.oidc.claimMapping` | no       | Dot-paths for the subject, email, and name claims.                         |

Unmapped ID-token claims remain available as custom claims. AuthVeil does not normalize provider-specific claims such as `groups`.

OIDC listens only on `127.0.0.1`, `::1`, or `localhost`. Use mock mode or an HTTPS-terminating development environment when testing from another machine.

## Sessions and control routes

| Key                    | Default           | Purpose                                                                                                         |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `auth.sessionTtl`      | `8h`              | Lifetime of an in-memory session.                                                                               |
| `auth.cookie.name`     | profile-dependent | Session cookie name. ALB defaults to `AWSELBAuthSessionCookie-0`; other profiles default to `authveil_session`. |
| `auth.cookie.sameSite` | `lax`             | `lax`, `strict`, or `none`. `none` requires `auth.cookie.secure: true`.                                         |
| `auth.cookie.secure`   | `false`           | Adds `Secure`; enable only when the browser uses HTTPS.                                                         |

Sessions are stored in memory and disappear when AuthVeil restarts. Useful control routes under `server.controlPrefix` are:

| Route                       | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `GET /login`                | Start OIDC login or choose a mock user.                      |
| `GET /me`                   | Return the current identity and logout CSRF token.           |
| `POST /logout`              | End the session; send the token in `X-AuthVeil-CSRF`.        |
| `GET /debug/headers`        | Preview masked generated headers for an active mock session. |
| `GET /health`, `GET /ready` | Process health and readiness.                                |

## Troubleshooting

| Symptom                     | Check                                                                    |
| --------------------------- | ------------------------------------------------------------------------ |
| OIDC fails during startup   | `issuer`, `clientId`, and `redirectUri` are all present.                 |
| Callback returns 400        | The redirect URI matches exactly and login completed within ten minutes. |
| Claims are missing          | The provider's ID token, requested scopes, and `claimMapping` paths.     |
| Environment expansion fails | Every referenced variable exists in the shell starting AuthVeil.         |
