// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// originWorld stands in for what notifyOrigins reads and calls outside the roster (scriptAgents scripts that): the
// runs not yet told, the setting, the dag of a run, the wake, and the stamp.
type originWorld struct {
	mu       sync.Mutex
	runs     []*waveobj.Run
	dags     map[string]*waveobj.TaskGroup
	enabled  bool
	woken    []agentsDelivery
	wakeErr  error
	stampErr error
	stamps   []string
	sent     *[]agentsDelivery
}

// useOriginWorld scripts the roster over facts and returns the world. Like the store, the world's list holds only the
// runs that have originnotify and no originnotifiedts.
func useOriginWorld(t *testing.T, facts *agentRosterFacts) *originWorld {
	t.Helper()
	w := &originWorld{enabled: true, dags: map[string]*waveobj.TaskGroup{}}
	w.sent = scriptAgents(t, facts)
	swap(t, &originNoticeRuns, func(context.Context) ([]*waveobj.Run, error) {
		w.mu.Lock()
		defer w.mu.Unlock()
		var out []*waveobj.Run
		for _, r := range w.runs {
			if r.OriginNotify && r.OriginNotifiedTs == 0 {
				out = append(out, r)
			}
		}
		return out, nil
	})
	swap(t, &originStamp, func(_ context.Context, run *waveobj.Run) error {
		w.mu.Lock()
		defer w.mu.Unlock()
		if w.stampErr != nil {
			return w.stampErr
		}
		run.OriginNotifiedTs = 1
		w.stamps = append(w.stamps, run.ID)
		return nil
	})
	swap(t, &originDag, func(_ context.Context, dagORef string) *waveobj.TaskGroup {
		w.mu.Lock()
		defer w.mu.Unlock()
		return w.dags[dagORef]
	})
	swap(t, &originWakeEnabled, func() bool {
		w.mu.Lock()
		defer w.mu.Unlock()
		return w.enabled
	})
	swap(t, &originWake, func(_ context.Context, row *agentRow, message string, fresh bool) error {
		w.mu.Lock()
		defer w.mu.Unlock()
		if fresh {
			t.Errorf("a wake for a message must resume the session, not start fresh")
		}
		w.woken = append(w.woken, agentsDelivery{row.blockId, message})
		return w.wakeErr
	})
	// one test's holds on a run id must not reach the next
	originHeldMu.Lock()
	clear(originHeld)
	originHeldMu.Unlock()
	return w
}

func (w *originWorld) add(runs ...*waveobj.Run) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.runs = append(w.runs, runs...)
}

func (w *originWorld) stamped() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.stamps)
}

func (w *originWorld) wakes() []agentsDelivery {
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.woken)
}

// originRun is a finished run started from agentsTabB, landed in a branch.
func originRun(goal string) *waveobj.Run {
	return &waveobj.Run{
		ID:           uuid.NewString(),
		Goal:         goal,
		Status:       "done",
		OriginTabId:  agentsTabB,
		OriginNotify: true,
		BaseBranch:   "main",
		Land:         &waveobj.RunLand{State: "landed"},
	}
}

func heldRun(goal, reason string, dirty bool) *waveobj.Run {
	r := originRun(goal)
	r.Land = &waveobj.RunLand{State: "held", Reason: reason, Dirty: dirty}
	return r
}

func TestNotifyOriginsLandedMessagesTheIdleOriginOnce(t *testing.T) {
	w := useOriginWorld(t, threeAgents())
	run := originRun("Brainstorm ideas")
	w.add(run)

	notifyOrigins(context.Background())
	if len(*w.sent) != 1 {
		t.Fatalf("deliveries = %+v, want one", *w.sent)
	}
	got := (*w.sent)[0]
	if got.blockId != agentsBlockB {
		t.Errorf("delivered to block %s, want the origin's %s", got.blockId, agentsBlockB)
	}
	if !strings.HasPrefix(got.text, "[arc] Run "+run.ID[:8]+` "Brainstorm ideas" landed: merged into main`) {
		t.Errorf("message = %q", got.text)
	}
	if run.OriginNotifiedTs == 0 || !slices.Equal(w.stamped(), []string{run.ID}) {
		t.Errorf("run not stamped: ts %d, stamps %v", run.OriginNotifiedTs, w.stamped())
	}

	notifyOrigins(context.Background())
	if len(*w.sent) != 1 || len(w.wakes()) != 0 {
		t.Errorf("a second pass sent again: deliveries %+v, wakes %+v", *w.sent, w.wakes())
	}
}

