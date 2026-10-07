// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// reconcile classifies the findings a scan detected against the baseline (the previous successful
// report's) and carries user state forward. A commit is audited once, so detected holds this scan's
// fresh findings plus the baseline findings that still pass the gate against the current tree.
//   - fingerprint absent in baseline         -> New
//   - baseline open (new/recurring/nolonger) -> Recurring
//   - baseline Dismissed or Suppressed       -> keeps its state; a commit's time never changes, so
//     there is no newer evidence to reopen it
//
// Baseline findings the scan did not detect:
//   - Dismissed/Suppressed       -> carried; a user decision outlives detection
//   - open                       -> carried open until NoLongerAfterMisses consecutive misses
//   - already No longer detected -> dropped
//
// "No longer detected" never means fixed: it means the file or line is gone.
func reconcile(detected, baseline []waveobj.RadarFinding) []waveobj.RadarFinding {
	baseByFP := map[string]waveobj.RadarFinding{}
	for _, f := range baseline {
		baseByFP[f.Fingerprint] = f
	}
	detectedFPs := map[string]bool{}
	var out []waveobj.RadarFinding
	for _, f := range detected {
		detectedFPs[f.Fingerprint] = true
		f.MissCount = 0
		p, existed := baseByFP[f.Fingerprint]
		if !existed {
			f.Group = GroupNew
			out = append(out, f)
			continue
		}
		f.Investigation = p.Investigation // carry the loop's outcome forward, like Disposition (independent of it)
		switch p.Group {
		case GroupSuppressed, GroupDismissed:
			f.Group = p.Group
			f.Disposition = p.Disposition
		default: // new/recurring/nolonger were open
			f.Group = GroupRecurring
		}
		out = append(out, f)
	}
	for _, p := range baseline {
		if detectedFPs[p.Fingerprint] {
			continue
		}
		switch p.Group {
		case GroupNoLonger:
			continue
		case GroupDismissed, GroupSuppressed:
			p.MissCount++
		default:
			p.MissCount++
			if p.MissCount >= NoLongerAfterMisses {
				p.Group = GroupNoLonger
			}
		}
		out = append(out, p)
	}
	return out
}

// referencedSignals returns the signals the findings cite, drawn from the pools in order. Carried
// findings cite signals from earlier reports, so this scan's commits alone would leave them with no
// evidence to show.
func referencedSignals(findings []waveobj.RadarFinding, pools ...[]waveobj.RadarSignal) []waveobj.RadarSignal {
	refIDs := map[string]bool{}
	for _, f := range findings {
		for _, id := range f.SignalIDs {
			refIDs[id] = true
		}
	}
	var kept []waveobj.RadarSignal
	for _, pool := range pools {
		for _, s := range pool {
			if refIDs[s.ID] {
				kept = append(kept, s)
				delete(refIDs, s.ID)
			}
		}
	}
	return kept
}

// assignFindingIDs stamps report-unique, deterministic ids onto the final finding set. A finding id is a
// within-report handle the frontend keys selection and disposition on; it is NOT the cross-scan identity
// (that is the fingerprint). Reconcile carries findings forward from the prior report with their old
// ids, so the whole set is renumbered here, once.
func assignFindingIDs(findings []waveobj.RadarFinding) []waveobj.RadarFinding {
	for i := range findings {
		findings[i].ID = fmt.Sprintf("f%d", i+1)
	}
	return findings
}

// SetDisposition atomically applies a disposition to one finding in a report:
//   dismiss     -> group=dismissed, records reason/note/ts
//   suppress    -> group=suppressed, records reason/note/ts
//   reopen      -> clears a dismissal, group=recurring
//   unsuppress  -> clears a suppression, group=recurring
func SetDisposition(ctx context.Context, reportId, findingId, action, reason, note string) error {
	return wstore.UpdateRadarReport(ctx, reportId, func(r *waveobj.RadarReport) {
		for i := range r.Findings {
			if r.Findings[i].ID != findingId {
				continue
			}
			switch action {
			case "dismiss":
				r.Findings[i].Group = GroupDismissed
				r.Findings[i].Disposition = &waveobj.RadarDisposition{Action: "dismiss", Reason: reason, Note: note, Ts: nowMilli()}
			case "suppress":
				r.Findings[i].Group = GroupSuppressed
				r.Findings[i].Disposition = &waveobj.RadarDisposition{Action: "suppress", Reason: reason, Note: note, Ts: nowMilli()}
			case "reopen", "unsuppress":
				r.Findings[i].Group = GroupRecurring
				r.Findings[i].Disposition = nil
			}
			return
		}
	})
}

// ApplyDisposition validates the action, applies it, and publishes the report update. It is the
// entry point the wshrpc command calls.
func ApplyDisposition(ctx context.Context, reportId, findingId, action, reason, note string) error {
	switch action {
	case "dismiss", "suppress", "reopen", "unsuppress":
	default:
		return fmt.Errorf("unknown disposition action %q", action)
	}
	if err := SetDisposition(ctx, reportId, findingId, action, reason, note); err != nil {
		return err
	}
	publish(reportId)
	return nil
}
