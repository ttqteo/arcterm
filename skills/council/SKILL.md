---
name: council
description: Use when the conversation holds a clear problem or a thing to judge and a real open question more viewpoints would settle (two directions weighed and neither won, a spec or plan just written, a draft about to be submitted), or when the person asks for a council ("ask a council", "hỏi council", /arc:council) — start it yourself with `wsh council start`, wait for it, and sum its report up in the conversation.
---

# Starting a Council

A council is a panel of expert agents that works one question in three rounds of one-shot `claude -p` calls: each
expert proposes, the experts react to each other's proposals, and a coordinator writes the answer. It runs in one of
two modes, which you pick:

- **`review`** — a thing to judge (a spec, a plan, a design, a draft, two directions already on the table). The report
  ranks up to three directions, each with its first step, and lists the rest under Also raised, one line each.
- **`brainstorm`** — a problem or a goal with no answer yet. The report holds up to three ideas worth trying, each with
  its why and a first step, plus the wild ideas kept aside.

arcterm shows it as a group chat while it runs, then as a report, and saves every finished council as a document in the
project's `docs/council/` with its whole discussion. One council costs roughly 0.5–1.5M tokens. The Token burn gate
prices every start and asks the person when it is costly, so you start one without asking first.

## When to start one

**Without being asked**, when the conversation holds a clear problem or a thing to judge *and* a real open question
that more viewpoints would settle:

- two directions were weighed and neither won;
- a spec or a plan was just written, before it goes to the engine;
- a paper draft (`.tex`) is about to be submitted.

**At once** when the person asks for one: "ask a council", "hỏi council", `/arc:council`. Do not judge whether the
conversation is ready; use what it holds. If they ask and the conversation holds no question yet, ask for it in one line; do not invent one.

**Not** for a question already settled, a small or reversible choice, a question you can answer by reading the code,
or when the person said no council. Start at most one council per decision: if the person stopped one or turned it
down for this spec, plan, draft or question, do not start another for it unless they ask. `wsh council list` shows the
project's councils, so check it before starting a second one on the same thing.

## Starting it

Pick the mode yourself, from the question: a problem or a goal ("how do we…", "what should…") is `brainstorm`; a thing
that exists to be judged (a draft, a spec, a plan, a feature, "review this", "what's wrong with…") is `review`. The
person does not choose it. Then run:

```
wsh council start --mode <review|brainstorm> --mode-why "<one line: why this mode>" \
  --feature "<the first line: what the council looks at>" \
  --question "<the question in the person's words. Keep to: <the constraints they stated>>" \
  --files <path>,<path> [--screenshot <png>]...
```

- `--mode-why` is one line, kept with the council beside its mode ("a goal with no answer yet", "a plan to judge").
- `--question` is the person's question in their own words, not your reading of it, and not your preferred answer: a
  council anchored on your view adds nothing. When they stated constraints (the budget, the stack, what is out of
  scope, what is already decided), add them after "Keep to:"; leave "Keep to:" out when they stated none.
- `--files` are the files the experts read (the spec or plan, the source it touches), comma-separated, relative to the
  working directory or absolute. Their size is part of the cost, so name what matters, not the whole tree.
- `--screenshot <png>` (repeatable) for a UI the experts should see. The role experts only read (Read, Grep, Glob): they
  cannot run the app, a browser or ffmpeg, so a picture they need comes from you, before `start`. When the question is
  about something seen (a UI, a mockup, an animation, a video), capture it first and attach it, or the panel judges
  markup and guesses (its claims come back weak: "an estimate from the mockup"):
  - a video or an animation: a few frames at the moments the question is about, not an even sweep, e.g.
    `ffmpeg -ss 42 -i tour.mp4 -frames:v 1 f-042s.png`, the second in the file name so a claim can cite
    `screenshot:f-042s.png#top`;
  - a running UI: a screenshot of it (in arcterm's own dev app, `node scripts/cdp-shot.mjs <out.png>`);
  - a `.dc.html` mockup: a screenshot of the board it is about.

  Keep it to about six images in a scratch folder, not the project: each one is read by every expert, so it costs
  like a file. If you cannot capture (no ffmpeg, the app is not running), say so in `--question` ("no frames attached")
  rather than leave the panel to guess.
- `--agent <tab id>` and `--expert <role id>` (each repeatable) name who sits; they are for a council on chats the
  person named, see Seating chats below. With neither, the council is experts only.
- `--model` sets the role seats' models for this council only: `--model skeptic=opus` for one seat (repeatable; a named
  seat wins), `--model sonnet` for every role seat. You pick it at every start, from the question, as under Which seats
  run on opus below; a model the person asked for goes in as they said it and wins over your pick. `estimate` takes it
  too, so quote the price with the same flags. A seated chat answers on its own session's model.
