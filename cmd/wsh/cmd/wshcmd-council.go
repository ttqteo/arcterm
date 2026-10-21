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
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// councilDefaultGroup is the group a start or an estimate takes when --group is left out: the UI feature panel, which
// ships with arcterm and which a councilroles.json group of the same id replaces rather than removes.
const councilDefaultGroup = "ui-feature"

const (
	councilPollEvery      = 2 * time.Second
	councilDefaultTimeout = 30 * time.Minute
	councilStartTimeoutMs = 30_000 // a start or an estimate reads the size of the files it was given
)

var councilCmd = &cobra.Command{
	Use:   "council",
	Short: "have a panel of expert agents review a feature in three rounds, and read the Summary back",
	Long: `A council is a panel of expert agents that reviews one feature in three rounds, shown in arcterm as a
Discussion with a Summary of ranked directions. Each start costs roughly 0.5-1.5M tokens: run "wsh council estimate"
first and start one only when the person picked it. "wsh council start" asks the Token burn gate like a costly
subagent spawn; a refusal saves the council as not run, and Start council in the app runs it.`,
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

// councilStartedLine is the line a started council prints.
func councilStartedLine(id, feature string, n int, est *wshrpc.CouncilEstimateRtnData) string {
	return fmt.Sprintf("council %s started: %s · %s · ≈ %d calls · ~%s tokens",
		id, councilOneLine(feature), councilExpertsText(n), est.Calls, council.FormatTokens(est.Tokens))
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

// councilRunning is the first council of the list that is running, nil when none is: what --queue waits on. A council
// waiting on the person spends nothing, so it does not hold the queue.
func councilRunning(list []*council.Council) *council.Council {
	for _, c := range list {
		if c != nil && c.State == council.StateRunning {
			return c
		}
	}
	return nil
}

// councilWaitDone says whether wait has something to report: a council that is not running is finished, stopped,
// failed, never started, or waiting on the person, and none of them moves until someone acts.
func councilWaitDone(c *council.Council) bool {
	return c.State != council.StateRunning
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

// councilPlan is a council as priced: the project, the files, the group and its panel, and the estimate.
type councilPlan struct {
	project string
	files   []string
	group   council.CouncilGroup
	experts []council.CouncilExpert
	est     *wshrpc.CouncilEstimateRtnData
}

func councilPrepare(cmd *cobra.Command) (councilPlan, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return councilPlan{}, fmt.Errorf("reading the working directory: %w", err)
	}
	var plan councilPlan
	plan.project = councilProjectFor(mustFlagString(cmd, "project"), cwd)
	plan.files = councilFiles(splitCouncilList(mustFlagString(cmd, "files")), cwd, plan.project)
	groupId := mustFlagString(cmd, "group")
	if groupId == "" {
		groupId = councilDefaultGroup
	}
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
	Short: "print the group, every expert's model and the cost of a council, and start nothing (for an agent's offer)",
	Args:  cobra.NoArgs,
	Long: `Print the one line an agent's offer quotes: the group, each expert's model, and the estimate. It starts nothing and
asks nothing. The files are the ones the experts would read, whose size is part of the estimate.`,
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
	Long: `Start a council: the group's experts propose in round 1, review each other in round 2, and the coordinator
ranks the directions in round 3. Start one only when the person picked it. The start asks the Token burn gate with the
council's own estimate; when the person refuses, the council is saved as not run, "Not run: <reason>" is printed and the
command exits 0: do not retry, say so in your report. Read the outcome back with "wsh council wait <id>".

--queue holds the start while another council of this project is running. --pause stops the council after round 1 so
the person can cut proposals and ask a question before rounds 2 and 3.`,
	PreRunE: preRunSetupRpcClient,
	RunE:    councilStartRun,
}

func councilStartRun(cmd *cobra.Command, args []string) error {
	feature := strings.TrimSpace(mustFlagString(cmd, "feature"))
	if feature == "" {
		return errors.New("--feature is required: name the feature the council reviews")
	}
	screenshots, err := councilScreenshots(cmd)
	if err != nil {
		return err
	}
	plan, err := councilPrepare(cmd)
	if err != nil {
		return err
	}
	pause, _ := cmd.Flags().GetBool("pause")
	queue, _ := cmd.Flags().GetBool("queue")
	data := wshrpc.CommandCouncilStartData{
		Project:     plan.project,
		Feature:     feature,
		Question:    strings.TrimSpace(mustFlagString(cmd, "question")),
		Files:       plan.files,
		Screenshots: screenshots,
		Group:       plan.group.Id,
		Experts:     plan.experts,
		Pause:       pause,
		SessionId:   councilSession(cmd),
	}
	n := councilPanelSize(plan.experts)
	verdict, gateErr := tokengateDecide(context.Background(), councilSpawn(plan.experts, plan.est), "", func(hold any) {
		if h, ok := hold.(tokengate.Hold); ok {
			fmt.Println(h.Hold)
		}
	})
	startOpts := &wshrpc.RpcOpts{Timeout: councilStartTimeoutMs}
	switch {
	case gateErr != nil:
		// a broken gate never blocks an agent, here as in the Claude mod: the person already picked the council
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
	if queue {
		if err := councilWaitForRoom(context.Background(), plan.project); err != nil {
			return err
		}
	}
	c, err := wshclient.CouncilStartCommand(RpcClient, data, startOpts)
	if err != nil {
		return fmt.Errorf("starting the council: %w", err)
	}
	fmt.Println(councilStartedLine(c.Id, feature, n, plan.est))
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

// councilSession is the agent session that starts the council, whose Ideas the directions come back into: --session,
// else the session of the terminal this runs in.
func councilSession(cmd *cobra.Command) string {
	if s := mustFlagString(cmd, "session"); s != "" {
		return s
	}
	if blockId := os.Getenv("WAVETERM_BLOCKID"); blockId != "" {
		return blockSession(blockId)
	}
	return ""
}

// councilWaitForRoom holds a --queue start while another council of the project is running.
func councilWaitForRoom(ctx context.Context, project string) error {
	announced := ""
	for {
		list, err := wshclient.CouncilListCommand(RpcClient, wshrpc.CommandCouncilListData{Project: project}, nil)
		if err != nil {
			return fmt.Errorf("listing the project's councils: %w", err)
		}
		busy := councilRunning(list)
		if busy == nil {
			return nil
		}
		if busy.Id != announced {
			fmt.Printf("waiting for council %s (%s) to finish before starting\n", busy.Id, councilOneLine(busy.Feature))
			announced = busy.Id
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(councilPollEvery):
		}
	}
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
	Long: `Poll the council every 2 seconds until it is no longer running, then print what it holds. A done council prints
its markdown; one that paused after round 1 says what the person must do in the app, and a failed one exits non-zero
with its reason. --timeout bounds the wait (30m by default); on a timeout the council keeps running.`,
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
			return fmt.Errorf("council %s is still running after %s; run `wsh council wait %s` to keep waiting", id, timeout, id)
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
	Short:   "stop a running council; the rounds that finished stay",
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

func addCouncilPanelFlags(cmd *cobra.Command) {
	f := cmd.Flags()
	f.String("feature", "", "the feature the council reviews")
	f.String("files", "", "the files or folders the experts read, comma-separated")
	f.String("group", "", "the expert group (default "+councilDefaultGroup+"; see Setup in the app for the others)")
	f.String("project", "", "the project folder (default: the git top level of the working directory)")
}

func init() {
	addCouncilPanelFlags(councilEstimateCmd)
	addCouncilPanelFlags(councilStartCmd)
	councilStartCmd.Flags().String("question", "", "a question put to the whole council")
	councilStartCmd.Flags().StringArray("screenshot", nil, "a screenshot (png) the experts open with Read; repeat the flag for more")
	councilStartCmd.Flags().Bool("pause", false, "stop after round 1 so the person can cut proposals and ask a question")
	councilStartCmd.Flags().Bool("queue", false, "wait while another council of this project is running, then start")
	councilStartCmd.Flags().String("session", "", "the agent session that starts it, whose Ideas get the directions; defaults to the session in this terminal")
	councilListCmd.Flags().String("project", "", "the project folder (default: the git top level of the working directory; \"\" lists every council)")
	councilListCmd.Flags().Bool("json", false, "JSON output")
	councilShowCmd.Flags().Bool("json", false, "JSON output (the whole council)")
	councilWaitCmd.Flags().Duration("timeout", councilDefaultTimeout, "give up waiting after this long (0 waits without limit)")
	councilCmd.AddCommand(councilEstimateCmd, councilStartCmd, councilListCmd, councilShowCmd, councilWaitCmd, councilStopCmd)
	rootCmd.AddCommand(councilCmd)
}
