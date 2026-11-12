import { describe, expect, it } from "vitest";
import type { AgentAskQuestion } from "./agentsviewmodel";
import { enterAction, pickAdvance, walksAsk } from "./askflow";

const single = (question: string): AgentAskQuestion => ({
    question,
    options: [{ label: "a" }, { label: "b" }],
});
const multi = (question: string): AgentAskQuestion => ({ ...single(question), multiSelect: true });

describe("walksAsk", () => {
    it("only an ask of several questions is walked", () => {
        expect(walksAsk([])).toBe(false);
        expect(walksAsk([single("only")])).toBe(false);
        expect(walksAsk([single("q1"), single("q2")])).toBe(true);
    });
});

describe("pickAdvance", () => {
    it("pickAdvance moves to the next unanswered question", () => {
        const qs = [single("q1"), single("q2"), single("q3")];
        expect(pickAdvance(qs, { 0: new Set([0]) }, {}, 0)).toBe(1);
        // a typed answer counts as answered, so the pick skips past it
        expect(pickAdvance(qs, { 0: new Set([1]) }, { 1: "mine" }, 0)).toBe(2);
    });

    it("pickAdvance stays on multi-select", () => {
        const qs = [multi("q1"), single("q2")];
        expect(pickAdvance(qs, { 0: new Set([0]) }, {}, 0)).toBeNull();
    });

    it("pickAdvance stays when nothing else is unanswered", () => {
        const qs = [single("q1"), single("q2")];
        expect(pickAdvance(qs, { 0: new Set([0]), 1: new Set([1]) }, {}, 1)).toBeNull();
    });

    it("pickAdvance does not advance a single-question ask", () => {
        expect(pickAdvance([single("only")], { 0: new Set([0]) }, {}, 0)).toBeNull();
        expect(pickAdvance([single("only")], {}, {}, 0)).toBeNull();
        expect(pickAdvance([], {}, {}, 0)).toBeNull();
    });
});

describe("enterAction", () => {
    it("enterAction submits when every question is answered", () => {
        const qs = [single("q1"), multi("q2")];
        expect(enterAction(qs, { 0: new Set([0]), 1: new Set([0, 1]) }, {}, 1)).toEqual({ kind: "submit" });
        expect(enterAction(qs, { 0: new Set([0]) }, { 1: "typed" }, 0)).toEqual({ kind: "submit" });
    });

    it("enterAction moves to the first unanswered question", () => {
        const qs = [single("q1"), single("q2"), single("q3")];
        expect(enterAction(qs, { 0: new Set([0]) }, {}, 0)).toEqual({ kind: "question", qi: 1 });
        // the active question, when unanswered, is where Enter stays
        expect(enterAction(qs, { 0: new Set([0]) }, {}, 2)).toEqual({ kind: "question", qi: 2 });
        // whitespace-only text is not an answer
        expect(enterAction(qs, { 0: new Set([0]), 2: new Set([1]) }, { 1: "  " }, 2)).toEqual({
            kind: "question",
            qi: 1,
        });
    });

    it("enterAction does not walk a single-question ask: the caller keeps what it did", () => {
        // unanswered: the caller still opens focus, where a walk would stay on the question
        expect(enterAction([single("only")], {}, {}, 0)).toBeNull();
        // answered: the caller's own submit check sends it, as before
        expect(enterAction([single("only")], { 0: new Set([1]) }, {}, 0)).toBeNull();
        expect(enterAction([], {}, {}, 0)).toBeNull();
    });
});
