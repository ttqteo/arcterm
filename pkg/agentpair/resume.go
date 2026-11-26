// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"context"
	"errors"
	"slices"
)

// Resume puts a stopped pair back to relaying and delivers what is still queued, with no message from the person and no
// line in the timeline. After a token-cap stop the cap counts again from now. It refuses a pair that is not stopped, a
// pair with no judge left and a pair with nothing queued that calls for an answer (resuming that one would leave it
// "relaying" while nobody works), each with an error that says what to do instead.
func (m *Manager) Resume(ctx context.Context, pairId string) error {
	var refused error
	if !m.change(pairId, func(p *Pair) bool {
		if refused = checkResume(p); refused != nil {
			return false
		}
		resume(p, m.nowMs())
		return true
	}) {
		return errNoPair(pairId)
	}
	if refused != nil {
		return refused
	}
	m.deliverAll(ctx, pairId, true)
	return nil
}

// checkResume is why Resume refuses the pair, nil when it may go on. The lock is held.
func checkResume(p *Pair) error {
	switch {
	case p.State != StateStopped:
		return errors.New("the pair is not stopped, so there is nothing to resume")
	case p.StopReason == StopJudgesGone:
		return errors.New("no judge is left, so resuming would stop the pair again: use Add judge to pair a new one")
	case !canResume(p):
		return errors.New("nothing is queued to deliver, so resuming would leave nobody working: send a message to go on")
	}
	return nil
}

// canResume reports whether Resume would deliver something: the pair is stopped (not by judges-gone) and the working
// agent's queue or a live judge's still calls for an answer, judged as if the pair were relaying. After a no-new-points
// or both-agree stop the queues are empty, so it is false; in practice it is true after a token cap.
func canResume(p *Pair) bool {
	if p.State != StateStopped || p.StopReason == StopJudgesGone {
		return false
	}
	return slices.ContainsFunc(memberTabs(p), func(tab string) bool { return callsForAnswer(p, tab) })
}
