# Brief Run Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jarvis's Brief draws the run queue inside Runs: a queued plan sits under the run (or queued plan) it waits
on, a room-only one at the end; a queued row opens a queue sheet with what it waits on and Start now / Run next /
Remove; and a run started from the queue remembers what it was queued after.

**Architecture:** Go: `runqueue:changed` gains `started: [{entryid, runid}]`, and a queued start copies a run After
onto the new run as `Run.AfterRunId` (through `CommandCreateRunData.AfterRunId`). Frontend: a new pure
`frontend/app/view/jarvis/briefqueue.ts` places the queued lines among the Runs lines (`withQueuedLines`) and words
the queue sheet (`queueSheetModel`); `briefqueuestore.ts` holds the open entry; `briefsurface.tsx` draws the lines
with a new `QueuedRunRowView`; `briefqueuesheet.tsx` is the sheet body, routed by a new `queued` face in
`briefsheetmodel.ts`; `runsheet.tsx` prints `queued after <run>`.

**Tech Stack:** Go, React 19 + Tailwind 4 + jotai, vitest, the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-16-brief-run-queue-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/... ./pkg/runqueue ./pkg/waveobj`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs brief-run-queue run-queue brief-surface`

## Global Constraints

- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`, …): change the Go types, then run `task generate`.
- Colours come from `@theme` tokens (`frontend/tailwindsetup.css`) through the existing class recipes
  (`TONE_TEXT`, `FAINT_TEXT`, `SMALL_BTN`, `ROW_BORDER`, `CURSOR_RING` in `briefrowviews.tsx` / `briefstyle.ts`); a
  blocked entry uses `text-warning`, as the Agent tree's queued row does (`agenttree.tsx:2106`). No raw hex.
- Pure logic in `.ts` with a `.test.ts` beside it; no jsdom render tests (AGENTS.md, "Frontend conventions").
- The Brief's attention list already owns the word "queue": `LineTarget`'s `{ queue: … }` is a *Waiting on you* item
  (`briefrows.ts:33`). The run queue's target is `{ runQueue: <entry id> }`; never reuse `queue`.
- Run a single test file with `npx vitest run <file>`, one Go test with `go test ./pkg/x -run '^TestName$'`. The
  typecheck is the Check line above (~2 min: give it a 5-minute timeout).
- Commit with a pathspec: `git commit -m "<msg>" -- <paths>` (add new files with `git add -- <paths>` first). Never
  leave files staged. No Co-Authored-By trailer.

---

### Task 1: `started` on `runqueue:changed`, and `Run.AfterRunId`

**Depends on:** none

**Files:** `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/wshrpc/wshrpctypes_runs.go`, `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `frontend/types/gotypes.d.ts`

- [ ] **Step 1: Make the test world record the whole event**

In `wshserver_runqueue_test.go`, the `queueWorld` stores what `runQueuePublish` received (`published
[][]wshrpc.RunQueueEntry`, line 36; the seam at line 74). Change the field to `published []wshrpc.RunQueueChangedData`,
the seam to `func(data wshrpc.RunQueueChangedData) { …; w.published = append(w.published, data) }`, and keep the two
helpers' answers:

```go
func (w *queueWorld) lastPublished() []wshrpc.RunQueueEntry {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.published) == 0 {
		return nil
	}
	return w.published[len(w.published)-1].Entries
}

// startedIn is every Started pair the publishes carried, in order.
func (w *queueWorld) startedIn() []wshrpc.RunQueueStarted {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []wshrpc.RunQueueStarted
	for _, d := range w.published {
		out = append(out, d.Started...)
	}
	return out
}
```

- [ ] **Step 2: Write the failing tests**

Add to `wshserver_runqueue_test.go`:

```go
func TestRunQueueStartPublishesWhichRunTheEntryBecame(t *testing.T) {
	w := useQueueWorld(t)
	e := queueEntry(t, "Alpha", "")
	evaluateRunQueue(context.Background())

	got := w.startedIn()
	if len(got) != 1 || got[0].EntryId != e.Id || got[0].RunId != w.runId(1) {
		t.Fatalf("want one started pair %s -> %s, got %+v", e.Id, w.runId(1), got)
	}
}

func TestRunQueueFailedStartPublishesNoStarted(t *testing.T) {
	w := useQueueWorld(t)
	w.createErr = errors.New("no worktree")
	queueEntry(t, "Alpha", "")
	evaluateRunQueue(context.Background())

	if got := w.startedIn(); len(got) != 0 {
		t.Fatalf("a failed start names no run, got %+v", got)
	}
	if w.publishCount() == 0 {
		t.Fatalf("the block is still published")
	}
}

func TestRunQueueStartCarriesARunAfterOntoTheRun(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "r1", Goal: "Learned additions", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	queueEntry(t, "Alpha", "r1")
	evaluateRunQueue(context.Background())

	if len(w.created) != 1 || w.created[0].AfterRunId != "r1" {
		t.Fatalf("the start carries AfterRunId r1, got %+v", w.created)
	}
}

func TestRunQueueStartNowPastAQueuedAfterCarriesNoAfterRun(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 0
	a := queueEntry(t, "Alpha", "")
	b := queueEntry(t, "Beta", a.Id)
	if err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: b.Id}); err != nil {
		t.Fatalf("StartNow(B): %v", err)
	}
	if len(w.created) != 1 || w.created[0].Goal != "Beta" || w.created[0].AfterRunId != "" {
		t.Fatalf("an After that still names an entry is no run to remember, got %+v", w.created)
	}
}
```

Before writing the last test, read `TestRunQueueStartNowStartsPastAFullCapAndAnUnlandedAfter` (line 462) and copy how
it sets the cap and calls Start now; adjust the lines above to match it (field and command names) rather than
guessing. Add `"errors"` to the imports if the file lacks it.

- [ ] **Step 3: Run them to see them fail**

Run: `go test ./pkg/wshrpc/wshserver -run 'TestRunQueue(StartPublishes|FailedStartPublishes|StartCarries|StartNowPastAQueued)'`
Expected: build failure (`wshrpc.RunQueueStarted` undefined, `AfterRunId` unknown field).

- [ ] **Step 4: The types**

In `pkg/wshrpc/wshrpctypes_runqueue.go`, replace `RunQueueChangedData`:

```go
// RunQueueChangedData is the runqueue:changed event: the whole list, after every change the server makes to it.
// Started names the run each entry this change started became, so a view open on that entry can follow it; it is
// empty for every other change.
type RunQueueChangedData struct {
	Entries []RunQueueEntry   `json:"entries"`
	Started []RunQueueStarted `json:"started,omitempty"`
}

// RunQueueStarted pairs a queue entry with the run its start created.
type RunQueueStarted struct {
	EntryId string `json:"entryid"`
	RunId   string `json:"runid"`
}
```

In `pkg/wshrpc/wshrpctypes_runs.go`, in `CommandCreateRunData` after `OriginTabId` (line 60):

