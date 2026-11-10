// the session's slash commands -> the JSON `wsh claudecmds set` reads on stdin. Chat's `/` menu shows the list
// Claude Code's own typeahead shows (`$.command.list()`: the bundled skills, a mod's commands and MCP prompts
// included, none of which are on disk). kept free of the engine so vitest can run it; register.ts does the call.

// the fields of the engine's CommandInfo that cross to wavesrv; CommandInfo satisfies it
export type CommandEntry = { name: string; description: string; source: string; plugin?: string };

// the list as one JSON string, in the order given (the typeahead's), an entry's fields in a fixed order, so the same
// list is always the same string and register.ts can send only when it changed. `plugin` only when it names one
export function commandsPayload(list: readonly CommandEntry[]): string {
    return JSON.stringify(
        list.map((c) => {
            const entry: CommandEntry = { name: c.name, description: c.description, source: c.source };
            if (typeof c.plugin === "string" && c.plugin !== "") {
                entry.plugin = c.plugin;
            }
            return entry;
        })
    );
}

// the list goes on stdin, not argv: 200 commands run past Windows' 32 K command line
export function claudecmdsArgs(): string[] {
    return ["claudecmds", "set"];
}
