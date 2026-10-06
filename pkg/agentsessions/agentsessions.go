// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentsessions scans agent transcript JSONL on disk and returns lightweight,
// resumable per-session metadata for the Agent surfaces. Sibling to pkg/usagestats
// (which scans Claude files for token buckets).
package agentsessions

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/pisession"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	defaultWindowDays = 14
	defaultLimit      = 20
	maxTaskLen        = 120
)

// A session's first message is frequently scaffolding rather than anything a person wrote: the CLI
// wraps messages produced while a local command runs, a slash command arrives as a tag envelope, and a
// dispatched worker's prompt opens with the operator's principles. Titling a session with any of that
// tells the reader nothing, so sessionTitle unwraps to the text they would recognize.
const (
	caveatOpenTag        = "<local-command-caveat>"
	caveatCloseTag       = "</local-command-caveat>"
	dispatchPreambleLead = "Work by these principles"
	dispatchGoalPrefix   = "Goal: "
)

var (
	commandNameRe = regexp.MustCompile(`(?s)<command-name>(.*?)</command-name>`)
	commandArgsRe = regexp.MustCompile(`(?s)<command-args>(.*?)</command-args>`)
)

// sessionTitle unwraps a first user message into a human-recognizable title, returning "" when the
// message is pure scaffolding with no content of its own — the caller then tries the next message.
// The slash-command shape mirrors parseCommand in frontend/app/view/agents/transcriptprojection.ts so
// one session is not named two different things in two places.
func sessionTitle(raw string) string {
	t := strings.TrimSpace(raw)
	if t == "" {
		return ""
	}
	if strings.HasPrefix(t, caveatOpenTag) {
		// the caveat is boilerplate the CLI adds; the real message, if any, follows the closing tag
		if i := strings.Index(t, caveatCloseTag); i >= 0 {
			return sessionTitle(t[i+len(caveatCloseTag):])
		}
		return ""
	}
	if m := commandNameRe.FindStringSubmatch(t); m != nil {
		name := strings.TrimSpace(m[1])
		if name != "" && !strings.HasPrefix(name, "/") {
			name = "/" + name
		}
		if a := commandArgsRe.FindStringSubmatch(t); a != nil {
			if args := strings.TrimSpace(a[1]); args != "" {
				return strings.TrimSpace(name + " " + args)
			}
		}
		return name
	}
	if strings.HasPrefix(t, dispatchPreambleLead) {
		for _, line := range strings.Split(t, "\n") {
			if strings.HasPrefix(line, dispatchGoalPrefix) {
				if goal := strings.TrimSpace(strings.TrimPrefix(line, dispatchGoalPrefix)); goal != "" {
					return goal
				}
			}
		}
	}
	return t
}

// SessionInfo is one resumable past agent session.
type SessionInfo struct {
	ID            string // runtime resume key
	Runtime       string // "claude" | "codex" | "opencode" | "pi"
	ProjectPath   string // cwd
	ProjectName   string // last path segment of cwd
	Branch        string
	Task          string // first human prompt, trimmed
	Model         string // last assistant model seen
	TokensTotal   int
	CostUsd       float64
	LastActiveTs  int64    // file mtime, UnixMilli
	ResumeCommand string   // runtime resume invocation; empty means not resumable
	ResumeArgs    []string // exact argv to resume, when a tokenized command would not survive (pi)

	TranscriptPath string // on-disk JSONL path; FE matches this against the live roster
	Status         string // "done" | "waiting" (FE overlays "running" for live)
	StartedTs      int64  // first event ts, UnixMilli
	DurationMs     int64  // last event ts - first event ts
	Events         []SessionEvent
}

type claudeLine struct {
	Type        string        `json:"type"`
	AiTitle     string        `json:"aiTitle"`     // an ai-title record: Claude Code's running name for the session
	IsMeta      bool          `json:"isMeta"`      // a companion Claude Code writes beside a prompt (an image's size), no prompt itself
	IsSidechain bool          `json:"isSidechain"` // with Origin, whether a person sent the record (sentByPerson)
	Origin      *claudeOrigin `json:"origin"`
	Timestamp   string        `json:"timestamp"` // events derivation; session derivation ignores it
	Cwd         string        `json:"cwd"`
	GitBranch   string        `json:"gitBranch"`
	Entrypoint  string        `json:"entrypoint"`
	Message     struct {
		Model   string          `json:"model"`
		Content json.RawMessage `json:"content"`
		Usage   *struct {
			InputTokens              int `json:"input_tokens"`
			OutputTokens             int `json:"output_tokens"`
			CacheReadInputTokens     int `json:"cache_read_input_tokens"`
			CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
		} `json:"usage"`
	} `json:"message"`
}

// parseClaudeLines unmarshals a transcript's lines once; both derivations below consume the same
// slice so a scan never parses a file twice (extract + events used to each re-unmarshal every line).
func parseClaudeLines(lines []string) []claudeLine {
	recs := make([]claudeLine, 0, len(lines))
	for _, line := range lines {
		var rec claudeLine
		if json.Unmarshal([]byte(line), &rec) != nil {
			continue
		}
		recs = append(recs, rec)
	}
	return recs
}

