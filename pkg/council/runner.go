// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Runner runs councils: the three rounds, the pause, the person's replies and follow-ups, retry and stop. Every
// entry point that starts work (Start, StartSaved, Continue, Reply, Summarize, Retry) saves the council as running
// and returns it at once; the calls run in a goroutine, and Wait or the OnChange events say when they end. A council
// has at most one such goroutine at a time. Every change goes through the store's package Update.
//
// One council runs at a time, across every project: a council that Start or StartSaved is asked to start while a run
// is on is saved queued, and starts by itself when the runs end (StartNext, which a run's end calls). A council that
// waits on the person holds no slot, and the person's own actions (Continue, a reply or follow-up, Retry, Summarize)
// run at once and are never queued.
//
// A Runner must not be copied after first use.
type Runner struct {
	Caller Caller
	// Agents is the caller for the seats with Agent set, an AgentCaller over the live agents; Caller serves the rest.
	Agents Caller
	// OnChange is told after each save, with the council as saved. It may be called from several goroutines at once, and
	// the council is the callee's to read, not to change.
	OnChange func(c *Council)
	// Now is the clock in milliseconds; nil is the wall clock.
	Now func() int64

	mu     sync.Mutex // guards active and the queue, and orders a reply against the end of a run
	active map[string]*run
	// routing holds one channel per reply whose router call is in flight, keyed councilId + "/" + replyId and closed when
	// the pick is saved: a pass that finds the reply still pending waits on it rather than make a second call. Guarded by
	// mu, and made on first use.
	routing map[string]chan struct{}
}

const (
	actStarting = "Starting"
	actSummary  = "Writing the summary"
	actPerson   = "Replying to the person"

	// maxPasses stops a run whose answers passes in a row answer none of the person's replies, which only a store that
	// cannot save can cause. A pass that answers some starts the count again, so a person who keeps posting while the
	// passes run is never left with a reply nobody answers.
	maxPasses = 8

	stopWait = 15 * time.Second
	errMax   = 400 // runes of an error kept on the council
)

// run is the goroutine that works on one council, and the clocks of the calls it has in flight.
type run struct {
	cancel context.CancelFunc
	done   chan struct{} // closed after the run saved its last state and left Runner.active

	mu    sync.Mutex
	calls map[string]callClock // expert id -> its call in flight
}

// callClock times one call: when it began, and the expert's Stats.Ms before it.
type callClock struct{ start, base int64 }

func (rn *run) begin(expertId string, k callClock) {
	rn.mu.Lock()
	defer rn.mu.Unlock()
	rn.calls[expertId] = k
}

func (rn *run) end(expertId string) (callClock, bool) {
	rn.mu.Lock()
	defer rn.mu.Unlock()
	k, ok := rn.calls[expertId]
	delete(rn.calls, expertId)
	return k, ok
}

// refresh brings the time spent of every call still in flight up to now, so each save shows the Running board's clocks.
func (rn *run) refresh(c *Council, now int64) {
	if rn == nil {
		return
	}
	rn.mu.Lock()
	defer rn.mu.Unlock()
	for id, k := range rn.calls {
		st := c.Stats[id]
		st.Ms = k.base + max(0, now-k.start)
		setStat(c, id, st)
	}
}

// ending is how a run leaves the council: the fields it ends with, and whether the person's open replies are
// answered first. heldRound is set when it leaves the council waiting on held drafts: the round they belong to, so that
// drive can tell that the person settled them all meanwhile and go on to the next round instead.
type ending struct {
	set       func(c *Council)
	answers   bool
	heldRound int
}

// work is what a run does; it returns how the council ends. A run whose ctx was cancelled ends stopped whatever it
// returns.
type work func(ctx context.Context, rn *run, id string) ending

// prevState is what a council was before a job that hands it back as it found it: Summarize, a follow-up, a retry.
type prevState struct {
	state CouncilState
	round int
	err   string
}

func (p prevState) restore(c *Council) { c.State, c.Round, c.Error = p.state, p.round, p.err }

func prevOf(c *Council) prevState { return prevState{c.State, c.Round, c.Error} }

var errSkip = errors.New("nothing to save")

func (r *Runner) now() int64 {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now().UnixMilli()
}

func (r *Runner) changed(c *Council) {
	if c != nil && r.OnChange != nil {
		r.OnChange(c)
	}
}

func busy(id string) error { return fmt.Errorf("council %s is running", id) }

// update loads the council, applies fn, refreshes the clocks of the calls in flight, saves, and reports the save.
func (r *Runner) update(rn *run, id string, fn func(c *Council) error) (*Council, error) {
	c, err := Update(id, func(c *Council) error {
		if fn != nil {
			if err := fn(c); err != nil {
				return err
			}
		}
		rn.refresh(c, r.now())
		return nil
	})
	if err != nil {
		return nil, err
	}
	r.changed(c)
	return c, nil
}

func (r *Runner) updateLogged(rn *run, id string, fn func(c *Council) error) {
	if _, err := r.update(rn, id, fn); err != nil {
		log.Printf("[council] %s: save failed: %v", id, err)
	}
}

func setStat(c *Council, id string, st CouncilExpertStat) {
	if c.Stats == nil {
		c.Stats = map[string]CouncilExpertStat{}
	}
	c.Stats[id] = st
}

func setActivity(c *Council, id string, a CouncilActivity) {
	if c.Activity == nil {
		c.Activity = map[string]CouncilActivity{}
	}
	c.Activity[id] = a
}

func setFailed(c *Council, id string, f CouncilFailure) {
	if c.Failed == nil {
		c.Failed = map[string]CouncilFailure{}
	}
	c.Failed[id] = f
}

// panelOf are the experts that propose and review: all but the coordinator, in the council's order.
func panelOf(c *Council) []CouncilExpert {
	out := make([]CouncilExpert, 0, len(c.Experts))
	for _, e := range c.Experts {
		if !e.Coordinator {
			out = append(out, e)
		}
	}
	return out
}

// routeCandidates are the seats the router may pick for a whole-council message: the panel's, in panel order, less any
// seat whose call failed (it cannot answer), and so never the coordinator.
func routeCandidates(c *Council) []CouncilExpert {
	out := make([]CouncilExpert, 0, len(c.Experts))
	for _, e := range panelOf(c) {
		if _, failed := c.Failed[e.Id]; !failed {
			out = append(out, e)
		}
	}
	return out
}

func idsOf(experts []CouncilExpert) []string {
	out := make([]string, 0, len(experts))
	for _, e := range experts {
		out = append(out, e.Id)
	}
	return out
}

func forEachExpert(experts []CouncilExpert, fn func(e CouncilExpert)) {
	var wg sync.WaitGroup
	for _, e := range experts {
		wg.Go(func() { fn(e) })
	}
	wg.Wait()
}

// errText is an error as the council keeps it: one trimmed run of text, not a stderr dump.
func errText(err error) string {
	s := strings.Join(strings.Fields(err.Error()), " ")
	if r := []rune(s); len(r) > errMax {
		s = string(r[:errMax]) + "…"
	}
	return s
}

func emptyReply(res CallRes) error {
	if strings.TrimSpace(res.Text) == "" {
		return errors.New("the call returned an empty reply")
	}
	return nil
}

// ---- starting ----

// The harnesses whose live sessions `wsh agents` reaches: the only ones that can take a seat.
const (
	HarnessClaude = "claude"
	HarnessPi     = "pi"
)

func validateCouncil(c *Council) error {
	if strings.TrimSpace(c.Feature) == "" {
		return errors.New("a council needs a feature to review")
	}
	if strings.TrimSpace(c.Project) == "" {
		return errors.New("a council needs a project folder")
	}
	if c.Mode != "" && c.Mode != ModeReview && c.Mode != ModeBrainstorm {
		return fmt.Errorf("unknown council mode %q: use %s or %s", c.Mode, ModeReview, ModeBrainstorm)
	}
	if c.Rounds < 0 || c.Rounds > MaxRounds {
		return fmt.Errorf("a council runs 1 to %d rounds, not %d", MaxRounds, c.Rounds)
	}
	seen, agents := map[string]bool{}, map[string]bool{}
	coordinators, panel := 0, 0
	for _, e := range c.Experts {
		switch {
		case strings.TrimSpace(e.Id) == "":
			return errors.New("every expert needs an id")
		case e.Id == YouId:
			return fmt.Errorf("%q is the person's id, not an expert's", YouId)
		case seen[e.Id]:
			return fmt.Errorf("expert %q is listed twice", e.Id)
		}
		seen[e.Id] = true
		if IsAgent(e) {
			switch {
			case e.Coordinator:
				return fmt.Errorf("%q is an agent, and an agent cannot be the coordinator", e.Name)
			case agents[e.Agent]:
				return fmt.Errorf("agent %q sits in the council twice", e.Agent)
			case e.Harness != HarnessClaude && e.Harness != HarnessPi:
				return fmt.Errorf("agent %q runs %q: only a %s or %s agent can take a seat", e.Name, e.Harness, HarnessClaude, HarnessPi)
			}
			agents[e.Agent] = true
		}
		if e.Coordinator {
			coordinators++
		} else {
			panel++
		}
	}
	if coordinators != 1 {
		return fmt.Errorf("a council needs one coordinator, not %d", coordinators)
	}
	if panel == 0 {
		return errors.New("a council needs at least one expert besides the coordinator")
	}
	return nil
}

// stampNew gives a council that is about to be saved for the first time its id and times, and empties everything
// a run fills in.
func (r *Runner) stampNew(c *Council) {
	if c.Id == "" {
		c.Id = NewId()
	}
	if c.Created == 0 {
		c.Created = r.now()
	}
	c.Proposals, c.Replies, c.Summary = nil, nil, nil
	c.Activity, c.Failed, c.Skips, c.Stats = nil, nil, nil, nil
	c.Tokens, c.Calls, c.Started, c.Error = 0, 0, 0, ""
	c.RanMs, c.RunStarted = 0, 0
}

// beginRun marks where a run (a council's rounds, or a follow-up: a reply, Continue, Summarize, Retry) begins; its
// span goes into RanMs when it ends. Every persist given to launchLocked calls it, beginFresh for the rounds.
func (r *Runner) beginRun(c *Council) { c.RunStarted = r.now() }

// endRun adds the span of the run that ends to RanMs, so RanMs counts the time rounds ran and not the time the
// council rested between them.
func endRun(c *Council, now int64) {
	if c.RunStarted > 0 {
		c.RanMs += max(0, now-c.RunStarted)
	}
	c.RunStarted = 0
}

// beginFresh is where a council's run begins, whether Start, StartSaved or the queue starts it, so it is where the
// council records the harness it runs under, and where Rounds, which only a council with agents honours, is cleared from
// one without: it runs today's two rounds. It is also where the draft mode is taken: cleared and frozen again from the
// seats the council has now, so a re-run of a saved council takes the mode its seats give at that start.
func (r *Runner) beginFresh(c *Council) {
	c.State, c.Round, c.Started, c.Error = StateRunning, 1, r.now(), ""
	r.beginRun(c)
	c.Harness = HarnessVersion
	c.DraftMode = ""
	freezeDraftMode(c)
	if !HasAgents(c) {
		c.Rounds = 0
	}
}

// absent is nil when nothing is saved under id yet.
func absent(id string) error {
	_, err := Load(id)
	switch {
	case err == nil:
		return fmt.Errorf("council %s already exists", id)
	case errors.Is(err, fs.ErrNotExist):
		return nil
	}
	return err
}

// Record saves a council as not-run and calls nothing: the gate refused it, and its Discussion offers Start council.
func (r *Runner) Record(c *Council) (*Council, error) {
	if err := validateCouncil(c); err != nil {
		return nil, err
	}
	cp := *c
	r.stampNew(&cp)
	cp.State, cp.Round = StateNotRun, 0
	if err := absent(cp.Id); err != nil {
		return nil, err
	}
	if err := Save(&cp); err != nil {
		return nil, err
	}
	r.changed(&cp)
	return &cp, nil
}

// Start saves a new council as running and runs its rounds in the background: round 1, then, unless the council
// pauses, rounds 2 and 3. It returns the saved council at once. While another council runs, in any project, the new
// one is saved queued instead (QueuedAfter names the council that runs) and starts when the runs end. Cancelling ctx
// stops a council that started at once as Stop does; a caller that wants it to outlive the request passes a
// background context. A council that was queued starts on a background context.
func (r *Runner) Start(ctx context.Context, c *Council) (*Council, error) {
	if r.Caller == nil {
		return nil, errors.New("the council runner has no caller")
	}
	if err := validateCouncil(c); err != nil {
		return nil, err
	}
	cp := *c
	r.stampNew(&cp)
	if err := absent(cp.Id); err != nil {
		return nil, err
	}
	r.mu.Lock()
	var (
		saved *Council
		start func()
		err   error
	)
	after := r.waitsOnLocked()
	if after != "" {
		cp.State, cp.Round, cp.QueuedAfter, cp.Started, cp.Error = StateQueued, 0, after, 0, ""
		if err = Save(&cp); err == nil {
			saved = &cp
		}
	} else {
		saved, start, err = r.launchLocked(ctx, cp.Id, func() (*Council, error) {
			r.beginFresh(&cp)
			if err := Save(&cp); err != nil {
				return nil, err
			}
			return &cp, nil
		}, r.roundsWork(1))
	}
	var next pumped
	if err == nil && after != "" {
		next = r.pumpLocked() // a queue left behind with nothing running starts here
	}
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	if start != nil {
		start()
	}
	next.fire(r)
	return saved, nil
}

