// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"errors"
	"slices"
	"strings"
)

// The moves on a council's memory. They are pure: the Runner applies them to the council inside its Update, and
// decides there what each move needs besides (the pre-set check, the save, the event). A move that cannot apply says so
// with an error and changes nothing.

var (
	errNoChosen     = errors.New("no direction is chosen")
	errNoHeld       = errors.New("no direction is held")
	errNoSuggestion = errors.New("no suggestion is waiting")
)

// MemoryOf is the council's memory, made on first use.
func MemoryOf(c *Council) *CouncilMemory {
	if c.Memory == nil {
		c.Memory = &CouncilMemory{}
	}
	return c.Memory
}

// foldText is the text a suggestion is compared by: lower case, single spaces.
func foldText(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// SuggestionKey names a suggestion for Dismissed: the idea it came from when all the seats agreed on one, else its
// text, so the same words in another case or spacing are the same suggestion.
func SuggestionKey(card CouncilMemoryCard) string {
	if card.Source == SourceGreen && card.From != "" {
		return "idea:" + card.From
	}
	return "text:" + foldText(card.Text)
}

// Choose makes d the chosen direction. The old one, if any, moves to the head of Replaced, ended as `ended`
// (EndReplaced when empty). A direction that is set settles any held card; a waiting suggestion stays. d.At is now
// when the caller left it empty.
func (m *CouncilMemory) Choose(d CouncilMemoryDirection, ended string, now int64) {
	if m.Chosen != nil {
		m.leave(ended, now)
	}
	if d.At == 0 {
		d.At = now
	}
	d.Replaced, d.Ended = 0, ""
	m.Chosen = &d
	m.Held = nil
	m.Changed = now
}

// leave moves the chosen direction to the head of Replaced. Chosen must be set.
func (m *CouncilMemory) leave(ended string, now int64) {
	if ended == "" {
		ended = EndReplaced
	}
	old := *m.Chosen
	old.Replaced, old.Ended = now, ended
	m.Replaced = slices.Insert(m.Replaced, 0, old)
	m.Chosen = nil
}

// Unpin takes the chosen direction off with no replacement.
func (m *CouncilMemory) Unpin(now int64) error {
	if m.Chosen == nil {
		return errNoChosen
	}
	m.leave(EndUnpinned, now)
	m.Changed = now
	return nil
}

// Hold holds a direction back for the person to settle, in place of an earlier held card.
func (m *CouncilMemory) Hold(card CouncilMemoryCard) {
	card.Kind = CardHeld
	m.Held = &card
}

// SetAnyway sets the held card as the chosen direction. The old one ends as EndEdited when the card came from Edit,
// else as EndReplaced.
func (m *CouncilMemory) SetAnyway(now int64) error {
	if m.Held == nil {
		return errNoHeld
	}
	card := *m.Held
	ended := EndReplaced
	if card.Edited {
		ended = EndEdited
	}
	m.Choose(CouncilMemoryDirection{
		Text:   card.Text,
		How:    card.How,
		Source: card.Source,
		Round:  card.Round,
		From:   card.From,
		At:     now,
	}, ended, now)
	return nil
}

// Discard drops the held card and leaves the chosen direction as it is.
func (m *CouncilMemory) Discard() error {
	if m.Held == nil {
		return errNoHeld
	}
	m.Held = nil
	return nil
}

// Raise puts a suggestion in its slot, in place of a waiting one (which is pushed out, not dismissed). It reports false,
// and changes nothing, for a suggestion the person dismissed or one that says what the chosen direction already says.
// The held card is never touched.
func (m *CouncilMemory) Raise(card CouncilMemoryCard) bool {
	if slices.Contains(m.Dismissed, SuggestionKey(card)) {
		return false
	}
	if m.Chosen != nil && foldText(m.Chosen.Text) == foldText(card.Text) {
		return false
	}
	card.Kind = CardSuggestion
	m.Suggestion = &card
	return true
}

// Accept sets the waiting suggestion as the chosen direction, with no check.
func (m *CouncilMemory) Accept(now int64) error {
	if m.Suggestion == nil {
		return errNoSuggestion
	}
	card := *m.Suggestion
	m.Choose(CouncilMemoryDirection{
		Text:   card.Text,
		How:    DirectionSuggested,
		Source: card.Source,
		Round:  card.Round,
		From:   card.From,
		At:     now,
	}, EndReplaced, now)
	m.Suggestion = nil
	return nil
}

// Dismiss clears the waiting suggestion and records its key, so it is not raised again.
func (m *CouncilMemory) Dismiss() error {
	if m.Suggestion == nil {
		return errNoSuggestion
	}
	m.Dismissed = append(m.Dismissed, SuggestionKey(*m.Suggestion))
	m.Suggestion = nil
	return nil
}
