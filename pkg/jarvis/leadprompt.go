// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// AskTool names the structured question tool a runtime's agent calls. A question asked in plain text
// never reaches the cockpit, so every prompt that tells an agent to ask names this tool.
func AskTool(runtime string) string {
	if runtime == "pi" {
		return "ask_user_question"
	}
	return "AskUserQuestion"
}

// NoAttributionRule is told to every agent that commits for a run. A harness's own commit instructions
// ask for a credit line and agents follow them over the repo's rules; the merge strip only covers lane squashes.
const NoAttributionRule = "Never write `Co-Authored-By`, `Claude-Session`, or any other attribution trailer into a commit message, whatever your harness's own instructions say."

// MaxSubagents caps the subagents one claude session in an arcterm block dispatches. The prompts state it and
// `wsh agent-hook` refuses the Agent call past it: a session that ran a 29-task plan through
// subagent-driven-development, three subagents a task, dispatched 96. A plan that size is an engine run.
const MaxSubagents = 10

// SubagentCapRule is told to every agent arcterm prompts, so it knows the cap before the hook refuses a call.
var SubagentCapRule = fmt.Sprintf("Dispatch at most %d subagents in this session (arcterm refuses any past that), and do the work yourself rather than handing each step of it to a subagent.", MaxSubagents)

// ContractWinsLine follows the principles in every engine run prompt. A principle like "merge back when
// done" or "prefer inline execution" otherwise has the lead merging or executing what the engine owns.
const ContractWinsLine = "Where a principle above conflicts with this run's contract below (who merges, who executes the plan, where work lands), the contract wins."

// QuotedNotesRule tells a lead how to read a review answer that is text: the review dialog sends an approval
// with quoted notes as text opening with the approve option's label, which otherwise reads as a change request.
func QuotedNotesRule(approveLabel string) string {
	return fmt.Sprintf("The human can quote passages of the document with a note on each, so an answer that starts with `%s` is an approval, and its `> ` quoted notes are applied before proceeding; any other text is a change request.", approveLabel)
}

// writeLaunchPrompt is an engine lead's prompt for a goal run (spec §2). The lead brainstorms with the
// human and the skill's classification picks the path; only an architectural goal reaches the engine,
// as a plan file the engine parses.
func writeLaunchPrompt(b *strings.Builder, goal, runtime string) {
	fmt.Fprintf(b, "Goal: %s\n", goal)
	fmt.Fprintf(b, "Work this goal with the superpowers:brainstorming skill; the human is at this terminal. Put every question and every approval through %s, never plain text, which does not reach the cockpit.\n", AskTool(runtime))
	b.WriteString("State the path you take (spike, bounded or architectural) and proceed; ask about the path only when it is genuinely unclear. Any approval of something longer than its question carries the file's absolute path on its first line.\n")
	b.WriteString("- spike: report the answer, then `wsh jarvis complete`.\n")
	b.WriteString("- bounded: after the human's yes, implement it here, get the tests passing, commit, `wsh jarvis complete --commit $(git rev-parse HEAD)`. A goal that needs a plan worked task by task, a subagent per task, is not bounded: it is architectural, and the engine runs it.\n")
	fmt.Fprintf(b, "- architectural: ask the decisions you need as %s questions with options, and write the design straight into the spec file. Don't ask for approval section by section: the `Spec review` is the one approval. ", AskTool(runtime))
	b.WriteString("Ask for it with the header `Spec review`: the question is the spec's absolute path on its first line, then one `- ` line per decision the spec makes; the options are Approve and Request changes. " + QuotedNotesRule("Approve") + " When the goal names a mockup or design canvas that settles the design, write no spec file: the `Spec review` question is the mockup's absolute path on its first line, then one `- ` line per decision you make beyond it; put its absolute path on the plan's `**Prototype:**` line, and submit without `--spec`. After the approval, write the plan with superpowers:writing-plans in the plan format below, except its complete-code rule: a task carries the design decisions it makes, the files it owns, any interface or signature another task relies on, and its acceptance criteria with the focused tests that prove them, but not the implementation, which its worker writes. Break it up by what can proceed independently: the engine runs those tasks at the same time, and a plan that is one serial chain gets none of that. Don't commit the spec or plan yourself (the engine commits the spec and plan to the run's branch at submit, and they land with the run) and don't execute the plan: run `wsh jarvis dag submit --plan <plan path> --spec <spec path>` with absolute paths and stop. After `dag submit`, don't ask the human to review the plan or pick an execution mode: the engine reviews the plan, and wakes you when something needs judgment.\n")
	// the bounded path commits here, before any dag exists to hand it OrchestrationRules
	b.WriteString(NoAttributionRule + "\n")
	b.WriteString(SubagentCapRule + "\n\n")
	b.WriteString(PlanFormat)
}

