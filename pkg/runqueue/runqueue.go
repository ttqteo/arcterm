// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package runqueue keeps the plans a session handed to the engine as queued starts, in the order they will start.
// The queue is one JSON file in the data dir, written atomically; an entry is the CommandCreateRunData a start
// would have sent, so starting it later is the same call. rules.go holds the pure decisions (which entry is
// ready, which is blocked, whether a run has ended); the loop that acts on them lives in wavesrv.
//
// This package imports neither pkg/jarvis nor pkg/orchestrate: jarvis imports it, and orchestrate imports jarvis.
package runqueue

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// ErrNotFound is wrapped by every error that names an id the queue does not hold (an entry that already started or
// was removed), so a caller racing the queue can tell it from a failed write.
var ErrNotFound = errors.New("no such queued entry")

// maxIdTries bounds the search for an unused entry id, so a queue that has used up every id fails rather than spins.
const maxIdTries = 64

// swapped by tests
var (
	storePath = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "runqueue.json") }
	now       = time.Now
	newId     = func() string {
		b := make([]byte, 2)
		_, _ = rand.Read(b)
		return "q-" + hex.EncodeToString(b)
	}
)

var mu sync.Mutex

type queueFile struct {
	Entries []wshrpc.RunQueueEntry `json:"entries"`
}

func load() ([]wshrpc.RunQueueEntry, error) {
	raw, err := os.ReadFile(storePath())
	if errors.Is(err, os.ErrNotExist) {
		return []wshrpc.RunQueueEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	var f queueFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("reading %s: %w", storePath(), err)
	}
	if f.Entries == nil {
		f.Entries = []wshrpc.RunQueueEntry{}
	}
	return f.Entries, nil
}

func save(entries []wshrpc.RunQueueEntry) error {
	if entries == nil {
		entries = []wshrpc.RunQueueEntry{}
	}
	raw, err := json.MarshalIndent(queueFile{Entries: entries}, "", "  ")
	if err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(storePath(), raw, 0600)
}

func notFound(id string) error { return fmt.Errorf("%w: %s", ErrNotFound, id) }

func indexOf(entries []wshrpc.RunQueueEntry, id string) int {
	for i := range entries {
		if entries[i].Id == id {
			return i
		}
	}
	return -1
}

// update loads the queue, lets fn edit it (i is the index of the entry with this id), and writes the result back.
func update(id string, fn func(entries []wshrpc.RunQueueEntry, i int) []wshrpc.RunQueueEntry) error {
	mu.Lock()
	defer mu.Unlock()
	entries, err := load()
	if err != nil {
		return err
	}
	i := indexOf(entries, id)
	if i < 0 {
		return notFound(id)
	}
	return save(fn(entries, i))
}

// List returns the entries in queue order; a missing file is an empty queue.
func List() ([]wshrpc.RunQueueEntry, error) {
	mu.Lock()
	defer mu.Unlock()
	return load()
}

// Add appends e as the last entry, waiting. It mints the id and the time; the caller's Id, QueuedTs, State and Reason
// are not kept.
func Add(e wshrpc.RunQueueEntry) (wshrpc.RunQueueEntry, error) {
	mu.Lock()
	defer mu.Unlock()
	entries, err := load()
	if err != nil {
		return wshrpc.RunQueueEntry{}, err
	}
	e.Id = ""
	for try := 0; try < maxIdTries && e.Id == ""; try++ {
		if id := newId(); indexOf(entries, id) < 0 {
			e.Id = id
		}
	}
	if e.Id == "" {
		return wshrpc.RunQueueEntry{}, errors.New("could not find an unused queue entry id")
	}
	e.QueuedTs = now().UnixMilli()
	e.State = wshrpc.RunQueueState_Waiting
	e.Reason = ""
	if err := save(append(entries, e)); err != nil {
		return wshrpc.RunQueueEntry{}, err
	}
	return e, nil
}

// Remove drops the entry.
func Remove(id string) error {
	return update(id, func(entries []wshrpc.RunQueueEntry, i int) []wshrpc.RunQueueEntry {
		return append(entries[:i], entries[i+1:]...)
	})
}

// MoveFirst puts the entry at the head of the queue, ahead of every other entry and behind none.
func MoveFirst(id string) error {
	return update(id, func(entries []wshrpc.RunQueueEntry, i int) []wshrpc.RunQueueEntry {
		e := entries[i]
		copy(entries[1:i+1], entries[:i])
		entries[0] = e
		return entries
	})
}

// SetBlocked marks the entry blocked, with the reason the tree and Needs you show. blockedOn is the run whose outcome
// blocked it, so the block lifts when that run lands later; it is empty for a block that is not about a run's outcome
// (a start that failed, a plan that is gone, an entry that was removed), which only the person lifts.
func SetBlocked(id, reason, blockedOn string) error {
	return update(id, func(entries []wshrpc.RunQueueEntry, i int) []wshrpc.RunQueueEntry {
		entries[i].State = wshrpc.RunQueueState_Blocked
		entries[i].Reason = reason
		entries[i].BlockedOn = blockedOn
		return entries
	})
}

// SetWaiting clears a block.
func SetWaiting(id string) error {
	return update(id, func(entries []wshrpc.RunQueueEntry, i int) []wshrpc.RunQueueEntry {
		entries[i].State = wshrpc.RunQueueState_Waiting
		entries[i].Reason = ""
		entries[i].BlockedOn = ""
		return entries
	})
}

// Retarget points every entry that waits After fromId at toId, in one write: the way entries chained behind a queue
// entry follow it to the run it became. Nothing is written when none match.
func Retarget(fromId, toId string) error {
	if fromId == "" || toId == "" {
		return errors.New("retarget needs both a from id and a to id")
	}
	mu.Lock()
	defer mu.Unlock()
	entries, err := load()
	if err != nil {
		return err
	}
	changed := false
	for i := range entries {
		if entries[i].After == fromId {
			entries[i].After = toId
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return save(entries)
}

// Resolve finds an entry by its exact id or by a prefix of it that no other entry shares.
func Resolve(prefix string) (wshrpc.RunQueueEntry, error) {
	if prefix == "" {
		return wshrpc.RunQueueEntry{}, errors.New("no queue entry id given")
	}
	mu.Lock()
	defer mu.Unlock()
	entries, err := load()
	if err != nil {
		return wshrpc.RunQueueEntry{}, err
	}
	if i := indexOf(entries, prefix); i >= 0 {
		return entries[i], nil
	}
	var matches []wshrpc.RunQueueEntry
	for _, e := range entries {
		if strings.HasPrefix(e.Id, prefix) {
			matches = append(matches, e)
		}
	}
	switch len(matches) {
	case 0:
		return wshrpc.RunQueueEntry{}, notFound(prefix)
	case 1:
		return matches[0], nil
	}
	ids := make([]string, len(matches))
	for i, e := range matches {
		ids[i] = e.Id
	}
	return wshrpc.RunQueueEntry{}, fmt.Errorf("%q matches %d queued entries: %s", prefix, len(matches), strings.Join(ids, ", "))
}
