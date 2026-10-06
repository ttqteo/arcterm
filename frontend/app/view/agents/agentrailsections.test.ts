import { sectionExpandable, sectionOpen } from "@/app/element/railsections";
import { describe, expect, it } from "vitest";
import {
    bgTaskStatusLabel,
    planAgentRail,
    planRailStats,
    planTerminalRail,
    railStatAction,
    type AgentRailInput,
    type AgentRailSectionId,
} from "./agentrailsections";

const base: AgentRailInput = {
    inSubagent: false,
    needsYou: 0,
    subagents: 0,
    files: 3,
    artifacts: 0,
    uploads: 0,
    bgTasks: 1,
    hasRun: false,
};
const ids = (i: AgentRailInput) => planAgentRail(i).map((s) => s.id);
const header = (i: AgentRailInput, id: AgentRailSectionId) => planAgentRail(i).find((s) => s.id === id)?.header;

describe("planAgentRail", () => {
    it("opens on the status line, lists only the counted sections that hold something, and ends on usage then details", () => {
        // no Terminals: plain terminals are the Agent tree's own section. No Tools: they are a line in Details
        expect(ids(base)).toEqual(["status", "files", "bgtasks", "usage", "details"]);
        expect(header(base, "files")).toEqual({ count: 3 });
        expect(planAgentRail(base)[0].header).toBeUndefined();
    });
    it("needs-you follows the status line, uncounted, only when something waits", () => {
        expect(ids({ ...base, needsYou: 2 }).slice(0, 2)).toEqual(["status", "needs"]);
        expect(planAgentRail({ ...base, needsYou: 2 })[1].header).toBeUndefined();
    });
    it("keeps the counted sections in the strip's order", () => {
        expect(ids({ ...base, subagents: 1, artifacts: 2, uploads: 4 })).toEqual([
            "status",
            "subagents",
            "files",
            "artifacts",
            "uploads",
            "bgtasks",
            "usage",
            "details",
        ]);
        expect(header({ ...base, uploads: 4 }, "uploads")).toEqual({ count: 4 });
    });
    it("the run section sits after the counted ones", () => {
        expect(ids({ ...base, hasRun: true })).toEqual(["status", "files", "bgtasks", "run", "usage", "details"]);
    });
    it("token usage and details start closed", () => {
        expect(header(base, "usage")).toEqual({ defaultOpen: false });
        expect(header(base, "details")).toEqual({ defaultOpen: false });
    });
    it("files with no count (loading, not a repo) stays listed with a header but no number", () => {
        expect(header({ ...base, files: null }, "files")).toEqual({});
        expect(ids({ ...base, files: 0 })).not.toContain("files");
    });
    it("a subagent interior shows its head, the status line, usage and details only", () => {
        expect(ids({ ...base, inSubagent: true, needsYou: 1, hasRun: true, artifacts: 2, uploads: 1 })).toEqual([
            "subagent",
            "status",
            "usage",
            "details",
        ]);
    });
});

describe("planRailStats", () => {
    it("counts every list section in one fixed order, empty or not, so the strip keeps one shape", () => {
        expect(planRailStats(base)).toEqual([
            { id: "subagents", count: 0 },
            { id: "files", count: 3 },
            { id: "artifacts", count: 0 },
            { id: "uploads", count: 0 },
            { id: "bgtasks", count: 1 },
        ]);
    });
    it("a subagent interior has no strip counts: those sections are its parent's", () => {
        expect(planRailStats({ ...base, inSubagent: true })).toEqual([]);
    });
    it("the strip and the body agree: a stat opens its section exactly when the body lists it", () => {
        const i: AgentRailInput = { ...base, files: null, artifacts: 2 };
        const listed = new Set(ids(i));
        for (const s of planRailStats(i)) {
            expect(railStatAction(s) === "open").toBe(listed.has(s.id));
        }
    });
});

describe("railStatAction", () => {
    it("opens a section with something in it, or one not counted yet", () => {
        expect(railStatAction({ id: "files", count: 3 })).toBe("open");
        expect(railStatAction({ id: "files", count: null })).toBe("open");
    });
    it("an empty Uploads attaches instead, so Attach is one click before the first upload", () => {
        expect(railStatAction({ id: "uploads", count: 0 })).toBe("attach");
        expect(railStatAction({ id: "uploads", count: 2 })).toBe("open");
    });
    it("any other empty stat is inert", () => {
        expect(railStatAction({ id: "subagents", count: 0 })).toBeNull();
        expect(railStatAction({ id: "bgtasks", count: 0 })).toBeNull();
    });
});

describe("planTerminalRail", () => {
    const terminalsHeader = (terminals: number, terminalsOther: number) =>
        planTerminalRail({ terminals, terminalsOther })[0].header;

    it("a focused terminal's rail is the Terminals section alone", () => {
        expect(planTerminalRail({ terminals: 2, terminalsOther: 0 })).toEqual([
            { id: "terminals", header: { count: 2 } },
        ]);
    });
    it("counts what the rail lists", () => {
        expect(terminalsHeader(1, 4)).toEqual({ count: 1 });
    });
    it("with none in this project stays openable only when other projects have some to show", () => {
        expect(terminalsHeader(0, 0)).toEqual({ count: 0 });
        expect(sectionExpandable(terminalsHeader(0, 0))).toBe(false);
        expect(terminalsHeader(0, 3)).toEqual({ count: 0, emptyOpenable: true });
        expect(sectionExpandable(terminalsHeader(0, 3))).toBe(true);
        // no defaultOpen: it opens at 0, so the toggle for the other projects' terminals is visible
        expect(sectionOpen({}, "terminals", terminalsHeader(0, 3))).toBe(true);
    });
});

describe("bgTaskStatusLabel", () => {
    it("a running task of a session that is no longer live is unknown", () => {
        expect(bgTaskStatusLabel("running", true)).toBe("running");
        expect(bgTaskStatusLabel("running", false)).toBe("unknown");
        expect(bgTaskStatusLabel("completed", false)).toBe("completed");
    });
});
