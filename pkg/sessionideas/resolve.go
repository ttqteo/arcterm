// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// quoteBreaks keeps a quote of several lines in one block quote.
var quoteBreaks = strings.NewReplacer("\r\n", "\n> ", "\n", "\n> ")

// KeepNote is the first note of what Keep makes (a chunk on an initiative, or a new idea): where the idea was floated,
// the words it was floated in, and why it stayed open. The transcript is deleted after 30 days, so the note is all that
// is left of the source.
func KeepNote(i wshrpc.SessionIdea) string {
	blocks := []string{sourceLine(i)}
	if len(i.Quotes) > 0 {
		lines := make([]string, 0, len(i.Quotes))
		for _, q := range i.Quotes {
			lines = append(lines, quoteLine(q))
		}
		blocks = append(blocks, strings.Join(lines, "\n"))
	}
	if why := strings.TrimSpace(i.Why); why != "" {
		blocks = append(blocks, "Why it stayed open: "+why)
	}
	return strings.Join(blocks, "\n\n")
}

// sourceLine is `From session "<title>" (<session id>), <date>`: the title and the date only when the idea has them.
func sourceLine(i wshrpc.SessionIdea) string {
	line := "From session"
	if title := strings.TrimSpace(i.SessionTitle); title != "" {
		line += ` "` + title + `"`
	}
	line += " (" + i.SessionID + ")"
	if i.SaidTs > 0 {
		line += ", " + time.UnixMilli(i.SaidTs).Format("2006-01-02")
	}
	return line
}

func quoteLine(q wshrpc.SessionIdeaQuote) string {
	who := "Claude"
	if q.Who == "you" {
		who = "You"
	}
	return "> " + who + ": " + quoteBreaks.Replace(strings.TrimSpace(q.Text))
}

// ChunkLabel is what Keep names the chunk (or the new idea) after: the label the person gave, else the idea's gist.
// Empty means there is nothing to name it by, and the caller refuses.
func ChunkLabel(i wshrpc.SessionIdea, label string) string {
	if l := strings.TrimSpace(label); l != "" {
		return l
	}
	return strings.TrimSpace(i.Gist)
}
