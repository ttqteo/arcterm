# A server's log when it runs in an arcterm terminal — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A Servers row (details rail and footer popover) whose server runs in an arcterm terminal says which
terminal, and its Log opens that terminal with its search box open and focused.

**Architecture:** `devservers.Select` reuses `OwnerOf` with the arcterm blocks' shell pids (`machineHolders`), so a
rail row carries `owner: terminal` the way `ListAll` rows already do; the wire type does not change. The frontend
derives `terminalLog(row)`, and Log calls `openTarget` on the terminal's tab and then sets a pending-search atom that
the terminal's `TerminalView` takes, opening the xterm search box it already renders.

**Tech Stack:** Go (`pkg/devservers`, `pkg/wshrpc/wshserver`), React 19 + jotai (`frontend/app/view/agents`,
`frontend/app/view/term`), vitest, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-12-server-terminal-log-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/devservers/... ./pkg/wshrpc/wshserver/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: machine-servers and rail-servers need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs machine-servers rail-servers`

---

### Task 1: The rail's servers carry their terminal owner

**Depends on:** none

**Files:** `pkg/devservers/devservers.go`, `pkg/devservers/devservers_os.go`, `pkg/wshrpc/wshserver/wshserver_devservers.go`, `pkg/devservers/devservers_test.go`

**Step 1: Write the failing tests.** Append to `pkg/devservers/devservers_test.go`:

```go
func TestSelectNamesTheTerminalThatHoldsIt(t *testing.T) {
	procs := procMap(
		Proc{Pid: 1, Ppid: 0, Name: "explorer.exe"},
		Proc{Pid: 50, Ppid: 1, Name: "wavesrv.x64.exe"},
		Proc{Pid: 60, Ppid: 50, Name: "pwsh.exe", Cmdline: "pwsh"},
		Proc{Pid: 70, Ppid: 60, Name: "python.exe", Cmdline: "uvicorn app.main:app --port 8100", Cwd: `D:\w\portal`},
	)
	term := ServerOwner{Kind: OwnerTerminal, BlockId: "blk-t", TabId: "tab-t", Name: "api"}
	got := Select(`D:\w\portal`, 0, procs, []Listener{{Pid: 70, Port: 8100}}, map[int32]ServerOwner{60: term})
	if len(got) != 1 || got[0].Owner == nil || *got[0].Owner != term {
		t.Fatalf("got %+v, want the terminal as owner", got)
	}
}