```go
	// AfterRunId is the run a queued start waited After, set by the run queue when it starts the entry; the run
	// keeps it (Run.AfterRunId). Empty for every other start.
	AfterRunId string `json:"afterrunid,omitempty"`
```

In `pkg/waveobj/wtype.go`, in `Run` after `OriginTranscript` (line 267):

```go
	// AfterRunId is the run this one was queued After (`wsh runs start --after`), so its sheet can say what it
	// waited on once the queue entry is gone. Empty for a run that did not come from the queue with a run After.
	AfterRunId string `json:"afterrunid,omitempty"`
```

`Run` is stored as JSON: no migration.

- [ ] **Step 5: The server**

In `wshserver_runqueue.go`:

- the seam (line 55) becomes
  ```go
  runQueuePublish = func(data wshrpc.RunQueueChangedData) {
  	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_RunQueueChanged, Data: data})
  }
  ```
- `publishRunQueue` (line 279) takes the pairs: `func publishRunQueue(started ...wshrpc.RunQueueStarted)` and ends
  `runQueuePublish(wshrpc.RunQueueChangedData{Entries: entries, Started: started})`. Its other callers stay as they
  are.
- in `startQueuedEntry` (line 219), before `runQueueCreateRun`:
  ```go
  	data := e.Data
  	// a queue entry id is "q-" + hex (RunQueueEntry.Id); an After still naming one (only Start now starts an entry
  	// past its After) is no run to remember
  	if e.After != "" && !strings.HasPrefix(e.After, "q-") {
  		data.AfterRunId = e.After
  	}
  	rtn, err := runQueueCreateRun(sctx, data)
  ```
  and the success path's last `publishRunQueue()` becomes
  `publishRunQueue(wshrpc.RunQueueStarted{EntryId: e.Id, RunId: run.ID})`. Add `"strings"` to the imports if
  missing.

In `wshserver_runs.go`, after `run.OriginTabId = data.OriginTabId` (line 501): `run.AfterRunId = data.AfterRunId`.

- [ ] **Step 6: Regenerate and run the tests**

Run: `task generate`, then `go test ./pkg/wshrpc/wshserver -run 'TestRunQueue'`
Expected: PASS, the four new tests and every existing `TestRunQueue*`. `git diff --stat` shows
`frontend/types/gotypes.d.ts` gained `afterrunid` on `Run` and `CommandCreateRunData`, `started` on
`RunQueueChangedData`, and the type `RunQueueStarted`.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(runqueue): runqueue:changed names the run a start became; a run remembers its run After" -- pkg/wshrpc/wshrpctypes_runqueue.go pkg/wshrpc/wshrpctypes_runs.go pkg/waveobj/wtype.go pkg/wshrpc/wshserver/wshserver_runqueue.go pkg/wshrpc/wshserver/wshserver_runqueue_test.go pkg/wshrpc/wshserver/wshserver_runs.go frontend/types/gotypes.d.ts
```

(Add any other file `task generate` changed to the pathspec; it should touch only `gotypes.d.ts` for these types.)

---

### Task 2: The pure model, `briefqueue.ts`

**Depends on:** none

**Files:** `frontend/app/view/jarvis/briefqueue.ts`, `frontend/app/view/jarvis/briefqueue.test.ts`, `frontend/app/view/jarvis/briefrows.ts`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/agents/runqueuemodel.ts`, `frontend/app/view/agents/runqueuemodel.test.ts`

