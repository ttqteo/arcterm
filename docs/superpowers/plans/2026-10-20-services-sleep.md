# Services sleep when not in use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a held service without Keep running stops ten minutes after its tab leaves the screen and starts again when it
comes back on screen, so services no one looks at hold no RAM.

**Architecture:** The supervisor (`pkg/services/supervisor.go`) gains a `sleeping` state, a per-service idle timer and a
`Seen(id, shown)` entry point behind a new `ServiceSeenCommand`. `autostart` turns into Keep running with a default of
false. The frontend reports which service tab is on screen from a pure "what changed" function and words the new
state.

**Tech Stack:** Go (wavesrv, wshrpc), React 19 + jotai, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-20-services-sleep-design.md` (on top of
`docs/superpowers/specs/2026-10-20-held-services-design.md`)

**Verify:** `node scripts/verify.mjs ./pkg/services/... ./pkg/arctools/... ./pkg/wshrpc/... ./pkg/tsgen/...`

**Final:** `node scripts/cdp/final-verify.mjs services-states services-tree services-setup`

The design canvas is `.superpowers/design/held-services/project` (board `RowStates` now has the Sleeping row). It is
gitignored, so the run gets it with `wsh runs start --prototype <absolute path>`.

## Global Constraints

- Idle time: ten minutes after the service's tab left the screen (`IdleSleep = 10 * time.Minute`, the same ten minutes as `APP_FRAME_IDLE_MS` in `frontend/app/view/agents/appmodel.ts`).
- On screen: the service's tab is the one shown in the Agent centre (page or log) while the Agent surface is the one showing.
- `autostart` keeps its key and becomes Keep running, default **false**. On: starts with arcterm, never sleeps.
- A sleep is not the person's Stop: `Remembered.Stopped` is untouched. A service the person stopped never starts when shown.
- Running elsewhere never sleeps; a `retrying` service off screen sleeps at ten minutes and its retries end.
- Exact copy: row words `sleeping` (hollow muted dot, no hover action); header `Sleeping · starts when shown`; label `Keep running`; detail sub `Run it even when its page is not on screen, and start it with arcterm`.
- Never hand-edit generated files: `task generate` after a wshrpc change. No co-author trailer in commits.

## Review Focus

- Switching from a service to another surface and back within ten minutes: the timer is cancelled and the service never stops. Test: `TestSeenAgainCancelsSleep` (Task 1).
- The frontend reloading while a service is on screen: it reports shown again, which must not restart a running service. Test: `TestSeenRunningDoesNothing` (Task 1).
- A Keep-running service toggled off while off screen: it must arm the timer then, not wait for another hide. Test: `TestKeepRunningOffArmsTimer` (Task 1).
- Two services: showing one must report the other as not shown in the same change. Test: `seenChanges hands off between services` (Task 2).
- The Agent surface hidden behind Cockpit while a service tab is focused: that counts as off screen. Test: `seenChanges treats another surface as off screen` (Task 2).

---

### Task 1: Sleeping in the supervisor, ServiceSeenCommand

**Depends on:** none
**Files:** `pkg/arctools/catalog.go`, `pkg/arctools/catalog_test.go`, `pkg/services/model.go`, `pkg/services/model_test.go`, `pkg/services/supervisor.go`, `pkg/services/supervisor_test.go`, `pkg/wshrpc/wshrpctypes_services.go`, `pkg/wshrpc/wshserver/wshserver_services.go`, `pkg/wshrpc/wshserver/wshserver_services_test.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `services.StateSleeping = "sleeping"`, `services.IdleSleep = 10 * time.Minute`; `func (s *Supervisor) Seen(ctx context.Context, id string, shown bool) error`.
- Produces: `CommandServiceSeenData struct { Id string "id"; Shown bool "shown" }` and `ServiceSeenCommand(ctx, CommandServiceSeenData) error` in `ServicesCommands`; frontend `RpcApi.ServiceSeenCommand(TabRpcClient, { id, shown })`.
- Changes: `arctools` `override` sets `Autostart` to `*u.Autostart` when given, else **false**.

