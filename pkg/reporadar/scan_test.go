// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func gitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	full := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

const siblingFile = "src/sibling.go"

// newRepo is a temp repo holding one non-fix commit with a three-line sibling file. It returns the
// canonical project path, the form Start stores on a report.
func newRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-q")
	writeFile(t, dir, siblingFile, "package src\n\nfunc sibling() {}\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "chore: seed")
	return canonPath(dir)
}

// commitFix adds one fix commit touching rel and returns its hash.
func commitFix(t *testing.T, dir, rel string) string {
	t.Helper()
	writeFile(t, dir, rel, "package src\n\nfunc fixed() {}\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "fix: guard "+rel)
	head, err := gitHead(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	return head
}

var testRoute = auditRoute{Runtime: AuditRuntimeClaude, Model: DefaultAuditModel}

type sessionFn func(ctx context.Context, commit string) (auditSessionResult, error)

var promptCommitRe = regexp.MustCompile(`fix commit ([0-9a-f]{40})`)

// fakeSessions replaces the session seam and the route for one test. fn gets the commit under audit.
func fakeSessions(t *testing.T, fn sessionFn) {
	t.Helper()
	origSession, origRoute := runAuditSession, scanAuditRoute
	t.Cleanup(func() { runAuditSession, scanAuditRoute = origSession, origRoute })
	scanAuditRoute = func() (auditRoute, error) { return testRoute, nil }
	runAuditSession = func(ctx context.Context, _ auditRoute, _, prompt string) (auditSessionResult, error) {
		m := promptCommitRe.FindStringSubmatch(prompt)
		if m == nil {
			return auditSessionResult{}, errors.New("the prompt names no commit")
		}
		return fn(ctx, m[1])
	}
}

func hitReply(file string, line int) auditSessionResult {
	reply := fmt.Sprintf(`{"rootcause":"nil row","siblings":["callers"],"hits":[{"file":%q,"line":%d,"title":"same nil row","trigger":"an empty table","actual":"panics","expected":"returns nil","whynotcovered":"the fix guards one caller","severity":"high"}]}`, file, line)
	return auditSessionResult{Reply: reply, Model: "claude-sonnet-5-5", TotalTokens: 100, CacheReadTokens: 900}
}

func cleanReply() auditSessionResult {
	return auditSessionResult{Reply: `{"rootcause":"nil row","siblings":["callers"],"hits":[]}`, Model: "claude-sonnet-5-5", TotalTokens: 100}
}

func newReport(t *testing.T, dir string) string {
	t.Helper()
	// reports order by start time in millis; keep two created back to back apart
	time.Sleep(2 * time.Millisecond)
	rpt, err := wstore.CreateRadarReport(context.Background(), "demo", dir)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return rpt.OID
}

func getReport(t *testing.T, reportId string) *waveobj.RadarReport {
	t.Helper()
	rpt, err := wstore.GetRadarReport(context.Background(), reportId)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	return rpt
}

// scan runs one synchronous scan (StartScan only wraps runScan in a goroutine) and returns its report.
func scan(t *testing.T, dir string) *waveobj.RadarReport {
	t.Helper()
	id := newReport(t, dir)
	runScan(context.Background(), id)
	return getReport(t, id)
}

func auditsByStatus(rpt *waveobj.RadarReport) map[string]int {
	out := map[string]int{}
	for _, a := range rpt.Audits {
		out[a.Status]++
	}
	return out
}

func auditOf(t *testing.T, rpt *waveobj.RadarReport, commit string) waveobj.RadarAudit {
	t.Helper()
	for _, a := range rpt.Audits {
		if a.Commit == commit {
			return a
		}
	}
	t.Fatalf("no audit of %s in %+v", commit, rpt.Audits)
	return waveobj.RadarAudit{}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// calls records which commits a fake session was asked to audit.
type calls struct {
	mu      sync.Mutex
	commits []string
}

func (c *calls) add(commit string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.commits = append(c.commits, commit)
}

func (c *calls) list() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.commits...)
}

func TestScanAuditsSelectedFixCommits(t *testing.T) {
	dir := newRepo(t)
	withHit := commitFix(t, dir, "src/a.go")
	gated := commitFix(t, dir, "src/b.go")
	clean := commitFix(t, dir, "src/c.go")
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		switch commit {
		case withHit:
			return hitReply(siblingFile, 3), nil
		case gated:
			return hitReply("src/missing.go", 3), nil
		}
		return cleanReply(), nil
	})

	got := scan(t, dir)
	if got.Status != StatusCompleted || got.ClusterStartedTs == 0 || got.ClusterError != "" {
		t.Fatalf("status %q clusterstartedts %d clustererror %q fatal %q", got.Status, got.ClusterStartedTs, got.ClusterError, got.FatalError)
	}
	if by := auditsByStatus(got); len(got.Audits) != 3 || by[AuditOK] != 3 {
		t.Fatalf("want three ok audits, got %+v", got.Audits)
	}
	if a := auditOf(t, got, withHit); a.HitCount != 1 || a.KeptCount != 1 || a.RootCause != "nil row" || a.RawResponse == "" ||
		a.ResolvedModel != "claude-sonnet-5-5" || a.TotalTokens != 100 || a.CacheReadTokens != 900 || a.Subject != "fix: guard src/a.go" || len(a.Files) != 1 {
		t.Errorf("audit with a kept hit = %+v", a)
	}
	if a := auditOf(t, got, gated); a.HitCount != 1 || a.KeptCount != 0 {
		t.Errorf("a hit failing the gate must count as reported, not kept: %+v", a)
	}
	if a := auditOf(t, got, clean); a.HitCount != 0 || a.KeptCount != 0 {
		t.Errorf("clean audit = %+v", a)
	}
	if len(got.Findings) != 1 {
		t.Fatalf("want one finding, got %+v", got.Findings)
	}
	f := got.Findings[0]
	if f.ID != "f1" || f.Group != GroupNew || f.SourceCommit != withHit || len(f.Sites) != 1 || !strings.HasPrefix(f.Fingerprint, "RAD-") {
		t.Errorf("finding = %+v", f)
	}
	if !strings.Contains(f.Mission, siblingFile+":3") {
		t.Errorf("the mission must name the site as file:line, got %q", f.Mission)
	}
	if len(f.SignalIDs) != 1 || len(got.Signals) != 1 || got.Signals[0].ID != f.SignalIDs[0] || got.Signals[0].SourceRef != "commit:"+withHit {
		t.Errorf("the report must keep the one signal the finding cites, got ids %v signals %+v", f.SignalIDs, got.Signals)
	}
	if got.ConfiguredModel != "claude:sonnet" || got.ResolvedModel != "claude-sonnet-5-5" || got.TotalTokens != 300 {
		t.Errorf("model %q resolved %q tokens %d", got.ConfiguredModel, got.ResolvedModel, got.TotalTokens)
	}
	if len(got.Candidates) != 0 {
		t.Errorf("no audit failed, so there is nothing to retry: %+v", got.Candidates)
	}
}

