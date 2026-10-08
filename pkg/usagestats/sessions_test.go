package usagestats

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

const (
	testOpus   = "claude-opus-4-8"
	testSonnet = "claude-sonnet-4-6"
)

func asstLine(id string, ts time.Time, model, cwd string, in, out, cr, cw, cw1h int) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":%q,"requestId":"r-%s","cwd":%q,"message":{"id":"m-%s","model":%q,"usage":{"input_tokens":%d,"output_tokens":%d,"cache_read_input_tokens":%d,"cache_creation_input_tokens":%d,"cache_creation":{"ephemeral_1h_input_tokens":%d}}}}`,
		ts.UTC().Format(time.RFC3339), id, cwd, id, model, in, out, cr, cw, cw1h)
}

func titleLine(title string) string {
	return fmt.Sprintf(`{"type":"ai-title","aiTitle":%q,"sessionId":"x"}`, title)
}

func writeJSONL(t *testing.T, path string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func sessionByID(t *testing.T, sessions []SessionUsage, id string) SessionUsage {
	t.Helper()
	for _, s := range sessions {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("no session %q in %d sessions", id, len(sessions))
	return SessionUsage{}
}

func TestScanSessionUsageAttributesSubagentsToParent(t *testing.T) {
	root := t.TempDir()
	t0 := time.Now().Add(-48 * time.Hour)
	writeJSONL(t, filepath.Join(root, "proj", "s1.jsonl"),
		asstLine("a1", t0, testOpus, "/w/proj", 5, 7, 100, 10, 0),
		asstLine("a2", t0.Add(time.Minute), testOpus, "/w/proj", 5, 7, 100, 10, 0),
	)
	writeJSONL(t, filepath.Join(root, "proj", "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", t0.Add(2*time.Minute), testSonnet, "/w/proj", 10, 20, 1000, 100, 50),
		asstLine("b2", t0.Add(3*time.Minute), testSonnet, "/w/proj", 10, 20, 1000, 100, 50),
		asstLine("b3", t0.Add(4*time.Minute), testSonnet, "/w/proj", 10, 20, 1000, 100, 50),
	)
	sessions := scanSessionRoot(root, 7)
	if len(sessions) != 1 {
		t.Fatalf("want 1 session, got %d: %+v", len(sessions), sessions)
	}
	s := sessions[0]
	if s.ID != "s1" || s.Turns != 2 || s.SubTurns != 3 {
		t.Fatalf("id/turns/subturns = %q/%d/%d", s.ID, s.Turns, s.SubTurns)
	}
	want := []SessionModelTokens{
		{Model: testOpus, Input: 10, Output: 14, CacheRead: 200, CacheCreate: 20},
		{Model: testSonnet, Sub: true, Input: 30, Output: 60, CacheRead: 3000, CacheCreate: 300, CacheCreate1h: 150},
	}
	if !slices.Equal(s.Models, want) {
		t.Fatalf("models = %+v, want %+v", s.Models, want)
	}
}

func TestScanSessionUsageContext(t *testing.T) {
	root := t.TempDir()
	t0 := time.Now().Add(-48 * time.Hour)
	writeJSONL(t, filepath.Join(root, "proj", "s1.jsonl"),
		asstLine("a1", t0, testOpus, "/w/proj", 100, 1, 99_000, 900, 0),                       // 100,000
		asstLine("a2", t0.Add(time.Minute), testOpus, "/w/proj", 1_000, 1, 290_000, 9_000, 0), // 300,000
		asstLine("a3", t0.Add(2*time.Minute), testOpus, "/w/proj", 0, 1, 200_000, 0, 0),       // 200,000
	)
	writeJSONL(t, filepath.Join(root, "proj", "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", t0.Add(3*time.Minute), testSonnet, "/w/proj", 0, 1, 900_000, 0, 0),
	)
	s := sessionByID(t, scanSessionRoot(root, 7), "s1")
	if s.AvgCtx != 200_000 || s.MaxCtx != 300_000 {
		t.Fatalf("avg/max ctx = %d/%d, want 200000/300000", s.AvgCtx, s.MaxCtx)
	}
}

func TestScanSessionUsageColdResumes(t *testing.T) {
	root := t.TempDir()
	t0 := time.Now().Add(-48 * time.Hour)
	writeJSONL(t, filepath.Join(root, "proj", "s1.jsonl"),
		asstLine("a1", t0, testOpus, "/w/proj", 1, 1, 0, 100_000, 0),
		asstLine("a2", t0.Add(59*time.Minute), testOpus, "/w/proj", 1, 1, 0, 80_000, 0),            // 59m idle: warm
		asstLine("a3", t0.Add(2*time.Hour), testOpus, "/w/proj", 1, 1, 0, 60_000, 0),               // 61m idle, big write: cold
		asstLine("a4", t0.Add(3*time.Hour+2*time.Minute), testOpus, "/w/proj", 1, 1, 0, 10_000, 0), // 62m idle, small write: not cold
	)
	s := sessionByID(t, scanSessionRoot(root, 7), "s1")
	if s.ColdResumes != 1 || s.ColdTokens != 60_000 {
		t.Fatalf("cold resumes/tokens = %d/%d, want 1/60000", s.ColdResumes, s.ColdTokens)
	}
}

func TestScanSessionUsageColdIgnoresSubagentTurns(t *testing.T) {
	root := t.TempDir()
	t0 := time.Now().Add(-48 * time.Hour)
	writeJSONL(t, filepath.Join(root, "proj", "s1.jsonl"),
		asstLine("a1", t0, testOpus, "/w/proj", 1, 1, 0, 100, 0),
		asstLine("a2", t0.Add(90*time.Minute), testOpus, "/w/proj", 1, 1, 0, 70_000, 0), // 90m after a1, but a subagent ran at 80m
	)
	writeJSONL(t, filepath.Join(root, "proj", "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", t0.Add(80*time.Minute), testSonnet, "/w/proj", 1, 1, 0, 100, 0),
	)
	s := sessionByID(t, scanSessionRoot(root, 7), "s1")
	if s.ColdResumes != 1 || s.ColdTokens != 70_000 {
		t.Fatalf("cold resumes/tokens = %d/%d, want 1/70000 (gap counts main turns only)", s.ColdResumes, s.ColdTokens)
	}
}

func TestScanSessionUsageTitleAndProject(t *testing.T) {
	root := t.TempDir()
	t0 := time.Now().Add(-48 * time.Hour)
	writeJSONL(t, filepath.Join(root, "p1", "titled.jsonl"),
		titleLine("first name"),
		asstLine("a1", t0, testOpus, `D:\work\arcterm`, 1, 1, 0, 0, 0),
		titleLine("  second name  "),
	)
	writeJSONL(t, filepath.Join(root, "p2", "untitled.jsonl"),
		asstLine("b1", t0, testOpus, `D:\work\arcterm\.waveterm\worktrees\abc\t-1`, 1, 1, 0, 0, 0),
	)
	sessions := scanSessionRoot(root, 7)
	titled := sessionByID(t, sessions, "titled")
	if titled.Title != "second name" || titled.Project != "arcterm" {
		t.Fatalf("titled = %q/%q, want %q/%q", titled.Title, titled.Project, "second name", "arcterm")
	}
	untitled := sessionByID(t, sessions, "untitled")
	if untitled.Title != "" || untitled.Project != "engine run" {
		t.Fatalf("untitled = %q/%q, want %q/%q", untitled.Title, untitled.Project, "", "engine run")
	}
}

func TestProjectOf(t *testing.T) {
	for cwd, want := range map[string]string{
		"":                     "",
		`D:\work\arcterm`:  "arcterm",
		`D:\work\arcterm\`: "arcterm",
		"/Users/me/code/app":   "app",
		`D:\work\arcterm\.waveterm\worktrees\abc`:     "engine run",
		`D:\work\arcterm\.waveterm\worktrees\abc\t-1`: "engine run",
		"/r/.waveterm/worktrees/abc-t-2":                  "engine run",
		`D:\work\arcterm\.waveterm\other`:             "other",
		`D:\work\arcterm\worktrees\abc`:               "abc",
	} {
		if got := projectOf(cwd); got != want {
			t.Errorf("projectOf(%q) = %q, want %q", cwd, got, want)
		}
	}
}

func TestClaudeSessionOf(t *testing.T) {
	root := filepath.Join("home", ".claude", "projects", "slug")
	for _, tc := range []struct {
		path    string
		session string
		sub     bool
	}{
		{filepath.Join(root, "s1.jsonl"), "s1", false},
		{filepath.Join(root, "s1", "subagents", "agent-a.jsonl"), "s1", true},
		{filepath.Join(root, "s1", "subagents", "agent-a", "subagents", "agent-b.jsonl"), "s1", true}, // nested bills to the top session
	} {
		session, sub := claudeSessionOf(tc.path)
		if session != tc.session || sub != tc.sub {
			t.Errorf("claudeSessionOf(%q) = %q/%v, want %q/%v", tc.path, session, sub, tc.session, tc.sub)
		}
	}
}

func TestScanSessionUsageDropsSyntheticAndOutOfWindow(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeJSONL(t, filepath.Join(root, "proj", "s1.jsonl"),
		asstLine("a1", now.Add(-48*time.Hour), testOpus, "/w/proj", 1, 1, 0, 0, 0),
		asstLine("a2", now.Add(-47*time.Hour), "<synthetic>", "/w/proj", 9, 9, 9, 9, 0),
		asstLine("a3", now.Add(-30*24*time.Hour), testOpus, "/w/proj", 9, 9, 9, 9, 0),
	)
	s := sessionByID(t, scanSessionRoot(root, 7), "s1")
	want := []SessionModelTokens{{Model: testOpus, Input: 1, Output: 1}}
	if s.Turns != 1 || !slices.Equal(s.Models, want) {
		t.Fatalf("turns/models = %d/%+v, want 1/%+v", s.Turns, s.Models, want)
	}
}

func TestScanSessionUsageDedupes(t *testing.T) {
	root := t.TempDir()
	line := asstLine("a1", time.Now().Add(-48*time.Hour), testOpus, "/w/proj", 5, 7, 100, 10, 4)
	writeJSONL(t, filepath.Join(root, "proj", "s1.jsonl"), line, line)
	s := sessionByID(t, scanSessionRoot(root, 7), "s1")
	want := []SessionModelTokens{{Model: testOpus, Input: 5, Output: 7, CacheRead: 100, CacheCreate: 10, CacheCreate1h: 4}}
	if s.Turns != 1 || !slices.Equal(s.Models, want) {
		t.Fatalf("turns/models = %d/%+v, want 1/%+v", s.Turns, s.Models, want)
	}
}

func TestScanSessionUsageSortsNewestFirst(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeJSONL(t, filepath.Join(root, "p", "old.jsonl"), asstLine("a1", now.Add(-72*time.Hour), testOpus, "/w/p", 1, 1, 0, 0, 0))
	writeJSONL(t, filepath.Join(root, "p", "new.jsonl"),
		asstLine("b1", now.Add(-48*time.Hour), testOpus, "/w/p", 1, 1, 0, 0, 0),
		asstLine("b2", now.Add(-24*time.Hour), testOpus, "/w/p", 1, 1, 0, 0, 0),
	)
	sessions := scanSessionRoot(root, 7)
	if len(sessions) != 2 || sessions[0].ID != "new" || sessions[1].ID != "old" {
		t.Fatalf("order = %+v", sessions)
	}
	if sessions[0].LastTs <= sessions[0].FirstTs || sessions[0].FirstTs == 0 {
		t.Fatalf("first/last = %d/%d", sessions[0].FirstTs, sessions[0].LastTs)
	}
}

func TestScanSessionUsageMatchesScanUsage(t *testing.T) {
	root := t.TempDir()
	t0 := time.Now().Add(-72 * time.Hour)
	writeJSONL(t, filepath.Join(root, "p1", "s1.jsonl"),
		titleLine("one"),
		asstLine("a1", t0, testOpus, "/w/p1", 5, 7, 100, 10, 4),
		asstLine("a2", t0.Add(2*time.Hour), testOpus, "/w/p1", 6, 8, 200, 20, 0),
		asstLine("a3", t0.Add(3*time.Hour), "<synthetic>", "/w/p1", 99, 99, 99, 99, 0),
	)
	writeJSONL(t, filepath.Join(root, "p1", "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", t0.Add(time.Hour), testSonnet, "/w/p1", 10, 20, 1000, 100, 50),
	)
	writeJSONL(t, filepath.Join(root, "p2", "s2.jsonl"),
		asstLine("c1", t0.Add(4*time.Hour), testSonnet, "/w/p2", 3, 4, 50, 60, 0),
	)
	none := filepath.Join(t.TempDir(), "none")
	var want SessionModelTokens
	for _, b := range scanRoots(root, none, none, none, none, 7) {
		want.Input += b.Input
		want.Output += b.Output
		want.CacheRead += b.CacheRead
		want.CacheCreate += b.CacheCreate
		want.CacheCreate1h += b.CacheCreate1h
	}
	var got SessionModelTokens
	for _, s := range scanSessionRoot(root, 7) {
		for _, m := range s.Models {
			got.Input += m.Input
			got.Output += m.Output
			got.CacheRead += m.CacheRead
			got.CacheCreate += m.CacheCreate
			got.CacheCreate1h += m.CacheCreate1h
		}
	}
	if got != want {
		t.Fatalf("session totals %+v differ from bucket totals %+v", got, want)
	}
	if want.Input == 0 {
		t.Fatal("corpus produced no tokens")
	}
}
