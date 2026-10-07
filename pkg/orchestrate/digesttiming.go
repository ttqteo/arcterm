// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"encoding/json"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// timing activity keys, in display order
const (
	TimingPlanning  = "planning"
	TimingExecution = "execution"
	TimingReview    = "review"
	TimingMerge     = "merge"
	TimingFinal     = "final"
	TimingLanding   = "landing"
)

// runStatusFailed is terminal for the frontend's isTerminal, though jarvis declares no such run status.
const runStatusFailed = "failed"

// timingDetail is the part of a lifecycle row's detail the timing reads.
type timingDetail struct {
	TaskId string   `json:"taskid"`
	Batch  []string `json:"batch"`
	Ms     int64    `json:"ms"`
	Verify string   `json:"verify"`
}

func readTimingDetail(ev waveobj.RunEvent) timingDetail {
	var d timingDetail
	if len(ev.Detail) > 0 {
		// a malformed detail reads as no task, like eventTaskID
		_ = json.Unmarshal(ev.Detail, &d)
	}
	return d
}

// activitySpan pairs each task's starts with its ends for one activity. The activity runs from its first start
// to its last end, and is open while any task's latest start has no end at or after it.
type activitySpan struct {
	firstStart map[string]int64
	lastStart  map[string]int64
	lastEnd    map[string]int64
	pruned     bool // an end that implies a start had none retained
}

func newActivitySpan() *activitySpan {
	return &activitySpan{firstStart: map[string]int64{}, lastStart: map[string]int64{}, lastEnd: map[string]int64{}}
}

func (s *activitySpan) start(taskID string, ts int64) {
	if taskID == "" {
		return
	}
	if first, ok := s.firstStart[taskID]; !ok || ts < first {
		s.firstStart[taskID] = ts
	}
	if ts > s.lastStart[taskID] {
		s.lastStart[taskID] = ts
	}
}

// end counts an end only after a start of its task. impliesStart says the start must have happened, so a
// missing one was pruned; otherwise the end may close something that never started (a dispatch failure).
func (s *activitySpan) end(taskID string, ts int64, impliesStart bool) {
	if taskID == "" {
		return
	}
	if first, ok := s.firstStart[taskID]; !ok || ts < first {
		if impliesStart {
			s.pruned = true
		}
		return
	}
	if ts > s.lastEnd[taskID] {
		s.lastEnd[taskID] = ts
	}
}

func (s *activitySpan) earliestStart() int64 {
	var best int64
	for _, ts := range s.firstStart {
		if best == 0 || ts < best {
			best = ts
		}
	}
	return best
}

// activity is the span as a digest row, false when nothing started.
func (s *activitySpan) activity(key string) (wshrpc.DagTimingActivity, bool) {
	if len(s.firstStart) == 0 {
		return wshrpc.DagTimingActivity{}, false
	}
	a := wshrpc.DagTimingActivity{Key: key, StartTs: s.earliestStart()}
	var lastEnd int64
	for taskID, ts := range s.lastStart {
		if s.lastEnd[taskID] < ts {
			return a, true
		}
		lastEnd = max(lastEnd, s.lastEnd[taskID])
	}
	a.EndTs = lastEnd
	return a, true
}

