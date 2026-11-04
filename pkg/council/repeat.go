// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/asciifold"
)

// The repeat guard. Seven councils on one thesis direction in five days (2026-10-31 to 11-04) mostly gave back what was
// already known: a new council on the topic of a recent one is worth its 0.5-1.5M tokens only when something changed
// since, new evidence or a council that has itself been upgraded. `wsh council start` asks RecentLike before the Token
// burn gate and refuses without a reason, printing what the earlier one said to do first.

// repeatWindow is how far back a council counts as recent.
const repeatWindow = 7 * 24 * time.Hour

// repeatLikeness is the share of the smaller topic's words the two topics must share to count as the same.
const repeatLikeness = 0.5 // the thesis councils of 10-31 to 11-04 share 0.5 to 1.0 of their words; unrelated ones 0.1 to 0.3

// The reasons a start gives for running a council on a recent one's topic (Council.RepeatWhy).
const (
	RepeatNewEvidence = "new-evidence" // the person has evidence the earlier council did not
	RepeatUpgraded    = "upgraded"     // the council has been upgraded since: its prompts, roles or models changed
)

// topicWords are a council's feature and question as the guard compares them: folded (no diacritics, lower case),
// words of three letters or more, each once.
func topicWords(feature, question string) []string {
	var out []string
	for _, w := range auditTokenRe.FindAllString(asciifold.Lower(feature+" "+question), -1) {
		if len([]rune(w)) >= 3 && !slices.Contains(out, w) {
			out = append(out, w)
		}
	}
	return out
}

// likeness is the share of the smaller set's words the larger one holds too: 1 when one topic's words are all in the
// other, 0 when they share none.
func likeness(a, b []string) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	if len(a) > len(b) {
		a, b = b, a
	}
	n := 0
	for _, w := range a {
		if slices.Contains(b, w) {
			n++
		}
	}
	return float64(n) / float64(len(a))
}

// RecentLike is the newest council of list that ended done within repeatWindow of now (ms) on the same topic as
// feature and question, or nil. A bench council never counts, nor one that failed or did not run: it said nothing.
func RecentLike(list []*Council, feature, question string, now int64) *Council {
	want := topicWords(feature, question)
	var best *Council
	for _, c := range list {
		if c == nil || c.Bench || c.State != StateDone {
			continue
		}
		at := c.Updated
		if at == 0 {
			at = c.Started
		}
		if now-at > repeatWindow.Milliseconds() {
			continue
		}
		if likeness(want, topicWords(c.Feature, c.Question)) < repeatLikeness {
			continue
		}
		if best == nil || at > best.Updated {
			best = c
		}
	}
	return best
}

// RepeatText is what a start refused by the guard prints: the earlier council, where its report is, what it said to do
// first, whether the council has changed since, and the two ways to run again anyway.
func RepeatText(prev *Council) string {
	var b strings.Builder
	day := time.UnixMilli(prev.Updated).Format("2006-01-02")
	fmt.Fprintf(&b, "A council on this topic ended on %s (%s): %s\n", day, prev.Id, oneLine(prev.Feature))
	if prev.DocPath != "" {
		fmt.Fprintf(&b, "Its report: %s\n", prev.DocPath)
	}
	if prev.Summary != nil && len(prev.Summary.Directions) > 0 {
		d := prev.Summary.Directions[0]
		fmt.Fprintf(&b, "Its direction 1: %s\n", oneLine(d.Title))
		if fs := oneLine(d.FirstStep); fs != "" {
			fmt.Fprintf(&b, "Its first step: %s\n", fs)
		}
	}
	if prev.Harness != HarnessVersion {
		was := prev.Harness
		if was == "" {
			was = "an unversioned council"
		}
		fmt.Fprintf(&b, "The council has been upgraded since: it ran on %s, this one is %s.\n", was, HarnessVersion)
	} else {
		fmt.Fprintf(&b, "The council has not changed since (both %s).\n", HarnessVersion)
	}
	b.WriteString("Not started. Tell the person what the earlier council said and ask what is new since. To run it anyway, " +
		"start again with --new-evidence \"<what is new, in their words>\", or with --rerun-upgraded when they want to see " +
		"what the upgraded council makes of the same question.\n")
	return b.String()
}

// writeRepeat tells the panel, in a council run for new evidence, which council came before and what is new since; a
// council re-run because the council was upgraded is told nothing, so it judges the question afresh and the two reports
// can be compared.
func writeRepeat(b *strings.Builder, c *Council) {
	if c.RepeatWhy != RepeatNewEvidence || c.RepeatOf == "" {
		return
	}
	fmt.Fprintf(b, "\nA council on this question ran before")
	if c.RepeatDoc != "" {
		fmt.Fprintf(b, "; its report is %s", c.RepeatDoc)
	}
	b.WriteString(". This one runs because of what is new since: " + oneLine(c.RepeatEvidence) + "\n" +
		"Judge what the new evidence changes. Do not hand back the earlier council's directions unless the new evidence " +
		"bears on them.\n")
}
