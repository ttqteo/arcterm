// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	entryBackupDir  = "backups"
	entryBackupKeep = 30 * 24 * time.Hour
)

// the two seams every test sets, so no test reads the real ~/.claude or the live registry
var claudeHomeFn = func() string { return filepath.Join(wavebase.GetHomeDir(), ".claude") }
var registryFn = memroots.RegistryProjects

// the three entry points wshserver calls

func ListProjects() ([]wshrpc.MemHygieneProject, error) {
	return List(registryFn())
}

// StartCheck marks the project as checking and runs the check off the rpc context: it makes model
// calls, which can't fit the rpc budget.
func StartCheck(project string) error {
	if err := entryBegin(project); err != nil {
		return err
	}
	go entryRun(project)
	return nil
}

func Decide(project, changeID, verdict string) (*wshrpc.MemHygieneProject, error) {
	if !slices.Contains([]string{wshrpc.MemVerdict_Apply, wshrpc.MemVerdict_Keep, wshrpc.MemVerdict_Undo, wshrpc.MemVerdict_Reopen, wshrpc.MemVerdict_Delete}, verdict) {
		return nil, fmt.Errorf("memory hygiene: unknown verdict %q on change %s of %s", verdict, changeID, project)
	}
	st, err := Update(project, func(st *State) error {
		i := entryFind(st, changeID)
		if i < 0 {
			return fmt.Errorf("memory hygiene: %s has no change %s", project, changeID)
		}
		c := &st.Changes[i]
		now := time.Now()
		switch verdict {
		case wshrpc.MemVerdict_Apply:
			// a superseded Review's place is taken by the change that replaced it
			if c.Status == wshrpc.MemStatus_Superseded {
				return entryRefuse(st, c, verdict)
			}
			if err := entryApply(st, c, now); err != nil {
				return err
			}
		case wshrpc.MemVerdict_Delete:
			if err := entryDelete(st, i, now); err != nil {
				return err
			}
		case wshrpc.MemVerdict_Undo:
			if err := entryUndo(st, c); err != nil {
				return err
			}
			// undoing a delete made from a Review brings the Review back in its place
			if c.FromReview != "" && c.Kind == judgeKindDelete && entryRestoreReview(st, c.FromReview) {
				st.Changes = slices.Delete(st.Changes, i, i+1)
			}
		case wshrpc.MemVerdict_Keep:
			// an applied change's files stay applied, so keeping it would misstate what's on disk
			if !Pending(*c) {
				return entryRefuse(st, c, verdict)
			}
			c.Status, c.DecidedAt = checkStatusKept, now.UnixMilli()
			// Back to review: keeping a change made from a Review reopens the Review
			if c.FromReview != "" {
				entryRestoreReview(st, c.FromReview)
			}
			return nil
		case wshrpc.MemVerdict_Reopen:
			if c.Status != checkStatusKept {
				return entryRefuse(st, c, verdict)
			}
			c.Status, c.DecidedAt, c.ConflictFile = splitStatusOpen, 0, ""
			return nil
		}
		return checkRemeasure(st)
	})
	if err != nil {
		return nil, err
	}
	return &st.MemHygieneProject, nil
}

func entryRefuse(st *State, c *wshrpc.MemChange, verdict string) error {
	return fmt.Errorf("memory hygiene: can't %s %q in %s: it's %s", verdict, c.Title, st.Project, c.Status)
}

func entryFind(st *State, changeID string) int {
	return slices.IndexFunc(st.Changes, func(c wshrpc.MemChange) bool { return c.Id == changeID })
}

// entryDelete deletes the one memory of the open Review at st.Changes[i], with its MEMORY.md index
// line: it builds the same change the judge's delete kind does, records it as replacing the Review, and
// applies it. A memory changed since the check is a conflict, as for any apply, and the Review stays
// superseded behind the conflicted delete.
func entryDelete(st *State, i int, now time.Time) error {
	review := st.Changes[i]
	if review.Kind != reviewKind || review.Status != splitStatusOpen {
		return entryRefuse(st, &review, wshrpc.MemVerdict_Delete)
	}
	if len(review.Op.Memories) != 1 {
		return fmt.Errorf("memory hygiene: review %q in %s names %d memories, want one", review.Title, st.Project, len(review.Op.Memories))
	}
	inv, err := ReadInventory(review.Op.Folder)
	if err != nil {
		return err
	}
	index, err := ReadText(inv.IndexPath)
	if err != nil {
		return err
	}
	del, err := judgeBuild(judgeChange{Kind: judgeKindDelete, Title: review.Title, Files: review.Op.Memories}, inv, "", len(index.EOL))
	if err != nil {
		return fmt.Errorf("memory hygiene: deleting %q in %s: %w", review.Title, st.Project, err)
	}
	// the hashes the Review was checked at, so a memory edited since then is a conflict
	for fi := range del.Files {
		for _, rf := range review.Files {
			if checkSameFolder(rf.Path, del.Files[fi].Path) {
				del.Files[fi].Sha256 = rf.Sha256
			}
		}
	}
	del.Id = ChangeID(judgeKindDelete, del.Files)
	del.Evidence, del.Body = review.Evidence, review.Body
	del.DocLines = []wshrpc.MemDocLine{}
	del.FromReview, del.Status = review.Id, splitStatusOpen

	// a judge delete of the same memory at the same hash has the same id; one the person kept is
	// replaced, one already applied can't be (the memory would be gone)
	j := entryFind(st, del.Id)
	switch {
	case j >= 0 && st.Changes[j].Status == checkStatusApplied:
		return fmt.Errorf("memory hygiene: %q in %s is already deleted", review.Title, st.Project)
	case j >= 0:
		st.Changes[j] = del
	default:
		st.Changes = append(st.Changes, del)
		j = len(st.Changes) - 1
	}
	entrySupersede(st, &st.Changes[i], &st.Changes[j])
	return entryApply(st, &st.Changes[j], now)
}

