package orchestrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// captureClient records broker events so tests can assert engine event publishing.
type captureClient struct {
	mu     sync.Mutex
	events []wps.WaveEvent
}

func (c *captureClient) SendEvent(_ string, event wps.WaveEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, event)
}

func (c *captureClient) saw(kind, scope string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.events {
		if e.Event == kind && e.HasScope(scope) {
			return true
		}
	}
	return false
}

func (c *captureClient) dagCleanupStates(scope string) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []string
	for _, e := range c.events {
		if e.Event != wps.Event_WaveObjUpdate || !e.HasScope(scope) {
			continue
		}
		wu, ok := e.Data.(waveobj.WaveObjUpdate)
		if !ok {
			continue
		}
		g, ok := wu.Obj.(*waveobj.TaskGroup)
		if !ok || len(g.Tasks) == 0 {
			continue
		}
		switch {
		case g.Tasks[0].CleanupPending:
			out = append(out, "pending")
		case g.Tasks[0].CleanupError != "":
			out = append(out, "failed")
		default:
			out = append(out, "clear")
		}
	}
	return out
}

func TestTaskPromptCarriesDescriptionAndContract(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	g := &waveobj.TaskGroup{}
	desc := "pin: date-only format (Aug 16)"
	task := &waveobj.TaskNode{ID: "t-1", Label: "add fmtDate", Description: desc}
	p := taskPrompt(g, task, &owner, "claude", "", "")
	for _, want := range []string{"add fmtDate", desc, workerContract(g, task, "claude", "")} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt missing %q: %q", want, p)
		}
	}
}

func TestTaskPromptLabelOnlyStillHasContract(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	g := &waveobj.TaskGroup{}
	task := &waveobj.TaskNode{ID: "t-1", Label: "plain"}
	p := taskPrompt(g, task, &owner, "claude", "", "")
	if !strings.HasPrefix(p, workerContract(g, task, "claude", "")) {
		t.Fatalf("contract must open the prompt: %q", p)
	}
	if strings.Contains(p, "description") {
		t.Fatalf("no description should appear for a label-only task: %q", p)
	}
}

// spec §4: the contract, then the task's text, then the handoff, so a worker reads its obligations first
// and the handoff sits beside the work it shaped.
func TestTaskPromptOrdersContractTaskHandoff(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	g := &waveobj.TaskGroup{}
	task := &waveobj.TaskNode{ID: "t-2", Label: "use fmtDate"}
	p := taskPrompt(g, task, &owner, "claude", "", "landed as commit abc1234")
	ci := strings.Index(p, workerContract(g, task, "claude", ""))
	ti := strings.Index(p, "use fmtDate")
	hi := strings.Index(p, "landed as commit abc1234")
	if ci != 0 || ti < 0 || hi < 0 || ti > hi {
		t.Fatalf("want contract, task, handoff in that order (contract@%d task@%d handoff@%d): %q", ci, ti, hi, p)
	}
}

// spec §12: a plan's header prose (a scope rule, a shared constraint) reaches every task, not just
// whichever worker opens the plan file.
func TestTaskPromptCarriesThePlanHeader(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	g := &waveobj.TaskGroup{Preamble: "Never edit docs/."}
	task := &waveobj.TaskNode{ID: "t-1", Label: "add fmtDate"}
	p := taskPrompt(g, task, &owner, "claude", "", "")
	ci := strings.Index(p, workerContract(g, task, "claude", ""))
	hi := strings.Index(p, "The plan's header applies to every task:\nNever edit docs/.")
	ti := strings.Index(p, "add fmtDate")
	if ci != 0 || hi < 0 || ti < 0 || hi > ti {
		t.Fatalf("want contract, then header, then task text (contract@%d header@%d task@%d): %q", ci, hi, ti, p)
	}
}

func TestTaskPromptWithoutPlanHeader(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	g := &waveobj.TaskGroup{}
	task := &waveobj.TaskNode{ID: "t-1", Label: "add fmtDate"}
	p := taskPrompt(g, task, &owner, "claude", "", "")
	if strings.Contains(p, "header applies to every task") {
		t.Fatalf("no preamble means no header line: %q", p)
	}
}

func TestWorkerContractForbidsAttributionTrailers(t *testing.T) {
	c := workerContract(&waveobj.TaskGroup{}, &waveobj.TaskNode{ID: "t-3"}, "claude", "")
	if !strings.Contains(c, "Co-Authored-By") {
		t.Fatalf("contract must forbid attribution trailers:\n%s", c)
	}
}

func TestWorkerContractStatesTheSubagentCap(t *testing.T) {
	c := workerContract(&waveobj.TaskGroup{}, &waveobj.TaskNode{ID: "t-3"}, "claude", "")
	if !strings.Contains(c, jarvis.SubagentCapRule) {
		t.Fatalf("contract must state the subagent cap:\n%s", c)
	}
}

// a piped test exits with its last command's status, so `go test ./... | tail` reads as a pass when it fails
func TestWorkerContractKeepsATestsExitCodeThroughAPipe(t *testing.T) {
	c := workerContract(&waveobj.TaskGroup{}, &waveobj.TaskNode{ID: "t-3"}, "claude", "")
	if !strings.Contains(c, "`set -o pipefail`") {
		t.Fatalf("contract must say how to keep a piped test's exit code:\n%s", c)
	}
}

func TestWorkerContractNamesPlanSpecVerifyAndTool(t *testing.T) {
	g := &waveobj.TaskGroup{PlanPath: "C:/p/plan.md", SpecPath: "C:/p/spec.md", Verify: "go test ./..."}
	c := workerContract(g, &waveobj.TaskNode{ID: "t-3"}, "pi", "")
	for _, want := range []string{
		"You are the worker for task 3 of the plan at C:/p/plan.md (spec: C:/p/spec.md).",
		"don't re-plan or pause for design approval",
		"ask once with ask_user_question and concrete options, then wait",
		"Run the tests your task names and get them passing before you complete; if you can't, ask.",
		"Don't run the plan's full Verify (`go test ./...`), a whole package or the full suite, even when your task says to: the engine runs Verify after your task merges and again on the merged result. Run the tests your task names alone (for Go, `-run '<names>'`).",
		"To reproduce a flake, run the one failing test alone (for Go, `-run '^TestX$' -count=N`), never `-count=N` on a whole package.",
		"Commit, then write your report",
		"If your context was compacted, re-read your task from the plan.",
	} {
		if !strings.Contains(c, want) {
			t.Fatalf("contract missing %q:\n%s", want, c)
		}
	}
}

// a branch-landed dag's docs are the snapshot committed at submit, which the worker reads in its own tree
func TestWorkerContractNamesTheDocsInTheWorkersTree(t *testing.T) {
	tree := t.TempDir()
	g := &waveobj.TaskGroup{PlanPath: "docs/superpowers/plans/p.md", SpecPath: "docs/superpowers/specs/s.md"}
	c := workerContract(g, &waveobj.TaskNode{ID: "t-3"}, "claude", tree)
	want := fmt.Sprintf("of the plan at %s (spec: %s).", filepath.Join(tree, "docs/superpowers/plans/p.md"), filepath.Join(tree, "docs/superpowers/specs/s.md"))
	if !strings.Contains(c, want) {
		t.Fatalf("contract missing %q:\n%s", want, c)
	}
}

// a dag built from tasks rather than a plan file has no plan path to point the worker at
func TestWorkerContractWithoutPlanOrVerify(t *testing.T) {
	c := workerContract(&waveobj.TaskGroup{}, &waveobj.TaskNode{ID: "t-3"}, "claude", "")
	for _, want := range []string{
		"You are the worker for task t-3 of this run's dag.",
		"ask once with AskUserQuestion",
		"Run the tests your task names and get them passing before you complete; if you can't, ask.",
		"To reproduce a flake, run the one failing test alone",
	} {
		if !strings.Contains(c, want) {
			t.Fatalf("contract missing %q:\n%s", want, c)
		}
	}
	// with no Verify nothing else runs the package, so the task's own whole-package step stands
	for _, gone := range []string{"plan at", "spec:", "re-read your task", "full Verify", "whole package or the full suite"} {
		if strings.Contains(c, gone) {
			t.Fatalf("a dag without a plan names none, found %q:\n%s", gone, c)
		}
	}
}

