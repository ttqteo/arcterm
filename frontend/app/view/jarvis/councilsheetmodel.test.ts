// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    chunkLabelFor,
    councilSheetHead,
    councilVerdict,
    matrixRows,
    reportPath,
    sheetAsks,
    sheetDirections,
    sheetFold,
    workOnInput,
} from "./councilsheetmodel";

const experts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "sk", name: "Skeptic", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

const prop = (id: string, author: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `title ${id}`,
    argument: `argument ${id}.`,
    ts: 1,
    ...extra,
});

const reply = (id: string, proposalid: string, author: string, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid,
    author,
    text: `text ${id}`,
    round: 2,
    ts: 10,
    ...extra,
});

const direction = (rank: number, from: string[], extra: Partial<CouncilDirection> = {}): CouncilDirection => ({
    rank,
    title: `direction ${rank}`,
    reasoning: `reasoning ${rank}`,
    from,
    stances: {},
    agreed: true,
    ...extra,
});

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

const council = (extra: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "D:\\code\\website",
    feature: "Homepage redesign",
    question: "Is the homepage ready to ship? Keep to: one day; no new pages.",
    experts,
    state: "done",
    round: 3,
    proposals: [prop("P1", "ux"), prop("P2", "ram"), prop("P3", "sk", { withdrawn: true })],
    replies: [reply("R1", "P1", "ram", { stance: "accept" }), reply("R2", "P2", "sk", { stance: "challenge" })],
    summary: {
        text: "Mostly. The story is right but the demo button is hard to find.",
        answer: "Not yet: fix the demo button first.",
        directions: [
            direction(2, ["P2"], {
                title: "Split today from coming",
                stances: { sk: "challenge" },
                firststep: "Table the SOC lines",
            }),
            direction(1, ["P1", "P3"], {
                title: "Keep a demo button in reach",
                stances: { ram: "accept" },
                firststep: "Add  the\n button",
            }),
            direction(3, ["P2"], { title: "Strip the notes", stances: { ram: "oppose" } }),
        ],
        kept: [direction(1, ["P3"], { title: "kept one" }), direction(2, ["P3"], { title: "kept two" })],
        outcomes: { P1: "Kept", P3: "Withdrawn in round 2" },
        asks: [{ text: "Keep the price on the hero?", to: "ux" }, { text: "Can we link the playground?" }],
        at: 50 * HOUR,
    },
    tokens: 0,
    calls: 0,
    created: 10 * HOUR,
    updated: 76 * HOUR,
    ...extra,
});

const projects = { website: { path: "D:/code/website/" } };

describe("councilSheetHead", () => {
    it("reads the mode, the question without its limits, and project · experts · state age", () => {
        expect(councilSheetHead(council(), projects, NOW)).toEqual({
            chip: "council · review",
            question: "Is the homepage ready to ship?",
            meta: "website · 3 experts · done 1d",
        });
    });

    it("falls back to the feature when nothing was asked, and names a Brainstorm", () => {
        const head = councilSheetHead(council({ question: "", mode: "brainstorm", state: "running" }), null, NOW);
        expect(head.chip).toBe("council · brainstorm");
        expect(head.question).toBe("Homepage redesign");
        // a project no registry holds reads by its folder's name
        expect(head.meta).toBe("website · 3 experts · running 1d");
    });
});

describe("councilVerdict", () => {
    it("gives a done council its answer and the summary under it", () => {
        expect(councilVerdict(council())).toEqual({
            kind: "verdict",
            answer: "Not yet: fix the demo button first.",
            summary: "Mostly. The story is right but the demo button is hard to find.",
        });
    });

    it("reads a stopped council with a summary as done", () => {
        expect(councilVerdict(council({ state: "stopped" })).kind).toBe("verdict");
    });

    it("shows a running council's round instead of a verdict", () => {
        const v = councilVerdict(council({ state: "running", round: 2, summary: undefined }));
        expect(v).toEqual({ kind: "working", step: "Round 2 of 2", line: "3 ideas · 2 replies so far" });
    });

    it("words a queued and a waiting council by their state", () => {
        expect(councilVerdict(council({ state: "queued", round: 0, summary: undefined }))).toMatchObject({
            kind: "working",
            step: "Queued",
        });
        expect(councilVerdict(council({ state: "awaiting-you", round: 1, summary: undefined }))).toMatchObject({
            kind: "working",
            step: "Waiting on you",
        });
    });

    it("says a failed council failed, where, and what finished", () => {
        const v = councilVerdict(council({ state: "failed", round: 3, summary: undefined, error: " bad JSON " }));
        expect(v).toEqual({
            kind: "ended",
            title: "Failed while writing the summary",
            finished: "Finished 2 of 2 rounds · 3 ideas · 2 replies",
            error: "bad JSON",
            answer: "",
            summary: "",
        });
    });

    it("says a stopped council without a summary stopped, in its round", () => {
        const v = councilVerdict(
            council({ state: "stopped", round: 2, summary: undefined, proposals: [], replies: [] })
        );
        expect(v).toMatchObject({
            kind: "ended",
            title: "Stopped in round 2 of 2",
            finished: "Finished 1 of 2 rounds · 0 ideas · 0 replies",
        });
    });

    it("says nothing finished for a council that never got going", () => {
        const v = councilVerdict(
            council({ state: "not-run", round: 0, summary: undefined, proposals: [], replies: [] })
        );
        expect(v).toMatchObject({ kind: "ended", title: "Not run", finished: "Nothing finished" });
    });
});

