import { describe, expect, it } from "vitest";
import { correlateSubagents } from "./subagentcorrelate";
import type { SubagentSpawn } from "./transcriptprojection";

const spawn = (over: Partial<SubagentSpawn>): SubagentSpawn => ({
    toolUseId: "t",
    subagentType: "Explore",
    prompt: "look at X",
    done: false,
    failed: false,
    ...over,
});
const file = (over: Partial<SubagentFileInfo>): SubagentFileInfo => ({
    agentid: "a1",
    transcriptpath: "/p/agent-a1.jsonl",
    firstprompt: "look at X",
    startedatms: 1,
    done: false,
    ...over,
});

describe("correlateSubagents", () => {
    it("takes type + success state from a matched, completed spawn", () => {
        const out = correlateSubagents([spawn({ done: true })], [file({})]);
        expect(out).toEqual([
            { id: "a1", type: "Explore", state: "success", transcriptPath: "/p/agent-a1.jsonl", startedAtMs: 1 },
        ]);
    });

    it("carries whether the spawn went to the background", () => {
        expect(correlateSubagents([spawn({ async: true })], [file({})])[0].async).toBe(true);
        expect(correlateSubagents([spawn({})], [file({})])[0].async).toBeUndefined();
        // an unmatched file has no spawn to say so
        expect(correlateSubagents([], [file({})])[0].async).toBeUndefined();
    });

    it("starts at the spawn's timestamp, else at the file's time on disk", () => {
        expect(correlateSubagents([spawn({ startMs: 500 })], [file({ startedatms: 900 })])[0].startedAtMs).toBe(500);
        expect(correlateSubagents([], [file({ startedatms: 900 })])[0].startedAtMs).toBe(900);
        expect(correlateSubagents([], [file({ startedatms: 0 })])[0].startedAtMs).toBeUndefined();
    });

    it("maps an errored spawn to failure", () => {
        const out = correlateSubagents([spawn({ done: true, failed: true })], [file({})]);
        expect(out[0].state).toBe("failure");
    });

    it("maps a matched running spawn to working", () => {
        expect(correlateSubagents([spawn({ done: false })], [file({})])[0].state).toBe("working");
    });

    it("takes a background agent's state from its file: the parent only saw the launch receipt", () => {
        expect(correlateSubagents([spawn({ async: true })], [file({ done: false })])[0].state).toBe("working");
        expect(correlateSubagents([spawn({ async: true })], [file({ done: true })])[0].state).toBe("done");
    });

    it("ends a background agent at its notification: completed is success, failed is failure, whatever its file says", () => {
        const done = (over: Partial<SubagentSpawn>) => spawn({ async: true, done: true, ...over });
        for (const fileDone of [false, true]) {
            expect(correlateSubagents([done({})], [file({ done: fileDone })])[0].state).toBe("success");
            expect(correlateSubagents([done({ failed: true })], [file({ done: fileDone })])[0].state).toBe("failure");
        }
    });

    it("maps an unmatched, unfinished file to working", () => {
        expect(correlateSubagents([], [file({ firstprompt: "orphan", done: false })])[0].state).toBe("working");
    });

    it("maps an unmatched, terminated file to the neutral done state", () => {
        expect(correlateSubagents([], [file({ firstprompt: "orphan", done: true })])[0].state).toBe("done");
    });

    it("matches on normalized whitespace", () => {
        const out = correlateSubagents([spawn({ prompt: "look   at\nX", done: true })], [file({ firstprompt: "look at X" })]);
        expect(out[0].type).toBe("Explore");
    });

    it("pairs parallel same-type spawns 1:1 in file order", () => {
        const spawns = [spawn({ toolUseId: "a", prompt: "P1", done: true }), spawn({ toolUseId: "b", prompt: "P2", done: true, failed: true })];
        const files = [file({ agentid: "f1", firstprompt: "P1" }), file({ agentid: "f2", firstprompt: "P2" })];
        const out = correlateSubagents(spawns, files);
        expect(out.map((s) => [s.id, s.state])).toEqual([["f1", "success"], ["f2", "failure"]]);
    });

    it("falls back to the prompt's first line when no spawn matches", () => {
        const out = correlateSubagents([], [file({ firstprompt: "Investigate the crash\nmore detail" })]);
        expect(out[0].type).toBe("Investigate the crash");
    });

    it("takes the model from the child's own file, matched or not", () => {
        expect(correlateSubagents([spawn({})], [file({ model: "claude-opus-5-5" })])[0].model).toBe("claude-opus-5-5");
        expect(correlateSubagents([], [file({ firstprompt: "orphan", model: "claude-haiku-4-5" })])[0].model).toBe(
            "claude-haiku-4-5"
        );
        expect(correlateSubagents([spawn({})], [file({})])[0].model).toBeUndefined();
    });
});
