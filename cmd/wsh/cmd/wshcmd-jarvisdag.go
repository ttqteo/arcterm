// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"
	"unicode/utf8"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var jarvisDagCmd = &cobra.Command{
	Use:   "dag",
	Short: "orchestration engine: submit/steer a task DAG",
	Args:  cobra.NoArgs,
	RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
}

// dagOneDagPerRunNote states the constraint a lead hits at the moment it submits — after the
// planning cost is already spent. Stating it in help is the cheap half of the fix: a lead that
// reads it while planning never proposes the two-phase import the engine refuses.
const dagOneDagPerRunNote = `

A run holds exactly one dag for its whole lifetime: the first submission wins and a later,
differing one is rejected as a dag conflict. There is no multi-phase import, so a plan that
does not fit in one dag must be split across two runs. A fix round after a failed final stage
extends the same dag instead: --round appends the fix plan's tasks.`

// dagSpecPath resolves --spec to an absolute path. A spec is committed with the plan it produced, so it is
// only accepted beside --plan.
func dagSpecPath(planPath, spec string) (string, error) {
	if spec == "" {
		return "", nil
	}
	if planPath == "" {
		return "", fmt.Errorf("pass --spec with --plan")
	}
	return filepath.Abs(spec)
}

// dagSubmitData is what `dag submit` sends for its flags.
func dagSubmitData(cmd *cobra.Command) (wshrpc.CommandDagSubmitData, error) {
	plan, _ := cmd.Flags().GetString("plan")
	if plan == "" {
		return wshrpc.CommandDagSubmitData{}, fmt.Errorf("--plan <plan.md> is required")
	}
	// wavesrv parses the file and does not share this process's cwd
	planPath, err := filepath.Abs(plan)
	if err != nil {
		return wshrpc.CommandDagSubmitData{}, err
	}
	spec, _ := cmd.Flags().GetString("spec")
	specPath, err := dagSpecPath(planPath, spec)
	if err != nil {
		return wshrpc.CommandDagSubmitData{}, err
	}
	round, _ := cmd.Flags().GetBool("round")
	channelId, runId, err := dagIds(cmd)
	if err != nil {
		return wshrpc.CommandDagSubmitData{}, err
	}
	return wshrpc.CommandDagSubmitData{
		ChannelId: channelId, RunId: runId, PlanPath: planPath, SpecPath: specPath, Round: round,
	}, nil
}

// a submit for a run landing on its own branch runs the plan's Setup in that tree before it answers
var dagSubmitTimeoutMs = int64((orchestrate.SetupTimeout + 20*time.Second) / time.Millisecond)

var dagSubmitCmd = &cobra.Command{
	Use:     "submit --plan <plan.md>",
	Short:   "validate and submit a plan file as this run's DAG",
	Long:    "Validate and submit a plan file as this run's DAG.\n\n" + jarvis.PlanFormat + dagOneDagPerRunNote,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := dagSubmitData(cmd)
		if err != nil {
			return err
		}
		g, err := wshclient.DagSubmitCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: dagSubmitTimeoutMs})
		if err != nil {
			return err
		}
		fmt.Printf("dag %s submitted (%d tasks, %d lanes, longest chain %d, parallelism %d)\n", g.ID, len(g.Tasks), len(jarvis.Lanes(g.Tasks)), jarvis.LongestChain(g.Tasks), g.Parallelism)
		return nil
	},
}

var dagStatusCmd = &cobra.Command{
	Use:     "status",
	Short:   "print a per-task status digest (state, stall/ask signal, next action)",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		channelId, runId, err := dagIds(cmd)
		if err != nil {
			return err
		}
		rtn, err := wshclient.DagStatusCommand(RpcClient, wshrpc.CommandDagStatusData{ChannelId: channelId, RunId: runId}, &wshrpc.RpcOpts{Timeout: 10_000})
		if err != nil {
			return err
		}
		for _, line := range dagStatusLines(rtn, time.Now().UnixMilli()) {
			fmt.Println(line)
		}
		return nil
	},
}

