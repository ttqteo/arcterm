// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runqueue

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Spelled out, not imported: see the package comment. consts_test.go fails when one drifts from its source.
const (
	statusDone      = "done"      // jarvis.RunStatus_Done
	statusCancelled = "cancelled" // jarvis.RunStatus_Cancelled
	landLanded      = "landed"    // orchestrate.LandState_Landed
	landHeld        = "held"      // orchestrate.LandState_Held
)

// DefaultMaxActive is the cap on active runs when `runs:maxactive` is not set.
const DefaultMaxActive = 3

// TopLevel is a run the person or a session started: not a task worker, its reviewer, a stage session, or a child a
// lead spawned.
func TopLevel(r *waveobj.Run) bool {
	return r.ParentLeadORef == "" && r.TaskId == "" && r.StageRole == "" && !r.Review
}

// Active counts the top-level runs that still hold agents: anything not done or cancelled. A done run whose land is
// held holds none and does not count.
func Active(runs []*waveobj.Run) int {
	n := 0
	for _, r := range runs {
		if r != nil && TopLevel(r) && r.Status != statusDone && r.Status != statusCancelled {
			n++
		}
	}
	return n
}

// Outcome says whether a run has ended for good, and if so whether its work landed. Not final: still running, a land
// still pending, a hold that clears by itself once the checkout is clean (Dirty), or a branch run not yet landed.
// reason is the hold's own reason for a held land and "cancelled" for a cancelled run; it is empty otherwise.
func Outcome(r *waveobj.Run) (final bool, landed bool, reason string) {
	if r == nil {
		return false, false, ""
	}
	if r.Land != nil {
		switch {
		case r.Land.State == landLanded:
			return true, true, ""
		case r.Land.State == landHeld && !r.Land.Dirty:
			return true, false, r.Land.Reason
		}
	}
	switch {
	case r.Status == statusDone && r.Land == nil && r.LandPath == "":
		return true, true, "" // landed in the checkout, with no branch to merge
	case r.Status == statusCancelled:
		return true, false, "cancelled"
	}
	return false, false, ""
}

// ClampMaxActive reads `runs:maxactive`: unset is DefaultMaxActive, and below 0 is 0, which means no cap.
func ClampMaxActive(v *int) int {
	if v == nil {
		return DefaultMaxActive
	}
	if *v < 0 {
		return 0
	}
	return *v
}

// Block is why a waiting entry can never start by waiting. On is the run whose outcome blocked it, empty when the
// block is not about a run's outcome (an After that is neither a run nor a queued entry).
type Block struct {
	Reason string
	On     string
}

// Next walks the queue in order. start is the id of the first waiting entry that may start now: its After is empty
// or every id in it is a run that landed, and fewer than maxActive top-level runs are active (maxActive 0 is no cap).
// block names each waiting entry that can never start by waiting, with the reason: one of its After runs was
// cancelled or ended held (On is that run), or an After id is neither a run nor a queued entry. An entry that waits
// on a run still going, a dirty hold or another queued entry (never ready: it has no run to have landed) is neither
// started nor blocked, and does not hold up the entries behind it. A blocked entry is skipped, except that unblock lists the ones blocked on a run (BlockedOn) that
// has landed since: a held run is landed later by hand, and these carry on. They are not started in this call; the
// caller sets them waiting and asks again. An entry blocked for any other cause has no BlockedOn and stays blocked.
func Next(entries []wshrpc.RunQueueEntry, runs map[string]*waveobj.Run, maxActive int) (start string, block map[string]Block, unblock []string) {
	block = map[string]Block{}
	room := maxActive <= 0
	if !room {
		all := make([]*waveobj.Run, 0, len(runs))
		for _, r := range runs {
			all = append(all, r)
		}
		room = Active(all) < maxActive
	}
	queued := make(map[string]bool, len(entries))
	for _, e := range entries {
		queued[e.Id] = true
	}
	for _, e := range entries {
		if e.State == wshrpc.RunQueueState_Blocked {
			if e.BlockedOn != "" {
				if _, landed, _ := Outcome(runs[e.BlockedOn]); landed {
					unblock = append(unblock, e.Id)
				}
			}
			continue
		}
		ready, b, blocked := afterState(e.After, runs, queued)
		switch {
		case blocked:
			block[e.Id] = b
		case ready && start == "" && room:
			start = e.Id
		}
	}
	return start, block, unblock
}

// afterState reads an entry's After list. ready is true when every id is a run that landed (an empty list is ready).
// blocked is true, with the first reason in list order, when any id can never land: a run that ended held or
// cancelled, or an id that is neither a run nor a queued entry. That wins over another id still going: the entry
// would wait for the rest and then not start. An id still going, a dirty hold, or a queued entry (never ready: it has
// no run to have landed) leaves the entry waiting.
func afterState(after []string, runs map[string]*waveobj.Run, queued map[string]bool) (ready bool, b Block, blocked bool) {
	ready = true
	for _, id := range after {
		if run, ok := runs[id]; ok {
			final, landed, reason := Outcome(run)
			switch {
			case !final:
				ready = false
			case !landed:
				if !blocked {
					b, blocked = Block{Reason: runTitle(run) + " was " + endedAs(run, reason), On: id}, true
				}
			}
		} else if queued[id] {
			ready = false
		} else if !blocked {
			b, blocked = Block{Reason: id + " is not a run or a queued entry"}, true
		}
	}
	return ready && !blocked, b, blocked
}

// endedAs words how a final run that did not land ended, to follow "was": "held: <reason>" or "cancelled".
func endedAs(r *waveobj.Run, reason string) string {
	if r.Land == nil || r.Land.State != landHeld {
		return reason
	}
	if reason == "" {
		return landHeld
	}
	return landHeld + ": " + reason
}

// runTitle is the run's goal's first line, or its id when the goal is empty.
func runTitle(r *waveobj.Run) string {
	title, _, _ := strings.Cut(r.Goal, "\n")
	if title = strings.TrimSpace(title); title != "" {
		return title
	}
	return r.ID
}
