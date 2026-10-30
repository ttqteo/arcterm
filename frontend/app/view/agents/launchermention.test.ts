import { describe, expect, it } from "vitest";
import { fileMentionAt, fileMentionMatches, insertFileMention } from "./launchermention";

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
