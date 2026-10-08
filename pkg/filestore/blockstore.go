// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

// the blockstore package implements a write cache for wave files
// it is not a read cache (reads still go to the DB -- unless items are in the cache)
// but all writes only go to the cache, and then the cache is periodically flushed to the DB

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const DefaultPartDataSize = 64 * 1024
const DefaultFlushTime = 5 * time.Second
const NoPartIdx = -1

// for unit tests
var warningCount = &atomic.Int32{}
var flushErrorCount = &atomic.Int32{}

var partDataSize int64 = DefaultPartDataSize // overridden in tests
var stopFlush = &atomic.Bool{}

var WFS *FileStore = &FileStore{
	Lock:  &sync.Mutex{},
	Cache: make(map[cacheKey]*CacheEntry),
}

type WaveFile struct {
	// these fields are static (not updated)
	ZoneId    string          `json:"zoneid"`
	Name      string          `json:"name"`
	Opts      wshrpc.FileOpts `json:"opts"`
	CreatedTs int64           `json:"createdts"`

	//  these fields are mutable
	Size  int64           `json:"size"`
	ModTs int64           `json:"modts"`
	Meta  wshrpc.FileMeta `json:"meta"` // only top-level keys can be updated (lower levels are immutable)
}

// for regular files this is just Size
// for circular files this is min(Size, MaxSize)
func (f WaveFile) DataLength() int64 {
	if f.Opts.Circular {
		return minInt64(f.Size, f.Opts.MaxSize)
	}
	return f.Size
}

// for regular files this is just 0
// for circular files this is the index of the first byte of data we have
func (f WaveFile) DataStartIdx() int64 {
	if f.Opts.Circular && f.Size > f.Opts.MaxSize {
		return f.Size - f.Opts.MaxSize
	}
	return 0
}

// this works because lower levels are immutable
func copyMeta(meta wshrpc.FileMeta) wshrpc.FileMeta {
	newMeta := make(wshrpc.FileMeta)
	for k, v := range meta {
		newMeta[k] = v
	}
	return newMeta
}

func (f *WaveFile) DeepCopy() *WaveFile {
	if f == nil {
		return nil
	}
	newFile := *f
	newFile.Meta = copyMeta(f.Meta)
	return &newFile
}

func (WaveFile) UseDBMap() {}

type FileData struct {
	ZoneId  string `json:"zoneid"`
	Name    string `json:"name"`
	PartIdx int    `json:"partidx"`
	Data    []byte `json:"data"`
}

// synchronous (does not interact with the cache)
func (s *FileStore) MakeFile(ctx context.Context, zoneId string, name string, meta wshrpc.FileMeta, opts wshrpc.FileOpts) error {
	if opts.MaxSize < 0 {
		return fmt.Errorf("max size must be non-negative")
	}
	if opts.Circular && opts.MaxSize <= 0 {
		return fmt.Errorf("circular file must have a max size")
	}
	if opts.Circular {
		if opts.MaxSize%partDataSize != 0 {
			opts.MaxSize = (opts.MaxSize/partDataSize + 1) * partDataSize
		}
	}
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		if entry.File != nil {
			return fs.ErrExist
		}
		now := time.Now().UnixMilli()
		file := &WaveFile{
			ZoneId:    zoneId,
			Name:      name,
			Size:      0,
			CreatedTs: now,
			ModTs:     now,
			Opts:      opts,
			Meta:      meta,
		}
		return dbInsertFile(ctx, file)
	})
}

func (s *FileStore) DeleteFile(ctx context.Context, zoneId string, name string) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := dbDeleteFile(ctx, zoneId, name)
		if err != nil {
			return fmt.Errorf("error deleting file: %v", err)
		}
		entry.clear()
		return nil
	})
}

func (s *FileStore) DeleteZone(ctx context.Context, zoneId string) error {
	fileNames, err := dbGetZoneFileNames(ctx, zoneId)
	if err != nil {
		return fmt.Errorf("error getting zone files: %v", err)
	}
	for _, name := range fileNames {
		s.DeleteFile(ctx, zoneId, name)
	}
	return nil
}

