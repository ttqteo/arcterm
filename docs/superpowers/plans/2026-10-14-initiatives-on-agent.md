# Initiatives on the Agent surface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring initiatives to where the person works: an agent's proposed plan is reviewed on its details rail, the
agent header opens its initiative in a popover, the Jarvis List gains a review pass over changed and idle
initiatives, and parent and child initiatives show on the List.

**Architecture:** One new chunk status, `proposed`, counted out of progress, plus a `plan-review` attention kind and
a link cycle guard in Go. Everything else is frontend: pure models with vitest beside them (proposed rows, the
popover's chunk picks, the review queue, the parent/child order), thin views on the Agent rail and header, the Brief
and Sprout's popup, and the keys in the one registry.

**Tech Stack:** Go (`pkg/jarvis`, `pkg/jarvisstate`, `cmd/wsh`), wshrpc, React 19 + jotai + Tailwind 4, vitest,
the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-14-initiatives-on-agent-design.md`

**Prototype:** D:/work/arcterm/.superpowers/design/initiatives-on-agent/project

**Verify:** `node scripts/verify.mjs ./pkg/jarvis ./pkg/jarvisstate ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `node scripts/cdp/final-verify.mjs initiative-plan-review initiative-popover initiative-link initiative-review initiative-parents surface-smoke`

Conventions for every task: commit only the files the task names, with a pathspec
(`git add <paths> && git commit -m "..." -- <paths>`); no `Co-Authored-By` trailer; never `git push`. Check only the
files you touched with `gofmt -l` / `npx prettier --check` / `npx eslint`; never `--write` the tree, and never run
prettier on `scripts/*.mjs`. Colors come from `@theme` tokens only (`DESIGN.md`); copy sizes from the components named
in each task. The canvas boards are the visual target: `Main.dc.html` (Plan to review on the rail), `Popover`,
`Unlinked`, `Review`, `ParentChild`, `Sprout`.

---

### Task 1: `proposed` chunk status in Go

**Depends on:** none

**Files:** `pkg/jarvis/effortops.go`, `pkg/jarvis/effortops_test.go`, `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshrpctypes_effort.go`, `pkg/jarvisstate/jarvisstate.go`, `pkg/jarvisstate/efforts_leg_test.go`

A chunk an agent proposes is `proposed` until the person accepts it (`setChunkStatus` → `pending`) or drops it
(`removeChunk`). It is not progress: the summary's `Done`/`Total` and `ActiveChunk` leave it out. `advance` already
only activates `pending|blocked|deferred`, so it skips `proposed` with no change; a test pins that.

**Step 1: Write the failing tests** in `pkg/jarvis/effortops_test.go` (reuse `mkEffort`, `expectErrCode`, `intPtr`):

```go
func TestApplyOpsAddChunkProposed(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Idea A", Status: "proposed"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if got := e.Chunks[3]; got.Label != "Idea A" || got.Status != "proposed" {
		t.Fatalf("chunk: %+v", got)
	}
}

func TestApplyOpsAddChunkRefusesOtherStatus(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "X", Status: "done"}}, "", effortNow)
	expectErrCode(t, err, "EC-INVALID-STATUS")
}

func TestApplyOpsAcceptProposed(t *testing.T) {
	e := mkEffort()
	e.Chunks = append(e.Chunks, waveobj.EffortChunk{Label: "P", Status: "proposed"})
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkStatus", Chunk: "P", Status: "pending"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[3].Status != "pending" {
		t.Fatalf("status: %q", e.Chunks[3].Status)
	}
}

func TestAdvanceSkipsProposed(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{
		{Label: "A", Status: "active"},
		{Label: "P", Status: "proposed"},
		{Label: "B", Status: "pending"},
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[1].Status != "proposed" || e.Chunks[2].Status != "active" {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
}

func TestApplyOpsRemoveLastProposedChunk(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{{Label: "only", Status: "proposed"}}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "removeChunk", Chunk: "only"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks) != 0 {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
}
```

And in `pkg/jarvisstate/efforts_leg_test.go`:

```go
func TestEffortSummaryLeavesProposedOutOfProgress(t *testing.T) {
	e := &waveobj.Effort{
		Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: "p1", Status: "proposed"},
			{Label: "c1", Status: "done"},
			{Label: "c2", Status: "pending"},
		},
	}
	s := EffortSummaryOf(e)
	if s.Done != 1 || s.Total != 2 || s.ActiveChunk != "c2" || len(s.Chunks) != 3 {
		t.Fatalf("summary: %+v", s)
	}
}
```

**Step 2: Run them, expect FAIL.** `go test ./pkg/jarvis -run 'AddChunkProposed|AddChunkRefusesOtherStatus|AcceptProposed|AdvanceSkipsProposed|RemoveLastProposedChunk'` and `go test ./pkg/jarvisstate -run 'LeavesProposedOutOfProgress'` (these packages need cgo only for their test mains if they open the store; if a run panics with "go-sqlite3 requires cgo", prefix `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`).

**Step 3: Implement.**

- `pkg/jarvis/effortops.go`: add `"proposed": true` to `effortChunkStatuses`, and update the `EC-INVALID-STATUS`
  message to list `pending|active|done|deferred|blocked|skipped|proposed`.
- The `addChunk` validation case: after the due check,

  ```go
  if op.Status != "" && op.Status != "proposed" {
  	return fmt.Errorf("EC-INVALID-STATUS: a new chunk is pending, or proposed with --proposed; not %q", op.Status)
  }
  ```

- The `addChunk` apply case: `status := "pending"; if op.Status == "proposed" { status = "proposed" }` and use it in
  the `waveobj.EffortChunk` literal. The event stays `chunk-added`; the effort note reads `chunk proposed: <label>`
  for a proposed one.
- The `removeChunk` guard becomes `if len(e.Chunks) == 1 && e.Chunks[0].Status != "proposed"`: dropping the last
  proposed chunk of an idea returns it to an idea.
- `pkg/waveobj/wtype.go`: the `Status` comment on `EffortChunk` reads
  `// pending | active | done | deferred | blocked | skipped | proposed`.
- `pkg/wshrpc/wshrpctypes_effort.go`: the `Status` comment on `EffortOp` reads
  `// setStatus (effort) | setChunkStatus (chunk) | addChunk ("proposed" only)`.
- `pkg/jarvisstate/jarvisstate.go` `EffortSummaryOf`: count `Total` as the chunks that are not `proposed`; the
  `ActiveChunk` fallback skips `proposed` as it skips `done` and `skipped`. `Chunks` still carries every chunk.

**Step 4: Run the tests again, expect PASS.** Then `task generate` and confirm `git diff --stat` lists no generated
file (only comments changed on the wire types).

**Step 5: Commit** `feat(effort): a proposed chunk status, counted out of progress`.

---

### Task 2: `wsh effort chunk add --proposed`, the skill rule and Plan it

**Depends on:** Task 1

**Files:** `cmd/wsh/cmd/wshcmd-effort.go`, `cmd/wsh/cmd/wshcmd-effort_test.go`, `skills/effort-tracking/SKILL.md`, `frontend/app/view/jarvis/initiativework.ts`, `frontend/app/view/jarvis/initiativework.test.ts`

**Step 1: Failing tests.**

- `cmd/wsh/cmd/wshcmd-effort_test.go`, beside the existing `Lookup("stage")` test:
  `if effortChunkAddCmd.Flags().Lookup("proposed") == nil { t.Fatal("chunk add has no --proposed") }`.
- Same file, beside the existing `formatEffortShow` test: an effort with chunks `[done A, pending B, proposed P]`
  renders a header ending `— 1/2` (proposed is not progress), and P's line still prints with `[proposed]`.
- `frontend/app/view/jarvis/initiativework.test.ts`: the expected Plan it prompt becomes
  `` plan the idea Màu mờ khó đọc (effort:e1): break it into chunks with `wsh effort chunk add --proposed`, then stop so I can review the plan before any work starts ``.

Run `go test ./cmd/wsh/cmd -run 'Effort'` and `npx vitest run frontend/app/view/jarvis/initiativework.test.ts`: FAIL.

**Step 2: Implement.**

- `wshcmd-effort.go`: `effortChunkAddCmd.Flags().Bool("proposed", false, "propose the chunk; it counts once accepted")`;
  in `RunE`, `if p, _ := cmd.Flags().GetBool("proposed"); p { op.Status = "proposed" }`; the `Use` string gains
  `[--proposed]`. `formatEffortShow`'s header (line 491) counts its total as the chunks that are not `proposed`
  (a `countProgress` beside `countDone`), so `wsh effort show` agrees with the summary's `Done/Total`.
- `initiativework.ts` line 32: the prompt says `` `wsh effort chunk add --proposed` ``.
- `skills/effort-tracking/SKILL.md`: in the command table row for `chunk add`, add `[--proposed]`; under the rules,
  one paragraph: "**Propose, don't add, what nobody asked for.** Chunks you add on your own (scope you found, a split
  you suggest, a whole plan for an idea) go in with `--proposed`. The person accepts or drops them on your rail; a
  proposed chunk is not progress and `advance` never starts it. Once you have proposed a plan, stop and say so."

