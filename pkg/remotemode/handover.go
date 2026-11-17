// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"fmt"
	"log"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Agent is one roster agent as the phone sees it. Status is the hook's raw status, since the roster's
// own state folds waiting into idle.
type Agent struct {
	TabId, BlockId, Name, Project, Harness, TranscriptPath string
	Status                                                 baseds.AgentStatusData
	OpenAsk                                                bool
	HasStream                                              bool // the arc mod's control stream is open (claude's liveness)
	RunWorker                                              bool
}

// AgentsHook and TranscriptHook are set by wshserver, which owns the roster and the transcript tailer and
// imports this package. A nil AgentsHook means no agents, so Hand refuses.
var (
	AgentsHook     func(ctx context.Context) ([]Agent, error)
	TranscriptHook func(ctx context.Context, path string, tailLines int, send func(lines []string) error) error
)

// why a tab is no longer handed over
const (
	EndTaken  = "taken"
	EndExited = "exited"
	EndOff    = "off"
)

// the phone's states (decision 6 of the plan): the hook's waiting split into a permission prompt and
// any other input
const (
	PhoneWorking    = "working"
	PhoneIdle       = "idle"
	PhonePermission = "permission"
	PhoneInput      = "input"
	PhoneAsking     = "asking"
)

const (
	harnessClaude = "claude"
	harnessPi     = "pi"

	// Claude Code's notification_type for a tool permission menu
	notificationPermissionPrompt = "permission_prompt"

	// bounds the roster read behind Status, which has no caller context
	handStatusTimeout = 5 * time.Second
)

// handAwayGraceMs is how long a handed-over tab may fail the roster or eligibility check before its
// hand-over ends as exited. A live claude session was once dropped on a single failed check and was
// eligible again moments later. A var so tests can end a hand-over at once.
var handAwayGraceMs int64 = 15_000

// GoneError is a tab that is not handed over, with why.
type GoneError struct{ Reason string }

func (e *GoneError) Error() string {
	return fmt.Sprintf("agent is not handed over (%s)", e.Reason)
}

// handover is one handed-over tab: its phone state, when the listener first saw it in that state, the
// agent as last seen eligible, and since when it has failed the check (0 while it passes).
type handover struct {
	state     string
	since     int64
	agent     Agent
	awaySince int64
}

var (
	// handMu guards the hand-overs and the ended reasons, and is never held across a hook call
	handMu    sync.Mutex
	handed    = map[string]*handover{}
	handEnded = map[string]string{}

	handNow = func() int64 { return time.Now().UnixMilli() }
)

// Eligible is the one rule for what can be handed to the phone: a live claude or pi session in a
// terminal block that no run started.
func Eligible(a Agent) error {
	if a.RunWorker {
		return fmt.Errorf("%s is a run worker: only a plain agent or a run's lead can be handed to the phone", a.label())
	}
	if a.BlockId == "" {
		return fmt.Errorf("%s has no terminal block to type into", a.label())
	}
	switch a.Harness {
	case harnessClaude:
		if !a.HasStream {
			return fmt.Errorf("%s has exited to its shell: claude is no longer running there", a.label())
		}
	case harnessPi:
		if a.Status.Ended {
			return fmt.Errorf("%s has exited to its shell: pi is no longer running there", a.label())
		}
	default:
		return fmt.Errorf("%s runs %q: only claude and pi agents can be handed to the phone", a.label(), a.Harness)
	}
	return nil
}

func (a Agent) label() string {
	if a.Name != "" {
		return fmt.Sprintf("%q (tab %s)", a.Name, a.TabId)
	}
	return "tab " + a.TabId
}

func PhoneState(a Agent) string {
	if a.OpenAsk || a.Status.State == baseds.AgentState_Asking {
		return PhoneAsking
	}
	switch a.Status.State {
	case baseds.AgentState_Waiting:
		if a.Status.Hook == baseds.AgentHook_Notification && a.Status.NotificationType == notificationPermissionPrompt {
			return PhonePermission
		}
		return PhoneInput
	case baseds.AgentState_Working:
		return PhoneWorking
	default:
		return PhoneIdle
	}
}

