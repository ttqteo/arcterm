// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// StagnationThreshold is how long a worker's worktree may stay unchanged while the worker is active before the
// lead hears of it. Unmeasured: no worker on record looped (the longest stretch without an edit was 3.8 min).
const StagnationThreshold = 20 * time.Minute

// ActiveWindow is how recent a transcript write or a busy CPU sample must be for a worker to count as active. A
// worker that is not active is the stall path's, not this one's.
const ActiveWindow = 5 * time.Minute

// RepeatedFailureMin is how many times the same tool call must fail the same way to count as a loop.
const RepeatedFailureMin = 3

const (
	// transcriptTailBytes is how much of a worker's transcript the repeated-failure scan reads.
	transcriptTailBytes = 256 << 10
	// failureKeyTail is how much of a failed result's end keys it: the same error, not the same command alone,
	// so red-green work that reruns one test with a changing failure never counts.
	failureKeyTail = 400
)

// progressCheckEvery is the least time between two progress checks of a task: each is a git process. A var so
// tests that tick back to back can zero it.
var progressCheckEvery = time.Minute

// progressFingerprint is the worktree probe, a var so tests need no repo.
var progressFingerprint = worktreeFingerprint

// worktreeFingerprint hashes the tree's status (HEAD's commit, changed and untracked paths) with the size and
// mtime of every listed path, which catch a further edit to an already-changed file that the status text alone
// does not show. Ignored paths are not listed, so a test run's artifacts are not progress.
func worktreeFingerprint(ctx context.Context, dir string) (string, error) {
	out, err := git(ctx, dir, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	io.WriteString(h, out)
	for _, p := range statusPaths(out) {
		// porcelain paths are relative to the tree's root, which a task's worktree is
		if info, err := os.Lstat(filepath.Join(dir, p)); err == nil {
			fmt.Fprintf(h, "\x00%s\x00%d\x00%d", p, info.Size(), info.ModTime().UnixNano())
		} else {
			fmt.Fprintf(h, "\x00%s\x00gone", p)
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// statusPaths are the paths a `git status --porcelain=v2 -z` output lists. A rename's second field is its
// original path, which no longer exists in the tree, so it is skipped.
func statusPaths(out string) []string {
	var paths []string
	records := strings.Split(out, "\x00")
	for i := 0; i < len(records); i++ {
		rec := records[i]
		fieldCount := 0
		switch {
		case strings.HasPrefix(rec, "1 "):
			fieldCount = 9
		case strings.HasPrefix(rec, "2 "):
			fieldCount = 10
			i++
		case strings.HasPrefix(rec, "u "):
			fieldCount = 11
		case strings.HasPrefix(rec, "? "):
			paths = append(paths, strings.TrimPrefix(rec, "? "))
			continue
		default:
			continue
		}
		if fields := strings.SplitN(rec, " ", fieldCount); len(fields) == fieldCount {
			paths = append(paths, fields[fieldCount-1])
		}
	}
	return paths
}

// readTranscriptTail is the last n bytes of a transcript as lines, the partial first line dropped; nil on any error.
func readTranscriptTail(path string, n int64) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil
	}
	start := max(0, st.Size()-n)
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil
	}
	lines := strings.Split(string(data), "\n")
	if start > 0 {
		lines = lines[1:]
	}
	var kept []string
	for _, l := range lines {
		if l != "" {
			kept = append(kept, l)
		}
	}
	return kept
}

// repeatedFailure is the largest group of identical failures in a transcript tail. Key is the command, a NUL and
// the hash of the error's end; zero when no group reaches RepeatedFailureMin.
type repeatedFailure struct {
	Key, Command string
	Count        int
}

// transcriptEntry is the subset of a claude or pi transcript line the scan reads.
type transcriptEntry struct {
	Message struct {
		Role       string          `json:"role"`
		Content    json.RawMessage `json:"content"`
		ToolCallId string          `json:"toolCallId"`
		IsError    bool            `json:"isError"`
	} `json:"message"`
}

type transcriptBlock struct {
	Type      string          `json:"type"`
	Id        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	Arguments json.RawMessage `json:"arguments"`
	ToolUseId string          `json:"tool_use_id"`
	IsError   bool            `json:"is_error"`
	Content   json.RawMessage `json:"content"`
	Text      string          `json:"text"`
}

// scanRepeatedFailure pairs tool calls with their failed results (claude tool_use/tool_result, pi
// toolCall/toolResult) and returns the largest group of the same call failing the same way, skipping the keys in
// skip, which already woke the lead. Ties go to the group whose last failure came latest.
func scanRepeatedFailure(lines []string, skip []string) repeatedFailure {
	type group struct {
		command     string
		count, last int
	}
	commands := map[string]string{}
	groups := map[string]*group{}
	fail := func(i int, callId string, result json.RawMessage) {
		command, ok := commands[callId]
		if !ok {
			return
		}
		key := failureKey(command, resultText(result))
		if g := groups[key]; g != nil {
			g.count, g.last = g.count+1, i
		} else {
			groups[key] = &group{command: command, count: 1, last: i}
		}
	}
	for i, line := range lines {
		var e transcriptEntry
		if json.Unmarshal([]byte(line), &e) != nil {
			continue
		}
		if e.Message.Role == "toolResult" {
			if e.Message.IsError {
				fail(i, e.Message.ToolCallId, e.Message.Content)
			}
			continue
		}
		var blocks []transcriptBlock
		if json.Unmarshal(e.Message.Content, &blocks) != nil {
			continue
		}
		for _, b := range blocks {
			switch b.Type {
			case "tool_use":
				commands[b.Id] = toolCommand(b.Name, b.Input)
			case "toolCall":
				commands[b.Id] = toolCommand(b.Name, b.Arguments)
			case "tool_result":
				if b.IsError {
					fail(i, b.ToolUseId, b.Content)
				}
			}
		}
	}
	var best repeatedFailure
	bestLast := -1
	for key, g := range groups {
		if g.count < RepeatedFailureMin || containsString(skip, key) {
			continue
		}
		if g.count > best.Count || (g.count == best.Count && g.last > bestLast) {
			best = repeatedFailure{Key: key, Command: strings.ToValidUTF8(truncateText(g.command, MaxLatestToolLen), ""), Count: g.count}
			bestLast = g.last
		}
	}
	return best
}

// toolCommand is a call's shell command, trimmed, or its tool name when it has none.
func toolCommand(name string, args json.RawMessage) string {
	var a struct {
		Command string `json:"command"`
	}
	if json.Unmarshal(args, &a) == nil && strings.TrimSpace(a.Command) != "" {
		return strings.TrimSpace(a.Command)
	}
	return name
}

// resultText is a tool result's text: a string, or an array of text blocks joined.
func resultText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []transcriptBlock
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	texts := make([]string, 0, len(blocks))
	for _, b := range blocks {
		texts = append(texts, b.Text)
	}
	return strings.Join(texts, "\n")
}

