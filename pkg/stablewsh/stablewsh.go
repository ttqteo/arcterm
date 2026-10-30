// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package stablewsh keeps the wsh every agent integration names: a fixed, versionless copy under ~/.arc/bin.
// `wsh install-agent-hooks` writes it at each launch; wavesrv's watch replaces it on a Mac when macOS stops running it.
//
// macOS can flag one file's code signature as invalid and SIGKILL every exec of it while its bytes and signature on
// disk stay valid (kernel log: `load code signature error 2`). The flag follows the file, not its bytes: a renamed
// copy stays killed, a new one runs. It has struck a copy minutes after it was written, mid-session, and from then on
// every hook failed until arcterm was opened again, so a check at launch alone is not enough.
package stablewsh

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// Interval is how often the watch test-runs the copy: a hook that finds it killed fails until the next tick
const Interval = 10 * time.Second

// Path is the copy under home. The running binary is the wrong target for the integrations: its name carries the
// version, and a rebuild, an app update, `task clean` or a worktree removal deletes it while every hook still names it.
func Path(home string) string {
	name := "wsh"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(home, ".arc", "bin", name)
}

// Sync makes dst a byte-identical copy of src and leaves an identical copy that runs untouched.
func Sync(src, dst string) error {
	if src == dst {
		return nil
	}
	want, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("reading %s: %w", src, err)
	}
	if cur, err := os.ReadFile(dst); err == nil && bytes.Equal(cur, want) && Runs(dst) {
		return nil
	}
	return replace(want, dst)
}

// Heal replaces dst with a new copy of src when dst no longer runs, and reports whether it did. A missing dst is left
// alone: install-agent-hooks writes the first copy, and one the person deleted stays deleted.
func Heal(src, dst string) (bool, error) {
	if src == dst {
		return false, nil
	}
	if _, err := os.Stat(dst); err != nil || Runs(dst) {
		return false, nil
	}
	want, err := os.ReadFile(src)
	if err != nil {
		return false, fmt.Errorf("reading %s: %w", src, err)
	}
	if err := replace(want, dst); err != nil {
		return false, err
	}
	return true, nil
}

// StartWatch heals dst from src every Interval, on a Mac only: elsewhere no copy is killed this way, and the watch
// would only spawn processes.
func StartWatch(ctx context.Context, src, dst string) {
	if runtime.GOOS != "darwin" {
		return
	}
	go func() {
		defer func() { panichandler.PanicHandler("stablewsh:watch", recover()) }()
		ticker := time.NewTicker(Interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			healed, err := Heal(src, dst)
			if err != nil {
				log.Printf("stablewsh: %s no longer runs and could not be replaced: %v\n", dst, err)
			} else if healed {
				log.Printf("stablewsh: %s was killed on exec; replaced it with a new copy of %s\n", dst, src)
			}
		}
	}()
}

// replace writes want to a new file and renames it over dst. The previous copy is renamed aside rather than
// overwritten because Windows refuses to overwrite an exe a running hook is executing, but allows renaming it; on a Mac
// only a new file clears a flagged signature.
func replace(want []byte, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(dst), err)
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, want, 0o755); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	old := asideName(dst)
	if _, err := os.Stat(dst); err == nil {
		if err := os.Rename(dst, old); err != nil {
			return fmt.Errorf("moving aside %s: %w", dst, err)
		}
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Rename(old, dst) // restore the previous copy so the hooks keep a binary to run
		return fmt.Errorf("replacing %s: %w", dst, err)
	}
	_ = os.Remove(old) // fails only while the previous copy is still executing; the next sync retries
	return nil
}

// Runs reports whether the copy at path still runs: an identical copy is not proof enough on a Mac (see the package
// comment). Anything short of a kill (a timeout, a file that is not a binary) counts as running, so a slow machine never
// churns the copy. Elsewhere there is no such flag, and no reason to spawn a process.
var Runs = func(path string) bool {
	if runtime.GOOS != "darwin" {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := exec.CommandContext(ctx, path, "version").Run()
	var exitErr *exec.ExitError
	if ctx.Err() != nil || !errors.As(err, &exitErr) {
		return true
	}
	status, ok := exitErr.Sys().(syscall.WaitStatus)
	return !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL
}

// asideName removes the copies earlier swaps moved aside and returns a free name to move dst to: dst.old, or dst.old.N
// while an earlier copy is still executing, which Windows will neither delete nor let a rename replace. A long-lived
// `wsh agentctl` holds one for days, and reusing its name failed every swap until it exited.
func asideName(dst string) string {
	base := filepath.Base(dst) + ".old"
	if entries, err := os.ReadDir(filepath.Dir(dst)); err == nil {
		for _, e := range entries {
			if name := e.Name(); name == base || strings.HasPrefix(name, base+".") {
				_ = os.Remove(filepath.Join(filepath.Dir(dst), name))
			}
		}
	}
	for i := 0; ; i++ {
		name := dst + ".old"
		if i > 0 {
			name = fmt.Sprintf("%s.old.%d", dst, i)
		}
		if _, err := os.Lstat(name); os.IsNotExist(err) {
			return name
		}
	}
}
