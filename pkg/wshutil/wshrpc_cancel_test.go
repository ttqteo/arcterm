// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"math"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func mkHandler(w *WshRpc, reqId string, link baseds.LinkId) (*RpcResponseHandler, context.Context) {
	ctx, cancel := context.WithCancel(context.Background())
	h := &RpcResponseHandler{
		w:               w,
		ctx:             ctx,
		reqId:           reqId,
		ingressLinkId:   link,
		done:            &atomic.Bool{},
		canceled:        &atomic.Bool{},
		contextCancelFn: &atomic.Pointer[context.CancelFunc]{},
	}
	cf := context.CancelFunc(cancel)
	h.contextCancelFn.Store(&cf)
	return h, ctx
}

// A client-issued cancel (msg.Cancel -> cancelRequest) must cancel the handler's context, not just
// flip the canceled bool — that is what lets a streaming handler's goroutine + fsnotify watcher unwind
// while the websocket is still up (the per-card-unmount leak). Mirrors the ctx-cancel guarantee that
// CancelRequestsForLink gives on link teardown.
func TestCancelRequestCancelsContext(t *testing.T) {
	w := &WshRpc{Lock: &sync.Mutex{}, ResponseHandlerMap: map[string]*RpcResponseHandler{}}
	h, ctx := mkHandler(w, "r1", baseds.LinkId(1))
	w.ResponseHandlerMap["r1"] = h

	w.cancelRequest("r1")

	select {
	case <-ctx.Done():
	default:
		t.Fatal("expected cancelRequest to cancel the handler ctx")
	}
	if !h.canceled.Load() {
		t.Fatal("expected canceled flag to be set")
	}
	if !h.done.Load() {
		t.Fatal("expected handler done after cancel")
	}
}

// cancelRequest must be a no-op (never panic) for an empty or unknown reqId.
func TestCancelRequestUnknown(t *testing.T) {
	w := &WshRpc{Lock: &sync.Mutex{}, ResponseHandlerMap: map[string]*RpcResponseHandler{}}
	w.cancelRequest("")
	w.cancelRequest("does-not-exist")
}

func TestCancelRequestsForLink(t *testing.T) {
	w := &WshRpc{Lock: &sync.Mutex{}, ResponseHandlerMap: map[string]*RpcResponseHandler{}}
	hA, ctxA := mkHandler(w, "rA", baseds.LinkId(1))
	hB, ctxB := mkHandler(w, "rB", baseds.LinkId(2))
	w.ResponseHandlerMap["rA"] = hA
	w.ResponseHandlerMap["rB"] = hB

	w.CancelRequestsForLink(baseds.LinkId(1))

	select {
	case <-ctxA.Done():
	default:
		t.Fatal("expected L1 handler ctx to be cancelled")
	}
	select {
	case <-ctxB.Done():
		t.Fatal("L2 handler ctx should NOT be cancelled")
	default:
	}
	if !hA.done.Load() {
		t.Fatal("expected L1 handler done")
	}
}

// a handler that ran past its timeout still owes the router its final response: that is what drops the
// rpc's routing entry. With room in OutputCh it must always go out, not lose a race to the done ctx.
func TestFinalResponseAfterTimeoutIsSent(t *testing.T) {
	for i := 0; i < 32; i++ {
		w := &WshRpc{Lock: &sync.Mutex{}, ResponseHandlerMap: map[string]*RpcResponseHandler{}, OutputCh: make(chan []byte, 1)}
		h, _ := mkHandler(w, "r1", baseds.LinkId(1))
		(*h.contextCancelFn.Load())() // the timeout fires

		h.SendResponse(nil, true)

		if len(w.OutputCh) != 1 {
			t.Fatalf("run %d: the final response was dropped", i)
		}
	}
}

// a response JSON cannot encode (NaN) must still reach the caller as an error: the handler is marked done,
// so Finalize stays silent and the caller would otherwise wait out its timeout with the cause lost
func TestUnencodableResponseSendsAnError(t *testing.T) {
	w := &WshRpc{Lock: &sync.Mutex{}, ResponseHandlerMap: map[string]*RpcResponseHandler{}, OutputCh: make(chan []byte, 1)}
	h, _ := mkHandler(w, "r1", baseds.LinkId(1))

	if err := h.SendResponse(math.NaN(), true); err == nil {
		t.Fatal("SendResponse of NaN returned no error")
	}

	if len(w.OutputCh) != 1 {
		t.Fatal("no response was sent")
	}
	var msg RpcMessage
	if err := json.Unmarshal(<-w.OutputCh, &msg); err != nil {
		t.Fatal(err)
	}
	if msg.ResId != "r1" || msg.Error == "" || msg.Cont {
		t.Fatalf("got %+v, want a final error response for r1", msg)
	}
}
