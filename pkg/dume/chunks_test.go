package dume

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func chunk(label, status, owner string, notes ...string) waveobj.EffortChunk {
	c := waveobj.EffortChunk{Label: label, Status: status, Owner: owner}
	for _, n := range notes {
		c.Notes = append(c.Notes, waveobj.EffortNote{Text: n})
	}
	return c
}

func TestClassifyChunk(t *testing.T) {
	live := func(id string) bool { return id == "run-live" } // runLive
	started := StartedNote("run-1", "wave/dume-a")
	cases := map[string]struct {
		c    waveobj.EffortChunk
		want State
	}{
		"not dum-e's":             {chunk("x", "pending", "me"), StateNone},
		"waiting":                 {chunk("x", "pending", Owner), StateWaiting},
		"running":                 {chunk("x", "active", Owner, StartedNote("run-live", "wave/dume-a")), StateRunning},
		"run ended":               {chunk("x", "active", Owner, started), StateFinished},
		"to land":                 {chunk("x", "active", Owner, started, ToLandNote("wave/dume-a", 2)), StateToLand},
		"active by hand":          {chunk("x", "active", Owner), StateNone},
		"blocked":                 {chunk("x", "blocked", Owner, started, NothingNote("wave/dume-a")), StateBlocked},
		"done":                    {chunk("x", "done", Owner), StateDone},
		"restarted after to-land": {chunk("x", "active", Owner, started, ToLandNote("wave/dume-a", 1), StartedNote("run-live", "wave/dume-b")), StateRunning},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if got := ClassifyChunk(c.c, live); got != c.want {
				t.Fatalf("ClassifyChunk = %v, want %v", got, c.want)
			}
		})
	}
}

// a later chunk is a kept item, never DUM-E's work, even one handed to dum-e: no status of it is in DUM-E's queue
func TestClassifyLater(t *testing.T) {
	live := func(id string) bool { return id == "run-live" }
	for _, status := range []string{"pending", "active", "blocked", "done", "deferred", "skipped"} {
		c := chunk("x", status, Owner, StartedNote("run-live", "wave/dume-a"))
		c.Later = true
		if got := ClassifyChunk(c, live); got != StateNone {
			t.Fatalf("a later %s chunk classified %v, want StateNone", status, got)
		}
		c.Later = false
		if status == "pending" || status == "active" || status == "blocked" || status == "done" {
			if got := ClassifyChunk(c, live); got == StateNone {
				t.Fatalf("the same %s chunk with no mark is StateNone: the test proves nothing", status)
			}
		}
	}
	waiting := chunk("w", "pending", Owner)
	waiting.Later = true
	s := Summarize([]*waveobj.Effort{{OID: "e1", Title: "One", Project: "arcterm", Status: "active", Chunks: []waveobj.EffortChunk{waiting}}}, live)
	if len(s.Waiting) != 0 || s.Done != 0 || s.Blocked != 0 {
		t.Fatalf("summary = %+v, want nothing of a later chunk", s)
	}
}

func TestParseStarted(t *testing.T) {
	run, branch, ok := ParseStarted(StartedNote("abc", "wave/dume-1"))
	if !ok || run != "abc" || branch != "wave/dume-1" {
		t.Fatalf("ParseStarted = %q %q %v", run, branch, ok)
	}
	if _, _, ok := ParseStarted("Run finished: x"); ok {
		t.Fatal("a non-DUM-E note parsed")
	}
}

func TestSummarize(t *testing.T) {
	live := func(string) bool { return false }
	efforts := []*waveobj.Effort{
		{OID: "e1", Title: "One", Project: "arcterm", Status: "active", Chunks: []waveobj.EffortChunk{
			chunk("a", "done", Owner),
			chunk("b", "pending", Owner),
			chunk("c", "active", Owner, StartedNote("r", "wave/dume-c"), ToLandNote("wave/dume-c", 3)),
		}},
		{OID: "e2", Title: "No project", Status: "active", Chunks: []waveobj.EffortChunk{chunk("d", "pending", Owner)}},
		{OID: "e3", Title: "Paused", Project: "arcterm", Status: "paused", Chunks: []waveobj.EffortChunk{chunk("e", "pending", Owner)}},
	}
	s := Summarize(efforts, live)
	if len(s.Waiting) != 1 || s.Waiting[0].Chunk != "b" || s.Waiting[0].EffortOID != "e1" {
		t.Fatalf("Waiting = %+v, want only e1/b (no project and paused initiatives are skipped)", s.Waiting)
	}
	if len(s.ToLand) != 1 || s.ToLand[0].Branch != "wave/dume-c" {
		t.Fatalf("ToLand = %+v", s.ToLand)
	}
	if s.Done != 1 {
		t.Fatalf("Done = %d, want 1", s.Done)
	}
}

