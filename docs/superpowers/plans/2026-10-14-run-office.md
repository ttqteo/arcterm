# Run office implementation plan

**Spec:** `docs/superpowers/specs/2026-10-14-run-office-design.md` (read it first)

**Verify:** `node scripts/verify.mjs ./pkg/memgate`

**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs jarvis-office jarvis-office-bench surface-smoke`

**Goal:** an Office toggle on the Brief's Runs region that draws each run as a side-view pixel office floor under its
row: the lead in a glass corner office, one desk per dag task, a 2D person whose pose names the task's state. It ships
with a CDP benchmark that holds its RAM and CPU to the spec's budgets.

**Architecture:** frontend only, no wshrpc, no Go. A pure model (`officemodel.ts`) turns a run's stage, its dag tasks
and the agent roster into a `Floor`; pure sprite data (`officesprite.ts`) holds the poses as grids; a small rasteriser
(`officesprites.ts`) turns a pose and outfit into a cached PNG data URL once; `officeview.tsx` draws floors with plain
DOM and one 450 ms frame clock. The Brief renders a `LiveOfficeFloor` under each run row while the toggle is on.

**Tech stack:** React 19, jotai (`atomWithStorage`), Tailwind 4 tokens, vitest, the CDP scenario harness.

**Canvas (reference, not a Prototype):** `D:\work\arcterm\.superpowers\design\run-office\project\States.dc.html`
draws every pose. Its `Main` board predates the decision to draw floors under the Brief's rows, so it is not a spec
for the layout.

The Verify line names one small Go package only because `verify.mjs` needs a pattern; this plan changes no Go. Its
final stage runs vitest.

Rules every task keeps (AGENTS.md, DESIGN.md): no raw hex in `.ts`/`.tsx` (colours are `--color-*` tokens); never
run prettier on `scripts/*.mjs` (4-space, hand-formatted); comments say why, lowercase, minimal; no jsdom tests.

---

### Task 1: Sprite data and the office tokens

**Depends on:** none

**Files:** `frontend/app/view/jarvis/officesprite.ts`, `frontend/app/view/jarvis/officesprite.test.ts`, `frontend/tailwindsetup.css`

- Create: `frontend/app/view/jarvis/officesprite.ts`
- Create: `frontend/app/view/jarvis/officesprite.test.ts`
- Modify: `frontend/tailwindsetup.css` (inside `@theme`, right after the `--color-teleport-*` block)

**Step 1: Write the failing test** — `frontend/app/view/jarvis/officesprite.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { gridPixels, parseColor, POSES, SPRITE_W, spriteFor, type SpritePose } from "./officesprite";

const SITTING: SpritePose[] = ["type1", "type2", "handup1", "handup2", "slump", "lean", "hands"];
const STANDING: SpritePose[] = ["stand", "clip", "box"];

describe("officesprite", () => {
    it("draws every pose 14 wide, 18 rows sitting and 22 standing", () => {
        for (const p of SITTING) {
            expect(POSES[p].length, p).toBe(18);
        }
        for (const p of STANDING) {
            expect(POSES[p].length, p).toBe(22);
        }
        for (const [p, grid] of Object.entries(POSES)) {
            for (const row of grid) {
                expect(row.length, p).toBe(SPRITE_W);
            }
        }
    });

    it("uses only known cell codes", () => {
        for (const [p, grid] of Object.entries(POSES)) {
            expect(grid.join(""), p).toMatch(/^[.HSETPKWB]+$/);
        }
    });

    it("names the grid a desk pose shows on each frame", () => {
        expect(spriteFor("type", 0)).toBe("type1");
        expect(spriteFor("type", 1)).toBe("type2");
        expect(spriteFor("handup", 1)).toBe("handup2");
        expect(spriteFor("lean", 1)).toBe("lean");
        expect(spriteFor("empty", 0)).toBeUndefined();
    });

    it("turns a grid into RGBA, leaving empty cells and uncoloured roles clear", () => {
        const px = gridPixels(["H.", "S."].map((r) => r.padEnd(SPRITE_W, ".")), (role) =>
            role === "H" ? [1, 2, 3] : undefined
        );
        expect(px.length).toBe(SPRITE_W * 2 * 4);
        expect(Array.from(px.slice(0, 4))).toEqual([1, 2, 3, 255]);
        expect(px[7]).toBe(0); // the "." beside it
        expect(px[SPRITE_W * 4 + 3]).toBe(0); // the S with no colour
    });

    it("reads the colours getComputedStyle hands back", () => {
        expect(parseColor("#7c95ff")).toEqual([124, 149, 255]);
        expect(parseColor(" rgb(1, 2, 3) ")).toEqual([1, 2, 3]);
        expect(parseColor("")).toBeUndefined();
        expect(parseColor("var(--x)")).toBeUndefined();
    });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/jarvis/officesprite.test.ts`
Expected: FAIL, `Failed to resolve import "./officesprite"`.

**Step 3: Write `frontend/app/view/jarvis/officesprite.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run office's people as data (run office spec, "Drawing"): every pose a grid of cell codes, and the one function
// that turns a grid into pixels. Pure, like petsprite.ts: the model names a pose without knowing its cells, and the
// rasteriser (officesprites.ts) draws one without knowing why.
//
// A grid is 14 columns, 18 rows sitting and 22 standing, `.` empty, feet on the last row, facing right. A code is a
// role (hair, skin, eye, shirt, pants, shoes, paper, box); officesprites.ts resolves a role to a --color-* property.

// what a desk shows: officemodel.ts picks one per task, spriteFor below names its grid
export type DeskPose = "empty" | "stand" | "type" | "slump" | "lean" | "hands" | "box" | "handup";

export type SpritePose =
    | "type1"
    | "type2"
    | "handup1"
    | "handup2"
    | "slump"
    | "lean"
    | "hands"
    | "stand"
    | "clip"
    | "box";

export type CellRole = "H" | "S" | "E" | "T" | "P" | "K" | "W" | "B";

export const SPRITE_W = 14;

const HEAD = [
    "..............",
    "....HHHH......",
    "...HHHHHH.....",
    "...HHHSSS.....",
    "...HHSSES.....",
    "...HHSSSSS....",
    "....SSSS......",
    ".....SS.......",
];
// the seated body from the waist down, behind the chair's seat
const LAP = [
    "...TTTTTT.....",
    "...TTTTTT.....",
    "...TTTTTT.....",
    "...PPPPPPPP...",
    "...PPPPPPPPP..",
    "..........PP..",
    "..........PP..",
    ".........KKKK.",
];
const STAND_TOP = [
    "....HHHH......",
    "...HHHHHH.....",
    "...HHHSSS.....",
    "...HHSSES.....",
    "...HHSSSSS....",
    "....SSSS......",
    ".....SS.......",
    "...TTTTTT.....",
    "..TTTTTTTT....",
    "..TTTTTTTT....",
];
const STAND_LEGS = [
    "..STTTTTTS....",
    "...PPPPPP.....",
    "...PPPPPP.....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "..KKKK.KKKK...",
];
const HAND_UP = (top: string, side: string) => [
    top,
    side,
    "...HHHHHH.TT..",
    "...HHHSSS.TT..",
    "...HHSSES.TT..",
    "...HHSSSSSTT..",
    "....SSSS.TT...",
    ".....SS.TT....",
    "...TTTTTT.....",
    "...TTTTTT.....",
];

export const POSES: Record<SpritePose, string[]> = {
    type1: [...HEAD, "...TTTTTT.....", "...TTTTTTTTSS.", ...LAP],
    type2: [...HEAD, "...TTTTTT.....", "...TTTTTTTT...", "...TTTTTT...SS", ...LAP.slice(1)],
    handup1: [...HAND_UP("..........SS..", "....HHHH..TT.."), ...LAP],
    handup2: [...HAND_UP(".........SS...", "....HHHH.TT..."), ...LAP],
    slump: [
        "..............",
        "..............",
        "..............",
        "..............",
        "..............",
        "......HHHH....",
        ".....HHHHHH...",
        ".....HHHSSSS..",
        "...TTTTTTSSSS.",
        "...TTTTTTTTSS.",
        ...LAP,
    ],
    lean: [
        "..............",
        "...HHHH.......",
        "..HHHHHH......",
        ".SHHHSSS......",
        ".SHHSSES......",
        ".STHSSSSS.....",
        "..TTSSSS......",
        "...TTSS.......",
        "..TTTTTT......",
        "..TTTTTT......",
        "..TTTTTT......",
        "..TTTTTT......",
        "...TTTTTT.....",
        "...PPPPPPPP...",
        "...PPPPPPPPP..",
        "..........PP..",
        "..........PP..",
        ".........KKKK.",
    ],
    hands: [
        "..............",
        "....HHHH......",
        "..SSHHHHSS....",
        "..TTHHSSST....",
        "..T.HSSEST....",
        "..T.HSSSST....",
        "..TT.SSSSTT...",
        "...TTTSSTT....",
        "...TTTTTT.....",
        "...TTTTTT.....",
        ...LAP,
    ],
    stand: [...STAND_TOP, "..TTTTTTTT....", "..TTTTTTTT....", ...STAND_LEGS],
    clip: [...STAND_TOP, "..TTTTTTTT.WW.", "..TTTTTTTTSWW.", "..STTTTTTT....", ...STAND_LEGS.slice(1)],
    box: [...STAND_TOP, "..TTTTTTBBBB..", "..TTTTTTBBBB..", "..STTTTSBBBB..", ...STAND_LEGS.slice(1)],
};

/** The grid a desk pose shows on a frame; undefined for an empty chair. */
export function spriteFor(pose: DeskPose, frame: 0 | 1): SpritePose | undefined {
    switch (pose) {
        case "type":
            return frame ? "type2" : "type1";
        case "handup":
            return frame ? "handup2" : "handup1";
        case "empty":
            return undefined;
        default:
            return pose;
    }
}

