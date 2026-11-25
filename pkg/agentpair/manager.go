// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// What Link.State says of an agent. LinkGone is for good: the tab was deleted or its session ended. An agent that is
// only not on the roster yet (wavesrv has just restarted and is relaunching it) reads LinkWorking, so a restart never
// marks a member gone.
const (
	LinkIdle     = "idle"
	LinkWorking  = "working"
	LinkAsking   = "asking"
	LinkSleeping = "sleeping"
	LinkGone     = "gone"
)

// pairHarnesses are the harnesses a pair can seat: the ones whose last answer arcterm can read.
var pairHarnesses = map[string]bool{"claude": true, "pi": true}

// briefTurns is how many of the working agent's recent turns are read for the plan and spec paths they name.
const briefTurns = 12

// AgentFacts is what the roster knows of one agent tab.
type AgentFacts struct {
	Name       string
	Harness    string
	Project    string
	Cwd        string
	Transcript string
}

// Link is the manager's view of the live agents. It is an interface because the manager is tested without any: wavesrv
// supplies one over the roster.
type Link interface {
	// State is one of the Link constants.
	State(ctx context.Context, tab string) (string, error)
	// Send hands the agent a prompt, waking it when it sleeps.
	Send(ctx context.Context, tab, text string) error
	// LastAnswer is the agent's latest reply and when it ended (ms). An agent that has not answered yet gives "", 0 and
	// no error: an error means the answer could not be read.
	LastAnswer(ctx context.Context, tab string) (text string, ts int64, err error)
	// Tokens is Input + CacheRead + CacheCreation + Output of the agent's session since sinceMs.
	Tokens(ctx context.Context, tab string, sinceMs int64) (int64, error)
	// Agent names the tab; an error for a tab that is not an agent.
	Agent(ctx context.Context, tab string) (AgentFacts, error)
	// RecentTexts is the texts of the agent's last n turns, oldest first.
	RecentTexts(ctx context.Context, tab string, n int) ([]string, error)
}

// Manager owns the pairs: the store, the relay, the stops, the hold. Its pair files are read on the first call of any
// method (or by Load at boot); from then on the index of the pairs that are not ended is in memory.
type Manager struct {
	Link    Link
	Dir     string
	Publish func(wshrpc.PairUpdateData)
	Now     func() time.Time // nil: time.Now

	mu      sync.Mutex // the index and every write of a pair
	loaded  bool
	pairs   map[string]*Pair // by id
	sending map[string]bool  // the tabs a delivery is on its way to
}

func (m *Manager) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

func (m *Manager) nowMs() int64 { return m.now().UnixMilli() }

// lock takes the mutex and, the first time (or the first after a failed read), reads the pair files into the index.
func (m *Manager) lock() {
	m.mu.Lock()
	if m.pairs == nil {
		m.pairs = map[string]*Pair{}
		m.sending = map[string]bool{}
	}
	if m.loaded {
		return
	}
	active, err := store{dir: m.Dir}.loadActive()
	if err != nil {
		log.Printf("pairs: %v\n", err) // not loaded: the next call reads again
		return
	}
	for _, p := range active {
		if m.pairs[p.Id] == nil {
			m.pairs[p.Id] = p
		}
	}
	m.loaded = true
}

func (m *Manager) saveLocked(p *Pair) error {
	err := store{dir: m.Dir}.save(p)
	if err != nil {
		log.Printf("pairs: %v\n", err)
	}
	return err
}

func (m *Manager) publish(u wshrpc.PairUpdateData) {
	if m.Publish != nil {
		m.Publish(u)
	}
}

// change runs fn on the pair under the lock. When fn says it changed the pair, the pair is saved and published, and an
// ended one leaves the index. It reports whether there was such a pair. A failed save is logged: the index holds the
// change and the next one saves the whole pair again.
func (m *Manager) change(id string, fn func(p *Pair) bool) bool {
	m.lock()
	p := m.pairs[id]
	if p == nil {
		m.mu.Unlock()
		return false
	}
	changed := fn(p)
	if changed {
		m.saveLocked(p)
	}
	if p.State == StateEnded {
		delete(m.pairs, id)
	}
	u := wshrpc.PairUpdateData{PairId: p.Id, WorkerTab: p.Worker.Tab}
	m.mu.Unlock()
	if changed {
		m.publish(u)
	}
	return true
}

