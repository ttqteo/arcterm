import { describe, expect, it } from "vitest";
import {
    SLOW_MS,
    agentAlive,
    askAllowed,
    boardFacts,
    drawnSummary,
    elapsedLabel,
    recentTurns,
    talkTime,
    turnText,
    turnView,
    type TurnShown,
} from "./boardtalkmodel";

const NOW = new Date(2026, 10, 19, 15, 30).getTime();

function turn(over: Partial<BoardTurn> = {}): BoardTurn {
    return { id: "t1", ts: NOW - 5_000, kind: "ask", state: "answered", ...over };
}

function talk(turns: BoardTurn[]): BoardTalk {
    return { project: "arcterm", boardid: "b1", turns };
}

describe("turnView: the shown state", () => {
    it("maps every wire state", () => {
        const shown: Record<string, TurnShown> = {
            waiting: "waiting",
            answering: "answering",
            answered: "drawn",
            forwarded: "forwarded",
            failed: "failed",
            stopped: "stopped",
        };
        for (const [state, want] of Object.entries(shown)) {
            expect(turnView(turn({ state, startedts: NOW - 1_000 }), NOW).state).toBe(want);
        }
    });

    it("reads an unknown state as waiting, with no buttons", () => {
        const v = turnView(turn({ state: "from-a-newer-wavesrv", shapeids: ["a"] }), NOW);
        expect(v).toMatchObject({ state: "waiting", canShow: false, otherWay: null });
    });

    it("counts answering seconds from when the turn started", () => {
        const v = turnView(turn({ state: "answering", ts: NOW - 60_000, startedts: NOW - 12_900 }), NOW);
        expect(v).toMatchObject({ state: "answering", seconds: 12 });
    });

    it("counts from the ask when the turn has no start yet", () => {
        expect(turnView(turn({ state: "answering", ts: NOW - 7_000 }), NOW).seconds).toBe(7);
    });

    it("turns slow at 45 s, not before", () => {
        expect(SLOW_MS).toBe(45_000);
        const at = (ms: number) => turnView(turn({ state: "answering", startedts: NOW - ms }), NOW);
        expect(at(SLOW_MS - 1).state).toBe("answering");
        expect(at(SLOW_MS).state).toBe("slow");
        expect(at(60_000)).toMatchObject({ state: "slow", seconds: 60 });
    });

    it("has no seconds once the turn is over", () => {
        expect(turnView(turn({ state: "answered", startedts: NOW - 30_000 }), NOW).seconds).toBe(0);
        expect(turnView(turn({ state: "waiting" }), NOW).seconds).toBe(0);
    });
});

describe("turnView: Show", () => {
    it("applies to a drawn turn with shape ids", () => {
        expect(turnView(turn({ shapeids: ["a", "b"] }), NOW).canShow).toBe(true);
    });

    it("does not apply with no shapes, or on any other state", () => {
        expect(turnView(turn({ shapeids: [] }), NOW).canShow).toBe(false);
        expect(turnView(turn({}), NOW).canShow).toBe(false);
        for (const state of ["waiting", "answering", "forwarded", "failed", "stopped"]) {
            expect(turnView(turn({ state, shapeids: ["a"] }), NOW).canShow).toBe(false);
        }
    });

    it("applies to the agent's drawn request too", () => {
        expect(turnView(turn({ kind: "request", shapeids: ["a"] }), NOW).canShow).toBe(true);
    });
});

describe("turnView: send the other way", () => {
    it("forwards a drawn ask", () => {
        expect(turnView(turn({ kind: "ask", state: "answered" }), NOW).otherWay).toBe("forward");
    });

    it("draws a forwarded ask instead", () => {
        const forwarded = turn({ kind: "ask", state: "forwarded", forward: { state: "sent" } });
        expect(turnView(forwarded, NOW).otherWay).toBe("draw");
    });

    it("offers nothing on the agent's request, whatever its state", () => {
        for (const state of ["waiting", "answering", "answered", "failed", "stopped"]) {
            expect(turnView(turn({ kind: "request", state }), NOW).otherWay).toBeNull();
        }
    });

    it("offers nothing on an ask that is running, failed or stopped", () => {
        for (const state of ["waiting", "answering", "failed", "stopped"]) {
            expect(turnView(turn({ kind: "ask", state }), NOW).otherWay).toBeNull();
        }
    });
});

describe("turnView: the forward note", () => {
    const forwarded = (forward?: BoardForward) => turn({ state: "forwarded", forward });

    it("says who a waiting forward waits for", () => {
        expect(turnView(forwarded({ state: "waiting" }), NOW, "claude · arcterm").forwardNote).toBe(
            "waiting for claude · arcterm"
        );
        expect(turnView(forwarded({ state: "waiting" }), NOW).forwardNote).toBe("waiting for the agent");
    });

    it("reads answered in Chat once the agent replied", () => {
        expect(turnView(forwarded({ state: "replied", reply: "because" }), NOW).forwardNote).toBe(
            "forwarded · answered in Chat"
        );
    });

    it("reads agent closed when its tab closed", () => {
        expect(turnView(forwarded({ state: "agentgone", reason: "the tab closed" }), NOW).forwardNote).toBe(
            "agent closed"
        );
    });

    it("reads a sent forward, and one with no forward yet, as on its way to Chat", () => {
        expect(turnView(forwarded({ state: "sent" }), NOW).forwardNote).toBe("forwarded · answers in Chat");
        expect(turnView(forwarded(undefined), NOW).forwardNote).toBe("forwarded · answers in Chat");
    });

    it("is null on a turn that was not forwarded", () => {
        for (const state of ["waiting", "answering", "answered", "failed", "stopped"]) {
            expect(turnView(turn({ state, forward: { state: "sent" } }), NOW).forwardNote).toBeNull();
        }
    });
});

