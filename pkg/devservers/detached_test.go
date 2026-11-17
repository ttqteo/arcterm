// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"path/filepath"
	"testing"
)

// the chain `wsh detach npm run dev` leaves: astro under a cmd under npm, whose parent (wsh) has exited
func detachedChain() map[int32]Proc {
	return procMap(
		Proc{Pid: 50, Ppid: 40, Name: "node.exe", Cmdline: "node astro.mjs dev", CreateMs: 12_000},
		Proc{Pid: 40, Ppid: 30, Name: "cmd.exe", Cmdline: "cmd /c astro dev", CreateMs: 11_500},
		Proc{Pid: 30, Ppid: 9, Name: "node.exe", Cmdline: "npm-cli.js run dev", CreateMs: 10_100},
	)
}

func TestOwnerOfDetachedLaunchIsItsBlock(t *testing.T) {
	agent := ServerOwner{Kind: OwnerAgent, BlockId: "b1", TabId: "t1", Name: "Môi trường dev", Harness: "claude"}
	holders := map[int32]ServerOwner{30: DetachedHolder(agent, 10_000)}
	o, _ := OwnerOf(50, detachedChain(), aliveIn(50, 40, 30), holders)
	if o.Kind != OwnerAgent || o.TabId != "t1" || !o.Detached {
		t.Fatalf("owner = %+v; want the agent that ran wsh detach, marked detached", o)
	}
}

func TestOwnerOfDetachedLaunchPassesOverAReusedPid(t *testing.T) {
	agent := ServerOwner{Kind: OwnerAgent, BlockId: "b1", TabId: "t1", Name: "dev"}
	// recorded a minute before pid 30's process was created: another launch, long gone, held that pid
	holders := map[int32]ServerOwner{30: DetachedHolder(agent, 10_100-60_000)}
	if o, l := OwnerOf(50, detachedChain(), aliveIn(50, 40, 30), holders); o.Kind != OwnerDetached || l != "npm-cli.js run dev" {
		t.Fatalf("owner = %+v, %q; want no owner, as before the record", o, l)
	}
}

func TestRecordDetachedKeepsTheNewestAndOneRecordPerPid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "detached.json")
	launches, err := DetachedLaunches(path)
	if err != nil || len(launches) != 0 {
		t.Fatalf("no file: %v, %v; want none and no error", launches, err)
	}
	for i := 0; i < detachedKeep+3; i++ {
		if err := RecordDetached(path, DetachedLaunch{Pid: int32(100 + i), StartMs: int64(1000 + i)}); err != nil {
			t.Fatal(err)
		}
	}
	// the pid reused by a later launch keeps only that one
	if err := RecordDetached(path, DetachedLaunch{Pid: 110, StartMs: 9_999, Owner: ServerOwner{Kind: OwnerTerminal}}); err != nil {
		t.Fatal(err)
	}
	launches, err = DetachedLaunches(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(launches) != detachedKeep {
		t.Fatalf("kept %d; want %d", len(launches), detachedKeep)
	}
	n := 0
	for _, l := range launches {
		if l.Pid == 110 {
			n++
			if l.StartMs != 9_999 {
				t.Fatalf("pid 110 kept the old launch: %+v", l)
			}
		}
	}
	if n != 1 {
		t.Fatalf("pid 110 recorded %d times; want once", n)
	}
	if last := launches[len(launches)-1]; last.Pid != 110 {
		t.Fatalf("newest is %+v; want the pid 110 relaunch, oldest first", last)
	}
}
