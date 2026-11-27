// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

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

func TestChunkLabelCapsTheName(t *testing.T) {
	exact := strings.Repeat("a", MaxLabel)
	if got := ChunkLabel(wshrpc.SessionIdea{Gist: exact}, ""); got != exact {
		t.Fatalf("a gist of exactly %d bytes is kept whole, got %d bytes", MaxLabel, len(got))
	}
	words := strings.Repeat("filter the wall ", 20) // 320 bytes
	got := ChunkLabel(wshrpc.SessionIdea{Gist: words}, "")
	if len(got) > MaxLabel || !strings.HasSuffix(got, "the…") && !strings.HasSuffix(got, "wall…") && !strings.HasSuffix(got, "filter…") {
		t.Fatalf("a long gist is cut at a word, within %d bytes, got %d: %q", MaxLabel, len(got), got)
	}
	if got := ChunkLabel(wshrpc.SessionIdea{Gist: "gist"}, words); len(got) > MaxLabel || !strings.HasPrefix(got, "filter the wall") {
		t.Fatalf("the person's label is capped the same way, got %q", got)
	}
	// no space to cut at, and three bytes a rune: the cut falls between runes
	vi := strings.Repeat("ữ", 100)
	got = ChunkLabel(wshrpc.SessionIdea{Gist: vi}, "")
	if len(got) > MaxLabel || !utf8.ValidString(got) || !strings.HasSuffix(got, "ữ…") {
		t.Fatalf("a long word is cut on a rune boundary, got %d bytes, valid %v: %q", len(got), utf8.ValidString(got), got)
	}
}

func TestKeepNoteKeepsALongGistWhole(t *testing.T) {
	long := strings.Repeat("filter the wall ", 20)
	note := KeepNote(wshrpc.SessionIdea{Gist: long, SessionID: "9a842b04"})
	if note != "Idea: "+strings.TrimSpace(long)+"\n\nFrom session (9a842b04)" {
		t.Fatalf("a gist too long for the name opens the note, got %q", note)
	}
	if note := KeepNote(wshrpc.SessionIdea{Gist: "short", SessionID: "9a842b04"}); note != "From session (9a842b04)" {
		t.Fatalf("a gist that names the chunk whole is not repeated, got %q", note)
	}
}
