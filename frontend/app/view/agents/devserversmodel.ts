// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Servers section of the Agent details rail, as pure functions: the label a row shows for a listening process,
// its port and owner text, its uptime, which running background task (if any) wrote its log, and how often the rail
// asks the backend. No React, atoms or RPC; devserversstore.ts polls and agentdetailsrail.tsx renders.

// the JSON shape of the Go devservers.ServerOwner
export interface DevServerOwner {
    kind: "agent" | "terminal" | "app" | "detached";
    blockid?: string;
    tabid?: string;
    name?: string;
    harness?: string;
}

// the JSON shape of the Go devservers.Server (pkg/devservers)
export interface DevServerRow {
    pid: number;
    createms: number;
    ports: number[];
    name: string;
    cmdline: string;
    cwd: string;
    byagent: boolean;
    launchercmdline?: string;
    repo?: string;
    owner?: DevServerOwner;
}

const LABEL_MAX = 60;
// a first token that only launches the script after it: the label starts at the script
const INTERPRETERS = new Set(["node", "bun", "deno", "python", "python3", "ruby"]);
// script names that say nothing about the package they sit in: the label names the package's directory instead
const GENERIC_SCRIPTS = new Set(["cli", "index", "bin", "main", "run"]);
// directories between such a script and its package's directory
const PACKAGE_SUBDIRS = new Set(["bin", "dist", "lib", "src"]);

// whitespace-separated tokens; a double-quoted run is one token, quotes dropped
function tokenize(cmdline: string): string[] {
    const tokens: string[] = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cmdline)) != null) {
        tokens.push(m[1] ?? m[2]);
    }
    return tokens;
}

function pathSegments(p: string): string[] {
    return p.split(/[\\/]/).filter((s) => s !== "");
}

function stripExtension(file: string): string {
    const dot = file.lastIndexOf(".");
    return dot > 0 ? file.slice(0, dot) : file;
}

function isPath(token: string): boolean {
    return token.includes("/") || token.includes("\\");
}

// a script path as a short name: its file name, or for a generic one (…\vite\bin\cli.js) the package's directory
function shortenPath(token: string): string {
    const segs = pathSegments(token);
    if (segs.length === 0) {
        return token;
    }
    const base = stripExtension(segs[segs.length - 1]);
    if (!GENERIC_SCRIPTS.has(base.toLowerCase())) {
        return base;
    }
    for (let i = segs.length - 2; i >= 0; i--) {
        if (!PACKAGE_SUBDIRS.has(segs[i].toLowerCase())) {
            return segs[i];
        }
    }
    return base;
}

// `node …\astro\astro.js dev` → `astro dev`; an empty command line reads as the process name
export function serverLabel(row: DevServerRow): string {
    const tokens = tokenize(row.cmdline ?? "");
    if (tokens.length === 0) {
        return row.name;
    }
    const first = pathSegments(tokens[0]).pop() ?? tokens[0];
    if (tokens.length > 1 && INTERPRETERS.has(stripExtension(first).toLowerCase())) {
        tokens.shift();
    }
    if (isPath(tokens[0])) {
        tokens[0] = shortenPath(tokens[0]);
    }
    const label = tokens.join(" ");
    return label.length > LABEL_MAX ? label.slice(0, LABEL_MAX - 1) + "…" : label;
}

export function serverUrl(port: number): string {
    return `http://localhost:${port}`;
}

// ":4321 :24678"
export function portsLabel(ports: number[]): string {
    return ports.map((p) => `:${p}`).join(" ");
}

export function ownerLabel(row: DevServerRow): string {
    return row.byagent ? "this agent" : "already running";
}

// "45s", "12m", "2h 14m", "3d 4h"; createms and now are epoch milliseconds
export function uptimeLabel(createms: number, now: number): string {
    const secs = Math.max(0, Math.floor((now - createms) / 1000));
    if (secs < 60) {
        return `${secs}s`;
    }
    const mins = Math.floor(secs / 60);
    if (mins < 60) {
        return `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
        return `${hours}h ${mins % 60}m`;
    }
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function copyText(row: DevServerRow): string {
    return `PID ${row.pid}\n${row.cmdline}`;
}

// quotes and backslashes differ between a command as the agent typed it and as the shell's argv shows it
function normalizeCommand(cmd: string): string {
    return cmd
        .replace(/["'\\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// The running background task whose command a launcher command line holds: the task that started that process, which
// has an output file to read as its log. Structural on the task so it needs no import from transcriptprojection.ts.
export function matchLauncherTask<T extends { command?: string; status: string; outputFile?: string }>(
    launcherCmdline: string | undefined,
    tasks: T[]
): T | undefined {
    if (!launcherCmdline) {
        return undefined;
    }
    const launcher = normalizeCommand(launcherCmdline);
    return tasks.find((t) => {
        if (t.status !== "running" || !t.outputFile || !t.command) {
            return false;
        }
        const cmd = normalizeCommand(t.command);
        return cmd !== "" && launcher.includes(cmd);
    });
}

// The running background task whose command launched this server. Only a server this agent started has one (its
// launcher command line holds the task's command).
export function matchLogTask<T extends { command?: string; status: string; outputFile?: string }>(
    row: DevServerRow,
    tasks: T[]
): T | undefined {
    return row.byagent ? matchLauncherTask(row.launchercmdline, tasks) : undefined;
}

// how often the rail asks for listening servers: fast while the rail is on screen, slow enough to keep the strip's
// count current otherwise
export function pollMs(railVisible: boolean): number {
    return railVisible ? 5000 : 30000;
}
