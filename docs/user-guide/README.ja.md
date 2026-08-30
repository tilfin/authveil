# AuthVeil ユーザーガイド

[English](./README.md) | [日本語](./README.ja.md) · [ドキュメント一覧](../README.ja.md) · [プロジェクト README](../../README.ja.md)

アプリケーションが利用している Identity Proxy のページから始めてください。利用しないクラウドのガイドを読む必要はありません。

ユーザーガイドでは `ghcr.io/tilfin/authveil:latest` から AuthVeil を実行する前提です。最初に [Docker クイックスタート](../../README.ja.md#クイックスタート) を実施してください。このガイド内の AuthVeil コマンド例はすべて `docker run` で公開イメージを呼び出します。

## セットアップ

- [設定リファレンス](./configuration.ja.md) — 設定ファイルの読込、共通設定、鍵、検証
- [認証モード](./auth-modes.ja.md) — ローカルの mock ユーザーと外部 OIDC ログイン

## Identity Proxy プロファイル

- [AWS Application Load Balancer](./aws-alb.ja.md)
- [Google Cloud Identity-Aware Proxy](./google-cloud-iap.ja.md)
- [Microsoft Entra Application Proxy](./entra-application-proxy.ja.md)
- [Generic Header と Identity なしの転送](./generic.ja.md)

## リファレンス

- [Header mapping](./header-mapping.ja.md) — generic と Entra で共通する claim transform