// Check is a fast whole-project static check every worker runs itself; Verify is the plan's full suite,
// which only the engine runs after the task's merge.
func TestWorkerContractNamesCheckAndLeavesVerifyToTheEngine(t *testing.T) {
	g := &waveobj.TaskGroup{Verify: "go test ./...", Check: "go vet ./..."}
	c := workerContract(g, &waveobj.TaskNode{ID: "t-3"}, "claude", "")
	for _, want := range []string{
		"Run the tests your task names, and `go vet ./...`, and get them passing before you complete; if you can't, ask.",
		"Don't run the plan's full Verify (`go test ./...`), a whole package or the full suite, even when your task says to: the engine runs Verify after your task merges",
	} {
		if !strings.Contains(c, want) {
			t.Fatalf("contract missing %q:\n%s", want, c)
		}
	}
}

// Final is the first run of a scenario unless the worker that wrote it runs it, and a failure there costs a fix round.
func TestWorkerContractHasTheWorkerRunItsOwnFinalScenario(t *testing.T) {
	want := "run that one scenario yourself (the Final command narrowed to it) and get its steps passing before you complete"
	g := &waveobj.TaskGroup{FinalCmd: "node scripts/cdp/final-verify.mjs surface-smoke"}
	c := workerContract(g, &waveobj.TaskNode{ID: "t-3"}, "claude", "")
	if !strings.Contains(c, want) || !strings.Contains(c, "(`node scripts/cdp/final-verify.mjs surface-smoke`)") {
		t.Fatalf("contract with a Final command missing %q:\n%s", want, c)
	}
	if c := workerContract(&waveobj.TaskGroup{}, &waveobj.TaskNode{ID: "t-3"}, "claude", ""); strings.Contains(c, "Final command") {
		t.Fatalf("no Final set, so no Final sentence: %q", c)
	}
}

func TestWorkerContractWithCheckButNoVerify(t *testing.T) {
	g := &waveobj.TaskGroup{Check: "go vet ./..."}
	c := workerContract(g, &waveobj.TaskNode{ID: "t-3"}, "claude", "")
	if want := "Run the tests your task names, and `go vet ./...`, and get them passing before you complete; if you can't, ask."; !strings.Contains(c, want) {
		t.Fatalf("contract missing %q:\n%s", want, c)
	}
	if strings.Contains(c, "full Verify") {
		t.Fatalf("no Verify set, so no Verify sentence: %q", c)
	}
}

func TestPredecessorHandoffCarriesDepCommitFilesAndNote(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{
		{ID: "t-1", Label: "add fmtDate", State: TaskState_Done, RunID: "run-dep", Merged: true},
		{ID: "t-2", Label: "use fmtDate", Deps: []string{"t-1"}},
	}}
	runs := map[string]*waveobj.Run{"run-dep": {
		EndCommit: "abc1234",
		Evidence: &waveobj.RunEvidence{
			Summary: "chose date-only format; fmtDate lives in util/date.ts",
			Files:   []waveobj.EvidenceFile{{Path: "util/date.ts", Add: 12, Del: 2}},
		},
	}}
	h := predecessorHandoff(taskByID(g, "t-2"), g, runs)
	for _, want := range []string{"add fmtDate", "t-1", "abc1234", "util/date.ts", "+12/-2", "date-only format"} {
		if !strings.Contains(h, want) {
			t.Fatalf("handoff missing %q: %q", want, h)
		}
	}
}

// every done ancestor's For later tasks reaches a task at dispatch; its commit and files stay a direct dependency's
func TestPredecessorHandoffCarriesEveryAncestorsForLaterTasks(t *testing.T) {
	report := func(forLater string) string {
		return "## Done\nAdded it.\n\n## Differs from plan\nNone\n\n## Not verified\nNone\n\n## For later tasks\n" + forLater + "\n\n## Found not fixed\nNone"
	}
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{
		{ID: "t-1", Label: "add fmtDate", State: TaskState_Done, RunID: "run-1", Merged: true},
		{ID: "t-2", Label: "use fmtDate", State: TaskState_Done, RunID: "run-2", Merged: true, Deps: []string{"t-1"}},
		{ID: "t-3", Label: "document it", Deps: []string{"t-2"}},
	}}
	runs := map[string]*waveobj.Run{
		"run-1": {EndCommit: "aaa1111", Evidence: &waveobj.RunEvidence{
			Summary: report("fmtDate lives in util/date.ts"),
			Files:   []waveobj.EvidenceFile{{Path: "util/date.ts", Add: 12, Del: 2}},
		}},
		"run-2": {EndCommit: "bbb2222", Evidence: &waveobj.RunEvidence{
			Summary: report("the header now calls fmtDate"),
			Files:   []waveobj.EvidenceFile{{Path: "ui/header.tsx", Add: 3, Del: 1}},
		}},
	}
	h := predecessorHandoff(taskByID(g, "t-3"), g, runs)
	for _, want := range []string{"fmtDate lives in util/date.ts", "the header now calls fmtDate", "bbb2222", "ui/header.tsx", "add fmtDate"} {
		if !strings.Contains(h, want) {
			t.Fatalf("handoff missing %q: %q", want, h)
		}
	}
	for _, absent := range []string{"aaa1111", "util/date.ts (+12/-2)", "It reported", "Added it."} {
		if strings.Contains(h, absent) {
			t.Fatalf("handoff must not carry %q: %q", absent, h)
		}
	}
}

// a report from before the format: a direct dependency keeps its bounded note, a transitive one adds nothing
func TestPredecessorHandoffKeepsALegacyDirectNoteOnly(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{
		{ID: "t-1", Label: "add fmtDate", State: TaskState_Done, RunID: "run-1", Merged: true},
		{ID: "t-2", Label: "use fmtDate", State: TaskState_Done, RunID: "run-2", Merged: true, Deps: []string{"t-1"}},
		{ID: "t-3", Label: "document it", Deps: []string{"t-2"}},
	}}
	runs := map[string]*waveobj.Run{
		"run-1": {EndCommit: "aaa1111", Evidence: &waveobj.RunEvidence{Summary: "transitive legacy note"}},
		"run-2": {EndCommit: "bbb2222", Evidence: &waveobj.RunEvidence{Summary: "direct legacy note"}},
	}
	h := predecessorHandoff(taskByID(g, "t-3"), g, runs)
	if !strings.Contains(h, "It reported: direct legacy note") {
		t.Fatalf("a legacy direct dependency keeps its note: %q", h)
	}
	if strings.Contains(h, "transitive legacy note") || strings.Contains(h, "add fmtDate") {
		t.Fatalf("a legacy transitive ancestor adds nothing: %q", h)
	}
}

func TestPredecessorHandoffEmptyWithoutDepsOrCommit(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{
		{ID: "t-1", Label: "dep", State: TaskState_Done, RunID: "run-dep"},
		{ID: "t-2", Label: "no deps"},
		{ID: "t-3", Label: "dep not landed", Deps: []string{"t-1"}},
	}}
	// a task with no deps gets nothing
	if h := predecessorHandoff(taskByID(g, "t-2"), g, map[string]*waveobj.Run{"run-dep": {EndCommit: "abc"}}); h != "" {
		t.Fatalf("expected no handoff for a task with no deps, got %q", h)
	}
	// a dep whose merge never stamped a commit contributes nothing rather than a bare heading
	if h := predecessorHandoff(taskByID(g, "t-3"), g, map[string]*waveobj.Run{"run-dep": {}}); h != "" {
		t.Fatalf("expected no handoff for an unstamped dep, got %q", h)
	}
}

func TestPredecessorHandoffSurvivesUnsealedEvidence(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{
		{ID: "t-1", Label: "dep", State: TaskState_Done, RunID: "run-dep", Merged: true},
		{ID: "t-2", Label: "dependent", Deps: []string{"t-1"}},
	}}
	// cleanup or the seal can fail and leave Evidence nil; the commit must still reach the child
	h := predecessorHandoff(taskByID(g, "t-2"), g, map[string]*waveobj.Run{"run-dep": {EndCommit: "deadbee"}})
	if !strings.Contains(h, "deadbee") {
		t.Fatalf("commit missing when evidence is unsealed: %q", h)
	}
}

func TestTruncateNoteBoundsAndCollapses(t *testing.T) {
	if got := truncateNote("  two   lines\nof note ", 100); got != "two lines of note" {
		t.Fatalf("whitespace not collapsed: %q", got)
	}
	long := strings.Repeat("word ", 200)
	got := truncateNote(long, 50)
	if len(got) > 53 {
		t.Fatalf("note not bounded: %d chars", len(got))
	}
	if !strings.HasSuffix(got, "...") {
		t.Fatalf("truncated note should be marked: %q", got)
	}
}

func TestTaskPromptRunSpecGoalWins(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	p := taskPrompt(&waveobj.TaskGroup{}, &waveobj.TaskNode{ID: "t-1", Label: "label", RunSpec: waveobj.RunSpec{Goal: "explicit goal"}}, &owner, "claude", "", "")
	if !strings.Contains(p, "explicit goal") {
		t.Fatalf("runspec goal missing from prompt: %q", p)
	}
	if strings.Contains(p, "label") {
		t.Fatalf("label must not appear when runspec goal is set: %q", p)
	}
}

