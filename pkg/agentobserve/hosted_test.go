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
		{Pid: 4, BlockID: "", Cmdline: attachCmd, CreateMs: 300},                         // outside arcterm
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

// command lines of the 2026-10-07 case: a terminal TUI (`--resume b587863b-...`, in block 94ba3e7e) sent its own
// session to the background. The daemon now hosts a fork of it; no `claude attach` runs, and the TUI keeps
// displaying the fork. A second hosted fork (1903f81a) has no terminal showing its source.
const (
	srcB587      = "b587863b-930b-42cd-9760-84695fbcba9f"
	srcB587Path  = `C:\Users\dev\.claude\projects\D--work-arcterm\b587863b-930b-42cd-9760-84695fbcba9f.jsonl`
	hostedFork   = `C:\Users\dev\.local\bin\claude.exe --session-id e840f210-c01d-446f-8967-01271d3ef2d7 --fork-session --resume ` + srcB587Path + ` --plugin-dir C:\Users\dev\.arc\claude-mod --model opus --permission-mode auto`
	hostedPty    = `C:\Users\dev\.local\bin\claude.exe --bg-pty-host \.\pipe\cc-daemon-f90c9f087339555f-pty-e840f210 160 50 -- ` + hostedFork
	hostedOther  = `C:\Users\dev\.local\bin\claude.exe --session-id 1903f81a-1111-4222-8333-444455556666 --fork-session --resume C:\Users\dev\.claude\projects\p\228cb325-aaaa-4bbb-8ccc-ddddeeeeffff.jsonl --reply-on-resume`
	tuiResumeCmd = `C:\Users\dev\.local\bin\claude.exe --resume ` + srcB587
)

