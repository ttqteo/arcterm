// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// newestWorker is the index of the working agent's newest message, -1 when it has none.
func newestWorker(p *Pair) int {
	for i := len(p.Messages) - 1; i >= 0; i-- {
		if p.Messages[i].From == FromWorker {
			return i
		}
	}
	return -1
}

func liveJudges(p *Pair) []Side {
	var live []Side
	for _, j := range p.Judges {
		if !j.Gone {
			live = append(live, j)
		}
	}
	return live
}

// repliesSince is what one judge said after the message at index after, oldest first.
func repliesSince(p *Pair, judgeTab string, after int) []Message {
	var out []Message
	for _, m := range p.Messages[after+1:] {
		if m.From == FromJudge && m.Tab == judgeTab {
			out = append(out, m)
		}
	}
	return out
}

// OwedBy is the tabs of the live judges that owe the working agent an answer: its newest message is newer than their
// newest. A gone judge owes nothing, and neither does anyone in an ended pair.
func OwedBy(p *Pair) []string {
	w := newestWorker(p)
	if w < 0 || p.State == StateEnded {
		return nil
	}
	var owing []string
	for _, j := range liveJudges(p) {
		if len(repliesSince(p, j.Tab, w)) == 0 {
			owing = append(owing, j.Tab)
		}
	}
	return owing
}

// Owed reports whether any live judge owes the working agent an answer.
func Owed(p *Pair) bool { return len(OwedBy(p)) > 0 }

// workerBlockAt is a working agent's message that carries a block, and what the block lists.
type workerBlockAt struct {
	idx   int
	items []BlockItem
}

// workerBlocks is every block of the conversation, oldest first. A worker message without one is not in it.
func workerBlocks(p *Pair) []workerBlockAt {
	var out []workerBlockAt
	for i, m := range p.Messages {
		if m.From != FromWorker {
			continue
		}
		if items, ok := WorkerBlock(m.Raw); ok {
			out = append(out, workerBlockAt{idx: i, items: items})
		}
	}
	return out
}

func agreedIn(items []BlockItem, num int) bool {
	for _, it := range items {
		if it.Num == num && it.Kind == KindAgreed {
			return true
		}
	}
	return false
}

// settledAt is the id of the oldest message in the unbroken run of blocks, back from the newest, in which num was
// agreed: the message where the item was settled.
func settledAt(p *Pair, blocks []workerBlockAt, num int) string {
	idx := blocks[len(blocks)-1].idx
	for i := len(blocks) - 1; i >= 0 && agreedIn(blocks[i].items, num); i-- {
		idx = blocks[i].idx
	}
	return p.Messages[idx].Id
}

func chipsOf(chips []string) []string {
	return append([]string{}, chips...)
}

// Decided is what the Decided tab draws. The newest block is the whole list: a number the working agent dropped is gone.
// Marks count only from judge messages after that block (a block written after a mark is the working agent's answer to
// it): a reopened D item moves to Open, a judge's `new:` point joins Open with no number, and a person's answer to an A
// item shows with it. Every list and every chips slice is non-nil, so the wire carries [] and not null.
func Decided(p *Pair) wshrpc.PairDecided {
	d := wshrpc.PairDecided{Asks: []wshrpc.PairItem{}, Agreed: []wshrpc.PairItem{}, Open: []wshrpc.PairItem{}}
	blocks := workerBlocks(p)
	if len(blocks) == 0 {
		return d
	}
	anchor := blocks[len(blocks)-1]
	anchorId := p.Messages[anchor.idx].Id

	reopenedBy := map[int]string{} // item number -> the first judge that reopened it
	answers := map[int]string{}    // A item number -> the person's newest answer
	var newPoints []wshrpc.PairItem
	for _, m := range p.Messages[anchor.idx+1:] {
		switch m.From {
		case FromJudge:
			marks, ok := JudgeMarks(m.Raw)
			if !ok {
				continue
			}
			for _, r := range marks.Reopen {
				if _, seen := reopenedBy[r.Num]; !seen {
					reopenedBy[r.Num] = m.Tab
				}
			}
			for _, point := range marks.New {
				newPoints = append(newPoints, wshrpc.PairItem{Kind: KindOpen, Text: point, Chips: []string{}, MsgId: m.Id, NewBy: m.Tab})
			}
		case FromPerson:
			if m.Item > 0 {
				answers[m.Item] = strings.TrimSpace(m.Raw)
			}
		}
	}

	for _, it := range anchor.items {
		item := wshrpc.PairItem{Num: it.Num, Kind: it.Kind, Text: it.Text, Note: it.Note, Chips: chipsOf(it.Chips), MsgId: anchorId}
		switch it.Kind {
		case KindAgreed:
			if tab, reopened := reopenedBy[it.Num]; reopened {
				item.Kind, item.ReopenedBy = KindOpen, tab
				d.Open = append(d.Open, item)
				continue
			}
			item.MsgId = settledAt(p, blocks, it.Num)
			d.Agreed = append(d.Agreed, item)
		case KindOpen:
			d.Open = append(d.Open, item)
		case KindAsks:
			item.Answer = answers[it.Num]
			d.Asks = append(d.Asks, item)
		}
	}
	d.Open = append(d.Open, newPoints...)
	return d
}

