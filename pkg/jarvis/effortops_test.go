package jarvis

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const effortNow = 1_700_000_000_000

func mkEffort() *waveobj.Effort {
	return &waveobj.Effort{
		Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: "Phase 1", Status: "done", UpdatedTs: effortNow},
			{Label: "Phase 2", Status: "active", UpdatedTs: effortNow},
			{Label: "Phase 3", Status: "pending", UpdatedTs: effortNow},
		},
	}
}

func expectErrCode(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), code) {
		t.Fatalf("want error containing %q, got %v", code, err)
	}
}

func TestApplyOpsRename(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "rename", Title: "new title"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Title != "new title" {
		t.Fatalf("title: %q", e.Title)
	}
}

func TestApplyOpsChunkBaseCommit(t *testing.T) {
	const a, b = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Phase 4", Base: a}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if got := e.Chunks[3].BaseCommit; got != a {
		t.Fatalf("addChunk base = %q, want %q", got, a)
	}
	// a rename with no base (no checkout to read) keeps the old one rather than clearing it
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "renameChunk", Chunk: "Phase 4", Label: "Phase four"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if got := e.Chunks[3].BaseCommit; got != a {
		t.Fatalf("rename without base = %q, want %q kept", got, a)
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "renameChunk", Chunk: "Phase four", Label: "Phase 4", Base: b}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if got := e.Chunks[3].BaseCommit; got != b {
		t.Fatalf("rename base = %q, want %q", got, b)
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "recheckChunk", Chunk: "Phase 3", Base: b, Note: "still right"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	c := e.Chunks[2]
	if c.BaseCommit != b {
		t.Fatalf("recheck base = %q, want %q", c.BaseCommit, b)
	}
	if last := c.Notes[len(c.Notes)-1].Text; last != "checked against bbbbbbbbb · still right" {
		t.Fatalf("recheck note = %q", last)
	}
	// nothing to check against: refused, so the card does not claim a check that measured nothing
	expectErrCode(t, ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "recheckChunk", Chunk: "Phase 3"}}, "", effortNow), "EC-NO-BASE")
	expectErrCode(t, ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "recheckChunk", Chunk: "nope", Base: b}}, "", effortNow), "EC-")
}

func TestApplyOpsAddChunkInsertAt(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Phase 0", At: intPtr(1)}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks) != 4 || e.Chunks[0].Label != "Phase 0" {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
}

// at = len+1 is the end of the list, and a new chunk is a feed event
func TestApplyOpsAddChunkAtEndEmitsEvent(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Phase 4", At: intPtr(4)}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if got := chunkLabels(e); got != "Phase 1, Phase 2, Phase 3, Phase 4" {
		t.Fatalf("chunks: %v", got)
	}
	want := []waveobj.EffortEvent{{Ts: effortNow, Kind: "chunk-added", Label: "Phase 4"}}
	if !reflect.DeepEqual(e.Events, want) {
		t.Fatalf("events: %+v, want %+v", e.Events, want)
	}
}

func TestApplyOpsMoveChunkDown(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "moveChunk", Chunk: "Phase 2", At: intPtr(3)}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if got := chunkLabels(e); got != "Phase 1, Phase 3, Phase 2" {
		t.Fatalf("chunks: %v", got)
	}
}

func TestApplyOpsMoveChunkIndexBounds(t *testing.T) {
	for _, at := range []*int{nil, intPtr(0), intPtr(4)} {
		e := mkEffort()
		err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "moveChunk", Chunk: "Phase 2", At: at}}, "", effortNow)
		expectErrCode(t, err, "EC-INVALID-INDEX")
	}
}

func TestApplyOpsAddChunkDuplicateLabel(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Phase 2"}}, "", effortNow)
	expectErrCode(t, err, "EC-DUPLICATE-LABEL")
}

func TestApplyOpsRemoveLastChunkGuard(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{{Label: "only", Status: "pending"}}
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "removeChunk", Chunk: "only"}}, "", effortNow)
	expectErrCode(t, err, "EC-LAST-CHUNK")
}

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

func TestApplyOpsResolveChunkRefs(t *testing.T) {
	e := mkEffort()
	// label ref
	idx, err := ResolveChunkIndex(e, "Phase 3")
	if err != nil || idx != 2 {
		t.Fatalf("label ref: idx=%d err=%v", idx, err)
	}
	// 1-based index ref
	idx, err = ResolveChunkIndex(e, "2")
	if err != nil || idx != 1 {
		t.Fatalf("index ref: idx=%d err=%v", idx, err)
	}
	// ambiguous: "Phase" matches nothing exactly; "Phase 1" is exact — try a substring that is not a label
	_, err = ResolveChunkIndex(e, "nope")
	expectErrCode(t, err, "EC-UNKNOWN-CHUNK")
}

