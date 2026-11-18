// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"slices"
	"testing"
)

func TestTreeMembers(t *testing.T) {
	table := map[int]treeProc{
		1:   {ppid: 0, start: 1},
		100: {ppid: 1, start: 1000}, // the root: a block's shell
		101: {ppid: 100, start: 1100},
		102: {ppid: 101, start: 1200},
		103: {ppid: 100, start: 0},   // a child whose start could not be read still links
		104: {ppid: 102, start: 900}, // older than its parent: a reused pid, not a member
		200: {ppid: 1, start: 1300},  // detached: reparented to launchd
		201: {ppid: 200, start: 1400},
	}
	cases := []struct {
		name      string
		root      int
		rootStart int64
		want      []int
	}{
		{"the root and its descendants", 100, 1000, []int{100, 101, 102, 103}},
		{"the root's start unknown at register", 100, 0, []int{100, 101, 102, 103}},
		{"a reused root pid is no job", 100, 999, nil},
		{"a gone root is no job", 300, 0, nil},
		{"a leaf", 102, 1200, []int{102}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := treeMembers(table, c.root, c.rootStart); !slices.Equal(got, c.want) {
				t.Fatalf("treeMembers(%d, %d) = %v, want %v", c.root, c.rootStart, got, c.want)
			}
		})
	}
}

func TestTreeMembersSurvivesACycle(t *testing.T) {
	table := map[int]treeProc{
		10: {ppid: 11},
		11: {ppid: 10},
	}
	if got := treeMembers(table, 10, 0); !slices.Equal(got, []int{10, 11}) {
		t.Fatalf("got %v", got)
	}
}
