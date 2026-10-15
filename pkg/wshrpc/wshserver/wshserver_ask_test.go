// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type askResolveClient struct {
	onEvent func(wps.WaveEvent)
}

func (c *askResolveClient) SendEvent(_ string, event wps.WaveEvent) {
	c.onEvent(event)
}

func askData(oref string, wait bool) wshrpc.CommandAskData {
	return wshrpc.CommandAskData{
		ORef: oref,
		Questions: []baseds.AgentAskQuestion{{
			Question: "A or B?",
			Options:  []baseds.AgentAskOption{{Label: "A"}, {Label: "B"}},
		}},
		Wait: wait,
	}
}

func TestAskCommandRegistersWaiterBeforePublishing(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef(waveobj.OType_Block, uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	originalClient := wps.Broker.GetClient()
	wps.Broker.SetClient(&askResolveClient{onEvent: func(event wps.WaveEvent) {
		data, ok := event.Data.(baseds.AgentAskData)
		if !ok || data.Cleared {
			return
		}
		pending, ok := agentask.GlobalRegistry.Claim(data.ORef, data.AskId)
		if ok {
			agentask.GlobalRegistry.ResolveWaiter(pending.AskId, agentask.WaitResult{Cancelled: true})
		}
	}})
	wps.Broker.Subscribe("ask-wait-order", wps.SubscriptionRequest{Event: wps.Event_AgentAsk, Scopes: []string{oref}})
	t.Cleanup(func() {
		wps.Broker.UnsubscribeAll("ask-wait-order")
		wps.Broker.SetClient(originalClient)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	rtn, err := ws.AskCommand(ctx, askData(oref, true))
	if err != nil {
		t.Fatalf("ask must resolve during publish: %v", err)
	}
	if !rtn.Cancelled {
		t.Fatalf("publish-time clear must cancel the waiter: %#v", rtn)
	}
}

func TestAskCommandWaitResolvesViaAnswer(t *testing.T) {
	ws := &WshServer{}
	// ParseORef requires a UUID oid, so fixtures use real UUIDs, not "w1".
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	rtnCh := make(chan wshrpc.AskRtnData, 1)
	errCh := make(chan error, 1)
	go func() {
		rtn, err := ws.AskCommand(context.Background(), askData(oref, true))
		rtnCh <- rtn
		if err != nil {
			errCh <- err
		}
	}()
	// wait until the pending ask is registered, then answer it
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, ok := agentask.GlobalRegistry.Get(oref); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("pending ask never registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := ws.AnswerAgentCommand(context.Background(), wshrpc.CommandAnswerAgentData{
		ORef:    oref,
		Answers: []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}},
	}); err != nil {
		t.Fatalf("answer: %v", err)
	}
	select {
	case rtn := <-rtnCh:
		if rtn.Cancelled || len(rtn.Answers) != 1 || rtn.Answers[0].SelectedIndexes[0] != 1 {
			t.Fatalf("bad wait result: %#v", rtn)
		}
	case err := <-errCh:
		t.Fatalf("ask wait errored: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("wait RPC never returned")
	}
	if _, ok := agentask.GlobalRegistry.Get(oref); ok {
		t.Fatal("pending ask must be claimed after delivery")
	}
}

func TestAnswerAgentCommandPublishesClearedEvent(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{
		AskId:     "ask-answer-clear",
		BlockId:   uuid.NewString(),
		Questions: askData(oref, false).Questions,
	})
	agentask.GlobalRegistry.RegisterWaiter("ask-answer-clear")
	originalAnswerHook := agentask.AnswerHook
	agentask.AnswerHook = RecordAskAnswered
	t.Cleanup(func() { agentask.AnswerHook = originalAnswerHook })

	if err := ws.AnswerAgentCommand(context.Background(), wshrpc.CommandAnswerAgentData{
		ORef:    oref,
		Answers: []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}},
	}); err != nil {
		t.Fatalf("answer: %v", err)
	}

	events := wps.Broker.ReadEventHistory(wps.Event_AgentAsk, oref, 1)
	if len(events) != 1 {
		t.Fatalf("successful answer must publish one clear event, got %d", len(events))
	}
	got, ok := events[0].Data.(baseds.AgentAskData)
	if !ok || !got.Cleared || got.ORef != oref || got.AskId != "ask-answer-clear" {
		t.Fatalf("clear event = %#v", events[0].Data)
	}
}

func TestAskCommandWaitCancelCleansUp(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := ws.AskCommand(ctx, askData(oref, true))
		done <- err
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, ok := agentask.GlobalRegistry.Get(oref); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("pending ask never registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancel must return an error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("wait RPC never returned after cancel")
	}
	if _, ok := agentask.GlobalRegistry.Get(oref); ok {
		t.Fatal("cancel must drop the pending ask")
	}
}

