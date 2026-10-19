// R5 regression: a ctx-cancelled consult must not abandon its reaper while a
// descendant holds the stderr pipe. consult.runPipe sends stderr to an owned
// capped file (no os/exec copy goroutine), so Wait returns as soon as the direct
// child dies and nothing stays blocked on descendant-held EOF.

package consult

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

const reaperHelperSrc = `package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"
)

func main() {
	switch os.Args[1] {
	case "parent":
		// spawn a grandchild that inherits our std handles, then exit.
		child := exec.Command(os.Args[0], "hold", os.Args[2])
		child.Stdout = os.Stdout
		child.Stderr = os.Stderr
		if err := child.Start(); err != nil {
			fmt.Fprintf(os.Stderr, "spawn failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("GRANDCHILD %d\n", child.Process.Pid)
		os.Exit(0)
	case "hold":
		hold, _ := strconv.Atoi(os.Args[2])
		fmt.Fprintf(os.Stderr, "HOLDING %d for %dms\n", os.Getpid(), hold)
		time.Sleep(time.Duration(hold) * time.Millisecond)
	case "errtext":
		fmt.Fprintln(os.Stderr, "CONSULT_STDERR_MARKER_XYZZY prefix noise")
		os.Exit(1)
	}
}
`

func buildReaperHelper(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	src := filepath.Join(dir, "main.go")
	if err := os.WriteFile(src, []byte(reaperHelperSrc), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(dir, "helper.exe")
	out, err := exec.Command("go", "build", "-o", bin, src).CombinedOutput()
	if err != nil {
		t.Fatalf("build helper: %v\n%s", err, out)
	}
	return bin
}

func settledGoroutines(settle time.Duration) int64 {
	runtime.GC()
	time.Sleep(settle)
	return int64(runtime.NumGoroutine())
}

// TestRunPipe_cancelLeaksNoReaper: cancel a consult whose grandchild retains
// stderr; the Wait/copy machinery must not stay blocked (and must not accumulate
// across repeated cancellations) while the grandchild lives.
func TestRunPipe_cancelLeaksNoReaper(t *testing.T) {
	bin := buildReaperHelper(t)
	cwd := t.TempDir()
	baseline := settledGoroutines(600 * time.Millisecond)

	for i := 0; i < 2; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		ready := make(chan struct{}, 1)
		done := make(chan error, 1)
		go func() {
			_, err := Run(ctx, RuntimeSpec{Bin: bin, BaseArgs: []string{"parent", "3500"}}, cwd, "probe", func(chunk string) {
				if strings.Contains(chunk, "GRANDCHILD") {
					select {
					case ready <- struct{}{}:
					default:
					}
				}
			})
			done <- err
		}()
		select {
		case <-ready:
		case <-time.After(10 * time.Second):
			t.Fatalf("run %d: grandchild never spawned", i)
		}
		cancel()
		select {
		case err := <-done:
			if err == nil {
				t.Fatalf("run %d: expected a cancel error", i)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("run %d: consult did not return after cancel", i)
		}
		time.Sleep(500 * time.Millisecond)
		if leak := settledGoroutines(300*time.Millisecond) - baseline; leak >= 2 {
			t.Fatalf("run %d: %d goroutines retained while descendant holds stderr (reaper leaked)", i, leak)
		}
	}
	// wait out the descendant's hold; nothing should linger either way
	time.Sleep(5 * time.Second)
	if leak := settledGoroutines(400*time.Millisecond) - baseline; leak < 0 || leak > 1 {
		t.Fatalf("goroutines after descendant exit: %d above baseline, want ~0", leak)
	}
}

// TestRunPipe_cancelEndsReadOfHeldStdout: a grandchild that holds stdout far past the cancel must not keep
// the read loop waiting for an EOF that only its exit would bring.
func TestRunPipe_cancelEndsReadOfHeldStdout(t *testing.T) {
	bin := buildReaperHelper(t)
	cwd := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pidRe := regexp.MustCompile(`GRANDCHILD (\d+)`)
	pids := make(chan int, 1)
	t.Cleanup(func() {
		select {
		case pid := <-pids:
			if p, err := os.FindProcess(pid); err == nil {
				p.Kill()
			}
		default:
		}
	})
	done := make(chan error, 1)
	go func() {
		var out strings.Builder
		_, err := Run(ctx, RuntimeSpec{Bin: bin, BaseArgs: []string{"parent", "60000"}}, cwd, "probe", func(chunk string) {
			out.WriteString(chunk)
			if m := pidRe.FindStringSubmatch(out.String()); m != nil {
				pid, _ := strconv.Atoi(m[1])
				select {
				case pids <- pid:
				default:
				}
			}
		})
		done <- err
	}()
	var pid int
	select {
	case pid = <-pids:
		pids <- pid
	case <-time.After(10 * time.Second):
		t.Fatal("grandchild never spawned")
	}
	cancel()
	// the parent exits at once, so whether Wait or the cancel answers first decides the error; only the return counts
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("consult did not return after cancel while the grandchild holds stdout")
	}
}

// TestRunPipe_stderrTextSurfacesInError: a failing child's stderr must still
// reach the returned error now that it is captured via a file.
func TestRunPipe_stderrTextSurfacesInError(t *testing.T) {
	bin := buildReaperHelper(t)
	cwd := t.TempDir()
	_, err := Run(context.Background(), RuntimeSpec{Bin: bin, BaseArgs: []string{"errtext"}}, cwd, "probe", func(string) {})
	if err == nil {
		t.Fatalf("expected a non-zero-exit error")
	}
	if !strings.Contains(err.Error(), "CONSULT_STDERR_MARKER_XYZZY") {
		t.Fatalf("error %q does not carry the child's stderr text", err.Error())
	}
}