// ErrNoPair is what a pair that is not in the index (never made, or ended) answers with.
var ErrNoPair = errors.New("no pair")

func errNoPair(id string) error { return fmt.Errorf("%w %q", ErrNoPair, id) }

// pairOf is the pair a tab is in, as its working agent (worker true) or as a judge that is not gone. The lock is held.
func (m *Manager) pairOf(tab string) (p *Pair, worker bool) {
	for _, p := range m.pairs {
		if p.Worker.Tab == tab {
			return p, true
		}
		for _, j := range p.Judges {
			if j.Tab == tab && !j.Gone {
				return p, false
			}
		}
	}
	return nil, false
}

func isJudge(p *Pair, tab string) bool {
	return slices.ContainsFunc(p.Judges, func(j Side) bool { return j.Tab == tab && !j.Gone })
}

// memberTabs is the working agent's tab and then each judge's that is not gone.
func memberTabs(p *Pair) []string {
	tabs := []string{p.Worker.Tab}
	for _, j := range liveJudges(p) {
		tabs = append(tabs, j.Tab)
	}
	return tabs
}

func (m *Manager) members(id string) []string {
	m.lock()
	defer m.mu.Unlock()
	if p := m.pairs[id]; p != nil {
		return memberTabs(p)
	}
	return nil
}

// List is the pairs that are not ended, oldest first.
func (m *Manager) List() []wshrpc.PairInfo {
	m.lock()
	defer m.mu.Unlock()
	all := make([]*Pair, 0, len(m.pairs))
	for _, p := range m.pairs {
		all = append(all, p)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].CreatedTs != all[j].CreatedTs {
			return all[i].CreatedTs < all[j].CreatedTs
		}
		return all[i].Id < all[j].Id
	})
	infos := make([]wshrpc.PairInfo, 0, len(all))
	for _, p := range all {
		infos = append(infos, Info(p))
	}
	return infos
}

// Get is one pair in full.
func (m *Manager) Get(id string) (*wshrpc.PairView, error) {
	m.lock()
	defer m.mu.Unlock()
	p := m.pairs[id]
	if p == nil {
		return nil, errNoPair(id)
	}
	return View(p), nil
}

// Paired reports whether the tab is in a pair that is not ended.
func (m *Manager) Paired(tab string) bool {
	m.lock()
	defer m.mu.Unlock()
	p, _ := m.pairOf(tab)
	return p != nil
}

// Brief is the launch task of a new judge for the working agent at workerTab.
func (m *Manager) Brief(ctx context.Context, workerTab string) (string, error) {
	facts, err := m.Link.Agent(ctx, workerTab)
	if err != nil {
		return "", err
	}
	reply, _, err := m.Link.LastAnswer(ctx, workerTab)
	if err != nil {
		return "", fmt.Errorf("reading the latest reply of %s: %w", workerTab, err)
	}
	return m.briefText(ctx, workerTab, facts.Name, reply, ""), nil
}

// briefText is JudgeBrief with the plan and spec paths the working agent's recent turns name.
func (m *Manager) briefText(ctx context.Context, workerTab, workerName, reply, note string) string {
	texts, err := m.Link.RecentTexts(ctx, workerTab, briefTurns)
	if err != nil {
		log.Printf("pair brief: reading the recent turns of %s: %v\n", workerTab, err) // the brief goes without paths
	}
	if strings.TrimSpace(reply) != "" {
		texts = append(texts, reply)
	}
	return JudgeBrief(JudgeBriefInput{WorkerName: workerName, WorkerTab: workerTab, Reply: reply, Docs: DocsAtHand(texts), Note: note})
}

// startPlan says what Start does for d: make a new pair (existing is "") or add a judge to the working agent's pair.
// The lock is held.
func (m *Manager) startPlan(d wshrpc.CommandPairStartData) (existing string, err error) {
	if p, _ := m.pairOf(d.JudgeTab); p != nil {
		return "", fmt.Errorf("agent %s is already in a pair", d.JudgeTab)
	}
	p, isWorker := m.pairOf(d.WorkerTab)
	if p != nil && !isWorker {
		return "", fmt.Errorf("agent %s judges another pair", d.WorkerTab)
	}
	if p != nil {
		return p.Id, nil
	}
	return "", nil
}

