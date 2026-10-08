// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var windowNow = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func usageLine(id string, at time.Time, model string, output int) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":%q,"requestId":"req_%s","message":{"id":"msg_%s","model":%q,"usage":{"input_tokens":0,"output_tokens":%d,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}`,
		at.Format(time.RFC3339), id, id, model, output)
}

func appendLines(t *testing.T, path string, lines ...string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(strings.Join(lines, "\n") + "\n"); err != nil {
		t.Fatal(err)
	}
}

func outputOf(buckets []Bucket) int {
	n := 0
	for _, b := range buckets {
		n += b.Output
	}
	return n
}

func TestWindowCountsOnlyRecordsInsideTheWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path,
		usageLine("old", windowNow.Add(-30*time.Minute), "claude-opus-4-8", 1000),
		usageLine("new", windowNow.Add(-2*time.Minute), "claude-opus-4-8", 40))
	w := NewWindowReader()
	got, ok := w.Window(path, windowNow, 10*time.Minute)
	if !ok || outputOf(got) != 40 {
		t.Fatalf("window = %v, %v; want only the 40 output tokens inside it", got, ok)
	}
}

func TestWindowReadsWhatWasAppended(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow.Add(-time.Minute), "claude-opus-4-8", 10))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	appendLines(t, path, usageLine("b", windowNow, "claude-sonnet-4-6", 5))
	got, _ := w.Window(path, windowNow, 10*time.Minute)
	if outputOf(got) != 15 || len(got) != 2 {
		t.Fatalf("after an append = %+v, want 15 output tokens over two models", got)
	}
}

func TestWindowDropsRecordsThatAgeOut(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow.Add(-9*time.Minute), "claude-opus-4-8", 10))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	if got, _ := w.Window(path, windowNow.Add(5*time.Minute), 10*time.Minute); outputOf(got) != 0 {
		t.Fatalf("a record older than the window must drop out, got %+v", got)
	}
}

func TestWindowHoldsAPartialLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	line := usageLine("a", windowNow, "claude-opus-4-8", 10)
	if err := os.WriteFile(path, []byte(line[:40]), 0o644); err != nil {
		t.Fatal(err)
	}
	w := NewWindowReader()
	if got, _ := w.Window(path, windowNow, 10*time.Minute); outputOf(got) != 0 {
		t.Fatal("a line still being written must wait")
	}
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	f.WriteString(line[40:] + "\n")
	f.Close()
	if got, _ := w.Window(path, windowNow, 10*time.Minute); outputOf(got) != 10 {
		t.Fatalf("the completed line = %+v, want 10", got)
	}
}

func TestWindowRereadsATruncatedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path,
		usageLine("a", windowNow, "claude-opus-4-8", 10),
		usageLine("b", windowNow, "claude-opus-4-8", 20))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	if err := os.WriteFile(path, []byte(usageLine("c", windowNow, "claude-opus-4-8", 7)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, _ := w.Window(path, windowNow, 10*time.Minute); outputOf(got) != 7 {
		t.Fatalf("a file that shrank must be read again from the start, got %+v", got)
	}
}

func TestWindowCountsSubagentTranscripts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow, "claude-opus-4-8", 10))
	sub := filepath.Join(dir, "s", "subagents")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	appendLines(t, filepath.Join(sub, "agent-1.jsonl"), usageLine("b", windowNow, "claude-sonnet-4-6", 3))
	if got, _ := NewWindowReader().Window(path, windowNow, 10*time.Minute); outputOf(got) != 13 {
		t.Fatalf("subagents bill like the parent, got %+v", got)
	}
}

// one pi session file: its header, a model change and one assistant message at `at`, in TranscriptUsage's pi test shape
func piSession(id string, at time.Time, model string, output int) string {
	ts := at.Format(time.RFC3339)
	return fmt.Sprintf(`{"type":"session","version":3,"id":%q,"timestamp":%q,"cwd":"/repo"}`+"\n"+
		`{"type":"model_change","id":"%s-mc","parentId":null,"timestamp":%q,"provider":"anthropic","modelId":%q}`+"\n"+
		`{"type":"message","id":"%s-m","parentId":null,"timestamp":%q,"message":{"role":"assistant","content":"x","usage":{"input":0,"output":%d,"totalTokens":%d,"cost":{"total":0}}}}`+"\n",
		id, ts, id, ts, model, id, ts, output, output)
}

