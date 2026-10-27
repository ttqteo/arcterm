// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const testSpecRel = "docs/spec.md"

// seedBrainstorm writes a project with a brainstorm.json naming spec, and the spec file when writeSpec is set.
// It returns the project dir and the brainstorm file.
func seedBrainstorm(t *testing.T, spec string, writeSpec bool) (string, string) {
	t.Helper()
	project := t.TempDir()
	topic := filepath.Join(project, ".superpowers", "brainstorm", "lag-alerts")
	if err := os.MkdirAll(topic, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(topic, "brainstorm.json")
	body := `{"title":"Lag alerts"}`
	if spec != "" {
		body = `{"title":"Lag alerts","spec":"` + spec + `"}`
	}
	if err := os.WriteFile(file, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if writeSpec {
		path := filepath.Join(project, filepath.FromSlash(testSpecRel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("# spec"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return project, file
}

// seedAgentTab inserts a workspace holding a tab whose first block is the agent's. It returns the tab and block ids.
func seedAgentTab(t *testing.T, ctx context.Context, meta waveobj.MetaMapType) (string, string) {
	t.Helper()
	tabId, blockId := uuid.NewString(), uuid.NewString()
	if meta == nil {
		meta = waveobj.MetaMapType{}
	}
	for _, obj := range []waveobj.WaveObj{
		&waveobj.Workspace{OID: uuid.NewString(), TabIds: []string{tabId}},
		&waveobj.Tab{OID: tabId, BlockIds: []string{blockId}, Meta: meta},
		&waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId},
	} {
		if err := wstore.DBInsert(ctx, obj); err != nil {
			t.Fatalf("DBInsert: %v", err)
		}
	}
	return tabId, blockId
}

func tabMeta(t *testing.T, ctx context.Context, tabId string) waveobj.MetaMapType {
	t.Helper()
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		t.Fatalf("loading tab: %v", err)
	}
	return tab.Meta
}

func stubArmBrainstormSession(t *testing.T) *[]brainstormSession {
	t.Helper()
	var armed []brainstormSession
	old := armBrainstormSession
	armBrainstormSession = func(c brainstormSession) { armed = append(armed, c) }
	t.Cleanup(func() { armBrainstormSession = old })
	return &armed
}

func stubLaunchBrainstormSession(t *testing.T, runId string, err error) *[]orchestrate.JudgingSession {
	t.Helper()
	var launched []orchestrate.JudgingSession
	old := launchBrainstormSession
	launchBrainstormSession = func(_ context.Context, s orchestrate.JudgingSession) (string, error) {
		launched = append(launched, s)
		return runId, err
	}
	t.Cleanup(func() { launchBrainstormSession = old })
	return &launched
}

func TestBrainstormCheckRefusals(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	_, noSpec := seedBrainstorm(t, "", false)
	_, missingSpec := seedBrainstorm(t, testSpecRel, false)
	_, good := seedBrainstorm(t, testSpecRel, true)
	_, block := seedAgentTab(t, ctx, nil)
	_, readingBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{waveobj.MetaKey_BrainstormCheckState: brainstormReading})

	for _, tc := range []struct {
		name, block, file, want string
	}{
		{"no file", block, "", "a block id and a brainstorm file are required"},
		{"no spec", block, noSpec, "names no spec"},
		{"a missing spec file", block, missingSpec, "does not exist"},
		{"already reading", readingBlock, good, "a builder check is already running"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := (&WshServer{}).BrainstormCheckCommand(ctx, wshrpc.CommandBrainstormCheckData{BlockId: tc.block, File: tc.file})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one containing %q", err, tc.want)
			}
		})
	}
	if len(*armed) != 0 {
		t.Fatalf("a refused check armed a watcher: %+v", *armed)
	}
}

func TestBrainstormCheckLaunchWritesReadingThenTheRun(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	launched := stubLaunchBrainstormSession(t, "run-1", nil)
	project, file := seedBrainstorm(t, testSpecRel, true)
	tabId, blockId := seedAgentTab(t, ctx, waveobj.MetaMapType{waveobj.MetaKey_SessionProject: "lag"})

	if err := (&WshServer{}).BrainstormCheckCommand(ctx, wshrpc.CommandBrainstormCheckData{BlockId: blockId, File: file}); err != nil {
		t.Fatalf("BrainstormCheckCommand: %v", err)
	}
	meta := tabMeta(t, ctx, tabId)
	if got := meta.GetString(waveobj.MetaKey_BrainstormCheckState, ""); got != brainstormReading {
		t.Fatalf("checkstate = %q, want reading", got)
	}
	if meta.GetFloat(waveobj.MetaKey_BrainstormCheckTs, 0) == 0 || meta.HasKey(waveobj.MetaKey_BrainstormCheckRun) {
		t.Fatalf("reading record = %v, want a checkts and no checkrun yet", meta)
	}
	if len(*armed) != 1 {
		t.Fatalf("armed %d watchers, want 1", len(*armed))
	}
	c := (*armed)[0]
	if c.TabId != tabId || c.BlockId != blockId || c.File != file || c.Project != project {
		t.Fatalf("armed %+v, want the tab, block, file and project", c)
	}

	if err := launchSessionRun(ctx, &c); err != nil {
		t.Fatalf("launchSessionRun: %v", err)
	}
	ch, err := wstore.ChannelAtPath(ctx, project)
	if err != nil || ch == nil {
		t.Fatalf("the project's channel: %v %v", ch, err)
	}
	s := (*launched)[0]
	if s.ChannelId != ch.OID || s.WorkspaceId == "" || s.DagORef != "" || s.Role != jarvis.UsageRole_BuilderCheck ||
		s.Tree != project || s.Label != "Builder check · Lag alerts" {
		t.Fatalf("launched %+v, want a builder-check session in the project's channel and tree", s)
	}
	if spec := filepath.Join(project, filepath.FromSlash(testSpecRel)); !strings.Contains(s.Prompt, spec) {
		t.Fatalf("prompt does not name the spec %s", spec)
	}
	meta = tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormCheckState, "") != brainstormReading ||
		meta.GetString(waveobj.MetaKey_BrainstormCheckRun, "") != "run-1" ||
		meta.GetString(waveobj.MetaKey_BrainstormCheckChannel, "") != ch.OID {
		t.Fatalf("record after launch = %v, want reading with checkrun run-1 and checkchannel %s", meta, ch.OID)
	}
}

