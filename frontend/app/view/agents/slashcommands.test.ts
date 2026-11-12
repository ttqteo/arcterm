import { describe, expect, it } from "vitest";
import {
    BUILTIN_COMMANDS,
    fromLive,
    groupOf,
    insertSlash,
    mergeCommands,
    opensPanel,
    opensTui,
    pickAction,
    slashGroups,
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
    it("caps at a limit when one is passed", () => {
        expect(slashMatches("", all, 3)).toHaveLength(3);
        expect(slashMatches("", all, 3).map((c) => c.name)).toEqual(["recount", "add-dir", "clear"]);
    });
    it("lists every match when no limit is passed", () => {
        expect(slashMatches("", all)).toHaveLength(all.length);
    });
    it("puts prefix matches first among an unlimited list", () => {
        const many: SlashCommand[] = [
            { name: "zz-re", source: "user" },
            ...Array.from({ length: 20 }, (_, i): SlashCommand => ({ name: `a${i}-re`, source: "user" })),
            { name: "release-notes", source: "builtin" },
            { name: "review", source: "builtin" },
        ];
        const names = slashMatches("re", many).map((c) => c.name);
        expect(names).toHaveLength(23);
        expect(names.slice(0, 2)).toEqual(["release-notes", "review"]);
        expect(names[2]).toBe("zz-re");
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
    it("is true for a bare panel command, even one no list carries", () => {
        expect(opensTui("/theme", all)).toBe(true);
        expect(opensTui("/privacy-settings", [])).toBe(true);
    });
    it("is false with an argument, or for a command that prints", () => {
        expect(opensTui("/model opus", all)).toBe(false);
        expect(opensTui("/compact", all)).toBe(false);
        expect(opensTui("/nosuch", all)).toBe(false);
        expect(opensTui("model", all)).toBe(false);
    });
});

describe("opensPanel", () => {
    it("is true for a command whose screen is a panel of Claude Code's own", () => {
        for (const name of [
            "config",
            "permissions",
            "hooks",
            "resume",
            "memory",
            "status",
            "usage",
            "model",
            "login",
        ]) {
            expect(opensPanel(name)).toBe(true);
        }
    });
    it("is false for one that prints or runs a prompt", () => {
        for (const name of ["compact", "clear", "goal", "init", "superpowers:brainstorming"]) {
            expect(opensPanel(name)).toBe(false);
        }
    });
});

describe("fromLive", () => {
    it("maps each source and keeps the plugin", () => {
        const out = fromLive([
            { name: "compact", description: "Free up context", source: "builtin" },
            { name: "my-skill", description: "Mine", source: "user" },
            { name: "superpowers:brainstorming", description: "Explore", source: "plugin", plugin: "superpowers" },
            { name: "mcp__github__pr", source: "mcp" },
        ]);
        expect(out).toEqual([
            { name: "compact", description: "Free up context", source: "builtin" },
            { name: "my-skill", description: "Mine", source: "user" },
            { name: "superpowers:brainstorming", description: "Explore", source: "plugin", plugin: "superpowers" },
            { name: "mcp__github__pr", source: "mcp" },
        ]);
    });
    it("reads an unknown source as user", () => {
        expect(fromLive([{ name: "x", source: "weird" }])).toEqual([{ name: "x", source: "user" }]);
    });
    it("marks tui only for a builtin that opens a menu", () => {
        const out = fromLive([
            { name: "model", source: "builtin" },
            { name: "effort", source: "builtin" },
            { name: "compact", source: "builtin" },
            { name: "model", source: "user" },
            { name: "model", source: "plugin", plugin: "p" },
        ]);
        expect(out.map((c) => c.tui === true)).toEqual([true, true, false, false, false]);
    });
    it("marks every built-in the copied list marks tui, and no other", () => {
        const copied = BUILTIN_COMMANDS.filter((c) => c.tui).map((c) => c.name);
        const live = fromLive(BUILTIN_COMMANDS.map((c) => ({ name: c.name, source: "builtin" })));
        expect(copied.length).toBeGreaterThan(0);
        expect(live.filter((c) => c.tui).map((c) => c.name)).toEqual(copied);
    });
});

describe("groupOf", () => {
    it("groups each live source", () => {
        expect(groupOf({ name: "compact", source: "builtin" })).toBe("Built-in");
        expect(groupOf({ name: "my-skill", source: "user" })).toBe("Skills");
        expect(groupOf({ name: "p:cmd", source: "plugin" })).toBe("Plugins");
        expect(groupOf({ name: "mcp__s__p", source: "mcp" })).toBe("MCP");
    });
    it("puts a built-in that inChat names in In Chat, and nothing else", () => {
        const inChat = (name: string) => name === "usage" || name === "status";
        expect(groupOf({ name: "usage", source: "builtin" }, inChat)).toBe("In Chat");
        expect(groupOf({ name: "status", source: "builtin", tui: true }, inChat)).toBe("In Chat");
        expect(groupOf({ name: "compact", source: "builtin" }, inChat)).toBe("Built-in");
        // a skill or plugin that happens to share the name is not Chat's to answer
        expect(groupOf({ name: "usage", source: "user" }, inChat)).toBe("Skills");
        expect(groupOf({ name: "usage", source: "builtin" })).toBe("Built-in");
    });
    it("groups the fallback's disk entries by their colon", () => {
        expect(groupOf({ name: "my-skill", source: "skill" })).toBe("Skills");
        expect(groupOf({ name: "my-cmd", source: "command" })).toBe("Skills");
        expect(groupOf({ name: "superpowers:brainstorming", source: "skill" })).toBe("Plugins");
        expect(groupOf({ name: "git:sync", source: "command" })).toBe("Plugins");
    });
});

describe("pickAction", () => {
    const inChat = (name: string) => name === "context";
    it("runs a command Chat answers itself on a click or Enter", () => {
        expect(pickAction({ name: "context", source: "builtin" }, "pick", inChat)).toBe("run");
    });
    it("puts it in the box on Tab, and puts every other command in the box", () => {
        expect(pickAction({ name: "context", source: "builtin" }, "complete", inChat)).toBe("insert");
        expect(pickAction({ name: "compact", source: "builtin" }, "pick", inChat)).toBe("insert");
        expect(pickAction({ name: "context", source: "user" }, "pick", inChat)).toBe("insert");
        expect(pickAction({ name: "context", source: "builtin" }, "pick")).toBe("insert");
    });
});

describe("slashGroups", () => {
    const items: SlashCommand[] = [
        { name: "mcp__s__a", source: "mcp" },
        { name: "p:one", source: "plugin" },
        { name: "skill-b", source: "user" },
        { name: "clear", source: "builtin" },
        { name: "skill-a", source: "user" },
        { name: "compact", source: "builtin" },
        { name: "p:two", source: "plugin" },
    ];
    it("orders the groups Built-in, Skills, Plugins, MCP and counts each", () => {
        const groups = slashGroups(items);
        expect(groups.map((g) => g.title)).toEqual(["Built-in", "Skills", "Plugins", "MCP"]);
        expect(groups.map((g) => g.items.length)).toEqual([2, 2, 2, 1]);
    });
    it("lists In Chat first when inChat names some built-ins", () => {
        const groups = slashGroups(items, (name) => name === "compact");
        expect(groups.map((g) => g.title)).toEqual(["In Chat", "Built-in", "Skills", "Plugins", "MCP"]);
        expect(groups[0].items.map((c) => c.name)).toEqual(["compact"]);
        expect(groups[1].items.map((c) => c.name)).toEqual(["clear"]);
    });
    it("keeps the input order inside a group", () => {
        const groups = slashGroups(items);
        expect(groups[0].items.map((c) => c.name)).toEqual(["clear", "compact"]);
        expect(groups[1].items.map((c) => c.name)).toEqual(["skill-b", "skill-a"]);
        expect(groups[2].items.map((c) => c.name)).toEqual(["p:one", "p:two"]);
    });
    it("drops the groups that are empty", () => {
        const groups = slashGroups([{ name: "x", source: "user" }]);
        expect(groups.map((g) => g.title)).toEqual(["Skills"]);
        expect(slashGroups([])).toEqual([]);
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
