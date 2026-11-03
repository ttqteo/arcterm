// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// The groups a start or an estimate takes when --group is left out: the UI feature panel for a review and the Product
// ideas panel for a brainstorm; with --agent, the Bug hunter's panel for a review and the Other side's for a brainstorm.
// All four ship with arcterm, and a councilroles.json group of the same id replaces rather than removes them.
const (
	councilDefaultGroup    = "ui-feature"
	councilBrainstormGroup = "product-ideas"
	councilAgentSelf       = "self" // what --agent takes for the tab running the command
)

const (
	councilPollEvery      = 2 * time.Second
	councilDefaultTimeout = 30 * time.Minute
	councilStartTimeoutMs = 30_000 // a start or an estimate reads the size of the files it was given
)

var councilCmd = &cobra.Command{
	Use:   "council",
	Short: "have a panel of expert agents work a question in three rounds, and read the report back",
	Long: `A council is a panel of expert agents that works one question in three rounds, shown in arcterm as a group
chat while it runs and as a report when it is done. It runs in one of two modes: review (a thing that exists, judged,
and the directions ranked) or brainstorm (a problem or a goal, ideas worth trying with a first step each). Each start
costs roughly 0.5-1.5M tokens. "wsh council start" asks the Token burn gate like a costly subagent spawn, so start one
when the conversation is ready or the person asks, without asking first; a refusal saves the council as not run, and
Start council in the app runs it. One council runs at a time across all projects: a start while another runs is queued
and begins when it ends. A finished council saves its document, with the whole discussion, under the project's
docs/council/. "wsh council estimate" prints the group, the models and the cost without starting anything.`,
}

// ---- mode ----

// councilModeFlag reads --mode: review when it is left out, brainstorm or review in any case, and an error for any
// other word, so a typo is refused before anything is asked.
func councilModeFlag(word string) (string, error) {
	switch mode := strings.ToLower(strings.TrimSpace(word)); mode {
	case "", council.ModeReview:
		return council.ModeReview, nil
	case council.ModeBrainstorm:
		return council.ModeBrainstorm, nil
	}
	return "", fmt.Errorf("unknown --mode %q: use %s or %s", word, council.ModeReview, council.ModeBrainstorm)
}

// councilGroupFor is the group of a start or an estimate: the one --group names, else the group that fits the mode,
// and with chats seated (--agent) the one that sits beside them: a Bug hunter and the Summarizer for a review, the
// Other side and the Host for a brainstorm.
func councilGroupFor(group, mode string, withAgents bool) string {
	switch {
	case group != "":
		return group
	case withAgents && mode == council.ModeBrainstorm:
		return council.AgentsIdeasGroupId
	case withAgents:
		return council.AgentsGroupId
	case mode == council.ModeBrainstorm:
		return councilBrainstormGroup
	}
	return councilDefaultGroup
}

