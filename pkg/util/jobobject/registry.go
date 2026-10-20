// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"context"
	"errors"
	"log"
	"sync"
)

const (
	OwnerKind_Block  = "block"  // a block shell: agent tab or run worker
	OwnerKind_RunCmd = "runcmd" // an engine plan command
)

type Owner struct {
	Kind string // OwnerKind_*
	Id   string // block id, or the run id that owns the dag
	Cmd  string // run commands: "Setup" | "Verify" | "Check" | "Final"
	Task string // run commands at a task's merge: the task id; else ""
}

type LiveJob struct {
	Owner   Owner
	RootPid int
	Members []int // pids currently in the job
}

var (
	ErrNotMember = errors.New("not a member of the job") // includes: no live job for that owner
	ErrGone      = errors.New("process has already exited")
	// a job object above the caller does not allow breakaway: an arcterm from before BREAKAWAY_OK, or another app's job
	ErrBreakawayDenied = errors.New("a job object above this process does not allow breakaway")
)

type ownerCtxKey struct{}

func WithOwner(ctx context.Context, o Owner) context.Context {
	return context.WithValue(ctx, ownerCtxKey{}, o)
}

func OwnerFrom(ctx context.Context) (Owner, bool) {
	o, ok := ctx.Value(ownerCtxKey{}).(Owner)
	return o, ok
}

type regEntry struct {
	owner   Owner
	rootPid int
	// disarmed: the job holds a kept desktop app, so closing it no longer kills (WatchKeptApps)
	disarmed bool
}

// the lock is held across every use of a registered handle, so Close (which unregisters first)
// can never close a handle that LiveJobs or TerminateMember is querying.
var registry = struct {
	mu   sync.Mutex
	jobs map[uintptr]regEntry
}{jobs: make(map[uintptr]regEntry)}

// Register records job (already attached to the process rootPid) as owned by o.
func Register(job uintptr, rootPid int, o Owner) {
	if job == 0 || !jobsSupported {
		return
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	registry.jobs[job] = regEntry{owner: o, rootPid: rootPid}
}

func unregister(job uintptr) {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	delete(registry.jobs, job)
}

// LiveJobs queries every registered job's members under the registry lock. nil off Windows.
func LiveJobs() []LiveJob {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	var rtn []LiveJob
	for job, e := range registry.jobs {
		members, err := Members(job)
		if err != nil {
			log.Printf("jobobject: members of job (root pid %d, owner %s %s): %v", e.rootPid, e.owner.Kind, e.owner.Id, err)
			continue
		}
		rtn = append(rtn, LiveJob{Owner: e.owner, RootPid: e.rootPid, Members: members})
	}
	return rtn
}

// anyOwnedJob reports whether match holds for some job registered for o, under the registry lock.
func anyOwnedJob(o Owner, match func(job uintptr) (bool, error)) (bool, error) {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	for job, e := range registry.jobs {
		if e.owner != o {
			continue
		}
		ok, err := match(job)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}
