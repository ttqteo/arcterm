// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentctl"
	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// the harnesses whose sessions are agents here; a codex or opencode session cannot be messaged.
var agentHarnesses = map[string]bool{"claude": true, "pi": true}

// agentTabFacts is what the roster reads about one tab before deciding whether it is a live agent.
type agentTabFacts struct {
	Tab          *waveobj.Tab
	BlockId      string // the tab's first block, where its agent runs
	ProjectPath  string // the session's directory, as its repository's main checkout
	ShellRunning bool
	Status       baseds.AgentStatusData
	OpenAsk      bool
	HasStream    bool
}

type agentRosterFacts struct {
	Tabs     []agentTabFacts
	Runs     []*waveobj.Run
	Channels []*waveobj.Channel
}

// agentRow is a roster row with what the handlers need beyond what they return.
type agentRow struct {
	wshrpc.AgentInfo
	blockId   string
	status    baseds.AgentStatusData
	hasStream bool
}

// loadAgentRosterFacts gathers every tab and what the roster needs to judge it. A var so tests script it
// without a store or a block controller.
var loadAgentRosterFacts = readAgentRosterFacts

// deliverAgentMessage hands a message to a session. A var so tests need no live session.
var deliverAgentMessage = orchestrate.SendToSession

// blockTranscriptMeta is the transcript path a block's agent hook recorded on it. A var so tests need no block.
var blockTranscriptMeta = readBlockTranscriptMeta

// tabAgentBlock is the block a tab's agent runs in, "" for a tab that is gone. A var so tests need no store.
var tabAgentBlock = readTabAgentBlock

func readAgentRosterFacts(ctx context.Context) (*agentRosterFacts, error) {
	tabs, err := wstore.DBGetAllObjsByType[*waveobj.Tab](ctx, waveobj.OType_Tab)
	if err != nil {
		return nil, fmt.Errorf("loading tabs: %w", err)
	}
	runs, err := wstore.DBGetAllObjsByType[*waveobj.Run](ctx, waveobj.OType_Run)
	if err != nil {
		return nil, fmt.Errorf("loading runs: %w", err)
	}
	chans, err := wstore.GetChannels(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading channels: %w", err)
	}
	facts := &agentRosterFacts{Runs: runs, Channels: chans}
	for _, tab := range tabs {
		if len(tab.BlockIds) == 0 {
			continue
		}
		blockId := tab.BlockIds[0]
		rs := blockcontroller.GetBlockControllerRuntimeStatus(blockId)
		status := orchestrate.LatestAgentStatus(blockId, tab.OID)
		_, openAsk := agentask.GlobalRegistry.Get(waveobj.MakeORef(waveobj.OType_Block, blockId).String())
		facts.Tabs = append(facts.Tabs, agentTabFacts{
			Tab:          tab,
			BlockId:      blockId,
			ShellRunning: rs != nil && rs.ShellProcStatus == blockcontroller.Status_Running,
			ProjectPath:  jarvis.MainCheckout(status.Cwd),
			Status:       status,
			OpenAsk:      openAsk,
			HasStream:    agentctl.Has(blockId),
		})
	}
	return facts, nil
}

func readTabAgentBlock(ctx context.Context, tabId string) string {
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil || len(tab.BlockIds) == 0 {
		return ""
	}
	return tab.BlockIds[0]
}

func readBlockTranscriptMeta(ctx context.Context, blockId string) (string, error) {
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return "", fmt.Errorf("loading block %s: %w", blockId, err)
	}
	if block == nil {
		return "", nil
	}
	return block.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, ""), nil
}

// agentsState folds a session's latest status and its open ask into the three states a caller acts on. The
// ask counts on its own: a Notification a few seconds into a question reports the session as waiting.
func agentsState(status string, openAsk bool) string {
	switch {
	case openAsk || status == baseds.AgentState_Asking:
		return wshrpc.AgentsState_Asking
	case status == baseds.AgentState_Idle || status == baseds.AgentState_Waiting:
		return wshrpc.AgentsState_Idle
	}
	return wshrpc.AgentsState_Working
}

