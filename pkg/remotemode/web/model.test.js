import { describe, expect, it } from "vitest";
import {
    answerText,
    base64UrlToBytes,
    buildAnswers,
    countsLine,
    formatAge,
    optionCountLine,
    shownWord,
    splitRecommended,
    viewState,
} from "./static/model.js";

const MIN = 60 * 1000;
const question = (over = {}) => ({
    question: "Start the 6 tasks now?",
    header: "Plan review",
    options: [{ label: "Start now (Recommended)" }, { label: "Hold" }, { label: "Cancel" }],
    ...over,
});
const held = (key) => ({ key, kind: "run-land-held", title: "t", project: "p", waitingsince: 0, reason: "r" });

describe("viewState", () => {
    it("is unreachable after a fetch error, even with no list", () => {
        expect(viewState(null, new Error("offline"))).toBe("unreachable");
        expect(viewState({ questions: [], shown: [] }, new Error("offline"))).toBe("unreachable");
    });

    it("is empty for an empty list without an error", () => {
        expect(viewState({ questions: [], shown: [] }, null)).toBe("empty");
        expect(viewState({}, null)).toBe("empty");
    });

    it("is main when anything waits", () => {
        expect(viewState({ questions: [{ key: "ask:a" }], shown: [] }, null)).toBe("main");
        expect(viewState({ questions: [], shown: [held("h")] }, null)).toBe("main");
    });

    it("is main with only hand-overs", () => {
        expect(viewState({ questions: [], handed: [{ tab: "t" }], shown: [] }, null)).toBe("main");
    });
});

describe("countsLine", () => {
    it("counts questions and held runs with plurals", () => {
        const list = { questions: [{}, {}], shown: [held("a"), held("b")] };
        expect(countsLine(list)).toBe("2 questions to answer · 2 runs held");
    });

    it("uses singulars", () => {
        expect(countsLine({ questions: [{}], shown: [held("a")] })).toBe("1 question to answer · 1 run held");
    });

    it("counts other shown kinds as other and leaves out zero parts", () => {
        const list = { questions: [], shown: [{ kind: "dag-blocked" }, { kind: "escalation" }, held("a")] };
        expect(countsLine(list)).toBe("1 run held · 2 other");
    });

    it("puts hand-overs between questions and held runs", () => {
        const list = { questions: [{}], handed: [{}, {}, {}], shown: [held("a")] };
        expect(countsLine(list)).toBe("1 question to answer · 3 agents handed over · 1 run held");
    });

    it("counts one hand-over in the singular", () => {
        expect(countsLine({ questions: [], handed: [{}], shown: [] })).toBe("1 agent handed over");
    });

    it("says nothing is waiting for an empty list", () => {
        expect(countsLine({ questions: [], shown: [] })).toBe("Nothing waiting");
    });
});

describe("formatAge", () => {
    it("formats minutes, hours with minutes, and days", () => {
        expect(formatAge(12 * MIN)).toBe("12m");
        expect(formatAge(134 * MIN)).toBe("2h 14m");
        expect(formatAge(120 * MIN)).toBe("2h");
        expect(formatAge(3 * 24 * 60 * MIN + 5 * 60 * MIN)).toBe("3d");
    });

    it("never shows a negative or zero wait", () => {
        expect(formatAge(30 * 1000)).toBe("<1m");
        expect(formatAge(-5 * MIN)).toBe("<1m");
    });
});

describe("optionCountLine", () => {
    it("counts a single question's options", () => {
        expect(optionCountLine({ questions: [question()] })).toBe("3 options");
        expect(optionCountLine({ questions: [question({ options: [{ label: "Yes" }] })] })).toBe("1 option");
    });

    it("marks a multi-select question", () => {
        expect(optionCountLine({ questions: [question({ multiselect: true })] })).toBe("3 options · pick any");
    });

    it("counts the questions of a multi-question ask", () => {
        expect(optionCountLine({ questions: [question(), question()] })).toBe("2 questions");
    });

    it("asks for typing when there are no options", () => {
        expect(optionCountLine({ questions: [question({ options: [] })] })).toBe("Type an answer");
    });
});

describe("splitRecommended", () => {
    it("strips the marker and flags it", () => {
        expect(splitRecommended("Start now (Recommended)")).toEqual({ label: "Start now", recommended: true });
        expect(splitRecommended("Hold")).toEqual({ label: "Hold", recommended: false });
    });
});

describe("buildAnswers", () => {
    it("returns one item per question from picks", () => {
        expect(buildAnswers([question()], [[1]], [])).toEqual([{ selectedindexes: [1] }]);
    });

    it("returns null while any question of a multi-question ask is unanswered", () => {
        const qs = [question(), question({ multiselect: true })];
        expect(buildAnswers(qs, [[0]], [])).toBeNull();
        expect(buildAnswers(qs, [[0], []], ["", "  "])).toBeNull();
        expect(buildAnswers(qs, [[0], [2]], [])).toEqual([{ selectedindexes: [0] }, { selectedindexes: [2] }]);
    });

    it("gives every picked index of a multi-select question, ascending", () => {
        const qs = [question({ multiselect: true })];
        expect(buildAnswers(qs, [[2, 0]], [])).toEqual([{ selectedindexes: [0, 2] }]);
    });

    it("lets typed text win over a pick", () => {
        expect(buildAnswers([question()], [[0]], [" not yet "])).toEqual([{ text: "not yet" }]);
    });

    it("counts typed text alone as an answer", () => {
        expect(buildAnswers([question()], [], ["later"])).toEqual([{ text: "later" }]);
    });

    it("sends a prose ask's picked label as text", () => {
        expect(buildAnswers([question()], [[1]], [], true)).toEqual([{ text: "Hold" }]);
    });
});

describe("answerText", () => {
    it("joins typed answers and picked labels without the recommended marker", () => {
        const qs = [question(), question({ multiselect: true })];
        expect(answerText(qs, [{ selectedindexes: [0] }, { selectedindexes: [1, 2] }])).toBe("Start now, Hold, Cancel");
        expect(answerText(qs, [{ text: "wait" }, { selectedindexes: [1] }])).toBe("wait, Hold");
    });
});

describe("shownWord", () => {
    it("names every shown-only kind", () => {
        expect(shownWord("run-land-held")).toBe("Held");
        expect(shownWord("dag-blocked")).toBe("Blocked");
        expect(shownWord("escalation")).toBe("Escalated");
        expect(shownWord("run-unverified")).toBe("Unverified");
        expect(shownWord("workflow-scan")).toBe("Workflow scan");
    });
});

describe("base64UrlToBytes", () => {
    it("decodes unpadded base64url", () => {
        // 0xfb 0xff 0xbf encodes to "-_-_" in base64url, "+/+/" in base64
        expect(Array.from(base64UrlToBytes("-_-_"))).toEqual([0xfb, 0xff, 0xbf]);
        expect(Array.from(base64UrlToBytes("AQ"))).toEqual([1]);
    });
});