Behaviour (spec "Decisions"): a service without `Autostart` that the person did not stop reads `sleeping` where it read
`stopped` for any other reason: a new entry in `SetTools` and every such service at `Boot`. A tab closed some other way
(`OnBlockClosed`) is the person's Stop and stays `stopped`. `Seen(id, false)` arms `IdleSleep` through `Deps.After` for such a service in `starting`, `running`, `nopage` or `retrying`; on fire it calls `stop(id, false)` and sets `sleeping`. `Seen(id, true)` cancels that timer and, when the service is `sleeping`, starts it as the person's start would, without touching `Stopped`. `Seen` of an unknown id returns `no service "<id>"`. A change of `Autostart` in `SetTools` from on to off arms the timer when the service is not currently shown; off to on cancels it and starts a sleeping one. The supervisor keeps which service is shown (the last `Seen(id, true)` without a later `Seen(id, false)`).

- [ ] **Step 1: Write the failing tests** (`supervisor_test.go`, the existing fake clock and deps):
  - `TestUnseenServiceSleepsAfterTenMinutes`: running, `Seen(false)`; at 9 min 59 s still `running`; at 10 min `sleeping`, `Stop` called once, `Remembered.Stopped == false`.
  - `TestSeenAgainCancelsSleep`: `Seen(false)`, 5 min, `Seen(true)`, 20 min → still `running`, `Stop` never called.
  - `TestSeenSleepingStarts`: a `sleeping` service, `Seen(true)` → `starting`, `Ensure` and `Start` called.
  - `TestSeenRunningDoesNothing`: running, `Seen(true)` twice → no `Start`, no `Stop`.
  - `TestStoppedServiceDoesNotStartWhenSeen`: Stop, then `Seen(true)` → `stopped`, `Start` not called.
  - `TestKeepRunningNeverSleeps`: `Autostart: true`, `Seen(false)`, 30 min → `running`.
  - `TestKeepRunningOffArmsTimer`: `Autostart: true`, off screen, `SetTools` with `Autostart: false` → `sleeping` at +10 min.
  - `TestBootLeavesOnDemandSleeping`: boot with one Keep-running and one on-demand service → the first `starting`, the second `sleeping` and never started; a third the person stopped reads `stopped`.
  - `TestElsewhereNeverSleeps`: `elsewhere`, `Seen(false)`, 30 min → `elsewhere`, `Stop` never called.
  - `TestRetryingSleepsAndRetriesEnd`: `retrying` with a pending retry, `Seen(false)`, 10 min → `sleeping`, the retry callback, fired after, starts nothing.
  - `catalog_test.go` `TestMergeService`: an entry with a url and no `autostart` → `Autostart == false`; `autostart: true` → true.
  - `TestServiceSeenUnknownId` (`wshserver_services_test.go`): `ServiceSeenCommand(ctx, {Id: "nope", Shown: true})` errors with `no service "nope"`.
- [ ] **Step 2: Run them to see them fail**: `go test ./pkg/services ./pkg/arctools ./pkg/wshrpc/wshserver -run 'Sleep|Seen|KeepRunning|BootLeaves|ElsewhereNever|RetryingSleeps|TestMergeService'` → FAIL.
- [ ] **Step 3: Implement** as described; update the existing tests that assumed `autostart` defaults to true (they now set `Autostart: true` where they test a boot start).
- [ ] **Step 4: Regenerate and run**: `task generate && go test ./pkg/services ./pkg/arctools ./pkg/wshrpc/... && go build ./...` → PASS; `wshclientapi.ts` has `ServiceSeenCommand`.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): a service without Keep running sleeps when off screen"`

### Task 2: The frontend reports what is on screen and words sleeping

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/serviceseen.ts`, `frontend/app/view/agents/serviceseen.test.ts`, `frontend/app/view/agents/servicesmodel.ts`, `frontend/app/view/agents/servicesmodel.test.ts`, `frontend/app/view/agents/servicesstore.ts`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/servicemenu.tsx`, `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`, `frontend/app/view/agents/appmodel.ts`, `frontend/app/view/agents/appmodel.test.ts`

**Interfaces:**
- Consumes: `RpcApi.ServiceSeenCommand`, `serviceByTabAtom`, `model.focusIdAtom`, `model.surfaceAtom`.
- Produces: `shownService(focusId: string | null, surface: string, byTab: Record<string, ServiceStatus>): string | null` and `seenChanges(prev: string | null, next: string | null): { id: string; shown: boolean }[]` in `serviceseen.ts` (pure); `reportServiceSeen(id: string, shown: boolean): void` in `servicesstore.ts`; `useServiceSeen(model)` called once in `AgentSurface` (always mounted), which reports each change and, on mount, the current one.

