// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"encoding/binary"
	"log"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// A closed block's processes end with its pty's hangup, all but the ones that left its session: a daemon (codex's
// app-server), a `nohup` server, a detached child. They still carry the block's WAVETERM_BLOCKID, so a close finds
// them by it. macOS shows no one the environment of its own platform binaries (/bin/sleep, ssh), so one of those stays.
// Windows needs none of this: the block's job object takes its whole tree.

// leftoverKeep are servers built to outlive the terminal that started them and shared by every terminal since
var leftoverKeep = map[string]bool{"tmux": true, "screen": true, "zellij": true}

// how long a leftover has after SIGTERM before SIGKILL, and how often the wait looks. Vars so tests shorten them.
var (
	leftoverStopWait = 2 * time.Second
	leftoverPoll     = 100 * time.Millisecond
)

// stopLeftovers ends every process of this user that still carries blockId once the block is closed.
func stopLeftovers(blockId string) {
	pids := blockLeftovers(blockId)
	if len(pids) == 0 {
		return
	}
	for _, pid := range pids {
		_ = syscall.Kill(pid, syscall.SIGTERM)
	}
	left := pids
	deadline := time.Now().Add(leftoverStopWait)
	for {
		left = pidsAlive(left)
		if len(left) == 0 || !time.Now().Before(deadline) {
			break
		}
		time.Sleep(leftoverPoll)
	}
	for _, pid := range left {
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
	log.Printf("[blockclose] %s: stopped %d leftover processes %v (%d killed)\n", blockId, len(pids), pids, len(left))
}

// blockLeftovers is the pids of this user's processes whose environment carries blockId, never wavesrv or its host
func blockLeftovers(blockId string) []int {
	procs, err := unix.SysctlKinfoProcSlice("kern.proc.uid", os.Getuid())
	if err != nil {
		log.Printf("[blockclose] %s: listing processes: %v\n", blockId, err)
		return nil
	}
	want := "WAVETERM_BLOCKID=" + blockId
	self, host := os.Getpid(), os.Getppid()
	var out []int
	for _, kp := range procs {
		pid := int(kp.Proc.P_pid)
		if pid <= 1 || pid == self || pid == host {
			continue
		}
		// a process that exited since the listing, or one this user may not read, has no args to give
		buf, err := unix.SysctlRaw("kern.procargs2", pid)
		if err != nil {
			continue
		}
		exe, env := procArgsEnv(buf)
		if leftoverKeep[filepath.Base(exe)] {
			continue
		}
		for _, kv := range env {
			if kv == want {
				out = append(out, pid)
				break
			}
		}
	}
	return out
}

// procArgsEnv reads kern.procargs2: argc, the exec path, its padding nulls, argc args, then the environment up to
// an empty string.
func procArgsEnv(buf []byte) (exe string, env []string) {
	if len(buf) < 4 {
		return "", nil
	}
	argc := int(binary.LittleEndian.Uint32(buf[:4]))
	rest := buf[4:]
	i := bytes.IndexByte(rest, 0)
	if i < 0 {
		return string(rest), nil
	}
	exe = string(rest[:i])
	rest = rest[i:]
	for len(rest) > 0 && rest[0] == 0 {
		rest = rest[1:]
	}
	for n := 0; n < argc; n++ {
		i := bytes.IndexByte(rest, 0)
		if i < 0 {
			return exe, nil
		}
		rest = rest[i+1:]
	}
	for {
		i := bytes.IndexByte(rest, 0)
		if i <= 0 {
			return exe, env
		}
		env = append(env, string(rest[:i]))
		rest = rest[i+1:]
	}
}

func pidsAlive(pids []int) []int {
	var live []int
	for _, pid := range pids {
		if syscall.Kill(pid, 0) == nil {
			live = append(live, pid)
		}
	}
	return live
}