// councilModelName is the shape of a model name a seat may take: a claude alias (sonnet, fable) or a full model id.
var councilModelName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:\[\]-]*$`)

// councilSeatModels reads --model values against the seats in experts: a bare model is every seat's, a <seat>=<model>
// one seat's (its id or name, any case), which wins over a bare one whatever the order. It returns the model per
// expert id. A second bare model, a seat named twice, an unknown seat or a malformed model fails, naming the seats.
func councilSeatModels(experts []council.CouncilExpert, values []string) (map[string]string, error) {
	out := map[string]string{}
	all, named := "", map[string]bool{}
	seatIds := make([]string, len(experts))
	for i, e := range experts {
		seatIds[i] = e.Id
	}
	for _, v := range values {
		seat, model, hasSeat := strings.Cut(strings.TrimSpace(v), "=")
		if !hasSeat {
			seat, model = "", seat
		}
		seat, model = strings.TrimSpace(seat), strings.TrimSpace(model)
		if !councilModelName.MatchString(model) {
			return nil, fmt.Errorf("--model %q: %q is not a model name (sonnet, opus, haiku, fable, or a full id)", v, model)
		}
		if !hasSeat {
			if all != "" {
				return nil, fmt.Errorf("--model: two models for every seat (%s, %s); name a seat with <seat>=<model>", all, model)
			}
			all = model
			continue
		}
		i := slices.IndexFunc(experts, func(e council.CouncilExpert) bool {
			return strings.EqualFold(e.Id, seat) || strings.EqualFold(e.Name, seat)
		})
		if i < 0 {
			return nil, fmt.Errorf("--model %q: no seat %q (the seats: %s)", v, seat, strings.Join(seatIds, ", "))
		}
		if named[experts[i].Id] {
			return nil, fmt.Errorf("--model: %s is given two models", experts[i].Id)
		}
		named[experts[i].Id] = true
		out[experts[i].Id] = model
	}
	if all != "" {
		for _, e := range experts {
			if !named[e.Id] {
				out[e.Id] = all
			}
		}
	}
	return out, nil
}

// councilRepeated reads a repeatable flag. pflag reads a lone --flag "" back as no value at all, so a flag that was
// given but holds nothing is returned as one empty value, which the caller refuses instead of dropping.
func councilRepeated(cmd *cobra.Command, name string) []string {
	values, _ := cmd.Flags().GetStringArray(name)
	if len(values) == 0 && cmd.Flags().Changed(name) {
		return []string{""}
	}
	return values
}

// councilAgentFlags reads --agent (repeatable): the tab ids to seat in the order given, "self" being the tab this
// command runs in. An empty value is refused like self outside an agent's terminal, never dropped: a council must not
// start without a seat the person named. wavesrv checks that each id is a live claude or pi tab.
func councilAgentFlags(cmd *cobra.Command) ([]string, error) {
	var agents []string
	for _, a := range councilRepeated(cmd, "agent") {
		switch a = strings.TrimSpace(a); a {
		case "":
			return nil, errors.New("--agent needs a tab id (`wsh agents list --all` prints them) or self")
		case councilAgentSelf:
			if a = getTabIdFromEnv(); a == "" {
				return nil, errors.New("--agent self runs only inside an agent's terminal")
			}
		}
		agents = append(agents, a)
	}
	return agents, nil
}

// councilAddExperts adds the --expert roles to a panel, each from the roles answer and before the coordinator (the
// panel's last seat), in the order given. An unknown id, one already in the panel (a role the group has, or one named
// twice) or a coordinator role is refused, and the error lists the role ids --expert takes.
func councilAddExperts(roles *wshrpc.CouncilRolesRtnData, panel []council.CouncilExpert, ids []string) ([]council.CouncilExpert, error) {
	if len(ids) == 0 {
		return panel, nil
	}
	last := len(panel) - 1
	experts := slices.Clone(panel[:last])
	taken := map[string]bool{panel[last].Id: true}
	for _, e := range experts {
		taken[e.Id] = true
	}
	byId := map[string]council.CouncilExpert{}
	for _, r := range roles.Roles {
		byId[r.Id] = r
	}
	takes := func() string {
		var usable []string
		for _, r := range roles.Roles {
			if !r.Coordinator && !taken[r.Id] {
				usable = append(usable, r.Id)
			}
		}
		if len(usable) == 0 {
			return "none"
		}
		return strings.Join(usable, ", ")
	}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		r, ok := byId[id]
		switch {
		case !ok:
			return nil, fmt.Errorf("--expert %q is not a role; roles it takes: %s", id, takes())
		case r.Coordinator:
			return nil, fmt.Errorf("--expert %q writes the report and cannot sit as an expert; roles it takes: %s", id, takes())
		case taken[id]:
			return nil, fmt.Errorf("--expert %q is already in the panel; roles it takes: %s", id, takes())
		}
		taken[id] = true
		experts = append(experts, r)
	}
	return append(experts, panel[last]), nil
}

// ---- pure parts ----

// splitCouncilList reads a comma-separated flag (--files a.ts,b.ts): trimmed, empty items dropped.
func splitCouncilList(s string) []string {
	var out []string
	for item := range strings.SplitSeq(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// councilGitTop is the git top level of dir, "" when dir is not inside a repository (or git is missing).
func councilGitTop(dir string) string {
	out, err := exec.Command("git", "-C", dir, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return ""
	}
	top := strings.TrimSpace(string(out))
	if top == "" {
		return ""
	}
	return filepath.Clean(filepath.FromSlash(top))
}

// councilProjectFor is the project a command works on: --project, else the registered project (projects.json) that
// holds the working directory, the deepest one, else the git top level of the working directory, else the working
// directory itself (a paper in a plain folder is its own project). The registered project comes before the git top
// level because the Agent tree files a council under the project whose root is its path: a project registered at a
// monorepo's apps/website would never show a council keyed to the repo's top.
func councilProjectFor(flag, cwd string, registered map[string]wconfig.ProjectKeywords) string {
	if flag != "" {
		if abs, err := filepath.Abs(flag); err == nil {
			return abs
		}
		return flag
	}
	home, _ := os.UserHomeDir()
	if _, p, ok := wconfig.ProjectForDir(cwd, registered, home); ok {
		path := strings.TrimSpace(p.Path)
		if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
			path = home + path[1:]
		}
		return filepath.Clean(path)
	}
	if top := councilGitTop(cwd); top != "" {
		return top
	}
	return cwd
}

// councilRegisteredProjects is projects.json as wavesrv reads it, nil when it cannot be read: the project then falls
// back to the git top level.
func councilRegisteredProjects() map[string]wconfig.ProjectKeywords {
	cfg, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 10_000})
	if err != nil {
		return nil
	}
	return cfg.Projects
}

// councilFiles makes the files the experts read: a relative path is taken from the working directory, as any
// command's path flag is, and kept relative to the project when it lies inside it; one that lands outside the project
// (a --project given from another folder) is the project's own relative path, as written. An absolute path stays.
func councilFiles(files []string, cwd, project string) []string {
	out := make([]string, 0, len(files))
	for _, f := range files {
		if filepath.IsAbs(f) {
			out = append(out, f)
			continue
		}
		if rel, err := filepath.Rel(project, filepath.Join(cwd, f)); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			out = append(out, filepath.ToSlash(rel))
			continue
		}
		out = append(out, f)
	}
	return out
}

// councilPanelSize counts the experts that propose and review, which is all but the coordinator; it is the role
// experts of the gate's card and the "<n> experts" of a started line with no chat seated.
func councilPanelSize(experts []council.CouncilExpert) int {
	n := 0
	for _, e := range experts {
		if !e.Coordinator {
			n++
		}
	}
	return n
}

// councilPanel builds the panel of a group from the roles answer, the way council.ExpertsFor does from the library
// but without reading wsh's own config: roles in the group's order, an unknown or repeated role left out, the
// coordinator last with Coordinator set. The experts it returns are the panel the estimate prices and the start runs.
func councilPanel(roles *wshrpc.CouncilRolesRtnData, groupId string) (council.CouncilGroup, []council.CouncilExpert, error) {
	var group *council.CouncilGroup
	for i := range roles.Groups {
		if roles.Groups[i].Id == groupId {
			group = &roles.Groups[i]
			break
		}
	}
	if group == nil {
		ids := make([]string, len(roles.Groups))
		for i, g := range roles.Groups {
			ids[i] = g.Id
		}
		return council.CouncilGroup{}, nil, fmt.Errorf("no council group %q (groups: %s)", groupId, strings.Join(ids, ", "))
	}
	byId := map[string]council.CouncilExpert{}
	for _, r := range roles.Roles {
		byId[r.Id] = r
	}
	coordinator, ok := byId[group.Coordinator]
	if !ok {
		return council.CouncilGroup{}, nil, fmt.Errorf("council group %q has no coordinator: %q is not a known role", group.Id, group.Coordinator)
	}
	seen := map[string]bool{coordinator.Id: true}
	experts := make([]council.CouncilExpert, 0, len(group.Roles)+1)
	for _, id := range group.Roles {
		r, ok := byId[id]
		if !ok || seen[id] {
			continue
		}
		seen[id] = true
		r.Coordinator = false
		experts = append(experts, r)
	}
	coordinator.Coordinator = true
	experts = append(experts, coordinator)
	if councilPanelSize(experts) == 0 {
		return council.CouncilGroup{}, nil, fmt.Errorf("council group %q has no experts besides its coordinator", group.Id)
	}
	return *group, experts, nil
}

// councilModelsText names the experts by model: those on one model share a clause, the clauses in the order their
// model first appears among the experts, the names in expert order: "Ease of use, Memory watcher, New user, Bug hunter on sonnet, Summarizer on opus".
func councilModelsText(experts []council.CouncilExpert) string {
	var models []string
	names := map[string][]string{}
	for _, e := range experts {
		model := e.Model
		if model == "" {
			model = "the default model"
		}
		if _, seen := names[model]; !seen {
			models = append(models, model)
		}
		name := e.Name
		if name == "" {
			name = e.Id
		}
		names[model] = append(names[model], name)
	}
	clauses := make([]string, len(models))
	for i, m := range models {
		clauses[i] = strings.Join(names[m], ", ") + " on " + m
	}
	return strings.Join(clauses, ", ")
}

// councilEstimateLine is what an agent's offer quotes: the group, every expert's model, and the estimate.
func councilEstimateLine(group council.CouncilGroup, experts []council.CouncilExpert, est *wshrpc.CouncilEstimateRtnData) string {
	name := group.Name
	if name == "" {
		name = group.Id
	}
	return fmt.Sprintf("group \"%s\": %s · ≈ %d calls · ~%s tokens · ~%d min",
		name, councilModelsText(experts), est.Calls, council.FormatTokens(est.Tokens), est.Minutes)
}

// councilSpawn is the spawn the gate is asked about: a Council of the panel's role experts, priced at the council's own
// estimate (the chats seated are added to the count by the caller). A zero estimate would fall back to PerAgentTokens
// an expert, far above what a council costs.
func councilSpawn(experts []council.CouncilExpert, est *wshrpc.CouncilEstimateRtnData) tokengate.Spawn {
	return tokengate.Spawn{Tool: "Council", Agents: councilPanelSize(experts), EstimateTokens: est.Tokens}
}

func councilOneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func councilExpertsText(n int) string {
	if n == 1 {
		return "1 expert"
	}
	return fmt.Sprintf("%d experts", n)
}

func councilDraftsText(n int) string {
	if n == 1 {
		return "1 draft"
	}
	return fmt.Sprintf("%d drafts", n)
}

func councilChatsText(n int) string {
	if n == 1 {
		return "1 chat"
	}
	return fmt.Sprintf("%d chats", n)
}

// councilSeatsText names who sits in a started council, counted from the council wavesrv returned: "4 experts" when no
// chat is seated, else the chats and the role experts beside them, "2 chats + Bug hunter".
func councilSeatsText(experts []council.CouncilExpert) string {
	chats := 0
	var names []string
	for _, e := range experts {
		switch {
		case council.IsAgent(e):
			chats++
		case !e.Coordinator:
			name := e.Name
			if name == "" {
				name = e.Id
			}
			names = append(names, name)
		}
	}
	switch {
	case chats == 0:
		return councilExpertsText(councilPanelSize(experts))
	case len(names) == 0:
		return councilChatsText(chats)
	}
	return councilChatsText(chats) + " + " + strings.Join(names, ", ")
}

// councilStartedLine is the line a started council prints: the mode and the group it works in, who sits, then the cost.
func councilStartedLine(c *council.Council, feature, mode, group string, est *wshrpc.CouncilEstimateRtnData) string {
	return fmt.Sprintf("council %s started: %s · %s · %s · %s · ≈ %d calls · ~%s tokens",
		c.Id, councilOneLine(feature), mode, group, councilSeatsText(c.Experts), est.Calls, council.FormatTokens(est.Tokens))
}

// councilQueuedLine is the line a start prints when another council runs: the council it waits for (running is that
// council as saved, nil when it could not be read) and the new council's own id, which `wsh council wait` takes.
func councilQueuedLine(c, running *council.Council) string {
	if running == nil {
		return fmt.Sprintf("Queued after %s · council %s starts by itself when it ends", c.QueuedAfter, c.Id)
	}
	return fmt.Sprintf("Queued after %s (%s) · council %s starts by itself when it ends", running.Id, councilOneLine(running.Feature), c.Id)
}

// councilNotRunText is what a refusal prints. The gate's own reason already opens "Not run: " (it is the line the
// Claude mod hands an agent whose spawn was refused), and a reason that does not gets the prefix.
func councilNotRunText(reason, id string) string {
	reason = strings.TrimSpace(reason)
	if !strings.HasPrefix(reason, "Not run:") {
		reason = "Not run: " + reason
	}
	return reason + "\n" + fmt.Sprintf("council %s saved as not run; Start council in the app runs it\n", id)
}

// councilWaitDone says whether wait has something to report: a council that is neither running nor queued is finished,
// stopped, failed, never started, or waiting on the person, and none of them moves until someone acts. A queued one
// starts by itself, so wait goes on through it.
func councilWaitDone(c *council.Council) bool {
	return c.State != council.StateRunning && c.State != council.StateQueued
}

// councilWaitText is what wait prints once the council stops moving, and the error to exit non-zero on when it
// failed. A done council prints its markdown; one waiting on the person says what to do in the app.
func councilWaitText(c *council.Council) (string, error) {
	switch c.State {
	case council.StateDone:
		return council.Markdown(c), nil
	case council.StateAwaiting:
		if n := council.HeldDrafts(c); n > 0 { // a council with agents seated waits on its drafts, not on a Continue
			return fmt.Sprintf("council %s is waiting on you: %s from round %d wait for you. In arcterm, open the council and "+
				"send, edit or drop each one; the next round starts once none is left. Run `wsh council wait %s` again when "+
				"you have.\n", c.Id, councilDraftsText(n), c.Round, c.Id), nil
		}
		return fmt.Sprintf("council %s is waiting on you: it paused after round 1. In arcterm, open the council, untick the "+
			"proposals not worth a review, ask the experts anything, then press Continue. Rounds 2 and 3 follow; run "+
			"`wsh council wait %s` again when you have.\n", c.Id, c.Id), nil
	case council.StateNotRun:
		return fmt.Sprintf("council %s was never run: the token gate refused it. Start council in the app runs it.\n", c.Id), nil
	case council.StateStopped:
		return fmt.Sprintf("council %s was stopped; this is what the finished rounds hold.\n\n%s", c.Id, council.Markdown(c)), nil
	case council.StateFailed:
		reason := strings.TrimSpace(c.Error)
		if reason == "" {
			reason = "no reason was recorded"
		}
		return "", fmt.Errorf("council %s failed: %s", c.Id, reason)
	}
	return "", fmt.Errorf("council %s is %s", c.Id, c.State)
}

// councilWaitFor polls get every poll until the council stops running, ctx ends, or get fails.
func councilWaitFor(ctx context.Context, poll time.Duration, get func() (*council.Council, error)) (*council.Council, error) {
	for {
		c, err := get()
		if err != nil {
			return nil, err
		}
		if councilWaitDone(c) {
			return c, nil
		}
		select {
		case <-ctx.Done():
			return c, ctx.Err()
		case <-time.After(poll):
		}
	}
}

// councilListLine is one council as a line: id, state, round, feature.
func councilListLine(c *council.Council) string {
	state := string(c.State)
	if c.Pinned != 0 {
		state += " (pinned)"
	}
	return fmt.Sprintf("%s\t%s\tround %d\t%s", c.Id, state, c.Round, councilOneLine(c.Feature))
}

// ---- commands ----

// councilPlan is a council as priced: the project, the files, the mode, the group and its role experts (the chats
// seated are only tab ids here: wavesrv resolves them into seats), and the estimate.
type councilPlan struct {
	project string
	files   []string
	mode    string
	group   council.CouncilGroup
	experts []council.CouncilExpert
	agents  []string
	est     *wshrpc.CouncilEstimateRtnData
}

func councilPrepare(cmd *cobra.Command) (councilPlan, error) {
	mode, err := councilModeFlag(mustFlagString(cmd, "mode")) // first: a refused mode asks nothing
	if err != nil {
		return councilPlan{}, err
	}
	agents, err := councilAgentFlags(cmd)
	if err != nil {
		return councilPlan{}, err
	}
	cwd, err := os.Getwd()
	if err != nil {
		return councilPlan{}, fmt.Errorf("reading the working directory: %w", err)
	}
	plan := councilPlan{mode: mode, agents: agents}
	var registered map[string]wconfig.ProjectKeywords
	if mustFlagString(cmd, "project") == "" {
		registered = councilRegisteredProjects()
	}
	plan.project = councilProjectFor(mustFlagString(cmd, "project"), cwd, registered)
	plan.files = councilFiles(splitCouncilList(mustFlagString(cmd, "files")), cwd, plan.project)
	groupId := councilGroupFor(mustFlagString(cmd, "group"), mode, len(agents) > 0)
	roles, err := wshclient.CouncilRolesCommand(RpcClient, nil)
	if err != nil {
		return councilPlan{}, fmt.Errorf("reading the council roles: %w", err)
	}
	if plan.group, plan.experts, err = councilPanel(roles, groupId); err != nil {
		return councilPlan{}, err
	}
	if plan.experts, err = councilAddExperts(roles, plan.experts, councilRepeated(cmd, "expert")); err != nil {
		return councilPlan{}, err
	}
	models, err := councilSeatModels(plan.experts, councilRepeated(cmd, "model"))
	if err != nil {
		return councilPlan{}, err
	}
	for i := range plan.experts { // a copy per council: the role library keeps its own models
		if m, ok := models[plan.experts[i].Id]; ok {
			plan.experts[i].Model = m
		}
	}
	// a tab id that is no live claude or pi tab fails here, in wavesrv, before the Token burn gate is asked
	plan.est, err = wshclient.CouncilEstimateCommand(RpcClient, wshrpc.CommandCouncilEstimateData{
		Project: plan.project,
		Files:   plan.files,
		Experts: plan.experts,
		Agents:  plan.agents,
	}, &wshrpc.RpcOpts{Timeout: councilStartTimeoutMs})
	if err != nil {
		return councilPlan{}, fmt.Errorf("estimating the council: %w", err)
	}
	return plan, nil
}

var councilEstimateCmd = &cobra.Command{
	Use:   "estimate",
	Short: "print the group, every expert's model and the cost of a council, and start nothing",
	Args:  cobra.NoArgs,
	Long: `Print one line: the group, each expert's model, and the estimate. It starts nothing and asks nothing. The files are
