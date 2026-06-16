# Mokei MCP host

## Installation

```sh
npm install @mokei/host
```

## Security

The daemon control socket exposes a `spawn` channel that runs arbitrary
commands. Its trust boundary is the local OS user: the socket is `chmod 0600`
after listen, so only the owner can drive it. The daemon itself does not
authenticate connections — do not relax the socket permissions or expose the
socket to other users.

The monitor UI server binds `127.0.0.1` by default and gates every `/api`
request with a Host-header allowlist (DNS-rebinding defense) plus a per-start
bearer token (CSRF defense). The `--host` opt-in for remote binding still
requires the token; exposing the spawn channel beyond localhost is at the
operator's risk.

## [Documentation](https://mokei.dev)