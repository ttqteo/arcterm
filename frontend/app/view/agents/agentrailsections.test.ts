import { sectionExpandable, sectionOpen } from "@/app/element/railsections";
import { describe, expect, it } from "vitest";
import {
    bgTaskStatusLabel,
    planAgentRail,
    planTerminalRail,
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
    terminals: 0,
    terminalsOther: 0,
    tools: 4,
    hasRun: false,
};
const ids = (i: AgentRailInput) => planAgentRail(i).map((s) => s.id);
const header = (i: AgentRailInput, id: AgentRailSectionId) => planAgentRail(i).find((s) => s.id === id)?.header;

describe("planAgentRail", () => {
    it("lists attention first, then what the agent holds, then the facts last, keeping empty counted sections", () => {
        expect(ids(base)).toEqual([
            "subagents",
            "files",
            "artifacts",
            "uploads",
            "bgtasks",
            "terminals",
            "tools",
            "details",
            "usage",
        ]);
        expect(header(base, "subagents")).toEqual({ count: 0 });
    });
    it("needs-you leads, uncounted, only when something waits", () => {
        expect(ids({ ...base, needsYou: 2 })[0]).toBe("needs");
        expect(planAgentRail({ ...base, needsYou: 2 })[0].header).toBeUndefined();
    });
    it("the run section sits after the counted ones and the tools", () => {
        expect(ids({ ...base, hasRun: true })).toEqual([
            "subagents",
            "files",
            "artifacts",
            "uploads",
            "bgtasks",
            "terminals",
            "tools",
            "run",
            "details",
            "usage",
        ]);
    });
    it("details and token usage start closed", () => {
        expect(header(base, "details")).toEqual({ defaultOpen: false });
        expect(header(base, "usage")).toEqual({ defaultOpen: false });
    });
    it("files with no count (loading, not a repo) has a header but no number", () => {
        expect(header({ ...base, files: null }, "files")).toEqual({});
    });
    it("a subagent interior shows its head, tools, details and usage only", () => {
        expect(
            ids({ ...base, inSubagent: true, needsYou: 1, hasRun: true, artifacts: 2, uploads: 1, terminals: 3 })
        ).toEqual(["subagent", "tools", "details", "usage"]);
    });
    it("artifacts counts the agent's boards, and goes inert at zero", () => {
        expect(header({ ...base, artifacts: 2 }, "artifacts")).toEqual({ count: 2 });
        expect(sectionExpandable(header(base, "artifacts")!)).toBe(false);
    });
    it("uploads stays openable when empty (Attach lives in its body) and starts closed until it has records", () => {
        expect(header(base, "uploads")).toEqual({ count: 0, emptyOpenable: true, defaultOpen: false });
        expect(header({ ...base, uploads: 3 }, "uploads")).toEqual({
            count: 3,
            emptyOpenable: true,
            defaultOpen: true,
        });
        expect(sectionExpandable(header(base, "uploads")!)).toBe(true);
        expect(sectionOpen({}, "uploads", header(base, "uploads")!)).toBe(false);
        expect(sectionOpen({}, "uploads", header({ ...base, uploads: 3 }, "uploads")!)).toBe(true);
    });
    it("terminals counts what the rail lists", () => {
        expect(header({ ...base, terminals: 2 }, "terminals")).toEqual({ count: 2 });
        expect(header({ ...base, terminals: 1, terminalsOther: 4 }, "terminals")).toEqual({ count: 1 });
    });
    it("terminals with none in this project stays openable only when other projects have some to show", () => {
        expect(header(base, "terminals")).toEqual({ count: 0 });
        expect(sectionExpandable(header(base, "terminals")!)).toBe(false);
        expect(header({ ...base, terminalsOther: 2 }, "terminals")).toEqual({ count: 0, emptyOpenable: true });
        expect(sectionExpandable(header({ ...base, terminalsOther: 2 }, "terminals")!)).toBe(true);
        // no defaultOpen: it opens at 0, so the toggle for the other projects' terminals is visible
        expect(sectionOpen({}, "terminals", header({ ...base, terminalsOther: 2 }, "terminals")!)).toBe(true);
    });
});

describe("planTerminalRail", () => {
    it("a focused terminal's rail is the Terminals section alone", () => {
        expect(planTerminalRail({ terminals: 2, terminalsOther: 0 })).toEqual([
            { id: "terminals", header: { count: 2 } },
        ]);
    });
    it("it follows the same openable rule as an agent's Terminals section", () => {
        expect(planTerminalRail({ terminals: 0, terminalsOther: 3 })).toEqual([
            { id: "terminals", header: { count: 0, emptyOpenable: true } },
        ]);
    });
});

describe("bgTaskStatusLabel", () => {
    it("a running task of a session that is no longer live is unknown", () => {
        expect(bgTaskStatusLabel("running", true)).toBe("running");
        expect(bgTaskStatusLabel("running", false)).toBe("unknown");
        expect(bgTaskStatusLabel("completed", false)).toBe("completed");
    });
});