// buildAgentRoster is the live claude and pi agent tabs, ordered by tab id.
// ponytail: a tab whose agent exited back to its shell keeps its last status and still reads as live; a typed
// send lands in the shell. Use the control stream or a session-end report as the liveness signal if that
// happens in practice.
func buildAgentRoster(facts *agentRosterFacts) []agentRow {
	var rows []agentRow
	for _, tf := range facts.Tabs {
		if !tf.ShellRunning || !agentHarnesses[tf.Status.Agent] {
			continue
		}
		row := agentRow{
			AgentInfo: wshrpc.AgentInfo{
				TabId:       tf.Tab.OID,
				Name:        tf.Tab.Name,
				ProjectPath: tf.ProjectPath,
				Harness:     tf.Status.Agent,
				State:       agentsState(tf.Status.State, tf.OpenAsk),
			},
			blockId:   tf.BlockId,
			status:    tf.Status,
			hasStream: tf.HasStream,
		}
		if run := ownerRun(facts.Runs, tf.Tab.OID); run != nil {
			row.RunId = run.OID
			if run.ProjectPath != "" {
				row.ProjectPath = run.ProjectPath
			}
		}
		if ch := wstore.MatchChannelAtPath(facts.Channels, row.ProjectPath); ch != nil {
			row.Project = ch.Name
		} else if row.ProjectPath != "" {
			row.Project = path.Base(strings.TrimRight(strings.ReplaceAll(row.ProjectPath, "\\", "/"), "/"))
		}
		rows = append(rows, row)
	}
	slices.SortFunc(rows, func(a, b agentRow) int { return strings.Compare(a.TabId, b.TabId) })
	return rows
}

// ownerRun is the newest run that lists tabId as a phase worker, nil for a session no run started.
func ownerRun(runs []*waveobj.Run, tabId string) *waveobj.Run {
	var owner *waveobj.Run
	for _, run := range runs {
		if runHasWorkerTab(run, tabId) && (owner == nil || run.CreatedTs > owner.CreatedTs) {
			owner = run
		}
	}
	return owner
}

// resolveAgentTab finds the row a caller named by its tab id or a unique prefix of one.
func resolveAgentTab(rows []agentRow, tab string) (*agentRow, error) {
	tab = strings.TrimSpace(tab)
	if tab == "" {
		return nil, fmt.Errorf("a tab id is required; wsh agents list shows the live agents")
	}
	var matches []*agentRow
	for i := range rows {
		if rows[i].TabId == tab {
			return &rows[i], nil
		}
		if strings.HasPrefix(rows[i].TabId, tab) {
			matches = append(matches, &rows[i])
		}
	}
	switch len(matches) {
	case 0:
		return nil, fmt.Errorf("tab %q is not a live agent session; wsh agents list shows the live agents", tab)
	case 1:
		return matches[0], nil
	}
	names := make([]string, len(matches))
	for i, m := range matches {
		names[i] = fmt.Sprintf("%s (%s)", m.TabId, m.Name)
	}
	return nil, fmt.Errorf("tab %q matches several live agents: %s; use more of the id", tab, strings.Join(names, ", "))
}

// senderTab resolves who is sending from the block wsh runs in, so the caller cannot name itself. The block
// it returns is the tab's agent block, the one the send-back lock knows a target by.
func senderTab(facts *agentRosterFacts, fromORef string) (blockId string, tab *waveobj.Tab, err error) {
	oref, err := waveobj.ParseORef(fromORef)
	if err != nil || oref.OType != waveobj.OType_Block {
		return "", nil, fmt.Errorf("cannot tell who is sending: %q is not a block; wsh agents send runs inside an agent's terminal", fromORef)
	}
	for _, tf := range facts.Tabs {
		if slices.Contains(tf.Tab.BlockIds, oref.OID) {
			return tf.BlockId, tf.Tab, nil
		}
	}
	return "", nil, fmt.Errorf("cannot tell who is sending: block %s is in no tab", oref.OID)
}

