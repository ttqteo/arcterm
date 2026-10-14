import { describe, expect, it } from "vitest";
import {
    acceptOps,
    attachAgentOp,
    continueMessage,
    dropOps,
    linkOp,
    proposedRows,
    restoreOps,
    unacceptOps,
} from "./proposedmodel";

const chunks = [
    { label: "Done one", status: "done" },
    {
        label: "Radial layout model",
        status: "proposed",
        stage: "Build",
        notes: [{ ts: 1, text: "angles by leaf count" }],
    },
    { label: "CDP scenario", status: "proposed", stage: "Verify" },
];

describe("proposedRows", () => {
    it("lists the proposed chunks in plan order with stage and newest note", () => {
        expect(proposedRows(chunks as any)).toEqual([
            { label: "Radial layout model", meta: "Build · angles by leaf count" },
            { label: "CDP scenario", meta: "Verify" },
        ]);
    });

    it("reads the newest note whatever order the trail is in", () => {
        const trail = [
            { ts: 9, text: "newest" },
            { ts: 2, text: "older" },
        ];
        expect(proposedRows([{ label: "X", status: "proposed", notes: trail }] as any)).toEqual([
            { label: "X", meta: "newest" },
        ]);
    });

    it("leaves a chunk with neither stage nor note with an empty meta", () => {
        expect(proposedRows([{ label: "X", status: "proposed" }] as any)).toEqual([{ label: "X", meta: "" }]);
    });

    it("lists nothing when no chunk is proposed", () => {
        expect(proposedRows([{ label: "A", status: "done" }] as any)).toEqual([]);
        expect(proposedRows([])).toEqual([]);
    });
});

describe("ops", () => {
    it("accepts as pending", () => {
        expect(acceptOps(["CDP scenario"])).toEqual([
            { op: "setChunkStatus", chunk: "CDP scenario", status: "pending" },
        ]);
    });

    it("unaccepts back to proposed, the Undo of an accept", () => {
        expect(unacceptOps("CDP scenario")).toEqual([
            { op: "setChunkStatus", chunk: "CDP scenario", status: "proposed" },
        ]);
    });

    it("drops highest position first", () => {
        expect(dropOps(chunks as any, ["Radial layout model", "CDP scenario"]).map((o) => o.chunk)).toEqual([
            "CDP scenario",
            "Radial layout model",
        ]);
        expect(dropOps(chunks as any, ["CDP scenario", "Radial layout model"]).map((o) => o.op)).toEqual([
            "removeChunk",
            "removeChunk",
        ]);
    });

    it("sends an all-digit label as its position, which the server would read as an index", () => {
        const numbered = [
            { label: "Intro", status: "done" },
            { label: "2", status: "proposed" },
        ];
        expect(dropOps(numbered as any, ["2"])).toEqual([{ op: "removeChunk", chunk: "2" }]);
        const shifted = [
            { label: "Intro", status: "done" },
            { label: "Mid", status: "pending" },
            { label: "2", status: "proposed" },
        ];
        expect(dropOps(shifted as any, ["2"])).toEqual([{ op: "removeChunk", chunk: "3" }]);
    });

    it("restores a dropped chunk as proposed at its old stage and 1-based position, the Undo of a drop", () => {
        expect(restoreOps("CDP scenario", "Verify", 3)).toEqual([
            { op: "addChunk", label: "CDP scenario", stage: "Verify", status: "proposed", at: 3 },
        ]);
        expect(restoreOps("Bare", "", 1)[0].stage).toBeUndefined();
    });

    it("words the continue line", () => {
        expect(continueMessage("Radial layout model")).toBe("Plan accepted, start with Radial layout model\r");
    });

    it("attaches an agent tab to a chunk", () => {
        expect(attachAgentOp("Build", "tab-1")).toEqual({
            op: "attachWork",
            chunk: "Build",
            kind: "agent",
            oref: "agent:tab-1",
        });
    });

    it("links to a parent by its bare oid, and an empty parent unlinks", () => {
        expect(linkOp("effort:abc")).toEqual({ op: "link", parentoid: "abc" });
        expect(linkOp("abc")).toEqual({ op: "link", parentoid: "abc" });
        expect(linkOp("")).toEqual({ op: "link", parentoid: "" });
    });
});