func allowWorkerHarnessForTest(t *testing.T) {
	t.Helper()
	old := validateWorkerHarness
	validateWorkerHarness = func(string) error { return nil }
	restoreAfterStages(t, func() { validateWorkerHarness = old })
	// reviewers and stage sessions are checked as leads; neither claude nor pi need be installed here
	oldLead := validateLeadHarness
	validateLeadHarness = func(string) error { return nil }
	restoreAfterStages(t, func() { validateLeadHarness = oldLead })
}

// capableLeadHarnessForTest checks a lead route's capability as production does and skips only the
// install probe, which a build machine may not satisfy.
func capableLeadHarnessForTest(t *testing.T) {
	t.Helper()
	old := validateLeadHarness
	validateLeadHarness = func(runtime string) error {
		_, err := harness.ValidateCapable(runtime, harness.OperationLead)
		return err
	}
	restoreAfterStages(t, func() { validateLeadHarness = old })
}

// a worker is named after its task: its ai-title would come from its first message, which for a prompt too long for a
// command line is the pointer to the prompt's file
func TestScheduleOnceLabelsAWorkerWithItsTask(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "engine-label-test", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "Chunk sidebar"},
		{ID: "t-1", Label: "Run sheet"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	labels := map[string]string{}
	old := spawnWorker
	spawnWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, opts jarvis.RunWorkerOptions) (string, error) {
		labels[opts.TaskId] = opts.Label
		return "tab:worker", nil
	}
	defer func() { spawnWorker = old }()

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if labels["t-0"] != "Chunk sidebar" || labels["t-1"] != "Run sheet" {
		t.Fatalf("labels = %v", labels)
	}
}

// A worker's tab reaches the app when its spawn returns, and it sits outside its run's tree until its run
// arrives. Publishing the run only at tick end left each tab outside for as long as the rest of the batch took.
func TestScheduleOncePublishesEachChildRunBeforeTheNextSpawn(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	t.Cleanup(func() { wps.Broker.SetClient(prevClient) })
	const subscriber = "schedule-run-update-order"
	wps.Broker.Subscribe(subscriber, wps.SubscriptionRequest{Event: wps.Event_WaveObjUpdate, AllScopes: true})
	t.Cleanup(func() { wps.Broker.Unsubscribe(subscriber, wps.Event_WaveObjUpdate) })

	ch, err := wstore.CreateChannel(ctx, "engine-publish-order", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	var runIDs []string
	firstPublished := false
	old := spawnWorker
	spawnWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, opts jarvis.RunWorkerOptions) (string, error) {
		if len(runIDs) == 1 {
			firstPublished = cc.saw(wps.Event_WaveObjUpdate, waveobj.MakeORef(waveobj.OType_Run, runIDs[0]).String())
		}
		runIDs = append(runIDs, opts.RunId)
		return "tab:worker-" + opts.TaskId, nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if len(runIDs) != 2 {
		t.Fatalf("want both tasks spawned in one tick, got %v", runIDs)
	}
	if !firstPublished {
		t.Fatal("the first child run was not published before the second task spawned")
	}
}

// a tick dispatches its tasks in sequence, and a slow one (a large checkout, a long Setup) must not spend the
// budget of the ones after it: run f15cd1a3 lost five tasks to "context deadline exceeded" that way
func TestScheduleOnceGivesEachDispatchItsOwnSpawnBudget(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "engine-test", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	const slowDispatch = 200 * time.Millisecond
	var budgets []time.Duration
	old := spawnWorker
	spawnWorker = func(ctx context.Context, _ runroute.Capability, _, _, _, _ string, opts jarvis.RunWorkerOptions) (string, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Errorf("task %s spawned with no deadline", opts.TaskId)
		}
		budgets = append(budgets, time.Until(deadline))
		time.Sleep(slowDispatch)
		return "tab:worker-" + opts.TaskId, nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if len(budgets) != 2 {
		t.Fatalf("want both tasks spawned in one tick, got %d", len(budgets))
	}
	if budgets[1] <= jarvis.RunWorkerSpawnTimeout-slowDispatch/2 {
		t.Fatalf("the second dispatch inherited the first one's spent budget: %v left of %v", budgets[1], jarvis.RunWorkerSpawnTimeout)
	}
}

func TestScheduleOnceSpawnsUpToCap(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "engine-test", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "c", Deps: []string{"t-0"}},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}

	var spawned []string
	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		spawned = append(spawned, prompt)
		return "tab:worker", nil
	}
	defer func() { spawnWorker = old }()

	// first step: only t-0 is ready (no deps), so exactly one spawn despite cap 2
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if len(spawned) != 1 {
		t.Fatalf("want 1 spawn (t-0), got %d", len(spawned))
	}
	if g.Tasks[0].State != TaskState_Running || g.Tasks[0].RunID == "" {
		t.Fatalf("t-0 must be running with a child run: %+v", g.Tasks[0])
	}
	child0 := g.Tasks[0].RunID

	// child t-0 completes; the next step derives done and spawns t-1 and t-2 (cap 2)
	if err := wstore.UpdateRun(ctx, ch.OID, child0, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if len(spawned) != 3 {
		t.Fatalf("want 2 more spawns (t-1, t-2), got %d total", len(spawned))
	}
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("t-0 must derive done, got %s", g.Tasks[0].State)
	}

	// third step: two running, nothing ready -> no spawns
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if len(spawned) != 3 {
		t.Fatalf("no new spawns expected, got %d", len(spawned))
	}
}

// TestScheduleOncePublishesCleanupTransitions: every persisted cleanup transition (pending→failed
// on a retry, failed→clear on a later retry) must emit a dag waveobj update carrying the matching
// task state, so the FE can render cleanup debt authoritatively. Regression net for the rule that
// the engine's cleanup outcome persists and publishes with the same tick.
func TestCleanupPublishTransitions(t *testing.T) {
	ctx := context.Background()
	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	defer wps.Broker.SetClient(prevClient)
	wps.Broker.Subscribe("cleanup-publish-test", wps.SubscriptionRequest{Event: wps.Event_WaveObjUpdate, AllScopes: true})
	defer wps.Broker.Unsubscribe("cleanup-publish-test", wps.Event_WaveObjUpdate)

	projectDir := newGitRepo(t)
	ch, err := wstore.CreateChannel(ctx, "cleanup-publish", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.BaseCommit = gitCmd(t, projectDir, "rev-parse", "HEAD")
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, true, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	// persisted merge identity + cleanup pending (version 2)
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State = TaskState_Done
		cur.Tasks[0].Merged = true
		cur.Tasks[0].CleanupPending = true
		RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	scope := waveobj.MakeORef(waveobj.OType_Dag, g.OID).String()
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))

	stubCleanupRemover(t, func(context.Context, string, string) error {
		return errors.New("still locked")
	})
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	persisted, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Tasks[0].CleanupPending || persisted.Tasks[0].CleanupError == "" {
		t.Fatalf("failed retry must persist debt, got pending=%v err=%q", persisted.Tasks[0].CleanupPending, persisted.Tasks[0].CleanupError)
	}

	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	states := cc.dagCleanupStates(scope)
	want := []string{"pending", "failed", "clear"}
	at := 0
	for _, state := range states {
		if at < len(want) && state == want[at] {
			at++
		}
	}
	if at != len(want) {
		t.Fatalf("cleanup publications = %v, want ordered %v", states, want)
	}
	final, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Tasks[0].CleanupPending || final.Tasks[0].CleanupError != "" {
		t.Fatalf("cleared retry must clear debt, got pending=%v err=%q", final.Tasks[0].CleanupPending, final.Tasks[0].CleanupError)
	}
	if final.Status != DagStatus_Done {
		t.Fatalf("merge-required dag with cleared debt must reach done, got %s", final.Status)
	}
}

func TestCleanupPersistsBeforeLaterScheduleFailure(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "cleanup-before-error", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup("missing-owner", ch.OID, "g", 1, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].State = TaskState_Done
	g.Tasks[0].Merged = true
	g.Tasks[0].CleanupPending = true
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })

	if err := Schedule(ctx, g.OID); err == nil || !strings.Contains(err.Error(), "loading owning run") {
		t.Fatalf("schedule error = %v, want missing owner", err)
	}
	stored, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Tasks[0].CleanupPending || stored.Tasks[0].CleanupError != "" {
		t.Fatalf("cleanup outcome was lost: pending=%v error=%q", stored.Tasks[0].CleanupPending, stored.Tasks[0].CleanupError)
	}
}

