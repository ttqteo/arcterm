import { describe, expect, it } from "vitest";
import { createSpawnGate, decisionAfter, joinGroup, spawnCount, tokengateArgs, tokengateLine } from "./tokengate-core";
import type { Group, SpawnVerdict } from "./tokengate-core";

describe("spawnCount", () => {
    it("counts one agent per Agent or Task call, of its subagent type", () => {
        expect(spawnCount("Agent", { prompt: "x", subagent_type: "Explore" })).toEqual({ agents: 1, atLeast: false, types: ["Explore"] });
        expect(spawnCount("Agent", { prompt: "x" })).toEqual({ agents: 1, atLeast: false, types: ["general-purpose"] });
        expect(spawnCount("Task", {})).toEqual({ agents: 1, atLeast: false, types: ["general-purpose"] });
    });
    it("counts a workflow's agent( call sites, at least one, with no types", () => {
        expect(spawnCount("Workflow", { script: "agent('a'); agent ('b'); subagent('c')" })).toEqual({ agents: 2, atLeast: true, types: [] });
        expect(spawnCount("Workflow", { script: "phase('x')" })).toEqual({ agents: 1, atLeast: true, types: [] });
        expect(spawnCount("Workflow", { name: "review" })).toEqual({ agents: 1, atLeast: true, types: [] });
    });
});

describe("joinGroup", () => {
    it("sums parallel spawns and their types, and any workflow makes the group a workflow", () => {
        const gp = { agents: 1, atLeast: false, types: ["general-purpose"] };
        const g = joinGroup(joinGroup(null, "Agent", gp), "Agent", { agents: 1, atLeast: false, types: ["Explore"] });
        expect(g).toEqual({ tool: "Agent", agents: 2, atLeast: false, types: ["general-purpose", "Explore"] });
        expect(joinGroup(g, "Workflow", { agents: 3, atLeast: true, types: [] })).toEqual({
            tool: "Workflow",
            agents: 5,
            atLeast: true,
            types: ["general-purpose", "Explore"],
        });
    });
});

describe("tokengateArgs", () => {
    it("passes the group, its types, and the context when known", () => {
        expect(
            tokengateArgs({ tool: "Agent", agents: 2, atLeast: false, types: ["general-purpose", "Explore"] }, { tokens: 142000.4, window: 200000 })
        ).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "2", "--types", "general-purpose,Explore",
            "--context-tokens", "142000", "--context-max", "200000",
        ]);
        expect(tokengateArgs({ tool: "Workflow", agents: 1, atLeast: true, types: [] }, null)).toEqual([
            "tokengate", "--tool", "Workflow", "--agents", "1", "--at-least",
        ]);
    });
    it("passes the session's transcript when known", () => {
        expect(tokengateArgs({ tool: "Agent", agents: 1, atLeast: false, types: [] }, null, "/h/.claude/projects/p/s1.jsonl")).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "1", "--transcript", "/h/.claude/projects/p/s1.jsonl",
        ]);
    });
    it("passes the agents started just before, when there were some", () => {
        const g: Group = { tool: "Agent", agents: 1, atLeast: false, types: [] };
        expect(tokengateArgs(g, null, null, 2)).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "1", "--earlier", "2",
        ]);
        expect(tokengateArgs(g, null, null, 0)).toEqual(["tokengate", "--tool", "Agent", "--agents", "1"]);
    });
});

describe("tokengateLine", () => {
    it("reads holds and verdicts, and nothing else", () => {
        expect(tokengateLine('{"hold":"waiting"}')).toEqual({ hold: "waiting" });
        expect(tokengateLine('{"run":true}')).toEqual({ verdict: { run: true, scope: null, reason: null, note: null } });
        expect(tokengateLine('{"run":true,"note":"Token burn: x"}')).toEqual({ verdict: { run: true, scope: null, reason: null, note: "Token burn: x" } });
        expect(tokengateLine('{"run":true,"scope":"session"}')).toEqual({ verdict: { run: true, scope: "session", reason: null, note: null } });
        expect(tokengateLine('{"run":false,"reason":"Not run: x"}')).toEqual({ verdict: { run: false, scope: null, reason: "Not run: x", note: null } });
        expect(tokengateLine('{"run":true,"scope":"forever"}')).toEqual({ verdict: { run: true, scope: null, reason: null, note: null } });
        expect(tokengateLine('{"run":false}')).toBeNull();
        expect(tokengateLine("garbage")).toBeNull();
    });
});

