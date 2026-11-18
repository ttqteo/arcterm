import { describe, expect, it } from "vitest";
import {
    agentProject,
    answerText,
    base64UrlToBytes,
    buildAnswers,
    countsLine,
    failReason,
    formatAge,
    listedAgents,
    needYouCount,
    needYouTitle,
    optionCountLine,
    runCounts,
    runWorkerText,
    shownWord,
    splitRecommended,
    takeNotice,
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

    it("is main with only a run, and empty again with an empty runs array", () => {
        const run = { key: "dag-1", name: "A run", needsyou: false, workers: [{ tab: "w", state: "working" }] };
        expect(viewState({ questions: [], shown: [], handed: [], agents: [], runs: [run] }, null)).toBe("main");
        expect(viewState({ questions: [], shown: [], handed: [], agents: [], runs: [] }, null)).toBe("empty");
        expect(viewState({ questions: [], shown: [], pc: true }, null)).toBe("empty");
    });
});

const agent = (tab, state, over = {}) => ({ tab, name: tab, project: "", state, ...over });
const worker = (tab, state) => ({ tab, label: tab, state, line: "", since: 0 });
const run = (key, workers, over = {}) => ({ key, name: key, needsyou: false, workers, ...over });

describe("needYouCount", () => {
    it("is zero for nothing, null and an empty list", () => {
        expect(needYouCount(null)).toBe(0);
        expect(needYouCount({})).toBe(0);
        expect(needYouCount({ questions: [], shown: [], handed: [], agents: [], runs: [] })).toBe(0);
    });

    it("counts open questions and shown attention items", () => {
        expect(needYouCount({ questions: [{}, {}], shown: [held("a")] })).toBe(3);
    });

    it("counts a handed-over or listed agent that needs approval or input, not one that works or idles", () => {
        const list = {
            handed: [agent("h1", "permission", { handed: true }), agent("h2", "working", { handed: true })],
            agents: [agent("a1", "input"), agent("a2", "idle"), agent("a3", "working")],
        };
        expect(needYouCount(list)).toBe(2);
    });

    it("counts a handed agent once although agents repeats it", () => {
        const handed = agent("h1", "permission", { handed: true });
        expect(needYouCount({ handed: [handed], agents: [{ ...handed }] })).toBe(1);
    });

    it("does not count an asking agent: its question is counted", () => {
        const list = {
            questions: [{ key: "ask:a" }],
            handed: [agent("h1", "asking", { handed: true })],
            agents: [agent("h1", "asking", { handed: true }), agent("a2", "asking")],
            runs: [run("r", [worker("w1", "asking")])],
        };
        expect(needYouCount(list)).toBe(1);
    });

    it("counts a run's workers that need approval or input, once per tab", () => {
        const list = {
            runs: [
                run("r1", [worker("w1", "permission"), worker("w2", "working"), worker("w3", "input")]),
                run("r2", [worker("w1", "permission"), worker("w4", "idle")]),
            ],
        };
        // w1 appears under both runs: one tab
        expect(needYouCount(list)).toBe(2);
    });

    it("adds every source: questions, shown items, agents and workers", () => {
        const list = {
            questions: [{}],
            shown: [held("a"), { kind: "dag-blocked" }],
            handed: [agent("h", "permission", { handed: true })],
            agents: [agent("h", "permission", { handed: true }), agent("a", "input")],
            runs: [run("r", [worker("w", "permission")])],
        };
        expect(needYouCount(list)).toBe(1 + 2 + 3);
    });
});

describe("needYouTitle", () => {
    it("says nothing waits, one needs you, and N need you", () => {
        expect(needYouTitle(null)).toBe("Nothing waits on you");
        expect(needYouTitle({ questions: [], shown: [] })).toBe("Nothing waits on you");
        expect(needYouTitle({ questions: [{}] })).toBe("1 needs you");
        expect(needYouTitle({ questions: [{}, {}], shown: [held("a")] })).toBe("3 need you");
    });
});

