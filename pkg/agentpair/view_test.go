// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// newPair is a relaying pair of the working agent "w" and the judges named by tab.
func newPair(judges ...string) *Pair {
	p := &Pair{Id: "p1", Project: "proj", State: StateRelaying, CreatedTs: 500,
		Worker: Side{Tab: "w", Name: "Plan oracle", Harness: "claude"}}
	for _, tab := range judges {
		p.Judges = append(p.Judges, Side{Tab: tab, Name: "judge " + tab, Harness: "claude"})
	}
	return p
}

// say appends a message, a second after the one before it, and returns its id.
func say(p *Pair, from, tab, raw string) string {
	id := fmt.Sprintf("m%d", len(p.Messages)+1)
	p.Messages = append(p.Messages, Message{Id: id, From: from, Tab: tab, Ts: int64(len(p.Messages)+1) * 1000, Raw: raw})
	return id
}

func worker(p *Pair, raw string) string     { return say(p, FromWorker, "w", raw) }
func judge(p *Pair, tab, raw string) string { return say(p, FromJudge, tab, raw) }
func answer(p *Pair, item int, raw string) string {
	id := say(p, FromPerson, "", raw)
	p.Messages[len(p.Messages)-1].Item = item
	return id
}

func nums(items []wshrpc.PairItem) []int {
	out := []int{}
	for _, it := range items {
		out = append(out, it.Num)
	}
	return out
}

func TestDecidedListsTheNewestBlock(t *testing.T) {
	p := newPair("j1")
	worker(p, "an older reply\n"+pairBlock("O1 old"))
	m2 := worker(p, "Checked.\n"+pairBlock(
		"D1 Lock the threshold before the pilot",
		"O2 Take pilot cases outside the test split — judge's point",
		"A3 Is 50% fine? [Yes | No]",
	))
	d := Decided(p)
	wantAgreed := []wshrpc.PairItem{{Num: 1, Kind: KindAgreed, Text: "Lock the threshold before the pilot", Chips: []string{}, MsgId: m2}}
	wantOpen := []wshrpc.PairItem{{Num: 2, Kind: KindOpen, Text: "Take pilot cases outside the test split", Note: "judge's point", Chips: []string{}, MsgId: m2}}
	wantAsks := []wshrpc.PairItem{{Num: 3, Kind: KindAsks, Text: "Is 50% fine?", Chips: []string{"Yes", "No"}, MsgId: m2}}
	if !reflect.DeepEqual(d.Agreed, wantAgreed) || !reflect.DeepEqual(d.Open, wantOpen) || !reflect.DeepEqual(d.Asks, wantAsks) {
		t.Fatalf("decided =\n%#v\nwant agreed %#v\nopen %#v\nasks %#v", d, wantAgreed, wantOpen, wantAsks)
	}
}

// a nil slice reaches the frontend as null: the lists and every chips slice are empty slices
func TestDecidedHasNoNilSlices(t *testing.T) {
	p := newPair("j1")
	if b, _ := json.Marshal(Decided(p)); strings.Contains(string(b), "null") {
		t.Fatalf("an empty pair's Decided holds a null: %s", b)
	}
	worker(p, pairBlock("D1 a", "O2 b", "A3 c", "A4 d [x | y]"))
	judge(p, "j1", judgeBlock("new: e"))
	if b, _ := json.Marshal(Decided(p)); strings.Contains(string(b), "null") {
		t.Fatalf("Decided holds a null: %s", b)
	}
}

func TestDecidedIgnoresAWorkerMessageWithoutABlock(t *testing.T) {
	p := newPair("j1")
	m1 := worker(p, pairBlock("D1 kept"))
	worker(p, "a reply with no block at all")
	judge(p, "j1", "prose")
	d := Decided(p)
	if len(d.Agreed) != 1 || d.Agreed[0].MsgId != m1 {
		t.Fatalf("a reply with no block changed the list: %#v", d)
	}
}

