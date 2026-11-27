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

	// the build-output sizing queue (buildsizes.go): its zero value is idle. sizing and sizingPub are guarded by mu.
	sizing    sizingState
	sizingPub *StorageSizing         // the Sizing of the last report published, nil when it carried none
	sizeWalk  func(dir string) int64 // measures one folder; nil is dirSize, a test gates it

	// pubMu keeps reports going out in the order they were read, so the last one out is the newest: a Sizing that
	// went nil must not be followed by an older report that still carries it
	pubMu sync.Mutex
}

// defaultProviders is every category in the order the Settings section shows them.
func defaultProviders() []provider {
	return []provider{runWorktrees{}, oldSessions{}, housekeeping{}, buildOutput{}, packageCaches{}, canvases{}}
}

func NewScanner(env *Env, publish func(StorageReport)) *Scanner {
	return &Scanner{env: env, providers: defaultProviders(), publish: publish}
}

// Report is the last scan, whether one is running, the last auto-clean, and the build output being sized.
func (s *Scanner) Report() StorageReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reportLocked()
}

func (s *Scanner) reportLocked() StorageReport {
	r := s.report
	r.Scanning = s.scanning
	r.LastAuto = s.lastAuto
	r.Sizing = s.sizing.snapshot()
	return r
}

// emit publishes the current report, when a publisher is set, and notes whether it carried Sizing.
func (s *Scanner) emit() {
	s.pubMu.Lock()
	defer s.pubMu.Unlock()
	s.mu.Lock()
	r := s.reportLocked()
	s.sizingPub = r.Sizing
	publish := s.publish
	s.mu.Unlock()
	if publish != nil {
		publish(r)
	}
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
			r.Categories = s.withKeptSizes(r.Categories)
			s.report = r
			again := s.again
			s.again = false
			s.scanning = again
			s.mu.Unlock()
			s.emit()
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
	r.Categories = s.withKeptSizes(r.Categories)
	s.report = r
	s.mu.Unlock()
	return s.Report()
}

// landed publishes a scan's categories as each one lands, since build output and the package caches can take minutes
// and the rest seconds. A category not measured yet keeps the last scan's, and the report keeps the last scan's time
// until the scan ends, so a head that sums them never reads a half total. Clean also lands the one category it
// re-measured through here: that entry replaces the report's, or is added in its provider's place. A walk that sized
// build output lands through here with no category of its own: the report is rebuilt, whatever it stored for build
// output refilled from the kept sizes (a scan's older read never undoes a walk), and published with the sizing.
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
	s.report.Categories = s.withKeptSizes(cats)
	s.mu.Unlock()
	s.emit()
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
	// a full scan forgets the sizes of build folders it no longer lists; one cut short (the server stopping, which
	// fails every git call) lists nothing and must not forget them all
	if c, ok := findCategory(r.Categories, CategoryBuildOutput); ok && ctx.Err() == nil {
		listed := make([]string, len(c.Items))
		for i, it := range c.Items {
			listed[i] = it.ID
		}
		dropUnlistedSizes(s.env, listed)
	}
	log.Printf("storage scan took %s: %s\n", time.Since(start).Round(time.Millisecond), strings.Join(took, ", "))
	return r
}

// Clean cleans the named items of one category, each re-checked by its provider, then re-measures that category alone
// and publishes it at once, then rescans. The full rescan can take minutes, and until it ends the report would still
// list what was just cleaned. The re-measure leaves the report's time as the last full scan's; a scan already running
// that measures the category later overwrites it with its own fresher result.
func (s *Scanner) Clean(ctx context.Context, category StorageCategory, ids []string, opts CleanOpts) (StorageCleanResult, error) {
	for _, p := range s.providers {
		if p.category() != category {
			continue
		}
		res := p.clean(ctx, s.env, ids, opts)
		s.landed([]StorageCategoryReport{p.measure(ctx, s.env)})
		s.Rescan(context.Background())
		return res, nil
	}
	return StorageCleanResult{}, fmt.Errorf("no storage category %q", category)
}
