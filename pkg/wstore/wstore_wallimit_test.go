// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"os"
	"testing"
)

// one large transaction must not leave the log file at its size for good
func TestWriteAheadLogIsCutBackAfterALargeTransaction(t *testing.T) {
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		err := WithTx(ctx, func(tx *TxWrap) error {
			tx.Exec(query, args...)
			return tx.Err
		})
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`CREATE TABLE IF NOT EXISTS wal_limit_test (data blob)`)
	defer exec(`DROP TABLE wal_limit_test`)
	exec(`INSERT INTO wal_limit_test (data) VALUES (zeroblob(?))`, 2*WalSizeLimitBytes)
	// the commit above checkpointed the log; the next write restarts it, and its commit applies the limit
	exec(`DELETE FROM wal_limit_test`)

	info, err := os.Stat(GetDBName() + "-wal")
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() > WalSizeLimitBytes {
		t.Fatalf("log is %d bytes after a checkpoint, want at most %d", info.Size(), WalSizeLimitBytes)
	}
}
