# Fastify サンプル

[English](./examples.md) | [日本語](./examples.ja.md) · [開発ドキュメント](./README.ja.md) · [プロジェクト README](../../README.ja.md)

各 AuthVeil プロファイルの受け取り方を示す、実行可能な upstream アプリケーションです。すべての server が `GET /user` を公開し、AuthVeil 経由でアクセスします。

リポジトリのルートで AuthVeil を build し、サンプルの依存関係をインストールします。

```bash
pnpm build
cd examples
pnpm install
```

アプリケーションと対応する proxy を別々の terminal で実行します。

| プロファイル                                                           | Application    | AuthVeil                                                                 | URL                          |
| ---------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ | ---------------------------- |
| [AWS ALB](../user-guide/aws-alb.ja.md)                                 | `pnpm alb`     | `node ../dist/cli.js start --config fastify-alb/config.yaml`             | `http://127.0.0.1:3080/user` |
| [Google Cloud IAP](../user-guide/google-cloud-iap.ja.md)               | `pnpm iap`     | `node ../dist/cli.js start --config fastify-iap/config.yaml`             | `http://127.0.0.1:3081/user` |
| [Entra Application Proxy](../user-guide/entra-application-proxy.ja.md) | `pnpm entra`   | `node ../dist/cli.js start --config fastify-entra-app-proxy/config.yaml` | `http://127.0.0.1:3082/user` |
| [Generic](../user-guide/generic.ja.md)                                 | `pnpm generic` | `node ../dist/cli.js start --config fastify-generic/config.yaml`         | `http://127.0.0.1:3083/user` |

設定は固定の `developer` mock Identity を使うため、URL を開くと受信した Identity がすぐに返ります。これらの server はローカルの AuthVeil Header を信頼するサンプルであり、本番構成ではありません。