func TestScheduleOncePublishesChildDone(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	defer wps.Broker.SetClient(prevClient)
	wps.Broker.Subscribe("engine-events-test", wps.SubscriptionRequest{Event: DagEventTaskSpawned, AllScopes: true})
	wps.Broker.Subscribe("engine-events-test", wps.SubscriptionRequest{Event: DagEventChildDone, AllScopes: true})
	defer wps.Broker.Unsubscribe("engine-events-test", DagEventTaskSpawned)
	defer wps.Broker.Unsubscribe("engine-events-test", DagEventChildDone)

	ch, err := wstore.CreateChannel(ctx, "engine-events", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b", Deps: []string{"t-0"}},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}

	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		return "tab:worker", nil
	}
	defer func() { spawnWorker = old }()

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	child0 := g.Tasks[0].RunID
	scope := waveobj.MakeORef(waveobj.OType_Dag, g.OID).String()
	if !cc.saw(DagEventTaskSpawned, scope) {
		t.Fatal("task-spawned event not published")
	}
	// the spawn also lands on the owning run's lifecycle log, so its card timeline shows the task.
	events, err := wstore.QueryRunEvents(ctx, ch.OID, owner.ID, 50)
	if err != nil {
		t.Fatalf("query run events: %v", err)
	}
	var sawSpawn bool
	for _, e := range events {
		if e.Kind == waveobj.RunEventKindTaskSpawned {
			sawSpawn = true
		}
	}
	if !sawSpawn {
		t.Fatalf("expected task-spawned event on the owning run's log, got %+v", events)
	}

	if err := wstore.UpdateRun(ctx, ch.OID, child0, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if !cc.saw(DagEventChildDone, scope) {
		t.Fatal("child-done event not published on running->done transition")
	}
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("t-0 must derive done, got %s", g.Tasks[0].State)
	}
}

// the dispatch and first-activity timings are the whole point of chunk 3 on the orchestrator-cost
// tracker: a child's wall clock is otherwise one opaque span, and every claim about task size is a
// guess about which part of it is environment setup.
func TestScheduleStampsDispatchAndFirstActivityTimings(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	root := t.TempDir()
	prevRoot := sessionsRootFor
	sessionsRootFor = func(string) string { return root }
	defer func() { sessionsRootFor = prevRoot }()

	ch, err := wstore.CreateChannel(ctx, "engine-timing", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return "tab:worker", nil
	}
	defer func() { spawnWorker = old }()

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	spawnDetail := firstEventDetail(t, ctx, ch.OID, owner.ID, waveobj.RunEventKindTaskSpawned)
	for _, key := range []string{"worktreems", "spawnms"} {
		if _, ok := spawnDetail[key]; !ok {
			t.Fatalf("task-spawned must carry %q so dispatch cost is separable, got %+v", key, spawnDetail)
		}
	}
	if g.Tasks[0].FirstActivity != 0 {
		t.Fatalf("nothing has been read from the child yet, got firstactivity %d", g.Tasks[0].FirstActivity)
	}

	// the child writes its first transcript line; the next tick is the first that can observe it
	child, err := wstore.GetRun(ctx, ch.OID, g.Tasks[0].RunID)
	if err != nil {
		t.Fatal(err)
	}
	first := time.Now().Add(-1 * time.Minute)
	writeClaudeSession(t, root, ch.ProjectPath, child.SessionId, first)
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].FirstActivity != first.UnixMilli() {
		t.Fatalf("want firstactivity %d, got %d", first.UnixMilli(), g.Tasks[0].FirstActivity)
	}
	if d := firstEventDetail(t, ctx, ch.OID, owner.ID, waveobj.RunEventKindTaskFirstActivity); d["taskid"] != "t-0" {
		t.Fatalf("task-first-activity must name its task, got %+v", d)
	}

	// stamped once: a later write moves LastActivity, never FirstActivity, and emits no second row
	later := time.Now()
	writeClaudeSession(t, root, ch.ProjectPath, child.SessionId, later)
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].FirstActivity != first.UnixMilli() {
		t.Fatalf("firstactivity must not be revised, got %d", g.Tasks[0].FirstActivity)
	}
	if n := countEvents(t, ctx, ch.OID, owner.ID, waveobj.RunEventKindTaskFirstActivity); n != 1 {
		t.Fatalf("want exactly one task-first-activity row, got %d", n)
	}
}

