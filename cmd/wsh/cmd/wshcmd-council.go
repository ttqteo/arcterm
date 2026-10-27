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
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// The groups a start or an estimate takes when --group is left out: the UI feature panel for a review and the Product
// ideas panel for a brainstorm. Both ship with arcterm, and a councilroles.json group of the same id replaces rather
// than removes them.
const (
	councilDefaultGroup    = "ui-feature"
	councilBrainstormGroup = "product-ideas"
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

// councilGroupFor is the group of a start or an estimate: the one --group names, else the group that fits the mode.
func councilGroupFor(group, mode string) string {
	switch {
	case group != "":
		return group
	case mode == council.ModeBrainstorm:
		return councilBrainstormGroup
	}
	return councilDefaultGroup
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

// councilProjectFor is the project a command works on: --project, else the git top level of the working directory,
// else the working directory itself (a paper in a plain folder is its own project).
func councilProjectFor(flag, cwd string) string {
	if flag != "" {
		if abs, err := filepath.Abs(flag); err == nil {
			return abs
		}
		return flag
	}
	if top := councilGitTop(cwd); top != "" {
		return top
	}
	return cwd
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

// councilPanelSize counts the experts that propose and review, which is all but the coordinator; it is the n of the
// gate's card, the estimate and the "<n> experts" of the started line.
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
// model first appears among the experts, the names in expert order: "UX, RAM, New user, Skeptic on sonnet, Coordinator on opus".
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

// councilSpawn is the spawn the gate is asked about: a Council of the panel's experts, priced at the council's own
// estimate. A zero estimate would fall back to PerAgentTokens an expert, far above what a council costs.
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

// councilStartedLine is the line a started council prints: the mode and the group it works in, then the cost.
func councilStartedLine(id, feature, mode, group string, n int, est *wshrpc.CouncilEstimateRtnData) string {
	return fmt.Sprintf("council %s started: %s · %s · %s · %s · ≈ %d calls · ~%s tokens",
		id, councilOneLine(feature), mode, group, councilExpertsText(n), est.Calls, council.FormatTokens(est.Tokens))
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
	return fmt.Sprintf("%s\t%s\tround %d\t%s", c.Id, c.State, c.Round, councilOneLine(c.Feature))
}

// ---- commands ----

// councilPlan is a council as priced: the project, the files, the mode, the group and its panel, and the estimate.
type councilPlan struct {
	project string
	files   []string
	mode    string
	group   council.CouncilGroup
	experts []council.CouncilExpert
	est     *wshrpc.CouncilEstimateRtnData
}

func councilPrepare(cmd *cobra.Command) (councilPlan, error) {
	mode, err := councilModeFlag(mustFlagString(cmd, "mode")) // first: a refused mode asks nothing
	if err != nil {
		return councilPlan{}, err
	}
	cwd, err := os.Getwd()
	if err != nil {
		return councilPlan{}, fmt.Errorf("reading the working directory: %w", err)
	}
	plan := councilPlan{mode: mode}
	plan.project = councilProjectFor(mustFlagString(cmd, "project"), cwd)
	plan.files = councilFiles(splitCouncilList(mustFlagString(cmd, "files")), cwd, plan.project)
	groupId := councilGroupFor(mustFlagString(cmd, "group"), mode)
	roles, err := wshclient.CouncilRolesCommand(RpcClient, nil)
	if err != nil {
		return councilPlan{}, fmt.Errorf("reading the council roles: %w", err)
	}
	if plan.group, plan.experts, err = councilPanel(roles, groupId); err != nil {
		return councilPlan{}, err
	}
	plan.est, err = wshclient.CouncilEstimateCommand(RpcClient, wshrpc.CommandCouncilEstimateData{
		Project: plan.project,
		Files:   plan.files,
		Experts: plan.experts,
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
product-ideas group and review (the default) the ui-feature one.`,
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

One council runs at a time across all projects: a start while another council runs is queued, prints
"Queued after <id> (<feature>)" with the new council's own id, and starts by itself when the running one ends (a council
waiting on the person holds no slot). "wsh council wait <id>" waits through the queue. --queue is still accepted and does
nothing more: every second start is queued now. --pause stops the council after round 1 so the person can cut proposals
and ask a question before the next rounds.`,
	PreRunE: preRunSetupRpcClient,
	RunE:    councilStartRun,
}

// councilStartData is the start request of a prepared plan: the plan, the flags that do not change what it costs
// (question, pause, session, the reason for the mode) and the screenshots.
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
	n := councilPanelSize(plan.experts)
	verdict, gateErr := tokengateDecide(context.Background(), councilSpawn(plan.experts, plan.est), "", func(hold any) {
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
	fmt.Println(councilStartedLine(c.Id, feature, plan.mode, group, n, plan.est))
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
	Long: `List the councils of one project, newest first. The project is --project, else the git top level of the working
directory; outside a repository, or with --project "", every council is listed.`,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		project := ""
		if cmd.Flags().Changed("project") {
			if p := mustFlagString(cmd, "project"); p != "" {
				project = councilProjectFor(p, "")
			}
		} else if cwd, err := os.Getwd(); err == nil {
			project = councilGitTop(cwd)
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
// score is never read as the new one's): the bench runs per harness and variant, then the ratings of the real councils
// per harness and mode.
func councilBenchTable(res *wshrpc.CouncilBenchResultsRtnData) string {
	if len(res.Runs) == 0 && len(res.Ratings) == 0 {
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
	Long: `Run the council's benchmark: the cases Phase 0 left under the data dir (council-bench/cases.json), each as a solo
agent and as a council, --runs times each, one council at a time. A judge scores every report against its case's key,
and each run is appended to council-bench.jsonl. Nothing it runs is listed in the app or writes a document into the case's
project. The command prices the plan first, asks the Token burn gate once with the total (about 0.55M tokens a solo run
and 1.4M a council run), and starts the bench in wavesrv only when the person allows it; a refusal prints "Not run: <reason>"
and starts nothing. It returns at once; "wsh council bench results" prints the table when runs have ended, grouped by
harness version so an old score is never read as the new one's, and "wsh council bench stop" ends a bench early. A full
bench (no --case) ends by adding a re-measure chunk, due in a month, to the Council benchmark initiative.`,
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
	f.String("group", "", "the expert group (default "+councilDefaultGroup+", or "+councilBrainstormGroup+" for --mode brainstorm; see Setup in the app for the others)")
	f.String("project", "", "the project folder (default: the git top level of the working directory)")
	f.String("mode", "", "how the council works: "+council.ModeReview+" (default) judges a thing that exists, "+council.ModeBrainstorm+" looks for ideas for a problem or goal")
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
	councilListCmd.Flags().String("project", "", "the project folder (default: the git top level of the working directory; \"\" lists every council)")
	councilListCmd.Flags().Bool("json", false, "JSON output")
	councilShowCmd.Flags().Bool("json", false, "JSON output (the whole council)")
	councilWaitCmd.Flags().Duration("timeout", councilDefaultTimeout, "give up waiting after this long (0 waits without limit)")
	councilBenchCmd.Flags().StringArray("case", nil, "run only this case (repeatable; default every case)")
	councilBenchCmd.Flags().StringArray("variant", nil, "run only this variant: solo or council (repeatable; default both)")
	councilBenchCmd.Flags().Int("runs", 1, "runs of each case × variant (the full first pass uses 2)")
	councilBenchResultsCmd.Flags().Bool("json", false, "JSON output")
	councilBenchCmd.AddCommand(councilBenchResultsCmd, councilBenchStopCmd)
	councilCmd.AddCommand(councilEstimateCmd, councilStartCmd, councilListCmd, councilShowCmd, councilWaitCmd, councilStopCmd, councilBenchCmd)
	rootCmd.AddCommand(councilCmd)
}