**Step 3: Run the tests, expect PASS. Commit** `feat(effort): wsh effort chunk add --proposed; Plan it proposes`.

---

### Task 3: The `plan-review` attention kind

**Depends on:** Task 1

**Files:** `pkg/jarvis/attention.go`, `pkg/jarvis/attention_plan_test.go`, `frontend/app/view/jarvis/planreviewtarget.ts`, `frontend/app/view/jarvis/planreviewtarget.test.ts`, `frontend/app/cockpit/palette-needs.ts`, `frontend/app/cockpit/palette-needs.test.ts`, `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.test.ts`, `frontend/app/view/agents/notifyevents.ts`, `frontend/app/view/jarvis/attentionact.ts`, `frontend/app/view/jarvis/attentionact.test.ts`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/petpeekmodel.ts`, `frontend/app/view/jarvis/petpeekmodel.test.ts`, `frontend/app/view/jarvis/petacts.ts`, `frontend/app/view/jarvis/petacts.test.ts`

One item per initiative in play (`active` or `paused`) holding at least one `proposed` chunk.

**Step 1: Failing Go test** `pkg/jarvis/attention_plan_test.go` (reuse `dueEffort`/`dueChunk` from
`attention_due_test.go`):

```go
func planItems(in AttentionInput) []wshrpc.AttentionItem {
	var out []wshrpc.AttentionItem
	for _, it := range BuildAttention(in) {
		if it.Kind == AttentionPlanReview {
			out = append(out, it)
		}
	}
	return out
}

func TestPlanReviewOnePerInitiative(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "done", ""),
		waveobj.EffortChunk{Label: "P1", Status: "proposed", UpdatedTs: 20},
		waveobj.EffortChunk{Label: "P2", Status: "proposed", UpdatedTs: 10})
	got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}})
	if len(got) != 1 || got[0].Key != "plan-review:e1" || got[0].Text != "2 proposed" ||
		got[0].ORef != "effort:e1" || got[0].EffortOID != "e1" || got[0].WaitingSince != 10 {
		t.Fatalf("items: %+v", got)
	}
}

func TestPlanReviewLeavesWhenDecided(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "pending", ""))
	if got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}}); len(got) != 0 {
		t.Fatalf("items: %+v", got)
	}
}