func TestScanStreamsAuditProgress(t *testing.T) {
	dir := newRepo(t)
	const commits = AuditConcurrency + 2
	for i := 0; i < commits; i++ {
		commitFix(t, dir, fmt.Sprintf("src/f%d.go", i))
	}
	entered := make(chan struct{}, commits)
	release := make(chan struct{})
	var running, peak atomic.Int32
	fakeSessions(t, func(context.Context, string) (auditSessionResult, error) {
		if n := running.Add(1); n > peak.Load() {
			peak.Store(n)
		}
		defer running.Add(-1)
		entered <- struct{}{}
		<-release
		return cleanReply(), nil
	})
	id := newReport(t, dir)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runScan(context.Background(), id)
	}()
	enter := func(n int) {
		t.Helper()
		for i := 0; i < n; i++ {
			select {
			case <-entered:
			case <-time.After(10 * time.Second):
				t.Fatal("an audit session did not start")
			}
		}
	}

	enter(AuditConcurrency)
	got := getReport(t, id)
	if by := auditsByStatus(got); got.Status != StatusClustering || by[AuditRunning] != AuditConcurrency || by[AuditQueued] != 2 {
		t.Fatalf("with every slot busy: status %q audits %v", got.Status, by)
	}
	release <- struct{}{}
	enter(1)
	got = getReport(t, id)
	if by := auditsByStatus(got); got.Status != StatusClustering || by[AuditOK] != 1 || by[AuditRunning] != AuditConcurrency || by[AuditQueued] != 1 {
		t.Fatalf("after one finished: status %q audits %v", got.Status, by)
	}
	close(release)
	<-done
	got = getReport(t, id)
	if by := auditsByStatus(got); got.Status != StatusCompleted || by[AuditOK] != commits {
		t.Fatalf("at the end: status %q audits %v", got.Status, by)
	}
	if peak.Load() > AuditConcurrency {
		t.Fatalf("%d sessions ran at once, the limit is %d", peak.Load(), AuditConcurrency)
	}
}

