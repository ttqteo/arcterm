// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/bugreport"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/learn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func bugReportItem(t *testing.T, in AttentionInput) (wshrpc.AttentionItem, int) {
	t.Helper()
	var found wshrpc.AttentionItem
	n := 0
	for _, it := range BuildAttention(in) {
		if it.Kind == AttentionBugReports {
			found = it
			n++
		}
	}
	return found, n
}

func TestBugReportAttentionNoRow(t *testing.T) {
	for name, in := range map[string]AttentionInput{
		"no status":      {},
		"all zero":       {BugReports: &wshrpc.BugReportStatus{RepoPath: `D:\code\arcterm`}},
		"handling, lost": {BugReports: &wshrpc.BugReportStatus{Handling: 2}},
	} {
		if _, n := bugReportItem(t, in); n != 0 {
			t.Errorf("%s: nothing waits, no row", name)
		}
	}
}

func TestBugReportAttentionWaitingWithRepo(t *testing.T) {
	in := AttentionInput{
		BugReports:      &wshrpc.BugReportStatus{Waiting: 2, RepoPath: `D:\code\arcterm`, RepoProject: "arcterm"},
		BugReportsSince: 1700,
	}
	got, n := bugReportItem(t, in)
	want := wshrpc.AttentionItem{
		Kind: AttentionBugReports, Key: "bug-reports", Source: "arcterm",
		Text: "2 báo lỗi arcterm chờ xử lý", Action: "Xử lý",
		ProjectPath: `D:\code\arcterm`, WaitingSince: 1700,
	}
	if n != 1 || !reflect.DeepEqual(got, want) {
		t.Fatalf("n=%d\n got %+v\nwant %+v", n, got, want)
	}
}

func TestBugReportAttentionWaitingWithoutRepo(t *testing.T) {
	in := AttentionInput{BugReports: &wshrpc.BugReportStatus{Waiting: 3}, BugReportsSince: 1700}
	got, n := bugReportItem(t, in)
	want := wshrpc.AttentionItem{
		Kind: AttentionBugReports, Key: "bug-reports", Source: "arcterm",
		Text: "Không tìm thấy repo arcterm", Action: "Chọn thư mục…", WaitingSince: 1700,
	}
	if n != 1 || !reflect.DeepEqual(got, want) {
		t.Fatalf("no ProjectPath is how the frontend tells this form apart: n=%d\n got %+v\nwant %+v", n, got, want)
	}
}

func TestBugReportAttentionHandling(t *testing.T) {
	// the row while an agent holds reports, and the repo's path: the Needs-you strip under a project filter drops a row
	// that names neither a channel nor a project, and the frontend reads the agent: ORef before the project path
	in := AttentionInput{
		BugReports:      &wshrpc.BugReportStatus{Waiting: 5, Handling: 2, Handler: "tab-9", RepoPath: `D:\code\arcterm`},
		BugReportsSince: 1800,
	}
	got, n := bugReportItem(t, in)
	want := wshrpc.AttentionItem{
		Kind: AttentionBugReports, Key: "bug-reports", Source: "arcterm",
		Text: "Đang xử lý 2 báo lỗi", Action: "Mở agent", ORef: "agent:tab-9",
		ProjectPath: `D:\code\arcterm`, WaitingSince: 1800,
	}
	if n != 1 || !reflect.DeepEqual(got, want) {
		t.Fatalf("handling wins over the reports that wait: n=%d\n got %+v\nwant %+v", n, got, want)
	}

	in.BugReports.RepoPath = ""
	got, _ = bugReportItem(t, in)
	if got.ProjectPath != "" || got.ORef != "agent:tab-9" || got.Text != "Đang xử lý 2 báo lỗi" {
		t.Fatalf("with no repo the handling form has no ProjectPath: %+v", got)
	}
}

func TestBugReportAttentionHandlingWithNoHandlerFallsBackToWaiting(t *testing.T) {
	// not reachable through GatherBugReports (Reconcile reverts such a report), but "agent:" with no tab is never offered
	in := AttentionInput{BugReports: &wshrpc.BugReportStatus{Waiting: 1, Handling: 1, RepoPath: "/repo"}}
	got, n := bugReportItem(t, in)
	if n != 1 || got.ORef != "" || got.Action != "Xử lý" || got.Text != "1 báo lỗi arcterm chờ xử lý" {
		t.Fatalf("n=%d %+v", n, got)
	}
}

