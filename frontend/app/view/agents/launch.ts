// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type Runtime = "claude" | "codex" | "opencode" | "pi" | "agy" | "terminal";

const RUNTIME_CMD: Record<Runtime, string> = {
    claude: "claude",
    codex: "codex",
    opencode: "opencode",
    pi: "pi",
    agy: "agy",
    terminal: "",
};

export function runtimeStartupCommand(runtime: Runtime): string {
    return RUNTIME_CMD[runtime] ?? "";
}

export interface FlagDef {
    id: string; // stable key (shared across runtimes, e.g. "skip-permissions")
    flag: string; // the CLI token appended to the startup command
    desc: string; // one-line explanation shown in the flag menu
}

// Per-runtime launch-flag catalog (ports flagDefs from Wave-cockpit-live.dc.html). Terminal takes
// no flags. Ids are intentionally shared where the concept matches (e.g. "skip-permissions" maps to
// --dangerously-skip-permissions on claude and --dangerously-bypass-approvals on codex).
export const RUNTIME_FLAGS: Record<Runtime, FlagDef[]> = {
    claude: [
        { id: "skip-permissions", flag: "--dangerously-skip-permissions", desc: "Bypass all permission prompts" },
        { id: "verbose", flag: "--verbose", desc: "Stream every tool call" },
        { id: "continue", flag: "--continue", desc: "Resume the last session" },
        { id: "print", flag: "--print", desc: "Non-interactive: print and exit" },
        { id: "ide", flag: "--ide", desc: "Auto-connect to the IDE extension" },
        { id: "debug", flag: "--debug", desc: "Emit debug diagnostics" },
        { id: "no-color", flag: "--no-color", desc: "Disable ANSI colors" },
    ],
    codex: [
        { id: "full-auto", flag: "--full-auto", desc: "Run without approval gates" },
        { id: "skip-permissions", flag: "--dangerously-bypass-approvals", desc: "Skip approval prompts" },
        { id: "quiet", flag: "--quiet", desc: "Hide reasoning logs" },
        { id: "search", flag: "--search", desc: "Enable web search" },
        { id: "json", flag: "--json", desc: "Machine-readable output" },
    ],
    opencode: [
        { id: "auto", flag: "--auto", desc: "Auto-approve non-denied permissions (dangerous)" },
        { id: "pure", flag: "--pure", desc: "Run without external plugins" },
        { id: "continue", flag: "-c", desc: "Resume the last session" },
    ],
    pi: [],
    agy: [
        { id: "skip-permissions", flag: "--dangerously-skip-permissions", desc: "Bypass all permission prompts" },
        { id: "continue", flag: "--continue", desc: "Resume the last conversation" },
        { id: "sandbox", flag: "--sandbox", desc: "Run tools in a sandbox" },
    ],
    terminal: [],
};

// Append the runtime's enabled flags to the base startup command, skipping any flag the user already
// typed into the base (so toggling a flag that's also hand-written doesn't duplicate it). Preserves
// catalog order. buildLaunchMeta then tokenizes the result into cmd + args.
export function composeStartupCommand(base: string, runtime: Runtime, enabled: Record<string, boolean>): string {
    const trimmed = base.trim();
    const present = new Set(trimmed.split(/\s+/).filter(Boolean));
    const flags = RUNTIME_FLAGS[runtime].filter((f) => enabled[f.id] && !present.has(f.flag)).map((f) => f.flag);
    return [trimmed, ...flags].join(" ").trim();
}

export function runtimeLaunchLabel(runtime: Runtime): string {
    return runtime === "terminal" ? "Open terminal" : "Launch agent";
}

export function runtimeShowsTask(runtime: Runtime): boolean {
    return runtime !== "terminal";
}

export function runtimeCreatesAgentPanel(runtime: Runtime): boolean {
    return runtime !== "terminal";
}

