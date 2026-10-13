// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// fixRoundLineFmt opens every fix-round task's description. The worker's contract names the run's plan, where
// the task's dag number means nothing, so this line points it at the fix plan and the task's own number there.
const fixRoundLineFmt = "Fix round %d: this is task %d of the fix plan at %s; re-read it there, not the run plan, whose task numbers do not apply to this task."

// fixRoundLineRe finds the fix plan's path in that line, so each reader gets it resolved in its own tree.
var fixRoundLineRe = regexp.MustCompile(`^Fix round \d+: this is task \d+ of the fix plan at (.+?); re-read it there`)

// CheckFixRound says why a dag cannot take a round, or nil. A round fixes what a failed final stage found, or
// the open issues inside the goal that a finished run left, and the dag gets MaxFinalRounds final stages in all,
// the first included. After a failed last round the call is the human's; after a finished one the rest is chunks.
func CheckFixRound(g *waveobj.TaskGroup) error {
	if g.Status == DagStatus_Cancelled {
		return fmt.Errorf("dag %s is cancelled", g.OID)
	}
	if g.Final == nil || !finalTerminal(g.Final.State) {
		state := "not started"
		if g.Final != nil && g.Final.State != "" {
			state = g.Final.State
		}
		return fmt.Errorf("the final stage has not finished (it is %s); a round only follows a finished final stage", state)
	}
	if g.Final.Round >= MaxFinalRounds {
		if g.Final.State == FinalState_Failed {
			return fmt.Errorf("no fix rounds left; forward to the human: the final stage failed round %d of %d", g.Final.Round, MaxFinalRounds)
		}
		return fmt.Errorf("no rounds left: the final stage %s round %d of %d; add what is left as effort chunks", g.Final.State, g.Final.Round, MaxFinalRounds)
	}
	return nil
}

// CheckFixPlanCommands refuses a fix plan whose Verify, Setup, Check or Final line differs from the run's. A round
// runs the run's own commands, so a changed one would otherwise be dropped without a word, and a round that could
// replace them could also weaken the check it has to pass. A line the fix plan leaves out, or repeats, is fine.
func CheckFixPlanCommands(g *waveobj.TaskGroup, verify, setup, check, final string) error {
	for _, c := range []struct{ label, plan, run string }{
		{"Verify", verify, g.Verify},
		{"Setup", setup, g.Setup},
		{"Check", check, g.Check},
		{"Final", final, g.FinalCmd},
	} {
		plan := strings.TrimSpace(c.plan)
		if plan != "" && plan != strings.TrimSpace(c.run) {
			return fmt.Errorf("a fix round runs the run's own commands, and the fix plan's **%s:** line `%s` differs from the run's `%s`: drop the line from the fix plan. If the run's %s cannot pass for a reason outside the code, put that to the human, who can end the final stage", c.label, plan, c.run, c.label)
		}
	}
	return nil
}

// AppendRound extends a dag whose final stage finished with a fix plan's tasks, numbered on from its last task,
// and sets up the next final round, which starts once they land. The dag keeps its Verify, Setup, Check, Final
// and plan review: a fix round is not plan-reviewed, though each of its tasks is. planPath is the fix plan as
// the dag stores its docs, repo-relative for a branch-landed dag; each task's description names it.
func AppendRound(ctx context.Context, dagID, planPath string, tasks []waveobj.TaskNode) (*waveobj.TaskGroup, error) {
	var out *waveobj.TaskGroup
	err := withDagMutation(dagID, func() error {
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		if err := CheckFixRound(g); err != nil {
			return err
		}
		round := g.Final.Round + 1
		appended, err := roundTasks(len(g.Tasks), round, planPath, tasks)
		if err != nil {
			return err
		}
		all := append(slices.Clone(g.Tasks), appended...)
		if err := ValidateTasks(all); err != nil {
			return err
		}
		g.Tasks = all
		// the round switch shows the failed round beside the new one
		g.PastFinals = append(g.PastFinals, *g.Final)
		// an empty State is a round not started: the final stage starts it again when the new tasks land
		g.Final = &waveobj.FinalStage{Round: round}
		RecomputeDagStatus(g)
		g.UpdatedTs = time.Now().UnixMilli()
		if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
			*cur = *g
			return nil
		}); err != nil {
			return err
		}
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
		out = g
		return nil
	})
	return out, err
}

// roundTasks renumbers a fix plan's tasks t-(n+1)… after the dag's n, and maps their Depends from the fix
// plan's own numbers. A fix task cannot depend on the earlier tasks: they all landed.
func roundTasks(n, round int, planPath string, tasks []waveobj.TaskNode) ([]waveobj.TaskNode, error) {
	if len(tasks) == 0 {
		return nil, fmt.Errorf("the fix plan has no tasks")
	}
	ids := make(map[string]string, len(tasks))
	for i, t := range tasks {
		ids[t.ID] = fmt.Sprintf("t-%d", n+i+1)
	}
	out := make([]waveobj.TaskNode, len(tasks))
	for i, t := range tasks {
		var deps []string
		for _, d := range t.Deps {
			id, ok := ids[d]
			if !ok {
				return nil, fmt.Errorf("fix plan task %d depends on %q, which is not in the fix plan", i+1, d)
			}
			deps = append(deps, id)
		}
		t.ID, t.Deps, t.State = ids[t.ID], deps, TaskState_Pending
		if planPath != "" {
			line := fmt.Sprintf(fixRoundLineFmt, round, i+1, planPath)
			if t.Description == "" {
				t.Description = line
			} else {
				t.Description = line + "\n\n" + t.Description
			}
		}
		out[i] = t
	}
	return out, nil
}

// roundDescription is a task's description for a reader working in tree: a fix-round task's plan path resolved
// there, as DocPath resolves the run's own docs.
func roundDescription(g *waveobj.TaskGroup, desc, tree string) string {
	m := fixRoundLineRe.FindStringSubmatchIndex(desc)
	if m == nil {
		return desc
	}
	return desc[:m[2]] + DocPath(g, tree, desc[m[2]:m[3]]) + desc[m[3]:]
}
