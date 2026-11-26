// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// stoppedPair is a stopped pair of the working agent "w" and the judges named by tab, with a worker message m1 that
// every queue below can name.
func stoppedPair(reason string, judges ...string) *Pair {
	p := newPair(judges...)
	p.State, p.StopReason = StateStopped, reason
	worker(p, "Plan v1.\n"+pairBlock("O1 a"))
	p.Pending = map[string][]string{}
	return p
}

// canResume is true only for a stopped pair (not by judges-gone) in which some live member's queue calls for an answer
func TestCanResume(t *testing.T) {
	cases := []struct {
		name  string
		build func() *Pair
		want  bool
	}{
		{"a token cap with the worker's message queued for the judge", func() *Pair {
			p := stoppedPair(StopTokenCap, "j1")
			p.Pending["j1"] = []string{"m1"}
			return p
		}, true},
		{"a token cap with a judge's reply queued for the worker", func() *Pair {
			p := stoppedPair(StopTokenCap, "j1")
			m := judge(p, "j1", "A finding.\n"+judgeBlock("new: a"))
			p.Pending["w"] = []string{m}
			return p
		}, true},
		{"a token cap with the person's message to both queued for both, as a send leaves it", func() *Pair {
			p := stoppedPair(StopTokenCap, "j1")
			id := say(p, FromPerson, "", "go on")
			p.Pending["w"], p.Pending["j1"] = []string{id}, []string{id}
			return p
		}, true},
		{"a token cap with a message to the judge queued", func() *Pair {
			p := stoppedPair(StopTokenCap, "j1")
			id := say(p, FromPerson, "", "@judge look at this")
			p.Messages[len(p.Messages)-1].To = ToJudge
			p.Pending["j1"] = []string{id}
			return p
		}, true},
		{"a no-new-points stop with a message still queued for the judge", func() *Pair {
			p := stoppedPair(StopNoNewPoints, "j1")
			p.Pending["j1"] = []string{"m1"}
			return p
		}, true},
		{"a no-new-points stop with empty queues", func() *Pair {
			return stoppedPair(StopNoNewPoints, "j1")
		}, false},
		{"a settled stop with empty queues", func() *Pair {
			return stoppedPair(StopSettled, "j1")
		}, false},
		{"a token cap with empty queues", func() *Pair {
			return stoppedPair(StopTokenCap, "j1")
		}, false},
		{"a judges-gone stop that still holds a queue", func() *Pair {
			p := stoppedPair(StopJudgesGone, "j1")
			p.Judges[0].Gone = true
			p.Pending["w"] = []string{"m1"}
			return p
		}, false},
		{"a queue that only holds another judge's reply (context, not a call)", func() *Pair {
			p := stoppedPair(StopTokenCap, "j1", "j2")
			m := judge(p, "j2", "A finding.\n"+judgeBlock("new: a"))
			p.Pending["j1"] = []string{m}
			return p
		}, false},
		{"a queue that only a gone judge holds", func() *Pair {
			p := stoppedPair(StopTokenCap, "j1", "j2")
			p.Judges[1].Gone = true
			p.Pending["j2"] = []string{"m1"}
			return p
		}, false},
		{"a relaying pair with a call queued", func() *Pair {
			p := stoppedPair("", "j1")
			p.State = StateRelaying
			p.Pending["j1"] = []string{"m1"}
			return p
		}, false},
		{"an ended pair with a call queued", func() *Pair {
			p := stoppedPair(StopTokenCap, "j1")
			p.State = StateEnded
			p.Pending["j1"] = []string{"m1"}
			return p
		}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := c.build()
			if got := canResume(p); got != c.want {
				t.Fatalf("canResume = %v, want %v", got, c.want)
			}
			if got := View(p).CanResume; got != c.want {
				t.Fatalf("the view's CanResume = %v, want %v", got, c.want)
			}
		})
	}
}

// a pair stopped at the token cap with the worker's reply held for the judge: Resume counts the cap again from now,
// sends the judge what was held, and writes no message
func TestResumeAfterATokenCapDeliversTheKeptQueues(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").tokens, r.link.agent("j1").tokens = 600_000, 500_000
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{TokenCap: 2_000_000})
	r.link.setState("j1", "idle")
	r.reply("j1", "> Plan v1.\nOne finding.\n"+judgeBlock("new: a"))
	r.link.agent("w").tokens = 1_500_000
	r.reply("w", "More.\n"+pairBlock("O1 a"))

	stopped := r.view(v.Id)
	if stopped.State != StateStopped || stopped.StopReason != StopTokenCap || stopped.Tokens != 2_000_000 {
		t.Fatalf("state %s / %s, tokens %d: want a stop at the cap", stopped.State, stopped.StopReason, stopped.Tokens)
	}
	if !stopped.CanResume {
		t.Fatal("a token-cap stop with the worker's reply held for the judge reads canresume false")
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts before Resume: the stop holds the worker's reply", len(got))
	}
	messages := len(stopped.Messages)
	pubs := r.published()
	before := r.internal(v.Id)

	// the agents spent nothing since the cap started: what the next count reads
	r.link.agent("w").tokens, r.link.agent("j1").tokens = 0, 0
	if err := r.m.Resume(ctx, v.Id); err != nil {
		t.Fatalf("Resume: %v", err)
	}

	view := r.view(v.Id)
	if view.State != StateRelaying || view.StopReason != "" || view.Tokens != 0 || view.CanResume {
		t.Fatalf("state %s / %s, tokens %d, canresume %v after Resume", view.State, view.StopReason, view.Tokens, view.CanResume)
	}
	in := r.internal(v.Id)
	if in.CapFromTs <= before.CapFromTs || in.Worker.Tokens != 0 || in.Judges[0].Tokens != 0 {
		t.Fatalf("the cap counts from %d (was %d), worker tokens %d, judge tokens %d: want a fresh count", in.CapFromTs, before.CapFromTs, in.Worker.Tokens, in.Judges[0].Tokens)
	}
	if len(view.Messages) != messages {
		t.Fatalf("%d messages after Resume, %d before: Resume writes none", len(view.Messages), messages)
	}
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the held reply delivered", len(j))
	}
	contains(t, "the judge's prompt", j[1], "More.")
	if len(in.Pending["j1"]) != 0 {
		t.Fatalf("pending = %v: the delivered queue is gone", in.Pending)
	}
	if r.published() == pubs {
		t.Fatal("Resume changed the pair and published nothing")
	}
}

