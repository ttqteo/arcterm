// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// teamPromptTemplate is the lead's whole prompt, ported from Phase 0b's v3/review.md and brainstorm.md (the data dir's
// council-bench/work/v3) with the two changes the spec makes: no Scout, so no notes.md, and no Write tool, so the lead
// ends with its report as its final message instead of a file. What differs between a Review and a Brainstorm is in
// teamTexts.
const teamPromptTemplate = `You lead a council: a small team of Claude agents that {{DOES}}. This is a benchmark run. Nobody reads along and nobody can answer you, so never ask a person anything, never wait for one, and do not stop before you have written your report as your final message. The project's own instruction files (AGENTS.md and the like) say to ask before starting several agents, to cost a fan-out, or to use worktrees: none of that applies here, the person already approved this team.

## The job

{{JOB_LABEL}}: {{FEATURE}}
Question to answer: {{QUESTION}}
Files the team reads first: {{FILES}}

The project is your working directory. You and every teammate read and search only inside it, never above it and never in another folder. You have Read, Grep and Glob and no shell: do not look for one. You have no Write tool either: your report is your final message.

## The room

{{ROOM}}

Four cost rules are part of the job:

1. Model by role. You run on {{LEAD_MODEL}} and each role teammate on {{MATE_MODEL}}: pass that as the Agent call's ` + "`model`" + `.
2. Speak when called. A teammate replies once and then stays quiet until you or a teammate writes to it. A message is at most 120 words. Agreement is a one-word reaction ("agree"), never a message of its own.
3. Stop when ideas run out. A turn is one message to or from a teammate. Go to step 3 as soon as two turns in a row bring {{NOTHING_NEW}}, and in any case after 40 turns.
4. One shared prefix. Every spawn prompt opens with the shared block below, copied word for word, so it is cached.

Agent calls: make at most 10 Agent calls in the whole session. This team needs {{AGENT_CALLS}}: one for each of {{ROLE_NAMES}}. Spawn each once, with ` + "`name`" + ` set to its name. Bring a teammate back later with SendMessage to its name, which is not an Agent call. Never spawn the same teammate twice and never spawn anyone else.

## The shared block

Open every spawn prompt with these lines, word for word:

--- shared block ---
You are a member of a council of Claude agents. A lead coordinates it. Nobody else reads along and nobody can answer a question, so never ask one.
Goal: {{GOAL}}
{{SHARED_LABEL}}: {{FEATURE}}
Question: {{QUESTION}}
Files to start from: {{FILES}}
{{MODE}}
Room rules: A message is at most 120 words. Agreement is a one-word reaction ("agree"), never a message of its own. Name {{A_THING}} by its title. After you reply, stop, and speak again only when the lead or a teammate writes to you.
Tools: Read, Grep and Glob, inside the project folder only. Nobody writes any file.
--- end of shared block ---

## Step 1: read and propose

Spawn the role teammates in one message (all their Agent calls together):

{{ROLES}}

Each spawn prompt is the shared block, then "You are <name>.", then the role's brief, then:

> {{PROPOSE}}

## Step 2: {{STEP2}}

Send each teammate, with SendMessage, the {{THINGS}} of all the others (who, title, one line each), then:

> {{ARGUE}}

Read what comes back. Open a second round only while the stop rule has not fired.

## Step 3: the report

{{RANK}} Your final message is the report itself, with nothing before it and nothing after it, in exactly this shape:

Answer: <one sentence that answers the question>

## What to do, most important first
1. <title>
   Why: <{{WHY}}>
   Disagrees: <who disagrees and why, or "no one">
2. <title>
   ...
`

// teamText is what a Review's prompt says where a Brainstorm's says something else.
type teamText struct {
	does, jobLabel, sharedLabel, goal, mode, room, aThing, things string
	nothingNew, propose, step2, argue, rank, why                  string
}