the ones the experts would read, whose size is part of the estimate. With no --group, --mode brainstorm prices the
product-ideas group and review (the default) the ui-feature one.

--agent <tab id> (repeatable) prices a live chat as a seat: its current context times the rounds. --agent self is the
tab this command runs in. With --agent and no --group, review prices the agents group (a Bug hunter and the Summarizer)
and brainstorm the agents-ideas group (the Other side and the Host). --expert <role id> (repeatable) adds that role
from the role library before the coordinator. --model prices the seats on other models, as "wsh council start" takes it.
A tab id that is not a live claude or pi tab fails, listing the live ones.`,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		plan, err := councilPrepare(cmd)
		if err != nil {
			return err
		}
		fmt.Println(councilEstimateLine(plan.group, plan.experts, plan.est))
		return nil
	},
}

var councilStartCmd = &cobra.Command{
	Use:   "start",
	Short: "start a council on a feature (asks the Token burn gate first; a refusal saves it as not run)",
	Args:  cobra.NoArgs,
	Long: `Start a council: the group's experts propose in round 1, react to each other in round 2, and the coordinator
writes the answer in round 3. Start one when the conversation holds a clear problem or a thing to judge and a real open
question that more viewpoints would settle, or at once when the person asks for one. The start asks the Token burn gate
with the council's own estimate; when the person refuses, the council is saved as not run, "Not run: <reason>" is printed
and the command exits 0: do not retry, say so in your report. Read the outcome back with "wsh council wait <id>".

