# Contributing

Thanks for looking. TOKI is small and opinionated, so this file explains the
opinions before you spend time on a change that will not land.

## Getting set up

```sh
git clone https://github.com/mrcrapto/toki.git
cd toki
npm install
npm run demo      # the UI on fixed sample data, no provider is read
npm test
npm run typecheck
```

Node 20 or newer. Windows, because the app is Windows only. The tests are pure
and run anywhere, but the app itself will not do anything useful elsewhere.

Use `npm run demo` for any UI work. It short-circuits every provider read, so you
can develop the interface without pointing it at a real account.

## The rules this codebase holds itself to

These are not style preferences. A change that breaks one of them will be asked
to change.

**Never invent a number.** If a read fails, the status becomes visible and the
last good reading keeps its age. A percentage on screen must always be traceable
to something a provider actually said.

**The UI learns nothing about providers.** Everything about where a credential
lives, what a response looks like, and how stale it is stops at the adapter
boundary. The renderer gets `DashboardState` and nothing else.

**Only offer what can work.** A provider declares which credential modes it
genuinely supports, and the UI shows only those. A field that cannot work is
worse than no field.

**No signal is not idle.** A monitor that reports nothing becomes `unavailable`,
never `idle`.

**A disabled provider is never touched.** No file read, no request, ever.

**Parsers are separate from I/O.** Response shapes are pinned by tests against
payloads recorded from real runs, not against a live account.

## Adding a provider

1. Implement `UsageProvider` in `src/main/providers/`.
2. Declare `support` honestly: only the modes that can actually produce a reading.
3. Declare `fidelity`. Use `official` only when the vendor's own tool reads the
   same source. Anything you compute yourself is `derived` and is shown with a
   `~`.
4. Put the response parsing in its own pure module and pin it with a test against
   a recorded payload, with any account identifiers scrubbed.
5. Map every failure onto a `UsageErrorKind`. Reach for `needsAuth` and
   `accessDenied` precisely; they send the user to different fixes.

## Adding a theme

Add it to `src/shared/themes.ts` and run `npm test`. The theme tests will reject
it unless it clears at least 7:1 text contrast, keeps the usage bands
distinguishable, keeps the accent visible on the panel, has a mood matching its
luminance, and has a panel alpha of at least 0.95.

## Pull requests

- One concern per pull request.
- `npm test` and `npm run typecheck` must pass.
- Add a test for anything that could regress silently, especially geometry,
  parsing and copy.
- Explain the *why* in the description. This codebase comments the reasoning
  rather than the mechanics, and the same is expected of changes to it.

## Reporting a bug

Open an issue with your Windows version, the TOKI version, which providers are
switched on, and the relevant lines from `%APPDATA%\TOKI\toki.log`. Read the log
before pasting it: it contains no credentials, but it does contain paths from
your profile and session names.

Security issues go through [SECURITY.md](SECURITY.md), not the issue tracker.
