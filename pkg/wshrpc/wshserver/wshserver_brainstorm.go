// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// brainstormPollEvery is how often a watcher judges its session's run.
const brainstormPollEvery = 5 * time.Second

const (
	brainstormReading  = "reading"
	brainstormAnswered = "answered"
	brainstormFailed   = "failed"
	brainstormStopped  = "stopped"

	builderCheckRestartedReason = "Arc restarted before the builder started."
	judgeRestartedReason        = "Arc restarted before the judge started."
	brainstormDetachedReason    = "Arc restarted and the brainstorm is no longer attached to this tab."

	// heads JudgingSessionLost's verdict, a lowercase clause such as "it gave no verdict within 10m0s"
	judgeLostHead = "The judge was lost: "
)

// asSentence ends reason with a period: the pane and the agent's line print a judge's failure as a sentence.
func asSentence(reason string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" || strings.HasSuffix(reason, ".") {
		return reason
	}
	return reason + "."
}

// launchBrainstormSession starts a builder check's reviewer or a judge. A var so tests spawn no worker.
var launchBrainstormSession = orchestrate.LaunchJudgingSession

// readBrainstormRun reads a session's run. A var so tests can script it.
var readBrainstormRun = wstore.GetRun

// armBrainstormSession starts a session's watcher on a detached context, off the handler's RPC budget. A var so
// tests drive the watcher's steps themselves.
var armBrainstormSession = func(s brainstormSession) { go watchBrainstormSession(context.Background(), s) }

// sessionKind is what differs between the two one-shot sessions Arc runs on a brainstorm: the builder check and
// the judge of an approach question. Each has its own record on the agent's tab, and one of each may read at once.
type sessionKind struct {
	what                                           string // names the kind in errors and logs
	stateKey, tsKey, runKey, channelKey, reasonKey string
	// mu makes the handler's not-reading check and its reading write one step, and a watcher's own-record check
	// and its write
	mu sync.Mutex
	// stoppable: a stop may take the record from its watcher, which then yields
	stoppable  bool
	busy       string // the refusal while one is reading
	role       string
	labelHead  string
	reportFile string // the session's report file in the temp dir, a Sprintf pattern for a uuid
	route      func(ch *waveobj.Channel, agent string) waveobj.RoutePin
	prompt     func(s brainstormSession, reportPath string) (string, error)
	// decide judges the run; on Deliver it returns the bytes to write to resultPath
	decide      func(run *waveobj.Run, lostReason string) (brainstormcheck.Action, []byte)
	resultPath  func(brainstormFile string) string
	line        func(path string) string
	failLine    func(reason string) string // nil when the pane shows the failure on its own card
	failReason  func(reason string) string // the failure as recorded and sent; nil keeps it as is
	startFailed string                     // the head of a launch error's reason
	writeFailed string                     // a Sprintf pattern for the result path and the write error
	restarted   string
}

var builderCheckKind = &sessionKind{
	what:     "builder check",
	stateKey: waveobj.MetaKey_BrainstormCheckState, tsKey: waveobj.MetaKey_BrainstormCheckTs,
	runKey: waveobj.MetaKey_BrainstormCheckRun, channelKey: waveobj.MetaKey_BrainstormCheckChannel,
	reasonKey:  waveobj.MetaKey_BrainstormCheckReason,
	busy:       "a builder check is already running",
	role:       jarvis.UsageRole_BuilderCheck,
	labelHead:  "Builder check · ",
	reportFile: "builder-check-%s.md",
	route:      builderCheckRoute,
	prompt: func(s brainstormSession, reportPath string) (string, error) {
		return brainstormcheck.Prompt(s.Spec, reportPath), nil
	},
	decide: func(run *waveobj.Run, lostReason string) (brainstormcheck.Action, []byte) {
		action := brainstormcheck.Decide(run, lostReason)
		if action.Kind != brainstormcheck.Deliver {
			return action, nil
		}
		return action, []byte(run.Report)
	},
	resultPath:  brainstormcheck.ReportPath,
	line:        brainstormcheck.Line,
	startFailed: "Arc could not start the builder: ",
	writeFailed: "Arc could not write the builder's questions to %s: %v",
	restarted:   builderCheckRestartedReason,
}

