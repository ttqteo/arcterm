// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jobpeaks keeps the RAM peaks wavesrv measured for each heavy shell command, per command pattern and per
// project, and turns them into the figure the heavy-job queue admits the command's next run on: the largest of the
// last few peaks × 1.2. A command memgate's table knows always has a key; one it does not know is kept only while
// it reads heavy, and the patterns that do are written to the learned file (memgate.WriteLearned) so wsh sends them
// to the queue like any command in the table.
//
// A max, not an average: overestimating costs some waiting, underestimating lets the machine swap, which the queue
// exists to prevent.
package jobpeaks

import (
	"cmp"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/memgate"
)

const (
	// Threshold is the peak an unknown command must reach to be learned, and below which a learned pattern whose
	// kept peaks are all under it, in every project, goes back to light.
	Threshold = memgate.LearnedBytes
	// Expiry is how long a key may go without a run before it is dropped.
	Expiry = 30 * 24 * time.Hour

	// keep is how many runs' peaks a key holds; jobqueue.Basis defines it once.
	keep = len(jobqueue.Basis{}.Peaks)
)

// Default is wavesrv's store. nil means no measurement (tests, wsh): a nil *Store answers every call as an empty one.
var Default *Store

// key is a command pattern in a project. The project is "" for the "no project" key.
type key struct{ pattern, project string }

// entry is one key's kept peaks.
type entry struct {
	Pattern string `json:"pattern"`
	Project string `json:"project"`
	// Known: the pattern is a memgate table job, which always queues; false is an unknown command that read heavy.
	Known bool `json:"known,omitempty"`
	// Peaks are the last runs' peaks in bytes, newest first, at most keep of them, none zero.
	Peaks []uint64  `json:"peaks"`
	Last  time.Time `json:"last"` // the last run
}

// file is jobpeaks.json.
type file struct {
	Keys []entry `json:"keys"`
}

// Store is the peak store. It is safe for concurrent use. Record holds the lock across its (small) file writes on
// purpose: writes then go out in the order the records came, and the learned file never lags the keys it is derived
// from. A record is at most one per finished command, so nothing waits on it for long.
type Store struct {
	mu          sync.Mutex
	path        string // jobpeaks.json; "" keeps the store in memory only
	learnedPath string // "" never writes the learned file
	now         func() time.Time
	keys        map[key]*entry
	// learnedOut is the set the learned file last held, written by this store: nil until a write succeeded, so a
	// failed write is tried again at the next record rather than assumed done.
	learnedOut []string
}

// Open reads the store at path (jobpeaks.json) and drops the keys idle for more than Expiry. A missing file is an
// empty store; a broken one is logged and read as empty. Unless learnedPath is "", the learned file is written once
// here and again whenever the set of learned patterns changes. now is time.Now when nil.
func Open(path, learnedPath string, now func() time.Time) *Store {
	if now == nil {
		now = time.Now
	}
	s := &Store{path: path, learnedPath: learnedPath, now: now, keys: map[key]*entry{}}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	if s.tidy(now()) {
		s.save()
	}
	s.syncLearned()
	return s
}

// Record adds one finished run's peak, in bytes, to the key (pattern, project). known is whether pattern is a memgate
// table job: such a run is always kept. An unknown pattern's run is kept only at Threshold or more, or when the
// pattern is already stored; an unknown pattern whose kept peaks are all under Threshold, in every project, leaves
// the store. A zero peak is no measurement and is ignored.
func (s *Store) Record(pattern, project string, known bool, peak uint64) {
	if s == nil || peak == 0 || pattern == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	changed := s.tidy(now) // what the decision below reads is what is still current
	k := key{pattern, project}
	e := s.keys[k]
	if e == nil && (known || peak >= Threshold || s.hasPattern(pattern)) {
		e = &entry{Pattern: pattern, Project: project}
		s.keys[k] = e
	}
	if e != nil {
		e.Known = known
		e.Peaks = append([]uint64{peak}, e.Peaks...)
		if len(e.Peaks) > keep {
			e.Peaks = e.Peaks[:keep]
		}
		e.Last = now
		changed = true
	}
	if s.tidy(now) {
		changed = true
	}
	if changed {
		s.save()
	}
	s.syncLearned()
}