func TestBuilderCheckRouteChain(t *testing.T) {
	ctx := context.Background()
	profileRoute := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}
	for _, tc := range []struct {
		name     string
		override *waveobj.ProfileOverride
		agent    string
		want     waveobj.RoutePin
	}{
		{"the profile's reviewer route", &waveobj.ProfileOverride{ReviewerRoute: profileRoute}, "claude", *profileRoute},
		{"the agent's runtime", nil, "pi", waveobj.RoutePin{Runtime: "pi"}},
		{"no agent falls to the default runtime", nil, "", waveobj.RoutePin{Runtime: "claude"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			launched := stubLaunchBrainstormSession(t, "run-1", nil)
			project, file := seedBrainstorm(t, testSpecRel, true)
			ch, err := wstore.CreateChannel(ctx, "route", project)
			if err != nil {
				t.Fatalf("CreateChannel: %v", err)
			}
			if tc.override != nil {
				seedProfileMeta(t, ctx, ch.OID, tc.override)
			}
			meta := waveobj.MetaMapType{}
			if tc.agent != "" {
				meta[waveobj.MetaKey_SessionAgent] = tc.agent
			}
			tabId, blockId := seedAgentTab(t, ctx, meta)
			c, err := readBrainstormForCheck(file)
			if err != nil {
				t.Fatal(err)
			}
			c.TabId, c.BlockId = tabId, blockId
			if err := launchSessionRun(ctx, &c); err != nil {
				t.Fatalf("launchSessionRun: %v", err)
			}
			if got := (*launched)[0].Route; got != tc.want {
				t.Fatalf("route = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestBuilderCheckDeliversTheReport(t *testing.T) {
	ctx := context.Background()
	_, file := seedBrainstorm(t, testSpecRel, true)
	tabId, blockId := seedAgentTab(t, ctx, nil)
	oldRead := readBrainstormRun
	readBrainstormRun = func(_ context.Context, _, runId string) (*waveobj.Run, error) {
		return &waveobj.Run{ID: runId, Status: jarvis.RunStatus_Done, Report: "1. Should a paused consumer page?"}, nil
	}
	t.Cleanup(func() { readBrainstormRun = oldRead })
	type sent struct{ block, text string }
	var delivered []sent
	oldDeliver := deliverAgentMessage
	deliverAgentMessage = func(block, text string) { delivered = append(delivered, sent{block, text}) }
	t.Cleanup(func() { deliverAgentMessage = oldDeliver })

	c := brainstormSession{Kind: builderCheckKind, TabId: tabId, BlockId: blockId, File: file, RunId: "run-1", ChannelId: "ch-1", StartedTs: 1}
	if !tickBrainstormSession(ctx, c, time.Now().UnixMilli()) {
		t.Fatal("a done run with a report did not settle the check")
	}
	path := brainstormcheck.ReportPath(file)
	if got, err := os.ReadFile(path); err != nil || string(got) != "1. Should a paused consumer page?" {
		t.Fatalf("report file = %q, %v, want the run's report", got, err)
	}
	if len(delivered) != 1 || delivered[0] != (sent{blockId, brainstormcheck.Line(path)}) {
		t.Fatalf("delivered %+v, want the line for %s to block %s", delivered, path, blockId)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormCheckState, "") != brainstormAnswered ||
		meta.GetString(waveobj.MetaKey_BrainstormCheckRun, "") != "run-1" || meta.HasKey(waveobj.MetaKey_BrainstormCheckReason) {
		t.Fatalf("record = %v, want answered for run-1 with no reason", meta)
	}
}

func TestBuilderCheckLostRunStopsAndFails(t *testing.T) {
	ctx := context.Background()
	_, file := seedBrainstorm(t, testSpecRel, true)
	tabId, blockId := seedAgentTab(t, ctx, nil)
	ch, err := wstore.CreateChannel(ctx, "lost", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("check", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.StageRole = jarvis.UsageRole_BuilderCheck
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	var stopped []string
	oldStop := stopStageSession
	stopStageSession = func(r waveobj.Run) { stopped = append(stopped, r.ID) }
	t.Cleanup(func() { stopStageSession = oldStop })

	now := time.Now().UnixMilli()
	c := brainstormSession{Kind: builderCheckKind, TabId: tabId, BlockId: blockId, File: file, RunId: run.ID, ChannelId: ch.OID,
		StartedTs: now - orchestrate.ReviewTimeout.Milliseconds() - 1}
	if !tickBrainstormSession(ctx, c, now) {
		t.Fatal("a session past its timeout did not settle the check")
	}
	if len(stopped) != 1 || stopped[0] != run.ID {
		t.Fatalf("stopped %v, want the reviewer's run %s", stopped, run.ID)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormCheckState, "") != brainstormFailed ||
		!strings.Contains(meta.GetString(waveobj.MetaKey_BrainstormCheckReason, ""), "no verdict") {
		t.Fatalf("record = %v, want failed with the lost reason", meta)
	}
}

func TestBuilderCheckLaunchErrorFails(t *testing.T) {
	ctx := context.Background()
	stubLaunchBrainstormSession(t, "", errors.New("pi is not installed"))
	_, file := seedBrainstorm(t, testSpecRel, true)
	tabId, blockId := seedAgentTab(t, ctx, nil)
	c, err := readBrainstormForCheck(file)
	if err != nil {
		t.Fatal(err)
	}
	c.TabId, c.BlockId, c.StartedTs = tabId, blockId, 1

	watchBrainstormSession(ctx, c) // returns at once: the launch failed

	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormCheckState, "") != brainstormFailed ||
		meta.GetString(waveobj.MetaKey_BrainstormCheckReason, "") != "Arc could not start the builder: pi is not installed" {
		t.Fatalf("record = %v, want failed with the launch error", meta)
	}
}

func TestResumeBuilderChecksRearmsOrFails(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	stubDeliver(t) // the sweep also fails other tests' reading judges, which send a line
	_, file := seedBrainstorm(t, testSpecRel, true)
	launchedTab, launchedBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormCheckState:   brainstormReading,
		waveobj.MetaKey_BrainstormCheckTs:      42,
		waveobj.MetaKey_BrainstormCheckRun:     "run-1",
		waveobj.MetaKey_BrainstormCheckChannel: "ch-1",
		waveobj.MetaKey_SessionBrainstorm:      file,
	})
	unlaunchedTab, _ := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormCheckState: brainstormReading,
		waveobj.MetaKey_BrainstormCheckTs:    42,
		waveobj.MetaKey_SessionBrainstorm:    file,
	})

	ResumeBrainstormSessions(ctx)

	var rearmed *brainstormSession
	for i := range *armed {
		if (*armed)[i].TabId == launchedTab {
			rearmed = &(*armed)[i]
		}
		if (*armed)[i].TabId == unlaunchedTab {
			t.Fatal("a check with no run was re-armed")
		}
	}
	want := brainstormSession{Kind: builderCheckKind, TabId: launchedTab, BlockId: launchedBlock, File: file, RunId: "run-1", ChannelId: "ch-1", StartedTs: 42}
	if rearmed == nil || *rearmed != want {
		t.Fatalf("re-armed %+v, want %+v", rearmed, want)
	}
	if got := tabMeta(t, ctx, launchedTab).GetString(waveobj.MetaKey_BrainstormCheckState, ""); got != brainstormReading {
		t.Fatalf("re-armed check state = %q, want still reading", got)
	}
	meta := tabMeta(t, ctx, unlaunchedTab)
	if meta.GetString(waveobj.MetaKey_BrainstormCheckState, "") != brainstormFailed ||
		meta.GetString(waveobj.MetaKey_BrainstormCheckReason, "") != builderCheckRestartedReason {
		t.Fatalf("unlaunched record = %v, want failed: %s", meta, builderCheckRestartedReason)
	}
}

type sentLine struct{ block, text string }

func stubDeliver(t *testing.T) *[]sentLine {
	t.Helper()
	var delivered []sentLine
	old := deliverAgentMessage
	deliverAgentMessage = func(block, text string) { delivered = append(delivered, sentLine{block, text}) }
	t.Cleanup(func() { deliverAgentMessage = old })
	return &delivered
}

func stubReadBrainstormRun(t *testing.T, run *waveobj.Run) {
	t.Helper()
	old := readBrainstormRun
	readBrainstormRun = func(context.Context, string, string) (*waveobj.Run, error) { return run, nil }
	t.Cleanup(func() { readBrainstormRun = old })
}

const judgeAgentLean = "AGENT-LEAN-NEVER-SHOWN"

// seedJudgeBrainstorm writes a project with a brainstorm.json whose open question lists n named approaches.
// It returns the project dir and the brainstorm file.
func seedJudgeBrainstorm(t *testing.T, n int) (string, string) {
	t.Helper()
	project := t.TempDir()
	topic := filepath.Join(project, ".superpowers", "brainstorm", "lag-alerts")
	if err := os.MkdirAll(topic, 0o755); err != nil {
		t.Fatal(err)
	}
	var approaches []string
	for i := range n {
		approaches = append(approaches, `{"name":"Approach `+string(rune('A'+i))+`","description":"one way","facts":["a fact"]}`)
	}
	body := `{"title":"Lag alerts","question":{"text":"How should a lagging consumer alert?","why":"` + judgeAgentLean +
		`","approaches":[` + strings.Join(approaches, ",") + `]}}`
	file := filepath.Join(topic, "brainstorm.json")
	if err := os.WriteFile(file, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return project, file
}

const goodJudgeReport = `{"options":[{"label":"Page","detail":"Page the on-call.","pick":true},` +
	`{"label":"Digest","detail":"Mail a daily digest."}],"read":"Paging rests on the existing pager.","added":[],` +
	`"dropped":[{"name":"Approach C","reason":"No sink for it."}]}`

func TestBrainstormJudgeRefusals(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	launched := stubLaunchBrainstormSession(t, "run-1", nil)
	_, good := seedJudgeBrainstorm(t, 5)
	_, four := seedJudgeBrainstorm(t, 4)
	_, noQuestion := seedBrainstorm(t, "", false)
	_, block := seedAgentTab(t, ctx, nil)
	_, readingBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{waveobj.MetaKey_BrainstormJudgeState: brainstormReading})

	for _, tc := range []struct {
		name, block, file, want string
	}{
		{"no block", "", good, "a block id and a brainstorm file are required"},
		{"a relative path", block, filepath.Join(".superpowers", "brainstorm", "x", "brainstorm.json"), "must be an absolute path"},
		{"no question", block, noQuestion, "no open question"},
		{"four approaches", block, four, "lists 4 named approaches"},
		{"already reading", readingBlock, good, judgeKind.busy},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := (&WshServer{}).BrainstormJudgeCommand(ctx, wshrpc.CommandBrainstormJudgeData{BlockId: tc.block, File: tc.file})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one containing %q", err, tc.want)
			}
		})
	}
	if len(*armed) != 0 || len(*launched) != 0 {
		t.Fatalf("a refused judge armed %+v and launched %+v", *armed, *launched)
	}
}

