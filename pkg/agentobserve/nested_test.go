// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import "testing"

func TestNestedIn(t *testing.T) {
	sh := procLink{name: "sh"}
	zsh := procLink{name: "zsh"}
	wavesrv := procLink{name: "wavesrv.arm64"}
	agent := procLink{name: "claude", cmdline: "claude --resume b15a588a-543e-41ed-bc1b-5190879e814b"}
	printMode := procLink{name: "claude", cmdline: "claude -p --model claude-haiku-5-5 say ok"}
	ptyHost := procLink{name: "claude", cmdline: `claude --bg-pty-host "\\.\pipe\claude-pty-abc123"`}
	daemon := procLink{name: "claude", cmdline: "claude daemon run"}
	hosted := procLink{name: "claude", cmdline: "claude --session-id 11111111-2222-3333-4444-555555555555"}

	for name, tc := range map[string]struct {
		chain []procLink
		want  bool
	}{
		"the agent's own hook":                           {[]procLink{sh, agent, wavesrv}, false},
		"a claude -p the agent's Bash tool ran":          {[]procLink{sh, printMode, zsh, agent, wavesrv}, true},
		"an interactive claude inside an agent":          {[]procLink{agent, zsh, agent, wavesrv}, true},
		"a session the daemon hosts":                     {[]procLink{sh, hosted, ptyHost, daemon}, false},
		"hosted straight under the daemon":               {[]procLink{sh, hosted, daemon}, false},
		"a claude -p inside a hosted session":            {[]procLink{sh, printMode, zsh, hosted, ptyHost, daemon}, true},
		"the Mac's native install, named by its version": {[]procLink{sh, {name: "2.1.322", cmdline: "claude -p hi"}, zsh, {name: "2.1.322", cmdline: "claude --resume b15a588a"}, wavesrv}, true},
		"its own hook under the native install":          {[]procLink{sh, {name: "2.1.322", cmdline: "claude --resume b15a588a"}, wavesrv}, false},
		"a claude run by its full path":                  {[]procLink{sh, {name: "2.1.322", cmdline: "/Users/me/.local/bin/claude -p hi"}, zsh, agent}, true},
		"Windows names":                                  {[]procLink{{name: "cmd.exe"}, {name: "claude.exe", cmdline: "claude.exe -p hi"}, {name: "pwsh.exe"}, {name: "CLAUDE.EXE", cmdline: "claude.exe"}}, true},
		"no claude at all":                               {[]procLink{sh, zsh, wavesrv}, false},
		"an empty chain":                                 {nil, false},
	} {
		if got := nestedIn(tc.chain); got != tc.want {
			t.Errorf("%s: nestedIn = %v, want %v", name, got, tc.want)
		}
	}
}

func TestAncestorsOfAGonePid(t *testing.T) {
	// a process gone before the walk reads it ends the chain instead of failing
	chain := ancestors(int32(1<<30), 3)
	if len(chain) != 0 {
		t.Fatalf("a pid that does not exist gave %v", chain)
	}
}
