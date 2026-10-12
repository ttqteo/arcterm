// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// callLine is an assistant line that calls tool name with id useID, as Claude Code writes one: usage on every line.
func callLine(id string, ts time.Time, useID, name string) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":%q,"requestId":"r-%s","cwd":"/w/proj","message":{"id":"m-%s","model":%q,"content":[{"type":"tool_use","id":%q,"name":%q,"input":{}}],"usage":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}`,
		ts.UTC().Format(time.RFC3339), id, id, testOpus, useID, name)
}

// resultLine is the user line that answers useID with content (a JSON string or list).
func resultLine(ts time.Time, useID string, content any) string {
	c, _ := json.Marshal(content)
	return fmt.Sprintf(`{"type":"user","timestamp":%q,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":%q,"content":%s}]}}`,
		ts.UTC().Format(time.RFC3339), useID, c)
}

func TestScanSessionUsageCountsBigToolResults(t *testing.T) {
	root := t.TempDir()
	t0 := time.Now().Add(-48 * time.Hour)
	big := strings.Repeat("x", BigResultChars+1000)
	writeJSONL(t, filepath.Join(root, "proj", "s1.jsonl"),
		callLine("a1", t0, "u1", "Read"),
		resultLine(t0, "u1", big),
		callLine("a2", t0.Add(time.Minute), "u2", "Read"),
		resultLine(t0.Add(time.Minute), "u2", big+big),
		callLine("a3", t0.Add(2*time.Minute), "u3", "Bash"),
		resultLine(t0.Add(2*time.Minute), "u3", []map[string]string{{"type": "text", "text": big}}),
		callLine("a4", t0.Add(3*time.Minute), "u4", "Read"),
		resultLine(t0.Add(3*time.Minute), "u4", "a small file"),
		resultLine(t0.Add(4*time.Minute), "u5", big), // its call is not in the file
		callLine("a6", t0.Add(-30*24*time.Hour), "u6", "Read"),
		resultLine(t0.Add(-30*24*time.Hour), "u6", big), // out of the window
	)
	writeJSONL(t, filepath.Join(root, "proj", "s1", "subagents", "agent-a.jsonl"),
		callLine("b1", t0.Add(5*time.Minute), "v1", "Read"),
		resultLine(t0.Add(5*time.Minute), "v1", big),
	)
	// a fork carries s1's first result again, under the same call id
	writeJSONL(t, filepath.Join(root, "proj", "s2.jsonl"),
		callLine("a1", t0, "u1", "Read"),
		resultLine(t0, "u1", big),
		callLine("c1", t0.Add(time.Hour), "w1", "Grep"),
	)
	sessions := scanSessionRoot(root, 7)
	n := len(big)
	want := []SessionBigResults{
		{Tool: "Read", Count: 2, Chars: 3 * n},
		{Tool: "Bash", Count: 1, Chars: n},
		{Tool: "Read", Sub: true, Count: 1, Chars: n},
		{Tool: "unknown", Count: 1, Chars: n},
	}
	if got := sessionByID(t, sessions, "s1").BigResults; !slices.Equal(got, want) {
		t.Fatalf("s1 big results = %+v, want %+v", got, want)
	}
	if got := sessionByID(t, sessions, "s2").BigResults; len(got) != 0 {
		t.Fatalf("s2 must not count the result s1 already has, got %+v", got)
	}
}

func TestTextCharsCountsTextOnly(t *testing.T) {
	cases := []struct {
		raw  string
		want int
	}{
		{`"héllo"`, 5},
		{`[{"type":"text","text":"ab"},{"type":"image","source":{"data":"QUJDREVG"}},{"type":"text","text":"cd"}]`, 4},
		{`{"weird":true}`, 0},
	}
	for _, c := range cases {
		if got := textChars(json.RawMessage(c.raw)); got != c.want {
			t.Errorf("textChars(%s) = %d, want %d", c.raw, got, c.want)
		}
	}
}

func TestBigResultsOfIgnoresAssistantLines(t *testing.T) {
	line := `{"type":"assistant","timestamp":"2026-10-01T00:00:00Z","message":{"content":[{"type":"tool_result","tool_use_id":"x","content":"` +
		strings.Repeat("y", BigResultChars+1) + `"}]}}`
	if got := bigResultsOf([]byte(line)); len(got) != 0 {
		t.Fatalf("an assistant line holds no tool result, got %+v", got)
	}
}
