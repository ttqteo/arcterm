# Unread turns read one by one in Chat

## Intent

Today the blue badge on an agent's sidebar row counts the turns the agent finished while you weren't looking, and it
drops to 0 the moment the agent comes into view. With this change, clicking an agent that has N unread turns opens
Chat at the oldest of those N turns. As you scroll down, the badge drops by 1 for each turn you finish reading, until it
reaches 0.

## Background (today)

- `frontend/app/view/agents/unreadagents.ts` `nextUnread`: each working → idle move of an agent that is not in
  `viewingIds` adds 1. An agent in `viewingIds` is dropped from the map, so its count goes to 0. `viewingIds` is
  empty while the window is unfocused. Outside that case it holds the focused agent on the Agent surface with the
  terminal centre, or every grid cell when the focused agent sits in the grid. Nested agents (a run's workers and stage
  sessions, a lead with a dag, brainstorm check/judge sessions), asking agents and agents whose launch failed never count.
- `unreadagentsstore.ts`: `unreadAgentsAtom` (id → count) lives in a module-level atom, and the always-mounted shell
  updates it (`useUnreadTracking`). It is not persisted, so a reload clears it. The nav badge, the sidebar rows
  (`agenttree.tsx`), the header, `float-ledge.tsx`, a keybinding and `doneSuggestion` all read it.
- Each agent shows Chat or Terminal, chosen per agent (`chatmodestore.ts`, `shownChatMode`).
- Chat (`chatconversation.tsx`) draws only its last items at first. It restores the place where the reader left off
  from `transcriptplace.ts` (the item at the top plus an offset); a transcript read to the end opens at the end.
  Items carry `data-chat-item`. `chatpane.tsx` owns the scroller (`useStickToBottom(entries, placeId)`, with
  `placeId = chat:<agent>:<path>`) and the ↓ Jump to latest pill (`data-chat-jump`).

## Decisions

### Where Chat opens, how the count drops

When you open an agent with N unread turns, Chat jumps to the start of the oldest of those N turns. Scrolling down, the
badge drops by 1 for each turn you finish reading, and it reaches 0 once you have read them all.

### When a turn counts as read

A turn counts as read when the last line of its reply enters Chat's viewport. A short turn that fits on one screen
counts at once; a long turn counts only once you scroll to its end.

### Terminal mode

When an agent in Terminal mode comes into view, its badge drops to 0 at once, as it does today. Only Chat mode counts
down turn by turn.

### What Chat shows

A horizontal rule labelled "N lượt mới" (N new turns) sits right above the first unread turn, where Chat jumps on open.
The ↓ Jump to latest pill stays as it is today and shows no count.

Agent's call (builder question 3): the label follows the conversation's language, as the chips do (`writesVietnamese`):
"N lượt mới", otherwise "N new turns".

### Edge cases

- A turn that ends while you are in Chat with its end out of view (you are scrolled up, reading) still adds 1, and the
  count drops again when you scroll to it. If you are at the bottom, the turn doesn't count, as today.
- While the arcterm window is unfocused, no turn counts as read, even if it is in view. This rule doesn't change.
- In a grid, each Chat cell counts down its own agent's turns.
- If the unread count is larger than the number of turns Chat has drawn, Chat draws back to the first unread turn, as
  it does when it restores a kept place.
- When there are unread turns, the jump to the first one wins over the kept reading place. With nothing unread, Chat
  opens as it does today.
- The "N lượt mới" rule keeps the count it had on open. It doesn't change as the badge drops, and it goes away when
  you leave the agent.
- Nothing is persisted across a reload, as today.
- While you are partway through, the count means the same thing everywhere (builder question 2). ✓ Close and the done
  row stay hidden (`doneSuggestion` checks for 0). The dock badge, the nav badge, float-ledge and the other readers keep
  showing the count until you have read it all. No reader of `unreadAgentsAtom` gets a different signal.

## Left to the builder

- Map the N unread turns onto Chat's last N turns. A turn starts at a message that set the agent working (a `you` item
  you typed or a `sent` item arcterm typed) and ends before the next one. Commands that start no turn (`/config`,
  `!` bash) are no boundary.
- Agent's call (builder question 1): a `notification` marker (a finished background task that woke the agent) is a
  turn boundary too. Wakes that leave no item (a scheduled wakeup, a hook continue) can still make N larger than the
  turns found. So N is clamped to the turns Chat finds, and any leftover goes to 0 once the last turn found is read.
- Measure "last line entered the viewport" with an IntersectionObserver or by reading rects once per frame on scroll,
  as transcriptplace already does.
- Put the logic in pure files with tests beside them (`unreadagents.ts` or a new file next to it). `nextUnread` must no
  longer zero an agent whose Chat is in view: Chat reports how many turns were read, and the count drops by that.
- Add a CDP scenario that opens an agent with unread turns, checks the jump and the rule, scrolls, and checks the badge
  counting down.
