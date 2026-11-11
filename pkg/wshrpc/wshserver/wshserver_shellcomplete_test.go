// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestBashHistoryCommandRefusesAnEmptyCwd(t *testing.T) {
	ws := &WshServer{}
	if _, err := ws.BashHistoryCommand(context.Background(), wshrpc.CommandBashHistoryData{}); err == nil {
		t.Fatal("an empty cwd was accepted")
	}
}

func TestBashHistoryCommandReadsTheFoldersBangCommands(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	folder := t.TempDir()
	lines := []string{
		`{"display":"!git status","project":` + jsonString(folder) + `}`,
		`{"display":"hello","project":` + jsonString(folder) + `}`,
		`{"display":"!ls -la","project":` + jsonString(folder) + `}`,
		`{"display":"!npm test","project":"/somewhere/else"}`,
	}
	if err := os.WriteFile(filepath.Join(cfg, "history.jsonl"), []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ws := &WshServer{}
	got, err := ws.BashHistoryCommand(context.Background(), wshrpc.CommandBashHistoryData{Cwd: folder})
	if err != nil {
		t.Fatal(err)
	}
	if want := "ls -la|git status"; strings.Join(got, "|") != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBashHistoryCommandWithNoHistoryIsAnEmptyListNotNull(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	ws := &WshServer{}
	got, err := ws.BashHistoryCommand(context.Background(), wshrpc.CommandBashHistoryData{Cwd: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("got %#v, want an empty non-nil list", got)
	}
}

func TestShellCompleteCommandRefusesAnEmptyCwd(t *testing.T) {
	ws := &WshServer{}
	if _, err := ws.ShellCompleteCommand(context.Background(), wshrpc.CommandShellCompleteData{Kind: "file", Word: "a"}); err == nil {
		t.Fatal("an empty cwd was accepted")
	}
}

func TestShellCompleteCommandRefusesACwdThatIsNotAFolder(t *testing.T) {
	ws := &WshServer{}
	dir := t.TempDir()
	file := filepath.Join(dir, "a-file")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for name, cwd := range map[string]string{"missing": filepath.Join(dir, "nope"), "a file": file} {
		if _, err := ws.ShellCompleteCommand(context.Background(), wshrpc.CommandShellCompleteData{Cwd: cwd, Kind: "file", Word: "a"}); err == nil {
			t.Fatalf("a cwd that is %s was accepted", name)
		}
	}
}

// jsonString quotes a path for a JSON fixture line (a Windows path holds backslashes).
func jsonString(s string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
}
