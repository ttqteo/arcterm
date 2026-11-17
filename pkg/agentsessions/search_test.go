// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestParseQuery(t *testing.T) {
	cases := map[string][]string{
		`Hook  Timeout`:          {"hook", "timeout"},
		`"dial timeout" warm`:    {"dial timeout", "warm"},
		`warm "Dial   Timeout" `: {"warm", "dial timeout"},
	}
	for in, want := range cases {
		if got := ParseQuery(in).Terms; !reflect.DeepEqual(got, want) {
			t.Errorf("ParseQuery(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseQueryEdgeCases(t *testing.T) {
	for _, in := range []string{``, `   `, `"`, `""`, `" "`} {
		if got := ParseQuery(in).Terms; len(got) != 0 {
			t.Errorf("ParseQuery(%q) = %q, want no terms", in, got)
		}
	}
	if got := ParseQuery(`"open`).Terms; !reflect.DeepEqual(got, []string{"open"}) {
		t.Errorf(`ParseQuery("\"open") = %q, want [open]`, got)
	}
	if got := ParseQuery(`warm "open dial`).Terms; !reflect.DeepEqual(got, []string{"warm", "open", "dial"}) {
		t.Errorf(`an unmatched quote reads the text after it as words, got %q`, got)
	}
}

func userTurn(text string) Turn  { return Turn{Speaker: "user", Text: text} }
func agentTurn(text string) Turn { return Turn{Speaker: "agent", Text: text} }

func TestMatchAllTermsAnyOrder(t *testing.T) {
	turns := []Turn{userTurn("the hook fires"), agentTurn("then a timeout")}
	if ok, _, _, _ := ParseQuery("timeout hook").Match("a title", turns, nil, 20); !ok {
		t.Error("timeout hook: want a match across two turns, in any order")
	}
	if ok, _, _, _ := ParseQuery("timeout zebra").Match("a title", turns, nil, 20); ok {
		t.Error("timeout zebra: every term must occur")
	}
}

func TestMatchEmptyQueryMatchesNothing(t *testing.T) {
	if ok, hits, _, _ := ParseQuery("  ").Match("a title", []Turn{userTurn("anything")}, nil, 20); ok || len(hits) != 0 {
		t.Errorf("an empty query matches nothing, got ok = %v, hits = %+v", ok, hits)
	}
}

func TestMatchPhrase(t *testing.T) {
	q := ParseQuery(`"dial timeout"`)
	if ok, _, _, _ := q.Match("t", []Turn{agentTurn("a dial timeout here")}, nil, 20); !ok {
		t.Error("phrase must match its words in order")
	}
	if ok, _, _, _ := q.Match("t", []Turn{agentTurn("a timeout dial here")}, nil, 20); ok {
		t.Error("phrase must not match the words in another order")
	}
}

func TestMatchCaseInsensitive(t *testing.T) {
	ok, hits, _, _ := ParseQuery("TimeOut").Match("t", []Turn{agentTurn("a TIMEOUT here")}, nil, 20)
	if !ok || len(hits) != 1 {
		t.Fatalf("ok = %v, hits = %+v", ok, hits)
	}
	if got := markText(hits[0], 0); got != "TIMEOUT" {
		t.Errorf("mark = %q, want the original casing TIMEOUT", got)
	}
}

func TestMatchTitleCountsButYieldsNoHit(t *testing.T) {
	ok, hits, turnHits, eventHits := ParseQuery("zebra").Match("Zebra crossing", []Turn{userTurn("nothing here")}, nil, 20)
	if !ok {
		t.Fatal("a term in the title counts toward matching")
	}
	if len(hits) != 0 || turnHits != 0 || eventHits != 0 {
		t.Errorf("the title yields no hit, got %+v %d %d", hits, turnHits, eventHits)
	}
}

func TestMatchEventHits(t *testing.T) {
	events := []SessionEvent{
		{Type: "started", Text: "started on zebra and lion"},
		{Type: "committed", Text: "fix zebra stripes"},
		{Type: "finished", Text: "zebra lion done"},
		{Type: "asked", Text: "which zebra?"},
		{Type: "errored", Text: "zebra not found"},
		{Type: "other", Text: "zebra again"},
	}
	ok, hits, turnHits, eventHits := ParseQuery("zebra").Match("t", nil, events, 20)
	if !ok || turnHits != 0 || eventHits != 3 || len(hits) != 3 {
		t.Fatalf("ok = %v, turnHits = %d, eventHits = %d, hits = %+v", ok, turnHits, eventHits, hits)
	}
	for i, want := range []struct {
		speaker string
		ord     int
	}{{"committed", 1}, {"asked", 3}, {"errored", 4}} {
		h := hits[i]
		if h.Kind != "event" || h.Speaker != want.speaker || h.Ord != want.ord || markText(h, 0) != "zebra" {
			t.Errorf("hit %d = %+v, want event %s at index %d", i, h, want.speaker, want.ord)
		}
	}
	if ok, _, _, _ := ParseQuery("lion").Match("t", nil, events, 20); ok {
		t.Error("started and finished events are not searchable")
	}
}

func TestMatchHitOrderAndOrd(t *testing.T) {
	turns := []Turn{userTurn("alpha one"), agentTurn("beta alpha then alpha")}
	events := []SessionEvent{
		{Type: "started", Text: "started"},
		{Type: "errored", Text: "failed: alpha"},
	}
	q := ParseQuery("alpha")
	_, hits, turnHits, eventHits := q.Match("t", turns, events, 2)
	if turnHits != 3 || eventHits != 1 {
		t.Fatalf("turnHits = %d, eventHits = %d, want 3 and 1 counted beyond maxHits", turnHits, eventHits)
	}
	if len(hits) != 2 || hits[0].Ord != 0 || hits[0].Speaker != "user" || hits[1].Ord != 1 || hits[1].Speaker != "agent" {
		t.Fatalf("hits = %+v", hits)
	}
	_, hits, _, _ = q.Match("t", turns, events, 20)
	var got []string
	for _, h := range hits {
		got = append(got, h.Kind+":"+h.Speaker+":"+string(rune('0'+h.Ord)))
	}
	want := []string{"turn:user:0", "turn:agent:1", "turn:agent:2", "event:errored:1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("hits = %v, want %v", got, want)
	}
}

func TestMatchMaxHitsCapsHitsNotCounts(t *testing.T) {
	turns := []Turn{userTurn("alpha alpha alpha")}
	ok, hits, turnHits, _ := ParseQuery("alpha").Match("t", turns, nil, 1)
	if !ok || len(hits) != 1 || turnHits != 3 {
		t.Fatalf("ok = %v, hits = %+v, turnHits = %d, want one hit of three counted", ok, hits, turnHits)
	}
	ok, hits, turnHits, _ = ParseQuery("alpha").Match("t", turns, nil, 0)
	if !ok || len(hits) != 0 || turnHits != 3 {
		t.Fatalf("maxHits 0: ok = %v, hits = %+v, turnHits = %d, want a match with no hits", ok, hits, turnHits)
	}
}

func TestMatchMergesOverlappingTerms(t *testing.T) {
	_, hits, turnHits, _ := ParseQuery("time timeout").Match("t", []Turn{agentTurn("a timeout here")}, nil, 20)
	if turnHits != 1 || len(hits) != 1 {
		t.Fatalf("turnHits = %d, hits = %+v, want one merged hit", turnHits, hits)
	}
	if got := markText(hits[0], 0); got != "timeout" {
		t.Errorf("mark = %q, want timeout", got)
	}
}

// ranges that overlap are one hit, ranges that only touch are two: "ab" and "cd" in "abcd"
func TestMatchKeepsTouchingTermsApart(t *testing.T) {
	_, hits, turnHits, _ := ParseQuery("ab cd").Match("t", []Turn{agentTurn("abcd")}, nil, 20)
	if turnHits != 2 || len(hits) != 2 {
		t.Fatalf("turnHits = %d, hits = %+v, want two hits", turnHits, hits)
	}
	for _, h := range hits {
		if len(h.Marks) != 2 || markText(h, 0) != "ab" || markText(h, 1) != "cd" {
			t.Errorf("marks = %v, want ab and cd as two marks of the snippet", h.Marks)
		}
	}
}

func TestMatchSnippetWindow(t *testing.T) {
	text := strings.Repeat("x", 50) + " needle " + strings.Repeat("y", 50)
	_, hits, _, _ := ParseQuery("needle").Match("t", []Turn{agentTurn(text)}, nil, 20)
	if len(hits) != 1 {
		t.Fatalf("hits = %+v", hits)
	}
	want := "…" + strings.Repeat("x", 39) + " needle " + strings.Repeat("y", 39) + "…"
	if hits[0].Text != want {
		t.Errorf("snippet = %q\nwant %q", hits[0].Text, want)
	}
	if got := markText(hits[0], 0); got != "needle" {
		t.Errorf("mark = %q", got)
	}

	_, hits, _, _ = ParseQuery("needle").Match("t", []Turn{agentTurn("  fix   the\n\nneedle now ")}, nil, 20)
	if len(hits) != 1 || hits[0].Text != "fix the needle now" || !reflect.DeepEqual(hits[0].Marks, [][2]int{{8, 14}}) {
		t.Errorf("collapsed snippet = %+v", hits)
	}
}

func TestMatchNonASCIIMarks(t *testing.T) {
	ok, hits, turnHits, _ := ParseQuery("lỗi").Match("t", []Turn{agentTurn("🙂 Lỗi kết nối, lỗi")}, nil, 20)
	if !ok || turnHits != 2 || len(hits) != 2 {
		t.Fatalf("ok = %v, turnHits = %d, hits = %+v", ok, turnHits, hits)
	}
	if len(hits[0].Marks) != 2 || markText(hits[0], 0) != "Lỗi" || markText(hits[0], 1) != "lỗi" {
		t.Fatalf("marks = %v (%q, %q)", hits[0].Marks, markText(hits[0], 0), markText(hits[0], 1))
	}
}

// a rune whose lower case has another UTF-8 length is kept as it is, so a byte offset found in the folded text
// is the same offset in the original, and the mark lands on the right word
func TestMatchAfterARuneThatChangesLength(t *testing.T) {
	ok, hits, _, _ := ParseQuery("needle").Match("t", []Turn{agentTurn("İİİ ȺȺ needle")}, nil, 20)
	if !ok || len(hits) != 1 {
		t.Fatalf("ok = %v, hits = %+v", ok, hits)
	}
	if got := markText(hits[0], 0); got != "needle" {
		t.Errorf("mark = %q, want needle", got)
	}
}

func TestFoldKeepsEveryByteOffset(t *testing.T) {
	for _, s := range []string{"Hello WORLD", "İSTANBUL", "ȺȻ ÀÉ Lỗi", "A\xffB", "🙂 Lỗi"} {
		if got := fold(s); len(got) != len(s) {
			t.Errorf("fold(%q) = %q: %d bytes, want %d like the original", s, got, len(got), len(s))
		}
	}
}

func TestFoldLowerCases(t *testing.T) {
	cases := map[string]string{
		"Hello WORLD": "hello world",
		"ÀÉ Lỗi":      "àé lỗi",
		"already low": "already low",
		"A\xffB":      "a\xffb", // invalid UTF-8 passes through
		"":            "",
	}
	for in, want := range cases {
		if got := fold(in); got != want {
			t.Errorf("fold(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFoldKeepsARuneWhoseLowerCaseChangesLength(t *testing.T) {
	// İ (2 bytes) lower-cases to i (1 byte), Ⱥ (2 bytes) to ⱥ (3 bytes): both stay
	if got := fold("İSTANBUL Ⱥ"); got != "İstanbul Ⱥ" {
		t.Errorf("fold = %q, want the two runes kept as they are", got)
	}
}

func TestSnippetWithoutACut(t *testing.T) {
	text, marks := snippet("hello needle", [2]int{6, 12}, [][2]int{{6, 12}})
	if text != "hello needle" || !reflect.DeepEqual(marks, [][2]int{{6, 12}}) {
		t.Errorf("snippet = %q %v", text, marks)
	}
}

func TestSnippetEllipsisAtACutEnd(t *testing.T) {
	long := strings.Repeat("a", 60) + " needle"
	text, _ := snippet(long, [2]int{61, 67}, [][2]int{{61, 67}})
	if !strings.HasPrefix(text, "…") || strings.HasSuffix(text, "…") {
		t.Errorf("a cut at the start only: snippet = %q", text)
	}
	long = "needle " + strings.Repeat("a", 60)
	text, _ = snippet(long, [2]int{0, 6}, [][2]int{{0, 6}})
	if strings.HasPrefix(text, "…") || !strings.HasSuffix(text, "…") {
		t.Errorf("a cut at the end only: snippet = %q", text)
	}
}

// marks are UTF-16 offsets into the snippet, as the frontend reads them: an emoji is two units, a precomposed
// Vietnamese letter one
func TestSnippetMarksAreUTF16(t *testing.T) {
	text, marks := snippet("🙂 lỗi", [2]int{5, 10}, [][2]int{{5, 10}})
	if text != "🙂 lỗi" || !reflect.DeepEqual(marks, [][2]int{{3, 6}}) {
		t.Errorf("snippet = %q %v, want the mark at UTF-16 3..6", text, marks)
	}
	if got := markText(Hit{Text: text, Marks: marks}, 0); got != "lỗi" {
		t.Errorf("mark reads %q", got)
	}
}

func TestSnippetCollapsesWhitespace(t *testing.T) {
	src := "  a \n\t b  needle  c "
	at := strings.Index(src, "needle")
	text, marks := snippet(src, [2]int{at, at + 6}, [][2]int{{at, at + 6}})
	if text != "a b needle c" || !reflect.DeepEqual(marks, [][2]int{{4, 10}}) {
		t.Errorf("snippet = %q %v", text, marks)
	}
}

// markText is the text a hit's i-th mark covers, read as the frontend reads it: UTF-16 offsets into Text.
func markText(h Hit, i int) string {
	if i >= len(h.Marks) {
		return ""
	}
	u := utf16.Encode([]rune(h.Text))
	m := h.Marks[i]
	if m[0] < 0 || m[1] > len(u) || m[0] > m[1] {
		return ""
	}
	return string(utf16.Decode(u[m[0]:m[1]]))
}
