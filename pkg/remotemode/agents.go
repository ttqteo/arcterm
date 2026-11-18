// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// HandedAgent is one handed-over agent as the phone page draws it.
type HandedAgent struct {
	Tab     string `json:"tab"`
	Name    string `json:"name"`
	Project string `json:"project"`
	Runtime string `json:"runtime"` // claude | pi
	State   string `json:"state"`   // Phone* constants
	Since   int64  `json:"since"`   // unix ms
	Line    string `json:"line"`
}

// AgentAction is what the phone asks of a handed-over agent.
type AgentAction struct {
	Kind string // Action* constants
	Text string
}

const (
	ActionSend    = "send"
	ActionStop    = "stop"
	ActionApprove = "approve"
	ActionDeny    = "deny"
)

// ErrWrongState is an action the agent's current phone state does not take; it is wrapped with the state.
var ErrWrongState = errors.New("the agent is not in a state that takes this")

// ErrRefused is a take the desk refuses; the error wraps it as fmt.Errorf("%w: %s", ErrRefused, reason), and
// the phone is shown the reason.
var ErrRefused = errors.New("refused")

// TranscriptChunk is a run of whole transcript lines and where they sit in the file. Cursor is the byte
// offset of the first line and End the offset just after the last (Backlog marks the stream's first chunk).
// End is not sent in the chunk's JSON: the stream carries it as the event's id, and a page read answers
// with the lines and the cursor alone.
type TranscriptChunk struct {
	Lines   []string `json:"lines"`
	Cursor  int64    `json:"cursor"`
	End     int64    `json:"-"`
	Backlog bool     `json:"backlog"`
}

// StreamSink receives a stream's events; it must be safe for concurrent use, since the transcript tail
// and the state poll send from their own goroutines.
type StreamSink interface {
	Agent(HandedAgent) error
	Lines(TranscriptChunk) error
}

// the keystrokes typed into the agent's terminal (decision 8 of the plan)
const (
	keyEsc        = "\x1b"
	keyEnter      = "\r"
	keyPasteStart = "\x1b[200~"
	keyPasteEnd   = "\x1b[201~"
	// picks Claude Code's first permission option, "Yes", wherever the menu's cursor sits
	keyApprove = "1"
)

const (
	linePermissionCmdPrefix = "running "
	lineAsking              = "Asking you a question"
)

// package vars so tests can record the keystrokes and shorten the poll
var (
	remoteSendInput  = blockcontroller.SendInput
	remoteStreamPoll = 2 * time.Second
)

// the actions each phone state takes
var actionStates = map[string][]string{
	ActionSend:    {PhoneIdle, PhoneWorking},
	ActionStop:    {PhoneWorking},
	ActionApprove: {PhonePermission},
	ActionDeny:    {PhonePermission},
}

func handedAgent(a Agent, since int64) HandedAgent {
	state := PhoneState(a)
	return HandedAgent{
		Tab:     a.TabId,
		Name:    a.Name,
		Project: a.Project,
		Runtime: a.Harness,
		State:   state,
		Since:   since,
		Line:    handedLine(a, state),
	}
}

// ListedAgent is one roster agent in the phone page's Agents list, which only shows them.
type ListedAgent struct {
	Tab     string `json:"tab"`
	Name    string `json:"name"`
	Project string `json:"project"`
	Runtime string `json:"runtime"`
	State   string `json:"state"` // Phone* constants
	// Since is the agent's last status report (unix ms) while it waits or is idle, 0 while it works: a
	// working agent reports on every tool call, so its last report says nothing about how long it has run.
	Since  int64  `json:"since"`
	Line   string `json:"line"`
	Handed bool   `json:"handed"`
	// Takeable is whether a tap can take the agent to the phone: Eligible passes for it.
	Takeable bool `json:"takeable"`
}

// ListedRun is one run in the Agents list's Runs section: its live workers, which the phone only shows.
// NeedsYou is set when a worker is asking or needs approval or input, which only the desk can answer.
type ListedRun struct {
	Key      string         `json:"key"`
	Name     string         `json:"name"`
	NeedsYou bool           `json:"needsyou"`
	Workers  []RunWorkerRow `json:"workers"`
}

// RunWorkerRow is one worker of a ListedRun. Label is what the worker is for ("Review: <task>", the task's
// label, "Plan reviewer"), Line what it is doing; State and Since are an agent row's.
type RunWorkerRow struct {
	Tab   string `json:"tab"`
	Label string `json:"label"`
	State string `json:"state"` // Phone* constants
	Line  string `json:"line"`
	Since int64  `json:"since"`
}

// the Agents list's order: what needs the owner first
var listedStateOrder = map[string]int{
	PhoneAsking: 0, PhonePermission: 1, PhoneInput: 2, PhoneWorking: 3, PhoneIdle: 4,
}