What each file is for:
- Create: `briefqueue.ts` — `withQueuedLines` (Runs lines with the queued lines placed among them) and
  `queueSheetModel` (the sheet's lines).
- Modify: `briefrows.ts` — `LineTarget` gains `{ runQueue: string }`, `BriefLine` gains `queued?: QueuedFace`,
  `lineOpenTarget` returns `null` for a run-queue target (Space has nothing to peek).
- Modify: `runqueuemodel.ts` — export `queuedRoute(entry)`, the tooltip's route line, so the sheet words it the same.
- Modify: `briefsurface.tsx` — only the one-line `openLine` stub of Step 2, so the new `LineTarget` arm compiles.

- [ ] **Step 1: `queuedRoute` in runqueuemodel.ts**

Add a test to `runqueuemodel.test.ts` beside the `queuedTooltip` tests (line ~198), using the entries those tests
build: `expect(queuedRoute(e)).toBe("Lead pi · Workers same as lead")` for the entry whose tooltip's second line is
that today. Then in `runqueuemodel.ts` lift the two route lines out of `queuedTooltip`:

```ts
/** Pure: the lead and worker route a queued entry will run with, fixed at queue time: the models the person approved. */
export function queuedRoute(entry: RunQueueEntry): string {
    const { data } = entry;
    const lead = [data.runtime, data.model].filter(Boolean).join(" · ");
    const route = data.workerroute;
    const workers = route ? [route.runtime, route.model].filter(Boolean).join(" · ") : "same as lead";
    return `Lead ${lead} · Workers ${workers}`;
}
```

and have `queuedTooltip` use `queuedRoute(entry)` for its second line. Run
`npx vitest run frontend/app/view/agents/runqueuemodel.test.ts`: PASS.

- [ ] **Step 2: The `briefrows.ts` types**

```ts
export type LineTarget = { queue: QueueOpenTarget } | { oref: string } | { runQueue: string } | null;
```

Add to `BriefLine` (after `subCount?`):

```ts
    // a run-queue entry drawn among the Runs (briefqueue.ts): its id, whether it is blocked and why
    queued?: QueuedFace;
```

with, above `BriefLine`:

```ts
export type QueuedFace = { entryId: string; blocked: boolean; reason: string };
```

In `lineOpenTarget`, first line after the null check: `if ("runQueue" in target) { return null; }`.

Run the typecheck (Check line). Every `"oref" in target` / `"queue" in target` site must still compile; fix any
narrowing error by handling `runQueue` the way `lineOpenTarget` does. `briefsurface.tsx`'s `openLine` (line 1348)
gets its real branch in Task 3; for now make it `if ("runQueue" in target) { return; }` so it compiles.

- [ ] **Step 3: Write the failing tests for `withQueuedLines`**

Create `briefqueue.test.ts`. Build entries and rows with the real helpers so the place and After resolution are
`queuedRows`'s:

```ts
import { describe, expect, it } from "vitest";
import { queuedRows } from "@/app/view/agents/runqueuemodel";
import type { BriefLine } from "./briefrows";
import { ACTIVE_CAP } from "./briefingmodel";
import { liveRunCount, queueSheetModel, withQueuedLines } from "./briefqueue";

const NOW = 1_700_000_000_000;

function entry(id: string, over: Partial<RunQueueEntry> = {}): RunQueueEntry {
    return {
        id,
        title: `Plan ${id}`,
        projectpath: "/p/arcterm",
        queuedts: NOW - 4 * 60_000,
        state: "waiting",
        data: { channelid: "ch", workspaceid: "ws", runtime: "claude", mode: "orchestrator", planpath: `/p/${id}.md` },
        ...over,
    } as RunQueueEntry;
}

function runLine(runOid: string, title: string): BriefLine {
    return {
        id: "sessions:run:" + runOid, kind: "▶ run", kindTone: "active", title, note: "", meta: "", state: "working",
        stateTone: "ok", progress: null, target: { oref: "run:" + runOid }, why: "", age: "", detail: "", runOid,
    };
}

const rowsOf = (entries: RunQueueEntry[], titles: Record<string, string> = {}, landed = new Set<string>()) =>
    queuedRows(entries, titles, landed);
const ids = (lines: BriefLine[]) => lines.map((l) => l.queued?.entryId ?? l.runOid);
const depthOf = (lines: BriefLine[], id: string) => lines.find((l) => l.queued?.entryId === id)?.depth ?? -1;
const lineOf = (lines: BriefLine[], id: string) => lines.find((l) => l.queued?.entryId === id)!;

describe("withQueuedLines", () => {
    it("nests an entry under the run it waits on, right after that run", () => {
        const runs = [runLine("r1", "Board"), runLine("r2", "Other")];
        const out = withQueuedLines(runs, rowsOf([entry("q-a", { after: "r1" })], { r1: "Board" }), "all", "", NOW);
        expect(ids(out)).toEqual(["r1", "q-a", "r2"]);
        expect(depthOf(out, "q-a")).toBe(1);
        expect(lineOf(out, "q-a").kind).toBe("↳ queued");
        expect(lineOf(out, "q-a").meta).toBe("after it lands");
    });

    it("nests a chain one level per link", () => {
        const e = [entry("q-a", { after: "r1" }), entry("q-b", { after: "q-a" }), entry("q-c", { after: "q-b" })];
        const out = withQueuedLines([runLine("r1", "Board")], rowsOf(e, { r1: "Board" }), "all", "", NOW);
        expect(ids(out)).toEqual(["r1", "q-a", "q-b", "q-c"]);
        expect([depthOf(out, "q-a"), depthOf(out, "q-b"), depthOf(out, "q-c")]).toEqual([1, 2, 3]);
    });

    it("puts an entry whose run is not drawn at the top, naming the run", () => {
        const out = withQueuedLines([], rowsOf([entry("q-a", { after: "r9" })], { r9: "Board" }), "all", "", NOW);
        expect(depthOf(out, "q-a")).toBe(0);
        expect(lineOf(out, "q-a").kind).toBe("⏸ queued");
        expect(lineOf(out, "q-a").meta).toBe("after Board");
    });

    it("puts room-only entries after every run, in queue order", () => {
        const e = [entry("q-a"), entry("q-b", { after: "r1" }), entry("q-c")];
        const out = withQueuedLines([runLine("r1", "Board")], rowsOf(e, { r1: "Board" }), "all", "", NOW);
        expect(ids(out)).toEqual(["r1", "q-b", "q-a", "q-c"]);
        expect(lineOf(out, "q-a").meta).toBe("waiting for room");
        expect(lineOf(out, "q-a").state).toBe("#1");
        expect(lineOf(out, "q-c").state).toBe("#3");
    });

    it("treats an entry whose run has landed as waiting for room", () => {
        const out = withQueuedLines(
            [runLine("r1", "Board")],
            rowsOf([entry("q-a", { after: "r1" })], { r1: "Board" }, new Set(["r1"])),
            "all",
            "",
            NOW
        );
        expect(ids(out)).toEqual(["r1", "q-a"]);
        expect(depthOf(out, "q-a")).toBe(0);
        expect(lineOf(out, "q-a").meta).toBe("waiting for room");
    });

    it("marks a blocked entry, its reason kept for the tooltip", () => {
        const out = withQueuedLines([], rowsOf([entry("q-d", { state: "blocked", reason: "plan is gone" })]), "all", "", NOW);
        expect(lineOf(out, "q-d").state).toBe("blocked");
        expect(lineOf(out, "q-d").queued).toEqual({ entryId: "q-d", blocked: true, reason: "plan is gone" });
    });

    it("keeps an entry only when the run-kind toggle keeps its mode", () => {
        const e = [entry("q-a"), entry("q-q", { data: { channelid: "ch", workspaceid: "ws", mode: "quick", goal: "g" } as CommandCreateRunData })];
        expect(ids(withQueuedLines([], rowsOf(e), "orchestrator", "", NOW))).toEqual(["q-a"]);
        expect(ids(withQueuedLines([], rowsOf(e), "quick", "", NOW))).toEqual(["q-q"]);
    });

    it("filters by the search, and a child of a filtered-out entry stands at the top", () => {
        const e = [entry("q-a", { title: "Board follow-up" }), entry("q-b", { title: "Floors", after: "q-a" })];
        const out = withQueuedLines([], rowsOf(e), "all", "floors", NOW);
        expect(ids(out)).toEqual(["q-b"]);
        expect(depthOf(out, "q-b")).toBe(0);
        expect(lineOf(out, "q-b").meta).toBe("after Board follow-up");
    });

    it("targets the entry and leaves the run lines as they were", () => {
        const runs = [runLine("r1", "Board")];
        const out = withQueuedLines(runs, rowsOf([entry("q-a", { after: "r1" })], { r1: "Board" }), "all", "", NOW);
        expect(out[0]).toBe(runs[0]);
        expect(lineOf(out, "q-a").target).toEqual({ runQueue: "q-a" });
        expect(lineOf(out, "q-a").id).toBe("sessions:queued:q-a");
    });

    it("returns the run lines untouched when the queue is empty", () => {
        const runs = [runLine("r1", "Board")];
        expect(withQueuedLines(runs, [], "all", "", NOW)).toBe(runs);
    });

    // the Runs window (sessionWindow) caps and folds the runs before the queue joins them, so neither ACTIVE_CAP nor
    // `+N more` sees a queued line; and the region's "N live" counts running work only
    it("draws every queued entry past ACTIVE_CAP, and counts none of them live", () => {
        const runs = [runLine("r1", "Board"), { ...runLine("r2", "Old"), stale: true }];
        const e = Array.from({ length: ACTIVE_CAP + 2 }, (_, i) => entry(`q-${i}`));
        const out = withQueuedLines(runs, rowsOf(e), "all", "", NOW);
        expect(out).toHaveLength(runs.length + ACTIVE_CAP + 2);
        expect(liveRunCount(out)).toBe(1);
        expect(liveRunCount(runs)).toBe(1);
    });
});
```

- [ ] **Step 4: Write the failing tests for `queueSheetModel`**

Append:

```ts
describe("queueSheetModel", () => {
    const slots = { maxActive: 3, active: 3 };

    it("words an entry waiting on a run, with the run's stage", () => {
        const [row] = rowsOf([entry("q-a", { after: "r1" })], { r1: "Board" });
        const m = queueSheetModel(row, { ...slots, afterStage: "working 2/5", now: NOW });
        expect(m.chip).toBe("Waiting on a run");
        expect(m.waits).toEqual({ text: "Board · working 2/5", runId: "r1" });
        expect(m.plan).toBe("/p/q-a.md");
        expect(m.route).toBe("Lead claude · Workers same as lead");
        expect(m.queued).toBe("queued 4m ago");
        expect(m.runNext).toBe(false); // #1 has nowhere to go
    });

    it("words an entry waiting on another queued entry", () => {
        const rows = rowsOf([entry("q-a"), entry("q-b", { after: "q-a" })]);
        const m = queueSheetModel(rows[1], { ...slots, now: NOW });
        expect(m.chip).toBe("Waiting on a run");
        expect(m.waits).toEqual({ text: "Plan q-a", entryId: "q-a" });
        expect(m.runNext).toBe(true);
    });

    it("words a room-only entry by the slots", () => {
        const [row] = rowsOf([entry("q-a")]);
        expect(queueSheetModel(row, { ...slots, now: NOW }).waits).toEqual({ text: "a free slot (3 of 3 running)" });
        expect(queueSheetModel(row, { maxActive: 0, active: 2, now: NOW }).waits).toEqual({ text: "a free slot" });
        expect(queueSheetModel(row, { ...slots, now: NOW }).chip).toBe("Queued #1");
    });

    it("gives a blocked entry its whole reason", () => {
        const [row] = rowsOf([entry("q-d", { state: "blocked", reason: "the plan file is gone" })]);
        const m = queueSheetModel(row, { ...slots, now: NOW });
        expect(m.chip).toBe("Blocked");
        expect(m.blocked).toBe(true);
        expect(m.reason).toBe("the plan file is gone");
    });

    it("names the session that queued it when that tab is known", () => {
        const data = { ...entry("q-a").data, origintabid: "tab-1" } as CommandCreateRunData;
        const [row] = rowsOf([entry("q-a", { data })]);
        expect(queueSheetModel(row, { ...slots, originName: "arcterm · lead", now: NOW }).queuedBy).toEqual({
            tabId: "tab-1",
            name: "arcterm · lead",
        });
        // a tab no longer in the roster, or an entry queued from no session, names none
        expect(queueSheetModel(row, { ...slots, originName: null, now: NOW }).queuedBy).toBeNull();
        expect(queueSheetModel(rowsOf([entry("q-b")])[0], { ...slots, originName: "x", now: NOW }).queuedBy).toBeNull();
    });

    it("shows a quick run's goal where a plan would be", () => {
        const [row] = rowsOf([entry("q-q", { data: { channelid: "ch", workspaceid: "ws", mode: "quick", goal: "fix the tray" } as CommandCreateRunData })]);
        const m = queueSheetModel(row, { ...slots, now: NOW });
        expect(m.plan).toBeNull();
        expect(m.goal).toBe("fix the tray");
    });
});
```

- [ ] **Step 5: Run them to see them fail**

Run: `npx vitest run frontend/app/view/jarvis/briefqueue.test.ts`
Expected: FAIL, `./briefqueue` not found.

- [ ] **Step 6: Implement `briefqueue.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run queue in Jarvis's Brief (spec 2026-10-16-brief-run-queue-design.md): a queued plan drawn among the Runs,
// under the run or the queued plan it waits on (one level per link of a chain), a room-only one after every run; and
// the lines of the sheet a queued row opens. Pure: the rows come from runqueuemodel.ts's queuedRows, which already
// resolves each entry's place and its After's title.

import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { isBlockedEntry, queuedRoute, type QueuedRow } from "@/app/view/agents/runqueuemodel";
import { filterLines, keepsRunKind, type BriefLine, type RunKindFilter } from "./briefrows";

// what an entry waits on: a run or a queued entry that has not landed, or nothing but room
function waitsOn(row: QueuedRow): string | null {
    const after = row.entry.after;
    return after && !row.afterMet ? after : null;
}

function afterName(row: QueuedRow): string {
    return row.afterTitle ?? (row.entry.after ?? "").slice(0, 8);
}

function queuedLine(row: QueuedRow, depth: number, now: number): BriefLine {
    const { entry } = row;
    const blocked = isBlockedEntry(entry);
    const waits = waitsOn(row) != null;
    return {
        id: "sessions:queued:" + entry.id,
        kind: depth > 0 ? "↳ queued" : "⏸ queued",
        kindTone: "muted",
        title: entry.title,
        note: "",
        meta: !waits ? "waiting for room" : depth > 0 ? "after it lands" : `after ${afterName(row)}`,
        state: blocked ? "blocked" : `#${row.place}`,
        stateTone: "muted",
        progress: null,
        target: { runQueue: entry.id },
        why: "",
        age: formatAge(now - entry.queuedts),
        detail: "",
        depth,
        queued: { entryId: entry.id, blocked, reason: entry.reason ?? "" },
    };
}

