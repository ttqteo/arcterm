// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func chunk(label string, ts int64, notes ...waveobj.EffortNote) waveobj.EffortChunk {
	return waveobj.EffortChunk{Label: label, Status: "pending", UpdatedTs: ts, Notes: notes}
}

func note(ts int64, text string) waveobj.EffortNote {
	return waveobj.EffortNote{Ts: ts, Text: text}
}

func effort(ts int64, chunks ...waveobj.EffortChunk) *waveobj.Effort {
	return &waveobj.Effort{OID: "e1", Version: 1, Title: "t", Status: "active", Chunks: chunks, CreatedTs: 1, UpdatedTs: ts}
}

func labels(e *waveobj.Effort) []string {
	var out []string
	for _, c := range e.Chunks {
		out = append(out, c.Label)
	}
	return out
}

func findChunk(e *waveobj.Effort, label string) *waveobj.EffortChunk {
	for i := range e.Chunks {
		if e.Chunks[i].Label == label {
			return &e.Chunks[i]
		}
	}
	return nil
}

func TestMergeEffort(t *testing.T) {
	edited := chunk("b", 20)
	edited.Status = "done"

	cases := []struct {
		name               string
		base, ours, theirs *waveobj.Effort
		check              func(t *testing.T, got *waveobj.Effort)
	}{
		{
			name:   "chunk added ours",
			base:   effort(10, chunk("a", 10)),
			ours:   effort(20, chunk("a", 10), chunk("b", 20)),
			theirs: effort(15, chunk("a", 10)),
			check: func(t *testing.T, got *waveobj.Effort) {
				wantLabels(t, got, "a", "b")
			},
		},
		{
			name:   "chunk added theirs",
			base:   effort(10, chunk("a", 10)),
			ours:   effort(20, chunk("a", 10)),
			theirs: effort(15, chunk("a", 10), chunk("c", 15)),
			check: func(t *testing.T, got *waveobj.Effort) {
				wantLabels(t, got, "a", "c")
			},
		},
		{
			name:   "removed ours, unchanged theirs is gone",
			base:   effort(10, chunk("a", 10), chunk("b", 10)),
			ours:   effort(20, chunk("a", 10)),
			theirs: effort(15, chunk("a", 10), chunk("b", 10)),
			check: func(t *testing.T, got *waveobj.Effort) {
				wantLabels(t, got, "a")
			},
		},
		{
			name:   "removed ours, edited theirs is kept edited",
			base:   effort(10, chunk("a", 10), chunk("b", 10)),
			ours:   effort(30, chunk("a", 10)),
			theirs: effort(20, chunk("a", 10), edited),
			check: func(t *testing.T, got *waveobj.Effort) {
				wantLabels(t, got, "a", "b")
				if c := findChunk(got, "b"); c.Status != "done" {
					t.Fatalf("chunk b status = %q, want the edited \"done\"", c.Status)
				}
			},
		},
		{
			name: "both edited: newer chunk wins, notes and workrefs unioned",
			base: effort(10, chunk("a", 10, note(1, "base"))),
			ours: func() *waveobj.Effort {
				c := chunk("a", 20, note(1, "base"), note(5, "ours"))
				c.Status = "active"
				c.WorkRefs = []waveobj.ChunkWorkRef{{Kind: "run", ORef: "run:1", Ts: 5}}
				return effort(20, c)
			}(),
			theirs: func() *waveobj.Effort {
				c := chunk("a", 30, note(1, "base"), note(3, "theirs"))
				c.Status = "done"
				c.WorkRefs = []waveobj.ChunkWorkRef{{Kind: "agent", ORef: "agent:x", Ts: 2}}
				return effort(30, c)
			}(),
			check: func(t *testing.T, got *waveobj.Effort) {
				c := findChunk(got, "a")
				if c.Status != "done" || c.UpdatedTs != 30 {
					t.Fatalf("chunk = %+v, want theirs (newer)", c)
				}
				wantNotes(t, c.Notes, "base", "theirs", "ours")
				want := []waveobj.ChunkWorkRef{{Kind: "agent", ORef: "agent:x", Ts: 2}, {Kind: "run", ORef: "run:1", Ts: 5}}
				if !reflect.DeepEqual(c.WorkRefs, want) {
					t.Fatalf("workrefs = %+v, want %+v", c.WorkRefs, want)
				}
			},
		},
		{
			name: "note union de-dups identical notes and sorts by ts",
			base: &waveobj.Effort{OID: "e1", Notes: []waveobj.EffortNote{note(1, "a")}},
			ours: &waveobj.Effort{OID: "e1", UpdatedTs: 5, Notes: []waveobj.EffortNote{note(1, "a"), note(4, "c")}},
			theirs: &waveobj.Effort{OID: "e1", UpdatedTs: 6,
				Notes: []waveobj.EffortNote{note(1, "a"), note(2, "b"), note(4, "c")}},
			check: func(t *testing.T, got *waveobj.Effort) {
				wantNotes(t, got.Notes, "a", "b", "c")
			},
		},
		{
			name: "events union",
			base: &waveobj.Effort{OID: "e1", Events: []waveobj.EffortEvent{{Ts: 1, Kind: "effort-created"}}},
			ours: &waveobj.Effort{OID: "e1", UpdatedTs: 5, Events: []waveobj.EffortEvent{
				{Ts: 1, Kind: "effort-created"}, {Ts: 3, Kind: "chunk-added", Label: "x"}}},
			theirs: &waveobj.Effort{OID: "e1", UpdatedTs: 6, Events: []waveobj.EffortEvent{
				{Ts: 1, Kind: "effort-created"}, {Ts: 2, Kind: "effort-note", Text: "hi"}}},
			check: func(t *testing.T, got *waveobj.Effort) {
				want := []waveobj.EffortEvent{
					{Ts: 1, Kind: "effort-created"}, {Ts: 2, Kind: "effort-note", Text: "hi"}, {Ts: 3, Kind: "chunk-added", Label: "x"}}
				if !reflect.DeepEqual(got.Events, want) {
					t.Fatalf("events = %+v, want %+v", got.Events, want)
				}
			},
		},
		{
			name: "scalars from the newer side",
			base: &waveobj.Effort{OID: "e1", Title: "base", Status: "active"},
			ours: &waveobj.Effort{OID: "e1", Title: "ours", Status: "active", Project: "p1", UpdatedTs: 5},
			theirs: &waveobj.Effort{OID: "e1", Title: "theirs", Status: "done", Ticket: "T-1", ParentOID: "p",
				Meta: waveobj.MetaMapType{"k": "v"}, UpdatedTs: 9},
			check: func(t *testing.T, got *waveobj.Effort) {
				if got.Title != "theirs" || got.Status != "done" || got.Project != "" || got.Ticket != "T-1" ||
					got.ParentOID != "p" || got.Meta["k"] != "v" {
					t.Fatalf("scalars = %+v, want theirs", got)
				}
			},
		},
		{
			name:   "scalar tie goes to ours",
			base:   &waveobj.Effort{OID: "e1", Title: "base"},
			ours:   &waveobj.Effort{OID: "e1", Title: "ours", UpdatedTs: 5},
			theirs: &waveobj.Effort{OID: "e1", Title: "theirs", UpdatedTs: 5},
			check: func(t *testing.T, got *waveobj.Effort) {
				if got.Title != "ours" {
					t.Fatalf("title = %q, want ours on a tie", got.Title)
				}
			},
		},
		{
			name:   "order is the newer side's plus the other side's extras",
			base:   effort(1, chunk("a", 1), chunk("b", 1), chunk("c", 1)),
			ours:   effort(5, chunk("a", 1), chunk("b", 1), chunk("c", 1), chunk("x", 5), chunk("y", 5)),
			theirs: effort(9, chunk("c", 1), chunk("b", 1), chunk("a", 1), chunk("z", 9)),
			check: func(t *testing.T, got *waveobj.Effort) {
				wantLabels(t, got, "c", "b", "a", "z", "x", "y")
			},
		},
		{
			name:   "version max+1, updatedts max, createdts min non-zero, oid from ours",
			base:   &waveobj.Effort{OID: "e1", Version: 3, CreatedTs: 2},
			ours:   &waveobj.Effort{OID: "e1", Version: 4, CreatedTs: 0, UpdatedTs: 50},
			theirs: &waveobj.Effort{OID: "other", Version: 7, CreatedTs: 2, UpdatedTs: 40},
			check: func(t *testing.T, got *waveobj.Effort) {
				if got.Version != 8 || got.UpdatedTs != 50 || got.CreatedTs != 2 || got.OID != "e1" {
					t.Fatalf("got version=%d updatedts=%d createdts=%d oid=%q", got.Version, got.UpdatedTs, got.CreatedTs, got.OID)
				}
			},
		},
		{
			name:   "nil base: both add the same label, newer wins",
			base:   nil,
			ours:   effort(5, func() waveobj.EffortChunk { c := chunk("a", 5); c.Owner = "ours"; return c }()),
			theirs: effort(9, func() waveobj.EffortChunk { c := chunk("a", 9); c.Owner = "theirs"; return c }()),
			check: func(t *testing.T, got *waveobj.Effort) {
				wantLabels(t, got, "a")
				if c := findChunk(got, "a"); c.Owner != "theirs" {
					t.Fatalf("owner = %q, want theirs (newer)", c.Owner)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.check(t, MergeEffort(tc.base, tc.ours, tc.theirs))
		})
	}
}

// A pin keeps UpdatedTs, so it cannot ride the newer-side rule: the side that pinned is often the older.
func TestMergeEffortPinnedTs(t *testing.T) {
	pinned := func(ts, pinnedTs int64) *waveobj.Effort {
		e := effort(ts)
		e.PinnedTs = pinnedTs
		return e
	}
	cases := []struct {
		name               string
		base, ours, theirs *waveobj.Effort
		want               int64
	}{
		{"pinned on the older side survives a newer edit", pinned(10, 0), pinned(10, 500), pinned(30, 0), 500},
		{"pinned theirs, older side", pinned(10, 0), pinned(30, 0), pinned(10, 500), 500},
		{"unpinned on the older side survives", pinned(10, 500), pinned(10, 0), pinned(30, 500), 0},
		{"unpinned theirs, older side", pinned(10, 500), pinned(30, 500), pinned(10, 0), 0},
		{"both changed: a pin beats an unpin", pinned(10, 500), pinned(20, 0), pinned(15, 700), 700},
		{"both changed: the later pin wins", pinned(10, 0), pinned(20, 600), pinned(15, 900), 900},
		{"neither changed", pinned(10, 500), pinned(20, 500), pinned(15, 500), 500},
		{"new on both sides, nil base", nil, pinned(20, 0), pinned(15, 400), 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MergeEffort(tc.base, tc.ours, tc.theirs).PinnedTs; got != tc.want {
				t.Fatalf("PinnedTs = %d, want %d", got, tc.want)
			}
		})
	}
}

