// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/agentpair"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// nothing but this line checks that the wshserver implements every pair command
var _ wshrpc.PairCommands = (*WshServer)(nil)

// pairManager runs every pair in wavesrv over the live roster. getPairManager makes it on first use: its folder lives
// under the data dir, which main reads after this package's variables are set. A test sets it to a manager of its own.
var (
	pairManager   *agentpair.Manager
	pairManagerMu sync.Mutex
)

// pairDirs are the two folders of pair files under the data dir (read when called: main sets the data dir after this
// package's variables). The own folder is the manager's. The synced one holds pairs another machine's sync put there:
// only the history read and PairGet open it, and the manager is never given it. A test points both at temp folders.
var pairDirs = func() (own, synced string) {
	dataDir := wavebase.GetWaveDataDir()
	return filepath.Join(dataDir, agentpair.DirName), filepath.Join(dataDir, agentpair.SyncedDirName)
}

func getPairManager() *agentpair.Manager {
	pairManagerMu.Lock()
	defer pairManagerMu.Unlock()
	if pairManager == nil {
		own, _ := pairDirs()
		pairManager = &agentpair.Manager{
			Link:    livePairLink{},
			Dir:     own,
			Publish: publishPairUpdate,
		}
	}
	return pairManager
}

// publishPairUpdate tells the cockpit a pair changed: it re-reads the pair on this event.
func publishPairUpdate(u wshrpc.PairUpdateData) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_PairUpdate, Data: u})
}

// StartPairManager is called once at startup: it reads the pair files off the boot goroutine and tries every queue, so a
// restart neither blinds the hold on heavy commands nor strands a prompt for an agent that is already idle.
func StartPairManager() {
	go func() {
		defer func() {
			panichandler.PanicHandler("StartPairManager", recover())
		}()
		getPairManager().Load(context.Background())
	}()
}

// PairListCommand is the active pairs and the judges that rest: launched ones whose newest pair has ended (the history
// read leaves that list out).
func (ws *WshServer) PairListCommand(ctx context.Context) (*wshrpc.CommandPairListRtnData, error) {
	mgr := getPairManager()
	return &wshrpc.CommandPairListRtnData{Pairs: mgr.List(), Resting: mgr.Resting()}, nil
}

// PairHistoryCommand is a project's pairs in every state, live, ended and synced ("" is every project), newest first.
// It reads the pair files, not the manager's index, so a synced pair never enters the index.
func (ws *WshServer) PairHistoryCommand(ctx context.Context, data wshrpc.CommandPairHistoryData) (*wshrpc.CommandPairListRtnData, error) {
	own, synced := pairDirs()
	pairs, err := agentpair.History(own, synced, data.Project)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandPairListRtnData{Pairs: pairs}, nil
}

// PairGetCommand is one pair in full: the manager's, else the pair's file (an ended pair, or one synced from another
// machine).
func (ws *WshServer) PairGetCommand(ctx context.Context, data wshrpc.CommandPairGetData) (*wshrpc.PairView, error) {
	view, err := getPairManager().Get(data.PairId)
	if !errors.Is(err, agentpair.ErrNoPair) {
		return view, err
	}
	own, synced := pairDirs()
	return agentpair.Read(own, synced, data.PairId)
}

func (ws *WshServer) PairBriefCommand(ctx context.Context, data wshrpc.CommandPairBriefData) (*wshrpc.CommandPairBriefRtnData, error) {
	text, err := getPairManager().Brief(ctx, data.WorkerTab, data.From)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandPairBriefRtnData{Text: text}, nil
}

func (ws *WshServer) PairStartCommand(ctx context.Context, data wshrpc.CommandPairStartData) (*wshrpc.PairView, error) {
	return getPairManager().Start(ctx, data)
}

func (ws *WshServer) PairSayCommand(ctx context.Context, data wshrpc.CommandPairSayData) error {
	return getPairManager().Say(ctx, data)
}

func (ws *WshServer) PairRunNowCommand(ctx context.Context, data wshrpc.CommandPairRunNowData) error {
	return getPairManager().RunNow(ctx, data)
}

func (ws *WshServer) PairUnpairCommand(ctx context.Context, data wshrpc.CommandPairGetData) error {
	return getPairManager().Unpair(ctx, data.PairId)
}

// PairCloseWorkerCommand ends the pair of a working agent whose tab is closing and names the judges to close with it.
func (ws *WshServer) PairCloseWorkerCommand(ctx context.Context, data wshrpc.CommandPairCloseWorkerData) (*wshrpc.CommandPairCloseWorkerRtnData, error) {
	return &wshrpc.CommandPairCloseWorkerRtnData{Judges: getPairManager().CloseWorker(data.WorkerTab)}, nil
}

