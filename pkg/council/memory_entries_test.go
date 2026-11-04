// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
)

func entry(kind, text, by string) CouncilMemoryEntry {
	return CouncilMemoryEntry{Kind: kind, Text: text, By: by}
}

func TestAddEntryNumbersAndStamps(t *testing.T) {
	m := &CouncilMemory{}
	a, err := m.AddEntry(entry(EntryAgreed, "  Cache by locale ", EntryByYou), 111)
	if err != nil {
		t.Fatalf("first AddEntry: %v", err)
	}
	b, err := m.AddEntry(entry(EntryOpen, "Who owns the cache?", EntryByAuto), 222)
	if err != nil {
		t.Fatalf("second AddEntry: %v", err)
	}
	if a.Id != "m1" || b.Id != "m2" {
		t.Errorf("ids %q %q, want m1 m2", a.Id, b.Id)
	}
	if a.At != 111 || b.At != 222 {
		t.Errorf("At %d %d, want 111 222", a.At, b.At)
	}
	if a.Text != "Cache by locale" {
		t.Errorf("text %q, want it trimmed", a.Text)
	}
	if m.NextEntry != 2 || len(m.Entries) != 2 || m.Entries[0].Id != "m1" || m.Entries[1].Id != "m2" {
		t.Errorf("memory holds %+v next %d, want m1, m2 in arrival order and next 2", m.Entries, m.NextEntry)
	}
	if _, err := m.AddEntry(entry(EntryAgreed, "   ", EntryByYou), 1); err == nil {
		t.Errorf("an empty text was accepted")
	}
	if _, err := m.AddEntry(entry("maybe", "T", EntryByYou), 1); err == nil {
		t.Errorf("an unknown kind was accepted")
	}
	if m.NextEntry != 2 || len(m.Entries) != 2 {
		t.Errorf("a refused add changed the memory: %+v next %d", m.Entries, m.NextEntry)
	}
}

func TestAddEntryRefusesDuplicateFold(t *testing.T) {
	m := &CouncilMemory{}
	if _, err := m.AddEntry(entry(EntryAgreed, "Cache by locale", EntryByYou), 1); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddEntry(entry(EntryAgreed, " cache  BY locale", EntryByAuto), 2); !errors.Is(err, errEntryExists) {
		t.Errorf("same words in another case: err %v, want errEntryExists", err)
	}
	if _, err := m.AddEntry(entry(EntryOpen, "Cache by locale", EntryByAuto), 3); err != nil {
		t.Errorf("the same words under another kind: err %v, want accepted", err)
	}
}

