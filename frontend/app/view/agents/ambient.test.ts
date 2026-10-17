import { describe, expect, it } from "vitest";
import { ambientRefForFinding, emptyAmbientProvider, makeAmbientProvider } from "./ambient";

const NOW = 10_000_000;
const DAY = 24 * 60 * 60 * 1000;

const DATA: CommandResolveAmbientRtnData = {
    tasks: [
        { id: "task-auth", label: "PROJ-142" },
        { id: "task-shell", label: "drop the electron shell" },
        { id: "task-quiet", label: "QUIET-1" },
    ],
    edges: [
        { oref: "run:r1", dossierid: "task-auth", provenance: "dispatch", bucket: "strong", state: "confirmed" },
        { oref: "run:r1", dossierid: "task-shell", provenance: "structural", bucket: "weak", state: "informing" },
        { oref: "run:r2", dossierid: "task-shell", provenance: "ticket-match", bucket: "medium", state: "confirmed" },
    ],
    decisions: [
        { dossierid: "task-auth", id: "dec-1", title: "drop-oldest on overflow", created: NOW - 2 * DAY },
        { dossierid: "task-shell", id: "dec-2", title: "shared working tree", created: NOW - 5 * DAY },
        { dossierid: "task-quiet", id: "dec-3", title: "unreachable", created: NOW - DAY },
    ],
};

const provider = makeAmbientProvider(DATA, () => NOW);

describe("makeAmbientProvider", () => {
    it("tags a run with every dossier it is attributed to, carrying the confidence encoding", () => {
        const tags = provider.tagsFor({ oref: "run:r1" });
        expect(tags.map((t) => t.taskId)).toEqual(["task-auth", "task-shell"]);
        expect(tags[0]).toMatchObject({ label: "PROJ-142", bucket: "strong", state: "confirmed" });
        expect(tags[1]).toMatchObject({ label: "drop the electron shell", bucket: "weak", state: "informing" });
    });

    it("shows no tag for an unattributed object — the fixture always showed something", () => {
        expect(provider.tagsFor({ oref: "run:unknown" })).toEqual([]);
        expect(provider.tagsFor({})).toEqual([]);
        expect(provider.decisionsFor({ oref: "run:unknown" })).toEqual([]);
    });

    it("resolves a note's [[wikilinks]] to dossier tags and ignores links to non-dossiers", () => {
        const tags = provider.tagsFor({ links: ["task-quiet", "some-memory-note"] });
        expect(tags).toHaveLength(1);
        expect(tags[0]).toMatchObject({ taskId: "task-quiet", label: "QUIET-1", state: "confirmed" });
    });

    it("dedups a task reachable both by edge and by wikilink, keeping the inferred edge", () => {
        const tags = provider.tagsFor({ oref: "run:r1", links: ["task-shell"] });
        expect(tags.map((t) => t.taskId)).toEqual(["task-auth", "task-shell"]);
        expect(tags[1].state).toBe("informing"); // the weak edge, not the wikilink's confirmed
    });

    it("surfaces the decisions of every attributed task, aged against the injected clock", () => {
        const decisions = provider.decisionsFor({ oref: "run:r1" });
        expect(decisions.map((d) => d.id)).toEqual(["dec-1", "dec-2"]);
        expect(decisions[0].ageMs).toBe(2 * DAY);
        // a decision card knows its record, so opening it can land there
        expect(decisions.every((d) => d.taskId === "task-auth" || d.taskId === "task-shell")).toBe(true);
    });

    it("reaches decisions through a wikilink too", () => {
        expect(provider.decisionsFor({ links: ["task-quiet"] }).map((d) => d.id)).toEqual(["dec-3"]);
    });

    it("degrades to nothing before the map loads", () => {
        expect(emptyAmbientProvider.tagsFor({ oref: "run:r1" })).toEqual([]);
        expect(emptyAmbientProvider.decisionsFor({ links: ["task-auth"] })).toEqual([]);
    });
});

describe("ambientRefForFinding", () => {
    it("inherits the attribution of the run that investigated the finding", () => {
        expect(ambientRefForFinding({ investigation: { runid: "r1" } as RadarInvestigation })).toEqual({
            oref: "run:r1",
        });
    });
    it("yields no handle for a finding that was never investigated", () => {
        expect(ambientRefForFinding({})).toEqual({});
        expect(provider.tagsFor(ambientRefForFinding({}))).toEqual([]);
    });
});
