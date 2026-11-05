// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const RunWorkerSpawnTimeout = 60 * time.Second

var destroyBlockController = blockcontroller.DestroyBlockController

// StopRunWorker ends the worker in tab workerORef for good: the callers abandon it (dispatch failure, retry, cancel,
// merged cleanup), and a retry spawns a new tab rather than restarting this block.
func StopRunWorker(ctx context.Context, workerORef string) error {
	return endRunWorker(ctx, workerORef)
}

// SuspendRunWorker ends the process tree of the worker in tab workerORef to free its memory, but keeps the tab, its
// scrollback and its session: a pause, where StopRunWorker abandons the worker. The block is left disarmed, so no
// resync starts it again, until ResumeRunWorker re-arms it and reopens the session. A closed tab is no error. A var,
// like ResumeRunWorker, so the engine's and the run tree's tests stub it.
var SuspendRunWorker = func(ctx context.Context, workerORef string) error {
	return endRunWorker(ctx, workerORef)
}

// endRunWorker disarms every block of the worker's tab and destroys its controller, which ends the process tree. The
// tab, its scrollback and each block's launch args stay.
func endRunWorker(ctx context.Context, workerORef string) error {
	oref, err := waveobj.ParseORef(workerORef)
	if err != nil {
		return fmt.Errorf("bad worker oref %q: %w", workerORef, err)
	}
	if oref.OType != waveobj.OType_Tab {
		return fmt.Errorf("bad worker oref %q: expected tab", workerORef)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, oref.OID)
	// a finished worker's tab can already be closed; with no tab there is nothing left running to stop
	if errors.Is(err, wstore.ErrNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("loading tab %q: %w", workerORef, err)
	}
	var errs []error
	for _, blockId := range tab.BlockIds {
		// clearing runonstart alone is not a durable stop: the block keeps its controller name, and any
		// ResyncController - the frontend issues one whenever the block renders - builds a fresh
		// controller that starts the command again, a forced resync ignoring runonstart entirely. With no
		// controller name resync destroys instead of creating, so a stopped worker cannot come back. A worker
		// that was only suspended comes back through ResumeRunWorker, which names the controller again.
		meta := waveobj.MetaMapType{
			waveobj.MetaKey_Controller:    "",
			waveobj.MetaKey_CmdRunOnStart: false,
			waveobj.MetaKey_CmdRunOnce:    false,
		}
		if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId), meta, false); err != nil {
			errs = append(errs, fmt.Errorf("disarming block %s: %w", blockId, err))
			continue
		}
		destroyBlockController(blockId)
	}
	return errors.Join(errs...)
}

func StopRunWorkers(ctx context.Context, run *waveobj.Run) error {
	var errs []error
	for i := range run.Phases {
		for _, workerORef := range run.Phases[i].WorkerOrefs {
			if err := StopRunWorker(ctx, workerORef); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", workerORef, err))
			}
		}
	}
	return errors.Join(errs...)
}

// CloseRunWorkerTabs stops each of run's workers and deletes its tab, so its row leaves the cockpit with it. A tab
// already closed is skipped. The workspace updates go out with ctx's when it collects them, else on their own.
func CloseRunWorkerTabs(ctx context.Context, run *waveobj.Run) error {
	if waveobj.ContextGetUpdates(ctx) == nil {
		ctx = waveobj.ContextWithUpdates(ctx)
		defer func() { wps.Broker.SendUpdateEvents(waveobj.ContextGetUpdatesRtn(ctx)) }()
	}
	var errs []error
	for i := range run.Phases {
		for _, workerORef := range run.Phases[i].WorkerOrefs {
			if err := StopRunWorker(ctx, workerORef); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", workerORef, err))
				continue
			}
			tabId := strings.TrimPrefix(workerORef, "tab:")
			workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
			if err != nil {
				errs = append(errs, fmt.Errorf("finding the workspace of tab %s: %w", tabId, err))
				continue
			}
			if workspaceId == "" {
				continue
			}
			if _, err := wcore.DeleteTab(ctx, workspaceId, tabId, false); err != nil {
				errs = append(errs, fmt.Errorf("closing tab %s: %w", tabId, err))
			}
		}
	}
	return errors.Join(errs...)
}
