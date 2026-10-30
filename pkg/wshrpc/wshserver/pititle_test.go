// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

// titleWait bounds the wait for async generation. Result returns as soon as the title settles, so a long
// bound costs nothing; 1s failed once while an engine Verify shared the machine with other runs' tests.
const titleWait = 10 * time.Second

func writePiSession(t *testing.T, lines []string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	data := ""
	for _, l := range lines {
		data += l + "\n"
	}
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func piStatusEvent(oref, state, title, transcript, sessionID string) *wps.WaveEvent {
	return &wps.WaveEvent{
		Event:  wps.Event_AgentStatus,
		Scopes: []string{oref},
		Data: baseds.AgentStatusData{
			ORef:           oref,
			State:          state,
			Agent:          "pi",
			Title:          title,
			TranscriptPath: transcript,
			SessionID:      sessionID,
			Ts:             time.Now().UnixMilli(),
		},
	}
}

func TestPiFirstUserMessage(t *testing.T) {
	cases := []struct {
		name  string
		lines []string
		want  string
	}{
		{"string content", []string{
			`{"type":"session","id":"s1"}`,
			`{"type":"message","id":"m1","message":{"role":"user","content":"first prompt"}}`,
		}, "first prompt"},
		{"text block content", []string{
			`{"type":"message","id":"m1","message":{"role":"user","content":[{"type":"text","text":"block text"}]}}`,
		}, "block text"},
		{"skips tool_result-only turns", []string{
			`{"type":"message","id":"m1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}`,
			`{"type":"message","id":"m2","message":{"role":"user","content":"the real ask"}}`,
		}, "the real ask"},
		{"skips assistant turns", []string{
			`{"type":"message","id":"m1","message":{"role":"assistant","content":"hi"}}`,
		}, ""},
		{"no user message", []string{`{"type":"session","id":"s1"}`}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := piFirstUserMessage(writePiSession(t, tc.lines)); got != tc.want {
				t.Errorf("piFirstUserMessage = %q, want %q", got, tc.want)
			}
		})
	}
	if got := piFirstUserMessage(filepath.Join(t.TempDir(), "missing.jsonl")); got != "" {
		t.Errorf("missing file: got %q, want \"\"", got)
	}
}

func TestPiHeadTitle(t *testing.T) {
	if got := piHeadTitle(""); got != "" {
		t.Errorf("empty: got %q", got)
	}
	if got := piHeadTitle("\n\n  real task\nmore lines\n"); got != "real task" {
		t.Errorf("head line: got %q", got)
	}
	long := "x"
	for i := 0; i < 100; i++ {
		long += "y"
	}
	if got := piHeadTitle(long); len([]rune(got)) != 72 {
		t.Errorf("truncate: got %d runes, want 72", len([]rune(got)))
	}
}

func TestPiTitlePrompt(t *testing.T) {
	p := piTitlePrompt("fix the flicker")
	if p == "" || len(p) < 10 {
		t.Errorf("prompt too short: %q", p)
	}
	if !strings.Contains(p, "fix the flicker") {
		t.Errorf("prompt should embed the task text: %q", p)
	}
}

func TestPiTitleProviderGeneratesOncePerTranscript(t *testing.T) {
	calls := 0
	p := NewPiTitleProvider(func(ctx context.Context, prompt string) (string, error) {
		calls++
		return "Fix agent tab flicker", nil
	})
	path := writePiSession(t, []string{`{"type":"message","id":"m1","message":{"role":"user","content":"why does the tab flicker"}}`})
	p.NoteEvent(piStatusEvent("block:uuid-1", "working", "", path, "sess-1"))
	if p.Result(path, titleWait) != "Fix agent tab flicker" {
		t.Fatalf("title not generated")
	}
	// a second event must not regenerate (cache hit)
	p.NoteEvent(piStatusEvent("block:uuid-1", "working", "", path, "sess-1"))
	if calls != 1 {
		t.Fatalf("expected 1 LLM call, got %d", calls)
	}
	// the event is enriched synchronously on cache hit
	out := piStatusEvent("block:uuid-1", "idle", "", path, "sess-1")
	p.NoteEvent(out)
	if title := out.Data.(baseds.AgentStatusData).Title; title != "Fix agent tab flicker" {
		t.Fatalf("cache-hit enrichment missing title: %q", title)
	}
}

