// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// codexAskTool is the shell form a codex worker asks with: codex has no ask tool the cockpit sees, so it runs
// `wsh ask --wait`, which goes through the same AskCommand RPC as pi's bridge (the engine routes the question to
// the lead, then the human). The ask blocks for as long as they take, up to wsh ask's 30-minute ceiling, and
// codex's shell tool gives a command a short default timeout and may hand back a still-running session, so the
// text says how to survive both.
const codexAskTool = "the shell command `wsh ask --wait --questions-json '{\"questions\":[{\"question\":\"<the question>\",\"header\":\"<a short label>\",\"options\":[{\"label\":\"<an option>\",\"description\":\"<what it means>\"}]}]}'` " +
	"(it blocks until the lead or the human answers, then prints the answers as JSON; run it with the shell tool's timeout set to 1800000 ms, " +
	"and if the tool returns while the command still runs, keep reading that session until it prints the answers JSON; never start a second ask)"

// AskTool names the structured question tool a runtime's agent calls. A question asked in plain text
// never reaches the cockpit, so every prompt that tells an agent to ask names this tool. For codex it is
// the shell command it runs, with how to run it.
func AskTool(runtime string) string {
	switch runtime {
	case "pi":
		return "ask_user_question"
	case "agy":
		return "ask_question"
	case "codex":
		return codexAskTool
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

// fixPlanHome: the round commits the plan to the run's branch, and a plan in no repository (a temp dir) cannot be
// placed there.
const fixPlanHome = "Write the fix plan inside the repository (your working directory is fine); a plan outside any git repository is refused."

// QuotedNotesRule tells a lead how to read a review answer that is text: the review dialog sends an approval
// with quoted notes as text opening with the approve option's label, which otherwise reads as a change request.
func QuotedNotesRule(approveLabel string) string {
	return fmt.Sprintf("The human can quote passages of the document with a note on each, so an answer that starts with `%s` is an approval, and its `> ` quoted notes are applied before proceeding; any other text is a change request.", approveLabel)
}

// AutonomousRules is the one text an autonomous run's lead works by: the launch prompt, the orchestration
// rules and the mid-run ON wake all carry it. One line, so it can ride in a wake. It names no ask tool and no
// review header, since an autonomous launch prompt must not invite either.
const AutonomousRules = "Approvals for this run are autonomous: nobody is at the cockpit. Wherever these rules say to put something to the human or ask the human, take the option you would recommend instead, and record the call and why in your report; never raise a question for the human, since nobody is there to answer it. " +
	"Plan review failed after the last round, or its reviewer was lost: carry each finding into the pending tasks it affects with `wsh jarvis dag amend <task> \"<note>\"`, then run `wsh jarvis dag planreview accept \"autonomous run\"`; a finding no pending task can take is an open issue in your report. " +
	"Spec changes while you revise the plan: make them and record them in your report. " +
	"`wsh jarvis dag forward` is refused, so decide yourself (answer, retry, escalate, skip or send back) and record why. " +
	"Final stage failed after the last round: run the plain `wsh jarvis complete --report <file>`, which holds the land, never with `--force-land`, and say in the report that the land is held and why."

// AutonomousOnAnswer answers the lead's own waiting question when the run turns autonomous. It is typed at
// 60ms per rune, so it stays one short line.
const AutonomousOnAnswer = "The human is away and this run is now autonomous: decide this as you would recommend, record the call in your report, and stop asking."

// AutonomousOnWake tells a running lead its run turned autonomous. A wake is typed as one line.
const AutonomousOnWake = "wake: approvals for this run are now autonomous and the human is away. " + AutonomousRules

// AutonomousOffWake tells a running lead its run is back to asking the human.
const AutonomousOffWake = "wake: approvals for this run are back to Ask me: from your next decision, put the decisions these rules give the human to the human again; calls you already made stand."

// writePlanAndSubmit is the architectural path's plan step, shared by the asking and the autonomous launch.
const writePlanAndSubmit = "write the plan with superpowers:writing-plans in the plan format below, except its complete-code rule: a task carries the design decisions it makes, the files it owns, any interface or signature another task relies on, and its acceptance criteria with the focused tests that prove them, but not the implementation, which its worker writes. Break it up by what can proceed independently: the engine runs those tasks at the same time, and a plan that is one serial chain gets none of that. Don't commit the spec or plan yourself (the engine commits the spec and plan to the run's branch at submit, and they land with the run) and don't execute the plan: run `wsh jarvis dag submit --plan <plan path> --spec <spec path>` with absolute paths and stop."

// writeLaunchPrompt is an engine lead's prompt for a goal run (spec §2). The lead brainstorms with the
// human and the skill's classification picks the path; only an architectural goal reaches the engine,
// as a plan file the engine parses. An autonomous lead classifies and decides alone.
func writeLaunchPrompt(b *strings.Builder, goal, runtime string, autonomous bool) {
	fmt.Fprintf(b, "Goal: %s\n", goal)
	if autonomous {
		writeAutonomousPaths(b)
	} else {
		writeAskingPaths(b, runtime)
	}
	// the bounded path commits here, before any dag exists to hand it OrchestrationRules
	b.WriteString(NoAttributionRule + "\n")
	b.WriteString(SubagentCapRule + "\n\n")
	b.WriteString(PlanFormat)
}

// the report goes in with complete: the seal runs then, and with none it takes the last line written before it
const spikePath = "- spike: write the answer as your final report with your file-writing tool to a file in the system temp directory, not in the repository, then `wsh jarvis complete --report <that file>`.\n"

func writeAutonomousPaths(b *strings.Builder) {
	b.WriteString("Work this goal on your own: nobody is at this terminal. Ask no questions and wait for no yes; make each call the human would otherwise make as you would recommend it.\n")
	b.WriteString("Classify the path yourself (spike, bounded or architectural), state it, and proceed.\n")
	b.WriteString(spikePath)
	b.WriteString("- bounded: implement it here, get the tests passing, commit, write your final report (what you did, the calls you made and why, and what you could not verify and why) to a temp file the same way, then `wsh jarvis complete --commit $(git rev-parse HEAD) --report <that file>`. A goal that needs a plan worked task by task, a subagent per task, is not bounded: it is architectural, and the engine runs it.\n")
	b.WriteString("- architectural: make the design decisions yourself and write the design straight into the spec file, with each decision and why. When the goal names a mockup or design canvas that settles the design, write no spec file: write the decisions you make beyond it, with why, into the plan's header, put its absolute path on the plan's `**Prototype:**` line, and submit without `--spec`. Then " + writePlanAndSubmit + " The engine reviews the plan after `dag submit`, and wakes you when something needs judgment.\n")
	b.WriteString(AutonomousRules + "\n")
}

func writeAskingPaths(b *strings.Builder, runtime string) {
	fmt.Fprintf(b, "Work this goal with the superpowers:brainstorming skill; the human is at this terminal. Put every question and every approval through %s, never plain text, which does not reach the cockpit.\n", AskTool(runtime))
	b.WriteString("State the path you take (spike, bounded or architectural) and proceed; ask about the path only when it is genuinely unclear. Any approval of something longer than its question carries the file's absolute path on its first line.\n")
	b.WriteString(spikePath)
	b.WriteString("- bounded: after the human's yes, implement it here, get the tests passing, commit, write your final report (what you did, and what you could not verify and why) to a temp file the same way, then `wsh jarvis complete --commit $(git rev-parse HEAD) --report <that file>`. A goal that needs a plan worked task by task, a subagent per task, is not bounded: it is architectural, and the engine runs it.\n")
	fmt.Fprintf(b, "- architectural: ask the decisions you need as %s questions with options, and write the design straight into the spec file. Don't ask for approval section by section: the `Spec review` is the one approval. ", AskTool(runtime))
	b.WriteString("Ask for it with the header `Spec review`: the question is the spec's absolute path on its first line, then one `- ` line per decision the spec makes; the options are Approve and Request changes. " + QuotedNotesRule("Approve") + " When the goal names a mockup or design canvas that settles the design, write no spec file: the `Spec review` question is the mockup's absolute path on its first line, then one `- ` line per decision you make beyond it; put its absolute path on the plan's `**Prototype:**` line, and submit without `--spec`. After the approval, " + writePlanAndSubmit + " After `dag submit`, don't ask the human to review the plan or pick an execution mode: the engine reviews the plan, and wakes you when something needs judgment.\n")
}

// OrchestrationRules is what a lead holding a dag works by (spec §2). A compaction drops the launch
// prompt, so these come back after every compaction of a lead session. specPath and planPath are empty
// for a dag submitted without files; effortOID is empty for a run with no effort. autonomous comes from the
// group, so the rules a compaction brings back follow a mid-run switch.
func OrchestrationRules(runId, specPath, planPath, effortOID string, autonomous bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "You are the lead for run %s.", runId)
	if specPath != "" {
		fmt.Fprintf(&b, " Spec: %s.", specPath)
	}
	if planPath != "" {
		fmt.Fprintf(&b, " Plan: %s.", planPath)
	}
	if effortOID != "" {
		fmt.Fprintf(&b, " Effort: effort:%s.", effortOID)
	}
	b.WriteString(" The engine schedules, merges and tests. Each wake names an event and the command that shows it; re-read only what the event needs.\n")
	// the engine moves an unanswered question to the human at its deadline and then refuses the lead's answer,
	// which can happen while the lead's own ask is open.
	fmt.Fprintf(&b, "- questions: answer from the spec and plan; check code with Read/Grep when they don't settle it; `wsh jarvis dag answer <task> <answers-json>`. A product or scope call, or spec, plan and code disagreeing: ask the human yourself with %s (%s on pi), what you checked and what you recommend first, then relay the human's choice with `wsh jarvis dag answer <task> <answers-json>`. Before you ask, and before you ask again, run `wsh jarvis dag asks`: the human may have answered it in the cockpit. A question moves to the human by itself when its deadline passes (`dag asks` shows it) or the human takes it over, and `dag answer` is then refused; when that happens, or `dag asks` no longer lists the task, relay nothing: it is answered, or waits on the run sheet for the human.\n", AskTool("claude"), AskTool("pi"))
	b.WriteString("- task still failing, or worker hung: `wsh jarvis dag retry <task>`, retry on another model with `wsh jarvis dag escalate <task> --model <model>`, `wsh jarvis dag skip <task>`, or forward.\n")
	b.WriteString("- a task failed as stopped-by-human: the human stopped its worker; leave it to them, and don't retry, escalate or skip it unless they ask.\n")
	b.WriteString("- merge conflict, or tests failed at a merge point: fix it in this working tree, where the lanes land, commit, `wsh jarvis dag merge <task> --continue` (the engine re-runs Verify).\n")
	b.WriteString("- a task passed review with a note for later tasks: check the pending tasks it affects and add what they need with `wsh jarvis dag amend <task> \"<note>\"`; use `wsh jarvis dag tell <task> \"<text>\"` only for a running task the note changes. Amending is not re-planning: never add, remove or reorder tasks.\n")
	b.WriteString("- review failed: the findings are in `wsh jarvis dag status`. `wsh jarvis dag sendback <task> \"<guidance>\"` if the fix is clear, `wsh jarvis dag approve <task>` if the reviewer is wrong, otherwise retry, escalate, skip or forward.\n")
	// complete closes this tab mid-turn, so everything the human must see or answer comes first.
	b.WriteString("- run finished: review what landed with `wsh jarvis dag status`; a task's full outcome is `wsh jarvis dag report <task> [section]`, and a cut text in a wake ends with that command, while `dag status` names it on each done task's report line. Fix and commit what the landed tasks left behind in docs (a stale doc line, a shipped plan). A code defect is never a wrap-up commit, since nothing reviews it. Collect the open issues from the tasks' Found not fixed and Not verified sections and anything you noticed. When the wake says a round is left and some open issues are defects inside the run's goal that a worker can fix, write a fix plan for only those in the plan format, run `wsh jarvis dag submit --round --plan <fix plan>` and stop: the round's tasks are reviewed, the final stage runs again, and you wrap up at the next run-finished wake. " + fixPlanHome + " Failures already on the base, work outside the goal, checks that need the human or an environment, and whatever a round left are not round work. To wrap up, write the report to a file, for judgment only: one line per task on what it did; the decisions you made (answers, skips, tells, sendbacks, a round) and why; wrap-up commits; and the open issues, each with its effort chunk. Don't list landed commits, worktrees left behind, answered or forwarded counts or the unverified list: the engine records those. Add each open issue as a pending chunk on the effort named above, or the one the goal names (`wsh effort chunk add <effort> \"<issue>\"`); with neither, create one with `wsh effort create \"<title>\" --chunk \"<issue>\"`. ")
	fmt.Fprintf(&b, "Ask the human with %s (%s on pi) only when a decision is needed: a verification failed or a deviation needs the human's call; never in plain text. Otherwise complete on your own with `wsh jarvis complete --report <file>`, without asking whether to: it closes this tab, so any question comes before it. The run-finished wake names each thing the land would hold on, with what to do: fix a conflict it names before you complete; never commit, stash, restore or delete uncommitted changes in the checkout that are not yours (they are another session's or the human's), only name them in the report, since the engine lands the run by itself once they are gone. Complete lands the branch before it returns and prints the outcome, `landed <sha>` or `held: <reason>`; when held, add the reason to the report file and run `wsh jarvis complete --report <file>` again, which replaces the report. Runs of one project land one at a time, so the outcome can also be `land queued` (in line behind another run of the project) or `land resolving` (a resolver session is merging the base into the run's branch): neither is a failure or a hold, so the report says which it was and you do not land it again. The land goes on without you. With the dag done, this tab closes whatever the land is doing; after a failed final stage the dag stays blocked, so a land forced past it that is still queued keeps this tab open until it lands. An outcome of not verified never blocks completion: the run completes as unverified, and its branch still lands. A failed final stage does not block completion either, but it holds the land (below). Add tasks only through a round.\n", AskTool("claude"), AskTool("pi"))
	fmt.Fprintf(&b, "- final stage failed: the defects are in the wake. Write a fix plan in the plan format and run `wsh jarvis dag submit --round --plan <fix plan>`, at most 2 rounds. %s A fix plan brings tasks only: the round runs the run's own Verify, Setup, Check and Final, and one naming different commands is refused; after that, or when the fix is a product call, put it to the human with %s. A failed final stage holds the land: completing does not merge the branch, and you cannot land it afterwards, because complete closes this tab. So after the last round the question is what to do with the land, never only whether to complete: say what failed and whether the run's work caused it, recommend one option, and offer at least `Land anyway` and `Keep the land held`, plus any other course you can ground. `Land anyway` is `wsh jarvis complete --report <file> --force-land`, only on that answer; held is the plain complete, and the human can still land it later with `wsh runs land <run> --force`. A forced land can come back `land queued` or `land resolving` when other runs of the project land first: that is the land under way, not a hold. The report says which was chosen.\n", fixPlanHome, AskTool("claude"))
	fmt.Fprintf(&b, "- plan review failed: revise the plan (put spec changes to the human) and run `wsh jarvis dag submit` again; it prints the review round it opened, and a submit that does not print one says whether the plan landed. The dag's status reads plan-review while a review runs and after one failed, so trust `dag status`'s `plan review` line, which says reviewing or failed. After round 2 fails, put it to the human with %s, as one ask with the header `Plan review`, the plan's absolute path as the question's first line, one line saying what you propose, then one `- ` line per finding you would accept, and the options `Accept all and proceed` and `Request changes`. %s If the human says to proceed, first carry each accepted finding into the pending tasks it affects with `wsh jarvis dag amend <task> \"<note>\"`, so a worker fixes it and a reviewer checks it (every task waits until you accept, and accept spawns the first ones), then run `wsh jarvis dag planreview accept \"<the human's reason>\"`; a finding no pending task can take is an open issue, not wrap-up work.\n", AskTool("claude"), QuotedNotesRule("Accept all and proceed"))
	// a run marker, not attribution: a checkout-landed run's evidence counts only the commits carrying it
	fmt.Fprintf(&b, "End each commit you make for this run with the line `Arc-Run: %s`.\n", runId)
	b.WriteString("Never re-plan and never do a task's own work. " + NoAttributionRule + "\n")
	b.WriteString(SubagentCapRule)
	if autonomous {
		b.WriteString("\n" + AutonomousRules)
	}
	return b.String()
}

// PlanLeadPrompt is the launch prompt of a lead started after its plan was submitted (spec §1, G5). There is
// no goal to brainstorm, so it starts from the orchestration rules, and the wake that needed a lead is its
// first message: one turn, with nothing typed after it.
func PlanLeadPrompt(principles waveobj.PrincipleList, runId, specPath, planPath, effortOID string, autonomous bool, wake string) string {
	var b strings.Builder
	if rendered := RenderPrinciples(principles); rendered != "" {
		fmt.Fprintf(&b, "Work by these principles:\n%s\n%s\n\n", rendered, ContractWinsLine)
	}
	b.WriteString(OrchestrationRules(runId, specPath, planPath, effortOID, autonomous))
	b.WriteString("\n\n")
	b.WriteString(wake)
	return b.String()
}
