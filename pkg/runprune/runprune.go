// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package runprune trims the prompts of finished engine sessions in db_run. A run the engine launched for a task,
// a review or a stage (plan reviewer, verifier…) stores the whole prompt it was given as its Goal, ~15 KB each and up
// to 90 KB: on 2026-11-14 they were 40 MB of db_run's 61 MB (3,100 runs, 2,900 of them engine sessions), and every
// reader that loads all runs decoded them. A week after such a run ends, its Goal keeps only its first line, which
// is all its readers show (titles, the timeline, blame, usage, the workflow scan's 100-char header); the report, the
// evidence and the run itself stay. Runs a person started, and their leads, are never touched.
package runprune

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// Keep is how long after it ends an engine session keeps its whole prompt (the person's choice, 2026-11-14:
	// finished runs are rarely opened again).
	Keep = 7 * 24 * time.Hour
	// MaxGoalRunes caps the first line a trimmed Goal keeps; some prompts open with a long paragraph.
	MaxGoalRunes = 300
	// startDelay keeps the first sweep out of startup, when wavesrv has the most to do.
	startDelay = 5 * time.Minute
	interval   = 24 * time.Hour
)

// engineSession says whether the engine launched r for a task, a review or a stage, so its Goal is a generated
// prompt rather than what a person typed.
func engineSession(r *waveobj.Run) bool {
	return r.TaskId != "" || r.Review || r.StageRole != ""
}

// endedTs is when r ended, or 0 while it may still run. A run cancelled before CancelledTs was recorded falls back
// to when it was created.
func endedTs(r *waveobj.Run) int64 {
	switch r.Status {
	case "done":
		if r.CompletedTs > 0 {
			return r.CompletedTs
		}
		return r.CreatedTs
	case "cancelled":
		if r.CancelledTs > 0 {
			return r.CancelledTs
		}
		return r.CreatedTs
	}
	return 0
}

// TrimmedGoal is the first line of goal, capped at MaxGoalRunes.
func TrimmedGoal(goal string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(goal), "\n")
	line = strings.TrimSpace(line)
	if r := []rune(line); len(r) > MaxGoalRunes {
		return string(r[:MaxGoalRunes-1]) + "…"
	}
	return line
}

// liveDags holds the dag orefs whose lead run has not ended: their sessions are left whole until it does.
func liveDags(runs []*waveobj.Run) map[string]bool {
	live := map[string]bool{}
	for _, r := range runs {
		if r.DagORef != "" && !engineSession(r) && endedTs(r) == 0 {
			live[r.DagORef] = true
		}
	}
	return live
}

// shouldTrim says whether r's Goal is trimmed at now: an engine session that ended over Keep ago, outside a dag still
// running, whose Goal still holds more than its trimmed form.
func shouldTrim(r *waveobj.Run, live map[string]bool, now time.Time) bool {
	if !engineSession(r) || live[r.DagORef] {
		return false
	}
	end := endedTs(r)
	if end == 0 || now.Sub(time.UnixMilli(end)) < Keep {
		return false
	}
	return r.Goal != TrimmedGoal(r.Goal)
}

// Candidates are the runs Sweep trims at now.
func Candidates(runs []*waveobj.Run, now time.Time) []*waveobj.Run {
	live := liveDags(runs)
	var out []*waveobj.Run
	for _, r := range runs {
		if shouldTrim(r, live, now) {
			out = append(out, r)
		}
	}
	return out
}

// Sweep trims every candidate at now and returns how many runs it trimmed and the bytes of Goal it dropped. Each run
// is re-read in its own transaction, so a write the engine makes meanwhile is kept, and it is trimmed only if it
// still qualifies.
func Sweep(ctx context.Context, now time.Time) (int, int, error) {
	runs, err := wstore.DBGetAllObjsByType[*waveobj.Run](ctx, waveobj.OType_Run)
	if err != nil {
		return 0, 0, err
	}
	live := liveDags(runs)
	n, dropped := 0, 0
	for _, c := range Candidates(runs, now) {
		saved := 0
		err := wstore.DBUpdateFnErr(ctx, c.OID, func(r *waveobj.Run) error {
			if !shouldTrim(r, live, now) {
				return errSkip
			}
			before := len(r.Goal)
			r.Goal = TrimmedGoal(r.Goal)
			saved = before - len(r.Goal)
			return nil
		})
		if errors.Is(err, errSkip) {
			continue
		}
		if err != nil {
			return n, dropped, err
		}
		n++
		dropped += saved
	}
	return n, dropped, nil
}

var errSkip = errors.New("run no longer qualifies")

// StartLoop sweeps startDelay after start, then daily.
func StartLoop(ctx context.Context) {
	go func() {
		defer func() {
			panichandler.PanicHandler("runprune.Loop", recover())
		}()
		wait := startDelay
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			wait = interval
			n, dropped, err := Sweep(ctx, time.Now())
			if err != nil {
				log.Printf("runprune: trimming finished engine sessions' prompts: %v\n", err)
			}
			if n > 0 {
				log.Printf("runprune: trimmed the prompts of %d engine sessions that ended over %d days ago (%.1f MB)\n",
					n, int(Keep/(24*time.Hour)), float64(dropped)/1e6)
			}
		}
	}()
}
