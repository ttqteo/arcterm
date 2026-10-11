// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// CacheMarkerName is the file in the data dir that asks the host (src-tauri/src/webcache.rs) to clear the
	// webview's cache at the next launch, before the window exists; the cache is in use while arcterm runs.
	CacheMarkerName = "clear-webview-cache"
	// LogMaxAge is how old a rolled log must be before auto-clean removes it
	LogMaxAge = 7 * 24 * time.Hour

	trashItemID       = "trash"
	cacheItemID       = "webviewcache"
	attachmentsItemID = "attachments"
)

// housekeeping is the small stuff: logs the host rolled aside, the session trash (removed for good), the images sent
// with a new agent's task (kept so its transcript can show them), and the webview's cache (cleared at the next launch).
type housekeeping struct{}

func (housekeeping) category() StorageCategory { return CategoryHousekeeping }

// isRolledLog is a log the host rolled aside (waveapp.1.log); the live waveapp.log never is.
func isRolledLog(name string) bool {
	return name != "waveapp.log" && strings.HasPrefix(name, "waveapp.") && strings.HasSuffix(name, ".log")
}

// WebviewCacheDirs is where the webview keeps its cache: WebKit files it under the bundle identifier on macOS, and
// WebView2 under <app base>/EBWebView on Windows, where <app base> holds the data dir. A dev base's "-dev"
// suffix is not part of the identifier. Other platforms have none.
func WebviewCacheDirs(goos, home, dataDir string) []string {
	base := filepath.Dir(filepath.Clean(dataDir))
	switch goos {
	case "darwin":
		id := strings.TrimSuffix(filepath.Base(base), "-dev")
		wk := filepath.Join(home, "Library", "Caches", id, "WebKit")
		return []string{filepath.Join(wk, "NetworkCache"), filepath.Join(wk, "CacheStorage")}
	case "windows":
		d := filepath.Join(base, "EBWebView", "Default")
		return []string{filepath.Join(d, "Cache"), filepath.Join(d, "Code Cache"), filepath.Join(d, "GPUCache")}
	}
	return nil
}

func (housekeeping) measure(ctx context.Context, env *Env) StorageCategoryReport {
	var items []StorageItem
	var errs []error
	entries, err := os.ReadDir(env.DataDir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		errs = append(errs, err)
	}
	for _, e := range entries {
		if !e.Type().IsRegular() || !isRolledLog(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(env.DataDir, e.Name())
		items = append(items, StorageItem{ID: path, Kind: KindLog, Label: e.Name(), Detail: "rolled log", Path: path,
			Bytes: info.Size(), ModTs: info.ModTime().UnixMilli(), Cleanable: true})
	}
	trash := dirSize(env.TrashDir)
	items = append(items, StorageItem{ID: trashItemID, Kind: KindTrash, Label: "Session trash", Detail: "removed for good",
		Path: env.TrashDir, Bytes: trash, Cleanable: trash > 0})
	if env.AttachmentsDir != "" {
		sent := dirSize(env.AttachmentsDir)
		items = append(items, StorageItem{ID: attachmentsItemID, Kind: KindAttachments, Label: "Images sent at launch",
			Detail: "their transcripts show them", Path: env.AttachmentsDir, Bytes: sent, Cleanable: sent > 0})
	}
	// A build with no cache dirs (a dev app on a Mac, which shares the packaged app's WebKit cache) offers no item.
	if len(env.WebviewCacheDirs) > 0 {
		var cache int64
		for _, d := range env.WebviewCacheDirs {
			cache += dirSize(d)
		}
		cacheItem := StorageItem{ID: cacheItemID, Kind: KindWebviewCache, Label: "Interface cache",
			Detail: "cleared when arcterm next opens", Bytes: cache, Cleanable: cache > 0}
		if fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
			cacheItem.Cleanable = false
			cacheItem.Reason = "clears when arcterm next opens"
		}
		items = append(items, cacheItem)
	}
	return report(CategoryHousekeeping, items, errors.Join(errs...))
}

func (housekeeping) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	for _, id := range ids {
		switch id {
		case trashItemID:
			if opts.Auto {
				skip(&res, id, "the trash purges itself after 7 days")
				continue
			}
			freed, err := emptyDir(env.TrashDir)
			res.Reclaimed += freed
			if err != nil {
				skip(&res, id, "couldn't remove: "+err.Error())
				continue
			}
			res.Cleaned = append(res.Cleaned, id)
		case attachmentsItemID:
			if opts.Auto {
				skip(&res, id, "the images are removed only when you ask")
				continue
			}
			if env.AttachmentsDir == "" {
				skip(&res, id, "no images kept here")
				continue
			}
			freed, err := emptyDir(env.AttachmentsDir)
			res.Reclaimed += freed
			if err != nil {
				skip(&res, id, "couldn't remove: "+err.Error())
				continue
			}
			res.Cleaned = append(res.Cleaned, id)
		case cacheItemID:
			if opts.Auto {
				skip(&res, id, "the cache is cleaned only when you ask")
				continue
			}
			if len(env.WebviewCacheDirs) == 0 {
				skip(&res, id, "no interface cache to clear here")
				continue
			}
			if err := os.MkdirAll(env.DataDir, 0o700); err != nil {
				skip(&res, id, "couldn't schedule it: "+err.Error())
				continue
			}
			marker := filepath.Join(env.DataDir, CacheMarkerName)
			if err := os.WriteFile(marker, []byte(env.Now().UTC().Format(time.RFC3339)), 0o600); err != nil {
				skip(&res, id, "couldn't schedule it: "+err.Error())
				continue
			}
			res.Deferred = true
			res.Cleaned = append(res.Cleaned, id)
		default:
			if !SamePath(filepath.Dir(id), env.DataDir) || !isRolledLog(filepath.Base(id)) {
				skip(&res, id, "not a rolled log")
				continue
			}
			info, err := os.Lstat(id)
			if err != nil || !info.Mode().IsRegular() {
				skip(&res, id, "no longer exists")
				continue
			}
			if opts.Auto && env.Now().Sub(info.ModTime()) < LogMaxAge {
				skip(&res, id, "newer than 7 days")
				continue
			}
			if err := os.Remove(id); err != nil {
				skip(&res, id, "couldn't remove: "+err.Error())
				continue
			}
			res.Reclaimed += info.Size()
			res.Cleaned = append(res.Cleaned, id)
		}
	}
	return res
}

// emptyDir removes everything inside dir, keeping dir, and returns the bytes it freed.
func emptyDir(dir string) (int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	var freed int64
	var errs []error
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		size := dirSize(p)
		if err := os.RemoveAll(p); err != nil {
			errs = append(errs, err)
			continue
		}
		freed += size
	}
	return freed, errors.Join(errs...)
}
