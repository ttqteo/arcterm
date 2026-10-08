// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Per-session Claude usage: the records the bucket scan already parses, folded per session instead of
// per (model, day), so the Usage surface can say which tab spent what and why.

package usagestats

import (
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// SessionModelTokens is one (model, subagent or not) slice of a session's tokens. The frontend prices
// each with its own model's rates (usagepricing.ts holds the only price table).
type SessionModelTokens struct {
	Model         string
	Sub           bool
	Input         int
	Output        int
	CacheRead     int
	CacheCreate   int
	CacheCreate1h int
}

type SessionUsage struct {
	ID          string
	Title       string
	Project     string
	Models      []SessionModelTokens
	Turns       int // main-session records
	SubTurns    int // subagent records
	AvgCtx      int // over main turns: input + cache read + cache write
	MaxCtx      int
	ColdResumes int // main turns after more than coldGap idle that wrote more than coldMinWrite of cache
	ColdTokens  int
	FirstTs     int64 // unix ms
	LastTs      int64
}

const (
	coldGap      = 60 * time.Minute // Claude Code's prompt cache lives an hour
	coldMinWrite = 50_000
)

// engineRunProject is the Project of a session that ran in one of the engine's worktrees: a run's tasks
// each get a worktree (and so a cwd) of their own, which would otherwise list as a project apiece.
const engineRunProject = "engine run"

// ScanSessionUsage folds the user's Claude transcripts within the last windowDays (0 = all-time) per
// session.
func ScanSessionUsage(windowDays int) []SessionUsage {
	return scanSessionRoot(filepath.Join(wavebase.GetHomeDir(), ".claude", "projects"), windowDays)
}

// scanSessionRoot is ScanUsage's Claude half with the same window, dedupe and <synthetic> rules, folded
// per session, so a session table sums to the same tokens as the buckets.
func scanSessionRoot(root string, windowDays int) []SessionUsage {
	var cutoff, since time.Time
	if windowDays > 0 {
		cutoff = time.Now().AddDate(0, 0, -windowDays-1)
		since = windowStart(time.Now(), windowDays)
	}
	var records []Record
	for _, r := range parseFiles(walkClaudeFiles(root, cutoff)) {
		if since.IsZero() || !r.TS.Before(since) {
			records = append(records, r)
		}
	}
	return foldSessions(dedupe(records))
}

// foldSessions groups deduped Claude records by Session. Records are taken in time order, which the
// context and cold-resume rules need; the result is newest session first.
func foldSessions(recs []Record) []SessionUsage {
	sort.SliceStable(recs, func(i, j int) bool { return recs[i].TS.Before(recs[j].TS) })
	type modelKey struct {
		model string
		sub   bool
	}
	type acc struct {
		s        SessionUsage
		models   map[modelKey]*SessionModelTokens
		ctxSum   int
		lastMain time.Time // zero until the first main turn
	}
	bySession := map[string]*acc{}
	for _, r := range recs {
		if r.Model == "<synthetic>" {
			continue
		}
		a := bySession[r.Session]
		if a == nil {
			a = &acc{s: SessionUsage{ID: r.Session}, models: map[modelKey]*SessionModelTokens{}}
			bySession[r.Session] = a
		}
		k := modelKey{r.Model, r.Sub}
		m := a.models[k]
		if m == nil {
			m = &SessionModelTokens{Model: r.Model, Sub: r.Sub}
			a.models[k] = m
		}
		m.Input += r.Input
		m.Output += r.Output
		m.CacheRead += r.CacheRead
		m.CacheCreate += r.CacheCreate
		m.CacheCreate1h += r.CacheCreate1h

		ms := r.TS.UnixMilli()
		if a.s.FirstTs == 0 || ms < a.s.FirstTs {
			a.s.FirstTs = ms
		}
		if ms > a.s.LastTs {
			a.s.LastTs = ms
		}
		if r.Sub {
			a.s.SubTurns++
			continue
		}
		a.s.Turns++
		if r.Title != "" {
			a.s.Title = r.Title
		}
		if r.Cwd != "" {
			a.s.Project = projectOf(r.Cwd)
		}
		ctx := r.Input + r.CacheRead + r.CacheCreate
		a.ctxSum += ctx
		if ctx > a.s.MaxCtx {
			a.s.MaxCtx = ctx
		}
		if !a.lastMain.IsZero() && r.TS.Sub(a.lastMain) > coldGap && r.CacheCreate > coldMinWrite {
			a.s.ColdResumes++
			a.s.ColdTokens += r.CacheCreate
		}
		a.lastMain = r.TS
	}
	out := make([]SessionUsage, 0, len(bySession))
	for _, a := range bySession {
		if a.s.Turns > 0 {
			a.s.AvgCtx = a.ctxSum / a.s.Turns
		}
		for _, m := range a.models {
			a.s.Models = append(a.s.Models, *m)
		}
		sort.Slice(a.s.Models, func(i, j int) bool {
			x, y := a.s.Models[i], a.s.Models[j]
			if x.Model != y.Model {
				return x.Model < y.Model
			}
			return !x.Sub && y.Sub
		})
		out = append(out, a.s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastTs != out[j].LastTs {
			return out[i].LastTs > out[j].LastTs
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// claudeSessionOf names the session a Claude transcript bills to: its file stem, or for a file under a
// subagents directory the directory above the outermost one (a nested subagent bills to the top session).
func claudeSessionOf(path string) (session string, sub bool) {
	dir := filepath.Dir(path)
	for {
		parent := filepath.Dir(dir)
		if filepath.Base(dir) == "subagents" {
			session, sub = filepath.Base(parent), true
		}
		if parent == dir {
			break
		}
		dir = parent
	}
	if sub {
		return session, true
	}
	return strings.TrimSuffix(filepath.Base(path), ".jsonl"), false
}

// lastAiTitle is the trimmed aiTitle of the last ai-title line in lines, "" when none.
func lastAiTitle(lines []string) string {
	title := ""
	for _, line := range lines {
		if !strings.Contains(line, string(aiTitleMarker)) {
			continue
		}
		var rec struct {
			Type    string `json:"type"`
			AiTitle string `json:"aiTitle"`
		}
		if json.Unmarshal([]byte(line), &rec) != nil || rec.Type != "ai-title" {
			continue
		}
		if t := strings.TrimSpace(rec.AiTitle); t != "" {
			title = t
		}
	}
	return title
}

// projectOf names the project a cwd belongs to: its last segment, or engineRunProject for a path inside
// an engine worktree (<repo>/.waveterm/worktrees/<run>[-<task>]..., see runOfWorktree in
// pkg/orchestrate). "" for an empty cwd.
func projectOf(cwd string) string {
	parts := strings.Split(strings.ReplaceAll(cwd, `\`, "/"), "/")
	last := ""
	for i, p := range parts {
		if p == "" {
			continue
		}
		if p == ".waveterm" && i+2 < len(parts) && parts[i+1] == "worktrees" && parts[i+2] != "" {
			return engineRunProject
		}
		last = p
	}
	return last
}