// The launcher hides runtimes whose CLI isn't installed. Terminal needs no CLI, and an empty catalog
// (not loaded yet, or the listing failed) offers everything rather than an empty picker.
export function isRuntimeOffered(runtime: Runtime, harnesses: { runtime: string; installed?: boolean }[]): boolean {
    if (runtime === "terminal" || harnesses.length === 0) {
        return true;
    }
    return harnesses.some((h) => h.runtime === runtime && h.installed);
}

// Worktrees only make sense for the agent runtimes; a terminal launches in the project dir.
export function runtimeSupportsWorktree(runtime: Runtime): boolean {
    return runtime !== "terminal";
}

// A fresh, non-colliding branch name off base (git refuses a worktree on an already-checked-out
// branch). "<base>-agent", bumping "-agent-2", "-3"… past names already in the repo.
export function deriveBranch(base: string, existing: string[]): string {
    const candidate = `${base}-agent`;
    if (!existing.includes(candidate)) {
        return candidate;
    }
    let n = 2;
    while (existing.includes(`${candidate}-${n}`)) {
        n++;
    }
    return `${candidate}-${n}`;
}

// One-line preview of what launching a worktree on `branch` will do, so the choice is never silent.
export function worktreeOutcome(args: { branch: string; currentBranch: string; branchNames: string[] }): string {
    const branch = args.branch.trim();
    if (!branch) {
        return "Enter a branch name";
    }
    if (branch === args.currentBranch) {
        return `Creates new branch ${deriveBranch(branch, args.branchNames)} off ${args.currentBranch}`;
    }
    if (args.branchNames.includes(branch)) {
        return `Checks out existing branch ${branch} in a worktree`;
    }
    return `Creates new branch ${branch} off current HEAD`;
}

export interface LaunchMetaSpec {
    runtime: Runtime;
    startupCommand: string; // resolved command (defaults to the runtime cmd; user-editable)
    startupArgs?: string[]; // exact argv to launch with (pi session resume); used verbatim, never split
    task: string;
    cwd: string;
}

// Build the CreateBlock meta. Terminal -> default shell block. Agent runtimes -> cmd block with the
// task passed as a single positional arg (arg array avoids all shell-quoting issues). The startup
// command is tokenized on whitespace (best-effort if the user adds flags) — unless startupArgs is
// given, in which case it is used verbatim because a pi resume path can never survive re-tokenizing.
export function buildLaunchMeta(spec: LaunchMetaSpec): Record<string, unknown> {
    if (spec.runtime === "terminal") {
        const meta: Record<string, unknown> = { view: "term", controller: "shell" };
        if (spec.cwd) {
            meta["cmd:cwd"] = spec.cwd;
        }
        return meta;
    }
    const startupTokens = spec.startupCommand.trim().split(/\s+/).filter(Boolean);
    const cmd = startupTokens[0] ?? "claude";
    // the launch flags/options before the task prompt, kept verbatim so resume-on-reopen can recompose
    // the command as `<cmd> --resume <id> <baseArgs>` without having to guess which arg was the prompt
    // (users can type value-taking options like `--model opus`, so parsing it back out is unsafe). A
    // pi resume passes its exact argv via startupArgs instead — the whole --session <path> pair is a
    // launch flag and must never be re-tokenized or parsed back out of a command string.
    const baseArgs = spec.startupArgs != null ? [...spec.startupArgs] : startupTokens.slice(1);
    const args = [...baseArgs];
    const task = spec.task.trim();
    if (task) {
        // agy takes its opening prompt through -i, not as a positional arg
        if (spec.runtime === "agy") {
            args.push("-i");
        }
        args.push(task);
    }
    const meta: Record<string, unknown> = {
        view: "term",
        controller: "cmd",
        cmd,
        "cmd:args": args,
        "agent:baseargs": baseArgs,
        "cmd:shell": false,
        // force WAVETERM_JWT into the agent's env. cmd/shell:false runs the agent non-interactively,
        // so Wave's shell-integration bootstrap (which exchanges the swap token for the real JWT)
        // never runs; without this the agent inherits a stale/absent ambient JWT and the external
        // status reporter's `wsh` routes agent:status to the wrong wavesrv (e.g. a coexisting Wave
        // install) instead of this one — leaving the cockpit roster empty.
        "cmd:jwt": true,
    };
    if (spec.cwd) {
        meta["cmd:cwd"] = spec.cwd;
    }
    return meta;
}