func TestNotifyOriginsWaitsForAWorkingOrigin(t *testing.T) {
	facts := threeAgents()
	w := useOriginWorld(t, facts)
	run := originRun("Brainstorm ideas")
	w.add(run)
	setState := func(tabId, state string) {
		for i := range facts.Tabs {
			if facts.Tabs[i].Tab.OID == tabId {
				facts.Tabs[i].Status.State = state
			}
		}
	}

	setState(agentsTabB, baseds.AgentState_Working)
	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.stamped()) != 0 {
		t.Fatalf("a working origin was messaged mid-turn: %+v, stamps %v", *w.sent, w.stamped())
	}

	setState(agentsTabB, baseds.AgentState_Asking)
	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.stamped()) != 0 {
		t.Fatalf("an asking origin was messaged: %+v, stamps %v", *w.sent, w.stamped())
	}

	setState(agentsTabB, baseds.AgentState_Waiting)
	notifyOrigins(context.Background())
	if len(*w.sent) != 1 || len(w.stamped()) != 1 {
		t.Fatalf("a waiting origin was not messaged: %+v, stamps %v", *w.sent, w.stamped())
	}
}

func TestNotifyOriginsWakesASleepingOrigin(t *testing.T) {
	facts := threeAgents()
	for i := range facts.Tabs {
		if facts.Tabs[i].Tab.OID == agentsTabB {
			facts.Tabs[i].ShellRunning = false
			facts.Tabs[i].Sleeping = 1000
			facts.Tabs[i].Cmd = "claude"
		}
	}
	w := useOriginWorld(t, facts)
	run := originRun("Brainstorm ideas")
	w.add(run)

	notifyOrigins(context.Background())
	wakes := w.wakes()
	if len(wakes) != 1 || wakes[0].blockId != agentsBlockB || !strings.Contains(wakes[0].text, "landed") {
		t.Fatalf("wakes = %+v, want one wake of the origin with the landed text", wakes)
	}
	if len(*w.sent) != 0 {
		t.Errorf("a sleeping origin was also typed into: %+v", *w.sent)
	}
	if run.OriginNotifiedTs == 0 {
		t.Errorf("run not stamped after the wake")
	}
}

func TestNotifyOriginsStampsWhenTheOriginIsGone(t *testing.T) {
	w := useOriginWorld(t, &agentRosterFacts{Tabs: []agentTabFacts{
		agentFacts(agentsTabA, "other", agentsBlockA, "claude", baseds.AgentState_Idle),
	}})
	run := originRun("Brainstorm ideas")
	w.add(run)

	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.wakes()) != 0 {
		t.Errorf("a message went to someone: %+v, wakes %+v", *w.sent, w.wakes())
	}
	if run.OriginNotifiedTs == 0 {
		t.Errorf("a run whose origin is gone must be stamped, so it is not looked at again")
	}
}

// A tab whose shell is not running and that is not asleep is left out of the roster: every agent tab for the first
// moments after wavesrv starts, an agent that is relaunching. Its tab exists, so the run waits and is told later.
func TestNotifyOriginsWaitsForATabWhoseAgentIsNotRunning(t *testing.T) {
	facts := threeAgents()
	setShell := func(running bool) {
		for i := range facts.Tabs {
			if facts.Tabs[i].Tab.OID == agentsTabB {
				facts.Tabs[i].ShellRunning = running
			}
		}
	}
	w := useOriginWorld(t, facts)
	run := originRun("Brainstorm ideas")
	w.add(run)

	setShell(false)
	notifyOrigins(context.Background())
	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.wakes()) != 0 || len(w.stamped()) != 0 || run.OriginNotifiedTs != 0 {
		t.Fatalf("a tab that exists but whose agent is not running was dealt with: deliveries %+v, wakes %+v, stamps %v", *w.sent, w.wakes(), w.stamped())
	}

	setShell(true)
	notifyOrigins(context.Background())
	if len(*w.sent) != 1 || (*w.sent)[0].blockId != agentsBlockB || !strings.Contains((*w.sent)[0].text, "landed") {
		t.Fatalf("deliveries = %+v, want the landed text once the agent shows idle", *w.sent)
	}
	if run.OriginNotifiedTs == 0 {
		t.Errorf("run not stamped after the send")
	}
}

