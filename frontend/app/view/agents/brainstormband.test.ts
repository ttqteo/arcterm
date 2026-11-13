// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Chat band's brainstorm part reads (brainstormband.ts): the board names across every part, which are new
// against the names last seen, the decisions that are the user's, and the seen-names map's parse and prune.

import { describe, expect, it } from "vitest";
import {
    boardNames,
    brainstormBandModel,
    brainstormTabDot,
    parseSeenBoards,
    withSeenBoards,
    type SeenBoards,
} from "./brainstormband";
import type { BrainstormFile, BrainstormPart } from "./brainstormmodel";
import { yoursGists } from "./chatbrainstorm";

function part(id: string, over: Partial<BrainstormPart> = {}): BrainstormPart {
    return { id, title: id.toUpperCase(), state: "yours", body: `${id} body.`, ...over };
}

function file(parts: BrainstormPart[], over: Partial<BrainstormFile> = {}): BrainstormFile {
    return {
        v: 1,
        title: "Lag alerts",
        spec: "",
        canvas: "lag",
        question: null,
        working: null,
        parts,
        history: [],
        done: false,
        check: null,
        run: null,
        ...over,
    };
}

describe("boardNames", () => {
    it("counts every part's boards in part order without repeats", () => {
        const f = file([
            part("who", { boards: ["A.dc.html", "B.dc.html"] }),
            part("how", { boards: ["B.dc.html", "C.dc.html"] }),
            part("when"),
        ]);
        expect(boardNames(f)).toEqual(["A.dc.html", "B.dc.html", "C.dc.html"]);
    });

    it("counts a note's boards too", () => {
        const f = file([
            part("who", { boards: ["A.dc.html"] }),
            part("recon", { kind: "note", boards: ["R.dc.html"] }),
        ]);
        expect(boardNames(f)).toEqual(["A.dc.html", "R.dc.html"]);
    });

    it("is none while the file names no canvas: a board without one cannot be opened", () => {
        const f = file([part("who", { boards: ["A.dc.html"] })], { canvas: undefined });
        expect(boardNames(f)).toEqual([]);
    });

    it("is none when no part lists a board", () => {
        expect(boardNames(file([part("who"), part("how")]))).toEqual([]);
    });
});

describe("brainstormBandModel", () => {
    const f = file([
        part("who", { title: "Who gets paged", boards: ["A.dc.html", "B.dc.html"] }),
        part("how", { title: "How it pages", boards: ["B.dc.html", "C.dc.html"] }),
        part("later", { state: "guess" }),
    ]);

    it("names each board's part as the first part that lists it", () => {
        const m = brainstormBandModel(f, []);
        expect(m.boards.map((b) => [b.name, b.part])).toEqual([
            ["A.dc.html", "Who gets paged"],
            ["B.dc.html", "Who gets paged"],
            ["C.dc.html", "How it pages"],
        ]);
    });

    it("marks the boards the seen names lack as new", () => {
        const m = brainstormBandModel(f, ["A.dc.html", "B.dc.html"]);
        expect(m.boards.map((b) => b.isNew)).toEqual([false, false, true]);
        expect(m.newCount).toBe(1);
    });

    it("reads every board as new when there is no entry for the file", () => {
        const m = brainstormBandModel(f, null);
        expect(m.boards.every((b) => b.isNew)).toBe(true);
        expect(m.newCount).toBe(3);
    });

    it("has nothing new once every name was seen, and a seen name that is gone changes nothing", () => {
        const m = brainstormBandModel(f, ["A.dc.html", "B.dc.html", "C.dc.html", "Gone.dc.html"]);
        expect(m.newCount).toBe(0);
        expect(m.boards).toHaveLength(3);
    });

    it("carries the title and the decisions that are the user's", () => {
        const m = brainstormBandModel(f, null);
        expect(m.title).toBe("Lag alerts");
        expect(m.decided).toEqual(yoursGists(f));
        expect(m.decided.map((g) => g.id)).toEqual(["who", "how"]);
    });

    it("has no boards and still lists what is decided", () => {
        const noBoards = file([part("who"), part("how", { state: "asked" })]);
        const m = brainstormBandModel(noBoards, null);
        expect(m.boards).toEqual([]);
        expect(m.newCount).toBe(0);
        expect(m.decided.map((g) => g.id)).toEqual(["who"]);
    });
});

