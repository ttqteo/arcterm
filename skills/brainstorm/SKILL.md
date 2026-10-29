---
name: brainstorm
description: Use whenever superpowers:brainstorming (or brainstorming) runs inside Arc, i.e. `wsh` is on PATH, except in an agent an Arc run started — keeps the brainstorm's state in .superpowers/brainstorm/<topic>/brainstorm.json, which Arc shows beside your terminal, and defines the `brainstorm:` lines Arc sends you.
---

# Brainstorming inside Arc

Follow `superpowers:brainstorming` as usual, with this skill beside it. Arc shows the brainstorm on
the Agent surface as a pane next to your terminal: the current question with why you ask it, the
answers you offer and an answer box, what was decided so far, the design's parts as they form, mockups beside their parts, and at the end a builder check and the
start of a run. It reads all of that from one file you write. You are its only writer; Arc only
reads it, and every user action reaches you as one line, sent to you as a message.

**Not in a run's agent.** When your instructions put every question through AskUserQuestion or
`wsh ask` (an orchestrator run's lead, or any agent an Arc run started; Arc sets `ARC_RUN_AGENT` in its
environment), follow them and do not use this skill: the cockpit shows those questions instead.

What changes from plain brainstorming:

- A playback is a part written to the file, not 200-300 words in the terminal.
- The user reads the pane, not the terminal. Your terminal reply is one short line on what you
  changed, then the question you are waiting on. Never repeat a part's text there.
- Mockups are `arc:design` boards, listed on the part they illustrate. Never start the visual
  companion's server inside Arc. A live spike is listed on its part too, never only in the terminal.
- Still end every turn on the question in the terminal: the file is what Arc shows, the terminal is
  what you wait on.

## The file

`<project>/.superpowers/brainstorm/<topic>/brainstorm.json`, where `<project>` is your working
directory and `<topic>` is a kebab-case name you pick at the first message. `.superpowers/` is
gitignored.

