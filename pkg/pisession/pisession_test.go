// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pisession

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseUsesVersionThreeHeader(t *testing.T) {
	data := []byte(`{"type":"session","version":3,"id":"session-1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}` + "\n" +
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-08-11T03:00:01Z","message":{"role":"user","content":"ship it"}}` + "\n")
	file, err := Parse(`C:\tmp\session.jsonl`, data)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	if file.Header.ID != "session-1" {
		t.Errorf("Header.ID = %q, want session-1", file.Header.ID)
	}
	if file.Header.Cwd != `C:\repo` {
		t.Errorf("Header.Cwd = %q, want C:\\repo", file.Header.Cwd)
	}
	if len(file.Entries) != 1 {
		t.Errorf("len(Entries) = %d, want 1", len(file.Entries))
	}
}

func TestParseRejectsUnsupportedVersion(t *testing.T) {
	_, err := Parse("future.jsonl", []byte(`{"type":"session","version":4,"id":"s","cwd":"/repo"}`+"\n"))
	if err == nil {
		t.Fatal("Parse error: want error for unsupported version")
	}
	if !strings.Contains(err.Error(), "future.jsonl") {
		t.Errorf("error %q does not mention the path future.jsonl", err.Error())
	}
	if !strings.Contains(err.Error(), "unsupported Pi session version 4") {
		t.Errorf("error %q does not mention 'unsupported Pi session version 4'", err.Error())
	}
}

func TestParseIgnoresOnlyIncompleteFinalRecord(t *testing.T) {
	data := []byte(`{"type":"session","version":3,"id":"s","cwd":"/repo"}` + "\n" +
		`{"type":"message","id":"u","parentId":null,"message":{"role":"user","content":"keep"}}` + "\n" +
		`{"type":"message","id":"half"`)
	file, err := Parse("partial.jsonl", data)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	if len(file.Entries) != 1 {
		t.Errorf("len(Entries) = %d, want 1", len(file.Entries))
	}

	_, err = Parse("complete-bad.jsonl", append(data, '\n'))
	if err == nil {
		t.Fatal("Parse error: want error for malformed complete record")
	}
	if !strings.Contains(err.Error(), "complete-bad.jsonl:3") {
		t.Errorf("error %q does not mention complete-bad.jsonl:3", err.Error())
	}
}

func TestActiveBranch_ExcludesAbandonedSibling(t *testing.T) {
	data := []byte(`{"type":"session","version":3,"id":"s","cwd":"/repo"}` + "\n" +
		`{"type":"message","id":"root","parentId":null,"message":{"role":"user","content":"implement it"}}` + "\n" +
		`{"type":"message","id":"abandoned","parentId":"root","message":{"role":"assistant","content":"approach A failed"}}` + "\n" +
		`{"type":"message","id":"active","parentId":"root","message":{"role":"assistant","content":"approach B"}}` + "\n" +
		`{"type":"message","id":"leaf","parentId":"active","message":{"role":"assistant","content":"done"}}` + "\n")
	file, err := Parse("branch.jsonl", data)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	branch, err := file.ActiveBranch()
	if err != nil {
		t.Fatalf("ActiveBranch error: %v", err)
	}
	wantIDs := []string{"root", "active", "leaf"}
	if len(branch) != len(wantIDs) {
		t.Fatalf("branch length = %d, want %d (branch %v)", len(branch), len(wantIDs), branchIDs(branch))
	}
	for i, id := range wantIDs {
		if branch[i].ID != id {
			t.Errorf("branch[%d].ID = %q, want %q (branch %v)", i, branch[i].ID, id, branchIDs(branch))
		}
	}
}

func TestActiveBranch_MissingParentError(t *testing.T) {
	data := []byte(`{"type":"session","version":3,"id":"s","cwd":"/repo"}` + "\n" +
		`{"type":"message","id":"orphan","parentId":"ghost","message":{"role":"user","content":"hi"}}` + "\n")
	file, err := Parse("missing-parent.jsonl", data)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	_, err = file.ActiveBranch()
	if err == nil {
		t.Fatal("ActiveBranch error: want error for missing parent")
	}
	if !strings.Contains(err.Error(), "missing-parent.jsonl") {
		t.Errorf("error %q does not mention the path missing-parent.jsonl", err.Error())
	}
	if !strings.Contains(err.Error(), "ghost") {
		t.Errorf("error %q does not mention the missing parent id ghost", err.Error())
	}
}

func TestActiveBranch_CycleError(t *testing.T) {
	data := []byte(`{"type":"session","version":3,"id":"s","cwd":"/repo"}` + "\n" +
		`{"type":"message","id":"a","parentId":"b","message":{"role":"user","content":"hi"}}` + "\n" +
		`{"type":"message","id":"b","parentId":"a","message":{"role":"assistant","content":"hi"}}` + "\n")
	file, err := Parse("cycle.jsonl", data)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	_, err = file.ActiveBranch()
	if err == nil {
		t.Fatal("ActiveBranch error: want error for parent cycle")
	}
	if !strings.Contains(err.Error(), "cycle.jsonl") {
		t.Errorf("error %q does not mention the path cycle.jsonl", err.Error())
	}
}

// Real pi v3 sessions write billed usage in two places: message entries carry it nested inside the
// message payload (entry.message.usage), while compaction/branch_summary entries carry it top-level
// (entry.usage). Both must land on Entry.Usage so consumers read one shape.
func TestParseReadsNestedMessageUsageAndTopLevelCompactionUsage(t *testing.T) {
	data := []byte(`{"type":"session","version":3,"id":"s","cwd":"/repo"}` + "\n" +
		`{"type":"message","id":"a1","parentId":null,"timestamp":"2026-08-11T03:00:00Z","message":{"role":"assistant","content":"x","usage":{"input":10,"output":5,"reasoning":1,"cacheRead":2,"cacheWrite":3,"totalTokens":15,"cost":{"input":0.004,"output":0.003,"cacheRead":0.002,"cacheWrite":0.001,"total":0.01}}}}` + "\n" +
		`{"type":"compaction","id":"c1","parentId":"a1","timestamp":"2026-08-11T03:00:01Z","usage":{"input":4,"output":1,"totalTokens":5,"cost":{"total":0}}}` + "\n")
	file, err := Parse("nested.jsonl", data)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	if len(file.Entries) != 2 {
		t.Fatalf("len(Entries) = %d, want 2", len(file.Entries))
	}
	msg := file.Entries[0]
	if msg.Usage == nil {
		t.Fatal("message entry Usage = nil, want the nested message.usage")
	}
	if msg.Usage.Input != 10 || msg.Usage.Output != 5 || msg.Usage.Reasoning != 1 ||
		msg.Usage.CacheRead != 2 || msg.Usage.CacheWrite != 3 || msg.Usage.TotalTokens != 15 || msg.Usage.Cost.Total != 0.01 {
		t.Errorf("message usage = %+v, want the nested fields", msg.Usage)
	}
	comp := file.Entries[1]
	if comp.Usage == nil || comp.Usage.Input != 4 || comp.Usage.TotalTokens != 5 {
		t.Errorf("compaction usage = %+v, want the top-level 4/5", comp.Usage)
	}
}

func TestRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.jsonl")
	content := []byte(`{"type":"session","version":3,"id":"s","cwd":"/repo"}` + "\n" +
		`{"type":"message","id":"u","parentId":null,"message":{"role":"user","content":"hi"}}` + "\n")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}
	file, err := Read(path)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if file.Path != path {
		t.Errorf("File.Path = %q, want %q", file.Path, path)
	}
	if len(file.Entries) != 1 {
		t.Errorf("len(Entries) = %d, want 1", len(file.Entries))
	}
}

