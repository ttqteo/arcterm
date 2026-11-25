// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/jobpeaks"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// JobSlotCommand holds a place in the heavy-job queue for one shell command an agent is about to run, for as
// long as the caller (`wsh jobslot`, kept alive by the agent's hook while the command runs) stays connected.
// The stream carries the place while the command waits, then run true to start it (or run false and the
// reason it was refused); the slot comes back when the stream ends, whether the caller finished, died, or
// its link to wavesrv closed.
func (ws *WshServer) JobSlotCommand(ctx context.Context, data wshrpc.CommandJobSlotData) chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate], 4)
	go func() {
		defer func() {
			panichandler.PanicHandler("JobSlotCommand", recover())
		}()
		defer close(ch)
		send := func(u wshrpc.JobSlotUpdate) bool {
			select {
			case ch <- wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]{Response: u}:
				return true
			case <-ctx.Done():
				return false
			}
		}
		yes, no := true, false
		// the learned set is the unknown patterns measured heavy (a nil store has none): wsh reads the same set from the
		// learned file, so both decide alike which commands take a slot
		job, heavy := memgate.ClassifyWith(data.Command, jobpeaks.Default.Learned())
		q := jobqueue.Default
		if q != nil {
			noteMissed(ctx, q, data.Missed)
		}
		if q == nil || !data.Protect && (!heavy || job.LongRunning()) {
			send(wshrpc.JobSlotUpdate{Run: &yes})
			return
		}
		if data.Protect && (!heavy || job.LongRunning()) {
			// a Protect job queues whatever memgate calls it (python, a docker compose up), named for its command
			job = memgate.Job{Name: protectName(data.Command)}
		}
		src := jobqueue.Source{BlockId: data.BlockId}
		if data.BlockId != "" {
			if tabId, err := blockTabId(ctx, data.BlockId); err == nil {
				src.TabId = tabId
			}
		}
		if data.GiveUpTs > 0 && time.Now().UnixMilli() > data.GiveUpTs {
			// read after the caller stopped waiting: its command already runs without a slot
			q.NoteBypass(job.Name, src, time.Time{})
			return
		}
		// A command that got here unprotected is heavy and not long-running. The working agent of a pair whose judge has
		// not answered is refused it before it queues, with the reason it reads (agentpair.Manager.Hold).
		if !data.Protect && src.TabId != "" {
			if reason, held := getPairManager().Hold(src.TabId, data.Command); held {
				send(wshrpc.JobSlotUpdate{Run: &no, Reason: reason})
				return
			}
		}
		// the figure to admit on is what the command's last runs measured in this project, else (for a learned pattern)
		// in another one, else the table's; every caller gets it, pi's included. A heavy command queues whatever the
		// figure comes to: a small one only means it fits sooner
		bytes, basis := jobpeaks.Default.Estimate(job.Name, jobProject(ctx, data.BlockId), job.Bytes)
		req := jobqueue.Request{Name: job.Name, Bytes: bytes, Basis: basis, Source: src, Protect: data.Protect}
		slot, err := q.Acquire(ctx, req, func(w jobqueue.Wait) {
			// runs under the queue's lock: a full buffer drops the line, and the next place supersedes it
			select {
			case ch <- wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]{Response: wshrpc.JobSlotUpdate{Queued: w.Position, Behind: w.Behind, For: w.For}}:
			default:
			}
		})
		if errors.Is(err, jobqueue.ErrSkipped) {
			send(wshrpc.JobSlotUpdate{Run: &no, Reason: fmt.Sprintf(
				"Not run: the person skipped `%s` from arcterm's job queue. "+
					"Do not retry it; carry on without it and say in your report that it was skipped.", job.Name)})
			return
		}
		if err != nil {
			return
		}
		defer slot.Release()
		started := wshrpc.JobSlotUpdate{Run: &yes}
		if data.Protect {
			started.Job = slot.Id()
			defer holdPids.Delete(slot.Id())
		}
		if !send(started) {
			return
		}
		reclaimed := false
		select {
		case <-ctx.Done():
			// a caller that handed the slot on (`wsh jobslot --hold-parent`, for a background command; `wsh protect`,
			// to its child) has left once its command may start: the slot stays while that process runs
			pid := data.HoldPid
			if v, ok := holdPids.Load(slot.Id()); ok && pid == 0 {
				pid = v.(int32)
			}
			if pid > 0 {
				reclaimed = !holdWhileRunning(pid, slot.Reclaimed())
			}
		case <-slot.Reclaimed():
			reclaimed = true
		}
		if reclaimed {
			log.Printf("jobqueue: reclaimed %q (block %s) after %v", job.Name, data.BlockId, jobqueue.MaxHold)
		}
	}()
	return ch
}

// holdPids are the processes Protect slots were handed to by JobSlotHold, by job id, for as long as their stream lives
var holdPids sync.Map

// protectNameMax is how long a Protect job's name runs before it is cut: the popover's row and the waiting jobs'
// reason "protected: <name> is running" both show it
const protectNameMax = 60

// protectName is the command a Protect job runs, as its name: its words on one line, cut at protectNameMax
func protectName(command string) string {
	name := strings.Join(strings.Fields(command), " ")
	if r := []rune(name); len(r) > protectNameMax {
		name = string(r[:protectNameMax-1]) + "…"
	}
	if name == "" {
		return "protected job"
	}
	return name
}

