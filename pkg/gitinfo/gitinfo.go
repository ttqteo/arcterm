// pkg/gitinfo/gitinfo.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package gitinfo runs git queries for the Files cockpit surface and creates worktrees for the
// New Agent launcher. It shells out to the git binary (no go-git dependency) using fixed
// subcommands in a given working dir.
package gitinfo

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const gitTimeout = 10 * time.Second

type Changes struct {
	Branch  string
	StatusZ string
	Numstat string
	IsRepo  bool
	// The commit HEAD points at, or "" in a repository with no commits yet. Carried here rather than
	// asked for separately because the Diff surface polls this read on a timer: a commit landing under
	// the open surface has to be noticeable, and comparing one sha is what lets the surface re-read the
	// log only when the log has actually changed.
	Head string
}

// quotePath off: without -z, git octal-escapes a non-ASCII path ("t\303\252n.txt") in numstat, so its
// row never matched the raw path `status -z` prints and the file read as uncounted.
func run(ctx context.Context, cwd string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-c", "core.quotePath=false", "-C", cwd}, args...)...)
	out, err := cmd.Output()
	return string(out), err
}

func GetChanges(ctx context.Context, cwd, ref string) (*Changes, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &Changes{IsRepo: false}, nil
	}
	branch, _ := run(ctx, cwd, "rev-parse", "--abbrev-ref", "HEAD")
	// A repository with no commits has no HEAD, which is not a failure of this read — every file there
	// is untracked and the change list is still the answer. The error has to be checked rather than
	// discarded: rev-parse echoes the unresolved argument ("HEAD") on stdout before exiting non-zero,
	// so ignoring it stores the literal string as if it were a sha.
	head := ""
	if out, herr := run(ctx, cwd, "rev-parse", "HEAD"); herr == nil {
		head = strings.TrimSpace(out)
	}
	// cwd's path within the repo (e.g. "services/foo/"), empty when cwd is the repo root. When cwd is
	// a subdirectory — a microservice inside a monorepo — this scopes the surface to cwd's subtree and
	// makes every path cwd-relative, so a path fed back as a `git -C cwd` pathspec
	// resolves. Without it, `status` prints repo-root-relative paths that don't round-trip.
	prefix, _ := run(ctx, cwd, "rev-parse", "--show-prefix")
	prefix = strings.TrimSpace(prefix)
	// `-- .` scopes to cwd's subtree; status has no --relative, so we strip the prefix ourselves below.
	// `-uall` lists untracked files individually instead of collapsing a wholly-new directory into one
	// "dir/" entry — that collapsed row can't be diffed (a directory has no file content to diff) and
	// wedges the Files pane, so we expand it at the source. status drives untracked detection in both modes.
	statusZ, err := run(ctx, cwd, "status", "--porcelain=v1", "-z", "-uall", "--", ".")
	if err != nil {
		return nil, err
	}
	statusZ = stripPrefixZ(statusZ, prefix)
	if ref == "" {
		// live mode (unchanged): working tree vs HEAD, plus synthetic rows for untracked files.
		// --relative scopes to cwd and prints cwd-relative paths, matching the stripped status above.
		// `diff --numstat HEAD` errors on a repo with no commits yet; status is still meaningful.
		numstat, _ := run(ctx, cwd, "diff", "--numstat", "--relative", "HEAD")
		// git diff omits untracked files (nothing in HEAD/index to diff), so a new file would show +0.
		// Append synthetic numstat rows for untracked files so their added lines count in the totals.
		numstat += untrackedNumstat(cwd, statusZ)
		return &Changes{Branch: strings.TrimSpace(branch), StatusZ: statusZ, Numstat: numstat, IsRepo: true, Head: head}, nil
	}
	// ref mode: tracked changes come from the base diff (committed + uncommitted); untracked files
	// are not in the base, so their ?? rows are carried over from status verbatim.
	nameStatus, _ := run(ctx, cwd, "diff", "--name-status", "-z", "--relative", ref)
	trackedZ := nameStatusToStatusZ(nameStatus)
	untrackedZ := untrackedEntriesZ(statusZ)
	numstat, _ := run(ctx, cwd, "diff", "--numstat", "--relative", ref)
	numstat += untrackedNumstat(cwd, untrackedZ)
	return &Changes{Branch: strings.TrimSpace(branch), StatusZ: trackedZ + untrackedZ, Numstat: numstat, IsRepo: true, Head: head}, nil
}

// GetRangeChanges computes the per-file changes introduced by the commit range base..end — the commits
// reachable from end but not base — as name-status + numstat. Unlike GetChanges it never consults the
// working tree or untracked files, so a run's evidence reflects exactly the commits it produced, immune
// to whatever else landed on the shared working tree (the delegator fan-out over-attribution). Paths are
// cwd-relative (--relative), matching GetChanges. Returns IsRepo=false when cwd is not a repo; errors on
// a git failure (e.g. an unresolvable end SHA) so the caller can fall back.
func GetRangeChanges(ctx context.Context, cwd, base, end string) (*Changes, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &Changes{IsRepo: false}, nil
	}
	rangeSpec := base + ".." + end
	nameStatus, err := run(ctx, cwd, "diff", "--name-status", "-z", "--relative", rangeSpec)
	if err != nil {
		return nil, err
	}
	numstat, err := run(ctx, cwd, "diff", "--numstat", "--relative", rangeSpec)
	if err != nil {
		return nil, err
	}
	return &Changes{StatusZ: nameStatusToStatusZ(nameStatus), Numstat: numstat, IsRepo: true}, nil
}

// GetTrailerCommitsChanges is GetRangeChanges narrowed to the commits in from..to whose trailerKey
// trailer has a value match accepts. On a checkout shared with other sessions the range interleaves their
// commits with the ones being measured, and a trailer is the only mark that tells them apart. Counts are
// summed per path over the kept commits (each measured against its first parent), and a path touched
// twice takes the status of its last commit. The timeout is per commit: a long run keeps many commits,
// and running out of time here fails the whole read.
func GetTrailerCommitsChanges(ctx context.Context, cwd, from, to, trailerKey string, match func(string) bool) (*Changes, error) {
	logCtx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(logCtx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &Changes{IsRepo: false}, nil
	}
	out, err := run(logCtx, cwd, "log", "--reverse", "--format=%H%x00%P%x00%(trailers:key="+trailerKey+",valueonly)%x1e", from+".."+to)
	if err != nil {
		return nil, err
	}
	type count struct{ add, del int }
	var order []string
	counts := map[string]*count{}
	status := map[string]byte{}
	for _, rec := range strings.Split(out, "\x1e") {
		fields := strings.Split(strings.TrimSpace(rec), "\x00")
		if len(fields) != 3 || !anyLineMatches(fields[2], match) {
			continue
		}
		parent := emptyTreeHash
		if parents := strings.Fields(fields[1]); len(parents) > 0 {
			parent = parents[0]
		}
		nameStatus, numstat, err := commitDiffs(ctx, cwd, parent, fields[0])
		if err != nil {
			return nil, err
		}
		for _, entry := range strings.Split(nameStatusToStatusZ(nameStatus), "\x00") {
			if len(entry) > 3 {
				status[entry[3:]] = entry[0]
			}
		}
		toks := strings.Split(numstat, "\x00")
		for i := 0; i < len(toks); i++ {
			cols := strings.SplitN(toks[i], "\t", 3)
			if len(cols) != 3 {
				continue
			}
			path := cols[2]
			if path == "" { // a rename: "add\tdel\t" \0 old \0 new
				if i+2 >= len(toks) {
					break
				}
				path = toks[i+2]
				i += 2
			}
			c := counts[path]
			if c == nil {
				c = &count{}
				counts[path] = c
				order = append(order, path)
			}
			add, _ := strconv.Atoi(cols[0]) // "-" (binary) -> 0
			del, _ := strconv.Atoi(cols[1])
			c.add += add
			c.del += del
		}
	}
	var statusZ, numstat strings.Builder
	for _, path := range order {
		if letter, ok := status[path]; ok {
			fmt.Fprintf(&statusZ, "%c  %s\x00", letter, path)
		}
		fmt.Fprintf(&numstat, "%d\t%d\t%s\n", counts[path].add, counts[path].del, path)
	}
	return &Changes{StatusZ: statusZ.String(), Numstat: numstat.String(), IsRepo: true}, nil
}

