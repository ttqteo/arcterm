// pkg/gitinfo/listcache.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitinfo

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

// The last git listing of each folder, kept so a file tree opened again shows at once while ListFiles walks: in memory
// for this launch, and one JSON file per folder in dir for the next. A kept listing is only ever a stand-in until the
// fresh one lands, so a lost or unreadable file costs the wait, nothing more.

var (
	keptMu    sync.Mutex
	keptLists = map[string]*FileList{}
)

func keptFile(dir, cwd string) string {
	sum := sha256.Sum256([]byte(cwd))
	return filepath.Join(dir, hex.EncodeToString(sum[:8])+".json")
}

type keptListing struct {
	Cwd  string    `json:"cwd"` // checked on read: two folders whose names hash alike must not swap trees
	List *FileList `json:"list"`
}

// KeepListing stores fl as cwd's last listing. The disk copy is written in the background, and only when the listing
// changed since the one kept, so a refresh that finds the same files writes nothing.
func KeepListing(dir, cwd string, fl *FileList) {
	keptMu.Lock()
	prev := keptLists[cwd]
	keptLists[cwd] = fl
	keptMu.Unlock()
	if prev != nil && prev.Truncated == fl.Truncated && slices.Equal(prev.Paths, fl.Paths) && slices.Equal(prev.Ignored, fl.Ignored) {
		return
	}
	go func() {
		data, err := json.Marshal(keptListing{Cwd: cwd, List: fl})
		if err == nil {
			err = os.MkdirAll(dir, 0o755)
		}
		if err == nil {
			// through a temporary file, so a reader never meets half a listing
			path := keptFile(dir, cwd)
			tmp := path + ".tmp"
			if err = os.WriteFile(tmp, data, 0o644); err == nil {
				err = os.Rename(tmp, path)
			}
		}
		if err != nil {
			log.Printf("gitinfo: could not keep the listing of %s: %v\n", cwd, err)
		}
	}()
}

// KeptListing is cwd's last listing, from memory or else from dir, or nil when none was kept.
func KeptListing(dir, cwd string) *FileList {
	keptMu.Lock()
	fl := keptLists[cwd]
	keptMu.Unlock()
	if fl != nil {
		return fl
	}
	data, err := os.ReadFile(keptFile(dir, cwd))
	if err != nil {
		return nil
	}
	var kept keptListing
	if json.Unmarshal(data, &kept) != nil || kept.Cwd != cwd || kept.List == nil {
		return nil
	}
	keptMu.Lock()
	if keptLists[cwd] == nil {
		keptLists[cwd] = kept.List
	}
	fl = keptLists[cwd]
	keptMu.Unlock()
	return fl
}
