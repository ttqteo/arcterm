// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestTaskSignalTellsBusyFromIdle(t *testing.T) {
	now := int64(10_000_000)
	quiet := now - 4*60_000
	cases := []struct {
		td   wshrpc.DagTaskDigest
		want string
	}{
		{wshrpc.DagTaskDigest{FreshnessTs: quiet, Busy: true, LatestTool: "running go test ./pkg/x"}, "running a command 4m · running go test ./pkg/x"},
		{wshrpc.DagTaskDigest{FreshnessTs: quiet}, "idle 4m"},
		{wshrpc.DagTaskDigest{FreshnessTs: quiet, LatestTool: "editing a.go"}, "idle 4m · editing a.go"},
		{wshrpc.DagTaskDigest{FreshnessTs: quiet, Busy: true, Suspect: "worktree unchanged 22m while active"}, "stuck? worktree unchanged 22m while active"},
	}
	for _, c := range cases {
		if got := taskSignal(orchestrate.TaskState_Running, c.td, now); got != c.want {
			t.Fatalf("taskSignal = %q, want %q", got, c.want)
		}
	}
}

func newDagEscalateTestCmd(t *testing.T, flags map[string]string) *cobra.Command {
	t.Helper()
	cmd := &cobra.Command{}
	for _, name := range []string{"channel", "runid", "model", "runtime"} {
		cmd.Flags().String(name, "", "")
	}
	for name, value := range flags {
		if err := cmd.Flags().Set(name, value); err != nil {
			t.Fatal(err)
		}
	}
	return cmd
}

func TestDagEscalateData(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "run", "model": "sonnet", "runtime": "claude"})
	got, err := dagEscalateData(cmd, []string{"t-1"})
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.CommandDagActionData{
		ChannelId: "ch",
		RunId:     "run",
		TaskId:    "t-1",
		Action:    "escalate",
		Model:     "sonnet",
		Runtime:   "claude",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("dagEscalateData = %+v, want %+v", got, want)
	}
	if dagEscalateCmd.PreRunE == nil {
		t.Fatal("escalate command must initialize the RPC client")
	}
	if dagEscalateCmd.Flags().Lookup("tier") != nil {
		t.Fatal("escalate must not offer a tier flag")
	}
}

func TestDagEscalateDataRequiresModel(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "run", "runtime": "claude"})
	if _, err := dagEscalateData(cmd, []string{"t-1"}); err == nil || !strings.Contains(err.Error(), "--model is required") {
		t.Fatalf("missing model error = %v", err)
	}
}

func TestDagStatusLinesUsesDigest(t *testing.T) {
	g := &waveobj.TaskGroup{
		ID: "dag-1", Status: "running", Failures: 2, Parallelism: 3,
		Tasks: []waveobj.TaskNode{
			{ID: "t-0", Label: "a", State: "running", LastActivity: 9000},
			{ID: "t-1", Label: "b", State: "stalled", LastActivity: 1000},
		},
	}
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: g,
		Digest: wshrpc.DagStatusDigest{
			DagVersion: 4,
			Counts:     wshrpc.DagStatusCounts{Total: 2, Done: 0},
			Tasks: []wshrpc.DagTaskDigest{
				{TaskId: "t-0", FreshnessTs: 9000, HumanActions: nil},
				{TaskId: "t-1", FreshnessTs: 1000, HumanActions: []string{"retry", "skip"}},
			},
		},
	}
	lines := dagStatusLines(rtn, 10_000)
	joined := strings.Join(lines, "\n")
	// header counts come from the digest
	if !strings.Contains(joined, "tasks=0/2  failures=2") {
		t.Fatalf("header must use digest counts, got:\n%s", joined)
	}
	// per-task actions come from the digest, never locally reconstructed
	if !strings.Contains(joined, "retry,skip") {
		t.Fatalf("stalled task must show digest actions, got:\n%s", joined)
	}
	if !strings.Contains(joined, "idle ") {
		t.Fatalf("running task must show idle signal, got:\n%s", joined)
	}
	// a needs-you digest surfaces the ask action for the asked task
	g.Tasks = append(g.Tasks, waveobj.TaskNode{ID: "t-2", Label: "c", State: "running"})
	rtn.Digest.Tasks = append(rtn.Digest.Tasks, wshrpc.DagTaskDigest{
		TaskId: "t-2", HumanActions: []string{"answer"}, AskSummary: "which approach?", AskTs: 500,
	})
	lines = dagStatusLines(rtn, 10_000)
	joined = strings.Join(lines, "\n")
	if !strings.Contains(joined, "answer") || !strings.Contains(joined, "ask: which approach?") {
		t.Fatalf("needs-you task must show the digest ask action, got:\n%s", joined)
	}
}