// An all-digit label goes as "=<label>": it resolves by label alone, and a label that is gone is an unknown chunk,
// never the chunk now at that position.
func TestResolveChunkIndexExactLabel(t *testing.T) {
	e := &waveobj.Effort{Chunks: []waveobj.EffortChunk{{Label: "a"}, {Label: "1"}, {Label: "=b"}, {Label: "b"}}}
	if idx, err := ResolveChunkIndex(e, "=1"); err != nil || idx != 1 {
		t.Fatalf("=1: idx=%d err=%v", idx, err)
	}
	if idx, err := ResolveChunkIndex(e, "1"); err != nil || idx != 0 {
		t.Fatalf("bare 1 stays a position: idx=%d err=%v", idx, err)
	}
	if idx, err := ResolveChunkIndex(e, "==b"); err != nil || idx != 2 {
		t.Fatalf("==b: idx=%d err=%v", idx, err)
	}
	if idx, err := ResolveChunkIndex(e, "=b"); err != nil || idx != 3 {
		t.Fatalf("=b: idx=%d err=%v", idx, err)
	}
	_, err := ResolveChunkIndex(e, "=2")
	expectErrCode(t, err, "EC-UNKNOWN-CHUNK")
	only := &waveobj.Effort{Chunks: []waveobj.EffortChunk{{Label: "=x"}}}
	if idx, err := ResolveChunkIndex(only, "=x"); err != nil || idx != 0 {
		t.Fatalf("a label starting with = typed bare: idx=%d err=%v", idx, err)
	}
}

func TestApplyOpsSetChunkStatusEmitsEvents(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkStatus", Chunk: "Phase 3", Status: "blocked", Note: "waiting on substrate"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[2].Status != "blocked" {
		t.Fatalf("status: %s", e.Chunks[2].Status)
	}
	if len(e.Chunks[2].Notes) != 1 || !strings.Contains(e.Chunks[2].Notes[0].Text, "blocked") {
		t.Fatalf("auto-stamp missing: %+v", e.Chunks[2].Notes)
	}
	if len(e.Events) != 1 || e.Events[0].Kind != "chunk-status" || e.Events[0].Label != "Phase 3" {
		t.Fatalf("events: %+v", e.Events)
	}
}

// the trail note carries the status, and the op's note after a separator only when there is one
func TestApplyOpsSetChunkStatusNoteText(t *testing.T) {
	e := mkEffort()
	ops := []wshrpc.EffortOp{
		{Op: "setChunkStatus", Chunk: "Phase 3", Status: "blocked", Note: "waiting on substrate"},
		{Op: "setChunkStatus", Chunk: "Phase 2", Status: "done"},
	}
	if err := ApplyEffortOps(e, ops, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if got := e.Chunks[2].Notes; len(got) != 1 || got[0].Text != "marked blocked · waiting on substrate" {
		t.Fatalf("Phase 3 notes: %+v", got)
	}
	if got := e.Chunks[1].Notes; len(got) != 1 || got[0].Text != "marked done" {
		t.Fatalf("Phase 2 notes: %+v", got)
	}
}

func TestApplyOpsAdvanceSemantics(t *testing.T) {
	e := mkEffort()
	// Phase 2 active -> done, Phase 3 becomes active
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[1].Status != "done" || e.Chunks[2].Status != "active" {
		t.Fatalf("advance: %+v", e.Chunks)
	}
	// no active chunk: advance just activates the first non-done
	e2 := mkEffort()
	e2.Chunks[1].Status = "pending"
	err = ApplyEffortOps(e2, []wshrpc.EffortOp{{Op: "advance"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e2.Chunks[1].Status != "active" {
		t.Fatalf("advance-no-active: %+v", e2.Chunks)
	}
}

func TestApplyOpsReopenUndoesAdvance(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "reopen", Chunk: "Phase 1"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Status != "active" || e.Chunks[1].Status != "pending" {
		t.Fatalf("reopen: %+v", e.Chunks)
	}
}

// a ticked later chunk reopened must not take the plan's active chunk off it (and the plan's reopen leaves a later one alone)
func TestReopenKeepsThePlanAndLaterActiveChunksApart(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{
		{Label: "A", Status: "active"},
		{Label: "L", Status: "done", Later: true},
		{Label: "M", Status: "active", Later: true},
		{Label: "B", Status: "done"},
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "reopen", Chunk: "L"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Status != "active" || e.Chunks[1].Status != "active" || e.Chunks[2].Status != "pending" {
		t.Fatalf("after reopening L: %+v, want A still active, L active, M back to pending", e.Chunks)
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "reopen", Chunk: "B"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Status != "pending" || e.Chunks[1].Status != "active" || e.Chunks[3].Status != "active" {
		t.Fatalf("after reopening B: %+v, want A back to pending, B active, the later L untouched", e.Chunks)
	}
}

func TestApplyOpsReopenNonDoneRejected(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "reopen", Chunk: "Phase 3"}}, "", effortNow)
	expectErrCode(t, err, "EC-INVALID-STATUS")
}

func TestApplyOpsAppendNoteToChunk(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "appendNote", Chunk: "Phase 1", Note: "soak accepted"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks[0].Notes) != 1 || e.Chunks[0].Notes[0].Text != "soak accepted" {
		t.Fatalf("notes: %+v", e.Chunks[0].Notes)
	}
	if len(e.Events) != 1 || e.Events[0].Kind != "effort-note" {
		t.Fatalf("events: %+v", e.Events)
	}
}

// an index ref names a position, and positions shift when the plan is reordered
func TestApplyOpsEventsNameTheResolvedChunk(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{
		{Op: "setChunkStatus", Chunk: "3", Status: "blocked"},
		{Op: "appendNote", Chunk: "1", Note: "soak accepted"},
	}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Events) != 2 || e.Events[0].Label != "Phase 3" || e.Events[1].Label != "Phase 1" {
		t.Fatalf("events: %+v", e.Events)
	}
}

func TestApplyOpsAdvanceEventCarriesNote(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance", Note: "plan written"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Events) != 1 || e.Events[0].Kind != "chunk-done" || e.Events[0].Text != "plan written" {
		t.Fatalf("events: %+v", e.Events)
	}
}

