# Generic / Identity なしのプロファイル

[English](./generic.md) | [日本語](./generic.ja.md) · [ドキュメント一覧](./README.ja.md)

独自の header-based Identity Proxy 配下にあるアプリケーションには `generic` を使います。Identity Header は不要で、AuthVeil の login と転送だけを使う場合は `none` を選びます。

## Generic プロファイル

```yaml
identityProxy:
  type: generic
  hostHeader: preserve
  headers:
    X-User-Id: { claim: sub }
    X-User-Roles: { claim: groups, transform: join, separator: ";" }
    X-User-Department: { claim: department }
```

`headers` は必須です。利用できる claim と transform は [Header mapping](./header-mapping.ja.md) を参照してください。

`hostHeader` の既定値は `preserve` で、client-facing Host を upstream へ送ります。`upstream` にすると `upstream.url` の host と port を使用します。

AuthVeil は mapping した Header と同名の client-supplied value を除去してから、認証済み Identity を注入します。実行可能な例は [`examples/fastify-generic`](../../examples/fastify-generic/server.js) にあります。

## None プロファイル

```yaml
identityProxy:
  type: none
  hostHeader: preserve
```

Identity Header は生成しません。認証自体は必要なため、Provider 固有の contract と切り離して login、session、転送、upstream の挙動を確認できます。`hostHeader` は generic と同じ `preserve` / `upstream` を選べます。

どちらのプロファイルも、直接届いたリクエストから `X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-Port` を再生成します。