/** RGBA bytes for a grid, row-major, SPRITE_W × rows; an empty cell, or a role with no colour, stays clear. */
export function gridPixels(
    grid: string[],
    color: (role: CellRole) => [number, number, number] | undefined
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(SPRITE_W * grid.length * 4);
    grid.forEach((row, y) => {
        for (let x = 0; x < SPRITE_W; x++) {
            const c = row[x];
            if (c == null || c === ".") {
                continue;
            }
            const rgb = color(c as CellRole);
            if (rgb == null) {
                continue;
            }
            const i = (y * SPRITE_W + x) * 4;
            out[i] = rgb[0];
            out[i + 1] = rgb[1];
            out[i + 2] = rgb[2];
            out[i + 3] = 255;
        }
    });
    return out;
}

/** A computed custom property's value ("#rrggbb" or "rgb(r, g, b)") as bytes; anything else undefined. */
export function parseColor(value: string): [number, number, number] | undefined {
    const v = value.trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}
```

**Step 4: Add the tokens** — in `frontend/tailwindsetup.css`, inside `@theme`, after the `--color-teleport-soft` line:

```css
    /* The run office's people (view/jarvis/officesprite.ts, officesprites.ts): skin and hair by look 1-4, and their
       clothes. Identity like the teleport's, never theme-derived, so a person looks the same on every theme. Shirts
       reuse --color-graphlane-1..6 by task position. */
    --color-office-skin-1: #f1c9a5;
    --color-office-skin-2: #e8b894;
    --color-office-skin-3: #c68e64;
    --color-office-skin-4: #8d5a3b;
    --color-office-hair-1: #2b2420;
    --color-office-hair-2: #5a3a24;
    --color-office-hair-3: #1c1c1c;
    --color-office-hair-4: #a0522d;
    --color-office-pants: #3a3f4b;
    --color-office-ink: #141413; /* eyes and shoes */
    --color-office-paper: #e3e3e3; /* the reviewer's clipboard */
    --color-office-box: #a0764a; /* the box a worker carries to the merge */
    --color-office-lead: #c2c0b6; /* the lead's shirt */
    --color-office-visitor: #7b7972; /* a reviewer's shirt */
```

**Step 5: Run the test**

Run: `npx vitest run frontend/app/view/jarvis/officesprite.test.ts`
Expected: PASS (5 tests).

**Step 6: Commit**

```bash
git add frontend/app/view/jarvis/officesprite.ts frontend/app/view/jarvis/officesprite.test.ts
git commit -m "feat(jarvis): run office sprite data and its identity tokens" -- frontend/app/view/jarvis/officesprite.ts frontend/app/view/jarvis/officesprite.test.ts frontend/tailwindsetup.css
```

---

### Task 2: The office model

**Depends on:** Task 1

**Files:** `frontend/app/view/jarvis/officemodel.ts`, `frontend/app/view/jarvis/officemodel.test.ts`

- Create: `frontend/app/view/jarvis/officemodel.ts`
- Create: `frontend/app/view/jarvis/officemodel.test.ts`

**Step 1: Write the failing test** — `frontend/app/view/jarvis/officemodel.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { officeFloor, TASK_STATES, type OfficeRun } from "./officemodel";

const run = (tasks: OfficeRun["tasks"], stage: OfficeRun["stage"] = "working"): OfficeRun => ({
    runId: "r1",
    stage,
    tasks,
});
const task = (id: string, state: string, extra: Partial<OfficeRun["tasks"][number]> = {}) => ({
    id,
    label: "Task " + id,
    state,
    ...extra,
});

