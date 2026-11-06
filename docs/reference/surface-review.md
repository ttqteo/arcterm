# Surface review on real data

A review pass uses one area of the app on a copy of the packaged arcterm's store and reads the code behind it, to
find what fixtures and code reading alone miss: a label that is wrong for the user's real projects, a state a
fixture never reaches, a count that means nothing once there are hundreds of rows.

## The snapshot app

```
task dev:snapshot            # node scripts/cdp/snapshot-dev.mjs
task dev:snapshot -- --dry-run
```

Each start makes a fresh copy under `%LOCALAPPDATA%\arc-snap` and runs `task dev` on it, on the main dev
app's ports (CDP `:9222`, Vite `:5174`); it refuses while another dev app holds them. Ctrl-C stops it.
`--dry-run` prints what a start would copy, the ports it checks and whether it would refuse, and copies nothing.
Only Windows is supported: elsewhere the script says so and exits 3.

| Copied from `%LOCALAPPDATA%\dev.arc.app` | How |
|---|---|
| `data/db/waveterm.db`, `filestore.db` | `VACUUM INTO`, a consistent read while arcterm writes |
| `data/jarvis`, `data/memhygiene` | copied |
| `config/` | copied; `memory:vaultpath` points at the vault copy |
| the vault | copied without `.git`, so nothing commits or pushes. It is the setting's path, else `~/.waveterm/vault` |

Not copied: the WebView2 profile (a fresh one under the copy), the other files in `data/` (the run queue, the
services list, the learn and council state, the Claude account list), and `~/.claude`, whose transcripts
conversation history and the usage tally read live.

`ARC_SNAPSHOT=1` makes wavesrv (`pkg/wavebase` `IsSnapshot`):

- skip the boot work that reaches outside the copy: cleanup-debt retry, the Telegram bot's loop, vault sync, the
  harness update check, interrupted-scan recovery, trash purge, the Storage scan and auto-clean, the worktree and
  canvas-feedback sweeps, run resume (`MarkInterruptedRuns`, `ResumeInterruptedLeads`, `ResumeAtBoot`), brainstorm
  resume, the watchdog and the RAM regulator, pinned apps' servers, the agent sleep loop, the loose-end and
  memory-hygiene sweeps, the council runner and the run queue. The list is `snapshotBootSkips` in
  `cmd/server/main-server.go`, and the app logs it at boot;
- start a block's process only when its cwd is inside `arc-snap\scratch` (`pkg/blockcontroller`): every other
  cwd in the copy is a real checkout. This also stops the boot's `RestoreLiveAgents` from relaunching a real one;
- run with `ARC_DEV_NO_GLOBAL_INSTALL=1`, which the script sets too: agent sync reads the harness dirs under `~` but
  writes none, skill adoption refuses to apply, the vault is the copy's, and the host installs no global agent hooks.

A refused process start is logged in `arc-snap\data\waveapp.log` (`snapshot store: not starting a process`) and
shows as failed to start with the reason: in the Agent header and tree row, and as a red line in the terminal.

What still runs, because it stays inside the copy or only reads: the boot's settings, profile and effort migrations
(they write the vault copy), the usage tally (reads `~/.claude` transcripts, writes the copy's database), the
job queue, the sleep and machine watches, the kept-apps watcher, the keep-awake check (it holds the machine awake
only while an agent, run or heavy job works, and a snapshot has none until the pass launches one), and the stale
temp-attachment sweep (it removes only what the packaged app's own sweep removes by age).

Not guarded: actions that call a model directly (a run's judge, a consult, a brainstorm judge) spend tokens,
and agents launched in the snapshot write their transcripts to the real `~/.claude/projects`. With the watchdog
off, runs stay frozen as they were copied, so a review sees a run's state but not its progress.

## What a snapshot cannot show

- **The user's live agents.** They are processes in the packaged arcterm, so the roster starts empty: the Cockpit,
  jump and every live-agent state come only from agents the pass launches itself.
- **Live runs.** No copied run has a lead or workers. A run's workers get worktrees outside `scratch`, which
  the guard refuses, so run cards are reviewed from the code unless a run can be made to work in the scratch
  project (untested).

## A pass

One agent per area, on a fresh snapshot. A pass is a fan-out, so say what it will cost before starting more than
one (`AGENTS.md`, "Say what a fan-out will cost"). The areas are the surfaces in `SURFACE_ORDER`
(`frontend/app/view/agents/agents.tsx`), the Agent surface's centre modes (Conversation History, an ended
session's transcript) and Setup.

1. **List every feature from the code**, not from the screen: the area's bindings in
   `frontend/app/store/keybindings/bindings.ts`, every button, menu and context menu in its components, the
   states its model can be in, and its scenarios in `scripts/cdp/scenarios.mjs` and the `scenarios-*.mjs` beside it.
2. **Use each feature over CDP on the real data** (`scripts/cdp/attach.mjs`: `goto`, `ev`, `rpc`, `shot`),
   and ask of each:
   - Does it show something without helping act on it?
   - Did using it mean going elsewhere or remembering something?
   - Is a label, count or number wrong, or meaningless to the user?
   - Does it look right by `DESIGN.md`? Check colors against the `@theme` tokens (a raw color opts out of
     every theme), spacing rhythm, alignment, hierarchy, and consistency with sibling surfaces. Check clipping,
     overlap and wrapping at both 1000x700 and 1600x950. A finding of this kind is `visual` and needs a
     screenshot; name the token or `DESIGN.md` rule it breaks.
3. **Read each feature's code** and report:
   - bugs and unhandled states;
   - states the code handles that no UI reaches;
   - features the UI offers that the code half-supports;
   - places where the UI and the code disagree.

   A usage finding with a cause in the code names the `file:line`.
4. **Stay inside the copy.**
   - Launch agents only through the app's New agent flow, with a cwd under `arc-snap\scratch` (a throwaway git
     repo there, registered as a project in the copy), on Haiku or Sonnet, at most 3.
   - The first launch in a new scratch folder stops at Claude's folder-trust prompt, which only its terminal
     can answer.
   - Never send to an agent the pass did not launch, and close the ones it did before reporting.
   - Never use `wsh` from the reviewer's shell: it talks to the packaged arcterm, not the snapshot.
   - Run no CDP scenario that writes fixtures outside the copy: several write transcripts under
     `~/.claude/projects` (search `scripts/cdp/scenarios*.mjs` for `".claude", "projects"`).
   - The app is one window: two reviewers cannot drive it at once. A second pass can do steps 1 and 3 while
     the first drives it.

## The report

Written to `cdp-shots/review/<area>/report.md`, with its screenshots beside it (the folder is gitignored). A
subagent cannot write the report file, so it returns the report as text and the session that dispatched it saves
it. The report has:

- **Features:** every feature from step 1, each marked tried, or skipped with the reason.
- **Findings:** F1…Fn, each with the question it fails or the code defect, what was seen (a screenshot or the
  code), the cause's `file:line` when known, and a suggested fix.

The user picks which findings to fix; a spec follows (`docs/superpowers/specs/`), and the fixes land in one commit
per area, each with a CDP scenario. A declined or deferred finding goes to `docs/deferred.md`.
