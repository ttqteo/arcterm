// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remotemode"
)

func TestRemoteTranscriptSendsBacklogAndAppends(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	if err := os.WriteFile(path, []byte("one\ntwo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	chunks := make(chan remotemode.TranscriptChunk, 8)
	sendErr := errors.New("phone gone")
	var failNext atomic.Bool
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- RemoteTranscript(ctx, path, -1, func(c remotemode.TranscriptChunk) error {
			if failNext.Load() {
				return sendErr
			}
			chunks <- c
			return nil
		})
	}()

	next := func() remotemode.TranscriptChunk {
		t.Helper()
		select {
		case c := <-chunks:
			return c
		case <-time.After(5 * time.Second):
			t.Fatal("no chunk arrived")
			return remotemode.TranscriptChunk{}
		}
	}
	if got := next(); !reflect.DeepEqual(got.Lines, []string{"one", "two"}) || !got.Backlog {
		t.Fatalf("backlog = %+v, want the first chunk, marked backlog, with both lines", got)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("three\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if got := next(); !reflect.DeepEqual(got.Lines, []string{"three"}) || got.Backlog {
		t.Fatalf("append = %+v, want the one new line and no backlog mark", got)
	}

	failNext.Store(true)
	f, err = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("four\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()
	select {
	case err := <-done:
		if !errors.Is(err, sendErr) {
			t.Fatalf("err = %v, want the send error", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RemoteTranscript did not return after a send error")
	}
}

func TestRemoteTranscriptReturnsNilOnCancel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	if err := os.WriteFile(path, []byte("one\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan struct{}, 1)
	done := make(chan error, 1)
	go func() {
		done <- RemoteTranscript(ctx, path, -1, func(remotemode.TranscriptChunk) error { got <- struct{}{}; return nil })
	}()
	<-got
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("err = %v, want nil on ctx done", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RemoteTranscript did not return on cancel")
	}
}

// a file that is not there yet still gets its backlog chunk, empty: the page's stream opens on it
func TestRemoteTranscriptMarksTheFirstChunkBacklogEvenWhenEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "later.jsonl")
	chunks := make(chan remotemode.TranscriptChunk, 8)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- RemoteTranscript(ctx, path, -1, func(c remotemode.TranscriptChunk) error { chunks <- c; return nil })
	}()
	select {
	case c := <-chunks:
		if len(c.Lines) != 0 || !c.Backlog {
			t.Fatalf("first chunk = %+v, want an empty backlog", c)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no backlog chunk arrived for a file that is not there yet")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("err = %v, want nil on ctx done", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RemoteTranscript did not return on cancel")
	}
}