// the mod's waiter ending (wsh killed once claude's dialog answered) takes down only its own ask: a projection of
// other questions that replaced it is still the one on screen, and still the one a clear or an answer must find
func TestAskCommandWaitCancelKeepsANewerAsk(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_, _ = ws.AskCommand(ctx, askData(oref, true))
		close(done)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if p, ok := agentask.GlobalRegistry.Get(oref); ok && agentask.GlobalRegistry.HasWaiter(p.AskId) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("waited ask never registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	other := askData(oref, false)
	other.Questions[0].Question = "C or D?"
	newer, err := ws.AskCommand(context.Background(), other)
	if err != nil {
		t.Fatalf("projection: %v", err)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("wait RPC never returned after cancel")
	}
	if p, ok := agentask.GlobalRegistry.Get(oref); !ok || p.AskId != newer.AskId {
		t.Fatalf("the waiter's end must leave the newer ask %s pending, got %#v (pending=%v)", newer.AskId, p, ok)
	}
}

func TestAskCommandClearCancelsWaiter(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	rtnCh := make(chan wshrpc.AskRtnData, 1)
	go func() {
		rtn, _ := ws.AskCommand(context.Background(), askData(oref, true))
		rtnCh <- rtn
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, ok := agentask.GlobalRegistry.Get(oref); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("pending ask never registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := ws.AgentAskClearCommand(context.Background(), oref); err != nil {
		t.Fatalf("clear: %v", err)
	}
	select {
	case rtn := <-rtnCh:
		if !rtn.Cancelled || len(rtn.Answers) != 0 {
			t.Fatalf("clear must resolve the waiter cancelled: %#v", rtn)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("wait RPC never returned after clear")
	}
}

// the arc mod's card waits on a Claude AskUserQuestion; the settings hook's projection of the same call
// must not replace it (an org-managed Claude skips the mod hook that would have stopped the projection)
func TestAskCommandProjectionKeepsAWaitedAsk(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	rtnCh := make(chan wshrpc.AskRtnData, 1)
	go func() {
		rtn, _ := ws.AskCommand(context.Background(), askData(oref, true))
		rtnCh <- rtn
	}()
	deadline := time.Now().Add(2 * time.Second)
	var waited agentask.PendingAsk
	for {
		if p, ok := agentask.GlobalRegistry.Get(oref); ok {
			waited = p
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("pending ask never registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	rtn, err := ws.AskCommand(context.Background(), askData(oref, false))
	if err != nil {
		t.Fatalf("projection: %v", err)
	}
	if rtn.AskId != waited.AskId {
		t.Fatalf("projection must answer the waited ask's id %q, got %q", waited.AskId, rtn.AskId)
	}
	if p, _ := agentask.GlobalRegistry.Get(oref); p.AskId != waited.AskId {
		t.Fatalf("projection replaced the waited ask: %q", p.AskId)
	}
	if err := ws.AgentAskClearCommand(context.Background(), oref); err != nil {
		t.Fatalf("clear: %v", err)
	}
	select {
	case got := <-rtnCh:
		if !got.Cancelled {
			t.Fatalf("the waiter must still be the one a clear resolves: %#v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the waiter was orphaned")
	}
}

// a projection of other questions, or one with no waiter beneath, still replaces as before
func TestAskCommandProjectionReplacesOtherwise(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	first, err := ws.AskCommand(context.Background(), askData(oref, false))
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := ws.AskCommand(context.Background(), askData(oref, false))
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if second.AskId == first.AskId {
		t.Fatal("with no waiter beneath, a projection replaces the pending ask")
	}
	waitCtx, stopWait := context.WithCancel(context.Background())
	waitDone := make(chan struct{})
	go func() {
		_, _ = ws.AskCommand(waitCtx, askData(oref, true))
		close(waitDone)
	}()
	t.Cleanup(func() {
		stopWait()
		<-waitDone
	})
	deadline := time.Now().Add(2 * time.Second)
	for {
		if p, ok := agentask.GlobalRegistry.Get(oref); ok && agentask.GlobalRegistry.HasWaiter(p.AskId) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("waited ask never registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	other := askData(oref, false)
	other.Questions[0].Question = "C or D?"
	third, err := ws.AskCommand(context.Background(), other)
	if err != nil {
		t.Fatalf("third: %v", err)
	}
	if p, _ := agentask.GlobalRegistry.Get(oref); p.AskId != third.AskId {
		t.Fatal("a projection of other questions replaces the waited ask")
	}
}

func TestAskCommandThreadsProse(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	data := askData(oref, false)
	data.Prose = true
	if _, err := ws.AskCommand(context.Background(), data); err != nil {
		t.Fatalf("ask: %v", err)
	}
	pending, ok := agentask.GlobalRegistry.Get(oref)
	if !ok || !pending.Prose {
		t.Fatalf("want prose pending ask, got %+v (ok=%v)", pending, ok)
	}
}

// statusEvent builds an agent:status event the way it arrives over the RPC wire: Data is a raw JSON
// map, not a typed struct, so the retire path has to decode rather than type-assert.
func statusEvent(oref, state string, ts int64) *wps.WaveEvent {
	return &wps.WaveEvent{
		Event:  wps.Event_AgentStatus,
		Scopes: []string{oref},
		Data:   map[string]any{"oref": oref, "state": state, "ts": float64(ts)},
	}
}

func setPendingAsk(t *testing.T, oref, askId string, ts int64) {
	t.Helper()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{
		AskId:     askId,
		BlockId:   uuid.NewString(),
		Questions: askData(oref, false).Questions,
		Ts:        ts,
	})
}

func TestRetireAskOnResumeRetiresAfterWorking(t *testing.T) {
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	askTs := time.Now().UnixMilli()
	setPendingAsk(t, oref, "ask-resumed", askTs)
	waiter := agentask.GlobalRegistry.RegisterWaiter("ask-resumed")

	retireAskOnResume(statusEvent(oref, baseds.AgentState_Working, askTs+askResumeGraceMs+1))

	if _, ok := agentask.GlobalRegistry.Get(oref); ok {
		t.Fatal("a resumed agent's ask must be claimed out of the registry")
	}
	select {
	case res := <-waiter:
		if !res.Cancelled {
			t.Fatalf("waiter must be cancelled, got %#v", res)
		}
	default:
		t.Fatal("blocked --wait caller was left hanging")
	}
	events := wps.Broker.ReadEventHistory(wps.Event_AgentAsk, oref, 1)
	if len(events) != 1 {
		t.Fatalf("want one cleared event, got %d", len(events))
	}
	got, ok := events[0].Data.(baseds.AgentAskData)
	if !ok || !got.Cleared || got.AskId != "ask-resumed" {
		t.Fatalf("clear event = %#v", events[0].Data)
	}
}

func TestRetireAskOnResumeKeepsAsk(t *testing.T) {
	askTs := time.Now().UnixMilli()
	cases := []struct {
		name  string
		state string
		ts    int64
	}{
		// a reporter's own working event can land beside the ask that follows it
		{"working inside the grace window", baseds.AgentState_Working, askTs + askResumeGraceMs},
		// a prose ask is raised at settle, so idle is its normal state, not proof of resuming
		{"idle after the ask", baseds.AgentState_Idle, askTs + 60_000},
		{"waiting after the ask", baseds.AgentState_Waiting, askTs + 60_000},
		{"asking after the ask", baseds.AgentState_Asking, askTs + 60_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			oref := waveobj.MakeORef("block", uuid.NewString()).String()
			setPendingAsk(t, oref, "ask-live", askTs)
			retireAskOnResume(statusEvent(oref, tc.state, tc.ts))
			if _, ok := agentask.GlobalRegistry.Get(oref); !ok {
				t.Fatal("ask must stay pending")
			}
		})
	}
}

// a held command's card (`wsh memgate`) is raised from inside the tool call it holds, so the agent's
// working reports (a parallel tool call, a subagent) are no proof it moved on
func TestRetireAskOnResumeKeepsAHeldCommandsAsk(t *testing.T) {
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	askTs := time.Now().UnixMilli()
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: "ask-held", Ts: askTs, Hold: true})
	t.Cleanup(func() { agentask.GlobalRegistry.Drop(oref) })

	retireAskOnResume(statusEvent(oref, baseds.AgentState_Working, askTs+60_000))

	if _, ok := agentask.GlobalRegistry.Get(oref); !ok {
		t.Fatal("a held command's ask must stay pending while its agent works")
	}
}

func TestAskCommandKeepsHoldOnThePendingAsk(t *testing.T) {
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	t.Cleanup(func() { agentask.GlobalRegistry.Drop(oref) })
	_, err := (&WshServer{}).AskCommand(context.Background(), wshrpc.CommandAskData{
		ORef:      oref,
		Questions: []baseds.AgentAskQuestion{{Question: "Run it?", Options: []baseds.AgentAskOption{{Label: "Run now"}}}},
		Hold:      true,
	})
	if err != nil {
		t.Fatal(err)
	}
	pending, ok := agentask.GlobalRegistry.Get(oref)
	if !ok || !pending.Hold {
		t.Fatalf("pending ask = %#v, %v; want it marked held", pending, ok)
	}
}

func TestRetireAskOnResumeIgnoresOtherEvents(t *testing.T) {
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	askTs := time.Now().UnixMilli()
	setPendingAsk(t, oref, "ask-live", askTs)
	ev := statusEvent(oref, baseds.AgentState_Working, askTs+60_000)
	ev.Event = wps.Event_BlockClose
	retireAskOnResume(ev)
	retireAskOnResume(nil)
	if _, ok := agentask.GlobalRegistry.Get(oref); !ok {
		t.Fatal("only agent:status events may retire an ask")
	}
}

// the tail of run 24de67e0's t-3 worker: one assistant turn that asks and reads at once. The read gets its
// result while the question dialog stays open.
const (
	recAskUse        = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"ask1","name":"AskUserQuestion"}]}}`
	recSiblingRead   = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"read1","name":"Read"}]}}`
	recSiblingResult = `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"read1"}]}}`
	recAskRejected   = `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"ask1","is_error":true}]}}`
)

func writeAskTranscript(t *testing.T, records ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(records, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("writing transcript: %v", err)
	}
	return path
}

func workingWithTranscript(oref string, ts int64, transcript string) *wps.WaveEvent {
	ev := statusEvent(oref, baseds.AgentState_Working, ts)
	ev.Data.(map[string]any)["transcriptpath"] = transcript
	return ev
}

func TestRetireAskOnResumeKeepsAskWhileSiblingToolsRun(t *testing.T) {
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	askTs := time.Now().UnixMilli()
	setPendingAsk(t, oref, "ask-open", askTs)
	transcript := writeAskTranscript(t, recAskUse, recSiblingRead, recSiblingResult)

	retireAskOnResume(workingWithTranscript(oref, askTs+askResumeGraceMs+1, transcript))

	if _, ok := agentask.GlobalRegistry.Get(oref); !ok {
		t.Fatal("a tool running beside the question must not retire it: its dialog is still open")
	}
}

func TestRetireAskOnResumeRetiresAskTheTranscriptClosed(t *testing.T) {
	oref := waveobj.MakeORef("block", uuid.NewString()).String()
	askTs := time.Now().UnixMilli()
	setPendingAsk(t, oref, "ask-rejected", askTs)
	transcript := writeAskTranscript(t, recAskUse, recAskRejected, recSiblingRead)

	retireAskOnResume(workingWithTranscript(oref, askTs+askResumeGraceMs+1, transcript))

	if _, ok := agentask.GlobalRegistry.Get(oref); ok {
		t.Fatal("an ask rejected in the terminal must still retire on the next working status")
	}
}

// a Team org's Claude raises the mod's waited card and the settings hook's projection at once. Whatever order they
// reach the registry in, the cockpit must end on the ask the registry holds: a clear names only that one, so an ask
// left on screen past it reads as asking at every idle until a reload
func TestAskCommandRaisesPublishInRegistryOrder(t *testing.T) {
	ws := &WshServer{}
	oref := waveobj.MakeORef(waveobj.OType_Block, uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	waitCtx, stopWait := context.WithCancel(context.Background())
	waitDone := make(chan struct{})
	var mu sync.Mutex
	var raised []string
	waitPublished := make(chan struct{})
	started := false
	originalClient := wps.Broker.GetClient()
	wps.Broker.SetClient(&askResolveClient{onEvent: func(event wps.WaveEvent) {
		data, ok := event.Data.(baseds.AgentAskData)
		if !ok || data.Cleared {
			return
		}
		mu.Lock()
		first := !started
		started = true
		mu.Unlock()
		if first {
			// the projection is in the registry but not yet sent: the waited ask arrives now, and gets its chance
			// to be sent first
			go func() {
				_, _ = ws.AskCommand(waitCtx, askData(oref, true))
				close(waitDone)
			}()
			select {
			case <-waitPublished:
			case <-time.After(300 * time.Millisecond):
			}
		}
		mu.Lock()
		raised = append(raised, data.AskId)
		mu.Unlock()
		if !first {
			close(waitPublished)
		}
	}})
	wps.Broker.Subscribe("ask-raise-order", wps.SubscriptionRequest{Event: wps.Event_AgentAsk, Scopes: []string{oref}})
	t.Cleanup(func() {
		stopWait()
		<-waitDone
		wps.Broker.UnsubscribeAll("ask-raise-order")
		wps.Broker.SetClient(originalClient)
	})

	projection := askData(oref, false)
	projection.Questions[0].Question = "A or B? (projected)"
	if _, err := ws.AskCommand(context.Background(), projection); err != nil {
		t.Fatalf("projection: %v", err)
	}
	select {
	case <-waitPublished:
	case <-time.After(2 * time.Second):
		t.Fatal("the waited ask was never published")
	}
	pending, ok := agentask.GlobalRegistry.Get(oref)
	if !ok {
		t.Fatal("no ask pending")
	}
	mu.Lock()
	last := raised[len(raised)-1]
	mu.Unlock()
	if last != pending.AskId {
		t.Fatalf("the cockpit was last told of ask %s while the registry holds %s", last, pending.AskId)
	}
}
