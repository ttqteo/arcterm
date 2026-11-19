// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boardforward

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
)

func TestMarker(t *testing.T) {
	cases := []struct {
		name                   string
		board, on, turnId, ask string
		want                   string
	}{
		{
			name:  "with a selection",
			board: "Auth flow", on: "Login box, Token store", turnId: "t-1", ask: "why two stores?",
			want: "[From board \"Auth flow\" · on Login box, Token store · turn t-1]\nwhy two stores?",
		},
		{
			name:  "nothing selected leaves the on part out",
			board: "Auth flow", on: "", turnId: "t-2", ask: "what is this?",
			want: "[From board \"Auth flow\" · turn t-2]\nwhat is this?",
		},
		{
			name:  "multi-line name and labels collapse to one line each",
			board: "Auth\n flow\r\n", on: "Login\nbox,  Token\n\nstore", turnId: "t-3", ask: "line one\nline two",
			want: "[From board \"Auth flow\" · on Login box, Token store · turn t-3]\nline one\nline two",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Marker(tc.board, tc.on, tc.turnId, tc.ask)
			if got != tc.want {
				t.Errorf("Marker:\n got %q\nwant %q", got, tc.want)
			}
			if strings.HasPrefix(got, "/") {
				t.Errorf("the typed message must not start with a slash: %q", got)
			}
		})
	}
}

func TestMarkerNeverStartsWithSlash(t *testing.T) {
	got := Marker("/clear", "/etc", "t-4", "/compact")
	if strings.HasPrefix(got, "/") {
		t.Errorf("a board named like a command made a slash command: %q", got)
	}
}

func TestReplyAfter(t *testing.T) {
	asked := Marker("Auth flow", "", "t-9", "why two stores?")
	user := func(text string, ts int64) agentsessions.Turn {
		return agentsessions.Turn{Speaker: "user", Text: text, Ts: ts}
	}
	agent := func(text string, ts int64) agentsessions.Turn {
		return agentsessions.Turn{Speaker: "agent", Text: text, Ts: ts}
	}
	cases := []struct {
		name      string
		turns     []agentsessions.Turn
		wantReply string
		wantTs    int64
		wantOK    bool
	}{
		{
			name:      "the last agent text between the marked entry and the next user entry",
			turns:     []agentsessions.Turn{agent("an earlier answer", 1), user(asked, 2), agent("looking", 3), agent("one store caches", 4), user("next", 5), agent("later", 6)},
			wantReply: "one store caches", wantTs: 4, wantOK: true,
		},
		{
			name:      "up to the end when no user entry follows",
			turns:     []agentsessions.Turn{user(asked, 2), agent("one store caches", 4)},
			wantReply: "one store caches", wantTs: 4, wantOK: true,
		},
		{
			name:  "no marked entry",
			turns: []agentsessions.Turn{user("why two stores?", 2), agent("one store caches", 4)},
		},
		{
			name:  "another turn's marker",
			turns: []agentsessions.Turn{user(Marker("Auth flow", "", "t-1", "why two stores?"), 2), agent("one store caches", 4)},
		},
		{
			name:  "a turn id that only starts the same",
			turns: []agentsessions.Turn{user(Marker("Auth flow", "", "t-99", "why two stores?"), 2), agent("one store caches", 4)},
		},
		{
			name:  "no agent text yet, with an earlier answer before the marked entry",
			turns: []agentsessions.Turn{agent("an earlier answer", 1), user(asked, 2)},
		},
		{
			name:  "the next user entry came before any answer",
			turns: []agentsessions.Turn{user(asked, 2), user("never mind", 3), agent("ok", 4)},
		},
		{
			name:  "a marker quoted in an agent's text is not the forward",
			turns: []agentsessions.Turn{agent(asked, 1), agent("one store caches", 2)},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reply, ts, ok := ReplyAfter(tc.turns, "t-9")
			if reply != tc.wantReply || ts != tc.wantTs || ok != tc.wantOK {
				t.Errorf("ReplyAfter = (%q, %d, %v), want (%q, %d, %v)", reply, ts, ok, tc.wantReply, tc.wantTs, tc.wantOK)
			}
		})
	}
}
