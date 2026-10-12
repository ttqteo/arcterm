# Spider-Man pet and Spider theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A third Jarvis creature, Spider-Man (Peter Parker at rest, the suit at work), with spider-web versions of the
pet's drag, fall, teleport and working dots and a pastime of hanging upside down from the app bar; and a navy + red
Spider theme preset. Specified in `docs/superpowers/specs/2026-10-12-spiderman-pet-design.md` (the spec; read it before
any task).

**Architecture:** The character is data: one 16×16 grid per pose in `petsprite.ts` (`SPIDEY_POSES`), drawn in new
`--color-spidey-*` / `--color-peter-*` identity tokens. Every web effect is a pure module beside a test
(`petfall.ts webLanding`, `petwebswing.ts`, `petwalk.ts`'s `hang` rest, `petledge.ts measureCeiling`,
`petsprite.ts upsideDown`), and the views (`petview.tsx`, `petteleportsvg.tsx`, `workingdots.tsx`, `sprout-mini.tsx`,
`app-bar.tsx`) only draw what they return. The theme is one more `THEMES` entry. Sprout and the Minion are untouched.

**Tech Stack:** React 19, motion/react, jotai, Tailwind 4 (`@theme` tokens only, never raw hex in components), vitest,
CDP (`scripts/cdp/scenarios.mjs`).

**Verify:** `node scripts/verify.mjs ./pkg/wconfig`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: jarvis-pet needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs jarvis-pet`

Notes for every task:

- No Go changes: Verify names `./pkg/wconfig` only because `scripts/verify.mjs` needs a pattern; it runs the vitest
  suite for the changed frontend files.
- Run single test files with `npx vitest run <file>`. Typecheck with `task check:ts` (~2 min, give it a 5-minute
  timeout; never `npx tsc`). In a worktree call tsc directly:
  `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`.
- Commit with a pathspec (`git commit -m "…" -- <paths>`, after `git add` for new files). No `Co-Authored-By` trailer.
- Executed inline on `main` (not the engine): `CHANGELOG.md` and `docs/guide/settings.md` already carry the person's
  uncommitted edits, so in Task 6 stage only this plan's hunks (`git add -p`) and commit without a pathspec for those
  two; never `git commit -- CHANGELOG.md`. And don't run Final's build: check against the running dev app with
  `task verify:ui -- jarvis-pet`.

---

### Task 1: Spider-Man, the character

**Depends on:** none

**Files:**
- Modify: `frontend/tailwindsetup.css` (after the `--color-minion-*` block, ~line 106)
- Modify: `frontend/app/view/jarvis/petsprite.ts`
- Modify: `frontend/app/view/jarvis/petcharacter.ts`
- Modify: `frontend/app/view/agents/settingspages/appearance.tsx:142`
- Modify: `frontend/app/view/agents/settingsmodel.ts:279`
- Modify: `frontend/app/cockpit/app-bar.tsx:42-45`
- Test: `frontend/app/view/jarvis/petsprite.test.ts`, `frontend/app/view/jarvis/petcharacter.test.ts`

**Step 1: Write the failing tests**

In `petcharacter.test.ts`, replace the `it.each(["sprout", "minion"] as const)` list with
`["sprout", "minion", "spidey"] as const`, and the `PET_CHARACTER_NAME` expectation with
`{ sprout: "Sprout", minion: "Minion", spidey: "Spider-Man" }`. Add `"Spider-Man"` to the fall-back list (a label, not
an id).

In `petsprite.test.ts`:

1. Import `SPIDEY_LOOK` and `SPIDEY_POSES` from `./petsprite`.
2. In `"maps exactly the eight codes of the spec, the flag's two, and the Minion's five"`, rename it to
   `"... the Minion's five, and Spider-Man's eight"` and add to the expected object:

```ts
            S: "--color-spidey-red",
            D: "--color-spidey-red-dark",
            B: "--color-spidey-blue",
            e: "--color-spidey-eye",
            p: "--color-peter-skin",
            H: "--color-peter-hair",
            g: "--color-peter-glasses",
            v: "--color-peter-sweater",
```

3. Append, after `describe("the Minion's flag shirt", …)`:

```ts
describe("Spider-Man", () => {
    it("has every pose Sprout has, so the walker can name any of them", () => {
        expect(Object.keys(SPIDEY_POSES).sort()).toEqual([...POSE_NAMES].sort());
        expect(Object.keys(SPIDEY_LOOK).sort()).toEqual([...POSE_NAMES].sort());
    });

    it.each(POSE_NAMES)("%s is 16 rows of 16 cells and stands on the bottom row", (pose) => {
        expect(SPIDEY_POSES[pose]).toHaveLength(PET_GRID);
        for (const row of SPIDEY_POSES[pose]) {
            expect(row).toHaveLength(PET_GRID);
        }
        expect(SPIDEY_POSES[pose][PET_GRID - 1]).not.toBe(".".repeat(PET_GRID));
    });

    it.each(POSE_NAMES)("%s draws only codes PET_TOKENS knows", (pose) => {
        for (const row of SPIDEY_POSES[pose]) {
            for (const code of row) {
                expect(code === "." || code in PET_TOKENS, code).toBe(true);
            }
        }
    });

    // the suit is red with no hair showing; Peter has his hair and no suit red
    it.each(POSE_NAMES)("%s is drawn in the look SPIDEY_LOOK names", (pose) => {
        const rows = SPIDEY_POSES[pose].join("");
        if (SPIDEY_LOOK[pose] === "suit") {
            expect(rows).toContain("S");
            expect(rows).not.toContain("H");
        } else {
            expect(rows).toContain("H");
            expect(rows).not.toContain("S");
        }
    });

    it("is the suit while it works and Peter Parker at rest", () => {
        expect(SPIDEY_LOOK.walk1).toBe("suit");
        expect(SPIDEY_LOOK.dangle).toBe("suit");
        expect(SPIDEY_LOOK.work1).toBe("suit");
        expect(SPIDEY_LOOK.sit).toBe("peter");
        expect(SPIDEY_LOOK.sleep).toBe("peter");
        expect(SPIDEY_LOOK.read1).toBe("peter");
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
            const code = SPIDEY_POSES[pose][cell.y][cell.x];
            expect(cell.token).toBe(PET_TOKENS[code as keyof typeof PET_TOKENS]);
        }
    });

    it("wears its own red and blue, not the accent", () => {
        const tokens = new Set(spriteFor("stand", [], null, "spidey").body.map((c) => c.token));
        expect(tokens.has("--color-spidey-red")).toBe(true);
        expect(tokens.has("--color-spidey-blue")).toBe(true);
        expect(tokens.has("--color-accent")).toBe(false);
    });

    it.each(POSE_NAMES)("holds Sprout's flag behind %s, and leaves its body and marks alone", (pose) => {
        const bare = spriteFor(pose, ["unread"], null, "spidey");
        const flagged = spriteFor(pose, ["unread"], "vn-flag", "spidey");
        expect(flagged.back).toEqual(spriteFor("stand", [], "vn-flag").back);
        expect(flagged.body).toEqual(bare.body);
        expect(flagged.overlay).toEqual(bare.overlay);
    });
});