func wantLabels(t *testing.T, e *waveobj.Effort, want ...string) {
	t.Helper()
	if got := labels(e); !reflect.DeepEqual(got, want) {
		t.Fatalf("chunk labels = %v, want %v", got, want)
	}
}

func wantNotes(t *testing.T, notes []waveobj.EffortNote, want ...string) {
	t.Helper()
	var got []string
	for _, n := range notes {
		got = append(got, n.Text)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("notes = %v, want %v", got, want)
	}
}

func TestMergeEffortDoesNotMutateInputs(t *testing.T) {
	mk := func(ts int64, text string) *waveobj.Effort {
		c := chunk("a", ts, note(ts, text))
		c.WorkRefs = []waveobj.ChunkWorkRef{{Kind: "run", ORef: "run:" + text, Ts: ts}}
		e := effort(ts, c, chunk(text, ts))
		e.Notes = []waveobj.EffortNote{note(ts, text)}
		e.Events = []waveobj.EffortEvent{{Ts: ts, Kind: "effort-note", Text: text}}
		e.Meta = waveobj.MetaMapType{"nested": map[string]any{"k": text}}
		return e
	}
	base, ours, theirs := mk(1, "base"), mk(5, "ours"), mk(9, "theirs")
	wantBase, wantOurs, wantTheirs := mk(1, "base"), mk(5, "ours"), mk(9, "theirs")

	got := MergeEffort(base, ours, theirs)
	got.Chunks[0].Notes[0].Text = "mutated"
	got.Notes[0].Text = "mutated"
	got.Meta["nested"].(map[string]any)["k"] = "mutated"

	for _, c := range []struct {
		name      string
		got, want *waveobj.Effort
	}{{"base", base, wantBase}, {"ours", ours, wantOurs}, {"theirs", theirs, wantTheirs}} {
		if !reflect.DeepEqual(c.got, c.want) {
			t.Fatalf("%s was mutated:\n got %+v\nwant %+v", c.name, c.got, c.want)
		}
	}
}

