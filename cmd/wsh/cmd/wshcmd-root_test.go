// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const workerTabId = "cc404533-ce48-4460-af3d-c9917a7c0114"

// fakeRpc swaps RpcClient for one whose requests a test reads and answers.
func fakeRpc(t *testing.T) (chan baseds.RpcInputChType, chan []byte) {
	t.Helper()
	inputCh := make(chan baseds.RpcInputChType, 1)
	outputCh := make(chan []byte, 1)
	prev := RpcClient
	RpcClient = wshutil.MakeWshRpcWithChannels(inputCh, outputCh, wshrpc.RpcContext{}, nil, "test")
	t.Cleanup(func() { RpcClient = prev })
	return inputCh, outputCh
}

// a block can start without WAVETERM_TABID when the server's tab lookup fails at launch, which left a run
// worker unable to `wsh jarvis complete`
func TestTabIdFallsBackToTheBlocksTab(t *testing.T) {
	t.Setenv("WAVETERM_TABID", "")
	t.Setenv("WAVETERM_BLOCKID", "blk")
	inputCh, outputCh := fakeRpc(t)

	got := make(chan string, 1)
	go func() { got <- getTabIdFromEnv() }()
	var req wshutil.RpcMessage
	select {
	case msg := <-outputCh:
		if err := json.Unmarshal(msg, &req); err != nil {
			t.Fatalf("request is not an rpc message: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no request was sent")
	}
	var data wshrpc.CommandResolveIdsData
	b, _ := json.Marshal(req.Data)
	if err := json.Unmarshal(b, &data); err != nil || req.Command != "resolveids" || data.BlockId != "blk" || len(data.Ids) != 1 || data.Ids[0] != "tab" {
		t.Fatalf("want resolveids of this block's tab, got %s %s", req.Command, b)
	}
	resp, _ := json.Marshal(wshutil.RpcMessage{ResId: req.ReqId, Data: wshrpc.CommandResolveIdsRtnData{
		ResolvedIds: map[string]waveobj.ORef{"tab": {OType: waveobj.OType_Tab, OID: workerTabId}},
	}})
	inputCh <- baseds.RpcInputChType{MsgBytes: resp}
	select {
	case id := <-got:
		if id != workerTabId {
			t.Fatalf("tab id = %q, want %s", id, workerTabId)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no tab id after the server replied")
	}
}

func TestTabIdFromTheEnvSendsNothing(t *testing.T) {
	t.Setenv("WAVETERM_TABID", "tab-env")
	t.Setenv("WAVETERM_BLOCKID", "blk")
	_, outputCh := fakeRpc(t)

	if id := getTabIdFromEnv(); id != "tab-env" {
		t.Fatalf("tab id = %q, want tab-env", id)
	}
	select {
	case msg := <-outputCh:
		t.Fatalf("an env tab id needs no request, sent %s", msg)
	default:
	}
}