func TestSelectOwnerOnlyForATerminal(t *testing.T) {
	procs := procMap(
		Proc{Pid: 1, Ppid: 0, Name: "explorer.exe"},
		Proc{Pid: 10, Ppid: 5, Name: "claude.exe"},
		Proc{Pid: 5, Ppid: 1, Name: "pwsh.exe"},
		Proc{Pid: 20, Ppid: 10, Name: "node.exe", Cmdline: "node a.js", Cwd: `D:\w\site`},
		Proc{Pid: 30, Ppid: 1, Name: "node.exe", Cmdline: "node b.js", Cwd: `D:\w\site`},
		Proc{Pid: 40, Ppid: 999, Name: "node.exe", Cmdline: "node c.js", Cwd: `D:\w\site`},
	)
	holders := map[int32]ServerOwner{5: {Kind: OwnerAgent, BlockId: "blk-a", TabId: "tab-a"}}
	got := Select(`D:\w\site`, 10, procs, []Listener{{Pid: 20, Port: 1}, {Pid: 30, Port: 2}, {Pid: 40, Port: 3}}, holders)
	if len(got) != 3 {
		t.Fatalf("got %+v, want three rows", got)
	}
	for _, s := range got {
		if s.Owner != nil {
			t.Fatalf("pid %d: owner %+v, want none (by-agent, an app, a broken chain)", s.Pid, *s.Owner)
		}
	}
	if !got[0].ByAgent {
		t.Fatalf("pid 20 descends from the agent: %+v", got[0])
	}
}
```

**Step 2: Run them and see them fail to compile** (Select takes four arguments today):
`go test ./pkg/devservers -run 'TestSelectNamesTheTerminalThatHoldsIt|TestSelectOwnerOnlyForATerminal'`

**Step 3: Implement.** In `pkg/devservers/devservers.go` give `Select` a fifth parameter and set the owner for a
row that is not by-agent:

```go
// Select picks the servers that belong to an agent: a listener whose cwd is inside root, or one that descends from
// agentPid (0: no agent process known). procs must hold every listener's process and its ancestors as far as they
// could be read. holders maps arcterm blocks' shell pids to their blocks; a row held by a terminal block names it.
func Select(root string, agentPid int32, procs map[int32]Proc, listeners []Listener, holders map[int32]ServerOwner) []Server {
	alive := func(pid int32) bool { _, ok := procs[pid]; return ok }
	...
		if byAgent {
			s.LauncherCmdline = launcher
		} else if o, _ := OwnerOf(pid, procs, alive, holders); o.Kind == OwnerTerminal {
			// only a terminal gives the rail something to show: an agent's own rows are byAgent, and an app or a
			// detached chain has no output arcterm holds
			s.Owner = &o
		}
```

Append `, nil` to every existing `Select(...)` call in `devservers_test.go`. In `devservers_os.go`, `List` takes
`holders map[int32]ServerOwner` as its last parameter and passes it to `Select`; update its doc comment. In
`wshserver_devservers.go`:

```go
func (ws *WshServer) ListDevServersCommand(ctx context.Context, data wshrpc.CommandListDevServersData) (*wshrpc.CommandListDevServersRtnData, error) {
	holders, err := machineHolders(ctx)
	if err != nil {
		// without the roster the rail still lists every server, none of them named by its terminal
		log.Printf("devservers: reading arcterm's blocks: %v", err)
	}
	servers, err := devservers.List(ctx, data.Cwd, data.BlockId, holders)
```

**Step 4: Run the tests and see them pass:** `go test ./pkg/devservers` and `go build ./pkg/... ./cmd/...`.
`gofmt -l pkg/devservers pkg/wshrpc/wshserver/wshserver_devservers.go` lists nothing you touched.

**Step 5: Commit** with a pathspec: `git commit -m "feat(servers): the rail's servers name the arcterm terminal that holds them" -- pkg/devservers pkg/wshrpc/wshserver/wshserver_devservers.go`

### Task 2: The model names the terminal and its log

**Depends on:** none

**Files:** `frontend/app/view/agents/devserversmodel.ts`, `frontend/app/view/agents/machineservers.ts`, `frontend/app/view/agents/devserversmodel.test.ts`, `frontend/app/view/agents/machineservers.test.ts`

**Step 1: Write the failing tests.** In `devserversmodel.test.ts`, import `terminalLog` and add:

```ts
describe("a server held by an arcterm terminal", () => {
    const owner = { kind: "terminal" as const, tabid: "tab-t", blockid: "blk-t", name: "api" };
    it("names the terminal on its second line", () => {
        expect(ownerLabel(row({ owner }))).toBe("terminal · api");
        expect(ownerLabel(row({ owner: { ...owner, name: "" } }))).toBe("terminal · Terminal");
        expect(ownerLabel(row({ byagent: true, owner }))).toBe("this agent");
    });
    it("has the terminal as its log", () => {
        expect(terminalLog(row({ owner }))).toEqual({ tabId: "tab-t", blockId: "blk-t" });
        expect(terminalLog(row({ owner: { ...owner, blockid: undefined } }))).toBeNull();
        expect(terminalLog(row({ owner: { kind: "app", name: "Code.exe" } }))).toBeNull();
        expect(terminalLog(row())).toBeNull();
    });
});
```

In `machineservers.test.ts`, extend the "badges an agent, a terminal and an app" test (give the `vite` fixture's
owner a `blockid` if it has none): the terminal row's `termLog` is `{ tabId, blockId }` of its owner, and the agent
and app rows have `termLog` undefined.

**Step 2: Run them and see them fail:**
`npx vitest run frontend/app/view/agents/devserversmodel.test.ts frontend/app/view/agents/machineservers.test.ts`

**Step 3: Implement.** In `devserversmodel.ts`:

```ts
// who holds the server, as the row's second line says it
export function ownerLabel(row: DevServerRow): string {
    if (row.byagent) {
        return "this agent";
    }
    if (row.owner?.kind === "terminal") {
        return `terminal · ${row.owner.name || "Terminal"}`;
    }
    return "already running";
}

// the arcterm terminal a server runs in: its pane is the server's log
export interface TerminalLog {
    tabId: string;
    blockId: string;
}

export function terminalLog(row: DevServerRow): TerminalLog | null {
    const o = row.owner;
    return o?.kind === "terminal" && o.tabid && o.blockid ? { tabId: o.tabid, blockId: o.blockid } : null;
}
```

Update the file's header comment (it now also says which terminal holds a row). In `machineservers.ts` add
`termLog?: TerminalLog` to `MachineRow` and set `termLog: terminalLog(s) ?? undefined` in the `"terminal"` case of
`resolveRow`.

**Step 4: Run them and see them pass** (same command as Step 2).

**Step 5: Commit** with a pathspec: `git commit -m "feat(servers): a terminal-held server names its terminal and has it as its log" -- frontend/app/view/agents/devserversmodel.ts frontend/app/view/agents/devserversmodel.test.ts frontend/app/view/agents/machineservers.ts frontend/app/view/agents/machineservers.test.ts`

### Task 3: Log opens the terminal with its search box

**Depends on:** Task 2

**Files:** `frontend/app/view/term/termsearch.ts`, `frontend/app/view/agents/terminallog.ts`, `frontend/app/view/term/term.tsx`, `frontend/app/view/agents/railservers.tsx`, `frontend/app/view/agents/machineserverspanel.tsx`, `CHANGELOG.md`

**Step 1: The pending search.** `frontend/app/view/term/termsearch.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Opening a terminal's search box from outside its pane (a server's Log, docs/superpowers/specs/2026-10-12-server-
// terminal-log-design.md). There is no registry of term view models, so the request is a block id in an atom that the
// matching TerminalView takes and clears; a pane that mounts only when first shown still finds it.

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

export const pendingTermSearchAtom = atom<string | null>(null);

export function requestTermSearch(blockId: string): void {
    globalStore.set(pendingTermSearchAtom, blockId);
}
```

**Step 2: The terminal takes it.** In `term.tsx`, after the search block (just before `// end search`):

```tsx
    // a server's Log asks for this terminal's search box (termsearch.ts)
    const pendingSearch = jotai.useAtomValue(pendingTermSearchAtom);
    React.useEffect(() => {
        if (pendingSearch !== blockId) {
            return;
        }
        globalStore.set(pendingTermSearchAtom, null);
        globalStore.set(searchProps.isOpen, true);
        globalStore.set(searchProps.focusInput, (n: number) => n + 1);
    }, [pendingSearch, blockId]);
```

**Step 3: One opener.** `frontend/app/view/agents/terminallog.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A terminal-held server's Log: open its terminal, then its search box.

import { requestTermSearch } from "@/app/view/term/termsearch";
import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import type { TerminalLog } from "./devserversmodel";

export function openTerminalLog(model: AgentsViewModel, log: TerminalLog): void {
    fireAndForget(async () => {
        await openTarget(model, { kind: "agent", tabId: log.tabId });
        requestTermSearch(log.blockId);
    });
}
```

**Step 4: The Log buttons.** In `railservers.tsx`, `DevServerItem` takes `termLog: TerminalLog | null` and
`onOpenTermLog: (log: TerminalLog) => void`; render the same `data-dev-server-log` button (FileText icon, "Open its
log") when `logTask` or `termLog` is set, calling `onOpenLog` for a task and `onOpenTermLog` for a terminal; add
`data-dev-server-termlog` on the terminal case so a scenario can tell them apart. `ServersSection` passes
`termLog={terminalLog(row)}` and `onOpenTermLog={(log) => openTerminalLog(model, log)}`. Update the header comment.
In `machineserverspanel.tsx`, `ServerRow` shows the `data-machine-server-log` button (plus
`data-machine-server-termlog`) when `row.termLog` is set, calling `openTerminalLog(model, row.termLog)` and then
`close()`.

The live check of the search box (its position, icons, focus, matches and Esc) is Task 4's: a run worker has no
dev app running, and Task 4's acceptance starts its own.

**Step 5: Typecheck and lint the touched files.** `task check:ts` (give it 5 minutes; exit 0 expected), then
`npx eslint` and `npx prettier --check` on each file you touched.

**Step 6: CHANGELOG.** Under `## Unreleased` → `### Added`: "A server running in one of arcterm's terminals says
which terminal in Servers, and its Log opens that terminal with its search box."

**Step 7: Commit** with a pathspec naming every file of this task.

### Task 4: The scenarios open a terminal's log

**Depends on:** Task 1, Task 3

**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/element/search.tsx`, `frontend/app/element/search.scss`, `frontend/app/view/agents/terminallog.ts`, `frontend/app/view/term/termsearch.ts`

The four frontend files change only when a search-box assert below fails.

**The search-box asserts** (both scenarios run them after clicking a terminal's Log; call them one shared helper):
- the terminal pane (`[data-agent-terminal="<tabId>"]`) is shown and `.search-container` exists;
- `.search-container`'s `getBoundingClientRect()` lies inside the terminal pane's rect;
- `document.activeElement` is the box's input;
- each of its buttons draws an icon: an `svg` inside it, or an icon element whose `::before` `content` is a non-empty
  glyph (not `none` / `""`);
- typing a marker string the terminal printed earlier into the input (`Input.insertText`) makes `.search-results`
  visible with a count above 0;
- Escape removes `.search-container` and `document.activeElement` is the terminal's xterm textarea
  (`.xterm-helper-textarea` inside the pane).

This box has not rendered under Tauri before. When an assert fails, fix the code, not the assert: blank icons (they are
Font Awesome names, `chevron-up`, `xmark-large`, `custom@regex`) or colours that are not theme tokens in
`search.tsx` / `search.scss` with lucide icons and `@theme` tokens (DESIGN.md); a box off the pane in `search.scss` /
its floating placement; an input that loses focus to the terminal after `openTarget` by deferring `requestTermSearch`
a frame with `requestAnimationFrame` in `terminallog.ts`.

**Step 1: machine-servers.** Its arrange already creates a real throwaway terminal tab (`ctx.termTabId`) and its
mocked `vite` row is owned by it (`machineServersFixture`). Keep the terminal's block id on `ctx` (`ctx.termBlockId`)
and give the vite row's owner `blockid: ctx.termBlockId`. In arrange, once the shell is up, print a marker in it
(`controllerinput` with `echo <marker>` and a newline, base64 in `inputdata64`). Add a step after the existing Log
step: open the popover, hover the vite row, click `[data-machine-server-termlog]`; assert the popover closed, then the
search-box asserts on that terminal; shoot `cdp-shots/machine-servers-termlog.png` before pressing Escape.

**Step 2: rail-servers.** It runs real processes, so the holder must be real. Steps 1, 3 and 8 count and order the
strip's servers, so this one comes **last, as step 10 after step 9**, and creates its terminal there in the assert,
not in arrange. Step 9 left the rail's panel on a file: bring the panel back to its sections first. Then create a
throwaway terminal tab the same way machine-servers does, with `cmd:cwd` set to the fixture agent's project
directory (`ctx.cwd`), and start a small `node` HTTP server on a free loopback port in it through the terminal's input
(`controllerinput`), one that prints a marker line when it listens. Keep its tab, block and the server's pid on `ctx`.
Wait for its row (assert no strip count here); assert its second line reads `terminal · <tab name>` and it has
`[data-dev-server-termlog]`; click it, run the search-box asserts on that terminal with the marker, shoot
`cdp-shots/rail-servers-termlog.png` before pressing Escape.
Teardown, each its own `step` whatever failed, and both **before** `teardownFixtureRun` (which removes `ctx.cwd`; the
shell, started inside it, locks the directory on Windows): end the node server by its pid, then close the throwaway
tab, ending its shell.

**Step 3: Run them:** `node scripts/cdp/final-verify.mjs machine-servers rail-servers` (it builds and starts its own
dev app and stops it after; give it 20 minutes); both PASS. Look at the two `-termlog.png` shots. Never
`taskkill /IM`: stop a dev app only by the PID whose path is in a repo checkout.

**Step 4: Check and commit.** If you touched a frontend file, `task check:ts` (5 minutes; exit 0), and `npx eslint` /
`npx prettier --check` on each touched `.ts`/`.tsx`/`.scss` file. Commit with a pathspec naming every file you touched:
`git commit -m "test(cdp): the Servers scenarios open a terminal-held server's log" -- scripts/cdp/scenarios.mjs [the fixed files]`
