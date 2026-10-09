// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"bytes"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
)

func writeJSONL(t *testing.T, dir, name string, lines ...string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// recordReads swaps readLines for one that records the name of each file it reads, from any goroutine, and returns a
// func giving the reads so far in name order: candidates are parsed in parallel, so the order they are read in is not
// fixed.
func recordReads(t *testing.T) func() []string {
	t.Helper()
	orig := readLines
	var mu sync.Mutex
	var reads []string
	readLines = func(path string) []string {
		mu.Lock()
		reads = append(reads, filepath.Base(path))
		mu.Unlock()
		return orig(path)
	}
	t.Cleanup(func() { readLines = orig })
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		out := slices.Clone(reads)
		slices.Sort(out)
		return out
	}
}

func TestScanRoot_parsesAndSortsNewestFirst(t *testing.T) {
	dir := t.TempDir()
	writeJSONL(t, dir, "sess-a.jsonl",
		`{"type":"user","cwd":"/home/me/payments-api","gitBranch":"feat/auth","message":{"role":"user","content":"Fix the auth race"}}`,
		`{"type":"assistant","message":{"model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}`,
	)
	older := writeJSONL(t, dir, "sess-b.jsonl",
		`{"type":"user","cwd":"/home/me/web","gitBranch":"main","message":{"role":"user","content":"Add a button"}}`,
	)
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(older, old, old); err != nil {
		t.Fatal(err)
	}

	got := scanProvider(claudeProvider(dir), 0, 10)
	if len(got) != 2 {
		t.Fatalf("want 2 sessions, got %d", len(got))
	}
	if got[0].ID != "sess-a" {
		t.Errorf("want newest sess-a first, got %q", got[0].ID)
	}
	if got[0].Task != "Fix the auth race" {
		t.Errorf("task = %q", got[0].Task)
	}
	if got[0].ProjectName != "payments-api" {
		t.Errorf("projectName = %q", got[0].ProjectName)
	}
	if got[0].Branch != "feat/auth" {
		t.Errorf("branch = %q", got[0].Branch)
	}
	if got[0].Model != "claude-opus-4-8" {
		t.Errorf("model = %q", got[0].Model)
	}
	if got[0].TokensTotal != 15 {
		t.Errorf("tokensTotal = %d", got[0].TokensTotal)
	}
	if got[0].Runtime != "claude" {
		t.Errorf("runtime = %q", got[0].Runtime)
	}
	if got[0].ResumeCommand != "claude --resume sess-a" {
		t.Errorf("resumeCommand = %q", got[0].ResumeCommand)
	}
}

// A session begun on another machine and resumed here keeps its first records' cwd (the other machine's checkout),
// while Claude Code files the transcript under the folder it is resumed in. The session belongs to that folder's
// directory, the one cwd whose slug is the folder name; the first cwd stands only when none matches.
func TestScanRoot_projectIsTheCwdOfItsTranscriptFolder(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, agentobserve.SlugifyCwd("/home/me/my-project"))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeJSONL(t, dir, "moved.jsonl",
		`{"type":"user","cwd":"/Users/me/mac/report","message":{"role":"user","content":"Evaluate the dataset"}}`,
		`{"type":"user","cwd":"/Users/me/mac/report/paper","message":{"role":"user","content":"and the paper"}}`,
		`{"type":"user","cwd":"/home/me/my-project","message":{"role":"user","content":"resumed here"}}`,
		`{"type":"user","cwd":"/home/me/my-project/paper","message":{"role":"user","content":"in a subfolder"}}`,
	)
	writeJSONL(t, dir, "elsewhere.jsonl",
		`{"type":"user","cwd":"/srv/other","message":{"role":"user","content":"no cwd matches the folder"}}`,
	)
	got := map[string]SessionInfo{}
	for _, s := range scanProvider(claudeProvider(root), 0, 10) {
		got[s.ID] = s
	}
	if s := got["moved"]; s.ProjectPath != "/home/me/my-project" || s.ProjectName != "my-project" {
		t.Errorf("moved: project = %q (%q), want /home/me/my-project (my-project)", s.ProjectPath, s.ProjectName)
	}
	if s := got["elsewhere"]; s.ProjectPath != "/srv/other" || s.ProjectName != "other" {
		t.Errorf("elsewhere: project = %q (%q), want the first cwd /srv/other", s.ProjectPath, s.ProjectName)
	}
}

