# Permission prompts on the sidebar row

Status: design, 2026-11-27. Brainstorm: `.superpowers/brainstorm/sidebar-permission-row/brainstorm.json`.
Prototype: `.superpowers/design/sidebar-permission-row/project/A-third-line.dc.html`.

## Intent

When an agent shows a permission prompt (Allow / Deny, such as "Wants to start a subagent"), its sidebar row says what
the agent is asking for and lets the person answer it there, without picking the agent or opening its chat. Today the
row only reads "asking" in amber (`askingLabel`, `agentsviewmodel.ts:1178`) and the only place to answer is the chat's
`PermissionCard`.

## What exists

- The sidebar's agent row is `ParentRow` (`frontend/app/view/agents/agenttree.tsx:1316`). An asking row breathes amber
  (`.asking-tint`), and its second line starts with `askNote` (the word "asking") with the columns (tokens, age, RAM)
  and the badges at the right.
- The permission queue per agent block is `usePermission(oref)` in `permissionstore.ts`. It loads lazily on first read
  and updates from the `agent:permission` event. Today only `PermissionCard`, `ScreenDialogCard` and `chatcomposer`
  read it.
- `answerPermission(oref, id, answer)` sends Allow (types `1`), the second choice, or Deny (Esc). wavesrv refuses a
  request that is no longer the head of the queue, `permissionInFlightAtom` locks a request's buttons while its answer
  is in flight, and a refused answer becomes the agent's refusal line (`permissionRefusalAtom`).
- `permissionmodel.ts` already has `permissionTitle`, `permissionSummaryLine`, `cardHead`, `cardShown`, `waitingFor`,
  `moreWaiting` and `choiceAnswer`.
- Keyboard: a row's Alt+1..9 digit focuses the agent, and with an empty chat box ↑ ↓ Enter answer the card
  (`permissionBoxKey`). So the keyboard path already exists. This design adds the mouse path.
- Run workers start with `--dangerously-skip-permissions` (`pkg/jarvis/runexec.go:66`), so they never raise a prompt.

## Design

### Line 2: what it asks

While the agent's queue has a head the row can answer (answerable or ScreenPick, below), the row's `askNote` reads what the head asks instead of
"asking", truncated, in the warning color it uses today, with the columns kept at the right:

- `subagent · Update board CDP scenarios` (Agent / Task: the summary is the subagent's description)
- `$ task check:ts && npx vitest run …` for Bash, in mono
- `edit <file>`, `write <file>`, `fetch <url>`, `search <query>`, `artifact · <summary>`
- any other tool: `<ToolName> · <summary>`

The short label is a new pure function in `permissionmodel.ts`, with tests beside it. Its `title` attribute holds the
full summary line.

### Line 3: the buttons, always shown

An asking row with a pending prompt grows a third line. It is always there while the prompt waits, with no hover
needed:

- `Allow` (primary, accent) and `Deny` (secondary). They are 22 px tall, the size the prototype draws.
- At the right, in muted text: `+N more · waiting 1m` (`moreWaiting`, `waitingFor`, against the tree's `model.nowAtom`).
  `+N more` is left out when nothing waits behind the head.
- While an answer is in flight, both buttons are disabled (`usePermissionRequestState`). A refused answer shows the
  agent's refusal line in place of the waiting text, in the error color. It is the same line the chat card shows, and it
  clears by the same rule.

Only Allow and Deny. The prompt's second choice ("Yes, and don't ask again…") stays on the chat card.

### Prompts the row cannot allow

The row checks the head (`requests[0]`) in this order. **Agent's call** (builder question 3).

1. The head is an AskUserQuestion. That is a question, not a permission, so the row stays as it is today (`asking`, no
   third line). The check is on `toolname`, whether or not the chat draws the question's choices. It does not use
   `cardHead`'s `askShown`. **Agent's call** (builder question 2).
2. The head is a ScreenPick request (`screenpick === true`, Artifact; wavesrv marks these `answerable: false`). Allow
   reads the dialog's Yes off the terminal at the click, as the card does (`choiceAnswer(..., screen=true)`). When the
   Yes is not on screen, the refusal line says so and nothing is typed.
3. The head is answerable: Allow and Deny.
4. Anything else (plan approval, an MCP tool…). Line 3 is `Answer in chat ↗`, which opens the agent's chat through the
   router (`openref.ts`) or `selectAgentRow`. Line 2 gives only a short name, never the tool's input as JSON:
   `ExitPlanMode` reads `plan approval`, and any other tool reads its tool name. **Agent's call** (builder question 3).

Also:

- `cardShown(agent)` is false (the agent is asleep or idle while a stale queue remains). Nothing is shown, the same rule
  the card follows.
- **Refusal line** (**Agent's call**, builder question 1). Line 3 is tied to "has a head or a refusal", as on the card
  (`shown = (head != null || error != null) && cardShown(agent)`). wavesrv refuses only a request that has already left
  the head, so after a refusal line 3 can stay with only the error line. It goes when `refusalClears` drops the error (at
  most `REFUSAL_MS`, 8 s), and leaves with the reveal motion.
- **Other asks on the same row** (**Agent's call**, builder question 4). While the row shows a held card (Token burn, an
  Antigravity question), a doc review, or a brainstorm's ask, that ask keeps line 2 and the row shows no Allow. Allow
  must never let a spawn go ahead while the Token burn gate is still asking about it. The gate runs as a PreToolUse hook
  before Claude puts up its prompt, so the two rarely overlap. This rule is a guard for the case where they do.

### Which rows

Agent rows in the sidebar: `ParentRow`, including a lead's row (whose second line is `RunSubline`'s `note`). Worker
rows need nothing because workers are never asked. A row keeps its third line even when that agent's chat is open
beside it. Hiding the line there would change the row's height on every agent switch.

## Left to the builder

- Each `ParentRow` reads `usePermission(\`block:${agent.blockId}\`)`. The head is `requests[0]`, checked in the order
  under "Prompts the row cannot allow". The queue loads lazily, so only a rendered row loads one.
- The buttons call `answerPermission(oref, head.id, choiceAnswer(choice, head.screenpick === true))`. Their clicks call
  `stopPropagation` (and `onMouseDown` too where the row uses it) so they never select or drag the row.
- Rows re-sort with a popLayout animation when states change. While a row is moving, its buttons take no click, so a
  click aimed at one agent's Allow cannot land on another's.
- The third line enters and leaves with the tree's existing reveal motion (`composerReveal`), not a jump.
- Colors come from `@theme` tokens (`bg-accent`, `border-edge-mid`, `bg-surface-raised`, `text-warning`, `text-error`,
  `text-muted`). There is no raw hex.
- Tests: a pure label function in `permissionmodel.test.ts`. A CDP scenario sets a fixture queue with
  `window.__arcAgentPermission.set` and shows the row at rest, an unanswerable head (Answer in chat), and a refusal line.
- `CHANGELOG.md`: one `Added` line ("Answer an agent's permission prompt from its sidebar row").
