# Changelog

All notable changes to TOKI are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-07

First public release.

### Added

- A screen-edge notch for Windows with one usage ring per provider, on any of the
  four edges, pinned to the work area.
- **Claude Code** provider, reading the OAuth token Claude Code keeps in its
  config directory against the same endpoint its own `/usage` command uses. One
  ring per Claude profile, so a `CLAUDE_CONFIG_DIR` work login gets its own.
- **Codex** provider, asked live first with the token Codex already holds, and
  falling back to the rate-limit snapshots in its rollout log.
- **Cursor** provider, reading the editor's own signed-in session from its
  `state.vscdb`.
- **GLM** provider, using Z.ai's coding-plan endpoint with a key borrowed from
  Claude Code, ZCode or OpenCode.
- Three credential modes per provider (borrow, sign in to TOKI, API key), with
  only the modes a provider genuinely supports offered, and Automatic preferring
  the one that needs no setup.
- API keys encrypted with Windows DPAPI through Electron's `safeStorage`, storing
  nothing at all when the OS will not encrypt.
- Live activity: a spinning arc while an agent is working and a pulsing amber
  ring when one is waiting on you, with every live session listed by name and
  location.
- One-click install of Claude Code `SessionStart`, `PreToolUse`, `Notification`
  and `Stop` hooks, preserving any hooks already present and restoring the file
  on removal.
- Desktop notification on the transition into waiting: once per question, never
  for a session that was already waiting at launch.
- Thirty-six themes across six groups, plus a custom theme builder that previews
  live on the real interface. Every theme is tested for contrast, band
  distinguishability and panel opacity.
- Tray icon with Settings and **Refresh now**.
- Demo mode as a separate flag from every provider switch, so sample data can
  never be mistaken for consent to read a real credential.
- Visible status for every failure (`stale`, `needsAuth`, `accessDenied`,
  `unsupported`, `error`), keeping the last good reading with its age rather than
  inventing a number.
- Persisted rate-limit back-off: 60 seconds doubling per consecutive 429, capped
  at 15 minutes, surviving a relaunch.

[1.0.0]: https://github.com/mrcrapto/toki/releases/tag/v1.0.0
