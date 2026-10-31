// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
//
// A background command outlives the hook's tool call, so the Claude mod puts this in front of it instead:
// --hold-parent waits inside the command's own shell, then hands the slot to that shell (its parent), which
// wavesrv holds it for until the shell exits; --heavy says whether a command takes a slot at all.
var jobslotCmd = &cobra.Command{
	Use:   "jobslot -- <command>",
	Short: "wait for and hold a slot in arcterm's heavy-job queue (agent hooks)",
	Args:  cobra.ExactArgs(1),
	RunE:  jobslotRun,
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if jobslotHeavy {
			return nil // the table is local: no connection
		}
		return preRunSetupRpcClient(cmd, args)
	},
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

var (
	jobslotHoldParent bool
	jobslotHeavy      bool
)

// the exit of --hold-parent when the person skipped the command: the shell around it exits with it and never
// runs the command. Every other exit, wsh's own failures included, lets the command run
const jobslotRefusedExit = 75

func init() {
	jobslotCmd.Flags().BoolVar(&jobslotHoldParent, "hold-parent", false,
		"wait for the slot, then leave it held for as long as this command's parent process runs, and exit")
	jobslotCmd.Flags().BoolVar(&jobslotHeavy, "heavy", false,
		"exit 0 when the command takes a slot, 1 when it runs without one; no connection")
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
	if jobslotHeavy {
		if !jobslotTakesSlot(args[0]) {
			WshExitCode = 1
		}
		return nil
	}
	if jobslotHoldParent {
		data := jobslotData(args[0])
		data.HoldPid = int32(os.Getppid())
		msgs := wshclient.JobSlotCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: jobslotTimeout.Milliseconds()})
		WshExitCode = jobslotHand(msgs, os.Stderr)
		return nil
	}
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

// jobslotTakesSlot is what the server decides first: a heavy command waits for a slot unless it runs on for good
// (a dev server), which never queues
func jobslotTakesSlot(command string) bool {
	job, heavy := memgate.Classify(command)
	return heavy && !job.LongRunning()
}

// jobslotHand reads the stream for --hold-parent: each place in the queue goes to w for the agent reading the
// background command's output, a refusal's reason too. It returns the exit code: 0 to run the command (a broken
// queue included: it never blocks an agent), jobslotRefusedExit when the person skipped it.
func jobslotHand(msgs chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate], w io.Writer) int {
	for msg := range msgs {
		if msg.Error != nil {
			return 0
		}
		u := msg.Response
		switch {
		case u.Run != nil && *u.Run:
			return 0
		case u.Run != nil:
			fmt.Fprintln(w, u.Reason)
			return jobslotRefusedExit
		case u.Queued > 0:
			ahead := ""
			if u.Behind != "" {
				ahead = " — waiting behind " + u.Behind
				if u.For != "" {
					ahead += " (" + u.For + ")"
				}
			}
			fmt.Fprintf(w, "arc: queued #%d in arcterm's heavy-job queue%s\n", u.Queued, ahead)
		}
	}
	return 0
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
