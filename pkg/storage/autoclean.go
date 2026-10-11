// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

const (
	// AutoCleanDelay is how long after start the first scan, and the first auto-clean, wait
	AutoCleanDelay = 2 * time.Minute
	// AutoCleanEvery is the pause between auto-cleans
	AutoCleanEvery = 24 * time.Hour
)

// AutoClean cleans what needs no one's say: finished run worktrees with no uncommitted changes, and rolled logs
// older than LogMaxAge. The session trash purges itself (sessiontrash.StartPurgeLoop). Sessions, build output, a
// tree with changes and the webview cache are never touched. It keeps its result for the report and rescans.
func (s *Scanner) AutoClean(ctx context.Context) StorageAutoClean {
	res := StorageAutoClean{Ts: s.env.Now().UnixMilli()}
	var failures []string
	for _, p := range []provider{runWorktrees{}, housekeeping{}} {
		var ids []string
		for _, it := range p.measure(ctx, s.env).Items {
			if it.Cleanable && !it.Guarded && (it.Kind == KindWorktree || it.Kind == KindLog) {
				ids = append(ids, it.ID)
			}
		}
		if len(ids) == 0 {
			continue
		}
		cr := p.clean(ctx, s.env, ids, CleanOpts{Auto: true})
		res.Reclaimed += cr.Reclaimed
		for _, sk := range cr.Skipped {
			if strings.HasPrefix(sk.Reason, "couldn't") {
				failures = append(failures, sk.ID+": "+sk.Reason)
			}
		}
	}
	res.Error = strings.Join(failures, "; ")
	if res.Reclaimed > 0 || res.Error != "" {
		log.Printf("storage auto-clean reclaimed %d bytes; failures: %q\n", res.Reclaimed, res.Error)
	}
	s.mu.Lock()
	s.lastAuto = &res
	s.mu.Unlock()
	s.Rescan(ctx)
	return res
}

// StartLoop waits delay, then every `every` auto-cleans when enabled says so, else only rescans, until ctx ends.
func (s *Scanner) StartLoop(ctx context.Context, enabled func() bool, delay, every time.Duration) {
	go func() {
		defer func() {
			panichandler.PanicHandler("storage.Loop", recover())
		}()
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		for {
			if enabled() {
				s.AutoClean(ctx)
			} else {
				s.Rescan(ctx)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(every):
			}
		}
	}()
}
