// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// SessionEffort is the initiative an agent session's tab was tagged with when the tab closed. The session is named
// by its harness and transcript path, from which usagestats.SessionIdOf derives its id.
type SessionEffort struct {
	Harness    string `db:"harness"`
	Transcript string `db:"transcript"`
	EffortOID  string `db:"effortoid"`
	Ts         int64  `db:"ts"`
}

// RecordTabSessionEffort keeps the initiative tab is tagged with for the session of the agent in it, so the link
// survives the tab closing. A tab with no tag, agent or transcript yet has nothing to keep and records nothing.
// A session re-tagged and closed again keeps the latest.
func RecordTabSessionEffort(ctx context.Context, tab *waveobj.Tab) error {
	// the bare oid, as effortstore.BareOID gives it: effortstore imports wstore, so it can't be called here
	effortOID := strings.TrimPrefix(tab.Meta.GetString(waveobj.MetaKey_SessionEffort, ""), waveobj.OType_Effort+":")
	harness := tab.Meta.GetString(waveobj.MetaKey_SessionAgent, "")
	if effortOID == "" || harness == "" || len(tab.BlockIds) == 0 {
		return nil
	}
	block, err := DBGet[*waveobj.Block](ctx, tab.BlockIds[0])
	if err != nil {
		return fmt.Errorf("loading agent block %s: %w", tab.BlockIds[0], err)
	}
	if block == nil {
		return nil
	}
	transcript := block.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, "")
	if transcript == "" {
		return nil
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		tx.Exec(`INSERT INTO db_sessioneffort (harness, transcript, effortoid, ts) VALUES (?, ?, ?, ?)
			ON CONFLICT (harness, transcript) DO UPDATE SET effortoid = excluded.effortoid, ts = excluded.ts`,
			harness, transcript, effortOID, time.Now().UnixMilli())
		return tx.Err
	})
}

// GetSessionEfforts returns every recorded session-to-initiative link.
func GetSessionEfforts(ctx context.Context) ([]SessionEffort, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]SessionEffort, error) {
		var rows []SessionEffort
		tx.Select(&rows, `SELECT harness, transcript, effortoid, ts FROM db_sessioneffort`)
		if tx.Err != nil {
			return nil, tx.Err
		}
		return rows, nil
	})
}
