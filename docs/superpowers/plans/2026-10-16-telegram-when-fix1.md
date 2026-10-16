# Telegram connects only when allowed and needed — fix round 1

**Verify:** `node scripts/verify.mjs ./pkg/telebot ./pkg/wconfig ./pkg/wshrpc/... ./cmd/server/...`

**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `ARC_TELEGRAM_API_BASE=http://127.0.0.1:18765 node scripts/cdp/final-verify.mjs settings-telegram`

**Goal:** fix two defects the run's tasks left in the supervisor (`pkg/telebot/bot.go`), inside the spec's "When it
connects" section (`docs/superpowers/specs/2026-10-16-telegram-asks-design.md`).

### Task 1: A validation getMe that failed on the network is retried

**Depends on:** none

**Files:** `pkg/telebot/bot.go`, `pkg/telebot/bot_test.go`

**Defect A.** `supervisor.validate` sets `sv.knownTok = tok` before the request, so a getMe that fails with a
network error (not a 401; for example the app starts offline) is never made again for that token. `step` only
validates when `tok != sv.knownTok || wasRejected`, so the Settings row keeps showing the dial error, ahead of every
other state, until the token changes, the switch is toggled, or Pair is pressed, even after the network is back.

Fix: a validation that failed with anything other than a 401 is not "known". It is tried again:
- on the next poke (any settings or token change, or a Pair), the same token too;
- on a tick, after a backoff that starts at 1 minute and doubles up to 30 minutes, reset when the token changes,
  the switch goes off, or a validation or session succeeds. Keep the backoff in package vars so a test can shorten
  them, like `idleLinger`.
A success clears `pollErr` and sets the name, as today. A 401 keeps today's behaviour: held until a poke, never
retried by a tick. A session starting still sets `knownTok` as today.

**Defect B.** In `step`, when a session ended on a 401, `sv.rejectedTok = tok` records the *current* token. If the
token changed while that session ran, the new token is marked rejected and the one Telegram refused is not. Record
the session's own token (`sv.cur.token`, read before `sv.stop()`).

Tests in `bot_test.go`, following `TestValidationRejectsOnce` and `TestValidationNamesTheBotOnSwitchOn`:
- `TestValidationNetworkErrorIsRetriedOnPoke`: the fake API fails the first getMe (a 500 or a closed connection),
  then answers. After the first pass the status shows the error; after a poke with the same token it shows the bot's
  name and no `LastError`.
- `TestValidationNetworkErrorIsRetriedAfterBackoff`: same, with no poke; with the backoff shortened, a later tick
  retries and the error clears. Before the backoff, ticks make no getMe (count the fake's getMe calls).
- `TestValidationRejectedIsNotRetriedByTick`: a 401 stays one getMe across several ticks.
- `TestSessionRejectionMarksTheSessionsToken`: a session on token A ends on a 401 after the token changed to B; B
  is not held as rejected (a validation or session for B runs), A is.

Run the whole `go test ./pkg/telebot` before finishing. No frontend, scenario or generated file changes; this task
adds no UI, so it names no scenario step.
