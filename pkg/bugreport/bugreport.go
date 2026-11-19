// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package bugreport keeps the reports the footer's bug button saves: one folder per report in the data dir's reports/,
// holding report.json, screen.png and log.txt, moved to reports/done/ once Jarvis has handled it. One package owns
// every read and write of them, so the wire, the Jarvis row and `wsh bugreport` cannot disagree about a state.
//
// It imports neither wstore nor jarvis: a caller passes what it needs (the log dir, whether a tab is still open), so
// it tests on a temp dir. The states are the ones in pkg/wshrpc: waiting, handling, done.
package bugreport

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	doneDirName = "done"
	reportFile  = "report.json"
	screenFile  = "screen.png"
	logFile     = "log.txt"

	// logWindow is how much of the log a report keeps, counted back from the press.
	logWindow = 5 * time.Minute
	// maxLogBytes caps log.txt: a wavesrv panic loop writes ~20 stack traces a second, and the tail is what explains
	// the press.
	maxLogBytes = 1 << 20
	// keepDone is how long a handled report stays in done/.
	keepDone = 30 * 24 * time.Hour
)

// storeMu serialises every read and write of a store: the cockpit polls while a Jarvis agent marks reports done, and
// one process owns the folder (a `wsh` call goes through wavesrv). It is shared by every Store, so Default() can hand
// out a new one each time.
var storeMu sync.Mutex

// Store is the reports folder. Now is the clock (nil is time.Now), for tests.
type Store struct {
	Root string
	Now  func() time.Time
}

// Default is the store of this install: reports/ in the data dir. With no data dir (a test, a bare tool) it has no
// root, reads as empty and refuses to save, rather than writing into the working directory.
func Default() *Store {
	dir := wavebase.GetWaveDataDir()
	if dir == "" {
		return &Store{}
	}
	return &Store{Root: filepath.Join(dir, "reports")}
}

func (s *Store) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Store) doneRoot() string { return filepath.Join(s.Root, doneDirName) }

// validID says whether id can be the name of one report folder: a plain name, never a path that leads elsewhere.
func validID(id string) bool {
	if id == "" || id == doneDirName || strings.HasPrefix(id, ".") {
		return false
	}
	return !strings.ContainsAny(id, "/\\:\x00") && id == filepath.Base(id)
}

// Save writes a new report as waiting: report.json, screen.png when the picture decodes, and log.txt, the lines of
// waveapp.log (and waveapp.1.log, when it rolled inside the window) from 5 minutes before the press to now. An
// all-space text is refused. The id is the press time in local time, with -2, -3… on a collision. A handled report
// older than 30 days is deleted on the way.
func (s *Store) Save(data wshrpc.CommandBugReportSaveData, logDir string) (wshrpc.BugReport, error) {
	text := strings.TrimSpace(data.Text)
	if text == "" {
		return wshrpc.BugReport{}, errors.New("the report is empty: write what went wrong first")
	}
	if s.Root == "" {
		return wshrpc.BugReport{}, errors.New("there is no data directory to keep reports in")
	}
	saved := s.now()
	pressed := saved
	if data.Ts > 0 {
		pressed = time.UnixMilli(data.Ts)
	}
	// read and cut the log before taking the lock: it can be megabytes, and nothing here needs the store
	logText := windowLog(logDir, pressed.Add(-logWindow), saved)
	screen := decodeScreen(data.Screen64)

	storeMu.Lock()
	defer storeMu.Unlock()
	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		return wshrpc.BugReport{}, err
	}
	id, dir, err := s.newFolder(pressed)
	if err != nil {
		return wshrpc.BugReport{}, err
	}
	report := wshrpc.BugReport{
		Id: id, Ts: pressed.UnixMilli(), Text: text, Version: data.Version, Commit: data.Commit, Surface: data.Surface,
		State: wshrpc.BugReportState_Waiting,
	}
	if data.Agent != nil && (data.Agent.Id != "" || data.Agent.Name != "") {
		agent := *data.Agent
		report.Agent = &agent
	}
	// a region means something only on the picture it was drawn on, and an empty one is no region
	if data.Region != nil && len(screen) > 0 && data.Region.W > 0 && data.Region.H > 0 {
		region := *data.Region
		report.Region = &region
	}
	// report.json goes last: a folder with none is not a report yet, and a failed save leaves no folder at all
	writeAll := func() error {
		if len(screen) > 0 {
			if err := os.WriteFile(filepath.Join(dir, screenFile), screen, 0o644); err != nil {
				return err
			}
		}
		if err := os.WriteFile(filepath.Join(dir, logFile), logText, 0o644); err != nil {
			return err
		}
		return writeReport(dir, report)
	}
	if err := writeAll(); err != nil {
		os.RemoveAll(dir)
		return wshrpc.BugReport{}, err
	}
	s.prune(saved)
	return s.withWireFields(report, dir), nil
}

