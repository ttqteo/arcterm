// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// councilTestRoles is a roles answer shaped like the shipped one: the UI feature group and the paper group.
func councilTestRoles() *wshrpc.CouncilRolesRtnData {
	return &wshrpc.CouncilRolesRtnData{
		Roles: []council.CouncilExpert{
			{Id: "ux", Name: "UX", Model: "sonnet"},
			{Id: "ram", Name: "RAM", Model: "sonnet"},
			{Id: "newuser", Name: "New user", Model: "sonnet"},
			{Id: "skeptic", Name: "Skeptic", Model: "sonnet"},
			{Id: "coordinator", Name: "Coordinator", Model: "opus", Coordinator: true},
			{Id: "reader", Name: "Reader", Model: "sonnet"},
		},
		Groups: []council.CouncilGroup{
			{Id: "ui-feature", Name: "Review a UI feature", Roles: []string{"ux", "ram", "newuser", "skeptic"}, Coordinator: "coordinator"},
			{Id: "solo", Name: "Solo", Roles: []string{}, Coordinator: "coordinator"},
		},
	}
}

func councilNames(experts []council.CouncilExpert) []string {
	names := make([]string, len(experts))
	for i, e := range experts {
		names[i] = e.Id
	}
	return names
}

func TestSplitCouncilList(t *testing.T) {
	if got := splitCouncilList("a.ts,b.ts"); !reflect.DeepEqual(got, []string{"a.ts", "b.ts"}) {
		t.Fatalf("files = %v", got)
	}
	if got := splitCouncilList(" a.ts , ,b.ts,"); !reflect.DeepEqual(got, []string{"a.ts", "b.ts"}) {
		t.Fatalf("padded files = %v", got)
	}
	if got := splitCouncilList(""); got != nil {
		t.Fatalf("no flag = %v", got)
	}
}

func TestCouncilFlags(t *testing.T) {
	if err := councilStartCmd.Flags().Parse([]string{"--files", "a.ts,b.ts", "--feature", "Council", "--pause", "--queue", "--screenshot", "x.png", "--screenshot", "y.png"}); err != nil {
		t.Fatal(err)
	}
	if got := splitCouncilList(mustFlagString(councilStartCmd, "files")); !reflect.DeepEqual(got, []string{"a.ts", "b.ts"}) {
		t.Fatalf("--files a.ts,b.ts = %v", got)
	}
	if shots, _ := councilStartCmd.Flags().GetStringArray("screenshot"); !reflect.DeepEqual(shots, []string{"x.png", "y.png"}) {
		t.Fatalf("--screenshot twice = %v", shots)
	}
	for _, name := range []string{"feature", "files", "group", "project", "question", "screenshot", "pause", "queue", "session"} {
		if councilStartCmd.Flags().Lookup(name) == nil {
			t.Errorf("start has no --%s", name)
		}
	}
	for _, name := range []string{"feature", "files", "group", "project"} {
		if councilEstimateCmd.Flags().Lookup(name) == nil {
			t.Errorf("estimate has no --%s", name)
		}
	}
	if f := councilWaitCmd.Flags().Lookup("timeout"); f == nil || f.DefValue != "30m0s" {
		t.Errorf("wait --timeout = %+v", f)
	}
	for _, c := range []interface{ Name() string }{councilEstimateCmd, councilStartCmd, councilListCmd, councilShowCmd, councilWaitCmd, councilStopCmd} {
		found := false
		for _, sub := range councilCmd.Commands() {
			found = found || sub.Name() == c.Name()
		}
		if !found {
			t.Errorf("%s is not under council", c.Name())
		}
	}
}

