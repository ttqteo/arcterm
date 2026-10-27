// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// the cost rows' names for every type at once, and for a subagent whose meta file names none; pkg/tokengate reads "all"
const (
	SubagentTypeAll     = "all"
	SubagentTypeUnknown = "unknown"
)

const (
	// a subagent file whose last record is this recent is still running, its total not final
	subagentRunningFor = 60 * time.Second
	// how far back finished subagents price a spawn
	subagentCostDays = 30
)

// SubagentCost is what finished subagents of one type cost: how many, their mean total, and the p25, median and p90
// totals
type SubagentCost struct {
	Type    string
	Samples int
	Mean    int64
	P25     int64
	P50     int64
	P90     int64
}

// Burn is what a spawn is weighed by: the Claude tokens the 5h and weekly windows have seen, the part of them one
// session recorded (its subagents included), and what finished subagents cost by type. Every count is WindowTokens'
// sum, so they compare.
type Burn struct {
	Session         string // the session's id; "" when no path was given
	WindowFiveHour  int
	WindowWeek      int
	SessionFiveHour int
	SessionWeek     int
	Subagents       int // the session's subagent files with a record inside the week window
	Costs           []SubagentCost
}

// subagentFile is one subagent transcript: the session it bills to, its type, its first and last record, its total
type subagentFile struct {
	session   string
	agentType string
	first     time.Time
	last      time.Time
	total     int64
}

func (f subagentFile) finished(now time.Time) bool {
	return now.Sub(f.last) >= subagentRunningFor
}

func claudeProjectsRoot() string {
	return filepath.Join(wavebase.GetHomeDir(), ".claude", "projects")
}

// SubagentCosts is what the finished subagents of the last 30 days cost by type: the most sampled type first, the
// every-type row last
func SubagentCosts(now time.Time) []SubagentCost {
	return subagentCostsIn(claudeProjectsRoot(), now)
}

func subagentCostsIn(root string, now time.Time) []SubagentCost {
	files := subagentScanFiles(walkClaudeFiles(root, now.AddDate(0, 0, -subagentCostDays-1)))
	return subagentCosts(subagentFiles(files, parseEach(files)), now)
}

// subagentScanFiles keeps the files under a subagents dir
func subagentScanFiles(files []scanFile) []scanFile {
	var out []scanFile
	for _, f := range files {
		if _, sub := claudeSessionOf(f.path); sub {
			out = append(out, f)
		}
	}
	return out
}

// subagentFiles folds each subagent transcript among files (perFile holds their records, by index) into one entry
func subagentFiles(files []scanFile, perFile [][]Record) []subagentFile {
	var out []subagentFile
	for i, recs := range perFile {
		session, sub := claudeSessionOf(files[i].path)
		if !sub || len(recs) == 0 {
			continue
		}
		f := subagentFile{session: session, agentType: agentTypeOf(files[i].path), first: recs[0].TS, last: recs[0].TS}
		for _, r := range recs {
			if r.TS.Before(f.first) {
				f.first = r.TS
			}
			if r.TS.After(f.last) {
				f.last = r.TS
			}
			f.total += int64(recordTokens(r))
		}
		out = append(out, f)
	}
	return out
}

// agentTypeOf reads the agentType Claude Code writes beside a subagent transcript, in <name>.meta.json
func agentTypeOf(path string) string {
	data, err := os.ReadFile(strings.TrimSuffix(path, ".jsonl") + ".meta.json")
	if err != nil {
		return SubagentTypeUnknown
	}
	var meta struct {
		AgentType string `json:"agentType"`
	}
	if json.Unmarshal(data, &meta) != nil || meta.AgentType == "" {
		return SubagentTypeUnknown
	}
	return meta.AgentType
}

// subagentCosts groups the finished subagents whose last record is within subagentCostDays by type
func subagentCosts(subs []subagentFile, now time.Time) []SubagentCost {
	since := now.AddDate(0, 0, -subagentCostDays)
	byType := map[string][]int64{}
	var all []int64
	for _, f := range subs {
		if !f.finished(now) || f.last.Before(since) {
			continue
		}
		byType[f.agentType] = append(byType[f.agentType], f.total)
		all = append(all, f.total)
	}
	out := make([]SubagentCost, 0, len(byType)+1)
	for t, totals := range byType {
		out = append(out, costOf(t, totals))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Samples != out[j].Samples {
			return out[i].Samples > out[j].Samples
		}
		return out[i].Type < out[j].Type
	})
	if len(all) > 0 {
		out = append(out, costOf(SubagentTypeAll, all))
	}
	return out
}

func costOf(agentType string, totals []int64) SubagentCost {
	sorted := slices.Clone(totals)
	slices.Sort(sorted)
	var sum int64
	for _, v := range sorted {
		sum += v
	}
	return SubagentCost{
		Type:    agentType,
		Samples: len(sorted),
		Mean:    sum / int64(len(sorted)),
		P25:     nearestRank(sorted, 25),
		P50:     nearestRank(sorted, 50),
		P90:     nearestRank(sorted, 90),
	}
}

// nearestRank is the p-th percentile of sorted (ascending, not empty) by nearest rank: the ceil(p/100 × n)-th value
func nearestRank(sorted []int64, p int) int64 {
	rank := max((p*len(sorted)+99)/100, 1)
	return sorted[rank-1]
}

// SessionBurn reads the Claude transcripts once for a spawn. path is the session's transcript or one of its
// subagents' ("" leaves the session fields 0); a zero cutoff is the trailing window.
func SessionBurn(path string, fiveHourCutoff, weekCutoff, now time.Time) Burn {
	return sessionBurn(claudeProjectsRoot(), path, fiveHourCutoff, weekCutoff, now)
}

func sessionBurn(root, path string, fiveHourCutoff, weekCutoff, now time.Time) Burn {
	if fiveHourCutoff.IsZero() {
		fiveHourCutoff = now.Add(-5 * time.Hour)
	}
	if weekCutoff.IsZero() {
		weekCutoff = now.Add(-7 * 24 * time.Hour)
	}
	earliest := now.AddDate(0, 0, -subagentCostDays)
	if weekCutoff.Before(earliest) {
		earliest = weekCutoff
	}
	var b Burn
	if path != "" {
		b.Session, _ = claudeSessionOf(path)
	}
	files := walkClaudeFiles(root, earliest.AddDate(0, 0, -1))
	perFile := parseEach(files)
	var all []Record
	for _, recs := range perFile {
		all = append(all, recs...)
	}
	subs := subagentFiles(files, perFile)
	for _, f := range subs {
		if b.Session != "" && f.session == b.Session && !f.last.Before(weekCutoff) {
			b.Subagents++
		}
	}
	b.Costs = subagentCosts(subs, now)

	cutoffs := []time.Time{fiveHourCutoff, weekCutoff}
	deduped := dedupe(all)
	windows := sumRecordsSinceCutoffs(deduped, cutoffs)
	b.WindowFiveHour, b.WindowWeek = windows[0], windows[1]
	if b.Session != "" {
		var mine []Record
		for _, r := range deduped {
			if r.Session == b.Session {
				mine = append(mine, r)
			}
		}
		sums := sumRecordsSinceCutoffs(mine, cutoffs)
		b.SessionFiveHour, b.SessionWeek = sums[0], sums[1]
	}
	return b
}

// recordTokens is one record's tokens as WindowTokens sums them
func recordTokens(r Record) int {
	return r.Input + r.Output + r.Reasoning + r.CacheRead + r.CacheCreate
}