// entrySupersede records that by replaces review: the Review leaves the pending list and by names it.
func entrySupersede(st *State, review, by *wshrpc.MemChange) {
	review.Status, review.SupersededBy = wshrpc.MemStatus_Superseded, by.Id
	by.FromReview = review.Id
}

// entryRestoreReview sets the Review reviewID back to open, as Undo of its delete or Back to review on
// its agent proposal does. It reports false when the state no longer holds that Review (a check dropped
// it), so the caller leaves the replacing change in place.
func entryRestoreReview(st *State, reviewID string) bool {
	i := entryFind(st, reviewID)
	if i < 0 || st.Changes[i].Kind != reviewKind {
		return false
	}
	r := &st.Changes[i]
	r.Status, r.SupersededBy, r.DecidedAt, r.ConflictFile = splitStatusOpen, "", 0, ""
	return true
}

func entryApply(st *State, c *wshrpc.MemChange, now time.Time) error {
	if c.Status == checkStatusApplied {
		return fmt.Errorf("memory hygiene: %q in %s is already applied", c.Title, st.Project)
	}
	if c.Kind == splitKindSettings {
		if n := OpenSharedChanges(st.Changes); n > 0 {
			return fmt.Errorf("memory hygiene: review the %d changes from the shared memory before switching %s over", n, st.Project)
		}
	}
	applyID, conflict, err := Apply(*c, entryBackupRoot(), now)
	if err != nil {
		return fmt.Errorf("memory hygiene: applying %q in %s: %w", c.Title, st.Project, err)
	}
	c.DecidedAt = now.UnixMilli()
	if conflict != "" {
		c.Status, c.ConflictFile = splitStatusConflict, conflict
		return nil
	}
	c.Status, c.ConflictFile, c.ApplyId = checkStatusApplied, "", applyID
	c.BackupUntil = now.Add(entryBackupKeep).UnixMilli()
	if c.Kind == splitKindSettings {
		st.FormerShared, st.SwitchedAt = st.Folder, now.UnixMilli()
	}
	return nil
}

func entryUndo(st *State, c *wshrpc.MemChange) error {
	if c.Status != checkStatusApplied {
		return fmt.Errorf("memory hygiene: %q in %s isn't applied, so there's nothing to undo", c.Title, st.Project)
	}
	conflict, err := Undo(entryBackupRoot(), c.ApplyId)
	if err != nil {
		return fmt.Errorf("memory hygiene: undoing %q in %s: %w", c.Title, st.Project, err)
	}
	if conflict != "" {
		return fmt.Errorf("memory hygiene: can't undo %q in %s: %s changed since it was applied", c.Title, st.Project, conflict)
	}
	c.Status, c.ApplyId, c.BackupUntil, c.DecidedAt = splitStatusOpen, "", 0, 0
	if c.Kind == splitKindSettings {
		st.FormerShared, st.SwitchedAt = "", 0
	}
	return nil
}

// entryBegin marks a registered project as checking, refusing one that already is. It moves the next
// sweep a week out up front, so a check that fails or is cut short waits for the next weekly sweep
// instead of making a model call every hour.
func entryBegin(project string) error {
	if _, ok := registryFn()[project]; !ok {
		return fmt.Errorf("memory hygiene: %s is not a registered project", project)
	}
	_, err := Update(project, func(st *State) error {
		if st.Checking {
			return fmt.Errorf("memory hygiene: %s is already being checked", project)
		}
		st.Checking = true
		st.NextCheckAt = time.Now().Add(checkInterval).UnixMilli()
		return nil
	})
	return err
}

// entryRun runs a check entryBegin started. A panic is recorded as the check's failure, so the
// project never reads as checking forever.
func entryRun(project string) {
	defer func() {
		if perr := panichandler.PanicHandler("memhygiene.check", recover()); perr != nil {
			if _, err := Update(project, func(st *State) error {
				st.Checking, st.LastError = false, perr.Error()
				return nil
			}); err != nil {
				log.Printf("memhygiene: recording the panic in the check of %s: %v\n", project, err)
			}
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), checkTimeout)
	defer cancel()
	// runCheck has already recorded and logged a failure
	_ = runCheck(ctx, project, claudeHomeFn())
}

func entryBackupRoot() string {
	return filepath.Join(StateDir(), entryBackupDir)
}
