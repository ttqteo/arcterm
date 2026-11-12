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
// A session re-tagged and closed again keeps the latest. The agent's block is the first that names a transcript,
// not the first block: once the agent's own block is gone the dock terminal can be first, and it names none.
func RecordTabSessionEffort(ctx context.Context, tab *waveobj.Tab) error {
	if tabSessionEffortOID(tab) == "" {
		return nil
	}
	for _, blockId := range tab.BlockIds {
		block, err := DBGet[*waveobj.Block](ctx, blockId)
		if err != nil {
			return fmt.Errorf("loading agent block %s: %w", blockId, err)
		}
		if block != nil && block.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, "") != "" {
			return RecordBlockSessionEffort(ctx, tab, block)
		}
	}
	return nil
}

// RecordBlockSessionEffort keeps tab's initiative for the session block runs, read while the block is still there:
// a tab that closes with its last block (DeleteBlock's recursive close) is empty by the time DeleteTab reads it, and
// an agent block closed under its dock terminal leaves a tab whose blocks name no transcript.
func RecordBlockSessionEffort(ctx context.Context, tab *waveobj.Tab, block *waveobj.Block) error {
	effortOID := tabSessionEffortOID(tab)
	harness := tab.Meta.GetString(waveobj.MetaKey_SessionAgent, "")
	transcript := block.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, "")
	if effortOID == "" || harness == "" || transcript == "" {
		return nil
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		tx.Exec(`INSERT INTO db_sessioneffort (harness, transcript, effortoid, ts) VALUES (?, ?, ?, ?)
			ON CONFLICT (harness, transcript) DO UPDATE SET effortoid = excluded.effortoid, ts = excluded.ts`,
			harness, transcript, effortOID, time.Now().UnixMilli())
		return tx.Err
	})
}

// tabSessionEffortOID is the bare oid of the initiative tab is tagged with, as effortstore.BareOID gives it:
// effortstore imports wstore, so it can't be called here
func tabSessionEffortOID(tab *waveobj.Tab) string {
	return strings.TrimPrefix(tab.Meta.GetString(waveobj.MetaKey_SessionEffort, ""), waveobj.OType_Effort+":")
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
