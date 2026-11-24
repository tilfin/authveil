# Configuration reference

[English](./configuration.md) | [日本語](./configuration.ja.md) · [Documentation](./README.md)

AuthVeil reads a YAML configuration file. This page covers settings shared by every identity-proxy profile. Authentication settings are documented under [Authentication modes](./auth-modes.md); provider-specific settings live on the corresponding [profile page](./README.md#identity-proxy-profiles).

Unknown keys are rejected. Run this before starting the proxy:

```bash
docker run --rm \
  -v "$PWD/authveil.config.yaml:/app/authveil.config.yaml:ro" \
  ghcr.io/tilfin/authveil:latest validate
```

## File lookup and overrides

AuthVeil uses the first configuration found:

1. `--config PATH`
2. `AUTHVEIL_CONFIG`
3. `authveil.config.yaml` in the current directory
4. `authveil.config.yml` in the current directory

`--config` and `AUTHVEIL_CONFIG` paths are resolved from the container's current working directory (`/app` in the published image). Mount additional configuration files into the container and use their container paths. Only the following environment variables are supported:

| Environment variable | Purpose                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `AUTHVEIL_CONFIG`    | Select the YAML file. It does not override a setting inside the file. |
| `AUTHVEIL_HOST`      | Override `server.host`.                                               |
| `AUTHVEIL_PORT`      | Override `server.port`.                                               |
| `AUTHVEIL_UPSTREAM`  | Override `upstream.url`.                                              |

Authentication, identity-proxy, and logging settings must be declared in YAML.

Use `${NAME}` in any YAML string to read an environment variable. A name must match `[A-Z_][A-Z0-9_]*`; an unset variable stops configuration loading. This interpolation can reference any environment variable and is separate from the four variables above.

References are expanded after the YAML is parsed, so a value is inserted literally and cannot change the document structure, and references inside comments are ignored. An unquoted value that is exactly one reference, such as `port: ${PORT}`, becomes a number or boolean when the variable holds one; quote it to keep a string.

Pass referenced variables into the container with Docker's `--env` or `--env-file` option; host shell variables are not inherited automatically.

```yaml
upstream:
  url: ${UPSTREAM_URL}

auth:
  oidc:
    clientSecret: ${OIDC_CLIENT_SECRET}
```

## Server and upstream

`upstream.url` is the only required top-level value.

| Key                       | Type        | Default      | Purpose                                                       |
| ------------------------- | ----------- | ------------ | ------------------------------------------------------------- |
| `server.host`             | string      | `127.0.0.1`  | Listen address.                                               |
| `server.port`             | integer     | `3080`       | Listen port; `0` asks the OS for a free port.                 |
| `server.controlPrefix`    | path        | `/_authveil` | Prefix for login, callback, session, health, and JWKS routes. |
| `upstream.url`            | HTTP(S) URL | required     | Fixed origin receiving proxied requests.                      |
| `upstream.requestTimeout` | duration    | `0`          | Upstream timeout; `0` disables it.                            |

A trailing slash is removed from `server.controlPrefix`. OIDC mode only accepts a loopback listen address.

## Select a profile

Set `identityProxy.type` to the environment your application expects:

| Type              | Configuration                                           |
| ----------------- | ------------------------------------------------------- |
| `alb`             | [AWS ALB](./aws-alb.md)                                 |
| `iap`             | [Google Cloud IAP](./google-cloud-iap.md)               |
| `entra-app-proxy` | [Entra Application Proxy](./entra-application-proxy.md) |
| `generic`         | [Custom headers](./generic.md#generic-profile)          |
| `none`            | [No identity headers](./generic.md#none-profile)        |

If omitted, the profile is `none`. AuthVeil discards built-in and configured identity headers plus client-supplied forwarding metadata before constructing the upstream request.

If the generated identity headers are larger than the Node.js HTTP header limit (16 KiB by default), for example because of a very large `groups` claim, AuthVeil answers `431` with `AUTHVEIL_HEADER_TOO_LARGE` instead of forwarding the request.

## Signing keys

ALB and IAP tokens use ES256. Choose one persistent-key source:

```yaml
keys:
  privateKeyFile: .authveil/private-key.pem
  # kid: optional-key-id
```

| Key                   | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `keys.algorithm`      | Only `ES256` is accepted; it is also the default.            |
| `keys.privateKey`     | Inline PKCS#8 PEM or private JWK string.                     |
| `keys.privateKeyFile` | PEM or private-JWK path, relative to the configuration file. |
| `keys.kid`            | JWT key ID. By default it is derived from the public key.    |

`privateKey` and `privateKeyFile` are mutually exclusive. If `privateKeyFile` does not exist, AuthVeil creates its parent directories and writes a new PKCS#8 key with mode `0600`. Without either setting, each process gets a new ephemeral key.

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

The first command uses the host user's UID and GID so the generated key remains writable by that user. With `privateKeyFile: .authveil/private-key.pem`, mounting the whole directory at `/config` lets AuthVeil resolve the key relative to `/config/authveil.config.yaml`.

The public JWKS is served at `/_authveil/.well-known/jwks.json`.

## Logging

| Key              | Type                                                                     | Default | Purpose                                                                   |
| ---------------- | ------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| `logging.level`  | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent` | `info`  | Minimum log level.                                                        |
| `logging.format` | `json` \| `pretty`                                                       | `json`  | Accepted output format setting; runtime logging currently uses Pino JSON. |

Durations accept milliseconds as a number, or a string ending in `ms`, `s`, `m`, `h`, or `d`.
