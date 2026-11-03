// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// writeCiteFile writes content at rel under dir (making its folders) and returns the full path.
func writeCiteFile(t *testing.T, dir, rel, content string) string {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return full
}

// rowsText is n lines, each "row 01 token-01": a unique token per line, so a quote names exactly one line.
func rowsText(n int) string {
	var b strings.Builder
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, "row %02d token-%02d\n", i, i)
	}
	return b.String()
}

func TestCheckEvidence(t *testing.T) {
	project := t.TempDir()
	attached := t.TempDir()
	writeCiteFile(t, project, "pkg/x/y.go", rowsText(20))
	writeCiteFile(t, project, "pkg/x/crlf.go", "alpha\r\nbeta gamma\r\ndelta\r\n")
	writeCiteFile(t, project, "pkg/x/empty.go", "")
	writeCiteFile(t, project, "pkg/x/spaced.go", "func main() {\n\tif   a  ==\tb {\n\t\treturn\n\t}\n}\n")
	writeCiteFile(t, project, "pkg/x/nonl.go", "one\ntwo")
	libFile := writeCiteFile(t, attached, "lib/z.go", rowsText(5))
	roots := []string{project, attached}

	type tc struct {
		name     string
		ev       CouncilEvidence
		roots    []string
		cite     string
		noteHas  string // the note holds this text; "" means the note is empty
		wantNote string // the note is exactly this, when set
	}
	cases := []tc{
		{name: "the file and line exist", ev: CouncilEvidence{Ref: "pkg/x/y.go:3"}, roots: roots, cite: CiteOK},
		{name: "the last line", ev: CouncilEvidence{Ref: "pkg/x/y.go:20"}, roots: roots, cite: CiteOK},
		{name: "a missing file", ev: CouncilEvidence{Ref: "pkg/x/nope.go:3"}, roots: roots, cite: CiteWrong, noteHas: "not found"},
		{name: "a line past the end", ev: CouncilEvidence{Ref: "pkg/x/y.go:900"}, roots: roots, cite: CiteWrong, wantNote: "line 900 is past the end (20 lines)"},
		{name: "the line just past the end", ev: CouncilEvidence{Ref: "pkg/x/y.go:21"}, roots: roots, cite: CiteWrong, wantNote: "line 21 is past the end (20 lines)"},
		{name: "a line of an empty file", ev: CouncilEvidence{Ref: "pkg/x/empty.go:1"}, roots: roots, cite: CiteWrong, wantNote: "line 1 is past the end (0 lines)"},
		{name: "line 0 is no line", ev: CouncilEvidence{Ref: "pkg/x/y.go:0"}, roots: roots, cite: CiteWrong, noteHas: "line 0"},
		{name: "a range", ev: CouncilEvidence{Ref: "pkg/x/y.go:2-5"}, roots: roots, cite: CiteOK},
		{name: "a range that runs past the end", ev: CouncilEvidence{Ref: "pkg/x/y.go:18-25"}, roots: roots, cite: CiteWrong, wantNote: "line 25 is past the end (20 lines)"},
		{name: "a backwards range reads as its two ends", ev: CouncilEvidence{Ref: "pkg/x/y.go:5-2"}, roots: roots, cite: CiteOK},
		{name: "a final line with no newline", ev: CouncilEvidence{Ref: "pkg/x/nonl.go:2"}, roots: roots, cite: CiteOK},
		{name: "one past a final line with no newline", ev: CouncilEvidence{Ref: "pkg/x/nonl.go:3"}, roots: roots, cite: CiteWrong, wantNote: "line 3 is past the end (2 lines)"},
		{name: "an L prefix on the line", ev: CouncilEvidence{Ref: "pkg/x/y.go:L3"}, roots: roots, cite: CiteOK},
		{name: "a column after the line", ev: CouncilEvidence{Ref: "pkg/x/y.go:3:7"}, roots: roots, cite: CiteOK},
		{name: "an L-prefixed range", ev: CouncilEvidence{Ref: "pkg/x/y.go:L2-L5"}, roots: roots, cite: CiteOK},

		{name: "a quote at the line", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "token-10"}, roots: roots, cite: CiteOK},
		{name: "a quote 3 lines below", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "token-13"}, roots: roots, cite: CiteOK},
		{name: "a quote 4 lines below", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "token-14"}, roots: roots, cite: CiteWrong, wantNote: "quote not found near line 10"},
		{name: "a quote 3 lines above", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "token-07"}, roots: roots, cite: CiteOK},
		{name: "a quote 4 lines above", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "token-06"}, roots: roots, cite: CiteWrong, wantNote: "quote not found near line 10"},
		{name: "a quote near the top of the file", ev: CouncilEvidence{Ref: "pkg/x/y.go:2", Quote: "token-05"}, roots: roots, cite: CiteOK},
		{name: "a quote 3 lines past a range's end", ev: CouncilEvidence{Ref: "pkg/x/y.go:5-8", Quote: "token-11"}, roots: roots, cite: CiteOK},
		{name: "a quote 4 lines past a range's end", ev: CouncilEvidence{Ref: "pkg/x/y.go:5-8", Quote: "token-12"}, roots: roots, cite: CiteWrong, wantNote: "quote not found near lines 5-8"},
		{name: "a quote 3 lines before a range's start", ev: CouncilEvidence{Ref: "pkg/x/y.go:5-8", Quote: "token-02"}, roots: roots, cite: CiteOK},
		{name: "a quote that is nowhere", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "no such text"}, roots: roots, cite: CiteWrong, noteHas: "quote not found"},
		{name: "a quote across two lines", ev: CouncilEvidence{Ref: "pkg/x/y.go:4", Quote: "token-04\nrow 05"}, roots: roots, cite: CiteOK},
		{name: "a quote with other whitespace", ev: CouncilEvidence{Ref: "pkg/x/spaced.go:2", Quote: "if a == b {"}, roots: roots, cite: CiteOK},
		{name: "a quote written with other whitespace in the file", ev: CouncilEvidence{Ref: "pkg/x/spaced.go:2", Quote: "if   a  ==\tb"}, roots: roots, cite: CiteOK},
		{name: "case counts", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "TOKEN-10"}, roots: roots, cite: CiteWrong, noteHas: "quote not found"},
		{name: "a quote of only whitespace is no quote", ev: CouncilEvidence{Ref: "pkg/x/y.go:10", Quote: "  \t "}, roots: roots, cite: CiteOK},
		{name: "a CRLF file", ev: CouncilEvidence{Ref: "pkg/x/crlf.go:2", Quote: "beta gamma"}, roots: roots, cite: CiteOK},
		{name: "a quote spanning CRLF lines", ev: CouncilEvidence{Ref: "pkg/x/crlf.go:1", Quote: "alpha beta"}, roots: roots, cite: CiteOK},

		{name: "a path above every root", ev: CouncilEvidence{Ref: "../../etc/passwd:1"}, roots: roots, cite: CiteWrong, noteHas: "outside"},
		{name: "an absolute path outside every root", ev: CouncilEvidence{Ref: filepath.Join(filepath.Dir(project), "elsewhere", "f.go") + ":1"}, roots: roots, cite: CiteWrong, noteHas: "outside"},
		{name: "an absolute path inside the project", ev: CouncilEvidence{Ref: filepath.Join(project, "pkg", "x", "y.go") + ":3"}, roots: roots, cite: CiteOK},
		{name: "an absolute path inside the project, missing", ev: CouncilEvidence{Ref: filepath.Join(project, "pkg", "x", "gone.go") + ":3"}, roots: roots, cite: CiteWrong, noteHas: "not found"},
		{name: "an absolute path into an attached folder", ev: CouncilEvidence{Ref: libFile + ":2", Quote: "token-02"}, roots: roots, cite: CiteOK},
		{name: "a relative path found only under an attached folder", ev: CouncilEvidence{Ref: "lib/z.go:5"}, roots: roots, cite: CiteOK},
		{name: "an attached folder's file without that root", ev: CouncilEvidence{Ref: libFile + ":2"}, roots: []string{project}, cite: CiteWrong, noteHas: "outside"},
		{name: "an attached file as a root", ev: CouncilEvidence{Ref: libFile + ":2"}, roots: []string{project, libFile}, cite: CiteOK},
		{name: "another file next to an attached file root", ev: CouncilEvidence{Ref: filepath.Join(filepath.Dir(libFile), "other.go") + ":2"}, roots: []string{project, libFile}, cite: CiteWrong, noteHas: "outside"},
		{name: "a folder, not a file", ev: CouncilEvidence{Ref: "pkg/x:3"}, roots: roots, cite: CiteWrong, noteHas: "folder"},

		{name: "a bare path that exists", ev: CouncilEvidence{Ref: "pkg/x/y.go"}, roots: roots, cite: CiteOK},
		{name: "a bare path that is missing", ev: CouncilEvidence{Ref: "pkg/x/nope.go"}, roots: roots, cite: CiteWrong, noteHas: "not found"},
		{name: "a bare path with a quote anywhere in the file", ev: CouncilEvidence{Ref: "pkg/x/y.go", Quote: "token-17"}, roots: roots, cite: CiteOK},
		{name: "a bare path with a quote not in the file", ev: CouncilEvidence{Ref: "pkg/x/y.go", Quote: "token-99"}, roots: roots, cite: CiteWrong, noteHas: "quote not found"},

		{name: "a screenshot is left unchecked", ev: CouncilEvidence{Ref: "screenshot:home.png#header"}, roots: roots, cite: ""},
		{name: "a screenshot with a quote is still unchecked", ev: CouncilEvidence{Ref: "screenshot:home.png#header", Quote: "x"}, roots: roots, cite: ""},
		{name: "an empty ref is left unchecked", ev: CouncilEvidence{Weak: true, Note: "cites no evidence"}, roots: roots, cite: ""},
		{name: "a link is left unchecked", ev: CouncilEvidence{Ref: "https://example.com:8080/x"}, roots: roots, cite: ""},
		{name: "no roots means nothing to check against", ev: CouncilEvidence{Ref: "pkg/x/y.go:3"}, roots: nil, cite: ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := CheckEvidence([]CouncilEvidence{c.ev}, c.roots)
			if len(got) != 1 {
				t.Fatalf("CheckEvidence returned %d items, want 1", len(got))
			}
			if got[0].Cite != c.cite {
				t.Errorf("Cite = %q (%q), want %q", got[0].Cite, got[0].CiteNote, c.cite)
			}
			switch {
			case c.wantNote != "":
				if got[0].CiteNote != c.wantNote {
					t.Errorf("CiteNote = %q, want %q", got[0].CiteNote, c.wantNote)
				}
			case c.noteHas != "":
				if !strings.Contains(got[0].CiteNote, c.noteHas) {
					t.Errorf("CiteNote = %q, want it to hold %q", got[0].CiteNote, c.noteHas)
				}
			case got[0].CiteNote != "":
				t.Errorf("CiteNote = %q, want none", got[0].CiteNote)
			}
			if got[0].Ref != c.ev.Ref || got[0].Quote != c.ev.Quote || got[0].Weak != c.ev.Weak || got[0].Note != c.ev.Note {
				t.Errorf("CheckEvidence changed more than the check: %+v became %+v", c.ev, got[0])
			}
		})
	}
}

