// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	defaultSearchMaxHits = 20  // passages kept per session when the request names none
	defaultSearchLimit   = 200 // sessions returned when the request names no limit
)

// SearchSessionsCommand finds the past claude and pi conversations that say the query, newest first, from the digest
// files pkg/agentsessions keeps. Incomplete is set while some transcripts have no digest yet.
func (ws *WshServer) SearchSessionsCommand(ctx context.Context, data wshrpc.CommandSearchSessionsData) (*wshrpc.CommandSearchSessionsRtnData, error) {
	link := func(sessions []wshrpc.SessionActivity) error { return linkSessionsToRuns(ctx, sessions) }
	return searchSessions(data, agentsessions.SearchDigests, link), nil
}

// searchSessions answers a request from search, the digest store's search. An empty query, or a runtime other than
// claude and pi, is an empty answer and no error: the store is not asked.
func searchSessions(data wshrpc.CommandSearchSessionsData, search func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool), link func([]wshrpc.SessionActivity) error) *wshrpc.CommandSearchSessionsRtnData {
	rtn := &wshrpc.CommandSearchSessionsRtnData{Results: []wshrpc.SessionSearchResult{}, Terms: []string{}}
	q := agentsessions.ParseQuery(data.Query)
	if len(q.Terms) == 0 {
		return rtn
	}
	rtn.Terms = q.Terms
	if data.Runtime != "" && data.Runtime != "claude" && data.Runtime != "pi" {
		return rtn
	}
	maxHits := data.MaxHits
	if maxHits <= 0 {
		maxHits = defaultSearchMaxHits
	}
	found, incomplete := search(agentsessions.DigestSearch{Query: q, Runtime: data.Runtime, ProjectPath: data.ProjectPath, MaxHits: maxHits})
	rtn.Results, rtn.Truncated = searchResults(found, data.RunAgents, data.Limit, link)
	rtn.Incomplete = incomplete
	return rtn
}

// searchResults puts found on the wire, links the sessions to their runs, drops a run's agents unless runAgents, sorts
// newest first, and only then cuts the list at limit (defaultSearchLimit when it is not positive): a run's workers,
// which are dropped, never use up the limit and hide older sessions. truncated is whether more were left. A link error
// is logged and the results stay unlinked.
func searchResults(found []agentsessions.DigestResult, runAgents bool, limit int, link func([]wshrpc.SessionActivity) error) (results []wshrpc.SessionSearchResult, truncated bool) {
	wire := make([]wshrpc.SessionSearchResult, len(found))
	activity := make([]wshrpc.SessionActivity, len(found))
	for i, r := range found {
		activity[i] = sessionActivityToWire(r.Session)
		wire[i] = wshrpc.SessionSearchResult{Hits: hitsToWire(r.Hits), TurnHits: r.TurnHits, EventHits: r.EventHits}
	}
	if err := link(activity); err != nil {
		log.Printf("sessions search: %v", err)
	}
	results = make([]wshrpc.SessionSearchResult, 0, len(found))
	for i, r := range wire {
		if !runAgents && isRunAgent(activity[i].Role) {
			continue
		}
		r.Session = activity[i]
		results = append(results, r)
	}
	sort.SliceStable(results, func(i, j int) bool { return results[i].Session.LastActiveTs > results[j].Session.LastActiveTs })
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	if len(results) > limit {
		results, truncated = results[:limit], true
	}
	return results, truncated
}

// isRunAgent reports whether a session's run role makes it a run's agent (a worker, a reviewer, a stage session) rather
// than the user's own session or a run's lead.
func isRunAgent(role string) bool {
	return role != "" && role != sessionRole_Lead
}

// hitsToWire is the hits as the wire carries them; never nil, nor are the marks of a hit.
func hitsToWire(hits []agentsessions.Hit) []wshrpc.SessionHit {
	out := make([]wshrpc.SessionHit, len(hits))
	for i, h := range hits {
		marks := make([][]int, len(h.Marks))
		for j, m := range h.Marks {
			marks[j] = []int{m[0], m[1]}
		}
		out[i] = wshrpc.SessionHit{Kind: h.Kind, Speaker: h.Speaker, Ord: h.Ord, Text: h.Text, Marks: marks}
	}
	return out
}