func TestScanPartialAndFailed(t *testing.T) {
	dir := newRepo(t)
	bad := commitFix(t, dir, "src/a.go")
	commitFix(t, dir, "src/b.go")
	commitFix(t, dir, "src/c.go")

	t.Run("one failed audit makes the report partial", func(t *testing.T) {
		fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
			if commit == bad {
				return auditSessionResult{Reply: "not json", TotalTokens: 5}, nil
			}
			return cleanReply(), nil
		})
		got := scan(t, dir)
		if by := auditsByStatus(got); got.Status != StatusPartial || by[AuditOK] != 2 || by[AuditFailed] != 1 {
			t.Fatalf("status %q audits %v", got.Status, by)
		}
		if a := auditOf(t, got, bad); a.Error == "" || a.RawResponse != "not json" {
			t.Errorf("failed audit = %+v", a)
		}
		if !strings.Contains(got.ClusterError, shortCommit(bad)+": ") {
			t.Errorf("clustererror must name the failed commit's short hash, got %q", got.ClusterError)
		}
		if len(got.Candidates) != 1 || got.Candidates[0].SourceRef != "commit:"+bad {
			t.Errorf("candidates must hold the failed commit's signal, got %+v", got.Candidates)
		}
	})

	t.Run("every audit failing makes the report failed", func(t *testing.T) {
		dir := newRepo(t)
		commitFix(t, dir, "src/a.go")
		commitFix(t, dir, "src/b.go")
		fakeSessions(t, func(context.Context, string) (auditSessionResult, error) {
			return auditSessionResult{}, errors.New("claude is not installed")
		})
		got := scan(t, dir)
		if got.Status != StatusFailed || got.FatalError != "" || len(got.Candidates) != 2 || !strings.Contains(got.ClusterError, "claude is not installed") {
			t.Fatalf("status %q fatal %q candidates %d clustererror %q", got.Status, got.FatalError, len(got.Candidates), got.ClusterError)
		}
	})

	t.Run("an unknown audit runtime is fatal and named", func(t *testing.T) {
		fakeSessions(t, func(context.Context, string) (auditSessionResult, error) {
			t.Error("no session may run")
			return auditSessionResult{}, nil
		})
		scanAuditRoute = func() (auditRoute, error) { return resolveAuditRoute("codex", "") }
		got := scan(t, dir)
		if got.Status != StatusFailed || !strings.Contains(got.FatalError, "codex") || len(got.Audits) != 0 {
			t.Fatalf("status %q fatal %q audits %d", got.Status, got.FatalError, len(got.Audits))
		}
	})

	t.Run("an unreadable repository is fatal", func(t *testing.T) {
		fakeSessions(t, func(context.Context, string) (auditSessionResult, error) { return cleanReply(), nil })
		got := scan(t, canonPath(t.TempDir()))
		if got.Status != StatusFailed || !strings.Contains(got.FatalError, "not a readable git repository") {
			t.Fatalf("status %q fatal %q", got.Status, got.FatalError)
		}
	})
}

// carried is a baseline finding from an earlier fix-sibling audit, pointing at the repo's sibling file.
func carried(fp, group string) (waveobj.RadarFinding, waveobj.RadarSignal) {
	sig := commitSignal(fixCommit{Hash: "feedbeef" + fp, Subject: "fix: earlier", Ts: 1000, Files: []string{"src/old.go"}})
	return waveobj.RadarFinding{
		ID: "f9", Fingerprint: fp, Group: group, RiskKind: RiskSiblingBug, Risk: "same nil row", Severity: SeverityHigh,
		SignalIDs: []string{sig.ID}, Files: []string{siblingFile}, SourceCommit: "feedbeef" + fp,
		Sites: []waveobj.RadarSite{{Line: 3, Trigger: "an empty table"}},
	}, sig
}