func TestDagAskLinesShowsEveryQuestion(t *testing.T) {
	asks := []wshrpc.DagAskItem{
		{TaskId: "t-3", Owner: agentask.AskOwner_Lead, Ts: 9_000, Deadline: 609_000, Questions: []baseds.AgentAskQuestion{{Question: "later?"}}},
		{TaskId: "t-2", Owner: agentask.AskOwner_Lead, Ts: 1_000, Deadline: 601_000, Note: agentask.AnswerUnconfirmedNote, Questions: []baseds.AgentAskQuestion{
			{Header: "Cache", Question: "which ttl?", Options: []baseds.AgentAskOption{{Label: "24h", Description: "matches prod"}, {Label: "7d"}}},
			{Question: "which regions?", MultiSelect: true, Options: []baseds.AgentAskOption{{Label: "eu"}, {Label: "us"}}},
		}},
		{TaskId: "t-4", Owner: agentask.AskOwner_User, Ts: 500, Questions: []baseds.AgentAskQuestion{{Question: "the human's call?"}}},
	}
	joined := strings.Join(dagAskLines(asks, 61_000), "\n")
	for _, want := range []string{
		"t-2  asked 1m ago  deadline in 9m",
		"note: " + agentask.AnswerUnconfirmedNote,
		"[Cache] which ttl?",
		"0) 24h - matches prod",
		"1) 7d",
		"which regions? (multi-select)",
		"wsh jarvis dag answer",
		"wsh jarvis dag forward",
		"1 held by the human in the run cockpit",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in:\n%s", want, joined)
		}
	}
	if strings.Contains(joined, "the human's call?") {
		t.Fatalf("a question the human holds is not the lead's to answer:\n%s", joined)
	}
	if strings.Index(joined, "t-2") > strings.Index(joined, "t-3") {
		t.Fatalf("the oldest question comes first:\n%s", joined)
	}
}

func TestDagAskLinesWithNothingForTheLead(t *testing.T) {
	if got := dagAskLines(nil, 1_000); !reflect.DeepEqual(got, []string{"no questions waiting"}) {
		t.Fatalf("empty queue = %q", got)
	}
	held := []wshrpc.DagAskItem{{TaskId: "t-1", Owner: agentask.AskOwner_User, Ts: 1, Questions: []baseds.AgentAskQuestion{{Question: "q?"}}}}
	want := []string{"no questions waiting", "1 held by the human in the run cockpit"}
	if got := dagAskLines(held, 1_000); !reflect.DeepEqual(got, want) {
		t.Fatalf("human-held queue = %q, want %q", got, want)
	}
}

func TestDagForwardData(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "run"})
	got, err := dagForwardData(cmd, []string{"t-1", "scope call: B drops the export"})
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.CommandDagActionData{ChannelId: "ch", RunId: "run", TaskId: "t-1", Action: "forward", Notes: "scope call: B drops the export"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("forward data = %+v, want %+v", got, want)
	}
}

func TestCompactDur(t *testing.T) {
	cases := []struct {
		ms   int64
		want string
	}{
		{0, ""},
		{-5, ""},
		{45_000, "45s"},
		{2*60_000 + 3_000, "2m3s"},
		{2 * 60_000, "2m"},
		{60*60_000 + 2*60_000, "1h2m"},
		{60 * 60_000, "1h"},
		{25*24*3600_000 + 2*3600_000, "25d2h"},
	}
	for _, c := range cases {
		if got := compactDur(c.ms); got != c.want {
			t.Errorf("compactDur(%d) = %q, want %q", c.ms, got, c.want)
		}
	}
}