func TestRemovedAutoEntryNotAddedAgain(t *testing.T) {
	m := &CouncilMemory{}
	e, err := m.AddEntry(entry(EntryRuledOut, "Polling", EntryByAuto), 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveEntry(e.Id); err != nil {
		t.Fatalf("RemoveEntry: %v", err)
	}
	if len(m.Entries) != 0 {
		t.Fatalf("entry still listed: %+v", m.Entries)
	}
	if !reflect.DeepEqual(m.Removed, []string{"ruledout:polling"}) {
		t.Errorf("Removed %v, want [ruledout:polling]", m.Removed)
	}
	if _, err := m.AddEntry(entry(EntryRuledOut, " POLLING ", EntryByAuto), 2); !errors.Is(err, errEntryRemoved) {
		t.Errorf("auto re-add: err %v, want errEntryRemoved", err)
	}
	if _, err := m.AddEntry(entry(EntryRuledOut, "Polling", EntryByYou), 3); err != nil {
		t.Errorf("the person adding it back: err %v, want accepted", err)
	}
}

func TestRemoveYourEntryLeavesNoKey(t *testing.T) {
	m := &CouncilMemory{}
	e, _ := m.AddEntry(entry(EntryAgreed, "A", EntryByYou), 1)
	if err := m.RemoveEntry(e.Id); err != nil {
		t.Fatal(err)
	}
	if len(m.Removed) != 0 {
		t.Errorf("Removed %v, want nothing for the person's own entry", m.Removed)
	}
	if err := m.RemoveEntry("m9"); err == nil {
		t.Errorf("removing an unknown id did not fail")
	}
}

func TestAddEntryCap(t *testing.T) {
	m := &CouncilMemory{}
	for i := 0; i < MemoryEntriesMax; i++ {
		if _, err := m.AddEntry(entry(EntryAgreed, fmt.Sprintf("point %d", i), EntryByAuto), int64(i)); err != nil {
			t.Fatalf("entry %d: %v", i, err)
		}
	}
	if _, err := m.AddEntry(entry(EntryAgreed, "one too many", EntryByAuto), 99); !errors.Is(err, errMemoryFull) {
		t.Errorf("41st entry: err %v, want errMemoryFull", err)
	}
	if len(m.Entries) != MemoryEntriesMax {
		t.Errorf("%d entries, want %d", len(m.Entries), MemoryEntriesMax)
	}
}

func TestEditEntryBecomesYours(t *testing.T) {
	m := &CouncilMemory{}
	e, _ := m.AddEntry(entry(EntryRuledOut, "Polling", EntryByAuto), 1)
	if err := m.EditEntry(e.Id, " Long polling ", "too costly"); err != nil {
		t.Fatalf("EditEntry: %v", err)
	}
	got := m.Entries[0]
	if got.Text != "Long polling" || got.Why != "too costly" || got.By != EntryByYou || got.Id != e.Id {
		t.Errorf("edited entry %+v, want text trimmed, why kept, by you, same id", got)
	}
	if err := m.EditEntry(e.Id, "  ", ""); err == nil {
		t.Errorf("an empty edit was accepted")
	}
	if err := m.EditEntry("m9", "x", ""); err == nil {
		t.Errorf("editing an unknown id did not fail")
	}
}

func TestDropEntryKeepsTheirs(t *testing.T) {
	m := &CouncilMemory{}
	yourAgreed, _ := m.AddEntry(entry(EntryAgreed, "A", EntryByYou), 1)
	yourRuled, _ := m.AddEntry(entry(EntryRuledOut, "B", EntryByYou), 2)
	yourOpen, _ := m.AddEntry(entry(EntryOpen, "C", EntryByYou), 3)
	autoAgreed, _ := m.AddEntry(entry(EntryAgreed, "D", EntryByAuto), 4)

	if err := m.DropEntry(yourAgreed.Id); !errors.Is(err, errEntryKept) {
		t.Errorf("drop your agreed: err %v, want errEntryKept", err)
	}
	if err := m.DropEntry(yourRuled.Id); !errors.Is(err, errEntryKept) {
		t.Errorf("drop your ruled out: err %v, want errEntryKept", err)
	}
	if err := m.DropEntry(yourOpen.Id); err != nil {
		t.Errorf("drop your open: err %v, want dropped", err)
	}
	if err := m.DropEntry(autoAgreed.Id); err != nil {
		t.Errorf("drop an auto agreed: err %v, want dropped", err)
	}
	if len(m.Entries) != 2 || m.Entries[0].Id != yourAgreed.Id || m.Entries[1].Id != yourRuled.Id {
		t.Errorf("entries after drops: %+v, want only the person's agreed and ruled out", m.Entries)
	}
	if len(m.Removed) != 0 {
		t.Errorf("Removed %v, want unchanged by the check's drops", m.Removed)
	}
	if err := m.DropEntry("m9"); err == nil {
		t.Errorf("dropping an unknown id did not fail")
	}
}

func TestWhyOnlyForRuledOut(t *testing.T) {
	m := &CouncilMemory{}
	a, _ := m.AddEntry(CouncilMemoryEntry{Kind: EntryAgreed, Text: "A", Why: "because", By: EntryByYou}, 1)
	r, _ := m.AddEntry(CouncilMemoryEntry{Kind: EntryRuledOut, Text: "R", Why: "because", By: EntryByYou}, 2)
	if a.Why != "" {
		t.Errorf("agreed entry kept why %q", a.Why)
	}
	if r.Why != "because" {
		t.Errorf("ruled out entry why %q, want kept", r.Why)
	}
	if err := m.EditEntry(a.Id, "A2", "why now"); err != nil {
		t.Fatal(err)
	}
	if m.Entries[0].Why != "" {
		t.Errorf("edited agreed entry kept why %q", m.Entries[0].Why)
	}
}

func TestEntriesOfAndEntryLine(t *testing.T) {
	m := &CouncilMemory{}
	m.AddEntry(entry(EntryAgreed, "first", EntryByAuto), 1)
	m.AddEntry(entry(EntryOpen, "question", EntryByAuto), 2)
	m.AddEntry(CouncilMemoryEntry{Kind: EntryRuledOut, Text: "T", Why: "W", By: EntryByAuto}, 3)
	m.AddEntry(entry(EntryAgreed, "second", EntryByYou), 4)

	agreed := m.EntriesOf(EntryAgreed)
	if len(agreed) != 2 || agreed[0].Text != "first" || agreed[1].Text != "second" {
		t.Errorf("EntriesOf agreed: %+v, want first then second", agreed)
	}
	if got := m.EntriesOf(EntryOpen); len(got) != 1 || got[0].Id != "m2" {
		t.Errorf("EntriesOf open: %+v", got)
	}
	if got := entryLine(m.Entries[2]); got != "- [m3] T (why: W)" {
		t.Errorf("entryLine with why: %q", got)
	}
	if got := entryLine(m.Entries[0]); got != "- [m1] first" {
		t.Errorf("entryLine without why: %q", got)
	}
}

func TestTakeEntryLeavesNoKey(t *testing.T) {
	m := &CouncilMemory{}
	e, _ := m.AddEntry(entry(EntryAgreed, "A", EntryByAuto), 1)
	got, ok := m.takeEntry(e.Id)
	if !ok || got.Id != e.Id || len(m.Entries) != 0 || len(m.Removed) != 0 {
		t.Errorf("takeEntry: got %+v ok %v, entries %+v removed %v", got, ok, m.Entries, m.Removed)
	}
	if _, ok := m.takeEntry("m9"); ok {
		t.Errorf("takeEntry found an unknown id")
	}
}

func TestOldMemoryLoads(t *testing.T) {
	var m CouncilMemory
	if err := json.Unmarshal([]byte(`{"chosen":{"text":"A","how":"pin","at":5},"changed":5}`), &m); err != nil {
		t.Fatal(err)
	}
	if m.Entries != nil || m.Removed != nil || m.NextEntry != 0 {
		t.Errorf("old memory: entries %v removed %v next %d, want zero values", m.Entries, m.Removed, m.NextEntry)
	}
	if m.Chosen == nil || m.Chosen.Text != "A" {
		t.Errorf("old memory lost its direction: %+v", m.Chosen)
	}
}