// replyLineMax is the longest idle line, in characters.
const replyLineMax = 160

// agentLive is whether the agent's session still runs: a claude session while the arc mod's control stream
// is open, any other harness until it reports its end. A session that exited to its shell leaves its tab
// open and is not listed.
func agentLive(a Agent) bool {
	return !a.Status.Ended && !(a.Harness == harnessClaude && !a.HasStream)
}

// needsOwner is a state only the desk can answer: a question, an approval or another input.
func needsOwner(state string) bool {
	return state == PhoneAsking || state == PhonePermission || state == PhoneInput
}

// compareListed orders two rows of the list: by state, then the longest waiting first (a working row's
// Since is 0 and comes last), then by name.
func compareListed(xState, yState string, xSince, ySince int64, xName, yName string) int {
	if d := listedStateOrder[xState] - listedStateOrder[yState]; d != 0 {
		return d
	}
	if xSince != ySince {
		if xSince == 0 || (ySince != 0 && xSince > ySince) {
			return 1
		}
		return -1
	}
	return strings.Compare(xName, yName)
}

// runWorker is a RunWorkerRow with the agent's name, which orders it among its run's workers.
type runWorker struct {
	name string
	row  RunWorkerRow
}

type runGroup struct {
	key, name string
	workers   []runWorker
}

// BuildAgentList gives the live roster agents as the phone lists them, sorted by state, then the longest
// waiting first, then by name, and the runs their run workers belong to. A worker is never a row of its
// own: it is listed under its run, which has a row only while a worker is live. handed holds the tabs
// handed to the phone.
func BuildAgentList(agents []Agent, handed map[string]bool) ([]ListedAgent, []ListedRun) {
	out := make([]ListedAgent, 0, len(agents))
	groups := map[string]*runGroup{}
	for _, a := range agents {
		if !agentLive(a) {
			continue
		}
		state := PhoneState(a)
		since := a.Status.Ts
		if state == PhoneWorking {
			since = 0
		}
		line := listLine(a, state)
		if a.RunWorker {
			key := a.RunKey
			if key == "" {
				key = a.TabId // a worker no run names stands alone
			}
			g := groups[key]
			if g == nil {
				g = &runGroup{key: key}
				groups[key] = g
			}
			if g.name == "" {
				g.name = a.RunName
			}
			g.workers = append(g.workers, runWorker{name: a.Name, row: RunWorkerRow{
				Tab: a.TabId, Label: a.RunLine, State: state, Line: line, Since: since,
			}})
			continue
		}
		out = append(out, ListedAgent{
			Tab:      a.TabId,
			Name:     a.Name,
			Project:  a.Project,
			Runtime:  a.Harness,
			State:    state,
			Since:    since,
			Line:     line,
			Handed:   handed[a.TabId],
			Takeable: Eligible(a) == nil,
		})
	}
	slices.SortStableFunc(out, func(x, y ListedAgent) int {
		return compareListed(x.State, y.State, x.Since, y.Since, x.Name, y.Name)
	})
	return out, listedRuns(groups)
}

// listedRuns turns the run groups into rows: a run that needs you first, then by name, then key.
func listedRuns(groups map[string]*runGroup) []ListedRun {
	runs := make([]ListedRun, 0, len(groups))
	for _, g := range groups {
		slices.SortStableFunc(g.workers, func(x, y runWorker) int {
			if d := compareListed(x.row.State, y.row.State, x.row.Since, y.row.Since, x.name, y.name); d != 0 {
				return d
			}
			return strings.Compare(x.row.Tab, y.row.Tab)
		})
		run := ListedRun{Key: g.key, Name: g.name, Workers: make([]RunWorkerRow, len(g.workers))}
		if run.Name == "" {
			run.Name = g.workers[0].name
		}
		for i, w := range g.workers {
			run.Workers[i] = w.row
			run.NeedsYou = run.NeedsYou || needsOwner(w.row.State)
		}
		runs = append(runs, run)
	}
	slices.SortFunc(runs, func(x, y ListedRun) int {
		if x.NeedsYou != y.NeedsYou {
			if x.NeedsYou {
				return -1
			}
			return 1
		}
		if d := strings.Compare(x.Name, y.Name); d != 0 {
			return d
		}
		return strings.Compare(x.Key, y.Key)
	})
	return runs
}

// remoteAgentList reads the roster for the Agents list and its Runs; no roster hook lists none.
func remoteAgentList(ctx context.Context) ([]ListedAgent, []ListedRun, error) {
	if AgentsHook == nil {
		return []ListedAgent{}, []ListedRun{}, nil
	}
	agents, err := AgentsHook(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("read the agents: %w", err)
	}
	handMu.Lock()
	tabs := make(map[string]bool, len(handed))
	for tab := range handed {
		tabs[tab] = true
	}
	handMu.Unlock()
	rows, runs := BuildAgentList(agents, tabs)
	return rows, runs, nil
}

