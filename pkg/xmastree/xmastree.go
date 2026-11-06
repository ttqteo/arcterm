// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package xmastree is the season ledger behind the Office hall's Christmas tree: which orchestrator tasks finished in
// the current season, and when. The season's dates live here only; the frontend never computes them.
//
// The ledger crosses machines through the vault: each install writes the season's tasks it finished to
// <vault>/xmastree/<season>/<client id>.json, and the tree counts the tasks in its own store and in every file there.
// An install writes only its own file, so a vault sync never conflicts on one.
package xmastree

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// The phases of the year, as XmasTreeData.Phase carries them.
const (
	PhaseSeason  = "season"  // 1 November to 31 December
	PhaseNewYear = "newyear" // all of 1 January
	PhaseOff     = "off"     // 2 January to 31 October
)

// VaultDir is the vault folder holding each install's season ledger, at VaultDir/<season>/<client id>.json.
const VaultDir = "xmastree"

const ledgerExt = ".json"

// vaultRoot is the vault the ledger files live in, or nil until EnableVaultSync: a test of another package that
// finishes a task never writes the user's vault. clientID names this install's file.
var (
	vaultRoot func() string
	clientID  = wstore.GetClientId
)

// EnableVaultSync makes the tree write its ledger file to the configured vault and count the other machines' files,
// and republish the tree after a vault sync pulls. wavesrv calls it once at startup, before the vault sync loop
// starts.
func EnableVaultSync() {
	vaultRoot = memroots.VaultRoot
	wavevault.AfterPull = func() { Republish(context.Background()) }
}

// SeasonAt places now in the year, in server-local time. In season and newyear it returns the season (the year its
// November falls in) and the window [1 Nov 00:00, 2 Jan 00:00) in which a finished task counts. In off it returns the
// season that opens next (now's year, since off runs from 2 January to 31 October) and a zero window.
func SeasonAt(now time.Time) (season int, phase string, from, to time.Time) {
	now = now.Local()
	year, month, day := now.Date()
	switch {
	case month >= time.November:
		season, phase = year, PhaseSeason
	case month == time.January && day == 1:
		season, phase = year-1, PhaseNewYear
	default:
		return year, PhaseOff, time.Time{}, time.Time{}
	}
	from = time.Date(season, time.November, 1, 0, 0, 0, 0, time.Local)
	to = time.Date(season+1, time.January, 2, 0, 0, 0, 0, time.Local)
	return season, phase, from, to
}

// backfill remembers the season window whose backfill has run in this process. It is keyed by the window's start
// rather than a bare sync.Once, so a wavesrv that runs from one season into the next backfills the new one too. A
// failed backfill leaves it unset and is tried again on the next Read.
var backfill struct {
	sync.Mutex
	from time.Time
}

// RecordTaskDone adds an orchestrator task's finish to the ledger: runID is the DAG's run id, taskID its task id, ts
// the finish in ms. A task already in the ledger (a retry that finished again) keeps its first finish and counts once.
// When the row is new, the tree's data is published as xmastree:changed, and in season the vault's ledger file is
// rewritten.
func RecordTaskDone(ctx context.Context, runID, taskID string, ts int64) error {
	inserted, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (bool, error) {
		res := tx.Exec(`INSERT OR IGNORE INTO db_xmastask (runid, taskid, ts) VALUES (?, ?, ?)`, runID, taskID, ts)
		if tx.Err != nil {
			return false, tx.Err
		}
		n, err := res.RowsAffected()
		return n > 0, err
	})
	if err != nil || !inserted {
		return err
	}
	now := time.Now()
	if season, phase, from, to := SeasonAt(now); phase != PhaseOff {
		exportLater(season, from, to)
	}
	data, err := Read(ctx, now)
	if err != nil {
		return fmt.Errorf("recorded, but reading the tree to publish it: %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_XmasTreeChanged, Data: data})
	return nil
}

// Republish publishes the tree's data as xmastree:changed, for a vault sync that may have brought another machine's
// tasks. Off season it publishes nothing.
func Republish(ctx context.Context) {
	data, err := Read(ctx, time.Now())
	if err != nil {
		log.Printf("xmastree: reading the tree after a vault pull: %v", err)
		return
	}
	if data.Phase == PhaseOff {
		return
	}
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_XmasTreeChanged, Data: data})
}