func TestPlanReviewOnlyInPlay(t *testing.T) {
	e := dueEffort("e1", "archived", waveobj.EffortChunk{Label: "P", Status: "proposed"})
	if got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}}); len(got) != 0 {
		t.Fatalf("items: %+v", got)
	}
}
```

Run `go test ./pkg/jarvis -run 'PlanReview'`: FAIL.

**Step 2: Implement in `attention.go`.**

```go
// a plan an agent proposed: one item per initiative in play with proposed chunks, waiting since the oldest
AttentionPlanReview = "plan-review"
```

```go
// planReviewItems are the initiatives whose plan waits on the person: proposed chunks, not yet accepted or dropped.
// The key names only the initiative, so accepting some of the chunks keeps the one item and its count moves.
func planReviewItems(efforts []*waveobj.Effort) []wshrpc.AttentionItem {
	var out []wshrpc.AttentionItem
	for _, e := range efforts {
		if e == nil || (e.Status != "active" && e.Status != "paused") {
			continue
		}
		n, since := 0, int64(0)
		for _, c := range e.Chunks {
			if c.Status != "proposed" {
				continue
			}
			n++
			if since == 0 || (c.UpdatedTs != 0 && c.UpdatedTs < since) {
				since = c.UpdatedTs
			}
		}
		if n == 0 {
			continue
		}
		out = append(out, wshrpc.AttentionItem{
			Kind:         AttentionPlanReview,
			Key:          "plan-review:" + e.OID,
			Source:       e.Title,
			Text:         fmt.Sprintf("%d proposed", n),
			Action:       "Review",
			ORef:         waveobj.MakeORef(waveobj.OType_Effort, e.OID).String(),
			EffortOID:    e.OID,
			WaitingSince: since,
			Why:          "An agent proposed these chunks. They count once you accept them.",
		})
	}
	return out
}
```

In `BuildAttention`, `plans := planReviewItems(in.Efforts)`; add `plans` to the sort loop's group list after
`asks`, and `out = append(out, plans...)` right after `out = append(out, asks...)`.

**Step 3: One resolver for where a plan-review item opens** (spec §2: the agent when it is still open, else the
initiative). `planreviewtarget.ts` (pure): `planReviewAgent(item: AttentionItem, roster: ReadonlyArray<AgentVM>):
AgentVM | undefined` returns the live roster agent whose `effortId` equals `item.effortoid`, the newest when several
match, and `undefined` for any other kind; `planReviewORef(item, roster)` returns `agent:<id>` for that agent, else
`item.oref`. `planreviewtarget.test.ts`: one matching agent, two (the newest wins), none (the effort oref), and a
non-plan-review item (undefined). Every reader below opens a plan-review item through it; none resolves it on its own.

**Step 4: Frontend kind maps** (each has a test file; add one case per test, mirroring `chunk-due`, plus one with a
matching live agent that asserts the agent target):

- `needsyoustripmodel.ts`: `KIND_LABEL["plan-review"] = "Plan to review"`; tone `asking`; its `open` is
  `{ kind: "agent", agentId }` when `planReviewAgent(a, input.roster)` finds one, else `{ kind: "effort", effortId }`
  (extend the `effortId` line to both kinds).
- `briefingmodel.ts`: `"plan-review": "plan"` in the kind map beside `"chunk-due": "due"`; the row's nav opens
  `planReviewORef(a, roster)` (the agent, else the effort as chunk-due's does).
- `palette-needs.ts`: `"plan-review": "plan"`; the target is the agent from `planReviewAgent` when one is found, else
  the effort like `chunk-due`.
- `petacts.ts`: `actsForAttention(item, agents: ReadonlyArray<AgentVM> = [])`; a `plan-review` item returns one
  `open` act labelled `item.action` ("Review") targeting `{ kind: "oref", ref: planReviewORef(item, agents) }` (it has
  no run, so it must come before the `!item?.runid` return). `petpeekmodel.ts` passes its `agents` in; it adds
  `"plan-review"` to `DETAIL_KINDS` (the "2 proposed" text is the detail) and `ROW_KIND_LABEL["plan-review"] =
  "Plan to review"`.
- `attentionact.ts`: `plan-review` acts as Open (no wire act).
- `notifyevents.ts`: add `"plan-review"` to the kinds that notify, beside `"chunk-due"`.

Run `npx vitest run frontend/app/view/jarvis/planreviewtarget.test.ts frontend/app/view/agents/needsyoustripmodel.test.ts frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/cockpit/palette-needs.test.ts frontend/app/view/jarvis/attentionact.test.ts frontend/app/view/jarvis/petacts.test.ts frontend/app/view/jarvis/petpeekmodel.test.ts` and the Go test: PASS.

**Step 5: Commit** `feat(attention): plan-review, an initiative with proposed chunks`.

---

### Task 4: Refuse a link that makes a cycle

**Depends on:** none

**Files:** `pkg/jarvis/effortparent.go`, `pkg/jarvis/effortparent_test.go`, `pkg/wshrpc/wshserver/wshserver_effort.go`

**Step 1: Failing test** `pkg/jarvis/effortparent_test.go`:

```go
package jarvis

import "testing"

func parents(m map[string]string) func(string) (string, error) {
	return func(oid string) (string, error) { return m[oid], nil }
}

