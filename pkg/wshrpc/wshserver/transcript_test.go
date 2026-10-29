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

// numberedLines is n newline-terminated lines "l0" … "l<n-1>".
func numberedLines(n int) string {
	var b strings.Builder
	for i := range n {
		fmt.Fprintf(&b, "l%d\n", i)
	}
	return b.String()
}

func lineRange(from, to int) []string {
	var out []string
	for i := from; i < to; i++ {
		out = append(out, fmt.Sprintf("l%d", i))
	}
	return out
}

func readAgentTranscriptOK(t *testing.T, data wshrpc.CommandGetAgentTranscriptData) *wshrpc.CommandGetAgentTranscriptRtnData {
	t.Helper()
	rtn, err := readAgentTranscript(data)
	if err != nil {
		t.Fatalf("readAgentTranscript(%+v): %v", data, err)
	}
	return rtn
}

func TestTranscriptSliceLines(t *testing.T) {
	lines := lineRange(0, 10)
	cases := []struct {
		name      string
		maxLines  int
		before    int
		fromStart bool
		want      []string
		wantStart int
	}{
		{"tail", 3, 0, false, lineRange(7, 10), 7},
		{"tail longer than the file", 50, 0, false, lines, 0},
		{"tail negative is every line", -1, 0, false, lines, 0},
		{"head", 3, 0, true, lineRange(0, 3), 0},
		{"head 0 and negative keep the default", -5, 0, true, lines, 0},
		{"before in the middle", 3, 6, false, lineRange(3, 6), 3},
		{"before at 1", 5, 1, false, lineRange(0, 1), 0},
		{"before past the end clamps", 4, 99, false, lineRange(6, 10), 6},
		{"before with fewer lines than the chunk", 5, 2, false, lineRange(0, 2), 0},
		{"before negative maxlines is everything before it", -1, 4, false, lineRange(0, 4), 0},
	}
	for _, c := range cases {
		got, start := sliceTranscriptLines(lines, c.maxLines, c.before, c.fromStart)
		if !reflect.DeepEqual(got, c.want) || start != c.wantStart {
			t.Errorf("%s: got %v from %d, want %v from %d", c.name, got, start, c.want, c.wantStart)
		}
	}

	long := lineRange(0, defaultTranscriptTailLines+50)
	got, start := sliceTranscriptLines(long, 0, len(long)-10, false)
	if len(got) != defaultTranscriptTailLines || start != len(long)-10-defaultTranscriptTailLines {
		t.Errorf("before with maxlines 0: got %d lines from %d, want the default %d ending at %d",
			len(got), start, defaultTranscriptTailLines, len(long)-10)
	}
	if got, start := sliceTranscriptLines(nil, 5, 0, false); len(got) != 0 || start != 0 {
		t.Errorf("no lines: got %v from %d", got, start)
	}
}

func TestTranscriptTailReportsStartTotalEnd(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	// a blank line is not numbered: the file holds four lines
	content := "l0\n\nl1\nl2\nl3\n"
	writeFile(t, path, content)

	rtn := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, MaxLines: 2})
	if !reflect.DeepEqual(rtn.Lines, []string{"l2", "l3"}) {
		t.Fatalf("lines = %v", rtn.Lines)
	}
	if rtn.Start != 2 || rtn.Total != 4 || rtn.End != int64(len(content)) || rtn.Partial || rtn.Reset {
		t.Fatalf("start/total/end/partial/reset = %d/%d/%d/%v/%v, want 2/4/%d/false/false",
			rtn.Start, rtn.Total, rtn.End, rtn.Partial, rtn.Reset, len(content))
	}

	// neither Before nor FromByte set: the same lines the tail and head reads give
	tail, err := readTranscriptTail(path, 2)
	if err != nil || !reflect.DeepEqual(tail, rtn.Lines) {
		t.Fatalf("readTranscriptTail = %v, %v", tail, err)
	}
	head := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, MaxLines: 2, FromStart: true})
	if !reflect.DeepEqual(head.Lines, []string{"l0", "l1"}) || head.Start != 0 || head.Total != 4 || head.End != int64(len(content)) {
		t.Fatalf("head = %+v", head)
	}
}

func TestTranscriptPartialLastLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	writeFile(t, path, "l0\nl1\nl2")

	// the unfinished line comes back, flagged, and End stays before it
	rtn := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path})
	if !reflect.DeepEqual(rtn.Lines, []string{"l0", "l1", "l2"}) || rtn.Total != 3 || !rtn.Partial || rtn.End != int64(len("l0\nl1\n")) {
		t.Fatalf("tail = %+v", rtn)
	}
	// a window that stops short of it has nothing partial
	head := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, MaxLines: 2, FromStart: true})
	if head.Partial || head.End != rtn.End || head.Total != 3 {
		t.Fatalf("head = %+v", head)
	}
	before := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, Before: 2})
	if before.Partial || !reflect.DeepEqual(before.Lines, []string{"l0", "l1"}) {
		t.Fatalf("before 2 = %+v", before)
	}
	// a Before past the end reaches it
	if past := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, Before: 99}); !past.Partial || past.Start != 0 || len(past.Lines) != 3 {
		t.Fatalf("before 99 = %+v", past)
	}

	// trailing whitespace with no newline is not a line
	writeFile(t, path, "l0\nl1\n  ")
	blank := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path})
	if blank.Partial || blank.Total != 2 || blank.End != int64(len("l0\nl1\n")) {
		t.Fatalf("whitespace tail = %+v", blank)
	}
}

func TestTranscriptBefore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	writeFile(t, path, numberedLines(10))
	end := int64(len(numberedLines(10)))

	cases := []struct {
		name      string
		maxLines  int
		before    int
		want      []string
		wantStart int
	}{
		{"in the middle", 3, 6, lineRange(3, 6), 3},
		{"at 1", 5, 1, lineRange(0, 1), 0},
		{"past the end", 4, 99, lineRange(6, 10), 6},
	}
	for _, c := range cases {
		rtn := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, MaxLines: c.maxLines, Before: c.before})
		if !reflect.DeepEqual(rtn.Lines, c.want) || rtn.Start != c.wantStart || rtn.Total != 10 || rtn.End != end || rtn.Partial {
			t.Errorf("before %s: %+v, want %v from %d of 10", c.name, rtn, c.want, c.wantStart)
		}
	}

	// MaxLines 0 keeps the default chunk
	writeFile(t, path, numberedLines(defaultTranscriptTailLines+40))
	rtn := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, Before: defaultTranscriptTailLines + 30})
	if len(rtn.Lines) != defaultTranscriptTailLines || rtn.Start != 30 || rtn.Lines[0] != "l30" {
		t.Fatalf("before with maxlines 0: %d lines from %d", len(rtn.Lines), rtn.Start)
	}
}

// Pi asks for maxlines -1, the whole file, which starts at line 0.
func TestTranscriptPiNegativeMaxLinesStartsAtZero(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	n := defaultTranscriptTailLines + 25
	writeFile(t, path, numberedLines(n))

	rtn := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, MaxLines: -1})
	if len(rtn.Lines) != n || rtn.Start != 0 || rtn.Total != n {
		t.Fatalf("got %d lines from %d of %d, want all %d from 0", len(rtn.Lines), rtn.Start, rtn.Total, n)
	}
}

func TestTranscriptFromByte(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	writeFile(t, path, "l0\nl1\n")
	end := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path}).End
	if end != int64(len("l0\nl1\n")) {
		t.Fatalf("tail end = %d", end)
	}

	// at End with nothing new: no lines (an empty list, not null), End unchanged
	rtn := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: end})
	if rtn.Lines == nil || len(rtn.Lines) != 0 || rtn.End != end || rtn.Reset || rtn.Partial || rtn.Start != 0 || rtn.Total != 0 {
		t.Fatalf("nothing new = %+v", rtn)
	}

	// two new lines come back, and End moves past them
	appendFile(t, path, "l2\n\nl3\n")
	rtn = readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: end, MaxLines: 1})
	size := int64(len("l0\nl1\nl2\n\nl3\n"))
	if !reflect.DeepEqual(rtn.Lines, []string{"l2", "l3"}) || rtn.End != size || rtn.Start != 0 || rtn.Total != 0 {
		t.Fatalf("two new lines = %+v, want l2 l3 ending at %d", rtn, size)
	}
	end = rtn.End

	// a half-written line is left out and End stays before it
	appendFile(t, path, `{"half`)
	rtn = readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: end})
	if len(rtn.Lines) != 0 || rtn.End != end || rtn.Partial {
		t.Fatalf("half-written line = %+v, want no lines and End %d", rtn, end)
	}
	// finished, it comes back whole, with the line after it
	appendFile(t, path, "\"}\nl5\nl6")
	rtn = readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: end})
	if !reflect.DeepEqual(rtn.Lines, []string{`{"half"}`, "l5"}) || rtn.End != end+int64(len(`{"half"}`+"\nl5\n")) {
		t.Fatalf("finished line = %+v", rtn)
	}

	// a file shorter than FromByte was replaced: Reset, no lines
	writeFile(t, path, "x\n")
	rtn = readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: end})
	if !rtn.Reset || rtn.Lines == nil || len(rtn.Lines) != 0 {
		t.Fatalf("shorter file = %+v", rtn)
	}
}

