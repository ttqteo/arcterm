// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import (
	"os"
	"slices"
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

// A terminal TUI can also send its own session to the background (no `claude attach` is ever run): the daemon
// then hosts a fork of it, `claude --session-id <new> --fork-session --resume <source>`, and the original TUI
// process keeps displaying the fork. Its command line still names the source (`claude --resume <source>`), so the
// terminal is found by matching the hosted session's fork source against the session each terminal claude runs.

const (
	forkSessionFlag = "--fork-session"
	jsonlSuffix     = ".jsonl"
)

// cmdTokens splits a command line into arguments. A double quote groups an argument that holds spaces and is
// dropped, backslashes are literal (they are Windows path separators).
func cmdTokens(cmdline string) []string {
	var out []string
	var cur strings.Builder
	inQuote, has := false, false
	for _, r := range cmdline {
		switch {
		case r == '"':
			inQuote, has = !inQuote, true
		case !inQuote && (r == ' ' || r == '\t'):
			if has {
				out = append(out, cur.String())
				cur.Reset()
				has = false
			}
		default:
			cur.WriteRune(r)
			has = true
		}
	}
	if has {
		out = append(out, cur.String())
	}
	return out
}

// flagValue finds the first of `names` among the tokens as `--name value` or `--name=value`. found reports
// whether a flag is present at all; value is "" when it is bare (no value, or the next token is another flag).
func flagValue(tokens []string, names ...string) (value string, found bool) {
	for i, t := range tokens {
		for _, name := range names {
			if v, ok := strings.CutPrefix(t, name+"="); ok {
				return v, true
			}
			if t != name {
				continue
			}
			if i+1 >= len(tokens) || strings.HasPrefix(tokens[i+1], "-") {
				return "", true
			}
			v := tokens[i+1]
			// A path with spaces is not quoted where the command line is an argv joined with spaces (macOS,
			// Linux): the value runs on until the token that ends the transcript file name.
			if strings.ContainsAny(v, `\/`) && !strings.HasSuffix(v, jsonlSuffix) {
				joined := v
				for _, next := range tokens[i+2:] {
					if strings.HasPrefix(next, "-") {
						break
					}
					joined += " " + next
					if strings.HasSuffix(next, jsonlSuffix) {
						return joined, true
					}
				}
			}
			return v, true
		}
	}
	return "", false
}

// sessionIDOf turns a `--resume` / `--session-id` value into a session id: a transcript path becomes its file
// name without ".jsonl" (the id), and anything else is returned as it is.
func sessionIDOf(value string) string {
	if i := strings.LastIndexAny(value, `\/`); i >= 0 {
		value = value[i+1:]
	}
	return strings.TrimSuffix(value, jsonlSuffix)
}

func hasFlag(tokens []string, name string) bool {
	return slices.Contains(tokens, name)
}

// ForkSource returns the session a daemon-hosted fork was made from: the `--resume` value of a command line that
// also carries `--fork-session`, as a session id (a transcript path gives its file name without ".jsonl"). "" when
// the command line forks nothing or names no session to resume.
func ForkSource(cmdline string) string {
	tokens := cmdTokens(cmdline)
	if !hasFlag(tokens, forkSessionFlag) {
		return ""
	}
	value, _ := flagValue(tokens, "--resume", "-r")
	return sessionIDOf(value)
}

// SessionRef returns the session id a terminal claude command line runs: its `--session-id` value, else its
// `--resume` value (a transcript path gives its file name without ".jsonl"). "" for a bare `--resume`,
// `--continue` or no flag (the id is not on the command line), and for a daemon pty host or an attach client,
// which run no session of their own.
func SessionRef(cmdline string) string {
	if PtyHostKey(cmdline) != "" || AttachKey(cmdline) != "" {
		return ""
	}
	tokens := cmdTokens(cmdline)
	if value, _ := flagValue(tokens, "--session-id"); value != "" {
		return sessionIDOf(value)
	}
	value, _ := flagValue(tokens, "--resume", "-r")
	return sessionIDOf(value)
}

// isForkSourceViewer reports whether a command line is a terminal claude that runs the session `forkSource`: its
// own session is that one, and it is not itself a fork (a `--fork-session` command line runs a new session, so it
// shows nothing of the source).
func isForkSourceViewer(cmdline, forkSource string) bool {
	if forkSource == "" || SessionRef(cmdline) != forkSource {
		return false
	}
	return !hasFlag(cmdTokens(cmdline), forkSessionFlag)
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

// DisplayBlock picks the block of the terminal that shows the hosted session `key`: the newest attach client
// (AttachedBlock), else, when the session was forked from `forkSource`, the newest terminal claude carrying a
// block that runs that source (the TUI that sent it to the background). "" when neither exists.
func DisplayBlock(procs []ProcInfo, key, forkSource string) string {
	if block := AttachedBlock(procs, key); block != "" {
		return block
	}
	best := ProcInfo{}
	for _, p := range procs {
		if p.BlockID == "" || !isForkSourceViewer(p.Cmdline, forkSource) {
			continue
		}
		if best.BlockID == "" || p.CreateMs > best.CreateMs {
			best = p
		}
	}
	return best.BlockID
}

// hostKey walks up from the calling process to its nearest claude ancestor (the session the hook runs for)
// and returns that session's daemon key and its own command line, or "" for both when the session runs directly
// in a terminal (its command line is then not read).
func hostKey() (key, cmdline string) {
	pid := int32(os.Getppid())
	for range maxAncestors {
		p, err := process.NewProcess(pid)
		if err != nil {
			return "", ""
		}
		if name, _ := p.Name(); isClaudeProc(name) {
			parent, err := p.Parent()
			if err != nil {
				return "", ""
			}
			parentCmdline, _ := parent.Cmdline()
			key = PtyHostKey(parentCmdline)
			if key == "" {
				return "", ""
			}
			cmdline, _ = p.Cmdline()
			return key, cmdline
		}
		ppid, err := p.Ppid()
		if err != nil || ppid <= 0 || ppid == pid {
			return "", ""
		}
		pid = ppid
	}
	return "", ""
}

// HostedDisplayBlock reports whether the calling hook runs for a daemon-hosted Claude session and, if so, the
// bare block id of the terminal that shows it: the one attached to it, else the one that started the fork it is
// ("" when neither exists). A session that runs directly in a terminal returns hosted=false and keeps its own
// WAVETERM_BLOCKID. The process table is read for a hosted session alone, so a direct session pays only for the
// ancestor walk.
func HostedDisplayBlock() (blockID string, hosted bool) {
	key, cmdline := hostKey()
	if key == "" {
		return "", false
	}
	forkSource := ForkSource(cmdline)
	return DisplayBlock(displayCandidates(key, forkSource), key, forkSource), true
}

// displayCandidates lists the claude processes that can show the hosted session `key`: those attached to it and
// those that run its fork source. Unlike EnumerateAgents it reads the environment of those alone, since this runs
// inside a hook on every tool call.
func displayCandidates(key, forkSource string) []ProcInfo {
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
		if AttachKey(cmdline) != key && !isForkSourceViewer(cmdline, forkSource) {
			continue
		}
		environ, _ := p.Environ()
		createMs, _ := p.CreateTime()
		out = append(out, ProcInfo{Pid: p.Pid, BlockID: blockIDFromEnv(environ), CreateMs: createMs, Cmdline: cmdline})
	}
	return out
}
