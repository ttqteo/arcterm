import { describe, expect, it } from "vitest";
import {
    filterSessions,
    pickedResume,
    RESUME_LIST_MAX,
    resumeChoices,
    resumeLaunchSpec,
    resumeListKey,
} from "./launcherresume";

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
        const list = Array.from({ length: RESUME_LIST_MAX + 4 }, (_, i) => s({ id: `s${i}`, lastactivets: i }));
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

describe("filterSessions", () => {
    const list = [s({ id: "a", task: "Canvas arrows" }), s({ id: "b", task: "RAM usage" }), s({ id: "c", task: "" })];
    it("keeps the sessions whose title holds the query, any case", () => {
        expect(filterSessions(list, "CANVAS").map((x) => x.id)).toEqual(["a"]);
        expect(filterSessions(list, "  ").map((x) => x.id)).toEqual(["a", "b", "c"]);
    });
    it("reads an untitled session by the title it shows", () => {
        expect(filterSessions(list, "untitled").map((x) => x.id)).toEqual(["c"]);
    });
});

describe("resumeListKey", () => {
    const at = (rows: number, filter = "") => ({ rows, filter });
    const key = (k: string, mod = false) => ({ key: k, mod });
    it("a digit picks the nth visible row, 1 for New session", () => {
        expect(resumeListKey(key("1"), at(3))).toEqual({ kind: "pick", index: 0 });
        expect(resumeListKey(key("3"), at(3))).toEqual({ kind: "pick", index: 2 });
        expect(resumeListKey(key("4"), at(3))).toEqual({ kind: "none" });
        expect(resumeListKey(key("0"), at(3))).toEqual({ kind: "none" });
    });
    it("arrows move, and ← steps back to Project", () => {
        expect(resumeListKey(key("ArrowDown"), at(3))).toEqual({ kind: "move", delta: 1 });
        expect(resumeListKey(key("ArrowUp"), at(3))).toEqual({ kind: "move", delta: -1 });
        expect(resumeListKey(key("ArrowLeft"), at(3))).toEqual({ kind: "back" });
    });
    it("letters build the filter, Backspace shortens it, Escape clears it before it closes anything", () => {
        expect(resumeListKey(key("c"), at(3))).toEqual({ kind: "filter", next: "c" });
        expect(resumeListKey(key(" "), at(3, "ram"))).toEqual({ kind: "filter", next: "ram " });
        expect(resumeListKey(key("Backspace"), at(3, "ram"))).toEqual({ kind: "filter", next: "ra" });
        expect(resumeListKey(key("Backspace"), at(3))).toEqual({ kind: "none" });
        expect(resumeListKey(key("Escape"), at(3, "ram"))).toEqual({ kind: "filter", next: "" });
        expect(resumeListKey(key("Escape"), at(3))).toEqual({ kind: "none" });
    });
    it("Enter, a modified key and a named key are the dialog's", () => {
        expect(resumeListKey(key("Enter"), at(3))).toEqual({ kind: "none" });
        expect(resumeListKey(key("v", true), at(3))).toEqual({ kind: "none" });
        expect(resumeListKey(key("Process"), at(3))).toEqual({ kind: "none" });
        expect(resumeListKey(key(" "), at(3))).toEqual({ kind: "none" });
    });
});
