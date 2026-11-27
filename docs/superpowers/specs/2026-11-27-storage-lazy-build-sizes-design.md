# Storage: size build output when its row opens

Initiative: Session ideas (effort `0ab0fe28-b25a-4769-8c62-c1963dc1aabc`), chunk 17. Decided in a brainstorm on
2026-11-27.

## Why

Settings → Storage's scan walks every `node_modules`, `target`, `dist` and similar build folder in full to size it
(`pkg/storage/buildoutput.go` `measure`, `dirSize` per candidate). The project list is every configured project plus
each repo an agent worked in (177 folders under `~/.claude/projects` on this machine). In 26 logged scans
(2026-11-02 to 11-26), build output took 6m26s to 2h17m in 24 of them (median about 15 min on a loaded machine) and
9-10 s in the two idle ones. Every other category took 0.1-14 s, and the package caches 25-60 s when loaded. The
`settings-storage` Final step waits 180 s for a scan and fails (open-issues "Storage's scan takes minutes").

The scan stops walking build folders. It still lists them (which folders, which project, when an agent last worked
there). A project's folders are sized when its row opens, or by a Size all button. This fixes the real app's wait, not
only the Final's.

## Design

### What the scan does

The build-output provider keeps everything except `dirSize`: `buildProjects`, `buildCandidates`, `gitIgnored`,
`hasTrackedFiles`, `busyReason` are unchanged. Each listed folder's `Bytes` comes from the kept sizes (below), 0 when it
was never sized. The other categories are unchanged.

### Kept sizes

Each build folder keeps the size it had when last sized, and when. They live in `<data>/storage/buildsizes.json`:
folder path → `{ bytes, ts }` (unix ms). The file survives a restart. A scan reads it to fill each listed folder's
`Bytes` and a new `StorageItem.SizedTs` (unix ms, 0 = never sized). It drops entries for folders it no longer lists.

### What the totals count

The head's used and cleanable totals (`usedTotal`, `cleanableTotal`), the daily nudge (`shouldNudge`,
`storage:nudgegb`) and the Tray's storage row (`traysnapshot.ts`) add the kept sizes, as they add `Bytes` today. A
folder never sized counts 0 until it is sized. None of these readers changes its code; only where `Bytes` comes from
changes.

### What sizes a project's folders

Two things size build output, and nothing else:

- **Opening a project's row** in the Build output card sizes that project's folders. It walks them only when one of
  them was never sized or was sized more than 24 hours ago. A size from the last day is shown as is.
- **A Size all button** on the Build output card sizes every listed project, one at a time, the oldest size (or never
  sized) first. It always walks, whatever the sizes' age.

The scan itself never walks a build folder.

### How a row looks

- A project row whose folders were never sized shows `not sized` in muted text where the size goes.
- While its folders are being walked the row shows a small spinner beside its kept size (or beside `not sized`). The
  number changes when the walk lands.
- A row whose size is over a day old adds `sized N days ago` to its detail line, after the last-used text.
- The Build output card gets a Size all button in its action slot (it has none today, `CARD_COPY.buildoutput.action`
  is `null`). Agent's call: while it runs the button reads `Stop sizing (3 of 12)`. Stop lets the walk in progress
  finish and drops the rest of the queue, row-open asks included.
- Folder rows inside an open project show their own kept sizes the same way.
- The project order is unchanged: last used, then size (`buildProjectRows`), so an unsized project sorts as 0 bytes
  among its peers.

Motion follows `DESIGN.md`: the spinner and the number change follow the card's existing row conventions
(`Loader2`, `motion-reduce:animate-none`).

### Backend

- New field `StorageItem.SizedTs int64 \`json:"sizedts,omitempty"\``. `task generate` after the change.
- One new wshrpc command sizes build output. It takes a list of projects and a force flag. Without force it skips
  folders sized in the last 24 h. It runs in the background on the `Scanner`, one project at a time. After each
  project it saves `buildsizes.json` and publishes the report through `Scanner.landed`, so the card updates per
  project. An ask for a project already being walked joins that walk; it never starts a second one.
- Agent's call: what is being sized lives in the backend. `StorageReport.Sizing` carries the projects queued or
  being walked, the one walking now, and done / total for the current Size all. It is published with the report, so
  the row spinner and Size all's progress survive leaving Settings (the surface unmounts), a reload or a second
  window, and a second Size all press never queues the list twice. The scenario's "spinner gone" reads it.
- Agent's call: the queue is ordered. A row open moves its project to the front of a running Size all, behind the
  walk in progress. A stop command (the Stop sizing button) lets the walk in progress finish and empties the queue.
