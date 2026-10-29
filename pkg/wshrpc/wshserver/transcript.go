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

// statTranscript checks that path names a transcript file that exists and returns its size.
func statTranscript(path string) (int64, error) {
	if path == "" {
		return 0, fmt.Errorf("transcript path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("stat transcript: %w", err)
	}
	if info.IsDir() {
		return 0, fmt.Errorf("transcript path is a directory: %s", path)
	}
	return info.Size(), nil
}

// splitTranscriptData splits JSONL data into its non-empty newline-terminated lines and rest, the text after the
// last newline (empty when data ends with one): an unfinished line that has no newline yet.
func splitTranscriptData(data []byte) (lines []string, rest string) {
	parts := strings.Split(string(data), "\n")
	rest = parts[len(parts)-1]
	for _, ln := range parts[:len(parts)-1] {
		if strings.TrimSpace(ln) != "" {
			lines = append(lines, ln)
		}
	}
	return lines, rest
}

// readTranscriptFile returns all non-empty lines of the JSONL transcript at path, numbered from 0 by their position,
// with the byte offset past the last newline-terminated line and whether the last line has no newline yet (it is
// included in lines). The whole file is read into memory; session transcripts are MB-scale at most, so this stays
// simple (KISS) — switch to a streamed read only if a real file proves too large.
func readTranscriptFile(path string) (lines []string, end int64, partial bool, err error) {
	if _, err := statTranscript(path); err != nil {
		return nil, 0, false, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, false, fmt.Errorf("read transcript: %w", err)
	}
	lines, rest := splitTranscriptData(data)
	end = int64(len(data) - len(rest))
	if strings.TrimSpace(rest) != "" {
		lines = append(lines, rest)
		partial = true
	}
	return lines, end, partial, nil
}

// sliceTranscriptLines picks the window of lines a read asks for and the file index of its first line:
//   - before > 0: the last maxLines lines of lines[:before], before clamped to len(lines);
//   - fromStart: the first maxLines lines;
//   - otherwise: the last maxLines lines.
//
// maxLines == 0 keeps the default size. A negative maxLines returns every line up to before (or the end) — the
// full-history read Pi alone requests, since its parent-linked active branch can't be reconstructed from a bounded
// tail — except for a head read, where it means the default as it always has.
func sliceTranscriptLines(lines []string, maxLines, before int, fromStart bool) ([]string, int) {
	if fromStart {
		if maxLines <= 0 {
			maxLines = defaultTranscriptTailLines
		}
		if len(lines) > maxLines {
			lines = lines[:maxLines]
		}
		return lines, 0
	}
	if before > 0 && before < len(lines) {
		lines = lines[:before]
	}
	if maxLines == 0 {
		maxLines = defaultTranscriptTailLines
	}
	start := 0
	if maxLines > 0 && len(lines) > maxLines {
		start = len(lines) - maxLines
	}
	return lines[start:], start
}

// readTranscriptSlice answers a line-index read of the transcript at path: the window sliceTranscriptLines picks,
// where it starts, how many lines the file holds, the offset past its last newline-terminated line, and whether the
// window's last line is that unterminated one.
func readTranscriptSlice(path string, maxLines, before int, fromStart bool) (*wshrpc.CommandGetAgentTranscriptRtnData, error) {
	all, end, partial, err := readTranscriptFile(path)
	if err != nil {
		return nil, err
	}
	lines, start := sliceTranscriptLines(all, maxLines, before, fromStart)
	return &wshrpc.CommandGetAgentTranscriptRtnData{
		Lines:   lines,
		Start:   start,
		Total:   len(all),
		End:     end,
		Partial: partial && start+len(lines) == len(all),
	}, nil
}

// readTranscriptFrom answers an append read: only the bytes of the transcript at path from fromByte on, never the ones
// before it. It returns their complete non-empty lines and the offset past the last newline; an unfinished last line
// is left for the next read. A file now shorter than fromByte (replaced or truncated) answers Reset with no lines.
func readTranscriptFrom(path string, fromByte int64) (*wshrpc.CommandGetAgentTranscriptRtnData, error) {
	size, err := statTranscript(path)
	if err != nil {
		return nil, err
	}
	if size < fromByte {
		return &wshrpc.CommandGetAgentTranscriptRtnData{Lines: []string{}, Reset: true}, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open transcript: %w", err)
	}
	defer f.Close()
	if _, err := f.Seek(fromByte, io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek transcript: %w", err)
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read transcript: %w", err)
	}
	lines, rest := splitTranscriptData(data)
	if lines == nil {
		lines = []string{}
	}
	return &wshrpc.CommandGetAgentTranscriptRtnData{Lines: lines, End: fromByte + int64(len(data)-len(rest))}, nil
}

// readAgentTranscript answers a getagenttranscript request: an append read (FromByte), an earlier-chunk read (Before),
// a head read (FromStart) or, with none of them set, a tail read.
func readAgentTranscript(data wshrpc.CommandGetAgentTranscriptData) (*wshrpc.CommandGetAgentTranscriptRtnData, error) {
	if data.Before < 0 {
		return nil, fmt.Errorf("before must not be negative: %d", data.Before)
	}
	if data.FromByte < 0 {
		return nil, fmt.Errorf("frombyte must not be negative: %d", data.FromByte)
	}
	var set []string
	if data.Before > 0 {
		set = append(set, "before")
	}
	if data.FromByte > 0 {
		set = append(set, "frombyte")
	}
	if data.FromStart {
		set = append(set, "fromstart")
	}
	if len(set) > 1 {
		return nil, fmt.Errorf("set only one of before, frombyte and fromstart, not %s", strings.Join(set, " and "))
	}
	if data.FromByte > 0 {
		return readTranscriptFrom(data.Path, data.FromByte)
	}
	return readTranscriptSlice(data.Path, data.MaxLines, data.Before, data.FromStart)
}

// readTranscriptTail returns the last maxLines non-empty lines of the transcript at path.
// maxLines == 0 keeps the default tail size; a negative maxLines returns every line (the
// full-history read Pi alone requests — its parent-linked active branch can't be reconstructed
// from a bounded tail).
func readTranscriptTail(path string, maxLines int) ([]string, error) {
	rtn, err := readTranscriptSlice(path, maxLines, 0, false)
	if err != nil {
		return nil, err
	}
	return rtn.Lines, nil
}

// readTranscriptHead returns the first maxLines non-empty lines of the transcript at path. Codex's
// cwd lives only on the first-line session_meta record, so the head read resolves cwd for Codex
// sessions too long to fit the tail (see docs/deferred.md, Files surface).
func readTranscriptHead(path string, maxLines int) ([]string, error) {
	rtn, err := readTranscriptSlice(path, maxLines, 0, true)
	if err != nil {
		return nil, err
	}
	return rtn.Lines, nil
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

// terminalTailLines is how far back subagentTail reads: past the hook attachments claude appends after a
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
	Model  string // the model an assistant turn names
	Blocks []transcriptBlock
	Text   string // a message whose content is a bare string
}

// subagentTail returns the user/assistant messages among the last terminalTailLines records of a subagent's
// transcript; records of any other type, such as hook attachments, are skipped. An unreadable file has none.
func subagentTail(path string) []transcriptMessage {
	tail, err := readTranscriptTail(path, terminalTailLines)
	if err != nil {
		return nil
	}
	var msgs []transcriptMessage
	for _, line := range tail {
		var rec struct {
			Type    string `json:"type"`
			Message struct {
				Model   string          `json:"model"`
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(line), &rec) != nil || (rec.Type != "user" && rec.Type != "assistant") {
			continue
		}
		m := transcriptMessage{Type: rec.Type, Model: rec.Message.Model}
		if json.Unmarshal(rec.Message.Content, &m.Blocks) != nil {
			_ = json.Unmarshal(rec.Message.Content, &m.Text) // content is either blocks or a string
		}
		msgs = append(msgs, m)
	}
	return msgs
}

// latestModel names the model of the latest assistant turn in msgs. claude's "<synthetic>" turns (an interrupt, an
// API error) stand in for a model rather than name one, so they are passed over.
func latestModel(msgs []transcriptMessage) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Type == "assistant" && msgs[i].Model != "" && msgs[i].Model != "<synthetic>" {
			return msgs[i].Model
		}
	}
	return ""
}

// lastRecordTerminal reports whether a subagent's transcript says the child has finished, from its last
// user/assistant message in msgs (subagentTail). A child has finished when that message is:
//   - an assistant turn with text and no tool_use (end_turn);
//   - the result of its SubagentHandback (a background child delivered its report);
//   - the user's interrupt, which stops the child for good.
//
// A pending tool_use or any other tool_result is a live child. On 2026-10-06, 182 of 305 real subagent files
// ended with a handback and 33 with hook attachments after the text turn; reading only the last record read
// every one of them as live.
func lastRecordTerminal(msgs []transcriptMessage) bool {
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
		tail := subagentTail(path)
		info := wshrpc.SubagentFileInfo{
			AgentId:        strings.TrimSuffix(strings.TrimPrefix(filepath.Base(path), "agent-"), ".jsonl"),
			TranscriptPath: path,
			FirstPrompt:    firstPromptOf(head[0]),
			Done:           lastRecordTerminal(tail),
			Model:          latestModel(tail),
		}
		if st, statErr := os.Stat(path); statErr == nil {
			info.StartedAtMs = st.ModTime().UnixMilli()
		}
		infos = append(infos, info)
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].StartedAtMs < infos[j].StartedAtMs })
	return infos, nil
}
