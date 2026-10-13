// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	workspaceIdEnvVar = "WAVETERM_WORKSPACEID"
	// an engine launch builds a worktree and starts a worker per lane before CreateRun replies; this is the
	// + Run launcher's budget (CREATE_RUN_TIMEOUT_MS), and the server derives its handler deadline from it
	runsStartTimeoutMs  = 180_000
	runsCancelTimeoutMs = 60_000 // cancel stops each live worker gracefully before it returns
	runsLandTimeoutMs   = int64(orchestrate.LandTimeout/time.Millisecond) + 10_000
	runsReadTimeoutMs   = 10_000
	runsListDefault     = 20
	runsGoalWidth       = 70
	runsReasonWidth     = 60
	runsShowGoalWidth   = 240 // a task run's goal is its whole worker prompt; --json carries it in full
	effortORefPrefix    = "effort:"
)

var runsCmd = &cobra.Command{
	Use:   "runs",
	Short: "start, list, inspect and cancel cockpit runs from outside a run (per-task steering is wsh jarvis dag)",
	Args:  cobra.NoArgs,
	RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
}

var runsStartCmd = &cobra.Command{
	Use:   "start [goal]",
	Short: "start a run in this project, as the + Run launcher does",
	Long: `Start a run in this project, as the + Run launcher does.

A quick run takes a goal. An orchestrator run takes a goal, or --plan with a plan file (the goal then
defaults to the plan's name). The project is the git repository holding the current directory (or
--project); a worktree resolves to its main checkout. The lead route is --runtime/--model, else the
project's saved route, else the harness preference in settings.

A launch can take minutes. If it reports no reply, the run may still have started: check
'wsh runs list' before starting it again.

--queue hands the start to arcterm instead: it checks the plan now, then starts the run when fewer than
the runs:maxactive setting (default 3) top-level runs are active. The plan is read and the base commit
taken when the run starts, not when it is queued; the route is fixed now. --after <run-id or q-id> also
waits for that run to land (a unique prefix of either id works) and implies --queue.`,
	Args:    cobra.MaximumNArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsStartRun,
}

var runsStartNowCmd = &cobra.Command{
	Use:     "start-now <queue-id>",
	Short:   "start a queued run now, past the cap and past its --after",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsStartNowRun,
}

var runsRunNextCmd = &cobra.Command{
	Use:   "run-next <queue-id>",
	Short: "move a queued run to the head of the queue",
	Long: `Move a queued run to the head of the queue, ahead of every other entry. It still waits for room and
for its --after: this lets one plan go before the others without exceeding the cap. A blocked entry waits again.`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsRunNextRun,
}

var runsDequeueCmd = &cobra.Command{
	Use:     "dequeue <queue-id>",
	Short:   "remove a queued run from the queue without starting it",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsDequeueRun,
}

var runsListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list this project's runs, newest first",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE:    runsListRun,
}

var runsShowCmd = &cobra.Command{
	Use:     "show <run-id>",
	Short:   "show a run: status, route, initiative, commits, task digest and sealed report",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsShowRun,
}

var runsAnswerCmd = &cobra.Command{
	Use:     "answer <run-id> <answers-json>",
	Short:   "answer a run's own pending question, which `wsh runs show` prints (answers-json: [{\"selectedindexes\":[0]}] or [{\"text\":\"...\"}])",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsAnswerRun,
}

var runsCancelCmd = &cobra.Command{
	Use:   "cancel <run-id>",
	Short: "cancel a run; a run with live workers needs --yes",
	Long: `Cancel a run. Completed phases, transcripts and artifacts are kept; a finished run cannot be
cancelled. When the run has live workers this prints what would stop and exits non-zero unless --yes
is passed.`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsCancelRun,
}

var runsEndFinalCmd = &cobra.Command{
	Use:   "end-final <run-id> unverified|failed <reason>",
	Short: "end a run's stuck final stage as unverified or failed, with the reason recorded",
	Long: fmt.Sprintf(`End an orchestrator run's final stage while it is still running (Check, Verify, the Final command,
or the verifier), when it is stuck and waiting it out is not worth it: the verifier has %s, the Final
command %s. unverified finishes the run done but unverified. failed fails the stage as a verifier's fail
does: the lead gets the reason and plans a fix round from it (cancel the run for none). The reason is
recorded on the run's final stage.`, orchestrate.ReviewTimeout, orchestrate.FinalTimeout),
	Args:    cobra.ExactArgs(3),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsEndFinalRun,
}

var runsLandCmd = &cobra.Command{
	Use:   "land <run-id>",
	Short: "merge a finished run's branch back into the branch it started from, or say why it is held",
	Long: `Merge a finished run's wave/<run-id> branch back into the branch the run started from, in the
project checkout, then remove its landing tree and branch. The engine does this itself when the run
completes; this retries a held land once its reason is cleared. It can take minutes when it re-runs
Check and Verify. --force lands a run whose final stage failed.

Lands of one project go one at a time. A land that is not next in line prints "queued" with its place and
lands by itself in its turn; one whose branch conflicts with the base prints "resolving" while a resolver
session merges it. Both exit 0: follow them with 'wsh runs show'.`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsLandRun,
}

var runsAckCmd = &cobra.Command{
	Use:     "ack <run-id>",
	Short:   "acknowledge a finished run's unverified outcome, which clears it from the attention list",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    runsAckRun,
}

var runsAttentionCmd = &cobra.Command{
	Use:     "attention",
	Short:   "list everything waiting on the human across every project (review gates, escalations, asks)",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE:    runsAttentionRun,
}

