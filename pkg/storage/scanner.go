// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

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
			r := s.scan(ctx, s.landed)
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
	r := s.scan(ctx, nil)
	s.mu.Lock()
	s.report = r
	s.mu.Unlock()
	return s.Report()
}

// landed publishes a scan's categories as each one lands, since build output and the package caches can take minutes
// and the rest seconds. A category not measured yet keeps the last scan's, and the report keeps the last scan's time
// until the scan ends, so a head that sums them never reads a half total.
func (s *Scanner) landed(done []StorageCategoryReport) {
	s.mu.Lock()
	cats := make([]StorageCategoryReport, 0, len(s.providers))
	for _, p := range s.providers {
		if c, ok := findCategory(done, p.category()); ok {
			cats = append(cats, c)
		} else if c, ok := findCategory(s.report.Categories, p.category()); ok {
			cats = append(cats, c)
		}
	}
	s.report.Categories = cats
	s.mu.Unlock()
	if s.publish != nil {
		s.publish(s.Report())
	}
}

func findCategory(cats []StorageCategoryReport, category StorageCategory) (StorageCategoryReport, bool) {
	for _, c := range cats {
		if c.Category == category {
			return c, true
		}
	}
	return StorageCategoryReport{}, false
}

// scan measures every category, calling landed (when set) after each but the last, and logs how long each took.
func (s *Scanner) scan(ctx context.Context, landed func([]StorageCategoryReport)) StorageReport {
	start := time.Now()
	r := StorageReport{ScannedTs: s.env.Now().UnixMilli(), StoreBytes: dirSize(filepath.Join(s.env.DataDir, "db"))}
	took := []string{fmt.Sprintf("store %s", time.Since(start).Round(time.Millisecond))}
	for i, p := range s.providers {
		pstart := time.Now()
		r.Categories = append(r.Categories, p.measure(ctx, s.env))
		took = append(took, fmt.Sprintf("%s %s", p.category(), time.Since(pstart).Round(time.Millisecond)))
		if landed != nil && i < len(s.providers)-1 {
			landed(slices.Clone(r.Categories))
		}
	}
	log.Printf("storage scan took %s: %s\n", time.Since(start).Round(time.Millisecond), strings.Join(took, ", "))
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
