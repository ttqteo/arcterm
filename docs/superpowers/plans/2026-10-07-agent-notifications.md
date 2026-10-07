# Agent Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** An OS toast when arcterm is in the background and an in-app toast when it is focused, for an agent that
asks or waits on a permission prompt, an agent that finished its turn, an orchestrator item that needs a decision, and
a `wsh notify`.

**Architecture:** A pure model (`notifyevents.ts`) diffs roster and attention snapshots into events, routes each by
window focus and what is on screen, and coalesces a burst into one summary. An always-mounted `NotifySync` feeds it and
delivers to the toast stack or to a new Tauri command `notify_os`, which shows a WinRT toast (macOS: the notification
plugin) and, on click, focuses the window and emits the target back to the frontend.

**Tech Stack:** React 19 + jotai, vitest, Go (`pkg/wconfig`), Rust/Tauri 2 with `tauri-winrt-notification` (Windows)
and `tauri-plugin-notification` (macOS).

**Spec:** `docs/superpowers/specs/2026-10-07-agent-notifications-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/wconfig/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: notify-toast needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs notify-toast`

Conventions for every task: work on `main`; commit only the files the task names (the tree has unrelated edits);
no `Co-Authored-By` trailer; never push. Check formatting only on files you touched (`npx prettier --check <files>`,
`gofmt -l <files>`); never prettier `scripts/*.mjs`.

---

### Task 1: Settings keys

**Depends on:** none

**Files:**
- Modify: `pkg/wconfig/settingsconfig.go` (the `SettingsType` struct, after the `app:` block)
- Modify: `pkg/wconfig/defaultconfig/settings.json`
- Regenerated: `frontend/types/gotypes.d.ts`, `pkg/wconfig/metaconsts.go`, `schema/settings.json` (whatever
  `task generate` changes; never hand-edit)

**Step 1: Add the fields**

In `SettingsType`, after `AppDisableCtrlShiftDisplay`, add a blank line and:

```go
	NotifyClear  bool  `json:"notify:*,omitempty"`
	NotifyOs     *bool `json:"notify:os,omitempty"`
	NotifyToast  *bool `json:"notify:toast,omitempty"`
	NotifyReply  *bool `json:"notify:reply,omitempty"`
```

**Step 2: Defaults**

In `pkg/wconfig/defaultconfig/settings.json` add `"notify:os": true,`, `"notify:toast": true,`, `"notify:reply": true,`
after `"app:disablectrlshiftdisplay": false,`.

**Step 3: Regenerate**

Run: `task generate`
Expected: exit 0; `git diff --stat` shows `frontend/types/gotypes.d.ts` gained `"notify:os"?: boolean` etc., and
`pkg/wconfig/metaconsts.go` gained `ConfigKey_NotifyOs` etc.

**Step 4: Build check**

Run: `go build ./pkg/wconfig/... && go test ./pkg/wconfig/...`
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/wconfig/settingsconfig.go pkg/wconfig/defaultconfig/settings.json pkg/wconfig/metaconsts.go frontend/types/gotypes.d.ts schema/settings.json
git commit -m "feat(config): notify:os, notify:toast and notify:reply settings"
```
(Leave out any path `git status` does not show as changed.)

---

### Task 2: A permission prompt reads as asking

**Depends on:** none

`waiting` now comes only from the input-needed Notification types (`permission_prompt`, `elicitation_*`,
`agent_needs_input`; `idle_prompt` maps to idle since `82e21f80`), so it is a real "needs you", not a generic nudge.
Consumers already handle `asking` without an `ask` object (AskUserQuestion falling back to the terminal).

**Files:**
- Modify: `frontend/app/view/agents/agentsviewmodel.ts:488-500` (`agentVMFromInput` and its doc comment)
- Test: `frontend/app/view/agents/agentsviewmodel.test.ts:234` and `:293`

**Step 1: Rewrite the two tests**

Replace the test at `:234` ("maps a waiting row to working, not asking…") and the one at `:293` ("maps backend
'waiting' (a Notification nudge) to working, not asking") with:

```ts
    it("maps a waiting row (a permission prompt or other input request) to asking", () => {
        const vm = agentVMFromInput({ id: "t1", name: "a", status: "waiting", ts: 1000 }, 5000);
        expect(vm.state).toBe("asking");
        expect(vm.blockedMs).toBe(4000);
        expect(vm.activeMs).toBeUndefined();
        expect(vm.atPrompt).toBe(true);
    });
```

Read the surrounding assertions of both old tests first and keep any assertion that is not about the state mapping.

**Step 2: Run, expect FAIL**

Run: `npx vitest run frontend/app/view/agents/agentsviewmodel.test.ts`
Expected: FAIL, `expected 'working' to be 'asking'`.

**Step 3: Implement**

```ts
    const state: AgentState =
        input.status === "asking" || input.status === "waiting"
            ? "asking"
            : input.status === "working"
              ? "working"
              : "idle";
```

and change the doc comment's `waiting` sentence to: "`waiting` (a permission prompt or another input request; an idle
prompt reports idle) maps to asking too: either way the agent is blocked on you."

**Step 4: Run the agents tests**

Run: `npx vitest run frontend/app/view/agents`
Expected: PASS. If another test pinned waiting → working (`sessionviewmodel.test.ts`, `isNeedsYou` tests), decide per
test: one about the roster state flips to asking; one about a different model (session-models) stays as it is.

**Step 5: Commit**

```bash
git add frontend/app/view/agents/agentsviewmodel.ts frontend/app/view/agents/agentsviewmodel.test.ts
git commit -m "feat(agents): an agent at a permission prompt shows as asking"
```

---

### Task 3: Unread counts respect window focus

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/unreadagents.ts` (`viewingIds`)
- Modify: `frontend/app/view/agents/unreadagentsstore.ts`
- Test: `frontend/app/view/agents/unreadagents.test.ts:70-85`

