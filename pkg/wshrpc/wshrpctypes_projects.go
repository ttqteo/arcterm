// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type ProjectCommands interface {
	CreateProjectCommand(ctx context.Context, data CommandCreateProjectData) error
	DeleteProjectCommand(ctx context.Context, data CommandDeleteProjectData) error
	CreateWorktreeCommand(ctx context.Context, data CommandCreateWorktreeData) (CommandCreateWorktreeRtnData, error)
	ListBranchesCommand(ctx context.Context, data CommandListBranchesData) (CommandListBranchesRtnData, error)
	GitChangesCommand(ctx context.Context, data CommandGitChangesData) (*CommandGitChangesRtnData, error)
}

type CommandCreateProjectData struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type CommandDeleteProjectData struct {
	Name string `json:"name"`
}

type CommandCreateWorktreeData struct {
	ProjectPath string `json:"projectpath"`
	Branch      string `json:"branch"`
}

type CommandCreateWorktreeRtnData struct {
	WorktreePath string `json:"worktreepath"`
}

type CommandListBranchesData struct {
	ProjectPath string `json:"projectpath"`
	// The compare ref picker wants remote-tracking refs; the New Agent launcher must not offer
	// them, because a worktree cannot be created on one. Default false keeps that caller correct
	// without it having to know this field exists.
	IncludeRemotes bool `json:"includeremotes,omitempty"`
}

type CommandListBranchesRtnData struct {
	Branches []BranchInfo `json:"branches"`
	// The repo's default branch for the compare ref picker's base field — origin/<name> when the
	// remote publishes one, else a local main/master. Additive: the New Agent launcher calls this
	// command for its worktree-branch suggestions and ignores it.
	// "" when the repo publishes no origin/HEAD and has neither main nor master.
	Default string `json:"default,omitempty"`
}

type CommandGitChangesData struct {
	Cwd string `json:"cwd"`
	Ref string `json:"ref,omitempty"`
	// SessionStartTs, when set, asks the backend to resolve the base as the commit that was HEAD at
	// this unix-seconds time (an agent's session start), so the diff reflects only that session's work
	// (commits since start + uncommitted). Takes precedence over Ref; the resolved base is echoed in
	// the response's Ref. 0 = fall through to Ref / live HEAD diff.
	SessionStartTs int64 `json:"sessionstartts,omitempty"`
}

type CommandGitChangesRtnData struct {
	Branch  string `json:"branch"`
	StatusZ string `json:"statusz"`
	Numstat string `json:"numstat"`
	IsRepo  bool   `json:"isrepo"`
	// Ref is the commit the changes were diffed against ("" = live working-tree-vs-HEAD). The frontend
	// threads this into GitDiff so per-file diffs use the same base the list did.
	Ref string `json:"ref,omitempty"`
	// Head is the commit HEAD points at, "" in a repository with no commits. The Diff surface polls
	// this command while it is on screen and compares Head against the sha its commit column was
	// built from, so a commit landing under the surface costs one log re-read and a quiet tick costs
	// nothing.
	Head string `json:"head,omitempty"`
}
