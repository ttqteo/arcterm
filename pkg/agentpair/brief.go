// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// JudgeBriefInput is what a judge's first brief is made of.
type JudgeBriefInput struct {
	WorkerName string
	WorkerTab  string
	Reply      string   // the working agent's reply the pair starts from, as it wrote it (its arc-pair block included)
	Docs       []string // the plan and spec paths at hand: the judge reads them itself, they are not pasted
	Note       string   // the person's note to the judge
	// Later says Reply is a reply the working agent has gone on from. The brief then names the agent's Transcript path and
	// the Record (the transcript record's uuid) the reply is, so the judge can read what came after. A brief that is not
	// Later is today's: Transcript and Record are not read.
	Later      bool
	Transcript string
	Record     string
}

// JudgeBrief is a new judge's launch task, or a live agent's first prompt: whose work it judges, the plan or spec at
// hand, the working agent's reply (its latest, or an older one the person chose), how to judge, and how to mark the
// working agent's block.
func JudgeBrief(in JudgeBriefInput) string {
	var b strings.Builder
	fmt.Fprintf(&b, "You are the judge of another agent's work. arcterm pairs the two of you: the agent is %q (tab %s). "+
		"Each of its replies is relayed to you and each of yours goes back to it on its own, so answer in your reply and never with wsh agents send. "+
		"The person watches the conversation and steps in only where a decision is theirs.\n\n", in.WorkerName, in.WorkerTab)
	b.WriteString("You judge: do not edit files and do not run heavy commands (builds, full test suites, long scripts). " +
		"Read the real code before you conclude, cite file:line, and rank your findings, the one that most changes the plan first.\n\n")
	if len(in.Docs) > 0 {
		b.WriteString("The plan or spec at hand (read it yourself, it is not pasted here):\n")
		for _, d := range in.Docs {
			fmt.Fprintf(&b, "- %s\n", d)
		}
		b.WriteString("\n")
	}
	if note := strings.TrimSpace(in.Note); note != "" {
		fmt.Fprintf(&b, "A note from the person:\n%s\n\n", note)
	}
	b.WriteString("The agent ends every reply with an `arc-pair` block of numbered items: D<n> agreed, O<n> still open, A<n> waits on the person. " +
		"You read that block and mark items by their number; you write no list of your own. End your reply with an `arc-judge` block, one mark per line:\n\n" +
		"```arc-judge\n" +
		"reopen D2: the threshold is picked after the pilot measures, so it is tuned to the pilot\n" +
		"new: the pilot cases overlap the test split\n" +
		"```\n\n" +
		"- `reopen D2: why` (or `reopen 2: why`) moves an agreed item back to open until the agent changes it in its next block.\n" +
		"- `new: point` raises something the agent's block does not list yet.\n" +
		"- `no new points` on a line of its own says you have nothing to add. The exchange pauses when every judge says it. " +
		"When you write it, put a `summary: ` line above it in the same block: a few sentences, on one line, that sum the pair up for the person " +
		"(what is agreed, what is still open, what waits on them), in the person's language.\n\n" +
		"A message from the person can reach you together with the agent's answer to it. Then judge that answer: " +
		"check it against what the person asked, and do not answer the person yourself. A message that reaches you with no answer of the agent's is yours to answer.\n\n" +
		"Start your reply with `> ` and the line you answer, so the conversation can quote it.\n")
	if reply := strings.TrimSpace(in.Reply); reply != "" {
		which := "latest reply"
		if in.Later {
			// the agent has gone on since: the transcript holds what it did after this reply, and the code is as it is now
			fmt.Fprintf(&b, "\nThe agent has gone on since this reply. Its transcript is %s and the reply is the record %s in it: "+
				"read what it did after it there if it bears on your judgement, and judge the code as it is now.\n", in.Transcript, in.Record)
			which = "reply"
		}
		b.WriteString("\n--- the agent's " + which + " ---\n" + reply + "\n--- end of the reply ---\n")
	}
	return b.String()
}

// OlderReplyNote is what the working agent's first relayed prompt adds, after WorkerBrief, when the pair started from a
// reply it had gone on from: which of its replies the judge is judging (ts is that reply's time, ms; 0 shows none).
func OlderReplyNote(ts int64) string {
	which := "an earlier reply of yours"
	if ts != 0 {
		which = "your reply from " + time.UnixMilli(ts).Format("15:04")
	}
	return "The judge is judging " + which + "; weigh its judgement against what you have done since."
}

