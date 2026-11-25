// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

// store keeps one JSON file per pair, <dir>/<pair id>.json, written atomically. An ended pair keeps its file.
type store struct {
	dir string
}

func (s store) path(id string) string { return filepath.Join(s.dir, id+".json") }

// save writes the pair whole, replacing its file.
func (s store) save(p *Pair) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return fmt.Errorf("pair %s: making %s: %w", p.Id, s.dir, err)
	}
	data, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("pair %s: encoding: %w", p.Id, err)
	}
	if err := fileutil.AtomicWriteFile(s.path(p.Id), data, 0o600); err != nil {
		return fmt.Errorf("pair %s: writing: %w", p.Id, err)
	}
	return nil
}

// readFile reads one pair file; its error names the file. The pair's queues come back as maps the manager can write to.
func readFile(path string) (*Pair, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p Pair
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("%s does not parse: %w", path, err)
	}
	if p.Pending == nil {
		p.Pending = map[string][]string{}
	}
	if p.Seen == nil {
		p.Seen = map[string]int64{}
	}
	return &p, nil
}

// read is the pair of one id, from <dir>/<id>.json. A pair with no file wraps os.ErrNotExist. The id must already be
// checked: it names a file.
func (s store) read(id string) (*Pair, error) {
	p, err := readFile(s.path(id))
	if err != nil {
		return nil, err
	}
	if p.Id != id {
		return nil, fmt.Errorf("%s holds pair %q, not %q", s.path(id), p.Id, id)
	}
	return p, nil
}

// readAll reads every pair file of the folder, whatever the pair's state. A file that does not read is logged and
// skipped: one bad file must not hide the other pairs. A folder that does not exist yet holds no pairs.
func (s store) readAll() ([]*Pair, error) {
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", s.dir, err)
	}
	var pairs []*Pair
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		path := filepath.Join(s.dir, e.Name())
		p, err := readFile(path)
		if err != nil {
			log.Printf("pairs: %v\n", err) // the error names the file
			continue
		}
		if p.Id == "" {
			continue
		}
		pairs = append(pairs, p)
	}
	return pairs, nil
}

// loadActive reads every pair file that is not ended: the pairs the manager keeps in its index.
func (s store) loadActive() ([]*Pair, error) {
	all, err := s.readAll()
	if err != nil {
		return nil, err
	}
	var active []*Pair
	for _, p := range all {
		if p.State != StateEnded {
			active = append(active, p)
		}
	}
	return active, nil
}
