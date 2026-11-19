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
		{Name: "gopls.exe", Count: 1, Cpu: 0, Mem: 366 * mb, Endable: true},
		{Name: "chrome.exe", Count: 2, Cpu: 3, Mem: 250 * mb, Endable: true},
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

func TestWithIconsReadsEachNameOnceAndTriesTheNextProcess(t *testing.T) {
	saved, savedReader := iconCache, iconReader
	defer func() { iconCache, iconReader = saved, savedReader }()
	iconCache = map[string]string{}
	var asked []int
	iconReader = func(pid int) string {
		asked = append(asked, pid)
		if pid == 2 {
			return "data:image/png;base64,AA=="
		}
		return ""
	}
	procs := []otherProc{{Pid: 1, Name: "Chrome.exe"}, {Pid: 2, Name: "chrome.exe"}, {Pid: 3, Name: "chrome.exe"}, {Pid: 4, Name: "gone.exe"}}
	groups := []wshrpc.ResMonOther{{Name: "Chrome.exe"}, {Name: "gone.exe"}}
	withIcons(groups, procs)
	if groups[0].Icon != "data:image/png;base64,AA==" || groups[1].Icon != "" {
		t.Fatalf("icons %+v", groups)
	}
	if !reflect.DeepEqual(asked, []int{1, 2, 4}) {
		t.Fatalf("asked %v, want [1 2 4]: the first that reads ends a name's search", asked)
	}
	// a second tick asks nothing: a name read, or tried and unread, is cached
	asked = nil
	again := []wshrpc.ResMonOther{{Name: "chrome.exe"}, {Name: "gone.exe"}}
	withIcons(again, procs)
	if len(asked) != 0 || again[0].Icon != groups[0].Icon {
		t.Fatalf("asked %v on the second tick, icons %+v", asked, again)
	}
}

func TestNameWebviewHostsNamesEachPaneAfterItsApp(t *testing.T) {
	table := map[int]proc{
		1:  {Pid: 1, Name: "explorer.exe"},
		10: {Pid: 10, Ppid: 1, Name: "ms-teams.exe"},
		11: {Pid: 11, Ppid: 10, Name: "msedgewebview2.exe"},
		12: {Pid: 12, Ppid: 11, Name: "msedgewebview2.exe"},
		20: {Pid: 20, Ppid: 1, Name: "Outlook.exe"},
		21: {Pid: 21, Ppid: 20, Name: "MSEdgeWebView2.exe"},
		30: {Pid: 30, Ppid: 999, Name: "msedgewebview2.exe"}, // its parent has left
		40: {Pid: 40, Ppid: 41, Name: "msedgewebview2.exe"},  // a ppid cycle of panes
		41: {Pid: 41, Ppid: 40, Name: "msedgewebview2.exe"},
		50: {Pid: 50, Ppid: 1, Name: "msedgewebview2.exe", App: "Already"},
	}
	nameWebviewHosts(table)
	want := map[int]string{
		1: "", 10: "", 11: "WebView2: ms-teams.exe", 12: "WebView2: ms-teams.exe", 20: "",
		21: "WebView2: Outlook.exe", 30: "", 40: "", 41: "", 50: "Already",
	}
	for pid, app := range want {
		if table[pid].App != app {
			t.Errorf("pid %d: App = %q, want %q", pid, table[pid].App, app)
		}
	}
}

func TestEndableRefusesAnotherAppsWebviewPanes(t *testing.T) {
	if Endable("WebView2: ms-teams.exe") {
		t.Fatal("another app's WebView2 panes are endable")
	}
	if !Endable("ms-teams.exe") {
		t.Fatal("the app itself is not endable")
	}
}
