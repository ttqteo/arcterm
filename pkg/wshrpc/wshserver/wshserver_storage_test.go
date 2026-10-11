// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/storage"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestBusyProjectsOfNamesWorkingAgentsAndGoingRuns(t *testing.T) {
	agents := []wshrpc.AgentInfo{
		{ProjectPath: "/p/a", State: baseds.AgentState_Working},
		{ProjectPath: "/p/b", State: baseds.AgentState_Idle},
	}
	runs := []*waveobj.Run{
		{ProjectPath: "/p/c", Status: jarvis.RunStatus_Executing},
		{ProjectPath: "/p/d", Status: jarvis.RunStatus_Done},
		{ProjectPath: "/p/e", Status: jarvis.RunStatus_Blocked},
	}
	busy := busyProjectsOf(agents, runs)
	if busy["/p/a"] != "agent working in this project" || busy["/p/c"] != "run in progress in this project" {
		t.Fatalf("got %v", busy)
	}
	for _, idle := range []string{"/p/b", "/p/d", "/p/e"} {
		if _, ok := busy[idle]; ok {
			t.Fatalf("%s is not busy: %v", idle, busy)
		}
	}
}

func TestStorageCommandsBeforeStartSayItIsNotStarted(t *testing.T) {
	prev := storageScanner
	storageScanner = nil
	t.Cleanup(func() { storageScanner = prev })
	if _, err := (&WshServer{}).GetStorageCommand(context.Background()); err == nil {
		t.Fatal("want an error before StartStorage")
	}
}

func TestRunStorageState(t *testing.T) {
	land := func(state string) *waveobj.RunLand { return &waveobj.RunLand{State: state} }
	cases := []struct {
		name string
		run  *waveobj.Run
		want storage.RunState
	}{
		{"missing run", nil, storage.RunState{}},
		{"done without a land path", &waveobj.Run{Status: jarvis.RunStatus_Done}, storage.RunState{Found: true, Finished: true, Status: "done"}},
		{"done, land path, no land", &waveobj.Run{Status: jarvis.RunStatus_Done, LandPath: "/l"}, storage.RunState{Found: true, Status: "landing"}},
		{"done, land pending", &waveobj.Run{Status: jarvis.RunStatus_Done, LandPath: "/l", Land: land("pending")}, storage.RunState{Found: true, Status: "landing"}},
		{"done, land held", &waveobj.Run{Status: jarvis.RunStatus_Done, LandPath: "/l", Land: land("held")}, storage.RunState{Found: true, Status: "landing"}},
		{"done, landed", &waveobj.Run{Status: jarvis.RunStatus_Done, LandPath: "/l", Land: land("landed")}, storage.RunState{Found: true, Finished: true, Status: "done"}},
		{"cancelled", &waveobj.Run{Status: jarvis.RunStatus_Cancelled, LandPath: "/l"}, storage.RunState{Found: true, Finished: true, Status: "cancelled"}},
		{"blocked", &waveobj.Run{Status: jarvis.RunStatus_Blocked}, storage.RunState{Found: true, Status: "blocked"}},
		{"executing", &waveobj.Run{Status: jarvis.RunStatus_Executing}, storage.RunState{Found: true, Status: "executing"}},
	}
	for _, c := range cases {
		if got := runStorageState(c.run); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestWebviewCacheDirsForOmitsAMacDevApp(t *testing.T) {
	const home, data = "/Users/u", "/Users/u/Library/Application Support/dev.arc.app-dev/data"
	if dirs := webviewCacheDirsFor("darwin", true, home, data); len(dirs) != 0 {
		t.Fatalf("a Mac dev app shares the packaged cache, got %v", dirs)
	}
	if dirs := webviewCacheDirsFor("darwin", false, home, "/Users/u/Library/Application Support/dev.arc.app/data"); len(dirs) != 2 {
		t.Fatalf("the packaged Mac app clears NetworkCache and CacheStorage, got %v", dirs)
	}
	if dirs := webviewCacheDirsFor("windows", true, `C:\base\data`, `C:\base\data`); len(dirs) == 0 {
		t.Fatal("a Windows dev app has its own EBWebView and keeps the card")
	}
}
