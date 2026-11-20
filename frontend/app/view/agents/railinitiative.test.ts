import { describe, expect, it } from "vitest";
import { bandRows, type BandChunk } from "./initiativeband";
import { initiativePaneState, noteHeading, paneNav, pickTarget, rowTag } from "./railinitiative";

const ME = "tab-me";
const mine = { kind: "agent", oref: "agent:" + ME, ts: 1 };
const chunk = (label: string, status: string, workrefs?: BandChunk["workrefs"]): BandChunk => ({
    label,
    status,
    workrefs,
});

describe("initiativePaneState", () => {
    it("is loading until the initiative is read, and error once a read failed", () => {
        expect(initiativePaneState({ loaded: false, failed: false, onChunk: false })).toBe("loading");
        expect(initiativePaneState({ loaded: false, failed: true, onChunk: false })).toBe("error");
    });
    it("reads onChunk only once the initiative is loaded: no chunk asks to pick one", () => {
        expect(initiativePaneState({ loaded: true, failed: false, onChunk: false })).toBe("no-chunk");
        expect(initiativePaneState({ loaded: true, failed: false, onChunk: true })).toBe("ready");
    });
    it("a loaded initiative stays on screen over a failed re-read", () => {
        expect(initiativePaneState({ loaded: true, failed: true, onChunk: true })).toBe("ready");
        expect(initiativePaneState({ loaded: true, failed: true, onChunk: false })).toBe("no-chunk");
    });
});

describe("paneNav", () => {
    const rows = bandRows(
        {
            chunks: [
                chunk("a", "done", [mine]),
                chunk("b", "active", [mine]),
                chunk("c", "pending"),
                chunk("d", "pending"),
            ],
        },
        ME
    );
    it("is the window's rows, then the All chunks row", () => {
        const nav = paneNav(rows, false);
        expect(nav.map((n) => (n.kind === "row" ? `${n.list}:${n.row.label}` : "all"))).toEqual([
            "window:a",
            "window:b",
            "window:c",
            "window:d",
            "all",
        ]);
    });
    it("adds the full list's rows after All chunks while it is open", () => {
        const nav = paneNav(rows, true);
        expect(nav.length).toBe(rows.window.length + 1 + rows.all.length);
        expect(nav[rows.window.length]).toEqual({ kind: "all" });
        expect(nav[rows.window.length + 1]).toMatchObject({ kind: "row", list: "all" });
    });
});

describe("rowTag", () => {
    const nameOf = (id: string) => (id === "other" ? "Dung" : undefined);
    const rowOf = (chunks: BandChunk[], label: string) => bandRows({ chunks }, ME).all.find((r) => r.label === label)!;
    it("names the agent's own chunk, the next one and a settled one", () => {
        const chunks = [chunk("a", "done", [mine]), chunk("b", "active", [mine]), chunk("c", "pending")];
        expect(rowTag(rowOf(chunks, "b"), ME, nameOf)).toBe("this agent");
        expect(rowTag(rowOf(chunks, "c"), ME, nameOf)).toBe("next");
        // the chunk this agent finished is `done` kind, tagged by its status
        expect(rowTag(rowOf(chunks, "a"), ME, nameOf)).toBe("done");
    });
    it("names who else holds a chunk: an agent by its roster name, an unknown one, a run", () => {
        const by = (kind: string, oref: string) => [chunk("a", "active", [{ kind, oref }])];
        expect(rowTag(rowOf(by("agent", "agent:other"), "a"), ME, nameOf)).toBe("Dung");
        expect(rowTag(rowOf(by("agent", "agent:ghost"), "a"), ME, nameOf)).toBe("an agent");
        expect(rowTag(rowOf(by("run", "run:7f3a"), "a"), ME, nameOf)).toBe("a run");
    });
    it("lists each holder once, and says nothing for a plain pending chunk", () => {
        const twice = [
            chunk("a", "active", [
                { kind: "agent", oref: "agent:other" },
                { kind: "agent", oref: "agent:other" },
            ]),
        ];
        expect(rowTag(rowOf(twice, "a"), ME, nameOf)).toBe("Dung");
        // only the next two pending chunks are `next`; a third one down the plan is plain
        const plain = ["a", "b", "c"].map((l) => chunk(l, "pending"));
        expect(rowTag(rowOf(plain, "c"), ME, nameOf)).toBe("");
        expect(rowTag(rowOf([chunk("a", "blocked")], "a"), ME, nameOf)).toBe("blocked");
    });
});

describe("pickTarget", () => {
    it("is the first chunk that offers Work on this in the window", () => {
        const rows = bandRows(
            { chunks: [chunk("a", "done", [mine]), chunk("b", "pending"), chunk("c", "pending")] },
            ME
        );
        expect(pickTarget(rows)).toEqual({ allOpen: false, cursor: rows.window.findIndex((r) => r.workOn) });
    });
    it("opens the full list for one only it has, the cursor past All chunks", () => {
        // the window holds two rows that offer nothing; the full list's third row does
        const rows = {
            window: [{ workOn: false }, { workOn: false }],
            all: [{ workOn: false }, { workOn: false }, { workOn: true }],
        };
        expect(pickTarget(rows)).toEqual({ allOpen: true, cursor: 2 + 1 + 2 });
    });
    it("is null when no chunk offers it", () => {
        const rows = bandRows({ chunks: [chunk("a", "done", [mine]), chunk("b", "active", [mine])] }, ME);
        expect(pickTarget(rows)).toBeNull();
    });
});

describe("noteHeading", () => {
    it("names the chunk's number and the note's age", () => {
        expect(noteHeading(4, 12 * 60_000)).toBe("Latest note on 4 · 12m ago");
        expect(noteHeading(4, 5_000)).toBe("Latest note on 4 · just now");
    });
    it("without a note it names only the chunk, and without a chunk it names none", () => {
        expect(noteHeading(4, null)).toBe("Latest note on 4");
        expect(noteHeading(null, null)).toBe("Latest note");
    });
});