func TestParseEffortRejectsMalformed(t *testing.T) {
	for name, in := range map[string]string{
		"bad json":       `{"oid": "e1",`,
		"missing oid":    `{"title": "t"}`,
		"empty oid":      `{"oid": ""}`,
		"not an object":  `[1, 2]`,
		"trailing value": `{"oid": "e1"} {"oid": "e2"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseEffort([]byte(in)); err == nil {
				t.Fatalf("ParseEffort(%q) = nil error, want an error", in)
			}
		})
	}
}

func TestMarshalEffortRoundTrip(t *testing.T) {
	in := effort(9, chunk("a", 5, note(3, "n")))
	in.Notes = []waveobj.EffortNote{{Ts: 4, Text: "x", Author: "you"}}
	in.Events = []waveobj.EffortEvent{{Ts: 1, Kind: "effort-created"}}
	in.Meta = waveobj.MetaMapType{"k": "v"}

	b, err := MarshalEffort(in)
	if err != nil {
		t.Fatalf("MarshalEffort: %v", err)
	}
	if !strings.HasSuffix(string(b), "}\n") || !strings.Contains(string(b), "\n  \"oid\": \"e1\"") {
		t.Fatalf("MarshalEffort output not two-space indented with a trailing newline:\n%s", b)
	}
	out, err := ParseEffort(b)
	if err != nil {
		t.Fatalf("ParseEffort: %v", err)
	}
	if !reflect.DeepEqual(in, out) {
		t.Fatalf("round trip:\n got %+v\nwant %+v", out, in)
	}
}