--mode says how the council works. review (the default) judges a thing that exists (a feature, a spec, a plan, a draft):
every claim cites evidence and the report ranks directions. brainstorm takes a problem or a goal: ideas need no
evidence, judging waits, and the report holds up to three ideas worth trying, each with its first step, and the wild
ideas kept aside. Pick the mode from the question and say why in one line with --mode-why. With no --group, brainstorm
takes the product-ideas group and review the ui-feature one.

--question is the person's question in their own words, with the constraints they stated. --files are the files the
experts read; --screenshot <png> (repeatable) puts a screenshot in front of them, which they open with Read.

--agent <tab id> (repeatable; ids from "wsh agents list --all", a unique prefix is enough) seats a live chat the person
named: it speaks from its own context, in its own tab, not from a summary written for the panel. --agent self seats the
chat running this command, and only when the person named it ("this chat"); a council with no chat named stays
expert-only. A tab named twice sits once. An id that is not a live claude or pi tab fails before the Token burn gate,
listing the live tabs: ask the person which they meant, and never start without a seat they named. With --agent and no
--group, review takes the agents group (a Bug hunter beside the chats, then the Summarizer) and brainstorm the
agents-ideas group (the Other side, then the Host); an explicit --group adds its roles beside the chats.
--expert <role id> (repeatable) adds one more role from the role library before the coordinator, when the question
needs a view no seat has; an unknown or repeated id, or a coordinator role, fails, listing the ids it takes.
--model sets the role seats' models for this council only, as Setup's model menus do: --model sonnet puts every role
seat on sonnet, --model skeptic=opus one seat (its id or name), which wins over a bare one; repeat the flag for more.
The role library keeps its own models, and a seated chat answers on its session's model. An unknown seat fails, listing
the seats. A council
"wsh council start" starts never holds drafts: it runs to the report by itself, chats seated or not, and a person can
still post to a seat in the room. A starter seated with --agent self runs "wsh council wait <id> --timeout 0" in the
background (a pi agent has no background shell, so it does not seat itself): each round reaches it as a prompt.