// seedBaseline stores a completed report holding the findings, as an earlier scan would have left it.
func seedBaseline(t *testing.T, dir string, signals []waveobj.RadarSignal, findings ...waveobj.RadarFinding) string {
	t.Helper()
	id := newReport(t, dir)
	if err := wstore.UpdateRadarReport(context.Background(), id, func(r *waveobj.RadarReport) {
		r.Status = StatusCompleted
		r.Findings = findings
		r.Signals = signals
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestScanNoFixCommits(t *testing.T) {
	dir := newRepo(t)
	fakeSessions(t, func(context.Context, string) (auditSessionResult, error) {
		t.Error("no session may run without a fix commit")
		return auditSessionResult{}, nil
	})
	f, sig := carried("RAD-carried", GroupNew)
	seedBaseline(t, dir, []waveobj.RadarSignal{sig}, f)

	got := scan(t, dir)
	if got.Status != StatusCompleted || len(got.Audits) != 0 || got.ClusterStartedTs == 0 {
		t.Fatalf("status %q audits %d clusterstartedts %d", got.Status, len(got.Audits), got.ClusterStartedTs)
	}
	if len(got.Findings) != 1 || got.Findings[0].Group != GroupRecurring || got.Findings[0].ID != "f1" {
		t.Fatalf("the carried finding must reconcile to recurring, got %+v", got.Findings)
	}
	if len(got.Signals) != 1 || got.Signals[0].ID != sig.ID {
		t.Fatalf("the carried finding must keep the signal it cites, got %+v", got.Signals)
	}
}

func TestScanCancel(t *testing.T) {
	dir := newRepo(t)
	slow := commitFix(t, dir, "src/a.go")
	commitFix(t, dir, "src/b.go")
	commitFix(t, dir, "src/c.go")
	fakeSessions(t, func(ctx context.Context, commit string) (auditSessionResult, error) {
		if commit != slow {
			return hitReply(siblingFile, 3), nil
		}
		<-ctx.Done()
		// what a real session returns: the cancel is not in the error chain
		return auditSessionResult{}, errors.New("context canceled")
	})
	id := newReport(t, dir)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runScan(ctx, id)
	}()
	waitFor(t, "the two quick audits", func() bool { return auditsByStatus(getReport(t, id))[AuditOK] == 2 })
	cancel()
	<-done

	got := getReport(t, id)
	if got.Status != StatusCancelled || len(got.Findings) != 0 {
		t.Fatalf("status %q findings %d", got.Status, len(got.Findings))
	}
	if by := auditsByStatus(got); by[AuditFailed] != 0 {
		t.Fatalf("a cancelled audit is not a failed one: %v", by)
	}

	var seen calls
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		seen.add(commit)
		return cleanReply(), nil
	})
	if next := scan(t, dir); len(seen.list()) != 3 || auditsByStatus(next)[AuditOK] != 3 {
		t.Fatalf("a cancelled scan's audits must not count as audited: audited %v", seen.list())
	}
}

func TestRescanSkipsAuditedCommits(t *testing.T) {
	dir := newRepo(t)
	bad := commitFix(t, dir, "src/a.go")
	commitFix(t, dir, "src/b.go")
	commitFix(t, dir, "src/c.go")
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		if commit == bad {
			return auditSessionResult{}, errors.New("boom")
		}
		return cleanReply(), nil
	})
	if first := scan(t, dir); first.Status != StatusPartial {
		t.Fatalf("first scan status %q", first.Status)
	}

	var seen calls
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		seen.add(commit)
		return cleanReply(), nil
	})
	second := scan(t, dir)
	if got := seen.list(); len(got) != 1 || got[0] != bad {
		t.Fatalf("the second scan must audit only the commit whose audit failed, audited %v", got)
	}
	if second.Status != StatusCompleted || len(second.Audits) != 1 {
		t.Fatalf("second scan status %q audits %+v", second.Status, second.Audits)
	}
}

// review focus 5: audits finishing at the same moment must each land.
func TestConcurrentAuditUpdates(t *testing.T) {
	ctx := context.Background()
	id := newReport(t, canonPath(t.TempDir()))
	var audits []waveobj.RadarAudit
	for i := 0; i < FixAuditsPerScan; i++ {
		audits = append(audits, waveobj.RadarAudit{Commit: fmt.Sprintf("commit%d", i), Status: AuditQueued})
	}
	if err := wstore.UpdateRadarReport(ctx, id, func(r *waveobj.RadarReport) { r.Audits = audits }); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, a := range audits {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			a.Status = AuditOK
			a.KeptCount = 1
			writeAudit(ctx, id, a)
		}()
	}
	close(start)
	wg.Wait()
	got := getReport(t, id)
	if by := auditsByStatus(got); len(got.Audits) != FixAuditsPerScan || by[AuditOK] != FixAuditsPerScan {
		t.Fatalf("want %d ok audits, got %v", FixAuditsPerScan, by)
	}
}
