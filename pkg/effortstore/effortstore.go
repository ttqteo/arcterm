// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package effortstore keeps efforts as <vault>/efforts/<oid>.json files, so the vault's git sync
// carries them between machines. Only wavesrv writes them (wsh goes through RPC), so in-process locks
// suffice.
package effortstore

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	effortExt     = ".json"
	defaultStatus = "active"
)

type cacheEntry struct {
	modTime time.Time
	size    int64
	effort  *waveobj.Effort // never handed out; callers get a clone
}

var (
	stateMu      sync.Mutex // guards rootOverride and cache
	rootOverride string
	cache        = map[string]cacheEntry{} // keyed by file path

	pathLocksMu sync.Mutex
	pathLocks   = map[string]*sync.Mutex{}
)

// UseRootForTest points the store at a temp vault root and returns the restore func.
func UseRootForTest(root string) (restore func()) {
	stateMu.Lock()
	prev := rootOverride
	rootOverride = root
	clear(cache)
	stateMu.Unlock()
	return func() {
		stateMu.Lock()
		rootOverride = prev
		clear(cache)
		stateMu.Unlock()
	}
}

func vaultRoot() string {
	stateMu.Lock()
	override := rootOverride
	stateMu.Unlock()
	if override != "" {
		return override
	}
	return memroots.VaultRoot()
}

// BareOID strips the oref prefix from an effort id. Ids arrive in the oref form too, since that is what
// `wsh effort list` prints, but they are stored and compared bare.
func BareOID(oid string) string {
	return strings.TrimPrefix(oid, waveobj.OType_Effort+":")
}

// effortPath rejects an oid that would name a file outside efforts/ (oids arrive over RPC). It takes the
// oref form too.
func effortPath(root, oid string) (string, error) {
	oid = BareOID(oid)
	if oid == "" || oid == "." || oid == ".." || strings.ContainsAny(oid, `/\:`) {
		return "", fmt.Errorf("invalid effort oid %q", oid)
	}
	return filepath.Join(root, wavevault.EffortsDir, oid+effortExt), nil
}

// lockPath serializes reads and writes of one effort file: a write is read-modify-rename, and on
// Windows a rename over a file another handle has open fails. Not reentrant: an Update fn must not
// call back into the store for the same oid.
func lockPath(path string) (unlock func()) {
	pathLocksMu.Lock()
	m, ok := pathLocks[path]
	if !ok {
		m = &sync.Mutex{}
		pathLocks[path] = m
	}
	pathLocksMu.Unlock()
	m.Lock()
	return m.Unlock
}

func notFound(oid string) error {
	return fmt.Errorf("effort %s: %w", oid, wstore.ErrNotFound)
}

// load returns the cached effort for path, re-parsing only when the file's mtime or size changed.
// Callers hold the path lock and must clone the result before handing it out.
func load(path, oid string) (*waveobj.Effort, error) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		dropCache(path)
		return nil, notFound(oid)
	}
	if err != nil {
		return nil, fmt.Errorf("effort file %s: %w", path, err)
	}
	stateMu.Lock()
	entry, ok := cache[path]
	stateMu.Unlock()
	if ok && entry.modTime.Equal(info.ModTime()) && entry.size == info.Size() {
		return entry.effort, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("effort file %s: %w", path, err)
	}
	e, err := wavevault.ParseEffort(b)
	if err != nil {
		return nil, fmt.Errorf("effort file %s: %w", path, err)
	}
	stateMu.Lock()
	cache[path] = cacheEntry{modTime: info.ModTime(), size: info.Size(), effort: e}
	stateMu.Unlock()
	return e, nil
}

func dropCache(path string) {
	stateMu.Lock()
	delete(cache, path)
	stateMu.Unlock()
}

// write replaces path with e atomically (temp file + rename) under the vault lock, so it never
// interleaves with a sync, then caches e and pokes the sync loop. Callers hold the path lock.
func write(root, path string, e *waveobj.Effort) error {
	b, err := wavevault.MarshalEffort(e)
	if err != nil {
		return err
	}
	unlock := wavevault.LockRoot(root)
	defer unlock()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, "."+e.OID+"-*.tmp")
	if err != nil {
		return fmt.Errorf("write effort %s: %w", e.OID, err)
	}
	_, werr := tmp.Write(b)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		os.Remove(tmp.Name())
		return fmt.Errorf("write effort %s: %w", e.OID, err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		return fmt.Errorf("write effort %s: %w", e.OID, err)
	}
	if info, err := os.Stat(path); err == nil {
		stateMu.Lock()
		cache[path] = cacheEntry{modTime: info.ModTime(), size: info.Size(), effort: e}
		stateMu.Unlock()
	} else {
		dropCache(path)
	}
	wavevault.Poke()
	return nil
}