One council runs at a time across all projects: a start while another council runs is queued, prints
"Queued after <id> (<feature>)" with the new council's own id, and starts by itself when the running one ends (a council
waiting on the person holds no slot). "wsh council wait <id>" waits through the queue. --queue is still accepted and does
nothing more: every second start is queued now. --pause stops the council after round 1 so the person can cut proposals
and ask a question before the next rounds.`,
	PreRunE: preRunSetupRpcClient,
	RunE:    councilStartRun,
}

// councilStartData is the start request of a prepared plan: the plan, the flags that do not change what it costs
// (question, pause, session, the reason for the mode) and the screenshots. It always carries ByAgent: a council this
// command starts never holds an answer as a draft, chats seated or not.
func councilStartData(cmd *cobra.Command, plan councilPlan, feature string, screenshots []string) wshrpc.CommandCouncilStartData {
	pause, _ := cmd.Flags().GetBool("pause")
	return wshrpc.CommandCouncilStartData{
		Project:     plan.project,
		Feature:     feature,
		Question:    strings.TrimSpace(mustFlagString(cmd, "question")),
		Files:       plan.files,
		Screenshots: screenshots,
		Group:       plan.group.Id,
		Experts:     plan.experts,
		Agents:      plan.agents,
		ByAgent:     true,
		Pause:       pause,
		SessionId:   councilSession(cmd),
		Mode:        plan.mode,
		ModeWhy:     councilOneLine(mustFlagString(cmd, "mode-why")),
	}
}

func councilStartRun(cmd *cobra.Command, args []string) error {
	feature := strings.TrimSpace(mustFlagString(cmd, "feature"))
	if feature == "" {
		return errors.New("--feature is required: name what the council looks at")
	}
	screenshots, err := councilScreenshots(cmd)
	if err != nil {
		return err
	}
	plan, err := councilPrepare(cmd)
	if err != nil {
		return err
	}
	data := councilStartData(cmd, plan, feature, screenshots)
	spawn := councilSpawn(plan.experts, plan.est)
	spawn.Agents += len(plan.agents) // a seated chat is an agent at work too, beside the role experts
	verdict, gateErr := tokengateDecide(context.Background(), spawn, "", func(hold any) {
		if h, ok := hold.(tokengate.Hold); ok {
			fmt.Println(h.Hold)
		}
	})
	startOpts := &wshrpc.RpcOpts{Timeout: councilStartTimeoutMs}
	switch {
	case gateErr != nil:
		// a broken gate never blocks an agent, here as in the Claude mod: the council is wanted, only its price is unknown
		fmt.Fprintf(os.Stderr, "token gate unavailable (%v); starting the council anyway\n", gateErr)
	case !verdict.Run:
		data.NotRun = true
		c, err := wshclient.CouncilStartCommand(RpcClient, data, startOpts)
		if err != nil {
			return fmt.Errorf("saving the council as not run: %w", err)
		}
		fmt.Print(councilNotRunText(verdict.Reason, c.Id))
		return nil
	}
	// one council runs at a time across all projects: wavesrv queues this one when another runs, so there is nothing to wait for here
	c, err := wshclient.CouncilStartCommand(RpcClient, data, startOpts)
	if err != nil {
		return fmt.Errorf("starting the council: %w", err)
	}
	if c.State == council.StateQueued {
		var running *council.Council
		if c.QueuedAfter != "" {
			running, _ = wshclient.CouncilGetCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: c.QueuedAfter}, nil)
		}
		fmt.Println(councilQueuedLine(c, running))
		return nil
	}
	group := plan.group.Name
	if group == "" {
		group = plan.group.Id
	}
	fmt.Println(councilStartedLine(c, feature, plan.mode, group, plan.est))
	return nil
}

// councilScreenshots reads --screenshot (repeatable) as absolute paths of files that exist: the experts open them
// from the project folder, which the screenshot need not be in.
func councilScreenshots(cmd *cobra.Command) ([]string, error) {
	given, _ := cmd.Flags().GetStringArray("screenshot")
	var out []string
	for _, s := range given {
		if s = strings.TrimSpace(s); s == "" {
			continue
		}
		abs, err := filepath.Abs(s)
		if err != nil {
			return nil, fmt.Errorf("screenshot %s: %w", s, err)
		}
		info, err := os.Stat(abs)
		if err != nil {
			return nil, fmt.Errorf("screenshot %s: %w", s, err)
		}
		if info.IsDir() {
			return nil, fmt.Errorf("screenshot %s is a folder, not an image", s)
		}
		out = append(out, abs)
	}
	return out, nil
}

// councilSession is the agent session that starts the council: --session, else the session of the terminal this runs in.
func councilSession(cmd *cobra.Command) string {
	if s := mustFlagString(cmd, "session"); s != "" {
		return s
	}
	if blockId := os.Getenv("WAVETERM_BLOCKID"); blockId != "" {
		return blockSession(blockId)
	}
	return ""
}

var councilListCmd = &cobra.Command{
	Use:   "list",
	Short: "list the project's councils, newest first: id, state, round and feature",
	Args:  cobra.NoArgs,
	Long: `List the councils of one project, newest first. The project is --project, else the registered project holding
the working directory, else its git top level; outside both, or with --project "", every council is listed.`,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		project := ""
		if cmd.Flags().Changed("project") {
			if p := mustFlagString(cmd, "project"); p != "" {
				project = councilProjectFor(p, "", nil)
			}
		} else if cwd, err := os.Getwd(); err == nil {
			home, _ := os.UserHomeDir()
			registered := councilRegisteredProjects()
			if _, _, ok := wconfig.ProjectForDir(cwd, registered, home); ok || councilGitTop(cwd) != "" {
				project = councilProjectFor("", cwd, registered)
			}
		}
		list, err := wshclient.CouncilListCommand(RpcClient, wshrpc.CommandCouncilListData{Project: project}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(list)
		}
		for _, c := range list {
			fmt.Println(councilListLine(c))
		}
		return nil
	},
}

var councilShowCmd = &cobra.Command{
	Use:     "show <id>",
	Short:   "print a council's Summary and Matrix as markdown",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		c, err := wshclient.CouncilGetCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: args[0]}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(c)
		}
		fmt.Print(council.Markdown(c))
		return nil
	},
}

var councilWaitCmd = &cobra.Command{
	Use:   "wait <id>",
	Short: "wait until a council stops running, then print its Summary and Matrix as markdown",
	Args:  cobra.ExactArgs(1),
	Long: `Poll the council every 2 seconds until it is no longer running, then print what it holds. A council that is queued
