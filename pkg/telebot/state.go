// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// GraceMs is how long an ask waits before it is sent: the Gatekeeper answers most it can within a few seconds, and
// those should never reach the phone.
const GraceMs = 8000

// FixedReply answers a paired chat's message that is neither /start nor a reply to a question message.
const FixedReply = "I only answer agent questions. Reply to a question message to answer it."

const (
	replyAlreadyAnswered = "Already answered."
	replyLatestQuestion  = "Answer the latest question."
	replyNeedText        = "Reply with text to answer."

	toastAlreadyAnswered = "Already answered"
	toastLatestQuestion  = "Answer the latest question"
	toastPickOne         = "Pick at least one"

	editAnsweredInApp = "✓ Answered in arcterm"
)

const (
	maxQuestionRunes = 1000
	maxHeadRunes     = 100 // the agent name and the header line
	maxLabelRunes    = 40  // a button label
	maxEditRunes     = 1000
	maxClosedIDs     = 1000
)

// askMsg is one ask being answered in Telegram: its questions go out one message at a time, and the answers are
// delivered together after the last, as the cockpit's panel does.
type askMsg struct {
	n         int // short id in callback data (Telegram caps it at 64 bytes)
	oref      string
	askID     string
	prose     bool
	questions []baseds.AgentAskQuestion
	q         int // the question now on screen
	answers   []baseds.AgentAnswerItem
	picks     map[int]bool // multi-select toggles of question q
	msgIDs    []int        // one per question sent, in order
}

// tracker is not safe for concurrent use: bot.go holds its lock across a call and whatever it does with the
// returned *askMsg.
type tracker struct {
	next   int
	byAsk  map[string]*askMsg // askID
	byN    map[int]*askMsg
	byMsg  map[int]*askMsg // Telegram message id → ask
	closed map[int]bool    // message ids of forgotten asks, so a reply to one gets "Already answered."; capped at 1000
	// closedOrder is closed's insertion order, so the oldest id goes first when closed is full.
	closedOrder []int
	// delivered holds the askID of an ask this tracker forgot after answering it. The ask stays in the registry until
	// DeliverAnswer claims it, so without this a reconcile tick in between would send it again as a new message.
	delivered map[string]bool
}

func newTracker() *tracker {
	return &tracker{
		byAsk:     map[string]*askMsg{},
		byN:       map[int]*askMsg{},
		byMsg:     map[int]*askMsg{},
		closed:    map[int]bool{},
		delivered: map[string]bool{},
	}
}

type dueAsk struct {
	Oref string
	agentask.PendingAsk
}

// due returns the pending asks to send now, oldest first: not owned by a dag lead, pending at least GraceMs, with
// at least one question, and not already tracked or just answered here.
func (t *tracker) due(pending map[string]agentask.PendingAsk, now int64) []dueAsk {
	var out []dueAsk
	for oref, p := range pending {
		if p.Owner == agentask.AskOwner_Lead || now-p.Ts < GraceMs || len(p.Questions) == 0 {
			continue
		}
		if t.byAsk[p.AskId] != nil || t.delivered[p.AskId] {
			continue
		}
		out = append(out, dueAsk{Oref: oref, PendingAsk: p})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Ts != out[j].Ts {
			return out[i].Ts < out[j].Ts
		}
		return out[i].AskId < out[j].AskId
	})
	return out
}

// gone returns tracked asks no longer pending under the same AskId (answered elsewhere, replaced, or the agent moved
// on), and forgets them. It also drops the tombstone of a delivered ask once the registry has let it go.
func (t *tracker) gone(pending map[string]agentask.PendingAsk) []*askMsg {
	live := make(map[string]bool, len(pending))
	for _, p := range pending {
		live[p.AskId] = true
	}
	for id := range t.delivered {
		if !live[id] {
			delete(t.delivered, id)
		}
	}
	var out []*askMsg
	for _, a := range t.byAsk {
		if p, ok := pending[a.oref]; ok && p.AskId == a.askID {
			continue
		}
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].n < out[j].n })
	for _, a := range out {
		t.drop(a)
	}
	return out
}