// newFolder makes the report's folder: its id is the press time, with a counter when that name is taken, in the live
// reports or in done/ (a handled report keeps its id).
func (s *Store) newFolder(pressed time.Time) (id, dir string, err error) {
	base := pressed.In(time.Local).Format("20060102-150405")
	for n := 1; n <= 1000; n++ {
		id = base
		if n > 1 {
			id = fmt.Sprintf("%s-%d", base, n)
		}
		if _, statErr := os.Stat(filepath.Join(s.doneRoot(), id)); statErr == nil {
			continue
		}
		dir = filepath.Join(s.Root, id)
		// Mkdir is the claim on the name: it fails when the folder exists
		switch mkErr := os.Mkdir(dir, 0o755); {
		case mkErr == nil:
			return id, dir, nil
		case errors.Is(mkErr, fs.ErrExist):
		default:
			return "", "", mkErr
		}
	}
	return "", "", fmt.Errorf("no free report id near %s", base)
}

// decodeScreen reads the picture Save is given: base64, with or without a data: URL in front. A picture that does not
// decode is no picture, not an error: the report is worth keeping without it.
func decodeScreen(screen64 string) []byte {
	s := strings.TrimSpace(screen64)
	if i := strings.Index(s, ";base64,"); strings.HasPrefix(s, "data:") && i >= 0 {
		s = s[i+len(";base64,"):]
	}
	if s == "" {
		return nil
	}
	png, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	return png
}

// writeReport writes report.json in dir, through a temp file and a rename so a reader never sees half of it. Dir and
// HasScreen are wire-only and never written.
func writeReport(dir string, r wshrpc.BugReport) error {
	r.Dir, r.HasScreen = "", false
	return writeJSONAtomic(filepath.Join(dir, reportFile), r)
}

func writeJSONAtomic(path string, v any) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// readReport reads dir's report.json. The folder's name is the id, whatever the file says.
func readReport(dir string) (wshrpc.BugReport, error) {
	raw, err := os.ReadFile(filepath.Join(dir, reportFile))
	if err != nil {
		return wshrpc.BugReport{}, err
	}
	var r wshrpc.BugReport
	if err := json.Unmarshal(raw, &r); err != nil {
		return wshrpc.BugReport{}, fmt.Errorf("%s: %w", filepath.Join(dir, reportFile), err)
	}
	r.Id = filepath.Base(dir)
	return r, nil
}

// withWireFields fills the fields only the wire carries: where the folder is and whether it holds a picture.
func (s *Store) withWireFields(r wshrpc.BugReport, dir string) wshrpc.BugReport {
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	r.Dir = dir
	_, err := os.Stat(filepath.Join(dir, screenFile))
	r.HasScreen = err == nil
	return r
}

// scan reads every report folder directly under dir, oldest first. A folder with no readable report.json is not a
// report (done/ itself is one such folder under the root) and is skipped, as is a dotted one.
func (s *Store) scan(dir string) ([]wshrpc.BugReport, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []wshrpc.BugReport
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		folder := filepath.Join(dir, e.Name())
		r, err := readReport(folder)
		if err != nil {
			continue
		}
		out = append(out, s.withWireFields(r, folder))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Ts != out[j].Ts {
			return out[i].Ts < out[j].Ts
		}
		// the same press: the counter's order (-2 before -10), not the text's
		if len(out[i].Id) != len(out[j].Id) {
			return len(out[i].Id) < len(out[j].Id)
		}
		return out[i].Id < out[j].Id
	})
	return out, nil
}

