// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
)

const (
	// minSessionAge is the youngest a listed session can be: the card's shortest choice
	minSessionAge = 7 * 24 * time.Hour
	// defaultSessionDays is the card's default age, used when a clean names none
	defaultSessionDays = 30
)

// oldSessions lists Claude transcripts untouched for at least a week and moves the chosen ones to the session
// trash through pkg/sessiontrash, whose rules hold: never a session a tab has open or wrote to in the last two
// minutes. pi and other runtimes keep their sessions.
type oldSessions struct{}

func (oldSessions) category() StorageCategory { return CategorySessions }

func (oldSessions) measure(ctx context.Context, env *Env) StorageCategoryReport {
	live, err := env.LiveTranscripts(ctx)
	if err != nil {
		return report(CategorySessions, nil, fmt.Errorf("listing the open sessions: %w", err))
	}
	now := env.Now()
	var items []StorageItem
	var errs []error
	for _, root := range env.SessionDirs {
		projects, err := os.ReadDir(root)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				errs = append(errs, err)
			}
			continue
		}
		for _, p := range projects {
			if !p.IsDir() {
				continue
			}
			dir := filepath.Join(root, p.Name())
			files, err := os.ReadDir(dir)
			if err != nil {
				errs = append(errs, err)
				continue
			}
			for _, f := range files {
				if !f.Type().IsRegular() || !strings.HasSuffix(f.Name(), ".jsonl") {
					continue
				}
				info, err := f.Info()
				if err != nil || now.Sub(info.ModTime()) < minSessionAge {
					continue
				}
				path := filepath.Join(dir, f.Name())
				id := strings.TrimSuffix(f.Name(), ".jsonl")
				it := StorageItem{
					ID: path, Kind: KindSession, Label: shortID(id), Detail: p.Name(), Path: path,
					Bytes: info.Size() + dirSize(filepath.Join(dir, id)), ModTs: info.ModTime().UnixMilli(), Cleanable: true,
				}
				if isLive(live, path) {
					it.Cleanable = false
					it.Reason = "open in a tab"
				}
				items = append(items, it)
			}
		}
	}
	return report(CategorySessions, items, errors.Join(errs...))
}

func (oldSessions) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	if opts.Auto {
		for _, id := range ids {
			skip(&res, id, "sessions are cleaned only when you ask")
		}
		return res
	}
	days := opts.OlderThanDays
	if days == 0 {
		days = defaultSessionDays
	}
	days = max(days, int(minSessionAge/(24*time.Hour)))
	live, err := env.LiveTranscripts(ctx)
	if err != nil {
		for _, id := range ids {
			skip(&res, id, "couldn't list the open sessions: "+err.Error())
		}
		return res
	}
	now := env.Now()
	for _, id := range ids {
		info, err := os.Stat(id)
		if err != nil {
			skip(&res, id, "no longer exists")
			continue
		}
		if now.Sub(info.ModTime()) < time.Duration(days)*24*time.Hour {
			skip(&res, id, fmt.Sprintf("changed in the last %d days", days))
			continue
		}
		size := info.Size() + dirSize(strings.TrimSuffix(id, ".jsonl"))
		trashOpts := sessiontrash.Options{ProjectsDirs: env.SessionDirs, TrashDir: env.TrashDir, LiveTranscripts: live, Now: now}
		if _, err := sessiontrash.Delete(trashOpts, id); err != nil {
			skip(&res, id, err.Error())
			continue
		}
		res.Trashed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func isLive(live []string, path string) bool {
	for _, l := range live {
		if SamePath(l, path) {
			return true
		}
	}
	return false
}