`seenChanges(a, b)`: `[]` when equal; `[{a, false}]` then `[{b, true}]` when both set and different; one entry when only one is set. Sleeping words per the spec table; `serviceHeaderLine` of sleeping → `Sleeping · starts when shown`; `servicesChip` counts sleeping in neither running nor the tone; `popoverOrder` puts sleeping with stopped; `canStart(sleeping)` true, `canStop` and `canRestart` false. `serviceAppState` maps sleeping to `failed` (the log) like stopped. `withAutostart(entry, on)` writes `autostart: true` when on and drops the key when off. The menu check and the Setup detail row read `Keep running` (sub as in Global Constraints). `toolslibrarymodel`: `emptyForm().autostart` false; `formFromTool` reads `tool.autostart ?? false` for a service; `formKeywords` and the override path write `autostart: true` only when on.

- [ ] **Step 1: Write the failing tests**: `serviceseen.test.ts`: `shownService` picks the focused service tab only when `surface === "agent"`; `seenChanges hands off between services` (`("a","b")` → `[{a,false},{b,true}]`); `seenChanges treats another surface as off screen` (`shownService("tab-a","cockpit",…)` → null, so `("a", null)` → `[{a,false}]`); equal → `[]`. `servicesmodel.test.ts`: the sleeping row, header, chip (`2` running + 1 sleeping → label `2`, tone muted), order, canStart/canStop, `withAutostart`. `toolslibrarymodel.test.ts`: `formKeywords` with Keep running off writes no `autostart`, on writes `autostart: true`; `emptyForm().autostart === false`. `appmodel.test.ts`: sleeping → `failed`. Rewrite the existing assertions that expected the old default.
- [ ] **Step 2: Run**: `npx vitest run frontend/app/view/agents/serviceseen.test.ts frontend/app/view/agents/servicesmodel.test.ts frontend/app/view/agents/toolslibrarymodel.test.ts frontend/app/view/agents/appmodel.test.ts` → FAIL.
- [ ] **Step 3: Implement** as described.
- [ ] **Step 4: Run**: the same vitest files → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
- [ ] **Step 5: Commit**: `git commit -m "feat(services): report the service on screen, word sleeping, Keep running"`

### Task 3: Scenarios and changelog

**Depends on:** Task 2
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `AGENTS.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: the `services-states`, `services-tree` and `services-setup` scenarios and their helpers (`svcArrange`, `svcWrite`, `svcWait`, `svcTeardown`), which today seed services with `autostart` unset.

Seeded services that a scenario expects running get `autostart: true`. `services-states` adds a `svc-sleep` (no `autostart`, never shown) whose row reads `sleeping` with a hollow dot, and judges it against board `RowStates`. `services-tree` adds a step: clicking `svc-sleep`'s row starts it (`starting`, then the page with `Running on 127.0.0.1:`); its step 9 now checks that the menu reads `Keep running`, unchecked by default, and that ticking it writes `autostart: true`. `services-setup` step 3 becomes `Keep running turns on` (the toggle writes `autostart: true`). `CHANGELOG.md`: rewrite the held-services line under `Unreleased` to say arcterm starts a pinned app when you open it and lets it sleep ten minutes after you leave it, unless you set it to Keep running (keep `<!-- big -->`). `AGENTS.md` (the held-services sentence near line 204): "starts it again with arcterm" becomes "starts it when it is shown and lets it sleep ten minutes after, unless Keep running". `docs/open-issues.md`: update the Hóng hand check (line ~74, "starts again unless you stopped it") to the sleep behaviour, and the held-services RAM row (line ~1231) to say a sleeping service holds 0 MB.

- [ ] **Step 1: Update the three scenarios.**
- [ ] **Step 2: Run** in a browser build: `task dev:browser` in the background, then `node --experimental-websocket scripts/cdp/verify.mjs services-states services-tree services-setup` → all PASS.
- [ ] **Step 3: Update the changelog line, AGENTS.md and open-issues.**
- [ ] **Step 4: Commit**: `git commit -m "test(services): sleeping in the CDP scenarios; changelog"`
