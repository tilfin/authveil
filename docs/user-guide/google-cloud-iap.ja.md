# Google Cloud Identity-Aware Proxy

[English](./google-cloud-iap.md) | [日本語](./google-cloud-iap.ja.md) · [ドキュメント一覧](./README.ja.md)

upstream が Google Cloud IAP assertion を検証する場合、または IAP の authenticated-user header を読む場合は `iap` プロファイルを使います。

## 設定

アプリケーションの IAP resource が期待する audience を指定します。

```yaml
identityProxy:
  type: iap
  audience: /projects/123/global/backendServices/456
```

`audience` は必須です。任意の設定は次のとおりです。

| キー                | 既定値                         | 用途                                             |
| ------------------- | ------------------------------ | ------------------------------------------------ |
| `hostRewrite`       | 受信した Host                  | upstream へ送る Host。                           |
| `issuer`            | `https://cloud.google.com/iap` | JWT の `iss` claim。                             |
| `identityNamespace` | `accounts.google.com`          | authenticated-user ID / email header の prefix。 |
| `tokenTtl`          | `10m`                          | 生成する assertion の有効期間。                  |

JWKS を固定する必要があればローカル鍵を永続化します。詳細は [署名鍵](./configuration.ja.md#署名鍵) を参照してください。

## 生成するリクエスト

| Header                            | 値                                                                          |
| --------------------------------- | --------------------------------------------------------------------------- |
| `x-goog-iap-jwt-assertion`        | `iss`、`aud`、`iat`、`exp`、Identity field、custom claim を持つ ES256 JWT。 |
| `x-goog-authenticated-user-id`    | `<identityNamespace>:<subject>`。                                           |
| `x-goog-authenticated-user-email` | Identity に email がある場合は `<identityNamespace>:<email>`。              |

`hostRewrite` を設定しなければ、受信した Host を維持します。すべての `X-Forwarded-*` metadata は直接届いたリクエストから再生成します。

## クエリパラメータと生成レスポンス

`iap` プロファイルでは、アプリケーションの任意のパスで IAP 固有のクエリパラメータも再現します。

| Query                             | 動作                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `gcp-iap-mode=IDENTITY`           | ログイン中の Identity を、namespace 付きの `email`（存在する場合）と `sub` を持つ JSON として返します。 |
| `gcp-iap-mode=CLEAR_LOGIN_COOKIE` | ローカルセッションを削除して cookie を失効させ、IAP 制御パラメータを除いた同じ URL へ redirect します。 |
| `gcp-iap-mode=SECURE_TOKEN_TEST`  | `iap-secure-token-test-type` に応じたテスト用 assertion を upstream へ送ります。                        |

secure-token test type は `NOT_SET`（正常な token）、`FUTURE_ISSUE`、`PAST_EXPIRATION`、`ISSUER`、`AUDIENCE`、`SIGNATURE` に対応します。

認証 redirect、Identity response、cookie 消去 redirect、拒否された WebSocket upgrade など、IAP emulation が生成した response には `X-Goog-IAP-Generated-Response: true` を付与します。これにより upstream application が生成した response と区別できます。

## ローカルでの検証

設定した audience と AuthVeil の JWKS を使います。

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("http://127.0.0.1:3080/_authveil/.well-known/jwks.json"));

const { payload } = await jwtVerify(assertion, jwks, {
  algorithms: ["ES256"],
  audience: "/projects/123/global/backendServices/456",
  issuer: "https://cloud.google.com/iap",
});
```

ローカルの assertion は Google が署名したものではありません。本番では Google の鍵検証を維持し、ローカル専用の JWKS override を使用してください。Fastify の完全な例は [`examples/fastify-iap`](../../examples/fastify-iap/server.js) にあります。