func TestBrainstormJudgeIgnoresABuilderCheck(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	_, judgeFile := seedJudgeBrainstorm(t, 5)
	_, checkFile := seedBrainstorm(t, testSpecRel, true)
	_, checkingBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{waveobj.MetaKey_BrainstormCheckState: brainstormReading})
	_, judgingBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{waveobj.MetaKey_BrainstormJudgeState: brainstormReading})

	if err := (&WshServer{}).BrainstormJudgeCommand(ctx, wshrpc.CommandBrainstormJudgeData{BlockId: checkingBlock, File: judgeFile}); err != nil {
		t.Fatalf("a reading builder check refused the judge: %v", err)
	}
	if err := (&WshServer{}).BrainstormCheckCommand(ctx, wshrpc.CommandBrainstormCheckData{BlockId: judgingBlock, File: checkFile}); err != nil {
		t.Fatalf("a reading judge refused the builder check: %v", err)
	}
	if len(*armed) != 2 || (*armed)[0].Kind != judgeKind || (*armed)[1].Kind != builderCheckKind {
		t.Fatalf("armed %+v, want a judge then a builder check", *armed)
	}
}

func TestBrainstormJudgeLaunchWritesReadingThenTheRun(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	launched := stubLaunchBrainstormSession(t, "run-1", nil)
	project, file := seedJudgeBrainstorm(t, 6)
	ch, err := wstore.CreateChannel(ctx, "lag", project)
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{ReviewerRoute: &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}})
	tabId, blockId := seedAgentTab(t, ctx, waveobj.MetaMapType{waveobj.MetaKey_SessionAgent: "pi"})
	const line = "double check the digest one"

	if err := (&WshServer{}).BrainstormJudgeCommand(ctx, wshrpc.CommandBrainstormJudgeData{BlockId: blockId, File: file, Line: line}); err != nil {
		t.Fatalf("BrainstormJudgeCommand: %v", err)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormReading ||
		meta.GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0) == 0 || meta.HasKey(waveobj.MetaKey_BrainstormJudgeRun) {
		t.Fatalf("reading record = %v, want reading with a judgets and no judgerun yet", meta)
	}
	if meta.HasKey(waveobj.MetaKey_BrainstormCheckState) {
		t.Fatalf("the judge wrote the builder check's record: %v", meta)
	}
	if len(*armed) != 1 {
		t.Fatalf("armed %d watchers, want 1", len(*armed))
	}
	c := (*armed)[0]
	if c.Kind != judgeKind || c.TabId != tabId || c.BlockId != blockId || c.File != file || c.Project != project || c.Line != line {
		t.Fatalf("armed %+v, want a judge for the tab, block, file, project and line", c)
	}

	if err := launchSessionRun(ctx, &c); err != nil {
		t.Fatalf("launchSessionRun: %v", err)
	}
	s := (*launched)[0]
	if s.ChannelId != ch.OID || s.WorkspaceId == "" || s.Role != jarvis.UsageRole_BrainstormJudge || s.Tree != project ||
		!strings.HasPrefix(s.Label, "Judge · ") {
		t.Fatalf("launched %+v, want a brainstorm-judge session labeled Judge in the project's channel and tree", s)
	}
	if want := (waveobj.RoutePin{Runtime: "claude", Model: "opus"}); s.Route != want {
		t.Fatalf("route = %+v, want %+v whatever the agent's runtime and the reviewer route", s.Route, want)
	}
	for i := range 6 {
		if name := "Approach " + string(rune('A'+i)); !strings.Contains(s.Prompt, name) {
			t.Fatalf("the prompt lacks %q", name)
		}
	}
	if !strings.Contains(s.Prompt, line) || strings.Contains(s.Prompt, judgeAgentLean) {
		t.Fatalf("the prompt must hold the line %q and never the agent's why", line)
	}
	meta = tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormReading ||
		meta.GetString(waveobj.MetaKey_BrainstormJudgeRun, "") != "run-1" ||
		meta.GetString(waveobj.MetaKey_BrainstormJudgeChannel, "") != ch.OID {
		t.Fatalf("record after launch = %v, want reading with judgerun run-1 and judgechannel %s", meta, ch.OID)
	}
}

