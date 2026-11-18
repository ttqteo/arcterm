// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const mb = int64(1 << 20)

func TestGroupOthersSumsByNameAndKeepsTheHeavy(t *testing.T) {
	procs := []otherProc{
		{Name: "chrome.exe", Cpu: 1, Mem: 150 * mb},
		{Name: "Chrome.exe", Cpu: 2, Mem: 100 * mb},
		{Name: "gopls.exe", Cpu: 0, Mem: 366 * mb},
		{Name: "notepad.exe", Cpu: 0, Mem: 20 * mb},
		{Name: "unreadable.exe", Cpu: 0, Mem: -1},
	}
	got := groupOthers(procs, 200*mb, 12)
	want := []wshrpc.ResMonOther{
		{Name: "gopls.exe", Count: 1, Cpu: 0, Mem: 366 * mb},
		{Name: "chrome.exe", Count: 2, Cpu: 3, Mem: 250 * mb},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestGroupOthersCapsTheListAndBreaksTiesByName(t *testing.T) {
	procs := []otherProc{
		{Name: "b.exe", Mem: 300 * mb},
		{Name: "a.exe", Mem: 300 * mb},
		{Name: "c.exe", Mem: 400 * mb},
	}
	got := groupOthers(procs, 200*mb, 2)
	if len(got) != 2 || got[0].Name != "c.exe" || got[1].Name != "a.exe" {
		t.Fatalf("got %+v", got)
	}
}

func TestGroupOthersCountsNoNegativeCpu(t *testing.T) {
	got := groupOthers([]otherProc{{Name: "x.exe", Cpu: -1, Mem: 300 * mb}}, 200*mb, 12)
	if len(got) != 1 || got[0].Cpu != 0 {
		t.Fatalf("got %+v", got)
	}
}
