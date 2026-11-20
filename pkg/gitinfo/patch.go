// pkg/gitinfo/patch.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitinfo

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// maxPatchBytes is the Diff pane's MAX_DIFF_BYTES, so one stray lockfile cannot stall the Changes tab.
const maxPatchBytes = 2 << 20

const fileHeaderPrefix = "diff --git "

// Patch is the unified patch of a change set. Truncated says the cap cut it at a file boundary, so the
// files past the cut are missing from Patch rather than unchanged.
type Patch struct {
	Patch     string
	IsRepo    bool
	Truncated bool
}

// GetPatch returns the unified patch of the working tree against ref (HEAD when ""), cwd-relative like
// GetChanges, with untracked files appended in git's own new-file form: git diff never shows them.
// With end set it is the patch of ref..end alone, so nothing else in the working tree shows. A non-empty path
// (cwd-relative, forward slashes) narrows it to that one path, matched literally.
func GetPatch(ctx context.Context, cwd, ref, end, path string, ignoreWs bool) (*Patch, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	facts := readRepoFacts(ctx, cwd)
	if !facts.isRepo {
		return &Patch{}, nil
	}
	pathspec := patchPathspec(path)
	tracked, err := trackedPatch(ctx, cwd, ref, end, facts.head, pathspec, ignoreWs)
	if err != nil {
		return nil, err
	}
	untrackedZ := ""
	if end == "" {
		statusArgs := []string{"--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall", "--", pathspec}
		statusZ, err := run(ctx, cwd, statusArgs...)
		if err != nil {
			return nil, errors.New(describeGitError(statusArgs, err))
		}
		untrackedZ = untrackedEntriesZ(stripPrefixZ(statusZ, facts.prefix))
	}

	var b strings.Builder
	fits := func(n int) bool { return b.Len()+n <= maxPatchBytes }
	for _, entry := range splitPatchFiles(tracked) {
		if !fits(len(entry)) {
			return &Patch{Patch: b.String(), IsRepo: true, Truncated: true}, nil
		}
		b.WriteString(entry)
	}
	for _, entry := range strings.Split(untrackedZ, "\x00") {
		if len(entry) < 3 {
			continue
		}
		entryPath := entry[3:]
		// an untracked nested repo lists as one "dir/" entry that git never descends into; git diff shows nothing for it
		if strings.HasSuffix(entryPath, "/") {
			continue
		}
		next, tooBig, err := untrackedEntry(filepath.Join(cwd, filepath.FromSlash(entryPath)), entryPath, maxPatchBytes-b.Len())
		if err != nil {
			return nil, err
		}
		if tooBig || !fits(len(next)) {
			return &Patch{Patch: b.String(), IsRepo: true, Truncated: true}, nil
		}
		b.WriteString(next)
	}
	return &Patch{Patch: b.String(), IsRepo: true}, nil
}

// untrackedEntry reads one untracked file into its patch entry. A file that vanished since the status
// read (an agent's temp file) gives "" so it is skipped. Binary is sniffed first, since its entry is one
// line whatever its size; a text file bigger than left can only cross the cap, so it is not read.
func untrackedEntry(full, path string, left int) (string, bool, error) {
	f, err := os.Open(full)
	if os.IsNotExist(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("reading untracked %s: %w", path, err)
	}
	defer f.Close()
	head := make([]byte, binarySniffBytes)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", false, fmt.Errorf("reading untracked %s: %w", path, err)
	}
	head = head[:n]
	if isBinary(head) {
		return untrackedPatch(path, head), false, nil
	}
	info, err := f.Stat()
	if err != nil {
		return "", false, fmt.Errorf("reading untracked %s: %w", path, err)
	}
	if info.Size() > int64(left) {
		return "", true, nil
	}
	rest, err := io.ReadAll(f)
	if err != nil {
		return "", false, fmt.Errorf("reading untracked %s: %w", path, err)
	}
	return untrackedPatch(path, append(head, rest...)), false, nil
}

// isBinary is git's test: a NUL byte within the first binarySniffBytes.
func isBinary(content []byte) bool {
	return bytes.IndexByte(content[:min(len(content), binarySniffBytes)], 0) >= 0
}

// trackedPatch is git's own diff of the tracked files. With no commits and no ref there is nothing to
// diff against, so only the untracked entries answer, as GetChanges does for numstat.
func trackedPatch(ctx context.Context, cwd, ref, end, head, pathspec string, ignoreWs bool) (string, error) {
	if ref == "" && head == "" {
		return "", nil
	}
	if ref == "" {
		ref = "HEAD"
	}
	// every flag pins something a user's config could change under the parser: prefixes, color, context,
	// external drivers, and quoting of non-ASCII paths
	args := []string{"-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--relative",
		"-U3", "--src-prefix=a/", "--dst-prefix=b/"}
	if ignoreWs {
		args = append(args, "-w")
	}
	args = append(args, ref)
	if end != "" {
		args = append(args, end)
	}
	args = append(args, "--")
	if pathspec != "." {
		args = append(args, pathspec)
	}
	out, err := run(ctx, cwd, args...)
	if err != nil {
		return "", errors.New(describeGitError(args, err))
	}
	return out, nil
}

// patchPathspec is the pathspec both git calls take: the whole cwd for "", else the one path as a literal,
// so a "*" or "[" in a file name is never a glob.
func patchPathspec(path string) string {
	if path == "" {
		return "."
	}
	return ":(literal)" + path
}

// splitPatchFiles cuts git diff output into one string per file. A hunk line always starts with a
// sign, a space or a backslash, so a line starting "diff --git " can only begin a file.
func splitPatchFiles(out string) []string {
	var files []string
	for out != "" {
		next := strings.Index(out, "\n"+fileHeaderPrefix)
		if next < 0 {
			files = append(files, out)
			break
		}
		files = append(files, out[:next+1])
		out = out[next+1:]
	}
	return files
}

// untrackedPatch writes a new file's entry in git's own form. An empty file has no hunk, and a binary
// one has git's "Binary files" line instead.
func untrackedPatch(path string, content []byte) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%sa/%s b/%s\nnew file mode 100644\n", fileHeaderPrefix, path, path)
	if isBinary(content) {
		fmt.Fprintf(&b, "Binary files /dev/null and b/%s differ\n", path)
		return b.String()
	}
	if len(content) == 0 {
		return b.String()
	}
	text := string(content)
	noFinalNewline := !strings.HasSuffix(text, "\n")
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	fmt.Fprintf(&b, "--- /dev/null\n+++ b/%s\n@@ -0,0 +1,%d @@\n", path, len(lines))
	for _, line := range lines {
		b.WriteString("+")
		b.WriteString(line)
		b.WriteString("\n")
	}
	if noFinalNewline {
		b.WriteString("\\ No newline at end of file\n")
	}
	return b.String()
}
