// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"slices"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// EffortsDir holds one efforts/<oid>.json file per effort. It is not a scanned collection.
const EffortsDir = "efforts"

// ParseEffort decodes one effort file. Trailing data after the object and an empty OID are errors.
func ParseEffort(b []byte) (*waveobj.Effort, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	var e waveobj.Effort
	if err := dec.Decode(&e); err != nil {
		return nil, fmt.Errorf("parse effort: %w", err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("parse effort: trailing data after the effort object")
	}
	if e.OID == "" {
		return nil, errors.New("parse effort: missing oid")
	}
	return &e, nil
}

// MarshalEffort is the one on-disk encoding of an effort, shared by the store and by sync so a
// rewrite of an unchanged effort produces an identical file.
func MarshalEffort(e *waveobj.Effort) ([]byte, error) {
	b, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal effort %s: %w", e.OID, err)
	}
	return append(b, '\n'), nil
}

// MergeEffort three-way merges two concurrent versions of one effort against their common ancestor
// (base, nil when the file is new on both sides). Scalars come from the side with the newer
// UpdatedTs (tie → ours); chunks merge by Label, an edit outliving a concurrent delete; notes, events
// and workrefs are unioned. It never mutates its inputs.
func MergeEffort(base, ours, theirs *waveobj.Effort) *waveobj.Effort {
	if base == nil {
		base = &waveobj.Effort{}
	}
	newer, other := ours, theirs
	if theirs.UpdatedTs > ours.UpdatedTs {
		newer, other = theirs, ours
	}
	return &waveobj.Effort{
		OID:       ours.OID,
		Version:   max(ours.Version, theirs.Version) + 1,
		Title:     newer.Title,
		Project:   newer.Project,
		Ticket:    newer.Ticket,
		Status:    newer.Status,
		ParentOID: newer.ParentOID,
		Chunks:    mergeChunks(base.Chunks, ours.Chunks, theirs.Chunks, newer.Chunks, other.Chunks),
		Notes:     unionByTs(ours.Notes, theirs.Notes, func(n waveobj.EffortNote) int64 { return n.Ts }),
		Events:    unionByTs(ours.Events, theirs.Events, func(ev waveobj.EffortEvent) int64 { return ev.Ts }),
		CreatedTs: minNonZero(ours.CreatedTs, theirs.CreatedTs),
		UpdatedTs: max(ours.UpdatedTs, theirs.UpdatedTs),
		PinnedTs:  mergePinnedTs(base.PinnedTs, ours.PinnedTs, theirs.PinnedTs),
		Meta:      cloneMeta(newer.Meta),
	}
}

// mergePinnedTs merges the pin three-way. It cannot follow the newer-UpdatedTs rule: a pin keeps
// UpdatedTs, so the side that pinned may well be the older one. A side that changed it from base wins;
// when both changed it, the larger wins (a pin beats an unpin, the later pin beats the earlier).
func mergePinnedTs(base, ours, theirs int64) int64 {
	oursChanged, theirsChanged := ours != base, theirs != base
	switch {
	case oursChanged && theirsChanged:
		return max(ours, theirs)
	case theirsChanged:
		return theirs
	default:
		return ours
	}
}

// mergeChunks walks the newer side's order, then the other side's extras; ours/theirs decide what
// each label becomes. The result is never nil: "chunks" has no omitempty and readers expect a list.
func mergeChunks(base, ours, theirs, newer, other []waveobj.EffortChunk) []waveobj.EffortChunk {
	baseBy, oursBy, theirsBy := chunksByLabel(base), chunksByLabel(ours), chunksByLabel(theirs)
	out := []waveobj.EffortChunk{}
	seen := make(map[string]bool)
	for _, c := range slices.Concat(newer, other) {
		if seen[c.Label] {
			continue
		}
		seen[c.Label] = true
		if merged, keep := mergeChunk(baseBy, oursBy, theirsBy, c.Label); keep {
			out = append(out, merged)
		}
	}
	return out
}

func mergeChunk(baseBy, oursBy, theirsBy map[string]waveobj.EffortChunk, label string) (waveobj.EffortChunk, bool) {
	o, inOurs := oursBy[label]
	t, inTheirs := theirsBy[label]
	if inOurs && inTheirs {
		win := o
		if t.UpdatedTs > o.UpdatedTs {
			win = t
		}
		win.Notes = unionByTs(o.Notes, t.Notes, func(n waveobj.EffortNote) int64 { return n.Ts })
		win.WorkRefs = unionByTs(o.WorkRefs, t.WorkRefs, func(w waveobj.ChunkWorkRef) int64 { return w.Ts })
		return win, true
	}
	side := o
	if inTheirs {
		side = t
	}
	if b, inBase := baseBy[label]; inBase && reflect.DeepEqual(b, side) {
		// deleted on one side, untouched on the other
		return waveobj.EffortChunk{}, false
	}
	side.Notes = slices.Clone(side.Notes)
	side.WorkRefs = slices.Clone(side.WorkRefs)
	return side, true
}

func chunksByLabel(chunks []waveobj.EffortChunk) map[string]waveobj.EffortChunk {
	m := make(map[string]waveobj.EffortChunk, len(chunks))
	for _, c := range chunks {
		if _, dup := m[c.Label]; !dup {
			m[c.Label] = c
		}
	}
	return m
}

// unionByTs returns a new slice of the distinct values of a then b, stably sorted by ts; nil when
// both are empty, so an omitempty field stays omitted.
func unionByTs[T comparable](a, b []T, ts func(T) int64) []T {
	var out []T
	seen := make(map[T]bool, len(a)+len(b))
	for _, v := range slices.Concat(a, b) {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	slices.SortStableFunc(out, func(x, y T) int { return cmp.Compare(ts(x), ts(y)) })
	return out
}

func minNonZero(a, b int64) int64 {
	if a == 0 || (b != 0 && b < a) {
		return b
	}
	return a
}

func cloneMeta(m waveobj.MetaMapType) waveobj.MetaMapType {
	if m == nil {
		return nil
	}
	return cloneJSONValue(map[string]any(m)).(map[string]any)
}

func cloneJSONValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		c := make(map[string]any, len(t))
		for k, x := range t {
			c[k] = cloneJSONValue(x)
		}
		return c
	case waveobj.MetaMapType:
		return waveobj.MetaMapType(cloneJSONValue(map[string]any(t)).(map[string]any))
	case []any:
		c := make([]any, len(t))
		for i, x := range t {
			c[i] = cloneJSONValue(x)
		}
		return c
	default:
		return v
	}
}