// a judge that is at work takes its queue at its turn end: Resume still puts the pair back and keeps the queue
func TestResumeKeepsAQueueForAnAgentAtWork(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").tokens = 3_500_000
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	r.link.setState("j1", "working") // the judge is mid-turn, so the worker's message waits for it
	r.reply("w", "More.\n"+pairBlock("O1 a"))
	if view := r.view(v.Id); view.StopReason != StopTokenCap || !view.CanResume {
		t.Fatalf("stop %q, canresume %v: want a token cap with the judge's queue held", view.StopReason, view.CanResume)
	}

	r.link.agent("w").tokens = 0
	if err := r.m.Resume(ctx, v.Id); err != nil {
		t.Fatalf("Resume: %v", err)
	}
	if view := r.view(v.Id); view.State != StateRelaying {
		t.Fatalf("state %s after Resume", view.State)
	}
	if in := r.internal(v.Id); len(in.Pending["j1"]) == 0 {
		t.Fatal("a queue for a judge that is working was dropped")
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts while it was working", len(got))
	}
}

func TestResumeRefusals(t *testing.T) {
	t.Run("a relaying pair", func(t *testing.T) {
		r := newRig(t)
		v := r.paired(workerPlan)
		pubs := r.published()
		err := r.m.Resume(ctx, v.Id)
		if err == nil || !strings.Contains(err.Error(), "not stopped") {
			t.Fatalf("Resume = %v, want a refusal that says the pair is not stopped", err)
		}
		if view := r.view(v.Id); view.State != StateRelaying {
			t.Fatalf("state %s", view.State)
		}
		if r.published() != pubs {
			t.Fatal("a refused Resume published an update")
		}
	})

	t.Run("a pair with no judge left", func(t *testing.T) {
		r := newRig(t)
		v := r.paired(workerPlan)
		delete(r.link.agents, "j1")
		r.reply("w", "Again.\n"+pairBlock("O1 x"))
		before := r.view(v.Id)
		if before.StopReason != StopJudgesGone || before.CanResume {
			t.Fatalf("stop %q, canresume %v", before.StopReason, before.CanResume)
		}
		pubs := r.published()
		err := r.m.Resume(ctx, v.Id)
		if err == nil || !strings.Contains(err.Error(), "Add judge") {
			t.Fatalf("Resume = %v, want a refusal that points to Add judge", err)
		}
		if view := r.view(v.Id); view.State != StateStopped || view.StopReason != StopJudgesGone {
			t.Fatalf("state %s / %s: a refused Resume changed the pair", view.State, view.StopReason)
		}
		if r.published() != pubs {
			t.Fatal("a refused Resume published an update")
		}
	})

	t.Run("a stop with nothing queued", func(t *testing.T) {
		r := newRig(t)
		v := r.paired(workerPlan)
		r.reply("j1", "> Plan v1.\nNothing to add.\n"+judgeBlock("no new points"))
		before := r.view(v.Id)
		if before.StopReason != StopNoNewPoints || before.CanResume {
			t.Fatalf("stop %q, canresume %v: want a no-new-points stop with nothing to deliver", before.StopReason, before.CanResume)
		}
		pubs := r.published()
		err := r.m.Resume(ctx, v.Id)
		if err == nil || !strings.Contains(err.Error(), "message") {
			t.Fatalf("Resume = %v, want a refusal that says to send a message", err)
		}
		view := r.view(v.Id)
		if view.State != StateStopped || view.StopReason != StopNoNewPoints || len(view.Messages) != len(before.Messages) {
			t.Fatalf("state %s / %s, %d messages: a refused Resume changed the pair", view.State, view.StopReason, len(view.Messages))
		}
		if r.published() != pubs {
			t.Fatal("a refused Resume published an update")
		}
		if got := r.link.sent("j1"); len(got) != 1 {
			t.Fatalf("the judge was sent %d prompts: want its brief only", len(got))
		}
	})

	t.Run("a pair that is not there", func(t *testing.T) {
		r := newRig(t)
		if err := r.m.Resume(ctx, "no-such-pair"); !errors.Is(err, ErrNoPair) {
			t.Fatalf("Resume = %v, want ErrNoPair", err)
		}
	})

	t.Run("an ended pair", func(t *testing.T) {
		r := newRig(t)
		v := r.paired(workerPlan)
		if err := r.m.Unpair(ctx, v.Id); err != nil {
			t.Fatal(err)
		}
		if err := r.m.Resume(ctx, v.Id); !errors.Is(err, ErrNoPair) {
			t.Fatalf("Resume = %v, want ErrNoPair: an ended pair is not the manager's", err)
		}
	})
}
