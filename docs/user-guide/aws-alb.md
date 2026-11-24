# AWS Application Load Balancer

[English](./aws-alb.md) | [日本語](./aws-alb.ja.md) · [Documentation](./README.md)

Use the `alb` profile when the upstream expects the headers produced by an AWS Application Load Balancer with user authentication enabled.

AuthVeil defaults the browser session cookie to the first ALB cookie shard, `AWSELBAuthSessionCookie-0`, for this profile. Application logout responses can therefore expire the same cookie name used with ALB. AuthVeil sessions fit in one shard; production logout code should expire all possible ALB shards (`-0` through `-3`).

## Configure

Add this profile to your [base configuration](./configuration.md):

```yaml
identityProxy:
  type: alb
  preserveHostHeader: false
  albArn: arn:aws:elasticloadbalancing:local:000000000000:loadbalancer/app/authveil/local
  issuer: https://authveil.local
  clientId: authveil
  tokenTtl: 5m
```

Only `type` is required. The remaining values above are the defaults.

| Key                  | Default                  | Purpose                                                                                  |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `preserveHostHeader` | `false`                  | Preserve the incoming Host when `true`; otherwise normalize it to the AuthVeil listener. |
| `albArn`             | local placeholder ARN    | `signer` field in the `x-amzn-oidc-data` JOSE header.                                    |
| `issuer`             | `https://authveil.local` | `iss` field in the JOSE header and access-token payload.                                 |
| `clientId`           | `authveil`               | `client` field in the JOSE header and `aud` in the access-token payload.                 |
| `tokenTtl`           | `5m`                     | Lifetime of generated tokens.                                                            |

Use values that match the checks in your application. Configure a persistent local key when stable JWKS is needed; see [Signing keys](./configuration.md#signing-keys).

## Generated request

| Header                    | Value                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `x-amzn-oidc-data`        | ES256 JWT containing `sub`, optional `email` and `name`, and custom claims.         |
| `x-amzn-oidc-identity`    | Identity subject.                                                                   |
| `x-amzn-oidc-accesstoken` | OIDC provider access token when available; otherwise a locally generated ES256 JWT. |

The `x-amzn-oidc-data` protected header contains `alg`, `kid`, `signer`, `iss`, `client`, and `exp`. AuthVeil also regenerates `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Port` in the ALB request shape. Like ALB, `X-Forwarded-Port` is the AuthVeil listener port.

## Verify locally

Point your verifier at AuthVeil rather than AWS public keys:

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

The generated tokens reproduce the request shape, not AWS trust. Keep production verification configured for AWS keys and use a development-only verifier or JWKS override locally. A complete Fastify verifier is in [`examples/fastify-alb`](../../examples/fastify-alb/server.js).
