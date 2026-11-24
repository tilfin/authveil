# AuthVeil

[English](./README.md) | [日本語](./README.ja.md)

Run applications that normally sit behind a cloud identity proxy on your local machine.

AuthVeil is a development-only reverse proxy. It signs local identity tokens and reproduces the request shape your application receives from AWS Application Load Balancer (ALB), Google Cloud Identity-Aware Proxy (IAP), Microsoft Entra Application Proxy, or a custom header-based proxy.

> [!WARNING]
> AuthVeil is not a production authentication boundary. Its users, sessions, and signing keys are intended for local development only.

## Supported profiles

| Profile                                                                 | What AuthVeil reproduces                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [AWS ALB](./docs/user-guide/aws-alb.md)                                 | `x-amzn-oidc-*` headers and locally signed ES256 tokens                |
| [Google Cloud IAP](./docs/user-guide/google-cloud-iap.md)               | IAP JWT assertion and namespaced user headers                          |
| [Entra Application Proxy](./docs/user-guide/entra-application-proxy.md) | Configurable SSO headers and response URL translation                  |
| [Generic / none](./docs/user-guide/generic.md)                          | Custom claim-to-header mapping, or forwarding without identity headers |

AuthVeil can source the identity from local mock users or an external OpenID Connect provider. The selected profile then converts that identity into the headers expected by your upstream application.

## Requirements

- Docker
- An HTTP or HTTPS application to use as the upstream

## Quick start

Copy the following example into `authveil.config.yaml`:

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

Start your application on port `8080`, then run the published image:

```bash
docker run --rm --init \
  -p 127.0.0.1:3080:3080 \
  --add-host host.docker.internal:host-gateway \
  -v "$PWD/authveil.config.yaml:/app/authveil.config.yaml:ro" \
  ghcr.io/tilfin/authveil:latest
```

Open <http://127.0.0.1:3080>. AuthVeil forwards each request to the upstream with a generated ALB identity. Change `identityProxy` to the profile your application expects; each profile page contains its minimum configuration.

`host.docker.internal` is available by default in Docker Desktop. The `--add-host` option supplies it on Linux. Binding the published port to `127.0.0.1` keeps this development-only proxy local to your machine.

## Docker Compose

The `upstream` address differs depending on whether only AuthVeil runs in a container or the application joins the same Compose project. Both examples below use the `authveil.config.yaml` from the quick start and override `upstream.url` with `AUTHVEIL_UPSTREAM`.

### AuthVeil in a container, application on the host

Start the application on host port `8080`, then save the following as `compose.yaml`:

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

`extra_hosts` makes the host available as `host.docker.internal` from the container when using Docker Engine on Linux as well.

### AuthVeil and the application both in containers

Services in the same Compose project can resolve one another by service name. In this example, AuthVeil forwards to `http://app:3000`:

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

AuthVeil connects to the application's container port `3000`. The `app` port mapping is only useful for testing the application directly from the host and can be omitted when it is not needed. In either setup, access AuthVeil at <http://127.0.0.1:3080>.

## Commands

AuthVeil commands are passed after the image name. For example, validate the mounted configuration with:

```bash
docker run --rm \
  -v "$PWD/authveil.config.yaml:/app/authveil.config.yaml:ro" \
  ghcr.io/tilfin/authveil:latest validate
```

The available command arguments are:

```text
start [--config PATH]
validate [--config PATH]
users [--config PATH]
keys generate [--out PATH] [--force]
keys show [--config PATH]
version
--help
```

With no command after the image name, or when the arguments begin with an option such as `--config`, AuthVeil runs `start`.

## Documentation

- [User guide](./docs/user-guide/README.md)
- [Configuration reference](./docs/user-guide/configuration.md)
- [Mock and OIDC authentication](./docs/user-guide/auth-modes.md)
- [Development documentation](./docs/development/README.md)

## Security model

AuthVeil removes built-in and configured identity headers, forwarding metadata, and proxy-authentication headers before generating trusted local values. It uses a fixed upstream and opaque in-memory sessions. Locally issued tokens must be verified with AuthVeil's JWKS, never with AWS or Google production keys.

Licensed under the [Apache License 2.0](./LICENSE).
