// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentedits rebuilds the files one Claude Code agent changed itself. It replays the Edit, Write and
// MultiEdit calls of the agent's transcript over Claude Code's file-history backups (each file's pre-image) to
// get the post-image, then writes two synthetic commits, B (the files as the agent first found them) and H (as
// it left them), so the Diff surface can read the agent's own edits as an ordinary B..H range through
// GitAgentEditsCommand. Replay (agentedits.go) is pure Go over transcript lines and file contents; commits.go
// builds B and H with a private GIT_INDEX_FILE.
package agentedits

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type Flag string

const (
	Approximate Flag = "approximate" // no file-history record: the pre-image is the base content
	Outside     Flag = "outside"     // an edit could not apply: something else changed the file
)

const (
	transcriptExt = ".jsonl"
	subagentsDir  = "subagents"
	historyDir    = "file-history"

	toolEdit      = "Edit"
	toolWrite     = "Write"
	toolMultiEdit = "MultiEdit"
	toolBash      = "Bash"
)

// Log is one transcript plus its subagent transcripts.
type Log struct {
	SessionStart int64  // unix seconds of the first timestamped record; 0 = none
	SessionCwd   string // the cwd the transcript records
	EditCalls    int    // successful Edit/Write/MultiEdit calls
	BashCalls    int

	backupDir string            // <file-history>/<sessionId>
	calls     []editCall        // successful calls, in timestamp order
	pre       map[string]backup // earliest backup per absolute slash path (pathKey)
}

type File struct {
	Path       string // repo-relative, forward slashes
	Pre        []byte
	PreExists  bool
	Post       []byte
	PostExists bool
	Flag       Flag // "" when exact
}

// Reader returns a file's content by repo-relative path; ok=false means the file is absent there.
type Reader func(repoPath string) (content []byte, ok bool, err error)

type backup struct {
	path    string  // absolute, forward slashes
	name    *string // nil: the file did not exist
	version int
}

type editOp struct {
	OldString  string `json:"old_string"`
	NewString  string `json:"new_string"`
	ReplaceAll bool   `json:"replace_all"`
}

type editCall struct {
	path    string // absolute, forward slashes
	write   bool
	content string   // Write
	edits   []editOp // Edit (one) or MultiEdit
	ts      time.Time
}

type toolInput struct {
	FilePath string `json:"file_path"`
	Content  string `json:"content"`
	editOp
	Edits []editOp `json:"edits"`
}

type backupJSON struct {
	BackupFileName *string `json:"backupFileName"`
	Version        int     `json:"version"`
}

type record struct {
	Type         string      `json:"type"`
	Timestamp    string      `json:"timestamp"`
	Cwd          string      `json:"cwd"`
	TrackingPath string      `json:"trackingPath"`
	Backup       *backupJSON `json:"backup"`
	Snapshot     *struct {
		TrackedFileBackups map[string]backupJSON `json:"trackedFileBackups"`
	} `json:"snapshot"`
	Message *struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

type block struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
	IsError   bool            `json:"is_error"`
}

// pending is a tool_use seen in one transcript, resolved once every transcript's results are read.
type pending struct {
	id    string
	name  string
	input json.RawMessage
	cwd   string
	ts    time.Time
	seq   int
}

// FileHistoryDir is where Claude Code keeps the backups of the transcript's session: beside the transcript's
// own config dir when it sits at <config>/projects/<p>/<id>.jsonl, else under CLAUDE_CONFIG_DIR or ~/.claude.
func FileHistoryDir(transcriptPath string) string {
	projects := filepath.Dir(filepath.Dir(transcriptPath))
	if filepath.Base(projects) == "projects" {
		return filepath.Join(filepath.Dir(projects), historyDir)
	}
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		return filepath.Join(d, historyDir)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".claude", historyDir)
	}
	return filepath.Join(home, ".claude", historyDir)
}

