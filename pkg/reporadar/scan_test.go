// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"sort"
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

// commitAs commits the files, path to content, under subject and returns the hash.
func commitAs(t *testing.T, dir, subject string, files map[string]string) string {
	t.Helper()
	for rel, content := range files {
		writeFile(t, dir, rel, content)
	}
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", subject)
	head, err := gitHead(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	return head
}

// commitFix adds one fix commit touching rel and returns its hash.
func commitFix(t *testing.T, dir, rel string) string {
	t.Helper()
	return commitAs(t, dir, "fix: guard "+rel, map[string]string{rel: "package src\n\nfunc fixed() {}\n"})
}

// goLines is a Go file of n lines, enough churn for an introduced audit at n >= IntroducedMinLines.
func goLines(n int) string {
	var b strings.Builder
	b.WriteString("package src\n")
	for i := 1; i < n; i++ {
		fmt.Fprintf(&b, "// line %d\n", i)
	}
	return b.String()
}

var testRoute = auditRoute{Runtime: AuditRuntimeClaude, Model: DefaultAuditModel}

type sessionFn func(ctx context.Context, commit string) (auditSessionResult, error)

// kindSessionFn gets what a session was asked: kind is an audit kind or sessionClassify; ref is the
// audited commit, or the file for hotspot.
type kindSessionFn func(ctx context.Context, kind, ref, prompt string) (auditSessionResult, error)

const sessionClassify = "classify"

var (
	promptCommitRe     = regexp.MustCompile(`fix commit ([0-9a-f]{40})`)
	promptIntroducedRe = regexp.MustCompile(`reviewing commit ([0-9a-f]{40})`)
	promptHotspotRe    = regexp.MustCompile(`You are reviewing (\S+), which`)
)

func promptTarget(prompt string) (kind, ref string) {
	if strings.Contains(prompt, classifyBegin) {
		return sessionClassify, ""
	}
	// introduced before hotspot: both prompts open with "You are reviewing"
	for _, p := range []struct {
		kind string
		re   *regexp.Regexp
	}{{KindSibling, promptCommitRe}, {KindIntroduced, promptIntroducedRe}, {KindHotspot, promptHotspotRe}} {
		if m := p.re.FindStringSubmatch(prompt); m != nil {
			return p.kind, m[1]
		}
	}
	return "", ""
}

// fakeKindSessions replaces the session seam and the route for one test.
func fakeKindSessions(t *testing.T, fn kindSessionFn) {
	t.Helper()
	origSession, origRoute := runAuditSession, scanAuditRoute
	t.Cleanup(func() { runAuditSession, scanAuditRoute = origSession, origRoute })
	scanAuditRoute = func() (auditRoute, error) { return testRoute, nil }
	runAuditSession = func(ctx context.Context, _ auditRoute, _, prompt string) (auditSessionResult, error) {
		kind, ref := promptTarget(prompt)
		if kind == "" {
			return auditSessionResult{}, errors.New("the prompt names no target")
		}
		return fn(ctx, kind, ref, prompt)
	}
}

// fakeSessions is fakeKindSessions for sibling audits alone. fn gets the commit under audit.
func fakeSessions(t *testing.T, fn sessionFn) {
	t.Helper()
	fakeKindSessions(t, func(ctx context.Context, kind, ref, _ string) (auditSessionResult, error) {
		if kind != KindSibling {
			return auditSessionResult{}, fmt.Errorf("unexpected %s session", kind)
		}
		return fn(ctx, ref)
	})
}

func hitReply(file string, line int) auditSessionResult {
	return rootCauseHitReply("nil row", file, line)
}

func rootCauseHitReply(rootCause, file string, line int) auditSessionResult {
	reply := fmt.Sprintf(`{"rootcause":%q,"siblings":["callers"],"hits":[{"file":%q,"line":%d,"title":"same nil row","trigger":"an empty table","actual":"panics","expected":"returns nil","whynotcovered":"the fix guards one caller","severity":"high"}]}`, rootCause, file, line)
	return auditSessionResult{Reply: reply, Model: "claude-sonnet-5-5", TotalTokens: 100, CacheReadTokens: 900}
}

// classifyReply is the classifier's reply labelling the commits, keyed as the prompt keys them.
func classifyReply(labels map[string]waveobj.RadarCommitClass) auditSessionResult {
	byKey := map[string]waveobj.RadarCommitClass{}
	for hash, cls := range labels {
		byKey[hash12(hash)] = cls
	}
	reply, _ := json.Marshal(byKey)
	return auditSessionResult{Reply: string(reply), Model: "claude-haiku-5-5", TotalTokens: 7}
}

// phaseLog records the phase every publish of a report carried.
type phaseLog struct {
	mu       sync.Mutex
	byReport map[string][]string
}

func watchPhases(t *testing.T) *phaseLog {
	t.Helper()
	orig := publish
	t.Cleanup(func() { publish = orig })
	l := &phaseLog{byReport: map[string][]string{}}
	publish = func(reportId string) {
		if r, err := wstore.GetRadarReport(context.Background(), reportId); err == nil {
			l.mu.Lock()
			l.byReport[reportId] = append(l.byReport[reportId], r.Phase)
			l.mu.Unlock()
		}
		orig(reportId)
	}
	return l
}

func (l *phaseLog) of(reportId string) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.byReport[reportId]...)
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
	sig := targetSignal(auditTarget{Kind: KindSibling, Commit: "feedbeef" + fp, Subject: "fix: earlier", Ts: 1000, Files: []string{"src/old.go"}})
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
	for i := 0; i < SiblingAuditsPerScan; i++ {
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
	if by := auditsByStatus(got); len(got.Audits) != SiblingAuditsPerScan || by[AuditOK] != SiblingAuditsPerScan {
		t.Fatalf("want %d ok audits, got %v", SiblingAuditsPerScan, by)
	}
}

