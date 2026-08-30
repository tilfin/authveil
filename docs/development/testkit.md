# Testkit

[English](./testkit.md) | [日本語](./testkit.ja.md) · [Documentation](./README.md)

`authveil/testkit` starts AuthVeil and an optional echo upstream on random free ports for integration tests. Import it from test code only.

```ts
import { startEchoUpstream, startTestProxy, testUsers } from "authveil/testkit";
```

## Example

```ts
import { expect, it } from "vitest";
import { startEchoUpstream, startTestProxy } from "authveil/testkit";

it("forwards the authenticated identity", async () => {
  const upstream = await startEchoUpstream();
  const authveil = await startTestProxy({
    upstream: { url: upstream.url },
    identityProxy: {
      type: "generic",
      headers: { "X-User-Id": { claim: "sub" } },
    },
  });

  try {
    const login = await fetch(`${authveil.address.url}/_authveil/login?user=admin`, {
      redirect: "manual",
    });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const response = await fetch(`${authveil.address.url}/orders`, {
      headers: { cookie },
    });
    const request = (await response.json()) as {
      headers: Record<string, string>;
    };

    expect(request.headers["x-user-id"]).toBe("local-admin-001");
  } finally {
    await authveil.close();
    await upstream.close();
  }
});
```

## Helpers

### `startTestProxy(options)`

Starts AuthVeil in mock mode with `server.port: 0`. `upstream` is required; all other [Library API options](./README.md#library-api) are accepted. The result contains:

- `mirror` — the running AuthVeil instance
- `address` — `{ host, port, url }`
- `close()` — stops the proxy

Pass `mockUsers` to replace the built-in users.

### `testUsers`

Contains `admin` (`local-admin-001`, groups `administrators` and `developers`) and `viewer` (`local-viewer-001`, group `viewers`). Their keys are valid values for the login URL's `user` parameter.

### `startEchoUpstream()`

Starts an HTTP server that returns the received `method`, `url`, `headers`, and `body` as JSON. The result contains its `url` and `close()`.

Always close both servers in test cleanup.
