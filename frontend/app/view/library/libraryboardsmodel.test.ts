// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "../agents/agentsviewmodel";
import {
    boardRows,
    boardsEmptyText,
    boardsScope,
    boardsSelectionIn,
    noTakeoverText,
    splitAnchor,
    splitTitle,
    takeoverAgents,
} from "./libraryboardsmodel";

const NOW = new Date(2026, 10, 19, 16, 0).getTime();
const at = (h: number, m: number) => new Date(2026, 10, 19, h, m).getTime();

function info(over: Partial<BoardInfo> & Pick<BoardInfo, "id" | "name">): BoardInfo {
    return {
        project: "arcterm",
        path: `/data/${over.id}.excalidraw`,
        createdts: at(9, 0),
        activets: at(9, 0),
        ...over,
    };
}

const BOARDS: BoardInfo[] = [
    info({
        id: "b1",
        name: "wavesrv-startup",
        turns: 2,
        shapes: 9,
        drawnts: at(15, 20),
        activets: at(15, 24),
        agenttabid: "tab-gone",
        agenttitle: "claude · startup",
    }),
    info({
        id: "b2",
        name: "jobslot-queue",
        turns: 5,
        shapes: 22,
        drawnts: at(11, 4),
        activets: at(11, 4),
        agenttabid: "tab-live",
        agenttitle: "claude · jobqueue",
    }),
    info({
        id: "b3",
        name: "Council-Rounds",
        project: "mit-thesis",
        turns: 1,
        shapes: 14,
        drawnts: new Date(2026, 10, 17, 10, 0).getTime(),
        activets: new Date(2026, 10, 17, 10, 0).getTime(),
        agenttabid: "tab-old",
        agenttitle: "claude · council",
    }),
];

const ROSTER = [{ id: "tab-live" }, { id: "other" }];

describe("boardsScope", () => {
    it("reads the app bar's project filter as the list's project: none picked is every project", () => {
        expect(boardsScope("all")).toBe("");
        expect(boardsScope("arcterm")).toBe("arcterm");
    });
});

describe("boardRows", () => {
    it("lists newest first, each row with its agent, whether it runs, and the counts", () => {
        const rows = boardRows([BOARDS[2], BOARDS[1], BOARDS[0]], { query: "", roster: ROSTER, now: NOW });
        expect(rows.map((r) => r.id)).toEqual(["b1", "b2", "b3"]);
        expect(rows[0]).toMatchObject({
            key: "arcterm/b1",
            name: "wavesrv-startup",
            project: "arcterm",
            agent: "claude · startup",
            alive: false,
            agentState: "ended",
            shapes: 9,
            loaderror: "",
            summary: "2 turns · 9 shapes · drawn 15:20",
        });
        expect(rows[1]).toMatchObject({
            alive: true,
            agentState: "running",
            summary: "5 turns · 22 shapes · drawn 11:04",
        });
        expect(rows[2].summary).toBe("1 turn · 14 shapes · drawn 17 Nov");
    });

    it("counts a sleeping agent as running: it stays in the roster", () => {
        const rows = boardRows([BOARDS[1]], { query: "", roster: [{ id: "tab-live" }], now: NOW });
        expect(rows[0].agentState).toBe("running");
    });

    it("reads a board with no agent as ended, and one nothing was drawn on as empty", () => {
        const [row] = boardRows([info({ id: "b9", name: "blank", createdts: at(14, 30) })], {
            query: "",
            roster: ROSTER,
            now: NOW,
        });
        expect(row).toMatchObject({ agent: "", agentTabId: "", alive: false, agentState: "ended", shapes: 0 });
        expect(row.summary).toBe("0 turns · empty · created 14:30");
    });

    it("carries why a file does not open", () => {
        const [row] = boardRows([info({ id: "b8", name: "broken", loaderror: "not valid JSON" })], {
            query: "",
            roster: ROSTER,
            now: NOW,
        });
        expect(row.loaderror).toBe("not valid JSON");
    });

    it("does not reorder the list it was given", () => {
        const given = [BOARDS[2], BOARDS[0]];
        boardRows(given, { query: "", roster: ROSTER, now: NOW });
        expect(given.map((b) => b.id)).toEqual(["b3", "b1"]);
    });

    it("searches by name: trimmed, any case, a part of it", () => {
        const q = (query: string) => boardRows(BOARDS, { query, roster: ROSTER, now: NOW }).map((r) => r.id);
        expect(q("job")).toEqual(["b2"]);
        expect(q("  COUNCIL ")).toEqual(["b3"]);
        expect(q("-")).toEqual(["b1", "b2", "b3"]);
        expect(q("nothing")).toEqual([]);
    });

    it("is empty for a list not read yet", () => {
        expect(boardRows(null, { query: "", roster: ROSTER, now: NOW })).toEqual([]);
        expect(boardRows(undefined, { query: "", roster: ROSTER, now: NOW })).toEqual([]);
    });
});

