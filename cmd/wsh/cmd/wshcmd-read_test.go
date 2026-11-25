// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestParseReadRef(t *testing.T) {
	cases := []struct {
		arg, kind, id, err string
	}{
		{arg: "8e33269b", id: "8e33269b"},
		{arg: "  @8E33269B ", id: "8e33269b"},
		{arg: "council:0c28170c", kind: "council", id: "0c28170c"},
		{arg: "pair:3F9A1C2E", kind: "pair", id: "3f9a1c2e"},
		{arg: "tab:8e33", kind: "agent", id: "8e33"},
		{arg: "Agent:8e33269b", kind: "agent", id: "8e33269b"},
		{arg: "session:4b199176-37ab", kind: "session", id: "4b199176-37ab"},
		{arg: "abc", err: "too short"},
		{arg: "run:abc", err: "too short"},
		{arg: "council:", err: "needs an id"},
		{arg: "foo:12345678", err: "not a kind"},
	}
	for _, c := range cases {
		kind, id, err := parseReadRef(c.arg)
		if c.err != "" {
			if err == nil || !strings.Contains(err.Error(), c.err) {
				t.Errorf("parseReadRef(%q) err = %v, want one with %q", c.arg, err, c.err)
			}
			continue
		}
		if err != nil || kind != c.kind || id != c.id {
			t.Errorf("parseReadRef(%q) = %q, %q, %v; want %q, %q", c.arg, kind, id, err, c.kind, c.id)
		}
	}
}

func TestPickReadHits(t *testing.T) {
	cands := []readHit{
		{Kind: readKindSession, Id: "8e33269b-aaaa"},
		{Kind: readKindRun, Id: "8E33269B-bbbb"},
		{Kind: readKindAgent, Id: "8e33269b-cccc"},
		{Kind: readKindCouncil, Id: "0c28170c368b5ab0"},
	}
	got := pickReadHits("8e33269b", cands)
	if len(got) != 3 || got[0].Kind != readKindAgent || got[1].Kind != readKindRun || got[2].Kind != readKindSession {
		t.Fatalf("prefix hits = %+v, want agent, run, session in that order", got)
	}
	// an exact id wins over the ids it starts
	exact := append(cands, readHit{Kind: readKindEffort, Id: "8e33269b"})
	if got := pickReadHits("8e33269b", exact); len(got) != 1 || got[0].Kind != readKindEffort {
		t.Fatalf("exact hits = %+v, want the effort alone", got)
	}
	if got := pickReadHits("ffffffff", cands); len(got) != 0 {
		t.Fatalf("no hit expected, got %+v", got)
	}
}

// a pair sorts after a council and before an initiative or a past conversation in a match list
func TestPickReadHitsPairSortsAfterCouncil(t *testing.T) {
	cands := []readHit{
		{Kind: readKindSession, Id: "8e33269b-aaaa"},
		{Kind: readKindPair, Id: "8e33269b-dddd"},
		{Kind: readKindEffort, Id: "8e33269b-ffff"},
		{Kind: readKindCouncil, Id: "8e33269b-eeee"},
	}
	got := pickReadHits("8e33269b", cands)
	want := []string{readKindCouncil, readKindPair, readKindEffort, readKindSession}
	if len(got) != len(want) {
		t.Fatalf("hits = %+v, want %v", got, want)
	}
	for i, k := range want {
		if got[i].Kind != k {
			t.Fatalf("hits = %+v, want %v in that order", got, want)
		}
	}
}

func TestReadAmbiguousListsKindIds(t *testing.T) {
	err := readAmbiguous("8e33", []readHit{{Kind: readKindAgent, Id: "8e33aa", Label: "arcterm · claude"}, {Kind: readKindRun, Id: "8e33bb", Label: "arcterm · done"}})
	for _, want := range []string{"names 2 things", "agent:8e33aa  arcterm · claude", "run:8e33bb  arcterm · done"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
	}
}

func TestReadPairLabel(t *testing.T) {
	info := wshrpc.PairInfo{
		Id:     "3f9a1c2e-0000",
		State:  "ended",
		Worker: wshrpc.PairSide{Tab: "w0w0w0w0-1", Name: "Plan oracle"},
		Judges: []wshrpc.PairSide{{Tab: "4c6ba858-aaaa"}},
	}
	if got, want := readPairLabel(info), "ended · Plan oracle · judge 4c6ba858"; got != want {
		t.Errorf("label = %q, want %q", got, want)
	}
	info.Synced = true
	info.Judges = append(info.Judges, wshrpc.PairSide{Tab: "9d1e0b77-bbbb"})
	if got, want := readPairLabel(info), "ended · Plan oracle · judge 4c6ba858, 9d1e0b77 · synced"; got != want {
		t.Errorf("synced label = %q, want %q", got, want)
	}
	info.Worker.Name = ""
	if got, want := readPairLabel(info), "ended · Working agent · judge 4c6ba858, 9d1e0b77 · synced"; got != want {
		t.Errorf("unnamed worker label = %q, want %q", got, want)
	}
}

func TestFormatReadTurns(t *testing.T) {
	msgs := []agentsessions.PeekMessage{
		{Role: "user", Text: "pick a retry limit?"},
		{Role: "assistant", Text: "Three retries, because… (clipped)"},
	}
	got := formatReadTurns(msgs, "Three retries, because the backoff doubles, in full")
	want := "## You\n\npick a retry limit?\n\n## Agent\n\nThree retries, because the backoff doubles, in full\n\n"
	if got != want {
		t.Fatalf("formatReadTurns = %q, want %q", got, want)
	}
	// a turn still open ends in the prompt: the last answer is an older one and is not put under it
	open := append(msgs, agentsessions.PeekMessage{Role: "user", Text: "next?"})
	if got := formatReadTurns(open, "full"); !strings.Contains(got, "(clipped)") || strings.Contains(got, "full") {
		t.Fatalf("an open turn kept its clipped answer: %q", got)
	}
	if got := formatReadTurns(nil, " only this "); got != "## Last answer\n\nonly this\n" {
		t.Fatalf("answer alone = %q", got)
	}
	if got := formatReadTurns(nil, ""); got != "_No answer yet._\n" {
		t.Fatalf("nothing = %q", got)
	}
}
