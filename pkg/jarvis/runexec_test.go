// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestRunWorkerSpecFor(t *testing.T) {
	tests := []struct {
		runtime string
		bin     string
		args    []string
	}{
		{"claude", "claude", []string{"--dangerously-skip-permissions", "do work"}},
		{"pi", "pi", []string{"do work"}},
	}
	for _, tt := range tests {
		cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: tt.runtime})
		if err != nil {
			t.Fatalf("resolve %s: %v", tt.runtime, err)
		}
		spec, ok := RunWorkerSpecFor(cap, "", "do work")
		if !ok || spec.Bin != tt.bin || !reflect.DeepEqual(spec.Args, tt.args) {
			t.Errorf("%s spec = %+v, ok=%v", tt.runtime, spec, ok)
		}
	}
}

func TestRunWorkerSpecFor_CapabilityArgs(t *testing.T) {
	tests := []struct {
		name    string
		runtime string
		model   string
		args    []string
	}{
		{"pi default", "pi", "", []string{"do work"}},
		{"claude cheap model", "claude", consult.CheapModel, []string{"--dangerously-skip-permissions", "--model", consult.CheapModel, "do work"}},
		{"claude mid model", "claude", consult.MidModel, []string{"--dangerously-skip-permissions", "--model", consult.MidModel, "do work"}},
		{"claude default", "claude", "", []string{"--dangerously-skip-permissions", "do work"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: tt.runtime, Model: tt.model})
			if err != nil {
				t.Fatal(err)
			}
			spec, ok := RunWorkerSpecFor(cap, "", "do work")
			if !ok || spec.Bin != tt.runtime || !reflect.DeepEqual(spec.Args, tt.args) {
				t.Fatalf("spec = %+v, ok=%v", spec, ok)
			}
		})
	}
	cap, _ := runroute.Resolve(waveobj.RoutePin{Runtime: "claude", Model: consult.CheapModel})
	cap.ModelArgs = nil
	for _, invalid := range []runroute.Capability{
		cap,
		{Runtime: "pi"},
		{Runtime: "mystery", ResolvedModel: "operator default"},
	} {
		if _, ok := RunWorkerSpecFor(invalid, "", "do work"); ok {
			t.Errorf("mismatched/unsupported capability %+v produced a worker spec", cap)
		}
	}
}

func TestRunWorkerSpecForRejectsUnsupportedRuntimes(t *testing.T) {
	for _, runtime := range []string{"codex", "opencode"} {
		cap := runroute.Capability{Runtime: runtime, ResolvedModel: "operator default"}
		if spec, ok := RunWorkerSpecFor(cap, "", "do work"); ok {
			t.Errorf("%s must have no run worker adapter, got %+v", runtime, spec)
		}
	}
}

// claude and pi both take --session-id, which names the transcript the worker writes; the engine picks
// the id so liveness and evidence can open that file instead of searching for it.
func TestRunWorkerSpecForSessionId(t *testing.T) {
	const id = "0b6f7c1e-4d2a-4f3b-9c8d-1a2b3c4d5e6f"
	tests := []struct {
		runtime string
		model   string
		args    []string
	}{
		{"claude", consult.CheapModel, []string{"--dangerously-skip-permissions", "--session-id", id, "--model", consult.CheapModel, "do work"}},
		{"pi", "", []string{"--session-id", id, "do work"}},
		// agy names its own conversation: it never takes --session-id, even when handed one
		{"agy", "", []string{"--dangerously-skip-permissions", "-i", "do work"}},
		{"agy", "gemini-3-pro", []string{"--dangerously-skip-permissions", "--model", "gemini-3-pro", "-i", "do work"}},
	}
	for _, tt := range tests {
		cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: tt.runtime, Model: tt.model})
		if err != nil {
			t.Fatalf("resolve %s: %v", tt.runtime, err)
		}
		spec, ok := RunWorkerSpecFor(cap, id, "do work")
		if !ok || !reflect.DeepEqual(spec.Args, tt.args) {
			t.Errorf("%s args = %v, ok=%v, want %v", tt.runtime, spec.Args, ok, tt.args)
		}
	}
}

