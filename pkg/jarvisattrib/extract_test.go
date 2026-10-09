// pkg/jarvisattrib/extract_test.go
package jarvisattrib

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestLayer2MatchesTicket(t *testing.T) {
	d := &jarvisdossier.Dossier{ID: "task-1", Ticket: "PROJ-142"}

	// hit via Run.Goal
	e, ok := extractLayer2(d, &waveobj.Run{OID: "r1", Goal: "implement PROJ-142 pkce"}, "", nil)
	if !ok || e.RunORef != "run:r1" || e.Confidence != weightLayer2 || !containsLayer(e.Layers, 2) {
		t.Fatalf("goal match: %+v ok=%v", e, ok)
	}
	if e.Provenance != provTicket || e.State != StateInforming {
		t.Fatalf("goal match provenance/state: %+v", e)
	}

	// hit via commit subject
	if _, ok := extractLayer2(d, &waveobj.Run{OID: "r2"}, "", []string{"fix proj-142 rotation"}); !ok {
		t.Fatal("commit-subject match (case-insensitive) should hit")
	}
	// hit via channel name
	if _, ok := extractLayer2(d, &waveobj.Run{OID: "r3"}, "PROJ-142 oauth work", nil); !ok {
		t.Fatal("channel-name match should hit")
	}
	// no ticket on dossier → never hits
	if _, ok := extractLayer2(&jarvisdossier.Dossier{ID: "t"}, &waveobj.Run{OID: "r4", Goal: "PROJ-142"}, "", nil); ok {
		t.Fatal("ticketless dossier must not match")
	}
	// no match
	if _, ok := extractLayer2(d, &waveobj.Run{OID: "r5", Goal: "unrelated"}, "misc", []string{"chore"}); ok {
		t.Fatal("should not match unrelated run")
	}
}

func TestLayer3AnchoredCorrelation(t *testing.T) {
	const now = int64(1_000_000_000_000)
	d := &jarvisdossier.Dossier{ID: "task-1", Ticket: "PROJ-142", Status: "active", Created: now - 5000}
	anchor := map[string]bool{"/repo/app": true}

	run := &waveobj.Run{OID: "r1", ProjectPath: "/repo/app", CreatedTs: now - 3000, CompletedTs: now - 1000}

	// in anchor repo + overlapping window + no contradicting ticket → weak edge
	e, ok := extractLayer3(d, run, anchor, now, nil, now)
	if !ok || e.Confidence != weightLayer3 || e.Provenance != provStructural || !containsLayer(e.Layers, 3) {
		t.Fatalf("expected weak structural edge, got %+v ok=%v", e, ok)
	}

	// wrong repo → no edge
	if _, ok := extractLayer3(d, &waveobj.Run{OID: "r2", ProjectPath: "/other", CreatedTs: now - 3000}, anchor, now, nil, now); ok {
		t.Fatal("run outside anchor repo must not correlate")
	}
	// no anchors at all → no edge
	if _, ok := extractLayer3(d, run, map[string]bool{}, now, nil, now); ok {
		t.Fatal("no anchor => layer 3 cannot fire")
	}
	// self-correction: commit carries a DIFFERENT ticket → contradicted, no edge
	if _, ok := extractLayer3(d, run, anchor, now, []string{"OTHER-9 unrelated"}, now); ok {
		t.Fatal("a different concrete ticket must retract the weak edge")
	}
	// time-boxed: run finished long ago, never reinforced → decays
	old := &waveobj.Run{OID: "r3", ProjectPath: "/repo/app", CreatedTs: now - timeBoxMs - 5000, CompletedTs: now - timeBoxMs - 1000}
	if _, ok := extractLayer3(d, old, anchor, now, nil, now); ok {
		t.Fatal("a run completed beyond the time-box must decay")
	}
}