func (m *Manager) pairable(ctx context.Context, tab string) (AgentFacts, error) {
	facts, err := m.Link.Agent(ctx, tab)
	if err != nil {
		return AgentFacts{}, err
	}
	if !pairHarnesses[facts.Harness] {
		return AgentFacts{}, fmt.Errorf("agent %s runs %q: a pair seats claude and pi agents", tab, facts.Harness)
	}
	return facts, nil
}

// Start pairs the working agent with a judge, or adds the judge to the working agent's pair.
func (m *Manager) Start(ctx context.Context, d wshrpc.CommandPairStartData) (*wshrpc.PairView, error) {
	if d.WorkerTab == "" || d.JudgeTab == "" {
		return nil, errors.New("a pair needs a working agent and a judge")
	}
	if d.WorkerTab == d.JudgeTab {
		return nil, errors.New("an agent cannot judge itself")
	}
	m.lock()
	existing, err := m.startPlan(d)
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}

	workerFacts, err := m.pairable(ctx, d.WorkerTab)
	if err != nil {
		return nil, err
	}
	judgeFacts, err := m.pairable(ctx, d.JudgeTab)
	if err != nil {
		return nil, err
	}
	var workerText string
	var workerTs, judgeSeen int64
	if existing == "" {
		if workerText, workerTs, err = m.Link.LastAnswer(ctx, d.WorkerTab); err != nil {
			return nil, fmt.Errorf("reading the latest reply of %s: %w", d.WorkerTab, err)
		}
	}
	if !d.Briefed {
		// a judge that is already running keeps what it said before the pair: only its answers from now count
		if _, judgeSeen, err = m.Link.LastAnswer(ctx, d.JudgeTab); err != nil {
			return nil, fmt.Errorf("reading the latest reply of %s: %w", d.JudgeTab, err)
		}
	}

	m.lock()
	if again, err := m.startPlan(d); err != nil || again != existing {
		m.mu.Unlock()
		if err == nil {
			err = errors.New("the pair changed while it was starting: try again")
		}
		return nil, err
	}
	now := m.nowMs()
	judge := Side{Tab: d.JudgeTab, Name: judgeFacts.Name, Harness: judgeFacts.Harness, Briefed: d.Briefed}
	var p *Pair
	if existing == "" {
		tokenCap := d.TokenCap
		if tokenCap <= 0 {
			tokenCap = DefaultTokenCap
		}
		p = &Pair{
			Id: uuid.NewString(), Project: workerFacts.Project, HoldHeavy: d.HoldHeavy, TokenCap: tokenCap, Note: d.Note,
			Worker:    Side{Tab: d.WorkerTab, Name: workerFacts.Name, Harness: workerFacts.Harness},
			Judges:    []Side{judge},
			CreatedTs: now, CapFromTs: now, State: StateRelaying,
			Messages: []Message{}, Pending: map[string][]string{}, Seen: map[string]int64{},
		}
		if strings.TrimSpace(workerText) != "" {
			// the working agent's latest reply is the conversation's first message; the judge owes an answer to it
			ts := workerTs
			if ts == 0 {
				ts = now
			}
			p.Messages = append(p.Messages, Message{Id: nextId(p), From: FromWorker, Tab: d.WorkerTab, Ts: ts, Raw: workerText})
			p.Seen[d.WorkerTab] = workerTs
		}
		m.pairs[p.Id] = p
	} else {
		p = m.pairs[existing]
		p.Judges = append(p.Judges, judge)
		if p.State == StateStopped && p.StopReason == StopJudgesGone {
			resume(p, now)
		}
	}
	if !d.Briefed {
		p.Seen[d.JudgeTab] = judgeSeen
	}
	saveErr := m.saveLocked(p)
	id, workerName, reply := p.Id, p.Worker.Name, newestWorkerRaw(p)
	u := wshrpc.PairUpdateData{PairId: p.Id, WorkerTab: p.Worker.Tab}
	m.mu.Unlock()
	if saveErr != nil {
		m.undoStart(id, d.JudgeTab, existing == "")
		return nil, saveErr
	}
	m.publish(u)

	if !d.Briefed {
		brief := m.briefText(ctx, d.WorkerTab, workerName, reply, d.Note)
		if err := m.Link.Send(ctx, d.JudgeTab, agentmsg.PairEnvelope(brief)); err != nil {
			m.undoStart(id, d.JudgeTab, existing == "")
			return nil, fmt.Errorf("briefing the judge: %w", err)
		}
	}
	// a briefed judge may have answered before the pair existed: take what each member has said, as a turn end does
	m.catchUp(ctx, id, m.members(id), true)
	return m.Get(id)
}