// StartSaved runs a council saved as not-run, as Start does, or queues it while another council runs.
func (r *Runner) StartSaved(ctx context.Context, id string) (*Council, error) {
	if r.Caller == nil {
		return nil, errors.New("the council runner has no caller")
	}
	r.mu.Lock()
	cur, err := Load(id)
	if err == nil && cur.State != StateNotRun {
		err = fmt.Errorf("council %s is %s: only a council that has not run can be started", id, cur.State)
	}
	if err == nil {
		err = validateCouncil(cur)
	}
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	var (
		saved *Council
		start func()
	)
	after := r.waitsOnLocked()
	if after != "" {
		saved, err = Update(id, func(c *Council) error {
			// the queue is first come first served by Created, so a council saved earlier takes its place in line now
			c.State, c.Round, c.QueuedAfter, c.Error, c.Created = StateQueued, 0, after, "", r.now()
			return nil
		})
	} else {
		saved, start, err = r.launchLocked(ctx, id, func() (*Council, error) {
			return Update(id, func(c *Council) error {
				r.beginFresh(c)
				return nil
			})
		}, r.roundsWork(1))
	}
	var next pumped
	if err == nil && after != "" {
		next = r.pumpLocked()
	}
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	if start != nil {
		start()
	}
	next.fire(r)
	return saved, nil
}

// ---- the queue ----

// holderLocked is the id of the council whose run holds the one slot, "" when no run is on. The person's own actions
// (a follow-up, Continue, Retry, Summarize) are runs too, so they hold it while they work. When several runs are on at
// once the oldest council is the holder, so the answer does not depend on map order.
func (r *Runner) holderLocked() string {
	best, bestCreated := "", int64(0)
	for id := range r.active {
		created := int64(0)
		if c, err := Load(id); err == nil {
			created = c.Created
		}
		if best == "" || created < bestCreated || (created == bestCreated && id < best) {
			best, bestCreated = id, created
		}
	}
	return best
}

// queuedCouncils are the councils saved queued, in the order they were asked to start (Created, then id).
func queuedCouncils() []*Council {
	list, err := List("")
	if err != nil {
		log.Printf("[council] the queue could not be read: %v", err)
		return nil
	}
	var out []*Council
	for _, c := range list {
		if c.State == StateQueued {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Created != out[j].Created {
			return out[i].Created < out[j].Created
		}
		return out[i].Id < out[j].Id
	})
	return out
}

// waitsOnLocked is the council that a council asked to start now has to wait for, "" when it can start at once: the
// council that runs; else the last one already queued, because the queue is first come first served and a council
// must not jump ahead of those waiting (a queue left behind with nothing running is started by the pump).
func (r *Runner) waitsOnLocked() string {
	if id := r.holderLocked(); id != "" {
		return id
	}
	if q := queuedCouncils(); len(q) > 0 {
		return q[len(q)-1].Id
	}
	return ""
}

// pumped is what the queue did while the caller held r.mu: the councils it saved, to be reported once the lock is
// let go, and the func that starts the run it launched.
type pumped struct {
	saved []*Council
	start func()
}

func (p pumped) fire(r *Runner) {
	for _, c := range p.saved {
		r.changed(c)
	}
	if p.start != nil {
		p.start()
	}
}

// pumpLocked starts the oldest queued council when no run is on, and points the councils still queued at it. It does
// nothing while a run holds the slot, so a run that ends while another goes on starts nobody. A queued council that
// can no longer start is saved failed with the reason, rather than left to block the line.
func (r *Runner) pumpLocked() (p pumped) {
	if r.Caller == nil || r.holderLocked() != "" {
		return p
	}
	for _, q := range queuedCouncils() {
		if err := validateCouncil(q); err != nil {
			failed, ferr := Update(q.Id, func(c *Council) error {
				if c.State != StateQueued {
					return errSkip
				}
				c.State, c.Round, c.QueuedAfter, c.Error = StateFailed, 0, "", "could not start from the queue: "+errText(err)
				return nil
			})
			if ferr == nil {
				p.saved = append(p.saved, failed)
			}
			continue
		}
		saved, start, err := r.launchLocked(context.Background(), q.Id, func() (*Council, error) {
			return Update(q.Id, func(c *Council) error {
				if c.State != StateQueued { // stopped while it waited
					return errSkip
				}
				r.beginFresh(c)
				c.QueuedAfter = ""
				return nil
			})
		}, r.roundsWork(1))
		switch {
		case err == nil:
			p.saved, p.start = append(p.saved, saved), start
			for _, rest := range queuedCouncils() {
				if repointed, err := Update(rest.Id, func(c *Council) error {
					if c.State != StateQueued {
						return errSkip
					}
					c.QueuedAfter = q.Id
					return nil
				}); err == nil {
					p.saved = append(p.saved, repointed)
				}
			}
			return p
		case errors.Is(err, errSkip):
		default:
			log.Printf("[council] %s: not started from the queue: %v", q.Id, err)
		}
	}
	return p
}

// StartNext starts the oldest queued council when no run is on. A run's end calls it, and wavesrv calls it once at
// startup after MarkStale, for a council that was queued when arcterm last quit.
func (r *Runner) StartNext() {
	r.mu.Lock()
	next := r.pumpLocked()
	r.mu.Unlock()
	next.fire(r)
}

// saveDocument writes the document of a council that ended done or stopped into its project and keeps the path on the
// council; it returns the council as saved. A project folder that is not there is not created for it, and a write
// that fails is logged: the council ends all the same. A bench council saves none: a later bench council on the same
// project would read it.
func (r *Runner) saveDocument(c *Council) *Council {
	if c == nil || c.Bench || (c.State != StateDone && c.State != StateStopped) {
		return c
	}
	if info, err := os.Stat(c.Project); err != nil || !info.IsDir() {
		log.Printf("[council] %s: document not saved: the project folder %q is not there", c.Id, c.Project)
		return c
	}
	path, err := WriteDocument(c, "")
	if err != nil {
		log.Printf("[council] %s: document not saved: %v", c.Id, err)
		return c
	}
	if path == c.DocPath {
		return c
	}
	saved, err := Update(c.Id, func(c *Council) error {
		c.DocPath = path
		return nil
	})
	if err != nil {
		log.Printf("[council] %s: document path not kept: %v", c.Id, err)
		return c
	}
	r.changed(saved)
	return saved
}

// launchLocked registers a run for id, saves the council as running through persist, and returns the council with the
// func that starts the goroutine. The caller holds r.mu, unlocks it, reports the save, and then calls start.
func (r *Runner) launchLocked(parent context.Context, id string, persist func() (*Council, error), w work) (*Council, func(), error) {
	if r.active[id] != nil {
		return nil, nil, busy(id)
	}
	ctx, cancel := context.WithCancel(parent)
	rn := &run{cancel: cancel, done: make(chan struct{}), calls: map[string]callClock{}}
	if r.active == nil {
		r.active = map[string]*run{}
	}
	r.active[id] = rn
	c, err := persist()
	if err != nil {
		delete(r.active, id)
		cancel()
		return nil, nil, err
	}
	return c, func() { go r.drive(ctx, rn, id, w) }, nil
}

// drive is the goroutine of one run: the work, then, while the person has replies nobody answered, an answers pass,
// then the council's last state. The last check for replies and the end of the run happen under r.mu, so a reply
// either lands before it and is answered, or finds the run gone and starts a follow-up. The same holds for held drafts:
// a draft settled before the check is seen, and one settled after it finds the council awaiting-you and starts the next
// round. The run ends by starting the next queued council (under the same lock, so nobody takes the slot in between)
// and saving its own document.
func (r *Runner) drive(ctx context.Context, rn *run, id string, w work) {
	defer close(rn.done)
	defer rn.cancel()
	var end ending
	if ctx.Err() == nil { // a Stop can land between the launch and the goroutine's first step
		end = w(ctx, rn, id)
	}
	answered := -1 // the person's replies answered when the last answers pass began
	for passes := 0; ; passes++ {
		r.mu.Lock()
		if end.heldRound > 0 && ctx.Err() == nil {
			if c, err := Load(id); err == nil && HeldDrafts(c) == 0 {
				// the person settled every draft while the round ran: there is nothing to wait for, so the next round starts
				r.mu.Unlock()
				end = r.roundsWork(end.heldRound+1)(ctx, rn, id)
				continue
			}
		}
		if end.answers && ctx.Err() == nil && passes < maxPasses {
			if c, err := Load(id); err == nil && hasOpenReplies(c) {
				if n := answeredReplies(c); n > answered {
					passes, answered = 0, n
				}
				r.mu.Unlock()
				if err := r.answersPass(ctx, rn, id); err != nil {
					log.Printf("[council] %s: answers pass: %v", id, err)
					end.answers = false
				}
				continue
			}
		}
		final := r.finishLocked(ctx, id, end)
		next := r.pumpLocked()
		r.mu.Unlock()
		r.changed(final)
		next.fire(r)
		r.saveDocument(final)
		return
	}
}

func (r *Runner) finishLocked(ctx context.Context, id string, end ending) *Council {
	defer delete(r.active, id)
	stopped := ctx.Err() != nil
	c, err := Update(id, func(c *Council) error {
		c.Activity = nil
		endRun(c, r.now())
		switch {
		case stopped:
			c.State, c.Error = StateStopped, ""
		case end.set != nil:
			end.set(c)
		default:
			c.State, c.Error = StateFailed, "the run ended without a result"
		}
		return nil
	})
	if err != nil {
		log.Printf("[council] %s: could not save the last state: %v", id, err)
		return nil
	}
	return c
}

func loadFailed(err error) ending {
	return ending{set: func(c *Council) { c.State, c.Error = StateFailed, errText(err) }}
}

// ---- the rounds ----

// HeldDrafts is how many ideas and replies wait for the person to send, edit or drop them.
func HeldDrafts(c *Council) int {
	n := 0
	for _, p := range c.Proposals {
		if p.Draft == DraftHeld {
			n++
		}
	}
	for _, x := range c.Replies {
		if x.Draft == DraftHeld {
			n++
		}
	}
	return n
}

// awaitingDrafts ends a run at round with the council waiting on the person's held drafts.
func awaitingDrafts(round int) ending {
	return ending{set: func(c *Council) { c.State, c.Round, c.Error = StateAwaiting, round, "" }, heldRound: round}
}

// roundsWork runs the rounds from round `from` on: the ideas (round 1), then each reply pass, then the synthesis. A
// council that holds no drafts (no agent seated, or one an agent started) runs round 1, the pause after it when it has
// one, one reply pass and the synthesis. One that holds drafts (agents seated, started from the app) holds every answer,
// so a round whose answers left a draft held ends the run awaiting-you at that round: settling the last of them starts
// the next, and the council holds no slot while it waits.
func (r *Runner) roundsWork(from int) work {
	return func(ctx context.Context, rn *run, id string) ending {
		snap, err := Load(id)
		if err != nil {
			return loadFailed(err)
		}
		synth, held, at := SynthesisRound(snap), HoldsDrafts(snap), snap.Round
		for round := from; round < synth; round++ {
			if round != at {
				r.setRound(rn, id, round)
				at = round
			}
			if round == 1 {
				forEachExpert(panelOf(snap), func(e CouncilExpert) { r.round1(ctx, rn, id, snap, e) })
			} else if err := r.replyPass(ctx, rn, id, round); err != nil {
				return loadFailed(err)
			}
			if ctx.Err() != nil {
				return ending{}
			}
			cur, err := Load(id)
			if err != nil {
				return loadFailed(err)
			}
			switch {
			case round == 1 && everyoneFailedRound1(cur):
				return ending{set: func(c *Council) { c.State, c.Error = StateFailed, noOneAnsweredRound1(c) }}
			case held && HeldDrafts(cur) > 0:
				return awaitingDrafts(round)
			case round == 1 && !held && cur.PauseAfterRound1: // when drafts are held they are the pause
				return ending{set: func(c *Council) { c.State, c.Round, c.Error = StateAwaiting, 1, "" }}
			}
		}
		if at != synth {
			r.setRound(rn, id, synth)
		}
		if err := r.synthesize(ctx, rn, id); err != nil {
			if ctx.Err() != nil {
				return ending{}
			}
			return ending{set: synthesisFailed(err)}
		}
		return ending{set: func(c *Council) { c.State, c.Round, c.Error = StateDone, SynthesisRound(c), "" }, answers: true}
	}
}

// skipped says seat id skipped its turn in round.
func skipped(c *Council, id string, round int) bool {
	return slices.ContainsFunc(c.Skips, func(s CouncilSkip) bool { return s.Expert == id && s.Round == round })
}

// everyoneFailedRound1 says no seat of the panel got an answer out in round 1: each failed it or skipped it.
func everyoneFailedRound1(c *Council) bool {
	panel := panelOf(c)
	for _, e := range panel {
		if f, ok := c.Failed[e.Id]; (!ok || f.Round != 1) && !skipped(c, e.Id, 1) {
			return false
		}
	}
	return len(panel) > 0
}

// noOneAnsweredRound1 is the council's error when everyoneFailedRound1: a skip is not a failure, so it is named.
func noOneAnsweredRound1(c *Council) string {
	if len(c.Skips) > 0 {
		return "every expert failed or skipped round 1"
	}
	return "every expert failed in round 1"
}

func synthesisFailed(err error) func(c *Council) {
	return func(c *Council) {
		round := SynthesisRound(c)
		c.State, c.Round, c.Error = StateFailed, round, fmt.Sprintf("round %d: %s", round, errText(err))
	}
}

func (r *Runner) setRound(rn *run, id string, round int) {
	r.updateLogged(rn, id, func(c *Council) error {
		c.Round = round
		return nil
	})
}

// callerFor is the Caller that takes seat e's turn: the runner's Agents for a live agent, its Caller for a role expert.
func (r *Runner) callerFor(e CouncilExpert) (Caller, error) {
	if !IsAgent(e) {
		return r.Caller, nil
	}
	if r.Agents == nil {
		return nil, fmt.Errorf("the council runner has no way to reach live agents: %s cannot take its turn", e.Name)
	}
	return r.Agents, nil
}

