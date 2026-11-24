# AuthVeil

[English](./README.md) | [日本語](./README.ja.md)

クラウドの ID プロキシ配下で動くアプリケーションを、そのままローカルで開発できます。

AuthVeil は開発専用のリバースプロキシです。ローカルの Identity Token に署名し、AWS Application Load Balancer（ALB）、Google Cloud Identity-Aware Proxy（IAP）、Microsoft Entra Application Proxy、または独自のヘッダーベースプロキシからアプリケーションが受け取るリクエストを再現します。

> [!WARNING]
> AuthVeil は本番環境の認証境界ではありません。ユーザー、セッション、署名鍵はローカル開発専用です。

## 対応プロファイル

| プロファイル                                                               | 再現する内容                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [AWS ALB](./docs/user-guide/aws-alb.ja.md)                                 | `x-amzn-oidc-*` ヘッダーとローカル署名の ES256 トークン           |
| [Google Cloud IAP](./docs/user-guide/google-cloud-iap.ja.md)               | IAP JWT assertion と namespace 付きユーザーヘッダー               |
| [Entra Application Proxy](./docs/user-guide/entra-application-proxy.ja.md) | 任意の SSO ヘッダーとレスポンス URL の変換                        |
| [Generic / none](./docs/user-guide/generic.ja.md)                          | claim から任意ヘッダーへの変換、または Identity Header なしの転送 |

Identity はローカルの mock ユーザー、または外部の OpenID Connect Provider から取得します。選択したプロファイルが、その Identity を upstream アプリケーションの期待するヘッダーへ変換します。

## 必要環境

- Docker
- upstream として利用する HTTP または HTTPS アプリケーション

## クイックスタート

次の設定例をコピーして `authveil.config.yaml` を作成します。

```yaml
server:
  host: 0.0.0.0

upstream:
  url: http://host.docker.internal:8080

auth:
  mode: mock
  mockUser: developer

mockUsers:
  - id: developer
    subject: local-developer-001
    email: developer@example.test
    claims:
      groups: [developers]

identityProxy:
  type: alb
```

アプリケーションをポート `8080` で起動してから、公開済みイメージを実行します。

```bash
docker run --rm --init \
  -p 127.0.0.1:3080:3080 \
  --add-host host.docker.internal:host-gateway \
  -v "$PWD/authveil.config.yaml:/app/authveil.config.yaml:ro" \
  ghcr.io/tilfin/authveil:latest
```

<http://127.0.0.1:3080> を開くと、ALB の Identity が付いたリクエストが upstream に転送されます。アプリケーションが利用するプロファイルに `identityProxy` を変更してください。各プロファイルのページに最小設定があります。

Docker Desktop では `host.docker.internal` を標準で利用できます。Linux では `--add-host` がこの名前を追加します。公開ポートを `127.0.0.1` に bind することで、開発専用 proxy へのアクセスをローカルマシン内に限定します。

## Docker Compose

AuthVeil だけを container で動かす場合と、アプリケーションも同じ Compose project で動かす場合では、`upstream` の指定先が異なります。以下の例は、クイックスタートで作成した `authveil.config.yaml` を使用し、`AUTHVEIL_UPSTREAM` で `upstream.url` を上書きします。

### AuthVeil は container、アプリケーションはホストで動かす

ホスト上のアプリケーションをポート `8080` で起動し、次の内容を `compose.yaml` に保存します。

```yaml
services:
  proxy:
    image: ghcr.io/tilfin/authveil:latest
    init: true
    ports:
      - "127.0.0.1:3080:3080"
    volumes:
      - ./authveil.config.yaml:/app/authveil.config.yaml:ro
    environment:
      AUTHVEIL_UPSTREAM: http://host.docker.internal:8080
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

```bash
docker compose up
```

`extra_hosts` は Linux の Docker Engine でも container からホストを `host.docker.internal` で参照できるようにします。

### AuthVeil とアプリケーションをともに container で動かす

同じ Compose project の service は service 名で名前解決できます。以下では AuthVeil が `http://app:3000` へ転送します。

```yaml
services:
  proxy:
    image: ghcr.io/tilfin/authveil:latest
    init: true
    ports:
      - "127.0.0.1:3080:3080"
    volumes:
      - ./authveil.config.yaml:/app/authveil.config.yaml:ro
    environment:
      AUTHVEIL_UPSTREAM: http://app:3000
    depends_on:
      - app

  app:
    build: .
    ports:
      - "127.0.0.1:30080:3000"
```

```bash
docker compose up --build
```

AuthVeil からアプリケーションへの接続には container 側のポート `3000` を使います。`app` の `ports` はホストからアプリケーションへ直接アクセスして確認するための設定なので、不要であれば省略できます。どちらの構成でも、AuthVeil には <http://127.0.0.1:3080> でアクセスします。

## コマンド

AuthVeil のコマンドはイメージ名の後ろに指定します。たとえば、マウントした設定を検証するには次を実行します。

```bash
docker run --rm \
  -v "$PWD/authveil.config.yaml:/app/authveil.config.yaml:ro" \
  ghcr.io/tilfin/authveil:latest validate
```

指定できるコマンド引数は次のとおりです。

```text
start [--config PATH]
validate [--config PATH]
users [--config PATH]
keys generate [--out PATH] [--force]
keys show [--config PATH]
version
--help
```

イメージ名の後ろにコマンドを指定しない場合や、`--config` などのオプションから始まる場合は `start` を実行します。

## ドキュメント

- [ユーザーガイド](./docs/user-guide/README.ja.md)
- [設定リファレンス](./docs/user-guide/configuration.ja.md)
- [Mock / OIDC 認証](./docs/user-guide/auth-modes.ja.md)
- [開発ドキュメント](./docs/development/README.ja.md)

## セキュリティモデル

AuthVeil は組み込みまたは設定済みの Identity Header、forwarding metadata、proxy authentication header を除去してから、信頼するローカル値を生成します。upstream は起動時に固定され、session cookie には推測困難な ID だけを使います。ローカルで発行した token は AuthVeil の JWKS で検証し、AWS や Google の本番鍵では検証しないでください。

[Apache License 2.0](./LICENSE) で提供しています。