func init() {
	f := runsStartCmd.Flags()
	f.String("mode", "", "quick|orchestrator (default quick; --plan implies orchestrator)")
	f.String("plan", "", "plan file for an orchestrator run, in the format 'wsh jarvis dag submit --help' describes")
	f.String("runtime", "", "lead harness: claude|pi (default: the project's saved route, else settings)")
	f.String("model", "", "lead model id (needs --runtime)")
	f.String("worker-runtime", "", "orchestrator worker harness (default: the lead's)")
	f.String("worker-model", "", "orchestrator worker model id (needs --worker-runtime)")
	f.Bool("reviewer-picks", false, "the plan reviewer picks each task's model (not with --worker-runtime/--worker-model)")
	f.String("reviewer-runtime", "", "harness for task reviewers, the plan review and the final verify (default: the lead's)")
	f.String("reviewer-model", "", "reviewer model id (needs --reviewer-runtime)")
	f.Int("parallelism", 0, "orchestrator width (default: the project's profile)")
	f.String("landing", "", "branch|checkout: where an orchestrator run commits (default: the project's profile, else branch)")
	f.String("prototype", "", "design canvas the final verifier compares against (orchestrator only)")
	f.Bool("autonomous", false, "the lead answers everything that would otherwise ask you (orchestrator only)")
	f.String("effort", "", "initiative to attach the run to (id from 'wsh effort list')")
	f.String("chunk", "", "the initiative's chunk: its label or 1-based number")
	f.Bool("queue", false, "queue the start: arcterm starts it when fewer than runs:maxactive runs are active")
	f.String("after", "", "run id or queue entry id (a unique prefix of either) to wait for: starts once that run has landed; implies --queue")
	f.Bool("json", false, "JSON output")
	for _, c := range []*cobra.Command{runsStartCmd, runsListCmd, runsShowCmd, runsAnswerCmd, runsCancelCmd, runsEndFinalCmd, runsLandCmd, runsAckCmd} {
		c.Flags().String("project", "", "project directory (default: the current directory)")
		c.Flags().String("channel", "", "channel id, instead of resolving the project")
	}
	runsListCmd.Flags().Bool("all", false, "every project, not just this one")
	runsListCmd.Flags().Bool("tasks", false, "include the runs that work one task of another run (engine workers and reviewers, lead-spawned children)")
	runsListCmd.Flags().Int("limit", runsListDefault, "most runs to print")
	runsListCmd.Flags().Bool("json", false, "JSON output")
	runsShowCmd.Flags().Bool("json", false, "JSON output")
	runsCancelCmd.Flags().Bool("yes", false, "cancel even though workers are live")
	runsLandCmd.Flags().Bool("force", false, "land even though the final stage failed")
	runsAckCmd.Flags().Bool("land", false, "dismiss the run's held land instead, as the cockpit's Dismiss does: the branch stays")
	runsAttentionCmd.Flags().Bool("json", false, "JSON output")
	runsCmd.AddCommand(runsStartCmd, runsStartNowCmd, runsRunNextCmd, runsDequeueCmd, runsListCmd, runsShowCmd, runsAnswerCmd, runsCancelCmd, runsEndFinalCmd, runsLandCmd, runsAckCmd, runsAttentionCmd)
	rootCmd.AddCommand(runsCmd)
}

func runsStartRun(cmd *cobra.Command, args []string) error {
	ch, err := runsChannel(cmd, true)
	if err != nil {
		return err
	}
	goal := ""
	if len(args) > 0 {
		goal = args[0]
	}
	flag := func(name string) string { v, _ := cmd.Flags().GetString(name); return v }
	parallelism, _ := cmd.Flags().GetInt("parallelism")
	reviewerPicks, _ := cmd.Flags().GetBool("reviewer-picks")
	autonomous, _ := cmd.Flags().GetBool("autonomous")
	opts := runsStartOpts{
		goal: goal, mode: flag("mode"), plan: flag("plan"), parallelism: parallelism, landing: flag("landing"),
		workerRuntime: flag("worker-runtime"), workerModel: flag("worker-model"), reviewerPicks: reviewerPicks,
		reviewerRuntime: flag("reviewer-runtime"), reviewerModel: flag("reviewer-model"),
		effort: flag("effort"), chunk: flag("chunk"), prototype: flag("prototype"), autonomous: autonomous,
	}
	data, err := runsStartData(opts)
	if err != nil {
		return err
	}
	if data.PlanPath, err = runsAbs(data.PlanPath); err != nil {
		return err
	}
	if data.Prototype, err = runsAbs(data.Prototype); err != nil {
		return err
	}
	route, err := runsLeadRoute(ch.OID, flag("runtime"), flag("model"))
	if err != nil {
		return err
	}
	data.Runtime, data.Model = route.Runtime, route.Model
	if data.EffortOID != "" {
		if data.ChunkLabel, err = runsChunkLabel(data.EffortOID, data.ChunkLabel); err != nil {
			return err
		}
	}
	if data.WorkspaceId, err = runsWorkspaceId(); err != nil {
		return err
	}
	data.ChannelId = ch.OID
	data.OriginTabId = getTabIdFromEnv()
	queue, _ := cmd.Flags().GetBool("queue")
	if after := flag("after"); runsWantsQueue(queue, after) {
		return runsQueueStart(cmd, data, after)
	}
	rtn, err := wshclient.CreateRunCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: runsStartTimeoutMs})
	if err != nil {
		return runsStartErr(err)
	}
	if isJSON(cmd) {
		return jsonOut(rtn.Run)
	}
	fmt.Printf("started run %s (%s, %s) in %s\n", rtn.Run.ID, runsMode(rtn.Run), rtn.Run.Status, ch.Name)
	fmt.Printf("follow it with: wsh runs show %s\n", rtn.Run.ID)
	return nil
}

type runsStartOpts struct {
	goal, mode, plan               string
	parallelism                    int
	landing                        string
	workerRuntime, workerModel     string
	reviewerPicks                  bool
	reviewerRuntime, reviewerModel string
	effort, chunk                  string
	prototype                      string
	autonomous                     bool
}

// runsStartData applies the flag rules; the parts that need the RPC client (channel, workspace, route,
// chunk label) are filled in by the caller, so these rules are testable on their own.
func runsStartData(o runsStartOpts) (wshrpc.CommandCreateRunData, error) {
	var s wshrpc.CommandCreateRunData
	mode := o.mode
	if o.plan != "" {
		if mode != "" && mode != jarvis.RunMode_Orchestrator {
			return s, fmt.Errorf("--plan needs an orchestrator run; drop --mode or pass --mode orchestrator")
		}
		mode = jarvis.RunMode_Orchestrator
	}
	switch mode {
	case "", jarvis.RunMode_Quick, jarvis.RunMode_Orchestrator:
	default:
		return s, fmt.Errorf("--mode must be quick or orchestrator, not %q", mode)
	}
	if o.goal == "" && o.plan == "" {
		return s, fmt.Errorf("pass a goal, or --plan <plan.md>")
	}
	engine := mode == jarvis.RunMode_Orchestrator
	workerFlags := o.workerRuntime != "" || o.workerModel != ""
	reviewerFlags := o.reviewerPicks || o.reviewerRuntime != "" || o.reviewerModel != ""
	if !engine && (o.parallelism != 0 || o.landing != "" || workerFlags || reviewerFlags || o.prototype != "" || o.autonomous) {
		return s, fmt.Errorf("--parallelism, --landing, --worker-runtime/--worker-model, --reviewer-picks, --reviewer-runtime/--reviewer-model, --prototype and --autonomous need an orchestrator run")
	}
	if o.reviewerPicks && workerFlags {
		return s, fmt.Errorf("--reviewer-picks and --worker-runtime/--worker-model are both set; the workers setting is one of them")
	}
	if o.workerModel != "" && o.workerRuntime == "" {
		return s, fmt.Errorf("--worker-model needs --worker-runtime")
	}
	if o.reviewerModel != "" && o.reviewerRuntime == "" {
		return s, fmt.Errorf("--reviewer-model needs --reviewer-runtime")
	}
	effort := strings.TrimPrefix(o.effort, effortORefPrefix)
	if (effort == "") != (o.chunk == "") {
		return s, fmt.Errorf("--effort and --chunk go together")
	}
	s.Goal, s.Mode, s.PlanPath, s.Parallelism, s.Landing = o.goal, mode, o.plan, o.parallelism, o.landing
	s.Prototype = o.prototype
	if o.workerRuntime != "" {
		s.WorkerRoute = &waveobj.RoutePin{Runtime: o.workerRuntime, Model: o.workerModel}
		noPicks := false
		s.ReviewerPicks = &noPicks // a worker route is the whole workers setting; the profile's picks must not fill it in
	}
	if o.reviewerPicks {
		s.ReviewerPicks = &o.reviewerPicks
	}
	if o.reviewerRuntime != "" {
		s.ReviewerRoute = &waveobj.RoutePin{Runtime: o.reviewerRuntime, Model: o.reviewerModel}
	}
	if o.autonomous {
		s.Autonomous = &o.autonomous
	}
	s.EffortOID, s.ChunkLabel = effort, o.chunk
	return s, nil
}