// call makes one expert call: it starts the expert's clock, shows what it is doing, and keeps that current from the
// call's tool events (and, for an agent seat, from the wait for its session). It returns what the Caller returned. A
// role seat's call that Claude's safeguards flagged runs again once on SafeguardFallback, as Claude Code does; when
// that answers, the result's fellBack names it, and finishCall keeps a CouncilRetry.
func (r *Runner) call(ctx context.Context, rn *run, id string, e CouncilExpert, snap *Council, prompt string, tools bool, dirs []string, first CouncilActivity) (CallRes, error) {
	caller, err := r.callerFor(e)
	if err != nil {
		return CallRes{}, err
	}
	rn.begin(e.Id, callClock{start: r.now(), base: snap.Stats[e.Id].Ms})
	res, err := r.callOnce(ctx, rn, id, caller, e, snap, prompt, tools, dirs, first)
	if err == nil || ctx.Err() != nil || !IsSafeguardFlag(err) || IsAgent(e) || strings.EqualFold(e.Model, SafeguardFallback) {
		return res, err
	}
	log.Printf("[council] %s: %s was flagged by safeguards on %s; running it again on %s", id, e.Id, cmp.Or(e.Model, "its default"), SafeguardFallback)
	act := first
	act.Text = "Flagged by safeguards: answering on Opus 4.8"
	on := e
	on.Model = SafeguardFallback
	again, err2 := r.callOnce(ctx, rn, id, caller, on, snap, prompt, tools, dirs, act)
	again.Tokens += res.Tokens
	if err2 != nil {
		if ctx.Err() != nil {
			return again, err2
		}
		return again, fmt.Errorf("%s; again on %s: %s", errText(err), SafeguardFallback, errText(err2))
	}
	again.fellBack = SafeguardFallback
	return again, nil
}

// callOnce is one call of e through caller: it shows first as e's activity and keeps it current from the tool events. dirs
// are the folders outside the project the call may also read (readsOf).
func (r *Runner) callOnce(ctx context.Context, rn *run, id string, caller Caller, e CouncilExpert, snap *Council, prompt string, tools bool, dirs []string, first CouncilActivity) (CallRes, error) {
	r.updateLogged(rn, id, func(c *Council) error {
		setActivity(c, e.Id, first)
		return nil
	})
	req := CallReq{Expert: e, Cwd: snap.Project, Prompt: prompt, Tools: tools, AddDirs: dirs}
	if tools || IsAgent(e) {
		req.OnTool = func(text string) {
			act := first
			act.Text = text
			r.updateLogged(rn, id, func(c *Council) error {
				setActivity(c, e.Id, act)
				return nil
			})
		}
	}
	return caller.Call(ctx, req)
}

// seatSkip reads the SeatSkipped out of err, whether the Caller returned it by value or by pointer.
func seatSkip(err error) (SeatSkipped, bool) {
	var v SeatSkipped
	if errors.As(err, &v) {
		return v, true
	}
	var p *SeatSkipped
	if errors.As(err, &p) && p != nil {
		return *p, true
	}
	return SeatSkipped{}, false
}

// finishCall saves the end of one expert call. Its time and tokens are booked whatever happened. A call that ended
// because the run was stopped is neither a failure nor a result; a seat that skipped its turn (SeatSkipped) is posted as
// a skip, not as a failure with a Retry, and made no call; any other error is the expert's failure in round; and on
// success apply adds what the call produced.
func (r *Runner) finishCall(ctx context.Context, rn *run, id string, e CouncilExpert, res CallRes, err error, round int, apply func(c *Council)) {
	cancelled := err != nil && ctx.Err() != nil
	skip, skippedTurn := seatSkip(err)
	r.updateLogged(rn, id, func(c *Council) error {
		if k, ok := rn.end(e.Id); ok {
			st := c.Stats[e.Id]
			st.Ms = k.base + max(0, r.now()-k.start)
			setStat(c, e.Id, st)
		}
		if !skippedTurn {
			st := c.Stats[e.Id]
			st.Calls++
			st.Tokens += res.Tokens
			setStat(c, e.Id, st)
			c.Calls++
			c.Tokens += res.Tokens
		}
		delete(c.Activity, e.Id)
		switch {
		case cancelled:
		case skippedTurn:
			delete(c.Failed, e.Id)
			c.Skips = append(c.Skips, CouncilSkip{Expert: e.Id, Round: round, Reason: skip.Reason, Ts: r.now()})
		case err != nil:
			setFailed(c, e.Id, CouncilFailure{Round: round, Error: errText(err)})
		default:
			delete(c.Failed, e.Id)
			apply(c)
			if res.fellBack != "" {
				c.Retries = append(c.Retries, CouncilRetry{Expert: e.Id, Round: round, Model: res.fellBack, Was: e.Model, Ts: r.now(), Auto: true})
			}
		}
		return nil
	})
}

func nextNumbered(prefix string, ids []string) string {
	n := 0
	for _, id := range ids {
		if v, err := strconv.Atoi(strings.TrimPrefix(id, prefix)); err == nil && strings.HasPrefix(id, prefix) && v > n {
			n = v
		}
	}
	return prefix + strconv.Itoa(n+1)
}

func nextProposalId(c *Council) string {
	ids := make([]string, len(c.Proposals))
	for i, p := range c.Proposals {
		ids[i] = p.Id
	}
	return nextNumbered("P", ids)
}

func nextReplyId(c *Council) string {
	ids := make([]string, len(c.Replies))
	for i, p := range c.Replies {
		ids[i] = p.Id
	}
	return nextNumbered("r", ids)
}

// ---- round 1 ----

// heldFor is the Draft state of what a seat answers: held when the council holds drafts (an agent is seated and no
// agent started it, so every answer waits for the person), sent at once otherwise.
func heldFor(c *Council) string {
	if HoldsDrafts(c) {
		return DraftHeld
	}
	return ""
}

// addPlainReply posts the words of an agent's answer that held none of the JSON the round asks for as one reply from the
// seat: to the whole council, or under parent, the person's reply it answers.
func addPlainReply(c *Council, e CouncilExpert, text string, round int, now int64, parent *CouncilReply) {
	rp := CouncilReply{Id: nextReplyId(c), Author: e.Id, Text: text, Round: round, Ts: now, Draft: heldFor(c)}
	if parent != nil {
		rp.ProposalId, rp.ParentId = parent.ProposalId, parent.Id
	}
	c.Replies = append(c.Replies, rp)
}

func (r *Runner) round1(ctx context.Context, rn *run, id string, snap *Council, e CouncilExpert) {
	prompt := Round1Prompt(snap, e)
	if IsAgent(e) {
		prompt = agentPrompt(snap, e, 1)
	}
	res, err := r.call(ctx, rn, id, e, snap, prompt, true, nil, CouncilActivity{Text: actStarting})
	var (
		props []CouncilProposal
		plain string
	)
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		props, _, err = ParseRound1(res.Text) // the overall view has no field on the council, so it is not kept
		if err != nil && IsAgent(e) {
			plain, err = PlainReply(res.Text), nil // a live agent is heard as it spoke, not failed for the shape
		}
	}
	r.finishCall(ctx, rn, id, e, res, err, 1, func(c *Council) {
		if plain != "" {
			addPlainReply(c, e, plain, 1, r.now(), nil)
			return
		}
		for _, p := range props {
			p.Id, p.Author, p.Ts, p.Draft = nextProposalId(c), e.Id, r.now(), heldFor(c)
			if isBrainstorm(c) {
				p.Evidence = withoutNoEvidenceChip(p.Evidence) // a Brainstorm's idea needs none, so it is not drawn weak
			} else {
				p.Wild = false // only a Brainstorm has wild ideas
			}
			c.Proposals = append(c.Proposals, p)
		}
	})
}

// withoutNoEvidenceChip drops the weak chip ParseRound1 gives a proposal that cites nothing, and keeps real evidence.
func withoutNoEvidenceChip(ev []CouncilEvidence) []CouncilEvidence {
	if len(ev) == 1 && ev[0].Weak && ev[0].Ref == "" && ev[0].Note == noEvidenceNote {
		return nil
	}
	return ev
}

// ---- round 2 ----

// replyPass is a pass of reply rounds, round 2 or, in a council with three rounds, round 3: it has every expert that
// proposed review the others' proposals, at once and from text. An expert whose round 1 call failed sits it out. The
// person's messages the router has not taken up yet are routed first, so a seat reads the ones put to it.
func (r *Runner) replyPass(ctx context.Context, rn *run, id string, round int) error {
	r.routePending(ctx, id)
	if ctx.Err() != nil {
		return nil
	}
	snap, err := Load(id)
	if err != nil {
		return err
	}
	var experts []CouncilExpert
	for _, e := range panelOf(snap) {
		if f, bad := snap.Failed[e.Id]; bad && f.Round == 1 {
			continue
		}
		experts = append(experts, e)
	}
	var asks []string
	for _, pr := range snap.Replies {
		if pr.Author == YouId && !pr.Answered && !awaitsRoute(pr) { // one still pending (it could not be saved) is no seat's yet
			asks = append(asks, pr.Id)
		}
	}
	forEachExpert(experts, func(e CouncilExpert) { r.round2(ctx, rn, id, snap, e, round) })
	if ctx.Err() == nil && len(asks) > 0 {
		r.updateLogged(rn, id, func(c *Council) error {
			markAnswered(c, asks)
			return nil
		})
	}
	return nil
}

// withOpenAsks is c as expert e should see it: the person's replies to e that e has not answered are open, even when
// a pass already marked them answered (e failed that pass, and a retry asks again).
func withOpenAsks(c *Council, e CouncilExpert) *Council {
	v := *c
	v.Replies = slices.Clone(c.Replies)
	for i := range v.Replies {
		if pr := &v.Replies[i]; pr.Author == YouId && slices.Contains(pr.To, e.Id) {
			pr.Answered = answeredBy(c, pr.Id, e.Id)
		}
	}
	return &v
}

// round2Target is what an expert is doing in round 2, for its avatar's tooltip and the dashed row in the thread: the
// first proposal it reviews, or, with none, the person's question it answers. Nil means it has nothing to do.
func round2Target(c *Council, e CouncilExpert) *CouncilActivity {
	for _, p := range sentProposals(c) {
		if p.Author != e.Id && !p.Cut {
			return &CouncilActivity{Text: "Replying to " + speaker(c, p.Author), ProposalId: p.Id}
		}
	}
	if asks := unansweredFor(c, e.Id); len(asks) > 0 {
		return &CouncilActivity{Text: actPerson, ProposalId: asks[0].ProposalId, ParentId: asks[0].Id}
	}
	return nil
}

// round2 is one seat's turn in reply pass round (2, or 3 in a council with three rounds). A live agent is sent its own
// prompt, and what it answers that holds no JSON is heard as one plain reply. After the first pass a seat with nothing
// new to answer sits the pass out. The call has no tools, except a seat owed a reply of the person's that asked for them
// (it attaches files or names one): that call has the tools and the folders of the attached images (readsOf).
func (r *Runner) round2(ctx context.Context, rn *run, id string, snap *Council, e CouncilExpert, round int) {
	view := withOpenAsks(snap, e)
	target := round2Target(view, e)
	if target != nil && round > 2 && !seatHasNews(view, e, round) {
		target = nil
	}
	if target == nil {
		return
	}
	prompt := round2PromptFor(view, e, round)
	if IsAgent(e) {
		prompt = agentPrompt(view, e, round)
	}
	tools, dirs := readsOf(unansweredFor(view, e.Id))
	res, err := r.call(ctx, rn, id, e, view, prompt, tools, dirs, *target)
	var (
		out   Round2Result
		plain string
	)
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		out, err = ParseRound2(res.Text)
		if err != nil && IsAgent(e) {
			plain, err = PlainReply(res.Text), nil
		}
	}
	r.finishCall(ctx, rn, id, e, res, err, round, func(c *Council) {
		if plain != "" {
			addPlainReply(c, e, plain, round, r.now(), nil)
			return
		}
		applyRound2(c, e, out, round, r.now())
	})
}

// hasStance says seat expertId took a stance of its own on the proposal: a dropped one is not one.
func hasStance(c *Council, proposalId, expertId string) bool {
	for _, x := range c.Replies {
		if x.ProposalId == proposalId && x.Author == expertId && x.ParentId == "" && x.Stance != "" && x.Draft != DraftDropped {
			return true
		}
	}
	return false
}

// challengeTo is the latest challenge or opposition to a proposal from someone other than its author, the reply a
// revision of that proposal answers. A reply not sent yet is not out in the room to be answered.
func challengeTo(c *Council, proposalId, authorId string) string {
	for i := len(c.Replies) - 1; i >= 0; i-- {
		x := c.Replies[i]
		if x.ProposalId == proposalId && x.ParentId == "" && x.Author != authorId && x.Author != YouId && Sent(x.Draft) &&
			(x.Stance == StanceChallenge || x.Stance == StanceOppose) {
			return x.Id
		}
	}
	return ""
}

// latestReplyTo is the latest sent reply to a proposal from a seat other than seatId, the reply a later pass's second
// stance of seatId answers. The person's replies are left out: a reply under one would read as the answer it is owed.
func latestReplyTo(c *Council, proposalId, seatId string) string {
	for i := len(c.Replies) - 1; i >= 0; i-- {
		x := c.Replies[i]
		if x.ProposalId == proposalId && x.Author != seatId && x.Author != YouId && Sent(x.Draft) {
			return x.Id
		}
	}
	return ""
}

// revisionPending says a held reply already carries a revision of the proposal.
func revisionPending(c *Council, proposalId string) bool {
	return slices.ContainsFunc(c.Replies, func(x CouncilReply) bool {
		return x.ProposalId == proposalId && x.Draft == DraftHeld && x.Revision != nil
	})
}