describe("officeFloor", () => {
    it("gives every engine task state its pose, screen and label", () => {
        const f = officeFloor(run(TASK_STATES.map((s, i) => task("t" + i, s))), []);
        const byState = Object.fromEntries(f.desks.map((d) => [d.state, d]));
        expect(byState["pending"]).toMatchObject({ pose: "empty", screen: "note", dim: true, label: "1 · waits" });
        expect(byState["running"]).toMatchObject({ pose: "type", screen: "lines", tone: "working", animated: true });
        expect(byState["stalled"]).toMatchObject({ pose: "slump", bubble: "?", tone: "asking" });
        expect(byState["reviewing"]).toMatchObject({ pose: "lean", visitor: true, screen: "diff" });
        expect(byState["blocked-merge"]).toMatchObject({ pose: "box", bubble: "⇄", tone: "error" });
        expect(byState["verifying"]).toMatchObject({ pose: "box", screen: "bar", animated: true });
        expect(byState["done"]).toMatchObject({ pose: "lean", screen: "check", tone: "done", animated: false });
        expect(byState["failed"]).toMatchObject({ pose: "hands", bubble: "×", tone: "error" });
        expect(byState["skipped"]).toMatchObject({ pose: "empty", dim: true });
        expect(f.desks.every((d) => d.label.length > 0)).toBe(true);
    });

    it("draws an unknown state as an empty, dimmed desk that names the state", () => {
        const [d] = officeFloor(run([task("a", "teleporting")]), []).desks;
        expect(d).toMatchObject({ pose: "empty", dim: true, label: "1 · teleporting" });
    });

    it("dresses task n in lane n and keeps a task's look across calls", () => {
        const tasks = Array.from({ length: 8 }, (_, i) => task("t" + i, "running"));
        const a = officeFloor(run(tasks), []);
        expect(a.desks.map((d) => d.shirt)).toEqual([1, 2, 3, 4, 5, 6, 1, 2]);
        expect(officeFloor(run(tasks), []).desks.map((d) => d.look)).toEqual(a.desks.map((d) => d.look));
        expect(a.desks.every((d) => d.look >= 1 && d.look <= 4)).toBe(true);
        expect(a.lead.shirt).toBe(0);
    });

    it("raises the hand of a worker whose agent is asking, whatever the task state", () => {
        const f = officeFloor(run([task("a", "running", { runid: "w1" })]), [
            { id: "tab-w1", runId: "w1", state: "asking" },
        ]);
        expect(f.desks[0]).toMatchObject({
            pose: "handup",
            bubble: "!",
            tone: "asking",
            label: "Needs you",
            agentId: "tab-w1",
            animated: true,
        });
        expect(f.board).toEqual(["asking"]);
    });

    it("opens the worker, else the reviewer, else nothing", () => {
        const f = officeFloor(
            run([task("a", "running", { runid: "w1" }), task("b", "reviewing", { reviewrunid: "rv" }), task("c", "done")]),
            [
                { id: "tab-w1", runId: "w1", state: "working" },
                { id: "tab-rv", runId: "rv", state: "working" },
            ]
        );
        expect(f.desks.map((d) => d.agentId)).toEqual(["tab-w1", "tab-rv", undefined]);
    });

    it("seats the lead by the run's stage, and an asking lead raises its hand", () => {
        const lead = (stage: OfficeRun["stage"]) => officeFloor(run([], stage), []).lead;
        expect(lead("planning")).toMatchObject({ pose: "type", label: "lead · planning" });
        expect(lead("plan-review")).toMatchObject({ pose: "lean", visitor: true });
        expect(lead("working")).toMatchObject({ pose: "lean", label: "lead · watching" });
        expect(lead("final-check")).toMatchObject({ pose: "box", screen: "bar" });
        expect(lead("wrapping-up")).toMatchObject({ pose: "type" });
        expect(lead("land-held")).toMatchObject({ pose: "hands", bubble: "!", tone: "error" });
        expect(lead("landed")).toMatchObject({ pose: "empty", dim: true });
        const asking = officeFloor(run([], "working"), [{ id: "tab-l", runId: "r1", state: "asking" }]).lead;
        expect(asking).toMatchObject({ pose: "handup", label: "Needs you", agentId: "tab-l" });
    });

    it("gives a run with no dag only its lead", () => {
        const f = officeFloor(run([], "planning"), []);
        expect(f.desks).toEqual([]);
        expect(f.board).toEqual([]);
        expect(f.lead.key).toBe("lead");
    });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/jarvis/officemodel.test.ts`
Expected: FAIL, `Failed to resolve import "./officemodel"`.

**Step 3: Write `frontend/app/view/jarvis/officemodel.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run office's floor (run office spec): who sits at which desk, in which pose, saying what. Pure, so every
// engine state is a table row a test can read; officeview.tsx draws a Floor and decides nothing.
//
// A desk's pose is the task's engine state (pkg/orchestrate/dag.go), except that an agent at a prompt raises its hand:
// a question waiting on the person outranks whatever the task is doing. Every desk carries a label in words, so no
// state is told by pose or colour alone.

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import type { RunStageKey } from "@/app/view/agents/runstage";
import type { DeskPose } from "./officesprite";

export type { DeskPose };
export type DeskScreen = "off" | "note" | "prompt" | "lines" | "diff" | "wait" | "fail" | "conflict" | "bar" | "check";
export type DeskTone = "muted" | "working" | "asking" | "error" | "done";

export interface Desk {
    key: string; // the task id, or "lead"
    state: string; // the engine state, or the run stage for the lead
    pose: DeskPose;
    visitor: boolean; // a reviewer stands behind with a clipboard
    screen: DeskScreen;
    bubble: string; // "" for none
    tone: DeskTone;
    dim: boolean;
    animated: boolean; // reads the frame clock
    label: string;
    tip: string;
    shirt: number; // graphlane slot 1..6; 0 is the lead's shirt
    look: number; // skin and hair 1..4
    agentId?: string; // the tab a click opens
}

export interface Floor {
    runId: string;
    lead: Desk;
    desks: Desk[];
    board: DeskTone[]; // the lead's wall board, a square per task
}

export interface OfficeRun {
    runId: string;
    stage: RunStageKey;
    tasks: Pick<TaskNode, "id" | "label" | "state" | "runid" | "reviewrunid">[];
}

type OfficeAgent = Pick<AgentVM, "id" | "runId" | "state">;
type Look = Pick<Desk, "pose" | "visitor" | "screen" | "bubble" | "tone" | "dim"> & { word: string };

const look = (word: string, l: Partial<Look> & Pick<Look, "pose" | "screen">): Look => ({
    word,
    visitor: false,
    bubble: "",
    tone: "muted",
    dim: false,
    ...l,
});

const TASK_LOOK: Record<string, Look> = {
    pending: look("waits", { pose: "empty", screen: "note", dim: true }),
    ready: look("starting", { pose: "stand", screen: "prompt" }),
    running: look("typing", { pose: "type", screen: "lines", tone: "working" }),
    stalled: look("stalled", { pose: "slump", screen: "wait", bubble: "?", tone: "asking" }),
    reviewing: look("in review", { pose: "lean", visitor: true, screen: "diff" }),
    "review-failed": look("review failed", { pose: "hands", screen: "fail", bubble: "!", tone: "error" }),
    "blocked-merge": look("merge blocked", { pose: "box", screen: "conflict", bubble: "⇄", tone: "error" }),
    verifying: look("verifying", { pose: "box", screen: "bar", tone: "working" }),
    "verify-failed": look("verify failed", { pose: "hands", screen: "fail", bubble: "×", tone: "error" }),
    done: look("done", { pose: "lean", screen: "check", tone: "done" }),
    failed: look("failed", { pose: "hands", screen: "fail", bubble: "×", tone: "error" }),
    cancelled: look("cancelled", { pose: "empty", screen: "off", dim: true }),
    skipped: look("skipped", { pose: "empty", screen: "off", dim: true }),
};

/** Every engine task state the office draws, in dag.go's order. */
export const TASK_STATES = Object.keys(TASK_LOOK);

const LEAD_LOOK: Record<RunStageKey, Look> = {
    planning: look("planning", { pose: "type", screen: "lines" }),
    "plan-review": look("plan review", { pose: "lean", visitor: true, screen: "diff" }),
    working: look("watching", { pose: "lean", screen: "lines", tone: "working" }),
    "final-check": look("final check", { pose: "box", screen: "bar", tone: "working" }),
    "wrapping-up": look("wrapping up", { pose: "type", screen: "lines", tone: "working" }),
    landing: look("landing", { pose: "box", screen: "bar", tone: "working" }),
    "land-held": look("land held", { pose: "hands", screen: "fail", bubble: "!", tone: "error" }),
    landed: look("landed", { pose: "empty", screen: "check", tone: "done", dim: true }),
    complete: look("complete", { pose: "empty", screen: "check", tone: "done", dim: true }),
    cancelled: look("cancelled", { pose: "empty", screen: "off", dim: true }),
};

const ASKING: Omit<Look, "word"> = {
    pose: "handup",
    visitor: false,
    screen: "wait",
    bubble: "!",
    tone: "asking",
    dim: false,
};

function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h;
}

function desk(
    key: string,
    state: string,
    l: Look,
    asking: boolean,
    label: string,
    tip: string,
    shirt: number,
    agentId: string | undefined
): Desk {
    const shown = asking ? { ...l, ...ASKING } : l;
    return {
        key,
        state,
        pose: shown.pose,
        visitor: shown.visitor,
        screen: shown.screen,
        bubble: shown.bubble,
        tone: shown.tone,
        dim: shown.dim,
        animated: shown.pose === "type" || shown.pose === "handup" || shown.screen === "bar",
        label: asking ? "Needs you" : label,
        tip: tip + (agentId ? " Click to open its terminal." : " Click to open the run."),
        shirt,
        look: (hash(key) % 4) + 1,
        agentId,
    };
}

/** A run's floor: its lead by the run's stage, and a desk per dag task in task order. */
export function officeFloor(run: OfficeRun, agents: OfficeAgent[]): Floor {
    const byRun = new Map<string, OfficeAgent>();
    for (const a of agents) {
        if (a.runId) {
            byRun.set(a.runId, a);
        }
    }
    const desks = run.tasks.map((t, i) => {
        const l = TASK_LOOK[t.state] ?? look(t.state, { pose: "empty", screen: "off", dim: true });
        const worker = t.runid ? byRun.get(t.runid) : undefined;
        const reviewer = t.reviewrunid ? byRun.get(t.reviewrunid) : undefined;
        const asking = worker?.state === "asking" || reviewer?.state === "asking";
        const n = i + 1;
        return desk(
            t.id,
            t.state,
            l,
            asking,
            `${n} · ${l.word}`,
            `Task ${n} · ${t.label || t.id} · ${asking ? "needs you" : l.word}.`,
            (i % 6) + 1,
            (worker ?? reviewer)?.id
        );
    });
    const leadAgent = byRun.get(run.runId);
    const ll = LEAD_LOOK[run.stage];
    const leadAsking = leadAgent?.state === "asking";
    const lead = desk(
        "lead",
        run.stage,
        ll,
        leadAsking,
        `lead · ${ll.word}`,
        `Lead · ${leadAsking ? "needs you" : ll.word}.`,
        0,
        leadAgent?.id
    );
    return { runId: run.runId, lead, desks, board: desks.map((d) => d.tone) };
}
```

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/jarvis/officemodel.test.ts frontend/app/view/jarvis/officesprite.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/app/view/jarvis/officemodel.ts frontend/app/view/jarvis/officemodel.test.ts
git commit -m "feat(jarvis): run office model — a desk per task, posed by its engine state" -- frontend/app/view/jarvis/officemodel.ts frontend/app/view/jarvis/officemodel.test.ts
```

---

### Task 3: Rasteriser, view, frame clock and dev hooks

**Depends on:** Task 1, Task 2

**Files:** `frontend/app/view/jarvis/officesprites.ts`, `frontend/app/view/jarvis/officeview.tsx`, `frontend/app/view/jarvis/officedevhooks.ts`

- Create: `frontend/app/view/jarvis/officesprites.ts`
- Create: `frontend/app/view/jarvis/officeview.tsx`
- Create: `frontend/app/view/jarvis/officedevhooks.ts`

**Step 1: Write `frontend/app/view/jarvis/officesprites.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Draws a pose in an outfit once and keeps it (run office spec, "Drawing"). A desk shows an <img> of a 14-column
// PNG scaled 3x, so a person costs one DOM node and a frame change is a src swap. The people's colours are identity
// tokens no theme overrides, so an entry never goes stale; the cache is bounded by poses × shirts × looks (320).

import { gridPixels, parseColor, POSES, SPRITE_W, type CellRole, type SpritePose } from "./officesprite";

export interface Outfit {
    shirt: number; // graphlane 1..6, 0 the lead
    look: number; // 1..4
    visitor?: boolean; // a reviewer: their own shirt and look
}

const cache = new Map<string, string>();
const colors = new Map<string, [number, number, number] | undefined>();

function token(name: string): [number, number, number] | undefined {
    if (!colors.has(name)) {
        colors.set(name, parseColor(getComputedStyle(document.documentElement).getPropertyValue(name)));
    }
    return colors.get(name);
}

function roleToken(role: CellRole, o: Outfit): string {
    const look = o.visitor ? 3 : o.look;
    switch (role) {
        case "H":
            return `--color-office-hair-${look}`;
        case "S":
            return `--color-office-skin-${look}`;
        case "T":
            return o.visitor ? "--color-office-visitor" : o.shirt === 0 ? "--color-office-lead" : `--color-graphlane-${o.shirt}`;
        case "P":
            return "--color-office-pants";
        case "W":
            return "--color-office-paper";
        case "B":
            return "--color-office-box";
        default:
            return "--color-office-ink";
    }
}

/** The pose drawn in the outfit, as a data URL; "" when the page cannot draw (no 2d context). */
export function spriteUrl(pose: SpritePose, o: Outfit): string {
    const key = `${pose}|${o.visitor ? "v" : o.shirt}|${o.visitor ? 3 : o.look}`;
    const hit = cache.get(key);
    if (hit != null) {
        return hit;
    }
    const grid = POSES[pose];
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_W;
    canvas.height = grid.length;
    const ctx = canvas.getContext("2d");
    let url = "";
    if (ctx != null) {
        ctx.putImageData(new ImageData(gridPixels(grid, (r) => token(roleToken(r, o))), SPRITE_W, grid.length), 0, 0);
        url = canvas.toDataURL("image/png");
    }
    cache.set(key, url);
    return url;
}

/** How many drawn sprites are kept, for the bench (jarvis-office-bench). */
export function spriteCacheSize(): number {
    return cache.size;
}
```

**Step 2: Write `frontend/app/view/jarvis/officeview.tsx`**

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run office (run office spec): a run's floor drawn under its Brief row. Thin by design: who sits where in what
// pose is officemodel.ts, the pixels are officesprite.ts and officesprites.ts. This file owns the toggle, the one
// frame clock and the DOM.
//
// Cost is the point of most choices here (the spec's Benchmark): a person is one <img> from a cache, furniture is a
// few bordered boxes, only animated desks subscribe to the clock, and the clock stops while the window is hidden,
// under reduced motion, and whenever the office is off.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { runStage } from "@/app/view/agents/runstage";
import { cn } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { memo, useEffect, useMemo, type CSSProperties } from "react";
import { officeFloor, type Desk, type DeskScreen, type DeskTone, type Floor } from "./officemodel";
import { POSES, spriteFor, type SpritePose } from "./officesprite";
import { spriteUrl, type Outfit } from "./officesprites";
import { openTarget } from "./openref";

// Off by default: the Brief stays a list until the person asks for the office (compact by default)
export const officeOnAtom = atomWithStorage<boolean>("jarvis.office.on", false);
export const officeFrameAtom = atom<0 | 1>(0);
// DEV-only: floors the CDP scenarios draw in place of live runs (officedevhooks.ts); always null in a real session
export const officeFixtureAtom = atom<{ title: string; floor: Floor }[] | null>(null);

const FRAME_MS = 450;
const SCALE = 3;
const FLOOR_Y = 88;
let clockRunning = false;

/** Whether the frame clock is ticking, for the bench. */
export function officeClockRunning(): boolean {
    return clockRunning;
}

/** The one frame clock. Mounted only while the office is on. */
export function OfficeClock() {
    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
        let timer: number | undefined;
        const sync = () => {
            const run = !document.hidden && !reduce.matches;
            if (run && timer == null) {
                timer = window.setInterval(
                    () => globalStore.set(officeFrameAtom, globalStore.get(officeFrameAtom) ? 0 : 1),
                    FRAME_MS
                );
            } else if (!run && timer != null) {
                window.clearInterval(timer);
                timer = undefined;
                globalStore.set(officeFrameAtom, 0);
            }
            clockRunning = timer != null;
        };
        sync();
        document.addEventListener("visibilitychange", sync);
        reduce.addEventListener("change", sync);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            reduce.removeEventListener("change", sync);
            if (timer != null) {
                window.clearInterval(timer);
            }
            clockRunning = false;
            globalStore.set(officeFrameAtom, 0);
        };
    }, []);
    return null;
}