func runEventsOfKind(t *testing.T, ctx context.Context, channelID, runID, kind string) []waveobj.RunEvent {
	t.Helper()
	events, err := wstore.QueryRunEvents(ctx, channelID, runID, 100)
	if err != nil {
		t.Fatalf("query run events: %v", err)
	}
	var out []waveobj.RunEvent
	for _, e := range events {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

func countEvents(t *testing.T, ctx context.Context, channelID, runID, kind string) int {
	t.Helper()
	return len(runEventsOfKind(t, ctx, channelID, runID, kind))
}

func firstEventDetail(t *testing.T, ctx context.Context, channelID, runID, kind string) map[string]any {
	t.Helper()
	rows := runEventsOfKind(t, ctx, channelID, runID, kind)
	if len(rows) == 0 {
		t.Fatalf("no %s event on run %s", kind, runID)
	}
	var detail map[string]any
	if err := json.Unmarshal(rows[0].Detail, &detail); err != nil {
		t.Fatalf("unmarshal %s detail: %v", kind, err)
	}
	return detail
}

func TestScheduleOnceUsesTaskRouteForSpawnAndChild(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "route-task", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Runtime = "claude"
	owner.Model = "sonnet"
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{
		ID: "t-0", Label: "pi task", RunSpec: waveobj.RunSpec{Runtime: "pi", Model: "opencode/deepseek-v4-pro"},
	}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	var gotCap runroute.Capability
	old := spawnWorker
	spawnWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		gotCap = cap
		return "tab:worker", nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if gotCap.Runtime != "pi" || gotCap.Model != "opencode/deepseek-v4-pro" || len(gotCap.ModelArgs) != 2 || gotCap.ModelArgs[1] != "opencode/deepseek-v4-pro" {
		t.Fatalf("spawn capability = %+v, want the task's pinned pi model", gotCap)
	}
	child, err := wstore.GetRun(ctx, ch.OID, g.Tasks[0].RunID)
	if err != nil {
		t.Fatal(err)
	}
	if child.Runtime != "pi" || child.Model != "opencode/deepseek-v4-pro" {
		t.Fatalf("child route = %s/%s, want the task's pinned pi model", child.Runtime, child.Model)
	}
}

func TestScheduleOnceRejectsUnavailableTaskRouteBeforeSpawn(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "route-unavailable", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Runtime = "claude"
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{
		ID: "t-0", Label: "a", RunSpec: waveobj.RunSpec{Runtime: "pi", Model: "opencode/deepseek-v4-pro"},
	}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	oldValidate := validateWorkerHarness
	validateWorkerHarness = func(string) error { return errors.New("unavailable") }
	restoreAfterStages(t, func() { validateWorkerHarness = oldValidate })
	spawned := 0
	oldSpawn := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		spawned++
		return "tab:worker", nil
	}
	restoreAfterStages(t, func() { spawnWorker = oldSpawn })

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Failed || spawned != 0 || g.Tasks[0].RunID != "" {
		t.Fatalf("unavailable route state=%s run=%q spawned=%d", g.Tasks[0].State, g.Tasks[0].RunID, spawned)
	}
}

func TestScheduleOnceLegacyRuntimeOnlyAndInheritedRoutes(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "route-legacy", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Runtime = "pi"
	owner.Model = "opencode/deepseek-v4-pro"
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{
		{ID: "legacy", Label: "legacy", RunSpec: waveobj.RunSpec{Runtime: "claude"}},
		{ID: "inherited", Label: "inherited"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	caps := map[string]runroute.Capability{}
	old := spawnWorker
	spawnWorker = func(_ context.Context, cap runroute.Capability, _, _, _, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		if strings.Contains(prompt, "legacy") {
			caps["legacy"] = cap
		} else {
			caps["inherited"] = cap
		}
		return "tab:worker", nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"legacy", "inherited"} {
		task := taskByID(&g, id)
		child, cerr := wstore.GetRun(ctx, ch.OID, task.RunID)
		if cerr != nil {
			t.Fatal(cerr)
		}
		if id == "legacy" {
			// a runtime-only task pin is that runtime's default, never the owner's model
			if caps[id].Runtime != "claude" || caps[id].Model != "" || child.Runtime != "claude" || child.Model != "" {
				t.Fatalf("legacy route = cap %+v child %s/%s, want the claude default", caps[id], child.Runtime, child.Model)
			}
		} else if caps[id].Runtime != "pi" || caps[id].Model != owner.Model || child.Runtime != "pi" || child.Model != owner.Model {
			t.Fatalf("inherited route = cap %+v child %s/%s, want the owner's pi model", caps[id], child.Runtime, child.Model)
		}
	}
}

func TestSchedulePersistsSpawnedWorkerOwnership(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)
	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	t.Cleanup(func() { wps.Broker.SetClient(prevClient) })
	const subscriber = "schedule-child-run-updates"
	wps.Broker.Subscribe(subscriber, wps.SubscriptionRequest{Event: wps.Event_WaveObjUpdate, AllScopes: true})
	t.Cleanup(func() { wps.Broker.Unsubscribe(subscriber, wps.Event_WaveObjUpdate) })
	workerTabID := uuid.NewString()
	worker := waveobj.MakeORef(waveobj.OType_Tab, workerTabID).String()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: workerTabID}); err != nil {
		t.Fatal(err)
	}
	stubSpawnWorker(t, worker, nil)
	if err := Schedule(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	if len(got.Tasks) == 0 || got.Tasks[0].RunID == "" {
		t.Fatalf("dag task not running: %+v", got.Tasks)
	}
	child, _ := wstore.GetRun(ctx, got.ChannelId, got.Tasks[0].RunID)
	if len(child.Phases) == 0 || len(child.Phases[0].WorkerOrefs) != 1 || child.Phases[0].WorkerOrefs[0] != worker {
		t.Fatalf("worker ownership = %+v, want %s", child.Phases, worker)
	}
	runORef, channelORef, err := wstore.GetWorkerOwner(ctx, worker)
	if err != nil {
		t.Fatal(err)
	}
	if runORef != waveobj.MakeORef(waveobj.OType_Run, child.ID).String() || channelORef != waveobj.MakeORef(waveobj.OType_Channel, dag.ChannelId).String() {
		t.Fatalf("worker owner metadata = %q/%q", runORef, channelORef)
	}
	if !cc.saw(wps.Event_WaveObjUpdate, waveobj.MakeORef(waveobj.OType_Run, child.ID).String()) ||
		!cc.saw(wps.Event_WaveObjUpdate, waveobj.MakeORef(waveobj.OType_Channel, dag.ChannelId).String()) {
		t.Fatal("committed child Run/channel updates were not published")
	}
}

func TestScheduleStopsWorkerWhenChildPersistFails(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)
	worker := waveobj.MakeORef(waveobj.OType_Tab, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").String()
	stubSpawnWorker(t, worker, nil)
	stopped := false
	oldAppend, oldStop := appendChildRun, stopSpawnedWorker
	appendChildRun = func(context.Context, string, waveobj.Run) error { return errors.New("persist failed") }
	stopSpawnedWorker = func(context.Context, string) error { stopped = true; return nil }
	restoreAfterStages(t, func() { appendChildRun, stopSpawnedWorker = oldAppend, oldStop })
	err := Schedule(ctx, dag.OID)
	if err == nil || !strings.Contains(err.Error(), "persist failed") {
		t.Fatalf("want persist failed error, got %v", err)
	}
	if !stopped {
		t.Fatal("worker not stopped on persist failure")
	}
}

func TestScheduleCleansAllWorkersWhenLaterChildPersistFails(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)
	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	t.Cleanup(func() { wps.Broker.SetClient(prevClient) })
	const subscriber = "schedule-child-cleanup-updates"
	wps.Broker.Subscribe(subscriber, wps.SubscriptionRequest{Event: wps.Event_WaveObjUpdate, AllScopes: true})
	t.Cleanup(func() { wps.Broker.Unsubscribe(subscriber, wps.Event_WaveObjUpdate) })
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Parallelism = 2
		g.Tasks = append(g.Tasks, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending})
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	oldSpawn, oldAppend, oldStop, oldStamp := spawnWorker, appendChildRun, stopSpawnedWorker, stampSpawnedWorker
	var spawnCalls int
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		spawnCalls++
		return fmt.Sprintf("tab:worker-%d", spawnCalls), nil
	}
	var persisted []waveobj.Run
	appendCalls := 0
	appendChildRun = func(ctx context.Context, channelID string, run waveobj.Run) error {
		appendCalls++
		if appendCalls == 2 {
			return errors.New("second child persist failed")
		}
		if err := oldAppend(ctx, channelID, run); err != nil {
			return err
		}
		persisted = append(persisted, run)
		return nil
	}
	var stopped []string
	stopSpawnedWorker = func(_ context.Context, oref string) error {
		stopped = append(stopped, oref)
		return nil
	}
	stampSpawnedWorker = func(context.Context, string, string, string) error { return nil }
	restoreAfterStages(t, func() {
		spawnWorker, appendChildRun, stopSpawnedWorker, stampSpawnedWorker = oldSpawn, oldAppend, oldStop, oldStamp
	})

	err := Schedule(ctx, dag.OID)
	if err == nil || !strings.Contains(err.Error(), "second child persist failed") {
		t.Fatalf("schedule error = %v, want second child persistence failure", err)
	}
	if len(stopped) != 2 {
		t.Fatalf("stopped workers = %v, want both spawned workers", stopped)
	}
	if len(persisted) != 1 {
		t.Fatalf("persisted children = %d, want 1", len(persisted))
	}
	child, err := wstore.GetRun(ctx, dag.ChannelId, persisted[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if child.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("persisted child status = %q, want cancelled", child.Status)
	}
	if !cc.saw(wps.Event_WaveObjUpdate, waveobj.MakeORef(waveobj.OType_Run, child.ID).String()) ||
		!cc.saw(wps.Event_WaveObjUpdate, waveobj.MakeORef(waveobj.OType_Channel, dag.ChannelId).String()) {
		t.Fatal("compensated child Run/channel updates were not published")
	}
	got, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range got.Tasks {
		if task.State != TaskState_Failed || task.RunID != "" {
			t.Fatalf("task %s cleanup = state %q run %q, want failed with no run", task.ID, task.State, task.RunID)
		}
	}
}

// A tick that fails partway has to clean up the workers it already spawned, on a context that still
// works. The trigger used to be cancelling the caller mid-tick, which a detached tick now ignores by
// design (see TestScheduleRecordsASpawnEvenWhenTheCallerGaveUp); the invariant is reached here through a
// second task whose child run will not persist, so the first task's worker is the one needing cleanup.
func TestSchedulePersistenceFailureCancelsTheWorkerItAlreadySpawned(t *testing.T) {
	baseCtx := context.Background()
	allowWorkerHarnessForTest(t)
	ch, err := wstore.CreateChannel(baseCtx, "schedule-persist-failure", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 2)
	if err := wstore.AppendRun(baseCtx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	dagGroup, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(baseCtx, &dagGroup); err != nil {
		t.Fatal(err)
	}
	dag := &dagGroup
	worker := "tab:worker-detached-cleanup"
	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	t.Cleanup(func() { wps.Broker.SetClient(prevClient) })
	const subscriber = "schedule-persist-failure-events"
	wps.Broker.Subscribe(subscriber, wps.SubscriptionRequest{Event: DagEventTaskSpawned, AllScopes: true})
	t.Cleanup(func() { wps.Broker.Unsubscribe(subscriber, DagEventTaskSpawned) })

	oldAppend, oldStop, oldStamp := appendChildRun, stopSpawnedWorker, stampSpawnedWorker
	var childID string
	appendChildRun = func(ctx context.Context, channelID string, run waveobj.Run) error {
		if childID != "" {
			return errors.New("child run persist failed")
		}
		if err := oldAppend(ctx, channelID, run); err != nil {
			return err
		}
		childID = run.ID
		return nil
	}
	stopSpawnedWorker = func(context.Context, string) error { return nil }
	stampSpawnedWorker = func(context.Context, string, string, string) error { return nil }
	restoreAfterStages(t, func() {
		appendChildRun, stopSpawnedWorker, stampSpawnedWorker = oldAppend, oldStop, oldStamp
	})
	stubSpawnWorker(t, worker, nil)

	err = Schedule(baseCtx, dag.OID)
	if err == nil {
		t.Fatal("want the persistence failure surfaced")
	}
	scope := waveobj.MakeORef(waveobj.OType_Dag, dag.OID).String()
	if cc.saw(DagEventTaskSpawned, scope) {
		t.Fatal("task-spawned event published before DAG persistence")
	}
	child, getErr := wstore.GetRun(baseCtx, dag.ChannelId, childID)
	if getErr != nil {
		t.Fatal(getErr)
	}
	if child.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("child status = %q, want cancelled", child.Status)
	}
	got, getErr := wstore.GetDag(baseCtx, dag.OID)
	if getErr != nil {
		t.Fatal(getErr)
	}
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].RunID != "" {
		t.Fatalf("task cleanup = state %q run %q, want failed with no run", got.Tasks[0].State, got.Tasks[0].RunID)
	}
}