func Create(ctx context.Context, e *waveobj.Effort) error {
	if e.OID == "" {
		e.OID = uuid.NewString()
	}
	if e.Status == "" {
		e.Status = defaultStatus
	}
	e.Version = 1
	now := time.Now().UnixMilli()
	e.CreatedTs = now
	e.UpdatedTs = now
	root := vaultRoot()
	path, err := effortPath(root, e.OID)
	if err != nil {
		return err
	}
	unlock := lockPath(path)
	defer unlock()
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("effort %s already exists", e.OID)
	}
	return write(root, path, clone(e))
}

func Get(ctx context.Context, oid string) (*waveobj.Effort, error) {
	path, err := effortPath(vaultRoot(), oid)
	if err != nil {
		return nil, err
	}
	unlock := lockPath(path)
	defer unlock()
	e, err := load(path, oid)
	if err != nil {
		return nil, err
	}
	return clone(e), nil
}

// GetAll returns every readable effort, newest-updated first. A malformed file is logged and skipped.
func GetAll(ctx context.Context) ([]*waveobj.Effort, error) {
	dir := filepath.Join(vaultRoot(), wavevault.EffortsDir)
	paths, err := filepath.Glob(filepath.Join(dir, "*"+effortExt))
	if err != nil {
		return nil, fmt.Errorf("list efforts in %s: %w", dir, err)
	}
	pruneCache(dir, paths)
	all := make([]*waveobj.Effort, 0, len(paths))
	for _, path := range paths {
		oid := strings.TrimSuffix(filepath.Base(path), effortExt)
		unlock := lockPath(path)
		e, err := load(path, oid)
		if err == nil {
			e = clone(e)
		}
		unlock()
		if errors.Is(err, wstore.ErrNotFound) {
			continue // removed since the listing
		}
		if err != nil {
			log.Printf("effortstore: skipping %v", err)
			continue
		}
		all = append(all, e)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].UpdatedTs > all[j].UpdatedTs })
	return all, nil
}

// pruneCache drops entries for files in dir that no longer exist (removed by a pull or by hand).
func pruneCache(dir string, paths []string) {
	stateMu.Lock()
	defer stateMu.Unlock()
	for path := range cache {
		if filepath.Dir(path) == dir && !slices.Contains(paths, path) {
			delete(cache, path)
		}
	}
}

// Update applies fn to the stored effort and writes the result; an error from fn leaves the file
// untouched.
func Update(ctx context.Context, oid string, fn func(*waveobj.Effort) error) error {
	root := vaultRoot()
	path, err := effortPath(root, oid)
	if err != nil {
		return err
	}
	unlock := lockPath(path)
	defer unlock()
	cur, err := load(path, oid)
	if err != nil {
		return err
	}
	e := clone(cur)
	if err := fn(e); err != nil {
		return err
	}
	e.Version++
	e.UpdatedTs = time.Now().UnixMilli()
	return write(root, path, e)
}

// Delete removes the effort's file. A missing effort is not an error, as with wstore.DBDelete.
func Delete(ctx context.Context, oid string) error {
	root := vaultRoot()
	path, err := effortPath(root, oid)
	if err != nil {
		return err
	}
	unlock := lockPath(path)
	defer unlock()
	unlockRoot := wavevault.LockRoot(root)
	defer unlockRoot()
	dropCache(path)
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("delete effort %s: %w", oid, err)
	}
	wavevault.Poke()
	return nil
}

// clone deep-copies e so a caller's mutation never reaches the cache.
func clone(e *waveobj.Effort) *waveobj.Effort {
	c := *e
	c.Chunks = slices.Clone(e.Chunks)
	for i := range c.Chunks {
		c.Chunks[i].WorkRefs = slices.Clone(c.Chunks[i].WorkRefs)
		c.Chunks[i].Notes = slices.Clone(c.Chunks[i].Notes)
	}
	c.Notes = slices.Clone(e.Notes)
	c.Events = slices.Clone(e.Events)
	if e.Meta != nil {
		c.Meta = cloneJSON(map[string]any(e.Meta)).(map[string]any)
	}
	return &c
}

// cloneJSON deep-copies a decoded JSON value (meta holds arbitrary nested maps and arrays).
func cloneJSON(v any) any {
	switch t := v.(type) {
	case map[string]any:
		c := make(map[string]any, len(t))
		for k, x := range t {
			c[k] = cloneJSON(x)
		}
		return c
	case waveobj.MetaMapType:
		return waveobj.MetaMapType(cloneJSON(map[string]any(t)).(map[string]any))
	case []any:
		c := make([]any, len(t))
		for i, x := range t {
			c[i] = cloneJSON(x)
		}
		return c
	default:
		return v
	}
}