func TestLinkMakesCycle(t *testing.T) {
	// a <- b <- c (c's parent is b, b's parent is a)
	up := parents(map[string]string{"c": "b", "b": "a"})
	cases := []struct {
		child, parent string
		want          bool
	}{
		{"a", "c", true},  // a under c, while c is under a
		{"a", "b", true},
		{"c", "a", false}, // already the shape, one more level up is fine
		{"d", "c", false},
	}
	for _, tc := range cases {
		got, err := LinkMakesCycle(tc.child, tc.parent, up)
		if err != nil || got != tc.want {
			t.Fatalf("%s under %s: got %v %v, want %v", tc.child, tc.parent, got, err, tc.want)
		}
	}
}
```

Run `go test ./pkg/jarvis -run 'LinkMakesCycle'`: FAIL.

**Step 2: Implement** `pkg/jarvis/effortparent.go`:

```go
// LinkMakesCycle reports whether putting child under parent would make child its own ancestor: it walks parentOf up
// from parent and fails on reaching child. The walk stops at a depth no real tree reaches, so a cycle already stored
// cannot hang it.
func LinkMakesCycle(child, parent string, parentOf func(oid string) (string, error)) (bool, error) {
	for cur, depth := parent, 0; cur != "" && depth < 64; depth++ {
		if cur == child {
			return true, nil
		}
		next, err := parentOf(cur)
		if err != nil {
			return false, err
		}
		cur = next
	}
	return false, nil
}
```

In `wshserver_effort.go`'s link pre-check, after the parent lookup succeeds:

```go
cycle, err := jarvis.LinkMakesCycle(data.EffortOID, op.ParentOID, func(oid string) (string, error) {
	p, err := effortstore.Get(ctx, oid)
	if err != nil {
		return "", err
	}
	return p.ParentOID, nil
})
if err != nil {
	return nil, fmt.Errorf("EC-BAD-PARENT: %w", err)
}
if cycle {
	return nil, fmt.Errorf("EC-BAD-PARENT: that would put the initiative under itself")
}
```

**Step 3: Run, PASS. Commit** `fix(effort): refuse a link that makes a cycle`.

---

### Task 5: The frontend effort model and actions

**Depends on:** Task 1

**Files:** `frontend/app/view/jarvis/effortmodel.ts`, `frontend/app/view/jarvis/effortmodel.test.ts`, `frontend/app/view/jarvis/proposedmodel.ts`, `frontend/app/view/jarvis/proposedmodel.test.ts`, `frontend/app/view/jarvis/effortstore.ts`

**Step 1: Failing tests.**

`effortmodel.test.ts`: `buildEffortCard` of a summary with chunks `[proposed P, done A, pending B]`, `done: 1`,
`total: 2` gives `segments: ["done", "pending"]`, chips without `P`, `remaining: 1`, and `proposed: ["P"]`; a summary
whose only chunks are proposed (`done 0, total 0`) is an idea (`isIdea` from `briefrows.ts` returns true) and has
`proposed` listing them.

Same file, the opened detail: `effortFacts` of an `Effort` with chunks `[proposed P, done A, pending B]` gives
`done: 1`, `counted: 2`, `segments` `[{done,1},{pending,1}]` (P is not a pending segment, though `chunkTone` maps an
unknown status to `pending`), and `next.label` `"B"`; `nextChunk` of `[proposed P, pending B]` is B; an effort whose
only chunks are proposed has `counted: 0`, no segments and `idle` `"No chunks yet."`.

`proposedmodel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { acceptOps, continueMessage, dropOps, proposedRows } from "./proposedmodel";

const chunks = [
    { label: "Done one", status: "done" },
    { label: "Radial layout model", status: "proposed", stage: "Build", notes: [{ ts: 1, text: "angles by leaf count" }] },
    { label: "CDP scenario", status: "proposed", stage: "Verify" },
];

describe("proposedRows", () => {
    it("lists the proposed chunks in plan order with stage and newest note", () => {
        expect(proposedRows(chunks as any)).toEqual([
            { label: "Radial layout model", meta: "Build · angles by leaf count" },
            { label: "CDP scenario", meta: "Verify" },
        ]);
    });
});

describe("ops", () => {
    it("accepts as pending", () => {
        expect(acceptOps(["CDP scenario"])).toEqual([{ op: "setChunkStatus", chunk: "CDP scenario", status: "pending" }]);
    });
    it("drops highest position first", () => {
        expect(dropOps(chunks as any, ["Radial layout model", "CDP scenario"]).map((o) => o.chunk)).toEqual([
            "CDP scenario",
            "Radial layout model",
        ]);
    });
    it("words the continue line", () => {
        expect(continueMessage("Radial layout model")).toBe("Plan accepted, start with Radial layout model\r");
    });
});
```

Run `npx vitest run frontend/app/view/jarvis/effortmodel.test.ts frontend/app/view/jarvis/proposedmodel.test.ts`: FAIL.

**Step 2: Implement.**

- `effortmodel.ts`: `EffortCardModel` gains `proposed: string[]` (labels, plan order). `segments` and `chips` leave
  out `proposed` as `segments` leaves out `skipped`; `remaining` already reads `e.total`, which Task 1 made exclude
  proposed. `effortFacts` works on the chunks that are not `proposed` (done, counted, skipped, segments, next, idle);
  `nextChunk` skips `proposed` as it skips `done` and `skipped`. Every count the List and the sheet draw then agrees
  with the summary's `done/total`.
- `proposedmodel.ts` (pure, no jotai or RPC; header comment says so):
  - `proposedRows(chunks: { label: string; status: string; stage?: string; notes?: { ts: number; text: string }[] }[])`
    → `{ label, meta }[]`, `meta` = stage, then the newest note's text, joined with ` · `.
  - `acceptOps(labels)` → `EffortOp[]` of `setChunkStatus … pending`.
  - `dropOps(chunks, labels)` → `removeChunk` ops, highest index first (the reason `removeChunks` in effortstore
    sorts), using the label as the chunk ref.
  - `continueMessage(first)` → `` `Plan accepted, start with ${first}\r` ``.
- `effortstore.ts`: `acceptProposed(oref, labels)` and `dropProposed(oref, chunks, labels)` through `mutateEffort`
  with the ops above; `attachAgent(oref, chunk, tabId)` sending
  `{ op: "attachWork", chunk, kind: "agent", oref: "agent:" + tabId }`; `linkEffort(oref, parentOref | "")` sending
  `{ op: "link", parentoid: parentOref.replace(/^effort:/, "") }` ("" unlinks); `createIdea(title)` returns the new
  idea's oref (`"effort:" + rtn.effortoid` from `EffortCreateCommand`) instead of `void`, so Task 7's "+ New initiative
  from this session" can link to it (its existing callers ignore the value).

**Step 3: Run, PASS; `task check:ts` (allow 3+ minutes). Commit** `feat(initiatives): proposed chunks in the effort model and store`.

---

### Task 6: Plan to review on the agent's rail, and its header chip

**Depends on:** Task 5

**Files:** `frontend/app/view/agents/agentrailsections.ts`, `frontend/app/view/agents/agentrailsections.test.ts`, `frontend/app/view/agents/planreviewsection.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/agentheader.tsx`

Board: `Main.dc.html`.

**Step 1: Failing test** in `agentrailsections.test.ts`: `planAgentRail({ ...base, proposed: 4 })` puts `{ id: "plan" }`
first, before `status`; with `proposed: 0` there is no `plan`; inside a subagent there is none either.

**Step 2: Implement.**

- `agentrailsections.ts`: `AgentRailSectionId` gains `"plan"`; `AgentRailInput.proposed: number`; `planAgentRail`
  pushes `{ id: "plan" }` first when `!i.inSubagent && i.proposed > 0` (no header: the section draws its own and does
  not collapse).
- `agentdetailsrail.tsx`: compute `proposed` from the agent's initiative (`agent.effortId` → the effort detail in
  `effortDetailAtom`, loaded with `loadEffortDetail` as `InitiativeLink` does) and pass it in the rail input; add
  `plan` to `LABEL` ("Plan to review"), `ICON` (`RAIL_ICON.bell`) and `CONTENT` (renders `<PlanReviewSection>`).
- `planreviewsection.tsx`: the board's section. An `askingbg` panel with an `asking/30` border, rounded 8px, padding
  11/12. Heading `SectionLabel` in `text-asking` "Plan to review" with "N proposed" (or "all decided") after it; a line
  "<initiative> · proposed by <agent name>. They count toward progress once you accept them." in `text-muted` 11px.
  One row per `proposedRows` entry, 40px min height, a top `edge-faint` rule: a 9px dashed `asking` ring, the label
  12.5px `text-primary` and its meta 10.5px `text-ink-mid`; icon buttons Accept (`Check`, `text-success`), Rename
  (`Pencil`, swaps the label for an input, Enter saves through `renameChunk`, Esc cancels), Drop (`X`). A decided row
  shows "accepted · now pending" / "dropped" and an Undo link until the next detail read drops it from the list (Undo of
an accept sets the chunk back to `proposed`; Undo of a drop adds it back at its old position, with its stage, as
`proposed`). Footer
  buttons in the rail's secondary recipe: **Accept all and continue** (accepts all, then
  `driveAgent(agent.blockId, continueMessage(first))` from `agentactions.ts`), **Accept all**, **Drop all**; a muted
  line says what continue sends. A failed mutation shows the error under the buttons in `text-error`.
- `agentheader.tsx`: after the initiative link, when the initiative has proposed chunks, a chip
  `N TO REVIEW` (`askingbg`, `asking/30` border, 10px bold, uppercase) whose click opens the rail on the Plan to review
  section (the rail's `openSection("plan")` path).

**Step 3: Run the test, `task check:ts`, try it in the dev app** (an agent tab with `session:effort` pointing at an
initiative given two proposed chunks with `wsh effort chunk add <effort> "X" --proposed`). The CDP step that shows it
is `initiative-plan-review` (Task 11). **Commit** `feat(agents): review an agent's proposed plan on its rail`.

