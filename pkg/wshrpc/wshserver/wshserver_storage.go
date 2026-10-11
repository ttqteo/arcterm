// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"sort"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
	"github.com/wavetermdev/waveterm/pkg/storage"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// storageScanner backs Settings → Storage; StartStorage creates it when the server starts.
var storageScanner *storage.Scanner

var errStorageNotStarted = errors.New("storage is not started")

// StartStorage builds the scanner from the config, the store and the roster, and starts its loop: after
// storage.AutoCleanDelay, then daily, it auto-cleans when storage:autoclean allows it, else only rescans.
func StartStorage(ctx context.Context) {
	dataDir := wavebase.GetWaveDataDir()
	env := &storage.Env{
		Now:              time.Now,
		ProjectPaths:     configProjectPaths,
		RunOfWorktree:    orchestrate.RunOfWorktree,
		RunState:         storageRunState,
		BusyProjects:     storageBusyProjects,
		LiveTranscripts:  openTabTranscripts,
		RemoveWorktree:   orchestrate.RemoveWorktreeKeepBranch,
		DataDir:          dataDir,
		TrashDir:         sessiontrash.TrashDir(),
		SessionDirs:      sessiontrash.ProjectsDirs(),
		WebviewCacheDirs: webviewCacheDirsFor(runtime.GOOS, wavebase.IsDevMode(), wavebase.GetHomeDir(), dataDir),
	}
	storageScanner = storage.NewScanner(env, publishStorageScan)
	storageScanner.StartLoop(ctx, storageAutoCleanOn, storage.AutoCleanDelay, storage.AutoCleanEvery)
}

// webviewCacheDirsFor is the webview cache the Storage card may offer to clear. A Mac dev app shares the packaged
// app's ~/Library/Caches/dev.arc.app/WebKit, so it offers none: clearing it would clear the packaged app's cache.
func webviewCacheDirsFor(goos string, dev bool, home, dataDir string) []string {
	if goos == "darwin" && dev {
		return nil
	}
	return storage.WebviewCacheDirs(goos, home, dataDir)
}

func publishStorageScan(r storage.StorageReport) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_StorageScan, Data: r})
}

func storageAutoCleanOn() bool {
	v := wconfig.GetWatcher().GetFullConfig().Settings.StorageAutoClean
	return v == nil || *v
}

// configProjectPaths is every project path in config, "~" expanded.
func configProjectPaths() []string {
	var paths []string
	for _, p := range wconfig.GetWatcher().GetFullConfig().Projects {
		if p.Path != "" {
			paths = append(paths, wavebase.ExpandHomeDirSafe(p.Path))
		}
	}
	sort.Strings(paths)
	return paths
}

func storageRunState(ctx context.Context, runID string) (storage.RunState, error) {
	run, err := wstore.DBGet[*waveobj.Run](ctx, runID)
	if err != nil {
		return storage.RunState{}, err
	}
	return runStorageState(run), nil
}

// runStorageState is what a run says about its worktree. Finished is done or cancelled, but a done run whose branch
// has not landed is still landing: LandRun retries the merge and re-checks in LandPath, so the tree must stay. A
// blocked run is not finished either: its failed task can be retried.
func runStorageState(run *waveobj.Run) storage.RunState {
	if run == nil {
		return storage.RunState{}
	}
	switch run.Status {
	case jarvis.RunStatus_Done:
		if run.LandPath != "" && (run.Land == nil || run.Land.State != "landed") {
			return storage.RunState{Found: true, Finished: false, Status: "landing"}
		}
		return storage.RunState{Found: true, Finished: true, Status: run.Status}
	case jarvis.RunStatus_Cancelled:
		return storage.RunState{Found: true, Finished: true, Status: run.Status}
	}
	return storage.RunState{Found: true, Finished: false, Status: run.Status}
}

func storageBusyProjects(ctx context.Context) (map[string]string, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	var agents []wshrpc.AgentInfo
	for _, row := range buildAgentRoster(facts) {
		agents = append(agents, row.AgentInfo)
	}
	return busyProjectsOf(agents, facts.Runs), nil
}

// busyProjectsOf names the projects whose build output must stay now, with why: an agent working there, or a run of
// the project still going. A blocked run waits on a retry and builds nothing.
func busyProjectsOf(agents []wshrpc.AgentInfo, runs []*waveobj.Run) map[string]string {
	busy := map[string]string{}
	for _, r := range runs {
		switch r.Status {
		case jarvis.RunStatus_Planning, jarvis.RunStatus_AwaitingReview, jarvis.RunStatus_Executing:
			if r.ProjectPath != "" {
				busy[filepath.Clean(r.ProjectPath)] = "run in progress in this project"
			}
		}
	}
	for _, a := range agents {
		if a.State == baseds.AgentState_Working && a.ProjectPath != "" {
			busy[filepath.Clean(a.ProjectPath)] = "agent working in this project"
		}
	}
	return busy
}

func (ws *WshServer) GetStorageCommand(ctx context.Context) (*storage.StorageReport, error) {
	if storageScanner == nil {
		return nil, errStorageNotStarted
	}
	r := storageScanner.Report()
	return &r, nil
}

func (ws *WshServer) RescanStorageCommand(ctx context.Context) error {
	if storageScanner == nil {
		return errStorageNotStarted
	}
	// not the RPC's context: the scan outlives the call
	storageScanner.Rescan(context.Background())
	return nil
}

func (ws *WshServer) CleanStorageCommand(ctx context.Context, data wshrpc.CommandCleanStorageData) (*storage.StorageCleanResult, error) {
	if storageScanner == nil {
		return nil, errStorageNotStarted
	}
	// a removal half done must finish even if the caller stops waiting
	res, err := storageScanner.Clean(context.WithoutCancel(ctx), storage.StorageCategory(data.Category), data.ItemIds,
		storage.CleanOpts{OlderThanDays: data.OlderThanDays, AllowGuarded: data.AllowGuarded})
	if err != nil {
		return nil, err
	}
	return &res, nil
}