func TestScanRoot_skipsFilesWithoutHumanPrompt(t *testing.T) {
	dir := t.TempDir()
	// content is an array (a tool result), not a human string prompt
	writeJSONL(t, dir, "toolonly.jsonl",
		`{"type":"user","cwd":"/x","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}`,
		`{"type":"assistant","message":{"model":"claude-opus-4-8"}}`,
	)
	if got := scanProvider(claudeProvider(dir), 0, 10); len(got) != 0 {
		t.Fatalf("want 0 (no human prompt), got %d", len(got))
	}
}

// A subagent the Agent tool starts writes <parent>/subagents/agent-<id>.jsonl, every record isSidechain; its first
// is the task its parent gave it, which no person typed, so it is part of its parent and not a session of its own.
// A parent that carries sidechain records inline is still titled by what its person typed.
func TestScanRoot_skipsSubagentTranscripts(t *testing.T) {
	dir := t.TempDir()
	writeJSONL(t, dir, "parent.jsonl",
		`{"type":"user","isSidechain":true,"cwd":"/x","message":{"role":"user","content":"You are the SPEC COMPLIANCE reviewer for Task 3"}}`,
		`{"type":"user","cwd":"/x","message":{"role":"user","content":"Build the uploads list"}}`,
	)
	sub := filepath.Join(dir, "parent", "subagents")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	writeJSONL(t, sub, "agent-a3f6fcb8fdd0390b8.jsonl",
		`{"type":"user","isSidechain":true,"agentId":"a3f6fcb8fdd0390b8","cwd":"/x","message":{"role":"user","content":"You are implementing **Task 28: The Uploads list**"}}`,
		`{"type":"assistant","isSidechain":true,"message":{"model":"claude-opus-4-8"}}`,
	)
	reads := recordReads(t)
	got := scanProvider(claudeProvider(dir), 0, 10)
	if len(got) != 1 || got[0].ID != "parent" || got[0].Task != "Build the uploads list" {
		t.Fatalf("want only the parent, titled by its own prompt, got %+v", got)
	}
	// a third of a real scan's bytes were subagent files parsed only to be dropped: the walk skips their folder
	if r := reads(); !reflect.DeepEqual(r, []string{"parent.jsonl"}) {
		t.Errorf("a subagents folder must not be read, read %v", r)
	}
}

// Claude Code writes a background task finishing as a user record stamped with its own origin; no person typed it, so
// it titles nothing: a session it opens is titled by the first prompt after it, and one with no prompt is no session.
func TestScanRoot_titlesOnlyWhatAPersonSent(t *testing.T) {
	dir := t.TempDir()
	notice := `{"type":"user","cwd":"/x","origin":{"kind":"task-notification","producer":"session-task"},"message":{"role":"user","content":"<task-notification>\n<task-id>bcj8gg197</task-id>\n</task-notification>"}}`
	writeJSONL(t, dir, "continued.jsonl", notice,
		`{"type":"user","cwd":"/x","origin":{"kind":"human"},"message":{"role":"user","content":"Tighten section 3"}}`,
	)
	writeJSONL(t, dir, "noticeonly.jsonl", notice)
	got := scanProvider(claudeProvider(dir), 0, 10)
	if len(got) != 1 || got[0].ID != "continued" || got[0].Task != "Tighten section 3" {
		t.Fatalf("want only the continued session, titled by its prompt, got %+v", got)
	}
}

func TestScanRoot_capsToLimit(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"a", "b", "c"} {
		writeJSONL(t, dir, n+".jsonl", `{"type":"user","cwd":"/x","message":{"content":"hi `+n+`"}}`)
	}
	if got := scanProvider(claudeProvider(dir), 0, 2); len(got) != 2 {
		t.Fatalf("cap: want 2, got %d", len(got))
	}
}

