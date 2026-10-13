// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The tool library's pure model: how the catalog's statuses group and order for the library and the pickers, where a
// tool opens, what its terminal is called, and the pieces of the install flow toolsstore.ts wires up. A tool is a
// plain terminal that types its command line at the first prompt (launch.ts buildLaunchMeta, block meta tool:id).

// the category of a tool that is only in tools.json (arctools.CategoryYours); a built-in the user overrode keeps its own
const YOURS = "Yours";

export const DEFAULT_PINNED_TOOLS: string[] = ["lazygit", "yazi", "btop"];

// at most this many not-installed tools follow the installed ones in the pickers, as a nudge rather than the whole catalog
const PICKER_NOT_INSTALLED = 2;

// a library row's state: a built-in tool is installed or not; a yours tool is on PATH or not; an install terminal running
// or failed overlays either
export type ToolState = "installed" | "not-installed" | "installing" | "failed" | "on-path" | "not-on-path";

export interface ToolRow {
    tool: ToolStatus;
    state: ToolState;
}

export interface ToolGroups {
    installed: ToolRow[];
    notInstalled: ToolRow[];
    yours: ToolRow[];
}

function isYours(tool: ToolStatus): boolean {
    return tool.category === YOURS;
}

// Groups by whether the command was found (yours aside), in catalog order. An install terminal running or failed shows on
// the row but does not move it: a tool being installed still sits under Not installed until its command resolves, and an
// update running over an installed tool stays under Installed. `installing` and `failed` map a tool id to its install tab.
export function toolGroups(
    statuses: ToolStatus[],
    installing: Record<string, string>,
    failed: Record<string, string>
): ToolGroups {
    const groups: ToolGroups = { installed: [], notInstalled: [], yours: [] };
    for (const tool of statuses) {
        const overlay: ToolState | null = installing[tool.id] ? "installing" : failed[tool.id] ? "failed" : null;
        if (isYours(tool)) {
            groups.yours.push({ tool, state: overlay ?? (tool.found ? "on-path" : "not-on-path") });
        } else if (tool.found) {
            groups.installed.push({ tool, state: overlay ?? "installed" });
        } else {
            groups.notInstalled.push({ tool, state: overlay ?? "not-installed" });
        }
    }
    return groups;
}

// The tools "Open a tool" and the New dialog's Tool list show, in this order: pinned installed, the other installed,
// yours (found or not: a missing one says so there), then at most two not installed. Catalog order within each part.
export function pickerOrder(statuses: ToolStatus[], pinned: string[]): ToolStatus[] {
    const pins = new Set(pinned);
    const installed = statuses.filter((t) => !isYours(t) && t.found);
    return [
        ...installed.filter((t) => pins.has(t.id)),
        ...installed.filter((t) => !pins.has(t.id)),
        ...statuses.filter(isYours),
        ...statuses.filter((t) => !isYours(t) && !t.found).slice(0, PICKER_NOT_INSTALLED),
    ];
}

export interface ToolCwdContext {
    agentCwd?: string; // the focused agent's folder: its worktree when it has one
    projectRoot?: string; // the project's registered folder
    home: string;
}

// Where a tool opens: "agent" in the focused agent's folder, else the project root, else Home; "root" in the project
// root, else Home; "home" in Home. An unknown opensin reads as "agent", the default arctools gives an entry.
export function toolCwd(tool: Pick<ToolStatus, "opensin">, ctx: ToolCwdContext): string {
    switch (tool.opensin) {
        case "home":
            return ctx.home;
        case "root":
            return ctx.projectRoot || ctx.home;
        default:
            return ctx.agentCwd || ctx.projectRoot || ctx.home;
    }
}

// The project a tool's terminal is stamped with (the tab's session:project, which the tree groups it under): the one it
// was opened from, except a tool that opens in Home (btop), which sits in Home with the terminals that have no project.
// `home` is the Home project's name; it is passed in so this module stays free of launcher.ts, which imports it.
export function toolProjectName(tool: Pick<ToolStatus, "opensin">, project: string | undefined, home: string): string {
    return tool.opensin === "home" ? home : project || home;
}

