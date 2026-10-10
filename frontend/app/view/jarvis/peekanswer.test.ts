import type { AgentAskQuestion } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import { formKey, questionAfterPick } from "./peekanswer";

const single = (header: string): AgentAskQuestion => ({
    header,
    question: `${header}?`,
    options: [{ label: "A" }, { label: "B" }, { label: "C" }],
});
const multi: AgentAskQuestion = {
    header: "Pick",
    question: "Which?",
    multiSelect: true,
    options: [{ label: "X" }, { label: "Y" }],
};
const TWO = [single("Scope"), single("Order")];

describe("formKey — the peek's answer form, from the keyboard", () => {
    it("toggles the active question's option by its digit", () => {
        expect(formKey("2", TWO, 1, {}, {})).toEqual({ kind: "toggle", qi: 1, oi: 1 });
    });

    it("lets a digit with no such option pass", () => {
        expect(formKey("4", TWO, 0, {}, {})).toBeNull();
        expect(formKey("0", TWO, 0, {}, {})).toBeNull();
    });

    it("moves between questions with the arrows, stopping at either end", () => {
        expect(formKey("ArrowRight", TWO, 0, {}, {})).toEqual({ kind: "question", qi: 1 });
        expect(formKey("ArrowLeft", TWO, 1, {}, {})).toEqual({ kind: "question", qi: 0 });
        expect(formKey("ArrowRight", TWO, 1, {}, {})).toBeNull();
        expect(formKey("ArrowLeft", TWO, 0, {}, {})).toBeNull();
    });

    it("has no questions to move between in a one-question ask", () => {
        expect(formKey("ArrowRight", [multi], 0, {}, {})).toBeNull();
    });

    it("sends on Enter once every question has an answer", () => {
        const sel = { 0: new Set([0]), 1: new Set([2]) };
        expect(formKey("Enter", TWO, 1, sel, {})).toEqual({ kind: "submit" });
    });

    it("counts a typed answer as an answer", () => {
        expect(formKey("Enter", TWO, 1, { 0: new Set([0]) }, { 1: "neither" })).toEqual({ kind: "submit" });
    });

    it("takes an unfinished Enter to the first question still unanswered", () => {
        expect(formKey("Enter", TWO, 0, { 0: new Set([1]) }, {})).toEqual({ kind: "question", qi: 1 });
        expect(formKey("Enter", TWO, 1, { 1: new Set([1]) }, {})).toEqual({ kind: "question", qi: 0 });
    });

    it("folds the form on Escape", () => {
        expect(formKey("Escape", TWO, 0, {}, {})).toEqual({ kind: "collapse" });
    });

    it("leaves every other key to the queue", () => {
        for (const key of ["j", "k", "ArrowDown", " ", "/", "a"]) {
            expect(formKey(key, TWO, 0, {}, {})).toBeNull();
        }
    });
});

describe("questionAfterPick — where a picked option leaves the form", () => {
    it("moves a single pick on to the next question still unanswered", () => {
        expect(questionAfterPick([single("a"), single("b"), single("c")], 0, { 0: new Set([1]) }, {})).toBe(1);
        expect(questionAfterPick([single("a"), single("b"), single("c")], 2, { 2: new Set([0]) }, {})).toBe(0);
    });

    it("stays on a multi-select question, which takes more than one pick", () => {
        expect(questionAfterPick([multi, single("b")], 0, { 0: new Set([0]) }, {})).toBe(0);
    });

    it("stays put once nothing is left unanswered, so Enter sends", () => {
        const sel = { 0: new Set([0]), 1: new Set([1]) };
        expect(questionAfterPick(TWO, 1, sel, {})).toBe(1);
    });
});
