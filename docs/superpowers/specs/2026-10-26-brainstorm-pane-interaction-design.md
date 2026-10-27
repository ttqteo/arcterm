# Brainstorm pane: something to do during the judge's wait

## Intent and why

While the model is generating, the brainstorm pane gives nothing to interact with: the next question and its data
only show up once the LLM finishes. The longest such wait is the judge's: an approach question is written, the judge
(a fresh session) weighs it, and only then do the options appear. This change fills that wait.

## Scope

Only the wait while the judge weighs an approach question changes. The wait after a talk answer, the builder check's
reading, and every other working state keep today's Working view.

Agent's call: the builder check's pane (`brainstormcheck.tsx`) gets the same view when its open question waits on a
judge: `checkMain` uses the same rule as `mainView`.

Non-goals:

- streaming the brainstorming agent's own mid-turn progress;
- steering the judge's list while it runs (leave out / add / restart);
- live per-approach verdicts from the judge.

## What runs today

- The arc:brainstorm skill (`skills/brainstorm/SKILL.md`) has the agent write `brainstorm.json` once per turn. Arc
  polls it every 3s (`BRAINSTORM_POLL_MS`, `brainstormmodel.ts`).
- For an approach question the agent writes `question.text`, `question.why` and `question.approaches` (each
  `{ name, description, facts }`), sets `working` to "The judge is weighing N approaches.", runs
  `wsh brainstorm judge <path>`, and ends its turn. No `options` or `read` are written yet.
- `mainView` (`brainstormmodel.ts`) returns `"working"` whenever `working` is set, so the pane shows `WorkingMain`
  (`brainstormui.tsx`): one line and a Design button. `locked = working || act.busy` locks the answer controls.
- The judge is its own session (`BrainstormJudgeCommand`, `pkg/wshrpc/wshserver/wshserver_brainstorm.go`). It writes
  one `judge.json` at the end; Arc then sends the agent `brainstorm: judged <path>`, and the agent copies it onto
  `question` and clears `working`.
- Because the agent ended its turn after starting the judge, a line typed during the wait starts a new turn.

## The design

Board: `.superpowers/design/brainstorm-judge-wait/project/Main.dc.html` (the prototype).

### What the judge's wait shows

While the judge runs, the pane shows the question view instead of the bare working note:

- the question's part link and number, its text and its `why`, as on any open question;
- a judge status line ("The judge is weighing 9 approaches", the `working` text) where the options will go;
- the approach list being weighed, headed "What the judge is weighing · N", unranked, in the agent's order: each row
  shows the approach's name and description;
- the answer box, open (not locked), with the placeholder "Or answer now in your own words…".

The Design button behaves as on any open question.

Agent's call: during the wait,

- pushback or "double check" typed in the box reruns the judge (stop the running one, add any alternative named to
  `approaches`, rerun with `--line`); the agent never weighs it itself, though the question has no `judge` yet;
- Guess for me is hidden, since the judge's pick is coming;
- Skip the questions stops the judge, then works as today;
- `working` stays set until the judge's result is copied or the judge is stopped.

Agent's call: a rerun on an already-judged question shows the same view (question, status line, the approach list
with any alternative added, open box); the earlier options are not shown.

### The list during the wait

Each approach row is a button: clicking it sends that approach's `name` as the user's answer, the same way an option
row sends its `label` (`Options`, `brainstormui.tsx`).

Agent's call: a clicked row is recorded like a typed answer: `a` is the approach name, with no `picked` index.

### When the user answers before the judge is done

The answer (typed, or a clicked row) reaches the agent as a normal answer and starts its next turn. When the pane
sends a line during the judge's wait, Arc stops the running judge (builder question 1): only one judge may run per
brainstorm and every result lands at the same `judge.json`, so a judge left running would block the next approach
question's judge. Nothing lands late, and no judge result is kept for a question answered early. Arc already stops a
judge's session internally when one fails (`stopStageSession`, `wshserver_brainstorm.go`); there is no command for
it yet.

Agent's call: a late `brainstorm: judge failed` line for a question already answered is ignored, and a stopped judge
sends no line.

## Build decisions

