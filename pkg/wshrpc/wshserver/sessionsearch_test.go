// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func digestResult(id string, lastActive int64) agentsessions.DigestResult {
	return agentsessions.DigestResult{
		Session: agentsessions.SessionInfo{ID: id, Runtime: "claude", Task: "task " + id, LastActiveTs: lastActive},
		Hits:    []agentsessions.Hit{{Kind: "turn", Speaker: "user", Text: "the deploy failed", Marks: [][2]int{{4, 10}}}},
	}
}

// linkByRole links each session whose id names a role to a run in that role; "unlinked" stays unlinked.
func linkByRole(sessions []wshrpc.SessionActivity) error {
	for i := range sessions {
		if role := sessions[i].ID; role != "unlinked" {
			sessions[i].RunId, sessions[i].ChannelId, sessions[i].Role = "run-"+role, "ch", role
		}
	}
	return nil
}

func resultIds(results []wshrpc.SessionSearchResult) []string {
	ids := make([]string, len(results))
	for i, r := range results {
		ids[i] = r.Session.ID
	}
	return ids
}

func TestSearchSessionsEmptyQuery(t *testing.T) {
	for _, q := range []string{"", "   ", `"`, `""`} {
		rtn, err := (&WshServer{}).SearchSessionsCommand(context.Background(), wshrpc.CommandSearchSessionsData{Query: q})
		if err != nil {
			t.Fatalf("query %q: %v", q, err)
		}
		if len(rtn.Terms) != 0 || len(rtn.Results) != 0 || rtn.Terms == nil || rtn.Results == nil {
			t.Fatalf("query %q gives no terms and no results, as empty lists: %+v", q, rtn)
		}
	}
}

// only claude and pi sessions are searched: the store is never asked about another runtime
func TestSearchSessionsUnsupportedRuntimeAnswersEmpty(t *testing.T) {
	searched := false
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) {
		searched = true
		return []agentsessions.DigestResult{digestResult("unlinked", 1)}, false
	}
	for _, rt := range []string{"codex", "opencode", "agy", "nonsense"} {
		rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy", Runtime: rt}, search, linkByRole)
		if len(rtn.Results) != 0 || rtn.Results == nil || rtn.Incomplete || rtn.Truncated {
			t.Errorf("runtime %s: want an empty answer, got %+v", rt, rtn)
		}
	}
	if searched {
		t.Error("an unsupported runtime must not reach the store")
	}
	for _, rt := range []string{"", "claude", "pi"} {
		if rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy", Runtime: rt}, search, linkByRole); len(rtn.Results) != 1 {
			t.Errorf("runtime %q is searched, got %+v", rt, rtn)
		}
	}
}

func TestSearchSessionsAsksTheStoreWhatTheRequestSays(t *testing.T) {
	var got agentsessions.DigestSearch
	search := func(o agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) {
		got = o
		return nil, true
	}
	rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: `fix "hook timeout"`, Runtime: "claude", ProjectPath: "/p/a"}, search, linkByRole)
	if !slices.Equal(got.Query.Terms, []string{"fix", "hook timeout"}) || got.Runtime != "claude" || got.ProjectPath != "/p/a" || got.MaxHits != 20 {
		t.Errorf("store asked %+v, want the parsed query, runtime, project and MaxHits 20", got)
	}
	if !slices.Equal(rtn.Terms, []string{"fix", "hook timeout"}) || !rtn.Incomplete {
		t.Errorf("the terms are the parsed query and incomplete passes through, got %+v", rtn)
	}
	searchSessions(wshrpc.CommandSearchSessionsData{Query: "x", MaxHits: 3}, search, linkByRole)
	if got.MaxHits != 3 {
		t.Errorf("MaxHits = %d, want the request's 3", got.MaxHits)
	}
}

func TestSearchSessionsDropsRunAgentsByDefault(t *testing.T) {
	var found []agentsessions.DigestResult
	for i, id := range []string{"lead", "worker", "review", "plan-reviewer", "verifier", "unlinked"} {
		found = append(found, digestResult(id, int64(100-i)))
	}
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) { return found, false }
	data := wshrpc.CommandSearchSessionsData{Query: "deploy"}
	if got := strings.Join(resultIds(searchSessions(data, search, linkByRole).Results), ","); got != "lead,unlinked" {
		t.Fatalf("the default keeps the user's sessions and a run's lead, got %s", got)
	}
	data.RunAgents = true
	if n := len(searchSessions(data, search, linkByRole).Results); n != 6 {
		t.Fatalf("runAgents keeps all six, got %d", n)
	}
}

