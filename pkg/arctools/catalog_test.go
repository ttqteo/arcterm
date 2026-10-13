// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package arctools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestBuiltinIdsUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, tool := range Builtin() {
		if tool.Id == "" {
			t.Fatalf("a built-in has an empty id: %+v", tool)
		}
		if seen[tool.Id] {
			t.Fatalf("duplicate built-in id %q", tool.Id)
		}
		seen[tool.Id] = true
	}
	if len(seen) == 0 {
		t.Fatal("the catalog is empty")
	}
}

func TestBuiltinFieldsValid(t *testing.T) {
	categories := map[string]bool{"Git": true, "Files": true, "System": true, "Containers": true, "Docs and data": true}
	opensIn := map[string]bool{"agent": true, "root": true, "home": true}
	shows := map[string]bool{"centre": true, "panel": true}
	for _, tool := range Builtin() {
		if tool.Name == "" || tool.Purpose == "" {
			t.Errorf("%s: name and purpose are shown in the library, so both must be set", tool.Id)
		}
		if !categories[tool.Category] {
			t.Errorf("%s: category %q is not a built-in category", tool.Id, tool.Category)
		}
		if !opensIn[tool.OpensIn] {
			t.Errorf("%s: opensin %q is not agent, root or home", tool.Id, tool.OpensIn)
		}
		if !shows[tool.Shows] {
			t.Errorf("%s: shows %q is not centre or panel", tool.Id, tool.Shows)
		}
		if tool.Command == "" {
			t.Errorf("%s: command is empty", tool.Id)
		}
		if tool.User {
			t.Errorf("%s: a built-in must not be marked as a user tool", tool.Id)
		}
		if tool.Install.Darwin == "" {
			t.Errorf("%s: every built-in installs with brew", tool.Id)
		}
	}
}

func TestBuiltinOrder(t *testing.T) {
	want := []string{"lazygit", "gitui", "yazi", "broot", "btop", "lazydocker", "k9s", "glow", "visidata"}
	got := Builtin()
	if len(got) != len(want) {
		t.Fatalf("got %d built-ins, want %d", len(got), len(want))
	}
	for i, id := range want {
		if got[i].Id != id {
			t.Errorf("built-in %d is %q, want %q", i, got[i].Id, id)
		}
	}
	for _, tool := range got {
		if tool.Id == "btop" && tool.OpensIn != "home" {
			t.Errorf("btop watches the machine, not a project: opensin = %q, want home", tool.OpensIn)
		}
		if tool.Id == "visidata" && tool.Command != "vd" {
			t.Errorf("visidata's command is vd, got %q", tool.Command)
		}
	}
}

func TestMergeUserTools(t *testing.T) {
	builtin := Builtin()
	user := map[string]wconfig.ToolKeywords{
		"ghdash":  {Name: "PR dashboard", Command: "gh", Args: "dash", OpensIn: "root", InstallWindows: "winget install --id GitHub.cli -e", InstallDarwin: "brew install gh"},
		"abacus":  {Command: "abacus"},
		"lazygit": {Name: "lazygit", Command: "lazygit", Args: "--debug"}, // a user entry overrides a built-in by id
	}
	got := Merge(builtin, user)

	// built-ins keep their order; the overridden lazygit keeps its slot
	if len(got) != len(builtin)+2 {
		t.Fatalf("got %d tools, want %d built-ins + 2 user-only", len(got), len(builtin)+2)
	}
	for i, b := range builtin {
		if got[i].Id != b.Id {
			t.Fatalf("slot %d is %q, want %q: a merge must keep the built-in order", i, got[i].Id, b.Id)
		}
	}

	// the override carries the user's fields and User=true; what the entry leaves unset stays the built-in's
	lg := got[0]
	if lg.Id != "lazygit" || !lg.User || lg.Args != "--debug" || lg.Command != "lazygit" {
		t.Errorf("overridden lazygit = %+v, want the user's args and User=true", lg)
	}
	if lg.Category != builtin[0].Category || lg.Purpose != builtin[0].Purpose || lg.OpensIn != builtin[0].OpensIn || lg.Install != builtin[0].Install {
		t.Errorf("overridden lazygit lost the fields the user left unset: %+v", lg)
	}
	if got[1].User {
		t.Errorf("gitui was not overridden but is marked User")
	}

	// user-only entries follow the built-ins, sorted by id, with the user-tool defaults
	n := len(builtin)
	if got[n].Id != "abacus" || got[n+1].Id != "ghdash" {
		t.Fatalf("user-only entries are %q, %q; want abacus, ghdash (sorted by id)", got[n].Id, got[n+1].Id)
	}
	ab := got[n]
	if !ab.User || ab.Category != "Yours" || ab.Shows != "centre" || ab.OpensIn != "agent" || ab.Name != "abacus" {
		t.Errorf("abacus = %+v, want User, Category Yours, Shows centre, OpensIn agent, Name defaulting to the id", ab)
	}
	gh := got[n+1]
	if gh.Name != "PR dashboard" || gh.Command != "gh" || gh.Args != "dash" || gh.OpensIn != "root" || gh.Category != "Yours" {
		t.Errorf("ghdash = %+v", gh)
	}
	if gh.Install.Windows != "winget install --id GitHub.cli -e" || gh.Install.Darwin != "brew install gh" {
		t.Errorf("ghdash install lines = %+v, want the entry's install:windows and install:darwin", gh.Install)
	}
}