// DeleteIdleFiles deletes the name file, and the others files beside it, in every zone where the name file was
// last written before the cutoff and keep does not claim the zone. It returns how many zones it cleared.
func (s *FileStore) DeleteIdleFiles(ctx context.Context, name string, others []string, cutoff time.Time, keep func(zoneId string) bool) (int, error) {
	zoneIds, err := dbGetIdleZones(ctx, name, cutoff.UnixMilli())
	if err != nil {
		return 0, fmt.Errorf("error listing idle files: %w", err)
	}
	cleared := 0
	for _, zoneId := range zoneIds {
		if keep(zoneId) {
			continue
		}
		deleted := false
		err := withLock(s, zoneId, name, func(entry *CacheEntry) error {
			// the stored time lags a write that is still in the cache, so the entry decides
			file, err := entry.loadFileForRead(ctx)
			if err != nil || file.ModTs >= cutoff.UnixMilli() {
				return nil
			}
			if err := dbDeleteFile(ctx, zoneId, name); err != nil {
				return err
			}
			entry.clear()
			deleted = true
			return nil
		})
		if err != nil {
			return cleared, fmt.Errorf("error deleting file: %w", err)
		}
		if !deleted {
			continue
		}
		for _, other := range others {
			if err := s.DeleteFile(ctx, zoneId, other); err != nil {
				return cleared, err
			}
		}
		cleared++
	}
	return cleared, nil
}

// if file doesn't exsit, returns fs.ErrNotExist
func (s *FileStore) Stat(ctx context.Context, zoneId string, name string) (*WaveFile, error) {
	return withLockRtn(s, zoneId, name, func(entry *CacheEntry) (*WaveFile, error) {
		file, err := entry.loadFileForRead(ctx)
		if err != nil {
			if err == fs.ErrNotExist {
				return nil, err
			}
			return nil, fmt.Errorf("error getting file: %v", err)
		}
		return file.DeepCopy(), nil
	})
}

func (s *FileStore) WriteMeta(ctx context.Context, zoneId string, name string, meta wshrpc.FileMeta, merge bool) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		if merge {
			for k, v := range meta {
				if v == nil {
					delete(entry.File.Meta, k)
					continue
				}
				entry.File.Meta[k] = v
			}
		} else {
			entry.File.Meta = meta
		}
		entry.File.ModTs = time.Now().UnixMilli()
		return nil
	})
}

func (s *FileStore) WriteFile(ctx context.Context, zoneId string, name string, data []byte) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		entry.writeAt(0, data, true)
		// since WriteFile can *truncate* the file, we need to flush the file to the DB immediately
		return entry.flushToDB(ctx, true)
	})
}

func (s *FileStore) WriteAt(ctx context.Context, zoneId string, name string, offset int64, data []byte) error {
	if offset < 0 {
		return fmt.Errorf("offset must be non-negative")
	}
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		file := entry.File
		if offset > file.Size {
			return fmt.Errorf("offset is past the end of the file")
		}
		partMap := file.computePartMap(offset, int64(len(data)))
		incompleteParts := incompletePartsFromMap(partMap)
		err = entry.loadDataPartsIntoCache(ctx, incompleteParts)
		if err != nil {
			return err
		}
		entry.writeAt(offset, data, false)
		return nil
	})
}

func (s *FileStore) AppendData(ctx context.Context, zoneId string, name string, data []byte) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		partMap := entry.File.computePartMap(entry.File.Size, int64(len(data)))
		incompleteParts := incompletePartsFromMap(partMap)
		if len(incompleteParts) > 0 {
			err = entry.loadDataPartsIntoCache(ctx, incompleteParts)
			if err != nil {
				return err
			}
		}
		entry.writeAt(entry.File.Size, data, false)
		return nil
	})
}

// returns (offset, data, error)
// we return the offset because the offset may have been adjusted if the size was too big (for circular files)
func (s *FileStore) ReadAt(ctx context.Context, zoneId string, name string, offset int64, size int64) (rtnOffset int64, rtnData []byte, rtnErr error) {
	if size < 0 || size > math.MaxInt {
		return 0, nil, fmt.Errorf("size must be non-negative and less than MaxInt")
	}
	withLock(s, zoneId, name, func(entry *CacheEntry) error {
		rtnOffset, rtnData, rtnErr = entry.readAt(ctx, offset, size, false)
		return nil
	})
	return
}

// returns (offset, data, error)
func (s *FileStore) ReadFile(ctx context.Context, zoneId string, name string) (rtnOffset int64, rtnData []byte, rtnErr error) {
	withLock(s, zoneId, name, func(entry *CacheEntry) error {
		rtnOffset, rtnData, rtnErr = entry.readAt(ctx, 0, 0, true)
		return nil
	})
	return
}

