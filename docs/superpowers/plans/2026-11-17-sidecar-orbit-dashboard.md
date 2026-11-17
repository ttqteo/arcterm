# Sidecar as an orbit dashboard (P and Q), its own taskbar button and icon

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-11-17-sidecar-orbit-dashboard-design.md` (all of it, the Taskbar section included)
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sidecar-orbit sidecar-compact`
**Prototype:** D:\projects\arcterm\.superpowers\design\cockpit-window\project\

**Goal:** Replace the Sidecar wall of tiles and the small form's list with one dashboard drawn two ways: P (full window:
an orbit of agents around a core counting what waits on you, a Needs you queue, the active run, 2 hours of lanes) and Q
(the compact window); both reactive across five states (calm, normal, RAM high, RAM critical, a run failed). On
Windows, Sidecar also gets its own taskbar button and icon.

**Architecture:** Nothing about the window, the bridge's lifecycle, the snapshot event, the strain model or the keys'
contract changes. The bridge (`frontend/app/cockpit/sidecarbridge.tsx`) builds a bigger snapshot: the Needs you list
(`sidecarneeds.ts`, pure), each agent's spans of the last 2 hours (`sidecartimeline.ts`, pure, kept in the bridge),
the orbit's eight agents, the active run and the 5-hour and weekly usage. The page draws it with two new views
(`sidecarorbit.tsx` for P, `sidecarcompact.tsx` for Q) over one pure page model (`sidecarorbitmodel.ts`). The wall,
the small form's list, scrollback and `sidecarhistory.ts` go. The host (`src-tauri/src/sidecar.rs`) gives the Sidecar
window its own AppUserModelID and the badge icon `gen-app-icon.mjs` draws.

**Tech Stack:** React 19, jotai, Tailwind 4 tokens, framer-motion (`element/motiontokens.ts`), inline SVG, vitest; Rust
(`windows` / `windows-sys` crates already in `src-tauri/Cargo.toml`); raw CDP scenarios (`scripts/cdp/`).

---

## Read before any task

- `DESIGN.md` in full (tokens, selection is grey, status never by colour alone, motion only for a change, and the
  Sidecar exception Task 9 adds).
- The boards in the Prototype folder: `P-calm`, `P-orbit-dashboard` (normal), `P-high`, `P-critical`, `P-failed`,
  `P-live` (plays the states in turn), `Q-compact-live` (Q, playing the same states). Copy sizes, spacing and copy from
  them; the colours there are the tokens below, written as hex because a board has no Tailwind.
- The taskbar icon's board: `D:\projects\arcterm\.superpowers\design\sidecar-icon\project\F-badge-screen.dc.html`.
- What exists and stays: `sidecartypes.ts` (the wire types), `sidecarsnapshot.ts` (roster → tiles, `wallAgentIds`,
  tile order), `sidecarbridgemodel.ts` (`validateAct`, throttling, machine and heavy-row helpers),
  `sidecarstrainmodel.ts` and `sidecarband.tsx` (the strain band: unchanged), `sidecartitlebar.tsx`,
  `sidecarlayout.ts` (`layoutFor`, the S and pin buttons), `frontend/tauri/sidecar.tsx` (the page).

## Decisions made beyond the spec (with why)

1. **Additive first, removal last.** Tasks 1–7 only add fields, files and functions; the wall keeps compiling until
   Task 8 switches the page and deletes it. Why: every worker typechecks its own tree, and tasks 2–7 run in parallel.
2. **An answer still names its agent and its ask** (`{kind:"answer"; id; option; key}`), but `validateAct` checks it
   against `snap.needs` (an `ask` row with that `id` and `askKey`), not against `snap.tiles`: the orbit holds 8 agents,
   and a ninth asking agent is still a Needs you row. **`option` stays 0-based, as today** (`wallKey` maps key `1` to
   option 0; `validateAct` takes `0..options.length-1`): key `2` sends `option: 1`.
3. **A Jarvis row opens through one new act, `{kind:"need"; key}`.** The bridge keeps the `PeekRow`s it built
   (`queueRows` in `view/jarvis/petpeekmodel.ts`, as the tray does) by key. `rowPeekTarget(row)` returns a
   `PetTarget` (`{kind:"oref"; ref; anchor?}`), not an `OpenTarget`, so the bridge opens it as `petpeek.tsx:916` does:
   `openAddress(model, t.ref, { anchor: t.anchor })`, then `showMain()`. A question row's Enter is the existing `open`
   act. Why: the tray already turns an attention item into the target its escort opens; Sidecar reuses that, not a
   second mapping.
4. **The question heuristic reads the full last message**, not the tile's cut rows (cut to 240 characters from the
   start, which loses the end): per agent, `entriesToShow(liveEntriesByIdAtom[id] ?? [], agent.previousInfo)`
   (`view/agents/agentrowmodel.ts:11`), the same fallback the agent row uses, so a fixture roster (which carries
   `previousInfo`, no live stream) reaches it too. An agent with neither gets no question row.
5. **The run box shows the newest active orchestrator run in `model.lineageAtom`'s `runs`** (not done, not quick),
   with `runProgress(run.dag)` and `run.title` (`RunInfo` already carries its title; `runTitle` takes a `Run`, not a
   `RunInfo`). "due today" is the first `chunk-due` attention item's `chunklabel`, left out when there is none. In
   DEV, `window.__sidecarRun(box)` overrides it (Task 4), since a fixture roster has no server run in the lineage.
6. **A run is failed while a failed need names it**: a Needs you row with `failed` whose attention item's `runid` is
   the run's id. Engine events never set `failed` (a retried task's `task-failed` stays in the history and would frame
   the window red for good); they only date it: when the run is failed, its lead's lane turns red from the first
   `failed` rail event of `runRailEvents(run, runEventsAtom(runId))` if there is one, else from the moment the need
   appeared. The bridge calls `ensureRunEvents(runId, channelId)` once per active run it shows.
7. **The usage rings read `planDonuts(...)` in the bridge** (the same pure function `usePlanDonuts` wraps), the
   `claude` provider's `fivehour.pct` and `week.pct`. No Claude provider: those two rings are drawn empty with `–`.
8. **The timeline records for the bridge's whole life, not only while Sidecar is open** (spec "The timeline's data":
   the bridge keeps the history because it is always mounted). One subscription to the roster atom starts when the
   bridge mounts and stops when it unmounts, never on close; it holds the `Timeline` in the bridge's module scope.
   It is cheap (one pure reduce per roster change). The snapshot build reads it; it does not reset it.
9. **Spans go to the page unclipped** (the recorder already drops spans that ended more than 2 hours ago); the page
   clips the first to the window's edge in `laneBars`. A span clipped in the bridge would differ on every build and
   defeat `sameSnapshot`.
10. **Q is drawn for the host's small form, 340 × 440** (`sidecar.rs` `SMALL_SIZE`/`MIN_SIZE` and its tests), not the
    board's 380 px: the window size is the shipped contract and the spec keeps the window as it is. The spec's
    "380 px" is amended to 340 px.

## Tokens used by the views (no hex in components)

`warning` waits on you · `success` working · `error` failed, RAM critical · `secondary` finished · `muted` idle and
figures · `askingbg` a waiting row · `errorbg` a failed row (Task 9) · `surface-raised` rows · `surface-hover` the
selected row, with a grey `ring-2 ring-inset ring-edge-strong` (check the token name in `tailwindsetup.css`; never
the accent) · `diff-added` / `diff-removed` for `+N −N`.

---

### Task 1: Snapshot types and the orbit's capacity
**Depends on:** none
**Files:** `frontend/app/cockpit/sidecartypes.ts`, `frontend/app/cockpit/sidecarsnapshot.ts`, `frontend/app/cockpit/sidecarsnapshot.test.ts`

