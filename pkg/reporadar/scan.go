// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// scanAuditRoute is the route a scan audits on. Tests replace it: the config watcher has no settings there.
var scanAuditRoute = configuredAuditRoute

// StartScan runs a scan for an already-created report in a background goroutine, using the
// manager-owned cancellation context. Call only after mgr.register(reportId) succeeded.
func StartScan(scanCtx context.Context, reportId string) {
	go func() {
		defer func() { panichandler.PanicHandler("reporadar.StartScan", recover()) }()
		defer mgr.done(reportId)
		runScan(scanCtx, reportId)
	}()
}

// StartRetry re-audits a report's failed targets in a background goroutine under the manager-owned
// context. Call only after mgr.register(reportId) succeeded.
func StartRetry(scanCtx context.Context, reportId string, route auditRoute) {
	go func() {
		defer func() { panichandler.PanicHandler("reporadar.StartRetry", recover()) }()
		defer mgr.done(reportId)
		runRetry(scanCtx, reportId, route)
	}()
}

// publish pushes a RadarReport update to the frontend. Tests replace it to watch each update.
var publish = func(reportId string) {
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_RadarReport, reportId))
}

// setStatus persists a status/phase transition and notifies the FE.
func setStatus(ctx context.Context, reportId, status, phase string) {
	if err := wstore.UpdateRadarReport(ctx, reportId, func(r *waveobj.RadarReport) {
		r.Status = status
		r.Phase = phase
	}); err != nil {
		log.Printf("reporadar: setStatus %s: %v", reportId, err)
	}
	publish(reportId)
}

// writeAudit replaces one target's audit in the stored report and publishes it. The match by target key
// happens inside the update, so two audits finishing together cannot overwrite each other, and one commit
// audited by two kinds keeps both rows.
func writeAudit(ctx context.Context, reportId string, audit waveobj.RadarAudit) {
	t := targetOfAudit(audit)
	key := t.Key()
	if err := wstore.UpdateRadarReport(ctx, reportId, func(r *waveobj.RadarReport) {
		for i := range r.Audits {
			if targetOfAudit(r.Audits[i]).Key() == key {
				r.Audits[i] = audit
				return
			}
		}
	}); err != nil {
		log.Printf("reporadar: writing %s audit of %s to report %s: %v", t.Kind, kindOf(t.Kind).label(t), reportId, err)
		return
	}
	publish(reportId)
}

