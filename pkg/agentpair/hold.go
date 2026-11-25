// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// holdReason is what a refused heavy command tells the working agent: end the turn and say which command, so the reply
// passes to the judge like any other.
const holdReason = "Held: arcterm holds heavy commands while your judge has not answered your last reply. " +
	"End your turn now and say in your reply that you mean to run `%s`; once the judge answers, run it in your next turn."

// Hold is asked for each heavy command the working agent at workerTab starts. It refuses (held, with the reason the
// agent reads) while the pair holds: it is on, a live judge owes an answer to the agent's newest message. A command the
// person let through with Run now runs once, whatever the hold says. A refusal is recorded on the pair, and its next
// message shows the command with Run now. An agent that is not the working agent of a pair is never held.
func (m *Manager) Hold(workerTab, command string) (reason string, held bool) {
	m.lock()
	id := ""
	if p, isWorker := m.pairOf(workerTab); p != nil && isWorker {
		id = p.Id
	}
	m.mu.Unlock()
	if id == "" {
		return "", false
	}
	m.change(id, func(p *Pair) bool {
		if i := slices.Index(p.Passes, command); i >= 0 {
			p.Passes = slices.Delete(p.Passes, i, i+1)
			return true
		}
		if !p.HoldHeavy || !Owed(p) {
			return false
		}
		held, reason = true, fmt.Sprintf(holdReason, command)
		if slices.ContainsFunc(p.Held, func(h wshrpc.PairHeld) bool { return h.Command == command }) {
			return false
		}
		p.Held = append(p.Held, wshrpc.PairHeld{Command: command, Ts: m.nowMs()})
		return true
	})
	return reason, held
}

// RunNow lets one held command through: the message's line is marked, the command gets a one-time pass, and the working
// agent is told in a message of the person's, which shows in the conversation. Like any message of the person's it
// resumes a stopped pair.
func (m *Manager) RunNow(ctx context.Context, d wshrpc.CommandPairRunNowData) error {
	var refused error
	if !m.change(d.PairId, func(p *Pair) bool {
		var h *wshrpc.PairHeld
		if h, refused = heldCommand(p, d.MsgId, d.Command); refused != nil {
			return false
		}
		h.RunTs = m.nowMs()
		p.Passes = append(p.Passes, d.Command)
		m.appendPerson(p, fmt.Sprintf("Run `%s` now: the person let it through without waiting for the judge.", d.Command), ToWorker, "", 0)
		return true
	}) {
		return errNoPair(d.PairId)
	}
	if refused != nil {
		return refused
	}
	m.deliverAll(ctx, d.PairId, true)
	return nil
}

// heldCommand is the line of a message that holds command and has not been let through.
func heldCommand(p *Pair, msgId, command string) (*wshrpc.PairHeld, error) {
	i := messageIndex(p, msgId)
	if i < 0 {
		return nil, fmt.Errorf("no message %q", msgId)
	}
	for j := range p.Messages[i].Held {
		h := &p.Messages[i].Held[j]
		if h.Command != command {
			continue
		}
		if h.RunTs != 0 {
			return nil, fmt.Errorf("%q was already let through", command)
		}
		return h, nil
	}
	return nil, fmt.Errorf("message %q held no command %q", msgId, command)
}

// notLetThrough is the held commands Run now did not let through, each once: the refusals since the working agent's
// last message, and that message's own lines while a judge still owes an answer to it. Once the judge answered the hold
// no longer applies, so a line on that message was freed (and the agent very likely ran it): it is not "still held".
func notLetThrough(p *Pair) []string {
	var cmds []string
	add := func(held []wshrpc.PairHeld) {
		for _, h := range held {
			if h.RunTs == 0 && !slices.Contains(cmds, h.Command) {
				cmds = append(cmds, h.Command)
			}
		}
	}
	if w := newestWorker(p); w >= 0 && Owed(p) {
		add(p.Messages[w].Held)
	}
	add(p.Held)
	return cmds
}

// Unpair ends the pair: it leaves the list, its file stays as ended, and the hold is lifted. The working agent is told,
// in one message, which held commands it may run now.
func (m *Manager) Unpair(ctx context.Context, pairId string) error {
	var worker string
	var mayRun []string
	if !m.change(pairId, func(p *Pair) bool {
		worker, mayRun = p.Worker.Tab, notLetThrough(p)
		p.State = StateEnded
		return true
	}) {
		return errNoPair(pairId)
	}
	if len(mayRun) == 0 {
		return nil
	}
	var b strings.Builder
	b.WriteString("The pair has ended: no judge holds your heavy commands any more.\n")
	for _, cmd := range mayRun {
		fmt.Fprintf(&b, "- `%s` was held: you may run it now.\n", cmd)
	}
	if err := m.Link.Send(ctx, worker, agentmsg.PairEnvelope(strings.TrimRight(b.String(), "\n"))); err != nil {
		return fmt.Errorf("the pair ended, but the working agent was not told what it may run: %w", err)
	}
	return nil
}
