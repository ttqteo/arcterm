// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"context"
	"errors"
	"log"
	"slices"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var refused = wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Refused}

// ownerJobs reads the live jobs of a block owner afresh. ok is false when there is none or its kind is
// read-only (a run command or Arc itself is never killed through here).
func ownerJobs(ctx context.Context, resolve Resolver, ownerId string) ([]jobobject.LiveJob, OwnerInfo, bool) {
	var jobs []jobobject.LiveJob
	for _, j := range jobobject.LiveJobs() {
		if j.Owner.Kind == jobobject.OwnerKind_Block && j.Owner.Id == ownerId {
			jobs = append(jobs, j)
		}
	}
	if len(jobs) == 0 {
		return nil, OwnerInfo{}, false
	}
	info := resolve(ctx, jobs[0].Owner)
	return jobs, info, isKillable(info.Kind)
}

// jobLayout is a fresh read of one job: its members' tree and which of them are core.
type jobLayout struct {
	rows []treeRow
	core map[int]string
}

func readLayout(table map[int]proc, j jobobject.LiveJob, agent bool) jobLayout {
	procs := map[int]proc{}
	var members []int
	for _, m := range j.Members {
		if p, ok := table[m]; ok {
			p.CreateTs = readStat(m).createTs
			procs[m] = p
			members = append(members, m)
		}
	}
	return jobLayout{rows: jobTree(procs, members, j.RootPid), core: coreTags(procs, members, j.RootPid, agent)}
}

// deepestFirst orders rows so every process goes before its ancestors.
func deepestFirst(rows []treeRow) []treeRow {
	rows = slices.Clone(rows)
	slices.SortStableFunc(rows, func(a, b treeRow) int { return b.Depth - a.Depth })
	return rows
}

// subtree is the rows below pid in a pre-order tree.
func subtree(rows []treeRow, pid int) []treeRow {
	for i, r := range rows {
		if r.Pid != pid {
			continue
		}
		end := i + 1
		for end < len(rows) && rows[end].Depth > r.Depth {
			end++
		}
		return rows[i+1 : end]
	}
	return nil
}

// terminateAll terminates rows that are not core, deepest first, and counts the terminations.
func terminateAll(o jobobject.Owner, rows []treeRow, core map[int]string) int {
	n := 0
	for _, r := range deepestFirst(rows) {
		if core[r.Pid] != "" {
			continue
		}
		err := jobobject.TerminateMember(o, r.Pid)
		if err == nil {
			n++
		} else if !errors.Is(err, jobobject.ErrGone) && !errors.Is(err, jobobject.ErrNotMember) {
			log.Printf("resmon: terminating pid %d of %s %s: %v", r.Pid, o.Kind, o.Id, err)
		}
	}
	return n
}

// osText is the OS's own message for a failed termination, without the call that wraps it.
func osText(err error) string {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return errno.Error()
	}
	return err.Error()
}

// Kill terminates one process of a killable owner's job, and with Tree its descendants in that job. A core
// process is protected; a pid that is no longer a member (it exited, or the pid was reused) is never hit.
func Kill(ctx context.Context, resolve Resolver, data wshrpc.CommandResMonKillData) wshrpc.ResMonKillRtnData {
	pid := int(data.Pid)
	jobs, info, ok := ownerJobs(ctx, resolve, data.OwnerId)
	if !ok {
		return refused
	}
	idx := slices.IndexFunc(jobs, func(j jobobject.LiveJob) bool { return slices.Contains(j.Members, pid) })
	if idx < 0 {
		// not a member at the fresh read: the probe tells gone from a stranger and terminates only a member
		// that joined since, which cannot be core
		switch err := jobobject.TerminateMember(jobs[0].Owner, pid); {
		case err == nil:
			return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Killed, Killed: 1}
		case errors.Is(err, jobobject.ErrGone):
			return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Gone}
		default:
			return refused
		}
	}
	job := jobs[idx]
	table, err := readTable()
	if err != nil {
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Failed, Error: err.Error()}
	}
	layout := readLayout(table, job, info.Agent)
	if layout.core[pid] != "" {
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Protected}
	}
	killed := 0
	if data.Tree {
		killed = terminateAll(job.Owner, subtree(layout.rows, pid), layout.core)
	}
	switch err := jobobject.TerminateMember(job.Owner, pid); {
	case err == nil:
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Killed, Killed: killed + 1}
	case errors.Is(err, jobobject.ErrGone):
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Gone, Killed: killed}
	case errors.Is(err, jobobject.ErrNotMember):
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Refused, Killed: killed}
	default:
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Failed, Killed: killed, Error: osText(err)}
	}
}

// KillChildren terminates every member of a killable owner's jobs except their core.
func KillChildren(ctx context.Context, resolve Resolver, data wshrpc.CommandResMonKillChildrenData) wshrpc.ResMonKillRtnData {
	jobs, info, ok := ownerJobs(ctx, resolve, data.OwnerId)
	if !ok {
		return refused
	}
	table, err := readTable()
	if err != nil {
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Failed, Error: err.Error()}
	}
	killed := 0
	for _, j := range jobs {
		layout := readLayout(table, j, info.Agent)
		killed += terminateAll(j.Owner, layout.rows, layout.core)
	}
	return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Killed, Killed: killed}
}
