// Boots a dev app on a copy of the packaged arcterm's store, to review an area on real data
// (docs/reference/surface-review.md). Each start makes a fresh copy under %LOCALAPPDATA%\arc-snap: the databases
// (VACUUM INTO), the jarvis and memory-hygiene state, the config and the vault (without .git, so nothing is committed
// or pushed). wavesrv then runs on it with ARC_SNAPSHOT=1: it skips the boot work that reaches outside the copy
// (cmd/server snapshotSkips) and starts a process only inside the copy's scratch dir (pkg/blockcontroller).
// It takes the main dev app's ports (CDP 9222, Vite 5174), so it refuses while that app runs. Ctrl-C stops it.
//
//   node scripts/cdp/snapshot-dev.mjs [--dry-run]        (or: task dev:snapshot [-- --dry-run])
//
// --dry-run prints what a start would copy, the ports it checks and whether it would refuse, and copies and starts
// nothing; it exits 0 once it has printed. Only Windows is supported: elsewhere the script says so and exits
// EXIT_UNVERIFIED (3).
//
// Only the PID this script spawned is ever killed: the packaged arcterm shares the dev app's image names.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXIT_UNVERIFIED, inUse, killTree } from "./final-verify.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_PORTS = [
    ["CDP", 9222],
    ["Vite", 5174],
];
const DBS = ["waveterm.db", "filestore.db"];
const DATA_DIRS = ["jarvis", "memhygiene"];
const VAULT_KEY = "memory:vaultpath";
// the vault root under home when no setting names one (pkg/wconfig defaultVaultSubpath)
const DEFAULT_VAULT = join(".waveterm", "vault");
const SETTINGS_FILE = "settings.json";

function fail(msg) {
    console.error(`snapshot-dev: ${msg}`);
    process.exit(1);
}

// every path a start reads or writes, so --dry-run prints what the real run uses
export function snapshotLayout(local, home) {
    const packaged = join(local, "dev.arc.app");
    // short on purpose: wavesrv binds data\wave.sock under it, and Windows caps a unix socket path at 108 bytes
    const base = join(local, "arc-snap");
    return {
        packaged,
        packagedDbDir: join(packaged, "data", "db"),
        packagedData: join(packaged, "data"),
        packagedConfig: join(packaged, "config"),
        home,
        base,
        dbDir: join(base, "data", "db"),
        data: join(base, "data"),
        config: join(base, "config"),
        vault: join(base, "vault"),
        // wavesrv starts processes only under here (wavebase.SnapshotScratchDir)
        scratch: join(base, "scratch"),
        profile: join(base, "webview2"),
    };
}

// the environment `task dev` runs in
export function devEnv(layout) {
    return {
        ARC_DEV_DATA_DIR: layout.base,
        ARC_SNAPSHOT: "1",
        // with this, agent sync reads the harness dirs under ~ but writes none (agentsync.Paths.KeepHarnesses), the
        // vault is the copy's, and the host installs no global agent hooks
        ARC_DEV_NO_GLOBAL_INSTALL: "1",
        WEBVIEW2_USER_DATA_FOLDER: layout.profile,
        // a claude started from this shell inherits CLAUDE_CODE_CHILD_SESSION and would write no transcript, and the
        // cockpit hides an agent with no transcript entries
        CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: "1",
    };
}

function expandHome(p, home) {
    if (p === "~") return home;
    return /^~[\\/]/.test(p) ? join(home, p.slice(2)) : p;
}

function readSettings(path) {
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
        fail(`cannot read ${path}: ${e.message}`);
    }
}

// where the packaged app keeps its vault: the setting when it has one, else the default under home, as pkg/wconfig's
// VaultRoot resolves it
export function vaultSource(settings, home) {
    const set = settings[VAULT_KEY];
    return typeof set === "string" && set ? expandHome(set, home) : join(home, DEFAULT_VAULT);
}

async function portStates() {
    return Promise.all(DEV_PORTS.map(async ([name, port]) => ({ name, port, taken: await inUse(port) })));
}

// why a real start would refuse, in the order it checks
function refusals(layout, ports) {
    const out = [];
    for (const { name, port, taken } of ports) {
        if (taken) out.push(`${name} port :${port} is taken; stop the dev app using it first`);
    }
    if (!existsSync(join(layout.packagedDbDir, DBS[0]))) out.push(`no packaged store at ${layout.packaged}`);
    return out;
}