// Only a tab that no longer exists has nobody to tell, whatever else is in the roster.
func TestNotifyOriginsStampsOnlyWhenTheOriginTabIsGone(t *testing.T) {
	facts := threeAgents()
	w := useOriginWorld(t, facts)
	gone := originRun("tab closed")
	gone.OriginTabId = "cccc4444-closed-tab"
	here := originRun("tab open but not running")
	for i := range facts.Tabs {
		if facts.Tabs[i].Tab.OID == agentsTabB {
			facts.Tabs[i].ShellRunning = false
		}
	}
	w.add(gone, here)

	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.wakes()) != 0 {
		t.Errorf("a message went to someone: %+v, wakes %+v", *w.sent, w.wakes())
	}
	if gone.OriginNotifiedTs == 0 {
		t.Errorf("a run whose tab is gone must be stamped")
	}
	if here.OriginNotifiedTs != 0 {
		t.Errorf("a run whose tab exists was stamped while its agent is not running")
	}
}

func TestNotifyOriginsOnlyTellsOfAFinalOutcome(t *testing.T) {
	w := useOriginWorld(t, threeAgents())
	executing := originRun("still running")
	executing.Status, executing.Land = "executing", nil
	pending := originRun("land pending")
	pending.Land = &waveobj.RunLand{State: "pending"}
	dirty := heldRun("dirty hold", "the checkout has uncommitted changes", true)
	branch := originRun("branch not landed yet")
	branch.Land, branch.LandPath = nil, "/wt/wave-1"
	w.add(executing, pending, dirty, branch)

	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.stamped()) != 0 {
		t.Errorf("runs without a final outcome were handled: %+v, stamps %v", *w.sent, w.stamped())
	}
}

func TestNotifyOriginsHeldSaysWhy(t *testing.T) {
	w := useOriginWorld(t, threeAgents())
	run := heldRun("Brainstorm ideas", "merge conflict in pkg/a.go", false)
	w.add(run)

	notifyOrigins(context.Background())
	if len(*w.sent) != 1 {
		t.Fatalf("deliveries = %+v, want one", *w.sent)
	}
	text := (*w.sent)[0].text
	if !strings.Contains(text, `"Brainstorm ideas" held: merge conflict in pkg/a.go.`) || !strings.Contains(text, "wsh runs show "+run.ID[:8]) {
		t.Errorf("held message = %q", text)
	}
	if run.OriginNotifiedTs == 0 {
		t.Errorf("held run not stamped")
	}
}

func TestNotifyOriginsCancelledIsStampedSilently(t *testing.T) {
	w := useOriginWorld(t, threeAgents())
	run := originRun("Brainstorm ideas")
	run.Status, run.Land = "cancelled", nil
	w.add(run)

	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.wakes()) != 0 {
		t.Errorf("a cancelled run messaged its origin: %+v", *w.sent)
	}
	if run.OriginNotifiedTs == 0 {
		t.Errorf("a cancelled run must be stamped")
	}
}

func TestNotifyOriginsRespectsTheSettingAndTheRunsFlag(t *testing.T) {
	w := useOriginWorld(t, threeAgents())
	run := originRun("Brainstorm ideas")
	loose := originRun("started from the cockpit")
	loose.OriginNotify = false
	w.add(run, loose)

	w.enabled = false
	notifyOrigins(context.Background())
	if len(*w.sent) != 0 || len(w.stamped()) != 0 {
		t.Fatalf("runs:wakeorigin false still messaged: %+v, stamps %v", *w.sent, w.stamped())
	}

	w.enabled = true
	notifyOrigins(context.Background())
	if len(*w.sent) != 1 || !strings.Contains((*w.sent)[0].text, "Brainstorm ideas") {
		t.Fatalf("deliveries = %+v, want only the run that asked", *w.sent)
	}
	if loose.OriginNotifiedTs != 0 {
		t.Errorf("a run without originnotify was stamped")
	}
}

func TestNotifyOriginsDoesNotRetryAFailedWakeAtOnce(t *testing.T) {
	facts := threeAgents()
	for i := range facts.Tabs {
		if facts.Tabs[i].Tab.OID == agentsTabB {
			facts.Tabs[i].ShellRunning = false
			facts.Tabs[i].Sleeping = 1000
			facts.Tabs[i].Cmd = "claude"
		}
	}
	w := useOriginWorld(t, facts)
	w.wakeErr = errors.New("agent did not report in")
	run := originRun("Brainstorm ideas")
	w.add(run)

	notifyOrigins(context.Background())
	notifyOrigins(context.Background())
	if n := len(w.wakes()); n != 1 {
		t.Errorf("a failed wake was retried on the next pass (%d wakes): each try relaunches the agent", n)
	}
	if run.OriginNotifiedTs != 0 {
		t.Errorf("a message that did not arrive was stamped as sent")
	}
}

