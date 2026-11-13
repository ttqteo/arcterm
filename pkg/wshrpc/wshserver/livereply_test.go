// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestLiveReplyFile(t *testing.T) {
	dir := filepath.Join("home", ".arc", "live")
	got, err := liveReplyFile(dir, filepath.Join("x", "projects", "-repo", "391cd109-b8f6-41ce-884c-c8f91e0cc328.jsonl"))
	if err != nil || got != filepath.Join(dir, "391cd109-b8f6-41ce-884c-c8f91e0cc328.json") {
		t.Fatalf("got %q, %v", got, err)
	}
	for _, bad := range []string{"", "/x/session.txt", "/x/..jsonl", "/x/a b.jsonl", "/x/.jsonl"} {
		if _, err := liveReplyFile(dir, bad); err == nil {
			t.Errorf("%q: want an error", bad)
		}
	}
}

func TestSweepLiveReplies(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, "old.json")
	fresh := filepath.Join(dir, "fresh.json")
	other := filepath.Join(dir, "notes.txt")
	for _, p := range []string{old, fresh, other} {
		writeFile(t, p, "{}")
	}
	now := time.Now()
	stale := now.Add(-liveReplyMaxAge - time.Minute)
	for _, p := range []string{old, other} {
		if err := os.Chtimes(p, stale, stale); err != nil {
			t.Fatal(err)
		}
	}
	sweepLiveReplies(dir, now)
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("a stale live reply should be gone: %v", err)
	}
	for _, p := range []string{fresh, other} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s should stay: %v", filepath.Base(p), err)
		}
	}
}

func recvLive(t *testing.T, ch chan wshrpc.RespOrErrorUnion[wshrpc.AgentLiveReplyUpdate], what string) string {
	t.Helper()
	select {
	case msg := <-ch:
		if msg.Error != nil {
			t.Fatalf("%s: %v", what, msg.Error)
		}
		return msg.Response.Text
	case <-time.After(3 * time.Second):
		t.Fatalf("timeout waiting for %s", what)
	}
	return ""
}

func TestStreamLiveReply(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "s.json")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentLiveReplyUpdate], 16)
	done := make(chan struct{})
	go func() {
		_ = streamLiveReply(ctx, path, ch)
		close(done)
	}()

	if got := recvLive(t, ch, "the first send"); got != "" {
		t.Fatalf("no file yet: want \"\", got %q", got)
	}
	// the file appears after the stream opened
	writeFile(t, path, `{"step":0}`)
	if got := recvLive(t, ch, "the created file"); got != `{"step":0}` {
		t.Fatalf("got %q", got)
	}
	// rewritten in place
	writeFile(t, path, `{"step":1}`)
	if got := recvLive(t, ch, "the rewrite"); got != `{"step":1}` {
		t.Fatalf("got %q", got)
	}
	// replaced by a rename over it, as an atomic write does
	tmp := filepath.Join(dir, "s.json.tmp")
	writeFile(t, tmp, `{"step":2}`)
	if err := os.Rename(tmp, path); err != nil {
		t.Fatal(err)
	}
	if got := recvLive(t, ch, "the renamed file"); got != `{"step":2}` {
		t.Fatalf("got %q", got)
	}
	// caught mid-write: not JSON, nothing sent; the whole value is
	writeFile(t, path, `{"step":`)
	writeFile(t, path, `{"step":3}`)
	if got := recvLive(t, ch, "the whole value"); got != `{"step":3}` {
		t.Fatalf("got %q", got)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("streamLiveReply did not return after cancel")
	}
}
