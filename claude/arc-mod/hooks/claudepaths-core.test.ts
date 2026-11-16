import { describe, expect, it } from "vitest";
import { claudeConfigDir, memoryDir, transcriptFile } from "./claudepaths-core";

describe("memoryDir", () => {
    it("names the project folder claude does: every non-alphanumeric of the cwd a dash", () => {
        expect(memoryDir("C:\\Users\\u\\.claude", "D:\\work\\arcterm")).toBe("C:\\Users\\u\\.claude/projects/D--work-arcterm/memory");
        expect(memoryDir("/Users/u/.claude/", "/Users/u/my.repo")).toBe("/Users/u/.claude/projects/-Users-u-my-repo/memory");
    });

    it("takes CLAUDE_CONFIG_DIR over the home's .claude", () => {
        expect(claudeConfigDir({ configDir: "/cfg", home: "/Users/u" })).toBe("/cfg");
        expect(claudeConfigDir({ home: "C:\\Users\\u\\" })).toBe("C:\\Users\\u/.claude");
        expect(claudeConfigDir({})).toBeNull();
    });
});

describe("transcriptFile", () => {
    it("is the session's jsonl in the project folder", () => {
        expect(transcriptFile("/Users/u/.claude/", "/Users/u/my.repo", "abc-123")).toBe(
            "/Users/u/.claude/projects/-Users-u-my-repo/abc-123.jsonl"
        );
    });

    // the path is the one Claude Code's hooks report, to the byte: the cockpit keys the conversation on it, and a second
    // spelling of the same file read as another transcript, so an interrupt reloaded the whole chat
    it("is spelled as Claude Code's hooks spell it on Windows, every separator a backslash", () => {
        expect(transcriptFile("C:\\Users\\u\\.claude", "D:\\work\\arcterm", "abc-123")).toBe(
            "C:\\Users\\u\\.claude\\projects\\D--work-arcterm\\abc-123.jsonl"
        );
        expect(transcriptFile("C:/Users/u/.claude/", "D:\\work\\arcterm", "abc-123")).toBe(
            "C:\\Users\\u\\.claude\\projects\\D--work-arcterm\\abc-123.jsonl"
        );
    });
});
