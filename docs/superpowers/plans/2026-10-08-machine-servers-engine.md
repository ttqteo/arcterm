# Servers on this machine — engine run (RPC, UI, CDP)

**Goal:** Finish "Servers on this machine": the RPC that lists every listener with its owner, the footer chip and popover, and the CDP scenario that shows them.

**Spec:** `docs/superpowers/specs/2026-10-08-machine-servers-design.md` — every worker reads it first.

**Already on main (do not redo):** `memusage.Table.Parent`; in `pkg/devservers` the `ServerOwner` type, `OwnerOf`, `repoFinder`, `machineLister` and `ListAll(ctx, holders)`, plus `Server.Repo` / `Server.Owner`; in `frontend/app/view/agents/` the pure model `machineservers.ts` (`buildMachineServers`, `machinePollMs`, `repoTitle`; a detached row outside any repo is badged as its app) with its tests, and `devserversmodel.ts`'s `DevServerOwner`, `DevServerRow.repo/owner` and `matchLauncherTask`. Read them before starting; the tasks below build on them.

**Architecture:** a new RPC `ListAllDevServersCommand` feeds `devservers.ListAll` the arcterm blocks' shell pids (agent or terminal). The frontend polls it from one store, draws a chip in `FooterStatus` before the RAM chip, and a popover mounted beside `ConsumersPanel`.

**Verify:** `node scripts/verify.mjs ./pkg/devservers ./pkg/memusage ./pkg/wshrpc/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: machine-servers needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs machine-servers rail-servers consumers-popover`

Conventions for every task: commit only the files the task names; no `Co-Authored-By` trailer; check formatting only on touched files (`gofmt -l <files>`, `npx prettier --check <files>`; never `--write` a file whose HEAD was already unformatted, and never prettier `scripts/*.mjs`); colors only from `@theme` tokens (`frontend/tailwindsetup.css`); never hand-edit generated files (`task generate` writes them).

---

### Task 1: RPC `ListAllDevServersCommand`

**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_devservers.go`, `pkg/wshrpc/wshserver/wshserver_devservers.go`, `pkg/wshrpc/wshserver/wshserver_devservers_test.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Changes:**
- Modify: `pkg/wshrpc/wshrpctypes_devservers.go`
- Modify: `pkg/wshrpc/wshserver/wshserver_devservers.go`
- Test: `pkg/wshrpc/wshserver/wshserver_devservers_test.go` (create)
- Generated (by `task generate`, never by hand): `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Step 1:** add to the `DevServerCommands` interface:

```go
	// ListAllDevServersCommand is every listening process on the machine with its repo and owner (the footer's Servers)
	ListAllDevServersCommand(ctx context.Context) (*CommandListDevServersRtnData, error)
```

**Step 2: failing test** — `wshserver_devservers_test.go` scripts `loadAgentRosterFacts` and `consumerBlockPid` (both are vars; see `wshserver_agentmsg_test.go`'s `agentFacts` helper for building `agentTabFacts`):

```go
func TestMachineHoldersNamesAgentsAndTerminals(t *testing.T) {
	agent := agentFacts("tab-a", "portal", "blk-a", "claude", "working")
	term := agentFacts("tab-t", "dev", "blk-t", "", "")
	stopped := agentFacts("tab-s", "old", "blk-s", "", "")
	stopped.ShellRunning = false
	restoreFacts := loadAgentRosterFacts
	restorePid := consumerBlockPid
	t.Cleanup(func() { loadAgentRosterFacts = restoreFacts; consumerBlockPid = restorePid })
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) {
		return &agentRosterFacts{Tabs: []agentTabFacts{agent, term, stopped}}, nil
	}
	consumerBlockPid = func(blockId string) int { return map[string]int{"blk-a": 20, "blk-t": 30, "blk-s": 40}[blockId] }
	holders, err := readMachineHolders(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if h := holders[20]; h.Kind != devservers.OwnerAgent || h.TabId != "tab-a" || h.Name != "portal" || h.Harness != "claude" {
		t.Fatalf("holders[20] = %+v; want the claude agent", h)
	}
	if h := holders[30]; h.Kind != devservers.OwnerTerminal || h.TabId != "tab-t" || h.Name != "dev" {
		t.Fatalf("holders[30] = %+v; want the terminal", h)
	}
	if _, ok := holders[40]; ok {
		t.Fatal("a tab whose shell stopped holds nothing")
	}
}
```

Check `agentFacts`'s signature and whether it sets `ShellRunning: true`; adapt the fixture to it rather than changing the helper.

**Step 3:** `go test ./pkg/wshrpc/wshserver -run '^TestMachineHolders'` → FAIL.

**Step 4: implement** in `wshserver_devservers.go` (add `log` import):

```go
// machineHolders is the arcterm blocks that can hold a server, by shell pid. A var so tests need no store.
var machineHolders = readMachineHolders