---

### Task 7: The initiative popover and Link to initiative on the agent header

**Depends on:** Task 6, Task 4

**Files:** `frontend/app/view/agents/initiativepopovermodel.ts`, `frontend/app/view/agents/initiativepopovermodel.test.ts`, `frontend/app/view/agents/initiativepopover.tsx`, `frontend/app/view/jarvis/initiativepicker.tsx`, `frontend/app/view/jarvis/initiativepickermodel.ts`, `frontend/app/view/jarvis/initiativepickermodel.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/whenstate.ts`

Boards: `Popover.dc.html`, `Unlinked.dc.html`.

**Step 1: Failing tests.**

`initiativepopovermodel.test.ts` over an `Effort` with chunks
`[done A, active B (workrefs agent:t1, notes [{ts:5,text:"slow"}]), pending C, pending D, pending E, proposed P]`:
- `agentChunk(effort, "t1")` → B; `agentChunk(effort, "t9")` → the active chunk B (no workref of its own: the active
  one stands in); an effort with no active chunk and no workref → `null`.
- `nextChunks(effort, "B")` → `["C", "D"]` (two pending after it, proposed never listed).
- `latestNote(B)` → `"slow"`.
- `proposedCount(effort)` → 1.

`initiativepickermodel.test.ts`: `pickerRows(cards, project, query)` lists the project's non-archived initiatives
(not ideas) first with `done/total` and a status word, then "Other projects · N"; a query filters titles
case-insensitively across all projects; `excluding` an oref (the initiative itself and its descendants, for Link to…
on the List) leaves those out.

`bindings.test.ts`: `agent:initiative` is bound to `i` on the Agent surface in navigate posture and yields while
`initiativePopoverAtom` is set (its own keys own the popover).

**Step 2: Implement.**

