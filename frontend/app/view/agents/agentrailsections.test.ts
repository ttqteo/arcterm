import { describe, expect, it } from "vitest";
import {
    bgTaskStatusLabel,
    planAgentRail,
    planRailStats,
    railStatAction,
    railStatClick,
    type AgentRailInput,
    type AgentRailSectionId,
} from "./agentrailsections";

const base: AgentRailInput = {
    inSubagent: false,
    needsYou: 0,
    ideas: 0,
    ideasFresh: 0,
    subagents: 0,
    files: 3,
    artifacts: 0,
    uploads: 0,
    servers: 0,
    bgTasks: 1,
    hasRun: false,
};
const ids = (i: AgentRailInput) => planAgentRail(i).map((s) => s.id);
const header = (i: AgentRailInput, id: AgentRailSectionId) => planAgentRail(i).find((s) => s.id === id)?.header;

describe("planAgentRail", () => {
    it("opens on the session block and lists only the counted sections that hold something", () => {
        // no Terminals: plain terminals are the Agent tree's own section. No Tools: they are a line in the session block.
        // No Token usage or Details: the session block holds both
        expect(ids(base)).toEqual(["status", "files", "bgtasks"]);
        expect(header(base, "files")).toEqual({ count: 3 });
        expect(planAgentRail(base)[0].header).toBeUndefined();
    });
    it("needs-you follows the status line, uncounted, only when something waits", () => {
        expect(ids({ ...base, needsYou: 2 }).slice(0, 2)).toEqual(["status", "needs"]);
        expect(planAgentRail({ ...base, needsYou: 2 })[1].header).toBeUndefined();
    });
    it("keeps the counted sections in the strip's order", () => {
        expect(ids({ ...base, subagents: 1, artifacts: 2, uploads: 4, servers: 2 })).toEqual([
            "status",
            "subagents",
            "files",
            "artifacts",
            "uploads",
            "servers",
            "bgtasks",
        ]);
        expect(header({ ...base, uploads: 4 }, "uploads")).toEqual({ count: 4 });
    });
    it("the run section sits after the counted ones", () => {
        expect(ids({ ...base, hasRun: true })).toEqual(["status", "files", "bgtasks", "run"]);
    });
    it("files with no count (loading, not a repo) stays listed with a header but no number", () => {
        expect(header({ ...base, files: null }, "files")).toEqual({});
        expect(ids({ ...base, files: 0 })).not.toContain("files");
    });
    it("a subagent interior shows its head and the session block only", () => {
        expect(ids({ ...base, inSubagent: true, needsYou: 1, hasRun: true, artifacts: 2, uploads: 1 })).toEqual([
            "subagent",
            "status",
        ]);
    });
});