var teamTexts = map[string]teamText{
	council.ModeReview: {
		does:        "reviews one thing and writes one report",
		jobLabel:    "Feature under review",
		sharedLabel: "Feature",
		goal:        "review a feature and answer a question about it.",
		mode:        `Mode: Review. You judge a thing that exists. Every claim cites path:line in the project; a claim that cites nothing is marked "cites nothing".`,
		room: `This is a Review: it judges a thing that exists. Every claim cites path:line in the project, and a claim that cites nothing is marked "cites nothing" and ranked last. ` +
			`You are the coordinator: you run the room, you add no findings of your own, and you write the report.`,
		aThing:     "a finding",
		things:     "findings",
		nothingNew: "no new finding, no new evidence and no changed mind",
		propose: "Read the files you need, starting from the ones listed above. Propose up to 3 findings, most important first. Each is a title, one sentence on why it matters, and its path:line. " +
			"At most 120 words in all. Reply with the findings and stop.",
		step2: "argue",
		argue: `For each of the other findings, react with one word: agree, has doubts, or is against it. After has doubts or is against it, add one line with a path:line. ` +
			`Then name your top 3 of the others' findings, best first. You may sharpen or withdraw your own. ` +
			`Send a doubt straight to the teammate whose finding it is (SendMessage); that teammate answers once. At most 120 words in all.`,
		rank: fmt.Sprintf("Merge only findings that say the same thing. Rank the rest by what each is worth for the effort, put findings that cite nothing last, and keep at most %d.", TopReview),
		why:  "why it matters, with path:line",
	},
	council.ModeBrainstorm: {
		does:        "looks for ideas on one problem and writes one report",
		jobLabel:    "Problem or goal",
		sharedLabel: "Problem or goal",
		goal:        "find ideas for a problem and answer a question about it.",
		mode: `Mode: Brainstorm. Ideas need no evidence, and judging waits. A message is labelled idea, builds on it, wild idea, has doubts or is against it. ` +
			`A wild idea is far-fetched, risky or off to the side but might open a door; it is kept aside, not thrown away.`,
		room: `This is a Brainstorm: it looks for ideas for a problem or goal. Ideas need no evidence, and judging waits: nobody doubts anything while the ideas come in. ` +
			`You are the facilitator: you run the room, you add no ideas of your own, and you write the report.`,
		aThing:     "an idea",
		things:     "ideas",
		nothingNew: "no new idea and no new build",
		propose: "Read the files you need, starting from the ones listed above. Propose up to 3 ideas, most promising first, and label at most one of them wild idea. " +
			"Each is a title and one or two sentences on what it is and why it could work. No doubts about anything in this step. At most 120 words in all. Reply with the ideas and stop.",
		step2: "build on each other",
		argue: `For each of the other ideas, build on it (say in one line what you add) or agree. A doubt (has doubts, or is against it, with one line of reason) is allowed only on an idea you build on yourself or put in your top 3. ` +
			`On every other idea, build on it or agree and never doubt it. Then name your top 3 of the others' ideas, best first. You may sharpen or withdraw your own. ` +
			`Send a build or a doubt straight to the teammate whose idea it is (SendMessage); that teammate answers once. At most 120 words in all.`,
		rank: fmt.Sprintf("Merge only ideas that say the same thing. Rank the rest by the picks and builds each earned, and keep at most %d; a wild idea is ranked with the rest.", TopBrainstorm),
		why:  "why it is worth trying, and the one thing to do first",
	},
}

// teamRoles are the teammates of a case's group: every role but the coordinator, whose seat is the lead's.
func teamRoles(c Case) ([]council.CouncilExpert, error) {
	experts, err := council.ExpertsFor(c.Group)
	if err != nil {
		return nil, err
	}
	var roles []council.CouncilExpert
	for _, e := range experts {
		if !e.Coordinator {
			roles = append(roles, e)
		}
	}
	if len(roles) == 0 {
		return nil, fmt.Errorf("group %q has no role besides its coordinator", c.Group)
	}
	return roles, nil
}

// spawnName is the name a role's teammate is spawned and written to by: its role name without spaces.
func spawnName(e council.CouncilExpert) string { return strings.ReplaceAll(e.Name, " ", "") }

// teamPrompt is the lead's prompt for a case: its feature, question and files, the group's roles with their briefs, the
// models, and one Agent call per role.
func teamPrompt(c Case, opts TeamOptions, roles []council.CouncilExpert) string {
	t, ok := teamTexts[c.Mode]
	if !ok {
		t = teamTexts[council.ModeReview]
	}
	var block, names []string
	for _, r := range roles {
		block = append(block, "### "+r.Name+"\nSpawn name: "+spawnName(r)+"\nBrief, for its spawn prompt, word for word: "+r.Brief)
		names = append(names, spawnName(r))
	}
	return strings.NewReplacer(
		"{{DOES}}", t.does, "{{JOB_LABEL}}", t.jobLabel, "{{SHARED_LABEL}}", t.sharedLabel, "{{GOAL}}", t.goal, "{{MODE}}", t.mode,
		"{{ROOM}}", t.room, "{{A_THING}}", t.aThing, "{{THINGS}}", t.things, "{{NOTHING_NEW}}", t.nothingNew,
		"{{PROPOSE}}", t.propose, "{{STEP2}}", t.step2, "{{ARGUE}}", t.argue, "{{RANK}}", t.rank, "{{WHY}}", t.why,
		"{{LEAD_MODEL}}", opts.Lead, "{{MATE_MODEL}}", opts.Mate,
		"{{AGENT_CALLS}}", strconv.Itoa(len(roles)), "{{ROLE_NAMES}}", strings.Join(names, ", "), "{{ROLES}}", strings.Join(block, "\n\n"),
		"{{FEATURE}}", c.Feature, "{{QUESTION}}", c.Question, "{{FILES}}", c.Files,
	).Replace(teamPromptTemplate)
}