func auditRefsByKind(rpt *waveobj.RadarReport) map[string][]string {
	out := map[string][]string{}
	for _, a := range rpt.Audits {
		ref := a.Commit
		if a.Kind == KindHotspot {
			ref = targetFile(targetOfAudit(a))
		}
		out[a.Kind] = append(out[a.Kind], ref)
	}
	return out
}

func findingOfKind(t *testing.T, rpt *waveobj.RadarReport, riskKind string) waveobj.RadarFinding {
	t.Helper()
	for _, f := range rpt.Findings {
		if f.RiskKind == riskKind {
			return f
		}
	}
	t.Fatalf("no %s finding in %+v", riskKind, rpt.Findings)
	return waveobj.RadarFinding{}
}

// hotRepo is a repo whose src/hot.go took two fix commits, so it is a hotspot target at the second.
func hotRepo(t *testing.T) (dir, revision string) {
	t.Helper()
	dir = newRepo(t)
	commitAs(t, dir, "fix: a", map[string]string{"src/hot.go": "package src\n\nfunc a() {}\n"})
	revision = commitAs(t, dir, "fix: b", map[string]string{"src/hot.go": "package src\n\nfunc b() {}\n"})
	return dir, revision
}

func TestScanMixedKinds(t *testing.T) {
	dir, revision := hotRepo(t)
	feat := commitAs(t, dir, "feat: add the feature", map[string]string{"src/feature.go": goLines(60)})
	alert := commitAs(t, dir, "Alert: tune the retry", map[string]string{"src/alert.go": "package src\n\nfunc alert() {}\n"})
	phases := watchPhases(t)
	id := newReport(t, dir)
	var classifyPhase string
	fakeKindSessions(t, func(_ context.Context, kind, ref, _ string) (auditSessionResult, error) {
		switch kind {
		case sessionClassify:
			classifyPhase = getReport(t, id).Phase
			return classifyReply(map[string]waveobj.RadarCommitClass{alert: {Fix: true}}), nil
		case KindSibling:
			if ref == alert {
				return hitReply(siblingFile, 3), nil
			}
			return cleanReply(), nil
		case KindIntroduced:
			return hitReply("src/feature.go", 2), nil
		}
		return hitReply("src/hot.go", 1), nil
	})
	runScan(context.Background(), id)
	got := getReport(t, id)

	if got.Status != StatusCompleted || got.ClusterError != "" {
		t.Fatalf("status %q clustererror %q fatal %q", got.Status, got.ClusterError, got.FatalError)
	}
	if classifyPhase != "classifying" {
		t.Errorf("the phase while the classifier ran = %q, want classifying", classifyPhase)
	}
	if p := strings.Join(phases.of(id), ","); !strings.Contains(p, "collecting,classifying,clustering") {
		t.Errorf("published phases %q must pass collecting, classifying, clustering in order", p)
	}
	kinds := auditRefsByKind(got)
	if len(kinds[KindSibling]) != 3 || !slices.Contains(kinds[KindSibling], alert) {
		t.Errorf("sibling audits = %v, want the two prefixed fixes and the model-labelled one", kinds[KindSibling])
	}
	if strings.Join(kinds[KindIntroduced], ",") != feat || strings.Join(kinds[KindHotspot], ",") != "src/hot.go" || len(got.Audits) != 5 {
		t.Errorf("audits by kind = %v", kinds)
	}
	for _, a := range got.Audits {
		if a.Status != AuditOK {
			t.Errorf("%s audit of %s = %s", a.Kind, a.Commit, a.Status)
		}
		if a.Kind == KindHotspot && (a.Commit != revision || strings.Join(a.FixSubjects, "|") != "fix: b|fix: a") {
			t.Errorf("hotspot audit = %+v, want revision %s and both fix subjects", a, revision)
		}
	}
	if got.ClassifyCount != 1 || got.ClassifyError != "" || got.ClassifyTokens != 7 || len(got.CommitClasses) != 1 || !got.CommitClasses[alert].Fix {
		t.Errorf("classify count %d error %q tokens %d classes %v", got.ClassifyCount, got.ClassifyError, got.ClassifyTokens, got.CommitClasses)
	}
	if got.TotalTokens != 7+5*100 {
		t.Errorf("total tokens %d, want the classifier's plus every audit's", got.TotalTokens)
	}
	if len(got.Findings) != 3 {
		t.Fatalf("want one finding per kind, got %+v", got.Findings)
	}
	if f := findingOfKind(t, got, RiskSiblingBug); f.SourceCommit != alert {
		t.Errorf("sibling finding = %+v", f)
	}
	if f := findingOfKind(t, got, RiskIntroducedBug); f.SourceCommit != feat || !strings.Contains(f.Mission, "changed behavior") {
		t.Errorf("introduced finding = %+v", f)
	}
	if f := findingOfKind(t, got, RiskHotspotBug); f.SourceCommit != revision || len(f.FixSubjects) != 2 || !strings.HasPrefix(f.Mission, "src/hot.go took 2 fix commits") {
		t.Errorf("hotspot finding = %+v", f)
	}
}

