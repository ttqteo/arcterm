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

// a stdout redirect to a file outside quotes: `>`, `>>`, `1>` or `&>`. `2>`, `>&2` and a discard (/dev/null, NUL,
// PowerShell's $null) never match
const STDOUT_REDIRECT = /(?:^|[\s;|&(])(?:1|&)?>>?\s*(?!&|\/dev\/null\b|nul\b|\$null\b)[^\s;|&<>()]/i;
const QUOTED = /"[^"]*"|'[^']*'/g;

// the cockpit shows a background task's output from claude's own output file, which a redirect leaves empty
const REDIRECT_REASON =
    "Refused by arcterm: Claude Code already saves a background command's output to its output file, which arcterm " +
    "shows; a redirect to a file leaves it empty. Drop the stdout redirect, and read or grep the output file " +
    "once the task ends.";

// a tree the engine made for a run: <user cache dir>/arc-wt/<key>, or the legacy
// <project>/.waveterm/worktrees/<run or task key>
const ENGINE_TREE = /[\\/](?:\.waveterm[\\/]worktrees|arc-wt)[\\/][^\\/]+/;

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
export function denial(command: string, cwd: string, background = false): string | null {
    if (ARC_IMAGE.test(command) && KILL_BY_NAME.test(command)) {
        return KILL_REASON;
    }
    // quoted text is masked so a `>` inside a quoted script is not a redirect
    if (background && STDOUT_REDIRECT.test(command.replace(QUOTED, (q) => q[0] + "_".repeat(q.length - 2) + q[0]))) {
        return REDIRECT_REASON;
    }
    if (!ENGINE_TREE.test(cwd)) {
        return null;
    }
    const broken = LANE_RULES.find(([pattern]) => pattern.test(command));
    return broken ? `Refused by arcterm: ${broken[1]}. If your task cannot finish without it, ask.` : null;
}
