# Fastify examples

[English](./examples.md) | [日本語](./examples.ja.md) · [Development documentation](./README.md) · [Project README](../../README.md)

These runnable upstream applications show how to consume each AuthVeil profile. Every server exposes `GET /user` and must be reached through AuthVeil.

From the repository root, build AuthVeil and install the example dependencies:

```bash
pnpm build
cd examples
pnpm install
```

Run the application and its matching proxy in separate terminals:

| Profile                                                             | Application    | AuthVeil                                                                 | URL                          |
| ------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ | ---------------------------- |
| [AWS ALB](../user-guide/aws-alb.md)                                 | `pnpm alb`     | `node ../dist/cli.js start --config fastify-alb/config.yaml`             | `http://127.0.0.1:3080/user` |
| [Google Cloud IAP](../user-guide/google-cloud-iap.md)               | `pnpm iap`     | `node ../dist/cli.js start --config fastify-iap/config.yaml`             | `http://127.0.0.1:3081/user` |
| [Entra Application Proxy](../user-guide/entra-application-proxy.md) | `pnpm entra`   | `node ../dist/cli.js start --config fastify-entra-app-proxy/config.yaml` | `http://127.0.0.1:3082/user` |
| [Generic](../user-guide/generic.md)                                 | `pnpm generic` | `node ../dist/cli.js start --config fastify-generic/config.yaml`         | `http://127.0.0.1:3083/user` |

The configurations use a fixed `developer` mock identity, so the URL returns the received identity immediately. These servers trust local AuthVeil headers and are not production deployments.
