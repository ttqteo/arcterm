// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// usageLine is one Claude assistant message with its usage, in the shape usagestats reads.
func usageLine(msgId, model string, input, output, cacheRead, cacheWrite, cacheWrite1h int) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":"2026-09-25T10:00:00.000Z","requestId":"req_%s","message":{"id":"%s","model":"%s","usage":{"input_tokens":%d,"output_tokens":%d,"cache_read_input_tokens":%d,"cache_creation_input_tokens":%d,"cache_creation":{"ephemeral_1h_input_tokens":%d}}}}`,
		msgId, msgId, model, input, output, cacheRead, cacheWrite, cacheWrite1h)
}

// usageRoot points transcript lookups at a temp dir, returning it.
func usageRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	prev := transcriptRootFor
	transcriptRootFor = func(string) string { return root }
	t.Cleanup(func() { transcriptRootFor = prev })
	return root
}

func writeClaudeSession(t *testing.T, root, cwd, sessionId string, lines ...string) {
	t.Helper()
	writeSessionLines(t, filepath.Join(root, agentobserve.SlugifyCwd(cwd), sessionId+".jsonl"), lines)
}

// A relaunched lead's first session counts as well as its last; each child is one row per model, a task's
// worker before its reviewer, tasks in number order; a child whose transcript is gone is a zero row marked
// missing, and a child launched without a session id has no transcript to count.
func TestRunUsageCountsEveryLeadSessionAndEachChild(t *testing.T) {
	root := usageRoot(t)
	lead, wt1 := t.TempDir(), t.TempDir()
	writeClaudeSession(t, root, lead, "lead-1", usageLine("a", "claude-opus", 10, 20, 300, 40, 0))
	writeClaudeSession(t, root, lead, "lead-2",
		usageLine("b", "claude-opus", 1, 2, 30, 4, 0),
		usageLine("c", "claude-opus", 1, 2, 30, 4, 0))
	writeClaudeSession(t, root, wt1, "work-1",
		usageLine("d", "claude-sonnet", 100, 200, 3000, 400, 150),
		usageLine("e", "claude-haiku", 5, 5, 5, 0, 0))
	writeClaudeSession(t, root, wt1, "review-1", usageLine("f", "claude-sonnet", 7, 8, 9, 0, 0))

	owner := &waveobj.Run{ID: "r", Runtime: "claude", ProjectPath: lead, SessionId: "lead-2", LeadSessionIds: []string{"lead-1", "lead-2"}}
	children := []*waveobj.Run{
		{ID: "c4", Runtime: "claude", ProjectPath: t.TempDir(), TaskId: "t-10", SessionId: "gone-10"},
		{ID: "c1", Runtime: "claude", ProjectPath: wt1, TaskId: "t-1", Review: true, SessionId: "review-1"},
		{ID: "c3", Runtime: "claude", ProjectPath: t.TempDir(), TaskId: "t-2", SessionId: "gone-2"},
		{ID: "c0", Runtime: "claude", ProjectPath: wt1, TaskId: "t-1", SessionId: "work-1"},
		{ID: "c5", Runtime: "claude", ProjectPath: wt1, TaskId: "t-3"},
	}
	got := RunUsage(context.Background(), owner, children)
	want := []waveobj.UsageRow{
		{Role: "lead", Model: "claude-opus", Input: 10, Output: 20, CacheRead: 300, CacheWrite: 40, Msgs: 1},
		{Role: "lead", Model: "claude-opus", Input: 2, Output: 4, CacheRead: 60, CacheWrite: 8, Msgs: 2},
		{Role: "worker", TaskId: "t-1", Model: "claude-haiku", Input: 5, Output: 5, CacheRead: 5, Msgs: 1},
		{Role: "worker", TaskId: "t-1", Model: "claude-sonnet", Input: 100, Output: 200, CacheRead: 3000, CacheWrite: 250, CacheWrite1h: 150, Msgs: 1},
		{Role: "reviewer", TaskId: "t-1", Model: "claude-sonnet", Input: 7, Output: 8, CacheRead: 9, Msgs: 1},
		{Role: "worker", TaskId: "t-2", Missing: true},
		{Role: "worker", TaskId: "t-10", Missing: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("RunUsage =\n%+v\nwant\n%+v", got, want)
	}
}

// A run from before lead sessions were recorded still counts the one session it names.
func TestRunUsageFallsBackToTheLastLeadSession(t *testing.T) {
	root := usageRoot(t)
	lead := t.TempDir()
	writeClaudeSession(t, root, lead, "only", usageLine("a", "claude-opus", 1, 2, 3, 4, 0))
	owner := &waveobj.Run{ID: "r", Runtime: "claude", ProjectPath: lead, SessionId: "only"}
	got := RunUsage(context.Background(), owner, nil)
	want := []waveobj.UsageRow{{Role: "lead", Model: "claude-opus", Input: 1, Output: 2, CacheRead: 3, CacheWrite: 4, Msgs: 1}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("RunUsage = %+v, want %+v", got, want)
	}
}

// The seal totals a dag owner's run, the lead's wrap-up included, from the runs sharing its dag; a child's
// seal totals nothing.
func TestSealEvidenceTotalsADagOwnersUsage(t *testing.T) {
	ctx := context.Background()
	root := usageRoot(t)
	lead, wt := t.TempDir(), t.TempDir()
	writeClaudeSession(t, root, lead, "lead-1", usageLine("a", "claude-opus", 1, 1, 1, 1, 0))
	writeClaudeSession(t, root, wt, "work-1", usageLine("b", "claude-opus", 2, 2, 2, 2, 0))
	ch, err := wstore.CreateChannel(ctx, "usage-seal", "/p")
	if err != nil {
		t.Fatal(err)
	}
	owner := waveobj.Run{ID: "usage-owner", Runtime: "claude", ProjectPath: lead, DagORef: "dag:usage", LeadSessionIds: []string{"lead-1"}, CreatedTs: 1000}
	child := waveobj.Run{ID: "usage-child", Runtime: "claude", ProjectPath: wt, DagORef: "dag:usage", TaskId: "t-1", SessionId: "work-1", CreatedTs: 1001}
	other := waveobj.Run{ID: "usage-other", Runtime: "claude", ProjectPath: wt, DagORef: "dag:elsewhere", TaskId: "t-1", SessionId: "work-1", CreatedTs: 1002}
	for _, r := range []waveobj.Run{owner, child, other} {
		if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}
	stored, err := wstore.GetRun(ctx, ch.OID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := SealEvidence(ctx, stored); err != nil {
		t.Fatal(err)
	}
	want := []waveobj.UsageRow{
		{Role: "lead", Model: "claude-opus", Input: 1, Output: 1, CacheRead: 1, CacheWrite: 1, Msgs: 1},
		{Role: "worker", TaskId: "t-1", Model: "claude-opus", Input: 2, Output: 2, CacheRead: 2, CacheWrite: 2, Msgs: 1},
	}
	if !reflect.DeepEqual(stored.Evidence.Usage, want) {
		t.Errorf("owner usage = %+v, want %+v", stored.Evidence.Usage, want)
	}
	storedChild, err := wstore.GetRun(ctx, ch.OID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := SealEvidence(ctx, storedChild); err != nil {
		t.Fatal(err)
	}
	if storedChild.Evidence.Usage != nil {
		t.Errorf("child usage = %+v, want none", storedChild.Evidence.Usage)
	}
}

// a plan reviewer, a verifier or a land resolver works no task, so without its StageRole it would count as the lead
func TestUsageRoleOfAStageSession(t *testing.T) {
	cases := []struct {
		run  waveobj.Run
		want string
	}{
		{waveobj.Run{StageRole: UsageRole_PlanReviewer}, UsageRole_PlanReviewer},
		{waveobj.Run{StageRole: UsageRole_Verifier}, UsageRole_Verifier},
		{waveobj.Run{StageRole: UsageRole_LandResolver}, UsageRole_LandResolver},
		{waveobj.Run{TaskId: "t-1", Review: true}, UsageRole_Reviewer},
		{waveobj.Run{TaskId: "t-1"}, UsageRole_Worker},
		{waveobj.Run{}, UsageRole_Lead},
	}
	for _, c := range cases {
		if got := UsageRole(&c.run); got != c.want {
			t.Errorf("UsageRole(%+v) = %q, want %q", c.run, got, c.want)
		}
	}
}
