# Changelog

## 0.1.0 - Unreleased

- Emulate Google Cloud IAP identity, login-cookie clearing, secure-token test query parameters, and generated-response headers.
- Add profile-specific Host, forwarding-header, and Entra response URL translation behavior.
- Limit direct environment-variable overrides to `AUTHVEIL_HOST`, `AUTHVEIL_PORT`, and `AUTHVEIL_UPSTREAM`; authentication, identity-proxy, and logging settings must be declared in YAML.
- Replace signing-key `generate` and `persistTo` settings with mutually exclusive `privateKey` and `privateKeyFile`. Missing key files now create and persist an ES256 key with `0600` permissions.
- Initial development-only identity-aware reverse proxy.
- Mock and OIDC authentication modes.
- ALB, IAP, Entra Application Proxy, generic, and no-identity-proxy profiles.
- ES256 signing, JWKS and PEM endpoints, sessions, HTTP/SSE/WebSocket proxying, CLI, and testkit APIs.
