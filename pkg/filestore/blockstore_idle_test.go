// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

import (
	"context"
	"errors"
	"io/fs"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestDeleteIdleFiles(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	const main, side, other = "term", "cache", "env"
	makeZone := func() string {
		t.Helper()
		zoneId := uuid.NewString()
		for _, name := range []string{main, side, other} {
			if err := WFS.MakeFile(ctx, zoneId, name, nil, wshrpc.FileOpts{}); err != nil {
				t.Fatalf("making %s: %v", name, err)
			}
			if err := WFS.WriteFile(ctx, zoneId, name, []byte("output")); err != nil {
				t.Fatalf("writing %s: %v", name, err)
			}
		}
		return zoneId
	}
	idle, recent, claimed, rewritten := makeZone(), makeZone(), makeZone(), makeZone()
	if _, err := WFS.FlushCache(ctx); err != nil {
		t.Fatal(err)
	}
	WFS.clearCache()
	cutoff := time.Now().Add(-time.Hour)
	err := WithTx(ctx, func(tx *TxWrap) error {
		tx.Exec(`UPDATE db_wave_file SET modts = ? WHERE zoneid IN (?, ?, ?)`, cutoff.Add(-time.Hour).UnixMilli(), idle, claimed, rewritten)
		return tx.Err
	})
	if err != nil {
		t.Fatal(err)
	}
	// written again, and the write has not reached the store yet
	if err := WFS.AppendData(ctx, rewritten, main, []byte("more")); err != nil {
		t.Fatal(err)
	}

	cleared, err := WFS.DeleteIdleFiles(ctx, main, []string{side}, cutoff, func(zoneId string) bool { return zoneId == claimed })
	if err != nil {
		t.Fatal(err)
	}
	if cleared != 1 {
		t.Fatalf("cleared %d zones, want 1", cleared)
	}
	has := func(zoneId string, name string) bool {
		t.Helper()
		_, err := WFS.Stat(ctx, zoneId, name)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			t.Fatal(err)
		}
		return err == nil
	}
	if has(idle, main) || has(idle, side) {
		t.Fatal("an idle zone kept its output")
	}
	if !has(idle, other) {
		t.Fatal("an idle zone lost a file that was not named")
	}
	for name, zoneId := range map[string]string{"recent": recent, "claimed": claimed, "rewritten": rewritten} {
		if !has(zoneId, main) || !has(zoneId, side) {
			t.Fatalf("the %s zone lost its output", name)
		}
	}
	if _, data, err := WFS.ReadFile(ctx, rewritten, main); err != nil || string(data) != "outputmore" {
		t.Fatalf("rewritten zone reads %q, %v", data, err)
	}
}
