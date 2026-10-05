// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentctl"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestAgentControlStreamsWhatIsSentUntilTheCallerLeaves(t *testing.T) {
	const blockId = "5f2b1c0e-8a41-4a6b-9d3e-0c7f6a1b2d34"
	ctx, cancel := context.WithCancel(context.Background())
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	ch := (&WshServer{}).AgentControlCommand(ctx, wshrpc.CommandAgentControlData{ORef: oref})
	if !agentctl.Send(blockId, "wake: task 1 done") {
		t.Fatalf("the open stream did not take the text")
	}
	select {
	case msg := <-ch:
		if msg.Error != nil || msg.Response.Text != "wake: task 1 done" {
			t.Fatalf("got %+v", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("nothing streamed")
	}
	cancel()
	select {
	case _, open := <-ch:
		if open {
			t.Fatalf("a message after the caller left")
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("the stream stayed open after the caller left")
	}
	if agentctl.Has(blockId) {
		t.Fatalf("the block still has a stream after the caller left")
	}
}

func TestAgentControlRefusesAnORefThatIsNoBlock(t *testing.T) {
	ch := (&WshServer{}).AgentControlCommand(context.Background(), wshrpc.CommandAgentControlData{ORef: "tab:abc"})
	if msg := <-ch; msg.Error == nil {
		t.Fatalf("a tab oref opened a stream")
	}
}
