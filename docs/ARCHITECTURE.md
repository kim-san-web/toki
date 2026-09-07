# TOKI architecture

## The one rule

The UI never learns how Claude, Cursor or Codex work. It renders
`DashboardState` snapshots and nothing else. Every fact about a provider -- where
its credential lives, what its response looks like, how stale its numbers are --
stops at the adapter boundary.

## Layers

```
src/shared/      domain model + copy    pure, tested, imported by both sides
src/main/        providers, store, windows, activity
src/preload/     the fixed IPC surface  the security boundary
src/renderer/    notch + settings       React, no Node access
```

### `src/shared`

`types.ts` is the IPC contract. Everything in it survives `structuredClone`:
dates are epoch milliseconds, unions are tagged plain objects.

`copy.ts` holds every user-facing string about time or numbers. It is pure, so
the *wording* is testable without a window -- which matters, because most of the
honesty in this app is in its wording. `windowSummary` shows both ends of the
same figure ("73% used - 27% left") because vendors disagree about which end to
report, and a notch that picks one leaves the reader converting in their head.

`bands.ts` decides the colour of a ring and, critically, `headline()`: the
window a ring means is *declared by the provider*, never "whichever came first".
Without that, a window dropping out of a response silently promotes another one
-- the ring keeps its shape and quietly changes its subject.

### `src/main/providers`

Each adapter answers one question: what does this tool's own state say about my
limits? It may throw `UsageError`, and the kinds are deliberately fine-grained
because they call for different advice:

- `needsAuth` -- no credential; sign in to the owning tool
- `accessDenied` -- the credential is there and we were refused it. Telling
  someone to sign in, when they are signed in and merely lack permission, sends
  them to fix the wrong thing
- `credentialExpired` -- there but stale; the owner refreshes it next run, so the
  last reading is still true and TOKI keeps showing it with its age
- `nothingMetered` -- readable, and genuinely nothing is being counted. Not an
  error and must not look like one
- `rateLimited` -- with the server's hint, honoured only as a floor-raiser

Parsers are separated from I/O (`claude-usage.ts`, `codex-usage.ts`,
`cursor-usage.ts`) so response shapes can be pinned by tests against payloads
recorded from real runs rather than against a live account.

### `src/main/usage-store.ts`

Polls, caches, persists. Three invariants:

1. A disabled provider is never touched -- no file read, no request.
2. Every failure degrades to a visible status, keeping the last good reading and
   saying how old it is.
3. A refresh in flight when settings change is abandoned **by generation**, so
   an answer for the old configuration cannot overwrite the new one. Concurrent
   callers share one sweep rather than starting competing ones.

### `src/main/activity`

Monitors report *sessions*; reducing them to a state is `summarise`'s job, so
"waiting outranks busy" is decided in exactly one place. Sessions expire --
`busy` after 3 minutes, `waiting` after 30 -- because these are events, not
state: a tool killed mid-turn never sends its "finished" event, and without an
expiry the notch shows it working forever.

`null` sessions mean *no signal* and become `unavailable`, never `idle`.

The Claude hook CLI (`assets/hook/toki-hook.mjs`) runs inside the user's own
turn, so it never exits non-zero, never writes to stderr, and never blocks on
stdin for long. It writes one small file per session, replaced atomically --
several hooks fire at once, and a shared append-only log would interleave into
something unreadable.

### Geometry

`geometry.ts` is the only file that knows what a screen edge is. Everything
above it works in `along`/`across`, which is what keeps one stylesheet and one
layout honest across four placements instead of forking into four versions.

## Windows-specific decisions

- **`node:sqlite`, opened read-only, `query_only`, no extensions.** Not
  `immutable=1`: Cursor and Codex run WAL, and `immutable` tells SQLite to
  ignore the write-ahead log -- so it returns whatever was true at the last
  checkpoint, which is how you serve a token the editor has already rotated.
- **Atomic writes into the same directory.** Rename is only atomic within a
  volume, and `%TEMP%` is frequently on a different one.