func anyLineMatches(values string, match func(string) bool) bool {
	for _, v := range strings.Split(values, "\n") {
		if v = strings.TrimSpace(v); v != "" && match(v) {
			return true
		}
	}
	return false
}

// commitDiffs returns one commit's name-status and numstat against parent, both -z.
func commitDiffs(ctx context.Context, cwd, parent, hash string) (string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	nameStatus, err := run(ctx, cwd, "diff", "--name-status", "-z", "--relative", parent, hash)
	if err != nil {
		return "", "", err
	}
	numstat, err := run(ctx, cwd, "diff", "--numstat", "-z", "--relative", parent, hash)
	if err != nil {
		return "", "", err
	}
	return nameStatus, numstat, nil
}

// RangeCommit is one commit in a base..end range: its SHA, author time (UnixMilli), and subject line.
type RangeCommit struct {
	Hash    string
	Ts      int64
	Subject string
}

// RangeLog returns the commits reachable from end but not base, newest first, for identifier matching
// (layer 2). Unlike GetRangeChanges it yields commit subjects/SHAs, which git diff cannot. Uses a unit
// separator (\x1f) between fields so subjects containing spaces parse cleanly. Empty range → empty slice.
func RangeLog(ctx context.Context, cwd, base, end string) ([]RangeCommit, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	out, err := run(ctx, cwd, "log", "--pretty=format:%H%x1f%ct%x1f%s", base+".."+end)
	if err != nil {
		return nil, err
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return nil, nil
	}
	var commits []RangeCommit
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, "\x1f", 3)
		if len(parts) != 3 {
			continue
		}
		secs, _ := strconv.ParseInt(parts[1], 10, 64)
		commits = append(commits, RangeCommit{Hash: parts[0], Ts: secs * 1000, Subject: parts[2]})
	}
	return commits, nil
}

// nameStatusToStatusZ converts `git diff --name-status -z` output into the porcelain -z entries
// ("X  path\0") that parseStatusZ (TS) and parseNumstatStatus (Go) already consume. Rename/copy
// (R/C) collapse to "M" on the new path, so no extra source-path field is emitted (the parsers only
// consume a source field when the status letter is R/C).
func nameStatusToStatusZ(nameStatus string) string {
	toks := strings.Split(nameStatus, "\x00")
	var b strings.Builder
	for i := 0; i < len(toks); i++ {
		st := toks[i]
		if st == "" {
			continue
		}
		letter := st[0]
		var path string
		if letter == 'R' || letter == 'C' {
			if i+2 >= len(toks) { // Rxxx \0 old \0 new
				break
			}
			path = toks[i+2]
			i += 2
			letter = 'M'
		} else {
			if i+1 >= len(toks) {
				break
			}
			path = toks[i+1]
			i++
		}
		if path != "" {
			fmt.Fprintf(&b, "%c  %s\x00", letter, path)
		}
	}
	return b.String()
}

// untrackedEntriesZ keeps only the "??" rows of a porcelain -z blob (each re-terminated with NUL).
func untrackedEntriesZ(statusZ string) string {
	var b strings.Builder
	parts := strings.Split(statusZ, "\x00")
	for i := 0; i < len(parts); i++ {
		entry := parts[i]
		if len(entry) < 3 {
			continue
		}
		if entry[0] == 'R' || entry[0] == 'C' {
			i++ // skip the rename/copy source path
			continue
		}
		if entry[:2] == "??" {
			b.WriteString(entry)
			b.WriteByte(0)
		}
	}
	return b.String()
}