var judgeKind = &sessionKind{
	what:     "judge",
	stateKey: waveobj.MetaKey_BrainstormJudgeState, tsKey: waveobj.MetaKey_BrainstormJudgeTs,
	runKey: waveobj.MetaKey_BrainstormJudgeRun, channelKey: waveobj.MetaKey_BrainstormJudgeChannel,
	reasonKey:  waveobj.MetaKey_BrainstormJudgeReason,
	stoppable:  true,
	busy:       "a judge is already weighing this brainstorm's question",
	role:       jarvis.UsageRole_BrainstormJudge,
	labelHead:  "Judge · ",
	reportFile: "brainstorm-judge-%s.json",
	// answer 14's model, whatever the agent runs on and whatever reviewer the run settings name (D4)
	route: func(*waveobj.Channel, string) waveobj.RoutePin {
		return waveobj.RoutePin{Runtime: "claude", Model: "opus"}
	},
	prompt: judgePrompt,
	decide: func(run *waveobj.Run, lostReason string) (brainstormcheck.Action, []byte) {
		if lostReason != "" {
			lostReason = judgeLostHead + lostReason
		}
		return brainstormcheck.DecideJudge(run, lostReason)
	},
	resultPath:  brainstormcheck.JudgeResultPath,
	line:        brainstormcheck.JudgedLine,
	failLine:    brainstormcheck.JudgeFailedLine,
	failReason:  asSentence,
	startFailed: "Arc could not start the judge: ",
	writeFailed: "Arc could not write the judge's result to %s: %v",
	restarted:   judgeRestartedReason,
}

// brainstormSession is one session in flight. Project, Spec, Title and Line are set only before the launch;
// RunId, ChannelId once it is launched. StartedTs is the record's ts.
type brainstormSession struct {
	Kind                       *sessionKind
	TabId, BlockId, File       string
	Project, Spec, Title, Line string
	RunId, ChannelId           string
	StartedTs                  int64
}

// brainstormDoc is what every session reads from brainstorm.json.
type brainstormDoc struct {
	Title string `json:"title"`
	Spec  string `json:"spec"`
}

func (ws *WshServer) BrainstormCheckCommand(ctx context.Context, data wshrpc.CommandBrainstormCheckData) error {
	if data.BlockId == "" || data.File == "" {
		return fmt.Errorf("a block id and a brainstorm file are required")
	}
	s, err := readBrainstormForCheck(data.File)
	if err != nil {
		return err
	}
	return startBrainstormSession(ctx, data.BlockId, s)
}

// BrainstormCheckTimesCommand reads every finished builder check in the store, failed and lost ones left out, since
// one lost after 30 minutes would set the clock's end.
func (ws *WshServer) BrainstormCheckTimesCommand(ctx context.Context) (*wshrpc.BrainstormCheckTimes, error) {
	durations, err := wstore.GetStageRunDurations(ctx, jarvis.UsageRole_BuilderCheck)
	if err != nil {
		return nil, fmt.Errorf("reading past builder checks: %w", err)
	}
	usual, longest := brainstormcheck.Times(durations)
	return &wshrpc.BrainstormCheckTimes{UsualMs: usual, LongestMs: longest}, nil
}

func (ws *WshServer) BrainstormJudgeCommand(ctx context.Context, data wshrpc.CommandBrainstormJudgeData) error {
	if data.BlockId == "" || data.File == "" {
		return fmt.Errorf("a block id and a brainstorm file are required")
	}
	s, raw, err := readBrainstorm(data.File)
	if err != nil {
		return err
	}
	if _, err := brainstormcheck.ReadJudgeInput(raw); err != nil {
		return err
	}
	s.Kind, s.Line = judgeKind, data.Line
	return startBrainstormSession(ctx, data.BlockId, s)
}

