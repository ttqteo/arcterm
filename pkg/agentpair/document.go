// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// shortIdLen is how many characters of a pair id or a tab id the text names it by, as the cockpit's short ids.
const shortIdLen = 8

func short(id string) string { return id[:min(shortIdLen, len(id))] }

// Document is a pair as plain text, for `wsh read`: a header, the whole conversation as `[hh:mm] Who → Whom` and its
// text, then what is decided. loc is the zone the times are written in. The text is of the view as the frontend shows
// it (fences and quote lines already taken out).
func Document(v *wshrpc.PairView, loc *time.Location) string {
	if loc == nil {
		loc = time.Local
	}
	at := func(ts int64, layout string) string { return time.UnixMilli(ts).In(loc).Format(layout) }

	workerName := v.Worker.Name
	if workerName == "" {
		workerName = "Working agent"
	}
	judgeShorts := make([]string, len(v.Judges))
	for i, j := range v.Judges {
		judgeShorts[i] = short(j.Tab)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# Pair %s · %s", short(v.Id), workerName)
	if len(judgeShorts) > 0 {
		fmt.Fprintf(&b, " · judge %s", strings.Join(judgeShorts, ", "))
	}
	// a pair saved before the cap stopped counting the working agent saved a count that includes it: it says "tokens"
	tokens := "tokens"
	if v.JudgeTokens {
		tokens = "judge tokens"
	}
	fmt.Fprintf(&b, "\nProject: %s · %s · %s of %s %s\n", v.Project, stateWords(v.State, v.StopReason), tokenCount(v.Tokens), tokenCount(v.TokenCap), tokens)
	if v.Synced {
		fmt.Fprintf(&b, "Synced from another machine; as of %s\n", at(v.UpdatedTs, "2006-01-02 15:04"))
	}

	// the live judges are who a working agent's message went to; with none live, all of them
	judges := "Judges"
	if n := liveCount(v.Judges); n == 1 || (n == 0 && len(v.Judges) == 1) {
		judges = "Judge"
	}
	for _, m := range v.Messages {
		b.WriteString("\n[" + at(m.Ts, "15:04") + "] " + messageWho(m))
		if whom := messageWhom(m, judges); whom != "" {
			b.WriteString(" → " + whom)
		}
		b.WriteString("\n")
		if m.Quote != "" {
			b.WriteString("> " + m.Quote + "\n")
		}
		if text := strings.TrimSpace(m.Text); text != "" {
			b.WriteString(text + "\n")
		}
		for _, h := range m.Held {
			b.WriteString("  held: " + h.Command)
			if h.RunTs != 0 {
				b.WriteString(" (let through " + at(h.RunTs, "15:04") + ")")
			}
			b.WriteString("\n")
		}
	}

	d := v.Decided
	b.WriteString("\n## Decided\n\n### Agreed\n")
	section(&b, len(d.Agreed), func(i int) string { return fmt.Sprintf("%d. %s", d.Agreed[i].Num, d.Agreed[i].Text) })
	b.WriteString("\n### Your answers\n")
	var answered []wshrpc.PairItem
	for _, it := range d.Asks {
		if it.Answer != "" {
			answered = append(answered, it)
		}
	}
	section(&b, len(answered), func(i int) string { return fmt.Sprintf("- %s → %s", answered[i].Text, answered[i].Answer) })
	b.WriteString("\n### Still open\n")
	section(&b, len(d.Open), func(i int) string {
		it := d.Open[i]
		line := "- " + it.Text
		switch {
		case it.ReopenedBy != "":
			line += " (reopened by Judge " + short(it.ReopenedBy) + ")"
		case it.NewBy != "":
			line += " (new point from Judge " + short(it.NewBy) + ")"
		}
		return line
	})
	return b.String()
}

// section writes n lines, one per index, or "(none)" for n == 0.
func section(b *strings.Builder, n int, line func(i int) string) {
	if n == 0 {
		b.WriteString("(none)\n")
		return
	}
	for i := range n {
		b.WriteString(line(i) + "\n")
	}
}

func liveCount(sides []wshrpc.PairSide) int {
	n := 0
	for _, s := range sides {
		if !s.Gone {
			n++
		}
	}
	return n
}

// stateWords says the state and, for a pair that stopped, why. A stop reason stays on a pair that was ended after it.
func stateWords(state, reason string) string {
	why := ""
	switch reason {
	case StopSettled:
		why = "both sides settled"
	case StopTokenCap:
		why = "token cap reached"
	case StopNoNewPoints:
		why = "no new points"
	case StopJudgesGone:
		why = "judges gone"
	}
	switch {
	case why != "" && state == StateEnded:
		return "ended · stopped: " + why
	case why != "":
		return "stopped: " + why
	}
	return state
}

func messageWho(m wshrpc.PairMessage) string {
	switch m.From {
	case FromWorker:
		return "Worker"
	case FromJudge:
		return "Judge " + short(m.Tab)
	case FromPerson:
		return "You"
	}
	return "System"
}

// messageWhom is who a message went to; "" for a system line, which has no one.
func messageWhom(m wshrpc.PairMessage, judges string) string {
	switch m.From {
	case FromWorker:
		return judges
	case FromJudge:
		return "Worker"
	case FromPerson:
		switch m.To {
		case "", ToBoth:
			return "Both"
		case ToWorker:
			return "Worker"
		case ToJudge:
			return judges
		}
		return "Judge " + short(m.To)
	}
	return ""
}

// tokenCount writes a count as the cockpit does: 512, 38k, 1.2M.
func tokenCount(n int64) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%dk", (n+500)/1_000)
	}
	return fmt.Sprint(n)
}