// live is the waiting and handling reports. A report in the root with any other state (a Done interrupted halfway)
// belongs to no list.
func (s *Store) live() ([]wshrpc.BugReport, error) {
	if s.Root == "" {
		return nil, nil
	}
	all, err := s.scan(s.Root)
	if err != nil {
		return nil, err
	}
	out := all[:0]
	for _, r := range all {
		if r.State == wshrpc.BugReportState_Waiting || r.State == wshrpc.BugReportState_Handling {
			out = append(out, r)
		}
	}
	return out, nil
}

// List is the reports in a state, oldest press first: waiting, handling or done (read from done/). An empty state is
// waiting and handling together.
func (s *Store) List(state string) ([]wshrpc.BugReport, error) {
	switch state {
	case "", wshrpc.BugReportState_Waiting, wshrpc.BugReportState_Handling, wshrpc.BugReportState_Done:
	default:
		return nil, fmt.Errorf("unknown report state %q: waiting, handling or done", state)
	}
	storeMu.Lock()
	defer storeMu.Unlock()
	if s.Root == "" {
		return []wshrpc.BugReport{}, nil
	}
	if state == wshrpc.BugReportState_Done {
		done, err := s.scan(s.doneRoot())
		for i := range done {
			done[i].State = wshrpc.BugReportState_Done // where the folder is says it, whatever its file says
		}
		return nonNil(done), err
	}
	reports, err := s.live()
	if err != nil {
		return nil, err
	}
	if state == "" {
		return nonNil(reports), nil
	}
	out := []wshrpc.BugReport{}
	for _, r := range reports {
		if r.State == state {
			out = append(out, r)
		}
	}
	return out, nil
}

func nonNil(r []wshrpc.BugReport) []wshrpc.BugReport {
	if r == nil {
		return []wshrpc.BugReport{}
	}
	return r
}

// Status counts the reports that wait and the ones an agent holds, and names that agent's tab. It does not look at
// whether the agent is still open: Reconcile first.
func (s *Store) Status() (waiting, handling int, handler string, err error) {
	storeMu.Lock()
	defer storeMu.Unlock()
	reports, err := s.live()
	if err != nil {
		return 0, 0, "", err
	}
	for _, r := range reports {
		switch r.State {
		case wshrpc.BugReportState_Waiting:
			waiting++
		case wshrpc.BugReportState_Handling:
			handling++
			if handler == "" {
				handler = r.Handler
			}
		}
	}
	return waiting, handling, handler, nil
}

