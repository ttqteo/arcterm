// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

const (
	agyConvA = "11111111-aaaa-4aaa-8aaa-111111111111"
	agyConvB = "22222222-bbbb-4bbb-8bbb-222222222222"
	agyConvC = "33333333-cccc-4ccc-8ccc-333333333333"
)

// agyUserInput is a USER_INPUT step the way agy wraps a prompt: the request, then metadata blocks.
func agyUserInput(idx int, at, request string) string {
	content := "<USER_REQUEST>\n" + request + "\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: " + at + "\n</ADDITIONAL_METADATA>"
	return agyLine(map[string]any{"step_index": idx, "source": "USER_EXPLICIT", "type": "USER_INPUT", "status": "DONE", "created_at": at, "content": content})
}

func agyPlanner(idx int, at, content string, toolNames ...string) string {
	step := map[string]any{"step_index": idx, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": at,
		"input_tokens": 10, "output_tokens": 5, "cache_read_tokens": 2}
	if content != "" {
		step["content"] = content
	}
	var calls []map[string]any
	for _, n := range toolNames {
		calls = append(calls, map[string]any{"name": n, "args": map[string]any{}})
	}
	if calls != nil {
		step["tool_calls"] = calls
	}
	return agyLine(step)
}

func agyLine(step map[string]any) string {
	b, err := json.Marshal(step)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// writeAgyConversation writes <brain>/<id>/.system_generated/logs/transcript_full.jsonl.
func writeAgyConversation(t *testing.T, brain, id string, lines []string) string {
	t.Helper()
	path := filepath.Join(brain, id, ".system_generated", "logs", "transcript_full.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

type agyRow struct {
	id, title, uris string
	modified        any
}

// writeAgySummaries builds conversation_summaries.db beside brain/, as agy lays it out.
func writeAgySummaries(t *testing.T, antigravityDir string, rows []agyRow) {
	t.Helper()
	db, err := sql.Open("sqlite3", filepath.Join(antigravityDir, "conversation_summaries.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INTEGER, last_modified_time, workspace_uris TEXT, status TEXT)`); err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if _, err := db.Exec(`INSERT INTO conversation_summaries (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status) VALUES (?, ?, '', 3, ?, ?, 'CASCADE_RUN_STATUS_IDLE')`,
			r.id, r.title, r.modified, r.uris); err != nil {
			t.Fatal(err)
		}
	}
}

func scanAgy(t *testing.T, brain string) []SessionInfo {
	t.Helper()
	return scanProviders([]provider{agyProvider(brain)}, 0, 0, t.TempDir())
}

func agySessionByID(t *testing.T, sessions []SessionInfo, id string) SessionInfo {
	t.Helper()
	for _, s := range sessions {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("session %s not listed in %+v", id, sessions)
	return SessionInfo{}
}

func TestAgyProviderListsConversationsWithDBTitleAndCwd(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "My Antigravity #1") // a path with a space and a # must still open as a SQLite URI
	brain := filepath.Join(dir, "brain")
	pathA := writeAgyConversation(t, brain, agyConvA, []string{
		agyUserInput(0, "2026-10-08T01:00:00Z", "fix the login bug"),
		agyPlanner(1, "2026-10-08T01:00:05Z", "Fixed it."),
	})
	writeAgyConversation(t, brain, agyConvB, []string{
		agyUserInput(0, "2026-10-08T02:00:00Z", "add a settings page"),
		agyPlanner(1, "2026-10-08T02:00:05Z", "Added."),
	})
	// a desktop-app migration: a summary row with no transcript under brain/
	writeAgySummaries(t, dir, []agyRow{
		{agyConvA, "Fix login", `["file:///Users/x/other","file:///Users/x/repo"]`, "2026-10-08T01:00:09Z"},
		{agyConvB, "Settings page", `["file:///Users/x/My%20Project"]`, "2026-10-08T02:00:09Z"},
		{agyConvC, "Migrated", `["file:///Users/x/old"]`, "2026-10-01T00:00:00Z"},
	})

	got := scanAgy(t, brain)
	if len(got) != 2 {
		t.Fatalf("listed %d sessions, want 2 (the migrated row has no transcript): %+v", len(got), got)
	}
	a := agySessionByID(t, got, agyConvA)
	if a.Task != "Fix login" || a.ProjectPath != "/Users/x/repo" || a.ProjectName != "repo" {
		t.Errorf("A = task %q path %q name %q; want the DB title and the last workspace", a.Task, a.ProjectPath, a.ProjectName)
	}
	if a.Runtime != "agy" || a.TranscriptPath != pathA || a.ResumeCommand != "agy --conversation "+agyConvA {
		t.Errorf("A = runtime %q transcript %q resume %q", a.Runtime, a.TranscriptPath, a.ResumeCommand)
	}
	if a.TokensTotal != 17 { // input + output + cache reads, as claude counts them
		t.Errorf("A tokens = %d, want 17", a.TokensTotal)
	}
	if want := time.Date(2026, 10, 8, 1, 0, 9, 0, time.UTC).UnixMilli(); a.LastActiveTs != want {
		t.Errorf("A last active = %d, want the DB's last_modified_time %d", a.LastActiveTs, want)
	}
	// Review focus 3: a URI with %20 shows the decoded path
	b := agySessionByID(t, got, agyConvB)
	if b.ProjectPath != "/Users/x/My Project" || b.ProjectName != "My Project" {
		t.Errorf("B path %q name %q; want the decoded /Users/x/My Project", b.ProjectPath, b.ProjectName)
	}
}

func TestAgyProviderWithoutADatabaseFallsBackToTheFirstRequest(t *testing.T) {
	brain := filepath.Join(t.TempDir(), "brain")
	path := writeAgyConversation(t, brain, agyConvA, []string{
		agyUserInput(0, "2026-10-08T01:00:00Z", "fix the login bug"),
		agyPlanner(1, "2026-10-08T01:00:05Z", "Fixed it."),
	})
	got := scanAgy(t, brain)
	if len(got) != 1 {
		t.Fatalf("listed %d sessions, want 1", len(got))
	}
	s := got[0]
	if s.Task != "fix the login bug" || s.ProjectPath != "" {
		t.Errorf("task %q path %q; want the first request and no cwd", s.Task, s.ProjectPath)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if s.LastActiveTs != info.ModTime().UnixMilli() {
		t.Errorf("last active %d, want the file mtime %d", s.LastActiveTs, info.ModTime().UnixMilli())
	}
}

func TestAgyProviderFallsBackForAConversationWithNoRow(t *testing.T) {
	dir := t.TempDir()
	brain := filepath.Join(dir, "brain")
	writeAgyConversation(t, brain, agyConvA, []string{agyUserInput(0, "2026-10-08T01:00:00Z", "write the docs")})
	writeAgySummaries(t, dir, []agyRow{{agyConvB, "Other", `["file:///Users/x/repo"]`, "2026-10-08T01:00:09Z"}})
	got := scanAgy(t, brain)
	if len(got) != 1 || got[0].Task != "write the docs" || got[0].ProjectPath != "" {
		t.Fatalf("got %+v; want the first request and no cwd", got)
	}
}

func TestAgyProviderReadsTheDatabaseOncePerScan(t *testing.T) {
	dir := t.TempDir()
	brain := filepath.Join(dir, "brain")
	writeAgyConversation(t, brain, agyConvA, []string{agyUserInput(0, "2026-10-08T01:00:00Z", "one")})
	writeAgyConversation(t, brain, agyConvB, []string{agyUserInput(0, "2026-10-08T02:00:00Z", "two")})
	reads := 0
	orig := agySummariesFor
	agySummariesFor = func(path string) (map[string]agySummary, error) { reads++; return orig(path) }
	t.Cleanup(func() { agySummariesFor = orig })
	scanAgy(t, brain)
	if reads != 1 {
		t.Fatalf("summaries read %d times for one scan of two conversations, want 1", reads)
	}
}

func TestAgyProviderIgnoresTheLossyTranscriptCopy(t *testing.T) {
	brain := filepath.Join(t.TempDir(), "brain")
	path := writeAgyConversation(t, brain, agyConvA, []string{agyUserInput(0, "2026-10-08T01:00:00Z", "real")})
	lossy := filepath.Join(filepath.Dir(path), "transcript.jsonl")
	if err := os.WriteFile(lossy, []byte(agyUserInput(0, "2026-10-08T01:00:00Z", "lossy")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// and a transcript_full.jsonl that is not at <id>/.system_generated/logs/ is not a conversation
	stray := filepath.Join(brain, "stray", "transcript_full.jsonl")
	if err := os.MkdirAll(filepath.Dir(stray), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stray, []byte(agyUserInput(0, "2026-10-08T01:00:00Z", "stray")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := scanAgy(t, brain)
	if len(got) != 1 || got[0].Task != "real" {
		t.Fatalf("got %+v; want only the one transcript_full.jsonl conversation", got)
	}
}

// Review focus 5: a line agy adds later (an unknown type) or makes huge (a 2 MiB GENERIC step) never stops the scan.
func TestAgyProviderSurvivesHugeAndUnknownLines(t *testing.T) {
	brain := filepath.Join(t.TempDir(), "brain")
	huge := agyLine(map[string]any{"step_index": 2, "source": "MODEL", "type": "GENERIC", "status": "DONE",
		"created_at": "2026-10-08T01:00:06Z", "content": strings.Repeat("x", 2<<20)})
	path := writeAgyConversation(t, brain, agyConvA, []string{
		agyUserInput(0, "2026-10-08T01:00:00Z", "survive"),
		agyLine(map[string]any{"step_index": 1, "type": "SOMETHING_NEW", "created_at": "2026-10-08T01:00:03Z", "content": "?"}),
		huge,
		"{not json",
		agyPlanner(3, "2026-10-08T01:00:09Z", "still here"),
	})
	got := scanAgy(t, brain)
	if len(got) != 1 || got[0].Task != "survive" {
		t.Fatalf("got %+v; want the session listed", got)
	}
	if got[0].TokensTotal != 17 {
		t.Errorf("tokens = %d, want 17 from the planner step after the huge line", got[0].TokensTotal)
	}
	if text, _ := LastAnswer(path, "agy"); text != "still here" {
		t.Errorf("LastAnswer = %q after a huge line", text)
	}
	if prompts := HumanPrompts(path, "agy"); len(prompts) != 1 || prompts[0].Text != "survive" {
		t.Errorf("HumanPrompts = %+v after a huge line", prompts)
	}
}

func TestExtractSessionAgyReadsItsDatabaseBesideBrain(t *testing.T) {
	dir := t.TempDir()
	brain := filepath.Join(dir, "brain")
	path := writeAgyConversation(t, brain, agyConvA, []string{
		agyUserInput(0, "2026-10-08T01:00:00Z", "fix the login bug"),
		agyPlanner(1, "2026-10-08T01:00:05Z", "Fixed it."),
	})
	writeAgySummaries(t, dir, []agyRow{{agyConvA, "Fix login", `["file:///Users/x/repo"]`, "2026-10-08T01:00:09Z"}})
	s, err := ExtractSession(path, "agy")
	if err != nil || s == nil {
		t.Fatalf("ExtractSession = %v, %v", s, err)
	}
	if s.ID != agyConvA || s.Task != "Fix login" || s.ProjectPath != "/Users/x/repo" || s.Runtime != "agy" {
		t.Errorf("got id %q task %q path %q runtime %q", s.ID, s.Task, s.ProjectPath, s.Runtime)
	}
	if len(s.Events) == 0 || s.Events[0].Type != "started" {
		t.Errorf("events = %+v, want a started event first", s.Events)
	}
}

func TestSessionRootAgy(t *testing.T) {
	root := SessionRoot("agy")
	if filepath.Base(root) != "brain" || filepath.Base(filepath.Dir(root)) != "antigravity-cli" {
		t.Fatalf("SessionRoot(agy) = %q, want <home>/.gemini/antigravity-cli/brain", root)
	}
}

func TestTranscriptForSessionAgy(t *testing.T) {
	brain := t.TempDir()
	want := touchTranscript(t, filepath.Join(brain, agyConvA, ".system_generated", "logs", "transcript_full.jsonl"))
	if got := TranscriptForSession(brain, "agy", "/ignored", agyConvA); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if got := TranscriptForSession(brain, "agy", "/ignored", agyConvB); got != "" {
		t.Errorf("an unwritten conversation gave %q, want \"\"", got)
	}
}

func TestHumanPromptsAgyStripsMetadataBlocks(t *testing.T) {
	content := "<USER_REQUEST>\n  Which color? Chọn màu\nsecond line\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nmode changed\n</USER_SETTINGS_CHANGE>\n<ADDITIONAL_METADATA>\nnow\n</ADDITIONAL_METADATA>"
	path := writeTranscript(t, []string{
		agyLine(map[string]any{"step_index": 0, "type": "USER_INPUT", "created_at": "2026-10-08T01:00:00Z", "content": content}),
		agyPlanner(1, "2026-10-08T01:00:05Z", "ok"),
		agyUserInput(2, "2026-10-08T01:01:00Z", "second prompt"),
		agyLine(map[string]any{"step_index": 3, "type": "USER_INPUT", "created_at": "2026-10-08T01:02:00Z", "content": "<ADDITIONAL_METADATA>\nonly metadata\n</ADDITIONAL_METADATA>"}),
	})
	got := HumanPrompts(path, "agy")
	if len(got) != 2 {
		t.Fatalf("got %+v, want 2 prompts", got)
	}
	if got[0].Text != "Which color? Chọn màu\nsecond line" || got[0].Ts != time.Date(2026, 10, 8, 1, 0, 0, 0, time.UTC).UnixMilli() {
		t.Errorf("first prompt = %+v", got[0])
	}
	if got[1].Text != "second prompt" {
		t.Errorf("second prompt = %+v", got[1])
	}
}

func TestLastAnswerAgySkipsAToolOnlyResponse(t *testing.T) {
	path := writeTranscript(t, []string{
		agyUserInput(0, "2026-10-08T01:00:00Z", "do it"),
		agyPlanner(1, "2026-10-08T01:00:05Z", "the real answer"),
		agyPlanner(2, "2026-10-08T01:00:09Z", "", "run_command"),
	})
	text, ts := LastAnswer(path, "agy")
	if text != "the real answer" || ts != time.Date(2026, 10, 8, 1, 0, 5, 0, time.UTC).UnixMilli() {
		t.Fatalf("LastAnswer = %q, %d", text, ts)
	}
	empty := writeTranscript(t, []string{agyUserInput(0, "2026-10-08T01:00:00Z", "do it")})
	if text, ts := LastAnswer(empty, "agy"); text != "" || ts != 0 {
		t.Fatalf("no answer yet gave %q, %d", text, ts)
	}
}