// track starts tracking a due ask and returns it; the caller sends questionText/keyboard and records the message id
// with sent(a, msgID).
func (t *tracker) track(d dueAsk) *askMsg {
	t.next++
	a := &askMsg{
		n:         t.next,
		oref:      d.Oref,
		askID:     d.AskId,
		prose:     d.Prose,
		questions: d.Questions,
	}
	t.byAsk[a.askID] = a
	t.byN[a.n] = a
	return a
}

func (t *tracker) sent(a *askMsg, msgID int) {
	a.msgIDs = append(a.msgIDs, msgID)
	t.byMsg[msgID] = a
}

// forget drops the ask, moves its message ids into closed, and leaves a tombstone so due() skips the ask until the
// registry has let it go.
func (t *tracker) forget(a *askMsg) {
	t.drop(a)
	t.delivered[a.askID] = true
}

// drop untracks the ask without a tombstone: gone() uses it for an ask that is no longer pending anyway.
func (t *tracker) drop(a *askMsg) {
	delete(t.byAsk, a.askID)
	delete(t.byN, a.n)
	for _, id := range a.msgIDs {
		delete(t.byMsg, id)
		t.markClosed(id)
	}
}

func (t *tracker) markClosed(id int) {
	if t.closed[id] {
		return
	}
	t.closed[id] = true
	t.closedOrder = append(t.closedOrder, id)
	for len(t.closedOrder) > maxClosedIDs {
		delete(t.closed, t.closedOrder[0])
		t.closedOrder = t.closedOrder[1:]
	}
}

func collapse(s string) string { return strings.Join(strings.Fields(s), " ") }

// capRunes cuts s to n runes, the last being "…" when it cut.
func capRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// questionText is the message body for question q: "🤖 <who>\n<header>\n<question>\n\nReply to this message to answer
// in your own words." Whitespace runs collapse, and the question is capped at 1000 runes with "…".
func questionText(who string, q baseds.AgentAskQuestion) string {
	var b strings.Builder
	b.WriteString("🤖")
	if w := capRunes(collapse(who), maxHeadRunes); w != "" {
		b.WriteString(" " + w)
	}
	if h := capRunes(collapse(q.Header), maxHeadRunes); h != "" {
		b.WriteString("\n" + h)
	}
	b.WriteString("\n" + capRunes(collapse(q.Question), maxQuestionRunes))
	b.WriteString("\n\nReply to this message to answer in your own words.")
	return b.String()
}

// keyboard is one button per option, label capped at 40 runes. Callback data: "a:<n>:<q>:<o>" picks option o;
// a multi-select question shows "☐ label"/"☑ label" toggles "t:<n>:<q>:<o>" and a last row "Send" "s:<n>:<q>".
func keyboard(a *askMsg) [][]Button {
	if a.q >= len(a.questions) {
		return nil
	}
	q := a.questions[a.q]
	rows := make([][]Button, 0, len(q.Options)+1)
	for o, opt := range q.Options {
		label := capRunes(collapse(opt.Label), maxLabelRunes)
		if q.MultiSelect {
			box := "☐ "
			if a.picks[o] {
				box = "☑ "
			}
			rows = append(rows, []Button{{Text: box + label, Data: fmt.Sprintf("t:%d:%d:%d", a.n, a.q, o)}})
			continue
		}
		rows = append(rows, []Button{{Text: label, Data: fmt.Sprintf("a:%d:%d:%d", a.n, a.q, o)}})
	}
	if q.MultiSelect {
		rows = append(rows, []Button{{Text: "Send", Data: fmt.Sprintf("s:%d:%d", a.n, a.q)}})
	}
	return rows
}

// step is what one tap or reply did.
type step struct {
	Toast   string // answerCallbackQuery text; "" for none
	Edit    string // new text for the message tapped/replied to; "" leaves it
	Reply   string // a message the bot sends to the chat; "" for none
	Rekey   bool   // re-render the keyboard (a toggle)
	Next    bool   // send question a.q (already advanced)
	Deliver bool   // all questions answered: deliver a.answers
}