// undoStart takes back a Start whose judge could not be reached: a new pair ends, a judge added to a pair leaves it.
func (m *Manager) undoStart(id, judgeTab string, newPair bool) {
	m.change(id, func(p *Pair) bool {
		if newPair {
			p.State = StateEnded
			return true
		}
		p.Judges = slices.DeleteFunc(p.Judges, func(j Side) bool { return j.Tab == judgeTab })
		delete(p.Seen, judgeTab)
		return true
	})
}

func newestWorkerRaw(p *Pair) string {
	if i := newestWorker(p); i >= 0 {
		return p.Messages[i].Raw
	}
	return ""
}

func nextId(p *Pair) string { return fmt.Sprintf("m%d", len(p.Messages)+1) }

// Say is the person's message, or their answer to an A item. It resumes a stopped pair.
func (m *Manager) Say(ctx context.Context, d wshrpc.CommandPairSayData) error {
	text := strings.TrimSpace(d.Text)
	if text == "" {
		return errors.New("an empty message")
	}
	var refused error
	if !m.change(d.PairId, func(p *Pair) bool {
		if refused = checkSay(p, d); refused != nil {
			return false
		}
		m.appendPerson(p, text, d.To, d.ReplyTo, d.Item)
		return true
	}) {
		return errNoPair(d.PairId)
	}
	if refused != nil {
		return refused
	}
	m.deliverAll(ctx, d.PairId, true)
	return nil
}

// checkSay refuses a message to nobody in the pair or a reply to no message of it.
func checkSay(p *Pair, d wshrpc.CommandPairSayData) error {
	switch d.To {
	case "", ToBoth, ToWorker, ToJudge:
	default:
		if !isJudge(p, d.To) {
			return fmt.Errorf("%q is not in this pair", d.To)
		}
	}
	if d.ReplyTo != "" && messageIndex(p, d.ReplyTo) < 0 {
		return fmt.Errorf("no message %q to reply to", d.ReplyTo)
	}
	return nil
}

func messageIndex(p *Pair, id string) int {
	return slices.IndexFunc(p.Messages, func(m Message) bool { return m.Id == id })
}

// appendPerson adds the person's message to the conversation, queues it for where it goes and resumes a stopped pair.
func (m *Manager) appendPerson(p *Pair, text, to, replyTo string, item int) {
	if to == "" {
		to = ToBoth
	}
	msg := Message{Id: nextId(p), From: FromPerson, Ts: m.nowMs(), Raw: text, To: to, ReplyTo: replyTo, Item: item}
	p.Messages = append(p.Messages, msg)
	enqueue(p, msg)
	if p.State == StateStopped {
		resume(p, msg.Ts)
	}
}

func (m *Manager) addSystem(p *Pair, text string) {
	p.Messages = append(p.Messages, Message{Id: nextId(p), From: FromSystem, Ts: m.nowMs(), Raw: text})
}

// resume puts a stopped pair back to relaying. After a token-cap stop the cap counts again from now.
func resume(p *Pair, now int64) {
	if p.StopReason == StopTokenCap {
		p.CapFromTs, p.Tokens, p.Worker.Tokens = now, 0, 0
		for i := range p.Judges {
			p.Judges[i].Tokens = 0
		}
	}
	p.State, p.StopReason = StateRelaying, ""
}

// recipients are the tabs a message queues for: a working agent's message for every live judge; a judge's for the
// working agent and the other judges; the person's where its To sends it. The system's goes nowhere.
func recipients(p *Pair, msg Message) []string {
	var tabs []string
	switch msg.From {
	case FromWorker:
		for _, j := range liveJudges(p) {
			tabs = append(tabs, j.Tab)
		}
	case FromJudge:
		tabs = append(tabs, p.Worker.Tab)
		for _, j := range liveJudges(p) {
			if j.Tab != msg.Tab {
				tabs = append(tabs, j.Tab)
			}
		}
	case FromPerson:
		switch msg.To {
		case ToWorker:
			tabs = append(tabs, p.Worker.Tab)
		case ToJudge:
			for _, j := range liveJudges(p) {
				tabs = append(tabs, j.Tab)
			}
		case ToBoth, "":
			tabs = memberTabs(p)
		default:
			if isJudge(p, msg.To) {
				tabs = append(tabs, msg.To)
			}
		}
	}
	return tabs
}