- `--group` is optional: `brainstorm` takes `product-ideas` and `review` takes `ui-feature` (a UI feature, a spec or a
  plan) when you leave it out; with `--agent`, `brainstorm` takes `agents-ideas` (an Other side and the Host) and
  `review` takes `agents` (a Bug hunter and the Summarizer). Use `--group paper` ("Paper review") for a `.tex` draft. An
  explicit `--group` adds its roles beside the seated chats.
- Leave `--pause` out unless the person asked for it: a paused council stops after round 1 and only the person can
  continue it. `--queue` is accepted and does nothing more; every second start is queued.

### Which seats run on opus

A seat's model follows what it has to do for this question, not its place on the panel. A role seat runs on sonnet
unless its role says otherwise (a role the person set to opus stays opus), and the coordinator (the seat that writes the
report: Summarizer, Final judge, Host, or the one a group of the person's names) keeps its own model: never name it in
`--model`. Before every `start`, read the question and the seats (`wsh council estimate` with the same `--group`,
`--expert`, `--agent` and `--mode` lists each seat's name and model; `--model` takes a seat's name or its id), and
choose:

- **Opus** for the seat or seats that carry the question's hardest part: those whose job, on this question, is to judge
  whether its central claim, method or result holds. Usually one or two, rarely every seat. Of the stock roles, the
  judging ones are `reviewer-a`, `reviewer-b`, `skeptic` and `contrarian`. For the person's own roles, read their briefs
  in `councilroles.json` in arcterm's config dir (`wsh wavepath config` prints it).
- **Sonnet** (leave the seat out of `--model`) for a seat that gathers, plans, asks or reads for ease of use, and for
  every seat when the question is a light one: a wording pass, a list of ideas, a UI review. Then no seat goes to opus
  and you say nothing about models.

When a seat goes to opus, before `start`:

1. Run `wsh council estimate` with the same flags as the start, the `--model` ones included.
2. Say in one line which seats go to opus and why, with that estimate, and that the estimate counts tokens only: it does
   not show that opus costs more than sonnet for the same tokens, and the Token burn card shows the same number. E.g.
   "Bug hunter and Reviewer A on opus (they judge whether the method holds); ~0.9M tokens, counted, not priced: opus
   costs more per token."
3. Run `start` with those flags. The person approves on the Token burn card as for any council; do not ask them
   anything more first.

Say in **one line** what happened, from the line `start` printed:

- `council <id> started: …` — it is running. Say so with the mode, the group and the estimate.
- `Queued after <id> (<feature>)` — one council runs at a time across all projects, so this one waits for the running
  council and starts by itself when it ends. Say so, and which council it waits for.
- `Not run: …` — see below.
- `A council on this topic ended on …` and `Not started.` (exit 1) — a council on the same topic ended in the last 7
  days. Nothing was started or spent. Tell the person what it said (its direction 1 and first step, and the report path)
  and whether the council has been upgraded since, then ask what is new. Start again only on their answer:
  `--new-evidence "<what is new, in their words>"`, or `--rerun-upgraded` when they want the upgraded council's own
  answer to the same question. When nothing is new, point them at the earlier first step instead.

Then read it back:

```
wsh council wait <id>
```

`<id>` is the new council's own id; when the printed line does not carry it, `wsh council list` shows it (newest
first). `wait` polls until the council stops running (a queued one included), then prints the report and the matrix as
markdown. Sum it up in the conversation in a few lines: for a review, the top direction, why it ranked there, its first
step and where the panel disagreed; for a brainstorm, the ideas worth trying with their first steps, and a wild idea only when it
changes the choice. Then carry on from there with the spec, the plan, the draft or the problem. `wait` prints no cite
check: before you repeat a `path:line` of the report as fact, read the saved document's Cite check section (or run
`wsh council cites <document>`), and say so when the place is listed wrong or with no keyword near the line.

A council's directions are only in its report. Its document is saved under the project's `docs/council/` when it ends
(done or stopped); `wsh council show <id> --json` carries its path as `docpath`.

## Seating chats

