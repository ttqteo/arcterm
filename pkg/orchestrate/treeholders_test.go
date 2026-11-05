// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestHoldersOfPicksCwdAndExeInsideDirOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "983dcb44-t-8")
	procs := []treeProc{
		{Pid: 1, Name: "vite", Cwd: dir},
		{Pid: 2, Name: "child", Cwd: filepath.Join(dir, "frontend")},
		{Pid: 3, Name: "built", Cwd: os.TempDir(), Exe: filepath.Join(dir, "bin", "tool.exe")},
		{Pid: 4, Name: "sibling", Cwd: dir + "-r1"},
		{Pid: 5, Name: "parent", Cwd: filepath.Dir(dir)},
		{Pid: 6, Name: "unreadable"},
		{Pid: 7, Name: "self", Cwd: dir},
	}
	var got []int32
	for _, p := range holdersOf(procs, dir, 7) {
		got = append(got, p.Pid)
	}
	if want := []int32{1, 2, 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("holders = %v, want %v", got, want)
	}
}

func TestKillTreeHoldersKillsOnlyHolders(t *testing.T) {
	dir := t.TempDir()
	oldList, oldKill := listTreeProcs, killTreeProc
	t.Cleanup(func() { listTreeProcs, killTreeProc = oldList, oldKill })
	listTreeProcs = func(context.Context) ([]treeProc, error) {
		return []treeProc{{Pid: 10, Cwd: dir}, {Pid: 11, Cwd: os.TempDir()}, {Pid: 12, Cwd: dir}}, nil
	}
	var killed []int32
	killTreeProc = func(_ context.Context, pid int32) error {
		killed = append(killed, pid)
		if pid == 12 {
			return errors.New("access denied")
		}
		return nil
	}
	if n := killTreeHolders(context.Background(), dir); n != 1 {
		t.Fatalf("killTreeHolders = %d, want 1 (pid 12's kill failed)", n)
	}
	if want := []int32{10, 12}; !reflect.DeepEqual(killed, want) {
		t.Fatalf("killed %v, want %v", killed, want)
	}
}

func TestRemoveHeldDirKillsNothingWhenTheDeleteWorks(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tree")
	if err := os.MkdirAll(filepath.Join(dir, "a"), 0o755); err != nil {
		t.Fatal(err)
	}
	oldList := listTreeProcs
	t.Cleanup(func() { listTreeProcs = oldList })
	listTreeProcs = func(context.Context) ([]treeProc, error) {
		t.Fatal("listed processes for a delete that worked")
		return nil, nil
	}
	if err := removeHeldDir(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("dir still there: %v", err)
	}
}