describe("Spider-Man's flag shirt", () => {
    const dressed = (pose: PetPose) => outfitRows(pose, "vn-shirt", "spidey");
    const suit = POSE_NAMES.filter((pose) => SPIDEY_LOOK[pose] === "suit");
    const peter = POSE_NAMES.filter((pose) => SPIDEY_LOOK[pose] === "peter");

    it.each(suit)("leaves the suit of %s as it is", (pose) => {
        expect(dressed(pose)).toBe(SPIDEY_POSES[pose]);
    });

    it.each(peter)("recolours only Peter's sweater on %s", (pose) => {
        const bare = SPIDEY_POSES[pose];
        dressed(pose).forEach((row, y) => {
            [...row].forEach((code, x) => {
                const was = bare[y][x];
                if (was === "v") {
                    expect(["R", "Y"], `${x},${y}`).toContain(code);
                } else {
                    expect(code, `${x},${y}`).toBe(was);
                }
            });
        });
    });

    // three rows of sweater hold the 5×3 star; reading, the book covers its legs
    it.each(["sit", "sleep", "music1", "music2", "ball1", "ball2"] as PetPose[])("draws the whole star on %s", (pose) => {
        expect(cellsOf(dressed(pose), "Y")).toHaveLength(8);
    });

    it("leaves a pose bare without the shirt, the flag included", () => {
        for (const pose of POSE_NAMES) {
            expect(outfitRows(pose, null, "spidey")).toBe(SPIDEY_POSES[pose]);
            expect(outfitRows(pose, "vn-flag", "spidey")).toBe(SPIDEY_POSES[pose]);
        }
    });
});
```

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/jarvis/petsprite.test.ts frontend/app/view/jarvis/petcharacter.test.ts`
Expected: FAIL — `SPIDEY_POSES` is not exported, `"spidey"` falls back to Sprout.

**Step 3: The tokens**

In `frontend/tailwindsetup.css`, after `--color-minion-hair: #4a4a4a;`:

```css

    /* The Jarvis pet's Spider-Man (petsprite.ts SPIDEY_POSES): the suit's red and blue, the mask's eyes, Peter Parker's
       skin, hair, glasses and sweater, and the web it spins (petwebswing.ts, the strands in petview.tsx) are the
       character itself, identity, never theme-derived */
    --color-spidey-red: #d6262e;
    --color-spidey-red-dark: #8f1219;
    --color-spidey-blue: #2557b8;
    --color-spidey-eye: #f4f6fb;
    --color-spidey-web: #c9ced8;
    --color-peter-skin: #f0c19b;
    --color-peter-hair: #5a3a22;
    --color-peter-glasses: #3a3a40;
    --color-peter-sweater: #5f8a5a;
```

**Step 4: The grids and the outfit**

In `petsprite.ts`:

- Header comment: "every pose of both creatures (Sprout and the Minion)" → "every pose of each creature (Sprout, the
  Minion and Spider-Man)".
- `export type PetCharacter = "sprout" | "minion" | "spidey";` and its comment "Both have every pose" → "Each has every
  pose".
- Add to `PET_TOKENS`, after `s`:

```ts
    S: "--color-spidey-red", // Spider-Man's suit
    D: "--color-spidey-red-dark", // the mask's web seams, the chest spider's legs
    B: "--color-spidey-blue", // the suit's sides, arms and legs; Peter's jeans
    e: "--color-spidey-eye", // the mask's eyes, Peter's lenses
    p: "--color-peter-skin", // Peter Parker
    H: "--color-peter-hair",
    g: "--color-peter-glasses",
    v: "--color-peter-sweater",
```

- After `MINION_POSES` (before the `MARKS` comment), add:

