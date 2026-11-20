// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentedits

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

const sessionID = "11111111-2222-3333-4444-555555555555"

var t0 = time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)

// at is the ISO timestamp n seconds after t0.
func at(n int) string { return t0.Add(time.Duration(n) * time.Second).Format(time.RFC3339Nano) }

func line(t testing.TB, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// backupRef is a file-history backup entry; name "" writes backupFileName: null.
type backupRef struct {
	name    string
	version int
}

func (b backupRef) json() map[string]any {
	var name any
	if b.name != "" {
		name = b.name
	}
	return map[string]any{"backupFileName": name, "version": b.version, "backupTime": at(0)}
}

func delta(t testing.TB, n int, path string, b backupRef) string {
	return line(t, map[string]any{"type": "file-history-delta", "trackingPath": path, "backup": b.json(), "timestamp": at(n)})
}

func snapshot(t testing.TB, backups map[string]backupRef) string {
	m := map[string]any{}
	for p, b := range backups {
		m[p] = b.json()
	}
	return line(t, map[string]any{"type": "file-history-snapshot", "snapshot": map[string]any{"trackedFileBackups": m}})
}

func toolUse(t testing.TB, n int, cwd, id, name string, input map[string]any) string {
	return line(t, map[string]any{
		"type": "assistant", "timestamp": at(n), "cwd": cwd,
		"message": map[string]any{"role": "assistant", "content": []any{
			map[string]any{"type": "tool_use", "id": id, "name": name, "input": input},
		}},
	})
}

func toolResult(t testing.TB, n int, cwd, id string, isError bool) string {
	return line(t, map[string]any{
		"type": "user", "timestamp": at(n), "cwd": cwd,
		"message": map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "tool_result", "tool_use_id": id, "content": "ok", "is_error": isError},
		}},
	})
}

// call is a tool_use plus its successful result, one second apart.
func call(t testing.TB, n int, cwd, id, name string, input map[string]any) []string {
	return []string{toolUse(t, n, cwd, id, name, input), toolResult(t, n+1, cwd, id, false)}
}

func edit(path, old, new string) map[string]any {
	return map[string]any{"file_path": path, "old_string": old, "new_string": new, "replace_all": false}
}

func write(path, content string) map[string]any {
	return map[string]any{"file_path": path, "content": content}
}

type session struct {
	transcript string
	historyDir string // <config>/file-history
	repo       string
}

// newSession lays out <tmp>/config/projects/p/<id>.jsonl with the repo at <tmp>/repo.
func newSession(t testing.TB) session {
	t.Helper()
	root := t.TempDir()
	s := session{
		transcript: filepath.Join(root, "config", "projects", "p", sessionID+".jsonl"),
		historyDir: filepath.Join(root, "config", "file-history"),
		repo:       filepath.Join(root, "repo"),
	}
	for _, d := range []string{filepath.Dir(s.transcript), filepath.Join(s.historyDir, sessionID), s.repo} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func (s session) abs(rel string) string { return filepath.Join(s.repo, filepath.FromSlash(rel)) }

func writeLines(t testing.TB, path string, groups ...[]string) {
	t.Helper()
	var all []string
	for _, g := range groups {
		all = append(all, g...)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(all, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (s session) backup(t testing.TB, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(s.historyDir, sessionID, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (s session) subagent(name string) string {
	return filepath.Join(strings.TrimSuffix(s.transcript, ".jsonl"), "subagents", name)
}

func mapReader(m map[string]string) Reader {
	return func(p string) ([]byte, bool, error) {
		c, ok := m[p]
		if !ok {
			return nil, false, nil
		}
		return []byte(c), true, nil
	}
}

var none = mapReader(nil)

func replay(t testing.TB, s session, base, worktree Reader) (*Log, []File) {
	t.Helper()
	l, err := Parse(s.transcript, s.historyDir)
	if err != nil {
		t.Fatal(err)
	}
	files, err := Replay(l, s.repo, nil, base, worktree)
	if err != nil {
		t.Fatal(err)
	}
	return l, files
}

func only(t testing.TB, files []File) File {
	t.Helper()
	if len(files) != 1 {
		t.Fatalf("want 1 file, got %d: %+v", len(files), files)
	}
	return files[0]
}

func TestReplayCreatedFile(t *testing.T) {
	s := newSession(t)
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("new.txt"), backupRef{"", 1})},
		call(t, 2, s.repo, "w1", "Write", write(s.abs("new.txt"), "hello\n")),
	)
	l, files := replay(t, s, none, none)
	got := only(t, files)
	want := File{Path: "new.txt", PreExists: false, Post: []byte("hello\n"), PostExists: true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if l.SessionStart != t0.Add(1*time.Second).Unix() || l.SessionCwd != s.repo || l.EditCalls != 1 {
		t.Fatalf("log = start %d cwd %q edits %d", l.SessionStart, l.SessionCwd, l.EditCalls)
	}
}

func TestReplayEditChainAndReplaceAll(t *testing.T) {
	s := newSession(t)
	s.backup(t, "aa@v1", "one two\nx x x\n")
	all := edit(s.abs("a.txt"), "x", "y")
	all["replace_all"] = true
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"aa@v1", 1})},
		call(t, 2, s.repo, "e1", "Edit", edit(s.abs("a.txt"), "one", "ONE")),
		call(t, 4, s.repo, "e2", "Edit", edit(s.abs("a.txt"), "ONE two", "three")),
		call(t, 6, s.repo, "e3", "Edit", all),
	)
	_, files := replay(t, s, none, none)
	got := only(t, files)
	if string(got.Pre) != "one two\nx x x\n" || !got.PreExists || string(got.Post) != "three\ny y y\n" || got.Flag != "" {
		t.Fatalf("got %+v", got)
	}
}

