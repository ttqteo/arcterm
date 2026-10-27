// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"strings"
)

// SessionDay is one agent session's tokens on one local day: the daily tally behind a project's Activity
// card. Claude Code deletes transcripts after cleanupPeriodDays, so a row outlives the transcript it was
// read from; that is the point of keeping it.
type SessionDay struct {
	Day     string `db:"day"` // YYYY-MM-DD, server-local
	Harness string `db:"harness"`
	Session string `db:"session"`
	Cwd     string `db:"cwd"` // NormSessionCwd form
	Tokens  int64  `db:"tokens"`
}

// NormSessionCwd is the key a tallied cwd is stored and matched by: forward slashes, no trailing slash,
// lower-cased, so the query compares plain strings. normProjectPath (the frontend's key) plus case.
func NormSessionCwd(p string) string {
	return strings.ToLower(normProjectPath(p))
}

// UpsertSessionDays writes the rows in one transaction. A row replaces the tokens of its (day, harness,
// session), so a rescan of the same days is idempotent. Each row's Cwd must already be normalized.
func UpsertSessionDays(ctx context.Context, rows []SessionDay) error {
	if len(rows) == 0 {
		return nil
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		for _, r := range rows {
			tx.Exec(`INSERT INTO db_sessionday (day, harness, session, cwd, tokens) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(day, harness, session) DO UPDATE SET cwd = excluded.cwd, tokens = excluded.tokens`,
				r.Day, r.Harness, r.Session, r.Cwd, r.Tokens)
			if tx.Err != nil {
				return tx.Err
			}
		}
		return nil
	})
}

// QuerySessionDays returns the rows from fromDay on whose cwd is the project or sits under it, so a
// worktree inside the repo counts. The prefix test is substr, not LIKE: a path's _ and % are wildcards there.
func QuerySessionDays(ctx context.Context, project, fromDay string) ([]SessionDay, error) {
	p := NormSessionCwd(project)
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]SessionDay, error) {
		var rows []SessionDay
		tx.Select(&rows, `SELECT day, harness, session, cwd, tokens FROM db_sessionday
			WHERE day >= ? AND (cwd = ? OR substr(cwd, 1, length(?) + 1) = ? || '/')
			ORDER BY day, harness, session`, fromDay, p, p, p)
		if tx.Err != nil {
			return nil, tx.Err
		}
		return rows, nil
	})
}

// FirstSessionDay is the earliest day the tally holds for any project, or "" when it is empty.
func FirstSessionDay(ctx context.Context) (string, error) {
	return sessionDayEdge(ctx, "MIN")
}

// LastSessionDay is the newest day the tally holds for any project, or "" when it is empty.
func LastSessionDay(ctx context.Context) (string, error) {
	return sessionDayEdge(ctx, "MAX")
}

func sessionDayEdge(ctx context.Context, fn string) (string, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		var day *string
		tx.Get(&day, `SELECT `+fn+`(day) FROM db_sessionday`)
		if tx.Err != nil {
			return "", tx.Err
		}
		if day == nil {
			return "", nil
		}
		return *day, nil
	})
}
