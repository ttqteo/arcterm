// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// jobslotTimeout is the stream's RPC ceiling: a command can queue behind long jobs, and then holds its slot for
// as long as it runs.
const jobslotTimeout = 24 * time.Hour

// the Claude mod and the pi extension run this before every shell command an agent runs, and keep it alive
// while the command runs: it waits for a slot in arcterm's heavy-job queue, prints one JSON line per state
// ({"queued":2,"behind":…,"for":…} while queued, then {"run":true} or {"run":false,"reason":…}), and holds the
// slot until it is killed. Any error exits non-zero with no verdict line, and the hooks run the command.
var jobslotCmd = &cobra.Command{
	Use:                   "jobslot -- <command>",
	Short:                 "wait for and hold a slot in arcterm's heavy-job queue (agent hooks)",
	Args:                  cobra.ExactArgs(1),
	RunE:                  jobslotRun,
	PreRunE:               preRunSetupRpcClient,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(jobslotCmd)
}

// jobslotData is the request for one shell command, from the block the agent runs in. A block that cannot be
// resolved (or a Claude daemon session with no tab attached) leaves the job without a tab to open: the queue
// still holds its turn.
func jobslotData(command string) wshrpc.CommandJobSlotData {
	data := wshrpc.CommandJobSlotData{Command: command}
	oref, err := resolveBlockArg()
	if err != nil {
		return data
	}
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return data
		}
		oref = target
	}
	data.BlockId = oref.OID
	return data
}

func jobslotRun(cmd *cobra.Command, args []string) error {
	msgs := wshclient.JobSlotCommand(RpcClient, jobslotData(args[0]), &wshrpc.RpcOpts{Timeout: jobslotTimeout.Milliseconds()})
	out := json.NewEncoder(os.Stdout)
	for msg := range msgs {
		if msg.Error != nil {
			return msg.Error
		}
		if err := out.Encode(msg.Response); err != nil {
			return fmt.Errorf("writing a job queue line: %w", err)
		}
	}
	return nil
}

// jobslotTurn waits for the command's turn and returns the verdict; returning ends the stream, so the slot is
// released at once (agy has no "command finished" event: the queue only orders its starts). ctx ends the wait;
// an error is a broken gate, which callers answer by letting the command run.
func jobslotTurn(ctx context.Context, command string) (run bool, reason string, err error) {
	// only a heavy command pays for the connection
	if _, heavy := memgate.Classify(command); !heavy {
		return true, "", nil
	}
	if err := ctx.Err(); err != nil {
		return false, "", err
	}
	if RpcClient == nil {
		if err := preRunSetupRpcClient(nil, nil); err != nil {
			return false, "", err
		}
	}
	opts := &wshrpc.RpcOpts{Timeout: jobslotTimeout.Milliseconds()}
	msgs := wshclient.JobSlotCommand(RpcClient, jobslotData(command), opts)
	defer func() {
		if opts.StreamCancelFn == nil {
			return
		}
		cancelCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = opts.StreamCancelFn(cancelCtx)
	}()
	for {
		select {
		case <-ctx.Done():
			return false, "", ctx.Err()
		case msg, open := <-msgs:
			if !open {
				return false, "", errors.New("the job queue closed the stream without an answer")
			}
			if msg.Error != nil {
				return false, "", msg.Error
			}
			if msg.Response.Run != nil {
				return *msg.Response.Run, msg.Response.Reason, nil
			}
		}
	}
}

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