func runsAbs(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	// wavesrv reads the file and does not share this process's cwd
	return filepath.Abs(path)
}

// runsStartErr turns a missed reply into what it means. The server finishes a launch whatever the client's
// deadline, and CreateRun has no idempotency key, so a caller that reads a timeout as failure and retries
// starts the same run twice.
func runsStartErr(err error) error {
	if strings.Contains(err.Error(), "EC-TIME") {
		return fmt.Errorf("no reply within %s, but the run may have launched anyway: check 'wsh runs list' before starting it again (%w)",
			time.Duration(runsStartTimeoutMs)*time.Millisecond, err)
	}
	return err
}

// runsWantsQueue is whether a start is handed to the run queue: --queue, or --after, which only a queue can honour.
func runsWantsQueue(queue bool, after string) bool {
	return queue || after != ""
}

// runsQueueStart queues the start the flags built: the same data a start would have sent, so the route and the
// origin session are fixed now, and the server checks the plan before it accepts the entry.
func runsQueueStart(cmd *cobra.Command, data wshrpc.CommandCreateRunData, after string) error {
	entry, err := wshclient.RunQueueAddCommand(RpcClient, wshrpc.CommandRunQueueAddData{Data: data, After: after}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return err
	}
	if isJSON(cmd) {
		return jsonOut(entry)
	}
	list, err := wshclient.RunQueueListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		// the entry is queued either way; only its place and the cap are unknown
		fmt.Printf("queued %s\n", entry.Id)
		return nil
	}
	fmt.Println(runsQueuedReport(*entry, *list, runsQueueAfterTitle(cmd, *entry, list.Entries)))
	return nil
}

// runsQueueAfterTitle names what an entry waits for, for the queued line: a queued entry's title, or a run's first
// goal line. Empty when it cannot be found; the line then names the id.
func runsQueueAfterTitle(cmd *cobra.Command, e wshrpc.RunQueueEntry, entries []wshrpc.RunQueueEntry) string {
	if e.After == "" {
		return ""
	}
	for _, other := range entries {
		if other.Id == e.After {
			return other.Title
		}
	}
	if _, run, err := runsFind(cmd, e.After); err == nil {
		title, _, _ := strings.Cut(run.Goal, "\n")
		return runsClip(title, runsGoalWidth)
	}
	return ""
}

// runsQueuedReport is what `start --queue` prints once the entry is in. The loop starts an entry the moment there is
// room, and may have done so before this asked, and an entry can be blocked at once (its After run already held).
func runsQueuedReport(entry wshrpc.RunQueueEntry, list wshrpc.CommandRunQueueListRtnData, afterTitle string) string {
	for _, e := range list.Entries {
		if e.Id != entry.Id {
			continue
		}
		if e.State == wshrpc.RunQueueState_Blocked {
			return fmt.Sprintf("queued %s — blocked: %s", e.Id, e.Reason)
		}
		return runsQueuedLine(e, runsQueuePlace(list.Entries, e.Id), list.MaxActive, afterTitle)
	}
	return fmt.Sprintf("queued %s — and started already: there was room. Follow it with: wsh runs list", entry.Id)
}

// runsQueuedLine is the line a queued start prints: where it stands and what it waits for. A cap of 0 is no cap.
func runsQueuedLine(e wshrpc.RunQueueEntry, place, maxActive int, afterTitle string) string {
	head := fmt.Sprintf("queued %s (#%d in line) — ", e.Id, place)
	switch {
	case e.After != "":
		name := afterTitle
		if name == "" {
			name = e.After
		}
		return head + "starts after " + name + " lands"
	case maxActive <= 0:
		return head + "starts at once: runs:maxactive is 0, no cap"
	case maxActive == 1:
		return head + "starts when no run is active"
	}
	return head + fmt.Sprintf("starts when fewer than %d runs are active", maxActive)
}

// runsQueuePlace is the entry's 1-based place among the waiting entries of the whole queue, or 0 when it is not one.
func runsQueuePlace(queue []wshrpc.RunQueueEntry, id string) int {
	place := 0
	for _, e := range queue {
		if e.State == wshrpc.RunQueueState_Blocked {
			continue
		}
		place++
		if e.Id == id {
			return place
		}
	}
	return 0
}

// runsQueueFor is the queued entries of the project at projectPath.
func runsQueueFor(queue []wshrpc.RunQueueEntry, projectPath string) []wshrpc.RunQueueEntry {
	var out []wshrpc.RunQueueEntry
	for _, e := range queue {
		if runsNormPath(e.ProjectPath) == runsNormPath(projectPath) {
			out = append(out, e)
		}
	}
	return out
}

// runsQueueLines are the queued entries as `list` prints them, ahead of the runs: each marked by where it stands,
// `queued #n`, `after <id>` or `blocked: <reason>`. The place counts the whole queue, so listing one project's
// entries does not renumber them.
func runsQueueLines(shown, queue []wshrpc.RunQueueEntry, withProject bool, now int64) []string {
	if len(shown) == 0 {
		return nil
	}
	var buf strings.Builder
	w := tabwriter.NewWriter(&buf, 0, 4, 2, ' ', 0)
	for _, e := range shown {
		var mark string
		switch {
		case e.State == wshrpc.RunQueueState_Blocked:
			mark = "blocked: " + runsClip(e.Reason, runsReasonWidth)
		case e.After != "":
			mark = "after " + e.After
		default:
			mark = fmt.Sprintf("queued #%d", runsQueuePlace(queue, e.Id))
		}
		cols := []string{e.Id, mark, runsAgo(e.QueuedTs, now)}
		if withProject {
			cols = append(cols, filepath.Base(e.ProjectPath))
		}
		cols = append(cols, runsClip(e.Title, runsGoalWidth))
		fmt.Fprintln(w, strings.Join(cols, "\t"))
	}
	w.Flush()
	return strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
}