**Step 1: Add the wire types** (keep every existing field; Task 8 removes the old ones).

```ts
/** One stretch of an agent's state on the 2-hour timeline. `to` absent: still in it. UnixMilli. */
export type SidecarSpanState = "working" | "asking" | "finished" | "failed";
export interface SidecarSpan {
    state: SidecarSpanState;
    from: number;
    to?: number;
}

/** One row of Needs you: an ask, a finished agent's question, or something Jarvis holds for you. */
export type SidecarNeedKind = "ask" | "question" | "jarvis";
export interface SidecarNeed {
    key: string; // ask: "ask:<agent id>"; question: "q:<agent id>"; jarvis: the AttentionItem's key
    kind: SidecarNeedKind;
    id?: string; // the agent, for ask and question rows
    who: string; // the agent's name, or the item's channel / source
    since: number; // UnixMilli it began waiting; the list is oldest first
    text: string; // the question in its own words, or the item's text
    word?: string; // jarvis rows: kindWord(kind, retry), "gate", "blocked", "due"…
    failed?: boolean; // a run held at Final or with a failed task
    options?: string[]; // ask rows
    answerable?: boolean; // ask rows: 1-9 answers it here
    askKey?: string; // ask rows: SidecarAsk.key
    sent?: boolean; // ask rows: the answer went out
}

export interface SidecarRunBox {
    id: string;
    leadId?: string; // the lead agent's tile id, whose node and lane carry the run
    title: string;
    done: number;
    total: number;
    failed: boolean;
    since?: number; // run created, UnixMilli
    due?: string; // the first due chunk's label
}

export interface SidecarUsage {
    fiveHourPct?: number;
    weekPct?: number;
}
```

