// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The backlog pass: before leads filed their open issues as proposed chunks, a lead wrote them as pending chunks whose
// label named the run ("... (run 9a842b04)"). This picks those chunks so `wsh effort backfill-proposed` can move them
// to To review. Pure and DB-free, like effortops.go: wsh builds with CGO_ENABLED=0, so keep this file's imports to
// waveobj and the standard library.

package jarvis

import (
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// BacklogSince is where the backlog pass starts: 2026-11-13 00:00 local, unix ms. A chunk written earlier, or one
// naming a run created earlier, is left where it is. A function, not a constant, because the zone is the machine's.
func BacklogSince() int64 {
	return time.Date(2026, time.November, 13, 0, 0, 0, 0, time.Local).UnixMilli()
}

// BacklogProposal is one pending chunk the backlog pass moves to To review, and the run its label names.
type BacklogProposal struct {
	EffortOID string
	Label     string
	RunOID    string // bare run id; the note the pass writes carries "run:" + RunOID
}

// backlogIDLen is how much of a run's id a label spells: the 8 characters the cockpit prints a run by.
const backlogIDLen = 8

// PickBacklogProposals lists the chunks the backlog pass moves, in the order the initiatives and their chunks come: a
// pending chunk with no workref, written on or after since, whose label names the first 8 id characters of a run that
// is top-level (not an engine child, not a lead's child run), mode orchestrator and created on or after since. A label
// names an id when no hex character sits on either side of it, so an id inside a longer hex string is not one. A label
// that names two such runs takes the newer. A done or archived initiative is left alone, as To review never lists it,
// and so is a chunk saved for later (EffortChunk.Later), which is the person's own item, not a lead's proposal.
//
// A chunk is written when its earliest note was, else when its chunk-added event was; a chunk with neither (seeded at
// create) is skipped, since nothing says when it was written.
func PickBacklogProposals(efforts []*waveobj.Effort, runs []*waveobj.Run, since int64) []BacklogProposal {
	var cands []*waveobj.Run
	for _, r := range runs {
		if backlogRun(r, since) {
			cands = append(cands, r)
		}
	}
	if len(cands) == 0 {
		return nil
	}
	var out []BacklogProposal
	for _, e := range efforts {
		if e == nil || e.Status == "done" || e.Status == "archived" {
			continue
		}
		for _, c := range e.Chunks {
			// a chunk saved for later is the person's own item, not a lead's proposal, whatever its label names
			if c.Status != "pending" || c.Later || len(c.WorkRefs) > 0 {
				continue
			}
			if written := backlogWrittenTs(e, c); written <= 0 || written < since {
				continue
			}
			if run := backlogNamedRun(c.Label, cands); run != nil {
				out = append(out, BacklogProposal{EffortOID: e.OID, Label: c.Label, RunOID: backlogRunOID(run)})
			}
		}
	}
	return out
}

func backlogRunOID(r *waveobj.Run) string {
	if r.OID != "" {
		return r.OID
	}
	return r.ID
}

// backlogRun is a run a lead could have filed a proposal from: an orchestrator run of its own, created since.
func backlogRun(r *waveobj.Run, since int64) bool {
	return r != nil && r.Mode == "orchestrator" && r.CreatedTs >= since &&
		r.TaskId == "" && !r.Review && r.StageRole == "" && r.ParentLeadORef == "" &&
		len(backlogRunOID(r)) >= backlogIDLen
}

// backlogWrittenTs is when a chunk was written: its earliest note, else its chunk-added event (the latest under its
// label, which is the chunk as it stands), else 0.
func backlogWrittenTs(e *waveobj.Effort, c waveobj.EffortChunk) int64 {
	var ts int64
	for _, n := range c.Notes {
		if n.Ts > 0 && (ts == 0 || n.Ts < ts) {
			ts = n.Ts
		}
	}
	if ts > 0 {
		return ts
	}
	for _, ev := range e.Events {
		if ev.Kind == "chunk-added" && ev.Label == c.Label && ev.Ts > ts {
			ts = ev.Ts
		}
	}
	return ts
}

// backlogNamedRun is the newest of runs whose id the label names; nil when it names none.
func backlogNamedRun(label string, runs []*waveobj.Run) *waveobj.Run {
	label = strings.ToLower(label)
	var best *waveobj.Run
	for _, r := range runs {
		if !labelNamesID(label, strings.ToLower(backlogRunOID(r))[:backlogIDLen]) {
			continue
		}
		if best == nil || r.CreatedTs > best.CreatedTs || (r.CreatedTs == best.CreatedTs && backlogRunOID(r) < backlogRunOID(best)) {
			best = r
		}
	}
	return best
}

// labelNamesID reports whether id appears in label with no hex digit on either side of it. Both are lower case.
func labelNamesID(label, id string) bool {
	for from := 0; from < len(label); {
		i := strings.Index(label[from:], id)
		if i < 0 {
			return false
		}
		i += from
		end := i + len(id)
		if (i == 0 || !isHexByte(label[i-1])) && (end == len(label) || !isHexByte(label[end])) {
			return true
		}
		from = i + 1
	}
	return false
}

func isHexByte(b byte) bool {
	return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')
}
