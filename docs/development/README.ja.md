# AuthVeil 開発ドキュメント

[English](./README.md) | [日本語](./README.ja.md) · [ドキュメント一覧](../README.ja.md) · [プロジェクト README](../../README.ja.md)

このセクションは、AuthVeil の contributor と、Node.js の開発用依存関係として AuthVeil を意図的に組み込むアプリケーション向けです。公開済み container を実行する一般利用者は [ユーザーガイド](../user-guide/README.ja.md) を参照してください。

## Library API

アプリケーションの workspace に AuthVeil をインストールします。

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
// 終了時: await authveil.close();
```

object の形式は [設定リファレンス](../user-guide/configuration.ja.md) の YAML 設定に対応します。

## テスト用機能とサンプル

- [Testkit](./testkit.ja.md) — 結合テスト内で AuthVeil と echo upstream を空きポートに起動
- [Fastify サンプル](./examples.ja.md) — 各 Identity Proxy プロファイル向け upstream アプリケーションを実行
- [詳細設計](./design.md) — architecture と実装方針

## リポジトリの開発

Node.js 24 以降と pnpm が必要です。リポジトリのルートで実行します。

```bash
pnpm install
pnpm test
pnpm build
pnpm check
```
