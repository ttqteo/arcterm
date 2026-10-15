# Menu Bar and Tray Popover: Final-Stage Fixes, Round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two defects the final stage found against `docs/superpowers/specs/2026-10-15-tray-popover-design.md`:
the offline page's "Last heard" goes stale while the popover is shut, and the dimmed icon shows when wavesrv dies even
with `app:tray` off.

**Spec:** `docs/superpowers/specs/2026-10-15-tray-popover-design.md` ("Offline", "A setting turns it off")

On a Mac, cargo is off the agent PATH: prefix cargo commands with `PATH="/opt/homebrew/opt/rustup/bin:$PATH"`. Prefix
`task check:ts` with `NODE_OPTIONS=--max-old-space-size=4096`. Commits carry no Co-Authored-By or other attribution
trailer.

### Task 1: "Last heard" stays current while the popover is shut

**Depends on:** none
**Files:** `frontend/app/cockpit/traybridge.tsx`, `frontend/app/cockpit/traysnapshot.ts`

The spec's offline page shows "when the cockpit last heard from wavesrv". Today `TrayBridge` sets `heardAt` only from
the one `GetMachineStatsCommand` at mount and from the 1 s machine poll while the popover is open. wavesrv usually dies
while the popover is shut, so the page then shows the app's start time or the last time the popover was open ("Last
heard 09:00" for a crash at 14:29).

- [ ] **Step 1: A light heartbeat.** In `frontend/app/cockpit/traybridge.tsx`, add `const HEARTBEAT_MS = 15_000;` beside
  `MACHINE_POLL_MS`, and an effect that runs for the bridge's whole life (not gated on `open`): every `HEARTBEAT_MS` it
  calls `RpcApi.WaveInfoCommand(TabRpcClient)` and on success calls `setHeardAt(Date.now())`, ignoring a failure. Clear
  the interval on unmount. `WaveInfoCommand` answers from memory (`pkg/wshrpc/wshserver/wshserver.go`
  `WaveInfoCommand`). Do **not** use `GetMachineStatsCommand` for the heartbeat: each call keeps the machine-stats CPU
  sampler running, which the spec reserves for an open popover.
- [ ] **Step 2: Each memory-pressure event counts as hearing from wavesrv.** In the existing `memorypressure`
  subscription's handler, also call `setHeardAt(Date.now())`.
- [ ] **Step 3: Keep the rest.** The mount-time `GetMachineStatsCommand` and the 1 s poll while open keep setting
  `heardAt` as they do. Once wavesrv has gone every call fails, so `heardAt` freezes at its last answer, which is what
  the offline page shows.
- [ ] **Step 4: Comments.** Update the `heardAt` comment in `traybridge.tsx` and the `heardAt` field comment in
  `frontend/app/cockpit/traysnapshot.ts` (`TraySnapshotInput`, now "the bridge's last answered
  GetMachineStatsCommand") to say it is wavesrv's last answer: the heartbeat, the machine poll, or a memory-pressure
  event.
- [ ] **Step 5: Check.** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` exits 0, and
  `npx vitest run frontend/app/cockpit/` passes. This adds no pure function, so it adds no unit test: `traySnapshot`'s
  use of `heardAt` is already tested, and the timer only feeds it. If you do move logic into a pure function, test it
  beside it.
- [ ] **Step 6: Commit.** `fix(tray): the offline page's Last heard stays current while the popover is shut`

### Task 2: Turning `app:tray` off keeps the icon hidden when wavesrv dies

**Depends on:** none
**Files:** `src-tauri/src/tray.rs`

The spec says "A setting turns it off" and names no exception. `apply()` in `src-tauri/src/tray.rs` calls
`tray.set_visible(st.visible || st.offline)`, so when wavesrv's stderr closes (`wavesrv_gone`), the dimmed icon appears
even though the person turned it off in Settings → General.

- [ ] **Step 1: Visibility follows the setting only.** In `apply()`, change the last line to
  `let _ = tray.set_visible(st.visible);`, with a one-line comment that `app:tray` off keeps the icon hidden, offline
  too. `wavesrv_gone` still sets `offline`, so the icon dims when it is shown, and an open popover still gets
  `tray:offline`. Change nothing else: the icon stays hidden until the cockpit's first `set_tray_status`, as `setup`
  already says.
- [ ] **Step 2: Check.** `PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml`
  passes, and `cargo build` of the same manifest compiles without new warnings.
- [ ] **Step 3: Commit.** `fix(tray): app:tray off keeps the icon hidden when wavesrv dies`