func (ws *WshServer) AgentsListCommand(ctx context.Context) (*wshrpc.CommandAgentsListRtnData, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.CommandAgentsListRtnData{Agents: []wshrpc.AgentInfo{}}
	for _, row := range buildAgentRoster(facts) {
		rtn.Agents = append(rtn.Agents, row.AgentInfo)
	}
	return rtn, nil
}

func (ws *WshServer) AgentsSendCommand(ctx context.Context, data wshrpc.CommandAgentsSendData) (*wshrpc.CommandAgentsSendRtnData, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	target, err := resolveAgentTab(buildAgentRoster(facts), data.Tab)
	if err != nil {
		return nil, err
	}
	senderBlock, sender, err := senderTab(facts, data.FromORef)
	if err != nil {
		return nil, err
	}
	if sender.OID == target.TabId {
		return nil, fmt.Errorf("tab %s is your own session; an agent cannot message itself", target.TabId)
	}
	if agentmsg.SendBackLocked(senderBlock, target.blockId) {
		return nil, fmt.Errorf("agent %q messaged you this turn and reads your reply with wsh agents read, so answer in this turn instead of sending one back", target.Name)
	}
	text := strings.TrimSpace(data.Text)
	if text == "" {
		return nil, fmt.Errorf("the message is empty")
	}
	if target.State == wshrpc.AgentsState_Asking && !target.hasStream {
		return nil, fmt.Errorf("agent %q has a question open in its terminal, and a typed message would answer it; send again once it is answered", target.Name)
	}
	agentmsg.NoteSent(senderBlock, target.blockId)
	// the envelope's header is one line, and a tab name is whatever the user typed
	senderName := strings.Join(strings.Fields(sender.Name), " ")
	deliverAgentMessage(target.blockId, agentmsg.Envelope(senderName, sender.OID, text))
	return &wshrpc.CommandAgentsSendRtnData{
		TabId:   target.TabId,
		SentTs:  time.Now().UnixMilli(),
		MidTurn: target.State != wshrpc.AgentsState_Idle,
	}, nil
}

func (ws *WshServer) AgentsReadCommand(ctx context.Context, data wshrpc.CommandAgentsReadData) (*wshrpc.CommandAgentsReadRtnData, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	target, err := resolveAgentTab(buildAgentRoster(facts), data.Tab)
	if err != nil {
		return nil, err
	}
	tpath, err := agentTranscriptPath(ctx, target)
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.CommandAgentsReadRtnData{TabId: target.TabId, State: target.State}
	if tpath != "" {
		rtn.Answer, rtn.AnswerTs = agentsessions.LastAnswer(tpath, target.Harness)
	}
	return rtn, nil
}

// agentTranscriptPath is where a session's transcript is, "" when nothing says yet: what its status
// reported, else what its hook recorded on the block, else the file its harness names by session id.
func agentTranscriptPath(ctx context.Context, row *agentRow) (string, error) {
	if row.status.TranscriptPath != "" {
		return row.status.TranscriptPath, nil
	}
	tpath, err := blockTranscriptMeta(ctx, row.blockId)
	if err != nil || tpath != "" {
		return tpath, err
	}
	return agentsessions.TranscriptForSession(agentsessions.SessionRoot(row.Harness), row.Harness, row.status.Cwd, row.status.SessionID), nil
}

// noteAgentTurnEnded opens the send-back lock of an agent that is back at its prompt.
func noteAgentTurnEnded(ctx context.Context, ev *wps.WaveEvent) {
	// events arrive over the RPC wire with Data as a raw JSON map, so decode rather than assert.
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil {
		return
	}
	if data.State != baseds.AgentState_Idle && data.State != baseds.AgentState_Waiting {
		return
	}
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil {
		return
	}
	switch oref.OType {
	case waveobj.OType_Block:
		agentmsg.TurnEnded(oref.OID)
	case waveobj.OType_Tab:
		// the lock knows an agent by its block, which a tab-scoped reporter never names
		if blockId := tabAgentBlock(ctx, oref.OID); blockId != "" {
			agentmsg.TurnEnded(blockId)
		}
	}
}
