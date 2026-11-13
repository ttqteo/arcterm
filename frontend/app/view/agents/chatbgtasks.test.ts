import { describe, expect, it } from "vitest";
import { chatBgHeader, chatBgItems, chatBgLine, chatBgMore, subagentSubline } from "./chatbgtasks";
import type { SubagentVM } from "./session-models/sessionviewmodel";
import type { BackgroundTask } from "./transcriptprojection";

const NOW = 10 * 60_000;
const task = (over: Partial<BackgroundTask>): BackgroundTask => ({
    toolUseId: "t1",
    taskId: "b1",
    label: "task tauri:build",
    status: "running",
    startMs: NOW - 2 * 60_000,
    ...over,
});
const sub = (over: Partial<SubagentVM>): SubagentVM => ({
    id: "a1",
    type: "Explore",
    state: "working",
    async: true,
    model: "claude-haiku-5-5",
    startedAtMs: NOW - 60_000,
    ...over,
});
const items = (tasks: BackgroundTask[], subagents: SubagentVM[], asleep = false) =>
    chatBgItems({ asleep, tasks, subagents, now: NOW });

describe("chatBgItems", () => {
    it("shows running shells, Monitors and background subagents, newest first", () => {
        const out = items(
            [
                task({ toolUseId: "s", label: "npm test", startMs: NOW - 5 * 60_000 }),
                task({ toolUseId: "m", label: "Wait for CI", monitor: true, startMs: NOW - 30_000 }),
            ],
            [sub({ startedAtMs: NOW - 2 * 60_000 })]
        );
        expect(out.map((i) => [i.kind, i.name])).toEqual([
            ["monitor", "Wait for CI"],
            ["subagent", "Explore"],
            ["shell", "npm test"],
        ]);
    });

    it("words a shell by how long it has run and a subagent by its kind and model family", () => {
        const [shell, agent] = items([task({ startMs: NOW - 3 * 60_000 })], [sub({ startedAtMs: 0 })]);
        expect(shell.sub).toBe("running · 3m");
        expect(agent.sub).toBe("subagent · haiku");
    });

    it("leaves out what has ended", () => {
        const out = items(
            [
                task({ status: "completed" }),
                task({ toolUseId: "x", status: "stopped" }),
                task({ toolUseId: "f", status: "failed" }),
            ],
            [sub({ state: "success" }), sub({ id: "a2", state: "done" }), sub({ id: "a3", state: "failure" })]
        );
        expect(out).toEqual([]);
    });

    it("leaves out a foreground subagent the turn waits on", () => {
        expect(items([], [sub({ async: undefined })])).toEqual([]);
    });

    it("shows nothing while the agent sleeps", () => {
        expect(items([task({})], [sub({})], true)).toEqual([]);
    });

    it("puts work whose start is unknown last, in its order", () => {
        const out = items(
            [task({ toolUseId: "u1", label: "u1", startMs: undefined }), task({ toolUseId: "k" })],
            [sub({ id: "u2", type: "u2", startedAtMs: undefined })]
        );
        expect(out.map((i) => i.name)).toEqual(["task tauri:build", "u1", "u2"]);
    });

    it("keys each item by its kind and id", () => {
        expect(items([task({})], [sub({})]).map((i) => i.key)).toEqual(["sub:a1", "task:t1"]);
    });
});

describe("chatBgLine", () => {
    it("names the newest and counts the rest", () => {
        const line = chatBgLine(items([task({})], [sub({ startedAtMs: NOW })]));
        expect(line?.lead.name).toBe("Explore");
        expect(line?.more).toBe(1);
        expect(chatBgMore(line!.more)).toBe("and 1 more");
    });

    it("is null with nothing running", () => {
        expect(chatBgLine([])).toBeNull();
    });

    it("says no more when the lead is alone", () => {
        expect(chatBgMore(0)).toBeNull();
    });
});

describe("words", () => {
    it("heads the open list with the count", () => {
        expect(chatBgHeader(3)).toBe("3 running in the background");
    });

    it("names a subagent with no model by its kind alone, and an unknown model by its id", () => {
        expect(subagentSubline({})).toBe("subagent");
        expect(subagentSubline({ model: "openai/gpt-x" })).toBe("subagent · openai/gpt-x");
    });
});
