# Council UX pass, fix round 1: Pin does not move a council's ended time

**Spec:** `docs/superpowers/specs/2026-11-03-council-ux-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts && go vet ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Final:** `node scripts/cdp/final-verify.mjs council-tree council-discussion council-summary`
**Prototype:** .superpowers/design/council-ux/project/Discussion-list.dc.html

The final stage found one defect against spec decision 1 ("Unpin on an ended council older than a day takes it off
the tree at once"). The tree's ended time (`endedAt`, `frontend/app/view/agents/councilopened.ts:96`) is
`summary.at`, else `updated`. `Runner.SetPinned` (`pkg/council/runner.go:2538`) saves through `council.Update` →
`writeLocked` (`pkg/council/store.go:154`), which stamps `Updated = now` on every save. So for a failed, stopped or
not-run council with no summary, Pin or Unpin moves its ended time to now: `councilInTree`
(`agentsidebarmodel.ts:81`) keeps it 24 h more and `isUnreadCouncil` counts it unread, and it stays in the tree.
CDP step 11f passes only because its fixture has a summary.

Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash).

### Task 1: SetPinned saves without restamping Updated
**Depends on:** none
**Files:** `pkg/council/store.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `scripts/cdp/council/tree.mjs`

The pin is the person's mark, not a change to the council's discussion, so it must not move `Updated`.

- `pkg/council/store.go`: add a store update that loads, applies `fn` and writes under the id's lock exactly as
  `Update` does, but keeps the council's `Updated` as loaded. Share the body with `Update` (one write path with a
  "stamp or not" choice inside `writeLocked`, or an equivalent); don't copy it. `Update` and `Save` keep stamping.
- `Runner.SetPinned` (`runner.go:2538`) uses it. Nothing else changes: it still works in any state, keeps the first
  pin time, and publishes `council:changed` through `r.changed`.
- Go test in `runner_test.go`, beside `TestSetPinnedOnAnEndedCouncil` (`:2365`): a stopped council with no summary
  and a known `Updated` in the past; `SetPinned(id, true)` then `SetPinned(id, false)`; after each, the returned and
  the reloaded council have the same `Updated` as before, and `Pinned` is set then 0.
- Vitest in `agentsidebarmodel.test.ts`, beside the existing `councilInTree` cases: a stopped council with no
  summary whose `updated` is three days before `now`, opened after it ended (in the opened map), with `pinned` set
  is in the tree, and the same council with `pinned: 0` and the same `updated` is not.
- CDP, `scripts/cdp/council/tree.mjs`: add step 11g after 11f, built inside this scenario the way 11d–11f build
  `old-pinned` / `old-read` (do not touch the shared fixtures): a pinned, stopped council with **no summary**, ended
  three days ago and opened, is in the tree; Unpin from its tree row's hover button asks wavesrv to unpin it, and once
  saved the council leaves the tree. Seed its id under `COUNCIL_ID_PREFIX`, mark it opened through the same
  `ctx.openedBefore` save / restore 11d–11f use, and remove it in the scenario's teardown with the others. Update the
  file's header comment that lists steps 11d to 11f.
- Run `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts`, the Go test with `-run`, and
  `node scripts/cdp/final-verify.mjs council-tree`.
