// what `wsh tokengate` says before an agent starts subagents or a workflow: a costly spawn waits for the
// person's say on arcterm's "Token burn" card, a cheap one runs with a note. kept free of the engine so vitest
// can run it, the gate's gathering and decisions included; register.ts only wires the tool.call hooks to it.

export type SpawnTool = "Agent" | "Task" | "Workflow";
const filled = (v: unknown): v is string => typeof v === "string" && v !== "";

// one Agent or Task call as the card names it: wsh's tokengate.Call
export type SpawnCall = { type: string; model?: string; description?: string; background?: boolean };
export type SpawnCount = { agents: number; atLeast: boolean; types: string[]; calls: SpawnCall[] };
export type Group = { tool: SpawnTool } & SpawnCount;
export type SpawnVerdict = { run: boolean; scope: "turn" | "session" | null; reason: string | null; note: string | null };
export type Decision = "allow-turn" | "allow-session" | "deny-turn" | null;

// a call's agents and the subagent types known of them: Agent and Task start one, of the input's subagent_type
// (general-purpose, Claude Code's default, when absent), and the card names its model and task. a workflow's agents
// are its agent( call sites, a floor: a loop or parallel() over a list multiplies them, and their types are unknown;
// one named or read from a file is at least one
export function spawnCount(tool: SpawnTool, input: Record<string, unknown>): SpawnCount {
    if (tool !== "Workflow") {
        const type = filled(input.subagent_type) ? input.subagent_type : "general-purpose";
        const call: SpawnCall = { type };
        if (filled(input.model)) {
            call.model = input.model;
        }
        if (filled(input.description)) {
            call.description = input.description;
        }
        if (input.run_in_background === true) {
            call.background = true;
        }
        return { agents: 1, atLeast: false, types: [type], calls: [call] };
    }
    const script = typeof input.script === "string" ? input.script : "";
    const sites = script.match(/\bagent\s*\(/g)?.length ?? 0;
    return { agents: Math.max(1, sites), atLeast: true, types: [], calls: [] };
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
        calls: [...g.calls, ...c.calls],
    };
}

// the types let wsh price each agent from finished subagents of its type; the transcript lets it read what this
// session, its subagents included, has used of each window; earlier is the agents started just before, which count
// toward the agents rule
export function tokengateArgs(
    g: Group,
    context: { tokens: number; window: number } | null,
    transcript: string | null = null,
    earlier = 0
): string[] {
    const args = ["tokengate", "--tool", g.tool, "--agents", String(g.agents)];
    if (g.atLeast) {
        args.push("--at-least");
    }
    if (g.types.length > 0) {
        args.push("--types", g.types.join(","));
    }
    if (g.calls.length > 0) {
        args.push("--calls", JSON.stringify(g.calls));
    }
    if (context) {
        args.push("--context-tokens", String(Math.round(context.tokens)), "--context-max", String(context.window));
    }
    if (transcript) {
        args.push("--transcript", transcript);
    }
    if (earlier > 0) {
        args.push("--earlier", String(earlier));
    }
    return args;
}

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

// prompts that are not the person's next one: a background task's report, a subagent's hand-back or another
// session's message, an observer, a continuation claude starts by itself. "Allow this turn" and "Don't spawn" last
// through them (seen 2026-10-15: three subagents' hand-backs ended an Allow this turn before the agent's next spawn)
const AGENT_SIDE_ORIGINS = new Set([
    "task-notification",
    "peer",
    "peer-send-message",
    "observer",
    "observer-activity",
    "auto-continuation",
]);

// whether a prompt of this origin (prompt.submit's e.origin.kind) ends the turn's say on spawns
export function endsTurnSay(originKind: string): boolean {
    return !AGENT_SIDE_ORIGINS.has(originKind);
}

// parallel Agent calls in one message reach their hooks together; the gate waits this long for the siblings
export const GATHER_MS = 400;

// they do not all come together: claude starts each call as it writes the call's block, 0.3 s and then 0.8 s apart
// for three short ones (2026-10-15), longer for long prompts. so a spawn within this long of the one before
// continues a chain, and the agents the chain already started count toward the agents rule
export const BURST_MS = 10_000;

// why a spawn after the turn's Don't spawn may not run. the card's own reason names the spawn it asked about (seen
// 2026-10-15: an Agent call refused as "run a workflow with at least 1 agent"), so a later one gets this
export const LATER_DENY_REASON =
    'Not run: the person chose "Don\'t spawn" earlier this turn, which refuses every spawn until their next prompt. ' +
    "Do not retry a spawn this turn; do the work in this session or ask the person, " +
    "and say in your report that the spawn was refused.";

// the verdict that lets a spawn run: off, a cheap spawn, or a broken gate
export const RUN_VERDICT: SpawnVerdict = { run: true, scope: null, reason: null, note: null };

// one group's question to the person, with the agents its chain already started; held is called when the card goes
// up (wsh's hold line). register.ts passes `wsh tokengate`, which never rejects
export type SpawnAsk = (g: Group, earlier: number, held: () => void) => Promise<SpawnVerdict>;

// an open group: gathering its siblings, then wsh deciding, then (when a rule fires) its card up
type OpenGroup = { group: Group; phase: "gathering" | "deciding" | "card"; verdict: Promise<SpawnVerdict> };

// the gate for one session: the person's say on later spawns, the open group, whose members share one card, and
// the chain of spawns that came within BURST_MS of each other. sleep and clock are injected so vitest can drive them
export function createSpawnGate(sleep: (ms: number) => Promise<void>, clock: () => number = Date.now) {
    let decision: Decision = null;
    let open: OpenGroup | null = null;
    // the agents the chain started (refused ones left out), and when its last spawn came
    const chain = { started: 0, last: -Infinity };
    // claude runs every hook whose tool matches a call, and the Agent tool still answers to Task, its old name: one
    // Agent call reaches check from both hooks. a call's answer is kept by its tool_use_id until the next prompt
    const calls = new Map<string, Promise<string | null>>();

    async function decide(tool: SpawnTool, input: Record<string, unknown>, ask: SpawnAsk): Promise<string | null> {
        if (decision === "allow-turn" || decision === "allow-session") {
            return null;
        }
        if (decision === "deny-turn") {
            return LATER_DENY_REASON;
        }
        const at = clock();
        if (at - chain.last > BURST_MS) {
            chain.started = 0;
        }
        chain.last = at;
        const count = spawnCount(tool, input);
        if (open?.phase === "deciding") {
            // wsh is weighing a group it was asked about without this spawn: wait for that, then decide this one on
            // its own, its chain counting the group if it ran
            const busy = open;
            await busy.verdict;
            return decide(tool, input, ask);
        }
        let mine = open;
        if (mine) {
            // gathering, or the card is already up: this spawn shares the group's verdict
            mine.group = joinGroup(mine.group, tool, count);
        } else {
            const opened: OpenGroup = {
                group: joinGroup(null, tool, count),
                phase: "gathering",
                verdict: Promise.resolve(RUN_VERDICT),
            };
            opened.verdict = (async () => {
                try {
                    await sleep(GATHER_MS);
                    opened.phase = "deciding";
                    const v = await ask(opened.group, chain.started, () => (opened.phase = "card"));
                    if (v.run) {
                        chain.started += opened.group.agents;
                    }
                    const kind = decisionAfter(v);
                    if (kind) {
                        decision = kind;
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
            if (decision !== "allow-session") {
                decision = null;
            }
        },
        // a new or cleared session forgets every say
        sessionStarted() {
            calls.clear();
            decision = null;
        },
    };
}

export type SpawnGate = ReturnType<typeof createSpawnGate>;
