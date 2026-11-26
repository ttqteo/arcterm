# Pair judge as a round on the worker: the worker stays the main agent

Date: 2026-11-26. Brainstorm: `.superpowers/brainstorm/pair-judge-round/brainstorm.json`.
Prototype: `.superpowers/design/pair-judge-round/project/D-line-inside-worker.dc.html`.
Builds on `docs/superpowers/specs/2026-11-26-pair-judge-ux-design.md` (run 247706be: the pause card, Resume, Judge
again). **Run this after 247706be lands:** it changes the tree row that run puts Resume on.

## Why

The person uses a pair as one review round. They ask the judge to check the worker's last answer, the two go back and
forth until the judge has no new points, and then the person carries on in the worker's own Chat. In their words: "judge
xong thì kết thúc phiên … và vẫn tiếp tục ở agent worker", while the tree "mang cảm giác gộp 2 cái cùng cấp, trong khi
agent-worker as main".

The judge's work is good as it is: in pair `e801794d` it read the json files, caught three errors that changed the
paper's meaning, and the worker checked each one against the data before taking it. This spec does not change the
back-and-forth.

## What runs today

- **Tree.** `buildAgentTree` (`frontend/app/view/agents/agenttreemodel.ts:583-826`) puts a `pair` row in the worker's
  place. The worker and its judges become `nested` rows with a `pairRole`, and they show only when the pair row is
  unfolded (`pairShown`, `:131`). A paired worker drops out of `ownRow` (`:656-657`), and the pair branch passes no
  `waitsFor` and makes no `pushStarted` call, so the runs the worker started lose their place nested under it.
  `PairTreeRow` (`agenttree.tsx:705-810`) draws the pair's title, its new-message badge, one dot and one word per side,
  and the RAM and tokens of the whole pair. A click opens the conversation (`openPairOf`).
- **A pair after a stop.** A stopped pair lives on until Unpair. Unpair (`pkg/agentpair/hold.go:117`) is only on the
  conversation's top bar, and it leaves the judge's tab open, where it shows up again as a plain agent row.
- **The worker's own Chat after a stop.** After any stop other than the token cap, each new worker turn goes to the
  judge and resumes the pair (`takeAnswer`, `pkg/agentpair/manager.go:670-704`). This includes turns the person starts
  in the worker's own Chat. So carrying on in the worker after "no new points" wakes the Opus judge.
- **Sleep.** An agent can sleep: its process stops, its session is kept, and a message wakes it (`a.sleeping`,
  `chatboxstate.ts`).

## Decisions

### The judge is a line inside the worker's row (answer 1)

The worker keeps its plain agent row, the same as when it has no judge. While a round lives, the row gets one more
small line that is always shown and never folds. The line holds:
- ⚖;
- the judge's state, in words;
- the judge's tokens;
- the new-message count.

A click on that line opens the worker ↔ judge conversation. A click anywhere else on the row opens the worker. The
conversation view and the rail's Decided tab are unchanged: only the way into them from the tree changes. The worker's
header keeps its Paired button.

### Going back to the worker ends the round (answer 2)

A round ends when the pair is stopped and the worker takes a new turn that did not come from the conversation
(builder question 1: any new worker turn). That covers a message typed in the worker's Chat or straight into its
terminal, and one sent with `wsh agents send` or Sidecar. Then:
- the ⚖ line leaves the worker's row;
- the pair is ended and goes to Library;
- the judge is not called again.

Some turns do not end the round:
- While the pair is relaying (not stopped), every worker turn still belongs to the round, as today. The person can add
  a judge the moment they doubt an answer, and the back-and-forth runs as it does now. Pair `fdd98705` is an example:
  the worker read only run 0 of each shard and got a conclusion backwards, and the judge caught it.
- An answer already under way to a message the judge sent before the stop is recorded in the pair and does not end the
  round.
- A command that makes no worker answer (`/compact`, `! cmd`, `/btw`) does not end the round.
- To go on, the person writes in the conversation, presses Resume or presses Judge again.