/** The Runs region's toggle, beside the run-kind chips and drawn like them. */
export function OfficeToggle() {
    const on = useAtomValue(officeOnAtom);
    return (
        <button
            type="button"
            data-jarvis-office-toggle
            aria-pressed={on}
            title={on ? "Back to the run list" : "Draw the runs as an office"}
            onClick={() => globalStore.set(officeOnAtom, !on)}
            className={cn(
                "flex-none cursor-pointer rounded-[5px] border px-1.5 py-px text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                on ? "border-edge-strong text-ink-hi" : "border-transparent text-muted hover:text-ink-hi"
            )}
        >
            office
        </button>
    );
}

const TONE_TEXT: Record<DeskTone, string> = {
    muted: "text-muted",
    working: "text-working",
    asking: "text-asking",
    error: "text-error",
    done: "text-success",
};
const TONE_BG: Record<DeskTone, string> = {
    muted: "bg-edge-strong",
    working: "bg-working",
    asking: "bg-asking",
    error: "bg-error",
    done: "bg-success",
};
const TONE_BORDER: Record<DeskTone, string> = {
    muted: "border-muted",
    working: "border-working",
    asking: "border-asking",
    error: "border-error",
    done: "border-success",
};
const GLYPH: Partial<Record<DeskScreen, string>> = {
    prompt: "▍",
    wait: "…",
    fail: "✗",
    conflict: "⇄",
    check: "✓",
};