func stubStopStageSession(t *testing.T) *[]string {
	t.Helper()
	var stopped []string
	old := stopStageSession
	stopStageSession = func(r waveobj.Run) { stopped = append(stopped, r.ID) }
	t.Cleanup(func() { stopStageSession = old })
	return &stopped
}

func TestBrainstormJudgeStopStopsAReadingJudge(t *testing.T) {
	ctx := context.Background()
	stopped := stubStopStageSession(t)
	delivered := stubDeliver(t)
	stubReadBrainstormRun(t, &waveobj.Run{ID: "run-1", Status: jarvis.RunStatus_Executing})
	tabId, blockId := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormJudgeState:   brainstormReading,
		waveobj.MetaKey_BrainstormJudgeTs:      42,
		waveobj.MetaKey_BrainstormJudgeRun:     "run-1",
		waveobj.MetaKey_BrainstormJudgeChannel: "ch-1",
	})

	if err := (&WshServer{}).BrainstormJudgeStopCommand(ctx, wshrpc.CommandBrainstormJudgeStopData{BlockId: blockId}); err != nil {
		t.Fatalf("BrainstormJudgeStopCommand: %v", err)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormStopped ||
		meta.GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0) <= 42 ||
		meta.GetString(waveobj.MetaKey_BrainstormJudgeRun, "") != "run-1" ||
		meta.GetString(waveobj.MetaKey_BrainstormJudgeChannel, "") != "ch-1" || meta.HasKey(waveobj.MetaKey_BrainstormJudgeReason) {
		t.Fatalf("record = %v, want stopped with a newer judgets, keeping run-1 and ch-1", meta)
	}
	if len(*stopped) != 1 || (*stopped)[0] != "run-1" {
		t.Fatalf("stopped %v, want run-1 once", *stopped)
	}
	if len(*delivered) != 0 {
		t.Fatalf("a stopped judge sent the agent %+v", *delivered)
	}
}

