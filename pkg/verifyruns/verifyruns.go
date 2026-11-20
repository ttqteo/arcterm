// pkg/verifyruns/verifyruns.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package verifyruns keeps, for each agent, the newest CDP scenario run of each scenario, and judges them: the
// state behind the cockpit's Verify tile and the arc mod's ask before a merge. The scenario harness reports each
// run through `wsh verify report`; this package stores the reports, derives each scenario's state (process
// liveness, git changes against `.arc/verify.json`'s watch globs, skips) and answers the merge gate.
//
// It defines its own plain structs and imports neither wshrpc nor the object store; the wshrpc server converts
// them to the wire types.
package verifyruns

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// A report's phase.
const (
	PhaseStart    = "start"
	PhaseProgress = "progress"
	PhaseEnd      = "end"
)

// A step's state.
const (
	StepPass = "pass"
	StepFail = "fail"
	StepSkip = "skip"
)

// sweepAfter is how long a block's file may sit untouched before Sweep removes it.
const sweepAfter = 30 * 24 * time.Hour

type Step struct {
	Step   string `json:"step"`
	State  string `json:"state"` // pass | fail | skip
	Detail string `json:"detail,omitempty"`
}

type Scenario struct {
	Name  string   `json:"name"`
	Files []string `json:"files,omitempty"` // its screenshots, relative to the run's ShotsDir
	Steps []Step   `json:"steps,omitempty"`
	Done  bool     `json:"done,omitempty"`
}

// Report is one report from the scenario harness (`wsh verify report`), one JSON document per phase.
type Report struct {
	BlockId   string     `json:"blockid"`
	RunId     string     `json:"runid"`
	Phase     string     `json:"phase"` // start | progress | end
	Pid       int        `json:"pid"`
	Cwd       string     `json:"cwd,omitempty"`
	Command   string     `json:"command,omitempty"`
	ShotsDir  string     `json:"shotsdir,omitempty"`
	Reason    string     `json:"reason,omitempty"`
	Scenarios []Scenario `json:"scenarios,omitempty"`
}

// Run is the newest report of one run, merged.
type Run struct {
	RunId     string     `json:"runid"`
	Pid       int        `json:"pid"`
	Cwd       string     `json:"cwd,omitempty"`
	Command   string     `json:"command,omitempty"`
	ShotsDir  string     `json:"shotsdir,omitempty"`
	Reason    string     `json:"reason,omitempty"`
	Scenarios []Scenario `json:"scenarios,omitempty"`
	Started   int64      `json:"started"`
	// Updated is when the last report of the run landed (ms): the run's end, once Ended.
	Updated int64 `json:"updated"`
	Ended   bool  `json:"ended,omitempty"`
}

// BlockFile is everything kept for one agent (block).
type BlockFile struct {
	// Runs maps a scenario name to the newest run that named it. A run naming three scenarios is stored under
	// all three, so each entry is the whole run.
	Runs map[string]Run `json:"runs"`
	// Skips maps a scenario name, or "" for the not-run warning, to when the person set it aside (ms).
	Skips map[string]int64 `json:"skips,omitempty"`
}

