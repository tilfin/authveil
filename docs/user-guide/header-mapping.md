# Header mapping

[English](./header-mapping.md) | [日本語](./header-mapping.ja.md) · [Documentation](./README.md)

The `generic` and `entra-app-proxy` profiles map identity claims to upstream request headers. Each header needs a `claim`; a transform is optional.

```yaml
headers:
  X-User-Id: { claim: sub }
  X-User-Groups: { claim: groups, transform: join, separator: ";" }
  X-User-Profile: { claim: profile, transform: json }
```

`sub` and `subject` select the identity subject. `email` and `name` select the standard fields. Other names resolve custom claims and support dot notation such as `profile.department`.

| Transform          | Accepted value             | Result                                                      |
| ------------------ | -------------------------- | ----------------------------------------------------------- |
| `string` (default) | string, number, or boolean | Text representation.                                        |
| `join`             | array of strings           | Joined with `separator`, which defaults to `,`.             |
| `json`             | any JSON value             | JSON-encoded text.                                          |
| `prefix`           | string, number, or boolean | Text with `prefix` prepended; the prefix defaults to empty. |

A missing or `null` claim omits the header. A value of the wrong type fails that request instead of silently changing its shape. Header names are case-insensitive and must be valid HTTP field names; AuthVeil removes incoming values for every mapped name before adding trusted values. Headers that AuthVeil sets or that control message framing (`Host`, `Connection`, `Upgrade`, `Content-Length`, `Transfer-Encoding`, `Forwarded`, `X-Forwarded-*`, and `X-AuthVeil-Request-Id`) cannot be mapped.
