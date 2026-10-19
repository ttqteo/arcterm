// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestReadNegativeOffset(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	if _, _, err := WFS.ReadAt(ctx, zoneId, "f", -1, 5); err == nil {
		t.Fatalf("expected error for negative offset")
	}
}

func TestReadNonExistentFile(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	_, _, err := WFS.ReadFile(ctx, zoneId, "nope")
	if err == nil || !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("expected ErrNotExist, got %v", err)
	}
}

func TestReadPastEOF(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	if err := WFS.WriteFile(ctx, zoneId, "f", []byte("hello")); err != nil {
		t.Fatalf("write: %v", err)
	}
	off, data, err := WFS.ReadAt(ctx, zoneId, "f", 0, 100)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if off != 0 || string(data) != "hello" {
		t.Fatalf("expected clamped read \"hello\" at 0, got %q at %d", string(data), off)
	}
}

func TestReadPastEOFFromOffset(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	if err := WFS.WriteFile(ctx, zoneId, "f", []byte("hello")); err != nil {
		t.Fatalf("write: %v", err)
	}
	off, data, err := WFS.ReadAt(ctx, zoneId, "f", 2, 100)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if off != 2 || string(data) != "llo" {
		t.Fatalf("expected clamped read \"llo\" at 2, got %q at %d", string(data), off)
	}
}

func TestReadZeroBytes(t *testing.T) {
	// covers loadDataPartsForRead early-return on an empty part list
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	if err := WFS.WriteFile(ctx, zoneId, "f", []byte("hello")); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, data, err := WFS.ReadAt(ctx, zoneId, "f", 0, 0)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("expected empty read, got %q", string(data))
	}
}

func TestCircularReadBeforeData(t *testing.T) {
	// covers readAt's circular branch where the requested range is entirely
	// before the surviving window (size <= 0 after truncation)
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "c", nil, wshrpc.FileOpts{Circular: true, MaxSize: 50}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	// 55 bytes into a 50-byte circular window: DataStartIdx == 5
	if err := WFS.WriteFile(ctx, zoneId, "c", []byte(makeText(55))); err != nil {
		t.Fatalf("write: %v", err)
	}
	off, data, err := WFS.ReadAt(ctx, zoneId, "c", 0, 3)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if off != 5 || len(data) != 0 {
		t.Fatalf("expected empty read at adjusted offset 5, got %q at %d", string(data), off)
	}
}