describe("agentProject", () => {
    it("shows the project only when it differs from the name", () => {
        expect(agentProject({ name: "arcterm", project: "arcterm" })).toBe("");
        expect(agentProject({ name: "Arcterm ", project: "arcterm" })).toBe("");
        expect(agentProject({ name: "bench-runner", project: "arcterm" })).toBe("arcterm");
    });

    it("shows nothing for an agent with no project", () => {
        expect(agentProject({ name: "a", project: "" })).toBe("");
        expect(agentProject({ name: "a" })).toBe("");
        expect(agentProject(null)).toBe("");
    });
});

describe("runCounts", () => {
    it("counts the workers by state, running first and what waits after", () => {
        const workers = [
            worker("a", "permission"),
            worker("b", "working"),
            worker("c", "working"),
            worker("d", "working"),
        ];
        expect(runCounts(run("r", workers))).toBe("3 working · 1 needs approval");
    });

    it("words a plural of a waiting state as need", () => {
        const workers = [
            worker("a", "permission"),
            worker("b", "permission"),
            worker("c", "input"),
            worker("d", "idle"),
        ];
        expect(runCounts(run("r", workers))).toBe("2 need approval · 1 needs input · 1 idle");
    });

    it("reads one state alone", () => {
        expect(runCounts(run("r", [worker("a", "working")]))).toBe("1 working");
    });

    it("orders asking after working and keeps an unknown state, last", () => {
        const workers = [worker("a", "idle"), worker("b", "asking"), worker("c", "working"), worker("d", "weird")];
        expect(runCounts(run("r", workers))).toBe("1 working · 1 asking · 1 idle · 1 weird");
    });

    it("is empty without workers", () => {
        expect(runCounts(run("r", []))).toBe("");
        expect(runCounts({ key: "r" })).toBe("");
        expect(runCounts(null)).toBe("");
    });
});

describe("runWorkerText", () => {
    it("joins the label and the line, leaving out what is missing", () => {
        expect(runWorkerText({ label: "Review: Task 2", line: "Reading main.go" })).toBe(
            "Review: Task 2 · Reading main.go"
        );
        expect(runWorkerText({ label: "Verifier", line: "" })).toBe("Verifier");
        expect(runWorkerText({ line: "Running tests" })).toBe("Running tests");
    });
});

describe("takeNotice", () => {
    it("quotes the reason of a refused take", () => {
        expect(takeNotice(409, "codex sessions cannot be handed over")).toBe(
            "Not taken: codex sessions cannot be handed over"
        );
    });

    it("says what happened when nothing answered or the answer was not a refusal", () => {
        expect(takeNotice(null, "")).toBe("Not taken: arcterm is not reachable");
        expect(takeNotice(0, "")).toBe("Not taken: the login expired, reload the page");
        expect(takeNotice(500, "disk full")).toBe("Not taken: arcterm answered 500");
        expect(takeNotice(409, "")).toBe("Not taken: arcterm answered 409");
    });
});

describe("failReason", () => {
    it("prefers the server's reason", () => {
        expect(failReason(501, "Not supported on this computer")).toBe("Not supported on this computer");
        expect(failReason(500, "")).toBe("arcterm answered 500");
    });
});

