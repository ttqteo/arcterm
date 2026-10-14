// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// The session that started a run hears once how it ended (spec 2026-10-14-run-handoff-lifecycle-design, section 6).
// The run queue's loop calls notifyOrigins on every evaluation, so a run's outcome, a session that went idle, and
// wavesrv starting up with an untold run all reach the same place.

const (
	// originWakeRetry is how long a run waits before another wake of its sleeping origin is tried after one failed:
	// every try relaunches the agent, and the loop would otherwise try on each 15s tick.
	originWakeRetry = 5 * time.Minute
	// originHoldForever keeps a run out of later passes for the life of the process.
	originHoldForever = 100 * 365 * 24 * time.Hour
	// originGoalMax bounds the goal quoted in the message's first line.
	originGoalMax = 100
)

// seams the tests script: what notifyOrigins reads and calls outside the roster
var (
	// originNoticeRuns lists the runs with originnotify and no originnotifiedts, oldest first.
	originNoticeRuns = wstore.GetRunsAwaitingOriginNotice
	// originStamp records that the origin was dealt with (told, or nothing to tell) on the stored run.
	originStamp = stampOriginNotified
	// originDag is the dag a run was submitted with, nil when there is none or it cannot be read.
	originDag = loadOriginDag
	// originWakeEnabled reads runs:wakeorigin: unset is true.
	originWakeEnabled = func() bool {
		v := wconfig.GetWatcher().GetFullConfig().Settings.RunsWakeOrigin
		return v == nil || *v
	}
	// originWake wakes a sleeping origin and delivers the message once it has reported in.
	originWake = wakeAgent
)

var (
	// originHeld keeps a run out of a pass until the time: a message that was sent but whose stamp failed (forever,
	// so it is never sent twice) or a wake that failed (for originWakeRetry).
	originHeldMu sync.Mutex
	originHeld   = map[string]time.Time{}
)

func holdOrigin(runId string, d time.Duration) {
	originHeldMu.Lock()
	defer originHeldMu.Unlock()
	originHeld[runId] = time.Now().Add(d)
}

func originIsHeld(runId string) bool {
	originHeldMu.Lock()
	defer originHeldMu.Unlock()
	return time.Now().Before(originHeld[runId])
}

func stampOriginNotified(ctx context.Context, run *waveobj.Run) error {
	return wstore.UpdateRun(ctx, run.ChannelOID, run.ID, func(r *waveobj.Run) error {
		if r.OriginNotifiedTs == 0 {
			r.OriginNotifiedTs = time.Now().UnixMilli()
		}
		return nil
	})
}

func loadOriginDag(ctx context.Context, dagORef string) *waveobj.TaskGroup {
	if dagORef == "" {
		return nil
	}
	dag, err := wstore.GetDagShared(ctx, dagORef)
	if err != nil {
		log.Printf("runs: reading dag %s for an origin message: %v", dagORef, err)
		return nil
	}
	return dag
}

// notifyOrigins messages the origin session of each run that reached a final outcome, once. A run whose origin is
// working or asking waits for a later pass, and so does one whose tab exists but has no agent in the roster (not
// started yet, or relaunching); one whose tab is gone, and a cancelled run, is stamped without a message. A pass that
// finds nothing to tell reads no roster.
func notifyOrigins(ctx context.Context) {
	if !originWakeEnabled() {
		return
	}
	runs, err := originNoticeRuns(ctx)
	if err != nil {
		log.Printf("runs: reading the runs whose origin is to hear of them: %v", err)
		return
	}
	var rows []agentRow
	rosterRead := false
	for _, run := range runs {
		if ctx.Err() != nil {
			return
		}
		if !run.OriginNotify || run.OriginNotifiedTs != 0 || originIsHeld(run.ID) {
			continue
		}
		cancelled := run.Status == jarvis.RunStatus_Cancelled
		if final, _, _ := runqueue.Outcome(run); !final && !cancelled {
			continue
		}
		if cancelled || run.OriginTabId == "" {
			stampOrigin(ctx, run)
			continue
		}
		if !rosterRead {
			facts, err := loadAgentRosterFacts(ctx)
			if err != nil {
				log.Printf("runs: reading the agent roster to tell an origin session: %v", err)
				return
			}
			rows, rosterRead = buildAgentRoster(facts), true
		}
		row := originRow(rows, run.OriginTabId)
		if row == nil {
			// The roster leaves out a tab whose shell is not running and that is not asleep: every agent tab for the
			// first moments after wavesrv starts (before the frontend restarts the block controllers), and an agent
			// that is relaunching. Only a tab that no longer exists has nobody to tell.
			if tabAgentBlock(ctx, run.OriginTabId) == "" {
				stampOrigin(ctx, run)
			}
			continue
		}
		if row.State == wshrpc.AgentsState_Working || row.State == wshrpc.AgentsState_Asking {
			continue // never in the middle of a turn the person is having; the next pass asks again
		}
		msg := originMessage(run, originDag(ctx, run.DagORef))
		if row.State == wshrpc.AgentsState_Sleeping {
			if err := originWake(ctx, row, msg, false); err != nil {
				log.Printf("runs: waking %s to tell it how run %s ended: %v", row.Name, run.ID, err)
				holdOrigin(run.ID, originWakeRetry)
				continue
			}
		} else {
			deliverAgentMessage(row.blockId, msg)
		}
		stampOrigin(ctx, run)
	}
}