behind another is waited through, to the end of its own run. A done council prints its markdown; one that paused after
round 1 says what the person must do in the app, and a failed one exits non-zero with its reason. --timeout bounds the
wait (30m by default); on a timeout the council keeps running, or stays queued.`,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		timeout, _ := cmd.Flags().GetDuration("timeout")
		ctx := context.Background()
		if timeout > 0 {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, timeout)
			defer cancel()
		}
		id := args[0]
		c, err := councilWaitFor(ctx, councilPollEvery, func() (*council.Council, error) {
			return wshclient.CouncilGetCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: id}, nil)
		})
		if errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("council %s has not finished after %s (it is running or queued); run `wsh council wait %s` to keep waiting", id, timeout, id)
		}
		if err != nil {
			return err
		}
		text, err := councilWaitText(c)
		if err != nil {
			return err
		}
		fmt.Print(text)
		return nil
	},
}

var councilStopCmd = &cobra.Command{
	Use:     "stop <id>",
	Short:   "stop a running or queued council; the rounds that finished stay, and a queued one never runs",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := wshclient.CouncilStopCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: args[0]}, nil); err != nil {
			return err
		}
		fmt.Printf("council %s stopped\n", args[0])
		return nil
	},
}

var councilRmCmd = &cobra.Command{
	Use:     "rm <id>",
	Short:   "remove an ended council (done, failed, stopped or not run) for good: its file goes to ~/.arc/trash, the document it wrote stays",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := wshclient.CouncilDeleteCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: args[0]}, nil); err != nil {
			return err
		}
		fmt.Printf("council %s removed\n", args[0])
		return nil
	},
}

var councilPinCmd = &cobra.Command{
	Use:   "pin <id>",
	Short: "pin a council: the cockpit keeps it at the top of its project in the Agent tree",
	Long: `Pin a council, in any state, running ones too: the Agent tree keeps it at the top of its project folder until it
is unpinned. --off unpins it. Only the person pins: a council that runs again (a retry, a reply) keeps its pin as it
was. "wsh council rm" removes an ended one for good (into ~/.arc/trash).`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		off, _ := cmd.Flags().GetBool("off")
		if err := wshclient.CouncilPinCommand(RpcClient, wshrpc.CommandCouncilPinData{Id: args[0], Pinned: !off}, nil); err != nil {
			return err
		}
		if off {
			fmt.Printf("council %s unpinned\n", args[0])
		} else {
			fmt.Printf("council %s pinned\n", args[0])
		}
		return nil
	},
}

var councilRetryCmd = &cobra.Command{
	Use:   "retry <id>",
	Short: "run a failed council call again, once, optionally on another model; the discussion so far stays",
	Args:  cobra.ExactArgs(1),
	Long: `Run one failed call of a council again: the coordinator's summary when it failed, else the one expert that failed;