// dagStatusLines renders the shared digest: header counts and per-task action/signal come from the
// backend's typed digest, never re-derived from task state locally.
func dagStatusLines(rtn *wshrpc.CommandDagStatusRtnData, now int64) []string {
	g := rtn.Group
	d := rtn.Digest
	if g == nil {
		return []string{"dag status unavailable"}
	}
	line := fmt.Sprintf("dag %s  status=%s  tasks=%d/%d  failures=%d  parallelism=%d",
		g.ID, g.Status, d.Counts.Done, d.Counts.Total, g.Failures, g.Parallelism)
	lines := append([]string{line, reportLine(d)}, usageLines(d.Report.Usage)...)
	if len(d.Report.Commits) > 0 {
		landed := make([]string, len(d.Report.Commits))
		for i, c := range d.Report.Commits {
			landed[i] = c.TaskId + " " + c.Commit[:min(7, len(c.Commit))]
		}
		lines = append(lines, "landed  "+strings.Join(landed, ", "))
	}
	// the run-end report is written from this section, so each reviewer's caveat is here whole
	for _, n := range d.Report.UnverifiedNotes {
		lines = append(lines, fmt.Sprintf("unverified  %s: %s", n.TaskId, flatText(n.Text)))
	}
	lines = append(lines, finalLines(d.Final)...)
	if len(g.Tasks) == 0 {
		return lines
	}
	taskDigestByID := map[string]wshrpc.DagTaskDigest{}
	for _, td := range d.Tasks {
		taskDigestByID[td.TaskId] = td
	}
	var buf strings.Builder
	w := tabwriter.NewWriter(&buf, 0, 4, 2, ' ', 0)
	for _, t := range g.Tasks {
		td, ok := taskDigestByID[t.ID]
		if !ok {
			continue
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", t.ID, t.State, taskSignal(t.State, td, now), strings.Join(td.HumanActions, ","), t.Label)
	}
	w.Flush()
	for _, row := range strings.Split(strings.TrimSuffix(buf.String(), "\n"), "\n") {
		lines = append(lines, row)
	}
	// the lead fixes a failed Verify from its output, so the whole kept tail is printed
	for _, t := range g.Tasks {
		if t.State == orchestrate.TaskState_VerifyFailed && t.VerifyError != "" {
			lines = append(lines, fmt.Sprintf("%s verify failed: %s", t.ID, t.VerifyError))
		}
		// a refused merge wakes the lead here, so git's own words have to be here too
		if t.MergeError != "" {
			lines = append(lines, fmt.Sprintf("%s merge refused (attempt %d): %s", t.ID, t.MergeFailures, t.MergeError))
		}
	}
	// what each task did and how its review went: the lead's account of the work, not just its state
	for _, t := range g.Tasks {
		td, ok := taskDigestByID[t.ID]
		if !ok {
			continue
		}
		if len(td.ReportSections) > 0 {
			lines = append(lines, reportPresenceLine(t.ID, td.ReportSections))
		}
		if td.ReviewNote != "" {
			lines = append(lines, reviewLine(t.ID, td))
		}
		if td.ReviewUnverified != "" {
			lines = append(lines, fmt.Sprintf("%s unverified: %s", t.ID, flatText(td.ReviewUnverified)))
		}
	}
	// nothing wakes the lead for what the human typed to a worker, so this is where it learns of it
	for _, told := range d.Told {
		lines = append(lines, fmt.Sprintf("%s the human told this worker %s ago: %s", told.TaskId, durOrZero(now-told.Ts), strings.Join(strings.Fields(told.Text), " ")))
	}
	return lines
}

// reportPresenceLine tells the lead which parts of a worker's report have something in them and how to read
// them. The sections themselves are pulled, never printed here.
func reportPresenceLine(taskID string, sections []string) string {
	what := "done only"
	if sections[0] == jarvis.ReportKeyUnstructured {
		what = jarvis.ReportKeyUnstructured
	} else if sections[0] != jarvis.ReportKeyDone {
		what = strings.ReplaceAll(strings.Join(sections, ", "), "-", " ")
	}
	return fmt.Sprintf("%s report: %s (wsh jarvis dag report %s)", taskID, what, taskID)
}

// finalLines is the final stage: its state and round, where its output went, and what it found. The lead's fix
// plan and its report are written from these, so each reason and a failure's output are printed whole.
func finalLines(f *waveobj.FinalStage) []string {
	if f == nil {
		return nil
	}
	state := f.State
	if state == "" {
		state = "pending"
	}
	head := fmt.Sprintf("final   %s  round=%d", state, f.Round)
	if f.Step != "" {
		head += fmt.Sprintf("  step=%s (%s)", f.Step, time.Since(time.UnixMilli(f.StepTs)).Round(time.Second))
	}
	if f.Commit != "" {
		head += "  commit=" + f.Commit[:min(7, len(f.Commit))]
	}
	if f.OutDir != "" {
		head += "  out=" + f.OutDir
	}
	lines := []string{head}
	for _, r := range f.Unverified {
		lines = append(lines, "final unverified: "+r)
	}
	if f.Detail != "" {
		lines = append(lines, "final failed: "+f.Detail)
	}
	return lines
}

// reviewLine is a task's latest review as one line: verdict, failed rounds, and what the reviewer said.
func reviewLine(taskID string, td wshrpc.DagTaskDigest) string {
	head := "review"
	if td.ReviewVerdict != "" {
		head += " " + td.ReviewVerdict
	}
	if td.ReviewRound > 0 {
		head += fmt.Sprintf(" (failed rounds %d)", td.ReviewRound)
	}
	line := fmt.Sprintf("%s %s: %s", taskID, head, flatText(td.ReviewNote))
	if td.ReviewDownstream != "" {
		line += " · later tasks: " + flatText(td.ReviewDownstream)
	}
	return line
}

func flatText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// taskSignal is a task row's "what is happening here" column: its pending question, a running Verify's
// age and latest line, or how long a worker has been silent. Every value is the digest's, formatted here
// and never re-derived from task state.
func taskSignal(state string, td wshrpc.DagTaskDigest, now int64) string {
	switch {
	case td.AskSummary != "":
		return "ask: " + compactText(td.AskSummary, 60)
	case td.VerifyStartedTs > 0:
		return verifySignal(td, now)
	case td.Suspect != "":
		return "stuck? " + compactText(td.Suspect, 80)
	case td.FreshnessTs > 0 && (state == orchestrate.TaskState_Running || state == orchestrate.TaskState_Stalled):
		return workerSignal(td, now)
	case td.MergeState == "ready":
		return mergeGateSignal(td, now)
	}
	return ""
}

// workerSignal is how long the worker has been silent, and whether it is running a command meanwhile: a foreground
// test writes no transcript, so silence alone read as "idle" while the worker was busy.
func workerSignal(td wshrpc.DagTaskDigest, now int64) string {
	head := "idle " + compactDur(now-td.FreshnessTs)
	if td.Busy {
		head = "running a command " + compactDur(now-td.FreshnessTs)
	}
	if td.LatestTool != "" {
		head += " · " + compactText(td.LatestTool, 60)
	}
	return head
}

// verifySignal is a running Verify's age and its latest output line. Verify runs outside a block, so
// there is no terminal to watch: this row is the only progress it reports.
func verifySignal(td wshrpc.DagTaskDigest, now int64) string {
	var parts []string
	if age := compactDur(now - td.VerifyStartedTs); age != "" {
		parts = append(parts, age)
	}
	if td.VerifyLastLine != "" {
		parts = append(parts, compactText(td.VerifyLastLine, 60))
	}
	return strings.Join(parts, " · ")
}

// mergeGateSignal is how long a finished lane has waited to land. The digest carries the gate's clock, so this
// row and the cockpit's agree; a gate whose done event was pruned has none and shows no age.
func mergeGateSignal(td wshrpc.DagTaskDigest, now int64) string {
	if td.MergeGateTs > 0 {
		if age := compactDur(now - td.MergeGateTs); age != "" {
			return "merge waiting " + age
		}
	}
	return "merge waiting"
}

// reportLine carries what the lead's run-end report is written from.
func reportLine(d wshrpc.DagStatusDigest) string {
	line := fmt.Sprintf("report  elapsed=%s  workers=%s  commits=%d  answered=%d  forwarded=%d",
		durOrZero(d.Durations.ElapsedMs), durOrZero(d.Report.WorkerMs), len(d.Report.Commits), d.Report.Answered, d.Report.Forwarded)
	if d.Report.Unverified {
		line += "  unverified"
	}
	return line
}

// usageLabels names a role's total where the plain role name reads wrong: there is one lead but many workers.
var usageLabels = map[string]string{jarvis.UsageRole_Worker: "workers", jarvis.UsageRole_Reviewer: "reviewers"}

// usageLines is the dag's token total per role, then each task's per role, in the order the rows came.
func usageLines(rows []waveobj.UsageRow) []string {
	if len(rows) == 0 {
		return nil
	}
	lines := []string{"usage   " + usageTotals(rows, usageLabels)}
	var tasks []string
	byTask := map[string][]waveobj.UsageRow{}
	for _, r := range rows {
		if r.TaskId == "" {
			continue
		}
		if _, ok := byTask[r.TaskId]; !ok {
			tasks = append(tasks, r.TaskId)
		}
		byTask[r.TaskId] = append(byTask[r.TaskId], r)
	}
	for _, id := range tasks {
		lines = append(lines, fmt.Sprintf("%s usage: %s", id, usageTotals(byTask[id], nil)))
	}
	return lines
}

// usageTotals is "lead 1.2M · workers 3.4M", roles in the order they first appear. An unreadable transcript
// is counted rather than read as zero tokens spent.
func usageTotals(rows []waveobj.UsageRow, labels map[string]string) string {
	var roles []string
	totals := map[string]int{}
	missing := 0
	for _, r := range rows {
		if _, ok := totals[r.Role]; !ok {
			roles = append(roles, r.Role)
		}
		totals[r.Role] += jarvis.UsageTokens(r)
		if r.Missing {
			missing++
		}
	}
	parts := make([]string, len(roles))
	for i, role := range roles {
		label := role
		if l, ok := labels[role]; ok {
			label = l
		}
		parts[i] = label + " " + compactTokens(totals[role])
	}
	line := strings.Join(parts, " · ")
	if missing > 0 {
		line += fmt.Sprintf("  (%d unreadable)", missing)
	}
	return line
}

// compactTokens renders a token count the way the cockpit does (formatTokens in agentsviewmodel.ts).
func compactTokens(n int) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%dk", (n+500)/1_000)
	}
	return strconv.Itoa(n)
}