- **Click-through by default.** The notch window is transparent and covers a
  strip of the screen; it accepts the mouse only once the renderer says
  something is drawn under the pointer.
- **Near-opaque panels.** `backdrop-filter` does not blur the desktop behind a
  transparent Electron window on Windows, so translucency is just
  see-through. Legibility comes from alpha; the blur is enhancement only.
- **The preload compiles to `.cjs` in its own scratch directory.** The package
  is ESM, so a `.js` preload fails at `require` and silently leaves the renderer
  with no `window.toki`; and because it type-imports `src/shared`, emitting
  beside the main build would overwrite the ESM `dist/shared` with CommonJS.


## Credentials

`UsageProvider.support` declares which of three modes a provider can genuinely
offer, and `modeOrder` turns the user's choice into an ordered list to try:

- **borrow** -- read what a tool on this PC already holds. Nothing is stored.
- **oauth** -- TOKI signs in itself, so the resulting token is TOKI's to refresh.
  A borrowed token is never refreshed here: minting one would mean writing a
  credential this app does not own and racing its owner for it.
- **apiKey** -- a value the user pastes, encrypted by the OS.

`auto` prefers borrowing because it needs no setup; an explicit mode is honoured
exactly, so someone who chose "API key" is never silently served a borrowed
reading from a different account.

The mode that exists because reality demanded it is **oauth**. Claude Code on
Windows can write `.credentials.json` with empty token strings and
`expiresAt: 0`. The adapter treats that as *nothing to borrow* and falls through
rather than reporting a sign-in failure -- a failure the user cannot fix by
signing in, because they already are.

`SecretStore` wraps Electron's `safeStorage` (DPAPI on Windows, scoped to the
logged-in account). When the OS will not encrypt, it stores **nothing** rather
than falling back to plaintext. The OS primitive is injected as a `Crypto`
interface so the store is testable without a running Electron app.

## Notifications

`Notifier` fires only on the *transition* into `waiting`, once per session, and
never for a session that was already waiting when TOKI started -- that alert
would be about something that happened before it was watching. It is driven from
the single place that sees the whole settled state, so a session cannot be
announced from a half-applied update.

`shared/routes.ts` holds where each question can be answered, as pure data. A
provider with no protocol that focuses it reports `null` rather than a made-up
scheme, because a button that silently does nothing is worse than no button.

## Themes

`shared/themes.ts` is data only. `paletteToCssVars` maps a palette onto the same
custom properties the stylesheets already use, so switching theme is a variable
swap rather than a re-render -- nothing in the layout knows themes exist.

Every theme is checked by `themes.test.ts` for at least 7:1 text contrast,
distinguishable usage bands, an accent visible on the panel, a mood that matches
its luminance, and -- the one that is easy to get wrong -- a panel alpha of at
least 0.95. Custom themes derive the translucent surfaces from the solid one for
that same reason, so a user cannot build a see-through notch.

## Why the notch never resizes on hover

`windowSize` takes the edge, the provider count and the scale -- deliberately not
hover state. The window is sized for its worst case and left alone, so expanding
is pure CSS inside a window that never moves. Resizing per hover put an OS
`setBounds` on a different clock from the CSS transition, and crossing between
two rings produced a visible tear several times a second.

Because the window never resizes, the band it reserves has to hold the worst
case it will ever draw, and the worst case is not the card alone. A pending
question renders *between* the shell and the card -- it outranks a percentage --
so every banner pushes the card further from the edge. Reserving only
`cardHeight` clipped the card's footer exactly when an agent was waiting on an
answer, which is precisely when the panel is being read. `LAYOUT.ask` reserves
that room unconditionally, for two banners rather than one, because a question
arriving must not resize the window mid-read and the extra band is transparent
and click-through anyway.

Hover itself is tracked by polling the OS cursor against a hit rectangle the
renderer measures (`shared/hit.ts`), because a transparent, non-focusable,
click-through overlay on Windows does not receive DOM `mouseenter` dependably.
The rectangle is the **union** of the shell and any open card: padding an
element to reserve room does not work, since the card is anchored with
`top: 100%` and the padding would push it off screen by the same amount.