// Apply merges one report into a block's file and returns the result; bf is not changed.
//
//   - A start names the scenarios of a run and replaces any older run of each; a repeat start of the same run id
//     (verify.mjs run by Final) adds its scenarios to that run.
//   - A progress or end updates the scenarios it names, and an end closes the run.
//   - The first pid, command and start of a run win (Final's, when Final runs verify.mjs); a later report adds
//     what the run lacks and brings the newest shots dir and reason.
//   - A report for a run that has since been replaced, for a scenario, is ignored for that scenario: a late end
//     from an old run never overwrites a newer one.
//   - A new run of a scenario clears its skip.
func Apply(bf BlockFile, r Report, now int64) BlockFile {
	out := BlockFile{Runs: make(map[string]Run, len(bf.Runs)+len(r.Scenarios)), Skips: make(map[string]int64, len(bf.Skips))}
	maps.Copy(out.Runs, bf.Runs)
	maps.Copy(out.Skips, bf.Skips)

	m, known := findRun(out.Runs, r.RunId)
	startedX := int64(0) // an unknown run that is not starting has no place to claim over a newer run
	if known {
		startedX = m.Started
	} else {
		m = Run{RunId: r.RunId, Pid: r.Pid, Started: now}
		if r.Phase == PhaseStart {
			startedX = now
		}
	}

	m.Scenarios = cloneScenarios(m.Scenarios)
	applied := 0
	for _, s := range r.Scenarios {
		if cur, ok := out.Runs[s.Name]; ok && cur.RunId != r.RunId && cur.Started > startedX {
			continue // that scenario has a newer run: this report is stale for it
		}
		upsertScenario(&m.Scenarios, cloneScenario(s))
		applied++
		if !known || r.Phase == PhaseStart {
			delete(out.Skips, s.Name)
		}
	}
	if len(r.Scenarios) > 0 && applied == 0 {
		return bf // every scenario it names has moved on
	}
	if !known && applied == 0 {
		return bf // a run-level report for a run nobody stored: nothing to attach it to
	}

	m.Updated = now
	if m.Pid == 0 {
		m.Pid = r.Pid
	}
	if m.Cwd == "" {
		m.Cwd = r.Cwd
	}
	if m.Command == "" {
		m.Command = r.Command
	}
	if r.ShotsDir != "" {
		m.ShotsDir = r.ShotsDir
	}
	if r.Reason != "" {
		m.Reason = r.Reason
	}
	if r.Phase == PhaseEnd {
		m.Ended = true
	}

	for _, s := range m.Scenarios {
		if cur, ok := out.Runs[s.Name]; ok && cur.RunId != m.RunId && cur.Started > m.Started {
			continue
		}
		out.Runs[s.Name] = m
	}
	return out
}

// findRun returns the stored copy of a run, the one that was updated last.
func findRun(runs map[string]Run, runId string) (Run, bool) {
	var best Run
	found := false
	for _, run := range runs {
		if run.RunId == runId && (!found || run.Updated > best.Updated) {
			best, found = run, true
		}
	}
	return best, found
}

func upsertScenario(list *[]Scenario, s Scenario) {
	for i := range *list {
		if (*list)[i].Name == s.Name {
			(*list)[i] = s
			return
		}
	}
	*list = append(*list, s)
}

func cloneScenario(s Scenario) Scenario {
	s.Files = append([]string(nil), s.Files...)
	s.Steps = append([]Step(nil), s.Steps...)
	return s
}

func cloneScenarios(list []Scenario) []Scenario {
	out := make([]Scenario, len(list))
	for i, s := range list {
		out[i] = cloneScenario(s)
	}
	return out
}

// ---- Store ----

// Store keeps each agent's BlockFile as `<dir>/<blockid>.json`, so a restart keeps the runs.
type Store struct {
	mu       sync.Mutex
	dir      string
	onChange func(blockId string)
	now      func() int64
}

func NewStore(dir string) *Store {
	return &Store{dir: dir, now: func() int64 { return time.Now().UnixMilli() }}
}

// DefaultDir is where wavesrv keeps the files: `verify/` in the data dir.
func DefaultDir() string {
	return filepath.Join(wavebase.GetWaveDataDir(), "verify")
}