// a path of a plan or a spec: a Markdown file in a plans/ or specs/ folder, under any prefix, with / or \ separators
var docPath = regexp.MustCompile(`(?:[\w.~:/\\-]*[/\\])?\b(?:plans|specs)[/\\][\w.\-]+\.md\b`)

// DocsAtHand is the plan and spec paths the texts name, newest first, each once. texts are oldest first, as a
// transcript reads, so the path named last comes first.
func DocsAtHand(texts []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for i := len(texts) - 1; i >= 0; i-- {
		found := docPath.FindAllString(texts[i], -1)
		for j := len(found) - 1; j >= 0; j-- {
			if !seen[found[j]] {
				seen[found[j]] = true
				out = append(out, found[j])
			}
		}
	}
	return out
}

// quoteNames reads ["a", "b", "c"] as `"a", "b" and "c"`.
func quoteNames(names []string) string {
	q := make([]string, len(names))
	for i, n := range names {
		q[i] = fmt.Sprintf("%q", n)
	}
	if len(q) < 2 {
		return strings.Join(q, "")
	}
	return strings.Join(q[:len(q)-1], ", ") + " and " + q[len(q)-1]
}

// WorkerBrief is the working agent's first relayed prompt's opening: it is paired, every reply passes to its judge(s),
// every reply ends with the arc-pair block, and a heavy command waits for the judge.
func WorkerBrief(judgeNames []string) string {
	judges := "a judge"
	switch len(judgeNames) {
	case 0:
	case 1:
		judges = "a judge, " + quoteNames(judgeNames)
	default:
		judges = "judges, " + quoteNames(judgeNames)
	}
	return "arcterm has paired you with " + judges + ". Every reply you write is relayed to them and theirs come back to you the same way, " +
		"so answer in your reply and never with wsh agents send. The person watches the conversation and answers where a decision is theirs.\n\n" +
		"End every reply with an `arc-pair` block that lists the work so far, one item per line:\n\n" +
		"```arc-pair\n" +
		"D1 the decision that is agreed\n" +
		"O2 a point still open — a second line of detail, after a dash\n" +
		"A3 a question only the person can decide [Yes | No, keep it]\n" +
		"```\n\n" +
		"- D<n> is agreed, O<n> still open, A<n> waits on the person; an A item may end with its answer chips in brackets.\n" +
		"- Number each item once and keep the number for good, never reuse one. List every item each time, agreed ones included: an item you leave out is gone from the person's Decided list.\n" +
		"- A judge disagrees with an item by naming its number, and the item goes back to open until your next block shows what changed. Answer their points by number and change the block to match.\n" +
		"- An A item does not stop the exchange: keep talking about the other items while it waits.\n" +
		"- Start a reply that answers a message with `> ` and the line you answer.\n\n" +
		"While your judge has not answered your last reply you can read, edit files and run light commands, but a heavy command (a build, the full test suite, a long script) " +
		"may be refused with a message that starts `Held:`. When it is, end your turn and say in your reply which command you mean to run; once the judge has answered, run it in your next turn.\n\n" +
		"A message from the person is marked as the person's."
}

// RelayItem is one message of a batch relayed to an agent. Text is what the sender wrote, fences and quote line
// included: the receiver reads the arc-pair block and the arc-judge marks as they are.
type RelayItem struct {
	From string // FromWorker | FromJudge | FromPerson
	Name string // the sending agent's name; "" for the person
	Tab  string
	Ts   int64 // ms since the epoch; 0 shows no time
	Text string
}

func relayHead(it RelayItem) string {
	who := it.Name
	if who == "" {
		who = it.Tab
	}
	var head string
	switch it.From {
	case FromPerson:
		head = "From the person (typed in arcterm, not an agent)"
	case FromJudge:
		head = fmt.Sprintf("From the judge %q", who)
	case FromWorker:
		head = fmt.Sprintf("From the working agent %q", who)
	default:
		head = "From arcterm"
	}
	if it.Ts != 0 {
		head += ", " + time.UnixMilli(it.Ts).Format("15:04")
	}
	return head + ":"
}

// RelayPrompt is one prompt for a batch of messages, oldest first, each headed by who wrote it and when; the person's
// is marked as the person's. firstToWorker, when set, opens the prompt: the working agent's first one starts with
// WorkerBrief.
func RelayPrompt(msgs []RelayItem, firstToWorker string) string {
	parts := make([]string, 0, len(msgs)+1)
	if firstToWorker != "" {
		parts = append(parts, firstToWorker)
	}
	for _, it := range msgs {
		parts = append(parts, relayHead(it)+"\n"+it.Text)
	}
	return strings.Join(parts, "\n\n")
}
