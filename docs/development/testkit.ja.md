# Testkit

[English](./testkit.md) | [日本語](./testkit.ja.md) · [ドキュメント一覧](./README.ja.md)

`authveil/testkit` は結合テスト向けに、AuthVeil と任意の echo upstream をランダムな空きポートで起動します。テストコードからだけ import してください。

```ts
import { startEchoUpstream, startTestProxy, testUsers } from "authveil/testkit";
```

## 使用例

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

## Helper

### `startTestProxy(options)`

AuthVeil を mock モード、`server.port: 0` で起動します。`upstream` は必須で、ほかの [Library API option](./README.ja.md#library-api) も指定できます。返り値は次のとおりです。

- `mirror` — 起動中の AuthVeil instance
- `address` — `{ host, port, url }`
- `close()` — proxy を停止

組み込みユーザーを置き換える場合は `mockUsers` を渡します。

### `testUsers`

`admin`（`local-admin-001`、group は `administrators` と `developers`）と `viewer`（`local-viewer-001`、group は `viewers`）が入っています。key は login URL の `user` parameter に指定できます。

### `startEchoUpstream()`

受信した `method`、`url`、`headers`、`body` を JSON で返す HTTP server を起動します。返り値は `url` と `close()` を含みます。

テストの cleanup では両方の server を必ず停止してください。
