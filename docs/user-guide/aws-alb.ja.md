# AWS Application Load Balancer

[English](./aws-alb.md) | [日本語](./aws-alb.ja.md) · [ドキュメント一覧](./README.ja.md)

AWS Application Load Balancer のユーザー認証が生成するヘッダーを upstream が期待する場合は、`alb` プロファイルを使います。

このプロファイルでは、ブラウザーセッション Cookie 名の既定値に ALB の最初の shard である `AWSELBAuthSessionCookie-0` を使います。そのため、アプリケーションの logout response から ALB と同じ Cookie 名を失効させられます。AuthVeil のセッションは1 shardに収まりますが、本番用の logout コードでは ALB が生成しうる全 shard（`-0` から `-3`）を失効させてください。

## 設定

[共通設定](./configuration.ja.md) に次のプロファイルを追加します。

```yaml
identityProxy:
  type: alb
  preserveHostHeader: false
  albArn: arn:aws:elasticloadbalancing:local:000000000000:loadbalancer/app/authveil/local
  issuer: https://authveil.local
  clientId: authveil
  tokenTtl: 5m
```

必須なのは `type` だけです。ほかは上記の値が既定値です。

| キー                 | 既定値                   | 用途                                                                        |
| -------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `preserveHostHeader` | `false`                  | `true` なら受信した Host を維持し、それ以外は AuthVeil の待受に合わせます。 |
| `albArn`             | local placeholder ARN    | `x-amzn-oidc-data` の JOSE header に入る `signer`。                         |
| `issuer`             | `https://authveil.local` | JOSE header の `iss` と access token payload の `iss`。                     |
| `clientId`           | `authveil`               | JOSE header の `client` と access token payload の `aud`。                  |
| `tokenTtl`           | `5m`                     | 生成する token の有効期間。                                                 |

アプリケーション側の検査値に合わせて設定してください。JWKS を固定する必要があればローカル鍵を永続化します。詳細は [署名鍵](./configuration.ja.md#署名鍵) を参照してください。

## 生成するリクエスト

| Header                    | 値                                                                                |
| ------------------------- | --------------------------------------------------------------------------------- |
| `x-amzn-oidc-data`        | `sub`、任意の `email` と `name`、custom claim を持つ ES256 JWT。                  |
| `x-amzn-oidc-identity`    | Identity の subject。                                                             |
| `x-amzn-oidc-accesstoken` | OIDC Provider が返した access token。取得できない場合はローカル生成の ES256 JWT。 |

`x-amzn-oidc-data` の protected header には `alg`、`kid`、`signer`、`iss`、`client`、`exp` が入ります。ALB の request shape に合わせ、`X-Forwarded-For`、`X-Forwarded-Proto`、`X-Forwarded-Port` も再生成します。ALB と同様に、`X-Forwarded-Port` は AuthVeil の listen port です。

## ローカルでの検証

AWS の公開鍵ではなく AuthVeil を verifier に指定します。

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("http://127.0.0.1:3080/_authveil/.well-known/jwks.json"));

const token = request.headers["x-amzn-oidc-data"];
if (typeof token !== "string") throw new Error("Missing ALB identity");

const { payload, protectedHeader } = await jwtVerify(token, jwks, {
  algorithms: ["ES256"],
});

if (
  protectedHeader.signer !== expectedAlbArn ||
  typeof protectedHeader.exp !== "number" ||
  protectedHeader.exp <= Date.now() / 1000 ||
  typeof payload.sub !== "string"
) {
  throw new Error("Invalid local ALB identity");
}
```

生成した token が再現するのは request shape であり、AWS の trust ではありません。本番は AWS の鍵を検証する設定のままにし、ローカル専用の verifier または JWKS override を使用してください。Fastify の完全な例は [`examples/fastify-alb`](../../examples/fastify-alb/server.js) にあります。
