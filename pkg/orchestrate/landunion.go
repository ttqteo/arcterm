// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// unionMergeFile is the project's list of files whose add-only conflicts a land resolves itself. It is read from the
// base branch, the side that landed first.
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
