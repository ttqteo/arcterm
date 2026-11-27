package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisstate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func cleanupEffort(t *testing.T, oid string) {
	t.Helper()
	t.Cleanup(func() {
		if err := effortstore.Delete(context.Background(), oid); err != nil {
			t.Errorf("cleanup effort: %v", err)
		}
	})
}

func TestEffortCreateAndMutateRoundTrip(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	rtn, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{
		Title: "Scenario gate clearance", Ticket: "SIEM-1662",
		Chunks: []wshrpc.CommandEffortChunkSeed{{Label: "Phase 1"}, {Label: "Phase 2", Owner: "soc"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, rtn.EffortOID)

	got, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: rtn.EffortOID,
		Ops: []wshrpc.EffortOp{
			{Op: "setChunkStatus", Chunk: "Phase 1", Status: "done"},
			{Op: "addChunk", Label: "Phase 3"},
			{Op: "advance"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Effort.Chunks[0].Status != "done" || got.Effort.Chunks[1].Status != "active" || len(got.Effort.Chunks) != 3 {
		t.Fatalf("mutate result: %+v", got.Effort.Chunks)
	}
}

// an idea saved from a passage in Chat starts with that passage as your note, holding the agent it came from; one
// created with no note keeps the "effort created" trail note
func TestEffortCreateWithANoteWritesItAsTheFirstNote(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	for name, tc := range map[string]struct {
		note, session string
		want          waveobj.EffortNote
	}{
		"with a note":  {note: "  From agent \"loom\"\n\n> retry the push  ", session: "agent:t1", want: waveobj.EffortNote{Text: "From agent \"loom\"\n\n> retry the push", Author: "you", Session: "agent:t1"}},
		"with no note": {want: waveobj.EffortNote{Text: "effort created"}},
		"a blank note": {note: " \n ", session: "agent:t1", want: waveobj.EffortNote{Text: "effort created"}},
	} {
		rtn, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "Retry the push", Note: tc.note, NoteSession: tc.session})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		cleanupEffort(t, rtn.EffortOID)
		e, err := effortstore.Get(ctx, rtn.EffortOID)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(e.Notes) != 1 {
			t.Fatalf("%s: notes = %+v, want one", name, e.Notes)
		}
		got := e.Notes[0]
		got.Ts = 0
		if got != tc.want {
			t.Errorf("%s: first note = %+v, want %+v", name, got, tc.want)
		}
	}
}

// agentBlock makes a block in a tab of its own, the terminal an agent runs `wsh effort` from, and returns the block's
// oref and its tab's id.
func agentBlock(t *testing.T) (blockORef, tabID string) {
	t.Helper()
	ctx := context.Background()
	tabID, blockID := uuid.NewString(), uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockID, ParentORef: "tab:" + tabID}); err != nil {
		t.Fatal(err)
	}
	return "block:" + blockID, tabID
}

// createWithSeeds runs `effort create` for two seeded chunks and returns the stored effort.
func createWithSeeds(t *testing.T, proposed bool, sourceBlock string) *waveobj.Effort {
	t.Helper()
	ctx := context.Background()
	rtn, err := (&WshServer{}).EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{
		Title:       "Standing bugs " + uuid.NewString()[:8],
		Chunks:      []wshrpc.CommandEffortChunkSeed{{Label: "flaky scenario step"}, {Label: "stale doc line"}},
		Proposed:    proposed,
		SourceBlock: sourceBlock,
	})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, rtn.EffortOID)
	e, err := effortstore.Get(ctx, rtn.EffortOID)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks) != 2 {
		t.Fatalf("chunks: %+v", e.Chunks)
	}
	return e
}

// `wsh effort create --proposed` from an agent's terminal seeds proposals, each with the "proposed" note that keeps
// the proposer's session, as `chunk add --proposed` writes it.
func TestEffortCreateProposedSeedsProposalsWithTheSessionNote(t *testing.T) {
	block, tabID := agentBlock(t)
	e := createWithSeeds(t, true, block)
	for _, c := range e.Chunks {
		if c.Status != "proposed" {
			t.Errorf("chunk %q is %q, want proposed", c.Label, c.Status)
		}
		var proposed []waveobj.EffortNote
		for _, n := range c.Notes {
			if n.Text == jarvis.ProposedNote {
				proposed = append(proposed, n)
			}
		}
		if len(proposed) != 1 {
			t.Fatalf("chunk %q has %d proposed notes: %+v", c.Label, len(proposed), c.Notes)
		}
		if n := proposed[0]; n.Session != "agent:"+tabID || n.Author != "agent" || n.Run != "" || n.Ts == 0 {
			t.Errorf("chunk %q note: %+v, want agent session agent:%s and no run", c.Label, n, tabID)
		}
		if jarvis.ProposalRun(c) != "" {
			t.Errorf("chunk %q names run %q though its tab belongs to none", c.Label, jarvis.ProposalRun(c))
		}
	}
	// proposals stay out of the initiative's Total until accepted
	if got := jarvisstate.EffortSummaryOf(e); got.Total != 0 {
		t.Errorf("total %d, want 0 until the proposals are accepted", got.Total)
	}
}

