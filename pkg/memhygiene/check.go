// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	checkInterval = 7 * 24 * time.Hour
	// a check runs one model call per batch, so it gets far more than an rpc budget
	checkTimeout = 30 * time.Minute

	checkGroupOwn      = "own"
	checkStatusApplied = "applied"
	checkStatusKept    = "kept"

	checkSettingsDir  = ".claude"
	checkSettingsFile = "settings.local.json"
)

// checkOutcome is what a successful check stores. inv is nil when the project had nothing to check.
type checkOutcome struct {
	r       Resolved
	inv     *Inventory
	own     *Inventory // the own folder, during a split
	changes []wshrpc.MemChange
	seen    map[string]string
	sort    map[string]SortEntry
}

// runCheck checks one project and stores the result. A failure records its reason and keeps the last
// good result; either way the project stops reading as checking.
func runCheck(ctx context.Context, project, claudeHome string) error {
	startedAt := time.Now()
	err := checkRun(ctx, project, claudeHome, startedAt)
	if err == nil {
		return nil
	}
	log.Printf("memhygiene: check of %s failed: %v\n", project, err)
	if _, uerr := Update(project, func(st *State) error {
		st.Checking = false
		st.LastError = err.Error()
		return nil
	}); uerr != nil {
		return errors.Join(err, uerr)
	}
	return err
}

func checkRun(ctx context.Context, project, claudeHome string, startedAt time.Time) error {
	registry := registryFn()
	if _, ok := registry[project]; !ok {
		return fmt.Errorf("%s is not a registered project", project)
	}
	resolved := Discover(registry, claudeHome)
	idx := slices.IndexFunc(resolved, func(r Resolved) bool { return r.Project == project })
	r := resolved[idx]
	if r.Skip != "" {
		log.Printf("memhygiene: nothing to check in %s: %s\n", project, r.Skip)
		return checkStore(project, startedAt, checkOutcome{r: r})
	}
	prev, err := Load(project)
	if err != nil {
		return err
	}
	branch := DefaultBranch(r.Path)
	inv, err := checkInventory(r.Folder, r, branch)
	if err != nil {
		return err
	}
	out := checkOutcome{r: r, inv: inv, seen: map[string]string{}, sort: map[string]SortEntry{}}
	docs := InstructionDocs(r.Path, claudeHome)
	docTarget := DocTarget(r.Path)

	if len(r.SharedWith) == 0 {
		if out.changes, err = checkJudge(ctx, prev, inv, docs, docTarget, out.seen); err != nil {
			return err
		}
		if prev.FormerShared != "" {
			removals, err := checkRemoveShared(ctx, project, prev, registry, resolved, out.sort)
			if err != nil {
				return err
			}
			out.changes = append(out.changes, removals...)
		}
		return checkStore(project, startedAt, out)
	}

	if out.own, err = checkInventory(r.OwnFolder, r, branch); err != nil {
		return err
	}
	switched, err := checkSwitchedFrom(registry, r.Folder)
	if err != nil {
		return err
	}
	projects := checkUnion(append([]string{project}, r.SharedWith...), switched)
	sorted, err := checkSort(ctx, prev.Sort, inv, projects, out.sort)
	if err != nil {
		return err
	}
	settingsPath := filepath.Join(r.Path, checkSettingsDir, checkSettingsFile)
	split := SplitChanges(project, inv, out.own, sorted, r.OwnFolder, settingsPath)
	if err := checkSplitCovers(project, inv, out.own, sorted, split); err != nil {
		return err
	}
	ownChanges, err := checkJudge(ctx, prev, out.own, docs, docTarget, out.seen)
	if err != nil {
		return err
	}
	for i := range ownChanges {
		// the judge measured these against the own folder's index, which is OwnIndex during a split
		ownChanges[i].Group = checkGroupOwn
		ownChanges[i].OwnIndexDelta, ownChanges[i].IndexDelta = ownChanges[i].IndexDelta, wshrpc.MemIndexDelta{}
	}
	out.changes = append(split, ownChanges...)
	return checkStore(project, startedAt, out)
}