with several failed, name one with --expert (its id or name). The rounds and replies that finished stay, so a retried
summary costs one call, not a new council. --model runs this retry once on another model (opus, sonnet, fable, haiku, or
a full id such as claude-opus-4-8); the seat keeps its own model. A call Claude's safeguards flagged already ran once
more on claude-opus-4-8 by itself before it failed. A running council cannot be retried; wait for it or stop it, and
retry several failed seats with --all, which reruns every failed seat but the coordinator at once in one run (the
summary keeps its own retry, as it reads what they bring back); with --all, --model <model> puts every one of them on
that model and --model <seat>=<model> (repeatable) one seat. Read the outcome back with "wsh council wait <id>".`,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		want, _ := cmd.Flags().GetString("expert")
		all, _ := cmd.Flags().GetBool("all")
		models := councilRepeated(cmd, "model")
		c, err := wshclient.CouncilGetCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: args[0]}, nil)
		if err != nil {
			return err
		}
		if all {
			if strings.TrimSpace(want) != "" {
				return errors.New("--all retries every failed seat: leave --expert out")
			}
			return councilRetryAll(c, models)
		}
		if len(models) > 1 {
			return errors.New("--model takes one model for one retry; name seats with <seat>=<model> only with --all")
		}
		model := ""
		if len(models) == 1 {
			model = models[0]
		}
		if strings.Contains(model, "=") {
			return errors.New("--model <seat>=<model> goes with --all; for one seat, use --expert <seat> --model <model>")
		}
		e, err := councilRetryTarget(c, want)
		if err != nil {
			return err
		}
		data := wshrpc.CommandCouncilRetryData{Id: c.Id, ExpertId: e.Id, Model: strings.TrimSpace(model)}
		if err := wshclient.CouncilRetryCommand(RpcClient, data, nil); err != nil {
			return err
		}
		what := e.Name + "'s call"
		if e.Coordinator {
			what = "the summary (" + e.Name + ")"
		}
		on := ""
		if data.Model != "" {
			on = " on " + data.Model
		}
		fmt.Printf("council %s: retrying %s%s; run `wsh council wait %s` for the outcome\n", c.Id, what, on, c.Id)
		return nil
	},
}

// councilRetryAll is `wsh council retry --all`: every failed seat but the coordinator, at once, each on the model
// --model gives it or its own.
func councilRetryAll(c *council.Council, values []string) error {
	var failed []council.CouncilExpert
	for _, e := range c.Experts {
		if _, ok := c.Failed[e.Id]; ok && !e.Coordinator {
			failed = append(failed, e)
		}
	}
	if len(failed) == 0 {
		return fmt.Errorf("council %s has no failed seat to retry (a failed summary is retried with plain `wsh council retry %s`)", c.Id, c.Id)
	}
	models, err := councilSeatModels(failed, values)
	if err != nil {
		return err
	}
	data := wshrpc.CommandCouncilRetryData{Id: c.Id, All: true, Models: models}
	if err := wshclient.CouncilRetryCommand(RpcClient, data, nil); err != nil {
		return err
	}
	names := make([]string, len(failed))
	for i, e := range failed {
		names[i] = e.Name
		if m := models[e.Id]; m != "" {
			names[i] += " on " + m
		}
	}
	fmt.Printf("council %s: retrying %s; run `wsh council wait %s` for the outcome\n", c.Id, strings.Join(names, ", "), c.Id)
	return nil
}

// councilRetryTarget is the seat `wsh council retry` reruns: the one named by want (an id or a name, any case), else
// the coordinator when its summary failed, else the only seat that failed. A seat that has no failed call is refused.
func councilRetryTarget(c *council.Council, want string) (council.CouncilExpert, error) {
	want = strings.TrimSpace(want)
	if want != "" {
		for _, e := range c.Experts {
			if strings.EqualFold(e.Id, want) || strings.EqualFold(e.Name, want) {
				if _, ok := c.Failed[e.Id]; !ok {
					return e, fmt.Errorf("%s has no failed call in council %s", e.Name, c.Id)
				}
				return e, nil
			}
		}
		return council.CouncilExpert{}, fmt.Errorf("council %s has no expert %q", c.Id, want)
	}
	var failed []council.CouncilExpert
	for _, e := range c.Experts {
		if _, ok := c.Failed[e.Id]; !ok {
			continue
		}
		if e.Coordinator {
			return e, nil
		}
		failed = append(failed, e)
	}
	switch len(failed) {
	case 0:
		return council.CouncilExpert{}, fmt.Errorf("council %s has no failed call to retry", c.Id)
	case 1:
		return failed[0], nil
	}
	names := make([]string, len(failed))
	for i, e := range failed {
		names[i] = e.Id
	}
	return council.CouncilExpert{}, fmt.Errorf("council %s has %d failed calls: name one with --expert (%s), or retry them all with --all", c.Id, len(failed), strings.Join(names, ", "))
}

// ---- bench ----

// The three calls and the gate of `wsh council bench`, as variables so a test stands in for wavesrv and the person.
var (
	councilBenchCall = func(data wshrpc.CommandCouncilBenchData) (*wshrpc.CouncilBenchRtnData, error) {
		return wshclient.CouncilBenchCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: councilStartTimeoutMs})
	}
	councilBenchResultsCall = func() (*wshrpc.CouncilBenchResultsRtnData, error) {
		return wshclient.CouncilBenchResultsCommand(RpcClient, nil)
	}
	councilBenchStopCall = func() (*wshrpc.CouncilBenchStopRtnData, error) {
		// stopping waits for the council in flight to save itself stopped: 15 seconds at the longest
		return wshclient.CouncilBenchStopCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 30_000})
	}
	councilBenchGate = tokengateDecide
)

// councilBenchSpawn is the spawn the gate is asked about for a whole bench: one Council per run of the plan, priced at
// the plan's own estimate.
func councilBenchSpawn(plan *wshrpc.CouncilBenchRtnData) tokengate.Spawn {
	return tokengate.Spawn{Tool: "Council", Agents: len(plan.Items), EstimateTokens: plan.Estimate}
}

// councilBenchPlanLine is what a bench prints before it asks the gate and once it has started: how many councils over
// how many cases, and the estimate.
func councilBenchPlanLine(plan *wshrpc.CouncilBenchRtnData) string {
	cases := map[string]bool{}
	for _, it := range plan.Items {
		cases[it.Case] = true
	}
	return fmt.Sprintf("%s over %s · ~%s tokens", councilCountText(len(plan.Items), "council"), councilCountText(len(cases), "case"),
		council.FormatTokens(plan.Estimate))
}

func councilCountText(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// councilBenchStart runs a bench: it plans it with a dry run, asks the Token burn gate once with the plan's total
// estimate, and only then makes the real call. A refusal prints "Not run: …" and starts nothing; a gate that is broken
// never blocks, as at `wsh council start`.
func councilBenchStart(ctx context.Context, out, errOut io.Writer, data wshrpc.CommandCouncilBenchData) error {
	data.DryRun = true
	plan, err := councilBenchCall(data)
	if err != nil {
		return fmt.Errorf("planning the bench: %w", err)
	}
	for _, s := range plan.Skipped {
		fmt.Fprintln(errOut, s)
	}
	fmt.Fprintln(out, "bench: "+councilBenchPlanLine(plan))

	verdict, gateErr := councilBenchGate(ctx, councilBenchSpawn(plan), "", func(hold any) {
		if h, ok := hold.(tokengate.Hold); ok {
			fmt.Fprintln(out, h.Hold)
		}
	})
	switch {
	case gateErr != nil:
		fmt.Fprintf(errOut, "token gate unavailable (%v); starting the bench anyway\n", gateErr)
	case !verdict.Run:
		reason := strings.TrimSpace(verdict.Reason)
		if !strings.HasPrefix(reason, "Not run:") {
			reason = "Not run: " + reason
		}
		fmt.Fprintln(out, reason)
		return nil
	}

	data.DryRun = false
	if plan, err = councilBenchCall(data); err != nil {
		return fmt.Errorf("starting the bench: %w", err)
	}
	fmt.Fprintf(out, "bench started: %s; the councils run one at a time. `wsh council bench results` reads the table, `wsh council bench stop` ends it\n",
		councilBenchPlanLine(plan))
	return nil
}

// councilBenchHarness spells a harness version for the table: a council from before the version was recorded has none.
func councilBenchHarness(h string) string {
	if h == "" {
		return "unknown"
	}
	return h
}

// councilBenchTable is the results as two tables, as wavesrv grouped them (the newest harness version first, so an old
// score is never read as the new one's): the bench runs per harness and variant, then the go / no-go verdict on the
// council against the agent team when wavesrv gave one (it says what is still missing before there are runs), then the
// ratings of the real councils per harness and mode.
func councilBenchTable(res *wshrpc.CouncilBenchResultsRtnData) string {
	if len(res.Runs) == 0 && len(res.Ratings) == 0 && res.Verdict == nil {
		return "no bench results yet; `wsh council bench` runs the benchmark\n"
	}
	var b strings.Builder
	if len(res.Runs) > 0 {
		w := tabwriter.NewWriter(&b, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "harness\tvariant\tscored/runs\trecall\tkept\twrong\ttokens\trecall/M tokens")
		for _, r := range res.Runs {
			perM := "-"
			if r.Scored > 0 && r.Tokens > 0 {
				perM = fmt.Sprintf("%.1f", r.RecallPerM)
			}
			fmt.Fprintf(w, "%s\t%s\t%d/%d\t%d/%d\t%d\t%d\t%s\t%s\n", councilBenchHarness(r.Harness), r.Variant, r.Scored, r.Runs,
				r.Recall, r.Keys, r.Kept, r.Wrong, council.FormatTokens(r.Tokens), perM)
		}
		w.Flush()
	}
	if v := res.Verdict; v != nil {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "verdict: %s: %s\n", v.Outcome, v.Reason)
	}
	if len(res.Ratings) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		w := tabwriter.NewWriter(&b, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "harness\tmode\tuseful\tnot really")
		for _, r := range res.Ratings {
			fmt.Fprintf(w, "%s\t%s\t%d\t%d\n", councilBenchHarness(r.Harness), r.Mode, r.Useful, r.Not)
		}
		w.Flush()
	}
	return b.String()
}

var councilBenchCmd = &cobra.Command{
	Use:   "bench",
	Short: "run the council benchmark (asks the Token burn gate first), or read its results",
	Args:  cobra.NoArgs,
	Long: `Run the council's benchmark: the cases under the data dir (council-bench/cases.json) that are not retired, each as a