func TestBrainstormJudgeStopWithoutRun(t *testing.T) {
	ctx := context.Background()
	stopped := stubStopStageSession(t)
	tabId, blockId := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormJudgeState: brainstormReading,
		waveobj.MetaKey_BrainstormJudgeTs:    42,
	})

	if err := (&WshServer{}).BrainstormJudgeStopCommand(ctx, wshrpc.CommandBrainstormJudgeStopData{BlockId: blockId}); err != nil {
		t.Fatalf("BrainstormJudgeStopCommand: %v", err)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormStopped || meta.HasKey(waveobj.MetaKey_BrainstormJudgeRun) {
		t.Fatalf("record = %v, want stopped with no run", meta)
	}
	if len(*stopped) != 0 {
		t.Fatalf("stopped %v, want no stop call for a judge that has no run", *stopped)
	}
}

func TestBrainstormJudgeStopIgnoresIdleRecord(t *testing.T) {
	ctx := context.Background()
	stopped := stubStopStageSession(t)
	delivered := stubDeliver(t)
	for _, state := range []string{brainstormAnswered, brainstormFailed, ""} {
		t.Run("state "+state, func(t *testing.T) {
			meta := waveobj.MetaMapType{waveobj.MetaKey_BrainstormJudgeTs: 42, waveobj.MetaKey_BrainstormJudgeRun: "run-1"}
			if state != "" {
				meta[waveobj.MetaKey_BrainstormJudgeState] = state
			}
			tabId, blockId := seedAgentTab(t, ctx, meta)

			if err := (&WshServer{}).BrainstormJudgeStopCommand(ctx, wshrpc.CommandBrainstormJudgeStopData{BlockId: blockId}); err != nil {
				t.Fatalf("BrainstormJudgeStopCommand: %v", err)
			}
			got := tabMeta(t, ctx, tabId)
			if got.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != state || got.GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0) != 42 {
				t.Fatalf("record = %v, want it unchanged at %q", got, state)
			}
		})
	}
	if len(*stopped) != 0 || len(*delivered) != 0 {
		t.Fatalf("an idle record stopped %v and sent %+v", *stopped, *delivered)
	}
}

func TestBrainstormJudgeStopNeedsBlock(t *testing.T) {
	err := (&WshServer{}).BrainstormJudgeStopCommand(context.Background(), wshrpc.CommandBrainstormJudgeStopData{})
	if err == nil || !strings.Contains(err.Error(), "a block id is required") {
		t.Fatalf("err = %v, want a block id is required", err)
	}
}

func TestJudgeStartsAfterStop(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	_, file := seedJudgeBrainstorm(t, 5)
	tabId, blockId := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormJudgeState: brainstormStopped,
		waveobj.MetaKey_BrainstormJudgeTs:    42,
		waveobj.MetaKey_BrainstormJudgeRun:   "run-1",
	})

	if err := (&WshServer{}).BrainstormJudgeCommand(ctx, wshrpc.CommandBrainstormJudgeData{BlockId: blockId, File: file}); err != nil {
		t.Fatalf("a stopped judge refused a new one: %v", err)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormReading || meta.HasKey(waveobj.MetaKey_BrainstormJudgeRun) {
		t.Fatalf("record = %v, want a fresh reading record", meta)
	}
	if len(*armed) != 1 {
		t.Fatalf("armed %d watchers, want 1", len(*armed))
	}
}

// readingJudge is a judge's reading record at ts: the record a watcher armed at ts owns.
func readingJudge(ts int64) waveobj.MetaMapType {
	return waveobj.MetaMapType{waveobj.MetaKey_BrainstormJudgeState: brainstormReading, waveobj.MetaKey_BrainstormJudgeTs: ts}
}

