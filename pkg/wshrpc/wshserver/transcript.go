// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const defaultTranscriptTailLines = 200

// readTranscriptLines returns all non-empty lines of the JSONL transcript at path. The whole file
// is read into memory; session transcripts are MB-scale at most, so this stays simple (KISS) —
// switch to a streamed read only if a real file proves too large.
func readTranscriptLines(path string) ([]string, error) {
	if path == "" {
		return nil, fmt.Errorf("transcript path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat transcript: %w", err)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("transcript path is a directory: %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read transcript: %w", err)
	}
	var lines []string
	for _, ln := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		lines = append(lines, ln)
	}
	return lines, nil
}

// readTranscriptTail returns the last maxLines non-empty lines of the transcript at path.
// maxLines == 0 keeps the default tail size; a negative maxLines returns every line (the
// full-history read Pi alone requests — its parent-linked active branch can't be reconstructed
// from a bounded tail).
func readTranscriptTail(path string, maxLines int) ([]string, error) {
	lines, err := readTranscriptLines(path)
	if err != nil {
		return nil, err
	}
	if maxLines == 0 {
		maxLines = defaultTranscriptTailLines
	}
	if maxLines > 0 && len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return lines, nil
}

// readTranscriptHead returns the first maxLines non-empty lines of the transcript at path. Codex's
// cwd lives only on the first-line session_meta record, so the head read resolves cwd for Codex
// sessions too long to fit the tail (see docs/deferred.md, Files surface).
func readTranscriptHead(path string, maxLines int) ([]string, error) {
	lines, err := readTranscriptLines(path)
	if err != nil {
		return nil, err
	}
	if maxLines <= 0 {
		maxLines = defaultTranscriptTailLines
	}
	if len(lines) > maxLines {
		lines = lines[:maxLines]
	}
	return lines, nil
}

// transcriptTailer reads only the lines appended to a file since the last call.
// It buffers a partial (non-newline-terminated) trailing line until its newline
// arrives, and resets on truncation/rotation (size shrinks below the read offset).
// The transcript is append-only JSONL; the projection tolerates the rare malformed
// line, so this stays deliberately simple.
type transcriptTailer struct {
	offset  int64
	partial []byte
}

func (t *transcriptTailer) readNew(path string) ([]string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	size := info.Size()
	if size < t.offset {
		t.offset = 0
		t.partial = nil
	}
	if size == t.offset {
		return nil, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if _, err := f.Seek(t.offset, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	t.offset = size
	buf := append(t.partial, data...)
	var lines []string
	start := 0
	for i := 0; i < len(buf); i++ {
		if buf[i] != '\n' {
			continue
		}
		line := strings.TrimRight(string(buf[start:i]), "\r")
		if strings.TrimSpace(line) != "" {
			lines = append(lines, line)
		}
		start = i + 1
	}
	t.partial = append([]byte(nil), buf[start:]...)
	return lines, nil
}

// streamTranscript emits the transcript backlog (last tailLines, or the whole file for a negative
// tailLines — Pi's full-history stream) then watches the containing directory and pushes
// newly-appended lines as they arrive. Returns when ctx is cancelled or on a fatal error (the
// caller forwards the error onto the channel).
func streamTranscript(ctx context.Context, path string, tailLines int, ch chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate]) error {
	if path == "" {
		return fmt.Errorf("transcript path is required")
	}
	if tailLines == 0 {
		tailLines = defaultTranscriptTailLines
	}

	// Establish the watch before snapshotting the backlog so no append between the two
	// is lost: a write during setup is captured by the backlog read (the queued event then
	// yields a no-op readNew), and every write after it is guaranteed to fire an event.
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("creating watcher: %w", err)
	}
	defer watcher.Close()
	if err := watcher.Add(filepath.Dir(path)); err != nil {
		return fmt.Errorf("watching transcript dir: %w", err)
	}

	tailer := &transcriptTailer{}
	backlog, err := tailer.readNew(path)
	// a not-yet-existing file is expected: a freshly-spawned worker reports its transcript path before
	// Claude creates the JSONL. Stay open with an empty backlog and let the dir watch pick up the file's
	// Create event — don't abort, or the stream dies permanently until the panel remounts.
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("reading transcript: %w", err)
	}
	if tailLines > 0 && len(backlog) > tailLines {
		backlog = backlog[len(backlog)-tailLines:]
	}
	ch <- wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate]{Response: wshrpc.AgentTranscriptUpdate{Lines: backlog}}

	target := filepath.Clean(path)
	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-watcher.Events:
			if !ok {
				return nil
			}
			if filepath.Clean(event.Name) != target {
				continue
			}
			if event.Op&(fsnotify.Write|fsnotify.Create) == 0 {
				continue
			}
			lines, err := tailer.readNew(path)
			if err != nil {
				log.Printf("transcript tail read: %v\n", err)
				continue
			}
			if len(lines) == 0 {
				continue
			}
			ch <- wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate]{Response: wshrpc.AgentTranscriptUpdate{Lines: lines}}
		case werr, ok := <-watcher.Errors:
			if !ok {
				return nil
			}
			log.Printf("transcript watcher error: %v\n", werr)
		}
	}
}

// subagentsDir derives the Claude Code subagents directory for a parent transcript path:
// <dir>/<basename without .jsonl>/subagents.
func subagentsDir(parentPath string) string {
	base := strings.TrimSuffix(filepath.Base(parentPath), ".jsonl")
	return filepath.Join(filepath.Dir(parentPath), base, "subagents")
}