// stateLine is the one-line summary a state carries by itself, "" for a state whose line is the
// transcript's last answer or that has none.
func stateLine(a Agent, state string) string {
	detail := a.Status.Detail
	switch state {
	case PhoneWorking:
		return capitalize(detail)
	case PhonePermission:
		if cmd, ok := strings.CutPrefix(detail, linePermissionCmdPrefix); ok {
			return "Wants to run: " + cmd
		}
		if detail == "" {
			return "Wants approval"
		}
		return "Wants approval: " + detail
	case PhoneAsking:
		// the open ask's first question when the roster carries it, else only that the agent asks
		if a.Ask != "" {
			return a.Ask
		}
		return lineAsking
	}
	return ""
}

// handedLine is a handed-over agent's line: its state line, else (idle, or waiting for input) the first
// sentence of its last reply.
func handedLine(a Agent, state string) string {
	if line := stateLine(a, state); line != "" || state == PhoneWorking {
		return line
	}
	return replyLine(a)
}

// listLine is a listed agent's line: the same as the handed-over row's, except that an agent waiting for
// input shows what its status says when it says anything.
func listLine(a Agent, state string) string {
	if state == PhoneInput {
		if detail := capitalize(strings.TrimSpace(a.Status.Detail)); detail != "" {
			return detail
		}
	}
	return handedLine(a, state)
}

// replyRead reads the last answer of the session at path; a var so a test counts the reads.
var replyRead = agentsessions.LastAnswer

// replyEntry is one transcript's idle line with the size and mod time of the file it was read from.
type replyEntry struct {
	size    int64
	mod     time.Time
	harness string
	line    string
}

// replyCacheMax bounds the cache: past it the cache starts over, which only costs a reread.
const replyCacheMax = 256

var (
	replyMu    sync.Mutex
	replyCache = map[string]replyEntry{}
)

func replyCacheReset() {
	replyMu.Lock()
	defer replyMu.Unlock()
	clear(replyCache)
}

// replyLine is the first sentence of the agent's last reply, "" when it has none. The line is cached by
// transcript path with the file's size and mod time, so the 10 s poll rereads a transcript only when it
// changed.
func replyLine(a Agent) string {
	if a.TranscriptPath == "" {
		return ""
	}
	fi, err := os.Stat(a.TranscriptPath)
	if err != nil {
		replyMu.Lock()
		delete(replyCache, a.TranscriptPath)
		replyMu.Unlock()
		return ""
	}
	replyMu.Lock()
	e, ok := replyCache[a.TranscriptPath]
	replyMu.Unlock()
	if ok && e.size == fi.Size() && e.mod.Equal(fi.ModTime()) && e.harness == a.Harness {
		return e.line
	}
	// read outside the lock: a transcript can be large, and two polls that both miss only read it twice
	answer, _ := replyRead(a.TranscriptPath, a.Harness)
	line := firstSentence(answer)
	replyMu.Lock()
	if len(replyCache) >= replyCacheMax {
		clear(replyCache)
	}
	replyCache[a.TranscriptPath] = replyEntry{size: fi.Size(), mod: fi.ModTime(), harness: a.Harness, line: line}
	replyMu.Unlock()
	return line
}

// firstSentence is the first sentence of the first non-empty line of text, at most replyLineMax characters.
func firstSentence(text string) string {
	for line := range strings.Lines(text) {
		if line = strings.TrimSpace(line); line != "" {
			return capChars(cutSentence(line), replyLineMax)
		}
	}
	return ""
}

// cutSentence ends the line at its first ".", "!" or "?" that is followed by a space or ends the line, so a
// file name (main.go) or a version (v1.2) does not end it, and neither does the number of a list item ("1.").
func cutSentence(line string) string {
	for i, r := range line {
		if r != '.' && r != '!' && r != '?' {
			continue
		}
		rest := line[i+1:]
		if next, _ := utf8.DecodeRuneInString(rest); rest != "" && !unicode.IsSpace(next) {
			continue
		}
		if r == '.' && strings.Trim(line[:i], "0123456789") == "" {
			continue
		}
		return line[:i+1]
	}
	return line
}

// capChars cuts s to at most n characters, the last of a cut one an ellipsis.
func capChars(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimRight(string([]rune(s)[:n-1]), " \t") + "…"
}

func capitalize(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	if n == 0 {
		return s
	}
	return string(unicode.ToUpper(r)) + s[n:]
}

func remoteHanded(ctx context.Context) ([]HandedAgent, error) {
	agents, sinces, err := ListHanded(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]HandedAgent, len(agents))
	for i, a := range agents {
		out[i] = handedAgent(a, sinces[i])
	}
	return out, nil
}

