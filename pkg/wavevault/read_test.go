// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"
)

// seedVault writes fixture files into a freshly opened vault and returns it.
func seedVault(t *testing.T) *Vault {
	t.Helper()
	v, err := openVaultAt(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	write := func(rel, content string) {
		p := filepath.Join(v.Root, rel)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("memory/m-1.md", "---\nid: m-1\n---\n\nWorktrees are flaky; prefer native isolation. [[m-2]]\n")
	write("memory/m-2.md", "---\nid: m-2\n---\n\nNative isolation note.\n")
	write("tasks/active/t-1.md", "---\nid: t-1\nstatus: active\n---\n\nDrop worktrees. [[m-1]]\n")
	write("decisions/d-1.md", "---\nid: d-1\nstatus: accepted\n---\n\nWe dropped worktrees.\n")
	return v
}

func TestQueryByFrontmatter(t *testing.T) {
	v := seedVault(t)
	got, err := v.Retriever(AllScope()).Query(Filter{FrontmatterEquals: map[string]string{"status": "active"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "t-1" {
		t.Fatalf("Query status=active = %v, want [t-1]", ids(got))
	}
}

func TestReadReturnsBody(t *testing.T) {
	v := seedVault(t)
	nb, err := v.Retriever(AllScope()).Read("d-1")
	if err != nil {
		t.Fatal(err)
	}
	if nb.Node.ID != "d-1" || nb.Body == "" {
		t.Fatalf("Read d-1 = %+v", nb)
	}
}

func TestScopeWithoutTasksCannotSeeTasks(t *testing.T) {
	v := seedVault(t)
	noTasks := Scope{Collections: []string{CollMemory, CollDecisions}}
	// interactive scope sees the task...
	if _, err := v.Retriever(AllScope()).Read("t-1"); err != nil {
		t.Fatalf("AllScope should see t-1: %v", err)
	}
	// ...a scope without tasks physically cannot.
	if _, err := v.Retriever(noTasks).Read("t-1"); err == nil {
		t.Fatal("a scope without tasks must NOT resolve a task node")
	}
	got, err := v.Retriever(noTasks).Query(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range got {
		if n.Collection == CollTasks {
			t.Fatalf("a scope without tasks leaked a tasks node: %+v", n)
		}
	}
}

func TestGraphReturnsAllNodesAndResolvedEdges(t *testing.T) {
	v := seedVault(t)
	sg, err := v.Retriever(AllScope()).Graph()
	if err != nil {
		t.Fatal(err)
	}
	// seedVault writes m-1, m-2, t-1, d-1 = 4 nodes across memory/tasks/decisions.
	if len(sg.Nodes) != 4 {
		t.Fatalf("Graph nodes = %v, want 4 (m-1,m-2,t-1,d-1)", ids(sg.Nodes))
	}
	// resolved edges: m-1->m-2 and t-1->m-1 (both endpoints in scope); no dangling edge is emitted.
	if len(sg.Edges) != 2 {
		t.Fatalf("Graph edges = %v, want 2 (m-1>m-2, t-1>m-1)", sg.Edges)
	}
	got := map[string]bool{}
	for _, e := range sg.Edges {
		got[e.From+">"+e.To] = true
	}
	if !got["m-1>m-2"] || !got["t-1>m-1"] {
		t.Fatalf("edges = %v, want m-1>m-2 and t-1>m-1", sg.Edges)
	}
}

func TestGraphScopeExcludesTasks(t *testing.T) {
	v := seedVault(t)
	sg, err := v.Retriever(Scope{Collections: []string{CollMemory, CollDecisions}}).Graph()
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range sg.Nodes {
		if n.Collection == CollTasks {
			t.Fatalf("a scope without tasks leaked a tasks node: %+v", n)
		}
	}
}

// a memory note's scope is its explicit frontmatter scope, else its first subdirectory, else "shared";
// notes outside memory carry no scope
func TestMemoryNoteScope(t *testing.T) {
	v := seedVault(t)
	if err := os.MkdirAll(filepath.Join(v.Root, "memory", "proj-a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.Root, "memory", "proj-a", "m-3.md"), []byte("---\nid: m-3\n---\n\nIn a project dir.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.Root, "memory", "m-4.md"), []byte("---\nid: m-4\nmetadata:\n  scope: proj-x\n---\n\nExplicitly scoped.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	nodes, err := v.Retriever(AllScope()).Query(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, n := range nodes {
		got[n.ID] = n.Scope
	}
	want := map[string]string{"m-1": "shared", "m-2": "shared", "m-3": "proj-a", "m-4": "proj-x", "t-1": "", "d-1": ""}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("scopes = %v, want %v", got, want)
	}
}

func TestNodeUpdatedTsIsFileModTime(t *testing.T) {
	v := seedVault(t)
	mtime := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(v.Root, "memory", "m-2.md"), mtime, mtime); err != nil {
		t.Fatal(err)
	}
	nb, err := v.Retriever(AllScope()).Read("m-2")
	if err != nil {
		t.Fatal(err)
	}
	if nb.Node.UpdatedTs != mtime.UnixMilli() {
		t.Fatalf("UpdatedTs = %d, want %d", nb.Node.UpdatedTs, mtime.UnixMilli())
	}
}

// only .md files are notes, and a scope collection with no directory on disk is skipped
func TestLoadSkipsNonMarkdownAndMissingCollections(t *testing.T) {
	v := seedVault(t)
	if err := os.WriteFile(filepath.Join(v.Root, "memory", "draft.txt"), []byte("---\nid: draft\n---\n\nNot a note.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(v.Root, CollDecisions)); err != nil {
		t.Fatal(err)
	}
	got, err := v.Retriever(AllScope()).Query(Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"m-1", "m-2", "t-1"}; !slices.Equal(ids(got), want) {
		t.Fatalf("Query = %v, want %v", ids(got), want)
	}
}

func ids(ns []Node) []string {
	out := make([]string, len(ns))
	for i, n := range ns {
		out[i] = n.ID
	}
	return out
}