// BrainstormJudgeStopCommand stops the judge reading on the block's tab, when there is one: the user answered
// before it finished, so its result has nowhere to go. It sends the agent no line.
func (ws *WshServer) BrainstormJudgeStopCommand(ctx context.Context, data wshrpc.CommandBrainstormJudgeStopData) error {
	if data.BlockId == "" {
		return fmt.Errorf("a block id is required")
	}
	tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId)
	if err != nil {
		return fmt.Errorf("finding the tab of block %s: %w", data.BlockId, err)
	}
	k := judgeKind
	k.mu.Lock()
	defer k.mu.Unlock()
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return fmt.Errorf("loading tab %s: %w", tabId, err)
	}
	if tab.Meta.GetString(k.stateKey, "") != brainstormReading {
		return nil
	}
	runId, channelId := tab.Meta.GetString(k.runKey, ""), tab.Meta.GetString(k.channelKey, "")
	if runId != "" {
		stopBrainstormRun(ctx, k, channelId, runId)
	}
	return setBrainstormRecord(ctx, k, tabId, brainstormStopped, time.Now().UnixMilli(), runId, channelId, "")
}

// stopBrainstormRun stops a session's run unless it is done.
func stopBrainstormRun(ctx context.Context, k *sessionKind, channelId, runId string) {
	run, err := readBrainstormRun(ctx, channelId, runId)
	switch {
	case err != nil || run == nil:
		log.Printf("%s: stopping run %s: could not load it: %v", k.what, runId, err)
	case run.Status != jarvis.RunStatus_Done:
		stopStageSession(*run)
	}
}

// closeBrainstormSessionTabs closes a session's tab once its agent's tab is gone. A var so tests close no tab.
var closeBrainstormSessionTabs = jarvis.CloseRunWorkerTabs

// closeBrainstormRun closes a session's run and its tab, whatever its state.
func closeBrainstormRun(ctx context.Context, k *sessionKind, channelId, runId string) {
	run, err := readBrainstormRun(ctx, channelId, runId)
	if err != nil || run == nil {
		log.Printf("%s: closing run %s: could not load it: %v", k.what, runId, err)
		return
	}
	if err := closeBrainstormSessionTabs(ctx, run); err != nil {
		log.Printf("%s: closing run %s: %v", k.what, runId, err)
	}
}

// ownsBrainstormRecord reports whether the tab's record is still s's reading one: a stop, or a new session
// started after it, takes it, and closing the agent's tab takes it with the tab. The caller holds s.Kind.mu.
func ownsBrainstormRecord(ctx context.Context, s brainstormSession) bool {
	k := s.Kind
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, s.TabId)
	if errors.Is(err, wstore.ErrNotFound) {
		return false
	}
	if !k.stoppable {
		return true
	}
	if err != nil {
		log.Printf("%s: loading tab %s: %v", k.what, s.TabId, err)
		return false
	}
	return tab.Meta.GetString(k.stateKey, "") == brainstormReading && int64(tab.Meta.GetFloat(k.tsKey, 0)) == s.StartedTs
}

// startBrainstormSession writes s's reading record on the agent's tab and arms its watcher, refusing while a
// session of its kind already reads there.
func startBrainstormSession(ctx context.Context, blockId string, s brainstormSession) error {
	k := s.Kind
	s.BlockId = blockId
	var err error
	s.TabId, err = wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil {
		return fmt.Errorf("finding the tab of block %s: %w", blockId, err)
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, s.TabId)
	if err != nil {
		return fmt.Errorf("loading tab %s: %w", s.TabId, err)
	}
	if tab.Meta.GetString(k.stateKey, "") == brainstormReading {
		return errors.New(k.busy)
	}
	s.StartedTs = time.Now().UnixMilli()
	if err := setBrainstormRecord(ctx, k, s.TabId, brainstormReading, s.StartedTs, "", "", ""); err != nil {
		return err
	}
	armBrainstormSession(s)
	return nil
}