func durOrZero(ms int64) string {
	if s := compactDur(ms); s != "" {
		return s
	}
	return "0s"
}

// compactDur renders a millisecond span as the shortest readable form ("45s", "2m3s", "1h2m").
func compactDur(ms int64) string {
	if ms <= 0 {
		return ""
	}
	d := time.Duration(ms) * time.Millisecond
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d/time.Second))
	case d < time.Hour:
		m := int(d / time.Minute)
		if s := int((d % time.Minute) / time.Second); s > 0 {
			return fmt.Sprintf("%dm%ds", m, s)
		}
		return fmt.Sprintf("%dm", m)
	case d < 24*time.Hour:
		h := int(d / time.Hour)
		if m := int((d % time.Hour) / time.Minute); m > 0 {
			return fmt.Sprintf("%dh%dm", h, m)
		}
		return fmt.Sprintf("%dh", h)
	default:
		return fmt.Sprintf("%dd%dh", int(d/(24*time.Hour)), int((d%(24*time.Hour))/time.Hour))
	}
}

// compactText truncates rune-wise with an ellipsis to n runes.
func compactText(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// dagIds returns the --channel/--runid flags, falling back to the caller's own run context when the
// lead runs the command from its own session (the engine never injects the ids, so the lead must not
// need to know them). A fallback that resolves nothing is an error — the command cannot target a dag.
func dagIds(cmd *cobra.Command) (string, string, error) {
	channelId, _ := cmd.Flags().GetString("channel")
	runId, _ := cmd.Flags().GetString("runid")
	if channelId != "" && runId != "" {
		return channelId, runId, nil
	}
	if RpcClient == nil {
		return "", "", fmt.Errorf("--channel/--runid required outside a wave session")
	}
	oref, err := resolveBlockArg()
	if err != nil {
		return "", "", fmt.Errorf("resolving block: %w", err)
	}
	rtn, err := wshclient.JarvisCtxCommand(RpcClient, wshrpc.CommandJarvisCtxData{BlockORef: oref.String()}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return "", "", err
	}
	if rtn.RunId == "" {
		return "", "", fmt.Errorf("no run context for this block; pass --channel/--runid explicitly")
	}
	return rtn.ChannelId, rtn.RunId, nil
}

// dagDoneLines is the one line a dag command prints on success: what it recorded and what happens next. A silent
// success reads the same as doing nothing, and a caller that resends a verdict or an answer is not harmless (run
// 6c7652be). {task} is the command's task id.
var dagDoneLines = map[string]string{
	"approve":           "task {task} approved; the engine lands or dispatches it on its next tick",
	"retry":             "task {task} re-queued; a fresh worker starts when a slot is free",
	"escalate":          "task {task} re-queued on the chosen model; a fresh worker starts when a slot is free",
	"skip":              "task {task} skipped; it will not run",
	"cancel":            "dag cancelled; its workers stop and their worktrees are cleaned up",
	"retry-cleanup":     "task {task}'s worktree cleanup retried; `wsh jarvis dag status` shows whether it cleared",
	"forward":           "task {task} forwarded; it waits on the human in the cockpit",
	"amend":             "note added to task {task}; its worker's prompt carries it",
	"tell":              "message typed into task {task}'s terminal",
	"sendback":          "task {task} sent back; a worker takes it again",
	"answer":            "answer delivered to task {task}",
	"merge":             "task {task} merge requested; `wsh jarvis dag status` shows whether it landed or is blocked on a conflict",
	"review-pass":       "review pass recorded; the engine merges the task. Ending this session",
	"review-fail":       "review fail recorded; the lead gets the findings. Ending this session",
	"planreview-pass":   "plan review pass recorded; the engine dispatches the first tasks. Ending this session",
	"planreview-fail":   "plan review fail recorded; the lead revises the plan. Ending this session",
	"planreview-accept": "plan review accepted; the engine dispatches the first tasks",
	"final-pass":        "final pass recorded; the run completes. Ending this session",
	"final-fail":        "final fail recorded; the lead gets the defects. Ending this session",
}

func dagDoneLine(action, taskID string) string {
	return strings.ReplaceAll(dagDoneLines[action], "{task}", taskID)
}

func dagAction(action string) *cobra.Command {
	return dagActionWithin(action, 10_000)
}

func dagActionWithin(action string, timeoutMs int64) *cobra.Command {
	return &cobra.Command{
		Use:     fmt.Sprintf("%s <task-id>", action),
		Short:   fmt.Sprintf("dag action: %s", action),
		Args:    cobra.ExactArgs(1),
		PreRunE: preRunSetupRpcClient,
		RunE: func(cmd *cobra.Command, args []string) error {
			channelId, runId, err := dagIds(cmd)
			if err != nil {
				return err
			}
			if err := wshclient.DagActionCommand(RpcClient, wshrpc.CommandDagActionData{
				ChannelId: channelId, RunId: runId, TaskId: args[0], Action: action,
			}, &wshrpc.RpcOpts{Timeout: timeoutMs}); err != nil {
				return err
			}
			fmt.Println(dagDoneLine(action, args[0]))
			return nil
		},
	}
}

func dagEscalateData(cmd *cobra.Command, args []string) (wshrpc.CommandDagActionData, error) {
	channelID, runID, err := dagIds(cmd)
	if err != nil {
		return wshrpc.CommandDagActionData{}, err
	}
	model, _ := cmd.Flags().GetString("model")
	if model == "" {
		return wshrpc.CommandDagActionData{}, fmt.Errorf("--model is required")
	}
	runtime, _ := cmd.Flags().GetString("runtime")
	return wshrpc.CommandDagActionData{
		ChannelId: channelID,
		RunId:     runID,
		TaskId:    args[0],
		Action:    "escalate",
		Model:     model,
		Runtime:   runtime,
	}, nil
}

var dagEscalateCmd = &cobra.Command{
	Use:     "escalate <task-id>",
	Short:   "re-queue a failed or stalled task on a chosen model (one judged hop)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := dagEscalateData(cmd, args)
		if err != nil {
			return err
		}
		if err := wshclient.DagActionCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10_000}); err != nil {
			return err
		}
		fmt.Println(dagDoneLine(data.Action, data.TaskId))
		return nil
	},
}