// a run's lead creating an initiative names its run on every seeded proposal: that is what makes them To review's
func TestEffortCreateProposedNamesTheRunOfTheTab(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "effort-create-proposed", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	block, tabID := agentBlock(t)
	run := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Phases[0].WorkerOrefs = []string{"tab:" + tabID}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	e := createWithSeeds(t, true, block)
	for _, c := range e.Chunks {
		if got := jarvis.ProposalRun(c); got != "run:"+run.ID {
			t.Errorf("chunk %q proposal names run %q, want run:%s", c.Label, got, run.ID)
		}
	}
}

// without --proposed the seeded chunks are plain pending work with no "proposed" note, whoever runs the command
func TestEffortCreateWithoutProposedKeepsTheChunksPending(t *testing.T) {
	block, _ := agentBlock(t)
	for name, src := range map[string]string{"from an agent's terminal": block, "with no terminal": ""} {
		e := createWithSeeds(t, false, src)
		for _, c := range e.Chunks {
			if c.Status != "pending" {
				t.Errorf("%s: chunk %q is %q, want pending", name, c.Label, c.Status)
			}
			for _, n := range c.Notes {
				if n.Text == jarvis.ProposedNote {
					t.Errorf("%s: chunk %q has a proposed note: %+v", name, c.Label, n)
				}
			}
		}
	}
}

// with no terminal there is no session to keep: the chunks are still proposed, with no note, as `chunk add --proposed`
// from the cockpit is
func TestEffortCreateProposedWithNoTerminalWritesNoNote(t *testing.T) {
	e := createWithSeeds(t, true, "")
	for _, c := range e.Chunks {
		if c.Status != "proposed" || len(c.Notes) != 0 {
			t.Errorf("chunk %q: status %q, notes %+v; want proposed with none", c.Label, c.Status, c.Notes)
		}
	}
}

func TestEffortCreateValidation(t *testing.T) {
	ws := &WshServer{}
	_, err := ws.EffortCreateCommand(context.Background(), wshrpc.CommandEffortCreateData{
		Title:  "",
		Chunks: []wshrpc.CommandEffortChunkSeed{{Label: "x"}},
	})
	if err == nil || !strings.Contains(err.Error(), "EC-INVALID-TITLE") {
		t.Fatalf("want EC-INVALID-TITLE, got %v", err)
	}
	_, err = ws.EffortCreateCommand(context.Background(), wshrpc.CommandEffortCreateData{
		Title:  "dup",
		Chunks: []wshrpc.CommandEffortChunkSeed{{Label: "a"}, {Label: "a"}},
	})
	if err == nil || !strings.Contains(err.Error(), "EC-DUPLICATE-LABEL") {
		t.Fatalf("want EC-DUPLICATE-LABEL, got %v", err)
	}
}

func TestEffortMutateAtomicBatchRejected(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	rtn, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "atomic"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, rtn.EffortOID)
	_, err = ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: rtn.EffortOID,
		Ops: []wshrpc.EffortOp{
			{Op: "rename", Title: "should-not-stick"},
			{Op: "setChunkStatus", Chunk: "nope", Status: "done"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "EC-UNKNOWN-CHUNK") {
		t.Fatalf("want EC-UNKNOWN-CHUNK, got %v", err)
	}
	got, gerr := effortstore.Get(ctx, rtn.EffortOID)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if got.Title != "atomic" {
		t.Fatalf("batch not atomic: %+v", got)
	}
}