**Where it lives.** The rule is in the backend, in `takeAnswer` (`pkg/agentpair/manager.go:670-704`). Today a new
worker turn resumes a stopped pair. Instead, when the pair is stopped and the new turn owes no answer (`answeredBy` is
empty, after run 247706be's dedupe), `takeAnswer` calls Unpair and sets each judge to sleep once it is idle. This holds
for every kind of stop, the token cap included. It replaces the documented rule "a new worker answer resumes every
stop except the token cap" (`docs/guide/agent-pair.md`), and that guide changes with it.

### The judge sleeps and comes back next round (answer 3)

When the round ends, each judge is put to sleep and leaves the tree. Add judge on that worker offers the sleeping judge
first. Picking it wakes the judge and starts a new pair with it, so it keeps what it knew from the earlier rounds.

### The token cap counts only the judge (answer 4)

The pair keeps its 3M cap (`DefaultTokenCap`, `pkg/agentpair/pair.go:46`), but the cap counts only the judges' tokens.
The worker's tokens are still read and shown, and they do not count toward the cap.

Why: today the cap counts both sides (`settle`, `manager.go:732-750`), but most of the worker's tokens are work it would
do with no judge at all. In `e801794d` the worker spent 3.18M and the judge 0.70M. The cap stopped the round at 11:03,
just after the worker fixed the points the judge had reopened, so the judge never checked them one last time. In
`df763872` the split was worker 1.44M, judge 2.44M. `fdd98705` (worker 0.73M, judge 0.91M) stopped on its own at no
new points. Now that a round ends when the judge has no new points or the person goes back to the worker, the cap is
only a safety net for a judge that never runs out of points.

For the builder:
- `p.Tokens`, which the cap compares against, sums the judges only.
- The "x of 3.0M tokens" label (`document.go:42`), the pause card's head and "Chạy tiếp · thêm 3.0M" say these are
  the judge's tokens.
- Pairs already stored keep the numbers they saved.

## Left to the builder (confirmed by the person)

- **The ⚖ line by state.**
  - The pair is relaying: the judge's state.
  - The pair is stopped: the reason, in the pause card's head words.
  - The judge is asking you: the words say so, in the warning color, and a click opens the judge's own view.
  - On a stopped pair, the line ends with the same buttons the pause card has (builder question 2: keep both),
    from run 247706be's `pauseActions` (`pairpause.ts:125-138`), which move off the old pair row. These are Judge again
    after no new points or both agree, and Resume when something is left to deliver ("Chạy tiếp · thêm 3.0M" after a
    token cap). A relaying pair has no buttons on the line. That run's pair-tree CDP steps carry over to the line.
- **Several judges.** The line says "2 judge" and shows the state of the judge that needs you most: asking, then
  working, then stopped. Each judge stays readable in the conversation. The brainstorm's second judge preferred a
  separate judge row under the worker (option B) for this case. The person picked the line.
- **Ending the round.** The backend rule under "Going back to the worker ends the round" ends it, wherever the worker's
  turn was typed.
- **Waking.** When the worker has a judge asleep from an earlier round, the first entry of Add judge invites that
  judge.
- **Tree.** Remove `PairTreeRow` and the pair branch of `buildAgentTree`. The worker goes back to a plain row (`ownRow`,
  its nested runs, `waitsFor`). Judges have no rows of their own.
- **Library.** An ended pair stays under the worker's session, as today.
- **Agent's call (builder question 2): who sleeps.** Only a judge the pair launched for the job sleeps and leaves the
  tree. That is a `Judge: <worker>` tab started by Add judge. The pair records which judges it launched, in a new flag
  on `Side` beside `Briefed`. An agent the person picked from the live list (`pickJudge`, `pairlaunch.ts:178`) goes back
  to the tree as a plain agent, as Unpair leaves it today.
  - A launched judge is hidden while it is asleep and its newest pair has ended. Today the tree lists asleep agents
    (`agenttreemodel.ts:927-942`), so the rule is derived from ended pairs and needs no new meta key.
  - If anything wakes the judge (a send, Sidecar), it shows again as a plain agent.
  - Closing the worker's tab also closes the worker's sleeping judges, so no hidden judge is left behind.
- **Agent's call (builder question 4): a judge that cannot sleep yet.** The pair ends at once.
  - Each judge sleeps the next time it goes idle, deferred like `AgentsSleepAfterRun`.
  - A judge that is asking the person stays on the tree until it is answered and goes idle.
  - A round-end sleep skips compaction (`CommandAgentsSleepRtnData.Compacting`), so the judge keeps what it knew for
    the next round.
- **Docs, CHANGELOG, CDP.**
  - `docs/guide/agent-pair.md`: the round, how it ends, and the sleeping judge.
  - CHANGELOG `Changed`: one line.
  - The pair-tree CDP scenario: the ⚖ line, live and stopped, and the worker's row after the round ends.

## Decisions made while planning (autonomous run, 2026-11-26)

Nobody was at the cockpit when this was planned. The calls below fill what the spec left open; each says why.

- **Who is resting lives in the backend.** A launched judge whose newest pair has ended is "resting". The Manager
  builds that index once, at its first load, from every pair file (not only the active ones), and keeps it up to date
  as pairs end or a judge joins a new pair. It goes out as `Resting` on `PairListCommand` (`[]PairResting{tab, name,
  workertab, pairid}`). Why: the tree, Add judge and the close path all need it. If the frontend worked it out from
  `PairHistoryCommand`, every list would read every pair file, and there would be two answers to one question.
- **Sleep at the round's end.** A new `Link.Sleep(ctx, tab)` puts the agent to sleep at once, with no compaction
  (wavesrv: `sleepRefusal` then `sleepAgent(ctx, row, false)`). When the round ends, each launched judge that is idle
  sleeps at once, and a judge that is asleep is left alone. A judge that is working or asking goes into an in-memory
  set, and its next idle puts it to sleep: `notePairStatus` passes the idle on to the Manager for a judge in that set
  as well as for a paired tab. A wavesrv restart drops the set, as it drops `AgentsSleepAfterRun`'s entries, and the
  30-minute idle rule covers that judge. The sleep runs even when auto-sleep is off in settings, because it is part of
  the round, as a person's own Sleep is. A refusal (background work) is logged, and the judge stays awake and shows as
  a plain agent.
- **The ended pair says why.** The round's end adds the system line "Round ended: you went back to the working agent",
  so the pair in Library reads why it ended. The working agent is told about held commands it may now run in the
  same way Unpair tells it (one shared helper).
- **Waking a resting judge** is `PairStart` with `briefed: false, launched: true`. The brief goes out as its first
  prompt, and the send wakes it. The new pair records it as launched, so it rests again after this round.
- **A resting judge is hidden only while its worker is on the roster.** A judge that is resting and asleep leaves the
  tree only while its `workertab` is on the roster. If the worker's tab is gone (closed outside the cockpit's close
  path, say), the judge stays as a plain row, so nobody is left hidden and unreachable.
