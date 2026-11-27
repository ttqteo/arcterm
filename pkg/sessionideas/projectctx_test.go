// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestDeferredHeadings(t *testing.T) {
	md := "# Deferred\n\nintro\n\n## (arcterm) Sidecar pinning  \n- a bullet\n### Sub item\n#### too deep\n```\n## in a fence\n```\n##nospace\n## \n## Last one\r\n"
	want := []string{"(arcterm) Sidecar pinning", "Sub item", "Last one"}
	if got := DeferredHeadings(md); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got := DeferredHeadings(""); len(got) != 0 {
		t.Fatalf("no headings in nothing: %q", got)
	}
}

func TestCommitSubjectsKeepsTheNewestMaxCommitsRead(t *testing.T) {
	var lines []string
	for i := range MaxCommitsRead + 50 {
		lines = append(lines, fmt.Sprintf("commit %d", i), "") // git log ends each subject with a newline; blanks are dropped
	}
	got := CommitSubjects(strings.Join(lines, "\n"))
	if last := fmt.Sprintf("commit %d", MaxCommitsRead-1); len(got) != MaxCommitsRead || got[0] != "commit 0" || got[len(got)-1] != last {
		t.Fatalf("the first %d subjects, newest first: %d, first %q, last %q", MaxCommitsRead, len(got), got[0], got[len(got)-1])
	}
	if got := CommitSubjects("\n  \n"); len(got) != 0 {
		t.Fatalf("blank lines are no subjects: %q", got)
	}
}

func TestBuildProjectContextSplitsInitiativesFromIdeas(t *testing.T) {
	pc := BuildProjectContext(
		[]EffortFacts{{OID: "e1", Title: "Theming", Chunks: []string{"tokens"}}, {OID: "e2", Title: "Keyboard cheat sheet"}},
		[]string{"s.md"}, []string{"p.md"}, "## Deferred one\n", "fix: a\nfeat: b\n")
	want := ProjectContext{
		Initiatives: []Initiative{{OID: "e1", Title: "Theming", Chunks: []string{"tokens"}}},
		Ideas:       []string{"Keyboard cheat sheet"},
		Specs:       []string{"s.md"}, Plans: []string{"p.md"},
		Deferred: []string{"Deferred one"}, Commits: []string{"fix: a", "feat: b"},
	}
	if !reflect.DeepEqual(pc, want) {
		t.Fatalf("got %+v, want %+v", pc, want)
	}
}

func TestKnownGistsAreThisProjectsInAnyState(t *testing.T) {
	ideas := []wshrpc.SessionIdea{
		{Gist: "review", ProjectPath: `C:\work\Arc`, State: wshrpc.SessionIdeaState_Review},
		{Gist: "kept", ProjectPath: "c:/work/arc/", State: wshrpc.SessionIdeaState_Kept},
		{Gist: "dropped", ProjectPath: "C:/work/arc", State: wshrpc.SessionIdeaState_Dropped},
		{Gist: "other", ProjectPath: "C:/work/other", State: wshrpc.SessionIdeaState_Review},
	}
	if got, want := KnownGists(ideas, `C:\work\arc`), []string{"review", "kept", "dropped"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestGistKeyIgnoresCaseSpacingAndPunctuation(t *testing.T) {
	if a, b := gistKey("Add a dark-mode!"), gistKey("  add A DARK mode"); a != b || a == "" {
		t.Fatalf("%q vs %q", a, b)
	}
	if gistKey("Thêm chế độ tối") == gistKey("Thêm chế độ sáng") || gistKey("!!!") != "" {
		t.Fatal("a gist in another language keeps its letters, and punctuation alone is nothing")
	}
}
