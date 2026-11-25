// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package chatjudge is the judge for the choice questions Chat shows: the durable record kept for each turn that ends
// in a choice (its options, their neutral descriptions, the light pick), and the deep judge, a fresh sonnet session that
// reads the project and judges the options without seeing the agent's reply or its favourite.
package chatjudge

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// MaxRecords is how many turns the store keeps; the oldest by Ts go first.
	MaxRecords = 500

	restartedError = "Arc restarted while the judge read"
)

// Qualifies reports whether a turn gets a record: its reply ends in a question that is not yes-or-no (choice), and the
// model offered at least two answers.
func Qualifies(choice bool, replies []string) bool {
	return choice && len(replies) >= 2
}

// NewRecord is the record of a turn that qualifies, with no deep result yet. question is the question sentence the reply
// ends in (never the reply), replies and descs are the chips' texts and the model's neutral line for each (descs may be
// shorter than replies), pick is the light pick's text. Ts is Unix milliseconds, as are the deep result's StartTs and
// EndTs.
func NewRecord(key, blockID, question string, recent, replies, descs []string, pick, reason string) wshrpc.ChatJudgeRecord {
	options := make([]wshrpc.ChatJudgeOption, len(replies))
	for i, text := range replies {
		options[i].Text = text
		if i < len(descs) {
			options[i].Desc = descs[i]
		}
	}
	return wshrpc.ChatJudgeRecord{
		Key:      key,
		BlockId:  blockID,
		Ts:       time.Now().UnixMilli(),
		Question: question,
		Recent:   slices.Clone(recent),
		Options:  options,
		Pick:     pick,
		Reason:   reason,
	}
}

// Store keeps the records in memory and in one JSON file, written whole through a temp file and a rename. A record is a
// value the store replaces and never changes in place, so one returned by Get or List may be read while the store
// goes on; its slices must not be written to. Safe for concurrent use.
type Store struct {
	mu   sync.Mutex
	path string
	recs map[string]wshrpc.ChatJudgeRecord
}

// OpenStore reads the file at path: a missing file is an empty store. A record left in the reading state, whose judge
// died with the last wavesrv, comes back failed so the person can retry. The store is never nil: on a file that cannot
// be read the error is for the caller to log and the store starts empty, since a broken file must not stop wavesrv.
func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, recs: map[string]wshrpc.ChatJudgeRecord{}}
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, fmt.Errorf("chatjudge: reading %s: %w", path, err)
	}
	var recs []wshrpc.ChatJudgeRecord
	if err := json.Unmarshal(raw, &recs); err != nil {
		return s, fmt.Errorf("chatjudge: %s is not readable, the store starts empty: %w", path, err)
	}
	for _, rec := range recs {
		if rec.Key == "" {
			continue
		}
		if d := rec.Deep; d != nil && d.State == wshrpc.ChatJudgeState_Reading {
			failed := *d
			failed.State = wshrpc.ChatJudgeState_Failed
			failed.Error = restartedError
			rec.Deep = &failed
		}
		s.recs[rec.Key] = normalize(rec)
	}
	return s, nil
}

// normalize gives a record's options as [], never null: the frontend reads the list.
func normalize(rec wshrpc.ChatJudgeRecord) wshrpc.ChatJudgeRecord {
	if rec.Options == nil {
		rec.Options = []wshrpc.ChatJudgeOption{}
	}
	return rec
}

// Get is the record kept under key.
func (s *Store) Get(key string) (wshrpc.ChatJudgeRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.recs[key]
	return rec, ok
}

// Put stores rec under its key, replacing one that is there, and drops the oldest records past MaxRecords. The record is
// held in memory even when the write fails: the error is logged and returned.
func (s *Store) Put(rec wshrpc.ChatJudgeRecord) error {
	if rec.Key == "" {
		return errors.New("chatjudge: a record needs a key")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recs[rec.Key] = normalize(rec)
	if len(s.recs) > MaxRecords {
		all := s.sorted(nil)
		for _, old := range all[:len(all)-MaxRecords] {
			delete(s.recs, old.Key)
		}
	}
	return s.save()
}

// SetDeep sets the deep result of the record under key and answers the record as it now is. Like Put, the change holds
// in memory when the write fails, and the record answered comes with the write's error.
func (s *Store) SetDeep(key string, deep wshrpc.ChatJudgeDeep) (wshrpc.ChatJudgeRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.recs[key]
	if !ok {
		return wshrpc.ChatJudgeRecord{}, fmt.Errorf("chatjudge: no record under %q", key)
	}
	rec.Deep = &deep
	s.recs[key] = rec
	return rec, s.save()
}

// List is one agent's records, oldest first: the keys whose part before the first ':' is agentID. Never nil.
func (s *Store) List(agentID string) []wshrpc.ChatJudgeRecord {
	if agentID == "" {
		return []wshrpc.ChatJudgeRecord{}
	}
	prefix := agentID + ":"
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sorted(func(key string) bool { return strings.HasPrefix(key, prefix) })
}

// sorted is the records whose key keep admits (all when keep is nil), oldest first, a tie by key. The caller holds mu.
func (s *Store) sorted(keep func(key string) bool) []wshrpc.ChatJudgeRecord {
	out := make([]wshrpc.ChatJudgeRecord, 0, len(s.recs))
	for key, rec := range s.recs {
		if keep == nil || keep(key) {
			out = append(out, rec)
		}
	}
	slices.SortFunc(out, func(a, b wshrpc.ChatJudgeRecord) int {
		if a.Ts != b.Ts {
			if a.Ts < b.Ts {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Key, b.Key)
	})
	return out
}

// save writes every record to the file through a temp file and a rename. The caller holds mu. A failure is logged here,
// where waveapp.log is, and returned.
func (s *Store) save() error {
	if err := s.write(); err != nil {
		log.Printf("chatjudge: writing %s failed: %v\n", s.path, err)
		return fmt.Errorf("chatjudge: writing %s: %w", s.path, err)
	}
	return nil
}

func (s *Store) write() error {
	raw, err := json.Marshal(s.sorted(nil))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}