func readMachineHolders(ctx context.Context) (map[int32]devservers.ServerOwner, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	agents := map[string]agentRow{}
	for _, r := range buildAgentRoster(facts) {
		agents[r.blockId] = r
	}
	holders := map[int32]devservers.ServerOwner{}
	for _, tf := range facts.Tabs {
		if !tf.ShellRunning {
			continue
		}
		pid := consumerBlockPid(tf.BlockId)
		if pid <= 0 {
			continue
		}
		o := devservers.ServerOwner{Kind: devservers.OwnerTerminal, BlockId: tf.BlockId, TabId: tf.Tab.OID, Name: tf.Tab.Name}
		if r, ok := agents[tf.BlockId]; ok {
			o.Kind, o.Harness = devservers.OwnerAgent, r.Harness
		}
		holders[int32(pid)] = o
	}
	return holders, nil
}

func (ws *WshServer) ListAllDevServersCommand(ctx context.Context) (*wshrpc.CommandListDevServersRtnData, error) {
	holders, err := machineHolders(ctx)
	if err != nil {
		// without the roster every server still lists, owned by an app or detached
		log.Printf("devservers: reading arcterm's blocks: %v", err)
	}
	servers, err := devservers.ListAll(ctx, holders)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandListDevServersRtnData{Servers: servers}, nil
}
```

**Step 5:** `task generate`, then confirm `RpcApi.ListAllDevServersCommand` exists in `frontend/app/store/wshclientapi.ts` (command string `listalldevservers`) and `ServerOwner` / `Server.owner` / `Server.repo` in `frontend/types/gotypes.d.ts`. `go build ./...`; `go test ./pkg/wshrpc/wshserver -run '^TestMachineHolders'` → PASS.

**Step 6:** commit the two Go files, the test and the generated files — `feat(wshrpc): ListAllDevServers, every listener on the machine with its owner`.

---

### Task 2: store, chip, popover

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/machineserversstore.ts`, `frontend/app/view/agents/machineserverschip.tsx`, `frontend/app/view/agents/machineserverspanel.tsx`, `frontend/app/view/agents/railservers.tsx`, `frontend/app/view/agents/consumersstore.ts`, `frontend/app/cockpit/footerstatus.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `CHANGELOG.md`

**Changes:**
- Create: `frontend/app/view/agents/machineserversstore.ts`
- Create: `frontend/app/view/agents/machineserverschip.tsx`
- Create: `frontend/app/view/agents/machineserverspanel.tsx`
- Modify: `frontend/app/view/agents/railservers.tsx` (export the Stop button and the action-button class)
- Modify: `frontend/app/view/agents/consumersstore.ts` (`toggleConsumers` closes Servers)
- Modify: `frontend/app/cockpit/footerstatus.tsx` (chip before `WorkerCapacityChip`)
- Modify: `frontend/app/cockpit/cockpit-root.tsx` (mount the panel beside `ConsumersPanel`)
- Modify: `CHANGELOG.md` (one `Added` line in the top `Unreleased` section; stage only that hunk if other sessions have edits there)

**Acceptance:** the `machine-servers` scenario (Task 3) shows each view and interaction this task builds: the chip's plain, no-owner and failed states (its steps 1 and 7), the open popover with its groups (step 2), Other collapsed and expanded (step 3), every badge kind and the no-owner tooltip (step 4), a row's hover actions and the Stop confirm and stop (step 5), the app Stop confirm and Esc (step 6), the backdrop close and the mutual exclusion with Consumers (step 8). `rail-servers` and `consumers-popover` still pass.

**Step 1: store** — `machineserversstore.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers state: whether the popover is open and the last ListAllDevServers reading. The panel, mounted
// once in cockpit-root, polls: slowly for the chip, fast while open, never while the window is hidden.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { DevServerRow } from "./devserversmodel";
import { machinePollMs } from "./machineservers";

export const machineServersOpenAtom = atom(false) as PrimitiveAtom<boolean>;

export interface MachineServersReading {
    servers: DevServerRow[] | null; // null until the first reading
    failed: boolean; // the last poll failed; servers is the reading before it
}

export const machineServersReadingAtom = atom<MachineServersReading>({ servers: null, failed: false }) as PrimitiveAtom<MachineServersReading>;

let inflight = false;

