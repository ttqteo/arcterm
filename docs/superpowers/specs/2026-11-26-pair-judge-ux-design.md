# Pair judge UX: one answer per question, a summary at each pause, Resume, and a judge name of its own

Date: 2026-11-26. Brainstorm: `.superpowers/brainstorm/pair-judge-ux/brainstorm.json`.
Builds on `docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md` (the pair) and the Chat choice judge
(`pkg/chatjudge`, `frontend/app/view/agents/chatjudge*.ts*`).

## Why

There has been one real pair so far: `df763872` (mit-thesis, 2026-11-25), 16 messages. It stopped at the token cap
(3.0M): the worker spent 1.09M, the judge (Opus) 2.4M.

- **What worked.** In m1–m7 the judge checked `PREREG.md:55`, caught a structural mistake about leg 3, and the worker
  owned it. The pair then paused on "no new points". The person likes this back-and-forth as it is: "nó trả lời qua về
  như hiện tại tôi thấy ok … kiểu judge kĩ".
- **The person's question was answered twice.** m8 and m12 went to both sides. The worker and the judge each wrote a
  long answer in parallel (m9/m10, m13/m14), and the judge never saw the worker's answer: it answered the person
  instead of judging the worker. m10's "no new points" then paused the pair.
- **Nobody summed up.** From m3 on, every worker message carried a full `arc-pair` block. By m16 it held 12 items:
  7 agreed, 1 open, 4 waiting on the person (A5, A8, A10, A12). The 4 waiting items were never answered. They live in
  the rail's Decided tab, and the timeline shows only a "Paused: …" line.
- **A stopped pair has nothing to press.** On the Library page of a pair stopped at the cap, and on the pair's row in
  the Agent tree, the person looked for a way to resume and found none ("không resume được à?").
- **Two "judge" features look alike.** "Add judge" (a paired Opus agent costing millions of tokens) and Chat's
  "Judge kỹ" (one sonnet run, 10–180 s) share the word "judge" and the ⚖ icon, side by side. Chat's button was pressed
  1 time in 32 choice questions.

## What runs today

- A message from the person with no `@` is `ToBoth` and is queued for every member at once
  (`pkg/agentpair/manager.go:459` appendPerson, `recipients` :502-516). `callsFor` (:531-534) makes a person's message
  call for an answer on both sides. `deliver` (:805) sends a whole queue as one prompt once the agent is at rest.
  `composerTarget` (`frontend/app/view/agents/pairmodel.ts:103`) reads `@worker` / `@judge` / `@<judge short id>`.
- Pauses are written by `addSystem` as "Paused: …" lines (`manager.go:776-782`). The Decided list is computed from the
  worker blocks in `pkg/agentpair/view.go`.
- `resume` (`manager.go:476`) puts a stopped pair back to relaying, and after a token cap it counts the cap again from
  that moment. Only a message from the person calls it today (`appendPerson` :466), including Run now
  (`hold.go:65`).
- The Library pair page (`pairreadpane.tsx`) is read-only and has no buttons. The pair row in the Agent tree
  (`agenttree.tsx:731`) has no context menu. Unpair (`PairUnpairCommand`, `wshrpctypes_pair.go:19`) exists only on the
  conversation's top bar (`pairpane.tsx`).
- `JudgeBrief` (`pkg/agentpair/brief.go:24`) explains `no new points`, but does not ask the judge for a summary.
- Chat's judge: the action label is in `chatjudgeline.tsx:43-44` ("Judge kỹ" / "Judge it"), the done head in
  `chatjudge.ts:185` ("Judge chọn" / "Judge picks"), the ⚖ icon in `chatjudgeline.tsx:399` and on the judged chip
  (`chatcomposer.tsx:1635`, `judge: Scale`), and the key in `docs/keyboard-shortcuts.md:429`.

## Decisions

### Scope (answer 1, then answers 7–9)

This round covers four things:
- **D**: Chat's button gets a new name.
- **A**: a message sent to both is not answered twice.
- **A summary** at each pause.
- **E**: a Resume button for a stopped pair.