// applyRevision is what a revision of its own idea changes: a withdrawal, or the new title and argument.
func applyRevision(p *CouncilProposal, rev CouncilRevision) {
	if rev.Withdraw {
		p.Withdrawn = true
		return
	}
	if rev.Title != "" {
		p.Title = rev.Title
	}
	if rev.Argument != "" {
		p.Argument = rev.Argument
	}
}

// applyRound2 turns one expert's reply in reply pass round into replies on the council. The model names the ids, so each
// is checked: a stance on an unknown, cut, own or unsent proposal is dropped, and so is a revision of someone else's
// proposal. In a council with agents every reply with words is held for the person; an agreement with nothing to add
// applies at once, and a revision rides on its reply and applies when that is sent. After the first pass, a stance on a
// proposal the seat already took one on answers the latest reply to it, and only when it has a reason.
func applyRound2(c *Council, e CouncilExpert, res Round2Result, round int, now int64) {
	hold := heldFor(c)
	for _, s := range res.Stances {
		p := findProposal(c, s.ProposalId)
		if p == nil || p.Author == e.Id || p.Cut || !Sent(p.Draft) {
			continue
		}
		reason := strings.TrimSpace(s.Reason)
		parent := ""
		if hasStance(c, p.Id, e.Id) {
			if round <= 2 {
				continue
			}
			if parent = latestReplyTo(c, p.Id, e.Id); parent == "" || reason == "" {
				continue
			}
		}
		if reason == "" && s.Stance != StanceAccept { // an accept needs no words; a doubt or an objection does
			continue
		}
		// a Brainstorm's build is the words it adds; with none it reads as a plain accept, and a Review has no builds
		builds := s.Builds && isBrainstorm(c) && reason != ""
		draft := ""
		if reason != "" {
			draft = hold
		}
		c.Replies = append(c.Replies, CouncilReply{
			Id: nextReplyId(c), ProposalId: p.Id, ParentId: parent, Author: e.Id, Stance: s.Stance, Builds: builds,
			Text: s.Reason, Evidence: s.Evidence, Round: round, Ts: now, Draft: draft,
		})
	}
	for _, rv := range res.Revisions {
		p := findProposal(c, rv.ProposalId)
		if p == nil || p.Author != e.Id || p.Withdrawn || !Sent(p.Draft) || revisionPending(c, p.Id) {
			continue
		}
		var (
			rev  CouncilRevision
			text string
		)
		if rv.Withdraw {
			rev.Withdraw, text = true, "Withdrawn."
		} else {
			// the new argument shows on the proposal itself; the reply says only what changed
			var parts []string
			if rv.Title != "" && rv.Title != p.Title {
				rev.Title = rv.Title
				parts = append(parts, "Retitled: "+rv.Title+".")
			}
			argued := rv.Argument != "" && rv.Argument != p.Argument
			if argued {
				rev.Argument = rv.Argument
			}
			if len(parts) == 0 && !argued {
				continue
			}
			switch {
			case rv.Change != "":
				parts = append(parts, rv.Change)
			case argued:
				parts = append(parts, "Revised the argument.")
			}
			text = strings.Join(parts, " ")
		}
		reply := CouncilReply{
			Id: nextReplyId(c), ProposalId: p.Id, ParentId: challengeTo(c, p.Id, e.Id), Author: e.Id,
			Revised: true, Text: text, Round: round, Ts: now,
		}
		if hold != "" {
			reply.Draft, reply.Revision = hold, &rev
		} else {
			applyRevision(p, rev)
		}
		c.Replies = append(c.Replies, reply)
	}
	if round == SynthesisRound(c)-1 { // picks are taken in the last reply pass only
		applyPicks(c, e, res.Picks)
	}
	applyAnswers(c, e, res.Answers, round, now)
}

// applyPicks keeps an expert's picks that name another expert's proposal still in the running, at most maxPicks, in
// the order given. The model names the ids, so each is checked like a stance.
func applyPicks(c *Council, e CouncilExpert, picks []string) {
	var kept []string
	for _, id := range picks {
		p := findProposal(c, id)
		if p == nil || p.Author == e.Id || p.Cut || p.Withdrawn || !Sent(p.Draft) || slices.Contains(kept, id) || len(kept) == maxPicks {
			continue
		}
		kept = append(kept, id)
	}
	if len(kept) == 0 {
		return
	}
	if c.Picks == nil {
		c.Picks = map[string][]string{}
	}
	c.Picks[e.Id] = kept
}

// ---- the person's replies ----

func answeredBy(c *Council, replyId, expertId string) bool {
	for _, x := range c.Replies {
		if x.ParentId == replyId && x.Author == expertId {
			return true
		}
	}
	return false
}

// owed are the person's replies that expert e has not answered; with openOnly, only the ones no pass marked answered.
func owed(c *Council, e CouncilExpert, openOnly bool) []CouncilReply {
	var out []CouncilReply
	for _, pr := range c.Replies {
		if pr.Author != YouId || !slices.Contains(pr.To, e.Id) || (openOnly && pr.Answered) || answeredBy(c, pr.Id, e.Id) {
			continue
		}
		out = append(out, pr)
	}
	return out
}

func hasOpenReplies(c *Council) bool {
	return slices.ContainsFunc(c.Replies, func(pr CouncilReply) bool { return pr.Author == YouId && !pr.Answered })
}

func answeredReplies(c *Council) int {
	n := 0
	for _, pr := range c.Replies {
		if pr.Author == YouId && pr.Answered {
			n++
		}
	}
	return n
}

func markAnswered(c *Council, ids []string) {
	for i := range c.Replies {
		if slices.Contains(ids, c.Replies[i].Id) {
			c.Replies[i].Answered = true
		}
	}
}

// applyAnswers adds an expert's answers under the person's replies. An answer to a reply the expert was not asked, or
// has already answered, is dropped. In a council with agents each answer with words is held for the person; one with
// none (it agrees with the answer before it) applies at once, as an agreement in a reply pass does.
func applyAnswers(c *Council, e CouncilExpert, answers []Answer, round int, now int64) {
	for _, a := range answers {
		pr := findReply(c, a.ReplyId)
		if pr == nil || pr.Author != YouId || !slices.Contains(pr.To, e.Id) || answeredBy(c, pr.Id, e.Id) {
			continue
		}
		draft := ""
		if a.Text != "" {
			draft = heldFor(c)
		}
		c.Replies = append(c.Replies, CouncilReply{
			Id: nextReplyId(c), ProposalId: pr.ProposalId, ParentId: pr.Id, Author: e.Id, Stance: a.Stance,
			Text: a.Text, Evidence: a.Evidence, Asks: a.Asks, Round: round, Ts: now, Draft: draft,
		})
	}
}

// answerCall asks one expert to answer the replies it owes, and saves its answers as replies of the given round. It has
// the read-only tools when a reply its prompt carries asked for them (Let them read files, or an attachment or an @ file),
// the person's replies above an owed one included, and may read the folders of the images those replies attach
// (readsOf). A live agent is sent its own prompt, and what it answers that holds no JSON is heard as one plain reply under
// the first reply it owes.
func (r *Runner) answerCall(ctx context.Context, rn *run, id string, snap *Council, e CouncilExpert, replies []CouncilReply, round int) {
	tools, dirs := readsOf(personRepliesIn(snap, replies))
	first := CouncilActivity{Text: actPerson, ProposalId: replies[0].ProposalId, ParentId: replies[0].Id}
	prompt := AnswersPrompt(snap, e, replies)
	if IsAgent(e) {
		prompt = agentPrompt(withOpenAsks(snap, e), e, round)
	}
	res, err := r.call(ctx, rn, id, e, snap, prompt, tools, dirs, first)
	var (
		answers []Answer
		plain   string
	)
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		answers, err = ParseAnswers(res.Text)
		if err != nil && IsAgent(e) {
			plain, err = PlainReply(res.Text), nil
		}
	}
	r.finishCall(ctx, rn, id, e, res, err, round, func(c *Council) {
		if plain != "" {
			addPlainReply(c, e, plain, round, r.now(), &replies[0])
			return
		}
		applyAnswers(c, e, answers, round, r.now())
	})
}

// answersPass has every expert the person's open replies are addressed to answer them. A reply no seat has answered yet
// is answered first by one of the seats it is addressed to (firstAnswerers), and then by the rest at once, who are shown
// that answer and asked to add to it rather than say it again: answered all at once, three seats each opened a steer of
// the person's with the same concession. The Summary is not rerun. Each reply is marked answered when the pass ends,
// whatever came of its calls: a call that failed is on the council's Failed list with its Retry, and an expert already
// on that list sits the pass out until it is retried. A message the router has not taken up yet is routed first (a router
// already in flight is waited for), and its To, the router's order, is who answers it: the first seat in it first.
func (r *Runner) answersPass(ctx context.Context, rn *run, id string) error {
	r.routePending(ctx, id)
	if ctx.Err() != nil {
		return nil
	}
	snap, err := Load(id)
	if err != nil {
		return err
	}
	round := max(SynthesisRound(snap), snap.Round)
	var open []string
	for _, pr := range snap.Replies {
		if pr.Author == YouId && !pr.Answered && !awaitsRoute(pr) { // one still pending (it could not be saved) is marked answered by no pass
			open = append(open, pr.Id)
		}
	}
	first := firstAnswerers(snap)
	r.answerAll(ctx, rn, id, snap, round, func(e CouncilExpert, pr CouncilReply) bool { return first[pr.Id] == e.Id })
	if ctx.Err() != nil {
		return nil
	}
	if snap, err = Load(id); err != nil { // the rest are shown the first answers
		return err
	}
	r.answerAll(ctx, rn, id, snap, round, nil)
	if ctx.Err() != nil {
		return nil
	}
	_, err = r.update(rn, id, func(c *Council) error {
		markAnswered(c, open)
		return nil
	})
	return err
}

// firstAnswerers maps each open reply of the person that no seat has answered yet to the seat that answers it first: the
// first in the reply's To, in its order, that is on the panel and has no failed call. A routed reply's To is the router's
// order, so its first pick answers first; every other reply's To is in panel order, as replyTargets and withJoined store it.
func firstAnswerers(c *Council) map[string]string {
	out := map[string]string{}
	panel := panelOf(c)
	for _, pr := range c.Replies {
		if pr.Author != YouId || pr.Answered || len(answersTo(c, pr)) > 0 {
			continue
		}
		for _, id := range pr.To {
			_, bad := c.Failed[id]
			if !bad && slices.ContainsFunc(panel, func(e CouncilExpert) bool { return e.Id == id }) {
				out[pr.Id] = id
				break
			}
		}
	}
	return out
}

// answerAll has each expert with no failed call answer, at once, the open replies it owes that take says it answers in
// this step (all of them when take is nil).
func (r *Runner) answerAll(ctx context.Context, rn *run, id string, snap *Council, round int, take func(CouncilExpert, CouncilReply) bool) {
	type ask struct {
		e       CouncilExpert
		replies []CouncilReply
	}
	var asks []ask
	for _, e := range panelOf(snap) {
		if _, bad := snap.Failed[e.Id]; bad {
			continue
		}
		var replies []CouncilReply
		for _, pr := range owed(snap, e, true) {
			if take == nil || take(e, pr) {
				replies = append(replies, pr)
			}
		}
		if len(replies) > 0 {
			asks = append(asks, ask{e, replies})
		}
	}
	experts := make([]CouncilExpert, len(asks))
	byId := map[string]ask{}
	for i, a := range asks {
		experts[i] = a.e
		byId[a.e.Id] = a
	}
	forEachExpert(experts, func(e CouncilExpert) { r.answerCall(ctx, rn, id, snap, e, byId[e.Id].replies, round) })
}