```ts
// Spider-Man: the suit while it walks, stands, speaks, is dragged, tires or works, and Peter Parker at rest (SPIDEY_LOOK
// says which each pose is). The marks' cells are kept clear as Sprout's are.
export const SPIDEY_POSES: Record<PetPose, readonly string[]> = {
    // the suit: web seams down the mask, big white eyes, a small black spider on the chest, red boots
    walk1: [
        E,
        E,
        E,
        ".....SSSSSS.....",
        "....SSSDDSSS....",
        "....SeeDDeeS....",
        "....keeSSeek....",
        "....SSSDDSSS....",
        ".....SSSSSS.....",
        "...BBSSSSSSBB...",
        "...BBSDkkDSBB...",
        "...SBSDkkDSBS...",
        "....BSSSSSSB....",
        "....BBBBBBBB....",
        "...BBB....BBB...",
        "...SS......SS...",
    ],
    walk2: [
        E,
        E,
        E,
        ".....SSSSSS.....",
        "....SSSDDSSS....",
        "....SeeDDeeS....",
        "....keeSSeek....",
        "....SSSDDSSS....",
        ".....SSSSSS.....",
        "...BBSSSSSSBB...",
        "...BBSDkkDSBB...",
        "...SBSDkkDSBS...",
        "....BSSSSSSB....",
        "....BBBBBBBB....",
        ".....BB..BB.....",
        ".....SS..SS.....",
    ],
    stand: [
        E,
        E,
        E,
        ".....SSSSSS.....",
        "....SSSDDSSS....",
        "....SeeDDeeS....",
        "....keeSSeek....",
        "....SSSDDSSS....",
        ".....SSSSSS.....",
        "...BBSSSSSSBB...",
        "...BBSDkkDSBB...",
        "...SBSDkkDSBS...",
        "....BSSSSSSB....",
        "....BBBBBBBB....",
        "....BBB..BBB....",
        "....SSS..SSS....",
    ],
    // Peter Parker at rest: brown hair, glasses, green sweater, jeans, his shoes at his feet
    sit: [
        E,
        E,
        E,
        E,
        ".....HHHHHH.....",
        "....HHHHHHHH....",
        "....HppppppH....",
        "....gekggkeg....",
        "....pppppppp....",
        "....pppkkppp....",
        ".....pppppp.....",
        "...vvvvvvvvvv...",
        "...pvvvvvvvvp...",
        "...vvvvvvvvvv...",
        "...BBBBBBBBBB...",
        "...BBBBBBBBBBss.",
    ],
    sleep: [
        E,
        E,
        E,
        E,
        ".....HHHHHH.....",
        "....HHHHHHHH....",
        "....HppppppH....",
        "....gppggppg....",
        "....pppppppp....",
        "....pppppppp....",
        ".....pppppp.....",
        "...vvvvvvvvvv...",
        "...pvvvvvvvvp...",
        "...vvvvvvvvvv...",
        "...BBBBBBBBBB...",
        "...BBBBBBBBBBss.",
    ],
    tired: [
        E,
        E,
        E,
        ".....SSSSSS.....",
        "....SSSDDSSS....",
        "....SSSDDSSS....",
        "....keeSSeek....",
        "....SSSDDSSS....",
        ".....SSSSSS.....",
        "...BBSSSSSSBB...",
        "...BBSDkkDSBB...",
        "...BBSDkkDSBB...",
        "...SBSSSSSSBS...",
        "....BBBBBBBB....",
        "....BBB..BBB....",
        "....SSS..SSS....",
    ],
    speak: [
        E,
        E,
        E,
        ".....SSSSSS.....",
        "....SSSDDSSS....",
        "....SeeDDeeS....",
        "....keeSSeek....",
        "....SSSkkSSS....",
        ".....SSSSSS.....",
        "...BBSSSSSSBB...",
        "...BBSDkkDSBB...",
        "...SBSDkkDSBS...",
        "....BSSSSSSB....",
        "....BBBBBBBB....",
        "....BBB..BBB....",
        "....SSS..SSS....",
    ],
    // being dragged: hands up on the strand, legs hanging
    dangle: [
        E,
        "...S........S...",
        "...B........B...",
        "...B.SSSSSS.B...",
        "...BSSSDDSSSB...",
        "...BSeeDDeeSB...",
        "....keeSSeek....",
        "....SSSDDSSS....",
        ".....SSSSSS.....",
        "....SSSSSSSS....",
        "....SSDkkDSS....",
        "....SSDkkDSS....",
        "....BSSSSSSB....",
        "....BBBBBBBB....",
        ".....BB..BB.....",
        ".....SS..SS.....",
    ],
    // Pastimes, as Sprout's. Reading: sat with a book on his lap
    read1: [
        E,
        E,
        E,
        E,
        ".....HHHHHH.....",
        "....HHHHHHHH....",
        "....HppppppH....",
        "....gkeggkeg....",
        "....pppppppp....",
        "....pppkkppp....",
        ".....pppppp.....",
        "...vvvvvvvvvv...",
        "...vvvvvvvvvv...",
        "..prwwwwrwwwwrp.",
        "...rmmwwrmmwwr..",
        "...rrrrrrrrrrss.",
    ],
    read2: [
        E,
        E,
        E,
        E,
        ".....HHHHHH.....",
        "....HHHHHHHH....",
        "....HppppppH....",
        "....gekggekg....",
        "....pppppppp....",
        "....pppkkppp....",
        ".....pppppp.....",
        "...vvvvvvvvvv...",
        "...vvvvvvvvvv...",
        "..prwwwwrwwwwrp.",
        "...rwwmmrwwmmr..",
        "...rrrrrrrrrrss.",
    ],
    // listening to music: the headphones' band over his hair, the cups over his ears
    music1: [
        "............yy..",
        "..yy........y...",
        "..y.........y...",
        ".yy..mmmmmmyy...",
        "....mHHHHHHm....",
        "...rrHHHHHHrr...",
        "...rrpppppprr...",
        "...rrekggkerr...",
        "....pppppppp....",
        "....ppkkkkpp....",
        ".....pppppp.....",
        "...vvvvvvvvvv...",
        "...pvvvvvvvvp...",
        "....vvvvvvvv....",
        "....BB....BB....",
        "....ss....ss....",
    ],
    music2: [
        "..yy............",
        "..y..........yy.",
        ".yy..........y..",
        ".....mmmmmm.yy..",
        "....mHHHHHHm....",
        "...rrHHHHHHrr...",
        "...rrpppppprr...",
        "...rrekggkerr...",
        "....pppppppp....",
        "....ppkkkkpp....",
        ".....pppppp.....",
        "...vvvvvvvvvv...",
        "...pvvvvvvvvp...",
        "....vvvvvvvv....",
        ".....BB..BB.....",
        ".....ss..ss.....",
    ],
    // working: Spider-Man at a laptop seen side-on, a key lit as it types and the code mark over its head
    work1: [
        ".......w...w.w..",
        "......w...w...w.",
        ".......w.w...w..",
        E,
        ".....SSSSSS.....",
        "....SSSDDSSS..m.",
        "....SeeDDeeS.lm.",
        "....keeSSeek.lm.",
        "....SSSDDSSS.lm.",
        ".....SSSSSS..lm.",
        "...BBSDkkDSBBlm.",
        "...SBSDkkDSBSlm.",
        "....BSSSSSSB.lm.",
        "....BBBBBBBBmwmm",
        "....BBB..BBB....",
        "....SSS..SSS....",
    ],
    work2: [
        ".......m...m.m..",
        "......m...m...m.",
        ".......m.m...m..",
        E,
        ".....SSSSSS.....",
        "....SSSDDSSS..m.",
        "....SeeDDeeS.wm.",
        "....keeSSeek.wm.",
        "....SSSDDSSS.wm.",
        ".....SSSSSS..wm.",
        "...BBSDkkDSBBwm.",
        "...SBSDkkDSBSwm.",
        "....BSSSSSSB.wm.",
        "....BBBBBBBBmmwm",
        "....BBB..BBB....",
        "....SSS..SSS....",
    ],
    // playing sport: Peter dribbling a ball at his side, high then low
    ball1: [
        E,
        E,
        E,
        E,
        ".....HHHHHH.....",
        "....HHHHHHHH....",
        "....HppppppH....",
        "....gekggkeg....",
        "....pppppppp.rr.",
        "....pppkkppprrrr",
        ".....pppppp.rrrr",
        "...vvvvvvvvvvrr.",
        "...pvvvvvvvvp...",
        "....vvvvvvvv....",
        "....BB....BB....",
        "....ss....ss....",
    ],
    ball2: [
        E,
        E,
        E,
        E,
        ".....HHHHHH.....",
        "....HHHHHHHH....",
        "....HppppppH....",
        "....gekggkeg....",
        "....pppppppp....",
        "....pppkkppp....",
        ".....pppppp.....",
        "...vvvvvvvvvv...",
        "...pvvvvvvvvprr.",
        "....vvvvvvvvrrrr",
        "....BB....BBrrrr",
        "....ss....ss.rr.",
    ],
};

export type SpideyLook = "suit" | "peter";

// Which look each of Spider-Man's poses is drawn in: the suit on the job, Peter off it.
export const SPIDEY_LOOK: Record<PetPose, SpideyLook> = {
    walk1: "suit",
    walk2: "suit",
    stand: "suit",
    speak: "suit",
    dangle: "suit",
    tired: "suit",
    work1: "suit",
    work2: "suit",
    sit: "peter",
    sleep: "peter",
    read1: "peter",
    read2: "peter",
    music1: "peter",
    music2: "peter",
    ball1: "peter",
    ball2: "peter",
};
```

- After `dressMinionInFlag`, add:

```ts
// The flag shirt on Spider-Man: Peter's sweater is the shirt, its star the Minion's three rows. A suit is a suit, so a
// pose in it has no sweater and is left as it is.
function dressSpideyInFlag(rows: readonly string[]): readonly string[] {
    const g = rows.map((row) => [...row].map((code) => (code === "v" ? "R" : code)));
    const top = g.findIndex((row) => row.includes("R"));
    if (top < 0) {
        return rows;
    }
    stampStar(g, top, MINION_STAR);
    return g.map((row) => row.join(""));
}
```

- Add `const SPIDEY_DRESSED = {} as Record<PetPose, readonly string[]>;` beside `MINION_DRESSED`, and in the loop
  `SPIDEY_DRESSED[pose] = dressSpideyInFlag(SPIDEY_POSES[pose]);`.
- In `outfitRows`, before the Minion branch:

```ts
    if (character === "spidey") {
        return outfit === "vn-shirt" ? SPIDEY_DRESSED[pose] : SPIDEY_POSES[pose];
    }
```

- In `spriteFor`'s doc comment: "the same for both" → "the same for each".

**Step 5: The name, the setting and the fold button**

`petcharacter.ts`:

```ts
// Which creature Jarvis is drawn as (petsprite.ts draws each). Pure: the renderers read the Settings choice through
// petCharacter.
…
export const PET_CHARACTER_NAME: Record<PetCharacter, string> = {
    sprout: "Sprout",
    minion: "Minion",
    spidey: "Spider-Man",
};

/** A stored choice, or Sprout for anything that is not one of the three (a hand-edited value). */
export function petCharacter(value: unknown): PetCharacter {
    return value === "sprout" || value === "minion" || value === "spidey" ? value : DEFAULT_PET_CHARACTER;
}
```

`appearance.tsx:142`: `(["sprout", "minion", "spidey"] as const)`.

`settingsmodel.ts:279`: `desc: "Who walks the footer as Jarvis. The marks and the outfit work the same for each."`

`app-bar.tsx` `FOLD_SPRITE`:

```ts
export const FOLD_SPRITE = {
    sprout: spriteFor("sit", [], null, "sprout"),
    minion: spriteFor("sit", [], null, "minion"),
    // standing, in the suit: sitting is Peter Parker, who does not read as the one the window folds into
    spidey: spriteFor("stand", [], null, "spidey"),
};
```

**Step 6: Run the tests and the typecheck**

Run: `npx vitest run frontend/app/view/jarvis/ frontend/app/view/agents/settingsmodel.test.ts`
Expected: PASS.
Run: `task check:ts`
Expected: exit 0. A `Record<PetCharacter, …>` it reports as missing `spidey` gets a `spidey` entry the way the Minion
has one.

**Step 7: Commit**

```bash
git commit -m "feat(pet): Spider-Man as a third Jarvis character — Peter Parker at rest, the suit at work" -- frontend/tailwindsetup.css frontend/app/view/jarvis/petsprite.ts frontend/app/view/jarvis/petsprite.test.ts frontend/app/view/jarvis/petcharacter.ts frontend/app/view/jarvis/petcharacter.test.ts frontend/app/view/agents/settingspages/appearance.tsx frontend/app/view/agents/settingsmodel.ts frontend/app/cockpit/app-bar.tsx
```

(plus any file the typecheck sent you to.)

---