/** Pure: the Runs lines with the queue placed among them. An entry follows the drawn run it waits on, or the queued
 *  entry it waits on, one level deeper per link; an entry whose parent is not drawn (filtered out, folded, gone)
 *  stands at the top naming it; room-only entries follow every run, in queue order. The run-kind toggle and the
 *  search apply to queued lines as to runs. */
export function withQueuedLines(
    runLines: BriefLine[],
    rows: readonly QueuedRow[],
    runKind: RunKindFilter,
    query: string,
    now: number
): BriefLine[] {
    if (rows.length === 0) {
        return runLines;
    }
    const kinded = rows.filter((r) => keepsRunKind(runKind, r.entry.data.mode ?? ""));
    // the search reads a line as it would stand at the top; nesting only changes its meta
    const matching = new Set(filterLines(kinded.map((r) => queuedLine(r, 0, now)), query).map((l) => l.queued!.entryId));
    const kept = kinded.filter((r) => matching.has(r.entry.id));
    const keptIds = new Set(kept.map((r) => r.entry.id));
    const drawnRuns = new Set(runLines.flatMap((l) => (l.runOid ? [l.runOid] : [])));
    const children = new Map<string, QueuedRow[]>();
    const top: QueuedRow[] = [];
    for (const r of kept) {
        const parent = waitsOn(r);
        if (parent != null && (drawnRuns.has(parent) || keptIds.has(parent))) {
            children.set(parent, [...(children.get(parent) ?? []), r]);
        } else {
            top.push(r);
        }
    }
    const out: BriefLine[] = [];
    const placed = new Set<string>();
    const place = (r: QueuedRow, depth: number) => {
        if (placed.has(r.entry.id)) {
            return;
        }
        placed.add(r.entry.id);
        out.push(queuedLine(r, depth, now));
        for (const child of children.get(r.entry.id) ?? []) {
            place(child, depth + 1);
        }
    };
    for (const l of runLines) {
        out.push(l);
        for (const child of (l.runOid ? children.get(l.runOid) : undefined) ?? []) {
            place(child, 1);
        }
    }
    for (const r of top) {
        place(r, 0);
    }
    // an entry chained into a loop never reaches a placed parent: it still shows, at the top
    for (const r of kept) {
        place(r, 0);
    }
    return out;
}

