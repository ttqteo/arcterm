// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// agy (Antigravity CLI) keeps one folder per conversation under ~/.gemini/antigravity-cli/brain, whose
// .system_generated/logs/transcript_full.jsonl holds one JSON step per line. The transcript has no cwd and no
// title; ~/.gemini/antigravity-cli/conversation_summaries.db has both. This file reads that database, so it is
// only reached from wavesrv: wsh is built without cgo and never lists sessions. Nothing `wsh agy-hook` calls may
// import it.

const (
	agyTranscriptName = "transcript_full.jsonl"
	agySummariesName  = "conversation_summaries.db"
)

// agyTranscriptPath is where agy writes a conversation's transcript under the brain root.
func agyTranscriptPath(brainRoot, id string) string {
	return filepath.Join(brainRoot, id, ".system_generated", "logs", agyTranscriptName)
}

// agyIDOf names the conversation a transcript path belongs to: the brain child directory three levels above the
// file. ok is false for a transcript_full.jsonl that sits anywhere else.
func agyIDOf(path string) (id, brainRoot string, ok bool) {
	logs := filepath.Dir(path)
	gen := filepath.Dir(logs)
	conv := filepath.Dir(gen)
	if filepath.Base(path) != agyTranscriptName || filepath.Base(logs) != "logs" || filepath.Base(gen) != ".system_generated" {
		return "", "", false
	}
	if id = filepath.Base(conv); id == "" || id == "." || id == string(filepath.Separator) {
		return "", "", false
	}
	return id, filepath.Dir(conv), true
}

// agySummary is the part of a conversation_summaries row the history list shows.
type agySummary struct {
	Title      string
	Cwd        string
	ModifiedMs int64
}

// agySummariesFor reads the summaries database. A seam so a test can count reads or skip SQLite.
var agySummariesFor = agySummaries

