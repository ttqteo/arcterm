# Office Pet Boss — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Cockpit office the boss the person walks is the pet they picked (Sprout, the Minion, or Spider-Man as
Peter Parker in a shirt and tie), the footer creature gives way to it while the Office shows, its bubble and peek hang
off the boss, and each time the Office opens the pet makes an entrance: Spider-Man swings in through a window, unmasks
and becomes Peter in a puff of smoke; Sprout and the Minion arrive by the teleport's beam.

**Architecture:** Two new pure models beside the office: `officepet.ts` picks the boss pet's pose, facing and marks
from the boss's motion, the time since input and the pet's condition; `officeentrance.ts` holds the entrance's timeline,
its 2-minute cooldown and the nearest window. `petsprite.ts` gains Peter's boss grids, the unmask and puff frames and the
tie's colour code. `scenery.ts` exports the outer-wall windows it already draws. `petstore.ts` gains the atoms through
which the office's boss element replaces the footer creature, and `petview.tsx` reads them. `cockpitoffice.tsx`'s
`BossView` draws an `<svg>` of the pet's cells in place of the chibi `<img>` and plays the entrance.

**Tech Stack:** React 19 + Tailwind 4 + jotai + motion, vitest, the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-16-office-pet-boss-design.md` and the canvas in the Prototype line (boards
`Main`, `Entrance`, `Floor`).

**Verify:** `node scripts/verify.mjs ./pkg/wconfig`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs cockpit-office cockpit-office-pet cockpit-office-bench`
**Prototype:** <repo>/.superpowers/design/office-pet-boss/project/

## Global Constraints

- Frontend only. `Verify` names `./pkg/wconfig` only because `scripts/verify.mjs` needs one Go pattern; no Go changes.
- This plan starts after the Office floors run (`docs/superpowers/plans/2026-10-16-office-floors.md`) has landed. That
  run reshapes `cockpitoffice.tsx`, `officeplanmodel.ts` and `scenery.ts`: find the code below by the names given
  (`BossView`, `Mover`, `bossAtom`, `walkFrameAtom`, `readOfficeProbe`, the outer-wall windows loop in `scenery`), not
  by line numbers, and keep what that run built (floors, the lift, the notice board) as it is.
- Colours come from `@theme` tokens (`frontend/tailwindsetup.css`): the pet's cells name `--color-*` properties through
  `PET_TOKENS`, never a hex in a component. The one new token is `--color-peter-tie`.
- Pure logic in `.ts` with a `.test.ts` beside it; no jsdom render tests (AGENTS.md, "Frontend conventions").
- The grids below are the canvas's, letter for letter (the canvas was generated from them). Copy them exactly.
- Run single test files with `npx vitest run <file>`; the typecheck is `task check:ts` (~2 min, give it a 5-minute
  timeout).
- Commit with a pathspec: `git commit -m "<msg>" -- <paths>` (add new files with `git add -- <paths>` first). Never
  leave files staged.

---

### Task 1: Peter the boss's grids, the entrance frames and the tie's colour

**Depends on:** none

**Files:** `frontend/app/view/jarvis/petsprite.ts`, `frontend/app/view/jarvis/petsprite.test.ts`, `frontend/tailwindsetup.css`

What each file is for:
- Modify: `frontend/app/view/jarvis/petsprite.ts` — the `t` cell code, `PETER_BOSS_POSES`, `SPIDEY_UNMASK`,
  `SPIDEY_PUFF`, and a `bossRows` helper
- Modify: `frontend/app/view/jarvis/petsprite.test.ts` — their shape and codes
- Modify: `frontend/tailwindsetup.css` — `--color-peter-tie` beside `--color-peter-shirt`

- [ ] **Step 1: Write the failing tests**

Add to `petsprite.test.ts` (extend the import from `./petsprite` with `bossRows`, `PETER_BOSS_POSES`, `SPIDEY_PUFF`,
`SPIDEY_UNMASK`):

```ts
describe("Peter the boss", () => {
    const grids: [string, readonly string[]][] = [
        ...Object.entries(PETER_BOSS_POSES),
        ["unmask", SPIDEY_UNMASK],
        ["puff", SPIDEY_PUFF],
    ];

    it("has a grid for every pose", () => {
        expect(Object.keys(PETER_BOSS_POSES).sort()).toEqual([...POSE_NAMES].sort());
    });

    it.each(grids)("%s is 16x16 and uses only known codes", (_name, rows) => {
        expect(rows).toHaveLength(PET_GRID);
        for (const row of rows) {
            expect(row).toHaveLength(PET_GRID);
            for (const c of row) {
                expect(c === "." || c in PET_TOKENS).toBe(true);
            }
        }
    });

    it.each(Object.entries(PETER_BOSS_POSES))("%s shows no suit", (_pose, rows) => {
        expect(rows.join("")).not.toMatch(/[SD]/);
    });

    it("draws the tie in its own token", () => {
        expect(PET_TOKENS.t).toBe("--color-peter-tie");
        expect(PETER_BOSS_POSES.stand.join("")).toContain("t");
    });

    it("draws Spider-Man in the office from the boss grids, the others from their own", () => {
        expect(bossRows("stand", "spidey")).toBe(PETER_BOSS_POSES.stand);
        expect(bossRows("stand", "sprout")).toBe(POSES.stand);
        expect(bossRows("walk1", "minion")).toBe(MINION_POSES.walk1);
    });

    it("defines the tie's token in the theme", () => {
        const css = readFileSync("frontend/tailwindsetup.css", "utf8");
        expect(css).toMatch(/--color-peter-tie:\s*#[0-9a-f]{6};/i);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/jarvis/petsprite.test.ts`
Expected: FAIL (`PETER_BOSS_POSES` is not exported).

- [ ] **Step 3: Add the token**

In `frontend/tailwindsetup.css`, after `--color-peter-shirt: #e4e7ee;`:

```css
    --color-peter-tie: #ff6b80;
```

- [ ] **Step 4: Add the code, the grids and the helper**

