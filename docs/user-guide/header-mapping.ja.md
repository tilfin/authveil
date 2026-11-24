# Header mapping

[English](./header-mapping.md) | [日本語](./header-mapping.ja.md) · [ドキュメント一覧](./README.ja.md)

`generic` と `entra-app-proxy` プロファイルは Identity claim を upstream request header に変換します。各 header に `claim` が必須で、transform は任意です。

```yaml
headers:
  X-User-Id: { claim: sub }
  X-User-Groups: { claim: groups, transform: join, separator: ";" }
  X-User-Profile: { claim: profile, transform: json }
```

`sub` と `subject` は Identity の subject、`email` と `name` は標準フィールドを選択します。その他の名前は custom claim として解決され、`profile.department` のような dot notation も使えます。

| Transform        | 受け付ける値            | 結果                                     |
| ---------------- | ----------------------- | ---------------------------------------- |
| `string`（既定） | string、number、boolean | 文字列表現。                             |
| `join`           | string の配列           | `separator` で連結。既定の区切りは `,`。 |
| `json`           | 任意の JSON value       | JSON 文字列。                            |
| `prefix`         | string、number、boolean | `prefix` を先頭に追加。既定は空文字列。  |

claim が存在しないか `null` の場合は header を追加しません。型が一致しない場合は、暗黙に変換せずそのリクエストを失敗させます。Header 名は case-insensitive で、HTTP の field name として有効な文字列が必要です。AuthVeil は mapping 対象の受信値を除去してから、信頼する値を追加します。AuthVeil 自身が設定する header や message の区切りを制御する header（`Host`、`Connection`、`Upgrade`、`Content-Length`、`Transfer-Encoding`、`Forwarded`、`X-Forwarded-*`、`X-AuthVeil-Request-Id`）は mapping できません。