// checkInventory reads a folder with its evidence. A folder that doesn't exist yet (a split's own
// folder before anything moves in) is an empty inventory.
func checkInventory(folder string, r Resolved, branch string) (*Inventory, error) {
	if !discoverIsDir(folder) {
		return &Inventory{Folder: folder, IndexPath: filepath.Join(folder, inventoryIndexName)}, nil
	}
	inv, err := ReadInventory(folder)
	if err != nil {
		return nil, err
	}
	if err := GatherEvidence(inv, r.Path, branch, r.TranscriptDirs); err != nil {
		return nil, err
	}
	return inv, nil
}

// checkJudge runs the judge over the memories the hash gate lets through, and records every
// memory's fingerprint in seen.
func checkJudge(ctx context.Context, prev *State, inv *Inventory, docs map[string]string, docTarget string, seen map[string]string) ([]wshrpc.MemChange, error) {
	inPlay := checkInPlay(prev.Changes, inv.Folder)
	var todo []Memory
	for _, m := range inv.Memories {
		fp := checkFingerprint(m)
		seen[m.Name] = fp
		if prev.Seen[m.Name] == fp && !inPlay[m.Path] {
			continue
		}
		todo = append(todo, m)
	}
	var changes []wshrpc.MemChange
	for _, batch := range Batches(todo) {
		reply, err := runModel(ctx, JudgePrompt(inv, batch, docs, docTarget))
		if err != nil {
			return nil, err
		}
		parsed, err := ParseJudge(reply, inv, docTarget)
		if err != nil {
			return nil, err
		}
		changes = append(changes, parsed...)
	}
	kept, _ := Validate(changes, map[string]*Inventory{inv.Folder: inv}, docs)
	return kept, nil
}

// checkInPlay is the memory paths in folder that must be judged again whatever their fingerprint:
// those with an open change, and those whose kept change no longer matches its files.
func checkInPlay(changes []wshrpc.MemChange, folder string) map[string]bool {
	out := map[string]bool{}
	for _, c := range changes {
		if !checkSameFolder(c.Op.Folder, folder) {
			continue
		}
		switch c.Status {
		case checkStatusApplied:
			continue
		case checkStatusKept:
			if checkFilesUnchanged(c) {
				continue
			}
		}
		for _, p := range checkMemoryPaths(c) {
			out[p] = true
		}
	}
	return out
}

