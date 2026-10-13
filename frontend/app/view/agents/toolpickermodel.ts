// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// "Open a tool"'s pure model: the line under the search that says where a tool opens, the rows the groups hold for a
// query, the words on a row and in the footer, and what a key does. toolpicker.tsx draws it; the state and the open /
// install actions are toolsstore.ts, the grouping rules toolsmodel.ts.

import { shortIds } from "./agentrailmodel";
import { installCommand, pickerOrder, toolGroups, type ToolState } from "./toolsmodel";

// ---- where a tool opens ----

// what the picker follows: the focused agent or terminal (its project, name, folder and branch), or, from a folder's tool
// button, a project alone
export interface PickerFocus {
    project?: string;
    name?: string; // the agent's name; a terminal has none worth saying ("Terminal 2")
    cwd?: string;
    branch?: string; // already the notable one: a default branch is not passed
}

export interface PickerContext {
    text: string; // "Opens in fix-login's worktree"
    branch?: string;
    path?: string; // the folder, from the project's name when it is inside the project
}

const slashed = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
// windows paths compare without case
const same = (a: string, b: string) => slashed(a).toLowerCase() === slashed(b).toLowerCase();
const inside = (p: string, root: string) =>
    slashed(p)
        .toLowerCase()
        .startsWith(slashed(root).toLowerCase() + "/");
const lastSegment = (p: string) => shortIds(slashed(p).split("/").pop() ?? p);

// The line under the search. A tool opens in the focused agent's folder (toolCwd): its worktree when it has one, else the
// project's root, else Home. `roots` is project name -> registered folder, as activenav.ts builds it.
export function pickerContext(focus: PickerFocus | undefined, roots: ReadonlyMap<string, string>): PickerContext {
    const project = focus?.project || undefined;
    const root = project ? roots.get(project) : undefined;
    const cwd = focus?.cwd || undefined;
    const out = (ctx: PickerContext): PickerContext => (focus?.branch ? { ...ctx, branch: focus.branch } : ctx);
    if (cwd) {
        if (root && same(cwd, root)) {
            return out({ text: `Opens in ${project}` });
        }
        if (root && inside(cwd, root)) {
            const rel = shortIds(slashed(cwd).slice(slashed(root).length + 1));
            return out({
                text: focus?.name ? `Opens in ${focus.name}'s worktree` : `Opens in ${lastSegment(cwd)}`,
                path: `${project}/${rel}`,
            });
        }
        // a folder the project does not own, or a project with no registered folder
        return out({ text: project && !root ? `Opens in ${project}` : `Opens in ${lastSegment(cwd)}`, path: cwd });
    }
    return root ? out({ text: `Opens in ${project}` }) : { text: "Opens in Home" };
}

// a row says so when its tool does not open where the line above says
export function rowOpensIn(tool: Pick<ToolStatus, "opensin">): string | undefined {
    switch (tool.opensin) {
        case "home":
            return "opens in Home";
        case "root":
            return "opens in the project root";
        default:
            return undefined;
    }
}

// ---- rows ----

export type PickerGroupKey = "installed" | "notInstalled" | "yours";

export interface PickerRow {
    tool: ToolStatus;
    state: ToolState;
}

export interface PickerGroup {
    key: PickerGroupKey;
    label: string;
    rows: PickerRow[];
}

const GROUP_LABELS: Record<PickerGroupKey, string> = {
    installed: "Installed",
    notInstalled: "Not installed",
    yours: "Yours",
};

function matches(tool: ToolStatus, query: string): boolean {
    return [tool.name, tool.id, tool.command, tool.purpose].some((s) => (s ?? "").toLowerCase().includes(query));
}

// The groups the picker draws, in the order they are drawn. With no query: the tools toolsmodel.pickerOrder picks (the
// installed ones with the pinned first, yours, and a nudge of two not installed) plus any tool whose install is running
// or has failed, which must stay in reach of its Show / Try again. With a query: every tool of the catalog that holds
// it in its name, command or purpose. A group with no rows is left out. `installing` and `failed` map a tool id to its
// install tab (installingAtom / failedAtom).
export function pickerGroups(
    statuses: ToolStatus[],
    pinned: string[],
    installing: Record<string, string>,
    failed: Record<string, string>,
    query: string
): PickerGroup[] {
    const q = query.trim().toLowerCase();
    const shown = new Set(
        q !== ""
            ? statuses.filter((t) => matches(t, q)).map((t) => t.id)
            : [
                  ...pickerOrder(statuses, pinned).map((t) => t.id),
                  ...statuses.filter((t) => installing[t.id] || failed[t.id]).map((t) => t.id),
              ]
    );
    const g = toolGroups(statuses, installing, failed);
    const pins = new Set(pinned);
    const keep = (rows: PickerRow[]) => rows.filter((r) => shown.has(r.tool.id));
    const installed = keep(g.installed);
    const groups: PickerGroup[] = [
        {
            key: "installed",
            label: GROUP_LABELS.installed,
            rows: [...installed.filter((r) => pins.has(r.tool.id)), ...installed.filter((r) => !pins.has(r.tool.id))],
        },
        { key: "notInstalled", label: GROUP_LABELS.notInstalled, rows: keep(g.notInstalled) },
        { key: "yours", label: GROUP_LABELS.yours, rows: keep(g.yours) },
    ];
    return groups.filter((x) => x.rows.length > 0);
}