func TestCheckEvidenceKeepsOrderAndDoesNotTouchItsInput(t *testing.T) {
	project := t.TempDir()
	writeCiteFile(t, project, "a.go", rowsText(5))
	in := []CouncilEvidence{
		{Ref: "a.go:1"},
		{Ref: "screenshot:s.png#x"},
		{Ref: "missing.go:1"},
		{Weak: true, Note: "cites no evidence"},
	}
	before := append([]CouncilEvidence(nil), in...)
	got := CheckEvidence(in, []string{project})
	if !reflect.DeepEqual(in, before) {
		t.Errorf("CheckEvidence wrote to its input: %+v, was %+v", in, before)
	}
	wantCites := []string{CiteOK, "", CiteWrong, ""}
	if len(got) != len(wantCites) {
		t.Fatalf("got %d items, want %d", len(got), len(wantCites))
	}
	for i, w := range wantCites {
		if got[i].Cite != w || got[i].Ref != in[i].Ref {
			t.Errorf("item %d = %+v, want ref %q and cite %q", i, got[i], in[i].Ref, w)
		}
	}
	if out := CheckEvidence(nil, []string{project}); out != nil {
		t.Errorf("CheckEvidence(nil) = %+v, want nil", out)
	}
	if out := CheckEvidence([]CouncilEvidence{}, []string{project}); len(out) != 0 {
		t.Errorf("CheckEvidence(empty) = %+v, want empty", out)
	}
}