func enqueue(p *Pair, msg Message) {
	for _, tab := range recipients(p, msg) {
		p.Pending[tab] = append(p.Pending[tab], msg.Id)
	}
}

// callsFor reports whether a message asks the agent at tab to answer. A working agent answers a judge or the person; a
// judge answers the working agent or the person. Another judge's message is context for its next prompt: two judges
// answering each other would talk past the working agent for good.
func callsFor(p *Pair, tab string, msg Message) bool {
	if tab == p.Worker.Tab {
		return msg.From == FromJudge || msg.From == FromPerson
	}
	return msg.From == FromWorker || msg.From == FromPerson
}

func callsForAnswer(p *Pair, tab string) bool {
	if tab != p.Worker.Tab && !isJudge(p, tab) {
		return false
	}
	for _, id := range p.Pending[tab] {
		if i := messageIndex(p, id); i >= 0 && callsFor(p, tab, p.Messages[i]) {
			return true
		}
	}
	return false
}

// removeIds takes ids out of tab's queue, and the queue with them when it is empty.
func removeIds(p *Pair, tab string, ids []string) {
	left := slices.DeleteFunc(slices.Clone(p.Pending[tab]), func(id string) bool { return slices.Contains(ids, id) })
	if len(left) == 0 {
		delete(p.Pending, tab)
		return
	}
	p.Pending[tab] = left
}

// answeredBy is the message a reply from tab answers: the newest one relayed to it that called for an answer.
func answeredBy(p *Pair, tab string) string {
	for i := len(p.Messages) - 1; i >= 0; i-- {
		msg := p.Messages[i]
		if callsFor(p, tab, msg) && slices.Contains(recipients(p, msg), tab) && !slices.Contains(p.Pending[tab], msg.Id) {
			return msg.Id
		}
	}
	return ""
}

// TurnEnded is a member of a pair reporting idle: take what it answered, count tokens, run the stop rule and deliver
// the queues that can go.
func (m *Manager) TurnEnded(ctx context.Context, tab string) {
	m.lock()
	p, _ := m.pairOf(tab)
	var id string
	if p != nil {
		id = p.Id
	}
	m.mu.Unlock()
	if id != "" {
		m.catchUp(ctx, id, []string{tab}, true)
	}
}

