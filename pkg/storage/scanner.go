// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// Scanner keeps the last scan in memory and runs scans in the background: walking node_modules or a cargo
// target takes seconds, longer than an RPC should hold.
type Scanner struct {
	env       *Env
	providers []provider
	publish   func(StorageReport)

	mu       sync.Mutex
	report   StorageReport
	scanning bool
	again    bool
	lastAuto *StorageAutoClean
}

// defaultProviders is every category in the order the Settings section shows them.
func defaultProviders() []provider {
	return []provider{runWorktrees{}, oldSessions{}, housekeeping{}, buildOutput{}, packageCaches{}, canvases{}}
}

func NewScanner(env *Env, publish func(StorageReport)) *Scanner {
	return &Scanner{env: env, providers: defaultProviders(), publish: publish}
}

// Report is the last scan, whether one is running, and the last auto-clean.
func (s *Scanner) Report() StorageReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.report
	r.Scanning = s.scanning
	r.LastAuto = s.lastAuto
	return r
}

// Rescan starts a scan in the background. One asked for while another runs follows it once, however many asks
// came in meanwhile.
func (s *Scanner) Rescan(ctx context.Context) {
	s.mu.Lock()
	if s.scanning {
		s.again = true
		s.mu.Unlock()
		return
	}
	s.scanning = true
	s.mu.Unlock()
	go func() {
		defer func() {
			panichandler.PanicHandler("storage.Rescan", recover())
		}()
		for {
			r := s.scan(ctx)
			s.mu.Lock()
			s.report = r
			again := s.again
			s.again = false
			s.scanning = again
			s.mu.Unlock()
			if s.publish != nil {
				s.publish(s.Report())
			}
			if !again {
				return
			}
		}
	}()
}

// ScanNow scans in the caller's goroutine and keeps the result.
func (s *Scanner) ScanNow(ctx context.Context) StorageReport {
	r := s.scan(ctx)
	s.mu.Lock()
	s.report = r
	s.mu.Unlock()
	return s.Report()
}

func (s *Scanner) scan(ctx context.Context) StorageReport {
	r := StorageReport{ScannedTs: s.env.Now().UnixMilli(), StoreBytes: dirSize(filepath.Join(s.env.DataDir, "db"))}
	for _, p := range s.providers {
		r.Categories = append(r.Categories, p.measure(ctx, s.env))
	}
	return r
}

// Clean cleans the named items of one category, each re-checked by its provider, then rescans.
func (s *Scanner) Clean(ctx context.Context, category StorageCategory, ids []string, opts CleanOpts) (StorageCleanResult, error) {
	for _, p := range s.providers {
		if p.category() != category {
			continue
		}
		res := p.clean(ctx, s.env, ids, opts)
		s.Rescan(context.Background())
		return res, nil
	}
	return StorageCleanResult{}, fmt.Errorf("no storage category %q", category)
}