func TestCompactText(t *testing.T) {
	if got := compactText("short", 10); got != "short" {
		t.Errorf("short string must pass through, got %q", got)
	}
	got := compactText("questions about the merge strategy for chunk C", 12)
	r := []rune(got)
	if len(r) != 12 || r[len(r)-1] != '…' {
		t.Errorf("must truncate to 12 runes with trailing ellipsis, got %q", got)
	}
}

func TestDagMergeExposesContinueFlag(t *testing.T) {
	f := dagMergeCmd.Flags().Lookup("continue")
	if f == nil {
		t.Fatal("dag merge must expose --continue for finishing a blocked squash merge")
	}
}

func TestDagSubmitExposesPlanFlag(t *testing.T) {
	if dagSubmitCmd.Flags().Lookup("plan") == nil {
		t.Fatal("dag submit must expose --plan for submitting a plan file")
	}
}

func TestDagSubmitRoundSendsRound(t *testing.T) {
	flags := dagSubmitCmd.Flags()
	t.Cleanup(func() {
		for _, name := range []string{"plan", "round", "channel", "runid"} {
			f := flags.Lookup(name)
			f.Value.Set(f.DefValue)
			f.Changed = false
		}
	})
	for name, value := range map[string]string{"plan": "f.md", "round": "true", "channel": "ch-1", "runid": "run-1"} {
		if err := flags.Set(name, value); err != nil {
			t.Fatal(err)
		}
	}
	data, err := dagSubmitData(dagSubmitCmd)
	if err != nil {
		t.Fatal(err)
	}
	if !data.Round || !filepath.IsAbs(data.PlanPath) || !strings.HasSuffix(data.PlanPath, "f.md") || data.ChannelId != "ch-1" || data.RunId != "run-1" {
		t.Fatalf("`dag submit --round --plan f.md` sends %+v", data)
	}
	if err := flags.Set("round", "false"); err != nil {
		t.Fatal(err)
	}
	if data, err := dagSubmitData(dagSubmitCmd); err != nil || data.Round {
		t.Fatalf("without --round the submit is no round, got %+v, %v", data, err)
	}
}

func TestDagSpecPath(t *testing.T) {
	if dagSubmitCmd.Flags().Lookup("spec") == nil {
		t.Fatal("dag submit must expose --spec")
	}
	if got, err := dagSpecPath("", ""); err != nil || got != "" {
		t.Fatalf("no --spec = %q, %v", got, err)
	}
	if _, err := dagSpecPath("", "spec.md"); err == nil {
		t.Fatal("--spec without --plan must be rejected")
	}
	// wavesrv does not share the lead's cwd, so a relative --spec has to be resolved here
	got, err := dagSpecPath(filepath.Join(string(filepath.Separator), "plan.md"), filepath.Join("docs", "spec.md"))
	if err != nil || !filepath.IsAbs(got) || !strings.HasSuffix(got, filepath.Join("docs", "spec.md")) {
		t.Fatalf("relative --spec = %q, %v", got, err)
	}
}

func TestDagStatusLinesCarriesTheReportAndVerifyFailure(t *testing.T) {
	g := &waveobj.TaskGroup{
		ID: "dag-1", Status: "blocked", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-0", Label: "a", State: "verify-failed", VerifyError: "exit 1: FAIL pkg/orchestrate"}},
	}
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: g,
		Digest: wshrpc.DagStatusDigest{
			Counts:    wshrpc.DagStatusCounts{Total: 1},
			Tasks:     []wshrpc.DagTaskDigest{{TaskId: "t-0", HumanActions: []string{"resolve-merge"}}},
			Durations: wshrpc.DagDurationDigest{ElapsedMs: 12 * 60_000},
			Report: wshrpc.DagReportDigest{
				WorkerMs: 34 * 60_000, Answered: 1, Forwarded: 2, Unverified: true,
				Commits: []wshrpc.DagLandedCommit{{TaskId: "t-0", Commit: "0123456789abcdef"}},
			},
		},
	}
	joined := strings.Join(dagStatusLines(rtn, 0), "\n")
	for _, want := range []string{
		"report  elapsed=12m  workers=34m  commits=1  answered=1  forwarded=2  unverified",
		"landed  t-0 0123456",
		"t-0 verify failed: exit 1: FAIL pkg/orchestrate",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("status must show %q, got:\n%s", want, joined)
		}
	}
}