func TestJudgeWatcherExitsAfterStop(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct{ name, report string }{
		{"a good result", goodJudgeReport},
		{"an empty result", "  \n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file := seedJudgeBrainstorm(t, 5)
			meta := readingJudge(42)
			meta[waveobj.MetaKey_BrainstormJudgeRun], meta[waveobj.MetaKey_BrainstormJudgeChannel] = "run-1", "ch-1"
			tabId, blockId := seedAgentTab(t, ctx, meta)
			stubStopStageSession(t)
			stubReadBrainstormRun(t, &waveobj.Run{ID: "run-1", Status: jarvis.RunStatus_Done, Report: tc.report})
			delivered := stubDeliver(t)
			if err := (&WshServer{}).BrainstormJudgeStopCommand(ctx, wshrpc.CommandBrainstormJudgeStopData{BlockId: blockId}); err != nil {
				t.Fatalf("BrainstormJudgeStopCommand: %v", err)
			}
			stoppedTs := tabMeta(t, ctx, tabId).GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0)

			c := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, RunId: "run-1", ChannelId: "ch-1", StartedTs: 42}
			if !tickBrainstormSession(ctx, c, time.Now().UnixMilli()) {
				t.Fatal("a stopped judge's watcher did not settle")
			}
			if _, err := os.Stat(brainstormcheck.JudgeResultPath(file)); err == nil {
				t.Fatal("a stopped judge's watcher wrote judge.json")
			}
			if len(*delivered) != 0 {
				t.Fatalf("a stopped judge's watcher sent %+v", *delivered)
			}
			got := tabMeta(t, ctx, tabId)
			if got.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormStopped ||
				got.GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0) != stoppedTs || got.HasKey(waveobj.MetaKey_BrainstormJudgeReason) {
				t.Fatalf("record = %v, want it left stopped at %v", got, stoppedTs)
			}
		})
	}
}

func TestJudgeLaunchAfterStopStopsItsRun(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	stopped := stubStopStageSession(t)
	delivered := stubDeliver(t)
	stubReadBrainstormRun(t, &waveobj.Run{ID: "run-1", Status: jarvis.RunStatus_Executing})
	_, file := seedJudgeBrainstorm(t, 5)
	tabId, blockId := seedAgentTab(t, ctx, nil)
	old := launchBrainstormSession
	launchBrainstormSession = func(ctx context.Context, _ orchestrate.JudgingSession) (string, error) {
		// the user answers while the judge's session starts
		if err := (&WshServer{}).BrainstormJudgeStopCommand(ctx, wshrpc.CommandBrainstormJudgeStopData{BlockId: blockId}); err != nil {
			t.Errorf("BrainstormJudgeStopCommand: %v", err)
		}
		return "run-1", nil
	}
	t.Cleanup(func() { launchBrainstormSession = old })
	if err := (&WshServer{}).BrainstormJudgeCommand(ctx, wshrpc.CommandBrainstormJudgeData{BlockId: blockId, File: file}); err != nil {
		t.Fatalf("BrainstormJudgeCommand: %v", err)
	}

	watchBrainstormSession(ctx, (*armed)[0]) // returns at once: its record was stopped

	if len(*stopped) != 1 || (*stopped)[0] != "run-1" {
		t.Fatalf("stopped %v, want the run launched after the stop, run-1", *stopped)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormStopped || meta.HasKey(waveobj.MetaKey_BrainstormJudgeRun) ||
		meta.HasKey(waveobj.MetaKey_BrainstormJudgeChannel) {
		t.Fatalf("record = %v, want stopped with no run written over it", meta)
	}
	if len(*delivered) != 0 {
		t.Fatalf("a stopped judge sent %+v", *delivered)
	}
}

func TestStaleJudgeWatcherLeavesNewJudge(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	stubStopStageSession(t)
	stubReadBrainstormRun(t, &waveobj.Run{ID: "run-1", Status: jarvis.RunStatus_Done, Report: goodJudgeReport})
	delivered := stubDeliver(t)
	_, file := seedJudgeBrainstorm(t, 5)
	meta := readingJudge(42)
	meta[waveobj.MetaKey_BrainstormJudgeRun], meta[waveobj.MetaKey_BrainstormJudgeChannel] = "run-1", "ch-1"
	tabId, blockId := seedAgentTab(t, ctx, meta)
	if err := (&WshServer{}).BrainstormJudgeStopCommand(ctx, wshrpc.CommandBrainstormJudgeStopData{BlockId: blockId}); err != nil {
		t.Fatalf("BrainstormJudgeStopCommand: %v", err)
	}
	if err := (&WshServer{}).BrainstormJudgeCommand(ctx, wshrpc.CommandBrainstormJudgeData{BlockId: blockId, File: file, Line: "rerun"}); err != nil {
		t.Fatalf("BrainstormJudgeCommand: %v", err)
	}
	fresh := tabMeta(t, ctx, tabId)

	old := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, RunId: "run-1", ChannelId: "ch-1", StartedTs: 42}
	if !tickBrainstormSession(ctx, old, time.Now().UnixMilli()) {
		t.Fatal("the stale watcher did not settle")
	}
	if _, err := os.Stat(brainstormcheck.JudgeResultPath(file)); err == nil {
		t.Fatal("the stale watcher wrote judge.json")
	}
	if len(*delivered) != 0 {
		t.Fatalf("the stale watcher sent %+v", *delivered)
	}
	got := tabMeta(t, ctx, tabId)
	if got.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormReading ||
		got.GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0) != float64((*armed)[0].StartedTs) ||
		got.GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0) != fresh.GetFloat(waveobj.MetaKey_BrainstormJudgeTs, 0) ||
		got.HasKey(waveobj.MetaKey_BrainstormJudgeRun) {
		t.Fatalf("record = %v, want the new judge's reading record %v unchanged", got, fresh)
	}
}

