// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// ConflictsDir holds the remote side of a conflict nothing could merge, at conflicts/<original path>.
// It is not a scanned collection, so a conflict copy is never indexed as a duplicate note.
const ConflictsDir = "conflicts"

// SyncResult.Off values: why sync did not run.
const (
	SyncOffNoGit    = "no-git"
	SyncOffNoRemote = "no-remote"
)

const (
	syncRemote      = "origin"
	syncBranch      = "main"
	syncUpstream    = syncRemote + "/" + syncBranch
	syncCommitLabel = "sync: local changes"
	// a non-fast-forward rejection is retried once; a second one is a sync failure
	syncPushAttempts = 2
)

// git's index stages for an unmerged path
const (
	stageBase   = 1
	stageOurs   = 2
	stageTheirs = 3
)

// pushRejectedMarkers are the stderr fragments of a push the remote refused because it moved on.
var pushRejectedMarkers = []string{"[rejected]", "non-fast-forward", "fetch first"}

// beforePush runs just before each push; the test seam for a push race. beforeFetch runs just
// before each fetch; the test seam for a write landing while the network step runs.
var (
	beforePush  func()
	beforeFetch func()
)

// SyncResult reports one Sync. Off is "" when sync ran, else SyncOffNoGit or SyncOffNoRemote.
// NewConflicts lists the vault-relative conflict copies this run wrote. Pulled is whether the merge brought in
// commits from the remote.
type SyncResult struct {
	Off          string
	Pushed       bool
	Pulled       bool
	NewConflicts []string
}

type unmergedPath struct {
	rel    string
	stages map[int]string // stage → blob id
}

// Sync commits local changes, merges origin/main and pushes. Conflicts merge field-aware (efforts)
// or key-level (settings), else keep the local side and save the remote side under conflicts/. No
// git on PATH or no origin remote is not an error: Off says which.
//
// The vault lock (LockRoot) is held only for the steps that touch the work tree or index: the
// commit and the merge. The fetch and the push run without it, since they move only refs and
// objects, and they wait on the network: holding the lock through them made every effort write
// queue behind a whole sync, past wsh's 5 s RPC timeout. A write that lands meanwhile is committed
// right before the merge, so the merge always starts from a clean tree, and pushed by the next Sync.
func (v *Vault) Sync(ctx context.Context) (SyncResult, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return SyncResult{Off: SyncOffNoGit}, nil
	}
	unlockSync := lockSync(v.Root)
	defer unlockSync()

	url, err := v.RemoteURL(ctx)
	if err != nil {
		return SyncResult{}, err
	}
	if url == "" {
		return SyncResult{Off: SyncOffNoRemote}, nil
	}
	// a merge a crash interrupted is dropped first; the local changes are committed after the fetch
	if err := v.withRootLock(func() error {
		if _, ok := v.revParse(ctx, "MERGE_HEAD"); ok {
			_, err := v.syncGit(ctx, "merge", "--abort")
			return err
		}
		return nil
	}); err != nil {
		return SyncResult{}, err
	}

	var res SyncResult
	for attempt := 1; ; attempt++ {
		if err := v.fetchAndMerge(ctx, &res); err != nil {
			return res, err
		}
		pushed, err := v.push(ctx)
		if err == nil {
			res.Pushed = pushed
			return res, nil
		}
		if attempt == syncPushAttempts || !isPushRejected(err) {
			return res, err
		}
	}
}

// withRootLock runs fn holding the vault lock.
func (v *Vault) withRootLock(fn func() error) error {
	unlock := LockRoot(v.Root)
	defer unlock()
	return fn()
}

// fetchAndMerge fetches origin without the vault lock, then, holding it, commits what was written
// during the fetch and merges origin/main, resolving every conflict and committing the merge. An
// absent origin/main (a freshly created remote) leaves nothing to merge.
func (v *Vault) fetchAndMerge(ctx context.Context, res *SyncResult) error {
	if beforeFetch != nil {
		beforeFetch()
	}
	if _, err := v.syncGitNet(ctx, "fetch", syncRemote); err != nil {
		return err
	}
	return v.withRootLock(func() error {
		if _, err := v.commitLocked(ctx, syncCommitLabel); err != nil {
			return err
		}
		// the local changes are committed by now, so HEAD moves only by what the merge brings in
		before, _ := v.revParse(ctx, "HEAD")
		err := v.mergeUpstreamLocked(ctx, res)
		if after, _ := v.revParse(ctx, "HEAD"); after != before {
			res.Pulled = true
		}
		return err
	})
}

