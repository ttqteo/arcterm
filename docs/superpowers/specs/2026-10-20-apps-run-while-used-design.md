# Apps run while used

Date: 2026-10-20. Supersedes, where they disagree, `2026-10-20-held-services-design.md` (the Services chip and
popover, Stop that sticks), `2026-10-20-services-sleep-design.md` (the ten minutes) and `2026-10-20-rail-apps-design.md`
(the stopped card).

## Why

A held service (a tool with a page, `arctools.IsService`) shows in three places that answer one question, "what runs":
its row in the Agent tree, the app bar's Services chip and popover, and the footer's Servers on this machine. None of
them manages the apps you declared, running or not: Pin and Keep running live only in a row's context menu, and a
stopped service keeps a row and its project's folder in the tree for good.

The person wants an app to run only while it is used in arcterm (a few seconds of start each time is fine; for
development they run the server another way), and never to be cut off in the middle of work.

## The model

1. **Opening an app starts it.** A service on screen runs. There is one idle state, `sleeping`; `stopped` goes.
   Stop stops it now, and the next time it shows it starts again: nothing remembers a Stop
   (`Remembered.Stopped` is dropped; an old `services.json` entry with `stopped: true` reads as sleeping).
2. **Leaving it stops it after one minute** (`IdleSleep` 10 min → 1 min), **but never in the middle of work.**
   When the minute is up, the supervisor asks whether the service is busy. Busy, it waits another minute and asks
   again, until it is idle; then it sleeps. A service that comes back on screen meanwhile keeps running.
3. **Busy** is a process in the service's tree that started after its page first answered, and is younger than
   30 minutes. That catches what the server starts to do work (the portfolio dashboard's chat `claude -p`, its
   `node scripts/...` runs) and lets go of a helper it keeps for good (a watcher started late), so a service can never
   stay up forever on a false busy. The tree is the block's job object members on Windows (`jobobject.LiveJobs`, owner
   the service's block; `memusage.Table.Tree` of the block's root when the block has no job) and
   `memusage.Table.Tree` of the block's root elsewhere. The baseline is the time the state turns `running`
   (`StartedMs`); a service with no baseline (it never answered) is never busy. A read that fails counts as idle.
4. **Keep running stays, off by default,** for an app with work of its own on a timer (the portfolio dashboard's
   ~15:05 build-macro). It starts with arcterm and never sleeps, as today. The person turns it on for the portfolio
   entry (their `tools.json`, outside the repo).
5. **The app frame follows the server:** `APP_FRAME_IDLE_MS` 10 min → 1 min, so a page is not kept loaded over a
   server that went to sleep.

## Where things live

- **Setup → Tools manages apps.** Each tool with a page shows its state in words (`serviceRowWords`), and Pin to the
  rail / Unpin (whatever its state; the rail still holds three, `RAIL_FULL_TITLE` when full), Keep running, Stop and
  Restart when it runs, and Open, which takes it to the centre and so starts it.
- **The footer's Servers on this machine shows what runs.** A server held by a service's block reads as the app
  (badge `app · <name>`, a click opens it) instead of `terminal · <tab name>`, and its Stop calls `ServiceStopCommand`:
  killing the process from outside would read as a crash and restart it.
- **The app bar's Services chip and popover go:** `serviceschip.tsx`, `servicespanel.tsx`, `servicespopoverstore.ts`,
  their mounts in `app-bar.tsx` and `cockpit-root.tsx`, the `servicesOpenAtom` closes in `jobqueuestore.ts`,
  `consumersstore.ts`, `machineserverschip.tsx` and the dispatcher (and its test), and what only they use in
  `servicesmodel.ts` (`servicesChip`, `popoverOrder`, `canStartFromPopover`, with their tests). The `services-chip`
  CDP scenario goes with them.
- **The Agent tree lists a service only while it is up or in trouble:** any state but `sleeping`, plus the service
  whose tab is the selected row, so Stop on the row in view does not pull it out from under the pointer. A project
  folder that would hold nothing else is not drawn (`projectTree`'s `services` input is filtered before it).
- **The row's context menu** (`servicemenu.tsx`): Open in the browser, Stop and Restart while it runs, Keep running,
  Pin to the rail, Edit in Setup → Tools. Start goes: showing it starts it.
- **The rail app surface** has no stopped card: a sleeping app shows the waiting card while it starts; the crashed,
  port-taken and no-page cards stay, with Restart.

## Errors and edges

- Stop while busy stops at once: the person asked. Only the idle timer waits on work.
- A service that crashes while off screen is not retried past the minute: `retrying` off screen sleeps as today.
- `elsewhere` (its page answers from a process arcterm did not start) never had a process to sleep and is unchanged.
- The busy read runs once a minute per service off screen, only after its minute is up: no polling while it is shown.

## Testing

- Go (`pkg/services`): the supervisor's sleep tick postpones while `Busy` says true and sleeps once it says false;
  Stop is not remembered (a shown service starts after a Stop when it next shows); the baseline and the 30-minute
  age rule as a pure function over (the tree's processes with their start times, the baseline time, now).
- vitest: the tree's service filter (sleeping hidden, the selected one kept, an emptied folder gone); the footer's
  service badge; the menu and Setup → Tools choices as model functions; `railapps` with no stopped card.
- CDP: `services-tree` (a sleeping service has no row; a running one does), `services-setup` (Pin, Keep running,
  Stop on a tool's page), `machine-servers` (a service's server reads as the app), `services-rail` (opening a sleeping
  pin shows the waiting card), `services-busy` (a service with work in progress outlives its minute, then sleeps).
  Drop `services-chip`.

## Docs

`AGENTS.md`'s service paragraph (one minute, never in the middle of work), the guide's services and nav rail
sections, `CHANGELOG.md` (the existing Added line about pinned apps' servers rewritten; the feature is unreleased),
and the RAM watch rows for held services and pinned apps.