// SetOnChange sets the hook that runs after every stored report or skip; the server publishes `verify:changed`
// from it. It is called with no lock held.
func (s *Store) SetOnChange(fn func(blockId string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onChange = fn
}

// validBlockId keeps a block id usable as a file name: ids come from `WAVETERM_BLOCKID`, a uuid.
func validBlockId(id string) bool {
	if id == "" {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func (s *Store) file(blockId string) string {
	return filepath.Join(s.dir, blockId+".json")
}

// load reads a block's file with s.mu held. A missing file is an empty BlockFile; one that does not parse is
// logged and read as empty, so the next report writes a good one over it.
func (s *Store) load(blockId string) (BlockFile, error) {
	data, err := os.ReadFile(s.file(blockId))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return BlockFile{}, nil
		}
		return BlockFile{}, err
	}
	var bf BlockFile
	if err := json.Unmarshal(data, &bf); err != nil {
		log.Printf("[verifyruns] %s is not valid JSON, starting it afresh: %v\n", s.file(blockId), err)
		return BlockFile{}, nil
	}
	return bf, nil
}

func (s *Store) save(blockId string, bf BlockFile) error {
	data, err := json.Marshal(bf)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(s.file(blockId), data, 0o644)
}

func (s *Store) changed(blockId string) {
	s.mu.Lock()
	fn := s.onChange
	s.mu.Unlock()
	if fn != nil {
		fn(blockId)
	}
}

// Report stores one report from the harness, then runs the change hook.
func (s *Store) Report(r Report) error {
	if !validBlockId(r.BlockId) {
		return fmt.Errorf("verify report: bad block id %q", r.BlockId)
	}
	if r.RunId == "" {
		return errors.New("verify report: no run id")
	}
	switch r.Phase {
	case PhaseStart, PhaseProgress, PhaseEnd:
	default:
		return fmt.Errorf("verify report: unknown phase %q", r.Phase)
	}
	if err := s.update(r.BlockId, func(bf BlockFile, now int64) BlockFile { return Apply(bf, r, now) }); err != nil {
		return err
	}
	s.changed(r.BlockId)
	return nil
}

// Skip sets a scenario's row aside, or the not-run warning when scenario is "". undo takes the skip back.
func (s *Store) Skip(blockId, scenario string, undo bool) error {
	if !validBlockId(blockId) {
		return fmt.Errorf("verify skip: bad block id %q", blockId)
	}
	s.mu.Lock()
	bf, err := s.load(blockId)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	if undo {
		if _, ok := bf.Skips[scenario]; !ok {
			s.mu.Unlock()
			return nil // nothing to take back, and no file to make for it
		}
		delete(bf.Skips, scenario)
	} else {
		if bf.Skips == nil {
			bf.Skips = map[string]int64{}
		}
		bf.Skips[scenario] = s.now()
	}
	err = s.save(blockId, bf)
	s.mu.Unlock()
	if err != nil {
		return err
	}
	s.changed(blockId)
	return nil
}

func (s *Store) update(blockId string, fn func(bf BlockFile, now int64) BlockFile) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	bf, err := s.load(blockId)
	if err != nil {
		return err
	}
	return s.save(blockId, fn(bf, s.now()))
}

// Forget removes a block's file, when the block is deleted. A block that never reported has none.
func (s *Store) Forget(blockId string) error {
	if !validBlockId(blockId) {
		return fmt.Errorf("verify forget: bad block id %q", blockId)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, name := range []string{s.file(blockId), s.file(blockId) + fileutil.TempFileSuffix} {
		if err := os.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// Sweep removes the files nobody has touched for 30 days: blocks that closed while wavesrv was not listening.
func (s *Store) Sweep() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	cutoff := time.UnixMilli(s.now()).Add(-sweepAfter)
	var firstErr error
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !(strings.HasSuffix(name, ".json") || strings.HasSuffix(name, fileutil.TempFileSuffix)) {
			continue
		}
		info, err := e.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(s.dir, name)); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// pidAlive is the liveness probe Derive gets.
func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	ok, _ := process.PidExists(int32(pid))
	return ok
}

// State derives an agent's Verify state, reading the watched changes in cwd (the agent's checkout) now: they
// are never polled. A cwd with no repo, or whose repo has no `.arc/verify.json`, has no Verify: an empty State.
func (s *Store) State(ctx context.Context, blockId, cwd string) (State, error) {
	if !validBlockId(blockId) {
		return State{}, fmt.Errorf("verify state: bad block id %q", blockId)
	}
	if cwd == "" {
		return State{}, nil
	}
	root, err := RepoRoot(ctx, cwd)
	if err != nil {
		return State{}, nil // not a repo: nothing opted in
	}
	cfg, err := LoadConfig(root)
	if err != nil {
		return State{}, err
	}
	if cfg == nil {
		return State{}, nil
	}
	s.mu.Lock()
	bf, err := s.load(blockId)
	s.mu.Unlock()
	if err != nil {
		return State{}, err
	}
	changes, branch, defaultBranch, err := watchedChanges(ctx, root, cfg)
	if err != nil {
		return State{}, err
	}
	st := Derive(bf, pidAlive, changes, cfg.Rerun)
	st.Branch, st.DefaultBranch = branch, defaultBranch
	return st, nil
}
