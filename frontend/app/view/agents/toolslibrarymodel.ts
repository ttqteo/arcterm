// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Tools' pure model: the library list (categories, status words, search), the detail's install panel, the
// add / edit form and what a change to a tool writes into tools.json. The status and the open / install actions are
// toolsmodel.ts and toolsstore.ts; toolslibrary.tsx draws this.

import { installCommand, toolCommandLine, toolGroups, type ToolState } from "./toolsmodel";

// the category of a tool that is only in tools.json (arctools.CategoryYours)
const YOURS = "Yours";

const CATEGORY_ORDER = ["Git", "Files", "System", "Containers", "Docs and data", YOURS];

// a category the library does not know sorts just before Yours, so a catalog entry is never dropped from the list
function categoryRank(category: string): number {
    const i = CATEGORY_ORDER.indexOf(category);
    return i >= 0 ? i : CATEGORY_ORDER.length - 1.5;
}

const STATE_WORD: Record<ToolState, string> = {
    installed: "installed",
    "not-installed": "not installed",
    installing: "installing",
    failed: "install failed",
    "on-path": "on PATH",
    "not-on-path": "not on PATH",
};

export interface LibraryRow {
    tool: ToolStatus;
    state: ToolState;
    word: string; // the row's status word
}

export interface LibraryGroup {
    category: string;
    rows: LibraryRow[];
}

function matches(tool: ToolStatus, query: string): boolean {
    return [tool.name, tool.id, tool.command, tool.purpose, tool.category].some((s) =>
        (s ?? "").toLowerCase().includes(query)
    );
}

// The library list: tools grouped by category (a category with none is left out), in the catalog's order within each,
// each with its status word. `installing` and `failed` map a tool id to its install tab (installingAtom / failedAtom).
// A query keeps the tools whose name, id, command, purpose or category contains it.
export function libraryRows(
    statuses: ToolStatus[],
    installing: Record<string, string>,
    failed: Record<string, string>,
    query = ""
): LibraryGroup[] {
    const g = toolGroups(statuses, installing, failed);
    const states = new Map([...g.installed, ...g.notInstalled, ...g.yours].map((r) => [r.tool.id, r.state]));
    const q = query.trim().toLowerCase();
    const groups = new Map<string, LibraryRow[]>();
    for (const tool of statuses) {
        if (q !== "" && !matches(tool, q)) {
            continue;
        }
        const state = states.get(tool.id) ?? "not-installed";
        const rows = groups.get(tool.category) ?? [];
        rows.push({ tool, state, word: STATE_WORD[state] });
        groups.set(tool.category, rows);
    }
    return [...groups.entries()]
        .map(([category, rows]) => ({ category, rows }))
        .sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
}

// the detail's title line: the status word as a label
export function statusLabel(state: ToolState): string {
    const word = STATE_WORD[state];
    return word.charAt(0).toUpperCase() + word.slice(1);
}

export type StateTone = "ok" | "busy" | "error" | "none";

// the dot and colour a status gets; never colour alone, the word is always beside it
export function stateTone(state: ToolState): StateTone {
    switch (state) {
        case "installed":
        case "on-path":
            return "ok";
        case "installing":
            return "busy";
        case "failed":
        case "not-on-path":
            return "error";
        default:
            return "none";
    }
}

const MANAGERS: Record<string, string> = { win32: "winget", darwin: "brew" };

// "4 installed · 9 in the library": the built-in catalog, whether its commands were found. A tool of yours is not part of
// the library's count (it has its own status word); one a built-in the user overrode still is.
export function headerSummary(statuses: ToolStatus[], platform?: string): string {
    const library = statuses.filter((t) => t.category !== YOURS);
    const parts = [`${library.filter((t) => t.found).length} installed`, `${library.length} in the library`];
    const manager = platform ? MANAGERS[platform] : undefined;
    if (manager) {
        parts.push(`installs with ${manager}`);
    }
    return parts.join(" · ");
}

// The tool the detail shows: the one selected, else the first the list shows (the selection can be a tool that was
// removed, or none yet), else null with no tools at all.
export function selectedTool(statuses: ToolStatus[], id: string | null): ToolStatus | null {
    return statuses.find((t) => t.id === id) ?? libraryRows(statuses, {}, {})[0]?.rows[0]?.tool ?? null;
}

// where the command was found, for the detail's Command line
export function foundLine(tool: Pick<ToolStatus, "found" | "path">): string {
    if (!tool.found) {
        return "not found on PATH";
    }
    return tool.path ? `found at ${tool.path}` : "found on PATH";
}

export type InstallButton = "install" | "update" | "open-output" | "retry";

export interface InstallPanel {
    line?: string; // this system's install command
    note?: string; // the other system's, for the user who runs arcterm on both
    buttons: InstallButton[];
}

// The detail's Install block. A tool being installed or whose install failed has its terminal to open (and, failed, to
// retry); otherwise Install for a tool not found and Update for one that is, when this system has a line for it.
export function installPanel(
    tool: Pick<ToolStatus, "install" | "found">,
    state: ToolState,
    platform: string
): InstallPanel {
    const line = installCommand(tool, platform);
    const other =
        platform === "win32" && tool.install?.darwin?.trim()
            ? `${tool.install.darwin.trim()} on a Mac`
            : platform === "darwin" && tool.install?.windows?.trim()
              ? `${tool.install.windows.trim()} on Windows`
              : undefined;
    let buttons: InstallButton[] = [];
    if (state === "installing") {
        buttons = ["open-output"];
    } else if (state === "failed") {
        buttons = ["open-output", "retry"];
    } else if (line != null) {
        buttons = [tool.found ? "update" : "install"];
    }
    return { line, note: other, buttons };
}