func TestCouncilProjectDefaultsToTheGitTopLevel(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	same := func(a, b string) bool {
		ea, errA := filepath.EvalSymlinks(a)
		eb, errB := filepath.EvalSymlinks(b)
		return errA == nil && errB == nil && ea == eb
	}
	repo := t.TempDir()
	if out, err := exec.Command("git", "-C", repo, "init", "-q").CombinedOutput(); err != nil {
		t.Skipf("git init: %v: %s", err, out)
	}
	sub := filepath.Join(repo, "docs", "specs")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := councilProjectFor("", sub); !same(got, repo) {
		t.Fatalf("project from a subfolder = %q, want the repo %q", got, repo)
	}
	plain := t.TempDir()
	if got := councilProjectFor("", plain); got != plain {
		t.Fatalf("project outside a repo = %q, want the working directory %q", got, plain)
	}
	other := t.TempDir()
	if got := councilProjectFor(other, sub); got != other {
		t.Fatalf("--project = %q, want %q", got, other)
	}
	if got := councilProjectFor("rel", plain); !filepath.IsAbs(got) {
		t.Fatalf("a relative --project = %q, want an absolute path", got)
	}
	if got := councilGitTop(plain); got != "" {
		t.Fatalf("git top of a plain folder = %q", got)
	}
}

func TestCouncilFilesAreTheProjectsOwn(t *testing.T) {
	project := filepath.Join(t.TempDir(), "repo")
	cwd := filepath.Join(project, "docs")
	abs := filepath.Join(t.TempDir(), "elsewhere.md")
	got := councilFiles([]string{"spec.md", filepath.Join("..", "src", "a.ts"), abs, "../../outside.md"}, cwd, project)
	want := []string{"docs/spec.md", "src/a.ts", abs, "../../outside.md"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("files = %v, want %v", got, want)
	}
	if got := councilFiles(nil, cwd, project); len(got) != 0 {
		t.Fatalf("no files = %v", got)
	}
}

func TestCouncilPanelPutsTheCoordinatorLast(t *testing.T) {
	group, experts, err := councilPanel(councilTestRoles(), "ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	if group.Name != "Review a UI feature" {
		t.Fatalf("group = %+v", group)
	}
	if got, want := councilNames(experts), []string{"ux", "ram", "newuser", "skeptic", "coordinator"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("panel = %v, want %v", got, want)
	}
	if !experts[4].Coordinator || experts[0].Coordinator || councilPanelSize(experts) != 4 {
		t.Fatalf("coordinator flags wrong: %+v", experts)
	}

	roles := councilTestRoles()
	roles.Groups[0].Roles = []string{"ux", "nobody", "ux", "coordinator", "reader"}
	if _, experts, err = councilPanel(roles, "ui-feature"); err != nil {
		t.Fatal(err)
	} else if got, want := councilNames(experts), []string{"ux", "reader", "coordinator"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("an unknown, a repeated and the coordinator's own role are left out: %v, want %v", got, want)
	}
}

func TestCouncilPanelRefusesWhatCannotRun(t *testing.T) {
	if _, _, err := councilPanel(councilTestRoles(), "paper"); err == nil || !strings.Contains(err.Error(), "ui-feature, solo") {
		t.Fatalf("an unknown group = %v, want it to list the known ones", err)
	}
	if _, _, err := councilPanel(councilTestRoles(), "solo"); err == nil || !strings.Contains(err.Error(), "no experts") {
		t.Fatalf("a group with only its coordinator = %v", err)
	}
	roles := councilTestRoles()
	roles.Groups[0].Coordinator = "ghost"
	if _, _, err := councilPanel(roles, "ui-feature"); err == nil || !strings.Contains(err.Error(), "ghost") {
		t.Fatalf("a group whose coordinator is no role = %v", err)
	}
}