// the check is run again after each reply pass: a second run starts from scratch, so a file that appeared since turns a
// wrong cite ok, and a cite whose ref cannot be checked loses a mark an earlier run left on it
func TestCheckEvidenceRunsAgainFromScratch(t *testing.T) {
	project := t.TempDir()
	first := CheckEvidence([]CouncilEvidence{{Ref: "late.go:1"}, {Ref: "screenshot:s.png#x", Cite: CiteOK, CiteNote: "stale"}}, []string{project})
	if first[0].Cite != CiteWrong {
		t.Fatalf("before the file exists, Cite = %q, want %q", first[0].Cite, CiteWrong)
	}
	if first[1].Cite != "" || first[1].CiteNote != "" {
		t.Errorf("a screenshot kept an earlier mark: %+v", first[1])
	}
	writeCiteFile(t, project, "late.go", "x\n")
	second := CheckEvidence(first, []string{project})
	if second[0].Cite != CiteOK || second[0].CiteNote != "" {
		t.Errorf("after the file exists, got %+v, want ok with no note", second[0])
	}
}

func TestLabelOf(t *testing.T) {
	ok := CouncilEvidence{Ref: "a.go:1", Cite: CiteOK}
	wrong := CouncilEvidence{Ref: "b.go:1", Cite: CiteWrong, CiteNote: "file not found"}
	unchecked := CouncilEvidence{Ref: "screenshot:s.png#x"}
	ranPass := CouncilRun{Command: "go test ./pkg/x -run TestA", Expect: RunPass, State: RunPass, Matched: true}
	ranFail := CouncilRun{Command: "go test ./pkg/x -run TestB", Expect: RunFail, State: RunFail, Matched: true}
	wrongPass := CouncilRun{Command: "go test ./pkg/x -run TestC", Expect: RunFail, State: RunPass}
	wrongFail := CouncilRun{Command: "go test ./pkg/x -run TestD", Expect: RunPass, State: RunFail}
	timedOut := CouncilRun{Command: "go test ./pkg/x -run TestE", Expect: RunFail, State: RunNotRun, Reason: "timed out after 3 min"}
	offList := CouncilRun{Command: "rm -rf /", Expect: RunPass, State: RunNotRun, Reason: "not on the list"}
	pending := CouncilRun{Command: "go test ./pkg/x -run TestF", Expect: RunPass}

	for _, c := range []struct {
		name string
		ev   []CouncilEvidence
		runs []CouncilRun
		want string
	}{
		{"nothing at all", nil, nil, LabelGuess},
		{"only a wrong cite", []CouncilEvidence{wrong}, nil, LabelGuess},
		{"only an unchecked cite", []CouncilEvidence{unchecked}, nil, LabelGuess},
		{"one cite that holds", []CouncilEvidence{ok}, nil, LabelRead},
		{"mixed cites read as read", []CouncilEvidence{wrong, ok, unchecked}, nil, LabelRead},
		{"a run that passed as expected", nil, []CouncilRun{ranPass}, LabelRan},
		{"a run that failed as expected", nil, []CouncilRun{ranFail}, LabelRan},
		{"a pass the expert expected to fail", nil, []CouncilRun{wrongPass}, LabelDisproved},
		{"a fail the expert expected to pass", nil, []CouncilRun{wrongFail}, LabelDisproved},
		{"ran beats read", []CouncilEvidence{ok}, []CouncilRun{ranPass}, LabelRan},
		{"disproved beats read", []CouncilEvidence{ok}, []CouncilRun{wrongPass}, LabelDisproved},
		{"disproved beats a run that matched", nil, []CouncilRun{ranPass, wrongFail}, LabelDisproved},
		{"disproved beats a run that matched, in the other order", nil, []CouncilRun{wrongFail, ranPass}, LabelDisproved},
		{"a run that timed out, expecting fail, with no cites", nil, []CouncilRun{timedOut}, LabelGuess},
		{"a run that timed out, expecting fail, with a cite", []CouncilEvidence{ok}, []CouncilRun{timedOut}, LabelRead},
		{"a command off the list", []CouncilEvidence{ok}, []CouncilRun{offList}, LabelRead},
		{"a not-run run beside a run that matched", nil, []CouncilRun{timedOut, ranPass}, LabelRan},
		{"a request nothing handled", []CouncilEvidence{ok}, []CouncilRun{pending}, LabelRead},
		{"a request nothing handled, no cites", nil, []CouncilRun{pending}, LabelGuess},
		{"matched is read from the state and the expectation", nil, []CouncilRun{{Command: "c", Expect: RunPass, State: RunPass}}, LabelRan},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := LabelOf(c.ev, c.runs); got != c.want {
				t.Errorf("LabelOf = %q, want %q", got, c.want)
			}
		})
	}
}