Out of scope:
- B: the judge's token cost and the cap rule.
- C: heavy commands stay held after a stop, because `Owed` ignores the stopped state.
- End, Delete from Library and Close the whole pair. The person did not pick these in answer 9.

### The pair keeps "judge"; Chat's button is renamed (answers 2, 4, 10)

The pair keeps the word judge and the ⚖ icon everywhere: Add judge, "Paired with judge …", `@judge`, the tree, the
Library chip. Nothing about the pair is renamed.

Chat's Judge kỹ works as before, but it gets a new name and loses ⚖:
- the action: VI "Đọc code rồi chọn", EN "Read the code and pick";
- the done head: VI "Đã đọc code: chọn", EN "Read the code: picks";
- the icon: a magnifier from lucide, in place of `Scale`, everywhere on Chat's judge line and its judged chip.

The internals keep their names: `pkg/chatjudge`, `chat-judge` in logs, the `ChatJudge*` types.

### Keep the back-and-forth (answer 7)

Worker and judge keep replying to each other as they do today. The change is that someone sums the pair up.

### A message to both: the judge waits for the worker (answer 5, the brainstorm judge's pick)

A message from the person with no `@` still goes into both queues. On the judge's side it is only context: it does not
call the judge to answer while the worker has not yet answered it. Once the worker answers, the judge gets the
person's message and the worker's answer in one prompt, and judges that answer.

`@judge` (or `@<judge id>`) still calls the judge at once. The composer placeholder says what happens to a message to
both.

### A summary at each pause (answer 8, the brainstorm judge's pick)

Each time the pair pauses, whatever the reason (no new points, both agree, token cap, judges gone), arcterm puts a card
into the timeline. It is built from the Decided list at that moment, in this order:
- the items waiting on the person, with their answer chips, which answer through the existing A-item path
  (`Message.Item`);
- the items still open;
- the agreed items.

The same card shows on the Library page.

`JudgeBrief` also tells the judge: when it writes `no new points`, it first writes a few sentences that sum the pair
up for the person, in the person's language, before the `arc-judge` block.

**Agent's call (builder question 4).** The judge writes its summary as a `summary: <a few sentences>` line inside the
`arc-judge` block, next to `no new points`, so arcterm can read it like the other marks. The display strips the line
from the judge's message, as it strips the block. The pause card replaces the `addSystem` "Paused: …" line: it is one
new timeline entry whose head says why the pair paused. When the judge wrote a summary line in the reply that caused
the pause, the summary sits at the top of the card, above the items. Pauses with no judge prose (token cap, judges
gone) have no summary. The card keeps a snapshot of the Decided list and the judge's summary on the pause message, so
the Library page draws the same card from the file.

**Agent's call (builder question 3).** The card's answer chips work only in the pair conversation on the Agent
surface. The Library page draws them as read-only text for every pair (ended, synced, live), and stays read-only
otherwise. Its controls are Resume and Judge again (below), on a stopped pair of this machine.

### Resume (answer 9)

A stopped pair has a Resume button in three places:
- on the pause card;
- on the pair's row in the Agent tree;
- on the pair's Library page.

Pressing it puts the pair back to relaying and delivers what is still queued (in the real pair: m13 and m16 for the
judge, m14 for the worker; after "Turns after a pause" below, a worker turn after a token cap is no longer queued, so a
new pair holds only m13 there). It sends no message. After a token cap the cap counts again from that moment, and the
button says so: "Resume · 3.0M more" (VI "Chạy tiếp · thêm 3.0M").

Resume does not show on an ended pair, or on a pair synced from the other machine: that pair's agents are not on this
machine.

**Resume shows only when something would be delivered (builder question 1).** After a no-new-points or both-agree
pause the queues are empty (`stop()`, `manager.go:772-793`), so resuming would leave the pair "relaying" while nobody
works. The pair view gets a flag that says whether resuming would deliver anything: some member's queue still calls
for an answer (`callsForAnswer`, judged as if the pair were relaying). Resume shows on the card, the tree row and the
Library page only when that flag is set, which in practice is after a token cap. Otherwise the pause card says
"Nhắn để bàn tiếp" / "Message to go on", because a message from the person already resumes the pair.

