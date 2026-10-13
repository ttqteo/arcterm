// pkg/gitinfo/walk.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Code surface's readers for a directory that is not a git repository. They return the same
// FileList and GrepResult shapes as ListFiles and Grep, so the frontend has one index type and one
// search result type whichever reader answered.

package gitinfo

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// .gitignore is deliberately not parsed: these are directories git is not indexing, where one rarely
// exists, and git's precedence and negation rules are not worth reimplementing for them.
var walkSkipDirs = map[string]bool{
	"node_modules": true, "target": true, "dist": true, "build": true, "out": true, "venv": true,
	"__pycache__": true, "vendor": true,
}

// matches the frontend's MAX_VIEW_BYTES: a file the editor would refuse to open is not searched either
const maxScanBytes = 2 * 1024 * 1024

// a NUL in the first 8 KB marks a binary file, the same heuristic git grep -I uses
const binarySniffBytes = 8000

// IsWorkTree reports whether cwd is inside a git working tree.
func IsWorkTree(ctx context.Context, cwd string) bool {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	inside, err := run(ctx, cwd, "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(inside) == "true"
}

// WalkFiles enumerates the regular files under root, skipping walkSkipDirs and dot-directories, and
// not following symlinks (a loop would never end). Paths are root-relative with forward slashes,
// sorted, capped at maxListFiles. Hitting the deadline is a truncated list rather than an error,
// because a huge tree is still worth browsing in part.
func WalkFiles(ctx context.Context, root string) (*FileList, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	return walkFiles(ctx, root, maxListFiles)
}

func walkFiles(ctx context.Context, root string, limit int) (*FileList, error) {
	if _, err := os.Stat(root); err != nil {
		return nil, err
	}
	paths := []string{}
	truncated := false
	errStop := errors.New("stop")
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			truncated = true
			return errStop
		}
		if err != nil {
			return nil // an unreadable subdirectory hides only itself
		}
		if d.IsDir() {
			if p != root && (walkSkipDirs[d.Name()] || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		if len(paths) >= limit {
			truncated = true
			return errStop
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	if err != nil && err != errStop {
		return nil, err
	}
	// WalkDir's per-directory order puts "a/x" before "a.txt"; ls-files order is plain string order
	sort.Strings(paths)
	return &FileList{Paths: paths, IsRepo: false, Truncated: truncated}, nil
}

// ScanGrep searches the files WalkFiles lists, with the same options, cap and result shape as Grep.
// Include and Exclude follow git's default pathspec matching, so a filter typed for a repository means
// the same thing here.
func ScanGrep(ctx context.Context, root, query string, opts GrepOpts) (*GrepResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return &GrepResult{}, nil
	}
	re, err := scanPattern(q, opts)
	if err != nil {
		return &GrepResult{Matches: []GrepMatch{}, InvalidPattern: true}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	fl, err := walkFiles(ctx, root, maxListFiles)
	if err != nil {
		return nil, err
	}
	include, exclude := pathspecs(opts.Include), pathspecs(opts.Exclude)
	matches := []GrepMatch{}
	for _, rel := range fl.Paths {
		if ctx.Err() != nil {
			return &GrepResult{Matches: matches, Truncated: true}, nil
		}
		if (len(include) > 0 && !anyPathspec(include, rel)) || anyPathspec(exclude, rel) {
			continue
		}
		data := readScannable(filepath.Join(root, filepath.FromSlash(rel)))
		for i, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSuffix(line, "\r")
			if !re.MatchString(line) {
				continue
			}
			if len(matches) >= maxGrepMatches {
				return &GrepResult{Matches: matches, Truncated: true}, nil
			}
			matches = append(matches, GrepMatch{Path: rel, Line: i + 1, Text: line})
		}
	}
	return &GrepResult{Matches: matches, Truncated: fl.Truncated}, nil
}

// readScannable returns nil for a file that is unreadable, too large or binary
func readScannable(abs string) []byte {
	info, err := os.Stat(abs)
	if err != nil || info.Size() > maxScanBytes {
		return nil
	}
	data, err := os.ReadFile(abs)
	if err != nil || bytes.IndexByte(data[:min(len(data), binarySniffBytes)], 0) >= 0 {
		return nil
	}
	return data
}

// Whole word is git's -w rule — the match is bounded by a non-word character or the line's edge —
// rather than \b, which never matches beside a query that itself starts or ends with punctuation.
func scanPattern(q string, opts GrepOpts) (*regexp.Regexp, error) {
	expr := q
	if !opts.Regex {
		expr = regexp.QuoteMeta(q)
	}
	if opts.WholeWord {
		expr = `(?:^|\W)(?:` + expr + `)(?:\W|$)`
	}
	if !opts.CaseSensitive {
		expr = "(?i)" + expr
	}
	return regexp.Compile(expr)
}

type pathspec struct {
	literal string
	glob    *regexp.Regexp
}

// git's default pathspec: a pattern without wildcards names a file or a directory prefix; one with
// wildcards is matched against the whole path, and its `*` crosses slashes (so `*.go` is every Go file).
func pathspecs(raw []string) []pathspec {
	out := []pathspec{}
	for _, p := range raw {
		p = strings.Trim(strings.TrimSpace(filepath.ToSlash(p)), "/")
		if p == "" {
			continue
		}
		if !strings.ContainsAny(p, "*?[") {
			out = append(out, pathspec{literal: p})
			continue
		}
		var sb strings.Builder
		sb.WriteString("^")
		for _, r := range p {
			switch r {
			case '*':
				sb.WriteString(".*")
			case '?':
				sb.WriteString(".")
			default:
				sb.WriteString(regexp.QuoteMeta(string(r)))
			}
		}
		sb.WriteString("$")
		if re, err := regexp.Compile(sb.String()); err == nil {
			out = append(out, pathspec{glob: re})
		}
	}
	return out
}

func anyPathspec(specs []pathspec, rel string) bool {
	for _, s := range specs {
		if s.glob != nil && s.glob.MatchString(rel) {
			return true
		}
		if s.glob == nil && (rel == s.literal || strings.HasPrefix(rel, s.literal+"/")) {
			return true
		}
	}
	return false
}