var dagMergeCmd = &cobra.Command{
	Use:   "merge <task-id>",
	Short: "squash-merge a finished task's worktree back into the project branch",
	Long: "Squash-merge a finished task's worktree back into the project branch. On a squash\n" +
		"conflict the task enters blocked-merge: resolve the conflicts in the project tree, then\n" +
		"re-run with --continue so the engine commits the resolved state. When the plan's Verify\n" +
		"fails after a merge the task enters verify-failed: fix it in the project tree, commit, then\n" +
		"re-run with --continue so the engine runs Verify again.",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		channelId, runId, err := dagIds(cmd)
		if err != nil {
			return err
		}
		cont, err := cmd.Flags().GetBool("continue")
		if err != nil {
			return err
		}
		data := wshrpc.CommandDagMergeData{ChannelId: channelId, RunId: runId, TaskId: args[0]}
		if cont {
			if err := wshclient.DagMergeContinueCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 60_000}); err != nil {
				return err
			}
			fmt.Printf("task %s continued; the plan's Verify, if it has one, runs next and a failure wakes you\n", args[0])
			return nil
		}
		if err := wshclient.DagMergeCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 60_000}); err != nil {
			return err
		}
		fmt.Println(dagDoneLine("merge", args[0]))
		return nil
	},
}