These settle what the builder check left open (Agent's calls, approved in the Spec review).

### Which wait shows the new view

- The pane is in the judge's wait when the file as the agent wrote it has `working` set and a `question` with a
  non-empty `approaches`, and no line Arc sent is still pending (`BrainstormState.sent`). That covers a first judge and
  a rerun alike, and needs nothing from the tab.
- A pending line takes the wait out of the view. Today `shownFile` (`brainstormmodel.ts`) leaves a file that sets
  `working` itself as it is; it changes so that a file in the judge's wait gets the same pending text as a file with
  no `working`: a sent answer shows "Writing up your answer." with the question hidden, any other line "Taking in
  your change.". The box cannot tell pushback from an answer, so typed pushback shows "Writing up your answer." too,
  as on any question today. When the agent reruns the judge the wait view comes back.
- The rule lives in `brainstormmodel.ts`: `MainView` and `CheckMain` gain `"judging"`, and `mainView` / `checkMain`
  take whether a line is pending (`mainView(f, designOpen, checkPending = false, linePending = false)`,
  `checkMain(f, designOpen, linePending = false)`). `"working"` keeps meaning every other wait. `designUnder`,
  `checkUnder`, `boardBackLabel` and `pickableOptions` treat `"judging"` as they treat `"question"`; the design opened
  over the wait goes back to it with "Back to the question".
- `lineBox` is unchanged: during the wait a question is open, so the design's line box stays `none`.

### The rows

- Each approach row shows its name, its description, and the count of its facts ("2 facts") as in the board; the facts
  themselves are not shown, since the row is the answer button.
- Rows are styled as option rows (`Options`, `brainstormui.tsx`) without pros, cons or a pick marker, and take the
  option letters the same way: the first rows get `a`–`d` (`OPTION_KEYS`), as many as there are keys; the rest are
  clicked only. `pickableOptions` counts them during the wait. The rows carry the option rows' `data-brainstorm-option`
  index, so the letter bindings (`bindings.ts`) focus them as they focus option rows, and those bindings pass whether
  a line is pending to `pickableOptions`.
- A row with an empty description shows its name alone.

### The stop

- A new RPC, `BrainstormJudgeStopCommand(ctx, CommandBrainstormJudgeStopData{BlockId})`, in
  `wshrpctypes_agents.go` beside the judge's. No `wsh` command: only the pane calls it.
- It reads the judge record on the block's tab. When the record is `reading`, it stops the judge's run (the run's
  workers, as `stopStageSession` does) when one is launched, and writes the record as a new state, `stopped`, with
  the stop time; it sends the agent no line. When the record is not `reading` it does nothing and returns no error.
- The judge's watcher (`watchBrainstormSession`) checks the record before each tick and before writing its launched
  run: when the record is no longer its own `reading` (state changed, or a newer `ts`), it exits without delivering,
  failing or writing, and stops a run it launched after the stop. The check and the record write share the kind's
  lock (`sessionKind.mu`), so a stop that lands mid-launch never gets overwritten by `reading`.
- `ResumeBrainstormSessions` leaves a `stopped` record alone; a new judge may start after one (only `reading`
  refuses).
- The pane calls the stop before it sends an answer (typed, or a clicked row) or Skip the questions while the view is
  the judge's wait. Other lines (a confirm or edit from the design) leave the judge running. When the stop fails, the
  line is not sent and the pane shows the error as it shows a send error.
- The frontend accepts `stopped` as a record state (`BuilderCheckRecord`, `CHECK_STATES` in `sessionviewmodel.ts`);
  the agent tree shows a stopped judge as a finished stage row.

### The skill

`skills/brainstorm/SKILL.md` gains a short section on lines that arrive while the judge runs:

- Arc has already stopped the judge when such a line arrives; the agent does not stop it.
- An answer (a typed answer or an approach name from a clicked row) is recorded as any answer: `a` is the text, no
  `picked`, and `options` copied only if the question has them (a rerun's earlier options are not copied).
- Pushback or "double check" reruns the judge with `--line`, as on a judged question, adding any alternative named to
  `approaches`; `working` stays set.
- Skip the questions works as today.
- A `brainstorm: judge failed` line for a question no longer open is ignored.

### Verification

A new scenario in `scripts/cdp/scenarios-brainstorm-judge.mjs`, `brainstorm-judge-wait`, writes a file in the judge's
wait, with a `reading` judge record on the tab, and checks each of these with a screenshot:

- the wait: the question text and `why`, the status line with the `working` text, the "What the judge is weighing · N"
  heading, one row per approach in the agent's order with its facts count, the box open with "Or answer now in your
  own words…", and no Guess for me;
- Design over the wait, and "Back to the question" returning to it;
- a click on a row sends exactly that approach's name (read back from the lines the pane sent), the tab's judge
  record turns `stopped`, and the pane shows "Writing up your answer.";
- a letter key picks its row, skipped with the reason when CDP keys do not reach the WebView;
- a typed line sends that line and shows "Writing up your answer."; Skip the questions sends its line and shows
  "Taking in your change.";
- a stop that fails sends nothing and shows the error;
- the same wait in the builder check's pane (`check` set);
- a file with `working` set and no `approaches` shows the Working view.

The existing `brainstorm-judge-tree` scenario gains a step for a `stopped` judge record: the row stays nested under
the brainstorm and reads `stopped`.

## Left to the builder

- Row markup and spacing within the option rows' styling, matching the board.
- How the scenario reads what the pane sent, within the existing brainstorm kit (`scripts/cdp/scenarios.mjs`).
