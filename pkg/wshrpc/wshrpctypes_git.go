// pkg/wshrpc/wshrpctypes_git.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/gitinfo"
)

// GitCommands is the repo-first read domain: commit history and ref comparison. The older
// GitChangesCommand / GitRevertCommand live in ProjectCommands and stay there.
type GitCommands interface {
	GitHistoryCommand(ctx context.Context, data CommandGitHistoryData) (*CommandGitHistoryRtnData, error)
	GitDivergenceCommand(ctx context.Context, data CommandGitDivergenceData) (*CommandGitDivergenceRtnData, error)
	GitCommitChangesCommand(ctx context.Context, data CommandGitCommitChangesData) (*CommandGitCommitChangesRtnData, error)
	GitCompareChangesCommand(ctx context.Context, data CommandGitCompareChangesData) (*CommandGitCompareChangesRtnData, error)
	GitListFilesCommand(ctx context.Context, data CommandGitListFilesData) (*CommandGitListFilesRtnData, error)
	GitListIgnoredDirCommand(ctx context.Context, data CommandGitListIgnoredDirData) (*CommandGitListIgnoredDirRtnData, error)
	GitListWorktreesCommand(ctx context.Context, data CommandGitListWorktreesData) (*CommandGitListWorktreesRtnData, error)
	GitGrepCommand(ctx context.Context, data CommandGitGrepData) (*CommandGitGrepRtnData, error)
	GitFileAtRefCommand(ctx context.Context, data CommandGitFileAtRefData) (*CommandGitFileAtRefRtnData, error)
	GitReviewPatchCommand(ctx context.Context, data CommandGitReviewPatchData) (*CommandGitReviewPatchRtnData, error)
	GitFetchCommand(ctx context.Context, data CommandGitFetchData) (*CommandGitFetchRtnData, error)
}

type CommandGitHistoryData struct {
	Cwd string `json:"cwd"`
	// Ref is a revision or range; "" walks all refs. Skip/Limit paginate. Author/Grep/Path filter.
	Ref    string `json:"ref,omitempty"`
	Skip   int    `json:"skip,omitempty"`
	Limit  int    `json:"limit,omitempty"`
	Author string `json:"author,omitempty"`
	Grep   string `json:"grep,omitempty"`
	Path   string `json:"path,omitempty"`
}

type CommandGitHistoryRtnData struct {
	Commits []gitinfo.HistoryCommit `json:"commits"`
	Head    string                  `json:"head"`
	IsRepo  bool                    `json:"isrepo"`
	// Set when the directory is a work tree but the log read failed. IsRepo:false and a populated
	// Failure are different states and the surface draws a different panel for each.
	Failure *gitinfo.GitFailure `json:"failure,omitempty"`
}

type CommandGitDivergenceData struct {
	Cwd  string `json:"cwd"`
	Base string `json:"base"`
	Head string `json:"head"`
}

type CommandGitDivergenceRtnData struct {
	Ahead       []gitinfo.HistoryCommit `json:"ahead"`
	Behind      []gitinfo.HistoryCommit `json:"behind"`
	MergeBase   string                  `json:"mergebase"`
	MergeBaseTs int64                   `json:"mergebasets"`
	IsRepo      bool                    `json:"isrepo"`
}

type CommandGitCommitChangesData struct {
	Cwd  string `json:"cwd"`
	Hash string `json:"hash"`
}

// Mirrors CommandGitChangesRtnData minus Branch and Ref, which are properties of the working-tree
// view and meaningless for a single commit.
type CommandGitCommitChangesRtnData struct {
	StatusZ string `json:"statusz"`
	Numstat string `json:"numstat"`
	IsRepo  bool   `json:"isrepo"`
}

type CommandGitCompareChangesData struct {
	Cwd  string `json:"cwd"`
	Base string `json:"base"`
	Head string `json:"head"`
	// Tips selects the two-dot range form: the full difference between the two tips, with base's
	// own commits folded in as reverse changes. Default false is the three-dot form, which is the
	// only one whose file list matches the N-ahead commit list beside it.
	Tips bool `json:"tips,omitempty"`
}

// Mirrors CommandGitCommitChangesRtnData: an aggregate is a change set like any other, so one
// frontend parser (parseGitChanges) serves the working tree, a single commit, and a two-ref range.
type CommandGitCompareChangesRtnData struct {
	StatusZ string `json:"statusz"`
	Numstat string `json:"numstat"`
	IsRepo  bool   `json:"isrepo"`
}

type CommandGitListFilesData struct {
	Cwd string `json:"cwd"`
}

