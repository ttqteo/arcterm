// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import (
	"os"
	"path/filepath"

	"github.com/shirou/gopsutil/v4/process"
)

// A claude session started inside another one (a `claude -p` an agent's Bash tool runs, an interactive claude it
// opens) inherits its terminal's WAVETERM_BLOCKID, so its hooks reported into the agent's block as if they were the
// agent: its state, its transcript path (Chat then showed the nested conversation) and its `wsh agentctl` stream,
// which replaced the agent's own and took it away when the nested session ended. Hooks and agentctl ask
// NestedSession first and leave the block to the session that runs in it.

// maxNestedAncestors bounds the walk: hook → its shell → claude → the Bash tool's shell → the outer claude fits
// with room to spare.
const maxNestedAncestors = 12

// procLink is one process on the way up from the caller: its name and its command line.
type procLink struct {
	name, cmdline string
}

// isClaude reports whether p is a claude process. Its executable name alone misses the native install on a Mac,
// whose ~/.local/bin/claude links to versions/<version>: the process is named "2.1.322" there, and only its
// command line's first word still reads claude.
func (p procLink) isClaude() bool {
	if isClaudeProc(p.name) {
		return true
	}
	tokens := cmdTokens(p.cmdline)
	return len(tokens) > 0 && isClaudeProc(filepath.Base(tokens[0]))
}

// NestedSession reports whether the calling process (a hook, `wsh agentctl`) belongs to a claude session that runs
// inside another claude session. A session the daemon hosts is not nested: the claude processes above it are the
// daemon's pty host and the daemon itself, which run no conversation.
//
// A print-mode claude (`claude -p`, which exports CLAUDE_CODE_ENTRYPOINT=sdk-cli to its hooks over the agent's cli)
// counts as nested without the walk: it runs no session a person types into, so it is never the block's agent, and
// on Windows the walk loses it. Under Git Bash a pipeline or `timeout` puts an MSYS fork stub between the nested
// claude and the outer shell, and the stub has exited by the time a hook walks up, so the chain ends before it reaches
// the agent's claude. A `timeout 150 claude --resume … --fork-session -p … | node` an agent ran reported into its
// block that way: the agent read idle under the nested session's title, every tool hook of its own turn was dropped
// as out of turn, and Chat showed the nested conversation with your message stuck at Sending… (2026-11-12).
func NestedSession() bool {
	return nestedSession(os.Getenv("CLAUDE_CODE_ENTRYPOINT"), func() []procLink {
		return ancestors(int32(os.Getppid()), maxNestedAncestors)
	})
}

// nestedSession is NestedSession over the caller's CLAUDE_CODE_ENTRYPOINT and a walk taken only when it is needed.
func nestedSession(entrypoint string, chain func() []procLink) bool {
	if IsHeadlessEntrypoint(entrypoint) {
		return true
	}
	return nestedIn(chain())
}

// nestedIn is NestedSession over the chain of processes above the caller, nearest first.
func nestedIn(chain []procLink) bool {
	inSession := false
	for _, p := range chain {
		if !p.isClaude() {
			continue
		}
		if !inSession {
			inSession = true // the session the caller belongs to
			continue
		}
		if PtyHostKey(p.cmdline) != "" || isDaemon(cmdTokens(p.cmdline)) {
			return false
		}
		return true
	}
	return false
}

func ancestors(pid int32, max int) []procLink {
	var chain []procLink
	for range max {
		p, err := process.NewProcess(pid)
		if err != nil {
			break
		}
		name, _ := p.Name()
		cmdline, _ := p.Cmdline()
		chain = append(chain, procLink{name: name, cmdline: cmdline})
		ppid, err := p.Ppid()
		if err != nil || ppid <= 1 || ppid == pid {
			break
		}
		pid = ppid
	}
	return chain
}