describe("boardsSelectionIn", () => {
    const rows = boardRows(BOARDS, { query: "", roster: ROSTER, now: NOW });

    it("finds the selected board among the rows", () => {
        expect(boardsSelectionIn(rows, { project: "mit-thesis", boardId: "b3" })?.name).toBe("Council-Rounds");
    });

    it("is null with nothing selected, or a board the list no longer holds", () => {
        expect(boardsSelectionIn(rows, null)).toBeNull();
        expect(boardsSelectionIn(rows, { project: "arcterm", boardId: "gone" })).toBeNull();
        // the same id in another project is another board
        expect(boardsSelectionIn(rows, { project: "mit-thesis", boardId: "b1" })).toBeNull();
    });
});

describe("boardsEmptyText", () => {
    it("says a project has no boards and where they come from", () => {
        expect(boardsEmptyText("arcterm", "")).toBe(
            "No boards in arcterm yet. Boards appear when an agent runs wsh board draw."
        );
    });

    it("says the same for every project", () => {
        expect(boardsEmptyText("", "")).toBe("No boards yet. Boards appear when an agent runs wsh board draw.");
    });

    it("says a search found none", () => {
        expect(boardsEmptyText("arcterm", " nothing ")).toBe('No board named "nothing".');
    });
});

describe("takeoverAgents", () => {
    const agent = (over: Partial<AgentVM> & Pick<AgentVM, "id" | "name">) =>
        ({ state: "idle", agent: "claude", project: "mit-thesis", ...over }) as AgentVM;

    it("lists the live Claude agents of the board's project, in the roster's order", () => {
        const roster = [
            agent({ id: "t1", name: "thesis" }),
            agent({ id: "t2", name: "web", project: "arcterm" }),
            agent({ id: "t3", name: "scout", agent: "pi" }),
            agent({ id: "t4", name: "notes" }),
        ];
        expect(takeoverAgents(roster, "mit-thesis")).toEqual([
            { id: "t1", name: "thesis" },
            { id: "t4", name: "notes" },
        ]);
    });

    it("reads an agent's project from its transcript when it names none", () => {
        const roster = [
            agent({
                id: "t1",
                name: "thesis",
                project: undefined,
                transcriptPath: "/Users/me/.claude/projects/-Users-me-thesis/abc.jsonl",
            }),
        ];
        expect(takeoverAgents(roster, "thesis")).toEqual([{ id: "t1", name: "thesis" }]);
    });

    it("is empty when none runs, and says so", () => {
        expect(takeoverAgents([], "mit-thesis")).toEqual([]);
        expect(noTakeoverText("mit-thesis")).toBe(
            "No Claude agent of mit-thesis is running: start one to open this board beside its Chat."
        );
    });
});

describe("splitAnchor", () => {
    const live = { alive: true, agentTabId: "tab-live" };
    const ended = { alive: false, agentTabId: "tab-gone" };

    it("puts a live agent's board beside that agent, whoever is in focus", () => {
        expect(splitAnchor(live, "other", ROSTER)).toBe("tab-live");
        expect(splitAnchor(live, null, ROSTER)).toBe("tab-live");
    });

    it("puts an ended agent's board beside the agent in focus, else the roster's first", () => {
        expect(splitAnchor(ended, "other", ROSTER)).toBe("other");
        expect(splitAnchor(ended, null, ROSTER)).toBe("tab-live");
        expect(splitAnchor(ended, "", ROSTER)).toBe("tab-live");
        expect(splitAnchor({ alive: false, agentTabId: "" }, undefined, ROSTER)).toBe("tab-live");
    });

    it("has no place for it with no agent at all", () => {
        expect(splitAnchor(ended, null, [])).toBeNull();
    });
});

describe("splitTitle", () => {
    it("names the live agent the board goes beside", () => {
        expect(splitTitle({ alive: true, agent: "claude · jobqueue" }, "tab-live")).toBe(
            "Open in split beside claude · jobqueue"
        );
        expect(splitTitle({ alive: true, agent: "" }, "tab-live")).toBe("Open in split beside its agent");
    });

    it("tells an ended agent's board where it goes and how to ask on it", () => {
        expect(splitTitle({ alive: false, agent: "claude · startup" }, "other")).toContain("agent in focus");
        expect(splitTitle({ alive: false, agent: "" }, "other")).toContain("pick a chat");
    });

    it("says to start an agent when there is none", () => {
        expect(splitTitle({ alive: false, agent: "" }, null)).toBe(
            "Start an agent first: the board opens in a split beside it"
        );
    });
});