func TestPhasePromptModeAware(t *testing.T) {
	orch := NewRun("do X", "ws", "/p", waveobj.PrincipleList{{ID: "clean", Text: "be clean"}}, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	if p := phasePrompt(&orch); !strings.Contains(p, "wsh jarvis dag submit --plan") {
		t.Fatalf("orchestrator prompt should hand the engine a plan:\n%s", p)
	}

	// every other shape, including a stored pipeline run, gets the bare worker prompt
	quick := NewRun("do X", "ws", "/p", waveobj.PrincipleList{{ID: "clean", Text: "be clean"}}, RunMode_Quick, QuickPlaybook(), 1)
	if pp := phasePrompt(&quick); !strings.Contains(pp, "wsh jarvis complete") {
		t.Fatalf("worker prompt should tell the worker to self-report completion:\n%s", pp)
	}
}

func TestMakeWorkerBlockMeta_OrchestratorKeepsOnExit(t *testing.T) {
	// orchestrator leads must not auto-close on exit while DAG children are running
	orchMeta := makeWorkerBlockMeta(RunWorkerSpec{Bin: "pi", Args: []string{"do"}}, "/proj", true)
	if !orchMeta.GetBool(waveobj.MetaKey_CmdKeepOnExit, false) {
		t.Fatalf("orchestrator block meta should have cmd:keeponexit=true, got %#v", orchMeta)
	}
	pipeMeta := makeWorkerBlockMeta(RunWorkerSpec{Bin: "pi", Args: []string{"do"}}, "/proj", false)
	if pipeMeta.GetBool(waveobj.MetaKey_CmdKeepOnExit, false) {
		t.Fatalf("pipeline block meta should not have cmd:keeponexit, got %#v", pipeMeta)
	}
}

func TestEnsureWorkersPassesKeepOnExitOnlyForOrchestrator(t *testing.T) {
	old := SpawnRunWorker
	defer func() { SpawnRunWorker = old }()

	var got []RunWorkerOptions
	SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, opts RunWorkerOptions) (string, error) {
		got = append(got, opts)
		return "tab:worker", nil
	}
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: "pi"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	orch := NewRun("orchestrate", "ws", "/p", nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &orch, cap, "project", ""); err != nil {
		t.Fatal(err)
	}
	pipe := NewRun("quick", "ws", "/p", nil, RunMode_Quick, QuickPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &pipe, cap, "project", ""); err != nil {
		t.Fatal(err)
	}

	if len(got) != 2 || !got[0].KeepOnExit || got[1].KeepOnExit {
		t.Fatalf("worker options = %+v", got)
	}
}

// the lead of a run that lands on its own branch works in that branch's tree, where its spec, plan and
// conflict resolutions land
func TestEnsureWorkersStartsTheLeadWhereLanesLand(t *testing.T) {
	old := SpawnRunWorker
	defer func() { SpawnRunWorker = old }()

	var cwds []string
	SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, cwd, _ string, _ RunWorkerOptions) (string, error) {
		cwds = append(cwds, cwd)
		return "tab:worker", nil
	}
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: "pi"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	landed := NewRun("orchestrate", "ws", "/p", nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	landed.LandPath = "/p/.waveterm/worktrees/" + landed.ID
	if _, err := EnsureWorkers(context.Background(), &landed, cap, "project", ""); err != nil {
		t.Fatal(err)
	}
	checkout := NewRun("orchestrate", "ws", "/p", nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &checkout, cap, "project", ""); err != nil {
		t.Fatal(err)
	}

	if len(cwds) != 2 || cwds[0] != landed.LandPath || cwds[1] != "/p" {
		t.Fatalf("lead cwds = %q, want the landing tree then the project", cwds)
	}
}

func TestLandPathFallsBackToTheProject(t *testing.T) {
	if got := LandPath(&waveobj.Run{ProjectPath: "/repo"}); got != "/repo" {
		t.Fatalf("LandPath = %q, want the project", got)
	}
	if got := LandPath(&waveobj.Run{ProjectPath: "/repo", LandPath: "/repo/.waveterm/worktrees/r"}); got != "/repo/.waveterm/worktrees/r" {
		t.Fatalf("LandPath = %q, want the landing tree", got)
	}
}

func TestEnsureWorkersUsesAGivenPrompt(t *testing.T) {
	old := SpawnRunWorker
	defer func() { SpawnRunWorker = old }()

	var prompts []string
	SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, prompt string, _ RunWorkerOptions) (string, error) {
		prompts = append(prompts, prompt)
		return "tab:worker", nil
	}
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: "pi"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	given := NewRun("orchestrate", "ws", "/p", nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &given, cap, "project", "the rules, then the wake"); err != nil {
		t.Fatal(err)
	}
	derived := NewRun("orchestrate", "ws", "/p", nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &derived, cap, "project", ""); err != nil {
		t.Fatal(err)
	}

	if len(prompts) != 2 || prompts[0] != "the rules, then the wake" || prompts[1] != phasePrompt(&derived) {
		t.Fatalf("a given prompt replaces the phase's, an empty one derives it; got %q", prompts)
	}
}