func TestMergeDoesNotMutateBuiltin(t *testing.T) {
	builtin := Builtin()
	Merge(builtin, map[string]wconfig.ToolKeywords{"lazygit": {Command: "lazygit", Args: "--debug"}})
	if builtin[0].Args != "" || builtin[0].User {
		t.Errorf("Merge changed the slice it was given: %+v", builtin[0])
	}
}

func TestMergeNoUserTools(t *testing.T) {
	builtin := Builtin()
	got := Merge(builtin, nil)
	if len(got) != len(builtin) {
		t.Fatalf("got %d tools, want %d", len(got), len(builtin))
	}
	for i := range builtin {
		if got[i] != builtin[i] {
			t.Errorf("slot %d changed with no user tools: %+v vs %+v", i, got[i], builtin[i])
		}
	}
}

func TestMergeBadChoicesFallBack(t *testing.T) {
	got := Merge(nil, map[string]wconfig.ToolKeywords{"x": {Command: "x", OpensIn: "moon", Shows: "sideways"}})
	if len(got) != 1 {
		t.Fatalf("got %d tools, want 1", len(got))
	}
	if got[0].OpensIn != "agent" || got[0].Shows != "centre" {
		t.Errorf("a typo in tools.json must fall back to the defaults, got opensin %q shows %q", got[0].OpensIn, got[0].Shows)
	}
}

// tools.json is read into FullConfigType.Tools like projects.json, and SetUserTool writes it: an entry set and then
// read back through ReadFullConfig must reach Merge, and a nil entry must remove it.
func TestUserToolsFileRoundTrip(t *testing.T) {
	old := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = t.TempDir()
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = old })

	if err := wconfig.SetUserTool("ghdash", nil); err != nil {
		t.Fatalf("removing from a missing tools.json: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wavebase.ConfigHome_VarCache, wconfig.ToolsFile)); err == nil {
		t.Fatal("removing a tool that was never there created tools.json")
	}

	if err := wconfig.SetUserTool("ghdash", &wconfig.ToolKeywords{Name: "PR dashboard", Command: "gh", Args: "dash", OpensIn: "root", InstallDarwin: "brew install gh"}); err != nil {
		t.Fatalf("set ghdash: %v", err)
	}
	if err := wconfig.SetUserTool("lazygit", &wconfig.ToolKeywords{Command: "lazygit", Args: "--debug"}); err != nil {
		t.Fatalf("set lazygit: %v", err)
	}
	got := Merge(Builtin(), wconfig.ReadFullConfig().Tools)
	if got[0].Id != "lazygit" || got[0].Args != "--debug" || !got[0].User {
		t.Errorf("lazygit override did not survive the file: %+v", got[0])
	}
	last := got[len(got)-1]
	if last.Id != "ghdash" || last.Name != "PR dashboard" || last.OpensIn != "root" || last.Install.Darwin != "brew install gh" {
		t.Errorf("ghdash did not survive the file: %+v", last)
	}

	if err := wconfig.SetUserTool("ghdash", nil); err != nil {
		t.Fatalf("remove ghdash: %v", err)
	}
	got = Merge(Builtin(), wconfig.ReadFullConfig().Tools)
	if len(got) != len(Builtin()) {
		t.Errorf("got %d tools after removing ghdash, want %d", len(got), len(Builtin()))
	}
	if got[0].Args != "--debug" {
		t.Errorf("removing ghdash dropped the lazygit entry: %+v", got[0])
	}
}