func TestNotifyOriginsNeverResendsWhenTheStampFails(t *testing.T) {
	w := useOriginWorld(t, threeAgents())
	w.stampErr = errors.New("database is locked")
	run := originRun("Brainstorm ideas")
	w.add(run)

	notifyOrigins(context.Background())
	notifyOrigins(context.Background())
	if len(*w.sent) != 1 {
		t.Errorf("deliveries = %d, want 1: a failed stamp must not send the message twice", len(*w.sent))
	}
}

func TestNotifyOriginsPutsThePlanInTheMessage(t *testing.T) {
	w := useOriginWorld(t, threeAgents())
	run := originRun("Brainstorm ideas")
	run.DagORef = "dag:d1"
	run.ProjectPath = "/work/arc"
	w.dags["dag:d1"] = &waveobj.TaskGroup{PlanPath: "docs/superpowers/plans/2026-10-14-brainstorm.md", Tasks: []waveobj.TaskNode{{State: "done"}, {State: "done"}}}
	w.add(run)

	notifyOrigins(context.Background())
	if len(*w.sent) != 1 {
		t.Fatalf("deliveries = %+v", *w.sent)
	}
	text := (*w.sent)[0].text
	if !strings.Contains(text, "Plan: docs/superpowers/plans/2026-10-14-brainstorm.md") || !strings.Contains(text, "2/2 tasks") {
		t.Errorf("message = %q", text)
	}
}

func TestOriginMessage(t *testing.T) {
	const id = "4f2a9c1e-0000-4000-8000-000000000000"
	evidence := &waveobj.RunEvidence{
		Files:        []waveobj.EvidenceFile{{Path: "a.go"}, {Path: "b.go"}},
		AddTotal:     812,
		DelTotal:     140,
		Verification: &waveobj.RunVerification{State: "passed"},
	}
	dag := &waveobj.TaskGroup{
		PlanPath: `C:\work\arc\docs\superpowers\plans\2026-10-14-brainstorm.md`,
		Tasks: []waveobj.TaskNode{
			{State: "done"}, {State: "done"}, {State: "done"}, {State: "done"}, {State: "done"},
		},
	}
	landed := func(mod func(*waveobj.Run)) *waveobj.Run {
		r := &waveobj.Run{ID: id, Goal: "Brainstorm ideas\nmore goal text", Status: "done", ProjectPath: `C:\work\arc`, BaseBranch: "main", Land: &waveobj.RunLand{State: "landed"}, Evidence: evidence}
		if mod != nil {
			mod(r)
		}
		return r
	}
	const instruction = "Review it as the session that wrote the plan: check the result against the spec, record anything that still needs a hand check, make sure user-facing changes have their CHANGELOG line, tick the initiative chunk if one is linked, then report to the user in a few lines. Do not start another run."

	tests := []struct {
		name string
		run  *waveobj.Run
		dag  *waveobj.TaskGroup
		want string
	}{
		{
			name: "landed with evidence and a dag",
			run:  landed(nil),
			dag:  dag,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into main (5/5 tasks, Final passed, 2 files +812/-140).\n" +
				"Plan: docs/superpowers/plans/2026-10-14-brainstorm.md\n" + instruction,
		},
		{
			name: "landed without evidence",
			run:  landed(func(r *waveobj.Run) { r.Evidence = nil }),
			dag:  dag,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into main (5/5 tasks).\n" +
				"Plan: docs/superpowers/plans/2026-10-14-brainstorm.md\n" + instruction,
		},
		{
			name: "landed after a failed final",
			run: landed(func(r *waveobj.Run) {
				r.Evidence = &waveobj.RunEvidence{Verification: &waveobj.RunVerification{State: "failed"}}
			}),
			dag:  &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{State: "done"}, {State: "failed"}}},
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into main (1/2 tasks, Final failed).\n" + instruction,
		},
		{
			name: "landed with no dag",
			run:  landed(func(r *waveobj.Run) { r.Evidence = nil }),
			dag:  nil,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into main.\n" + instruction,
		},
		{
			name: "landed with one file and no dag",
			run: landed(func(r *waveobj.Run) {
				r.Evidence = &waveobj.RunEvidence{Files: []waveobj.EvidenceFile{{Path: "a.go"}}, AddTotal: 3, DelTotal: 1}
			}),
			dag:  nil,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into main (1 file +3/-1).\n" + instruction,
		},
		{
			name: "a checkout-landed run",
			run: landed(func(r *waveobj.Run) {
				r.Land, r.LandPath, r.Evidence = nil, "", nil
			}),
			dag: dag,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into the checkout (5/5 tasks).\n" +
				"Plan: docs/superpowers/plans/2026-10-14-brainstorm.md\n" + instruction,
		},
		{
			name: "a branch run on a detached head",
			run:  landed(func(r *waveobj.Run) { r.BaseBranch, r.Evidence = "", nil }),
			dag:  nil,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into the checkout.\n" + instruction,
		},
		{
			name: "held",
			run: landed(func(r *waveobj.Run) {
				r.Land = &waveobj.RunLand{State: "held", Reason: "merge conflict in pkg/a.go"}
			}),
			dag: dag,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" held: merge conflict in pkg/a.go.\n" +
				"Plan: docs/superpowers/plans/2026-10-14-brainstorm.md\n" +
				"Diagnose with wsh runs show 4f2a9c1e. Do not force the land; propose the fix to the user.",
		},
		{
			name: "held with a reason that ends in a full stop, and no dag",
			run: landed(func(r *waveobj.Run) {
				r.Land = &waveobj.RunLand{State: "held", Reason: "Final failed.\nsee the report"}
			}),
			dag: nil,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" held: Final failed. see the report.\n" +
				"Diagnose with wsh runs show 4f2a9c1e. Do not force the land; propose the fix to the user.",
		},
		{
			name: "held with no reason",
			run:  landed(func(r *waveobj.Run) { r.Land = &waveobj.RunLand{State: "held"} }),
			dag:  nil,
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" held.\n" +
				"Diagnose with wsh runs show 4f2a9c1e. Do not force the land; propose the fix to the user.",
		},
		{
			name: "a plan outside the project stays absolute",
			run:  landed(func(r *waveobj.Run) { r.Evidence = nil }),
			dag:  &waveobj.TaskGroup{PlanPath: `D:\elsewhere\plan.md`},
			want: "[arc] Run 4f2a9c1e \"Brainstorm ideas\" landed: merged into main.\n" +
				"Plan: D:/elsewhere/plan.md\n" + instruction,
		},
		{
			name: "no goal",
			run:  landed(func(r *waveobj.Run) { r.Goal, r.Evidence = "", nil }),
			dag:  nil,
			want: "[arc] Run 4f2a9c1e landed: merged into main.\n" + instruction,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := originMessage(tt.run, tt.dag); got != tt.want {
				t.Errorf("originMessage:\n got: %q\nwant: %q", got, tt.want)
			}
		})
	}
}