func TestDecidedAReopenMovesAgreedToOpenUntilTheNextBlock(t *testing.T) {
	p := newPair("j1", "j2")
	m1 := worker(p, pairBlock("D1 first", "D2 second", "O3 third"))
	judge(p, "j1", "I disagree.\n"+judgeBlock("reopen D2: the threshold is tuned to the pilot"))
	d := Decided(p)
	if !reflect.DeepEqual(nums(d.Agreed), []int{1}) || !reflect.DeepEqual(nums(d.Open), []int{2, 3}) {
		t.Fatalf("after the reopen: agreed %v open %v", nums(d.Agreed), nums(d.Open))
	}
	if got := d.Open[0]; got.Kind != KindOpen || got.ReopenedBy != "j1" || got.Text != "second" || got.MsgId != m1 {
		t.Fatalf("the reopened item = %#v", got)
	}
	if d.Open[1].ReopenedBy != "" {
		t.Fatalf("an item nobody reopened says it was: %#v", d.Open[1])
	}

	// the working agent's next block answers the mark: the item is agreed again, until a judge reopens it again
	m3 := worker(p, "I checked.\n"+pairBlock("D1 first", "D2 second", "D3 third"))
	d = Decided(p)
	if !reflect.DeepEqual(nums(d.Agreed), []int{1, 2, 3}) || len(d.Open) != 0 {
		t.Fatalf("after the next block: agreed %v open %v", nums(d.Agreed), nums(d.Open))
	}
	if d.Agreed[0].MsgId != m1 || d.Agreed[1].MsgId != m1 || d.Agreed[2].MsgId != m3 {
		t.Fatalf("links = %q %q %q", d.Agreed[0].MsgId, d.Agreed[1].MsgId, d.Agreed[2].MsgId)
	}
	judge(p, "j2", judgeBlock("reopen D3: not yet"))
	if d = Decided(p); !reflect.DeepEqual(nums(d.Open), []int{3}) || d.Open[0].ReopenedBy != "j2" {
		t.Fatalf("a judge that still disagrees did not reopen it: %#v", d.Open)
	}
}

func TestDecidedTheFirstJudgeToReopenIsNamed(t *testing.T) {
	p := newPair("j1", "j2")
	worker(p, pairBlock("D1 first"))
	judge(p, "j2", judgeBlock("reopen 1: a"))
	judge(p, "j1", judgeBlock("reopen D1: b"))
	if d := Decided(p); len(d.Open) != 1 || d.Open[0].ReopenedBy != "j2" {
		t.Fatalf("open = %#v", d.Open)
	}
}

func TestDecidedMarksThatDoNotCount(t *testing.T) {
	p := newPair("j1")
	// a mark older than the block, from before the working agent's answer
	worker(p, pairBlock("D1 first"))
	judge(p, "j1", judgeBlock("reopen D1: old"))
	worker(p, pairBlock("D1 first", "O2 second", "D3 third"))
	// a person's words are not a mark, a reopen of an open item or an unknown number moves nothing
	say(p, FromPerson, "", "reopen D3: I think so too")
	judge(p, "j1", judgeBlock("reopen D2: it is open already", "reopen D9: no such item"))
	// and a judge's reply with no fence marks nothing
	judge(p, "j1", "reopen D1: in prose")
	d := Decided(p)
	if !reflect.DeepEqual(nums(d.Agreed), []int{1, 3}) || !reflect.DeepEqual(nums(d.Open), []int{2}) {
		t.Fatalf("agreed %v open %v", nums(d.Agreed), nums(d.Open))
	}
	if d.Open[0].ReopenedBy != "" {
		t.Fatalf("an item that was open already says a judge reopened it: %#v", d.Open[0])
	}
}

