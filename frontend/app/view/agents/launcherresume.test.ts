import { describe, expect, it } from "vitest";
import { pickedResume, RESUME_LIST_MAX, resumeChoices, resumeLaunchSpec } from "./launcherresume";

function s(over: Partial<SessionInfo>): SessionInfo {
    return {
        id: "a",
        runtime: "claude",
        projectpath: "D:\\x\\proj",
        projectname: "proj",
        branch: "main",
        task: "t",
        model: "",
        tokenstotal: 0,
        lastactivets: 1,
        resumecommand: "claude --resume a",
        transcriptpath: "",
        ...over,
    };
}

describe("resumeChoices", () => {
    it("keeps the picked runtime's sessions in the picked project, newest first", () => {
        const list = [
            s({ id: "old", lastactivets: 1 }),
            s({ id: "new", lastactivets: 9 }),
            s({ id: "codex", runtime: "codex" }),
            s({ id: "other", projectpath: "D:\\x\\other" }),
        ];
        expect(resumeChoices(list, "claude", "D:\\x\\proj").map((x) => x.id)).toEqual(["new", "old"]);
    });
    it("matches a path across separators, case and a trailing slash", () => {
        expect(resumeChoices([s({})], "claude", "d:/x/proj/").map((x) => x.id)).toEqual(["a"]);
    });
    it("caps the list", () => {
        const list = Array.from({ length: 9 }, (_, i) => s({ id: `s${i}`, lastactivets: i }));
        expect(resumeChoices(list, "claude", "D:\\x\\proj")).toHaveLength(RESUME_LIST_MAX);
    });
    it("offers nothing for a terminal, no project, or sessions not loaded", () => {
        expect(resumeChoices([s({})], "terminal", "D:\\x\\proj")).toEqual([]);
        expect(resumeChoices([s({})], "claude", "")).toEqual([]);
        expect(resumeChoices(null, "claude", "D:\\x\\proj")).toEqual([]);
    });
});

describe("pickedResume", () => {
    it("returns the picked session while it is a choice", () => {
        expect(pickedResume([s({})], "a")?.id).toBe("a");
    });
    it("returns null for an id not among the choices", () => {
        expect(pickedResume([s({})], "gone")).toBeNull();
        expect(pickedResume([s({})], null)).toBeNull();
    });
});

describe("resumeLaunchSpec", () => {
    it("adds the enabled flags to the resume command", () => {
        expect(resumeLaunchSpec(s({}), "claude", { "skip-permissions": true })).toEqual({
            startupCommand: "claude --resume a --dangerously-skip-permissions",
        });
    });
    it("drops the continue flag", () => {
        expect(resumeLaunchSpec(s({}), "claude", { continue: true }).startupCommand).toBe("claude --resume a");
    });
    it("resumes pi by its exact argv and transcript path", () => {
        const pi = s({
            runtime: "pi",
            resumecommand: "pi --session C:\\a b\\t.jsonl",
            resumeargs: ["--session", "C:\\a b\\t.jsonl"],
            transcriptpath: "C:\\a b\\t.jsonl",
        });
        expect(resumeLaunchSpec(pi, "pi", {})).toEqual({
            startupCommand: "pi --session C:\\a b\\t.jsonl",
            startupArgs: ["--session", "C:\\a b\\t.jsonl"],
            resumePath: "C:\\a b\\t.jsonl",
        });
    });
});
