import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import { mentionTokens } from "./filementiontokens";
import {
    browseMatches,
    browseQuery,
    chatFilesRoot,
    fileMentionAt,
    fileMentionMatches,
    insertBrowsePick,
    insertFileMention,
    mentionMatchMask,
    mentionRuns,
    recentMentionPaths,
    resolveBrowseDir,
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

    it("keeps a folder walk's roots whole: a drive, a backslash, home, a parent", () => {
        expect(fileMentionAt("see @D:/", 8)).toEqual({ start: 4, query: "D:/" });
        expect(fileMentionAt("see @D:\\x\\", 10)).toEqual({ start: 4, query: "D:\\x\\" });
        expect(fileMentionAt("@~/", 3)).toEqual({ start: 0, query: "~/" });
        expect(fileMentionAt("@../src/ap", 10)).toEqual({ start: 0, query: "../src/ap" });
        expect(fileMentionAt("@/etc/", 6)).toEqual({ start: 0, query: "/etc/" });
    });

    it('reads an @" mention up to the caret, whitespace included, without the quote', () => {
        const text = 'see @"../my dir/fo';
        expect(fileMentionAt(text, text.length)).toEqual({ start: 4, query: "../my dir/fo" });
        expect(fileMentionAt('@"', 2)).toEqual({ start: 0, query: "" });
        expect(fileMentionAt('@"my fi', 7)).toEqual({ start: 0, query: "my fi" });
        expect(fileMentionAt('a\n(@"x y', 8)).toEqual({ start: 3, query: "x y" });
    });

    it('ends an @" mention at a closing quote: one closed before the caret is not a mention at the caret', () => {
        expect(fileMentionAt('@"a b" x', 8)).toBeNull();
        expect(fileMentionAt('@"a b"', 6)).toBeNull();
        expect(fileMentionAt('@"a b" and @"c d', 16)).toEqual({ start: 11, query: "c d" });
    });

    it('ends an @" mention at a newline', () => {
        expect(fileMentionAt('@"a b\nc d', 9)).toBeNull();
    });

    it('keeps an @" mention to 200 characters', () => {
        expect(fileMentionAt(`@"${"a".repeat(200)}`, 202)).toEqual({ start: 0, query: "a".repeat(200) });
        expect(fileMentionAt(`@"${"a".repeat(201)}`, 203)).toBeNull();
    });

    it("leaves the quote form of an email, or of a word with a quote in it, as text", () => {
        expect(fileMentionAt('me@"example.com', 15)).toBeNull();
        expect(fileMentionAt('a@"b', 4)).toBeNull();
        expect(fileMentionAt('say a@"b c', 10)).toBeNull();
    });

    it("lets an @ typed after an open quote be the mention being typed", () => {
        expect(fileMentionAt('@"a b @c', 8)).toEqual({ start: 6, query: "c" });
    });
});