func TestDecidedADroppedNumberIsGone(t *testing.T) {
	p := newPair("j1")
	worker(p, pairBlock("D1 one", "O2 two", "A3 three"))
	worker(p, pairBlock("D1 one"))
	d := Decided(p)
	if !reflect.DeepEqual(nums(d.Agreed), []int{1}) || len(d.Open) != 0 || len(d.Asks) != 0 {
		t.Fatalf("a dropped number is still shown: %#v", d)
	}
}

func TestDecidedAJudgesNewPointIsOpenUntilTheNextBlock(t *testing.T) {
	p := newPair("j1")
	worker(p, pairBlock("D1 one", "O2 two"))
	jm := judge(p, "j1", "Also:\n"+judgeBlock("new: the pilot cases overlap the test split", "new: second point"))
	d := Decided(p)
	if !reflect.DeepEqual(nums(d.Open), []int{2, 0, 0}) {
		t.Fatalf("open = %v, want the block's item then the judge's two points", nums(d.Open))
	}
	if got := d.Open[1]; got.Kind != KindOpen || got.Text != "the pilot cases overlap the test split" || got.NewBy != "j1" || got.MsgId != jm {
		t.Fatalf("the judge's point = %#v", got)
	}
	worker(p, pairBlock("D1 one", "O2 two", "O3 the overlap, now listed"))
	if d = Decided(p); !reflect.DeepEqual(nums(d.Open), []int{2, 3}) {
		t.Fatalf("after the next block open = %v", nums(d.Open))
	}
}

func TestDecidedAnAnswerShowsUntilTheNextBlock(t *testing.T) {
	p := newPair("j1")
	worker(p, pairBlock("A3 Is 50% fine? [Yes | No]", "A4 Another?"))
	if d := Decided(p); d.Asks[0].Answer != "" || d.Asks[1].Answer != "" {
		t.Fatalf("an unanswered item shows an answer: %#v", d.Asks)
	}
	answer(p, 3, "No")
	answer(p, 3, "  No, keep 70%  ")
	say(p, FromPerson, "", "a message that answers no item")
	d := Decided(p)
	if len(d.Asks) != 2 || d.Asks[0].Answer != "No, keep 70%" || d.Asks[1].Answer != "" {
		t.Fatalf("asks = %#v, want the newest answer to A3 only", d.Asks)
	}
	worker(p, pairBlock("A3 Is 50% fine? [Yes | No]", "A4 Another?"))
	if d = Decided(p); d.Asks[0].Answer != "" {
		t.Fatalf("an answer outlived the next block: %#v", d.Asks)
	}
}

func TestDecidedAgreedLinksBackThroughAnUnbrokenRunOfD(t *testing.T) {
	p := newPair("j1")
	m1 := worker(p, pairBlock("D1 one", "O2 two", "D3 three"))
	worker(p, "no block this time")
	m3 := worker(p, pairBlock("D1 one", "D2 two", "O3 three"))
	m4 := worker(p, pairBlock("D1 one", "D2 two", "D3 three"))
	d := Decided(p)
	got := map[int]string{}
	for _, it := range d.Agreed {
		got[it.Num] = it.MsgId
	}
	// D1 was agreed in every block (a reply with no block is not one); D2 since m3; D3 was open in m3, so only m4 settled it
	if got[1] != m1 || got[2] != m3 || got[3] != m4 {
		t.Fatalf("links = %v, want 1:%s 2:%s 3:%s", got, m1, m3, m4)
	}
}

