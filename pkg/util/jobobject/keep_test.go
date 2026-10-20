// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"maps"
	"slices"
	"testing"
)

func TestKeptMembers(t *testing.T) {
	keep := map[string]bool{"docker desktop.exe": true}
	// pwsh (the agent's shell) > claude > tool shell > Docker Desktop > backend > build; the tool shell also ran a node
	table := map[int]procEntry{
		1:  {parent: 0, image: "explorer.exe"},
		10: {parent: 1, image: "pwsh.exe"},
		11: {parent: 10, image: "claude.exe"},
		12: {parent: 11, image: "powershell.exe"},
		13: {parent: 12, image: "docker desktop.exe"},
		14: {parent: 13, image: "com.docker.backend.exe"},
		15: {parent: 14, image: "com.docker.build.exe"},
		16: {parent: 12, image: "node.exe"},
		// a self-parented entry, and a loop pid reuse can leave
		20: {parent: 20, image: "cmd.exe"},
		21: {parent: 22, image: "a.exe"},
		22: {parent: 21, image: "b.exe"},
	}
	cases := []struct {
		name    string
		members []int
		want    []int
	}{
		{"the app and what runs under it", []int{10, 11, 12, 13, 14, 15, 16}, []int{13, 14, 15}},
		{"no app, nothing kept", []int{10, 11, 12, 16}, nil},
		// its launcher already gone: the app is still a member, so it and its children are kept
		{"orphaned app", []int{10, 13, 14}, []int{13, 14}},
		// the chain stops at a non-member: an outside Docker Desktop is never the ancestor that keeps a member
		{"app outside the job", []int{14, 15}, nil},
		{"pid-reuse loops end", []int{20, 21, 22}, nil},
	}
	for _, c := range cases {
		got := slices.Sorted(maps.Keys(keptMembers(c.members, table, keep)))
		if !slices.Equal(got, c.want) {
			t.Errorf("%s: kept %v, want %v", c.name, got, c.want)
		}
	}
}
