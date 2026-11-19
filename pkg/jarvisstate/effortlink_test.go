package jarvisstate

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func cleanupEffort(t *testing.T, oid string) {
	t.Helper()
	t.Cleanup(func() {
		if err := effortstore.Delete(context.Background(), oid); err != nil {
			t.Errorf("cleanup effort: %v", err)
		}
	})
}

func TestAttachRunToChunk(t *testing.T) {
	ctx := context.Background()
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{{Label: "Phase 1", Status: "active"}}}
	if err := effortstore.Create(ctx, e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)

	if err := AttachRunToChunk(ctx, e.OID, "Phase 1", "run:r1"); err != nil {
		t.Fatal(err)
	}
	got, err := effortstore.Get(ctx, e.OID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Chunks[0].WorkRefs) != 1 || got.Chunks[0].WorkRefs[0].ORef != "run:r1" {
		t.Fatalf("workref: %+v", got.Chunks[0].WorkRefs)
	}
}

func TestAttachRunToChunkIdempotent(t *testing.T) {
	ctx := context.Background()
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{{Label: "Phase 1", Status: "active"}}}
	if err := effortstore.Create(ctx, e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)
	for i := 0; i < 2; i++ {
		if err := AttachRunToChunk(ctx, e.OID, "Phase 1", "run:r1"); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := effortstore.Get(ctx, e.OID)
	if len(got.Chunks[0].WorkRefs) != 1 {
		t.Fatalf("not idempotent: %+v", got.Chunks[0].WorkRefs)
	}
}

func TestAttachRunToChunkUnknownEffort(t *testing.T) {
	err := AttachRunToChunk(context.Background(), "00000000-0000-0000-0000-000000000000", "Phase 1", "run:r1")
	if err == nil {
		t.Fatal("want error")
	}
}

func TestAttachRunToChunkUnknownChunk(t *testing.T) {
	ctx := context.Background()
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{{Label: "Phase 1", Status: "active"}}}
	if err := effortstore.Create(ctx, e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)
	err := AttachRunToChunk(ctx, e.OID, "nope", "run:r1")
	if err == nil || !strings.Contains(err.Error(), "EC-UNKNOWN-CHUNK") {
		t.Fatalf("want EC-UNKNOWN-CHUNK, got %v", err)
	}
}

func TestDetachRunFromChunk(t *testing.T) {
	ctx := context.Background()
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{{Label: "Phase 1", Status: "active"}}}
	if err := effortstore.Create(ctx, e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)
	if err := AttachRunToChunk(ctx, e.OID, "Phase 1", "run:r1"); err != nil {
		t.Fatal(err)
	}
	if err := DetachRunFromChunk(ctx, e.OID, "run:r1"); err != nil {
		t.Fatal(err)
	}
	got, err := effortstore.Get(ctx, e.OID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Chunks[0].WorkRefs) != 0 {
		t.Fatalf("workref remains: %+v", got.Chunks[0].WorkRefs)
	}
}

func TestDetachRunFromChunkIdempotent(t *testing.T) {
	ctx := context.Background()
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{{Label: "Phase 1", Status: "active"}}}
	if err := effortstore.Create(ctx, e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)
	if err := DetachRunFromChunk(ctx, e.OID, "run:never-was"); err != nil {
		t.Fatal(err)
	}
}

func TestDetachRunFromChunkUnknownEffort(t *testing.T) {
	err := DetachRunFromChunk(context.Background(), "00000000-0000-0000-0000-000000000000", "run:r1")
	if err == nil {
		t.Fatal("want error")
	}
}

func TestRunFinishedTextPrefersTheReportTitle(t *testing.T) {
	r := &waveobj.Run{Goal: "Retire the recall arm", Report: "# Retire the recall arm — run report\n\nDAG x: 6/6 tasks done."}
	if got := RunFinishedText(r); got != "Run finished: Retire the recall arm — run report" {
		t.Fatalf("got %q", got)
	}
	r = &waveobj.Run{Goal: "Rule diff vs prod", Evidence: &waveobj.RunEvidence{Summary: "Found 4 drifts.\nTwo expected."}}
	if got := RunFinishedText(r); got != "Run finished: Found 4 drifts." {
		t.Fatalf("got %q", got)
	}
	r = &waveobj.Run{Goal: "Only a goal"}
	if got := RunFinishedText(r); got != "Run finished: Only a goal" {
		t.Fatalf("got %q", got)
	}
}