// StopVerdict says why the exchange stops now, "" when it goes on. It is read when the last owed judge has answered.
//   - StopJudgesGone: no judge is live.
//   - StopNoNewPoints: every live judge's replies since the working agent's newest message raise nothing (no reopen,
//     no `new:`) and its newest says `no new points`.
//   - StopSettled: the newest message's block lists no O item, and every live judge's replies since it carry an
//     arc-judge fence that raises nothing. A reply without the fence is no word on the list, so it never settles.
//
// The token cap is the manager's: it needs counts.
func StopVerdict(p *Pair) string {
	live := liveJudges(p)
	if len(live) == 0 {
		return StopJudgesGone
	}
	w := newestWorker(p)
	if w < 0 || Owed(p) {
		return ""
	}
	if noNewPoints(p, live, w) {
		return StopNoNewPoints
	}
	if settled(p, live, w) {
		return StopSettled
	}
	return ""
}

func noNewPoints(p *Pair, live []Side, w int) bool {
	for _, j := range live {
		replies := repliesSince(p, j.Tab, w)
		if len(replies) == 0 {
			return false
		}
		for _, r := range replies {
			if marks, _ := JudgeMarks(r.Raw); marks.raises() {
				return false
			}
		}
		if marks, _ := JudgeMarks(replies[len(replies)-1].Raw); !marks.NoNewPoints {
			return false
		}
	}
	return true
}

func settled(p *Pair, live []Side, w int) bool {
	items, ok := WorkerBlock(p.Messages[w].Raw)
	if !ok {
		return false
	}
	for _, it := range items {
		if it.Kind == KindOpen {
			return false
		}
	}
	for _, j := range live {
		replies := repliesSince(p, j.Tab, w)
		if len(replies) == 0 {
			return false
		}
		for _, r := range replies {
			if marks, ok := JudgeMarks(r.Raw); !ok || marks.raises() {
				return false
			}
		}
	}
	return true
}

func sideInfo(s Side) wshrpc.PairSide {
	return wshrpc.PairSide{Tab: s.Tab, Name: s.Name, Harness: s.Harness, Session: s.Session, Gone: s.Gone}
}

// Info is the pair as the list shows it.
func Info(p *Pair) wshrpc.PairInfo {
	judges := make([]wshrpc.PairSide, 0, len(p.Judges))
	for _, j := range p.Judges {
		judges = append(judges, sideInfo(j))
	}
	last := p.CreatedTs
	if n := len(p.Messages); n > 0 {
		last = p.Messages[n-1].Ts
	}
	// a file saved before the updated time existed lists by its last message's time
	updated := p.UpdatedTs
	if updated == 0 {
		updated = last
	}
	return wshrpc.PairInfo{
		Id:           p.Id,
		Project:      p.Project,
		Worker:       sideInfo(p.Worker),
		Judges:       judges,
		State:        p.State,
		StopReason:   p.StopReason,
		Owed:         Owed(p),
		MessageCount: len(p.Messages),
		LastTs:       last,
		UpdatedTs:    updated,
	}
}

// shownOf is a message's text and quote as the conversation shows them. Only an agent's reply carries fences and a
// quote line; the person's text and the system's lines are shown as they are.
func shownOf(m Message) (text, quote string) {
	if m.From == FromWorker || m.From == FromJudge {
		return Body(m.Raw)
	}
	return m.Raw, ""
}

func firstLine(s string) string {
	for _, line := range splitLines(s) {
		if line = strings.TrimSpace(line); line != "" {
			return line
		}
	}
	return ""
}

// View is the pair in full, as the frontend draws it. A message with no quote line of its own, but that answers
// another, quotes the first line of the one it answers.
func View(p *Pair) *wshrpc.PairView {
	texts := make(map[string]string, len(p.Messages))
	for _, m := range p.Messages {
		texts[m.Id], _ = shownOf(m)
	}
	messages := make([]wshrpc.PairMessage, 0, len(p.Messages))
	for _, m := range p.Messages {
		text, quote := shownOf(m)
		if quote == "" && m.ReplyTo != "" {
			quote = firstLine(texts[m.ReplyTo])
		}
		to := m.To
		if m.From == FromPerson && to == "" {
			to = ToBoth
		}
		messages = append(messages, wshrpc.PairMessage{
			Id:      m.Id,
			From:    m.From,
			Tab:     m.Tab,
			Ts:      m.Ts,
			Text:    text,
			Quote:   quote,
			ReplyTo: m.ReplyTo,
			To:      to,
			Held:    append([]wshrpc.PairHeld{}, m.Held...),
		})
	}
	return &wshrpc.PairView{
		PairInfo:  Info(p),
		HoldHeavy: p.HoldHeavy,
		TokenCap:  p.TokenCap,
		Tokens:    p.Tokens,
		Note:      p.Note,
		CreatedTs: p.CreatedTs,
		Messages:  messages,
		Decided:   Decided(p),
	}
}
