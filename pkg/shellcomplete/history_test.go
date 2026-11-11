package shellcomplete

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeHistory(t *testing.T, lines ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "history.jsonl")
	if err := os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestBashHistoryNewestFirstDistinctForTheFolder(t *testing.T) {
	p := writeHistory(t,
		`{"display":"!git status","project":"D:\\work\\app"}`,
		`{"display":"hello","project":"D:\\work\\app"}`,
		`{"display":"! ls -la ","project":"D:\\work\\app"}`,
		`{"display":"!npm test","project":"D:\\other"}`,
		`{"display":"!git status","project":"D:\\work\\app\\"}`,
		`{"display":"![Image #1] look","project":"D:\\work\\app"}`,
		`not json`,
	)
	got, err := BashHistory(p, `D:\work\app`, 50)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"git status", "ls -la"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBashHistoryFolderCaseFoldsOnWindowsOnly(t *testing.T) {
	p := writeHistory(t, `{"display":"!git status","project":"d:\\work\\app"}`)
	got, err := BashHistory(p, `D:\work\app`, 50)
	if err != nil {
		t.Fatal(err)
	}
	if want := runtime.GOOS == "windows"; (len(got) == 1) != want {
		t.Fatalf("on %s got %q, want a match: %v", runtime.GOOS, got, want)
	}
}

func TestBashHistoryCapsAndMissingFile(t *testing.T) {
	var lines []string
	for i := range 80 {
		lines = append(lines, `{"display":"!echo `+strings.Repeat("x", i+1)+`","project":"/p"}`)
	}
	got, _ := BashHistory(writeHistory(t, lines...), "/p", 50)
	if len(got) != 50 || got[0] != "echo "+strings.Repeat("x", 80) {
		t.Fatalf("got %d, first %q", len(got), got[0])
	}
	got, err := BashHistory(filepath.Join(t.TempDir(), "none.jsonl"), "/p", 50)
	if err != nil || len(got) != 0 {
		t.Fatalf("missing file: %v %v", got, err)
	}
}

// A file several chunks long: every line, including each one a chunk boundary cuts in two, comes back whole and in order.
func TestBashHistoryReadsAcrossChunkBoundaries(t *testing.T) {
	const n = 3000
	var lines []string
	for i := range n {
		// the multi-byte letters make a boundary fall inside a character sometimes
		lines = append(lines, fmt.Sprintf(`{"display":"!echo %d é%s","pastedContents":{},"project":"/p"}`, i, strings.Repeat("ü", i%40)))
	}
	p := writeHistory(t, lines...)
	if st, _ := os.Stat(p); st.Size() < 4*(64<<10) {
		t.Fatalf("the file holds only %d bytes: too short to cross chunks", st.Size())
	}
	got, err := BashHistory(p, "/p", n+10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != n {
		t.Fatalf("got %d commands, want %d", len(got), n)
	}
	for i, cmd := range got {
		j := n - 1 - i
		if want := fmt.Sprintf("echo %d é%s", j, strings.Repeat("ü", j%40)); cmd != want {
			t.Fatalf("entry %d: got %q, want %q", i, cmd, want)
		}
	}
	few, _ := BashHistory(p, "/p", 3)
	if len(few) != 3 || few[0] != got[0] || few[2] != got[2] {
		t.Fatalf("the newest 3: %q", few)
	}
}

func TestBashHistoryHonoursClaudeConfigDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	p, err := HistoryPath()
	if err != nil || p != filepath.Join(dir, "history.jsonl") {
		t.Fatalf("got %q, %v", p, err)
	}
}