- `initiativepopovermodel.ts`, `initiativepickermodel.ts`: pure, as tested.
- `initiativepopover.tsx` (340px, `bg-surface-raised border-edge-mid rounded-[10px] shadow-popover-xl`, anchored under
  the header link with `@floating-ui` as other header popovers do; `role="dialog"`): the board's content — kicker
  "Initiative · <project>" with the status at the right, title 14px semibold, "↳ Part of <parent>" link when
  `parentoid`, `SegmentBar` (from `briefrowviews.tsx`) with done/total; **This agent is on** row (selected grey fill,
  accent inset ring as the keyboard cursor) with **Mark done** (`advanceChunk`) and the latest note under it; **Next**
  rows (spec §3: a click, or `Enter` on the cursor row, opens a small menu in the popover listing the chunk statuses
  `pending`, `active`, `blocked`, `deferred`, `skipped` through `setChunkStatus`, and **Rename**, which swaps the row's
  label for an input saved through `renameChunk`; it never leaves the agent); "N proposed · Review on the rail" when any;
  footer **Add note** (an inline input; Enter appends through `appendChunkNote` to the agent's chunk), **Open in
  Jarvis**, Esc. Its own `onKeyDown` handles `m`, `n`, `↑`/`↓`, `Enter`, `Esc` with `stopPropagation`.
- `initiativepicker.tsx` (shared by this task and Task 10): filter input, rows from `pickerRows`, "+ New initiative from
  this session", "Other projects · N" which expands them; `↑`/`↓`/`Enter`/`Esc`; `onPick(oref | "new")`.
- `agentheader.tsx`: `InitiativeLink` opens the popover on click; Ctrl/Cmd-click (`isPeekGesture`) keeps today's
  `openOrPeek` to Jarvis. An agent with no `effortId` shows **+ Link to initiative** (dashed `edge-strong`, 20px) that
  opens the picker; a pick runs `SetMetaCommand({ oref: "tab:" + agent.id, meta: { "session:effort": oref } })` then
  `attachAgent(oref, <active chunk, else first pending>, agent.id)`; "new" calls `createIdea(agent.name)` (Task 5 made
  it return the oref) and sets `session:effort` to that oref; a new idea has no chunk, so nothing is attached.
- `initiativePopoverAtom` (`string | null`, the agent id) beside the popover; `bindings.ts` `buildAgentBindings` gains
  `{ id: "agent:initiative", keys: "i", group: "Agent", label: "The agent's initiative", when: nav && focused agent }`
  toggling it for the focused agent; the single-key Agent bindings yield while it is set; `whenstate.ts` lists the atom
  in `PREDICATE_ATOMS`. `docs/keyboard-shortcuts.md` is updated in Task 11.

**Step 3: Run the tests, `task check:ts`, try it in the dev app.** CDP steps: `initiative-popover` and
`initiative-link` (Task 11). **Commit** `feat(agents): the initiative popover and Link to initiative`.

---

### Task 8: Proposed chunks on the Jarvis List

**Depends on:** Task 5

**Files:** `frontend/app/view/jarvis/inlinetracker.ts`, `frontend/app/view/jarvis/inlinetracker.test.ts`, `frontend/app/view/jarvis/inlinetrackerview.tsx`, `frontend/app/view/jarvis/briefrows.ts`, `frontend/app/view/jarvis/briefrows.test.ts`, `frontend/app/view/jarvis/briefrowviews.tsx`

Boards: `ParentChild.dc.html` (the row's "4 proposed" in the column before the actions).

An opened initiative (or idea) on the List shows its proposed chunks as their own group above the plan, with the
rail's buttons, so a plan-review item opened when its agent is gone can still be decided. A closed row says how many
wait: an initiative's row and an idea's row in the Ideas column both carry "N proposed" (spec §1).

**Step 1: Failing tests.** `inlinetracker.test.ts`: `trackerRows` of an effort with proposed chunks yields a
`proposed` group row first, listing them, and leaves them out of the stage groups and their counts.
`briefrows.test.ts`: `initiativeLine` of a tracker card with `proposed: ["P1","P2","P3","P4"]` carries
`proposed: "4 proposed"`; of an idea card whose only chunks are proposed (`isIdea` true) also `"4 proposed"`; of a
card with none, no `proposed` text.

**Step 2: Implement** the group in `inlinetracker.ts` and its view in `inlinetrackerview.tsx`: a "Proposed · N" header
in `text-asking` with Accept all / Drop all, each row with Accept / Rename / Drop (reuse the row look of
`planreviewsection.tsx`; copy the classes rather than importing an agents view into jarvis), calling `acceptProposed`
/ `dropProposed` / `renameChunk`. An idea with only proposed chunks shows this group in place of IdeaDetail's "Plan it".
`briefrows.ts`: `BriefLine` gains an optional `proposed` text, set by `initiativeLine` for trackers and ideas;
`briefrowviews.tsx` draws it right-aligned in `text-asking` 10.5px, no wrap, in the column before the row's actions
(the board's place), on initiative and idea rows.

**Step 3: Tests, `task check:ts`.** CDP steps: `initiative-plan-review` steps 7–8 and its idea steps (Task 11).
**Commit** `feat(jarvis): decide proposed chunks on the List`.

---

### Task 9: Review mode, idle initiatives, and Sprout's review line

**Depends on:** Task 7, Task 8

**Files:** `frontend/app/view/jarvis/reviewmodel.ts`, `frontend/app/view/jarvis/reviewmodel.test.ts`, `frontend/app/view/jarvis/reviewstore.ts`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/briefrowviews.tsx`, `frontend/app/view/jarvis/petpeek.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/whenstate.ts`

Board: `Review.dc.html`, `Sprout.dc.html`.

**Step 1: Failing tests** `reviewmodel.test.ts` (`now` fixed; `DAY = 86_400_000`):

```ts
import { describe, expect, it } from "vitest";
import { eventsSince, isIdle, reviewQueue } from "./reviewmodel";

const card = (oref: string, over: Partial<any> = {}) => ({
    oref, status: "active", updatedts: 0, blockedChunks: [], working: false, asking: false, ...over,
});

describe("isIdle", () => {
    it("is active, nobody on it, and still and unreviewed for 14 days", () => {
        const now = 15 * 86_400_000;
        expect(isIdle(card("a", { updatedts: 0 }), undefined, now)).toBe(true);
        expect(isIdle(card("a", { updatedts: 0, working: true }), undefined, now)).toBe(false);
        expect(isIdle(card("a", { updatedts: 2 * 86_400_000 }), undefined, now)).toBe(false);
        expect(isIdle(card("a", { status: "paused" }), undefined, 99 * 86_400_000)).toBe(false);
        // Mark reviewed takes it out of the queue until 14 more still days pass
        expect(isIdle(card("a", { updatedts: 0 }), now - 86_400_000, now)).toBe(false);
        expect(isIdle(card("a", { updatedts: 0 }), 0, now)).toBe(true);
    });
});

describe("reviewQueue", () => {
    it("takes changed and idle ones: blocked, asking, working, changed, then idle", () => {
        const now = 30 * 86_400_000;
        const cards = [
            card("idle", { updatedts: 1 }),
            card("changed", { updatedts: now - 1000 }),
            card("work", { updatedts: now - 1000, working: true }),
            card("ask", { updatedts: now - 1000, asking: true }),
            card("stuck", { updatedts: now - 1000, blockedChunks: ["x"] }),
            card("seen", { updatedts: now - 5000 }),
            card("idleseen", { updatedts: 1 }),
        ];
        const reviewed = { seen: now - 4000, idleseen: now - 2 * 86_400_000 };
        expect(reviewQueue(cards as any, reviewed, now - 86_400_000, now).map((q) => q.oref)).toEqual([
            "stuck", "ask", "work", "changed", "idle",
        ]);
    });
    it("empties once each one is marked reviewed", () => {
        const now = 30 * 86_400_000;
        const cards = [card("idle", { updatedts: 1 }), card("changed", { updatedts: now - 1000 })];
        const reviewed = { idle: now - 10, changed: now - 10 };
        expect(reviewQueue(cards as any, reviewed, now - 86_400_000, now)).toEqual([]);
    });
});

describe("eventsSince", () => {
    it("keeps the events after the mark, newest first", () => {
        const events = [
            { ts: 1, kind: "chunk-added", label: "old" },
            { ts: 5, kind: "chunk-done", label: "Fold pause box" },
            { ts: 9, kind: "effort-note", text: "beam timing feels slow" },
        ];
        expect(eventsSince(events as any, 2).map((e) => e.ts)).toEqual([9, 5]);
    });
});
```

The queue's input cards carry `working` (some chunk has a workref) and `asking` (a `plan-review` or an ask attaches to
it), which the surface computes from the effort summaries and the attention queue.

**Step 2: Implement.**

- `reviewmodel.ts`: `IDLE_MS = 14 * DAY`; `isIdle(card, reviewedAt: number | undefined, now)` (active, no workref,
  `updatedts` and `reviewedAt` both older than `IDLE_MS`; never reviewed counts as old), `reviewQueue(cards, reviewed: Record<string, number>,
  fallback: number, now)` (an initiative never reviewed uses `fallback`, the "Since you looked" cursor), `eventsSince`,
  `idleLabel(updatedts, now)` ("idle 3w"), and `eventLine(event)` mapping `chunk-done` → `✓ <label> · done`,
  `chunk-added` → `+ <label> · added`, `chunk-status` → `<label> · <status>`, `effort-status` → `now <status>`,
  `effort-note` → `note: <text>`.
- `reviewstore.ts`: `reviewedAtom = atomWithStorage<Record<string, number>>("jarvis.review.reviewed", {}, undefined,
  { getOnInit: true })`, `markReviewed(oref, now)`, and `reviewModeAtom` (`{ cursor: string } | null`, not persisted).
- `briefsurface.tsx`: the Initiatives region heading gains **Review · N** (hidden at 0). Review mode replaces the
  region's rows with the queue: the current one opened as the board draws it (`Since you reviewed` block from
  `eventsSince` of the effort detail, loaded on open; the actions Keep going (marks reviewed), Go to agent / Work on,
  Pause, Archive, and **Mark reviewed**; Pause and Archive first for an idle one), the rest as rows with their reason
  at the right, reviewed ones faded with ✓; "Reviewing K of N" with ←/→; **Exit review**; at the end "All reviewed"
  with Back to the list.
- `briefrowviews.tsx`: the status cell reads `idleLabel(...)` in `text-ink-faint` for an idle initiative; a changed one
  carries a 6px accent dot before its title.
- `bindings.ts` (`buildJarvisBindings`): `jarvis:review` `v` enters review; while `reviewModeAtom` is set, `Enter`
  marks reviewed and steps, `j`/`k` and `←`/`→` move, `Esc` exits (and `surface:back-home` yields, as for the peek);
  `whenstate.ts` lists `reviewModeAtom`. Jarvis also runs `buildListNavBindings`, which owns `j`/`k`/`Enter` there:
  its `active` predicate returns false while `reviewModeAtom` is set, so the review bindings take those keys. A
  `bindings.test.ts` case resolves `j`, `k` and `Enter` on Jarvis with review mode on to the review bindings, and with
  it off to the list-nav ones.
- `petpeek.tsx`: below the rows, when any initiative is changed or idle, one muted line
  "N initiatives changed · M idle" with a **Review in Jarvis** link that lands on Jarvis in review mode. It does not
  add to the badge.

**Step 3: Tests, `task check:ts`, dev app. CDP step: `initiative-review` (Task 11). Commit** `feat(jarvis): review changed and idle initiatives`.

---

### Task 10: Parent and child initiatives on the List

**Depends on:** Task 9

**Files:** `frontend/app/view/jarvis/briefrows.ts`, `frontend/app/view/jarvis/briefrows.test.ts`, `frontend/app/view/jarvis/briefrowviews.tsx`, `frontend/app/view/jarvis/briefsurface.tsx`

Board: `ParentChild.dc.html`.

**Step 1: Failing test** in `briefrows.test.ts`: `nestInitiatives(cards)` puts each child right after its parent with
`depth: 1` (a grandchild `depth: 2`), keeps the parents in their given order, treats a child whose parent is not in
the list (archived, filtered out) as top level, and gives the parent `subCount`. `linkedUnder(parentOref, cards)`
returns `{ subs, ideas }`: the non-archived cards whose `parentoid` is the parent, split by `isIdea` (spec §5: an idea
linked to an initiative shows under it in the opened detail), each in the given order.

**Step 2: Implement.**

- `briefrows.ts`: `nestInitiatives` as tested, applied to the trackers after `orderInitiatives` and before the caps.
- `briefrowviews.tsx`: a child row is indented 20px per depth with an elbow (`border-l` + `border-b` `edge-strong`,
  `rounded-bl-[6px]`, 10×24px) and its meta line reads "↳ Part of <parent>"; a parent's title carries "+N sub" in
  `text-ink-mid` 10.5px; the opened parent lists Sub-initiatives (title, done/total, status), each opening its row,
  and under them the Ideas linked to it (title, "N proposed" when any), each opening the idea, both from
  `linkedUnder`. A linked idea stays in the Ideas column as well.
- `briefsurface.tsx`: the initiative row's ⋯ menu gains **Link to…** (opens `InitiativePicker` excluding the initiative and its
  descendants; a pick calls `linkEffort`) and **Unlink from <parent>** when linked. A refused link (the cycle error)
  shows as the menu's error toast.

**Step 3: Tests, `task check:ts`, dev app. CDP step: `initiative-parents` (Task 11). Commit** `feat(jarvis): parent and child initiatives on the List`.

---

### Task 11: CDP scenarios, docs and the CHANGELOG

**Depends on:** Task 2, Task 3, Task 10

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/keyboard-shortcuts.md`, `docs/guide/agent.md`, `docs/guide/jarvis.md`, `docs/guide/agent-integration.md`

**Step 1: Scenarios** in `scripts/cdp/scenarios.mjs`, each registered in the exported list and tearing down what it
made (efforts through `effortmutate`/delete, tabs closed). Make the agent the way `openUploadsAgent` does: a terminal
tab that publishes a Claude agent status, plus `setmeta` of `tab:<id>` with `"session:effort": "effort:<oid>"`.

- `initiative-plan-review`: create an initiative with one done chunk, then `effortmutate` four `addChunk` ops with
  `status: "proposed"` (P1–P4); create an idea with two proposed chunks and nothing else; open the agent. Steps:
  (1) the rail shows "Plan to review" first with four rows (shot); (2) the header shows "4 TO REVIEW", and clicking the
  chip with the rail on another section brings the rail back to Plan to review; (3) Sprout's popup and the Brief's
  Waiting on you list "Plan to review"; (4) Rename on P4, type, Enter: the row and the effort's chunk carry the new
  label; (5) Accept on P1 reads "accepted · now pending" and the chunk is `pending`; Undo returns it to `proposed`;
  Accept again; (6) Drop on P2 reads "dropped" and the chunk is gone; (7) on the Jarvis List the initiative's row reads
  "2 proposed" and the idea's row in the Ideas column "2 proposed" (shot); (8) opening the initiative shows
  "Proposed · 2"; Accept on P3 there makes it `pending`; (9) opening the idea, Drop all removes both chunks and it is
  still an idea; (10) back on the agent, Accept all and continue accepts the renamed P4, the agent's terminal receives
  "Plan accepted, start with <P4's label>" (read the xterm buffer, or record the controller-input RPC the send makes),
  the section leaves the rail, the chip goes, and the Waiting on you row is gone.
- `initiative-popover`: an initiative with chunks `[done, active (workref agent:<tab>), pending, pending]` and a note
  on the active one. Steps: (1) `i` opens the popover showing "This agent is on" with the active chunk and its note
  (shot); (2) Next lists the two pending chunks; clicking the first opens its menu, Rename, type, Enter renames the
  chunk, and the menu's `deferred` sets its status; (3) `m` marks the agent's chunk done and the following chunk becomes
  active (`advance` takes a deferred one too); (4) `n`, type, Enter appends a note; (5) Esc closes it and focus returns; (6) Ctrl+click on the header's
  initiative link opens no popover and lands on Jarvis with the initiative selected.
- `initiative-link`: two agent tabs with no `session:effort` and one initiative in their project. Steps: (1) the
  header shows "+ Link to initiative"; (2) clicking it opens the picker listing the initiative (shot); (3) picking it
  sets the tab's `session:effort` and the header shows the initiative link; (4) on the second agent, the picker's
  "+ New initiative from this session" creates an idea titled with the agent's name, sets that tab's
  `session:effort` to it, and the header links it (teardown deletes the idea).
- `initiative-review`: three initiatives, made in the scenario at real time T: one changed, one blocked (a chunk set
  `blocked`), one idle. Seed `jarvis.review.reviewed` in localStorage with a mark for every one of them, so none
  falls back to the "Since you looked" cursor: the changed and the blocked ones at T − 1h (changed: their `updatedts`
  is after the mark), the idle one at T + 1 min (after its last change, so not changed). `updatedts` cannot be forged
  over RPC, so stub `Date.now` in the page to T + 20 days before opening Jarvis (restore it in teardown): the idle
  one's change and mark are then 20 days old. Assert on the three seeded orefs, not on totals, so another effort in
  the store cannot move the count. Steps: (1) the Initiatives heading reads "Review · 3"; (2) `v` enters review with
  the blocked one open and "Since you reviewed" listing its events (shot); (3) Enter marks it and opens the next (the
  changed one), and `k` then `j` move back and forward without moving the List's cursor; (4) Enter again opens the idle
  one, which shows "idle 2w" with Pause and Archive first; (5) Enter, and the end reads "All reviewed"; Esc leaves;
  the heading's Review count is gone (all three marked); (6) Sprout's popup showed "initiatives changed" before step 2.
- `initiative-parents`: a parent with two children (`link` ops), an idea linked under the parent (`link` op), and an
  unrelated initiative. Steps: (1) the children sit under the parent indented with "↳ Part of" (shot); (2) the parent
  reads "+2 sub"; (3) opening the parent lists both under Sub-initiatives and the idea under its linked Ideas;
  (4) the unrelated row's ⋯ → Link to… → the parent moves it under; (5) linking the parent under its child is refused
  with the cycle message; (6) Unlink returns it to top level.

**Step 2: Docs.**

- `docs/keyboard-shortcuts.md`: Agent `i` (the agent's initiative; inside it `m` Mark done, `n` Add note, Esc);
  Jarvis `v` (Review; inside it Enter Mark reviewed, `j`/`k` or `←`/`→`, Esc).
- `docs/guide/agent.md`: Plan to review on the rail, the header chip, the popover, Link to initiative.
- `docs/guide/jarvis.md`: proposed chunks on the List, Review mode and idle initiatives, parent/child rows, the
  Plan to review item in Waiting on you.
- `docs/guide/agent-integration.md`: `wsh effort chunk add --proposed` and the skill rule.

**Step 3: CHANGELOG.** Under the top section (open `## Unreleased` above it if it carries a date), `### Added`:

- **Review an agent's proposed plan on its rail**: when an agent proposes chunks for its initiative, its details rail
  opens on Plan to review; accept, rename or drop each, or Accept all and continue. Proposed chunks don't count toward
  progress until accepted.
- **The agent's initiative from its header**: click the initiative link (or press `i`) for its progress, the chunk
  this agent is on with Mark done, what's next and a note; an agent with no initiative can Link to one.
- **Review initiatives**: Jarvis → Initiatives → Review (`v`) walks what changed since you last reviewed, then the
  ones idle for two weeks, with Pause, Archive and Mark reviewed.
- **Sub-initiatives on the List**: link an initiative under another from its ⋯ menu; children sit under their parent.

**Step 4: Run** `node scripts/cdp/verify.mjs initiative-plan-review initiative-popover initiative-link initiative-review initiative-parents`
against a dev app if one is running; otherwise say it did not run. **Commit** `test(cdp): initiative scenarios; docs and changelog`.
