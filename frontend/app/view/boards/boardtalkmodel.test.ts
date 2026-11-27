import { describe, expect, it } from "vitest";
import {
    SLOW_MS,
    agentAlive,
    boardFacts,
    elapsedLabel,
    statusTurn,
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

    it("reads an unknown state as waiting", () => {
        const v = turnView(turn({ state: "from-a-newer-wavesrv", shapeids: ["a"] }), NOW);
        expect(v).toEqual({ state: "waiting", seconds: 0 });
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

describe("elapsedLabel", () => {
    it("reads seconds, then minutes and seconds", () => {
        expect(elapsedLabel(0)).toBe("0s");
        expect(elapsedLabel(12.9)).toBe("12s");
        expect(elapsedLabel(60)).toBe("1m");
        expect(elapsedLabel(65)).toBe("1m 5s");
        expect(elapsedLabel(-3)).toBe("0s");
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

describe("statusTurn: the line under the canvas", () => {
    const ids = (t: BoardTalk | null) => statusTurn(t, NOW)?.turn.id ?? null;

    it("shows nothing with no talk, no turns, or a latest turn that landed", () => {
        expect(ids(null)).toBeNull();
        expect(ids(talk([]))).toBeNull();
        expect(ids(talk([turn({ id: "a", state: "failed" }), turn({ id: "b", state: "answered" })]))).toBeNull();
    });

    it("shows nothing after a stop or an old forwarded ask", () => {
        expect(ids(talk([turn({ id: "a", state: "stopped" })]))).toBeNull();
        expect(ids(talk([turn({ id: "a", state: "forwarded", forward: { state: "sent" } })]))).toBeNull();
    });

    it("shows the turn the drawer is on, ahead of one queued behind it", () => {
        const t = talk([
            turn({ id: "a", state: "answered" }),
            turn({ id: "b", state: "answering", startedts: NOW - 12_000 }),
            turn({ id: "c", kind: "request", state: "waiting" }),
        ]);
        expect(statusTurn(t, NOW)).toMatchObject({ turn: { id: "b" }, view: { state: "answering", seconds: 12 } });
    });

    it("reads a turn answering for 45 s as slow", () => {
        const t = talk([turn({ id: "a", state: "answering", startedts: NOW - SLOW_MS })]);
        expect(statusTurn(t, NOW)?.view.state).toBe("slow");
    });

    it("shows a queued turn while none answers", () => {
        expect(ids(talk([turn({ id: "a", state: "answered" }), turn({ id: "b", state: "waiting" })]))).toBe("b");
    });

    it("keeps a failed latest turn, with its reason, until a later one lands", () => {
        const failed = turn({ id: "b", kind: "request", state: "failed", reason: "not one JSON object" });
        expect(statusTurn(talk([turn({ id: "a" }), failed]), NOW)).toMatchObject({
            turn: { id: "b", reason: "not one JSON object" },
            view: { state: "failed" },
        });
        expect(ids(talk([failed, turn({ id: "c", state: "answering" })]))).toBe("c");
    });
});
