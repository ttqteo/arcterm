// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import (
	"os"
	"strings"

	"github.com/shirou/gopsutil/v4/process"
)

// A Claude Code session can run inside the Claude daemon rather than in the terminal that shows it: the
// daemon starts `claude --bg-pty-host <pipe>-pty-<key> ... -- claude --session-id ...`, and a terminal shows
// that session by running `claude attach <key>`. The daemon keeps the environment of whichever terminal first
// started it, so a hosted session's WAVETERM_BLOCKID names that terminal, not the one attached to it. Its
// hooks reported into the wrong tab: a tab read "working" for a session it no longer ran, and the tab the user
// was talking in read nothing.

const (
	ptyHostFlag   = "--bg-pty-host"
	ptyPipeMarker = "-pty-"
	attachVerb    = "attach"
	maxAncestors  = 8
)

// PtyHostKey returns the session key of a daemon pty host's command line (the suffix of its pipe name after
// "-pty-"), or "" when the command line is not a pty host.
func PtyHostKey(cmdline string) string {
	fields := strings.Fields(cmdline)
	for i, f := range fields {
		if f != ptyHostFlag || i+1 >= len(fields) {
			continue
		}
		pipe := strings.Trim(fields[i+1], `"`)
		at := strings.LastIndex(pipe, ptyPipeMarker)
		if at < 0 {
			return ""
		}
		return pipe[at+len(ptyPipeMarker):]
	}
	return ""
}

// AttachKey returns the session key a `claude attach <key>` command line attaches to, or "".
func AttachKey(cmdline string) string {
	fields := strings.Fields(cmdline)
	// fields[0] is the binary; the verb follows it. A path with spaces splits into more fields, so the verb is
	// looked for rather than assumed at index 1, but never as the binary itself.
	for i := 1; i+1 < len(fields); i++ {
		if fields[i] == attachVerb {
			return strings.Trim(fields[i+1], `"`)
		}
	}
	return ""
}

// AttachedBlock picks the block of the terminal attached to the session `key`: the newest attach client
// carrying a block, since a session reattached in a second tab is shown there now. "" when none is attached.
func AttachedBlock(procs []ProcInfo, key string) string {
	if key == "" {
		return ""
	}
	best := ProcInfo{}
	for _, p := range procs {
		if p.BlockID == "" || AttachKey(p.Cmdline) != key {
			continue
		}
		if best.BlockID == "" || p.CreateMs > best.CreateMs {
			best = p
		}
	}
	return best.BlockID
}

// hostKey walks up from the calling process to its nearest claude ancestor (the session the hook runs for)
// and returns that session's daemon key, or "" when the session runs directly in a terminal.
func hostKey() string {
	pid := int32(os.Getppid())
	for range maxAncestors {
		p, err := process.NewProcess(pid)
		if err != nil {
			return ""
		}
		if name, _ := p.Name(); isClaudeProc(name) {
			parent, err := p.Parent()
			if err != nil {
				return ""
			}
			cmdline, _ := parent.Cmdline()
			return PtyHostKey(cmdline)
		}
		ppid, err := p.Ppid()
		if err != nil || ppid <= 0 || ppid == pid {
			return ""
		}
		pid = ppid
	}
	return ""
}

// HostedDisplayBlock reports whether the calling hook runs for a daemon-hosted Claude session and, if so, the
// bare block id of the terminal attached to it ("" when no terminal is attached). A session that runs directly
// in a terminal returns hosted=false and keeps its own WAVETERM_BLOCKID. The process table is read for a hosted
// session alone, so a direct session pays only for the ancestor walk.
func HostedDisplayBlock() (blockID string, hosted bool) {
	key := hostKey()
	if key == "" {
		return "", false
	}
	return AttachedBlock(attachClients(key), key), true
}

// attachClients lists the claude processes attached to `key`. Unlike EnumerateAgents it reads the environment of
// those alone, since this runs inside a hook on every tool call.
func attachClients(key string) []ProcInfo {
	procs, err := process.Processes()
	if err != nil {
		return nil
	}
	var out []ProcInfo
	for _, p := range procs {
		if name, err := p.Name(); err != nil || !isClaudeProc(name) {
			continue
		}
		cmdline, _ := p.Cmdline()
		if AttachKey(cmdline) != key {
			continue
		}
		environ, _ := p.Environ()
		createMs, _ := p.CreateTime()
		out = append(out, ProcInfo{Pid: p.Pid, BlockID: blockIDFromEnv(environ), CreateMs: createMs, Cmdline: cmdline})
	}
	return out
}
