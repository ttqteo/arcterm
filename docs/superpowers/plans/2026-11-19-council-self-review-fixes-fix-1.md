# Council self-review fixes: final-stage fix, round 1

**Plan it fixes:** `docs/superpowers/plans/2026-11-19-council-self-review-fixes.md` (this run has no spec file)
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/... ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs launcher council-setup`

The final Verify failed on two steps. Neither comes from this run's four tasks, but both hold the land, so both are
fixed here.

1. vitest `pkg/remotemode/web/projectors.test.js` › "the committed bundle is current". Commit 1842fcc51 (on the base,
   before this run) changed `frontend/app/view/agents/transcriptprojection.ts` (`plainText`, `unescapeBashText`,
   `bashOutput`) without regenerating `pkg/remotemode/web/static/projectors.js`, which esbuild bundles from it. It
   fails alone too (rerun of that file alone, same diff).
2. Go `pkg/council` › `TestQueueTwoStartsAtOnce/4`: `runner_test.go:3789` "the call x-ux/r1 never started". That wait
   is the queued council's first call, which comes only after the first council's whole run ends (its rounds 2 and 3,
   synthesis, document write, then `pumpLocked`). `entered` gives every wait 10 s. The subtest took 14.3 s in the
   final stage, under the full suite's load. Alone it passes: `go test ./pkg/council -run '^TestQueueTwoStartsAtOnce$'
   -count=30` ran 150 subtests clean in 89 s. This run did not touch `runner.go` or `runner_test.go`. So it is a load
   timeout, not a lost start.

### Task 1: regenerate the phone page's projectors bundle

**Depends on:** none
**Files:** `pkg/remotemode/web/static/projectors.js`

- Run `node scripts/sync-remote-web.mjs` from the repo root. It rewrites the generated assets under
  `pkg/remotemode/web/static/`. Never hand-edit them.
- Commit only what the script changed. Expect `projectors.js` alone. If `tokens.css`, `markdown.js`, `icon.png` or the
  fonts change too, they were stale as well: commit them in the same commit, and name them in your report.
- No CHANGELOG line. 1842fcc51 already carries the user-facing line, and this only brings the phone page's copy in
  step.

Acceptance: `npx vitest run pkg/remotemode/web/projectors.test.js` passes all 4 cases. `go build ./pkg/remotemode/...`
still builds, since the static files are embedded.

### Task 2: the queued-start wait in `TestQueueTwoStartsAtOnce` allows for a whole council run

**Depends on:** none
**Files:** `pkg/council/runner_test.go`

Decision: lengthen only the one wait that spans a whole council run. Every other `entered` wait spans one goroutine
hop, and 10 s is ample there. A longer wait only delays a real failure. Go's 10-minute test timeout still catches a
hang.

- Beside `entered` (`runner_test.go:146`), add `enteredWithin(t *testing.T, key string, d time.Duration)`, with the
  same body as `entered` and `d` in place of the 10 s. Make `entered` call `enteredWithin(t, key, 10*time.Second)`.
  Keep `t.Helper()` in both.
- At `runner_test.go:3789` (`h.f.entered(t, prefix[waiting.Id]+"ux/r1") // the queued one starts when the first ends`),
  call `h.f.enteredWithin(t, prefix[waiting.Id]+"ux/r1", time.Minute)`. Extend the comment to say why: the queued
  council starts only when the first council's whole run has ended, which takes over 10 s under the full suite's load.
- Grep `runner_test.go` for other `entered` waits that come right after a `release` and wait on another council's
  first call (a queue start). Give each the same `time.Minute` wait, with the same comment. Change no other wait.
  List in your report which ones you changed.
- Leave `runner.go` alone.

Acceptance: these all pass.
- `go test ./pkg/council -run '^TestQueueTwoStartsAtOnce$' -count=10`
- `go test ./pkg/council -run 'Queue'`

Prefix both with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` on Windows.
