// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestReadTranscriptTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.jsonl")
	// blank line in the middle must be skipped
	if err := os.WriteFile(path, []byte("a\n\nb\nc\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	all, err := readTranscriptTail(path, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("want 3 non-empty lines, got %d (%v)", len(all), all)
	}

	tail, err := readTranscriptTail(path, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail) != 2 || tail[0] != "b" || tail[1] != "c" {
		t.Fatalf("want [b c], got %v", tail)
	}

	if _, err := readTranscriptTail(filepath.Join(dir, "nope.jsonl"), 0); err == nil {
		t.Fatal("expected error for missing file")
	}
	if _, err := readTranscriptTail("", 0); err == nil {
		t.Fatal("expected error for empty path")
	}
	if _, err := readTranscriptTail(dir, 0); err == nil {
		t.Fatal("expected error when path is a directory")
	}
}

// taillines/maxlines -1 requests complete history: every complete line comes back, while a positive
// limit still tails (the bounded behavior all other runtimes use). Pi alone requests the full read.
func TestReadTranscriptTailNegativeIsAllLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.jsonl")
	var b strings.Builder
	for i := 0; i < defaultTranscriptTailLines+25; i++ {
		b.WriteString(fmt.Sprintf("line-%d\n", i))
	}
	writeFile(t, path, b.String())

	all, err := readTranscriptTail(path, -1)
	if err != nil {
		t.Fatalf("readTranscriptTail(-1): %v", err)
	}
	if len(all) != defaultTranscriptTailLines+25 {
		t.Fatalf("want all %d lines, got %d", defaultTranscriptTailLines+25, len(all))
	}

	tail, err := readTranscriptTail(path, defaultTranscriptTailLines)
	if err != nil {
		t.Fatalf("readTranscriptTail(default): %v", err)
	}
	if len(tail) != defaultTranscriptTailLines {
		t.Fatalf("want default %d tail lines, got %d", defaultTranscriptTailLines, len(tail))
	}
}

// streamTranscript with tailLines -1 sends the whole backlog; a positive tailLines still truncates.
func TestStreamTranscriptNegativeTailSendsAllBacklog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "s.jsonl")
	var b strings.Builder
	for i := 0; i < defaultTranscriptTailLines+10; i++ {
		b.WriteString(fmt.Sprintf("{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"l%d\"}]}}\n", i))
	}
	writeFile(t, path, b.String())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate], 16)
	done := make(chan struct{})
	go func() {
		_ = streamTranscript(ctx, path, -1, ch)
		close(done)
	}()

	select {
	case msg := <-ch:
		if msg.Error != nil {
			t.Fatalf("backlog error: %v", msg.Error)
		}
		if len(msg.Response.Lines) != defaultTranscriptTailLines+10 {
			t.Fatalf("want all %d backlog lines, got %d", defaultTranscriptTailLines+10, len(msg.Response.Lines))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for backlog")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("streamTranscript did not return after cancel")
	}
}