**Step 1: Failing test**

`viewingIds` gains a first parameter `windowFocused: boolean`. Update every existing call in the test to pass `true`
first, then add:

```ts
    it("sees nothing while the window is not focused", () => {
        expect(viewingIds(false, true, "terminal", "a", grid).size).toBe(0);
    });
```

**Step 2: Run, expect FAIL**

Run: `npx vitest run frontend/app/view/agents/unreadagents.test.ts`
Expected: FAIL (wrong arity / non-empty set).

**Step 3: Implement**

```ts
/** Pure: the agents whose terminal is on screen. Nothing while the window is not focused (arcterm behind another app
 *  shows you nothing); otherwise only on the Agent surface with its terminal centre: the focused agent, and every cell
 *  of the grid when the focused agent is one of them (the grid then shows them all). */
export function viewingIds(
    windowFocused: boolean,
    onAgentSurface: boolean,
    center: CenterMode,
    focusId: string | undefined,
    grid: GridState
): Set<string> {
    if (!windowFocused || !onAgentSurface || center !== "terminal" || focusId == null) {
        return new Set();
    }
    return grid.ids.includes(focusId) ? new Set(grid.ids) : new Set([focusId]);
}
```

In `unreadagentsstore.ts`: `import { atoms } from "@/app/store/global";`, read
`const focused = useAtomValue(atoms.documentHasFocus);`, pass it first, and add `focused` to the effect's deps. Add to
the file header: "A turn that ends while the window is not focused stays unread, even on the agent in view."

**Step 4: Run**

Run: `npx vitest run frontend/app/view/agents/unreadagents.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/app/view/agents/unreadagents.ts frontend/app/view/agents/unreadagentsstore.ts frontend/app/view/agents/unreadagents.test.ts
git commit -m "fix(agents): a turn finished while arcterm is in the background stays unread"
```

---

### Task 4: The pure notification model

**Depends on:** Task 2

**Files:**
- Create: `frontend/app/view/agents/notifyevents.ts`
- Create: `frontend/app/view/agents/notifyevents.test.ts`

**Step 1: Write the tests** (`notifyevents.test.ts`)

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    coalesce,
    diffEvents,
    notifyEventOf,
    routeNotify,
    snapshotOf,
    type NotifyEvent,
    type RouteCtx,
} from "./notifyevents";

const agent = (id: string, state: AgentVM["state"], extra: Partial<AgentVM> = {}): AgentVM =>
    ({ id, name: `agent ${id}`, task: `task ${id}`, state, ...extra }) as AgentVM;
const item = (key: string, kind = "gate"): AttentionItem =>
    ({ kind, key, source: "lead", text: `decide ${key}`, action: "", phaseidx: 0, waitingsince: 0 }) as AttentionItem;
const snap = (agents: AgentVM[], attention: AttentionItem[] = [], loaded = true) =>
    snapshotOf(agents, attention, loaded);

describe("diffEvents", () => {
    it("emits nothing for the first snapshot", () => {
        expect(diffEvents(null, snap([agent("a", "asking")], [item("g1")]))).toEqual([]);
    });
    it("emits a loud request when a known agent starts asking", () => {
        const [e] = diffEvents(snap([agent("a", "working")]), snap([agent("a", "asking")]));
        expect(e).toMatchObject({ kind: "request", target: { kind: "agent", agentId: "a" }, loud: true });
        expect(e.title).toBe("agent a needs you");
    });
    it("uses the ask's first question line as the body", () => {
        const asking = agent("a", "asking", {
            ask: { questions: [{ question: "Pick one\nmore" }] } as unknown as AgentVM["ask"],
        });
        expect(diffEvents(snap([agent("a", "working")]), snap([asking]))[0].body).toBe("Pick one");
    });
    it("does not repeat a request while the agent keeps asking", () => {
        expect(diffEvents(snap([agent("a", "asking")]), snap([agent("a", "asking")]))).toEqual([]);
    });
    it("ignores an agent it has not seen before, whatever its state", () => {
        expect(diffEvents(snap([]), snap([agent("a", "asking")]))).toEqual([]);
    });
    it("emits a quiet reply on working -> idle", () => {
        const [e] = diffEvents(snap([agent("a", "working")]), snap([agent("a", "idle")]));
        expect(e).toMatchObject({ kind: "reply", target: { kind: "agent", agentId: "a" }, loud: false });
        expect(e.title).toBe("agent a finished");
        expect(e.body).toBe("task a");
    });
    it("emits no reply for an agent working for a run", () => {
        expect(
            diffEvents(snap([agent("w", "working", { runId: "r1" })]), snap([agent("w", "idle", { runId: "r1" })]))
        ).toEqual([]);
    });
    it("emits a loud attention event for a new decision item, once", () => {
        const before = snap([], [item("g1")]);
        const after = snap([], [item("g1"), item("g2", "run-land-held")]);
        const evs = diffEvents(before, after);
        expect(evs).toHaveLength(1);
        expect(evs[0]).toMatchObject({ kind: "attention", target: { kind: "attention", key: "g2" }, loud: true });
        expect(diffEvents(after, after)).toEqual([]);
    });
    it("skips asks and radar triage in attention (the roster covers asks)", () => {
        expect(diffEvents(snap([], []), snap([], [item("ask:b", "ask"), item("r", "radar-triage")]))).toEqual([]);
    });
    it("takes the first loaded attention list as a baseline", () => {
        expect(diffEvents(snap([], [], false), snap([], [item("g1")], true))).toEqual([]);
    });
    it("fires an item again after it left the list and came back", () => {
        // the model keeps no seen set: the previous snapshot is the memory, so an item absent from it is new
        expect(diffEvents(snap([], []), snap([], [item("g1")]))).toHaveLength(1);
    });
});