func TestScanRoot_readsOnlyNewestUpToLimit(t *testing.T) {
	dir := t.TempDir()
	mk := func(name string, agoHours int) {
		p := writeJSONL(t, dir, name, `{"type":"user","cwd":"/x","message":{"content":"hi `+name+`"}}`)
		ts := time.Now().Add(-time.Duration(agoHours) * time.Hour)
		if err := os.Chtimes(p, ts, ts); err != nil {
			t.Fatal(err)
		}
	}
	mk("new.jsonl", 1)
	mk("mid.jsonl", 2)
	mk("old.jsonl", 3)

	// instrument content reads: only the newest `limit` files should be read, not all 3.
	reads := recordReads(t)

	got := scanProvider(claudeProvider(dir), 0, 2)
	if len(got) != 2 || got[0].ID != "new" || got[1].ID != "mid" {
		t.Fatalf("want newest [new mid], got %+v", got)
	}
	if r := reads(); !reflect.DeepEqual(r, []string{"mid.jsonl", "new.jsonl"}) {
		t.Errorf("want only the newest 2 read (newest up to limit), read %v", r)
	}
}

// A file that is no session does not count toward the limit, so the scan reads past it, and only as far as the limit
// still needs: here one more file, never the oldest.
func TestScanRoot_readsPastNonSessionsOnlyAsFarAsNeeded(t *testing.T) {
	dir := t.TempDir()
	mk := func(name, content string, agoHours int) {
		p := writeJSONL(t, dir, name, content)
		ts := time.Now().Add(-time.Duration(agoHours) * time.Hour)
		if err := os.Chtimes(p, ts, ts); err != nil {
			t.Fatal(err)
		}
	}
	mk("new.jsonl", `{"type":"user","cwd":"/x","message":{"content":"hi new"}}`, 1)
	mk("toolonly.jsonl", `{"type":"user","cwd":"/x","message":{"content":[{"type":"tool_result","content":"ok"}]}}`, 2)
	mk("mid.jsonl", `{"type":"user","cwd":"/x","message":{"content":"hi mid"}}`, 3)
	mk("old.jsonl", `{"type":"user","cwd":"/x","message":{"content":"hi old"}}`, 4)
	reads := recordReads(t)

	got := scanProvider(claudeProvider(dir), 0, 2)
	if len(got) != 2 || got[0].ID != "new" || got[1].ID != "mid" {
		t.Fatalf("want [new mid], got %+v", got)
	}
	if r := reads(); !reflect.DeepEqual(r, []string{"mid.jsonl", "new.jsonl", "toolonly.jsonl"}) {
		t.Errorf("want the newest files up to the limit plus the non-session between them, read %v", r)
	}
}

// Parsing is CPU-bound and a cold scan parses hundreds of MB, so candidates are parsed at the same time: each read
// here waits until another is in flight, which a one-at-a-time scan never reaches.
func TestScanRoot_parsesCandidatesConcurrently(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"a", "b", "c", "d"} {
		writeJSONL(t, dir, n+".jsonl", `{"type":"user","cwd":"/x","message":{"content":"hi `+n+`"}}`)
	}
	origWorkers := parseWorkers
	parseWorkers = 4
	t.Cleanup(func() { parseWorkers = origWorkers })
	orig := readLines
	t.Cleanup(func() { readLines = orig })
	var mu sync.Mutex
	inFlight, peak := 0, 0
	together := make(chan struct{})
	// in flight can reach two more than once (two, back to one, two again), and a channel closes once
	var meet sync.Once
	readLines = func(path string) []string {
		mu.Lock()
		inFlight++
		peak = max(peak, inFlight)
		if inFlight == 2 {
			meet.Do(func() { close(together) })
		}
		mu.Unlock()
		select {
		case <-together:
		case <-time.After(2 * time.Second):
		}
		mu.Lock()
		inFlight--
		mu.Unlock()
		return orig(path)
	}

	if got := scanProvider(claudeProvider(dir), 0, 4); len(got) != 4 {
		t.Fatalf("want 4 sessions, got %d", len(got))
	}
	if peak < 2 {
		t.Errorf("want candidates parsed concurrently, at most %d at once", peak)
	}
}

func TestScanRoot_missingRootYieldsNothing(t *testing.T) {
	if got := scanProvider(claudeProvider(filepath.Join(t.TempDir(), "does-not-exist")), 0, 10); len(got) != 0 {
		t.Fatalf("missing root: want 0, got %d", len(got))
	}
}