Add to `SidecarTile`: `failed?: boolean; diff?: { adds: number; dels: number }; spans?: SidecarSpan[]`.
Add to `SidecarSnapshot`: `needs?: SidecarNeed[]; run?: SidecarRunBox; usage?: SidecarUsage; more?: number` (`more`:
agents past the orbit's 8). Add to `SidecarAct`: `| { kind: "need"; key: string }`.

**Step 2: Write the failing tests** for `orbitTiles` in `sidecarsnapshot.test.ts`:

```ts
describe("orbitTiles", () => {
    const t = (id: string, state: SidecarTileState, failed = false): SidecarTile => ({
        id, name: id, runtime: "Claude", state, messages: [], ...(failed ? { failed } : {}),
    });
    it("keeps all of 8 or fewer, in order", () => {
        const tiles = [t("a", "working"), t("b", "asking")];
        expect(orbitTiles(tiles, new Set(), 8)).toEqual({ tiles, more: 0 });
    });
    it("past 8: waiting or failed first, then working, then finished, in snapshot order", () => {
        const tiles = [
            t("w1", "working"), t("r1", "review"), t("a1", "asking"), t("w2", "working"), t("i1", "idle"),
            t("f1", "working", true), t("w3", "working"), t("r2", "review"), t("q1", "review"), t("i2", "idle"),
        ];
        const r = orbitTiles(tiles, new Set(["q1"]), 8); // q1 has a question row: it waits on you
        expect(r.tiles.map((x) => x.id)).toEqual(["a1", "f1", "q1", "w1", "w2", "w3", "r1", "i1"]);
        expect(r.more).toBe(2);
    });
    it("leaves asleep agents out of the orbit and counts them in more", () => {
        const r = orbitTiles([t("s1", "asleep"), t("w1", "working")], new Set(), 8);
        expect(r.tiles.map((x) => x.id)).toEqual(["w1"]);
        expect(r.more).toBe(1);
    });
});
```

**Step 3:** `npx vitest run frontend/app/cockpit/sidecarsnapshot.test.ts` → FAIL (`orbitTiles` is not exported).

**Step 4: Implement** in `sidecarsnapshot.ts`:

```ts
/** The orbit holds this many agents (spec "The orbit's capacity"). */
export const ORBIT_MAX = 8;

function orbitRank(t: SidecarTile, waiting: ReadonlySet<string>): number {
    if (t.state === "asking" || t.failed || waiting.has(t.id)) {
        return 0;
    }
    if (t.state === "working") {
        return 1;
    }
    return t.state === "asleep" ? 3 : 2;
}

/**
 * The agents the orbit draws: every one that is not asleep, in the snapshot's order, when they fit; past `max`, those
 * that wait on you or failed (`waiting` holds the agents with a question row), then working, then finished, each group
 * in the snapshot's order, up to `max`. Asleep agents are never drawn. `more` counts the rest, for the core's `+N`.
 */
export function orbitTiles(
    tiles: SidecarTile[],
    waiting: ReadonlySet<string>,
    max = ORBIT_MAX
): { tiles: SidecarTile[]; more: number } {
    const awake = tiles.filter((t) => t.state !== "asleep");
    const drawn =
        awake.length <= max
            ? awake
            : awake
                  .map((t, i) => ({ t, i, r: orbitRank(t, waiting) }))
                  .sort((x, y) => x.r - y.r || x.i - y.i)
                  .slice(0, max)
                  .map((x) => x.t);
    return { tiles: drawn, more: tiles.length - drawn.length };
}
```

The first test (`[working, asking]` kept in that order) holds because 8 or fewer are never ranked; add a fourth test
with 9 awake tiles where an asking one sits last, to show ranking starts only past 8.

**Step 5:** run the test → PASS. `task check:ts` → exit 0.

**Step 6: Commit** `git commit -m "feat(sidecar): snapshot types for the orbit dashboard, and the orbit's capacity" -- frontend/app/cockpit/sidecartypes.ts frontend/app/cockpit/sidecarsnapshot.ts frontend/app/cockpit/sidecarsnapshot.test.ts`

---

### Task 2: What waits on you (`sidecarneeds.ts`)
**Depends on:** Task 1 (uses the `SidecarNeed` and `SidecarTile` types it adds)
**Files:** `frontend/app/cockpit/sidecarneeds.ts`, `frontend/app/cockpit/sidecarneeds.test.ts`

The three sources, one list, oldest first (spec "What waits on you"). Pure: the bridge passes in what it read.

**Step 1: Write the failing tests** covering, one `it` each:

- `endsInQuestion`: `"Done. Bạn chọn (a) hay (b)?"` → `"Bạn chọn (a) hay (b)?"`; full-width `？` counts; trailing
  markdown and quotes are ignored (`"…merge it?**"`, `` "…ok?`" ``, `'…ok?")'`); `"Done."` → `null`; a `?` inside a
  code fence at the end (```` "```\nx?\n```" ````) → `null` (strip fenced blocks first); empty → `null`; the sentence
  is the text after the last `.`, `!`, `?`, `。` or newline before the final `?`, trimmed.
- `lastQuestion(entries)`: the last `message` entry's question; `null` when a `user` entry follows it; `null` with no
  message; an `action` after the message does not cancel it.
- `sidecarNeeds`: asks come from tiles in state `asking` (`who` = name, `text` = `ask.question`, `options`,
  `answerable`, `askKey` = `ask.key`, `sent`, `since` = tile.since); a `review` tile with a question in its entries is
  a `question` row (`since` = tile.since); an `idle` tile is one only within the 5-minute grace (`now - since <=
  IDLE_GRACE_MS`, from `view/agents/agentsviewmodel.ts:1083`; an idle tile with no `since` counts as within it), so
  an idle tile 6 minutes old with a question gets no row (test both sides of the edge); an `asking` tile never also
  gets a question row; `asleep` never;
  jarvis items become rows with `word` = `kindWord(item.kind, item.retry)`, `failed` true exactly for `run-unverified`
  and for `dag-blocked` with `retry: true`; `who` = `item.channelname || item.source`; items of kind `ask` are skipped
  (the caller passes `splitAttention(...).jarvis`, but be safe); the whole list sorts by `since` ascending, ties keep
  source order (asks, questions, jarvis); a tile with no `since` takes `input.now` (it reads as just started, so it
  sorts after the ones that waited longer).

**Step 2:** `npx vitest run frontend/app/cockpit/sidecarneeds.test.ts` → FAIL (module not found).

**Step 3: Implement.**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What waits on you in Sidecar (spec 2026-11-17-sidecar-orbit-dashboard-design.md, "What waits on you"): the asks the
// snapshot carries, a finished agent whose last message ends in a question (a heuristic: never a 1-9 answer), and what
// Jarvis holds for you (attentionAtom's jarvis half). One list, oldest first. Pure.

import { IDLE_GRACE_MS, type AgentEntry } from "@/app/view/agents/agentsviewmodel";
import { kindWord } from "@/app/view/jarvis/briefingmodel";
import type { SidecarNeed, SidecarTile } from "./sidecartypes";

const FENCE = /```[\s\S]*?```/g;
// closing marks a question may carry after its "?": markdown emphasis, code, quotes, brackets
const TRAILING = /[\s*_`"'”’)\]»]+$/;

/** The last sentence of `text` when it ends in a question mark (ASCII or full-width), else null. */
export function endsInQuestion(text: string): string | null {
    const t = text.replace(FENCE, "").replace(TRAILING, "");
    if (!t.endsWith("?") && !t.endsWith("？")) {
        return null;
    }
    const body = t.slice(0, -1);
    const cut = Math.max(...[".", "!", "?", "？", "。", "\n"].map((c) => body.lastIndexOf(c)));
    const sentence = t.slice(cut + 1).trim();
    return sentence === "" ? null : sentence;
}

/** The question an agent's last message ends on, unless the person has written to it since. */
export function lastQuestion(entries: readonly AgentEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "user") {
            return null;
        }
        if (e.kind === "message") {
            return endsInQuestion(e.text);
        }
    }
    return null;
}

export interface NeedsInput {
    tiles: readonly SidecarTile[]; // the whole roster's tiles (the base snapshot), not the orbit's 8
    entriesById: Readonly<Record<string, AgentEntry[]>>; // per agent: entriesToShow(live, previousInfo) (decision 4)
    jarvis: readonly AttentionItem[];
    now: number; // UnixMilli: the `since` of a tile that has none
}

function isFailedItem(i: AttentionItem): boolean {
    return i.kind === "run-unverified" || (i.kind === "dag-blocked" && i.retry === true);
}

export function sidecarNeeds(input: NeedsInput): SidecarNeed[] {
    const asks: SidecarNeed[] = [];
    const questions: SidecarNeed[] = [];
    for (const t of input.tiles) {
        if (t.state === "asking" && t.ask != null) {
            const n: SidecarNeed = {
                key: `ask:${t.id}`, kind: "ask", id: t.id, who: t.name, since: t.since ?? input.now,
                text: t.ask.question, options: t.ask.options, answerable: t.ask.answerable,
            };
            if (t.ask.key != null) n.askKey = t.ask.key;
            if (t.sent) n.sent = true;
            asks.push(n);
        } else if (
            t.state === "review" ||
            (t.state === "idle" && input.now - (t.since ?? input.now) <= IDLE_GRACE_MS)
        ) {
            const q = lastQuestion(input.entriesById[t.id] ?? []);
            if (q != null) {
                questions.push({ key: `q:${t.id}`, kind: "question", id: t.id, who: t.name, since: t.since ?? input.now, text: q });
            }
        }
    }
    const jarvis: SidecarNeed[] = input.jarvis
        .filter((i) => i.kind !== "ask")
        .map((i) => {
            const n: SidecarNeed = {
                key: i.key, kind: "jarvis", who: i.channelname || i.source, since: i.waitingsince,
                text: i.text, word: kindWord(i.kind, i.retry),
            };
            if (isFailedItem(i)) n.failed = true;
            return n;
        });
    // a stable sort: equal ages keep asks, then questions, then Jarvis
    return [...asks, ...questions, ...jarvis].sort((a, b) => a.since - b.since || 0);
}
```

Before relying on `waitingsince`, open `pkg/jarvis/attention.go` (`WaitingSince: m.Ts` at :341) and confirm it is
UnixMilli; if it is seconds, multiply by 1000 here and say so in a comment.

**Step 4:** run the tests → PASS. `task check:ts` → exit 0.

**Step 5: Commit** `git commit -m "feat(sidecar): what waits on you, asks, questions and Jarvis in one list" -- frontend/app/cockpit/sidecarneeds.ts frontend/app/cockpit/sidecarneeds.test.ts`

---

### Task 3: The 2-hour timeline (`sidecartimeline.ts`)
**Depends on:** Task 1 (uses the `SidecarSpan` type it adds)
**Files:** `frontend/app/cockpit/sidecartimeline.ts`, `frontend/app/cockpit/sidecartimeline.test.ts`

**Step 1: Write the failing tests**, one `it` each:

- first sighting records one open span from `since` (or `now` with none): `recordTimeline({}, [{id:"a", state:"working", since: now-60_000}], now)` → `{a:[{state:"working", from: now-60_000}]}`;
- a sighting in the same state changes nothing and returns the **same object** (`toBe`);
- a change closes the open span at `now` and opens the next (`working` → `review` gives `[{working, from, to: now}, {finished, from: now}]`);
- `review` and `idle` both map to `finished`; `asleep` closes the open span and opens none; `failed: true` maps to `failed` whatever the state;
- an agent missing from `seen` is dropped;
- spans that ended more than 2 hours before `now` are dropped; at most 64 spans per agent, the newest kept;
- a span that began before `now - 2h` and is still open, or ended inside the window, is kept as it is (unclipped:
  the page clips it, decision 9), and a sighting in the same state returns the same object even as the window moves;
- `failedFrom(events)` returns the `ts` of the first `failed` rail event, or `null`.

**Step 2:** `npx vitest run frontend/app/cockpit/sidecartimeline.test.ts` → FAIL.

**Step 3: Implement.**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The 2-hour timeline Sidecar draws under the orbit (spec 2026-11-17-sidecar-orbit-dashboard-design.md, "The
// timeline's data"). Nothing keeps a plain agent's past states, so the bridge, always mounted in the shell, records each
// agent's state changes here. Pure: the bridge holds the Timeline and passes each build's sightings in.

import type { RailEvent } from "@/app/view/agents/cockpitevents";
import type { SidecarSpan, SidecarSpanState, SidecarTileState } from "./sidecartypes";

export const TIMELINE_WINDOW_MS = 2 * 60 * 60 * 1000;
export const MAX_SPANS = 64;

export type Timeline = Readonly<Record<string, readonly SidecarSpan[]>>;
export interface Sighting {
    id: string;
    state: SidecarTileState;
    since?: number;
    failed?: boolean;
}

export function spanStateOf(s: Pick<Sighting, "state" | "failed">): SidecarSpanState | null {
    if (s.failed) return "failed";
    switch (s.state) {
        case "working":
        case "asking":
            return s.state;
        case "review":
        case "idle":
            return "finished";
        default:
            return null; // asleep: no lane
    }
}

function prune(spans: SidecarSpan[], now: number): SidecarSpan[] {
    const edge = now - TIMELINE_WINDOW_MS;
    return spans.filter((s) => s.to == null || s.to >= edge).slice(-MAX_SPANS);
}

export function recordTimeline(t: Timeline, seen: readonly Sighting[], now: number): Timeline {
    let changed = Object.keys(t).length !== seen.length;
    const next: Record<string, readonly SidecarSpan[]> = {};
    for (const s of seen) {
        const state = spanStateOf(s);
        const had = t[s.id];
        if (had == null) {
            changed = true;
            next[s.id] = state == null ? [] : [{ state, from: s.since ?? now }];
            continue;
        }
        const open = had.length > 0 && had[had.length - 1].to == null ? had[had.length - 1] : null;
        if (open?.state === state || (open == null && state == null)) {
            const kept = prune([...had], now);
            if (kept.length !== had.length) changed = true;
            next[s.id] = kept.length !== had.length ? kept : had;
            continue;
        }
        changed = true;
        const spans = had.map((x) => (x === open ? { ...x, to: now } : x));
        if (state != null) spans.push({ state, from: now });
        next[s.id] = prune(spans, now);
    }
    return changed ? next : t;
}

/** When a run's engine events first say it failed, or null. */
export function failedFrom(events: readonly RailEvent[]): number | null {
    const f = events.filter((e) => e.kind === "failed").map((e) => e.ts);
    return f.length > 0 ? Math.min(...f) : null;
}
```

`recordTimeline` must also return `t` itself when an agent dropped from `seen` is the only change it would not
otherwise see: the length check above covers it; test it.

**Step 4:** run the tests → PASS. `task check:ts` → exit 0.

**Step 5: Commit** `git commit -m "feat(sidecar): the 2-hour timeline the bridge keeps" -- frontend/app/cockpit/sidecartimeline.ts frontend/app/cockpit/sidecartimeline.test.ts`

---

### Task 4: The bridge builds the dashboard's snapshot
**Depends on:** Task 2 (calls `sidecarNeeds`), Task 3 (calls `recordTimeline` and `failedFrom`)
**Files:** `frontend/app/cockpit/sidecarbridge.tsx`, `frontend/app/cockpit/sidecarbridgemodel.ts`, `frontend/app/cockpit/sidecarbridgemodel.test.ts`, `frontend/app/cockpit/sidecarsnapshot.ts`

In `sidecarbridgemodel.ts`: `validateAct` and `sameSnapshot`.

**Step 1: Failing tests for `validateAct` and `sameSnapshot`:**
- an `answer` act is valid when `last.needs` has an `ask` row with that `id`, `answerable: true`, `askKey === act.key`
  and `option` in `0..options.length-1` (0-based, as today: decision 2); refused for `option === options.length`,
  when the `askKey` differs ("the ask of "x" changed since the page showed it", the existing wording), and when the
  agent is not in `needs` even if it is a tile;
- a `need` act is valid only for a `jarvis` row's key in `last.needs`; refused otherwise ("need: "k" is not waiting");
- `open` stays valid for any tile id **or** any `question`/`ask` row's `id` (an agent past the orbit's 8 can be opened
  from its row);
- `sameSnapshot` (`sidecarbridgemodel.ts:208`, today `counts`/`tiles`/`machine`/`strain` only) is false when only
  `needs`, only `run`, only `usage` or only `more` differs, one `it` each; extend it with
  `same(a.needs, b.needs) && same(a.run, b.run) && same(a.usage, b.usage) && a.more === b.more`.

**Step 2:** `npx vitest run frontend/app/cockpit/sidecarbridgemodel.test.ts` → FAIL. **Step 3:** implement in
`validateAct`; keep the `older` act's checks until Task 8. → PASS.

**Step 4: Wire the bridge** (`assemble()`; see the current code at `sidecarbridge.tsx:229-270`):

1. Keep `const base = sidecarSnapshot(...)` (the whole roster).
2. `jarvis`: `splitAttention(attention()).jarvis`, where `attention()` is
   `(import.meta.env.DEV ? globalStore.get(attentionFixtureAtom) : null) ?? globalStore.get(attentionAtom)`.
3. `needs = sidecarNeeds({ tiles: base.tiles, entriesById, jarvis, now })`, with `entriesById[a.id] =
   entriesToShow(globalStore.get(liveEntriesByIdAtom)[a.id] ?? [], a.previousInfo)` for each roster agent (decision 4).
4. The run box (decision 5): from `globalStore.get(model.lineageAtom).runs`, the active orchestrator runs (status not
   done/cancelled, `mode !== "quick"`), newest `createdTs`; `title` = `run.title`; `done`/`total` from
   `runProgress(run.dag)`; `leadId` = the agent whose `runId` is that run and whose lineage role is lead
   (`lineage.roles[id]`); `failed` (decision 6) = some need has `failed` and its attention item's `runid` is the
   run's id (keep the item per need key while building, so the need need not carry it). Call
   `ensureRunEvents(run.runId, run.channelId)` once per run id (keep a `Set`). `due` = the first `chunk-due` item's
   `chunklabel`. In DEV, a box set through `window.__sidecarRun` (step 12) replaces the lineage's, `failed` still
   derived here from the needs.
5. Tiles: on each tile set `failed` when it is the run box's lead and the run failed; `diff` from
   `globalStore.get(diffStatsByIdAtom)[t.id]` (`adds`, `dels`) for `review` tiles.
6. Timeline (decision 8): a module-scope `timeline` and a `failedLeads` set; one subscription to the roster atom,
   made when the bridge mounts (not when Sidecar opens) and dropped on unmount, runs `timeline = recordTimeline(
   timeline, sightings, Date.now())` on each change, where a sighting is `{id, state, since, failed:
   failedLeads.has(id)}` for each roster agent that is not a terminal, with `state` and `since` exactly as the snapshot
   computes them (`tileState` and `since` in `sidecarsnapshot.ts:103,107`, private today: export them and add them to
   this task's files). The build sets `failedLeads` to the failed run's lead (empty otherwise) and, when that set
   changed, records once more at once. When a lead turns failed and `failedFrom(runRailEvents(run, runEvents))` is
   earlier than its open span's start, close the open span there instead (the event dates the failure). Nothing
   resets the timeline on close.
7. The orbit: `const waiting = new Set(needs.filter((n) => n.kind === "question").map((n) => n.id!))`;
   `const { tiles, more } = orbitTiles(scopeTiles(base, wallAgentIds(...)).tiles, waiting)`; each orbit tile carries
   `spans: timeline[t.id] ?? []`, unclipped (decision 9).
8. Usage (decision 7): `planDonuts(agents, globalStore.get(savedRateLimitsAtom), globalStore.get(activeClaudeKeyAtom),
   globalStore.get(claudeIdentityAtom), now)`, the `claude` entry, rounded to whole percents.
9. The snapshot: `{ ...base-with-orbit-tiles, more, needs, run, usage, machine, strain }`; `counts` stays the whole
   roster's.
10. Subscribe (in the same list as `sidecarbridge.tsx:569-585`): `attentionAtom`, `attentionFixtureAtom` (DEV),
    `model.lineageAtom`, `diffStatsByIdAtom`, `savedRateLimitsAtom`, and each shown run's `runEventsAtom` (re-subscribe
    when the run changes). Every one of these stops on close, as the others do; only step 6's roster subscription
    lives as long as the bridge.
11. Act `need` (decision 3): look the key up in the last `queueRows(jarvis, agents)` the build kept; `const t =
    rowPeekTarget(row)`; when `t` is set, `openAddress(model, t.ref, { anchor: t.anchor })`, then `showMain()`. Log
    and do nothing when the row has no target.
12. DEV seams beside the others (`sidecarbridge.tsx:95-115`), documented in the declare block:
    `window.__sidecarAttention?: (items: AttentionItem[] | null) => void`, which sets `attentionFixtureAtom` and
    rebuilds now; and `window.__sidecarRun?: (box: Omit<SidecarRunBox, "failed"> | null) => void`, which holds a run
    box that replaces the lineage's (null: back to the lineage) and rebuilds now. The second exists because a fixture
    roster has no server run in `lineageAtom`, so Task 10 could not show a run box or a failed lead otherwise.

**Step 5:** `npx vitest run frontend/app/cockpit/` → PASS. `task check:ts` → exit 0.

**Step 6: Commit** `git commit -m "feat(sidecar): the bridge sends Needs you, the timeline, the run and usage" -- frontend/app/cockpit/sidecarbridge.tsx frontend/app/cockpit/sidecarbridgemodel.ts frontend/app/cockpit/sidecarbridgemodel.test.ts frontend/app/cockpit/sidecarsnapshot.ts`

---

### Task 5: The page model (`sidecarorbitmodel.ts`)
**Depends on:** Task 1 (reads the snapshot fields it adds)
**Files:** `frontend/app/cockpit/sidecarorbitmodel.ts`, `frontend/app/cockpit/sidecarorbitmodel.test.ts`

Everything the two views decide, pure, so the `.tsx` files only draw. Write each test first, see it fail, implement,
see it pass.

- `screenState(snap)`: `"failed"` when any need is `failed`; else `"critical"` when `strain?.level === "red"`; else
  `"high"` when `strain?.level === "amber"`; else `"calm"` when `needs` is empty; else `"normal"`.
- `frameOf(state)`: `failed` and `critical` → `"error"`; `high` → `"warning"`; else `"none"`.
- `coreTone(snap)`: `"error"` when a need failed, `"muted"` at 0 needs, else `"warning"`. `coreLabel(snap)`:
  `"⚠ RAM critical"` / `"⚠ RAM high"` for a RAM strain (`strain.by === "ram"`), else `null`.
- `nodeLine(tile, run, snapNow, sinceArrivedMs)`: asking → `asks: <question cut to 32 chars with …> · 3m`; working →
  `working · 11m`; a run's lead → `run · 7 of 9 · 1h 34m`; failed → `failed · 4m`; review with diff → `finished · +4005
  −755`; review/idle otherwise → `finished · 4m`. Ages through the existing `ageText` (`sidecarwallmodel.ts:168`) — Task
  8 moves it, so import it from where it is today.
- `nodeTone(tile, waiting)`: `warning` (asking or a question row), `error` (failed), `success` (working), `secondary`
  (finished). `pings(tile, waiting)`: true for warning and error.
- `orbitPoints(n, cx, cy, rx, ry)`: `n` points on an ellipse, the first at the top (−90°), evenly spaced clockwise;
  `n = 0` → `[]`. Test 1, 4 and 8 points to 1 px.
- `ringDash(pct, r)`: `{ dash, gap }` for an SVG circle of radius `r`, `pct` clamped to 0..100; `undefined` pct → 0.
- `laneBars(spans, now, width)`: each span to `{ x, w, state }` over the 2-hour window ending at `now`, at least 2 px
  wide, `to` missing → `now`; a span that began before the window's edge is clipped to start at `x = 0`, one that
  ended before it is dropped (the bridge sends spans unclipped: decision 9). Test both.
- `needHow(need)`: answerable ask → `1 Merge · 2 Keep the branch` (first 4 options, each `n Label`); a sent ask →
  `Sent`; other asks and questions → `Enter: reply in the main window`; jarvis → `Enter: open in the main window`.
- `dashKey(key, layout, sel, needs, nodes)` → `{ kind: "select"; sel } | { kind: "open"; id } | { kind: "need"; key } |
  { kind: "answer"; id; option; key } | null`, with `sel = { area: "needs" | "orbit"; index }`: ArrowUp/Down move in
  Needs you (stop at the ends, from none to the first); on P ArrowLeft/Right move through the orbit's nodes (wrapping);
  on Q left/right are not its own; Enter on an ask/question row → `open` its agent, on a jarvis row → `need`, on a
  node → `open`; 1–9 → `answer` only on a selected answerable, unsent ask row with that many options, `option` 0-based
  (key `2` → `option: 1`, decision 2). Reuse
  `wallKey` and `answerAct`'s rules (`sidecarwallmodel.ts:175`, `:202`); keep the wall's tests passing.
- `selectionAfter(sel, needs, nodes)`: keeps the selection on the same key or id when the list changes, else clamps.

**Commit** `git commit -m "feat(sidecar): the orbit dashboard's page model" -- frontend/app/cockpit/sidecarorbitmodel.ts frontend/app/cockpit/sidecarorbitmodel.test.ts`

---

### Task 6: P, the full window (`sidecarorbit.tsx`)
**Depends on:** Task 5 (draws from its page model)
**Files:** `frontend/app/cockpit/sidecarorbit.tsx`

`bg-errorbg` and `animate-sidecar-ping` come from Task 9, which runs beside this task: use the class names as Task 9
defines them; they render once both have merged (a missing class compiles, it only draws nothing).

Draw board `P-orbit-dashboard` and its state boards from `SidecarSnapshot`, with the page model for every decision.
Props as the wall's today: `{ snap, receivedAt, clock, send }`. Layout (copy sizes from the board): a two-column grid,
the orbit left (≈ 60%), the right column Needs you then Run (or the strain band in its place), the lanes across the
bottom.

- **Root:** `data-sidecar-dashboard="orbit"`, `data-sidecar-state={screenState}`, `data-sidecar-frame={frameOf}`. The
  frame is a `pointer-events-none` overlay: `error` → `shadow-[inset_0_0_0_4px_var(--color-error),inset_0_0_80px_…]`
  built from the token (no hex), `warning` → 3 px `--color-warning`; `transition-[box-shadow] duration-500`.
- **Orbit (one SVG):** three rings outside in (5-hour, week, RAM used = `1 - memFree/memTotal`), each a track in
  `surface-raised` and an arc by `ringDash`; RAM's arc takes `warning`/`error` with the band. The core: the needs count
  at 92 px in `coreTone` (`data-sidecar-core`), `coreLabel` under it, a key for the rings top left, `N working · N for
  review · N idle` bottom left, `+N` when `snap.more > 0`. Nodes at `orbitPoints(tiles.length, …)`: a dot in
  `nodeTone`, the name, `nodeLine` (`data-sidecar-node={id}`, `data-node-tone`), a spoke to the core, dashed in its
  tone when it pings; a heavy agent (in `strain.heavy`) gets a ring in the band's colour and `4.2 GB · npm run build`.
  Status is never colour alone: the line says it.
- **Ping:** a node or row that `pings` carries `animate-sidecar-ping` (Task 9), none under `prefers-reduced-motion`.
- **Needs you:** a list (`role="listbox"`), one row per need (`data-sidecar-need={key}`, `data-need-kind`,
  `data-need-failed`): who, age, the text clamped to 2 lines, `needHow`; a failed row leads with **Failed** and sits
  on `bg-errorbg`, a waiting row on `bg-askingbg`; the selected row `bg-surface-hover ring-2 ring-inset` grey. Rows
  enter with `springReveal` (`AnimatePresence` with no exit animation), off under reduced motion. Empty: `All clear` /
  `Nothing waits on you.` (copy from `P-calm`).
- **Run:** `data-sidecar-run`: the title, a strip of `total` segments (done `bg-success/45`, the next one full), `7 of
  9 tasks · due today: …`; red **Failed** when `run.failed`. Hidden while the strain band shows.
- **Strain band:** the existing `sidecarband.tsx` component on top of the right column, unchanged.
- **Last 2 hours:** one lane per orbit tile in the orbit's order (`data-sidecar-lane={id}`), bars from `laneBars`
  (`data-span-state`): working `bg-success` bar, asking `bg-warning` bar, failed `bg-error` bar, finished a thin
  `bg-secondary` line; `title="working 13:55–14:36"`; hour ticks under them.
- **Keys:** one `keydown` listener on the page through `dashKey("orbit", …)`; acts go out through `send`. 1–9 sends
  `answerAct`'s act. F11 stays the page's.

This tree cannot show P yet (the page switches in Task 8, the bridge's new fields come from Task 4): no dev-app
check here. Its acceptance is `sidecar-orbit` steps 1–6 (Task 10), which the Final runs; the attributes above are
what those steps assert, so keep their names exactly. **Commit** `git commit -m "feat(sidecar): P, the orbit dashboard" -- frontend/app/cockpit/sidecarorbit.tsx`

---

### Task 7: Q, the compact window (`sidecarcompact.tsx`)
**Depends on:** Task 5 (draws from its page model)
**Files:** `frontend/app/cockpit/sidecarcompact.tsx`

`bg-errorbg` and `animate-sidecar-ping` come from Task 9, which runs beside this task (see Task 6).

Board `Q-compact-live`, drawn at the host's small form, 340 × 440 (decision 10: the board is 380 px wide; keep its
order and proportions and let the Needs you rows scroll inside their own list, never the page). Root `data-sidecar-dashboard="compact"` with the same `data-sidecar-state` and
`data-sidecar-frame` (frame 2 px). Top: the core at 112 px (`data-sidecar-core`, `coreTone`, rings at the same rule)
with the figures beside it (5-hour %, week %, RAM used, `N working`). Then the strain as one line
(`data-sidecar-strainline`, shown only at amber or red: level, the heaviest job, its **Stop** and **Sleep** buttons,
the same acts `sidecarband.tsx` sends). Then the Needs you rows as on P (same
attributes, same keys through `dashKey("compact", …)`), `All clear` / `Nothing waits on you.` when empty
(`data-sidecar-allclear`). Bottom: one dot per orbit tile (`data-sidecar-dot={id}`, `nodeTone`, `title` = name and
`nodeLine`) beside `Run 7 of 9 · 1h 34m` when a run shows. No timeline. A waiting row or dot carries
`animate-sidecar-ping` and a failed row `bg-errorbg`, as on P.

No dev-app check in this tree (see Task 6); its acceptance is `sidecar-compact` (Task 10), which the Final runs.

**Commit** `git commit -m "feat(sidecar): Q, the compact dashboard" -- frontend/app/cockpit/sidecarcompact.tsx`

---

### Task 8: Switch the page over and remove the wall
**Depends on:** Task 4, Task 6, Task 7
**Files:** `frontend/tauri/sidecar.tsx`, `frontend/app/cockpit/sidecartitlebar.tsx`, `frontend/app/cockpit/sidecarkeys.ts`, `frontend/app/cockpit/sidecarkeys.test.ts`, `frontend/app/cockpit/sidecarstrainmodel.ts`, `frontend/app/cockpit/sidecarlayout.ts`, `frontend/app/cockpit/sidecarlayout.test.ts`, `frontend/app/cockpit/sidecarorbitmodel.ts`, `frontend/app/cockpit/sidecarorbitmodel.test.ts`, `frontend/app/cockpit/sidecarorbit.tsx`, `frontend/app/cockpit/sidecarcompact.tsx`
**Files:** `frontend/app/cockpit/sidecarwall.tsx`, `frontend/app/cockpit/sidecarwallmodel.ts`, `frontend/app/cockpit/sidecarwallmodel.test.ts`, `frontend/app/cockpit/sidecarsmall.tsx`, `frontend/app/cockpit/sidecarhistory.ts`, `frontend/app/cockpit/sidecarhistory.test.ts`
**Files:** `frontend/app/cockpit/sidecartypes.ts`, `frontend/app/cockpit/sidecarsnapshot.ts`, `frontend/app/cockpit/sidecarsnapshot.test.ts`, `frontend/app/cockpit/sidecarbridgemodel.ts`, `frontend/app/cockpit/sidecarbridgemodel.test.ts`, `frontend/app/cockpit/sidecarbridge.tsx`, `frontend/app/cockpit/sidecarneeds.test.ts`, `CHANGELOG.md`

Dropping `SidecarTile.messages` breaks every test that builds a tile with `messages: []`: Task 2's
`sidecarneeds.test.ts` and Task 5's `sidecarorbitmodel.test.ts` included. Grep `messages` under
`frontend/app/cockpit/` and fix each test file it lists (`uiapi.ts`, `whatsnew.ts` and `traybridge.tsx` use the word
for something else: check, don't touch them unless they read `SidecarTile`).

What changes where:

- Modify: `frontend/tauri/sidecar.tsx` (draw `SidecarOrbit` for `wall` layout, `SidecarCompact` for `small`; the comment
  on "nothing on this page animates" now points to the spec's Motion section; keep `[&_button]:transition-none`)
- Modify: `frontend/app/cockpit/sidecartitlebar.tsx` (the counts move into the core: drop `SidecarCounts` from the
  title bar; keep its buttons and machine figures)
- Create: `frontend/app/cockpit/sidecarkeys.ts` (+ `.test.ts`): move from `sidecarwallmodel.ts` what lives on:
  `MoveKey`, `moveSelection`, `resolveSelection`, `formatTileAge`, `tileAgeMs`, `ageText`, `wallKey` (renamed
  `sidecarKey`), `canAnswer`, `answerAct`, with their tests; repoint `sidecarstrainmodel.ts`, `sidecarlayout.ts`,
  `sidecarorbitmodel.ts`
- Delete: `sidecarwall.tsx`, `sidecarwallmodel.ts` (+ test), `sidecarsmall.tsx`, `sidecarhistory.ts` (+ test);
  `smallAsks`/`smallKey` from `sidecarlayout.ts` (+ tests); the `older` act and `SIDECAR_OLDER_EVENT`,
  `SidecarOlder`, `answerOlder`/`OlderInput`/`OlderReaders` in `sidecarbridgemodel.ts` and the bridge's handler;
  `messages` from `SidecarTile`, `SidecarMessage`, `MAX_TILE_MESSAGES`, `messageRows`, `keptMessages` and the bridge's
  `kept` (grep first: `messageRows` may have other users)
- Modify: `CHANGELOG.md` (Unreleased, `Changed`): `Sidecar is now a dashboard: what waits on you counted in the middle
  of an orbit of your agents, the queue to answer from, the run and the last 2 hours, framed red when RAM is critical
  or a run fails; shrunk, it keeps the count, the queue and a dot per agent.` and a second line, for Task 11's change
  (Task 11 runs beside this one and owns no shared file): `On Windows, Sidecar has its own taskbar button with its own
  icon, arcterm's mark with a small screen, instead of sharing arcterm's.`

**Before deleting a file, grep every import of it, `import type` and re-exports included** (AGENTS.md). Then
`npx vitest run frontend/app/cockpit/` → PASS, `task check:ts` → exit 0, `npx eslint` on the touched paths.

**Commit** `git commit -m "refactor(sidecar): the page draws P and Q; the wall, scrollback and the small list go" -- <every touched and deleted path>`

---

### Task 9: Tokens, the ping and the DESIGN.md exception
**Depends on:** none
**Files:** `frontend/tailwindsetup.css`, `frontend/app/view/agents/themes.ts`, `DESIGN.md`

What changes where:

- Modify: `frontend/tailwindsetup.css`: `--color-errorbg: rgba(224, 114, 108, 0.14);` beside `--color-askingbg`
  (`:83`); a `@keyframes sidecarPing` (a ring growing from scale 1 to 2.2 while its opacity goes 0.6 → 0, 1.8 s,
  infinite) and the utility `animate-sidecar-ping`, with `@media (prefers-reduced-motion: reduce)` turning it off.
- Modify: `frontend/app/view/agents/themes.ts`: `"--color-errorbg": rgba(p.error, 0.14)` beside `--color-askingbg`
  (`:634`); `themes.test.ts` holds every token mirrored: run it.
- Modify: `DESIGN.md`, Motion: `Sidecar is read from across the room, so a waiting item pings (a 1.8 s ring) until it is
  answered; no other repeating motion anywhere, and no radar sweep.` Colours: `errorbg`, a failed row's tint.

`npx vitest run frontend/app/view/agents/themes.test.ts` → PASS. **Commit** `git commit -m "style(sidecar): errorbg, the waiting ping and its DESIGN.md exception" -- frontend/tailwindsetup.css frontend/app/view/agents/themes.ts DESIGN.md`

---

### Task 10: CDP scenarios for P and Q
**Depends on:** Task 8 (its scenarios drive the P and Q page Task 8 switches the window over to), Task 9 (asserts the
ping and `bg-errorbg` classes), Task 11 (asserts the Sidecar app id's log line)
**Files:** `scripts/cdp/scenarios-sidecar.mjs`, `docs/hand-checks.md`, `docs/open-issues.md`

What changes where:

- Modify: `scripts/cdp/scenarios-sidecar.mjs` (replace the `sidecar-wall` scenario with `sidecar-orbit` and
  `sidecar-compact`, both `host: true`, keeping its harness: the fixture roster, `attachByUrl`, the hold, the machine
  and heavy seams, teardown)
- Modify: `docs/hand-checks.md`, `docs/open-issues.md` (RAM watch)

**What carries over from `sidecar-wall`** (its step numbers today), moved into the two new scenarios with their
asserts unchanged except where the counts moved into the core:
- into `sidecar-orbit`, before the state steps: 1 (Ctrl+P → Open Sidecar), 2 (the page's own window calls), 3 (the
  waiting state before the first snapshot, now with no dashboard instead of no wall), 13 (F11 toggles full screen),
  14–22 (the strain band: readings, CPU, Stop ask/confirm/cancel, Sleep, × hide, red hold and step-down), 24 (folded
  idle and asleep agents have no node: assert no `data-sidecar-node` for them);
- into `sidecar-compact`: 25 (at 900 px wide the page is the small form, now `data-sidecar-dashboard="compact"`), 26
  (S shrinks to 340 × 440 and pins), 28 (the pin button), 29 (S again restores the size), 30 (no ask: `All clear`,
  the main window's size and focus unmoved);
- dropped with the wall, coverage lost on purpose: 4 (counts in the title bar: the core's number replaces it, asserted
  in the state steps), 5–9 (tiling 2x2 … 40 agents), 10–12 (tile arrows, Enter, 2 answers a tile: replaced by the
  keys' steps below), 23 (scrollback), 27 (small-form cards: replaced by Q's keys step). There is no "closes with the
  main window" step today; the hand check below covers it.

**The run box.** A fixture roster has no server run in `lineageAtom`, so the scenario sets the run through Task 4's
DEV seam: `window.__sidecarRun({ id: "fx-sc-run", leadId: <the lead's id>, title: "Sidecar orbit", done: 7, total: 9,
since: <now − 1h 34m> })`, and the P-failed `dag-blocked` item carries `runid: "fx-sc-run"`. Clear it
(`__sidecarRun(null)`) in teardown. The question row reads the `review` agent's `previousInfo` (decision 4): put its
last message there.

One roster, `dashboard`: two working agents (one the run's lead), one asking with an answerable ask (`Merge into
main?`, options `Merge`, `Keep the branch`), one asking with a multi-select ask, one `review` agent whose
`previousInfo` ends with the message `Xong. Bạn chọn (a) hay (b)?` and no user entry after it, one `review` agent
whose last message ends in a period, and the two parked agents of today's roster. State steps (each a screenshot and
asserts on the attributes Tasks 6 and 7 define):

**`sidecar-orbit`** (window maximized at 1920×1080, as `WALL_VIEWPORT`):
1. **P-calm** (board `P-calm`): roster with only the working and the period-ending agents, attention fixture `[]`:
   `data-sidecar-state="calm"`, core `0`, `All clear`, frame `none`, no element with `animate-sidecar-ping`.
2. **P-orbit-dashboard** (board `P-orbit-dashboard`): the full roster and one `dag-gate` attention item: state
   `normal`; core `4` (2 asks, 1 question, 1 gate); rows oldest first; the question row's text is `Bạn chọn (a) hay
   (b)?` and its how `Enter: reply in the main window`; the answerable ask's how `1 Merge · 2 Keep the branch`; 8 or
   fewer nodes; one lane per node; `data-sidecar-run` reads `7 of 9 tasks`; each asking node and each ask or question
   row carries `animate-sidecar-ping`, and a working node does not. Then keys: ArrowDown to the answerable ask, `2` →
   `__sidecarActs` ends with `{kind:"answer", option:1, key:<its key>}` (0-based: decision 2); ArrowDown to the gate,
   Enter → `{kind:"need", key:<gate key>}`.
3. **P-high** (board `P-high`): `__sidecarMachine` + `__sidecarFeed` to RAM high: state `high`, frame `warning`, the
   band shows and the run box does not, the core reads `⚠ RAM high`.
4. **P-critical** (board `P-critical`): RAM critical with `__sidecarHeavy` naming one agent: state `critical`, frame
   `error`, the band's Stop and Sleep, the heavy node's line names its GB and command.
5. **P-failed** (board `P-failed`): RAM back to normal; attention fixture adds a `dag-blocked` item with `retry: true`
   and `runid: "fx-sc-run"`: state `failed`, frame `error`, the first row leads with `Failed` and its class list has
   `bg-errorbg`, the lead's node tone `error` and it carries `animate-sidecar-ping`, its lane's last bar
   `data-span-state="failed"`, core tone `error`.
6. **P-live** (board `P-live`): without reloading, step through normal → high → critical → normal → failed with the
   seams, each within 2 s: assert the state and frame attributes follow each change (the page reacts with no reload)
   and that a new need row appears with no full redraw (the earlier rows' elements are the same nodes: mark one with a
   `data-probe` before and find it after).

**`sidecar-compact`** (the S button's small form, as today's steps reach it): **Q-compact-live** (board
`Q-compact-live`): the five states in turn as above; each asserts `data-sidecar-dashboard="compact"`, the state and
frame, the core's number, the rows, one `data-sidecar-dot` per orbit tile, and in calm `data-sidecar-allclear`; in
normal the ask rows carry `animate-sidecar-ping`; in high and critical `data-sidecar-strainline` shows with its Stop
and Sleep buttons (and is absent in calm and normal); in failed the Failed row has `bg-errorbg`. The keys' step repeats
ArrowDown to the answerable ask + `1` → `{kind:"answer", option:0, key:<its key>}`.

**The taskbar id (Task 11), in `sidecar-orbit` after step 1, Windows only** (skipped with a note elsewhere): read the
dev app's `waveapp.log` (in its data dir: `ARC_DEV_DATA_DIR`'s `data` folder when set, as `final-verify.mjs` sets it,
else `%LOCALAPPDATA%\dev.arc.app-dev\data`; check `main.rs`'s log setup for the exact path) and assert a line
`[sidecar] app id dev.arc.app-dev.sidecar` written after the open.

`docs/hand-checks.md`: `- [ ] (arcterm) Sidecar P/Q across a real day: the question heuristic's misses, the ping from
across the room, RAM of P with 12 agents after a day`; for Task 11 (it owns no doc file): `- [ ] (arcterm) Packaged
build: Sidecar has its own taskbar button with the screen badge, not arcterm's icon; right-click shows no "Pin to
taskbar"; closing arcterm closes it`. `docs/open-issues.md` RAM watch: measure P with 12 agents after a day on screen
against the 100 MB budget.

Run `ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs sidecar-orbit sidecar-compact` (it starts its own
dev app from this tree, runs the two, and stops it) → exit 0. **Commit** `git commit -m "test(sidecar): CDP scenarios for the orbit dashboard, full and compact" -- scripts/cdp/scenarios-sidecar.mjs docs/hand-checks.md docs/open-issues.md`

---

### Task 11: Sidecar's own taskbar button and icon (Windows)
**Depends on:** none
**Files:** `scripts/gen-app-icon.mjs`, `src-tauri/icons/icon-sidecar.ico`, `src-tauri/src/main.rs`, `src-tauri/src/sidecar.rs`, `src-tauri/Cargo.toml`

`icon-sidecar.ico` is generated by `gen-app-icon.mjs` and committed like `icon.ico`. Its CHANGELOG line is written by
Task 8 and its hand check by Task 10, which run beside this task: do not touch `CHANGELOG.md` or `docs/hand-checks.md`
here.

**Step 1: The icon.** In `gen-app-icon.mjs`, `render()` takes an optional badge, drawn after the glyph exactly as the
board's generator drew it (spec "Taskbar"):

```js
const BADGE_GROUND = [0x4d, 0x80, 0xd1]; // accent-500
// the screen: a 5x5 grid, a frame of four rows and a one-cell stand
const BADGE_SCREEN = [[0, 0, 5, 1], [0, 1, 1, 2], [4, 1, 1, 2], [0, 3, 5, 1], [2, 4, 1, 1]];

// how much of pixel (x, y) a rounded rect covers, supersampled 4x4
function cover(x, y, rx, ry, w, h, r) {
    let hit = 0;
    for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
            const fx = x + (sx + 0.5) / 4 - rx;
            const fy = y + (sy + 0.5) / 4 - ry;
            if (fx < 0 || fy < 0 || fx > w || fy > h) continue;
            const dx = Math.max(r - fx, fx - (w - r), 0);
            const dy = Math.max(r - fy, fy - (h - r), 0);
            if (dx * dx + dy * dy <= r * r) hit++;
        }
    }
    return hit / 16;
}

// Sidecar's badge: a rounded square of 44% of the icon flush with its bottom-right corner, cut out of the tile by a
// transparent gap, with the screen drawn white inside it
function badge(px, size) {
    const B = Math.round(size * 0.44);
    const g = Math.max(1, Math.round(size / 24));
    const at = size - B;
    const r = B * 0.3;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            px[i + 3] = Math.round(px[i + 3] * (1 - cover(x, y, at - g, at - g, B + 2 * g, B + 2 * g, r + g)));
            const c = cover(x, y, at, at, B, B, r);
            if (c > 0) {
                px.set(BADGE_GROUND, i);
                px[i + 3] = Math.round(255 * c);
            }
        }
    }
    const step = Math.max(1, Math.floor((B * 0.62) / 5));
    const o = at + Math.round((B - 5 * step) / 2);
    for (const [cx, cy, cw, ch] of BADGE_SCREEN) {
        for (let y = o + cy * step; y < o + (cy + ch) * step; y++) {
            for (let x = o + cx * step; x < o + (cx + cw) * step; x++) {
                const i = (y * size + x) * 4;
                px.set(GLYPH, i);
                px[i + 3] = 255;
            }
        }
    }
}
```

Write `icon-sidecar.ico` from the same `SIZES` (Windows only; no icns). Run `node scripts/gen-app-icon.mjs <tmp-dir>`
and compare `<tmp-dir>`'s sidecar PNGs with the board's `icons/F-badge-screen-*.png` byte for byte (they must match:
the board was drawn by this code); `icon.ico` must come out unchanged (`git diff --stat src-tauri/icons/icon.ico` empty).

**Step 2: Rust, failing tests first** in `sidecar.rs`'s test module for a pure `pick_ico_frame(ico: &[u8], size: u32)
-> Option<(usize, usize)>` (offset and length of the frame): exact size wins; else the smallest larger; else the
largest; a width byte of 0 means 256; a truncated or non-ICO buffer → `None`. Run
`cargo test --manifest-path src-tauri/Cargo.toml pick_ico_frame` → FAIL, implement, → PASS.

**Step 3: The window icon.** `const SIDECAR_ICO: &[u8] = include_bytes!("../icons/icon-sidecar.ico");` and, on
Windows, a `use_sidecar_icons(hwnd)` beside `crate::use_resource_window_icons` (`main.rs:211`) that, for `ICON_BIG`
and `ICON_SMALL` at `GetSystemMetricsForDpi(…, GetDpiForWindow(hwnd))`, picks the frame and makes it with
`CreateIconFromResourceEx(ptr, len, 1 /* icon */, 0x0003_0000, size, size, LR_DEFAULTCOLOR)` (PNG frames are
accepted), then `WM_SETICON`. `open_window` calls it on the main thread where it calls
`use_resource_window_icons` today (`sidecar.rs:654-658`), in its place. Add the `windows-sys` feature it needs, if
any, to `src-tauri/Cargo.toml`.

**Step 4: The app id.** Turn `set_window_app_user_model_id` (`main.rs:253`) into a `#[cfg(windows)]` helper that
takes the id and a `prevent_pinning: bool` (setting `PKEY_AppUserModel_PreventPinning` to a `VT_BOOL` true in the
same property store, before `Commit`); keep the main window's call and its `not(debug_assertions)` gate exactly as
they are (the dev main window must keep no id). The id comes from a pure, platform-free `fn sidecar_app_id(identifier:
&str, dev: bool) -> String` (`"<identifier>.sidecar"`, or `"<identifier>-dev.sidecar"` when `dev`), with a failing
test first: `sidecar_app_id("dev.arc.app", false) == "dev.arc.app.sidecar"` and `sidecar_app_id("dev.arc.app", true)
== "dev.arc.app-dev.sidecar"`. `open_window` sets the Sidecar window's id right after `build()` with
`sidecar_app_id(&app.config().identifier, cfg!(debug_assertions))`, `prevent_pinning: true`, and writes
`log_line("[sidecar] app id <id>")` once it is set (Task 10's scenario asserts this line; keep its wording
exact); log a failure with `log_line`, never fail the open. Keep the long comment on COM memory with the code it
describes.

**Step 5:** `cargo test --manifest-path src-tauri/Cargo.toml` → PASS (the `pick_ico_frame` and `sidecar_app_id`
tests among them); `cargo build --manifest-path src-tauri/Cargo.toml` → builds. Acceptance in the run is those tests
plus Task 10's log-line step; the taskbar button itself is the packaged hand check. If you can run `task dev` here,
open Sidecar and say whether the taskbar showed a second button; otherwise say it was not seen.

The packaged path is left to the hand check Task 10 writes (only a packaged build runs it).

**Commit** `git commit -m "feat(sidecar): its own taskbar button and icon on Windows" -- scripts/gen-app-icon.mjs src-tauri/icons/icon-sidecar.ico src-tauri/src/main.rs src-tauri/src/sidecar.rs src-tauri/Cargo.toml`
