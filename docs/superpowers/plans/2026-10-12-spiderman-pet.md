# Spider-Man pet and Spider theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A third Jarvis creature, Spider-Man in the Homecoming suit (Peter Parker at rest), who walks the footer
side-on, thwips when he speaks, hangs and rappels on strands, crawls and hangs under the app bar, web-swings to fold and
sits on a rooftop when folded; and a Spider theme preset (Claude's palette, a Spider-Man red accent). Specified in
`docs/superpowers/specs/2026-10-12-spiderman-pet-design.md` (the spec; read it before any task).

**Architecture:** The character is data: grids in `petsprite.ts` (`SPIDEY_POSES` per `PetPose`, plus `SPIDEY_HANG`,
`SPIDEY_CRAWL`, `SPIDEY_SWING` and the fold scene `spideyFold`), drawn in new identity tokens. Every motion is a pure
module beside a test (`petfall.ts webLanding`, `petwebswing.ts`, `petwalk.ts`'s `hang` rest, `petledge.ts
measureCeiling`, `petmini.ts spideyFoldLook`). The spec's `SPIDEY_FOLD` (the rooftop scene "built by a function") is
the function `spideyFold(lit, swing)`. The views (`petview.tsx`, `petteleportsvg.tsx`, `workingdots.tsx`,
`sprout-mini.tsx`, `app-bar.tsx`) only draw what they return. The theme is one more `THEMES` entry. Sprout and the
Minion are untouched.

**Tech Stack:** React 19, motion/react, jotai, Tailwind 4 (`@theme` tokens only, never raw hex in components), vitest,
CDP (`scripts/cdp/scenarios.mjs`).

**Verify:** `node scripts/verify.mjs ./pkg/wconfig`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: jarvis-pet needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs jarvis-pet`

**Prototype:** .superpowers/design/spiderman-pet/project/

Notes for every task:

- No Go changes: Verify names `./pkg/wconfig` only because `scripts/verify.mjs` needs a pattern; it runs the vitest
  suite for the changed frontend files.
- Final builds a dev app once, on the merged result (the machine lags ~10 minutes then). No task builds: a task checks
  its view against the running dev app (`task dev`, HMR) when one is up, and otherwise leaves it to Final.
- Run single test files with `npx vitest run <file>`. Typecheck with `task check:ts` (~2 min, give it a 5-minute
  timeout; never `npx tsc`). In a worktree call tsc directly: `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`.
- Commit with a pathspec (`git commit -m "…" -- <paths>`, after `git add` for new files). No `Co-Authored-By` trailer.
- The grids below are the canvas's (the Prototype path), checked: every one is the right size, every `PetPose` grid
  stands on its bottom row and keeps the marks' cells clear, and every code is in `PET_TOKENS`. Paste them as they are.

---

### Task 1: Spider-Man, the character (data, tokens, the setting)

**Depends on:** none

**Files:** `frontend/tailwindsetup.css`, `frontend/app/view/jarvis/petsprite.ts`, `frontend/app/view/jarvis/petsprite.test.ts`, `frontend/app/view/jarvis/petcharacter.ts`, `frontend/app/view/jarvis/petcharacter.test.ts`, `frontend/app/view/agents/settingspages/appearance.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/cockpit/app-bar.tsx`

**Step 1: Write the failing tests**

`petcharacter.test.ts`: the stored-value list becomes `["sprout", "minion", "spidey"] as const`; the name map
`{ sprout: "Sprout", minion: "Minion", spidey: "Spider-Man" }`; add `"Spider-Man"` to the fall-back list.

`petsprite.test.ts`:

1. Import `SPIDEY_CRAWL`, `SPIDEY_HANG`, `SPIDEY_LOOK`, `SPIDEY_POSES`, `SPIDEY_SWING`, `spideyFold`, `spriteOfRows`
   and `SPIDEY_SENSE` from `./petsprite`.
2. The "maps exactly …" test gains (rename it to "… the Minion's five, and Spider-Man's fifteen"):

```ts
            S: "--color-spidey-red",
            B: "--color-spidey-blue",
            D: "--color-spidey-seam",
            e: "--color-spidey-eye",
            x: "--color-spidey-web",
            p: "--color-peter-skin",
            H: "--color-peter-hair",
            g: "--color-peter-glasses",
            v: "--color-peter-shirt",
            c: "--color-city-cornice",
            C: "--color-city-cornice-shade",
            M: "--color-city-brick",
            N: "--color-city-brick-light",
            Q: "--color-city-window",
            L: "--color-city-window-lit",
```

3. Append:

```ts
const codesKnown = (rows: readonly string[]) =>
    rows.every((row) => [...row].every((code) => code === "." || code in PET_TOKENS));

describe("Spider-Man", () => {
    it("has every pose Sprout has, and a look for each", () => {
        expect(Object.keys(SPIDEY_POSES).sort()).toEqual([...POSE_NAMES].sort());
        expect(Object.keys(SPIDEY_LOOK).sort()).toEqual([...POSE_NAMES].sort());
    });

    it.each(POSE_NAMES)("%s is 16 rows of 16 known cells and stands on the bottom row", (pose) => {
        expect(SPIDEY_POSES[pose]).toHaveLength(PET_GRID);
        for (const row of SPIDEY_POSES[pose]) {
            expect(row).toHaveLength(PET_GRID);
        }
        expect(codesKnown(SPIDEY_POSES[pose])).toBe(true);
        expect(SPIDEY_POSES[pose][PET_GRID - 1]).not.toBe(".".repeat(PET_GRID));
    });

    // the suit is red with no hair showing; Peter has his hair
    it.each(POSE_NAMES)("%s is drawn in the look SPIDEY_LOOK names", (pose) => {
        const rows = SPIDEY_POSES[pose].join("");
        if (SPIDEY_LOOK[pose] === "suit") {
            expect(rows).toContain("S");
            expect(rows).not.toContain("H");
        } else {
            expect(rows).toContain("H");
        }
    });

    it("is the suit on the job and Peter Parker at rest", () => {
        for (const pose of ["walk1", "walk2", "stand", "speak", "tired", "dangle", "work1", "work2", "sit"] as const) {
            expect(SPIDEY_LOOK[pose]).toBe("suit");
        }
        for (const pose of ["sleep", "read1", "read2", "music1", "music2", "ball1", "ball2"] as const) {
            expect(SPIDEY_LOOK[pose]).toBe("peter");
        }
    });

    const stamped: [PetMark, PetPose][] = [
        ["gate", "stand"],
        ["escalation", "stand"],
        ["blocked", "stand"],
        ["z", "sleep"],
        ["drop", "tired"],
        ...POSE_NAMES.map((pose): [PetMark, PetPose] => ["unread", pose]),
    ];

    it.each(stamped)("%s on %s never lands on a drawn body cell", (mark, pose) => {
        const body = drawnCells(SPIDEY_POSES[pose]);
        const { overlay } = spriteFor(pose, [mark], null, "spidey");
        expect(overlay.length).toBeGreaterThan(0);
        for (const cell of overlay) {
            expect(body.has(`${cell.x},${cell.y}`), `${mark} at ${cell.x},${cell.y}`).toBe(false);
        }
    });

    it.each(POSE_NAMES)("is what spriteFor draws for %s when chosen", (pose) => {
        const { body } = spriteFor(pose, [], null, "spidey");
        expect(body).toHaveLength(drawnCells(SPIDEY_POSES[pose]).size);
        for (const cell of body) {
            expect(cell.token).toBe(PET_TOKENS[SPIDEY_POSES[pose][cell.y][cell.x] as keyof typeof PET_TOKENS]);
        }
    });

    it("wears its own red and blue, not the accent", () => {
        const tokens = new Set(spriteFor("stand", [], null, "spidey").body.map((c) => c.token));
        expect(tokens.has("--color-spidey-red")).toBe(true);
        expect(tokens.has("--color-spidey-blue")).toBe(true);
        expect(tokens.has("--color-accent")).toBe(false);
    });

    it("thwips when it speaks: the strand leaves the wrist", () => {
        expect(SPIDEY_POSES.speak.join("")).toContain("x");
    });

    it.each(POSE_NAMES)("holds Sprout's flag behind %s, and leaves its body and marks alone", (pose) => {
        const bare = spriteFor(pose, ["unread"], null, "spidey");
        const flagged = spriteFor(pose, ["unread"], "vn-flag", "spidey");
        expect(flagged.back).toEqual(spriteFor("stand", [], "vn-flag").back);
        expect(flagged.body).toEqual(bare.body);
    });

    it.each(POSE_NAMES)("wears the flag shirt on Peter's shirt only, with no star (%s)", (pose) => {
        const dressed = outfitRows(pose, "vn-shirt", "spidey");
        if (SPIDEY_LOOK[pose] === "suit") {
            expect(dressed).toBe(SPIDEY_POSES[pose]);
            return;
        }
        dressed.forEach((row, y) =>
            [...row].forEach((code, x) => expect(code).toBe(SPIDEY_POSES[pose][y][x] === "v" ? "R" : SPIDEY_POSES[pose][y][x]))
        );
    });
});

describe("Spider-Man's other grids", () => {
    it.each([
        ["the hang", SPIDEY_HANG],
        ["the swing", SPIDEY_SWING],
        ["crawl frame 1", SPIDEY_CRAWL[0]],
        ["crawl frame 2", SPIDEY_CRAWL[1]],
    ])("%s is 16x16 of known codes", (_name, rows) => {
        expect(rows).toHaveLength(PET_GRID);
        expect(rows.every((r) => r.length === PET_GRID)).toBe(true);
        expect(codesKnown(rows)).toBe(true);
    });

    it("hangs by its boots on the strand at column 8, head at the bottom", () => {
        expect(SPIDEY_HANG[0][8]).toBe("x");
        expect(SPIDEY_HANG[PET_GRID - 1].includes("S")).toBe(true);
    });

    it("draws a grid of rows through the same tokens, with marks", () => {
        const s = spriteOfRows(SPIDEY_HANG, ["unread"]);
        expect(s.body).toHaveLength(drawnCells(SPIDEY_HANG).size);
        expect(s.overlay.length).toBeGreaterThan(0);
        expect(s.back).toEqual([]);
    });
});

describe("the fold's rooftop", () => {
    const lit = (rows: readonly string[]) => rows.join("").split("L").length - 1;

    it("is 20x20 of known codes in every state", () => {
        for (const n of [0, 1, 4]) {
            for (const swing of [false, true]) {
                const rows = spideyFold(n, swing);
                expect(rows).toHaveLength(20);
                expect(rows.every((r) => r.length === 20)).toBe(true);
                expect(codesKnown(rows)).toBe(true);
            }
        }
    });

    // each window is 2x2 cells
    it.each([
        [0, 0],
        [1, 4],
        [3, 12],
        [4, 16],
        [9, 16],
    ])("lights one window per working agent, four at most: %i working, %i lit cells", (working, cells) => {
        expect(lit(spideyFold(working, false))).toBe(cells);
    });

    it("swings only the legs: the head, the ledge and the windows stay put", () => {
        const a = spideyFold(2, false);
        const b = spideyFold(2, true);
        expect(b.slice(0, 12)).toEqual(a.slice(0, 12));
        expect(b.slice(16)).toEqual(a.slice(16));
        expect(b).not.toEqual(a);
    });

    it("sparks the spider-sense clear of him", () => {
        const rows = spideyFold(0, false);
        for (const { x, y } of SPIDEY_SENSE) {
            expect(rows[y][x], `${x},${y}`).toBe(".");
        }
    });
});
```

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/jarvis/petsprite.test.ts frontend/app/view/jarvis/petcharacter.test.ts`
Expected: FAIL — the exports are missing.

**Step 3: The tokens** — `frontend/tailwindsetup.css`, after `--color-minion-hair`:

```css

    /* The Jarvis pet's Spider-Man (petsprite.ts SPIDEY_*): the Homecoming suit's red and blue, the mask's seam and eyes,
       the web he spins, Peter Parker's skin, hair, glasses and shirt, and the brick rooftop he sits on when folded.
       The character itself, identity, never theme-derived */
    --color-spidey-red: #d0102a;
    --color-spidey-blue: #1f4aa8;
    --color-spidey-seam: #2a0a0d;
    --color-spidey-eye: #f4f6fb;
    --color-spidey-web: #c9ced8;
    --color-peter-skin: #f0c19b;
    --color-peter-hair: #4a2f1c;
    --color-peter-glasses: #3a3a40;
    --color-peter-shirt: #e4e7ee;
    --color-city-cornice: #6b6f78;
    --color-city-cornice-shade: #44474f;
    --color-city-brick: #4a2a26;
    --color-city-brick-light: #5e3631;
    --color-city-window: #2a2d33;
    --color-city-window-lit: #f2c14e;
```

**Step 4: The grids** — `petsprite.ts`:

- Header comment: "every pose of both creatures (Sprout and the Minion)" → "every pose of each creature (Sprout, the
  Minion and Spider-Man)".
- `export type PetCharacter = "sprout" | "minion" | "spidey";` ("Each has every pose").
- `PET_TOKENS`, after `s`:

```ts
    S: "--color-spidey-red", // Spider-Man's suit
    B: "--color-spidey-blue",
    D: "--color-spidey-seam", // the mask's seam
    e: "--color-spidey-eye", // the mask's eyes, Peter's lenses
    x: "--color-spidey-web", // a strand
    p: "--color-peter-skin", // Peter Parker
    H: "--color-peter-hair",
    g: "--color-peter-glasses",
    v: "--color-peter-shirt",
    c: "--color-city-cornice", // the fold's rooftop
    C: "--color-city-cornice-shade",
    M: "--color-city-brick",
    N: "--color-city-brick-light",
    Q: "--color-city-window",
    L: "--color-city-window-lit",
```

- After `MINION_POSES`:

```ts
// Spider-Man in the Homecoming suit: slim, the head solid red with one seam and the eyes framed at their outer corners,
// a small black spider on the chest. The suit on the job, Peter Parker at rest (SPIDEY_LOOK). The marks' cells are kept
// clear as Sprout's are.
export const SPIDEY_POSES: Record<PetPose, readonly string[]> = {
    // the suit, side-on facing right; the renderer mirrors it to walk left
    walk1: [
        E,
        E,
        E,
        ".......SSSS.....",
        "......SSSSSS....",
        "......SSSkeeS...",
        "......SSSSeeS...",
        "......SSSSSSS...",
        ".......SSSSS....",
        "......BBSDSS....",
        ".....BBBSkSSS...",
        ".....SBBSDSB.S..",
        "......BBBBB.....",
        ".....BB...BB....",
        "....BB.....BB...",
        "...SS.......SSS.",
    ],
    walk2: [
        E,
        E,
        E,
        ".......SSSS.....",
        "......SSSSSS....",
        "......SSSkeeS...",
        "......SSSSeeS...",
        "......SSSSSSS...",
        ".......SSSSS....",
        "......BBSDSS....",
        "......BBSkSS....",
        "......BSSDSS....",
        "......BBBBB.....",
        "......BB.BB.....",
        "......BB.BB.....",
        ".....SSS.SSS....",
    ],
    // the suit, front-on: the small black spider on the chest, the eyes framed at their outer corners
    stand: [
        E,
        E,
        "......SSSSS.....",
        ".....SSSDSSS....",
        ".....keeDeek....",
        ".....SeeDeeS....",
        "......SSDSS.....",
        "....BSSSSSSSB...",
        "....BSSkSkSSB...",
        "....BSSSkSSSB...",
        "....BSSkSkSSB...",
        "....S.BBBBB.S...",
        ".....BB...BB....",
        ".....BB...BB....",
        ".....BB...BB....",
        "....SSS...SSS...",
    ],
    // the hero landing: one fist down, the other arm back
    sit: [
        E,
        E,
        E,
        E,
        E,
        E,
        "......SSSSS.....",
        ".....SSSDSSS....",
        ".....keeDeek....",
        ".....SeeDeeS..BS",
        "......SSDSS.BB..",
        "....BSSSSSSB....",
        "...BSSkSkSSB....",
        "..SBBSSkSSBBB...",
        "..S..BBBBB..BB..",
        "..S.SSS.....SSS.",
    ],
    // Peter Parker at rest: messy hair, glasses, the shirt open on the suit, jeans
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
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        "....BBBBBBBBB...",
        "....BBBBBBBBB...",
        "....BBBBBBBBBss.",
    ],
    // lids down, hands on the knees
    tired: [
        E,
        E,
        E,
        "......SSSSS.....",
        ".....SSSDSSS....",
        ".....kkkDkkk....",
        ".....SeeDeeS....",
        "......SSDSS.....",
        "....BSSSSSSSB...",
        "....BSSkSkSSB...",
        "....BSSSkSSSB...",
        "....BBBBBBBBB...",
        "....SB.....BS...",
        "....BB.....BB...",
        ".....B.....B....",
        "....SSS...SSS...",
    ],
    // the thwip: side-on, crouched and leaning into the shot, the back hand on the ground
    speak: [
        E,
        E,
        "...............x",
        "..............x.",
        ".......SSSS..x..",
        "......SSkeeSS...",
        "......SSSeeBS...",
        ".......SSSBB....",
        "....BSSSSB......",
        "...BSSkSSB......",
        "..B.SSSkB.......",
        ".S..BBBBB.......",
        "...BB...BB......",
        "..BB.....BB.....",
        ".BB.....BB......",
        ".SS....SSS......",
    ],
    // being dragged: one hand up on the strand (column 12), legs hanging
    dangle: [
        "............S...",
        "............B...",
        "......SSSSS.B...",
        ".....SSSDSSSB...",
        ".....keeDeekB...",
        ".....SeeDeeSB...",
        "......SSDSSB....",
        "....BSSSSSSB....",
        "....BSSkSkSS....",
        "....BSSSkSSS....",
        "....SSSkSkSS....",
        "......BBBBB.....",
        ".....BB..BB.....",
        ".....BB...BB....",
        "....BB....BB....",
        "....SS.....SS...",
    ],
    // Pastimes, as Sprout's. Reading: sat with a book on his lap
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
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
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
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        "..prwwwwrwwwwrp.",
        "...rwwmmrwwmmr..",
        "...rrrrrrrrrrss.",
    ],
    // listening to music
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
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
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
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
        ".....BBBBBBB....",
        ".....BB..BB.....",
        "....ss....ss....",
    ],
    // working at a laptop seen side-on, a key lit as it types and the code mark over his head
    work1: [
        ".......w...w.w..",
        "......w...w...w.",
        ".......w.w...w..",
        E,
        "......SSSSS...m.",
        ".....SSSDSSS.lm.",
        ".....keeDeek.lm.",
        ".....SeeDeeS.lm.",
        "......SSDSS..lm.",
        "....BSSSSSSSBlm.",
        "....BSSkSkSSSlm.",
        "....BSSSkSSS.lm.",
        "....BSSkSkSS.lm.",
        "......BBBBB.mwmm",
        ".....BB...BB....",
        "....SSS...SSS...",
    ],
    work2: [
        ".......m...m.m..",
        "......m...m...m.",
        ".......m.m...m..",
        E,
        "......SSSSS...m.",
        ".....SSSDSSS.wm.",
        ".....keeDeek.wm.",
        ".....SeeDeeS.wm.",
        "......SSDSS..wm.",
        "....BSSSSSSSBwm.",
        "....BSSkSkSSSwm.",
        "....BSSSkSSS.wm.",
        "....BSSkSkSS.wm.",
        "......BBBBB.mmwm",
        ".....BB...BB....",
        "....SSS...SSS...",
    ],
    // playing sport: dribbling a ball at his side, high then low
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
        "....vvSSkSSvvrr.",
        "....pvSSSSSvp...",
        ".....vSSSSSv....",
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
        "....vvSSkSSvv...",
        "....pvSSSSSvp...",
        ".....vSSSSSv.rr.",
        ".....BBBBBBBrrrr",
        ".....BB...BBrrrr",
        "....ss....ss.rr.",
    ],
};

