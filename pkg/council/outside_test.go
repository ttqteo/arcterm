// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// useMtimes makes fileMtime read the times in at (by path) and no diff be found, for the test's length.
func useMtimes(t *testing.T, at map[string]int64) {
	t.Helper()
	prevMtime, prevDiff := fileMtime, fileDiff
	fileMtime = func(path string) int64 { return at[path] }
	fileDiff = func(context.Context, *Council, string) string { return "" }
	t.Cleanup(func() { fileMtime, fileDiff = prevMtime, prevDiff })
}

// reportedCouncil is a done council in a real project folder, with a report written at 1000 and the files given, each
// written with its text.
func reportedCouncil(t *testing.T, files map[string]string) *Council {
	t.Helper()
	dir := t.TempDir()
	c := fixtureCouncil("c1", StateDone, 3)
	c.Project, c.Files = dir, nil
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		c.Files = append(c.Files, name)
	}
	c.Summary = &CouncilSummary{Text: "s", Answer: "Do P1 first.", Directions: []CouncilDirection{{Title: "Do P1"}}, At: 1000}
	c.Replies = append(c.Replies, CouncilReply{Id: "r3", Author: YouId, Text: "Still right?", To: []string{"ux"}, Round: 4, Ts: 2000})
	return c
}

func TestAnswersPromptCarriesTheFilesChangedSinceTheReport(t *testing.T) {
	big := strings.Repeat("x", preReadFileCap+10)
	c := reportedCouncil(t, map[string]string{"notes.md": "One endpoint now.", "old.md": "untouched", "big.html": big})
	useMtimes(t, map[string]int64{
		filepath.Join(c.Project, "notes.md"): 1500, // after the report
		filepath.Join(c.Project, "old.md"):   500,  // before it
		filepath.Join(c.Project, "big.html"): 1800,
	})
	e, _ := seatOf(c, "ux")
	replies := []CouncilReply{c.Replies[len(c.Replies)-1]}
	p := AnswersPrompt(c, e, replies)
	for _, want := range []string{"## Files changed since the report", changedFilesNote, "### notes.md", "One endpoint now.", "- big.html (not inlined: over 48 KB"} {
		if !strings.Contains(p, want) {
			t.Errorf("the answers prompt misses %q", want)
		}
	}
	if strings.Contains(p, "untouched") {
		t.Error("a file unchanged since the report is inlined")
	}
	if tools, _ := answerReads(c, replies); !tools {
		t.Error("a changed file too big to inline: want the read-only tools on")
	}
	if !strings.Contains(p, readWhenNeeded) {
		t.Error("the prompt of a call with tools does not say it has them")
	}
}

func TestAnswersPromptWithNoFileChangedIsAsBefore(t *testing.T) {
	c := reportedCouncil(t, map[string]string{"notes.md": "Two endpoints."})
	useMtimes(t, map[string]int64{filepath.Join(c.Project, "notes.md"): 900})
	e, _ := seatOf(c, "ux")
	replies := []CouncilReply{c.Replies[len(c.Replies)-1]}
	if p := AnswersPrompt(c, e, replies); strings.Contains(p, "Files changed since the report") {
		t.Error("no file changed after the report, yet the prompt has the section")
	}
	if tools, _ := answerReads(c, replies); tools {
		t.Error("no file changed and no reply asked to read: want no tools")
	}
	// a changed file that fits is inlined, and needs no tools
	useMtimes(t, map[string]int64{filepath.Join(c.Project, "notes.md"): 1100})
	if tools, _ := answerReads(c, replies); tools {
		t.Error("a changed file that fits the prompt: want no tools")
	}
}

func outsideRunner(t *testing.T, c *Council, turns []OutsideTurn, reply string) (*Runner, *routerCaller, *[]int64) {
	t.Helper()
	useTempRoot(t)
	if err := Save(c); err != nil {
		t.Fatal(err)
	}
	f := &routerCaller{res: CallRes{Text: reply, Tokens: 40}}
	var asked []int64
	r := &Runner{Caller: f, Now: func() int64 { return 5000 }, Outside: func(_ *Council, since int64) []OutsideTurn {
		asked = append(asked, since)
		return turns
	}}
	return r, f, &asked
}

