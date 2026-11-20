// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// forkLinesIn is a two-turn session that ran in cwd.
func forkLinesIn(cwd string) []string {
	q := strconv.Quote(cwd)
	return []string{
		`{"type":"mode"}`,
		`{"type":"user","uuid":"u1","cwd":` + q + `,"message":{"content":"first"}}`,
		`{"type":"assistant","uuid":"a1","parentUuid":"u1","cwd":` + q + `,"message":{"content":[{"type":"text","text":"one"}]}}`,
		`{"type":"user","uuid":"u2","parentUuid":"a1","cwd":` + q + `,"message":{"content":"second"}}`,
		`{"type":"assistant","uuid":"a2","parentUuid":"u2","cwd":` + q + `,"message":{"content":[{"type":"text","text":"two"}]}}`,
	}
}

func forkLines() []string { return forkLinesIn("D:/p") }

func TestCutTranscript(t *testing.T) {
	lines := forkLines()
	cases := []struct {
		name, uuid, keep string
		want             int // lines kept; -1 = error
	}{
		{"before your second message", "u2", "before", 3},
		{"through the first reply", "a1", "through", 3},
		{"through the last reply", "a2", "through", 5},
		{"before the first message keeps no message", "u1", "before", -1},
		{"a uuid no longer in the file", "gone", "through", -1},
		{"an unknown keep", "a1", "after", -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := CutTranscript(lines, c.uuid, c.keep)
			if c.want < 0 {
				if err == nil {
					t.Fatalf("want an error, got %d lines", len(got))
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != c.want {
				t.Fatalf("kept %d lines, want %d", len(got), c.want)
			}
		})
	}
}

func TestForkCommandWholeSession(t *testing.T) {
	home := t.TempDir()
	proj := t.TempDir()
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	os.WriteFile(src, []byte(strings.Join(forkLinesIn(proj), "\n")+"\n"), 0o644)
	got, err := ForkCommand(src, "", "", home)
	if err != nil {
		t.Fatal(err)
	}
	want := `claude --resume "` + filepath.ToSlash(src) + `" --fork-session`
	if got.Command != want {
		t.Fatalf("command %q, want %q", got.Command, want)
	}
	if got.ProjectPath != proj {
		t.Fatalf("project %q, want %q", got.ProjectPath, proj)
	}
	if entries, _ := os.ReadDir(filepath.Join(home, ".arc", "forks")); len(entries) != 0 {
		t.Fatalf("a whole-session fork wrote %d copies", len(entries))
	}
}

func TestForkCommandFromAMessage(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	os.WriteFile(src, []byte(strings.Join(forkLinesIn(t.TempDir()), "\n")+"\n"), 0o644)
	got, err := ForkCommand(src, "u2", "before", home)
	if err != nil {
		t.Fatal(err)
	}
	copies, _ := filepath.Glob(filepath.Join(home, ".arc", "forks", "*", "s1.jsonl"))
	if len(copies) != 1 {
		t.Fatalf("want one copy named after the source, got %v", copies)
	}
	data, _ := os.ReadFile(copies[0])
	if n := len(strings.Split(strings.TrimRight(string(data), "\n"), "\n")); n != 3 {
		t.Fatalf("copy has %d lines, want 3", n)
	}
	if !strings.Contains(got.Command, `--resume "`+filepath.ToSlash(copies[0])+`"`) {
		t.Fatalf("command %q does not resume the copy", got.Command)
	}
	if b, _ := os.ReadFile(src); len(strings.Split(strings.TrimRight(string(b), "\n"), "\n")) != 5 {
		t.Fatal("the source transcript changed")
	}
}

func TestForkCommandPrunesOldCopies(t *testing.T) {
	home := t.TempDir()
	old := filepath.Join(home, ".arc", "forks", "old")
	os.MkdirAll(old, 0o755)
	past := time.Now().Add(-25 * time.Hour)
	os.Chtimes(old, past, past)
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	os.WriteFile(src, []byte(strings.Join(forkLinesIn(t.TempDir()), "\n")+"\n"), 0o644)
	if _, err := ForkCommand(src, "a1", "through", home); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("a copy older than a day was kept")
	}
}

func TestForkCommandHomeKeepsAskSettings(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	line := `{"type":"user","uuid":"u1","cwd":` + strconv.Quote(home) + `,"message":{"content":"hi"}}`
	os.WriteFile(src, []byte(line+"\n"), 0o644)
	got, err := ForkCommand(src, "", "", home)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.Command, "--settings "+claudeAskSettingsArg) {
		t.Fatalf("a home session's fork lost the ask-only settings: %q", got.Command)
	}
}

// A session synced from a Mac names the Mac's folder for the turns it ran there; a fork cut among them starts in the
// folder the session ran in here, not the home folder the tab would fall back to.
func TestForkCwdSkipsAnotherMachinesFolder(t *testing.T) {
	here := t.TempDir()
	mac := forkLinesIn("/Users/someone/Workspaces/thesis")
	win := forkLinesIn(here)[1:]
	for i := range win {
		win[i] = strings.Replace(win[i], `"uuid":"`, `"uuid":"w`, 1)
	}
	all := append(append([]string{}, mac...), win...)
	cases := []struct {
		name string
		kept []string
	}{
		{"a cut among the Mac turns", mac[:3]},
		{"the whole session", all},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := forkCwd(c.kept, all, isDir)
			if err != nil {
				t.Fatal(err)
			}
			if got != here {
				t.Fatalf("cwd %q, want %q", got, here)
			}
		})
	}
}

func TestForkCwdPrefersTheKeptPartsFolder(t *testing.T) {
	early, late := t.TempDir(), t.TempDir()
	kept := forkLinesIn(early)
	all := append(append([]string{}, kept...), forkLinesIn(late)[1:]...)
	if got, _ := forkCwd(kept, all, isDir); got != early {
		t.Fatalf("cwd %q, want the kept part's %q", got, early)
	}
}

func TestForkCommandFailsWhenNoFolderIsHere(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	os.WriteFile(src, []byte(strings.Join(forkLinesIn("/Users/someone/gone"), "\n")+"\n"), 0o644)
	_, err := ForkCommand(src, "u2", "before", home)
	if err == nil || !strings.Contains(err.Error(), "/Users/someone/gone") {
		t.Fatalf("want an error naming the missing folder, got %v", err)
	}
	if entries, _ := os.ReadDir(filepath.Join(home, ".arc", "forks")); len(entries) != 0 {
		t.Fatalf("a refused fork wrote %d copies", len(entries))
	}
}
