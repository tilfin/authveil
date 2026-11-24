# 認証モード

[English](./auth-modes.md) | [日本語](./auth-modes.ja.md) · [ドキュメント一覧](./README.ja.md)

`auth.mode` は AuthVeil がユーザーの Identity を取得する方法を選びます。upstream へ送るヘッダーを決める `identityProxy` とは独立しています。

| モード | Identity の取得元            | 適した用途                                     |
| ------ | ---------------------------- | ---------------------------------------------- |
| `mock` | 設定ファイル内のユーザー     | 日常の開発、role ごとの UI / API テスト        |
| `oidc` | 外部 OpenID Connect Provider | 実際のログインと ID token claim を使う結合確認 |

有効なセッションがない場合、OIDC と対話式 mock モードでは通常のリクエストを `/_authveil/login` へ redirect します。

## Mock モード

ログイン画面を使わず Identity を固定するには `auth.mockUser` を指定します。

```yaml
auth:
  mode: mock
  mockUser: admin

mockUsers:
  - id: admin
    subject: local-admin-001
    email: admin@example.test
    name: Local Admin
    claims:
      groups: [administrators, developers]
      department: engineering
```

`mockUser` を削除すると、ブラウザーで設定済みユーザーを選べます。プロキシ経由のアプリケーションを開くか、ユーザーを URL で直接指定します。

```text
http://127.0.0.1:3080/_authveil/login?user=admin&returnTo=/
```

| ユーザーフィールド | 用途                                              |
| ------------------ | ------------------------------------------------- |
| `id`               | 必須。`auth.mockUser` と login URL で使う識別子。 |
| `subject`          | 必須。Identity の `sub`。                         |
| `email`, `name`    | 任意の標準 Identity フィールド。                  |
| `claims`           | group や role など、JSON 互換の任意 claim。       |

`auth.mockUser` は `mockUsers[].id` と一致する必要があります。固定した mock Identity は HTTP と WebSocket の両方に注入されます。

## OIDC モード

Provider に AuthVeil の callback URL を登録してから、client を設定します。

```yaml
auth:
  mode: oidc
  oidc:
    issuer: https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0
    clientId: ${OIDC_CLIENT_ID}
    clientSecret: ${OIDC_CLIENT_SECRET}
    redirectUri: http://127.0.0.1:3080/_authveil/callback
    scopes: [openid, profile, email]
    claimMapping:
      subject: sub
      email: preferred_username
      name: name
```

Provider の登録値と `redirectUri` は完全に一致させてください。待受ポートまたは `server.controlPrefix` を変えた場合は URI も変更します。

AuthVeil は Authorization Code Flow with PKCE を使用し、state と nonce を検証します。既定の scope は `openid profile email` です。Provider 固有の scope が必要な場合だけ追加してください。

| キー                     | 必須 | 用途                                                     |
| ------------------------ | ---- | -------------------------------------------------------- |
| `auth.oidc.issuer`       | yes  | OpenID Connect discovery に使う issuer。                 |
| `auth.oidc.clientId`     | yes  | 登録済み client ID。                                     |
| `auth.oidc.clientSecret` | no   | Provider が要求する場合の secret。環境変数で参照します。 |
| `auth.oidc.redirectUri`  | yes  | 登録済み callback URL。                                  |
| `auth.oidc.scopes`       | no   | 要求する scope。                                         |
| `auth.oidc.claimMapping` | no   | subject、email、name の claim を指定する dot-path。      |

mapping しなかった ID token の claim は custom claim として保持されます。`groups` など Provider 固有の claim は正規化しません。

OIDC の待受は `127.0.0.1`、`::1`、`localhost` だけです。別のマシンから確認する場合は mock モード、または HTTPS を終端する開発環境を使用してください。

## Session と control route

| キー                   | 既定値         | 用途                                                                                 |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `auth.sessionTtl`      | `8h`           | メモリー内 session の有効期間。                                                      |
| `auth.cookie.name`     | profile による | session cookie 名。ALB は `AWSELBAuthSessionCookie-0`、その他は `authveil_session`。 |
| `auth.cookie.sameSite` | `lax`          | `lax`、`strict`、`none` のいずれか。                                                 |
| `auth.cookie.secure`   | `false`        | `Secure` を付与。ブラウザーから HTTPS で接続する場合だけ有効にします。               |

session はメモリーに保存され、AuthVeil の再起動時に失効します。`server.controlPrefix` 配下の主な route は次のとおりです。

| Route                       | 用途                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /login`                | OIDC login の開始、または mock ユーザーの選択。                                                                 |
| `GET /me`                   | 現在の Identity と logout 用 CSRF token を返します。`auth.mockUser` では token なしで固定 Identity を返します。 |
| `POST /logout`              | session を終了。token は `X-AuthVeil-CSRF` で送ります。                                                         |
| `GET /debug/headers`        | 現在の mock Identity について、mask 済みの生成予定 Header を表示します。                                        |
| `GET /health`, `GET /ready` | process の health と readiness。                                                                                |

## トラブルシューティング

| 症状                     | 確認項目                                                       |
| ------------------------ | -------------------------------------------------------------- |
| OIDC の起動に失敗する    | `issuer`、`clientId`、`redirectUri` がすべて指定されているか。 |
| callback が 400 を返す   | redirect URI が完全一致し、login 開始から 10 分以内か。        |
| claim が不足する         | Provider の ID token、要求 scope、`claimMapping` の path。     |
| 環境変数の展開に失敗する | 参照した変数が AuthVeil を起動する shell に存在するか。        |
