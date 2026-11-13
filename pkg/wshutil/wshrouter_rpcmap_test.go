// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// routeRequest sends a command from a fresh caller link to a leaf bound to DefaultRoute and waits until
// the leaf has it, so the router holds the request's routing entry.
func routeRequest(t *testing.T, reqId string) (*WshRouter, *gatedClient, baseds.LinkId) {
	t.Helper()
	router := NewWshRouter()
	leaf := newGatedClient(t)
	leaf.setBudget(-1)
	if _, err := router.RegisterTrustedLeaf(leaf, DefaultRoute); err != nil {
		t.Fatal(err)
	}
	callerLink := router.RegisterTrustedRouter(newGatedClient(t))
	cmd, _ := json.Marshal(RpcMessage{Command: "test", ReqId: reqId, Route: DefaultRoute})
	router.inputCh <- baseds.RpcInputChType{MsgBytes: cmd, IngressLinkId: callerLink}
	waitUntil(t, "the leaf to receive the request", func() bool { return len(leaf.received()) == 1 })
	return router, leaf, callerLink
}

func leafGotCancel(leaf *gatedClient, reqId string) bool {
	for _, raw := range leaf.received() {
		var msg RpcMessage
		if json.Unmarshal([]byte(raw), &msg) == nil && msg.Cancel && msg.ReqId == reqId {
			return true
		}
	}
	return false
}

func hasRouteInfo(router *WshRouter, reqId string) bool {
	return router.getRouteInfo(reqId) != nil
}

// a link that goes away can never receive its replies: its in-flight requests must be cancelled at the
// handler (else an agentctl stream keeps its 30-day handler and wakes go to a dead process) and their
// routing entries dropped
func TestUnregisterLinkCancelsItsInFlightRequests(t *testing.T) {
	router, leaf, callerLink := routeRequest(t, "r1")

	router.UnregisterLink(callerLink)

	waitUntil(t, "a cancel for r1 at the handler", func() bool { return leafGotCancel(leaf, "r1") })
	if hasRouteInfo(router, "r1") {
		t.Fatal("the gone link's request kept its routing entry")
	}
}

// a cancelled request never sends a final response, so forwarding the cancel is the router's last sight
// of it: the routing entry must go then, or every cancelled stream leaks one for the server's lifetime
func TestCancelDropsTheRoutingEntry(t *testing.T) {
	router, leaf, callerLink := routeRequest(t, "r1")

	cancel, _ := json.Marshal(RpcMessage{Cancel: true, ReqId: "r1"})
	router.inputCh <- baseds.RpcInputChType{MsgBytes: cancel, IngressLinkId: callerLink}

	waitUntil(t, "the cancel to reach the handler", func() bool { return leafGotCancel(leaf, "r1") })
	waitUntil(t, "r1's routing entry to go", func() bool { return !hasRouteInfo(router, "r1") })
}

// pkg/web called the main rpc's own per-link reap after UnregisterLink; the router's cancel reaches a real rpc
// server's handler on its own, so that second call was redundant
func TestUnregisterLinkCancelsTheHandlerContext(t *testing.T) {
	router := NewWshRouter()
	server := MakeWshRpc(wshrpc.RpcContext{}, nil, "test")
	if _, err := router.RegisterTrustedLeaf(server, DefaultRoute); err != nil {
		t.Fatal(err)
	}
	callerLink := router.RegisterTrustedRouter(newGatedClient(t))
	h, ctx := mkHandler(server, "r1", callerLink)
	server.Lock.Lock()
	server.ResponseHandlerMap["r1"] = h
	server.Lock.Unlock()
	router.registerRouteInfo("r1", callerLink, DefaultRoute, baseds.NoLinkId, 0)

	router.UnregisterLink(callerLink)

	select {
	case <-ctx.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("the gone link's handler context was not cancelled")
	}
}

// backend F2: a request whose destination link goes away before it answers can never get a reply: its routing
// entry must go, and the caller must be told now rather than wait out its timeout
func TestUnregisterLinkAnswersRequestsItWasHandling(t *testing.T) {
	router := NewWshRouter()
	leaf := newGatedClient(t)
	leaf.setBudget(-1)
	leafLink, err := router.RegisterTrustedLeaf(leaf, DefaultRoute)
	if err != nil {
		t.Fatal(err)
	}
	caller := newGatedClient(t)
	caller.setBudget(-1)
	callerLink := router.RegisterTrustedRouter(caller)
	cmd, _ := json.Marshal(RpcMessage{Command: "test", ReqId: "r1", Route: DefaultRoute})
	router.inputCh <- baseds.RpcInputChType{MsgBytes: cmd, IngressLinkId: callerLink}
	waitUntil(t, "the leaf to receive the request", func() bool { return len(leaf.received()) == 1 })
	waitUntil(t, "r1's routing entry", func() bool { return hasRouteInfo(router, "r1") })

	router.UnregisterLink(leafLink)

	waitUntil(t, "an error reply for r1 at the caller", func() bool {
		for _, raw := range caller.received() {
			var msg RpcMessage
			if json.Unmarshal([]byte(raw), &msg) == nil && msg.ResId == "r1" && msg.Error != "" {
				return true
			}
		}
		return false
	})
	// the error is runServer's last message for r1, so the entry is gone once the caller has it
	if hasRouteInfo(router, "r1") {
		t.Fatal("the request kept its routing entry after its destination went away")
	}
}