// claudeSessionFrom folds one transcript into a session. folder is the name of the store folder it lives in, the slug
// of the directory Claude Code files it under (agentobserve.SlugifyCwd), "" when unknown.
func claudeSessionFrom(id, folder string, recs []claudeLine) *SessionInfo {
	s := &SessionInfo{ID: id}
	atHome := false
	hasTask := false
	fallback := ""
	aiTitle := ""
	for _, rec := range recs {
		if agentobserve.IsHeadlessEntrypoint(rec.Entrypoint) {
			return nil
		}
		if rec.Type == "ai-title" && strings.TrimSpace(rec.AiTitle) != "" {
			aiTitle = strings.TrimSpace(rec.AiTitle) // the last one is the session's current name
		}
		// the project is the cwd the store folder is named for: a session begun on another machine and resumed here
		// opens on that machine's checkout, but it is filed, and resumes, under this one. The first cwd stands in when
		// none matches the folder (a slug Claude Code shortened, or no folder known).
		if !atHome && rec.Cwd != "" && rec.Cwd != s.ProjectPath {
			atHome = folder != "" && strings.EqualFold(agentobserve.SlugifyCwd(rec.Cwd), folder)
			if atHome || s.ProjectPath == "" {
				s.ProjectPath = rec.Cwd
				s.ProjectName = filepath.Base(rec.Cwd)
			}
		}
		if s.Branch == "" && rec.GitBranch != "" {
			s.Branch = rec.GitBranch
		}
		if rec.Message.Model != "" {
			s.Model = rec.Message.Model // last assistant model wins
		}
		if rec.Message.Usage != nil {
			u := rec.Message.Usage
			s.TokensTotal += u.InputTokens + u.OutputTokens + u.CacheReadInputTokens + u.CacheCreationInputTokens
		}
		// only what a person sent titles a session: a file with none, such as the Agent tool's
		// <parent>/subagents/agent-<id>.jsonl, has no task and is no session
		if !hasTask && rec.Type == "user" && !rec.IsMeta && sentByPerson(rec.IsSidechain, rec.Origin) {
			// a prompt with a pasted image is array content (its text, then the image); claudePromptText reads both
			// shapes, and a tool result as none
			raw := claudePromptText(rec.Message.Content)
			if strings.HasPrefix(raw, "[Request interrupted by user") {
				continue
			}
			if title := sessionTitle(raw); title == "" {
				continue
			} else if isBareCommand(raw, title) {
				if fallback == "" {
					fallback = title
				}
			} else {
				s.Task = trimTo(title, maxTaskLen)
				hasTask = true
			}
		}
	}
	if !hasTask && fallback != "" {
		s.Task = trimTo(fallback, maxTaskLen)
		hasTask = true
	}
	if !hasTask {
		return nil
	}
	// Claude Code's own name for the session, the one its live row showed (wsh agent-hook reads the last ai-title
	// too), wins over the first prompt, which is often a /model switch or a pasted image. The prompt still decides
	// whether the file is a session at all.
	if aiTitle != "" {
		s.Task = trimTo(aiTitle, maxTaskLen)
	}
	return s
}

// isBareCommand reports a slash command with no arguments. /clear or /compact names what was done to the
// session rather than the work in it, so the first real prompt after it titles the session instead; the
// command is kept only when nothing follows it.
func isBareCommand(raw, title string) bool {
	return commandNameRe.MatchString(raw) && !strings.Contains(title, " ")
}

type claudeBlock struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	ID    string `json:"id"`
	Name  string `json:"name"`
	Input struct {
		Command   string `json:"command"`
		Questions []struct {
			Question string `json:"question"`
			Header   string `json:"header"`
		} `json:"questions"`
	} `json:"input"`
	ToolUseID string `json:"tool_use_id"`
	IsError   bool   `json:"is_error"`
}

func askText(b claudeBlock) string {
	if len(b.Input.Questions) > 0 {
		q := b.Input.Questions[0]
		if q.Question != "" {
			return clipText(q.Question)
		}
		if q.Header != "" {
			return clipText(q.Header)
		}
	}
	return "asked a question"
}

func claudeEventsFrom(recs []claudeLine) sessionEvents {
	var raw []SessionEvent
	cmdByID := map[string]string{}
	var firstTs, lastTs int64
	var firstUser, lastAssistant string
	for _, rec := range recs {
		if ts := parseTs(rec.Timestamp); ts > 0 {
			if firstTs == 0 {
				firstTs = ts
			}
			lastTs = ts
		}
		ts := parseTs(rec.Timestamp)
		switch rec.Type {
		case "assistant":
			var blocks []claudeBlock
			if json.Unmarshal(rec.Message.Content, &blocks) != nil {
				continue
			}
			for _, b := range blocks {
				switch b.Type {
				case "text":
					if strings.TrimSpace(b.Text) != "" {
						lastAssistant = b.Text
					}
				case "tool_use":
					cmd := b.Input.Command
					if b.ID != "" {
						if cmd != "" {
							cmdByID[b.ID] = cmd
						} else {
							cmdByID[b.ID] = b.Name
						}
					}
					if b.Name == "AskUserQuestion" {
						raw = append(raw, SessionEvent{Type: "asked", Ts: ts, Text: askText(b)})
					} else if b.Name == "Bash" && commitRe.MatchString(cmd) {
						raw = append(raw, SessionEvent{Type: "committed", Ts: ts, Text: commitSubject(cmd)})
					}
				}
			}
		case "user":
			var str string
			if json.Unmarshal(rec.Message.Content, &str) == nil {
				if firstUser == "" {
					firstUser = sessionTitle(str) // same unwrapping as the session title
				}
				continue
			}
			var blocks []claudeBlock
			if json.Unmarshal(rec.Message.Content, &blocks) != nil {
				continue
			}
			for _, b := range blocks {
				if b.Type == "text" && firstUser == "" {
					firstUser = sessionTitle(b.Text)
				}
				if b.Type == "tool_result" && b.IsError && b.ToolUseID != "" {
					cmd := cmdByID[b.ToolUseID]
					if cmd == "" {
						cmd = "a command"
					}
					raw = append(raw, SessionEvent{Type: "errored", Ts: ts, Text: "failed: " + clipText(cmd)})
				}
			}
		}
	}
	startedText := "started session"
	if firstUser != "" {
		startedText = clipText(firstUser)
	}
	finishedText := "finished"
	if lastAssistant != "" {
		finishedText = clipText(lastAssistant)
	}
	return assembleEvents(raw, firstTs, lastTs, startedText, finishedText)
}