// readBrainstorm reads file, which must be an absolute path under a .superpowers directory, and returns its
// session (no kind yet) and its bytes.
func readBrainstorm(file string) (brainstormSession, []byte, error) {
	if !filepath.IsAbs(file) {
		return brainstormSession{}, nil, fmt.Errorf("the brainstorm file must be an absolute path: %s", file)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return brainstormSession{}, nil, fmt.Errorf("reading %s: %w", file, err)
	}
	var doc brainstormDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return brainstormSession{}, nil, fmt.Errorf("%s is not valid JSON: %w", file, err)
	}
	project, err := brainstormProject(file)
	if err != nil {
		return brainstormSession{}, nil, err
	}
	title := doc.Title
	if title == "" {
		title = filepath.Base(filepath.Dir(file))
	}
	return brainstormSession{File: file, Project: project, Spec: doc.Spec, Title: title}, raw, nil
}

// readBrainstormForCheck reads file and checks that the spec it names exists, relative to the brainstorm's
// project: the directory above .superpowers.
func readBrainstormForCheck(file string) (brainstormSession, error) {
	s, _, err := readBrainstorm(file)
	if err != nil {
		return brainstormSession{}, err
	}
	if s.Spec == "" {
		return brainstormSession{}, fmt.Errorf("%s names no spec: set spec to the spec's path", file)
	}
	if !filepath.IsAbs(s.Spec) {
		s.Spec = filepath.Join(s.Project, s.Spec)
	}
	if info, err := os.Stat(s.Spec); err != nil || info.IsDir() {
		return brainstormSession{}, fmt.Errorf("the spec %s does not exist: write it before starting the check", s.Spec)
	}
	s.Kind = builderCheckKind
	return s, nil
}

func brainstormProject(file string) (string, error) {
	for dir := filepath.Dir(file); filepath.Dir(dir) != dir; dir = filepath.Dir(dir) {
		if filepath.Base(dir) == ".superpowers" {
			return filepath.Dir(dir), nil
		}
	}
	return "", fmt.Errorf("%s is not under a .superpowers directory", file)
}

// judgePrompt builds the judge's prompt from the file as it stands at launch, the list in a fresh random order.
func judgePrompt(s brainstormSession, reportPath string) (string, error) {
	raw, err := os.ReadFile(s.File)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", s.File, err)
	}
	in, err := brainstormcheck.ReadJudgeInput(raw)
	if err != nil {
		return "", err
	}
	return brainstormcheck.JudgePrompt(in, s.Line, reportPath, rand.Shuffle), nil
}

// setBrainstormRecord writes k's record on the agent's tab, all five keys at once, clearing the empty ones, and
// broadcasts the tab.
func setBrainstormRecord(ctx context.Context, k *sessionKind, tabId, state string, ts int64, run, channel, reason string) error {
	meta := waveobj.MetaMapType{
		k.stateKey:   state,
		k.tsKey:      ts,
		k.runKey:     nil,
		k.channelKey: nil,
		k.reasonKey:  nil,
	}
	for key, val := range map[string]string{k.runKey: run, k.channelKey: channel, k.reasonKey: reason} {
		if val != "" {
			meta[key] = val
		}
	}
	oref := waveobj.MakeORef(waveobj.OType_Tab, tabId)
	if _, err := wstore.UpdateObjectMeta(ctx, oref, meta, false); err != nil {
		return fmt.Errorf("writing the %s on tab %s: %w", k.what, tabId, err)
	}
	wcore.SendWaveObjUpdate(oref)
	return nil
}

