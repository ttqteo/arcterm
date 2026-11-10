import { describe, expect, it } from "vitest";
import { claudecmdsArgs, commandsPayload } from "./commands-core";

describe("commandsPayload", () => {
    it("keeps each command's name, description and source, in the list's order", () => {
        const payload = commandsPayload([
            { name: "help", description: "Show help", source: "builtin" },
            { name: "skim", description: "Toggle the skim", source: "plugin" },
            { name: "deploy", description: "Ship it", source: "user" },
            { name: "mcp__linear__issue", description: "File an issue", source: "mcp" },
        ]);
        expect(JSON.parse(payload)).toEqual([
            { name: "help", description: "Show help", source: "builtin" },
            { name: "skim", description: "Toggle the skim", source: "plugin" },
            { name: "deploy", description: "Ship it", source: "user" },
            { name: "mcp__linear__issue", description: "File an issue", source: "mcp" },
        ]);
    });

    it("carries the plugin only when it is a non-empty string", () => {
        const parsed = JSON.parse(
            commandsPayload([
                { name: "a", description: "", source: "plugin", plugin: "arc" },
                { name: "b", description: "", source: "plugin", plugin: "" },
                { name: "c", description: "", source: "plugin" },
                { name: "d", description: "", source: "builtin", plugin: undefined },
            ])
        );
        expect(parsed[0]).toEqual({ name: "a", description: "", source: "plugin", plugin: "arc" });
        expect(parsed[1]).toEqual({ name: "b", description: "", source: "plugin" });
        expect("plugin" in parsed[1]).toBe(false);
        expect("plugin" in parsed[2]).toBe(false);
        expect("plugin" in parsed[3]).toBe(false);
    });

    it("drops fields the wire does not carry", () => {
        const payload = commandsPayload([
            { name: "help", description: "Show help", source: "builtin", hidden: true, aliases: ["h"] } as never,
        ]);
        expect(JSON.parse(payload)).toEqual([{ name: "help", description: "Show help", source: "builtin" }]);
    });

    it("is the same string for the same list, whatever order the entry's keys came in", () => {
        const a = commandsPayload([{ name: "x", description: "d", source: "user" }]);
        const b = commandsPayload([{ source: "user", description: "d", name: "x" }]);
        expect(a).toBe(b);
    });

    it("is an empty list for no commands", () => {
        expect(commandsPayload([])).toBe("[]");
    });
});

describe("claudecmdsArgs", () => {
    it("is the hidden `wsh claudecmds set` subcommand", () => {
        expect(claudecmdsArgs()).toEqual(["claudecmds", "set"]);
    });
});