describe("decisionAfter", () => {
    const v = (run: boolean, scope: "turn" | "session" | null) => ({ run, scope, reason: run ? null : "r", note: null });
    it("keeps a scoped allow and every deny", () => {
        expect(decisionAfter(v(true, null))).toBeNull();
        expect(decisionAfter(v(true, "turn"))).toBe("allow-turn");
        expect(decisionAfter(v(true, "session"))).toBe("allow-session");
        expect(decisionAfter(v(false, null))).toBe("deny-turn");
    });
});

describe("createSpawnGate", () => {
    const allow = (scope: "turn" | "session" | null): SpawnVerdict => ({ run: true, scope, reason: null, note: null });
    const DENY: SpawnVerdict = { run: false, scope: null, reason: "Not run: no", note: null };
    const now = () => Promise.resolve();
    // an ask that answers v and records each group it was asked about
    const asker = (v: SpawnVerdict) => {
        const asked: Group[] = [];
        const ask = async (g: Group) => {
            asked.push(g);
            return v;
        };
        return { asked, ask };
    };

    it("asks once for spawns that arrive while it gathers, as one group", async () => {
        let wake = () => {};
        const gate = createSpawnGate(() => new Promise<void>((resolve) => (wake = resolve)));
        const { asked, ask } = asker(allow(null));
        const a = gate.check("Agent", {}, ask);
        const b = gate.check("Agent", {}, ask);
        wake();
        expect(await Promise.all([a, b])).toEqual([null, null]);
        expect(asked).toEqual([{ tool: "Agent", agents: 2, atLeast: false, types: ["general-purpose", "general-purpose"] }]);
    });

    it("gives a spawn that arrives while the card waits the same verdict", async () => {
        let answer: (v: SpawnVerdict) => void = () => {};
        const asked: Group[] = [];
        const ask = (g: Group, _earlier: number, held: () => void) => {
            asked.push(g);
            held(); // wsh's hold line: the card is up
            return new Promise<SpawnVerdict>((resolve) => (answer = resolve));
        };
        const gate = createSpawnGate(now);
        const a = gate.check("Agent", {}, ask);
        await new Promise((resolve) => setTimeout(resolve, 0)); // the card is up
        const b = gate.check("Task", {}, ask);
        answer(DENY);
        expect(await Promise.all([a, b])).toEqual(["Not run: no", "Not run: no"]);
        expect(asked).toHaveLength(1);
    });

    // claude runs both the Agent and the Task hook for one Agent call (Task is the tool's old name), one inside the other
    it("asks once for a call that reaches the gate from two hooks, and gives both its verdict", async () => {
        const gate = createSpawnGate(now);
        const { asked, ask } = asker(allow(null));
        const call = { tool_use_id: "toolu_1", subagent_type: "Explore" };
        expect(await gate.check("Agent", call, ask)).toBeNull();
        expect(await gate.check("Task", call, ask)).toBeNull();
        expect(asked).toEqual([{ tool: "Agent", agents: 1, atLeast: false, types: ["Explore"] }]);
    });

    it("counts a call once when its two hooks arrive while the gate gathers", async () => {
        let wake = () => {};
        const gate = createSpawnGate(() => new Promise<void>((resolve) => (wake = resolve)));
        const { asked, ask } = asker(allow(null));
        const call = { tool_use_id: "toolu_1" };
        const a = gate.check("Agent", call, ask);
        const b = gate.check("Task", call, ask);
        wake();
        expect(await Promise.all([a, b])).toEqual([null, null]);
        expect(asked).toEqual([{ tool: "Agent", agents: 1, atLeast: false, types: ["general-purpose"] }]);
    });

    // one message's Agent calls reach the gate spread out as claude writes them (0.3 s and 0.8 s apart, seen live)
    it("counts the agents that ran within 10 s of the last spawn as earlier, and starts over after a pause", async () => {
        let t = 0;
        const gate = createSpawnGate(now, () => t);
        const earlier: number[] = [];
        const ask = async (_g: Group, e: number) => {
            earlier.push(e);
            return allow(null);
        };
        await gate.check("Agent", {}, ask);
        t = 300;
        await gate.check("Agent", {}, ask);
        t = 1_100;
        await gate.check("Agent", {}, ask);
        t = 12_000;
        await gate.check("Agent", {}, ask);
        expect(earlier).toEqual([0, 1, 2, 0]);
    });

    it("leaves a refused group out of the agents started", async () => {
        let t = 0;
        const gate = createSpawnGate(now, () => t);
        const earlier: number[] = [];
        let answer = DENY;
        const ask = async (_g: Group, e: number) => {
            earlier.push(e);
            return answer;
        };
        await gate.check("Agent", {}, ask);
        gate.promptSubmitted();
        answer = allow(null);
        t = 1_000;
        await gate.check("Agent", {}, ask);
        expect(earlier).toEqual([0, 0]);
    });

    // seen live 2026-10-15: a third call that came while wsh decided on the first two rode their "run" uncounted
    it("decides a spawn that arrives while wsh is still deciding on its own, once that group is decided", async () => {
        let answer: (v: SpawnVerdict) => void = () => {};
        const asked: { agents: number; earlier: number }[] = [];
        const ask = (g: Group, earlier: number) => {
            asked.push({ agents: g.agents, earlier });
            return asked.length === 1
                ? new Promise<SpawnVerdict>((resolve) => (answer = resolve))
                : Promise.resolve(allow(null));
        };
        const gate = createSpawnGate(now);
        const a = gate.check("Agent", {}, ask);
        await new Promise((resolve) => setTimeout(resolve, 0)); // wsh is deciding, no card
        const b = gate.check("Agent", {}, ask);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(asked).toEqual([{ agents: 1, earlier: 0 }]);
        answer(allow(null));
        expect(await Promise.all([a, b])).toEqual([null, null]);
        expect(asked).toEqual([
            { agents: 1, earlier: 0 },
            { agents: 1, earlier: 1 },
        ]);
    });

    it("asks again after a plain Allow", async () => {
        const gate = createSpawnGate(now);
        const { asked, ask } = asker(allow(null));
        await gate.check("Agent", {}, ask);
        expect(await gate.check("Agent", {}, ask)).toBeNull();
        expect(asked).toHaveLength(2);
    });

    it("lets every spawn through after Allow this turn, until the next prompt or a new session", async () => {
        const gate = createSpawnGate(now);
        const { asked, ask } = asker(allow("turn"));
        await gate.check("Agent", {}, ask);
        expect(await gate.check("Workflow", { name: "review" }, ask)).toBeNull();
        expect(asked).toHaveLength(1);
        gate.promptSubmitted();
        await gate.check("Agent", {}, ask);
        expect(asked).toHaveLength(2);
        gate.sessionStarted();
        await gate.check("Agent", {}, ask);
        expect(asked).toHaveLength(3);
    });

    it("keeps Allow this session past a prompt, not past a new session", async () => {
        const gate = createSpawnGate(now);
        const { asked, ask } = asker(allow("session"));
        await gate.check("Agent", {}, ask);
        gate.promptSubmitted();
        expect(await gate.check("Agent", {}, ask)).toBeNull();
        expect(asked).toHaveLength(1);
        gate.sessionStarted();
        await gate.check("Agent", {}, ask);
        expect(asked).toHaveLength(2);
    });

    it("refuses the rest of the turn after Don't spawn, with its reason, until the next prompt", async () => {
        const gate = createSpawnGate(now);
        const { asked, ask } = asker(DENY);
        expect(await gate.check("Agent", {}, ask)).toBe("Not run: no");
        expect(await gate.check("Agent", {}, ask)).toBe("Not run: no");
        expect(asked).toHaveLength(1);
        gate.promptSubmitted();
        await gate.check("Agent", {}, ask);
        expect(asked).toHaveLength(2);
    });
});