// HeadCommit returns the trimmed SHA of HEAD in cwd. Errors when cwd is not a repo or has no commits
// yet — callers treat that as "no baseline" and degrade gracefully.
func HeadCommit(ctx context.Context, cwd string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	out, err := run(ctx, cwd, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// CurrentBranch returns the branch checked out in cwd, or "" on a detached HEAD. Errors when cwd is not
// a repo or HEAD is unborn.
func CurrentBranch(ctx context.Context, cwd string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	out, err := run(ctx, cwd, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	if branch := strings.TrimSpace(out); branch != "HEAD" {
		return branch, nil
	}
	return "", nil
}

// CommitBefore resolves the commit that was HEAD at the given time — the newest first-parent commit
// on HEAD's history with committer-date at or before beforeUnixSec. It anchors an agent's live diff
// to its session start, so the diff reflects only that session's work (commits since start +
// uncommitted), not the branch's whole divergence. Returns "" (no error) when cwd is not a repo,
// HEAD is unborn, or no commit precedes the time (a brand-new session) — every caller treats "" as
// "fall back to the live working-tree-vs-HEAD diff".
func CommitBefore(ctx context.Context, cwd string, beforeUnixSec int64) (string, error) {
	if beforeUnixSec <= 0 {
		return "", nil
	}
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	before := time.Unix(beforeUnixSec, 0).UTC().Format(time.RFC3339)
	out, err := run(ctx, cwd, "rev-list", "-1", "--first-parent", "--before="+before, "HEAD")
	if err != nil {
		return "", nil // not a repo / unborn HEAD — no anchor
	}
	return strings.TrimSpace(out), nil
}

// stripPrefixZ rewrites a `status --porcelain -z` blob so its paths are relative to prefix (cwd's
// path within the repo, e.g. "services/foo/") to match `diff --relative` output. Entries are
// "XY <path>"; rename/copy entries carry an extra NUL-separated bare source path. A blank prefix
// (cwd is the repo root) returns the blob unchanged.
func stripPrefixZ(statusZ, prefix string) string {
	if prefix == "" {
		return statusZ
	}
	parts := strings.Split(statusZ, "\x00")
	for i := 0; i < len(parts); i++ {
		entry := parts[i]
		if len(entry) < 3 {
			continue
		}
		parts[i] = entry[:3] + strings.TrimPrefix(entry[3:], prefix)
		if entry[0] == 'R' || entry[0] == 'C' {
			i++ // the next field is the bare rename/copy source path
			if i < len(parts) {
				parts[i] = strings.TrimPrefix(parts[i], prefix)
			}
		}
	}
	return strings.Join(parts, "\x00")
}

const maxUntrackedScan = 5 << 20 // 5 MiB; beyond this, report "-" instead of scanning the whole file

// untrackedNumstat produces numstat-format rows ("<adds>\t0\t<path>\n") for the untracked files in a
// `git status --porcelain=v1 -z` listing, so brand-new files contribute their added lines to the
// Files-surface totals. Binary/oversized/unreadable files report "-" (git's convention); wholly
// untracked directories (porcelain collapses these to a trailing "/") are skipped — no file to count.
func untrackedNumstat(cwd, statusZ string) string {
	var b strings.Builder
	parts := strings.Split(statusZ, "\x00")
	for i := 0; i < len(parts); i++ {
		entry := parts[i]
		if len(entry) < 3 {
			continue
		}
		// rename/copy entries carry an extra NUL-separated source path — consume it to stay aligned
		if entry[0] == 'R' || entry[0] == 'C' {
			i++
			continue
		}
		if entry[:2] != "??" {
			continue
		}
		path := entry[3:]
		if path == "" || strings.HasSuffix(path, "/") {
			continue
		}
		fmt.Fprintf(&b, "%s\t0\t%s\n", untrackedAdds(filepath.Join(cwd, path)), path)
	}
	return b.String()
}

// untrackedAdds returns a numstat added-lines field for a new file: its line count for text, or "-"
// (git's binary marker) for binary, oversized, or unreadable files.
func untrackedAdds(full string) string {
	info, err := os.Stat(full)
	if err != nil || info.IsDir() || info.Size() > maxUntrackedScan {
		return "-"
	}
	content, err := os.ReadFile(full)
	if err != nil {
		return "-"
	}
	if len(content) == 0 {
		return "0"
	}
	if bytes.IndexByte(content, 0) >= 0 {
		return "-" // NUL byte -> binary, like git
	}
	lines := bytes.Count(content, []byte{'\n'})
	if !bytes.HasSuffix(content, []byte{'\n'}) {
		lines++ // a final line without a trailing newline still counts
	}
	return strconv.Itoa(lines)
}

type BranchInfo struct {
	Name   string
	Age    string // relative committer date, e.g. "2 hours ago"
	Remote bool
}

// ListBranches returns the branches of the repo at repoPath, most-recently-committed first.
// includeRemotes adds refs/remotes, which the compare ref picker wants and the New Agent launcher
// does not: a worktree cannot be created on a remote-tracking ref. origin/HEAD is filtered because
// it is a symbolic alias, not a branch anyone compares against. Returns an empty slice (no error)
// when repoPath is not a git repository, so the caller can degrade to free-text input.
func ListBranches(ctx context.Context, repoPath string, includeRemotes bool) ([]BranchInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, repoPath, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return nil, nil
	}
	// the full refname is asked for alongside the short one because that is what distinguishes a
	// remote from a local branch and what identifies origin/HEAD — %(refname:short) flattens both away.
	args := []string{"for-each-ref", "--sort=-committerdate",
		"--format=%(refname:short)\t%(committerdate:relative)\t%(refname)", "refs/heads"}
	if includeRemotes {
		args = append(args, "refs/remotes")
	}
	out, err := run(ctx, repoPath, args...)
	if err != nil {
		return nil, err
	}
	var branches []BranchInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 3 {
			continue
		}
		name, age, full := fields[0], fields[1], fields[2]
		if strings.HasSuffix(full, "/HEAD") {
			continue
		}
		branches = append(branches, BranchInfo{
			Name:   name,
			Age:    age,
			Remote: strings.HasPrefix(full, "refs/remotes/"),
		})
	}
	return branches, nil
}

// runErr is like run but captures stderr into the error (for write operations where the cause matters).
func runErr(ctx context.Context, cwd string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", cwd}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// flattenBranch makes a git ref safe for a filesystem path segment (feat/x -> feat-x).
func flattenBranch(branch string) string {
	return strings.ReplaceAll(branch, "/", "-")
}

// WorktreePath is the sibling-dir location for a worktree of branch off the repo at repoPath:
//
//	<parent>/<basename>-worktrees/<flattened-branch>
func WorktreePath(repoPath, branch string) string {
	return filepath.Join(filepath.Dir(repoPath), filepath.Base(repoPath)+"-worktrees", flattenBranch(branch))
}

// CreateWorktree creates (or reuses) a git worktree for branch off repoPath's current HEAD, in a
// sibling dir. If the worktree dir already exists it is reused; if the branch exists it is checked
// out, otherwise a new branch is created off HEAD. Returns the worktree path.
func CreateWorktree(ctx context.Context, repoPath, branch string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, repoPath, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return "", fmt.Errorf("not a git repository: %s", repoPath)
	}
	wt := WorktreePath(repoPath, branch)
	if _, statErr := os.Stat(wt); statErr == nil {
		return wt, nil // reuse existing worktree dir
	}
	if err := os.MkdirAll(filepath.Dir(wt), 0o755); err != nil {
		return "", err
	}
	_, brErr := run(ctx, repoPath, "rev-parse", "--verify", "refs/heads/"+branch)
	if brErr == nil {
		if _, err := runErr(ctx, repoPath, "worktree", "add", wt, branch); err != nil {
			return "", err
		}
	} else {
		if _, err := runErr(ctx, repoPath, "worktree", "add", wt, "-b", branch); err != nil {
			return "", err
		}
	}
	return wt, nil
}

// Worktree is one checkout of a repository.
type Worktree struct {
	Path   string
	Branch string // short name; empty when detached
	IsMain bool
	// filled only by WorktreeStatuses
	Head    string // short sha; "" in an unborn repository
	Changed int    // records in `git status --porcelain`, untracked included, a rename counted once
	Ahead   int    // commits on this checkout's HEAD not on the main checkout's branch
	Behind  int
	HasBase bool   // Ahead/Behind were computed: false for main, or when main is detached
	Error   string // this checkout's status read failed
}

// maxStatusInFlight bounds how many checkouts WorktreeStatuses reads at once; each costs two or three git
// processes, and a repo with many engine-run worktrees should not fork dozens of them together.
const maxStatusInFlight = 4

// WorktreeStatuses fills the status fields of each checkout in wts (as ListWorktrees returns them, main
// first) and returns them in the same order. A checkout whose read fails reports its own Error; the
// others are unaffected, so the call itself never fails.
func WorktreeStatuses(ctx context.Context, wts []Worktree) []Worktree {
	out := make([]Worktree, len(wts))
	copy(out, wts)
	mainBranch := ""
	if len(out) > 0 && out[0].IsMain {
		mainBranch = out[0].Branch
	}
	sem := make(chan struct{}, maxStatusInFlight)
	var wg sync.WaitGroup
	for i := range out {
		wg.Add(1)
		sem <- struct{}{}
		go func(wt *Worktree) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := worktreeStatus(ctx, wt, mainBranch); err != nil {
				wt.Error = err.Error()
			}
		}(&out[i])
	}
	wg.Wait()
	return out
}