In `PET_TOKENS` (`petsprite.ts`), after `v: "--color-peter-shirt",`:

```ts
    t: "--color-peter-tie", // Peter the boss's tie
```

After `SPIDEY_LOOK` and its block, add:

```ts
// Peter Parker as the Cockpit office's boss (office pet boss spec): the suit hidden under a buttoned shirt and a tie,
// jeans, the hair and glasses of his rest poses. The walk is front-on, a foot lifted in turn, so it is never mirrored;
// the rest poses are SPIDEY_POSES' Peter grids with the shirt buttoned over the suit. dangle is never drawn in the
// office (the boss is not dragged) and holds the stand.
export const PETER_BOSS_POSES: Record<PetPose, readonly string[]> = {
    walk1: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvv...",
        ".....vvvvvvvp...",
        ".....BBBBBBB....",
        ".....BB...ss....",
        "....ss..........",
    ],
    walk2: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....vvvvtvvvp...",
        "...pvvvvvvv.....",
        ".....BBBBBBB....",
        ".....ss...BB....",
        "..........ss....",
    ],
    stand: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        ".....BBBBBBB....",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    sit: [
        E,
        E,
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        "...BBBBBBBBBBB..",
        "..ss.........ss.",
    ],
    sleep: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gppgppg....",
        ".....ppppppp....",
        ".....ppppppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        "....BBBBBBBBB...",
        "....BBBBBBBBB...",
        "....BBBBBBBBBss.",
    ],
    tired: [
        E,
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gkkgkkg....",
        ".....ppppppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....vvvvvvvvv...",
        "....pBBBBBBBp...",
        "....BB.....BB...",
        ".....B.....B....",
        "....ss.....ss...",
    ],
    speak: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp..p.",
        ".....ppkkkpp.vp.",
        "......ppppp..v..",
        "....vvvvtvvvvv..",
        "....pvvvvvvv....",
        ".....vvvvvvv....",
        ".....BB...BB....",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    dangle: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        ".....BBBBBBB....",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    read1: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gkegkeg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        "..prwwwwrwwwwrp.",
        "...rmmwwrmmwwr..",
        "...rrrrrrrrrrss.",
    ],
    read2: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        "..prwwwwrwwwwrp.",
        "...rwwmmrwwmmr..",
        "...rrrrrrrrrrss.",
    ],
    music1: [
        "............yy..",
        "..yy........y...",
        ".yy..mmmmmm.yy..",
        "....mHHHHHHm....",
        "...rrHHHHHHHrr..",
        "...rrHpppppHrr..",
        "...rrgekgekrr...",
        ".....ppppppp....",
        ".....ppkkkpp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        ".....BBBBBBB....",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    music2: [
        "..yy............",
        "..y.........yy..",
        ".yy..mmmmmm.y...",
        "....mHHHHHHm....",
        "...rrHHHHHHHrr..",
        "...rrHpppppHrr..",
        "...rrgekgekrr...",
        ".....ppppppp....",
        ".....ppkkkpp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        ".....BBBBBBB....",
        ".....BB..BB.....",
        "....ss....ss....",
    ],
    work1: [
        ".......w...w.w..",
        "......w...w...w.",
        ".......w.w...w..",
        "......H.H.......",
        ".....HHHHHH...m.",
        ".....HpppppH.lm.",
        ".....gekgekg.lm.",
        ".....ppppppp.lm.",
        "......ppppp..lm.",
        "....vvvvtvvvvlm.",
        "....pvvvtvvvplm.",
        ".....vvvvvvv.lm.",
        ".....BBBBBBB.lm.",
        ".....BBBBBBBmwmm",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    work2: [
        ".......m...m.m..",
        "......m...m...m.",
        ".......m.m...m..",
        "......H.H.......",
        ".....HHHHHH...m.",
        ".....HpppppH.wm.",
        ".....gkegkeg.wm.",
        ".....ppppppp.wm.",
        "......ppppp..wm.",
        "....vvvvtvvvvwm.",
        "....pvvvtvvvpwm.",
        ".....vvvvvvv.wm.",
        ".....BBBBBBB.wm.",
        ".....BBBBBBBmmwm",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    ball1: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp.rr.",
        ".....pppkppprrrr",
        "......ppppp.rrrr",
        "....vvvvtvvvvrr.",
        "....pvvvtvvvp...",
        ".....vvvvvvv....",
        ".....BBBBBBB....",
        ".....BB...BB....",
        "....ss....ss....",
    ],
    ball2: [
        E,
        E,
        "......H.H.......",
        ".....HHHHHH.....",
        ".....HHHHHHHH...",
        ".....HpppppH....",
        ".....gekgekg....",
        ".....ppppppp....",
        ".....pppkppp....",
        "......ppppp.....",
        "....vvvvtvvvv...",
        "....pvvvtvvvp...",
        ".....vvvvvvv.rr.",
        ".....BBBBBBBrrrr",
        ".....BB...BBrrrr",
        "....ss....ss.rr.",
    ],
};

// The office entrance's frames (officeentrance.ts): the mask pulled up off the hair, then the puff of smoke the suit
// turns into Peter's shirt in, only the face showing through
export const SPIDEY_UNMASK: readonly string[] = [
    E,
    ".....SSSSSS.....",
    "....SSSDSSSSS...",
    ".....HHHHHH.S...",
    ".....HHHHHHHHS..",
    ".....HpppppHS...",
    ".....pkpppkpS...",
    ".....pppppppB...",
    "......ppkpp.B...",
    "....BSSSSSSSB...",
    "....BSSkSkSS....",
    "....BSSSkSSS....",
    "....SSSkSkSS....",
    ".....BB...BB....",
    ".....BB...BB....",
    "....SSS...SSS...",
];
export const SPIDEY_PUFF: readonly string[] = [
    "......mm..m.....",
    "...m.mwwm.mwm...",
    "..mwwmHHHHmwwm..",
    ".mwwwHHHHHHwwwm.",
    ".mwwwHpppppwwm..",
    "..mwwgekgekgwm..",
    ".mwwwpppppppwwm.",
    "mwwwwwpppppwwwwm",
    "mwwmwwwwwwwwmwwm",
    ".mwwwwmwwwmwwwm.",
    "mwwwwwwwwwwwwwm.",
    ".mwwmwwwwwmwwm..",
    "..mmwwwmwwwwmm..",
    "...m.mmmmmmm.m..",
    "....mm.....mm...",
    "......m..m......",
];

/** A pose's grid for the office's boss: Spider-Man is Peter the boss there, the others are themselves. */
export function bossRows(pose: PetPose, character: PetCharacter): readonly string[] {
    return character === "spidey" ? PETER_BOSS_POSES[pose] : outfitRows(pose, null, character);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run frontend/app/view/jarvis/petsprite.test.ts`