func TestBrainstormJudgeDelivers(t *testing.T) {
	ctx := context.Background()
	_, file := seedJudgeBrainstorm(t, 5)
	tabId, blockId := seedAgentTab(t, ctx, readingJudge(1))
	run := &waveobj.Run{ID: "run-1", Status: jarvis.RunStatus_Done, Report: goodJudgeReport}
	stubReadBrainstormRun(t, run)
	delivered := stubDeliver(t)

	c := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, RunId: "run-1", ChannelId: "ch-1", StartedTs: 1}
	if !tickBrainstormSession(ctx, c, time.Now().UnixMilli()) {
		t.Fatal("a done run with a good result did not settle the judge")
	}
	_, want := brainstormcheck.DecideJudge(run, "")
	path := brainstormcheck.JudgeResultPath(file)
	if got, err := os.ReadFile(path); err != nil || len(want) == 0 || string(got) != string(want) {
		t.Fatalf("judge.json = %q, %v, want %q", got, err, want)
	}
	if filepath.Dir(path) != filepath.Dir(file) {
		t.Fatalf("judge.json at %s, want it beside %s", path, file)
	}
	if len(*delivered) != 1 || (*delivered)[0] != (sentLine{blockId, "brainstorm: judged " + path}) {
		t.Fatalf("delivered %+v, want exactly the judged line for %s to block %s", *delivered, path, blockId)
	}
	meta := tabMeta(t, ctx, tabId)
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormAnswered ||
		meta.GetString(waveobj.MetaKey_BrainstormJudgeRun, "") != "run-1" || meta.HasKey(waveobj.MetaKey_BrainstormJudgeReason) {
		t.Fatalf("record = %v, want answered for run-1 with no reason", meta)
	}
}

// assertJudgeFailed checks the judge's record is failed with a reason that passes ok and ends as a sentence, that
// the agent got exactly that reason's line, and that no judge.json was written.
func assertJudgeFailed(t *testing.T, ctx context.Context, tabId, blockId, file string, delivered []sentLine, ok func(string) bool) {
	t.Helper()
	meta := tabMeta(t, ctx, tabId)
	reason := meta.GetString(waveobj.MetaKey_BrainstormJudgeReason, "")
	if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormFailed || !ok(reason) || !strings.HasSuffix(reason, ".") {
		t.Fatalf("record = %v, want failed with the expected reason as a sentence", meta)
	}
	if len(delivered) != 1 || delivered[0] != (sentLine{blockId, "brainstorm: judge failed: " + reason}) {
		t.Fatalf("delivered %+v, want exactly the failed line for %q to block %s", delivered, reason, blockId)
	}
	if _, err := os.Stat(brainstormcheck.JudgeResultPath(file)); err == nil {
		t.Fatal("a failed judge wrote judge.json")
	}
}

func TestBrainstormJudgeFailsWithALine(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name, report string
		ok           func(string) bool
	}{
		{"an unusable report", "Here it is:\n" + goodJudgeReport, func(r string) bool {
			return strings.HasPrefix(r, "The judge's result is not usable: it is not the one JSON object")
		}},
		{"an empty report", "  \n", func(r string) bool { return r == brainstormcheck.JudgeEmptyReason }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file := seedJudgeBrainstorm(t, 5)
			tabId, blockId := seedAgentTab(t, ctx, readingJudge(1))
			stubReadBrainstormRun(t, &waveobj.Run{ID: "run-1", Status: jarvis.RunStatus_Done, Report: tc.report})
			delivered := stubDeliver(t)
			c := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, RunId: "run-1", ChannelId: "ch-1", StartedTs: 1}
			if !tickBrainstormSession(ctx, c, time.Now().UnixMilli()) {
				t.Fatal("a done run did not settle the judge")
			}
			assertJudgeFailed(t, ctx, tabId, blockId, file, *delivered, tc.ok)
		})
	}

	t.Run("a lost run", func(t *testing.T) {
		_, file := seedJudgeBrainstorm(t, 5)
		now := time.Now().UnixMilli()
		startedTs := now - orchestrate.ReviewTimeout.Milliseconds() - 1
		tabId, blockId := seedAgentTab(t, ctx, readingJudge(startedTs))
		ch, err := wstore.CreateChannel(ctx, "lost-judge", t.TempDir())
		if err != nil {
			t.Fatalf("CreateChannel: %v", err)
		}
		run := jarvis.NewRun("judge", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
		run.StageRole = jarvis.UsageRole_BrainstormJudge
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatalf("AppendRun: %v", err)
		}
		var stopped []string
		oldStop := stopStageSession
		stopStageSession = func(r waveobj.Run) { stopped = append(stopped, r.ID) }
		t.Cleanup(func() { stopStageSession = oldStop })
		delivered := stubDeliver(t)

		c := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, RunId: run.ID, ChannelId: ch.OID,
			StartedTs: startedTs}
		if !tickBrainstormSession(ctx, c, now) {
			t.Fatal("a session past its timeout did not settle the judge")
		}
		if len(stopped) != 1 || stopped[0] != run.ID {
			t.Fatalf("stopped %v, want the judge's run %s", stopped, run.ID)
		}
		assertJudgeFailed(t, ctx, tabId, blockId, file, *delivered, func(r string) bool {
			return strings.HasPrefix(r, judgeLostHead) && strings.Contains(r, "no verdict")
		})
	})

	t.Run("a launch error", func(t *testing.T) {
		stubLaunchBrainstormSession(t, "", errors.New("claude is not installed"))
		project, file := seedJudgeBrainstorm(t, 5)
		tabId, blockId := seedAgentTab(t, ctx, readingJudge(1))
		delivered := stubDeliver(t)
		c := brainstormSession{Kind: judgeKind, TabId: tabId, BlockId: blockId, File: file, Project: project, Title: "Lag alerts", StartedTs: 1}

		watchBrainstormSession(ctx, c) // returns at once: the launch failed

		assertJudgeFailed(t, ctx, tabId, blockId, file, *delivered, func(r string) bool {
			return r == "Arc could not start the judge: claude is not installed."
		})
	})
}

