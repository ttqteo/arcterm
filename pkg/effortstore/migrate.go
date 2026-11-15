// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package effortstore

import (
	"context"
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// MigrateFromDB moves every db_effort row into the vault and deletes the row, returning how many
// files it wrote. A file already in the vault wins (it may have been pulled from another machine);
// its row is still deleted. Idempotent: an empty table migrates nothing.
func MigrateFromDB(ctx context.Context) (int, error) {
	rows, err := wstore.DBGetAllObjsByType[*waveobj.Effort](ctx, waveobj.OType_Effort)
	if err != nil {
		return 0, fmt.Errorf("read db efforts: %w", err)
	}
	root := vaultRoot()
	migrated := 0
	for _, e := range rows {
		wrote, err := migrateOne(root, e)
		if err != nil {
			return migrated, err
		}
		if wrote {
			migrated++
		}
		if err := wstore.DBDelete(ctx, waveobj.OType_Effort, e.OID); err != nil {
			return migrated, fmt.Errorf("delete migrated db effort %s: %w", e.OID, err)
		}
	}
	return migrated, nil
}

func migrateOne(root string, e *waveobj.Effort) (bool, error) {
	path, err := effortPath(root, e.OID)
	if err != nil {
		return false, err
	}
	unlock := lockPath(path)
	defer unlock()
	unlockRoot := wavevault.LockRoot(root)
	defer unlockRoot()
	if _, err := os.Stat(path); err == nil {
		return false, nil
	}
	if err := write(path, e); err != nil {
		return false, err
	}
	return true, nil
}
