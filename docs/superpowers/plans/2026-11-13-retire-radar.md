# Retire Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Radar surface and everything behind it (backend scan, store table, attention kind, settings, CDP scenarios, docs) from arcterm.

**Architecture:** A port of the kaeltran16 fork's Retire Radar plan (`docs/superpowers/plans/2026-10-21-retire-radar.md` at
`upstream/main` `dd32f48d5`, landed there as `f12499eb4` … `a4605b724`), redone against arcterm's code, which has
diverged from the fork: different migration numbers, no `pkg/jarvisbackfill`, a `railapps` rail, a Settings page per
section, and `AttentionItem.ORef` used by kinds other than radar triage. Frontend, Go and scenarios/docs are removed
side by side; one last task regenerates the bindings once the frontend and Go are both gone.

**Already done before the run** (commit "feat(navrail): take Radar off the nav rail ahead of its removal",
2026-11-13): `radar` is out of `SURFACE_ORDER`, `TOOL_ITEMS` and the nav badges; `coerceStartupSurface` boots anything
off `SURFACE_ORDER` on the cockpit (Task 1 Steps 1, 2 and 4); `radarnav.test.ts` is deleted; the docs and `AGENTS.md`
lines about the rail and `Ctrl+1..6` are updated; and the scenarios that read the rail (`surface-smoke`,
`agent-history`, `agent-rail-tabs`, the final-shots fixtures, `resource-linking` step 5) no longer expect Radar, while
the Radar scenarios reach it with `Ctrl+G r`. Each task skips what it finds done.

**Tech Stack:** Go (wavesrv, wsh, sqlite migrations), React 19 + jotai + vitest, CDP scenarios (`scripts/cdp`).

