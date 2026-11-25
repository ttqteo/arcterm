// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/storage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The history read opens the pair files themselves, never the Manager: a pair that ended, or that was synced from
// another machine, is not in the Manager's index and must not be put there.

// pairIdRe is what a pair id looks like. An id names a file, so one that does not match is never opened.
var pairIdRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// folder is one folder of pair files and whether its pairs came from another machine.
type folder struct {
	dir    string
	synced bool
}

// folders are the two folders in the order that decides a doubled id: the own folder's copy wins.
func folders(ownDir, syncedDir string) []folder {
	return []folder{{ownDir, false}, {syncedDir, true}}
}

// History is every pair file of both folders, in any state, as the list shows each pair; Synced marks the synced
// folder's. project "" is every project, any other is matched as a path (cleaned, and without case on Windows). The
// newest comes first by its updated time, then by id. An id in both folders is the own folder's pair.
func History(ownDir, syncedDir, project string) ([]wshrpc.PairInfo, error) {
	infos := []wshrpc.PairInfo{}
	seen := map[string]bool{}
	for _, f := range folders(ownDir, syncedDir) {
		pairs, err := store{dir: f.dir}.readAll()
		if err != nil {
			return nil, err
		}
		for _, p := range pairs {
			if seen[p.Id] {
				continue
			}
			seen[p.Id] = true // before the project test: the own copy decides what project the id is in
			if project != "" && !storage.SamePath(p.Project, project) {
				continue
			}
			info := Info(p)
			info.Synced = f.synced
			infos = append(infos, info)
		}
	}
	sort.Slice(infos, func(i, j int) bool {
		if infos[i].UpdatedTs != infos[j].UpdatedTs {
			return infos[i].UpdatedTs > infos[j].UpdatedTs
		}
		return infos[i].Id < infos[j].Id
	})
	return infos, nil
}

// Read is the pair of one id in full, from the own folder's file, else the synced folder's (Synced is set). An id that
// is not a pair id is refused before it names a file; an id in neither folder is ErrNoPair.
func Read(ownDir, syncedDir, id string) (*wshrpc.PairView, error) {
	if !pairIdRe.MatchString(id) {
		return nil, fmt.Errorf("%q is not a pair id", id)
	}
	for _, f := range folders(ownDir, syncedDir) {
		p, err := store{dir: f.dir}.read(id)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		view := View(p)
		view.Synced = f.synced
		return view, nil
	}
	return nil, errNoPair(id)
}
