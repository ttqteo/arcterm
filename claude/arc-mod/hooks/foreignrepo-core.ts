// a file edit outside the session's own repo is put to the person before it runs: a session started in one
// project once read a screenshot of another and edited that repo's main checkout unasked, without its rules or
// memory. kept free of the engine so vitest can run it; register.ts holds the tool.check and tool.call hooks.

// the file a file tool writes, null for any other input
export function editTarget(input: unknown): string | null {
    if (typeof input !== "object" || input === null) {
        return null;
    }
    const { file_path, notebook_path } = input as { file_path?: unknown; notebook_path?: unknown };
    const path = typeof file_path === "string" ? file_path : notebook_path;
    return typeof path === "string" && path.trim() !== "" ? path : null;
}

function isAbsolute(path: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\");
}

// the path with forward slashes and no trailing one, joined to cwd when relative
export function absolutePath(path: string, cwd: string): string {
    const full = isAbsolute(path) ? path : `${cwd.replace(/[\\/]+$/, "")}/${path}`;
    return full.replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
}

// the directories above the file, nearest first, down to the root: a Write may name folders not made yet,
// so the hook asks git from the nearest one that exists
export function parentDirs(file: string): string[] {
    const dirs: string[] = [];
    let at = file;
    for (;;) {
        const cut = at.lastIndexOf("/");
        if (cut < 0) {
            return dirs;
        }
        // keep the root's slash: "D:/" and "/"
        const up = cut === 0 || (cut === 2 && at[1] === ":") ? at.slice(0, cut + 1) : at.slice(0, cut);
        if (up === at) {
            return dirs;
        }
        dirs.push(up);
        at = up;
    }
}

// one key per repo from `git rev-parse --path-format=absolute --git-common-dir`: every worktree of a repo
// shares its common dir, so an engine run's tree in arc-wt is the same repo as its checkout. a Windows path
// compares without case
export function repoKey(commonDir: string): string | null {
    const dir = commonDir
        .trim()
        .replace(/\\/g, "/")
        .replace(/(.)\/+$/, "$1");
    if (dir === "") {
        return null;
    }
    return /^[a-zA-Z]:\//.test(dir) ? dir.toLowerCase() : dir;
}

// the folder a person knows the repo by: its common dir less a trailing .git
export function repoRoot(commonDir: string): string {
    const dir = commonDir
        .trim()
        .replace(/\\/g, "/")
        .replace(/(.)\/+$/, "$1");
    return dir.replace(/\/\.git$/i, "");
}

// whether the edit needs the person's yes: the target sits in a repo that is not the session's and that the
// person has not let this session edit. outside any repo (temp, the scratchpad, ~/.claude) it never does, nor
// for a session that did not start in a repo
export function needsAsk(sessionRepo: string | null, targetRepo: string | null, allowed: ReadonlySet<string>): boolean {
    return sessionRepo !== null && targetRepo !== null && targetRepo !== sessionRepo && !allowed.has(targetRepo);
}

// the dialog's line, and the model's error where nobody can be asked (a run's agent, `claude -p`)
export function foreignReason(file: string, targetRoot: string, sessionRoot: string, canAsk: boolean): string {
    const where = `${file} is in another repo (${targetRoot}), not this session's project (${sessionRoot}).`;
    return canAsk
        ? `arcterm: ${where} A yes lets this session edit that repo until it ends.`
        : `Refused by arcterm: ${where} Ask the person before working in another repo, or work there from a session started in it.`;
}