func TestScanProvider_codexExtractsResumeKeyAndMeta(t *testing.T) {
	dir := t.TempDir()
	// matcher requires the rollout- prefix; the filename stem is NOT the resume key for codex.
	writeJSONL(t, dir, "rollout-2026-06-30T08-45-09-019f1633.jsonl",
		`{"type":"session_meta","payload":{"session_id":"019f1633-9e5d-7791","cwd":"/home/me/waveterm","git":{"branch":"main"}}}`,
		`{"type":"event_msg","payload":{"type":"task_started"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions"}]}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5-codex"}}`,
		`{"type":"event_msg","payload":{"type":"user_message","message":"check the handoff"}}`,
	)

	got := scanProvider(codexProvider(dir), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 codex session, got %d", len(got))
	}
	s := got[0]
	if s.ID != "019f1633-9e5d-7791" {
		t.Errorf("ID (resume key) = %q, want the session_meta session_id", s.ID)
	}
	if s.Runtime != "codex" {
		t.Errorf("runtime = %q", s.Runtime)
	}
	if s.ProjectName != "waveterm" {
		t.Errorf("projectName = %q", s.ProjectName)
	}
	if s.Branch != "main" {
		t.Errorf("branch = %q", s.Branch)
	}
	if s.Model != "gpt-5-codex" {
		t.Errorf("model = %q", s.Model)
	}
	if s.Task != "check the handoff" {
		t.Errorf("task = %q (must be the user_message, not the AGENTS.md injection)", s.Task)
	}
	if s.ResumeCommand != "codex resume 019f1633-9e5d-7791" {
		t.Errorf("resumeCommand = %q", s.ResumeCommand)
	}
}

func TestScanProvider_codexSkipsFileWithoutUserMessage(t *testing.T) {
	dir := t.TempDir()
	writeJSONL(t, dir, "rollout-x.jsonl",
		`{"type":"session_meta","payload":{"session_id":"abc","cwd":"/x"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"env"}]}}`,
	)
	if got := scanProvider(codexProvider(dir), 0, 10); len(got) != 0 {
		t.Fatalf("want 0 (no human user_message), got %d", len(got))
	}
}