func isWordRune(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' }

// isPathRune is a character a file mention's path runs over: the word characters and - . / ~
func isPathRune(r rune) bool { return isWordRune(r) || r == '-' || r == '.' || r == '/' || r == '~' }

// opensAt says the @ at text[at] opens a mention: it does not follow a letter, a digit or _ (so an address such as
// x@ram.com opens none).
func opensAt(text string, at int) bool {
	before, _ := utf8.DecodeLastRuneInString(text[:at])
	return at == 0 || !isWordRune(before)
}

// filePathAt is the path of the file mention the @ at text[at] starts, and where its run ends. The run is the longest
// one of path characters after the @, with its trailing dots dropped (the dot that ends a sentence); it is a file mention
// when what is left holds a / or a . The path is "" when the @ starts none. The frontend carries the same rule, and both
// sides' tests hold the same table of examples, so the seats it predicts are the seats the backend reaches.
func filePathAt(text string, at int) (path string, end int) {
	end = at + 1
	for end < len(text) {
		r, n := utf8.DecodeRuneInString(text[end:])
		if !isPathRune(r) {
			break
		}
		end += n
	}
	run := strings.TrimRight(text[at+1:end], ".")
	if !strings.ContainsAny(run, "/.") {
		return "", end
	}
	return run, end
}

// fileMentions are the paths of the files text names with an @, in order, each @ one: "@src/a.go and @b.md." names
// src/a.go and b.md. A seat or a chat is never named by an @ that starts one (mentions, atWords).
func fileMentions(text string) []string {
	var out []string
	for i := 0; i < len(text); i++ {
		if text[i] != '@' || !opensAt(text, i) {
			continue
		}
		path, end := filePathAt(text, i)
		if path != "" {
			out = append(out, path)
		}
		i = end - 1
	}
	return out
}

// fileMentioned says text names at least one file with an @: the reply is then answered with tools, so the seat can read it.
func fileMentioned(text string) bool { return len(fileMentions(text)) > 0 }

// mentions reports whether text holds token as a whole word, not inside an address or a longer name. A token that starts
// with @ is not found in an @ that starts a file mention: @ux/plan.md and @ram.go name files, not UX or RAM.
func mentions(text, token string) bool {
	for from := 0; from < len(text); {
		i := strings.Index(text[from:], token)
		if i < 0 {
			return false
		}
		i += from
		end := i + len(token)
		before, _ := utf8.DecodeLastRuneInString(text[:i])
		after, _ := utf8.DecodeRuneInString(text[end:])
		if (i == 0 || !isWordRune(before)) && (end == len(text) || !isWordRune(after)) {
			if !strings.HasPrefix(token, "@") {
				return true
			}
			if path, _ := filePathAt(text, i); path == "" {
				return true
			}
		}
		from = i + 1
	}
	return false
}

// minChatKey is the fewest characters of its tab id with which a mention reaches a chat seat.
const minChatKey = 8

// atWords are the words that follow an @ in lower, an @ inside a longer word (an address) and an @ that starts a file
// mention (@3e19c0d2-a/x.ts is a file, not the chat keyed 3e19c0d2-a) left out. A word runs over letters, digits, _ and
// -: a UUID tab id has a dash at its 9th character, so the key that tells two chats apart (such as 3e19c0d2-a) runs past it.
func atWords(lower string) []string {
	var out []string
	for i := 0; i < len(lower); i++ {
		if lower[i] != '@' {
			continue
		}
		if !opensAt(lower, i) {
			continue
		}
		if path, end := filePathAt(lower, i); path != "" {
			i = end - 1
			continue
		}
		end := i + 1
		for end < len(lower) {
			r, n := utf8.DecodeRuneInString(lower[end:])
			if !isWordRune(r) && r != '-' {
				break
			}
			end += n
		}
		if end > i+1 {
			out = append(out, lower[i+1:end])
		}
		i = end - 1
	}
	return out
}

// reachesChat says an @-word (lower case) reaches the chat seat: it holds 8 characters or more, starts the seat's tab id,
// and starts no other chat seat's. So a key that is unique among the chats always reaches its own seat.
func reachesChat(word string, seat CouncilExpert, chats []CouncilExpert) bool {
	if utf8.RuneCountInString(word) < minChatKey || !strings.HasPrefix(strings.ToLower(seat.Agent), word) {
		return false
	}
	return !slices.ContainsFunc(chats, func(o CouncilExpert) bool {
		return o.Agent != seat.Agent && strings.HasPrefix(strings.ToLower(o.Agent), word)
	})
}

// mentioned are the experts a reply @-mentions by name or id, in the council's order. A chat seat is also reached by the
// first characters of its tab id (reachesChat).
func mentioned(c *Council, text string) []string {
	lower := strings.ToLower(text)
	words := atWords(lower)
	panel := panelOf(c)
	chats := slices.DeleteFunc(slices.Clone(panel), func(e CouncilExpert) bool { return !IsAgent(e) })
	var out []string
	for _, e := range panel {
		hit := false
		for _, key := range []string{e.Name, e.Id} {
			if key != "" && mentions(lower, "@"+strings.ToLower(key)) {
				hit = true
				break
			}
		}
		if !hit && IsAgent(e) {
			hit = slices.ContainsFunc(words, func(w string) bool { return reachesChat(w, e, chats) })
		}
		if hit {
			out = append(out, e.Id)
		}
	}
	return out
}

// atAll says text asks every seat on purpose: it holds @all or @everyone as a whole word, in any case. An @all beside a
// seat's name still reaches every seat. A message that does skips the router.
func atAll(text string) bool {
	lower := strings.ToLower(text)
	return mentions(lower, "@all") || mentions(lower, "@everyone")
}

// replyTargets are the experts the person's reply goes to: with @all or @everyone, the whole panel; else the ones it
// @-mentions; else, in a branch, the proposal's author and every expert on the path to the parent; else, with no
// proposal and no parent, the whole panel (appendPersonReply routes that last case when there is a choice to make).
func replyTargets(c *Council, proposalId string, parent *CouncilReply, text string) []string {
	if atAll(text) {
		return idsOf(panelOf(c))
	}
	if ids := mentioned(c, text); len(ids) > 0 {
		return ids
	}
	panel := panelOf(c)
	if proposalId == "" && parent == nil {
		return idsOf(panel)
	}
	want := map[string]bool{}
	if p := findProposal(c, proposalId); p != nil {
		want[p.Author] = true
	}
	if parent != nil {
		want[parent.Author] = true
		for _, a := range ancestorsOf(c, *parent) {
			want[a.Author] = true
		}
	}
	var out []string
	for _, e := range panel {
		if want[e.Id] {
			out = append(out, e.Id)
		}
	}
	if len(out) == 0 {
		return idsOf(panel)
	}
	return out
}

// withJoined is to with the chats that joined with this reply added, in the council's order, each once: a chat seated by a
// message is a target of it whether or not the text @s it.
func withJoined(c *Council, to, joined []string) []string {
	if len(joined) == 0 {
		return to
	}
	var out []string
	for _, e := range panelOf(c) {
		if slices.Contains(to, e.Id) || slices.Contains(joined, e.Id) {
			out = append(out, e.Id)
		}
	}
	return out
}

// joiningSeats are the chats a reply seats in c: the ones in seats that do not sit there already, each once. A seat that
// is not a chat a council can hold (no tab, the coordinator, a harness other than claude or pi, an id another seat has) is
// an error, and so nothing is saved.
func joiningSeats(c *Council, seats []CouncilExpert) ([]CouncilExpert, error) {
	var out []CouncilExpert
	sits := func(list []CouncilExpert, s CouncilExpert) bool {
		return slices.ContainsFunc(list, func(e CouncilExpert) bool { return IsAgent(e) && e.Agent == s.Agent })
	}
	for _, s := range seats {
		switch {
		case !IsAgent(s) || s.Coordinator:
			return nil, fmt.Errorf("%q is not a live chat: only a chat can join a council in a reply", s.Name)
		case s.Harness != HarnessClaude && s.Harness != HarnessPi:
			return nil, fmt.Errorf("agent %q runs %q: only a %s or %s agent can take a seat", s.Name, s.Harness, HarnessClaude, HarnessPi)
		case sits(c.Experts, s) || sits(out, s):
			continue
		case s.Id == "" || s.Id == YouId || slices.ContainsFunc(c.Experts, func(e CouncilExpert) bool { return e.Id == s.Id }) ||
			slices.ContainsFunc(out, func(e CouncilExpert) bool { return e.Id == s.Id }):
			return nil, fmt.Errorf("expert %q is listed twice", s.Id)
		}
		out = append(out, s)
	}
	return out, nil
}

// seatBeforeCoordinator puts seats after the seats c has and before its coordinator, which stays last.
func seatBeforeCoordinator(c *Council, seats []CouncilExpert) {
	var panel, coordinators []CouncilExpert
	for _, e := range c.Experts {
		if e.Coordinator {
			coordinators = append(coordinators, e)
		} else {
			panel = append(panel, e)
		}
	}
	c.Experts = append(append(panel, seats...), coordinators...)
}

// appendPersonReply adds the person's reply to c, in the round c is in, addressed also to the chats in joined (the ids of
// the seats this reply just seated). A reply to a reply takes the proposal of its parent; it is an error to name a
// proposal or a parent that is not there. A reply that attaches files or names one with an @ is stored with tools on,
// whatever tools says: the seat that answers it has to be able to read them.
//
// toolsAuto says Let them read files was on Auto and the message locked nothing on (no image, no @file): tools then holds
// the composer's guess, and the router decides it (routeReply) for a message it takes up.
//
// A message with no proposal, no parent, no seat @-mentioned, no @all or @everyone and no chat seated by it goes to the
// router when two or more seats can answer it (routeCandidates): it is stored with To empty and Routed pending, and
// routeReply fills To in. With one seat that can answer, it goes to that seat, unrouted; with none, to the whole panel.
func appendPersonReply(c *Council, proposalId, parentId, text string, tools, toolsAuto bool, attachments []string, joined []string, now int64) error {
	var parent *CouncilReply
	if parentId != "" {
		if parent = findReply(c, parentId); parent == nil {
			return fmt.Errorf("council %s has no reply %s", c.Id, parentId)
		}
		switch {
		case proposalId == "":
			proposalId = parent.ProposalId
		case parent.ProposalId != proposalId:
			return fmt.Errorf("reply %s is not on proposal %s", parentId, proposalId)
		}
	}
	if proposalId != "" && findProposal(c, proposalId) == nil {
		return fmt.Errorf("council %s has no proposal %s", c.Id, proposalId)
	}
	to := withJoined(c, replyTargets(c, proposalId, parent, text), joined)
	if len(attachments) == 0 {
		attachments = nil // stored as no key at all, and never the caller's slice
	} else {
		attachments = slices.Clone(attachments)
	}
	var routed *CouncilRouted
	if proposalId == "" && parent == nil && len(joined) == 0 && !atAll(text) && len(mentioned(c, text)) == 0 {
		switch cands := routeCandidates(c); len(cands) {
		case 0: // nobody can answer: the whole panel, as it always was
		case 1:
			to = idsOf(cands) // nothing to choose
		default:
			to = nil // the router fills it in
			routed = &CouncilRouted{Pending: true, AutoTools: toolsAuto && len(attachments) == 0 && !fileMentioned(text)}
		}
	}
	c.Replies = append(c.Replies, CouncilReply{
		Id: nextReplyId(c), ProposalId: proposalId, ParentId: parentId, Author: YouId, Text: text,
		To: to, Tools: tools || len(attachments) > 0 || fileMentioned(text), Attachments: attachments, Round: c.Round, Ts: now,
		Routed: routed,
	})
	return nil
}

// followRound is the round number of a follow-up: the first one after the synthesis (4 for two rounds), then one more
// for each after.
func followRound(c *Council) int {
	last := 0
	for _, pr := range c.Replies {
		last = max(last, pr.Round)
	}
	return max(FirstFollowRound(c), last+1)
}

// ReplyIn is what the person's reply carries into ReplyWith. Tools is Let them read files; ToolsAuto says the composer's
// switch was on Auto and no image or @file locked it on, so Tools holds only the composer's guess (the router decides it
// for a message it takes up). A person's On or Off is ToolsAuto false. Seats are live chats the reply brings into the
// council (nil for a plain reply); Attachments are the absolute paths of the files the person attached.
type ReplyIn struct {
	ProposalId, ParentId, Text string
	Tools, ToolsAuto           bool
	Seats                      []CouncilExpert
	Attachments                []string
}

// Reply is ReplyWith for a reply whose Let them read files is the person's own choice, On or Off, never Auto: the router
// never overrides it.
func (r *Runner) Reply(id, proposalId, parentId, text string, tools bool, seats []CouncilExpert, attachments ...string) (*Council, error) {
	return r.ReplyWith(id, ReplyIn{
		ProposalId: proposalId, ParentId: parentId, Text: text, Tools: tools, ToolsAuto: false, Seats: seats, Attachments: attachments,
	})
}

// ReplyWith posts the person's reply on a proposal (in.ProposalId), under another reply (in.ParentId), or, with neither,
// to the whole council. It goes to the experts in its branch unless the text @-mentions some. Posted before round 2, or
// while the council waits on the person, it is answered in the next reply pass (a seat that is a live agent gets it at
// its next turn); posted while a run is on, it is answered by the pass after the synthesis; posted to a council that is
// done, stopped or failed, it starts a follow-up round at once, with tools when the person turned Let them read files
// on, and the council returns to the state it was in. in.Seats are live chats the reply brings into the council (nil for
// a plain reply): in the same save that posts it, the ones not seated yet take their places after the seats there and
// before the coordinator, and each is a target of the reply even when its text does not @ it. A council that stored no
// draft mode keeps the one its seats gave before the chat joined (freezeDraftMode). A chat seated while round 1 runs sits
// that round out, since the round read its panel when it began, and takes part from round 2; a reply that fails seats
// nobody. in.Attachments are the absolute paths of the files the person attached (the caller has checked them): the reply
// stores them, and one with any, or with a file named by an @ in its text, is stored and answered with tools on whatever
// in.Tools says, in a round or a follow-up.
//
// A message to the whole council (no proposal, no parent, no @-mention of a seat, no @all) that two or more seats could
// answer is taken up by the router (routeReply): it is stored with To empty and Routed pending, and the router starts at
// once on its own goroutine, whatever the council's state, so the pick shows within seconds. A pass that reads the
// person's replies routes a reply still pending first (routePending), so no seat answers a message before it is routed.
func (r *Runner) ReplyWith(id string, in ReplyIn) (*Council, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return nil, errors.New("a reply needs some text")
	}
	var replyId string
	saved, err := r.post(id, func(c *Council) error {
		joined, err := joiningSeats(c, in.Seats)
		if err != nil {
			return err
		}
		if len(joined) > 0 {
			freezeDraftMode(c) // before the chat sits, so the mode is the one the council had
			seatBeforeCoordinator(c, joined)
		}
		if err := appendPersonReply(c, in.ProposalId, in.ParentId, text, in.Tools, in.ToolsAuto, in.Attachments, idsOf(joined), r.now()); err != nil {
			return err
		}
		replyId = c.Replies[len(c.Replies)-1].Id
		return nil
	})
	if err != nil {
		return nil, err
	}
	if pr := findReply(saved, replyId); pr != nil && awaitsRoute(*pr) {
		inBackground(func(ctx context.Context) { r.routeReply(ctx, id, replyId) })
	}
	return saved, nil
}

// ---- routing the person's message ----

// routeTimeout is how long a router call started outside a run (ReplyWith's, MarkStale's) may take before it counts as a
// failed router.
const routeTimeout = 2 * time.Minute

// inBackground runs fn on a goroutine of its own, outside any run, under routeTimeout.
func inBackground(fn func(ctx context.Context)) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), routeTimeout)
		defer cancel()
		fn(ctx)
	}()
}