func TestEffortMutateUnknownEffort(t *testing.T) {
	ws := &WshServer{}
	_, err := ws.EffortMutateCommand(context.Background(), wshrpc.CommandEffortMutateData{
		EffortOID: "00000000-0000-0000-0000-000000000000",
		Ops:       []wshrpc.EffortOp{{Op: "rename", Title: "x"}},
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("want not-found error, got %v", err)
	}
}

func TestEffortLinkParentValidation(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	parent, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "parent"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, parent.EffortOID)
	child, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "child"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, child.EffortOID)
	// self-link rejected
	_, err = ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: parent.EffortOID,
		Ops:       []wshrpc.EffortOp{{Op: "link", ParentOID: parent.EffortOID}},
	})
	if err == nil || !strings.Contains(err.Error(), "EC-BAD-PARENT") {
		t.Fatalf("want EC-BAD-PARENT, got %v", err)
	}
	// unknown parent rejected
	_, err = ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: child.EffortOID,
		Ops:       []wshrpc.EffortOp{{Op: "link", ParentOID: "00000000-0000-0000-0000-000000000000"}},
	})
	if err == nil || !strings.Contains(err.Error(), "EC-BAD-PARENT") {
		t.Fatalf("want EC-BAD-PARENT, got %v", err)
	}
	// valid link
	_, err = ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: child.EffortOID,
		Ops:       []wshrpc.EffortOp{{Op: "link", ParentOID: parent.EffortOID}},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestEffortListAndGet(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	rtn, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "listed", Project: "proj-a"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, rtn.EffortOID)
	archived, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "archived"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, archived.EffortOID)
	if _, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: archived.EffortOID,
		Ops:       []wshrpc.EffortOp{{Op: "setStatus", Status: "archived"}},
	}); err != nil {
		t.Fatal(err)
	}
	list, err := ws.EffortListCommand(ctx, wshrpc.CommandEffortListData{})
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range list.Efforts {
		if s.ORef == "effort:"+archived.EffortOID {
			t.Fatalf("archived effort leaked into list: %+v", list.Efforts)
		}
	}
	// get works for archived
	got, err := ws.EffortGetCommand(ctx, wshrpc.CommandEffortGetData{EffortOID: archived.EffortOID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Effort.Status != "archived" {
		t.Fatalf("get: %+v", got.Effort)
	}
}

func TestEffortListIncludeArchived(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	active, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "still going"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, active.EffortOID)
	archived, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "put away"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, archived.EffortOID)
	if _, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: archived.EffortOID,
		Ops:       []wshrpc.EffortOp{{Op: "setStatus", Status: "archived"}},
	}); err != nil {
		t.Fatal(err)
	}
	list, err := ws.EffortListCommand(ctx, wshrpc.CommandEffortListData{IncludeArchived: true})
	if err != nil {
		t.Fatal(err)
	}
	var sawActive, sawArchived bool
	for _, s := range list.Efforts {
		switch s.ORef {
		case "effort:" + active.EffortOID:
			sawActive = true
		case "effort:" + archived.EffortOID:
			sawArchived = true
		}
	}
	if !sawArchived {
		t.Fatalf("includearchived did not return the archived effort: %+v", list.Efforts)
	}
	if !sawActive {
		t.Fatalf("includearchived dropped the active effort: %+v", list.Efforts)
	}
}

// `wsh effort list` prints ids as effort:<oid>, so that form arrives wherever an id does; it must be
// stored bare, since every reader rebuilds the oref by prefixing
func TestEffortParentInORefFormIsStoredBare(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	parent, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "parent"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, parent.EffortOID)
	prefixed := "effort:" + parent.EffortOID

	created, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "created child", ParentOID: prefixed})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, created.EffortOID)
	got, err := effortstore.Get(ctx, created.EffortOID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ParentOID != parent.EffortOID {
		t.Fatalf("create: ParentOID = %q, want %q", got.ParentOID, parent.EffortOID)
	}

	linked, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "linked child"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, linked.EffortOID)
	rtn, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: linked.EffortOID,
		Ops:       []wshrpc.EffortOp{{Op: "link", ParentOID: prefixed}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Effort.ParentOID != parent.EffortOID {
		t.Fatalf("link: ParentOID = %q, want %q", rtn.Effort.ParentOID, parent.EffortOID)
	}
}

func TestEffortSelfLinkRejectedAcrossIDForms(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	e, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{Title: "self"})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.EffortOID)
	prefixed := "effort:" + e.EffortOID
	for _, c := range [][2]string{{prefixed, e.EffortOID}, {e.EffortOID, prefixed}} {
		_, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
			EffortOID: c[0],
			Ops:       []wshrpc.EffortOp{{Op: "link", ParentOID: c[1]}},
		})
		if err == nil || !strings.Contains(err.Error(), "EC-BAD-PARENT") {
			t.Fatalf("link %s --parent %s: want EC-BAD-PARENT, got %v", c[0], c[1], err)
		}
	}
}