function spriteBox(pose: SpritePose, left: number): CSSProperties {
    const h = POSES[pose].length * SCALE;
    return { left, top: FLOOR_Y - h, width: 14 * SCALE, height: h };
}

function Person({ pose, outfit, left }: { pose: SpritePose; outfit: Outfit; left: number }) {
    return (
        <img
            alt=""
            draggable={false}
            src={spriteUrl(pose, outfit)}
            className="pointer-events-none absolute [image-rendering:pixelated]"
            style={spriteBox(pose, left)}
        />
    );
}

function Screen({ screen, tone, frame, left }: { screen: DeskScreen; tone: DeskTone; frame: 0 | 1; left: number }) {
    const glyph = GLYPH[screen];
    const lines = screen === "lines" || screen === "diff" ? (frame ? [22, 14, 18] : [16, 22, 10]) : null;
    return (
        <>
            <span
                className={cn(
                    "absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden border-2 border-edge-strong px-[3px] py-0.5",
                    screen === "off" || screen === "note" ? "bg-background" : "bg-surface-code"
                )}
                style={{ left, top: 36, width: 34, height: 24 }}
            >
                {screen === "note" ? <span className="absolute right-0.5 top-0.5 size-2 bg-warning-soft" /> : null}
                {glyph ? (
                    <span className={cn("font-mono text-xs font-bold leading-none", TONE_TEXT[tone])}>{glyph}</span>
                ) : null}
                {lines?.map((w, i) => (
                    <span
                        key={i}
                        className={cn("h-0.5 self-start", screen === "diff" ? "bg-muted" : TONE_BG[tone])}
                        style={{ width: screen === "diff" ? [20, 12, 20][i] : w }}
                    />
                ))}
                {screen === "bar" ? (
                    <span className="h-1 w-6 bg-edge-mid">
                        <span className={cn("block h-1", TONE_BG[tone])} style={{ width: frame ? 16 : 9 }} />
                    </span>
                ) : null}
            </span>
            <span className="absolute bg-edge-strong" style={{ left: left + 15, top: 60, width: 4, height: 4 }} />
        </>
    );
}

function DeskBody({
    desk,
    board,
    frame,
    onOpen,
}: {
    desk: Desk;
    board?: DeskTone[];
    frame: 0 | 1;
    onOpen: (d: Desk) => void;
}) {
    const lead = desk.key === "lead";
    const pose = spriteFor(desk.pose, frame);
    const standing = desk.pose === "stand" || desk.pose === "box";
    return (
        <button
            type="button"
            data-office-desk={desk.key}
            data-office-pose={desk.pose}
            data-office-state={desk.state}
            title={desk.tip}
            aria-label={desk.tip}
            onClick={() => onOpen(desk)}
            className={cn(
                "relative h-[116px] shrink-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                desk.dim && "opacity-55"
            )}
            style={{ width: lead ? 140 : 88 }}
        >
            {lead ? (
                <>
                    <span
                        className="absolute flex flex-wrap content-start gap-0.5 border-2 border-edge-strong bg-surface-code p-[3px]"
                        style={{ left: 80, top: 4, width: 50, height: 26 }}
                    >
                        {(board ?? []).map((t, i) => (
                            <span key={i} className={cn("size-1", TONE_BG[t])} />
                        ))}
                    </span>
                    <span className="absolute bg-edge-strong opacity-80" style={{ left: 137, top: 2, width: 3, height: 86 }} />
                </>
            ) : null}
            {/* the chair: back and seat as one box's two borders, then its stem */}
            <span className="absolute border-b-[3px] border-l-4 border-edge-strong" style={{ left: 12, top: 52, width: 28, height: 30 }} />
            <span className="absolute bg-edge-strong" style={{ left: 25, top: 82, width: 4, height: 6 }} />
            {desk.visitor ? <Person pose="clip" outfit={{ shirt: 0, look: 3, visitor: true }} left={-8} /> : null}
            {pose ? <Person pose={pose} outfit={{ shirt: desk.shirt, look: desk.look }} left={standing ? 2 : 8} /> : null}
            {/* the desk: its top and both legs as one box's borders, then the keyboard */}
            <span
                className="absolute border-x-[3px] border-t-4 border-edge-strong"
                style={{ left: 38, top: 64, width: lead ? 96 : 48, height: 24 }}
            />
            <span className="absolute bg-ink-faint" style={{ left: 40, top: 61, width: 12, height: 3 }} />
            <Screen screen={desk.screen} tone={desk.tone} frame={frame} left={lead ? 56 : 52} />
            {lead ? <Screen screen={desk.screen} tone={desk.tone} frame={frame} left={94} /> : null}
            {desk.bubble ? (
                <span
                    className={cn(
                        "absolute flex h-4 min-w-4 items-center justify-center rounded-[3px] border bg-surface-raised px-[3px] text-[11px] font-bold leading-none",
                        TONE_TEXT[desk.tone],
                        TONE_BORDER[desk.tone]
                    )}
                    style={{ left: standing ? 12 : 20, top: 12 }}
                >
                    {desk.bubble}
                </span>
            ) : null}
            <span
                className={cn(
                    "absolute inset-x-0 truncate text-center text-[10px] leading-[14px]",
                    desk.label === "Needs you" ? "text-asking" : "text-muted"
                )}
                style={{ top: 94 }}
            >
                {desk.label}
            </span>
        </button>
    );
}