// Hand turns remote mode on and hands the agent over, but only once the agent is eligible, so a refused
// hand-over starts nothing; when turning on fails nothing is handed.
func Hand(ctx context.Context, data wshrpc.CommandRemoteHandData) (*wshrpc.RemoteStatusData, error) {
	agents, err := handAgents(ctx)
	if err != nil {
		return nil, err
	}
	a, err := handResolve(agents, data)
	if err != nil {
		return nil, err
	}
	if err := Eligible(a); err != nil {
		return nil, err
	}
	remoteMu.Lock()
	err = remoteStartLocked()
	if err == nil {
		handAdd(a)
	}
	publishStatus()
	remoteMu.Unlock()
	if err != nil {
		return nil, err
	}
	return Status(), nil
}

// TakeBack returns a handed-over agent to the desk; remote mode stays on.
func TakeBack(ctx context.Context, data wshrpc.CommandRemoteHandData) (*wshrpc.RemoteStatusData, error) {
	agents, err := handAgents(ctx)
	if err != nil {
		return nil, err
	}
	a, err := handResolve(agents, data)
	if err != nil {
		return nil, err
	}
	handMu.Lock()
	_, ok := handed[a.TabId]
	if ok {
		delete(handed, a.TabId)
		handEnded[a.TabId] = EndTaken
	}
	handMu.Unlock()
	if !ok {
		return nil, fmt.Errorf("%s is not handed to the phone", a.label())
	}
	publishStatus()
	return Status(), nil
}

// LookupHanded gives a handed-over, still-eligible agent and when it entered its phone state, or a
// *GoneError saying why it is not handed over.
func LookupHanded(ctx context.Context, tab string) (Agent, int64, error) {
	live, err := handPruneAndPublish(ctx)
	if err != nil {
		return Agent{}, 0, err
	}
	for _, h := range live {
		if h.agent.TabId == tab {
			return h.agent, h.since, nil
		}
	}
	handMu.Lock()
	reason := handEnded[tab]
	handMu.Unlock()
	if reason == "" {
		// never handed over in this remote session reads as back at the desk
		reason = EndTaken
	}
	return Agent{}, 0, &GoneError{Reason: reason}
}

// ListHanded gives every handed-over, still-eligible agent with its since, sorted by tab id.
func ListHanded(ctx context.Context) ([]Agent, []int64, error) {
	live, err := handPruneAndPublish(ctx)
	if err != nil {
		return nil, nil, err
	}
	agents := make([]Agent, len(live))
	sinces := make([]int64, len(live))
	for i, h := range live {
		agents[i], sinces[i] = h.agent, h.since
	}
	return agents, sinces, nil
}

type handLive struct {
	agent Agent
	since int64
}

func handPruneAndPublish(ctx context.Context) ([]handLive, error) {
	live, dropped, err := handPrune(ctx)
	if dropped {
		publishStatus()
	}
	return live, err
}

// handPrune drops every hand-over whose agent has failed the eligibility check for longer than
// handAwayGraceMs, with reason exited, and moves each live one's since when its phone state changed. One
// still in its grace stays listed as last seen. It returns the live ones sorted by tab id.
func handPrune(ctx context.Context) (live []handLive, dropped bool, err error) {
	handMu.Lock()
	empty := len(handed) == 0
	handMu.Unlock()
	if empty {
		return nil, false, nil
	}
	agents, err := handAgents(ctx)
	if err != nil {
		return nil, false, err
	}
	byTab := make(map[string]Agent, len(agents))
	for _, a := range agents {
		byTab[a.TabId] = a
	}
	now := handNow()
	handMu.Lock()
	defer handMu.Unlock()
	for tab, h := range handed {
		a, ok := byTab[tab]
		if why := handAwayReason(a, ok); why != "" {
			if h.awaySince == 0 {
				h.awaySince = now
				log.Printf("remote mode: hand-over of tab %s: %s; it ends unless the agent is back within %dms\n", tab, why, handAwayGraceMs)
			}
			if now-h.awaySince < handAwayGraceMs {
				live = append(live, handLive{agent: h.agent, since: h.since})
				continue
			}
			log.Printf("remote mode: hand-over of tab %s ended: %s\n", tab, why)
			delete(handed, tab)
			handEnded[tab] = EndExited
			dropped = true
			continue
		}
		if h.awaySince != 0 {
			log.Printf("remote mode: hand-over of tab %s: the agent is back after %dms\n", tab, now-h.awaySince)
			h.awaySince = 0
		}
		h.agent = a
		if state := PhoneState(a); state != h.state {
			h.state, h.since = state, now
		}
		live = append(live, handLive{agent: a, since: h.since})
	}
	slices.SortFunc(live, func(x, y handLive) int { return strings.Compare(x.agent.TabId, y.agent.TabId) })
	return live, dropped, nil
}

