// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestFileMentions(t *testing.T) {
	got := FileMentions(
		"Fix councilstore.ts supersedeListReads; see frontend/app/view/council/councilstore.ts",
		"add a CHANGELOG.md line, then run ./scripts/cdp/verify.mjs and pkg/jarvis/attention.go:120",
		"e.g. nothing here, v1.2 either",
	)
	want := []string{"frontend/app/view/council/councilstore.ts", "scripts/cdp/verify.mjs", "pkg/jarvis/attention.go"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("FileMentions = %v, want %v", got, want)
	}
}

func TestChunkWrittenTs(t *testing.T) {
	e := &waveobj.Effort{CreatedTs: 100, Events: []waveobj.EffortEvent{
		{Ts: 200, Kind: "chunk-added", Label: "a"},
		{Ts: 300, Kind: "chunk-status", Label: "a"},
		{Ts: 250, Kind: "chunk-added", Label: "a"},
	}}
	if got := ChunkWrittenTs(e, waveobj.EffortChunk{Label: "a", UpdatedTs: 900}); got != 250 {
		t.Fatalf("event: got %d, want 250", got)
	}
	// a note or status change moves UpdatedTs, never the written time: a chunk with no event dates from the initiative
	if got := ChunkWrittenTs(e, waveobj.EffortChunk{Label: "b", UpdatedTs: 900, Notes: []waveobj.EffortNote{{Ts: 900, Text: "Needs rewriting: x.go was deleted"}}}); got != 100 {
		t.Fatalf("noted: got %d, want 100", got)
	}
	if got := ChunkWrittenTs(e, waveobj.EffortChunk{Label: "c"}); got != 100 {
		t.Fatalf("seeded: got %d, want 100", got)
	}
	// a rename rewrites the text and a recheck confirms it: the later of them and the add event wins
	renamed := waveobj.EffortChunk{Label: "a", Notes: []waveobj.EffortNote{{Ts: 400, Text: "renamed from old a"}, {Ts: 500, Text: "a note"}}}
	if got := ChunkWrittenTs(e, renamed); got != 400 {
		t.Fatalf("renamed: got %d, want 400", got)
	}
	checked := waveobj.EffortChunk{Label: "d", Notes: []waveobj.EffortNote{{Ts: 600, Text: "checked against 012345678"}}}
	if got := ChunkWrittenTs(e, checked); got != 600 {
		t.Fatalf("checked: got %d, want 600", got)
	}
}