func TestApplyOpsAtomicBatchRollback(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{
		{Op: "rename", Title: "half-applied"},
		{Op: "addChunk", Label: "Phase 2"}, // duplicate — must abort the batch
	}, "", effortNow)
	expectErrCode(t, err, "EC-DUPLICATE-LABEL")
	if e.Title != "t" {
		t.Fatalf("batch not atomic: title=%q", e.Title)
	}
}

func TestApplyOpsSetChunkStatusInvalid(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkStatus", Chunk: "Phase 3", Status: "banana"}}, "", effortNow)
	expectErrCode(t, err, "EC-INVALID-STATUS")
}

func TestApplyOpsCmdNoteAppendedToEffort(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setTicket", Ticket: "SIEM-1662"}}, "filed from briefing", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Notes) != 1 || !strings.Contains(e.Notes[0].Text, "filed from briefing") {
		t.Fatalf("cmd note missing: %+v", e.Notes)
	}
}

func TestApplyOpsAttachWork(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 2", Kind: "agent", ORef: "agent:tab-1"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks[1].WorkRefs) != 1 || e.Chunks[1].WorkRefs[0].ORef != "agent:tab-1" || e.Chunks[1].WorkRefs[0].Kind != "agent" {
		t.Fatalf("workrefs: %+v", e.Chunks[1].WorkRefs)
	}
	if len(e.Chunks[1].Notes) != 1 {
		t.Fatalf("auto-stamp missing: %+v", e.Chunks[1].Notes)
	}
	if len(e.Events) != 0 {
		t.Fatalf("attach must not emit delta events: %+v", e.Events)
	}
}

func TestApplyOpsAttachWorkIdempotentSameChunk(t *testing.T) {
	e := mkEffort()
	for i := 0; i < 2; i++ {
		err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 2", Kind: "agent", ORef: "agent:tab-1"}}, "", effortNow)
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(e.Chunks[1].WorkRefs) != 1 {
		t.Fatalf("duplicate refs: %+v", e.Chunks[1].WorkRefs)
	}
}

func TestApplyOpsAttachWorkConflictOtherChunk(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 2", Kind: "agent", ORef: "agent:tab-1"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 3", Kind: "agent", ORef: "agent:tab-1"}}, "", effortNow)
	expectErrCode(t, err, "EC-REF-ALREADY-ATTACHED")
}

// A workref left on a settled chunk (done or skipped) is history, not a hold: the same agent or run
// attaches to another chunk, and the settled chunks keep what they recorded.
func TestApplyOpsAttachWorkAfterSettledChunk(t *testing.T) {
	e := &waveobj.Effort{
		Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: "Shipped", Status: "done", UpdatedTs: effortNow, WorkRefs: []waveobj.ChunkWorkRef{
				{Kind: "agent", ORef: "agent:tab-1", Ts: effortNow},
				{Kind: "run", ORef: "run:r1", Ts: effortNow},
			}},
			{Label: "Dropped", Status: "skipped", UpdatedTs: effortNow, WorkRefs: []waveobj.ChunkWorkRef{
				{Kind: "agent", ORef: "agent:tab-1", Ts: effortNow},
			}},
			{Label: "Next", Status: "pending", UpdatedTs: effortNow},
		},
	}
	ops := []wshrpc.EffortOp{
		{Op: "attachWork", Chunk: "Next", Kind: "agent", ORef: "agent:tab-1"},
		{Op: "attachWork", Chunk: "Next", Kind: "run", ORef: "run:r1"},
	}
	for _, op := range ops {
		if err := ApplyEffortOps(e, []wshrpc.EffortOp{op}, "", effortNow); err != nil {
			t.Fatalf("attach %s after a settled chunk: %v", op.ORef, err)
		}
	}
	if got := e.Chunks[2].WorkRefs; len(got) != 2 || got[0].ORef != "agent:tab-1" || got[1].ORef != "run:r1" {
		t.Fatalf("Next workrefs: %+v", got)
	}
	if got := e.Chunks[0].WorkRefs; len(got) != 2 || got[0].ORef != "agent:tab-1" || got[1].ORef != "run:r1" {
		t.Fatalf("done chunk lost its workrefs: %+v", got)
	}
	if got := e.Chunks[1].WorkRefs; len(got) != 1 || got[0].ORef != "agent:tab-1" {
		t.Fatalf("skipped chunk lost its workref: %+v", got)
	}
}

