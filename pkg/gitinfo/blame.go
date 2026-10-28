// pkg/gitinfo/blame.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitinfo

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// blame walks history per line, so a long-lived file outlasts gitTimeout; it gets its own budget and
// the client raises its RPC timeout to match, since that budget binds the server context.
const blameTimeout = 30 * time.Second

// BlameHunk is one porcelain group: consecutive lines of the working-tree file that git attributes to
// one commit. Groups are not merged here, so two groups of one commit can sit side by side.
type BlameHunk struct {
	Start      int    `json:"start"` // 1-based line in the working-tree file
	Lines      int    `json:"lines"`
	Sha        string `json:"sha"` // full; all zeros = not committed
	Author     string `json:"author"`
	AuthorTime int64  `json:"authortime"` // unix seconds
	Subject    string `json:"subject"`
}

// BlameResult carries Untracked as a flag rather than an error: a file with no committed history is a
// normal thing to open, and the surface draws it as "not committed" instead of a failed read.
type BlameResult struct {
	Hunks     []BlameHunk
	IsRepo    bool
	Untracked bool
}

// Blame attributes each line of a working-tree file to the commit that last changed it. The path is
// cwd-relative like every other reader in this package.
func Blame(ctx context.Context, cwd, path string) (*BlameResult, error) {
	ctx, cancel := context.WithTimeout(ctx, blameTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return &BlameResult{IsRepo: false}, nil
	}
	out, err := run(ctx, cwd, "blame", "--porcelain", "--", path)
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("git blame %s: %w", path, ctx.Err())
		}
		if _, lerr := run(ctx, cwd, "ls-files", "--error-unmatch", "--", path); lerr != nil {
			return &BlameResult{IsRepo: true, Untracked: true}, nil
		}
		return nil, fmt.Errorf("git blame %s: %w", path, withStderr(err))
	}
	return &BlameResult{Hunks: parseBlame(out), IsRepo: true}, nil
}

func withStderr(err error) error {
	var ee *exec.ExitError
	if errors.As(err, &ee) && len(ee.Stderr) > 0 {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(ee.Stderr)))
	}
	return err
}

type blameMeta struct {
	author  string
	time    int64
	subject string
}

// parseBlame reads `git blame --porcelain`. A line group opens with `<sha> <orig> <final> <count>`;
// the lines after the first of a group repeat the header without a count, and a commit's metadata is
// printed only the first time it appears. Content lines start with a tab, so they never read as headers.
func parseBlame(out string) []BlameHunk {
	var hunks []BlameHunk
	metas := map[string]*blameMeta{}
	var cur *blameMeta
	for _, line := range strings.Split(out, "\n") {
		if line == "" || line[0] == '\t' {
			continue
		}
		if sha, final, count, ok := parseBlameHeader(line); ok {
			cur = metas[sha]
			if cur == nil {
				cur = &blameMeta{}
				metas[sha] = cur
			}
			if count > 0 {
				hunks = append(hunks, BlameHunk{Start: final, Lines: count, Sha: sha})
			}
			continue
		}
		if cur == nil {
			continue
		}
		key, val, _ := strings.Cut(line, " ")
		switch key {
		case "author":
			cur.author = val
		case "author-time":
			cur.time, _ = strconv.ParseInt(val, 10, 64)
		case "summary":
			cur.subject = val
		}
	}
	for i := range hunks {
		m := metas[hunks[i].Sha]
		hunks[i].Author, hunks[i].AuthorTime, hunks[i].Subject = m.author, m.time, m.subject
	}
	return hunks
}

// parseBlameHeader recognises `<40-hex sha> <orig> <final> [<count>]`. count is 0 on a continuation
// line, which has no fourth field.
func parseBlameHeader(line string) (sha string, final, count int, ok bool) {
	f := strings.Fields(line)
	if (len(f) != 3 && len(f) != 4) || len(f[0]) != 40 || !isHex(f[0]) {
		return "", 0, 0, false
	}
	final, err := strconv.Atoi(f[2])
	if err != nil {
		return "", 0, 0, false
	}
	if len(f) == 4 {
		if count, err = strconv.Atoi(f[3]); err != nil {
			return "", 0, 0, false
		}
	}
	return f[0], final, count, true
}

func isHex(s string) bool {
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