// runsListJSON is `list --json`: the run rows exactly as before, with the queued entries beside them. Empty is [],
// never null.
func runsListJSON(rows []runsRow, queued []wshrpc.RunQueueEntry) map[string]any {
	if rows == nil {
		rows = []runsRow{}
	}
	if queued == nil {
		queued = []wshrpc.RunQueueEntry{}
	}
	return map[string]any{"queued": queued, "runs": rows}
}

// runsQueueEntries reads the queue, or nothing when it cannot: list is still useful without it.
func runsQueueEntries() []wshrpc.RunQueueEntry {
	rtn, err := wshclient.RunQueueListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		fmt.Fprintf(os.Stderr, "queued starts unavailable: %v\n", err)
		return nil
	}
	return rtn.Entries
}

func runsStartNowRun(cmd *cobra.Command, args []string) error {
	// a launch, so it gets a launch's budget; the server finishes it whatever this waits for
	if err := wshclient.RunQueueStartNowCommand(RpcClient, wshrpc.CommandRunQueueIdData{Id: args[0]}, &wshrpc.RpcOpts{Timeout: runsStartTimeoutMs}); err != nil {
		return runsStartErr(err)
	}
	fmt.Printf("started queued %s now; follow its run with: wsh runs list\n", args[0])
	return nil
}

func runsRunNextRun(cmd *cobra.Command, args []string) error {
	if err := wshclient.RunQueueRunNextCommand(RpcClient, wshrpc.CommandRunQueueIdData{Id: args[0]}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs}); err != nil {
		return err
	}
	fmt.Printf("%s is first in line\n", args[0])
	return nil
}

func runsDequeueRun(cmd *cobra.Command, args []string) error {
	if err := wshclient.RunQueueRemoveCommand(RpcClient, wshrpc.CommandRunQueueIdData{Id: args[0]}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs}); err != nil {
		return err
	}
	fmt.Printf("removed %s from the queue\n", args[0])
	return nil
}

func runsLeadRoute(channelId, runtime, model string) (waveobj.RoutePin, error) {
	if runtime != "" || model != "" {
		return runsRoute(runtime, model, nil, wconfig.SettingsType{})
	}
	prof, err := wshclient.GetJarvisProfileCommand(RpcClient, wshrpc.CommandGetJarvisProfileData{ChannelId: channelId}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return waveobj.RoutePin{}, fmt.Errorf("reading the project's profile: %w", err)
	}
	config, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return waveobj.RoutePin{}, fmt.Errorf("reading settings: %w", err)
	}
	return runsRoute("", "", prof.Override, config.Settings)
}

// runsRoute is the + Run launcher's lead-route precedence (resolveChannelLaunchRoute): an explicit route,
// else the project's saved one, else the harness preference in settings. The server validates whatever
// comes out, so this only picks.
func runsRoute(runtime, model string, override *waveobj.ProfileOverride, settings wconfig.SettingsType) (waveobj.RoutePin, error) {
	if model != "" && runtime == "" {
		return waveobj.RoutePin{}, fmt.Errorf("--model needs --runtime")
	}
	if runtime != "" {
		return waveobj.RoutePin{Runtime: runtime, Model: model}, nil
	}
	if override != nil && override.Route != nil && override.Route.Runtime != "" {
		return *override.Route, nil
	}
	if settings.HarnessPreferredRuntime != "" {
		return waveobj.RoutePin{Runtime: settings.HarnessPreferredRuntime, Model: settings.HarnessPreferredModel}, nil
	}
	return waveobj.RoutePin{}, fmt.Errorf("no route: pass --runtime, or save a route for this project in the cockpit")
}

// runsChunkLabel resolves a chunk number to its label. The run stores the ref it is given and attribution
// matches labels, so a stored "2" would point at whatever chunk is second after a reorder.
func runsChunkLabel(effortOID, ref string) (string, error) {
	rtn, err := wshclient.EffortGetCommand(RpcClient, wshrpc.CommandEffortGetData{EffortOID: effortOID}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return "", fmt.Errorf("reading initiative %s: %w", effortOID, err)
	}
	idx, err := jarvis.ResolveChunkIndex(rtn.Effort, ref)
	if err != nil {
		return "", err
	}
	return rtn.Effort.Chunks[idx].Label, nil
}

func runsWorkspaceId() (string, error) {
	if ws := os.Getenv(workspaceIdEnvVar); ws != "" {
		return ws, nil
	}
	list, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return "", fmt.Errorf("listing workspaces: %w", err)
	}
	return runsPickWorkspace(list)
}

// runsPickWorkspace chooses where worker tabs go when this process is not in an arcterm terminal. Guessing
// between two workspaces would put the workers somewhere the user is not looking.
func runsPickWorkspace(list []wshrpc.WorkspaceInfoData) (string, error) {
	if len(list) == 1 && list[0].WorkspaceData != nil {
		return list[0].WorkspaceData.OID, nil
	}
	return "", fmt.Errorf("%s is not set and there are %d workspaces; run this from an arcterm terminal", workspaceIdEnvVar, len(list))
}

func runsChannels() ([]*waveobj.Channel, error) {
	rtn, err := wshclient.GetChannelsCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return nil, fmt.Errorf("listing projects: %w", err)
	}
	return rtn.Channels, nil
}

// errRunsNoChannel is a registered project that has never run: the cockpit mints a project's channel at
// its first run, so there is nothing to list yet, and only start creates one
var errRunsNoChannel = errors.New("no runs yet in project")

// runsChannel resolves the project a command acts on: --channel by id, else the registered project holding
// --project (or the current directory). mint is start's find-or-create, the + Run launcher's: a project
// that has never run gets its channel here. The other commands only read, and must not add a channel.
func runsChannel(cmd *cobra.Command, mint bool) (*waveobj.Channel, error) {
	chans, err := runsChannels()
	if err != nil {
		return nil, err
	}
	if id, _ := cmd.Flags().GetString("channel"); id != "" {
		for _, ch := range chans {
			if ch.OID == id {
				return ch, nil
			}
		}
		return nil, fmt.Errorf("no channel %s", id)
	}
	dir, _ := cmd.Flags().GetString("project")
	p, here, err := runsProjectAt(chans, dir)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, fmt.Errorf("%s is in no arcterm project: register it in the cockpit, or pass --channel", here)
	}
	if p.ch != nil {
		return p.ch, nil
	}
	if !mint {
		return nil, fmt.Errorf("%w %s", errRunsNoChannel, p.name)
	}
	// the server's create is find-or-create, so a launcher racing this lands on the same channel
	ch, err := wshclient.CreateChannelCommand(RpcClient, wshrpc.CommandCreateChannelData{Name: p.name, ProjectPath: p.path},
		&wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return nil, fmt.Errorf("creating the channel for project %s: %w", p.name, err)
	}
	return ch, nil
}