function printPlan(layout, ports, problems) {
    const settings = readSettings(join(layout.packagedConfig, SETTINGS_FILE));
    const vault = vaultSource(settings, layout.home);
    const present = (p) => (existsSync(p) ? "" : "  (not there: skipped)");
    const lines = [
        "snapshot-dev --dry-run: nothing is copied or started",
        `packaged store: ${layout.packaged}${present(layout.packaged)}`,
        `the copy: ${layout.base} (removed first, so each start is fresh)`,
        "would copy:",
        ...DBS.map((db) => `  ${join(layout.packagedDbDir, db)} -> ${join(layout.dbDir, db)}  (VACUUM INTO)`),
        ...DATA_DIRS.map((d) => `  ${join(layout.packagedData, d)} -> ${join(layout.data, d)}${present(join(layout.packagedData, d))}`),
        `  ${layout.packagedConfig} -> ${layout.config}  (${VAULT_KEY} then points at the vault copy)`,
        `  ${vault} -> ${layout.vault}  (without .git)${present(vault)}`,
        `would create: ${layout.scratch} (the only place a process starts), ${layout.profile} (WebView2 profile)`,
        "ports it checks (it refuses while one is taken):",
        ...ports.map(({ name, port, taken }) => `  ${name} :${port}  ${taken ? "TAKEN" : "free"}`),
        `then runs \`task dev\` in ${REPO} with:`,
        ...Object.entries(devEnv(layout)).map(([k, v]) => `  ${k}=${v}`),
    ];
    for (const p of problems) lines.push(`would refuse: ${p}`);
    console.log(lines.join("\n"));
}

// VACUUM INTO reads one consistent state while the packaged arcterm keeps writing; a file copy can catch the db and its
// -wal mid-write
async function copyDb(src, dest) {
    // imported here so --dry-run and the other-OS exit work on a node that has no node:sqlite
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(src, { readOnly: true });
    try {
        db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
    } finally {
        db.close();
    }
}

// the copied vault's path: the copied settings point at it, so the app never opens the real vault
function copyConfigAndVault(layout) {
    cpSync(layout.packagedConfig, layout.config, { recursive: true });
    const settingsPath = join(layout.config, SETTINGS_FILE);
    const settings = readSettings(settingsPath);
    const source = vaultSource(settings, layout.home);
    if (existsSync(source)) {
        cpSync(source, layout.vault, { recursive: true, filter: (p) => basename(p) !== ".git" });
    } else {
        console.warn(`snapshot-dev: no vault at ${source}; the copy starts with an empty one`);
        mkdirSync(layout.vault, { recursive: true });
    }
    settings[VAULT_KEY] = layout.vault;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export async function copyStore(layout) {
    try {
        rmSync(layout.base, { recursive: true, force: true });
    } catch (e) {
        fail(`cannot clear ${layout.base} (${e.code}); is a previous snapshot app still running?`);
    }
    mkdirSync(layout.dbDir, { recursive: true });
    for (const db of DBS) await copyDb(join(layout.packagedDbDir, db), join(layout.dbDir, db));
    for (const dir of DATA_DIRS) {
        const src = join(layout.packagedData, dir);
        if (existsSync(src)) cpSync(src, join(layout.data, dir), { recursive: true });
    }
    copyConfigAndVault(layout);
    mkdirSync(layout.scratch, { recursive: true });
    mkdirSync(layout.profile, { recursive: true });
}

async function main() {
    const args = process.argv.slice(2);
    const unknown = args.find((a) => a !== "--dry-run");
    if (unknown) fail(`unknown argument ${unknown}; the only option is --dry-run`);
    if (process.platform !== "win32" || !process.env.LOCALAPPDATA) {
        console.error(`snapshot-dev: only Windows is supported (the packaged store is %LOCALAPPDATA%\\dev.arc.app), not ${process.platform}; nothing was done`);
        process.exit(EXIT_UNVERIFIED);
    }
    const layout = snapshotLayout(process.env.LOCALAPPDATA, homedir());
    const ports = await portStates();
    const problems = refusals(layout, ports);
    if (args.includes("--dry-run")) {
        printPlan(layout, ports, problems);
        return;
    }
    if (problems.length) fail(problems[0]);

    await copyStore(layout);
    console.log(`snapshot-dev: store ${layout.base}, vault ${layout.vault}`);
    console.log(`snapshot-dev: launch agents only with cwd under ${layout.scratch}; CDP on :${DEV_PORTS[0][1]} once built`);

    // stdin stays an open pipe: `task dev` exits when its stdin closes
    const dev = spawn("task dev", {
        shell: true,
        cwd: REPO,
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, ...devEnv(layout) },
    });
    for (const sig of ["SIGINT", "SIGTERM"]) {
        process.on(sig, () => {
            killTree(dev.pid);
            process.exit(130);
        });
    }
    dev.on("exit", (code) => process.exit(code ?? 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => fail(e?.message ?? String(e)));
}