func TestPiTitleProviderFallsBackToHeadText(t *testing.T) {
	p := NewPiTitleProvider(func(ctx context.Context, prompt string) (string, error) {
		return "", nil // LLM returned nothing
	})
	path := writePiSession(t, []string{`{"type":"message","id":"m1","message":{"role":"user","content":"  real task line\nmore"}}`})
	p.NoteEvent(piStatusEvent("block:uuid-1", "working", "", path, "sess-1"))
	if got := p.Result(path, titleWait); got != "real task line" {
		t.Fatalf("fallback title = %q, want %q", got, "real task line")
	}
}

func TestPiTitleProviderSkipsTitledAndNonPiEvents(t *testing.T) {
	calls := 0
	p := NewPiTitleProvider(func(ctx context.Context, prompt string) (string, error) {
		calls++
		return "t", nil
	})
	// explicit title: no generation
	p.NoteEvent(piStatusEvent("block:uuid-1", "working", "user given name", "", "sess-1"))
	// non-pi agent: no generation
	ev := piStatusEvent("block:uuid-2", "working", "", "", "sess-2")
	d := ev.Data.(baseds.AgentStatusData)
	d.Agent = "claude"
	ev.Data = d
	p.NoteEvent(ev)
	// no transcript: no generation
	p.NoteEvent(piStatusEvent("block:uuid-3", "working", "", "", "sess-3"))
	if calls != 0 {
		t.Fatalf("expected 0 LLM calls, got %d", calls)
	}
}

func TestPiTitleProviderRetriesUntilFirstUserMessage(t *testing.T) {
	calls := 0
	p := NewPiTitleProvider(func(ctx context.Context, prompt string) (string, error) {
		calls++
		return "Fix the flicker", nil
	})
	// boot: the transcript exists but the first user message has not been written yet
	path := writePiSession(t, []string{`{"type":"session","id":"s1"}`})
	p.NoteEvent(piStatusEvent("block:uuid-1", "idle", "", path, "sess-1"))
	if got := p.Result(path, 200*time.Millisecond); got != "" {
		t.Fatalf("empty transcript must not settle a title, got %q", got)
	}
	if calls != 0 {
		t.Fatalf("no LLM call expected for an empty transcript, got %d", calls)
	}
	// the first user message arrives; a later event must retry and generate
	if err := os.WriteFile(path, []byte(`{"type":"session","id":"s1"}`+"\n"+`{"type":"message","id":"m1","message":{"role":"user","content":"fix the flicker"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	p.NoteEvent(piStatusEvent("block:uuid-1", "working", "", path, "sess-1"))
	if got := p.Result(path, titleWait); got != "Fix the flicker" {
		t.Fatalf("title not generated after the first message: %q", got)
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 LLM call, got %d", calls)
	}
}

func TestPiTitleProviderHandlesWireShapedEvents(t *testing.T) {
	calls := 0
	p := NewPiTitleProvider(func(ctx context.Context, prompt string) (string, error) {
		calls++
		return "Fix the flicker", nil
	})
	path := writePiSession(t, []string{
		`{"type":"session","id":"s1"}`,
		`{"type":"message","id":"m1","message":{"role":"user","content":"fix the flicker"}}`,
	})
	ev := piStatusEvent("block:uuid-1", "working", "", path, "sess-1")
	// round-trip through JSON to reproduce the RPC wire shape: WaveEvent.Data has no runtime
	// type registry, so it decodes as a plain map, not baseds.AgentStatusData.
	raw, err := json.Marshal(ev)
	if err != nil {
		t.Fatal(err)
	}
	var wireEv wps.WaveEvent
	if err := json.Unmarshal(raw, &wireEv); err != nil {
		t.Fatal(err)
	}
	p.NoteEvent(&wireEv)
	if got := p.Result(path, titleWait); got != "Fix the flicker" {
		t.Fatalf("wire-shaped event must generate a title, got %q (calls=%d)", got, calls)
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 LLM call, got %d", calls)
	}
}

func TestPiTitleProviderTracksLatestState(t *testing.T) {
	p := NewPiTitleProvider(func(ctx context.Context, prompt string) (string, error) {
		return "t", nil
	})
	path := writePiSession(t, []string{`{"type":"message","id":"m1","message":{"role":"user","content":"why"}}`})
	p.NoteEvent(piStatusEvent("block:uuid-1", "working", "", path, "sess-1"))
	p.NoteEvent(piStatusEvent("block:uuid-1", "idle", "", path, "sess-1"))
	p.mu.Lock()
	state := p.lastState["block:uuid-1"]
	p.mu.Unlock()
	if state != "idle" {
		t.Fatalf("lastState = %q, want idle", state)
	}
}