var dagAsksCmd = &cobra.Command{
	Use:     "asks",
	Short:   "list the questions waiting on the lead, oldest first, with every option",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		channelId, runId, err := dagIds(cmd)
		if err != nil {
			return err
		}
		rtn, err := wshclient.DagAsksCommand(RpcClient, wshrpc.CommandDagStatusData{ChannelId: channelId, RunId: runId}, &wshrpc.RpcOpts{Timeout: 10_000})
		if err != nil {
			return err
		}
		for _, line := range dagAskLines(rtn.Asks, time.Now().UnixMilli()) {
			fmt.Println(line)
		}
		return nil
	},
}

// dagAskLines renders the lead's question queue, oldest first: every question of every entry the lead
// holds, with the option indexes `dag answer` takes. Entries the human holds are only counted: the lead
// handed them on or the human took them over, and the server refuses the lead's answer to them.
func dagAskLines(asks []wshrpc.DagAskItem, now int64) []string {
	sorted := append([]wshrpc.DagAskItem(nil), asks...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Ts < sorted[j].Ts })
	var lines []string
	held := 0
	for _, a := range sorted {
		if a.Owner == agentask.AskOwner_User {
			held++
			continue
		}
		lines = append(lines, dagAskHeading(a, now))
		if a.Note != "" {
			lines = append(lines, "  note: "+a.Note)
		}
		for _, q := range a.Questions {
			lines = append(lines, dagQuestionLines(q)...)
		}
	}
	if len(lines) == 0 {
		lines = append(lines, "no questions waiting")
	} else {
		lines = append(lines,
			`answer:  wsh jarvis dag answer <task-id> '[{"selectedindexes":[0]}]'  (one item per question, in order; {"text":"..."} for free text)`,
			`forward: wsh jarvis dag forward <task-id> "<what you checked, what you recommend>"`)
	}
	if held > 0 {
		lines = append(lines, fmt.Sprintf("%d held by the human in the run cockpit", held))
	}
	return lines
}

func dagAskHeading(a wshrpc.DagAskItem, now int64) string {
	age := compactDur(now - a.Ts)
	if age == "" {
		age = "0s"
	}
	line := fmt.Sprintf("%s  asked %s ago", a.TaskId, age)
	if a.Deadline == 0 {
		return line
	}
	if left := a.Deadline - now; left > 0 {
		return line + "  deadline in " + compactDur(left)
	}
	return line + "  deadline passed"
}

func dagQuestionLines(q baseds.AgentAskQuestion) []string {
	head := "  " + q.Question
	if q.Header != "" {
		head = fmt.Sprintf("  [%s] %s", q.Header, q.Question)
	}
	if q.MultiSelect {
		head += " (multi-select)"
	}
	lines := []string{head}
	for i, o := range q.Options {
		opt := fmt.Sprintf("    %d) %s", i, o.Label)
		if o.Description != "" {
			opt += " - " + o.Description
		}
		lines = append(lines, opt)
	}
	return lines
}

var dagAnswerCmd = &cobra.Command{
	Use:     "answer <task-id> <answers-json>",
	Short:   "deliver an answer to a child's pending ask (answers-json: [{\"selectedindexes\":[0]}] or [{\"text\":\"...\"}])",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		channelId, runId, err := dagIds(cmd)
		if err != nil {
			return err
		}
		var answers []baseds.AgentAnswerItem
		if err := json.Unmarshal([]byte(args[1]), &answers); err != nil {
			return fmt.Errorf("answers json: %w", err)
		}
		if err := wshclient.DagAnswerCommand(RpcClient, wshrpc.CommandDagAnswerData{
			ChannelId: channelId, RunId: runId, TaskId: args[0], Answers: answers, Lead: true,
		}, &wshrpc.RpcOpts{Timeout: dagAnswerTimeoutMs(answers)}); err != nil {
			return err
		}
		fmt.Println(dagDoneLine("answer", args[0]))
		return nil
	},
}

// dagAnswerBaseTimeoutMs is the answer's budget before any typing.
const dagAnswerBaseTimeoutMs = 10_000

// dagAnswerTimeoutMs covers the server typing a free-text answer one key per character, KeystrokeDelay apart,
// twice over for a loaded machine: a fixed budget expired on long answers that then landed anyway.
func dagAnswerTimeoutMs(answers []baseds.AgentAnswerItem) int64 {
	runes := 0
	for _, a := range answers {
		runes += utf8.RuneCountInString(a.Text)
	}
	return dagAnswerBaseTimeoutMs + int64(runes)*agentask.KeystrokeDelay.Milliseconds()*2
}

// dagForwardData is the forward action's payload. The note is not checked here: the server owns what
// a forward needs.
func dagForwardData(cmd *cobra.Command, args []string) (wshrpc.CommandDagActionData, error) {
	channelId, runId, err := dagIds(cmd)
	if err != nil {
		return wshrpc.CommandDagActionData{}, err
	}
	return wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, TaskId: args[0], Action: "forward", Notes: args[1]}, nil
}

var dagForwardCmd = &cobra.Command{
	Use:     "forward <task-id> <note>",
	Short:   "hand a task's question, failure, stall or merge conflict to the human, with what you checked and recommend",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := dagForwardData(cmd, args)
		if err != nil {
			return err
		}
		if err := wshclient.DagActionCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10_000}); err != nil {
			return err
		}
		fmt.Println(dagDoneLine(data.Action, data.TaskId))
		return nil
	},
}

