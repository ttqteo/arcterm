---
name: cockpit-runs
description: Use when you need to start an arcterm run (quick, or orchestrator from a goal or a plan file), check on or cancel a run, or see what is waiting on the user — via `wsh runs`.
---

# arcterm runs from the command line

`wsh runs` does what the cockpit's + Run launcher and run sheet do. `wsh runs <cmd> --help` has every flag.

- `wsh runs start "<goal>"` or `wsh runs start --plan <plan.md>`: a plan implies an orchestrator run.
  `--effort <id> --chunk <label|n>` attaches it to an initiative chunk (ids from `wsh effort list`).
- `wsh runs list` shows this project's top-level runs; `--tasks` adds the runs that work one task of another.
- `wsh runs show <run-id>` shows status, route, commits, the task digest and the sealed report.
- `wsh runs answer <run-id> '<answers-json>'` answers the run's own pending question (a lead's AskUserQuestion), which `wsh runs show` prints with numbered options.
- `wsh runs cancel <run-id>` cancels a run.
- `wsh runs attention` lists everything waiting on the user, across every project.
- `wsh runs route` prints the lead, workers and reviewer routes a new run here would use, and where each
  comes from. `wsh runs route [--global] --worker-runtime <h> --worker-model <m>` (or `--reviewer-picks`,
  `--same-as-lead`) saves the workers default for this project, or for every project.

Rules:
- Before every `start`, run `wsh runs route` and tell the user the lead and worker models in one line.
  When the workers show "same as lead" from the global default (nothing saved) and the lead model is
  "(harness default model)", the run would put every worker on the harness's default (often the most
  expensive model): ask which worker model to use, pass it as `--worker-runtime`/`--worker-model` (or
  `--reviewer-picks`), and offer to save it with `wsh runs route --global ...` so the next start needs
  no question. When a default is saved, use it without asking.
- A launch can take minutes. If `start` reports no reply, the run may have started anyway:
  `wsh runs list` first, and start it again only when it is not there. A retry is a second full run.
- The project is the git repository you are in; a worktree resolves to its main checkout. It must be
  a project in the cockpit already, otherwise pass `--channel <id>`.
- The lead route is the project's saved route unless you pass `--runtime`/`--model`. Pass one only
  when the user asked for it. With no saved route `start` fails with "no route": ask the user for the
  harness and model (it is their cost to choose), pass what they pick, and suggest saving a route for
  the project in the cockpit so the next start needs none. Without a project route, the lead falls back
  to the harness preference in settings, which can name no model.
- `cancel` stops live workers, so it asks for `--yes` when there are any. Cancel only a run the user
  asked you to stop. A finished run cannot be cancelled.
- Steer one task of a run (asks, approve, retry, merge, message a worker) with `wsh jarvis dag <cmd>
  --channel <id> --runid <run-id>`. A lead spawning a child of its own run uses `wsh jarvis run`.
- Show the user a run with `wsh ui reveal run:<id>`.