func TestReplayMultiEdit(t *testing.T) {
	s := newSession(t)
	s.backup(t, "aa@v1", "a b c\n")
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"aa@v1", 1})},
		call(t, 2, s.repo, "m1", "MultiEdit", map[string]any{"file_path": s.abs("a.txt"), "edits": []any{
			map[string]any{"old_string": "a", "new_string": "A"},
			map[string]any{"old_string": "A b", "new_string": "B"},
		}}),
	)
	_, files := replay(t, s, none, none)
	if got := only(t, files); string(got.Post) != "B c\n" || got.Flag != "" {
		t.Fatalf("got %+v", got)
	}
}

func TestReplayNonUniqueOldStringIsOutside(t *testing.T) {
	s := newSession(t)
	s.backup(t, "aa@v1", "x x\n")
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"aa@v1", 1})},
		call(t, 2, s.repo, "e1", "Edit", edit(s.abs("a.txt"), "x", "y")),
	)
	_, files := replay(t, s, none, mapReader(map[string]string{"a.txt": "worktree\n"}))
	got := only(t, files)
	if got.Flag != Outside || string(got.Post) != "worktree\n" || !got.PostExists || string(got.Pre) != "x x\n" {
		t.Fatalf("got %+v", got)
	}
}

func TestReplayNoRecordIsApproximate(t *testing.T) {
	s := newSession(t)
	writeLines(t, s.transcript, call(t, 1, s.repo, "e1", "Edit", edit(s.abs("dir/b.txt"), "old", "new")))
	_, files := replay(t, s, mapReader(map[string]string{"dir/b.txt": "old line\n"}), none)
	got := only(t, files)
	want := File{Path: "dir/b.txt", Pre: []byte("old line\n"), PreExists: true, Post: []byte("new line\n"), PostExists: true, Flag: Approximate}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestReplayForeignChangeIsOutside(t *testing.T) {
	s := newSession(t)
	s.backup(t, "aa@v1", "alpha\nbeta\n")
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"aa@v1", 1})},
		call(t, 2, s.repo, "e1", "Edit", edit(s.abs("a.txt"), "alpha", "ALPHA")),
		// someone else rewrote beta to gamma, and the agent then edited the line it saw
		call(t, 4, s.repo, "e2", "Edit", edit(s.abs("a.txt"), "gamma", "GAMMA")),
	)
	_, files := replay(t, s, none, mapReader(map[string]string{"a.txt": "ALPHA\nGAMMA\n"}))
	got := only(t, files)
	if got.Flag != Outside || string(got.Post) != "ALPHA\nGAMMA\n" || string(got.Pre) != "alpha\nbeta\n" {
		t.Fatalf("got %+v", got)
	}
}