By default a council is fresh role experts. When the person **names chats or tabs** for it ("a council on v5 này +
5065bd8c + 71d93e40"), those chats sit in it and speak from their own context: each takes its turn in its own tab, and
the talk lands in that tab's transcript. The panel is the named chats, one fresh Bug hunter (an Other side in `brainstorm`)
who looks for holes in what they say, and a fresh Summarizer (the Host in `brainstorm`) who writes the report.

- Pass each named tab as `--agent <tab id>`, repeated once per tab. The ids are the ones `wsh agents list --all` prints
  (id, project, title); match the person's names against that list.
- Pass `--agent self` **only** when they name the chat you are in ("this chat", "v5 này"). `wsh council start` never
  seats the starting chat on its own.
- **Never summarise another tab into a file for the panel.** The chat is the source and answers for itself. With no chat
  named, leave `--agent` out: the council stays experts only, as above.
- Add `--expert <role id>` only when the question needs a view no seat has (UX for a UI question, RAM for a memory
  question), and say why in the one line you say about the start. `start --expert <role>` adds a role to the panel; it
  is not `retry --expert <seat>`, which reruns a failed call.
- If `start` fails on an id, it names the id and prints the live tabs. Ask the person which they meant, with that list,
  then start again. Never start the council without a seat they named.
- A council started this way holds no drafts: a seat's answer reaches the others as it is written, and the council runs
  to the report by itself. The person can still post or @ a seat in the room while it runs.
- Without `--agent self` the seats are other tabs, so your turn stays free: `wait <id>` runs in the foreground as above.

**With `--agent self`** your own tab is a seat, so it must read idle when a round arrives; a tab that is working when its
turn comes is skipped for that round after 10 minutes. After `start` prints its line:

1. Say the one line about the start, as above.
2. Run `wsh council wait <id> --timeout 0` with `run_in_background`. `--timeout 0` waits without limit, because the
   foreground wait's 30 minutes would end before a long council does.
3. End your turn and do no other work: no more tool calls, no files to tidy. The idle tab is what lets each round in.
4. Each round reaches you as a new prompt from the council. Answer it as a seated expert, in that turn, and end the turn
   again.
5. When the wait exits it brings you the report. Sum it up as above. A failed or paused council comes back through the
   same wait; handle it as under What can come back.

A `Not run: …` start seats nothing and needs no wait. **A pi agent does not seat itself**: it has no background shell
to wait in. It tells the person so and passes only the other tabs they named, leaving `--agent self` out.

## What can come back

- **`Not run: …`** is the person's call, from the Token burn gate. Do not retry. `start` saved the council as not run
  and exits 0: carry on without it, and say in your reply that the council was skipped and that Start council in the
  app runs it later.
- **A council waiting on the person** (`wait` says it paused after round 1) is theirs to continue in the app. Tell
  them, and carry on; do not call `wait` in a loop.
- **A failed council** makes `wait` exit non-zero with the reason. Report it and carry on; do not start another to
  retry, which would spend the tokens again. When the person asks to retry it, `wsh council retry <id>` reruns only the
  failed call (the summary, or `--expert <seat>`), on another model with `--model` (`claude-opus-4-8` for a call
  Claude's safeguards flagged, though such a call already ran once more on it by itself), then `wsh council wait <id>`.
  Several failed seats go together with `--all` (one run, the seats at once; one `retry` each is refused while the
  first runs), `--model <seat>=<model>` per seat; a failed summary is retried after them, on its own.
- **A stopped council** prints what its finished rounds hold. Use it as it is.
- **A timeout** (`wait` gives up after 30 minutes by default) leaves the council as it is, running or still queued.
  Say so, and run `wsh council wait <id>` again later if you need the answer.

## The other commands

- `wsh council list` — the project's councils, newest first: id, state, round and feature.
- `wsh council show <id>` — a council's report and matrix as markdown, without waiting.
- `wsh council retry <id> [--expert <seat>] [--model <model>]` — run a failed call again, once; the discussion stays.
  `--all [--model <seat>=<model>]...` reruns every failed seat but the summary at once.
- `wsh council stop <id>` — stop a running or queued council; the rounds that finished stay. Only when the person asks.

## Writing a role

When the person asks for a new role (or a panel of them), it goes into `councilroles.json` in arcterm's config dir
(`wsh wavepath config` prints it), beside the roles already there: `{"roles": [{"id": "…", "name": "…", "brief":
"…"}]}`. Never change or drop a role there you were not asked about.

- `id`: an English kebab-case slug (`method-check`), new to the library.
- `name`: in the language the person is writing to you in (Vietnamese in a Vietnamese conversation). A written name
  shows as it is in every council; only the stock roles switch language with the question.
- `brief`: the role's one angle, in the second person like the stock briefs ("You review…").
- `model`: leave it out, which is sonnet. Opus is chosen per council at the start (Which seats run on opus above), so
  write `opus` only when the person asks for it.

Vet the draft before you write it, and revise it until it passes:

- it duplicates no role already in the library: the stock ones and the person's own in the file. `wsh council estimate
  --expert '?'` fails and names the role ids it could add beside the default panel; run it once more with `--group paper`
  and the two lists name every role but the coordinators;
- it holds one angle only; two angles are two roles;
- its brief ends with the evidence rule every stock brief ends with, word for word: "Cite a path:line for every claim,
  or a region of an attached screenshot; a claim with neither is marked weak."
- its name is in the person's language.

Then show the person the final name and brief in the conversation, and write the role only once they approve. For a
council about to start, that is one more turn with them before the start.
