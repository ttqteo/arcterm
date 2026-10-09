// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func (ws *WshServer) CreateProjectCommand(ctx context.Context, data wshrpc.CommandCreateProjectData) error {
	name := strings.TrimSpace(data.Name)
	if name == "" {
		return fmt.Errorf("project name is required")
	}
	path := strings.TrimSpace(data.Path)
	if path == "" {
		return fmt.Errorf("project path is required")
	}
	if strings.HasPrefix(path, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("cannot resolve home directory: %w", err)
		}
		path = filepath.Join(home, path[1:])
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("path does not exist: %s", path)
	}
	if !info.IsDir() {
		return fmt.Errorf("path is not a directory: %s", path)
	}
	// two names at one path leave the frontend's path->project resolution picking an arbitrary winner, so a
	// channel files under whichever registration happens to come first. Refuse the duplicate here rather
	// than teaching the resolver a tie-break for data that should not exist. Re-registering the same
	// project at its own path stays an update — the launcher does that on first launch.
	if other, ok := wconfig.ProjectNameAtPath(path); ok && other != name {
		return fmt.Errorf("path is already registered as project %q: %s", other, path)
	}
	if err := wconfig.SetProjectConfigValue(name, waveobj.MetaMapType{"path": path}); err != nil {
		return err
	}
	// the config watcher would make the channel too, but asynchronously; the caller refreshes its channel
	// list as soon as this returns and must find the new project's channel there
	if _, err := wstore.EnsureChannelAtPath(ctx, name, path); err != nil {
		return fmt.Errorf("registered project %q, but creating its channel failed: %w", name, err)
	}
	return nil
}

func (ws *WshServer) DeleteProjectCommand(ctx context.Context, data wshrpc.CommandDeleteProjectData) error {
	name := strings.TrimSpace(data.Name)
	if name == "" {
		return fmt.Errorf("project name is required")
	}
	return wconfig.DeleteProjectConfigValue(name)
}

func (ws *WshServer) CreateWorktreeCommand(ctx context.Context, data wshrpc.CommandCreateWorktreeData) (wshrpc.CommandCreateWorktreeRtnData, error) {
	wt, err := gitinfo.CreateWorktree(ctx, data.ProjectPath, data.Branch)
	if err != nil {
		return wshrpc.CommandCreateWorktreeRtnData{}, err
	}
	return wshrpc.CommandCreateWorktreeRtnData{WorktreePath: wt}, nil
}

func (ws *WshServer) ListBranchesCommand(ctx context.Context, data wshrpc.CommandListBranchesData) (wshrpc.CommandListBranchesRtnData, error) {
	branches, err := gitinfo.ListBranches(ctx, data.ProjectPath, data.IncludeRemotes)
	if err != nil {
		return wshrpc.CommandListBranchesRtnData{}, err
	}
	rtn := wshrpc.CommandListBranchesRtnData{Branches: make([]wshrpc.BranchInfo, 0, len(branches))}
	for _, b := range branches {
		rtn.Branches = append(rtn.Branches, wshrpc.BranchInfo{Name: b.Name, Age: b.Age, Remote: b.Remote})
	}
	// A repo with no resolvable default is not an error here — DefaultBranch returns "" and the
	// picker's base field just opens empty.
	rtn.Default, _ = gitinfo.DefaultBranch(ctx, data.ProjectPath)
	return rtn, nil
}

func (ws *WshServer) GitChangesCommand(ctx context.Context, data wshrpc.CommandGitChangesData) (*wshrpc.CommandGitChangesRtnData, error) {
	ref := data.Ref
	baseBranch := ""
	if data.BranchBase {
		// the whole branch: from where it left the default branch; no base degrades to the live HEAD diff.
		var mb string
		baseBranch, mb, _ = gitinfo.BranchBase(ctx, data.Cwd)
		if mb == "" {
			baseBranch = ""
		}
		ref = mb
	} else if data.SessionStartTs != 0 {
		// the commit that was HEAD when the agent's session began; "" degrades to the live HEAD diff.
		ref, _ = gitinfo.CommitBefore(ctx, data.Cwd, data.SessionStartTs)
	}
	ch, err := gitinfo.GetChanges(ctx, data.Cwd, ref)
	if err != nil {
		return nil, fmt.Errorf("git changes: %w", err)
	}
	return &wshrpc.CommandGitChangesRtnData{Branch: ch.Branch, StatusZ: ch.StatusZ, Numstat: ch.Numstat, IsRepo: ch.IsRepo, Ref: ref, Head: ch.Head, BaseBranch: baseBranch}, nil
}