func TestReadTranscriptHead(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.jsonl")
	// blank line in the middle must be skipped
	if err := os.WriteFile(path, []byte("a\n\nb\nc\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	all, err := readTranscriptHead(path, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("want 3 non-empty lines, got %d (%v)", len(all), all)
	}

	head, err := readTranscriptHead(path, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(head) != 2 || head[0] != "a" || head[1] != "b" {
		t.Fatalf("want [a b], got %v", head)
	}

	if _, err := readTranscriptHead(filepath.Join(dir, "nope.jsonl"), 0); err == nil {
		t.Fatal("expected error for missing file")
	}
	if _, err := readTranscriptHead("", 0); err == nil {
		t.Fatal("expected error for empty path")
	}
	if _, err := readTranscriptHead(dir, 0); err == nil {
		t.Fatal("expected error when path is a directory")
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func appendFile(t *testing.T, path, content string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatalf("open append: %v", err)
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		t.Fatalf("append: %v", err)
	}
}

func TestTranscriptTailer(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.jsonl")
	writeFile(t, path, "a\nb\n")
	tl := &transcriptTailer{}

	got, err := tl.readNew(path)
	if err != nil {
		t.Fatalf("readNew: %v", err)
	}
	if !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("initial: got %v", got)
	}

	// no change -> no lines
	got, _ = tl.readNew(path)
	if len(got) != 0 {
		t.Fatalf("no-change: got %v", got)
	}

	// partial line buffered until its newline arrives, then joined
	appendFile(t, path, "c")
	got, _ = tl.readNew(path)
	if len(got) != 0 {
		t.Fatalf("partial: expected none, got %v", got)
	}
	appendFile(t, path, "d\n")
	got, _ = tl.readNew(path)
	if !reflect.DeepEqual(got, []string{"cd"}) {
		t.Fatalf("join: got %v", got)
	}

	// truncation resets the offset
	writeFile(t, path, "x\n")
	got, _ = tl.readNew(path)
	if !reflect.DeepEqual(got, []string{"x"}) {
		t.Fatalf("truncate: got %v", got)
	}
}

func TestStreamTranscript(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "s.jsonl")
	writeFile(t, path, `{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}`+"\n")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate], 16)
	done := make(chan struct{})
	go func() {
		_ = streamTranscript(ctx, path, 100, ch)
		close(done)
	}()

	// backlog chunk
	select {
	case msg := <-ch:
		if msg.Error != nil || len(msg.Response.Lines) != 1 {
			t.Fatalf("backlog: %+v", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for backlog")
	}

	// append -> incremental chunk
	appendFile(t, path, `{"type":"assistant","message":{"content":[{"type":"text","text":"world"}]}}`+"\n")
	select {
	case msg := <-ch:
		if msg.Error != nil || len(msg.Response.Lines) != 1 {
			t.Fatalf("increment: %+v", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for increment")
	}

	// cancel -> loop returns
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("streamTranscript did not return after cancel")
	}
}

// A freshly-spawned worker reports its transcript path (SessionStart hook) before Claude has created
// the JSONL file on disk. The stream must not die on the absent file — it must watch the dir and pick
// up the file once it appears. Regression guard for the "run shows no transcript until you tab away
// and back" bug (the tab switch remounted RunBody, which re-attempted the by-then-existing file).
func TestStreamTranscriptFileCreatedLater(t *testing.T) {
	dir := t.TempDir() // dir exists; the file does not yet
	path := filepath.Join(dir, "later.jsonl")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate], 16)
	done := make(chan struct{})
	var streamErr error
	go func() {
		streamErr = streamTranscript(ctx, path, 100, ch)
		close(done)
	}()

	// empty backlog for the not-yet-existing file — the stream must stay open, not error out
	select {
	case msg := <-ch:
		if msg.Error != nil {
			t.Fatalf("initial backlog errored on missing file: %v", msg.Error)
		}
		if len(msg.Response.Lines) != 0 {
			t.Fatalf("want empty backlog, got %v", msg.Response.Lines)
		}
	case <-done:
		t.Fatalf("streamTranscript returned before the file was created: %v", streamErr)
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for empty backlog")
	}

	// the file appears after the stream started -> its lines must be delivered
	writeFile(t, path, `{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}`+"\n")
	select {
	case msg := <-ch:
		if msg.Error != nil || len(msg.Response.Lines) != 1 {
			t.Fatalf("increment after create: %+v", msg)
		}
	case <-done:
		t.Fatalf("streamTranscript returned before delivering created lines: %v", streamErr)
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for created-file lines")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("streamTranscript did not return after cancel")
	}
}

