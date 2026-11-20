import { describe, expect, it } from "vitest";
import type { BrainstormBandModel } from "./brainstormband";
import { brainstormPaneState, railBrainstormRows } from "./railbrainstorm";

const model = (o: Partial<BrainstormBandModel> = {}): BrainstormBandModel => ({
    title: "Lịch 3 ngày tới trên Overview",
    newCount: 0,
    boards: [],
    decided: [],
    ...o,
});

describe("railBrainstormRows", () => {
    it("numbers the decisions in the design's order and hangs each board under its part", () => {
        const r = railBrainstormRows(
            model({
                decided: [
                    { id: "p1", title: "Mục đích", gist: "Overview có thêm khối lịch." },
                    { id: "p5", title: "Vị trí", gist: "Cột trái." },
                ],
                boards: [{ name: "A-left.dc.html", part: "Vị trí", isNew: false }],
            })
        );
        expect(r.rows.map((x) => [x.n, x.title, x.boards.map((b) => b.name)])).toEqual([
            [1, "Mục đích", []],
            [2, "Vị trí", ["A-left.dc.html"]],
        ]);
        expect(r.openParts).toEqual([]);
    });
    it("marks a decision whose board is new", () => {
        const r = railBrainstormRows(
            model({
                decided: [{ id: "p6", title: "Lịch 30 ngày", gist: "Lưới 5 tuần." }],
                boards: [{ name: "M-B.dc.html", part: "Lịch 30 ngày", isNew: true }],
                newCount: 1,
            })
        );
        expect(r.rows[0].hasNew).toBe(true);
    });
    it("lists boards of undecided parts under Open parts, in board order", () => {
        const r = railBrainstormRows(
            model({ boards: [{ name: "Q.dc.html", part: "Bấm vào một ngày", isNew: true }], newCount: 1 })
        );
        expect(r.rows).toEqual([]);
        expect(r.openParts.map((b) => b.name)).toEqual(["Q.dc.html"]);
    });
    it("orders every board for ← / → as drawn: timeline first, then Open parts", () => {
        const r = railBrainstormRows(
            model({
                decided: [{ id: "p1", title: "A", gist: "" }],
                boards: [
                    { name: "open.dc.html", part: "Z", isNew: false },
                    { name: "a.dc.html", part: "A", isNew: false },
                ],
            })
        );
        expect(r.boardOrder).toEqual(["a.dc.html", "open.dc.html"]);
    });
    it("steps a board once when two decisions share its part's title", () => {
        const r = railBrainstormRows(
            model({
                decided: [
                    { id: "p1", title: "A", gist: "" },
                    { id: "p2", title: "A", gist: "" },
                ],
                boards: [
                    { name: "a.dc.html", part: "A", isNew: false },
                    { name: "b.dc.html", part: "A", isNew: false },
                ],
            })
        );
        expect(r.boardOrder).toEqual(["a.dc.html", "b.dc.html"]);
    });
});

describe("brainstormPaneState", () => {
    const decided = [{ id: "p1", title: "A", gist: "" }];
    it("reads the file while a brainstorm is attached and its file has not been read", () => {
        expect(brainstormPaneState(true, null, null)).toBe("reading");
    });
    it("shows the store's error over everything else, a stale timeline included", () => {
        expect(brainstormPaneState(true, null, "brainstorm.json is not valid JSON")).toBe("error");
        expect(brainstormPaneState(true, model({ decided }), "brainstorm.json is not valid JSON")).toBe("error");
    });
    it("says nothing is decided while the file has no decision of the user's, boards or not", () => {
        expect(brainstormPaneState(true, model(), null)).toBe("empty");
        expect(
            brainstormPaneState(true, model({ boards: [{ name: "Q.dc.html", part: "Z", isNew: true }] }), null)
        ).toBe("empty");
    });
    it("draws the timeline once a decision is the user's", () => {
        expect(brainstormPaneState(true, model({ decided }), null)).toBe("timeline");
    });
    it("has nothing to read with no brainstorm attached", () => {
        expect(brainstormPaneState(false, null, null)).toBe("empty");
    });
});