// Files are repo-relative, forward-slashed, sorted. Truncated reports that the repo exceeded the
// server's cap and Files is a prefix, so the finder can say so instead of implying completeness.
//
// Ignored is what .gitignore excludes, for the tree to show dimmed: a directory ignored as a whole is one
// entry ending in "/", listed on demand by GitListIgnoredDirCommand.
type CommandGitListFilesRtnData struct {
	Files     []string `json:"files"`
	Ignored   []string `json:"ignored,omitempty"`
	IsRepo    bool     `json:"isrepo"`
	Truncated bool     `json:"truncated,omitempty"`
}

// Dir is repo-relative; the reply lists its entries one level deep, a directory ending in "/".
type CommandGitListIgnoredDirData struct {
	Cwd string `json:"cwd"`
	Dir string `json:"dir"`
}

type CommandGitListIgnoredDirRtnData struct {
	Entries []string `json:"entries"`
}

type CommandGitListWorktreesData struct {
	Cwd string `json:"cwd"`
}

type GitWorktree struct {
	Path   string `json:"path"`
	Branch string `json:"branch,omitempty"` // empty when detached
	IsMain bool   `json:"ismain,omitempty"`
}

// Worktrees is main first and empty when cwd is not a repository.
type CommandGitListWorktreesRtnData struct {
	Worktrees []GitWorktree `json:"worktrees"`
}

// Include and Exclude are git pathspecs, so the filter runs inside git and before the match cap.
type CommandGitGrepData struct {
	Cwd           string   `json:"cwd"`
	Query         string   `json:"query"`
	Regex         bool     `json:"regex,omitempty"`
	WholeWord     bool     `json:"wholeword,omitempty"`
	CaseSensitive bool     `json:"casesensitive,omitempty"`
	Include       []string `json:"include,omitempty"`
	Exclude       []string `json:"exclude,omitempty"`
}

// Unlike the change-list and diff commands, which hand raw git output across the wire for one
// frontend parser to split, grep returns already-parsed matches — the mixed NUL-and-newline record
// format is the parsing Go already does for ls-files, the match cap has to be applied server-side
// regardless, and there is no second caller to share a TypeScript parser with.
type CommandGitGrepRtnData struct {
	Matches        []GitGrepMatch `json:"matches"`
	Truncated      bool           `json:"truncated,omitempty"`
	InvalidPattern bool           `json:"invalidpattern,omitempty"`
}

type GitGrepMatch struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

type CommandGitFileAtRefData struct {
	Cwd  string `json:"cwd"`
	Ref  string `json:"ref"`
	Path string `json:"path"`
	// MaxBytes refuses a blob larger than this without reading it. 0 = no cap.
	MaxBytes int64 `json:"maxbytes,omitempty"`
}

// Mirrors gitinfo.FileContent one field for one field: Binary, Missing and TooLarge are answers the
// caller renders, not errors, so each is a flag rather than an RPC failure.
type CommandGitFileAtRefRtnData struct {
	Content  string `json:"content"`
	Binary   bool   `json:"binary,omitempty"`
	Missing  bool   `json:"missing,omitempty"`
	TooLarge bool   `json:"toolarge,omitempty"`
	Size     int64  `json:"size,omitempty"`
	IsRepo   bool   `json:"isrepo"`
}

type CommandGitReviewPatchData struct {
	Cwd      string `json:"cwd"`
	Hash     string `json:"hash,omitempty"` // "" = the working tree against Base, untracked files included
	Base     string `json:"base,omitempty"` // "" = HEAD; ignored with a Hash
	MaxBytes int64  `json:"maxbytes"`       // per file
}

// The Diff surface's Review mode: every changed file of a selection, each with its own full-context
// patch (or an untracked file's text), sorted by path.
type CommandGitReviewPatchRtnData struct {
	IsRepo bool                      `json:"isrepo"`
	Files  []gitinfo.ReviewPatchFile `json:"files"`
}

type CommandGitFetchData struct {
	Cwd string `json:"cwd"`
	// "" defaults to origin.
	Remote string `json:"remote,omitempty"`
}

// A fetch can take far longer than the default RPC budget, and the budget the client sends binds the
// server's context too — so a caller must raise opts.timeout past gitinfo's own fetchTimeout or the
// read is cancelled underneath it.
type CommandGitFetchRtnData struct {
	FetchedAt int64 `json:"fetchedat"`
	// A missing remote or a credential prompt is a state the surface draws, not an RPC error: the
	// shipped GitFailure panel renders git's own stderr out of this.
	Failure *gitinfo.GitFailure `json:"failure,omitempty"`
	IsRepo  bool                `json:"isrepo"`
}