// Upside down already: boots wrapped on the strand (column 8) at the top, knees bent out, hands on the strand, the
// head at the bottom.
export const SPIDEY_HANG: readonly string[] = [
    ".......SxS......",
    ".......SxS......",
    "......B.x.B.....",
    ".....B..x..B....",
    "....B...x...B...",
    ".....B..x..B....",
    "......BSxSB.....",
    "......BBBBB.....",
    ".....BSSSSSB....",
    ".....BSkSkSB....",
    ".....SSSkSSS....",
    ".....SSkSkSS....",
    "......SDSDS.....",
    ".....SeeDeeS....",
    ".....keeDeek....",
    "......SSDSS.....",
];

// Two frames, upside down, belly to the app bar's underside, side-on facing right.
export const SPIDEY_CRAWL: readonly (readonly string[])[] = [
    [
        "..SS........SS..",
        "...BB......BB...",
        "SS..BB....BB.S..",
        "SBB.BSSSDSB.SS..",
        ".BBSDSkSDSSDSS..",
        "..BBSSSBBSSSSee.",
        "...BBBB..SSSkee.",
        ".........SDSDSS.",
        "..........SSSS..",
        E,
        E,
        E,
        E,
        E,
        E,
        E,
    ],
    [
        "....SS....SS....",
        "....BB....BB....",
        "..SSBB....BBS...",
        "..SBBSSSDSBSS...",
        ".BBSDSkSDSSDSS..",
        "..BBSSSBBSSSSee.",
        "...BBBB..SSSkee.",
        ".........SDSDSS.",
        "..........SSSS..",
        E,
        E,
        E,
        E,
        E,
        E,
        E,
    ],
];