func TestResumeBrainstormSessionsRearmsOrFailsJudges(t *testing.T) {
	ctx := context.Background()
	armed := stubArmBrainstormSession(t)
	delivered := stubDeliver(t)
	_, file := seedJudgeBrainstorm(t, 5)
	launchedTab, launchedBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormJudgeState:   brainstormReading,
		waveobj.MetaKey_BrainstormJudgeTs:      42,
		waveobj.MetaKey_BrainstormJudgeRun:     "run-1",
		waveobj.MetaKey_BrainstormJudgeChannel: "ch-1",
		waveobj.MetaKey_SessionBrainstorm:      file,
	})
	unlaunchedTab, unlaunchedBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormJudgeState: brainstormReading,
		waveobj.MetaKey_BrainstormJudgeTs:    42,
		waveobj.MetaKey_SessionBrainstorm:    file,
	})
	detachedTab, detachedBlock := seedAgentTab(t, ctx, waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormJudgeState:   brainstormReading,
		waveobj.MetaKey_BrainstormJudgeTs:      42,
		waveobj.MetaKey_BrainstormJudgeRun:     "run-2",
		waveobj.MetaKey_BrainstormJudgeChannel: "ch-1",
	})

	ResumeBrainstormSessions(ctx)

	var rearmed *brainstormSession
	for i := range *armed {
		switch (*armed)[i].TabId {
		case launchedTab:
			rearmed = &(*armed)[i]
		case unlaunchedTab, detachedTab:
			t.Fatalf("re-armed %+v, want it failed", (*armed)[i])
		}
	}
	want := brainstormSession{Kind: judgeKind, TabId: launchedTab, BlockId: launchedBlock, File: file, RunId: "run-1", ChannelId: "ch-1", StartedTs: 42}
	if rearmed == nil || *rearmed != want {
		t.Fatalf("re-armed %+v, want %+v", rearmed, want)
	}
	if got := tabMeta(t, ctx, launchedTab).GetString(waveobj.MetaKey_BrainstormJudgeState, ""); got != brainstormReading {
		t.Fatalf("re-armed judge state = %q, want still reading", got)
	}
	for _, tc := range []struct{ tab, block, reason string }{
		{unlaunchedTab, unlaunchedBlock, judgeRestartedReason},
		{detachedTab, detachedBlock, brainstormDetachedReason},
	} {
		meta := tabMeta(t, ctx, tc.tab)
		if meta.GetString(waveobj.MetaKey_BrainstormJudgeState, "") != brainstormFailed ||
			meta.GetString(waveobj.MetaKey_BrainstormJudgeReason, "") != tc.reason {
			t.Fatalf("record = %v, want failed: %s", meta, tc.reason)
		}
		if !slices.Contains(*delivered, sentLine{tc.block, "brainstorm: judge failed: " + tc.reason}) {
			t.Fatalf("delivered %+v, want the failed line %q to block %s", *delivered, tc.reason, tc.block)
		}
	}
}

// BrainstormCheckTimesCommand reads the median and longest of the builder checks that finished with a report.
func TestBrainstormCheckTimesCommand(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "check-times", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const longest = 4_000_000_000_000 // far past any other test's run in the shared store
	for _, r := range []waveobj.Run{
		{StageRole: jarvis.UsageRole_BuilderCheck, Status: "done", CreatedTs: 1000, CompletedTs: 1000 + longest, Report: "questions"},
		{StageRole: jarvis.UsageRole_BuilderCheck, Status: "done", CreatedTs: 1000, CompletedTs: 9000, Report: "  "},
		{StageRole: jarvis.UsageRole_BrainstormJudge, Status: "done", CreatedTs: 1000, CompletedTs: 1000 + 2*longest, Report: "{}"},
	} {
		r.ID = uuid.NewString()
		if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}
	got, err := (&WshServer{}).BrainstormCheckTimesCommand(ctx)
	if err != nil {
		t.Fatalf("BrainstormCheckTimesCommand: %v", err)
	}
	if got.LongestMs != longest {
		t.Fatalf("LongestMs = %d, want %d: the longest builder check, not a judge's or an empty report's", got.LongestMs, longest)
	}
	if got.UsualMs <= 0 || got.UsualMs > got.LongestMs {
		t.Fatalf("UsualMs = %d, want a median in (0, %d]", got.UsualMs, got.LongestMs)
	}
}