func TestConfigureWorkerPersistsMetaBeforeStart(t *testing.T) {
	oldPersist, oldStart := persistWorkerBlockMeta, startWorkerController
	defer func() { persistWorkerBlockMeta, startWorkerController = oldPersist, oldStart }()

	var calls []string
	persistWorkerBlockMeta = func(context.Context, string, waveobj.MetaMapType) error {
		calls = append(calls, "persist")
		return nil
	}
	startWorkerController = func(context.Context, string, string) error {
		calls = append(calls, "start")
		return nil
	}
	if err := configureAndStartWorker(context.Background(), "tab-1", "block-1", waveobj.MetaMapType{}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(calls, []string{"persist", "start"}) {
		t.Fatalf("calls = %v", calls)
	}
}

func TestConfigureWorkerDoesNotStartAfterMetaFailure(t *testing.T) {
	oldPersist, oldStart := persistWorkerBlockMeta, startWorkerController
	defer func() { persistWorkerBlockMeta, startWorkerController = oldPersist, oldStart }()

	persistWorkerBlockMeta = func(context.Context, string, waveobj.MetaMapType) error { return errors.New("write failed") }
	started := false
	startWorkerController = func(context.Context, string, string) error { started = true; return nil }

	err := configureAndStartWorker(context.Background(), "tab-1", "block-1", waveobj.MetaMapType{})
	if err == nil || started {
		t.Fatalf("err=%v started=%v", err, started)
	}
}

func TestInitialWorkerStatusEvent(t *testing.T) {
	ev := initialWorkerStatusEvent("abc", "claude", 1717000000000)
	if ev.Event != wps.Event_AgentStatus {
		t.Fatalf("event = %q, want %q", ev.Event, wps.Event_AgentStatus)
	}
	// Persist:1 so a late-subscribing frontend replays it and the worker still shows.
	if ev.Persist != 1 {
		t.Errorf("persist = %d, want 1", ev.Persist)
	}
	if len(ev.Scopes) != 1 || ev.Scopes[0] != "block:abc" {
		t.Errorf("scopes = %v, want [block:abc]", ev.Scopes)
	}
	data, ok := ev.Data.(baseds.AgentStatusData)
	if !ok {
		t.Fatalf("data type = %T, want baseds.AgentStatusData", ev.Data)
	}
	if data.State != baseds.AgentState_Working || data.ORef != "block:abc" || data.Agent != "claude" {
		t.Errorf("data = %#v, want working/block:abc/claude", data)
	}
}

// A pi worker only ever carries a model when one was pinned, and a pinned pi model is always
// provider-qualified — that qualified id is what reaches the CLI, unmodified.
func TestRunWorkerSpecFor_piModelPinPassesQualifiedID(t *testing.T) {
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: "pi", Model: "opencode/deepseek-v4-pro"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	spec, ok := RunWorkerSpecFor(cap, "", "do work")
	if !ok {
		t.Fatal("pi model pin must produce a worker spec")
	}
	want := []string{"--model", "opencode/deepseek-v4-pro", "do work"}
	if !reflect.DeepEqual(spec.Args, want) {
		t.Errorf("args = %v, want %v", spec.Args, want)
	}
}

// stubWorkerSpawn swaps the spawn's side effects: the tab is a real row inserted through the spawn's own ctx
// (so its update lands in whatever collector that ctx carries), the controller never starts, and broadcasts
// are recorded instead of sent.
func stubWorkerSpawn(t *testing.T) *[]waveobj.UpdatesRtnType {
	t.Helper()
	oldCreate, oldSend, oldPersist, oldStart := createWorkerTab, sendWorkerTabUpdates, persistWorkerBlockMeta, startWorkerController
	t.Cleanup(func() {
		createWorkerTab, sendWorkerTabUpdates, persistWorkerBlockMeta, startWorkerController = oldCreate, oldSend, oldPersist, oldStart
	})
	createWorkerTab = func(ctx context.Context, _ string, name string, _ bool, _ bool) (string, error) {
		tab := &waveobj.Tab{OID: uuid.NewString(), Name: name, BlockIds: []string{uuid.NewString()}, Meta: waveobj.MetaMapType{}}
		return tab.OID, wstore.DBInsert(ctx, tab)
	}
	persistWorkerBlockMeta = func(context.Context, string, waveobj.MetaMapType) error { return nil }
	startWorkerController = func(context.Context, string, string) error { return nil }
	var sent []waveobj.UpdatesRtnType
	sendWorkerTabUpdates = func(u waveobj.UpdatesRtnType) { sent = append(sent, u) }
	return &sent
}

func piCap(t *testing.T) runroute.Capability {
	t.Helper()
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: "pi"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	return cap
}

// the engine's dispatch passes a ctx that collects nothing; the tab must still reach the app
func TestSpawnRunWorkerBroadcastsItsTab(t *testing.T) {
	sent := stubWorkerSpawn(t)
	oref, err := SpawnRunWorker(context.Background(), piCap(t), "ws-1", "proj", "", "do it", RunWorkerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 {
		t.Fatalf("want one broadcast, got %d", len(*sent))
	}
	tabID := strings.TrimPrefix(oref, "tab:")
	for _, u := range (*sent)[0] {
		if u.OType == waveobj.OType_Tab && u.OID == tabID {
			return
		}
	}
	t.Fatalf("broadcast has no update for tab %s: %+v", tabID, (*sent)[0])
}

// spawnRunWorkersWithPrompt collects and flushes its own updates; the spawn must not flush them early
func TestSpawnRunWorkerLeavesACollectingCallerToFlush(t *testing.T) {
	sent := stubWorkerSpawn(t)
	ctx := waveobj.ContextWithUpdates(context.Background())
	oref, err := SpawnRunWorker(ctx, piCap(t), "ws-1", "proj", "", "do it", RunWorkerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 0 {
		t.Fatalf("a collecting caller flushes its own updates, got %d broadcasts", len(*sent))
	}
	if waveobj.ContextGetUpdate(ctx, waveobj.ORef{OType: waveobj.OType_Tab, OID: strings.TrimPrefix(oref, "tab:")}) == nil {
		t.Fatal("the tab's update must be left in the caller's collector")
	}
}

func TestSpawnRunWorkerLabelsTheTab(t *testing.T) {
	stubWorkerSpawn(t)
	ctx := context.Background()
	oref, err := SpawnRunWorker(ctx, piCap(t), "ws-1", "proj", "", "do it", RunWorkerOptions{Label: "Ship the auth rework"})
	if err != nil {
		t.Fatal(err)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, strings.TrimPrefix(oref, "tab:"))
	if err != nil {
		t.Fatal(err)
	}
	if got := tab.Meta["session:label"]; got != "Ship the auth rework" {
		t.Fatalf("session:label = %v, want the run title", got)
	}
}

// a lead is named after its run: otherwise its label is the ai-title of its first prompt, a wake on a plan run. So
// is a run whose prompt moved to a file, whose first prompt is the pointer to it; any other keeps its ai-title.
func TestEnsureWorkersLabelsALeadAndAMovedPromptWithTheRunTitle(t *testing.T) {
	old := SpawnRunWorker
	defer func() { SpawnRunWorker = old }()
	var got []RunWorkerOptions
	SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, opts RunWorkerOptions) (string, error) {
		got = append(got, opts)
		return "tab:worker", nil
	}
	lead := NewRun("Ship the auth rework\nwith the details below", "ws", "/p", nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &lead, piCap(t), "project", ""); err != nil {
		t.Fatal(err)
	}
	quick := NewRun("fix a typo", "ws", "/p", nil, RunMode_Quick, QuickPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &quick, piCap(t), "project", ""); err != nil {
		t.Fatal(err)
	}
	long := NewRun("Port the importer\n"+strings.Repeat("x", maxInlinePromptBytes), "ws", "/p", nil, RunMode_Quick, QuickPlaybook(), 1)
	if _, err := EnsureWorkers(context.Background(), &long, piCap(t), "project", ""); err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Label != "Ship the auth rework" || got[1].Label != "" || got[2].Label != "Port the importer" {
		t.Fatalf("labels = %+v", got)
	}
}

// engine workers carry no frontend launcher, so the backend stores what resume-on-reopen and the dead-run
// guard read: the launch flags before the prompt, and the owning run and task.
func TestSpawnRunWorkerStoresBaseArgs(t *testing.T) {
	stubWorkerSpawn(t)
	var persisted waveobj.MetaMapType
	persistWorkerBlockMeta = func(_ context.Context, _ string, meta waveobj.MetaMapType) error {
		persisted = meta
		return nil
	}
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: "claude"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	opts := RunWorkerOptions{SessionId: "sess-1", RunId: "run-1", TaskId: "t-3"}
	if _, err := SpawnRunWorker(context.Background(), cap, "ws-1", "proj", "", "do it", opts); err != nil {
		t.Fatal(err)
	}
	wantBase := append([]string{"--dangerously-skip-permissions"}, cap.ModelArgs...)
	if got, _ := persisted["agent:baseargs"].([]string); !reflect.DeepEqual(got, wantBase) {
		t.Fatalf("agent:baseargs = %#v, want %#v", persisted["agent:baseargs"], wantBase)
	}
	if persisted["agent:runid"] != "run-1" || persisted["agent:taskid"] != "t-3" {
		t.Fatalf("run/task ids = %v / %v", persisted["agent:runid"], persisted["agent:taskid"])
	}
}

// a task's prompt carries its whole plan section; past the Windows command-line cap CreateProcess refuses the
// launch and the worker never starts, so a prompt that could not fit travels as a file the worker reads
func TestSpawnRunWorkerPassesALongPromptAsAFile(t *testing.T) {
	stubWorkerSpawn(t)
	oldDir, dir := promptFileDir, t.TempDir()
	promptFileDir = func() string { return dir }
	t.Cleanup(func() { promptFileDir = oldDir })
	var persisted waveobj.MetaMapType
	persistWorkerBlockMeta = func(_ context.Context, _ string, meta waveobj.MetaMapType) error {
		persisted = meta
		return nil
	}
	lastArg := func() string {
		args, _ := persisted[waveobj.MetaKey_CmdArgs].([]string)
		return args[len(args)-1]
	}

	if _, err := SpawnRunWorker(context.Background(), piCap(t), "ws-1", "proj", "", "do it", RunWorkerOptions{}); err != nil {
		t.Fatal(err)
	}
	if got := lastArg(); got != "do it" {
		t.Fatalf("a short prompt stays inline, got %q", got)
	}

	long := strings.Repeat("x", maxInlinePromptBytes+1)
	if _, err := SpawnRunWorker(context.Background(), piCap(t), "ws-1", "proj", "", long, RunWorkerOptions{SessionId: "sess-9"}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "sess-9.md")
	if got := lastArg(); len(got) > maxInlinePromptBytes || !strings.Contains(got, path) {
		t.Fatalf("a long prompt must be replaced by a pointer to %s, got %d bytes", path, len(got))
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != long {
		t.Fatalf("prompt file holds %d bytes (err %v), want the whole prompt", len(data), err)
	}
}

// a worker that dies at launch is failed through its run row and the owner stamp on its tab, which the caller
// writes after the spawn: the spawn must start nothing, or that exit beats them and fails nothing
func TestSpawnRunWorkerStartsNothingUntilStartRunWorker(t *testing.T) {
	stubWorkerSpawn(t)
	var started []string
	startWorkerController = func(_ context.Context, tabID, _ string) error {
		started = append(started, tabID)
		return nil
	}
	oref, err := SpawnRunWorker(context.Background(), piCap(t), "ws-1", "proj", "", "do it", RunWorkerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(started) != 0 {
		t.Fatalf("the spawn must not start the worker, started %v", started)
	}
	if err := StartRunWorker(context.Background(), oref); err != nil {
		t.Fatal(err)
	}
	if want := strings.TrimPrefix(oref, "tab:"); len(started) != 1 || started[0] != want {
		t.Fatalf("want the worker in tab %s started once, got %v", want, started)
	}
}

func TestStartRunWorkerRefusesATabThatIsGone(t *testing.T) {
	stubWorkerSpawn(t)
	if err := StartRunWorker(context.Background(), "tab:"+uuid.NewString()); err == nil {
		t.Fatal("a worker whose tab is gone cannot be started")
	}
}

func TestRunWorkerSpecForAgyBaseArgs(t *testing.T) {
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: "agy", Model: "gemini-3-pro"})
	if err != nil {
		t.Fatal(err)
	}
	spec, ok := RunWorkerSpecFor(cap, "", "do work")
	want := []string{"--dangerously-skip-permissions", "--model", "gemini-3-pro"}
	if !ok || spec.Bin != "agy" || !reflect.DeepEqual(spec.BaseArgs, want) {
		t.Fatalf("agy spec = %+v, ok=%v, want base args %v", spec, ok, want)
	}
}

func TestWorkerSessionId(t *testing.T) {
	if got := WorkerSessionId("agy"); got != "" {
		t.Errorf("agy names its own session, got %q", got)
	}
	for _, rt := range []string{"claude", "pi"} {
		a, b := WorkerSessionId(rt), WorkerSessionId(rt)
		if _, err := uuid.Parse(a); err != nil || a == b {
			t.Errorf("%s: want two distinct UUIDs, got %q %q", rt, a, b)
		}
	}
}