```json
{
  "v": 1,
  "title": "Consumer lag alerts",
  "spec": "docs/superpowers/specs/2026-10-18-consumer-lag-alerts-design.md",
  "canvas": "consumer-lag-alerts",
  "question": {
    "n": 4, "text": "When a group stays past its lag threshold, who gets paged first?", "part": "thresholds",
    "why": "Every consumer group names an owning team, and platform keeps the one rota Alertmanager routes to today. I can't tell whether every team keeps a rota.",
    "read": "Owner first wakes the fewest people if teams keep rotas; platform first is the safe fallback if they don't.",
    "options": [
      { "label": "Owning team first, platform after 15 minutes", "detail": "The owning team is paged; platform hears if nobody acks.", "pick": true,
        "pros": ["Pages go to who can fix it.", "Needs no new config: every group already names its team."],
        "cons": ["Needs every team to keep a rota."] },
      { "label": "Platform on-call first", "detail": "Platform is paged and hands off what it can't fix.",
        "pros": ["One rota to keep."], "cons": ["Platform wakes for lag it can't fix."] },
      { "label": "Both at once", "detail": "Owner and platform are paged together.",
        "pros": ["Nothing waits on a hand-off."], "cons": ["Every page wakes two people."] }
    ],
    "approaches": [
      { "name": "Owning team first", "description": "Page the group's owning team; platform hears after 15 minutes without an ack.", "facts": ["Every consumer group names its owning team in services/*/kafka.yaml."] },
      { "name": "Platform on-call first", "description": "Page platform, which hands off what it can't fix.", "facts": ["Platform keeps the one rota Alertmanager routes to today (alertmanager/routes.yml)."] },
      { "name": "Both at once", "description": "Page the owning team and platform together.", "facts": ["An Alertmanager route with continue: true reaches two receivers."] },
      { "name": "By how far behind", "description": "Page the owner below a second, higher threshold, platform above it.", "facts": ["No group has a second threshold; thresholds is still asked."] },
      { "name": "Last deployer", "description": "Page whoever last deployed the consumer.", "facts": ["deploy/log.go records each deploy's author."] }
    ],
    "judge": { "added": [], "dropped": [
      { "name": "By how far behind", "reason": "Every group would need a second threshold, and none has one yet." },
      { "name": "Last deployer", "reason": "A deployer is not on call: a night page reaches someone off shift." }
    ] }
  },
  "working": null,
  "parts": [
    { "id": "intent", "title": "Intent and why", "state": "yours", "from": "answer 1", "gist": "Page before a lagging consumer drops data.", "body": "Page on-call before a consumer falls far enough behind to drop data." },
    { "id": "page", "title": "What on-call sees", "state": "guess", "from": "mockup", "gist": "One page per group, with the lag trend.", "body": "One page per consumer group, with the lag trend.", "boards": ["Page.dc.html"] },
    { "id": "constraints", "title": "Constraints", "state": "guess", "from": "answer 2", "gist": "Prometheus 2.45 or later.", "body": "Prometheus 2.45 or later.",
      "was": "Any Prometheus version.", "why": "your answer 4 named the growth rate, which needs Prometheus 2.45" },
    { "id": "thresholds", "title": "Thresholds", "state": "asked", "body": "" },
    { "id": "today", "title": "What runs today", "kind": "note", "from": "recon", "gist": "Every group names an owning team; nothing pages on lag yet.", "body": "kafka-exporter scrapes 14 consumer groups. Every group names an owning team in services/*/kafka.yaml. There are no lag rules in Alertmanager." },
    { "id": "builder", "title": "Left to the builder", "state": "open", "body": "" }
  ],
  "history": [
    { "kind": "question", "n": 1, "q": "What should this make possible?", "a": "Know before we drop data.", "into": ["intent"] },
    { "kind": "question", "n": 2, "q": "One threshold for every group, or one per group?", "why": "Groups range from a few hundred messages a day to millions an hour.", "a": "Per group, with a default to start from", "into": ["thresholds"],
      "options": [{ "label": "One threshold for every group", "detail": "One number to tune for every group." }, { "label": "Per group, with a default to start from", "detail": "Every group alerts from day one; teams tighten their own.", "pick": true }], "picked": 1 },
    { "kind": "recon", "q": "I offered to look at your Prometheus targets. You said yes.", "a": "Found 2.45 on every target.", "into": ["constraints"] }
  ],
  "done": false,
  "check": null,
  "run": null
}
```

Arc treats the file as broken, and shows an error instead of the brainstorm, unless:

- `v` is the number `1`.
- `title` is a string.
- `parts` is an array; every part has a non-empty string `id` that no other part has, and every
  part that is not a note has a `state` that is exactly `yours`, `guess`, `asked` or `open`.
- `question`, when not `null`, is an object with a numeric `n` **and** a string `text`.
- `check`, when not `null`, is an object.

Everything else is optional and read leniently, but write every field as described:

| Field | What it holds |
|---|---|
| `spec` | The spec path, relative to the project (or absolute). You write the spec there on `brainstorm: check`. |
| `canvas` | The `arc:design` topic whose boards and spikes the parts list: boards live in `.superpowers/design/<canvas>/project/`, spikes anywhere under `.superpowers/design/<canvas>/`. Omit it when there are no mockups. |
| `question` | `{ "n", "text", "part", "why", "read", "options", "multi", "approaches", "judge" }`: the question you are waiting on, its number (1, 2, 3, ...), the id of the part it is for, why you ask it, your one-line read of the options, the answers you offer, and `multi: true` when the user may take more than one of them (below). On an approach question, `approaches` is the list you made for the judge, and `read`, `options` and `judge` come from the judge (**Approach questions go to the judge**, below). Leave `part` out for a question about no part (below). `null` while you are not asking. |
| `working` | One short line on what is still underway, set only when a turn ends with work running in the background (below). Arc shows it in place of the question and locks the pane's controls while it is set. `null` otherwise. |
| `parts[]` | The design, in display order. `title`; `state`; `kind` (`"note"` for background, below; leave it out for a decision); `gist` (the part in one line, below); `body` (the part's text); `from` (where it came from: `answer 2`, `mockup`, `recon`); `boards` (board file names under the canvas's `project/`); `spikes` (live spike pages, as paths under the canvas folder, below); `was` / `why` (below). |
| `history[]` | Every finished exchange, oldest first: `kind` (`question` or `recon`), `n` (the question's number), `q`, `why` (the question's `why`), `a`, `into` (the part ids it went into), and for a question that offered answers, `options` and `picked` (an index, or a list of indexes when the user took several), and the question's `judge` when it had one (below). A question dropped after pushback has `superseded: true`, `part` (the part it was asked for) and no `a` (below). |
| `done` | `true` only when nothing is left to ask. |
| `check` | The builder check's result (below), else `null`. |
| `run` | The run id once a run started from this brainstorm, else `null`. |
| `compacted` | Unix milliseconds of your last re-read after a compaction (below). |

Part states:

- `yours`: the user said it or confirmed it.
- `guess`: your guess or playback, not yet confirmed.
- `asked`: the part the current `question` is for.
- `open`: known to be needed, nothing written yet.