func TestOwedAfterAWorkerMessageAndClearedByEachJudge(t *testing.T) {
	p := newPair("j1", "j2")
	if Owed(p) || OwedBy(p) != nil {
		t.Fatal("a pair with no message owes nothing")
	}
	worker(p, "first")
	if !reflect.DeepEqual(OwedBy(p), []string{"j1", "j2"}) || !Owed(p) {
		t.Fatalf("OwedBy = %v, want both judges", OwedBy(p))
	}
	say(p, FromPerson, "", "a person's message clears no one")
	judge(p, "j1", "one")
	if !reflect.DeepEqual(OwedBy(p), []string{"j2"}) {
		t.Fatalf("after j1: OwedBy = %v", OwedBy(p))
	}
	judge(p, "j2", "two")
	if Owed(p) || len(OwedBy(p)) != 0 {
		t.Fatalf("after both: OwedBy = %v", OwedBy(p))
	}
	worker(p, "second")
	if !reflect.DeepEqual(OwedBy(p), []string{"j1", "j2"}) {
		t.Fatalf("a new worker message: OwedBy = %v", OwedBy(p))
	}
}

func TestOwedAGoneJudgeNeverOwesAndALateJudgeDoes(t *testing.T) {
	p := newPair("j1", "j2")
	worker(p, "first")
	judge(p, "j1", "one")
	p.Judges[1].Gone = true
	if Owed(p) {
		t.Fatalf("a gone judge owes: %v", OwedBy(p))
	}
	// a judge added later has said nothing since the working agent's newest message
	p.Judges = append(p.Judges, Side{Tab: "j3", Name: "late", Harness: "pi"})
	if !reflect.DeepEqual(OwedBy(p), []string{"j3"}) {
		t.Fatalf("OwedBy = %v, want the late judge", OwedBy(p))
	}
	p.State = StateEnded
	if Owed(p) {
		t.Fatal("an ended pair owes")
	}
}

func TestStopVerdictNoNewPoints(t *testing.T) {
	p := newPair("j1")
	worker(p, "Reply\n"+pairBlock("D1 one", "O2 two"))
	if got := StopVerdict(p); got != "" {
		t.Fatalf("a judge that owes: verdict %q", got)
	}
	judge(p, "j1", "Fine.\n"+judgeBlock("no new points"))
	if got := StopVerdict(p); got != StopNoNewPoints {
		t.Fatalf("verdict = %q, want %q", got, StopNoNewPoints)
	}
}

// the block keeps an O item, so nothing here can settle: only the marks decide
func TestStopVerdictNoNewPointsRefusedByAMark(t *testing.T) {
	for name, marks := range map[string][]string{
		"a reopen beside it":       {"no new points", "reopen D1: wait"},
		"a new point beside it":    {"no new points", "new: one more"},
		"a reopen alone":           {"reopen D1: wait"},
		"another line":             {"all good"},
		"another phrase":           {"no new issues"},
		"the phrase inside a line": {"there are no new points to make, but see below"},
	} {
		p := newPair("j1")
		worker(p, pairBlock("D1 one", "O2 two"))
		judge(p, "j1", judgeBlock(marks...))
		if got := StopVerdict(p); got != "" {
			t.Errorf("%s: verdict %q, want none", name, got)
		}
	}
}

func TestStopVerdictTwoJudgesNeedBoth(t *testing.T) {
	p := newPair("j1", "j2")
	worker(p, pairBlock("D1 one", "O2 two"))
	judge(p, "j1", judgeBlock("no new points"))
	if got := StopVerdict(p); got != "" {
		t.Fatalf("j2 still owes: verdict %q", got)
	}
	judge(p, "j2", judgeBlock("reopen D1: no"))
	if got := StopVerdict(p); got != "" {
		t.Fatalf("only one judge has no new points: verdict %q", got)
	}
	p2 := newPair("j1", "j2")
	worker(p2, pairBlock("D1 one", "O2 two"))
	judge(p2, "j1", judgeBlock("no new points"))
	judge(p2, "j2", judgeBlock("no new points"))
	if got := StopVerdict(p2); got != StopNoNewPoints {
		t.Fatalf("both said it: verdict %q", got)
	}
	// a gone judge need not say anything
	p3 := newPair("j1", "j2")
	p3.Judges[1].Gone = true
	worker(p3, pairBlock("O1 one"))
	judge(p3, "j1", judgeBlock("no new points"))
	if got := StopVerdict(p3); got != StopNoNewPoints {
		t.Fatalf("one live judge said it: verdict %q", got)
	}
}