// mergeUpstreamLocked merges origin/main for a caller holding the vault lock.
func (v *Vault) mergeUpstreamLocked(ctx context.Context, res *SyncResult) error {
	if _, ok := v.revParse(ctx, syncUpstream); !ok {
		return nil
	}
	_, mergeErr := v.syncGit(ctx, "merge", "--no-edit", "--allow-unrelated-histories", syncUpstream)
	if mergeErr == nil {
		return nil
	}
	unmerged, err := v.unmergedPaths(ctx)
	if err != nil {
		return err
	}
	if len(unmerged) == 0 {
		return mergeErr // failed for a reason other than conflicts
	}
	for _, u := range unmerged {
		copyRel, err := v.resolveConflict(ctx, u)
		if err != nil {
			return err
		}
		if copyRel != "" {
			res.NewConflicts = append(res.NewConflicts, copyRel)
		}
	}
	_, err = v.syncGit(ctx, "commit", "--no-edit")
	return err
}

// push publishes HEAD to origin/main; it reports false when there is nothing to publish (HEAD
// unborn, or already what origin/main holds).
func (v *Vault) push(ctx context.Context) (bool, error) {
	head, ok := v.revParse(ctx, "HEAD")
	if !ok {
		return false, nil
	}
	if upstream, ok := v.revParse(ctx, syncUpstream); ok && upstream == head {
		return false, nil
	}
	if beforePush != nil {
		beforePush()
	}
	if _, err := v.syncGitNet(ctx, "push", syncRemote, "HEAD:"+syncBranch); err != nil {
		return false, err
	}
	return true, nil
}

func isPushRejected(err error) bool {
	msg := err.Error()
	return slices.ContainsFunc(pushRejectedMarkers, func(m string) bool { return strings.Contains(msg, m) })
}

// unmergedPaths lists the conflicted paths with their stages, from `git ls-files -u`.
func (v *Vault) unmergedPaths(ctx context.Context) ([]unmergedPath, error) {
	out, err := v.syncGit(ctx, "ls-files", "-u", "-z")
	if err != nil {
		return nil, err
	}
	var paths []unmergedPath
	byRel := map[string]int{}
	for _, rec := range strings.Split(string(out), "\x00") {
		meta, rel, ok := strings.Cut(rec, "\t") // "<mode> <blob> <stage>\t<path>"
		fields := strings.Fields(meta)
		if !ok || len(fields) != 3 {
			continue
		}
		stage, err := strconv.Atoi(fields[2])
		if err != nil {
			return nil, fmt.Errorf("git ls-files -u: bad stage in %q", rec)
		}
		i, seen := byRel[rel]
		if !seen {
			i = len(paths)
			byRel[rel] = i
			paths = append(paths, unmergedPath{rel: rel, stages: map[int]string{}})
		}
		paths[i].stages[stage] = fields[1]
	}
	return paths, nil
}

// resolveConflict resolves one unmerged path and returns the conflict copy it wrote, if any.
func (v *Vault) resolveConflict(ctx context.Context, u unmergedPath) (string, error) {
	_, hasOurs := u.stages[stageOurs]
	_, hasTheirs := u.stages[stageTheirs]
	if !hasOurs && !hasTheirs {
		_, err := v.syncGit(ctx, "--literal-pathspecs", "rm", "-q", "-f", "--ignore-unmatch", "--", u.rel)
		return "", err
	}
	blobs := map[int][]byte{}
	for stage, id := range u.stages {
		b, err := v.syncGit(ctx, "cat-file", "blob", id)
		if err != nil {
			return "", err
		}
		blobs[stage] = b
	}
	// modify/delete: the edit outlives the concurrent delete, and nothing is lost, so no copy
	if !hasTheirs {
		return "", v.writeAndAdd(ctx, u.rel, blobs[stageOurs])
	}
	if !hasOurs {
		return "", v.writeAndAdd(ctx, u.rel, blobs[stageTheirs])
	}
	if merged, ok := mergeConflictContent(u.rel, blobs); ok {
		return "", v.writeAndAdd(ctx, u.rel, merged)
	}
	if err := v.writeAndAdd(ctx, u.rel, blobs[stageOurs]); err != nil {
		return "", err
	}
	copyRel := ConflictsDir + "/" + u.rel
	return copyRel, v.writeAndAdd(ctx, copyRel, blobs[stageTheirs])
}