// A proposed chunk is not settled: a workref on one still blocks attaching elsewhere.
func TestApplyOpsAttachWorkProposedCountsAsLive(t *testing.T) {
	e := mkEffort()
	e.Chunks = append(e.Chunks, waveobj.EffortChunk{Label: "Idea", Status: "proposed", UpdatedTs: effortNow, WorkRefs: []waveobj.ChunkWorkRef{
		{Kind: "agent", ORef: "agent:tab-1", Ts: effortNow},
	}})
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 3", Kind: "agent", ORef: "agent:tab-1"}}, "", effortNow)
	expectErrCode(t, err, "EC-REF-ALREADY-ATTACHED")
}

// Validation reads the state before any op in the batch applies, so [detachWork old, attachWork new] is
// still refused while old is live: the client's chunk switch is two writes (spec §3), and a refused batch
// leaves the effort as it was.
func TestApplyOpsAttachWorkBatchStillSeesLiveChunk(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 2", Kind: "agent", ORef: "agent:tab-1"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	err := ApplyEffortOps(e, []wshrpc.EffortOp{
		{Op: "detachWork", Chunk: "Phase 2", ORef: "agent:tab-1"},
		{Op: "attachWork", Chunk: "Phase 3", Kind: "agent", ORef: "agent:tab-1"},
	}, "", effortNow)
	expectErrCode(t, err, "EC-REF-ALREADY-ATTACHED")
	if got := e.Chunks[1].WorkRefs; len(got) != 1 || got[0].ORef != "agent:tab-1" {
		t.Fatalf("a refused batch must not detach: %+v", got)
	}
	if len(e.Chunks[2].WorkRefs) != 0 {
		t.Fatalf("a refused batch must not attach: %+v", e.Chunks[2].WorkRefs)
	}
}

func TestApplyOpsAttachWorkInvalidKind(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 2", Kind: "bogus", ORef: "run:x"}}, "", effortNow)
	expectErrCode(t, err, "EC-INVALID-KIND")
}

func TestApplyOpsDetachWork(t *testing.T) {
	e := mkEffort()
	op := wshrpc.EffortOp{Op: "attachWork", Chunk: "Phase 2", Kind: "agent", ORef: "agent:tab-1"}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{op}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	// chunk-scoped detach
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "detachWork", Chunk: "Phase 2", ORef: "agent:tab-1"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks[1].WorkRefs) != 0 {
		t.Fatalf("refs remain: %+v", e.Chunks[1].WorkRefs)
	}
	notes := e.Chunks[1].Notes
	if last := notes[len(notes)-1].Text; last != "detached: agent:tab-1" {
		t.Fatalf("trail ends with %q, want the detach", last)
	}
}

func TestApplyOpsDetachWorkAnyChunk(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "attachWork", Chunk: "Phase 3", Kind: "run", ORef: "run:r1"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	// chunk omitted -> removed from whichever chunk holds it
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "detachWork", ORef: "run:r1"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range e.Chunks {
		if len(c.WorkRefs) != 0 {
			t.Fatalf("refs remain: %+v", c.WorkRefs)
		}
	}
}

func TestApplyOpsDetachWorkAbsentIsNoOp(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "detachWork", ORef: "run:never-was"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
}

func TestApplyOpsUnarchiveRestoresPriorStatus(t *testing.T) {
	e := mkEffort()
	ops := []wshrpc.EffortOp{{Op: "setStatus", Status: "done"}, {Op: "setStatus", Status: "archived"}}
	if err := ApplyEffortOps(e, ops, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "unarchive"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Status != "done" {
		t.Fatalf("status: %q, want done", e.Status)
	}
}

func TestApplyOpsUnarchiveDefaultsToActive(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setStatus", Status: "archived"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "unarchive"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Status != "active" {
		t.Fatalf("status: %q, want active", e.Status)
	}
}

func TestApplyOpsUnarchiveRefusesUnarchived(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "unarchive"}}, "", effortNow)
	expectErrCode(t, err, "EC-NOT-ARCHIVED")
}

