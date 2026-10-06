// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type inputRecorder struct {
	mu   sync.Mutex
	got  []string
	want int
	done chan struct{}
}

func (r *inputRecorder) WshServerImpl() {}

func (r *inputRecorder) ControllerInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.got = append(r.got, data.InputData64)
	if len(r.got) == r.want {
		close(r.done)
	}
	return nil
}

// A Vietnamese input method rewrites a syllable by sending DEL and then the composed letter, as two
// requests well under a millisecond apart. Handled out of order, the DEL lands second and erases the
// letter it was meant to make room for, so terminal input must reach the block in arrival order.
func TestControllerInputKeepsArrivalOrder(t *testing.T) {
	const n = 2000
	rec := &inputRecorder{want: n, done: make(chan struct{})}
	w := MakeWshRpc(wshrpc.RpcContext{}, rec, "order-test")
	go func() {
		for range w.OutputCh {
		}
	}()
	for i := 0; i < n; i++ {
		msgBytes, err := json.Marshal(RpcMessage{
			Command: wshrpc.Command_ControllerInput,
			ReqId:   "req-" + strconv.Itoa(i),
			Data:    wshrpc.CommandBlockInputData{BlockId: "block", InputData64: strconv.Itoa(i)},
		})
		if err != nil {
			t.Fatal(err)
		}
		w.InputCh <- baseds.RpcInputChType{MsgBytes: msgBytes}
	}
	select {
	case <-rec.done:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for every input to be handled")
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for i, s := range rec.got {
		if s != strconv.Itoa(i) {
			t.Fatalf("input %s was handled at position %d", s, i)
		}
	}
}
