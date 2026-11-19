# Chat: a commit suggestion card

Date: 2026-11-17. From the brainstorm `.superpowers/brainstorm/chat-commit-card/brainstorm.json`.

## Intent

When an agent suggests a commit and waits for the person's approval, Chat shows a card with the files and the
commit message. Both can be edited in place, and a Commit button commits them.

## Today

- An agent that must ask before committing (a repo whose rules want the person to approve, such as SIEM) writes
  the suggestion as prose: a code block holding the message, a list of files, then "commit?". The person answers in
  text, and editing the message means retyping it.
- Chat already turns one agent-written block into a card: an ```` ```arc-review ```` block
  (`frontend/app/view/agents/chatverdict.ts` parses it, `chatmodel.ts` cuts it out of the reply,
  `chatverdictcard.tsx` draws it, `skills/handoff/SKILL.md` teaches agents to write it).
- The verdict card's Fix and Skip buttons do not act themselves. They send one line to the agent
  (`chatverdictsend.ts` `sendVerdict`, through `brainstormsend.ts`), keep a send record (`chatbrainstormstore.ts`
  `recordBrainstormAnswer`) and fold into a ✓ row; the user message the line causes draws nothing.
- A line with a line break is pasted, bracketed when the program asked for it (`agentsubmit.ts`), so a multi-line
  line reaches the agent intact. The Fix line is multi-line today.
- The ✓ Close suggestion's "Committed in its last turn" (`donesuggest.ts`) comes from the agent's own Bash
  `git commit` in the transcript (`pkg/agentsessions/agentsessions.go`, `commitRe`). A commit made from the UI
  would not set it.
- `GitCommitCommand` (`pkg/wshrpc/wshrpctypes_git.go`) and the Diff surface's Commit tab (`commitstore.ts`) commit
  from the UI. They are the person's own tool and are not used here.

## Decisions

### The agent commits; the card is a structured reply

The agent writes an ```` ```arc-commit ```` block (message and files). Chat draws it as an editable card. The Commit
button sends the agent one line holding exactly the message and the files the person left, and the agent runs
`git commit` in its own turn.

