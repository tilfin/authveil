# Microsoft Entra Application Proxy

[English](./entra-application-proxy.md) | [日本語](./entra-application-proxy.ja.md) · [ドキュメント一覧](./README.ja.md)

Microsoft Entra Application Proxy 配下のアプリケーションが利用する header-based SSO と、内部 URL から外部 URL への挙動を再現するには `entra-app-proxy` を使います。

## 設定

アプリケーションが期待する Header 名をそのまま mapping します。

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

Entra の header-based SSO attribute はアプリケーションごとに異なるため、`headers` は必須です。claim path と transform は [Header mapping](./header-mapping.ja.md) を参照してください。

## URL と Host の変換

`translateUrlsInHeaders` の既定値は `true` です。この場合、AuthVeil は次の変換を行います。

- upstream の `Host` に `upstream.url` の host を送る
- `upstream.url` と origin が一致する絶対 URL の `Location` と `Content-Location` を client-facing origin に変換する
- `Set-Cookie` の一致する `Domain` attribute を変換する

response body、無関係な origin、相対 URL、その他の header は変更しません。`translateUrlsInHeaders: false` にすると client-facing Host を維持し、response header の変換を無効にします。

## 生成するリクエスト

設定した SSO Header だけを追加します。AuthVeil は同名の client-supplied value を先に除去し、直接届いたリクエストから `X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-Port` を再生成します。

このプロファイルは request contract を再現するだけで、Entra への接続や Entra token の検証は行いません。[mock または OIDC 認証](./auth-modes.ja.md) は別に選択してください。実行可能な upstream は [`examples/fastify-entra-app-proxy`](../../examples/fastify-entra-app-proxy/server.js) にあります。
