# 設定リファレンス

[English](./configuration.md) | [日本語](./configuration.ja.md) · [ドキュメント一覧](./README.ja.md)

AuthVeil は YAML 設定ファイルを読み込みます。このページでは全 Identity Proxy に共通する設定だけを説明します。認証の設定は [認証モード](./auth-modes.ja.md)、プロバイダー固有の設定は各 [プロファイルページ](./README.ja.md#identity-proxy-プロファイル) を参照してください。

未定義のキーはエラーになります。起動前に設定を検証できます。

```bash
docker run --rm \
  -v "$PWD/authveil.config.yaml:/app/authveil.config.yaml:ro" \
  ghcr.io/tilfin/authveil:latest validate
```

## 設定ファイルの検索と上書き

次の順で最初に見つかった設定を使います。

1. `--config PATH`
2. `AUTHVEIL_CONFIG`
3. カレントディレクトリの `authveil.config.yaml`
4. カレントディレクトリの `authveil.config.yml`

`--config` と `AUTHVEIL_CONFIG` のパスは container のカレントディレクトリ（公開イメージでは `/app`）から解決します。追加の設定ファイルは container に mount し、container 内のパスを指定してください。対応する環境変数は次の4つだけです。

| 環境変数            | 用途                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `AUTHVEIL_CONFIG`   | 読み込む YAML を選択します。ファイル内の設定値は上書きしません。 |
| `AUTHVEIL_HOST`     | `server.host` を上書きします。                                   |
| `AUTHVEIL_PORT`     | `server.port` を上書きします。                                   |
| `AUTHVEIL_UPSTREAM` | `upstream.url` を上書きします。                                  |

認証、Identity Proxy、logging の設定は YAML に記述してください。

YAML の任意の文字列で `${NAME}` を使うと環境変数を参照できます。名前は `[A-Z_][A-Z0-9_]*` に一致する必要があり、値が未設定の場合は読み込みに失敗します。この展開では任意の環境変数を参照でき、上記4つの環境変数による直接設定とは別の機能です。

参照する環境変数は Docker の `--env` または `--env-file` option で container に渡してください。ホスト shell の環境変数は自動的には引き継がれません。

```yaml
upstream:
  url: ${UPSTREAM_URL}

auth:
  oidc:
    clientSecret: ${OIDC_CLIENT_SECRET}
```

## Server と upstream

必須のトップレベル設定は `upstream.url` だけです。

| キー                      | 型          | 既定値       | 用途                                                     |
| ------------------------- | ----------- | ------------ | -------------------------------------------------------- |
| `server.host`             | string      | `127.0.0.1`  | 待受アドレス。                                           |
| `server.port`             | integer     | `3080`       | 待受ポート。`0` なら OS が空きポートを選びます。         |
| `server.controlPrefix`    | path        | `/_authveil` | login、callback、session、health、JWKS route の prefix。 |
| `upstream.url`            | HTTP(S) URL | 必須         | リクエストの転送先として固定する origin。                |
| `upstream.requestTimeout` | duration    | `0`          | upstream の timeout。`0` は無効です。                    |

`server.controlPrefix` の末尾 `/` は削除されます。OIDC モードでは loopback アドレス以外を指定できません。

## プロファイルの選択

アプリケーションの環境に合わせて `identityProxy.type` を選びます。

| Type              | 設定                                                       |
| ----------------- | ---------------------------------------------------------- |
| `alb`             | [AWS ALB](./aws-alb.ja.md)                                 |
| `iap`             | [Google Cloud IAP](./google-cloud-iap.ja.md)               |
| `entra-app-proxy` | [Entra Application Proxy](./entra-application-proxy.ja.md) |
| `generic`         | [任意の Header](./generic.ja.md#generic-プロファイル)      |
| `none`            | [Identity Header なし](./generic.ja.md#none-プロファイル)  |

省略時は `none` です。AuthVeil は組み込みまたは設定済みの Identity Header と、クライアントから届いた forwarding metadata を破棄してから upstream リクエストを組み立てます。

## 署名鍵

ALB と IAP のトークンは ES256 を使用します。永続化する場合は、どちらか一方の鍵ソースを指定します。

```yaml
keys:
  privateKeyFile: .authveil/private-key.pem
  # kid: optional-key-id
```

| キー                  | 用途                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `keys.algorithm`      | `ES256` だけを指定でき、既定値も `ES256` です。                   |
| `keys.privateKey`     | インラインの PKCS#8 PEM または private JWK 文字列。               |
| `keys.privateKeyFile` | PEM または private JWK ファイル。設定ファイルからの相対パスです。 |
| `keys.kid`            | JWT の key ID。省略時は公開鍵から生成します。                     |

`privateKey` と `privateKeyFile` は同時に指定できません。`privateKeyFile` が存在しなければ、親ディレクトリと新しい PKCS#8 鍵を作成し、permission を `0600` にします。どちらも省略すると、プロセスごとに一時鍵を生成します。

```bash
mkdir -p .authveil
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD/.authveil:/keys" \
  ghcr.io/tilfin/authveil:latest \
  keys generate --out /keys/private-key.pem

docker run --rm \
  -v "$PWD:/config:ro" \
  ghcr.io/tilfin/authveil:latest \
  keys show --config /config/authveil.config.yaml
```

最初のコマンドではホストユーザーの UID / GID を使うため、生成した鍵をそのユーザーが引き続き更新できます。`privateKeyFile: .authveil/private-key.pem` の場合、ディレクトリ全体を `/config` に mount すると `/config/authveil.config.yaml` からの相対パスで鍵を解決できます。

公開 JWKS は `/_authveil/.well-known/jwks.json` で取得できます。

## Logging

| キー             | 型                                                                       | 既定値 | 用途                                                                    |
| ---------------- | ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------- |
| `logging.level`  | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent` | `info` | 最小 log level。                                                        |
| `logging.format` | `json` \| `pretty`                                                       | `json` | 出力形式の設定値。現在の runtime logging は Pino の JSON を使用します。 |

duration はミリ秒の数値、または `ms`、`s`、`m`、`h`、`d` で終わる文字列で指定します。
