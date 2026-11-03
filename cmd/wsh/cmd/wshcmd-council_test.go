// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/council/bench"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
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
	if err := councilStartCmd.Flags().Parse([]string{"--files", "a.ts,b.ts", "--feature", "Council", "--pause", "--queue", "--screenshot", "x.png", "--screenshot", "y.png",
		"--mode", "brainstorm", "--mode-why", "a goal with no answer yet"}); err != nil {
		t.Fatal(err)
	}
	if mustFlagString(councilStartCmd, "mode") != "brainstorm" || mustFlagString(councilStartCmd, "mode-why") != "a goal with no answer yet" {
		t.Fatalf("--mode %q --mode-why %q", mustFlagString(councilStartCmd, "mode"), mustFlagString(councilStartCmd, "mode-why"))
	}
	if got := splitCouncilList(mustFlagString(councilStartCmd, "files")); !reflect.DeepEqual(got, []string{"a.ts", "b.ts"}) {
		t.Fatalf("--files a.ts,b.ts = %v", got)
	}
	if shots, _ := councilStartCmd.Flags().GetStringArray("screenshot"); !reflect.DeepEqual(shots, []string{"x.png", "y.png"}) {
		t.Fatalf("--screenshot twice = %v", shots)
	}
	for _, name := range []string{"feature", "files", "group", "project", "question", "screenshot", "pause", "queue", "session", "mode", "mode-why"} {
		if councilStartCmd.Flags().Lookup(name) == nil {
			t.Errorf("start has no --%s", name)
		}
	}
	for _, name := range []string{"feature", "files", "group", "project", "mode"} {
		if councilEstimateCmd.Flags().Lookup(name) == nil {
			t.Errorf("estimate has no --%s", name)
		}
	}
	if f := councilWaitCmd.Flags().Lookup("timeout"); f == nil || f.DefValue != "30m0s" {
		t.Errorf("wait --timeout = %+v", f)
	}
	for _, c := range []interface{ Name() string }{councilEstimateCmd, councilStartCmd, councilListCmd, councilShowCmd, councilWaitCmd, councilStopCmd, councilRmCmd} {
		found := false
		for _, sub := range councilCmd.Commands() {
			found = found || sub.Name() == c.Name()
		}
		if !found {
			t.Errorf("%s is not under council", c.Name())
		}
	}
}

func TestCouncilModeDefaultGroup(t *testing.T) {
	for _, tc := range []struct {
		name, group, mode, want string
	}{
		{"brainstorm with no group", "", council.ModeBrainstorm, "product-ideas"},
		{"review with no group", "", council.ModeReview, "ui-feature"},
		{"no mode with no group", "", "", "ui-feature"},
		{"an explicit group wins over brainstorm", "paper", council.ModeBrainstorm, "paper"},
		{"an explicit group wins over review", "solo", council.ModeReview, "solo"},
	} {
		if got := councilGroupFor(tc.group, tc.mode, false); got != tc.want {
			t.Errorf("%s: group = %q, want %q", tc.name, got, tc.want)
		}
	}

	for word, want := range map[string]string{
		"": council.ModeReview, "review": council.ModeReview, " Review ": council.ModeReview,
		"brainstorm": council.ModeBrainstorm, "BRAINSTORM": council.ModeBrainstorm,
	} {
		if got, err := councilModeFlag(word); err != nil || got != want {
			t.Errorf("--mode %q = %q, %v; want %q", word, got, err, want)
		}
	}
}

