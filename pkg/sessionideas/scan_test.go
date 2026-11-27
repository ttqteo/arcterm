// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"bytes"
	"context"
	"errors"
	"log"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// scanNow is the instant every scan test runs at (newTestStore's clock too).
var scanNow = time.Date(2026, 11, 26, 9, 0, 0, 0, time.UTC)

func daysAgo(d float64) time.Time { return scanNow.Add(-time.Duration(d * 24 * float64(time.Hour))) }

// world is the sessions on disk of one test, and what a scan read of them.
type world struct {
	cands   []agentsessions.DigestSession
	digests map[string]agentsessions.DigestSession
	reads   []string
	prompts []string
	runs    int
	pc      ProjectContext
	reply   func(call int, prompt string) (string, int64, error)
	days    int // Claude Code's cleanupPeriodDays, as the scan reads it
}

func newWorld() *world {
	return &world{digests: map[string]agentsessions.DigestSession{}, days: 45, reply: func(int, string) (string, int64, error) { return "[]", 100, nil }}
}

func userTurn(text string, ts int64) agentsessions.Turn {
	return agentsessions.Turn{Speaker: "user", Text: text, Ts: ts}
}
func agentTurn(text string, ts int64) agentsessions.Turn {
	return agentsessions.Turn{Speaker: "agent", Text: text, Ts: ts}
}

// add puts a session on disk: age in days since its last write, and the digest's turns.
func (w *world) add(name string, age float64, size int64, turns ...agentsessions.Turn) agentsessions.DigestSession {
	path := "/claude/" + name + ".jsonl"
	c := agentsessions.DigestSession{Path: path, Stem: name, Mtime: daysAgo(age), Size: size}
	w.cands = append(w.cands, c)
	full := c
	full.Session = &agentsessions.SessionInfo{ID: "id-" + name, ProjectPath: "/work/arc", ProjectName: "arc", Task: "title of " + name}
	full.Turns = turns
	w.digests[path] = full
	return c
}

func (w *world) deps() Deps {
	return Deps{
		Run: func(ctx context.Context, prompt string) (string, int64, error) {
			w.runs++
			w.prompts = append(w.prompts, prompt)
			return w.reply(w.runs, prompt)
		},
		ProjectContext: func(context.Context, string) (ProjectContext, error) { return w.pc, nil },
		Candidates:     func() []agentsessions.DigestSession { return w.cands },
		Read: func(path string) (agentsessions.DigestSession, error) {
			w.reads = append(w.reads, path)
			d, ok := w.digests[path]
			if !ok {
				return agentsessions.DigestSession{}, errors.New("no such transcript")
			}
			return d, nil
		},
		CleanupDays: func() int { return w.days },
		Now:         func() time.Time { return scanNow },
	}
}

func oneIdea(gist string) string {
	return `[{"gist":"` + gist + `","effort":"","quotes":[{"who":"you","text":"what about ` + gist + `"}],"why":"never decided"}]`
}

func loadStore(t *testing.T, s *Store) wshrpc.SessionIdeasData {
	t.Helper()
	d, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func markFor(t *testing.T, d wshrpc.SessionIdeasData, path string) wshrpc.SessionIdeaMark {
	t.Helper()
	for _, m := range d.Marks {
		if m.TranscriptPath == path {
			return m
		}
	}
	t.Fatalf("no mark for %s in %+v", path, d.Marks)
	return wshrpc.SessionIdeaMark{}
}

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return &buf
}