// dagReviewData is a reviewer's verdict payload. RunId resolves to the reviewer's own run, which is how the
// server finds the task it reviews.
func dagReviewData(cmd *cobra.Command, args []string) (wshrpc.CommandDagActionData, error) {
	verdict := args[0]
	if verdict != "pass" && verdict != "fail" {
		return wshrpc.CommandDagActionData{}, fmt.Errorf("verdict must be pass or fail, got %q", verdict)
	}
	channelId, runId, err := dagIds(cmd)
	if err != nil {
		return wshrpc.CommandDagActionData{}, err
	}
	downstream, _ := cmd.Flags().GetString("downstream")
	downstreamFor, _ := cmd.Flags().GetStringSlice("for")
	unverified, _ := cmd.Flags().GetString("unverified")
	return wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, Action: "review-" + verdict, Notes: args[1], Downstream: downstream, Unverified: unverified, DownstreamFor: downstreamFor}, nil
}

var dagReviewCmd = &cobra.Command{
	Use:     "review <pass|fail> <note>",
	Short:   "as a task's reviewer: record your verdict (a pass's summary, or a fail's findings), then end your session",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := dagReviewData(cmd, args)
		if err != nil {
			return err
		}
		if err := wshclient.DagActionCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10_000}); err != nil {
			return err
		}
		fmt.Println(dagDoneLine(data.Action, ""))
		return reportRunPhase(wshrpc.CommandReportRunPhaseData{Action: "complete"})
	},
}

// dagPlanReviewData is the payload of a plan review verdict, or of the lead's accept. RunId resolves to the
// caller's own run: the plan reviewer's for pass and fail, which is how the server knows the verdict is its.
func dagPlanReviewData(cmd *cobra.Command, args []string) (wshrpc.CommandDagActionData, error) {
	verb := args[0]
	if verb != "pass" && verb != "fail" && verb != "accept" {
		return wshrpc.CommandDagActionData{}, fmt.Errorf("planreview takes pass, fail or accept, got %q", verb)
	}
	rawPicks, _ := cmd.Flags().GetStringArray("pick")
	if len(rawPicks) > 0 && verb == "accept" {
		return wshrpc.CommandDagActionData{}, fmt.Errorf("--pick goes with the reviewer's pass or fail, not accept")
	}
	var picks []wshrpc.DagModelPick
	for _, raw := range rawPicks {
		pick, err := parsePick(raw)
		if err != nil {
			return wshrpc.CommandDagActionData{}, err
		}
		picks = append(picks, pick)
	}
	channelId, runId, err := dagIds(cmd)
	if err != nil {
		return wshrpc.CommandDagActionData{}, err
	}
	return wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, Action: "planreview-" + verb, Notes: args[1], Picks: picks}, nil
}

var pickTaskRe = regexp.MustCompile(`^t-\d+$`)

// parsePick reads one --pick, `t-N=<sonnet|lead>: <reason>`. The server checks the task and the reason's length;
// this refuses what cannot be a pick at all, so it never reaches the dag under a task id that matches nothing.
func parsePick(s string) (wshrpc.DagModelPick, error) {
	bad := fmt.Errorf("--pick wants \"t-N=<sonnet|lead>: <reason>\", got %q", s)
	taskID, rest, ok := strings.Cut(s, "=")
	if !ok {
		return wshrpc.DagModelPick{}, bad
	}
	model, reason, ok := strings.Cut(rest, ":")
	if !ok {
		return wshrpc.DagModelPick{}, bad
	}
	pick := wshrpc.DagModelPick{TaskId: strings.TrimSpace(taskID), Model: strings.TrimSpace(model), Reason: strings.TrimSpace(reason)}
	if !pickTaskRe.MatchString(pick.TaskId) || (pick.Model != "sonnet" && pick.Model != "lead") || pick.Reason == "" {
		return wshrpc.DagModelPick{}, bad
	}
	return pick, nil
}

var dagPlanReviewCmd = &cobra.Command{
	Use:     "planreview <pass|fail|accept> <text>",
	Short:   "as the plan reviewer: record your verdict (a pass's summary, or a fail's findings), then end your session; as the lead: accept a failed plan review with the human's reason",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := dagPlanReviewData(cmd, args)
		if err != nil {
			return err
		}
		if err := wshclient.DagActionCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10_000}); err != nil {
			return err
		}
		fmt.Println(dagDoneLine(data.Action, ""))
		if data.Action == "planreview-accept" {
			return nil
		}
		return reportRunPhase(wshrpc.CommandReportRunPhaseData{Action: "complete"})
	},
}

// dagFinalData is the final verifier's verdict payload. RunId resolves to the verifier's own run, which is
// how the server knows the verdict is its.
func dagFinalData(cmd *cobra.Command, args []string) (wshrpc.CommandDagActionData, error) {
	verdict := args[0]
	if verdict != "pass" && verdict != "fail" {
		return wshrpc.CommandDagActionData{}, fmt.Errorf("final takes pass or fail, got %q", verdict)
	}
	channelId, runId, err := dagIds(cmd)
	if err != nil {
		return wshrpc.CommandDagActionData{}, err
	}
	unverified, _ := cmd.Flags().GetString("unverified")
	return wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, Action: "final-" + verdict, Notes: args[1], Unverified: unverified}, nil
}

