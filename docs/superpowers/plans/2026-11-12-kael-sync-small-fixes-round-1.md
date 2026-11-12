# Kael sync small fixes: Final round 1

**Verify:** `npx vitest run frontend/app/view/agents frontend/app/view/orchestrate`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs dag-lifecycle kael-ask-keys`

The run's Final failed only on `dag-lifecycle`: the scenario threw `EC-TIME: timeout waiting for response` from a
wavesrv RPC, before it could report any step (`kael-ask-keys` passed 5/5). The dev app's log shows why: the engine's
dag lock was held 10.9 s by `orchestrate.runTick` for the scenario's own run (`dag … lock: waited 5.824s, held
10.989s, by orchestrate.runTick`), and every `h.rpc` call carries wavesrv's default 5 s budget
(`pkg/wshutil/wshrpc.go` `DefaultTimeoutMs`). `scripts/cdp/scenarios.mjs` already met this in `acArrangeRun` (around
line 42350) and fixed it there by wrapping `h.rpc` with a 90 s budget.

### Task 1: dag-lifecycle's RPCs outlast the engine's dag lock
**Depends on:** none

**Files:** `scripts/cdp/scenarios.mjs`

Lift `acArrangeRun`'s wrapper into one named helper beside it (for example
`withLongRpc(h0)`, returning `Object.create(h0)` with `rpc` passing `timeout: Math.max(opts?.timeout ?? 0, 90_000)`),
keep its comment, and use it in `acArrangeRun` (same behaviour) and in `dagLifecycle`'s `arrange` and `assert`, so
every `h.rpc` call in that scenario — `dagsubmit`, `dagstatus`, `dagaction`, `channelRuns(h, …)` and the rest — gets the
90 s budget. Keep `h.ev`, `h.goto`, `h.shot` untouched; change no step's assertion, label or order, including step 6a.
Teardown may use it too.

**Acceptance:** `node --check scripts/cdp/scenarios.mjs` exits 0; `git diff` touches only `scripts/cdp/scenarios.mjs`;
no `h.rpc` call inside `dagLifecycle` runs on the 5 s default. If you can boot a dev app, run
`task verify:ui -- dag-lifecycle` and report its table; if you cannot, say so under Not verified (the Final runs it).