/** Pure: the Runs region's "N live": running work only, so neither a run folded as stale nor a queued plan counts. */
export function liveRunCount(lines: readonly BriefLine[]): number {
    return lines.filter((l) => !l.stale && l.queued == null).length;
}

export type QueueSheetModel = {
    chip: string;
    blocked: boolean;
    reason: string | null;
    // what it waits on; runId or entryId when that is something to open
    waits: { text: string; runId?: string; entryId?: string };
    plan: string | null;
    goal: string | null;
    route: string;
    queued: string;
    // the session that queued it, when its tab is in the roster
    queuedBy: { tabId: string; name: string } | null;
    runNext: boolean;
};

/** Pure: the queue sheet's lines. `afterStage` is the stage of the run it waits on, when it waits on a run that is
 *  loaded; maxActive and active are runs:maxactive (0 is no cap) and the active runs, from RunQueueList; originName is
 *  the roster's name for the entry's origintabid (useOriginName), null when that tab is not known. */
export function queueSheetModel(
    row: QueuedRow,
    i: { maxActive: number; active: number; afterStage?: string; originName?: string | null; now: number }
): QueueSheetModel {
    const { entry } = row;
    const blocked = isBlockedEntry(entry);
    const parent = waitsOn(row);
    const onEntry = parent != null && parent.startsWith("q-");
    const waits =
        parent == null
            ? { text: i.maxActive > 0 ? `a free slot (${i.active} of ${i.maxActive} running)` : "a free slot" }
            : onEntry
              ? { text: afterName(row), entryId: parent }
              : { text: i.afterStage ? `${afterName(row)} · ${i.afterStage}` : afterName(row), runId: parent };
    return {
        chip: blocked ? "Blocked" : parent != null ? "Waiting on a run" : `Queued #${row.place}`,
        blocked,
        reason: blocked ? entry.reason || null : null,
        waits,
        plan: entry.data.planpath || null,
        goal: entry.data.planpath ? null : entry.data.goal || null,
        route: queuedRoute(entry),
        queued: `queued ${formatAge(i.now - entry.queuedts)}`,
        queuedBy: entry.data.origintabid && i.originName ? { tabId: entry.data.origintabid, name: i.originName } : null,
        runNext: row.place != null && row.place > 1,
    };
}
```

Check `formatAge`'s output against the tests' `"4m ago"` (`agentsviewmodel.ts:387`): if it words four minutes
differently, change the two test expectations to its wording, not the helper.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run frontend/app/view/jarvis/briefqueue.test.ts frontend/app/view/jarvis/briefrows.test.ts frontend/app/view/agents/runqueuemodel.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -- frontend/app/view/jarvis/briefqueue.ts frontend/app/view/jarvis/briefqueue.test.ts
git commit -m "feat(brief): place the run queue among the Runs lines, and word its sheet" -- frontend/app/view/jarvis/briefqueue.ts frontend/app/view/jarvis/briefqueue.test.ts frontend/app/view/jarvis/briefrows.ts frontend/app/view/jarvis/briefsurface.tsx frontend/app/view/agents/runqueuemodel.ts frontend/app/view/agents/runqueuemodel.test.ts
```

---

### Task 3: Queued rows in the Brief's Runs

**Depends on:** Task 2

**Files:** `frontend/app/view/jarvis/briefqueuestore.ts`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/briefrowviews.tsx`

What each file is for:
- Create: `briefqueuestore.ts` — the open entry (`briefQueueSheetAtom`) and `openQueueSheet(entryId)`.
- Modify: `briefsurface.tsx` — feed the queue, merge the queued lines into `view.sessionLines`, draw them, open them.
- Modify: `briefrowviews.tsx` — `QueuedRunRowView`.

- [ ] **Step 1: The store**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The queue entry the Brief's sheet is open on. A queue entry is not an ActiveSubject (it would reach the subject
// store, restore and the palette), so the sheet reads it from here; opening any subject clears it (briefsheet.tsx).

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { briefSheetOpenAtom } from "./jarvisstore";
import { clearSubject } from "./jarvissubjectstore";

export const briefQueueSheetAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export function openQueueSheet(entryId: string): void {
    clearSubject();
    globalStore.set(briefQueueSheetAtom, entryId);
    globalStore.set(briefSheetOpenAtom, true);
}
```

- [ ] **Step 2: Feed and merge in `briefsurface.tsx`**

- Call `useRunQueueFeed()` (from `@/app/view/agents/runqueuestore`) at the top of `BriefSurface`. The Agent tree
  also calls it (`agenttree.tsx:2378`); two feeds set the same atom from the same event, which is harmless, and the
  Brief no longer depends on the tree being mounted.
- Read `const queued = useAtomValue(queuedRowsAtom);` (same module).
- In the `view` memo (line ~1058), after `sessionLines` is computed, replace it with
  `const sessionLines = withQueuedLines(runLines, queued, runKind, query, Date.now());` where `runLines` is today's
  expression, and add `queued`, `runKind` and `query` to the memo's deps.
- The Runs `Region`'s `empty` becomes `sessions.rows.length === 0 && queued.length === 0`.
- `openLine` (line 1348): replace Task 2's stub with
  `if ("runQueue" in target) { openQueueSheet(target.runQueue); return; }`.
- In the Runs map (line ~2246), draw a queued line with its own view, outside the motion wrapper:
  ```tsx
  {view.sessionLines.map((l) =>
      l.queued != null ? (
          <div key={l.id}>
              <QueuedRunRowView
                  line={l}
                  focused={cursor === l.id}
                  selected={sheetOpen && queueSheetId === l.queued.entryId}
                  onOpen={() => openLine(l.target)}
              />
          </div>
      ) : (
          <motion.div key={l.id} … /* as today */>
              <BriefRunRow … /* as today */ />
          </motion.div>
      )
  )}
  ```
  with `const queueSheetId = useAtomValue(briefQueueSheetAtom);`.
- `j`/`k` already walk `view.visible`, which spreads `sessionLines`: nothing to add. Check that Enter on a queued
  line opens its sheet (the "every other row opens its target" path at line ~1372 reaches `openLine`); if it reads
  `target.oref` directly anywhere, route it through `openLine`.
- `liveN` (line 1469) becomes `liveRunCount(view.sessionLines)` (Task 2), so "N live" still counts running work.
- No animation for a queued line (spec: an entry's row leaves and its run's row arrives with no animation): inside the
  Runs `AnimatePresence` map (line ~2245), a queued line renders as a plain keyed `<div key={l.id}>` holding
  `QueuedRunRowView`, never a `motion.div` (no `layout`, variants or exit); only run lines keep today's `motion.div`.
  A plain child of `AnimatePresence` has no exit to wait for, so it leaves at once.

- [ ] **Step 3: `QueuedRunRowView` in `briefrowviews.tsx`**

Beside `RunRowView`, the same row frame (`ROW_BORDER`, `cursorAttrs`, `CURSOR_RING`, `bg-surface-selected`), indented
like a nested initiative (`NEST_INDENT`, line 21):