func TestBaseFromBackfill(t *testing.T) {
	before, after := ChunkBasesSinceMs-1000, ChunkBasesSinceMs+1000
	old := &waveobj.Effort{CreatedTs: before - 1000, Events: []waveobj.EffortEvent{
		{Ts: before, Kind: "chunk-added", Label: "added before"},
		{Ts: after, Kind: "chunk-added", Label: "added after"},
	}}
	cases := []struct {
		name string
		e    *waveobj.Effort
		c    waveobj.EffortChunk
		want bool
	}{
		{"no base", old, waveobj.EffortChunk{Label: "x"}, false},
		{"seeded, initiative older than bases", old, waveobj.EffortChunk{Label: "x", BaseCommit: "abc"}, true},
		{"added before bases", old, waveobj.EffortChunk{Label: "added before", BaseCommit: "abc"}, true},
		{"added since bases", old, waveobj.EffortChunk{Label: "added after", BaseCommit: "abc"}, false},
		{"rechecked", old, waveobj.EffortChunk{Label: "x", BaseCommit: "abc", Notes: []waveobj.EffortNote{{Ts: after, Text: "checked against abc"}}}, false},
		{"renamed since bases", old, waveobj.EffortChunk{Label: "x", BaseCommit: "abc", Notes: []waveobj.EffortNote{{Ts: after, Text: "renamed from y"}}}, false},
		{"renamed before bases", old, waveobj.EffortChunk{Label: "x", BaseCommit: "abc", Notes: []waveobj.EffortNote{{Ts: before, Text: "renamed from y"}}}, true},
		{"initiative created since bases", &waveobj.Effort{CreatedTs: after}, waveobj.EffortChunk{Label: "x", BaseCommit: "abc"}, false},
	}
	for _, tc := range cases {
		if got := BaseFromBackfill(tc.e, tc.c); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

// history: newest first. c4 renames old.ts away, c3 touches store.ts, c2 deletes gone.ts, c1 (the base) touches store.ts.
func staleFixture() *StaleHistory {
	commits := []gitinfo.LandedCommit{
		{SHA: "c4aaaaaaaaaa", Ts: 4000, Files: []gitinfo.LandedFile{{Status: 'R', From: "src/old.ts", Path: "src/new.ts"}}},
		{SHA: "c3aaaaaaaaaa", Ts: 3000, Files: []gitinfo.LandedFile{{Status: 'M', Path: "src/store.ts"}, {Status: 'M', Path: "lib/store.ts"}}},
		{SHA: "c2aaaaaaaaaa", Ts: 2000, Files: []gitinfo.LandedFile{{Status: 'D', Path: "src/gone.ts"}}},
		{SHA: "c1aaaaaaaaaa", Ts: 1000, Files: []gitinfo.LandedFile{{Status: 'M', Path: "src/store.ts"}}},
	}
	return NewStaleHistory("c4aaaaaaaaaa", 500, commits, []string{"src/store.ts", "lib/store.ts", "src/new.ts", "src/still.ts"})
}

func TestAssessChunkFromBaseCommit(t *testing.T) {
	h := staleFixture()
	c := waveobj.EffortChunk{Label: "store.ts drops a read; gone.ts and old.ts too; still.ts is fine", BaseCommit: "c1aaaaaaaaaa"}
	res, ok := h.AssessChunk(c, 0)
	if !ok {
		t.Fatal("not measured")
	}
	if res.Landed != 3 || res.Base != "c1aaaaaaaaaa" || res.Inferred {
		t.Fatalf("landed %d base %q inferred %v", res.Landed, res.Base, res.Inferred)
	}
	if len(res.Files) != 3 {
		t.Fatalf("files = %+v", res.Files)
	}
	// gone files first
	if f := res.Files[0]; f.Mention != "gone.ts" || !f.Gone || f.Path != "src/gone.ts" {
		t.Fatalf("files[0] = %+v", f)
	}
	if f := res.Files[1]; f.Mention != "old.ts" || !f.Gone || f.RenamedTo != "src/new.ts" {
		t.Fatalf("files[1] = %+v", f)
	}
	// one commit touched two store.ts files: one change, resolved to the first tracked match
	if f := res.Files[2]; f.Mention != "store.ts" || f.Gone || f.Changes != 1 || f.Path != "src/store.ts" {
		t.Fatalf("files[2] = %+v", f)
	}
}

func TestAssessChunkInferredFromWrittenTs(t *testing.T) {
	h := staleFixture()
	c := waveobj.EffortChunk{Label: "src/store.ts", Notes: []waveobj.EffortNote{{Text: "and src/gone.ts"}}}
	res, ok := h.AssessChunk(c, 2500)
	if !ok || !res.Inferred || res.Base != "c2aaaaaaaaaa" || res.Landed != 2 {
		t.Fatalf("res = %+v ok %v", res, ok)
	}
	// gone.ts went before the chunk was written: nothing to say about it
	if len(res.Files) != 1 || res.Files[0].Mention != "src/store.ts" || res.Files[0].Changes != 1 {
		t.Fatalf("files = %+v", res.Files)
	}
	if got := h.InferredBase(c, 2500); got != "c2aaaaaaaaaa" {
		t.Fatalf("InferredBase = %q", got)
	}
}

func TestAssessChunkUnplaceable(t *testing.T) {
	h := staleFixture()
	if _, ok := h.AssessChunk(waveobj.EffortChunk{Label: "x.ts", BaseCommit: "ffffffff"}, 0); ok {
		t.Fatal("a base outside the history must not be measured")
	}
	if _, ok := h.AssessChunk(waveobj.EffortChunk{Label: "x.ts"}, 100); ok {
		t.Fatal("a chunk older than the history must not be measured")
	}
	res, ok := h.AssessChunk(waveobj.EffortChunk{Label: "nothing named"}, 3500)
	if !ok || len(res.Files) != 0 || res.Landed != 1 {
		t.Fatalf("res = %+v ok %v", res, ok)
	}
}
