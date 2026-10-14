// what `wsh tokengate` says before an agent starts subagents or a workflow: a costly spawn waits for the
// person's say on arcterm's "Token burn" card, a cheap one runs with a note. kept free of the engine so vitest
// can run it, the gate's gathering and decisions included; register.ts only wires the tool.call hooks to it.

export type SpawnTool = "Agent" | "Task" | "Workflow";
export type SpawnCount = { agents: number; atLeast: boolean; types: string[] };
export type Group = { tool: SpawnTool } & SpawnCount;
export type SpawnVerdict = { run: boolean; scope: "turn" | "session" | null; reason: string | null; note: string | null };
export type Decision = "allow-turn" | "allow-session" | "deny-turn" | null;

// a call's agents and the subagent types known of them: Agent and Task start one, of the input's subagent_type
// (general-purpose, Claude Code's default, when absent). a workflow's agents are its agent( call sites, a floor: a
// loop or parallel() over a list multiplies them, and their types are unknown; one named or read from a file is at
// least one
export function spawnCount(tool: SpawnTool, input: Record<string, unknown>): SpawnCount {
    if (tool !== "Workflow") {
        const type =
            typeof input.subagent_type === "string" && input.subagent_type !== ""
                ? input.subagent_type
                : "general-purpose";
        return { agents: 1, atLeast: false, types: [type] };
    }
    const script = typeof input.script === "string" ? input.script : "";
    const sites = script.match(/\bagent\s*\(/g)?.length ?? 0;
    return { agents: Math.max(1, sites), atLeast: true, types: [] };
}

// parallel spawns in one message ask on one card
export function joinGroup(g: Group | null, tool: SpawnTool, c: SpawnCount): Group {
    if (!g) {
        return { tool, ...c };
    }
    return {
        tool: g.tool === "Workflow" || tool === "Workflow" ? "Workflow" : g.tool,
        agents: g.agents + c.agents,
        atLeast: g.atLeast || c.atLeast,
        types: [...g.types, ...c.types],
    };
}

// the types let wsh price each agent from finished subagents of its type; the transcript lets it read what this
// session, its subagents included, has used of each window
export function tokengateArgs(
    g: Group,
    context: { tokens: number; window: number } | null,
    transcript: string | null = null
): string[] {
    const args = ["tokengate", "--tool", g.tool, "--agents", String(g.agents)];
    if (g.atLeast) {
        args.push("--at-least");
    }
    if (g.types.length > 0) {
        args.push("--types", g.types.join(","));
    }
    if (context) {
        args.push("--context-tokens", String(Math.round(context.tokens)), "--context-max", String(context.window));
    }
    if (transcript) {
        args.push("--transcript", transcript);
    }
    return args;
}

const filled = (v: unknown): v is string => typeof v === "string" && v !== "";

// one stdout line: a hold to show while the card waits, or the verdict, last. anything else, wsh's errors
// included, is no line at all: a broken gate never blocks an agent
export function tokengateLine(line: string): { hold: string } | { verdict: SpawnVerdict } | null {
    let v: unknown;
    try {
        v = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof v !== "object" || v === null) {
        return null;
    }
    const o = v as { hold?: unknown; run?: unknown; scope?: unknown; reason?: unknown; note?: unknown };
    if (filled(o.hold)) {
        return { hold: o.hold };
    }
    if (o.run === true) {
        const scope = o.scope === "turn" || o.scope === "session" ? o.scope : null;
        return { verdict: { run: true, scope, reason: null, note: filled(o.note) ? o.note : null } };
    }
    if (o.run === false && filled(o.reason)) {
        return { verdict: { run: false, scope: null, reason: o.reason, note: null } };
    }
    return null;
}

// what the verdict leaves for later spawns: a plain Allow asks again next time; "this turn" and a deny hold
// until the next prompt, "this session" until the session ends
export function decisionAfter(v: SpawnVerdict): Decision {
    if (!v.run) {
        return "deny-turn";
    }
    if (v.scope === "session") {
        return "allow-session";
    }
    return v.scope === "turn" ? "allow-turn" : null;
}

// parallel Agent calls in one message reach their hooks together; the gate waits this long for the siblings
export const GATHER_MS = 400;

// the verdict that lets a spawn run: off, a cheap spawn, or a broken gate
export const RUN_VERDICT: SpawnVerdict = { run: true, scope: null, reason: null, note: null };

// one group's question to the person; register.ts passes `wsh tokengate`, which never rejects
export type SpawnAsk = (g: Group) => Promise<SpawnVerdict>;

// the gate for one session: the person's say on later spawns, and the open group, whose members share one card.
// sleep is injected so vitest can drive the gathering
export function createSpawnGate(sleep: (ms: number) => Promise<void>) {
    let decision: { kind: Decision; reason: string | null } = { kind: null, reason: null };
    let open: { group: Group; verdict: Promise<SpawnVerdict> } | null = null;
    // claude runs every hook whose tool matches a call, and the Agent tool still answers to Task, its old name: one
    // Agent call reaches check from both hooks. a call's answer is kept by its tool_use_id until the next prompt
    const calls = new Map<string, Promise<string | null>>();

    async function decide(tool: SpawnTool, input: Record<string, unknown>, ask: SpawnAsk): Promise<string | null> {
        if (decision.kind === "allow-turn" || decision.kind === "allow-session") {
            return null;
        }
        if (decision.kind === "deny-turn") {
            return decision.reason;
        }
        const count = spawnCount(tool, input);
        let mine = open;
        if (mine) {
            // gathering, or the card is already up: this spawn shares the group's verdict
            mine.group = joinGroup(mine.group, tool, count);
        } else {
            const opened: { group: Group; verdict: Promise<SpawnVerdict> } = {
                group: joinGroup(null, tool, count),
                verdict: Promise.resolve(RUN_VERDICT),
            };
            opened.verdict = (async () => {
                try {
                    await sleep(GATHER_MS);
                    const v = await ask(opened.group);
                    const kind = decisionAfter(v);
                    if (kind) {
                        decision = { kind, reason: v.reason };
                    }
                    return v;
                } finally {
                    open = null;
                }
            })();
            mine = opened;
            open = opened;
        }
        const v = await mine.verdict;
        return v.run ? null : v.reason;
    }

    return {
        // why the spawn may not run; null lets it. a call already asked about gets the same answer, kept before any
        // await so a hook that arrives while the gate gathers finds it too
        check(tool: SpawnTool, input: Record<string, unknown>, ask: SpawnAsk): Promise<string | null> {
            const id = filled(input.tool_use_id) ? input.tool_use_id : null;
            const seen = id ? calls.get(id) : undefined;
            if (seen) {
                return seen;
            }
            const answer = decide(tool, input, ask);
            if (id) {
                calls.set(id, answer);
            }
            return answer;
        },
        // the person's next prompt ends a turn's say, a deny included; a session's stays
        promptSubmitted() {
            calls.clear();
            if (decision.kind !== "allow-session") {
                decision = { kind: null, reason: null };
            }
        },
        // a new or cleared session forgets every say
        sessionStarted() {
            calls.clear();
            decision = { kind: null, reason: null };
        },
    };
}

export type SpawnGate = ReturnType<typeof createSpawnGate>;