var dagFinalCmd = &cobra.Command{
	Use:     "final <pass|fail> <text>",
	Short:   "as the final verifier: record your verdict on the merged result (a pass's summary, or a fail's defects), then end your session",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := dagFinalData(cmd, args)
		if err != nil {
			return err
		}
		if err := wshclient.DagActionCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10_000}); err != nil {
			return err
		}
		fmt.Println(dagDoneLine(data.Action, ""))
		return reportRunPhase(wshrpc.CommandReportRunPhaseData{Action: "complete"})
	},
}

// dagNoteData is the payload of a lead action that carries text for a task: amend's note, tell's message,
// sendback's optional guidance.
func dagNoteData(cmd *cobra.Command, action string, args []string) (wshrpc.CommandDagActionData, error) {
	channelId, runId, err := dagIds(cmd)
	if err != nil {
		return wshrpc.CommandDagActionData{}, err
	}
	data := wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, TaskId: args[0], Action: action}
	if len(args) > 1 {
		data.Notes = args[1]
	}
	return data, nil
}

func dagNoteCmd(use, action, short string, args cobra.PositionalArgs) *cobra.Command {
	return &cobra.Command{
		Use:     use,
		Short:   short,
		Args:    args,
		PreRunE: preRunSetupRpcClient,
		RunE: func(cmd *cobra.Command, a []string) error {
			data, err := dagNoteData(cmd, action, a)
			if err != nil {
				return err
			}
			if err := wshclient.DagActionCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10_000}); err != nil {
				return err
			}
			fmt.Println(dagDoneLine(action, data.TaskId))
			return nil
		},
	}
}

var (
	dagAmendCmd    = dagNoteCmd("amend <task-id> <note>", "amend", "add a note to a task that has not started; its worker's prompt carries it", cobra.ExactArgs(2))
	dagTellCmd     = dagNoteCmd("tell <task-id> <text>", "tell", "type a message into a running worker's (or reviewer's) terminal", cobra.ExactArgs(2))
	dagSendbackCmd = dagNoteCmd("sendback <task-id> [guidance]", "sendback", "send a task whose review failed back for one more round, with your guidance beside the findings", cobra.RangeArgs(1, 2))
)

// dagReportText is what `dag report` prints: the whole sealed report, or one section of it ("None" when the
// worker wrote None). A report written before the format has no sections to ask for.
func dagReportText(summary, section string) (string, error) {
	if section == "" {
		return summary, nil
	}
	keys := reportSectionKeyNames()
	rep, unstructured := jarvis.ReadWorkerReport(summary)
	if !slices.Contains(keys, section) {
		return "", fmt.Errorf("unknown section %q; sections are %s", section, strings.Join(keys, ", "))
	}
	if unstructured != "" {
		return "", fmt.Errorf("this report predates sections; run without a section")
	}
	body, _ := rep.Section(section)
	if body == "" {
		return "None", nil
	}
	return body, nil
}

// dagReportSummary finds the sealed report of a task's worker among the channel's runs. taskArg is `3` or `t-3`.
func dagReportSummary(g *waveobj.TaskGroup, runs []*waveobj.Run, taskArg string) (string, error) {
	id := strings.TrimSpace(taskArg)
	if !strings.HasPrefix(id, "t-") {
		id = "t-" + id
	}
	var task *waveobj.TaskNode
	for i := range g.Tasks {
		if g.Tasks[i].ID == id {
			task = &g.Tasks[i]
		}
	}
	if task == nil {
		return "", fmt.Errorf("the dag has no task %s", id)
	}
	if task.RunID == "" {
		return "", fmt.Errorf("task %s has no worker run yet", id)
	}
	for _, r := range runs {
		if r != nil && r.ID == task.RunID {
			if r.Evidence == nil {
				return "", fmt.Errorf("task %s's worker has not sealed a report yet", id)
			}
			return r.Evidence.Summary, nil
		}
	}
	return "", fmt.Errorf("task %s's worker run %s is not in this run's channel", id, task.RunID)
}

