// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

// councilTreePrefix starts the key of every tree a council's verify commands run in ("council-<id>").
const councilTreePrefix = "council-"

// cargoTargetDir is the folder cargo builds into; like node_modules, a tree shares main's so a test does not compile
// every dependency again inside the council's 3-minute limit.
const cargoTargetDir = "target"

// CouncilTrees is the council.TreeMaker wavesrv wires into council.Runner.Trees. pkg/council cannot import this package
// (it imports pkg/council), so it asks for the tree through that interface.
type CouncilTrees struct{}

var _ council.TreeMaker = CouncilTrees{}

// Make checks the project's repo out, detached, at commit in <worktree root>/<key> (where run trees live), links the
// installed dependencies the project's tests need, and returns the tree's counterpart of project: the tree itself, or
// the same subfolder inside it when project is a subfolder of the repo. It makes no branch. An earlier tree of the same
// key (a crash before Remove) is replaced. A failed Make leaves no tree.
func (CouncilTrees) Make(ctx context.Context, project, commit, key string) (string, error) {
	if commit == "" {
		return "", errors.New("no snapshot commit to check out")
	}
	top, prefix, err := repoTop(ctx, project)
	if err != nil {
		return "", err
	}
	wt, err := claimWorktreeDir(top, key)
	if err != nil {
		return "", fmt.Errorf("creating the council's tree: %w", err)
	}
	if _, err := os.Lstat(wt); err == nil {
		if err := removeCouncilTree(ctx, top, wt); err != nil {
			return "", fmt.Errorf("replacing the council's earlier tree: %w", err)
		}
	}
	// a registration whose directory is gone makes the add refuse
	if _, err := gitLocked(ctx, top, "worktree", "prune"); err != nil {
		return "", fmt.Errorf("pruning worktrees: %w", err)
	}
	if _, err := addWorktree(ctx, top, "--detach", wt, commit); err != nil {
		return "", fmt.Errorf("creating the council's tree: %w", err)
	}
	if err := linkCouncilTree(ctx, wt); err != nil {
		// Remove is for a tree Make returned
		if rerr := removeCouncilTree(context.WithoutCancel(ctx), top, wt); rerr != nil {
			log.Printf("[council] removing the tree %s after a failed link: %v", wt, rerr)
		}
		return "", err
	}
	return filepath.Join(wt, filepath.FromSlash(prefix)), nil
}

// Remove deletes the tree Make returned for project, the links first so a delete never follows one into the project's own
// node_modules or target. A tree already gone is not an error. It refuses anything that is not a detached tree of this repo:
// the checkout itself, and an engine run's tree, which sits on its wave/<runId> branch.
func (CouncilTrees) Remove(ctx context.Context, project, dir string) error {
	top, prefix, err := repoTop(ctx, project)
	if err != nil {
		return err
	}
	// dir is the tree's counterpart of project: step up out of the project's subfolder to the tree's root
	wt := dir
	if prefix != "" {
		for range strings.SplitSeq(strings.TrimSuffix(prefix, "/"), "/") {
			wt = filepath.Dir(wt)
		}
	}
	switch {
	case sameDir(wt, top):
		return fmt.Errorf("%s is the checkout, not a council's tree", wt)
	case !isWorktreeRegistered(ctx, top, wt):
		return removeUnregisteredCouncilTree(ctx, top, wt)
	}
	if head, err := git(ctx, wt, "rev-parse", "--abbrev-ref", "HEAD"); err != nil || head != "HEAD" {
		return fmt.Errorf("%s is not a detached council tree (on %q)", wt, head)
	}
	return removeCouncilTree(ctx, top, wt)
}

// repoTop is project's repo root and project's folder within it ("" at the root, else "sub/dir/", forward slashes).
func repoTop(ctx context.Context, project string) (top, prefix string, err error) {
	out, err := git(ctx, project, "rev-parse", "--show-toplevel", "--show-prefix")
	if err != nil {
		return "", "", fmt.Errorf("%w: %w", ErrNotGitRepo, err)
	}
	// git trims the empty second line of a project at the root
	first, rest, _ := strings.Cut(out, "\n")
	if first = strings.TrimSpace(first); first == "" {
		return "", "", ErrNotGitRepo
	}
	return filepath.FromSlash(first), strings.TrimSpace(rest), nil
}

