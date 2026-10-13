// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Resource Manager's pure model: what the Consumers panel shows of an agent's processes (its CPU and the heaviest
// command it runs), the app bar chip's words, and the kill outcome note. resmonstore.ts feeds it the snapshot.

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

/** What Arc and its agents use, for the RAM chip's tooltip: ready once a second sample gives CPU deltas. */
export function readout(s: ResMonSnapshotData | null): {
    ready: boolean;
    cpu: string;
    mem: string;
    busy: string | null;
} {
    if (s == null || !s.supported || !s.ready) {
        return { ready: false, cpu: UNAVAILABLE, mem: UNAVAILABLE, busy: null };
    }
    return { ready: true, cpu: fmtCpu(s.cpu, 0), mem: fmtMem(s.mem), busy: busyWords(s) };
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
    index: number; // into g.rows
    depth: number;
    leaf?: ProcessInfo; // the bottom of a chain the compact view folds into this line
    cpu: number; // the line's own, or its whole folded chain's
    mem: number;
}

// a shell at or above this is doing work of its own, so the compact view keeps it even with no command under it
const BUSY_SHELL_CPU = 1;

// The compact view keeps the agent and the commands it runs. It leaves out the plumbing, the shells that only wrap a
// command (Claude Code's `bash -c "source …snapshot…"` chain) and the idle shells left with nothing in them, and folds
// a chain of single children (`task tauri:build` → … → `makensis`) into one line: its top, its bottom, and its total.
// A kept row is indented by its kept ancestors; one whose parent has exited sits under the agent.
export function groupView(g: ResMonGroup): ResMonLine[] {
    const rows = g.rows;
    const plumbing = rows.map(isPlumbing);
    const hide = rows.map((r, i) => {
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
    return lines;
}

export interface AgentCommand {
    label: string; // `git log --all -p`: the image without .exe, then its arguments
    pid: number; // the command's top process: a tree kill takes what it started
    ownerid: string;
    cpu: number;
    mem: number; // with everything under it
}

export interface AgentWork {
    cpu: number; // the agent's whole job: the agent, its plumbing and its commands
    command: AgentCommand | null; // the heaviest command it runs, or null when it runs none
}

function commandLabel(row: ProcessInfo): string {
    const { name, cmd } = rowLabel(row);
    return `${name.replace(/\.exe$/i, "")}${cmd ? ` ${cmd}` : ""}`;
}

/** An agent's CPU and the heaviest command it runs, from the group the snapshot keeps for its block; null when the
 * snapshot has no such group (no Resource Manager on this platform, or the agent has no process yet). The commands
 * are the compact view's top lines; each weighs what it and every line under it hold. */
export function agentWork(snap: ResMonSnapshotData | null, blockId: string): AgentWork | null {
    const g = snap?.supported ? snap.groups.find((x) => x.key !== ARC_KEY && x.ownerid === blockId) : null;
    if (g == null) {
        return null;
    }
    const lines = groupView(g);
    const commands = lines.filter((l) => !l.row.tag);
    const top = Math.min(...commands.map((l) => l.depth));
    let best: AgentCommand | null = null;
    commands.forEach((l) => {
        if (l.depth !== top) {
            return;
        }
        const at = lines.indexOf(l);
        let cpu = Math.max(0, l.cpu);
        let mem = Math.max(0, l.mem);
        for (let j = at + 1; j < lines.length && lines[j].depth > l.depth; j++) {
            cpu += Math.max(0, lines[j].cpu);
            mem += Math.max(0, lines[j].mem);
        }
        if (best == null || mem > best.mem) {
            best = { label: commandLabel(l.row), pid: l.row.pid, ownerid: g.ownerid ?? "", cpu, mem };
        }
    });
    return { cpu: g.cpu, command: best };
}

/** The note under an agent's row after its command's kill. */
export function killNote(r: ResMonKillRtnData, label: string): { text: string; tone: "note" | "alert" } {
    switch (r.outcome) {
        case "killed":
            return { text: `Killed ${label}.`, tone: "note" };
        case "gone":
            return { text: `${label} had already exited.`, tone: "note" };
        case "refused":
        case "protected":
            return { text: `Not killed: ${label} no longer belongs to this agent.`, tone: "alert" };
        default: {
            const err = (r.error ?? "").trim().replace(/\.+$/, "");
            return { text: `Could not kill ${label}${err ? `: ${err}` : ""}. It is still running.`, tone: "alert" };
        }
    }
}