describe("browseQuery", () => {
    it("splits a path that starts at a root into the folder and the name typed in it", () => {
        expect(browseQuery("../")).toEqual({ dir: "../", leaf: "" });
        expect(browseQuery("../src/ap")).toEqual({ dir: "../src/", leaf: "ap" });
        expect(browseQuery("./")).toEqual({ dir: "./", leaf: "" });
        expect(browseQuery("./src/ap")).toEqual({ dir: "./src/", leaf: "ap" });
        expect(browseQuery("~/")).toEqual({ dir: "~/", leaf: "" });
        expect(browseQuery("~/docs/no")).toEqual({ dir: "~/docs/", leaf: "no" });
        expect(browseQuery("D:/x/")).toEqual({ dir: "D:/x/", leaf: "" });
        expect(browseQuery("D:/x/re")).toEqual({ dir: "D:/x/", leaf: "re" });
        expect(browseQuery("/etc/")).toEqual({ dir: "/etc/", leaf: "" });
        expect(browseQuery("/etc/ho")).toEqual({ dir: "/etc/", leaf: "ho" });
    });

    it("reads a backslash as a separator", () => {
        expect(browseQuery("D:\\x\\")).toEqual({ dir: "D:\\x\\", leaf: "" });
        expect(browseQuery("D:\\x\\re")).toEqual({ dir: "D:\\x\\", leaf: "re" });
        expect(browseQuery("..\\src\\")).toEqual({ dir: "..\\src\\", leaf: "" });
    });

    it("takes a drive or the filesystem root alone as a folder", () => {
        expect(browseQuery("D:/")).toEqual({ dir: "D:/", leaf: "" });
        expect(browseQuery("/")).toEqual({ dir: "/", leaf: "" });
        expect(browseQuery("/et")).toEqual({ dir: "/", leaf: "et" });
    });

    it("leaves a project-relative query to the project's own ranking", () => {
        expect(browseQuery("src/ap")).toBeNull();
        expect(browseQuery("foo")).toBeNull();
        expect(browseQuery("")).toBeNull();
    });

    it("needs the separator: a bare .., . or ~ is still a name being typed", () => {
        expect(browseQuery("..")).toBeNull();
        expect(browseQuery(".git")).toBeNull();
        expect(browseQuery("~")).toBeNull();
    });
});

describe("resolveBrowseDir", () => {
    it("joins a relative folder onto the base", () => {
        expect(resolveBrowseDir("/w/arcterm", "src/", "/Users/q")).toBe("/w/arcterm/src");
        expect(resolveBrowseDir("/w/arcterm", "./", "/Users/q")).toBe("/w/arcterm");
    });

    it("steps up on ..", () => {
        expect(resolveBrowseDir("/w/arcterm", "../", "/Users/q")).toBe("/w");
        expect(resolveBrowseDir("/w/arcterm", "../../", "/Users/q")).toBe("/");
        expect(resolveBrowseDir("/w/arcterm", "../other/src/", "/Users/q")).toBe("/w/other/src");
    });

    it("reads ~ as home", () => {
        expect(resolveBrowseDir("/w/arcterm", "~/", "/Users/q")).toBe("/Users/q");
        expect(resolveBrowseDir("/w/arcterm", "~/docs/", "/Users/q")).toBe("/Users/q/docs");
    });

    it("ignores the base for an absolute folder, a drive or a backslash path", () => {
        expect(resolveBrowseDir("/w/arcterm", "/etc/", "/Users/q")).toBe("/etc");
        expect(resolveBrowseDir("C:/w/arcterm", "D:/x/", "C:/Users/q")).toBe("D:/x");
        expect(resolveBrowseDir("C:/w/arcterm", "D:\\x\\y\\", "C:/Users/q")).toBe("D:/x/y");
        expect(resolveBrowseDir("C:/w/arcterm", "D:/", "C:/Users/q")).toBe("D:/");
    });

    it("walks a Windows base with forward slashes", () => {
        expect(resolveBrowseDir("C:\\w\\arcterm", "..\\", "C:\\Users\\q")).toBe("C:/w");
        expect(resolveBrowseDir("C:\\w\\arcterm", "src/", "C:\\Users\\q")).toBe("C:/w/arcterm/src");
    });

    it("cannot place a relative folder with no base, or ~ with no home", () => {
        expect(resolveBrowseDir("", "../", "/Users/q")).toBeNull();
        expect(resolveBrowseDir("/w/arcterm", "~/", "")).toBeNull();
    });
});

