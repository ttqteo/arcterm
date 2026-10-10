// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    MARKS,
    MINION_POSES,
    outfitRows,
    PET_CELL_PX,
    PET_FLAG_RISE,
    PET_GRID,
    PET_PX,
    PET_TOKENS,
    POSES,
    spriteFor,
    type PetCell,
    type PetMark,
    type PetPose,
} from "./petsprite";

const POSE_NAMES = Object.keys(POSES) as PetPose[];
const MARK_NAMES = Object.keys(MARKS) as PetMark[];

// The @theme block of tailwindsetup.css with comments stripped, as themes.test.ts reads it: a token the
// renderer fills with has to be one the theme actually declares, or the cell paints nothing.
const THEME_BLOCK = (() => {
    const css = readFileSync(new URL("../../../tailwindsetup.css", import.meta.url), "utf8");
    const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
    if (!block) {
        throw new Error("tailwindsetup.css: no @theme block");
    }
    return block[1].replace(/\/\*[\s\S]*?\*\//g, "");
})();

// Every drawn cell of a pose, as "x,y".
function drawnCells(rows: readonly string[]): Set<string> {
    const out = new Set<string>();
    rows.forEach((row, y) => {
        [...row].forEach((code, x) => {
            if (code !== ".") {
                out.add(`${x},${y}`);
            }
        });
    });
    return out;
}

describe("the grid", () => {
    it("is 16 cells of 3 px, a 48 px sprite", () => {
        expect(PET_GRID).toBe(16);
        expect(PET_CELL_PX).toBe(3);
        expect(PET_PX).toBe(48);
        expect(PET_GRID * PET_CELL_PX).toBe(PET_PX);
    });

    it("has exactly the eight poses of the spec, and two frames of each pastime", () => {
        expect([...POSE_NAMES].sort()).toEqual(
            [
                "dangle",
                "sit",
                "sleep",
                "speak",
                "stand",
                "tired",
                "walk1",
                "walk2",
                "read1",
                "read2",
                "music1",
                "music2",
                "work1",
                "work2",
                "ball1",
                "ball2",
            ].sort()
        );
    });

    it.each(POSE_NAMES)("%s is 16 rows of 16 cells", (pose) => {
        expect(POSES[pose]).toHaveLength(PET_GRID);
        for (const row of POSES[pose]) {
            expect(row).toHaveLength(PET_GRID);
        }
    });

    it.each(POSE_NAMES)("%s stands on the bottom row", (pose) => {
        // the sprite's bottom edge is the ledge, so a pose whose last row is empty would float a cell above it
        expect(POSES[pose][PET_GRID - 1]).not.toBe(".".repeat(PET_GRID));
    });
});

describe("tokens", () => {
    const used = new Set<string>();
    for (const rows of [
        ...Object.values(POSES),
        ...Object.values(MINION_POSES),
        ...Object.values(MARKS).map((m) => m.rows),
    ]) {
        for (const row of rows) {
            for (const code of row) {
                if (code !== ".") {
                    used.add(code);
                }
            }
        }
    }

    it.each([...used])("cell code %s maps to a --color- token", (code) => {
        expect(PET_TOKENS[code as keyof typeof PET_TOKENS]).toMatch(/^--color-[a-z0-9-]+$/);
    });

    it.each(Object.entries(PET_TOKENS))("%s's token %s is declared by the theme", (_code, token) => {
        expect(THEME_BLOCK).toMatch(new RegExp(`(?:^|[\\s;{])${token}\\s*:`, "m"));
    });

    it("maps exactly the eight codes of the spec, the flag's two, and the Minion's five", () => {
        expect(PET_TOKENS).toEqual({
            b: "--color-accent",
            d: "--color-accent-600",
            l: "--color-accent-200",
            k: "--color-background",
            w: "--color-primary",
            m: "--color-muted",
            r: "--color-error",
            y: "--color-asking",
            R: "--color-flag-red",
            Y: "--color-flag-star",
            j: "--color-minion-skin",
            h: "--color-minion-shine",
            o: "--color-minion-denim",
            O: "--color-minion-denim-dark",
            s: "--color-minion-hair",
        });
    });
});

describe("marks", () => {
    it("are exactly the six marks of the spec", () => {
        expect([...MARK_NAMES].sort()).toEqual(["blocked", "drop", "escalation", "gate", "unread", "z"].sort());
    });

    it.each(MARK_NAMES)("%s fits inside the grid", (mark) => {
        const { x, y, rows } = MARKS[mark];
        expect(y + rows.length).toBeLessThanOrEqual(PET_GRID);
        for (const row of rows) {
            expect(x + row.length).toBeLessThanOrEqual(PET_GRID);
        }
    });

    // Where each mark is stamped (spec §2's "Stamped on"), and unread on every pose.
    const stamped: [PetMark, PetPose][] = [
        ["gate", "stand"],
        ["escalation", "stand"],
        ["blocked", "stand"],
        ["z", "sleep"],
        ["drop", "tired"],
        ...POSE_NAMES.map((pose): [PetMark, PetPose] => ["unread", pose]),
    ];

    it.each(stamped)("%s on %s never lands on a drawn body cell", (mark, pose) => {
        const body = drawnCells(POSES[pose]);
        const { overlay } = spriteFor(pose, [mark]);
        expect(overlay.length).toBeGreaterThan(0);
        for (const cell of overlay) {
            expect(body.has(`${cell.x},${cell.y}`), `${mark} at ${cell.x},${cell.y}`).toBe(false);
        }
    });
});

describe("spriteFor", () => {
    it.each(POSE_NAMES)("draws one body cell per non-. code of %s, at its column and row", (pose) => {
        const { body, overlay } = spriteFor(pose, []);
        expect(overlay).toEqual([]);
        expect(body).toHaveLength(drawnCells(POSES[pose]).size);
        for (const cell of body) {
            const code = POSES[pose][cell.y][cell.x];
            expect(cell.token).toBe(PET_TOKENS[code as keyof typeof PET_TOKENS]);
        }
    });

    it("keeps marks out of the body, so mirroring the body never mirrors a mark", () => {
        const bare = spriteFor("stand", []);
        const marked = spriteFor("stand", ["escalation", "unread"]);
        expect(marked.body).toEqual(bare.body);
        expect(marked.overlay.length).toBeGreaterThan(0);
    });

    it("stamps a mark's drawn cells at its offset, with their tokens", () => {
        const { overlay } = spriteFor("stand", ["gate"]);
        const { x, y, rows } = MARKS.gate;
        const expected = rows.flatMap((row, dy) =>
            [...row].flatMap((code, dx) =>
                code === "." ? [] : [{ x: x + dx, y: y + dy, token: PET_TOKENS[code as keyof typeof PET_TOKENS] }]
            )
        );
        expect(overlay).toEqual(expected);
        expect(overlay).toContainEqual({ x: 13, y: 1, token: "--color-background" });
    });

    it("draws a count of nothing: it takes only a pose and mark names, and a repeated mark draws once", () => {
        // spec §5 / pet spec §3: the creature never draws a number. The signature has no room for one, and
        // naming a mark twice cannot stack it into a tally.
        expect(spriteFor.length).toBe(2);
        expect(spriteFor("stand", ["blocked", "blocked", "blocked"])).toEqual(spriteFor("stand", ["blocked"]));
    });
});

// Drawn cells of a grid by code, as "x,y".
function cellsOf(rows: readonly string[], codes: string): string[] {
    const out: string[] = [];
    rows.forEach((row, y) => {
        [...row].forEach((code, x) => {
            if (codes.includes(code)) {
                out.push(`${x},${y}`);
            }
        });
    });
    return out;
}

// the 5×5 star: a point up, the arms across, two legs
const STAR_CELLS = 12;

describe("the Vietnam flag shirt", () => {
    const dressed = (pose: PetPose) => outfitRows(pose, "vn-shirt");

    it.each(POSE_NAMES)("keeps the outline of %s: the same cells drawn, only recoloured", (pose) => {
        expect(drawnCells(dressed(pose))).toEqual(drawnCells(POSES[pose]));
    });

    // the shirt is five rows tall only if the face sits two rows higher than it does bare
    it.each(POSE_NAMES)("keeps every eye and mouth cell of %s, two rows higher", (pose) => {
        const raised = cellsOf(POSES[pose], "k").map((c) => {
            const [x, y] = c.split(",").map(Number);
            return `${x},${y - 2}`;
        });
        expect(cellsOf(dressed(pose), "k")).toEqual(raised);
    });

    it.each(POSE_NAMES)("dresses every body cell of %s below its face, and none above", (pose) => {
        const rows = dressed(pose);
        const faceRow = Math.max(...cellsOf(rows, "k").map((c) => Number(c.split(",")[1])));
        rows.forEach((row, y) => {
            const shirt = cellsOf([row], "RY").length;
            const bare = cellsOf([row], "bl").length;
            if (y > faceRow) {
                expect(bare, `row ${y}`).toBe(0);
            } else {
                expect(shirt, `row ${y}`).toBe(0);
            }
        });
    });

    // reading, the book on its lap covers the shirt
    const starred = POSE_NAMES.filter((p) => p !== "speak" && p !== "read1" && p !== "read2");
    it.each(starred)("draws the whole star on %s", (pose) => {
        expect(cellsOf(dressed(pose), "Y")).toHaveLength(STAR_CELLS);
    });

    // speaking, the mouth takes a row, so the shirt is four rows and the star loses its legs
    it("draws the star without its legs while speaking", () => {
        expect(cellsOf(dressed("speak"), "Y")).toHaveLength(STAR_CELLS - 2);
    });

    it("centres the star's point on the shirt's first row, standing", () => {
        const rows = dressed("stand");
        expect(rows[10]).toBe("..RRRRRYRRRRRR..");
        expect(rows[12]).toBe("..RRRYYYYYRRRR..");
        expect(rows[14]).toBe("...RRRYRYRRRR...");
    });

    it("leaves a pose bare without the shirt, the flag included", () => {
        for (const pose of POSE_NAMES) {
            expect(outfitRows(pose, null)).toBe(POSES[pose]);
            expect(outfitRows(pose, "vn-flag")).toBe(POSES[pose]);
        }
    });

    it("fills the shirt with the flag tokens through spriteFor, and leaves the marks alone", () => {
        const bare = spriteFor("stand", ["blocked"]);
        const shirt = spriteFor("stand", ["blocked"], "vn-shirt");
        expect(shirt.overlay).toEqual(bare.overlay);
        expect(shirt.back).toEqual([]);
        const tokens = new Set(shirt.body.map((c) => c.token));
        expect(tokens.has("--color-flag-red")).toBe(true);
        expect(tokens.has("--color-flag-star")).toBe(true);
        expect(shirt.body).toHaveLength(bare.body.length);
    });
});

describe("the Vietnam flag", () => {
    const flagOf = (pose: PetPose) => spriteFor(pose, [], "vn-flag").back;
    const at = (cells: PetCell[], x: number, y: number) => cells.find((c) => c.x === x && c.y === y)?.token;

    // the pole in column 0 from the cloth's top to the ledge, the 9×7 cloth beside it, rising above the sprite
    it("is a pole planted on the ledge and a 9×7 cloth that rises above the sprite", () => {
        const flag = flagOf("stand");
        for (let y = -PET_FLAG_RISE; y < PET_GRID; y++) {
            expect(at(flag, 0, y), `pole at row ${y}`).toBe("--color-muted");
        }
        const cloth = flag.filter((c) => c.x > 0);
        expect(cloth).toHaveLength(9 * 7);
        expect(Math.min(...cloth.map((c) => c.y))).toBe(-PET_FLAG_RISE);
        expect(Math.min(...cloth.map((c) => c.x))).toBe(1);
        expect(Math.max(...cloth.map((c) => c.x))).toBe(9);
    });

    // a point up, the arms across, two legs, inside a one-cell red border
    it("carries the full 5×5 star inside a red border", () => {
        const flag = flagOf("stand");
        const star = flag.filter((c) => c.token === "--color-flag-star");
        expect(star).toHaveLength(12);
        const xs = star.map((c) => c.x);
        const ys = star.map((c) => c.y);
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([3, 7]);
        expect([Math.min(...ys), Math.max(...ys)]).toEqual([1 - PET_FLAG_RISE, 5 - PET_FLAG_RISE]);
        for (const c of flag.filter((c) => c.x === 1 || c.x === 9 || c.y === -PET_FLAG_RISE || c.y === 2)) {
            if (c.x > 0) {
                expect(c.token, `border at ${c.x},${c.y}`).toBe("--color-flag-red");
            }
        }
    });

    // drawn behind the body, which the renderer mirrors; the flag is not, so it stays on the left both ways
    it.each(POSE_NAMES)("is the same flag behind %s, and leaves its body and marks alone", (pose) => {
        expect(flagOf(pose)).toEqual(flagOf("stand"));
        const bare = spriteFor(pose, ["unread"]);
        const flagged = spriteFor(pose, ["unread"], "vn-flag");
        expect(flagged.body).toEqual(bare.body);
        expect(flagged.overlay).toEqual(bare.overlay);
    });

    it.each(MARK_NAMES)("never lands under the %s mark", (mark) => {
        const flag = new Set(flagOf("stand").map((c) => `${c.x},${c.y}`));
        for (const cell of spriteFor("stand", [mark]).overlay) {
            expect(flag.has(`${cell.x},${cell.y}`), `${mark} at ${cell.x},${cell.y}`).toBe(false);
        }
    });

    it("is not there without it, nor with the shirt", () => {
        for (const pose of POSE_NAMES) {
            expect(spriteFor(pose, []).back).toEqual([]);
            expect(spriteFor(pose, [], "vn-shirt").back).toEqual([]);
        }
    });
});

describe("the Minion", () => {
    it("has every pose Sprout has, so the walker can name any of them", () => {
        expect(Object.keys(MINION_POSES).sort()).toEqual([...POSE_NAMES].sort());
    });

    it.each(POSE_NAMES)("%s is 16 rows of 16 cells and stands on the bottom row", (pose) => {
        expect(MINION_POSES[pose]).toHaveLength(PET_GRID);
        for (const row of MINION_POSES[pose]) {
            expect(row).toHaveLength(PET_GRID);
        }
        expect(MINION_POSES[pose][PET_GRID - 1]).not.toBe(".".repeat(PET_GRID));
    });

    // the marks sit at Sprout's cells, so every pose keeps them clear the way Sprout's do
    const stamped: [PetMark, PetPose][] = [
        ["gate", "stand"],
        ["escalation", "stand"],
        ["blocked", "stand"],
        ["z", "sleep"],
        ["drop", "tired"],
        ...POSE_NAMES.map((pose): [PetMark, PetPose] => ["unread", pose]),
    ];

    it.each(stamped)("%s on %s never lands on a drawn body cell", (mark, pose) => {
        const body = drawnCells(MINION_POSES[pose]);
        const { overlay } = spriteFor(pose, [mark], null, "minion");
        expect(overlay.length).toBeGreaterThan(0);
        for (const cell of overlay) {
            expect(body.has(`${cell.x},${cell.y}`), `${mark} at ${cell.x},${cell.y}`).toBe(false);
        }
    });

    it.each(POSE_NAMES)("is what spriteFor draws for %s when chosen, and Sprout stays the default", (pose) => {
        const { body } = spriteFor(pose, [], null, "minion");
        expect(body).toHaveLength(drawnCells(MINION_POSES[pose]).size);
        for (const cell of body) {
            const code = MINION_POSES[pose][cell.y][cell.x];
            expect(cell.token).toBe(PET_TOKENS[code as keyof typeof PET_TOKENS]);
        }
        expect(spriteFor(pose, [])).toEqual(spriteFor(pose, [], null, "sprout"));
    });

    it("wears its own skin and overalls, not the accent", () => {
        const tokens = new Set(spriteFor("stand", [], null, "minion").body.map((c) => c.token));
        expect(tokens.has("--color-minion-skin")).toBe(true);
        expect(tokens.has("--color-minion-denim")).toBe(true);
        expect(tokens.has("--color-accent")).toBe(false);
    });

    it.each(POSE_NAMES)("holds Sprout's flag behind %s, and leaves its body and marks alone", (pose) => {
        const bare = spriteFor(pose, ["unread"], null, "minion");
        const flagged = spriteFor(pose, ["unread"], "vn-flag", "minion");
        expect(flagged.back).toEqual(spriteFor("stand", [], "vn-flag").back);
        expect(flagged.body).toEqual(bare.body);
        expect(flagged.overlay).toEqual(bare.overlay);
    });
});

describe("the Minion's flag shirt", () => {
    const dressed = (pose: PetPose) => outfitRows(pose, "vn-shirt", "minion");

    // the overalls are the shirt: the goggle, the mouth and the outline stay where they are
    it.each(POSE_NAMES)("recolours only the overalls of %s", (pose) => {
        const bare = MINION_POSES[pose];
        dressed(pose).forEach((row, y) => {
            [...row].forEach((code, x) => {
                const was = bare[y][x];
                if (was === "o" || was === "O") {
                    expect(["R", "Y"], `${x},${y}`).toContain(code);
                } else {
                    expect(code, `${x},${y}`).toBe(was);
                }
            });
        });
    });

    // three rows of overalls hold a 5×3 star: the point, the arms, two legs
    const starred: PetPose[] = [
        "walk1",
        "walk2",
        "stand",
        "sit",
        "sleep",
        "speak",
        "music1",
        "music2",
        "ball1",
        "ball2",
    ];
    it.each(starred)("draws the whole star on %s", (pose) => {
        expect(cellsOf(dressed(pose), "Y")).toHaveLength(8);
    });

    it("centres the star's point on the bib, standing", () => {
        expect(dressed("stand").slice(12, 15)).toEqual(["...jjRRYRRRjj...", "...RRYYYYYRRR...", "...RRRYRYRRRR..."]);
    });

    it("is hidden while reading: the book on its lap covers the overalls", () => {
        expect(dressed("read1")).toEqual(MINION_POSES.read1);
        expect(dressed("read2")).toEqual(MINION_POSES.read2);
    });

    it("leaves a pose bare without the shirt, the flag included", () => {
        for (const pose of POSE_NAMES) {
            expect(outfitRows(pose, null, "minion")).toBe(MINION_POSES[pose]);
            expect(outfitRows(pose, "vn-flag", "minion")).toBe(MINION_POSES[pose]);
        }
    });

    it("fills the shirt with the flag tokens through spriteFor, and leaves the marks alone", () => {
        const bare = spriteFor("stand", ["blocked"], null, "minion");
        const shirt = spriteFor("stand", ["blocked"], "vn-shirt", "minion");
        expect(shirt.overlay).toEqual(bare.overlay);
        expect(shirt.back).toEqual([]);
        const tokens = new Set(shirt.body.map((c) => c.token));
        expect(tokens.has("--color-flag-red")).toBe(true);
        expect(tokens.has("--color-flag-star")).toBe(true);
        expect(tokens.has("--color-minion-denim")).toBe(false);
        expect(shirt.body).toHaveLength(bare.body.length);
    });
});