func TestCouncilGroupForAgents(t *testing.T) {
	for _, tc := range []struct {
		name, group, mode string
		withAgents        bool
		want              string
	}{
		{"review with chats", "", council.ModeReview, true, "agents"},
		{"no mode with chats is a review", "", "", true, "agents"},
		{"brainstorm with chats", "", council.ModeBrainstorm, true, "agents-ideas"},
		{"an explicit group wins over review with chats", "paper", council.ModeReview, true, "paper"},
		{"an explicit group wins over brainstorm with chats", "solo", council.ModeBrainstorm, true, "solo"},
		{"review without chats", "", council.ModeReview, false, "ui-feature"},
		{"brainstorm without chats", "", council.ModeBrainstorm, false, "product-ideas"},
		{"an explicit group without chats", "paper", council.ModeReview, false, "paper"},
	} {
		if got := councilGroupFor(tc.group, tc.mode, tc.withAgents); got != tc.want {
			t.Errorf("%s: group = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// councilTestCmd is a start command with its flags parsed from args.
func councilTestCmd(t *testing.T, args ...string) *cobra.Command {
	t.Helper()
	cmd := &cobra.Command{Use: "start"}
	addCouncilPanelFlags(cmd)
	addCouncilStartFlags(cmd)
	if err := cmd.Flags().Parse(args); err != nil {
		t.Fatal(err)
	}
	return cmd
}

func TestCouncilAgentFlags(t *testing.T) {
	t.Setenv("WAVETERM_TABID", "tab-self")
	t.Setenv("WAVETERM_BLOCKID", "")
	got, err := councilAgentFlags(councilTestCmd(t, "--agent", "5065bd8c", "--agent", "self", "--agent", "71d93e40"))
	if err != nil || !reflect.DeepEqual(got, []string{"5065bd8c", "tab-self", "71d93e40"}) {
		t.Fatalf("--agent twice and self = %v, %v; want the ids in the order given, self as this terminal's tab", got, err)
	}
	if got, err := councilAgentFlags(councilTestCmd(t)); err != nil || len(got) != 0 {
		t.Fatalf("no --agent = %v, %v", got, err)
	}

	// self outside an agent's terminal: refused, never a council with the seat left out
	t.Setenv("WAVETERM_TABID", "")
	if _, err := councilAgentFlags(councilTestCmd(t, "--agent", "self")); err == nil || !strings.Contains(err.Error(), "--agent self runs only inside an agent's terminal") {
		t.Fatalf("--agent self with no tab = %v", err)
	}
	// an empty id is a refusal too (a shell variable that was never set), not a seat dropped, alone or beside others
	for _, args := range [][]string{{"--agent", ""}, {"--agent", "a1", "--agent", " "}} {
		if _, err := councilAgentFlags(councilTestCmd(t, args...)); err == nil || !strings.Contains(err.Error(), "--agent needs a tab id") {
			t.Fatalf("%v = %v", args, err)
		}
	}
	// ids pass through without self
	if got, err := councilAgentFlags(councilTestCmd(t, "--agent", " a1 ", "--agent", "b2")); err != nil || !reflect.DeepEqual(got, []string{"a1", "b2"}) {
		t.Fatalf("ids = %v, %v", got, err)
	}
	for _, name := range []string{"agent", "expert"} {
		for _, cmd := range []*cobra.Command{councilStartCmd, councilEstimateCmd} {
			if cmd.Flags().Lookup(name) == nil {
				t.Errorf("%s has no --%s", cmd.Name(), name)
			}
		}
	}
}

func TestCouncilExpertFlag(t *testing.T) {
	roles := councilTestRoles()
	roles.Roles = append(roles.Roles,
		council.CouncilExpert{Id: "contrarian", Name: "Contrarian", Model: "sonnet"},
		council.CouncilExpert{Id: "facilitator", Name: "Facilitator", Model: "opus", Coordinator: true})
	_, panel, err := councilPanel(roles, "ui-feature")
	if err != nil {
		t.Fatal(err)
	}

	got, err := councilAddExperts(roles, panel, []string{"contrarian", "reader"})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"ux", "ram", "newuser", "skeptic", "contrarian", "reader", "coordinator"}; !reflect.DeepEqual(councilNames(got), want) {
		t.Fatalf("panel = %v, want the roles before the coordinator in the order given: %v", councilNames(got), want)
	}
	if !got[6].Coordinator || got[4].Coordinator || got[5].Coordinator {
		t.Fatalf("coordinator flags wrong: %+v", got)
	}
	if len(panel) != 5 || panel[4].Id != "coordinator" {
		t.Fatalf("the group's own panel was changed: %v", councilNames(panel))
	}
	if same, err := councilAddExperts(roles, panel, nil); err != nil || !reflect.DeepEqual(same, panel) {
		t.Fatalf("no --expert = %v, %v", councilNames(same), err)
	}

	for _, tc := range []struct {
		name  string
		ids   []string
		want  string // what the error names
		takes string // the role ids it lists as usable
	}{
		{"an unknown role", []string{"ghost"}, `"ghost"`, "reader, contrarian"},
		{"a role already in the group", []string{"ux"}, `"ux"`, "reader, contrarian"},
		{"a role named twice", []string{"reader", "reader"}, `"reader"`, "contrarian"},
		{"the group's coordinator", []string{"coordinator"}, `"coordinator"`, "reader, contrarian"},
		{"another coordinator role", []string{"facilitator"}, `"facilitator"`, "reader, contrarian"},
		{"an empty id (a lone --expert \"\" reaches here as one empty value)", councilRepeated(councilTestCmd(t, "--expert", ""), "expert"), `""`, "reader, contrarian"},
	} {
		_, err := councilAddExperts(roles, panel, tc.ids)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: --expert %v = %v, want an error naming %s", tc.name, tc.ids, err, tc.want)
			continue
		}
		_, takes, ok := strings.Cut(err.Error(), "roles it takes: ")
		if !ok || takes != tc.takes {
			t.Errorf("%s: the error lists %q, want only the roles it takes: %q (%v)", tc.name, takes, tc.takes, err)
		}
	}
}

func TestCouncilStartDataByAgent(t *testing.T) {
	_, experts, err := councilPanel(councilTestRoles(), "ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	plan := councilPlan{project: "/p", mode: council.ModeReview, group: council.CouncilGroup{Id: "agents"}, experts: experts, agents: []string{"5065bd8c", "tab-self"}}
	cmd := councilTestCmd(t, "--session", "s1")
	data := councilStartData(cmd, plan, "F", nil)
	if !data.ByAgent || !reflect.DeepEqual(data.Agents, []string{"5065bd8c", "tab-self"}) {
		t.Errorf("start data = %+v, want ByAgent and the agents in seat order", data)
	}
	// wsh council start always marks the council as an agent's, chats seated or not
	plan.agents = nil
	if data = councilStartData(cmd, plan, "F", nil); !data.ByAgent || len(data.Agents) != 0 {
		t.Errorf("start data with no chat = %+v, want ByAgent and no agents", data)
	}
}

func TestCouncilModeRefusesUnknown(t *testing.T) {
	for _, word := range []string{"fast", "brainstorming", "both"} {
		_, err := councilModeFlag(word)
		if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("%q", word)) || !strings.Contains(err.Error(), "review") || !strings.Contains(err.Error(), "brainstorm") {
			t.Errorf("--mode %q = %v, want an error naming the word and the two modes", word, err)
		}
	}

	// refused before anything is asked: no roles are read, no estimate is made, and the token gate is not reached.
	// RpcClient is nil here, so reaching any of them would panic.
	for name, run := range map[string]func(cmd *cobra.Command) error{
		"estimate": func(cmd *cobra.Command) error { _, err := councilPrepare(cmd); return err },
		"start":    func(cmd *cobra.Command) error { return councilStartRun(cmd, nil) },
	} {
		cmd := &cobra.Command{Use: name}
		addCouncilPanelFlags(cmd)
		addCouncilStartFlags(cmd)
		if err := cmd.Flags().Parse([]string{"--feature", "A feature", "--mode", "fast"}); err != nil {
			t.Fatal(err)
		}
		if err := run(cmd); err == nil || !strings.Contains(err.Error(), `"fast"`) {
			t.Errorf("%s with --mode fast = %v, want the refusal", name, err)
		}
	}
}

func TestCouncilStartDataCarriesTheMode(t *testing.T) {
	cmd := &cobra.Command{Use: "start"}
	addCouncilPanelFlags(cmd)
	addCouncilStartFlags(cmd)
	if err := cmd.Flags().Parse([]string{"--mode-why", "  a goal\n with no answer ", "--question", " How do we fix it? ", "--pause", "--session", "s1"}); err != nil {
		t.Fatal(err)
	}
	_, experts, err := councilPanel(councilTestRoles(), "ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	plan := councilPlan{project: "/p", files: []string{"a.md"}, group: council.CouncilGroup{Id: "ui-feature"}, experts: experts, mode: council.ModeBrainstorm}
	data := councilStartData(cmd, plan, "Council for newcomers", []string{"/s.png"})
	if data.Mode != council.ModeBrainstorm || data.ModeWhy != "a goal with no answer" {
		t.Errorf("mode %q why %q, want brainstorm and the reason on one line", data.Mode, data.ModeWhy)
	}
	if data.Project != "/p" || data.Feature != "Council for newcomers" || data.Question != "How do we fix it?" || data.Group != "ui-feature" ||
		!reflect.DeepEqual(data.Files, []string{"a.md"}) || !reflect.DeepEqual(data.Screenshots, []string{"/s.png"}) ||
		len(data.Experts) != 5 || !data.Pause || data.SessionId != "s1" || data.NotRun {
		t.Errorf("data = %+v", data)
	}

	// no --mode: a review, with no reason
	plan.mode = council.ModeReview
	cmd = &cobra.Command{Use: "start"}
	addCouncilPanelFlags(cmd)
	addCouncilStartFlags(cmd)
	if err := cmd.Flags().Parse([]string{"--session", "s2"}); err != nil { // --session keeps the test off this terminal's own session
		t.Fatal(err)
	}
	if data = councilStartData(cmd, plan, "F", nil); data.Mode != council.ModeReview || data.ModeWhy != "" {
		t.Errorf("mode %q why %q, want review and none", data.Mode, data.ModeWhy)
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
	if got := councilProjectFor("", sub, nil); !same(got, repo) {
		t.Fatalf("project from a subfolder = %q, want the repo %q", got, repo)
	}
	plain := t.TempDir()
	if got := councilProjectFor("", plain, nil); got != plain {
		t.Fatalf("project outside a repo = %q, want the working directory %q", got, plain)
	}
	other := t.TempDir()
	if got := councilProjectFor(other, sub, nil); got != other {
		t.Fatalf("--project = %q, want %q", got, other)
	}
	if got := councilProjectFor("rel", plain, nil); !filepath.IsAbs(got) {
		t.Fatalf("a relative --project = %q, want an absolute path", got)
	}
	if got := councilGitTop(plain); got != "" {
		t.Fatalf("git top of a plain folder = %q", got)
	}
}

// A project registered at a monorepo's subfolder (apps/website) is the council's project from inside it, ahead of the
// repo's top level, since the Agent tree files a council under the project whose root is its path.
func TestCouncilProjectPrefersTheRegisteredProjectOverTheGitTop(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	repo := t.TempDir()
	if out, err := exec.Command("git", "-C", repo, "init", "-q").CombinedOutput(); err != nil {
		t.Skipf("git init: %v: %s", err, out)
	}
	website := filepath.Join(repo, "apps", "website")
	portal := filepath.Join(repo, "apps", "portal")
	inside := filepath.Join(website, "src")
	for _, d := range []string{inside, portal} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	registered := map[string]wconfig.ProjectKeywords{
		"website": {Path: website},
		"portal":  {Path: portal},
		"repo":    {Path: repo},
	}
	if got := councilProjectFor("", inside, registered); got != filepath.Clean(website) {
		t.Fatalf("project from inside apps/website = %q, want the registered %q", got, website)
	}
	// a folder no deeper project holds falls to the registered repo
	if got := councilProjectFor("", filepath.Join(repo, "apps"), registered); got != filepath.Clean(repo) {
		t.Fatalf("project from apps = %q, want the registered repo %q", got, repo)
	}
	// --project still wins
	if got := councilProjectFor(portal, inside, registered); got != portal {
		t.Fatalf("--project = %q, want %q", got, portal)
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
	est := council.Estimate(experts, 0, 0)
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
	_, experts, err := councilPanel(councilTestRoles(), "ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	c := &council.Council{Id: "abc123", Experts: experts}
	got := councilStartedLine(c, "Council\n  for the cockpit", council.ModeReview, "Review a UI feature", est)
	want := "council abc123 started: Council for the cockpit · review · Review a UI feature · 4 experts · ≈ 9 calls · ~0.8M tokens"
	if got != want {
		t.Fatalf("started line\n got %s\nwant %s", got, want)
	}
	one := &council.Council{Id: "abc123", Experts: experts[3:]} // the Skeptic and the coordinator
	if got := councilStartedLine(one, "f", council.ModeBrainstorm, "Product ideas", est); !strings.Contains(got, "· brainstorm · Product ideas · 1 expert ·") {
		t.Fatalf("a brainstorm of one expert = %s", got)
	}
}

func TestCouncilStartedLineWithChats(t *testing.T) {
	_, panel, err := councilPanel(councilTestRoles(), "ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	skeptic, coordinator := panel[3], panel[4]
	chat := func(tab string) council.CouncilExpert {
		return council.CouncilExpert{Id: "agent-" + tab, Name: "Chat " + tab, Agent: tab, Harness: "claude"}
	}
	est := &wshrpc.CouncilEstimateRtnData{Calls: 7, Tokens: 1_400_000, Minutes: 9}
	line := func(experts ...council.CouncilExpert) string {
		return councilStartedLine(&council.Council{Id: "abc123", Experts: experts}, "Council\n  for the cockpit", council.ModeReview, "Chats with a Skeptic", est)
	}

	if got, want := line(chat("t1"), chat("t2"), skeptic, coordinator),
		"council abc123 started: Council for the cockpit · review · Chats with a Skeptic · 2 chats + Skeptic · ≈ 7 calls · ~1.4M tokens"; got != want {
		t.Errorf("two chats\n got %s\nwant %s", got, want)
	}
	if got := line(chat("t1"), skeptic, coordinator); !strings.Contains(got, " · 1 chat + Skeptic · ") {
		t.Errorf("one chat = %s", got)
	}
	// role experts are named in panel order, joined with ", ", whatever else sits beside the chats
	if got := line(chat("t1"), skeptic, panel[0], coordinator); !strings.Contains(got, " · 1 chat + Skeptic, UX · ") {
		t.Errorf("a chat with a Skeptic and UX = %s", got)
	}
	// no chat seated: the line is the one a council had before chats could sit
	if got, want := line(panel...),
		"council abc123 started: Council for the cockpit · review · Chats with a Skeptic · 4 experts · ≈ 7 calls · ~1.4M tokens"; got != want {
		t.Errorf("no chat\n got %s\nwant %s", got, want)
	}
	// N and X are the estimate's, not a constant
	other := &wshrpc.CouncilEstimateRtnData{Calls: 11, Tokens: 2_600_000, Minutes: 15}
	if got := councilStartedLine(&council.Council{Id: "x", Experts: []council.CouncilExpert{chat("t1"), skeptic, coordinator}}, "f", council.ModeReview, "g", other); !strings.HasSuffix(got, "≈ 11 calls · ~2.6M tokens") {
		t.Errorf("the estimate passed is not the one printed: %s", got)
	}
}

func TestCouncilQueuedLine(t *testing.T) {
	queued := &council.Council{Id: "new456", State: council.StateQueued, QueuedAfter: "abc123"}
	running := &council.Council{Id: "abc123", Feature: "Council\n  for the cockpit", State: council.StateRunning}
	got := councilQueuedLine(queued, running)
	want := "Queued after abc123 (Council for the cockpit) · council new456 starts by itself when it ends"
	if got != want {
		t.Fatalf("queued line\n got %s\nwant %s", got, want)
	}
	// the new council's own id is on the line, so an agent can pass it to `wsh council wait`
	if !strings.Contains(got, "new456") {
		t.Errorf("the queued line does not carry the new council's id: %s", got)
	}
	// the running council could not be read: the line still names what it waits for
	if got := councilQueuedLine(queued, nil); got != "Queued after abc123 · council new456 starts by itself when it ends" {
		t.Errorf("queued line without the running council = %s", got)
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

func TestCouncilWaitDoneIsEveryStateButRunning(t *testing.T) {
	for _, tc := range []struct {
		state council.CouncilState
		done  bool
	}{
		{council.StateRunning, false},
		{council.StateQueued, false}, // it starts by itself: wait goes on through it
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

	// a council with agents waits on its held drafts, and there is no Continue to press
	held := &council.Council{Id: "c7", State: council.StateAwaiting, Round: 2, Proposals: []council.CouncilProposal{{Id: "P1", Draft: council.DraftHeld}},
		Replies: []council.CouncilReply{{Id: "r1", Draft: council.DraftHeld}, {Id: "r2", Draft: council.DraftDropped}}}
	text, err = councilWaitText(held)
	if err != nil || !strings.Contains(text, "2 drafts from round 2 wait for you") || strings.Contains(text, "Continue") || !strings.Contains(text, "wsh council wait c7") {
		t.Fatalf("awaiting drafts = %q, %v; want the drafts named and no Continue", text, err)
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

func TestCouncilWaitForGoesThroughTheQueue(t *testing.T) {
	states := []council.CouncilState{council.StateQueued, council.StateQueued, council.StateRunning, council.StateDone}
	calls := 0
	get := func() (*council.Council, error) {
		state := states[min(calls, len(states)-1)]
		calls++
		return &council.Council{Id: "c1", State: state}, nil
	}
	c, err := councilWaitFor(context.Background(), time.Millisecond, get)
	if err != nil || c.State != council.StateDone || calls != 4 {
		t.Fatalf("wait = %+v, %v after %d polls, want it to go through queued and running to done", c, err, calls)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	stuck := func() (*council.Council, error) { return &council.Council{Id: "c1", State: council.StateQueued}, nil }
	if _, err := councilWaitFor(ctx, time.Millisecond, stuck); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a council that stays queued = %v, want the deadline", err)
	}
}

func TestCouncilListLine(t *testing.T) {
	c := &council.Council{Id: "c1", State: council.StateAwaiting, Round: 1, Feature: "Council\nfor the cockpit"}
	if got, want := councilListLine(c), "c1\tawaiting-you\tround 1\tCouncil for the cockpit"; got != want {
		t.Fatalf("list line = %q, want %q", got, want)
	}
}

// ---- bench ----

// benchFakes stands in for wavesrv and the person: it records the order of the dry run, the gate and the real call.
type benchFakes struct {
	steps   []string
	data    []wshrpc.CommandCouncilBenchData
	spawn   tokengate.Spawn
	verdict tokengate.Verdict
	gateErr error
	plan    *wshrpc.CouncilBenchRtnData
}

func useBenchFakes(t *testing.T, f *benchFakes) {
	t.Helper()
	prevCall, prevGate := councilBenchCall, councilBenchGate
	t.Cleanup(func() { councilBenchCall, councilBenchGate = prevCall, prevGate })
	councilBenchCall = func(data wshrpc.CommandCouncilBenchData) (*wshrpc.CouncilBenchRtnData, error) {
		f.data = append(f.data, data)
		if data.DryRun {
			f.steps = append(f.steps, "dry run")
		} else {
			f.steps = append(f.steps, "start")
		}
		return f.plan, nil
	}
	councilBenchGate = func(ctx context.Context, s tokengate.Spawn, transcript string, onHold func(any)) (tokengate.Verdict, error) {
		f.steps = append(f.steps, "gate")
		f.spawn = s
		return f.verdict, f.gateErr
	}
}

func benchPlan() *wshrpc.CouncilBenchRtnData {
	return &wshrpc.CouncilBenchRtnData{
		Items: []bench.CouncilBenchPlanItem{
			{Case: "alpha", Variant: bench.VariantSolo, Run: 1},
			{Case: "alpha", Variant: bench.VariantCouncil, Run: 1},
			{Case: "beta", Variant: bench.VariantSolo, Run: 1},
			{Case: "beta", Variant: bench.VariantCouncil, Run: 1},
		},
		Estimate: 3_900_000,
		Skipped:  []string{"skipped case gamma: project folder D:/gone is missing"},
	}
}

func TestCouncilBenchGateBeforeStart(t *testing.T) {
	f := &benchFakes{plan: benchPlan(), verdict: tokengate.Verdict{Run: true}}
	useBenchFakes(t, f)
	var out, errOut bytes.Buffer
	asked := wshrpc.CommandCouncilBenchData{Cases: []string{"alpha"}, Runs: 2}

	if err := councilBenchStart(context.Background(), &out, &errOut, asked); err != nil {
		t.Fatalf("councilBenchStart: %v", err)
	}
	if want := []string{"dry run", "gate", "start"}; !reflect.DeepEqual(f.steps, want) {
		t.Fatalf("steps = %v, want %v: the plan is priced, the gate asked, and only then the bench started", f.steps, want)
	}
	if f.spawn.Tool != "Council" || f.spawn.EstimateTokens != 3_900_000 || f.spawn.Agents != 4 {
		t.Errorf("gate asked about %+v, want the whole plan's 3.9M estimate over its 4 councils", f.spawn)
	}
	if got := tokengate.Price(f.spawn, nil).Estimate; got != 3_900_000 {
		t.Errorf("the gate prices the bench at %d, want the plan's own 3900000", got)
	}
	// both calls carry what the person asked for; only the first is a dry run
	dry, real := f.data[0], f.data[1]
	if !dry.DryRun || real.DryRun {
		t.Errorf("dry run flags = %v then %v, want true then false", dry.DryRun, real.DryRun)
	}
	dry.DryRun = false
	if !reflect.DeepEqual(dry, asked) || !reflect.DeepEqual(real, asked) {
		t.Errorf("calls = %+v and %+v, want the request %+v both times", f.data[0], f.data[1], asked)
	}
	if !strings.Contains(out.String(), "bench started: 4 councils over 2 cases") || !strings.Contains(out.String(), "~3.9M tokens") {
		t.Errorf("output = %q, want the started line with the councils, cases and estimate", out.String())
	}
	if !strings.Contains(errOut.String(), "skipped case gamma") {
		t.Errorf("stderr = %q, want the skipped case named", errOut.String())
	}
}

func TestCouncilBenchRefusalStartsNothing(t *testing.T) {
	refusal := tokengate.VerdictFor(tokengate.OptionDeny, tokengate.Spawn{Tool: "Council", Agents: 4}, 3_900_000)
	f := &benchFakes{plan: benchPlan(), verdict: refusal}
	useBenchFakes(t, f)
	var out, errOut bytes.Buffer

	if err := councilBenchStart(context.Background(), &out, &errOut, wshrpc.CommandCouncilBenchData{}); err != nil {
		t.Fatalf("a refusal is not an error: %v", err)
	}
	if want := []string{"dry run", "gate"}; !reflect.DeepEqual(f.steps, want) {
		t.Fatalf("steps = %v, want %v: the real call is never made", f.steps, want)
	}
	if !strings.Contains(out.String(), "Not run: ") || strings.Count(out.String(), "Not run:") != 1 {
		t.Errorf("output = %q, want one Not run: line", out.String())
	}
	if strings.Contains(out.String(), "bench started") {
		t.Errorf("output = %q says the bench started", out.String())
	}

	// a reason that does not open with "Not run:" is given the prefix
	f.steps, f.verdict, out = nil, tokengate.Verdict{Reason: "the budget is spent"}, bytes.Buffer{}
	if err := councilBenchStart(context.Background(), &out, &errOut, wshrpc.CommandCouncilBenchData{}); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); !strings.Contains(got, "Not run: the budget is spent\n") {
		t.Errorf("output = %q, want the bare reason prefixed", got)
	}
	if slices.Contains(f.steps, "start") {
		t.Errorf("steps = %v, the bench started after a refusal", f.steps)
	}
}

func TestCouncilBenchBrokenGateStartsAnyway(t *testing.T) {
	f := &benchFakes{plan: benchPlan(), gateErr: errors.New("reading settings: down")}
	useBenchFakes(t, f)
	var out, errOut bytes.Buffer

	if err := councilBenchStart(context.Background(), &out, &errOut, wshrpc.CommandCouncilBenchData{}); err != nil {
		t.Fatalf("councilBenchStart: %v", err)
	}
	if want := []string{"dry run", "gate", "start"}; !reflect.DeepEqual(f.steps, want) {
		t.Errorf("steps = %v, want %v: a broken gate never blocks", f.steps, want)
	}
	if !strings.Contains(errOut.String(), "token gate unavailable") {
		t.Errorf("stderr = %q, want the gate's failure said", errOut.String())
	}
}

func TestCouncilBenchPlanFailsBeforeTheGate(t *testing.T) {
	f := &benchFakes{plan: benchPlan(), verdict: tokengate.Verdict{Run: true}}
	useBenchFakes(t, f)
	councilBenchCall = func(data wshrpc.CommandCouncilBenchData) (*wshrpc.CouncilBenchRtnData, error) {
		return nil, errors.New(`unknown case "x" (cases: alpha) (skipped case x: key file is missing)`)
	}
	err := councilBenchStart(context.Background(), io.Discard, io.Discard, wshrpc.CommandCouncilBenchData{Cases: []string{"x"}})
	if err == nil || !strings.Contains(err.Error(), "skipped case x") {
		t.Fatalf("error = %v, want the plan's error with the skipped case named", err)
	}
	if len(f.steps) != 0 {
		t.Errorf("steps = %v, the gate is not asked about a plan that failed", f.steps)
	}
}

func TestCouncilBenchResultsTable(t *testing.T) {
	runs := []bench.CouncilBenchResult{
		{Harness: "2026-10-22.1", Variant: bench.VariantSolo, State: "done", Recall: 2, Keys: 6, Wrong: 1, Tokens: 550_000},
		{Harness: "2026-10-22.1", Variant: bench.VariantCouncil, State: "done", Recall: 3, Keys: 6, Kept: 1, Tokens: 1_400_000},
		{Harness: "2026-10-22.1", Variant: bench.VariantCouncil, State: "failed", Tokens: 600_000},
		{Harness: "2026-10-23.2", Variant: bench.VariantCouncil, State: "done", Recall: 4, Keys: 6, Tokens: 1_000_000},
		{Harness: "", Variant: bench.VariantSolo, State: "done", Recall: 1, Keys: 6, Tokens: 500_000},
	}
	ratings := []bench.CouncilBenchRating{
		{Harness: "2026-10-22.1", Mode: council.ModeReview, Council: "c1", Rating: bench.RatingUseful},
		{Harness: "2026-10-22.1", Mode: council.ModeReview, Council: "c2", Rating: bench.RatingNot},
		{Harness: "2026-10-23.2", Mode: council.ModeBrainstorm, Council: "c3", Rating: bench.RatingUseful},
	}
	res := &wshrpc.CouncilBenchResultsRtnData{Runs: bench.Summarize(runs), Ratings: bench.SummarizeRatings(ratings)}

	var lines [][]string
	for _, l := range strings.Split(strings.TrimRight(councilBenchTable(res), "\n"), "\n") {
		lines = append(lines, strings.Fields(l))
	}
	// the newest harness first, a council from before the version was recorded last; a failed run counts in Runs and in
	// its tokens, not in the recall it is read against
	want := [][]string{
		{"harness", "variant", "scored/runs", "recall", "kept", "wrong", "tokens", "recall/M", "tokens"},
		{"2026-10-23.2", "council", "1/1", "4/6", "0", "0", "1M", "4.0"},
		{"2026-10-22.1", "solo", "1/1", "2/6", "0", "1", "0.6M", "3.6"},
		{"2026-10-22.1", "council", "1/2", "3/6", "1", "0", "2M", "1.5"},
		{"unknown", "solo", "1/1", "1/6", "0", "0", "0.5M", "2.0"},
		{},
		{"harness", "mode", "useful", "not", "really"},
		{"2026-10-23.2", "brainstorm", "1", "0"},
		{"2026-10-22.1", "review", "1", "1"},
	}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("table rows:\n got %q\nwant %q", lines, want)
	}

	if got := councilBenchTable(&wshrpc.CouncilBenchResultsRtnData{}); !strings.Contains(got, "no bench results yet") {
		t.Errorf("empty table = %q, want it to say there are no results", got)
	}
	if strings.Contains(councilBenchTable(res), "verdict") {
		t.Errorf("table = %q, want no verdict line when the results carry none", councilBenchTable(res))
	}
}

func TestCouncilBenchTablePrintsTheVerdict(t *testing.T) {
	verdict := &bench.CouncilBenchDecision{Outcome: bench.DecisionGo, Reason: "the team is within one key line (team 5 of 12 keys, council 5 of 12)"}
	line := "verdict: go: the team is within one key line (team 5 of 12 keys, council 5 of 12)"
	runs := bench.Summarize([]bench.CouncilBenchResult{
		{Harness: "2026-11-03.1", Variant: bench.VariantCouncil, State: "done", Recall: 5, Keys: 12, Tokens: 8_000_000},
		{Harness: "2026-11-03.1", Variant: bench.VariantTeam, State: "done", Recall: 5, Keys: 12, Tokens: 4_000_000},
	})
	ratings := bench.SummarizeRatings([]bench.CouncilBenchRating{
		{Harness: "2026-11-03.1", Mode: council.ModeReview, Council: "c1", Rating: bench.RatingUseful},
	})

	// under the runs table, before the ratings
	lines := strings.Split(strings.TrimRight(councilBenchTable(&wshrpc.CouncilBenchResultsRtnData{Runs: runs, Ratings: ratings, Verdict: verdict}), "\n"), "\n")
	at := slices.Index(lines, line)
	if at != 4 || lines[3] != "" || !strings.HasPrefix(lines[0], "harness") || len(lines) < 7 || lines[5] != "" || !strings.HasPrefix(lines[6], "harness") {
		t.Errorf("table lines = %q, want the runs table (header and 2 rows), a blank line, the verdict line, a blank line, then the ratings", lines)
	}

	// no runs yet: the verdict stands in for "no bench results yet"
	got := councilBenchTable(&wshrpc.CouncilBenchResultsRtnData{Verdict: &bench.CouncilBenchDecision{
		Outcome: bench.DecisionNotDecided, Reason: "incomplete: spec-live-agents council has 0 of 2 scored runs",
	}})
	if want := "verdict: not decided: incomplete: spec-live-agents council has 0 of 2 scored runs\n"; got != want {
		t.Errorf("table with a verdict and no runs = %q, want %q", got, want)
	}

	// without a verdict the table is the runs alone
	if got := councilBenchTable(&wshrpc.CouncilBenchResultsRtnData{Runs: runs}); strings.Contains(got, "verdict") {
		t.Errorf("table = %q, want no verdict line", got)
	}
}

func TestCouncilBenchAsksForTwoRunsByDefault(t *testing.T) {
	f := &benchFakes{plan: benchPlan(), verdict: tokengate.Verdict{Run: true}}
	useBenchFakes(t, f)

	if err := councilBenchCmd.RunE(councilBenchCmd, nil); err != nil {
		t.Fatalf("a bare bench: %v", err)
	}
	if len(f.data) != 2 {
		t.Fatalf("calls = %+v, want a dry run and the real call", f.data)
	}
	for _, d := range f.data {
		if d.Runs != 2 || len(d.Cases) != 0 || len(d.Variants) != 0 {
			t.Errorf("call = %+v, want 2 runs of every case and the default variants", d)
		}
	}
	// the help names the variants and the defaults it now has
	variant := councilBenchCmd.Flags().Lookup("variant").Usage
	for _, word := range []string{"council", "team", "solo"} {
		if !strings.Contains(variant, word) {
			t.Errorf("--variant help = %q, want it to name %s", variant, word)
		}
	}
	for _, word := range []string{"50M", "team", "twice"} {
		if !strings.Contains(councilBenchCmd.Long, word) {
			t.Errorf("bench help is missing %q: %s", word, councilBenchCmd.Long)
		}
	}
}

func TestCouncilSeatModels(t *testing.T) {
	seats := []council.CouncilExpert{{Id: "ux", Name: "UX"}, {Id: "skeptic", Name: "Skeptic"}, {Id: "lead", Name: "Coordinator", Coordinator: true}}
	got, err := councilSeatModels(seats, []string{"Skeptic=opus", "sonnet"})
	if err != nil || len(got) != 3 || got["ux"] != "sonnet" || got["skeptic"] != "opus" || got["lead"] != "sonnet" {
		t.Fatalf("bare + named = %v %v, want every seat on sonnet but skeptic on opus", got, err)
	}
	if got, err := councilSeatModels(seats, []string{" ux = claude-opus-4-8 "}); err != nil || len(got) != 1 || got["ux"] != "claude-opus-4-8" {
		t.Fatalf("one named seat = %v %v, want ux alone", got, err)
	}
	if got, err := councilSeatModels(seats, nil); err != nil || len(got) != 0 {
		t.Fatalf("no --model = %v %v, want none", got, err)
	}
	for _, bad := range [][]string{{"sonnet", "opus"}, {"ux=opus", "UX=haiku"}, {"nobody=opus"}, {"ux=not a model"}, {""}} {
		if _, err := councilSeatModels(seats, bad); err == nil {
			t.Errorf("--model %q worked, want a refusal", bad)
		}
	}
	if _, err := councilSeatModels(seats, []string{"nobody=opus"}); err == nil || !strings.Contains(err.Error(), "ux, skeptic, lead") {
		t.Errorf("unknown seat = %v, want the seats listed", err)
	}
}

func TestCouncilRetryTarget(t *testing.T) {
	c := &council.Council{
		Id: "c1",
		Experts: []council.CouncilExpert{
			{Id: "cm", Name: "Committee member"},
			{Id: "pl", Name: "Planner"},
			{Id: "me", Name: "Mentor", Coordinator: true},
		},
		Failed: map[string]council.CouncilFailure{"cm": {Round: 2}, "pl": {Round: 2}, "me": {Round: 3}},
	}
	if e, err := councilRetryTarget(c, ""); err != nil || e.Id != "me" {
		t.Fatalf("no --expert: %v %v, want the failed summary's coordinator", e.Id, err)
	}
	if e, err := councilRetryTarget(c, "planner"); err != nil || e.Id != "pl" {
		t.Fatalf("--expert planner: %v %v, want pl by name", e.Id, err)
	}
	delete(c.Failed, "me")
	if _, err := councilRetryTarget(c, ""); err == nil || !strings.Contains(err.Error(), "--expert (cm, pl)") {
		t.Fatalf("two failed and no --expert: %v, want a refusal naming them", err)
	}
	delete(c.Failed, "cm")
	if e, err := councilRetryTarget(c, ""); err != nil || e.Id != "pl" {
		t.Fatalf("one failed: %v %v, want it", e.Id, err)
	}
	if _, err := councilRetryTarget(c, "me"); err == nil {
		t.Fatalf("a seat with no failed call was taken")
	}
	if _, err := councilRetryTarget(c, "nobody"); err == nil {
		t.Fatalf("an unknown seat was taken")
	}
	delete(c.Failed, "pl")
	if _, err := councilRetryTarget(c, ""); err == nil {
		t.Fatalf("a council with nothing failed was retried")
	}
}
