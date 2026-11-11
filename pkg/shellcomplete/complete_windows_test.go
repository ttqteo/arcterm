//go:build windows

package shellcomplete

import (
	"context"
	"os"
	"slices"
	"testing"
)

// A Windows PATH can list System32 before Git's usr\bin, so `sort` there is Windows' sort.exe, which has no -u.
// Complete must answer with nothing but bash's own builtins.
func TestCompleteCommandsWithSystem32FirstOnPath(t *testing.T) {
	if bashPath() == "" {
		t.Skip("no bash")
	}
	t.Setenv("PATH", os.Getenv("SystemRoot")+`\System32;`+os.Getenv("PATH"))
	got, err := Complete(context.Background(), t.TempDir(), KindCommand, "ech")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(got, "echo") {
		t.Fatalf("commands: %q", got)
	}
	got, err = Complete(context.Background(), t.TempDir(), KindVariable, "PAT")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(got, "PATH") {
		t.Fatalf("variables: %q", got)
	}
}
