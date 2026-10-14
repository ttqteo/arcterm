import { describe, expect, it } from "vitest";
import type { Memory } from "./memlint-core";
import { lintContext, lintMemory, parseMemory, referencedPaths, referencedTasks, taskNames } from "./memlint-core";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-14");

function mem(file: string, name: string | undefined, body: string, touchedMs = NOW): Memory {
    return { file, name, body, touchedMs };
}

function lint(memories: Memory[], index: string, extra: { missing?: string[]; tasks?: string[] | null } = {}) {
    return lintMemory({
        index,
        memories,
        missingPaths: new Set(extra.missing ?? []),
        tasks: extra.tasks === undefined ? null : extra.tasks && new Set(extra.tasks),
        nowMs: NOW,
    });
}

describe("parseMemory", () => {
    it("reads name, the modified date and the body below the frontmatter", () => {
        const text = '---\nname: "a-b"\nmetadata:\n  type: feedback\n  modified: 2026-10-01T09:00:00Z\n---\nthe rule\n';
        expect(parseMemory({ name: "f.md", text, mtimeMs: 0 })).toEqual({
            file: "f.md",
            name: "a-b",
            body: "the rule\n",
            touchedMs: Date.parse("2026-10-01"),
        });
    });

    it("falls back to the file's mtime with no modified date", () => {
        expect(parseMemory({ name: "f.md", text: "---\nname: x\n---\nbody", mtimeMs: 42 }).touchedMs).toBe(42);
    });
});

describe("references", () => {
    it("takes backticked relative paths with an extension, never placeholders or globs", () => {
        const body = "see `frontend/app/a.ts`, `docs/x.md`, `.waveterm/worktrees/<id>`, `~/.claude/s.json`, `a.ts`, `pkg/*.go`";
        expect(referencedPaths(body)).toEqual(["frontend/app/a.ts", "docs/x.md"]);
    });

    it("takes task names, with or without the ! prefix, never a glob", () => {
        expect(referencedTasks("run `task dev`, `! task install`, `task build:*`, `task check:ts`")).toEqual([
            "dev",
            "install",
            "check:ts",
        ]);
    });

    it("reads task names and both alias forms from a Taskfile", () => {
        const taskfile = [
            "tasks:",
            "    tauri:dev:",
            "        aliases:",
            "            - dev",
            "        cmds: []",
            "    check:ts:",
            "        aliases: [tc, typecheck]",
        ].join("\n");
        expect([...taskNames(taskfile)].sort()).toEqual(["check:ts", "dev", "tauri:dev", "tc", "typecheck"]);
    });
});

describe("lintMemory", () => {
    const index = "- [A](a.md) — x\n- [B](b.md) — y\n";

    it("is silent for a clean dir", () => {
        const memories = [mem("a.md", "a", "see [[b]] and `task dev`"), mem("b.md", "b", "rule")];
        expect(lint(memories, index, { tasks: ["dev"] })).toEqual([]);
    });

    it("finds index lines and files that disagree", () => {
        expect(lint([mem("a.md", "a", ""), mem("c.md", "c", "")], index)).toEqual([
            "MEMORY.md points at missing b.md",
            "c.md is not listed in MEMORY.md",
        ]);
    });

    it("finds broken links, missing names, gone paths and lost tasks", () => {
        const memories = [mem("a.md", undefined, "[[nobody]] `docs/gone.md` `task nope`"), mem("b.md", "b", "")];
        expect(lint(memories, index, { missing: ["docs/gone.md"], tasks: ["dev"] })).toEqual([
            "a.md has no name: in its frontmatter",
            "a.md links [[nobody]], which no memory is named",
            "a.md names docs/gone.md, which is not in the repo",
            "a.md names `task nope`, which Taskfile.yml no longer has",
        ]);
    });

    it("skips the task check where the working directory has no Taskfile", () => {
        expect(lint([mem("a.md", "a", "`task nope`"), mem("b.md", "b", "")], index)).toEqual([]);
    });

    it("flags a memory untouched for 30 days, not one touched 29 days ago", () => {
        const memories = [mem("a.md", "a", "", NOW - 30 * DAY), mem("b.md", "b", "", NOW - 29 * DAY)];
        expect(lint(memories, index)).toEqual(["a.md untouched for 30 days: still true? already in AGENTS.md?"]);
    });
});

describe("lintContext", () => {
    it("lists every problem under one instruction", () => {
        const text = lintContext("/m", ["p1", "p2"]);
        expect(text).toMatch(/found 2 issue\(s\) in your auto-memory dir \/m\./);
        expect(text.endsWith("\n- p1\n- p2")).toBe(true);
    });
});