func TestNoteRunFinishedStampsTheRunOnceAsAgent(t *testing.T) {
	ctx := context.Background()
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{{Label: "Phase 1", Status: "active"}}}
	if err := effortstore.Create(ctx, e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)
	ref := waveobj.RunEffortRef{EffortOID: e.OID, ChunkLabel: "Phase 1"}
	for i := 0; i < 2; i++ {
		if err := NoteRunFinished(ctx, ref, "run:r1", "Run finished: x"); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := effortstore.Get(ctx, e.OID)
	notes := got.Chunks[0].Notes
	if len(notes) != 1 {
		t.Fatalf("want one note, got %+v", notes)
	}
	if n := notes[0]; n.Author != "agent" || n.Run != "run:r1" || n.Text != "Run finished: x" {
		t.Fatalf("note: %+v", n)
	}
}

func newTestEffort(t *testing.T, chunks ...waveobj.EffortChunk) *waveobj.Effort {
	t.Helper()
	e := &waveobj.Effort{Title: "t", Status: "active", Chunks: chunks}
	if err := effortstore.Create(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)
	return e
}

func chunkOf(t *testing.T, oid, label string) waveobj.EffortChunk {
	t.Helper()
	e, err := effortstore.Get(context.Background(), oid)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range e.Chunks {
		if c.Label == label {
			return c
		}
	}
	t.Fatalf("effort %s has no chunk %q", oid, label)
	return waveobj.EffortChunk{}
}

func holdsRun(c waveobj.EffortChunk, runORef string) bool {
	for _, w := range c.WorkRefs {
		if w.ORef == runORef {
			return true
		}
	}
	return false
}

// a run started from To review holds every ticked chunk: proposed ones turn pending, two of one initiative go in
// one batch, and a chunk that is already pending only gains the run
func TestAttachRunToChunksFlipsProposedAndAttaches(t *testing.T) {
	ctx := context.Background()
	a := newTestEffort(t,
		waveobj.EffortChunk{Label: "a1", Status: "proposed"},
		waveobj.EffortChunk{Label: "a2", Status: "proposed"},
		waveobj.EffortChunk{Label: "a3", Status: "proposed"},
		waveobj.EffortChunk{Label: "a-pending", Status: "pending"})
	b := newTestEffort(t, waveobj.EffortChunk{Label: "b1", Status: "proposed"})
	const run = "run:attach-many"

	err := AttachRunToChunks(ctx, []waveobj.RunEffortRef{
		{EffortOID: a.OID, ChunkLabel: "a1"},
		{EffortOID: b.OID, ChunkLabel: "b1"},
		{EffortOID: a.OID, ChunkLabel: "a2"},
		{EffortOID: a.OID, ChunkLabel: "a-pending"},
	}, run)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		oid, label, status string
		held               bool
	}{
		{a.OID, "a1", "pending", true},
		{a.OID, "a2", "pending", true},
		{a.OID, "a-pending", "pending", true},
		{a.OID, "a3", "proposed", false},
		{b.OID, "b1", "pending", true},
	} {
		c := chunkOf(t, tc.oid, tc.label)
		if c.Status != tc.status || holdsRun(c, run) != tc.held {
			t.Fatalf("chunk %s: status %q held %v, want %q held %v", tc.label, c.Status, holdsRun(c, run), tc.status, tc.held)
		}
	}

	// the run now holds two live chunks of a: a later lone attach to a third is still refused, as before
	err = AttachRunToChunk(ctx, a.OID, "a3", run)
	if err == nil || !strings.Contains(err.Error(), "EC-REF-ALREADY-ATTACHED") {
		t.Fatalf("want EC-REF-ALREADY-ATTACHED, got %v", err)
	}
}