// linkCouncilTree links what main has installed into the new tree: node_modules beside each package.json (the engine's
// default), and a cargo target beside each Cargo.toml.
func linkCouncilTree(ctx context.Context, wt string) error {
	notLinked, err := linkDependencies(ctx, wt)
	if err != nil {
		return fmt.Errorf("linking dependencies into the council's tree: %w", err)
	}
	if len(notLinked) > 0 {
		log.Printf("[council] tree %s: no node_modules linked for %s", wt, strings.Join(notLinked, "; "))
	}
	if err := linkCargoTargets(ctx, wt); err != nil {
		return fmt.Errorf("linking cargo targets into the council's tree: %w", err)
	}
	return nil
}

// linkCargoTargets links, for each Cargo.toml tracked in wt, the main checkout's target dir beside it into wt, when main has
// one (a real directory, never a link of its own) and wt has none. Running it again is a no-op.
func linkCargoTargets(ctx context.Context, wt string) error {
	main := jarvis.MainCheckout(wt)
	if main == "" || sameDir(main, wt) {
		return nil
	}
	out, err := git(ctx, wt, "ls-files", "-z", "--", "*Cargo.toml")
	if err != nil {
		return fmt.Errorf("listing Cargo.toml files in %s: %w", wt, err)
	}
	for f := range strings.SplitSeq(out, "\x00") {
		if path.Base(f) != "Cargo.toml" || slices.Contains(strings.Split(f, "/"), dependencyDir) {
			continue
		}
		dir := filepath.FromSlash(path.Dir(f))
		target := filepath.Join(main, dir, cargoTargetDir)
		if fi, err := os.Lstat(target); err != nil || !fi.IsDir() {
			continue
		}
		link := filepath.Join(wt, dir, cargoTargetDir)
		if _, err := os.Lstat(link); err == nil {
			continue
		}
		if err := linkDir(ctx, link, target); err != nil {
			return err
		}
	}
	return nil
}

// removeCouncilTree unlinks, unregisters and deletes wt, serialized with the engine's own removals of that path.
func removeCouncilTree(ctx context.Context, top, wt string) error {
	treeRemovals.Lock(wt)
	defer treeRemovals.Unlock(wt)
	return removeWorktreeDir(ctx, top, wt)
}

// removeUnregisteredCouncilTree is Remove for a tree git no longer lists: the registration went and the delete did not
// finish, or the tree was never added. Only a folder named for a council's key, in the place such trees live, is deleted;
// anything else is not Remove's.
func removeUnregisteredCouncilTree(ctx context.Context, top, wt string) error {
	if _, err := os.Lstat(wt); errors.Is(err, os.ErrNotExist) {
		_, err := gitLocked(ctx, top, "worktree", "prune")
		return err
	}
	if !isCouncilTreeDir(top, wt) {
		return fmt.Errorf("%s is not a tree of this repo", wt)
	}
	treeRemovals.Lock(wt)
	defer treeRemovals.Unlock(wt)
	// before the delete: os.RemoveAll would follow a junction into its target
	if err := unlinkReparsePoints(wt); err != nil {
		return fmt.Errorf("removing %s: %w", wt, err)
	}
	if err := os.RemoveAll(wt); err != nil {
		return fmt.Errorf("removing %s: %w", wt, err)
	}
	return nil
}

// isCouncilTreeDir reports whether wt is where Make puts a council's tree: <worktree root>/council-<id>, or the legacy
// <repo>/.waveterm/worktrees/council-<id> when the root is not set.
func isCouncilTreeDir(top, wt string) bool {
	if !strings.HasPrefix(filepath.Base(wt), councilTreePrefix) {
		return false
	}
	parent := filepath.Dir(wt)
	if root := worktreeRoot(); root != "" && sameDir(parent, root) {
		return true
	}
	return sameDir(parent, filepath.Dir(legacyWorktreeDir(top, "x")))
}

// sameDir compares two paths the way the engine does for trees: cleaned, and without case on Windows and macOS.
func sameDir(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}
