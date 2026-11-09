// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { moveFailedToast, moveHintLabel, planMove } from "./railmove";

describe("planMove", () => {
    it("moves a file into a folder", () => {
        expect(planMove(["docs/a.pdf"], "docs/slide")).toEqual({
            moves: [{ from: "docs/a.pdf", to: "docs/slide/a.pdf" }],
            skipped: [],
        });
    });

    it("moves into the root", () => {
        expect(planMove(["docs/a.pdf"], "").moves).toEqual([{ from: "docs/a.pdf", to: "a.pdf" }]);
    });

    it("strips a folder's trailing slash", () => {
        expect(planMove(["docs/old/"], "src").moves).toEqual([{ from: "docs/old", to: "src/old" }]);
    });

    it("leaves out an item already in the folder, silently", () => {
        expect(planMove(["docs/slide/a.pdf"], "docs/slide")).toEqual({ moves: [], skipped: [] });
        expect(planMove(["a.pdf"], "")).toEqual({ moves: [], skipped: [] });
    });

    it("moves an item inside a dragged folder with the folder", () => {
        expect(planMove(["docs/old/", "docs/old/x.pdf"], "src").moves).toEqual([{ from: "docs/old", to: "src/old" }]);
    });

    it("refuses a folder into itself or below it", () => {
        expect(planMove(["docs/"], "docs").skipped).toEqual([]); // its own row: no move, said nowhere
        expect(planMove(["docs/"], "docs/slide")).toEqual({
            moves: [],
            skipped: [{ name: "docs", reason: "a folder cannot go inside itself" }],
        });
    });

    it("does not take a shared prefix for a parent", () => {
        expect(planMove(["src/util/"], "src/utilities").moves).toEqual([
            { from: "src/util", to: "src/utilities/util" },
        ]);
    });

    it("moves only the first of two items with one name", () => {
        const plan = planMove(["a/x.ts", "b/x.ts"], "c");
        expect(plan.moves).toEqual([{ from: "a/x.ts", to: "c/x.ts" }]);
        expect(plan.skipped).toEqual([{ name: "b/x.ts", reason: "another item named “x.ts” is moving there" }]);
    });
});

describe("move words", () => {
    it("names the folder", () => {
        expect(moveHintLabel("docs/slide")).toBe("Drop to move into docs/slide/");
        expect(moveHintLabel("")).toBe("Drop to move into the project root");
    });

    it("toasts what did not move", () => {
        expect(moveFailedToast([])).toBeNull();
        expect(moveFailedToast([{ name: "a.pdf", reason: "already exists" }])).toEqual({
            title: "Couldn't move “a.pdf”",
            message: "already exists",
        });
    });
});
