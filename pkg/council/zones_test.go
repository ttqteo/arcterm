// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"reflect"
	"strings"
	"testing"
)

// zonesCouncil is a Brainstorm with three panel seats, its coordinator last.
func zonesCouncil() *Council {
	c := promptCouncil()
	c.Mode = ModeBrainstorm
	c.Experts[0].Brief = brief("Can someone use it without being told how?")
	return c
}

func zonesReply(entries ...map[string]string) string {
	return jsonFence(mustJSON(map[string]any{"zones": entries}))
}

func zoneEntry(seat, name, covers string) map[string]string {
	return map[string]string{"seat": seat, "name": name, "covers": covers}
}

func TestParseZones(t *testing.T) {
	panel := panelOf(zonesCouncil()) // ux, ram, skeptic
	good := []CouncilZone{
		{Seat: "ux", Name: "First launch", Covers: "What a newcomer sees first."},
		{Seat: "ram", Name: "Idle cost", Covers: "What a sleeping service holds."},
		{Seat: "skeptic", Name: "Wake failures", Covers: "What breaks on wake."},
	}
	cases := []struct {
		name  string
		reply string
		want  []CouncilZone
	}{
		{"a good reply, out of order and padded, reads in panel order", zonesReply(
			zoneEntry(" skeptic ", " Wake failures ", " What breaks on wake. "),
			zoneEntry("ux", "First launch", "What a newcomer sees first."),
			zoneEntry("ram", "Idle cost", "What a sleeping service holds."),
		), good},
		{"an unknown seat is dropped", zonesReply(
			zoneEntry("ux", "First launch", "What a newcomer sees first."),
			zoneEntry("ghost", "Ghost zone", "x"),
			zoneEntry("ram", "Idle cost", "What a sleeping service holds."),
			zoneEntry("skeptic", "Wake failures", "What breaks on wake."),
		), good},
		{"a second entry for a seat is dropped", zonesReply(
			zoneEntry("ux", "First launch", "What a newcomer sees first."),
			zoneEntry("ux", "Second launch", "x"),
			zoneEntry("ram", "Idle cost", "What a sleeping service holds."),
			zoneEntry("skeptic", "Wake failures", "What breaks on wake."),
		), good},
		{"a nameless entry is dropped, and a later one for the seat counts", zonesReply(
			zoneEntry("ux", "  ", "x"),
			zoneEntry("ux", "First launch", "What a newcomer sees first."),
			zoneEntry("ram", "Idle cost", "What a sleeping service holds."),
			zoneEntry("skeptic", "Wake failures", "What breaks on wake."),
		), good},
	}
	for _, tc := range cases {
		got, err := parseZones(tc.reply, panel)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %+v, %v; want %+v", tc.name, got, err, tc.want)
		}
	}

	bad := []struct {
		name  string
		reply string
	}{
		{"a missing seat", zonesReply(
			zoneEntry("ux", "First launch", "x"),
			zoneEntry("ram", "Idle cost", "x"),
		)},
		{"an unknown seat in place of a panel seat", zonesReply(
			zoneEntry("ux", "First launch", "x"),
			zoneEntry("ram", "Idle cost", "x"),
			zoneEntry("ghost", "Wake failures", "x"),
		)},
		{"a duplicate seat in place of another", zonesReply(
			zoneEntry("ux", "First launch", "x"),
			zoneEntry("ram", "Idle cost", "x"),
			zoneEntry("ram", "Wake failures", "x"),
		)},
		{"a nameless entry for a seat", zonesReply(
			zoneEntry("ux", "First launch", "x"),
			zoneEntry("ram", "Idle cost", "x"),
			zoneEntry("skeptic", "", "What breaks on wake."),
		)},
		{"garbage", "I would split it by journey."},
		{"no zones field", jsonFence(`{"areas": []}`)},
	}
	for _, tc := range bad {
		if got, err := parseZones(tc.reply, panel); err == nil || got != nil {
			t.Errorf("%s: got %+v, %v; want no zones and an error", tc.name, got, err)
		}
	}
}

func TestZonesPrompt(t *testing.T) {
	c := zonesCouncil()
	p := zonesPrompt(c)
	if !strings.HasPrefix(p, zonesOpening) {
		t.Errorf("zones prompt opens %q, want %q", firstSentence(p), zonesOpening)
	}
	mustContain(t, "zones prompt", p, "Idle sleep for services", "Which direction first?", "pkg/services/idle.go", "docs/spec.md",
		`D:\shots\tree.png`, "- ux (UX): Can someone use it without being told how?", "- ram (RAM): What stays in memory?",
		"- skeptic (Skeptic): Name what breaks.", "one zone for each seat", "no two alike", "fits it best", jsonRule, `"zones"`,
		`"seat"`, `"name"`, `"covers"`)
	// the coordinator is not a seat to zone, the brief's evidence rule is cut, and no file is read into the prompt
	mustNotContain(t, "zones prompt", p, "lead (Lead)", briefEvidenceRule, "Vietnamese", "This is round")

	c.Lang = LangVi
	mustContain(t, "vi zones prompt", zonesPrompt(c), "Vietnamese")
}