function AnimatedDesk(props: { desk: Desk; board?: DeskTone[]; onOpen: (d: Desk) => void }) {
    const frame = useAtomValue(officeFrameAtom);
    return <DeskBody {...props} frame={frame} />;
}

function DeskSlot(props: { desk: Desk; board?: DeskTone[]; onOpen: (d: Desk) => void }) {
    return props.desk.animated ? <AnimatedDesk {...props} /> : <DeskBody {...props} frame={0} />;
}

/** One floor: the wall, the floor band, the lead's office and a desk per task; scrolls sideways when wider. */
export const OfficeScene = memo(function OfficeScene({
    floor,
    selected,
    onOpen,
}: {
    floor: Floor;
    selected?: boolean;
    onOpen: (d: Desk) => void;
}) {
    return (
        <div
            data-office-floor={floor.runId}
            className={cn("overflow-x-auto overflow-y-hidden rounded-md", selected ? "bg-surface-selected" : "bg-surface")}
        >
            <div className="relative flex h-[116px] w-max min-w-full px-2">
                <span aria-hidden className="absolute inset-x-0 bottom-0 top-[88px] bg-surface-raised" />
                <span aria-hidden className="absolute inset-x-0 top-[88px] h-0.5 bg-edge-strong" />
                <DeskSlot desk={floor.lead} board={floor.board} onOpen={onOpen} />
                {floor.desks.map((d) => (
                    <DeskSlot key={d.key} desk={d} onOpen={onOpen} />
                ))}
            </div>
        </div>
    );
});

/** The floor of one live run, read from the store as the run list reads it. */
export function LiveOfficeFloor({ model, runId, selected }: { model: AgentsViewModel; runId: string; selected?: boolean }) {
    const floorAtom = useMemo(
        () =>
            atom((get) => {
                const run = get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", runId)));
                // dagoref holds the dag's bare id, whatever its name says
                const dag = run?.dagoref
                    ? get(WOS.getWaveObjectAtom<TaskGroup>(WOS.makeORef("dag", run.dagoref)))
                    : undefined;
                const stage = runStage({ status: run?.status, land: run?.land, dag }).key;
                return officeFloor({ runId, stage, tasks: dag?.tasks ?? [] }, get(model.agentsAtom));
            }),
        [model, runId]
    );
    const floor = useAtomValue(floorAtom);
    const onOpen = useMemo(
        () => (d: Desk) =>
            void openTarget(model, d.agentId ? { kind: "agent", tabId: d.agentId } : { kind: "run", runId }),
        [model, runId]
    );
    return <OfficeScene floor={floor} selected={selected} onOpen={onOpen} />;
}

/** DEV-only: the fixture floors, drawn after the live ones. Renders nothing in a real session. */
export function OfficeFixtureFloors() {
    const fixture = useAtomValue(officeFixtureAtom);
    if (fixture == null) {
        return null;
    }
    return (
        <div data-office-fixture className="flex flex-col gap-2">
            {fixture.map((f) => (
                <div key={f.floor.runId} className="flex flex-col gap-1">
                    <div className="px-1 text-[13px] font-medium text-secondary">{f.title}</div>
                    <OfficeScene floor={f.floor} onOpen={() => {}} />
                </div>
            ))}
        </div>
    );
}
```

If `runStage`'s parameter type rejects the object literal (it takes `Pick<RunInfo, "status" | "land" | "dag">`),
cast the fields the way `lineageAtomFor` builds a `RunInfo` in `view/agents/runlineagestore.ts`; do not widen
`runStage`.

**Step 3: Write `frontend/app/view/jarvis/officedevhooks.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-only seam for the run office's CDP scenarios (jarvis-office, jarvis-office-bench), installed by BriefSurface and
// never imported in a production build. __officeFixture hands the model made-up runs, so a scenario can draw every
// state and the bench can draw 104 desks without starting real workers. __officeProbe reads what the bench budgets.

import { globalStore } from "@/app/store/jotaiStore";
import { officeFloor, type OfficeRun } from "./officemodel";
import { spriteCacheSize } from "./officesprites";
import { officeClockRunning, officeFixtureAtom } from "./officeview";

type FixtureRun = { title: string; run: OfficeRun; agents?: { id: string; runId: string; state: "asking" | "working" | "idle" }[] };

export function installOfficeDevHooks(): void {
    const w = window as unknown as {
        __officeFixture?: (runs: FixtureRun[] | null) => void;
        __officeProbe?: () => { cache: number; clock: boolean; desks: number; floors: number };
    };
    w.__officeFixture = (runs) =>
        globalStore.set(
            officeFixtureAtom,
            runs == null ? null : runs.map((r) => ({ title: r.title, floor: officeFloor(r.run, r.agents ?? []) }))
        );
    w.__officeProbe = () => ({
        cache: spriteCacheSize(),
        clock: officeClockRunning(),
        desks: document.querySelectorAll("[data-office-desk]").length,
        floors: document.querySelectorAll("[data-office-floor]").length,
    });
}
```

**Step 4: Typecheck**

Run: `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (about 2 minutes; give it a 5-minute timeout)
Expected: exit 0. Nothing renders these files yet; the typecheck is the check.

**Step 5: Commit**

```bash
git add frontend/app/view/jarvis/officesprites.ts frontend/app/view/jarvis/officeview.tsx frontend/app/view/jarvis/officedevhooks.ts
git commit -m "feat(jarvis): run office view — cached sprites, one frame clock, dev hooks" -- frontend/app/view/jarvis/officesprites.ts frontend/app/view/jarvis/officeview.tsx frontend/app/view/jarvis/officedevhooks.ts
```

---

### Task 4: Wire the office into the Brief's Runs region

**Depends on:** Task 3

**Files:** `frontend/app/view/jarvis/briefsurface.tsx`, `CHANGELOG.md`

- Modify: `frontend/app/view/jarvis/briefsurface.tsx` (the dev-hook effect near line 585; the `sessions` `Region`
  near line 1765 and its row map near line 1805)
- Modify: `CHANGELOG.md` (top `## Unreleased` → `### Added`)

**Step 1: Import** — add to `briefsurface.tsx`'s imports:

```ts
import { LiveOfficeFloor, OfficeClock, OfficeFixtureFloors, OfficeToggle, officeOnAtom } from "./officeview";
```

