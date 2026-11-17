// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
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

// StreamSink receives a stream's events; it must be safe for concurrent use, since the transcript tail
// and the state poll send from their own goroutines.
type StreamSink interface {
	Agent(HandedAgent) error
	Lines([]string) error
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

func handedLine(a Agent, state string) string {
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
		return lineAsking
	}
	if a.TranscriptPath == "" {
		return ""
	}
	answer, _ := agentsessions.LastAnswer(a.TranscriptPath, a.Harness)
	for line := range strings.Lines(answer) {
		if line = strings.TrimSpace(line); line != "" {
			return line
		}
	}
	return ""
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
// agent on each change. It returns a *GoneError when the agent stops being handed over, and nil when ctx
// ends; it never returns while the tail is still running.
func remoteStream(ctx context.Context, tab string, sink StreamSink) error {
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
			go func() { tailDone <- TranscriptHook(ctx, path, 0, sink.Lines) }()
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