type codexLine struct {
	Type    string `json:"type"`
	Payload struct {
		Type      string `json:"type"`
		SessionID string `json:"session_id"`
		Cwd       string `json:"cwd"`
		Model     string `json:"model"`
		Message   string `json:"message"`
		Git       struct {
			Branch string `json:"branch"`
		} `json:"git"`
	} `json:"payload"`
}

// extractCodexSession folds one Codex rollout file into a SessionInfo. The resume key is
// session_meta.session_id, not the filename stem. The task is the first event_msg/user_message.
func extractCodexSession(_ string, lines []string) *SessionInfo {
	s := &SessionInfo{}
	model := "codex"
	hasTask := false
	for _, line := range lines {
		var rec codexLine
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		switch rec.Type {
		case "session_meta":
			if rec.Payload.SessionID != "" {
				s.ID = rec.Payload.SessionID
			}
			if rec.Payload.Cwd != "" {
				s.ProjectPath = rec.Payload.Cwd
				s.ProjectName = filepath.Base(rec.Payload.Cwd)
			}
			if rec.Payload.Git.Branch != "" {
				s.Branch = rec.Payload.Git.Branch
			}
		case "turn_context":
			if rec.Payload.Model != "" {
				model = rec.Payload.Model // last turn_context model wins
			}
		case "event_msg":
			if rec.Payload.Type == "user_message" && !hasTask {
				if txt := strings.TrimSpace(rec.Payload.Message); txt != "" {
					s.Task = trimTo(txt, maxTaskLen)
					hasTask = true
				}
			}
		}
	}
	s.Model = model
	if s.ID == "" || !hasTask {
		return nil
	}
	return s
}

