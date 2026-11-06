// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func reasonClock(t *testing.T, now time.Time) {
	t.Helper()
	old := evidenceNow
	evidenceNow = func() time.Time { return now }
	t.Cleanup(func() { evidenceNow = old })
}

func TestReason_judgeSaw(t *testing.T) {
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local)
	reasonClock(t, now)
	agents := filepath.Join("proj", "AGENTS.md")
	docs := map[string]string{agents: "intro\nRun `task check:ts` to typecheck.\nmore\nAlso task check:ts before a commit.\n"}
	m := Memory{
		Name: "tc.md", Body: "Typecheck with `task check:ts`, never npx tsc.",
		Touched: time.Date(2026, 10, 7, 0, 0, 0, 0, time.Local).UnixMilli(),
	}
	verdict, lines := Reason(m, 1149, docs, true)
	want := "Read in none of 1,149 sessions since Oct 7, and AGENTS.md names the same command in 2 places. " +
		"The judge saw this version beside AGENTS.md and proposed nothing."
	if verdict != want {
		t.Fatalf("verdict\n got %q\nwant %q", verdict, want)
	}
	if len(lines) != 2 {
		t.Fatalf("want 2 doc lines, got %+v", lines)
	}
}

func TestReason_notSeen(t *testing.T) {
	reasonClock(t, time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local))
	docs := map[string]string{
		filepath.Join("proj", "AGENTS.md"): "nothing relevant here\n",
		filepath.Join("proj", "CLAUDE.md"): "nor here\n",
	}
	m := Memory{Name: "x.md", Body: "Use `wavesrv-launcher` for the thing.", Reads: 4}
	verdict, lines := Reason(m, 1149, docs, false)
	want := "Read in 4 of 1,149 sessions; nothing in AGENTS.md or CLAUDE.md names what it names."
	if verdict != want {
		t.Fatalf("verdict\n got %q\nwant %q", verdict, want)
	}
	if strings.Contains(verdict, "judge") {
		t.Fatalf("names the judge without judgeSaw: %q", verdict)
	}
	if lines == nil || len(lines) != 0 {
		t.Fatalf("want an empty, non-nil slice, got %#v", lines)
	}
}

func TestReason_signals(t *testing.T) {
	reasonClock(t, time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local))
	m := Memory{
		Name: "s.md", Body: "plain words",
		Touched: time.Date(2026, 9, 1, 0, 0, 0, 0, time.Local).UnixMilli(),
		Evidence: []wshrpc.MemEvidence{
			{Tone: evidenceToneWarn, Text: "Names a file that is gone: ", Code: "pkg/old.go"},
			{Tone: evidenceToneNone, Text: "Dated claim: since 07-01, 128 days ago"},
		},
	}
	verdict, _ := Reason(m, 0, nil, false)
	want := "Untouched for 66 days, since Sep 1. It names pkg/old.go, which is gone. It makes a dated claim: since 07-01, 128 days ago."
	if verdict != want {
		t.Fatalf("verdict\n got %q\nwant %q", verdict, want)
	}
	m.Evidence = []wshrpc.MemEvidence{{Tone: evidenceToneOK, Text: "What it names still exists: ", Code: "a.go"}}
	m.Touched = 0
	if verdict, _ := Reason(m, 0, nil, false); verdict != "What it names still exists." {
		t.Fatalf("verdict %q", verdict)
	}
}