Expected: PASS. If an existing test lists `PET_TOKENS`' codes exactly, add `t` to its list.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(pet): Peter the boss's grids, the entrance frames and the tie's token" -- frontend/app/view/jarvis/petsprite.ts frontend/app/view/jarvis/petsprite.test.ts frontend/tailwindsetup.css
```

### Task 2: The boss pet's pose, `officepet.ts`

**Depends on:** none

**Files:** `frontend/app/view/agents/officepet.ts`, `frontend/app/view/agents/officepet.test.ts`

What each file is for:
- Create: `frontend/app/view/agents/officepet.ts` — the pose, facing and marks of the boss pet at a time
- Create: `frontend/app/view/agents/officepet.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { bossPet, pickRest, REST_AFTER_MS, type BossPetInput } from "./officepet";
import { PASTIMES, SLEEP_AFTER_MS } from "@/app/view/jarvis/petwalk";

const base: BossPetInput = {
    moving: false,
    dir: "down",
    frame: 0,
    flip: false,
    stillSince: 1_000,
    lastInputAt: 1_000,
    now: 1_000,
    rest: "read",
    character: "sprout",
    expression: "at-rest",
    posture: "none",
    speaking: false,
    unread: false,
};

describe("bossPet", () => {
    it("walks on the office's walk frame", () => {
        expect(bossPet({ ...base, moving: true, frame: 0 }).pose).toBe("walk1");
        expect(bossPet({ ...base, moving: true, frame: 1 }).pose).toBe("walk2");
    });

    it("faces the way it walks left or right, and keeps its facing walking up or down", () => {
        expect(bossPet({ ...base, moving: true, dir: "left" }).flip).toBe(true);
        expect(bossPet({ ...base, moving: true, dir: "right", flip: true }).flip).toBe(false);
        expect(bossPet({ ...base, moving: true, dir: "up", flip: true }).flip).toBe(true);
        expect(bossPet({ ...base, moving: true, dir: "down", flip: false }).flip).toBe(false);
    });

    it("never mirrors Peter, whose walk is front-on", () => {
        expect(bossPet({ ...base, moving: true, dir: "left", character: "spidey" }).flip).toBe(false);
    });

    it("stands when it has just stopped", () => {
        expect(bossPet({ ...base, now: base.stillSince + REST_AFTER_MS - 1 }).pose).toBe("stand");
    });

    it("plays its pastime once it has stood still a while, frame by frame", () => {
        const { frames, frameMs } = PASTIMES.read!;
        const t0 = base.stillSince + REST_AFTER_MS;
        expect(bossPet({ ...base, now: t0 }).pose).toBe(frames[0]);
        expect(bossPet({ ...base, now: t0 + frameMs }).pose).toBe(frames[1]);
    });

    it("sits or stands for the rests that have no frames", () => {
        const now = base.stillSince + REST_AFTER_MS;
        expect(bossPet({ ...base, now, rest: "sit" }).pose).toBe("sit");
        expect(bossPet({ ...base, now, rest: "stand" }).pose).toBe("stand");
    });

    it("sleeps with a z after the footer's sleep time with no input", () => {
        const r = bossPet({ ...base, now: base.lastInputAt + SLEEP_AFTER_MS });
        expect(r.pose).toBe("sleep");
        expect(r.marks).toContain("z");
    });

    it("is tired with the drop when the window is low, in place of a pastime", () => {
        const r = bossPet({ ...base, expression: "tired", now: base.stillSince + REST_AFTER_MS });
        expect(r.pose).toBe("tired");
        expect(r.marks).toContain("drop");
    });

    it("speaks while a bubble shows", () => {
        expect(bossPet({ ...base, speaking: true, now: base.stillSince + REST_AFTER_MS }).pose).toBe("speak");
    });

    it("walking wins over every rest", () => {
        expect(bossPet({ ...base, moving: true, speaking: true, expression: "tired" }).pose).toBe("walk1");
    });

    it("carries the posture's mark and the unread mark", () => {
        expect(bossPet({ ...base, posture: "review-gate", unread: true }).marks).toEqual(["gate", "unread"]);
    });
});

