// session start -> a lint of the project's Claude auto-memory dir. kept free of the engine so vitest can run
// it; register.ts reads the files and does the reporting.
//
// it catches what goes stale mechanically: MEMORY.md lines pointing at missing files, memory files MEMORY.md
// does not list, [[links]] no memory is named, backticked repo paths that are gone, `task X` commands the
// Taskfile lost, and memories nobody touched for STALE_DAYS. a rule that moved into AGENTS.md and left its
// memory behind is a judgment call this cannot make.

export const STALE_DAYS = 30;

export type MemoryFile = { name: string; text: string; mtimeMs: number };

export type Memory = { file: string; name?: string; body: string; touchedMs: number };

export function parseMemory(f: MemoryFile): Memory {
    const name = f.text.match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
    const modified = f.text.match(/^\s*modified:\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1];
    const body = f.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    const touchedMs = modified ? Date.parse(modified) : f.mtimeMs;
    return { file: f.name, name, body, touchedMs };
}

// relative repo paths with an extension, backticked: `frontend/app/foo.ts`. placeholders and globs are skipped
export function referencedPaths(body: string): string[] {
    const paths = [...body.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
    return paths.filter((p) => /^[\w.-]+(\/[\w.-]+)+\.[a-z]{1,5}$/i.test(p));
}

// `task dev`, `! task install`; a glob like `task build:*` is skipped
export function referencedTasks(body: string): string[] {
    return [...body.matchAll(/`!?\s*task ([\w:-]+)(?![\w:*-])/g)].map((m) => m[1]);
}

// the Taskfile's task names and their aliases (`aliases: [a, b]` or a `- a` list under `aliases:`)
export function taskNames(taskfile: string): Set<string> {
    const names = new Set<string>();
    let isInAliases = false;
    for (const line of taskfile.split(/\r?\n/)) {
        const def = line.match(/^ {4}([\w:-]+):\s*$/);
        if (def) {
            names.add(def[1]);
        }
        const inline = line.match(/^\s+aliases:\s*\[(.*)\]/);
        if (inline) {
            inline[1].split(",").forEach((a) => names.add(a.trim()));
        }
        if (/^\s+aliases:\s*$/.test(line)) {
            isInAliases = true;
        } else if (isInAliases && /^\s+-\s*[\w:-]+\s*$/.test(line)) {
            names.add(line.trim().slice(1).trim());
        } else {
            isInAliases = false;
        }
    }
    return names;
}

export type LintInput = {
    index: string;
    memories: Memory[];
    // the referenced paths that are not in the working directory
    missingPaths: Set<string>;
    // the Taskfile's names, null when the working directory has none
    tasks: Set<string> | null;
    nowMs: number;
};

export function lintMemory(input: LintInput): string[] {
    const problems: string[] = [];
    const files = new Set(input.memories.map((m) => m.file));
    const indexed = new Set([...input.index.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]));
    for (const f of indexed) {
        if (!files.has(f)) {
            problems.push(`MEMORY.md points at missing ${f}`);
        }
    }
    for (const f of files) {
        if (!indexed.has(f)) {
            problems.push(`${f} is not listed in MEMORY.md`);
        }
    }
    const names = new Set(input.memories.map((m) => m.name).filter(Boolean));
    for (const m of input.memories) {
        if (!m.name) {
            problems.push(`${m.file} has no name: in its frontmatter`);
        }
        for (const [, link] of m.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
            if (!names.has(link)) {
                problems.push(`${m.file} links [[${link}]], which no memory is named`);
            }
        }
        for (const p of referencedPaths(m.body)) {
            if (input.missingPaths.has(p)) {
                problems.push(`${m.file} names ${p}, which is not in the repo`);
            }
        }
        if (input.tasks) {
            for (const t of referencedTasks(m.body)) {
                if (!input.tasks.has(t)) {
                    problems.push(`${m.file} names \`task ${t}\`, which Taskfile.yml no longer has`);
                }
            }
        }
        const days = Math.floor((input.nowMs - m.touchedMs) / 86_400_000);
        if (days >= STALE_DAYS) {
            problems.push(`${m.file} untouched for ${days} days: still true? already in AGENTS.md?`);
        }
    }
    return [...new Set(problems)];
}

// the row the model reads before the first prompt: the list, and what to do with it
export function lintContext(dir: string, problems: string[]): string {
    const list = problems.map((p) => `- ${p}`).join("\n");
    return (
        `[arc memory lint] At session start arc's memory lint found ${problems.length} issue(s) in your ` +
        `auto-memory dir ${dir}. In your first reply, mention them to the user briefly, once, and offer to fix ` +
        `them; deleting a memory is the user's call unless it is a clear duplicate.\n\n${list}`
    );
}
