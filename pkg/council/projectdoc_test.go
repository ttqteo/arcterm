// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// decisionsCouncil is a council of project with a memory: a direction, one entry of each kind, and its document in the
// project's docs/council folder.
func decisionsCouncil(id, project string, created int64, feature string) *Council {
	c := testCouncil(id)
	c.Project, c.Feature, c.Created, c.Updated = project, feature, created, created
	c.DocPath = filepath.Join(project, "docs", "council", id+".md")
	c.Memory = &CouncilMemory{
		Chosen: &CouncilMemoryDirection{Text: "Read the paper before citing it"},
		Entries: []CouncilMemoryEntry{
			{Id: "m1", Kind: EntryAgreed, Text: "It is a  benchmark,\nnot a method."},
			{Id: "m2", Kind: EntryRuledOut, Text: "Cite it as proof", Why: "it measures another task"},
			{Id: "m3", Kind: EntryOpen, Text: "What does human-engineered mean there?"},
		},
	}
	return c
}

func docDate(ms int64) string { return time.UnixMilli(ms).Format("2006-01-02") }

func TestDocBlockListsWhatEachCouncilSettledNewestFirst(t *testing.T) {
	project := filepath.Join("home", "thesis")
	older := decisionsCouncil("c1", project, 1_793_000_000_000, "Pick the direction")
	newer := decisionsCouncil("c2", project, 1_793_800_000_000, "Settle the problem after M5")
	newer.Memory.Entries = newer.Memory.Entries[:1]
	bench := decisionsCouncil("c3", project, 1_793_900_000_000, "A bench council")
	bench.Bench = true
	empty := decisionsCouncil("c4", project, 1_793_950_000_000, "Nothing settled yet")
	empty.Memory = &CouncilMemory{}

	block := DocBlock([]*Council{older, bench, newer, empty}, project)
	if !strings.HasPrefix(block, docBegin) || !strings.HasSuffix(block, docEnd) {
		t.Fatalf("the block is not between its markers:\n%s", block)
	}
	mustContain(t, "block", block,
		"## Council decisions",
		"### "+docDate(newer.Created)+" · Settle the problem after M5\nReport: `"+filepath.Join("docs", "council", "c2.md")+"`\n",
		"- Direction: Read the paper before citing it\n",
		"- Agreed: It is a benchmark, not a method.\n",
		"- Ruled out: Cite it as proof (why: it measures another task)\n",
		"- Open: What does human-engineered mean there?\n",
	)
	mustNotContain(t, "block", block, "A bench council", "Nothing settled yet")
	if strings.Index(block, "Settle the problem") > strings.Index(block, "Pick the direction") {
		t.Errorf("the newer council should come first:\n%s", block)
	}

	// a report outside the project is named by its full path; none is left out
	newer.DocPath = filepath.Join("elsewhere", "c2.md")
	mustContain(t, "block", DocBlock([]*Council{newer}, project), "Report: `"+filepath.Join("elsewhere", "c2.md")+"`")
	newer.DocPath = ""
	mustNotContain(t, "block", DocBlock([]*Council{newer}, project), "Report:")

	if got := DocBlock([]*Council{bench, empty}, project); got != "" {
		t.Errorf("no council with a memory: block = %q, want none", got)
	}

	// at most docCouncilsMax councils, the newest
	var many []*Council
	for i := range docCouncilsMax + 2 {
		many = append(many, decisionsCouncil("m"+string(rune('a'+i)), project, int64(1_793_000_000_000+i), "Council "+string(rune('a'+i))))
	}
	if n := strings.Count(DocBlock(many, project), "\n### "); n != docCouncilsMax {
		t.Errorf("%d councils in the block, want %d", n, docCouncilsMax)
	}
}