// The transcript filename stem is Claude's --resume session id
// (e.g. ~/.claude/projects/x/abc-123.jsonl -> "abc-123"). Undefined for empty/pathless input.
export function sessionIdFromTranscript(path: string | undefined): string | undefined {
    if (!path) {
        return undefined;
    }
    const base = path.split(/[/\\]/).pop() ?? "";
    const stem = base.endsWith(".jsonl") ? base.slice(0, -".jsonl".length) : base;
    return stem || undefined;
}

// Recompose a Claude launch as a resume: `claude --resume <id> <baseArgs>`. baseArgs are the original
// launch flags only (never the task prompt — resume reattaches, it must not replay the prompt). Any
// prior --resume/--continue in baseArgs is stripped so resuming repeatedly can't stack conflicting
// resume directives.
export function resumeArgsForClaude(sessionId: string, baseArgs: string[]): string[] {
    const kept: string[] = [];
    for (let i = 0; i < baseArgs.length; i++) {
        const a = baseArgs[i];
        if (a === "--resume") {
            i++; // also skip its id value
            continue;
        }
        if (a === "--continue") {
            continue;
        }
        kept.push(a);
    }
    return ["--resume", sessionId, ...kept];
}

// Recompose an opencode launch as a resume: `opencode -s <id> <baseArgs>`. -s/--session resume a
// named session (a cockpit worker's session id is its shadow filename stem); -c resumes only the
// last session and is stripped like claude's --continue so a repeated resume cannot stack directives.
export function resumeArgsForOpencode(sessionId: string, baseArgs: string[]): string[] {
    const kept: string[] = [];
    for (let i = 0; i < baseArgs.length; i++) {
        const a = baseArgs[i];
        if (a === "-s" || a === "--session") {
            i++; // also skip its id value
            continue;
        }
        if (a === "-c" || a === "--continue") {
            continue;
        }
        kept.push(a);
    }
    return ["-s", sessionId, ...kept];
}

// Recompose an agy launch as a resume: `agy --conversation <id> <baseArgs>`. agy names its own conversation, so the
// id is the status's session id (never a transcript stem: every agy transcript is transcript_full.jsonl). A prior
// --conversation <id>, -c or --continue is stripped so a repeated resume cannot stack directives.
export function resumeArgsForAgy(sessionId: string, baseArgs: string[]): string[] {
    const kept: string[] = [];
    for (let i = 0; i < baseArgs.length; i++) {
        const a = baseArgs[i];
        if (a === "--conversation") {
            i++; // also skip its id value
            continue;
        }
        if (a === "-c" || a === "--continue") {
            continue;
        }
        kept.push(a);
    }
    return ["--conversation", sessionId, ...kept];
}

// Recompose a pi launch as a resume: `pi --session <full transcript path> <baseArgs>`. Pi's resume
// key is the native file path (never an id), so it is passed whole — never decoded or re-tokenized.
// A prior --session <path> is stripped so a repeated resume cannot stack two directives.
export function resumeArgsForPi(transcriptPath: string, baseArgs: string[] = []): string[] {
    const kept: string[] = [];
    for (let i = 0; i < baseArgs.length; i++) {
        if (baseArgs[i] === "--session") {
            i++; // also skip its path value
            continue;
        }
        kept.push(baseArgs[i]);
    }
    return ["--session", transcriptPath, ...kept];
}