**Judge again (answer 11).** On a pause with nothing to deliver (no new points, both agree), the card also has a
"Judge tiếp" / "Judge again" button. It focuses the pair's composer with `@judge ` already typed, so the person writes
what the judge should look at and sends it. The existing `@judge` path then calls the judge at once and resumes the
pair. The tree row and the Library page offer the same button only on a stopped pair of this machine: it opens the
pair's conversation on the Agent surface, then does the same. It needs no new RPC. It is not offered on a "no judge is
left" pause.

**Agent's call (builder question 2).** Resume does not show on a "no judge is left" pause either: resuming would stop
the pair again at once (`manager.go:745-747`). That pause's card says that no judge is left and that Add judge in the
header pairs one again (`Start` takes up a judges-gone pair, `manager.go:365`). The card has no button for it.

### Turns after a pause (the person's call, added 2026-11-26 after approval)

In pair df763872, after m15 "Paused: token cap reached (3.0M)", m16 and m17 are worker turns the person started in the
worker's own Chat on other topics. Both are stored with `replyto=m12`, so the conversation draws them under the quote
of the person's m12 as if they answered it, and the judge's queue became m13, m16, m17: Resume would hand the judge two
off-topic turns without the questions behind them. The header said "waiting on judge" the whole time the pair was
stopped. Causes: `takeAnswer` (`manager.go:670-704`) records and enqueues every new worker answer with
`ReplyTo: answeredBy(p, tab)`; `answeredBy` (`manager.go:560`) takes the newest message relayed to the tab that called
for an answer even when that tab already answered it; `waitingOnJudge` (`pairmodel.ts:138`) ignores the stop.

The documented rules stay: a new worker answer resumes every kind of stop except the token cap
(`docs/guide/agent-pair.md`, "Chạy tiếp"), and every worker turn goes to the judge, Chat-started ones included. The fix:

1. **No false quote.** A reply from a tab never quotes a message that tab has already answered: `answeredBy` skips a
   message when an earlier message from the same tab already has it as `ReplyTo`. m16 and m17 would carry no `ReplyTo`
   and draw no quote line; the quote fallback (`view.go`, the first line of the answered message) draws nothing when
   `ReplyTo` is empty.