// worktreeStatus reads one checkout's head, change count and, for a linked checkout, its divergence from
// mainBranch ("" skips it). The returned error carries git's own stderr.
func worktreeStatus(ctx context.Context, wt *Worktree, mainBranch string) error {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	statusArgs := []string{"status", "--porcelain", "-z"}
	statusZ, err := run(ctx, wt.Path, statusArgs...)
	if err != nil {
		return failureErr(statusArgs, err)
	}
	wt.Changed = countStatusRecords(statusZ)
	// -q --verify exits 1 with no output when HEAD is unborn, which is not a failure
	headArgs := []string{"rev-parse", "--short", "-q", "--verify", "HEAD"}
	head, err := run(ctx, wt.Path, headArgs...)
	if err != nil && exitCodeOf(err) != 1 {
		return failureErr(headArgs, err)
	}
	wt.Head = strings.TrimSpace(head)
	if wt.IsMain || mainBranch == "" || wt.Head == "" {
		return nil
	}
	revArgs := []string{"rev-list", "--left-right", "--count", mainBranch + "...HEAD"}
	counts, err := run(ctx, wt.Path, revArgs...)
	if err != nil {
		return failureErr(revArgs, err)
	}
	fields := strings.Fields(counts)
	if len(fields) != 2 {
		return fmt.Errorf("git %s: unexpected output %q", strings.Join(revArgs, " "), strings.TrimSpace(counts))
	}
	behind, errB := strconv.Atoi(fields[0])
	ahead, errA := strconv.Atoi(fields[1])
	if errB != nil || errA != nil {
		return fmt.Errorf("git %s: unexpected output %q", strings.Join(revArgs, " "), strings.TrimSpace(counts))
	}
	wt.Behind, wt.Ahead, wt.HasBase = behind, ahead, true
	return nil
}

// failureErr is a failed git read as one line: the command, then git's stderr (or the Go error).
func failureErr(args []string, err error) error {
	f := failureOf(args, err)
	return fmt.Errorf("%s: %s", f.Command, f.Stderr)
}

// countStatusRecords counts the entries of a `status --porcelain -z` blob. A rename or copy entry carries
// its source path as an extra NUL-separated field, which is skipped so the rename counts once.
func countStatusRecords(statusZ string) int {
	n := 0
	parts := strings.Split(statusZ, "\x00")
	for i := 0; i < len(parts); i++ {
		entry := parts[i]
		if len(entry) < 3 {
			continue
		}
		n++
		if entry[0] == 'R' || entry[0] == 'C' {
			i++
		}
	}
	return n
}

// ListWorktrees returns every checkout of the repository at cwd, main first, from whichever checkout
// cwd is. It returns an empty slice and no error when cwd is not a repository, the same posture
// ListBranches takes. A worktree whose directory is gone (git marks it prunable) is left out: there is
// nothing there to browse.
func ListWorktrees(ctx context.Context, cwd string) ([]Worktree, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return []Worktree{}, nil
	}
	out, err := run(ctx, cwd, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	worktrees := []Worktree{}
	// records are separated by a blank line, and the first record is always the main checkout
	for i, rec := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n\n") {
		wt := Worktree{IsMain: i == 0}
		prunable := false
		for _, line := range strings.Split(rec, "\n") {
			switch {
			case strings.HasPrefix(line, "worktree "):
				wt.Path = filepath.FromSlash(strings.TrimPrefix(line, "worktree "))
			case strings.HasPrefix(line, "branch "):
				wt.Branch = strings.TrimPrefix(strings.TrimPrefix(line, "branch "), "refs/heads/")
			case strings.HasPrefix(line, "prunable"):
				prunable = true
			}
		}
		if wt.Path != "" && !prunable {
			worktrees = append(worktrees, wt)
		}
	}
	return worktrees, nil
}

// defaultHistoryLimit bounds an unpaginated history read. A cockpit-sized page, not a whole repo:
// the surface pages as the user scrolls, and an unbounded log on a large repo blocks the RPC.
const defaultHistoryLimit = 200

// fieldSep / recordSep are git's own unit and record separators (%x1f / %x1e). Using an explicit
// record separator rather than relying on newlines keeps parsing correct even when a field's own
// content contains a newline.
const (
	fieldSep  = "\x1f"
	recordSep = "\x1e"
)

// HistoryCommit is one commit in a history walk. Parents are full SHAs in git's own order, so
// Parents[0] is the first parent — the lane a graph continues down. Refs are decoration entries as
// git prints them ("HEAD -> main", "origin/main", "tag: v0.9.4"), left unparsed for the frontend.
type HistoryCommit struct {
	Hash    string   `json:"hash"`
	Parents []string `json:"parents"`
	Author  string   `json:"author"`
	Email   string   `json:"email"`
	Ts      int64    `json:"ts"`
	Subject string   `json:"subject"`
	Refs    []string `json:"refs,omitempty"`
}

// HistoryOpts scopes a history walk. Zero value = the default-limit walk from HEAD across all refs.
type HistoryOpts struct {
	Ref    string // revision or range ("main", a SHA, "base..head"); "" = all refs
	Skip   int
	Limit  int // 0 => defaultHistoryLimit
	Author string
	Grep   string
	Path   string
}

// History is a page of commits plus the current HEAD, which the surface needs to anchor a synthetic
// working-tree row to the commit it sits on top of. Failure is set when the directory is a work tree
// but the log read failed: IsRepo:false and Failure:non-nil are deliberately different answers.
type History struct {
	Commits []HistoryCommit `json:"commits"`
	Head    string          `json:"head"`
	IsRepo  bool            `json:"isrepo"`
	Failure *GitFailure     `json:"failure,omitempty"`
}

// HistoryLog walks commit history newest-first with parent links and ref decoration. Unlike RangeLog
// (which answers "what commits are in this bounded base..end range") this is the paginated,
// filterable walk a history view scrolls through. --date-order keeps sibling branches interleaved by
// time rather than collapsing one branch at a time, which is what makes a lane graph readable.
func HistoryLog(ctx context.Context, cwd string, opts HistoryOpts) (*History, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &History{IsRepo: false}, nil
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = defaultHistoryLimit
	}
	// --decorate=full, not short: short prints a local branch "feature/x" and a remote branch
	// "origin/main" identically, so nothing downstream can tell a slashed local branch from a remote.
	// Full form carries the refs/heads/ | refs/remotes/ | refs/tags/ namespace, which classifyRef
	// (frontend historyrows.ts) keys off. Labels are stripped back to the short name there.
	args := []string{"log", "--date-order", "--no-color", "--decorate=full",
		// git's %x escapes rather than the raw bytes, so a failure's command reads cleanly in the panel
		"--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%D%x1f%s%x1e",
		"--max-count=" + strconv.Itoa(limit)}
	if opts.Skip > 0 {
		args = append(args, "--skip="+strconv.Itoa(opts.Skip))
	}
	if opts.Author != "" {
		args = append(args, "--author="+opts.Author)
	}
	if opts.Grep != "" {
		args = append(args, "--grep="+opts.Grep, "--regexp-ignore-case")
	}
	if opts.Ref != "" {
		args = append(args, opts.Ref)
	} else {
		args = append(args, "--all")
	}
	// a pathspec must come last, after the revision
	if opts.Path != "" {
		args = append(args, "--", opts.Path)
	}
	out, err := run(ctx, cwd, args...)
	if err != nil {
		// A repo with no commits yet is empty history, not a failed read — git log exits 128 there.
		// rev-parse --verify --quiet exits 1 for "no such ref" and 128 for a fatal error, so the exit
		// code discriminates an unborn branch without matching git's wording, which changes between
		// versions.
		if _, verr := run(ctx, cwd, "rev-parse", "--verify", "--quiet", "HEAD"); verr != nil && exitCodeOf(verr) == 1 {
			return &History{IsRepo: true}, nil
		}
		return &History{IsRepo: true, Failure: failureOf(args, err)}, nil
	}
	head, _ := run(ctx, cwd, "rev-parse", "HEAD")
	return &History{Commits: parseHistory(out), Head: strings.TrimSpace(head), IsRepo: true}, nil
}

