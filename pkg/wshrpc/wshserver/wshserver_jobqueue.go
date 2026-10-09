// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
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
		job, heavy := memgate.Classify(data.Command)
		q := jobqueue.Default
		if !heavy || job.LongRunning() || q == nil {
			send(wshrpc.JobSlotUpdate{Run: &yes})
			return
		}
		src := jobqueue.Source{BlockId: data.BlockId}
		if data.BlockId != "" {
			if tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId); err == nil {
				src.TabId = tabId
			}
		}
		slot, err := q.Acquire(ctx, jobqueue.Request{Name: job.Name, Bytes: job.Bytes, Source: src}, func(w jobqueue.Wait) {
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
		if !send(wshrpc.JobSlotUpdate{Run: &yes}) {
			return
		}
		select {
		case <-ctx.Done():
		case <-slot.Reclaimed():
			log.Printf("jobqueue: reclaimed %q (block %s) after %v", job.Name, data.BlockId, jobqueue.MaxHold)
		}
	}()
	return ch
}

func (ws *WshServer) GetJobQueueCommand(ctx context.Context) (*wshrpc.JobQueueData, error) {
	if jobqueue.Default == nil {
		return &wshrpc.JobQueueData{Slots: jobqueue.DefaultSlots, Jobs: []wshrpc.JobQueueJob{}}, nil
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

// JobQueueData is the snapshot as the cockpit and the jobqueue event carry it: times in Unix ms, never a null
// job list.
func JobQueueData(s jobqueue.Snapshot) wshrpc.JobQueueData {
	out := wshrpc.JobQueueData{Slots: s.Slots, Jobs: make([]wshrpc.JobQueueJob, 0, len(s.Jobs))}
	for _, j := range s.Jobs {
		out.Jobs = append(out.Jobs, wshrpc.JobQueueJob{
			Id:        j.Id,
			Name:      j.Name,
			Bytes:     j.Bytes,
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
		})
	}
	return out
}

func unixMilli(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}
