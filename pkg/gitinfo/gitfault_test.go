// pkg/gitinfo/gitfault_test.go
package gitinfo

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

// The test binary doubles as a fake git: copied to PATH as git, with fakeGitHangEnv set, it hangs on the one
// argument that env names and otherwise answers as a repo on branch main, so a test can time out one chosen
// git call.
const fakeGitHangEnv = "GITINFO_FAKE_GIT_HANG"

func TestMain(m *testing.M) {
	if hang := os.Getenv(fakeGitHangEnv); hang != "" {
		runFakeGit(hang, os.Args[1:])
	}
	os.Exit(m.Run())
}

func runFakeGit(hang string, args []string) {
	if slices.Contains(args, hang) {
		time.Sleep(time.Minute)
	}
	if slices.Contains(args, "--abbrev-ref") && slices.Contains(args, "HEAD") {
		fmt.Println("main")
	}
	os.Exit(0)
}

// useHangingGit puts a copy of the test binary first on PATH as git, run as the fake above.
func useHangingGit(t *testing.T, hang string) {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	name := "git"
	if runtime.GOOS == "windows" {
		name = "git.exe"
	}
	src, err := os.Open(self)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	dst, err := os.OpenFile(filepath.Join(bin, name), os.O_CREATE|os.O_WRONLY, 0o755)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		t.Fatal(err)
	}
	if err := dst.Close(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv(fakeGitHangEnv, hang)
}

// hangDeadline outlives the fake's quick answers and cuts the hanging call short.
const hangDeadline = 2 * time.Second

// wantTimedOutRead checks a sync result that read git's state and got no answer: the failure names that read, and
// is neither "detached" nor "no upstream". Push and Pull stop at the read, so the failure command also shows that
// no `push -u origin` ran.
func wantTimedOutRead(t *testing.T, got *SyncResult, err error, read string) {
	t.Helper()
	if err != nil || got == nil || got.Failure == nil {
		t.Fatalf("want the timed-out read as a Failure, got %+v, %v", got, err)
	}
	if !strings.HasPrefix(got.Failure.Command, "git "+read) {
		t.Errorf("failure names %q, want the read %q that timed out", got.Failure.Command, read)
	}
	for _, wrong := range []string{"detached", "no upstream"} {
		if strings.Contains(got.Failure.Stderr, wrong) {
			t.Errorf("failure %q reads a timeout as %q", got.Failure.Stderr, wrong)
		}
	}
}

// A git killed at its deadline exits 1 on Windows, the same code as "no such ref": a timed-out branch read must
// not read as a detached HEAD.
func TestPushTimedOutBranchReadIsAnError(t *testing.T) {
	useHangingGit(t, "HEAD")
	ctx, cancel := context.WithTimeout(context.Background(), hangDeadline)
	defer cancel()
	got, err := Push(ctx, t.TempDir())
	wantTimedOutRead(t, got, err, "rev-parse --abbrev-ref HEAD")
}

// ... and a timed-out upstream read is no reason to publish the branch with `push -u origin`.
func TestPushTimedOutUpstreamReadIsAnError(t *testing.T) {
	useHangingGit(t, "@{u}")
	ctx, cancel := context.WithTimeout(context.Background(), hangDeadline)
	defer cancel()
	got, err := Push(ctx, t.TempDir())
	wantTimedOutRead(t, got, err, "rev-parse --abbrev-ref --symbolic-full-name @{u}")
}

func TestPullTimedOutUpstreamReadIsAnError(t *testing.T) {
	useHangingGit(t, "@{u}")
	ctx, cancel := context.WithTimeout(context.Background(), hangDeadline)
	defer cancel()
	got, err := Pull(ctx, t.TempDir())
	wantTimedOutRead(t, got, err, "rev-parse --abbrev-ref --symbolic-full-name @{u}")
}

// A branch with no upstream is a real exit status, not a fault: upstreamCounts answers an empty upstream and no
// error, and Push still publishes the branch with -u.
func TestUpstreamCountsNoUpstreamIsNotAnError(t *testing.T) {
	a, _ := twoClones(t)
	git(t, a, "checkout", "-q", "-b", "feature")
	git(t, a, "commit", "-q", "--allow-empty", "-m", "feature work")
	up, ahead, behind, err := upstreamCounts(context.Background(), a)
	if err != nil || up != "" || ahead != 0 || behind != 0 {
		t.Fatalf("upstreamCounts = %q +%d -%d, %v; want no upstream and no error", up, ahead, behind, err)
	}
	r, err := Push(context.Background(), a)
	if err != nil || r.Failure != nil {
		t.Fatalf("publish: %v %+v", err, r)
	}
	if got := gitOutT(t, a, "rev-parse", "--abbrev-ref", "@{u}"); got != "origin/feature" {
		t.Fatalf("upstream after push = %q, want origin/feature", got)
	}
}