func parseHistory(out string) []HistoryCommit {
	var commits []HistoryCommit
	for _, rec := range strings.Split(out, recordSep) {
		rec = strings.TrimLeft(rec, "\r\n")
		if strings.TrimSpace(rec) == "" {
			continue
		}
		f := strings.Split(rec, fieldSep)
		if len(f) < 7 {
			continue
		}
		secs, _ := strconv.ParseInt(strings.TrimSpace(f[4]), 10, 64)
		commits = append(commits, HistoryCommit{
			Hash:    f[0],
			Parents: strings.Fields(f[1]),
			Author:  f[2],
			Email:   f[3],
			Ts:      secs * 1000,
			Refs:    parseDecoration(f[5]),
			Subject: f[6],
		})
	}
	return commits
}

// parseDecoration splits git's %D decoration ("HEAD -> refs/heads/main, refs/remotes/origin/main,
// tag: refs/tags/v0.9.4") into its entries, left otherwise verbatim — including the refs/ namespace,
// which is what lets the frontend tell a remote branch from a slashed local one.
func parseDecoration(d string) []string {
	d = strings.TrimSpace(d)
	if d == "" {
		return nil
	}
	parts := strings.Split(d, ",")
	refs := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			refs = append(refs, p)
		}
	}
	return refs
}

// Divergence is the two-sided answer to "how do these refs differ": the commits reachable from head
// but not base, the reverse, and the commit they share. Ahead/Behind are named from head's point of
// view. Commit lists are newest-first, matching HistoryLog.
type Divergence struct {
	Ahead     []HistoryCommit `json:"ahead"`
	Behind    []HistoryCommit `json:"behind"`
	MergeBase string          `json:"mergebase"`
	// unix ms of the merge base's commit, the unit HistoryCommit.Ts uses; 0 when there is none
	MergeBaseTs int64 `json:"mergebasets"`
	IsRepo      bool  `json:"isrepo"`
}

// GetDivergence compares two refs. The per-side commit lists come from HistoryLog over the symmetric
// ranges, so each commit carries an author — the compare view shows one per row.
func GetDivergence(ctx context.Context, cwd, base, head string) (*Divergence, error) {
	ahead, err := HistoryLog(ctx, cwd, HistoryOpts{Ref: base + ".." + head})
	if err != nil {
		return nil, err
	}
	if !ahead.IsRepo {
		return &Divergence{IsRepo: false}, nil
	}
	behind, err := HistoryLog(ctx, cwd, HistoryOpts{Ref: head + ".." + base})
	if err != nil {
		return nil, err
	}
	mbCtx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	mb, err := run(mbCtx, cwd, "merge-base", base, head)
	if err != nil {
		return nil, err
	}
	mbHash := strings.TrimSpace(mb)
	var mbTs int64
	if mbHash != "" {
		out, err := run(mbCtx, cwd, "show", "-s", "--format=%ct", mbHash)
		if err != nil {
			return nil, err
		}
		secs, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("merge base %s commit time: %w", mbHash, err)
		}
		mbTs = secs * 1000
	}
	return &Divergence{
		Ahead:       ahead.Commits,
		Behind:      behind.Commits,
		MergeBase:   mbHash,
		MergeBaseTs: mbTs,
		IsRepo:      true,
	}, nil
}

// git's well-known empty-tree object. Diffing a root commit against it is how you get "everything
// this commit introduced" when there is no parent to measure against.
const emptyTreeHash = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// commitBase returns the ref a commit's own change should be measured against: its first parent, or
// the empty tree for a root commit. Merge commits deliberately use the first parent — "what did this
// merge bring in" is the conventional presentation, and a combined diff is unreadable in a file list.
func commitBase(ctx context.Context, cwd, hash string) (string, error) {
	out, err := run(ctx, cwd, "rev-list", "--parents", "-n", "1", hash)
	if err != nil {
		return "", err
	}
	fields := strings.Fields(strings.TrimSpace(out))
	if len(fields) < 2 {
		return emptyTreeHash, nil
	}
	return fields[1], nil
}

// CommitChanges lists the per-file changes one commit introduced, as name-status + numstat in the
// same shape GetChanges and GetRangeChanges produce. Unlike GetChanges it never consults the working
// tree, so selecting a commit in the history shows that commit and not "everything since it".
// Paths are cwd-relative (--relative), matching the rest of the package.
func CommitChanges(ctx context.Context, cwd, hash string) (*Changes, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &Changes{IsRepo: false}, nil
	}
	base, err := commitBase(ctx, cwd, hash)
	if err != nil {
		return nil, err
	}
	nameStatus, err := run(ctx, cwd, "diff", "--name-status", "-z", "--relative", base, hash)
	if err != nil {
		return nil, err
	}
	numstat, err := run(ctx, cwd, "diff", "--numstat", "--relative", base, hash)
	if err != nil {
		return nil, err
	}
	return &Changes{StatusZ: nameStatusToStatusZ(nameStatus), Numstat: numstat, IsRepo: true}, nil
}

// rangeSep picks the range form. Two dots is the full tip-to-tip difference; three dots is anchored
// at the merge base.
func rangeSep(tips bool) string {
	if tips {
		return ".."
	}
	return "..."
}

// CompareChanges returns the per-file changes head introduces relative to base, anchored at their
// merge base (three-dot). The two-dot form would fold in the base side's own commits inverted — their
// additions appearing as deletions — so the file list would match neither side of the compare column.
// Never consults the working tree. Paths are cwd-relative (--relative), matching the rest of the
// package, so parseGitChanges on the frontend handles this shape unchanged. IsRepo=false when cwd is
// not a repo; a git failure errors so the caller can name the ref that did not resolve.
//
// tips selects the two-dot form instead: the full difference between the two tips, base's own
// commits included as reverse changes. It answers "has base moved under me", which the merge-base
// form cannot, and it deliberately does not correspond to either commit column — the pane header
// names the active form so the two can never be confused.
func CompareChanges(ctx context.Context, cwd, base, head string, tips bool) (*Changes, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &Changes{IsRepo: false}, nil
	}
	spec := base + rangeSep(tips) + head
	nameStatus, err := run(ctx, cwd, "diff", "--name-status", "-z", "--relative", spec)
	if err != nil {
		return nil, err
	}
	numstat, err := run(ctx, cwd, "diff", "--numstat", "--relative", spec)
	if err != nil {
		return nil, err
	}
	return &Changes{StatusZ: nameStatusToStatusZ(nameStatus), Numstat: numstat, IsRepo: true}, nil
}

// FileContent is one file's content at one ref. Binary, Missing and TooLarge are states a caller
// draws rather than errors, because each is a normal thing to find at a ref: a blob that is not
// text, a file added since that ref, a file too big to be worth mounting an editor on.
type FileContent struct {
	Content  string `json:"content"`
	Binary   bool   `json:"binary"`
	Missing  bool   `json:"missing"`
	TooLarge bool   `json:"toolarge"`
	Size     int64  `json:"size"`
	IsRepo   bool   `json:"isrepo"`
}

