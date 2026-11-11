package shellcomplete

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestCompleteFilesMarksFolders(t *testing.T) {
	bash := bashPath()
	if bash == "" {
		t.Skip("no bash")
	}
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "chatpanes"), 0o755)
	os.WriteFile(filepath.Join(dir, "chatpane.tsx"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, "other.ts"), nil, 0o644)
	got, err := Complete(context.Background(), dir, KindFile, "chatp")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "chatpane.tsx|chatpanes/" {
		t.Fatalf("got %q", got)
	}
}

func TestCompleteVariablesAndCommands(t *testing.T) {
	if bashPath() == "" {
		t.Skip("no bash")
	}
	got, _ := Complete(context.Background(), t.TempDir(), KindVariable, "PAT")
	if !slices.Contains(got, "PATH") {
		t.Fatalf("variables: %q", got)
	}
	got, _ = Complete(context.Background(), t.TempDir(), KindCommand, "ech")
	if !slices.Contains(got, "echo") {
		t.Fatalf("commands: %q", got)
	}
}

func TestCompleteTakesTheWordAsAnArgumentNotAsScript(t *testing.T) {
	if bashPath() == "" {
		t.Skip("no bash")
	}
	dir := t.TempDir()
	got, err := Complete(context.Background(), dir, KindFile, `"; touch pwned; echo "`)
	if err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "pwned")); statErr == nil || len(got) != 0 {
		t.Fatalf("the word ran as script: %q", got)
	}
}

func TestCompleteCapsTheAnswerAndRejectsAnUnknownKind(t *testing.T) {
	if bashPath() == "" {
		t.Skip("no bash")
	}
	dir := t.TempDir()
	for i := range MaxItems + 20 {
		os.WriteFile(filepath.Join(dir, "f"+strings.Repeat("a", i+1)), nil, 0o644)
	}
	got, err := Complete(context.Background(), dir, KindFile, "f")
	if err != nil || len(got) != MaxItems {
		t.Fatalf("got %d items, %v", len(got), err)
	}
	if _, err := Complete(context.Background(), dir, Kind("bogus"), "f"); err == nil {
		t.Fatal("an unknown kind must be an error")
	}
}
