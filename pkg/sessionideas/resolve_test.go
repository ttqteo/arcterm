// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestKeepNote(t *testing.T) {
	said := time.Date(2026, 11, 24, 12, 0, 0, 0, time.Local).UnixMilli()
	full := wshrpc.SessionIdea{
		SessionID: "9a842b04", SessionTitle: "Fix the sidecar wall", SaidTs: said,
		Quotes: []wshrpc.SessionIdeaQuote{
			{Who: "you", Text: "later we should let the wall filter by project"},
			{Who: "agent", Text: "I can add that once the ask keys are stable"},
		},
		Why: "the session moved on to the ask keys",
	}
	cases := []struct {
		name string
		in   func(i *wshrpc.SessionIdea)
		want string
	}{
		{"everything", func(i *wshrpc.SessionIdea) {},
			"From session \"Fix the sidecar wall\" (9a842b04), 2026-11-24\n\n" +
				"> You: later we should let the wall filter by project\n" +
				"> Claude: I can add that once the ask keys are stable\n\n" +
				"Why it stayed open: the session moved on to the ask keys"},
		{"no title", func(i *wshrpc.SessionIdea) { i.SessionTitle = "  " },
			"From session (9a842b04), 2026-11-24\n\n" +
				"> You: later we should let the wall filter by project\n" +
				"> Claude: I can add that once the ask keys are stable\n\n" +
				"Why it stayed open: the session moved on to the ask keys"},
		{"no date", func(i *wshrpc.SessionIdea) { i.SaidTs = 0 },
			"From session \"Fix the sidecar wall\" (9a842b04)\n\n" +
				"> You: later we should let the wall filter by project\n" +
				"> Claude: I can add that once the ask keys are stable\n\n" +
				"Why it stayed open: the session moved on to the ask keys"},
		{"no why", func(i *wshrpc.SessionIdea) { i.Why = "" },
			"From session \"Fix the sidecar wall\" (9a842b04), 2026-11-24\n\n" +
				"> You: later we should let the wall filter by project\n" +
				"> Claude: I can add that once the ask keys are stable"},
		{"no quotes", func(i *wshrpc.SessionIdea) { i.Quotes = nil },
			"From session \"Fix the sidecar wall\" (9a842b04), 2026-11-24\n\n" +
				"Why it stayed open: the session moved on to the ask keys"},
		{"a quote of several lines stays one quote", func(i *wshrpc.SessionIdea) {
			i.Quotes = []wshrpc.SessionIdeaQuote{{Who: "you", Text: "first line\r\nsecond line\nthird\n"}}
			i.Why = ""
		},
			"From session \"Fix the sidecar wall\" (9a842b04), 2026-11-24\n\n" +
				"> You: first line\n> second line\n> third"},
		{"text in any language is kept verbatim", func(i *wshrpc.SessionIdea) {
			i.Quotes = []wshrpc.SessionIdeaQuote{{Who: "you", Text: "lọc theo project nữa nhé"}}
			i.Why = ""
		},
			"From session \"Fix the sidecar wall\" (9a842b04), 2026-11-24\n\n" +
				"> You: lọc theo project nữa nhé"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := full
			c.in(&in)
			if got := KeepNote(in); got != c.want {
				t.Fatalf("KeepNote:\n got %q\nwant %q", got, c.want)
			}
		})
	}
}

func TestChunkLabel(t *testing.T) {
	i := wshrpc.SessionIdea{Gist: "  Let the wall filter by project "}
	if got := ChunkLabel(i, ""); got != "Let the wall filter by project" {
		t.Fatalf("with no label the chunk is named by the gist, got %q", got)
	}
	if got := ChunkLabel(i, "   "); got != "Let the wall filter by project" {
		t.Fatalf("a blank label is no label, got %q", got)
	}
	if got := ChunkLabel(i, " Wall filter "); got != "Wall filter" {
		t.Fatalf("the label the person gave wins, got %q", got)
	}
	if got := ChunkLabel(wshrpc.SessionIdea{}, ""); got != "" {
		t.Fatalf("no label and no gist is empty, for the caller to refuse, got %q", got)
	}
}