func TestApplyOpsUnarchiveSurvivesRepeatCycles(t *testing.T) {
	// paused -> archived -> unarchive -> archived -> unarchive must still land on paused: the second
	// cycle's own restore event must not be read as the status the archive replaced.
	e := mkEffort()
	for _, s := range []string{"paused", "archived"} {
		if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setStatus", Status: s}}, "", effortNow); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "unarchive"}}, "", effortNow); err != nil {
			t.Fatal(err)
		}
		if e.Status != "paused" {
			t.Fatalf("cycle %d status: %q, want paused", i, e.Status)
		}
		if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setStatus", Status: "archived"}}, "", effortNow); err != nil {
			t.Fatal(err)
		}
	}
}

func TestApplyOpsSetChunkStage(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkStage", Chunk: "Phase 2", Stage: "  Evidence pipeline  "}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[1].Stage != "Evidence pipeline" {
		t.Fatalf("stage: %q", e.Chunks[1].Stage)
	}
	if e.Chunks[0].Stage != "" || e.Chunks[2].Stage != "" {
		t.Fatalf("stage leaked to siblings: %+v", e.Chunks)
	}
	notes := e.Chunks[1].Notes
	if len(notes) != 1 || !strings.Contains(notes[0].Text, "Evidence pipeline") {
		t.Fatalf("trail: %+v", notes)
	}
	// a stage is a grouping label: it moves nothing and completes nothing, so it stays out of the delta.
	if len(e.Events) != 0 {
		t.Fatalf("expected no delta events, got %+v", e.Events)
	}
}

func TestApplyOpsSetChunkStageClears(t *testing.T) {
	e := mkEffort()
	e.Chunks[1].Stage = "Evidence pipeline"
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkStage", Chunk: "2", Stage: ""}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[1].Stage != "" {
		t.Fatalf("stage: %q", e.Chunks[1].Stage)
	}
}

func TestApplyOpsSetChunkStageUnknownChunk(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkStage", Chunk: "nope", Stage: "s"}}, "", effortNow)
	expectErrCode(t, err, "EC-UNKNOWN-CHUNK")
}

func TestApplyOpsSetChunkDue(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkDue", Chunk: "Phase 2", Due: "2026-10-20"}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[1].Due != "2026-10-20" {
		t.Fatalf("due: %q", e.Chunks[1].Due)
	}
	notes := e.Chunks[1].Notes
	if len(notes) != 1 || !strings.Contains(notes[0].Text, "2026-10-20") {
		t.Fatalf("trail: %+v", notes)
	}
	// a date completes nothing, so it stays out of the delta
	if len(e.Events) != 0 {
		t.Fatalf("expected no delta events, got %+v", e.Events)
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkDue", Chunk: "2", Due: ""}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[1].Due != "" {
		t.Fatalf("due not cleared: %q", e.Chunks[1].Due)
	}
}

func TestApplyOpsSetChunkDueRejectsNonDate(t *testing.T) {
	for _, due := range []string{"10-20", "2026-13-01", "+14d", "tomorrow"} {
		e := mkEffort()
		err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkDue", Chunk: "Phase 2", Due: due}}, "", effortNow)
		expectErrCode(t, err, "EC-INVALID-DUE")
		if e.Chunks[1].Due != "" {
			t.Fatalf("%q: a rejected batch changed the chunk", due)
		}
	}
}

func TestApplyOpsAddChunkWithDue(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Re-measure", Due: "2026-10-20"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[3].Due != "2026-10-20" {
		t.Fatalf("due: %q", e.Chunks[3].Due)
	}
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Bad", Due: "soon"}}, "", effortNow)
	expectErrCode(t, err, "EC-INVALID-DUE")
}

func TestApplyOpsAddChunkWithStage(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Phase 4", Stage: " Rollout "}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[3].Stage != "Rollout" {
		t.Fatalf("stage: %q", e.Chunks[3].Stage)
	}
}

// grouping is by consecutive run, so a reordered chunk must carry its stage to the new position —
// otherwise moving a chunk would silently re-file it under whatever stage it landed next to.
func TestApplyOpsMoveChunkCarriesStage(t *testing.T) {
	e := mkEffort()
	e.Chunks[2].Stage = "Rollout"
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "moveChunk", Chunk: "Phase 3", At: intPtr(1)}}, "", effortNow)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Label != "Phase 3" || e.Chunks[0].Stage != "Rollout" {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
}

func mkNotedEffort() *waveobj.Effort {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "appendNote", Chunk: "Phase 2", Note: "first"}}, "", effortNow+1); err != nil {
		panic(err)
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "appendNote", Chunk: "Phase 2", Note: "second"}}, "", effortNow+2); err != nil {
		panic(err)
	}
	return e
}

func TestApplyOpsEditNoteRewritesNoteAndEvent(t *testing.T) {
	e := mkNotedEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "editNote", Chunk: "Phase 2", At: intPtr(1), NoteTs: effortNow + 1, Note: "first, fixed"}}, "", effortNow+3)
	if err != nil {
		t.Fatal(err)
	}
	n := e.Chunks[1].Notes[0]
	if n.Text != "first, fixed" || !n.Edited || n.Ts != effortNow+1 {
		t.Fatalf("note: %+v", n)
	}
	found := false
	for _, ev := range e.Events {
		if ev.Kind == "effort-note" && ev.Ts == effortNow+1 {
			found = ev.Text == "first, fixed"
		}
	}
	if !found {
		t.Fatalf("event not rewritten: %+v", e.Events)
	}
}

