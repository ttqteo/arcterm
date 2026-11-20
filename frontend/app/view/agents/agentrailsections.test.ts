import { describe, expect, it } from "vitest";
import {
    bgSessionLive,
    bgTaskElapsed,
    bgTaskGroups,
    bgTaskStatusLabel,
    bgTaskStopNote,
    bgTaskStoppable,
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
    it("has no plan to review section: it lives on the Initiative tab", () => {
        // the session block is the first section, ahead of needs-you, whatever the initiative holds
        expect(ids(base)[0]).toBe("status");
        expect(ids({ ...base, needsYou: 2 }).slice(0, 2)).toEqual(["status", "needs"]);
        for (const i of [base, { ...base, needsYou: 1, hasRun: true }, { ...base, inSubagent: true }]) {
            expect(ids(i) as string[]).not.toContain("plan");
        }
    });
    it("a subagent interior shows its head and the session block only", () => {
        expect(ids({ ...base, inSubagent: true, needsYou: 1, hasRun: true, artifacts: 2, uploads: 1 })).toEqual([
            "subagent",
            "status",
        ]);
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

describe("Verify", () => {
    const red = { tone: "red", label: "1", struck: true, pulsing: false } as const;
    const verifyId = (id: string) => id === "verify";

    it("has no stat and no tile for an agent with no Verify strip", () => {
        expect(planRailStats(base).some((s) => verifyId(s.id))).toBe(false);
        expect(ids(base).some(verifyId)).toBe(false);
        expect(planRailStats({ ...base, verify: null }).some((s) => verifyId(s.id))).toBe(false);
        expect(ids({ ...base, verify: null }).some(verifyId)).toBe(false);
    });
    it("the strip counts Verify after Background tasks, carrying the tile's own strip", () => {
        const stats = planRailStats({ ...base, verify: red });
        expect(stats.map((s) => s.id)).toEqual(["files", "uploads", "bgtasks", "verify"]);
        expect(stats[stats.length - 1]).toEqual({ id: "verify", count: null, verify: red });
    });
    it("counts Verify even with nothing else to count", () => {
        const i: AgentRailInput = { ...base, files: 0, bgTasks: 0, uploads: 0, verify: red };
        expect(planRailStats(i).map((s) => s.id)).toEqual(["uploads", "verify"]);
    });
    it("the tile sits after the session block and Needs you, before the counted sections, with no header of its own", () => {
        expect(ids({ ...base, verify: red })).toEqual(["status", "verify", "files", "bgtasks"]);
        expect(ids({ ...base, verify: red, needsYou: 2 })).toEqual(["status", "needs", "verify", "files", "bgtasks"]);
        expect(header({ ...base, verify: red }, "verify")).toBeUndefined();
    });
    it("the run section still comes last", () => {
        expect(ids({ ...base, verify: red, hasRun: true })).toEqual(["status", "verify", "files", "bgtasks", "run"]);
    });
    it("a subagent interior shows neither the tile nor the count: Verify is its parent's", () => {
        expect(ids({ ...base, verify: red, inSubagent: true })).toEqual(["subagent", "status"]);
        expect(planRailStats({ ...base, verify: red, inSubagent: true })).toEqual([]);
    });
    it("its count opens the tile: strip and body agree", () => {
        const i: AgentRailInput = { ...base, verify: red };
        const stat = planRailStats(i).find((s) => s.id === "verify")!;
        expect(railStatAction(stat)).toBe("open");
        expect(ids(i)).toContain("verify");
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

describe("bgTaskGroups", () => {
    const t = (id: string, status: "running" | "completed" | "failed" | "stopped") => ({
        toolUseId: id,
        label: id,
        status,
    });

    it("splits the tasks into running and finished, newest first in each", () => {
        const g = bgTaskGroups([t("a", "completed"), t("b", "running"), t("c", "failed"), t("d", "running")], true);
        expect(g.running.map((x) => x.toolUseId)).toEqual(["d", "b"]);
        expect(g.finished.map((x) => x.toolUseId)).toEqual(["c", "a"]);
    });

    it("counts a task left running by a session that is gone as finished: nothing runs it now", () => {
        const g = bgTaskGroups([t("a", "running")], false);
        expect(g.running).toEqual([]);
        expect(g.finished.map((x) => x.toolUseId)).toEqual(["a"]);
    });
});

describe("bgTaskElapsed", () => {
    it("is how long a finished task ran", () => {
        expect(bgTaskElapsed({ startMs: 1_000, endMs: 128_000 }, 999_999)).toBe("2m 7s");
    });

    it("counts a running task up to now", () => {
        expect(bgTaskElapsed({ startMs: 1_000 }, 13_500)).toBe("12s");
    });

    it("is empty when the start is not known", () => {
        expect(bgTaskElapsed({ endMs: 5_000 }, 9_000)).toBe("");
    });
});

describe("bgTaskStatusLabel", () => {
    it("a running task of a session that is no longer live is unknown", () => {
        expect(bgTaskStatusLabel("running", true)).toBe("running");
        expect(bgTaskStatusLabel("running", false)).toBe("unknown");
        expect(bgTaskStatusLabel("completed", false)).toBe("completed");
    });
});

describe("bgSessionLive", () => {
    it("is one rule for the rail and the task peek: a terminal block, and not ended", () => {
        expect(bgSessionLive("blk", false)).toBe(true);
        expect(bgSessionLive(undefined, false)).toBe(false);
        // the rail's ended worker, or an agent the peek no longer finds in the roster
        expect(bgSessionLive("blk", true)).toBe(false);
    });
});

describe("bgTaskStoppable", () => {
    it("offers Stop only on a running task of a live session that has a command", () => {
        expect(bgTaskStoppable({ status: "running", command: "task dev" }, true)).toBe(true);
        expect(bgTaskStoppable({ status: "running", command: "task dev" }, false)).toBe(false);
        expect(bgTaskStoppable({ status: "completed", command: "task dev" }, true)).toBe(false);
        expect(bgTaskStoppable({ status: "running" }, true)).toBe(false);
    });
});

describe("bgTaskStopNote", () => {
    it("says nothing for a stop, since the row turning stopped says it", () => {
        expect(bgTaskStopNote({ outcome: "killed" }, "Run the dev app")).toBeNull();
    });

    it("names the task for every other outcome, with the OS text on a failure", () => {
        expect(bgTaskStopNote({ outcome: "gone" }, "Run the dev app")).toBe('"Run the dev app" had already ended.');
        expect(bgTaskStopNote({ outcome: "failed", error: "Access is denied." }, "Run the dev app")).toBe(
            'Could not stop "Run the dev app": Access is denied.'
        );
        expect(bgTaskStopNote({ outcome: "refused" }, "Run the dev app")).toMatch(/^Not stopped: /);
    });
});
