# Session ideas: fix round 1

**Effort:** effort:0ab0fe28-b25a-4769-8c62-c1963dc1aabc
**Spec:** `docs/superpowers/specs/2026-11-26-session-ideas-design.md`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sessionideas-brief sessionideas-pet brief-surface jarvis-pet settings-storage`

The final stage failed on three steps; the other 37 of 41 passed (`brief-surface` and `jarvis-pet` in full).

- `sessionideas-brief` step 0 and `sessionideas-pet` step 0: `Error: sessionideasseed is for the dev app only`. The
  seed's guard (`pkg/wshrpc/wshserver/wshserver_sessionideas.go:256`) is `wavebase.IsDevMode()`, which reads
  `WAVETERM_DEV` (`pkg/wavebase/wavebase.go:112`). No host of this repo sets that variable: the Tauri host's
  `spawn_wavesrv` (`src-tauri/src/main.rs:86`) passes only the auth key, app path and the two homes, and
  `scripts/cdp/browser-app.mjs:84` copies that. So every dev app, Final's included, refuses the seed, and both
  scenarios stop before their first step.
- `settings-storage` step 0: `no scan of the fixtures within 60 s` (`scripts/cdp/scenarios.mjs:61242`). The run's
  change to that scan is one hook per listed session (`storage.SessionUnscanned`, set to `sessionIdeasUnscanned`:
  a cached marks read, one `os.Stat`, `Eligible`), which reads as cheap. The step failed in an earlier Final on the base
  too (`docs/open-issues.md`, "Scenario fixes never run live"), and this Final's app took 4 minutes from boot to its
  first render on a loaded machine. The cause is not known yet: Task 2 measures it first.

Rules: never hand-edit generated files; never run prettier on `scripts/*.mjs`; an agent an Arc run started runs no CDP
(Final is the live pass), so a scenario change is checked with `node --check` and by reading it.

### Task 1: The dev app tells wavesrv it is one, and the seed accepts it
**Depends on:** none
**Files:** `src-tauri/src/main.rs`, `src-tauri/src/paths.rs`, `scripts/cdp/browser-app.mjs`, `scripts/cdp/browser-app.test.mjs`, `pkg/wavebase/wavebase.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas_test.go`

Lead's call (autonomous run): a new, narrow flag, not `WAVETERM_DEV`. Setting `WAVETERM_DEV` in the Tauri host would
also switch on the Electron-era dev paths that read `IsDevMode` (the CORS wrapper in `pkg/web/web.go:440`, the RPC
context panics in `pkg/wshutil/wshutil.go:129`, the client id panic in `pkg/wstore/wstore.go:38`) in every dev app,
which is a change outside this feature. `NoGlobalInstall` is not used either: the person's own `task dev` does not set
it, so `task verify:ui -- sessionideas-brief` on their dev app would still be refused.

- `src-tauri/src/paths.rs`: a constant `DEV_APP_ENV = "ARC_DEV_APP"` beside `DEV_NO_GLOBAL_INSTALL_ENV`, with a
  comment saying a debug build sets it on wavesrv so dev-only RPCs (the scenario fixtures) can tell a dev app from a
  packaged one.
- `src-tauri/src/main.rs` `spawn_wavesrv`: sets `ARC_DEV_APP=1` on the wavesrv command in a debug build only
  (`cfg!(debug_assertions)`, the `is_dev` the setup already computes at `:592`; pass it in or test the cfg there).
  A packaged build never sets it.
- `scripts/cdp/browser-app.mjs`: the env it gives wavesrv (`:84`) gains `ARC_DEV_APP: "1"`, with its comment (`:79`)
  naming it; `browser-app.test.mjs` asserts it where it asserts `ARC_DEV_NO_GLOBAL_INSTALL` (`:80`).
- `pkg/wavebase/wavebase.go`: `DevAppVarName = "ARC_DEV_APP"`, read into a cache and unset with the others in the
  env-cache function (`:112`–`:120`, so a shell started from the app does not carry it), and `IsDevApp() bool`.
- `SessionIdeasSeedCommand`'s guard becomes `!wavebase.IsDevMode() && !wavebase.IsDevApp()`, with the same error text.
- Tests: a wshserver test that the seed is refused with neither flag and accepted with `IsDevApp` (set the cache the
  way the package's other tests set wavebase state, and put it back); `cargo test --manifest-path
  src-tauri/Cargo.toml` passes; `npx vitest run scripts/cdp/browser-app.test.mjs` passes.
- Acceptance: Final's `sessionideas-brief` and `sessionideas-pet` get past step 0. If a later step of either then
  fails, that is the next round's work; this task does not change their steps.

### Task 2: settings-storage's first scan ends inside its wait
**Depends on:** Task 1 (both may edit `wshserver_sessionideas.go`: Task 1 the seed's guard, this task the Storage hook)
**Files:** `scripts/cdp/scenarios.mjs`, `pkg/storage/sessions.go`, `pkg/storage/sessions_test.go`, `pkg/storage/scanner.go`, `pkg/storage/scanner_test.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas.go`, `docs/open-issues.md`

Find the cause before changing the wait.

1. Measure. With an opt-in Go test (skipped unless `ARC_STORAGE_MEASURE=1`, the way `TestDigestMeasure` is opt-in),
   time one full measure the way Final's app runs it: the real home's `~/.claude/projects` (measure only reads and
   stats; it never cleans), each category timed on its own, and the sessions category timed with
   `storage.SessionUnscanned` nil and set to the server's hook. Run it once on this tree and write the numbers in your
   report.
2. If the hook adds more than about 10% to the sessions category, make it cheaper (for example, one marks index per
   measure instead of a lookup per session) and keep its behavior: the tests in `pkg/storage/sessions_test.go` and the
   wshserver unscanned tests still pass.
3. If a category on its own takes most of a minute on this machine, that is the cause. Make it cheaper if that is
   simple and safe; otherwise go to 4.
4. If the measure is well under 60 s here, the Final failure was the loaded machine (the app took 4 minutes to its
   first render). Lead's call: step 0 keeps its assertion (a scan that started after the fixtures were written has
   ended) and waits up to 180 s while `getstorage` still reports `scanning`. It fails at once if no scan has started
   30 s after `rescanstorage`. Its output records how many seconds the scan took, so a slow scan shows in the
   contact sheet before it fails.
5. Update the `docs/open-issues.md` row "Scenario fixes never run live" (`:59`) with what you measured and what you
   changed, or add a `(arcterm)` row if the cause is a slow category you did not fix.

- Tests: `go test ./pkg/storage/...`, `go test ./pkg/wshrpc/wshserver -run 'Unscanned|Storage'`, `node --check
  scripts/cdp/scenarios.mjs`.
- Acceptance: Final's `settings-storage` passes step 0. A step after it that then fails is the next round's work.
