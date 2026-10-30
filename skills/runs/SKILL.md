---
name: runs
description: Use when you need to start an arcterm run (quick, or orchestrator from a goal or a plan file), check on or cancel a run, or see what is waiting on the user — via `wsh runs`; or message a live agent tab, read its answer, or wait until it stops working — via `wsh agents`; or clean up what arcterm and its runs left on disk (run trees, old sessions, logs, build output) — via `wsh storage`.
---

# arcterm runs from the command line

`wsh runs` does what the cockpit's + Run launcher and run sheet do. `wsh runs <cmd> --help` has every flag.

- `wsh runs start "<goal>"` or `wsh runs start --plan <plan.md>`: a plan implies an orchestrator run.
  `--effort <id> --chunk <label|n>` attaches it to an initiative chunk (ids from `wsh effort list`).
- `wsh runs start --plan <plan.md> --queue [--after <id>]` queues the start instead of making it: arcterm starts the
  run when fewer than `runs:maxactive` top-level runs are active (3 unless set; 0 is no cap). `--after` takes a run id
  or a queue id (a unique prefix of either), also waits for that run to land, and implies `--queue`. It prints
  `queued q-3f2a (#2 in line) — …`.
- `wsh runs start-now <q-id>` starts a queued entry now, past the cap and past its `--after`. `wsh runs run-next <q-id>`
  moves it to the head of the queue, where it still waits for room and for its `--after`. `wsh runs dequeue <q-id>`
  removes it without starting it.
- `wsh runs list` shows this project's top-level runs, queued entries first (`queued #N`, `after <id>` or
  `blocked: <reason>`); `--tasks` adds the runs that work one task of another, `--all` every project. `--json` prints
  `{"queued": [...], "runs": [...]}`, not a bare array.
- `wsh runs show <run-id>` shows status, route, commits, the task digest and the sealed report.
- `wsh runs answer <run-id> '<answers-json>'` answers the run's own pending question (a lead's AskUserQuestion), which `wsh runs show` prints with numbered options.
- `wsh runs cancel <run-id>` cancels a run.
- `wsh runs attention` lists everything waiting on the user, across every project.
- `wsh runs route` prints the lead, workers and reviewer routes a new run here would use, and where each
  comes from. `wsh runs route [--global] --worker-runtime <h> --worker-model <m>` (or `--reviewer-picks`,
  `--same-as-lead`) saves the workers default for this project, or for every project.

Message a live agent (claude or pi) with `wsh agents`:

- `wsh agents list` shows the live agent tabs, with a tab prefix, each one's state, the folder it works in
  when that is not the project's checkout (a worktree), and its task title. `(you)` marks your own tab.
  Rows of one project can share a name: pick the target by folder and title, never by name alone.
- `wsh agents send <tab> "<text>"` hands the agent a prompt; `--file <path>` reads the text from a file, `--wait` blocks until it has answered.
- `wsh agents read <tab>` prints the agent's last answer.
- `wsh agents wait <tab>` blocks until the agent stops working (its turn ends, it asks the user, it sleeps or its tab
  closes). To carry on once another agent is done, run it as a background command instead of writing a polling loop:
  you are told when it ends, and the cockpit nests your row under that agent.

Rules:
- Before every `start`, run `wsh runs route` and tell the user the lead and worker models in one line.
  When the workers show "same as lead" from the global default (nothing saved) and the lead model is
  "(harness default model)", the run would put every worker on the harness's default (often the most
  expensive model): ask which worker model to use, pass it as `--worker-runtime`/`--worker-model` (or
  `--reviewer-picks`), and offer to save it with `wsh runs route --global ...` so the next start needs
  no question. When a default is saved, use it without asking.
- A launch can take minutes. If `start` reports no reply, the run may have started anyway:
  `wsh runs list` first, and start it again only when it is not there. A retry is a second full run.
- The project is the git repository you are in; a worktree resolves to its main checkout's project. It must
  be a project in the cockpit already, otherwise pass `--channel <id>`.
