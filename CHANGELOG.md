# Changelog

## 0.2.0 - Unreleased

### Changed

- Reject invalid settings when the configuration is loaded: durations must be valid (session and token lifetimes positive), `server.controlPrefix` needs at least one path segment, mapped header names must be valid and cannot target headers AuthVeil manages (`Host`, `X-Forwarded-*`, framing headers, the request ID), `sameSite: none` requires `secure: true`, `mockUsers` ids must be unique, and OIDC issuer and redirect URIs must be http(s) URLs.
- Expand `${NAME}` environment references after parsing YAML, so values cannot inject YAML structure and references in comments are ignored.
- Reject requests and WebSocket upgrades with `431` when generated identity headers exceed the Node.js header size limit.
- Return `504` with `AUTHVEIL_UPSTREAM_TIMEOUT` when `upstream.requestTimeout` elapses.
- Close lingering SSE and WebSocket connections after a two-second grace period on shutdown.
- `keys generate` writes to `.authveil/private-key.pem` by default and creates the parent directory; `validate` no longer creates a missing key file.
- Drop ID-token protocol claims (`iss`, `aud`, `exp`, `iat`, `nonce`, ...) from OIDC identities, and allow plain-HTTP issuers for local providers.

### Fixed

- Reject `returnTo` values that resolve to another origin.
- Harden control routes, malformed cookies, and WebSocket upgrades on the control prefix.
- Bound the signed-token cache and reuse cached tokens as designed.
- Correct ALB IPv6 Host normalization and report the listener port in `X-Forwarded-Port`.
- Serve the fixed mock identity from `/me` and `/debug/headers` when `auth.mockUser` is set.
- Treat CLI arguments that start with an option as `start`, and report missing option values and unknown commands.

## 0.1.0 - 2026-08-30

- Emulate Google Cloud IAP identity, login-cookie clearing, secure-token test query parameters, and generated-response headers.
- Add profile-specific Host, forwarding-header, and Entra response URL translation behavior.
- Limit direct environment-variable overrides to `AUTHVEIL_HOST`, `AUTHVEIL_PORT`, and `AUTHVEIL_UPSTREAM`; authentication, identity-proxy, and logging settings must be declared in YAML.
- Replace signing-key `generate` and `persistTo` settings with mutually exclusive `privateKey` and `privateKeyFile`. Missing key files now create and persist an ES256 key with `0600` permissions.
- Initial development-only identity-aware reverse proxy.
- Mock and OIDC authentication modes.
- ALB, IAP, Entra Application Proxy, generic, and no-identity-proxy profiles.
- ES256 signing, JWKS and PEM endpoints, sessions, HTTP/SSE/WebSocket proxying, CLI, and testkit APIs.
