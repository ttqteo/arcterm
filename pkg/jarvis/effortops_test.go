package jarvis

import (
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
