// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    MARKS,
    PET_CELL_PX,
    PET_GRID,
    PET_PX,
    PET_TOKENS,
    POSES,
    spriteFor,
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

    it("has exactly the eight poses of the spec", () => {
        expect([...POSE_NAMES].sort()).toEqual(
            ["dangle", "sit", "sleep", "speak", "stand", "tired", "walk1", "walk2"].sort()
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
    for (const rows of [...Object.values(POSES), ...Object.values(MARKS).map((m) => m.rows)]) {
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

    it("maps exactly the eight codes of the spec", () => {
        expect(PET_TOKENS).toEqual({
            b: "--color-accent",
            d: "--color-accent-600",
            l: "--color-accent-200",
            k: "--color-background",
            w: "--color-primary",
            m: "--color-muted",
            r: "--color-error",
            y: "--color-asking",
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