// stampOrigin records that the run's origin is dealt with. When the write fails the run is held out of this
// process's later passes: the message may already have been sent, and it is never sent twice.
func stampOrigin(ctx context.Context, run *waveobj.Run) {
	if err := originStamp(ctx, run); err != nil {
		log.Printf("runs: stamping run %s as told to its origin: %v", run.ID, err)
		holdOrigin(run.ID, originHoldForever)
	}
}

// originRow finds the live agent whose tab started the run, by its exact id.
func originRow(rows []agentRow, tabId string) *agentRow {
	for i := range rows {
		if rows[i].TabId == tabId {
			return &rows[i]
		}
	}
	return nil
}

// originMessage is what the origin session is told when its run ends: plain text (never a slash command, and not an
// agent envelope: the run is no agent, and offers no reply channel) whose first line names the run. A run that
// landed asks the session to review the result; one that was held asks it to diagnose, not to force the land. A part
// whose data is missing is left out: no dag has no task count and no plan line, no evidence has no file count.
func originMessage(run *waveobj.Run, dag *waveobj.TaskGroup) string {
	id := run.ID[:min(8, len(run.ID))]
	head := "[arc] Run " + id
	if goal := originGoal(run.Goal); goal != "" {
		head += fmt.Sprintf(" %q", goal)
	}
	_, landed, reason := runqueue.Outcome(run)
	var lines []string
	if landed {
		target := "the checkout"
		if run.Land != nil && run.BaseBranch != "" {
			target = run.BaseBranch
		}
		lines = append(lines, head+" landed: merged into "+target+originDetail(run, dag)+".")
	} else if reason = strings.TrimRight(strings.Join(strings.Fields(reason), " "), "."); reason != "" {
		lines = append(lines, head+" held: "+reason+".")
	} else {
		lines = append(lines, head+" held.")
	}
	if dag != nil && dag.PlanPath != "" {
		lines = append(lines, "Plan: "+originPlanPath(dag.PlanPath, run.ProjectPath))
	}
	if landed {
		lines = append(lines, "Review it as the session that wrote the plan: check the result against the spec, record anything that still needs a hand check, make sure user-facing changes have their CHANGELOG line, tick the initiative chunk if one is linked, then report to the user in a few lines. Do not start another run.")
	} else {
		lines = append(lines, "Diagnose with wsh runs show "+id+". Do not force the land; propose the fix to the user.")
	}
	return strings.Join(lines, "\n")
}

// originGoal is the goal's first line, cut to originGoalMax characters.
func originGoal(goal string) string {
	first, _, _ := strings.Cut(goal, "\n")
	first = strings.TrimSpace(first)
	if r := []rune(first); len(r) > originGoalMax {
		first = strings.TrimSpace(string(r[:originGoalMax-1])) + "…"
	}
	return first
}

// originDetail is the parenthesis after "merged into <target>": the tasks done, the final stage's verdict and the
// size of the diff, each left out when unknown; empty when none is known.
func originDetail(run *waveobj.Run, dag *waveobj.TaskGroup) string {
	var parts []string
	if dag != nil && len(dag.Tasks) > 0 {
		done := 0
		for _, t := range dag.Tasks {
			if t.State == "done" {
				done++
			}
		}
		parts = append(parts, fmt.Sprintf("%d/%d tasks", done, len(dag.Tasks)))
	}
	if ev := run.Evidence; ev != nil {
		if ev.Verification != nil && ev.Verification.State != "" {
			parts = append(parts, "Final "+ev.Verification.State)
		}
		if n := len(ev.Files); n > 0 {
			noun := "files"
			if n == 1 {
				noun = "file"
			}
			parts = append(parts, fmt.Sprintf("%d %s +%d/-%d", n, noun, ev.AddTotal, ev.DelTotal))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return " (" + strings.Join(parts, ", ") + ")"
}

// originPlanPath is the plan's path as the session knows it: relative to the project when it is inside it, in forward
// slashes either way. A branch-landed dag already keeps it repo-relative.
func originPlanPath(planPath, projectPath string) string {
	p := strings.ReplaceAll(planPath, `\`, "/")
	root := strings.TrimRight(strings.ReplaceAll(projectPath, `\`, "/"), "/")
	if root != "" && len(p) > len(root)+1 && p[len(root)] == '/' && strings.EqualFold(p[:len(root)], root) {
		return p[len(root)+1:]
	}
	return p
}
