// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Servers section of the Agent details rail, as pure functions: the label a row shows for a listening process,
// its port and owner text, its uptime, which running background task (if any) wrote its log, which arcterm terminal
// (if any) holds it, and how often the rail asks the backend. No React, atoms or RPC; devserversstore.ts polls and
// agentdetailsrail.tsx renders.

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

// who holds the server, as the row's second line says it. task is the background task of this agent that started it
// (matchLogTask), which names the agent as its owner after the launcher exited.
export function ownerLabel(row: DevServerRow, task?: unknown): string {
    if (row.byagent || task != null) {
        return "this agent";
    }
    if (row.owner?.kind === "terminal") {
        return `terminal · ${row.owner.name || "Terminal"}`;
    }
    return "already running";
}

// the arcterm terminal a server runs in: its pane is the server's log
export interface TerminalLog {
    tabId: string;
    blockId: string;
}

export function terminalLog(row: DevServerRow): TerminalLog | null {
    const o = row.owner;
    return o?.kind === "terminal" && o.tabid && o.blockid ? { tabId: o.tabid, blockId: o.blockid } : null;
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

// shell redirections the agent's command carries and a launcher's argv never shows: `2>&1`, `> out.log`,
// `&>/dev/null`, `< /dev/null`, and a trailing `&`
const REDIRECT = /\s*(?:&>>?|\d*>>?&?|\d*<)\s*[^\s;&|]+/g;

function stripRedirects(cmd: string): string {
    return cmd.replace(REDIRECT, "").replace(/\s*&\s*$/, "");
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
        const cmd = normalizeCommand(stripRedirects(t.command));
        return cmd !== "" && launcher.includes(cmd);
    });
}

// The background task that ended on its own while the server it started came up: a launcher that daemonizes the
// server and exits (Astro 7's `astro dev`, a `start` that forks), leaving the server with no parent to trace. It is
// the task that was running when the server's process was created. A stopped task is not one: whoever stopped it
// meant the server to go, and what outlived it is a stray.
export function matchEndedTask<T extends { status: string; outputFile?: string; startMs?: number; endMs?: number }>(
    createms: number,
    tasks: T[]
): T | undefined {
    if (!(createms > 0)) {
        return undefined;
    }
    return tasks.find(
        (t) =>
            (t.status === "completed" || t.status === "failed") &&
            t.outputFile &&
            t.startMs != null &&
            t.endMs != null &&
            t.startMs <= createms &&
            createms <= t.endMs
    );
}

// The background task that launched this server: the running task whose command its launcher command line holds,
// also for a chain broken under the agent (wavesrv gives such a row its highest live ancestor as launcher), or for a
// server whose launcher exited, the task that ended as it came up (matchEndedTask). A server a terminal holds has none.
export function matchLogTask<
    T extends { command?: string; status: string; outputFile?: string; startMs?: number; endMs?: number },
>(row: DevServerRow, tasks: T[]): T | undefined {
    if (row.byagent) {
        return matchLauncherTask(row.launchercmdline, tasks);
    }
    if (row.owner?.kind === "terminal") {
        return undefined;
    }
    return matchLauncherTask(row.launchercmdline, tasks) ?? matchEndedTask(row.createms, tasks);
}

// how often the rail asks for listening servers: fast while the rail is on screen, slow enough to keep the strip's
// count current otherwise
export function pollMs(railVisible: boolean): number {
    return railVisible ? 5000 : 30000;
}
