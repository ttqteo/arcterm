import { describe, expect, it } from "vitest";
import { waitFor } from "./attach.mjs";

// an ev that answers from a script of results, one per call; an Error entry throws like a destroyed context
const scripted = (answers) => {
    let calls = 0;
    const ev = async () => {
        const a = answers[Math.min(calls++, answers.length - 1)];
        if (a instanceof Error) throw a;
        return a;
    };
    return { ev, calls: () => calls };
};

describe("waitFor", () => {
    it("keeps polling through a reload's destroyed context until the expression holds", async () => {
        const s = scripted([new Error("Execution context was destroyed"), false, true]);
        expect(await waitFor(s.ev, "x", 1000, 1)).toBe(true);
        expect(s.calls()).toBe(3);
    });

    it("is false once the time runs out on an expression that never holds", async () => {
        const s = scripted([false]);
        expect(await waitFor(s.ev, "x", 20, 5)).toBe(false);
        expect(s.calls()).toBeGreaterThan(1);
    });

    it("answers at once when the expression already holds", async () => {
        const s = scripted([true]);
        expect(await waitFor(s.ev, "x", 0)).toBe(true);
        expect(s.calls()).toBe(1);
    });
});