// pi-subagents writes a parent's child sessions under <parent without .jsonl>/<runId>/run-<n>/session.jsonl, and
// TranscriptUsage folds them in (piSubagentRecords): the window must too, or the panel under-counts a pi agent
// that fanned out against the rail
func TestWindowCountsPiSubagentSessions(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".pi", "agent", "sessions", "proj")
	child := filepath.Join(dir, "parent", "runAbc", "run-0")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(dir, "parent.jsonl")
	if err := os.WriteFile(parent, []byte(piSession("p1", windowNow.Add(-time.Minute), "claude-opus-4-8", 10)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(child, "session.jsonl"), []byte(piSession("c1", windowNow.Add(-time.Minute), "claude-sonnet-4-6", 4)), 0o644); err != nil {
		t.Fatal(err)
	}
	got, ok := NewWindowReader().Window(parent, windowNow, 10*time.Minute)
	if !ok || outputOf(got) != 14 {
		t.Fatalf("pi child sessions bill like the parent: window = %+v, %v; want 14 output tokens", got, ok)
	}
	rail, err := TranscriptUsage(parent)
	if err != nil || outputOf(rail) != outputOf(got) {
		t.Fatalf("the window counts %d, TranscriptUsage %d (%v): the panel must count what the rail counts", outputOf(got), outputOf(rail), err)
	}
}

func TestWindowOfAMissingFileIsNotRead(t *testing.T) {
	if _, ok := NewWindowReader().Window(filepath.Join(t.TempDir(), "none.jsonl"), windowNow, 10*time.Minute); ok {
		t.Fatal("a missing transcript must report not read")
	}
}

func TestForgetDropsFilesNobodyAskedAbout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow, "claude-opus-4-8", 10))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	w.Forget(windowNow.Add(time.Second))
	if len(w.files) != 0 {
		t.Fatalf("forgotten files = %d, want 0", len(w.files))
	}
}

func shadowLine(id string, at time.Time, output int) string {
	return fmt.Sprintf(`{"type":"usage","messageID":%q,"role":"assistant","providerID":"anthropic","modelID":"claude-sonnet-4-6","time":{"created":%d},"tokens":{"input":0,"output":%d,"reasoning":0,"cache":{"read":0,"write":0}}}`,
		id, at.UnixMilli(), output)
}

// an opencode shadow carries "tokens", not "usage": the Claude filter would drop every line, so the window must
// route it to the shadow parser as TranscriptUsage does, and collapse the plugin's per-step re-emits by messageID
func TestWindowCountsOpencodeShadow(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "opencode", "waveterm")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "s.jsonl")
	appendLines(t, path,
		shadowLine("msg_old", windowNow.Add(-30*time.Minute), 1000),
		shadowLine("msg_1", windowNow.Add(-2*time.Minute), 10),
		shadowLine("msg_1", windowNow.Add(-time.Minute), 42))
	w := NewWindowReader()
	got, ok := w.Window(path, windowNow, 10*time.Minute)
	if !ok || outputOf(got) != 42 {
		t.Fatalf("window = %+v, %v; want the final 42-token snapshot of msg_1 and not the old message", got, ok)
	}
	// a later append is read incrementally and a new message adds to the total
	appendLines(t, path, shadowLine("msg_2", windowNow, 5))
	if got, _ := w.Window(path, windowNow, 10*time.Minute); outputOf(got) != 47 {
		t.Fatalf("after an append = %+v, want 47", got)
	}
	// the window agrees with TranscriptUsage over a shadow holding only the in-window records
	inWindow := filepath.Join(t.TempDir(), "opencode", "waveterm", "in.jsonl")
	if err := os.MkdirAll(filepath.Dir(inWindow), 0o755); err != nil {
		t.Fatal(err)
	}
	appendLines(t, inWindow,
		shadowLine("msg_1", windowNow.Add(-2*time.Minute), 10),
		shadowLine("msg_1", windowNow.Add(-time.Minute), 42),
		shadowLine("msg_2", windowNow, 5))
	rail, err := TranscriptUsage(inWindow)
	if err != nil || outputOf(rail) != 47 {
		t.Fatalf("TranscriptUsage = %+v, %v; want 47", rail, err)
	}
}