func TestApplyOpsRemoveNoteDropsNoteAndEvent(t *testing.T) {
	e := mkNotedEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "removeNote", Chunk: "Phase 2", At: intPtr(1), NoteTs: effortNow + 1}}, "", effortNow+3)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks[1].Notes) != 1 || e.Chunks[1].Notes[0].Text != "second" {
		t.Fatalf("notes: %+v", e.Chunks[1].Notes)
	}
	for _, ev := range e.Events {
		if ev.Kind == "effort-note" && ev.Text == "first" {
			t.Fatalf("event kept: %+v", e.Events)
		}
	}
}

func TestApplyOpsNoteOpStaleTs(t *testing.T) {
	e := mkNotedEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "removeNote", Chunk: "Phase 2", At: intPtr(1), NoteTs: effortNow + 2}}, "", effortNow+3)
	expectErrCode(t, err, "EC-STALE-NOTE")
	if len(e.Chunks[1].Notes) != 2 {
		t.Fatalf("applied despite stale ts: %+v", e.Chunks[1].Notes)
	}
}

func TestApplyOpsNoteOpOutOfRange(t *testing.T) {
	e := mkNotedEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "editNote", Chunk: "Phase 2", At: intPtr(9), NoteTs: effortNow + 1, Note: "x"}}, "", effortNow+3)
	expectErrCode(t, err, "EC-INVALID-INDEX")
}

func TestApplyOpsEditNoteEmptyText(t *testing.T) {
	e := mkNotedEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "editNote", Chunk: "Phase 2", At: intPtr(1), NoteTs: effortNow + 1, Note: "   "}}, "", effortNow+3)
	expectErrCode(t, err, "EC-EMPTY-NOTE")
}

func TestApplyOpsEditStampNoteLeavesEvents(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkStage", Chunk: "Phase 3", Stage: "Later"}}, "", effortNow+1); err != nil {
		t.Fatal(err)
	}
	events := len(e.Events)
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "editNote", Chunk: "Phase 3", At: intPtr(1), NoteTs: effortNow + 1, Note: "stage fixed"}}, "", effortNow+2)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[2].Notes[0].Text != "stage fixed" || len(e.Events) != events {
		t.Fatalf("notes %+v events %+v", e.Chunks[2].Notes, e.Events)
	}
}

func TestApplyOpsNoteBatchAtomic(t *testing.T) {
	e := mkNotedEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{
		{Op: "editNote", Chunk: "Phase 2", At: intPtr(1), NoteTs: effortNow + 1, Note: "ok"},
		{Op: "removeNote", Chunk: "Phase 2", At: intPtr(2), NoteTs: 42},
	}, "", effortNow+3)
	expectErrCode(t, err, "EC-STALE-NOTE")
	if e.Chunks[1].Notes[0].Text != "first" {
		t.Fatalf("first op applied: %+v", e.Chunks[1].Notes)
	}
}

func TestApplyOpsAsStampsTheNoteAuthor(t *testing.T) {
	e := mkEffort()
	by := NoteAuthor{Who: "agent", Session: "agent:tab1", Run: "run:r1"}
	err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "appendNote", Chunk: "Phase 2", Note: "halfway"}}, "", effortNow, by)
	if err != nil {
		t.Fatal(err)
	}
	notes := e.Chunks[1].Notes
	n := notes[len(notes)-1]
	if n.Text != "halfway" || n.Author != "agent" || n.Session != "agent:tab1" || n.Run != "run:r1" {
		t.Fatalf("note = %+v, want the agent stamp", n)
	}
}

func TestApplyOpsLeavesTheAuthorEmpty(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "appendNote", Chunk: "Phase 2", Note: "x"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	n := e.Chunks[1].Notes[len(e.Chunks[1].Notes)-1]
	if n.Author != "" || n.Session != "" || n.Run != "" {
		t.Fatalf("note = %+v, want no author", n)
	}
}

// a pin is for live initiatives: archiving drops it, so an unarchived one comes back unpinned
func TestApplyOpsArchiveClearsThePin(t *testing.T) {
	e := mkEffort()
	e.PinnedTs = 42
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setStatus", Status: "archived"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.PinnedTs != 0 {
		t.Fatalf("PinnedTs = %d after archive, want 0", e.PinnedTs)
	}
	// another status keeps it
	e = mkEffort()
	e.PinnedTs = 42
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setStatus", Status: "paused"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.PinnedTs != 42 {
		t.Fatalf("PinnedTs = %d after pause, want 42", e.PinnedTs)
	}
}

// ---- Save for later: the chunk's later mark ----

