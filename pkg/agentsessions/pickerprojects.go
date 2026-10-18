// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"path/filepath"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/projectscan"
)

// PickerProjects is what the New project picker offers of the folders Claude Code ran in: only projects. A folder
// inside a repo (a session begun in src/services) counts as the repo, its sessions added to the repo's; home, the
// filesystem root, a folder with no project above it and anything under skip (the engine's shared worktree root)
// are left out. Newest first.
func PickerProjects(found []ClaudeProject, home string, skip []string) []ClaudeProject {
	byKey := map[string]*ClaudeProject{}
	var order []string
	for _, p := range found {
		if underAnyDir(p.Path, skip) {
			continue
		}
		root, ok := projectscan.Root(p.Path, home)
		if !ok {
			continue
		}
		key := pathKey(root)
		prev := byKey[key]
		if prev == nil {
			byKey[key] = &ClaudeProject{Path: root, Name: filepath.Base(root), LastActiveTs: p.LastActiveTs, Sessions: p.Sessions}
			order = append(order, key)
			continue
		}
		prev.Sessions += p.Sessions
		prev.LastActiveTs = max(prev.LastActiveTs, p.LastActiveTs)
	}
	out := make([]ClaudeProject, 0, len(order))
	for _, k := range order {
		out = append(out, *byKey[k])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastActiveTs > out[j].LastActiveTs })
	return out
}

func underAnyDir(path string, dirs []string) bool {
	for _, d := range dirs {
		if isUnderDir(path, d) {
			return true
		}
	}
	return false
}