// awaitsRoute says pr is a message of the person's the router has not answered yet: its To is empty until it does.
func awaitsRoute(pr CouncilReply) bool {
	return pr.Author == YouId && pr.Routed != nil && pr.Routed.Pending
}

// routeReply routes the person's reply replyId of council id: one router call, whose pick it saves as the reply's To and
// Routed, and reports. The Runner keeps one call in flight per reply, so a pass and the goroutine ReplyWith started
// never make two: the later one waits for the first to save, then looks again, and routes the reply itself only when it
// is still pending (the first was cut off or could not save). A reply that is gone or not pending is left as it is.
//
// When the router fails (the call errors, answers nothing usable, or names no seat that can still answer), the reply goes
// to the first seat that can answer, in panel order, and Routed says it failed and why; Tools stays what the composer
// sent. A call cut off by the run it belongs to being stopped is no failure: the reply stays pending for the next pass.
// The router is no seat, so its call is booked on the council (Calls, Tokens) and on no seat's Stats.
func (r *Runner) routeReply(ctx context.Context, id, replyId string) {
	key := id + "/" + replyId
	done := make(chan struct{})
	for {
		r.mu.Lock()
		wait, flying := r.routing[key]
		if !flying {
			if r.routing == nil {
				r.routing = map[string]chan struct{}{}
			}
			r.routing[key] = done
		}
		r.mu.Unlock()
		if !flying {
			break
		}
		select {
		case <-wait:
		case <-ctx.Done():
			return
		}
	}
	defer func() {
		r.mu.Lock()
		delete(r.routing, key)
		r.mu.Unlock()
		close(done)
	}()

	c, err := Load(id)
	if err != nil {
		log.Printf("[council] %s: reply %s not routed: %v", id, replyId, err)
		return
	}
	pr := findReply(c, replyId)
	if pr == nil || !awaitsRoute(*pr) {
		return
	}
	cands := routeCandidates(c)
	if len(cands) < 2 { // seats failed since the message was sent: there is nothing left to choose between
		r.saveRoute(id, replyId, func(c *Council, pr *CouncilReply) {
			if cands := routeCandidates(c); len(cands) < 2 {
				pr.Routed = nil
				pr.To = idsOf(panelOf(c))
				if len(cands) == 1 {
					pr.To = idsOf(cands)
				}
			}
		})
		return
	}
	route, res, err := r.routeCall(ctx, c, *pr, cands)
	if err != nil && errors.Is(ctx.Err(), context.Canceled) {
		return
	}
	called := r.Caller != nil // a runner with no caller made no call to book
	r.saveRoute(id, replyId, func(c *Council, pr *CouncilReply) {
		if called {
			c.Calls++
			c.Tokens += res.Tokens
		}
		settleRoute(c, pr, route, err)
	})
}

// saveRoute applies change to reply replyId of council id when it is still pending, saves, and reports the save. A save
// that fails is logged: the reply stays pending, and the next pass (or the next start) routes it again.
func (r *Runner) saveRoute(id, replyId string, change func(c *Council, pr *CouncilReply)) {
	saved, err := Update(id, func(c *Council) error {
		pr := findReply(c, replyId)
		if pr == nil || !awaitsRoute(*pr) {
			return errSkip
		}
		change(c, pr)
		return nil
	})
	switch {
	case errors.Is(err, errSkip):
	case err != nil:
		log.Printf("[council] %s: router's pick for reply %s not saved: %v", id, replyId, err)
	default:
		r.changed(saved)
	}
}

// settleRoute stores the router's pick on pr, or, when err is set or none of the seats it named can still answer, the first
// seat that can: To is the pick, in the router's order, and Chose keeps it apart from To. Tools is the router's only when
// the composer left it Auto (AutoTools). With no seat left to answer at all the reply goes to the whole panel, unrouted.
func settleRoute(c *Council, pr *CouncilReply, route Route, err error) {
	cands := routeCandidates(c)
	var chose []string
	if err == nil {
		for _, id := range route.Seats {
			if slices.ContainsFunc(cands, func(e CouncilExpert) bool { return e.Id == id }) {
				chose = append(chose, id)
			}
		}
		if len(chose) == 0 {
			err = errors.New("the seats the router chose can no longer answer")
		}
	}
	switch {
	case err == nil:
		pr.Routed.Chose, pr.Routed.Reason, pr.Routed.Failed = chose, route.Reason, false
		if pr.Routed.AutoTools {
			pr.Tools = route.Tools
		}
	case len(cands) == 0:
		pr.Routed, pr.To = nil, idsOf(panelOf(c))
		return
	default:
		pr.Routed.Chose, pr.Routed.Reason, pr.Routed.Failed = []string{cands[0].Id}, errText(err), true
	}
	pr.Routed.Pending = false
	pr.To = slices.Clone(pr.Routed.Chose)
}

// routePending routes, one after another, every message of the person's in council id that the router has not answered
// yet, each through routeReply. Every pass that reads the person's replies calls it first.
func (r *Runner) routePending(ctx context.Context, id string) {
	c, err := Load(id)
	if err != nil {
		log.Printf("[council] %s: pending replies not routed: %v", id, err)
		return
	}
	for _, pr := range c.Replies {
		if awaitsRoute(pr) && ctx.Err() == nil {
			r.routeReply(ctx, id, pr.Id)
		}
	}
}

// post saves change to council id as one save and has the council answer it. A council that is done, stopped or failed
// with no run on starts a follow-up at once (a follow-up round, the council returning to the state it was in); any other
// state saves the change alone, and the run that is on, or the next round, takes it up. It refuses a council that has not
// started, and a runner with no caller. change runs inside the save, so an error from it saves nothing and starts
// nothing. ReplyWith posts the person's message with it, and Ask <seat> too (AskToo) reopens one.
func (r *Runner) post(id string, change func(c *Council) error) (*Council, error) {
	r.mu.Lock()
	cur, err := Load(id)
	if err == nil && (cur.State == StateNotRun || cur.State == StateQueued) {
		err = fmt.Errorf("council %s has not started: there is nothing to reply to", id)
	}
	if err == nil && r.Caller == nil {
		err = errors.New("the council runner has no caller")
	}
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	var (
		saved *Council
		start func()
	)
	if r.active[id] == nil && (cur.State == StateDone || cur.State == StateStopped || cur.State == StateFailed) {
		prev := prevOf(cur)
		saved, start, err = r.launchLocked(context.Background(), id, func() (*Council, error) {
			return Update(id, func(c *Council) error {
				c.State, c.Round, c.Error = StateRunning, followRound(c), ""
				r.beginRun(c)
				return change(c)
			})
		}, r.followupWork(prev))
	} else {
		saved, err = Update(id, change)
	}
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	if start != nil {
		start()
	}
	return saved, nil
}

func (r *Runner) followupWork(prev prevState) work {
	return func(context.Context, *run, string) ending {
		return ending{set: prev.restore, answers: true}
	}
}

// Continue ends the pause: it marks the proposals in cut as cut, stores question (if any) as the person's reply to the
// whole council, and runs round 2 and the synthesis on what is left. It runs the rounds after the one the council waits
// at, so a council with agents that waits on no draft (they were all settled) goes on from where it stands; one that
// still holds a draft is refused, since the drafts are what it waits for.
func (r *Runner) Continue(id string, cut []string, question string) (*Council, error) {
	if r.Caller == nil {
		return nil, errors.New("the council runner has no caller")
	}
	question = strings.TrimSpace(question)
	r.mu.Lock()
	cur, err := Load(id)
	if err == nil && r.active[id] != nil {
		err = busy(id)
	}
	if err == nil && cur.State != StateAwaiting {
		err = fmt.Errorf("council %s is %s, not waiting on you", id, cur.State)
	}
	if err == nil && HeldDrafts(cur) > 0 {
		err = fmt.Errorf("council %s has %d drafts waiting for you: send, edit or drop them, and the next round starts", id, HeldDrafts(cur))
	}
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	from := cur.Round + 1
	saved, start, err := r.launchLocked(context.Background(), id, func() (*Council, error) {
		return Update(id, func(c *Council) error {
			for _, pid := range cut {
				p := findProposal(c, pid)
				if p == nil {
					return fmt.Errorf("council %s has no proposal %s", id, pid)
				}
				p.Cut = true
			}
			if question != "" {
				c.Replies = append(c.Replies, CouncilReply{
					Id: nextReplyId(c), Author: YouId, Text: question, To: idsOf(panelOf(c)), Round: c.Round, Ts: r.now(),
				})
			}
			c.State, c.Round, c.Error = StateRunning, from, ""
			r.beginRun(c)
			return nil
		})
	}, r.roundsWork(from))
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
}

// ---- round 3 ----

// synthesize runs the coordinator's call over everything so far and replaces the Summary. A failure is on the
// coordinator's Failed entry, and comes back as the error.
func (r *Runner) synthesize(ctx context.Context, rn *run, id string) error {
	return r.synthesizeOn(ctx, rn, id, "")
}

// synthesizeOn is synthesize on model instead of the coordinator's own, when model is set: a retry on another model. The
// coordinator keeps its Model, and the council keeps a CouncilRetry when the synthesis works.
func (r *Runner) synthesizeOn(ctx context.Context, rn *run, id string, model string) error {
	snap, err := Load(id)
	if err != nil {
		return err
	}
	coord, ok := coordinatorExpert(snap)
	if !ok {
		return errors.New("the council has no coordinator")
	}
	was := coord.Model
	if model != "" {
		coord.Model = model
	}
	at := r.now() // the Summary reads what was said up to now; a reply posted while it is written reads as newer
	res, err := r.call(ctx, rn, id, coord, snap, SynthesisPrompt(snap), false, nil, CouncilActivity{Text: actSummary})
	var (
		sum  CouncilSummary
		weak []WeakNote
	)
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		sum, weak, err = ParseSynthesis(res.Text)
	}
	if err == nil {
		sum = cleanSummary(snap, sum)
		sum.At = at
	}
	r.finishCall(ctx, rn, id, coord, res, err, SynthesisRound(snap), func(c *Council) {
		c.Summary = &sum
		if model != "" && res.fellBack == "" { // a fallback past model is kept by finishCall
			c.Retries = append(c.Retries, CouncilRetry{Expert: coord.Id, Round: SynthesisRound(snap), Model: model, Was: was, Ts: r.now()})
		}
		if !isBrainstorm(c) { // a Brainstorm marks nothing weak
			MarkWeak(c, weak)
		}
	})
	return err
}

// directionOutcome reads the direction number of a proposal's outcome: "Direction 4", "Merged into direction 4".
var directionOutcome = regexp.MustCompile(`(?i)^(?:merged into )?direction (\d+)$`)

// findSentProposal is the proposal with id when it is out in the room, nil when there is none or it is held or dropped.
func findSentProposal(c *Council, id string) *CouncilProposal {
	if p := findProposal(c, id); p != nil && Sent(p.Draft) {
		return p
	}
	return nil
}

// cleanSummary drops what the coordinator named that is not on the council: a proposal that does not exist, an
// expert that is not on the panel, and a stance from the author of a proposal the direction merges. A Brainstorm's
// report holds at most maxDirections ideas worth trying, then the wild ideas kept aside. A Review's holds at most
// maxDirections directions too, each with its first step, then Also raised (Kept): a direction past the cap moves there
// as one line, ahead of the ones the model put there, and an outcome naming a direction past the cap reads Also raised.
func cleanSummary(c *Council, s CouncilSummary) CouncilSummary {
	if strings.TrimSpace(c.Question) == "" {
		s.Answer = "" // nothing was asked, so there is nothing to answer
	}
	panel := map[string]bool{}
	for _, e := range panelOf(c) {
		panel[e.Id] = true
	}
	if isBrainstorm(c) {
		if len(s.Directions) > maxDirections {
			s.Directions = s.Directions[:maxDirections]
		}
	} else if len(s.Directions) > maxDirections {
		var moved []CouncilDirection
		for _, d := range s.Directions[maxDirections:] {
			moved = append(moved, CouncilDirection{Title: d.Title, Reasoning: d.Reasoning, From: d.From, Stances: map[string]CouncilStance{}})
		}
		s.Directions = s.Directions[:maxDirections]
		s.Kept = append(moved, s.Kept...)
		for i := range s.Kept {
			s.Kept[i].Rank = i + 1
		}
	}
	for i := range s.Directions {
		cleanDirection(c, &s.Directions[i], panel)
	}
	for i := range s.Kept {
		cleanDirection(c, &s.Kept[i], panel)
	}
	outcomes := map[string]string{}
	for pid, o := range s.Outcomes {
		if o = strings.TrimSpace(o); o != "" && findSentProposal(c, pid) != nil {
			if m := directionOutcome.FindStringSubmatch(o); m != nil && !isBrainstorm(c) {
				if n, _ := strconv.Atoi(m[1]); n > maxDirections {
					o = "Also raised"
				}
			}
			outcomes[pid] = o
		}
	}
	s.Outcomes = outcomes
	s.Asks = cleanAsks(s.Asks, panel)
	return s
}

// cleanAsks keeps at most MaxAsks of the questions to ask next, each once, and sends one addressed to a seat that is not
// on the panel to the whole panel instead.
func cleanAsks(asks []CouncilAsk, panel map[string]bool) []CouncilAsk {
	var out []CouncilAsk
	for _, a := range asks {
		if len(out) == MaxAsks {
			break
		}
		if slices.ContainsFunc(out, func(o CouncilAsk) bool { return o.Text == a.Text }) {
			continue
		}
		if !panel[a.To] {
			a.To = ""
		}
		out = append(out, a)
	}
	return out
}

