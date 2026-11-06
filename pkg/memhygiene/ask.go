// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"context"
	"fmt"
	"log"
	"slices"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// askNothing is the Review's ask reason when the judge changed nothing and gave no reason for it.
const askNothing = "nothing to change"

// askRuntimeFn names the runtime an ask runs on, after the claude fallback; tests set it, so no test
// reads the real config.
var askRuntimeFn = func() string {
	runtime, _ := modelRuntime()
	return runtime
}

// askMu guards askWorkers, and is held across the state write that marks an ask and the worker's
// check that nothing is left, so an ask marked as the worker stops always gets a worker.
var (
	askMu      sync.Mutex
	askWorkers = map[string]bool{} // project -> its ask worker runs
)

// StartAsk starts a one-memory judge call ("Ask an agent") on the Review changeID of project and
// returns at once; the answer lands in the project's state. One ask runs at a time per project: a
// second one waits behind it in AskWaiting.
func StartAsk(project, changeID string) error {
	if _, ok := registryFn()[project]; !ok {
		return fmt.Errorf("memory hygiene: %s is not a registered project", project)
	}
	askMu.Lock()
	defer askMu.Unlock()
	now := time.Now()
	_, err := Update(project, func(st *State) error {
		if st.Checking {
			return fmt.Errorf("memory hygiene: %s is being checked; ask an agent once the check is done", project)
		}
		i := entryFind(st, changeID)
		if i < 0 {
			return fmt.Errorf("memory hygiene: %s has no change %s", project, changeID)
		}
		c := &st.Changes[i]
		if c.Kind != reviewKind || c.Status != splitStatusOpen {
			return fmt.Errorf("memory hygiene: can't ask an agent about %q in %s: only an open review can be asked about", c.Title, project)
		}
		if !askLive(st, now) {
			// no ask runs, or its marker is stale: the stale one and the ids behind it read as failed
			st.Asking = &wshrpc.MemAsk{ChangeId: changeID, StartedAt: now.UnixMilli(), Runtime: askRuntimeFn()}
			st.AskWaiting = []string{}
		} else if st.Asking.ChangeId == changeID || slices.Contains(st.AskWaiting, changeID) {
			return fmt.Errorf("memory hygiene: %q in %s is already being asked about", c.Title, project)
		} else {
			st.AskWaiting = append(st.AskWaiting, changeID)
		}
		c.AskError = ""
		return nil
	})
	if err != nil {
		return err
	}
	if !askWorkers[project] {
		askWorkers[project] = true
		go askWorker(project)
	}
	return nil
}

// askLive reports whether an ask is marked and younger than the check timeout. An older marker is
// one a restart or a hang left behind.
func askLive(st *State, now time.Time) bool {
	return st.Asking != nil && now.Sub(time.UnixMilli(st.Asking.StartedAt)) < checkTimeout
}

// askRunning reports whether project's ask worker runs.
func askRunning(project string) bool {
	askMu.Lock()
	defer askMu.Unlock()
	return askWorkers[project]
}

// askWorker answers the project's asks one at a time, the marked one first, until none is left.
func askWorker(project string) {
	for {
		ask, ok := askNext(project)
		if !ok {
			return
		}
		if !askOneSafe(project, ask) {
			// the answer couldn't be stored, so the marker stays; stop rather than ask again in a loop
			askMu.Lock()
			delete(askWorkers, project)
			askMu.Unlock()
			return
		}
	}
}

// askNext is the ask to answer next, or false when there is none, in which case the worker is
// unregistered under the same lock StartAsk marks an ask under.
func askNext(project string) (wshrpc.MemAsk, bool) {
	askMu.Lock()
	defer askMu.Unlock()
	st, err := Load(project)
	if err != nil {
		log.Printf("memhygiene: reading the asks of %s: %v\n", project, err)
	}
	if err != nil || !askLive(st, time.Now()) {
		delete(askWorkers, project)
		return wshrpc.MemAsk{}, false
	}
	return *st.Asking, true
}

// askOneSafe answers one ask; a panic is recorded as that ask's error. It reports false when the
// answer couldn't be written to the state.
func askOneSafe(project string, ask wshrpc.MemAsk) (stored bool) {
	defer func() {
		if perr := panichandler.PanicHandler("memhygiene.ask", recover()); perr != nil {
			stored = askStore(project, ask, askResult{err: perr})
		}
	}()
	return askStore(project, ask, askOne(project, ask))
}

// askResult is what one ask came back with: a proposal, or nothing (with the judge's reason), or an
// error.
type askResult struct {
	m        Memory
	proposal *wshrpc.MemChange
	reason   string
	err      error
	skip     bool // the Review is no longer open, so nothing was asked
	ran      bool // the model was called; judgedBy is then the pane header's judged-by note
	judgedBy string
}

