// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	dbfs "github.com/wavetermdev/waveterm/db"
	"github.com/wavetermdev/waveterm/pkg/util/migrateutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// WithReadTxRtn returns data committed through the write handle.
func TestReadPoolReadsCommittedData(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "read-pool", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	name, err := WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		return tx.GetString("SELECT json_extract(data, '$.name') FROM db_channel WHERE oid = ?", ch.OID), nil
	})
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if name != "read-pool" {
		t.Fatalf("want name %q, got %q", "read-pool", name)
	}
}

// The read pool is opened mode=ro: a write attempted through it errors, catching a mis-audited
// "read" helper at runtime instead of letting it silently bypass the write connection.
func TestReadPoolRejectsWrites(t *testing.T) {
	ctx := context.Background()
	err := WithReadTx(ctx, func(tx *TxWrap) error {
		tx.Exec("INSERT INTO db_channel (oid, version, data) VALUES (?, ?, ?)", "ro-test", 1, "{}")
		return tx.Err
	})
	if err == nil {
		t.Fatal("expected a write through the read-only pool to error, got nil")
	}
}

// A top-level read must complete promptly while a writer holds the single write connection, instead
// of queueing behind it. Before the read helpers move to the pool this FAILS (the read blocks on the
// one write conn); after, it passes (the read uses the separate ro pool + WAL snapshot).
func TestReadsDoNotBlockBehindWriter(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "no-block", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	writeHeld := make(chan struct{})
	writeRelease := make(chan struct{})
	go func() {
		_ = WithTx(ctx, func(tx *TxWrap) error {
			close(writeHeld)
			<-writeRelease // hold the single write connection open
			return nil
		})
	}()
	<-writeHeld

	done := make(chan error, 1)
	go func() {
		_, e := DBMustGet[*waveobj.Channel](ctx, ch.OID)
		done <- e
	}()
	select {
	case e := <-done:
		close(writeRelease)
		if e != nil {
			t.Fatalf("read failed: %v", e)
		}
	case <-time.After(2 * time.Second):
		close(writeRelease)
		t.Fatal("read blocked behind the held write transaction")
	}
}

// A read that reuses an enclosing write tx (called with tx.Context()) must see that tx's uncommitted
// row — proving nested reads stay on the write connection and are NOT diverted to the ro pool (which
// could not see uncommitted data). Guards the txwrap-reuse assumption the whole phase rests on.
func TestNestedReadReusesWriteTx(t *testing.T) {
	ctx := context.Background()
	oid := uuid.NewString()
	err := WithTx(ctx, func(tx *TxWrap) error {
		ch := &waveobj.Channel{OID: oid, Name: "nested", Meta: waveobj.MetaMapType{}}
		if e := DBInsert(tx.Context(), ch); e != nil {
			return e
		}
		got, e := DBMustGet[*waveobj.Channel](tx.Context(), oid)
		if e != nil {
			return e
		}
		if got.Name != "nested" {
			t.Errorf("nested read did not see the uncommitted row (name=%q)", got.Name)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("tx failed: %v", err)
	}
}

// The A3 correctness invariant: PostChannelMessageIf's cond-check + append run in one WithTx on the
// write handle, so concurrent posters still serialize even with the read pool present. With a cond
// of "only if this ref has no message yet", read from the message rows with the transaction's context,
// exactly one of N racing posters may post. Run under -race.
func TestPostChannelMessageIfSerializesUnderRace(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "serialize", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	ref := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	var wg sync.WaitGroup
	var posted int32
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			msg := NewChannelMessage("outcome", "you", "only-one", ref, int64(n))
			ok, e := PostChannelMessageIf(ctx, ch.OID, msg, func(txCtx context.Context) (bool, error) {
				msgs, err := GetMessagesByRef(txCtx, ref)
				return len(msgs) == 0, err
			})
			if e == nil && ok {
				atomic.AddInt32(&posted, 1)
			}
		}(i)
	}
	wg.Wait()

	if posted != 1 {
		t.Fatalf("want exactly 1 successful post (serialized), got %d", posted)
	}
	got, err := GetChannelMessages(ctx, ch.OID, 0, 0)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 message persisted, got %d", len(got))
	}
}

