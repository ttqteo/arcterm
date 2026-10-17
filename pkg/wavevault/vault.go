// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/memroots"
)

const (
	CollMemory      = "memory"
	CollTasks       = "tasks"
	CollDecisions   = "decisions"
	CollAttachments = "attachments"
)

// scaffoldDirs are the directories created on first open. tasks has active/archive subdirs; the
// read scopes address the top-level "tasks" collection (the scanner recurses).
var scaffoldDirs = []string{CollMemory, "tasks/active", "tasks/archive", CollDecisions, CollAttachments}

// Scope is the collection boundary: a Retriever built from a Scope can physically only read those
// collections (invariant 4). Attachments hold binaries and are not scanned into the node graph.
type Scope struct {
	Collections []string
}

func AllScope() Scope { return Scope{Collections: []string{CollMemory, CollTasks, CollDecisions}} }

// Vault is a handle to one on-disk git-backed vault. machineFiles records, per absolute path, the
// content hash Jarvis last wrote — Commit uses it to author machine-only changes as Jarvis.
type Vault struct {
	Root         string
	mu           sync.Mutex
	machineFiles map[string]string
}

// DefaultVaultRoot resolves the vault path from config (memory:vaultpath) + home.
func DefaultVaultRoot() string {
	return memroots.VaultRoot()
}

// migrateOnce guards the one-shot legacy-root fold. OpenVault is called from several packages per
// session; without this two concurrent opens would race on the same file moves.
var migrateOnce sync.Once

// OpenVault opens (creating + git-initializing if needed) the configured vault. It is also the only
// path that, on the first call of the process, folds the legacy ~/.waveterm/memory root into the
// vault's memory collection — openVaultAt stays hermetic.
func OpenVault(ctx context.Context) (*Vault, error) {
	// after openVaultAt deliberately: it scaffolds <root>/memory, the migration's destination
	v, err := openVaultAt(ctx, DefaultVaultRoot())
	if err != nil {
		return nil, err
	}
	migrateOnce.Do(func() {
		if _, _, mErr := memroots.MigrateLegacyRoot(); mErr != nil {
			log.Printf("wavevault: legacy memory migration failed: %v", mErr) // non-fatal: the legacy root stays a readable mirror
		}
	})
	return v, nil
}

// OpenVaultAt opens a vault at an explicit root, bypassing config. For tools that must target a
// vault other than the configured one — the backfill importer runs against a throwaway copy before
// it is pointed at the real vault.
func OpenVaultAt(ctx context.Context, root string) (*Vault, error) {
	return openVaultAt(ctx, root)
}

// OpenVaultAtForTest opens a vault at an explicit root. Exported for sibling-package tests
// (jarvisdossier); production code uses OpenVault.
func OpenVaultAtForTest(ctx context.Context, root string) (*Vault, error) {
	return openVaultAt(ctx, root)
}

// openVaultAt is the test seam: open a vault at an explicit root.
func openVaultAt(ctx context.Context, root string) (*Vault, error) {
	for _, d := range scaffoldDirs {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			return nil, err
		}
	}
	v := &Vault{Root: root, machineFiles: map[string]string{}}
	if err := v.ensureGit(ctx); err != nil {
		return nil, err
	}
	return v, nil
}

// ensureGit git-inits the vault if it is not already a repo, and sets a fallback identity so
// human-authored commits never fail with "unknown identity". Idempotent.
func (v *Vault) ensureGit(ctx context.Context) error {
	if _, err := os.Stat(filepath.Join(v.Root, ".git")); err == nil {
		return nil // already a repo — leave its identity/config alone
	}
	if _, err := runGitErr(ctx, v.Root, "init", "-b", "main"); err != nil {
		return err
	}
	if out, _ := runGit(ctx, v.Root, "config", "user.email"); strings.TrimSpace(out) == "" {
		if _, err := runGitErr(ctx, v.Root, "config", "user.email", "user@waveterm.local"); err != nil {
			return err
		}
		if _, err := runGitErr(ctx, v.Root, "config", "user.name", "Wave User"); err != nil {
			return err
		}
	}
	return nil
}