// handAwayReason says why a handed-over tab fails the check, "" when it passes.
func handAwayReason(a Agent, inRoster bool) string {
	if !inRoster {
		return "its tab left the agent roster"
	}
	if err := Eligible(a); err != nil {
		return err.Error()
	}
	return ""
}

// handAway reports whether a handed-over tab is failing the check and in its grace, so nothing is typed
// into a terminal whose agent may have exited to its shell.
func handAway(tab string) bool {
	handMu.Lock()
	defer handMu.Unlock()
	h := handed[tab]
	return h != nil && h.awaySince != 0
}

// handStatusTabs is Status's view of the hand-overs: pruned silently, since Status runs inside
// publishStatus. When the roster cannot be read, the set stands as it is.
func handStatusTabs() []string {
	ctx, cancel := context.WithTimeout(context.Background(), handStatusTimeout)
	defer cancel()
	live, _, err := handPrune(ctx)
	if err != nil {
		handMu.Lock()
		defer handMu.Unlock()
		return slices.Sorted(maps.Keys(handed))
	}
	var tabs []string
	for _, h := range live {
		tabs = append(tabs, h.agent.TabId)
	}
	return tabs
}

// handAdd seeds since from the status time at this first look; handing over again keeps it.
func handAdd(a Agent) {
	handMu.Lock()
	defer handMu.Unlock()
	delete(handEnded, a.TabId)
	if _, ok := handed[a.TabId]; ok {
		return
	}
	handed[a.TabId] = &handover{state: PhoneState(a), since: a.Status.Ts, agent: a}
}

// handClearOff ends every hand-over with reason off; reasons from before are dropped with them.
func handClearOff() {
	handMu.Lock()
	defer handMu.Unlock()
	handEnded = make(map[string]string, len(handed))
	for tab := range handed {
		handEnded[tab] = EndOff
	}
	handed = map[string]*handover{}
}

// handReset forgets every hand-over and reason; tests only.
func handReset() {
	handMu.Lock()
	defer handMu.Unlock()
	handed = map[string]*handover{}
	handEnded = map[string]string{}
}

func handAgents(ctx context.Context) ([]Agent, error) {
	if AgentsHook == nil {
		return nil, nil
	}
	agents, err := AgentsHook(ctx)
	if err != nil {
		return nil, fmt.Errorf("read the agent roster: %w", err)
	}
	return agents, nil
}

// handResolve finds a tab by id or unique prefix; a prefix several tabs share narrows to the eligible
// ones. An empty tab means the agent whose block FromORef names.
func handResolve(agents []Agent, data wshrpc.CommandRemoteHandData) (Agent, error) {
	if tab := strings.TrimSpace(data.Tab); tab != "" {
		return handResolvePrefix(agents, tab)
	}
	if data.FromORef == "" {
		return Agent{}, errors.New("name an agent's tab: there is no calling terminal to hand over")
	}
	o, err := waveobj.ParseORef(data.FromORef)
	if err != nil || o.OType != waveobj.OType_Block {
		return Agent{}, fmt.Errorf("the calling terminal %q is not a block", data.FromORef)
	}
	for _, a := range agents {
		if a.BlockId == o.OID {
			return a, nil
		}
	}
	return Agent{}, errors.New("no agent runs in this terminal: name an agent's tab")
}

func handResolvePrefix(agents []Agent, tab string) (Agent, error) {
	var matches []Agent
	for _, a := range agents {
		if a.TabId == tab {
			return a, nil
		}
		if strings.HasPrefix(a.TabId, tab) {
			matches = append(matches, a)
		}
	}
	if len(matches) > 1 {
		if eligible := slices.DeleteFunc(slices.Clone(matches), func(a Agent) bool { return Eligible(a) != nil }); len(eligible) > 0 {
			matches = eligible
		}
	}
	switch len(matches) {
	case 0:
		return Agent{}, fmt.Errorf("no agent tab matches %q", tab)
	case 1:
		return matches[0], nil
	}
	ids := make([]string, len(matches))
	for i, a := range matches {
		ids[i] = a.TabId
	}
	return Agent{}, fmt.Errorf("tab %q is ambiguous, it matches %s", tab, strings.Join(ids, ", "))
}