func branchIDs(branch []Entry) []string {
	ids := make([]string, len(branch))
	for i, e := range branch {
		ids[i] = e.ID
	}
	return ids
}

func TestBranchMetaPrefersLatestNameOverFirstUserText(t *testing.T) {
	named, err := Parse("named.jsonl", []byte(`{"type":"session","version":3,"id":"s","cwd":"/repo"}`+"\n"+
		`{"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":" ship it "}]}}`+"\n"+
		`{"type":"session_info","id":"i1","parentId":"u1","name":"older"}`+"\n"+
		`{"type":"session_info","id":"i2","parentId":"i1","name":" newer "}`+"\n"))
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	branch, err := named.ActiveBranch()
	if err != nil {
		t.Fatalf("ActiveBranch error: %v", err)
	}
	if title, firstUser := BranchMeta(branch); title != "newer" || firstUser != "" {
		t.Errorf("BranchMeta = %q, %q; want the latest name alone", title, firstUser)
	}
	// with no name, the first user text stands in
	if title, firstUser := BranchMeta(branch[:1]); title != "" || firstUser != "ship it" {
		t.Errorf("BranchMeta = %q, %q; want the first user text", title, firstUser)
	}
	if got := UserText([]byte(`{"role":"assistant","content":"not human"}`)); got != "" {
		t.Errorf("UserText(assistant) = %q, want empty", got)
	}
}