council and as a Claude Code agent team with the council's roles, --runs times each, one run at a time. A bare bench is
council and team twice on each case. A retired case runs only when --case names it, and --variant solo adds one agent
working alone. A judge scores every report against its case's key, and each run is appended to council-bench.jsonl.
Nothing it runs is listed in the app or writes a document into the case's project. The command prices the plan first at
Phase 0b's measured means (about 8.8M tokens a council run, 4.5M a team run and 2.3M a solo run), asks the Token burn gate
once with the total, and starts the bench in wavesrv only when the person allows it; a refusal prints "Not run: <reason>"
and starts nothing. The bench starts no new run once the tokens spent so far, judge calls included, reach the 50M token
cap: a run already going finishes, and --case reruns what was cut. It returns at once; "wsh council bench results" prints
the table when runs have ended, grouped by harness version so an old score is never read as the new one's, with the
go / no-go verdict on the team under it, and "wsh council bench stop" ends a bench early. A full bench (no --case) that
runs to its end adds a re-measure chunk, due in a month, to the Council benchmark initiative.`,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		cases, _ := cmd.Flags().GetStringArray("case")
		variants, _ := cmd.Flags().GetStringArray("variant")
		runs, _ := cmd.Flags().GetInt("runs")
		if runs < 1 {
			return fmt.Errorf("--runs must be 1 or more, got %d", runs)
		}
		return councilBenchStart(context.Background(), os.Stdout, os.Stderr,
			wshrpc.CommandCouncilBenchData{Cases: cases, Variants: variants, Runs: runs})
	},
}

var councilBenchResultsCmd = &cobra.Command{
	Use:     "results",
	Short:   "print the benchmark's results per harness version, and the ratings of real councils",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		res, err := councilBenchResultsCall()
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(res)
		}
		fmt.Print(councilBenchTable(res))
		return nil
	},
}

var councilBenchStopCmd = &cobra.Command{
	Use:     "stop",
	Short:   "end the running bench and stop the council it is on",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		res, err := councilBenchStopCall()
		if err != nil {
			return err
		}
		if !res.Stopped {
			fmt.Println("no bench is running")
			return nil
		}
		fmt.Println("bench stopped; the runs it scored stay in the results")
		return nil
	},
}

func addCouncilPanelFlags(cmd *cobra.Command) {
	f := cmd.Flags()
	f.String("feature", "", "what the council looks at: the feature, or the problem or goal")
	f.String("files", "", "the files or folders the experts read, comma-separated")
	f.String("group", "", "the expert group (default "+councilDefaultGroup+", or "+councilBrainstormGroup+" for --mode brainstorm; with --agent, "+
		council.AgentsGroupId+", or "+council.AgentsIdeasGroupId+" for --mode brainstorm; see Setup in the app for the others)")
	f.StringArray("agent", nil, "seat a live chat the person named: a tab id from `wsh agents list --all` (a unique prefix will do), or "+councilAgentSelf+" for this chat; repeat the flag for more")
	f.StringArray("expert", nil, "add this role from the role library before the coordinator (repeat the flag for more); an unknown or repeated id, or a coordinator role, fails and lists the ids it takes")
	f.String("project", "", "the project folder (default: the registered project holding the working directory, else its git top level)")
	f.String("mode", "", "how the council works: "+council.ModeReview+" (default) judges a thing that exists, "+council.ModeBrainstorm+" looks for ideas for a problem or goal")
	f.StringArray("model", nil, "a model for this council only: <model> for every role seat, <seat>=<model> for one (its id or name; it wins over a bare one); repeat the flag for more. A seated chat keeps its own session's model")
}

// addCouncilStartFlags adds the flags that only a start takes, beside the panel flags.
func addCouncilStartFlags(cmd *cobra.Command) {
	f := cmd.Flags()
	f.String("question", "", "a question put to the whole council")
	f.String("mode-why", "", "one line on why that mode, kept with the council")
	f.StringArray("screenshot", nil, "a screenshot (png) the experts open with Read; repeat the flag for more")
	f.Bool("pause", false, "stop after round 1 so the person can cut proposals and ask a question")
	f.Bool("queue", false, "accepted and ignored: one council runs at a time across all projects, so a start while another runs is always queued")
	f.String("session", "", "the agent session that starts it; defaults to the session in this terminal")
}

func init() {
	addCouncilPanelFlags(councilEstimateCmd)
	addCouncilPanelFlags(councilStartCmd)
	addCouncilStartFlags(councilStartCmd)
	councilListCmd.Flags().String("project", "", "the project folder (default: the registered project holding the working directory, else its git top level; \"\" lists every council)")
	councilListCmd.Flags().Bool("json", false, "JSON output")
	councilShowCmd.Flags().Bool("json", false, "JSON output (the whole council)")
	councilWaitCmd.Flags().Duration("timeout", councilDefaultTimeout, "give up waiting after this long (0 waits without limit)")
	councilBenchCmd.Flags().StringArray("case", nil, "run only this case, a retired one included (repeatable; default every case not retired)")
	councilBenchCmd.Flags().StringArray("variant", nil, "run only this variant: council, team or solo (repeatable; default council and team)")
	councilBenchCmd.Flags().Int("runs", 2, "runs of each case × variant (the team verdict needs 2 scored runs of each)")
	councilBenchResultsCmd.Flags().Bool("json", false, "JSON output")
	councilPinCmd.Flags().Bool("off", false, "unpin the council")
	councilRetryCmd.Flags().String("expert", "", "the seat to retry, by id or name (default: the failed summary, else the one failed seat)")
	councilRetryCmd.Flags().StringArray("model", nil, "run this retry once on another model (opus, sonnet, fable, haiku, claude-opus-4-8); the seat keeps its own. With --all, <model> for every seat or <seat>=<model> (repeatable)")
	councilRetryCmd.Flags().Bool("all", false, "retry every failed seat but the coordinator at once, in one run")
	councilBenchCmd.AddCommand(councilBenchResultsCmd, councilBenchStopCmd)
	councilCmd.AddCommand(councilEstimateCmd, councilStartCmd, councilListCmd, councilShowCmd, councilWaitCmd, councilStopCmd, councilRetryCmd, councilPinCmd, councilRmCmd, councilBenchCmd)
	rootCmd.AddCommand(councilCmd)
}