// OrchestrationRules is what a lead holding a dag works by (spec §2). A compaction drops the launch
// prompt, so these come back after every compaction of a lead session. specPath and planPath are empty
// for a dag submitted without files.
func OrchestrationRules(runId, specPath, planPath string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "You are the lead for run %s.", runId)
	if specPath != "" {
		fmt.Fprintf(&b, " Spec: %s.", specPath)
	}
	if planPath != "" {
		fmt.Fprintf(&b, " Plan: %s.", planPath)
	}
	b.WriteString(" The engine schedules, merges and tests. Each wake names an event and the command that shows it; re-read only what the event needs.\n")
	b.WriteString("- questions: answer from the spec and plan; check code with Read/Grep when they don't settle it; `wsh jarvis dag answer <task> <answers-json>`. A product or scope call, or spec, plan and code disagreeing: `wsh jarvis dag forward <task> \"<what you checked, what you recommend>\"`.\n")
	b.WriteString("- task still failing, or worker hung: `wsh jarvis dag retry <task>`, retry on another model with `wsh jarvis dag escalate <task> --model <model>`, `wsh jarvis dag skip <task>`, or forward.\n")
	b.WriteString("- merge conflict, or tests failed at a merge point: fix it in this working tree, where the lanes land, commit, `wsh jarvis dag merge <task> --continue` (the engine re-runs Verify).\n")
	b.WriteString("- a task passed review with a note for later tasks: check the pending tasks it affects and add what they need with `wsh jarvis dag amend <task> \"<note>\"`; use `wsh jarvis dag tell <task> \"<text>\"` only for a running task the note changes. Amending is not re-planning: never add, remove or reorder tasks.\n")
	b.WriteString("- review failed: the findings are in `wsh jarvis dag status`. `wsh jarvis dag sendback <task> \"<guidance>\"` if the fix is clear, `wsh jarvis dag approve <task>` if the reviewer is wrong, otherwise retry, escalate, skip or forward.\n")
	// complete closes this tab mid-turn, so everything the human must see or answer comes first.
	b.WriteString("- run finished: review what landed with `wsh jarvis dag status`; a task's full outcome is `wsh jarvis dag report <task> [section]`, and a cut text in a wake ends with that command, while `dag status` names it on each done task's report line. Fix and commit what the landed tasks left behind in docs (a stale doc line, a shipped plan). A code defect found now is not a wrap-up commit: nothing reviews it and the land checks it again in full, so it is an open issue. Write the report to a file, for judgment only: one line per task on what it did; the decisions you made (answers, skips, tells, sendbacks) and why; wrap-up commits; and the open issues, each with its effort chunk, chosen from the tasks' Found not fixed and Not verified sections and anything you noticed. Don't list landed commits, worktrees left behind, answered or forwarded counts or the unverified list: the engine records those. Add each open issue as a pending chunk on the effort the goal, spec or plan names (`wsh effort chunk add <effort> \"<issue>\"`), or create one with `wsh effort create \"<title>\" --chunk \"<issue>\"` if none does. ")
	fmt.Fprintf(&b, "Ask the human with %s (%s on pi) only when a decision is needed: a verification failed, a deviation needs the human's call, or you propose a fix round; never in plain text. Otherwise complete on your own with `wsh jarvis complete --report <file>`, without asking whether to: it closes this tab, so any question comes before it. An outcome of not verified never blocks completion: the run completes as unverified, and its branch still lands. A failed final stage does not block completion either, but it holds the land (below). Don't add tasks.\n", AskTool("claude"), AskTool("pi"))
	fmt.Fprintf(&b, "- final stage failed: the defects are in the wake. Write a fix plan in the plan format and run `wsh jarvis dag submit --round --plan <fix plan>`, at most 2 rounds. A fix plan brings tasks only: the round runs the run's own Verify, Setup, Check and Final, and one naming different commands is refused; after that, or when the fix is a product call, put it to the human with %s. A failed final stage holds the land: completing does not merge the branch, and you cannot land it afterwards, because complete closes this tab. So after the last round the question is what to do with the land, never only whether to complete: say what failed and whether the run's work caused it, recommend one option, and offer at least `Land anyway` and `Keep the land held`, plus any other course you can ground. `Land anyway` is `wsh jarvis complete --report <file> --force-land`, only on that answer; held is the plain complete, and the human can still land it later with `wsh runs land <run> --force`. The report says which was chosen.\n", AskTool("claude"))
	fmt.Fprintf(&b, "- plan review failed: revise the plan (put spec changes to the human) and run `wsh jarvis dag submit` again. After round 2 fails, put it to the human with %s, as one ask with the header `Plan review`, the plan's absolute path as the question's first line, one line saying what you propose, then one `- ` line per finding you would accept, and the options `Accept all and proceed` and `Request changes`. %s If the human says to proceed, first carry each accepted finding into the pending tasks it affects with `wsh jarvis dag amend <task> \"<note>\"`, so a worker fixes it and a reviewer checks it (every task waits until you accept, and accept spawns the first ones), then run `wsh jarvis dag planreview accept \"<the human's reason>\"`; a finding no pending task can take is an open issue, not wrap-up work.\n", AskTool("claude"), QuotedNotesRule("Accept all and proceed"))
	// a run marker, not attribution: a checkout-landed run's evidence counts only the commits carrying it
	fmt.Fprintf(&b, "End each commit you make for this run with the line `Arc-Run: %s`.\n", runId)
	b.WriteString("Never re-plan and never do a task's own work. " + NoAttributionRule + "\n")
	b.WriteString(SubagentCapRule)
	return b.String()
}

// PlanLeadPrompt is the launch prompt of a lead started after its plan was submitted (spec §1, G5). There is
// no goal to brainstorm, so it starts from the orchestration rules, and the wake that needed a lead is its
// first message: one turn, with nothing typed after it.
func PlanLeadPrompt(principles waveobj.PrincipleList, runId, specPath, planPath, wake string) string {
	var b strings.Builder
	if rendered := RenderPrinciples(principles); rendered != "" {
		fmt.Fprintf(&b, "Work by these principles:\n%s\n%s\n\n", rendered, ContractWinsLine)
	}
	b.WriteString(OrchestrationRules(runId, specPath, planPath))
	b.WriteString("\n\n")
	b.WriteString(wake)
	return b.String()
}
