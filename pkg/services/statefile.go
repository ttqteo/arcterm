// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// FileStore keeps what arcterm remembers about each service in one json file of its own, never in tools.json.
type FileStore struct {
	path string

	mu   sync.Mutex
	data map[string]Remembered
}

// NewFileStore reads path; a missing or unreadable file reads empty.
func NewFileStore(path string) *FileStore {
	f := &FileStore{path: path, data: map[string]Remembered{}}
	raw, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[services] reading %s: %v\n", path, err)
		}
		return f
	}
	if err := json.Unmarshal(raw, &f.data); err != nil || f.data == nil {
		log.Printf("[services] %s is not readable, starting empty: %v\n", path, err)
		f.data = map[string]Remembered{}
	}
	return f
}

func (f *FileStore) Get(id string) Remembered {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.data[id]
}

// Set remembers r for id and writes the file atomically (a temp file in the same folder, then a rename). An empty r
// forgets the service.
func (f *FileStore) Set(id string, r Remembered) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	next := make(map[string]Remembered, len(f.data)+1)
	for k, v := range f.data {
		next[k] = v
	}
	if r == (Remembered{}) {
		delete(next, id)
	} else {
		next[id] = r
	}
	raw, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(f.path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(f.path), "services-*.tmp")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(raw)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		os.Remove(tmp.Name())
		return errors.Join(werr, cerr)
	}
	if err := os.Rename(tmp.Name(), f.path); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	f.data = next
	return nil
}