### Task 2: The Spider theme

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/themes.ts` (append to `THEMES`, after `monokai`)
- Test: `frontend/app/view/agents/themes.test.ts:79,134-135`

**Step 1: Write the failing tests**

In `themes.test.ts`:
- line 79: `for (const id of [DEFAULT_THEME_PRESET, "graphite", "spider"]) {`
- line 134-135: `it("THEMES ships the nine dark presets — light mode was declined and removed", () => {` and
  `expect(THEMES).toHaveLength(9);`
- add, inside that same `describe`:

```ts
    it("Spider's error is not its red accent, so a failure never reads as a selection", () => {
        const p = activePalette("spider");
        expect(p.accent).toBe("#e23636");
        expect(p.error).not.toBe(p.accent);
    });
```

(`activePalette` is already imported there; if not, import it from `./themes`.)

**Step 2: Run to see them fail**

Run: `npx vitest run frontend/app/view/agents/themes.test.ts`
Expected: FAIL — 8 presets, no `spider`.

**Step 3: The preset**

Append to `THEMES` in `themes.ts`:

```ts
    {
        id: "spider",
        name: "Spider",
        // Spider-Man's suit: a navy cut from its blue for the canvas and its red for the accent. The error is a pink, not
        // a red, so a failure never reads as the accent; the terminal keeps a real blue, the suit's own. Measured:
        // muted 6.25:1 on bg and 5.18:1 hovered, ink-faint 4.03:1, the weakest ANSI slot (black) 4.03:1.
        palette: {
            bg: "#0b1020",
            surface: "#0f1528",
            surfaceRaised: "#151c33",
            surfaceHover: "#1a223c",
            surfaceSelected: "#212b4a",
            code: "#080c18",
            border: "#1a2240",
            edgeMid: "#222b4a",
            edgeStrong: "#2e3960",
            edgeFaint: "#131a30",
            text: "#e8ebf2",
            secondary: "#c6cbd8",
            muted: "#8d94a8",
            inkFaint: "#6b7390",
            accent: "#e23636",
            success: "#4fc28f",
            warning: "#e8b04b",
            error: "#ff6b9a",
            ansiBlue: "#4a8fe7",
        },
    },
```

**Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/`
Expected: PASS, including the per-theme ANSI tests that iterate `THEMES` (hue ranges, 3:1 on bg).

**Step 5: Commit**

```bash
git commit -m "feat(theme): Spider, a navy and red preset" -- frontend/app/view/agents/themes.ts frontend/app/view/agents/themes.test.ts
```

---

### Task 3: The web, as pure motion (rappel and web-swing)

**Depends on:** Task 1

**Files:**
- Modify: `frontend/app/view/jarvis/petfall.ts`
- Create: `frontend/app/view/jarvis/petwebswing.ts`
- Test: `frontend/app/view/jarvis/petfall.test.ts`, create `frontend/app/view/jarvis/petwebswing.test.ts`

**Step 1: Write the failing tests**

Append to `petfall.test.ts` (import `webLanding`, `MIN_RAPPEL_S`, `MAX_RAPPEL_S` beside what it imports):

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
        const s = strandCells({ x: 8, y: 1 }, { x: 14, y: -14 });
        expect(s[0]).toEqual({ x: 8, y: 1 });
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

    it("departs: the strand shoots from its hands to the anchor, then it is pulled up it and gone", () => {
        const start = webSwingFrame("depart", 0);
        expect(start.pet).toEqual({ dx: 0, dy: 0, opacity: 1 });
        expect(start.strand[0]).toEqual(HANDS);
        const shot = webSwingFrame("depart", SHOOT_MS);
        expect(shot.strand[shot.strand.length - 1]).toEqual(ANCHOR);
        const mid = webSwingFrame("depart", (SHOOT_MS + TELEPORT_MS.depart) / 2);
        expect(mid.pet.dy).toBeLessThan(0);
        expect(mid.pet.dx).toBeGreaterThan(0);
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

**Step 2: Run to see them fail**

Run: `npx vitest run frontend/app/view/jarvis/petfall.test.ts frontend/app/view/jarvis/petwebswing.test.ts`
Expected: FAIL — `webLanding` not exported, `./petwebswing` missing.

**Step 3: The rappel**

Append to `petfall.ts`:

```ts
// Spider-Man does not drop: it rappels down a strand at this speed, braking (easeOut) into the ledge, within these.
export const RAPPEL_PX_S = 600;
export const MIN_RAPPEL_S = 0.25;
export const MAX_RAPPEL_S = 0.6;

/**
 * Spider-Man's way back to the ledge from `offset` px below it: from above a rappel, slower than a fall and braking
 * rather than accelerating, with the same one-cell bounce; from below landing's hop; null when it is already there.
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

**Step 4: The web-swing**

Create `petwebswing.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Spider-Man's teleport (petteleport.ts plays Sprout's and the Minion's): departing, it shoots a strand up and out and
// is yanked along it out of sight; arriving, a strand drops and it swings in down it to where it stands. It lasts what
// the teleport lasts (TELEPORT_MS), so teleportstore.ts and the fold's timing do not know which one plays. Drawn on the
// pet's own cell grid in --color-spidey-web, moving only in whole cells, so it stays pixel art. Pure: the frame at a
// time; petteleportsvg.tsx draws it.

import { TELEPORT_MS, type TeleportKind } from "./petteleport";

export const WEB_TOKEN = "--color-spidey-web";

// a cell on the pet's grid; x and y may fall outside its 16x16
export interface WebCell {
    x: number;
    y: number;
}

export interface WebSwingFrame {
    // where the pet is drawn, in whole cells from where it stands, and how much of it shows
    pet: { dx: number; dy: number; opacity: number };
    // the strand, from the pet's hands to where it is stuck; empty when none is drawn
    strand: WebCell[];
}

// where the strand sticks: up and out to the right, off the pet's box
export const ANCHOR: WebCell = { x: 14, y: -14 };
// the pet's hands, at the top middle of its box (SPIDEY_POSES.dangle, which it is drawn in while it swings)
export const HANDS: WebCell = { x: 8, y: 1 };
// where an arriving pet swings in from, in cells from where it lands: up and to the left
export const SWING_FROM = { dx: -12, dy: -10 };
// how long the strand takes to shoot out or drop
export const SHOOT_MS = 120;
// a departing pet fades over the last part of its pull
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
    // pulled up the strand, faster as it goes
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
    // a pendulum's arc: it drops first and comes across last, rather than sliding in a line
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

**Step 5: Run the tests**

Run: `npx vitest run frontend/app/view/jarvis/petfall.test.ts frontend/app/view/jarvis/petwebswing.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add frontend/app/view/jarvis/petwebswing.ts frontend/app/view/jarvis/petwebswing.test.ts
git commit -m "feat(pet): Spider-Man rappels down a strand and web-swings in place of the teleport (pure)" -- frontend/app/view/jarvis/petfall.ts frontend/app/view/jarvis/petfall.test.ts frontend/app/view/jarvis/petwebswing.ts frontend/app/view/jarvis/petwebswing.test.ts
```

---

### Task 4: The hang pastime, the ceiling and the upside-down sprite (pure)

**Depends on:** Task 1

**Files:**
- Modify: `frontend/app/view/jarvis/petwalk.ts`
- Modify: `frontend/app/view/jarvis/petledge.ts`
- Modify: `frontend/app/view/jarvis/petsprite.ts` (after `spriteFor`)
- Test: `frontend/app/view/jarvis/petwalk.test.ts`, `frontend/app/view/jarvis/petledge.test.ts`,
  `frontend/app/view/jarvis/petsprite.test.ts`

**Step 1: Write the failing tests**

`petsprite.test.ts` — import `upsideDown`; append:

```ts
describe("upsideDown", () => {
    it("hangs the body by its feet and leaves the marks and the flag as they are", () => {
        const s = spriteFor("stand", ["blocked"], "vn-flag", "spidey");
        const u = upsideDown(s);
        expect(u.back).toEqual(s.back);
        expect(u.overlay).toEqual(s.overlay);
        expect(u.body).toHaveLength(s.body.length);
        for (const [i, c] of u.body.entries()) {
            expect(c).toEqual({ ...s.body[i], y: PET_GRID - 1 - s.body[i].y });
        }
        expect(Math.min(...u.body.map((c) => c.y))).toBe(0);
    });

    it("turned twice is the sprite again", () => {
        const s = spriteFor("stand", [], null, "spidey");
        expect(upsideDown(upsideDown(s))).toEqual(s);
    });
});
```

`petledge.test.ts` — import `measureCeiling`; append:

```ts
describe("measureCeiling", () => {
    const box = (top: number, bottom: number) => ({ left: 0, right: 800, top, bottom });

    it("is the bottom of the app bar it hangs from", () => {
        expect(measureCeiling([box(0, 38)])).toBe(38);
    });

    it("is null with no ceiling shown: Float and the folded window, where it never hangs", () => {
        expect(measureCeiling([])).toBeNull();
        expect(measureCeiling([{ left: 0, right: 0, top: 0, bottom: 0 }])).toBeNull();
    });

    it("takes the lowest of several", () => {
        expect(measureCeiling([box(0, 38), box(38, 70)])).toBe(70);
    });
});
```

`petwalk.test.ts`:
- import `HANG_DOWN_MS`, `HANG_EVERY`, `HANG_MIN_MS`, `HANG_UP_MS`, `startHang` from `./petwalk`;
- in the `input()` helper add `hangs: false,` before `...over`;
- append:

```ts
describe("hang (Spider-Man)", () => {
    // a walk one step from its target, so the next step lands and starts a rest
    const arriving = () => walker({ name: "walk", x: 400, target: 400, due: T0 });
    const zero = () => 0;

    it("starts about one rest in HANG_EVERY when it can hang, going up first in dangle", () => {
        expect(HANG_EVERY).toBe(7);
        const step = stepWalker(arriving(), input({ hangs: true }), T0, zero);
        expect(step.state.restPose).toBe("hang");
        expect(step.hang).toBe("up");
        expect(step.pose).toBe("dangle");
        expect(step.delayMs).toBe(HANG_UP_MS);
    });

    it("rests as before on a draw past one in seven", () => {
        const step = stepWalker(arriving(), input({ hangs: true }), T0, () => 0.5);
        expect(step.state.restPose).not.toBe("hang");
        expect(step.hang).toBeNull();
    });

    it("never hangs when it cannot (not Spider-Man, no app bar, the cursor on it), nor tired", () => {
        expect(stepWalker(arriving(), input(), T0, zero).hang).toBeNull();
        expect(stepWalker(arriving(), input({ hangs: true, expression: "tired" }), T0, zero).hang).toBeNull();
    });

    it("goes up, hangs upside down in stand, comes down, and walks on", () => {
        const s = startHang(walker(), T0, zero);
        expect(s.due).toBe(T0 + HANG_UP_MS + HANG_MIN_MS + HANG_DOWN_MS);
        const hanging = input({ hangs: true });
        const up = stepWalker(s, hanging, T0, half);
        expect([up.hang, up.pose, up.delayMs]).toEqual(["up", "dangle", HANG_UP_MS]);
        const hang = stepWalker(up.state, hanging, T0 + HANG_UP_MS, half);
        expect([hang.hang, hang.pose, hang.delayMs]).toEqual(["hang", "stand", HANG_MIN_MS]);
        const down = stepWalker(hang.state, hanging, T0 + HANG_UP_MS + HANG_MIN_MS, half);
        expect([down.hang, down.pose, down.delayMs]).toEqual(["down", "dangle", HANG_DOWN_MS]);
        const after = stepWalker(down.state, hanging, s.due, half);
        expect(after.hang).toBeNull();
        expect(after.state.name).toBe("walk");
    });

    it("comes down at once when it can no longer hang, and rests the rest of the time standing", () => {
        const s = startHang(walker(), T0, zero);
        const cut = stepWalker(s, input({ hangs: false }), T0 + 1_000, half);
        expect(cut.hang).toBeNull();
        expect(cut.pose).toBe("stand");
        expect(cut.state.name).toBe("rest");
        expect(cut.state.due).toBe(s.due);
    });

    it("comes down for a posture, and for a drag", () => {
        const s = startHang(walker(), T0, zero);
        const held = stepWalker(s, input({ hangs: true, posture: "escalation" }), T0 + 1_000, half);
        expect(held.hang).toBeNull();
        const dragged = stepWalker(s, input({ hangs: true, dragging: true }), T0 + 1_000, half);
        expect(dragged.hang).toBeNull();
        expect(dragged.pose).toBe("dangle");
    });

    it("stays up when a terminal opens under the spot it left: it is not on the ledge", () => {
        const s = startHang(walker({ x: 400 }), T0, zero);
        const step = stepWalker(s, input({ hangs: true, avoid: [[380, 600]] }), T0 + 1_000, half);
        expect(step.hang).toBe("hang");
    });
});
```

**Step 2: Run to see them fail**

Run: `npx vitest run frontend/app/view/jarvis/petwalk.test.ts frontend/app/view/jarvis/petledge.test.ts frontend/app/view/jarvis/petsprite.test.ts`
Expected: FAIL — `startHang`, `measureCeiling`, `upsideDown` not exported; `input()` has an unknown `hangs`.

**Step 3: `upsideDown`** (`petsprite.ts`)

Name the sprite type and use it as `spriteFor`'s return type:

```ts
export interface PetSprite {
    back: PetCell[];
    body: PetCell[];
    overlay: PetCell[];
}
```

then, after `spriteFor`:

```ts
/**
 * A sprite turned upside down, hanging by its feet (Spider-Man's hang, petwalk.ts): the body's rows in reverse, so its
 * feet are on row 0 where the strand meets them. Cells only move, so it stays pixel art; the marks and the flag stay
 * as they are, so a ? still reads as one.
 */
export function upsideDown(sprite: PetSprite): PetSprite {
    return { ...sprite, body: sprite.body.map((c) => ({ ...c, y: PET_GRID - 1 - c.y })) };
}
```

**Step 4: `measureCeiling`** (`petledge.ts`, after `measureLedge`)

```ts
/**
 * The y Spider-Man hangs from: the bottom of the lowest shown `[data-pet-ceiling]` box (the app bar), or null when none
 * is shown — Float and the folded window, where it never hangs.
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

**Step 5: The walker** (`petwalk.ts`)

1. After `PASTIMES`, add:

```ts
// Spider-Man's own rest, when WalkerInput.hangs: it shoots a strand to the app bar and goes up it, hangs upside down
// under the bar, and rappels back to where it left the ledge. About one rest in HANG_EVERY, never tired.
export const HANG_EVERY = 7;
export const HANG_UP_MS = 400;
export const HANG_DOWN_MS = 500;
export const HANG_MIN_MS = 4_000;
export const HANG_MAX_MS = 8_000;

export type HangPhase = "up" | "hang" | "down";
```

2. `export type RestPose = (typeof REST_POSES)[number] | "hang";`
3. `WalkerInput`, after `home`:

```ts
    // Spider-Man, with an app bar to hang from, the cursor not on it, and motion allowed: a rest may be a hang
    hangs: boolean;
```

4. `WalkerState`, after `posture`:

```ts
    // a hang rest: when it began, which times its phases (absent on every other rest)
    hangAt?: number;
```

5. `WalkerStep`, after `lift`:

```ts
    // Spider-Man's hang, by phase: going up the strand, hanging under the app bar, coming down; null otherwise
    hang: HangPhase | null;
```

6. Replace `rest` and add `startHang` and `hangPhase`:

```ts
function rest(s: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerState {
    // the extra draw only when it can hang, so every other creature's walk is the walk it always was
    if (input.hangs && !wearsTired(input.expression) && rand() < 1 / HANG_EVERY) {
        return startHang(s, now, rand);
    }
    const length = REST_MIN_MS + rand() * (REST_MAX_MS - REST_MIN_MS);
    return {
        ...still(s, "rest"),
        due: now + (wearsTired(input.expression) ? 2 * length : length),
        restPose: REST_POSES[Math.min(REST_POSES.length - 1, Math.floor(rand() * REST_POSES.length))],
        hangAt: undefined,
    };
}

/** A hang rest starting now: up, HANG_MIN_MS..HANG_MAX_MS hanging, down. Exported for the DEV force (petview.tsx). */
export function startHang(s: WalkerState, now: number, rand: () => number): WalkerState {
    const length = HANG_MIN_MS + rand() * (HANG_MAX_MS - HANG_MIN_MS);
    return { ...still(s, "rest"), restPose: "hang", hangAt: now, due: now + HANG_UP_MS + length + HANG_DOWN_MS };
}

/** Which phase of its hang a state is in at `now`, or null when it is not hanging. */
export function hangPhase(s: WalkerState, now: number): HangPhase | null {
    if (s.name !== "rest" || s.restPose !== "hang" || s.hangAt == null) {
        return null;
    }
    if (now < s.hangAt + HANG_UP_MS) {
        return "up";
    }
    return now >= s.due - HANG_DOWN_MS ? "down" : "hang";
}
```

7. `restPoseAt`, first lines:

```ts
    const phase = hangPhase(s, now);
    if (phase != null) {
        // hands on the strand going up and coming down; stood on its head under the bar (the renderer turns it over)
        return phase === "hang" ? "stand" : "dangle";
    }
```

8. `restDelay`, first lines:

```ts
    if (s.restPose === "hang" && s.hangAt != null) {
        const next = [s.hangAt + HANG_UP_MS, s.due - HANG_DOWN_MS, s.due].filter((b) => b > now);
        return next.length === 0 ? 0 : Math.min(...next) - now;
    }
```

9. In `stepWalker`'s `else if (s.name === "rest")` branch, before the `blocked` check, and make that check skip a
   hang:

```ts
    } else if (s.name === "rest") {
        if (s.restPose === "hang" && !input.hangs) {
            // the cursor came onto it, or the app bar went: it comes down and spends the rest of the time standing
            s = { ...s, restPose: "stand", hangAt: undefined };
        }
        if (s.restPose !== "hang" && blocked(s.x, avoid) && clearSpot(s.x, ledge, avoid) !== s.x) {
```

   (the rest of the branch as it is.)

10. `view`: add `hang: hangPhase(s, now),` beside `lift`.

**Step 6: Run the tests and the typecheck**

Run: `npx vitest run frontend/app/view/jarvis/`
Expected: PASS — the existing walker tests too (they never set `hangs`, so no draw changes).
Run: `task check:ts`
Expected: errors only where a `WalkerInput` is built without `hangs` (`petview.tsx`'s `run`) or a `WalkerStep` without
`hang`. Add `hangs: false,` / `hang: null,` there for now (Task 5 wires `petview.tsx`), and re-run: exit 0. Commit
whichever of those files you touched too.

**Step 7: Commit**

```bash
git commit -m "feat(pet): Spider-Man's hang rest, the app bar as its ceiling, and the upside-down sprite (pure)" -- frontend/app/view/jarvis/petwalk.ts frontend/app/view/jarvis/petwalk.test.ts frontend/app/view/jarvis/petledge.ts frontend/app/view/jarvis/petledge.test.ts frontend/app/view/jarvis/petsprite.ts frontend/app/view/jarvis/petsprite.test.ts frontend/app/view/jarvis/petview.tsx
```

---

### Task 5: Draw the web: drag, rappel, hang, web-swing, the working web

**Depends on:** Task 3, Task 4

**Files:**
- Modify: `frontend/app/view/jarvis/petview.tsx`
- Modify: `frontend/app/view/jarvis/petteleportsvg.tsx`
- Modify: `frontend/app/view/jarvis/workingdots.tsx`
- Modify: `frontend/app/cockpit/sprout-mini.tsx`
- Modify: `frontend/app/cockpit/app-bar.tsx` (the root `<div data-app-bar …>`, ~line 80)

No unit test: these are views over the pure modules Tasks 3–4 tested (repo rule: no render tests). Task 6's CDP steps
show them. Read `petview.tsx` whole before editing it; the line numbers below are from before this plan.

**Step 1: The ceiling.** In `app-bar.tsx` add `data-pet-ceiling` to the root `<div data-app-bar data-tauri-drag-region …>`.
In `petview.tsx`, beside `readLedge`:

```ts
// the app bar Spider-Man hangs from (petledge.ts measureCeiling), absent in Float and folded
function readCeiling(): number | null {
    return measureCeiling(Array.from(document.querySelectorAll("[data-pet-ceiling]"), (e) => e.getBoundingClientRect()));
}
```

Add `ceiling: number | null` to `PetFrame` and set it in `run` (`setFrame({ step, ledge, avoid, ceiling })`).

**Step 2: Who it is, read by the walker.** Move `const character = petCharacter(useAtomValue(petCharacterAtom));` from
the render (~line 566) up beside `teleport` (~line 346), and add `character` to `liveRef` (both the initial object and
the per-render assignment). Add `const hangCutRef = useRef(false);`. In `run`, compute `const ceiling = readCeiling();`
and set the input:

```ts
            // Spider-Man hangs from the app bar; not under reduced motion, and not once the cursor has come onto it
            hangs: live.character === "spidey" && ceiling != null && !live.reduce && !hangCutRef.current,
```

After `stepWalker`, `if (step.hang == null) { hangCutRef.current = false; }`. Make the effect that re-runs the walker
when its live inputs change also depend on `character` (find the `useEffect` that calls `run()` on
`expression`/`posture`/… changes and add it to the deps).

In `onHoverStart`, before `touch`: `if (frame?.step.hang != null) { hangCutRef.current = true; }` (then `touch()`,
which re-runs the walker).

**Step 3: Up to the bar and back.** Add motion values and the animation:

```ts
    // Spider-Man's hang: how far above its ledge spot it is drawn, and the strand above it
    const hangY = useMotionValue(0);
    const hangAnimRef = useRef<AnimationPlaybackControls | null>(null);
    // the gap from the bar to its ledge-top, so the strand's height follows hangY without a render
    const hangBase = useMotionValue(0);
    const hangStrand = useTransform([hangY, hangBase], ([y, base]: number[]) => Math.max(0, base + y));
```

```ts
    // the hang's three phases (petwalk.ts): up the strand to just under the bar, held there, and down again — and down
    // too whenever the hang is cut (the cursor came onto it, a posture, a drag)
    const hang = frame?.step.hang ?? null;
    const hangTo =
        frame?.ceiling != null ? frame.ceiling + HANG_STRAND_PX - (frame.ledge.top - PET_PX - frame.step.lift) : 0;
    useEffect(() => {
        if (frame?.ceiling != null) {
            hangBase.set(frame.ledge.top - PET_PX - frame.ceiling);
        }
        hangAnimRef.current?.stop();
        if (hang === "up") {
            hangAnimRef.current = animate(hangY, hangTo, { duration: HANG_UP_MS / 1000, ease: "easeOut" });
        } else if (hang === "hang") {
            hangY.set(hangTo);
        } else if (hangY.get() !== 0) {
            hangAnimRef.current = animate(hangY, 0, { duration: HANG_DOWN_MS / 1000, ease: "easeOut" });
        }
    }, [hang, hangTo, hangY, hangBase, frame?.ceiling, frame?.ledge.top]);
```

with `const HANG_STRAND_PX = 4 * PET_CELL_PX;` at module level (comment: "the strand between the bar and its feet") and
`hangAnimRef.current?.stop()` in the unmount cleanup beside `slideAnimRef`. On the root `motion.div`'s `style`, add
`marginTop: hangY` (so the hit box goes up with it and a hover on the hanging pet cuts the hang).

Draw it turned over: `const drawn = step.hang === "hang" ? upsideDown(sprite) : sprite;` and render `drawn` in place of
`sprite` in the non-teleport branch. Inside the `motion.div`, after the svg:

```tsx
            {step.hang != null && frame.ceiling != null ? (
                // the strand from the app bar to its feet (hanging) or its hands (going up, coming down)
                <motion.span
                    aria-hidden
                    className="pointer-events-none absolute bottom-full left-[21px] w-[3px] bg-spidey-web"
                    style={{ height: hangStrand }}
                />
            ) : null}
```

**Step 4: Held by a strand, and the rappel.** Spider-Man only (`character === "spidey" && !reduce`):

```ts
    // Spider-Man held by the pointer hangs this far under it on a strand (and rappels down a strand when let go)
    const dropY = useMotionValue(0);
    // dragY where the pointer let go, so the rappel's strand stays stuck there while the pet goes down it
    const releaseY = useMotionValue(0);
    const svgY = useTransform([ledgeY, dropY], ([a, b]: number[]) => a + b);
    // the strand runs from the release point (or the pointer, while held) down to its hands
    const strandTop = useTransform([releaseY, dragY], ([r, y]: number[]) => r - y);
    const strandH = useTransform([releaseY, dragY, dropY], ([r, y, d]: number[]) => Math.max(0, y - r + d));
```

- svg `style={{ x: slideX, y: svgY }}` in place of `y: ledgeY`.
- `onDragStart` (Spider-Man): `releaseY.set(dragY.get()); animate(dropY, DRAG_DROP_PX, { duration: 0.12, ease: "easeOut" });`
  with module-level `const DRAG_DROP_PX = 4 * PET_CELL_PX;` ("held, it hangs four cells under the pointer").
  `onDrag` (new handler, Spider-Man): `releaseY.set(dragY.get())` — while held, the strand's top is the pointer.
- `onDragEnd`: `const way = reduce ? null : (character === "spidey" ? webLanding : landing)(dragY.get());`, and before
  the fall starts `releaseY.set(dragY.get())`. In `land()`, `dropY.set(0)` beside `dragX.set(0)`.
- Draw the strand while held or rappelling:

```tsx
            {character === "spidey" && draggingNowRef.current ? (
                <motion.span
                    aria-hidden
                    className="pointer-events-none absolute left-[21px] top-0 w-[3px] bg-spidey-web"
                    style={{ y: strandTop, height: strandH }}
                />
            ) : null}
```

**Step 5: The web-swing.** In `petteleportsvg.tsx`:

- Rename the current body of `PetTeleportLayers` to `function BeamLayers(props)` (unchanged).
- Add:

```tsx
// Spider-Man's teleport (petwebswing.ts): the strand, and the pet drawn moved along it
function WebSwingLayers({ run, sprite, cellPx, flip }: LayerProps) {
    const t = useTeleportClock(run);
    if (run.kind === "gone") {
        return null;
    }
    const f = webSwingFrame(run.kind, t);
    const px = PET_GRID * cellPx;
    const cell = (c: PetCell, i: number) => (
        <rect key={i} x={c.x * cellPx} y={c.y * cellPx} width={cellPx} height={cellPx} fill={`var(${c.token})`} />
    );
    return (
        <>
            {f.strand.map((c, i) => (
                <rect
                    key={`web${i}`}
                    x={c.x * cellPx}
                    y={c.y * cellPx}
                    width={cellPx}
                    height={cellPx}
                    fill={`var(${WEB_TOKEN})`}
                />
            ))}
            <g opacity={f.pet.opacity} transform={`translate(${f.pet.dx * cellPx} ${f.pet.dy * cellPx})`}>
                {sprite.back.map(cell)}
                <g transform={flip ? `matrix(-1 0 0 1 ${px} 0)` : undefined}>{sprite.body.map(cell)}</g>
                {sprite.overlay.map(cell)}
            </g>
        </>
    );
}

export function PetTeleportLayers(props: LayerProps & { character: PetCharacter }) {
    return props.character === "spidey" ? <WebSwingLayers {...props} /> : <BeamLayers {...props} />;
}
```

  with `type LayerProps = { run: TeleportRun; sprite: PetSprite; cellPx: number; flip?: boolean };`. `PetTeleportSvg`
  takes and passes `character` too.
- Callers draw Spider-Man in `dangle` while it swings: in `petview.tsx` pass
  `sprite={character === "spidey" ? spriteFor("dangle", marks, outfit, character) : sprite}` and `character`; in
  `sprout-mini.tsx` (~line 219) the same with its own `look.marks` and outfit.

**Step 6: The working web.** In `workingdots.tsx`, take `character?: PetCharacter` (default `"sprout"`) and for
`"spidey"` draw this in place of the three dots:

```tsx
// Spider-Man's working mark: a 12px web whose three rings light in turn, as the dots do; still under reduced motion
function WorkingWeb({ reduce }: { reduce: boolean }) {
    return (
        <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden className="block">
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

Pass `character` from `petview.tsx` (~line 707) and `sprout-mini.tsx` (~line 230).

**Step 7: The DEV contract and a force.** In `petview.tsx`:
- `__jarvisPet` gains `character`, `hang: frame.step.hang`, `ceiling: frame.ceiling`, and
  `upsideDown: frame.step.hang === "hang"`.
- `PetForce` gains `hang?: boolean` (comment: "start a hang now, Spider-Man under an app bar only"). In `force`, when
  `o?.hang` and `liveRef.current.character === "spidey"`, set
  `walkerRef.current = startHang(walkerRef.current ?? <the walker run() would boot>, Date.now(), Math.random)` before
  `touch()`. A force with `hang` must not also block the walker's normal inputs, so leave `forceRef` as it is.

**Step 8: Typecheck, tests, and a look**

Run: `task check:ts` — exit 0.
Run: `npx vitest run frontend/app/view/jarvis/ frontend/app/cockpit/` — PASS.
In the running dev app (`task dev` already up; don't build): Settings → Appearance → Character → Spider-Man; drag it
(a strand to the pointer, a slower rappel on release); in the devtools console run
`window.__jarvisPet.force({ hang: true })` (up the strand, upside down under the app bar, down again; hover it while
up there and it comes straight down); fold the window (the web-swing) and unfold.

**Step 9: Commit**

```bash
git commit -m "feat(pet): Spider-Man hangs from the app bar, dangles and rappels on a strand, web-swings to fold, and spins a working web" -- frontend/app/view/jarvis/petview.tsx frontend/app/view/jarvis/petteleportsvg.tsx frontend/app/view/jarvis/workingdots.tsx frontend/app/cockpit/sprout-mini.tsx frontend/app/cockpit/app-bar.tsx
```

---

### Task 6: CDP steps, docs and changelog

**Depends on:** Task 2, Task 5

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (the `jarvisPet` scenario, after step 14 "the Minion", ~line 5554)
- Modify: `docs/guide/settings.md:89,93`
- Modify: `CHANGELOG.md` (the top `## Unreleased` → `Added`)
- Modify: `docs/open-issues.md` ("0 · Waiting on a hand check")

**Step 1: The CDP steps.** Follow step 14's pattern (a real click in Settings via `spOpen`/`spClick`, then read
`window.__jarvisPet`). Add to the arrange's `ctx` `prevTheme: await h.ev('localStorage.getItem("cockpit.theme.preset")')`
and restore it in teardown beside `prevCharacter` (remove the key when it was null).

- **15. Spider-Man:** click Character → "Spider-Man"; assert `__jarvisPet.character === "spidey"`, its `tokens`
  include `var(--color-spidey-red)` and `var(--color-spidey-blue)` and not `var(--color-accent)`, and the sprite still
  stands on the ledge (same check as step 14). Shot `jarvis-pet-15-spidey`.
- **16. The hang:** `window.__jarvisPet.force({ hang: true })`; poll until `__jarvisPet.hang === "hang"` (≤ 1.5 s);
  assert `__jarvisPet.upsideDown === true` and that the `[data-pet-sprite]` box's top lies between
  `__jarvisPet.ceiling` and `__jarvisPet.ceiling + 24` px; shot `jarvis-pet-16-hang`; then dispatch a mouse move onto
  the sprite and poll until `__jarvisPet.hang === null` (≤ 1.5 s). `force(null)` after.
- **17. The Spider theme:** Settings → Appearance → Theme → "Spider"; assert
  `getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() === "#e23636"`; shot
  `jarvis-pet-17-spider-theme` with Spider-Man on the ledge.

Run against the running dev app: `task verify:ui -- jarvis-pet`. Expected: PASS, and the three shots in
`cdp-shots/index.html` show the suit on the footer, the pet upside down under the app bar on a strand, and the navy +
red app.

**Step 2: Docs.** `docs/guide/settings.md` (Vietnamese, as the rest of the page):
- line 89, the Theme row: `… One Dark, Monokai, Spider.`
- line 93, the Character row: `**Sprout** (mặc định), **Minion** hoặc **Spider-Man**: con vật đi trên footer, con
  Sprout thu nhỏ của Float và dấu trên thanh Float đều vẽ theo nhân vật này. Dấu và trang phục giống nhau cho cả ba.
  Spider-Man là Peter Parker lúc rảnh và mặc suit lúc làm việc, đu tơ khi bị kéo, rơi hay gập cửa sổ, và thỉnh thoảng
  treo ngược dưới app bar (rê chuột vào là nó xuống).`

**Step 3: Changelog.** Under the top `## Unreleased` → `### Added`:

```markdown
- Spider-Man as a third Jarvis character (Settings → Appearance → Character): Peter Parker at rest and the suit at work. He hangs from a strand when you drag him, rappels down when you let go, web-swings out and back when the window folds, and now and then hangs upside down under the app bar until your cursor comes near.
- A Spider theme (Settings → Appearance → Theme): navy with a Spider-Man red accent.
```

**Step 4: Hand check.** Add under "0 · Waiting on a hand check" in `docs/open-issues.md`:

```markdown
- [ ] (arcterm) Spider-Man pet: drag, rappel, hang under the app bar (hover cuts it), web-swing on fold/unfold, the working web in Float, and the Spider theme — look in the running app.
```

**Step 5: Commit**

On the engine (a clean worktree):

```bash
git commit -m "test(cdp),docs: Spider-Man pet and Spider theme — jarvis-pet steps, settings guide, changelog" -- scripts/cdp/scenarios.mjs docs/guide/settings.md CHANGELOG.md docs/open-issues.md
```

Inline on `main`: `git add -p CHANGELOG.md docs/guide/settings.md` (only these hunks), `git add scripts/cdp/scenarios.mjs
docs/open-issues.md`, then `git commit -m "…"` with no pathspec.