describe("notifyEventOf", () => {
    it("maps a wsh notify to a quiet notify event", () => {
        expect(notifyEventOf({ title: "Build", message: "done", level: "info" })).toMatchObject({
            kind: "notify",
            title: "Build",
            body: "done",
            loud: false,
            target: { kind: "none" },
        });
    });
    it("drops an empty one", () => {
        expect(notifyEventOf(undefined)).toBeNull();
        expect(notifyEventOf({ title: "", message: "", level: "info" })).toBeNull();
    });
});

const ctx = (over: Partial<RouteCtx> = {}): RouteCtx => ({
    focused: true,
    viewing: new Set(),
    settings: { os: true, toast: true, reply: true },
    ...over,
});
const ev = (kind: NotifyEvent["kind"], agentId = "a"): NotifyEvent => ({
    kind,
    target: kind === "notify" ? { kind: "none" } : { kind: "agent", agentId },
    title: "t",
    body: "",
    loud: kind === "request",
});

describe("routeNotify", () => {
    it("toasts while focused", () => expect(routeNotify(ev("request"), ctx())).toBe("toast"));
    it("goes to the OS while backgrounded", () => expect(routeNotify(ev("request"), ctx({ focused: false }))).toBe("os"));
    it("says nothing about the agent in view", () =>
        expect(routeNotify(ev("request"), ctx({ viewing: new Set(["a"]) }))).toBe("none"));
    it("leaves a focused wsh notify to the avatar", () => expect(routeNotify(ev("notify"), ctx())).toBe("avatar"));
    it("sends a backgrounded wsh notify to the OS", () =>
        expect(routeNotify(ev("notify"), ctx({ focused: false }))).toBe("os"));
    it("honours notify:os off", () =>
        expect(routeNotify(ev("request"), ctx({ focused: false, settings: { os: false, toast: true, reply: true } }))).toBe(
            "none"
        ));
    it("honours notify:toast off", () =>
        expect(routeNotify(ev("request"), ctx({ settings: { os: true, toast: false, reply: true } }))).toBe("none"));
    it("honours notify:reply off, focused or not", () => {
        const off = { os: true, toast: true, reply: false };
        expect(routeNotify(ev("reply"), ctx({ settings: off }))).toBe("none");
        expect(routeNotify(ev("reply"), ctx({ focused: false, settings: off }))).toBe("none");
    });
});

describe("coalesce", () => {
    it("passes one or two events through", () => {
        const two = [ev("request"), ev("reply", "b")];
        expect(coalesce(two)).toEqual(two);
    });
    it("folds three or more into one summary on the Cockpit", () => {
        const [s, ...rest] = coalesce([ev("request"), ev("request", "b"), ev("reply", "c"), ev("notify")]);
        expect(rest).toEqual([]);
        expect(s).toMatchObject({ kind: "summary", target: { kind: "cockpit" }, loud: true });
        expect(s.title).toBe("2 waiting on you · 1 replied · 1 message");
    });
    it("is quiet when nothing in it is loud", () => {
        expect(coalesce([ev("reply"), ev("reply", "b"), ev("reply", "c")])[0]).toMatchObject({
            loud: false,
            title: "3 replied",
        });
    });
});
```

**Step 2: Run, expect FAIL**

Run: `npx vitest run frontend/app/view/agents/notifyevents.test.ts`
Expected: FAIL, cannot resolve `./notifyevents`.

**Step 3: Implement** (`notifyevents.ts`)

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what is worth telling you, and where. diffEvents turns two snapshots of the roster and the attention list into
// edge events (an agent starts asking, finishes a turn, a decision item appears); routeNotify sends each to an OS toast
// while arcterm is in the background, an in-app toast while it is focused, or nowhere for the agent you are looking at;
// coalesce folds a burst into one summary. NotifySync (notifysync.tsx) wires it up. No React, no store.

import type { AgentState, AgentVM } from "./agentsviewmodel";

export type NotifyTarget =
    | { kind: "agent"; agentId: string }
    | { kind: "attention"; key: string }
    | { kind: "cockpit" }
    | { kind: "none" };

export interface NotifyEvent {
    kind: "request" | "reply" | "attention" | "notify" | "summary";
    target: NotifyTarget;
    title: string;
    body: string;
    // a sound and a taskbar flash: something is blocked on you
    loud: boolean;
}

interface AgentSnap {
    state: AgentState;
    name: string;
    task: string;
    runId?: string;
    question?: string;
}

export interface NotifySnapshot {
    agents: ReadonlyMap<string, AgentSnap>;
    attention: ReadonlyMap<string, AttentionItem>;
    // false until the first attention poll lands, so the list it brings is a baseline rather than news
    attentionLoaded: boolean;
}

// attention kinds that wait on a decision of yours. An ask is left to the roster (its agent turns asking) and radar
// triage is a backlog, not a block.
export const DECISION_KINDS: ReadonlySet<string> = new Set([
    "gate",
    "escalation",
    "dag-gate",
    "dag-blocked",
    "run-land-held",
    "run-unverified",
]);

export function snapshotOf(agents: readonly AgentVM[], attention: readonly AttentionItem[], loaded: boolean): NotifySnapshot {
    return {
        agents: new Map(
            agents.map((a) => [
                a.id,
                {
                    state: a.state,
                    name: a.name,
                    task: a.task,
                    runId: a.runId,
                    question: a.ask?.questions?.[0]?.question?.split("\n")[0],
                },
            ])
        ),
        attention: new Map(attention.filter((i) => DECISION_KINDS.has(i.kind)).map((i) => [i.key, i])),
        attentionLoaded: loaded,
    };
}

/** Pure: the events between two snapshots. The first snapshot is a baseline, and so is an agent seen for the first
 *  time: a reload or a websocket reconnect refills the roster, and that is not news. */
export function diffEvents(prev: NotifySnapshot | null, next: NotifySnapshot): NotifyEvent[] {
    if (prev == null) {
        return [];
    }
    const out: NotifyEvent[] = [];
    for (const [id, a] of next.agents) {
        const before = prev.agents.get(id);
        if (before == null) {
            continue;
        }
        if (a.state === "asking" && before.state !== "asking") {
            out.push({
                kind: "request",
                target: { kind: "agent", agentId: id },
                title: `${a.name} needs you`,
                body: a.question ?? "Waiting for your input",
                loud: true,
            });
        } else if (a.state === "idle" && before.state === "working" && a.runId == null) {
            out.push({ kind: "reply", target: { kind: "agent", agentId: id }, title: `${a.name} finished`, body: a.task, loud: false });
        }
    }
    if (prev.attentionLoaded) {
        for (const [key, i] of next.attention) {
            if (!prev.attention.has(key)) {
                out.push({
                    kind: "attention",
                    target: { kind: "attention", key },
                    title: i.channelname ? `#${i.channelname}: ${i.text}` : i.text,
                    body: i.why ?? i.source,
                    loud: true,
                });
            }
        }
    }
    return out;
}