func TestEligible(t *testing.T) {
	base := agentsessions.DigestSession{Path: "/claude/a.jsonl", Mtime: daysAgo(10), Size: 500}
	mark := func(path string, size, mtimeMs int64) wshrpc.SessionIdeaMark {
		return wshrpc.SessionIdeaMark{TranscriptPath: path, Size: size, MtimeMs: mtimeMs}
	}
	mod := func(f func(*agentsessions.DigestSession)) agentsessions.DigestSession { s := base; f(&s); return s }
	for _, c := range []struct {
		name  string
		s     agentsessions.DigestSession
		marks []wshrpc.SessionIdeaMark
		want  bool
	}{
		{"quiet, unmarked", base, nil, true},
		{"archived", mod(func(s *agentsessions.DigestSession) { s.Archived = true }), nil, false},
		{"written a day ago", mod(func(s *agentsessions.DigestSession) { s.Mtime = daysAgo(1) }), nil, false},
		{"written just under 2 days ago", mod(func(s *agentsessions.DigestSession) { s.Mtime = daysAgo(1.99) }), nil, false},
		{"written exactly 2 days ago", mod(func(s *agentsessions.DigestSession) { s.Mtime = daysAgo(2) }), nil, true},
		{"marked with the same size and mtime", base, []wshrpc.SessionIdeaMark{mark(base.Path, 500, base.Mtime.UnixMilli())}, false},
		{"it grew since its mark", base, []wshrpc.SessionIdeaMark{mark(base.Path, 400, base.Mtime.UnixMilli())}, true},
		{"its mtime moved since its mark", base, []wshrpc.SessionIdeaMark{mark(base.Path, 500, base.Mtime.UnixMilli()-1)}, true},
		{"another transcript is marked", base, []wshrpc.SessionIdeaMark{mark("/claude/b.jsonl", 500, base.Mtime.UnixMilli())}, true},
	} {
		if got := Eligible(c.s, c.marks, scanNow); got != c.want {
			t.Errorf("%s: Eligible = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestSkipContent(t *testing.T) {
	for _, c := range []struct {
		name  string
		turns []agentsessions.Turn
		skip  bool
	}{
		{"a person's prompt", []agentsessions.Turn{userTurn("add a dark mode", 1)}, false},
		{"opened by Session ideas", []agentsessions.Turn{userTurn("[arc:session-ideas] Discuss this idea: x", 1)}, true},
		{"marker after leading space", []agentsessions.Turn{userTurn("  \n[arc:session-ideas] Go through x", 1)}, true},
		{"marker only in a later prompt", []agentsessions.Turn{userTurn("hello", 1), userTurn("[arc:session-ideas] x", 2)}, false},
		{"an agent turn first", []agentsessions.Turn{agentTurn("hi", 1), userTurn("do it", 2)}, false},
		{"no prompt of the person's", []agentsessions.Turn{agentTurn("hi", 1)}, true},
		{"no turns", nil, true},
	} {
		skip, why := SkipContent(agentsessions.DigestSession{Turns: c.turns})
		if skip != c.skip {
			t.Errorf("%s: SkipContent = %v, want %v", c.name, skip, c.skip)
		}
		if skip && why == "" {
			t.Errorf("%s: a skip must say why", c.name)
		}
	}
}

func TestScanNowStoresTheIdeasAndTheMark(t *testing.T) {
	s, events := newTestStore(t)
	w := newWorld()
	c := w.add("one", 10, 500, userTurn("we could add a dark mode", 100), agentTurn("maybe later", 200))
	w.pc = ProjectContext{Name: "arc", Root: "/work/arc", Initiatives: []Initiative{{OID: "e1", Title: "Theming", Chunks: []string{"tokens"}}}}
	w.reply = func(int, string) (string, int64, error) {
		return "```json\n" + `[
 {"gist":"  Add a dark mode ","effort":"e1","quotes":[{"who":"you","text":"we could add a dark mode"},{"who":"model","text":"maybe later"},{"who":"you","text":""},{"who":"you","text":"c"},{"who":"you","text":"d"}],"why":"never decided"},
 {"gist":"Show cost per run","effort":"gone","quotes":[],"why":"floated once"},
 {"gist":"   ","effort":"e1","quotes":[],"why":"empty gist"}
]` + "\n```", 1234, nil
	}
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatalf("ScanNow: %v", err)
	}
	d := loadStore(t, s)
	if len(d.Ideas) != 2 {
		t.Fatalf("two ideas have a gist, got %+v", d.Ideas)
	}
	a, b := d.Ideas[0], d.Ideas[1]
	if a.Gist != "Add a dark mode" || a.EffortOID != "e1" || a.EffortTitle != "Theming" || a.State != wshrpc.SessionIdeaState_Review {
		t.Errorf("first idea: %+v", a)
	}
	if a.Project != "arc" || a.ProjectPath != "/work/arc" || a.SessionID != "id-one" || a.SessionTitle != "title of one" || a.TranscriptPath != c.Path {
		t.Errorf("an idea names its project and its session: %+v", a)
	}
	if want := []wshrpc.SessionIdeaQuote{{Who: "you", Text: "we could add a dark mode"}, {Who: "agent", Text: "maybe later"}, {Who: "you", Text: "c"}}; !reflect.DeepEqual(a.Quotes, want) {
		t.Errorf("quotes are cleaned and cut at three: got %+v, want %+v", a.Quotes, want)
	}
	if a.SaidTs != 100 || a.Why != "never decided" || a.FoundTs != scanNow.UnixMilli() || a.DeletesTs != DeletesAt(c.Mtime, w.days).UnixMilli() || a.ID == "" {
		t.Errorf("first idea's times and why: %+v", a)
	}
	if b.EffortOID != "" || b.EffortTitle != "" || len(b.Quotes) != 0 || b.SaidTs != 200 || a.ID == b.ID {
		t.Errorf("an effort that is not the project's is a new idea, said at the last turn read: %+v", b)
	}
	m := markFor(t, d, c.Path)
	if m.Outcome != wshrpc.SessionIdeaOutcome_Ideas || m.Ideas != 2 || m.Size != 500 || m.MtimeMs != c.Mtime.UnixMilli() ||
		m.LastTurnTs != 200 || m.ScannedTs != scanNow.UnixMilli() || m.SessionID != "id-one" || m.SessionTitle != "title of one" || m.Project != "arc" {
		t.Errorf("mark: %+v", m)
	}
	sc := d.Scan
	if sc == nil || sc.Done != 1 || sc.Total != 1 || sc.NewIdeas != 2 || sc.Tokens != 1234 || sc.Error != "" || sc.StoppedAt != 0 ||
		sc.StartedTs != scanNow.UnixMilli() || sc.EndedTs != scanNow.UnixMilli() || sc.Forced {
		t.Errorf("scan: %+v", sc)
	}
	if d.LastScanTs != scanNow.UnixMilli() || !d.FirstScanDone {
		t.Errorf("a scan the person started sets LastScanTs and FirstScanDone: %+v", d)
	}
	if *events == 0 {
		t.Error("each write publishes the changed event")
	}
}

func TestScanNowSessionWithNothingGetsANothingMark(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	c := w.add("one", 10, 500, userTurn("fix the bug", 100))
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	d := loadStore(t, s)
	if m := markFor(t, d, c.Path); m.Outcome != wshrpc.SessionIdeaOutcome_Nothing || m.Ideas != 0 {
		t.Errorf("an empty list is a nothing mark: %+v", m)
	}
	if len(d.Ideas) != 0 || d.Scan.NewIdeas != 0 || d.Scan.Done != 1 {
		t.Errorf("nothing found: %+v", d)
	}
}

func TestScanNowSkipsAMarkerSessionAndAnEmptyDigestWithoutAModelCall(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	marker := w.add("marker", 10, 500, userTurn("[arc:session-ideas] Discuss: dark mode", 100), agentTurn("ok", 200))
	empty := w.add("empty", 11, 300, agentTurn("only an agent turn", 100))
	bare := w.add("bare", 12, 100) // a transcript with no session at all
	w.digests[bare.Path] = agentsessions.DigestSession{Path: bare.Path, Stem: "bare", Mtime: bare.Mtime, Size: bare.Size}
	normal := w.add("real", 13, 700, userTurn("add export", 100))
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if w.runs != 1 || !strings.Contains(w.prompts[0], "add export") {
		t.Fatalf("only the real session reaches the model, got %d calls", w.runs)
	}
	d := loadStore(t, s)
	for _, c := range []agentsessions.DigestSession{marker, empty, bare} {
		if m := markFor(t, d, c.Path); m.Outcome != wshrpc.SessionIdeaOutcome_Skipped || m.Size != c.Size || m.MtimeMs != c.Mtime.UnixMilli() || m.Ideas != 0 {
			t.Errorf("%s: want a skipped mark of its size and mtime, got %+v", c.Stem, m)
		}
	}
	if m := markFor(t, d, bare.Path); m.SessionID != "bare" {
		t.Errorf("a transcript with no session is named by its file: %+v", m)
	}
	if m := markFor(t, d, normal.Path); m.Outcome != wshrpc.SessionIdeaOutcome_Nothing {
		t.Errorf("real: %+v", m)
	}
	if d.Scan.Done != 4 || d.Scan.Total != 4 {
		t.Errorf("a skipped session counts as done: %+v", d.Scan)
	}

	// a skipped session is never read again unless it grows
	w.reads, w.runs = nil, 0
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if len(w.reads) != 0 || w.runs != 0 {
		t.Fatalf("a second scan has nothing to read, read %v", w.reads)
	}
}

func TestScanNowGrownSessionSendsOnlyTheNewTurns(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	c := w.add("one", 10, 500, userTurn("OLD talk about caching", 100), agentTurn("OLD answer", 200))
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(w.prompts[0], "OLD talk about caching") || strings.Contains(w.prompts[0], "only the turns since") {
		t.Fatalf("the first read sends every turn")
	}

	// the transcript grows: the same file, a new size, two new turns
	w.cands[0].Size, w.cands[0].Mtime = 900, daysAgo(5)
	g := w.digests[c.Path]
	g.Size, g.Mtime = 900, daysAgo(5)
	g.Turns = append(g.Turns, userTurn("NEW idea about exports", 300), agentTurn("NEW reply", 400))
	w.digests[c.Path] = g
	w.reply = func(int, string) (string, int64, error) { return oneIdea("Export to csv"), 50, nil }
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if w.runs != 2 {
		t.Fatalf("a grown session is read again, got %d calls", w.runs)
	}
	p := w.prompts[1]
	if strings.Contains(p, "OLD") || !strings.Contains(p, "NEW idea about exports") || !strings.Contains(p, "NEW reply") || !strings.Contains(p, "only the turns since") {
		t.Fatalf("only the turns after the mark's LastTurnTs go to the model:\n%s", p)
	}
	d := loadStore(t, s)
	m := markFor(t, d, c.Path)
	if len(d.Marks) != 1 || m.Size != 900 || m.LastTurnTs != 400 || m.Outcome != wshrpc.SessionIdeaOutcome_Ideas || m.Ideas != 1 {
		t.Fatalf("the mark is replaced, not added: %+v", d.Marks)
	}
}

func TestScanNowGrownSessionWithNoNewTurnsMakesNoCall(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	c := w.add("one", 10, 500, userTurn("talk", 100))
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	w.cands[0].Size = 600 // it grew by something no turn shows (a tool call)
	g := w.digests[c.Path]
	g.Size = 600
	w.digests[c.Path] = g
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if w.runs != 1 {
		t.Fatalf("no new turn, no call: %d calls", w.runs)
	}
	if m := markFor(t, loadStore(t, s), c.Path); m.Size != 600 {
		t.Fatalf("the mark follows the new size so the session is not read again: %+v", m)
	}
}

func TestScanNowAModelErrorStopsAndKeepsWhatWasFound(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	first := w.add("first", 30, 100, userTurn("one", 100))
	second := w.add("second", 20, 100, userTurn("two", 100))
	third := w.add("third", 10, 100, userTurn("three", 100))
	w.reply = func(call int, _ string) (string, int64, error) {
		switch call {
		case 1:
			return oneIdea("Idea one"), 100, nil
		case 2:
			return "", 40, errors.New("API Error: 529 overloaded")
		}
		return oneIdea("Idea three"), 100, nil
	}
	err := ScanNow(context.Background(), s, w.deps(), ScanOpts{})
	if err == nil || !strings.Contains(err.Error(), "529") {
		t.Fatalf("ScanNow returns the error that stopped it, got %v", err)
	}
	d := loadStore(t, s)
	if len(d.Ideas) != 1 || d.Ideas[0].Gist != "Idea one" {
		t.Fatalf("what was found stays: %+v", d.Ideas)
	}
	sc := d.Scan
	if sc.Done != 1 || sc.Total != 3 || sc.StoppedAt != 1 || !strings.Contains(sc.Error, "529") || sc.Tokens != 140 || sc.NewIdeas != 1 || sc.EndedTs == 0 {
		t.Errorf("scan: %+v", sc)
	}
	if d.LastScanTs != scanNow.UnixMilli() || !d.FirstScanDone {
		t.Errorf("a stopped scan still sets LastScanTs: %+v", d)
	}
	if len(d.Marks) != 1 || d.Marks[0].TranscriptPath != first.Path {
		t.Fatalf("the failed session and those after it get no mark: %+v", d.Marks)
	}

	// the next scan goes on from there: it reads the second and third, not the first
	w.reads, w.reply = nil, func(int, string) (string, int64, error) { return "[]", 10, nil }
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if want := []string{second.Path, third.Path}; !reflect.DeepEqual(w.reads, want) {
		t.Fatalf("the next scan reads what the last one did not reach: got %v, want %v", w.reads, want)
	}
	d = loadStore(t, s)
	if d.Scan.Error != "" || d.Scan.StoppedAt != 0 || d.Scan.Done != 2 || len(d.Marks) != 3 {
		t.Errorf("the finished scan clears the error: %+v", d.Scan)
	}
}

func TestEndUnfinishedScanEndsOnlyAScanWithNoEnd(t *testing.T) {
	s, events := newTestStore(t)
	if ended, err := EndUnfinishedScan(s, EndedByShutdown); ended || err != nil || *events != 0 {
		t.Fatalf("a store with no scan: ended %v, err %v, %d events", ended, err, *events)
	}
	// wavesrv stopped while the third of five sessions was read: two are marked, one idea found
	left := wshrpc.SessionIdeasScan{Done: 2, Total: 5, StartedTs: 1000, NewIdeas: 1, Tokens: 400}
	mark := wshrpc.SessionIdeaMark{TranscriptPath: "/a.jsonl", Outcome: wshrpc.SessionIdeaOutcome_Nothing}
	if err := s.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Scan = &left
		d.Marks = []wshrpc.SessionIdeaMark{mark}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	*events = 0
	ended, err := EndUnfinishedScan(s, EndedByShutdown)
	if !ended || err != nil || *events != 1 {
		t.Fatalf("a scan with no end: ended %v, err %v, %d events", ended, err, *events)
	}
	d := loadStore(t, s)
	want := left
	want.EndedTs, want.StoppedAt, want.Error = scanNow.UnixMilli(), 2, EndedByShutdown
	if *d.Scan != want || d.LastScanTs != scanNow.UnixMilli() || len(d.Marks) != 1 {
		t.Fatalf("ended as a stopped scan, keeping its marks: scan %+v, last %d, marks %+v", *d.Scan, d.LastScanTs, d.Marks)
	}
	// a scan that has its end is left as it is, and nothing is written
	if ended, err := EndUnfinishedScan(s, EndedByFailure); ended || err != nil || *events != 1 {
		t.Fatalf("a scan that ended: ended %v, err %v, %d events", ended, err, *events)
	}
	if got := loadStore(t, s); got.Scan.Error != EndedByShutdown {
		t.Fatalf("an ended scan is not ended again: %+v", got.Scan)
	}
}

func TestScanNowCancelledScanSaysStopped(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	w.add("first", 30, 100, userTurn("one", 100))
	w.add("second", 20, 100, userTurn("two", 100))
	ctx, cancel := context.WithCancel(context.Background())
	w.reply = func(call int, _ string) (string, int64, error) {
		cancel() // the person pressed Stop while the first call ran
		return "", 0, errors.New("signal: killed")
	}
	if err := ScanNow(ctx, s, w.deps(), ScanOpts{}); err == nil {
		t.Fatal("a stopped scan returns an error")
	}
	d := loadStore(t, s)
	if d.Scan.Error != "stopped" || d.Scan.StoppedAt != 0 || d.Scan.Done != 0 || len(d.Marks) != 0 || w.runs != 1 {
		t.Fatalf("stop: %+v marks %+v, %d calls", d.Scan, d.Marks, w.runs)
	}
	if d.LastScanTs == 0 {
		t.Error("a stopped scan sets LastScanTs")
	}
}

func TestScanNowEmptyPathsReadsEveryEligibleCandidateNearestDeletionFirst(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	newer := w.add("newer", 5, 100, userTurn("n", 1))
	older := w.add("older", 60, 100, userTurn("o", 1))
	w.add("recent", 1, 100, userTurn("r", 1))    // written yesterday: still being written
	w.add("archived", 40, 100, userTurn("a", 1)) // arcterm's own
	w.cands[len(w.cands)-1].Archived = true
	marked := w.add("marked", 30, 100, userTurn("m", 1)) // scanned, unchanged
	if err := s.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Marks = []wshrpc.SessionIdeaMark{{TranscriptPath: marked.Path, Size: 100, MtimeMs: marked.Mtime.UnixMilli(), Outcome: wshrpc.SessionIdeaOutcome_Nothing}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if want := []string{older.Path, newer.Path}; !reflect.DeepEqual(w.reads, want) {
		t.Fatalf("every quiet session not yet scanned, oldest write first: got %v, want %v", w.reads, want)
	}
	if d := loadStore(t, s); d.Scan.Total != 2 {
		t.Fatalf("the total counts what will be read: %+v", d.Scan)
	}
}

func TestScanNowPathsAreResolvedThroughTheCandidates(t *testing.T) {
	s, _ := newTestStore(t)
	logs := captureLog(t)
	w := newWorld()
	a := w.add("a", 30, 100, userTurn("a", 1))
	w.add("b", 20, 100, userTurn("b", 1))
	recent := w.add("recent", 1, 100, userTurn("r", 1))
	// a path that is no candidate is never read, even when a digest of it exists
	w.digests["/elsewhere/x.jsonl"] = agentsessions.DigestSession{Path: "/elsewhere/x.jsonl", Turns: []agentsessions.Turn{userTurn("x", 1)}}
	err := ScanNow(context.Background(), s, w.deps(), ScanOpts{Paths: []string{"/elsewhere/x.jsonl", a.Path, a.Path, recent.Path}})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{a.Path}; !reflect.DeepEqual(w.reads, want) {
		t.Fatalf("only the named, eligible candidate is read, once: got %v, want %v", w.reads, want)
	}
	if !strings.Contains(logs.String(), "/elsewhere/x.jsonl") || !strings.Contains(logs.String(), "not a candidate") {
		t.Errorf("a path that is not a candidate is logged: %q", logs.String())
	}
	if !strings.Contains(logs.String(), recent.Path) {
		t.Errorf("a named path that is not eligible is logged: %q", logs.String())
	}
	d := loadStore(t, s)
	if d.LastScanTs != scanNow.UnixMilli() || d.Scan.Total != 1 || d.Scan.Done != 1 {
		t.Fatalf("the scan ends with LastScanTs set: %+v", d)
	}

	// nothing to read at all still ends the scan
	w.reads = nil
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{Paths: []string{"/nope.jsonl"}}); err != nil {
		t.Fatal(err)
	}
	if d := loadStore(t, s); d.Scan.Total != 0 || d.Scan.EndedTs == 0 || len(w.reads) != 0 {
		t.Fatalf("an unknown path is skipped and the scan still ends: %+v", d.Scan)
	}
}

func TestScanNowForcedScanLeavesFirstScanDoneAlone(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	w.add("one", 80, 100, userTurn("a", 1))
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{Forced: true, Paths: []string{w.cands[0].Path}}); err != nil {
		t.Fatal(err)
	}
	d := loadStore(t, s)
	if d.FirstScanDone || !d.Scan.Forced || d.LastScanTs == 0 {
		t.Fatalf("a forced scan is the schedule's, not the person's first: %+v", d)
	}
}

func TestScanNowDedupesAgainstKnownIdeas(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	c := w.add("one", 10, 500, userTurn("talk", 100))
	if err := s.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Ideas = []wshrpc.SessionIdea{
			{ID: "dropped", Gist: "Add a dark mode", ProjectPath: "/work/arc", State: wshrpc.SessionIdeaState_Dropped},
			{ID: "elsewhere", Gist: "Cache the digest", ProjectPath: "/work/other", State: wshrpc.SessionIdeaState_Review},
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	w.reply = func(int, string) (string, int64, error) {
		return `[{"gist":"add a DARK mode!","quotes":[]},{"gist":"Cache the digest","quotes":[]},{"gist":"Cache the digest.","quotes":[]}]`, 10, nil
	}
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	p := w.prompts[0]
	if !strings.Contains(p, "Add a dark mode") || strings.Contains(p, "Cache the digest\n") {
		t.Errorf("the prompt lists this project's known gists, not another project's:\n%s", p)
	}
	d := loadStore(t, s)
	var gists []string
	for _, i := range d.Ideas {
		gists = append(gists, i.ID+":"+i.Gist)
	}
	if want := []string{"dropped:Add a dark mode", "elsewhere:Cache the digest"}; len(d.Ideas) != 3 || !reflect.DeepEqual(gists[:2], want) || d.Ideas[2].Gist != "Cache the digest" || d.Ideas[2].ProjectPath != "/work/arc" {
		t.Fatalf("a dropped gist is not proposed again, a repeat in the reply is added once, another project's gist does not count: %v", gists)
	}
	if m := markFor(t, d, c.Path); m.Ideas != 1 || d.Scan.NewIdeas != 1 {
		t.Errorf("only what was added counts: %+v %+v", m, d.Scan)
	}
}

func TestScanNowAnUnusableReplyLeavesTheSessionUnmarkedAndGoesOn(t *testing.T) {
	s, _ := newTestStore(t)
	logs := captureLog(t)
	w := newWorld()
	bad := w.add("bad", 30, 100, userTurn("one", 100))
	good := w.add("good", 20, 100, userTurn("two", 100))
	w.reply = func(call int, _ string) (string, int64, error) {
		if call == 1 {
			return "Sure! Here are the ideas: none.", 70, nil
		}
		return oneIdea("Idea two"), 30, nil
	}
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatalf("one bad reply does not stop the scan: %v", err)
	}
	d := loadStore(t, s)
	if len(d.Marks) != 1 || d.Marks[0].TranscriptPath != good.Path || len(d.Ideas) != 1 {
		t.Fatalf("the unusable session stays unmarked so the next scan tries it again: %+v", d.Marks)
	}
	if d.Scan.Tokens != 100 || d.Scan.Done != 2 || d.Scan.Error != "" {
		t.Errorf("its tokens still count: %+v", d.Scan)
	}
	if !strings.Contains(logs.String(), bad.Path) || !strings.Contains(logs.String(), "unusable") {
		t.Errorf("the reply that was lost is logged: %q", logs.String())
	}
}

func TestScanNowAnUnreadableTranscriptIsLoggedAndSkipped(t *testing.T) {
	s, _ := newTestStore(t)
	logs := captureLog(t)
	w := newWorld()
	gone := w.add("gone", 30, 100, userTurn("one", 100))
	delete(w.digests, gone.Path)
	good := w.add("good", 20, 100, userTurn("two", 100))
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	d := loadStore(t, s)
	if len(d.Marks) != 1 || d.Marks[0].TranscriptPath != good.Path || d.Scan.Done != 2 {
		t.Fatalf("an unreadable transcript is not marked, and does not stop the scan: %+v", d)
	}
	if !strings.Contains(logs.String(), gone.Path) {
		t.Errorf("what could not be read is logged: %q", logs.String())
	}
}

func TestScanNowAProjectContextErrorIsLoggedAndTheScanGoesOn(t *testing.T) {
	s, _ := newTestStore(t)
	logs := captureLog(t)
	w := newWorld()
	w.add("one", 10, 100, userTurn("talk", 100))
	deps := w.deps()
	calls := 0
	deps.ProjectContext = func(context.Context, string) (ProjectContext, error) {
		calls++
		return ProjectContext{Specs: []string{"kept-spec.md"}}, errors.New("effort store is down")
	}
	w.add("two", 11, 100, userTurn("talk", 100)) // the same project: its context is read once
	if err := ScanNow(context.Background(), s, deps, ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Errorf("a project's context is read once per scan, got %d", calls)
	}
	if !strings.Contains(w.prompts[0], "kept-spec.md") || !strings.Contains(logs.String(), "effort store is down") {
		t.Errorf("the partial context is used and the error logged: %q", logs.String())
	}
}

func TestScanNowRefusesToScanOverAStoreItCannotRead(t *testing.T) {
	s, _ := newTestStore(t)
	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.statePath(), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := newWorld()
	w.add("one", 10, 100, userTurn("talk", 100))
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err == nil {
		t.Fatal("a scan must not go on from an empty store when state.json cannot be read")
	}
	if w.runs != 0 {
		t.Fatalf("no call was made, got %d", w.runs)
	}
	if raw, _ := os.ReadFile(s.statePath()); string(raw) != "{not json" {
		t.Fatalf("the unreadable file was written over: %q", raw)
	}
}
