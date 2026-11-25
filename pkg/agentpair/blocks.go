// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"regexp"
	"strconv"
	"strings"
)

// The fence names of the two blocks. Both sides end a reply with one: the working agent's list and a judge's marks.
const (
	pairLang  = "arc-pair"
	judgeLang = "arc-judge"
)

// a fence opening (``` or ~~~, three or more, at most three spaces in) and its info string's first word, and a fence
// closing: frontend/app/view/agents/chatsteplist.ts reads arc-steps with the same two patterns
var (
	fenceOpen  = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})\\s*([^\\s`]*)")
	fenceClose = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})\\s*$")
)

type fence struct {
	lang       string
	start, end int // line indexes: the opening line, and the closing one (the last line when the fence is left open)
	body       string
}

func splitLines(text string) []string {
	return strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
}

// fencesOf returns the top-level fences of a reply, in order, as stepBlocksOf finds arc-steps: a fence closes on a line
// of the same character at least as long, so a block shown inside a longer fence is not one; a fence left open runs to
// the end, as Markdown draws it.
func fencesOf(lines []string) []fence {
	var out []fence
	var open *fence
	var marker string
	var body []string
	for i, line := range lines {
		if open == nil {
			if m := fenceOpen.FindStringSubmatch(line); m != nil {
				open, marker, body = &fence{lang: m[2], start: i}, m[1], nil
			}
			continue
		}
		if m := fenceClose.FindStringSubmatch(line); m != nil && m[1][0] == marker[0] && len(m[1]) >= len(marker) {
			open.end, open.body = i, strings.Join(body, "\n")
			out = append(out, *open)
			open = nil
			continue
		}
		body = append(body, line)
	}
	if open != nil {
		open.end, open.body = len(lines)-1, strings.Join(body, "\n")
		out = append(out, *open)
	}
	return out
}

// lastFence is the last top-level fence of the given name in a reply: the one that counts.
func lastFence(raw, lang string) (fence, bool) {
	if !strings.Contains(raw, lang) {
		return fence{}, false
	}
	fs := fencesOf(splitLines(raw))
	for i := len(fs) - 1; i >= 0; i-- {
		if fs[i].lang == lang {
			return fs[i], true
		}
	}
	return fence{}, false
}

// BlockItem is one line of the working agent's arc-pair block.
type BlockItem struct {
	Num   int
	Kind  string // KindAgreed (D) | KindOpen (O) | KindAsks (A)
	Text  string
	Note  string   // the second line the board shows, after ` — ` or ` -- `
	Chips []string // an A item's answer chips: [a | b]
}

// `D1 text`, `O2: text`, `A3 text`; a Markdown bullet before it is read past, as parseSteps does for arc-steps
var itemLine = regexp.MustCompile(`^\s*(?:[-*+]\s+)?([DOAdoa])(\d+):?\s+(\S.*?)\s*$`)

// an A item's answer chips close its line: `[Yes, 50% | No, keep 70%]`
var chipsTail = regexp.MustCompile(`\s*\[([^\[\]]+)\]\s*$`)

var itemKinds = map[byte]string{'D': KindAgreed, 'O': KindOpen, 'A': KindAsks}

// splitNote cuts a line at its first ` — ` (an em dash) or ` -- `: the item's text, then its note.
func splitNote(s string) (text, note string) {
	cut, sepLen := -1, 0
	for _, sep := range []string{" — ", " -- "} {
		if i := strings.Index(s, sep); i >= 0 && (cut < 0 || i < cut) {
			cut, sepLen = i, len(sep)
		}
	}
	if cut < 0 {
		return s, ""
	}
	return strings.TrimSpace(s[:cut]), strings.TrimSpace(s[cut+sepLen:])
}

// parseItems reads a block's lines; one that does not parse is skipped.
func parseItems(body string) []BlockItem {
	var items []BlockItem
	for line := range strings.SplitSeq(body, "\n") { // a fence body is already split on normalized lines
		m := itemLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		num, err := strconv.Atoi(m[2])
		if err != nil || num < 1 {
			continue
		}
		kind := itemKinds[strings.ToUpper(m[1])[0]]
		rest := m[3]
		var chips []string
		if kind == KindAsks {
			if cm := chipsTail.FindStringSubmatch(rest); cm != nil {
				for _, c := range strings.Split(cm[1], "|") {
					if c = strings.TrimSpace(c); c != "" {
						chips = append(chips, c)
					}
				}
				if len(chips) > 0 {
					rest = rest[:len(rest)-len(cm[0])]
				}
			}
		}
		text, note := splitNote(rest)
		items = append(items, BlockItem{Num: num, Kind: kind, Text: text, Note: note, Chips: chips})
	}
	return items
}

// WorkerBlock reads the working agent's list from the last top-level arc-pair fence of its reply. ok is false when the
// reply has no such fence, or the fence lists no item that parses: an empty block is not a list with everything
// dropped, it is a block that was not written.
func WorkerBlock(raw string) (items []BlockItem, ok bool) {
	f, found := lastFence(raw, pairLang)
	if !found {
		return nil, false
	}
	items = parseItems(f.body)
	return items, len(items) > 0
}

// Reopen is a judge's mark that an agreed item is not agreed.
type Reopen struct {
	Num int
	Why string
}

// Marks is what a judge's arc-judge fence says: the items it reopens, the points it raises that the working agent has
// not listed, and whether it has nothing to add.
type Marks struct {
	Reopen      []Reopen
	New         []string
	NoNewPoints bool
}

// raises reports whether the marks hold something the working agent has to answer.
func (m Marks) raises() bool { return len(m.Reopen) > 0 || len(m.New) > 0 }

var (
	reopenLine = regexp.MustCompile(`(?i)^\s*(?:[-*+]\s+)?reopen\s+d?(\d+)\s*(?::\s*(.*?))?\s*$`)
	newLine    = regexp.MustCompile(`(?i)^\s*(?:[-*+]\s+)?new\s*:\s*(\S.*?)\s*$`)
	noNewLine  = regexp.MustCompile(`(?i)^\s*(?:[-*+]\s+)?no\s+new\s+points?\b`)
)

// JudgeMarks reads a judge's marks from the last top-level arc-judge fence of its reply: `reopen D2: why` (or
// `reopen 2: why`), `new: point`, `no new points`, in any case. A line that does not parse is skipped. ok is true when
// the reply has the fence, even an empty one: a judge that wrote it looked at the list and had nothing to mark.
func JudgeMarks(raw string) (m Marks, ok bool) {
	f, found := lastFence(raw, judgeLang)
	if !found {
		return Marks{}, false
	}
	for line := range strings.SplitSeq(f.body, "\n") {
		if r := reopenLine.FindStringSubmatch(line); r != nil {
			if num, err := strconv.Atoi(r[1]); err == nil && num >= 1 {
				m.Reopen = append(m.Reopen, Reopen{Num: num, Why: r[2]})
			}
		} else if n := newLine.FindStringSubmatch(line); n != nil {
			m.New = append(m.New, n[1])
		} else if noNewLine.MatchString(line) {
			m.NoNewPoints = true
		}
	}
	return m, true
}

// the line a reply answers, opening it: `> the line`
var quoteLine = regexp.MustCompile(`^ {0,3}>\s?(.*)$`)

func trimBlankLines(lines []string) []string {
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// Body is the text of an agent's reply as the conversation shows it: the arc-pair and arc-judge fences arcterm reads
// are taken out, and so is a leading `> ` line, which comes back as the quote (the line the reply answers).
func Body(raw string) (text, quote string) {
	lines := splitLines(raw)
	drop := make([]bool, len(lines))
	fs := fencesOf(lines)
	for _, lang := range []string{pairLang, judgeLang} {
		for i := len(fs) - 1; i >= 0; i-- {
			if fs[i].lang == lang {
				for l := fs[i].start; l <= fs[i].end; l++ {
					drop[l] = true
				}
				break
			}
		}
	}
	kept := make([]string, 0, len(lines))
	for i, line := range lines {
		if !drop[i] {
			kept = append(kept, line)
		}
	}
	kept = trimBlankLines(kept)
	if len(kept) > 0 {
		if m := quoteLine.FindStringSubmatch(kept[0]); m != nil {
			quote = strings.TrimSpace(m[1])
			kept = trimBlankLines(kept[1:])
		}
	}
	return strings.Join(kept, "\n"), quote
}
