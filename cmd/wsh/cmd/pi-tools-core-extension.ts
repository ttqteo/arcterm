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

// memgateArgs asks wsh whether a bash command may run now: a heavy one (a build, the typecheck, a whole
// test suite) waits for the person's say on arcterm's card while RAM is short. The command rides as one
// argument after --, so one starting with a dash is never read as a flag.
export function memgateArgs(command: string): string[] {
    return ["memgate", "--", command];
}

// memgateRefusal reads wsh memgate's stdout (hold lines, then the verdict) as the reason the command does
// not run, or null to run it. Anything but a well-formed refusal runs it: a broken gate never blocks pi.
export function memgateRefusal(stdout: string): string | null {
    let refusal: string | null = null;
    for (const line of stdout.split("\n")) {
        try {
            const v = JSON.parse(line);
            if (v?.run === true) {
                refusal = null;
            } else if (v?.run === false && typeof v.reason === "string" && v.reason !== "") {
                refusal = v.reason;
            }
        } catch {
            // not a json line: wsh's own error output
        }
    }
    return refusal;
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