// JobSlotHoldCommand hands a started Protect slot to a process (`wsh protect`'s child), which then holds it past the
// stream until it exits, as HoldPid does for one known up front.
func (ws *WshServer) JobSlotHoldCommand(ctx context.Context, data wshrpc.CommandJobSlotHoldData) error {
	if data.Job == "" || data.Pid <= 0 {
		return fmt.Errorf("jobslothold needs a job and a pid")
	}
	if jobqueue.Default == nil || !slices.ContainsFunc(jobqueue.Default.Snapshot().Jobs, func(j jobqueue.Job) bool {
		return j.Id == data.Job && j.Running && j.Protect
	}) {
		return fmt.Errorf("no running Protect job %q", data.Job)
	}
	holdPids.Store(data.Job, data.Pid)
	return nil
}

// noteMissed counts the commands earlier wsh jobslots ran without a slot because they never reached wavesrv
func noteMissed(ctx context.Context, q *jobqueue.Queue, missed []wshrpc.JobSlotMissed) {
	for _, m := range missed {
		src := jobqueue.Source{BlockId: m.BlockId}
		if m.BlockId != "" {
			if tabId, err := blockTabId(ctx, m.BlockId); err == nil {
				src.TabId = tabId
			}
		}
		q.NoteBypass(m.Name, src, time.UnixMilli(m.Ts))
	}
}

// how a slot handed to a process watches it; tests swap both
var (
	pidAlive = func(pid int32) bool {
		ok, _ := process.PidExists(pid)
		return ok
	}
	pidPoll = 2 * time.Second
)

// holdWhileRunning keeps a slot until pid exits; false when the queue took the slot back first (MaxHold), which
// also bounds a pid that is never seen to exit
func holdWhileRunning(pid int32, reclaimed <-chan struct{}) bool {
	tick := time.NewTicker(pidPoll)
	defer tick.Stop()
	for pidAlive(pid) {
		select {
		case <-reclaimed:
			return false
		case <-tick.C:
		}
	}
	return true
}

func (ws *WshServer) GetJobQueueCommand(ctx context.Context) (*wshrpc.JobQueueData, error) {
	if jobqueue.Default == nil {
		return &wshrpc.JobQueueData{Slots: jobqueue.DefaultSlots, Mode: jobqueue.NormMode(""), Jobs: []wshrpc.JobQueueJob{}}, nil
	}
	data := JobQueueData(jobqueue.Default.Snapshot())
	return &data, nil
}

func (ws *WshServer) JobQueueRunNowCommand(ctx context.Context, data wshrpc.CommandJobQueueActData) error {
	if jobqueue.Default == nil || !jobqueue.Default.RunNow(data.Id) {
		return fmt.Errorf("no queued job %q to run now", data.Id)
	}
	return nil
}

func (ws *WshServer) JobQueueSkipCommand(ctx context.Context, data wshrpc.CommandJobQueueActData) error {
	if jobqueue.Default == nil || !jobqueue.Default.Skip(data.Id) {
		return fmt.Errorf("job %q is not a queued agent job that can be skipped", data.Id)
	}
	return nil
}

// splitTasks is a step's comma-joined task ids (jobqueue.Source.Tasks) as the wire's list; nil for none.
func splitTasks(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, ",")
}

// JobQueueData is the snapshot as the cockpit and the jobqueue event carry it: times in Unix ms, never a null
// job list.
func JobQueueData(s jobqueue.Snapshot) wshrpc.JobQueueData {
	out := wshrpc.JobQueueData{
		Slots:       s.Slots,
		Mode:        s.Mode,
		PausedUntil: unixMilli(s.PausedUntil),
		Jobs:        make([]wshrpc.JobQueueJob, 0, len(s.Jobs)),
		Bypassed:    s.Bypassed,
	}
	if s.Bypassed > 0 {
		out.LastBypass = &wshrpc.JobQueueBypass{
			Name:    s.LastBypass.Name,
			Ts:      unixMilli(s.LastBypass.At),
			BlockId: s.LastBypass.Source.BlockId,
			TabId:   s.LastBypass.Source.TabId,
		}
	}
	for _, j := range s.Jobs {
		out.Jobs = append(out.Jobs, wshrpc.JobQueueJob{
			Id:        j.Id,
			Name:      j.Name,
			Bytes:     j.Bytes,
			Measured:  j.Basis.Measured,
			Elsewhere: j.Basis.Elsewhere,
			Peaks:     basisPeaks(j.Basis),
			Running:   j.Running,
			Forced:    j.Forced,
			Engine:    j.Engine,
			Position:  j.Position,
			Reason:    j.Reason,
			QueuedTs:  unixMilli(j.QueuedAt),
			StartedTs: unixMilli(j.StartedAt),
			BlockId:   j.Source.BlockId,
			TabId:     j.Source.TabId,
			RunId:     j.Source.RunId,
			Label:     j.Source.Label,
			Protected: j.Protect,
			TaskIds:   splitTasks(j.Source.Tasks),
		})
	}
	return out
}

// basisPeaks is the basis's non-zero peaks, newest first; nil when there are none, so the field leaves the wire
func basisPeaks(b jobqueue.Basis) []uint64 {
	var out []uint64
	for _, p := range b.Peaks {
		if p > 0 {
			out = append(out, p)
		}
	}
	return out
}

func unixMilli(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}
