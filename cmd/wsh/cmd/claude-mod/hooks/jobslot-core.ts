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

// `wsh jobslot --heavy` exits 0 when the command takes a slot at all, from wsh's own table, with no connection
export function heavyArgs(command: string): string[] {
    return ["jobslot", "--heavy", "--", command];
}

// the exit of `wsh jobslot --hold-parent` when the person skipped the command
export const JOBSLOT_REFUSED_EXIT = 75;

const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

const HELD_TAIL = `; [ $? -ne ${JOBSLOT_REFUSED_EXIT} ] || exit ${JOBSLOT_REFUSED_EXIT}\n`;

// a heavy background command outlives its tool call, so a slot the hook held around the call would free as soon
// as the command started. Instead it runs behind `wsh jobslot --hold-parent` in its own shell: wsh waits there
// for its turn, then hands the slot to that shell, which wavesrv holds it for until the shell exits. A skip from
// the job queue exits the shell before the command; any other end of wsh's, a crash included, runs it
export function heldInBackground(wsh: string, command: string): string {
    return `${shellQuote(wsh)} jobslot --hold-parent -- ${shellQuote(command)}${HELD_TAIL}${command}`;
}

// the command heldInBackground wrapped, or null for any other: the permission check reads the command as the
// model wrote it. The quoted copy may hold the tail's text too, so each place it occurs is tried
export function heldOriginal(wsh: string, command: string): string | null {
    if (!command.startsWith(`${shellQuote(wsh)} jobslot --hold-parent -- `)) {
        return null;
    }
    for (let at = command.indexOf(HELD_TAIL); at !== -1; at = command.indexOf(HELD_TAIL, at + 1)) {
        const original = command.slice(at + HELD_TAIL.length);
        if (heldInBackground(wsh, original) === command) {
            return original;
        }
    }
    return null;
}