**Step 2: Read the toggle** — in the component that renders the `sessions` `Region` (the one that has `runKind` and
`setRunKind`), next to the other atom reads:

```ts
const officeOn = useAtomValue(officeOnAtom);
```

**Step 3: Install the dev hooks** — beside the existing `installLinkingDevHooks` effect:

```ts
    // DEV-only: the run office scenarios' seams (officedevhooks.ts)
    useEffect(() => {
        if (import.meta.env.DEV) {
            void import("./officedevhooks").then((m) => m.installOfficeDevHooks());
        }
    }, []);
```

**Step 4: The toggle** — change the `sessions` `Region`'s `tools` prop from
`tools={<RunKindToggle value={runKind} onChange={setRunKind} />}` to:

```tsx
tools={
    <>
        <RunKindToggle value={runKind} onChange={setRunKind} />
        <OfficeToggle />
    </>
}
```

**Step 5: A floor under each run row** — inside the `motion.div` of `view.sessionLines.map`, right after
`<BriefRunRow … />`:

```tsx
{officeOn && l.runOid ? (
    <div className="mb-2 mt-1">
        <LiveOfficeFloor
            model={model}
            runId={l.runOid}
            selected={sheetOpen && stageRun?.id === l.runOid}
        />
    </div>
) : null}
```

Then, right after the closing `</MotionConfig>` of that list (before the stale-runs button):

```tsx
{officeOn ? (
    <>
        <OfficeClock />
        <OfficeFixtureFloors />
    </>
) : null}
```

**Step 6: CHANGELOG** — under the top `## Unreleased` → `### Added`, add:

```md
- **Runs as an office**: in Jarvis, the Runs list's **office** chip draws each run as a pixel office floor under its
  row: the lead in a glass corner office and one person per task, typing, stuck, in review, carrying the merge, or
  raising a hand when they need you. Click a person to open their terminal.
```

**Step 7: Typecheck and the unit tests**

Run: `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (5-minute timeout)
Expected: exit 0.
Run: `npx vitest run frontend/app/view/jarvis/officemodel.test.ts frontend/app/view/jarvis/officesprite.test.ts`
Expected: PASS.

**Step 8: Look at it** — with the dev app running (`task dev`), go to Jarvis, click **office** on the Runs region,
and capture: `node scripts/cdp-shot.mjs cdp-shots/office-live.png`. With a live orchestrator run, its floor shows
under its row; with none, nothing changes but the chip. Turn it back off. Task 5's `jarvis-office` scenario is the
repeatable check.

**Step 9: Commit**

```bash
git commit -m "feat(jarvis): draw the Brief's runs as an office floor under each row" -- frontend/app/view/jarvis/briefsurface.tsx CHANGELOG.md
```

---

### Task 5: The office scenarios and the benchmark

**Depends on:** Task 4

**Files:** `scripts/cdp/officescenarios.mjs`, `scripts/cdp/scenarios.mjs`, `docs/open-issues.md`

- Create: `scripts/cdp/officescenarios.mjs` (4-space indent, hand-formatted; never run prettier on it)
- Modify: `scripts/cdp/scenarios.mjs` (one import near the other local imports at the top; two entries at the end of
  `SCENARIOS`)
- Modify: `docs/open-issues.md` (the hand-check line, and the measured numbers under "RAM watch")

**Step 1: Write `scripts/cdp/officescenarios.mjs`**

```js
// The run office's CDP scenarios (docs/superpowers/specs/2026-10-14-run-office-design.md).
//
// jarvis-office draws every pose from a fixture and checks each desk says what it is. jarvis-office-bench holds the
// spec's budgets: it draws 104 desks and reads Performance.getMetrics with the office off, open, held open for 30 s,
// held under reduced motion, and off again. Both feed the model through the DEV-only __officeFixture hook
// (officedevhooks.ts), so no real run or worker is started.

const TOGGLE = `document.querySelector("[data-jarvis-office-toggle]")`;
const TASK_STATES = [
    "pending", "ready", "running", "stalled", "reviewing", "review-failed", "blocked-merge",
    "verifying", "verify-failed", "done", "failed", "cancelled", "skipped",
];
const STAGES = ["working", "plan-review", "wrapping-up", "final-check", "working", "land-held", "planning", "working"];

function fixtureRuns(nRuns, nTasks) {
    return Array.from({ length: nRuns }, (_, r) => ({
        title: `Fixture run ${r + 1}`,
        run: {
            runId: `fx-${r}`,
            stage: STAGES[r % STAGES.length],
            tasks: Array.from({ length: nTasks }, (_, t) => ({
                id: `fx-${r}-t${t + 1}`,
                label: `Fixture task ${t + 1}`,
                state: TASK_STATES[(t + r) % TASK_STATES.length],
                runid: `fx-${r}-w${t + 1}`,
            })),
        },
        // one worker at a prompt, so the raised hand is on the floor
        agents: r === 0 ? [{ id: "fx-ask", runId: "fx-0-w3", state: "asking" }] : [],
    }));
}

async function setOffice(h, on) {
    return h.ev(`(async () => {
        const b = ${TOGGLE};
        if (!b) return "no toggle";
        if ((b.getAttribute("aria-pressed") === "true") !== ${on}) b.click();
        for (let i = 0; i < 40 && (${TOGGLE}.getAttribute("aria-pressed") === "true") !== ${on}; i++) {
            await new Promise((r) => setTimeout(r, 50));
        }
        return ${TOGGLE}.getAttribute("aria-pressed");
    })()`);
}

async function metrics(h) {
    await h.cdp("HeapProfiler.collectGarbage");
    const { metrics: list } = await h.cdp("Performance.getMetrics");
    const m = Object.fromEntries(list.map((x) => [x.name, x.value]));
    return { heap: m.JSHeapUsedSize, nodes: m.Nodes, task: m.TaskDuration };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 100) / 100;

export const jarvisOffice = {
    name: "jarvis-office",
    surface: "jarvis",
    async arrange(h) {
        return {};
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        ctx.wasOn = (await h.ev(`${TOGGLE}?.getAttribute("aria-pressed")`)) === "true";
        const runs = [
            { ...fixtureRuns(1, TASK_STATES.length)[0], title: "Every task state" },
            ...fixtureRuns(3, 3).slice(1),
        ];
        // floor 0's tasks in dag.go order, one per state
        runs[0].run.tasks.forEach((t, i) => (t.state = TASK_STATES[i]));
        await h.ev(`window.__officeFixture(${JSON.stringify(runs)})`);
        await setOffice(h, true);
        const seen = await h.ev(`(async () => {
            for (let i = 0; i < 60 && !document.querySelector("[data-office-fixture] [data-office-desk]"); i++) {
                await new Promise((r) => setTimeout(r, 100));
            }
            const desks = [...document.querySelectorAll("[data-office-fixture] [data-office-desk]")];
            return {
                states: [...new Set(desks.filter((d) => d.dataset.officeDesk !== "lead").map((d) => d.dataset.officeState))],
                leads: desks.filter((d) => d.dataset.officeDesk === "lead").length,
                unlabelled: desks.filter((d) => !d.textContent.trim()).length,
                needsYou: desks.filter((d) => d.dataset.officePose === "handup" && d.textContent.includes("Needs you")).length,
                imgs: desks.flatMap((d) => [...d.querySelectorAll("img")]).filter((i) => !i.src.startsWith("data:image/png")).length,
            };
        })()`);
        rec("0. the fixture floors drew", seen?.leads === 3, JSON.stringify(seen));
        rec(
            "1. every engine task state has a desk",
            TASK_STATES.every((s) => seen?.states?.includes(s)),
            JSON.stringify(seen?.states)
        );
        rec("2. every desk says what it is in words", seen?.unlabelled === 0, `unlabelled: ${seen?.unlabelled}`);
        rec("3. the asking worker raises a hand and reads Needs you", seen?.needsYou === 1, `needsYou: ${seen?.needsYou}`);
        rec("4. every person is a drawn sprite", seen?.imgs === 0, `undrawn: ${seen?.imgs}`);
        await h.ev(`document.querySelector("[data-office-fixture]")?.scrollIntoView({ block: "start" })`);
        await h.shot("cdp-shots/jarvis-office.png");
        await setOffice(h, false);
        const gone = await h.ev(`document.querySelectorAll("[data-office-floor]").length`);
        rec("5. turning it off removes every floor", gone === 0, `floors left: ${gone}`);
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(`window.__officeFixture?.(null)`);
        await setOffice(h, ctx.wasOn === true);
    },
};

