// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"context"
	"log"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// A judge arcterm launched for a job rests once its newest pair has ended: the round is over, the judge sleeps, and it
// leaves the tree until ⚖ under a reply wakes it for the next round. Who rests is worked out once, from every pair file, when
// the manager first loads, and kept up to date as pairs end and judges join: a tab's newest pair is all it needs, so the
// index holds that and not the ended pairs.

// tabLast is the newest pair a tab took part in, as a worker or as a judge.
type tabLast struct {
	pairId    string
	createdTs int64
	ended     bool
	resting   bool   // the tab is a launched judge of that pair that is not gone
	name      string // the judge's name as the roster gave it when it joined
	workerTab string
}

// olderThan reports whether the record is of a pair made before p, or of p itself (the pair id breaks a tie), so p's
// state is the one the tab's record should hold.
func (l tabLast) olderThan(p *Pair) bool {
	if p.CreatedTs != l.createdTs {
		return l.createdTs < p.CreatedTs
	}
	return l.pairId <= p.Id
}

// indexLocked records p as the newest pair of each of its sides, unless a newer pair already holds the tab. It runs for
// every pair the manager reads and after every change to one, so what it holds is always a function of the pairs. The
// lock is held.
func (m *Manager) indexLocked(p *Pair) {
	if m.last == nil {
		m.last = map[string]tabLast{}
	}
	note := func(tab, name string, resting bool) {
		if cur, ok := m.last[tab]; ok && !cur.olderThan(p) {
			return
		}
		m.last[tab] = tabLast{
			pairId: p.Id, createdTs: p.CreatedTs, ended: p.State == StateEnded, resting: resting, name: name, workerTab: p.Worker.Tab,
		}
	}
	note(p.Worker.Tab, p.Worker.Name, false)
	for _, j := range p.Judges {
		note(j.Tab, j.Name, j.Launched && !j.Gone)
	}
}

// roundEnd is what a round's end leaves to do once the pair is saved: tell the working agent what it may run, and put the
// launched judges to sleep. Both go through the link, so they run outside the lock.
type roundEnd struct {
	pairId string
	worker string
	mayRun []string
	judges []string // the tabs of the live judges the pair launched
}

// endRound ends a pair because the person went back to the working agent: a line says why, and the pair is ended (the
// caller saves it and, by change, takes it out of the index). The held commands the working agent may run now are taken
// before the pair ends, as Unpair takes them. The lock is held.
func (m *Manager) endRound(p *Pair) *roundEnd {
	e := &roundEnd{pairId: p.Id, worker: p.Worker.Tab, mayRun: notLetThrough(p)}
	for _, j := range liveJudges(p) {
		if j.Launched {
			e.judges = append(e.judges, j.Tab)
		}
	}
	m.addSystem(p, RoundEndedLine)
	p.State = StateEnded
	return e
}

// afterRound tells the working agent what it may run, then puts each launched judge to sleep. A failed step is logged and
// the next still runs.
func (m *Manager) afterRound(ctx context.Context, e *roundEnd) {
	if err := m.tellMayRun(ctx, e.worker, e.mayRun); err != nil {
		log.Printf("pair %s: the round ended: %v\n", e.pairId, err)
	}
	for _, tab := range e.judges {
		m.restJudge(ctx, e.pairId, tab)
	}
}

// restJudge puts a launched judge to rest when its round ends: at once when it is idle, never when it is asleep already,
// and at its next turn end when it is working or asking the person (sleepOnIdle). The judge goes into the set before
// its state is read, so a turn end that comes between the two still finds it there.
func (m *Manager) restJudge(ctx context.Context, pairId, tab string) {
	m.mu.Lock()
	m.sleepOnIdle[tab] = true
	m.mu.Unlock()
	state, err := m.Link.State(ctx, tab)
	if err != nil {
		log.Printf("pair %s: the round ended, and the state of judge %s is unknown: %v\n", pairId, tab, err) // its next turn end sleeps it
		return
	}
	if state == LinkWorking || state == LinkAsking {
		return
	}
	m.mu.Lock()
	mine := m.sleepOnIdle[tab] // false: a turn end took the request while the state was read, and sleeps it
	delete(m.sleepOnIdle, tab)
	m.mu.Unlock()
	if mine && state == LinkIdle {
		m.sleepJudge(ctx, tab)
	}
}

// sleepJudge puts a judge to sleep now. A refusal (it is not idle after all, background work runs) or a failure is
// logged and the judge stays awake, shown as a plain agent.
func (m *Manager) sleepJudge(ctx context.Context, tab string) {
	if err := m.Link.Sleep(ctx, tab); err != nil {
		log.Printf("pair: the round ended, but judge %s was not put to sleep: %v\n", tab, err)
	}
}

// Resting is the launched judges whose newest pair has ended, grouped by their working agent's tab; within one worker the
// judge of the newest ended pair comes first (the frontend takes a worker's first entry as the judge ⚖ under a reply wakes),
// and judges of one pair, or of pairs made in the same millisecond, go by their own tab. So the order is the same on
// every call and after a restart. A tab that is in a pair that is not ended is never listed, whatever its records say.
func (m *Manager) Resting() []wshrpc.PairResting {
	m.lock()
	defer m.mu.Unlock()
	type entry struct {
		wshrpc.PairResting
		createdTs int64 // of the pair it rests from: the wire type does not carry it
	}
	entries := []entry{}
	for tab, l := range m.last {
		if !l.ended || !l.resting {
			continue
		}
		if p, _ := m.pairOf(tab); p != nil {
			continue
		}
		entries = append(entries, entry{
			PairResting: wshrpc.PairResting{Tab: tab, Name: l.name, WorkerTab: l.workerTab, PairId: l.pairId},
			createdTs:   l.createdTs,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.WorkerTab != b.WorkerTab {
			return a.WorkerTab < b.WorkerTab
		}
		if a.createdTs != b.createdTs {
			return a.createdTs > b.createdTs
		}
		return a.Tab < b.Tab
	})
	rest := make([]wshrpc.PairResting, len(entries))
	for i, e := range entries {
		rest[i] = e.PairResting
	}
	return rest
}
