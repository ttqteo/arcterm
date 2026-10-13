// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package pisession parses Pi's native version-3 JSONL session files and
// traverses the active parent branch. It is the single source of truth for Pi
// transcript and usage consumers; no other package re-parses Pi files.
package pisession

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// SupportedVersion is the only Pi native session format version this package reads.
const SupportedVersion = 3

// Header is the authoritative session record that must appear first in a Pi
// v3 JSONL file. It carries the session UUID, cwd, timestamp, and optional
// parent session for resuming a conversation.
type Header struct {
	Type          string `json:"type"`
	Version       int    `json:"version"`
	ID            string `json:"id"`
	Timestamp     string `json:"timestamp"`
	Cwd           string `json:"cwd"`
	ParentSession string `json:"parentSession,omitempty"`
}

// Usage is a record's token accounting. Reasoning is a subset of output and
// cacheWrite1h a subset of cache-write usage; consumers must not add either
// twice.
type Usage struct {
	Input        int  `json:"input"`
	Output       int  `json:"output"`
	CacheRead    int  `json:"cacheRead"`
	CacheWrite   int  `json:"cacheWrite"`
	CacheWrite1h int  `json:"cacheWrite1h,omitempty"`
	Reasoning    int  `json:"reasoning,omitempty"`
	TotalTokens  int  `json:"totalTokens"`
	Cost         Cost `json:"cost"`
}

// Cost is the billed cost of a record.
type Cost struct {
	Total float64 `json:"total"`
}

// Entry is one non-header record in a Pi session: a message, tool result,
// model change, compaction, or branch summary. Raw preserves the full source
// line for consumers that project the transcript.
type Entry struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	ParentID  *string         `json:"parentId"`
	Timestamp string          `json:"timestamp"`
	Provider  string          `json:"provider,omitempty"`
	ModelID   string          `json:"modelId,omitempty"`
	Name      string          `json:"name,omitempty"`
	Summary   string          `json:"summary,omitempty"`
	Usage     *Usage          `json:"usage,omitempty"`
	Message   json.RawMessage `json:"message,omitempty"`
	Raw       json.RawMessage `json:"-"`
}

// File is one parsed Pi v3 session file.
type File struct {
	Path    string
	Header  Header
	Entries []Entry
}

// Read parses the Pi v3 session file at path.
func Read(path string) (*File, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(path, data)
}

// Parse parses Pi v3 JSONL session data. It requires a type:"session" first
// record, validates required header fields, rejects duplicate entry IDs, and
// includes path:line in malformed complete-record errors. The only record
// silently dropped is a malformed final record that is not newline-terminated
// (a partial write from a live session); a malformed newline-terminated record
// is an error.
func Parse(path string, data []byte) (*File, error) {
	file := &File{Path: path}
	chunks := strings.Split(string(data), "\n")
	terminated := bytes.HasSuffix(data, []byte{'\n'})
	seenID := make(map[string]bool)
	for idx, chunk := range chunks {
		line := strings.TrimSpace(chunk)
		if line == "" {
			continue
		}
		tolerant := idx == len(chunks)-1 && !terminated
		if err := file.parseRecord(idx+1, line, tolerant, seenID); err != nil {
			return nil, err
		}
	}
	if file.Header.Type == "" {
		return nil, fmt.Errorf("%s: missing Pi session header record", path)
	}
	return file, nil
}

