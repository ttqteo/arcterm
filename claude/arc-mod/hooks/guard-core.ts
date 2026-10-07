// the shell commands a session inside arcterm is refused, whatever its prompt says. kept free of the engine so
// vitest can run it; register.ts holds the tool.call hooks.

const ARC_IMAGE = /wave-tauri|wavesrv/i;

// stopping by pid passes: the dev app and the installed arcterm share their image names, so a kill by name
// takes down the arcterm the session runs in and every agent beside it
const KILL_BY_NAME =
    /\btaskkill\b[^|;&]*[/-]im\b|\bstop-process\b(?![^|;&]*-id\b)|\bkill\b[^|;&]*-name\b|\bpkill\b|\bkillall\b/i;

const KILL_REASON =
    "Refused by arcterm: this stops arcterm by image name, which also kills the running arcterm and every agent in it. " +
    "List the processes with their paths and stop only the pid you mean.";

// a tree the engine made for a run: <project>/.waveterm/worktrees/<run or task key>
const ENGINE_TREE = /[\\/]\.waveterm[\\/]worktrees[\\/][^\\/]+/;

// git, past the options that come before its subcommand
const GIT = String.raw`\bgit(?:\s+-[cC]\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+`;

const LANE_RULES: [RegExp, string][] = [
    [new RegExp(GIT + String.raw`push\b`), "the engine lands this branch, so nothing is pushed from a run's worktree"],
    [
        new RegExp(GIT + String.raw`worktree\s+(?:add|remove|move|prune)\b`),
        "the engine makes and removes a run's worktrees",
    ],
    [
        new RegExp(GIT + String.raw`(?:switch\b|checkout\s+-[bB]\b)`),
        "the engine merges the branch this worktree is on, so stay on it",
    ],
];

// why the session may not run this command from this directory; null when it may
export function denial(command: string, cwd: string): string | null {
    if (ARC_IMAGE.test(command) && KILL_BY_NAME.test(command)) {
        return KILL_REASON;
    }
    if (!ENGINE_TREE.test(cwd)) {
        return null;
    }
    const broken = LANE_RULES.find(([pattern]) => pattern.test(command));
    return broken ? `Refused by arcterm: ${broken[1]}. If your task cannot finish without it, ask.` : null;
}