describe("sheetDirections", () => {
    it("ranks the directions and words their outcome", () => {
        const rows = sheetDirections(council());
        expect(rows.map((d) => [d.rank, d.title, d.outcome, d.agreed])).toEqual([
            [1, "Keep a demo button in reach", "✓ Agreed", true],
            [2, "Split today from coming", "Skeptic has doubts", false],
            [3, "Strip the notes", "RAM is against it", false],
        ]);
    });

    it("carries the first step flattened and the proposals each came from", () => {
        const rows = sheetDirections(council());
        expect(rows[0].step).toBe("Add the button");
        expect(rows[0].from).toBe("P1, P3");
        expect(rows[2].step).toBe("");
    });

    it("is empty before a summary", () => {
        expect(sheetDirections(council({ summary: undefined }))).toEqual([]);
    });
});

describe("sheetAsks", () => {
    it("names who each question is for, the whole panel when no seat", () => {
        expect(sheetAsks(council())).toEqual([
            { to: "UX", text: "Keep the price on the hero?", fill: "@UX Keep the price on the hero?" },
            { to: "Whole panel", text: "Can we link the playground?", fill: "Can we link the playground?" },
        ]);
    });

    it("leaves out a question the person already asked", () => {
        const c = council({ replies: [reply("R9", "", "you", { text: "Can we link the playground? please" })] });
        expect(sheetAsks(c).map((a) => a.text)).toEqual(["Keep the price on the hero?"]);
    });
});

describe("sheetFold and matrixRows", () => {
    it("counts the kept directions and the proposals", () => {
        expect(sheetFold(council())).toEqual({ keptLabel: "Also raised", kept: 2, proposals: 3 });
        expect(sheetFold(council({ mode: "brainstorm" }))?.keptLabel).toBe("Wild ideas kept aside");
    });

    it("has no fold with nothing behind it", () => {
        expect(sheetFold(council({ proposals: [], summary: undefined }))).toBeNull();
    });

    it("lists the proposals by standing, the withdrawn one last and dim, with the summary's outcome", () => {
        const rows = matrixRows(council());
        expect(rows.map((r) => [r.id, r.author, r.standing, r.outcome, r.out])).toEqual([
            ["P1", "UX", "+1", "Kept", false],
            ["P2", "RAM", "0", "", false],
            ["P3", "Skeptic", "0", "Withdrawn", true],
        ]);
    });
});

describe("reportPath", () => {
    it("reads the saved report relative to the project", () => {
        expect(reportPath(council({ docpath: "D:\\code\\website\\docs\\council\\2026-11-05-home.md" }))).toBe(
            "docs/council/2026-11-05-home.md"
        );
        expect(reportPath(council())).toBe("");
    });
});

describe("workOnInput", () => {
    const list = [{ name: "website", path: "d:/code/website" }];
    const d = { title: "Keep a demo button in reach", step: "Add the button" };

    it("selects the council's project and fills the title and the first step", () => {
        expect(workOnInput(council(), d, list)).toEqual({
            project: "website",
            task: "Keep a demo button in reach\n\nFirst step: Add the button",
        });
    });

    it("leaves the project unset for a council with no project path", () => {
        expect(workOnInput(council({ project: "" }), d, list).project).toBeUndefined();
    });

    it("leaves the project unset for a folder no project holds", () => {
        expect(workOnInput(council({ project: "D:\\elsewhere" }), d, list).project).toBeUndefined();
    });

    it("fills the title alone when there is no first step", () => {
        expect(workOnInput(council(), { title: "Strip the notes", step: "" }, list).task).toBe("Strip the notes");
    });
});

describe("chunkLabelFor", () => {
    it("is the first step, else the title, fit to a label", () => {
        expect(chunkLabelFor({ title: "T", step: "Do it" })).toBe("Do it");
        expect(chunkLabelFor({ title: "T", step: "" })).toBe("T");
        const long = chunkLabelFor({ title: "T", step: "x".repeat(300) });
        expect(long.length).toBe(200);
        expect(long.endsWith("…")).toBe(true);
    });
});