```tsx
export function QueuedRunRowView({
    line,
    focused,
    selected,
    onOpen,
}: {
    line: BriefLine;
    focused: boolean;
    selected: boolean;
    onOpen: () => void;
}) {
    const q = line.queued!;
    const depth = line.depth ?? 0;
    return (
        <div
            data-jarvis-brief-row="queued"
            data-brief-queued={q.entryId}
            data-brief-queued-depth={depth}
            data-peek=""
            {...cursorAttrs(focused)}
            onClick={onOpen}
            style={depth > 0 ? { marginLeft: depth * NEST_INDENT } : undefined}
            className={cn(
                "flex cursor-pointer items-center gap-3 py-[7px] hover:bg-surface-hover",
                ROW_BORDER,
                selected && "bg-surface-selected",
                focused && CURSOR_RING
            )}
        >
            <Clock size={11} aria-hidden className={cn("flex-none", q.blocked ? "text-warning" : "text-muted")} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex-none rounded-[5px] border border-edge-mid px-1.5 text-[10.5px] leading-[17px] text-ink-mid">
                        queued
                    </span>
                    <span title={line.title} className="min-w-0 truncate text-[13px] text-ink-mid">
                        {line.title}
                    </span>
                </div>
                <div className={cn("flex min-w-0 items-center gap-2", FAINT_TEXT)}>
                    <span data-brief-queued-meta className="min-w-0 truncate">
                        {line.meta} · {line.age}
                    </span>
                </div>
            </div>
            <span
                data-brief-queued-state
                title={q.blocked && q.reason ? q.reason : undefined}
                className={cn(
                    "w-[62px] flex-none text-right text-[11px] font-semibold tabular-nums",
                    q.blocked ? "text-warning" : "text-muted"
                )}
            >
                {line.state}
            </span>
        </div>
    );
}
```

Import `Clock` from `lucide-react` with the file's other icons. The row has no buttons: its actions live in its sheet,
as the Brief's rows do. Read DESIGN.md's list-row rules before styling and keep to the classes the neighbouring rows
use; if `text-warning` is not a token in `tailwindsetup.css`, use the one `agenttree.tsx:2106` uses.

- [ ] **Step 4: Typecheck and run the Brief's tests**

Run the Check line, then `npx vitest run frontend/app/view/jarvis/`
Expected: exit 0; PASS.

- [ ] **Step 5: Acceptance, and a look in the dev app**

This task's views are shown by the `brief-run-queue` scenario (Task 5 Step 1): step 1 (the rows, their order, depth,
meta and state, the blocked state's tooltip), step 5 (`j` / `k` and Enter on a queued row) and step 8 (the run-kind
toggle hiding the quick entries). The scenario lands in Task 5; until then, with `task dev` running, queue two
entries in a scratch channel (see Task 5's arrange, or `wsh runs start --plan <file> --after <a running run id>` in a
throwaway checkout) and open Jarvis. The queued row sits under its run, indented, `queued` badge,
`after it lands · 4m`, `#2` on the right. Shot it with `node scripts/cdp-shot.mjs cdp-shots/brief-run-queue-rows.png`.
Remove the entries afterwards (`wsh runs dequeue <id>`).

- [ ] **Step 6: Commit**

```bash
git add -- frontend/app/view/jarvis/briefqueuestore.ts
git commit -m "feat(brief): queued plans sit in Runs under the run they wait on" -- frontend/app/view/jarvis/briefqueuestore.ts frontend/app/view/jarvis/briefsurface.tsx frontend/app/view/jarvis/briefrowviews.tsx
```

---

### Task 4: The queue sheet, and `queued after` on the run sheet

**Depends on:** Task 1, Task 3

**Files:** `frontend/app/view/jarvis/briefqueuesheet.tsx`, `frontend/app/view/jarvis/briefsheet.tsx`, `frontend/app/view/jarvis/briefsheetmodel.ts`, `frontend/app/view/jarvis/briefsheetmodel.test.ts`, `frontend/app/view/agents/runqueuestore.ts`, `frontend/app/view/jarvis/runsheet.tsx`

What each file is for:
- Create: `briefqueuesheet.tsx` — the sheet body.
- Modify: `briefsheetmodel.ts` — the `queued` face.
- Modify: `briefsheet.tsx` — route it, clear it when a subject opens, follow a started entry to its run.
- Modify: `runqueuestore.ts` — keep the `started` pairs (`runQueueStartedAtom`).
- Modify: `runsheet.tsx` — the `queued after <run>` line.

- [ ] **Step 1: The face, test first**

In `briefsheetmodel.test.ts` add:

```ts
it("draws a queue entry when one is open, whatever the subject", () => {
    expect(sheetFace(null, null, "q-a")).toEqual({ kind: "queued", entryId: "q-a" });
    expect(sheetFace({ kind: "effort", id: "e1" } as ActiveSubject, null, "q-a")).toEqual({ kind: "queued", entryId: "q-a" });
});

it("draws the subject when no queue entry is open", () => {
    expect(sheetFace({ kind: "effort", id: "e1" } as ActiveSubject, null, null)).toEqual({ kind: "effort", effortId: "e1" });
});
```

(match the file's existing way of building an `ActiveSubject`). Run
`npx vitest run frontend/app/view/jarvis/briefsheetmodel.test.ts`: FAIL. Then in `briefsheetmodel.ts`:

```ts
export type SheetFace =
    | { kind: "none" }
    | { kind: "channel"; channelId: string; body: "run" | "launcher" }
    | { kind: "effort"; effortId: string }
    | { kind: "queued"; entryId: string };

export function sheetFace(subject: ActiveSubject | null, run: Run | null, queuedEntryId: string | null = null): SheetFace {
    // a queue entry is no subject (briefqueuestore.ts); opening one clears the subject, and opening a subject clears it
    if (queuedEntryId != null) {
        return { kind: "queued", entryId: queuedEntryId };
    }
    …as today
```

Run the test: PASS.

- [ ] **Step 2: Keep the `started` pairs**

In `runqueuestore.ts`:

```ts
// the run each started entry became, from runqueue:changed's `started`, so a view open on an entry can follow it
export const runQueueStartedAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;
```

and in `useRunQueueFeed`'s handler, before setting `runQueueAtom` (so a reader of the new list already sees the
pair):

```ts
const data = e.data as RunQueueChangedData | undefined;
if (data?.started?.length) {
    globalStore.set(runQueueStartedAtom, (cur) => ({
        ...cur,
        ...Object.fromEntries(data.started.map((s) => [s.entryid, s.runid])),
    }));
}
globalStore.set(runQueueAtom, data?.entries ?? []);
```