- Started from a linked worktree, the run works in that worktree: it branches from your branch's head and
  lands back into your branch, never the main checkout. Commit first (uncommitted work is not in the base),
  and leave the files the run changes alone until it lands: the land holds on edits to them. `--channel`
  turns this off.
- The lead route is the project's saved route unless you pass `--runtime`/`--model`. Pass one only
  when the user asked for it. With no saved route `start` fails with "no route": ask the user for the
  harness and model (it is their cost to choose), pass what they pick, and suggest saving a route for
  the project in the cockpit so the next start needs none. Without a project route, the lead falls back
  to the harness preference in settings, which can name no model.
- A queued start reads the plan and takes the base commit when it starts, not when it is queued: the plan file must
  still be there then (a missing one blocks the entry), and an edit to it meanwhile is what runs. The route is the
  exception: it is fixed when you queue, so the models you told the user about at `wsh runs route` are the ones that
  run. Queue when the user picked the queued engine choice at the handoff (it is the recommended one when
  `wsh runs list --all` shows `runs:maxactive` runs active or more); chain with `--after` a plan that touches the same
  files as another run.
- A queued entry is blocked, and stays so, when its `--after` run was cancelled or its land is held (not a dirty
  checkout, which lands by itself), its `--after` entry was removed, its plan file is gone, or its start failed
  (`blocked: <reason>`). It is also a Needs you item. `run-next` makes it wait again, but while the cause remains
  (the `--after` run is still held) the next pass blocks it again: `start-now` or `dequeue` is the way on.
- `start-now` starts one entry at a time and can take minutes. "another queued run is starting; try again in a moment"
  is not the entry failing: it is not blocked, so wait and run it again. A start that does fail blocks the entry with
  the error as its reason. As with `start`, a reply that never comes may still be a run that started: `wsh runs list`
  first.
- A run started from this session sends the session one message when it lands (`[arc] Run <id> "<goal>" landed: …`) or
  is held (`… held: <reason>`), unless `runs:wakeorigin` is false in settings (unset is true). It arrives while the
  session is idle or waiting, once per run, and not when the run was cancelled or the session is closed. It asks for a
  review of the result as the session that wrote the plan: do that, report to the user in a few lines, and do not start
  another run.
- `cancel` stops live workers, so it asks for `--yes` when there are any. Cancel only a run the user
  asked you to stop. A finished run cannot be cancelled.
- Steer one task of a run (asks, approve, retry, merge, message a worker) with `wsh jarvis dag <cmd>
  --channel <id> --runid <run-id>`. A lead spawning a child of its own run uses `wsh jarvis run`.
- For follow-up work on something a finished run did, look for that run's agent in `wsh agents list`
  first. When its tab is live, send it the follow-up and read the answer; start a new run only when
  no live agent holds that context. The target answers in its own turn and the sender reads it, so a
  target does not send a message back.
- Starting a run does not call for showing it: the user sees it in the cockpit already, and a reveal
  takes them off the surface they are working on. Run `wsh ui reveal run:<id>` only when the user asks
  to see the run.

Clean up what arcterm and its runs left on disk with `wsh storage` (the Settings > Storage section):

- `wsh storage scan --wait` scans afresh and prints the report; `wsh storage report` prints the last scan
  (`--json` for the full report). It lists each category (`runworktrees`, `sessions`, `housekeeping`,
  `buildoutput`, `canvases`, `packagecaches`) with every item's id, size and whether clean takes it.
- `wsh storage clean <category> --all`, or `clean <category> <id...>`, removes the items marked cleanable:
  they lose nothing, and each is re-checked right before it goes.
- A guarded item (a run tree with uncommitted changes, or one whose run is not in this app's store) is
  skipped by clean. Look at what it holds (`git -C <tree> status`, `git log`), then show the user the item
  and what you found, and ask. Only for an item the user approved, run `wsh storage delete <category> <id>`.
  What it held is gone afterwards.
