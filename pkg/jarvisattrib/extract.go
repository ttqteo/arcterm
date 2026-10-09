// pkg/jarvisattrib/extract.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisattrib

import (
	"regexp"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// ticketRe matches a ticket-shaped identifier (e.g. PROJ-142) — used by layer-3 self-correction.
var ticketRe = regexp.MustCompile(`\b[A-Z][A-Z0-9]+-\d+\b`)

// contradictsTicket reports whether any ticket-shaped token in the commit subjects is a concrete
// ticket other than the dossier's — a signal the work belongs elsewhere. Used by layer-3 structural
// self-correction.
func contradictsTicket(dossierTicket string, commitSubjects []string) bool {
	for _, s := range commitSubjects {
		for _, m := range ticketRe.FindAllString(s, -1) {
			if !strings.EqualFold(m, dossierTicket) {
				return true
			}
		}
	}
	return false
}

// extractLayer2 fires when the dossier's ticket appears in the Run's Goal, its Channel name, or any
// commit subject in the Run's range. Deterministic, high confidence on hit.
func extractLayer2(d *jarvisdossier.Dossier, run *waveobj.Run, channelName string, commitSubjects []string) (AttributedEdge, bool) {
	if d.Ticket == "" {
		return AttributedEdge{}, false
	}
	needle := strings.ToLower(d.Ticket)
	haystacks := append([]string{run.Goal, channelName}, commitSubjects...)
	for _, h := range haystacks {
		if h != "" && strings.Contains(strings.ToLower(h), needle) {
			return AttributedEdge{
				DossierID:  d.ID,
				RunORef:    "run:" + run.OID,
				Layers:     []int{2},
				Provenance: provTicket,
				Confidence: weightLayer2,
				State:      StateInforming,
			}, true
		}
	}
	return AttributedEdge{}, false
}

// dossierActiveUntil is when the dossier's work last went on: its last update, or the end of the latest of its
// own (layer-1) runs, or now while one of them is still running. An active dossier used to reach to now by its
// status alone, and since nothing closes a dossier when its runs finish, every dossier that ever ran in a repo
// reached every new run there: a fresh run read 14 structural edges, one per old plan in the repo.
func dossierActiveUntil(d *jarvisdossier.Dossier, ownRuns []*waveobj.Run, now int64) int64 {
	end := d.Updated
	if d.Status != "active" {
		return end
	}
	for _, r := range ownRuns {
		if r.CompletedTs == 0 && (r.Status == jarvis.RunStatus_Executing || r.Status == jarvis.RunStatus_Planning) {
			return now
		}
		if r.CompletedTs > end {
			end = r.CompletedTs
		}
	}
	return end
}

// windowsOverlap reports whether the run's active window intersects the dossier's, which runs from its
// creation to dEnd (dossierActiveUntil). A run with no completion extends to now.
func windowsOverlap(d *jarvisdossier.Dossier, dEnd int64, run *waveobj.Run, now int64) bool {
	rStart := run.CreatedTs
	rEnd := run.CompletedTs
	if rEnd == 0 {
		rEnd = now
	}
	return rStart <= dEnd && rEnd >= d.Created
}

// pastProbation reports whether an inferred edge is old enough to harden. Age is the age of the Run the
// edge is built on — re-derived from Run.CreatedTs, so a cache rebuild computes it identically.
func pastProbation(run *waveobj.Run, now int64) bool {
	return now-run.CreatedTs >= probationMs
}

// extractLayer3 fires a weak structural edge when the run is in one of the dossier's anchor repos and
// their windows overlap; dEnd is where the dossier's window ends (dossierActiveUntil). Self-corrects: a
// concrete different ticket in the run's commits retracts it. Time-boxes: a never-reinforced run finished
// beyond the time-box decays (not returned).
func extractLayer3(d *jarvisdossier.Dossier, run *waveobj.Run, anchorPaths map[string]bool, dEnd int64, commitSubjects []string, now int64) (AttributedEdge, bool) {
	if len(anchorPaths) == 0 || !anchorPaths[run.ProjectPath] {
		return AttributedEdge{}, false
	}
	if !windowsOverlap(d, dEnd, run, now) {
		return AttributedEdge{}, false
	}
	runEnd := run.CompletedTs
	if runEnd == 0 {
		runEnd = now
	}
	if now-runEnd > timeBoxMs {
		return AttributedEdge{}, false
	}
	// self-correction: a concrete different ticket in the commits contradicts.
	if contradictsTicket(d.Ticket, commitSubjects) {
		return AttributedEdge{}, false
	}
	return AttributedEdge{
		DossierID:  d.ID,
		RunORef:    "run:" + run.OID,
		Layers:     []int{3},
		Provenance: provStructural,
		Confidence: weightLayer3,
		State:      StateInforming,
	}, true
}

// edgeLookups injects the two I/O-backed resolvers assembleEdges needs, so the core stays pure and
// unit-testable. The integration layer (lifecycle.go) supplies wstore/gitinfo-backed implementations.
type edgeLookups struct {
	channelName func(channelOID string) string
	commits     func(run *waveobj.Run) []string
}

// mergeInto unions an edge into the accumulator by RunORef, recomputing confidence/provenance from the
// unioned layers and preserving a confirmed state.
func mergeInto(m map[string]AttributedEdge, e AttributedEdge) {
	cur, ok := m[e.RunORef]
	if !ok {
		cur = AttributedEdge{DossierID: e.DossierID, RunORef: e.RunORef}
	}
	cur.Layers = dedupSortLayers(append(cur.Layers, e.Layers...))
	cur.Confidence = confidenceFor(cur.Layers)
	cur.Provenance = provenanceFor(cur.Layers)
	if e.State == StateConfirmed || cur.State == StateConfirmed {
		cur.State = StateConfirmed
	} else {
		cur.State = StateInforming
	}
	m[e.RunORef] = cur
}

// assembleEdges builds the merged dossier->Run edge set: layer-1 canonical refs (confirmed) plus the
// layer-2/3 extractors over candidate runs, deduped by run and ordered by confidence descending.
func assembleEdges(d *jarvisdossier.Dossier, runs []*waveobj.Run, lk edgeLookups, now int64) []AttributedEdge {
	byORef := map[string]*waveobj.Run{}
	for _, r := range runs {
		byORef["run:"+r.OID] = r
	}
	m := map[string]AttributedEdge{}
	anchorPaths := map[string]bool{}
	l1 := map[string]bool{}
	var ownRuns []*waveobj.Run

	// layer 1: the dossier's canonical run references (written by F at dispatch, or hardened by D).
	for _, ref := range d.Refs {
		oref, ok := refToRunORef(ref)
		if !ok {
			continue
		}
		mergeInto(m, AttributedEdge{DossierID: d.ID, RunORef: oref, Layers: []int{1}, State: StateConfirmed})
		l1[oref] = true
		if r := byORef[oref]; r != nil {
			anchorPaths[r.ProjectPath] = true
			ownRuns = append(ownRuns, r)
		}
	}
	dEnd := dossierActiveUntil(d, ownRuns, now)

	// layers 2 & 3 over the remaining candidate runs.
	for _, r := range runs {
		oref := "run:" + r.OID
		if l1[oref] {
			continue
		}
		subs := lk.commits(r)
		if e, ok := extractLayer2(d, r, lk.channelName(r.ChannelOID), subs); ok {
			mergeInto(m, e)
		}
		if e, ok := extractLayer3(d, r, anchorPaths, dEnd, subs, now); ok {
			mergeInto(m, e)
		}
	}

	out := make([]AttributedEdge, 0, len(m))
	for _, e := range m {
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Confidence > out[j].Confidence })
	return out
}