type codexEventLine struct {
	Type      string          `json:"type"`
	Timestamp string          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

type codexPayload struct {
	Type         string          `json:"type"`
	ThreadSource string          `json:"thread_source"`
	Role         string          `json:"role"`
	Name         string          `json:"name"`
	Arguments    string          `json:"arguments"`
	CallID       string          `json:"call_id"`
	Output       json.RawMessage `json:"output"`
	Content      []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

func codexShellCommand(argsRaw string) string {
	if argsRaw == "" {
		return ""
	}
	var a struct {
		Command string `json:"command"`
	}
	if json.Unmarshal([]byte(argsRaw), &a) != nil {
		return ""
	}
	return a.Command
}

func codexOutputIsError(raw json.RawMessage) bool {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return false // ported TS only inspects string output
	}
	if m := exitCodeRe.FindStringSubmatch(s); m != nil {
		return m[1] != "0"
	}
	var p struct {
		Metadata struct {
			ExitCode *int `json:"exit_code"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(s), &p) == nil && p.Metadata.ExitCode != nil {
		return *p.Metadata.ExitCode != 0
	}
	return false
}

// extractCodexEvents ports frontend/app/view/agents/activityevents.ts:extractCodexEvents.
func extractCodexEvents(lines []string) sessionEvents {
	var raw []SessionEvent
	cmdByID := map[string]string{}
	var firstTs, lastTs int64
	var firstUser, lastAssistant string
	isSubagent := false
	for _, line := range lines {
		var rec codexEventLine
		if json.Unmarshal([]byte(line), &rec) != nil {
			continue
		}
		if ts := parseTs(rec.Timestamp); ts > 0 {
			if firstTs == 0 {
				firstTs = ts
			}
			lastTs = ts
		}
		ts := parseTs(rec.Timestamp)
		var p codexPayload
		if len(rec.Payload) == 0 || json.Unmarshal(rec.Payload, &p) != nil {
			continue
		}
		if rec.Type == "session_meta" {
			if p.ThreadSource == "subagent" {
				isSubagent = true
			}
			continue
		}
		if rec.Type != "response_item" {
			continue
		}
		switch p.Type {
		case "message":
			for _, b := range p.Content {
				if p.Role == "assistant" && b.Type == "output_text" && strings.TrimSpace(b.Text) != "" {
					lastAssistant = b.Text
				}
				if p.Role == "user" && b.Type == "input_text" && firstUser == "" && strings.TrimSpace(b.Text) != "" &&
					!strings.HasPrefix(b.Text, "<environment_context") && !strings.HasPrefix(b.Text, "<skill>") {
					firstUser = b.Text
				}
			}
		case "function_call":
			cmd := codexShellCommand(p.Arguments)
			if p.CallID != "" {
				if cmd != "" {
					cmdByID[p.CallID] = cmd
				} else {
					cmdByID[p.CallID] = p.Name
				}
			}
			if p.Name == "shell_command" && commitRe.MatchString(cmd) {
				raw = append(raw, SessionEvent{Type: "committed", Ts: ts, Text: commitSubject(cmd)})
			}
		case "function_call_output", "custom_tool_call_output":
			if p.CallID != "" && codexOutputIsError(p.Output) {
				cmd := cmdByID[p.CallID]
				if cmd == "" {
					cmd = "a command"
				}
				raw = append(raw, SessionEvent{Type: "errored", Ts: ts, Text: "failed: " + clipText(cmd)})
			}
		}
	}
	if isSubagent {
		return sessionEvents{Status: "done"}
	}
	startedText := "started session"
	if firstUser != "" {
		startedText = clipText(firstUser)
	}
	finishedText := "finished"
	if lastAssistant != "" {
		finishedText = clipText(lastAssistant)
	}
	return assembleEvents(raw, firstTs, lastTs, startedText, finishedText)
}

// stringContent returns trimmed text when message.content is a plain string (a human prompt).
// Returns "" for array content (tool results) or anything else.
func stringContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var str string
	if err := json.Unmarshal(raw, &str); err == nil {
		return strings.TrimSpace(str)
	}
	return ""
}

// trimTo caps s at max runes — slicing the byte string could split a multi-byte rune into
// replacement chars in the cockpit row; clipText is the sibling that got this right.
func trimTo(s string, max int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	if max <= 1 {
		return "…"
	}
	return strings.TrimSpace(string(r[:max-1])) + "…"
}

// SessionEvent is one lifecycle event extracted from a transcript (ported from
// frontend/app/view/agents/activityevents.ts). Type ∈ started|asked|committed|errored|finished.
type SessionEvent struct {
	Type string `json:"type"`
	Ts   int64  `json:"ts"`
	Text string `json:"text"`
}

// sessionEvents is an extractor's full result: the ordered events plus derived summary fields.
type sessionEvents struct {
	Events     []SessionEvent
	Status     string
	StartedTs  int64
	DurationMs int64
}

const maxEventText = 100

var (
	wsRe        = regexp.MustCompile(`\s+`)
	commitRe    = regexp.MustCompile(`\bgit\s+commit\b`)
	commitMsgRe = regexp.MustCompile(`-m\s+["']([^"']+)["']`)
	exitCodeRe  = regexp.MustCompile(`Exit code:\s*(\d+)`)
)

// clipText collapses whitespace, trims, and caps at maxEventText runes with an ellipsis.
func clipText(s string) string {
	s = strings.TrimSpace(wsRe.ReplaceAllString(s, " "))
	r := []rune(s)
	if len(r) > maxEventText {
		return strings.TrimSpace(string(r[:maxEventText-1])) + "…"
	}
	return s
}

// parseTs parses an ISO-8601 timestamp to UnixMilli, or 0 when absent/unparseable.
func parseTs(s string) int64 {
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func commitSubject(cmd string) string {
	if m := commitMsgRe.FindStringSubmatch(cmd); m != nil {
		return clipText(m[1])
	}
	return "committed"
}

// assembleEvents sorts the raw events, derives status from the last real event, prepends a synthetic
// "started" and (only for done sessions) appends a synthetic "finished", and computes duration.
// a tool error does not fail a session: agents recover from nearly all of them, and a transcript scan
// found the rest were almost all the user rejecting a call or a known client-side timeout.
func assembleEvents(raw []SessionEvent, firstTs, lastTs int64, startedText, finishedText string) sessionEvents {
	var real []SessionEvent
	for _, e := range raw {
		if e.Ts > 0 {
			real = append(real, e)
		}
	}
	sort.SliceStable(real, func(i, j int) bool { return real[i].Ts < real[j].Ts })

	status := "done"
	if n := len(real); n > 0 {
		if real[n-1].Type == "asked" {
			status = "waiting"
		}
	}

	var events []SessionEvent
	if firstTs > 0 {
		events = append(events, SessionEvent{Type: "started", Ts: firstTs, Text: startedText})
	}
	events = append(events, real...)
	if status == "done" && lastTs > 0 {
		events = append(events, SessionEvent{Type: "finished", Ts: lastTs, Text: finishedText})
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].Ts < events[j].Ts })

	var dur int64
	if firstTs > 0 && lastTs > firstTs {
		dur = lastTs - firstTs
	}
	return sessionEvents{Events: events, Status: status, StartedTs: firstTs, DurationMs: dur}
}

// readLines reads non-blank lines from a transcript file. A package var so tests can assert
// scanProvider's read-count invariant (only the newest candidates' content is read).
var readLines = func(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var lines []string
	for _, ln := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(ln) != "" {
			lines = append(lines, ln)
		}
	}
	return lines
}

type provider struct {
	runtime   string
	root      string
	matches   func(name string) bool
	skipDir   func(name string) bool // a folder the walk never enters; nil enters every one
	fused     func(path, stem string, lines []string) (*SessionInfo, sessionEvents)
	resumeCmd func(s *SessionInfo) string
}

func claudeProvider(root string) provider {
	return provider{
		runtime: "claude",
		root:    root,
		matches: func(name string) bool { return strings.HasSuffix(name, ".jsonl") },
		// the Agent tool's <parent>/subagents/agent-<id>.jsonl is part of its parent and never a session of its own
		// (claudeSessionFrom drops it), yet those files were a third of a cold scan's bytes
		skipDir: func(name string) bool { return name == "subagents" },
		// one shared unmarshal pass for both derivations — claude transcripts dominate the scan cost
		fused: func(path string, id string, lines []string) (*SessionInfo, sessionEvents) {
			recs := parseClaudeLines(lines)
			s := claudeSessionFrom(id, filepath.Base(filepath.Dir(path)), recs)
			if s == nil {
				return nil, sessionEvents{}
			}
			return s, claudeEventsFrom(recs)
		},
		resumeCmd: func(s *SessionInfo) string { return "claude --resume " + s.ID },
	}
}

func codexProvider(root string) provider {
	return provider{
		runtime: "codex",
		root:    root,
		matches: func(name string) bool {
			return strings.HasPrefix(name, "rollout-") && strings.HasSuffix(name, ".jsonl")
		},
		// codex's session/event passes parse different payload shapes, so fusing would cost the same
		// two unmarshals per line; its files are small, sequential is fine
		fused: func(_ string, _ string, lines []string) (*SessionInfo, sessionEvents) {
			s := extractCodexSession("", lines)
			if s == nil {
				return nil, sessionEvents{}
			}
			return s, extractCodexEvents(lines)
		},
		resumeCmd: func(s *SessionInfo) string { return "codex resume " + s.ID },
	}
}

// opencodeProvider scans opencode's native storage. root is the storage root (…/opencode/storage);
// walkCandidates walks its session subdir. fused resolves the sibling message/part dirs by
// session id, which is the info-file filename stem.
func opencodeProvider(storageRoot string) provider {
	return provider{
		runtime: "opencode",
		root:    filepath.Join(storageRoot, "session"),
		matches: func(name string) bool {
			return strings.HasPrefix(name, "ses_") && strings.HasSuffix(name, ".json")
		},
		fused: func(path, stem string, lines []string) (*SessionInfo, sessionEvents) {
			data := loadOpencodeSession(path)
			s := extractOpencodeSession(stem, lines, data)
			if s == nil {
				return nil, sessionEvents{}
			}
			return s, extractOpencodeEvents(data)
		},
		resumeCmd: func(s *SessionInfo) string { return "opencode -s " + s.ID },
	}
}

// storageRootOf derives the storage root from an opencode session-info path
// (<root>/session/<projectID>/<sessionID>.json).
func storageRootOf(path string) string {
	return filepath.Dir(filepath.Dir(filepath.Dir(path)))
}

// opencodeSessionData bundles a session's message + part files, loaded once so the session and
// event derivations share one walk of the message dir and cache part loads by message — they
// previously re-read both dirs per candidate.
type opencodeSessionData struct {
	root      string
	sessionID string
	messages  []opencodeMsg
	parts     map[string][]opencodePart
}

// loadOpencodeSession resolves a session-info path's message files; parts load lazily via partsFor
// so subagent-only sessions (the dominant file class) never pay the part walk.
func loadOpencodeSession(path string) *opencodeSessionData {
	root := storageRootOf(path)
	sessionID := strings.TrimSuffix(filepath.Base(path), ".json")
	return &opencodeSessionData{
		root:      root,
		sessionID: sessionID,
		messages:  opencodeMessages(filepath.Join(root, "message", sessionID)),
		parts:     map[string][]opencodePart{},
	}
}

// partsFor returns a message's parts, loaded on first use and cached for the shared derivation.
func (d *opencodeSessionData) partsFor(id string) []opencodePart {
	if ps, ok := d.parts[id]; ok {
		return ps
	}
	ps := opencodeParts(d.root, id)
	d.parts[id] = ps
	return ps
}

type opencodeMsg struct {
	ID         string  `json:"id"`
	Role       string  `json:"role"`
	ProviderID string  `json:"providerID"`
	ModelID    string  `json:"modelID"`
	Cost       float64 `json:"cost"`
	Tokens     struct {
		Input     int `json:"input"`
		Output    int `json:"output"`
		Reasoning int `json:"reasoning"`
		Cache     struct {
			Read  int `json:"read"`
			Write int `json:"write"`
		} `json:"cache"`
	} `json:"tokens"`
	Time struct {
		Created int64 `json:"created"`
	} `json:"time"`
}

// opencodeMessages returns a session's message files, oldest-first by creation time.
func opencodeMessages(dir string) []opencodeMsg {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []opencodeMsg
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var m opencodeMsg
		if json.Unmarshal(b, &m) != nil || m.ID == "" {
			continue
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Time.Created < out[j].Time.Created })
	return out
}

type opencodePart struct {
	Type      string `json:"type"`
	Text      string `json:"text"`
	Tool      string `json:"tool"`
	Synthetic bool   `json:"synthetic"`
	State     struct {
		Status string `json:"status"`
		Input  struct {
			Command string `json:"command"`
		} `json:"input"`
		Metadata struct {
			Exit *int `json:"exit"`
		} `json:"metadata"`
	} `json:"state"`
	Cost   float64 `json:"cost"`
	Tokens struct {
		Input     int `json:"input"`
		Output    int `json:"output"`
		Reasoning int `json:"reasoning"`
		Cache     struct {
			Read  int `json:"read"`
			Write int `json:"write"`
		} `json:"cache"`
	} `json:"tokens"`
}

// opencodeParts returns a message's part files, in filename order.
func opencodeParts(root, messageID string) []opencodePart {
	dir := filepath.Join(root, "part", messageID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []opencodePart
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var p opencodePart
		if json.Unmarshal(b, &p) != nil || p.Type == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

// extractOpencodeSession folds one session info file + its message/part siblings into a
// SessionInfo. The resume key is the info-file stem. The task is the first user text part. Assistant
// messages carry their own top-level provider/model id, cost, and token classes (current OpenCode
// storage shape), so the model and usage sums come from assistant message metadata while parts remain
// the source for user text and lifecycle events. Returns nil when the session has no human task (a
// subagent-only session isn't resumable).
func extractOpencodeSession(sessionID string, lines []string, data *opencodeSessionData) *SessionInfo {
	s := &SessionInfo{ID: sessionID}
	for _, line := range lines {
		var info struct {
			Directory string `json:"directory"`
		}
		if json.Unmarshal([]byte(line), &info) != nil {
			continue
		}
		if info.Directory != "" {
			s.ProjectPath = info.Directory
			s.ProjectName = filepath.Base(info.Directory)
		}
	}
	hasTask := false
	for _, m := range data.messages {
		if m.Role == "assistant" && m.ProviderID != "" {
			s.Model = m.ProviderID + "/" + m.ModelID // last assistant model wins
		}
		if m.Role == "assistant" {
			t := m.Tokens
			s.TokensTotal += t.Input + t.Output + t.Reasoning + t.Cache.Read + t.Cache.Write
			s.CostUsd += m.Cost
		}
		if !hasTask && m.Role == "user" {
			if task := firstUserText(data.partsFor(m.ID)); task != "" {
				s.Task = trimTo(task, maxTaskLen)
				hasTask = true
			}
		}
	}
	if !hasTask {
		return nil
	}
	return s
}

// firstUserText returns the first non-empty, non-environment text part of a user message.
func firstUserText(parts []opencodePart) string {
	for _, p := range parts {
		if p.Type != "text" || strings.TrimSpace(p.Text) == "" || p.Synthetic {
			continue
		}
		if strings.HasPrefix(p.Text, "<environment_context") {
			continue
		}
		return p.Text
	}
	return ""
}

// extractOpencodeEvents derives lifecycle events from a session's stored parts: first user text ->
// started, last assistant text -> finished, a failed bash tool -> errored, a git commit -> committed.
func extractOpencodeEvents(data *opencodeSessionData) sessionEvents {
	var raw []SessionEvent
	var firstTs, lastTs int64
	var firstUser, lastAssistant string
	for _, m := range data.messages {
		if ts := m.Time.Created; ts > 0 {
			if firstTs == 0 {
				firstTs = ts
			}
			lastTs = ts
		}
		for _, p := range data.partsFor(m.ID) {
			switch {
			case m.Role == "user" && p.Type == "text" && firstUser == "" && !p.Synthetic &&
				!strings.HasPrefix(p.Text, "<environment_context") && strings.TrimSpace(p.Text) != "":
				firstUser = clipText(p.Text)
			case m.Role == "assistant" && p.Type == "text" && strings.TrimSpace(p.Text) != "":
				lastAssistant = clipText(p.Text)
			case p.Type == "tool" && p.Tool == "bash" && commitRe.MatchString(p.State.Input.Command):
				raw = append(raw, SessionEvent{Type: "committed", Ts: m.Time.Created, Text: commitSubject(p.State.Input.Command)})
			case p.Type == "tool" && p.State.Metadata.Exit != nil && *p.State.Metadata.Exit != 0:
				cmd := p.State.Input.Command
				if cmd == "" {
					cmd = "a command"
				}
				raw = append(raw, SessionEvent{Type: "errored", Ts: m.Time.Created, Text: "failed: " + clipText(cmd)})
			}
		}
	}
	startedText := "started session"
	if firstUser != "" {
		startedText = firstUser
	}
	finishedText := "finished"
	if lastAssistant != "" {
		finishedText = lastAssistant
	}
	return assembleEvents(raw, firstTs, lastTs, startedText, finishedText)
}

// piProvider scans Pi's native session storage. root is …/pi/agent/sessions; walkCandidates walks its
// encoded-cwd subdirs (lossy, never decoded — the v3 session header's cwd is authoritative). fused
// parses the v3 file once (pisession) and threads it through both derivations, so a pi candidate
// costs one read+parse instead of three. The full native file path is the resume key, so the FE
// resumes via ResumeArgs (exact argv; the path must never be re-tokenized out of ResumeCommand).
func piProvider(root string) provider {
	return provider{
		runtime: "pi",
		root:    root,
		matches: func(name string) bool { return strings.HasSuffix(name, ".jsonl") },
		fused: func(path, _ string, _ []string) (*SessionInfo, sessionEvents) {
			file, err := pisession.Read(path)
			if err != nil {
				log.Printf("agentsessions: skipping malformed pi session %q: %v", path, err)
				return nil, sessionEvents{}
			}
			s := extractPiSession(file, path)
			if s == nil {
				return nil, sessionEvents{}
			}
			return s, extractPiEvents(file)
		},
		resumeCmd: func(s *SessionInfo) string { return "pi --session " + s.TranscriptPath },
	}
}

// extractPiSession folds one parsed Pi v3 session file into a SessionInfo. The header is authoritative for
// id/cwd/timestamp. The task/model come from the active parent branch only — abandoned siblings never
// win — with the latest active session_info.name taking priority over the first active user text.
// TokensTotal sums every billed record (usage present), abandoned branches included.
func extractPiSession(file *pisession.File, path string) *SessionInfo {
	branch, err := file.ActiveBranch()
	if err != nil {
		log.Printf("agentsessions: skipping pi session %q: %v", path, err)
		return nil
	}
	s := &SessionInfo{
		ID:             file.Header.ID,
		Runtime:        "pi",
		ProjectPath:    file.Header.Cwd,
		ProjectName:    filepath.Base(file.Header.Cwd),
		TranscriptPath: path,
		ResumeCommand:  "pi --session " + path,
		ResumeArgs:     []string{"--session", path},
	}
	title, firstUser := piBranchMeta(branch)
	task := title
	if task == "" {
		task = firstUser
	}
	if task == "" {
		return nil // no human task: nothing worth resuming
	}
	s.Task = trimTo(task, maxTaskLen)
	for _, e := range file.Entries {
		if e.Usage == nil {
			continue
		}
		s.TokensTotal += e.Usage.TotalTokens
	}
	for _, e := range branch {
		if e.ModelID == "" {
			continue
		}
		if e.Provider != "" {
			s.Model = e.Provider + "/" + e.ModelID // last active model wins
		} else {
			s.Model = e.ModelID
		}
	}
	return s
}

// piBranchMeta folds the active parent chain into a display task: the latest session_info.name wins,
// else the first active user message's text. Both are only ever read off the active branch, so an
// abandoned sibling's title or text cannot leak into this session's task.
func piBranchMeta(branch []pisession.Entry) (title, firstUser string) {
	for _, e := range branch {
		if e.Type == "session_info" && strings.TrimSpace(e.Name) != "" {
			title = strings.TrimSpace(e.Name)
		}
	}
	if title != "" {
		return title, ""
	}
	for _, e := range branch {
		if txt := piUserText(e.Message); txt != "" {
			return "", txt
		}
	}
	return "", ""
}

// piUserText returns the first human text of a Pi message record, or "" when the record is not a user
// message (tool results, assistant turns). Content may be a plain string or an array of blocks.
func piUserText(raw json.RawMessage) string {
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

// extractPiEvents derives lifecycle events from a parsed Pi session file. Pi v3 carries no lifecycle
// event stream, so the surface gets a synthetic "started" anchored on the header timestamp.
func extractPiEvents(file *pisession.File) sessionEvents {
	branch, err := file.ActiveBranch()
	if err != nil {
		return sessionEvents{}
	}
	title, firstUser := piBranchMeta(branch)
	startedText := "started session"
	if title != "" {
		startedText = clipText(title)
	} else if firstUser != "" {
		startedText = clipText(firstUser)
	}
	ts := parseTs(file.Header.Timestamp)
	var events []SessionEvent
	if ts > 0 {
		events = append(events, SessionEvent{Type: "started", Ts: ts, Text: startedText})
	}
	return sessionEvents{Events: events, Status: "done", StartedTs: ts}
}

// candidate is one transcript file found by the stat-only walk; content is read later, only as far
// as the limit requires.
type candidate struct {
	path  string
	stem  string
	mtime time.Time
	size  int64
	p     provider
}

// walkCandidates collects a provider's candidate files within the window (stat only — no content).
func walkCandidates(p provider, windowDays int) []candidate {
	var cutoff time.Time
	if windowDays > 0 {
		cutoff = time.Now().AddDate(0, 0, -windowDays-1)
	}
	var cands []candidate
	headlessSlug := agentobserve.HeadlessAgentSlug()
	_ = filepath.WalkDir(p.root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if headlessSlug != "" && d.Name() == headlessSlug {
				return filepath.SkipDir // the backend's own headless passes, never a user session
			}
			if p.skipDir != nil && p.skipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !p.matches(d.Name()) {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return nil
		}
		if !cutoff.IsZero() && info.ModTime().Before(cutoff) {
			return nil
		}
		cands = append(cands, candidate{path: path, stem: strings.TrimSuffix(strings.TrimSuffix(d.Name(), ".jsonl"), ".json"), mtime: info.ModTime(), size: info.Size(), p: p})
		return nil
	})
	sort.Slice(cands, func(i, j int) bool { return cands[i].mtime.After(cands[j].mtime) })
	return cands
}

// scanCacheEntry pins a parsed candidate to its on-disk state. Transcripts only change by append, so
// mtime+size equality means the cached derivation is still the file's. A nil info caches a file that
// carries no session (subagent/tool-only) — those dominate the candidate set and must not be re-read
// on every scan.
type scanCacheEntry struct {
	mtime time.Time
	size  int64
	info  *SessionInfo // nil = parsed, but not a session
	se    sessionEvents
}

var (
	scanCacheMu sync.Mutex
	scanCache   = map[string]scanCacheEntry{}
)

// scanCacheMax bounds cache memory; clearing all when full is cheaper than LRU bookkeeping and only
// costs a re-parse of the hot set.
const scanCacheMax = 4096

// scanSessionCached derives one candidate's session, reusing the cache while the file is unchanged.
func scanSessionCached(c candidate) (*SessionInfo, sessionEvents) {
	scanCacheMu.Lock()
	e, ok := scanCache[c.path]
	scanCacheMu.Unlock()
	if ok && e.mtime.Equal(c.mtime) && e.size == c.size {
		return e.info, e.se
	}
	lines := readLines(c.path)
	s, se := c.p.fused(c.path, c.stem, lines)
	scanCacheMu.Lock()
	if len(scanCache) >= scanCacheMax {
		clear(scanCache)
	}
	scanCache[c.path] = scanCacheEntry{mtime: c.mtime, size: c.size, info: s, se: se}
	scanCacheMu.Unlock()
	return s, se
}

// parseWorkers bounds how many candidates are parsed at once. A cold scan (the first after wavesrv starts) parses a
// few hundred MB of JSON, which is CPU-bound; each worker holds a whole transcript, up to tens of MB, while it does.
var parseWorkers = min(runtime.GOMAXPROCS(0), 8)

// parseCandidates derives sessions from candidates in mtime order until limit sessions are found
// (nil candidates do not count, so the parse set can exceed limit when non-session files interleave).
// A session whose cwd is under tempDir is a throwaway run (a test, a scratchpad), never history anyone
// resumes, so it is dropped and does not count either.
// Candidates are parsed in parallel batches, each the size of what the limit still needs, so the files read are the
// same newest ones a one-at-a-time scan would read.
func parseCandidates(cands []candidate, limit int, tempDir string) []SessionInfo {
	var out []SessionInfo
	for next := 0; next < len(cands); {
		n := len(cands) - next
		if limit > 0 {
			if len(out) >= limit {
				break
			}
			n = min(n, limit-len(out))
		}
		batch := cands[next : next+n]
		next += n
		for i, r := range parseBatch(batch) {
			if s := asSession(batch[i], r); s != nil && !isUnderDir(s.ProjectPath, tempDir) {
				out = append(out, *s)
			}
		}
	}
	return out
}

type parsed struct {
	info *SessionInfo
	se   sessionEvents
}

// parseBatch derives every candidate in batch on up to parseWorkers goroutines, its results in batch order.
func parseBatch(batch []candidate) []parsed {
	results := make([]parsed, len(batch))
	idx := make(chan int)
	var wg sync.WaitGroup
	for range min(parseWorkers, len(batch)) {
		wg.Go(func() {
			for i := range idx {
				results[i].info, results[i].se = scanSessionCached(batch[i])
			}
		})
	}
	for i := range batch {
		idx <- i
	}
	close(idx)
	wg.Wait()
	return results
}

// asSession is a candidate's parsed result as a listed session, or nil when the file carries none.
func asSession(c candidate, r parsed) *SessionInfo {
	if r.info == nil {
		return nil
	}
	// value copy: the cache holds the canonical entry; callers may not mutate it
	s := *r.info
	s.Runtime = c.p.runtime
	s.LastActiveTs = c.mtime.UnixMilli()
	s.ResumeCommand = c.p.resumeCmd(&s)
	s.TranscriptPath = c.path
	s.Events = r.se.Events
	s.Status = r.se.Status
	s.StartedTs = r.se.StartedTs
	s.DurationMs = r.se.DurationMs
	return &s
}

// ExtractSession folds a single transcript file into a SessionInfo, selecting the parser by runtime.
// Returns (nil, nil) when the file carries no session (e.g. a tool-only subagent file). Reuses the
// same fused derivation the scanner uses, so status/summary derivation cannot drift from the Agent surfaces.
func ExtractSession(path, runtime string) (*SessionInfo, error) {
	var p provider
	switch runtime {
	case "claude":
		p = claudeProvider("")
	case "codex":
		p = codexProvider("")
	case "opencode":
		p = opencodeProvider("")
	case "pi":
		p = piProvider("")
	default:
		return nil, fmt.Errorf("agentsessions: unknown runtime %q", runtime)
	}
	lines := readLines(path)
	// strip .jsonl then .json so a claude/codex path (foo.jsonl) keeps its stem and an opencode
	// session-info path (ses_x.json) is trimmed too.
	stem := strings.TrimSuffix(strings.TrimSuffix(filepath.Base(path), ".jsonl"), ".json")
	s, se := p.fused(path, stem, lines)
	if s == nil {
		return nil, nil
	}
	s.Runtime = runtime
	s.TranscriptPath = path
	s.Events = se.Events
	s.Status = se.Status
	s.StartedTs = se.StartedTs
	s.DurationMs = se.DurationMs
	return s, nil
}

// ScanSessions lists recent resumable sessions across runtime providers, newest-first.
// windowDays<=0 and limit<=0 fall back to the package defaults.
func ScanSessions(windowDays, limit int) ([]SessionInfo, error) {
	if windowDays <= 0 {
		windowDays = defaultWindowDays
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	return scanProviders(allProviders(), windowDays, limit, os.TempDir()), nil
}

// allProviders lists the four runtime transcript roots under the home dir.
func allProviders() []provider {
	home := wavebase.GetHomeDir()
	opencodeRoot := filepath.Join(home, ".local", "share", "opencode", "storage")
	return []provider{
		claudeProvider(filepath.Join(home, ".claude", "projects")),
		codexProvider(filepath.Join(home, ".codex", "sessions")),
		opencodeProvider(opencodeRoot),
		piProvider(filepath.Join(home, ".pi", "agent", "sessions")),
	}
}

// SessionRoot returns the on-disk root a runtime writes its transcripts under, or "" for a runtime
// this package cannot read. Exported so other scanners (the orchestrate liveness probe) locate a
// runtime's sessions from the definition allProviders already owns instead of keeping a second copy
// of these paths.
func SessionRoot(runtime string) string {
	for _, p := range allProviders() {
		if p.runtime == runtime {
			return p.root
		}
	}
	return ""
}

// TranscriptForSession returns the transcript a runtime writes for a session launched with --session-id
// under root, or "" when it has not been written yet or the runtime has no such launch. claude names the
// file by the id inside the projects dir for its cwd; SlugifyCwd is lossy, so every projects dir is tried
// when that one misses. pi puts its start timestamp before the id, in a dir it derives from the cwd.
func TranscriptForSession(root, runtime, cwd, sessionId string) string {
	if root == "" || sessionId == "" {
		return ""
	}
	var pattern string
	switch runtime {
	case "claude":
		path := filepath.Join(root, agentobserve.SlugifyCwd(cwd), sessionId+".jsonl")
		if _, err := os.Stat(path); err == nil {
			return path
		}
		pattern = filepath.Join(root, "*", sessionId+".jsonl")
	case "pi":
		pattern = filepath.Join(root, "*", "*_"+sessionId+".jsonl")
	default:
		return ""
	}
	// Glob only fails on a malformed pattern, which a root holding glob syntax would be; nothing matches it
	matches, _ := filepath.Glob(pattern)
	if len(matches) == 0 {
		return ""
	}
	return matches[0]
}

// scanProviders merges every provider's candidates before parsing, so the limit is the global newest
// sessions across runtimes — a provider that writes many files cannot crowd other runtimes' recent
// sessions out of the parse set by quota alone.
func scanProviders(providers []provider, windowDays, limit int, tempDir string) []SessionInfo {
	var cands []candidate
	for _, p := range providers {
		cands = append(cands, walkCandidates(p, windowDays)...)
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].mtime.After(cands[j].mtime) })
	out := parseCandidates(cands, limit, tempDir)
	sort.Slice(out, func(i, j int) bool { return out[i].LastActiveTs > out[j].LastActiveTs })
	return out
}