- Row open calls it with that one project and no force. Size all calls it with an empty project list and force; the
  server reads an empty list as every listed project, ordered oldest size first (Builder's call 3).
- **CLI** (builder question 2): a new `wsh storage size [project...] [--force] [--wait]` calls the same sizing
  command. With no projects it sizes every listed project, oldest first, like Size all. `--force` walks fresh sizes
  too. `--wait` blocks until the queue is done and prints the sizes. `wsh storage report` prints `not sized` or
  `sized N days ago` beside each build-output item. `skills/runs/SKILL.md` (the Storage part, lines 122-131) tells
  agents to run `wsh storage size --wait` before judging build output.
- Clean still measures a folder right before removing it, for `Reclaimed`, and drops its entry from the kept sizes.
  `Scanner.Clean`'s re-measure of the category is now cheap.
- Build output stays out of auto-clean (`clean` refuses `opts.Auto`).

### Verifying

`settings-storage` (`scripts/cdp/scenarios.mjs`): the scan no longer walks build folders, so the scan wait covers
listing, git check-ignore and the other categories only. The scenario's fixture project gets a small git-ignored build
folder and checks:

1. After a scan its row says `not sized`.
2. Opening the row sizes it: bytes > 0, spinner gone.
3. A kept size dated two days back (written to the sizes file, or through a test hook) is walked again on open; a
   fresh one is not.
4. Size all sizes every listed project, and the head's total includes them.

Go tests in `pkg/storage` cover the kept-size file (read, drop of unlisted folders, 24 h skip, force), and the sizing
command's join of a running walk. `storagemodel.test.ts` covers the `not sized` and `sized N days ago` text and the
Size all label.

The package caches can still take over a minute on a loaded machine. That stays as it is and is noted in the
open-issues row, which this change otherwise closes.

### Docs

- `CHANGELOG.md`, Changed: Settings → Storage lists build output at once and sizes a project when you open its row, or
  all of them with Size all.
- `docs/open-issues.md` "Storage's scan takes minutes": rewritten to what is left (package caches when loaded).

## Builder's calls

Made by the run's lead on 2026-11-27, with nobody at the cockpit. Tasks cite them by number.

1. **Wire shapes.** `StorageItem.SizedTs int64 \`json:"sizedts,omitempty"\``. `StorageReport.Sizing *StorageSizing
   \`json:"sizing,omitempty"\``, nil when nothing is queued or walking; `StorageSizing{ Queued []string
   \`json:"queued"\`; Walking string \`json:"walking,omitempty"\`; Done int \`json:"done"\`; Total int \`json:"total"\` }`.
   `Queued` holds project paths waiting, not the one walking. `Done` / `Total` count projects since the queue was last
   idle (a row open joining a running Size all adds 1 to `Total`); both reset when the queue empties. Why: one shape the
   card, the CLI and the scenario read, carried by the report every `storage:scan` event already publishes.
2. **Two commands, not one with a flag.** `SizeBuildOutputCommand(ctx, CommandSizeBuildOutputData{Projects []string
   \`json:"projects,omitempty"\`; Force bool \`json:"force,omitempty"\`}) error` (rpc `sizebuildoutput`) and
   `StopSizingBuildOutputCommand(ctx) error` (rpc `stopsizingbuildoutput`). Both return at once; the walk is the
   Scanner's goroutine. Why: start and stop take different inputs, and a stop needs no project list.
3. **Empty `Projects` means every listed project, oldest first**, computed on the server from the last report's build
   output items: a project's age is the oldest `SizedTs` of its folders (0, never sized, is oldest); ties keep the
   report's order. Size all and `wsh storage size` with no arguments both send an empty list. Why: one place orders the
   list, so the card and the CLI cannot disagree.
4. **A project the last report does not list is refused**: the command returns an error naming it and queues the rest.
   Sizing walks the folders the last report lists for that project (items whose `Detail` is the project), not a fresh
   `buildCandidates`. Why: the scan is what decides what is build output; sizing only measures it.
5. **Queue order.** An ask without force goes to the front of the queue (behind the walk in progress), keeping its own
   order; an ask with force goes to the back. A project already queued is not queued twice: a non-force ask moves it to
   the front, and a force ask on it makes it force. A project being walked now is joined: nothing is queued. Why: row
   open is the only non-force caller in the app and must jump a running Size all; this needs no extra "front" field.
6. **Skip rule.** Without force, a folder whose kept `ts` is within 24 h of `Env.Now()` is not walked; a project all of
   whose folders are fresh leaves the queue without walking and still counts in `Done`; it publishes only when that
   changes `Sizing` (above all when the queue empties and `Sizing` goes nil, else the card's Stop sizing stays stuck).
   With force every folder is walked.
7. **The kept-size file** is `<Env.DataDir>/storage/buildsizes.json`, a JSON object: folder path (the item's `ID`) →
   `{"bytes": n, "ts": unix ms}`. It is read from disk on every scan and every walk and written after each project, under
   one package mutex, written through a temp file and rename. Why: it is small (a few hundred entries), and reading it
   each time lets an outside writer (the scenario's stale entry) be seen at the next scan or walk with no test hook. A
   missing file is empty; an unreadable or corrupt one is logged and read as empty (never a failed scan). An empty
   `Env.DataDir` means no kept sizes: nothing is read or written (the package's tests build `Env`s without one). The
   file is written only when its content changed. The Scanner's sizing state works as a zero value (tests build
   `&Scanner{...}` literals).
8. **A full scan drops entries for folders it no longer lists** and writes the file back. A clean drops the removed
   folder's entry.
9. **A scan never undoes a walk.** When the Scanner stores a build output category (a scan's `landed` or its end), it
   re-reads the kept sizes and refills each item's `Bytes` / `SizedTs` from them, so a walk that landed while the scan
   ran is not overwritten by the scan's older read. The category's totals are rebuilt with `report()`.
10. **The row spinner shows for the project being walked only** (`Sizing.Walking`), not for every queued project: a Size
    all over 177 projects would otherwise spin every row.
11. **Partly sized project.** A project row shows `not sized` only when none of its folders has a size; otherwise it
    shows the sum of the kept sizes. `sized N days ago` uses the oldest kept `ts` among its sized folders, and shows
    only when that is a day or more old. A folder row shows `not sized` when its own `SizedTs` is 0.
12. **The Size all button** is its own button in the card head (`data-storage-sizeall`), not `CARD_COPY.action`:
    `action` stays `null`, since it means the card's clean button (the Tray and step 1 of `settings-storage` read it
    that way). Label: `Size all`; while `Sizing` is set, `Stop sizing (N of M)` with N = `Done + 1` capped at `Total`,
    M = `Total`. It is disabled before the first scan.
13. **Row open asks once per open**: expanding a project row sends `sizebuildoutput {projects:[p]}` (no force); the
    server's 24 h rule decides whether anything walks. A failed ask is a toast, not a silent drop.
14. **DOM hooks for the scenario:** a project or folder row that shows `not sized` has `data-storage-unsized`; the
    project row being walked has `data-storage-sizing`; the Size all button carries `data-storage-busy` while `Sizing`
    is set. The size cell keeps its place (`w-[64px]`), the spinner sits beside it.
15. **Scenario's Size all check is deterministic on a real machine.** The Final's app lists every repo an agent worked
    in, and walking them all can take many minutes under load. Step "Size all" backs up the sizes file, writes every
    other listed folder as sized now (keeping its bytes, 0 when it had none) and the fixture's `node_modules` with
    bytes 0 and a ts two days old, rescans, presses Size all, waits for the fixture project (first in the oldest-first
    order) to be walked and the head's total to grow by its bytes, then presses Stop sizing and waits for `sizing` to
    clear. Stop lets the walk in progress finish (the next real repo, minutes under load), so that wait is long and
    `ARC_STORAGE_SCAN_WAIT_S` raises it, as it does the scan wait. Teardown puts the file back. The Go tests cover
    walking every project.
17. **The build output confirm** (`confirmFor`) leaves the size out when none of the project's folders was sized, and
    otherwise shows the kept sum, as the row does: a never-sized project would read "(0 KB)". `Reclaimed` in the toast
    is the clean's own measure.
16. **`wsh storage size` output.** Without `--wait` it prints what was queued. With `--wait` it polls `getstorage` until
    `sizing` is nil and prints each build output project with its size, `not sized` or `sized N days ago`. `report`
    prints `not sized` / `sized N days ago` after the item's label for build output items.

### Added in fix round 1 (the Final's step 0 still timed out)

The round-1 Final failed `settings-storage` step 0 again ("the scan of the fixtures was still running after 181 s"),
with no "storage scan took" line in the dev app's log. Measured on the same machine right after (loaded: wavesrv logged
`[paging] critical`, commit 46 GB on 31.8 GB RAM), `TestStorageMeasure` full: **3m37s**, of which build output's
listing alone (no walk) **1m23s** and the package caches (9 caches, 59 GB) **2m14s**; every other category under 0.1 s.
The 2-minute auto-clean starts a scan, and the scenario's rescan then waits for it and a second one.

18. **The scan never waits on the package caches.** A scan started by `Rescan` hands the package caches to one
    background walk (none starts while one runs) and ends without them: `Scanning` goes false and `ScannedTs` is set
    when the other categories are measured. The walk measures its caches concurrently, lands its category through
    `landed` when it ends, and logs its own time. Until a first walk lands the report has no `packagecaches` category,
    and the card shows `…` as it does before any scan (no UI change; the caches are left out of the head's totals,
    the nudge and the Tray already). A walk that lands while a scan runs is not undone by that scan's end. `ScanNow`
    (tests, the measure test) still measures them inline. The `wsh storage` report prints what the report holds.
19. **Build output is listed in parallel.** `buildProjects`' `repoTop` calls and each project's
    `buildCandidates` / `gitIgnored` / `hasTrackedFiles` run on a bounded pool (8), and the results are merged in
    the sequential order, so the projects, items, their order and the "listed once, under the first" rule are as
    before.
20. **The scenario's scan waits** (`ssWaitScan`, 60 s) take `ssWaitSecs(180)` like `ssRescanAndWait`, and step 7b waits
    for the `packagecaches` category to land (up to `ssWaitSecs(600)`) before it reads the card.