- [ ] **Step 3: The sheet body, `briefqueuesheet.tsx`**

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's sheet on a queued plan (spec 2026-10-16-brief-run-queue-design.md): what it waits on, its plan and
// route, and the three things the Agent tree's queued row does to it. The lines are queueSheetModel's.
```

It takes `{ model, entryId }`, and:
- reads `queuedRowsAtom` and finds the row; none → renders nothing (the follow in Step 4 closes the sheet);
- reads the run it waits on with `useAtomValue(runId ? runAtom(runId) : NO_RUN)` (`channelsstore.ts`; copy
  `NO_RUN` from `briefsurface.tsx:620`) and words its stage with `runStage(...)` (`agents/runstage.ts`) as
  `runRowFace` does: `s.label.toLowerCase()` plus `done/total` from the dag when the lineage has it, or the label
  alone;
- reads `maxactive` / `active` once per queue change: `useEffect` on the entries calls
  `RpcApi.RunQueueListCommand(TabRpcClient)` and keeps `{ maxActive, active }` in state (`{ 0, 0 }` until it answers);
- builds `queueSheetModel(row, { maxActive, active, afterStage, now })` and draws, in the run sheet's reading style
  (`runsheet.tsx:397`, `px-4 pt-4`, `gap-[11px]`):
  - the chip: a 7 px dot (`bg-warning` blocked, `bg-edge-strong` otherwise) and `m.chip` in the verb style
    (`text-[15px] font-bold`);
  - `data-queue-sheet-waits`: `waits on` label (`REGION_LABEL`) and `m.waits.text`; a button when `runId`
    (`openOrPeekAddress(model, "run:" + runId)`) or `entryId` (`openQueueSheet(entryId)`);
  - `data-queue-sheet-reason` when `m.reason`: the whole reason, `text-warning`, wrapping;
  - `data-queue-sheet-plan`: `m.plan` (a button opening the file the way the Agent tree opens a plan path, if one
    exists; grep `planpath` in `frontend/app/view/agents/` for it; plain text otherwise); for a quick entry,
    `data-queue-sheet-goal`: `m.goal`, wrapping;
  - `data-queue-sheet-route`: `m.route`;
  - `data-queue-sheet-queued`: `m.queued`, then, when `m.queuedBy`, ` · from <name>` as a button
    (`data-queue-sheet-origin`) calling `openOriginSession(model, m.queuedBy.tabId)` (`agents/runoriginstore.ts`),
    in the run sheet's `started from` button recipe (`runsheet.tsx:446`). The name comes from
    `useOriginName(model, row.entry.data.origintabid)` (same module), passed to `queueSheetModel` as `originName`;
  - the actions in a dock at the bottom (`border-t border-edge-faint`, `SHEET_BTN` from `briefrunsheet.tsx`):
    `data-queue-sheet-act="start"` → `startQueuedNow(row.entry)`, `"next"` (only when `m.runNext`) →
    `runQueuedNext(row.entry)`, `"remove"` → `confirmRemoveQueued(row.entry)`, all from `runqueuestore.ts`.

- [ ] **Step 4: Route it in `briefsheet.tsx`**

- `const queuedId = useAtomValue(briefQueueSheetAtom);` and pass it: `sheetFace(subject, run, queuedId)` (add it to
  the memo's deps).
- Opening a subject closes the queue face:
  `useEffect(() => { if (subject != null) globalStore.set(briefQueueSheetAtom, null); }, [subject]);`
- `close()` also sets `briefQueueSheetAtom` to null.
- The header: `label` is `"queued"` for the queued face; `title` is the entry's title (read it from
  `runQueueAtom`), and keep the last one seen in a ref so the latch and the toast below still have it once the entry
  is gone.
- The body: `{face.kind === "queued" ? <QueueSheet model={model} entryId={face.entryId} /> : null}`.
- Follow the entry when it leaves the queue:
  ```ts
  const entries = useAtomValue(runQueueAtom);
  const started = useAtomValue(runQueueStartedAtom);
  useEffect(() => {
      if (queuedId == null || entries.some((e) => e.id === queuedId)) {
          return;
      }
      globalStore.set(briefQueueSheetAtom, null);
      const runId = started[queuedId];
      if (runId != null) {
          fireAndForget(() => openOrPeekAddress(model, "run:" + runId));
          return;
      }
      globalStore.set(briefSheetOpenAtom, false);
      briefUndo.notify(`${lastTitle.current || "That plan"} left the queue`);
  }, [queuedId, entries, started]);
  ```
  `runQueueAtom` starts empty and fills on the feed's first read: guard the effect until the feed has answered once,
  or a sheet opened on boot restore would close at once. If nothing marks that today, the simplest guard is to skip
  while `entries.length === 0 && Object.keys(started).length === 0` and the queued row was never seen; record "seen"
  in the same ref as the title.

- [ ] **Step 5: `queued after` on the run sheet**

In `runsheet.tsx`'s `Reading` (line 372), after the `origin` button, the same button recipe:

```tsx
{run.afterrunid ? <QueuedAfter model={model} runId={run.afterrunid} /> : null}
```

with, in the same file:

```tsx
// the run this one was queued after (`wsh runs start --after`): kept on the run once its queue entry is gone
function QueuedAfter({ model, runId }: { model: AgentsViewModel; runId: string }) {
    const after = useAtomValue(runAtom(runId));
    const name = after != null ? runTitle(after, undefined) : runId.slice(0, 8);
    return (
        <button
            type="button"
            data-run-queued-after={runId}
            title={`Open ${name}, the run this one was queued after`}
            onClick={() => fireAndForget(() => openOrPeekAddress(model, "run:" + runId))}
            className="inline-flex max-w-full cursor-pointer items-center gap-1 self-start text-[10.5px] text-ink-mid hover:text-accent-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
            <CornerDownRight size={11} aria-hidden className="flex-none text-muted" />
            <span className="truncate">queued after {name}</span>
        </button>
    );
}
```

(`runTitle` from `@/app/view/agents/runlineage`, `openOrPeekAddress` from `./openref`.)

- [ ] **Step 6: Typecheck, test, acceptance**

Run the Check line and `npx vitest run frontend/app/view/jarvis/ frontend/app/view/agents/runqueuemodel.test.ts`:
exit 0, PASS.

This task's views are shown by the `brief-run-queue` scenario (Task 5 Step 1): steps 2 and 3 (the queue sheet: chip,
waits on a run and on an entry, plan, route, queued, the actions, Run next only past #1), step 4 (another row clears
the queue face), step 6 (the blocked reason), step 7 (a room-only quick entry: `a free slot (1 of 1 running)` and its
goal), step 9 (Start now follows the entry into its run sheet, which reads `queued after`) and step 11 (Remove:
confirm, the sheet closes, the `left the queue` toast). The scenario lands in Task 5; until then, in the dev app, open
a queued row's sheet and Start now a quick deferred entry. Shot:
`node scripts/cdp-shot.mjs cdp-shots/brief-run-queue-sheet.png`.

- [ ] **Step 7: Commit**

```bash
git add -- frontend/app/view/jarvis/briefqueuesheet.tsx
git commit -m "feat(brief): a queued row opens its queue sheet, which follows the plan into its run" -- frontend/app/view/jarvis/briefqueuesheet.tsx frontend/app/view/jarvis/briefsheet.tsx frontend/app/view/jarvis/briefsheetmodel.ts frontend/app/view/jarvis/briefsheetmodel.test.ts frontend/app/view/agents/runqueuestore.ts frontend/app/view/jarvis/runsheet.tsx
```

---

### Task 5: The `brief-run-queue` scenario, the changelog and the guide

**Depends on:** Task 4

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/guide/orchestrator.md`

