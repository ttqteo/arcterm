// a `git merge` run while the agent's Verify tile is red or amber goes to the person first: the rail shows the
// scenarios' results, and this is where a merge into the default branch meets them. kept free of the engine so
// vitest can run it; register.ts holds the tool.check hook, which asks `wsh verify gate` and puts its answer here.
// wavesrv decides what a merge is worth an ask (branch, verdict, skips); this file only finds the merge in a shell
// command and the directory it runs in.

// the answer of `wsh verify gate`
export type Gate = { ask: boolean; reason: string };

// a word of a shell command: runs of quoted strings and bare characters, so `-m"x y"` is one word
const WORD = String.raw`(?:'[^']*'|"(?:\\.|[^"\\])*"|[^\s;&|()<>'"])+`;
const TOKENS = new RegExp(String.raw`&&|\|\||[;|\n]|${WORD}`, "g");
const SEPARATORS = new Set(["&&", "||", ";", "|", "\n"]);

// a heredoc's body is text, not commands
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g;

// what git merge takes to end or leave a merge rather than make one
const NOT_A_MERGE = new Set(["--abort", "--continue", "--quit", "--skip"]);

// words in front of a command that leave it the same command
const PREFIXES = new Set(["sudo", "command", "env", "nohup", "time"]);

// bash's and PowerShell's ways to change directory
const CD = new Set(["cd", "chdir", "pushd", "sl", "set-location", "push-location"]);

// git's options that take their value as the next word
const GIT_VALUED = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);

type Segment = { words: string[]; piped: boolean };

function unquote(word: string): string {
    return word.replace(
        /'([^']*)'|"((?:\\.|[^"\\])*)"/g,
        (_, single: string | undefined, double: string | undefined) => {
            return single ?? double ?? "";
        }
    );
}

// the simple commands of a command line, split at `&&`, `||`, `;`, `|` and newlines, each as its words with the
// quotes taken off. `piped` marks a command whose output goes into the next: a cd there changes nothing after it
function segmentsOf(command: string): Segment[] {
    const segments: Segment[] = [];
    let words: string[] = [];
    for (const token of command.replace(HEREDOC, "").match(TOKENS) ?? []) {
        if (SEPARATORS.has(token)) {
            segments.push({ words, piped: token === "|" });
            words = [];
        } else {
            words.push(unquote(token));
        }
    }
    segments.push({ words, piped: false });
    return segments.filter((segment) => segment.words.length > 0);
}

// the words of a simple command without leading `VAR=value`, `sudo`, `env` and the like
function withoutPrefix(words: string[]): string[] {
    let index = 0;
    while (index < words.length && (/^\w+=/.test(words[index] ?? "") || PREFIXES.has(words[index] ?? ""))) {
        index++;
    }
    return words.slice(index);
}

function isGit(word: string): boolean {
    return /(?:^|[\\/])git(?:\.exe)?$/i.test(word);
}

// a path this file can resolve: not one that waits on a shell to expand a variable, a home or a glob
function isPlaceable(path: string): boolean {
    return path !== "" && path !== "-" && !/^~|[$%`*?]/.test(path);
}

function isAbsolute(path: string): boolean {
    return /^(?:[a-zA-Z]:)?\//.test(path);
}

// the path with `.` and `..` folded away, its root (`/`, `D:/`, `//` for a share) kept
function fold(path: string): string {
    const root = /^(?:[a-zA-Z]:)?\/{1,2}/.exec(path)?.[0] ?? "";
    const parts: string[] = [];
    for (const part of path.slice(root.length).split("/")) {
        if (part === "" || part === ".") {
            continue;
        }
        if (part !== "..") {
            parts.push(part);
        } else if (parts.length > 0 && parts[parts.length - 1] !== "..") {
            parts.pop();
        } else if (root === "") {
            parts.push(part);
        }
    }
    return root + parts.join("/");
}

// where `dir` leads from `base`, with forward slashes. Git Bash writes the D: drive as `/d`, which wsh (a Windows
// program) cannot open, so on a drive-lettered base a one-letter first folder is that drive
function resolveDir(dir: string, base: string): string {
    let path = dir.replace(/\\/g, "/");
    if (/^[a-zA-Z]:[\\/]/.test(base)) {
        path = path.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, drive: string) => `${drive.toUpperCase()}:`);
    }
    return fold(isAbsolute(path) ? path : `${base.replace(/\\/g, "/")}/${path}`);
}

