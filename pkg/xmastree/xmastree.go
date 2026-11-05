// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package xmastree is the season ledger behind the Office hall's Christmas tree: which orchestrator tasks finished in
// the current season, and when. The season's dates live here only; the frontend never computes them.
package xmastree

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
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
// When the row is new, the tree's data is published as xmastree:changed.
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
	data, err := Read(ctx, time.Now())
	if err != nil {
		return fmt.Errorf("recorded, but reading the tree to publish it: %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_XmasTreeChanged, Data: data})
	return nil
}

// Read answers the tree's data at now: the season, its phase, and each counted task's finish time in ms, oldest first
// (ties by run id, then task id). Done is never nil, and empty in off. The first Read of a season in this process
// first backfills the ledger from the run log's task-done events in the season's window.
func Read(ctx context.Context, now time.Time) (*wshrpc.XmasTreeData, error) {
	season, phase, from, to := SeasonAt(now)
	data := &wshrpc.XmasTreeData{Season: season, Phase: phase, Done: []int64{}}
	if phase == PhaseOff {
		return data, nil
	}
	if err := ensureBackfill(ctx, from, to); err != nil {
		return nil, err
	}
	done, err := wstore.WithReadTxRtn(ctx, func(tx *wstore.TxWrap) ([]int64, error) {
		var done []int64
		tx.Select(&done, `SELECT ts FROM db_xmastask WHERE ts >= ? AND ts < ? ORDER BY ts, runid, taskid`,
			from.UnixMilli(), to.UnixMilli())
		return done, tx.Err
	})
	if err != nil {
		return nil, err
	}
	if done != nil {
		data.Done = done
	}
	return data, nil
}

// ensureBackfill copies the run log's task-done events in [from, to) into the ledger, once per season window per
// process. It is idempotent (INSERT OR IGNORE on the ledger's key), so a restart that runs it again, or a task the
// live writer already recorded, counts once. An event with no task id is skipped.
func ensureBackfill(ctx context.Context, from, to time.Time) error {
	backfill.Lock()
	defer backfill.Unlock()
	if backfill.from.Equal(from) {
		return nil
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
		return fmt.Errorf("xmastree backfill: %w", err)
	}
	backfill.from = from
	return nil
}
