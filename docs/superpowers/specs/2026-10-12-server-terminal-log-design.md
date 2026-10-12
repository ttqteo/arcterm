# A server's log when it runs in an arcterm terminal — design

Status: designed 2026-10-12.

## Problem

The details rail's Servers section offers Log only for a server this agent started as a background task
(`matchLogTask`, `frontend/app/view/agents/devserversmodel.ts`). Every other row reads `already running` with no way
to see its output, even when the server runs in one of arcterm's own terminals, whose output wavesrv holds. On
2026-10-12 the portal agent's `:4310` and `:8100` both read `already running` and the person could not read either
log from the rail.

A process's stdout cannot be attached to after it starts, so a server outside arcterm (another terminal app, a
detached background command) stays without a log. A server inside an arcterm terminal can show it: the terminal is
the log, live and in colour.

## Goals

- A rail row says which terminal holds its server, and offers Log for it.
- Log opens that terminal and its search box, so the person can look through the output at once.
- The footer's Servers popover offers the same Log on its `terminal · …` rows.

Out of scope: filtering lines (a grep-style log viewer over the `term` blockfile, kept for later if search is not
enough); a log for detached or app-held servers; a keybinding for terminal search (Ctrl+F is readline's
forward-char in a shell); prefilling the search.

## Decisions

1. **The rail learns the owner.** `devservers.Select` takes `holders map[int32]ServerOwner` and, for a row that is not
   `byAgent`, calls `OwnerOf(pid, procs, alive, holders)` with `alive` meaning the pid is in `procs`. It sets
   `Server.Owner` only when the result is `terminal`: an agent's own rows already carry `byAgent`, and the rail has
   no use for `app` or `detached`. `List(ctx, cwd, blockId, holders)` passes it through. `ListDevServersCommand`
   reads `machineHolders(ctx)` first; on an error it logs and passes nil, as `ListAllDevServersCommand` does, and
   the rail lists as before without Log. `Server.Owner` already exists (shared with `ListAll`), so the wire types do
   not change and `task generate` is not needed.

2. **The row's second line.** `ownerLabel(row)` reads `this agent`, `terminal · <tab name>` (`Terminal` when the tab
   has no name), or `already running`.

3. **Log on a terminal row.** `terminalLog(row)` in `devserversmodel.ts` returns `{tabId, blockId}` for a row whose
   owner is a terminal, else null; `machineservers.ts` sets the same `termLog` on its terminal-badge rows. Both
   `railservers.tsx` and `machineserverspanel.tsx` show Log beside Copy and Stop when it is set, calling one
   `openTerminalLog(model, {tabId, blockId})`. The background-task Log is unchanged; a row never has both.

4. **Opening the search from outside the pane.** The terminal search UI (`useSearch` and xterm's SearchAddon in
   `frontend/app/view/term/term.tsx`) still exists but nothing has opened it since the Electron teardown
   (`968de6991`). `CockpitFocusPane` builds its view model in a `useMemo` (`frontend/app/cockpit/focus-pane.tsx`),
   so there is no registry to reach it by block id. A new `frontend/app/view/term/termsearch.ts` holds
   `pendingTermSearchAtom: atom<string | null>`, a block id. `openTerminalLog` calls
   `openTarget(model, {kind: "agent", tabId})` and then sets the atom. An effect in `term.tsx` watches it: when it
   names the view's own block, it sets `searchAtoms.isOpen` true, bumps `focusInput`, and clears the atom. A pane
   that `panemounts.ts` mounts only when it first shows still takes the request, since the atom holds it until a
   pane does.

5. **The search box in the cockpit.** It has not rendered under Tauri; if its floating position (anchored to the
   view) or its style is off in the cockpit pane, fix it to DESIGN.md tokens as part of this work.

## Testing

- `go test ./pkg/devservers`: a listener whose parent is a terminal block's shell gets `Owner.Kind == "terminal"`
  with its block, tab and name; one that descends from the agent stays `ByAgent` with no owner; a broken chain or
  one that reaches a session root has no owner.
- vitest: `devserversmodel.test.ts` (`ownerLabel`, `terminalLog`) and `machineservers.test.ts` (`termLog` on terminal
  rows only).
- CDP: `machine-servers` already has a terminal-owned `vite` fixture (`scripts/cdp/scenarios.mjs`); add a step that
  clicks its Log and asserts the terminal is in focus with its search box open and focused. `rail-servers` gains a
  server run in a terminal block, whose row reads `terminal · <name>` and whose Log does the same.
