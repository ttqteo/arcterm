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

export function isEngineTree(cwd: string): boolean {
    return ENGINE_TREE.test(cwd);
}

const COMMIT = new RegExp(GIT + String.raw`(?:commit|tag)\b`, "g");
const MESSAGE_FLAG = /^(?:-[a-zA-Z]*m|--message=?)$/;
const SHELL_TOKEN = /"(?:[^"\\]|\\[\s\S])*"|'[^']*'|[;&|\n]|\s+|[^\s"';&|]+|[\s\S]/g;
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1/;
const SUBSTITUTION = /\$\([^)]*\)|`[^`]*`/g;

const blank = (s: string) => s.replace(/[^\n]/g, "_");

// a substitution in the text still runs, so it stays visible to the rules; an unbalanced one keeps it all
function maskText(s: string): string {
    let out = "";
    let last = 0;
    for (const m of s.matchAll(SUBSTITUTION)) {
        out += blank(s.slice(last, m.index)) + m[0];
        last = m.index + m[0].length;
    }
    const rest = s.slice(last);
    return /\$\(|`/.test(rest) ? s : out + blank(rest);
}

function maskValue(token: string): string {
    return token.startsWith("'") ? blank(token) : maskText(token);
}

// a heredoc feeds the commit when it opens inside the commit's own command or pipes straight into it
function feedsCommit(line: string, opener: RegExpExecArray): boolean {
    const commit = new RegExp(COMMIT.source).exec(line);
    if (!commit) {
        return false;
    }
    if (commit.index < opener.index) {
        return !/[;&|]/.test(line.slice(commit.index + commit[0].length, opener.index));
    }
    return /^\s*\|\s*$/.test(line.slice(opener.index + opener[0].length, commit.index));
}

// the bodies of heredocs fed to a git commit or tag, then each -m/--message value of a commit or tag
function maskMessages(command: string): string {
    const lines = command.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const opener = HEREDOC.exec(lines[i]);
        if (!opener || !feedsCommit(lines[i], opener)) {
            continue;
        }
        const end = lines.findIndex((line, j) => j > i && line.replace(/^\t+/, "") === opener[2]);
        const stop = end < 0 ? lines.length : end;
        for (let j = i + 1; j < stop; j++) {
            lines[j] = opener[1] ? blank(lines[j]) : maskText(lines[j]);
        }
        i = stop;
    }
    let text = lines.join("\n");
    for (const commit of [...text.matchAll(COMMIT)]) {
        const start = commit.index + commit[0].length;
        // masking keeps lengths, so a match blanked by an earlier message no longer reads as itself
        if (text.slice(commit.index, start) !== commit[0]) {
            continue;
        }
        const tail = text.slice(start);
        let out = "";
        let wantValue = false;
        let rest = "";
        for (const token of tail.matchAll(SHELL_TOKEN)) {
            const t = token[0];
            if (/^[;&|\n]$/.test(t)) {
                rest = tail.slice(token.index);
                break;
            }
            if (wantValue && !/^\s+$/.test(t)) {
                out += maskValue(t);
                wantValue = false;
                continue;
            }
            if (t.startsWith("--message=") && t.length > "--message=".length) {
                out += "--message=" + maskValue(t.slice("--message=".length));
                continue;
            }
            wantValue ||= MESSAGE_FLAG.test(t);
            out += t;
        }
        text = text.slice(0, start) + out + rest;
    }
    return text;
}

// why the session may not run this command from this directory; null when it may
export function denial(command: string, cwd: string, background = false): string | null {
    // a commit or tag message may name a refused command without running it
    const text = maskMessages(command);
    if (ARC_IMAGE.test(text) && KILL_BY_NAME.test(text)) {
        return KILL_REASON;
    }
    // quoted text is masked so a `>` inside a quoted script is not a redirect
    if (background && STDOUT_REDIRECT.test(command.replace(QUOTED, (q) => q[0] + "_".repeat(q.length - 2) + q[0]))) {
        return REDIRECT_REASON;
    }
    if (!isEngineTree(cwd)) {
        return null;
    }
    const broken = LANE_RULES.find(([pattern]) => pattern.test(text));
    return broken ? `Refused by arcterm: ${broken[1]}. If your task cannot finish without it, ask.` : null;
}