**Spec:** none. The decision (the owner's, 2026-11-13) and its numbers are under Why below.

**Verify:** `node scripts/verify.mjs ./pkg/jarvis ./pkg/waveobj ./pkg/wstore ./pkg/wconfig ./pkg/wshrpc/... ./cmd/...`
**Check:** `go build ./... && go vet ./pkg/jarvis ./pkg/waveobj ./pkg/wstore ./pkg/wconfig ./pkg/wshrpc/... ./cmd/... && NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke settings-headless settings-pages peek-item-views resource-linking dag-peek agent-history agent-rail-tabs route-picker-flat brief-surface`

## Why

Measured 2026-11-13 against the packaged Mac store (`~/Library/Application Support/dev.arc.app/data/db/waveterm.db`):

- 5 scans, 2026-10-11 to 2026-11-03, every one started by hand; none since.
- 49 findings (21 in the newest report), **0 triaged** (no finding has a `disposition`).
- 1 investigation run (2026-11-05), which found a real bug (`59935b14d`, Float's `MAC` constant frozen before boot).
- About 2.4M tokens over the 5 scans.

The fork measured the same pattern on 2026-10-21 (26 hand-started scans, the newest report's findings never triaged,
7 investigation runs for 2 real fixes, ~14.5M tokens in October) and retired it. The fix-sibling idea has value; a
surface with a badge counting findings nobody opens does not. Our own Workflow scan spec
(`docs/superpowers/specs/2026-10-26-workflow-scan-design.md`) already names "an untriaged findings list" as Radar's
failure mode. The 2026-11-12 Kael sync kept Radar only because it was out of that sync's scope.

`2a13c415d` is a commit with all of Radar in it; every recovery note below names it.

## Global Constraints

- `AttentionItem.ORef` (`pkg/wshrpc/wshrpctypes_channels.go`) **stays**: `chunk-due` (`pkg/jarvis/attention.go:575`,
  `:613`) and `council` (`:479`) set it, and `briefingmodel.ts` reads it for both. Only its comment changes. The fork
  removed it; do not port that.
- `allowPickerSections` (`route.ts`) and the route picker's `runtimes` prop **stay**: the run launcher, the Runs
  settings page and the Brief pass `leadRuntimes` through them. Only the Radar comment on them goes.
- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`,
  `pkg/wconfig/metaconsts.go`, `schema/settings.json`), with one exception: Task 2 deletes the Radar functions from
  `pkg/wshrpc/wshclient/wshclient.go` by hand, because `task generate` imports `wshclient` and cannot run while it
  calls the deleted commands. Task 4 regenerates all of them.
- Leave Radar mentions that are only sample or fixture text: `pkg/jarvisdossier/decision_test.go`,
  `pkg/council/autogen_test.go`, `pkg/agentsessions/agentsessions_test.go`,
  `pkg/wshrpc/wshserver/wshserver_councilautogen_test.go`, `frontend/app/view/jarvis/briefingfixtures.ts`,
  `frontend/app/cockpit/palette-groups.test.ts`, `frontend/app/cockpit/palette-commands.test.ts`,
  `frontend/app/view/jarvis/petjoin.test.ts`, `scripts/cdp/seed-brief.mjs`, `scripts/cdp/council/*.json`,
  `claude/skim-bench/**`, `docs/prototype/*.dc.html`, `docs/superpowers/specs/*`, `docs/superpowers/briefs/*`,
  `docs/hand-checks.md`, old `CHANGELOG.md` lines, `public/fonts/*`, `public/fontawesome/*`.
- `db/migrations-wstore/000013_radarreport.*` stay (migrations are history). The drop is a new `000028`.
- Do not run prettier on `scripts/*.mjs`. Check only the files you touched; never `--write` the tree.

## Review Focus

- **A saved Startup surface of Radar** (Settings → General → Startup surface set to Radar, or a hand-edited
  settings.json) must boot on Cockpit. Today `coerceStartupSurface` (`cockpitprefsstore.ts:40`) returns its input
  unchecked, so it would boot on a surface that no longer renders. Test in Task 1.
- **A remembered last surface of `radar`** (Startup surface = Last opened) must boot on Cockpit. `bootSurface` already
  falls back through `SURFACE_ORDER`; Task 1 flips the existing expectation to pin it.
- **An agent calling `wsh ui reveal surface:radar` or `radarreport:<id>`** (an old skill text still in its context)
  must get an "unknown surface" / unknown address error, not a blank surface. Test in Task 1 (`uiapi.test.ts`).
- **An existing store**: the packaged store has a `db_radarreport` table and one run with a `radarorigin` key. The
  migration drops the table; the run must still decode. Test in Task 2 (`wtype_test.go`).
- **An existing settings.json with `radar:auditruntime` / `radar:auditmodel` / `radar:classifymodel`** must still load
  with every other setting intact. Test in Task 2 (`pkg/wconfig`).

---

### Task 1: Remove Radar from the frontend
**Depends on:** none
**Files:** `frontend/app/view/agents/radarauditlist.tsx`, `frontend/app/view/agents/radardevmock.test.ts`, `frontend/app/view/agents/radardevmock.ts`, `frontend/app/view/agents/radarfindingdetail.tsx`, `frontend/app/view/agents/radarfindingslist.tsx`, `frontend/app/view/agents/radarmodel.test.ts`, `frontend/app/view/agents/radarmodel.ts`, `frontend/app/view/agents/radarnav.test.ts`, `frontend/app/view/agents/radarscanstatepanel.tsx`, `frontend/app/view/agents/radarstore.test.ts`, `frontend/app/view/agents/radarstore.ts`, `frontend/app/view/agents/radarstoreload.test.ts`, `frontend/app/view/agents/radarstyles.ts`, `frontend/app/view/agents/radarsurface.tsx`, `frontend/app/view/jarvis/peek/peekradar.tsx`, `frontend/app/view/jarvis/peek/peekradarmodel.test.ts`, `frontend/app/view/jarvis/peek/peekradarmodel.ts`, `frontend/app/cockpit/palette-needs.ts`, `frontend/app/cockpit/palette-needs.test.ts`, `frontend/app/cockpit/uiapi.ts`, `frontend/app/cockpit/uiapi.test.ts`, `frontend/app/cockpit/uiclient.ts`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/store.test.ts`, `frontend/app/view/agents/agents.tsx`, `frontend/app/view/agents/ambient.ts`, `frontend/app/view/agents/ambient.test.ts`, `frontend/app/view/agents/ambientstore.ts`, `frontend/app/view/agents/attentionstore.ts`, `frontend/app/view/agents/attentionstore.test.ts`, `frontend/app/view/agents/channelderive.ts`, `frontend/app/view/agents/channelderive.test.ts`, `frontend/app/view/agents/cockpitprefsstore.ts`, `frontend/app/view/agents/cockpitprefsstore.test.ts`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/view/agents/conversationhistory.tsx`, `frontend/app/view/agents/divergencebanner.tsx`, `frontend/app/view/agents/navrail.tsx`, `frontend/app/view/agents/needsyoustripmodel.test.ts`, `frontend/app/view/agents/notifyevents.ts`, `frontend/app/view/agents/notifyevents.test.ts`, `frontend/app/view/agents/railapps.ts`, `frontend/app/view/agents/route.ts`, `frontend/app/view/agents/runactions.ts`, `frontend/app/view/agents/runactions.test.ts`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/view/agents/settingspages/backgroundai.tsx`, `frontend/app/view/agents/surfacecontext.ts`, `frontend/app/view/agents/surfacecontext.test.ts`, `frontend/app/view/agents/surfaceorder.test.ts`, `frontend/app/view/agents/surfacescaffold.tsx`, `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/code/codestore.ts`, `frontend/app/view/jarvis/address.ts`, `frontend/app/view/jarvis/address.test.ts`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/briefrows.ts`, `frontend/app/view/jarvis/briefrows.test.ts`, `frontend/app/view/jarvis/briefsheet.tsx`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/newrun.ts`, `frontend/app/view/jarvis/newrun.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/view/jarvis/peek/peekregistry.ts`, `frontend/app/view/jarvis/peekitemmodel.ts`, `frontend/app/view/jarvis/peekitemmodel.test.ts`, `frontend/app/view/jarvis/petpeekmodel.ts`, `frontend/app/view/jarvis/petpeekmodel.test.ts`, `frontend/app/view/jarvis/returnsurface.test.ts`, `frontend/app/view/jarvis/reviewmodel.test.ts`, `frontend/app/view/jarvis/runtiming.ts`

Frontend only: touch no Go file, no generated file, and do not run `task generate` (Task 4 does). Until Task 4,
`gotypes.d.ts` and `wshclientapi.ts` keep their Radar types and RPC calls, which is harmless (a superset).

**Interfaces:**
- Produces: `SurfaceKey` without `"radar"`; `SURFACE_ORDER = ["cockpit", "jarvis", "agent", "usage", "code", "files"]`
  (so `Ctrl+1..6`); `TOOL_ITEMS` = Code, Diff; `coerceStartupSurface(k)` returns `"cockpit"` for anything not in
  `SURFACE_ORDER` (after the existing `activity`/`sessions` → `agent` mapping). Task 3's scenarios assert these.

- [ ] **Step 1: Write the failing tests**

In `cockpitprefsstore.test.ts`, replace the two `radar` expectations (lines 51, 128) with:

```ts
expect(bootSurface("last", "radar")).toBe("cockpit");
expect(coerceStartupSurface("radar" as SurfaceKey)).toBe("cockpit");
expect(bootSurface("radar" as StartupSurface, null)).toBe("cockpit");
```

Line 63 (`bootSurface("activity", "radar")` → `"agent"`) stays as it is. In `uiapi.test.ts`, add a test that the
surface parser (the function around `uiapi.ts:103`) returns `{ error }` whose text starts `unknown surface "radar"`
for `surface:radar`, and that the `radar` case and `radarReportId` are gone from the context it builds.

- [ ] **Step 2: Run them to see the startup ones fail**

Run: `npx vitest run frontend/app/view/agents/cockpitprefsstore.test.ts frontend/app/cockpit/uiapi.test.ts`
Expected: FAIL (`coerceStartupSurface` returns `"radar"`; `surface:radar` still resolves).

- [ ] **Step 3: Delete the Radar files and cut every caller**

Delete the 17 `radar*` / `peekradar*` files listed first in Files. Then, grepping `radar` (case-insensitive) under
`frontend/` after each group:

- **Surface:** `"radar"` out of `SurfaceKey` and `SURFACE_ORDER` (`agents.tsx:44`, `:50`); the `Radar` icon, the
  `radar` icon map entry, the `TOOL_ITEMS` entry and the `radar` badge count in `navrail.tsx` (and the badge comment at
  `:170`); the `RadarSurface` branch in `cockpitshell.tsx`; the entry in `surfacecontext.ts`; the `g r` leader entry
  and the `ESC_HOME_SURFACES` member in `bindings.ts` (`:238`, `:263`). Comments saying `Ctrl+1..7` (navrail `:60`,
  `:200`) say `Ctrl+1..6`. The pinned apps' comments that say "under Radar" (navrail `:202`, `railapps.ts:4`) and
  `toolslibrary.tsx:684`'s row text say "under Diff".
- **Addresses and opening:** `radarreport` out of `jarvis/address.ts`; the `radar` target out of `jarvis/openref.ts`
  (the `radarstore` import and every branch using it); `PeekRadarBody` out of `peek/peekregistry.ts`; the `radar`
  noun out of `peekitemmodel.ts`; `radarReportId` and the `radar` case out of `cockpit/uiapi.ts`, and the
  `currentReportIdAtom` read out of `uiclient.ts`. The `anchor` hint stays (`task:` records use it).
- **Attention kind `radar-triage`:** `attentionstore.ts` loses the `radar` bucket (the split returns
  `{ cockpit, jarvis }`); `palette-needs.ts` `DROPPED_KIND`, `petpeekmodel.ts` `PEEK_EXCLUDED_KIND`,
  `briefrows.ts` `REMINDER_KINDS`' `"radar-triage"`, and in `briefingmodel.ts` the `radar` nav kind,
  `"radar-triage": "triage"`, the `radarORef` branch and `case "radar-triage"` go. `dueORef` and `councilORef` stay.
- **Start-investigation handoff:** `pendingRunDraftAtom`, the `PendingRunDraft` import and the `radarOrigin` option
  in `runactions.ts`; the pending-draft branches of `briefsheet.tsx` (`radarDraft`) and `briefsurface.tsx` (the
  effect that lands a draft); `radarDraftLanding` in `newrun.ts`. `resolveTargetChannel` stays (callers in
  `projectsstore.ts`, `newrun.ts`); reword its Radar comment in `channelderive.ts`.
- **Settings:** the Radar card (`headless.radaraudit`, `headless.radarclassify`) in `settingsmodel.ts` (`:631`) and
  `settingspages/backgroundai.tsx` (`:238`), the `RADAR_*` constants, `radarAuditRoute`, `radarClassifyDefault`, and
  "and the route Radar audits run on" in both blurbs (`settingsmodel.ts:593`, `backgroundai.tsx:5`).
- **Helpers:** `joinAnd` moves from `radarmodel.ts` into `jarvis/runtiming.ts` as a local function (its only caller).
  Delete `ambientRefForFinding` and its test in `ambient.ts`.
- **Comments only:** `ambient.ts:25`, `ambientstore.ts:47`, `conversationhistory.tsx:255`, `divergencebanner.tsx:4`,
  `notifyevents.ts:59`, `route.ts:184`, `surfacescaffold.tsx:75`, `codestore.ts:1362`.
- **Tests:** delete the cases that only cover Radar (radar-triage routing, `g r`, the Radar card, radar addresses and
  openref landings); move the cases that used `"radar"` as a `SurfaceKey` (`returnsurface.test.ts:91`,
  `bindings.test.ts` cycle and `Mod+7`, `store.test.ts:109`, `surfaceorder.test.ts`) to the new order: `[`/`]` wraps
  from `files` to `cockpit`, `Mod+6` is Diff, `TOOL_ITEMS` keys are `["code", "files"]`.

- [ ] **Step 4: Make `coerceStartupSurface` fall back to the cockpit**

In `cockpitprefsstore.ts`, after the `activity`/`sessions` mapping, return `"cockpit"` for any key not in
`SURFACE_ORDER`; fix the comment above `bootSurface` that says only "last" is untrusted.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run` then `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (give it a 4-minute timeout).
Expected: both clean. Then `git grep -i -l radar -- frontend` lists only `frontend/types/gotypes.d.ts`,
`frontend/app/store/wshclientapi.ts` and the sample-text files in Global Constraints.

- [ ] **Step 6: Lint the touched files**

Run: `npx eslint <touched files>` and `npx prettier --check <touched .ts/.tsx files>`. Expected: no new errors.
Do not try the CDP scenarios here: they still name Radar until Task 3 merges; Final judges the UI after the merge.

- [ ] **Step 7: Commit**

`git add -A frontend && git commit -m "refactor(cockpit): retire the Radar surface from the frontend"`

### Task 2: Remove Radar from the backend
**Depends on:** none
**Files:** `pkg/reporadar/acceptance_test.go`, `pkg/reporadar/audit.go`, `pkg/reporadar/audit_test.go`, `pkg/reporadar/audittypes.go`, `pkg/reporadar/audittypes_test.go`, `pkg/reporadar/classify.go`, `pkg/reporadar/classify_test.go`, `pkg/reporadar/command.go`, `pkg/reporadar/command_test.go`, `pkg/reporadar/disposition_test.go`, `pkg/reporadar/fixcommits.go`, `pkg/reporadar/fixcommits_test.go`, `pkg/reporadar/gitexec.go`, `pkg/reporadar/hits.go`, `pkg/reporadar/hits_test.go`, `pkg/reporadar/investigation.go`, `pkg/reporadar/investigation_test.go`, `pkg/reporadar/kinds.go`, `pkg/reporadar/kinds_test.go`, `pkg/reporadar/kindtypes.go`, `pkg/reporadar/kindtypes_test.go`, `pkg/reporadar/lifecycle.go`, `pkg/reporadar/lifecycle_test.go`, `pkg/reporadar/listreports_test.go`, `pkg/reporadar/maintest_test.go`, `pkg/reporadar/manager.go`, `pkg/reporadar/manager_test.go`, `pkg/reporadar/recover_test.go`, `pkg/reporadar/redact.go`, `pkg/reporadar/redact_test.go`, `pkg/reporadar/retry_test.go`, `pkg/reporadar/scan.go`, `pkg/reporadar/scan_finalize_test.go`, `pkg/reporadar/scan_test.go`, `pkg/reporadar/signal.go`, `pkg/reporadar/signal_test.go`, `pkg/reporadar/subsystem.go`, `pkg/reporadar/subsystem_test.go`, `pkg/reporadar/types.go`, `pkg/wshrpc/wshrpctypes_radar.go`, `pkg/wshrpc/wshserver/wshserver_radar.go`, `pkg/wstore/wstore_radarreport.go`, `pkg/wstore/wstore_radarreport_test.go`, `pkg/jarvis/attention_radar_test.go`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `pkg/jarvis/attention_due_test.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshrpctypes_runs.go`, `pkg/wshrpc/wshrpctypes_channels.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshclient/wshclient.go`, `pkg/waveobj/wtype.go`, `pkg/waveobj/wtype_test.go`, `pkg/wconfig/settingsconfig.go`, `pkg/wconfig/retiredkeys_test.go`, `cmd/server/main-server.go`, `cmd/server/main-server_test.go`, `cmd/wsh/cmd/wshcmd-ui.go`, `db/migrations-wstore/000028_drop_radarreport.up.sql`, `db/migrations-wstore/000028_drop_radarreport.down.sql`, `pkg/agentobserve/entrypoint.go`, `pkg/wavebase/wavebase.go`, `pkg/memhygiene/model.go`, `pkg/consult/consult.go`, `pkg/council/caller.go`, `pkg/wstore/wstore_channel.go`, `pkg/wstore/wstore_maintest_test.go`

Go only: touch no file under `frontend/`, no `schema/settings.json`, no `metaconsts.go`, and do not run
`task generate` (Task 4 does).

**Interfaces:**
- Produces: no `RadarCommands`, no `OType_RadarReport`, no `Radar*` types, no `Run.RadarOrigin`, no
  `AttentionRadarTriage`, no `radar:*` settings fields, migration `000028_drop_radarreport`. `AttentionItem.ORef`
  stays. Task 4 regenerates the bindings from this.

- [ ] **Step 1: Write the failing tests**

- `pkg/waveobj/wtype_test.go`: `TestRunDecodesRetiredRadarOrigin`: unmarshal
  `{"otype":"run","oid":"r1","radarorigin":{"reportid":"x","findingid":"f6","fingerprint":"RAD-1"}}` into `Run`;
  no error, `OID == "r1"`. (It passes today; it pins the decode once the field is gone.)
- `pkg/wconfig/retiredkeys_test.go`: `TestRetiredRadarKeysStillLoad`, shaped like `TestRetiredEmbedKeysStillLoad`
  beside it: `utilfn.ReUnmarshal` a `MetaMapType` of `radar:auditruntime: "pi"`, `radar:auditmodel: "x"`,
  `radar:classifymodel: "haiku"` and `term:fontsize: 13.0` into `SettingsType`; no error and `TermFontSize == 13`.
- Replace the radar-triage case in `pkg/jarvis/attention_due_test.go:107-115` with the same ordering check against a
  kind that stays ahead of `AttentionChunkDue` (read `attention.go`'s order; pick the next weakest kind above it).

- [ ] **Step 2: Run them**

Run: `go test ./pkg/waveobj -run '^TestRunDecodesRetiredRadarOrigin$'` and
`go test ./pkg/wconfig -run '^TestRetiredRadarKeysStillLoad$'`. Expected: PASS today (they guard the removal).

- [ ] **Step 3: Delete the Radar backend**

- Delete `pkg/reporadar/` (every file in Files), `pkg/wshrpc/wshrpctypes_radar.go`,
  `pkg/wshrpc/wshserver/wshserver_radar.go`, `pkg/wstore/wstore_radarreport.go` and its `_test.go`,
  `pkg/jarvis/attention_radar_test.go`.
- `pkg/wshrpc/wshrpctypes.go:54`: drop `RadarCommands`.
- `cmd/server/main-server.go`: drop the import, `"reporadar.RecoverInterruptedScans"` from the snapshot-skip list
  (`:99`), its call (`:565`), and "radar" from the comment at `:595`; drop the same name from
  `cmd/server/main-server_test.go:38`.
- `pkg/wshrpc/wshserver/wshserver_runs.go`: remove the `RadarOrigin` write-back blocks and the
  `run.RadarOrigin = data.RadarOrigin` copy; drop `RadarOrigin` from the create-run request
  (`wshrpctypes_runs.go:48`).
- `pkg/waveobj/wtype.go`: remove `OType_RadarReport` (const and registered-types map), `RunRadarOrigin`,
  `Run.RadarOrigin`, every `Radar*` struct, `RadarReport` and its `reflect.TypeOf` registration. Delete the Radar
  tests in `wtype_test.go` (not the one from Step 1).
- `pkg/jarvis/attention.go`: remove `AttentionRadarTriage` and its comment, the `radar*` vocabulary constants
  (`:73-76`) and the mention in the comment above them, `AttentionInput.Radar`, `radarTriageItems` and its call
  (`:429`), and the `GetRadarReportsShared` read (`:998`). Fix `attention_test.go`'s radar-triage cases.
- `pkg/wshrpc/wshrpctypes_channels.go:111`: reword the `ORef` comment to name the kinds that set it now
  (`chunk-due`, `council`). Keep the field.
- Settings: remove `RadarAuditRuntime`, `RadarAuditModel`, `RadarClassifyModel` from
  `pkg/wconfig/settingsconfig.go:126-128`.
- Migration `db/migrations-wstore/000028_drop_radarreport.up.sql`: `DROP TABLE IF EXISTS db_radarreport;`; the
  `.down.sql` recreates it exactly as `000013_radarreport.up.sql` does (empty).
- `cmd/wsh/cmd/wshcmd-ui.go`: drop `radarreport:<id>` from the reveal help (`:46`, `:47`) and make the `--anchor`
  help "sub-object to land on (a record's section)".
- Comments only: `pkg/agentobserve/entrypoint.go:8`, `pkg/wavebase/wavebase.go:267`, `pkg/memhygiene/model.go:88`,
  `pkg/consult/consult.go:386`, `pkg/council/caller.go:64`, `pkg/wstore/wstore_channel.go:43`, `:504`,
  `pkg/wstore/wstore_maintest_test.go:15`.
- `pkg/wshrpc/wshclient/wshclient.go`: delete the Radar command functions by hand (the one sanctioned exception,
  Global Constraints).

- [ ] **Step 4: Build, vet and test**

Run: `go build ./...`, `go vet ./pkg/jarvis ./pkg/waveobj ./pkg/wstore ./pkg/wconfig ./pkg/wshrpc/... ./cmd/...`,
then `git diff --name-only main > /tmp/retire-radar-changed && ARC_VERIFY_CHANGED=/tmp/retire-radar-changed node scripts/verify.mjs ./pkg/jarvis ./pkg/waveobj ./pkg/wstore ./pkg/wconfig ./pkg/wshrpc/... ./cmd/...`.
Expected: all clean, the two Step 1 tests PASS. Then
`git grep -i -l radar -- pkg cmd ':!pkg/wconfig/metaconsts.go'` lists only the sample-text test files named in
Global Constraints.

- [ ] **Step 5: Format and commit**

`gofmt -l` on the touched Go files prints nothing. Then
`git add -A pkg cmd db && git commit -m "refactor(radar): remove Radar from the backend, drop db_radarreport"`

### Task 3: CDP scenarios, docs and the cockpit skill
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`, `scripts/cdp/attach.mjs`, `skills/cockpit/SKILL.md`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/keyboard-shortcuts.md`, `docs/reference/architecture.md`, `docs/open-issues.md`, `docs/deferred.md`, `docs/guide/radar.md`, `docs/guide/images/radar-clean.png`, `docs/guide/images/radar-dismiss-menu.png`, `docs/guide/images/radar-results.png`, `docs/guide/images/radar-scanning.png`, `docs/guide/README.md`, `docs/guide/getting-started.md`, `docs/guide/cockpit.md`, `docs/guide/code.md`, `docs/guide/diff.md`, `docs/guide/agent.md`, `docs/guide/settings.md`

No app code. The scenarios cannot pass on this branch alone (the Radar UI is there until Task 1 merges); Final runs
them on the merged result.

**Interfaces:**
- Consumes: Task 1's `SURFACE_ORDER` (six surfaces, `Ctrl+1..6`), `TOOL_ITEMS` Code and Diff, no `g r`, no Radar
  card in Settings > Headless AI.

- [ ] **Step 1: Delete the Radar scenarios**

In `scripts/cdp/scenarios.mjs` delete `radar-start-investigation`, `radar-report`, `radar-scan-states` and
`ambient-tags` (its only subject is a Radar finding), their helpers and their entries in the exported list
(around line 70458).

- [ ] **Step 2: Turn `settings-radar-audit` into `settings-headless`**

Rename it (constant and exported-list entry too), drop the arrange/teardown of the `radar:*` keys. Steps:
1. Settings opens on the Headless AI section (keep the current step 1);
2. the section has no `[data-setting-row="headless.radaraudit"]` and no `headless.radarclassify`, and its text has
   no "Radar";
3. the section still lists its other cards (`runtime`, `openrouter`);
then a shot `cdp-shots/settings-headless.png`. Rename the pane constant it keeps; delete the other `RADAR_AUDIT_*`
helpers.

- [ ] **Step 3: Rework the scenarios that mention Radar**

- `surface-smoke`: drop `"radar"` from `SMOKE_SURFACES` (line 179). After the per-surface loop add three steps:
  - "nav rail lists no Radar": the nav buttons' labels include no "Radar", and the core and tool labels equal
    Cockpit, Jarvis, Agent, Usage, Code, Diff in that order;
  - "Ctrl+6 lands on Diff": from `cockpit`, dispatch Ctrl+6 the way the scenarios already send Ctrl+P
    (`new KeyboardEvent('keydown', { key: '6', code: 'Digit6', ctrlKey: true, bubbles: true })` on `document`) and
    assert the active nav label is Diff; then Ctrl+7 leaves the surface on Diff;
  - "g r does nothing": from `cockpit`, send the go-to leader then `r` the same way; the surface stays `cockpit`, and
    the which-key overlay, if it opened, lists no Radar. Close it with Escape.
- `agent-history` (step 12, around line 17481): the rail has six surfaces in two groups and `Ctrl+6` opens Diff; drop
  the `onRadar` probe.
- `agent-rail-tabs` (line 38137): the expected nav labels lose "Radar".
- `agent-tree-quick-return` (comment at line 16796): reword without Radar.
- `settings-pages`: the `headless` page's cards (line 52890) lose `"radar"`.
- `peek-item-views`: drop the radar seed (`seedPeekItemsRadar`), its steps and teardown step; renumber.
- `resource-linking`: drop the `radarreport:` landings and the `listradarreports` lookup in arrange; renumber.
- `dag-peek` final-shots fixtures (line 23292): remove the `radar` capture key (move `"receipt"` to another surface's
  capture list), `"surface-radar"` from the `surface-smoke` board row and its goto step (line 23319), and the
  `resource-linking` board's Radar step (line 23373).
- Then delete the helpers nothing uses any more (`radarFixtureReport`, `seedRadarReport`, `dropPeekItemsRadar`,
  `RADAR_FIXTURE_*`, `peekRadarHeadings` and any other `radar*` helper grep finds), and `radar: "Radar"` from
  `SURFACE_LABEL` in `scripts/cdp/attach.mjs`.

`git grep -n -i radar -- scripts/cdp/scenarios.mjs scripts/cdp/attach.mjs` must print only the "no Radar" assertions
you just wrote.

- [ ] **Step 4: Check the scripts parse**

Run: `node --check scripts/cdp/scenarios.mjs && node --check scripts/cdp/attach.mjs`. Expected: no output, exit 0.
Do not run prettier on them.

- [ ] **Step 5: Docs, the skill and the changelog**

- `skills/cockpit/SKILL.md`: drop "a radar finding" from the description, `radarreport:<id> [--anchor <findingId>]`
  and `radar` from the surface list (lines 3, 12, 13). It is embedded by `skills/skills.go`; no copy to sync.
- `README.md:37`: drop the Radar row.
- `AGENTS.md`: in the nav-badges sentence (line 178) drop "Radar the projects with untriaged findings,"; line 224's
  "under Radar" becomes "under Diff".
- `docs/keyboard-shortcuts.md`: `Mod+1…6` in the order Cockpit, Jarvis, Agent, Usage, Code, Diff; drop `Mod+G r`;
  drop Radar from the Esc line; drop "radar finding" from the peek line.
- `docs/reference/architecture.md`: drop the Radar bullet (line 33) and `_radar` from the wshrpctypes list (line 21).
- User guide (Vietnamese; keep the language): delete `docs/guide/radar.md` and its four `docs/guide/images/radar-*.png`;
  drop its rows in `docs/guide/README.md:21`, `getting-started.md:164`, `code.md:172`, `settings.md:186`. In
  `cockpit.md`: drop Radar from the Esc list (33) and the subject list (279), the tools row is **Code**, **Diff** with
  `Ctrl+5` … `Ctrl+6` (330), drop `` `r` Radar`` (333) and the badge row (341), and the pinned apps sit "Dưới **Diff**"
  (347). `code.md:13` and `diff.md:17`: "(Code, Diff)". `agent.md:262`: "dưới Diff". `settings.md:29`: drop
  "audit Radar" from the list; `settings.md:118`: drop Radar from the Startup surface choices.
- `docs/open-issues.md`: remove the "Radar:" block (lines 220-227).
- `docs/deferred.md`: replace the three Radar sections (Security review audits, Missing test coverage audits,
  Metadata collectors and clustering pipeline) with one `## Radar (retired 2026-11-13)` entry: the Why numbers
  above, the fork's 10-21 numbers in one line, the revive condition (a fix-sibling check is wanted again; prefer a
  step after a `fix:` commit in an agent over a surface), and recovery with `git show 2a13c415d:<path>` for
  `pkg/reporadar/`, the frontend `radar*` files and the audit prompts in `pkg/reporadar/audit.go` / `kinds.go`. Keep
  the existing `78fe087a` collector recovery line inside it. In the "Code and Diff out of the nav rail" entry
  (around line 498) drop Radar from the tools group and "(Radar becomes Ctrl+5)". Other passing mentions of Radar as
  history stay.
- `CHANGELOG.md`: one line under `Changed` in the top `Unreleased` section (open one per the file's header if the
  top section has a date): `- **Radar is gone**: the surface, its badge, \`Ctrl+G r\` and its Settings rows are
  removed; \`Ctrl+1\`…\`Ctrl+6\` now cover the six surfaces left, and pinned apps sit under Diff.`

- [ ] **Step 6: Commit**

`git add -A scripts/cdp skills README.md AGENTS.md CHANGELOG.md docs && git commit -m "chore(radar): retire Radar from the CDP scenarios, docs and cockpit skill"`

### Task 4: Regenerate bindings
**Depends on:** Task 1 (its frontend no longer reads the Radar types the regeneration drops), Task 2
**Files:** `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `pkg/wconfig/metaconsts.go`, `schema/settings.json`

Task 2 removed the Go types and Task 1 the frontend reads of them; this regenerates what both depend on.

- [ ] **Step 1: Regenerate**

Run: `task generate`. It rewrites the five files in Files (`schema/settings.json` through its `build:schema` step);
never hand-edit them.

- [ ] **Step 2: Confirm nothing Radar is left in them**

Run: `git grep -i radar -- frontend/types frontend/app/store pkg/wshrpc/wshclient pkg/wconfig/metaconsts.go schema/settings.json`
Expected: empty.

- [ ] **Step 3: Build, typecheck and test**

Run: `go build ./...`, `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (4-minute timeout) and `npx vitest run`.
Expected: all clean. Then `git grep -i -l radar -- pkg cmd frontend` lists only the sample-text files named in
Global Constraints.

- [ ] **Step 4: Commit**

`git add -A frontend/types frontend/app/store pkg/wshrpc/wshclient pkg/wconfig/metaconsts.go schema/settings.json && git commit -m "chore(radar): regenerate bindings without Radar"`
