// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    cleanupSignature,
    cwdsToCheck,
    folderName,
    goneTerminals,
    reopenLabel,
    reopenTarget,
    statPath,
} from "./worktreegone";

function term(over: Partial<AgentVM> = {}): AgentVM {
    return {
        id: "t1",
        name: "lazygit",
        task: "",
        state: "idle",
        kind: "terminal",
        project: "arcterm",
        cwd: "D:\\work\\arcterm\\.worktrees\\fix-login-agent",
        ...over,
    };
}
const roots = new Map([["arcterm", "D:\\work\\arcterm"]]);
const missing = () => false;

describe("goneTerminals", () => {
    it("reports a terminal whose folder is missing", () => {
        expect(goneTerminals([term()], missing, roots)).toEqual(["t1"]);
    });

    it("keeps a terminal whose folder exists, and one whose folder has not been checked yet", () => {
        expect(goneTerminals([term()], () => true, roots)).toEqual([]);
        expect(goneTerminals([term()], () => undefined, roots)).toEqual([]);
    });

    it("asks about the terminal's own cwd", () => {
        const asked: string[] = [];
        goneTerminals([term()], (cwd) => (asked.push(cwd), false), roots);
        expect(asked).toEqual(["D:\\work\\arcterm\\.worktrees\\fix-login-agent"]);
    });

    it("never reports a terminal in its project's root, whatever the path's case, slashes or trailing slash", () => {
        for (const cwd of ["D:\\work\\arcterm", "d:/work/arcterm/", "D:\\WORK\\ARCTERM\\"]) {
            expect(goneTerminals([term({ cwd })], missing, roots)).toEqual([]);
        }
    });

    it("skips a terminal with no cwd", () => {
        expect(goneTerminals([term({ cwd: undefined })], missing, roots)).toEqual([]);
    });

    it("reports a terminal whose project has no registered root, which has no root to be in", () => {
        expect(goneTerminals([term({ project: "elsewhere" })], missing, roots)).toEqual(["t1"]);
        expect(goneTerminals([term({ project: undefined })], missing, roots)).toEqual(["t1"]);
    });

    it("lists only the ones that are gone, in order", () => {
        const list = [
            term({ id: "a", cwd: "D:\\work\\arcterm\\a" }),
            term({ id: "b", cwd: "D:\\work\\arcterm\\b" }),
            term({ id: "c", cwd: "D:\\work\\arcterm\\c" }),
        ];
        expect(goneTerminals(list, (cwd) => !cwd.endsWith("b"), roots)).toEqual(["b"]);
    });
});

describe("cwdsToCheck", () => {
    it("is each folder once, leaving out a project's root and a terminal with no cwd", () => {
        const list = [
            term({ id: "a", cwd: "D:\\work\\arcterm\\a" }),
            term({ id: "b", cwd: "D:\\work\\arcterm\\a" }),
            term({ id: "c", cwd: "D:\\work\\arcterm" }),
            term({ id: "d", cwd: undefined }),
            term({ id: "e", cwd: "D:\\work\\arcterm\\e" }),
        ];
        expect(cwdsToCheck(list, roots)).toEqual(["D:\\work\\arcterm\\a", "D:\\work\\arcterm\\e"]);
    });
});

describe("statPath", () => {
    it("is the cwd itself where it is a path of this system", () => {
        expect(statPath("D:\\work\\arcterm", "win32")).toBe("D:\\work\\arcterm");
        expect(statPath("d:/work/arcterm", "win32")).toBe("d:/work/arcterm");
        expect(statPath("\\\\server\\share\\repo", "win32")).toBe("\\\\server\\share\\repo");
        expect(statPath("/Users/me/arcterm", "darwin")).toBe("/Users/me/arcterm");
    });

    it("turns the path Git Bash reports on Windows (/c/work) into a drive path", () => {
        expect(statPath("/c/work/arcterm", "win32")).toBe("C:/work/arcterm");
        expect(statPath("/d", "win32")).toBe("D:/");
    });

    it("is nothing for a path Windows cannot tell, so the folder is never called gone on a guess", () => {
        expect(statPath("/home/me/repo", "win32")).toBeUndefined();
        expect(statPath("/tmp", "win32")).toBeUndefined();
    });
});

describe("reopenTarget", () => {
    it("is the terminal's project root", () => {
        expect(reopenTarget(term(), roots)).toEqual({ project: "arcterm", path: "D:\\work\\arcterm", home: false });
    });

    it("is Home for a terminal whose project has no root, or no project", () => {
        const home = { project: "Home", path: "~", home: true };
        expect(reopenTarget(term({ project: "elsewhere" }), roots)).toEqual(home);
        expect(reopenTarget(term({ project: undefined }), roots)).toEqual(home);
    });
});

describe("folderName", () => {
    it("is the last folder of the path, whichever the separator and with or without a trailing one", () => {
        expect(folderName("D:\\work\\arcterm\\.worktrees\\fix-login-agent")).toBe("fix-login-agent");
        expect(folderName("/Users/me/arcterm/fix-login-agent/")).toBe("fix-login-agent");
    });

    it("is nothing for no path", () => {
        expect(folderName(undefined)).toBeUndefined();
        expect(folderName("")).toBeUndefined();
    });
});

describe("reopenLabel", () => {
    it("names where the terminal reopens", () => {
        expect(reopenLabel({ project: "arcterm", path: "D:\\work\\arcterm", home: false })).toBe("Reopen in arcterm");
        expect(reopenLabel({ project: "Home", path: "~", home: true })).toBe("Reopen in Home");
    });
});

describe("cleanupSignature", () => {
    const digest = (...tasks: [string, string][]) =>
        ({ tasks: tasks.map(([taskid, cleanupstate]) => ({ taskid, cleanupstate })) }) as unknown as DagStatusDigest;

    it("changes when a task's worktree is cleaned up", () => {
        const before = cleanupSignature({ r1: digest(["t-1", "pending"], ["t-2", "pending"]) });
        const after = cleanupSignature({ r1: digest(["t-1", "done"], ["t-2", "pending"]) });
        expect(after).not.toBe(before);
    });

    it("holds while only unrelated digests change", () => {
        const a = digest(["t-1", "done"]);
        expect(cleanupSignature({ r1: a })).toBe(
            cleanupSignature({ r1: { ...a, health: "running" } as DagStatusDigest })
        );
    });

    it("is the same for the same runs in any order, and empty for none", () => {
        const one = digest(["t-1", "done"]);
        const two = digest(["t-1", "pending"]);
        expect(cleanupSignature({ r1: one, r2: two })).toBe(cleanupSignature({ r2: two, r1: one }));
        expect(cleanupSignature({})).toBe("");
    });
});
