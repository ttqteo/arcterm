// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

const (
	syncInterval = 15 * time.Minute
	// a burst of vault writes ships as one push
	pokeDebounce = 5 * time.Second
)

const (
	syncFailedTitle   = "Vault sync failed"
	syncConflictTitle = "Vault sync conflict"
	noticeError       = "error"
	noticeWarn        = "warn"
)

// SyncStatus is what `wsh vault status` and Settings show. Off is "" when sync is on, else
// SyncOffNoGit or SyncOffNoRemote. LastSuccessTs is unix milliseconds, 0 before the first success.
type SyncStatus struct {
	Off              string
	RemoteURL        string
	LastSuccessTs    int64
	LastError        string
	Running          bool
	Conflicts        []string
	MalformedEfforts []string
}

// syncLoop runs one sync at a time. A trigger during a run lands in the buffered(1) trigger
// channel, so any number of them queue exactly one follow-up run.
type syncLoop struct {
	sync     func(context.Context) (SyncResult, error)
	notify   func(title, message, level string)
	interval time.Duration
	debounce time.Duration
	poke     <-chan struct{}
	trigger  chan struct{}

	mu            sync.Mutex
	waiters       []chan error // requests the next run covers
	running       bool
	lastSuccessTs int64
	lastError     string
	failing       bool            // the last run failed; a failure streak notices once
	seenConflicts map[string]bool // conflict copies already noticed
}

var loop atomic.Pointer[syncLoop]

func newSyncLoop(fn func(context.Context) (SyncResult, error), notify func(title, message, level string)) *syncLoop {
	return &syncLoop{
		sync:          fn,
		notify:        notify,
		interval:      syncInterval,
		debounce:      pokeDebounce,
		poke:          pokeCh,
		trigger:       make(chan struct{}, 1),
		seenConflicts: map[string]bool{},
	}
}

// StartSyncLoop starts the vault sync loop: every syncInterval, pokeDebounce after the last Poke, and
// on RequestSync. notify raises a cockpit notice. Idempotent.
func StartSyncLoop(ctx context.Context, notify func(title, message, level string)) {
	l := newSyncLoop(syncConfiguredVault, notify)
	if loop.CompareAndSwap(nil, l) {
		l.start(ctx)
	}
}

// syncConfiguredVault opens the vault fresh each run, so a changed vault path takes effect.
func syncConfiguredVault(ctx context.Context) (SyncResult, error) {
	v, err := OpenVault(ctx)
	if err != nil {
		return SyncResult{}, fmt.Errorf("open vault: %w", err)
	}
	return v.Sync(ctx)
}

// RequestSync triggers a sync. With wait it blocks until the run that covers this request (one that
// starts after it) finishes, and returns that run's error.
func RequestSync(ctx context.Context, wait bool) error {
	l := loop.Load()
	if l == nil {
		return errors.New("vault sync loop is not running")
	}
	return l.request(ctx, wait)
}

// CurrentSyncStatus combines the loop's last run with what the vault holds now.
func CurrentSyncStatus(ctx context.Context) SyncStatus {
	var st SyncStatus
	if l := loop.Load(); l != nil {
		st = l.snapshot()
	}
	if _, err := exec.LookPath("git"); err != nil {
		st.Off = SyncOffNoGit
		return st
	}
	v, err := OpenVault(ctx)
	if err != nil {
		st.LastError = fmt.Sprintf("open vault: %v", err)
		return st
	}
	if st.RemoteURL, err = v.RemoteURL(ctx); err != nil {
		log.Printf("wavevault: sync status: %v", err)
	}
	if st.RemoteURL == "" {
		st.Off = SyncOffNoRemote
	}
	if st.Conflicts, err = v.ConflictCopies(); err != nil {
		log.Printf("wavevault: sync status: conflict copies: %v", err)
	}
	if st.MalformedEfforts, err = v.MalformedEfforts(); err != nil {
		log.Printf("wavevault: sync status: malformed efforts: %v", err)
	}
	return st
}

func (l *syncLoop) start(ctx context.Context) {
	go l.schedule(ctx)
	go l.work(ctx)
}

// schedule turns the ticker and debounced pokes into triggers.
func (l *syncLoop) schedule(ctx context.Context) {
	defer func() {
		panichandler.PanicHandler("vault sync schedule", recover())
	}()
	ticker := time.NewTicker(l.interval)
	defer ticker.Stop()
	var debounced <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.kick()
		case <-l.poke:
			debounced = time.After(l.debounce)
		case <-debounced:
			debounced = nil
			l.kick()
		}
	}
}

func (l *syncLoop) work(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-l.trigger:
			l.runOnce(ctx)
		}
	}
}

func (l *syncLoop) kick() {
	select {
	case l.trigger <- struct{}{}:
	default:
	}
}

func (l *syncLoop) request(ctx context.Context, wait bool) error {
	if !wait {
		l.kick()
		return nil
	}
	done := make(chan error, 1)
	l.mu.Lock()
	l.waiters = append(l.waiters, done)
	l.mu.Unlock()
	l.kick()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (l *syncLoop) runOnce(ctx context.Context) {
	l.mu.Lock()
	waiters := l.waiters
	l.waiters = nil
	l.running = true
	l.mu.Unlock()

	res, err := l.safeSync(ctx)
	l.record(res, err)
	// a failed push can follow a merge that already wrote the remote's files
	if res.Pulled {
		l.runAfterPull()
	}
	for _, w := range waiters {
		w <- err
	}
}

// AfterPull runs after a sync whose merge brought in the remote's commits, outside the vault lock, for state read
// from vault files that has no reader of its own to notice the change. Set once at startup, before the loop starts.
var AfterPull func()

func (l *syncLoop) runAfterPull() {
	if AfterPull == nil {
		return
	}
	defer func() {
		panichandler.PanicHandler("vault sync after pull", recover())
	}()
	AfterPull()
}

// safeSync turns a panic in one run into that run's error, so the loop survives it.
func (l *syncLoop) safeSync(ctx context.Context) (res SyncResult, err error) {
	defer func() {
		if perr := panichandler.PanicHandler("vault sync", recover()); perr != nil {
			err = perr
		}
	}()
	return l.sync(ctx)
}

// record updates the status from one run and raises its notices: the first failure of a streak, and
// each conflict copy not noticed before. Off is not a failure.
func (l *syncLoop) record(res SyncResult, err error) {
	type notice struct{ title, message, level string }
	var notices []notice
	l.mu.Lock()
	l.running = false
	for _, c := range res.NewConflicts {
		log.Printf("wavevault: sync: conflict kept the local side, remote side saved at %s", c)
		if !l.seenConflicts[c] {
			l.seenConflicts[c] = true
			notices = append(notices, notice{syncConflictTitle, "kept the local version; the remote version is at " + c, noticeWarn})
		}
	}
	switch {
	case err != nil:
		log.Printf("wavevault: sync failed: %v", err)
		l.lastError = err.Error()
		if !l.failing {
			notices = append(notices, notice{syncFailedTitle, err.Error(), noticeError})
		}
		l.failing = true
	case res.Off != "":
		l.lastError = ""
		l.failing = false
	default:
		l.lastError = ""
		l.failing = false
		l.lastSuccessTs = time.Now().UnixMilli()
	}
	l.mu.Unlock()
	for _, n := range notices {
		l.notify(n.title, n.message, n.level)
	}
}

func (l *syncLoop) snapshot() SyncStatus {
	l.mu.Lock()
	defer l.mu.Unlock()
	return SyncStatus{LastSuccessTs: l.lastSuccessTs, LastError: l.lastError, Running: l.running}
}
