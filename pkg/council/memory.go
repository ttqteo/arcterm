// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"errors"
	"slices"
	"strconv"
	"strings"
)

// The moves on a council's memory. They are pure: the Runner applies them to the council inside its Update, and
// decides there what each move needs besides (the pre-set check, the save, the event). A move that cannot apply says so
// with an error and changes nothing.

var (
	errNoChosen     = errors.New("no direction is chosen")
	errNoHeld       = errors.New("no direction is held")
	errNoSuggestion = errors.New("no suggestion is waiting")

	errEntryText    = errors.New("an entry needs text")
	errEntryKind    = errors.New("unknown entry kind")
	errEntryExists  = errors.New("the memory already holds that entry")
	errEntryRemoved = errors.New("the person removed that entry")
	errMemoryFull   = errors.New("the memory is full")
	errNoEntry      = errors.New("no such entry")
	errEntryKept    = errors.New("the person's entry stays")
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

// EntryKey names an entry by its kind and folded text: what Removed holds, and what a second entry may not repeat.
func EntryKey(e CouncilMemoryEntry) string {
	return e.Kind + ":" + foldText(e.Text)
}

func validEntryKind(kind string) bool {
	return kind == EntryAgreed || kind == EntryRuledOut || kind == EntryOpen
}

// whyFor is the reason an entry of this kind keeps: only Ruled out has one.
func whyFor(kind, why string) string {
	if kind != EntryRuledOut {
		return ""
	}
	return strings.TrimSpace(why)
}

func (m *CouncilMemory) entryIndex(id string) int {
	return slices.IndexFunc(m.Entries, func(e CouncilMemoryEntry) bool { return e.Id == id })
}

// AddEntry adds e at the end and returns it as stored, numbered and stamped. It refuses, and changes nothing, an empty
// text, an unknown kind, a key an entry already has, an automatic entry the person removed before, and a full memory.
func (m *CouncilMemory) AddEntry(e CouncilMemoryEntry, now int64) (CouncilMemoryEntry, error) {
	e.Text = strings.TrimSpace(e.Text)
	if e.Text == "" {
		return CouncilMemoryEntry{}, errEntryText
	}
	if !validEntryKind(e.Kind) {
		return CouncilMemoryEntry{}, errEntryKind
	}
	e.Why = whyFor(e.Kind, e.Why)
	key := EntryKey(e)
	for _, have := range m.Entries {
		if EntryKey(have) == key {
			return CouncilMemoryEntry{}, errEntryExists
		}
	}
	if e.By == EntryByAuto && slices.Contains(m.Removed, key) {
		return CouncilMemoryEntry{}, errEntryRemoved
	}
	if len(m.Entries) >= MemoryEntriesMax {
		return CouncilMemoryEntry{}, errMemoryFull
	}
	m.NextEntry++
	e.Id = "m" + strconv.Itoa(m.NextEntry)
	e.At = now
	m.Entries = append(m.Entries, e)
	return e, nil
}

// EditEntry rewrites an entry in place and makes it the person's.
func (m *CouncilMemory) EditEntry(id, text, why string) error {
	i := m.entryIndex(id)
	if i < 0 {
		return errNoEntry
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return errEntryText
	}
	e := &m.Entries[i]
	e.Text = text
	e.Why = whyFor(e.Kind, why)
	e.By = EntryByYou
	return nil
}

// RemoveEntry takes an entry off at the person's word. An automatic one leaves its key in Removed, so the check does not
// add it back.
func (m *CouncilMemory) RemoveEntry(id string) error {
	e, ok := m.takeEntry(id)
	if !ok {
		return errNoEntry
	}
	if e.By == EntryByAuto {
		if key := EntryKey(e); !slices.Contains(m.Removed, key) {
			m.Removed = append(m.Removed, key)
		}
	}
	return nil
}

// DropEntry is the round check's drop: allowed for an automatic entry or any Open one (the person's included), never
// the person's Agreed or Ruled out. It leaves no key in Removed.
func (m *CouncilMemory) DropEntry(id string) error {
	i := m.entryIndex(id)
	if i < 0 {
		return errNoEntry
	}
	if e := m.Entries[i]; e.By != EntryByAuto && e.Kind != EntryOpen {
		return errEntryKept
	}
	m.Entries = slices.Delete(m.Entries, i, i+1)
	return nil
}

// takeEntry removes an entry and leaves no key behind: the way one goes when it is promoted to the direction.
func (m *CouncilMemory) takeEntry(id string) (CouncilMemoryEntry, bool) {
	i := m.entryIndex(id)
	if i < 0 {
		return CouncilMemoryEntry{}, false
	}
	e := m.Entries[i]
	m.Entries = slices.Delete(m.Entries, i, i+1)
	return e, true
}

// EntriesOf is the entries of one kind, in arrival order.
func (m *CouncilMemory) EntriesOf(kind string) []CouncilMemoryEntry {
	var out []CouncilMemoryEntry
	for _, e := range m.Entries {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

// entryLine is one entry as a prompt line: `- [m3] text`, with ` (why: …)` when it has a reason.
func entryLine(e CouncilMemoryEntry) string {
	line := "- [" + e.Id + "] " + e.Text
	if e.Why != "" {
		line += " (why: " + e.Why + ")"
	}
	return line
}