func TestStopVerdictOnlyRepliesSinceTheNewestWorkerMessageCount(t *testing.T) {
	p := newPair("j1")
	worker(p, pairBlock("O1 one"))
	judge(p, "j1", judgeBlock("no new points"))
	worker(p, pairBlock("O1 one", "O2 a new point of its own"))
	if got := StopVerdict(p); got != "" {
		t.Fatalf("an old no new points stops a new message: %q", got)
	}
	judge(p, "j1", judgeBlock("reopen D1: no"))
	if got := StopVerdict(p); got != "" {
		t.Fatalf("verdict %q", got)
	}
	// two replies since the message: one raised a point, so a later no new points does not stop
	p2 := newPair("j1")
	worker(p2, pairBlock("O1 one"))
	judge(p2, "j1", judgeBlock("new: a point"))
	say(p2, FromPerson, "", "and?")
	judge(p2, "j1", judgeBlock("no new points"))
	if got := StopVerdict(p2); got != "" {
		t.Fatalf("an unanswered new point: verdict %q", got)
	}
}

func TestStopVerdictSettled(t *testing.T) {
	p := newPair("j1")
	worker(p, "Done.\n"+pairBlock("D1 one", "D2 two", "A3 the person decides [Yes | No]"))
	judge(p, "j1", "I agree.\n"+judgeBlock("(nothing to mark)"))
	if got := StopVerdict(p); got != StopSettled {
		t.Fatalf("verdict = %q, want %q", got, StopSettled)
	}
}

func TestStopVerdictSettledRefused(t *testing.T) {
	cases := map[string]func() *Pair{
		"a judge reply with no fence": func() *Pair {
			p := newPair("j1")
			worker(p, pairBlock("D1 one"))
			judge(p, "j1", "Looks right to me.")
			return p
		},
		"an O item in the block": func() *Pair {
			p := newPair("j1")
			worker(p, pairBlock("D1 one", "O2 two"))
			judge(p, "j1", judgeBlock("(nothing to mark)"))
			return p
		},
		"a reopen": func() *Pair {
			p := newPair("j1")
			worker(p, pairBlock("D1 one"))
			judge(p, "j1", judgeBlock("reopen D1: no"))
			return p
		},
		"a new point": func() *Pair {
			p := newPair("j1")
			worker(p, pairBlock("D1 one"))
			judge(p, "j1", judgeBlock("new: one more"))
			return p
		},
		"the newest message has no block": func() *Pair {
			p := newPair("j1")
			worker(p, pairBlock("D1 one"))
			worker(p, "I changed my mind, no block")
			judge(p, "j1", judgeBlock("(nothing to mark)"))
			return p
		},
		"one of two judges has no fence": func() *Pair {
			p := newPair("j1", "j2")
			worker(p, pairBlock("D1 one"))
			judge(p, "j1", judgeBlock("(nothing to mark)"))
			judge(p, "j2", "fine")
			return p
		},
		"a judge that has not answered": func() *Pair {
			p := newPair("j1", "j2")
			worker(p, pairBlock("D1 one"))
			judge(p, "j1", judgeBlock("(nothing to mark)"))
			return p
		},
	}
	for name, build := range cases {
		if got := StopVerdict(build()); got != "" {
			t.Errorf("%s: verdict %q", name, got)
		}
	}
}

func TestStopVerdictNoNewPointsBeatsSettled(t *testing.T) {
	p := newPair("j1")
	worker(p, pairBlock("D1 one"))
	judge(p, "j1", judgeBlock("no new points"))
	if got := StopVerdict(p); got != StopNoNewPoints {
		t.Fatalf("verdict = %q", got)
	}
}