func TestScheduleResetsFailureStateForEveryParallelSuccess(t *testing.T) {
	h := newChildOutcomeHarness(t, 2)
	g := h.loadDag(t)
	for i := range g.Tasks {
		g.Tasks[i].Attempts = i + 1
		g.Tasks[i].LastFailureKind = FailureKindToolError
		if err := wstore.UpdateRun(h.ctx, h.channel, g.Tasks[i].RunID, func(run *waveobj.Run) error {
			run.Status = jarvis.RunStatus_Done
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := wstore.UpdateDag(h.ctx, h.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Failures = 2
		for i := range cur.Tasks {
			cur.Tasks[i].Attempts = g.Tasks[i].Attempts
			cur.Tasks[i].LastFailureKind = g.Tasks[i].LastFailureKind
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := Schedule(h.ctx, h.dagID); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	for _, task := range got.Tasks {
		if task.State != TaskState_Done || task.Attempts != 0 || task.LastFailureKind != "" {
			t.Fatalf("successful task retained failure state: %+v", task)
		}
	}
	if got.Failures != 0 {
		t.Fatalf("failure streak = %d, want 0", got.Failures)
	}
}

func TestShouldCloseOrchestratorLead(t *testing.T) {
	tests := []struct {
		name string
		run  waveobj.Run
		dag  waveobj.TaskGroup
		want bool
	}{
		{
			name: "running dag keeps lead",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Executing, Phases: []waveobj.RunPhase{{State: jarvis.PhaseState_Running}}},
			dag:  waveobj.TaskGroup{Status: "running", Tasks: []waveobj.TaskNode{{ID: "t-0", State: TaskState_Running}}},
			want: false,
		},
		{
			name: "orchestrator done + dag done closes",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Done, Phases: []waveobj.RunPhase{{State: jarvis.PhaseState_Done}}},
			dag:  waveobj.TaskGroup{Status: "done", Tasks: []waveobj.TaskNode{{ID: "t-0", State: TaskState_Done}}},
			want: true,
		},
		{
			name: "orchestrator done but dag still running keeps",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Done},
			dag:  waveobj.TaskGroup{Status: "running", Tasks: []waveobj.TaskNode{{ID: "t-0", State: TaskState_Running}}},
			want: false,
		},
		{
			name: "pipeline done never closes via orchestrator path",
			run:  waveobj.Run{Mode: jarvis.RunMode_Pipeline, Status: jarvis.RunStatus_Done},
			dag:  waveobj.TaskGroup{Status: "done"},
			want: false,
		},
		{
			// a human landed the run past its failed final stage: the dag stays blocked on that failure, but
			// nothing is left for the lead to triage (run 9bd1b7ec kept its idle lead tab for hours)
			name: "done run landed past a blocked dag closes",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: LandState_Landed}},
			dag:  waveobj.TaskGroup{Status: DagStatus_Blocked, Final: &waveobj.FinalStage{State: FinalState_Failed}, Tasks: []waveobj.TaskNode{{ID: "t-1", State: TaskState_Done}}},
			want: true,
		},
		{
			name: "done run with a held land keeps the lead on a blocked dag",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: LandState_Held}},
			dag:  waveobj.TaskGroup{Status: DagStatus_Blocked, Final: &waveobj.FinalStage{State: FinalState_Failed}, Tasks: []waveobj.TaskNode{{ID: "t-1", State: TaskState_Done}}},
			want: false,
		},
		{
			name: "done run not landed keeps the lead on a blocked dag",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Done},
			dag:  waveobj.TaskGroup{Status: DagStatus_Blocked, Final: &waveobj.FinalStage{State: FinalState_Failed}, Tasks: []waveobj.TaskNode{{ID: "t-1", State: TaskState_Done}}},
			want: false,
		},
		{
			name: "cancelled orchestrator + dag cancelled closes",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Cancelled},
			dag:  waveobj.TaskGroup{Status: "cancelled", Tasks: []waveobj.TaskNode{{ID: "t-0", State: TaskState_Cancelled}}},
			want: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ShouldCloseOrchestratorLead(&tc.run, &tc.dag); got != tc.want {
				t.Errorf("ShouldCloseOrchestratorLead = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMaybeCloseOrchestratorLead(t *testing.T) {
	ctx := context.Background()
	run := &waveobj.Run{
		Mode:        jarvis.RunMode_Orchestrator,
		Status:      jarvis.RunStatus_Done,
		WorkspaceId: "ws-1",
		Phases:      []waveobj.RunPhase{{WorkerOrefs: []string{"tab:lead-tab"}}},
	}
	dagDone := &waveobj.TaskGroup{Status: DagStatus_Done, Tasks: []waveobj.TaskNode{{ID: "t-0", State: TaskState_Done}}}
	dagRunning := &waveobj.TaskGroup{Status: DagStatus_Running, Tasks: []waveobj.TaskNode{{ID: "t-0", State: TaskState_Running}}}

	// should close when done
	called := false
	orig := deleteLeadTab
	deleteLeadTab = func(_ context.Context, ws, tab string) error {
		called = true
		if ws != "ws-1" || tab != "lead-tab" {
			t.Fatalf("delete args ws=%q tab=%q, want ws-1/lead-tab", ws, tab)
		}
		return nil
	}
	restoreAfterStages(t, func() { deleteLeadTab = orig })
	ok, err := MaybeCloseOrchestratorLead(ctx, run, dagDone)
	if err != nil || !ok || !called {
		t.Fatalf("should close done dag: ok=%v err=%v called=%v", ok, err, called)
	}
	// should NOT close while dag still running
	called = false
	ok, err = MaybeCloseOrchestratorLead(ctx, run, dagRunning)
	if err != nil || ok || called {
		t.Fatalf("should keep running dag: ok=%v err=%v called=%v", ok, err, called)
	}
	// pipeline never closes via this path
	pipeRun := &waveobj.Run{Mode: jarvis.RunMode_Pipeline, Status: jarvis.RunStatus_Done, WorkspaceId: "ws-1", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:lead-tab"}}}}
	called = false
	ok, err = MaybeCloseOrchestratorLead(ctx, pipeRun, dagDone)
	if err != nil || ok || called {
		t.Fatalf("pipeline should not close: ok=%v", ok)
	}
}

func stubSpawnWorker(t *testing.T, worker string, err error) {
	t.Helper()
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return worker, err
	}
	restoreAfterStages(t, func() { spawnWorker = old })
}

// The worker process is spawned on a detached context, so the row recording it must be too. Persisting
// on the caller's budget is what leaves a live claude.exe with no run row: the task fails
// dispatch-unrecorded, its RunID is cleared, and nothing can ever find that process to reap it.
func TestScheduleRecordsASpawnEvenWhenTheCallerGaveUp(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "engine-detach", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	stubSpawnWorker(t, "tab:worker", nil)

	var persistErr error
	persisted := false
	oldAppend := appendChildRun
	appendChildRun = func(runCtx context.Context, channelID string, run waveobj.Run) error {
		persistErr = runCtx.Err()
		persisted = true
		return wstore.AppendRun(runCtx, channelID, run)
	}
	restoreAfterStages(t, func() { appendChildRun = oldAppend })

	// the client gave up before the tick ran, exactly as a timed-out CreateRun RPC leaves its handler
	dead, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Schedule(dead, g.OID); err != nil {
		t.Fatalf("a tick must not fail because its caller went away: %v", err)
	}
	if !persisted {
		t.Fatal("the child run was never persisted")
	}
	if persistErr != nil {
		t.Fatalf("child run persisted on a dead context: %v", persistErr)
	}
	stored, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Tasks[0].State != TaskState_Running || stored.Tasks[0].RunID == "" {
		t.Fatalf("t-0 must be running with a recorded child run, got state %q runid %q", stored.Tasks[0].State, stored.Tasks[0].RunID)
	}
}

// spendDispatchRetries leaves a dag's first task with its automatic dispatch retries used up, so its next spawn
// failure is terminal.
func spendDispatchRetries(t *testing.T, ctx context.Context, dagID string) {
	t.Helper()
	if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].Attempts, cur.Tasks[0].LastFailureKind = MaxAutoDispatchRetries, FailureKindSpawn
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// stubFlakySpawn fails the first failures spawns and returns how many were asked for.
func stubFlakySpawn(t *testing.T, failures int) *int {
	t.Helper()
	calls := 0
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		calls++
		if calls <= failures {
			return "", errors.New("creating worker tab: workspace ws-1 not found: context deadline exceeded")
		}
		return "tab:worker", nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })
	return &calls
}

