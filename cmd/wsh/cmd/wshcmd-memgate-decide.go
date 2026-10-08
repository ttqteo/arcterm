// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// rpcWithContext runs a blocking rpc call and gives up on it when ctx ends. The call itself has no context, so
// it is left running; both callers are short-lived commands that exit right after, and the server's waiter
// cancel takes the card of a process that is gone down.
func rpcWithContext[T any](ctx context.Context, call func() (T, error)) (T, error) {
	type result struct {
		val T
		err error
	}
	done := make(chan result, 1)
	go func() {
		v, err := call()
		done <- result{v, err}
	}()
	select {
	case r := <-done:
		return r.val, r.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	}
}

// memgateDecide is the decision `wsh memgate` makes about one shell command: classify it, check the free RAM, and
// when it does not fit, hold the command behind the person's card and wait for RAM if they choose to. onHold gets
// each progress line (a memgate.Hold) before the verdict. ctx ends the card and the wait; an error is a broken
// gate, which callers answer by letting the command run.
func memgateDecide(ctx context.Context, cmdline string, onHold func(any)) (memgate.Verdict, error) {
	job, heavy := memgate.Classify(cmdline)
	if !heavy {
		return memgate.Verdict{Run: true}, nil
	}
	if err := ctx.Err(); err != nil {
		return memgate.Verdict{}, err
	}
	// only a heavy command pays for the connection
	if RpcClient == nil {
		if err := preRunSetupRpcClient(nil, nil); err != nil {
			return memgate.Verdict{}, err
		}
	}
	capacity, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetWorkerCapacityRtnData, error) {
		return wshclient.GetWorkerCapacityCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	})
	if err != nil {
		return memgate.Verdict{}, fmt.Errorf("reading free RAM: %w", err)
	}
	if memgate.Fits(job, capacity.AvailableBytes) {
		return memgate.Verdict{Run: true}, nil
	}

	oref, err := resolveBlockArg()
	if err != nil {
		return memgate.Verdict{}, fmt.Errorf("resolving block: %w", err)
	}
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return memgate.Verdict{}, fmt.Errorf("the session runs in the Claude daemon with no arcterm tab attached")
		}
		oref = target
	}
	question := memgate.Question(job, capacity.AvailableBytes, capacity.TotalBytes)
	onHold(memgate.Asking(job, capacity.AvailableBytes))
	rtn, err := rpcWithContext(ctx, func() (wshrpc.AskRtnData, error) {
		return wshclient.AskCommand(RpcClient, wshrpc.CommandAskData{
			ORef:      oref.String(),
			Questions: []baseds.AgentAskQuestion{question},
			Wait:      true,
			Hold:      true,
		}, &wshrpc.RpcOpts{Timeout: int64(askWaitTimeout / time.Millisecond)})
	})
	if err != nil {
		return memgate.Verdict{}, err
	}

	switch memgate.Choice(rtn.Answers, rtn.Cancelled) {
	case memgate.OptionRun:
		return memgate.Verdict{Run: true}, nil
	case memgate.OptionWait:
		read := func(ctx context.Context) (uint64, error) {
			c, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetWorkerCapacityRtnData, error) {
				return wshclient.GetWorkerCapacityCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
			})
			if err != nil {
				return 0, err
			}
			return c.AvailableBytes, nil
		}
		onHold(memgate.Waiting(job))
		if memgate.Wait(ctx, job, read, memgate.WaitEvery, memgate.WaitLimit) {
			return memgate.Verdict{Run: true}, nil
		}
		// the caller's own deadline ended the wait, which is not memgate's "RAM never came free"
		if err := ctx.Err(); err != nil {
			return memgate.Verdict{}, err
		}
		return memgate.TimedOut(job, memgate.WaitLimit), nil
	}
	return memgate.Skipped(job, capacity.AvailableBytes), nil
}
