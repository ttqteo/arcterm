// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package arctools

import (
	"errors"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// a detected tool shares the library's ids, categories and choices, and is only ever suggested: never an install line
func TestDetectedFieldsValid(t *testing.T) {
	categories := map[string]bool{"Git": true, "Files": true, "System": true, "Containers": true, "Docs and data": true}
	seen := map[string]bool{}
	for _, b := range Builtin() {
		seen[b.Id] = true
	}
	for _, tool := range Detected() {
		if tool.Id == "" || seen[tool.Id] {
			t.Errorf("detected id %q is empty or repeats a built-in or another detected tool", tool.Id)
		}
		seen[tool.Id] = true
		if !tool.Detected || tool.User {
			t.Errorf("%s: a detected tool is marked Detected and not User: %+v", tool.Id, tool)
		}
		if tool.Name == "" || tool.Purpose == "" || tool.Command == "" {
			t.Errorf("%s: name, purpose and command must be set", tool.Id)
		}
		if !categories[tool.Category] || !validOpensIn(tool.OpensIn) || !validShows(tool.Shows) {
			t.Errorf("%s: category %q, opensin %q, shows %q", tool.Id, tool.Category, tool.OpensIn, tool.Shows)
		}
		if tool.Install != (Install{}) {
			t.Errorf("%s: the library never installs a detected tool, so it carries no install line", tool.Id)
		}
	}
}

func TestStatusSuggestsOnlyFoundDetectedTools(t *testing.T) {
	lookPath := func(name string) (string, error) {
		if name == "ncdu" {
			return `C:\bin\ncdu.exe`, nil
		}
		return "", errors.New("not found")
	}
	tools := []Tool{
		{Id: "lazygit", Command: "lazygit"},
		{Id: "ncdu", Command: "ncdu", Detected: true},
		{Id: "htop", Command: "htop", Detected: true},
		{Id: "tig", Command: "tig", Detected: true, User: true},
	}
	var ids []string
	for _, st := range Status(tools, lookPath) {
		ids = append(ids, st.Id)
	}
	// htop is neither found nor added; a built-in shows missing, and so does a detected tool the user added
	want := []string{"lazygit", "ncdu", "tig"}
	if len(ids) != len(want) {
		t.Fatalf("got %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("got %v, want %v", ids, want)
		}
	}
}

// adding a suggestion writes a tools.json entry of its id: it keeps its own category rather than becoming Yours
func TestMergeAddedDetectedKeepsItsSlot(t *testing.T) {
	catalog := append(Builtin(), Detected()...)
	got := Merge(catalog, map[string]wconfig.ToolKeywords{"ncdu": {Command: "ncdu"}})
	if len(got) != len(catalog) {
		t.Fatalf("got %d tools, want %d: an added detected tool is an override, not a new entry", len(got), len(catalog))
	}
	for i, tool := range got {
		if tool.Id != "ncdu" {
			continue
		}
		if catalog[i].Id != "ncdu" || !tool.User || !tool.Detected || tool.Category != "System" {
			t.Errorf("added ncdu = %+v, want its slot, User, Detected and its System category", tool)
		}
		return
	}
	t.Fatal("ncdu is missing from the merge")
}