// Estimate is the figure to admit pattern's next run in project on, and what it rests on: the key's largest kept
// peak × 1.2; else, for a learned unknown pattern, the largest peak over its other projects × 1.2 (Basis.Elsewhere,
// Basis.Peaks those of the project holding it, the lowest project name on a tie); else table, the zero Basis.
func (s *Store) Estimate(pattern, project string, table uint64) (uint64, jobqueue.Basis) {
	if s == nil {
		return table, jobqueue.Basis{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.keys[key{pattern, project}]; e != nil {
		return figure(e.Peaks), basisOf(e.Peaks, false)
	}
	var best *entry
	var bestMax uint64
	for k, e := range s.keys {
		if k.pattern != pattern || e.Known {
			continue
		}
		m := slices.Max(e.Peaks)
		if best == nil || m > bestMax || (m == bestMax && e.Project < best.Project) {
			best, bestMax = e, m
		}
	}
	if best == nil {
		return table, jobqueue.Basis{}
	}
	return figure(best.Peaks), basisOf(best.Peaks, true)
}

// Learned is the set of unknown patterns that read heavy now. The map is the caller's to keep.
func (s *Store) Learned() map[string]bool {
	set := map[string]bool{}
	if s == nil {
		return set
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, e := range s.keys {
		if !e.Known {
			set[k.pattern] = true
		}
	}
	return set
}

// figure is the largest of the peaks × 1.2.
func figure(peaks []uint64) uint64 {
	m := slices.Max(peaks)
	return m + m/5
}

func basisOf(peaks []uint64, elsewhere bool) jobqueue.Basis {
	b := jobqueue.Basis{Measured: true, Elsewhere: elsewhere}
	copy(b.Peaks[:], peaks)
	return b
}

// hasPattern reports whether any project holds a key of the unknown pattern.
func (s *Store) hasPattern(pattern string) bool {
	for k, e := range s.keys {
		if k.pattern == pattern && !e.Known {
			return true
		}
	}
	return false
}

// tidy drops the keys idle for more than Expiry, then the unknown patterns whose kept peaks are all under Threshold
// in every project, and reports whether it dropped anything. Called with s.mu held.
func (s *Store) tidy(now time.Time) bool {
	changed := false
	for k, e := range s.keys {
		if now.Sub(e.Last) > Expiry {
			delete(s.keys, k)
			changed = true
		}
	}
	heavy := map[string]bool{}
	for k, e := range s.keys {
		if !e.Known && slices.Max(e.Peaks) >= Threshold {
			heavy[k.pattern] = true
		}
	}
	for k, e := range s.keys {
		if !e.Known && !heavy[k.pattern] {
			delete(s.keys, k)
			changed = true
		}
	}
	return changed
}

// load reads path into s.keys, keeping only what an estimate can trust: no zero peak, no more than keep peaks, no
// key left without a peak. Called with s.mu held.
func (s *Store) load() {
	if s.path == "" {
		return
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[jobpeaks] cannot read %s, starting empty: %v", s.path, err)
		}
		return
	}
	var f file
	if err := json.Unmarshal(data, &f); err != nil {
		log.Printf("[jobpeaks] %s is broken, starting empty: %v", s.path, err)
		return
	}
	for _, e := range f.Keys {
		e.Peaks = slices.DeleteFunc(slices.Clone(e.Peaks), func(p uint64) bool { return p == 0 })
		if len(e.Peaks) > keep {
			e.Peaks = e.Peaks[:keep]
		}
		if e.Pattern == "" || len(e.Peaks) == 0 {
			continue
		}
		s.keys[key{e.Pattern, e.Project}] = &e
	}
}

// save writes jobpeaks.json: a temp file in its directory, renamed over it. A failure is logged and the store
// carries on in memory. Called with s.mu held.
func (s *Store) save() {
	if s.path == "" {
		return
	}
	f := file{Keys: make([]entry, 0, len(s.keys))}
	for _, e := range s.keys {
		f.Keys = append(f.Keys, *e)
	}
	slices.SortFunc(f.Keys, func(a, b entry) int {
		return cmp.Or(cmp.Compare(a.Pattern, b.Pattern), cmp.Compare(a.Project, b.Project))
	})
	data, err := json.Marshal(f)
	if err == nil {
		err = writeFile(s.path, append(data, '\n'))
	}
	if err != nil {
		log.Printf("[jobpeaks] cannot write %s: %v", s.path, err)
	}
}

// syncLearned writes the learned file when the set of learned patterns is not what it last held (or it was never
// written). A failure is logged and tried again at the next record. Called with s.mu held.
func (s *Store) syncLearned() {
	if s.learnedPath == "" {
		return
	}
	patterns := []string{}
	for k, e := range s.keys {
		if !e.Known {
			patterns = append(patterns, k.pattern)
		}
	}
	slices.Sort(patterns)
	patterns = slices.Compact(patterns)
	if s.learnedOut != nil && slices.Equal(s.learnedOut, patterns) {
		return
	}
	if err := memgate.WriteLearned(s.learnedPath, patterns); err != nil {
		log.Printf("[jobpeaks] cannot write %s: %v", s.learnedPath, err)
		return
	}
	s.learnedOut = patterns
}

// writeFile writes data to a temp file beside path (the directory is created if missing), then renames it over path,
// so a reader sees the old file or the new one, never half of either.
func writeFile(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	_, err = tmp.Write(data)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmpName, path)
	}
	if err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}