// failBrainstormSession records s failed, and sends the agent the reason when the pane has no card to show it on.
func failBrainstormSession(ctx context.Context, s brainstormSession, reason string) {
	if s.Kind.failReason != nil {
		reason = s.Kind.failReason(reason)
	}
	if err := setBrainstormRecord(ctx, s.Kind, s.TabId, brainstormFailed, time.Now().UnixMilli(), s.RunId, s.ChannelId, reason); err != nil {
		log.Printf("%s: %v", s.Kind.what, err)
	}
	if s.Kind.failLine != nil && s.BlockId != "" {
		deliverAgentMessage(s.BlockId, s.Kind.failLine(reason))
	}
}

// watchBrainstormSession launches s's session when it has none yet, then judges its run until it is delivered,
// failed, or its record is no longer its own.
func watchBrainstormSession(ctx context.Context, s brainstormSession) {
	if s.RunId == "" {
		if err := launchSessionRun(ctx, &s); err != nil {
			s.Kind.mu.Lock()
			defer s.Kind.mu.Unlock()
			if ownsBrainstormRecord(ctx, s) {
				failBrainstormSession(ctx, s, s.Kind.startFailed+err.Error())
			}
			return
		}
	}
	for !tickBrainstormSession(ctx, s, time.Now().UnixMilli()) {
		time.Sleep(brainstormPollEvery)
	}
}

// launchSessionRun launches s's session in the project's channel, in the workspace that holds the agent's tab,
// and records its run on the tab. When the record was taken while it launched, it stops the run instead.
func launchSessionRun(ctx context.Context, s *brainstormSession) error {
	k := s.Kind
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, s.TabId)
	if err != nil {
		return fmt.Errorf("loading tab %s: %w", s.TabId, err)
	}
	name := tab.Meta.GetString(waveobj.MetaKey_SessionProject, "")
	if name == "" {
		name = filepath.Base(s.Project)
	}
	ch, err := wstore.EnsureChannelAtPath(ctx, name, s.Project)
	if err != nil {
		return fmt.Errorf("the project's channel: %w", err)
	}
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, s.TabId)
	if err != nil {
		return fmt.Errorf("finding the workspace of tab %s: %w", s.TabId, err)
	}
	if workspaceId == "" {
		return fmt.Errorf("tab %s is in no workspace", s.TabId)
	}
	reportPath := filepath.Join(os.TempDir(), fmt.Sprintf(k.reportFile, uuid.NewString()))
	prompt, err := k.prompt(*s, reportPath)
	if err != nil {
		return err
	}
	runId, err := launchBrainstormSession(ctx, orchestrate.JudgingSession{
		ChannelId: ch.OID, WorkspaceId: workspaceId,
		Role: k.role, Label: k.labelHead + s.Title, Tree: s.Project,
		Prompt: prompt,
		Route:  k.route(ch, tab.Meta.GetString(waveobj.MetaKey_SessionAgent, "")),
	})
	if err != nil {
		return err
	}
	s.RunId, s.ChannelId = runId, ch.OID
	k.mu.Lock()
	defer k.mu.Unlock()
	if !ownsBrainstormRecord(ctx, *s) {
		if _, err := wstore.DBMustGet[*waveobj.Tab](ctx, s.TabId); errors.Is(err, wstore.ErrNotFound) {
			// the agent's tab closed while this launched, too soon for its close to see the run: it goes the same way
			closeBrainstormRun(ctx, k, s.ChannelId, s.RunId)
			return nil
		}
		stopBrainstormRun(ctx, k, s.ChannelId, s.RunId)
		return nil
	}
	return setBrainstormRecord(ctx, k, s.TabId, brainstormReading, s.StartedTs, s.RunId, s.ChannelId, "")
}