func failureKey(command, result string) string {
	if r := []rune(result); len(r) > failureKeyTail {
		result = string(r[len(r)-failureKeyTail:])
	}
	sum := sha256.Sum256([]byte(result))
	return command + "\x00" + hex.EncodeToString(sum[:])
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// suspectReason names the signals that fired, then what the worker is running now, so the lead can tell a slow
// test from a loop.
func suspectReason(unchangedMs int64, stagnant bool, rf repeatedFailure, latestTool string) string {
	var parts []string
	if stagnant {
		parts = append(parts, fmt.Sprintf("worktree unchanged %dm while active", unchangedMs/time.Minute.Milliseconds()))
	}
	if rf.Count > 0 {
		parts = append(parts, fmt.Sprintf("`%s` failed the same way %dx", rf.Command, rf.Count))
	}
	if latestTool != "" {
		parts = append(parts, "now: "+latestTool)
	}
	return strings.Join(parts, "; ")
}

// checkProgress flags a running task whose worker is active but not progressing: its worktree unchanged for
// StagnationThreshold while active, or the same failure repeated. Each fires once per episode: stagnation re-arms
// on a tree change, a repeated failure once per key per attempt. A worker waiting on an ask is the question queue's,
// and its unchanged-tree clock restarts while it waits.
// detail is the task-suspect row's.
func checkProgress(ctx context.Context, t *waveobj.TaskNode, run *waveobj.Run, now int64) (reason string, detail map[string]any, flagged bool) {
	if run == nil || run.ProjectPath == "" || now-t.ProgressCheckTs < progressCheckEvery.Milliseconds() {
		return "", nil, false
	}
	if run.Branch == "" {
		// no lane tree (a project that is not a git repo): nothing to fingerprint, and git status there only fails
		return "", nil, false
	}
	if blockId, _ := workerBlockFn(ctx, run); blockId != "" {
		if _, asking := agentask.GlobalRegistry.Get(waveobj.MakeORef(waveobj.OType_Block, blockId).String()); asking {
			// the wait is not stagnation: without this, a worker answered after a long ask is flagged at once
			t.ProgressTs = now
			return "", nil, false
		}
	}
	t.ProgressCheckTs = now
	fp, err := progressFingerprint(ctx, run.ProjectPath)
	if err != nil {
		log.Printf("orchestrate: progress check for dag task %s (run %s): %v", t.ID, run.ID, err)
		return "", nil, false
	}
	if fp != t.ProgressHash {
		t.ProgressHash, t.ProgressTs = fp, now
		t.SuspectTs, t.SuspectReason = 0, ""
	}
	active := now-max(t.LastActivity, t.BusyTs) <= ActiveWindow.Milliseconds()
	unchanged := now - t.ProgressTs
	stagnant := t.SuspectTs == 0 && active && unchanged >= StagnationThreshold.Milliseconds()
	var rf repeatedFailure
	if path, _, tracked := transcriptForRun(run); tracked && path != "" {
		rf = scanRepeatedFailure(readTranscriptTail(path, transcriptTailBytes), t.FlaggedFailures)
	}
	if !stagnant && rf.Count == 0 {
		return "", nil, false
	}
	if rf.Count > 0 {
		t.FlaggedFailures = append(t.FlaggedFailures, rf.Key)
	}
	t.SuspectTs = now
	t.SuspectReason = suspectReason(unchanged, stagnant, rf, t.LatestTool)
	detail = map[string]any{"taskid": t.ID, "unchangedms": unchanged, "command": rf.Command, "count": rf.Count}
	return t.SuspectReason, detail, true
}