// Read answers the tree's data at now: the season, its phase, and each counted task's finish time in ms, oldest first
// (ties by run id, then task id). The counted tasks are this store's ledger and every install's vault file, a task in
// several counted once at its first finish. Done is never nil, and empty in off. The first Read of a season in this
// process first backfills the ledger from the run log's task-done events in the season's window, then rewrites this
// install's vault file.
func Read(ctx context.Context, now time.Time) (*wshrpc.XmasTreeData, error) {
	season, phase, from, to := SeasonAt(now)
	data := &wshrpc.XmasTreeData{Season: season, Phase: phase, Done: []int64{}}
	if phase == PhaseOff {
		return data, nil
	}
	ran, err := ensureBackfill(ctx, from, to)
	if err != nil {
		return nil, err
	}
	if ran {
		exportLater(season, from, to)
	}
	local, err := selectLedger(ctx, from, to)
	if err != nil {
		return nil, err
	}
	for _, t := range mergeTasks(local, readVault(season, from, to)) {
		data.Done = append(data.Done, t.Ts)
	}
	return data, nil
}

// ensureBackfill copies the run log's task-done events in [from, to) into the ledger, once per season window per
// process, and reports whether it ran this call. It is idempotent (INSERT OR IGNORE on the ledger's key), so a restart
// that runs it again, or a task the live writer already recorded, counts once. An event with no task id is skipped.
func ensureBackfill(ctx context.Context, from, to time.Time) (bool, error) {
	backfill.Lock()
	defer backfill.Unlock()
	if backfill.from.Equal(from) {
		return false, nil
	}
	err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		tx.Exec(`INSERT OR IGNORE INTO db_xmastask (runid, taskid, ts)
			SELECT runid, json_extract(data, '$.taskid'), ts FROM db_runevent
			WHERE kind = ? AND ts >= ? AND ts < ?
				AND json_extract(data, '$.taskid') IS NOT NULL AND json_extract(data, '$.taskid') != ''`,
			waveobj.RunEventKindTaskDone, from.UnixMilli(), to.UnixMilli())
		return tx.Err
	})
	if err != nil {
		return false, fmt.Errorf("xmastree backfill: %w", err)
	}
	backfill.from = from
	return true, nil
}

// ledgerTask is one finished task, as a ledger row and as an entry of a vault ledger file.
type ledgerTask struct {
	RunID  string `json:"runid" db:"runid"`
	TaskID string `json:"taskid" db:"taskid"`
	Ts     int64  `json:"ts" db:"ts"`
}

func selectLedger(ctx context.Context, from, to time.Time) ([]ledgerTask, error) {
	return wstore.WithReadTxRtn(ctx, func(tx *wstore.TxWrap) ([]ledgerTask, error) {
		var rows []ledgerTask
		tx.Select(&rows, `SELECT runid, taskid, ts FROM db_xmastask WHERE ts >= ? AND ts < ?`,
			from.UnixMilli(), to.UnixMilli())
		return rows, tx.Err
	})
}

// mergeTasks unions the lists, a task (run id + task id) in several kept once at its earliest finish, sorted by
// finish, then run id, then task id.
func mergeTasks(lists ...[]ledgerTask) []ledgerTask {
	first := map[[2]string]int64{}
	for _, list := range lists {
		for _, t := range list {
			key := [2]string{t.RunID, t.TaskID}
			if ts, seen := first[key]; !seen || t.Ts < ts {
				first[key] = t.Ts
			}
		}
	}
	out := make([]ledgerTask, 0, len(first))
	for key, ts := range first {
		out = append(out, ledgerTask{RunID: key[0], TaskID: key[1], Ts: ts})
	}
	slices.SortFunc(out, func(a, b ledgerTask) int {
		return cmp.Or(cmp.Compare(a.Ts, b.Ts), strings.Compare(a.RunID, b.RunID), strings.Compare(a.TaskID, b.TaskID))
	})
	return out
}