// Load reads the pairs now and, for each member the roster knows, takes an answer it gave while wavesrv was down and
// delivers what waits for it. At boot the roster is empty and relaunches agents that report later, so a member that
// reads gone is no news: Load skips it and keeps its queue, and its first idle after the restore goes through
// TurnEnded.
func (m *Manager) Load(ctx context.Context) {
	m.lock()
	ids := make([]string, 0, len(m.pairs))
	for id := range m.pairs {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	sort.Strings(ids)
	for _, id := range ids {
		var known []string
		for _, tab := range m.members(id) {
			state, err := m.Link.State(ctx, tab)
			if err != nil {
				log.Printf("pair %s: the state of %s: %v\n", id, tab, err)
				continue
			}
			if state != LinkGone {
				known = append(known, tab)
			}
		}
		m.catchUp(ctx, id, known, false)
	}
}

// catchUp takes the answers of tabs, settles the pair's counts and stop, and delivers every queue that can go.
func (m *Manager) catchUp(ctx context.Context, id string, tabs []string, trustGone bool) {
	tookJudge := false
	for _, tab := range tabs {
		if m.takeAnswer(ctx, id, tab) == FromJudge {
			tookJudge = true
		}
	}
	m.settle(ctx, id, tookJudge)
	m.deliverAll(ctx, id, trustGone)
}

// takeAnswer adds the agent's latest answer to the conversation when the pair has not taken it yet, and says whose it
// was (FromWorker, FromJudge, or "" when there was nothing new). It resumes a stopped pair when the working agent's
// reply is the new one, except after a token-cap stop: spending more is the person's call.
func (m *Manager) takeAnswer(ctx context.Context, id, tab string) string {
	text, ts, err := m.Link.LastAnswer(ctx, tab)
	if err != nil {
		log.Printf("pair %s: reading the answer of %s: %v\n", id, tab, err)
		return ""
	}
	if strings.TrimSpace(text) == "" {
		return ""
	}
	took := ""
	m.change(id, func(p *Pair) bool {
		if ts <= p.Seen[tab] {
			return false
		}
		from := FromJudge
		switch {
		case tab == p.Worker.Tab:
			from = FromWorker
		case !isJudge(p, tab):
			return false
		}
		msg := Message{Id: nextId(p), From: from, Tab: tab, Ts: ts, Raw: text, ReplyTo: answeredBy(p, tab)}
		if from == FromWorker {
			msg.Held, p.Held = p.Held, nil // the heavy commands refused since its last message hang on this one
		}
		p.Seen[tab] = ts
		p.Messages = append(p.Messages, msg)
		enqueue(p, msg)
		if from == FromWorker && p.State == StateStopped && p.StopReason != StopTokenCap {
			resume(p, m.nowMs())
		}
		took = from
		return true
	})
	return took
}

// settle counts the pair's tokens since its cap started and runs the stop rule. The rule reads the judges' replies, so
// it runs when one was just taken (or no judge is left), not on every turn end: after the person resumes a stop the
// judge's old reply is still the newest, and a rule run at the working agent's next turn end would stop it again.
func (m *Manager) settle(ctx context.Context, id string, tookJudge bool) {
	m.lock()
	p := m.pairs[id]
	if p == nil {
		m.mu.Unlock()
		return
	}
	since, tabs := p.CapFromTs, memberTabs(p)
	m.mu.Unlock()

	// a session that cannot be read keeps its last count, so the total never drops for a failed read
	counts := map[string]int64{}
	for _, tab := range tabs {
		n, err := m.Link.Tokens(ctx, tab, since)
		if err != nil {
			log.Printf("pair %s: counting the tokens of %s: %v\n", id, tab, err)
			continue
		}
		counts[tab] = n
	}

	m.change(id, func(p *Pair) bool {
		changed := false
		if p.CapFromTs == since {
			total := setSideTokens(&p.Worker, counts)
			for i := range p.Judges {
				total += setSideTokens(&p.Judges[i], counts)
			}
			if p.Tokens != total {
				p.Tokens, changed = total, true
			}
		}
		if p.State != StateRelaying {
			return changed
		}
		reason := ""
		if tookJudge || len(liveJudges(p)) == 0 {
			reason = StopVerdict(p)
		}
		if reason == "" && p.Tokens >= p.TokenCap {
			reason = StopTokenCap
		}
		if reason != "" {
			m.stop(p, reason)
			changed = true
		}
		return changed
	})
}

// setSideTokens takes a side's new count when one was read (a gone judge is not read, so it keeps its last) and returns
// the side's count.
func setSideTokens(s *Side, counts map[string]int64) int64 {
	if n, ok := counts[s.Tab]; ok {
		s.Tokens = n
	}
	return s.Tokens
}

// stop pauses the pair and says why in one system line. The judge replies behind a no-new-points or a settled stop ask
// nothing of the working agent, and delivering them would start a turn that restarts the exchange: they leave its
// queue. Every other queue is kept.
func (m *Manager) stop(p *Pair, reason string) {
	p.State, p.StopReason = StateStopped, reason
	switch reason {
	case StopNoNewPoints:
		m.addSystem(p, "Paused: the judge has no new points")
	case StopSettled:
		m.addSystem(p, "Paused: both agree")
	case StopTokenCap:
		m.addSystem(p, fmt.Sprintf("Paused: token cap reached (%.1fM)", float64(p.TokenCap)/1e6))
	case StopJudgesGone:
		m.addSystem(p, "Paused: no judge is left")
	}
	if reason == StopNoNewPoints || reason == StopSettled {
		var behind []string
		for _, msg := range p.Messages[newestWorker(p)+1:] {
			if msg.From == FromJudge {
				behind = append(behind, msg.Id)
			}
		}
		removeIds(p, p.Worker.Tab, behind)
	}
}

// deliverAll tries every member's queue. trustGone says whether a member the link reads gone is marked gone.
func (m *Manager) deliverAll(ctx context.Context, id string, trustGone bool) {
	for _, tab := range m.members(id) {
		m.deliver(ctx, id, tab, trustGone)
	}
}

// deliver sends tab its queue as one prompt when the queue calls for an answer, the pair relays and the agent is at
// rest (idle, or asleep: a send wakes it). It never holds the lock across the link. A failed send is logged and the
// queue stays for the next try.
func (m *Manager) deliver(ctx context.Context, id, tab string, trustGone bool) {
	m.lock()
	p := m.pairs[id]
	if p == nil || p.State != StateRelaying || m.sending[tab] || !callsForAnswer(p, tab) {
		m.mu.Unlock()
		return
	}
	m.sending[tab] = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.sending, tab)
		m.mu.Unlock()
	}()

	state, err := m.Link.State(ctx, tab)
	if err != nil {
		log.Printf("pair %s: the state of %s: %v\n", id, tab, err)
		return
	}
	switch state {
	case LinkIdle, LinkSleeping:
	case LinkGone:
		if trustGone {
			m.memberGone(id, tab)
		}
		return
	default:
		return // working or asking: its turn end delivers
	}

	prompt, ids, briefed := m.buildPrompt(id, tab)
	if len(ids) == 0 {
		return
	}
	if err := m.Link.Send(ctx, tab, agentmsg.PairEnvelope(prompt)); err != nil {
		log.Printf("pair %s: sending to %s: %v\n", id, tab, err)
		return
	}
	m.change(id, func(p *Pair) bool {
		removeIds(p, tab, ids)
		if briefed {
			p.WorkerBriefed = true
		}
		return true
	})
}