// firstPromptOf extracts the human prompt from a subagent transcript's first record. That record is a
// user turn whose message.content is either a bare string or an array of {type,text} blocks.
func firstPromptOf(line string) string {
	var rec struct {
		Message struct {
			Content json.RawMessage `json:"content"`
		} `json:"message"`
	}
	if json.Unmarshal([]byte(line), &rec) != nil {
		return ""
	}
	var s string
	if json.Unmarshal(rec.Message.Content, &s) == nil {
		return strings.TrimSpace(s)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(rec.Message.Content, &blocks) == nil {
		for _, b := range blocks {
			if b.Type == "text" && strings.TrimSpace(b.Text) != "" {
				return strings.TrimSpace(b.Text)
			}
		}
	}
	return ""
}

// terminalTailLines is how far back lastRecordTerminal looks: past the hook attachments claude appends after a
// child's last message, to the tool_use a final tool_result answers.
const terminalTailLines = 40

// handbackTool is the tool a background subagent delivers its report with; its result ends the child.
const handbackTool = "SubagentHandback"

type transcriptBlock struct {
	Type      string `json:"type"`
	Name      string `json:"name"`
	ID        string `json:"id"`
	ToolUseID string `json:"tool_use_id"`
	IsError   bool   `json:"is_error"`
	Text      string `json:"text"`
}

type transcriptMessage struct {
	Type   string
	Blocks []transcriptBlock
	Text   string // a message whose content is a bare string
}

// lastRecordTerminal reports whether a subagent's transcript says the child has finished, from its last
// user/assistant message (records of any other type, such as hook attachments, are skipped). A child has
// finished when that message is:
//   - an assistant turn with text and no tool_use (end_turn);
//   - the result of its SubagentHandback (a background child delivered its report);
//   - the user's interrupt, which stops the child for good.
//
// A pending tool_use or any other tool_result is a live child. On 2026-10-06, 182 of 305 real subagent files
// ended with a handback and 33 with hook attachments after the text turn; reading only the last record read
// every one of them as live.
func lastRecordTerminal(path string) bool {
	tail, err := readTranscriptTail(path, terminalTailLines)
	if err != nil {
		return false
	}
	var msgs []transcriptMessage
	for _, line := range tail {
		var rec struct {
			Type    string `json:"type"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(line), &rec) != nil || (rec.Type != "user" && rec.Type != "assistant") {
			continue
		}
		m := transcriptMessage{Type: rec.Type}
		if json.Unmarshal(rec.Message.Content, &m.Blocks) != nil {
			_ = json.Unmarshal(rec.Message.Content, &m.Text) // content is either blocks or a string
		}
		msgs = append(msgs, m)
	}
	if len(msgs) == 0 {
		return false
	}
	last := msgs[len(msgs)-1]
	if last.Type == "assistant" {
		hasText := false
		for _, b := range last.Blocks {
			if b.Type == "tool_use" {
				return false // a tool call awaits its result: still working
			}
			if b.Type == "text" {
				hasText = true
			}
		}
		return hasText
	}
	if strings.HasPrefix(last.Text, "[Request interrupted by user") {
		return true
	}
	for _, b := range last.Blocks {
		if b.Type == "text" && strings.HasPrefix(b.Text, "[Request interrupted by user") {
			return true
		}
		if b.Type == "tool_result" && !b.IsError && toolNameFor(msgs[:len(msgs)-1], b.ToolUseID) == handbackTool {
			return true
		}
	}
	return false
}

// toolNameFor names the tool_use with id in msgs, latest first, or "" when it is not among them.
func toolNameFor(msgs []transcriptMessage, id string) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		for _, b := range msgs[i].Blocks {
			if b.Type == "tool_use" && b.ID == id {
				return b.Name
			}
		}
	}
	return ""
}

// listSubagents returns one SubagentFileInfo per agent-*.jsonl in the parent's subagents dir, sorted by
// StartedAtMs ascending. A missing dir yields an empty slice (not an error) — a parent that never
// spawned a subagent has no dir.
func listSubagents(parentPath string) ([]wshrpc.SubagentFileInfo, error) {
	if parentPath == "" {
		return nil, fmt.Errorf("parent transcript path is required")
	}
	matches, err := filepath.Glob(filepath.Join(subagentsDir(parentPath), "agent-*.jsonl"))
	if err != nil {
		return nil, fmt.Errorf("globbing subagents: %w", err)
	}
	infos := make([]wshrpc.SubagentFileInfo, 0, len(matches))
	for _, path := range matches {
		head, err := readTranscriptHead(path, 1)
		if err != nil || len(head) == 0 {
			continue
		}
		info := wshrpc.SubagentFileInfo{
			AgentId:        strings.TrimSuffix(strings.TrimPrefix(filepath.Base(path), "agent-"), ".jsonl"),
			TranscriptPath: path,
			FirstPrompt:    firstPromptOf(head[0]),
			Done:           lastRecordTerminal(path),
		}
		if st, statErr := os.Stat(path); statErr == nil {
			info.StartedAtMs = st.ModTime().UnixMilli()
		}
		infos = append(infos, info)
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].StartedAtMs < infos[j].StartedAtMs })
	return infos, nil
}
