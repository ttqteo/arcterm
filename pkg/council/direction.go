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
// message (r7) a pin comes from. Entry is the memory entry (m3) a pin is made from: the pin takes its text and its first
// message, and the entry leaves the list when the direction is set. Only a pin carries an entry.
type DirectionIn struct {
	Action, Text, From, Entry string
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
		text, entry := strings.TrimSpace(in.Text), ""
		if action == ActionPin {
			entry = strings.TrimSpace(in.Entry) // its text is read from the entry, so none is needed here
		}
		if text == "" && entry == "" {
			return nil, fmt.Errorf("direction action %q needs the direction's text", action)
		}
		return r.checkedDirection(id, action, text, strings.TrimSpace(in.From), entry)
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
// person. A pin from an entry (entry, an id in the memory) takes the entry's text and its first message, and the entry
// leaves the list only when the direction is set: a held card keeps the entry's id, and setting it anyway takes the
// entry, while discarding it leaves the entry listed. An edit makes a new direction from the new text and ends the chosen one as edited: it keeps a pin's source, since
// the edit is still about that idea, and is written by the person when the chosen one was a suggestion. It needs a chosen
// direction to edit.
//
// The check is bounded by checkTimeout and its call is booked on the council (Calls, Tokens) whatever it answered. A check
// that fails (an error, a timeout, a reply that is not an answer, a runner with no caller) holds the direction with
// `Could not check it: <error>`: a failed check never sets one.
func (r *Runner) checkedDirection(id, action, text, from, entry string) (*Council, error) {
	c, err := Load(id)
	if err != nil {
		return nil, err
	}
	d, ended := CouncilMemoryDirection{Text: text, How: DirectionWritten}, EndReplaced
	switch action {
	case ActionPin:
		if entry != "" {
			i := -1
			if c.Memory != nil {
				i = c.Memory.entryIndex(entry)
			}
			if i < 0 {
				return nil, fmt.Errorf("council %s has no memory entry %q to pin", id, entry)
			}
			e := c.Memory.Entries[i]
			text, from = e.Text, ""
			if len(e.Messages) > 0 {
				from = e.Messages[0]
			}
		}
		if from != "" && findProposal(c, from) == nil && findReply(c, from) == nil {
			return nil, fmt.Errorf("council %s has no idea or message %q to pin", id, from)
		}
		d.Text, d.How, d.From = text, DirectionPin, from
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
		reason = "Could not check it: " + errText(err)
	}
	held := err != nil || check.Verdict != CheckFits

	return Update(id, func(c *Council) error {
		if called {
			c.Calls++
			c.Tokens += res.Tokens
		}
		m, now := MemoryOf(c), r.now()
		if held {
			m.Hold(CouncilMemoryCard{Text: text, Reason: reason, How: d.How, From: d.From, Edited: action == ActionEdit, Entry: entry, At: now})
			return nil
		}
		m.Choose(d, ended, now)
		if entry != "" {
			m.takeEntry(entry) // gone already when the person removed it while the check ran: nothing to take
		}
		return nil
	})
}

// The actions of MemoryEntry, the words CouncilMemoryCommand carries: add writes an entry of the person's, edit rewrites
// one and makes it theirs, remove takes one off.
const (
	EntryActionAdd    = "add"
	EntryActionEdit   = "edit"
	EntryActionRemove = "remove"
)

var entryActions = []string{EntryActionAdd, EntryActionEdit, EntryActionRemove}

// EntryIn is what an entry action carries. Kind and Text are the new entry's for add, Text (and Why, for a Ruled out
// one) the rewrite for edit; Entry names the entry an edit or remove acts on.
type EntryIn struct {
	Action, Entry, Kind, Text, Why string
}

// MemoryEntry applies one action to the council's entries and returns the council as saved. It refuses an action it does
// not know, naming the known ones, before it loads the council. It makes no model call and, like Direction, does not
// call r.changed: CouncilMemoryCommand publishes council:changed with what it returns.
func (r *Runner) MemoryEntry(id string, in EntryIn) (*Council, error) {
	action := strings.ToLower(strings.TrimSpace(in.Action))
	if !slices.Contains(entryActions, action) {
		return nil, fmt.Errorf("unknown memory action %q: use %s", in.Action, strings.Join(entryActions, ", "))
	}
	return Update(id, func(c *Council) error {
		m, now := MemoryOf(c), r.now() // the memory a refused move made is dropped with the save
		switch action {
		case EntryActionAdd:
			_, err := m.AddEntry(CouncilMemoryEntry{Kind: strings.TrimSpace(in.Kind), Text: in.Text, Why: in.Why, By: EntryByYou}, now)
			return err
		case EntryActionEdit:
			return m.EditEntry(strings.TrimSpace(in.Entry), in.Text, in.Why)
		default: // EntryActionRemove
			return m.RemoveEntry(strings.TrimSpace(in.Entry))
		}
	})
}