func TestBugReportAttentionSortsLast(t *testing.T) {
	in := AttentionInput{
		Councils: []*council.Council{{Id: "c1", Feature: "Rail apps", State: council.StateAwaiting, Updated: 9999}},
		Learn:    []learn.Proposal{{ID: "l1", Text: "a line", Target: "skill:x", Since: 9999}},
		// oldest of all: age must not move it
		BugReports:      &wshrpc.BugReportStatus{Waiting: 1, RepoPath: "/repo"},
		BugReportsSince: 1,
	}
	items := BuildAttention(in)
	if len(items) != 3 {
		t.Fatalf("%d items: %+v", len(items), items)
	}
	if last := items[len(items)-1]; last.Kind != AttentionBugReports {
		t.Fatalf("the bug-reports row sorts last, after councils: %+v", items)
	}
	if items[0].Kind != AttentionLearnProposal || items[1].Kind != AttentionCouncil {
		t.Fatalf("the rest keep their order: %+v", items)
	}
}

// gatherHarness is a store on a temp dir for gatherBugReports.
func gatherHarness(t *testing.T) (*bugreport.Store, *time.Time) {
	t.Helper()
	now := time.Date(2026, 11, 19, 15, 30, 12, 0, time.Local)
	s := &bugreport.Store{Root: filepath.Join(t.TempDir(), "reports"), Now: func() time.Time { return now }}
	return s, &now
}

func saveBugReport(t *testing.T, s *bugreport.Store, now *time.Time, text string) wshrpc.BugReport {
	t.Helper()
	r, err := s.Save(wshrpc.CommandBugReportSaveData{Text: text, Ts: now.UnixMilli(), Version: "0.0.0"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	return r
}

func TestBugReportGatherWaiting(t *testing.T) {
	s, now := gatherHarness(t)
	a := saveBugReport(t, s, now, "first")
	saveBugReport(t, s, now, "second")
	repo := func() (string, string, bool) { return "/repo", "arcterm", true }

	st, since, err := gatherBugReports(s, func(string) bool { return true }, repo)
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.BugReportStatus{Waiting: 2, RepoPath: "/repo", RepoProject: "arcterm"}
	if st != want {
		t.Fatalf("got %+v want %+v", st, want)
	}
	if since != a.Ts {
		t.Fatalf("WaitingSince is the oldest waiting report's press: %d, want %d", since, a.Ts)
	}
}

func TestBugReportGatherHandlingSinceIsTheOldestClaim(t *testing.T) {
	s, now := gatherHarness(t)
	a := saveBugReport(t, s, now, "first")
	b := saveBugReport(t, s, now, "second")
	saveBugReport(t, s, now, "third, still waiting")
	*now = now.Add(time.Hour)
	if _, err := s.Claim("tab-1", []string{b.Id, a.Id}); err != nil {
		t.Fatal(err)
	}
	claimedAt := now.UnixMilli()

	st, since, err := gatherBugReports(s, func(string) bool { return true }, func() (string, string, bool) { return "", "", false })
	if err != nil {
		t.Fatal(err)
	}
	if st.Handling != 2 || st.Waiting != 1 || st.Handler != "tab-1" || st.RepoPath != "" {
		t.Fatalf("%+v", st)
	}
	if since != claimedAt {
		t.Fatalf("while handling, WaitingSince is when they were claimed: %d, want %d", since, claimedAt)
	}
}

func TestBugReportGatherRevertsReportsOfAClosedAgent(t *testing.T) {
	s, now := gatherHarness(t)
	a := saveBugReport(t, s, now, "first")
	if _, err := s.Claim("tab-closed", []string{a.Id}); err != nil {
		t.Fatal(err)
	}
	norepo := func() (string, string, bool) { return "", "", false }

	st, since, err := gatherBugReports(s, func(tab string) bool { return tab != "tab-closed" }, norepo)
	if err != nil {
		t.Fatal(err)
	}
	if st.Handling != 0 || st.Waiting != 1 || st.Handler != "" {
		t.Fatalf("the closed agent's report waits again: %+v", st)
	}
	if since != a.Ts {
		t.Fatalf("and counts from its press: %d, want %d", since, a.Ts)
	}
}

func TestBugReportGatherNothing(t *testing.T) {
	s, _ := gatherHarness(t)
	st, since, err := gatherBugReports(s, func(string) bool { return true }, func() (string, string, bool) { return "/repo", "p", true })
	if err != nil {
		t.Fatal(err)
	}
	if st.Waiting != 0 || st.Handling != 0 || since != 0 {
		t.Fatalf("%+v %d", st, since)
	}
	if st.RepoPath != "/repo" {
		t.Fatalf("the repo is reported even when nothing waits (the box does not care, but nothing is lost): %+v", st)
	}
}

func TestBugReportGatherReadsTheStoreOfTheDataDir(t *testing.T) {
	// GatherBugReports is rooted at the data dir TestMain set: nothing there, so nothing waits
	st, since, err := GatherBugReports(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if st.Waiting != 0 || st.Handling != 0 || since != 0 {
		t.Fatalf("%+v %d", st, since)
	}
	if _, err := os.Stat(bugreport.Default().Root); err == nil {
		t.Fatal("reading creates nothing")
	}
}