func TestOriginMessageIsPlainText(t *testing.T) {
	for _, land := range []*waveobj.RunLand{{State: "landed"}, {State: "held", Reason: "x"}} {
		msg := originMessage(&waveobj.Run{ID: "4f2a9c1e", Goal: "g", Land: land}, nil)
		if !strings.HasPrefix(msg, "[arc] Run ") {
			t.Errorf("message %q must start with [arc], never a slash", msg)
		}
	}
}

func TestCreateRunMarksARunFromASessionToNotifyIt(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "createrun-originnotify", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	stubRunServer(t, "pi", nil)
	for _, tt := range []struct {
		origin string
		want   bool
	}{{"tab-from-a-session", true}, {"", false}} {
		rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
			ChannelId: ch.OID, WorkspaceId: "ws", Goal: "test", Runtime: "pi",
			Mode: jarvis.RunMode_Orchestrator, DeferStart: true, OriginTabId: tt.origin,
		})
		if err != nil {
			t.Fatal(err)
		}
		run, err := wstore.GetRun(ctx, ch.OID, rtn.Run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if run.OriginNotify != tt.want || run.OriginNotifiedTs != 0 {
			t.Errorf("origin %q: originnotify %v, notified %d; want originnotify %v and not yet told", tt.origin, run.OriginNotify, run.OriginNotifiedTs, tt.want)
		}
	}
}

// The loop's evaluation tells origins even with an empty queue, and while a start holds the flag.
func TestEvaluateRunQueueTellsOriginsWhateverTheQueueHolds(t *testing.T) {
	useQueueWorld(t)
	w := useOriginWorld(t, threeAgents())
	w.add(originRun("Brainstorm ideas"))

	runQueueStarting.Store(true)
	t.Cleanup(func() { runQueueStarting.Store(false) })
	evaluateRunQueue(context.Background())
	if len(*w.sent) != 1 {
		t.Fatalf("deliveries = %+v, want one from an evaluation that could not start anything", *w.sent)
	}
}
