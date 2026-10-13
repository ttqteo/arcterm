// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Resource Manager's pure model: formatting, ordering, the confirm and outcome texts, and the popover's
// cursor/expand/confirm reducer. resmonstore.ts feeds it the snapshot; the readout and popover only render it.

const UNAVAILABLE = "–";
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MB_LIMIT = 1000;
const ARC_KEY = "arc";

export function fmtCpu(pct: number, digits: 0 | 1 = 1): string {
    if (pct < 0) {
        return UNAVAILABLE;
    }
    return `${pct.toFixed(digits)}%`;
}

// binary units, as Task Manager shows them
export function fmtMem(bytes: number): string {
    if (bytes < 0) {
        return UNAVAILABLE;
    }
    const mb = Math.round(bytes / MIB);
    if (mb < MB_LIMIT) {
        return `${mb} MB`;
    }
    return `${(bytes / GIB).toFixed(1)} GB`;
}

export function fmtAge(createTs: number, now: number): string {
    if (createTs <= 0) {
        return UNAVAILABLE;
    }
    const s = Math.max(0, Math.floor((now - createTs) / 1000));
    if (s < 60) {
        return `${s}s`;
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
        return `${m}m`;
    }
    const h = Math.floor(m / 60);
    if (h < 24) {
        return `${h}h ${m % 60}m`;
    }
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function busyWords(s: ResMonSnapshotData): string | null {
    if (s.busycpu && s.busymem) {
        return "high CPU and memory";
    }
    if (s.busycpu) {
        return "high CPU";
    }
    if (s.busymem) {
        return "high memory";
    }
    return null;
}

export function readout(s: ResMonSnapshotData | null): {
    visible: boolean;
    ready: boolean;
    cpu: string;
    mem: string;
    busy: string | null;
    aria: string;
} {
    const visible = s == null || s.supported;
    if (s == null || !s.ready) {
        return {
            visible,
            ready: false,
            cpu: UNAVAILABLE,
            mem: UNAVAILABLE,
            busy: null,
            aria: "Resource Manager: reading processes",
        };
    }
    const cpu = fmtCpu(s.cpu, 0);
    const mem = fmtMem(s.mem);
    const busy = busyWords(s);
    const aria = `Resource Manager: Arc and its agents use ${cpu} CPU and ${mem}` + (busy ? `, ${busy}` : "");
    return { visible, ready: true, cpu, mem, busy, aria };
}

export function orderGroups(groups: ResMonGroup[]): ResMonGroup[] {
    return [...groups].sort((a, b) => {
        if ((a.key === ARC_KEY) !== (b.key === ARC_KEY)) {
            return a.key === ARC_KEY ? -1 : 1;
        }
        return b.cpu - a.cpu || a.label.localeCompare(b.label);
    });
}

const KIND_WORDS: Record<string, string> = {
    arc: "App, read-only",
    agenttab: "Agent tab",
    runworker: "Run worker",
    runcmd: "Run command, read-only",
};

const KIND_NOUNS: Record<string, string> = {
    arc: "Arc",
    agenttab: "agent tab",
    runworker: "run worker",
    runcmd: "run command",
};

export function ownerKindWords(kind: string): string {
    return KIND_WORDS[kind] ?? kind;
}

export function ownerNoun(kind: string): string {
    return KIND_NOUNS[kind] ?? kind;
}

// splits a command line into its executable token and the rest; a quoted executable keeps its spaces
function splitCommand(command: string): { exe: string; args: string } {
    const c = command.trim();
    const end = c.startsWith('"') ? c.indexOf('"', 1) : c.search(/\s/);
    if (end < 0) {
        return { exe: c.replace(/^"/, ""), args: "" };
    }
    const exe = c.startsWith('"') ? c.slice(1, end) : c.slice(0, end);
    return { exe, args: c.slice(end + 1).trim() };
}

function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

export function rowLabel(row: ProcessInfo): { name: string; cmd: string } {
    const { exe, args } = splitCommand(row.command ?? "");
    const image = row.name || baseName(exe);
    if (row.role) {
        const type = (row.command ?? "").match(/--type=\S+/)?.[0];
        return { name: row.role, cmd: type ? `${image} ${type}` : image };
    }
    return { name: image || `pid ${row.pid}`, cmd: args };
}

export function subtreeSize(rows: ProcessInfo[], index: number): number {
    let n = 0;
    for (let j = index + 1; j < rows.length && rows[j].depth > rows[index].depth; j++) {
        n++;
    }
    return n;
}

const SHELL_IMAGES = new Set([
    "cmd.exe",
    "bash.exe",
    "sh.exe",
    "pwsh.exe",
    "powershell.exe",
    "bash",
    "sh",
    "zsh",
    "pwsh",
]);
export const MORE_ROW = "more";

// what every agent carries and nobody acts on: its launcher and consoles, and wsh's agent control channel
function isPlumbing(row: ProcessInfo): boolean {
    if (row.tag === "launcher" || row.tag === "console") {
        return true;
    }
    if (row.tag) {
        return false;
    }
    const image = (row.name ?? "").toLowerCase();
    if (image === "conhost.exe") {
        return true;
    }
    return /^wsh(-[^\\/]*)?(\.exe)?$/.test(image) && rowLabel(row).cmd.startsWith("agentctl");
}

function isShell(row: ProcessInfo): boolean {
    return !row.tag && SHELL_IMAGES.has((row.name ?? "").toLowerCase());
}

export interface ResMonLine {
    row: ProcessInfo;
    index: number; // into g.rows, which subtreeSize and the kill confirm count from
    depth: number;
    leaf?: ProcessInfo; // the bottom of a chain the compact view folds into this line
    cpu: number; // the line's own, or its whole folded chain's
    mem: number;
}

export interface ResMonView {
    lines: ResMonLine[];
    full: boolean;
    hidden: number; // rows the compact view leaves out, shown or not
    hiddenCpu: number;
    hiddenMem: number;
}

// a shell at or above this is doing work of its own, so the compact view keeps it even with no command under it
const BUSY_SHELL_CPU = 1;

// The compact view keeps the agent and the commands it runs. It leaves out the plumbing, the shells that only wrap a
// command (Claude Code's `bash -c "source …snapshot…"` chain) and the idle shells left with nothing in them, and folds
// a chain of single children (`task tauri:build` → … → `makensis`) into one line: its top, its bottom, and its total.
// A kept row is indented by its kept ancestors; one whose parent has exited sits under the agent. Arc's own tree has
// neither, so it is always shown whole.
export function groupView(g: ResMonGroup, ui: ResMonUi): ResMonView {
    const rows = g.rows;
    const plumbing = rows.map(isPlumbing);
    const hide = rows.map((r, i) => {
        if (g.key === ARC_KEY) {
            return false;
        }
        if (plumbing[i]) {
            return true;
        }
        if (!isShell(r)) {
            return false;
        }
        for (let j = i + 1; j < rows.length && rows[j].depth > r.depth; j++) {
            if (!plumbing[j] && !isShell(rows[j])) {
                return true;
            }
        }
        return r.cpu < BUSY_SHELL_CPU;
    });
    let hidden = 0;
    let hiddenCpu = 0;
    let hiddenMem = 0;
    rows.forEach((r, i) => {
        if (hide[i]) {
            hidden++;
            hiddenCpu += Math.max(0, r.cpu);
            hiddenMem += Math.max(0, r.mem);
        }
    });
    const full = hidden > 0 && (ui.full[g.key] ?? false);
    if (full || g.key === ARC_KEY) {
        return {
            lines: rows.map((row, index) => ({ row, index, depth: row.depth, cpu: row.cpu, mem: row.mem })),
            full,
            hidden,
            hiddenCpu,
            hiddenMem,
        };
    }
    // the kept rows as a tree: each one's nearest kept ancestor
    const children = new Map<number, number[]>();
    const roots: number[] = [];
    const stack: { depth: number; index: number; kept: boolean }[] = [];
    rows.forEach((row, index) => {
        while (stack.length > 0 && stack[stack.length - 1].depth >= row.depth) {
            stack.pop();
        }
        if (!hide[index]) {
            const parent = [...stack].reverse().find((s) => s.kept);
            if (parent == null) {
                roots.push(index);
            } else {
                children.set(parent.index, [...(children.get(parent.index) ?? []), index]);
            }
        }
        stack.push({ depth: row.depth, index, kept: !hide[index] });
    });
    const anchored = rows.some((r, i) => r.tag && !hide[i]);
    const lines: ResMonLine[] = [];
    const emit = (index: number, depth: number) => {
        const row = rows[index];
        let bottom = index;
        let cpu = Math.max(0, row.cpu);
        let mem = Math.max(0, row.mem);
        for (let next = children.get(bottom) ?? []; !row.tag && next.length === 1 && !rows[next[0]].tag; ) {
            bottom = next[0];
            cpu += Math.max(0, rows[bottom].cpu);
            mem += Math.max(0, rows[bottom].mem);
            next = children.get(bottom) ?? [];
        }
        const folded = bottom !== index;
        lines.push({
            row,
            index,
            depth,
            leaf: folded ? rows[bottom] : undefined,
            cpu: folded ? cpu : row.cpu,
            mem: folded ? mem : row.mem,
        });
        for (const child of children.get(bottom) ?? []) {
            emit(child, depth + 1);
        }
    };
    for (const index of roots) {
        emit(index, anchored && !rows[index].tag ? 1 : 0);
    }
    return { lines, full, hidden, hiddenCpu, hiddenMem };
}

// what a folded group's header says it is running: the top of each command the compact view shows, by name and its
// first plain argument (`task tauri:build`, `sleep 10`), or null when it runs none
export function groupHeadline(g: ResMonGroup): string | null {
    if (g.key === ARC_KEY) {
        return null;
    }
    const view = groupView(g, RESMON_UI_INITIAL);
    const top = Math.min(...view.lines.filter((l) => !l.row.tag).map((l) => l.depth));
    const words = view.lines
        .filter((l) => !l.row.tag && l.depth === top)
        .map((l) => {
            const { name, cmd } = rowLabel(l.row);
            const first = cmd.split(/\s+/)[0] ?? "";
            const arg = /^[\w.:/@-]+$/.test(first) && !first.startsWith("-") ? ` ${first}` : "";
            return name.replace(/\.exe$/i, "") + arg;
        });
    return words.length > 0 ? words.join(", ") : null;
}

function processes(n: number): string {
    return `${n} process${n === 1 ? "" : "es"}`;
}

function childProcesses(n: number): string {
    return `${n} child ${n === 1 ? "process" : "processes"}`;
}

export function killConfirmText(row: ProcessInfo, children: number): string {
    const who = `${rowLabel(row).name} (${row.pid})`;
    if (children === 0) {
        return `Kill ${who}? It has no child processes.`;
    }
    return `Kill ${who} and its ${childProcesses(children)}?`;
}

export function killChildrenTargets(g: ResMonGroup): ProcessInfo[] {
    return g.rows.filter((r) => !r.tag);
}

export function killChildrenConfirmText(g: ResMonGroup): string {
    const ask = `Kill ${processes(killChildrenTargets(g).length)} under ${g.label}?`;
    const survivor = g.rows.find((r) => r.tag === "agent") ?? g.rows.find((r) => r.tag === "shell");
    if (survivor == null) {
        return ask;
    }
    const name = rowLabel(survivor).name;
    const keeps = g.rows.some((r) => r.tag === "console")
        ? `${name} and its console keep running.`
        : `${name} keeps running.`;
    return `${ask} ${keeps}`;
}

export function outcomeNote(
    r: ResMonKillRtnData,
    target: { name: string; pid: number } | null,
    g: ResMonGroup
): { text: string; tone: "note" | "alert" } {
    const who = target ? `${target.name} (${target.pid})` : null;
    switch (r.outcome) {
        case "killed": {
            if (who == null) {
                return { text: `Killed ${processes(r.killed)}.`, tone: "note" };
            }
            const children = r.killed - 1;
            return {
                text: children > 0 ? `Killed ${who} and ${childProcesses(children)}.` : `Killed ${who}.`,
                tone: "note",
            };
        }
        case "gone":
            return { text: `${who ?? "The processes"} had already exited.`, tone: "note" };
        case "refused": {
            const what = target ? `pid ${target.pid} no longer belongs` : "these processes no longer belong";
            return {
                text: `Not killed: ${what} to this ${ownerNoun(g.ownerkind)}. The list refreshes in 2s.`,
                tone: "alert",
            };
        }
        case "protected":
            return {
                text: `Not killed: ${who ?? "that"} is the agent's own process. Kill children stops what it started.`,
                tone: "alert",
            };
        default: {
            const err = (r.error ?? "").trim().replace(/\.+$/, "");
            const still = who ? "It is still running." : "They are still running.";
            return {
                text: `Could not kill ${who ?? "the processes"}${err ? `: ${err}` : ""}. ${still}`,
                tone: "alert",
            };
        }
    }
}

export interface ResMonUi {
    cursor: string | null; // "<groupKey>" or "<groupKey>/<pid>"
    expanded: Record<string, boolean>; // only the groups toggled from their default; see isExpanded
    full: Record<string, boolean>; // groups showing every process instead of the compact view; see groupView
    confirm: { kind: "row"; key: string; pid: number } | { kind: "group"; key: string } | null;
    notes: Record<string, { text: string; tone: "note" | "alert" }>;
}

// groups is the order the popover draws (orderGroups); at moves the cursor there first, for a click
export type ResMonAction =
    | { type: "move"; delta: 1 | -1; groups: ResMonGroup[] }
    | { type: "toggle"; groups: ResMonGroup[]; key?: string } // undefined = the cursor's group, or its helper line
    | { type: "toggleFull"; groups: ResMonGroup[]; key: string }
    | { type: "askKill"; groups: ResMonGroup[]; at?: string } // x: a row cursor on a killable, untagged row
    | { type: "askChildren"; groups: ResMonGroup[]; at?: string } // ⇧X: the cursor's group, when it is killable and has targets
    | { type: "cancel" }
    | { type: "note"; key: string; note: { text: string; tone: "note" | "alert" } }
    | { type: "close" }; // clears confirm, notes and cursor; keeps expanded and full

export const RESMON_UI_INITIAL: ResMonUi = { cursor: null, expanded: {}, full: {}, confirm: null, notes: {} };

// Every group starts as one line, its header naming what it runs (groupHeadline); ⏎ or a click opens its rows.
export function isExpanded(ui: ResMonUi, g: ResMonGroup): boolean {
    return ui.expanded[g.key] ?? false;
}

function parseCursor(cursor: string | null): { key: string; pid: number | null } | null {
    if (cursor == null) {
        return null;
    }
    const slash = cursor.lastIndexOf("/");
    if (slash < 0) {
        return { key: cursor, pid: null };
    }
    return { key: cursor.slice(0, slash), pid: Number(cursor.slice(slash + 1)) };
}

export function cursorRows(groups: ResMonGroup[], ui: ResMonUi): string[] {
    const out: string[] = [];
    for (const g of groups) {
        out.push(g.key);
        if (isExpanded(ui, g)) {
            const view = groupView(g, ui);
            out.push(...view.lines.map((l) => `${g.key}/${l.row.pid}`));
            if (view.hidden > 0) {
                out.push(`${g.key}/${MORE_ROW}`);
            }
        }
    }
    return out;
}

function move(ui: ResMonUi, delta: 1 | -1, groups: ResMonGroup[]): ResMonUi {
    const rows = cursorRows(groups, ui);
    if (rows.length === 0) {
        return ui;
    }
    const at = ui.cursor == null ? -1 : rows.indexOf(ui.cursor);
    const next = at < 0 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + delta));
    return { ...ui, cursor: rows[next] };
}

function toggle(ui: ResMonUi, groups: ResMonGroup[], key: string | undefined): ResMonUi {
    if (key == null && ui.cursor?.endsWith(`/${MORE_ROW}`)) {
        return toggleFull(ui, groups, ui.cursor.slice(0, -MORE_ROW.length - 1));
    }
    const k = key ?? parseCursor(ui.cursor)?.key;
    const g = groups.find((x) => x.key === k);
    if (k == null || g == null) {
        return ui;
    }
    const open = !isExpanded(ui, g);
    // collapsing hides the cursor's row, so the cursor falls back to its group's header
    const cursor = !open && parseCursor(ui.cursor)?.key === k ? k : ui.cursor;
    return { ...ui, cursor, expanded: { ...ui.expanded, [k]: open } };
}

// back to the compact view, a cursor on a row it leaves out moves to the helper line that brings it back
function toggleFull(ui: ResMonUi, groups: ResMonGroup[], key: string): ResMonUi {
    const g = groups.find((x) => x.key === key);
    if (g == null) {
        return ui;
    }
    const next = { ...ui, full: { ...ui.full, [key]: !groupView(g, ui).full } };
    const c = parseCursor(ui.cursor);
    if (c?.key === key && c.pid != null && !cursorRows([g], next).includes(ui.cursor)) {
        return { ...next, cursor: `${key}/${MORE_ROW}` };
    }
    return next;
}

function withoutNote(notes: ResMonUi["notes"], key: string): ResMonUi["notes"] {
    const { [key]: _, ...rest } = notes;
    return rest;
}

function askKill(ui: ResMonUi, groups: ResMonGroup[], at: string | undefined): ResMonUi {
    const cursor = at ?? ui.cursor;
    const c = parseCursor(cursor);
    const g = groups.find((x) => x.key === c?.key);
    const row = g?.rows.find((r) => r.pid === c?.pid);
    if (g == null || row == null || !g.killable || row.tag) {
        return ui;
    }
    return { ...ui, cursor, confirm: { kind: "row", key: g.key, pid: row.pid }, notes: withoutNote(ui.notes, g.key) };
}

function askChildren(ui: ResMonUi, groups: ResMonGroup[], at: string | undefined): ResMonUi {
    const cursor = at ?? ui.cursor;
    const g = groups.find((x) => x.key === parseCursor(cursor)?.key);
    if (g == null || !g.killable || killChildrenTargets(g).length === 0) {
        return ui;
    }
    return { ...ui, cursor, confirm: { kind: "group", key: g.key }, notes: withoutNote(ui.notes, g.key) };
}

export function resmonReduce(ui: ResMonUi, a: ResMonAction): ResMonUi {
    switch (a.type) {
        case "move":
            return move(ui, a.delta, a.groups);
        case "toggle":
            return toggle(ui, a.groups, a.key);
        case "toggleFull":
            return toggleFull(ui, a.groups, a.key);
        case "askKill":
            return askKill(ui, a.groups, a.at);
        case "askChildren":
            return askChildren(ui, a.groups, a.at);
        case "cancel":
            return { ...ui, confirm: null };
        case "note":
            return { ...ui, notes: { ...ui.notes, [a.key]: a.note } };
        case "close":
            return { ...RESMON_UI_INITIAL, expanded: ui.expanded, full: ui.full };
    }
}
