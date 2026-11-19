// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisstate

import (
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// isEngineChild reports whether a run is one the engine launched inside another run's dag: a task's worker or its
// reviewer, or a stage session (plan reviewer, verifier, land resolver). Its proposals belong to the run that owns
// the dag. A lead's `wsh jarvis run` child (ParentLeadORef) is not one: it owns a dag of its own.
func isEngineChild(r *waveobj.Run) bool {
	return r.TaskId != "" || r.Review || r.StageRole != ""
}

// RunReview is To review: every proposed chunk a run left, grouped by the run it belongs to. A chunk counts when its
// initiative is active or paused and jarvis.ProposalRun names a run; that run's id (stored as "run:<oid>") resolves to
// its group's run, which is the run itself, or for an engine child the run with the same DagORef that is not one.
// A run id that matches no run drops the chunk, as does an engine child whose owner is missing: To review shows only
// what it can attribute. Groups are oldest run first; a group's items oldest proposal first, then by label.
func RunReview(efforts []*waveobj.Effort, runs []*waveobj.Run) []wshrpc.RunReviewGroup {
	byOID := make(map[string]*waveobj.Run, len(runs))
	ownerOfDag := map[string]*waveobj.Run{}
	for _, r := range runs {
		if r == nil || r.OID == "" {
			continue
		}
		byOID[r.OID] = r
		if isEngineChild(r) || r.DagORef == "" {
			continue
		}
		if cur, ok := ownerOfDag[r.DagORef]; !ok || r.CreatedTs < cur.CreatedTs {
			ownerOfDag[r.DagORef] = r
		}
	}
	groupRun := func(oid string) *waveobj.Run {
		r := byOID[oid]
		if r == nil || !isEngineChild(r) {
			return r
		}
		return ownerOfDag[r.DagORef] // nil when the child names no dag or its owner is gone
	}

	groups := map[string]*wshrpc.RunReviewGroup{}
	for _, e := range efforts {
		if e == nil || (e.Status != "active" && e.Status != "paused") {
			continue
		}
		for _, c := range e.Chunks {
			run := jarvis.ProposalRun(c)
			if run == "" {
				continue
			}
			owner := groupRun(strings.TrimPrefix(run, "run:"))
			if owner == nil {
				continue
			}
			g := groups[owner.OID]
			if g == nil {
				g = &wshrpc.RunReviewGroup{RunId: owner.OID, ChannelId: owner.ChannelOID, Goal: owner.Goal, CreatedTs: owner.CreatedTs}
				groups[owner.OID] = g
			}
			g.Items = append(g.Items, wshrpc.RunReviewItem{
				EffortOID:   e.OID,
				EffortTitle: e.Title,
				Project:     e.Project,
				Label:       c.Label,
				ProposedTs:  proposalTs(c),
			})
		}
	}
	if len(groups) == 0 {
		return nil
	}

	out := make([]wshrpc.RunReviewGroup, 0, len(groups))
	for _, g := range groups {
		items := g.Items
		sort.SliceStable(items, func(i, j int) bool {
			a, b := items[i], items[j]
			if a.ProposedTs != b.ProposedTs {
				return a.ProposedTs < b.ProposedTs
			}
			if a.Label != b.Label {
				return a.Label < b.Label
			}
			return a.EffortOID < b.EffortOID
		})
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedTs != out[j].CreatedTs {
			return out[i].CreatedTs < out[j].CreatedTs
		}
		return out[i].RunId < out[j].RunId
	})
	return out
}

// proposalTs is the Ts of the note jarvis.ProposalRun read the run from: the chunk's newest note whose text is
// jarvis.ProposedNote, the later one in the trail when two share a time.
func proposalTs(c waveobj.EffortChunk) int64 {
	ts, found := int64(0), false
	for _, note := range c.Notes {
		if note.Text != jarvis.ProposedNote {
			continue
		}
		if !found || note.Ts >= ts {
			ts, found = note.Ts, true
		}
	}
	return ts
}
