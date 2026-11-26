# Rail Overview stays put on an agent switch

## Intent

Switching to another agent makes the Agent details rail's Overview jump: Files changed drops to a skeleton, then its
list, the branch line and the worktree line come back one after another. The person wants that switch to feel smooth.

## What happens today

- `railStateAtom` (`frontend/app/view/agents/railstore.ts`) is one shared atom for the focused agent's git state.
- `loadRailForAgent(agent)` sets it to `null` on every non-silent call, which is every agent switch
  (`agentdetailsrail.tsx:881`). Files changed draws three `SkeletonLine`s while it is `null`
  (`agentdetailsrail.tsx:1164`). The rail fills in only after three git RPCs land: `readAgentChanges`,
  `GitListWorktreesCommand` and `GitChangesCommand` with `branchbase`.
- `loadRailForAgent(agent, { silent: true })` already re-reads with the old list left on screen (used after a turn
  ends and after a commit). `railCwdsAtom` already keeps each agent's cwd by agent id for the same reason.
- `current.id` drops a result that belongs to an agent that is no longer focused.

## Decision

**Remember the rail's state per agent.** Keep the last value each agent's read produced, keyed by agent id, for all
three stores the rail resets on a switch:

- git state: `railStateAtom`, loaded by `loadRailForAgent` (`railstore.ts`);
- session usage: `sessionUsageAtom`, loaded by `loadSessionUsage`, which sets it to `null` on a non-silent load
  (`transcriptusagestore.ts:35-37`; called on every `agent.id` change, `agentdetailsrail.tsx:925-932`). While it is
  `null`, the spend headline goes away and the model label falls back to the roster family
  (`agentdetailsrail.tsx:1076-1091`);
- cache status: `agentCacheStatusAtom`, loaded by `loadCacheStatusForAgent`, which also sets it to `null` on a switch
  (`cachestatusstore.ts:30-32`). The cache countdown then reads "—" and drops out of the line
  (`agentdetailsrail.tsx:1028-1029`).

On a switch to an agent that has a remembered value, the rail shows it at once and re-reads in the background the
way a silent re-read does. The list, the branch and worktree lines, the spend headline, the model label and the cache
countdown then update in place when each read lands. Only an agent with no remembered value shows the skeleton or the
empty line. All three stores follow the same pattern: a per-agent map, cleanup when the agent leaves the roster, and a
guard against a stale result (builder question 1).

**Only after the first view.** Nothing is read ahead. The first time an agent is opened in a session, its rail still
shows the skeleton. From the second time on, it shows at once. No hover prefetch and no read of every live agent.

## Out of scope

These stay as they are:

- Each agent remembers its own rail tab, and an agent with no tab set still opens on Brainstorm or Initiative
  (`contextPanel`).
- The rail still slides when the new tab is in the other width group (`railSlides`, `element/railslide.ts`).
- Empty sections stay hidden (`planAgentRail`, `agentrailsections.ts`).
- Status motion (`animate-spin`, `animate-pulse`, `settle`) and surface switches are left for a later pass, if things
  still feel busy after this fix.

## Left to the builder

- Where the per-agent store lives: a map atom beside `railStateAtom` in `railstore.ts`, or `railStateAtom` itself
  turned into one. The consumers that read the focused agent's state (`agentdetailsrail.tsx`, `pathlinkroute.ts:266`,
  `railchangesmodel.ts`) must keep reading the focused agent's entry, never another agent's.
- Drop an agent's remembered state when the agent closes or leaves the roster, so the store holds nothing for agents
  that are gone.
- The background read still drops results for an agent that is no longer focused (`current.id`), and it must not
  write one agent's result under another agent's key.
- A remembered state that holds a `failure` is not shown again. That agent reads as on a first view.
- Pure tests for each of the three stores (`railstore.test.ts` and the usage and cache stores' tests): switching A to
  B and back to A never passes through `null` for A; a first view still goes through `null`; a late result for A does
  not land while B is focused.
- One `arc:ux-check` pass on the dev app at the end. Switch back and forth between two agents that each have changed
  files and a session with spend. Check frame by frame that Files changed, the branch line, the Session line (spend,
  model label) and the cache countdown do not flash on a switch back.