export async function loadMachineServers(
    read: () => Promise<CommandListDevServersRtnData> = () => RpcApi.ListAllDevServersCommand(TabRpcClient)
): Promise<void> {
    if (inflight) {
        return;
    }
    inflight = true;
    try {
        const rtn = await read();
        globalStore.set(machineServersReadingAtom, { servers: (rtn.servers ?? []) as DevServerRow[], failed: false });
    } catch {
        globalStore.set(machineServersReadingAtom, (prev) => ({ ...prev, failed: true }));
    } finally {
        inflight = false;
    }
}

export function useMachineServersPoll(open: boolean): void {
    useEffect(() => {
        const poll = () => {
            if (!document.hidden) {
                fireAndForget(loadMachineServers);
            }
        };
        poll();
        const timer = setInterval(poll, machinePollMs(open));
        return () => clearInterval(timer);
    }, [open]);
}

// drops a stopped server's row at once; the next poll confirms
export function forgetMachineServer(row: DevServerRow): void {
    globalStore.set(machineServersReadingAtom, (prev) => ({
        ...prev,
        servers: prev.servers?.filter((s) => !(s.pid === row.pid && s.createms === row.createms)) ?? null,
    }));
}
```

In `consumersstore.ts`, `toggleConsumers` also sets `machineServersOpenAtom` to false (import it from `./machineserversstore`; that store must not import `consumersstore`).

**Step 2: shared Stop** — in `railservers.tsx`, export `ACTION_BTN` and move the confirm-twice logic out of `DevServerItem` into

```tsx
export function ServerStopButton({ confirmLabel, onStop }: { confirmLabel: string; onStop: () => void }) { ... }
```

carrying the `confirming` state, the 3 s timer, `STOP_BTN` / the confirm style and the `data-dev-server-stop` attribute exactly as today (`confirmLabel` replaces the literal `"Stop?"`). It must also tell its parent when it is confirming, because `DevServerItem` keeps the actions visible while confirming: give it an `onConfirmingChange?: (c: boolean) => void` prop, or keep the visibility rule with CSS `focus-within` (the button keeps focus after the first click). `DevServerItem` uses it with `confirmLabel="Stop?"` and `onStop={() => fireAndForget(() => stopDevServer(row))}`. The `rail-servers` CDP scenario, which Final runs, (Task 3's verify run) confirms the rail is unchanged.

**Step 3: chip** — `machineserverschip.tsx`. Reads `machineServersReadingAtom`, the roster (`model.agentsAtom`, `model.terminalsAtom`) and `backgroundTasksByIdAtom`, builds the view with `buildMachineServers`, and renders a button styled like `WorkerCapacityChip` (`text-[11.5px] font-semibold tabular-nums`, `hover:bg-surface-hover`), with `data-machine-servers-chip`, `aria-haspopup="dialog"`, the lucide `Network` icon, then:
- no reading yet: nothing (like the RAM chip);
- `failed` with no servers: the icon and `?`, `text-muted`;
- `repoCount === 0`: the icon alone, `text-muted`;
- else `{repoCount}` and, when `noOwnerCount > 0`, ` · {noOwnerCount} no owner` in a `text-warning` span.

`title`: the repo servers' `portsLabel(ports)` joined by spaces. Click: `globalStore.set(consumersOpenAtom, null)`, then toggle `machineServersOpenAtom`. Takes `{ model }`; `FooterStatus` already has it, so render `<MachineServersChip model={model} />` before `<WorkerCapacityChip />`.

**Step 4: panel** — `machineserverspanel.tsx`, mounted in `cockpit-root.tsx` right after `<ConsumersPanel model={model} />`. Copy `ConsumersPanel`'s frame: the `fixed inset-0 z-50` backdrop that closes it, `PopoverReveal` with `origin="bottom right"` and `className="fixed bottom-[42px] right-4 z-[60] w-[520px] max-h-[60vh] overflow-y-auto rounded-lg border border-edge-strong bg-surface-raised shadow-popover"`, and the capture-phase `Escape` listener that yields to open modals. It calls `useMachineServersPoll(open)` unconditionally (the panel is always mounted, so this is the one poll for chip and popover).

Content, inside `<div data-machine-servers-panel role="dialog" aria-label="Servers on this machine">`:
- header row: `Servers on this machine` (`text-[12px] text-secondary`) and the total count on the right;
- when `failed`: `<div data-machine-servers-failed className="px-3 py-1.5 text-[11.5px] text-warning">Could not read listening ports</div>` above the last rows, which render with `opacity-60`;
- each group: a `text-[11px] text-muted` title row (`data-machine-servers-group={title}`), then its rows;
- **Other**: a button row `Other ({n}) {otherNames}` (`data-machine-servers-other`, `aria-expanded`), collapsed by default (`useState(false)`; the panel never unmounts, so it keeps its state), expanding to its rows.

A row (`data-machine-server={pid}`), laid out like `DevServerItem`: the success dot, each port as a button opening `serverUrl(port)` via `getApi().openExternal`, the label (`title={cmdline}`), uptime (`uptimeLabel`, with a `now` from a 30 s `useState` ticker while open); second line `PID {pid}` then the badge, then the hover actions:
- badge: a `rounded-[4px] px-1 text-[10.5px]` chip with `data-machine-server-badge={kind}`; `noowner` uses `text-warning` and `title="Still running. No agent, terminal or open app holds it."`; agent and terminal badges are buttons calling `openTarget(model, { kind: "agent", tabId })` and closing the panel; app badges are plain text in `text-muted`;
- **Log** (only with `row.log`): `openFileInPanel(model, log.agentId, { abs: log.task.outputFile!, root: null, reread: Date.now(), live: true, title: `${portsLabel(ports)} ${label}` })`, then `openTarget(model, { kind: "agent", tabId: log.agentId })`, then close;
- **Copy**: `copyText(row.server)` to the clipboard;
- **Stop**: `<ServerStopButton confirmLabel={row.stopConfirm} onStop={...} />`, where onStop awaits `RpcApi.StopDevServerCommand(TabRpcClient, { pid, createms })`, then `forgetMachineServer(row.server)`; on error `pushToast` (see how `consumerspanel.tsx` calls it) with "That process already exited" when the error text mentions the PID was reused or the process is not running, else the error's text, and `fireAndForget(loadMachineServers)`.

**Step 5:** `task check:ts` (give it a 4-minute timeout; the baseline is clean) and `npx vitest run frontend/app/view/agents/machineservers.test.ts frontend/app/view/agents/devserversmodel.test.ts frontend/app/view/agents/consumers.test.ts` → clean. `npx eslint` + `npx prettier --check` on the touched files. Don't start a dev app: the run's Final starts one and runs the CDP scenarios.

**Step 6:** CHANGELOG `Added` line, e.g.: "The footer has a **Servers** chip: how many servers run inside your repos, and how many nothing holds any more. Click it to see every listening process on the machine, grouped by repo, with what each belongs to (an agent, a terminal, an app, or no owner), and open, read the log of, copy or stop it." Commit the named files — `feat(cockpit): Servers on this machine, a footer chip and popover`.

---

### Task 3: CDP scenario `machine-servers`

**Depends on:** Task 2
**Files:** `scripts/cdp/scenarios.mjs`

**Changes:**
- Modify: `scripts/cdp/scenarios.mjs` (hand-formatted, 4-space; never run prettier on it)

**Step 1:** add a scenario modelled on `consumers-popover` (search `CONSUMERS_MOCK_KEY`): install a mock RPC client with `api.setMockRpcClient` that answers `listalldevservers` from a fixture (modes `ok`, `fail`, `empty`) and records `stopdevserver` calls without stopping anything, passing every other command through. Fixture rows (`repo`, `owner`, `launchercmdline` set as in `frontend/app/view/agents/machineservers.test.ts`): `:4321 astro` detached in `D:/fx/website` (no owner), `:8100 uvicorn` owned by an agent, `:5174 vite` owned by a terminal, `Code.exe` and `com.docker.backend.exe` as apps with no repo. Use a fixture roster the way `consumers-popover` does if the agent badge must show a name; otherwise assert the badge falls back to the owner's name.

Steps, each with a screenshot and an assertion:
1. the chip reads `3 · 1 no owner` (`[data-machine-servers-chip]` text);
2. click it: `[data-machine-servers-panel]` is open; group titles in order, `website` group first;
3. Other is collapsed and lists `Code, com.docker.backend`; click it: its two rows show;
4. each badge kind is present (`[data-machine-server-badge="noowner"|"agent"|"terminal"|"app"]`), and the no-owner badge carries its tooltip;
5. hover the astro row: Copy and Stop show; click Stop once: it reads `Stop?`; again: a `stopdevserver` call with astro's pid and createms is recorded and the row is gone;
6. hover the Code row and click Stop once: it reads `Stop Code?`; press Esc: the panel closes and nothing was stopped;
7. mode `fail`, reopen: `[data-machine-servers-failed]` shows over the last rows; the chip still shows the last count;
8. a click on the backdrop closes it; opening Consumers from the RAM chip closes it and vice versa;
9. teardown restores the RPC client.

**Step 2:** `node --check scripts/cdp/scenarios.mjs` → no syntax error. Don't start a dev app: the run's Final runs `machine-servers`, `rail-servers` (proving Task 2's Stop refactor left the rail alone) and `consumers-popover` against a dev app of its own.

**Step 3:** commit `scripts/cdp/scenarios.mjs` — `test(cdp): machine-servers scenario`.
