// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const editsSessionID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

func editsGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t", "-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// editsRepo commits files into a fresh repository and returns its root.
func editsRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	editsGit(t, dir, "init", "-q", "-b", "main")
	for p, c := range files {
		abs := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	editsGit(t, dir, "add", "-A")
	editsGit(t, dir, "commit", "-q", "-m", "init")
	return dir
}

// editsTranscript is <tmp>/config/projects/p/<id>.jsonl, so its file history sits beside it, not under HOME.
func editsTranscript(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config", "projects", "p", editsSessionID+".jsonl")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

type transcriptCall struct {
	name  string
	input map[string]any
}

// transcriptLines renders the extra records, then each call as a tool_use plus its successful result,
// timestamped from a second after now so the session starts after the repository's commit.
func transcriptLines(t *testing.T, cwd string, calls []transcriptCall, extra ...map[string]any) []byte {
	t.Helper()
	var buf bytes.Buffer
	put := func(v map[string]any) {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	ts := time.Now().Add(time.Second)
	for _, e := range extra {
		e["timestamp"] = ts.Format(time.RFC3339Nano)
		put(e)
	}
	for i, c := range calls {
		ts = ts.Add(time.Second)
		id := fmt.Sprintf("tu%d", i)
		put(map[string]any{"type": "assistant", "timestamp": ts.Format(time.RFC3339Nano), "cwd": cwd,
			"message": map[string]any{"content": []any{map[string]any{"type": "tool_use", "id": id, "name": c.name, "input": c.input}}}})
		put(map[string]any{"type": "user", "timestamp": ts.Format(time.RFC3339Nano), "cwd": cwd,
			"message": map[string]any{"content": []any{map[string]any{"type": "tool_result", "tool_use_id": id, "content": "ok"}}}})
	}
	return buf.Bytes()
}

func appendTranscript(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.Write(b); err != nil {
		t.Fatal(err)
	}
}

// captureLog collects the std logger's output for the test, without its date prefix.
func captureLog(t *testing.T) *bytes.Buffer {
	var buf bytes.Buffer
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	})
	return &buf
}

// editsLogLines returns the agentedits lines logged for one transcript.
func editsLogLines(buf *bytes.Buffer, transcript string) []string {
	var out []string
	prefix := fmt.Sprintf("agentedits: transcript=%q ", transcript)
	for _, ln := range strings.Split(buf.String(), "\n") {
		if strings.HasPrefix(ln, prefix) {
			out = append(out, ln)
		}
	}
	return out
}

func agentEdits(t *testing.T, cwd, transcript string) *wshrpc.CommandGitAgentEditsRtnData {
	t.Helper()
	rtn, err := (&WshServer{}).GitAgentEditsCommand(context.Background(), wshrpc.CommandGitAgentEditsData{Cwd: cwd, TranscriptPath: transcript})
	if err != nil {
		t.Fatalf("GitAgentEditsCommand: %v", err)
	}
	return rtn
}

func TestGitAgentEditsNothingToShowHasAReason(t *testing.T) {
	repo := editsRepo(t, map[string]string{"a.txt": "a\n"})
	cases := map[string]struct{ cwd, transcript string }{
		"empty transcript path": {repo, ""},
		"not a repository":      {t.TempDir(), editsTranscript(t)},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			rtn := agentEdits(t, c.cwd, c.transcript)
			if rtn.Base != "" || rtn.End != "" {
				t.Errorf("base..end = %q..%q, want empty", rtn.Base, rtn.End)
			}
			if rtn.Reason == "" {
				t.Error("reason is empty, want the caption for an empty answer")
			}
			if rtn.Files == nil || len(rtn.Files) != 0 {
				t.Errorf("files = %#v, want an empty list", rtn.Files)
			}
		})
	}
}