// review focus 1: one commit audited by two kinds keeps both rows.
func TestScanSameCommitTwoKinds(t *testing.T) {
	dir := newRepo(t)
	both := commitAs(t, dir, "Tighten the timeout", map[string]string{"src/timeout.go": goLines(60)})
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	fakeKindSessions(t, func(_ context.Context, kind, _, _ string) (auditSessionResult, error) {
		if kind == sessionClassify {
			return classifyReply(map[string]waveobj.RadarCommitClass{both: {Fix: true, Behavior: true}}), nil
		}
		// both audits run at once, so their running and finished writes interleave
		entered <- struct{}{}
		<-release
		if kind == KindSibling {
			return rootCauseHitReply("sibling cause", "src/timeout.go", 2), nil
		}
		return rootCauseHitReply("introduced intent", "src/timeout.go", 3), nil
	})
	id := newReport(t, dir)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runScan(context.Background(), id)
	}()
	for i := 0; i < 2; i++ {
		select {
		case <-entered:
		case <-time.After(10 * time.Second):
			t.Fatal("both audits must run at once")
		}
	}
	if mid := getReport(t, id); auditsByStatus(mid)[AuditRunning] != 2 {
		t.Errorf("both rows must show running, got %+v", mid.Audits)
	}
	close(release)
	<-done

	got := getReport(t, id)
	if got.Status != StatusCompleted || len(got.Audits) != 2 {
		t.Fatalf("status %q audits %+v", got.Status, got.Audits)
	}
	roots := map[string]string{}
	for _, a := range got.Audits {
		if a.Commit != both || a.Status != AuditOK {
			t.Errorf("audit = %+v", a)
		}
		roots[a.Kind] = a.RootCause
	}
	if roots[KindSibling] != "sibling cause" || roots[KindIntroduced] != "introduced intent" {
		t.Errorf("each kind's row must hold its own result, got %v", roots)
	}
	sib, intro := findingOfKind(t, got, RiskSiblingBug), findingOfKind(t, got, RiskIntroducedBug)
	if sib.Fingerprint == intro.Fingerprint || sib.SignalIDs[0] == intro.SignalIDs[0] {
		t.Errorf("the two kinds' findings must differ in identity and signal: %+v / %+v", sib, intro)
	}
	refs := map[string]string{}
	for _, s := range got.Signals {
		refs[s.ID] = s.SourceRef
	}
	if refs[sib.SignalIDs[0]] != "commit:"+both || refs[intro.SignalIDs[0]] != "introduced:"+both {
		t.Errorf("report signals must hold both kinds' signals, got %v", refs)
	}
}