var dagReportCmd = &cobra.Command{
	Use:   "report <task-id> [section]",
	Short: "print a task's worker report, whole or one section",
	Long: "Print a task's sealed worker report, whole or one section: " + strings.Join(reportSectionKeyNames(), ", ") + ".\n" +
		"A section the worker left as None prints None.",
	Args:    cobra.RangeArgs(1, 2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		channelId, runId, err := dagIds(cmd)
		if err != nil {
			return err
		}
		st, err := wshclient.DagStatusCommand(RpcClient, wshrpc.CommandDagStatusData{ChannelId: channelId, RunId: runId}, &wshrpc.RpcOpts{Timeout: 10_000})
		if err != nil {
			return err
		}
		if st.Group == nil {
			return fmt.Errorf("this run holds no dag")
		}
		rtn, err := wshclient.GetChannelRunsCommand(RpcClient, wshrpc.CommandGetChannelRunsData{ChannelId: channelId}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
		if err != nil {
			return fmt.Errorf("listing runs: %w", err)
		}
		summary, err := dagReportSummary(st.Group, rtn.Runs, args[0])
		if err != nil {
			return err
		}
		section := ""
		if len(args) > 1 {
			section = args[1]
		}
		text, err := dagReportText(summary, section)
		if err != nil {
			return err
		}
		fmt.Println(text)
		return nil
	},
}

func reportSectionKeyNames() []string {
	keys := make([]string, len(jarvis.WorkerReportSections))
	for i, sec := range jarvis.WorkerReportSections {
		keys[i] = sec.Key
	}
	return keys
}

var dagRulesInject bool

// dagRulesCmd prints the orchestration rules for the caller's lead session (spec §7). It runs from a
// SessionStart hook in every Claude session and from pi after every compaction, so it is silent and
// succeeds everywhere else: outside Wave, outside a lead, and before the lead holds a dag.
var dagRulesCmd = &cobra.Command{
	Use:           "rules",
	Short:         "print the orchestration rules for this lead's run (nothing outside a lead holding a dag)",
	Args:          cobra.NoArgs,
	Hidden:        true,
	SilenceErrors: true,
	SilenceUsage:  true,
	RunE:          dagRulesRun,
}

func dagRulesRun(cmd *cobra.Command, args []string) error {
	jwt := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwt == "" || setupRpcClient(nil, jwt) != nil {
		return nil
	}
	oref, err := resolveBlockArg()
	if err != nil {
		return nil
	}
	ctxRtn, err := wshclient.JarvisCtxCommand(RpcClient, wshrpc.CommandJarvisCtxData{BlockORef: oref.String()}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil || ctxRtn.DagOID == "" {
		return nil
	}
	st, err := wshclient.DagStatusCommand(RpcClient, wshrpc.CommandDagStatusData{ChannelId: ctxRtn.ChannelId, RunId: ctxRtn.RunId}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return nil
	}
	text := dagRulesText(ctxRtn, st, leadTree())
	if text == "" {
		return nil
	}
	if !dagRulesInject {
		fmt.Println(text)
		return nil
	}
	out, err := sessionStartPayload(text)
	if err != nil {
		return nil
	}
	fmt.Println(string(out))
	return nil
}

// sessionStartPayload wraps text as a SessionStart hook's added context. Claude Code reads both
// additional_context and hookSpecificOutput without deduplication, so exactly one of them may be emitted.
func sessionStartPayload(text string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"hookSpecificOutput": map[string]any{
			"hookEventName":     "SessionStart",
			"additionalContext": text,
		},
	})
}

// dagRulesText is the rules for a caller whose run the dag names, and "" for anyone else: a dag child
// resolves to its own run. tree is the lead's own tree, where a branch-landed dag's repo-relative docs are
// its live copy.
func dagRulesText(ctx *wshrpc.CommandJarvisCtxRtnData, st *wshrpc.CommandDagStatusRtnData, tree string) string {
	if ctx == nil || st == nil || st.Group == nil || ctx.RunId == "" || st.Group.RunID != ctx.RunId {
		return ""
	}
	g := st.Group
	return jarvis.OrchestrationRules(ctx.RunId, orchestrate.DocPath(g, tree, g.SpecPath), orchestrate.DocPath(g, tree, g.PlanPath))
}

// leadTree is the root of the repository tree the caller runs in, which for a lead is its landing tree,
// and "" outside one.
func leadTree() string {
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func init() {
	jarvisDagCmd.AddCommand(dagSubmitCmd, dagStatusCmd, dagMergeCmd, dagAsksCmd, dagAnswerCmd, dagForwardCmd, dagRulesCmd, dagReportCmd, dagReviewCmd, dagPlanReviewCmd, dagFinalCmd, dagAmendCmd, dagTellCmd)
	jarvisDagCmd.AddCommand(dagAction("approve"), dagSendbackCmd, dagAction("retry"), dagAction("skip"), dagEscalateCmd, dagAction("cancel"), dagActionWithin("retry-cleanup", 60_000))
	for _, c := range jarvisDagCmd.Commands() {
		c.Flags().String("runid", "", "run id")
		c.Flags().String("channel", "", "channel id")
	}
	dagSubmitCmd.Flags().String("plan", "", "the plan file to submit, in the plan format below; its tasks become the dag")
	dagSubmitCmd.Flags().String("spec", "", "the spec the plan implements; committed with the plan in the run's first merge")
	dagSubmitCmd.Flags().Bool("round", false, "after the final stage failed: append the fix plan's tasks to this run's dag as a fix round; the dag keeps its Verify, Setup, Check and Final")
	dagEscalateCmd.Flags().String("model", "", "exact model id to retry on (e.g. sonnet, or opencode/deepseek-v4-pro for pi)")
	dagEscalateCmd.Flags().String("runtime", "", "runtime to retry on; empty keeps the task's current runtime")
	dagReviewCmd.Flags().String("downstream", "", "with pass: what a later task must know that the worker's report omits or gets wrong (a renamed API, a plan assumption that turned out wrong); the engine hands it to the tasks that depend on this one")
	dagReviewCmd.Flags().StringSlice("for", nil, "with pass: more tasks to reach (t-3,t-5); alone, it forwards the worker's report section for later tasks. The engine adds it to a task not started and types it to a running one")
	dagReviewCmd.Flags().String("unverified", "", "with pass: a check the task asked for (a test, a screenshot, a live run) that was not done, and why; the lead reads it whole")
	dagPlanReviewCmd.Flags().StringArray("pick", nil, "with pass or fail, on a Reviewer picks run: one per task without a Model line (a fail may leave tasks out), as \"t-N=<sonnet|lead>: <one-line reason>\"")
	dagFinalCmd.Flags().String("unverified", "", "with pass: what you could not verify on the merged result, and why; the lead and the human read it whole")
	dagMergeCmd.Flags().Bool("continue", false, "finish a resolved squash merge, or re-run a failed Verify after committing the fix")
	dagRulesCmd.Flags().BoolVar(&dagRulesInject, "inject", false, "emit the rules as a Claude Code SessionStart hook's added context")
	jarvisCmd.AddCommand(jarvisDagCmd)
}
