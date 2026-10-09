// pkg/wshrpc/wshserver/wshserver_git.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) GitHistoryCommand(ctx context.Context, data wshrpc.CommandGitHistoryData) (*wshrpc.CommandGitHistoryRtnData, error) {
	h, err := gitinfo.HistoryLog(ctx, data.Cwd, gitinfo.HistoryOpts{
		Ref:    data.Ref,
		Skip:   data.Skip,
		Limit:  data.Limit,
		Author: data.Author,
		Grep:   data.Grep,
		Path:   data.Path,
	})
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitHistoryRtnData{Commits: h.Commits, Head: h.Head, IsRepo: h.IsRepo, Failure: h.Failure}, nil
}

func (ws *WshServer) GitDivergenceCommand(ctx context.Context, data wshrpc.CommandGitDivergenceData) (*wshrpc.CommandGitDivergenceRtnData, error) {
	d, err := gitinfo.GetDivergence(ctx, data.Cwd, data.Base, data.Head)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitDivergenceRtnData{
		Ahead: d.Ahead, Behind: d.Behind, MergeBase: d.MergeBase, MergeBaseTs: d.MergeBaseTs, IsRepo: d.IsRepo,
	}, nil
}

func (ws *WshServer) GitCommitChangesCommand(ctx context.Context, data wshrpc.CommandGitCommitChangesData) (*wshrpc.CommandGitCommitChangesRtnData, error) {
	ch, err := gitinfo.CommitChanges(ctx, data.Cwd, data.Hash)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitCommitChangesRtnData{StatusZ: ch.StatusZ, Numstat: ch.Numstat, IsRepo: ch.IsRepo}, nil
}

func (ws *WshServer) GitCompareChangesCommand(ctx context.Context, data wshrpc.CommandGitCompareChangesData) (*wshrpc.CommandGitCompareChangesRtnData, error) {
	ch, err := gitinfo.CompareChanges(ctx, data.Cwd, data.Base, data.Head, data.Tips)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitCompareChangesRtnData{StatusZ: ch.StatusZ, Numstat: ch.Numstat, IsRepo: ch.IsRepo}, nil
}

func (ws *WshServer) GitListFilesCommand(ctx context.Context, data wshrpc.CommandGitListFilesData) (*wshrpc.CommandGitListFilesRtnData, error) {
	fl, err := gitinfo.ListFiles(ctx, data.Cwd)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitListFilesRtnData{Files: fl.Paths, Ignored: fl.Ignored, IsRepo: fl.IsRepo, Truncated: fl.Truncated}, nil
}

func (ws *WshServer) GitListIgnoredDirCommand(ctx context.Context, data wshrpc.CommandGitListIgnoredDirData) (*wshrpc.CommandGitListIgnoredDirRtnData, error) {
	entries, err := gitinfo.ListIgnoredDir(data.Cwd, data.Dir)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitListIgnoredDirRtnData{Entries: entries}, nil
}

func (ws *WshServer) GitListWorktreesCommand(ctx context.Context, data wshrpc.CommandGitListWorktreesData) (*wshrpc.CommandGitListWorktreesRtnData, error) {
	wts, err := gitinfo.ListWorktrees(ctx, data.Cwd)
	if err != nil {
		return nil, err
	}
	if data.Status {
		wts = gitinfo.WorktreeStatuses(ctx, wts)
	}
	out := make([]wshrpc.GitWorktree, 0, len(wts))
	for _, wt := range wts {
		out = append(out, wshrpc.GitWorktree{
			Path: wt.Path, Branch: wt.Branch, IsMain: wt.IsMain,
			Head: wt.Head, Changed: wt.Changed, Ahead: wt.Ahead, Behind: wt.Behind, HasBase: wt.HasBase, Error: wt.Error,
		})
	}
	return &wshrpc.CommandGitListWorktreesRtnData{Worktrees: out}, nil
}