/** Pure: a `wsh notify` as an event; null for one with nothing to say. */
export function notifyEventOf(data: NotifyCommandData | undefined): NotifyEvent | null {
    if (data == null || (!data.title && !data.message)) {
        return null;
    }
    return { kind: "notify", target: { kind: "none" }, title: data.title || data.message, body: data.title ? data.message : "", loud: false };
}

export interface RouteCtx {
    focused: boolean;
    viewing: ReadonlySet<string>;
    settings: { os: boolean; toast: boolean; reply: boolean };
}

export type NotifyRoute = "os" | "toast" | "avatar" | "none";

/** Pure: where one event goes. A focused `wsh notify` stays the avatar's (petsources.tsx), so the two never say the
 *  same thing in the same corner. */
export function routeNotify(e: NotifyEvent, ctx: RouteCtx): NotifyRoute {
    if (e.kind === "reply" && !ctx.settings.reply) {
        return "none";
    }
    if (!ctx.focused) {
        return ctx.settings.os ? "os" : "none";
    }
    if (e.target.kind === "agent" && ctx.viewing.has(e.target.agentId)) {
        return "none";
    }
    if (e.kind === "notify") {
        return "avatar";
    }
    return ctx.settings.toast ? "toast" : "none";
}

export const COALESCE_MS = 2000;
const SUMMARY_AT = 3;

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** Pure: a burst of three or more events becomes one summary that opens the Cockpit. */
export function coalesce(events: NotifyEvent[]): NotifyEvent[] {
    if (events.length < SUMMARY_AT) {
        return events;
    }
    const waiting = events.filter((e) => e.kind === "request" || e.kind === "attention").length;
    const replied = events.filter((e) => e.kind === "reply").length;
    const messages = events.length - waiting - replied;
    const parts = [
        waiting > 0 ? `${waiting} waiting on you` : "",
        replied > 0 ? `${replied} replied` : "",
        messages > 0 ? plural(messages, "message", "messages") : "",
    ].filter(Boolean);
    return [{ kind: "summary", target: { kind: "cockpit" }, title: parts.join(" · "), body: "", loud: events.some((e) => e.loud) }];
}
```

(`AttentionItem` and `NotifyCommandData` are ambient types from `frontend/types/gotypes.d.ts`.)

**Step 4: Run**

Run: `npx vitest run frontend/app/view/agents/notifyevents.test.ts`
Expected: PASS. Then `npx prettier --check frontend/app/view/agents/notifyevents.ts frontend/app/view/agents/notifyevents.test.ts`
and fix what it reports (`npx prettier --write` on these two files only).

**Step 5: Commit**

```bash
git add frontend/app/view/agents/notifyevents.ts frontend/app/view/agents/notifyevents.test.ts
git commit -m "feat(agents): pure notification model: edge events, routing, coalescing"
```

---

### Task 5: Attention baseline flag and a shared "open a Needs you item"

**Depends on:** none

The first attention poll must be a baseline, and a click on an attention notification must land where the palette's
Needs you row lands. That landing is a closure inside `command-palette.tsx` (`openNeeds`, `:485-519`); move it out so
both use it.

**Files:**
- Modify: `frontend/app/view/agents/attentionstore.ts`
- Create: `frontend/app/cockpit/openneeds.ts`
- Modify: `frontend/app/cockpit/command-palette.tsx:485-519`

**Step 1: `attentionLoadedAtom`**

In `attentionstore.ts`, beside `attentionAtom`:

```ts
// false until the first poll lands: the list it brings is what was already waiting, not news (notifyevents.ts)
export const attentionLoadedAtom = atom(false) as PrimitiveAtom<boolean>;
```

and in `loadAttention`'s success branch, after setting `attentionAtom`, `globalStore.set(attentionLoadedAtom, true);`.

**Step 2: `openneeds.ts`**

Move the body of `openNeeds` into:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a Needs you item lands: the palette's Enter and a click on a notification share it.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { openReview } from "@/app/view/agents/docreviewstore";
import { openRunDag } from "@/app/view/agents/runrailsections";
import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import type { NeedsTarget } from "./palette-needs";

/** Opens t; false when t names nowhere to go. */
export function openNeedsTarget(model: AgentsViewModel, t: NeedsTarget | null): boolean {
    switch (t?.kind) {
        // … the five cases exactly as they are in command-palette.tsx today, each ending in `return true;`
        default:
            return false;
    }
}
```