func TestListSubagents(t *testing.T) {
	dir := t.TempDir()
	parent := filepath.Join(dir, "sess.jsonl")
	if err := os.WriteFile(parent, []byte(`{"type":"user"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	subdir := filepath.Join(dir, "sess", "subagents")
	if err := os.MkdirAll(subdir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(id, prompt string) {
		rec := `{"agentId":"` + id + `","type":"user","message":{"content":"` + prompt + `"}}` + "\n"
		if err := os.WriteFile(filepath.Join(subdir, "agent-"+id+".jsonl"), []byte(rec), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("aaa", "Explore the repo")
	write("bbb", "Plan the work")

	infos, err := listSubagents(parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 2 {
		t.Fatalf("want 2 infos, got %d", len(infos))
	}
	byId := map[string]wshrpc.SubagentFileInfo{}
	for _, in := range infos {
		byId[in.AgentId] = in
	}
	if byId["aaa"].FirstPrompt != "Explore the repo" {
		t.Errorf("firstPrompt aaa = %q", byId["aaa"].FirstPrompt)
	}
	if byId["bbb"].TranscriptPath != filepath.Join(subdir, "agent-bbb.jsonl") {
		t.Errorf("transcriptPath bbb = %q", byId["bbb"].TranscriptPath)
	}
}

func TestListSubagentsMissingDir(t *testing.T) {
	dir := t.TempDir()
	parent := filepath.Join(dir, "none.jsonl")
	if err := os.WriteFile(parent, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	infos, err := listSubagents(parent)
	if err != nil {
		t.Fatalf("missing subagents dir must not error: %v", err)
	}
	if len(infos) != 0 {
		t.Fatalf("want 0 infos, got %d", len(infos))
	}
}

func TestSubagentDoneSignal(t *testing.T) {
	dir := t.TempDir()
	parent := filepath.Join(dir, "sess.jsonl")
	if err := os.WriteFile(parent, []byte(`{"type":"user"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	subdir := filepath.Join(dir, "sess", "subagents")
	if err := os.MkdirAll(subdir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeRecs := func(id string, recs ...string) {
		if err := os.WriteFile(filepath.Join(subdir, "agent-"+id+".jsonl"), []byte(strings.Join(recs, "\n")+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// terminated: last record is an assistant text turn
	writeRecs("done1",
		`{"agentId":"done1","type":"user","message":{"content":"Explore"}}`,
		`{"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"result"}]}}`)
	// live: last record is a pending tool_use
	writeRecs("live1",
		`{"agentId":"live1","type":"user","message":{"content":"Plan"}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}`)

	infos, err := listSubagents(parent)
	if err != nil {
		t.Fatal(err)
	}
	byId := map[string]wshrpc.SubagentFileInfo{}
	for _, in := range infos {
		byId[in.AgentId] = in
	}
	if !byId["done1"].Done {
		t.Errorf("done1: want Done=true")
	}
	if byId["live1"].Done {
		t.Errorf("live1: want Done=false (pending tool_use)")
	}
}

// The endings claude writes today, tallied over 305 real subagent files on 2026-10-06: a hand-back (182), a text
// turn followed by hook attachments (33), a user interrupt (11). Each finished; one cut off mid-tool did not.
func TestSubagentDoneSignalReadsTodaysEndings(t *testing.T) {
	dir := t.TempDir()
	parent := filepath.Join(dir, "sess.jsonl")
	if err := os.WriteFile(parent, []byte(`{"type":"user"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	subdir := filepath.Join(dir, "sess", "subagents")
	if err := os.MkdirAll(subdir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeRecs := func(id string, recs ...string) {
		if err := os.WriteFile(filepath.Join(subdir, "agent-"+id+".jsonl"), []byte(strings.Join(recs, "\n")+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	hook := `{"type":"attachment","attachment":{"type":"hook_success","hookName":"PostToolUse:Bash"}}`
	writeRecs("handback",
		`{"agentId":"handback","type":"user","message":{"content":"Map the rail"}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"h1","name":"SubagentHandback","input":{"report":"done"}}]}}`,
		hook,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"h1","content":[{"type":"text","text":"{\"success\":true,\"message\":\"Report delivered to your caller.\"}"}]}]}}`,
		hook,
		hook)
	writeRecs("texthooks",
		`{"agentId":"texthooks","type":"user","message":{"content":"Explore"}}`,
		`{"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"result"}]}}`,
		hook,
		hook)
	writeRecs("interrupted",
		`{"agentId":"interrupted","type":"user","message":{"content":"Plan"}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"r1","name":"Read"}]}}`,
		`{"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}`)
	writeRecs("midtool",
		`{"agentId":"midtool","type":"user","message":{"content":"Fix it"}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"e1","name":"Edit"}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"e1","content":"ok"}]}}`,
		hook)

	infos, err := listSubagents(parent)
	if err != nil {
		t.Fatal(err)
	}
	byId := map[string]wshrpc.SubagentFileInfo{}
	for _, in := range infos {
		byId[in.AgentId] = in
	}
	for id, want := range map[string]bool{"handback": true, "texthooks": true, "interrupted": true, "midtool": false} {
		if byId[id].Done != want {
			t.Errorf("%s: Done = %v, want %v", id, byId[id].Done, want)
		}
	}
}