// The web-swing's body (petwebswing.ts): slung along the strand, the hand up at column 10, knees tucked.
export const SPIDEY_SWING: readonly string[] = [
    "..........S.....",
    "..........B.....",
    "....SSS..B......",
    "...SSSSSB.......",
    "...SSkeeB.......",
    "...SSSeeSB......",
    "....SSSSSB......",
    "...BSSkSSB......",
    "..BBSSkkSB......",
    ".SB.BSSkSB......",
    "....BBBBBB......",
    "...BB..BB.......",
    "..BB..BB........",
    ".SS..SS.........",
    E,
    E,
];

export type SpideyLook = "suit" | "peter";

export const SPIDEY_LOOK: Record<PetPose, SpideyLook> = {
    walk1: "suit",
    walk2: "suit",
    stand: "suit",
    speak: "suit",
    tired: "suit",
    dangle: "suit",
    work1: "suit",
    work2: "suit",
    sit: "suit",
    sleep: "peter",
    read1: "peter",
    read2: "peter",
    music1: "peter",
    music2: "peter",
    ball1: "peter",
    ball2: "peter",
};

// The fold's rooftop scene, 20x20 cells: he sits front-on on the edge, hands on the ledge, legs over the front.
const FOLD_TOP: readonly string[] = [
    "....................",
    "....................",
    ".......SSSSS........",
    "......SSSDSSS.......",
    "......keeDeek.......",
    "......SeeDeeS.......",
    ".......SSDSS........",
    ".....BSSSSSSSB......",
    ".....BSSkSkSSB......",
    ".....BSSSkSSSB......",
    ".....BSSkSkSSB......",
    ".....S.BBBBB.S......",
];
// the legs over the ledge, two frames of a swing
const FOLD_LEGS: readonly (readonly string[])[] = [
    [
        "..cccccBBcBBccccccc.",
        "..CCCCCBBCBBCCCCCCC.",
        "..MMMNMBBMBBMMMNMMM.",
        "..MMMMMSSMSSMMMMMMM.",
    ],
    [
        "..cccccBBccBBcccccc.",
        "..CCCCCBBCCBBCCCCCC.",
        "..MMMNBBMMMMBBMNMMM.",
        "..MMMMSSMMMMSSMMMMM.",
    ],
];
// the four windows' left columns; each is 2x2, on rows 17 and 18
const FOLD_WINDOWS = [3, 7, 11, 15];

/** The rooftop scene: the first min(lit, 4) windows lit, the legs in the swing's first or second frame. */
export function spideyFold(lit: number, swing: boolean): readonly string[] {
    const wall = [...FOLD_TOP_WALL];
    const windows = [..."..MMMMMMMMMMMMMMMMM."];
    FOLD_WINDOWS.forEach((x, i) => {
        windows[x] = windows[x + 1] = i < lit ? "L" : "Q";
    });
    return [...FOLD_TOP, ...FOLD_LEGS[swing ? 1 : 0], wall[0], windows.join(""), windows.join(""), wall[1]];
}

// the brick rows above and below the windows
const FOLD_TOP_WALL = ["..MMMMMMMMMMMMMMMMM.", "..MMMNMMMMMMMNMMMMM."];

// Spider-sense: amber jags either side of the head and over it, drawn in --color-asking when something waits on you
export const SPIDEY_SENSE: readonly { x: number; y: number }[] = [
    { x: 5, y: 1 },
    { x: 4, y: 2 },
    { x: 5, y: 3 },
    { x: 13, y: 1 },
    { x: 14, y: 2 },
    { x: 13, y: 3 },
    { x: 8, y: 0 },
    { x: 10, y: 0 },
];
```

  (`FOLD_TOP_WALL` must be declared before `spideyFold` is first called; keep the constants above the function.)

- The outfit, after `dressMinionInFlag`:

```ts
// The flag shirt on Spider-Man: Peter's open shirt turns red, with no star (it has no three-row panel to hold one); a
// suit is a suit, so a pose in it is left as it is.
function dressSpideyInFlag(rows: readonly string[]): readonly string[] {
    return rows.some((row) => row.includes("v")) ? rows.map((row) => row.replace(/v/g, "R")) : rows;
}
```

  `const SPIDEY_DRESSED = {} as Record<PetPose, readonly string[]>;` beside the others, filled in the same loop, and in
  `outfitRows` before the Minion's branch:

```ts
    if (character === "spidey") {
        return outfit === "vn-shirt" ? SPIDEY_DRESSED[pose] : SPIDEY_POSES[pose];
    }
```

- Name the sprite type and add a drawer for grids outside `PetPose`, after `spriteFor`:

```ts
export interface PetSprite {
    back: PetCell[];
    body: PetCell[];
    overlay: PetCell[];
}

/** A grid that is not a PetPose (Spider-Man's hang, crawl, swing) drawn as spriteFor draws a pose: body and marks. */
export function spriteOfRows(rows: readonly string[], marks: readonly PetMark[]): PetSprite {
    const body: PetCell[] = [];
    stamp(rows, 0, 0, body);
    const overlay: PetCell[] = [];
    for (const mark of new Set(marks)) {
        const { x, y, rows: m } = MARKS[mark];
        stamp(m, x, y, overlay);
    }
    return { back: [], body, overlay };
}
```

  and make `spriteFor` return `PetSprite`.

**Step 5: The name, the setting, the fold button**

- `petcharacter.ts`: `PET_CHARACTER_NAME` gains `spidey: "Spider-Man"`; `petCharacter` accepts `"spidey"` ("not one of
  the three"); the header "draws both" → "draws each".
- `appearance.tsx:142`: `(["sprout", "minion", "spidey"] as const)`.
- `settingsmodel.ts:279`: `desc: "Who walks the footer as Jarvis. The marks and the outfit work the same for each."`
- `app-bar.tsx` `FOLD_SPRITE` gains `spidey: spriteFor("stand", [], null, "spidey"),` with the comment "standing, in the
  suit: his sitting pose is a crouch, which does not read as the one the window folds into".

**Step 6: Tests and typecheck**

Run: `npx vitest run frontend/app/view/jarvis/ frontend/app/view/agents/settingsmodel.test.ts` — PASS.
Run: `task check:ts` — exit 0; a `Record<PetCharacter, …>` it reports gets a `spidey` entry the way the Minion has one.

**Step 7: Commit**

```bash
git commit -m "feat(pet): Spider-Man as a third Jarvis character — the Homecoming suit at work, Peter Parker at rest" -- frontend/tailwindsetup.css frontend/app/view/jarvis/petsprite.ts frontend/app/view/jarvis/petsprite.test.ts frontend/app/view/jarvis/petcharacter.ts frontend/app/view/jarvis/petcharacter.test.ts frontend/app/view/agents/settingspages/appearance.tsx frontend/app/view/agents/settingsmodel.ts frontend/app/cockpit/app-bar.tsx
```

---

### Task 2: The Spider theme

**Depends on:** none

**Files:** `frontend/app/view/agents/themes.ts`, `frontend/app/view/agents/themes.test.ts`

**Step 1: Failing tests** (`themes.test.ts`): the contrast-floor loop (line ~79) becomes
`for (const id of [DEFAULT_THEME_PRESET, "graphite", "spider"])`; "THEMES ships the eight dark presets" becomes nine and
`toHaveLength(9)`; add to that `describe`:

```ts
    it("Spider is Claude's palette with a red accent and a pinker error", () => {
        const claude = activePalette(DEFAULT_THEME_PRESET);
        const spider = activePalette("spider");
        const { accent, error, claudeMark, ...rest } = spider;
        const { accent: _a, error: _e, claudeMark: _m, ...claudeRest } = claude;
        expect(rest).toEqual(claudeRest);
        expect(accent).toBe("#f05252");
        expect(error).toBe("#ff6b9a");
        expect(claudeMark).toBeUndefined();
    });
```

Run `npx vitest run frontend/app/view/agents/themes.test.ts` — FAIL.

**Step 2: The preset** — append to `THEMES`:

```ts
    {
        id: "spider",
        name: "Spider",
        // Claude's palette with Spider-Man's red: the accent lifted from #e23636 (3.81:1 on bg) to clear 4.5:1 as link
        // text (4.78:1), the error pushed pinker so a failure never reads as the accent. No claudeMark: the accent is not
        // Claude's clay, so the Claude mark keeps the brand clay as in every other theme.
        palette: {
            bg: "#1f1e1d",
            surface: "#262624",
            surfaceRaised: "#30302e",
            surfaceHover: "#363532",
            surfaceSelected: "#3d3c38",
            code: "#141413",
            border: "#2e2d2b",
            edgeMid: "#383734",
            edgeStrong: "#4a4945",
            edgeFaint: "#282725",
            text: "#ece9e0",
            secondary: "#c2c0b6",
            muted: "#a3a198",
            inkFaint: "#7b7972",
            accent: "#f05252",
            success: "#4eba65",
            warning: "#ffc107",
            error: "#ff6b9a",
            ansiBlue: "#6a9bcc",
        },
    },
```

(Check each value against the Claude entry above it; the test holds them equal.)

**Step 3:** `npx vitest run frontend/app/view/agents/` — PASS (the per-theme ANSI tests iterate `THEMES` too).

**Step 4: Commit**

```bash
git commit -m "feat(theme): Spider, Claude's palette with a Spider-Man red accent" -- frontend/app/view/agents/themes.ts frontend/app/view/agents/themes.test.ts
```

---

### Task 3: The web, as pure motion (rappel and web-swing)

**Depends on:** none

**Files:** `frontend/app/view/jarvis/petfall.ts`, `frontend/app/view/jarvis/petfall.test.ts`, `frontend/app/view/jarvis/petwebswing.ts`, `frontend/app/view/jarvis/petwebswing.test.ts`

**Step 1: Failing tests**

Append to `petfall.test.ts` (import `webLanding`, `MIN_RAPPEL_S`, `MAX_RAPPEL_S`):

```ts
describe("webLanding", () => {
    it.each([-30, -160, -300, -1000])("rappels %s px slower than a fall, braking into the ledge", (offset) => {
        const web = webLanding(offset)!;
        expect(web.duration).toBeGreaterThan(landing(offset)!.duration);
        expect(web.y[0]).toBe(offset);
        expect(web.y[web.y.length - 1]).toBe(0);
        expect(web.ease[0]).toBe("easeOut");
        expect(web.times[0]).toBe(0);
        expect(web.times[web.times.length - 1]).toBe(1);
    });

    it("takes MIN_RAPPEL_S..MAX_RAPPEL_S to reach the ledge, before its bounce", () => {
        const reach = (o: number) => webLanding(o)!.duration * webLanding(o)!.times[1];
        expect(reach(-3)).toBeCloseTo(MIN_RAPPEL_S, 5);
        expect(reach(-5000)).toBeCloseTo(MAX_RAPPEL_S, 5);
    });

    it("hops up like landing from below, and is nothing when already there", () => {
        expect(webLanding(20)).toEqual(landing(20));
        expect(webLanding(0)).toBeNull();
        expect(webLanding(-0.5)).toBeNull();
    });
});
```

Create `petwebswing.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { TELEPORT_MS, TELEPORT_TAIL_MS } from "./petteleport";
import { ANCHOR, HANDS, SHOOT_MS, strandCells, SWING_FROM, webSwingFrame, type WebCell } from "./petwebswing";

