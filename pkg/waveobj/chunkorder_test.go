// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// chunkorder-cases.json is read by this test and by frontend/app/view/jarvis/chunkorder.test.ts: the two
// implementations of the rule are checked against the same table, so neither can drift without a failure.
type chunkOrderFile struct {
	Priorities []string `json:"priorities"` // lowest to highest
	Cases      []struct {
		Name   string `json:"name"`
		Chunks []struct {
			Status   string `json:"status"`
			Priority string `json:"priority"`
		} `json:"chunks"`
		Order []int `json:"order"`
	} `json:"cases"`
}

func loadChunkOrderFile(t *testing.T) chunkOrderFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "chunkorder-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f chunkOrderFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 || len(f.Priorities) == 0 {
		t.Fatal("chunkorder-cases.json holds no cases")
	}
	return f
}

func TestChunkOrderSharedCases(t *testing.T) {
	f := loadChunkOrderFile(t)
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			chunks := make([]EffortChunk, len(c.Chunks))
			for i, ch := range c.Chunks {
				chunks[i] = EffortChunk{Label: "c", Status: ch.Status, Priority: ch.Priority}
			}
			want := c.Order
			if want == nil {
				want = []int{}
			}
			if got := ChunkOrderOfWorkOf(chunks); !reflect.DeepEqual(got, want) {
				t.Fatalf("ChunkOrderOfWorkOf = %v, want %v", got, want)
			}
			// the accessor form is the same rule, for a caller that holds another chunk type
			byAccessor := ChunkOrderOfWork(len(c.Chunks), func(i int) (string, string) {
				return c.Chunks[i].Status, c.Chunks[i].Priority
			})
			if !reflect.DeepEqual(byAccessor, want) {
				t.Fatalf("ChunkOrderOfWork = %v, want %v", byAccessor, want)
			}
			wantNext := -1
			if len(want) > 0 {
				wantNext = want[0]
			}
			if got := NextChunkIndexOf(chunks); got != wantNext {
				t.Fatalf("NextChunkIndexOf = %d, want %d", got, wantNext)
			}
			if got := NextChunkIndex(len(chunks), func(i int) (string, string) { return chunks[i].Status, chunks[i].Priority }); got != wantNext {
				t.Fatalf("NextChunkIndex = %d, want %d", got, wantNext)
			}
		})
	}
}

func TestChunkOrderLeavesInputAlone(t *testing.T) {
	chunks := []EffortChunk{
		{Label: "a", Status: "pending", Priority: "low"},
		{Label: "b", Status: "pending", Priority: "critical"},
	}
	_ = ChunkOrderOfWorkOf(chunks)
	if chunks[0].Label != "a" || chunks[1].Label != "b" {
		t.Fatalf("the order of work moved the chunks themselves: %+v", chunks)
	}
}

// a later chunk is saved for later, not the initiative's work: whatever its level, it is in no order of work and is
// never the next chunk (the filter comes before the rank)
func TestChunkOrderLeavesLaterChunksOut(t *testing.T) {
	chunks := []EffortChunk{
		{Label: "a", Status: "pending", Priority: "low"},
		{Label: "later critical", Status: "pending", Priority: "critical", Later: true},
		{Label: "later active", Status: "active", Priority: "critical", Later: true},
		{Label: "b", Status: "pending", Priority: "medium"},
	}
	if got, want := ChunkOrderOfWorkOf(chunks), []int{3, 0}; !reflect.DeepEqual(got, want) {
		t.Fatalf("order of work = %v, want %v (the later chunks are out; indices stay positions in the plan)", got, want)
	}
	if got := NextChunkIndexOf(chunks); got != 3 {
		t.Fatalf("next chunk = %d, want 3 (the later critical chunk is not next)", got)
	}
	onlyLater := []EffortChunk{{Label: "l", Status: "pending", Priority: "critical", Later: true}}
	if got := NextChunkIndexOf(onlyLater); got != -1 {
		t.Fatalf("next chunk of an initiative holding only later chunks = %d, want -1", got)
	}
}

func TestChunkRank(t *testing.T) {
	f := loadChunkOrderFile(t)
	if !reflect.DeepEqual(ChunkPriorities, f.Priorities) {
		t.Fatalf("ChunkPriorities = %v, want %v (lowest to highest, as the cases file lists them)", ChunkPriorities, f.Priorities)
	}
	for i := 1; i < len(f.Priorities); i++ {
		if ChunkRank(f.Priorities[i]) <= ChunkRank(f.Priorities[i-1]) {
			t.Fatalf("%q must rank above %q", f.Priorities[i], f.Priorities[i-1])
		}
	}
	if ChunkRank("") != ChunkRank("medium") {
		t.Fatalf("an unset chunk ranks as medium: got %d, medium is %d", ChunkRank(""), ChunkRank("medium"))
	}
	// a level this build does not know (a synced edit from a newer build) is ranked like an unset chunk
	if ChunkRank("bogus") != ChunkRank("medium") {
		t.Fatalf("an unknown level ranks as medium: got %d", ChunkRank("bogus"))
	}
}

func TestValidChunkPriority(t *testing.T) {
	f := loadChunkOrderFile(t)
	for _, p := range append([]string{""}, f.Priorities...) {
		if !ValidChunkPriority(p) {
			t.Errorf("%q must be valid", p)
		}
	}
	for _, p := range []string{"bogus", "High", "CRITICAL", " high", "high ", "urgent", "none", "0"} {
		if ValidChunkPriority(p) {
			t.Errorf("%q must be refused", p)
		}
	}
}
