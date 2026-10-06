// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import "testing"

// command lines as Claude Code 2.1.291 writes them on Windows (observed)
const (
	ptyHostCmd = `C:\Users\u\.local\bin\claude.exe --bg-pty-host \\.\pipe\cc-daemon-f90c9f087339555f-pty-61c3c450 160 48 -- C:\Users\u\.local\bin\claude.exe --session-id 61c3c450-f238-436c-b37e-c3714b16a118 --fork-session --resume x.jsonl`
	attachCmd  = `C:\Users\u\.local\bin\claude.exe attach 61c3c450`
)

func TestPtyHostKey(t *testing.T) {
	if got := PtyHostKey(ptyHostCmd); got != "61c3c450" {
		t.Fatalf("PtyHostKey = %q, want 61c3c450", got)
	}
	for _, cmd := range []string{
		`"C:\Users\u\.local\bin\claude.exe" --resume 61c3c450-f238`,
		`C:\Users\u\.local\bin\claude.exe daemon run --origin transient`,
		`claude.exe --bg-pty-host`,
		`claude.exe --bg-pty-host \\.\pipe\no-key-here 160 48`,
	} {
		if got := PtyHostKey(cmd); got != "" {
			t.Errorf("PtyHostKey(%q) = %q, want empty", cmd, got)
		}
	}
}

func TestAttachKey(t *testing.T) {
	if got := AttachKey(attachCmd); got != "61c3c450" {
		t.Fatalf("AttachKey = %q, want 61c3c450", got)
	}
	if got := AttachKey(`"C:\Program Files\claude\claude.exe" attach "61c3c450"`); got != "61c3c450" {
		t.Errorf("a quoted path with spaces: AttachKey = %q", got)
	}
	for _, cmd := range []string{`attach 61c3c450`, `claude.exe --resume 61c3c450`, `claude.exe attach`} {
		if got := AttachKey(cmd); got != "" {
			t.Errorf("AttachKey(%q) = %q, want empty", cmd, got)
		}
	}
}

func TestAttachedBlock(t *testing.T) {
	procs := []ProcInfo{
		{Pid: 1, BlockID: "old-tab", Cmdline: ptyHostCmd, CreateMs: 50},                  // the daemon's own env: not a viewer
		{Pid: 2, BlockID: "first-view", Cmdline: attachCmd, CreateMs: 100},               // attached first
		{Pid: 3, BlockID: "second-view", Cmdline: attachCmd, CreateMs: 200},              // reattached later: it wins
		{Pid: 4, BlockID: "", Cmdline: attachCmd, CreateMs: 300},                         // outside Arc
		{Pid: 5, BlockID: "other", Cmdline: `claude.exe attach 8b5bd349`, CreateMs: 400}, // another session
	}
	if got := AttachedBlock(procs, "61c3c450"); got != "second-view" {
		t.Fatalf("AttachedBlock = %q, want second-view", got)
	}
	if got := AttachedBlock(procs, "deadbeef"); got != "" {
		t.Errorf("no viewer: AttachedBlock = %q, want empty", got)
	}
	if got := AttachedBlock(procs, ""); got != "" {
		t.Errorf("empty key: AttachedBlock = %q, want empty", got)
	}
}