// FileAtRef returns one file's full content at a ref. The path is cwd-relative like every other
// reader here, so the rev spec uses the "./" form: `<ref>:./<path>` resolves relative to cwd, while
// `<ref>:<path>` resolves from the repo root and silently misses in a subdirectory checkout.
// maxBytes caps the transport (0 = no cap) and the size is read from the blob header first, so an
// oversized file is refused without ever being read.
func FileAtRef(ctx context.Context, cwd, ref, path string, maxBytes int64) (*FileContent, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &FileContent{IsRepo: false}, nil
	}
	spec := ref + ":./" + path
	sizeOut, err := run(ctx, cwd, "cat-file", "-s", spec)
	if err != nil {
		// the blob does not exist at this ref: an add on one side, a delete on the other
		return &FileContent{IsRepo: true, Missing: true}, nil
	}
	size, err := strconv.ParseInt(strings.TrimSpace(sizeOut), 10, 64)
	if err != nil {
		return nil, fmt.Errorf("git cat-file -s %s: unparsable size %q", spec, strings.TrimSpace(sizeOut))
	}
	if maxBytes > 0 && size > maxBytes {
		return &FileContent{IsRepo: true, TooLarge: true, Size: size}, nil
	}
	out, err := run(ctx, cwd, "show", spec)
	if err != nil {
		return nil, err
	}
	if !utf8.ValidString(out) {
		return &FileContent{IsRepo: true, Binary: true, Size: size}, nil
	}
	return &FileContent{IsRepo: true, Content: out, Size: size}, nil
}

// ReviewPatchFile is one file of a selection's patch, in the shape the Diff surface's Review mode
// turns into rows (gitdiff.ts diffFileView). A tracked file carries its own unified patch; an
// untracked file has nothing to diff against, so it carries its text instead. TooLarge replaces
// either with the size, so an oversized file is drawn as such rather than as an empty diff.
type ReviewPatchFile struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldpath,omitempty"`
	Diff      string `json:"diff,omitempty"` // this file's unified patch, full context
	Untracked bool   `json:"untracked,omitempty"`
	Content   string `json:"content,omitempty"` // an untracked file's text
	TooLarge  bool   `json:"toolarge,omitempty"`
	Size      int64  `json:"size,omitempty"`
}

type ReviewPatchResult struct {
	IsRepo bool
	Files  []ReviewPatchFile // sorted by path, byte order
}

// reviewContext is the --unified width that makes every file's patch one hunk holding the whole file,
// so Review can unfold an unchanged run from text it already has. Far beyond any file under the cap,
// and far below the int range git doubles it in.
const reviewContext = 1 << 24

// ReviewPatch returns a selection's patch split per file, for the Diff surface's Review mode. With a
// hash it is that commit against its first parent (the root commit against the empty tree), as
// CommitChanges measures it; without one it is the working tree against base ("" = HEAD) plus each
// untracked file's text. git runs once for the whole diff, which is then split on its `diff --git`
// headers. Paths are cwd-relative and scoped to cwd's subtree (--relative), matching the file list
// GetChanges and CommitChanges produce, so every listed file names a section here. maxBytes caps each
// file's patch or content (0 = no cap). IsRepo=false when cwd is not a repo; a git failure errors.
func ReviewPatch(ctx context.Context, cwd, hash, base string, maxBytes int64) (*ReviewPatchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &ReviewPatchResult{IsRepo: false}, nil
	}
	var revs []string
	if hash != "" {
		parent, err := commitBase(ctx, cwd, hash)
		if err != nil {
			return nil, err
		}
		revs = []string{parent, hash}
	} else {
		if base == "" {
			base = "HEAD"
			// a repository with no commits has no HEAD; everything staged there is an addition
			if _, err := run(ctx, cwd, "rev-parse", "--verify", "--quiet", "HEAD"); err != nil {
				base = emptyTreeHash
			}
		}
		revs = []string{base}
	}
	// quotePath off and the prefixes pinned, so a user's diff.noprefix or diff.mnemonicPrefix cannot
	// change the headers the split reads paths from; ext-diff off so the text is git's own patch
	args := append([]string{"-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "-M",
		"--unified=" + strconv.Itoa(reviewContext), "--src-prefix=a/", "--dst-prefix=b/", "--relative"}, revs...)
	out, err := runErr(ctx, cwd, append(args, "--")...)
	if err != nil {
		return nil, err
	}
	files := splitPatch(out)
	for i := range files {
		if size := int64(len(files[i].Diff)); maxBytes > 0 && size > maxBytes {
			files[i].Diff, files[i].TooLarge, files[i].Size = "", true, size
		}
	}
	if hash == "" {
		// ls-files lists untracked paths relative to cwd and only under it, matching --relative above
		listed, err := runErr(ctx, cwd, "ls-files", "--others", "--exclude-standard", "-z")
		if err != nil {
			return nil, err
		}
		for _, p := range strings.Split(listed, "\x00") {
			if p == "" {
				continue
			}
			files = append(files, untrackedReviewFile(cwd, p, maxBytes))
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return &ReviewPatchResult{IsRepo: true, Files: files}, nil
}

// untrackedReviewFile reads one untracked file for Review, refusing it by size before reading it.
// An unreadable file (removed since it was listed) is sent with no text rather than failing the read.
func untrackedReviewFile(cwd, path string, maxBytes int64) ReviewPatchFile {
	f := ReviewPatchFile{Path: path, Untracked: true}
	full := filepath.Join(cwd, filepath.FromSlash(path))
	info, err := os.Stat(full)
	if err != nil {
		return f
	}
	if size := info.Size(); maxBytes > 0 && size > maxBytes {
		f.TooLarge, f.Size = true, size
		return f
	}
	if content, err := os.ReadFile(full); err == nil {
		f.Content = string(content)
	}
	return f
}

// splitPatch cuts a multi-file `git diff` into one ReviewPatchFile per `diff --git` header. Inside a
// patch every content line starts with ' ', '+', '-' or '\', so a line starting "diff --git " is
// always a header. The path comes from the rename lines when git detected a rename, else from the
// header, which names the same path twice.
func splitPatch(out string) []ReviewPatchFile {
	var files []ReviewPatchFile
	start := -1
	flush := func(end int) {
		if start >= 0 {
			files = append(files, patchFile(out[start:end]))
		}
	}
	for i := 0; i < len(out); {
		if strings.HasPrefix(out[i:], "diff --git ") {
			flush(i)
			start = i
		}
		nl := strings.IndexByte(out[i:], '\n')
		if nl < 0 {
			break
		}
		i += nl + 1
	}
	flush(len(out))
	return files
}

func patchFile(diff string) ReviewPatchFile {
	f := ReviewPatchFile{Diff: diff}
	lines := strings.Split(diff, "\n")
	f.Path = headerPath(strings.TrimPrefix(lines[0], "diff --git "))
	for _, l := range lines[1:] {
		if strings.HasPrefix(l, "@@") || strings.HasPrefix(l, "--- ") || strings.HasPrefix(l, "Binary files ") {
			break // past the extended header
		}
		if from, ok := strings.CutPrefix(l, "rename from "); ok {
			f.OldPath = unquotePath(from)
		} else if to, ok := strings.CutPrefix(l, "rename to "); ok {
			f.Path = unquotePath(to)
		}
	}
	return f
}

// headerPath reads the b-side path of a `diff --git a/<p> b/<p>` header (the "diff --git " already
// cut). Unquoted, the two paths are the same, so the split is found by length: a path holding " b/"
// still parses. A rename's two paths differ; its header path is overridden by "rename to".
func headerPath(rest string) string {
	if strings.HasPrefix(rest, `"`) {
		// git quotes a path holding a quote, a backslash or a control character
		if first, err := strconv.QuotedPrefix(rest); err == nil {
			second := strings.TrimSpace(rest[len(first):])
			return strings.TrimPrefix(unquotePath(second), "b/")
		}
	}
	if n := (len(rest) - 5) / 2; n > 0 && len(rest) == 2*n+5 && rest[n+2:n+5] == " b/" && rest[2:n+2] == rest[n+5:] {
		return rest[n+5:]
	}
	if i := strings.LastIndex(rest, " b/"); i >= 0 {
		return unquotePath(rest[i+3:])
	}
	return rest
}

// unquotePath undoes git's C-style quoting (core.quotePath=false still quotes '"', '\' and control
// characters); Go's Unquote reads the same escapes, octal included.
func unquotePath(p string) string {
	if strings.HasPrefix(p, `"`) {
		if u, err := strconv.Unquote(p); err == nil {
			return u
		}
	}
	return p
}

// DefaultBranch resolves the repo's default branch as the ref the compare picker should open on:
// origin/<name> when the remote publishes origin/HEAD, else a probe of local main then master.
// Returns "" (not an error) when none resolve, so the base field just opens empty — the same
// degrade-quietly contract ListBranches uses for a non-repo.
//
// Remote-first is deliberate: the picker lists refs/remotes now, so a remote-tracking ref is
// offerable, and comparing against origin/main rather than a possibly-stale local main is what
// makes the default answer the review question correctly.
func DefaultBranch(ctx context.Context, cwd string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	if out, err := run(ctx, cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"); err == nil {
		if name := strings.TrimSpace(out); name != "" {
			return name, nil
		}
	}
	for _, probe := range []string{"main", "master"} {
		if _, err := run(ctx, cwd, "rev-parse", "--verify", "--quiet", probe); err == nil {
			return probe, nil
		}
	}
	return "", nil
}

// BranchBase resolves what the current branch is measured against for a whole-branch diff: the repo's
// default branch, preferring the local one (a worktree branch is cut from local main, which may be
// ahead of origin/main), and the merge base of it with HEAD. Both are "" when no default resolves or
// HEAD has no commits; that is not an error, the caller just has no branch view to offer.
func BranchBase(ctx context.Context, cwd string) (branch string, mergeBase string, err error) {
	def, err := DefaultBranch(ctx, cwd)
	if err != nil || def == "" {
		return "", "", err
	}
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	if local := strings.TrimPrefix(def, "origin/"); local != def {
		if _, lerr := run(ctx, cwd, "rev-parse", "--verify", "--quiet", local); lerr == nil {
			def = local
		}
	}
	mb, err := run(ctx, cwd, "merge-base", def, "HEAD")
	if err != nil {
		// unrelated histories or an unborn HEAD: no base to measure from
		return def, "", nil
	}
	return def, strings.TrimSpace(mb), nil
}

// A fetch talks to the network, so it gets its own budget: gitTimeout (10s) is a normal duration
// for one, not a symptom. The client raises its RPC timeout to match.
const fetchTimeout = 55 * time.Second

// FetchResult reports whether remote-tracking refs were updated. A git failure is data, not an
// error: a missing remote or a credential prompt is something the surface renders through the
// shipped GitFailure panel, with git's own stderr in it.
type FetchResult struct {
	FetchedAt int64       `json:"fetchedat"` // unix seconds, for the freshness clock
	Failure   *GitFailure `json:"failure,omitempty"`
	IsRepo    bool        `json:"isrepo"`
}

// Fetch updates remote-tracking refs. Never touches the working tree or any local branch, which is
// what keeps the Diff surface read-only from the repository's point of view.
func Fetch(ctx context.Context, cwd, remote string) (*FetchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &FetchResult{IsRepo: false}, nil
	}
	if remote == "" {
		remote = "origin"
	}
	// git fetch has no "--" terminator, so a remote name beginning with a dash would be parsed as an
	// option — and fetch has options that run commands (--upload-pack). The name arrives from the
	// surface, so it is refused here rather than trusted.
	if strings.HasPrefix(remote, "-") {
		return &FetchResult{IsRepo: true, Failure: &GitFailure{
			Command: "git fetch --prune " + remote,
			Stderr:  fmt.Sprintf("refusing to fetch from %q: a remote name cannot begin with '-'", remote),
		}}, nil
	}
	args := []string{"fetch", "--prune", remote}
	// run, not runErr: runErr folds git's output into its error text, which left failureOf no stderr
	// and the banner printing the command and "exit status 128" ahead of git's own message
	if _, err := run(ctx, cwd, args...); err != nil {
		return &FetchResult{IsRepo: true, Failure: failureOf(args, err)}, nil
	}
	return &FetchResult{IsRepo: true, FetchedAt: time.Now().Unix()}, nil
}