// An append reads from the offset on: what lies before it is never looked at, even when it is not valid lines.
func TestTranscriptFromByteSkipsEarlierBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	writeFile(t, path, "not a whole line then\nl1\nl2\n")
	from := int64(len("not a whole line then\n"))

	rtn := readAgentTranscriptOK(t, wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: from})
	if !reflect.DeepEqual(rtn.Lines, []string{"l1", "l2"}) || rtn.End != int64(len("not a whole line then\nl1\nl2\n")) {
		t.Fatalf("from %d = %+v", from, rtn)
	}
}

func TestTranscriptFromByteErrors(t *testing.T) {
	dir := t.TempDir()
	if _, err := readAgentTranscript(wshrpc.CommandGetAgentTranscriptData{Path: filepath.Join(dir, "nope.jsonl"), FromByte: 5}); err == nil {
		t.Error("expected an error for a missing file")
	}
	if _, err := readAgentTranscript(wshrpc.CommandGetAgentTranscriptData{FromByte: 5}); err == nil {
		t.Error("expected an error for an empty path")
	}
	if _, err := readAgentTranscript(wshrpc.CommandGetAgentTranscriptData{Path: dir, FromByte: 5}); err == nil {
		t.Error("expected an error when the path is a directory")
	}
}

func TestTranscriptReadClashAndNegativeErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	writeFile(t, path, numberedLines(5))

	cases := []struct {
		name string
		data wshrpc.CommandGetAgentTranscriptData
		want []string // words the error names
	}{
		{"before and frombyte", wshrpc.CommandGetAgentTranscriptData{Path: path, Before: 2, FromByte: 3}, []string{"before", "frombyte"}},
		{"before and fromstart", wshrpc.CommandGetAgentTranscriptData{Path: path, Before: 2, FromStart: true}, []string{"before", "fromstart"}},
		{"frombyte and fromstart", wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: 3, FromStart: true}, []string{"frombyte", "fromstart"}},
		{"all three", wshrpc.CommandGetAgentTranscriptData{Path: path, Before: 2, FromByte: 3, FromStart: true}, []string{"before", "frombyte", "fromstart"}},
		{"negative before", wshrpc.CommandGetAgentTranscriptData{Path: path, Before: -1}, []string{"before", "negative"}},
		{"negative frombyte", wshrpc.CommandGetAgentTranscriptData{Path: path, FromByte: -1}, []string{"frombyte", "negative"}},
	}
	for _, c := range cases {
		_, err := readAgentTranscript(c.data)
		if err == nil {
			t.Errorf("%s: expected an error", c.name)
			continue
		}
		for _, w := range c.want {
			if !strings.Contains(err.Error(), w) {
				t.Errorf("%s: error %q does not name %q", c.name, err, w)
			}
		}
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

// A subagent's model is the one its latest assistant turn names; claude's "<synthetic>" stand-in turns (an
// interrupt, an API error) name none, and a child that has not answered yet has no model.
func TestSubagentModel(t *testing.T) {
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
	writeRecs("answered",
		`{"agentId":"answered","type":"user","message":{"content":"Explore"}}`,
		`{"type":"assistant","message":{"model":"claude-haiku-4-5","content":[{"type":"tool_use","id":"r1","name":"Read"}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"r1","content":"ok"}]}}`,
		`{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"result"}]}}`,
		`{"type":"attachment","attachment":{"type":"hook_success"}}`)
	writeRecs("synthetic",
		`{"agentId":"synthetic","type":"user","message":{"content":"Plan"}}`,
		`{"type":"assistant","message":{"model":"claude-sonnet-5-5","content":[{"type":"tool_use","id":"r1","name":"Read"}]}}`,
		`{"type":"assistant","message":{"model":"<synthetic>","content":[{"type":"text","text":"API Error"}]}}`)
	writeRecs("fresh",
		`{"agentId":"fresh","type":"user","message":{"content":"Fix it"}}`)

	infos, err := listSubagents(parent)
	if err != nil {
		t.Fatal(err)
	}
	byId := map[string]wshrpc.SubagentFileInfo{}
	for _, in := range infos {
		byId[in.AgentId] = in
	}
	for id, want := range map[string]string{"answered": "claude-opus-5-5", "synthetic": "claude-sonnet-5-5", "fresh": ""} {
		if byId[id].Model != want {
			t.Errorf("%s: Model = %q, want %q", id, byId[id].Model, want)
		}
	}
}