export const jarvisOfficeBench = {
    name: "jarvis-office-bench",
    surface: "jarvis",
    async arrange(h) {
        return {};
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        ctx.wasOn = (await h.ev(`${TOGGLE}?.getAttribute("aria-pressed")`)) === "true";
        await h.cdp("Performance.enable");
        await setOffice(h, false);
        const runs = fixtureRuns(8, 12);
        const want = 8 * 13;
        await h.ev(`window.__officeFixture(${JSON.stringify(runs)})`);
        const closed = await metrics(h);

        const openMs = await h.ev(`(async () => {
            const t0 = performance.now();
            ${TOGGLE}.click();
            for (let i = 0; i < 300 && document.querySelectorAll("[data-office-fixture] [data-office-desk]").length < ${want}; i++) {
                await new Promise((r) => requestAnimationFrame(r));
            }
            await new Promise((r) => requestAnimationFrame(r));
            return performance.now() - t0;
        })()`);
        await sleep(2000);
        const open = await metrics(h);
        await sleep(30000);
        const held = await metrics(h);
        const probe = await h.ev(`window.__officeProbe()`);

        await h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await sleep(500);
        const calmStart = await metrics(h);
        const calmClock = (await h.ev(`window.__officeProbe()`)).clock;
        await sleep(30000);
        const calmEnd = await metrics(h);
        await h.cdp("Emulation.setEmulatedMedia", { features: [] });

        await setOffice(h, false);
        await sleep(500);
        const after = await metrics(h);
        const offProbe = await h.ev(`window.__officeProbe()`);

        const r = {
            desks: probe.desks,
            heapOpenMB: mb(open.heap - closed.heap),
            nodesAdded: open.nodes - closed.nodes,
            busyPct: Math.round(((held.task - open.task) / 30) * 1000) / 10,
            busyReducedPct: Math.round(((calmEnd.task - calmStart.task) / 30) * 1000) / 10,
            cache: probe.cache,
            heapAfterOffMB: mb(after.heap - closed.heap),
            openMs: Math.round(openMs),
            clockReduced: calmClock,
            clockOff: offProbe.clock,
        };
        ctx.result = r;
        const d = JSON.stringify(r);
        rec("0. the bench drew 104 desks", r.desks >= want, d);
        rec("1. JS heap open minus closed <= 5 MB", r.heapOpenMB <= 5, `${r.heapOpenMB} MB`);
        rec("2. DOM nodes added <= 2,000", r.nodesAdded <= 2000, `${r.nodesAdded}`);
        rec("3. main thread busy over 30 s <= 2 %", r.busyPct <= 2, `${r.busyPct} %`);
        rec("4. busy under reduced motion <= 0.5 %, clock stopped", r.busyReducedPct <= 0.5 && r.clockReduced === false, `${r.busyReducedPct} %, clock ${r.clockReduced}`);
        rec("5. sprite cache <= 320 entries", r.cache <= 320, `${r.cache}`);
        rec("6. heap after turning it off <= 1 MB over closed, clock stopped", r.heapAfterOffMB <= 1 && r.clockOff === false, `${r.heapAfterOffMB} MB, clock ${r.clockOff}`);
        rec("7. toggle to floors drawn <= 150 ms", r.openMs <= 150, `${r.openMs} ms`);
        console.log(`[jarvis-office-bench] ${d}`);
        return steps;
    },
    async teardown(h, ctx) {
        await h.cdp("Emulation.setEmulatedMedia", { features: [] });
        await h.ev(`window.__officeFixture?.(null)`);
        await setOffice(h, ctx.wasOn === true);
    },
};
```

**Step 2: Register them** — in `scripts/cdp/scenarios.mjs`, beside `import { narrationFeed } from "./narrationfeed.mjs";`:

```js
import { jarvisOffice, jarvisOfficeBench } from "./officescenarios.mjs";
```

and add `jarvisOffice,` and `jarvisOfficeBench,` as the last two entries of the `SCENARIOS` array.

**Step 3: Check the registry still loads**

Run: `npx vitest run scripts/cdp/scenarios.test.mjs`
Expected: PASS (it checks names are unique and every scenario is well-formed; if it lists required fields the two
new scenarios lack, add them in the shape it asks for).

**Step 4: Run them on the dev app** (needs `task dev` running; skip and say so if it is not)

Run: `task verify:ui -- jarvis-office jarvis-office-bench`
Expected: both PASS; the bench prints a `[jarvis-office-bench] {…}` line. The bench takes about 75 seconds.
A budget the bench misses stays a FAIL: report the number, do not raise the budget, do not tune the scenario around it.

**Step 5: Record the numbers** — in `docs/open-issues.md`:

1. Under `## 0 · Waiting on a hand check`, add a dated group with one line:

```md
**2026-10-14 (Run office in Jarvis)**

- [ ] (arcterm) **Runs as an office.** With an orchestrator run going, open Jarvis and click **office** on the Runs
  region: a floor shows under the run's row with the lead behind glass and a person per task; a worker typing moves,
  a finished one leans back with a check, and clicking a working person opens their terminal. Turn it off: the list
  is as before. `view/jarvis/officeview.tsx`.
```

2. If the file has no `RAM watch` heading, add `### (arcterm) RAM watch` at the end of `## 1 · Actionable`. Under it:

```md
- **Run office** (2026-10-14, `jarvis-office-bench`, 104 desks, dev app): heap +<heapOpenMB> MB open, +<nodesAdded>
  DOM nodes, <busyPct> % main thread over 30 s (<busyReducedPct> % reduced motion), <cache> sprites, +<heapAfterOffMB>
  MB after off, <openMs> ms to draw. Budgets: 5 MB, 2,000, 2 %, 0.5 %, 320, 1 MB, 150 ms. Mounted only while the
  office is on.
```

with the measured values from the bench line. If the bench could not run, write "not measured yet" and why.

**Step 6: Commit**

```bash
git add scripts/cdp/officescenarios.mjs
git commit -m "test(cdp): run office scenarios and its RAM/CPU bench" -- scripts/cdp/officescenarios.mjs scripts/cdp/scenarios.mjs docs/open-issues.md
```
