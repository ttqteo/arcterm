// what `wsh memgate` says about a shell command: a heavy one (a build, the typecheck, a whole test suite)
// waits for the person's say on arcterm's card while RAM is short. kept free of the engine so vitest can
// run it; register.ts holds the tool.call hooks.

// the command rides as one argument after --, so one starting with a dash is never read as a flag
export function memgateArgs(command: string): string[] {
    return ["memgate", "--", command];
}

// one stdout line: a hold to show the person while the command waits, or the verdict, last. refusal null
// lets the command run. anything else, wsh's errors included, is no line at all: a broken gate never
// blocks an agent
export type MemgateLine = { hold: string } | { refusal: string | null };

const filled = (v: unknown): v is string => typeof v === "string" && v !== "";

export function memgateLine(line: string): MemgateLine | null {
    let v: unknown;
    try {
        v = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof v !== "object" || v === null) {
        return null;
    }
    const o = v as { hold?: unknown; run?: unknown; reason?: unknown };
    if (filled(o.hold)) {
        return { hold: o.hold };
    }
    if (o.run === true) {
        return { refusal: null };
    }
    if (o.run === false && filled(o.reason)) {
        return { refusal: o.reason };
    }
    return null;
}