func TestCircularReadStraddlingWindowStart(t *testing.T) {
	// a read that starts before the surviving window loses only the part before it
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "c", nil, wshrpc.FileOpts{Circular: true, MaxSize: 50}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	text := makeText(55)
	if err := WFS.WriteFile(ctx, zoneId, "c", []byte(text)); err != nil {
		t.Fatalf("write: %v", err)
	}
	off, data, err := WFS.ReadAt(ctx, zoneId, "c", 2, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if off != 5 || string(data) != text[5:12] {
		t.Fatalf("expected %q at 5, got %q at %d", text[5:12], string(data), off)
	}
	// a read that ends exactly where the window starts returns no data at all, not an empty slice
	off, data, err = WFS.ReadAt(ctx, zoneId, "c", 0, 5)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if off != 5 || data != nil {
		t.Fatalf("expected nil data at 5, got %#v at %d", data, off)
	}
}

func TestCircularWriteAtFrontTruncate(t *testing.T) {
	// covers writeAt's circular branch: a write straddling the start of the
	// surviving window keeps only its tail (front truncated, offset advanced)
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "c", nil, wshrpc.FileOpts{Circular: true, MaxSize: 50}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	if err := WFS.WriteFile(ctx, zoneId, "c", []byte(makeText(55))); err != nil {
		t.Fatalf("write: %v", err)
	}
	// window starts at offset 5; writing "ABCDEF" at offset 2 truncates the
	// first 3 bytes, leaving "DEF" written at offsets 5..8
	if err := WFS.WriteAt(ctx, zoneId, "c", 2, []byte("ABCDEF")); err != nil {
		t.Fatalf("writeat: %v", err)
	}
	checkFileDataAt(t, ctx, zoneId, "c", 5, "DEF")
}

func TestFlushToDeletedFile(t *testing.T) {
	// covers dbWriteCacheEntry's not-exist guard and flushToDB's error
	// accumulation + clear-after-3 behavior
	initDb(t)
	defer cleanupDb(t)
	// this test intentionally provokes flush errors; reset the counter first
	// (LIFO: this defer runs before cleanupDb's flushErrorCount assertion)
	defer flushErrorCount.Store(0)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	// dirty the cache without flushing, then delete the DB row out from under it
	if err := WFS.AppendData(ctx, zoneId, "f", []byte("hello")); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := dbDeleteFile(ctx, zoneId, "f"); err != nil {
		t.Fatalf("db delete: %v", err)
	}
	// first three flushes fail but keep the entry cached
	for i := 1; i <= 3; i++ {
		if _, err := WFS.FlushCache(ctx); err == nil {
			t.Fatalf("flush %d: expected error", i)
		}
		if WFS.getCacheSize() != 1 {
			t.Fatalf("flush %d: expected entry to remain cached, size %d", i, WFS.getCacheSize())
		}
	}
	// fourth flush trips the >3 threshold and clears the entry
	if _, err := WFS.FlushCache(ctx); err == nil {
		t.Fatalf("flush 4: expected error")
	}
	if WFS.getCacheSize() != 0 {
		t.Fatalf("flush 4: expected entry cleared, size %d", WFS.getCacheSize())
	}
}

func TestFlushTransientContextError(t *testing.T) {
	// covers flushToDB's transient-error path (ctx already cancelled at flush)
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	if err := WFS.AppendData(ctx, zoneId, "f", []byte("hello")); err != nil {
		t.Fatalf("append: %v", err)
	}
	cctx, ccancel := context.WithCancel(context.Background())
	ccancel() // cancel before flushing
	if _, err := WFS.FlushCache(cctx); err == nil {
		t.Fatalf("expected context error")
	}
}

func TestFlushNilFileNoOp(t *testing.T) {
	// covers flushToDB's early-return when the entry holds no dirty file
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	entry := WFS.getEntryAndPin("z", "f")
	defer WFS.unpinEntryAndTryDelete("z", "f")
	if err := entry.flushToDB(ctx, false); err != nil {
		t.Fatalf("expected nil for empty entry, got %v", err)
	}
}

func TestUnpinMissingEntry(t *testing.T) {
	// covers unpinEntryAndTryDelete's nil-entry guard
	initDb(t)
	defer cleanupDb(t)
	WFS.unpinEntryAndTryDelete("z", "missing")
	if WFS.getCacheSize() != 0 {
		t.Fatalf("expected empty cache, size %d", WFS.getCacheSize())
	}
}

func TestDuplicateCreate(t *testing.T) {
	// covers dbInsertFile's ErrExist guard: with no intervening read the cache
	// entry is empty, so the second MakeFile reaches dbInsertFile and it reports
	// the existing row
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	if err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{}); err != nil {
		t.Fatalf("make file: %v", err)
	}
	err := WFS.MakeFile(ctx, zoneId, "f", nil, wshrpc.FileOpts{})
	if err == nil || !errors.Is(err, fs.ErrExist) {
		t.Fatalf("expected ErrExist, got %v", err)
	}
}

func TestGetFilePartsEmpty(t *testing.T) {
	// covers dbGetFileParts' empty-part-list guard
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	parts, err := dbGetFileParts(ctx, "z", "f", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if parts != nil {
		t.Fatalf("expected nil map, got %v", parts)
	}
}

func TestGetDBName(t *testing.T) {
	// smoke: GetDBName builds a path ending in the filestore db filename
	name := GetDBName()
	if name == "" {
		t.Fatalf("expected non-empty db name")
	}
	if filepath.Base(name) != FilestoreDBName {
		t.Fatalf("expected base %q, got %q", FilestoreDBName, filepath.Base(name))
	}
}