// checkFingerprint is what the hash gate compares: the file's bytes and its findings. Read counts
// and ages are left out, since they move every week without the memory changing.
func checkFingerprint(m Memory) string {
	h := sha256.New()
	h.Write([]byte(m.Sha256))
	for _, ev := range m.Evidence {
		if ev.Tone == evidenceToneWarn {
			h.Write([]byte("\x00" + ev.Text + "\x00" + ev.Code))
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

// checkSort sorts a shared folder's memories by the projects they apply to, asking the model only
// about memories that are new or changed since the last sort. It writes every current memory's entry
// into into, so entries for memories that are gone drop out.
func checkSort(ctx context.Context, prevSort map[string]SortEntry, shared *Inventory, projects []string, into map[string]SortEntry) (map[string][]string, error) {
	var todo []Memory
	for _, m := range shared.Memories {
		if e, ok := prevSort[m.Name]; ok && e.Sha256 == m.Sha256 {
			into[m.Name] = e
			continue
		}
		todo = append(todo, m)
	}
	if len(todo) > 0 {
		sub := *shared
		sub.Memories = todo
		reply, err := runModel(ctx, SortPrompt(&sub, projects))
		if err != nil {
			return nil, err
		}
		got, err := ParseSort(reply)
		if err != nil {
			return nil, err
		}
		for _, m := range todo {
			ps, ok := got[m.Name]
			if !ok {
				// a memory left out of the sort gets no split change, which would open the switch-over gate
				return nil, fmt.Errorf("the sort reply left out %s, so the split can't be planned", m.Name)
			}
			into[m.Name] = SortEntry{Sha256: m.Sha256, Projects: ps}
		}
	}
	sorted := make(map[string][]string, len(into))
	for name, e := range into {
		sorted[name] = e.Projects
	}
	return sorted, nil
}

// checkSplitCovers fails the check when a shared memory that applies to project got no shared
// change and isn't already in the own folder: SplitChanges skips a group it can't build, and a missing
// change would let the switch-over drop that memory from the project's sessions.
func checkSplitCovers(project string, shared, own *Inventory, sorted map[string][]string, changes []wshrpc.MemChange) error {
	covered := map[string]bool{}
	for _, c := range changes {
		if c.Group == splitGroupShared {
			for _, name := range c.Op.Memories {
				covered[name] = true
			}
		}
	}
	ownHash := map[string]string{}
	for _, m := range own.Memories {
		ownHash[m.Name] = m.Sha256
	}
	for _, m := range shared.Memories {
		if slices.Contains(sorted[m.Name], project) && !covered[m.Name] && ownHash[m.Name] != m.Sha256 {
			return fmt.Errorf("the split has no change for %s, which applies to %s", m.Name, project)
		}
	}
	return nil
}

// checkRemoveShared proposes deleting the former shared folder's memories once every project they
// apply to has switched away, listed under the last project to switch.
func checkRemoveShared(ctx context.Context, project string, prev *State, registry map[string]string, resolved []Resolved, into map[string]SortEntry) ([]wshrpc.MemChange, error) {
	folder := prev.FormerShared
	if !discoverIsDir(folder) {
		return nil, nil
	}
	shared, err := ReadInventory(folder)
	if err != nil {
		return nil, err
	}
	switched, err := checkSwitchedFrom(registry, folder)
	if err != nil {
		return nil, err
	}
	var stillLoading []string
	for _, r := range resolved {
		if r.Skip == "" && checkSameFolder(r.Folder, folder) {
			stillLoading = append(stillLoading, r.Project)
		}
	}
	sorted, err := checkSort(ctx, prev.Sort, shared, checkUnion(stillLoading, switched), into)
	if err != nil {
		return nil, err
	}
	changes := RemoveShared(project, shared, sorted, stillLoading, switched)
	for i := range changes {
		// it edits the shared index, which this project no longer loads
		changes[i].IndexDelta = wshrpc.MemIndexDelta{}
	}
	return changes, nil
}

// checkSwitchedFrom is every registered project that switched away from folder, with when.
func checkSwitchedFrom(registry map[string]string, folder string) (map[string]int64, error) {
	out := map[string]int64{}
	for name := range registry {
		st, err := Load(name)
		if err != nil {
			return nil, err
		}
		if st.FormerShared != "" && checkSameFolder(st.FormerShared, folder) {
			out[name] = st.SwitchedAt
		}
	}
	return out, nil
}

// checkStore writes a successful check, merging it with every decision already in the state.
func checkStore(project string, startedAt time.Time, out checkOutcome) error {
	now := time.Now()
	_, err := Update(project, func(st *State) error {
		r := out.r
		st.Changes = checkMerge(st.Changes, out.changes, startedAt.UnixMilli(), now)
		st.Checking = false
		st.LastError = ""
		st.CheckedAt = now.UnixMilli()
		st.NextCheckAt = now.Add(checkInterval).UnixMilli()
		st.Folder = r.Folder
		st.SharedWith = r.SharedWith
		switch {
		case r.OwnFolder != "":
			st.OwnFolder = r.OwnFolder
		case st.FormerShared != "":
			st.OwnFolder = r.Folder
		default:
			st.OwnFolder = ""
		}
		st.Memories, st.Sessions = 0, 0
		if out.inv != nil {
			st.Memories, st.Sessions = len(out.inv.Memories), out.inv.Sessions
			st.Seen, st.Sort = out.seen, out.sort
		}
		// measured now, not from the inventory: an apply during the check moved the index
		return checkRemeasure(st)
	})
	return err
}

// checkRemeasure sets Index and OwnIndex from the index files as they are now.
func checkRemeasure(st *State) error {
	st.Index = wshrpc.MemIndexStats{}
	st.OwnIndex = nil
	if st.Folder != "" {
		stats, err := checkMeasureIndex(st.Folder)
		if err != nil {
			return err
		}
		st.Index = stats
	}
	if len(st.SharedWith) > 0 && st.OwnFolder != "" {
		stats, err := checkMeasureIndex(st.OwnFolder)
		if err != nil {
			return err
		}
		st.OwnIndex = &stats
	}
	return nil
}

func checkMeasureIndex(folder string) (wshrpc.MemIndexStats, error) {
	inv := &Inventory{IndexPath: filepath.Join(folder, inventoryIndexName)}
	if err := inventoryReadIndex(inv); err != nil {
		return wshrpc.MemIndexStats{}, err
	}
	return inv.Index, nil
}

// checkMerge combines a check's proposals with the changes in the state as it is now. A verdict on a
// proposal survives the re-check, and a decision made while the check ran wins over its proposal for
// the same memories. An earlier change no proposal replaces stays while its files are unchanged, and
// an applied one stays until its backup expires.
func checkMerge(cur, fresh []wshrpc.MemChange, startedAt int64, now time.Time) []wshrpc.MemChange {
	byID := map[string]wshrpc.MemChange{}
	decided := map[string]bool{}
	for _, c := range cur {
		byID[c.Id] = c
		if (c.Status == checkStatusApplied || c.Status == checkStatusKept) && c.DecidedAt >= startedAt {
			for _, p := range checkMemoryPaths(c) {
				decided[p] = true
			}
		}
	}
	freshPaths := map[string]bool{}
	var out []wshrpc.MemChange
	listed := map[string]bool{}
	for _, c := range fresh {
		if old, ok := byID[c.Id]; ok && old.Status != splitStatusOpen && old.Status != "" {
			c = old
		} else if checkAnyIn(checkMemoryPaths(c), decided) {
			continue
		}
		out = append(out, c)
		listed[c.Id] = true
		for _, p := range checkMemoryPaths(c) {
			freshPaths[p] = true
		}
	}
	for _, c := range cur {
		if listed[c.Id] {
			continue
		}
		keep := false
		if c.Status == checkStatusApplied {
			keep = c.BackupUntil > now.UnixMilli()
		} else {
			keep = !checkAnyIn(checkMemoryPaths(c), freshPaths) && checkFilesUnchanged(c)
		}
		if keep {
			out = append(out, c)
			listed[c.Id] = true
		}
	}
	return out
}

// checkMemoryPaths is what a change acts on, for telling which changes are about the same thing.
func checkMemoryPaths(c wshrpc.MemChange) []string {
	var out []string
	for _, name := range c.Op.Memories {
		out = append(out, filepath.Join(c.Op.Folder, name))
	}
	if c.Op.SettingsPath != "" {
		out = append(out, c.Op.SettingsPath)
	}
	return out
}

func checkFilesUnchanged(c wshrpc.MemChange) bool {
	for _, f := range c.Files {
		hash, err := HashFile(f.Path)
		if err != nil {
			log.Printf("memhygiene: %v\n", err)
			return false
		}
		if hash != f.Sha256 {
			return false
		}
	}
	return true
}

func checkAnyIn(paths []string, set map[string]bool) bool {
	return slices.ContainsFunc(paths, func(p string) bool { return set[p] })
}

// checkSameFolder compares folders as discovery does: cleaned, and case-insensitively.
func checkSameFolder(a, b string) bool {
	return a != "" && strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// checkUnion is list plus the keys of more, sorted, without repeats.
func checkUnion(list []string, more map[string]int64) []string {
	out := slices.Clone(list)
	for name := range more {
		out = append(out, name)
	}
	slices.Sort(out)
	return slices.Compact(out)
}
