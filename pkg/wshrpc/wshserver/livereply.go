// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The reply a Claude session is writing, for Chat: the arc mod's turn.step hook (claude/arc-mod/hooks/live-core.ts)
// rewrites ~/.arc/live/<session id>.json about every 100 ms while a response streams, and this stream sends the file's
// content each time it changes, so Chat draws the reply before the transcript holds it.

// liveSessionID is what a session id may hold: it names a file, so nothing that leaves the live directory.
var liveSessionID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// liveReplyMaxAge is how long a live reply file is kept unchanged before a sweep deletes it: a session writes it only
// while a response streams, and the mod has no way to delete a file.
const liveReplyMaxAge = 24 * time.Hour

// liveSweepEvery bounds the sweeps: one per this interval at most, run by the first stream opened after it.
const liveSweepEvery = time.Hour

var (
	liveSweepMu   sync.Mutex
	liveSweptLast time.Time
)

func liveReplyDir() string {
	return filepath.Join(wavebase.GetHomeDir(), ".arc", "live")
}

// liveReplyFile is the live reply file of the session whose transcript is at transcriptPath: Claude Code names a
// transcript by its session id, which the mod names the file by.
func liveReplyFile(dir, transcriptPath string) (string, error) {
	base := filepath.Base(filepath.Clean(transcriptPath))
	id := strings.TrimSuffix(base, ".jsonl")
	if id == base || !liveSessionID.MatchString(id) {
		return "", fmt.Errorf("not a Claude transcript path: %q", transcriptPath)
	}
	return filepath.Join(dir, id+".json"), nil
}

// readLiveReply is the file's content when it is a whole JSON value, ok false while it is not: missing, or caught
// mid-write (the next write's event reads it again).
func readLiveReply(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil || !json.Valid(data) {
		return "", false
	}
	return string(data), true
}

// sweepLiveReplies deletes the live reply files in dir last written before now less liveReplyMaxAge.
func sweepLiveReplies(dir string, now time.Time) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		info, err := e.Info()
		if err != nil || now.Sub(info.ModTime()) < liveReplyMaxAge {
			continue
		}
		_ = os.Remove(filepath.Join(dir, e.Name()))
	}
}

func maybeSweepLiveReplies(dir string) {
	liveSweepMu.Lock()
	now := time.Now()
	due := now.Sub(liveSweptLast) >= liveSweepEvery
	if due {
		liveSweptLast = now
	}
	liveSweepMu.Unlock()
	if due {
		go sweepLiveReplies(dir, now)
	}
}

// watchLiveFile watches the file itself, never its directory (watchTranscriptFile says why), and reports false with
// no error while the file does not exist.
func watchLiveFile(watcher *fsnotify.Watcher, path string) (bool, error) {
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err := watcher.Add(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("watching live reply: %w", err)
	}
	return true, nil
}

// streamLiveReply sends the file's content once at the start ("" when there is none) and again each time it changes
// to another whole JSON value. While the file does not exist it looks for it every transcriptWaitInterval. A write that
// replaces the file (a rename over it, or a remove and create) drops the watch; it is put back at once, so the new
// file is read without waiting. Returns when ctx is cancelled or on a fatal error.
func streamLiveReply(ctx context.Context, path string, ch chan wshrpc.RespOrErrorUnion[wshrpc.AgentLiveReplyUpdate]) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("creating watcher: %w", err)
	}
	defer watcher.Close()
	watching, err := watchLiveFile(watcher, path)
	if err != nil {
		return err
	}
	last, _ := readLiveReply(path)
	ch <- wshrpc.RespOrErrorUnion[wshrpc.AgentLiveReplyUpdate]{Response: wshrpc.AgentLiveReplyUpdate{Text: last}}

	send := func() {
		text, ok := readLiveReply(path)
		if !ok || text == last {
			return
		}
		last = text
		ch <- wshrpc.RespOrErrorUnion[wshrpc.AgentLiveReplyUpdate]{Response: wshrpc.AgentLiveReplyUpdate{Text: text}}
	}

	target := filepath.Clean(path)
	for {
		var wait <-chan time.Time
		if !watching {
			wait = time.After(transcriptWaitInterval)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-wait:
			if watching, err = watchLiveFile(watcher, path); err != nil {
				return err
			}
			if watching {
				send()
			}
		case event, ok := <-watcher.Events:
			if !ok {
				return nil
			}
			if filepath.Clean(event.Name) != target {
				continue
			}
			if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
				_ = watcher.Remove(path)
				if watching, err = watchLiveFile(watcher, path); err != nil {
					return err
				}
				if watching {
					send()
				}
				continue
			}
			if event.Op&(fsnotify.Write|fsnotify.Create) != 0 {
				send()
			}
		case werr, ok := <-watcher.Errors:
			if !ok {
				return nil
			}
			log.Printf("live reply watcher error: %v\n", werr)
		}
	}
}