func TestApplyChecks(t *testing.T) {
	projA := t.TempDir()
	projB := t.TempDir() // a second seat's own working directory
	writeCiteFile(t, projA, "pkg/a.go", rowsText(10))
	writeCiteFile(t, projB, "only/b.go", rowsText(10))
	attached := t.TempDir()
	writeCiteFile(t, attached, "att.go", rowsText(3))

	rootsFor := func(id string) []string {
		if id == "seatB" {
			return []string{projB}
		}
		return []string{projA, attached}
	}

	build := func(mode string) *Council {
		return &Council{
			Mode: mode,
			Proposals: []CouncilProposal{
				{Id: "P1", Author: "ux", Evidence: []CouncilEvidence{{Ref: "pkg/a.go:3", Quote: "token-03"}, {Ref: "pkg/gone.go:1"}}},
				{Id: "P2", Author: "ram", Evidence: []CouncilEvidence{{Weak: true, Note: "cites no evidence"}}},
				{Id: "P3", Author: "ux", Draft: DraftHeld, Evidence: []CouncilEvidence{{Ref: "pkg/a.go:1"}}},
				{Id: "P4", Author: "ux", Draft: DraftDropped, Evidence: []CouncilEvidence{{Ref: "pkg/a.go:1"}}},
				{Id: "P5", Author: "ram", Evidence: []CouncilEvidence{{Ref: "att.go:2"}},
					Runs: []CouncilRun{{Command: "go test ./pkg -run TestA", Expect: RunFail, State: RunPass}}},
				{Id: "P6", Author: "ram", Evidence: []CouncilEvidence{{Ref: "pkg/a.go:1"}},
					Runs: []CouncilRun{{Command: "go test ./pkg -run TestB", Expect: RunPass, State: RunPass, Matched: true}}},
				{Id: "P7", Author: "seatB", Evidence: []CouncilEvidence{{Ref: "only/b.go:4"}}},
				{Id: "P8", Author: "ux", Evidence: []CouncilEvidence{{Ref: "only/b.go:4"}}},
			},
			Replies: []CouncilReply{
				{Id: "r1", ProposalId: "P1", Author: "ram", Stance: StanceAccept, Evidence: []CouncilEvidence{{Ref: "pkg/a.go:5"}}},
				{Id: "r2", ProposalId: "P1", Author: "ram", Stance: StanceChallenge, Evidence: []CouncilEvidence{{Ref: "pkg/nowhere.go:5"}}},
				{Id: "r3", ProposalId: "P1", Author: "ux", Evidence: []CouncilEvidence{{Ref: "pkg/a.go:5"}}}, // a plain reply
				{Id: "r4", ProposalId: "P7", Author: "ux", Stance: StanceOppose},
				{Id: "r5", ProposalId: "P7", Author: "seatB", Stance: StanceAccept, Evidence: []CouncilEvidence{{Ref: "only/b.go:2"}}},
				{Id: "r6", ProposalId: "P1", Author: YouId, Evidence: []CouncilEvidence{{Ref: "pkg/a.go:5"}}},
			},
		}
	}

	t.Run("a review", func(t *testing.T) {
		c := build("")
		ApplyChecks(c, rootsFor)

		wantP := map[string]string{
			"P1": LabelRead,      // one cite holds, one is wrong
			"P2": LabelGuess,     // cites nothing
			"P3": "",             // a held draft is not sent
			"P4": "",             // a dropped draft is not sent
			"P5": LabelDisproved, // a run contradicted the expert; the cite into the attached folder holds too
			"P6": LabelRan,
			"P7": LabelRead, // seatB's own working directory
			"P8": LabelGuess,
		}
		for _, p := range c.Proposals {
			if p.Label != wantP[p.Id] {
				t.Errorf("%s Label = %q, want %q", p.Id, p.Label, wantP[p.Id])
			}
		}
		p1 := c.Proposals[0]
		if p1.Evidence[0].Cite != CiteOK || p1.Evidence[1].Cite != CiteWrong {
			t.Errorf("P1 cites = %q, %q; want ok, wrong (the wrong one stays on its own chip)", p1.Evidence[0].Cite, p1.Evidence[1].Cite)
		}
		if p1.Evidence[1].CiteNote == "" {
			t.Error("P1's wrong cite has no note")
		}
		if got := c.Proposals[1].Evidence[0].Cite; got != "" {
			t.Errorf("an evidence item with no ref got Cite %q", got)
		}
		if got := c.Proposals[2].Evidence[0].Cite; got != "" {
			t.Errorf("a held proposal's cite was checked: %q", got)
		}
		if got := c.Proposals[3].Evidence[0].Cite; got != "" {
			t.Errorf("a dropped proposal's cite was checked: %q", got)
		}
		if got := c.Proposals[4].Evidence[0].Cite; got != CiteOK {
			t.Errorf("a cite into an attached folder = %q, want ok", got)
		}
		if got := c.Proposals[6].Evidence[0].Cite; got != CiteOK {
			t.Errorf("seatB's cite in its own directory = %q, want ok", got)
		}
		if got := c.Proposals[7].Evidence[0].Cite; got != CiteWrong {
			t.Errorf("a cite into seatB's directory by another seat = %q, want wrong", got)
		}

		wantR := map[string]string{
			"r1": LabelRead,
			"r2": LabelGuess, // the only cite is wrong
			"r3": "",         // a plain reply
			"r4": LabelGuess, // a stance with no evidence
			"r5": LabelRead,
			"r6": "", // the person's own
		}
		for _, r := range c.Replies {
			if r.Label != wantR[r.Id] {
				t.Errorf("%s Label = %q, want %q", r.Id, r.Label, wantR[r.Id])
			}
		}
		if got := c.Replies[0].Evidence[0].Cite; got != CiteOK {
			t.Errorf("r1 cite = %q, want ok", got)
		}
		if got := c.Replies[1].Evidence[0].Cite; got != CiteWrong {
			t.Errorf("r2 cite = %q, want wrong", got)
		}
		if got := c.Replies[2].Evidence[0].Cite; got != "" {
			t.Errorf("a plain reply's cite was checked: %q", got)
		}
		if got := c.Replies[5].Evidence[0].Cite; got != "" {
			t.Errorf("the person's reply was checked: %q", got)
		}
	})

	t.Run("a second run changes nothing", func(t *testing.T) {
		c := build(ModeReview)
		ApplyChecks(c, rootsFor)
		once := build(ModeReview)
		ApplyChecks(once, rootsFor)
		ApplyChecks(c, rootsFor)
		if !reflect.DeepEqual(c, once) {
			t.Errorf("ApplyChecks twice differs from once")
		}
	})

	t.Run("a brainstorm is left alone", func(t *testing.T) {
		c := build(ModeBrainstorm)
		want := build(ModeBrainstorm)
		ApplyChecks(c, rootsFor)
		if !reflect.DeepEqual(c, want) {
			t.Errorf("a Brainstorm council was changed by ApplyChecks")
		}
		for _, p := range c.Proposals {
			if p.Label != "" {
				t.Errorf("%s has Label %q in a Brainstorm", p.Id, p.Label)
			}
		}
	})

	t.Run("a nil council and a nil roots function", func(t *testing.T) {
		ApplyChecks(nil, rootsFor)
		c := build("")
		ApplyChecks(c, nil) // nothing can be checked: every cite stays unchecked, the labels still follow from the runs
		for _, p := range c.Proposals {
			for _, e := range p.Evidence {
				if e.Cite != "" {
					t.Errorf("%s: a cite was checked with no roots: %+v", p.Id, e)
				}
			}
		}
		if got := c.Proposals[4].Label; got != LabelDisproved {
			t.Errorf("P5 Label = %q with no roots, want %q from its run", got, LabelDisproved)
		}
		if got := c.Proposals[5].Label; got != LabelRan {
			t.Errorf("P6 Label = %q with no roots, want %q from its run", got, LabelRan)
		}
	})
}
