// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// GetRunsCreatedSince returns every run created at or after sinceTs, across channels, oldest first. Pure read
// (read pool).
func GetRunsCreatedSince(ctx context.Context, sinceTs int64) ([]*waveobj.Run, error) {
	return selectRuns(ctx, `SELECT oid, version, data FROM db_run
		WHERE json_extract(data, '$.createdts') >= ?
		ORDER BY json_extract(data, '$.createdts') ASC`, sinceTs)
}

// QueryRunEventsSince returns the events of the given kinds stamped at or after sinceTs, across every run,
// oldest first. Pure read (read pool).
func QueryRunEventsSince(ctx context.Context, sinceTs int64, kinds []string) ([]waveobj.RunEvent, error) {
	if len(kinds) == 0 {
		return []waveobj.RunEvent{}, nil
	}
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]waveobj.RunEvent, error) {
		marks := strings.TrimSuffix(strings.Repeat("?,", len(kinds)), ",")
		args := make([]any, 0, len(kinds)+1)
		args = append(args, sinceTs)
		for _, kind := range kinds {
			args = append(args, kind)
		}
		var rows []runEventRow
		tx.Select(&rows, `SELECT oid, runid, channelid, ts, kind, phaseidx, data FROM db_runevent
			WHERE ts >= ? AND kind IN (`+marks+`)
			ORDER BY ts ASC, rowid ASC`, args...)
		if tx.Err != nil {
			return nil, tx.Err
		}
		return runEventsFromRows(rows), nil
	})
}

// GetWorkflowScanRuns returns every run that carries a WorkflowScan, across channels. Pure read (read pool).
func GetWorkflowScanRuns(ctx context.Context) ([]*waveobj.Run, error) {
	return selectRuns(ctx, `SELECT oid, version, data FROM db_run WHERE json_extract(data, '$.workflowscan') IS NOT NULL`)
}