// runsProjectAt is the project holding dir (the current directory when empty), nil when none does; here is
// the main-checkout path it looked up
func runsProjectAt(chans []*waveobj.Channel, dir string) (p *runsProject, here string, err error) {
	if dir == "" {
		if dir, err = os.Getwd(); err != nil {
			return nil, "", err
		}
	}
	if here, err = runsMainCheckoutPath(context.Background(), dir); err != nil {
		return nil, "", err
	}
	cfg, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return nil, "", fmt.Errorf("reading the registered projects: %w", err)
	}
	return runsResolveProject(runsProjects(chans, cfg.Projects), here), here, nil
}

// runsProject is one project wsh can act on: a registered one (projects.json), with its channel once it
// has run, or a channel whose project was never registered
type runsProject struct {
	name string
	path string
	ch   *waveobj.Channel
}

func runsProjects(chans []*waveobj.Channel, registered map[string]wconfig.ProjectKeywords) []runsProject {
	var out []runsProject
	for name, proj := range registered {
		if strings.TrimSpace(proj.Path) == "" {
			continue
		}
		out = append(out, runsProject{name: name, path: proj.Path, ch: wstore.MatchChannelAtPath(chans, proj.Path)})
	}
	for _, ch := range chans {
		if strings.TrimSpace(ch.ProjectPath) == "" {
			continue
		}
		known := slices.ContainsFunc(out, func(p runsProject) bool { return runsNormPath(p.path) == runsNormPath(ch.ProjectPath) })
		if !known {
			out = append(out, runsProject{name: ch.Name, path: ch.ProjectPath, ch: ch})
		}
	}
	return out
}

// runsResolveProject is the project holding dir: the deepest one whose path contains it. A monorepo
// registers projects at subfolders (SIEM/src/cyber_ai/cyber_anomaly_detector), so matching only the
// repository root would find none of them.
func runsResolveProject(projects []runsProject, dir string) *runsProject {
	var best *runsProject
	for i := range projects {
		p := &projects[i]
		if runsPathWithin(dir, p.path) && (best == nil || len(runsNormPath(p.path)) > len(runsNormPath(best.path))) {
			best = p
		}
	}
	return best
}

