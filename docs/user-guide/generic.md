# Generic and no-identity profiles

[English](./generic.md) | [日本語](./generic.ja.md) · [Documentation](./README.md)

Use `generic` for an application behind a custom header-based identity proxy. Use `none` when you need AuthVeil's login and forwarding behavior without identity headers.

## Generic profile

```yaml
identityProxy:
  type: generic
  hostHeader: preserve
  headers:
    X-User-Id: { claim: sub }
    X-User-Roles: { claim: groups, transform: join, separator: ";" }
    X-User-Department: { claim: department }
```

`headers` is required. See [Header mapping](./header-mapping.md) for available claims and transforms.

`hostHeader` defaults to `preserve`, which sends the client-facing Host upstream. Set it to `upstream` to use the host and port from `upstream.url`.

AuthVeil removes client-supplied values for every mapped header before injecting the authenticated identity. A runnable example is in [`examples/fastify-generic`](../../examples/fastify-generic/server.js).

## None profile

```yaml
identityProxy:
  type: none
  hostHeader: preserve
```

No identity header is generated. Authentication is still required, so this mode is useful for testing login, sessions, forwarding, and upstream behavior independently of a provider-specific contract. `hostHeader` has the same `preserve` and `upstream` options as the generic profile.

Both profiles regenerate `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-Port` from the direct request.
