// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

// The actions of Direction, the words CouncilDirectionCommand carries: set types a direction, pin (Chốt) takes one from
// an idea or a message, edit rewrites the chosen one, accept takes the waiting suggestion, dismiss turns it away,
// setanyway and discard settle the held card, and unpin takes the chosen direction off.
const (
	ActionSet       = "set"
	ActionPin       = "pin"
	ActionEdit      = "edit"
	ActionAccept    = "accept"
	ActionDismiss   = "dismiss"
	ActionSetAnyway = "setanyway"
	ActionDiscard   = "discard"
	ActionUnpin     = "unpin"
)

// directionActions is every action word, in the order the refusal lists them.
var directionActions = []string{
	ActionSet, ActionPin, ActionEdit, ActionAccept, ActionDismiss, ActionSetAnyway, ActionDiscard, ActionUnpin,
}

// DirectionIn is what a direction action carries. Text is the direction for set, pin and edit; From is the idea (P3) or
// message (r7) a pin comes from.
type DirectionIn struct {
	Action, Text, From string
}

// Direction applies one action to the council's direction memory and returns the council as saved. It refuses an action
// it does not know, naming it, and a set, pin or edit with no text, before it loads the council or makes a call. It does
// not call r.changed: CouncilDirectionCommand publishes council:changed with what it returns, so doing both would
// announce one change twice.
//
// Set, pin and edit are checked before they are set (presetCall): a direction that fits becomes the chosen one, and one
// that clashes, is unclear or whose check did not answer is held for the person, who sets it anyway or discards it.
// accept, dismiss, setanyway, discard and unpin apply their move on the memory with no check.
func (r *Runner) Direction(id string, in DirectionIn) (*Council, error) {
	action := strings.ToLower(strings.TrimSpace(in.Action))
	if !slices.Contains(directionActions, action) {
		return nil, fmt.Errorf("unknown direction action %q: use %s", in.Action, strings.Join(directionActions, ", "))
	}
	switch action {
	case ActionSet, ActionPin, ActionEdit:
		text := strings.TrimSpace(in.Text)
		if text == "" {
			return nil, fmt.Errorf("direction action %q needs the direction's text", action)
		}
		return r.checkedDirection(id, action, text, strings.TrimSpace(in.From))
	}
	return Update(id, func(c *Council) error {
		m, now := MemoryOf(c), r.now() // the memory a refused move made is dropped with the save
		switch action {
		case ActionAccept:
			return m.Accept(now)
		case ActionDismiss:
			return m.Dismiss()
		case ActionSetAnyway:
			return m.SetAnyway(now)
		case ActionDiscard:
			return m.Discard()
		default: // ActionUnpin
			return m.Unpin(now)
		}
	})
}

// checkedDirection is set, pin and edit: text goes through the pre-set check and is then set or held.
//
// A pin keeps the idea or message it came from (from must name one that is there); a typed direction is written by the
// person. An edit makes a new direction from the new text and ends the chosen one as edited: it keeps a pin's source, since
// the edit is still about that idea, and is written by the person when the chosen one was a suggestion. It needs a chosen
// direction to edit.
//
// The check is bounded by checkTimeout and its call is booked on the council (Calls, Tokens) whatever it answered. A check
// that fails (an error, a timeout, a reply that is not an answer, a runner with no caller) holds the direction with
// `The check did not answer: <error>`: a failed check never sets one.
func (r *Runner) checkedDirection(id, action, text, from string) (*Council, error) {
	c, err := Load(id)
	if err != nil {
		return nil, err
	}
	d, ended := CouncilMemoryDirection{Text: text, How: DirectionWritten}, EndReplaced
	switch action {
	case ActionPin:
		if from != "" && findProposal(c, from) == nil && findReply(c, from) == nil {
			return nil, fmt.Errorf("council %s has no idea or message %q to pin", id, from)
		}
		d.How, d.From = DirectionPin, from
	case ActionEdit:
		if c.Memory == nil || c.Memory.Chosen == nil {
			return nil, errNoChosen
		}
		if old := c.Memory.Chosen; old.How == DirectionPin {
			d.How, d.From = DirectionPin, old.From
		}
		ended = EndEdited
	}

	ctx, cancel := context.WithTimeout(context.Background(), checkTimeout)
	defer cancel()
	check, res, err := r.presetCall(ctx, c, text)
	called := r.Caller != nil // a runner with no caller made no call to book
	reason := check.Reason
	if err != nil {
		reason = "The check did not answer: " + errText(err)
	}
	held := err != nil || check.Verdict != CheckFits

	return Update(id, func(c *Council) error {
		if called {
			c.Calls++
			c.Tokens += res.Tokens
		}
		m, now := MemoryOf(c), r.now()
		if held {
			m.Hold(CouncilMemoryCard{Text: text, Reason: reason, How: d.How, From: d.From, Edited: action == ActionEdit, At: now})
			return nil
		}
		m.Choose(d, ended, now)
		return nil
	})
}
