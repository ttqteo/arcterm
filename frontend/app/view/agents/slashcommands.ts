// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `/` menu of the chat box (slashmenu.tsx): where a `/` being typed sits, which commands it lists, how it groups
// them, and the text once one is picked. Pure. The list is the one Claude Code's own typeahead shows, which the arc mod
// publishes per agent (`$.command.list()` → pkg/claudecmds/live.go) and `fromLive` reads. With no such list (an agent
// started before the mod published, a sleeping one) the fallback is `BUILTIN_COMMANDS` plus the skills and plugin
// commands wavesrv reads off disk (`ListClaudeCommandsCommand`, pkg/claudecmds). The built-ins' names and descriptions
// are copied from the 2.1.319 binary's command definitions (~/.local/share/claude/versions/2.1.319): `/cost` is that
// version's alias of `/usage`, so it carries `/usage`'s text; `/agents` is gone (hidden, "(removed)"); `/doctor` is a
// prompt there, not a menu; `/review` is no built-in.

export interface SlashCommand {
    /** without the slash; a plugin's is namespaced (`superpowers:brainstorming`) */
    name: string;
    description?: string;
    /** the command opens a menu in Claude Code's own screen: sent bare, the chat box flips to Terminal to answer it */
    tui?: boolean;
    /** `builtin`, `user`, `plugin` and `mcp` come from the live list; `skill` and `command` from the disk fallback */
    source: "builtin" | "user" | "plugin" | "mcp" | "skill" | "command";
    /** the plugin a `plugin` command belongs to, as the live list names it */
    plugin?: string;
}

/** The bare built-ins that draw a menu on Claude Code's own screen. The live list does not say which do, so this stays
 *  a hand list. */
const TUI_NAMES: ReadonlySet<string> = new Set([
    "config",
    "effort",
    "export",
    "help",
    "hooks",
    "login",
    "mcp",
    "memory",
    "model",
    "permissions",
    "plugin",
    "resume",
    "rewind",
    "status",
]);

/** The built-ins whose screen is a panel only Claude Code's own TUI draws (a `local-jsx` command that waits to be closed):
 *  the menus above and the read-only ones (/usage, /stats…). The transcript gets nothing of the panel, only, once it
 *  closes, a "… dismissed" line or what was picked in it. A hand list, like TUI_NAMES. */
const PANEL_NAMES: ReadonlySet<string> = new Set([
    ...TUI_NAMES,
    "agents",
    "context",
    "cost",
    "diff",
    "privacy-settings",
    "skills",
    "stats",
    "tasks",
    "theme",
    "usage",
]);

/** Pure: whether the built-in `name` (no slash) shows a panel in Claude Code's own TUI, which Chat cannot draw. */
export function opensPanel(name: string): boolean {
    return PANEL_NAMES.has(name);
}

const b = (name: string, description: string): SlashCommand => ({
    name,
    description,
    ...(TUI_NAMES.has(name) ? { tui: true } : {}),
    source: "builtin",
});

export const BUILTIN_COMMANDS: SlashCommand[] = [
    b("add-dir", "Add a new working directory"),
    b("clear", "Start a new session with empty context; previous session stays on disk (resumable with /resume)"),
    b("compact", "Free up context by summarizing the conversation so far"),
    b("config", "Open settings"),
    b("context", "Show current context usage"),
    b("cost", "Show session cost, plan usage, and activity stats"),
    b(
        "doctor",
        "Health-check your setup and fix issues: installation, unused extensions, duplicated or bloated memory files, slow hooks, updates, permissions"
    ),
    b("export", "Export the current conversation to a file or clipboard"),
    b("help", "Show help and available commands"),
    b("hooks", "View hook configurations for tool events"),
    b("init", "Initialize a new CLAUDE.md file with codebase documentation"),
    b("login", "Sign in with your Anthropic account"),
    b("logout", "Sign out from your Anthropic account"),
    b("mcp", "Manage MCP servers"),
    b("memory", "Edit CLAUDE.md files and memory settings"),
    b("model", "Set the AI model for Claude Code"),
    b("permissions", "Manage allow and deny tool permission rules"),
    b("plugin", "Manage Claude Code plugins"),
    b("resume", "Resume a previous conversation"),
    b("rewind", "Restore the code and/or conversation to a previous point"),
    b("status", "Show Claude Code status including version, model, account, API connectivity, and tool statuses"),
    b("usage", "Show session cost, plan usage, and activity stats"),
];

const LIVE_SOURCES: ReadonlySet<string> = new Set(["builtin", "user", "plugin", "mcp"]);

/** Pure: the commands of the live list (`CommandInfo[]` from the mod's `$.command.list()`, in the typeahead's order) as
 *  menu entries. A source the list does not know reads as `user`; `tui` is set only for a built-in in `TUI_NAMES`. */