// GitFailure describes a git invocation that failed, in the shape the Diff surface's failure panel
// renders: the command as run, its exit code, and stderr verbatim. It exists so a failed read can be
// reported as data rather than as an RPC error — "this is not a repository" and "the read failed"
// are different screens, and an error string cannot carry the fields the second one shows.
type GitFailure struct {
	Command  string `json:"command"`
	ExitCode int    `json:"exitcode"`
	Stderr   string `json:"stderr"`
}

// exitCodeOf reports git's own exit status, or -1 when the failure was not an exit status at all
// (git missing from PATH, a context deadline). Callers discriminate on it: git uses 1 for "no such
// ref" and 128 for a fatal error, which is how HistoryLog tells an unborn branch from a real fault.
func exitCodeOf(err error) int {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

// failureOf turns the error run() already returns into a GitFailure. cmd.Output() populates
// ExitError.Stderr, so both the code and git's message are available without changing how git is
// invoked — and without CombinedOutput, which would fold stderr into the stdout callers parse.
func failureOf(args []string, err error) *GitFailure {
	f := &GitFailure{Command: "git " + strings.Join(args, " "), ExitCode: exitCodeOf(err)}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		f.Stderr = strings.TrimSpace(string(ee.Stderr))
	}
	if f.Stderr == "" && err != nil {
		f.Stderr = err.Error() // no stderr to show (git absent, deadline): the Go error is the evidence
	}
	return f
}

// maxListFiles caps the enumeration so a pathological repo cannot hand the frontend a
// multi-megabyte path array. Truncated tells the caller it happened, because a silently
// partial index reads as a complete one.
const maxListFiles = 20000

// maxIgnored caps the ignored entries the same way. They stay few in practice: a directory that is
// ignored as a whole is one entry, however much it holds.
const maxIgnored = 5000

// FileList is every path git knows about in cwd: tracked files plus untracked files that
// .gitignore does not exclude. Paths are repo-relative with forward slashes, sorted.
//
// Ignored is what .gitignore excludes, kept apart so the finder and search go on skipping it while the
// tree shows it dimmed. A directory ignored as a whole is one entry ending in "/" and its contents are
// listed only when it is opened (ListIgnoredDir); an ignored file inside a tracked directory is its
// own entry.
type FileList struct {
	Paths     []string `json:"paths"`
	Ignored   []string `json:"ignored"`
	IsRepo    bool     `json:"isrepo"`
	Truncated bool     `json:"truncated"`
}