// An active dossier reaches a new run only while its own work goes on. Nothing closes a dossier when its runs
// finish, so by status alone every old plan in a repo reached every new run there (a fresh run read
// "+14 more").
func TestAssembleBoundsAnActiveDossierByItsOwnRuns(t *testing.T) {
	const now = int64(1_000_000_000_000)
	const hour = int64(3_600_000)
	lk := edgeLookups{channelName: func(string) string { return "" }, commits: func(*waveobj.Run) []string { return nil }}
	fresh := &waveobj.Run{OID: "fresh", ProjectPath: "/repo/app", Status: "executing", CreatedTs: now - hour}
	dossier := func(own *waveobj.Run) []AttributedEdge {
		d := &jarvisdossier.Dossier{ID: "task-old", Status: "active", Created: own.CreatedTs, Updated: own.CreatedTs, Refs: []string{"run-" + own.OID}}
		return assembleEdges(d, []*waveobj.Run{own, fresh}, lk, now)
	}
	reaches := func(edges []AttributedEdge) bool {
		for _, e := range edges {
			if e.RunORef == "run:fresh" {
				return true
			}
		}
		return false
	}

	finished := &waveobj.Run{OID: "own", ProjectPath: "/repo/app", Status: "done", CreatedTs: now - 50*hour, CompletedTs: now - 48*hour}
	if reaches(dossier(finished)) {
		t.Fatal("a dossier whose own run finished two days ago reached a run started an hour ago")
	}
	running := &waveobj.Run{OID: "own", ProjectPath: "/repo/app", Status: "executing", CreatedTs: now - 50*hour}
	if !reaches(dossier(running)) {
		t.Fatal("a dossier whose own run is still going must reach a run beside it in the same repo")
	}
	// a blocked run is not going: a lead the app restart stopped holds no dossier open
	blocked := &waveobj.Run{OID: "own", ProjectPath: "/repo/app", Status: "blocked", CreatedTs: now - 50*hour}
	if reaches(dossier(blocked)) {
		t.Fatal("a dossier whose own run is blocked reached a new run")
	}
}

func TestPastProbation(t *testing.T) {
	const now = int64(2_000_000_000_000)
	if pastProbation(&waveobj.Run{CreatedTs: now - 1000}, now) {
		t.Fatal("a fresh run is within probation")
	}
	if !pastProbation(&waveobj.Run{CreatedTs: now - probationMs - 1}, now) {
		t.Fatal("a run older than the probation window is past probation")
	}
}

// The backfill importer (pkg/jarvisbackfill) writes a deliberate corpus shape: a dossier grouping
// several runs, but a canonical ref for only the *owner*. This asserts that shape yields a mixed
// confirmed/informing edge set rather than a single-valued one — the entire reason the importer does
// not ref every run. It also pins the two ways that shape can silently degenerate: a dossier stamped
// at import time instead of its run window attracts no layer-3 edges at all, and a corpus with a ref
// per run reports everything at 1.0.
func TestAssembleBackfillShapeYieldsMixedEdges(t *testing.T) {
	const now = int64(1_000_000_000_000)
	const hour = int64(3_600_000)
	// window as the importer writes it: created = earliest run, updated = latest run end, completed.
	d := &jarvisdossier.Dossier{
		ID: "task-briefs", Status: "completed",
		Created: now - 10*hour, Updated: now - 4*hour,
		Refs: []string{"run-owner"},
	}
	runs := []*waveobj.Run{
		{OID: "owner", ProjectPath: "/repo/wave", CreatedTs: now - 10*hour, CompletedTs: now - 9*hour},
		{OID: "sib1", ProjectPath: "/repo/wave", CreatedTs: now - 8*hour, CompletedTs: now - 7*hour},
		{OID: "sib2", ProjectPath: "/repo/wave", CreatedTs: now - 6*hour, CompletedTs: now - 4*hour},
	}
	lk := edgeLookups{
		channelName: func(string) string { return "" },
		commits:     func(*waveobj.Run) []string { return nil },
	}

	byORef := map[string]AttributedEdge{}
	for _, e := range assembleEdges(d, runs, lk, now) {
		byORef[e.RunORef] = e
	}

	owner := byORef["run:owner"]
	if owner.State != StateConfirmed || owner.Confidence != weightLayer1 {
		t.Fatalf("owner must be the canonical confirmed edge, got %+v", owner)
	}
	for _, oid := range []string{"run:sib1", "run:sib2"} {
		e, ok := byORef[oid]
		if !ok {
			t.Fatalf("%s produced no edge — the dossier window does not reach its runs, so layer 3 never fires", oid)
		}
		if e.State != StateInforming || e.Confidence != weightLayer3 || e.Provenance != provStructural {
			t.Fatalf("%s should be a weak structural edge, got %+v", oid, e)
		}
	}
	if len(byORef) != 3 {
		t.Fatalf("want 3 edges, got %d", len(byORef))
	}
}