func TestSetChunkLaterMarksAndClears(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkLater", Chunk: "Phase 3", Later: true}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if !e.Chunks[2].Later {
		t.Fatalf("Phase 3 not marked later: %+v", e.Chunks[2])
	}
	notes := e.Chunks[2].Notes
	if len(notes) != 1 || notes[0].Text != "marked for later" || notes[0].Ts != effortNow {
		t.Fatalf("trail after marking: %+v", notes)
	}
	// a mark completes nothing and adds nothing to the delta, as a due date does not
	if len(e.Events) != 0 {
		t.Fatalf("expected no delta events, got %+v", e.Events)
	}
	// the op resolves by index as the other chunk ops do
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkLater", Chunk: "3", Later: false}}, "", effortNow+1); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[2].Later {
		t.Fatalf("mark not dropped: %+v", e.Chunks[2])
	}
	notes = e.Chunks[2].Notes
	if len(notes) != 2 || notes[1].Text != "no longer for later" {
		t.Fatalf("trail after clearing: %+v", notes)
	}
}

func TestSetChunkLaterNoOpWritesNoNote(t *testing.T) {
	e := mkEffort()
	// off on a chunk that is not later: nothing to write
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkLater", Chunk: "Phase 3", Later: false}}, "", effortNow+5); err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks[2].Notes) != 0 || e.Chunks[2].UpdatedTs != effortNow {
		t.Fatalf("a no-op off wrote to the chunk: %+v", e.Chunks[2])
	}
	// on twice: the second changes nothing
	for i := 0; i < 2; i++ {
		if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkLater", Chunk: "Phase 3", Later: true}}, "", effortNow+10); err != nil {
			t.Fatal(err)
		}
	}
	if len(e.Chunks[2].Notes) != 1 {
		t.Fatalf("a repeated mark wrote %d notes, want 1: %+v", len(e.Chunks[2].Notes), e.Chunks[2].Notes)
	}
}

func TestSetChunkLaterUnknownChunk(t *testing.T) {
	e := mkEffort()
	err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "setChunkLater", Chunk: "nope", Later: true}}, "", effortNow)
	expectErrCode(t, err, "EC-UNKNOWN-CHUNK")
}

func TestSetChunkLaterStampsTheAuthor(t *testing.T) {
	e := mkEffort()
	by := NoteAuthor{Who: "agent", Session: "agent:tab1", Conversation: "conv-1"}
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "setChunkLater", Chunk: "Phase 3", Later: true}}, "", effortNow, by); err != nil {
		t.Fatal(err)
	}
	n := e.Chunks[2].Notes[0]
	if n.Author != "agent" || n.Session != "agent:tab1" || n.Conversation != "conv-1" {
		t.Fatalf("note = %+v, want the agent stamp with its conversation", n)
	}
}

func TestAddChunkLaterSetsTheMark(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Push DEV", Later: true}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	c := e.Chunks[3]
	if c.Label != "Push DEV" || !c.Later || c.Status != "pending" {
		t.Fatalf("chunk: %+v", c)
	}
	// with no Note there is no first note
	if len(c.Notes) != 0 {
		t.Fatalf("a later chunk with no note has notes: %+v", c.Notes)
	}
	// a plain add is not later
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "Phase 4"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[4].Later {
		t.Fatalf("a plain add came out later: %+v", e.Chunks[4])
	}
}

func TestAddChunkLaterFirstNote(t *testing.T) {
	op := wshrpc.EffortOp{Op: "addChunk", Label: "Decide which parser takes audit: logs", Later: true,
		Note: "> take it to a colleague\n\nFrom the chat.", Session: "agent:tab9", Conversation: "conv-9", Due: "2026-12-01"}

	// the cockpit ("you"): the op names the session and the conversation
	e := mkEffort()
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{op}, "", effortNow, NoteAuthor{Who: "you"}); err != nil {
		t.Fatal(err)
	}
	c := e.Chunks[3]
	if !c.Later || c.Due != "2026-12-01" || len(c.Notes) != 1 {
		t.Fatalf("chunk: %+v", c)
	}
	n := c.Notes[0]
	if n.Text != op.Note || n.Author != "you" || n.Session != "agent:tab9" || n.Conversation != "conv-9" || n.Ts != effortNow {
		t.Fatalf("first note: %+v", n)
	}
	if c.UpdatedTs != effortNow {
		t.Fatalf("UpdatedTs = %d, want the add's", c.UpdatedTs)
	}

	// a terminal: the batch's author decides, and the op's session and conversation are ignored
	e = mkEffort()
	by := NoteAuthor{Who: "agent", Session: "agent:real", Run: "run:r1", Conversation: "conv-real"}
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{op}, "", effortNow, by); err != nil {
		t.Fatal(err)
	}
	n = e.Chunks[3].Notes[0]
	if n.Author != "agent" || n.Session != "agent:real" || n.Run != "run:r1" || n.Conversation != "conv-real" || n.Text != op.Note {
		t.Fatalf("a terminal's first note: %+v, want the derived author, not the op's claim", n)
	}

	// no author at all: the op's claim is ignored too, and the note keeps no origin
	e = mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{op}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	n = e.Chunks[3].Notes[0]
	if n.Author != "" || n.Session != "" || n.Conversation != "" || n.Text != op.Note {
		t.Fatalf("an unattributed first note: %+v", n)
	}
}