// buildPrompt is tab's queue as one prompt, the ids it holds and whether it opens with the worker brief. It is empty
// when the queue stopped calling for an answer meanwhile.
func (m *Manager) buildPrompt(id, tab string) (prompt string, ids []string, briefed bool) {
	m.lock()
	defer m.mu.Unlock()
	p := m.pairs[id]
	if p == nil || p.State != StateRelaying || !callsForAnswer(p, tab) {
		return "", nil, false
	}
	var items []RelayItem
	for _, mid := range p.Pending[tab] {
		ids = append(ids, mid)
		if i := messageIndex(p, mid); i >= 0 {
			items = append(items, relayItem(p, p.Messages[i]))
		}
	}
	first := ""
	if tab == p.Worker.Tab && !p.WorkerBriefed {
		var names []string
		for _, j := range liveJudges(p) {
			names = append(names, j.Name)
		}
		first, briefed = WorkerBrief(names), true
	}
	return RelayPrompt(items, first), ids, briefed
}

func relayItem(p *Pair, msg Message) RelayItem {
	it := RelayItem{From: msg.From, Tab: msg.Tab, Ts: msg.Ts, Text: msg.Raw}
	switch {
	case msg.Tab == p.Worker.Tab:
		it.Name = p.Worker.Name
	case msg.From == FromJudge:
		for _, j := range p.Judges {
			if j.Tab == msg.Tab {
				it.Name = j.Name
			}
		}
	case msg.From == FromPerson:
		// the receiver has no field for an item or a quote: they go in the text
		if msg.Item > 0 {
			it.Text = fmt.Sprintf("Answer to A%d: %s", msg.Item, msg.Raw)
		}
		if i := messageIndex(p, msg.ReplyTo); i >= 0 {
			shown, _ := shownOf(p.Messages[i])
			it.Text = "> " + firstLine(shown) + "\n" + it.Text
		}
	}
	return it
}

// memberGone marks a member the link reports gone for good: a judge leaves the exchange with a line saying so (and the
// pair stops when it was the last), the working agent's going ends the pair.
func (m *Manager) memberGone(id, tab string) {
	m.change(id, func(p *Pair) bool {
		if tab == p.Worker.Tab {
			p.Worker.Gone, p.State = true, StateEnded
			m.addSystem(p, "The working agent is gone: the pair ended")
			return true
		}
		for i := range p.Judges {
			j := &p.Judges[i]
			if j.Tab != tab || j.Gone {
				continue
			}
			j.Gone = true
			delete(p.Pending, tab)
			m.addSystem(p, fmt.Sprintf("The judge %q is gone", j.Name))
			if p.State == StateRelaying {
				if reason := StopVerdict(p); reason != "" {
					m.stop(p, reason)
				}
			}
			return true
		}
		return false
	})
}