// builderCheckRoute is the reviewer route of the run settings for ch, else the brainstorming agent's runtime when
// it can run a worker, else the default runtime, each with its default model when the setting names none (D3).
func builderCheckRoute(ch *waveobj.Channel, agent string) waveobj.RoutePin {
	profile := jarvis.ResolveProfile(jarvis.LoadGlobalProfile(), jarvis.OverrideFromMeta(ch))
	if r := profile.ReviewerRoute; r != nil && (r.Runtime != "" || r.Model != "") {
		return waveobj.RoutePin{Runtime: runroute.DefaultRuntime(r.Runtime), Model: r.Model}
	}
	if spec, ok := harness.Lookup(agent); ok && spec.RunWorkerCapable {
		return waveobj.RoutePin{Runtime: agent}
	}
	return waveobj.RoutePin{Runtime: runroute.DefaultRuntime("")}
}

// tickBrainstormSession judges s's run once and acts on the verdict. It reports whether the session is settled,
// which it is, without a word, once its record is no longer its own. It holds the kind's lock throughout, so a stop
// lands before the tick or after its write.
func tickBrainstormSession(ctx context.Context, s brainstormSession, now int64) bool {
	k := s.Kind
	k.mu.Lock()
	defer k.mu.Unlock()
	if !ownsBrainstormRecord(ctx, s) {
		return true
	}
	run, err := readBrainstormRun(ctx, s.ChannelId, s.RunId)
	if err != nil {
		run = nil
	}
	lost := ""
	if run == nil || run.Status != jarvis.RunStatus_Done {
		lost, _ = orchestrate.JudgingSessionLost(ctx, s.ChannelId, s.RunId, s.StartedTs, now)
	}
	action, out := k.decide(run, lost)
	switch action.Kind {
	case brainstormcheck.Deliver:
		path := k.resultPath(s.File)
		if err := os.WriteFile(path, out, 0o644); err != nil {
			failBrainstormSession(ctx, s, fmt.Sprintf(k.writeFailed, path, err))
			return true
		}
		deliverAgentMessage(s.BlockId, k.line(path))
		if err := setBrainstormRecord(ctx, k, s.TabId, brainstormAnswered, now, s.RunId, s.ChannelId, ""); err != nil {
			log.Printf("%s: %v", k.what, err)
		}
		return true
	case brainstormcheck.Fail:
		if run != nil && run.Status != jarvis.RunStatus_Done {
			stopStageSession(*run)
		}
		failBrainstormSession(ctx, s, action.Reason)
		return true
	}
	return false
}

// ResumeBrainstormSessions re-arms the watcher of every builder check and judge that was reading when wavesrv
// stopped, and fails one whose session never launched (D6). Called once at startup, after the store is up.
func ResumeBrainstormSessions(ctx context.Context) {
	tabs, err := wstore.DBGetAllObjsByType[*waveobj.Tab](ctx, waveobj.OType_Tab)
	if err != nil {
		log.Printf("brainstorm sessions: loading tabs: %v", err)
		return
	}
	for _, tab := range tabs {
		for _, k := range []*sessionKind{builderCheckKind, judgeKind} {
			resumeBrainstormSession(ctx, tab, k)
		}
	}
}

func resumeBrainstormSession(ctx context.Context, tab *waveobj.Tab, k *sessionKind) {
	if tab.Meta.GetString(k.stateKey, "") != brainstormReading {
		return
	}
	s := brainstormSession{
		Kind:      k,
		TabId:     tab.OID,
		File:      tab.Meta.GetString(waveobj.MetaKey_SessionBrainstorm, ""),
		RunId:     tab.Meta.GetString(k.runKey, ""),
		ChannelId: tab.Meta.GetString(k.channelKey, ""),
		StartedTs: int64(tab.Meta.GetFloat(k.tsKey, 0)),
	}
	if len(tab.BlockIds) > 0 {
		s.BlockId = tab.BlockIds[0]
	}
	switch {
	case s.RunId == "":
		failBrainstormSession(ctx, s, k.restarted)
	case s.File == "":
		// the brainstorm was closed meanwhile: the result has nowhere to go
		failBrainstormSession(ctx, s, brainstormDetachedReason)
	default:
		armBrainstormSession(s)
	}
}