func TestScanClassifyFailureStillAudits(t *testing.T) {
	dir := newRepo(t)
	fixed := commitFix(t, dir, "src/a.go")
	commitAs(t, dir, "Alert: tune the retry", map[string]string{"src/alert.go": "package src\n"})
	var seen calls
	fakeKindSessions(t, func(_ context.Context, kind, ref, _ string) (auditSessionResult, error) {
		if kind == sessionClassify {
			return auditSessionResult{TotalTokens: 7}, errors.New("rate limited")
		}
		seen.add(kind + " " + ref)
		return cleanReply(), nil
	})
	got := scan(t, dir)
	if got.Status != StatusCompleted || got.ClusterError != "" {
		t.Fatalf("a classifier failure must not fail the scan: status %q clustererror %q", got.Status, got.ClusterError)
	}
	if !strings.Contains(got.ClassifyError, "commit classification") || !strings.Contains(got.ClassifyError, "rate limited") ||
		got.ClassifyCount != 1 || got.ClassifyTokens != 7 || len(got.CommitClasses) != 0 {
		t.Errorf("classify error %q count %d tokens %d classes %v", got.ClassifyError, got.ClassifyCount, got.ClassifyTokens, got.CommitClasses)
	}
	if s := seen.list(); len(s) != 1 || s[0] != KindSibling+" "+fixed {
		t.Errorf("only the prefixed fix may be audited, audited %v", s)
	}
	if got.TotalTokens != 7+100 {
		t.Errorf("total tokens %d, want the failed classifier's too", got.TotalTokens)
	}
}

func TestScanCarriesCommitClasses(t *testing.T) {
	dir := newRepo(t)
	alert := commitAs(t, dir, "Alert: tune the retry", map[string]string{"src/alert.go": "package src\n"})
	phases := watchPhases(t)
	fakeKindSessions(t, func(_ context.Context, kind, _, _ string) (auditSessionResult, error) {
		if kind == sessionClassify {
			return classifyReply(map[string]waveobj.RadarCommitClass{alert: {Fix: true}}), nil
		}
		return auditSessionResult{}, errors.New("boom")
	})
	first := scan(t, dir)
	if first.Status != StatusFailed || !first.CommitClasses[alert].Fix || !slices.Contains(phases.of(first.OID), "classifying") {
		t.Fatalf("fixture: status %q classes %v phases %v", first.Status, first.CommitClasses, phases.of(first.OID))
	}

	var seen calls
	fakeKindSessions(t, func(_ context.Context, kind, ref, _ string) (auditSessionResult, error) {
		if kind == sessionClassify {
			t.Error("a cached commit must not be sent to the classifier again")
		}
		seen.add(ref)
		return cleanReply(), nil
	})
	second := scan(t, dir)
	if slices.Contains(phases.of(second.OID), "classifying") {
		t.Errorf("a fully cached scan must never reach classifying, published %v", phases.of(second.OID))
	}
	if second.ClassifyCount != 0 || !second.CommitClasses[alert].Fix {
		t.Errorf("classify count %d classes %v; the label carries from a failed report too", second.ClassifyCount, second.CommitClasses)
	}
	if s := seen.list(); len(s) != 1 || s[0] != alert {
		t.Errorf("the cached label still selects the commit, audited %v", s)
	}
}