Copy the cases verbatim (including the `TaskGroup` cast and its comment); keep whichever import paths
`command-palette.tsx` uses for them.

**Step 3: Use it in the palette**

```ts
    const openNeeds = (t: NeedsTarget | null) => {
        if (openNeedsTarget(model, t)) {
            close();
        }
    };
```

Remove imports from `command-palette.tsx` that are now unused (`openRunDag`, `openReview`, maybe `openTarget` — check
with grep before removing).

**Step 4: Check**

Run: `npx vitest run frontend/app/cockpit frontend/app/view/agents/attentionstore` and
`npx eslint frontend/app/cockpit/openneeds.ts frontend/app/cockpit/command-palette.tsx frontend/app/view/agents/attentionstore.ts`
Expected: PASS, no unused-import errors.

**Step 5: Commit**

```bash
git add frontend/app/view/agents/attentionstore.ts frontend/app/cockpit/openneeds.ts frontend/app/cockpit/command-palette.tsx
git commit -m "refactor(cockpit): openNeedsTarget shared by the palette, and an attention-loaded flag"
```

---

### Task 6: Clickable toasts

**Depends on:** none

**Files:**
- Modify: `frontend/app/cockpit/notificationstore.ts`
- Modify: `frontend/app/cockpit/notificationtoasts.tsx`

**Step 1: Store**

Add `onOpen?: () => void;` to `ToastNotification`. Update the header comment: "A `wsh notify` is not a toast while
arcterm is focused: the avatar is its voice then (petsources.tsx). Agent notifications (notifysync.tsx) are, and carry
an `onOpen`."

**Step 2: Render**

In the button's `onClick`: `onClick={() => { t.onOpen?.(); dismissToast(t.id); }}`, add
`data-notification-open={t.onOpen ? "" : undefined}` and, when `t.onOpen` is set, `cursor-pointer hover:border-accent-700`
to the class list (tokens only, no raw colors).

**Step 3: Check**

Run: `npx prettier --check frontend/app/cockpit/notificationstore.ts frontend/app/cockpit/notificationtoasts.tsx`
Expected: clean.

**Step 4: Commit**

```bash
git add frontend/app/cockpit/notificationstore.ts frontend/app/cockpit/notificationtoasts.tsx
git commit -m "feat(cockpit): a toast can open what it is about"
```

---

### Task 7: The `notify_os` Tauri command

**Depends on:** none

**Files:**
- Create: `src-tauri/src/notify.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs` (mod list, plugin, `generate_handler!`)

**Step 1: Dependencies**

In `src-tauri/Cargo.toml`, under `[target.'cfg(windows)'.dependencies]`:

```toml
# WinRT toasts with an activation callback (notify.rs): a click focuses the window and opens what the toast is about,
# which tauri-plugin-notification cannot report on desktop
tauri-winrt-notification = "0.8"
```

and add a new table:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
tauri-plugin-notification = "2"
```

Run: `cargo tree --manifest-path src-tauri/Cargo.toml -d -i windows 2>&1 | head -30` and note whether it pulls a
second `windows` version. If it does, try the `tauri-winrt-notification` version whose `windows` dependency matches
`=0.61.3` (check docs.rs "Dependencies" per version); if none does, keep 0.8 and say so in the commit body.

**Step 2: Confirm the API** before writing code: on docs.rs for the resolved version, `Toast::new(&str)`, `.title`,
`.text1`, `.sound(Option<Sound>)`, `Sound::Default`, `.on_activated(Fn(Option<String>) -> Result<()>)`,
`.show() -> Result<()>`, `Toast::POWERSHELL_APP_ID`. Adjust the code below to the actual signatures.

**Step 3: `notify.rs`**

```rust
// OS notifications for agent events (frontend notifysync.tsx decides when; this only shows them). Windows uses WinRT
// toasts so a click can focus the window and hand the toast's target back to the frontend; macOS uses the notification
// plugin and a click only raises the app.
use crate::applog::log_line;
use tauri::{AppHandle, Manager};
#[cfg(windows)]
use tauri::Emitter;

/// Emitted with the toast's target (the frontend's JSON) when you click a toast.
pub const ACTIVATED_EVENT: &str = "os-notify-activated";