// PairResumeCommand puts a stopped pair back to relaying and delivers what is still queued; it adds no message.
func (ws *WshServer) PairResumeCommand(ctx context.Context, data wshrpc.CommandPairGetData) error {
	return getPairManager().Resume(ctx, data.PairId)
}

// pairWork is the turn ends being handled, so a test can wait for them.
var pairWork sync.WaitGroup

// blockTabId is the tab a block is in. A var so a test names it without a block in the store.
var blockTabId = wstore.DBFindTabForBlockId

// statusTabId is the tab an agent:status report is about, "" when its oref names none.
func statusTabId(ctx context.Context, orefStr string) string {
	oref, err := waveobj.ParseORef(orefStr)
	if err != nil {
		return ""
	}
	switch oref.OType {
	case waveobj.OType_Tab:
		return oref.OID
	case waveobj.OType_Block:
		tabId, _ := blockTabId(ctx, oref.OID)
		return tabId
	}
	return ""
}

// notePairStatus hands an agent that reports idle to the pairs, off the publishing goroutine: a turn end delivers a
// prompt, which may wake an agent, and the wake waits on the very events being published. Only idle ends a turn: no
// status says an agent sleeps, which is a roster state that Link.State reads. An agent outside every pair is passed on
// too when a finished round left it to sleep at its next turn end (a launched judge that was working then).
func notePairStatus(ev *wps.WaveEvent) {
	// events arrive over the RPC wire with Data as a raw JSON map, so decode rather than assert.
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil || data.State != baseds.AgentState_Idle {
		return
	}
	pairWork.Go(func() {
		defer func() {
			panichandler.PanicHandler("notePairStatus", recover())
		}()
		ctx := context.Background()
		tab := statusTabId(ctx, data.ORef)
		if tab == "" || !getPairManager().Watches(tab) {
			return
		}
		// a Stop's idle can come before the turn's last reply is in the transcript (wshserver_turnend.go)
		if !awaitStopFlush(data) {
			log.Printf("pair: %s's turn end did not reach its transcript in %s, reading its answer anyway\n", tab, stopFlushWait)
		}
		getPairManager().TurnEnded(ctx, tab)
	})
}

// livePairLink is the pair manager's view of the live agents: the roster for a member's state, the path wsh agents send
// takes for a prompt, and the transcript for its answer. The tabs are the ones the pair stores, full ids.
type livePairLink struct{}

var _ agentpair.Link = livePairLink{}

// pairRow is the roster's row for tab, nil when the tab is not on the roster.
func pairRow(rows []agentRow, tab string) *agentRow {
	for i := range rows {
		if rows[i].TabId == tab {
			return &rows[i]
		}
	}
	return nil
}

// find is the roster and the live agent in tab. A tab that is not on the roster (gone, or only not relaunched yet)
// is errNoSeat: what Link.State says of it decides which.
func (livePairLink) find(ctx context.Context, tab string) ([]agentRow, *agentRow, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, nil, err
	}
	rows := buildAgentRoster(facts)
	row := pairRow(rows, tab)
	if row == nil {
		return nil, nil, fmt.Errorf("tab %s is %w", tab, errNoSeat)
	}
	return rows, row, nil
}

// State folds the roster row's state into the pair's five. An agent the roster does not list is gone only when its tab
// no longer exists or its session reported its end; any other tab is just not on the roster yet (wavesrv has restarted
// and the agent is being relaunched), which reads working: the pair waits and never marks a member gone on a restart.
func (livePairLink) State(ctx context.Context, tab string) (string, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return "", err
	}
	if row := pairRow(buildAgentRoster(facts), tab); row != nil {
		return pairState(row.State), nil
	}
	for _, tf := range facts.Tabs {
		if tf.Tab.OID == tab {
			asleep := !tf.ShellRunning && tf.Sleeping > 0
			if tf.Status.Ended && !asleep {
				return agentpair.LinkGone, nil
			}
			return agentpair.LinkWorking, nil
		}
	}
	return agentpair.LinkGone, nil
}

// pairState is a roster state as the pair's. A state it does not know reads as working, so the member is waited on and
// never sent into.
func pairState(state string) string {
	switch state {
	case wshrpc.AgentsState_Idle:
		return agentpair.LinkIdle
	case wshrpc.AgentsState_Asking:
		return agentpair.LinkAsking
	case wshrpc.AgentsState_Sleeping:
		return agentpair.LinkSleeping
	}
	return agentpair.LinkWorking
}