// review focus 5: a report stored before the kinds exists keeps excluding its audited commits.
func TestAuditedTargetsLegacyAudits(t *testing.T) {
	reports := []*waveobj.RadarReport{{
		OID: "legacy", Status: StatusCompleted,
		Audits: []waveobj.RadarAudit{{Commit: "c1", Status: AuditOK}, {Commit: "c2", Status: AuditFailed}},
		Findings: []waveobj.RadarFinding{
			{RiskKind: RiskSiblingBug, SourceCommit: "c3", Files: []string{"a.go"}},
			{SourceCommit: "c4", Files: []string{"b.go"}},
		},
	}}
	sibling := func(c string) string { return auditTarget{Kind: KindSibling, Commit: c}.Key() }
	want := map[string]bool{sibling("c1"): true, sibling("c3"): true, sibling("c4"): true}
	if got := auditedTargets(reports, ""); !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", keys(got), keys(want))
	}

	dir := newRepo(t)
	fixed := commitFix(t, dir, "src/a.go")
	f, sig := carried("RAD-legacy", GroupNew)
	id := seedBaseline(t, dir, []waveobj.RadarSignal{sig}, f)
	if err := wstore.UpdateRadarReport(context.Background(), id, func(r *waveobj.RadarReport) {
		r.Audits = []waveobj.RadarAudit{{Commit: fixed, Subject: "fix: guard src/a.go", Files: []string{"src/a.go"}, Status: AuditOK}}
	}); err != nil {
		t.Fatal(err)
	}
	fakeKindSessions(t, func(_ context.Context, kind, ref, _ string) (auditSessionResult, error) {
		t.Errorf("no session may run: %s %s", kind, ref)
		return auditSessionResult{}, nil
	})
	got := scan(t, dir)
	if got.Status != StatusCompleted || len(got.Audits) != 0 || len(got.Findings) != 1 || got.Findings[0].Group != GroupRecurring {
		t.Fatalf("status %q audits %+v findings %+v", got.Status, got.Audits, got.Findings)
	}
}

func keys(m map[string]bool) []string {
	var out []string
	for k := range m {
		out = append(out, strings.ReplaceAll(k, "\x00", " "))
	}
	sort.Strings(out)
	return out
}

func TestAuditedTargetsPerKind(t *testing.T) {
	key := func(kind, commit string, files ...string) string {
		return auditTarget{Kind: kind, Commit: commit, Files: files}.Key()
	}
	reports := []*waveobj.RadarReport{ // newest first
		{OID: "self", Status: StatusCompleted, Audits: []waveobj.RadarAudit{{Kind: KindSibling, Commit: "s-self", Status: AuditOK}}},
		{OID: "cancelled", Status: StatusCancelled, Audits: []waveobj.RadarAudit{{Kind: KindSibling, Commit: "s-cancelled", Status: AuditOK}}},
		{OID: "baseline", Status: StatusCompleted, Findings: []waveobj.RadarFinding{
			{RiskKind: RiskIntroducedBug, SourceCommit: "i-finding", Files: []string{"x.go"}},
			{RiskKind: RiskHotspotBug, SourceCommit: "r-finding", Files: []string{"hot.go"}},
			{RiskKind: RiskSiblingBug, Files: []string{"y.go"}}, // a retired collector's: no source commit
		}},
		{OID: "older", Status: StatusPartial,
			Audits: []waveobj.RadarAudit{
				{Kind: KindIntroduced, Commit: "i-ok", Status: AuditOK},
				{Kind: KindHotspot, Commit: "r-ok", Files: []string{"hot.go"}, Status: AuditOK},
				{Kind: KindHotspot, Commit: "r-failed", Files: []string{"b.go"}, Status: AuditFailed},
			},
			Findings: []waveobj.RadarFinding{{RiskKind: RiskIntroducedBug, SourceCommit: "i-older-finding"}},
		},
	}
	want := map[string]bool{
		key(KindIntroduced, "i-finding"):        true,
		key(KindHotspot, "r-finding", "hot.go"): true,
		key(KindIntroduced, "i-ok"):             true,
		key(KindHotspot, "r-ok", "hot.go"):      true,
	}
	got := auditedTargets(reports, "self")
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", keys(got), keys(want))
	}
	if got[key(KindSibling, "i-ok")] || got[key(KindHotspot, "r-ok", "other.go")] {
		t.Error("a key is per kind, and per file for hotspot")
	}
}