export function fromLive(
    list: { name: string; description?: string; source: string; plugin?: string }[]
): SlashCommand[] {
    return list.map((c) => {
        const source = LIVE_SOURCES.has(c.source) ? (c.source as SlashCommand["source"]) : "user";
        return {
            name: c.name,
            ...(c.description != null ? { description: c.description } : {}),
            ...(source === "builtin" && TUI_NAMES.has(c.name) ? { tui: true } : {}),
            source,
            ...(c.plugin != null ? { plugin: c.plugin } : {}),
        };
    });
}

export type SlashGroup = "Built-in" | "Skills" | "Plugins" | "MCP";

const GROUP_ORDER: SlashGroup[] = ["Built-in", "Skills", "Plugins", "MCP"];

/** Pure: the menu group a command sits in. The disk fallback's `skill` and `command` entries have no plugin field: a
 *  name with a `:` is a plugin's (`superpowers:brainstorming`), one without is the person's own. */
export function groupOf(c: SlashCommand): SlashGroup {
    switch (c.source) {
        case "builtin":
            return "Built-in";
        case "plugin":
            return "Plugins";
        case "mcp":
            return "MCP";
        case "user":
            return "Skills";
        default:
            return c.name.includes(":") ? "Plugins" : "Skills";
    }
}

/** Pure: `items` split into the menu's groups, in the order Built-in, Skills, Plugins, MCP, each in the input's order,
 *  the empty ones dropped. A group's count is its `items.length`. */
export function slashGroups(items: SlashCommand[]): { title: SlashGroup; items: SlashCommand[] }[] {
    const by = new Map<SlashGroup, SlashCommand[]>();
    for (const c of items) {
        const g = groupOf(c);
        const list = by.get(g);
        if (list == null) {
            by.set(g, [c]);
        } else {
            list.push(c);
        }
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ title: g, items: by.get(g)! }));
}

// `/` as the box's first character, then the command's name up to the caret; a `/` anywhere else ("and/or", "src/app",
// a path after a slash command) is text
const SLASH_QUERY = /^\/([^\s/]*)$/u;

/** Pure: the command word being typed after the box's leading `/`, up to the caret ("" for a bare `/`), or null when
 *  the caret is not in one. */
export function slashQueryAt(text: string, caret: number): string | null {
    const found = SLASH_QUERY.exec(text.slice(0, caret));
    return found == null ? null : found[1];
}

/** Pure: the commands to list for `query`, case-insensitively: name-prefix matches first, then names that hold it, each
 *  in the list's order, at most `limit` (every match when none is passed). */
export function slashMatches(query: string, all: SlashCommand[], limit = Infinity): SlashCommand[] {
    const q = query.toLowerCase();
    const prefix: SlashCommand[] = [];
    const inside: SlashCommand[] = [];
    for (const c of all) {
        const name = c.name.toLowerCase();
        if (name.startsWith(q)) {
            prefix.push(c);
        } else if (name.includes(q)) {
            inside.push(c);
        }
    }
    return [...prefix, ...inside].slice(0, limit);
}

/** Pure: `text` with the leading `/word` replaced by `/<name>` and a space (the one that already follows, if any), and
 *  the caret after that space. The rest of the word the caret sits in goes too. */
export function insertSlash(text: string, caret: number, name: string): { text: string; caret: number } {
    const rest = text.slice(caret).replace(/^[^\s]*/u, "");
    const command = `/${name}`;
    return {
        text: command + (rest.startsWith(" ") ? "" : " ") + rest,
        caret: command.length + 1,
    };
}

/** Pure: whether sending `text` makes Claude Code draw a menu or a panel on its own screen, which Chat cannot show:
 *  exactly one `/command` (no argument) that the list marks `tui`, or a built-in panel (PANEL_NAMES). The panels Chat
 *  answers itself (chatlocal.ts) never reach the send. */
export function opensTui(text: string, all: SlashCommand[]): boolean {
    const found = /^\/([^\s]+)$/u.exec(text.trim());
    if (found == null) {
        return false;
    }
    return opensPanel(found[1]) || all.some((c) => c.name === found[1] && c.tui === true);
}

/** Pure: the built-ins, then the fetched skills and commands that no built-in already names. A source the list does
 *  not know reads as a command. */
export function mergeCommands(
    builtin: SlashCommand[],
    fetched: { name: string; description?: string; source: string }[]
): SlashCommand[] {
    const names = new Set(builtin.map((c) => c.name));
    const out = [...builtin];
    for (const f of fetched) {
        if (names.has(f.name)) {
            continue;
        }
        names.add(f.name);
        out.push({ name: f.name, description: f.description, source: f.source === "skill" ? "skill" : "command" });
    }
    return out;
}
