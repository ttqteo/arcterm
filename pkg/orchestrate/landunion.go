// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// unionMergeFile is the project's list of files whose add-only conflicts a land resolves itself, and whose unstaged
// edits in the checkout it carries across its merge. It is read from the base branch, the side that landed first.
const unionMergeFile = ".arc/union-merge"

// unionPaths is the paths .arc/union-merge lists: one per line, # starts a comment, \ is read as /.
func unionPaths(content string) []string {
	var paths []string
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		paths = append(paths, strings.ReplaceAll(line, `\`, "/"))
	}
	return paths
}

// unionMergePaths is the base branch's committed .arc/union-merge list. No file, or one that cannot be read, lists
// nothing: the land then hands the conflict on as a real one.
func unionMergePaths(ctx context.Context, project, baseBranch string) []string {
	out, err := git(ctx, project, "show", "--no-textconv", baseBranch+":"+unionMergeFile)
	if err != nil {
		return nil
	}
	return unionPaths(out)
}

// The labels resolveAddOnlyFile gives merge-file; resolveAddOnly finds its blocks by them.
const (
	unionRunLabel    = "run"
	unionBaseLabel   = "base"
	unionLandedLabel = "landed"
)

// resolveAddOnly resolves the conflict blocks of a diff3 merge (labels run, base, landed) in which both sides only
// added lines, so the block's base part is empty: the landed lines come first, as they landed first, then the run's.
// A block whose base part holds a line is a real edit by one side and refuses the whole file.
func resolveAddOnly(merged string) (string, bool) {
	const (
		outside = iota
		inRun
		inBase
		inLanded
	)
	var out strings.Builder
	var runLines, landedLines []string
	state := outside
	for _, line := range strings.SplitAfter(merged, "\n") {
		// the markers take the file's line ending, so a CRLF file has CRLF markers
		text := strings.TrimRight(line, "\r\n")
		switch state {
		case outside:
			if text == "<<<<<<< "+unionRunLabel {
				state, runLines, landedLines = inRun, nil, nil
			} else {
				out.WriteString(line)
			}
		case inRun:
			if text == "||||||| "+unionBaseLabel {
				state = inBase
			} else {
				runLines = append(runLines, line)
			}
		case inBase:
			if text != "=======" {
				return "", false
			}
			state = inLanded
		case inLanded:
			switch text {
			case ">>>>>>> " + unionLandedLabel:
				out.WriteString(strings.Join(landedLines, ""))
				out.WriteString(strings.Join(runLines, ""))
				state = outside
			case "=======":
				// a base line of equals signs reads as the separator, so a second one is not told apart from
				// an added underline: the file is not trusted
				return "", false
			default:
				landedLines = append(landedLines, line)
			}
		}
	}
	if state != outside {
		return "", false
	}
	return out.String(), true
}

// resolveAddOnlyFile resolves path, unmerged in tree after merging the base into the run's branch, when both sides
// only added lines to it, writing the result and staging it. false with no error means the file is a real conflict,
// or not a text file both sides still have, and is left as git wrote it.
func resolveAddOnlyFile(ctx context.Context, tree, path string) (bool, error) {
	// :(literal): a file name with a glob character is not a pattern
	spec := ":(literal)" + path
	listing, err := git(ctx, tree, "ls-files", "-u", "--", spec)
	if err != nil {
		return false, err
	}
	stages := map[string]bool{}
	for _, line := range strings.Split(listing, "\n") {
		if fields := strings.Fields(line); len(fields) >= 3 {
			stages[fields[2]] = true
		}
	}
	// a file one side deleted has no stage 2 or 3; stage 1 is missing when both sides added the file
	if !stages["2"] || !stages["3"] {
		return false, nil
	}
	blobs := map[string][]byte{}
	for _, stage := range []string{"1", "2", "3"} {
		if stage == "1" && !stages["1"] {
			continue
		}
		blob, err := gitBlob(ctx, tree, ":"+stage+":"+path)
		if err != nil {
			return false, err
		}
		if bytes.IndexByte(blob, 0) >= 0 {
			return false, nil
		}
		blobs[stage] = blob
	}
	merged, err := mergeFileDiff3(ctx, tree, blobs["2"], blobs["1"], blobs["3"])
	if err != nil {
		return false, err
	}
	resolved, ok := resolveAddOnly(merged)
	if !ok {
		return false, nil
	}
	full := filepath.Join(tree, filepath.FromSlash(path))
	mode := os.FileMode(0o644)
	if info, err := os.Stat(full); err == nil {
		mode = info.Mode().Perm()
	}
	if err := os.WriteFile(full, []byte(resolved), mode); err != nil {
		return false, fmt.Errorf("writing %s: %w", path, err)
	}
	if _, err := git(ctx, tree, "add", "--", spec); err != nil {
		return false, err
	}
	return true, nil
}

// carriedEdit is the checkout's unstaged edit to a file .arc/union-merge lists, which the land takes across its merge
// instead of holding on it. The edit belongs to another session or the human, so the land sets it aside, merges, and
// puts it back on top of the merged file, unstaged, as stash and pop would; it carries only an edit that goes on top
// cleanly or by adding lines where the run added some too.
type carriedEdit struct {
	path string
	raw  []byte // the checkout's file byte for byte, written back if the merge fails
	mine []byte // the same as git stores it, the checkout's line endings undone
}

// carryableEdit is the checkout's unstaged edit to p when it goes on top of the run's version of p, else nil.
func carryableEdit(ctx context.Context, project, branch, p string) (*carriedEdit, error) {
	raw, err := os.ReadFile(filepath.Join(project, filepath.FromSlash(p)))
	if err != nil {
		// a deleted file is no edit to put on top of anything
		return nil, nil
	}
	// hash-object applies the checkout's filters, so a CRLF checkout of an LF file reads as git stores it; -w lets
	// gitBlob read the result back
	id, err := git(ctx, project, "hash-object", "-w", "--", p)
	if err != nil {
		return nil, err
	}
	c := &carriedEdit{path: p, raw: raw}
	if c.mine, err = gitBlob(ctx, project, id); err != nil {
		return nil, err
	}
	head, err := gitBlob(ctx, project, "HEAD:"+p)
	if err != nil {
		return nil, nil
	}
	landed, err := runVersion(ctx, project, branch, p)
	if err != nil || landed == nil {
		return nil, err
	}
	if out, err := c.onto(ctx, project, head, landed); err != nil || out == nil {
		return nil, err
	}
	return c, nil
}

// runVersion is p as the land's merge will leave it: the branch's when HEAD is in the branch, as after syncBase,
// else the add-only merge syncBase would make. nil when the branch deletes p or the merge is not add-only.
func runVersion(ctx context.Context, project, branch, p string) ([]byte, error) {
	run, err := gitBlob(ctx, project, branch+":"+p)
	if err != nil {
		return nil, nil
	}
	if _, err := git(ctx, project, "merge-base", "--is-ancestor", "HEAD", branch); err == nil {
		return run, nil
	}
	fork, err := git(ctx, project, "merge-base", "HEAD", branch)
	if err != nil {
		return nil, err
	}
	// a file both sides added has no base: an empty one
	base, _ := gitBlob(ctx, project, fork+":"+p)
	head, err := gitBlob(ctx, project, "HEAD:"+p)
	if err != nil {
		return nil, nil
	}
	merged, err := mergeFileDiff3(ctx, project, run, base, head)
	if err != nil {
		return nil, err
	}
	resolved, ok := resolveAddOnly(merged)
	if !ok {
		return nil, nil
	}
	return []byte(resolved), nil
}

// onto is the edit put on top of landed, the file the merge leaves, both taken against base, the file before it; nil
// when they neither merge cleanly nor only add lines at the same place. The run's lines come first, as they land
// first, then the edit's; the result takes the checkout's line endings.
func (c *carriedEdit) onto(ctx context.Context, dir string, base, landed []byte) ([]byte, error) {
	for _, b := range [][]byte{c.mine, base, landed} {
		if bytes.IndexByte(b, 0) >= 0 {
			return nil, nil
		}
	}
	merged, err := mergeFileDiff3(ctx, dir, c.mine, base, landed)
	if err != nil {
		return nil, err
	}
	resolved, ok := resolveAddOnly(merged)
	if !ok {
		return nil, nil
	}
	out := []byte(resolved)
	if bytes.Contains(c.raw, []byte("\r\n")) && !bytes.Contains(c.mine, []byte("\r\n")) {
		out = bytes.ReplaceAll(out, []byte("\n"), []byte("\r\n"))
	}
	return out, nil
}

// setAsideEdits saves the carried edits under the checkout's git dir, then puts their files back to HEAD so git
// merge takes them. The saved copies outlive a crash between here and putBackEdits; dir is where they are.
func setAsideEdits(ctx context.Context, project, runID string, carried []*carriedEdit) (dir string, err error) {
	if len(carried) == 0 {
		return "", nil
	}
	if dir, err = git(ctx, project, "rev-parse", "--git-path", "arc-carried/"+runID); err != nil {
		return "", err
	}
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(project, dir)
	}
	paths := make([]string, 0, len(carried))
	for _, c := range carried {
		saved := filepath.Join(dir, filepath.FromSlash(c.path))
		if err := os.MkdirAll(filepath.Dir(saved), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(saved, c.raw, 0o644); err != nil {
			return "", err
		}
		paths = append(paths, c.path)
	}
	if _, err := git(ctx, project, append([]string{"checkout", "--"}, paths...)...); err != nil {
		restoreEdits(carried, project, dir)
		return "", err
	}
	return dir, nil
}

// restoreEdits writes the carried edits back as they were, after a merge that did not happen.
func restoreEdits(carried []*carriedEdit, project, dir string) {
	if len(carried) == 0 {
		return
	}
	kept := false
	for _, c := range carried {
		if err := writeKeepingMode(filepath.Join(project, filepath.FromSlash(c.path)), c.raw); err != nil {
			log.Printf("putting back the uncommitted edit to %s: %v; it is saved in %s", c.path, err, dir)
			kept = true
			continue
		}
		os.Remove(filepath.Join(dir, filepath.FromSlash(c.path)))
	}
	if !kept {
		os.RemoveAll(dir)
	}
}

// putBackEdits puts each carried edit on top of the file as the merge from pre left it. One that no longer goes on
// top, as when the base moved under the land, stays saved in dir, and a note says where.
func putBackEdits(ctx context.Context, project, pre, dir string, carried []*carriedEdit) (notes []string) {
	if len(carried) == 0 {
		return nil
	}
	for _, c := range carried {
		saved := filepath.Join(dir, filepath.FromSlash(c.path))
		base, err := gitBlob(ctx, project, pre+":"+c.path)
		var landed, out []byte
		if err == nil {
			landed, err = gitBlob(ctx, project, "HEAD:"+c.path)
		}
		if err == nil {
			out, err = c.onto(ctx, project, base, landed)
		}
		if err == nil && out == nil {
			err = errors.New("it no longer goes on top of the merged file")
		}
		if err == nil {
			err = writeKeepingMode(filepath.Join(project, filepath.FromSlash(c.path)), out)
		}
		if err != nil {
			notes = append(notes, fmt.Sprintf("the uncommitted edit to %s was not put back after the land (%v): it is saved at %s", c.path, err, saved))
			continue
		}
		os.Remove(saved)
	}
	if len(notes) == 0 {
		os.RemoveAll(dir)
	}
	return notes
}

func carriedPaths(carried []*carriedEdit) string {
	paths := make([]string, 0, len(carried))
	for _, c := range carried {
		paths = append(paths, c.path)
	}
	return strings.Join(paths, ", ")
}

func writeKeepingMode(path string, content []byte) error {
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	return os.WriteFile(path, content, mode)
}

// gitBlob is the exact bytes of an object. git() trims its output, which would drop the file's last newline.
func gitBlob(ctx context.Context, dir, object string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", dir, "show", "--no-textconv", object)
	cmd.WaitDelay = gitWaitDelay
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	if errors.Is(err, exec.ErrWaitDelay) {
		err = nil
	}
	if err != nil {
		return nil, fmt.Errorf("git show %s: %w: %s", object, err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

// mergeFileDiff3 is `git merge-file -p --diff3` over three contents, labelled run, base, landed. An empty base is a
// file both sides added.
func mergeFileDiff3(ctx context.Context, dir string, run, base, landed []byte) (string, error) {
	tmp, err := os.MkdirTemp("", "arc-union-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)
	var paths []string
	for _, side := range []struct {
		name string
		body []byte
	}{{unionRunLabel, run}, {unionBaseLabel, base}, {unionLandedLabel, landed}} {
		p := filepath.Join(tmp, side.name)
		if err := os.WriteFile(p, side.body, 0o644); err != nil {
			return "", err
		}
		paths = append(paths, p)
	}
	args := []string{"-C", dir, "merge-file", "-p", "--diff3",
		"-L", unionRunLabel, "-L", unionBaseLabel, "-L", unionLandedLabel}
	cmd := exec.CommandContext(ctx, "git", append(args, paths...)...)
	cmd.WaitDelay = gitWaitDelay
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	if errors.Is(err, exec.ErrWaitDelay) {
		err = nil
	}
	// the exit code is the number of conflicts (capped at 127), not a failure; a failure exits negative
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() > 0 && exit.ExitCode() <= 127 {
		err = nil
	}
	if err != nil {
		return "", fmt.Errorf("git merge-file: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}