// buildTiming derives where the run's wall clock went from the retained lifecycle rows. Nil without the owner run.
func buildTiming(sn DagDigestSnapshot) *wshrpc.DagTimingDigest {
	owner, g := sn.Owner, sn.Group
	if owner == nil {
		return nil
	}
	exec, review, merge := newActivitySpan(), newActivitySpan(), newActivitySpan()
	var finalStart, dagDone int64
	// starts first, so an end is matched against every retained start whatever order the rows came in
	for _, ev := range sn.Retained {
		d := readTimingDetail(ev)
		switch ev.Kind {
		case waveobj.RunEventKindTaskSpawned:
			exec.start(d.TaskId, ev.Ts)
		case waveobj.RunEventKindTaskReviewStarted:
			review.start(d.TaskId, ev.Ts)
		case waveobj.RunEventKindTaskMergeStarted:
			merge.start(d.TaskId, ev.Ts)
		case waveobj.RunEventKindFinalStep:
			// a step's row lands when it ends
			if s := ev.Ts - d.Ms; finalStart == 0 || s < finalStart {
				finalStart = s
			}
		case waveobj.RunEventKindDagDone:
			dagDone = max(dagDone, ev.Ts)
		}
	}
	for _, ev := range sn.Retained {
		d := readTimingDetail(ev)
		switch ev.Kind {
		case waveobj.RunEventKindTaskDone:
			exec.end(d.TaskId, ev.Ts, true)
		case waveobj.RunEventKindTaskFailed:
			// a dispatch failure fails a task that never spawned
			exec.end(d.TaskId, ev.Ts, false)
		case waveobj.RunEventKindTaskReviewPassed:
			review.end(d.TaskId, ev.Ts, true)
		case waveobj.RunEventKindTaskReviewFailed:
			// failReview hands the lead a review whose reviewer may never have started
			review.end(d.TaskId, ev.Ts, false)
		case waveobj.RunEventKindTaskMerged:
			// with a Verify line the merge-point Verify outcome is the boundary, not the squash, unless the
			// merge left its Verify to the final stage
			if g.Verify == "" || d.Verify == mergeVerifyFinal {
				merge.end(d.TaskId, ev.Ts, true)
			}
		case waveobj.RunEventKindTaskVerifyPassed, waveobj.RunEventKindTaskVerifyFailed:
			// one Verify judges the whole batch, and names only its oldest tip in taskid
			for _, taskID := range append([]string{d.TaskId}, d.Batch...) {
				merge.end(taskID, ev.Ts, true)
			}
		}
	}
	if finalStart == 0 && g.Final != nil {
		finalStart = g.Final.StepTs
	}

	terminal := runTerminal(owner.Status)
	t := &wshrpc.DagTimingDigest{StartTs: owner.CreatedTs}
	if terminal {
		t.EndTs = timingRunEnd(owner, sn.Retained)
	}
	acts := []wshrpc.DagTimingActivity{{Key: TimingPlanning, StartTs: owner.CreatedTs, EndTs: exec.earliestStart()}}
	for _, sp := range []struct {
		key  string
		span *activitySpan
	}{{TimingExecution, exec}, {TimingReview, review}, {TimingMerge, merge}} {
		if a, ok := sp.span.activity(sp.key); ok {
			acts = append(acts, a)
		}
	}
	if finalStart > 0 {
		acts = append(acts, wshrpc.DagTimingActivity{Key: TimingFinal, StartTs: finalStart, EndTs: dagDone})
	}
	if dagDone > 0 {
		acts = append(acts, wshrpc.DagTimingActivity{Key: TimingLanding, StartTs: dagDone, EndTs: owner.CompletedTs})
	}
	for i := range acts {
		if acts[i].EndTs == 0 && terminal {
			acts[i].EndTs = t.EndTs
		}
		if acts[i].EndTs != 0 && acts[i].EndTs < acts[i].StartTs {
			acts[i].EndTs = acts[i].StartTs
		}
	}
	t.Activities = acts
	// a done run always recorded dag-done, so its absence is retention
	t.Partial = exec.pruned || review.pruned || merge.pruned || (owner.Status == jarvis.RunStatus_Done && dagDone == 0)
	return t
}

func runTerminal(status string) bool {
	return status == jarvis.RunStatus_Done || status == jarvis.RunStatus_Cancelled || status == runStatusFailed
}

// timingRunEnd is a terminal run's end, never 0: its completion, else the dag's terminal row, else the latest
// retained row, else its launch.
func timingRunEnd(owner *waveobj.Run, retained []waveobj.RunEvent) int64 {
	if owner.CompletedTs > 0 {
		return owner.CompletedTs
	}
	if ts := terminalEventTs(retained); ts > 0 {
		return ts
	}
	latest := owner.CreatedTs
	for _, ev := range retained {
		latest = max(latest, ev.Ts)
	}
	return latest
}
