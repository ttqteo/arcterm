// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"slices"
	"sort"
	"time"
)

// how long after a logged spawn its subagents' first records may start and still be its own
const reviewMatchWindow = 10 * time.Minute

// EstimateLine is one line of the Token burn estimate log (~/.arc/tokengate/estimates.jsonl); pkg/tokengate's LogLine
// writes the same JSON
type EstimateLine struct {
	Ts       int64    `json:"ts"` // epoch seconds
	Session  string   `json:"session"`
	Tool     string   `json:"tool"`
	Agents   int      `json:"agents"`
	Types    []string `json:"types"`
	Estimate int64    `json:"estimate"` // the sum of the agents' mean costs, which the window shares weigh
	Typical  int64    `json:"typical"`  // the sum of their medians, the figure the card said; 0 on a line from before it, whose card said Estimate
	Low      int64    `json:"low"`
	High     int64    `json:"high"`    // 0: the card showed no range
	Verdict  string   `json:"verdict"` // run, allow, allow-turn, allow-session, deny
}

// EstimateReview is how the logged estimates of the last days compare with what their subagents cost
type EstimateReview struct {
	Logged      int          // lines in the period
	Run         int          // of them, groups that ran (every verdict but deny)
	Matched     int          // of them, groups whose session had finished subagents start within reviewMatchWindow
	MedianRatio float64      // actual ÷ the card's figure over the matched groups; 0 with none
	TotalRatio  float64      // the matched groups' actual over their Estimate, both summed: how the mean holds up in total
	WithRange   int          // matched groups whose estimate had a range
	InRange     int          // of them, those whose actual fell inside it
	ByType      []TypeReview // matched groups whose agents were all of one type, the most matched first
}

type TypeReview struct {
	Type        string
	Matched     int
	MedianRatio float64
}

// ReviewEstimates reads the estimate log at logPath for the last days and matches each group that ran with the
// finished subagents its session started within reviewMatchWindow after it, the earliest first, at most its agent
// count. A missing log is an empty review.
func ReviewEstimates(logPath string, days int, now time.Time) (EstimateReview, error) {
	return reviewEstimatesIn(claudeProjectsRoot(), logPath, days, now)
}

func reviewEstimatesIn(root, logPath string, days int, now time.Time) (EstimateReview, error) {
	since := now.AddDate(0, 0, -days)
	lines, err := readEstimateLog(logPath, since)
	if err != nil {
		return EstimateReview{}, err
	}
	files := subagentScanFiles(walkClaudeFiles(root, since.AddDate(0, 0, -1)))
	bySession := map[string][]subagentFile{}
	for _, f := range subagentFiles(files, parseEach(files)) {
		if f.finished(now) {
			bySession[f.session] = append(bySession[f.session], f)
		}
	}
	for _, subs := range bySession {
		sort.Slice(subs, func(i, j int) bool { return subs[i].first.Before(subs[j].first) })
	}
	taken := map[string][]bool{}
	var rev EstimateReview
	var ratios []float64
	var actualSum, estimateSum int64
	typeRatios := map[string][]float64{}
	for _, l := range lines {
		rev.Logged++
		if l.Verdict == "deny" {
			continue
		}
		rev.Run++
		// a Council starts no Agent call: its calls are `claude -p` runs of wavesrv's, which leave no subagent files
		// in the asking session, so matching it would take another group's subagents
		if l.Tool == "Council" {
			continue
		}
		subs := bySession[l.Session]
		if l.Session == "" || l.Estimate <= 0 || len(subs) == 0 {
			continue
		}
		if taken[l.Session] == nil {
			taken[l.Session] = make([]bool, len(subs))
		}
		start := time.Unix(l.Ts, 0)
		var actual int64
		n := 0
		for i, f := range subs {
			if n == max(l.Agents, 1) || f.first.Sub(start) > reviewMatchWindow {
				break
			}
			if taken[l.Session][i] || f.first.Before(start) {
				continue
			}
			taken[l.Session][i] = true
			actual += f.total
			n++
		}
		if n == 0 {
			continue
		}
		rev.Matched++
		figure := l.Typical
		if figure <= 0 {
			figure = l.Estimate
		}
		ratio := float64(actual) / float64(figure)
		actualSum += actual
		estimateSum += l.Estimate
		ratios = append(ratios, ratio)
		if l.High > 0 {
			rev.WithRange++
			if actual >= l.Low && actual <= l.High {
				rev.InRange++
			}
		}
		if t, ok := singleType(l.Types); ok {
			typeRatios[t] = append(typeRatios[t], ratio)
		}
	}
	rev.MedianRatio = median(ratios)
	if estimateSum > 0 {
		rev.TotalRatio = float64(actualSum) / float64(estimateSum)
	}
	for t, rs := range typeRatios {
		rev.ByType = append(rev.ByType, TypeReview{Type: t, Matched: len(rs), MedianRatio: median(rs)})
	}
	sort.Slice(rev.ByType, func(i, j int) bool {
		if rev.ByType[i].Matched != rev.ByType[j].Matched {
			return rev.ByType[i].Matched > rev.ByType[j].Matched
		}
		return rev.ByType[i].Type < rev.ByType[j].Type
	})
	return rev, nil
}

// readEstimateLog reads the log's lines from since on, oldest first, skipping lines that do not parse; a missing log
// is no lines
func readEstimateLog(path string, since time.Time) ([]EstimateLine, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []EstimateLine
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		var l EstimateLine
		if json.Unmarshal(sc.Bytes(), &l) != nil || l.Ts < since.Unix() {
			continue
		}
		out = append(out, l)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Ts < out[j].Ts })
	return out, sc.Err()
}

// singleType is the one type every agent of a group had, when there is one
func singleType(types []string) (string, bool) {
	if len(types) == 0 || types[0] == "" {
		return "", false
	}
	for _, t := range types[1:] {
		if t != types[0] {
			return "", false
		}
	}
	return types[0], true
}

func median(vs []float64) float64 {
	if len(vs) == 0 {
		return 0
	}
	s := slices.Clone(vs)
	slices.Sort(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}