describe("brainstormTabDot", () => {
    it("is amber while the agent asks, whatever else is new", () => {
        expect(brainstormTabDot(2, true, false)).toBe("asking");
        expect(brainstormTabDot(0, true, false)).toBe("asking");
    });

    it("is the accent dot when boards are new and the agent is not asking", () => {
        expect(brainstormTabDot(1, false, false)).toBe("new");
    });

    it("is none while the tab is shown", () => {
        expect(brainstormTabDot(3, false, true)).toBeNull();
    });

    it("is none with no new boards", () => {
        expect(brainstormTabDot(0, false, false)).toBeNull();
    });
});

describe("parseSeenBoards", () => {
    it("reads what withSeenBoards wrote", () => {
        const map: SeenBoards = { "/p/a/brainstorm.json": { names: ["A.dc.html"], at: 5 } };
        expect(parseSeenBoards(JSON.stringify(map))).toEqual(map);
    });

    it("is empty for nothing, garbage, a non-object and an array", () => {
        expect(parseSeenBoards(null)).toEqual({});
        expect(parseSeenBoards(undefined)).toEqual({});
        expect(parseSeenBoards("")).toEqual({});
        expect(parseSeenBoards("{not json")).toEqual({});
        expect(parseSeenBoards("42")).toEqual({});
        expect(parseSeenBoards('"text"')).toEqual({});
        expect(parseSeenBoards("[1,2]")).toEqual({});
        expect(parseSeenBoards("null")).toEqual({});
    });

    it("drops a bad entry and keeps the good ones", () => {
        const raw = JSON.stringify({
            good: { names: ["A.dc.html", 7, "B.dc.html"], at: 3 },
            noNames: { at: 1 },
            namesNotList: { names: "A", at: 1 },
            noAt: { names: ["A.dc.html"] },
            nanAt: { names: ["A.dc.html"], at: "soon" },
            nullEntry: null,
            listEntry: ["A.dc.html"],
        });
        expect(parseSeenBoards(raw)).toEqual({ good: { names: ["A.dc.html", "B.dc.html"], at: 3 } });
    });

    it("never takes a __proto__ key", () => {
        const out = parseSeenBoards('{"__proto__": {"names": ["A"], "at": 1}, "ok": {"names": [], "at": 2}}');
        expect(Object.keys(out)).toEqual(["ok"]);
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    });

    it("keeps an entry with no names: a brainstorm seen with no boards", () => {
        expect(parseSeenBoards('{"p": {"names": [], "at": 4}}')).toEqual({ p: { names: [], at: 4 } });
    });
});

describe("withSeenBoards", () => {
    it("sets the entry with the time", () => {
        const next = withSeenBoards({}, "p", ["A.dc.html"], 10);
        expect(next).toEqual({ p: { names: ["A.dc.html"], at: 10 } });
    });

    it("returns the same map when the names are already the stored ones", () => {
        const map: SeenBoards = { p: { names: ["A.dc.html", "B.dc.html"], at: 10 } };
        expect(withSeenBoards(map, "p", ["A.dc.html", "B.dc.html"], 99)).toBe(map);
    });

    it("replaces the names, and the time, when they changed", () => {
        const map: SeenBoards = { p: { names: ["A.dc.html"], at: 10 } };
        expect(withSeenBoards(map, "p", ["A.dc.html", "B.dc.html"], 20)).toEqual({
            p: { names: ["A.dc.html", "B.dc.html"], at: 20 },
        });
    });

    it("leaves the other paths alone and does not touch the map it was given", () => {
        const map: SeenBoards = { q: { names: ["Q.dc.html"], at: 1 } };
        const next = withSeenBoards(map, "p", ["A.dc.html"], 2);
        expect(next.q).toBe(map.q);
        expect(map).toEqual({ q: { names: ["Q.dc.html"], at: 1 } });
    });

    it("keeps the newest 40 paths by time", () => {
        let map: SeenBoards = {};
        for (let i = 0; i < 40; i++) {
            map = withSeenBoards(map, `p${i}`, ["A.dc.html"], 100 + i);
        }
        expect(Object.keys(map)).toHaveLength(40);
        const next = withSeenBoards(map, "fresh", ["A.dc.html"], 500);
        expect(Object.keys(next)).toHaveLength(40);
        expect(next.fresh).toBeDefined();
        // the oldest, p0, went
        expect(next.p0).toBeUndefined();
        expect(next.p1).toBeDefined();
    });
});
