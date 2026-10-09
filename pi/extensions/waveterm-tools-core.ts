// Pure helpers for the waveterm tools extension. No external imports so the repo's vitest can cover
// it. The default export is a no-op: pi auto-loads every file in the extensions directory, and this
// module is a dependency, not an extension.

export function runCommandArgs(command: string, cwd?: string): string[] {
    const args = ["run"];
    if (cwd) {
        args.push("--cwd", cwd);
    }
    return [...args, "-c", command];
}

export function captureTailArgs(blockId: string): string[] {
    return ["termscrollback", "-b", blockId, "--lastcommand"];
}

export function openFileArgs(absPath: string): string[] {
    return ["view", absPath];
}

export function querySessionsArgs(): string[] {
    return ["blocks", "list", "--json"];
}

export function notifyArgs(title: string, opts: { message?: string; level?: string } = {}): string[] {
    const args = ["notify", title];
    if (opts.message) {
        args.push("--message", opts.message);
    }
    if (opts.level && opts.level !== "info") {
        args.push("--level", opts.level);
    }
    return args;
}

// dagRulesArgs asks wsh for the orchestration rules of the lead this session is; wsh prints nothing for
// any other session.
export function dagRulesArgs(): string[] {
    return ["jarvis", "dag", "rules"];
}

// jobslotArgs asks wsh for a slot in arcterm's job queue for a bash command: a heavy one (a build, the
// typecheck, a whole test suite) waits its turn, and wsh holds the slot until it is killed. The command rides
// as one argument after --, so one starting with a dash is never read as a flag.
export function jobslotArgs(command: string): string[] {
    return ["jobslot", "--", command];
}

// jobslotLine reads one stdout line of wsh jobslot: a place in the queue to show the person while the command
// waits, or the verdict. refusal null lets the command run. Anything else, wsh's errors included, is no line
// at all: a broken queue never blocks pi. (The same code as the Claude mod's jobslot-core.ts: the two ship
// as separate installs and cannot share a file.)
export type JobslotLine = { hold: string } | { refusal: string | null };

const filled = (v: unknown): v is string => typeof v === "string" && v !== "";

export function jobslotLine(line: string): JobslotLine | null {
    let v: unknown;
    try {
        v = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof v !== "object" || v === null) {
        return null;
    }
    const o = v as { queued?: unknown; behind?: unknown; for?: unknown; run?: unknown; reason?: unknown };
    if (typeof o.queued === "number" && o.queued >= 1) {
        const ahead = filled(o.behind) ? ` — waiting behind ${o.behind}${filled(o.for) ? ` (${o.for})` : ""}` : "";
        return { hold: `Queued #${o.queued}${ahead}` };
    }
    if (o.run === true) {
        return { refusal: null };
    }
    if (o.run === false && filled(o.reason)) {
        return { refusal: o.reason };
    }
    return null;
}

// withOrchestrationRules appends a lead's rules to a provider request as its last message (orchestrator
// redesign §7). No rules leaves the request untouched, which is every session that is not a lead holding
// a dag.
export function withOrchestrationRules(messages: unknown[], rules: string, now: number): unknown[] | undefined {
    const text = rules.trim();
    if (!text) {
        return undefined;
    }
    return [...messages, { role: "user", content: text, timestamp: now }];
}

export default function noop(): void {}
