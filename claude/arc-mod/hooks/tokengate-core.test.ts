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
        const ask = (g: Group) => {
            asked.push(g);
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