func TestReplayDropsFileAbsentOnBothSides(t *testing.T) {
	s := newSession(t)
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("gone.txt"), backupRef{"", 1})},
		call(t, 2, s.repo, "w1", "Write", write(s.abs("gone.txt"), "a\n")),
		// the file was deleted outside the agent, so this edit cannot apply
		call(t, 4, s.repo, "e1", "Edit", edit(s.abs("gone.txt"), "zzz", "b")),
	)
	if _, files := replay(t, s, none, none); len(files) != 0 {
		t.Fatalf("want no files, got %+v", files)
	}
}

func TestReplaySubagentEdit(t *testing.T) {
	s := newSession(t)
	s.backup(t, "aa@v1", "parent pre\n")
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"aa@v1", 1})},
		call(t, 2, s.repo, "e1", "Edit", edit(s.abs("a.txt"), "parent", "main")),
	)
	writeLines(t, s.subagent("agent-1.jsonl"),
		call(t, 5, s.repo, "s1", "Edit", edit(s.abs("a.txt"), "pre", "sub")),
		call(t, 7, s.repo, "s2", "Edit", edit(s.abs("c.txt"), "c", "C")),
		[]string{toolUse(t, 9, s.repo, "b1", "Bash", map[string]any{"command": "ls"})},
	)
	l, files := replay(t, s, mapReader(map[string]string{"c.txt": "c\n"}), none)
	if len(files) != 2 {
		t.Fatalf("want 2 files, got %+v", files)
	}
	if a := files[0]; a.Path != "a.txt" || string(a.Pre) != "parent pre\n" || string(a.Post) != "main sub\n" || a.Flag != "" {
		t.Fatalf("a = %+v", a)
	}
	if c := files[1]; c.Path != "c.txt" || string(c.Post) != "C\n" || c.Flag != Approximate {
		t.Fatalf("c = %+v", c)
	}
	if l.EditCalls != 3 || l.BashCalls != 1 {
		t.Fatalf("edits %d bash %d", l.EditCalls, l.BashCalls)
	}
}

func TestReplayOrdersCallsByTimestampAcrossTranscripts(t *testing.T) {
	s := newSession(t)
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"", 1})},
		call(t, 2, s.repo, "w1", "Write", write(s.abs("a.txt"), "1\n")),
		call(t, 10, s.repo, "e2", "Edit", edit(s.abs("a.txt"), "2", "3")),
	)
	writeLines(t, s.subagent("agent-1.jsonl"), call(t, 5, s.repo, "s1", "Edit", edit(s.abs("a.txt"), "1", "2")))
	_, files := replay(t, s, none, none)
	if got := only(t, files); string(got.Post) != "3\n" || got.Flag != "" {
		t.Fatalf("got %+v", got)
	}
}

func TestReplayDropsOutsideRepoAndResolvesRelative(t *testing.T) {
	s := newSession(t)
	outside := filepath.Join(filepath.Dir(s.repo), "elsewhere.txt")
	rel := `sub\r.txt` // claude records Windows paths with backslashes
	writeLines(t, s.transcript,
		[]string{delta(t, 1, rel, backupRef{"", 1}), delta(t, 1, outside, backupRef{"", 1})},
		call(t, 2, s.repo, "w1", "Write", write(outside, "x\n")),
		call(t, 4, s.repo, "w2", "Write", write("sub/r.txt", "r\n")),
	)
	_, files := replay(t, s, none, none)
	got := only(t, files)
	if got.Path != "sub/r.txt" || got.PreExists || got.Flag != "" || string(got.Post) != "r\n" {
		t.Fatalf("got %+v", got)
	}
}