// withPriority is c carrying a priority level.
func withPriority(c waveobj.EffortChunk, priority string) waveobj.EffortChunk {
	c.Priority = priority
	return c
}

func waitingLabels(s Summary) []string {
	var out []string
	for _, r := range s.Waiting {
		out = append(out, r.EffortOID+"/"+r.Chunk)
	}
	return out
}

// DUM-E's queue follows the order of work: within one initiative the highest-ranked waiting chunk is next, ties by
// position; initiatives keep their order
func TestSummarizeWaitingFollowsTheOrderOfWork(t *testing.T) {
	live := func(string) bool { return false }
	efforts := []*waveobj.Effort{
		{OID: "e1", Title: "One", Project: "arcterm", Status: "active", Chunks: []waveobj.EffortChunk{
			withPriority(chunk("a", "pending", Owner), "low"),
			withPriority(chunk("b", "pending", Owner), "critical"),
			chunk("c", "pending", Owner),                               // unset ranks as medium
			withPriority(chunk("d", "pending", Owner), "information"),  // information opens last
			withPriority(chunk("mine", "pending", "me"), "critical"),   // not DUM-E's: never in its queue
			withPriority(chunk("stuck", "blocked", Owner), "critical"), // parked: not waiting, whatever its level
			withPriority(chunk("e", "pending", Owner), "medium"),       // ties with c: c comes first by position
		}},
		{OID: "e2", Title: "Two", Project: "arcterm", Status: "active", Chunks: []waveobj.EffortChunk{
			withPriority(chunk("x", "pending", Owner), "low"),
			withPriority(chunk("y", "pending", Owner), "high"),
		}},
	}
	s := Summarize(efforts, live)
	want := []string{"e1/b", "e1/c", "e1/e", "e1/a", "e1/d", "e2/y", "e2/x"}
	if got := waitingLabels(s); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("Waiting = %v, want %v", got, want)
	}
	if s.Blocked != 1 {
		t.Fatalf("Blocked = %d, want 1", s.Blocked)
	}
}

// the rank is read off the whole initiative, but it only reorders waiting chunks: a DUM-E chunk waiting behind a
// chunk of the person's own still comes in order of work among DUM-E's
func TestSummarizeWaitingIgnoresOtherChunksWhenOrdering(t *testing.T) {
	live := func(string) bool { return false }
	efforts := []*waveobj.Effort{
		{OID: "e1", Title: "One", Project: "arcterm", Status: "active", Chunks: []waveobj.EffortChunk{
			chunk("mine", "active", "me"),
			withPriority(chunk("a", "pending", Owner), "low"),
			withPriority(chunk("other", "pending", "me"), "critical"),
			withPriority(chunk("b", "pending", Owner), "high"),
		}},
	}
	s := Summarize(efforts, live)
	if got := strings.Join(waitingLabels(s), " "); got != "e1/b e1/a" {
		t.Fatalf("Waiting = %v, want [e1/b e1/a]", got)
	}
}

// only the waiting queue is ordered by level: chunks DUM-E has started keep their plan order
func TestSummarizeLeavesOtherQueuesInPlanOrder(t *testing.T) {
	live := func(string) bool { return false }
	efforts := []*waveobj.Effort{
		{OID: "e1", Title: "One", Project: "arcterm", Status: "active", Chunks: []waveobj.EffortChunk{
			withPriority(chunk("a", "active", Owner, StartedNote("r1", "wave/dume-a"), ToLandNote("wave/dume-a", 1)), "low"),
			withPriority(chunk("b", "active", Owner, StartedNote("r2", "wave/dume-b"), ToLandNote("wave/dume-b", 1)), "critical"),
		}},
	}
	s := Summarize(efforts, live)
	if len(s.ToLand) != 2 || s.ToLand[0].Chunk != "a" || s.ToLand[1].Chunk != "b" {
		t.Fatalf("ToLand = %+v, want a then b (plan order)", s.ToLand)
	}
}

func TestGoalTellsTheRunNotToLand(t *testing.T) {
	g := Goal(Ref{EffortTitle: "Tidy", Chunk: "Remove dead code in pkg/x", Notes: []string{"see pkg/x/old.go"}})
	for _, want := range []string{"Tidy", "Remove dead code in pkg/x", "see pkg/x/old.go", "Do not merge", "subagent"} {
		if !strings.Contains(g, want) {
			t.Fatalf("goal misses %q:\n%s", want, g)
		}
	}
}

func TestTreeKey(t *testing.T) {
	k := TreeKey("d43e41e0-1b44", time.Unix(1794748172, 0))
	if !strings.HasPrefix(k, "dume-d43e41e0-") || strings.ContainsAny(k, "/ ") {
		t.Fatalf("TreeKey = %q", k)
	}
}