const touching = (cells: WebCell[]) =>
    cells.every((c, i) => i === 0 || (Math.abs(c.x - cells[i - 1].x) <= 1 && Math.abs(c.y - cells[i - 1].y) <= 1));

describe("strandCells", () => {
    it("runs from one end to the other, each cell touching the last", () => {
        const s = strandCells({ x: 10, y: 0 }, { x: 14, y: -14 });
        expect(s[0]).toEqual({ x: 10, y: 0 });
        expect(s[s.length - 1]).toEqual({ x: 14, y: -14 });
        expect(touching(s)).toBe(true);
    });

    it("is one cell when both ends are one", () => {
        expect(strandCells({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
    });
});

describe("webSwingFrame", () => {
    it("lasts what the teleport lasts, so the fold's timing does not change", () => {
        for (const kind of ["depart", "arrive"] as const) {
            expect(TELEPORT_MS[kind]).toBeLessThanOrEqual(TELEPORT_TAIL_MS[kind]);
            expect(webSwingFrame(kind, TELEPORT_TAIL_MS[kind]).strand).toEqual([]);
        }
    });

    it("holds the strand in SPIDEY_SWING's hand", () => {
        expect(HANDS).toEqual({ x: 10, y: 0 });
    });

    it("departs: the strand shoots from its hand to the anchor, then it is pulled up it and gone", () => {
        const start = webSwingFrame("depart", 0);
        expect(start.pet).toEqual({ dx: 0, dy: 0, opacity: 1 });
        expect(start.strand[0]).toEqual(HANDS);
        const shot = webSwingFrame("depart", SHOOT_MS);
        expect(shot.strand[shot.strand.length - 1]).toEqual(ANCHOR);
        const mid = webSwingFrame("depart", (SHOOT_MS + TELEPORT_MS.depart) / 2);
        expect(mid.pet.dy).toBeLessThan(0);
        const end = webSwingFrame("depart", TELEPORT_MS.depart);
        expect(end.pet.opacity).toBe(0);
        expect(end.strand).toEqual([]);
    });

    it("arrives: a strand drops, it swings in down it, and lands where it stands with no strand left", () => {
        const start = webSwingFrame("arrive", 0);
        expect(start.pet.opacity).toBe(0);
        expect(start.strand[0]).toEqual(ANCHOR);
        let last = { dx: SWING_FROM.dx, dy: SWING_FROM.dy };
        for (let t = SHOOT_MS; t < TELEPORT_MS.arrive; t += 10) {
            const f = webSwingFrame("arrive", t);
            expect(f.pet.opacity).toBe(1);
            expect(Math.abs(f.pet.dx)).toBeLessThanOrEqual(Math.abs(last.dx));
            expect(Math.abs(f.pet.dy)).toBeLessThanOrEqual(Math.abs(last.dy));
            expect(f.strand[0]).toEqual({ x: HANDS.x + f.pet.dx, y: HANDS.y + f.pet.dy });
            expect(f.strand[f.strand.length - 1]).toEqual(ANCHOR);
            last = f.pet;
        }
        expect(webSwingFrame("arrive", TELEPORT_MS.arrive)).toEqual({ pet: { dx: 0, dy: 0, opacity: 1 }, strand: [] });
    });

    it("moves only in whole cells, so it stays pixel art", () => {
        for (const kind of ["depart", "arrive"] as const) {
            for (let t = 0; t <= TELEPORT_MS[kind]; t += 7) {
                const f = webSwingFrame(kind, t);
                expect(Number.isInteger(f.pet.dx) && Number.isInteger(f.pet.dy)).toBe(true);
                expect(f.strand.every((c) => Number.isInteger(c.x) && Number.isInteger(c.y))).toBe(true);
            }
        }
    });
});
```

Run both files — FAIL.

**Step 2: The rappel** — append to `petfall.ts`:

```ts
// Spider-Man does not drop: he rappels down a strand at this speed, braking (easeOut) into the ledge, within these.
export const RAPPEL_PX_S = 600;
export const MIN_RAPPEL_S = 0.25;
export const MAX_RAPPEL_S = 0.6;

/**
 * Spider-Man's way back to the ledge from `offset` px below it: from above a rappel, slower than a fall and braking
 * rather than accelerating, with the same one-cell bounce; from below landing's hop; null when he is already there.
 */
export function webLanding(offset: number): Landing | null {
    if (offset > -1) {
        return landing(offset);
    }
    const down = Math.min(MAX_RAPPEL_S, Math.max(MIN_RAPPEL_S, -offset / RAPPEL_PX_S));
    const duration = down + 2 * BOUNCE_S;
    return {
        y: [offset, 0, -BOUNCE_PX, 0],
        times: [0, down / duration, (down + BOUNCE_S) / duration, 1],
        ease: ["easeOut", "easeOut", "easeIn"],
        duration,
    };
}
```

**Step 3: The web-swing** — create `petwebswing.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Spider-Man's teleport (petteleport.ts draws Sprout's and the Minion's): departing, he shoots a strand up and out and
// is yanked along it out of sight; arriving, a strand drops and he swings in down it to where he stands. It lasts what
// the teleport lasts (TELEPORT_MS), so teleportstore.ts and the fold's timing do not know which one plays. The body is
// SPIDEY_SWING, moved in whole cells; the strand is cells in --color-spidey-web. Pure: the frame at a time;
// petteleportsvg.tsx draws it.

import { TELEPORT_MS, type TeleportKind } from "./petteleport";

export const WEB_TOKEN = "--color-spidey-web";

// a cell on the pet's grid; x and y may fall outside its 16x16
export interface WebCell {
    x: number;
    y: number;
}

export interface WebSwingFrame {
    // where the body is drawn, in whole cells from where he stands, and how much of it shows
    pet: { dx: number; dy: number; opacity: number };
    // the strand, from his hand to where it is stuck; empty when none is drawn
    strand: WebCell[];
}

// where the strand sticks: up and out to the right, off the pet's box
export const ANCHOR: WebCell = { x: 14, y: -14 };
// SPIDEY_SWING's raised hand
export const HANDS: WebCell = { x: 10, y: 0 };
// where an arriving swing comes from, in cells from where he lands: up and to the left
export const SWING_FROM = { dx: -12, dy: -10 };
// how long the strand takes to shoot out or drop
export const SHOOT_MS = 120;
// a departing body fades over the last part of its pull
const FADE_FROM = 0.6;

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const easeIn = (k: number) => k * k;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
const at = (p: WebCell, dx: number, dy: number): WebCell => ({ x: p.x + dx, y: p.y + dy });

/** The cells of a 1-cell strand from `a` to `b`, both included, each touching the last (Bresenham's line). */
export function strandCells(a: WebCell, b: WebCell): WebCell[] {
    const out: WebCell[] = [];
    let { x, y } = a;
    const dx = Math.abs(b.x - x);
    const dy = -Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1;
    const sy = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        out.push({ x, y });
        if (x === b.x && y === b.y) {
            return out;
        }
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
    }
}

function depart(t: number): WebSwingFrame {
    if (t < SHOOT_MS) {
        const k = t / SHOOT_MS;
        const tip = { x: lerp(HANDS.x, ANCHOR.x, k), y: lerp(HANDS.y, ANCHOR.y, k) };
        return { pet: { dx: 0, dy: 0, opacity: 1 }, strand: strandCells(HANDS, tip) };
    }
    const k = clamp01((t - SHOOT_MS) / (TELEPORT_MS.depart - SHOOT_MS));
    if (k >= 1) {
        return { pet: { dx: ANCHOR.x - HANDS.x, dy: ANCHOR.y - HANDS.y, opacity: 0 }, strand: [] };
    }
    // pulled up the strand, faster as he goes
    const dx = lerp(0, ANCHOR.x - HANDS.x, easeIn(k));
    const dy = lerp(0, ANCHOR.y - HANDS.y, easeIn(k));
    const opacity = k < FADE_FROM ? 1 : 1 - (k - FADE_FROM) / (1 - FADE_FROM);
    return { pet: { dx, dy, opacity }, strand: strandCells(at(HANDS, dx, dy), ANCHOR) };
}

function arrive(t: number): WebSwingFrame {
    const from = at(HANDS, SWING_FROM.dx, SWING_FROM.dy);
    if (t < SHOOT_MS) {
        const k = t / SHOOT_MS;
        const tip = { x: lerp(ANCHOR.x, from.x, k), y: lerp(ANCHOR.y, from.y, k) };
        return { pet: { dx: SWING_FROM.dx, dy: SWING_FROM.dy, opacity: 0 }, strand: strandCells(ANCHOR, tip) };
    }
    const k = clamp01((t - SHOOT_MS) / (TELEPORT_MS.arrive - SHOOT_MS));
    if (k >= 1) {
        return { pet: { dx: 0, dy: 0, opacity: 1 }, strand: [] };
    }
    // a pendulum's arc: he drops first and comes across last, rather than sliding in a line
    const dx = lerp(SWING_FROM.dx, 0, easeIn(k));
    const dy = lerp(SWING_FROM.dy, 0, easeOut(k));
    return { pet: { dx, dy, opacity: 1 }, strand: strandCells(at(HANDS, dx, dy), ANCHOR) };
}

/** The web-swing t ms after it began. */
export function webSwingFrame(kind: TeleportKind, t: number): WebSwingFrame {
    const a = Math.max(0, t);
    return kind === "depart" ? depart(a) : arrive(a);
}
```

**Step 4:** run both test files — PASS.

**Step 5: Commit**

```bash
git add frontend/app/view/jarvis/petwebswing.ts frontend/app/view/jarvis/petwebswing.test.ts
git commit -m "feat(pet): Spider-Man rappels down a strand and web-swings in place of the teleport (pure)" -- frontend/app/view/jarvis/petfall.ts frontend/app/view/jarvis/petfall.test.ts frontend/app/view/jarvis/petwebswing.ts frontend/app/view/jarvis/petwebswing.test.ts
```

---

### Task 4: The app-bar pastime and the ceiling (pure)

**Depends on:** none

**Files:** `frontend/app/view/jarvis/petwalk.ts`, `frontend/app/view/jarvis/petwalk.test.ts`, `frontend/app/view/jarvis/petledge.ts`, `frontend/app/view/jarvis/petledge.test.ts`, `frontend/app/view/jarvis/petview.tsx`

**Step 1: Failing tests**

`petledge.test.ts` — import `measureCeiling`; append:

```ts
describe("measureCeiling", () => {
    const box = (top: number, bottom: number) => ({ left: 0, right: 800, top, bottom });

    it("is the bottom of the app bar he hangs from", () => {
        expect(measureCeiling([box(0, 38)])).toBe(38);
    });

    it("is null with no ceiling shown: Float and the folded window, where he never hangs", () => {
        expect(measureCeiling([])).toBeNull();
        expect(measureCeiling([{ left: 0, right: 0, top: 0, bottom: 0 }])).toBeNull();
    });

    it("takes the lowest of several", () => {
        expect(measureCeiling([box(0, 38), box(38, 70)])).toBe(70);
    });
});
```

`petwalk.test.ts` — import `CRAWL_MIN_MS`, `CRAWL_STEP_MS`, `HANG_DOWN_MS`, `HANG_EVERY`, `HANG_MIN_MS`, `HANG_UP_MS`,
`startHang`; add `hangs: false,` to the `input()` helper before `...over`; append:

```ts
describe("hang (Spider-Man)", () => {
    // a walk one step from its target, so the next step lands and starts a rest
    const arriving = () => walker({ name: "walk", x: 400, target: 400, due: T0 });
    const zero = () => 0;
    const hanging = input({ hangs: true });
    // with rand 0: crawl CRAWL_MIN_MS, hang HANG_MIN_MS
    const DUE = T0 + HANG_UP_MS + CRAWL_MIN_MS + HANG_MIN_MS + HANG_DOWN_MS;

    it("starts about one rest in HANG_EVERY when it can, going up first in dangle", () => {
        expect(HANG_EVERY).toBe(7);
        const step = stepWalker(arriving(), hanging, T0, zero);
        expect(step.state.restPose).toBe("hang");
        expect([step.hang, step.pose, step.delayMs]).toEqual(["up", "dangle", HANG_UP_MS]);
    });

    it("rests as before on a draw past one in seven", () => {
        const step = stepWalker(arriving(), hanging, T0, () => 0.5);
        expect(step.state.restPose).not.toBe("hang");
        expect(step.hang).toBeNull();
    });

    it("never hangs when it cannot, nor tired", () => {
        expect(stepWalker(arriving(), input(), T0, zero).hang).toBeNull();
        expect(stepWalker(arriving(), input({ hangs: true, expression: "tired" }), T0, zero).hang).toBeNull();
    });

    it("goes up, crawls a cell every CRAWL_STEP_MS toward the roomier side, hangs, comes down, walks on", () => {
        const s = startHang(walker({ x: 400 }), hanging, T0, zero);
        expect(s.due).toBe(DUE);
        const up = stepWalker(s, hanging, T0, half);
        expect([up.hang, up.pose]).toEqual(["up", "dangle"]);
        const crawl = stepWalker(up.state, hanging, T0 + HANG_UP_MS, half);
        expect([crawl.hang, crawl.x, crawl.delayMs]).toEqual(["crawl", 400, CRAWL_STEP_MS]);
        const on = stepWalker(crawl.state, hanging, T0 + HANG_UP_MS + 2 * CRAWL_STEP_MS, half);
        // 400 has more room to the right of LEDGE's travel (100..1252)
        expect([on.hang, on.x, on.flip]).toEqual(["crawl", 400 + 2 * STEP_PX, false]);
        const hang = stepWalker(on.state, hanging, T0 + HANG_UP_MS + CRAWL_MIN_MS, half);
        expect([hang.hang, hang.pose, hang.delayMs]).toEqual(["hang", "stand", HANG_MIN_MS]);
        const down = stepWalker(hang.state, hanging, DUE - HANG_DOWN_MS, half);
        expect([down.hang, down.pose, down.delayMs]).toEqual(["down", "dangle", HANG_DOWN_MS]);
        const after = stepWalker(down.state, hanging, DUE, half);
        expect(after.hang).toBeNull();
        expect(after.state.name).toBe("walk");
    });

    it("crawls left from near the right end, mirrored, and never off the ledge", () => {
        const s = startHang(walker({ x: 1250 }), hanging, T0, zero);
        let step = stepWalker(s, hanging, T0 + HANG_UP_MS, half);
        for (let t = T0 + HANG_UP_MS; t < T0 + HANG_UP_MS + CRAWL_MIN_MS; t += CRAWL_STEP_MS) {
            step = stepWalker(step.state, hanging, t, half);
            expect(step.x).toBeGreaterThanOrEqual(LEDGE.left);
            expect(step.x).toBeLessThanOrEqual(LEDGE.right - PX);
            expect(step.flip).toBe(true);
        }
        expect(step.x).toBeLessThan(1250);
    });

    it("comes down at once when it can no longer hang, and rests the rest of the time standing where it crawled to", () => {
        const s = startHang(walker({ x: 400 }), hanging, T0, zero);
        const mid = stepWalker(s, hanging, T0 + HANG_UP_MS + 4 * CRAWL_STEP_MS, half);
        const cut = stepWalker(mid.state, input({ hangs: false }), T0 + HANG_UP_MS + 4 * CRAWL_STEP_MS, half);
        expect([cut.hang, cut.pose, cut.state.name, cut.x]).toEqual([null, "stand", "rest", mid.x]);
        expect(cut.state.due).toBe(DUE);
    });

    it("comes down for a posture, and for a drag", () => {
        const s = startHang(walker(), hanging, T0, zero);
        expect(stepWalker(s, input({ hangs: true, posture: "escalation" }), T0 + 1_000, half).hang).toBeNull();
        const dragged = stepWalker(s, input({ hangs: true, dragging: true }), T0 + 1_000, half);
        expect([dragged.hang, dragged.pose]).toEqual([null, "dangle"]);
    });

    it("stays up when a terminal opens under the ledge: it is not on the ledge", () => {
        const s = startHang(walker({ x: 400 }), hanging, T0, zero);
        const step = stepWalker(s, input({ hangs: true, avoid: [[300, 900]] }), T0 + HANG_UP_MS + CRAWL_MIN_MS + 1_000, half);
        expect(step.hang).toBe("hang");
    });
});

// the DEV force that shows each rest pose on demand (Task 5 Step 7, Task 7's CDP steps)
describe("restIn", () => {
    it.each(REST_POSES)("rests now in %s, for the longest rest, where it stands", (pose) => {
        const s = restIn(walker({ name: "walk", x: 400, target: 900 }), pose, T0);
        expect([s.name, s.restPose, s.x, s.target, s.due]).toEqual(["rest", pose, 400, null, T0 + REST_MAX_MS]);
        expect(stepWalker(s, input(), T0, half).state.name).toBe("rest");
    });
});
```

(`PX`, `LEDGE`, `STEP_PX`, `half`, `walker`, `input` are the file's existing helpers and imports; also import
`REST_POSES`, `REST_MAX_MS`, `restIn`.)

Run `npx vitest run frontend/app/view/jarvis/petwalk.test.ts frontend/app/view/jarvis/petledge.test.ts` — FAIL.

**Step 2: `measureCeiling`** — `petledge.ts`, after `measureLedge`:

```ts
/**
 * The y Spider-Man hangs from: the bottom of the lowest shown `[data-pet-ceiling]` box (the app bar), or null when none
 * is shown — Float and the folded window, where he never hangs.
 */
export function measureCeiling(boxes: readonly Box[]): number | null {
    let best: number | null = null;
    for (const b of boxes) {
        if (shown(b) && (best == null || b.bottom > best)) {
            best = b.bottom;
        }
    }
    return best;
}
```

**Step 3: The walker** — `petwalk.ts`:

1. After `PASTIMES`:

```ts
// Spider-Man's own rest, when WalkerInput.hangs: a strand to the app bar and up it, a crawl along its underside, a hang
// upside down from it, and a rappel back down where the crawl left him. About one rest in HANG_EVERY, never tired.
export const HANG_EVERY = 7;
export const HANG_UP_MS = 400;
export const CRAWL_MIN_MS = 1_500;
export const CRAWL_MAX_MS = 3_000;
// a cell of crawl this often
export const CRAWL_STEP_MS = 250;
export const HANG_MIN_MS = 4_000;
export const HANG_MAX_MS = 8_000;
export const HANG_DOWN_MS = 500;

export type HangPhase = "up" | "crawl" | "hang" | "down";
```

2. `export type RestPose = (typeof REST_POSES)[number] | "hang";`
3. `WalkerInput`, after `home`:

```ts
    // Spider-Man, with an app bar to hang from, the cursor not on him, and motion allowed: a rest may be a hang
    hangs: boolean;
```

4. `WalkerState`, after `posture`:

```ts
    // a hang rest: when it began, how long it crawls, where it left the ledge and which way it crawls
    hang?: { at: number; crawlMs: number; x0: number; dir: 1 | -1 };
```

5. `WalkerStep`, after `lift`:

```ts
    // Spider-Man's app-bar pastime, by phase; null otherwise. The renderer draws the crawl and the hang from their own
    // grids (SPIDEY_CRAWL, SPIDEY_HANG), and the pose stands in for them
    hang: HangPhase | null;
```

6. Replace `rest`, and add `startHang`, `hangPhase`, `hangX`:

```ts
function rest(s: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerState {
    // the extra draw only when he can hang, so every other creature's walk is the walk it always was
    if (input.hangs && !wearsTired(input.expression) && rand() < 1 / HANG_EVERY) {
        return startHang(s, input, now, rand);
    }
    const length = REST_MIN_MS + rand() * (REST_MAX_MS - REST_MIN_MS);
    return {
        ...still(s, "rest"),
        due: now + (wearsTired(input.expression) ? 2 * length : length),
        restPose: REST_POSES[Math.min(REST_POSES.length - 1, Math.floor(rand() * REST_POSES.length))],
        hang: undefined,
    };
}

/** A hang rest starting now, crawling toward the roomier side. Exported for the DEV force (petview.tsx). */
export function startHang(s: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerState {
    const crawlMs = CRAWL_MIN_MS + rand() * (CRAWL_MAX_MS - CRAWL_MIN_MS);
    const hangMs = HANG_MIN_MS + rand() * (HANG_MAX_MS - HANG_MIN_MS);
    const [lo, hi] = travel(input.ledge);
    const dir = hi - s.x >= s.x - lo ? 1 : -1;
    return {
        ...still(s, "rest"),
        restPose: "hang",
        flip: dir < 0,
        hang: { at: now, crawlMs, x0: s.x, dir },
        due: now + HANG_UP_MS + crawlMs + hangMs + HANG_DOWN_MS,
    };
}

/** Which phase of his hang a state is in at `now`, or null when he is not hanging. */
export function hangPhase(s: WalkerState, now: number): HangPhase | null {
    if (s.name !== "rest" || s.restPose !== "hang" || s.hang == null) {
        return null;
    }
    const t = now - s.hang.at;
    if (t < HANG_UP_MS) {
        return "up";
    }
    if (t < HANG_UP_MS + s.hang.crawlMs) {
        return "crawl";
    }
    return now >= s.due - HANG_DOWN_MS ? "down" : "hang";
}

// where the crawl has taken him by now: a cell every CRAWL_STEP_MS from where he went up, kept on the ledge's span
function hangX(s: WalkerState, input: WalkerInput, now: number): number {
    const h = s.hang!;
    const t = Math.min(Math.max(0, now - h.at - HANG_UP_MS), h.crawlMs);
    return clampX(h.x0 + h.dir * Math.floor(t / CRAWL_STEP_MS) * STEP_PX, input.ledge);
}
```

7. `restPoseAt`, first lines:

```ts
    const phase = hangPhase(s, now);
    if (phase != null) {
        // hands on the strand going up and coming down; the crawl and the hang are drawn from their own grids
        return phase === "up" || phase === "down" ? "dangle" : "stand";
    }
```

8. `restDelay`, first lines:

```ts
    if (s.restPose === "hang" && s.hang != null) {
        const h = s.hang;
        const crawlEnd = h.at + HANG_UP_MS + h.crawlMs;
        const bounds = [h.at + HANG_UP_MS, crawlEnd, s.due - HANG_DOWN_MS, s.due];
        if (now >= h.at + HANG_UP_MS && now < crawlEnd) {
            const into = now - h.at - HANG_UP_MS;
            bounds.push(h.at + HANG_UP_MS + (Math.floor(into / CRAWL_STEP_MS) + 1) * CRAWL_STEP_MS);
        }
        const next = bounds.filter((b) => b > now);
        return next.length === 0 ? 0 : Math.min(...next) - now;
    }
```

9. `stepWalker`'s rest branch:

```ts
    } else if (s.name === "rest") {
        if (s.restPose === "hang" && s.hang != null) {
            if (input.hangs) {
                s = { ...s, x: hangX(s, input, now) };
            } else {
                // the cursor came onto him, or the app bar went: he comes down where he is and rests the rest standing
                s = { ...s, restPose: "stand", hang: undefined };
            }
        }
        if (s.restPose !== "hang" && blocked(s.x, avoid) && clearSpot(s.x, ledge, avoid) !== s.x) {
```

   (the rest of the branch as it is.)

10. `view`: `hang: hangPhase(s, now),` beside `lift`.

11. The DEV force's rest, after `rest`:

```ts
// A rest begun now in this pose, for its longest length: the DEV contract's force({ rest }) (petview.tsx), so a CDP
// step can show every rest pose without waiting on the random pick.
export function restIn(s: WalkerState, pose: (typeof REST_POSES)[number], now: number): WalkerState {
    return { ...still(s, "rest"), due: now + REST_MAX_MS, restPose: pose, hang: undefined };
}
```

**Step 4: Tests and typecheck**

`npx vitest run frontend/app/view/jarvis/` — PASS, the existing walker tests too (they never set `hangs`).
`task check:ts` — the errors are where a `WalkerInput` is built without `hangs` (`petview.tsx`'s `run`): add
`hangs: false,` there for now (Task 5 wires it). Exit 0.

**Step 5: Commit**

```bash
git commit -m "feat(pet): Spider-Man's app-bar pastime — up, crawl, hang, down — and the app bar as his ceiling (pure)" -- frontend/app/view/jarvis/petwalk.ts frontend/app/view/jarvis/petwalk.test.ts frontend/app/view/jarvis/petledge.ts frontend/app/view/jarvis/petledge.test.ts frontend/app/view/jarvis/petview.tsx
```

---

### Task 5: Draw the web on the footer and the app bar

**Depends on:** Task 1, Task 3, Task 4

**Files:** `frontend/app/view/jarvis/petview.tsx`, `frontend/app/view/jarvis/petteleportsvg.tsx`, `frontend/app/view/jarvis/workingdots.tsx`, `frontend/app/cockpit/app-bar.tsx`

Views over the pure modules Tasks 1, 3 and 4 tested (no render tests, by repo rule); Task 7's CDP steps show them.
Read `petview.tsx` whole first; line numbers below are from before this plan.

**Step 1: The ceiling.** `app-bar.tsx`: add `data-pet-ceiling` to the root `<div data-app-bar …>`. `petview.tsx`, beside
`readLedge`:

```ts
// the app bar Spider-Man hangs from (petledge.ts measureCeiling), absent in Float and folded
function readCeiling(): number | null {
    return measureCeiling(Array.from(document.querySelectorAll("[data-pet-ceiling]"), (e) => e.getBoundingClientRect()));
}
```

`PetFrame` gains `ceiling: number | null`, set in `run`.

**Step 2: Who he is, read by the walker.** Move `const character = petCharacter(useAtomValue(petCharacterAtom));` up
beside `teleport` (~line 346) and add it to `liveRef`. Add `const hangCutRef = useRef(false);`. In `run`:
`hangs: live.character === "spidey" && ceiling != null && !live.reduce && !hangCutRef.current,` and after
`stepWalker`, `if (step.hang == null) { hangCutRef.current = false; }`. The effect that re-runs the walker when its
live inputs change also depends on `character`. In `onHoverStart`, before `touch()`:
`if (frame?.step.hang != null) { hangCutRef.current = true; }`.

**Step 3: Up, along and down the bar.** Module constants:

```ts
// Spider-Man under the app bar: the strand between the bar and his boots while he hangs
const HANG_STRAND_PX = 4 * PET_CELL_PX;
// the strand's column: his raised hand in dangle, his boots in the hang
const HAND_LEFT_PX = 12 * PET_CELL_PX;
const BOOTS_LEFT_PX = 8 * PET_CELL_PX;
```

Motion values: `hangY` (px above his ledge spot), `hangBase` (`ledge.top - PET_PX - ceiling`, set each frame) and
`hangStrand = useTransform([hangY, hangBase], ([y, base]: number[]) => Math.max(0, base + y))`. On the root
`motion.div`'s `style`, `marginTop: hangY` (the hit box goes up with him, so a hover on him cuts the hang). An effect on
the phase:

- `up`: `animate(hangY, -(frame.ledge.top - PET_PX - frame.ceiling), { duration: HANG_UP_MS / 1000, ease: "easeOut" })`
  — to the bar's underside;
- `crawl`: `hangY.set` to the same (he is at the bar);
- `hang`: `animate(hangY, -(…) + HANG_STRAND_PX, { duration: 0.15, ease: "easeOut" })` — drops a few cells on the strand;
- `down`, or null after a phase: `animate(hangY, 0, { duration: HANG_DOWN_MS / 1000, ease: "easeOut" })`.

Stop it on unmount beside `slideAnimRef`.

What he is drawn as: `up`/`down` the walker's `dangle`; `crawl`
`spriteOfRows(SPIDEY_CRAWL[Math.round(step.x / STEP_PX) % 2], marks)`; `hang` `spriteOfRows(SPIDEY_HANG, marks)`.
The body is still mirrored by `step.flip`. The strand, inside the `motion.div` after the svg:

```tsx
            {step.hang != null && step.hang !== "crawl" && frame.ceiling != null ? (
                // from the app bar to his boots (hanging) or his raised hand (going up, coming down)
                <motion.span
                    aria-hidden
                    data-pet-strand
                    className="pointer-events-none absolute bottom-full w-[3px] bg-spidey-web"
                    style={{ left: step.hang === "hang" ? BOOTS_LEFT_PX : HAND_LEFT_PX, height: hangStrand }}
                />
            ) : null}
```

(With `step.flip`, mirror the column: `PET_PX - PET_CELL_PX - left`.)

**Step 4: Held by a strand, and the rappel** (Spider-Man, not under reduced motion):

```ts
    // held, he hangs this far under the pointer on a strand, and rappels down one when let go
    const dropY = useMotionValue(0);
    // dragY where the strand is stuck: the pointer while held, the release point while he rappels
    const releaseY = useMotionValue(0);
    const svgY = useTransform([ledgeY, dropY], ([a, b]: number[]) => a + b);
    const strandTop = useTransform([releaseY, dragY], ([r, y]: number[]) => r - y);
    const strandH = useTransform([releaseY, dragY, dropY], ([r, y, d]: number[]) => Math.max(0, y - r + d));
```

- The svg's `style` uses `y: svgY` in place of `y: ledgeY`.
- `onDragStart`: `releaseY.set(dragY.get()); animate(dropY, DRAG_DROP_PX, { duration: 0.12, ease: "easeOut" });` with
  `const DRAG_DROP_PX = 4 * PET_CELL_PX;`. A new `onDrag`: `releaseY.set(dragY.get())`.
- `onDragEnd`: `const way = reduce ? null : (character === "spidey" ? webLanding : landing)(dragY.get());`, and
  `releaseY.set(dragY.get())` before the fall starts; `land()` also does `dropY.set(0)`.
- While `character === "spidey" && draggingNowRef.current`:

```tsx
                <motion.span
                    aria-hidden
                    data-pet-strand
                    className="pointer-events-none absolute top-0 w-[3px] bg-spidey-web"
                    style={{ left: HAND_LEFT_PX, y: strandTop, height: strandH }}
                />
```

**Step 5: The web-swing.** `petteleportsvg.tsx`: rename the current `PetTeleportLayers` body to `BeamLayers`; add

```tsx
// at: a fixed ms into the run in place of its clock — the DEV contract's force({ swing }) (petview.tsx), so a CDP step
// can show the swing mid-fold
type LayerProps = { run: TeleportRun; sprite: PetSprite; cellPx: number; flip?: boolean; at?: number };

// Spider-Man's teleport (petwebswing.ts): the strand, and the swing's body moved along it
function WebSwingLayers({ run, cellPx, flip, at }: LayerProps) {
    const clock = useTeleportClock(run);
    const t = at ?? clock;
    if (run.kind === "gone") {
        return null;
    }
    const f = webSwingFrame(run.kind, t);
    const px = PET_GRID * cellPx;
    const body = spriteOfRows(SPIDEY_SWING, []).body;
    const cell = (c: PetCell, i: number) => (
        <rect key={i} x={c.x * cellPx} y={c.y * cellPx} width={cellPx} height={cellPx} fill={`var(${c.token})`} />
    );
    return (
        <>
            {f.strand.map((c, i) => (
                <rect key={`web${i}`} x={c.x * cellPx} y={c.y * cellPx} width={cellPx} height={cellPx} fill={`var(${WEB_TOKEN})`} />
            ))}
            <g opacity={f.pet.opacity} transform={`translate(${f.pet.dx * cellPx} ${f.pet.dy * cellPx})`}>
                <g transform={flip ? `matrix(-1 0 0 1 ${px} 0)` : undefined}>{body.map(cell)}</g>
            </g>
        </>
    );
}

// character is optional, Sprout's beam by default, so a caller this task does not touch (sprout-mini.tsx) still compiles
export function PetTeleportLayers({ character = "sprout", ...props }: LayerProps & { character?: PetCharacter }) {
    return character === "spidey" ? <WebSwingLayers {...props} /> : <BeamLayers {...props} />;
}
```

`PetTeleportSvg` takes an optional `character` (default `"sprout"`) and passes it. `petview.tsx` passes `character`
to `PetTeleportLayers`. Leave `sprout-mini.tsx` alone: Task 6 passes it there.

**Step 6: The working web.** `workingdots.tsx`: `character?: PetCharacter` (default `"sprout"`); for `"spidey"` draw this
in place of the three dots:

```tsx
// Spider-Man's working mark: a 12px web whose three rings light in turn, as the dots do; still under reduced motion
function WorkingWeb({ reduce }: { reduce: boolean }) {
    return (
        <svg data-working-web width={12} height={12} viewBox="0 0 12 12" aria-hidden className="block">
            {[
                [6, 0, 6, 12],
                [0, 6, 12, 6],
                [1.8, 1.8, 10.2, 10.2],
                [1.8, 10.2, 10.2, 1.8],
            ].map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-spidey-web)" strokeWidth={0.75} />
            ))}
            {[1.8, 3.6, 5.4].map((r, i) => (
                <motion.circle
                    key={r}
                    cx={6}
                    cy={6}
                    r={r}
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth={0.9}
                    animate={reduce ? undefined : { opacity: [0.3, 1, 0.3] }}
                    transition={reduce ? undefined : { duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
            ))}
        </svg>
    );
}
```

`petview.tsx` passes `character` (~line 707). The footer draws it where it draws the dots today: in Float, while agents
work.

**Step 7: The DEV contract and its forces.** `__jarvisPet` gains `character`, `flip: frame.step.flip`, `hang:
frame.step.hang`, `ceiling: frame.ceiling`; the `<g>` that mirrors the body by `step.flip` (~line 694) gets
`data-pet-body`, so a CDP step reads the body's cells apart from the unmirrored marks. `PetForce` gains three DEV-only shows, each a one-shot or a hold that
`force(null)` lifts like the rest:

- `hang?: boolean` — start the app-bar pastime now (Spider-Man under an app bar only): in `force`, when `o?.hang` and
  `liveRef.current.character === "spidey"`, set `walkerRef.current = startHang(walkerRef.current ?? <the walker run()
  would boot>, <the input run() builds>, Date.now(), Math.random)` before `touch()`.
- `rest?: (typeof REST_POSES)[number]` (`"stand" | "sit" | "read" | "music" | "work" | "ball"`) — rest now in that pose (any character): in
  `force`, when `o?.rest`, set `walkerRef.current = restIn(walkerRef.current ?? <the boot walker>, o.rest, Date.now())`
  (Task 4's `restIn`) before `touch()`. The pastime's frames alternate as in any rest.
- `swing?: { kind: "depart" | "arrive"; t: number }` — while held, draw `PetTeleportLayers` in place of the cells as a
  teleport does, with `run = { kind: o.swing.kind, at: performance.now() }` (a `TeleportRun`, as `teleportstore.ts` builds one)
  and `at={o.swing.t}`, so the web-swing holds still at that ms. Spider-Man only; ignored for the others.

**Step 8: Check.** `task check:ts` — exit 0. `npx vitest run frontend/app/view/jarvis/ frontend/app/cockpit/` — PASS.
What it draws is shown by Task 7's CDP steps 15–22 (the suit side-on and every pose, the strand and rappel, the hang, the swing, the working web).

**Step 9: Commit**

```bash
git commit -m "feat(pet): Spider-Man crawls and hangs under the app bar, dangles and rappels on a strand, web-swings to fold, and spins a working web" -- frontend/app/view/jarvis/petview.tsx frontend/app/view/jarvis/petteleportsvg.tsx frontend/app/view/jarvis/workingdots.tsx frontend/app/cockpit/app-bar.tsx
```

---

### Task 6: Folded: the rooftop

**Depends on:** Task 5

**Files:** `frontend/app/view/jarvis/petmini.ts`, `frontend/app/view/jarvis/petmini.test.ts`, `frontend/app/cockpit/sprout-mini.tsx`

**Step 1: Failing test** — append to `petmini.test.ts` (import `spideyFoldLook`; build a `MiniLook` with the file's
existing helpers, or with `miniLook({...})`):

```ts
describe("spideyFoldLook", () => {
    const base = miniLook({ posture: "none", waiting: 0, working: 0, errand: null, unread: false, chatOpen: false, frame: 0 });

    it("lights a window per working agent, four at most", () => {
        expect(spideyFoldLook({ ...base, working: null }, 0).lit).toBe(0);
        expect(spideyFoldLook({ ...base, working: 3 }, 0).lit).toBe(3);
        expect(spideyFoldLook({ ...base, working: 9 }, 0).lit).toBe(4);
    });

    it("feels it, spider-sense, when something waits: a posture or the waiting chip", () => {
        expect(spideyFoldLook(base, 0).sense).toBe(false);
        expect(spideyFoldLook({ ...base, chip: 2 }, 0).sense).toBe(true);
        expect(spideyFoldLook({ ...base, marks: ["escalation"] }, 0).sense).toBe(true);
        expect(spideyFoldLook({ ...base, marks: ["unread"] }, 0).sense).toBe(false);
    });

    it("swings his legs on the bob's second frame, and holds still while sensing", () => {
        expect(spideyFoldLook(base, 0).swing).toBe(false);
        expect(spideyFoldLook(base, 1).swing).toBe(true);
        expect(spideyFoldLook({ ...base, chip: 1 }, 1).swing).toBe(false);
    });

    it("keeps the unread mark, and shows thinking while Jarvis types", () => {
        expect(spideyFoldLook({ ...base, marks: ["unread"] }, 0).unread).toBe(true);
        expect(spideyFoldLook({ ...base, pose: "work1" }, 0).thinking).toBe(true);
        expect(spideyFoldLook(base, 0).thinking).toBe(false);
    });
});
```

Run `npx vitest run frontend/app/view/jarvis/petmini.test.ts` — FAIL.

**Step 2: The look** — `petmini.ts`:

```ts
// What Spider-Man's rooftop shows for a fold look: lit windows for the working agents, spider-sense for what waits,
// swinging legs on the bob's beat, the unread mark, and the working web while Jarvis types.
export interface SpideyFoldLook {
    lit: number;
    sense: boolean;
    swing: boolean;
    unread: boolean;
    thinking: boolean;
}

const WAITING_MARKS: readonly PetMark[] = ["gate", "escalation", "blocked"];

export function spideyFoldLook(look: MiniLook, frame: 0 | 1): SpideyFoldLook {
    const sense = look.chip != null || look.marks.some((m) => WAITING_MARKS.includes(m));
    return {
        lit: Math.min(look.working ?? 0, 4),
        sense,
        swing: frame === 1 && !sense,
        unread: look.marks.includes("unread"),
        thinking: look.pose === "work1" || look.pose === "work2",
    };
}
```

**Step 3: The scene** — `sprout-mini.tsx`, where it draws `SproutSvg` (~line 219): for `character === "spidey"` (and no
teleport playing) draw the rooftop instead, centred in the 64px box (`MINI_SPROUT_BOX` unchanged):

```tsx
// Spider-Man folded: the rooftop scene, 20x20 cells, in the same box as Sprout's 16x16
function SpideyRoof({ look, frame }: { look: MiniLook; frame: 0 | 1 }) {
    const f = spideyFoldLook(look, frame);
    const rows = spideyFold(f.lit, f.swing);
    const px = 20 * PET_CELL_PX;
    const cells = spriteOfRows(rows, f.unread ? ["unread"] : []);
    const cell = (c: PetCell, i: number) => (
        <rect key={i} x={c.x * PET_CELL_PX} y={c.y * PET_CELL_PX} width={PET_CELL_PX} height={PET_CELL_PX} fill={`var(${c.token})`} />
    );
    return (
        <svg data-spidey-roof width={px} height={px} viewBox={`0 0 ${px} ${px}`} shapeRendering="crispEdges" aria-hidden className="block">
            {cells.body.map(cell)}
            {cells.overlay.map(cell)}
            {f.sense ? SPIDEY_SENSE.map(({ x, y }, i) => cell({ x, y, token: "--color-asking" }, 1000 + i)) : null}
        </svg>
    );
}
```

- No `-translate-y-1` bob for Spider-Man (`look.bob && character !== "spidey"`): his legs swing instead.
- The working dots are not drawn for him when folded (the windows carry the count); while `thinking`, draw
  `<WorkingDots count={…} character="spidey" />` where the dots go today.
- Teleport: `PetTeleportSvg` gets `character` (Task 5 added the optional prop).
- **The waiting chip at the right** (spec §4): the chip span gets `data-mini-chip`, and for Spider-Man it sits at
  `right-0 top-3` in place of `left-1 top-3` (Sprout and the Minion keep the left). The working web, while thinking,
  stays at `right-0 top-0`, above it.

**Step 4: The DEV contract.** Beside `petview.tsx`'s `__jarvisPet`, and like it only under `import.meta.env.DEV`
(deleted on unmount), `sprout-mini.tsx` keeps `window.__jarvisMini` current:

```ts
// the DEV contract's override: replaces those fold-look inputs until force(null), so a CDP step can light windows and
// raise spider-sense without arranging working agents or an attention item
type MiniForce = { working?: number | null; waiting?: number; posture?: PetPosture; thinking?: boolean };
```

- `const [forced, setForced] = useState<MiniForce | null>(null);` — `miniLook` is fed `forced?.posture ??
  postureFor(signals)`, `forced?.waiting ?? waiting`, `forced?.working !== undefined ? forced.working : working`; for
  Spider-Man, `forced?.thinking` (when set) replaces `spideyFoldLook(...).thinking`.
- `window.__jarvisMini = { character, chip: look.chip ?? null, roof: character === "spidey" ? spideyFoldLook(look,
  frame) : null, force: setForced }`.

**Step 5: Check.** `npx vitest run frontend/app/view/jarvis/ frontend/app/cockpit/` — PASS; `task check:ts` — exit 0.
What it draws is shown by Task 7's CDP step 22 (the rooftop, its windows, spider-sense, the legs, the chip at the
right, the working web).

**Step 6: Commit**

```bash
git commit -m "feat(pet): folded, Spider-Man sits on a rooftop — lit windows for working agents, spider-sense for what waits" -- frontend/app/view/jarvis/petmini.ts frontend/app/view/jarvis/petmini.test.ts frontend/app/cockpit/sprout-mini.tsx
```

---

### Task 7: CDP steps, docs and changelog

**Depends on:** Task 2, Task 6

**Files:** `scripts/cdp/scenarios.mjs`, `docs/guide/settings.md`, `CHANGELOG.md`, `docs/open-issues.md`

**Step 1: The CDP steps.** In `jarvisPet`, after step 14 (the Minion, ~line 6872–6902), following its pattern: a real
click via `spOpen`/`spClick` for a setting, then `window.__jarvisPet` (`petForce`, `petWait`, `petSamples`,
`petDragHold`/`petRelease`) for the creature, `petShot`/`petZoom` for each shot. Every step below takes at least one
shot, and every check reads the page (rects, boxes) as well as the contract, as steps 1–14 do.

Arrange and teardown: add `prevTheme: await h.ev('localStorage.getItem("cockpit.theme.preset")')` to the arrange's
`ctx` and restore it in teardown beside `prevCharacter` (remove the key when it was null). Teardown also calls
`window.__jarvisPet?.force(null)` and `window.__jarvisMini?.force(null)`, and, if `[data-sprout-mini]` is still
there, restores the window the way step 22's restore does.

New helpers beside `PET_UNREAD_DRAWN`:

- `PET_CELLS` — the body's rects as `[cx, cy, fill]` in cells, measured from each rect's box against the svg's box (so
  a mirror transform is measured, not assumed). Only the rects under `[data-pet-body]` (the `<g>` that `step.flip` mirrors, Task 5
  Step 7), so the unmirrored marks (step 7 leaves unread on) stay out; `petMirror(cells)` maps `cx` to `15 - cx`; `petDiff(a, b)` is
  the count of cells in one set and not the other.
- `PET_STRAND` — every `[data-pet-strand]`'s box (`left`, `right`, `top`, `bottom`), or `[]`.
- `petFillCount(selector, token)` — an expression: how many rects under `selector` fill `var(token)`.

Steps (shots named `jarvis-pet-<n>-…`):

- **15. Spider-Man:** Character → "Spider-Man"; `__jarvisPet.character === "spidey"`, its `tokens` include
  `var(--color-spidey-red)` and `var(--color-spidey-blue)` and not `var(--color-accent)`, tokens equal the drawn fills,
  and he stands on the ledge (as step 14 checks). Shot `jarvis-pet-15-spidey`.
- **16. Walking side-on, both ways:** sample walks (as step 3, but up to 90 s) until one sample with `flip === false`
  and one with `flip === true` are seen in the same pose (`walk1` or `walk2`), recording `PET_CELLS` with each. Assert:
  both `walk1` and `walk2` showed; the `flip === false` sample's cells differ from their own mirror in ≥ 6 cells
  (side-on, not front-on); and the `flip === true` sample's cells equal the mirror of the `flip === false` one
  (`petDiff === 0`). `petZoom` `jarvis-pet-16-walk-right` and `jarvis-pet-16-walk-left`.
- **17. The thwip:** `petForce({ ...PET_CALM, speaking: true })`; poll until `pose === "speak"`; assert the drawn
  fills include `var(--color-spidey-web)` with ≥ 3 such rects (the speak grid's `x` strand) and still the suit's red.
  `petZoom` `jarvis-pet-17-thwip`.
- **18. Every other pose, the suit on the job and Peter at rest:** through force, each followed by a poll and a
  `petZoom` `jarvis-pet-18-<pose>`:
  - suit (fills include `var(--color-spidey-red)`, none `var(--color-peter-hair)`): `tired` (`expression: "tired"`, as
    step 5), `work` (`rest: "work"` → `work1` or `work2`), `sit` (`rest: "sit"`); `dangle` is step 19's;
  - Peter (fills include `var(--color-peter-hair)`): `sleep` (`idle: true`, ≤ 40 s as step 5), `read`, `music`, `ball`
    (`rest: "<name>"` → `<name>1` or `<name>2`).
  `force(null)` after.
- **19. Held on a strand, and the rappel:** a real drag as step 6 does (`petDragHold`). While held: `pose ===
  "dangle"`; exactly one `PET_STRAND` box; its top within 4 px of the pointer's y, its bottom within 4 px of the
  sprite's top, and its x inside the sprite's left..right. Shot `jarvis-pet-19-strand`. Then start an in-page sampler
  (every 30 ms for 1.5 s: `state`, the sprite's top, `PET_STRAND`) without awaiting it, release (`petRelease`), take
  shot `jarvis-pet-19-rappel` at once, and await the samples. Assert: among the samples after the release, at least two
  are still `state === "dragged"` with a strand whose bottom is within 4 px of the sprite's top, the sprite's top grows
  across them (he goes down the strand), and the last sample rests on the ledge (`petOnLedge`) with no strand left.
- **20. Under the app bar:** `petForce({ ...PET_CALM, hang: true })`; poll (≤ 1.5 s) until `__jarvisPet.hang ===
  "crawl"`, assert the sprite box's top is within 2 px of `__jarvisPet.ceiling` and no strand is drawn, shot
  `jarvis-pet-20-crawl`; poll (≤ 4 s) until `hang === "hang"`: the box's top is below the ceiling by 6–24 px, one
  `PET_STRAND` box runs from the ceiling (top within 2 px) to the sprite's top (bottom within 2 px), and he is upside
  down (the `var(--color-spidey-eye)` rects sit in the sprite's lower half), shot `jarvis-pet-20-hang`; move the mouse
  onto the sprite and poll (≤ 1.5 s) until `hang === null`. `force(null)` after.
- **21. The web-swing, held mid-fold:** for each `kind` of `"depart"` and `"arrive"`, `petForce({ ...PET_CALM, swing:
  { kind, t: 240 } })` and poll until the sprite's svg draws ≥ 5 rects in `var(--color-spidey-web)`; assert those
  rects form one strand (sorted along it, each cell touching the last, measured from their boxes) and the body's
  `var(--color-spidey-red)` rects are drawn too. `petZoom` `jarvis-pet-21-swing-<kind>`. `force(null)` after.
- **22. Folded: the rooftop.** Fold with the app bar's button as the `jarvis-modes` scenario does (`scenarios.mjs`
  ~30116–30118: click `[data-app-sprout]`, then `floatMiniWait(h, '!!document.querySelector("[data-sprout-mini]")')`,
  then wait 900 ms). Before the click, start an in-page sampler (every 20 ms for 1.5 s) of `petFillCount` for
  `--color-spidey-web` in the footer sprite's svg and in `[data-sprout-mini] svg`, and assert after it that the real
  fold drew the web (a count above 0 in either). Then, on `window.__jarvisMini` (Task 6 Step 4):
  - `__jarvisMini.character === "spidey"`, `[data-spidey-roof]` is 60×60 and draws `var(--color-city-brick)`. Shot
    `jarvis-pet-22-rooftop`.
  - Legs: `__jarvisMini.force({ working: 0, waiting: 0, posture: "none" })`; sample `[data-spidey-roof]`'s rects every
    150 ms for 2 s: `__jarvisMini.roof.swing` is seen both true and false, and the rect sets of the two differ.
  - Lit windows: `force({ working: 3, waiting: 0, posture: "none" })` → 12 rects in `var(--color-city-window-lit)` (3
    windows of 2×2) and `roof.lit === 3`; `working: 9` → 16 and `lit === 4`; `working: null` → 0. Shot
    `jarvis-pet-22-windows` at 3.
  - Spider-sense: `force({ working: 0, waiting: 0, posture: "escalation" })` → 8 rects in `var(--color-asking)`
    (`SPIDEY_SENSE`), `roof.sense === true`; `force({ working: 0, waiting: 2, posture: "none" })` → still 8, the
    `[data-mini-chip]` reads `2` and its box's left is right of the roof's horizontal centre (the chip at the right);
    `waiting: 0, posture: "none"` → 0 asking rects. Shot `jarvis-pet-22-sense` with the chip showing.
  - The working web: `force({ working: 0, waiting: 0, posture: "none", thinking: true })` → `[data-sprout-mini]
    [data-working-web]` is drawn. Shot `jarvis-pet-22-thinking`.
  - `force(null)`; restore as `jarvis-modes` step 4 does (~30138–30139: dblclick `[data-mini-hit="sprout"] button`, wait
    until `[data-sprout-mini]` is gone and `[data-app-bar]` shows), and assert it.
- **23. The Spider theme:** Settings → Appearance → Theme → "Spider"; assert
  `getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() === "#f05252"` and
  `--color-background` still `#1f1e1d`; shot `jarvis-pet-23-spider-theme`.

In Float the working web stands in for the footer's dots; that is not its own step (Float needs a floated terminal the
scenario does not arrange), and step 22's thinking check draws the same `WorkingWeb`.

Run against the running dev app when one is up: `task verify:ui -- jarvis-pet` — PASS; otherwise Final runs it.

**Step 2: Docs.** `docs/guide/settings.md` (Vietnamese, as the page is):
- the Theme row (~line 89): `… One Dark, Monokai, Spider (bảng màu Claude với accent đỏ).`
- the Character row (~line 93): `**Sprout** (mặc định), **Minion** hoặc **Spider-Man**: con vật đi trên footer, con
  Sprout thu nhỏ của Float và dấu trên thanh Float đều vẽ theo nhân vật này. Dấu và trang phục giống nhau cho cả ba.
  Spider-Man mặc bộ Homecoming khi làm việc và là Peter Parker khi rảnh; đi nghiêng trên footer, bắn tơ khi nói, treo trên
  tơ khi bị kéo, thỉnh thoảng bò ngược và treo dưới app bar (rê chuột vào là xuống), và ngồi trên nóc nhà khi gập cửa sổ.`

**Step 3: Changelog** — top `## Unreleased` → `### Added`:

```markdown
- Spider-Man as a third Jarvis character (Settings → Appearance → Character): the Homecoming suit at work, Peter Parker at rest. He walks the footer side-on, thwips when he speaks, hangs from a strand when you drag him and rappels down when you let go, now and then crawls along under the app bar and hangs upside down until your cursor comes near, web-swings out and back when the window folds, and folded sits on a rooftop whose windows light up for each running agent.
- A Spider theme (Settings → Appearance → Theme): Claude's colours with a Spider-Man red accent.
```

**Step 4: Hand check** (extra, beside CDP steps 15–23, for the eye on motion a still shot cannot judge) — under "0 · Waiting on a hand check" in `docs/open-issues.md`:

```markdown
- [ ] (arcterm) Spider-Man pet: drag and rappel, the crawl and hang under the app bar (hover cuts it), the web-swing on fold and unfold, the rooftop's windows and spider-sense, and the Spider theme — look in the running app.
```

**Step 5: Commit**

```bash
git commit -m "test(cdp),docs: Spider-Man pet and Spider theme — jarvis-pet steps, settings guide, changelog" -- scripts/cdp/scenarios.mjs docs/guide/settings.md CHANGELOG.md docs/open-issues.md
```
