// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package sessionideas keeps what was floated in a session and never decided (docs/superpowers/specs/
// 2026-11-26-session-ideas-design.md): the ideas a scan found, the marks of the sessions it has read, and the state of
// the scan, in one state.json under the data dir's sessionideas/. One package owns every read and write of it, so the
// Brief region, Sprout's popup, Storage and `wsh sessionideas` cannot disagree.
//
// It imports neither pkg/jarvis (which reads the store for the Waiting line) nor pkg/effortstore: what needs
// initiatives (Keep, a scan's project context) is wired in pkg/wshrpc/wshserver, which imports both.
package sessionideas

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	dirName   = "sessionideas"
	stateFile = "state.json"
)

// storeMu serialises every read and write: a scan writes after each session while the cockpit reads and the person keeps
// or drops. It is shared by every Store, so Default() can hand out a new one each time.
var storeMu sync.Mutex

// publishChanged tells the cockpit the store was written. It carries no data: the counts and the session list are
// computed by the reader, so the frontend re-reads with SessionIdeasGet. A seam so tests can count the events without a
// broker.
var publishChanged = func() {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_SessionIdeasChanged})
}

// Store is the sessionideas folder. Now is the clock (nil is time.Now), for tests.
type Store struct {
	Root string
	Now  func() time.Time
}

// Default is the store of this install: sessionideas/ in the data dir. With no data dir (a test, a bare tool) it has no
// root, reads as empty and refuses to write, rather than writing into the working directory.
func Default() *Store {
	dir := wavebase.GetWaveDataDir()
	if dir == "" {
		return &Store{}
	}
	return &Store{Root: filepath.Join(dir, dirName)}
}

// Clock is the store's time: what a caller stamps a change with.
func (s *Store) Clock() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Store) statePath() string { return filepath.Join(s.Root, stateFile) }

// Load reads the store: empty when nothing was ever written, an error when state.json is there and cannot be read (a
// caller that went on from an empty store would write over it).
func (s *Store) Load() (wshrpc.SessionIdeasData, error) {
	storeMu.Lock()
	defer storeMu.Unlock()
	return s.load()
}

func (s *Store) load() (wshrpc.SessionIdeasData, error) {
	var d wshrpc.SessionIdeasData
	if s.Root != "" {
		raw, err := os.ReadFile(s.statePath())
		switch {
		case errors.Is(err, fs.ErrNotExist):
		case err != nil:
			return wshrpc.SessionIdeasData{}, err
		default:
			if err := json.Unmarshal(raw, &d); err != nil {
				return wshrpc.SessionIdeasData{}, fmt.Errorf("%s: %w", s.statePath(), err)
			}
		}
	}
	return normalize(d), nil
}

// normalize gives the lists a value, so the wire carries [] and never null.
func normalize(d wshrpc.SessionIdeasData) wshrpc.SessionIdeasData {
	if d.Ideas == nil {
		d.Ideas = []wshrpc.SessionIdea{}
	}
	for i := range d.Ideas {
		if d.Ideas[i].Quotes == nil {
			d.Ideas[i].Quotes = []wshrpc.SessionIdeaQuote{}
		}
	}
	if d.Marks == nil {
		d.Marks = []wshrpc.SessionIdeaMark{}
	}
	if d.Sessions == nil {
		d.Sessions = []wshrpc.SessionIdeasSession{}
	}
	return d
}

// Update loads the store, lets fn change it and writes it back through a temp file and a rename, so a reader never sees
// half of it, then publishes the event once. An error from fn writes nothing and publishes nothing. The session list and
// the three counts are not kept: the reader computes them.
func (s *Store) Update(fn func(*wshrpc.SessionIdeasData) error) error {
	if s.Root == "" {
		return errors.New("there is no data directory to keep session ideas in")
	}
	if err := s.update(fn); err != nil {
		return err
	}
	publishChanged()
	return nil
}

func (s *Store) update(fn func(*wshrpc.SessionIdeasData) error) error {
	storeMu.Lock()
	defer storeMu.Unlock()
	d, err := s.load()
	if err != nil {
		return err
	}
	if err := fn(&d); err != nil {
		return err
	}
	d.Sessions, d.Scanned, d.NotYet, d.LeavingSoon = nil, 0, 0, 0
	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		return err
	}
	return writeJSONAtomic(s.statePath(), normalize(d))
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