// the lead's report names what the run cost in tokens: per role, then per task, and how many transcripts it
// could not read
func TestDagStatusLinesCarriesUsage(t *testing.T) {
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: &waveobj.TaskGroup{ID: "dag-1", Status: "done", Parallelism: 1},
		Digest: wshrpc.DagStatusDigest{Report: wshrpc.DagReportDigest{Usage: []waveobj.UsageRow{
			{Role: "lead", Input: 1_000_000, CacheRead: 200_000},
			{Role: "lead", Output: 40_000},
			{Role: "worker", TaskId: "t-1", Model: "a", Input: 3_000_000},
			{Role: "worker", TaskId: "t-1", Model: "b", CacheWrite: 400_000, CacheWrite1h: 49_600},
			{Role: "reviewer", TaskId: "t-1", CacheRead: 500_000},
			{Role: "worker", TaskId: "t-2", Missing: true},
		}}},
	}
	lines := dagStatusLines(rtn, 0)
	want := []string{
		"usage   lead 1.2M · workers 3.4M · reviewers 500k  (1 unreadable)",
		"t-1 usage: worker 3.4M · reviewer 500k",
		"t-2 usage: worker 0  (1 unreadable)",
	}
	if len(lines) < 5 || !reflect.DeepEqual(lines[2:5], want) {
		t.Fatalf("usage lines = %q, want %q after the report line", lines, want)
	}
	rtn.Digest.Report.Usage = nil
	if joined := strings.Join(dagStatusLines(rtn, 0), "\n"); strings.Contains(joined, "usage") {
		t.Fatalf("a dag with no total yet prints none:\n%s", joined)
	}
}

