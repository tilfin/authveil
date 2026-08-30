# Microsoft Entra Application Proxy

[English](./entra-application-proxy.md) | [日本語](./entra-application-proxy.ja.md) · [Documentation](./README.md)

Use `entra-app-proxy` to reproduce the header-based SSO contract and internal-to-external URL behavior used by an application behind Microsoft Entra Application Proxy.

## Configure

Map the exact header names expected by your application:

```yaml
identityProxy:
  type: entra-app-proxy
  translateUrlsInHeaders: true
  headers:
    X-Remote-User-Id: { claim: sub }
    X-Remote-User-Email: { claim: email }
    X-Remote-User-Name: { claim: name }
    X-Remote-User-Groups: { claim: groups, transform: join, separator: "," }
```

`headers` is required because Entra header-based SSO attributes are application-specific. See [Header mapping](./header-mapping.md) for claim paths and transforms.

## URL and Host translation

`translateUrlsInHeaders` defaults to `true`. In that mode AuthVeil:

- sends the host from `upstream.url` in the upstream `Host` header;
- rewrites absolute `Location` and `Content-Location` values whose origin matches `upstream.url` to the client-facing origin;
- rewrites a matching `Domain` attribute in `Set-Cookie`.

Response bodies, unrelated origins, relative URLs, and other headers are unchanged. Set `translateUrlsInHeaders: false` to preserve the client-facing Host and disable response-header translation.

## Generated request

Only configured SSO headers are added. AuthVeil removes client-supplied values for those names first, then regenerates `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-Port` from the direct request.

This profile emulates the request contract; it does not connect to Entra or validate an Entra token. Choose [mock or OIDC authentication](./auth-modes.md) separately. A runnable upstream is in [`examples/fastify-entra-app-proxy`](../../examples/fastify-entra-app-proxy/server.js).