func (ws *WshServer) GitGrepCommand(ctx context.Context, data wshrpc.CommandGitGrepData) (*wshrpc.CommandGitGrepRtnData, error) {
	res, err := gitinfo.Grep(ctx, data.Cwd, data.Query, gitinfo.GrepOpts{
		Regex:         data.Regex,
		WholeWord:     data.WholeWord,
		CaseSensitive: data.CaseSensitive,
		Include:       data.Include,
		Exclude:       data.Exclude,
	})
	if err != nil {
		return nil, err
	}
	matches := make([]wshrpc.GitGrepMatch, 0, len(res.Matches))
	for _, m := range res.Matches {
		matches = append(matches, wshrpc.GitGrepMatch{Path: m.Path, Line: m.Line, Text: m.Text})
	}
	return &wshrpc.CommandGitGrepRtnData{
		Matches: matches, Truncated: res.Truncated, InvalidPattern: res.InvalidPattern,
	}, nil
}

func (ws *WshServer) GitFileAtRefCommand(ctx context.Context, data wshrpc.CommandGitFileAtRefData) (*wshrpc.CommandGitFileAtRefRtnData, error) {
	fc, err := gitinfo.FileAtRef(ctx, data.Cwd, data.Ref, data.Path, data.MaxBytes)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitFileAtRefRtnData{
		Content: fc.Content, Binary: fc.Binary, Missing: fc.Missing,
		TooLarge: fc.TooLarge, Size: fc.Size, IsRepo: fc.IsRepo,
	}, nil
}

func (ws *WshServer) GitReviewPatchCommand(ctx context.Context, data wshrpc.CommandGitReviewPatchData) (*wshrpc.CommandGitReviewPatchRtnData, error) {
	r, err := gitinfo.ReviewPatch(ctx, data.Cwd, data.Hash, data.Base, data.MaxBytes)
	if err != nil {
		return nil, err
	}
	files := r.Files
	if files == nil {
		files = []gitinfo.ReviewPatchFile{} // `files` is never null on the wire: a clean tree is an empty list
	}
	return &wshrpc.CommandGitReviewPatchRtnData{IsRepo: r.IsRepo, Files: files}, nil
}

func (ws *WshServer) GitFetchCommand(ctx context.Context, data wshrpc.CommandGitFetchData) (*wshrpc.CommandGitFetchRtnData, error) {
	r, err := gitinfo.Fetch(ctx, data.Cwd, data.Remote)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitFetchRtnData{FetchedAt: r.FetchedAt, Failure: r.Failure, IsRepo: r.IsRepo}, nil
}

func (ws *WshServer) GitCommitCommand(ctx context.Context, data wshrpc.CommandGitCommitData) (*wshrpc.CommandGitCommitRtnData, error) {
	r, err := gitinfo.Commit(ctx, data.Cwd, data.Message, data.Paths, data.Amend)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitCommitRtnData{Hash: r.Hash, Failure: r.Failure}, nil
}

func (ws *WshServer) GitCommitMessageCommand(ctx context.Context, data wshrpc.CommandGitCommitMessageData) (*wshrpc.CommandGitCommitMessageRtnData, error) {
	msg, err := gitinfo.CommitMessage(ctx, data.Cwd, data.Ref)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitCommitMessageRtnData{Message: msg}, nil
}

func (ws *WshServer) GitPullCommand(ctx context.Context, data wshrpc.CommandGitSyncData) (*wshrpc.CommandGitSyncRtnData, error) {
	r, err := gitinfo.Pull(ctx, data.Cwd)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitSyncRtnData{Moved: r.Moved, Branch: r.Branch, Failure: r.Failure}, nil
}

func (ws *WshServer) GitPushCommand(ctx context.Context, data wshrpc.CommandGitSyncData) (*wshrpc.CommandGitSyncRtnData, error) {
	r, err := gitinfo.Push(ctx, data.Cwd)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGitSyncRtnData{Moved: r.Moved, Branch: r.Branch, Failure: r.Failure}, nil
}