func TestWithDocBlock(t *testing.T) {
	block := docBegin + "\n## Council decisions\n\n- A\n" + docEnd

	// appended under the file's own text, which is left as it was
	doc := "# Project\n\nOwn rules.\n\n\n"
	got, err := WithDocBlock(doc, block)
	if err != nil || got != "# Project\n\nOwn rules.\n\n"+block+"\n" {
		t.Errorf("append: got %q, %v", got, err)
	}

	// replaced in place, the text around it kept
	around := "# Project\n\n" + docBegin + " old note -->\nold lines\n" + docEnd + "\n\n## After\nKept.\n"
	got, err = WithDocBlock(around, block)
	if err != nil || got != "# Project\n\n"+block+"\n\n## After\nKept.\n" {
		t.Errorf("replace: got %q, %v", got, err)
	}
	if again, _ := WithDocBlock(got, block); again != got {
		t.Errorf("writing the same block twice changed the file:\n%q\n%q", got, again)
	}

	// no block left: the old one goes, and nothing is added to a file that has none
	got, err = WithDocBlock(around, "")
	if err != nil || got != "# Project\n\n## After\nKept.\n" {
		t.Errorf("remove: got %q, %v", got, err)
	}
	if got, _ := WithDocBlock(doc, ""); got != doc {
		t.Errorf("no block and none in the file: got %q, want it untouched", got)
	}

	// a file with Windows line endings gets the block with them too
	crlf := "# Project\r\n\r\nOwn rules.\r\n"
	got, _ = WithDocBlock(crlf, block)
	if strings.Contains(strings.ReplaceAll(got, "\r\n", ""), "\n") {
		t.Errorf("a bare line feed in a CRLF file: %q", got)
	}

	// a begin marker whose end is gone is not guessed at: everything after it would go
	if _, err := WithDocBlock("# P\n"+docBegin+"\nhand edits\n", block); err == nil {
		t.Error("a begin marker with no end: want an error, not a rewrite")
	}
}

func TestSyncProjectDoc(t *testing.T) {
	useTempRoot(t)
	project := t.TempDir()
	c := decisionsCouncil("c1", project, 1_793_800_000_000, "Settle the problem")
	if err := Save(c); err != nil {
		t.Fatal(err)
	}
	other := decisionsCouncil("c2", t.TempDir(), 1_793_900_000_000, "Another project's council")
	if err := Save(other); err != nil {
		t.Fatal(err)
	}

	// AGENTS.md alone: the block goes there, under its text, and its mode is kept
	agents := filepath.Join(project, "AGENTS.md")
	if err := os.WriteFile(agents, []byte("# Agents\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	path, changed, err := SyncProjectDoc(project)
	if err != nil || !changed || path != agents {
		t.Fatalf("SyncProjectDoc = %q %v %v, want AGENTS.md written", path, changed, err)
	}
	b, _ := os.ReadFile(agents)
	mustContain(t, "AGENTS.md", string(b), "# Agents\n\n"+docBegin, "Settle the problem", "Read the paper before citing it")
	mustNotContain(t, "AGENTS.md", string(b), "Another project's council")
	// Windows keeps no Unix mode bits (it reports 0666), so the kept mode is checked on Unix only
	if st, _ := os.Stat(agents); runtime.GOOS != "windows" && st.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want the file's own 0600", st.Mode().Perm())
	}
	if _, changed, _ := SyncProjectDoc(project); changed {
		t.Error("a second sync with nothing new rewrote the file")
	}

	// a CLAUDE.md is the one Claude Code loads first: it takes the block
	claude := filepath.Join(project, "CLAUDE.md")
	if err := os.WriteFile(claude, []byte("# Claude\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if path, _, _ := SyncProjectDoc(project); path != claude {
		t.Errorf("path = %q, want CLAUDE.md once it exists", path)
	}

	// a project with no instruction file gets a CLAUDE.md holding the block
	bare := t.TempDir()
	if err := Save(decisionsCouncil("c3", bare, 1_793_950_000_000, "A bare project")); err != nil {
		t.Fatal(err)
	}
	if path, changed, err := SyncProjectDoc(bare); err != nil || !changed || path != filepath.Join(bare, "CLAUDE.md") {
		t.Errorf("bare project: %q %v %v, want a new CLAUDE.md", path, changed, err)
	}

	// a project folder that is not on this machine is left alone
	if path, changed, err := SyncProjectDoc(filepath.Join(project, "gone")); path != "" || changed || err != nil {
		t.Errorf("missing project: %q %v %v, want nothing done", path, changed, err)
	}
}
