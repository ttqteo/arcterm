// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

// a tree the engine makes for a project with no Setup gets the main checkout's installed node_modules linked in, so
// a worker runs the project's tools without an install of its own (docs/superpowers/specs/2026-10-16-default-task-environment-design.md)
const dependencyDir = "node_modules"

// dependencyManifests are the files beside a package.json that decide what an install puts in its node_modules
var dependencyManifests = []string{"package.json", "pnpm-workspace.yaml", ".npmrc", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"}

// PrepareTree readies a new engine tree wt: it runs the plan's Setup command under SetupTimeout and returns its output
// tail, or, with no Setup, links the main checkout's dependency folders in and returns the dirs it left unlinked
// because the tree asks for other dependencies than main installed.
func PrepareTree(ctx context.Context, wt, setup string) (tail string, notLinked []string, err error) {
	if setup != "" {
		tail, err = runPlanCommand(ctx, wt, setup, nil, SetupTimeout, nil)
		return tail, nil, err
	}
	notLinked, err = linkDependencies(ctx, wt)
	return "", notLinked, err
}

// linkDependencies links, for each package.json tracked in wt, the main checkout's node_modules beside it into wt,
// when main has one installed, wt has none, and the manifests match. It reports the dirs it skipped for a manifest
// difference, each with its reason; a dir main never installed is not reported, since nobody runs its tools.
// Running it again is a no-op.
func linkDependencies(ctx context.Context, wt string) ([]string, error) {
	main := jarvis.MainCheckout(wt)
	if main == "" || strings.EqualFold(filepath.Clean(main), filepath.Clean(wt)) {
		return nil, nil
	}
	out, err := git(ctx, wt, "ls-files", "-z", "--", "*package.json")
	if err != nil {
		return nil, fmt.Errorf("listing package.json files in %s: %w", wt, err)
	}
	var notLinked []string
	for _, f := range strings.Split(out, "\x00") {
		if path.Base(f) != "package.json" || slices.Contains(strings.Split(f, "/"), dependencyDir) {
			continue
		}
		rel := path.Dir(f)
		dir := filepath.FromSlash(rel)
		target := filepath.Join(main, dir, dependencyDir)
		// Lstat reports a link as not a directory: main's own link is not chained
		if fi, err := os.Lstat(target); err != nil || !fi.IsDir() {
			continue
		}
		link := filepath.Join(wt, dir, dependencyDir)
		if _, err := os.Lstat(link); !errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if name := manifestDiff(main, wt, dir); name != "" {
			notLinked = append(notLinked, fmt.Sprintf("%s (%s differs from the main checkout's)", rel, name))
			continue
		}
		if err := linkDir(ctx, link, target); err != nil {
			return notLinked, err
		}
	}
	return notLinked, nil
}

// manifestDiff names the first manifest in dir that wt has and main lacks or holds other content of, "" when they
// match. A file only main has, such as a gitignored lockfile, is not compared. Line endings are not content: with
// core.autocrlf a checkout writes CRLF, while an editor can save main's copy with LF and git still sees no change.
func manifestDiff(main, wt, dir string) string {
	for _, name := range dependencyManifests {
		mine, err := os.ReadFile(filepath.Join(wt, dir, name))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return name
		}
		theirs, err := os.ReadFile(filepath.Join(main, dir, name))
		if err != nil || !bytes.Equal(lfOnly(mine), lfOnly(theirs)) {
			return name
		}
	}
	return ""
}

func lfOnly(b []byte) []byte {
	return bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))
}

// linkDir makes link point at the directory target: a junction on Windows, where a symlink needs developer mode or
// an elevated process.
func linkDir(ctx context.Context, link, target string) error {
	if runtime.GOOS != "windows" {
		if err := os.Symlink(target, link); err != nil {
			return fmt.Errorf("linking %s: %w", link, err)
		}
		return nil
	}
	if out, err := exec.CommandContext(ctx, "cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		return fmt.Errorf("linking %s to %s: %w: %s", link, target, err, strings.TrimSpace(string(out)))
	}
	return nil
}