describe("listedAgents", () => {
    it("lists every agent but the ones under Handed over", () => {
        const list = { handed: [{ tab: "b" }], agents: [{ tab: "a" }, { tab: "b" }, { tab: "c" }] };
        expect(listedAgents(list).map((a) => a.tab)).toEqual(["a", "c"]);
        expect(listedAgents({})).toEqual([]);
        expect(listedAgents(null)).toEqual([]);
    });

    it("makes the view main when only agents are listed", () => {
        expect(viewState({ questions: [], shown: [], agents: [{ tab: "a" }] }, null)).toBe("main");
        const allHanded = { questions: [], shown: [], handed: [], agents: [{ tab: "a" }] };
        expect(viewState({ ...allHanded, handed: [{ tab: "a" }] }, null)).toBe("main");
        expect(viewState({ questions: [], shown: [], handed: [], agents: [] }, null)).toBe("empty");
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

    it("names an agent that waits on approval, so the line accounts for the title", () => {
        const list = { agents: [agent("a1", "permission")] };
        expect(needYouTitle(list)).toBe("1 needs you");
        expect(countsLine(list)).toBe("1 needs approval");
    });

    it("words approval and input in the singular and the plural", () => {
        const list = {
            agents: [agent("a1", "permission"), agent("a2", "permission"), agent("a3", "input")],
            runs: [run("r", [worker("w1", "input")])],
        };
        expect(countsLine(list)).toBe("2 need approval · 2 need input");
    });

    it("counts a permission tab once although handed and agents both hold it", () => {
        const handed = agent("h1", "permission", { handed: true });
        const list = { handed: [handed], agents: [{ ...handed }] };
        expect(countsLine(list)).toBe("1 needs approval · 1 agent handed over");
    });

    it("counts a run worker that waits on input", () => {
        const list = { runs: [run("r", [worker("w1", "input"), worker("w2", "working")])] };
        expect(countsLine(list)).toBe("1 needs input");
    });

    it("adds nothing for an asking agent: its question is the count", () => {
        const list = {
            questions: [{ key: "ask:a" }],
            handed: [agent("h1", "asking", { handed: true })],
            agents: [agent("h1", "asking", { handed: true }), agent("a2", "asking")],
            runs: [run("r", [worker("w1", "asking")])],
        };
        expect(countsLine(list)).toBe("1 question to answer · 1 agent handed over");
    });

    it("orders questions, approval, input, hand-overs, held runs, other", () => {
        const list = {
            questions: [{}],
            shown: [held("a"), { kind: "dag-blocked" }],
            handed: [agent("h1", "permission", { handed: true }), agent("h2", "working", { handed: true })],
            agents: [agent("h1", "permission", { handed: true }), agent("a1", "input")],
            runs: [run("r", [worker("w1", "permission")])],
        };
        expect(countsLine(list)).toBe(
            "1 question to answer · 2 need approval · 1 needs input · 2 agents handed over · 1 run held · 1 other"
        );
    });

    // the title's number is the sum of the line's numbers but the hand-overs, which repeat agents already
    // counted (or work or idle), so the line never reads "Nothing waiting" under "N need you"
    describe("against needYouCount", () => {
        const lists = {
            nothing: {},
            onlyPermission: { agents: [agent("a1", "permission")] },
            onlyInput: { runs: [run("r", [worker("w1", "input")])] },
            handedOnly: { handed: [agent("h1", "working", { handed: true })] },
            handedAndListed: {
                handed: [agent("h1", "permission", { handed: true })],
                agents: [agent("h1", "permission", { handed: true }), agent("a2", "input")],
            },
            everything: {
                questions: [{}, {}],
                shown: [held("a"), held("b"), { kind: "escalation" }],
                handed: [agent("h1", "permission", { handed: true }), agent("h2", "asking", { handed: true })],
                agents: [agent("h1", "permission", { handed: true }), agent("a1", "input"), agent("a2", "idle")],
                runs: [
                    run("r1", [worker("w1", "permission"), worker("w2", "input"), worker("w3", "working")]),
                    run("r2", [worker("w1", "permission"), worker("w4", "asking")]),
                ],
            },
        };

        for (const [name, list] of Object.entries(lists)) {
            it(`adds up to needYouCount: ${name}`, () => {
                const parts = countsLine(list) === "Nothing waiting" ? [] : countsLine(list).split(" · ");
                const sum = parts
                    .filter((p) => !p.endsWith("handed over"))
                    .reduce((total, p) => total + Number.parseInt(p, 10), 0);
                expect(sum).toBe(needYouCount(list));
            });

            it(`reads Nothing waiting only with nothing counted and nothing handed over: ${name}`, () => {
                const nothing = needYouCount(list) === 0 && (list.handed ?? []).length === 0;
                expect(countsLine(list) === "Nothing waiting").toBe(nothing);
            });
        }
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