// runAudits audits the targets, at most AuditConcurrency at a time, streaming each one's running and
// finished state to the report. known holds the already-reported sites by file. It returns the findings
// of the audits that came back ok. When ctx is cancelled it returns early and the caller discards the result.
func runAudits(ctx context.Context, reportId string, route auditRoute, projectPath string, targets []auditTarget, known map[string][]knownSite) []waveobj.RadarFinding {
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		byKey = map[string][]waveobj.RadarFinding{}
		slots = make(chan struct{}, AuditConcurrency)
	)
	for _, t := range targets {
		wg.Add(1)
		go func() {
			defer func() { panichandler.PanicHandler("reporadar.runAudits", recover()) }()
			defer wg.Done()
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-slots }()
			if findings, ok := runAudit(ctx, reportId, route, projectPath, t, known[targetFile(t)]); ok {
				mu.Lock()
				byKey[t.Key()] = findings
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	var fresh []waveobj.RadarFinding
	for _, t := range targets { // target order, not finish order, so finding ids are deterministic
		fresh = append(fresh, byKey[t.Key()]...)
	}
	return fresh
}

// runAudit runs one target's audit and writes its outcome. ok is false when the audit failed or the
// scan was cancelled under it.
func runAudit(ctx context.Context, reportId string, route auditRoute, projectPath string, t auditTarget, known []knownSite) ([]waveobj.RadarFinding, bool) {
	audit := auditRow(t, AuditRunning)
	writeAudit(ctx, reportId, audit)
	start := time.Now()
	reply, res, err := runTargetAudit(ctx, route, projectPath, t, known)
	// the scan's own context, not the error: a real session's cancel error does not wrap context.Canceled
	if ctx.Err() != nil {
		return nil, false
	}
	audit.DurationMs = time.Since(start).Milliseconds()
	audit.ResolvedModel = res.Model
	audit.TotalTokens = res.TotalTokens
	audit.CacheReadTokens = res.CacheReadTokens
	audit.RawResponse = clip(Redact(res.Reply), maxRawResponseBytes)
	if err != nil {
		audit.Status = AuditFailed
		audit.Error = err.Error()
		writeAudit(ctx, reportId, audit)
		return nil, false
	}
	findings, kept := targetFindings(projectPath, t, reply)
	audit.Status = AuditOK
	audit.RootCause = Redact(reply.RootCause)
	audit.HitCount = len(reply.Hits)
	audit.KeptCount = kept
	writeAudit(ctx, reportId, audit)
	return findings, true
}

// baselineOf is the newest completed or partial report other than exceptId. reports are newest-first.
func baselineOf(reports []*waveobj.RadarReport, exceptId string) *waveobj.RadarReport {
	for _, r := range reports {
		if r.OID != exceptId && (r.Status == StatusCompleted || r.Status == StatusPartial) {
			return r
		}
	}
	return nil
}

// findingTarget is the keyed part of the target a finding came from: kind, source commit or revision and,
// for hotspot, the file.
func findingTarget(f waveobj.RadarFinding) auditTarget {
	return auditTarget{Kind: kindOfRisk(f.RiskKind), Commit: f.SourceCommit, Files: f.Files}
}

// auditedTargets is the set of target keys a scan must not audit again: every ok audit in a completed or
// partial report, plus the targets of the baseline's findings. reports are newest-first.
func auditedTargets(reports []*waveobj.RadarReport, exceptId string) map[string]bool {
	audited := map[string]bool{}
	for _, r := range reports {
		if r.OID == exceptId || (r.Status != StatusCompleted && r.Status != StatusPartial) {
			continue
		}
		for _, a := range r.Audits {
			if a.Status == AuditOK {
				audited[targetOfAudit(a).Key()] = true
			}
		}
	}
	if baseline := baselineOf(reports, exceptId); baseline != nil {
		for _, f := range baseline.Findings {
			if f.SourceCommit != "" {
				audited[findingTarget(f).Key()] = true
			}
		}
	}
	return audited
}

// carriedCommitClasses is the classifier cache of the project's newest other report that has one, whatever
// its status: a label does not depend on the audits. reports are newest-first.
func carriedCommitClasses(reports []*waveobj.RadarReport, exceptId string) map[string]waveobj.RadarCommitClass {
	for _, r := range reports {
		if r.OID != exceptId && len(r.CommitClasses) > 0 {
			return r.CommitClasses
		}
	}
	return nil
}

// knownSitesByFile lists a report's findings, any kind and any group, as already-reported sites by file.
func knownSitesByFile(rpt *waveobj.RadarReport) map[string][]knownSite {
	known := map[string][]knownSite{}
	if rpt == nil {
		return known
	}
	for _, f := range rpt.Findings {
		if len(f.Files) == 0 || len(f.Sites) == 0 {
			continue
		}
		known[f.Files[0]] = append(known[f.Files[0]], knownSite{Line: f.Sites[0].Line, Risk: f.Risk})
	}
	return known
}

// runScan is the scan sequence: list the window, classify it, select every kind's targets, audit each, then
// reconcile and finalize.
func runScan(ctx context.Context, reportId string) {
	rpt, err := wstore.GetRadarReport(ctx, reportId)
	if err != nil {
		log.Printf("reporadar: runScan load %s: %v", reportId, err)
		return
	}
	setStatus(ctx, reportId, StatusCollecting, "collecting")

	startHead, err := gitHead(ctx, rpt.ProjectPath)
	if err != nil {
		finishFatal(reportId, fmt.Sprintf("not a readable git repository: %v", err))
		return
	}
	route, err := scanAuditRoute()
	if err != nil {
		finishFatal(reportId, err.Error())
		return
	}
	startDirty := gitDirtyFingerprint(ctx, rpt.ProjectPath)
	sinceTs := nowMilli() - EvidenceWindow.Milliseconds()

	commits, err := listWindowCommits(ctx, rpt.ProjectPath, sinceTs)
	if ctx.Err() != nil {
		finishCancelled(reportId)
		return
	}
	if err != nil {
		finishFatal(reportId, err.Error())
		return
	}
	reports, err := wstore.GetRadarReports(ctx, rpt.ProjectPath)
	if err != nil {
		// without the earlier reports every target would be audited again
		finishFatal(reportId, fmt.Sprintf("reading earlier reports: %v", err))
		return
	}
	classified, cls := classifyWindow(ctx, route, rpt.ProjectPath, commits, carriedCommitClasses(reports, reportId), func() {
		setStatus(ctx, reportId, StatusCollecting, "classifying")
	})
	if ctx.Err() != nil {
		finishCancelled(reportId)
		return
	}
	targets := selectAuditTargets(ctx, rpt.ProjectPath, classified, auditedTargets(reports, reportId))
	if ctx.Err() != nil {
		finishCancelled(reportId)
		return
	}
	audits := make([]waveobj.RadarAudit, 0, len(targets))
	for _, t := range targets {
		audits = append(audits, auditRow(t, AuditQueued))
	}
	classifyErr := ""
	if cls.Err != nil {
		classifyErr = cls.Err.Error()
	}
	if err := wstore.UpdateRadarReport(ctx, reportId, func(r *waveobj.RadarReport) {
		r.StartHead = startHead
		r.StartDirty = startDirty
		r.WindowStartTs = sinceTs
		r.CommitClasses = cls.Cache
		r.ClassifyCount = cls.Sent
		r.ClassifyError = classifyErr
		r.ClassifyTokens = cls.Tokens
		r.Audits = audits
		r.Status = StatusClustering
		r.Phase = "clustering"
		r.ClusterStartedTs = nowMilli()
	}); err != nil {
		log.Printf("reporadar: starting audits for %s: %v", reportId, err)
	}
	publish(reportId)

	fresh := runAudits(ctx, reportId, route, rpt.ProjectPath, targets, knownSitesByFile(baselineOf(reports, reportId)))
	if ctx.Err() != nil {
		finishCancelled(reportId)
		return
	}
	finalizeScan(ctx, reportId, route, fresh)
}

// finalizeScan reconciles a first pass's fresh findings against the baseline report and seals the report.
func finalizeScan(ctx context.Context, reportId string, route auditRoute, fresh []waveobj.RadarFinding) {
	rpt, err := wstore.GetRadarReport(ctx, reportId)
	if err != nil {
		log.Printf("reporadar: finalize load %s: %v", reportId, err)
		return
	}
	// resolved after the audits so an investigation recorded while this scan ran is in the baseline
	var baseline []waveobj.RadarFinding
	var priorSignals []waveobj.RadarSignal
	if prev := latestSuccessfulExcluding(ctx, rpt.ProjectPath, reportId); prev != nil {
		priorSignals = prev.Signals
		for _, f := range prev.Findings {
			// no source commit: it came from the retired collectors
			if f.SourceCommit != "" {
				baseline = append(baseline, f)
			}
		}
	}
	freshFPs := map[string]bool{}
	for _, f := range fresh {
		freshFPs[f.Fingerprint] = true
	}
	detected := append([]waveobj.RadarFinding{}, fresh...)
	for _, f := range baseline {
		// its commit is not audited again, so the gate against the current tree stands in for the audit
		if !freshFPs[f.Fingerprint] && stillDetected(rpt.ProjectPath, f) {
			detected = append(detected, f)
		}
	}
	findings := assignFindingIDs(reconcile(detected, baseline))
	refreshInvestigations(ctx, findings)

	endHead, _ := gitHead(ctx, rpt.ProjectPath)
	endDirty := gitDirtyFingerprint(ctx, rpt.ProjectPath)
	// a cancel that lands after the audits loses the race: the finished scan is still written
	if err := wstore.UpdateRadarReport(context.WithoutCancel(ctx), reportId, func(r *waveobj.RadarReport) {
		r.Findings = findings
		r.EndHead = endHead
		r.EndDirty = endDirty
		r.WindowEndTs = nowMilli()
		sealReport(r, route, priorSignals)
	}); err != nil {
		log.Printf("reporadar: finalize %s: %v", reportId, err)
	}
	publish(reportId)
	pruneReports(ctx, rpt.ProjectPath, reportId)
}

// sealReport derives a finished report's scan-wide fields from its audits and findings: status, the
// failed audits' errors and retry candidates, the signals the findings cite, model and tokens.
func sealReport(r *waveobj.RadarReport, route auditRoute, priorSignals []waveobj.RadarSignal) {
	var errs []string
	var scanSignals, candidates []waveobj.RadarSignal
	failed := 0
	r.ResolvedModel = ""
	r.TotalTokens = r.ClassifyTokens
	for _, a := range r.Audits {
		t := targetOfAudit(a)
		sig := targetSignal(t)
		scanSignals = append(scanSignals, sig)
		r.TotalTokens += a.TotalTokens
		if r.ResolvedModel == "" {
			r.ResolvedModel = a.ResolvedModel
		}
		if a.Status == AuditFailed {
			failed++
			candidates = append(candidates, sig)
			errs = append(errs, kindOf(t.Kind).label(t)+": "+a.Error)
		}
	}
	switch {
	case failed > 0 && failed == len(r.Audits):
		r.Status = StatusFailed
	case failed > 0:
		r.Status = StatusPartial
	default:
		r.Status = StatusCompleted
	}
	r.Phase = ""
	r.CompletedTs = nowMilli()
	r.ClusterError = strings.Join(errs, "; ")
	r.Candidates = candidates
	r.Signals = referencedSignals(r.Findings, scanSignals, r.Signals, priorSignals)
	r.ConfiguredModel = route.Runtime
	if route.Model != "" {
		r.ConfiguredModel += ":" + route.Model
	}
}

// failedAuditTargets rebuilds the targets of the report's failed audits from their stored rows.
func failedAuditTargets(rpt *waveobj.RadarReport) []auditTarget {
	var targets []auditTarget
	for _, a := range rpt.Audits {
		if a.Status == AuditFailed {
			targets = append(targets, targetOfAudit(a))
		}
	}
	return targets
}

// runRetry re-audits the targets whose audit failed in this report, without reselecting, and adds
// their findings as New. The report's other audits and findings stay as they are. Its own findings are
// the known sites: they are what the retried findings land beside.
func runRetry(ctx context.Context, reportId string, route auditRoute) {
	rpt, err := wstore.GetRadarReport(ctx, reportId)
	if err != nil {
		log.Printf("reporadar: runRetry load %s: %v", reportId, err)
		return
	}
	targets := failedAuditTargets(rpt)
	retried := map[string]bool{}
	for _, t := range targets {
		retried[t.Key()] = true
	}
	if err := wstore.UpdateRadarReport(ctx, reportId, func(r *waveobj.RadarReport) {
		r.Status = StatusClustering
		r.Phase = "clustering"
		r.ClusterStartedTs = nowMilli()
		for i, a := range r.Audits {
			if t := targetOfAudit(a); retried[t.Key()] {
				r.Audits[i] = auditRow(t, AuditQueued)
			}
		}
	}); err != nil {
		log.Printf("reporadar: starting retry for %s: %v", reportId, err)
	}
	publish(reportId)

	fresh := runAudits(ctx, reportId, route, rpt.ProjectPath, targets, knownSitesByFile(rpt))
	if ctx.Err() != nil {
		// a cancelled retry leaves the report as it was, so a partial report stays the reconcile
		// baseline and its failed audits stay retryable
		if err := wstore.UpdateRadarReport(context.Background(), reportId, func(r *waveobj.RadarReport) {
			r.Status = rpt.Status
			r.Phase = ""
			r.ClusterStartedTs = rpt.ClusterStartedTs
			r.Audits = rpt.Audits
		}); err != nil {
			log.Printf("reporadar: restoring report %s after a cancelled retry: %v", reportId, err)
		}
		publish(reportId)
		return
	}
	// appended inside the update so a disposition set while the retry ran is kept
	if err := wstore.UpdateRadarReport(context.WithoutCancel(ctx), reportId, func(r *waveobj.RadarReport) {
		have := map[string]bool{}
		for _, f := range r.Findings {
			have[f.Fingerprint] = true
		}
		for _, f := range fresh {
			if !have[f.Fingerprint] {
				f.Group = GroupNew
				r.Findings = append(r.Findings, f)
			}
		}
		r.Findings = assignFindingIDs(r.Findings)
		sealReport(r, route, nil)
	}); err != nil {
		log.Printf("reporadar: finishing retry for %s: %v", reportId, err)
	}
	publish(reportId)
	pruneReports(ctx, rpt.ProjectPath, reportId)
}

func finishFatal(reportId, msg string) {
	if err := wstore.UpdateRadarReport(context.Background(), reportId, func(r *waveobj.RadarReport) {
		r.Status = StatusFailed
		r.Phase = ""
		r.FatalError = msg
		r.CompletedTs = nowMilli()
	}); err != nil {
		log.Printf("reporadar: recording fatal error on %s: %v", reportId, err)
	}
	publish(reportId)
}

// finishCancelled ends a cancelled first pass. It keeps no findings, and a cancelled report's audits do
// not count as audited, so the next scan picks the same commits again.
func finishCancelled(reportId string) {
	// context.Background(): the scan ctx is already cancelled, but we still must persist.
	if err := wstore.UpdateRadarReport(context.Background(), reportId, func(r *waveobj.RadarReport) {
		r.Status = StatusCancelled
		r.Phase = ""
		r.CompletedTs = nowMilli()
	}); err != nil {
		log.Printf("reporadar: recording cancel on %s: %v", reportId, err)
	}
	publish(reportId)
}

// RecoverInterruptedScans marks any report stranded in collecting/clustering (from a previous
// process) as failed with "scan-interrupted". Call once at wavesrv startup, after the store is
// initialized.
func RecoverInterruptedScans(ctx context.Context) {
	reports, err := wstore.GetRadarReports(ctx, "")
	if err != nil {
		log.Printf("reporadar: recover: %v", err)
		return
	}
	for _, r := range reports {
		if r.Status == StatusCollecting || r.Status == StatusClustering {
			wstore.UpdateRadarReport(ctx, r.OID, func(rr *waveobj.RadarReport) {
				rr.Status = StatusFailed
				rr.Phase = ""
				rr.FatalError = "scan-interrupted"
				rr.CompletedTs = nowMilli()
			})
		}
	}
}

// latestSuccessfulExcluding returns the newest completed/partial report for projectPath other than
// exceptId — the baseline the current scan reconciles against.
func latestSuccessfulExcluding(ctx context.Context, projectPath, exceptId string) *waveobj.RadarReport {
	reports, _ := wstore.GetRadarReports(ctx, projectPath)
	return baselineOf(reports, exceptId)
}

// pruneReports deletes a project's reports beyond the newest ReportsKeptPerProject. It keeps, whatever
// their age, the latest successful report (the next scan's baseline), the report just finalized, and any
// report with a scan in flight.
func pruneReports(ctx context.Context, projectPath, finalizedId string) {
	reports, err := wstore.GetRadarReports(ctx, projectPath)
	if err != nil {
		log.Printf("reporadar: listing reports to prune for %s: %v", projectPath, err)
		return
	}
	baselineId := ""
	for _, r := range reports { // newest-first
		if r.Status == StatusCompleted || r.Status == StatusPartial {
			baselineId = r.OID
			break
		}
	}
	for i, r := range reports {
		if i < ReportsKeptPerProject || r.OID == baselineId || r.OID == finalizedId || mgr.active(r.OID) {
			continue
		}
		if err := wstore.DeleteRadarReport(ctx, r.OID); err != nil {
			log.Printf("reporadar: pruning report %s: %v", r.OID, err)
		}
	}
}