// the line typed into the terminal's shell: the command, then its args as the user wrote them
export function toolCommandLine(tool: Pick<ToolStatus, "command" | "args">): string {
    const args = tool.args?.trim();
    return args ? `${tool.command} ${args}` : tool.command;
}

// the platform's install line (a NodeJS.Platform string), or undefined where the tool has none for this OS
export function installCommand(tool: Pick<ToolStatus, "install">, platform: string): string | undefined {
    const line =
        platform === "win32" ? tool.install?.windows : platform === "darwin" ? tool.install?.darwin : undefined;
    return line?.trim() || undefined;
}

function oneLine(s: string): string {
    return s.trim().replace(/\s+/g, " ");
}

// A terminal's name in the tree: the tool's while the terminal's own name is still its launch (the command line the
// shell was handed, or "Terminal N" before the shell reported any command), else the terminal's own: a rename, or the
// last command once the tool has quit.
export function toolTerminalName(terminal: { name: string; toolId?: string }, tools: ToolStatus[]): string {
    const tool = terminal.toolId ? tools.find((t) => t.id === terminal.toolId) : undefined;
    if (!tool) {
        return terminal.name;
    }
    const name = oneLine(terminal.name);
    return name === oneLine(toolCommandLine(tool)) || /^Terminal \d+$/.test(name) ? tool.name : terminal.name;
}

export type ToolIconName = "git-branch" | "folder" | "activity" | "container" | "book-open" | "wrench" | "terminal";

const CATEGORY_ICONS: Record<string, ToolIconName> = {
    Git: "git-branch",
    Files: "folder",
    System: "activity",
    Containers: "container",
    "Docs and data": "book-open",
};

// an icon (lucide name) per category; a terminal with no tool keeps the terminal icon
export function toolIcon(tool: Pick<ToolStatus, "category"> | undefined): ToolIconName {
    return tool ? (CATEGORY_ICONS[tool.category] ?? "wrench") : "terminal";
}

// Why a tool is not opened: its command was not found on PATH. Opening it would only print "command not found" in a
// terminal, so the pickers and the library say so (with Edit for a yours tool) and never spawn. null: it may open.
export function openToolRefusal(tool: Pick<ToolStatus, "name" | "found">): string | null {
    return tool.found ? null : `${tool.name} is not on PATH`;
}

// The block an install runs in: a command block, not a shell, so its exit is seen: a shell never exits, and
// cmd:closeonexit closes a block on exit 0 only (a non-zero exit keeps it, with its output). The line runs through the
// shell (cmd:shell), so a pipeline or `&&` in a user's install line works.
export function installBlockMeta(line: string, cwd: string): Record<string, unknown> {
    return {
        view: "term",
        controller: "cmd",
        cmd: line.trim(),
        "cmd:shell": true,
        "cmd:closeonexit": true,
        "cmd:cwd": cwd,
    };
}

export type InstallOutcome = "running" | "ok" | "failed";

// An install block's end, from its runtime status (shellprocstatus "done" with shellprocexitcode): exit 0 is ok.
export function installOutcome(
    status: Pick<BlockControllerRuntimeStatus, "shellprocstatus" | "shellprocexitcode"> | null | undefined
): InstallOutcome {
    if (status?.shellprocstatus !== "done") {
        return "running";
    }
    return status.shellprocexitcode === 0 ? "ok" : "failed";
}

// The pinned tool ids as stored (JSON in localStorage): nothing stored or unreadable gives the default; a stored list is
// kept as it is, an emptied one included, minus anything that is not a string and repeats.
export function parsePinnedTools(raw: string | null | undefined): string[] {
    if (raw == null) {
        return [...DEFAULT_PINNED_TOOLS];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [...DEFAULT_PINNED_TOOLS];
        }
        return [...new Set(parsed.filter((v): v is string => typeof v === "string"))];
    } catch {
        return [...DEFAULT_PINNED_TOOLS];
    }
}

// the pinned list with `id` pinned or not; a tool already pinned stays where it is
export function withPinned(pinned: string[], id: string, on: boolean): string[] {
    if (on) {
        return pinned.includes(id) ? [...pinned] : [...pinned, id];
    }
    return pinned.filter((p) => p !== id);
}
