// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/sawka/txwrap"
	"github.com/wavetermdev/waveterm/pkg/util/migrateutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"

	dbfs "github.com/wavetermdev/waveterm/db"
)

const WStoreDBName = "waveterm.db"

type TxWrap = txwrap.TxWrap

// WalSizeLimitBytes is what the write-ahead log file is cut back to once it has been checkpointed. A
// checkpoint runs every 4 MB of log, so this leaves room for a few of them to be held up by a reader.
const WalSizeLimitBytes = 16 << 20

var globalDB *sqlx.DB

// ReadDBMaxConns bounds the read-only pool. Reads are short SELECTs on a desktop-scale DB, so a
// small fixed pool is plenty; tune here if a reader-starvation symptom ever shows up.
const ReadDBMaxConns = 8

// readDB is a mode=ro pool serving pure top-level reads, so they do not queue behind the single
// write connection. Opened after migrations (a ro connection cannot create the DB/WAL files) and
// only usable while the writable globalDB stays open (required to read a WAL database read-only).
var readDB *sqlx.DB

func InitWStore() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	var err error
	globalDB, err = MakeDB(ctx)
	if err != nil {
		return err
	}
	err = migrateutil.Migrate("wstore", globalDB.DB, dbfs.WStoreMigrationFS, "migrations-wstore")
	if err != nil {
		return err
	}
	readDB, err = MakeReadDB(ctx)
	if err != nil {
		return err
	}
	// before anything can write a channel: the first write of a channel drops whatever its blob still embeds
	if err := ContractChannels(); err != nil {
		return err
	}
	log.Printf("wstore initialized\n")
	return nil
}

func GetDBName() string {
	waveHome := wavebase.GetWaveDataDir()
	return filepath.Join(waveHome, wavebase.WaveDBDir, WStoreDBName)
}

func MakeDB(ctx context.Context) (*sqlx.DB, error) {
	dbName := GetDBName()
	rtn, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=rwc&_journal_mode=WAL&_busy_timeout=5000", dbName))
	if err != nil {
		return nil, err
	}
	rtn.DB.SetMaxOpenConns(1)
	// sqlite reuses a restarted log but never shrinks it, so without a limit the file stays as large as the
	// biggest transaction ever written: 171 MB on a store whose live log was 4 MB. The limit is per
	// connection, and this pool keeps its one connection for the life of the process.
	if _, err := rtn.ExecContext(ctx, fmt.Sprintf("PRAGMA journal_size_limit = %d", WalSizeLimitBytes)); err != nil {
		rtn.Close()
		return nil, fmt.Errorf("limiting the write-ahead log: %w", err)
	}
	return rtn, nil
}

func MakeReadDB(ctx context.Context) (*sqlx.DB, error) {
	dbName := GetDBName()
	rtn, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000", dbName))
	if err != nil {
		return nil, err
	}
	rtn.DB.SetMaxOpenConns(ReadDBMaxConns)
	return rtn, nil
}

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) (rtnErr error) {
	waveobj.ContextUpdatesBeginTx(ctx)
	defer func() {
		if rtnErr != nil {
			waveobj.ContextUpdatesRollbackTx(ctx)
		} else {
			waveobj.ContextUpdatesCommitTx(ctx)
		}
	}()
	return txwrap.WithTx(ctx, globalDB, fn)
}

func WithTxRtn[RT any](ctx context.Context, fn func(tx *TxWrap) (RT, error)) (rtnVal RT, rtnErr error) {
	waveobj.ContextUpdatesBeginTx(ctx)
	defer func() {
		if rtnErr != nil {
			waveobj.ContextUpdatesRollbackTx(ctx)
		} else {
			waveobj.ContextUpdatesCommitTx(ctx)
		}
	}()
	return txwrap.WithTxRtn(ctx, globalDB, fn)
}

// --- Read pool ---------------------------------------------------------------------------------
//
// CORRECTNESS AUDIT (Phase 0). The single write connection only ever protected correctness where a
// read and a dependent write span what would otherwise be two connections. Every such site does its
// read AND its write inside ONE WithTx on the write handle, so the read pool cannot regress it:
//
//   - PostChannelMessageIf (wstore_channel.go)  cond-check + insert in one WithTx        -> safe
//   - DBUpdateFn / DBUpdateFnErr (wstore_dbops.go)  DBMustGet + DBUpdate in one WithTx    -> safe
//   - run-state transitions (wshserver_runs.go)  read + mutate in one nested WithTx       -> safe
//
// KNOWN, NOT FIXED HERE: the double-spawn guard (check len(WorkerOrefs) in one call, persist in a
// later call — see docs/deferred.md) is a pre-existing cross-transaction TOCTOU. The single
// connection only narrowed its window; it never closed it. The read pool may widen the window. The
// real fix (fold spawn+attach into one write tx) is a separate open item, out of scope for Phase 0.

// WithReadTx runs fn against the read-only pool. Pure reads only; a write errors (mode=ro). If ctx
// already carries a TxWrap (a read nested inside a write), txwrap reuses that transaction and this
// pool is bypassed — nested reads stay on the write connection and see its uncommitted state.
func WithReadTx(ctx context.Context, fn func(tx *TxWrap) error) (rtnErr error) {
	waveobj.ContextUpdatesBeginTx(ctx)
	defer func() {
		if rtnErr != nil {
			waveobj.ContextUpdatesRollbackTx(ctx)
		} else {
			waveobj.ContextUpdatesCommitTx(ctx)
		}
	}()
	return txwrap.WithTx(ctx, readDB, fn)
}

func WithReadTxRtn[RT any](ctx context.Context, fn func(tx *TxWrap) (RT, error)) (rtnVal RT, rtnErr error) {
	waveobj.ContextUpdatesBeginTx(ctx)
	defer func() {
		if rtnErr != nil {
			waveobj.ContextUpdatesRollbackTx(ctx)
		} else {
			waveobj.ContextUpdatesCommitTx(ctx)
		}
	}()
	return txwrap.WithTxRtn(ctx, readDB, fn)
}
