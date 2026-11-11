import { describe, expect, it } from "vitest";
import { btwNotice, btwPrompt, forkFailure, parseBtwNotice } from "./btw-core";

describe("btwNotice and parseBtwNotice", () => {
    it("reads back the question and the answer it wrote", () => {
        const text = btwNotice("which file holds the goal band?", {
            answer: "  `goal-band.tsx`, under hooks.\n\nIt draws the strip.  ",
        });
        expect(text).toBe("/btw which file holds the goal band?\n`goal-band.tsx`, under hooks.\n\nIt draws the strip.");
        expect(parseBtwNotice(text)).toEqual({
            question: "which file holds the goal band?",
            answer: "`goal-band.tsx`, under hooks.\n\nIt draws the strip.",
        });
    });

    it("puts a question of several lines on one", () => {
        const text = btwNotice("why\n  this?", { answer: "because" });
        expect(parseBtwNotice(text)).toEqual({ question: "why this?", answer: "because" });
    });

    it("reads back why there was no answer", () => {
        const text = btwNotice("q", { failure: "the API answered an error (529)" });
        expect(parseBtwNotice(text)).toEqual({ question: "q", failure: "the API answered an error (529)" });
    });

    it("is null for any other notice", () => {
        expect(parseBtwNotice("arc: read mid-turn: hi")).toBeNull();
        expect(parseBtwNotice("/btw no answer line")).toBeNull();
        expect(parseBtwNotice("/btw \nan answer with no question")).toBeNull();
        expect(parseBtwNotice("/btwq\nx")).toBeNull();
    });
});

describe("btwPrompt", () => {
    it("asks for one answer with no tools, then the question", () => {
        const p = btwPrompt("which file?");
        expect(p).toMatch(/side question/);
        expect(p).toMatch(/no tools/);
        expect(p.trimEnd().endsWith("which file?")).toBe(true);
    });
});

describe("forkFailure", () => {
    it("says each reason in words", () => {
        expect(forkFailure({ reason: "nothing-to-fork" })).toMatch(/not finished a turn/);
        expect(forkFailure({ reason: "api-error", status: 529 })).toBe("the API answered an error (529)");
        expect(forkFailure({ reason: "api-error", status: null })).toBe("the API answered an error");
        expect(forkFailure({ reason: "empty-reply" })).toBe("the reply was empty");
        expect(forkFailure({ reason: "aborted" })).toBe("it was cut off");
    });
});