// the directory a cd command's arguments name, null when they name none: `cd` alone, `cd -`
function cdTarget(args: string[]): string | null {
    let index = 0;
    while (index < args.length) {
        const arg = args[index] ?? "";
        const flag = arg.toLowerCase();
        if (flag === "-path" || flag === "-literalpath") {
            return args[index + 1] ?? null;
        }
        if (arg === "-") {
            return null;
        }
        if (arg === "--") {
            index++;
            break;
        }
        // cmd's `cd /d D:\x`; alone, `/d` is Git Bash's D: drive
        if (arg.startsWith("-") || (flag === "/d" && index + 1 < args.length)) {
            index++;
            continue;
        }
        break;
    }
    return args[index] ?? null;
}

// the directory a `git ... merge` command runs in, null when the words are no merge
function gitMergeDir(words: string[], dir: string): string | null {
    let at = dir;
    let index = 1;
    for (; index < words.length; index++) {
        const word = words[index] ?? "";
        if (word === "-C") {
            index++;
            const to = words[index];
            if (to !== undefined && isPlaceable(to)) {
                at = resolveDir(to, at);
            }
        } else if (GIT_VALUED.has(word)) {
            index++;
        } else if (!word.startsWith("-")) {
            break;
        }
    }
    if (words[index] !== "merge") {
        return null;
    }
    return words.slice(index + 1).some((word) => NOT_A_MERGE.has(word)) ? null : at;
}

// the first `git merge` in a shell command and the directory it runs in, following a `cd <dir> &&` before it and a
// `git -C <dir>` (relative to the session's `cwd`); null when the command merges nothing. a directory a shell
// would have to expand (`cd $REPO`, `cd ~/x`) leaves the directory where it was
export function mergeTarget(command: string, cwd: string): { cwd: string } | null {
    let dir = cwd;
    for (const segment of segmentsOf(command)) {
        const words = withoutPrefix(segment.words);
        const head = words[0];
        if (head === undefined) {
            continue;
        }
        if (CD.has(head.toLowerCase())) {
            const to = segment.piped ? null : cdTarget(words.slice(1));
            if (to !== null && isPlaceable(to)) {
                dir = resolveDir(to, dir);
            }
        } else if (isGit(head)) {
            const at = gitMergeDir(words, dir);
            if (at !== null) {
                return { cwd: at };
            }
        }
    }
    return null;
}

// what `wsh verify gate` printed, null when it is not the gate's JSON. a missing reason reads as an empty one
export function parseGate(text: string): Gate | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const { ask, reason } = value as { ask?: unknown; reason?: unknown };
    if (typeof ask !== "boolean" || (reason !== undefined && typeof reason !== "string")) {
        return null;
    }
    return { ask, reason: reason ?? "" };
}

// a gate that asks with no line of its own still has to say what the person is asked
const FALLBACK_REASON = "Verify has a red or amber result for this agent. Merge anyway?";

// the tool.check verdict for a merge: null when the gate lets it through, an ask otherwise. where nobody can be
// asked (an engine worker: no `approver`) the engine turns the ask into a deny, so the reason tells the model to
// ask the person before it merges
export function gateVerdict(gate: Gate | null, canAsk: boolean): { decision: "ask"; reason: string } | null {
    if (gate === null || !gate.ask) {
        return null;
    }
    const reason = gate.reason.trim() === "" ? FALLBACK_REASON : gate.reason;
    return {
        decision: "ask",
        reason: canAsk
            ? reason
            : `${reason} This session cannot ask the person, so the merge did not run: ask the person before merging.`,
    };
}

// `wsh verify gate` for the merge's directory and the command as written
export function verifyGateArgs(target: { cwd: string }, command: string): string[] {
    return ["verify", "gate", "--cwd", target.cwd, "--command", command];
}