// SubagentTranscripts lists <transcript minus .jsonl>/subagents/*.jsonl, sorted.
func SubagentTranscripts(transcriptPath string) ([]string, error) {
	dir := filepath.Join(strings.TrimSuffix(transcriptPath, transcriptExt), subagentsDir)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading subagent transcripts: %w", err)
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), transcriptExt) {
			out = append(out, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(out)
	return out, nil
}

// Parse reads the transcript and its subagent transcripts. Only the parent's records give pre-images:
// subagent transcripts carry no file-history records.
func Parse(transcriptPath, fileHistoryDir string) (*Log, error) {
	subs, err := SubagentTranscripts(transcriptPath)
	if err != nil {
		return nil, err
	}
	sessionID := strings.TrimSuffix(filepath.Base(transcriptPath), transcriptExt)
	p := &parser{
		log:     &Log{backupDir: filepath.Join(fileHistoryDir, sessionID), pre: map[string]backup{}},
		results: map[string]bool{},
		seen:    map[string]bool{},
	}
	for i, f := range append([]string{transcriptPath}, subs...) {
		if err := p.readFile(f, i == 0); err != nil {
			return nil, err
		}
	}
	p.resolve()
	return p.log, nil
}

type parser struct {
	log     *Log
	uses    []pending
	results map[string]bool // tool_use_id -> is_error
	seen    map[string]bool // tool_use ids already taken
	rawPre  []backup        // paths as recorded, resolved against SessionCwd at the end
	seq     int
}

func (p *parser) readFile(file string, parent bool) error {
	f, err := os.Open(file)
	if err != nil {
		return fmt.Errorf("reading transcript: %w", err)
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 64*1024)
	var cwd string
	var last time.Time
	for {
		ln, err := r.ReadBytes('\n')
		if len(bytes.TrimSpace(ln)) > 0 {
			var rec record
			if json.Unmarshal(ln, &rec) == nil {
				if rec.Cwd != "" {
					cwd = rec.Cwd
				}
				if ts, perr := time.Parse(time.RFC3339Nano, rec.Timestamp); perr == nil {
					last = ts
					if parent && p.log.SessionStart == 0 {
						p.log.SessionStart = ts.Unix()
					}
				}
				if parent && p.log.SessionCwd == "" && rec.Cwd != "" {
					p.log.SessionCwd = rec.Cwd
				}
				p.take(&rec, parent, cwd, last)
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reading transcript %s: %w", file, err)
		}
	}
}

func (p *parser) take(rec *record, parent bool, cwd string, ts time.Time) {
	switch rec.Type {
	case "file-history-delta":
		if parent && rec.Backup != nil && rec.TrackingPath != "" {
			p.rawPre = append(p.rawPre, backup{path: rec.TrackingPath, name: rec.Backup.BackupFileName, version: rec.Backup.Version})
		}
	case "file-history-snapshot":
		if parent && rec.Snapshot != nil {
			for tp, b := range rec.Snapshot.TrackedFileBackups {
				p.rawPre = append(p.rawPre, backup{path: tp, name: b.BackupFileName, version: b.Version})
			}
		}
	case "assistant", "user":
		// other record types (api-request-blob) echo tool_use blocks that are not the agent's calls
		for _, b := range contentBlocks(rec) {
			switch {
			case rec.Type == "assistant" && b.Type == "tool_use" && !p.seen[b.ID]:
				p.seen[b.ID] = true
				p.seq++
				p.uses = append(p.uses, pending{id: b.ID, name: b.Name, input: b.Input, cwd: cwd, ts: ts, seq: p.seq})
			case rec.Type == "user" && b.Type == "tool_result":
				p.results[b.ToolUseID] = b.IsError
			}
		}
	}
}

func contentBlocks(rec *record) []block {
	if rec.Message == nil || len(rec.Message.Content) == 0 || rec.Message.Content[0] != '[' {
		return nil
	}
	var blocks []block
	if json.Unmarshal(rec.Message.Content, &blocks) != nil {
		return nil
	}
	return blocks
}

func (p *parser) resolve() {
	l := p.log
	for _, b := range p.rawPre {
		b.path = absPath(b.path, l.SessionCwd)
		k := pathKey(b.path)
		if cur, ok := l.pre[k]; !ok || b.version < cur.version {
			l.pre[k] = b
		}
	}
	// a Bash call counts even when it failed or is still running: either may have changed files
	for _, u := range p.uses {
		if u.name == toolBash {
			l.BashCalls++
		}
	}
	sort.SliceStable(p.uses, func(i, j int) bool {
		if !p.uses[i].ts.Equal(p.uses[j].ts) {
			return p.uses[i].ts.Before(p.uses[j].ts)
		}
		return p.uses[i].seq < p.uses[j].seq
	})
	for _, u := range p.uses {
		if u.name != toolEdit && u.name != toolWrite && u.name != toolMultiEdit {
			continue
		}
		if isErr, done := p.results[u.id]; !done || isErr {
			continue
		}
		var in toolInput
		if json.Unmarshal(u.input, &in) != nil || in.FilePath == "" {
			continue
		}
		cwd := u.cwd
		if cwd == "" {
			cwd = l.SessionCwd
		}
		c := editCall{path: absPath(in.FilePath, cwd), ts: u.ts}
		switch u.name {
		case toolWrite:
			c.write, c.content = true, in.Content
		case toolEdit:
			c.edits = []editOp{in.editOp}
		case toolMultiEdit:
			c.edits = in.Edits
		}
		l.EditCalls++
		l.calls = append(l.calls, c)
	}
}

// absPath makes a recorded path absolute against cwd, with forward slashes.
func absPath(p, cwd string) string {
	p = strings.ReplaceAll(p, `\`, "/")
	if !filepath.IsAbs(filepath.FromSlash(p)) && cwd != "" {
		p = strings.ReplaceAll(cwd, `\`, "/") + "/" + p
	}
	return path.Clean(p)
}

// pathKey compares paths the way the filesystem does: case-insensitively on Windows.
func pathKey(p string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

// repoRel returns abs relative to root with forward slashes, or ok=false when it is outside root.
func repoRel(abs, root string) (string, bool) {
	root = strings.TrimSuffix(absPath(root, ""), "/")
	if len(abs) <= len(root)+1 || abs[len(root)] != '/' || pathKey(abs[:len(root)]) != pathKey(root) {
		return "", false
	}
	return abs[len(root)+1:], true
}

// Replay rebuilds each file the agent changed inside repoRoot. spell maps a repo-relative path onto the
// spelling every read and the result use (nil keeps it as recorded); base reads the file at the session start
// (for paths with no file-history record), worktree reads it now (for files changed outside the agent).
func Replay(l *Log, repoRoot string, spell func(string) string, base, worktree Reader) ([]File, error) {
	type group struct {
		rel   string
		key   string
		calls []editCall
	}
	groups := map[string]*group{}
	var order []*group
	for _, c := range l.calls {
		rel, ok := repoRel(c.path, repoRoot)
		if !ok {
			continue
		}
		if spell != nil {
			rel = spell(rel)
		}
		k := pathKey(rel)
		g := groups[k]
		if g == nil {
			g = &group{rel: rel, key: pathKey(c.path)}
			groups[k] = g
			order = append(order, g)
		}
		g.calls = append(g.calls, c)
	}
	sort.Slice(order, func(i, j int) bool { return order[i].rel < order[j].rel })
	var out []File
	for _, g := range order {
		f, err := l.replayFile(g.rel, g.key, g.calls, base, worktree)
		if err != nil {
			return nil, err
		}
		if f.PreExists || f.PostExists {
			out = append(out, f)
		}
	}
	return out, nil
}

func (l *Log) replayFile(rel, key string, calls []editCall, base, worktree Reader) (File, error) {
	f := File{Path: rel}
	if err := l.preImage(&f, key, base); err != nil {
		return f, err
	}
	cur, exists := f.Pre, f.PreExists
	for _, c := range calls {
		var ok bool
		if c.write {
			cur, exists, ok = []byte(c.content), true, true
		} else {
			cur, ok = applyEdits(cur, exists, c.edits)
			exists = exists || ok
		}
		if !ok {
			content, present, err := worktree(rel)
			if err != nil {
				return f, fmt.Errorf("reading %s from the working tree: %w", rel, err)
			}
			f.Post, f.PostExists, f.Flag = content, present, Outside
			return f, nil
		}
	}
	f.Post, f.PostExists = cur, exists
	return f, nil
}

func (l *Log) preImage(f *File, key string, base Reader) error {
	if b, ok := l.pre[key]; ok {
		if b.name == nil {
			return nil
		}
		content, err := os.ReadFile(filepath.Join(l.backupDir, *b.name))
		if err == nil {
			f.Pre, f.PreExists = content, true
			return nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("reading backup of %s: %w", f.Path, err)
		}
	}
	content, ok, err := base(f.Path)
	if err != nil {
		return fmt.Errorf("reading %s at session start: %w", f.Path, err)
	}
	f.Pre, f.PreExists, f.Flag = content, ok, Approximate
	return nil
}

// applyEdits replays Edit/MultiEdit the way Claude Code does: old_string matches LF-normalized content
// and the result keeps the file's line endings. ok=false when an edit cannot apply.
func applyEdits(content []byte, exists bool, edits []editOp) ([]byte, bool) {
	crlf := bytes.Contains(content, []byte("\r\n"))
	s := strings.ReplaceAll(string(content), "\r\n", "\n")
	for _, e := range edits {
		old := strings.ReplaceAll(e.OldString, "\r\n", "\n")
		repl := strings.ReplaceAll(e.NewString, "\r\n", "\n")
		if old == "" {
			// an empty old_string creates the file, and only an absent or empty one
			if exists && s != "" {
				return nil, false
			}
			s, exists = repl, true
			continue
		}
		if !exists {
			return nil, false
		}
		n := strings.Count(s, old)
		if n == 0 || (n > 1 && !e.ReplaceAll) {
			return nil, false
		}
		s = strings.ReplaceAll(s, old, repl)
	}
	if crlf {
		s = strings.ReplaceAll(s, "\n", "\r\n")
	}
	return []byte(s), true
}
