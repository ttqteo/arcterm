import { describe, expect, it } from "vitest";
import {
    BUILTIN_COMMANDS,
    insertSlash,
    mergeCommands,
    opensTui,
    slashMatches,
    slashQueryAt,
    type SlashCommand,
} from "./slashcommands";

describe("slashQueryAt", () => {
    it("reads the word typed after a / at the start of the box", () => {
        expect(slashQueryAt("/comp", 5)).toBe("comp");
        expect(slashQueryAt("/", 1)).toBe("");
        expect(slashQueryAt("/superpowers:brainstorming", 26)).toBe("superpowers:brainstorming");
    });
    it("follows the caret, not the end of the text", () => {
        expect(slashQueryAt("/compact", 4)).toBe("com");
    });
    it("is null for a / inside a sentence or a path", () => {
        expect(slashQueryAt("and/or", 6)).toBeNull();
        expect(slashQueryAt("src/app", 7)).toBeNull();
        expect(slashQueryAt(" /x", 3)).toBeNull();
        expect(slashQueryAt("see /x", 6)).toBeNull();
        expect(slashQueryAt("/src/app", 8)).toBeNull();
    });
    it("is null once the command word is over", () => {
        expect(slashQueryAt("/compact now", 12)).toBeNull();
        expect(slashQueryAt("/compact ", 9)).toBeNull();
    });
});

describe("slashMatches", () => {
    const all: SlashCommand[] = [
        { name: "recount", source: "skill" },
        ...BUILTIN_COMMANDS,
        { name: "git:commit", source: "command" },
    ];
    it("puts name-prefix matches before substring ones", () => {
        const names = slashMatches("co", all).map((c) => c.name);
        expect(names.slice(0, 4)).toEqual(["compact", "config", "context", "cost"]);
        expect(names).toContain("recount");
        expect(names.indexOf("recount")).toBeGreaterThan(names.indexOf("cost"));
    });
    it("caps at the limit", () => {
        expect(slashMatches("", all, 3)).toHaveLength(3);
        expect(slashMatches("", all)).toHaveLength(8);
    });
    it("ignores case and drops what does not match", () => {
        expect(slashMatches("COMPACT", all).map((c) => c.name)).toEqual(["compact"]);
        expect(slashMatches("zzz", all)).toEqual([]);
    });
});

describe("insertSlash", () => {
    it("puts the picked name and a space after the /", () => {
        expect(insertSlash("/comp", 5, "compact")).toEqual({ text: "/compact ", caret: 9 });
    });
    it("replaces the rest of the word the caret sits in", () => {
        expect(insertSlash("/comxx", 4, "compact")).toEqual({ text: "/compact ", caret: 9 });
    });
    it("keeps the space that already follows", () => {
        expect(insertSlash("/co now", 3, "compact")).toEqual({ text: "/compact now", caret: 9 });
    });
});

describe("opensTui", () => {
    const all = BUILTIN_COMMANDS;
    it("is true for a bare menu command", () => {
        expect(opensTui("/model", all)).toBe(true);
        expect(opensTui("/model\n", all)).toBe(true);
    });
    it("is false with an argument, or for a command that prints", () => {
        expect(opensTui("/model opus", all)).toBe(false);
        expect(opensTui("/compact", all)).toBe(false);
        expect(opensTui("/nosuch", all)).toBe(false);
        expect(opensTui("model", all)).toBe(false);
    });
});

describe("mergeCommands", () => {
    it("lists the built-ins first and drops a fetched name the built-ins hold", () => {
        const merged = mergeCommands(BUILTIN_COMMANDS, [
            { name: "compact", description: "x", source: "command" },
            { name: "superpowers:brainstorming", description: "Explore", source: "skill" },
            { name: "git:sync", source: "weird" },
        ]);
        expect(merged.slice(0, BUILTIN_COMMANDS.length)).toEqual(BUILTIN_COMMANDS);
        expect(merged.slice(BUILTIN_COMMANDS.length)).toEqual([
            { name: "superpowers:brainstorming", description: "Explore", source: "skill" },
            { name: "git:sync", description: undefined, source: "command" },
        ]);
    });
});
