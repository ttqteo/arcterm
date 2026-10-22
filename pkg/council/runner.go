// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/ideastore"
)

// Runner runs councils: the three rounds, the pause, the person's replies and follow-ups, retry and stop. Every
// entry point that starts work (Start, StartSaved, Continue, Reply, Summarize, Retry) saves the council as running
// and returns it at once; the calls run in a goroutine, and Wait or the OnChange events say when they end. A council
// has at most one such goroutine at a time. Every change goes through the store's package Update.
//
// A Runner must not be copied after first use.
type Runner struct {
	Caller Caller
	// OnChange is told after each save, with the council as saved. It may be called from several goroutines at once, and
	// the council is the callee's to read, not to change.
	OnChange func(c *Council)
	// Now is the clock in milliseconds; nil is the wall clock.
	Now func() int64

	mu     sync.Mutex // guards active, and orders a reply against the end of a run
	active map[string]*run
}

const (
	actStarting = "Starting"
	actSummary  = "Writing the summary"
	actPerson   = "Replying to the person"

	// maxPasses stops a run that keeps finding replies to answer, which only a store that cannot save can cause.
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
// answered first.
type ending struct {
	set     func(c *Council)
	answers bool
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

func validateCouncil(c *Council) error {
	if strings.TrimSpace(c.Feature) == "" {
		return errors.New("a council needs a feature to review")
	}
	if strings.TrimSpace(c.Project) == "" {
		return errors.New("a council needs a project folder")
	}
	seen := map[string]bool{}
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
	c.Activity, c.Failed, c.Stats = nil, nil, nil
	c.Tokens, c.Calls, c.Started, c.Error = 0, 0, 0, ""
}

func (r *Runner) beginFresh(c *Council) {
	c.State, c.Round, c.Started, c.Error = StateRunning, 1, r.now(), ""
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
// pauses, rounds 2 and 3. It returns the saved council at once. Cancelling ctx stops the council as Stop does; a
// caller that wants it to outlive the request passes a background context.
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
	saved, start, err := r.launchLocked(ctx, cp.Id, func() (*Council, error) {
		r.beginFresh(&cp)
		if err := Save(&cp); err != nil {
			return nil, err
		}
		return &cp, nil
	}, r.roundsWork(1))
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
}

// StartSaved runs a council saved as not-run, as Start does.
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
	saved, start, err := r.launchLocked(ctx, id, func() (*Council, error) {
		return Update(id, func(c *Council) error {
			r.beginFresh(c)
			return nil
		})
	}, r.roundsWork(1))
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
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
// either lands before it and is answered, or finds the run gone and starts a follow-up.
func (r *Runner) drive(ctx context.Context, rn *run, id string, w work) {
	defer close(rn.done)
	defer rn.cancel()
	var end ending
	if ctx.Err() == nil { // a Stop can land between the launch and the goroutine's first step
		end = w(ctx, rn, id)
	}
	for passes := 0; ; passes++ {
		r.mu.Lock()
		if end.answers && ctx.Err() == nil && passes < maxPasses {
			if c, err := Load(id); err == nil && hasOpenReplies(c) {
				r.mu.Unlock()
				if err := r.answersPass(ctx, rn, id); err != nil {
					log.Printf("[council] %s: answers pass: %v", id, err)
					end.answers = false
				}
				continue
			}
		}
		final := r.finishLocked(ctx, id, end)
		r.mu.Unlock()
		r.changed(final)
		return
	}
}

func (r *Runner) finishLocked(ctx context.Context, id string, end ending) *Council {
	defer delete(r.active, id)
	stopped := ctx.Err() != nil
	c, err := Update(id, func(c *Council) error {
		c.Activity = nil
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

// roundsWork is round 1 (when from is 1), the pause after it, round 2 and the synthesis.
func (r *Runner) roundsWork(from int) work {
	return func(ctx context.Context, rn *run, id string) ending {
		if from <= 1 {
			snap, err := Load(id)
			if err != nil {
				return loadFailed(err)
			}
			forEachExpert(panelOf(snap), func(e CouncilExpert) { r.round1(ctx, rn, id, snap, e) })
			if ctx.Err() != nil {
				return ending{}
			}
			cur, err := Load(id)
			if err != nil {
				return loadFailed(err)
			}
			switch {
			case everyoneFailedRound1(cur):
				return ending{set: func(c *Council) { c.State, c.Error = StateFailed, "every expert failed in round 1" }}
			case cur.PauseAfterRound1:
				return ending{set: func(c *Council) { c.State, c.Round, c.Error = StateAwaiting, 1, "" }}
			}
			r.setRound(rn, id, 2)
		}
		if err := r.round2Phase(ctx, rn, id); err != nil {
			return loadFailed(err)
		}
		if ctx.Err() != nil {
			return ending{}
		}
		r.setRound(rn, id, 3)
		if err := r.synthesize(ctx, rn, id); err != nil {
			if ctx.Err() != nil {
				return ending{}
			}
			return ending{set: synthesisFailed(err)}
		}
		return ending{set: func(c *Council) { c.State, c.Round, c.Error = StateDone, 3, "" }, answers: true}
	}
}

func everyoneFailedRound1(c *Council) bool {
	panel := panelOf(c)
	for _, e := range panel {
		if f, ok := c.Failed[e.Id]; !ok || f.Round != 1 {
			return false
		}
	}
	return len(panel) > 0
}

func synthesisFailed(err error) func(c *Council) {
	return func(c *Council) { c.State, c.Round, c.Error = StateFailed, 3, "round 3: "+errText(err) }
}

func (r *Runner) setRound(rn *run, id string, round int) {
	r.updateLogged(rn, id, func(c *Council) error {
		c.Round = round
		return nil
	})
}

// call makes one expert call: it starts the expert's clock, shows what it is doing, and keeps that current from the
// call's tool events. It returns what the Caller returned.
func (r *Runner) call(ctx context.Context, rn *run, id string, e CouncilExpert, snap *Council, prompt string, tools bool, first CouncilActivity) (CallRes, error) {
	rn.begin(e.Id, callClock{start: r.now(), base: snap.Stats[e.Id].Ms})
	r.updateLogged(rn, id, func(c *Council) error {
		setActivity(c, e.Id, first)
		return nil
	})
	req := CallReq{Expert: e, Cwd: snap.Project, Prompt: prompt, Tools: tools}
	if tools {
		req.OnTool = func(text string) {
			act := first
			act.Text = text
			r.updateLogged(rn, id, func(c *Council) error {
				setActivity(c, e.Id, act)
				return nil
			})
		}
	}
	return r.Caller.Call(ctx, req)
}

// finishCall saves the end of one expert call. Its time and tokens are booked whatever happened. A call that ended
// because the run was stopped is neither a failure nor a result; any other error is the expert's failure in round;
// and on success apply adds what the call produced.
func (r *Runner) finishCall(ctx context.Context, rn *run, id string, e CouncilExpert, res CallRes, err error, round int, apply func(c *Council)) {
	cancelled := err != nil && ctx.Err() != nil
	r.updateLogged(rn, id, func(c *Council) error {
		if k, ok := rn.end(e.Id); ok {
			st := c.Stats[e.Id]
			st.Ms = k.base + max(0, r.now()-k.start)
			setStat(c, e.Id, st)
		}
		st := c.Stats[e.Id]
		st.Calls++
		st.Tokens += res.Tokens
		setStat(c, e.Id, st)
		c.Calls++
		c.Tokens += res.Tokens
		delete(c.Activity, e.Id)
		switch {
		case cancelled:
		case err != nil:
			setFailed(c, e.Id, CouncilFailure{Round: round, Error: errText(err)})
		default:
			delete(c.Failed, e.Id)
			apply(c)
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

func (r *Runner) round1(ctx context.Context, rn *run, id string, snap *Council, e CouncilExpert) {
	res, err := r.call(ctx, rn, id, e, snap, Round1Prompt(snap, e), true, CouncilActivity{Text: actStarting})
	var props []CouncilProposal
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		props, _, err = ParseRound1(res.Text) // the overall view has no field on the council, so it is not kept
	}
	r.finishCall(ctx, rn, id, e, res, err, 1, func(c *Council) {
		for _, p := range props {
			p.Id, p.Author, p.Ts = nextProposalId(c), e.Id, r.now()
			c.Proposals = append(c.Proposals, p)
		}
	})
}

// ---- round 2 ----

// round2Phase has every expert that proposed review the others' proposals, at once and from text. An expert whose
// round 1 call failed sits it out.
func (r *Runner) round2Phase(ctx context.Context, rn *run, id string) error {
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
		if pr.Author == YouId && !pr.Answered {
			asks = append(asks, pr.Id)
		}
	}
	forEachExpert(experts, func(e CouncilExpert) { r.round2(ctx, rn, id, snap, e) })
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
	for _, p := range c.Proposals {
		if p.Author != e.Id && !p.Cut {
			return &CouncilActivity{Text: "Replying to " + speaker(c, p.Author), ProposalId: p.Id}
		}
	}
	if asks := unansweredFor(c, e.Id); len(asks) > 0 {
		return &CouncilActivity{Text: actPerson, ProposalId: asks[0].ProposalId, ParentId: asks[0].Id}
	}
	return nil
}

func (r *Runner) round2(ctx context.Context, rn *run, id string, snap *Council, e CouncilExpert) {
	view := withOpenAsks(snap, e)
	target := round2Target(view, e)
	if target == nil {
		return
	}
	res, err := r.call(ctx, rn, id, e, view, Round2Prompt(view, e), false, *target)
	var out Round2Result
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		out, err = ParseRound2(res.Text)
	}
	r.finishCall(ctx, rn, id, e, res, err, 2, func(c *Council) { applyRound2(c, e, out, r.now()) })
}

func hasStance(c *Council, proposalId, expertId string) bool {
	for _, x := range c.Replies {
		if x.ProposalId == proposalId && x.Author == expertId && x.ParentId == "" && x.Stance != "" {
			return true
		}
	}
	return false
}

// challengeTo is the latest challenge or opposition to a proposal from someone other than its author, the reply a
// revision of that proposal answers.
func challengeTo(c *Council, proposalId, authorId string) string {
	for i := len(c.Replies) - 1; i >= 0; i-- {
		x := c.Replies[i]
		if x.ProposalId == proposalId && x.ParentId == "" && x.Author != authorId && x.Author != YouId &&
			(x.Stance == StanceChallenge || x.Stance == StanceOppose) {
			return x.Id
		}
	}
	return ""
}

// applyRound2 turns one expert's round 2 reply into replies on the council. The model names the ids, so each is
// checked: a stance on an unknown, cut or own proposal is dropped, and so is a revision of someone else's proposal.
func applyRound2(c *Council, e CouncilExpert, res Round2Result, now int64) {
	for _, s := range res.Stances {
		p := findProposal(c, s.ProposalId)
		if p == nil || p.Author == e.Id || p.Cut || hasStance(c, p.Id, e.Id) {
			continue
		}
		if strings.TrimSpace(s.Reason) == "" && s.Stance != StanceAccept { // an accept needs no words; a doubt or an objection does
			continue
		}
		c.Replies = append(c.Replies, CouncilReply{
			Id: nextReplyId(c), ProposalId: p.Id, Author: e.Id, Stance: s.Stance,
			Text: s.Reason, Evidence: s.Evidence, Round: 2, Ts: now,
		})
	}
	for _, rv := range res.Revisions {
		p := findProposal(c, rv.ProposalId)
		if p == nil || p.Author != e.Id || p.Withdrawn {
			continue
		}
		var text string
		if rv.Withdraw {
			p.Withdrawn, text = true, "Withdrawn."
		} else {
			var parts []string
			if rv.Title != "" && rv.Title != p.Title {
				p.Title = rv.Title
				parts = append(parts, "Retitled: "+rv.Title+".")
			}
			if rv.Argument != "" {
				p.Argument = rv.Argument
				parts = append(parts, rv.Argument)
			}
			if len(parts) == 0 {
				continue
			}
			text = strings.Join(parts, " ")
		}
		c.Replies = append(c.Replies, CouncilReply{
			Id: nextReplyId(c), ProposalId: p.Id, ParentId: challengeTo(c, p.Id, e.Id), Author: e.Id,
			Revised: true, Text: text, Round: 2, Ts: now,
		})
	}
	applyPicks(c, e, res.Picks)
	applyAnswers(c, e, res.Answers, 2, now)
}

// applyPicks keeps an expert's picks that name another expert's proposal still in the running, at most maxPicks, in
// the order given. The model names the ids, so each is checked like a stance.
func applyPicks(c *Council, e CouncilExpert, picks []string) {
	var kept []string
	for _, id := range picks {
		p := findProposal(c, id)
		if p == nil || p.Author == e.Id || p.Cut || p.Withdrawn || slices.Contains(kept, id) || len(kept) == maxPicks {
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

func markAnswered(c *Council, ids []string) {
	for i := range c.Replies {
		if slices.Contains(ids, c.Replies[i].Id) {
			c.Replies[i].Answered = true
		}
	}
}

// applyAnswers adds an expert's answers under the person's replies. An answer to a reply the expert was not asked, or
// has already answered, is dropped.
func applyAnswers(c *Council, e CouncilExpert, answers []Answer, round int, now int64) {
	for _, a := range answers {
		pr := findReply(c, a.ReplyId)
		if pr == nil || pr.Author != YouId || !slices.Contains(pr.To, e.Id) || answeredBy(c, pr.Id, e.Id) {
			continue
		}
		c.Replies = append(c.Replies, CouncilReply{
			Id: nextReplyId(c), ProposalId: pr.ProposalId, ParentId: pr.Id, Author: e.Id, Stance: a.Stance,
			Text: a.Text, Evidence: a.Evidence, Round: round, Ts: now,
		})
	}
}

// answerCall asks one expert to answer the replies it owes, and saves its answers as replies of the given round. It has
// the read-only tools when a reply asked for them (Let them read code).
func (r *Runner) answerCall(ctx context.Context, rn *run, id string, snap *Council, e CouncilExpert, replies []CouncilReply, round int) {
	tools := false
	for _, pr := range replies {
		tools = tools || pr.Tools
	}
	first := CouncilActivity{Text: actPerson, ProposalId: replies[0].ProposalId, ParentId: replies[0].Id}
	res, err := r.call(ctx, rn, id, e, snap, AnswersPrompt(snap, e, replies), tools, first)
	var answers []Answer
	if err == nil {
		err = emptyReply(res)
	}
	if err == nil {
		answers, err = ParseAnswers(res.Text)
	}
	r.finishCall(ctx, rn, id, e, res, err, round, func(c *Council) { applyAnswers(c, e, answers, round, r.now()) })
}

// answersPass has every expert the person's open replies are addressed to answer them, at once. The Summary is not
// rerun. Each reply is marked answered when the pass ends, whatever came of its calls: a call that failed is on
// the council's Failed list with its Retry, and an expert already on that list sits the pass out until it is retried.
func (r *Runner) answersPass(ctx context.Context, rn *run, id string) error {
	snap, err := Load(id)
	if err != nil {
		return err
	}
	round := max(3, snap.Round)
	var open []string
	for _, pr := range snap.Replies {
		if pr.Author == YouId && !pr.Answered {
			open = append(open, pr.Id)
		}
	}
	type ask struct {
		e       CouncilExpert
		replies []CouncilReply
	}
	var asks []ask
	for _, e := range panelOf(snap) {
		if _, bad := snap.Failed[e.Id]; bad {
			continue
		}
		if replies := owed(snap, e, true); len(replies) > 0 {
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
	if ctx.Err() != nil {
		return nil
	}
	_, err = r.update(rn, id, func(c *Council) error {
		markAnswered(c, open)
		return nil
	})
	return err
}

func isWordRune(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' }

// mentions reports whether text holds token as a whole word, not inside an address or a longer name.
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
			return true
		}
		from = i + 1
	}
	return false
}

// mentioned are the experts a reply @-mentions by name or id, in the council's order.
func mentioned(c *Council, text string) []string {
	lower := strings.ToLower(text)
	var out []string
	for _, e := range panelOf(c) {
		for _, key := range []string{e.Name, e.Id} {
			if key != "" && mentions(lower, "@"+strings.ToLower(key)) {
				out = append(out, e.Id)
				break
			}
		}
	}
	return out
}

// replyTargets are the experts the person's reply goes to: the ones it @-mentions; else, in a branch, the proposal's
// author and every expert on the path to the parent; else, with no proposal and no parent, the whole panel.
func replyTargets(c *Council, proposalId string, parent *CouncilReply, text string) []string {
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

// appendPersonReply adds the person's reply to c, in the round c is in. A reply to a reply takes the proposal of its
// parent; it is an error to name a proposal or a parent that is not there.
func appendPersonReply(c *Council, proposalId, parentId, text string, tools bool, now int64) error {
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
	to := replyTargets(c, proposalId, parent, text)
	c.Replies = append(c.Replies, CouncilReply{
		Id: nextReplyId(c), ProposalId: proposalId, ParentId: parentId, Author: YouId, Text: text,
		To: to, Tools: tools, Round: c.Round, Ts: now,
	})
	return nil
}

// followRound is the round number of a follow-up: 4 for the first, then one more for each after.
func followRound(c *Council) int {
	last := 0
	for _, pr := range c.Replies {
		last = max(last, pr.Round)
	}
	return max(4, last+1)
}

// Reply posts the person's reply on a proposal (proposalId), under another reply (parentId), or, with neither, to the
// whole council. It goes to the experts in its branch unless the text @-mentions some. Posted before round 2, or while
// the council waits on the person, it is answered in round 2; posted while a run is on, it is answered by the pass
// after the synthesis; posted to a council that is done, stopped or failed, it starts a follow-up round at once,
// with tools when the person turned Let them read code on, and the council returns to the state it was in.
func (r *Runner) Reply(id, proposalId, parentId, text string, tools bool) (*Council, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, errors.New("a reply needs some text")
	}
	r.mu.Lock()
	cur, err := Load(id)
	if err == nil && cur.State == StateNotRun {
		err = fmt.Errorf("council %s has not started: there is nothing to reply to", id)
	}
	if err == nil && r.Caller == nil {
		err = errors.New("the council runner has no caller")
	}
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	add := func(c *Council) error { return appendPersonReply(c, proposalId, parentId, text, tools, r.now()) }
	var (
		saved *Council
		start func()
	)
	if r.active[id] == nil && (cur.State == StateDone || cur.State == StateStopped || cur.State == StateFailed) {
		prev := prevOf(cur)
		saved, start, err = r.launchLocked(context.Background(), id, func() (*Council, error) {
			return Update(id, func(c *Council) error {
				c.State, c.Round, c.Error = StateRunning, followRound(c), ""
				return add(c)
			})
		}, r.followupWork(prev))
	} else {
		saved, err = Update(id, add)
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
// whole council, and runs round 2 and the synthesis on what is left.
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
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
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
			c.State, c.Round, c.Error = StateRunning, 2, ""
			return nil
		})
	}, r.roundsWork(2))
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
	snap, err := Load(id)
	if err != nil {
		return err
	}
	coord, ok := coordinatorExpert(snap)
	if !ok {
		return errors.New("the council has no coordinator")
	}
	at := r.now() // the Summary reads what was said up to now; a reply posted while it is written reads as newer
	res, err := r.call(ctx, rn, id, coord, snap, SynthesisPrompt(snap), false, CouncilActivity{Text: actSummary})
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
		addIdeas(snap, &sum)
	}
	r.finishCall(ctx, rn, id, coord, res, err, 3, func(c *Council) {
		c.Summary = &sum
		MarkWeak(c, weak)
	})
	return err
}

// cleanSummary drops what the coordinator named that is not on the council: a proposal that does not exist, an
// expert that is not on the panel, and a stance from the author of a proposal the direction merges.
func cleanSummary(c *Council, s CouncilSummary) CouncilSummary {
	if strings.TrimSpace(c.Question) == "" {
		s.Answer = "" // nothing was asked, so there is nothing to answer
	}
	panel := map[string]bool{}
	for _, e := range panelOf(c) {
		panel[e.Id] = true
	}
	for i := range s.Directions {
		d := &s.Directions[i]
		from := make([]string, 0, len(d.From))
		authors := map[string]bool{}
		for _, pid := range d.From {
			if p := findProposal(c, pid); p != nil && !slices.Contains(from, pid) {
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
	outcomes := map[string]string{}
	for pid, o := range s.Outcomes {
		if o = strings.TrimSpace(o); o != "" && findProposal(c, pid) != nil {
			outcomes[pid] = o
		}
	}
	s.Outcomes = outcomes
	return s
}

func titleKey(title string) string { return strings.ToLower(strings.Join(strings.Fields(title), " ")) }

// firstSentence is text up to its first full stop, question mark or exclamation mark followed by a space, or all of it.
func firstSentence(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	for i, r := range text {
		if (r == '.' || r == '?' || r == '!') && (i+1 == len(text) || text[i+1] == ' ') {
			return text[:i+1]
		}
	}
	return text
}

func ideaText(d CouncilDirection) string {
	if s := firstSentence(d.Reasoning); s != "" {
		return d.Title + ": " + s
	}
	return d.Title
}

// ideaTopic is "Council · <feature>", cut to the 40 runes an Ideas topic may hold.
func ideaTopic(feature string) string {
	const prefix, limit = "Council · ", 40
	f := []rune(strings.Join(strings.Fields(feature), " "))
	if room := limit - utf8.RuneCountInString(prefix); len(f) > room {
		f = append(f[:room-1], '…')
	}
	return prefix + string(f)
}

// addIdeas files each direction of sum as an idea in the Ideas of the session that started the council, and keeps the
// id on the direction. A direction whose title the previous Summary already had keeps that idea and adds no new one.
func addIdeas(snap *Council, sum *CouncilSummary) {
	if snap.SessionId == "" {
		return
	}
	known := map[string]string{}
	if snap.Summary != nil {
		for _, d := range snap.Summary.Directions {
			if d.IdeaId != "" {
				known[titleKey(d.Title)] = d.IdeaId
			}
		}
	}
	for i := range sum.Directions {
		d := &sum.Directions[i]
		if ideaId, ok := known[titleKey(d.Title)]; ok {
			d.IdeaId = ideaId
			continue
		}
		idea, err := ideastore.Add(snap.SessionId, ideaText(*d), ideastore.KindIdea, ideastore.ByAgent, ideaTopic(snap.Feature))
		if err != nil {
			log.Printf("[council] %s: idea for %q not added: %v", snap.Id, d.Title, err)
			continue
		}
		d.IdeaId = idea.ID
	}
}

// Summarize reruns the synthesis on everything so far and replaces the Summary. A done, stopped or paused council
// goes back to the state it was in (a stopped one is summarized from the rounds that finished); a failed one, whose
// synthesis failed, becomes done. A synthesis that fails leaves the council failed, with Retry on the coordinator.
func (r *Runner) Summarize(id string) (*Council, error) {
	r.mu.Lock()
	saved, start, err := r.summarizeLocked(id)
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
}

func (r *Runner) summarizeLocked(id string) (*Council, func(), error) {
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
	prev := prevOf(cur)
	return r.launchLocked(context.Background(), id, func() (*Council, error) {
		return Update(id, func(c *Council) error {
			c.State, c.Round, c.Error = StateRunning, 3, ""
			return nil
		})
	}, r.summarizeWork(prev))
}

func (r *Runner) summarizeWork(prev prevState) work {
	return func(ctx context.Context, rn *run, id string) ending {
		if err := r.synthesize(ctx, rn, id); err != nil {
			if ctx.Err() != nil {
				return ending{}
			}
			return ending{set: synthesisFailed(err)}
		}
		return ending{
			set: func(c *Council) {
				if prev.state == StateFailed {
					c.State, c.Round, c.Error = StateDone, 3, ""
					return
				}
				prev.restore(c)
			},
			answers: prev.state != StateAwaiting,
		}
	}
}

// ---- retry and stop ----

// Retry reruns the failed call of expert expertId in the round it failed in, and clears the failure when it works. The
// coordinator's failure is the synthesis, as Summarize reruns it. A council that is running cannot be retried; wait
// for it or stop it.
func (r *Runner) Retry(id, expertId string) (*Council, error) {
	r.mu.Lock()
	saved, start, err := r.retryLocked(id, expertId)
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	r.changed(saved)
	start()
	return saved, nil
}

func (r *Runner) retryLocked(id, expertId string) (*Council, func(), error) {
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
	if e.Coordinator {
		return r.summarizeLocked(id)
	}
	prev := prevOf(cur)
	return r.launchLocked(context.Background(), id, func() (*Council, error) {
		return Update(id, func(c *Council) error {
			c.State, c.Error = StateRunning, ""
			return nil
		})
	}, r.retryWork(e, f, prev))
}

func (r *Runner) retryWork(e CouncilExpert, f CouncilFailure, prev prevState) work {
	return func(ctx context.Context, rn *run, id string) ending {
		snap, err := Load(id)
		if err != nil {
			return loadFailed(err)
		}
		switch {
		case f.Round <= 1:
			r.round1(ctx, rn, id, snap, e)
		case f.Round == 2:
			r.round2(ctx, rn, id, snap, e)
		default:
			if replies := owed(snap, e, false); len(replies) > 0 {
				r.answerCall(ctx, rn, id, snap, e, replies, f.Round)
			} else {
				r.updateLogged(rn, id, func(c *Council) error {
					delete(c.Failed, e.Id)
					return nil
				})
			}
		}
		return ending{set: prev.restore, answers: prev.state != StateAwaiting}
	}
}

// Stop cancels the calls in flight, keeps the rounds that finished, and leaves the council stopped. It returns when the
// run has saved that. A council that is not running comes back as it was, except one paused after round 1, which
// ends there.
func (r *Runner) Stop(id string) (*Council, error) {
	r.mu.Lock()
	rn := r.active[id]
	if rn == nil {
		c, err := Update(id, func(c *Council) error {
			if c.State != StateAwaiting && c.State != StateRunning {
				return errSkip
			}
			c.State, c.Error, c.Activity = StateStopped, "", nil
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

// MarkStale turns every council left running (wavesrv quit mid-round) into a stopped one that says so. Call it once at
// startup, before any council runs.
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
}

// Wait returns the council once nothing is working on it: its state is done, not-run, stopped, failed or awaiting-you.
// It returns early with ctx's error when ctx ends, and with an error for a council that is marked running with no run
// behind it.
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
		if c.State == StateRunning {
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
  "group": "ui-feature"
}`

const maxSuggestedRoles = 2

func suggestPrompt(project, feature, question string, files []string, roles []CouncilExpert, groups []CouncilGroup) string {
	names := map[string]string{}
	for _, role := range roles {
		names[role.Id] = role.Name
	}
	var b strings.Builder
	b.WriteString("You are the coordinator of a council that is about to review one feature of a project. You have Read, " +
		"Grep and Glob in the project folder; you review and never edit anything.\n\n")
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
	b.WriteString("\nRead what you need of the files above and the code around them, then do three things.\n\n")
	b.WriteString("1. Name the project files the experts should read first, as paths relative to the project folder: the " +
		"few the review hinges on, at most eight. Name files that exist.\n")
	fmt.Fprintf(&b, "2. Suggest up to %d extra roles this feature needs that the group lacks, each with a name, a brief "+
		"(the angle it reviews from and what counts as evidence) and a one-line why. Suggest none when the group fits.\n", maxSuggestedRoles)
	b.WriteString("3. Name the id of the group above that fits best, or leave it empty when none does.\n\n")
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
		Group string `json:"group"`
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
	return out, nil
}

// Suggest makes the one sonnet call behind Setup's dashed rows: it reads the project with the read-only tools and
// names the files the experts should read, up to two extra roles, and the group that fits the feature best. A group
// it names that does not exist comes back empty.
func (r *Runner) Suggest(ctx context.Context, project, feature, question string, files []string) (CouncilSuggestion, error) {
	if r.Caller == nil {
		return CouncilSuggestion{}, errors.New("the council runner has no caller")
	}
	if strings.TrimSpace(project) == "" || strings.TrimSpace(feature) == "" {
		return CouncilSuggestion{}, errors.New("a suggestion needs a project folder and a feature")
	}
	roles, groups := Roles(), Groups()
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