func TestGitAgentEditsSubfolderCwdGetsCwdRelativePaths(t *testing.T) {
	repo := editsRepo(t, map[string]string{"sub/a.txt": "one\ntwo\n", "root.txt": "r\n"})
	cwd := filepath.Join(repo, "sub")
	transcript := editsTranscript(t)
	appendTranscript(t, transcript, transcriptLines(t, cwd, []transcriptCall{
		{"Write", map[string]any{"file_path": filepath.Join(cwd, "new.txt"), "content": "new\n"}},
		// no file-history record for a.txt: its pre-image is the session-start commit's
		{"Edit", map[string]any{"file_path": filepath.Join(cwd, "a.txt"), "old_string": "two", "new_string": "TWO"}},
		{"Edit", map[string]any{"file_path": filepath.Join(repo, "root.txt"), "old_string": "r", "new_string": "R"}},
		{"Bash", map[string]any{"command": "ls"}},
	}, map[string]any{"type": "file-history-delta", "trackingPath": filepath.Join(cwd, "new.txt"),
		"backup": map[string]any{"backupFileName": nil, "version": 1}}))

	rtn := agentEdits(t, cwd, transcript)
	if rtn.Base == "" {
		t.Fatalf("base is empty, reason %q", rtn.Reason)
	}
	want := []wshrpc.GitAgentEditFile{{Path: "a.txt", Flag: "approximate"}, {Path: "new.txt"}}
	if !reflect.DeepEqual(rtn.Files, want) {
		t.Errorf("files = %+v, want %+v", rtn.Files, want)
	}
	if rtn.BashCalls != 1 {
		t.Errorf("bashcalls = %d, want 1", rtn.BashCalls)
	}
	names := strings.Split(editsGit(t, repo, "diff", "--name-only", rtn.Base, rtn.End), "\n")
	sort.Strings(names)
	if wantNames := []string{"root.txt", "sub/a.txt", "sub/new.txt"}; !reflect.DeepEqual(names, wantNames) {
		t.Errorf("diff B H = %v, want %v", names, wantNames)
	}
	if got := editsGit(t, repo, "show", rtn.End+":sub/a.txt"); got != "one\nTWO" {
		t.Errorf("H:sub/a.txt = %q, want the edit applied", got)
	}
}

var editsLogLine = regexp.MustCompile(`^agentedits: transcript="[^"]*" calls=(\d+) files=(\d+) cache=(hit|miss) ms=\d+( err=".*")?$`)

func TestGitAgentEditsCachesUntilATranscriptGrows(t *testing.T) {
	buf := captureLog(t)
	repo := editsRepo(t, map[string]string{"a.txt": "a\n"})
	transcript := editsTranscript(t)
	appendTranscript(t, transcript, transcriptLines(t, repo, []transcriptCall{
		{"Write", map[string]any{"file_path": filepath.Join(repo, "b.txt"), "content": "b\n"}},
	}))
	subagent := filepath.Join(strings.TrimSuffix(transcript, ".jsonl"), "subagents", "agent-1.jsonl")
	appendTranscript(t, subagent, transcriptLines(t, repo, nil, map[string]any{"type": "user", "cwd": repo}))

	first := agentEdits(t, repo, transcript)
	second := agentEdits(t, repo, transcript)
	if first.Base == "" || second.Base != first.Base || second.End != first.End {
		t.Errorf("second call = %s..%s, want the first's %s..%s", second.Base, second.End, first.Base, first.End)
	}
	appendTranscript(t, transcript, []byte(`{"type":"system"}`+"\n"))
	agentEdits(t, repo, transcript)
	agentEdits(t, repo, transcript)
	appendTranscript(t, subagent, []byte(`{"type":"system"}`+"\n"))
	agentEdits(t, repo, transcript)

	got := editsLogLines(buf, transcript)
	var caches []string
	for _, ln := range got {
		m := editsLogLine.FindStringSubmatch(ln)
		if m == nil {
			t.Fatalf("log line %q does not match the format", ln)
		}
		if m[1] != "1" || m[2] != "1" {
			t.Errorf("log line %q: want calls=1 files=1", ln)
		}
		caches = append(caches, m[3])
	}
	if want := []string{"miss", "hit", "miss", "hit", "miss"}; !reflect.DeepEqual(caches, want) {
		t.Errorf("cache per call = %v, want %v", caches, want)
	}
}