2. **After a token-cap stop the pair stops following the worker, but keeps the reply that was under way.** While
   `State == StateStopped && StopReason == StopTokenCap`:
   - A worker answer for which `answeredBy(p, tab)` (with item 1's rule) names a message is a reply that was already
     under way when the cap stopped the pair. It is recorded with that `ReplyTo`, takes `p.Held` as any recorded worker
     message does, and is enqueued as usual, but it does not resume the pair.
   - A worker answer for which `answeredBy` returns "" (nothing left to answer: the turns the person started in the
     worker's own Chat, m16 and m17 of df763872) is neither recorded nor enqueued, and leaves `p.Held` alone; it still
     advances `Seen[tab]` (and persists it), so the turn is not taken later as new.

   The pair follows again once it resumes: Resume, Judge again, or a message from the person. Other stops keep today's
   rule: the worker's answer is recorded and resumes the pair. (Corrected 2026-11-26 after Task 3 landed, the person's
   call: in pair e801794d the judge sent fixes at 10:59, the cap stopped the pair at 11:03 while the worker was still on
   that turn, and its full answer arrived after the stop; the first version, which recorded nothing after a token cap,
   would have lost it.)

   Known gap, not fixed here: in e801794d the worker's 11:03 turn was taken twice, first the text before a tool call
   ("Final residual + structure check:", recorded while the pair was still relaying, in the same catch-up that then
   stopped it at the cap), then the full answer. An idle status reached `TurnEnded` mid-turn. With items 1 and 2 the
   full answer then finds nothing left to answer and is dropped. The fix belongs to whatever fires the mid-turn idle,
   and is filed as an open issue.
3. **Header.** While the pair is stopped, the working agent's state line does not say "waiting on judge"
   (`waitingOnJudge` is false on a stopped pair). It says the pair is paused, with the reason, in the pause card's
   head words.

CHANGELOG `Fixed`: "A paired agent's replies after a pause no longer show under the last question you asked in the
pair, and after a token cap they no longer pile up for the judge." The guide's "Khi nào pair dừng" says that after a
token cap, turns started in the worker's Chat are not passed to the judge until you resume, while the worker's answer
to a message it was already working on is still kept and passed on.

## Left to the builder

- **The waiting rule.** The judge's side of `callsFor`: a person's message (`To` both) does not call the judge while
  the worker owes an answer to it. If the worker is gone, the message calls the judge as it does today.
- **The pause card's data.** Either store a snapshot of the Decided list on the pause message, or draw the card from
  the newest `arc-pair` block when it is shown. The Library page must draw the same card.
- **The new RPC.** `PairResume` calls `resume` and then `deliverAll`. Then `task generate`.
- **Where Resume sits on the tree row.** A hover button, or a new context menu for the pair row (it has none).
- **Docs.** `docs/guide/agent-pair.md`: the sending rule, the pause card, Resume.
  `docs/keyboard-shortcuts.md:429`: the Alt+J label.
- **CHANGELOG lines.**
  - Changed: Chat's button name.
  - Changed: a message to both is answered by the worker first.
  - Added: the pause card.
  - Added: Resume.
- **CDP scenarios.**
  - `chat-judge`: the new name and icon.
  - `pair-conversation`: the pause card and Resume.
  - `library-pairs`: Resume on a stopped pair, none on a synced one.

## Builder decisions (2026-11-26, autonomous run)

Made by the run's lead with nobody at the cockpit; each with why.

- **The waiting rule.** On a judge's side, a person's message `To` both calls for an answer only once the working agent
  has answered it: the message is no longer in the worker's queue and a worker message comes after it. While it waits it
  stays in the judge's queue as context, so the worker's answer reaches the judge in the same prompt as the question.
  Gating the call is not enough: `buildPrompt` sends a whole queue, so when the judge's queue also holds a message that
  does call (a worker reply that came while it worked), a waiting person's message would go out early. `buildPrompt`
  therefore leaves a person's to-both message that does not call yet in the judge's queue (out of the prompt and out of
  the ids it removes); it goes with the worker's answer to it.
  A worker that is gone ends the pair, so there is no "worker gone" case left to handle. Why: it is the spec's rule, read
  off the two facts the pair already keeps (queue, message order), with no new state.
- **The judge's brief** also says: a message from the person that reaches you with the agent's answer is the agent's to
  answer; judge that answer, do not answer the person yourself. Why: m10 answered the person.
- **The summary mark.** `summary: <text>` on a line of its own inside the `arc-judge` fence, parsed into `Marks.Summary`
  (the last such line wins). `pkg/agentpair/blocks.go` and its mirror `frontend/app/view/agents/pairblocks.ts` gain the
  same pattern, as the mirror rule says. The card takes the summary of the newest judge message after the worker's newest
  message, whatever the pause's reason. Why: one place to read it, the one that caused the pause.
- **The pause card's data is a snapshot on the pause message.** `Message.Pause` (`wshrpc.PairPause{Reason, Summary,
  Decided}`) is written by `stop()` in place of the `addSystem` line, and its `Raw` keeps today's "Paused: …" text, so
  `wsh read`, old files and an old frontend still read a line. A pause message from before this change has no `Pause`
  and is drawn as the line it is today. Why: the Library page reads the file, and drawing from the newest block at view
  time would show a later list on an older pause.
- **Answer chips on the card** take the live answer from `view.decided.asks` by item number when the item is still in the
  live list, so a chip the person pressed shows as answered. Only the newest pause card of a stopped pair has controls
  (chips, Resume, Judge again); older cards and every card on the Library page are read-only text.
- **`PairView.canresume`** is computed by the server: the pair is stopped, not by `judges-gone`, and some member's queue
  calls for an answer. A synced pair reads `canresume: false` (`history.go`), and the frontend also gates on `!synced`.
  Why: one rule, in the place that knows the queues.
- **`PairResumeCommand(CommandPairGetData) error`** refuses a pair that is not stopped, a `judges-gone` stop and a pair
  with nothing to deliver, each with an error that says what to do instead; otherwise it calls `resume` and
  `deliverAll`. It adds no timeline line. It lives in `pkg/agentpair/resume.go`.
- **Language.** The pair's new words (card heads, section names, Resume, Judge again, the hint, the placeholder) are VI
  when the person's own messages in the pair read Vietnamese (`writesVietnamese`, `chatsuggest.ts`), else EN; a pair
  with no person message is EN. Why: the same rule Chat's judge line uses, on the pair's own text.
- **Card words.** Heads: "Paused: the judge has no new points" / "Tạm dừng: judge không còn ý mới"; "Paused: both agree"
  / "Tạm dừng: hai bên đã thống nhất"; "Paused: token cap reached (3.0M)" / "Tạm dừng: chạm trần token (3.0M)"; "Paused:
  no judge is left" / "Tạm dừng: không còn judge", with "Add judge in the header pairs one again" / "Bấm Add judge ở đầu
  trang để thêm judge". Sections, in the spec's order, each shown only when it has items: "Waits on you" / "Chờ bạn",
  "Still open" / "Còn mở", "Agreed" / "Đã thống nhất".
- **Placeholder.** "To both: the worker answers, then the judge judges it · @judge to ask the judge now" / "Gửi cả hai:
  worker trả lời trước, judge chấm câu trả lời · @judge để hỏi judge ngay".
- **Judge again** is offered on a stopped pair of this machine whose stop is `no-new-points` or `settled`. It writes
  `@judge ` into a per-pair composer draft atom (`pairstore.ts`) that the composer takes once and focuses, caret at the
  end. From the tree row it opens the conversation first (`pairopen.ts`); from Library it opens the pair through the
  router (`openref.ts`, which puts a live-list pair on the Agent surface). Why: one mechanism for all three places, no RPC.
- **The tree row** gets hover/focus buttons (Resume, Judge again) on the row's first line, not a context menu: the row
  has none, and one button is faster to find than a menu nobody knows is there.
- **Errors.** A failed Resume shows where it was pressed: the conversation's error line, a line under the Library
  header, the tree button's tooltip and an `aria-live` text; each also `console.error`s.
- **CHANGELOG.** The pause card and Resume are `Added` lines but not `<!-- big -->`: they are part of the pair feature,
  shown on their own when a pair pauses, not a new thing to open, and a big line would need a What's new picture the
  run's checks cannot make before its Verify.
- **The header's pause words.** `pairpause.ts` exports `pauseHead(reason, vietnamese, cap?)`, the one source of the
  card's head words, and the card uses it. The header's state line calls it in English (the header's state words are
  English everywhere) with the reason from `PairInfo.stopreason`; `PairInfo` carries no cap, so the token-cap head
  there drops the number ("Paused: token cap reached"). It shows where "waiting on judge" would: the working agent of
  a stopped pair, idle. Why: same words as the card, no new wire field.
- **Turns after a token cap** land in Task 3 (it already owns `manager.go`'s waiting rule and `answeredBy` check), the
  header in Task 6 (it owns `pairmodel.ts`, after Task 5's words), the CHANGELOG and guide lines in Task 8: no new
  task. `TestManagerResumeNotByAWorkerReplyAfterTheTokenCap` changes with it: the worker's reply after the cap is no
  longer recorded, so the person's resume sends the judge their message once the worker answers it.
- **Whether real judges write the summary** is live-model behaviour no run can check: it is the dated chunk
  "Re-measure: does a real pair judge write a summary: line at no new points" (effort `176a52a5`, due 2026-12-10).