// cleanDirection keeps the proposal ids of d that are on the council, once each, and the stances of the panel's
// experts other than the authors of those proposals.
func cleanDirection(c *Council, d *CouncilDirection, panel map[string]bool) {
	from := make([]string, 0, len(d.From))
	authors := map[string]bool{}
	for _, pid := range d.From {
		if p := findSentProposal(c, pid); p != nil && !slices.Contains(from, pid) {
			from = append(from, pid)
			authors[p.Author] = true
		}
	}
	d.From = from
	for expert := range d.Stances {
		if !panel[expert] || authors[expert] {
			delete(d.Stances, expert)
		}
	}
}

// Summarize reruns the synthesis on everything so far and replaces the Summary. A done, stopped or paused council
// goes back to the state it was in (a stopped one is summarized from the rounds that finished); a failed one, whose
// synthesis failed, becomes done. A synthesis that fails leaves the council failed, with Retry on the coordinator. A
// council with no idea sent (every one held or dropped) has nothing to summarize and is refused.
func (r *Runner) Summarize(id string) (*Council, error) {
	r.mu.Lock()
	saved, start, err := r.summarizeLocked(id, "")
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
}

// summarizeLocked starts the synthesis; a model other than "" runs it on that model instead of the coordinator's.
func (r *Runner) summarizeLocked(id string, model string) (*Council, func(), error) {
	if r.Caller == nil {
		return nil, nil, errors.New("the council runner has no caller")
	}
	cur, err := Load(id)
	if err != nil {
		return nil, nil, err
	}
	if r.active[id] != nil {
		return nil, nil, busy(id)
	}
	switch cur.State {
	case StateDone, StateStopped, StateFailed, StateAwaiting:
	default:
		return nil, nil, fmt.Errorf("council %s is %s: there is nothing to summarize", id, cur.State)
	}
	if _, ok := coordinatorExpert(cur); !ok {
		return nil, nil, fmt.Errorf("council %s has no coordinator", id)
	}
	if len(sentProposals(cur)) == 0 { // a held or dropped idea is not out in the room: the synthesis would see none
		return nil, nil, fmt.Errorf("council %s has no sent idea to summarize", id)
	}
	prev := prevOf(cur)
	return r.launchLocked(context.Background(), id, func() (*Council, error) {
		return Update(id, func(c *Council) error {
			c.State, c.Round, c.Error = StateRunning, SynthesisRound(c), ""
			r.beginRun(c)
			return nil
		})
	}, r.summarizeWork(prev, model))
}

// heldRoundAfter is the heldRound a job that hands a council back awaiting-you ends with: the round its drafts belong to,
// so that drive goes on to the next round when the person settled them all while the job ran. 0 for anything else, and
// for the pause after round 1 of a council that holds no drafts, which waits on a Continue.
func heldRoundAfter(prev prevState, snap *Council) int {
	if prev.state == StateAwaiting && HoldsDrafts(snap) {
		return prev.round
	}
	return 0
}

func (r *Runner) summarizeWork(prev prevState, model string) work {
	return func(ctx context.Context, rn *run, id string) ending {
		if err := r.synthesizeOn(ctx, rn, id, model); err != nil {
			if ctx.Err() != nil {
				return ending{}
			}
			return ending{set: synthesisFailed(err)}
		}
		held := 0
		if snap, err := Load(id); err == nil {
			held = heldRoundAfter(prev, snap)
		}
		return ending{
			set: func(c *Council) {
				if prev.state == StateFailed {
					c.State, c.Round, c.Error = StateDone, SynthesisRound(c), ""
					return
				}
				prev.restore(c)
			},
			answers:   prev.state != StateAwaiting,
			heldRound: held,
		}
	}
}

// ---- held drafts ----

// settleDraft settles the held draft itemId on c. send puts it out in the room: a held revision then takes effect on the
// idea it revises. edit replaces its text (an idea's argument, a reply's words) and sends it. drop cancels it, and a
// revision with it. It is an error to name an idea or reply that is not there or not held.
func settleDraft(c *Council, itemId, action, text string) error {
	if p := findProposal(c, itemId); p != nil {
		if p.Draft != DraftHeld {
			return fmt.Errorf("idea %s is not a held draft", itemId)
		}
		switch action {
		case draftDrop:
			p.Draft = DraftDropped
		case draftEdit:
			p.Argument, p.Edited, p.Draft = text, true, ""
		default:
			p.Draft = ""
		}
		return nil
	}
	x := findReply(c, itemId)
	switch {
	case x == nil:
		return fmt.Errorf("council %s has no idea or reply %s", c.Id, itemId)
	case x.Draft != DraftHeld:
		return fmt.Errorf("reply %s is not a held draft", itemId)
	}
	if action == draftDrop {
		x.Draft, x.Revision = DraftDropped, nil
		dropOrphanedPicks(c, x.Author, x.Round)
		return nil
	}
	if action == draftEdit {
		x.Text, x.Edited = text, true
	}
	x.Draft = ""
	if x.Revision != nil {
		if p := findProposal(c, x.ProposalId); p != nil {
			applyRevision(p, *x.Revision)
		}
		x.Revision = nil
	}
	return nil
}

// dropOrphanedPicks takes back a seat's picks when the person dropped everything it answered in the last reply pass: its
// answer is gone, and the picks were part of it. A seat that has an answer left in that round (sent or held, an agreement
// reaction too) keeps its picks.
func dropOrphanedPicks(c *Council, seatId string, round int) {
	if round != SynthesisRound(c)-1 {
		return
	}
	for _, x := range c.Replies {
		if x.Author == seatId && x.Round == round && x.Draft != DraftDropped {
			return
		}
	}
	delete(c.Picks, seatId)
}

// The actions of Draft.
const (
	draftSend = "send"
	draftEdit = "edit"
	draftDrop = "drop"
)

// Draft settles one held draft, an idea or a reply (itemId): action is "send", "edit" (replace the text with text and send
// it) or "drop". An unknown item, or one that is not held, is refused. Settling the last held draft of a council that
// waits on them (awaiting-you) starts the next round at once, or the synthesis after the last reply pass, as Continue
// would: the person's own action, never queued. On a council that is running, stopped, failed or done it only settles
// the draft: the follow-up answer of a done council is settled and the council stays done, and a round that is running
// goes on by itself once none is held.
func (r *Runner) Draft(id, itemId, action, text string) (*Council, error) {
	action, text = strings.ToLower(strings.TrimSpace(action)), strings.TrimSpace(text)
	switch action {
	case draftSend, draftDrop:
	case draftEdit:
		if text == "" {
			return nil, errors.New("an edited draft needs some text")
		}
	default:
		return nil, fmt.Errorf("unknown draft action %q: use %s, %s or %s", action, draftSend, draftEdit, draftDrop)
	}
	r.mu.Lock()
	cur, err := Load(id)
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	var (
		saved *Council
		start func()
	)
	// the last held draft of a council waiting on them starts what comes next; a draft that is not held fails in settleDraft
	if from := cur.Round + 1; cur.State == StateAwaiting && r.active[id] == nil && HeldDrafts(cur) == 1 {
		if r.Caller == nil {
			err = errors.New("the council runner has no caller")
		} else {
			saved, start, err = r.launchLocked(context.Background(), id, func() (*Council, error) {
				return Update(id, func(c *Council) error {
					if err := settleDraft(c, itemId, action, text); err != nil {
						return err
					}
					c.State, c.Round, c.Error = StateRunning, from, ""
					r.beginRun(c)
					return nil
				})
			}, r.roundsWork(from))
		}
	} else {
		saved, err = Update(id, func(c *Council) error { return settleDraft(c, itemId, action, text) })
	}
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	if start != nil {
		start()
	}
	return saved, nil
}

// ---- retry and stop ----

// Retry reruns the failed call of expert expertId in the round it failed in, and clears the failure when it works. The
// coordinator's failure is the synthesis, as Summarize reruns it. A council that is running cannot be retried; wait
// for it or stop it.
func (r *Runner) Retry(id, expertId string) (*Council, error) {
	return r.RetryOn(id, expertId, "")
}

