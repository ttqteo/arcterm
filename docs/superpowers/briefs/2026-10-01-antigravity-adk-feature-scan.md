# Antigravity / ADK feature scan for Arc (2026-10-01)

Which features of Google Antigravity 2.0 and ADK 2.0 (both announced at I/O, 2026-05-19) Arc should adopt,
judged against what Arc already has and against the user's own transcripts. Tracked by the effort
"Antigravity/ADK ideas: highlight-to-quote and engine-stage graph nodes"
(`effort:43b12224-7afd-4632-a600-13bdb96064dd`); delete this brief when that effort closes.

## Method

Human-typed prompts were mined from `~/.claude/projects/**/*.jsonl` and `~/.pi/agent/sessions/**/*.jsonl`
(about 3,600 prompts, Aug 2026 to 2026-10-01). Filters followed `pkg/agentsessions/humanprompts.go`, and
engine/subagent briefs ("Task:", DAG child workers, final verifiers, revived subagents) were dropped. The
classification is regex-based, so the counts are approximate. Re-measure the same way before acting on a
count.

## Already covered in Arc

| Antigravity / ADK | Arc |
|---|---|
| Agent Manager ("mission control": every agent's status, pending approvals) | Cockpit surface, `wsh ask` |
| Subagents, async parallel work, ADK graph workflows | `pkg/orchestrate` DAG engine; Depends-on lines set the width |
| Native git worktrees with auto cleanup | Engine worktrees and lanes, `wave/<runId>` landing |
| Hooks before/after tool calls, model calls and stop | Claude Code hooks installed by `install-agent-hooks` |
| Projects with per-project permissions | Projects, `pkg/jarvis/claudetrust.go` |
| Plan review before execution | Engine plan reviewer; doc-review dialog (`docreviewdialog.tsx`) for a lead's Spec/Plan ask |

## How the user gives agents feedback (measured)

- Screenshot plus a one-line comment on the UI: ~100, 84 of them in September. This is the main channel.
- A short instruction plus quoted agent output ("lets fix these as well ...", "note this down to open issues
  ...", "explain this ..."): a large share of 176 long-quote prompts. The rest are pasted SIEM server logs.
- Line-anchored code-review comments the user wrote: none. Code review goes to reviewer agents and the engine.
- In-cockpit handoffs: the Code surface's "Send to agent" (`codepathbar.tsx`), 2 uses since August. Canvas
  send-marks (`canvassend.ts`, shipped 2026-09-30), 0 so far.
- Scheduled or recurring prompts: none. No short prompt repeats on 3 or more days. `CronCreate`, `/loop` and
  `/schedule` were never used; all 28 `ScheduleWakeup` calls were agents waiting on `go test`.
- Animation complaints: about 7, all taste calls the user caught by watching ("appear animation is weird").
- Markdown: the user reads a lot of markdown that agents write (findings docs, walkthroughs with screenshots,
  specs, plans, `open-issues.md`) and answers it by quoting. The rendering complaints (text too large, jump
  back to top, flicker; 2026-09-07/09) were fixed in `0bbb13af` and `c938ed41`. No sign of editing markdown by
  hand.
- Run graph: the evidence is thin. There were 11 "is it stuck / what's the progress" prompts, lane
  merge-conflict wakes, and "the timeline doesnt match the new DAG timeline". Transcripts cannot show whether
  the user opens the graph.

## Candidates

### 1. Highlight-to-quote on rendered markdown (recommended)

Antigravity renders a plan or spec as a document. The user highlights a passage or picks a step, comments
inline, then presses Proceed. Arc's doc-review dialog already renders the document with Approve / Request
changes, but Request changes is free text that points at nothing. The proposal: select a passage, add a note,
and Request changes carries the quoted passages with the notes. Later, the same gesture wherever Arc renders
agent-written markdown (Code `.md` preview, run report). It is the user's quote-back habit, moved to where the
reading already happens.

Shipped for the doc-review dialog on 2026-10-05 (`docreviewnotes.ts`, `docreviewnotesview.tsx`); Approve
carries the notes too. The Code `.md` preview and the run report are not done.

- Delivery: `ControllerInputCommand` submits at the first newline, which is why `codehandoff.ts` keeps each
  payload to one line. A batch of quotes therefore goes the canvas way (`canvassend.ts`): write a file, type
  one line naming it. A doc-review answer goes through the ask's own answer path instead.
- Overlap to settle while building it: Arc has three markdown renderers. `frontend/app/element/markdown.tsx`
  (502 lines) serves the Code preview and the DAG detail rail; `view/agents/markdownmessage.tsx` and
  `inlinemarkdown.tsx` serve ~13 files, including doc review and plan preview. Build quoting once, and check
  whether `MarkdownMessage` can merge into the shared renderer. Not yet checked whether it is deliberately
  light for chat messages.
- Process: new UI, so an orchestrator run that starts with `/design-local`.

### 2. Engine stages and gates as graph nodes (pending a user answer)

ADK 2.0 graphs mix several node types (agent, function, tool, human input), route conditionally, join parallel
branches, and the dev UI highlights live execution ([ADK graphs](https://adk.dev/graphs/)). Arc's DAG graph
(`frontend/app/view/orchestrate/daggraph.tsx`, `dagnodes.tsx`) draws only task cards and lane bands. Setup,
merge Verify, review, Final, plan review and asks waiting on the user appear only as edge styles ("needs-you",
"waiting") or in the timeline rail. Drawing them as nodes would show where a run is actually stuck. Worth
building only if the user opens the graph when a run looks stuck. `DagOverview` is unmounted, and the graph
opens only as a modal from the Brief.

### 3. Retire the Code surface's "Send to agent" (re-measure)

2 uses since it shipped (2026-08-06 spec). If canvas send-marks also stays unused by about 2026-10-15,
in-cockpit handoffs are not how the user works: retire this one, and drop the idea of screen markup across the
whole cockpit.

## Dropped, with reasons

- Diff-surface line comments: no line-anchored review by the user; code review is delegated.
- Scheduled prompts (Antigravity cron tasks): no recurring prompts. Claude Code's `/schedule` and `/loop` cover
  this already.
- Browser recordings for the Final verifier: the animation complaints are taste calls; frames would not let a
  verifier judge them.
- Markdown WYSIWYG editor: no hand editing found. The Code surface already has Monaco plus preview, and
  Antigravity's own plan view breaks when a custom `.md` editor is set
  ([forum](https://discuss.ai.google.dev/t/antigravity-ide-selecting-default-editor-for-md-files-breaks-implementation-plan-presentation-features/178737)).
- ADK drag-and-drop visual builder: plans are markdown written by a lead and checked by the plan reviewer;
  editing a graph by hand has no role.
- Voice input, ADK Kotlin/on-device agents, Managed Agents API: polish for a personal tool, or concerns of a
  hosted platform.

## Sources

- [Antigravity I/O 2026 feature deep dive](https://antigravity.google/blog/google-io-2026-feature-deep-dive)
- [Antigravity Artifacts](https://antigravity.google/docs/artifacts/),
  [Artifact Review](https://antigravity.google/docs/artifact-review/), [/plan](https://antigravity.google/docs/plan/)
- [ADK graph-based workflows](https://adk.dev/graphs/), [Why we built ADK 2.0](https://developers.googleblog.com/why-we-built-adk-20/)
- [Virtualization Review: Managed Agents, ADK 2.0](https://virtualizationreview.com/articles/2026/05/19/google-io-26-fills-out-enterprise-agent-stack-with-managed-agents-adk-2,-d-,0.aspx)