describe("pickRest", () => {
    it("picks one of the footer's rest poses", () => {
        expect(pickRest(() => 0)).toBe("stand");
        expect(pickRest(() => 0.999)).toBe("ball");
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officepet.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the model**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's boss drawn as the person's pet (office pet boss spec, "Poses"): which pose, which way it faces,
// which marks over its head, at a time. Pure: cockpitoffice.tsx's BossView draws it. The rests are the footer's
// (petwalk.ts REST_POSES, PASTIMES), played in place: the boss never wanders, since where it stands is the cursor.

import type { PetExpression, PetPosture } from "@/app/view/jarvis/petcondition";
import { wearsTired } from "@/app/view/jarvis/petcondition";
import type { PetCharacter, PetMark, PetPose } from "@/app/view/jarvis/petsprite";
import { PASTIMES, POSTURE_MARK, REST_POSES, SLEEP_AFTER_MS } from "@/app/view/jarvis/petwalk";
import type { Dir } from "./officeboss";

// standing still this long, it starts its pastime
export const REST_AFTER_MS = 4_000;

export type BossRest = (typeof REST_POSES)[number];

export interface BossPetInput {
    moving: boolean;
    dir: Dir;
    // the office's walk frame (walkFrameAtom)
    frame: 0 | 1;
    // the facing it had: walking up or down keeps it
    flip: boolean;
    // when it last stopped, and when the person last walked, clicked or pressed a key in the office
    stillSince: number;
    lastInputAt: number;
    now: number;
    // the pastime picked when it stopped (pickRest)
    rest: BossRest;
    character: PetCharacter;
    expression: PetExpression["kind"];
    posture: PetPosture;
    speaking: boolean;
    unread: boolean;
}

export interface BossPetLook {
    pose: PetPose;
    flip: boolean;
    marks: PetMark[];
}

/** A pastime for the next time the boss stops, as the footer's walker picks one. */
export function pickRest(rand: () => number): BossRest {
    return REST_POSES[Math.min(REST_POSES.length - 1, Math.floor(rand() * REST_POSES.length))];
}

function poseOf(i: BossPetInput): PetPose {
    if (i.moving) {
        return i.frame === 0 ? "walk1" : "walk2";
    }
    if (i.now - i.lastInputAt >= SLEEP_AFTER_MS) {
        return "sleep";
    }
    if (i.speaking) {
        return "speak";
    }
    if (wearsTired(i.expression)) {
        return "tired";
    }
    const idle = i.now - i.stillSince - REST_AFTER_MS;
    if (idle < 0) {
        return "stand";
    }
    const pastime = PASTIMES[i.rest];
    if (pastime == null) {
        return i.rest as "stand" | "sit";
    }
    return pastime.frames[Math.floor(idle / pastime.frameMs) % pastime.frames.length];
}

export function bossPet(i: BossPetInput): BossPetLook {
    const pose = poseOf(i);
    // Peter's walk is front-on: never mirrored
    const flip =
        i.character === "spidey" ? false : i.moving && (i.dir === "left" || i.dir === "right") ? i.dir === "left" : i.flip;
    const marks: PetMark[] = [];
    const postureMark = POSTURE_MARK[i.posture];
    if (postureMark != null) {
        marks.push(postureMark);
    }
    if (pose === "tired") {
        marks.push("drop");
    }
    if (pose === "sleep") {
        marks.push("z");
    }
    if (i.unread) {
        marks.push("unread");
    }
    return { pose, flip, marks };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officepet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- frontend/app/view/agents/officepet.ts frontend/app/view/agents/officepet.test.ts
git commit -m "feat(office): the boss pet's pose, facing and marks" -- frontend/app/view/agents/officepet.ts frontend/app/view/agents/officepet.test.ts
```

### Task 3: The entrance, `officeentrance.ts`

**Depends on:** none

**Files:** `frontend/app/view/agents/officeentrance.ts`, `frontend/app/view/agents/officeentrance.test.ts`

What each file is for:
- Create: `frontend/app/view/agents/officeentrance.ts` — when it plays, its timeline, the swing's path, the nearest
  window
- Create: `frontend/app/view/agents/officeentrance.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
    ENTRANCE_COOLDOWN_MS,
    entranceLength,
    entrancePhase,
    markOfficeLeft,
    nearestWindow,
    resetOfficeLeft,
    shouldPlayEntrance,
    swingPoint,
} from "./officeentrance";
import { TELEPORT_MS } from "@/app/view/jarvis/petteleport";

beforeEach(() => resetOfficeLeft());

describe("shouldPlayEntrance", () => {
    it("plays the first time the office opens", () => {
        expect(shouldPlayEntrance(10_000, false)).toBe(true);
    });

    it("skips it within two minutes of leaving, and plays it after", () => {
        markOfficeLeft(10_000);
        expect(shouldPlayEntrance(10_000 + ENTRANCE_COOLDOWN_MS - 1, false)).toBe(false);
        expect(shouldPlayEntrance(10_000 + ENTRANCE_COOLDOWN_MS, false)).toBe(true);
    });

    it("never plays under reduced motion", () => {
        expect(shouldPlayEntrance(10_000, true)).toBe(false);
    });
});

describe("entrancePhase", () => {
    it("walks Spider-Man through the canvas's six frames", () => {
        expect(entrancePhase("spidey", 0)).toBe("swing");
        expect(entrancePhase("spidey", 699)).toBe("swing");
        expect(entrancePhase("spidey", 700)).toBe("land");
        expect(entrancePhase("spidey", 1000)).toBe("stand");
        expect(entrancePhase("spidey", 1300)).toBe("unmask");
        expect(entrancePhase("spidey", 1800)).toBe("puff");
        expect(entrancePhase("spidey", 2200)).toBe("done");
    });

    it("gives Sprout and the Minion the teleport's arrival", () => {
        expect(entrancePhase("sprout", 0)).toBe("beam");
        expect(entrancePhase("minion", TELEPORT_MS.arrive - 1)).toBe("beam");
        expect(entrancePhase("minion", TELEPORT_MS.arrive)).toBe("done");
    });

    it("lasts as long as its phases", () => {
        expect(entranceLength("spidey")).toBe(2200);
        expect(entranceLength("sprout")).toBe(TELEPORT_MS.arrive);
    });
});

describe("swingPoint", () => {
    const from = { x: 99, y: 0 };
    const to = { x: 300, y: 240 };

    it("starts at the window and lands on the spot", () => {
        expect(swingPoint(from, to, 0)).toEqual(from);
        expect(swingPoint(from, to, 1)).toEqual(to);
    });

    it("dips below the straight line on the way, as a swing does", () => {
        const mid = swingPoint(from, to, 0.5);
        expect(mid.y).toBeGreaterThan((from.y + to.y) / 2);
    });

    it("moves in whole 3 px cells", () => {
        const p = swingPoint(from, to, 0.37);
        expect(p.x % 3).toBe(0);
        expect(p.y % 3).toBe(0);
    });
});

describe("nearestWindow", () => {
    it("picks the window nearest the spot along the wall", () => {
        const ws = [{ x: 60, y: 10 }, { x: 190, y: 10 }, { x: 320, y: 10 }];
        expect(nearestWindow(ws, { x: 250, y: 300 })).toEqual({ x: 190, y: 10 });
    });

    it("is null with no window", () => {
        expect(nearestWindow([], { x: 0, y: 0 })).toBeNull();
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeentrance.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the model**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The boss pet's entrance each time the Cockpit office opens (office pet boss spec, "Entrance"): Spider-Man swings in
// through the window nearest the boss's spot, lands, stands, unmasks and turns into Peter the boss in a puff; Sprout and
// the Minion arrive by the teleport's beam. Skipped within ENTRANCE_COOLDOWN_MS of leaving the office and under reduced
// motion. Pure but for when the office was last left, which is module state: a launch starts with none, so the first
// office of a launch always plays it.

import type { PetCharacter } from "@/app/view/jarvis/petsprite";
import { TELEPORT_MS } from "@/app/view/jarvis/petteleport";
import type { Point } from "./officeplanmodel";

export const ENTRANCE_COOLDOWN_MS = 120_000;

export type EntrancePhase = "swing" | "land" | "stand" | "unmask" | "puff" | "beam" | "done";

// the canvas's Entrance board: each phase until this many ms
const SPIDEY_TIMELINE: [EntrancePhase, number][] = [
    ["swing", 700],
    ["land", 1000],
    ["stand", 1300],
    ["unmask", 1800],
    ["puff", 2200],
];

const CELL = 3;
// how far below the straight line the swing dips at its middle, as a share of the drop
const SWING_DIP = 0.35;

let leftAt: number | null = null;

/** The office unmounted (Cards, or another surface). */
export function markOfficeLeft(now: number): void {
    leftAt = now;
}

/** For tests. */
export function resetOfficeLeft(): void {
    leftAt = null;
}

export function shouldPlayEntrance(now: number, reduce: boolean): boolean {
    return !reduce && (leftAt == null || now - leftAt >= ENTRANCE_COOLDOWN_MS);
}

export function entranceLength(character: PetCharacter): number {
    return character === "spidey" ? SPIDEY_TIMELINE[SPIDEY_TIMELINE.length - 1][1] : TELEPORT_MS.arrive;
}

export function entrancePhase(character: PetCharacter, t: number): EntrancePhase {
    if (character !== "spidey") {
        return t < TELEPORT_MS.arrive ? "beam" : "done";
    }
    for (const [phase, until] of SPIDEY_TIMELINE) {
        if (t < until) {
            return phase;
        }
    }
    return "done";
}

const snap = (v: number) => Math.round(v / CELL) * CELL;

/** Where the swing has him at k (0..1) from the window `from` to the spot `to`: a line that sags like a pendulum. */
export function swingPoint(from: Point, to: Point, k: number): Point {
    const e = Math.min(1, Math.max(0, k));
    const dip = Math.sin(Math.PI * e) * SWING_DIP * Math.abs(to.y - from.y);
    return { x: snap(from.x + (to.x - from.x) * e), y: snap(from.y + (to.y - from.y) * e + dip) };
}

/** The window nearest the spot along the wall, or null when the floor has none. */
export function nearestWindow(windows: readonly Point[], spot: Point): Point | null {
    let best: Point | null = null;
    for (const w of windows) {
        if (best == null || Math.abs(w.x - spot.x) < Math.abs(best.x - spot.x)) {
            best = w;
        }
    }
    return best;
}
```

If `officeplanmodel.ts` no longer exports `Point` after the floors run, import it from where `officeboss.ts` takes it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officeentrance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- frontend/app/view/agents/officeentrance.ts frontend/app/view/agents/officeentrance.test.ts
git commit -m "feat(office): the boss pet's entrance timeline and cooldown" -- frontend/app/view/agents/officeentrance.ts frontend/app/view/agents/officeentrance.test.ts
```

### Task 4: The outer-wall windows, from one helper

**Depends on:** none

**Files:** `frontend/app/view/office/scenery.ts`, `frontend/app/view/office/scenery.test.ts`

What each file is for:
- Modify: `frontend/app/view/office/scenery.ts` — export `outerWindows(plan)`; the loop that draws the outer wall's
  windows takes its positions from it
- Modify: `frontend/app/view/office/scenery.test.ts`

The loop is in `scenery()`, under the comment "the outer wall's windows, light glass by day and dark after hours": it
steps `x` from 60 by 130 while `x < plan.width - 80`, skips a window over the TV, and draws a 12-art-px-wide pane from
the wall face's top (`fy`) down `fh` rows. The floors run may have moved it into a per-floor function: work from what is
there.

- [ ] **Step 1: Write the failing test**

`scenery.test.ts` already builds plans with `const plan = (width?, over?) => buildPlan(input(width, over))`; use it.
A pane is 12 art cells wide (36 px at `PLAN_CELL` 3), so its centre is 18 px past the step's `x`.

```ts
describe("outerWindows", () => {
    it("lists the outer wall's windows left to right, inside the wall", () => {
        const p = plan();
        const ws = outerWindows(p);
        expect(ws.length).toBeGreaterThan(0);
        const xs = ws.map((w) => w.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        for (const w of ws) {
            expect(w.x).toBeGreaterThan(0);
            expect(w.x).toBeLessThan(p.width);
        }
    });

    it("sits on the wall's 130 px steps, the TV's step left out", () => {
        const p = plan(1400);
        const xs = outerWindows(p).map((w) => w.x);
        for (const x of xs) {
            expect((x - 18 - 60) % 130).toBe(0);
        }
        const steps = Math.ceil((p.width - 80 - 60) / 130);
        expect(xs.length).toBeLessThanOrEqual(steps);
    });
});
```

If the floors run changed the step or the pane width, take the numbers from the loop as it stands and fix these two.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/office/scenery.test.ts`
Expected: FAIL (`outerWindows` is not exported).

- [ ] **Step 3: Extract the helper**

Move the loop's position logic into an exported function and have the loop draw from it:

```ts
/** The outer wall's windows in plan px: each one's centre at the wall face's top (Spider-Man's entrance swings in
 *  through the nearest). The scenery draws a pane at each. */
export function outerWindows(plan: Plan): Point[] {
    // the same x steps, TV skip and y the drawing loop used, converted from art cells to plan px
}
```

The y is the wall face's top (`fy`) in plan px, the x the pane's centre (`wx + 6` art cells). The drawing loop then
iterates `outerWindows(plan)` and converts back to art cells, drawing exactly what it drew before.

- [ ] **Step 4: Run the scenery tests**

Run: `npx vitest run frontend/app/view/office/scenery.test.ts`
Expected: PASS, the existing tests too (the art is unchanged).

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(office): the outer-wall windows from one helper" -- frontend/app/view/office/scenery.ts frontend/app/view/office/scenery.test.ts
```

### Task 5: The footer creature gives way to the office's boss

**Depends on:** none

**Files:** `frontend/app/view/jarvis/petstore.ts`, `frontend/app/view/jarvis/petview.tsx`

What each file is for:
- Modify: `frontend/app/view/jarvis/petstore.ts` — the atoms the office sets
- Modify: `frontend/app/view/jarvis/petview.tsx` — while the office's boss is set and the window is not folded, no
  footer sprite; the bubble and the peek anchor to the boss; the bubble waits out the entrance

- [ ] **Step 1: Add the atoms**

In `petstore.ts`, beside the other module atoms:

```ts
// The Cockpit office's boss, drawn as the pet (office pet boss spec, "One Jarvis"): while it is set the footer creature
// is not drawn, and the bubble and the peek hang off it. cockpitoffice.tsx sets it on mount and clears it on unmount.
export const petOfficeBossAtom = atom<HTMLElement | null>(null) as PrimitiveAtom<HTMLElement | null>;
// which half of the window the boss is in, so the bubble and the peek open the right way
export const petOfficeCornerAtom = atom<PetCorner>("bottom-right") as PrimitiveAtom<PetCorner>;
// true while the boss's entrance plays: the bubble waits for it
export const petOfficeEnteringAtom = atom(false) as PrimitiveAtom<boolean>;
```

Import `type PetCorner` from `./petledge`.

- [ ] **Step 2: Give way in `PetView`**

In `PetView` (`petview.tsx`):

```tsx
    const officeBoss = useAtomValue(petOfficeBossAtom);
    const officeCorner = useAtomValue(petOfficeCornerAtom);
    const entering = useAtomValue(petOfficeEnteringAtom);
    // one Jarvis: in the office the boss is the creature; folded, the folded Sprout is its own (sprout-mini.tsx)
    const inOffice = officeBoss != null && !folded;
    const shownAnchor = inOffice ? officeBoss : anchor;
    const shownCorner = inOffice ? officeCorner : corner;
```

Render `<PetSprite …/>` only when `!inOffice` (its voice, quotes and DEV contract live in `PetView`, which stays
mounted). Pass `shownAnchor` and `shownCorner` to `PetBubble` and `PetPeek` in place of `anchor` and `corner`, and
render `PetBubble` only when `!(inOffice && entering)`.

When `PetSprite` unmounts, its `setAnchor(null)` must not leave the footer's anchor stale on return: `PetSprite`
remounts and calls `setAnchor` again with its new element, so nothing else is needed. Leaving the office clears
`petOfficeBossAtom`, `PetSprite` mounts, and its `initial={{ opacity: 0 }}` fades it in as at boot.

- [ ] **Step 3: Typecheck**

Run: `task check:ts` (5-minute timeout)
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(pet): the footer creature gives way to the office's boss" -- frontend/app/view/jarvis/petstore.ts frontend/app/view/jarvis/petview.tsx
```

### Task 6: The boss is the pet, and it makes an entrance

**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 5

**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitofficedevhooks.ts`, `frontend/app/view/office/plansprite.ts`, `scripts/cdp/cockpitofficescenarios.mjs`

What each file is for:
- Modify: `frontend/app/view/agents/cockpitoffice.tsx` — `BossView` draws the pet's svg, plays the entrance, sets the
  pet atoms, toggles the peek on a click; the office marks when it was left; the probe reports the boss pet
- Modify: `frontend/app/view/agents/cockpitofficedevhooks.ts` — DEV seams: hold the entrance at a time or skip it, set
  the pet character
- Modify: `frontend/app/view/office/plansprite.ts` — drop the chibi boss poses once nothing draws them
- Modify: `scripts/cdp/cockpitofficescenarios.mjs` — `arrangeOffice` skips the entrance, so the existing scenarios'
  shots are the same as before

- [ ] **Step 1: The DEV seams**

In `cockpitoffice.tsx`'s `OfficeDev`:

```ts
    entrance?: "skip" | number; // "skip" ends it at once; a number holds it still at that many ms (the pet scenario)
```

In `cockpitofficedevhooks.ts`, add `__cockpitOfficePet?: (character: string) => string;` and
`__cockpitOfficeBubble?: (on: boolean) => void;` to the `Window` declaration and:

```ts
    // sets the pet the boss is drawn as and returns the one it replaced (the cockpit-office-pet scenario)
    window.__cockpitOfficePet = (character) => {
        const prev = globalStore.get(petCharacterAtom);
        globalStore.set(petCharacterAtom, petCharacter(character));
        return prev;
    };
    // shows a quote in the pet's bubble, or puts it away (the scenario's bubble step)
    window.__cockpitOfficeBubble = (on) =>
        globalStore.set(
            petBubbleAtom,
            on ? quoteEvent(0, Date.now(), quotePool(petCharacter(globalStore.get(petCharacterAtom)))) : null
        );
```

(`petCharacterAtom`, `petBubbleAtom` from `@/app/view/jarvis/petstore`; `petCharacter` from `…/petcharacter`;
`quoteEvent`, `quotePool` from `…/petquotes`.)

- [ ] **Step 2: Draw the pet in `BossView`**

Replace the chibi `<Mover … boss />` in `BossView` with a `BossPet` component; keep the ring `<img>` as it is. `BossPet`:

- Reads `bossLookAtom` (moving, dir), `walkFrameAtom`, `petCharacterAtom` (through `petCharacter`), `petBubbleAtom`,
  `petUnreadAtom`, `petPeekOpenAtom`, `useReducedMotion()`, and the condition from `usePetSignals(model)` (exported by
  `petview.tsx`) through `expressionFor` / `postureFor` (`petcondition.ts`). `CockpitOffice` passes `model` down to it.
- Keeps in refs: `stillSince` (set to `Date.now()` when `look.moving` turns false), `lastInputAt` (bumped by the office's
  walk, talk, click and key handlers: add one `bumpBossInput()` the `OfficeHandle` methods and the floor click call),
  `flip` (the last facing `bossPet` returned) and `rest` (`pickRest(Math.random)` each time the boss stops).
- Re-renders on a timer only while resting: `setTimeout` to the next pastime frame (`PASTIMES[rest].frameMs`), to
  `stillSince + REST_AFTER_MS`, and to `lastInputAt + SLEEP_AFTER_MS`, whichever is next; none while walking (the walk
  frame atom drives it) or under reduced motion past the rest's start.
- Calls `bossPet({...})` and `spriteOfRows(bossRows(look.pose, character), look.marks)` and draws one `<svg>` the size
  of `PET_PX`, `shapeRendering="crispEdges"`, `overflow="visible"`, `aria-hidden`, with `sprite.body` in a `<g>` mirrored
  by `matrix(-1 0 0 1 ${PET_PX} 0)` when `flip`, then `sprite.overlay`, each cell a `<rect>` filled `var(${cell.token})`
  (as `petview.tsx`'s `cellRect`).
- Wraps the svg in a `<button type="button" data-office-boss="" data-office-boss-pet={character} aria-label="Jarvis
  condition">` positioned like `Mover` (`absolute left-0 top-0 z-[7]`, the transform written by `useDomTransform` on
  `bossAtom`, feet at `at`: `translate(${round((at.x - PET_PX / 2) / PLAN_CELL) * PLAN_CELL}px, ${round((at.y - PET_PX) /
  PLAN_CELL) * PLAN_CELL}px)`), `pointer-events-auto`, with `className="[filter:brightness(0.7)]"` added when `phase ===
  "after"`. A click (`stopPropagation`, so the floor does not walk the boss there) toggles the peek: `closePeek()` when
  `petPeekOpenAtom` is set, else `openPetBubble(model)` (`petview.tsx`).
- Sets `petOfficeBossAtom` to the button through its ref callback and clears it on unmount; after each placement
  writes `petOfficeCornerAtom` with `cornerFor(rect.left, window.innerWidth)` when it changed.

Where the office placed things over the boss's head by `spriteH("boss")` (the dialog box's edge and the `↵` prompt's
`over`), use `PET_PX`.

- [ ] **Step 3: The entrance**

In `BossPet`, on mount: `const play = shouldPlayEntrance(Date.now(), reduce)`; when it plays, keep `startedAt =
performance.now()`, set `petOfficeEnteringAtom` true, and run a `requestAnimationFrame` loop at 12 fps (redraw when
`Math.floor(t / 83)` changes) until `entranceLength(character)`, then set the atom false and draw the pet as above. Any
call to `bumpBossInput()` while it plays ends it at once (the walk keys, a click on the floor, ↵). `officeDev.entrance ===
"skip"` ends it; a number holds `t` there and stops the loop. On unmount of `CockpitOffice` call
`markOfficeLeft(Date.now())` and set `petOfficeEnteringAtom` false.

While it plays, by `entrancePhase(character, t)`:

- `"beam"` (Sprout, the Minion): inside the svg, `<PetTeleportLayers run={{ kind: "arrive", at: startedAt }}
  sprite={spriteOfRows(bossRows("stand", character), [])} cellPx={PET_CELL_PX} character={character} />`
  (`petteleportsvg.tsx`), which plays its own clock.
- `"swing"`: the svg placed at `swingPoint(win, spot, t / 700)` (`win` is `nearestWindow(outerWindows(plan), spot)`,
  falling back to `{ x: spot.x - 36, y: spot.y - 90 }` when there is none; `spot` is the boss's `at`), drawing
  `SPIDEY_SWING`, with a strand from the window to his hand: a `<line>` in `var(--color-spidey-web)`, 3 px wide, from the
  window point to the svg's `HANDS` cell (`petwebswing.ts`), drawn in the office's coordinates beside the svg.
- `"land"`: `SPIDEY_POSES.sit`; `"stand"`: `SPIDEY_POSES.stand`; `"unmask"`: `SPIDEY_UNMASK`; `"puff"`: `SPIDEY_PUFF`,
  each at the spot.
- `"done"`: the pet as in Step 2.

- [ ] **Step 4: The probe and the scenarios' arrange**

In `readOfficeProbe()`, add:

```ts
        bossPet: lastBossPet, // { character, pose, flip, marks, entrance: EntrancePhase | null } as last drawn
```

where `BossPet` writes `lastBossPet` each render (module `let`, like `lastPlan`).

In `scripts/cdp/cockpitofficescenarios.mjs`'s `arrangeOffice`, add `entrance: "skip"` to the `dev(h, { runs:
OFFICE_RUNS, afterHours: false, energy: 63 })` call unless `opts.entrance` is set, so the existing scenarios see the boss
pet at once.

- [ ] **Step 5: Drop the chibi boss**

`grep -n "BOSS_POSES\|BOSS_OUTFIT\|\"boss\"\|look === \"boss\"\|boss: true" frontend/app/view` and remove what only the
chibi boss used: `BOSS_OUTFIT`, `BOSS_SHIRT` (and its token only if nothing else reads it), `BOSS_POSES` and the
`"boss"` sprite and look in `plansprite.ts`, and the boss row of the States sheet (`officeDev.sheet`) in
`cockpitoffice.tsx`. Fix `plansprite.test.ts` for what it listed. Keep anything a walker or a seat still draws.

- [ ] **Step 6: Typecheck and the office's unit tests**

Run: `task check:ts` (5-minute timeout), then `npx vitest run frontend/app/view/agents frontend/app/view/office`
Expected: exit 0; PASS.

- [ ] **Step 7: Try it in the browser cockpit**

Run `node scripts/cdp/browser-app.mjs` in the background (CDP :9222, vite :5180; `ARC_DEV_DATA_DIR` a temp dir), load
the `office` fixture (`npm run cockpit:fixtures -- office`), reload, open Cockpit → Office, and with `scripts/cdp/attach.mjs`
read `window.__cockpitOfficeProbe().bossPet` and screenshot: the boss is the pet, the footer has no `[data-pet-sprite]`.
`npm run cockpit:fixtures -- --clear` and stop the app by its PID afterwards.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(office): the boss is the pet, and it makes an entrance" -- frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitofficedevhooks.ts frontend/app/view/office/plansprite.ts frontend/app/view/office/plansprite.test.ts scripts/cdp/cockpitofficescenarios.mjs
```

### Task 7: The `cockpit-office-pet` scenario, the changelog, the RAM line

**Depends on:** Task 6

**Files:** `scripts/cdp/cockpitofficescenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

What each file is for:
- Modify: `scripts/cdp/cockpitofficescenarios.mjs` — a `cockpit-office-pet` scenario, returned with the others
- Modify: `CHANGELOG.md` — one `Added` line
- Modify: `docs/open-issues.md` — the hand check, and the RAM watch line after `cockpit-office-bench`

- [ ] **Step 1: The scenario**

Add `cockpit-office-pet` beside `cockpit-office` (same `arrange` through `arrangeOffice(h, { entrance: true })` and the
same teardown), with these steps, each `rec`'d and each shot under `cdp-shots/cockpit-office-pet-*.png`:

0. The office loads with the entrance playing: `probe().bossPet.entrance` is not null right after the arrange, and the
   footer has no `[data-pet-sprite]`.
1. Spider-Man's entrance, one shot per phase: `__cockpitOfficePet("spidey")`, then `dev(h, { entrance: t })` for `t` in
   350, 850, 1150, 1550, 2000 and a shot each; `bossPet.entrance` reads `swing`, `land`, `stand`, `unmask`, `puff`. At
   350 a `line` in `var(--color-spidey-web)` is drawn.
2. `dev(h, { entrance: "skip" })`: `bossPet.entrance` is null, `bossPet.character === "spidey"`, `bossPet.pose ===
   "stand"`, and the boss button holds no `--color-spidey-red` cell (Peter shows no suit). Shot.
3. Walking: hold → (key down, as the existing walk steps do) for 600 ms and read `bossPet.pose` in `walk1`/`walk2` and
   `bossPet.flip === false`. Release; shot.
4. A pastime: `dev(h, { entrance: "skip" })` and wait `REST_AFTER_MS` + 500 ms (4.5 s); `bossPet.pose` is one of the
   rest poses (`stand`, `sit`, `read1`, `read2`, `music1`, `music2`, `work1`, `work2`, `ball1`, `ball2`). Shot.
5. The bubble over the boss: `__cockpitOfficeBubble(true)`, then the bubble's box sits above the boss button's box
   (`[data-office-boss]`). Shot, then `__cockpitOfficeBubble(false)`.
6. A click on the boss (`[data-office-boss]`) opens the peek: `[data-pet-peek]` shows. A click on
   `[data-pet-peek-backdrop]` shuts it.
7. Sprout and the Minion: `__cockpitOfficePet("sprout")` then `"minion"`; `bossPet.character` follows and a shot each.
8. Leaving and coming back: toggle to Cards: a `[data-pet-sprite]` shows on the footer again. Toggle back to Office
   within 2 minutes: `bossPet.entrance` is null at once (no entrance).

Restore the pet character the scenario found (`__cockpitOfficePet(prev)`) in teardown.

- [ ] **Step 2: Run it**

Run: `node scripts/cdp/final-verify.mjs cockpit-office-pet` (it starts and stops its own app)
Expected: every step PASS; look at each shot in `cdp-shots/` against the canvas's `Entrance` and `Floor` boards.

- [ ] **Step 3: The changelog**

Under `## Unreleased` → `### Added` in `CHANGELOG.md` (open the section if the top one has a date):

```markdown
- In the Cockpit's Office your pet is the boss you walk around: Sprout, the Minion, or Spider-Man, who swings in through a window and turns into Peter Parker in a shirt and tie. Its speech bubble and the condition panel open over it, and the footer pet comes back when you leave. <!-- big -->
```

- [ ] **Step 4: The hand check and the RAM line**

Run `node scripts/cdp/final-verify.mjs cockpit-office-bench` and read its PASS/FAIL row numbers. In
`docs/open-issues.md`:

- Under "0 · Waiting on a hand check", a dated block `**2026-10-16 (the Office's pet boss)**` with:
  `- [ ] (arcterm) In the installed app: Cockpit → Office with Spider-Man picked. He swings in through a window, unmasks
  and stands as Peter in a shirt and tie; walk with the arrows (front-on, no mirroring); stand still 4 s for a pastime;
  click him for the condition panel. Switch to Cards and back within 2 minutes: no entrance. Pick Sprout, reopen after
  2 minutes: the beam. The footer pet is gone in the Office and back outside it.`
- Under "(arcterm) RAM watch", a **Cockpit office pet boss** line dated 2026-10-16 with the bench's heap, DOM nodes and
  busy figures and whether every budget held. A miss is reported, not tuned away by raising a budget.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(office): the pet boss scenario; changelog and RAM watch" -- scripts/cdp/cockpitofficescenarios.mjs CHANGELOG.md docs/open-issues.md
```
