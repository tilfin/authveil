# AuthVeil user guide

[English](./README.md) | [日本語](./README.ja.md) · [Documentation](../README.md) · [Project README](../../README.md)

Start with the page that matches the identity proxy used by your application. You do not need to read the other provider guides.

The user guide assumes AuthVeil runs from `ghcr.io/tilfin/authveil:latest`. Follow the [Docker quick start](../../README.md#quick-start) first; all AuthVeil command examples here invoke that image with `docker run`.

## Setup

- [Configuration reference](./configuration.md) — file loading, common settings, keys, and validation
- [Authentication modes](./auth-modes.md) — local mock users and external OIDC login

## Identity-proxy profiles

- [AWS Application Load Balancer](./aws-alb.md)
- [Google Cloud Identity-Aware Proxy](./google-cloud-iap.md)
- [Microsoft Entra Application Proxy](./entra-application-proxy.md)
- [Generic headers and no-identity forwarding](./generic.md)

## Reference

- [Header mapping](./header-mapping.md) — shared claim transforms for generic and Entra profiles
