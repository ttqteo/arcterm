// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// protectRetry is how often `wsh protect` tries wavesrv again after its link dropped (an arcterm restart)
var protectRetry = 5 * time.Second

var protectCmd = &cobra.Command{
	Use:   "protect -- <command> [args...]",
	Short: "run one long job with every other heavy job in arcterm's queue held back until it exits",
	Long: `Run one long, timing-sensitive command (a measurement, a benchmark, a long docker run) with the machine held
for it. wsh starts the command as its own child, with stdin, stdout and stderr passed straight through, and exits
with its exit code.

The command's request goes ahead of every job queued in arcterm's heavy-job queue. It starts once every heavy job
already running has finished (none is killed), and while it runs every other heavy job waits, agent commands and
engine steps (Verify, Final, heavy Setup) alike, showing "protected: <command> is running". It holds even with the
queue off or paused, and is held until the command exits, however long that is.

What it does not hold back: light commands (git, reading files, single tests); council seats; an engine run that is
already going keeps starting new workers, only its queued steps wait; and work outside arcterm's queue, such as docker
commands typed by hand or an IDE's build. Run now in the Jobs popover still pushes one waiting job through.

Outside arcterm, or when arcterm does not answer, the command runs anyway, with a warning. If the link to arcterm
drops while it runs, wsh retries every few seconds and asks for Protect again.

The command runs as given, not through a shell: wrap a pipeline in one, wsh protect -- bash -c "a && b".`,
	Example:               "  wsh protect -- python scripts/audit_guard.py\n  wsh protect -- docker compose up --abort-on-container-exit",
	Args:                  cobra.MinimumNArgs(1),
	RunE:                  protectRun,
	DisableFlagsInUseLine: true,
}

func init() {
	// everything from the command on is its own: wsh protect python x.py --n 3
	protectCmd.Flags().SetInterspersed(false)
	rootCmd.AddCommand(protectCmd)
}

// protectOpen asks wavesrv for a Protect slot for command, held by holdPid when it is set (a child already running,
// on a reconnect): the stream once wavesrv's first word is in, or nil when it could not be reached or did not answer
// within wsh jobslot's deadlines.
func protectOpen(command string, holdPid int32) chan jobslotMsg {
	msgs, _ := jobslotOpen(func() error {
		return preRunSetupRpcClient(nil, nil)
	}, func(giveUp time.Time) chan jobslotMsg {
		data := jobslotData(command)
		data.Protect = true
		data.HoldPid = holdPid
		data.GiveUpTs = giveUp.UnixMilli()
		return wshclient.JobSlotCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: jobslotTimeout.Milliseconds()})
	}, jobslotConnectWait, jobslotFirstWord)
	return msgs
}

// the outcome of waiting on a Protect request
type protectVerdict int

const (
	protectBroken  protectVerdict = iota // the stream failed or ended with no verdict: run without Protect
	protectStarted                       // the slot is held
	protectRefused                       // the person skipped it from the Jobs popover
)

// protectAwait reads the stream until its verdict, telling w each place in the queue. job is the started job's id
// (for JobSlotHold), reason a refusal's.
func protectAwait(msgs chan jobslotMsg, w io.Writer) (verdict protectVerdict, job, reason string) {
	for msg := range msgs {
		if msg.Error != nil {
			return protectBroken, "", ""
		}
		u := msg.Response
		switch {
		case u.Run != nil && *u.Run:
			return protectStarted, u.Job, ""
		case u.Run != nil:
			return protectRefused, "", u.Reason
		case u.Queued > 0:
			ahead := ""
			if u.Behind != "" {
				ahead = " behind " + u.Behind
				if u.For != "" {
					ahead += " (" + u.For + ")"
				}
			}
			fmt.Fprintf(w, "arc: protect waits #%d%s; it starts once the heavy jobs running now finish\n", u.Queued, ahead)
		}
	}
	return protectBroken, "", ""
}

// protectKeep holds the slot while the child runs (until done closes): when the stream ends with the child still
// running, the link to wavesrv dropped, so it warns and asks again every protectRetry with the child's pid, until a
// request is granted, refused, or the child exits.
func protectKeep(msgs chan jobslotMsg, open func() chan jobslotMsg, done <-chan struct{}, w io.Writer) {
	for {
		if msgs != nil {
			ended := make(chan struct{})
			go func() {
				for msg := range msgs {
					if msg.Error != nil {
						break
					}
				}
				close(ended)
			}()
			select {
			case <-done:
				return
			case <-ended:
			}
			fmt.Fprintln(w, "arc: lost arcterm's job queue; Protect is off until it answers again, retrying")
		}
		select {
		case <-done:
			return
		case <-time.After(protectRetry):
		}
		msgs = open()
		if msgs == nil {
			continue
		}
		switch verdict, _, reason := protectAwait(msgs, w); verdict {
		case protectStarted:
			fmt.Fprintln(w, "arc: Protect is back on")
		case protectRefused:
			fmt.Fprintf(w, "arc: %s; the command keeps running without Protect\n", reason)
			return
		default:
			msgs = nil
		}
	}
}

func protectRun(cmd *cobra.Command, args []string) error {
	command := strings.Join(args, " ")
	child := exec.Command(args[0], args[1:]...)
	child.Stdin, child.Stdout, child.Stderr = os.Stdin, os.Stdout, os.Stderr
	// Ctrl+C reaches the child too; wsh waits for it to exit and passes its code on. Notify, not Ignore: an ignored
	// signal would stay ignored in the child
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt)
	defer signal.Stop(interrupts)
	go func() {
		for range interrupts {
		}
	}()

	msgs := protectOpen(command, 0)
	job := ""
	switch {
	case msgs == nil && os.Getenv(wshutil.WaveJwtTokenVarName) == "":
		fmt.Fprintln(os.Stderr, "arc: not inside arcterm; running without Protect")
	case msgs == nil:
		fmt.Fprintln(os.Stderr, "arc: arcterm's job queue did not answer; running without Protect")
	default:
		verdict, id, reason := protectAwait(msgs, os.Stderr)
		switch verdict {
		case protectRefused:
			fmt.Fprintln(os.Stderr, reason)
			WshExitCode = jobslotRefusedExit
			return nil
		case protectBroken:
			fmt.Fprintln(os.Stderr, "arc: arcterm's job queue gave no answer; running without Protect")
			msgs = nil
		default:
			job = id
		}
	}
	if err := child.Start(); err != nil {
		return fmt.Errorf("starting %s: %w", args[0], err)
	}
	pid := int32(child.Process.Pid)
	if job != "" {
		// the slot now lives as long as the child, even if this wsh is killed first
		if err := wshclient.JobSlotHoldCommand(RpcClient, wshrpc.CommandJobSlotHoldData{Job: job, Pid: pid},
			&wshrpc.RpcOpts{Timeout: jobslotFirstWord.Milliseconds()}); err != nil {
			fmt.Fprintf(os.Stderr, "arc: could not hand the Protect slot to the command (%v); it is held while wsh runs\n", err)
		}
	}
	done := make(chan struct{})
	if msgs != nil {
		go protectKeep(msgs, func() chan jobslotMsg { return protectOpen(command, pid) }, done, os.Stderr)
	}
	err := child.Wait()
	close(done)
	WshExitCode = protectExitCode(err)
	return nil
}

// protectExitCode is the child's exit code; one killed by a signal exits 1
func protectExitCode(err error) int {
	var exitErr *exec.ExitError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &exitErr) && exitErr.ExitCode() >= 0:
		return exitErr.ExitCode()
	}
	return 1
}