// retryModel is the shape of a model name a retry may run on: a claude alias (sonnet, fable) or a full model id.
var retryModel = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:\[\]-]*$`)

// RetryOn is Retry on model instead of the seat's own, for this retry only: the seat keeps its Model for the calls after
// it, and the council keeps a CouncilRetry when the retry works, which the document names. An empty model, or the seat's
// own, is a plain Retry. A live agent's seat answers with its own session, so it takes no model.
func (r *Runner) RetryOn(id, expertId, model string) (*Council, error) {
	model = strings.TrimSpace(model)
	if model != "" && !retryModel.MatchString(model) {
		return nil, fmt.Errorf("%q is not a model name", model)
	}
	r.mu.Lock()
	saved, start, err := r.retryLocked(id, expertId, model)
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
}

func (r *Runner) retryLocked(id, expertId, model string) (*Council, func(), error) {
	if r.Caller == nil {
		return nil, nil, errors.New("the council runner has no caller")
	}
	cur, err := Load(id)
	if err != nil {
		return nil, nil, err
	}
	if r.active[id] != nil {
		return nil, nil, busy(id)
	}
	f, ok := cur.Failed[expertId]
	if !ok {
		return nil, nil, fmt.Errorf("expert %s has no failed call to retry on council %s", expertId, id)
	}
	idx := slices.IndexFunc(cur.Experts, func(e CouncilExpert) bool { return e.Id == expertId })
	if idx < 0 {
		return nil, nil, fmt.Errorf("council %s has no expert %s", id, expertId)
	}
	e := cur.Experts[idx]
	if model == e.Model {
		model = ""
	}
	if model != "" && IsAgent(e) {
		return nil, nil, fmt.Errorf("%s is a live agent: it answers with its own session's model", e.Name)
	}
	if e.Coordinator {
		return r.summarizeLocked(id, model)
	}
	prev := prevOf(cur)
	return r.launchLocked(context.Background(), id, func() (*Council, error) {
		return Update(id, func(c *Council) error {
			c.State, c.Error = StateRunning, ""
			r.beginRun(c)
			return nil
		})
	}, r.retryWork(e, f, prev, model))
}

// retryWork reruns e's failed call f; with a model it runs on that model and, when the failure clears, keeps a
// CouncilRetry.
func (r *Runner) retryWork(e CouncilExpert, f CouncilFailure, prev prevState, model string) work {
	return func(ctx context.Context, rn *run, id string) ending {
		snap, err := Load(id)
		if err != nil {
			return loadFailed(err)
		}
		r.retrySeat(ctx, rn, id, snap, e, f, model)
		return ending{set: prev.restore, answers: prev.state != StateAwaiting, heldRound: heldRoundAfter(prev, snap)}
	}
}

// retrySeat reruns e's failed call f in the round it failed in, on model when it is set, and keeps a CouncilRetry when
// that answers. Several seats' retries run at once (RetryAll), so it reads snap and never writes it.
func (r *Runner) retrySeat(ctx context.Context, rn *run, id string, snap *Council, e CouncilExpert, f CouncilFailure, model string) {
	was := e.Model
	if model != "" {
		e.Model = model
	}
	start := r.now()
	called := true
	switch {
	case f.Round <= 1:
		r.round1(ctx, rn, id, snap, e)
	case f.Round < SynthesisRound(snap):
		r.round2(ctx, rn, id, snap, e, f.Round)
	default:
		if replies := owed(snap, e, false); len(replies) > 0 {
			r.answerCall(ctx, rn, id, snap, e, replies, f.Round)
		} else {
			called = false
			r.updateLogged(rn, id, func(c *Council) error {
				delete(c.Failed, e.Id)
				return nil
			})
		}
	}
	if model == "" || !called || ctx.Err() != nil {
		return
	}
	_, err := r.update(rn, id, func(c *Council) error {
		if _, failed := c.Failed[e.Id]; failed {
			return errSkip
		}
		if slices.ContainsFunc(c.Retries, func(k CouncilRetry) bool { return k.Auto && k.Expert == e.Id && k.Ts >= start }) {
			return errSkip // the retry fell back past model to Opus 4.8, and finishCall kept that
		}
		c.Retries = append(c.Retries, CouncilRetry{Expert: e.Id, Round: f.Round, Model: model, Was: was, Ts: r.now()})
		return nil
	})
	if err != nil && !errors.Is(err, errSkip) {
		log.Printf("[council] %s: save failed: %v", id, err)
	}
}

// RetryAll reruns every failed call but the coordinator's (the synthesis keeps its own Retry, as it reads what these
// bring back) in one run, the seats at once: one Retry each would be refused while the first runs. models picks a seat's
// model for this retry only, by expert id; a seat it leaves out, or names its own model for, retries on its own. A
// live agent's seat takes no model.
func (r *Runner) RetryAll(id string, models map[string]string) (*Council, error) {
	clean := map[string]string{}
	for k, m := range models {
		if m = strings.TrimSpace(m); m != "" {
			if !retryModel.MatchString(m) {
				return nil, fmt.Errorf("%q is not a model name", m)
			}
			clean[k] = m
		}
	}
	r.mu.Lock()
	saved, start, err := r.retryAllLocked(id, clean)
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
}

// retrySeatJob is one seat a RetryAll reruns: the seat, its failure and the model it retries on ("" for its own).
type retrySeatJob struct {
	e     CouncilExpert
	f     CouncilFailure
	model string
}

func (r *Runner) retryAllLocked(id string, models map[string]string) (*Council, func(), error) {
	if r.Caller == nil {
		return nil, nil, errors.New("the council runner has no caller")
	}
	cur, err := Load(id)
	if err != nil {
		return nil, nil, err
	}
	if r.active[id] != nil {
		return nil, nil, busy(id)
	}
	byId := map[string]CouncilExpert{}
	for _, e := range cur.Experts {
		byId[e.Id] = e
	}
	for k := range models {
		if _, ok := byId[k]; !ok {
			return nil, nil, fmt.Errorf("council %s has no expert %s", id, k)
		}
	}
	var jobs []retrySeatJob
	for _, e := range cur.Experts { // in panel order, so the seats start as the council lists them
		f, failed := cur.Failed[e.Id]
		if !failed || e.Coordinator {
			continue
		}
		model := models[e.Id]
		if model == e.Model {
			model = ""
		}
		if model != "" && IsAgent(e) {
			return nil, nil, fmt.Errorf("%s is a live agent: it answers with its own session's model", e.Name)
		}
		jobs = append(jobs, retrySeatJob{e: e, f: f, model: model})
	}
	if len(jobs) == 0 {
		return nil, nil, fmt.Errorf("council %s has no failed seat to retry (a failed summary is retried on its own)", id)
	}
	prev := prevOf(cur)
	return r.launchLocked(context.Background(), id, func() (*Council, error) {
		return Update(id, func(c *Council) error {
			c.State, c.Error = StateRunning, ""
			r.beginRun(c)
			return nil
		})
	}, func(ctx context.Context, rn *run, id string) ending {
		snap, err := Load(id)
		if err != nil {
			return loadFailed(err)
		}
		var wg sync.WaitGroup
		for _, j := range jobs {
			wg.Go(func() { r.retrySeat(ctx, rn, id, snap, j.e, j.f, j.model) })
		}
		wg.Wait()
		return ending{set: prev.restore, answers: prev.state != StateAwaiting, heldRound: heldRoundAfter(prev, snap)}
	})
}

// Stop cancels the calls in flight, keeps the rounds that finished, and leaves the council stopped. It returns when the
// run has saved that. A council that is not running comes back as it was, except one paused after round 1, which
// ends there, and one that is queued, which leaves the queue stopped and never runs. A paused council that ends here
// saves its document like one whose run ends.
func (r *Runner) Stop(id string) (*Council, error) {
	r.mu.Lock()
	rn := r.active[id]
	if rn == nil {
		wasQueued := false
		c, err := Update(id, func(c *Council) error {
			if c.State != StateAwaiting && c.State != StateRunning && c.State != StateQueued {
				return errSkip
			}
			wasQueued = c.State == StateQueued
			c.State, c.Error, c.Activity, c.QueuedAfter = StateStopped, "", nil, ""
			c.RunStarted = 0 // no run is behind it (paused or queued): there is no span to add
			return nil
		})
		r.mu.Unlock()
		switch {
		case errors.Is(err, errSkip):
			return Load(id)
		case err != nil:
			return nil, err
		}
		r.changed(c)
		if !wasQueued {
			c = r.saveDocument(c)
		}
		return c, nil
	}
	rn.cancel()
	r.mu.Unlock()
	select {
	case <-rn.done:
	case <-time.After(stopWait):
	}
	return Load(id)
}

// endedLocked loads a council that nothing works on: done, failed, stopped or not-run. A council that is running, waits
// on the person or waits in the queue is refused (`what` names the refused action); stop it first. The caller holds r.mu.
func (r *Runner) endedLocked(id, what string) (*Council, error) {
	if r.active[id] != nil {
		return nil, busy(id)
	}
	c, err := Load(id)
	if err != nil {
		return nil, err
	}
	switch c.State {
	case StateRunning, StateAwaiting, StateQueued:
		return nil, fmt.Errorf("council %s is %s: stop it before %s it", id, c.State, what)
	}
	return c, nil
}

// SetPinned pins a council (the tree keeps it at the top of its project) or unpins it, in any state, running ones too:
// a run never touches Pinned. Pinning a pinned council keeps its first time, and the pin leaves Updated as it was
// (UpdateMark), so it never moves an ended council's time in the tree. It reports the save.
func (r *Runner) SetPinned(id string, pinned bool) (*Council, error) {
	r.mu.Lock()
	c, err := UpdateMark(id, func(c *Council) error {
		if !pinned {
			c.Pinned = 0
		} else if c.Pinned == 0 {
			c.Pinned = r.now()
		}
		return nil
	})
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(c)
	return c, nil
}

// Delete removes an ended council (endedLocked): its file goes to the trash (~/.arc/trash, which empties itself after
// a while), and the document it wrote into the project stays. It returns the council as it was, for its project.
func (r *Runner) Delete(id string) (*Council, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, err := r.endedLocked(id, "removing")
	if err != nil {
		return nil, err
	}
	if err := Remove(id); err != nil {
		return nil, err
	}
	return c, nil
}

// MarkStale turns every council left running (wavesrv quit mid-round) into a stopped one that says so. A council left
// queued stays queued: StartNext starts it. Call it once at startup, before any council runs.
//
// It also routes, in the background, every message of the person's the router had not answered when wavesrv quit, in a
// council in any state: in a done or stopped one no pass would come to do it, and its post would read "Router is choosing
// a seat…" for good. That settles the pick and its line and no more: the reply stays open and unanswered, and the answers
// pass of the next follow-up the council runs (the next message the person sends) answers it with the rest.
func (r *Runner) MarkStale() {
	list, err := List("")
	if err != nil {
		log.Printf("[council] stale councils not marked: %v", err)
		return
	}
	for _, c := range list {
		if c.State != StateRunning {
			continue
		}
		r.mu.Lock()
		var saved *Council
		if r.active[c.Id] == nil {
			saved, err = Update(c.Id, func(c *Council) error {
				if c.State != StateRunning {
					return errSkip
				}
				c.State, c.Activity = StateStopped, nil
				c.RunStarted = 0 // the run's end was lost with wavesrv: its span is not known, so nothing is added
				c.Error = fmt.Sprintf("arcterm closed during round %d", c.Round)
				return nil
			})
		}
		r.mu.Unlock()
		if err != nil && !errors.Is(err, errSkip) {
			log.Printf("[council] %s: not marked stopped: %v", c.Id, err)
		}
		r.changed(saved)
		err = nil
	}
	for _, c := range list {
		if slices.ContainsFunc(c.Replies, awaitsRoute) {
			inBackground(func(ctx context.Context) { r.routePending(ctx, c.Id) })
		}
	}
}

// waitQueuedPoll is how often Wait looks again at a council that waits in the queue.
const waitQueuedPoll = 20 * time.Millisecond

// Wait returns the council once nothing is working on it: its state is done, not-run, stopped, failed or awaiting-you.
// A queued council is waited through, to the end of its run. It returns early with ctx's error when ctx ends, and with
// an error for a council that is marked running with no run behind it.
func (r *Runner) Wait(ctx context.Context, id string) (*Council, error) {
	for {
		r.mu.Lock()
		rn := r.active[id]
		r.mu.Unlock()
		if rn != nil {
			select {
			case <-rn.done:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		c, err := Load(id)
		if err != nil {
			return nil, err
		}
		if c.State == StateQueued {
			select {
			case <-time.After(waitQueuedPoll):
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		if c.State == StateRunning {
			r.mu.Lock()
			live := r.active[id] != nil // the queue may have started it since the check above
			r.mu.Unlock()
			if live {
				continue
			}
			return c, fmt.Errorf("council %s is marked running but nothing is running it", id)
		}
		return c, nil
	}
}

// ---- Setup's suggestion ----

const suggestShape = `{
  "files": ["pkg/services/idle.go", "docs/spec.md"],
  "roles": [
    {"name": "Mac user", "brief": "the angle this role reviews from, and what counts as evidence", "why": "the frame reload is Windows-only for now"}
  ],
  "group": "ui-feature",
  "mode": "review",
  "modewhy": "a spec that exists and is waiting to be judged"
}`

const maxSuggestedRoles = 2

func suggestPrompt(project, feature, question string, files []string, roles []CouncilExpert, groups []CouncilGroup) string {
	names := map[string]string{}
	for _, role := range roles {
		names[role.Id] = role.Name
	}
	var b strings.Builder
	b.WriteString("You are the coordinator of a council that is about to review one feature of a project, or to brainstorm " +
		"ideas for a problem or goal in it. You have Read, Grep and Glob in the project folder; you read and never edit " +
		"anything.\n\n")
	fmt.Fprintf(&b, "Feature: %s\n", feature)
	if q := strings.TrimSpace(question); q != "" {
		fmt.Fprintf(&b, "Question for the council: %s\n", q)
	}
	fmt.Fprintf(&b, "Project folder: %s\n", project)
	if len(files) > 0 {
		b.WriteString("\nFiles the person already picked:\n")
		for _, f := range files {
			fmt.Fprintf(&b, "- %s\n", f)
		}
	}
	b.WriteString("\nThe groups the person can pick from (id: name, then its roles):\n")
	for _, g := range groups {
		var members []string
		for _, id := range g.Roles {
			if n := names[id]; n != "" {
				members = append(members, n)
			}
		}
		fmt.Fprintf(&b, "- %s: %s (%s)\n", g.Id, g.Name, strings.Join(members, ", "))
	}
	b.WriteString("\nRead what you need of the files above and the code around them, then do four things.\n\n")
	b.WriteString("1. Name the project files the experts should read first, as paths relative to the project folder: the " +
		"few the review hinges on, at most eight. Name files that exist.\n")
	fmt.Fprintf(&b, "2. Suggest up to %d extra roles this feature needs that the group lacks, each with a name, a brief "+
		"(the angle it reviews from and what counts as evidence) and a one-line why. Suggest none when the group fits.\n", maxSuggestedRoles)
	b.WriteString("3. Name the id of the group above that fits best, or leave it empty when none does.\n")
	b.WriteString("4. Name the council's mode in \"mode\", with a one-line reason in \"modewhy\": \"" + ModeBrainstorm + "\" when " +
		"the feature and the question are a problem or a goal with no answer yet (\"how do we…\", \"what should…\"), \"" +
		ModeReview + "\" when they are a thing to judge (a feature, a spec, a plan or a draft that exists; \"review this\", " +
		"\"what's wrong with…\"). A brainstorm fits a group made for ideas, a review one made for judging.\n\n")
	b.WriteString(jsonRule + "\n```json\n" + suggestShape + "\n```\n")
	return b.String()
}

// slugOf is a role name as an id: lower case words joined with hyphens.
func slugOf(name string) string {
	var b strings.Builder
	hyphen := false
	for _, r := range strings.ToLower(name) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if hyphen && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			hyphen = false
		} else {
			hyphen = true
		}
	}
	return b.String()
}

func parseSuggestion(reply string, roles []CouncilExpert, groups []CouncilGroup) (CouncilSuggestion, error) {
	var raw struct {
		Files []string `json:"files"`
		Roles []struct {
			Name  string `json:"name"`
			Brief string `json:"brief"`
			Why   string `json:"why"`
		} `json:"roles"`
		Group   string `json:"group"`
		Mode    string `json:"mode"`
		ModeWhy string `json:"modewhy"`
	}
	if err := decodeReply(reply, "suggestion", &raw); err != nil {
		return CouncilSuggestion{}, err
	}
	out := CouncilSuggestion{Files: []string{}, Roles: []CouncilExpert{}}
	for _, f := range raw.Files {
		if f = strings.TrimSpace(f); f != "" && !slices.Contains(out.Files, f) {
			out.Files = append(out.Files, f)
		}
	}
	taken := map[string]bool{}
	for _, role := range roles {
		taken[role.Id] = true
	}
	for _, role := range raw.Roles {
		name, why := strings.TrimSpace(role.Name), strings.TrimSpace(role.Why)
		id := slugOf(name)
		if len(out.Roles) == maxSuggestedRoles || id == "" || id == YouId || taken[id] {
			continue // a role of that name is in the library already
		}
		taken[id] = true
		angle := strings.TrimSpace(role.Brief)
		if angle == "" {
			angle = fmt.Sprintf("You review the feature as the %s. %s", name, why)
		}
		out.Roles = append(out.Roles, CouncilExpert{Id: id, Name: name, Brief: brief(angle), Model: ModelExpert, Why: why})
	}
	if g := strings.TrimSpace(raw.Group); slices.ContainsFunc(groups, func(x CouncilGroup) bool { return x.Id == g }) {
		out.Group = g
	}
	// a mode the model made up comes back empty, and a reason with no mode is a reason for nothing
	if m := strings.ToLower(strings.TrimSpace(raw.Mode)); m == ModeReview || m == ModeBrainstorm {
		out.Mode, out.ModeWhy = m, strings.Join(strings.Fields(raw.ModeWhy), " ")
	}
	return out, nil
}

// Suggest makes the one sonnet call behind Setup's dashed rows: it reads the project with the read-only tools and
// names the files the experts should read, up to two extra roles, the group that fits the feature best, and the mode
// the question reads as with its reason. A group or a mode it names that does not exist comes back empty. The groups
// made for seated chats are neither offered nor accepted: Setup has seated none yet, and each is a panel of one.
func (r *Runner) Suggest(ctx context.Context, project, feature, question string, files []string) (CouncilSuggestion, error) {
	if r.Caller == nil {
		return CouncilSuggestion{}, errors.New("the council runner has no caller")
	}
	if strings.TrimSpace(project) == "" || strings.TrimSpace(feature) == "" {
		return CouncilSuggestion{}, errors.New("a suggestion needs a project folder and a feature")
	}
	roles := Roles()
	groups := slices.DeleteFunc(Groups(), func(g CouncilGroup) bool { return g.Id == AgentsGroupId || g.Id == AgentsIdeasGroupId })
	asker := CouncilExpert{Id: "suggest", Name: "Coordinator", Model: ModelExpert}
	res, err := r.Caller.Call(ctx, CallReq{
		Expert: asker, Cwd: project, Tools: true,
		Prompt: suggestPrompt(project, feature, question, files, roles, groups),
	})
	if err == nil {
		err = emptyReply(res)
	}
	if err != nil {
		return CouncilSuggestion{}, err
	}
	return parseSuggestion(res.Text, roles, groups)
}
