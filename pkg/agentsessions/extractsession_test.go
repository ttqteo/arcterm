package agentsessions

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTranscript(t *testing.T, lines []string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "session.jsonl")
	var b []byte
	for _, ln := range lines {
		b = append(b, []byte(ln+"\n")...)
	}
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestExtractSessionClaudeDone(t *testing.T) {
	// a minimal claude transcript: one human prompt + one assistant reply -> a resumable, done session
	path := writeTranscript(t, []string{
		`{"type":"user","cwd":"/repo","message":{"content":"harden the webhooks"}}`,
		`{"type":"assistant","message":{"model":"claude-opus","content":[{"type":"text","text":"done, hardened."}]}}`,
	})
	s, err := ExtractSession(path, "claude")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if s == nil {
		t.Fatal("want a session, got nil")
	}
	if s.Task != "harden the webhooks" {
		t.Errorf("task = %q", s.Task)
	}
	if s.Status != "done" {
		t.Errorf("status = %q, want done", s.Status)
	}
}

// The details rail (usagestats.TranscriptUsage) bills a session's subagent transcripts to it, so Sessions must count
// them too, or a session that fanned out reads far lower here than there.
func TestClaudeSessionTokensIncludeSubagents(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"user","cwd":"/repo","message":{"content":"delegate"}}`,
		`{"type":"assistant","requestId":"r0","message":{"id":"m1","content":[{"type":"text","text":"a"}],"usage":{"input_tokens":10,"output_tokens":5}}}`,
	})
	sub := filepath.Join(filepath.Dir(path), "session", "subagents")
	nested := filepath.Join(sub, "agent-1")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	child := `{"type":"assistant","requestId":"r1","isSidechain":true,"message":{"id":"s1","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":100,"output_tokens":20}}}`
	for _, p := range []string{filepath.Join(sub, "agent-1.jsonl"), filepath.Join(nested, "agent-2.jsonl")} {
		// the repeated record is one message written per content block: counted once
		if err := os.WriteFile(p, []byte(child+"\n"+child+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// only transcripts count
	if err := os.WriteFile(filepath.Join(sub, "notes.txt"), []byte(child+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := ExtractSession(path, "claude")
	if err != nil || s == nil {
		t.Fatalf("session = %v, err = %v", s, err)
	}
	if want := 15 + 120 + 120; s.TokensTotal != want {
		t.Errorf("TokensTotal = %d, want %d", s.TokensTotal, want)
	}
}

// a session that ran no subagent reads as before: the parent's own total
func TestClaudeSessionTokensWithoutSubagents(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"user","cwd":"/repo","message":{"content":"no helpers"}}`,
		`{"type":"assistant","requestId":"r0","message":{"id":"m1","content":[{"type":"text","text":"a"}],"usage":{"input_tokens":10,"output_tokens":5}}}`,
	})
	s, err := ExtractSession(path, "claude")
	if err != nil || s == nil {
		t.Fatalf("session = %v, err = %v", s, err)
	}
	if s.TokensTotal != 15 {
		t.Errorf("TokensTotal = %d, want 15", s.TokensTotal)
	}
}

// A `!` command is two user records, <bash-input> then <bash-stdout>/<bash-stderr>: a shell run, not a prompt. The
// first typed prompt names the session, and until there is one it reads "! <command>"; no title, started text or
// human prompt is ever the raw tags.
func TestBashOpenedSessionTitle(t *testing.T) {
	shell := []string{
		`{"type":"user","cwd":"/repo","entrypoint":"cli","timestamp":"2026-11-17T10:00:00.000Z","message":{"content":"<bash-input>ls</bash-input>"}}`,
		`{"type":"user","cwd":"/repo","entrypoint":"cli","timestamp":"2026-11-17T10:00:01.000Z","message":{"content":"<bash-stdout>a.go\nb.go</bash-stdout><bash-stderr></bash-stderr>"}}`,
	}
	typed := `{"type":"user","cwd":"/repo","entrypoint":"cli","timestamp":"2026-11-17T10:00:05.000Z","message":{"content":"fix the build"}}`
	for _, c := range []struct {
		name  string
		lines []string
		want  string
	}{
		{"no prompt yet", shell, "! ls"},
		{"a typed prompt follows", append(append([]string{}, shell...), typed), "fix the build"},
	} {
		t.Run(c.name, func(t *testing.T) {
			path := writeTranscript(t, c.lines)
			s, err := ExtractSession(path, "claude")
			if err != nil || s == nil {
				t.Fatalf("session = %v, err = %v", s, err)
			}
			if s.Task != c.want {
				t.Errorf("title = %q, want %q", s.Task, c.want)
			}
			if len(s.Events) == 0 || s.Events[0].Type != "started" || s.Events[0].Text != c.want {
				t.Errorf("started event = %+v, want text %q", s.Events, c.want)
			}
			for _, p := range HumanPrompts(path, "claude") {
				if strings.Contains(p.Text, "<bash-") {
					t.Errorf("human prompt %q carries shell tags", p.Text)
				}
			}
		})
	}
	// the shell's output alone opens no session
	out := writeTranscript(t, shell[1:])
	if s, err := ExtractSession(out, "claude"); err != nil || s != nil {
		t.Errorf("output alone: session = %+v, err = %v, want none", s, err)
	}
}

func TestExtractSessionUnknownRuntime(t *testing.T) {
	path := writeTranscript(t, []string{`{"type":"user","message":{"content":"x"}}`})
	if _, err := ExtractSession(path, "nope"); err == nil {
		t.Fatal("want error for unknown runtime")
	}
}