export function flatRows(groups: PickerGroup[]): PickerRow[] {
    return groups.flatMap((g) => g.rows);
}

// the row the selection index names; an index past either end is the nearest row, none for no rows
export function selectedRow(rows: PickerRow[], sel: number): PickerRow | undefined {
    return rows[Math.max(0, Math.min(sel, rows.length - 1))];
}

const MANAGERS: Record<string, string> = { win32: "winget", darwin: "brew" };

export type NoteTone = "none" | "busy" | "error";

// The second line of a row: what the tool is for, or, where there is something to say, its install under way, an install
// that failed, a command that is not on PATH. The tone picks the colour; the words are always there.
export function rowNote(row: PickerRow, platform: string): { text: string; tone: NoteTone } {
    const manager = MANAGERS[platform];
    switch (row.state) {
        case "installing":
            return { text: manager ? `Installing with ${manager}` : "Installing", tone: "busy" };
        case "failed":
            return {
                text: `${manager ?? "The install"} did not finish. The install terminal has its output.`,
                tone: "error",
            };
        case "not-on-path":
            return { text: `${row.tool.name} is not on PATH. Check the command in settings.`, tone: "error" };
        default:
            return { text: row.tool.purpose, tone: "none" };
    }
}

// Why Enter does not open the selected row, as the line the dialog shows; null when it opens (its command was found).
export function openRefusal(row: PickerRow, platform: string): string | null {
    if (row.tool.found) {
        return null;
    }
    const name = row.tool.name;
    switch (row.state) {
        case "installing":
            return `${name} is installing. Show opens its terminal.`;
        case "failed":
            return `${name} did not install. Open output shows why.`;
        case "not-on-path":
            return `${name} is not on PATH. Check the command in settings.`;
        default:
            return installCommand(row.tool, platform) != null
                ? `${name} is not installed. Press Ctrl I to install it.`
                : `${name} is not installed, and arcterm has no install command for it here.`;
    }
}

// ---- footer and keys ----

export interface FooterHints {
    open: string | null; // "Open lazygit"; null when the selected row does not open
    panel: string | null;
    install: boolean; // Ctrl I does something on the selected row
}

export function footerHints(row: PickerRow | undefined): FooterHints {
    if (row == null) {
        return { open: null, panel: null, install: false };
    }
    return {
        open: row.tool.found ? `Open ${row.tool.name}` : null,
        panel: row.tool.found ? "Open in the panel" : null,
        install: row.state === "not-installed",
    };
}

export interface PickerKeyEvent {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
}

export type PickerAction =
    | { kind: "move"; sel: number }
    | { kind: "open"; place: "centre" | "panel" }
    | { kind: "install" }
    | { kind: "close" };

// What a key does in the dialog; null leaves it to the search box (typing, the caret, Backspace). Enter on any row is an
// open: whether the row can open is the dialog's to say (openRefusal), so a tool that is not installed answers rather
// than doing nothing.
export function pickerKey(state: { sel: number; rows: PickerRow[] }, e: PickerKeyEvent): PickerAction | null {
    const count = state.rows.length;
    const sel = Math.max(0, Math.min(state.sel, count - 1));
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    switch (e.key) {
        case "ArrowDown":
            return count > 0 ? { kind: "move", sel: (sel + 1) % count } : null;
        case "ArrowUp":
            return count > 0 ? { kind: "move", sel: (sel - 1 + count) % count } : null;
        case "Enter":
            return count > 0 && plain ? { kind: "open", place: e.shiftKey ? "panel" : "centre" } : null;
        case "Escape":
            return { kind: "close" };
        case "i":
        case "I":
            return (e.ctrlKey || e.metaKey) && !e.altKey && state.rows[sel]?.state === "not-installed"
                ? { kind: "install" }
                : null;
        default:
            return null;
    }
}