func TestParseSnapshotShapeMatchesDelta(t *testing.T) {
	build := func(records []string) []File {
		s := newSession(t)
		s.backup(t, "aa@v1", "a pre\n")
		s.backup(t, "aa@v2", "a later\n")
		var lines []string
		for _, r := range records {
			lines = append(lines, strings.ReplaceAll(r, "REPO", filepath.ToSlash(s.repo)))
		}
		writeLines(t, s.transcript, lines,
			call(t, 2, s.repo, "e1", "Edit", edit(s.abs("a.txt"), "pre", "post")),
			call(t, 4, s.repo, "w1", "Write", write(s.abs("n.txt"), "n\n")),
		)
		_, files := replay(t, s, none, none)
		return files
	}
	viaDelta := build([]string{
		delta(t, 1, "REPO/a.txt", backupRef{"aa@v1", 1}),
		delta(t, 1, "REPO/n.txt", backupRef{"", 1}),
		delta(t, 3, "REPO/a.txt", backupRef{"aa@v2", 2}),
	})
	viaSnapshot := build([]string{
		snapshot(t, map[string]backupRef{"REPO/a.txt": {"aa@v1", 1}, "REPO/n.txt": {"", 1}}),
		snapshot(t, map[string]backupRef{"REPO/a.txt": {"aa@v2", 2}, "REPO/n.txt": {"", 2}}),
	})
	if len(viaDelta) != 2 || string(viaDelta[0].Pre) != "a pre\n" || viaDelta[1].PreExists {
		t.Fatalf("delta = %+v", viaDelta)
	}
	if !reflect.DeepEqual(viaDelta, viaSnapshot) {
		t.Fatalf("delta %+v != snapshot %+v", viaDelta, viaSnapshot)
	}
}

func TestParseErroredAndPendingCallsDropped(t *testing.T) {
	s := newSession(t)
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"", 1})},
		call(t, 2, s.repo, "w1", "Write", write(s.abs("a.txt"), "ok\n")),
		[]string{
			toolUse(t, 4, s.repo, "w2", "Write", write(s.abs("a.txt"), "errored\n")),
			toolResult(t, 5, s.repo, "w2", true),
			toolUse(t, 6, s.repo, "w3", "Write", write(s.abs("a.txt"), "pending\n")),
			toolUse(t, 7, s.repo, "b1", "Bash", map[string]any{"command": "go test"}),
			toolResult(t, 8, s.repo, "b1", false),
			toolUse(t, 9, s.repo, "b2", "Bash", map[string]any{"command": "false"}),
			toolResult(t, 10, s.repo, "b2", true),
		},
	)
	writeLines(t, s.subagent("agent-1.jsonl"), call(t, 11, s.repo, "b3", "Bash", map[string]any{"command": "ls"}))
	l, files := replay(t, s, none, none)
	if got := only(t, files); string(got.Post) != "ok\n" {
		t.Fatalf("got %+v", got)
	}
	if l.EditCalls != 1 || l.BashCalls != 3 {
		t.Fatalf("edits %d bash %d", l.EditCalls, l.BashCalls)
	}
}

func TestReplayCRLFKeepsLineEndings(t *testing.T) {
	s := newSession(t)
	s.backup(t, "aa@v1", "one\r\ntwo\r\nthree\r\n")
	writeLines(t, s.transcript,
		[]string{delta(t, 1, s.abs("a.txt"), backupRef{"aa@v1", 1})},
		call(t, 2, s.repo, "e1", "Edit", edit(s.abs("a.txt"), "one\ntwo", "uno\ndos")),
	)
	_, files := replay(t, s, none, none)
	if got := only(t, files); string(got.Post) != "uno\r\ndos\r\nthree\r\n" || got.Flag != "" {
		t.Fatalf("got %q flag %q", got.Post, got.Flag)
	}
}

func TestFileHistoryDir(t *testing.T) {
	config := filepath.Join(t.TempDir(), "cfg")
	transcript := filepath.Join(config, "projects", "C--repo", sessionID+".jsonl")
	if got, want := FileHistoryDir(transcript), filepath.Join(config, "file-history"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	env := filepath.Join(t.TempDir(), "envcfg")
	t.Setenv("CLAUDE_CONFIG_DIR", env)
	loose := filepath.Join(t.TempDir(), sessionID+".jsonl")
	if got, want := FileHistoryDir(loose), filepath.Join(env, "file-history"); got != want {
		t.Fatalf("loose: got %q, want %q", got, want)
	}
}

func TestSubagentTranscripts(t *testing.T) {
	s := newSession(t)
	if got, err := SubagentTranscripts(s.transcript); err != nil || len(got) != 0 {
		t.Fatalf("absent folder: got %v, %v", got, err)
	}
	for _, n := range []string{"agent-b.jsonl", "agent-a.jsonl", "agent-a.meta.json"} {
		writeLines(t, s.subagent(n), []string{"{}"})
	}
	got, err := SubagentTranscripts(s.transcript)
	want := []string{s.subagent("agent-a.jsonl"), s.subagent("agent-b.jsonl")}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, %v; want %v", got, err, want)
	}
}