func TestReason_docLines(t *testing.T) {
	reasonClock(t, time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local))
	doc := filepath.Join("proj", "AGENTS.md")
	var b strings.Builder
	b.WriteString("header\n")                                     // 1
	b.WriteString("  Run `task check:ts` before committing.  \n") // 2
	for i := 0; i < 11; i++ {                                     // 3..13: "common" in 11 lines
		fmt.Fprintf(&b, "common line %d\n", i)
	}
	b.WriteString("see frontend/app/store/keybindings.ts\n")                      // 14
	b.WriteString("the git tool, git again\n")                                    // 15: "git" is short
	b.WriteString("scripts/verify.mjs runs it\n")                                 // 16
	b.WriteString("pkg/memhygiene/check.go too\n")                                // 17
	b.WriteString("task check:ts again with frontend/app/store/keybindings.ts\n") // 18: listed once
	b.WriteString("one more pkg/memhygiene/check.go\n")                           // 19
	b.WriteString("and scripts/verify.mjs\n")                                     // 20
	docs := map[string]string{doc: b.String()}
	m := Memory{Name: "d.md", Body: "Use `git`, `common`, `task check:ts`, frontend/app/store/keybindings.ts, " +
		"pkg/memhygiene/check.go and scripts/verify.mjs."}
	_, lines := Reason(m, 0, docs, false)
	got := make([]string, len(lines))
	for i, l := range lines {
		got[i] = fmt.Sprintf("%s:%d", filepath.Base(l.Doc), l.Line)
		if l.Doc != doc {
			t.Fatalf("doc is %q, want the doc's path %q", l.Doc, doc)
		}
	}
	// longest first: keybindings.ts (14, 18), check.go (17, 19), then verify.mjs (16, cap reached)
	want := "AGENTS.md:14,AGENTS.md:18,AGENTS.md:17,AGENTS.md:19,AGENTS.md:16"
	if strings.Join(got, ",") != want {
		t.Fatalf("doc lines\n got %s\nwant %s", strings.Join(got, ","), want)
	}
	if lines[0].Text != "see frontend/app/store/keybindings.ts" {
		t.Fatalf("text not the trimmed line: %q", lines[0].Text)
	}
	for _, l := range lines {
		if strings.HasPrefix(l.Text, "common") || strings.Contains(l.Text, "git tool") {
			t.Fatalf("listed a line for an ignored token: %+v", l)
		}
	}
}

func TestReason_docLinesTrimmedText(t *testing.T) {
	reasonClock(t, time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local))
	doc := filepath.Join("proj", "CLAUDE.md")
	docs := map[string]string{doc: "a\r\n   Never run `task install` yourself.  \r\n"}
	_, lines := Reason(Memory{Name: "i.md", Body: "Don't `task install`."}, 0, docs, false)
	if len(lines) != 1 || lines[0].Line != 2 || lines[0].Text != "Never run `task install` yourself." {
		t.Fatalf("lines %+v", lines)
	}
}

func TestReviewChanges_notJudgedSaysNothingOfTheJudge(t *testing.T) {
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local)
	reasonClock(t, now)
	m := Memory{Name: "old.md", Sha256: "abc", Body: "rule", Touched: now.Add(-40 * 24 * time.Hour).UnixMilli()}
	inv := &Inventory{Folder: "f", Memories: []Memory{m}}
	seen := map[string]string{"old.md": checkFingerprint(m)}

	notJudged := ReviewChanges(inv, nil, false, now, nil, seen)
	if len(notJudged) != 1 || strings.Contains(notJudged[0].Verdict, "judge") {
		t.Fatalf("not judged: %+v", notJudged)
	}
	judged := ReviewChanges(inv, nil, true, now, nil, seen)
	if len(judged) != 1 || !strings.Contains(judged[0].Verdict, "The judge saw this version") {
		t.Fatalf("judged: %+v", judged)
	}
	other := ReviewChanges(inv, nil, true, now, nil, map[string]string{"old.md": "different"})
	if len(other) != 1 || strings.Contains(other[0].Verdict, "judge") {
		t.Fatalf("judged another version: %+v", other)
	}
	if notJudged[0].DocLines == nil {
		t.Fatalf("doc lines nil, want an empty slice")
	}
}

func TestReviewChanges_setsBody(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "a.md"), "---\nname: a\nmodified: 2026-01-02\n---\nthe rule\nsecond line\n")
	inv, err := ReadInventory(folder)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local)
	reasonClock(t, now)
	changes := ReviewChanges(inv, nil, true, now, nil, nil)
	if len(changes) != 1 {
		t.Fatalf("want one review: %+v", changes)
	}
	if changes[0].Body != "the rule\nsecond line" {
		t.Fatalf("body %q", changes[0].Body)
	}
	if changes[0].Verdict == "" {
		t.Fatalf("no verdict on the review")
	}
}
