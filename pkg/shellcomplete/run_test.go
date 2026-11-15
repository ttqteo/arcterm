package shellcomplete

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runOrSkip(t *testing.T, cwd, command string, timeout time.Duration) RunResult {
	t.Helper()
	if runShell() == "" {
		t.Skip("no shell")
	}
	res, err := Run(context.Background(), cwd, command, timeout)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestRunReadsBothStreamsAndTheExitCode(t *testing.T) {
	res := runOrSkip(t, t.TempDir(), "echo out; echo err >&2; exit 3", 0)
	if strings.TrimSpace(res.Stdout) != "out" || strings.TrimSpace(res.Stderr) != "err" || res.ExitCode != 3 {
		t.Fatalf("got %+v", res)
	}
	if res.TimedOut || res.Truncated {
		t.Fatalf("got %+v", res)
	}
}

func TestRunRunsInTheFolder(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "marker.txt"), nil, 0o644)
	res := runOrSkip(t, dir, "ls", 0)
	if !strings.Contains(res.Stdout, "marker.txt") || res.ExitCode != 0 {
		t.Fatalf("got %+v", res)
	}
}

func TestRunStopsACommandAtTheTimeout(t *testing.T) {
	start := time.Now()
	res := runOrSkip(t, t.TempDir(), "echo before; sleep 30", 500*time.Millisecond)
	if !res.TimedOut || res.ExitCode != -1 {
		t.Fatalf("got %+v", res)
	}
	if time.Since(start) > 10*time.Second {
		t.Fatalf("took %v", time.Since(start))
	}
}

func TestRunKeepsTheTailOfALongOutput(t *testing.T) {
	res := runOrSkip(t, t.TempDir(), "i=0; while [ $i -lt 20000 ]; do echo line$i; i=$((i+1)); done", 0)
	if !res.Truncated || !strings.HasPrefix(res.Stdout, CutMark) || !strings.HasSuffix(res.Stdout, "line19999\n") {
		t.Fatalf("truncated=%v head=%q", res.Truncated, res.Stdout[:40])
	}
	if len(res.Stdout) > MaxRunOutput+len(CutMark) {
		t.Fatalf("kept %d bytes", len(res.Stdout))
	}
}

func TestTailBufferStartsAtAWholeCharacter(t *testing.T) {
	var b tailBuffer
	b.Write([]byte(strings.Repeat("é", MaxRunOutput)))
	got, cut := b.text()
	if !cut || !strings.HasPrefix(got, CutMark+"é") {
		t.Fatalf("cut=%v head=%q", cut, got[:len(CutMark)+4])
	}
}