func TestStopVerdictJudgesGone(t *testing.T) {
	p := newPair("j1")
	worker(p, pairBlock("O1 one"))
	p.Judges[0].Gone = true
	if got := StopVerdict(p); got != StopJudgesGone {
		t.Fatalf("verdict = %q, want %q", got, StopJudgesGone)
	}
	if got := StopVerdict(newPair()); got != StopJudgesGone {
		t.Fatalf("a pair with no judge: verdict %q", got)
	}
}

func TestStopVerdictNoWorkerMessageYet(t *testing.T) {
	p := newPair("j1")
	judge(p, "j1", judgeBlock("no new points"))
	if got := StopVerdict(p); got != "" {
		t.Fatalf("verdict %q before the working agent said anything", got)
	}
}

func TestInfoCountsAndOwes(t *testing.T) {
	p := newPair("j1")
	info := Info(p)
	if info.Id != "p1" || info.Project != "proj" || info.Worker.Tab != "w" || info.Worker.Name != "Plan oracle" ||
		len(info.Judges) != 1 || info.Judges[0].Tab != "j1" || info.State != StateRelaying || info.MessageCount != 0 || info.LastTs != 500 {
		t.Fatalf("info = %#v", info)
	}
	worker(p, "a")
	judge(p, "j1", "b")
	worker(p, "c")
	info = Info(p)
	if info.MessageCount != 3 || info.LastTs != 3000 || !info.Owed {
		t.Fatalf("info = %#v", info)
	}
	if b, _ := json.Marshal(Info(newPair())); strings.Contains(string(b), "null") {
		t.Fatalf("info holds a null: %s", b)
	}
}

func TestInfoCarriesTheSessionsAndTheUpdatedTime(t *testing.T) {
	p := newPair("j1", "j2")
	p.Worker.Session = "w-session"
	p.Judges[0].Session = "j1-session"
	p.UpdatedTs = 9000
	worker(p, "a")
	info := Info(p)
	if info.Worker.Session != "w-session" || info.Judges[0].Session != "j1-session" || info.Judges[1].Session != "" {
		t.Fatalf("sessions = %q %q %q", info.Worker.Session, info.Judges[0].Session, info.Judges[1].Session)
	}
	if info.UpdatedTs != 9000 {
		t.Fatalf("UpdatedTs = %d, want the stored 9000 and not the last message's 1000", info.UpdatedTs)
	}
	if info.Synced {
		t.Fatal("a pair of the manager's own folder reads as synced")
	}

	// the wire names them: a side with no session leaves the key out
	b, _ := json.Marshal(View(p))
	if !strings.Contains(string(b), `"session":"w-session"`) || !strings.Contains(string(b), `"updatedts":9000`) {
		t.Fatalf("the view lacks the session or the updated time: %s", b)
	}
	if n := strings.Count(string(b), `"session"`); n != 2 {
		t.Fatalf("%d session keys in %s, want 2 (the worker's and j1's)", n, b)
	}
	if strings.Contains(string(b), `"synced"`) {
		t.Fatalf("a pair that is not synced carries a synced key: %s", b)
	}
}

// a caller tells "no such pair" from a failed read by errors.Is; the message stays what it was
func TestErrNoPairIsWrappedAndKeepsItsMessage(t *testing.T) {
	err := errNoPair("p9")
	if !errors.Is(err, ErrNoPair) || err.Error() != `no pair "p9"` {
		t.Fatalf("errNoPair = %v", err)
	}
}

// a file saved before the updated time existed lists by its last message's time, and an empty pair by its creation
func TestInfoWithoutUpdatedReadsTheLastMessagesTime(t *testing.T) {
	p := newPair("j1")
	if got := Info(p).UpdatedTs; got != 500 {
		t.Fatalf("a pair with no message and no updated: UpdatedTs = %d, want its CreatedTs 500", got)
	}
	worker(p, "a")
	judge(p, "j1", "b")
	if got := Info(p).UpdatedTs; got != 2000 {
		t.Fatalf("UpdatedTs = %d, want the last message's 2000", got)
	}
	if got := View(p).UpdatedTs; got != 2000 {
		t.Fatalf("the view's UpdatedTs = %d, want 2000", got)
	}
}

