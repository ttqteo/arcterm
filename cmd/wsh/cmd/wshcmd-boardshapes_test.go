// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"reflect"
	"testing"
)

func TestBoardShapeLinesListsDrawingsThenTextsUnderTheirBox(t *testing.T) {
	data := `{"elements":[
		{"id":"rect0001aaaa","type":"rectangle"},
		{"id":"text0001aaaa","type":"text","text":"23/10 M4: vòng\nthích nghi","originalText":"23/10 M4: vòng thích nghi","containerId":"rect0001aaaa"},
		{"id":"frame001aaaa","type":"frame","name":"Thiết kế 21/10"},
		{"id":"text0002aaaa","type":"text","text":"  loose  label ","containerId":null},
		{"id":"text0003aaaa","type":"text","text":"gone","isDeleted":true},
		{"id":"text0004aaaa","type":"text","text":"   "},
		{"id":"frame002aaaa","type":"frame","name":""}
	]}`
	lines, more, err := boardShapeLines(data, 10)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"frame001 [drawing] Thiết kế 21/10",
		"rect0001 23/10 M4: vòng thích nghi",
		"text0002 loose label",
	}
	if !reflect.DeepEqual(lines, want) || more != 0 {
		t.Fatalf("got %q more=%d, want %q", lines, more, want)
	}
}

func TestBoardShapeLinesCapsAndCountsTheRest(t *testing.T) {
	data := `{"elements":[
		{"id":"a1","type":"text","text":"one"},
		{"id":"a2","type":"text","text":"two"},
		{"id":"a3","type":"text","text":"three"}
	]}`
	lines, more, err := boardShapeLines(data, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || more != 1 {
		t.Fatalf("got %q more=%d", lines, more)
	}
}

func TestBoardShapeLinesRefusesAFileThatIsNoBoard(t *testing.T) {
	if _, _, err := boardShapeLines("not json", 10); err == nil {
		t.Fatal("want an error")
	}
}

func TestShortIdsLengthenWhereTwoShareThePrefix(t *testing.T) {
	got := shortIds([]string{"abcdefgh111", "abcdefgh222", "zzzzzzzzzz", "abcdefgh111", "xy"}, 8)
	want := []string{"abcdefgh1", "abcdefgh2", "zzzzzzzz", "abcdefgh1", "xy"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBoardRefIDReadsTheReference(t *testing.T) {
	for in, want := range map[string]string{"board:4e0f9655": "4e0f9655", " BOARD:4E0F9655 ": "4e0f9655"} {
		if got, ok := boardRefID(in); !ok || got != want {
			t.Fatalf("%q: got %q %v", in, got, ok)
		}
	}
	for _, in := range []string{"board:", "4e0f9655", "board:xyz", "run:4e0f9655"} {
		if _, ok := boardRefID(in); ok {
			t.Fatalf("%q read as a board reference", in)
		}
	}
}
