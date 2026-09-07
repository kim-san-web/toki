# Security

TOKI reads credentials that belong to other applications. That makes its
handling of them the most security-relevant thing about it, so this file states
exactly what it does.

## What TOKI touches

| Path | When | Access |
|---|---|---|
| `<claude config dir>/.credentials.json` | Only inside an enabled Claude provider's own fetch | read |
| `~/.codex/state_5.sqlite` and the rollout log it points at | Only inside an enabled Codex provider's own fetch | read, `query_only` |
| `%APPDATA%\Cursor\User\globalStorage\state.vscdb` | Only inside an enabled Cursor provider's own fetch | read, `query_only` |
| `~/.claude/settings.json`, `~/.zcode/config.json`, OpenCode config | Only inside an enabled GLM provider's own fetch, looking for a key | read |
| `~/.claude/settings.json` | Only when you click **Install hooks** | read and write, existing hooks preserved |
| `%APPDATA%\TOKI\` | Always | TOKI's own settings, cache, encrypted secrets and log |

Every one of those reads happens only while the owning provider is switched on.
A fresh install has every provider off, so it reads nothing at all.

## Guarantees

- **Borrowed credentials are never copied.** They are read, used for one request,
  and dropped. They are never written to TOKI's state directory and never written
  to the log.
- **Borrowed tokens are never refreshed.** Minting a new one would mean writing a
  credential this app does not own and racing its owner for it.
- **SQLite stores are opened read-only** with `query_only` and no extensions.
  They are deliberately not opened with `immutable=1`: Cursor and Codex run in
  WAL mode, and `immutable` tells SQLite to ignore the write-ahead log, which is
  how you end up serving a token the editor has already rotated.
- **Endpoints are pinned by host and redirects are refused**, so a borrowed token
  cannot be carried off the host it was issued for.
- **Pasted API keys are encrypted with Windows DPAPI** through Electron's
  `safeStorage`, scoped to the logged-in Windows account. If the OS will not
  encrypt, TOKI stores nothing rather than falling back to plaintext.
- **The renderer has no Node access.** It receives whole `DashboardState`
  snapshots over a fixed, named IPC surface and cannot read a credential even in
  principle.
- **No telemetry, no analytics, no TOKI server.** The only network requests are
  each enabled provider's own request to its own vendor.

## The log

`%APPDATA%\TOKI\toki.log` records status transitions, errors and timings. It does
not contain tokens, keys or request bodies. It does contain file paths from your
profile and session names, so read it before pasting it into an issue.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting on this repository:
**Security > Report a vulnerability**. If that is unavailable, open an issue
saying only that you have a security report and asking for a contact, with no
details.

Please include the version, what you observed, and the steps to reproduce it.
You will get an acknowledgement, and a fix or an explanation of why it is not one.

## Scope

TOKI is a local desktop application with no server, no accounts and no
multi-tenancy. The interesting attack surface is:

- anything that would cause a credential to be written somewhere it should not be
- anything that would cause a credential to be sent to a host it was not issued for
- anything that would let another local process read a secret out of TOKI's store
- anything in the hook installer that damages a user's existing Claude Code hooks

Reports in those areas are especially welcome.