func seasonDir(root string, season int) string {
	return filepath.Join(root, VaultDir, strconv.Itoa(season))
}

// readVault reads every install's ledger file for the season, keeping the tasks inside [from, to) that name a run
// and a task. A file it cannot read or parse (one a sync is writing) is skipped: the sync's AfterPull reads again.
func readVault(season int, from, to time.Time) []ledgerTask {
	if vaultRoot == nil {
		return nil
	}
	dir := seasonDir(vaultRoot(), season)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("xmastree: reading %s: %v", dir, err)
		}
		return nil
	}
	var out []ledgerTask
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ledgerExt) {
			continue
		}
		tasks, err := readLedgerFile(filepath.Join(dir, e.Name()))
		if err != nil {
			log.Printf("xmastree: skipping %s: %v", e.Name(), err)
			continue
		}
		for _, t := range tasks {
			if t.RunID != "" && t.TaskID != "" && t.Ts >= from.UnixMilli() && t.Ts < to.UnixMilli() {
				out = append(out, t)
			}
		}
	}
	return out
}

func readLedgerFile(path string) ([]ledgerTask, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var tasks []ledgerTask
	if err := json.Unmarshal(content, &tasks); err != nil {
		return nil, err
	}
	return tasks, nil
}

// exports serializes the ledger file's writes, so a later write never loses to an earlier one; pendingExports lets
// a test wait for them.
var (
	exportMu       sync.Mutex
	pendingExports sync.WaitGroup
)

// exportLater rewrites this install's ledger file off the caller's goroutine: the write waits for the vault lock,
// which a sync holds through its fetch and push, and neither the engine nor an RPC should wait on that.
func exportLater(season int, from, to time.Time) {
	if vaultRoot == nil {
		return
	}
	pendingExports.Add(1)
	go func() {
		defer pendingExports.Done()
		defer func() {
			panichandler.PanicHandler("xmastree export", recover())
		}()
		if err := exportSeason(context.Background(), season, from, to); err != nil {
			log.Printf("xmastree: writing the season's ledger to the vault: %v", err)
		}
	}()
}

// exportSeason writes this install's ledger file for the season: the store's tasks in [from, to) plus those the file
// already holds (so a cleared store does not take ornaments off the tree), when that changes the file, and pokes the
// vault sync. An install with no client id, or no task this season, writes nothing.
func exportSeason(ctx context.Context, season int, from, to time.Time) error {
	id := clientID()
	if id == "" || vaultRoot == nil {
		return nil
	}
	exportMu.Lock()
	defer exportMu.Unlock()
	local, err := selectLedger(ctx, from, to)
	if err != nil {
		return err
	}
	root := vaultRoot()
	path := filepath.Join(seasonDir(root, season), id+ledgerExt)
	old, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	var kept []ledgerTask
	if len(old) > 0 {
		if err := json.Unmarshal(old, &kept); err != nil {
			log.Printf("xmastree: %s is malformed, rewriting it from the store: %v", path, err)
			kept = nil
		}
	}
	tasks := mergeTasks(local, kept)
	if len(tasks) == 0 {
		return nil
	}
	content, err := json.MarshalIndent(tasks, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	if bytes.Equal(content, old) {
		return nil
	}
	// under the vault lock, so a sync's `git add -A` never stages the atomic write's temp file
	unlock := wavevault.LockRoot(root)
	defer unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := fileutil.AtomicWriteFile(path, content, 0o644); err != nil {
		return err
	}
	wavevault.Poke()
	return nil
}