// agySummaries reads every row of the summaries database at dbPath, read-only, and closes it.
func agySummaries(dbPath string) (map[string]agySummary, error) {
	if _, err := os.Stat(dbPath); err != nil {
		return nil, err // mode=ro never creates the file, but a stat gives the plain error
	}
	uri := (&url.URL{Scheme: "file", Path: "/" + strings.TrimPrefix(filepath.ToSlash(dbPath), "/"), RawQuery: "mode=ro&_busy_timeout=2000"}).String()
	db, err := sql.Open("sqlite3", uri)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT conversation_id, title, workspace_uris, last_modified_time FROM conversation_summaries`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]agySummary{}
	for rows.Next() {
		var id string
		var title, uris sql.NullString
		var modified any
		if err := rows.Scan(&id, &title, &uris, &modified); err != nil {
			return nil, err
		}
		out[id] = agySummary{Title: strings.TrimSpace(title.String), Cwd: agyCwdFromURIs(uris.String), ModifiedMs: agyDBTime(modified)}
	}
	return out, rows.Err()
}

// agyCwdFromURIs is the last workspace_uris entry as a native path: --add-dir puts its directories in front of the
// launch cwd, which is last.
func agyCwdFromURIs(raw string) string {
	var uris []string
	if json.Unmarshal([]byte(raw), &uris) != nil || len(uris) == 0 {
		return ""
	}
	return fileURIToPath(uris[len(uris)-1])
}

// fileURIToPath turns file:///Users/x/My%20Project into /Users/x/My Project, and file:///C:/Users/x into C:\Users\x
// on Windows. Anything that is not a file URI gives "".
func fileURIToPath(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "file" {
		return ""
	}
	p := u.Path // already percent-decoded
	if runtime.GOOS == "windows" {
		if len(p) >= 3 && p[0] == '/' && p[2] == ':' {
			p = p[1:]
		} else if u.Host != "" && u.Host != "localhost" {
			p = "//" + u.Host + p
		}
	}
	return filepath.FromSlash(p)
}

// agyDBTime reads last_modified_time whatever type the column came back as: a time, epoch seconds or
// milliseconds, or text holding either an RFC 3339 time or a number. 0 when it is none of those.
func agyDBTime(v any) int64 {
	switch t := v.(type) {
	case time.Time:
		return t.UnixMilli()
	case int64:
		return epochToMs(float64(t))
	case float64:
		return epochToMs(t)
	case []byte:
		return agyDBTime(string(t))
	case string:
		t = strings.TrimSpace(t)
		if ms := parseTs(t); ms > 0 {
			return ms
		}
		if f, err := strconv.ParseFloat(t, 64); err == nil {
			return epochToMs(f)
		}
	}
	return 0
}

// epochToMs reads a bare number as seconds, or as milliseconds once it is too large to be seconds.
func epochToMs(n float64) int64 {
	if n <= 0 {
		return 0
	}
	if n > 1e11 {
		return int64(n)
	}
	return int64(n * 1000)
}

// agyScanState holds one scan's read of the summaries database. beginScan clears it, so the database is read at
// most once per scan (and not at all when every conversation is a scan-cache hit).
type agyScanState struct {
	mu   sync.Mutex
	byDB map[string]map[string]agySummary
}

func (st *agyScanState) begin() {
	st.mu.Lock()
	st.byDB = nil
	st.mu.Unlock()
}

// lookup is the summary row for a conversation, and whether there is one.
func (st *agyScanState) lookup(dbPath, id string) (agySummary, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	rows, loaded := st.byDB[dbPath]
	if !loaded {
		var err error
		if rows, err = agySummariesFor(dbPath); err != nil {
			log.Printf("agentsessions: agy summaries %q: %v (titles fall back to the first request)", dbPath, err)
			rows = nil
		}
		if st.byDB == nil {
			st.byDB = map[string]map[string]agySummary{}
		}
		st.byDB[dbPath] = rows // a failed read is kept as nil: logged once, not retried within the scan
	}
	s, ok := rows[id]
	return s, ok
}

// agyProvider scans agy's conversations. root is …/antigravity-cli/brain. The session id is the brain child
// directory, so fused takes it from the path (the stem is always "transcript_full") and finds the summaries
// database beside brain/.
func agyProvider(root string) provider {
	st := &agyScanState{}
	return provider{
		runtime: "agy",
		root:    root,
		matches: func(name string) bool { return name == agyTranscriptName },
		fused: func(path, _ string, lines []string) (*SessionInfo, sessionEvents) {
			id, brain, ok := agyIDOf(path)
			if !ok {
				return nil, sessionEvents{}
			}
			meta, _ := st.lookup(filepath.Join(filepath.Dir(brain), agySummariesName), id)
			steps := parseAgySteps(lines)
			s := agySessionFrom(id, meta, steps)
			if s == nil {
				return nil, sessionEvents{}
			}
			return s, agyEventsFrom(steps, meta.Title)
		},
		resumeCmd: func(s *SessionInfo) string { return "agy --conversation " + s.ID },
		beginScan: st.begin,
	}
}

// agyStep is one transcript line. Fields agy adds later are ignored; a line that does not parse is dropped.
type agyStep struct {
	Type            string          `json:"type"`
	Status          string          `json:"status"`
	CreatedAt       string          `json:"created_at"`
	Content         json.RawMessage `json:"content"`
	InputTokens     int             `json:"input_tokens"`
	OutputTokens    int             `json:"output_tokens"`
	CacheReadTokens int             `json:"cache_read_tokens"`
	ToolCalls       []agyToolCall   `json:"tool_calls"`
	text            string          // Content as a string, set by parseAgySteps for the types that read it
}

type agyToolCall struct {
	Name string `json:"name"`
	Args struct {
		CommandLine string `json:"CommandLine"`
	} `json:"args"`
}

// parseAgySteps unmarshals a transcript once. A line that is not JSON, or whose fields have a shape this reader
// does not know, is skipped rather than failing the session; so is a tool call that does not parse.
func parseAgySteps(lines []string) []agyStep {
	steps := make([]agyStep, 0, len(lines))
	for _, line := range lines {
		var st agyStep
		if err := json.Unmarshal([]byte(line), &st); err != nil {
			var shallow struct {
				Type      string          `json:"type"`
				Status    string          `json:"status"`
				CreatedAt string          `json:"created_at"`
				Content   json.RawMessage `json:"content"`
			}
			// a step whose tool_calls (or token fields) changed shape still carries a prompt or an answer
			if json.Unmarshal([]byte(line), &shallow) != nil {
				continue
			}
			st = agyStep{Type: shallow.Type, Status: shallow.Status, CreatedAt: shallow.CreatedAt, Content: shallow.Content}
		}
		if st.Type == "USER_INPUT" || st.Type == "PLANNER_RESPONSE" {
			st.text = stringContent(st.Content)
		}
		st.Content = nil // a GENERIC step can hold a megabyte of command output; nothing below reads it
		steps = append(steps, st)
	}
	return steps
}

var (
	agyRequestRe       = regexp.MustCompile(`(?s)<USER_REQUEST>\n?(.*)</USER_REQUEST>`)
	agyMetadataBlockRe = regexp.MustCompile(`(?s)<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>.*?</(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>`)
)

// agyRequestText is what the person typed in a USER_INPUT step: the USER_REQUEST body when agy wrapped it, else the
// content with its metadata blocks removed. "" for a step that carries only metadata.
func agyRequestText(content string) string {
	if m := agyRequestRe.FindStringSubmatch(content); m != nil {
		return strings.TrimSpace(m[1])
	}
	return strings.TrimSpace(agyMetadataBlockRe.ReplaceAllString(content, ""))
}

// agyHumanPrompts is each USER_INPUT step's request, oldest first.
func agyHumanPrompts(steps []agyStep) []HumanPrompt {
	var out []HumanPrompt
	for _, st := range steps {
		if st.Type != "USER_INPUT" {
			continue
		}
		if text := agyRequestText(st.text); text != "" {
			out = append(out, HumanPrompt{Ts: parseTs(st.CreatedAt), Text: text})
		}
	}
	return out
}

// agyLastAnswer is the content of the last PLANNER_RESPONSE that has some; a response that only called tools has none.
func agyLastAnswer(steps []agyStep) (string, int64) {
	for i := len(steps) - 1; i >= 0; i-- {
		if steps[i].Type != "PLANNER_RESPONSE" {
			continue
		}
		if text := strings.TrimSpace(steps[i].text); text != "" {
			return text, parseTs(steps[i].CreatedAt)
		}
	}
	return "", 0
}

// agySessionFrom folds a conversation into a SessionInfo. meta is the summaries row, zero when there is none: the
// title then comes from the first request, the cwd stays empty and the time stays the file's.
func agySessionFrom(id string, meta agySummary, steps []agyStep) *SessionInfo {
	s := &SessionInfo{ID: id, Runtime: "agy", ProjectPath: meta.Cwd, LastActiveTs: meta.ModifiedMs}
	if meta.Cwd != "" {
		s.ProjectName = filepath.Base(meta.Cwd)
	}
	task := meta.Title
	if prompts := agyHumanPrompts(steps); task == "" && len(prompts) > 0 {
		task = prompts[0].Text
	}
	if task == "" {
		return nil // no title and no request: nothing worth resuming
	}
	s.Task = trimTo(task, maxTaskLen)
	for _, st := range steps {
		if st.Type == "PLANNER_RESPONSE" {
			s.TokensTotal += st.InputTokens + st.OutputTokens + st.CacheReadTokens
		}
	}
	return s
}

// agyEventsFrom derives the lifecycle events: started on the first request, committed for a git commit the model
// ran, errored for a step that failed, finished on the last step.
func agyEventsFrom(steps []agyStep, title string) sessionEvents {
	var raw []SessionEvent
	var firstTs, lastTs int64
	firstUser := ""
	for _, st := range steps {
		ts := parseTs(st.CreatedAt)
		if ts > 0 {
			if firstTs == 0 {
				firstTs = ts
			}
			lastTs = ts
		}
		switch st.Type {
		case "USER_INPUT":
			if firstUser == "" {
				firstUser = clipText(agyRequestText(st.text))
			}
		case "PLANNER_RESPONSE":
			for _, call := range st.ToolCalls {
				if call.Name == "run_command" && commitRe.MatchString(call.Args.CommandLine) {
					raw = append(raw, SessionEvent{Type: "committed", Ts: ts, Text: commitSubject(call.Args.CommandLine)})
				}
			}
		}
		if st.Status == "ERROR" {
			raw = append(raw, SessionEvent{Type: "errored", Ts: ts, Text: "a step failed"})
		}
	}
	startedText := "started session"
	if title != "" {
		startedText = clipText(title)
	} else if firstUser != "" {
		startedText = firstUser
	}
	finishedText := "finished"
	if answer, _ := agyLastAnswer(steps); answer != "" {
		finishedText = clipText(answer)
	}
	return assembleEvents(raw, firstTs, lastTs, startedText, finishedText)
}
