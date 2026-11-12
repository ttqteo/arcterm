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
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// jobslotTimeout is the stream's RPC ceiling: a command can queue behind long jobs, and then holds its slot for
// as long as it runs.
const jobslotTimeout = 24 * time.Hour

// jobslotFirstWord is how long a heavy command waits for wavesrv's first line once connected. A live server
// answers at once, with a place in the queue or the verdict, so silence means a stuck one, and a stuck queue must
// never hold an agent's command: on 2026-11-11 a hung wavesrv held every shell command of every agent, a stop sent
// to a runaway bench included, for minutes.
var jobslotFirstWord = 5 * time.Second

// jobslotConnectWait bounds the connect and its authentication, on their own clock: under swap they alone can take
// seconds, and counted in jobslotFirstWord they sent heavy commands past the queue exactly when RAM was short.
var jobslotConnectWait = 15 * time.Second

// the Claude mod and the pi extension run this before every shell command an agent runs, and keep it alive
// while the command runs: it waits for a slot in arcterm's heavy-job queue, prints one JSON line per state
// ({"queued":2,"behind":…,"for":…} while queued, then {"run":true} or {"run":false,"reason":…}), and holds the
// slot until it is killed. A command that takes no slot gets {"run":true} at once, with no connection. Any
// error, a connect past jobslotConnectWait, or no word from wavesrv within jobslotFirstWord of connecting, exits
// non-zero with no verdict line, and the hooks run the command; wavesrv counts it as a bypass when it reads the
// request late.
//
// A background command outlives the hook's tool call, so the Claude mod puts this in front of it instead:
// --hold-parent waits inside the command's own shell, then hands the slot to that shell (its parent), which
// wavesrv holds it for until the shell exits; --heavy says whether a command takes a slot at all.
var jobslotCmd = &cobra.Command{
	Use:   "jobslot -- <command>",
	Short: "wait for and hold a slot in arcterm's heavy-job queue (agent hooks)",
	Args:  cobra.ExactArgs(1),
	RunE:  jobslotRun,
	// no PreRunE: only a heavy command connects, inside jobslotOpen's deadline
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
	command := args[0]
	out := json.NewEncoder(os.Stdout)
	if !jobslotTakesSlot(command) {
		// the server's own answer for it, without asking: a light command never waits on wavesrv
		if jobslotHoldParent {
			return nil
		}
		yes := true
		return out.Encode(wshrpc.JobSlotUpdate{Run: &yes})
	}
	holdPid := int32(0)
	if jobslotHoldParent {
		holdPid = int32(os.Getppid())
	}
	missedDir := jobslotMissedDir()
	msgs, reached := jobslotOpen(func() error {
		return preRunSetupRpcClient(nil, nil)
	}, func(giveUp time.Time) chan jobslotMsg {
		data := jobslotData(command)
		data.HoldPid = holdPid
		data.GiveUpTs = giveUp.UnixMilli()
		data.Missed = jobslotTakeMissed(missedDir)
		return wshclient.JobSlotCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: jobslotTimeout.Milliseconds()})
	}, jobslotConnectWait, jobslotFirstWord)
	if msgs == nil && !reached && os.Getenv(wshutil.WaveJwtTokenVarName) != "" {
		// inside arcterm but wavesrv never heard of it: the next heavy command that gets through tells it
		job, _ := jobslotClassify(command)
		jobslotNoteMissed(missedDir, wshrpc.JobSlotMissed{Name: job.Name, Ts: time.Now().UnixMilli(), BlockId: os.Getenv("WAVETERM_BLOCKID")})
	}
	if jobslotHoldParent {
		if msgs == nil {
			fmt.Fprintln(os.Stderr, "arc: arcterm's job queue did not answer; running without a slot")
			return nil
		}
		WshExitCode = jobslotHand(msgs, os.Stderr)
		return nil
	}
	if msgs == nil {
		return errors.New("arcterm's job queue gave no answer; running without a slot")
	}
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

type jobslotMsg = wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]

// jobslotMissedMax is how many noted bypasses one request hands over; the rest go with the next
const jobslotMissedMax = 50

// jobslotMissedDir holds the commands a wsh jobslot ran without a slot because it never reached wavesrv (a connect
// that failed or hung), one file each, until a later heavy command that gets through hands them over; empty when
// there is no home directory
func jobslotMissedDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".arc", "jobslot-missed")
}