describe("browseMatches", () => {
    const dir = (name: string) => ({ name, isdir: true });
    const file = (name: string) => ({ name, isdir: false });
    const names = (entries: { name?: string; isdir?: boolean }[]) => entries.map((e) => e.name);

    it("lists folders first, then files, each alphabetical regardless of case", () => {
        const got = browseMatches(
            [file("b.ts"), dir("src"), file("A.md"), dir("Docs"), file("c.go"), dir("assets")],
            ""
        );
        expect(names(got)).toEqual(["assets", "Docs", "src", "A.md", "b.ts", "c.go"]);
    });

    it("puts prefix matches before names that only contain the leaf, within folders and within files", () => {
        const got = browseMatches(
            [file("my-app.ts"), file("app.ts"), dir("snap"), dir("app-core"), dir("map"), file("Apple.md")],
            "ap"
        );
        expect(names(got)).toEqual(["app-core", "map", "snap", "app.ts", "Apple.md", "my-app.ts"]);
    });

    it("matches the leaf in any case and drops the rest", () => {
        const got = browseMatches([file("README.md"), file("notes.md"), dir("readme-assets")], "READ");
        expect(names(got)).toEqual(["readme-assets", "README.md"]);
    });

    it("hides dot-names unless the leaf starts with a dot", () => {
        const entries = [dir(".git"), dir("src"), file(".env"), file("env.ts")];
        expect(names(browseMatches(entries, ""))).toEqual(["src", "env.ts"]);
        expect(names(browseMatches(entries, "e"))).toEqual(["env.ts"]);
        // a bare "." also appears inside env.ts: contains-matches come after the dot-names that start with it
        expect(names(browseMatches(entries, "."))).toEqual([".git", ".env", "env.ts"]);
        expect(names(browseMatches(entries, ".g"))).toEqual([".git"]);
    });

    it("shows at most 50", () => {
        const many = Array.from({ length: 80 }, (_, i) => file(`f${String(i).padStart(2, "0")}.txt`));
        const got = browseMatches(many, "");
        expect(got).toHaveLength(50);
        expect(got[0].name).toBe("f00.txt");
    });

    it("skips an entry with no name and leaves the input alone", () => {
        const entries = [{ isdir: false }, file("a.ts")];
        expect(names(browseMatches(entries, ""))).toEqual(["a.ts"]);
        expect(entries).toHaveLength(2);
    });
});