// Reconcile turns every handling report whose agent is gone back to waiting, clearing the handler and the claim time:
// the agent that held them was closed before it finished. alive says whether a tab is still open, and is asked once per
// tab. A handling report with no handler at all is held by nobody and goes back too.
func (s *Store) Reconcile(alive func(tabID string) bool) error {
	if alive == nil {
		return nil
	}
	storeMu.Lock()
	defer storeMu.Unlock()
	reports, err := s.live()
	if err != nil {
		return err
	}
	verdicts := map[string]bool{}
	var firstErr error
	for _, r := range reports {
		if r.State != wshrpc.BugReportState_Handling {
			continue
		}
		if r.Handler != "" {
			open, asked := verdicts[r.Handler]
			if !asked {
				open = alive(r.Handler)
				verdicts[r.Handler] = open
			}
			if open {
				continue
			}
		}
		r.State, r.Handler, r.ClaimedTs = wshrpc.BugReportState_Waiting, "", 0
		if err := writeReport(r.Dir, r); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// Claim hands the listed reports that are still waiting to one agent (handling, with its tab id and the time) and
// returns the ids it took. It refuses, with an error, while any report is already handling (callers Reconcile first, so
// that is an agent still open): two agents never hold the same reports. An id that is not a waiting report (one
// deleted, or already claimed) is skipped, and a report sent after the caller listed stays waiting for the next time.
func (s *Store) Claim(agentID string, ids []string) ([]string, error) {
	if strings.TrimSpace(agentID) == "" {
		return nil, errors.New("claiming reports needs the agent's tab id")
	}
	for _, id := range ids {
		if !validID(id) {
			return nil, fmt.Errorf("%q is not a report id", id)
		}
	}
	storeMu.Lock()
	defer storeMu.Unlock()
	reports, err := s.live()
	if err != nil {
		return nil, err
	}
	waiting := map[string]wshrpc.BugReport{}
	for _, r := range reports {
		if r.State == wshrpc.BugReportState_Handling {
			return nil, fmt.Errorf("an agent is already handling %s: wait for it to finish", r.Id)
		}
		waiting[r.Id] = r
	}
	claimedAt := s.now().UnixMilli()
	claimed := []string{}
	var written []wshrpc.BugReport
	for _, id := range ids {
		r, ok := waiting[id]
		if !ok {
			continue
		}
		delete(waiting, id) // a repeated id is claimed once
		held := r
		held.State, held.Handler, held.ClaimedTs = wshrpc.BugReportState_Handling, agentID, claimedAt
		if err := writeReport(r.Dir, held); err != nil {
			// none or all: put the ones already written back
			for _, w := range written {
				w.State, w.Handler, w.ClaimedTs = wshrpc.BugReportState_Waiting, "", 0
				writeReport(w.Dir, w)
			}
			return nil, err
		}
		written = append(written, r)
		claimed = append(claimed, id)
	}
	return claimed, nil
}

// Done records what the agent did with a handling report and moves its folder to done/. A report that is not handling
// (waiting, or already done) is refused, so only the agent Process started finishes reports. A handled report older
// than 30 days is deleted on the way.
func (s *Store) Done(id string, outcome wshrpc.BugReportOutcome) error {
	if !validID(id) {
		return fmt.Errorf("%q is not a report id", id)
	}
	if s.Root == "" {
		return errors.New("there is no data directory to keep reports in")
	}
	storeMu.Lock()
	defer storeMu.Unlock()
	dir := filepath.Join(s.Root, id)
	r, err := readReport(dir)
	if err != nil {
		if _, statErr := os.Stat(filepath.Join(s.doneRoot(), id)); statErr == nil {
			return fmt.Errorf("report %s is already done", id)
		}
		return fmt.Errorf("no report %s is waiting or being handled", id)
	}
	if r.State != wshrpc.BugReportState_Handling {
		return fmt.Errorf("report %s is %s, not handling: only the agent that holds it can finish it", id, r.State)
	}
	if err := os.MkdirAll(s.doneRoot(), 0o755); err != nil {
		return err
	}
	// move first, then write: a folder that cannot move (a file in it is open) leaves the report handling, so the agent
	// can call again, instead of a done report stuck in the live folder
	dest := filepath.Join(s.doneRoot(), id)
	if err := os.Rename(dir, dest); err != nil {
		return fmt.Errorf("moving report %s to done: %w", id, err)
	}
	finished := s.now()
	r.State, r.Outcome, r.DoneTs = wshrpc.BugReportState_Done, &outcome, finished.UnixMilli()
	err = writeReport(dest, r)
	s.prune(finished)
	return err
}

// prune deletes the handled reports in done/ that were done more than 30 days before now. A folder with no readable
// report.json is judged by its own modified time. It runs on each Save and each Done, never on the polls.
func (s *Store) prune(now time.Time) {
	entries, err := os.ReadDir(s.doneRoot())
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		folder := filepath.Join(s.doneRoot(), e.Name())
		var doneAt time.Time
		if r, err := readReport(folder); err == nil && r.DoneTs > 0 {
			doneAt = time.UnixMilli(r.DoneTs)
		} else if info, err := e.Info(); err == nil {
			doneAt = info.ModTime()
		} else {
			continue
		}
		if now.Sub(doneAt) <= keepDone {
			continue
		}
		if err := os.RemoveAll(folder); err != nil {
			log.Printf("bugreport: cannot delete the old report %s: %v", folder, err)
		}
	}
}
