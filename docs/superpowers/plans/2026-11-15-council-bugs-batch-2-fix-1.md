# Council bugs batch 2, fix round 1: council-discussion's ask-next steps follow the asks into the box

**Effort:** effort:67d1c761-ccae-4498-8c85-50d0ab9a65dd
**Verify:** `node scripts/verify.mjs ./pkg/council/...`
**Final:** `node scripts/cdp/final-verify.mjs council-setup council-discussion council-summary council-tree`

Round 1's Final passed 238 of 241 steps. The three that failed are all in `scripts/cdp/council/discussion.mjs`, and
none comes from this run: be805f75d (on `main`, 2026-11-14, before this run's base 36858e23f) moved a council's
questions to ask next, and a thread's suggested replies, out of the channel and into the message box as Chat's
suggested replies (`ComposerAsks`, `frontend/app/view/agents/councilchat.tsx:2878-2923`, drawn under the box's text at
~:2768-2778), and left the scenario reading the old places. The UI is the product's choice (its CHANGELOG line says so);
the scenario follows it. Failing details from Final:

- `done: Ask next offers the report's three questions as the list's last line, not over the box, …` →
  `{"asks":0,"last":false,"overBox":3,"filled":"","staysAfterFill":0}`
- `done: Ask next stays while the person types: …` → `{"typed":0,"second":"","replaced":"W","afterReplace":0}`
- `thread asks: the seat's two suggested replies stay over the thread's box while the person types one letter, …` →
  `{"before":[],"typed":[],"replaced":"W","after":[]}`

Principles: change only the scenario; the app's behaviour is right. Never run prettier on `scripts/*.mjs`.

### Task 1: council-discussion reads the asks where the box draws them

**Depends on:** none

**Files:** `scripts/cdp/council/discussion.mjs`

The markup now: the channel's row is `${CHANNEL_COMPOSER} [data-council-asks="channel"]`, a thread's
`${THREAD_COMPOSER} [data-council-asks="thread"]`, each chip a `button` with `data-council-ask="<index>"` (`Chip`,
`chatcomposer.tsx:1552`) whose label is the text a click puts in the box (`takeAsk`, `councilchat.tsx:2340-2343`,
replacing what the box holds). There is no `[data-council-thread-asks]` or `[data-council-thread-ask]` any more.

- [ ] **Step 1: The done fixture's Ask next steps** (`discussion.mjs` ~:1142-1193)
  Read the three questions from the channel composer's row instead of the channel. The step at ~:1175 becomes: the
  report's three questions sit in the channel's message box (3 chips in `${CHANNEL_COMPOSER} [data-council-asks="channel"]`)
  and none is in the channel's list (`[data-council-channel] [data-council-ask]` counts 0; drop the "list's last line"
  check, which no longer describes the UI), a click on chip 0 fills the box with `@RAM How much RAM…`, and the three
  chips are still there after the fill. Reword its label to say that. The step at ~:1190 keeps its meaning (one letter
  typed, all three chips still there, a click on chip 1 puts its text in place of the letter) with the selectors moved
  into the composer; reword "the list" if its label says so. Keep the undo / redo step between them as it is, reading
  the same fill.

- [ ] **Step 2: The thread's suggested replies** (`threadAsksTyping`, ~:3373-3415)
  Wait for and read `${THREAD_COMPOSER} [data-council-asks="thread"] [data-council-ask]` (in P2's thread), click
  `${THREAD_COMPOSER} [data-council-ask="1"]`. The label's "stay over the thread's box" becomes "stay in the thread's
  box". Same assertions otherwise.

- [ ] **Step 3: Run it**
  Run the scenario against a dev app as AGENTS.md "Visual verification (dev)" describes (or
  `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs council-discussion`), and look at
  `council-discussion-asknext.png`, `council-discussion-asknext-typing.png` and
  `council-discussion-threadasks-typing.png`: the chips sit in the box under its text. Every council-discussion step
  passes. If the live run cannot run, say so in the report.

- [ ] **Step 4: Commit**
  Commit: `test(council): council-discussion reads the questions to ask next in the message box`
