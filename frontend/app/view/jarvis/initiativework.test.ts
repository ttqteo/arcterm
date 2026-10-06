import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import {
    initiativeLinkText,
    initiativeResume,
    noteStamp,
    openAgentFor,
    projectPathFor,
    resumeIsBlank,
    workOnPrompt,
} from "./initiativework";

const agent = (over: Partial<AgentVM>): AgentVM => ({ id: "t", name: "a", task: "", state: "idle", ...over });

describe("workOnPrompt", () => {
    it("asks where we are, naming the initiative by title and id", () => {
        expect(workOnPrompt("Anomaly-driven hypothesis system", "c4157d0e")).toBe(
            "check the initiative Anomaly-driven hypothesis system (effort:c4157d0e), where are we"
        );
    });

    it("points at the newest note when there is one", () => {
        const ts = new Date(2026, 8, 29, 16, 17).getTime();
        expect(workOnPrompt("X", "e1", { ts })).toBe(
            "check the initiative X (effort:e1), where are we. Pick up from the newest note (09-29 16:17)."
        );
    });
});

describe("noteStamp", () => {
    it("reads as month-day hour:minute, the way wsh effort show prints notes", () => {
        expect(noteStamp(new Date(2026, 0, 5, 9, 3).getTime())).toBe("01-05 09:03");
    });
});

describe("openAgentFor", () => {
    it("finds the open agent linked to the initiative", () => {
        const agents = [agent({ id: "a" }), agent({ id: "b", effortId: "e1" })];
        expect(openAgentFor("e1", agents)?.id).toBe("b");
    });

    it("ignores run agents and terminals: their run or shell owns them", () => {
        const agents = [
            agent({ id: "w", effortId: "e1", runId: "r1" }),
            agent({ id: "t", effortId: "e1", kind: "terminal" }),
        ];
        expect(openAgentFor("e1", agents)).toBeUndefined();
    });

    it("prefers the agent that needs you, then the busy one, then the most recently idle", () => {
        const idleOld = agent({ id: "old", effortId: "e1", idleSince: 100 });
        const idleNew = agent({ id: "new", effortId: "e1", idleSince: 200 });
        const working = agent({ id: "work", effortId: "e1", state: "working" });
        const asking = agent({ id: "ask", effortId: "e1", state: "asking" });
        expect(openAgentFor("e1", [idleOld, idleNew])?.id).toBe("new");
        expect(openAgentFor("e1", [idleNew, working])?.id).toBe("work");
        expect(openAgentFor("e1", [working, asking])?.id).toBe("ask");
    });
});

describe("initiativeResume", () => {
    const NOW = 10_000_000;

    it("offers Go to it while a linked agent is open, saying how it is", () => {
        const agents = [agent({ id: "b", effortId: "e1", idleSince: NOW - 22 * 60_000 })];
        expect(initiativeResume("e1", undefined, agents, NOW)).toEqual({
            kind: "go",
            agentId: "b",
            status: "open · idle 22m",
        });
        expect(initiativeResume("e1", undefined, [agent({ id: "b", effortId: "e1", state: "working" })], NOW)).toEqual({
            kind: "go",
            agentId: "b",
            status: "open · working",
        });
    });

    it("otherwise offers Work on, with the newest note as where it was left", () => {
        const ts = new Date(2026, 8, 29, 16, 17).getTime();
        expect(initiativeResume("e1", { ts, text: "merged to LOCAL DEV" }, [], NOW)).toEqual({
            kind: "work",
            status: "last note",
            when: "09-29 16:17",
            note: "merged to LOCAL DEV",
        });
    });

    it("says so when the initiative has no notes yet", () => {
        expect(initiativeResume("e1", undefined, [], NOW)).toEqual({
            kind: "work",
            status: "no notes yet",
            when: "",
            note: "",
        });
    });
});

describe("initiativeLinkText", () => {
    const effort = { title: "Anomaly-driven hypothesis system" };

    it("names the initiative", () => {
        expect(initiativeLinkText("some ai title", effort)).toBe("◇ Anomaly-driven hypothesis system");
    });

    it("does not repeat a title the session is already named after", () => {
        expect(initiativeLinkText("Anomaly-driven hypothesis system", effort)).toBe("◇ initiative");
    });

    it("reads as a plain link until the initiative has loaded", () => {
        expect(initiativeLinkText("x", undefined)).toBe("◇ initiative");
    });
});

describe("projectPathFor", () => {
    const registry = { waveterm: { path: "C:/src/waveterm" }, bare: {} };

    it("resolves a registered project's folder", () => {
        expect(projectPathFor("waveterm", registry)).toBe("C:/src/waveterm");
    });

    it("has no folder for an unset, unknown or pathless project", () => {
        expect(projectPathFor(undefined, registry)).toBe("");
        expect(projectPathFor("nope", registry)).toBe("");
        expect(projectPathFor("bare", registry)).toBe("");
    });
});

describe("resumeIsBlank", () => {
    it("is blank with no agent open and no note but the creation stamp", () => {
        expect(resumeIsBlank({ kind: "work", status: "no notes yet", when: "", note: "" })).toBe(true);
        expect(resumeIsBlank({ kind: "work", status: "last note", when: "10-06 14:12", note: "effort created" })).toBe(
            true
        );
    });

    it("has something to say with a real note or an agent open on it", () => {
        expect(resumeIsBlank({ kind: "work", status: "last note", when: "10-06 14:12", note: "spec drafted" })).toBe(
            false
        );
        expect(resumeIsBlank({ kind: "go", agentId: "a1", status: "open · working" })).toBe(false);
    });
});
