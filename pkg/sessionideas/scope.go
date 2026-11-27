// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// A scan can cover one project at a time. Its key is the Claude Code folder a transcript sits in, one per folder a
// session was started in, which needs no read of the transcript and is the same on every list. Until the person scans
// every project (FirstScanDone), the schedule and a plain scan (Scan now, Retry) read only the projects the person
// scanned one by one (ScanProjects): each was started after its own estimate, the others never were.

// ProjectDir is the project a transcript belongs to: the Claude Code folder it sits in.
func ProjectDir(transcriptPath string) string {
	return filepath.Dir(transcriptPath)
}

// sameDir compares two folders as the file system does: without case on Windows.
func sameDir(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func inProjects(projects []string, transcriptPath string) bool {
	dir := ProjectDir(transcriptPath)
	return slices.ContainsFunc(projects, func(p string) bool { return sameDir(p, dir) })
}

// scoped says whether the store limits the schedule and a plain scan to some projects: the person has scanned one or
// more projects alone and never every project.
func scoped(d wshrpc.SessionIdeasData) bool {
	return !d.FirstScanDone && len(d.ScanProjects) > 0
}

// InScope is the candidates the schedule may read: all of them, or while the store is scoped, those of its projects.
func InScope(d wshrpc.SessionIdeasData, cands []agentsessions.DigestSession) []agentsessions.DigestSession {
	if !scoped(d) {
		return cands
	}
	return keepProjects(cands, d.ScanProjects)
}

func keepProjects(cands []agentsessions.DigestSession, projects []string) []agentsessions.DigestSession {
	out := make([]agentsessions.DigestSession, 0, len(cands))
	for _, c := range cands {
		if inProjects(projects, c.Path) {
			out = append(out, c)
		}
	}
	return out
}

// scanCandidates is the candidates a scan the person or the schedule started may read: opts.Paths are resolved against
// all of them; otherwise a project scan reads its project, All reads every one, and a plain scan reads the scope.
func scanCandidates(cands []agentsessions.DigestSession, d wshrpc.SessionIdeasData, opts ScanOpts) []agentsessions.DigestSession {
	switch {
	case len(opts.Paths) > 0, opts.All:
		return cands
	case opts.Project != "":
		return keepProjects(cands, []string{opts.Project})
	}
	return InScope(d, cands)
}

// afterScan is what a scan the person started leaves in the store: a project scan adds its project to the scope (until
// every project is scanned), and a scan of every project (All, or a plain scan before any scope) turns the schedule on
// for all of them. A scan of named paths, and the schedule's own (Forced), change neither.
func afterScan(d *wshrpc.SessionIdeasData, opts ScanOpts) {
	if opts.Forced || len(opts.Paths) > 0 {
		return
	}
	switch {
	case opts.Project != "":
		if !d.FirstScanDone && !slices.ContainsFunc(d.ScanProjects, func(p string) bool { return sameDir(p, opts.Project) }) {
			d.ScanProjects = append(d.ScanProjects, opts.Project) // a row's ProjectDir, as the list gave it
		}
	case opts.All || !scoped(*d):
		d.FirstScanDone = true
		d.ScanProjects = nil
	}
}
