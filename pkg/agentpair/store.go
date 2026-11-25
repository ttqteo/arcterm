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

// loadActive reads every pair file that is not ended. A file that does not read is logged and skipped: one bad file
// must not hide the other pairs. A folder that does not exist yet holds no pairs.
func (s store) loadActive() ([]*Pair, error) {
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
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("pairs: reading %s: %v\n", path, err)
			continue
		}
		var p Pair
		if err := json.Unmarshal(data, &p); err != nil {
			log.Printf("pairs: %s does not parse: %v\n", path, err)
			continue
		}
		if p.Id == "" || p.State == StateEnded {
			continue
		}
		if p.Pending == nil {
			p.Pending = map[string][]string{}
		}
		if p.Seen == nil {
			p.Seen = map[string]int64{}
		}
		pairs = append(pairs, &p)
	}
	return pairs, nil
}