// remoteAct re-reads the agent's state at request time, so a press made stale by the desk is refused
// before anything is typed.
func remoteAct(ctx context.Context, tab string, act AgentAction) error {
	a, _, err := LookupHanded(ctx, tab)
	if err != nil {
		return err
	}
	allowed, ok := actionStates[act.Kind]
	if !ok {
		return fmt.Errorf("unknown action %q", act.Kind)
	}
	if state := PhoneState(a); !slices.Contains(allowed, state) {
		return fmt.Errorf("%w: it is %s", ErrWrongState, state)
	}
	if handAway(tab) {
		return fmt.Errorf("%w: it is not answering Arc right now", ErrWrongState)
	}
	if err := remoteTypeAct(a, act); err != nil {
		return err
	}
	// an acted-on take stays until the owner takes it back (see remoteRelease)
	handMarkActed(tab)
	return nil
}

// remoteTypeAct types what the action is into the agent's terminal.
func remoteTypeAct(a Agent, act AgentAction) error {
	switch act.Kind {
	case ActionSend:
		return typeMessage(a.BlockId, act.Text)
	case ActionStop:
		return typeKeys(a.BlockId, keyEsc)
	case ActionApprove:
		return typeKeys(a.BlockId, keyApprove)
	}
	// deny: Esc picks the menu's "No, and tell Claude what to do differently"
	if err := typeKeys(a.BlockId, keyEsc); err != nil || act.Text == "" {
		return err
	}
	time.Sleep(agentask.KeystrokeDelay)
	return typeMessage(a.BlockId, act.Text)
}

// typeMessage pastes the text bracketed, so a multi-line message stays one message, then submits it.
func typeMessage(blockId, text string) error {
	if err := typeKeys(blockId, keyPasteStart+text+keyPasteEnd); err != nil {
		return err
	}
	time.Sleep(agentask.KeystrokeDelay)
	return typeKeys(blockId, keyEnter)
}

func typeKeys(blockId, keys string) error {
	if err := remoteSendInput(blockId, &blockcontroller.BlockInputUnion{InputData: []byte(keys)}); err != nil {
		return fmt.Errorf("type into the agent's terminal: %w", err)
	}
	return nil
}

func remoteTakeBack(ctx context.Context, tab string) error {
	// TakeBack's own errors are plain; the phone needs the gone reason for a tab already off its list
	if _, _, err := LookupHanded(ctx, tab); err != nil {
		return err
	}
	_, err := TakeBack(ctx, wshrpc.CommandRemoteHandData{Tab: tab})
	return err
}

// streamKey is what a HandedAgent is built from, so the poll re-reads the last answer only when a new
// status report arrived rather than on every tick.
type streamKey struct {
	name, project, state, detail, path string
	since, ts                          int64
}

func streamKeyOf(a Agent, since int64) streamKey {
	return streamKey{a.Name, a.Project, PhoneState(a), a.Status.Detail, a.TranscriptPath, since, a.Status.Ts}
}

// remoteStream sends the agent, then its transcript backlog and appends beside a state poll that sends the
// agent on each change. from is the byte offset a reconnecting page last saw (its Last-Event-ID), or -1 for
// the last 200 lines. It returns a *GoneError when the agent stops being handed over, and nil when ctx
// ends; it never returns while the tail is still running.
func remoteStream(ctx context.Context, tab string, from int64, sink StreamSink) error {
	a, since, err := LookupHanded(ctx, tab)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if err := sink.Agent(handedAgent(a, since)); err != nil {
		return err
	}
	key := streamKeyOf(a, since)
	tailDone := make(chan error, 1)
	tailing := false
	defer func() {
		if tailing {
			cancel()
			<-tailDone
		}
	}()
	poll := time.NewTicker(remoteStreamPoll)
	defer poll.Stop()
	for {
		// a path that appears after the hand-over (a session not yet written) starts the tail then
		if !tailing && a.TranscriptPath != "" && TranscriptHook != nil {
			tailing = true
			path := a.TranscriptPath
			go func() { tailDone <- TranscriptHook(ctx, path, from, sink.Lines) }()
		}
		select {
		case <-ctx.Done():
			return nil
		case err := <-tailDone:
			tailing = false
			if err == nil || ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("tail the transcript of tab %s: %w", tab, err)
		case <-poll.C:
			next, nextSince, err := LookupHanded(ctx, tab)
			var gone *GoneError
			if errors.As(err, &gone) {
				return err
			}
			if ctx.Err() != nil {
				return nil
			}
			if err != nil {
				log.Printf("remote mode: stream of tab %s: %v\n", tab, err)
				continue
			}
			a = next
			if k := streamKeyOf(a, nextSince); k != key {
				key = k
				if err := sink.Agent(handedAgent(a, nextSince)); err != nil {
					return err
				}
			}
		}
	}
}