// mergeConflictContent merges the files sync knows how to merge; false means apply the general rule.
func mergeConflictContent(rel string, blobs map[int][]byte) ([]byte, bool) {
	var merged []byte
	var err error
	switch {
	case path.Dir(rel) == EffortsDir && path.Ext(rel) == ".json":
		merged, err = mergeEffortStages(blobs)
	case rel == SettingsSyncPath:
		merged, err = MergeSettings(blobs[stageBase], blobs[stageOurs], blobs[stageTheirs])
	default:
		return nil, false
	}
	if err != nil {
		log.Printf("wavevault: sync: cannot merge %s, keeping both copies: %v", rel, err)
		return nil, false
	}
	return merged, true
}

func mergeEffortStages(blobs map[int][]byte) ([]byte, error) {
	ours, err := ParseEffort(blobs[stageOurs])
	if err != nil {
		return nil, fmt.Errorf("ours: %w", err)
	}
	theirs, err := ParseEffort(blobs[stageTheirs])
	if err != nil {
		return nil, fmt.Errorf("theirs: %w", err)
	}
	var base *waveobj.Effort
	if b, ok := blobs[stageBase]; ok {
		if base, err = ParseEffort(b); err != nil {
			return nil, fmt.Errorf("base: %w", err)
		}
	}
	return MarshalEffort(MergeEffort(base, ours, theirs))
}

func (v *Vault) writeAndAdd(ctx context.Context, rel string, data []byte) error {
	p := filepath.Join(v.Root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(p, data, 0o644); err != nil {
		return err
	}
	_, err := v.syncGit(ctx, "--literal-pathspecs", "add", "--", rel)
	return err
}

// revParse resolves rev to a commit id; false when it does not exist (or HEAD is unborn).
func (v *Vault) revParse(ctx context.Context, rev string) (string, bool) {
	out, err := runGit(ctx, v.Root, "rev-parse", "--verify", "-q", rev+"^{commit}")
	return out, err == nil
}

func (v *Vault) syncGit(ctx context.Context, args ...string) ([]byte, error) {
	return runGitSync(ctx, v.Root, gitTimeout, args...)
}

func (v *Vault) syncGitNet(ctx context.Context, args ...string) ([]byte, error) {
	return runGitSync(ctx, v.Root, syncGitTimeout, args...)
}

func (v *Vault) hasOrigin(ctx context.Context) (bool, error) {
	out, err := v.syncGit(ctx, "remote")
	if err != nil {
		return false, err
	}
	return slices.Contains(strings.Fields(string(out)), syncRemote), nil
}

// RemoteURL is origin's URL, or "" when the vault has no origin (sync is off).
func (v *Vault) RemoteURL(ctx context.Context) (string, error) {
	has, err := v.hasOrigin(ctx)
	if err != nil || !has {
		return "", err
	}
	out, err := v.syncGit(ctx, "remote", "get-url", syncRemote)
	return strings.TrimSpace(string(out)), err
}

// SetRemote points origin at url, adding it if absent; "" removes origin, turning sync off.
func (v *Vault) SetRemote(ctx context.Context, url string) error {
	url = strings.TrimSpace(url)
	if strings.HasPrefix(url, "-") {
		return fmt.Errorf("invalid vault remote url %q", url) // git would parse it as an option
	}
	has, err := v.hasOrigin(ctx)
	if err != nil {
		return err
	}
	switch {
	case url == "" && !has:
		return nil
	case url == "":
		_, err = v.syncGit(ctx, "remote", "remove", syncRemote)
	case has:
		_, err = v.syncGit(ctx, "remote", "set-url", syncRemote, url)
	default:
		_, err = v.syncGit(ctx, "remote", "add", syncRemote, url)
	}
	return err
}

// ConflictCopies lists the vault-relative files under conflicts/, sorted.
func (v *Vault) ConflictCopies() ([]string, error) {
	var copies []string
	err := filepath.WalkDir(filepath.Join(v.Root, ConflictsDir), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(v.Root, p)
		if err != nil {
			return err
		}
		copies = append(copies, filepath.ToSlash(rel))
		return nil
	})
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	slices.Sort(copies)
	return copies, err
}

// MalformedEfforts lists the vault-relative efforts/*.json files ParseEffort rejects, sorted.
func (v *Vault) MalformedEfforts() ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(v.Root, EffortsDir))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var bad []string
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(v.Root, EffortsDir, e.Name()))
		if err != nil {
			return nil, err
		}
		if _, err := ParseEffort(b); err != nil {
			bad = append(bad, EffortsDir+"/"+e.Name())
		}
	}
	return bad, nil
}