func TestSearchSessionsShape(t *testing.T) {
	r := digestResult("lead", 100)
	r.Hits = []agentsessions.Hit{
		{Kind: "turn", Speaker: "user", Ord: 0, Text: "why did the deploy fail", Marks: [][2]int{{12, 18}}},
		{Kind: "event", Speaker: "errored", Ord: 1, Text: "deploy timeout", Marks: [][2]int{{0, 6}}},
	}
	r.TurnHits, r.EventHits = 2, 1
	r.Session.Events = []agentsessions.SessionEvent{{Type: "started", Ts: 1, Text: "deploy"}, {Type: "errored", Ts: 2, Text: "deploy timeout"}}
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) {
		return []agentsessions.DigestResult{r}, false
	}
	rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy"}, search, linkByRole)
	if len(rtn.Results) != 1 {
		t.Fatalf("want one result, got %d", len(rtn.Results))
	}
	got := rtn.Results[0]
	if got.TurnHits != 2 || got.EventHits != 1 {
		t.Fatalf("want 2 turn hits and 1 event hit, got %d and %d", got.TurnHits, got.EventHits)
	}
	if got.Session.RunId != "run-lead" || got.Session.Role != "lead" || got.Session.Task != "task lead" || len(got.Session.Events) != 2 {
		t.Fatalf("the session carries its run link and its events, got %+v", got.Session)
	}
	want := []wshrpc.SessionHit{
		{Kind: "turn", Speaker: "user", Ord: 0, Text: "why did the deploy fail", Marks: [][]int{{12, 18}}},
		{Kind: "event", Speaker: "errored", Ord: 1, Text: "deploy timeout", Marks: [][]int{{0, 6}}},
	}
	b, _ := json.Marshal(got.Hits)
	wb, _ := json.Marshal(want)
	if string(b) != string(wb) {
		t.Fatalf("hits:\n got %s\nwant %s", b, wb)
	}
	fb, _ := json.Marshal(got)
	if !strings.Contains(string(fb), `"turnhits":2`) || !strings.Contains(string(fb), `"eventhits":1`) || !strings.Contains(string(fb), `"marks":[[12,18]]`) {
		t.Fatalf("turnhits, eventhits and marks are on the wire, got %s", fb)
	}
}

// a title-only match has no hits, a session no events: none of them is null on the wire, which the frontend would
// have to guard
func TestSearchSessionsNeverSendsNull(t *testing.T) {
	r := digestResult("lead", 100)
	r.Hits = nil
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) {
		return []agentsessions.DigestResult{r}, false
	}
	for _, rtn := range []*wshrpc.CommandSearchSessionsRtnData{
		searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy"}, search, linkByRole),
		searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy", Runtime: "codex"}, search, linkByRole),
		searchSessions(wshrpc.CommandSearchSessionsData{Query: ""}, search, linkByRole),
	} {
		b, err := json.Marshal(rtn)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "null") {
			t.Errorf("no null on the wire, got %s", b)
		}
	}
}

func TestSearchSessionsNewestFirst(t *testing.T) {
	found := []agentsessions.DigestResult{digestResult("lead", 100), digestResult("unlinked", 300), digestResult("worker", 200)}
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) { return found, false }
	rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy", RunAgents: true}, search, linkByRole)
	if got := strings.Join(resultIds(rtn.Results), ","); got != "unlinked,worker,lead" {
		t.Fatalf("want newest first, got %s", got)
	}
}

// the limit is counted after a run's agents are dropped: workers newer than the user's own sessions must not fill it
func TestSearchSessionsLimitCountsAfterTheDrop(t *testing.T) {
	found := []agentsessions.DigestResult{
		digestResult("worker", 600), digestResult("review", 500), digestResult("verifier", 400),
		digestResult("unlinked", 300), digestResult("lead", 200), digestResult("unlinked", 100),
	}
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) { return found, false }
	rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy", Limit: 2}, search, linkByRole)
	if got := strings.Join(resultIds(rtn.Results), ","); got != "unlinked,lead" {
		t.Fatalf("with Limit 2 the two newest non-worker sessions come back, got %s", got)
	}
	if !rtn.Truncated {
		t.Error("a third non-worker session was left: truncated")
	}
	if rtn.Results[0].Session.LastActiveTs != 300 || rtn.Results[1].Session.LastActiveTs != 200 {
		t.Errorf("the newest two, got %d and %d", rtn.Results[0].Session.LastActiveTs, rtn.Results[1].Session.LastActiveTs)
	}

	rtn = searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy", Limit: 3}, search, linkByRole)
	if len(rtn.Results) != 3 || rtn.Truncated {
		t.Errorf("Limit 3 holds all three non-worker sessions and leaves none, got %d (truncated %v)", len(rtn.Results), rtn.Truncated)
	}
}

func TestSearchSessionsLimitDefaultsTo200(t *testing.T) {
	var found []agentsessions.DigestResult
	for i := range 250 {
		found = append(found, digestResult(fmt.Sprintf("s%03d", i), int64(1000-i)))
	}
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) { return found, false }
	linkNone := func([]wshrpc.SessionActivity) error { return nil }
	rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy"}, search, linkNone)
	if len(rtn.Results) != 200 || !rtn.Truncated || rtn.Results[0].Session.ID != "s000" {
		t.Fatalf("the newest 200 of 250, truncated, got %d (truncated %v)", len(rtn.Results), rtn.Truncated)
	}
}

func TestSearchSessionsKeepsResultsWhenLinkFails(t *testing.T) {
	found := []agentsessions.DigestResult{digestResult("lead", 100)}
	search := func(agentsessions.DigestSearch) ([]agentsessions.DigestResult, bool) { return found, false }
	fail := func([]wshrpc.SessionActivity) error { return errors.New("store down") }
	rtn := searchSessions(wshrpc.CommandSearchSessionsData{Query: "deploy"}, search, fail)
	if len(rtn.Results) != 1 || rtn.Results[0].Session.ID != "lead" {
		t.Fatalf("a link failure keeps the matched sessions, got %+v", rtn.Results)
	}
}
