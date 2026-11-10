import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    chatFilesRoot,
    fileMentionAt,
    fileMentionMatches,
    insertFileMention,
    mentionMatchMask,
    mentionRuns,
    recentMentionPaths,
} from "./launchermention";

describe("fileMentionAt", () => {
    it("opens on a bare @ at the start", () => {
        expect(fileMentionAt("@", 1)).toEqual({ start: 0, query: "" });
    });

    it("reads the path typed after an @ that follows a space", () => {
        const text = "fix @src/ap";
        expect(fileMentionAt(text, text.length)).toEqual({ start: 4, query: "src/ap" });
    });

    it("opens after a newline, a bracket or a quote", () => {
        expect(fileMentionAt("a\n@x", 4)).toEqual({ start: 2, query: "x" });
        expect(fileMentionAt("(@x", 3)).toEqual({ start: 1, query: "x" });
        expect(fileMentionAt('"@x', 3)).toEqual({ start: 1, query: "x" });
    });

    it("stays shut on an @ inside a word", () => {
        expect(fileMentionAt("me@example.com", 14)).toBeNull();
    });

    it("closes once a space follows the path", () => {
        expect(fileMentionAt("@src/app.ts ", 12)).toBeNull();
    });

    it("reads only up to the caret", () => {
        expect(fileMentionAt("@src/app.ts and more", 5)).toEqual({ start: 0, query: "src/" });
    });

    it("finds nothing without an @", () => {
        expect(fileMentionAt("plain task", 10)).toBeNull();
    });
});

describe("fileMentionMatches", () => {
    const paths = ["README.md", "src/app.ts", "src/app.test.ts", "docs/apple.md", "pkg/main.go"];

    it("ranks the closest basename first and lists every path the query reaches", () => {
        const got = fileMentionMatches("app", paths);
        expect(got[0]).toBe("src/app.ts");
        expect([...got].sort()).toEqual(["docs/apple.md", "src/app.test.ts", "src/app.ts"]);
    });

    it("drops a path the query does not reach", () => {
        expect(fileMentionMatches("main", paths)).toEqual(["pkg/main.go"]);
    });

    it("lists the head of the index for an empty query, capped", () => {
        expect(fileMentionMatches("", paths, 2)).toEqual(["README.md", "src/app.ts"]);
    });
});

describe("insertFileMention", () => {
    it("replaces the typed @ word with the path and a space", () => {
        expect(insertFileMention("fix @ap", 4, 7, "src/app.ts")).toEqual({ text: "fix @src/app.ts ", caret: 16 });
    });

    it("keeps the space that already follows", () => {
        expect(insertFileMention("@ap then", 0, 3, "src/app.ts")).toEqual({ text: "@src/app.ts then", caret: 12 });
    });

    it("swallows the rest of the word the caret sits in", () => {
        expect(insertFileMention("@src/fo|o.ts x".replace("|", ""), 0, 7, "src/foo.ts")).toEqual({
            text: "@src/foo.ts x",
            caret: 12,
        });
    });
});

describe("chatFilesRoot", () => {
    const registry = { arcterm: { path: "/w/arcterm" } };

    it("lists the agent's own folder, a worktree included", () => {
        expect(chatFilesRoot("/w/arcterm/.worktrees/x", "arcterm", registry)).toBe("/w/arcterm/.worktrees/x");
    });

    it("falls back to the project's folder with no cwd", () => {
        expect(chatFilesRoot(undefined, "arcterm", registry)).toBe("/w/arcterm");
    });

    it("has no picker outside a registered project", () => {
        expect(chatFilesRoot("/Users/me", undefined, registry)).toBe("");
        expect(chatFilesRoot("/tmp/x", "scratch", registry)).toBe("");
    });
});

describe("fileMentionMatches with recent files", () => {
    const paths = ["README.md", "src/app.ts", "src/app.test.ts", "docs/apple.md", "pkg/main.go"];

    it("lists the recent files first for an empty query, newest first", () => {
        expect(fileMentionMatches("", paths, 3, ["pkg/main.go", "docs/apple.md"])).toEqual([
            "pkg/main.go",
            "docs/apple.md",
            "README.md",
        ]);
    });

    it("puts a recent file the query reaches ahead of a better match that is not recent", () => {
        const got = fileMentionMatches("app", paths, 8, ["docs/apple.md"]);
        expect(got[0]).toBe("docs/apple.md");
        expect(got.slice(1)).toEqual(fileMentionMatches("app", paths).filter((p) => p !== "docs/apple.md"));
    });

    it("never lists a recent file the query does not reach, or one the index no longer has", () => {
        expect(fileMentionMatches("main", paths, 8, ["docs/apple.md", "gone.ts"])).toEqual(["pkg/main.go"]);
        expect(fileMentionMatches("", paths, 8, ["gone.ts"])[0]).toBe("README.md");
    });
});

describe("recentMentionPaths", () => {
    const action = (path?: string): AgentEntry => ({ kind: "action", verb: "Edit", target: "x", path });
    const msg: AgentEntry = { kind: "message", text: "hi" };

    it("lists the files the agent touched under the root, newest first, each once, relative with /", () => {
        const entries = [
            action("D:\\repo\\src\\a.ts"),
            msg,
            action("D:\\repo\\docs\\b.md"),
            action("d:/repo/src/a.ts"),
            action(),
        ];
        expect(recentMentionPaths(entries, "D:\\repo")).toEqual(["src/a.ts", "docs/b.md"]);
    });

    it("skips a file outside the root, and a root that only shares a prefix", () => {
        expect(recentMentionPaths([action("/repo2/x.ts"), action("/other/y.ts")], "/repo/")).toEqual([]);
    });

    it("has none with no entries or no root", () => {
        expect(recentMentionPaths(undefined, "/repo")).toEqual([]);
        expect(recentMentionPaths([action("/repo/x.ts")], "")).toEqual([]);
    });
});

describe("mentionMatchMask", () => {
    const marked = (path: string, query: string) =>
        [...path].map((c, i) => (mentionMatchMask(query, path)[i] ? c : ".")).join("");

    it("marks a run the term matches in the file name before one in the folders", () => {
        expect(marked("app/src/app.ts", "app")).toBe("........app...");
    });

    it("marks a term the folders hold when the name does not", () => {
        expect(marked("docs/readme.md", "docs")).toBe("docs..........");
    });

    it("marks a fuzzy term letter by letter, ignoring case", () => {
        expect(marked("src/CodeStore.ts", "cst")).toBe("....C...St......");
    });

    it("marks every term of a query", () => {
        expect(marked("pkg/usage/stats.go", "usage stats")).toBe("....usage.stats...");
    });

    it("marks nothing for an empty query", () => {
        expect(mentionMatchMask("", "a.ts").some(Boolean)).toBe(false);
    });
});

describe("mentionRuns", () => {
    it("splits a slice of the path into marked and plain runs", () => {
        const mask = mentionMatchMask("app", "src/app.ts");
        expect(mentionRuns("src/app.ts", mask, 4, 10)).toEqual([
            { text: "app", hit: true },
            { text: ".ts", hit: false },
        ]);
        expect(mentionRuns("src/app.ts", mask, 0, 3)).toEqual([{ text: "src", hit: false }]);
    });
});