// parseRecord parses one non-blank line. tolerant records (a malformed
// non-newline-terminated final line) are dropped instead of reported.
func (f *File) parseRecord(lineNo int, line string, tolerant bool, seenID map[string]bool) error {
	var rec struct {
		Type          string          `json:"type"`
		Version       int             `json:"version"`
		ID            string          `json:"id"`
		ParentID      *string         `json:"parentId"`
		Timestamp     string          `json:"timestamp"`
		Cwd           string          `json:"cwd"`
		ParentSession string          `json:"parentSession"`
		Provider      string          `json:"provider"`
		ModelID       string          `json:"modelId"`
		Name          string          `json:"name"`
		Summary       string          `json:"summary"`
		Usage         *Usage          `json:"usage"`
		Message       json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal([]byte(line), &rec); err != nil {
		if tolerant {
			return nil
		}
		return fmt.Errorf("%s:%d: malformed Pi session record: %v", f.Path, lineNo, err)
	}
	if f.Header.Type == "" {
		if rec.Type != "session" {
			return fmt.Errorf("%s:%d: first Pi session record must be a session header, got %q", f.Path, lineNo, rec.Type)
		}
		if rec.Version != SupportedVersion {
			return fmt.Errorf("%s:%d: unsupported Pi session version %d", f.Path, lineNo, rec.Version)
		}
		if rec.ID == "" {
			return fmt.Errorf("%s:%d: Pi session header missing id", f.Path, lineNo)
		}
		if rec.Cwd == "" {
			return fmt.Errorf("%s:%d: Pi session header missing cwd", f.Path, lineNo)
		}
		f.Header = Header{
			Type:          rec.Type,
			Version:       rec.Version,
			ID:            rec.ID,
			Timestamp:     rec.Timestamp,
			Cwd:           rec.Cwd,
			ParentSession: rec.ParentSession,
		}
		return nil
	}
	if rec.Type == "session" {
		return fmt.Errorf("%s:%d: duplicate Pi session header", f.Path, lineNo)
	}
	if rec.Type == "" {
		return fmt.Errorf("%s:%d: Pi session record missing type", f.Path, lineNo)
	}
	if seenID[rec.ID] {
		return fmt.Errorf("%s:%d: duplicate Pi session entry id %q", f.Path, lineNo, rec.ID)
	}
	seenID[rec.ID] = true
	// pi writes billed usage in two places: message entries carry it nested inside the message payload
	// (entry.message.usage), while compaction/branch_summary entries carry it top-level (entry.usage).
	// Normalize to Entry.Usage so consumers never see the split.
	if rec.Usage == nil && len(rec.Message) > 0 {
		var msg struct {
			Usage *Usage `json:"usage"`
		}
		if json.Unmarshal(rec.Message, &msg) == nil {
			rec.Usage = msg.Usage
		}
	}
	f.Entries = append(f.Entries, Entry{
		Type:      rec.Type,
		ID:        rec.ID,
		ParentID:  rec.ParentID,
		Timestamp: rec.Timestamp,
		Provider:  rec.Provider,
		ModelID:   rec.ModelID,
		Name:      rec.Name,
		Summary:   rec.Summary,
		Usage:     rec.Usage,
		Message:   rec.Message,
		Raw:       append([]byte(nil), line...),
	})
	return nil
}

// ActiveBranch returns the session's active parent chain, root-first, following
// parentId from the last entry. Abandoned siblings are excluded. A missing
// parent or a parent cycle returns a path-qualified error.
func (f *File) ActiveBranch() ([]Entry, error) {
	if len(f.Entries) == 0 {
		return nil, nil
	}
	idxByID := make(map[string]int, len(f.Entries))
	for i := range f.Entries {
		idxByID[f.Entries[i].ID] = i
	}
	var chain []int
	onChain := make(map[int]bool, len(f.Entries))
	cur := len(f.Entries) - 1
	for {
		if onChain[cur] {
			return nil, fmt.Errorf("%s: cycle in Pi session parent chain at entry %q", f.Path, f.Entries[cur].ID)
		}
		onChain[cur] = true
		chain = append(chain, cur)
		entry := f.Entries[cur]
		if entry.ParentID == nil || *entry.ParentID == "" {
			break
		}
		parent, ok := idxByID[*entry.ParentID]
		if !ok {
			return nil, fmt.Errorf("%s: entry %q references missing parent %q", f.Path, entry.ID, *entry.ParentID)
		}
		cur = parent
	}
	branch := make([]Entry, len(chain))
	for i := range chain {
		branch[i] = f.Entries[chain[len(chain)-1-i]]
	}
	return branch, nil
}

// BranchMeta folds the active parent chain into a display task: the latest session_info.name wins,
// else the first active user message's text. Both are only ever read off the active branch, so an
// abandoned sibling's title or text cannot leak into this session's task.
func BranchMeta(branch []Entry) (title, firstUser string) {
	for _, e := range branch {
		if e.Type == "session_info" && strings.TrimSpace(e.Name) != "" {
			title = strings.TrimSpace(e.Name)
		}
	}
	if title != "" {
		return title, ""
	}
	for _, e := range branch {
		if txt := UserText(e.Message); txt != "" {
			return "", txt
		}
	}
	return "", ""
}

// UserText returns the first human text of a Pi message record, or "" when the record is not a user
// message (tool results, assistant turns). Content may be a plain string or an array of blocks.
func UserText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal(raw, &m) != nil || m.Role != "user" {
		return ""
	}
	var str string
	if json.Unmarshal(m.Content, &str) == nil {
		return strings.TrimSpace(str)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(m.Content, &blocks) != nil {
		return ""
	}
	for _, b := range blocks {
		if b.Type == "text" && strings.TrimSpace(b.Text) != "" {
			return strings.TrimSpace(b.Text)
		}
	}
	return ""
}
