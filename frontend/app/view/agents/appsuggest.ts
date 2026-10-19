// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What the add-a-tool form suggests for a pinned app once its folder is picked: the package.json scripts that run a
// server, each with the line that runs it and the port it listens on, read from the code rather than run. Pure: the
// store (appsuggeststore.ts) reads the files and passes their text in. A guess the code cannot back is marked so, and
// every field it fills stays editable.

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

// the lockfiles that name a package manager, in the order they are looked for; none is npm
export const LOCKFILES: [string, PackageManager][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
];

export function packageManager(present: string[]): PackageManager {
    const have = new Set(present);
    return LOCKFILES.find(([file]) => have.has(file))?.[1] ?? "npm";
}

export function runLine(pm: PackageManager, script: string): string {
    switch (pm) {
        case "yarn":
            return `yarn ${script}`;
        case "pnpm":
        case "bun":
            return `${pm} run ${script}`;
        default:
            return `npm run ${script}`;
    }
}

// The file a script runs with node (or tsx, ts-node, bun), relative to the folder: `node live/server.mjs` gives
// live/server.mjs. The first such word of the script; null when it runs no file of its own (vite, next, a shell script).
export function scriptEntry(body: string): string | null {
    const m = body.match(
        /(?:^|[\s;&|])(?:node|tsx|ts-node|bun)\s+(?:watch\s+)?(?:--?[\w-]+(?:=\S+)?\s+)*([\w./@-]+\.(?:m?js|cjs|ts|mts))\b/
    );
    return m ? m[1].replace(/^\.\//, "") : null;
}

// the scripts whose name says it serves something
const SERVER_NAMES = /^(dev|start|serve|server|preview|dash|dashboard|web|ui|app)(:|$)/;
// the tools whose command is a server
const SERVER_TOOLS =
    /\b(vite|next\s+(dev|start)|astro\s+(dev|preview)|nuxt|remix|http-server|serve|webpack\s+serve|svelte-kit\s+dev|ng\s+serve|react-scripts\s+start|docusaurus\s+start|eleventy\s+--serve|parcel)\b/;
// a script that tests, checks or builds is not one, even under a server-like name
const NOT_SERVER = /\b(vitest|jest|mocha|playwright|tsc|eslint|prettier|pm2)\b|\bvite\s+build\b/;
const LISTENS = /\.listen\s*\(|createServer\s*\(|Bun\.serve\s*\(|serve\s*\(\s*\{/;

// Whether a script starts a server: by its own command, by the file it runs listening, or by its name
export function isServerScript(name: string, body: string, entrySource: string | null): boolean {
    if (NOT_SERVER.test(body)) {
        return false;
    }
    if (SERVER_TOOLS.test(body) || (entrySource != null && LISTENS.test(entrySource))) {
        return true;
    }
    // a name alone counts only when the script runs no file that could say otherwise
    return entrySource == null && SERVER_NAMES.test(name);
}

const VALID_PORT = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;

function firstPort(text: string, patterns: RegExp[]): number | null {
    for (const re of patterns) {
        const m = text.match(re);
        if (m) {
            const n = Number(m[1]);
            if (VALID_PORT(n)) {
                return n;
            }
        }
    }
    return null;
}

// the default port of the tool a script runs, a guess when nothing in the folder names one
const TOOL_DEFAULTS: [RegExp, number][] = [
    [/\bvite\s+preview\b/, 4173],
    [/\bvite\b/, 5173],
    [/\bnext\s+(dev|start)\b/, 3000],
    [/\bastro\s+(dev|preview)\b/, 4321],
    [/\bnuxt\b/, 3000],
    [/\breact-scripts\s+start\b/, 3000],
    [/\bng\s+serve\b/, 4200],
    [/\bdocusaurus\s+start\b/, 3000],
    [/\bhttp-server\b/, 8080],
];

export interface PortGuess {
    port: number;
    sure: boolean; // read from the folder's code or config; false for a tool's default
}

export interface PortSources {
    entrySource?: string | null; // the file the script runs
    env?: string | null; // the folder's .env
    viteConfig?: string | null; // vite.config.{ts,js,mjs}
}

// The port a script's server listens on: the script's own flag or PORT=, then the folder's .env PORT, then the file it
// runs (`PORT || 8386`, `listen(8386`), then vite.config's `port:`, then the tool's default as a guess. Null: none.
export function guessPort(body: string, src: PortSources = {}): PortGuess | null {
    const own = firstPort(body, [/(?:--port|-p)[\s=]+(\d{2,5})\b/, /\bPORT=(\d{2,5})\b/]);
    if (own != null) {
        return { port: own, sure: true };
    }
    const env = src.env ? firstPort(src.env, [/^\s*PORT\s*=\s*["']?(\d{2,5})/m]) : null;
    if (env != null) {
        return { port: env, sure: true };
    }
    if (src.entrySource) {
        const code = firstPort(src.entrySource, [
            /PORT[^\n]{0,40}?(?:\|\||\?\?)\s*["']?(\d{2,5})\b/,
            /\bport\s*[:=]\s*(\d{2,5})\b/i,
            /\.listen\s*\(\s*(\d{2,5})\b/,
        ]);
        if (code != null) {
            return { port: code, sure: true };
        }
    }
    if (src.viteConfig && /\bvite\b/.test(body)) {
        const vite = firstPort(src.viteConfig, [/\bport\s*:\s*(\d{2,5})\b/]);
        if (vite != null) {
            return { port: vite, sure: true };
        }
    }
    for (const [re, port] of TOOL_DEFAULTS) {
        if (re.test(body)) {
            return { port, sure: false };
        }
    }
    return null;
}

export interface ScriptSuggestion {
    script: string;
    body: string; // what package.json runs for it
    command: string; // the line typed into the app's terminal
    server: boolean;
    port: PortGuess | null; // a server's
}

export interface FolderFiles {
    packageJson: string | null;
    lockfiles: string[]; // the LOCKFILES names present
    entries: Record<string, string | null>; // scriptEntry path -> its text
    env?: string | null;
    viteConfig?: string | null;
}

// The folder's scripts, servers first in package.json order, then the rest. [] when there is no readable package.json.
export function suggestScripts(files: FolderFiles): ScriptSuggestion[] {
    let scripts: Record<string, unknown> = {};
    try {
        const pkg: unknown = JSON.parse(files.packageJson ?? "");
        const s = (pkg as { scripts?: unknown })?.scripts;
        if (s != null && typeof s === "object") {
            scripts = s as Record<string, unknown>;
        }
    } catch {
        return [];
    }
    const pm = packageManager(files.lockfiles);
    const out: ScriptSuggestion[] = [];
    for (const [script, raw] of Object.entries(scripts)) {
        if (typeof raw !== "string") {
            continue;
        }
        const entry = scriptEntry(raw);
        const entrySource = entry != null ? (files.entries[entry] ?? null) : null;
        const server = isServerScript(script, raw, entrySource);
        out.push({
            script,
            body: raw,
            command: runLine(pm, script),
            server,
            port: server ? guessPort(raw, { entrySource, env: files.env, viteConfig: files.viteConfig }) : null,
        });
    }
    return [...out.filter((s) => s.server), ...out.filter((s) => !s.server)];
}

// the files suggestScripts may want read beside package.json: each script's entry, at most `max`
export function entriesToRead(packageJson: string | null, max = 12): string[] {
    try {
        const scripts = (JSON.parse(packageJson ?? "") as { scripts?: Record<string, unknown> })?.scripts ?? {};
        const out = new Set<string>();
        for (const raw of Object.values(scripts)) {
            const entry = typeof raw === "string" ? scriptEntry(raw) : null;
            if (entry != null && !entry.includes("..")) {
                out.add(entry);
            }
        }
        return [...out].slice(0, max);
    } catch {
        return [];
    }
}

// the last folder of a path, the name a new app takes when it has none yet
export function folderName(dir: string): string {
    const parts = dir
        .trim()
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/);
    const last = parts[parts.length - 1] ?? "";
    return last === "~" ? "" : last;
}

export function appUrlFor(port: number): string {
    return `http://127.0.0.1:${port}`;
}

// ---- pinning a running server ----

function oneLine(s: string): string {
    return s.trim().replace(/\s+/g, " ");
}

// A process's command line as a script would write it: the interpreter by its name, not its path
// (`C:\nvm4w\nodejs\node.exe live/server.mjs` reads `node live/server.mjs`).
export function plainCommand(cmdline: string): string {
    const text = cmdline.trim();
    const m = text.match(/^("([^"]+)"|(\S+))\s*([\s\S]*)$/);
    if (m == null) {
        return oneLine(text);
    }
    const prog = (m[2] ?? m[3])
        .split(/[\\/]/)
        .pop()!
        .replace(/\.(exe|cmd|bat)$/i, "");
    return oneLine(m[4] ? `${prog} ${m[4]}` : prog);
}

// a package manager's run line inside a launcher's command line (`bash -c "cd x && pnpm dev 2>&1"` gives `pnpm dev`)
export function runLineIn(launcher: string | undefined): string | null {
    const m = launcher?.match(/\b(npm|pnpm|yarn|bun)(\.cmd)?\s+((?:run\s+)?[\w:.-]+)/);
    if (m == null || /^(install|i|add|ci|exec|x|dlx)$/.test(m[3])) {
        return null;
    }
    return `${m[1]} ${m[3]}`;
}

export interface ServerSeen {
    ports: number[];
    cmdline: string;
    cwd: string;
    launchercmdline?: string;
}

export interface PinnedForm {
    name: string;
    command: string;
    url: string;
    dir: string;
}

// The add form's fields for a server seen running: its folder, its first port, and the line that starts it again. That
// line is the folder's script that runs what the process runs, else the run line its launcher used, else the script
// that serves on its port, else the process's own command line.
export function formFromServer(seen: ServerSeen, scripts: ScriptSuggestion[]): PinnedForm {
    const ran = plainCommand(seen.cmdline);
    const port = seen.ports[0];
    const command =
        scripts.find((s) => oneLine(s.body) === ran)?.command ??
        runLineIn(seen.launchercmdline) ??
        scripts.find((s) => s.server && s.port?.port === port)?.command ??
        ran;
    // a process's cwd can end in a separator (C:\x\app\); a drive or / alone keeps its own
    const dir = seen.cwd.length > 3 ? seen.cwd.replace(/[\\/]+$/, "") : seen.cwd;
    return {
        name: folderName(dir),
        command,
        url: port != null ? appUrlFor(port) : "",
        dir,
    };
}