// runsNormPath compares paths across the registry (backslashes on windows) and git (forward slashes)
func runsNormPath(p string) string {
	n := strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(p), `\`, "/"), "/")
	if runtime.GOOS == "windows" {
		n = strings.ToLower(n)
	}
	return n
}

// runsPathWithin reports dir is root or below it; a sibling sharing a name prefix (app, application) is not
func runsPathWithin(dir, root string) bool {
	d, r := runsNormPath(dir), runsNormPath(root)
	return r != "" && (d == r || strings.HasPrefix(d, r+"/"))
}

// runsMainCheckoutPath is dir's place in the repository's main checkout: projects are registered there, so
// an agent in a linked worktree, or in a subfolder of one, must still land on the same project. Outside a
// repository it is dir itself.
func runsMainCheckoutPath(ctx context.Context, dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	wts, err := gitinfo.ListWorktrees(ctx, abs)
	if err != nil {
		return "", fmt.Errorf("reading the repository at %s: %w", abs, err)
	}
	if len(wts) == 0 || !wts[0].IsMain {
		return abs, nil
	}
	// the deepest checkout holding dir: a linked worktree can sit inside the main one (.worktrees/<name>)
	holder := ""
	for _, wt := range wts {
		if runsPathWithin(abs, wt.Path) && len(runsNormPath(wt.Path)) > len(runsNormPath(holder)) {
			holder = wt.Path
		}
	}
	main := filepath.FromSlash(wts[0].Path)
	if holder == "" {
		return main, nil
	}
	rel, err := filepath.Rel(filepath.FromSlash(holder), abs)
	if err != nil {
		return main, nil
	}
	return filepath.Join(main, rel), nil
}

type runsRow struct {
	Channel string       `json:"channel"`
	Run     *waveobj.Run `json:"run"`
}

func runsOf(ch *waveobj.Channel) ([]runsRow, error) {
	rtn, err := wshclient.GetChannelRunsCommand(RpcClient, wshrpc.CommandGetChannelRunsData{ChannelId: ch.OID}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return nil, fmt.Errorf("listing runs of %s: %w", ch.Name, err)
	}
	rows := make([]runsRow, 0, len(rtn.Runs))
	for _, r := range rtn.Runs {
		rows = append(rows, runsRow{Channel: ch.Name, Run: r})
	}
	return rows, nil
}

func runsListRun(cmd *cobra.Command, args []string) error {
	all, _ := cmd.Flags().GetBool("all")
	tasks, _ := cmd.Flags().GetBool("tasks")
	limit, _ := cmd.Flags().GetInt("limit")
	var chans []*waveobj.Channel
	var project string // the project a plain list is of, which picks the queued entries to show
	if all {
		var err error
		if chans, err = runsChannels(); err != nil {
			return err
		}
	} else {
		ch, err := runsChannel(cmd, false)
		if errors.Is(err, errRunsNoChannel) {
			if isJSON(cmd) {
				return jsonOut(runsListJSON(nil, nil))
			}
			fmt.Println(err)
			return nil
		}
		if err != nil {
			return err
		}
		chans = []*waveobj.Channel{ch}
		project = ch.ProjectPath
	}
	var rows []runsRow
	for _, ch := range chans {
		chRows, err := runsOf(ch)
		if err != nil {
			return err
		}
		for _, row := range chRows {
			if tasks || !runsIsTask(row.Run) {
				rows = append(rows, row)
			}
		}
	}
	rows = runsNewest(rows, limit)
	queue := runsQueueEntries()
	shown := queue
	if !all {
		shown = runsQueueFor(queue, project)
	}
	if isJSON(cmd) {
		return jsonOut(runsListJSON(rows, shown))
	}
	now := time.Now().UnixMilli()
	lines := runsQueueLines(shown, queue, all, now)
	if len(rows) > 0 || len(lines) == 0 {
		lines = append(lines, runsListLines(rows, all, now)...)
	}
	for _, line := range lines {
		fmt.Println(line)
	}
	return nil
}

// runsIsTask reports a run that exists to work one task of another run: an engine task's worker or reviewer
// is a quick run carrying its parent's dagoref (only an orchestrator owns one), and a lead's child carries
// the lead's oref. A project's run list is its top-level runs; these are reached through their parent.
func runsIsTask(r *waveobj.Run) bool {
	return (r.DagORef != "" && r.Mode != jarvis.RunMode_Orchestrator) || r.ParentLeadORef != ""
}

func runsNewest(rows []runsRow, limit int) []runsRow {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Run.CreatedTs > rows[j].Run.CreatedTs })
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	return rows
}

func runsListLines(rows []runsRow, withChannel bool, now int64) []string {
	if len(rows) == 0 {
		return []string{"no runs"}
	}
	var buf strings.Builder
	w := tabwriter.NewWriter(&buf, 0, 4, 2, ' ', 0)
	for _, row := range rows {
		r := row.Run
		cols := []string{r.ID, r.Status, runsMode(r), runsAgo(r.CreatedTs, now)}
		if withChannel {
			cols = append(cols, row.Channel)
		}
		cols = append(cols, runsClip(r.Goal, runsGoalWidth))
		fmt.Fprintln(w, strings.Join(cols, "\t"))
	}
	w.Flush()
	return strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
}

// runsFind locates a run by id. No RPC reads one run directly, and a project holds few channels, so this
// walks them: --channel or the current project first, since that is where the id usually came from.
func runsFind(cmd *cobra.Command, runId string) (*waveobj.Channel, *waveobj.Run, error) {
	ch, run, _, err := runsFindIn(cmd, runId)
	return ch, run, err
}

// runsFindIn is runsFind plus the runs of the channel it found the run in, which a land's place in line is read from
func runsFindIn(cmd *cobra.Command, runId string) (*waveobj.Channel, *waveobj.Run, []*waveobj.Run, error) {
	chans, err := runsChannels()
	if err != nil {
		return nil, nil, nil, err
	}
	if here, herr := runsChannel(cmd, false); herr == nil {
		chans = append([]*waveobj.Channel{here}, chans...)
	}
	seen := map[string]bool{}
	for _, ch := range chans {
		if seen[ch.OID] {
			continue
		}
		seen[ch.OID] = true
		rows, err := runsOf(ch)
		if err != nil {
			return nil, nil, nil, err
		}
		for _, row := range rows {
			if row.Run.ID == runId {
				runs := make([]*waveobj.Run, len(rows))
				for i, r := range rows {
					runs[i] = r.Run
				}
				return ch, row.Run, runs, nil
			}
		}
	}
	return nil, nil, nil, fmt.Errorf("no run %s in any project (ids come from 'wsh runs list')", runId)
}

// runsDigest reads the task digest of a run that owns a dag, or nil when it owns none or the read fails;
// show and cancel are still useful without it. A task's run carries its parent's dagoref, and reading the
// digest there would print the whole plan under one task.
func runsDigest(channelId string, run *waveobj.Run) *wshrpc.CommandDagStatusRtnData {
	if run.DagORef == "" || run.Mode != jarvis.RunMode_Orchestrator {
		return nil
	}
	rtn, err := wshclient.DagStatusCommand(RpcClient, wshrpc.CommandDagStatusData{ChannelId: channelId, RunId: run.ID}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		fmt.Fprintf(os.Stderr, "task digest unavailable: %v\n", err)
		return nil
	}
	return rtn
}

func runsShowRun(cmd *cobra.Command, args []string) error {
	ch, run, runs, err := runsFindIn(cmd, args[0])
	if err != nil {
		return err
	}
	digest := runsDigest(ch.OID, run)
	asks := runsAsks(ch.OID, run)
	if isJSON(cmd) {
		return jsonOut(map[string]any{"channel": ch.Name, "channelid": ch.OID, "run": run, "dag": digest, "asks": asks})
	}
	for _, line := range runsShowLines(ch, run, digest, time.Now().UnixMilli(), asks, runs) {
		fmt.Println(line)
	}
	return nil
}

// runsAsks reads a run's own pending question, or nil when the read fails; show is still useful without it.
func runsAsks(channelId string, run *waveobj.Run) []wshrpc.DagAskItem {
	rtn, err := wshclient.RunAsksCommand(RpcClient, wshrpc.CommandRunAskData{ChannelId: channelId, RunId: run.ID}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		fmt.Fprintf(os.Stderr, "pending question unavailable: %v\n", err)
		return nil
	}
	return rtn.Asks
}

func runsShowLines(ch *waveobj.Channel, r *waveobj.Run, digest *wshrpc.CommandDagStatusRtnData, now int64, asks []wshrpc.DagAskItem, runs []*waveobj.Run) []string {
	lines := []string{
		"run      " + r.ID,
		"goal     " + runsClip(r.Goal, runsShowGoalWidth),
		fmt.Sprintf("project  %s (channel %s)", ch.Name, ch.OID),
		fmt.Sprintf("status   %s  mode=%s  created %s", r.Status, runsMode(r), runsAgo(r.CreatedTs, now)),
	}
	// beside the status: a held land is what a reader must not miss, and the digest below runs to dozens of lines
	lines = append(lines, runsLandLines(r, runs)...)
	lines = append(lines, runsQuestionLines(r.ID, asks)...)
	route := r.Runtime
	if r.Model != "" {
		route += " " + r.Model
	}
	if r.WorkerRoute != nil && r.WorkerRoute.Runtime != "" {
		route += "  workers=" + strings.TrimSpace(r.WorkerRoute.Runtime+" "+r.WorkerRoute.Model)
	}
	if r.ReviewerPicks {
		route += "  workers=reviewer-picks"
	}
	if r.ReviewerRoute != nil && r.ReviewerRoute.Runtime != "" {
		route += "  reviewers=" + strings.TrimSpace(r.ReviewerRoute.Runtime+" "+r.ReviewerRoute.Model)
	}
	if r.Autonomous {
		route += "  autonomous"
	}
	if route != "" {
		lines = append(lines, "route    "+route)
	}
	if r.EffortRef != nil && r.EffortRef.EffortOID != "" {
		lines = append(lines, fmt.Sprintf("effort   %s%s chunk %q", effortORefPrefix, r.EffortRef.EffortOID, r.EffortRef.ChunkLabel))
	}
	if r.Branch != "" {
		lines = append(lines, "branch   "+r.Branch)
	}
	switch {
	case r.EndCommit != "":
		lines = append(lines, fmt.Sprintf("commits  %s..%s", runsShort(r.BaseCommit), runsShort(r.EndCommit)))
	case r.BaseCommit != "":
		lines = append(lines, "base     "+runsShort(r.BaseCommit))
	}
	if usage := runsUsage(r, digest); len(usage) > 0 {
		lines = append(lines, "usage    "+usageTotals(usage, usageLabels))
	}
	if digest != nil {
		lines = append(lines, "")
		lines = append(lines, dagStatusLines(digest, now)...)
	}
	if ev := r.Evidence; ev != nil {
		lines = append(lines, "", fmt.Sprintf("sealed   %d files  +%d -%d  took %s", len(ev.Files), ev.AddTotal, ev.DelTotal, durOrZero(ev.DurationMs)))
		for _, v := range ev.Verifs {
			lines = append(lines, fmt.Sprintf("verify   %s  %s", v.Result, v.Cmd))
		}
		if v := ev.Verification; v != nil {
			lines = append(lines, "outcome  "+v.State)
			for _, reason := range v.Reasons {
				lines = append(lines, "         unverified: "+reason)
			}
		}
	}
	if report := runsReport(r); report != "" {
		lines = append(lines, "", "report", report)
	}
	if r.Evidence != nil {
		if record := runsRecordLines(r.Evidence.Dag); len(record) > 0 {
			lines = append(append(lines, ""), record...)
		}
	}
	return lines
}

// runsRecordLines is the dag's record sealed with the lead's run: each task's non-empty sections under its line,
// then the counts, what the human told workers, and the worktrees left behind
func runsRecordLines(d *waveobj.EvidenceDag) []string {
	if d == nil {
		return nil
	}
	lines := []string{"record"}
	for _, t := range d.Tasks {
		head := t.TaskId + " " + t.State
		if t.Commit != "" {
			head += "  " + runsShort(t.Commit)
		}
		if t.ReviewRounds > 0 {
			head += fmt.Sprintf("  review rounds %d", t.ReviewRounds)
		}
		lines = append(lines, head)
		for _, sec := range []struct{ label, body string }{
			{"differs", t.Differs},
			{"not verified", t.NotVerified},
			{"reviewer", t.ReviewerUnverified},
			{"found not fixed", t.FoundNotFixed},
			{"for lead", t.ForLead},
			{"unstructured", t.Unstructured},
		} {
			lines = append(lines, runsLabelled("  ", sec.label, sec.body)...)
		}
	}
	lines = append(lines, fmt.Sprintf("answered %d  forwarded %d", d.Answered, d.Forwarded))
	for _, told := range d.Told {
		lines = append(lines, runsLabelled("", "told", told)...)
	}
	if len(d.LeftBehind) > 0 {
		lines = append(lines, "left behind: "+strings.Join(d.LeftBehind, ", "))
	}
	return lines
}

// runsLabelled prints a body after its label, its later lines indented below; an empty body prints nothing
func runsLabelled(indent, label, body string) []string {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}
	parts := strings.Split(body, "\n")
	lines := []string{indent + label + ": " + parts[0]}
	for _, p := range parts[1:] {
		lines = append(lines, indent+"  "+p)
	}
	return lines
}

// runsUsage is the sealed total, which counts the lead's wrap-up, else the one the dag took when it finished
func runsUsage(r *waveobj.Run, digest *wshrpc.CommandDagStatusRtnData) []waveobj.UsageRow {
	if r.Evidence != nil && len(r.Evidence.Usage) > 0 {
		return r.Evidence.Usage
	}
	if digest != nil {
		return digest.Digest.Report.Usage
	}
	return nil
}

// runsReport is the sealed summary, else the lead's report, which is what the seal is derived from
func runsReport(r *waveobj.Run) string {
	if r.Evidence != nil && r.Evidence.Summary != "" {
		return r.Evidence.Summary
	}
	return r.Report
}

func runsQuestionLines(runId string, asks []wshrpc.DagAskItem) []string {
	if len(asks) == 0 {
		return nil
	}
	lines := []string{"question"}
	for _, a := range asks {
		for _, q := range a.Questions {
			lines = append(lines, dagQuestionLines(q)...)
		}
	}
	return append(lines, fmt.Sprintf(`answer:  wsh runs answer %s '[{"selectedindexes":[0]}]'  (one item per question, in order; {"text":"..."} for free text)`, runId))
}

func runsAnswerRun(cmd *cobra.Command, args []string) error {
	var answers []baseds.AgentAnswerItem
	if err := json.Unmarshal([]byte(args[1]), &answers); err != nil {
		return fmt.Errorf("answers json: %w", err)
	}
	ch, run, err := runsFind(cmd, args[0])
	if err != nil {
		return err
	}
	if err := wshclient.RunAnswerCommand(RpcClient, wshrpc.CommandRunAnswerData{ChannelId: ch.OID, RunId: run.ID, Answers: answers}, &wshrpc.RpcOpts{Timeout: dagAnswerTimeoutMs(answers)}); err != nil {
		return err
	}
	fmt.Printf("answer delivered to run %s's question\n", run.ID)
	return nil
}

func runsCancelRun(cmd *cobra.Command, args []string) error {
	ch, run, err := runsFind(cmd, args[0])
	if err != nil {
		return err
	}
	yes, _ := cmd.Flags().GetBool("yes")
	live := runsLiveWorkers(run, runsDigest(ch.OID, run))
	if live > 0 && !yes {
		return fmt.Errorf("run %s (%s, %q) has %d live worker(s); cancelling stops them. Re-run with --yes to cancel", run.ID, run.Status, runsClip(run.Goal, runsGoalWidth), live)
	}
	if err := wshclient.CancelRunCommand(RpcClient, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: run.ID}, &wshrpc.RpcOpts{Timeout: runsCancelTimeoutMs}); err != nil {
		return err
	}
	fmt.Printf("cancelled run %s\n", run.ID)
	return nil
}

// runsEndFinalAction is the dag action for end-final's outcome word.
func runsEndFinalAction(word string) (string, error) {
	switch word {
	case "unverified", "failed":
		return "final-end-" + word, nil
	}
	return "", fmt.Errorf("the outcome must be unverified or failed, got %q", word)
}

func runsEndFinalRun(cmd *cobra.Command, args []string) error {
	action, err := runsEndFinalAction(args[1])
	if err != nil {
		return err
	}
	ch, run, err := runsFind(cmd, args[0])
	if err != nil {
		return err
	}
	if err := runsEndFinal(ch.OID, run.ID, action, args[2]); err != nil {
		return err
	}
	fmt.Printf("ended run %s's final stage: %s\n", run.ID, args[1])
	return nil
}

// runsEndFinal waits as long as a cancel does: stopping the verifier stops its worker
func runsEndFinal(channelId, runId, action, reason string) error {
	return wshclient.DagActionCommand(RpcClient, wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, Action: action, Notes: reason}, &wshrpc.RpcOpts{Timeout: runsCancelTimeoutMs})
}

// runsLandLines are where a run's branch stands on its way back into its base. runs are the runs of the run's
// project: a queued land names its place in the line from them.
func runsLandLines(r *waveobj.Run, runs []*waveobj.Run) []string {
	l := r.Land
	if l == nil {
		return nil
	}
	head := "land     " + l.State
	switch {
	case l.State == orchestrate.LandState_Queued:
		head += runsQueuedLandTail(r, runs)
	case l.State == orchestrate.LandState_Resolving:
		head += ": a resolver is merging " + cmp.Or(r.BaseBranch, "the base")
		if len(l.Conflicts) > 0 {
			head += " (" + strings.Join(l.Conflicts, ", ") + ")"
		}
	case l.Reason != "":
		head += ": " + l.Reason
	case l.Commit != "":
		head += " " + runsShort(l.Commit)
	}
	lines := []string{head}
	if l.State == orchestrate.LandState_Held && len(l.Conflicts) > 0 {
		lines = append(lines, "         conflicts: "+strings.Join(l.Conflicts, ", "))
	}
	for _, note := range l.Notes {
		lines = append(lines, "         note: "+note)
	}
	return lines
}

// runsQueuedLandTail is where a queued land stands in its project's line, or nothing when runs do not say.
func runsQueuedLandTail(r *waveobj.Run, runs []*waveobj.Run) string {
	place, ahead := orchestrate.LandPlace(runs, r.ID)
	if place == 0 {
		return ""
	}
	tail := fmt.Sprintf(": #%d in line", place)
	if ahead != nil {
		title, _, _ := strings.Cut(ahead.Goal, "\n")
		tail += ", behind " + strings.TrimSpace(runsShortRun(ahead.ID)+" "+runsClip(title, runsGoalWidth))
	}
	return tail
}

// runsReleasedLines name the queued starts that wait on a run that has just landed: the loop starts each once there
// is room. A start blocked for any other reason stays blocked, so it is not named.
func runsReleasedLines(runID string, queue []wshrpc.RunQueueEntry) []string {
	var names []string
	for _, e := range queue {
		if e.After != runID || (e.State == wshrpc.RunQueueState_Blocked && e.BlockedOn != runID) {
			continue
		}
		names = append(names, strings.TrimSpace(e.Id+" "+runsClip(e.Title, runsGoalWidth)))
	}
	if len(names) == 0 {
		return nil
	}
	return []string{"         queued runs after it start when there is room: " + strings.Join(names, ", ")}
}

func runsLandRun(cmd *cobra.Command, args []string) error {
	ch, run, runs, err := runsFindIn(cmd, args[0])
	if err != nil {
		return err
	}
	force, _ := cmd.Flags().GetBool("force")
	land, err := runsLand(ch.OID, run.ID, force)
	if err != nil {
		return err
	}
	run.Land = land
	for _, line := range runsLandLines(run, runs) {
		fmt.Println(line)
	}
	switch land.State {
	case orchestrate.LandState_Landed:
		for _, line := range runsReleasedLines(run.ID, runsQueueEntries()) {
			fmt.Println(line)
		}
	case orchestrate.LandState_Queued, orchestrate.LandState_Resolving:
		// in line, or being merged with its base: it lands by itself, so this is no failure
	default:
		return fmt.Errorf("run %s did not land", run.ID)
	}
	return nil
}

func runsLand(channelId, runId string, force bool) (*waveobj.RunLand, error) {
	return wshclient.LandRunCommand(RpcClient, wshrpc.CommandLandRunData{ChannelId: channelId, RunId: runId, Force: force}, &wshrpc.RpcOpts{Timeout: runsLandTimeoutMs})
}

func runsAckRun(cmd *cobra.Command, args []string) error {
	ch, run, err := runsFind(cmd, args[0])
	if err != nil {
		return err
	}
	land, _ := cmd.Flags().GetBool("land")
	if err := runsAck(ch.OID, run.ID, land); err != nil {
		return err
	}
	if land {
		fmt.Printf("dismissed run %s's held land; wave/%s stays\n", run.ID, run.ID)
		return nil
	}
	fmt.Printf("acknowledged run %s\n", run.ID)
	return nil
}

func runsAck(channelId, runId string, land bool) error {
	return wshclient.AckRunCommand(RpcClient, wshrpc.CommandAckRunData{ChannelId: channelId, RunId: runId, Land: land}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
}

// runsLiveWorkers counts the workers a cancel would stop: the workers on a running phase plus an engine
// run's running tasks. It can overcount a worker that has already exited, which only costs a --yes.
func runsLiveWorkers(r *waveobj.Run, digest *wshrpc.CommandDagStatusRtnData) int {
	n := 0
	for _, p := range r.Phases {
		if p.State == jarvis.PhaseState_Running {
			n += len(p.WorkerOrefs)
		}
	}
	if digest != nil {
		n += digest.Digest.Counts.Running
	}
	return n
}

func runsAttentionRun(cmd *cobra.Command, args []string) error {
	rtn, err := wshclient.GetAttentionCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return err
	}
	if isJSON(cmd) {
		return jsonOut(rtn.Items)
	}
	for _, line := range runsAttentionLines(rtn.Items, time.Now().UnixMilli()) {
		fmt.Println(line)
	}
	return nil
}

func runsAttentionLines(items []wshrpc.AttentionItem, now int64) []string {
	if len(items) == 0 {
		return []string{"nothing is waiting on you"}
	}
	var buf strings.Builder
	w := tabwriter.NewWriter(&buf, 0, 4, 2, ' ', 0)
	for _, it := range items {
		where := it.ChannelName
		if where == "" {
			where = "-"
		}
		run := it.RunId
		if run == "" {
			run = "-"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s: %s\n", it.Action, it.Kind, where, run, runsAgo(it.WaitingSince, now), runsClip(it.Source, runsGoalWidth), strings.Join(strings.Fields(it.Text), " "))
	}
	w.Flush()
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	return append(lines, "", "a run's detail and its own question: wsh runs show <run-id>, answered with wsh runs answer <run-id> '<answers-json>'; its tasks' questions: wsh jarvis dag asks --channel <id> --runid <run-id>")
}

func runsMode(r *waveobj.Run) string {
	if r.Mode == "" {
		return "pipeline" // a run stored before modes were recorded
	}
	return r.Mode
}

func runsAgo(ts, now int64) string {
	if ts <= 0 {
		return "-"
	}
	if d := compactDur(now - ts); d != "" {
		return d + " ago"
	}
	return "just now"
}

func runsShort(sha string) string {
	if sha == "" {
		return "?"
	}
	return sha[:min(7, len(sha))]
}

// runsShortRun is a run id's first 8 characters, the form the cockpit and the effort notes name a run by
func runsShortRun(id string) string {
	return id[:min(8, len(id))]
}

func runsClip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}