func TestCouncilEstimateLine(t *testing.T) {
	group, experts, err := councilPanel(councilTestRoles(), "ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	est := council.Estimate(experts, 0)
	rtn := &wshrpc.CouncilEstimateRtnData{Calls: est.Calls, Tokens: est.Tokens, Minutes: est.Minutes}
	want := `group "Review a UI feature": UX, RAM, New user, Skeptic on sonnet, Coordinator on opus · ≈ 9 calls · ~0.8M tokens · ~6 min`
	if got := councilEstimateLine(group, experts, rtn); got != want {
		t.Fatalf("estimate line\n got %s\nwant %s", got, want)
	}

	// a model's experts share one clause, the clauses in the order the models first appear
	experts[3].Model = "opus"
	if got, want := councilModelsText(experts), "UX, RAM, New user on sonnet, Skeptic, Coordinator on opus"; got != want {
		t.Fatalf("models = %s, want %s", got, want)
	}
	experts[1].Model = "opus"
	if got, want := councilModelsText(experts), "UX, New user on sonnet, RAM, Skeptic, Coordinator on opus"; got != want {
		t.Fatalf("models = %s, want %s", got, want)
	}
}

func TestCouncilSpawnIsPricedAtTheCouncilsOwnEstimate(t *testing.T) {
	_, experts, err := councilPanel(councilTestRoles(), "ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	s := councilSpawn(experts, &wshrpc.CouncilEstimateRtnData{Calls: 9, Tokens: 820_000, Minutes: 6})
	if s.Tool != "Council" || s.Agents != 4 || s.EstimateTokens != 820_000 {
		t.Fatalf("spawn = %+v", s)
	}
	if got := tokengate.Price(s, nil).Estimate; got != 820_000 {
		t.Fatalf("priced at %d, want the council's 820000 (PerAgentTokens would be %d)", got, 4*tokengate.PerAgentTokens)
	}
}

func TestTokengateCappedLeavesACouncil(t *testing.T) {
	dir := t.TempDir()
	transcript := filepath.Join("projects", "p", "s1.jsonl")
	for i := range jarvis.MaxSubagents {
		subagentCallAllowed(dir, "s1", fmt.Sprintf("t%d", i), jarvis.MaxSubagents)
	}
	if _, capped := tokengateCapped(dir, transcript, "Agent"); !capped {
		t.Fatal("the session has dispatched every subagent the cap allows")
	}
	if _, capped := tokengateCapped(dir, transcript, "Council"); capped {
		t.Fatal("a council starts no Agent call: the subagent cap must not refuse it")
	}
}

func TestCouncilStartedLine(t *testing.T) {
	est := &wshrpc.CouncilEstimateRtnData{Calls: 9, Tokens: 820_000, Minutes: 6}
	got := councilStartedLine("abc123", "Council\n  for the cockpit", 4, est)
	want := "council abc123 started: Council for the cockpit · 4 experts · ≈ 9 calls · ~0.8M tokens"
	if got != want {
		t.Fatalf("started line\n got %s\nwant %s", got, want)
	}
	if got := councilStartedLine("abc123", "f", 1, est); !strings.Contains(got, "· 1 expert ·") {
		t.Fatalf("one expert = %s", got)
	}
}

func TestCouncilNotRunText(t *testing.T) {
	// the gate's own refusal already opens "Not run:": it is not prefixed twice
	s := tokengate.Spawn{Tool: "Council", Agents: 4}
	refusal := tokengate.VerdictFor(tokengate.OptionDeny, s, 820_000)
	got := councilNotRunText(refusal.Reason, "abc123")
	lines := strings.Split(strings.TrimSuffix(got, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("not-run text = %q, want two lines", got)
	}
	if !strings.HasPrefix(lines[0], "Not run: the person chose not to start a Council (4 experts)") || strings.Count(lines[0], "Not run:") != 1 {
		t.Fatalf("reason line = %q", lines[0])
	}
	if want := "council abc123 saved as not run; Start council in the app runs it"; lines[1] != want {
		t.Fatalf("saved line = %q, want %q", lines[1], want)
	}

	if got := councilNotRunText("the budget is spent", "x1"); !strings.HasPrefix(got, "Not run: the budget is spent\n") {
		t.Fatalf("a bare reason is prefixed: %q", got)
	}
}

func TestCouncilRunningHoldsTheQueueOnlyWhileRunning(t *testing.T) {
	list := []*council.Council{
		{Id: "a", State: council.StateDone},
		{Id: "b", State: council.StateAwaiting},
		{Id: "c", State: council.StateNotRun},
		nil,
	}
	if busy := councilRunning(list); busy != nil {
		t.Fatalf("nothing runs, got %s", busy.Id)
	}
	list = append(list, &council.Council{Id: "d", State: council.StateRunning})
	if busy := councilRunning(list); busy == nil || busy.Id != "d" {
		t.Fatalf("running = %+v, want d", busy)
	}
}

func TestCouncilWaitDoneIsEveryStateButRunning(t *testing.T) {
	for _, tc := range []struct {
		state council.CouncilState
		done  bool
	}{
		{council.StateRunning, false},
		{council.StateAwaiting, true},
		{council.StateDone, true},
		{council.StateNotRun, true},
		{council.StateStopped, true},
		{council.StateFailed, true},
	} {
		if got := councilWaitDone(&council.Council{State: tc.state}); got != tc.done {
			t.Errorf("%s: done = %v, want %v", tc.state, got, tc.done)
		}
	}
}

func TestCouncilWaitText(t *testing.T) {
	done := &council.Council{Id: "c1", Feature: "Council", State: council.StateDone}
	if text, err := councilWaitText(done); err != nil || text != council.Markdown(done) {
		t.Fatalf("done = %q, %v; want the markdown", text, err)
	}

	paused := &council.Council{Id: "c2", State: council.StateAwaiting, Round: 1}
	text, err := councilWaitText(paused)
	if err != nil || !strings.Contains(text, "waiting on you") || !strings.Contains(text, "Continue") || !strings.Contains(text, "wsh council wait c2") {
		t.Fatalf("awaiting-you = %q, %v; want what the person does in the app", text, err)
	}

	if text, err := councilWaitText(&council.Council{Id: "c3", State: council.StateNotRun}); err != nil || !strings.Contains(text, "Start council in the app") {
		t.Fatalf("not run = %q, %v", text, err)
	}
	stopped := &council.Council{Id: "c4", Feature: "F", State: council.StateStopped}
	if text, err := councilWaitText(stopped); err != nil || !strings.Contains(text, "was stopped") || !strings.Contains(text, council.Markdown(stopped)) {
		t.Fatalf("stopped = %q, %v", text, err)
	}
	if _, err := councilWaitText(&council.Council{Id: "c5", State: council.StateFailed, Error: "the coordinator timed out"}); err == nil ||
		!strings.Contains(err.Error(), "c5 failed: the coordinator timed out") {
		t.Fatalf("failed = %v, want the reason as the error", err)
	}
	if _, err := councilWaitText(&council.Council{Id: "c6", State: council.StateRunning}); err == nil {
		t.Fatal("a running council has nothing to print yet")
	}
}

func TestCouncilWaitForPollsUntilItStopsRunning(t *testing.T) {
	calls := 0
	get := func() (*council.Council, error) {
		calls++
		state := council.StateRunning
		if calls == 3 {
			state = council.StateDone
		}
		return &council.Council{Id: "c1", State: state}, nil
	}
	c, err := councilWaitFor(context.Background(), time.Millisecond, get)
	if err != nil || c.State != council.StateDone || calls != 3 {
		t.Fatalf("wait = %+v, %v after %d polls", c, err, calls)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	running := func() (*council.Council, error) { return &council.Council{Id: "c1", State: council.StateRunning}, nil }
	if _, err := councilWaitFor(ctx, time.Millisecond, running); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a council that keeps running = %v, want the deadline", err)
	}

	broken := errors.New("no such council")
	if _, err := councilWaitFor(context.Background(), time.Millisecond, func() (*council.Council, error) { return nil, broken }); !errors.Is(err, broken) {
		t.Fatalf("a failed read = %v, want it passed on", err)
	}
}

func TestCouncilListLine(t *testing.T) {
	c := &council.Council{Id: "c1", State: council.StateAwaiting, Round: 1, Feature: "Council\nfor the cockpit"}
	if got, want := councilListLine(c), "c1\tawaiting-you\tround 1\tCouncil for the cockpit"; got != want {
		t.Fatalf("list line = %q, want %q", got, want)
	}
}