/// The AppUserModelID a toast is shown under. A release build registers the bundle identifier (main.rs
/// set_app_user_model_id, and the installer's shortcut); a dev build has none registered, and Windows drops a toast
/// from an unregistered id, so it borrows PowerShell's and the toast reads "Windows PowerShell".
#[cfg(windows)]
fn app_id(is_dev: bool, identifier: &str) -> String {
    if is_dev {
        tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_string()
    } else {
        identifier.to_string()
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn notify_os(app: AppHandle, title: String, body: String, target: String, loud: bool) {
    if loud {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
    if let Err(e) = show(&app, &title, &body, target, loud) {
        log_line(&format!("[tauri] notify_os failed: {}", e));
    }
}

#[cfg(windows)]
fn show(app: &AppHandle, title: &str, body: &str, target: String, loud: bool) -> Result<(), String> {
    use tauri_winrt_notification::{Sound, Toast};
    let handle = app.clone();
    Toast::new(&app_id(cfg!(debug_assertions), &app.config().identifier))
        .title(title)
        .text1(body)
        .sound(if loud { Some(Sound::Default) } else { None })
        .on_activated(move |_action| {
            focus_main(&handle);
            if let Err(e) = handle.emit(ACTIVATED_EVENT, target.clone()) {
                log_line(&format!("[tauri] notify activation emit failed: {}", e));
            }
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn show(app: &AppHandle, title: &str, body: &str, _target: String, loud: bool) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let mut b = app.notification().builder().title(title).body(body);
    if loud {
        b = b.sound("default");
    }
    b.show().map_err(|e| e.to_string())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn show(_app: &AppHandle, _title: &str, _body: &str, _target: String, _loud: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dev_borrows_powershells_app_id() {
        assert_eq!(app_id(true, "dev.arc.app"), tauri_winrt_notification::Toast::POWERSHELL_APP_ID);
    }

    #[test]
    fn release_uses_the_bundle_identifier() {
        assert_eq!(app_id(false, "dev.arc.app"), "dev.arc.app");
    }
}
```

**Step 4: Register** in `main.rs`: `mod notify;` beside the other `mod` lines; `notify::notify_os` in
`generate_handler!`; and before `.manage(InitState…)`:

```rust
        // macOS shows notify_os toasts through the plugin; Windows calls WinRT directly (notify.rs)
        #[cfg(target_os = "macos")]
        let builder = builder.plugin(tauri_plugin_notification::init());
```

(restructure the builder chain into a `let builder = tauri::Builder::default()…;` binding as needed). No capability
change: the command is app-defined and the plugin is used from Rust only.

**Step 5: Test and build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml notify`
Expected: 2 passed.
Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors, no new warnings from `notify.rs`.

**Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/notify.rs src-tauri/src/main.rs
git commit -m "feat(tauri): notify_os shows an OS toast and reports its click"
```

---

### Task 8: `NotifySync`

**Depends on:** Task 1, Task 3, Task 4, Task 5, Task 6, Task 7

**Files:**
- Create: `frontend/app/view/agents/notifysync.tsx`
- Modify: `frontend/app/view/agents/cockpitshell.tsx` (mount it after `useDockBadge()` … inside the returned tree)

**Step 1: Write the component**

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Tells you when an agent needs you or finished, in the always-mounted shell since that can happen while any surface
// shows. notifyevents.ts decides what and where; this feeds it the roster, the attention list and `wsh notify`, holds a
// burst for COALESCE_MS, and delivers to the toast stack or to notify_os. A click on either lands through openref /
// openNeedsTarget, as the palette's Enter does.

import { openNeedsTarget } from "@/app/cockpit/openneeds";
import { needsRows, needsTarget } from "@/app/cockpit/palette-needs";
import { pushToast } from "@/app/cockpit/notificationstore";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { centerModeAtom } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { attentionAtom, attentionLoadedAtom } from "./attentionstore";
import { agentGridAtom } from "./gridstore";
import {
    coalesce,
    COALESCE_MS,
    diffEvents,
    notifyEventOf,
    routeNotify,
    snapshotOf,
    type NotifyEvent,
    type NotifyRoute,
    type NotifySnapshot,
    type NotifyTarget,
    type RouteCtx,
} from "./notifyevents";
import { viewingIds } from "./unreadagents";

const ACTIVATED_EVENT = "os-notify-activated"; // notify.rs ACTIVATED_EVENT

function openNotifyTarget(model: AgentsViewModel, t: NotifyTarget): void {
    switch (t.kind) {
        case "agent":
            model.openTerminal(t.agentId);
            return;
        case "attention": {
            const item = globalStore.get(attentionAtom).find((i) => i.key === t.key);
            if (item == null || !openNeedsTarget(model, needsTarget(needsRows([item], globalStore.get(model.agentsAtom))[0]))) {
                globalStore.set(model.surfaceAtom, "cockpit");
            }
            return;
        }
        case "cockpit":
            globalStore.set(model.surfaceAtom, "cockpit");
            return;
        case "none":
            return;
    }
}

function parseTarget(raw: unknown): NotifyTarget {
    try {
        const t = JSON.parse(String(raw)) as NotifyTarget;
        return t?.kind ? t : { kind: "none" };
    } catch {
        return { kind: "none" };
    }
}

export function NotifySync({ model }: { model: AgentsViewModel }): null {
    const agents = useAtomValue(model.agentsAtom);
    const attention = useAtomValue(attentionAtom);
    const attentionLoaded = useAtomValue(attentionLoadedAtom);
    const focused = useAtomValue(atoms.documentHasFocus);
    const focusId = useAtomValue(model.focusIdAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const center = useAtomValue(centerModeAtom);
    const grid = useAtomValue(agentGridAtom);
    const os = (useAtomValue(getSettingsKeyAtom("notify:os")) as boolean | undefined) ?? true;
    const toast = (useAtomValue(getSettingsKeyAtom("notify:toast")) as boolean | undefined) ?? true;
    const reply = (useAtomValue(getSettingsKeyAtom("notify:reply")) as boolean | undefined) ?? true;

    // routing reads the state at the moment of the event, through a ref so the subscriptions below stay put
    const ctx = useRef<RouteCtx>(null);
    ctx.current = {
        focused,
        viewing: viewingIds(focused, surface === "agent", center, focusId, grid),
        settings: { os, toast, reply },
    };
    const buffer = useRef<{ route: NotifyRoute; event: NotifyEvent }[]>([]);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const deliver = (route: NotifyRoute, e: NotifyEvent) => {
        if (route === "toast") {
            pushToast({
                title: e.title,
                message: e.body,
                level: e.loud ? "warn" : "info",
                onOpen: e.target.kind === "none" ? undefined : () => openNotifyTarget(model, e.target),
            });
        } else if (route === "os") {
            invoke("notify_os", { title: e.title, body: e.body, target: JSON.stringify(e.target), loud: e.loud }).catch(
                () => {}
            );
        }
    };
    const flush = () => {
        timer.current = null;
        const held = buffer.current;
        buffer.current = [];
        for (const route of ["os", "toast"] as const) {
            for (const e of coalesce(held.filter((h) => h.route === route).map((h) => h.event))) {
                deliver(route, e);
            }
        }
    };
    const enqueue = (events: NotifyEvent[]) => {
        for (const event of events) {
            const route = routeNotify(event, ctx.current!);
            if (route === "os" || route === "toast") {
                buffer.current.push({ route, event });
            }
        }
        if (buffer.current.length > 0 && timer.current == null) {
            timer.current = setTimeout(flush, COALESCE_MS);
        }
    };

    const prev = useRef<NotifySnapshot | null>(null);
    useEffect(() => {
        const next = snapshotOf(agents, attention, attentionLoaded);
        enqueue(diffEvents(prev.current, next));
        prev.current = next;
    }, [agents, attention, attentionLoaded]);

    useEffect(
        () =>
            waveEventSubscribeSingle({
                eventType: "notify",
                handler: (event) => {
                    const e = notifyEventOf(event?.data as NotifyCommandData | undefined);
                    if (e != null) {
                        enqueue([e]);
                    }
                },
            }),
        []
    );

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let live = true;
        listen<string>(ACTIVATED_EVENT, (e) => openNotifyTarget(model, parseTarget(e.payload)))
            .then((u) => (live ? (unlisten = u) : u()))
            .catch(() => {});
        return () => {
            live = false;
            unlisten?.();
            if (timer.current != null) {
                clearTimeout(timer.current);
            }
        };
    }, [model]);

    return null;
}
```

Check `waveEventSubscribeSingle` returns an unsubscribe function (it does in `petsources.tsx`, which keeps
`unsubNotify` and calls it); if it does not, wrap it the way petsources does.

**Step 2: Mount** in `CockpitShell`'s returned tree, beside `<DocReviewDialog model={model} />`:

```tsx
            {/* a turn can end or an ask can land while any surface shows */}
            <NotifySync model={model} />
```

**Step 3: Typecheck and lint**

Run: `task check:ts` (timeout 300000 ms)
Expected: exit 0.
Run: `npx eslint frontend/app/view/agents/notifysync.tsx frontend/app/view/agents/cockpitshell.tsx`
Expected: clean (a react-hooks exhaustive-deps warning on the effects that close over `enqueue` is expected; silence it
with a one-line `// eslint-disable-next-line react-hooks/exhaustive-deps` and a reason only if the config treats it as
an error).

**Step 4: Smoke in the dev app** (if one is running; do not start a build just for this): background the window, flip
an agent to asking (any real Claude session hitting a permission prompt), see the OS toast, click it, see the agent
open. Note the result in the commit body; if no dev app is running, say "not run".

**Step 5: Commit**

```bash
git add frontend/app/view/agents/notifysync.tsx frontend/app/view/agents/cockpitshell.tsx
git commit -m "feat(agents): notify when an agent needs you or finishes, in app or through the OS"
```

---

### Task 9: Notifications section in Settings

**Depends on:** Task 1

**Files:**
- Modify: `frontend/app/view/agents/settingsmodel.ts` (a new section after `general`)
- Modify: `frontend/app/view/agents/settingssurface.tsx` (`SectionBody` case + `NotificationsSection`)
- Test: `frontend/app/view/agents/settingsmodel.test.ts` (only if it pins the section list)

**Step 1: Section def** (after the `general` section):

```ts
        {
            id: "notifications",
            name: "Notifications",
            blurb: "When an agent needs you or finishes: an OS notification while arcterm is in the background, a toast while it is in front.",
            group: "Cockpit",
            rows: [
                {
                    id: "notifications.os",
                    title: "OS notifications",
                    desc: "Show a system notification while arcterm is in the background. Clicking it opens the agent.",
                    key: "notify:os",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "notifications.toast",
                    title: "In-app toasts",
                    desc: "Show a toast while arcterm is in front, unless you are already looking at that agent.",
                    key: "notify:toast",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "notifications.reply",
                    title: "When an agent finishes",
                    desc: "Also notify when an agent finishes its turn, not only when it needs you. Run workers never do.",
                    key: "notify:reply",
                    scope: "synced",
                    config: true,
                },
            ],
        },
```

**Step 2: Section body** — in `SectionBody` add `case "notifications": return <NotificationsSection />;` and, beside
`TerminalSection`:

```tsx
function NotificationsSection() {
    const os = (useAtomValue(getSettingsKeyAtom("notify:os")) as boolean | undefined) ?? true;
    const toast = (useAtomValue(getSettingsKeyAtom("notify:toast")) as boolean | undefined) ?? true;
    const reply = (useAtomValue(getSettingsKeyAtom("notify:reply")) as boolean | undefined) ?? true;
    return (
        <div>
            <SettingRow id="notifications.os">
                <Toggle on={os} onToggle={() => writeConfig({ "notify:os": !os })} label="OS notifications" />
            </SettingRow>
            <SettingRow id="notifications.toast">
                <Toggle on={toast} onToggle={() => writeConfig({ "notify:toast": !toast })} label="In-app toasts" />
            </SettingRow>
            <SettingRow id="notifications.reply">
                <Toggle on={reply} onToggle={() => writeConfig({ "notify:reply": !reply })} label="When an agent finishes" />
            </SettingRow>
        </div>
    );
}
```

**Step 3: Tests**

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts`
Expected: PASS; if a test pins the section ids or counts, add `notifications` where `general` sits.

**Step 4: Commit**

```bash
git add frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingssurface.tsx frontend/app/view/agents/settingsmodel.test.ts
git commit -m "feat(settings): a Notifications section"
```

---

### Task 10: CDP scenario `notify-toast`

**Depends on:** Task 8, Task 9

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (a new scenario before `export const SCENARIOS`, and its entry in the list)

Model it on `agentUploads` (`scripts/cdp/scenarios.mjs:15871`): its `openUploadsAgent` / `publishUploadsStatus`
helpers make a plain terminal tab an agent by publishing `agent:status`, and its teardown closes the tab and waits for
the roster to drop it. Do not run prettier on this file.

**Steps the scenario asserts** (each a `rec(step, ok, detail)`):

1. *arrange:* a terminal tab `verify-notify` published as a working claude agent; `h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true })` then `h.ev('window.dispatchEvent(new Event("focus"))')` so `documentHasFocus` is true; `h.goto("cockpit")` so no agent is in view; wait until the roster lists the agent (`[data-agent-row="<tabId>"]` exists after a brief `h.goto("agent")` and back, or poll the Cockpit for its name).
2. **"a toast appears when an out-of-view agent starts asking"**: publish `state: "asking"` for the block; `polishWaitFor` up to 6000 ms for a `[data-notification-toast]` whose text includes `verify-notify needs you` (the agent's name is the published `title`; adjust to the name the roster shows). Shot.
3. **"clicking the toast opens the agent"**: click that toast; wait for the Agent surface to show `[data-agent-terminal="<tabId>"]` not `hidden`.
4. **"no toast for the agent in view"**: with that agent focused, publish `working` then `asking` again; wait 3000 ms; assert no new toast with that text.
5. **"Settings lists the Notifications section"**: `h.goto("settings")`, click `[data-section="notifications"]`, assert the three row titles (`OS notifications`, `In-app toasts`, `When an agent finishes`) are in the page. Shot.

*teardown:* close the tab (as `agentUploads` does), `Emulation.setFocusEmulationEnabled { enabled: false }`, dismiss any
toast left (`document.querySelectorAll("[data-notification-toast]")` click).

**Run** (only against a dev app that is already running; do not start one just for this):
`task verify:ui -- notify-toast`
Expected: PASS table. If no dev app is running, leave it to the plan's Final.

**Commit**

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(cdp): notify-toast scenario"
```

---

### Task 11: Docs

**Depends on:** Task 8, Task 9

**Files:**
- Modify: `CHANGELOG.md` (top section, `Unreleased`; open one if the top section has a date)
- Modify: `docs/open-issues.md:168`
- Modify: `docs/superpowers/specs/2026-10-07-agent-notifications-design.md` (Status line)

**Step 1: CHANGELOG** — under `Added`: "Notifications when an agent needs you or finishes its turn: a system
notification while arcterm is in the background (click it to open the agent), a toast while it is in front. Settings →
Notifications turns each off." Under `Changed`: "An agent waiting on a permission prompt now shows amber, like one
asking a question."

**Step 2: open-issues row** — rewrite it to: "(arcterm) Windows taskbar overlay badge when arcterm is backgrounded (OS
notifications ship, 2026-10-07; the Dock badge covers macOS) — measure-first | feature | S | `dockbadgesync.ts`".

**Step 3: Spec status** — "Status: built 2026-10-07." and note the Settings section under Settings.

**Step 4: Commit**

```bash
git add CHANGELOG.md docs/open-issues.md docs/superpowers/specs/2026-10-07-agent-notifications-design.md
git commit -m "docs: agent notifications in the changelog and open issues"
```

Note: `CHANGELOG.md` had uncommitted edits from other work when this plan was written, and interactive staging is
unavailable. If `git diff CHANGELOG.md` still shows hunks that are not yours, leave `CHANGELOG.md` out of the commit and
tell the user, rather than committing someone else's lines.
