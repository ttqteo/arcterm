// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// A session can write its report and then never get its `wsh jarvis complete` through before the timeout (a starved
// machine, a hung RPC). Its run stays unfinished and the session is lost, but the report is on disk: the watcher
// delivers it instead of failing.

// seedLostSessionRun appends an unfinished run of role to a fresh channel and returns the channel id and the run.
func seedLostSessionRun(t *testing.T, ctx context.Context, role string) (string, waveobj.Run) {
	t.Helper()
	ch, err := wstore.CreateChannel(ctx, "lost", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("session", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.StageRole = role
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	return ch.OID, run
}

func writeSessionReport(t *testing.T, k *sessionKind, tabId string, startedTs int64, body string) {
	t.Helper()
	path := sessionReportPath(k, tabId, startedTs)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(path) })
}

func TestBuilderCheckLostWithItsReportDelivers(t *testing.T) {
	ctx := context.Background()
	_, file := seedBrainstorm(t, testSpecRel, true)
	tabId, blockId := seedAgentTab(t, ctx, nil)
	chId, run := seedLostSessionRun(t, ctx, jarvis.UsageRole_BuilderCheck)
	stopped := stubStopStageSession(t)
	delivered := stubDeliver(t)

	now := time.Now().UnixMilli()
	started := now - orchestrate.ReviewTimeout.Milliseconds() - 1
	writeSessionReport(t, builderCheckKind, tabId, started, "1. Should a paused consumer page?")
	c := brainstormSession{Kind: builderCheckKind, TabId: tabId, BlockId: blockId, File: file, RunId: run.ID, ChannelId: chId, StartedTs: started}
	if !tickBrainstormSession(ctx, c, now) {
		t.Fatal("a lost session with its report on disk did not settle the check")
	}
	path := brainstormcheck.ReportPath(file)
	if got, err := os.ReadFile(path); err != nil || string(got) != "1. Should a paused consumer page?" {
		t.Fatalf("report file = %q, %v, want the report the session wrote", got, err)
	}
	if len(*delivered) != 1 || (*delivered)[0] != (sentLine{blockId, brainstormcheck.Line(path)}) {
		t.Fatalf("delivered %+v, want the check's line", *delivered)
	}
	if len(*stopped) != 1 || (*stopped)[0] != run.ID {
		t.Fatalf("stopped %v, want the hung session's run %s", *stopped, run.ID)
	}
	if meta := tabMeta(t, ctx, tabId); meta.GetString(waveobj.MetaKey_BrainstormCheckState, "") != brainstormAnswered {
		t.Fatalf("record = %v, want answered", meta)
	}
}

func TestJudgeLostWithItsReportDelivers(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UnixMilli()
	started := now - orchestrate.ReviewTimeout.Milliseconds() - 1
	_, file := seedJudgeBrainstorm(t, 5)
	// a judge can be stopped, so the watcher acts only while the tab still holds its reading record
	tabId, blockId := seedAgentTab(t, ctx, readingJudge(started))
	chId, run := seedLostSessionRun(t, ctx, jarvis.UsageRole_BrainstormJudge)
	stubStopStageSession(t)
	delivered := stubDeliver(t)

	writeSessionReport(t, judgeKind, tabId, started, goodJudgeReport)
	c := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, RunId: run.ID, ChannelId: chId, StartedTs: started}
	if !tickBrainstormSession(ctx, c, now) {
		t.Fatal("a lost judge with its result on disk did not settle")
	}
	got, err := os.ReadFile(brainstormcheck.JudgeResultPath(file))
	if err != nil || !strings.Contains(string(got), `"Page"`) {
		t.Fatalf("judge.json = %q, %v, want the result the judge wrote", got, err)
	}
	if len(*delivered) != 1 {
		t.Fatalf("delivered %+v, want the judged line", *delivered)
	}
	if meta := tabMeta(t, ctx, tabId); meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormAnswered {
		t.Fatalf("record = %v, want answered", meta)
	}
}

func TestJudgeLostWithAnUnusableReportStillFails(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UnixMilli()
	started := now - orchestrate.ReviewTimeout.Milliseconds() - 1
	_, file := seedJudgeBrainstorm(t, 5)
	// a judge can be stopped, so the watcher acts only while the tab still holds its reading record
	tabId, blockId := seedAgentTab(t, ctx, readingJudge(started))
	chId, run := seedLostSessionRun(t, ctx, jarvis.UsageRole_BrainstormJudge)
	stubStopStageSession(t)
	stubDeliver(t)

	writeSessionReport(t, judgeKind, tabId, started, `{"options":[`)
	c := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, RunId: run.ID, ChannelId: chId, StartedTs: started}
	if !tickBrainstormSession(ctx, c, now) {
		t.Fatal("a lost judge did not settle")
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormFailed {
		t.Fatalf("record = %v, want failed: a half-written result is no verdict", meta)
	}
}

func TestSessionStillReadingLeavesItsReportAlone(t *testing.T) {
	ctx := context.Background()
	_, file := seedBrainstorm(t, testSpecRel, true)
	tabId, blockId := seedAgentTab(t, ctx, nil)
	chId, run := seedLostSessionRun(t, ctx, jarvis.UsageRole_BuilderCheck)
	stubStopStageSession(t)
	delivered := stubDeliver(t)

	now := time.Now().UnixMilli()
	writeSessionReport(t, builderCheckKind, tabId, now, "1. half written")
	c := brainstormSession{Kind: builderCheckKind, TabId: tabId, BlockId: blockId, File: file, RunId: run.ID, ChannelId: chId, StartedTs: now}
	if tickBrainstormSession(ctx, c, now) {
		t.Fatal("a session inside its time settled early from a report it may still be writing")
	}
	if len(*delivered) != 0 {
		t.Fatalf("delivered %+v while the session still works", *delivered)
	}
}
