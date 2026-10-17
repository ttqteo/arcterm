// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestProcArgsEnv(t *testing.T) {
	buf := binary.LittleEndian.AppendUint32(nil, 3)
	buf = append(buf, "/bin/foo\x00\x00\x00\x00foo\x00\x00-x\x00A=1\x00WAVETERM_BLOCKID=b1\x00\x00ptr_munge=\x00"...)
	exe, env := procArgsEnv(buf)
	if exe != "/bin/foo" {
		t.Errorf("exe = %q, want /bin/foo", exe)
	}
	if want := []string{"A=1", "WAVETERM_BLOCKID=b1"}; !slices.Equal(env, want) {
		t.Errorf("env = %q, want %q", env, want)
	}
	if exe, env := procArgsEnv([]byte{1, 0}); exe != "" || env != nil {
		t.Errorf("a short buffer gave %q %q", exe, env)
	}
}

// detached starts exe, a copy of this test binary that only waits (TestMain), through a shell that exits at once: it
// ends up as launchd's child in a session of its own, as a daemon a block left behind does. Not /bin/sleep: macOS
// shows no one the environment of its own platform binaries.
func detached(t *testing.T, blockId, exe string) int {
	t.Helper()
	cmd := exec.Command("/bin/sh", "-c", `"$0" >/dev/null 2>&1 & echo $!`, exe)
	cmd.Env = append(os.Environ(), "WAVETERM_BLOCKID="+blockId, "ARC_TEST_LEFTOVER=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = syscall.Kill(pid, syscall.SIGKILL) })
	return pid
}

func TestStopLeftovers(t *testing.T) {
	blockId := uuid.NewString()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	tmux := filepath.Join(t.TempDir(), "tmux")
	if err := os.WriteFile(tmux, bin, 0o755); err != nil {
		t.Fatal(err)
	}
	daemon := detached(t, blockId, self)
	kept := detached(t, blockId, tmux)
	other := detached(t, uuid.NewString(), self)
	// the shell has handed over once it prints the pid, but the stand-in may not have exec'd yet
	time.Sleep(200 * time.Millisecond)

	found := blockLeftovers(blockId)
	if !slices.Contains(found, daemon) {
		t.Errorf("leftovers %v miss the detached daemon %d", found, daemon)
	}
	if slices.Contains(found, kept) || slices.Contains(found, other) {
		t.Errorf("leftovers %v hold tmux %d or another block's process %d", found, kept, other)
	}

	stopLeftovers(blockId)
	if live := pidsAlive([]int{daemon}); len(live) > 0 {
		t.Errorf("daemon %d still runs after the close", daemon)
	}
	if live := pidsAlive([]int{kept, other}); len(live) != 2 {
		t.Errorf("the close stopped tmux or another block's process: alive %v of %v", live, []int{kept, other})
	}
}
