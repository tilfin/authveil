# AuthVeil development documentation

[English](./README.md) | [日本語](./README.ja.md) · [Documentation](../README.md) · [Project README](../../README.md)

This section is for contributors and applications that intentionally embed AuthVeil as a Node.js development dependency. End users running the published container should use the [user guide](../user-guide/README.md).

## Library API

Install AuthVeil in the application workspace:

```bash
pnpm add --save-dev authveil
```

```ts
import { createAuthVeil } from "authveil";

const authveil = await createAuthVeil({
  upstream: { url: "http://127.0.0.1:8080" },
  auth: { mode: "mock", mockUser: "developer" },
  mockUsers: [{ id: "developer", subject: "local-developer-001" }],
  identityProxy: {
    type: "iap",
    audience: "/projects/123/global/backendServices/456",
  },
});

await authveil.listen({ port: 3080 });
// Later: await authveil.close();
```

The object shape matches the YAML configuration documented in the [configuration reference](../user-guide/configuration.md).

## Test utilities and examples

- [Testkit](./testkit.md) — start AuthVeil and an echo upstream on free ports in integration tests
- [Fastify examples](./examples.md) — run upstream applications for every identity-proxy profile
- [Detailed design](./design.md) — architecture and implementation decisions

## Repository development

Node.js 24 or later and pnpm are required. From the repository root:

```bash
pnpm install
pnpm test
pnpm build
pnpm check
```
