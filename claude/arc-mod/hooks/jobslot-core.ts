// what `wsh jobslot` says about a shell command: a heavy one (a build, the typecheck, a whole test suite)
// waits its turn in arcterm's job queue, and holds the slot while it runs. kept free of the engine so vitest
// can run it; register.ts holds the tool.call hooks.

// the command rides as one argument after --, so one starting with a dash is never read as a flag
export function jobslotArgs(command: string): string[] {
    return ["jobslot", "--", command];
}

// one stdout line: a place in the queue to show the person while the command waits, or the verdict. refusal
// null lets the command run. anything else, wsh's errors included, is no line at all: a broken queue never
// blocks an agent
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
