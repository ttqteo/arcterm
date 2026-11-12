// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memgate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
)

// LearnedBytes is the "turns heavy" threshold: an unknown command whose measured peak reaches it is learned. It is
// also a learned job's figure until wavesrv replaces it with its own estimate.
const LearnedBytes uint64 = 1 << 30

// learnedFile is the file wsh and wavesrv share: the patterns of the unknown commands that proved heavy, which wsh
// then sends to the queue like any command in the table.
type learnedFile struct {
	Patterns []string `json:"patterns"`
}

// LearnedPath is <home>/.arc/jobslot-learned.json.
func LearnedPath(home string) string {
	return filepath.Join(home, ".arc", "jobslot-learned.json")
}

// ReadLearned reads the learned patterns. A missing, unreadable or broken file is an empty, non-nil set: a command
// that has not been learned simply runs without a slot, as it did before there was a file.
func ReadLearned(path string) map[string]bool {
	set := map[string]bool{}
	data, err := os.ReadFile(path)
	if err != nil {
		return set
	}
	var file learnedFile
	if err := json.Unmarshal(data, &file); err != nil {
		return set
	}
	for _, pattern := range file.Patterns {
		set[pattern] = true
	}
	return set
}

// WriteLearned writes the patterns, sorted and without repeats, to a temp file in path's directory (created if
// missing), then renames it over path, so a reader sees the old file or the new one, never half of either.
func WriteLearned(path string, patterns []string) error {
	sorted := slices.Clone(patterns)
	slices.Sort(sorted)
	sorted = slices.Compact(sorted)
	if sorted == nil {
		sorted = []string{} // an empty list, not null
	}
	data, err := json.Marshal(learnedFile{Patterns: sorted})
	if err != nil {
		return err
	}
	data = append(data, '\n')

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