// listFilesTimeout bounds ListFiles. --others walks the whole working tree, and the first walk of a
// big one on a cold disk cache takes well over gitTimeout (11s measured on a repo whose 0.2s warm walk
// is routine), so a slow listing here is a cold cache, not a hung git.
const listFilesTimeout = 45 * time.Second

// ListFiles enumerates cwd for the Code surface's tree and file finder. IsRepo=false when cwd is
// not a repository (not an error — it is an empty state); a git failure IS an error so the caller
// can tell "nothing to browse" from "the read failed".
func ListFiles(ctx context.Context, cwd string) (*FileList, error) {
	ctx, cancel := context.WithTimeout(ctx, listFilesTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &FileList{IsRepo: false}, nil
	}
	// -z: NUL-separated, so a path containing a space or non-ASCII byte survives unquoted.
	args := []string{"ls-files", "--cached", "--others", "--exclude-standard", "-z"}
	out, err := run(ctx, cwd, args...)
	if err != nil {
		// A deadline kill reaches us as the killed process's exit code — "exit status 1" on Windows,
		// where TerminateProcess sets it — so name the timeout, and otherwise git's own stderr.
		if ctx.Err() != nil {
			return nil, fmt.Errorf("git ls-files did not finish in time (%v): %w", ctx.Err(), err)
		}
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(bytes.TrimSpace(ee.Stderr)) > 0 {
			return nil, fmt.Errorf("%w: %s", err, bytes.TrimSpace(ee.Stderr))
		}
		return nil, err
	}
	paths := splitNul(out)
	// --cached and --others cannot overlap (others is untracked-only) but the concatenation is
	// not globally ordered, so sort for a stable tree.
	sort.Strings(paths)
	truncated := false
	if len(paths) > maxListFiles {
		paths = paths[:maxListFiles]
		truncated = true
	}
	// --directory stops at a directory ignored as a whole instead of walking it (node_modules is one
	// entry, not a hundred thousand). The tree is still usable without the ignored entries, so a
	// failure here leaves them out rather than failing the listing.
	ignored := []string{}
	if out, err := run(ctx, cwd, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"); err == nil {
		ignored = splitNul(out)
		sort.Strings(ignored)
		if len(ignored) > maxIgnored {
			ignored = ignored[:maxIgnored]
		}
	}
	return &FileList{Paths: paths, Ignored: ignored, IsRepo: true, Truncated: truncated}, nil
}

func splitNul(out string) []string {
	parts := []string{}
	for _, p := range strings.Split(out, "\x00") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	return parts
}

// ListIgnoredDir lists one level of an ignored directory for the tree, which opens those lazily (see
// FileList.Ignored): repo-relative paths with forward slashes, a directory ending in "/", sorted, at
// most maxIgnored. dir must stay inside cwd.
func ListIgnoredDir(cwd, dir string) ([]string, error) {
	rel := filepath.Clean(filepath.FromSlash(strings.TrimSuffix(dir, "/")))
	if rel == "." || filepath.IsAbs(rel) || filepath.VolumeName(rel) != "" || rel == ".." ||
		strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("directory %q is outside the project", dir)
	}
	entries, err := os.ReadDir(filepath.Join(cwd, rel))
	if err != nil {
		return nil, err
	}
	base := filepath.ToSlash(rel)
	out := []string{}
	for _, e := range entries {
		if e.Name() == ".git" {
			continue
		}
		p := base + "/" + e.Name()
		if e.IsDir() {
			p += "/"
		}
		out = append(out, p)
		if len(out) >= maxIgnored {
			break
		}
	}
	sort.Strings(out)
	return out, nil
}

const maxGrepMatches = 500

type GrepMatch struct {
	Path string
	Line int
	Text string
}

// GrepResult holds at most maxGrepMatches matches; Truncated reports that the scan stopped early.
// InvalidPattern reports a regex git could not compile — the user's typo, not a failed read.
type GrepResult struct {
	Matches        []GrepMatch
	Truncated      bool
	InvalidPattern bool
}

// GrepOpts are the flags the Code surface's search filters map onto. The zero value reproduces the
// original search exactly: a fixed, case-insensitive substring across the whole repository.
type GrepOpts struct {
	Regex         bool
	WholeWord     bool
	CaseSensitive bool
	Include       []string
	Exclude       []string
}

// Grep searches file contents in cwd for a string, or with opts.Regex a POSIX extended regex.
//
// --untracked is not optional: the Code surface builds its tree and its file finder from
// ls-files --cached --others --exclude-standard, and without the flag git grep would search only
// tracked files — so a newly created file would appear in the tree and never in search results.
// .gitignore is still honored either way.
//
// git grep exits 1 when nothing matched, which is not a failure, and 128 for a regex it cannot
// compile, which is reported as InvalidPattern. Every other exit 128 (not a repository) and
// everything else are failures.
func Grep(ctx context.Context, cwd, query string, opts GrepOpts) (*GrepResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return &GrepResult{}, nil // `git grep -e ""` matches every line of every file
	}
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	out, err := run(ctx, cwd, grepArgs(q, opts)...)
	if err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return nil, err
		}
		if opts.Regex && isInvalidPattern(ee, q) {
			return &GrepResult{Matches: []GrepMatch{}, InvalidPattern: true}, nil
		}
		if ee.ExitCode() != 1 {
			return nil, err
		}
	}
	matches := []GrepMatch{}
	truncated := false
	// -n -z prints "path\0line\0text"; the record itself still ends at a newline, so a path
	// containing a newline is not representable — the limit of git grep's output format.
	for _, rec := range strings.Split(out, "\n") {
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\x00", 3)
		if len(parts) < 3 {
			continue
		}
		n, convErr := strconv.Atoi(parts[1])
		if convErr != nil {
			continue
		}
		if len(matches) >= maxGrepMatches {
			truncated = true
			break
		}
		matches = append(matches, GrepMatch{
			Path: parts[0],
			Line: n,
			Text: strings.TrimSuffix(parts[2], "\r"), // Windows checkout: real files are CRLF
		})
	}
	return &GrepResult{Matches: matches, Truncated: truncated}, nil
}

// Pathspecs follow `--` so none can be read as a flag. They use git's default matching rather than
// :(glob), whose `*` stops at a slash and would turn `*.go` into "Go files at the top level only".
func grepArgs(q string, opts GrepOpts) []string {
	args := []string{"grep", "--untracked", "-n", "-z", "-I", "--no-color"}
	if !opts.CaseSensitive {
		args = append(args, "-i")
	}
	if opts.Regex {
		args = append(args, "-E")
	} else {
		args = append(args, "-F")
	}
	if opts.WholeWord {
		args = append(args, "-w")
	}
	args = append(args, "-e", q, "--")
	for _, p := range opts.Include {
		if p = strings.TrimSpace(p); p != "" {
			args = append(args, p)
		}
	}
	for _, p := range opts.Exclude {
		if p = strings.TrimSpace(p); p != "" {
			args = append(args, ":(exclude)"+p)
		}
	}
	return args
}

// git dies with "<origin>, '<pattern>': <regcomp error>" when a regex will not compile. The origin
// wording differs across versions ("command line", "-e option"), so the quoted pattern is what gets
// matched. The exit code alone cannot tell this apart from a missing repository.
func isInvalidPattern(ee *exec.ExitError, q string) bool {
	return ee.ExitCode() == 128 && strings.Contains(string(ee.Stderr), ", '"+q+"': ")
}