// jobslotNoteMissed writes one under a temporary name, then renames it, so a reader never sees half a file. Best
// effort: a failure loses only the count.
func jobslotNoteMissed(dir string, m wshrpc.JobSlotMissed) {
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	// a unique name: the clock alone repeats within a burst on Windows
	f, err := os.CreateTemp(dir, "*.tmp")
	if err != nil {
		return
	}
	tmp := f.Name()
	_, werr := f.Write(b)
	if cerr := f.Close(); werr != nil || cerr != nil {
		os.Remove(tmp)
		return
	}
	if err := os.Rename(tmp, strings.TrimSuffix(tmp, ".tmp")+".json"); err != nil {
		os.Remove(tmp)
	}
}

// jobslotTakeMissed reads and removes up to jobslotMissedMax noted bypasses. Two wsh can race for one: only the one
// whose remove succeeds hands it over.
func jobslotTakeMissed(dir string) []wshrpc.JobSlotMissed {
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []wshrpc.JobSlotMissed
	for _, e := range entries {
		if len(out) >= jobslotMissedMax {
			break
		}
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		p := filepath.Join(dir, e.Name())
		b, err := os.ReadFile(p)
		if err != nil || os.Remove(p) != nil {
			continue
		}
		var m wshrpc.JobSlotMissed
		if json.Unmarshal(b, &m) == nil && m.Name != "" {
			out = append(out, m)
		}
	}
	return out
}

// jobslotOpen connects (within connectWait), starts the stream with the time the caller gives up, wait from the
// connect, and returns the stream once its first message is in, that message replayed at its head. nil when the
// connect fails or hangs, the stream ends with no word, or nothing comes within wait: the caller then runs the
// command without a slot; reached says whether the connect went through, so wavesrv saw the request (and counts
// a late one itself). On a timeout the work is left behind; the process exits soon after, which closes the
// link and frees anything the server held for it.
func jobslotOpen(connect func() error, start func(giveUp time.Time) chan jobslotMsg, connectWait, wait time.Duration) (msgs chan jobslotMsg, reached bool) {
	connected := make(chan error, 1)
	go func() { connected <- connect() }()
	connectTimer := time.NewTimer(connectWait)
	defer connectTimer.Stop()
	select {
	case err := <-connected:
		if err != nil {
			return nil, false
		}
	case <-connectTimer.C:
		return nil, false
	}
	giveUp := time.Now().Add(wait)
	got := make(chan chan jobslotMsg, 1)
	go func() {
		msgs := start(giveUp)
		first, ok := <-msgs
		if !ok {
			got <- nil
			return
		}
		replay := make(chan jobslotMsg, 1)
		replay <- first
		go func() {
			defer close(replay)
			for m := range msgs {
				replay <- m
			}
		}()
		got <- replay
	}()
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case msgs := <-got:
		return msgs, true
	case <-timer.C:
		return nil, true
	}
}

// jobslotLearnedPath is where wavesrv writes the unknown commands it has measured heavy (memgate.LearnedPath); empty
// when there is no home directory. A variable so a test can point it at a file of its own.
var jobslotLearnedPath = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return memgate.LearnedPath(home)
}

var (
	jobslotLearnedOnce sync.Once
	jobslotLearnedSet  map[string]bool
)

// jobslotLearned is the learned set, read from the file on first use and kept for the rest of this wsh run: a
// missing or broken file, or no home directory, is an empty set, so an unknown command stays light.
func jobslotLearned() map[string]bool {
	jobslotLearnedOnce.Do(func() {
		jobslotLearnedSet = map[string]bool{}
		if path := jobslotLearnedPath(); path != "" {
			jobslotLearnedSet = memgate.ReadLearned(path)
		}
	})
	return jobslotLearnedSet
}

// jobslotClassify is the verdict wsh decides on locally: the memgate table, plus the unknown commands wavesrv has
// learned to be heavy. Reading the file is no connection: a light command still never reaches wavesrv.
func jobslotClassify(command string) (memgate.Job, bool) {
	return memgate.ClassifyWith(command, jobslotLearned())
}

// jobslotTakesSlot is what the server decides first: a heavy command waits for a slot unless it runs on for good
// (a dev server), which never queues
func jobslotTakesSlot(command string) bool {
	job, heavy := jobslotClassify(command)
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
	if _, heavy := jobslotClassify(command); !heavy {
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