func TestAddChunkBlankNoteWritesNone(t *testing.T) {
	e := mkEffort()
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "X", Note: "  \n", Session: "agent:t"}}, "", effortNow, NoteAuthor{Who: "you"}); err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks[3].Notes) != 0 {
		t.Fatalf("a blank note was written: %+v", e.Chunks[3].Notes)
	}
	// a note is kept without the whitespace round it, as create's and editNote's are
	e = mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "X", Note: "\n  the passage \n"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if got := e.Chunks[3].Notes; len(got) != 1 || got[0].Text != "the passage" {
		t.Fatalf("notes: %+v, want the passage trimmed", got)
	}
	// the batch's own note is the effort's trail text, never the chunk's first note
	e = mkEffort()
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "X"}}, "from the batch", effortNow); err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks[3].Notes) != 0 {
		t.Fatalf("the batch note became the chunk's: %+v", e.Chunks[3].Notes)
	}
}

func TestAddChunkProposedWithNoteKeepsBothNotes(t *testing.T) {
	e := mkEffort()
	by := NoteAuthor{Who: "agent", Session: "agent:t1", Conversation: "c1"}
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "P", Status: "proposed", Note: "why"}}, "", effortNow, by); err != nil {
		t.Fatal(err)
	}
	var texts []string
	for _, n := range e.Chunks[3].Notes {
		texts = append(texts, n.Text)
	}
	if len(texts) != 2 || texts[0] != "why" || texts[1] != ProposedNote {
		t.Fatalf("notes: %v, want [why proposed]", texts)
	}
}

func TestAdvanceSkipsLater(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{
		{Label: "A", Status: "active"},
		{Label: "L", Status: "pending", Later: true},
		{Label: "B", Status: "pending"},
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Status != "done" || e.Chunks[1].Status != "pending" || e.Chunks[2].Status != "active" {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
	if len(e.Chunks[1].Notes) != 0 {
		t.Fatalf("a later chunk was written to: %+v", e.Chunks[1].Notes)
	}
}

func TestAdvanceSkipsLaterWhenItIsAllThatIsLeft(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{
		{Label: "A", Status: "active"},
		{Label: "L", Status: "blocked", Later: true},
		{Label: "M", Status: "deferred", Later: true},
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Status != "done" || e.Chunks[1].Status != "blocked" || e.Chunks[2].Status != "deferred" {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
	// with no active chunk it still activates nothing but plan work
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[1].Status != "blocked" || e.Chunks[2].Status != "deferred" {
		t.Fatalf("a later chunk was activated: %+v", e.Chunks)
	}
}

func TestAdvanceStillTicksAnActiveLaterChunk(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{
		{Label: "L", Status: "active", Later: true},
		{Label: "B", Status: "pending"},
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance", Note: "done it"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Status != "done" || e.Chunks[1].Status != "active" {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
	if len(e.Events) == 0 || e.Events[0].Kind != "chunk-done" || e.Events[0].Label != "L" {
		t.Fatalf("events: %+v, want chunk-done for L", e.Events)
	}
}

func TestAdvanceTicksThePlanChunkBeforeALaterOne(t *testing.T) {
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{
		{Label: "L", Status: "active", Later: true},
		{Label: "A", Status: "active"},
		{Label: "B", Status: "pending"},
	}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "advance"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Status != "active" || e.Chunks[1].Status != "done" || e.Chunks[2].Status != "active" {
		t.Fatalf("chunks: %+v, want the plan's A ticked and B next, L left alone", e.Chunks)
	}
}

func TestRemoveLastLaterChunk(t *testing.T) {
	// the initiative holds just the saved item: Move to… has to be able to take it out
	e := mkEffort()
	e.Chunks = []waveobj.EffortChunk{{Label: "only", Status: "pending", Later: true}}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "removeChunk", Chunk: "only"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks) != 0 {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
	// the guard still holds for a plan chunk
	e.Chunks = []waveobj.EffortChunk{{Label: "only", Status: "pending"}}
	expectErrCode(t, ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "removeChunk", Chunk: "only"}}, "", effortNow), "EC-LAST-CHUNK")
	// a plan chunk beside a later one is not the last chunk
	e.Chunks = []waveobj.EffortChunk{{Label: "plan", Status: "pending"}, {Label: "later", Status: "pending", Later: true}}
	if err := ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "removeChunk", Chunk: "later"}}, "", effortNow); err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks) != 1 || e.Chunks[0].Label != "plan" {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
}