// An install that ended without failing and left the command still not found: wavesrv looks commands up on the PATH it
// started with, so a tool just installed may need arcterm restarted before it is found.
export function needsRestartHint(tool: Pick<ToolStatus, "id" | "found">, state: ToolState, ended: string[]): boolean {
    return !tool.found && (state === "not-installed" || state === "not-on-path") && ended.includes(tool.id);
}

export const OPENS_IN_OPTIONS = [
    { id: "agent", label: "The agent's folder" },
    { id: "root", label: "Project root" },
    { id: "home", label: "Home" },
];

export const SHOWS_OPTIONS = [
    { id: "centre", label: "In the centre" },
    { id: "panel", label: "In the panel" },
];

// ---- tools.json ----

// A tools.json entry replaces the whole entry of its id and needs a command, so a change to one field is written on top
// of the rest. A tool of yours is its entry: every field it has comes back from its status. A built-in's entry is only
// what the user overrode, read from the config; with none yet it starts from the built-in's own command.
export function overrideKeywords(
    tool: ToolStatus,
    current: ToolKeywords | undefined,
    patch: Pick<ToolKeywords, "opensin" | "shows">
): ToolKeywords {
    const base = tool.category === YOURS ? keywordsFromTool(tool) : (current ?? {});
    return { ...base, command: base.command || tool.command, ...patch };
}

function keywordsFromTool(tool: ToolStatus): ToolKeywords {
    const kw: ToolKeywords = { name: tool.name, command: tool.command, opensin: tool.opensin, shows: tool.shows };
    if (tool.args) {
        kw.args = tool.args;
    }
    if (tool.purpose) {
        kw.purpose = tool.purpose;
    }
    if (tool.install?.windows) {
        kw["install:windows"] = tool.install.windows;
    }
    if (tool.install?.darwin) {
        kw["install:darwin"] = tool.install.darwin;
    }
    return kw;
}

export function validateNewTool(form: { name: string; command: string }): string | null {
    if (form.name.trim() === "") {
        return "Add a name";
    }
    if (form.command.trim() === "") {
        return "Add a command";
    }
    return null;
}

// a lowercase slug of the name, the id a tool of yours is kept under in tools.json
export function toolIdFrom(name: string): string {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "tool"
    );
}

// An id no tool has yet: a new tool must never take a built-in's id, which would override that built-in rather than add one.
export function uniqueToolId(name: string, taken: string[]): string {
    const base = toolIdFrom(name);
    const used = new Set(taken);
    if (!used.has(base)) {
        return base;
    }
    let n = 2;
    while (used.has(`${base}-${n}`)) {
        n++;
    }
    return `${base}-${n}`;
}

// The add / edit form's fields. `id` is null while adding: the id is made from the name when it is saved. `command` is the
// whole line as it is typed in a terminal, program and arguments: the backend finds the program alone on PATH, so saving
// splits it. Purpose has no field (the board has none); an edit carries it through so saving does not lose it.
export interface ToolForm {
    id: string | null;
    name: string;
    command: string;
    opensin: string;
    shows: string;
    install: string; // this system's install command
    purpose: string;
}

export function emptyForm(): ToolForm {
    return { id: null, name: "", command: "", opensin: "agent", shows: "centre", install: "", purpose: "" };
}

export function formFromTool(tool: ToolStatus, platform: string): ToolForm {
    return {
        id: tool.id,
        name: tool.name,
        command: toolCommandLine(tool),
        opensin: tool.opensin,
        shows: tool.shows,
        install: installCommand(tool, platform) ?? "",
        purpose: tool.purpose ?? "",
    };
}

// The program (the first word, which is what is looked up on PATH) and the arguments after it. A program path with spaces
// in it does not split cleanly: put such a program on PATH.
export function splitCommandLine(line: string): { command: string; args: string } {
    const text = line.trim();
    const i = text.search(/\s/);
    return i < 0 ? { command: text, args: "" } : { command: text.slice(0, i), args: text.slice(i).trim() };
}

export interface CommandCheck {
    ok: boolean;
    text: string;
}

// The line under Command. Only a command the status has already looked up has an answer; an edited one is checked when
// it is saved, as the status is read again then, so until then the line says so rather than guess.
export function commandCheck(line: string, tool: Pick<ToolStatus, "command" | "found"> | null): CommandCheck | null {
    const { command } = splitCommandLine(line);
    if (command === "" || tool == null || tool.command !== command) {
        return null;
    }
    return { ok: tool.found, text: `${command} is ${tool.found ? "on" : "not on"} PATH` };
}

// What saving the form writes: the fields trimmed, the empty optional ones left out. The install line is this system's;
// `keep` is the install lines the tool had, so the other system's is not lost.
export function formKeywords(form: ToolForm, platform: string, keep: Install): ToolKeywords {
    const { command, args } = splitCommandLine(form.command);
    const kw: ToolKeywords = { name: form.name.trim(), command, opensin: form.opensin, shows: form.shows };
    if (args) {
        kw.args = args;
    }
    if (form.purpose.trim()) {
        kw.purpose = form.purpose.trim();
    }
    const mine = form.install.trim();
    const windows = platform === "win32" ? mine : keep.windows?.trim();
    const darwin = platform === "darwin" ? mine : keep.darwin?.trim();
    if (windows) {
        kw["install:windows"] = windows;
    }
    if (darwin) {
        kw["install:darwin"] = darwin;
    }
    return kw;
}