describe("recentTurns", () => {
    const many = (n: number) => talk(Array.from({ length: n }, (_, i) => turn({ id: `t${i + 1}` })));

    it("keeps the last 3, oldest first, and counts the earlier ones", () => {
        expect(recentTurns(many(5))).toEqual({
            turns: [
                expect.objectContaining({ id: "t3" }),
                expect.objectContaining({ id: "t4" }),
                expect.objectContaining({ id: "t5" }),
            ],
            earlier: 2,
        });
    });

    it("shows every turn when there are 3 or fewer", () => {
        expect(recentTurns(many(3))).toMatchObject({ earlier: 0 });
        expect(recentTurns(many(3)).turns).toHaveLength(3);
        expect(recentTurns(many(1))).toMatchObject({ earlier: 0 });
    });

    it("takes another count, and no talk", () => {
        expect(recentTurns(many(5), 1).turns.map((t) => t.id)).toEqual(["t5"]);
        expect(recentTurns(null)).toEqual({ turns: [], earlier: 0 });
        expect(recentTurns(talk([]))).toEqual({ turns: [], earlier: 0 });
    });
});

describe("boardFacts", () => {
    const info = (over: Partial<BoardInfo>): BoardInfo => ({
        id: "b1",
        name: "wavesrv-startup",
        project: "arcterm",
        path: "/b.excalidraw",
        createdts: NOW - 3_600_000,
        activets: NOW,
        ...over,
    });

    it("reads shapes and the time it was drawn", () => {
        const drawn = new Date(2026, 10, 19, 15, 20).getTime();
        expect(boardFacts(info({ shapes: 9, drawnts: drawn }), NOW)).toBe("9 shapes · drawn 15:20");
        expect(boardFacts(info({ shapes: 1, drawnts: drawn }), NOW)).toBe("1 shape · drawn 15:20");
    });

    it("names the day of an older drawing", () => {
        const drawn = new Date(2026, 10, 12, 9, 5).getTime();
        expect(boardFacts(info({ shapes: 4, drawnts: drawn }), NOW)).toBe("4 shapes · drawn 12 Nov");
    });

    it("reads an undrawn board as empty", () => {
        expect(boardFacts(info({}), NOW)).toBe("empty · created 14:30");
    });
});

describe("talkTime", () => {
    it("is the clock today and the date another day", () => {
        expect(talkTime(new Date(2026, 10, 19, 9, 5).getTime(), NOW)).toBe("09:05");
        expect(talkTime(new Date(2026, 9, 3, 9, 5).getTime(), NOW)).toBe("3 Oct");
    });
});

describe("agentAlive", () => {
    it("is true while the tab is in the roster", () => {
        expect(agentAlive("tab1", [{ id: "tab0" }, { id: "tab1" }])).toBe(true);
        expect(agentAlive("tab9", [{ id: "tab1" }])).toBe(false);
        expect(agentAlive(undefined, [{ id: "tab1" }])).toBe(false);
        expect(agentAlive("", [{ id: "" }])).toBe(false);
    });
});

describe("askAllowed", () => {
    it("allows an ask on a live agent's idle board", () => {
        expect(askAllowed(talk([turn({ state: "answered" }), turn({ state: "failed" })]), true)).toBe(true);
        expect(askAllowed(talk([]), true)).toBe(true);
        expect(askAllowed(null, true)).toBe(true);
    });

    it("refuses while a turn answers or waits", () => {
        expect(askAllowed(talk([turn({ state: "answering" })]), true)).toBe(false);
        expect(askAllowed(talk([turn({ state: "waiting", kind: "request" })]), true)).toBe(false);
    });

    it("refuses once the agent ended", () => {
        expect(askAllowed(talk([turn({ state: "answered" })]), false)).toBe(false);
    });

    it("is not held by a forwarded turn", () => {
        expect(askAllowed(talk([turn({ state: "forwarded", forward: { state: "waiting" } })]), true)).toBe(true);
    });
});

describe("elapsedLabel", () => {
    it("reads seconds, then minutes and seconds", () => {
        expect(elapsedLabel(0)).toBe("0s");
        expect(elapsedLabel(12.9)).toBe("12s");
        expect(elapsedLabel(60)).toBe("1m");
        expect(elapsedLabel(65)).toBe("1m 5s");
        expect(elapsedLabel(-3)).toBe("0s");
    });
});

describe("drawnSummary", () => {
    it("says what the turn added, changed and removed", () => {
        expect(drawnSummary(turn({ added: 9 }))).toBe("+9 shapes");
        expect(drawnSummary(turn({ added: 1 }))).toBe("+1 shape");
        expect(drawnSummary(turn({ added: 2, changed: 1, removed: 3 }))).toBe("+2 shapes · 1 changed · 3 removed");
        expect(drawnSummary(turn({ changed: 4 }))).toBe("4 changed");
    });

    it("reads a drawn turn that touched nothing as no change", () => {
        expect(drawnSummary(turn({}))).toBe("no change");
    });
});

describe("turnText", () => {
    it("lists a turn by what it drew, else what was asked, else its briefing", () => {
        expect(turnText(turn({ title: "wavesrv startup", question: "draw it" }))).toBe("wavesrv startup");
        expect(turnText(turn({ question: "why a new auth key?" }))).toBe("why a new auth key?");
        expect(turnText(turn({ kind: "request", context: "the startup flow" }))).toBe("the startup flow");
        expect(turnText(turn({}))).toBe("Drawing");
    });
});