// askOne runs the judge on the one memory of the ask's Review, resolved as a check resolves it.
func askOne(project string, ask wshrpc.MemAsk) askResult {
	st, err := Load(project)
	if err != nil {
		return askResult{err: err}
	}
	i := entryFind(st, ask.ChangeId)
	if i < 0 || st.Changes[i].Kind != reviewKind || st.Changes[i].Status != splitStatusOpen {
		return askResult{skip: true}
	}
	review := st.Changes[i]
	if len(review.Op.Memories) != 1 {
		return askResult{err: fmt.Errorf("memory hygiene: review %q names %d memories, want one", review.Title, len(review.Op.Memories))}
	}
	name := review.Op.Memories[0]

	registry := registryFn()
	if _, ok := registry[project]; !ok {
		return askResult{err: fmt.Errorf("memory hygiene: %s is not a registered project", project)}
	}
	claudeHome := claudeHomeFn()
	resolved := Discover(registry, claudeHome)
	ri := slices.IndexFunc(resolved, func(r Resolved) bool { return r.Project == project })
	r := resolved[ri]
	if r.Skip != "" {
		return askResult{err: fmt.Errorf("memory hygiene: nothing to ask about in %s: %s", project, r.Skip)}
	}
	inv, err := checkInventory(review.Op.Folder, r, DefaultBranch(r.Path))
	if err != nil {
		return askResult{err: err}
	}
	mi := slices.IndexFunc(inv.Memories, func(m Memory) bool { return m.Name == name })
	if mi < 0 {
		return askResult{err: fmt.Errorf("memory hygiene: %s is no longer in %s", name, review.Op.Folder)}
	}
	m := inv.Memories[mi]
	docs := InstructionDocs(r.Path, claudeHome)
	docTarget := DocTarget(r.Path)

	ctx, cancel := context.WithTimeout(context.Background(), checkTimeout)
	defer cancel()
	_, judgedBy := modelRuntime()
	reply, err := runModel(ctx, judgePrompt(inv, []Memory{m}, docs, docTarget, true))
	if err != nil {
		return askResult{m: m, err: err, ran: true, judgedBy: judgedBy}
	}
	changes, fine, err := parseJudge(reply, inv, docTarget)
	if err != nil {
		return askResult{m: m, err: err, ran: true, judgedBy: judgedBy}
	}
	kept, _ := Validate(changes, map[string]*Inventory{inv.Folder: inv}, docs)
	// only a change on this memory answers the ask; the judge saw the rest of the index for context
	var mine []wshrpc.MemChange
	for _, c := range kept {
		if slices.Contains(c.Op.Memories, name) {
			mine = append(mine, c)
		}
	}
	if len(mine) > 0 {
		if len(mine) > 1 {
			log.Printf("memhygiene: the ask on %s in %s proposed %d changes; keeping the first\n", name, project, len(mine))
		}
		p := mine[0]
		p.Body = m.Body
		p.Verdict, p.DocLines = Reason(m, inv.Sessions, docs, false)
		if p.DocLines == nil {
			p.DocLines = []wshrpc.MemDocLine{}
		}
		return askResult{m: m, proposal: &p, ran: true, judgedBy: judgedBy}
	}
	reason := askNothing
	for _, f := range fine {
		if f.Memory == name && f.Reason != "" {
			reason = f.Reason
			break
		}
	}
	return askResult{m: m, reason: reason, ran: true, judgedBy: judgedBy}
}

// askStore writes one ask's answer onto its Review in one update, releases the ask's marker and marks
// the next waiting one. It reports false when the state couldn't be written.
func askStore(project string, ask wshrpc.MemAsk, res askResult) bool {
	now := time.Now()
	_, err := Update(project, func(st *State) error {
		// a fresh ask may have replaced a marker that went stale while this one ran; leave that one be
		if st.Asking != nil && st.Asking.ChangeId == ask.ChangeId && st.Asking.StartedAt == ask.StartedAt {
			st.Asking = nil
			if len(st.AskWaiting) > 0 {
				st.Asking = &wshrpc.MemAsk{ChangeId: st.AskWaiting[0], StartedAt: now.UnixMilli(), Runtime: askRuntimeFn()}
				st.AskWaiting = slices.Clone(st.AskWaiting[1:])
			} else {
				st.AskWaiting = []string{}
			}
		}
		if res.skip {
			return nil
		}
		if res.ran {
			st.JudgedBy = res.judgedBy
		}
		i := entryFind(st, ask.ChangeId)
		if i < 0 || st.Changes[i].Kind != reviewKind || st.Changes[i].Status != splitStatusOpen {
			// the Review was decided while the agent ran: the person's verdict stands
			log.Printf("memhygiene: the review %s in %s was decided during its ask; dropping the answer\n", ask.ChangeId, project)
			return nil
		}
		switch {
		case res.err != nil:
			st.Changes[i].AskError = res.err.Error()
		case res.proposal != nil:
			return askStoreProposal(st, i, *res.proposal, now)
		default:
			r := &st.Changes[i]
			r.AskReason, r.AskedAt, r.AskedBy, r.AskError = res.reason, now.UnixMilli(), ask.Runtime, ""
			// judged beside the same docs as a check would, so the hash gate skips it until it changes
			if st.Seen == nil {
				st.Seen = map[string]string{}
			}
			st.Seen[res.m.Name] = checkFingerprint(res.m)
		}
		return nil
	})
	if err != nil {
		log.Printf("memhygiene: storing the ask on %s in %s: %v\n", ask.ChangeId, project, err)
		return false
	}
	return true
}

// askStoreProposal stores the agent's proposal as an open change that takes the place of the Review at
// st.Changes[i]. Seen is left alone: the memory still has a change to decide.
func askStoreProposal(st *State, i int, p wshrpc.MemChange, now time.Time) error {
	p.Source, p.ProposedAt, p.Status = checkSourceAgent, now.UnixMilli(), splitStatusOpen
	// a judge change with the same id (same kind, same files at the same hashes) is replaced, unless it
	// was applied, in which case the memory it acts on is already gone
	j := entryFind(st, p.Id)
	switch {
	case j >= 0 && st.Changes[j].Status == checkStatusApplied:
		st.Changes[i].AskError = fmt.Sprintf("memory hygiene: the agent proposed %q, which is already applied", p.Title)
		return nil
	case j >= 0:
		st.Changes[j] = p
	default:
		st.Changes = append(st.Changes, p)
		j = len(st.Changes) - 1
	}
	// both pointers taken after the append, which can move the slice
	entrySupersede(st, &st.Changes[i], &st.Changes[j])
	return nil
}
