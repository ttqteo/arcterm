// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestEndableRefusesTheSystemArctermAndWsh(t *testing.T) {
	for name, want := range map[string]bool{
		"chrome.exe":                  true,
		"Docker Desktop.exe":          true,
		"Google Chrome":               true,
		"svchost.exe":                 false,
		"SvcHost.EXE":                 false,
		"explorer.exe":                false,
		"Memory Compression":          false,
		"msedgewebview2.exe":          false,
		"wave-tauri.exe":              false,
		"wavesrv.x64.exe":             false,
		"wsh-0.15.11-windows.x64.exe": false,
		"WindowServer":                false,
		"":                            false,
		"  ":                          false,
	} {
		if got := Endable(name); got != want {
			t.Errorf("Endable(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestEndTargetsTakesTheNameOutsideArctermAndItsJobs(t *testing.T) {
	table := map[int]proc{
		4:   {Pid: 4, Name: "chrome.exe"}, // the System pid is never one
		100: {Pid: 100, Name: "chrome.exe", CreateTs: 11},
		101: {Pid: 101, Name: "Chrome.exe", CreateTs: 12},
		102: {Pid: 102, Name: "chrome.exe"}, // a job member: an agent's browser
		103: {Pid: 103, Name: "chrome.exe"}, // arcterm's own tree
		104: {Pid: 104, Name: "chrome.exe"}, // this wavesrv's host
		200: {Pid: 200, Name: "notepad.exe"},
		// macOS: a helper is named by the app it works for, as the others are grouped
		300: {Pid: 300, Name: "Google Chrome Helper", App: "Google Chrome", CreateTs: 30},
	}
	tracked := map[int]bool{102: true, 103: true}
	got := endTargets(table, tracked, "CHROME.EXE", 104)
	want := []endTarget{{Pid: 100, CreateTs: 11}, {Pid: 101, CreateTs: 12}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if got := endTargets(table, tracked, "Google Chrome"); !reflect.DeepEqual(got, []endTarget{{Pid: 300, CreateTs: 30}}) {
		t.Fatalf("app name: got %+v", got)
	}
	if got := endTargets(table, tracked, "gone.exe"); len(got) != 0 {
		t.Fatalf("a name with no process: got %+v", got)
	}
}

func TestEndAppRefusesAKeptName(t *testing.T) {
	if got := EndApp("svchost.exe"); got.Outcome != wshrpc.ResMonKill_Refused || got.Killed != 0 {
		t.Fatalf("got %+v, want refused", got)
	}
}

func TestGroupOthersMarksWhatCanEnd(t *testing.T) {
	got := groupOthers([]otherProc{
		{Name: "chrome.exe", Mem: 300 * mb},
		{Name: "svchost.exe", Mem: 400 * mb},
	}, 200*mb, 12)
	if len(got) != 2 || got[0].Name != "svchost.exe" || got[0].Endable || !got[1].Endable {
		t.Fatalf("got %+v", got)
	}
}
