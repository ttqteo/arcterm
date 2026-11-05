import { describe, expect, it } from "vitest";
import { absolutePath, editTarget, foreignReason, needsAsk, parentDirs, repoKey, repoRoot } from "./foreignrepo-core";

describe("editTarget", () => {
    it("reads Edit and Write's file_path and NotebookEdit's notebook_path", () => {
        expect(editTarget({ file_path: "D:\\a\\b.ts", old_string: "x" })).toBe("D:\\a\\b.ts");
        expect(editTarget({ notebook_path: "/home/k/n.ipynb" })).toBe("/home/k/n.ipynb");
    });

    it.each([null, undefined, "D:/a", {}, { file_path: 3 }, { file_path: "  " }])("has none for %j", (input) => {
        expect(editTarget(input)).toBeNull();
    });
});

describe("absolutePath", () => {
    it("keeps an absolute path, with forward slashes", () => {
        expect(absolutePath("D:\\src\\arcterm\\a.ts", "D:\\mit")).toBe("D:/src/arcterm/a.ts");
        expect(absolutePath("/home/k/a.ts", "/tmp")).toBe("/home/k/a.ts");
    });

    it("joins a relative path to the cwd", () => {
        expect(absolutePath("src\\a.ts", "D:\\mit\\thesis\\")).toBe("D:/mit/thesis/src/a.ts");
        expect(absolutePath("a.ts", "/home/k/p")).toBe("/home/k/p/a.ts");
    });
});

describe("parentDirs", () => {
    it("walks a Windows path up to its drive root", () => {
        expect(parentDirs("D:/src/arcterm/a.ts")).toEqual(["D:/src/arcterm", "D:/src", "D:/"]);
    });

    it("walks a POSIX path up to /", () => {
        expect(parentDirs("/home/k/a.ts")).toEqual(["/home/k", "/home", "/"]);
    });
});

describe("repoKey", () => {
    it("gives a checkout and its worktrees one key", () => {
        // what git prints from the checkout and from an engine tree under arc-wt
        expect(repoKey("D:/src/arcterm/.git\n")).toBe(repoKey("d:\\src\\arcterm\\.git"));
    });

    it("keeps a POSIX path's case", () => {
        expect(repoKey("/Users/K/proj/.git\n")).toBe("/Users/K/proj/.git");
    });

    it("has none for empty output", () => {
        expect(repoKey(" \n")).toBeNull();
    });
});

describe("repoRoot", () => {
    it("drops the trailing .git", () => {
        expect(repoRoot("D:/src/arcterm/.git\n")).toBe("D:/src/arcterm");
        expect(repoRoot("/srv/bare.git")).toBe("/srv/bare.git");
    });
});

describe("needsAsk", () => {
    const thesis = "d:/src/mit/mit-thesis/.git";
    const arcterm = "d:/src/arcterm/.git";

    it("asks for a file in another repo", () => {
        expect(needsAsk(thesis, arcterm, new Set())).toBe(true);
    });

    it("lets the session's own repo through", () => {
        expect(needsAsk(arcterm, arcterm, new Set())).toBe(false);
    });

    it("lets a repo the person already allowed through", () => {
        expect(needsAsk(thesis, arcterm, new Set([arcterm]))).toBe(false);
    });

    it("never asks outside a repo, or for a session that did not start in one", () => {
        expect(needsAsk(thesis, null, new Set())).toBe(false);
        expect(needsAsk(null, arcterm, new Set())).toBe(false);
    });
});

describe("foreignReason", () => {
    const args = ["D:/src/arcterm/a.ts", "D:/src/arcterm", "D:/src/mit/mit-thesis"] as const;

    it("names both repos and what a yes allows", () => {
        const text = foreignReason(...args, true);
        expect(text).toContain("another repo (D:/src/arcterm)");
        expect(text).toContain("this session's project (D:/src/mit/mit-thesis)");
        expect(text).toMatch(/until it ends/);
    });

    it("tells the model to ask where nobody can be asked", () => {
        expect(foreignReason(...args, false)).toMatch(/^Refused by arcterm: .*Ask the person/);
    });
});