This is how every agent-written Chat card works: a button sends a line, and the agent acts. Because of that, the
transcript records the commit, ✓ Close still lights, and the agent keeps the conventions it already follows
(pathspec commits, no `Co-Authored-By`, each repo's message format). The cost is one short extra agent turn.

### When the agent writes the block

Only when the agent was about to stop and ask the person before committing. The block replaces today's prose
suggestion. In a repo whose rules let the agent commit on its own (arcterm), it keeps committing on its own and no
card appears.

### The card

- A multi-line message box, prefilled from the block.
- The file list, each with a tick, all ticked to start. Unticking every file disables Commit.
- One button, Commit. No Skip: to decline, the person types a reply as today.
- Commit sends the line below, keeps a send record under the verdict's shared store, and folds the card into a ✓ row
  ("Commit sent · 2 files"). It does not wait for the commit hash.
- A reopened or re-rendered conversation shows the ✓ row for a card already sent, and never sends twice.
- **Lifecycle** (Agent's call, builder question 1): the card copies the verdict card's modes (`chatverdict.ts`
  `verdictMode`), so it can be pressed only while it still answers the agent's open question:
  - with a send record: folded, "Commit suggestion · 2 files — Commit sent";
  - not the last part of the conversation: folded, with the tail "— You replied" when the person's message follows
    it, and no tail when the agent wrote on (it committed on its own or changed course);
  - the last part of an agent that exited, or of an ended session: static (no ticks, no button);
  - the last part while the agent works: `working` (no ticks, no button);
  - otherwise `waiting`: editable, with Commit.

  So a card the person declined in words, or that the agent moved past, can never send a stale commit later.
- Edits survive the card being unmounted and drawn again (scrolling out and back, switching agents) until it is sent:
  keep the draft per card key outside the component.

## Left to the builder (confirmed)

- **Skill.** A new skill `skills/commit/SKILL.md` (`arc:commit`), shaped like `skills/steps/SKILL.md` and scoped
  the same way ("in a Claude Code agent inside arcterm"). It tells the agent:
  - Write the block only where it would otherwise stop to ask before committing, then end the turn.
  - Use the block format below. List only the files meant for this commit, with paths relative to the agent's
    working directory.
  - On the Commit line, commit exactly the message and files given, unchanged: write the message to a temp file and
    run `git commit -F <file> -- <paths>`, with no amend, staging nothing else, and following the repo's other
    commit rules. Then report the hash in one line.
  - **Precedence** (Agent's call, builder question 2): the repo's rules decide whether to ask and what the message
    says (its format, its ticket prefix). The block only replaces how the question is shown: the message inside
    follows the repo's format, and the block takes the place of the repo's prose ask.
- **Reminder from the arc mod** (your answer to builder question 2). A skill reaches an agent only through its
  description. At the moment the block is needed, the agent is following the repo's rules and is not looking for an
  arcterm skill. So the arc mod adds a short context line to each interactive prompt: "If you are about to ask before
  committing, write an arc-commit block instead (arc:commit)". This works the way the skim mod adds its Highlighting
  line: `submitContext` in `claude/skim-mod/hooks/highlight-core.ts` sends the full text the first time and a short
  reminder after that, and skips commands and composed prompts. Put the pure logic in
  `claude/arc-mod/hooks/*-core.ts` with a vitest test, and append the line in the arc mod's existing `prompt.submit`
  handler (`claude/arc-mod/hooks/register.ts`). Failing to add the line must never hold the prompt (`passOn`). Check
  it with `claude plugin validate claude/arc-mod` and `task check:ts`.
- **Block format** (Agent's call). The message comes first, verbatim and possibly multi-line, then a line that is
  exactly `---`, then one path per line:

  ````
  ```arc-commit
  [SIEM-1746][ingest] Drop lagging partitions before rebalance

  Rebalance waited on partitions that had already fallen behind.
  ---
  services/ingest/rebalance.go
  services/ingest/rebalance_test.go
  ```
  ````

  A block with no `---`, an empty message or no files does not parse, and draws as code, as a broken `arc-review`
  block does. A leading `- ` on a path line is tolerated and stripped.
- **Pure model** `frontend/app/view/agents/chatcommit.ts` with `chatcommit.test.ts`:
  - parse the block;
  - cut parsed fences out of a reply into their own part, the way `chatverdict.ts` / `chatmodel.ts` handle
    `arc-review` (including the live-text handling in `chatlive.ts`);
  - build the Commit line from the edited message and the ticked files;
  - define the send record and the ✓ row text.
- **Send** through the same path as `sendVerdict` (a sleeping agent is woken with the line; a failure throws with
  the agent's name and leaves the card unsent).
- **The Commit line** (Agent's call). It names the instruction, then the message in a fence, then the files:

  ````
  Commit exactly these files with exactly this message, unchanged:

  ```
  <message>
  ```

  - <path>
  - <path>
  ````

- **View** `chatcommitcard.tsx`, styled after `chatverdictcard.tsx` and following `DESIGN.md` (tokens only).
- **Verify.** Add a CDP scenario `chat-commit` that seeds a reply holding an `arc-commit` block. It shows the card,
  edits the message, unticks a file, presses Commit, and checks that the sent line holds the edit and the remaining
  file and that the card folds into its ✓ row.
- **CHANGELOG.** One `Added` line: agents that ask before committing show an editable commit card in Chat.

## Out of scope

- Committing from the card itself (`GitCommitCommand`). That is the Diff Commit tab's job.
- Listing files the agent did not name, which would need git status. The Diff Commit tab covers that.
- Reading the commit hash back into the card.
- Agents whose Chat is not drawn (the card is Chat-only; the skill is scoped to Claude Code agents, like `arc:steps`).