// runs 810fbc02, d86eec09 and f15cd1a3: a spawn that missed its deadline failed the task, and the lead retried it by
// hand up to 29 minutes later
func TestDispatchFailureIsRetriedOnTheNextTick(t *testing.T) {
	allowWorkerHarnessForTest(t)
	f := newFakeLead(t)
	timedEventsReachTheFakeLead(t)
	ctx, g, _, _ := seedDispatchDag(t, "dispatch-retry-once")
	calls := stubFlakySpawn(t, 1)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if task := g.Tasks[0]; task.State != TaskState_Pending || task.RunID != "" || task.Attempts != 1 {
		t.Fatalf("a failed dispatch waits for the next tick, got state=%s run=%q attempts=%d", task.State, task.RunID, task.Attempts)
	}
	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if task := g.Tasks[0]; task.State != TaskState_Running || task.RunID == "" || *calls != 2 {
		t.Fatalf("the second dispatch runs the task, got state=%s run=%q spawns=%d", task.State, task.RunID, *calls)
	}
	if len(f.sends) != 0 || f.countKind(waveobj.RunEventKindTaskFailed) != 0 {
		t.Fatalf("a dispatch the engine retried neither fails the task nor wakes the lead, sends=%q rows=%+v", f.sends, f.rows)
	}
	var retried map[string]any
	for _, r := range f.rows {
		if r["eventkind"] == waveobj.RunEventKindTaskRetried {
			retried = r
		}
	}
	if f.countKind(waveobj.RunEventKindTaskRetried) != 1 || retried["auto"] != true || retried["kind"] != FailureKindSpawn || retried["attempt"] != 1 {
		t.Fatalf("want one automatic spawn-failed retry, got %+v", f.rows)
	}
}

func TestDispatchThatKeepsFailingFailsAfterItsRetries(t *testing.T) {
	allowWorkerHarnessForTest(t)
	f := newFakeLead(t)
	timedEventsReachTheFakeLead(t)
	ctx, g, _, _ := seedDispatchDag(t, "dispatch-retry-spent")
	const never = 1 << 30
	calls := stubFlakySpawn(t, never)

	// one tick past the terminal failure: a failed task is not dispatched again
	for range MaxAutoDispatchRetries + 2 {
		if err := ScheduleOnce(ctx, g); err != nil {
			t.Fatal(err)
		}
	}
	if task := g.Tasks[0]; task.State != TaskState_Failed || task.LastFailureKind != FailureKindSpawn || *calls != MaxAutoDispatchRetries+1 {
		t.Fatalf("want failed (spawn-failed) after %d dispatches, got state=%s kind=%s spawns=%d", MaxAutoDispatchRetries+1, task.State, task.LastFailureKind, *calls)
	}
	if n := f.countKind(waveobj.RunEventKindTaskRetried); n != MaxAutoDispatchRetries {
		t.Fatalf("want %d task-retried events, got %d", MaxAutoDispatchRetries, n)
	}
	want := "wake: task t-0 failed (spawn-failed), retry spent. wsh jarvis dag status"
	if len(f.sends) != 1 || f.sends[0] != want || f.countKind(waveobj.RunEventKindTaskFailed) != 1 {
		t.Fatalf("want one failure and one wake %q, got sends=%q rows=%+v", want, f.sends, f.rows)
	}
}

// stalledNoLead is seedSilentChild with the run's lead process gone, so its task stalls on the next tick
// with nobody to judge it.
func stalledNoLead(t *testing.T, name string, alive bool) (*fakeLead, context.Context, *waveobj.TaskGroup, string) {
	t.Helper()
	f := newFakeLead(t)
	f.state.Alive = alive
	ctx, g := seedSilentChild(t, name)
	return f, ctx, g, mustLoadDag(t, ctx, g.OID).Tasks[0].RunID
}

func TestStalledTaskAutoRetriesWithoutALead(t *testing.T) {
	f, ctx, g, oldRun := stalledNoLead(t, "auto-retry", false)
	stubSpawnWorker(t, "tab:retry-worker", nil)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	task := g.Tasks[0]
	if task.StallRetries != 1 || task.Attempts != 0 {
		t.Fatalf("want one stall retry and the failure streak untouched, got stallretries=%d attempts=%d", task.StallRetries, task.Attempts)
	}
	if task.State != TaskState_Running || task.RunID == "" || task.RunID == oldRun {
		t.Fatalf("the retried task is dispatched again under a new run, got state=%s run=%q (was %q)", task.State, task.RunID, oldRun)
	}
	if old, err := wstore.GetRun(ctx, g.ChannelId, oldRun); err != nil || old.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("the stalled child run is cancelled, got %+v err=%v", old, err)
	}
	if n := f.countKind(waveobj.RunEventKindTaskRetried); n != 1 {
		t.Fatalf("want one task-retried event, got %d", n)
	}
	if len(f.sends) != 0 {
		t.Fatalf("a task the engine retried does not wake a lead, got %q", f.sends)
	}
}

// the exit path reports idle too, but a dead worker has no prompt to sit at with finished work: with no lead
// alive its stall is still the engine's to retry
func TestStalledDeadWorkerAutoRetriesDespiteItsExitIdle(t *testing.T) {
	f, ctx, g, oldRun := stalledNoLead(t, "auto-retry-exit-idle", false)
	stubSpawnWorker(t, "tab:retry-worker", nil)
	const deadBlock = "7e1f0c2d-3b4a-4c5d-8e6f-9a0b1c2d3e4f"
	wps.Broker.Publish(blockcontroller.AgentStatusEvent(deadBlock, baseds.AgentState_Idle, "pi", time.Now().Add(-time.Hour).UnixMilli()))
	prev := workerBlockFn
	workerBlockFn = func(context.Context, *waveobj.Run) (string, bool) { return deadBlock, false }
	t.Cleanup(func() { workerBlockFn = prev })

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if task := g.Tasks[0]; task.StallRetries != 1 || task.RunID == oldRun {
		t.Fatalf("a dead worker's stall is retried with no lead, got stallretries=%d run=%q (was %q)", task.StallRetries, task.RunID, oldRun)
	}
	if len(f.sends) != 0 {
		t.Fatalf("a task the engine retried does not wake a lead, got %q", f.sends)
	}
}

func TestAutoRetryStalledReturnsTheTaskToPending(t *testing.T) {
	_, ctx, g, runID := stalledNoLead(t, "auto-retry-pending", false)
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State = TaskState_Stalled
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if !autoRetryStalled(ctx, g.OID, stalledTask{taskID: "t-0", runID: runID}) {
		t.Fatal("a stalled task with no live lead is retried")
	}
	if got := mustLoadDag(t, ctx, g.OID).Tasks[0]; got.State != TaskState_Pending || got.RunID != "" || got.StallRetries != 1 {
		t.Fatalf("want pending with no run and one stall retry, got %+v", got)
	}
}

func TestStalledTaskWithALiveLeadIsNotAutoRetried(t *testing.T) {
	f, ctx, g, oldRun := stalledNoLead(t, "auto-retry-live-lead", true)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	task := g.Tasks[0]
	if task.State != TaskState_Stalled || task.StallRetries != 0 || task.RunID != oldRun {
		t.Fatalf("a live lead judges the stall, got state=%s stallretries=%d run=%q", task.State, task.StallRetries, task.RunID)
	}
	if n := f.countKind(waveobj.RunEventKindTaskRetried); n != 0 {
		t.Fatalf("want no task-retried event, got %d", n)
	}
}

func TestStalledTaskAutoRetriesOnlyOnce(t *testing.T) {
	f, ctx, g, oldRun := stalledNoLead(t, "auto-retry-once", false)
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].StallRetries = MaxAutoStallRetries
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	task := g.Tasks[0]
	if task.State != TaskState_Stalled || task.StallRetries != MaxAutoStallRetries || task.RunID != oldRun {
		t.Fatalf("a task already auto-retried waits for a human, got state=%s stallretries=%d run=%q", task.State, task.StallRetries, task.RunID)
	}
	if n := f.countKind(waveobj.RunEventKindTaskRetried); n != 0 {
		t.Fatalf("want no task-retried event, got %d", n)
	}
}