- **Only pairs saved after this change say "judge tokens".** A new `Pair.JudgeTokens` flag marks a pair whose `Tokens`
  counts the judges only. A new pair sets it, and so does an active pair the first time `settle` recounts it. The
  Library document says "judge tokens" only for a pair with the flag. An older ended pair's saved count includes the
  worker, so it keeps "tokens". The frontend's pause card works its head out from the stop reason, so an older pair's
  token-cap card also reads "judge token cap". That is accepted: it only affects ended pairs from before this change.
- **A judge has no row of its own only while its worker's row carries the ⚖ line.** If the worker has no plain row
  (it is a run's worker, say), the judge stays a plain row. That way no judge can become unreachable.
- **The line's tokens are `PairView.tokens`**: what the judges spent since the cap started, the same number the cap
  checks. The worker's row keeps showing the worker's own tokens.
- **The line's words.** They are Vietnamese when `pairVietnamese(view)` says so, else English, by the same rule as
  `pairpause.ts`:
  - judge working: "judge reviewing" / "judge đang soát" (the prototype's words);
  - judge idle while the pair relays: "judge waiting" / "judge đang chờ";
  - judge asleep while the pair relays: "judge asleep" / "judge đang ngủ";
  - judge asking: "judge is asking you" / "judge đang hỏi bạn", in the warning colour;
  - stopped, no-new-points: "judge paused: no new points" / "judge dừng: hết điểm" (the prototype's words);
  - stopped, settled: "judge paused: both agree" / "judge dừng: hai bên thống nhất";
  - stopped, token-cap: "judge paused: token cap" / "judge dừng: chạm trần token";
  - stopped, judges-gone: "judge paused: no judge left" / "judge dừng: không còn judge".

  With several judges the line begins "2 judge ·" and the state is that of the judge that needs you most (asking,
  then working, then the rest).
- **The token-cap words name the judge.** The head becomes "Paused: judge token cap reached (3.0M)" / "Tạm dừng:
  judge chạm trần token (3.0M)"; the form with no cap, which the header's state line uses, gains "judge" in the same way.
  Resume becomes "Resume · judge +3.0M" / "Chạy tiếp · judge thêm 3.0M". The server's
  Paused line becomes "Paused: judge token cap reached (3.0M)". The Library document's line becomes "… of 3.0M judge
  tokens".
- **Closing a worker closes its hidden judges.** `closeTabLogged` (`closetab.ts`) is the funnel every cockpit close
  goes through. When it closes a worker's tab, it also closes that worker's resting judges that are asleep. It reads
  the resting list and the roster from `globalStore`, and the pure helper that picks the judges lives in `pairmodel.ts`
  so that `closetab.ts` gains no import cycle. A resting
  judge that something woke is a plain row the person can see, and it is not closed.
- **Keyboard order follows the drawn tree.** `activenav.ts` passes the active pairs and the resting list to
  `buildAgentTree`, so the digit order never counts a judge that is not drawn.