**Decisions and notes.** A part is a decision unless it has `"kind": "note"`. A decision is what the
run builds, and each one has to be `yours` before the builder check. A note is background the
decisions stand on: what recon found, what research says, a trade-off write-up. It goes into the
spec as context, the user has nothing to confirm on it, and Arc lists it apart, under "What the
agent found"; it needs no `state`. Whatever the user needs in order to choose belongs on the
question (`read`, and each option's `pros` and `cons`), never only in a part: while a question is
open it fills the pane and the parts are out of sight.

**Gist.** Give every part a `gist`: the part in one line, under 100 characters, as a reader skimming
the design would want it ("Daily: one forecast per entity-day, with a weekday cycle and trend").
Arc shows the design one line per part and opens a part's `body` on demand, so the gist is what the
user reads when they confirm. Rewrite it whenever you rewrite the body.

There is no total and no fixed list of parts: parts appear as the conversation finds them. Never
write a count of questions remaining, a progress figure or "N of M" anywhere, in the file or the
terminal.

## The lines Arc sends

An answer arrives as the user's own text, on one line; a picked option arrives as its `label`, and
options picked together on a `multi` question arrive as their labels joined by ` + ` (`Owning team
first + Both at once`): the answer is all of them, combined. So does
anything else the user types in the answer box: a pushback, a question back, a request for more. Arc
keeps the box when no question is open too, and a line typed there arrives the same way (**A line
with no question open**, below).
Every other action is a `brainstorm:` line:

| Line | What you do |
|---|---|
| the answer, as typed | Answer sequence below, unless the line pushes back or asks instead (below). |
| `brainstorm: guess` | The user wants you to decide. Write your best guess for the current question's part as `guess` (say in `from` that it was your call), then ask the next question as after an answer. |
| `brainstorm: skip questions` | Stop asking. Write every `asked` and `open` part as a `guess`, set `question: null` and `done: true`. |
| `brainstorm: judged <path>` | The judge weighed the open question. Copy the file at `<path>` onto `question` with the one-line script under **Approach questions go to the judge**, which sets `working` to `null` in the same write; never retype it. End the turn on the question. |
| `brainstorm: judge failed: <reason>` | The judge did not weigh the open question (ignore it for a question no longer open, as the section after **Approach questions go to the judge** says). Write your own `options` and `read` with one `pick`, set `question.judge` to `{ "failed": "<reason>" }` and `working` to `null`, and end the turn on the question. |
| `brainstorm: confirm <part id>` | Make that part `yours`; drop its `was` and `why`. |
| `brainstorm: confirm every guess` | Make every `guess` part that has no `was` `yours`. A part with `was` stays a guess: it waits for keep or restore. |
| `brainstorm: edit <part id>: <text>` | Replace that part's `body` with the text (fix only obvious typos), make it `yours`, drop `was` and `why`. |
| `brainstorm: keep <part id>` | The user accepts your change to a part they had confirmed: make it `yours`, drop `was` and `why`. |
| `brainstorm: restore <part id>` | Put their version back: `body` = `was`, make it `yours`, drop `was` and `why`. |
| `brainstorm: keep every change` | `keep` every part that has `was`, in one write. |
| `brainstorm: check` | Write the spec, run `wsh brainstorm check <path>`, end the turn. Builder check, below. |
| `brainstorm: builder questions <path>` | Sort the reviewer's questions into `check`. Builder check, below. |
| `brainstorm: builder answer: <text>` | Builder check, below. |
| `brainstorm: builder decide` | Move the first `check.yours` entry with no `a` into `check.calls` as `{ "text": <your decision>, "part": <its part> }`, fold it into that part and the spec (marked "Agent's call"), write the file. |
| `brainstorm: keep talking` | Set `done: false` and `check: null`, and ask your next question. |
| `brainstorm: approved` | Stop. Arc opens the run launcher with the spec attached. Do not start a run yourself. |
| `brainstorm: run <id>` | A run started from this brainstorm: set `run` to the id. |

After acting on any line, write the file once, then end the turn with a short reply in the
terminal (the next question, when there is one).

## Rules

**One write per turn, always the whole file.** Arc reads the file every few seconds and shows that
you are working from the moment it sends a line, so write it once, when the turn's change is
complete. Each write leaves the whole file valid JSON:

- The first write, which creates the file, and any change that rewrites most of it: your
  file-writing tool, with the complete JSON.
- A small change (a confirm, an edit, a state flip, a field set): a one-line script that reads the
  JSON, changes it and writes the whole file back in one write (`node -e` or `python -c`). It is far
  cheaper than retyping the file.
- Never an in-place text edit of part of the file: one mismatched brace and Arc shows an error.

**Work that outlasts the turn.** When a turn ends with work still running in the background (a
subagent dispatched in the background, a long command), that turn's write sets `working` to one
short line saying what is underway ("A builder is reading the design."). The write that delivers
the result sets `working` back to `null`. Without it, Arc can take the end of the turn for the end
of the work and offer the same action again. Never leave `working` set while you wait on the user:
it locks the pane.

**The first message.** Pick `<topic>`. Create the file with `title`, `spec` (the path superpowers
would write the spec to), question 1 in `question` with `n: 1`, its part created as `asked`, and
`history: []`. In Claude Code a hook reveals the pane when your file-writing tool creates the file;
in any other harness run `wsh ui reveal brainstorm:<topic>` from your terminal.

**On an answer**, in that one write: append the exchange to `history` (with `n`, `q`, the question's `why`, `a`
and `into`; when the question offered `options`, copy them into the entry, with the question's `judge`
beside them when it has one, and set `picked` to the index of the one the user's answer is, to the
list of indexes when they took several together, or leave `picked` out when they answered in their
own words), write the part (`guess`, or `yours` when the user's own words are the part), and set the
next `question` (its part created as `asked` if new). End the turn with the question in the
terminal too.

**Yours is only what they said.** A part becomes `yours` from an answer only for what the answer
said. Anything you add to it (a board, a named option, a detail the answer did not give) keeps the
part a `guess` until they confirm it. A part an answer made yours names that answer in `from`
(`answer 11`), and the answer's history entry lists the part in `into`: Arc shows the answer's text
beside the part, so a part that says more than the answer stands out.

**When the line is not an answer.** The answer box is also where the user pushes back ("why not
reuse the alerting we have?"), asks what something means, or asks for more before choosing. Such a
line answers nothing: record no answer, write no part from it, and keep the question open under the
same `n`. In that one write:

- Reply in the question's `why`: lead with the answer to their point in one or two sentences, then
  what you still cannot tell without them. Arc shows `why` right under the question, so that is
  where they read your reply; the terminal still gets one short line.
- A line that asks for a report (research, a comparison, a look at something) is done in that turn
  and reported as **Findings reach the question** says: the summary is your `why` reply.
- On a question with `judge`, pushback against the options or a typed "double check" goes back to a
  fresh judge, never weighed by you. In that write, add any alternative they name to `approaches` and
  set `working`; then run
  `wsh brainstorm judge <absolute path of brainstorm.json> --line "<their line, verbatim>"` and end
  the turn. Keep the question's `options`, `read` and `judge` until the new `judge.json` is copied
  over them: Arc reads the earlier options and pick from there (writing no `options` or `read` is for
  a question's first judge only). Do not weigh their point in `why`: the judge's new result is the
  reply. A plain question back (what something means) is no pushback: answer it in `why` as the first
  bullet says.
- On any other question, a pushback against an option is checked against the facts: their
  alternative becomes an option if it holds up, and the pick if it beats yours; rewrite `options` and
  `read` to match. If it does not hold up, say why in `why`, naming the fact.
- When the pushback shows the question itself was wrong (it rests on a false fact, or asks what is
  already settled), ask the right question under the next `n` instead, and rewrite every part the
  false fact reached.
- Whenever pushback replaces the question with a different one (the right question above, or a
  narrower one that asks less), the old question is dropped, not answered. Append a `question` entry
  for it: its `n`, `q`, `why` and `options`, `part` (the part it was asked for), `into: []`,
  `"superseded": true` and no `a`. Arc shows it in the history as dropped, and counts it as no
  answered question. Its part goes back to `open` (unless the new question is for that part), and
  stays open until a question asks what the dropped one asked and the user answers it: an answer to
  a narrower question ("dark or light?") never fills in the choice it did not ask (which layout).
- Append a `recon` entry to `history`: `q` is "You asked: " (or "You pushed back: ") and their line,
  `a` your reply in one sentence, `into` the parts it changed (`[]` when none). Arc lists it with the
  recon; a `question` entry would count as an answered question.

A line that both answers and asks ("B, but why not C?") is pushback: reply, and say in `why` that you
read them as leaning to B, so one more line settles it. When you cannot tell whether a line is an
answer, treat it as pushback and say in `why` which answer you read it as: asking again costs one
turn, recording the wrong answer costs a wrong part.

**A line with no question open.** While `question` is `null` (the design after `done`, parts waiting
on keep or restore, the builder check's review) the pane still has the answer box, and what the user
types there arrives as their own text. Nothing was asked, so it answers nothing: it is pushback or a
question back. In that one write:

- Reply by opening a question under the next `n` whose `why` leads with the reply, in one or two
  sentences, then what you still need from them. The pane shows `why` only under an open question,
  so a reply left in the terminal goes unread. Name the `part` it is about, and give `options` when
  the line leaves a choice.
- Set `done: false`: the question is open until they answer it.
- Work the line as **When the line is not an answer** says (add the `recon` entry), and rewrite every
  part it changes as **A later answer changes earlier parts** says: a `yours` part gets `was` and
  `why` and waits for keep or restore.
- Pushback against an approach the user picked from a question with `judge`, or a typed "double
  check" of one, goes back to a fresh judge: the question you open is an approach question
  (**Approach questions go to the judge**), with any alternative they name in its `approaches`, and
  you run the judge with `--line "<their line, verbatim>"`. Its `why` says what the line reopened,
  never a lean.

**Asking.** One question per turn, as superpowers does. Every question about the design names its
`part`. Every question carries `why`: one or two sentences on what you already know and what you
cannot tell without the user, which Arc shows under the question. When the question has natural
choices, it also carries 2-4 `options`, each `{ "label", "detail", "pros", "cons" }`: `label` is the
answer in a few words, `detail` says what the option is in one sentence, and `pros` and `cons` are
your reasons for and against it, one short sentence each (what it gains and loses, what it costs,
whether it fits what is there today). Mark your recommendation with `"pick": true` on exactly one
option, and say how the options compare in `read`: one line, the reason for your pick included. Arc
shows the options as lettered rows the user picks from, each with its pros and cons under it, and
`read` above them; the free-text box stays for any other answer. Set `"multi": true` on the
question when the options add up rather than rule each other out (which checks to run, what a page
shows), so the user may take more than one; leave it out when they exclude each other (dark or
light, one threshold or one per group). Arc says "Pick one" or "Pick one or more" over the options
and, on a `multi` question, gives each row a tick box. Write pros and cons whenever the
choice is a trade-off; a question whose answers need no weighing leaves them and `read` out. An open question (a story, a moment, a number only the user knows) has no
`options`. An approach question is the exception: the judge writes its options, pick and `read`
(below).

**Approach questions go to the judge.** A question that picks an approach (how to build something,
which design, which mechanism) is not yours to weigh: by the time you ask it you lean. Arc's judge,
a fresh Opus session that never sees your favorite, checks the facts, adds what your list missed,
and writes the options, the pick and the `read`; the pane labels them the judge's. Permissions,
process steps, plain choices and the builder's questions are not approach questions: ask them as
**Asking** says, with your own pick, which the pane labels "Agent's pick".

For an approach question, in one write:

- List at least five distinct approaches in `approaches`, unconventional ones included, each
  `{ "name", "description", "facts" }`: a name of a few words, one or two sentences on what it is,
  and the facts you found in the code that bear on it (the code it touches, what already exists that
  it would reuse, the constraints that rule it in or out), naming files and functions. Finding facts
  is your job; ask the user only for what you cannot look up. An approach with no `name` does not
  count toward the five. A fact the design stands on also goes in a note part.
- Write no odds, no pick, no ranking and no pros and cons for them, in `approaches` or in a note.
  Weighing how likely each approach is to be best can help you widen the list; keep those odds in
  your head, never in the file.
- The question's `why` states the facts and what you cannot tell without the user, never a lean.
- Write no `options` and no `read`.
- Set `working` to one line: `The judge is weighing 7 approaches.`

The test for the list: if the user answered "double check", could you name an approach it lacks?
Then the list is not done. Widen it now, before you run the judge.

Then run `wsh brainstorm judge <absolute path of brainstorm.json>` and end the turn with one line.
The pane shows the working line meanwhile, so the user never sees an unweighed question. If the
command fails, do as for `brainstorm: judge failed`, with the command's error as the reason.

When `brainstorm: judged <path>` arrives, copy the judge's result onto the question with this one
script, never by retyping it; it sets `working` to `null` in the same write:

```
node -e "const fs=require('fs'),[f,j]=process.argv.slice(1),b=JSON.parse(fs.readFileSync(f));Object.assign(b.question,JSON.parse(fs.readFileSync(j)));b.working=null;fs.writeFileSync(f,JSON.stringify(b,null,2))" "<absolute path of brainstorm.json>" "<path>"
```

`<path>` is `judge.json` beside `brainstorm.json`: `{ "options", "read", "multi", "judge": {
"added", "dropped" } }`. `approaches` stays in the question for a rerun. The judge's `multi`
replaces yours: set `multi` on the approach question only for the wait, when the approaches could be
taken together.

**While the judge weighs.** Arc shows the question, the approach list and an open answer box while
the judge runs, and stops the judge itself before it sends an answer or Skip; you never stop it. A
line that arrives while the judge runs (`working` set for an approach question) is handled so:

- An answer, typed or an approach `name` from a clicked row, is recorded as any answer: `a` is the
  text and `picked` is left out. No `options` go into the history entry: a first judge has none, and
  a rerun's earlier options were not shown during the wait. Then ask the next question as after any
  answer, with `working` back to `null`.
- Pushback or "double check" reruns the judge with `--line "<their line, verbatim>"`, as on a judged
  question, adding any alternative it names to `approaches`. `working` stays set, and you end the
  turn.
- `brainstorm: skip questions` works as in the table above.
- A `brainstorm: judge failed` line for a question that is no longer open is ignored. A judge Arc
  stopped sends no line.

**Findings reach the question.** When the user asks for a report (research, a comparison, a look at
something), what you found goes two places in the same write:

- A short summary leads the `why` of the next question, or of the current one when it stays open:
  the findings themselves in two or three sentences, then what they mean for the choice.
- The detail goes in notes, one note part per finding, `from` naming its source, each with a `gist`
  that states the finding itself ("Most teams page on lag growth, not on a fixed lag"), never a topic
  label ("Current trends").

Never leave the findings only in a note. While a question is open the pane shows only the question;
Arc marks the new notes and links to them, but the link says only how many there are, so a finding
that is not in `why` goes unread.

**Every question you wait on is in the file.** Whenever your turn ends waiting on the user, whatever
the phase (a choice you need before you can go on, a permission, a clarification), that question is
in `question` with the next `n`, and `part` left out when it is for no part. Arc shows only what the
file holds, and a question asked only in the terminal leaves the user with nothing to answer. The
builder's questions for the user are the one exception: they live in `check.yours`, which Arc asks.

**Playbacks are parts.** Write or rewrite a playback as a `guess`. It becomes `yours` only on
`brainstorm: confirm`, `brainstorm: edit`, or when the user's own words are the part.

**A later answer changes earlier parts.** When an answer overrides or narrows what a part already
says, rewrite that part in the same write, whatever its state, and check every other part the
answer touches: two parts that contradict each other reach the builder check as two confirmed
decisions. A `guess` or a note is rewritten in place. When you rewrite a part that is `yours`, set
`was` to the body they had confirmed and `why` to the reason (name the answer that caused it), and
make it a `guess`. It stays a guess until they keep or restore it.

**Mockups.** Draw them as `arc:design` boards under `.superpowers/design/<canvas>/project/`, set
`canvas`, and list each board's file name in `boards` on the part it illustrates. Arc draws it as a
thumbnail in the part, under its body when the user opens it, in the talk and in the builder check's
review alike. The run's prototype is the first board any part lists.

A spike is a throwaway live page for what a board cannot show, such as motion or a drag: a plain
HTML file under the canvas folder, e.g. `.superpowers/design/<canvas>/spike/motion.html`. List its
path relative to the canvas folder in `spikes` on the part it illustrates (`"spikes":
["spike/motion.html"]`), and set `canvas`. Arc serves the folder and shows each spike as a link in
the part that opens it in the browser. A spike is listed on the part it illustrates, never only in
the terminal: a URL in the terminal is gone once the user reads the pane.

**Left to the builder.** The part with id `builder` and title `Left to the builder` is always the
last part. Write it as a `guess` once nothing is left to ask.

**Done.** Set `done: true` only when nothing is left to ask and `question` is `null`. Arc enables
**Check with a builder** once `done` is true, no question is open and every decision is `yours`.

**After a compaction**, before anything else: re-read the file, set `compacted` to the current Unix
time in milliseconds, write it back. Carry on from the file, not from memory.

**The builder check.** Arc runs it: a fresh reviewer session reads the spec and sends its questions back
to you. You write the spec, start the reviewer, and later sort what it asked.

On `brainstorm: check`: the user pressed **Check with a builder**, which is their go-ahead: do not ask
again. Write the spec at `spec` from the parts, then run `wsh brainstorm check <absolute path of
brainstorm.json>`. Write nothing else to the file: Arc tracks the check and shows the user that a builder
is reading. End the turn with one line naming the spec's path. If the command fails, put its error in
`question` with the next `n` (no `part`), so the pane shows it, and write the file.

On `brainstorm: builder questions <path>`: the reviewer is done. Read the file at `<path>`: its ranked
questions about the spec. Sort every one into `check.yours` / `calls` / `answered` below, fold what you
decide into the parts and the spec, refresh `touched`, and write the file once. When it says nothing
important is left, write `check` with `"yours": []`. Then fill `check`:

```json
"check": {
  "yours": [{
    "q": "Should a paused consumer page?", "label": "Page on a paused consumer?", "why": "the spec says every group pages", "part": "thresholds",
    "options": [
      { "label": "Yes, like any lag", "detail": "A paused consumer pages once its lag crosses the threshold.", "pick": true,
        "pros": ["One rule for every group."], "cons": ["Planned pauses page too."] },
      { "label": "No, only running consumers", "detail": "A paused consumer never pages.",
        "pros": ["No pages for planned pauses."], "cons": ["A stuck pause goes unnoticed."] }
    ],
    "a": "Yes, like any lag", "into": ["thresholds"]
  }],
  "calls": [{ "text": "Lag is measured per partition, alerted per group.", "part": "thresholds" }],
  "answered": ["Which Prometheus? The spec names 2.45."],
  "touched": ["thresholds", "constraints"]
}
```

- `yours`: the questions only the user can answer, each `{ "q", "label", "why", "part", "options", "a", "into" }`.
  `why` is why it matters; `part` is the part the question is for; `label` is a short line for the
  queue, under 80 characters; `options` are written exactly as a talk question's (`label`, `detail`,
  `pros`, `cons`, one `pick`), and left out when the answer is open. `a` and `into` stay out until the
  question is settled (below); `into` is the list of every part the answer changed.
- `calls`: the decisions you made for them, each `{ "text", "part" }` naming the part it belongs
  to. Mark each one inline in the spec as "Agent's call".
- `answered`: what the builder asked that the spec already answers.
- `touched`: the ids of the parts the check changed or annotated. Refresh it whenever the check's
  parts change (rewritten, added or annotated), on every write that does that.

Your terminal reply after sorting is one line naming the spec's path: the pane shows the builder's
questions, your calls and what the design already answered, so do not list them there.

On `brainstorm: builder answer: <text>`: the answer is for the first `check.yours` entry with no
`a`. Set its `a` to the text and `into` to every part it changed, fold the answer into those parts
and into the spec, and write the file. A part the answer rewrites that was `yours` gets `was` (the
body they had confirmed) and `why` naming "builder question N", and stays a `guess` until they
`keep` or `restore` it, one by one or all kept at once. A part the answer only fills in, or that
was already a `guess`, becomes `yours` (the user just decided it). When the text pushes back or asks
instead of answering, it is not an answer: leave `a` unset, put your reply at the head of that
entry's `why`, and rework its `options` as **When the line is not an answer** says.

On `brainstorm: builder decide`: the user leaves the first `check.yours` entry with no `a` to you.
Move it out of `yours` into `calls` as `{ "text": <your decision>, "part": <its part> }`, fold it into
that part and into the spec marked "Agent's call", and write the file. Arc keeps no state for it: the
entry is gone from `yours`.

**An answer settles builder questions too.** When any answer, a talk question's or a builder
question's, settles a `check.yours` entry, set that entry's `a` (what was decided, in a few words) and
`into` in the same write. Otherwise the pane keeps asking it.

**Name the cause.** Every `why` on a changed part names its cause in a few words, for example
`answer 12: your boss wants PyTorch` or `builder question 1`: the review shows it under the
decision.

**Approving.** Arc enables approve only once no question is open, every builder question is
answered or decided by you, and every decision is `yours`.

**The run.** On `brainstorm: approved`, stop; Arc opens the launcher, and sends `brainstorm: run <id>`
once the run starts.

**Resuming.** Asked to resume a brainstorm from a `brainstorm.json` path (a new agent after the old
one exited): read the file, carry on from its `question` or its next step, and keep writing the
same file.
