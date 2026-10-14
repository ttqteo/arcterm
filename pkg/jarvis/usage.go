// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	UsageRole_Lead     = "lead"
	UsageRole_Worker   = "worker"
	UsageRole_Reviewer = "reviewer"
	// UsageRole_PlanReviewer is a run's StageRole as well: the engine's plan reviewer at submit.
	UsageRole_PlanReviewer = "plan-reviewer"
	// UsageRole_Verifier is a run's StageRole as well: the engine's final verifier on the merged result.
	UsageRole_Verifier = "verifier"
	// UsageRole_LandResolver is a run's StageRole as well: the engine's session merging the base into a run's branch
	// when a land conflicts.
	UsageRole_LandResolver = "land-resolver"
)

// UsageRole is the part a run played in its dag: a dag-level judging session (its StageRole), the child that
// reviews a task, the child that works one, or the lead that owns the dag.
func UsageRole(r *waveobj.Run) string {
	switch {
	case r.StageRole != "":
		return r.StageRole
	case r.Review:
		return UsageRole_Reviewer
	case r.TaskId != "":
		return UsageRole_Worker
	}
	return UsageRole_Lead
}

// usageRoleOrder places a task's rows: its worker before its reviewer. Roles without a task sort by task
// id alone, so they need no entry.
var usageRoleOrder = map[string]int{UsageRole_Worker: 0, UsageRole_Reviewer: 1}

// DagChildRuns is every run in a dag's channel that shares its DagORef, the owner aside: retries and
// reviewers included, since a task's own links move on at a retry or a verdict.
// A read failure degrades to none, so a usage total never fails the caller.
func DagChildRuns(ctx context.Context, channelId, dagId, ownerId string) []*waveobj.Run {
	if dagId == "" {
		return nil
	}
	runs, err := wstore.GetChannelRuns(ctx, channelId)
	if err != nil {
		log.Printf("usage: loading runs of dag %s: %v", dagId, err)
		return nil
	}
	var out []*waveobj.Run
	for _, r := range runs {
		if r.DagORef == dagId && r.ID != ownerId {
			out = append(out, r)
		}
	}
	return out
}

// RunUsage totals a dag run's tokens: one row per (session, model), the lead's sessions first, then the
// children by task id with a task's worker before its reviewer. A child the engine did not launch under a
// session id has no transcript of its own and is left out. A session whose transcript cannot be found is
// a zero row marked Missing, never an error.
func RunUsage(ctx context.Context, owner *waveobj.Run, children []*waveobj.Run) []waveobj.UsageRow {
	var rows []waveobj.UsageRow
	if owner != nil {
		for _, path := range leadTranscriptPaths(owner) {
			rows = append(rows, sessionUsage(UsageRole(owner), "", path)...)
		}
	}
	var launched []*waveobj.Run
	for _, c := range children {
		if c != nil && c.SessionId != "" {
			launched = append(launched, c)
		}
	}
	sort.SliceStable(launched, func(i, j int) bool {
		a, b := launched[i], launched[j]
		if a.TaskId != b.TaskId {
			return taskIdLess(a.TaskId, b.TaskId)
		}
		if ra, rb := usageRoleOrder[UsageRole(a)], usageRoleOrder[UsageRole(b)]; ra != rb {
			return ra < rb
		}
		return a.CreatedTs < b.CreatedTs
	})
	for _, c := range launched {
		if ctx.Err() != nil {
			break
		}
		rows = append(rows, sessionUsage(UsageRole(c), c.TaskId, SessionTranscriptPath(c))...)
	}
	return rows
}

// leadTranscriptPaths is one path per lead session, "" for a session whose transcript is not on disk. Every
// recorded session counts; a run from before sessions were recorded falls back to its last session id, then
// to its lead tabs.
func leadTranscriptPaths(owner *waveobj.Run) []string {
	ids := owner.LeadSessionIds
	if len(ids) == 0 && owner.SessionId != "" {
		ids = []string{owner.SessionId}
	}
	runtime := runroute.DefaultRuntime(owner.Runtime)
	var paths []string
	for _, id := range ids {
		paths = append(paths, agentsessions.TranscriptForSession(transcriptRootFor(runtime), runtime, LandPath(owner), id))
	}
	if len(ids) > 0 {
		return paths
	}
	// tabs resolve by cwd, so two lead tabs in one tree name the same newest transcript: count it once
	seen := map[string]bool{}
	for _, p := range owner.Phases {
		for _, oref := range p.WorkerOrefs {
			if !strings.HasPrefix(oref, "tab:") {
				continue
			}
			if path := TranscriptPathForTab(strings.TrimPrefix(oref, "tab:")); path != "" && !seen[path] {
				seen[path] = true
				paths = append(paths, path)
			}
		}
	}
	return paths
}

// sessionUsage sums one transcript's buckets per model, models in name order.
func sessionUsage(role, taskId, path string) []waveobj.UsageRow {
	missing := []waveobj.UsageRow{{Role: role, TaskId: taskId, Missing: true}}
	if path == "" {
		return missing
	}
	if _, err := os.Stat(path); err != nil {
		return missing
	}
	buckets, err := usagestats.TranscriptUsage(path)
	if err != nil {
		log.Printf("usage: reading %s: %v", path, err)
		return missing
	}
	byModel := map[string]*waveobj.UsageRow{}
	var models []string
	for _, b := range buckets {
		row := byModel[b.Model]
		if row == nil {
			row = &waveobj.UsageRow{Role: role, TaskId: taskId, Model: b.Model}
			byModel[b.Model] = row
			models = append(models, b.Model)
		}
		row.Input += b.Input
		// reasoning is billed as output; pi and opencode report it apart
		row.Output += b.Output + b.Reasoning
		row.CacheRead += b.CacheRead
		// CacheCreate counts every cache write, the 1h ones included
		row.CacheWrite += b.CacheCreate - b.CacheCreate1h
		row.CacheWrite1h += b.CacheCreate1h
		row.Msgs += b.Msgs
	}
	sort.Strings(models)
	rows := make([]waveobj.UsageRow, len(models))
	for i, m := range models {
		rows[i] = *byModel[m]
	}
	return rows
}

// UsageTokens is a row's total tokens, every class counted once.
func UsageTokens(r waveobj.UsageRow) int {
	return r.Input + r.Output + r.CacheRead + r.CacheWrite + r.CacheWrite1h
}

// taskIdLess orders "t-2" before "t-10": by the number after the last dash when both have one.
func taskIdLess(a, b string) bool {
	na, aok := taskIdNum(a)
	nb, bok := taskIdNum(b)
	if aok && bok && na != nb {
		return na < nb
	}
	return a < b
}

func taskIdNum(id string) (int, bool) {
	n, err := strconv.Atoi(id[strings.LastIndex(id, "-")+1:])
	return n, err == nil
}