- [ ] **Step 1: The scenario**

In `scripts/cdp/scenarios.mjs`, after `runQueueScenario` (line ~39654), add `briefRunQueueScenario` and register it
where `runQueueScenario` is registered. Reuse the `rq*` helpers (`RQ_RPC`, `rqList`, `rqChannelRuns`, line 39588) and
copy `runQueueScenario`'s arrange and teardown shape (the cap, the channel, the blocked-D loop, the teardown order:
entries first, then runs, channel, cap, temp dir). Never Start now an orchestrator plan entry whose plan exists: its
start spawns a plan reviewer, a real agent.

Arrange (`surface: "jarvis"`):
- `runs:maxactive` 1; one quick `deferstart` run filling it, goal `verify brief-run-queue: the run that fills the cap`
  (keep its id as `ctx.fillId`);
- A: orchestrator plan entry (`a.md` with one task), `after: ctx.fillId`;
- B: orchestrator plan entry, `after: A.id`;
- C: quick `deferstart` entry, room only;
- D: orchestrator plan entry whose plan file is then removed, Start now until it is blocked (as `run-queue` does);
- E: quick `deferstart` entry, `after: ctx.fillId`.

Assert, each a numbered step with its own shot under `cdp-shots/brief-run-queue-*.png`. The order matters: steps
1–8 read the queue while the fill run is the one active run, step 9 starts E (two active after it), and step 11
removes C last.
1. `h.goto("jarvis")`; wait (up to 20 s: the Brief's runs come from the briefing read) for the fill run's Runs row and
   for `[data-brief-queued]` rows for A–E. Read every `[data-jarvis-brief-region="sessions"] [data-jarvis-brief-row]`
   in order as `{ row, queued, depth, meta, state, stateTitle }` (`stateTitle` is `[data-brief-queued-state]`'s
   `title`). Pass when A is right after the fill run at depth 1 with meta starting `after it lands`, B right after A at
   depth 2, E after B at depth 1, and C and D at depth 0 after every `session` row, C's meta starting
   `waiting for room`, D's state `blocked` and D's `stateTitle` equal to D's `reason` in `rqList` (the blocked
   state's tooltip).
2. Click A's row: `[data-jarvis-brief-sheet="queued"]` is open; `[data-queue-sheet-waits]` contains the fill run's
   goal; `[data-queue-sheet-plan]` ends `a.md`; `[data-queue-sheet-route]` starts `Lead claude`;
   `[data-queue-sheet-queued]` starts `queued `; acts `start` and `remove` exist and `next` does not (A is #1).
3. Click B's row: the sheet now shows B; its waits names A's title; act `next` exists.
4. Another row clears the queue face: with B's sheet open, click the fill run's Runs row. The sheet is
   `[data-jarvis-brief-sheet="channel"]` with `[data-run-sheet]`, and no `[data-jarvis-brief-sheet="queued"]` is in
   the page.
5. `j` / `k` and Enter: press Escape (no sheet open), then press `j` (at most 30 times, each through
   `Input.dispatchKeyEvent` as the other Brief scenarios send keys) until `[data-brief-queued="<A>"]` carries
   `data-jarvis-brief-cursor="true"`; press Enter: the queue sheet is open on A (its header title is A's title).
6. Click D's row: the chip reads `Blocked`, and `[data-queue-sheet-reason]`'s text equals D's `reason` in `rqList`,
   whole (not clipped: its `scrollWidth <= clientWidth` and it holds no `…`).
7. Click C's row: `[data-queue-sheet-waits]` reads `a free slot (1 of 1 running)`; there is no
   `[data-queue-sheet-plan]`, and `[data-queue-sheet-goal]` holds C's goal; act `next` exists (C is #3).
8. The run-kind toggle: press Escape, then click the `orchestrator` button in `[data-jarvis-run-kind]`: the queued
   rows are A, B and D (C and E, quick entries, are gone); click `quick`: they are C and E; click `all`: A–E are back.
9. Click E's row, then its `[data-queue-sheet-act="start"]`: within 15 s the sheet is a run sheet
   (`[data-jarvis-brief-sheet="channel"]` with `[data-run-sheet]`), and `[data-run-queued-after]` equals `ctx.fillId`
   and its text contains the fill run's goal. Record E's run for teardown (it is in the channel's runs).
10. Press Escape: the sheet closes; E's queued row is gone from Runs.
11. Remove: click C's row, then `[data-queue-sheet-act="remove"]`; a `[role="dialog"]` appears (wait up to 3 s);
    click its button whose text includes `Remove` (as `run-queue`'s step 1c does). Within 15 s: no
    `[data-jarvis-brief-sheet="queued"]`, a `[data-jarvis-brief-toast]` whose text contains `<C's title> left the
    queue`, no `[data-brief-queued="<C>"]` row, and C is not in `rqList`.

Teardown: as `run-queue`'s.

Run it against the dev app: `task verify:ui -- brief-run-queue run-queue` (the Final line runs it on its own
app). Both PASS; open `cdp-shots/index.html` and look at each shot.

- [ ] **Step 2: Changelog and guide**

`CHANGELOG.md`, top section's `### Added`:

```markdown
- **The run queue in Jarvis**: a plan queued with `--after` sits in the Brief's Runs right under the run it waits on
  (a chain nests one level per link), a plan waiting for room at the end. Click one for what it waits on, its plan
  and route, and Start now, Run next or Remove; a run started from the queue says what it was queued after.
  <!-- big -->
```

Check the top section's `<!-- big -->` count first: at most 5 per release (`whatsnew.test.ts`); if there are 5, leave
`<!-- big -->` off. Run `npx vitest run frontend/app/view/agents/whatsnew.test.ts` (find the file with
`git ls-files '*whatsnew.test.ts'`).

`docs/guide/orchestrator.md`, in the **Trên cây Agent** paragraph (line ~185), add one sentence after it, in the
guide's language (Vietnamese):

```markdown
**Trong Brief của Jarvis.** Mục đang chờ nằm trong Runs, ngay dưới run nó chờ (`--after` nối nhiều mục thì mỗi mục lùi
thêm một bậc), mục chỉ chờ chỗ trống nằm cuối Runs. Bấm vào để mở sheet của mục: nó chờ gì, plan, route, và **Start
now**, **Run next**, **Remove**. Khi mục chạy, sheet chuyển thành sheet của run; run đó ghi `queued after <run>`.
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test(cdp): brief-run-queue; docs: the run queue in Jarvis's Brief" -- scripts/cdp/scenarios.mjs CHANGELOG.md docs/guide/orchestrator.md
```
