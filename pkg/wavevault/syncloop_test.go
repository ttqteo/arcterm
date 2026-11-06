// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testDebounce = 50 * time.Millisecond
	// long enough for a debounce and a run to settle on a slow CI box
	testSettle = 400 * time.Millisecond
)

type notice struct{ title, message, level string }

type noticeLog struct {
	mu   sync.Mutex
	list []notice
}

func (n *noticeLog) notify(title, message, level string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.list = append(n.list, notice{title, message, level})
}

func (n *noticeLog) byLevel(level string) []notice {
	n.mu.Lock()
	defer n.mu.Unlock()
	var out []notice
	for _, x := range n.list {
		if x.level == level {
			out = append(out, x)
		}
	}
	return out
}

// startTestLoop runs a loop with its own poke channel, so no test sees another's (or Commit's) pokes.
func startTestLoop(t *testing.T, fn func(context.Context) (SyncResult, error)) (*syncLoop, chan struct{}, *noticeLog) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	poke := make(chan struct{}, 1)
	notices := &noticeLog{}
	l := newSyncLoop(fn, notices.notify)
	l.interval = time.Hour
	l.debounce = testDebounce
	l.poke = poke
	l.start(ctx)
	return l, poke, notices
}

func TestLoopDebouncesPokeBurst(t *testing.T) {
	var runs atomic.Int32
	_, poke, _ := startTestLoop(t, func(context.Context) (SyncResult, error) {
		runs.Add(1)
		return SyncResult{}, nil
	})
	for range 10 {
		poke <- struct{}{}
		time.Sleep(testDebounce / 10)
	}
	time.Sleep(testSettle)
	if got := runs.Load(); got != 1 {
		t.Fatalf("runs = %d after a burst of 10 pokes, want 1", got)
	}
}

func TestLoopRunAgainOnce(t *testing.T) {
	var runs atomic.Int32
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	l, _, _ := startTestLoop(t, func(context.Context) (SyncResult, error) {
		if runs.Add(1) == 1 {
			started <- struct{}{}
			<-release
		}
		return SyncResult{}, nil
	})
	ctx := context.Background()
	if err := l.request(ctx, false); err != nil {
		t.Fatal(err)
	}
	<-started
	for range 3 {
		if err := l.request(ctx, false); err != nil {
			t.Fatal(err)
		}
	}
	close(release)
	time.Sleep(testSettle)
	if got := runs.Load(); got != 2 {
		t.Fatalf("runs = %d after 3 triggers during a run, want 2", got)
	}
}

func TestLoopFailureStreakNoticesOnce(t *testing.T) {
	errs := []error{errors.New("e1"), errors.New("e2"), errors.New("e3"), nil, errors.New("e4")}
	var i int
	l, _, notices := startTestLoop(t, func(context.Context) (SyncResult, error) {
		err := errs[i]
		i++
		return SyncResult{}, err
	})
	ctx := context.Background()
	for range 3 {
		_ = l.request(ctx, true)
	}
	if got := len(notices.byLevel("error")); got != 1 {
		t.Fatalf("error notices after 3 failures = %d, want 1", got)
	}
	if err := l.request(ctx, true); err != nil {
		t.Fatalf("4th run: %v", err)
	}
	if err := l.request(ctx, true); err == nil {
		t.Fatal("5th run returned nil, want e4")
	}
	got := notices.byLevel("error")
	if len(got) != 2 {
		t.Fatalf("error notices after success then failure = %d, want 2", len(got))
	}
	if got[1].message != "e4" {
		t.Fatalf("second notice message = %q, want e4", got[1].message)
	}
}

func TestLoopNewConflictNoticesOnce(t *testing.T) {
	results := [][]string{{"conflicts/a.md"}, {"conflicts/a.md"}, {"conflicts/a.md", "conflicts/b.md"}}
	var i int
	l, _, notices := startTestLoop(t, func(context.Context) (SyncResult, error) {
		res := SyncResult{NewConflicts: results[i]}
		i++
		return res, nil
	})
	for range results {
		if err := l.request(context.Background(), true); err != nil {
			t.Fatal(err)
		}
	}
	if got := len(notices.byLevel("warn")); got != 2 {
		t.Fatalf("warn notices = %d, want 2 (one per distinct conflict copy)", got)
	}
}

func TestLoopOffIsNotAFailure(t *testing.T) {
	l, _, notices := startTestLoop(t, func(context.Context) (SyncResult, error) {
		return SyncResult{Off: SyncOffNoRemote}, nil
	})
	if err := l.request(context.Background(), true); err != nil {
		t.Fatalf("request: %v", err)
	}
	if got := len(notices.byLevel("error")); got != 0 {
		t.Fatalf("error notices = %d with sync off, want 0", got)
	}
	if st := l.snapshot(); st.LastSuccessTs != 0 || st.LastError != "" {
		t.Fatalf("snapshot = %+v, want no success and no error", st)
	}
}

func TestLoopAfterPullRunsOnlyOnPull(t *testing.T) {
	var calls atomic.Int32
	old := AfterPull
	AfterPull = func() { calls.Add(1) }
	t.Cleanup(func() { AfterPull = old })

	results := []struct {
		res SyncResult
		err error
	}{
		{SyncResult{Pulled: true}, nil},
		{SyncResult{}, nil},
		// the push failed after a merge that already wrote the remote's files
		{SyncResult{Pulled: true}, errors.New("push rejected")},
		{SyncResult{Off: SyncOffNoRemote}, nil},
	}
	var run atomic.Int32
	l, _, _ := startTestLoop(t, func(context.Context) (SyncResult, error) {
		r := results[run.Add(1)-1]
		return r.res, r.err
	})
	for range results {
		_ = l.request(context.Background(), true)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("AfterPull ran %d times over two pulls among %d runs, want 2", got, len(results))
	}
}

func TestLoopAfterPullPanicKeepsLoop(t *testing.T) {
	old := AfterPull
	AfterPull = func() { panic("boom") }
	t.Cleanup(func() { AfterPull = old })
	var runs atomic.Int32
	l, _, _ := startTestLoop(t, func(context.Context) (SyncResult, error) {
		runs.Add(1)
		return SyncResult{Pulled: true}, nil
	})
	for range 2 {
		if err := l.request(context.Background(), true); err != nil {
			t.Fatalf("request: %v", err)
		}
	}
	if got := runs.Load(); got != 2 {
		t.Fatalf("runs = %d, want 2: a panicking AfterPull must not stop the loop", got)
	}
}

func TestRequestSyncWaitReturnsError(t *testing.T) {
	want := errors.New("git push origin HEAD:main: exit status 1: rejected")
	l, _, _ := startTestLoop(t, func(context.Context) (SyncResult, error) {
		return SyncResult{}, want
	})
	if err := l.request(context.Background(), true); !errors.Is(err, want) {
		t.Fatalf("request = %v, want %v", err, want)
	}
	if st := l.snapshot(); st.LastError != want.Error() || st.Running {
		t.Fatalf("snapshot = %+v, want LastError set and not running", st)
	}
}

func TestRequestSyncNoLoop(t *testing.T) {
	if loop.Load() != nil {
		t.Skip("a loop is running in this process")
	}
	if err := RequestSync(context.Background(), false); err == nil {
		t.Fatal("RequestSync with no loop returned nil")
	}
}