describe("insertBrowsePick", () => {
    it("writes a folder as @<dir><name>/ with no space and the caret after it", () => {
        expect(insertBrowsePick("fix @../sr", 4, 10, "../", { name: "src", isdir: true })).toEqual({
            text: "fix @../src/",
            caret: 12,
        });
    });

    it("steps into the folder it just wrote: the next pick builds on it", () => {
        const first = insertBrowsePick("@../", 0, 4, "../", { name: "src", isdir: true });
        expect(first).toEqual({ text: "@../src/", caret: 8 });
        expect(insertBrowsePick(first.text, 0, first.caret, "../src/", { name: "app", isdir: true })).toEqual({
            text: "@../src/app/",
            caret: 12,
        });
    });

    it("writes a file as @<dir><name> and a space, as the project picker does", () => {
        expect(insertBrowsePick("fix @~/do", 4, 9, "~/", { name: "notes.md", isdir: false })).toEqual({
            text: "fix @~/notes.md ",
            caret: 16,
        });
        expect(insertBrowsePick("@D:/x/re", 0, 8, "D:/x/", { name: "readme.md", isdir: false })).toEqual(
            insertFileMention("@D:/x/re", 0, 8, "D:/x/readme.md")
        );
    });

    it("keeps the dir as typed, backslashes included", () => {
        expect(insertBrowsePick("@D:\\x\\", 0, 6, "D:\\x\\", { name: "src", isdir: true })).toEqual({
            text: "@D:\\x\\src/",
            caret: 10,
        });
    });

    it("swallows the rest of the word the caret sits in, and keeps what follows", () => {
        expect(insertBrowsePick("@../sXXX then", 0, 5, "../", { name: "src", isdir: true })).toEqual({
            text: "@../src/ then",
            caret: 8,
        });
    });

    it("quotes a file whose path holds whitespace, closing the quote and ending with a space", () => {
        expect(insertBrowsePick("@../", 0, 4, "../", { name: "my file.txt", isdir: false })).toEqual({
            text: '@"../my file.txt" ',
            caret: 18,
        });
    });

    it("opens a quote for a folder whose path holds whitespace, the caret at its end so the walk goes on", () => {
        const next = insertBrowsePick("@../", 0, 4, "../", { name: "my dir", isdir: true });
        expect(next).toEqual({ text: '@"../my dir/', caret: 12 });
        const mention = fileMentionAt(next.text, next.caret);
        expect(mention).toEqual({ start: 0, query: "../my dir/" });
        expect(browseQuery(mention!.query)).toEqual({ dir: "../my dir/", leaf: "" });
    });

    it("keeps a folder quoted inside an open quote, even when its own name has no whitespace", () => {
        expect(insertBrowsePick('@"../my dir/', 0, 12, "../my dir/", { name: "sub", isdir: true })).toEqual({
            text: '@"../my dir/sub/',
            caret: 16,
        });
    });

    it("closes the quote on a file picked inside an open quote", () => {
        expect(insertBrowsePick('@"../my dir/', 0, 12, "../my dir/", { name: "a.ts", isdir: false })).toEqual({
            text: '@"../my dir/a.ts" ',
            caret: 18,
        });
        expect(insertBrowsePick('fix @"../my dir/a', 4, 17, "../my dir/", { name: "a.ts", isdir: false })).toEqual({
            text: 'fix @"../my dir/a.ts" ',
            caret: 22,
        });
    });

    it("walks on in a quoted folder: a pick, then the next pick, builds on the quoted path", () => {
        const first = insertBrowsePick("@../", 0, 4, "../", { name: "my dir", isdir: true });
        const mention = fileMentionAt(first.text, first.caret)!;
        const dir = browseQuery(mention.query)!.dir;
        const second = insertBrowsePick(first.text, mention.start, first.caret, dir, { name: "a b.ts", isdir: false });
        expect(second.text).toBe('@"../my dir/a b.ts" ');
        expect(mentionTokens(second.text)).toEqual([{ start: 0, end: 19, path: "../my dir/a b.ts" }]);
    });

    it("leaves what follows an open-quote folder pick alone when no quote closes after the caret", () => {
        expect(insertBrowsePick('@"../my dir/s later', 0, 13, "../my dir/", { name: "sub", isdir: true })).toEqual({
            text: '@"../my dir/sub/ later',
            caret: 16,
        });
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

    it("writes a path with whitespace quoted, as the box writes a pill, so it reads as one mention", () => {
        const next = insertFileMention("fix @my", 4, 7, "src/my file.txt");
        expect(next).toEqual({ text: 'fix @"src/my file.txt" ', caret: 23 });
        expect(mentionTokens(next.text)).toEqual([{ start: 4, end: 22, path: "src/my file.txt" }]);
    });

    it("writes a path without whitespace unquoted", () => {
        expect(insertFileMention("@ap", 0, 3, "src/app.ts").text).toBe("@src/app.ts ");
    });

    it('replaces an @" word the caret is typing in, quote included', () => {
        expect(insertFileMention('see @"my fi', 4, 11, "src/my file.txt")).toEqual({
            text: 'see @"src/my file.txt" ',
            caret: 23,
        });
        expect(insertFileMention('see @"my fi', 4, 11, "src/app.ts")).toEqual({ text: "see @src/app.ts ", caret: 16 });
    });

    it("swallows the rest of a quoted mention up to its closing quote", () => {
        expect(insertFileMention('@"../my d|ir/a.ts" next'.replace("|", ""), 0, 9, "x/y z.ts")).toEqual({
            text: '@"x/y z.ts" next',
            caret: 12,
        });
    });

    it('does not swallow a line that follows an @" with no closing quote', () => {
        expect(insertFileMention('@"my fi later', 0, 7, "a.ts")).toEqual({ text: "@a.ts later", caret: 6 });
        expect(insertFileMention('@"my fi\nlater "x"', 0, 7, "a.ts")).toEqual({ text: '@a.ts \nlater "x"', caret: 6 });
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
