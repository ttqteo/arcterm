// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `/` menu of the chat box (slashmenu.tsx): where a `/` being typed sits, which commands it lists, and the text once
// one is picked. Pure. The list is Claude Code's built-in commands plus the skills and plugin commands wavesrv reads
// off disk (`ListClaudeCommandsCommand`, pkg/claudecmds). The built-ins' names and descriptions are copied from the
// 2.1.319 binary's command definitions (~/.local/share/claude/versions/2.1.319): `/cost` is that version's alias of
// `/usage`, so it carries `/usage`'s text; `/agents` is gone (hidden, "(removed)"); `/doctor` is a prompt there, not
// a menu; `/review` is no built-in.

export const SLASH_LIMIT = 8;

export interface SlashCommand {
    /** without the slash; a plugin's is namespaced (`superpowers:brainstorming`) */
    name: string;
    description?: string;
    /** the command opens a menu in Claude Code's own screen: sent bare, the chat box flips to Terminal to answer it */
    tui?: boolean;
    source: "builtin" | "skill" | "command";
}

const b = (name: string, description: string, tui = false): SlashCommand => ({
    name,
    description,
    ...(tui ? { tui: true } : {}),
    source: "builtin",
});

export const BUILTIN_COMMANDS: SlashCommand[] = [
    b("add-dir", "Add a new working directory"),
    b("clear", "Start a new session with empty context; previous session stays on disk (resumable with /resume)"),
    b("compact", "Free up context by summarizing the conversation so far"),
    b("config", "Open settings", true),
    b("context", "Show current context usage"),
    b("cost", "Show session cost, plan usage, and activity stats"),
    b(
        "doctor",
        "Health-check your setup and fix issues: installation, unused extensions, duplicated or bloated memory files, slow hooks, updates, permissions"
    ),
    b("export", "Export the current conversation to a file or clipboard", true),
    b("help", "Show help and available commands", true),
    b("hooks", "View hook configurations for tool events", true),
    b("init", "Initialize a new CLAUDE.md file with codebase documentation"),
    b("login", "Sign in with your Anthropic account", true),
    b("logout", "Sign out from your Anthropic account"),
    b("mcp", "Manage MCP servers", true),
    b("memory", "Edit CLAUDE.md files and memory settings", true),
    b("model", "Set the AI model for Claude Code", true),
    b("permissions", "Manage allow and deny tool permission rules", true),
    b("plugin", "Manage Claude Code plugins", true),
    b("resume", "Resume a previous conversation", true),
    b("rewind", "Restore the code and/or conversation to a previous point", true),
    b("status", "Show Claude Code status including version, model, account, API connectivity, and tool statuses", true),
    b("usage", "Show session cost, plan usage, and activity stats"),
];

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
 *  in the list's order, at most `limit`. */
export function slashMatches(query: string, all: SlashCommand[], limit = SLASH_LIMIT): SlashCommand[] {
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

/** Pure: whether sending `text` makes Claude Code draw a menu to answer on its own screen: exactly one `/command`
 *  (no argument) that the list marks `tui`. */
export function opensTui(text: string, all: SlashCommand[]): boolean {
    const found = /^\/([^\s]+)$/u.exec(text.trim());
    if (found == null) {
        return false;
    }
    return all.some((c) => c.name === found[1] && c.tui === true);
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