// The read pool rests on a load-bearing STARTUP/MIGRATION ORDERING invariant that the other tests
// (all steady-state, run against the store TestMain already initialized) never exercise: readDB is a
// mode=ro handle, and a mode=ro connection cannot create the DB/WAL files — so it is usable only AFTER
// the writable handle has created and migrated the database (see wstore_dbsetup.go:32-35). That is why
// InitWStore sequences MakeDB -> Migrate -> MakeReadDB, and Phase 1 (a Go startup backfill inside
// InitWStore) is precisely the change that could reorder it. This pins the ordering with the real
// startup primitives against an isolated temp store: the identical read fails before migration and
// succeeds after. It then fans concurrent reads through the freshly opened pool (meaningful under
// -race) to prove it serves the pool the moment ordering completes.
//
// Scope: this guards the schema-ordering half of the invariant. Reads routed to a still-nil readDB
// (pool opened after any read fires) is an InitWStore call-ordering concern, not unit-testable without
// refactoring InitWStore for handle injection — out of scope for Phase 0.
func TestReadPoolStartupOrdering(t *testing.T) {
	ctx := context.Background()

	// Point the data dir at an isolated temp store for the duration. The package globals globalDB/
	// readDB (opened by TestMain against the original dir) are untouched — nothing else in this
	// package re-derives GetDBName() at call time, and these tests run sequentially.
	origDataHome := wavebase.DataHome_VarCache
	t.Cleanup(func() { wavebase.DataHome_VarCache = origDataHome })
	tempDir := t.TempDir()
	wavebase.DataHome_VarCache = tempDir
	// EnsureWaveDBDir is cache-keyed and already ran in TestMain, so create the db subdir directly;
	// MakeDB's mode=rwc creates the file but not its parent dir.
	if err := os.MkdirAll(filepath.Join(tempDir, wavebase.WaveDBDir), 0o700); err != nil {
		t.Fatalf("mkdir db dir: %v", err)
	}

	// Ordering VIOLATION: a mode=ro pool opened before the DB exists cannot serve reads.
	roBefore, err := MakeReadDB(ctx)
	if err != nil {
		t.Fatalf("open read pool: %v", err)
	}
	var n int
	if err := roBefore.Get(&n, "SELECT count(*) FROM db_channel"); err == nil {
		roBefore.Close()
		t.Fatal("read via mode=ro pool succeeded before MakeDB+Migrate ran; startup ordering not enforced")
	}
	roBefore.Close()

	// Satisfy the ordering: the writable handle creates the file, then migrations create the schema.
	// Keep the write handle open (globalDB stays open for process life) — a mode=ro connection needs
	// it to read a WAL database.
	writeDB, err := MakeDB(ctx)
	if err != nil {
		t.Fatalf("open write handle: %v", err)
	}
	defer writeDB.Close()
	if err := migrateutil.Migrate("wstore", writeDB.DB, dbfs.WStoreMigrationFS, "migrations-wstore"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// Ordering SATISFIED: the same read now succeeds through a freshly opened pool.
	roAfter, err := MakeReadDB(ctx)
	if err != nil {
		t.Fatalf("reopen read pool: %v", err)
	}
	defer roAfter.Close()
	if err := roAfter.Get(&n, "SELECT count(*) FROM db_channel"); err != nil {
		t.Fatalf("read via mode=ro pool failed after MakeDB+Migrate: %v", err)
	}

	// The pool serves concurrent readers correctly right after startup ordering completes; readers >
	// ReadDBMaxConns exercises connection reuse under contention. Meaningful under -race.
	const readers = 16
	errs := make([]error, readers)
	var wg sync.WaitGroup
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			var cnt int
			errs[idx] = roAfter.Get(&cnt, "SELECT count(*) FROM db_channel")
		}(i)
	}
	wg.Wait()
	for i, e := range errs {
		if e != nil {
			t.Fatalf("concurrent read %d through freshly opened pool failed: %v", i, e)
		}
	}
}
