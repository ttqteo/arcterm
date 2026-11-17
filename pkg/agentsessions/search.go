// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	hitKindTurn  = "turn"
	hitKindEvent = "event"

	snippetRadius = 40 // runes of context either side of a hit
	ellipsis      = "…"
)

// searchableEvents are the events whose text is the session's own words; started and finished only repeat
// the first prompt and the last reply, which the digest already holds.
var searchableEvents = map[string]bool{"asked": true, "committed": true, "errored": true}

// Query is a parsed search: lower-cased terms, each a word or a double-quoted phrase.
type Query struct{ Terms []string }

// ParseQuery splits q into terms. Text in double quotes is one term with its whitespace collapsed; an
// unmatched quote is dropped and the text after it is read as words. An empty phrase is no term.
func ParseQuery(q string) Query {
	var terms []string
	words := func(s string) {
		for w := range strings.FieldsSeq(s) {
			terms = append(terms, fold(w))
		}
	}
	for {
		before, rest, quoted := strings.Cut(q, `"`)
		words(before)
		if !quoted {
			break
		}
		inside, after, closed := strings.Cut(rest, `"`)
		if !closed {
			words(rest)
			break
		}
		if phrase := strings.Join(strings.Fields(inside), " "); phrase != "" {
			terms = append(terms, fold(phrase))
		}
		q = after
	}
	return Query{Terms: terms}
}

// Hit is one merged range of matched text in a turn or a searchable event, shown as a snippet around it.
type Hit struct {
	Kind, Speaker string   // turn: "user" | "agent"; event: its type
	Ord           int      // turn: position among the session's turn hits; event: index in Info.Events
	Text          string   // the snippet
	Marks         [][2]int // UTF-16 [start, end) into Text, for every merged range inside it
}

// hitSource is a text holding matches, with the merged byte ranges found in it.
type hitSource struct {
	kind, speaker string
	ord           int // event index; turn hits are numbered as they are emitted
	text          string
	ranges        [][2]int
}

// Match reports whether every term occurs in the title, the turns or the searchable events, and returns up to
// maxHits hits (turn hits in transcript order, then event hits) with the full turn and event hit counts. A hit's
// Ord is, for a turn hit, its position among all the merged hit ranges of the turns (it goes up once per range, so
// two hits in one turn have consecutive Ords), or, for an event hit, its event's index in events.
func (q Query) Match(title string, turns []Turn, events []SessionEvent, maxHits int) (ok bool, hits []Hit, turnHits, eventHits int) {
	if len(q.Terms) == 0 {
		return false, nil, 0, 0
	}
	found := make([]bool, len(q.Terms))
	q.ranges(fold(title), found)
	var turnSrcs, eventSrcs []hitSource
	for _, t := range turns {
		if r := q.ranges(fold(t.Text), found); len(r) > 0 {
			turnSrcs = append(turnSrcs, hitSource{kind: hitKindTurn, speaker: t.Speaker, text: t.Text, ranges: r})
			turnHits += len(r)
		}
	}
	for i, e := range events {
		if !searchableEvents[e.Type] {
			continue
		}
		if r := q.ranges(fold(e.Text), found); len(r) > 0 {
			eventSrcs = append(eventSrcs, hitSource{kind: hitKindEvent, speaker: e.Type, ord: i, text: e.Text, ranges: r})
			eventHits += len(r)
		}
	}
	for _, f := range found {
		if !f {
			return false, nil, 0, 0
		}
	}
	turnOrd := 0
	for _, src := range append(turnSrcs, eventSrcs...) {
		for _, r := range src.ranges {
			ord := src.ord
			if src.kind == hitKindTurn {
				ord = turnOrd
				turnOrd++
			}
			if len(hits) >= maxHits {
				continue
			}
			text, marks := snippet(src.text, r, src.ranges)
			hits = append(hits, Hit{Kind: src.kind, Speaker: src.speaker, Ord: ord, Text: text, Marks: marks})
		}
	}
	return true, hits, turnHits, eventHits
}

// ranges finds every occurrence of every term in folded text, marks the terms found, and merges occurrences
// that overlap (touching ones stay apart). Byte offsets into folded are offsets into the original text too,
// since fold keeps every rune's length.
func (q Query) ranges(folded string, found []bool) [][2]int {
	var occ [][2]int
	for i, term := range q.Terms {
		for from := 0; ; {
			at := strings.Index(folded[from:], term)
			if at < 0 {
				break
			}
			found[i] = true
			start := from + at
			occ = append(occ, [2]int{start, start + len(term)})
			from = start + len(term)
		}
	}
	if len(occ) == 0 {
		return nil
	}
	sort.Slice(occ, func(i, j int) bool { return occ[i][0] < occ[j][0] })
	merged := occ[:1]
	for _, r := range occ[1:] {
		last := &merged[len(merged)-1]
		if r[0] < last[1] {
			last[1] = max(last[1], r[1])
			continue
		}
		merged = append(merged, r)
	}
	return merged
}

// fold lower-cases s rune by rune, keeping a rune whose lower case has another UTF-8 length, so every byte
// offset into the result is the same offset into s.
func fold(s string) string {
	var b []byte
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		l := r
		if r != utf8.RuneError {
			l = unicode.ToLower(r)
		}
		if l != r && utf8.RuneLen(l) == n {
			if b == nil {
				b = append(make([]byte, 0, len(s)), s[:i]...)
			}
			b = utf8.AppendRune(b, l)
		} else if b != nil {
			b = append(b, s[i:i+n]...)
		}
		i += n
	}
	if b == nil {
		return s
	}
	return string(b)
}

// snippet is text around the byte range hit, snippetRadius runes either side, whitespace collapsed, with an
// ellipsis at a cut end. Marks are every range inside the window, in UTF-16 offsets into the snippet.
func snippet(text string, hit [2]int, ranges [][2]int) (string, [][2]int) {
	start, end := hit[0], hit[1]
	for n := 0; n < snippetRadius && start > 0; n++ {
		_, size := utf8.DecodeLastRuneInString(text[:start])
		start -= size
	}
	for n := 0; n < snippetRadius && end < len(text); n++ {
		_, size := utf8.DecodeRuneInString(text[end:])
		end += size
	}
	var out strings.Builder
	u16 := 0
	write := func(s string) {
		out.WriteString(s)
		for _, r := range s {
			u16 += utf16Len(r)
		}
	}
	if strings.TrimSpace(text[:start]) != "" {
		write(ellipsis)
	}
	// before[i] and after[i] are the snippet's UTF-16 offset at text byte start+i, read as a range's start or end
	before := make([]int, end-start+1)
	after := make([]int, end-start+1)
	after[0] = u16
	// a run of whitespace is written as one space, only once text follows it on both sides
	content, space := false, false
	for i := start; i < end; {
		r, n := utf8.DecodeRuneInString(text[i:])
		if unicode.IsSpace(r) {
			space = content
		} else {
			if space {
				write(" ")
				space = false
			}
			content = true
		}
		before[i-start] = u16
		if !unicode.IsSpace(r) {
			write(text[i : i+n])
		}
		i += n
		after[i-start] = u16
	}
	if strings.TrimSpace(text[end:]) != "" {
		write(ellipsis)
	}
	var marks [][2]int
	for _, r := range ranges {
		s, e := max(r[0], start), min(r[1], end)
		if s >= e {
			continue
		}
		marks = append(marks, [2]int{before[s-start], after[e-start]})
	}
	return out.String(), marks
}

func utf16Len(r rune) int {
	if r >= 0x10000 {
		return 2
	}
	return 1
}