func TestViewAppliesBodyAndQuotesWhatAMessageAnswers(t *testing.T) {
	p := newPair("j1")
	p.HoldHeavy, p.TokenCap, p.Tokens, p.Note, p.StopReason = true, 3_000_000, 1234, "mind the loop", ""
	m1 := worker(p, "Plan:\nlock the threshold first.\n\n"+pairBlock("O1 threshold"))
	m2 := judge(p, "j1", "> lock the threshold first.\nThe order is wrong.\n"+judgeBlock("reopen 1: order"))
	m3 := worker(p, "I will swap the steps.\n"+pairBlock("D1 threshold"))
	p.Messages[2].ReplyTo = m2
	m4 := say(p, FromPerson, "", "> hand-quoted stays in a person's text\nok")
	p.Messages[3].ReplyTo = m3
	m5 := say(p, FromSystem, "", "Paused: both agree")
	p.Messages[1].ReplyTo = m1
	p.Messages[2].Held = []wshrpc.PairHeld{{Command: "pytest -x", Ts: 2500}}

	v := View(p)
	if v.Id != "p1" || v.State != StateRelaying || !v.HoldHeavy || v.TokenCap != 3_000_000 || v.Tokens != 1234 || v.Note != "mind the loop" || v.CreatedTs != 500 {
		t.Fatalf("view header = %#v", v)
	}
	if len(v.Messages) != 5 {
		t.Fatalf("messages = %d", len(v.Messages))
	}
	byId := map[string]wshrpc.PairMessage{}
	for _, m := range v.Messages {
		byId[m.Id] = m
	}
	// the judge quoted its own line; the worker's block is not shown
	if m := byId[m1]; m.Text != "Plan:\nlock the threshold first." || m.Quote != "" || m.From != FromWorker || m.Tab != "w" {
		t.Errorf("m1 = %#v", m)
	}
	if m := byId[m2]; m.Text != "The order is wrong." || m.Quote != "lock the threshold first." || m.ReplyTo != m1 {
		t.Errorf("m2 = %#v", m)
	}
	// no quote line: the first line of the message it answers (a shown line, not the fence)
	if m := byId[m3]; m.Text != "I will swap the steps." || m.Quote != "The order is wrong." || m.ReplyTo != m2 {
		t.Errorf("m3 = %#v", m)
	}
	if h := byId[m3].Held; len(h) != 1 || h[0].Command != "pytest -x" {
		t.Errorf("m3 held = %#v", h)
	}
	// the person's text is theirs as typed; its Reply quotes the line it answers; no To means both
	if m := byId[m4]; m.Text != "> hand-quoted stays in a person's text\nok" || m.Quote != "I will swap the steps." || m.To != ToBoth {
		t.Errorf("m4 = %#v", m)
	}
	if m := byId[m5]; m.Text != "Paused: both agree" || m.Quote != "" || m.Held == nil {
		t.Errorf("m5 = %#v", m)
	}
	if b, _ := json.Marshal(v); strings.Contains(string(b), "null") {
		t.Fatalf("the view holds a null: %s", b)
	}
	if len(v.Decided.Agreed) != 1 || v.Decided.Agreed[0].Num != 1 {
		t.Errorf("decided = %#v", v.Decided)
	}
}

func TestViewKeepsATargetedPersonMessageTo(t *testing.T) {
	p := newPair("j1")
	say(p, FromPerson, "", "for the judge")
	p.Messages[0].To = "j1"
	if v := View(p); v.Messages[0].To != "j1" {
		t.Fatalf("To = %q", v.Messages[0].To)
	}
}
