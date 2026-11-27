// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chunkSteps, type StepRow } from "./chunksteps";

const row = (label: string, extra: Partial<StepRow> = {}): StepRow => ({ label, status: "pending", ...extra });
const none = () => false;

describe("chunkSteps", () => {
    // a plan of three chunks with one saved for later in the middle, as the server lists them
    const rows = [row("a"), row("L", { later: true }), row("b"), row("c")];

    it("counts and steps through the plan's chunks only, a later chunk in the middle left out", () => {
        expect(chunkSteps(rows, "b", none)).toEqual({ n: 2, total: 3, prev: "a", next: "c", later: false });
        expect(chunkSteps(rows, "a", none)).toEqual({ n: 1, total: 3, prev: null, next: "b", later: false });
        expect(chunkSteps(rows, "c", none)).toEqual({ n: 3, total: 3, prev: "b", next: null, later: false });
    });

    it("gives a later chunk no place in the plan: no position, no prev and no next", () => {
        expect(chunkSteps(rows, "L", none)).toEqual({ n: 0, total: 0, prev: null, next: null, later: true });
    });

    it("a plan of later chunks alone still gives each no place", () => {
        const only = [row("x", { later: true }), row("y", { later: true })];
        expect(chunkSteps(only, "y", none)).toEqual({ n: 0, total: 0, prev: null, next: null, later: true });
    });

    it("leaves proposed chunks out of the list, and a proposed chunk steps in at the plan's ends", () => {
        const withProposed = [row("a"), row("p", { status: "proposed" }), row("b")];
        expect(chunkSteps(withProposed, "a", none)).toMatchObject({ n: 1, total: 2, next: "b" });
        expect(chunkSteps(withProposed, "p", none)).toEqual({ n: 0, total: 2, prev: "b", next: "a", later: false });
    });

    it("leaves out a chunk waiting out its delete", () => {
        const gone = (label: string) => label === "b";
        expect(chunkSteps(rows, "a", gone)).toMatchObject({ n: 1, total: 2, next: "c" });
        expect(chunkSteps(rows, "c", gone)).toMatchObject({ n: 2, total: 2, prev: "a" });
    });

    it("a later chunk waiting out its delete is still a later chunk", () => {
        expect(chunkSteps(rows, "L", (l) => l === "L")).toMatchObject({ n: 0, total: 0, later: true });
    });

    it("a label the list does not hold steps in at the plan's ends and is not later", () => {
        expect(chunkSteps(rows, "nope", none)).toEqual({ n: 0, total: 3, prev: "c", next: "a", later: false });
    });

    it("an empty plan has nothing to step to", () => {
        expect(chunkSteps([], "a", none)).toEqual({ n: 0, total: 0, prev: null, next: null, later: false });
    });
});