// Send puts text into the agent's session as its next turn, through the wake-or-deliver path wsh agents send takes: a
// sleeping agent is woken first. The text arrives already enveloped as the pair's, and the send-back lock, which guards
// one agent from answering another by message, is not touched: a pair's reply passes back on its own.
func (l livePairLink) Send(ctx context.Context, tab, text string) error {
	rows, row, err := l.find(ctx, tab)
	if err != nil {
		return err
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("the message is empty")
	}
	return deliverToAgent(ctx, rows, row, text, nil)
}

// LastAnswer is the agent's last answer and its time, as wsh agents read gives them; "", 0 while it has none.
func (l livePairLink) LastAnswer(ctx context.Context, tab string) (string, int64, error) {
	_, row, err := l.find(ctx, tab)
	if err != nil {
		return "", 0, err
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil || tpath == "" {
		return "", 0, err
	}
	text, ts := agentsessions.LastAnswer(tpath, row.Harness)
	return text, ts, nil
}

// AnswerAt is the agent's reply in the transcript record uuid, and its time. Only a claude transcript is read: a uuid that
// is no reply of it (no such record, a record with no text, a pi agent) is an error, never the latest reply in its place.
func (l livePairLink) AnswerAt(ctx context.Context, tab, uuid string) (string, int64, error) {
	_, row, err := l.find(ctx, tab)
	if err != nil {
		return "", 0, err
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil {
		return "", 0, err
	}
	if tpath != "" {
		if text, ts, found := agentsessions.AnswerAt(tpath, row.Harness, uuid); found {
			return text, ts, nil
		}
	}
	return "", 0, fmt.Errorf("no reply %s in the transcript of %s (only a claude agent's replies can be chosen)", uuid, tab)
}

// Tokens is what the agent's session spent since sinceMs, counted from its transcript.
func (l livePairLink) Tokens(ctx context.Context, tab string, sinceMs int64) (int64, error) {
	_, row, err := l.find(ctx, tab)
	if err != nil {
		return 0, err
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil || tpath == "" {
		return 0, err
	}
	return agentsessions.TokensSince(tpath, row.Harness, sinceMs), nil
}

// Sleep puts the agent to sleep now, as a person's Sleep does: the same refusals (not idle, an engine run's, no session),
// no compaction first, and the auto-sleep setting is not asked, because the sleep belongs to the round and not to the
// idle rule. An agent that waits on the person is refused too (autoSleepRefusal): a person's Sleep may leave its question
// to wait, a round's may not. sleepAgent answers a sleep that background work stopped with no error and the work in
// Background: that is an error here, so a refusal is never read as a sleep.
func (l livePairLink) Sleep(ctx context.Context, tab string) error {
	_, row, err := l.find(ctx, tab)
	if err != nil {
		return err
	}
	if err := autoSleepRefusal(row); err != nil {
		return err
	}
	rtn, err := sleepAgent(ctx, row, false)
	if err != nil {
		return err
	}
	if rtn != nil && len(rtn.Background) > 0 {
		return fmt.Errorf("agent %q still runs background work (%s); it was not put to sleep", row.Name, strings.Join(rtn.Background, ", "))
	}
	return nil
}

// Agent names the tab as the cockpit labels it: the session's title, else the tab's name (its launch name, often the
// project's).
func (l livePairLink) Agent(ctx context.Context, tab string) (agentpair.AgentFacts, error) {
	_, row, err := l.find(ctx, tab)
	if err != nil {
		return agentpair.AgentFacts{}, err
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil {
		return agentpair.AgentFacts{}, err
	}
	return agentpair.AgentFacts{Name: pairAgentName(row.AgentInfo), Harness: row.Harness, Project: row.Project, Cwd: row.Cwd, Transcript: tpath}, nil
}

// pairAgentName is the name a pair stores for a side: the session's title, the cockpit's label, over the tab's name.
func pairAgentName(a wshrpc.AgentInfo) string {
	if t := strings.TrimSpace(a.Title); t != "" {
		return t
	}
	return a.Name
}

// RecentTexts is the texts of the agent's last n turns, oldest first. Only a claude session's turns are read.
func (l livePairLink) RecentTexts(ctx context.Context, tab string, n int) ([]string, error) {
	_, row, err := l.find(ctx, tab)
	if err != nil {
		return nil, err
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil || tpath == "" {
		return nil, err
	}
	turns := agentsessions.TurnsSince(tpath, row.Harness, 0)
	turns = turns[max(0, len(turns)-n):]
	texts := make([]string, 0, len(turns))
	for _, t := range turns {
		texts = append(texts, t.Text)
	}
	return texts, nil
}