// review F1: a destination that answers and then closes queues its response on inputCh, and its recv loop
// calls UnregisterLink at once; the response is already queued, so it must reach the caller, not the
// "went away" error. Many rounds, since without ordering the outcome depends on whether runServer wakes first.
func TestUnregisterLinkLetsAQueuedResponseWin(t *testing.T) {
	router := NewWshRouter()
	caller := newGatedClient(t)
	caller.setBudget(-1)
	callerLink := router.RegisterTrustedRouter(caller)
	for i := range 200 {
		reqId, routeId := fmt.Sprintf("r%d", i), fmt.Sprintf("leaf%d", i)
		leaf := newGatedClient(t)
		leaf.setBudget(-1)
		leafLink, err := router.RegisterTrustedLeaf(leaf, routeId)
		if err != nil {
			t.Fatal(err)
		}
		cmd, _ := json.Marshal(RpcMessage{Command: "test", ReqId: reqId, Route: routeId})
		router.inputCh <- baseds.RpcInputChType{MsgBytes: cmd, IngressLinkId: callerLink}
		waitUntil(t, reqId+"'s routing entry", func() bool { return hasRouteInfo(router, reqId) })

		// what runLinkClientRecvLoop does when the leaf answers and closes back to back
		resp, _ := json.Marshal(RpcMessage{ResId: reqId, Data: "answer"})
		router.inputCh <- baseds.RpcInputChType{MsgBytes: resp, IngressLinkId: leafLink}
		router.UnregisterLink(leafLink)

		var got *RpcMessage
		waitUntil(t, "a reply for "+reqId+" at the caller", func() bool {
			for _, raw := range caller.received() {
				var msg RpcMessage
				if json.Unmarshal([]byte(raw), &msg) == nil && msg.ResId == reqId {
					got = &msg
					return true
				}
			}
			return false
		})
		if got.Error != "" {
			t.Fatalf("round %d: the caller got %q though the leaf's answer was queued first", i, got.Error)
		}
	}
}

// a destination that stays connected but never answers: once the request's own timeout passes, its caller
// has given up, so the router drops the entry; a request with no timeout (a frontend stream) keeps it
func TestRoutingEntryEndsWithItsRequestTimeout(t *testing.T) {
	router := NewWshRouter()
	leaf := newGatedClient(t)
	leaf.setBudget(-1)
	if _, err := router.RegisterTrustedLeaf(leaf, DefaultRoute); err != nil {
		t.Fatal(err)
	}
	callerLink := router.RegisterTrustedRouter(newGatedClient(t))
	for _, req := range []RpcMessage{
		{Command: "test", ReqId: "bounded", Route: DefaultRoute, Timeout: 50},
		{Command: "test", ReqId: "unbounded", Route: DefaultRoute},
	} {
		cmd, _ := json.Marshal(req)
		router.inputCh <- baseds.RpcInputChType{MsgBytes: cmd, IngressLinkId: callerLink}
	}
	waitUntil(t, "the leaf to receive both requests", func() bool { return len(leaf.received()) == 2 })
	waitUntil(t, "the timed-out request's entry to go", func() bool { return !hasRouteInfo(router, "bounded") })
	if !hasRouteInfo(router, "unbounded") {
		t.Fatal("a request with no timeout lost its routing entry")
	}
}

// f7 F1: a websocket reconnecting under the same stableId replaces its link. A request the old link had not
// answered moves to the new link: an answer the frontend sends there reaches the caller instead of a "went
// away" error, and the moved entry goes with the new link if that one goes away in turn.
func TestReplaceLinkMovesUnansweredRequestsToTheNewLink(t *testing.T) {
	router := NewWshRouter()
	oldLeaf := newGatedClient(t)
	oldLeaf.setBudget(-1)
	oldLink, err := router.RegisterTrustedLeaf(oldLeaf, DefaultRoute)
	if err != nil {
		t.Fatal(err)
	}
	caller := newGatedClient(t)
	caller.setBudget(-1)
	callerLink := router.RegisterTrustedRouter(caller)
	for _, reqId := range []string{"r1", "r2"} {
		cmd, _ := json.Marshal(RpcMessage{Command: "test", ReqId: reqId, Route: DefaultRoute})
		router.inputCh <- baseds.RpcInputChType{MsgBytes: cmd, IngressLinkId: callerLink}
		waitUntil(t, reqId+"'s routing entry", func() bool { return hasRouteInfo(router, reqId) })
	}
	newLeaf := newGatedClient(t)
	newLeaf.setBudget(-1)
	newLink := router.RegisterTrustedRouter(newLeaf)

	router.ReplaceLink(oldLink, newLink)
	resp, _ := json.Marshal(RpcMessage{ResId: "r1", Data: "answer"})
	router.inputCh <- baseds.RpcInputChType{MsgBytes: resp, IngressLinkId: newLink}
	router.UnregisterLink(newLink)

	replies := map[string]RpcMessage{}
	waitUntil(t, "replies for r1 and r2 at the caller", func() bool {
		for _, raw := range caller.received() {
			var msg RpcMessage
			if json.Unmarshal([]byte(raw), &msg) == nil && msg.ResId != "" {
				replies[msg.ResId] = msg
			}
		}
		return len(replies) == 2
	})
	if replies["r1"].Error != "" {
		t.Errorf("r1 got %q, want the answer the new link sent", replies["r1"].Error)
	}
	if replies["r2"].Error == "" {
		t.Errorf("r2 got %+v, want an error once the link it moved to went away", replies["r2"])
	}
}