func TestGitAgentEditsLogsTheErrorOnAFailure(t *testing.T) {
	buf := captureLog(t)
	repo := editsRepo(t, map[string]string{"a.txt": "a\n"})
	// a directory where the transcript should be cannot be read
	transcript := filepath.Join(t.TempDir(), editsSessionID+".jsonl")
	if err := os.Mkdir(transcript, 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := (&WshServer{}).GitAgentEditsCommand(context.Background(), wshrpc.CommandGitAgentEditsData{Cwd: repo, TranscriptPath: transcript})
	if err == nil {
		t.Fatal("want an error for an unreadable transcript")
	}
	got := editsLogLines(buf, transcript)
	if len(got) != 1 || !strings.HasSuffix(got[0], fmt.Sprintf(" err=%q", err.Error())) {
		t.Errorf("log lines = %q, want one ending in err=%q", got, err.Error())
	}
}

// caseRepo is a repository holding src/Foo.txt with core.ignorecase set as given, plus a transcript whose
// Edit names it as SRC/foo.txt; withBackup adds the file-history-delta and its backup file.
func caseRepo(t *testing.T, ignorecase string, withBackup bool) (repo, transcript string) {
	t.Helper()
	repo = editsRepo(t, map[string]string{"src/Foo.txt": "one\ntwo\n"})
	editsGit(t, repo, "config", "core.ignorecase", ignorecase)
	transcript = editsTranscript(t)
	spelled := filepath.Join(repo, "SRC", "foo.txt")
	var extra []map[string]any
	if withBackup {
		dir := filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(transcript))), "file-history", editsSessionID)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "foo@v1"), []byte("one\ntwo\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		extra = append(extra, map[string]any{"type": "file-history-delta", "trackingPath": spelled,
			"backup": map[string]any{"backupFileName": "foo@v1", "version": 1}})
	}
	appendTranscript(t, transcript, transcriptLines(t, repo, []transcriptCall{
		{"Edit", map[string]any{"file_path": spelled, "old_string": "two", "new_string": "TWO"}},
	}, extra...))
	return repo, transcript
}

func TestGitAgentEditsMapsAnotherCaseOntoTheTreeSpelling(t *testing.T) {
	cases := map[string]struct {
		backup bool
		flag   string
	}{
		"with a backup":    {true, ""},
		"without a backup": {false, "approximate"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			repo, transcript := caseRepo(t, "true", c.backup)
			rtn := agentEdits(t, repo, transcript)
			if rtn.Base == "" {
				t.Fatalf("base is empty, reason %q", rtn.Reason)
			}
			if want := []wshrpc.GitAgentEditFile{{Path: "src/Foo.txt", Flag: c.flag}}; !reflect.DeepEqual(rtn.Files, want) {
				t.Errorf("files = %+v, want %+v", rtn.Files, want)
			}
			if got := editsGit(t, repo, "diff", "--name-status", rtn.Base, rtn.End); got != "M\tsrc/Foo.txt" {
				t.Errorf("diff --name-status B H = %q, want one M line for src/Foo.txt", got)
			}
		})
	}
}

func TestGitAgentEditsKeepsTheSpellingWithoutIgnorecase(t *testing.T) {
	repo, transcript := caseRepo(t, "false", true)
	rtn := agentEdits(t, repo, transcript)
	if want := []wshrpc.GitAgentEditFile{{Path: "SRC/foo.txt"}}; !reflect.DeepEqual(rtn.Files, want) {
		t.Errorf("files = %+v, want %+v", rtn.Files, want)
	}
}

func TestGitAgentEditsCreatedFileKeepsTheAgentSpelling(t *testing.T) {
	repo := editsRepo(t, map[string]string{"src/Foo.txt": "one\n"})
	editsGit(t, repo, "config", "core.ignorecase", "true")
	transcript := editsTranscript(t)
	appendTranscript(t, transcript, transcriptLines(t, repo, []transcriptCall{
		{"Write", map[string]any{"file_path": filepath.Join(repo, "SRC", "New.txt"), "content": "new\n"}},
	}))
	rtn := agentEdits(t, repo, transcript)
	if want := []wshrpc.GitAgentEditFile{{Path: "SRC/New.txt", Flag: "approximate"}}; !reflect.DeepEqual(rtn.Files, want) {
		t.Errorf("files = %+v, want %+v", rtn.Files, want)
	}
}