// the same call twice changes nothing a second time: the attach is idempotent and a pending chunk stays pending
func TestAttachRunToChunksIsIdempotent(t *testing.T) {
	ctx := context.Background()
	a := newTestEffort(t, waveobj.EffortChunk{Label: "a1", Status: "proposed"}, waveobj.EffortChunk{Label: "a2", Status: "proposed"})
	refs := []waveobj.RunEffortRef{{EffortOID: a.OID, ChunkLabel: "a1"}, {EffortOID: a.OID, ChunkLabel: "a2"}}
	for i := 0; i < 2; i++ {
		if err := AttachRunToChunks(ctx, refs, "run:attach-twice"); err != nil {
			t.Fatal(err)
		}
	}
	for _, label := range []string{"a1", "a2"} {
		c := chunkOf(t, a.OID, label)
		if c.Status != "pending" || len(c.WorkRefs) != 1 {
			t.Fatalf("chunk %s: status %q workrefs %+v", label, c.Status, c.WorkRefs)
		}
	}
}

// one initiative that cannot take the run does not keep the others from it, and the error comes back
func TestAttachRunToChunksKeepsGoingPastABadEffort(t *testing.T) {
	ctx := context.Background()
	good := newTestEffort(t, waveobj.EffortChunk{Label: "g1", Status: "proposed"})
	err := AttachRunToChunks(ctx, []waveobj.RunEffortRef{
		{EffortOID: "00000000-0000-0000-0000-000000000000", ChunkLabel: "x"},
		{EffortOID: good.OID, ChunkLabel: "g1"},
	}, "run:attach-bad")
	if err == nil {
		t.Fatal("want the unknown effort reported")
	}
	if c := chunkOf(t, good.OID, "g1"); c.Status != "pending" || !holdsRun(c, "run:attach-bad") {
		t.Fatalf("the good effort was skipped: %+v", c)
	}
}

func TestAttachRunToChunksNothingToDo(t *testing.T) {
	if err := AttachRunToChunks(context.Background(), nil, "run:none"); err != nil {
		t.Fatal(err)
	}
}

// a release clears the run from every chunk of every initiative that holds it, and says which chunks those were;
// another run's hold is left alone
func TestDetachRunEverywhere(t *testing.T) {
	ctx := context.Background()
	a := newTestEffort(t,
		waveobj.EffortChunk{Label: "a1", Status: "proposed"},
		waveobj.EffortChunk{Label: "a2", Status: "proposed"})
	b := newTestEffort(t, waveobj.EffortChunk{Label: "b1", Status: "proposed"})
	c := newTestEffort(t, waveobj.EffortChunk{Label: "c1", Status: "pending"})
	const run, other = "run:detach-many", "run:detach-other"
	if err := AttachRunToChunks(ctx, []waveobj.RunEffortRef{
		{EffortOID: a.OID, ChunkLabel: "a1"}, {EffortOID: a.OID, ChunkLabel: "a2"}, {EffortOID: b.OID, ChunkLabel: "b1"},
	}, run); err != nil {
		t.Fatal(err)
	}
	if err := AttachRunToChunk(ctx, c.OID, "c1", other); err != nil {
		t.Fatal(err)
	}

	got, err := DetachRunEverywhere(ctx, run)
	if err != nil {
		t.Fatal(err)
	}
	want := map[waveobj.RunEffortRef]bool{
		{EffortOID: a.OID, ChunkLabel: "a1"}: true, {EffortOID: a.OID, ChunkLabel: "a2"}: true, {EffortOID: b.OID, ChunkLabel: "b1"}: true,
	}
	if len(got) != len(want) {
		t.Fatalf("detached %+v, want the three chunks the run held", got)
	}
	for _, ref := range got {
		if !want[ref] {
			t.Fatalf("detached %+v, which the run did not hold", ref)
		}
	}
	for _, tc := range []struct{ oid, label string }{{a.OID, "a1"}, {a.OID, "a2"}, {b.OID, "b1"}} {
		if holdsRun(chunkOf(t, tc.oid, tc.label), run) {
			t.Fatalf("chunk %s still holds the run", tc.label)
		}
	}
	if !holdsRun(chunkOf(t, c.OID, "c1"), other) {
		t.Fatal("another run's hold was removed")
	}
	// the chunks stay pending: a release frees the run's hold, it does not decide the chunk's status
	if st := chunkOf(t, a.OID, "a1").Status; st != "pending" {
		t.Fatalf("a1 status = %q, want pending", st)
	}

	again, err := DetachRunEverywhere(ctx, run)
	if err != nil || len(again) != 0 {
		t.Fatalf("a second release finds %+v, %v; want nothing", again, err)
	}
}
