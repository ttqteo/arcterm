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
	"slices"
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
	var f struct {
		Entries []json.RawMessage `json:"entries"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("reading %s: %w", storePath(), err)
	}
	entries := make([]wshrpc.RunQueueEntry, 0, len(f.Entries))
	for _, r := range f.Entries {
		e, err := loadEntry(r)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", storePath(), err)
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// loadEntry reads one entry. A queue file written before After became a list holds a single id as a string, and an
// entry with no After an empty one: both read as a list here, the one place that compatibility lives. save writes
// the list form, so the next write converts the file.
func loadEntry(raw json.RawMessage) (wshrpc.RunQueueEntry, error) {
	// the outer After shadows the entry's own, so the raw value is ours to read either way
	var e struct {
		wshrpc.RunQueueEntry
		After json.RawMessage `json:"after"`
	}
	if err := json.Unmarshal(raw, &e); err != nil {
		return wshrpc.RunQueueEntry{}, err
	}
	entry := e.RunQueueEntry
	entry.After = nil
	if len(e.After) == 0 || string(e.After) == "null" {
		return entry, nil
	}
	if e.After[0] == '"' {
		var id string
		if err := json.Unmarshal(e.After, &id); err != nil {
			return wshrpc.RunQueueEntry{}, err
		}
		if id != "" {
			entry.After = []string{id}
		}
		return entry, nil
	}
	if err := json.Unmarshal(e.After, &entry.After); err != nil {
		return wshrpc.RunQueueEntry{}, err
	}
	if len(entry.After) == 0 {
		entry.After = nil
	}
	return entry, nil
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

// Retarget replaces fromId with toId inside the After list of every entry that holds it, in one write: the way
// entries chained behind a queue entry follow it to the run it became. An entry that already waits on toId keeps it
// once. Nothing is written when none match.
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
		if !slices.Contains(entries[i].After, fromId) {
			continue
		}
		after := make([]string, 0, len(entries[i].After))
		for _, id := range entries[i].After {
			if id == fromId {
				id = toId
			}
			if !slices.Contains(after, id) {
				after = append(after, id)
			}
		}
		entries[i].After = after
		changed = true
	}
	if !changed {
		return nil
	}
	return save(entries)
}

// WaitAlsoOn has a waiting entry wait for more runs: it appends the ids it does not already hold, in the order given,
// and sets Reason to why (the re-check's "Waiting for X too: both edit land.go"), in one write. The entry stays as it
// is otherwise; one that was blocked meanwhile keeps its block whole, since a block is the newer truth. Nothing is
// written when no id is new, and the reason is not set then either: there is nothing more to wait for.
func WaitAlsoOn(id string, add []string, reason string) error {
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
	if entries[i].State == wshrpc.RunQueueState_Blocked {
		return nil
	}
	after := slices.Clone(entries[i].After)
	for _, a := range add {
		if a != "" && !slices.Contains(after, a) {
			after = append(after, a)
		}
	}
	if len(after) == len(entries[i].After) {
		return nil
	}
	entries[i].After = after
	entries[i].Reason = reason
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