func TestCompactTokens(t *testing.T) {
	for n, want := range map[int]string{0: "0", 999: "999", 1_000: "1k", 38_499: "38k", 142_500: "143k", 1_000_000: "1.0M", 3_449_600: "3.4M"} {
		if got := compactTokens(n); got != want {
			t.Errorf("compactTokens(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestDagRulesTextOnlyForTheLead(t *testing.T) {
	st := &wshrpc.CommandDagStatusRtnData{Group: &waveobj.TaskGroup{RunID: "lead-run", PlanPath: "C:/p/plan.md", SpecPath: "C:/p/spec.md"}}
	lead := &wshrpc.CommandJarvisCtxRtnData{ChannelId: "ch", RunId: "lead-run", DagOID: "dag-1"}
	if got, want := dagRulesText(lead, st, ""), jarvis.OrchestrationRules("lead-run", "C:/p/spec.md", "C:/p/plan.md"); got != want {
		t.Fatalf("lead rules = %q, want %q", got, want)
	}
	// a dag child resolves to its own run, which the dag does not name
	child := &wshrpc.CommandJarvisCtxRtnData{ChannelId: "ch", RunId: "child-run", DagOID: "dag-1"}
	if got := dagRulesText(child, st, ""); got != "" {
		t.Fatalf("a dag child gets no lead rules, got %q", got)
	}
	if got := dagRulesText(lead, &wshrpc.CommandDagStatusRtnData{}, ""); got != "" {
		t.Fatalf("no dag, no rules, got %q", got)
	}
}

// a branch-landed dag stores its docs repo-relative; the lead reads its live copy in its own tree
func TestDagRulesTextNamesTheLeadsOwnDocs(t *testing.T) {
	tree := t.TempDir()
	st := &wshrpc.CommandDagStatusRtnData{Group: &waveobj.TaskGroup{RunID: "lead-run", PlanPath: "docs/plans/p.md", SpecPath: "docs/specs/s.md"}}
	lead := &wshrpc.CommandJarvisCtxRtnData{ChannelId: "ch", RunId: "lead-run", DagOID: "dag-1"}
	want := jarvis.OrchestrationRules("lead-run", filepath.Join(tree, "docs/specs/s.md"), filepath.Join(tree, "docs/plans/p.md"))
	if got := dagRulesText(lead, st, tree); got != want {
		t.Fatalf("lead rules = %q, want %q", got, want)
	}
}

func TestDagRulesIsHiddenWithInjectFlag(t *testing.T) {
	if !dagRulesCmd.Hidden {
		t.Fatal("dag rules is plumbing for hooks and must stay out of help")
	}
	if dagRulesCmd.Flags().Lookup("inject") == nil {
		t.Fatal("dag rules needs --inject for the SessionStart hook")
	}
}

func TestSessionStartPayloadShape(t *testing.T) {
	out, err := sessionStartPayload("rules text")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		HookSpecificOutput struct {
			HookEventName     string `json:"hookEventName"`
			AdditionalContext string `json:"additionalContext"`
		} `json:"hookSpecificOutput"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	if got.HookSpecificOutput.HookEventName != "SessionStart" || got.HookSpecificOutput.AdditionalContext != "rules text" {
		t.Fatalf("payload = %s", out)
	}
	if strings.Contains(string(out), "additional_context") {
		t.Fatalf("exactly one context key may be emitted: %s", out)
	}
}

// the lead reads what the human typed to a worker in its status, one line per message, however many lines it was
func TestDagStatusLinesCarriesWhatTheHumanToldWorkers(t *testing.T) {
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: &waveobj.TaskGroup{ID: "dag-1", Status: "running", Tasks: []waveobj.TaskNode{{ID: "t-3", Label: "a", State: "running"}}},
		Digest: wshrpc.DagStatusDigest{
			Tasks: []wshrpc.DagTaskDigest{{TaskId: "t-3"}},
			Told:  []wshrpc.DagTold{{TaskId: "t-3", Ts: 60_000, Text: "keep closed-session links\nclickable"}},
		},
	}
	joined := strings.Join(dagStatusLines(rtn, 5*60_000), "\n")
	if want := "t-3 the human told this worker 4m ago: keep closed-session links clickable"; !strings.Contains(joined, want) {
		t.Fatalf("status must show %q, got:\n%s", want, joined)
	}
}

func TestDagStatusShowsARunningVerifysAgeAndLatestLine(t *testing.T) {
	g := &waveobj.TaskGroup{ID: "d-1", Status: "running", Parallelism: 2, Tasks: []waveobj.TaskNode{
		{ID: "t-0", Label: "first", State: "verifying"},
		{ID: "t-1", Label: "second", State: "verifying"},
	}}
	// the signal is the digest's: the row formats it and never re-derives it from the task
	rtn := &wshrpc.CommandDagStatusRtnData{Group: g, Digest: wshrpc.DagStatusDigest{
		Tasks: []wshrpc.DagTaskDigest{
			{TaskId: "t-0", VerifyStartedTs: 100_000, VerifyLastLine: "running pkg/two"},
			{TaskId: "t-1", VerifyStartedTs: 340_000},
		},
	}}
	joined := strings.Join(dagStatusLines(rtn, 400_000), "\n")
	// the lead can tell a Verify five minutes in from one it is about to lose to the timeout
	if !strings.Contains(joined, "5m · running pkg/two") {
		t.Fatalf("a running Verify must show its age and latest output line, got:\n%s", joined)
	}
	// nothing written yet is the age alone, never a fabricated line
	if !strings.Contains(joined, "t-1  verifying  1m") {
		t.Fatalf("a Verify with no output yet shows its age alone, got:\n%s", joined)
	}
}

// a merge gate open past its threshold turns health to needs-you; this row is where the lead reads how long
// it has sat. A gate whose done event was pruned has no clock and shows no age, never one from the epoch.
func TestDagStatusShowsHowLongAMergeGateHasSat(t *testing.T) {
	g := &waveobj.TaskGroup{ID: "d-1", Status: "running", Parallelism: 2, Tasks: []waveobj.TaskNode{
		{ID: "t-0", Label: "first", State: "done"},
		{ID: "t-1", Label: "second", State: "done"},
		{ID: "t-2", Label: "third", State: "done"},
	}}
	now := int64(40 * 60_000)
	rtn := &wshrpc.CommandDagStatusRtnData{Group: g, Digest: wshrpc.DagStatusDigest{
		Tasks: []wshrpc.DagTaskDigest{
			{TaskId: "t-0", MergeState: "ready", MergeGateTs: now - 34*60_000},
			{TaskId: "t-1", MergeState: "ready"},
			{TaskId: "t-2", MergeState: "merged"},
		},
	}}
	lines := dagStatusLines(rtn, now)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "t-0  done  merge waiting 34m") {
		t.Fatalf("an open gate shows its age, got:\n%s", joined)
	}
	for _, l := range lines {
		if strings.HasPrefix(l, "t-1 ") && !strings.Contains(l, "merge waiting") {
			t.Fatalf("a gate with no clock still shows it is waiting, got %q", l)
		}
		if strings.HasPrefix(l, "t-2 ") && strings.Contains(l, "merge waiting") {
			t.Fatalf("a merged task is not waiting, got %q", l)
		}
	}
}

// the signal alone, because tabwriter pads the column and a row cannot show where the signal text ends
func TestMergeGateSignalShowsNoAgeWithoutAClock(t *testing.T) {
	now := int64(40 * 60_000)
	for name, ts := range map[string]int64{"pruned": 0, "skewed ahead of this clock": now + 5_000} {
		if got := mergeGateSignal(wshrpc.DagTaskDigest{MergeState: "ready", MergeGateTs: ts}, now); got != "merge waiting" {
			t.Fatalf("%s gate must show no age, got %q", name, got)
		}
	}
}

func TestDagReviewData(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "reviewer-run"})
	cmd.Flags().String("downstream", "", "")
	cmd.Flags().StringSlice("for", nil, "")
	if err := cmd.Flags().Set("downstream", "fmtDate moved"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Flags().Set("for", "t-1,3"); err != nil {
		t.Fatal(err)
	}
	got, err := dagReviewData(cmd, []string{"pass", "adds fmtDate"})
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.CommandDagActionData{ChannelId: "ch", RunId: "reviewer-run", Action: "review-pass", Notes: "adds fmtDate", Downstream: "fmtDate moved", DownstreamFor: []string{"t-1", "3"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("review data = %+v, want %+v", got, want)
	}
	if _, err := dagReviewData(cmd, []string{"maybe", "x"}); err == nil {
		t.Fatal("an unknown verdict must be refused before it is sent")
	}
}

func TestDagPlanReviewData(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "plan-reviewer-run"})
	for _, verb := range []string{"pass", "fail", "accept"} {
		got, err := dagPlanReviewData(cmd, []string{verb, "the text"})
		if err != nil {
			t.Fatal(err)
		}
		want := wshrpc.CommandDagActionData{ChannelId: "ch", RunId: "plan-reviewer-run", Action: "planreview-" + verb, Notes: "the text"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("planreview %s data = %+v, want %+v", verb, got, want)
		}
	}
	if _, err := dagPlanReviewData(cmd, []string{"approve", "x"}); err == nil {
		t.Fatal("an unknown verb must be refused before it is sent")
	}
}

func TestDagFinalData(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "verifier-run"})
	cmd.Flags().String("unverified", "", "")
	got, err := dagFinalData(cmd, []string{"fail", "the defects"})
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.CommandDagActionData{ChannelId: "ch", RunId: "verifier-run", Action: "final-fail", Notes: "the defects"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("final fail data = %+v, want %+v", got, want)
	}
	if err := cmd.Flags().Set("unverified", "u"); err != nil {
		t.Fatal(err)
	}
	got, err = dagFinalData(cmd, []string{"pass", "the summary"})
	if err != nil {
		t.Fatal(err)
	}
	want = wshrpc.CommandDagActionData{ChannelId: "ch", RunId: "verifier-run", Action: "final-pass", Notes: "the summary", Unverified: "u"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("final pass data = %+v, want %+v", got, want)
	}
	if _, err := dagFinalData(cmd, []string{"accept", "x"}); err == nil {
		t.Fatal("an unknown verdict must be refused before it is sent")
	}
	if dagFinalCmd.Flags().Lookup("unverified") == nil {
		t.Fatal("dag final must take --unverified")
	}
}

func TestDagReviewDataCarriesTheUnverifiedCaveat(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "reviewer-run"})
	cmd.Flags().String("downstream", "", "")
	cmd.Flags().StringSlice("for", nil, "")
	cmd.Flags().String("unverified", "", "")
	if err := cmd.Flags().Set("unverified", "u"); err != nil {
		t.Fatal(err)
	}
	got, err := dagReviewData(cmd, []string{"pass", "n"})
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.CommandDagActionData{ChannelId: "ch", RunId: "reviewer-run", Action: "review-pass", Notes: "n", Unverified: "u", DownstreamFor: []string{}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("review data = %+v, want %+v", got, want)
	}
}

func TestDagReviewExposesUnverifiedFlag(t *testing.T) {
	if dagReviewCmd.Flags().Lookup("unverified") == nil {
		t.Fatal("dag review must take --unverified")
	}
}

func TestDagNoteDataSendbackWithoutGuidance(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "run"})
	got, err := dagNoteData(cmd, "sendback", []string{"t-2"})
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.CommandDagActionData{ChannelId: "ch", RunId: "run", TaskId: "t-2", Action: "sendback"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("sendback data = %+v, want %+v", got, want)
	}
}

func TestDagStatusLinesPrintTheUnverifiedCaveatWhole(t *testing.T) {
	caveat := strings.Repeat("u", 1500)
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: &waveobj.TaskGroup{ID: "d", Tasks: []waveobj.TaskNode{{ID: "t-7", Label: "a", State: "done"}}},
		Digest: wshrpc.DagStatusDigest{
			Tasks:  []wshrpc.DagTaskDigest{{TaskId: "t-7", ReviewVerdict: "pass", ReviewNote: "adds fmtDate", ReviewUnverified: caveat}},
			Report: wshrpc.DagReportDigest{UnverifiedNotes: []wshrpc.DagUnverifiedNote{{TaskId: "t-7", Text: caveat}}},
		},
	}
	lines := dagStatusLines(rtn, 0)
	var task, report bool
	for _, l := range lines {
		task = task || l == "t-7 unverified: "+caveat
		report = report || l == "unverified  t-7: "+caveat
	}
	if !task || !report {
		t.Fatalf("status must print the caveat whole under the task and in the report, got:\n%s", strings.Join(lines, "\n"))
	}
}

func TestDagStatusLinesPrintResultAndReview(t *testing.T) {
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: &waveobj.TaskGroup{ID: "d", Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "a", State: "done"}, {ID: "t-2", Label: "b", State: "review-failed"}}},
		Digest: wshrpc.DagStatusDigest{Tasks: []wshrpc.DagTaskDigest{
			{TaskId: "t-1", ReportSections: []string{"differs", "not-verified", "found-not-fixed"}, ReviewVerdict: "pass", ReviewNote: "adds fmtDate", ReviewDownstream: "fmtDate is in util"},
			{TaskId: "t-2", ReviewVerdict: "fail", ReviewRound: 2, ReviewNote: "misses\nempty input"},
		}},
	}
	out := strings.Join(dagStatusLines(rtn, 0), "\n")
	for _, want := range []string{
		"t-1 report: differs, not verified, found not fixed (wsh jarvis dag report t-1)",
		"t-1 review pass: adds fmtDate · later tasks: fmtDate is in util",
		"t-2 review fail (failed rounds 2): misses empty input",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("status missing %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "result:") {
		t.Fatalf("status must not print a worker's result, got:\n%s", out)
	}
}

func TestReportPresenceLine(t *testing.T) {
	cases := map[string][]string{
		"t-3 report: done only (wsh jarvis dag report t-3)":    {"done"},
		"t-3 report: unstructured (wsh jarvis dag report t-3)": {"unstructured"},
		"t-3 report: for later (wsh jarvis dag report t-3)":    {"for-later"},
	}
	for want, sections := range cases {
		if got := reportPresenceLine("t-3", sections); got != want {
			t.Errorf("want %q, got %q", want, got)
		}
	}
}

const reportTestSummary = "## Done\nAdded it.\n\n## Differs from plan\nMoved the file.\n\n## Not verified\nNone\n\n## For later tasks\nNone\n\n## Found not fixed\nNone"

func TestDagReportText(t *testing.T) {
	legacy := "Added it, all good."
	cases := []struct {
		name, summary, section, want, wantErr string
	}{
		{name: "whole report", summary: reportTestSummary, want: reportTestSummary},
		{name: "one section", summary: reportTestSummary, section: "differs", want: "Moved the file."},
		{name: "an empty section", summary: reportTestSummary, section: "not-verified", want: "None"},
		{name: "unknown section", summary: reportTestSummary, section: "nope", wantErr: "done, differs, not-verified, for-later, found-not-fixed"},
		{name: "legacy whole", summary: legacy, want: legacy},
		{name: "legacy with a section", summary: legacy, section: "differs", wantErr: "predates sections; run without a section"},
	}
	for _, c := range cases {
		got, err := dagReportText(c.summary, c.section)
		if c.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("%s: want error containing %q, got %v", c.name, c.wantErr, err)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("%s: want %q, got %q (%v)", c.name, c.want, got, err)
		}
	}
}

func TestDagReportSummary(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{ID: "t-1", RunID: "r1"}, {ID: "t-2"}, {ID: "t-3", RunID: "r3"}, {ID: "t-4", RunID: "r4"}}}
	runs := []*waveobj.Run{
		{ID: "r1", Evidence: &waveobj.RunEvidence{Summary: "x"}},
		{ID: "r3"},
	}
	if got, err := dagReportSummary(g, runs, "1"); err != nil || got != "x" {
		t.Fatalf("a bare number must read as t-N, got %q, %v", got, err)
	}
	for arg, want := range map[string]string{
		"t-9": "no task t-9", "t-2": "no worker run yet", "t-3": "not sealed a report", "t-4": "not in this run's channel",
	} {
		if _, err := dagReportSummary(g, runs, arg); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: want error containing %q, got %v", arg, want, err)
		}
	}
}

func TestDagStatusLinesPrintTheFinalStage(t *testing.T) {
	detail := "Final `node scripts/cdp/final-verify.mjs` failed (exit 1):\nFAIL board-layout\n" + strings.Repeat("x", 1500)
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: &waveobj.TaskGroup{ID: "d", Status: "blocked"},
		Digest: wshrpc.DagStatusDigest{Final: &waveobj.FinalStage{
			State: "failed", Round: 1, Commit: "0123456789abcdef", OutDir: "/tmp/arc-final/d/1",
			Unverified: []string{"t-2: the timeout path has no test"}, Detail: detail,
		}},
	}
	out := strings.Join(dagStatusLines(rtn, 0), "\n")
	for _, want := range []string{
		"final   failed  round=1  commit=0123456  out=/tmp/arc-final/d/1",
		"final unverified: t-2: the timeout path has no test",
		"final failed: " + detail,
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("status must print %q, got:\n%s", want, out)
		}
	}
}

func TestDagStatusLinesPrintTheRunningFinalStep(t *testing.T) {
	rtn := &wshrpc.CommandDagStatusRtnData{
		Group: &waveobj.TaskGroup{ID: "d", Status: "finalizing"},
		Digest: wshrpc.DagStatusDigest{Final: &waveobj.FinalStage{
			State: "checking", Round: 1, Step: "verify", StepTs: time.Now().Add(-72 * time.Second).UnixMilli(),
		}},
	}
	out := strings.Join(dagStatusLines(rtn, 0), "\n")
	if !strings.Contains(out, "final   checking  round=1  step=verify (1m12s)") {
		t.Fatalf("status must name the running step and how long it has run, got:\n%s", out)
	}
}

// a state-changing dag command that prints nothing on success cannot be told from one that did nothing (run
// 6c7652be's plan reviewer guessed): every action a dag command sends has its line
func TestDagDoneLineCoversEveryAction(t *testing.T) {
	for _, action := range []string{"approve", "retry", "escalate", "skip", "stop", "retry-cleanup", "forward", "amend", "tell", "sendback", "answer", "merge"} {
		if got := dagDoneLine(action, "t-3"); !strings.Contains(got, "task t-3") {
			t.Errorf("%s: line must name the task, got %q", action, got)
		}
	}
	if dagDoneLine("cancel", "t-3") == "" {
		t.Error("cancel has no line")
	}
	for _, action := range []string{"review-pass", "review-fail", "planreview-pass", "planreview-fail", "final-pass", "final-fail"} {
		if got := dagDoneLine(action, ""); !strings.HasSuffix(got, "Ending this session") {
			t.Errorf("%s ends the caller's session and must say so, got %q", action, got)
		}
	}
	if got := dagDoneLine("planreview-accept", ""); got == "" || strings.Contains(got, "Ending") {
		t.Errorf("accept keeps the lead's session, got %q", got)
	}
}