// answer records item as the answer to the question on screen and moves on: Next when another question follows,
// else Deliver, with the ask already forgotten so the reconcile loop never sees it as gone.
func (t *tracker) answer(a *askMsg, item baseds.AgentAnswerItem, st step) step {
	a.answers = append(a.answers, item)
	a.q++
	a.picks = nil
	if a.q < len(a.questions) {
		st.Next = true
		return st
	}
	st.Deliver = true
	t.forget(a)
	return st
}

// onCallback applies a tap. Unknown n (answered, restarted) → nil ask, Toast "Already answered", Edit "✓ Answered in
// arcterm" (the caller edits the tapped message, cb.Message, since there is no ask).
// A tap on an earlier question → Toast "Answer the latest question". "a": the item is SelectedIndexes [o], or for a
// prose ask Text = option label; Edit "✓ <label>". "t": flips picks[o], Rekey. "s" with no picks → Toast "Pick at
// least one"; else SelectedIndexes sorted (prose: Text = labels joined ", "), Edit "✓ <labels>".
func (t *tracker) onCallback(data string) (*askMsg, step) {
	// "s:<n>:<q>" has three fields, "a:" and "t:" four.
	parts := strings.Split(data, ":")
	if len(parts) < 3 || (len(parts) == 3) != (parts[0] == "s") {
		return nil, step{}
	}
	nums := make([]int, len(parts)-1)
	for i, p := range parts[1:] {
		v, err := strconv.Atoi(p)
		if err != nil {
			return nil, step{}
		}
		nums[i] = v
	}
	a := t.byN[nums[0]]
	if a == nil {
		return nil, step{Toast: toastAlreadyAnswered, Edit: editAnsweredInApp}
	}
	if nums[1] != a.q {
		return a, step{Toast: toastLatestQuestion}
	}
	q := a.questions[a.q]
	switch parts[0] {
	case "a":
		o := nums[2]
		if o < 0 || o >= len(q.Options) {
			return a, step{}
		}
		label := q.Options[o].Label
		item := baseds.AgentAnswerItem{SelectedIndexes: []int{o}}
		if a.prose {
			item = baseds.AgentAnswerItem{Text: label}
		}
		return a, t.answer(a, item, step{Edit: doneText(label)})
	case "t":
		o := nums[2]
		if o < 0 || o >= len(q.Options) {
			return a, step{}
		}
		if a.picks == nil {
			a.picks = map[int]bool{}
		}
		if a.picks[o] {
			delete(a.picks, o)
		} else {
			a.picks[o] = true
		}
		return a, step{Rekey: true}
	case "s":
		if len(a.picks) == 0 {
			return a, step{Toast: toastPickOne}
		}
		idx := make([]int, 0, len(a.picks))
		for o := range a.picks {
			idx = append(idx, o)
		}
		sort.Ints(idx)
		labels := make([]string, len(idx))
		for i, o := range idx {
			labels[i] = q.Options[o].Label
		}
		joined := strings.Join(labels, ", ")
		item := baseds.AgentAnswerItem{SelectedIndexes: idx}
		if a.prose {
			item = baseds.AgentAnswerItem{Text: joined}
		}
		return a, t.answer(a, item, step{Edit: doneText(joined)})
	}
	return nil, step{}
}

// onReply applies a text reply to message replyTo. A message of a forgotten ask (in closed) → Reply "Already
// answered.". An earlier question of a live ask → Reply "Answer the latest question.". Not one of ours → Reply
// FixedReply. The current question → Text = trimmed text, Edit `✓ "<text>"`.
func (t *tracker) onReply(replyTo int, text string) (*askMsg, step) {
	a := t.byMsg[replyTo]
	if a == nil {
		if t.closed[replyTo] {
			return nil, step{Reply: replyAlreadyAnswered}
		}
		return nil, step{Reply: FixedReply}
	}
	if a.q >= len(a.msgIDs) || a.msgIDs[a.q] != replyTo {
		return a, step{Reply: replyLatestQuestion}
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return a, step{Reply: replyNeedText}
	}
	shown := capRunes(collapse(text), maxEditRunes)
	return a, t.answer(a, baseds.AgentAnswerItem{Text: text}, step{Edit: `✓ "` + shown + `"`})
}

// doneText is the edit that replaces an answered question's message.
func doneText(s string) string { return "✓ " + capRunes(collapse(s), maxEditRunes) }