// A dossier stamped "now" instead of backdated to its runs is the silent-failure mode: the importer
// looks like it worked, but D attributes nothing structurally.
func TestAssembleRejectsImportTimeStampedDossier(t *testing.T) {
	const now = int64(1_000_000_000_000)
	const hour = int64(3_600_000)
	d := &jarvisdossier.Dossier{
		ID: "task-x", Status: "completed",
		Created: now, Updated: now, // the bug: import time, not the run window
		Refs: []string{"run-owner"},
	}
	runs := []*waveobj.Run{
		{OID: "owner", ProjectPath: "/repo/wave", CreatedTs: now - 10*hour, CompletedTs: now - 9*hour},
		{OID: "sib1", ProjectPath: "/repo/wave", CreatedTs: now - 8*hour, CompletedTs: now - 7*hour},
	}
	lk := edgeLookups{channelName: func(string) string { return "" }, commits: func(*waveobj.Run) []string { return nil }}
	for _, e := range assembleEdges(d, runs, lk, now) {
		if e.RunORef == "run:sib1" {
			t.Fatal("sibling attracted an edge despite the dossier post-dating every run; the backdating guard is not doing anything")
		}
	}
}

func TestAssembleMergesAndOrders(t *testing.T) {
	const now = int64(1_000_000_000_000)
	// dossier already has a canonical layer-1 ref to run r0, ticket matches r1, r2 is a weak same-repo prior.
	d := &jarvisdossier.Dossier{
		ID: "task-1", Ticket: "PROJ-142", Status: "active", Created: now - 10000, Updated: now - 1000,
		Refs: []string{"run-r0", "dec-abc"}, // dec- is a decision ref, ignored by run attribution
	}
	runs := []*waveobj.Run{
		{OID: "r0", ProjectPath: "/repo/app", CreatedTs: now - 9000, CompletedTs: now - 8000},
		{OID: "r1", ProjectPath: "/repo/app", Goal: "PROJ-142 flow", CreatedTs: now - 5000, CompletedTs: now - 4000},
		{OID: "r2", ProjectPath: "/repo/app", CreatedTs: now - 3000, CompletedTs: now - 2000},
	}
	lk := edgeLookups{
		channelName: func(string) string { return "" },
		commits:     func(*waveobj.Run) []string { return nil },
	}

	edges := assembleEdges(d, runs, lk, now)

	byORef := map[string]AttributedEdge{}
	for _, e := range edges {
		byORef[e.RunORef] = e
	}
	// r0: canonical (layer 1), confirmed, confidence 1.0
	if e := byORef["run:r0"]; e.State != StateConfirmed || e.Confidence != 1.0 || !containsLayer(e.Layers, 1) {
		t.Fatalf("r0 layer-1 edge wrong: %+v", e)
	}
	// r1: ticket match AND same-repo/window prior → layers {2,3}, confidence max = 0.8, provenance ticket
	if e := byORef["run:r1"]; !containsLayer(e.Layers, 2) || !containsLayer(e.Layers, 3) || e.Confidence != 0.8 || e.Provenance != provTicket {
		t.Fatalf("r1 merged edge wrong: %+v", e)
	}
	// r2: weak structural only
	if e := byORef["run:r2"]; e.Confidence != weightLayer3 || e.State != StateInforming {
		t.Fatalf("r2 weak edge wrong: %+v", e)
	}
	// ordering: confidence descending
	for i := 1; i < len(edges); i++ {
		if edges[i-1].Confidence < edges[i].Confidence {
			t.Fatalf("edges not confidence-descending: %+v", edges)
		}
	}
}