describe("the Ideas count and section", () => {
    it("the count is the first in the strip, and absent at 0", () => {
        expect(planRailStats({ ...base, ideas: 9 })[0]).toEqual({ id: "ideas", count: 9, fresh: false, newCount: 0 });
        expect(planRailStats(base).map((s) => s.id)).not.toContain("ideas");
    });
    it("passes the unread through: a dot while any idea is new, and how many", () => {
        expect(planRailStats({ ...base, ideas: 9, ideasFresh: 4 })[0]).toEqual({
            id: "ideas",
            count: 9,
            fresh: true,
            newCount: 4,
        });
        expect(planRailStats({ ...base, ideas: 9, ideasFresh: 0 })[0].fresh).toBe(false);
    });
    it("the section follows needs-you, before the other counted sections, with its count", () => {
        expect(ids({ ...base, ideas: 9 })).toEqual(["status", "ideas", "files", "bgtasks"]);
        expect(ids({ ...base, ideas: 9, needsYou: 2, subagents: 1 })).toEqual([
            "status",
            "needs",
            "ideas",
            "subagents",
            "files",
            "bgtasks",
        ]);
        expect(header({ ...base, ideas: 9 }, "ideas")).toEqual({ count: 9, defaultOpen: false });
    });
    it("opens only when asked: the count and its dot say something is there, the click opens it", () => {
        expect(header({ ...base, ideas: 2 }, "ideas")?.defaultOpen).toBe(false);
        expect(header({ ...base, subagents: 2 }, "subagents")?.defaultOpen).toBeUndefined();
    });
    it("is not listed at 0, and the strip and the body agree", () => {
        expect(ids(base)).not.toContain("ideas");
        const i: AgentRailInput = { ...base, ideas: 2, ideasFresh: 1 };
        const listed = new Set(ids(i));
        for (const s of planRailStats(i)) {
            expect(railStatAction(s) === "open").toBe(listed.has(s.id));
        }
    });
    it("a subagent interior has neither the count nor the section: they are its parent's", () => {
        expect(planRailStats({ ...base, ideas: 3, inSubagent: true })).toEqual([]);
        expect(ids({ ...base, ideas: 3, inSubagent: true })).toEqual(["subagent", "status"]);
    });
    it("an empty Ideas count is inert, like any other empty list", () => {
        expect(railStatAction({ id: "ideas", count: 0 })).toBeNull();
        expect(railStatAction({ id: "ideas", count: 3 })).toBe("open");
    });
    // the shortcut with nothing selected on a session with no ideas yet: the Add an idea box is in the section
    it("is listed at 0 once its input was asked for, open, with no count, and the strip still shows none", () => {
        const asked: AgentRailInput = { ...base, ideasRequested: true };
        expect(ids(asked)).toEqual(["status", "ideas", "files", "bgtasks"]);
        expect(header(asked, "ideas")).toEqual({ defaultOpen: true });
        expect(planRailStats(asked).map((s) => s.id)).not.toContain("ideas");
        expect(ids({ ...asked, needsYou: 1 }).slice(0, 3)).toEqual(["status", "needs", "ideas"]);
    });
    it("is the ordinary counted section once it holds something, asked for or not", () => {
        expect(planAgentRail({ ...base, ideas: 2, ideasRequested: true }).filter((s) => s.id === "ideas")).toEqual([
            { id: "ideas", header: { count: 2, defaultOpen: false } },
        ]);
    });
    it("is never asked for inside a subagent's interior", () => {
        expect(ids({ ...base, inSubagent: true, ideasRequested: true })).toEqual(["subagent", "status"]);
    });
});

describe("planRailStats", () => {
    it("counts only the lists a click acts on: those holding something, and an empty Uploads (it attaches)", () => {
        expect(planRailStats(base)).toEqual([
            { id: "files", count: 3 },
            { id: "uploads", count: 0 },
            { id: "bgtasks", count: 1 },
        ]);
    });
    it("the strip counts Servers between Uploads and Background tasks, and the body lists it only above zero", () => {
        const full = { ...base, subagents: 1, artifacts: 1, uploads: 1, servers: 1 };
        expect(planRailStats(full).map((s) => s.id)).toEqual([
            "subagents",
            "files",
            "artifacts",
            "uploads",
            "servers",
            "bgtasks",
        ]);
        expect(ids({ ...base, servers: 0 })).not.toContain("servers");
        expect(header({ ...base, servers: 3 }, "servers")).toEqual({ count: 3 });
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

describe("Files changed with a branch to switch to", () => {
    it("lists its section and opens from the strip even while the session's list is empty", () => {
        const i: AgentRailInput = { ...base, files: 0, filesSwitchable: true };
        expect(ids(i)).toContain("files");
        expect(header(i, "files")).toEqual({ count: 0 });
        const stat = planRailStats(i).find((s) => s.id === "files")!;
        expect(railStatAction(stat)).toBe("open");
    });
    it("without one, an empty list stays out of the body", () => {
        expect(ids({ ...base, files: 0 })).not.toContain("files");
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

describe("railStatClick", () => {
    const view = { top: 100, bottom: 600 };
    it("closes an open section whose header row is on screen", () => {
        expect(railStatClick(true, { top: 200, bottom: 226 }, view)).toBe("close");
    });
    it("opens a closed section", () => {
        expect(railStatClick(false, { top: 200, bottom: 226 }, view)).toBe("open");
    });
    it("brings an open section scrolled out of view back instead of closing it unseen", () => {
        expect(railStatClick(true, { top: 40, bottom: 66 }, view)).toBe("open");
        expect(railStatClick(true, { top: 590, bottom: 616 }, view)).toBe("open");
    });
    it("opens a section Overview is not showing", () => {
        expect(railStatClick(false, undefined, view)).toBe("open");
    });
});

describe("bgTaskStatusLabel", () => {
    it("a running task of a session that is no longer live is unknown", () => {
        expect(bgTaskStatusLabel("running", true)).toBe("running");
        expect(bgTaskStatusLabel("running", false)).toBe("unknown");
        expect(bgTaskStatusLabel("completed", false)).toBe("completed");
    });
});
