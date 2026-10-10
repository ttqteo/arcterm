// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"sync/atomic"
	"testing"
	"time"
)

func newTestTyper(settle, fallback time.Duration) (*firstCommandTyper, *atomic.Int32) {
	var sent atomic.Int32
	return newFirstCommandTyper(settle, fallback, func() { sent.Add(1) }), &sent
}

func waitSent(t *testing.T, sent *atomic.Int32, want int32, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if sent.Load() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("sent %d times, want %d", sent.Load(), want)
}

func TestFirstCommandTyperTypesAfterThePromptMark(t *testing.T) {
	typer, sent := newTestTyper(20*time.Millisecond, time.Hour)
	typer.output([]byte("Last login: today\r\n"))
	time.Sleep(60 * time.Millisecond)
	if sent.Load() != 0 {
		t.Fatalf("typed before any prompt mark")
	}
	typer.output([]byte("\x1b]16162;A\x07~/proj % "))
	waitSent(t, sent, 1, time.Second)
}

func TestFirstCommandTyperFindsAMarkSplitAcrossChunks(t *testing.T) {
	typer, sent := newTestTyper(20*time.Millisecond, time.Hour)
	typer.output([]byte("motd\x1b]161"))
	typer.output([]byte("62;A\x07% "))
	waitSent(t, sent, 1, time.Second)
}

func TestFirstCommandTyperWaitsForThePromptToSettle(t *testing.T) {
	typer, sent := newTestTyper(80*time.Millisecond, time.Hour)
	typer.output([]byte("\x1b]16162;A\x07"))
	// the prompt keeps drawing: each chunk pushes the typing back
	for i := 0; i < 4; i++ {
		time.Sleep(40 * time.Millisecond)
		typer.output([]byte("prompt part "))
	}
	if sent.Load() != 0 {
		t.Fatalf("typed while the prompt was still drawing")
	}
	waitSent(t, sent, 1, time.Second)
}

func TestFirstCommandTyperFallsBackWithoutAMark(t *testing.T) {
	typer, sent := newTestTyper(20*time.Millisecond, 50*time.Millisecond)
	typer.output([]byte("bash-3.2$ "))
	waitSent(t, sent, 1, time.Second)
}

func TestFirstCommandTyperTypesOnce(t *testing.T) {
	typer, sent := newTestTyper(10*time.Millisecond, 30*time.Millisecond)
	typer.output([]byte("\x1b]16162;A\x07% "))
	waitSent(t, sent, 1, time.Second)
	typer.output([]byte("\x1b]16162;A\x07% "))
	time.Sleep(80 * time.Millisecond)
	if got := sent.Load(); got != 1 {
		t.Fatalf("sent %d times, want 1", got)
	}
}

func TestFirstCommandTyperStopCancelsTheTyping(t *testing.T) {
	typer, sent := newTestTyper(20*time.Millisecond, 40*time.Millisecond)
	typer.output([]byte("\x1b]16162;A\x07"))
	typer.stop()
	time.Sleep(100 * time.Millisecond)
	if got := sent.Load(); got != 0 {
		t.Fatalf("a stopped typer sent %d times", got)
	}
}
