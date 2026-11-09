// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"
)

// PeekMessage is one message of a session's Quick look: a prompt the person typed ("user") or the answer that closed
// its turn ("assistant"), stamped with the transcript's own time (UnixMilli).
type PeekMessage struct {
	Role string
	Text string
	Ts   int64
}

// peekDefaultCount and peekMaxCount bound ClaudeTailMessages' n: 0 means peekDefaultCount, and n is clamped to
// 1..peekMaxCount.
const (
	peekDefaultCount = 5
	peekMaxCount     = 20
)

// clampPeekCount maps a requested message count onto 1..peekMaxCount, 0 (or below) meaning peekDefaultCount.
func clampPeekCount(n int) int {
	if n <= 0 {
		return peekDefaultCount
	}
	if n > peekMaxCount {
		return peekMaxCount
	}
	return n
}

// The backward read's bounds: it reads peekChunkSize at a time, skips unparsed a line longer than peekMaxLine (nearly
// always a tool result, which the Quick look leaves out anyway), scans at most peekScanCap from the file's end, and
// clips each message at peekMaxText characters.
const (
	peekChunkSize = 64 << 10
	peekMaxLine   = 256 << 10
	peekScanCap   = 8 << 20
	peekMaxText   = 1500
)

// systemReminderRe is a block the harness adds to a prompt's record; the person did not type it.
var systemReminderRe = regexp.MustCompile(`(?s)<system-reminder>.*?</system-reminder>`)

// PeekCursor says where a page of older messages starts: Before is the byte offset the backward read starts from, the
// start of a line (0 reads from the file's end), and Answered carries the turn the previous page stopped in, so its
// narration before the answer already shown stays out.
type PeekCursor struct {
	Before   int64
	Answered bool
}

// PeekPage is one page of ClaudeTailPage: its messages oldest first, capped when the read stopped at its scan limit
// before finding n messages, and Next, the cursor of the page before it (Next.Before 0 when the read reached the file's
// start, so nothing older is left).
type PeekPage struct {
	Messages []PeekMessage
	Capped   bool
	Next     PeekCursor
}

// ClaudeTailMessages returns the last n messages (oldest first) of the Claude transcript at path: each real prompt
// and the answer that closed its turn. capped says the read stopped at its scan limit before finding n messages. A file
// that cannot be opened returns the error.
func ClaudeTailMessages(path string, n int) (msgs []PeekMessage, capped bool, err error) {
	page, err := ClaudeTailPage(path, n, PeekCursor{})
	if err != nil {
		return nil, false, err
	}
	return page.Messages, page.Capped, nil
}

// ClaudeTailPage returns the n messages before cur (the last n for a zero cursor), and the cursor that reads on from
// them toward the file's start.
//
// It reads the file backwards, one chunk at a time, and stops once it has n messages, so it holds one chunk, the line
// being put together and the messages' text, never the whole file. Each page scans at most peekScanCap. Read from the
// file's end, the bytes after the last newline (a line the session is still writing) are left out; a cursor's Before
// is always a line start, so the byte before it is a newline and nothing is cut. The file only grows at its end, so a
// cursor stays good while the session writes on.
func ClaudeTailPage(path string, n int, cur PeekCursor) (PeekPage, error) {
	n = clampPeekCount(n)
	f, err := os.Open(path)
	if err != nil {
		return PeekPage{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return PeekPage{}, err
	}
	top := info.Size()
	if cur.Before > 0 && cur.Before < top {
		top = cur.Before
	}
	floor := max(top-peekScanCap, 0)
	t := tailTurns{n: n, answered: cur.Before > 0 && cur.Answered}
	buf := make([]byte, peekChunkSize)
	// carry is the start of the line being put together, read so far; skipping drops bytes up to the next newline to
	// the left (the unterminated last line, then a line past peekMaxLine), and starts true for that last line
	var carry []byte
	skipping := true
	// where the line read last starts: the next page reads on from there
	var lineStart int64
	for end := top; end > floor && !t.done(); {
		start := max(end-peekChunkSize, floor)
		chunk := buf[:end-start]
		if _, err := f.ReadAt(chunk, start); err != nil && err != io.EOF {
			return PeekPage{}, err
		}
		end = start
		// walk the chunk's newlines right to left: the bytes right of each one finish the line in carry
		for i := len(chunk) - 1; i >= 0 && !t.done(); i-- {
			if chunk[i] != '\n' {
				continue
			}
			if !skipping {
				line := append(chunk[i+1:len(chunk):len(chunk)], carry...)
				if len(line) <= peekMaxLine {
					t.line(line)
				}
			}
			carry, skipping = nil, false
			chunk = chunk[:i]
			lineStart = start + int64(i) + 1
		}
		if t.done() || skipping {
			continue
		}
		// what is left of the chunk starts a line that began further left
		if len(chunk)+len(carry) > peekMaxLine {
			carry, skipping = nil, true
			continue
		}
		carry = append(append(make([]byte, 0, len(chunk)+len(carry)), chunk...), carry...)
	}
	page := PeekPage{}
	switch {
	case t.done():
		// the n-th message's line: the next page reads the lines before it
		page.Next = PeekCursor{Before: lineStart, Answered: t.answered}
	case floor == 0:
		// the file's first line has no newline before it
		if !skipping && len(carry) > 0 {
			t.line(carry)
		}
	default:
		// the scan cap cut the line in carry: the next page starts after it and reads it whole. A line being skipped
		// is dropped anyway, so that page starts at the cap.
		page.Capped = true
		next := floor
		if !skipping {
			next = floor + int64(len(carry)) + 1
		}
		page.Next = PeekCursor{Before: next, Answered: t.answered}
	}
	slices.Reverse(t.msgs)
	page.Messages = t.msgs
	return page, nil
}

// tailTurns collects messages newest first: a real prompt, and for each turn (the records after a prompt) the last
// text-bearing main-chain answer, the narration before it skipped.
type tailTurns struct {
	n        int
	msgs     []PeekMessage
	answered bool // the turn being read already gave its answer
}

func (t *tailTurns) done() bool {
	return len(t.msgs) >= t.n
}

func (t *tailTurns) line(line []byte) {
	// most lines are tool results and tool calls; only these can hold a message, so the rest are not decoded
	if !bytes.Contains(line, []byte(`"type":"assistant"`)) && !bytes.Contains(line, []byte(`"type":"user"`)) &&
		!bytes.Contains(line, []byte(`"queued_command"`)) {
		return
	}
	var rec claudePromptLine
	if json.Unmarshal(line, &rec) != nil {
		return
	}
	if rec.Type == "assistant" {
		if rec.IsSidechain || t.answered {
			return
		}
		if text := textBlocks(rec.Message.Content); text != "" {
			t.add("assistant", text, rec.Timestamp)
			t.answered = true
		}
		return
	}
	text := strings.TrimSpace(systemReminderRe.ReplaceAllString(claudeTypedText(rec), ""))
	if text == "" {
		return
	}
	t.add("user", text, rec.Timestamp)
	t.answered = false
}

func (t *tailTurns) add(role, text, ts string) {
	t.msgs = append(t.msgs, PeekMessage{Role: role, Text: trimTo(text, peekMaxText), Ts: parseTs(ts)})
}
