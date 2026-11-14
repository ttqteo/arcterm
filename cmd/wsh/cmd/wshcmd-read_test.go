// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
)

func TestParseReadRef(t *testing.T) {
	cases := []struct {
		arg, kind, id, err string
	}{
		{arg: "8e33269b", id: "8e33269b"},
		{arg: "  @8E33269B ", id: "8e33269b"},
		{arg: "council:0c28170c", kind: "council", id: "0c28170c"},
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

func TestReadAmbiguousListsKindIds(t *testing.T) {
	err := readAmbiguous("8e33", []readHit{{Kind: readKindAgent, Id: "8e33aa", Label: "arcterm · claude"}, {Kind: readKindRun, Id: "8e33bb", Label: "arcterm · done"}})
	for _, want := range []string{"names 2 things", "agent:8e33aa  arcterm · claude", "run:8e33bb  arcterm · done"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
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
