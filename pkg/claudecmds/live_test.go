// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudecmds

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestLiveSetThenGetReturnsACopy(t *testing.T) {
	list := []LiveCommand{
		{Name: "clear", Description: "Clear the conversation", Source: "builtin"},
		{Name: "skim", Description: "Toggle skim", Source: "plugin", Plugin: "skim-mod"},
	}
	if err := SetLive("b-copy", list); err != nil {
		t.Fatalf("SetLive: %v", err)
	}
	// the caller's slice is not the stored one either
	list[0].Name = "changed-by-caller"
	got, ok := Live("b-copy")
	if !ok {
		t.Fatal("Live: no list for a block that was set")
	}
	want := []LiveCommand{
		{Name: "clear", Description: "Clear the conversation", Source: "builtin"},
		{Name: "skim", Description: "Toggle skim", Source: "plugin", Plugin: "skim-mod"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Live = %+v, want %+v", got, want)
	}
	got[0].Name = "changed-by-reader"
	again, _ := Live("b-copy")
	if !reflect.DeepEqual(again, want) {
		t.Fatalf("mutating the returned slice changed the stored list: %+v", again)
	}
}

func TestLiveUnknownBlock(t *testing.T) {
	got, ok := Live("nope")
	if ok || got != nil {
		t.Fatalf("Live(nope) = %+v, %v; want nil, false", got, ok)
	}
}

func TestLiveSetReplaces(t *testing.T) {
	if err := SetLive("b-replace", []LiveCommand{{Name: "a", Source: "builtin"}, {Name: "b", Source: "builtin"}}); err != nil {
		t.Fatalf("first SetLive: %v", err)
	}
	if err := SetLive("b-replace", []LiveCommand{{Name: "c", Source: "user"}}); err != nil {
		t.Fatalf("second SetLive: %v", err)
	}
	got, ok := Live("b-replace")
	if !ok || len(got) != 1 || got[0].Name != "c" {
		t.Fatalf("Live after replace = %+v, %v; want only c", got, ok)
	}
}

func TestLiveSetRefusals(t *testing.T) {
	if err := SetLive("", []LiveCommand{{Name: "a"}}); err == nil {
		t.Error("SetLive with an empty block id: want an error")
	}
	big := make([]LiveCommand, maxLiveCommands+1)
	for i := range big {
		big[i] = LiveCommand{Name: fmt.Sprintf("c%d", i), Source: "builtin"}
	}
	if err := SetLive("b-big", big); err == nil {
		t.Error("SetLive with a list over the cap: want an error")
	}
	if _, ok := Live("b-big"); ok {
		t.Error("a refused list was stored")
	}
	atCap := big[:maxLiveCommands]
	if err := SetLive("b-cap", atCap); err != nil {
		t.Errorf("SetLive at the cap: %v", err)
	}
}

func TestLiveSetDropsNamelessAndCutsDescriptions(t *testing.T) {
	long := strings.Repeat("é", 400)
	err := SetLive("b-clean", []LiveCommand{
		{Name: "", Description: "no name", Source: "builtin"},
		{Name: "keep", Description: long, Source: "user"},
	})
	if err != nil {
		t.Fatalf("SetLive: %v", err)
	}
	got, _ := Live("b-clean")
	if len(got) != 1 || got[0].Name != "keep" {
		t.Fatalf("Live = %+v; want only keep", got)
	}
	if n := len([]rune(got[0].Description)); n != maxLiveDescription {
		t.Errorf("description kept %d characters; want %d", n, maxLiveDescription)
	}
}
