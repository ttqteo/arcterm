import { describe, expect, it } from "vitest";
import { backgroundAgentToVM, backgroundAttachCommand, dedupBackgroundAgents, type AgentVM } from "./agentsviewmodel";

const NOW = 1_000_000;

function bg(sessionid: string, state: string, startedts = NOW - 60_000): BackgroundAgentData {
    return { sessionid, cwd: "C:\\proj", kind: "background", name: "task", state, startedts };
}

describe("backgroundAgentToVM", () => {
    it("maps blocked -> working + needsInput", () => {
        const vm = backgroundAgentToVM(bg("s1", "blocked"), "proj", NOW);
        expect(vm.kind).toBe("background");
        expect(vm.state).toBe("working");
        expect(vm.needsInput).toBe(true);
        expect(vm.id).toBe("s1");
        expect(vm.cwd).toBe("C:\\proj");
        expect(vm.project).toBe("proj");
        expect(vm.activeMs).toBe(60_000);
    });
    it("maps idle -> idle, not needsInput", () => {
        const vm = backgroundAgentToVM(bg("s2", "idle"), "proj", NOW);
        expect(vm.state).toBe("idle");
        expect(vm.needsInput).toBeFalsy();
    });
    it("maps busy/working -> working", () => {
        expect(backgroundAgentToVM(bg("s3", "busy"), "p", NOW).state).toBe("working");
        expect(backgroundAgentToVM(bg("s4", "working"), "p", NOW).state).toBe("working");
    });
});

describe("dedupBackgroundAgents", () => {
    it("drops a background agent already tracked live (by transcript session id)", () => {
        const live: AgentVM[] = [
            { id: "tab1", name: "live", task: "", state: "working", transcriptPath: "/x/projects/p/s1.jsonl" },
        ];
        const background = [
            backgroundAgentToVM(bg("s1", "blocked"), "p", NOW), // dup of live
            backgroundAgentToVM(bg("s2", "working"), "p", NOW), // keep
        ];
        const out = dedupBackgroundAgents(background, live);
        expect(out.map((a) => a.id)).toEqual(["s2"]);
    });
    it("keeps all when nothing matches", () => {
        const live: AgentVM[] = [{ id: "t", name: "l", task: "", state: "idle", transcriptPath: "/x/p/other.jsonl" }];
        const background = [backgroundAgentToVM(bg("s9", "idle"), "p", NOW)];
        expect(dedupBackgroundAgents(background, live)).toHaveLength(1);
    });
});

describe("backgroundAttachCommand", () => {
    it("attaches to the daemon's session by its short id, so the daemon keeps running it", () => {
        const listing = [{ ...bg("1903f81a-1b3e", "blocked"), id: "1903f81a" }, bg("s2", "idle")];
        expect(backgroundAttachCommand(listing, "1903f81a-1b3e")).toBe("claude attach 1903f81a");
    });
    it("falls back to a resume when the entry has no short id or is not listed", () => {
        const listing = [bg("s2", "idle")];
        expect(backgroundAttachCommand(listing, "s2")).toBe("claude --resume s2");
        expect(backgroundAttachCommand([], "gone")).toBe("claude --resume gone");
    });
});
