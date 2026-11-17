// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

// `wsh detach` starts a command outside arcterm's process tree, so walking a server's parents ends at a process whose
// parent is gone and the server reads as no one's. wsh tells wavesrv each launch instead, and the launch's root pid
// stands in for the block that ran it (DetachedHolder), the way a block's shell pid does.

// detachedKeep bounds the file: the newest launches are kept, an old one's pid long gone or reused
const detachedKeep = 64

// detachStartSlackMs is how far the root process's creation time may sit from the launch time wsh recorded: wsh
// stamps the launch just after the process starts, so a pid created further off is another process that reused it
const detachStartSlackMs = 5000

// DetachedLaunch is one `wsh detach`: the process it started and what ran it, as arcterm named that block then.
type DetachedLaunch struct {
	Pid     int32       `json:"pid"`
	StartMs int64       `json:"startms"`
	Cmd     string      `json:"cmd,omitempty"`
	Cwd     string      `json:"cwd,omitempty"`
	Log     string      `json:"log,omitempty"`
	Owner   ServerOwner `json:"owner"`
}

var detachedMu sync.Mutex

func readDetached(path string) ([]DetachedLaunch, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []DetachedLaunch
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// RecordDetached adds a launch to the file at path, dropping an earlier record of the same pid (it was reused) and the
// oldest past detachedKeep.
func RecordDetached(path string, l DetachedLaunch) error {
	detachedMu.Lock()
	defer detachedMu.Unlock()
	cur, err := readDetached(path)
	if err != nil {
		// a file that can't be read is replaced: it only names owners, and a fresh one is better than none
		cur = nil
	}
	next := []DetachedLaunch{}
	for _, r := range cur {
		if r.Pid != l.Pid {
			next = append(next, r)
		}
	}
	next = append(next, l)
	sort.SliceStable(next, func(i, j int) bool { return next[i].StartMs < next[j].StartMs })
	if len(next) > detachedKeep {
		next = next[len(next)-detachedKeep:]
	}
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(path, data, 0o644)
}

// DetachedLaunches reads the launches recorded at path, oldest first; none when there is no file yet.
func DetachedLaunches(path string) ([]DetachedLaunch, error) {
	detachedMu.Lock()
	defer detachedMu.Unlock()
	return readDetached(path)
}

// DetachedHolder is the holder a launch's root pid stands for: its block's owner, marked detached and held to the
// launch time, so OwnerOf passes over a pid some other process reused.
func DetachedHolder(o ServerOwner, startMs int64) ServerOwner {
	o.Detached = true
	o.startMs = startMs
	return o
}

func hasProc(procs map[int32]Proc, pid int32) bool {
	_, ok := procs[pid]
	return ok
}

// holds says whether holder h stands for the process p at its pid: always for a block's shell, and for a detached
// launch only while the pid's process was created when the launch was
func holds(h ServerOwner, p Proc, read bool) bool {
	if h.startMs == 0 {
		return true
	}
	if !read || p.CreateMs == 0 {
		return false
	}
	d := p.CreateMs - h.startMs
	return d >= -detachStartSlackMs && d <= detachStartSlackMs
}
