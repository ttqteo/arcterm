// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The bug reports' half of Jarvis: what the footer's box counts and the Waiting-on-you row says come from one place,
// so the two cannot differ. pkg/bugreport owns the folders and imports neither wstore nor jarvis; this is where a tab
// that no longer exists in the store, and the repo the config names, are put to it.

package jarvis

import (
	"context"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/bugreport"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// bugReportTabAlive says whether the agent that holds reports is still open: its tab is in the store. A store error
// counts as alive (and is logged): a read that failed must never send an agent's reports back to waiting.
func bugReportTabAlive(ctx context.Context) func(tabID string) bool {
	return func(tabID string) bool {
		tab, err := wstore.DBGet[*waveobj.Tab](ctx, strings.TrimPrefix(tabID, "tab:"))
		if err != nil {
			log.Printf("bugreport: cannot tell whether the tab %s is open, keeping its reports held: %v", tabID, err)
			return true
		}
		return tab != nil
	}
}

// ReconcileBugReports sends the reports of an agent that was closed while it held them back to waiting. Every poll and
// every command that reads or changes reports calls it first, like LivePendingAsks does for asks.
func ReconcileBugReports(ctx context.Context) error {
	return bugreport.Default().Reconcile(bugReportTabAlive(ctx))
}

// bugReportRepo is arcterm's checkout from the config: the bugreport:repo setting, else the registered project that is
// the arcterm repo.
func bugReportRepo() (path, project string, ok bool) {
	cfg := wconfig.GetWatcher().GetFullConfig()
	return bugreport.FindRepo(cfg.Settings.BugReportRepo, cfg.Projects)
}

// GatherBugReports is the one read of the reports for the box's count and the Jarvis row: it reconciles, counts what
// waits and what an agent holds, and finds the repo. The second value is when the row's wait began: the oldest waiting
// report's press, or, while an agent holds reports, the oldest claim (the wire's BugReportStatus has no field for it).
func GatherBugReports(ctx context.Context) (wshrpc.BugReportStatus, int64, error) {
	return gatherBugReports(bugreport.Default(), bugReportTabAlive(ctx), bugReportRepo)
}

func gatherBugReports(s *bugreport.Store, alive func(string) bool, repo func() (string, string, bool)) (wshrpc.BugReportStatus, int64, error) {
	// a reconcile that could not write leaves a stale state for one poll, which is better than no count at all
	if err := s.Reconcile(alive); err != nil {
		log.Printf("bugreport: reconcile failed: %v", err)
	}
	waiting, handling, handler, err := s.Status()
	if err != nil {
		return wshrpc.BugReportStatus{}, 0, err
	}
	st := wshrpc.BugReportStatus{Waiting: waiting, Handling: handling, Handler: handler}
	if path, project, ok := repo(); ok {
		st.RepoPath, st.RepoProject = path, project
	}
	if waiting+handling == 0 {
		return st, 0, nil
	}
	reports, err := s.List("")
	if err != nil {
		return wshrpc.BugReportStatus{}, 0, err
	}
	return st, bugReportsWaitingSince(reports, handling > 0), nil
}

// bugReportsWaitingSince is the oldest claim among the handling reports when some are handling, else the oldest press
// among the waiting ones.
func bugReportsWaitingSince(reports []wshrpc.BugReport, handling bool) int64 {
	var since int64
	for _, r := range reports {
		var at int64
		switch {
		case handling && r.State == wshrpc.BugReportState_Handling:
			at = r.ClaimedTs
			if at == 0 {
				at = r.Ts
			}
		case !handling && r.State == wshrpc.BugReportState_Waiting:
			at = r.Ts
		default:
			continue
		}
		if since == 0 || at < since {
			since = at
		}
	}
	return since
}