func TestForkSource(t *testing.T) {
	for _, tc := range []struct{ name, cmd, want string }{
		{"hosted child, path", hostedFork, srcB587},
		{"pty host line carries the nested hosted command", hostedPty, srcB587},
		{"hosted fork with --reply-on-resume", hostedOther, "228cb325-aaaa-4bbb-8ccc-ddddeeeeffff"},
		{"resume before fork flag", `claude.exe --resume ` + srcB587 + ` --fork-session`, srcB587},
		{"a bare id", `claude.exe --fork-session --resume ` + srcB587, srcB587},
		{"--resume=<id>", `claude.exe --fork-session --resume=` + srcB587, srcB587},
		{"--resume=<path>", `claude.exe --fork-session --resume=` + srcB587Path, srcB587},
		{"short flag", `claude.exe --fork-session -r ` + srcB587, srcB587},
		{"quoted path with spaces", `claude.exe --fork-session --resume "C:\Users\John Doe\.claude\projects\p\` + srcB587 + `.jsonl" --model opus`, srcB587},
		{"quoted --resume=<path> with spaces", `claude.exe --fork-session "--resume=C:\Users\John Doe\p\` + srcB587 + `.jsonl"`, srcB587},
		{"posix path", `/home/u/.local/bin/claude --fork-session --resume /home/u/.claude/projects/-p/` + srcB587 + `.jsonl`, srcB587},
		{"posix path with spaces, unquoted", `/Users/John Doe/.local/bin/claude --fork-session --resume /Users/John Doe/.claude/projects/-p/` + srcB587 + `.jsonl --model opus`, srcB587},
		{"forward slashes on windows", `claude.exe --fork-session --resume C:/Users/u/.claude/projects/p/` + srcB587 + `.jsonl`, srcB587},
		{"a fork flag with no resume", `claude.exe --session-id e840f210 --fork-session`, ""},
		{"bare --resume before another flag", `claude.exe --fork-session --resume --model opus`, ""},
		{"bare --resume at the end", `claude.exe --fork-session --resume`, ""},
		{"no fork flag", `claude.exe --resume ` + srcB587, ""},
		{"a terminal session", tuiResumeCmd, ""},
		{"empty", ``, ""},
	} {
		if got := ForkSource(tc.cmd); got != tc.want {
			t.Errorf("%s: ForkSource(%q) = %q, want %q", tc.name, tc.cmd, got, tc.want)
		}
	}
}

func TestSessionRef(t *testing.T) {
	for _, tc := range []struct{ name, cmd, want string }{
		{"resume id", tuiResumeCmd, srcB587},
		{"quoted binary", `"C:\Users\dev\.local\bin\claude.exe" --resume ` + srcB587, srcB587},
		{"--resume=<id>", `claude.exe --resume=` + srcB587, srcB587},
		{"resume path", `claude.exe --resume ` + srcB587Path, srcB587},
		{"--session-id", `claude.exe --session-id ` + srcB587, srcB587},
		{"--session-id=<id>", `claude.exe --session-id=` + srcB587, srcB587},
		{"short flag", `claude.exe -r ` + srcB587, srcB587},
		{"extra flags after", `claude.exe --resume ` + srcB587 + ` --model opus --permission-mode auto`, srcB587},
		{"extra flags before", `claude.exe --model opus --resume ` + srcB587, srcB587},
		{"the session it runs wins over the one it forked", hostedFork, "e840f210-c01d-446f-8967-01271d3ef2d7"},
		{"bare --resume", `claude.exe --resume`, ""},
		{"bare --resume before a flag", `claude.exe --resume --model opus`, ""},
		{"--continue", `claude.exe --continue`, ""},
		{"no flags", `claude.exe`, ""},
		{"pty host", hostedPty, ""},
		{"attach", attachCmd, ""},
		{"attach with a resume flag", `claude.exe attach 61c3c450 --resume ` + srcB587, ""},
		{"daemon", `claude.exe daemon run --origin transient`, ""},
		{"empty", ``, ""},
	} {
		if got := SessionRef(tc.cmd); got != tc.want {
			t.Errorf("%s: SessionRef(%q) = %q, want %q", tc.name, tc.cmd, got, tc.want)
		}
	}
}

func TestDisplayBlock(t *testing.T) {
	const key = "e840f210"
	daemonProcs := func() []ProcInfo {
		return []ProcInfo{
			{Pid: 1, BlockID: "old-tab", Cmdline: hostedPty, CreateMs: 500},     // the daemon's env: not a viewer, though it names the source
			{Pid: 2, BlockID: "old-tab", Cmdline: hostedFork, CreateMs: 510},    // the hosted session itself
			{Pid: 3, BlockID: "other-tab", Cmdline: hostedOther, CreateMs: 520}, // another hosted fork
		}
	}

	t.Run("the terminal that started the fork", func(t *testing.T) {
		procs := append(daemonProcs(), ProcInfo{Pid: 4, BlockID: "94ba3e7e", Cmdline: tuiResumeCmd, CreateMs: 100})
		if got := DisplayBlock(procs, key, srcB587); got != "94ba3e7e" {
			t.Fatalf("DisplayBlock = %q, want 94ba3e7e", got)
		}
	})
	t.Run("an attach client beats a newer fork-source terminal", func(t *testing.T) {
		procs := append(daemonProcs(),
			ProcInfo{Pid: 4, BlockID: "94ba3e7e", Cmdline: tuiResumeCmd, CreateMs: 900},
			ProcInfo{Pid: 5, BlockID: "attach-tab", Cmdline: `claude.exe attach ` + key, CreateMs: 100})
		if got := DisplayBlock(procs, key, srcB587); got != "attach-tab" {
			t.Fatalf("DisplayBlock = %q, want attach-tab", got)
		}
	})
	t.Run("the newest of several fork-source terminals", func(t *testing.T) {
		procs := append(daemonProcs(),
			ProcInfo{Pid: 4, BlockID: "first", Cmdline: tuiResumeCmd, CreateMs: 100},
			ProcInfo{Pid: 5, BlockID: "second", Cmdline: `claude.exe --resume=` + srcB587, CreateMs: 200},
			ProcInfo{Pid: 6, BlockID: "", Cmdline: tuiResumeCmd, CreateMs: 300}) // outside arcterm
		if got := DisplayBlock(procs, key, srcB587); got != "second" {
			t.Fatalf("DisplayBlock = %q, want second", got)
		}
	})
	t.Run("a terminal on another session is not the source", func(t *testing.T) {
		procs := append(daemonProcs(), ProcInfo{Pid: 4, BlockID: "elsewhere", Cmdline: `claude.exe --resume 228cb325-aaaa-4bbb-8ccc-ddddeeeeffff`, CreateMs: 100})
		if got := DisplayBlock(procs, key, srcB587); got != "" {
			t.Fatalf("DisplayBlock = %q, want empty (no terminal shows %s)", got, srcB587)
		}
	})
	t.Run("nothing shows the source, so the report is dropped", func(t *testing.T) {
		if got := DisplayBlock(daemonProcs(), "1903f81a", "228cb325-aaaa-4bbb-8ccc-ddddeeeeffff"); got != "" {
			t.Fatalf("DisplayBlock = %q, want empty", got)
		}
	})
	t.Run("a hosted fork of the source is not a viewer", func(t *testing.T) {
		procs := []ProcInfo{{Pid: 4, BlockID: "forker", Cmdline: `claude.exe --fork-session --resume ` + srcB587, CreateMs: 100}}
		if got := DisplayBlock(procs, key, srcB587); got != "" {
			t.Fatalf("DisplayBlock = %q, want empty", got)
		}
	})
	t.Run("no fork source: only attach clients count", func(t *testing.T) {
		procs := append(daemonProcs(), ProcInfo{Pid: 4, BlockID: "94ba3e7e", Cmdline: tuiResumeCmd, CreateMs: 100})
		if got := DisplayBlock(procs, key, ""); got != "" {
			t.Fatalf("DisplayBlock = %q, want empty", got)
		}
	})
}