type FlushStats struct {
	FlushDuration   time.Duration
	NumDirtyEntries int
	NumCommitted    int
}

func (s *FileStore) FlushCache(ctx context.Context) (stats FlushStats, rtnErr error) {
	wasFlushing := s.setUnlessFlushing()
	if wasFlushing {
		return stats, fmt.Errorf("flush already in progress")
	}
	defer s.setIsFlushing(false)
	startTime := time.Now()
	defer func() {
		stats.FlushDuration = time.Since(startTime)
	}()

	// get a copy of dirty keys so we can iterate without the lock
	dirtyCacheKeys := s.getDirtyCacheKeys()
	stats.NumDirtyEntries = len(dirtyCacheKeys)
	for _, key := range dirtyCacheKeys {
		err := withLock(s, key.ZoneId, key.Name, func(entry *CacheEntry) error {
			return entry.flushToDB(ctx, false)
		})
		if ctx.Err() != nil {
			// transient error (also must stop the loop)
			return stats, ctx.Err()
		}
		if err != nil {
			return stats, fmt.Errorf("error flushing cache entry[%v]: %v", key, err)
		}
		stats.NumCommitted++
	}
	return stats, nil
}

///////////////////////////////////

func (f *WaveFile) partIdxAtOffset(offset int64) int {
	partIdx := int(offset / partDataSize)
	if f.Opts.Circular {
		maxPart := int(f.Opts.MaxSize / partDataSize)
		partIdx = partIdx % maxPart
	}
	return partIdx
}

func incompletePartsFromMap(partMap map[int]int) []int {
	var incompleteParts []int
	for partIdx, size := range partMap {
		if size != int(partDataSize) {
			incompleteParts = append(incompleteParts, partIdx)
		}
	}
	return incompleteParts
}

func getPartIdxsFromMap(partMap map[int]int) []int {
	var partIdxs []int
	for partIdx := range partMap {
		partIdxs = append(partIdxs, partIdx)
	}
	return partIdxs
}

// returns a map of partIdx to amount of data to write to that part
func (file *WaveFile) computePartMap(startOffset int64, size int64) map[int]int {
	partMap := make(map[int]int)
	endOffset := startOffset + size
	startFileOffset := startOffset - (startOffset % partDataSize)
	for testOffset := startFileOffset; testOffset < endOffset; testOffset += partDataSize {
		partIdx := file.partIdxAtOffset(testOffset)
		partStartOffset := testOffset
		partEndOffset := testOffset + partDataSize
		partWriteStartOffset := 0
		partWriteEndOffset := int(partDataSize)
		if startOffset > partStartOffset && startOffset < partEndOffset {
			partWriteStartOffset = int(startOffset - partStartOffset)
		}
		if endOffset > partStartOffset && endOffset < partEndOffset {
			partWriteEndOffset = int(endOffset - partStartOffset)
		}
		partMap[partIdx] = partWriteEndOffset - partWriteStartOffset
	}
	return partMap
}

func (s *FileStore) getDirtyCacheKeys() []cacheKey {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	var dirtyCacheKeys []cacheKey
	for key, entry := range s.Cache {
		if entry.File != nil {
			dirtyCacheKeys = append(dirtyCacheKeys, key)
		}
	}
	return dirtyCacheKeys
}

func (s *FileStore) setIsFlushing(flushing bool) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	s.IsFlushing = flushing
}

// returns old value of IsFlushing
func (s *FileStore) setUnlessFlushing() bool {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	if s.IsFlushing {
		return true
	}
	s.IsFlushing = true
	return false
}

func (s *FileStore) runFlushWithNewContext() (FlushStats, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultFlushTime)
	defer cancelFn()
	return s.FlushCache(ctx)
}

func (s *FileStore) runFlusher() {
	defer func() {
		panichandler.PanicHandler("filestore flusher", recover())
	}()
	for {
		stats, err := s.runFlushWithNewContext()
		if err != nil || stats.NumDirtyEntries > 0 {
			log.Printf("filestore flush: %d/%d entries flushed, err:%v\n", stats.NumCommitted, stats.NumDirtyEntries, err)
		}
		if stopFlush.Load() {
			log.Printf("filestore flusher stopping\n")
			return
		}
		time.Sleep(DefaultFlushTime)
	}
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
