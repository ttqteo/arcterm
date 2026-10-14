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
	if !slices.Contains([]string{wshrpc.MemVerdict_Apply, wshrpc.MemVerdict_Keep, wshrpc.MemVerdict_Undo, wshrpc.MemVerdict_Reopen}, verdict) {
		return nil, fmt.Errorf("memory hygiene: unknown verdict %q on change %s of %s", verdict, changeID, project)
	}
	st, err := Update(project, func(st *State) error {
		i := slices.IndexFunc(st.Changes, func(c wshrpc.MemChange) bool { return c.Id == changeID })
		if i < 0 {
			return fmt.Errorf("memory hygiene: %s has no change %s", project, changeID)
		}
		c := &st.Changes[i]
		now := time.Now()
		switch verdict {
		case wshrpc.MemVerdict_Apply:
			if err := entryApply(st, c, now); err != nil {
				return err
			}
		case wshrpc.MemVerdict_Undo:
			if err := entryUndo(st, c); err != nil {
				return err
			}
		case wshrpc.MemVerdict_Keep:
			c.Status, c.DecidedAt = checkStatusKept, now.UnixMilli()
			return nil
		case wshrpc.MemVerdict_Reopen:
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

// entryBegin marks a registered project as checking, refusing one that already is.
func entryBegin(project string) error {
	if _, ok := registryFn()[project]; !ok {
		return fmt.Errorf("memory hygiene: %s is not a registered project", project)
	}
	_, err := Update(project, func(st *State) error {
		if st.Checking {
			return fmt.Errorf("memory hygiene: %s is already being checked", project)
		}
		st.Checking = true
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
