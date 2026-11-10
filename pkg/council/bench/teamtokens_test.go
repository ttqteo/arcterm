// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// tUse is one tool use in a fixture line: its name, its id and its input as JSON.
type tUse struct{ name, id, input string }

// tLine is one assistant line of a fixture transcript: the message id it belongs to, its usage as input, cache read,
// cache creation and output tokens, and the tool uses it holds.
func tLine(msgID string, in, cacheRead, cacheCreate, out int64, uses ...tUse) string {
	content := []map[string]any{{"type": "text", "text": "thinking aloud"}}
	for _, u := range uses {
		content = append(content, map[string]any{"type": "tool_use", "id": u.id, "name": u.name, "input": json.RawMessage(u.input)})
	}
	b, err := json.Marshal(map[string]any{
		"type": "assistant",
		"uuid": "uuid-" + msgID,
		"message": map[string]any{
			"id":      msgID,
			"content": content,
			"usage": map[string]any{
				"input_tokens": in, "cache_read_input_tokens": cacheRead,
				"cache_creation_input_tokens": cacheCreate, "output_tokens": out,
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return string(b)
}

// writeTranscript writes a fixture transcript, with a user line (a tool result, which holds no usage) before the lines
// and a cut line after them, as a killed session leaves one.
func writeTranscript(t *testing.T, path string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	all := append([]string{`{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"ok"}]}}`}, lines...)
	all = append(all, `{"type":"assistant","message":{"id":"cut`)
	if err := os.WriteFile(path, []byte(strings.Join(all, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// fixtureSession writes a lead file and two teammate files for one session under a fresh projects folder (found through
// CLAUDE_CONFIG_DIR) and returns the lead's path. Their sum is 1185 tokens, 2 SendMessage uses and 2 key reads.
func fixtureSession(t *testing.T, session string) string {
	t.Helper()
	cfg := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	lead := filepath.Join(cfg, "projects", "proj", session+".jsonl")
	writeTranscript(t, lead,
		// one message split over two lines that share an id: its usage repeats and its output grows, 1115 tokens once
		tLine("m1", 10, 100, 1000, 2),
		tLine("m1", 10, 100, 1000, 5, tUse{"Agent", "t1", `{"prompt":"read council-bench/keys/x.md"}`}),
		tLine("m2", 20, 0, 0, 30,
			tUse{"SendMessage", "t2", `{"to":"UX","message":"go on"}`},
			tUse{"Read", "t3", `{"file_path":"C:\\data\\council-bench\\keys\\spec.md"}`},
			tUse{"Read", "t6", `{"file_path":"C:\\work\\project\\pkg\\council\\bench\\team.go"}`}),
		tLine("m2", 20, 0, 0, 30, tUse{"SendMessage", "t2", `{"to":"UX","message":"go on"}`}), // a repeated line: still one use
	)
	sub := filepath.Join(cfg, "projects", "proj", session, "subagents")
	writeTranscript(t, filepath.Join(sub, "agent-a.jsonl"),
		tLine("m3", 1, 2, 3, 4, tUse{"SendMessage", "t4", `{"to":"lead","message":"done"}`}),
		tLine("m3", 1, 2, 3, 4),
		tLine("m3b", 0, 0, 0, 0)) // a message with nothing counted
	writeTranscript(t, filepath.Join(sub, "agent-b.jsonl"),
		tLine("m4", 7, 0, 0, 3, tUse{"Grep", "t5", `{"pattern":"x","path":"C:/data/council-bench/keys"}`}))
	return lead
}

func TestTeamTokensCountsOverTranscripts(t *testing.T) {
	lead := fixtureSession(t, "sess-1")

	found, err := leadTranscript("sess-1")
	if err != nil || found != lead {
		t.Fatalf("leadTranscript = %q, %v; want %q", found, err, lead)
	}
	st, err := readTranscripts(lead)
	if err != nil {
		t.Fatal(err)
	}
	// m1 once (1115), m2 once (50), m3 once (10), m4 (10)
	if st.Tokens != 1185 {
		t.Errorf("tokens = %d, want 1185 (a split message counted once, the longest output)", st.Tokens)
	}
	if st.Messages != 2 {
		t.Errorf("messages = %d, want 2 SendMessage uses (t2 once, t4)", st.Messages)
	}
	if st.KeyReads != 2 {
		t.Errorf("key reads = %d, want 2: a Read with backslashes and a Grep with slashes, not the Agent prompt that names the folder, not pkg/council/bench", st.KeyReads)
	}
	if st.Teammates != 2 {
		t.Errorf("teammates = %d, want 2 transcripts read", st.Teammates)
	}
}

func TestTeamTokensNoTeammates(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	lead := filepath.Join(cfg, "projects", "proj", "alone.jsonl")
	writeTranscript(t, lead, tLine("m1", 1, 1, 1, 1))
	st, err := readTranscripts(lead)
	if err != nil {
		t.Fatal(err)
	}
	if st.Tokens != 4 || st.Teammates != 0 {
		t.Errorf("got %+v, want 4 tokens and no teammate", st)
	}
}

// TestTeamClaudeConfigDir proves the config-dir helper the brainstorm runner shares with the transcript lookup: the
// projects folder is still <config dir>/projects, and the config dir still falls back to ~/.claude.
func TestTeamClaudeConfigDir(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	if got, err := claudeConfigDir(); err != nil || got != cfg {
		t.Errorf("claudeConfigDir = %q, %v; want %q", got, err, cfg)
	}
	if got, err := claudeProjectsDir(); err != nil || got != filepath.Join(cfg, "projects") {
		t.Errorf("claudeProjectsDir = %q, %v; want %q", got, err, filepath.Join(cfg, "projects"))
	}

	home := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	if got, err := claudeConfigDir(); err != nil || got != filepath.Join(home, ".claude") {
		t.Errorf("claudeConfigDir with no CLAUDE_CONFIG_DIR = %q, %v; want %q", got, err, filepath.Join(home, ".claude"))
	}
	if got, err := claudeProjectsDir(); err != nil || got != filepath.Join(home, ".claude", "projects") {
		t.Errorf("claudeProjectsDir with no CLAUDE_CONFIG_DIR = %q, %v; want %q", got, err, filepath.Join(home, ".claude", "projects"))
	}
}

func TestTeamTokensMissingTranscript(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	if p, err := leadTranscript("nobody"); err == nil {
		t.Errorf("a session with no transcript found %q", p)
	}
}

func TestTeamTokensUsageGapLogged(t *testing.T) {
	buf := captureLog(t)

	checkModelUsage("case-x", 1000, 1050) // 4.8% under: quiet
	checkModelUsage("case-x", 1000, 0)    // no modelUsage to compare with: quiet
	if buf.Len() != 0 {
		t.Fatalf("a gap within 5%% logged %q", buf.String())
	}
	checkModelUsage("case-x", 1000, 1100) // 9.1%
	for _, want := range []string{"case-x", "1000", "1100"} {
		if !strings.Contains(buf.String(), want) {
			t.Errorf("the gap's log line lacks %q: %q", want, buf.String())
		}
	}
}