func writeJSON(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// buildOpencodeTree creates the opencode storage layout (session info + message + part dirs) under
// root and returns the storage root.
func buildOpencodeTree(t *testing.T, root string) string {
	storage := filepath.Join(root, "opencode", "storage")
	writeJSON(t, filepath.Join(storage, "session", "proj1", "ses_abc.json"),
		`{"id":"ses_abc","slug":"tidy-meadow","projectID":"proj1","directory":"/home/me/payments-api","title":"Fix auth","time":{"created":1770000000000,"updated":1770000100000}}`)
	writeJSON(t, filepath.Join(storage, "message", "ses_abc", "msg_1.json"),
		`{"id":"msg_1","sessionID":"ses_abc","role":"user","time":{"created":1770000000000}}`)
	writeJSON(t, filepath.Join(storage, "message", "ses_abc", "msg_2.json"),
		`{"id":"msg_2","sessionID":"ses_abc","role":"assistant","providerID":"openai","modelID":"gpt-5.2-codex","time":{"created":1770000090000},"cost":0.5,"tokens":{"input":10,"output":20,"reasoning":30,"cache":{"read":40,"write":50}}}`)
	writeJSON(t, filepath.Join(storage, "part", "msg_1", "p1.json"),
		`{"id":"p1","sessionID":"ses_abc","messageID":"msg_1","type":"text","text":"Fix the auth race"}`)
	writeJSON(t, filepath.Join(storage, "part", "msg_2", "p1.json"),
		`{"id":"p1","sessionID":"ses_abc","messageID":"msg_2","type":"text","text":"done, +40 -10"}`)
	writeJSON(t, filepath.Join(storage, "part", "msg_2", "p2.json"),
		`{"id":"p2","sessionID":"ses_abc","messageID":"msg_2","type":"step-finish","reason":"stop"}`)
	return storage
}

func TestScanProvider_opencodeExtractsInfoAndUsage(t *testing.T) {
	storage := buildOpencodeTree(t, t.TempDir())
	got := scanProvider(opencodeProvider(storage), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 opencode session, got %d", len(got))
	}
	s := got[0]
	if s.ID != "ses_abc" {
		t.Errorf("ID = %q, want the info-file stem ses_abc", s.ID)
	}
	if s.Runtime != "opencode" {
		t.Errorf("runtime = %q", s.Runtime)
	}
	if s.ProjectName != "payments-api" {
		t.Errorf("projectName = %q", s.ProjectName)
	}
	if s.Model != "openai/gpt-5.2-codex" {
		t.Errorf("model = %q", s.Model)
	}
	if s.Task != "Fix the auth race" {
		t.Errorf("task = %q (must be the first user text part)", s.Task)
	}
	if s.ResumeCommand != "opencode -s ses_abc" {
		t.Errorf("resumeCommand = %q", s.ResumeCommand)
	}
	if s.TokensTotal != 150 {
		t.Errorf("tokensTotal = %d, want 150", s.TokensTotal)
	}
	if s.CostUsd != 0.5 {
		t.Errorf("costUsd = %v, want 0.5", s.CostUsd)
	}
	if len(s.Events) == 0 {
		t.Fatal("expected lifecycle events")
	}
	if s.Events[0].Type != "started" || !strings.Contains(s.Events[0].Text, "Fix the auth race") {
		t.Errorf("first event = %+v, want started with the task", s.Events[0])
	}
}

func TestScanProvider_opencodeSkipsSubagentOnlySession(t *testing.T) {
	storage := buildOpencodeTree(t, t.TempDir())
	writeJSON(t, filepath.Join(storage, "session", "proj2", "ses_xyz.json"),
		`{"id":"ses_xyz","directory":"/x","time":{"created":1770000200000}}`)
	// no message dir for ses_xyz => no user task => skipped
	if got := scanProvider(opencodeProvider(storage), 0, 10); len(got) != 1 {
		t.Fatalf("want only ses_abc, got %d", len(got))
	}
}

func TestExtractSession_opencode(t *testing.T) {
	storage := buildOpencodeTree(t, t.TempDir())
	path := filepath.Join(storage, "session", "proj1", "ses_abc.json")
	s, err := ExtractSession(path, "opencode")
	if err != nil {
		t.Fatalf("ExtractSession error: %v", err)
	}
	if s == nil || s.ID != "ses_abc" {
		t.Fatalf("want ses_abc, got %+v", s)
	}
}

// buildPiTree writes a Pi v3 session file under a deliberately misleading encoded-cwd directory and
// returns its full path. The directory name looks like it decodes to a cwd, but that encoding is lossy
// and must never be decoded — the v3 session header's cwd is authoritative.
func buildPiTree(t *testing.T, root string) string {
	t.Helper()
	// decoded this would read "C:\Users\Bob\not-the-repo" — wrong; the header's cwd wins.
	enc := filepath.Join(root, "C_Users_Bob_not_the_repo")
	if err := os.MkdirAll(enc, 0o755); err != nil {
		t.Fatal(err)
	}
	return writeJSONL(t, enc, "session-uuid.jsonl",
		`{"type":"session","version":3,"id":"session-uuid","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\Users\\Jane Doe\\IdeaProjects\\waveterm"}`,
		`{"type":"session_info","id":"i1","parentId":null,"name":"older title"}`,
		`{"type":"session_info","id":"i2","parentId":"i1","name":"Pi session title"}`,
		`{"type":"model_change","id":"mc1","parentId":"i2","timestamp":"2026-08-11T03:00:00Z","provider":"openai-codex","modelId":"gpt-5.5"}`,
		`{"type":"message","id":"u1","parentId":"mc1","message":{"role":"user","content":"implement the thing"}}`,
		`{"type":"message","id":"a1","parentId":"u1","message":{"role":"assistant","content":"done","usage":{"input":10,"output":5,"totalTokens":15,"cost":{"total":0}}}}`,
	)
}

func TestScanProvider_PiDiscoversSessionUnderEncodedDir(t *testing.T) {
	root := filepath.Join(t.TempDir(), "pi", "agent", "sessions")
	path := buildPiTree(t, root)

	got := scanProvider(piProvider(root), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 pi session, got %d", len(got))
	}
	s := got[0]
	if s.ID != "session-uuid" {
		t.Errorf("ID = %q, want session-uuid (header id, never the encoded dir)", s.ID)
	}
	if s.ProjectPath != `C:\Users\Jane Doe\IdeaProjects\waveterm` {
		t.Errorf("projectPath = %q, want the header cwd (encoded dir must not be decoded)", s.ProjectPath)
	}
	// the header cwd is a Windows path, which filepath.Base splits only on Windows
	if runtime.GOOS == "windows" && s.ProjectName != "waveterm" {
		t.Errorf("projectName = %q, want waveterm", s.ProjectName)
	}
	if s.TranscriptPath != path {
		t.Errorf("transcriptPath = %q, want %q", s.TranscriptPath, path)
	}
	if !reflect.DeepEqual(s.ResumeArgs, []string{"--session", path}) {
		t.Errorf("resumeArgs = %v, want [--session %q]", s.ResumeArgs, path)
	}
	if wantCmd := "pi --session " + path; s.ResumeCommand != wantCmd {
		t.Errorf("resumeCommand = %q, want %q", s.ResumeCommand, wantCmd)
	}
	if s.Task != "Pi session title" {
		t.Errorf("task = %q, want the latest active session_info.name", s.Task)
	}
	if s.Model != "openai-codex/gpt-5.5" {
		t.Errorf("model = %q, want openai-codex/gpt-5.5", s.Model)
	}
	if s.TokensTotal != 15 {
		t.Errorf("tokensTotal = %d, want 15 (sum of billed records)", s.TokensTotal)
	}
}

func TestScanProvider_PiFallsBackToFirstActiveUserText(t *testing.T) {
	root := filepath.Join(t.TempDir(), "pi", "agent", "sessions")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	writeJSONL(t, root, "s.jsonl",
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":"fix the auth race"}}`,
		`{"type":"message","id":"a1","parentId":"u1","provider":"openai","modelId":"gpt-5.5","message":{"role":"assistant","content":"ok"}}`,
	)
	got := scanProvider(piProvider(root), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 pi session, got %d", len(got))
	}
	if got[0].Task != "fix the auth race" {
		t.Errorf("task = %q, want the first active user text (no session_info.name)", got[0].Task)
	}
}

func TestScanProvider_PiIgnoresAbandonedBranch(t *testing.T) {
	root := filepath.Join(t.TempDir(), "pi", "agent", "sessions")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// the last entry (active) continues from root; the session_info + model on the abandoned fork must
	// never become this session's task/model.
	writeJSONL(t, root, "s.jsonl",
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"root","parentId":null,"message":{"role":"user","content":"real task"}}`,
		`{"type":"message","id":"ab1","parentId":"root","provider":"openai","modelId":"gpt-old","message":{"role":"assistant","content":"abandoned answer"}}`,
		`{"type":"session_info","id":"abInfo","parentId":"ab1","name":"abandoned title"}`,
		`{"type":"message","id":"act1","parentId":"root","provider":"openai-codex","modelId":"gpt-5.5","message":{"role":"assistant","content":"active answer"}}`,
	)
	got := scanProvider(piProvider(root), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 pi session, got %d", len(got))
	}
	s := got[0]
	if s.Task != "real task" {
		t.Errorf("task = %q, want the active-branch user text (abandoned title must not leak)", s.Task)
	}
	if s.Model != "openai-codex/gpt-5.5" {
		t.Errorf("model = %q, want the active-branch model (abandoned branch must not win)", s.Model)
	}
}

func TestScanProvider_PiPartialFinalRecordSurvives(t *testing.T) {
	root := filepath.Join(t.TempDir(), "pi", "agent", "sessions")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// the final record is truncated mid-write (no trailing newline): pisession drops it silently and
	// the session survives.
	content := `{"type":"session","version":3,"id":"s1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}` + "\n" +
		`{"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":"keep me"}}` + "\n" +
		`{"type":"message","id":"half"`
	if err := os.WriteFile(filepath.Join(root, "s.jsonl"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	got := scanProvider(piProvider(root), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 pi session, got %d", len(got))
	}
	if got[0].Task != "keep me" {
		t.Errorf("task = %q, want keep me", got[0].Task)
	}
}

func TestScanProvider_PiSkipsMalformedFilesAndKeepsValidSibling(t *testing.T) {
	root := filepath.Join(t.TempDir(), "pi", "agent", "sessions")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	writeJSONL(t, root, "bad-version.jsonl", `{"type":"session","version":4,"id":"future","cwd":"C:\\repo"}`)
	writeJSONL(t, root, "garbage.jsonl", `not json at all`)
	writeJSONL(t, root, "good.jsonl",
		`{"type":"session","version":3,"id":"good","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":"fine"}}`,
	)
	var buf bytes.Buffer
	orig := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(orig)

	got := scanProvider(piProvider(root), 0, 10)
	if len(got) != 1 || got[0].ID != "good" {
		t.Fatalf("want only the valid good session, got %+v", got)
	}
	logged := buf.String()
	if !strings.Contains(logged, "bad-version.jsonl") {
		t.Errorf("malformed pi file not logged with path context; log:\n%s", logged)
	}
	if !strings.Contains(logged, "garbage.jsonl") {
		t.Errorf("garbage pi file not logged with path context; log:\n%s", logged)
	}
}

func TestScanCache_reusesUnchangedFiles(t *testing.T) {
	dir := t.TempDir()
	writeJSONL(t, dir, "a.jsonl", `{"type":"user","cwd":"/x","message":{"content":"hi a"}}`)
	writeJSONL(t, dir, "b.jsonl", `{"type":"user","cwd":"/x","message":{"content":"hi b"}}`)

	reads := recordReads(t)

	first := scanProvider(claudeProvider(dir), 0, 10)
	if len(first) != 2 {
		t.Fatalf("first scan: want 2 sessions, got %d", len(first))
	}
	if r := reads(); len(r) != 2 {
		t.Fatalf("first scan must read both files, read %v", r)
	}
	second := scanProvider(claudeProvider(dir), 0, 10)
	if len(second) != 2 || second[0].ID != first[0].ID || second[1].Task != first[1].Task {
		t.Fatalf("second scan mismatch: %+v vs %+v", second, first)
	}
	if r := reads(); len(r) != 2 {
		t.Errorf("unchanged files must be served from the cache (no new reads), read %v", r)
	}
}

func TestScanCache_invalidatesOnRewrite(t *testing.T) {
	dir := t.TempDir()
	path := writeJSONL(t, dir, "a.jsonl", `{"type":"user","cwd":"/x","message":{"content":"old task"}}`)
	if got := scanProvider(claudeProvider(dir), 0, 10); len(got) != 1 || got[0].Task != "old task" {
		t.Fatalf("first scan: %+v", got)
	}
	if err := os.WriteFile(path, []byte(`{"type":"user","cwd":"/x","message":{"content":"new task"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	// force a distinct mtime so the rewrite is detectable on coarse-granularity filesystems too
	ts := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, ts, ts); err != nil {
		t.Fatal(err)
	}
	got := scanProvider(claudeProvider(dir), 0, 10)
	if len(got) != 1 || got[0].Task != "new task" {
		t.Fatalf("changed file must be re-read, got %+v", got)
	}
}

func TestScanProviders_mergesByGlobalRecency(t *testing.T) {
	claudeDir := filepath.Join(t.TempDir(), "claude")
	codexDir := filepath.Join(t.TempDir(), "codex")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mk := func(path, content string, ago time.Duration) {
		writeJSONL(t, filepath.Dir(path), filepath.Base(path), content)
		ts := time.Now().Add(-ago)
		if err := os.Chtimes(path, ts, ts); err != nil {
			t.Fatal(err)
		}
	}
	mk(filepath.Join(claudeDir, "claude-new.jsonl"), `{"type":"user","cwd":"/x","message":{"content":"newest claude"}}`, 1*time.Hour)
	mk(filepath.Join(codexDir, "rollout-codex-new.jsonl"),
		`{"type":"session_meta","payload":{"session_id":"cx","cwd":"/x"}}`+"\n"+
			`{"type":"event_msg","payload":{"type":"user_message","message":"newest codex"}}`, 30*time.Minute)
	mk(filepath.Join(claudeDir, "claude-old.jsonl"), `{"type":"user","cwd":"/x","message":{"content":"older claude"}}`, 3*time.Hour)

	reads := recordReads(t)

	// limit 2 across both providers: the newer codex session must outrank the older claude one, and
	// only the global top-2 candidates may be read (claude-old never parsed).
	got := scanProviders([]provider{claudeProvider(claudeDir), codexProvider(codexDir)}, 0, 2, "")
	if len(got) != 2 {
		t.Fatalf("want 2 sessions, got %d", len(got))
	}
	if got[0].Runtime != "codex" || got[0].Task != "newest codex" {
		t.Errorf("newest must be the codex session, got %+v", got[0])
	}
	if got[1].Runtime != "claude" || got[1].Task != "newest claude" {
		t.Errorf("second must be the claude session, got %+v", got[1])
	}
	if r := reads(); !reflect.DeepEqual(r, []string{"claude-new.jsonl", "rollout-codex-new.jsonl"}) {
		t.Errorf("only the global top-2 candidates may be read, read %v", r)
	}
}

// a session run in the temp dir (an e2e test's scratch cwd) is not history: it is dropped and does not
// use up the limit, so the next real session takes its place.
func TestScanProvidersDropsTempDirSessions(t *testing.T) {
	dir := t.TempDir()
	tempDir := filepath.Join(dir, "Temp")
	scratch, _ := json.Marshal(filepath.Join(tempDir, "scratchpad", "e2e", "cwd"))
	mk := func(name, content string, ago time.Duration) {
		path := writeJSONL(t, dir, name, content)
		ts := time.Now().Add(-ago)
		if err := os.Chtimes(path, ts, ts); err != nil {
			t.Fatal(err)
		}
	}
	mk("scratch.jsonl", `{"type":"user","cwd":`+string(scratch)+`,"message":{"content":"AskUserQuestion e2e"}}`, 1*time.Hour)
	mk("real.jsonl", `{"type":"user","cwd":"/home/me/web","message":{"content":"Add a button"}}`, 2*time.Hour)

	got := scanProviders([]provider{claudeProvider(dir)}, 0, 1, tempDir)
	if len(got) != 1 || got[0].Task != "Add a button" {
		t.Fatalf("want only the real session, got %+v", got)
	}
}

// extractClaudeSession folds one transcript file's lines into a SessionInfo. Returns nil when the
// file carries no human prompt (e.g. a subagent/tool-only file) because those aren't useful to resume,
// and when the transcript is a print-mode run — every model call Wave's own backend makes is print-mode,
// so that one field excludes all of them without matching a word of any prompt.
func extractClaudeSession(id string, lines []string) *SessionInfo {
	return claudeSessionFrom(id, "", parseClaudeLines(lines))
}

// extractClaudeEvents ports frontend/app/view/agents/activityevents.ts:extractClaudeEvents. It does
// NOT gate the synthetic "finished" on liveness (Go can't know the live roster); assembleEvents only
// appends "finished" for done sessions, and the frontend strips it for live ones.
func extractClaudeEvents(lines []string) sessionEvents {
	return claudeEventsFrom(parseClaudeLines(lines))
}

// scanProvider returns up to limit sessions from one provider's root, newest-first (single-provider
// form of the scan; ScanSessions merges providers first so the limit applies globally).
func scanProvider(p provider, windowDays, limit int) []SessionInfo {
	return parseCandidates(walkCandidates(p, windowDays), limit, "")
}

// Claude Code writes an assistant message once per content block, each line repeating the message's usage (the last with
// the final output count): the total counts the message once, as the usage readouts do (usagestats.dedupe).
func TestClaudeSession_countsARepeatedMessageOnce(t *testing.T) {
	dir := t.TempDir()
	writeJSONL(t, dir, "sess.jsonl",
		`{"type":"user","cwd":"/home/me/web","message":{"role":"user","content":"Add a button"}}`,
		`{"type":"assistant","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":100}}}`,
		`{"type":"assistant","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100}}}`,
		`{"type":"assistant","requestId":"req_2","message":{"id":"msg_2","model":"claude-opus-4-8","usage":{"input_tokens":20,"output_tokens":2}}}`,
		`{"type":"assistant","message":{"model":"claude-opus-4-8","usage":{"input_tokens":3}}}`,
	)
	got := scanProvider(claudeProvider(dir), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 session, got %d", len(got))
	}
	// msg_1 once at its final count (115), msg_2 (22), and the record with no id as it is (3)
	if got[0].TokensTotal != 140 {
		t.Errorf("tokensTotal = %d, want 140", got[0].TokensTotal)
	}
}

func TestCodexCurrentSessionIDAndTranscriptLookup(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "2026", "10", "09")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "rollout-2026-10-09T10-00-00-thread-1.jsonl")
	text := "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread-1\",\"cwd\":\"/project\"}}\n" + "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Fix icons\"}}\n"
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	session, err := ExtractSession(path, "codex")
	if err != nil || session == nil || session.ID != "thread-1" || session.Task != "Fix icons" {
		t.Fatalf("session = %+v, error = %v", session, err)
	}
	if got := TranscriptForSession(root, "codex", "/project", "thread-1"); got != path {
		t.Fatalf("path = %q, want %q", got, path)
	}
	if got := TranscriptForSession(root, "codex", "/project", "*"); got != "" {
		t.Fatalf("wildcard matched %q", got)
	}
}