func TestRefreshOutsideClosesWhatThePersonSettledInTheAgent(t *testing.T) {
	c := reportedCouncil(t, map[string]string{"notes.md": "x"})
	useMtimes(t, nil)
	m := MemoryOf(c)
	_, _ = m.AddEntry(CouncilMemoryEntry{Kind: EntryOpen, Text: "Two endpoints or one?", By: EntryByAuto}, 1100)
	_, _ = m.AddEntry(CouncilMemoryEntry{Kind: EntryAgreed, Text: "The spec still says 136.", By: EntryByAuto}, 1100)
	turns := []OutsideTurn{
		{Role: "user", Text: "Merge them into one endpoint.", Ts: 3000},
		{Role: "assistant", Text: "Done: the API has one endpoint.", Ts: 3100},
	}
	reply := `{"change": false, "entries": [{"op": "drop", "entry": "m1"}, {"op": "add", "kind": "agreed", "text": "One endpoint."}]}`
	r, f, asked := outsideRunner(t, c, turns, reply)

	r.refreshOutside(context.Background(), nil, "c1")

	if len(*asked) != 1 || (*asked)[0] != 1000 {
		t.Fatalf("Outside read from %v, want once from the report's 1000", *asked)
	}
	if len(f.reqs) != 1 || f.reqs[0].Tools || f.reqs[0].Expert.Model != ModelRouter {
		t.Fatalf("calls = %+v, want one no-tools check", f.reqs)
	}
	p := f.reqs[0].Prompt
	for _, want := range []string{"[m1] Two endpoints or one?", "- the person: Merge them into one endpoint.", "- the agent: Done: the API has one endpoint."} {
		if !strings.Contains(p, want) {
			t.Errorf("the refresh prompt misses %q", want)
		}
	}
	got, _ := Load("c1")
	var texts []string
	for _, e := range got.Memory.Entries {
		texts = append(texts, e.Id+":"+e.Kind+":"+e.Text)
	}
	if strings.Join(texts, "|") != "m2:agreed:The spec still says 136.|m3:agreed:One endpoint." {
		t.Errorf("entries = %v, want m1 dropped and the answer added", texts)
	}
	if got.Memory.OutsideAt != 5000 || got.Calls != c.Calls+1 || got.Tokens != c.Tokens+40 {
		t.Errorf("outsideat %d calls %d tokens %d, want 5000 and the call booked", got.Memory.OutsideAt, got.Calls, got.Tokens)
	}

	// the next pass reads from the refresh on, and with nothing new makes no call
	*asked = nil
	turnsNone := r.Outside
	r.Outside = func(cc *Council, since int64) []OutsideTurn { turnsNone(cc, since); return nil }
	r.refreshOutside(context.Background(), nil, "c1")
	if len(*asked) != 1 || (*asked)[0] != 5000 || len(f.reqs) != 1 {
		t.Errorf("second refresh read from %v with %d calls, want from 5000 and no new call", *asked, len(f.reqs))
	}
}

func TestRefreshOutsideReadsChangedFilesWithNoAgentSession(t *testing.T) {
	c := reportedCouncil(t, map[string]string{"spec.md": "141"})
	useMtimes(t, map[string]int64{filepath.Join(c.Project, "spec.md"): 4000})
	fileDiff = func(context.Context, *Council, string) string { return "-136\n+141" }
	r, f, _ := outsideRunner(t, c, nil, `{"change": false}`)

	r.refreshOutside(context.Background(), nil, "c1")

	if len(f.reqs) != 1 {
		t.Fatalf("%d calls, want the one refresh for the changed file", len(f.reqs))
	}
	if p := f.reqs[0].Prompt; !strings.Contains(p, "### spec.md, against the version the council read") || !strings.Contains(p, "+141") {
		t.Errorf("the refresh prompt does not carry the file's diff:\n%s", p)
	}
}

func TestRefreshOutsideMakesNoCall(t *testing.T) {
	t.Run("nothing outside", func(t *testing.T) {
		c := reportedCouncil(t, map[string]string{"a.md": "x"})
		useMtimes(t, nil)
		r, f, _ := outsideRunner(t, c, nil, `{"change": false}`)
		r.refreshOutside(context.Background(), nil, "c1")
		if len(f.reqs) != 0 {
			t.Errorf("%d calls, want none", len(f.reqs))
		}
	})
	t.Run("no report yet", func(t *testing.T) {
		c := reportedCouncil(t, map[string]string{"a.md": "x"})
		c.Summary = nil
		useMtimes(t, nil)
		r, f, asked := outsideRunner(t, c, []OutsideTurn{{Role: "user", Text: "hi", Ts: 3000}}, `{"change": false}`)
		r.refreshOutside(context.Background(), nil, "c1")
		if len(f.reqs)+len(*asked) != 0 {
			t.Errorf("a council with no report: %d calls, %d reads, want none", len(f.reqs), len(*asked))
		}
	})
	t.Run("no Outside", func(t *testing.T) {
		c := reportedCouncil(t, map[string]string{"a.md": "x"})
		useMtimes(t, map[string]int64{filepath.Join(c.Project, "a.md"): 4000})
		r, f, _ := outsideRunner(t, c, nil, `{"change": false}`)
		r.Outside = nil
		r.refreshOutside(context.Background(), nil, "c1")
		if len(f.reqs) != 0 {
			t.Errorf("%d calls, want none from a runner with no Outside", len(f.reqs))
		}
	})
}

func TestRefreshOutsideFailureKeepsTheSpan(t *testing.T) {
	c := reportedCouncil(t, map[string]string{"a.md": "x"})
	useMtimes(t, nil)
	r, _, _ := outsideRunner(t, c, []OutsideTurn{{Role: "user", Text: "hi", Ts: 3000}}, "no json here")
	r.refreshOutside(context.Background(), nil, "c1")
	got, _ := Load("c1")
	if got.Memory != nil && got.Memory.OutsideAt != 0 {
		t.Errorf("outsideat = %d after a failed refresh, want 0 so the next pass reads the span again", got.Memory.OutsideAt)
	}
	if got.Calls != c.Calls+1 {
		t.Errorf("calls = %d, want the failed call booked", got.Calls)
	}
}

func TestParseOutsideCheckTakesMoreChangesThanARound(t *testing.T) {
	var parts []string
	for _, id := range []string{"m1", "m2", "m3", "m4", "m5", "m6", "m7"} {
		parts = append(parts, `{"op":"drop","entry":"`+id+`"}`)
	}
	got, err := parseOutsideCheck(`{"change":false,"entries":[`+strings.Join(parts, ",")+`]}`, []string{"m1", "m2", "m3", "m4", "m5", "m6", "m7"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Entries) != outsideChanges {
		t.Errorf("%d changes kept, want %d", len(got.Entries), outsideChanges)
	}
}