// a machine restart leaves the child run running with a frozen transcript and no controller to relaunch the
// worker; the task must not wait out StallThreshold to be noticed. The transcript here is fresh, so only the
// missing controller can stall it.
func TestRunningTaskWithNoControllerGoesStalled(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	oldRoot, oldGone := sessionsRootFor, workerControllerGone
	root := t.TempDir()
	sessionsRootFor = func(string) string { return root }
	defer func() { sessionsRootFor, workerControllerGone = oldRoot, oldGone }()

	ch, err := wstore.CreateChannel(ctx, "no-controller", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	writeClaudeSession(t, root, ch.ProjectPath, liveSession, time.Now())
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.ID = "33333333-3333-4333-8333-333333333333"
	child.Runtime = "claude"
	child.DagORef = g.OID
	child.SessionId = liveSession
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID = child.ID
	g.Tasks[0].State = TaskState_Running
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = g
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	workerControllerGone = func(context.Context, *waveobj.Run) bool { return false }
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Running {
		t.Fatalf("a live controller must leave the task running, got %s", g.Tasks[0].State)
	}

	newFakeLead(t).state.Alive = true // a lead-free stall would be auto-retried, which this test is not about
	workerControllerGone = func(context.Context, *waveobj.Run) bool { return true }
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Stalled {
		t.Fatalf("a running task whose controller is gone must stall, got %s", g.Tasks[0].State)
	}
}

func TestWorkerContractNamesTheReviewerAndTheLead(t *testing.T) {
	c := workerContract(&waveobj.TaskGroup{}, &waveobj.TaskNode{ID: "t-1"}, "claude", "")
	for _, want := range []string{"A reviewer checks your commit against this task and the spec", "the lead reads your report", "what a later task must know"} {
		if !strings.Contains(c, want) {
			t.Fatalf("contract missing %q: %q", want, c)
		}
	}
}

// the seal takes the run's report as its summary, so a worker that completes and only then writes its
// final message leaves the seal with whatever line came before `complete`
func TestWorkerContractSealsTheReportFromAFile(t *testing.T) {
	g := &waveobj.TaskGroup{OID: "dag-1"}
	task := &waveobj.TaskNode{ID: "t-2"}
	c := workerContract(g, task, "claude", "")
	path := WorkerReportPath(g.OID, task.ID)
	for _, want := range []string{
		"--report " + path,
		"`wsh jarvis complete --commit $(git rev-parse HEAD) --report " + path + "`",
		jarvis.WorkerReportTemplate,
		"Nothing goes before the first heading",
		"a failure that predates your task goes under Found not fixed",
		"edit tool",
	} {
		if !strings.Contains(c, want) {
			t.Fatalf("contract missing %q:\n%s", want, c)
		}
	}
	if strings.Contains(c, "reads your final message") {
		t.Fatalf("the report comes from the file, not the final message:\n%s", c)
	}
}

func TestWorkerReportPathIsPerTaskOutsideTheTree(t *testing.T) {
	p := WorkerReportPath("dag-1", "t-2")
	if want := filepath.ToSlash(filepath.Join(os.TempDir(), "arc-reports", "dag-1", "t-2.md")); p != want {
		t.Fatalf("WorkerReportPath = %q, want %q", p, want)
	}
	// Git Bash eats unquoted backslashes, so the path the brief puts on a command line has none
	if strings.Contains(p, "\\") {
		t.Fatalf("report path must use forward slashes: %q", p)
	}
}

func TestTaskPromptCarriesReviewFindingsAndGuidance(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	task := &waveobj.TaskNode{
		ID: "t-1", Label: "add fmtDate",
		ReviewVerdict: ReviewVerdict_Fail, ReviewCommit: "work111", ReviewNote: "misses the empty-input case",
		LeadGuidance: "reuse parseDate",
	}
	p := taskPrompt(&waveobj.TaskGroup{}, task, &owner, "claude", "", "")
	for _, want := range []string{
		"A reviewer rejected the previous attempt (commit work111): misses the empty-input case",
		"Fix these on top of that commit; don't restart.",
		"The lead's guidance: reuse parseDate",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt missing %q: %q", want, p)
		}
	}
	passed := &waveobj.TaskNode{ID: "t-2", Label: "x", ReviewVerdict: ReviewVerdict_Pass, ReviewNote: "fine", ReviewCommit: "c"}
	if strings.Contains(taskPrompt(&waveobj.TaskGroup{}, passed, &owner, "claude", "", ""), "rejected") {
		t.Fatal("a passed review carries no findings")
	}
}

func TestWorkerContractNamesABrokenBase(t *testing.T) {
	g := mustGroup(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	g.Check = "tsc"
	if strings.Contains(workerContract(g, &g.Tasks[0], "claude", ""), "already fails on the base") {
		t.Fatal("no base note before the base Check failed")
	}
	g.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Failed, Detail: "exit 2: error TS2307"}
	c := workerContract(g, &g.Tasks[0], "claude", "")
	if !strings.Contains(c, "`tsc` already fails on the base, before any task (exit 2: error TS2307)") {
		t.Fatalf("the contract names the base failure, got %q", c)
	}
	if !strings.Contains(c, "name them under Found not fixed in your report") {
		t.Fatalf("the base-failure sentence must point at Found not fixed, got %q", c)
	}
}

// a serial batch takes seconds per spawn, and stamping each task-spawned at the batch's commit bunches every
// spawn on the timeline at the end of the batch
func TestTaskSpawnedCarriesEachTasksOwnSpawnTime(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx, g, channelID, runID := seedTwoTaskDispatchDag(t, "spawn-stamps")
	var returned []int64
	start := time.Now().UnixMilli()
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		time.Sleep(50 * time.Millisecond)
		returned = append(returned, time.Now().UnixMilli())
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	var stamps []int64
	for _, ev := range lifecycleEvents(t, channelID, runID) {
		if ev.Kind == waveobj.RunEventKindTaskSpawned {
			stamps = append(stamps, ev.Ts)
		}
	}
	if len(stamps) != 2 || len(returned) != 2 {
		t.Fatalf("want two spawns, got stamps %v returned %v", stamps, returned)
	}
	sort.Slice(stamps, func(i, j int) bool { return stamps[i] < stamps[j] })
	// the stub and the engine read the clock separately, so a stamp may trail its return by a millisecond, but
	// never reach the next spawn's return: a batch-end stamp lands after the last one
	if stamps[0] < returned[0] || stamps[0] >= returned[1] {
		t.Fatalf("first task-spawned stamped %d, want in [%d, %d)", stamps[0], returned[0], returned[1])
	}
	if stamps[1] < returned[1] {
		t.Fatalf("second task-spawned stamped %d, before its spawn returned at %d", stamps[1], returned[1])
	}
	// stamped at the spawn, not at the write after the tick's commit
	dag := mustLoadDag(t, ctx, g.OID)
	if stamps[1] > dag.UpdatedTs || stamps[0] < start {
		t.Fatalf("stamps %v must fall between the tick's start %d and its commit %d", stamps, start, dag.UpdatedTs)
	}
}

// ScheduleOnce is a compatibility wrapper for callers that still hold a TaskGroup snapshot.
func ScheduleOnce(ctx context.Context, g *waveobj.TaskGroup) error {
	if g == nil {
		return fmt.Errorf("dag is required")
	}
	if err := Schedule(ctx, g.OID); err != nil {
		return err
	}
	// keep the caller's snapshot in sync for legacy callers
	if fresh, err := wstore.GetDag(ctx, g.OID); err == nil {
		*g = *fresh
	}
	return nil
}

// agy names its own conversation: the engine spawns it with no session id and stores none, and
// NoteWorkerSession binds the one agy reports. A --session-id agy was handed would be rejected.
func TestSpawnTaskAgy(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx, g, channelID, _ := seedDispatchDag(t, "spawn-task-agy")
	g.Tasks[0].RunSpec.Runtime = "agy"
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].RunSpec.Runtime = "agy"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var launched *jarvis.RunWorkerOptions
	var launchedCap runroute.Capability
	old := spawnWorker
	spawnWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, opts jarvis.RunWorkerOptions) (string, error) {
		launched, launchedCap = &opts, cap
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if launched == nil || launchedCap.Runtime != "agy" {
		t.Fatalf("want one agy worker, got %+v %+v", launched, launchedCap)
	}
	if launched.SessionId != "" || launched.RunId == "" || launched.TaskId != "t-0" {
		t.Fatalf("an agy worker launches with no session id, got %+v", *launched)
	}
	child, err := wstore.GetRun(ctx, channelID, g.Tasks[0].RunID)
	if err != nil {
		t.Fatal(err)
	}
	if child.SessionId != "" || child.Runtime != "agy" {
		t.Fatalf("child run = runtime %q session %q, want agy with no session", child.Runtime, child.SessionId)
	}
}
