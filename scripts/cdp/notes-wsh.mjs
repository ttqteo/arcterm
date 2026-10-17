// notes-wsh: `wsh note add|list|show|delete` (cmd/wsh/cmd/wshcmd-note.go) run as the real binary against the dev
// app's wavesrv. wsh needs a WAVETERM_JWT only wavesrv mints, so node cannot run it: a cmd block with cmd:jwt runs a
// driver script the scenario writes, which calls the wsh this tree built and leaves each command's result in a file.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const BODY_LINES = ["first line of the body", "second line of the body"];
// the shell's own startup (a pwsh profile) comes before the driver's first command
const DRIVER_WAIT_MS = 60_000;
const POLL_MS = 200;

// the wsh the dev app's build wrote, never PATH's: that one may be the installed Arc's
function builtWsh() {
    const { version } = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    const os = process.platform === "win32" ? "windows" : process.platform;
    const ext = process.platform === "win32" ? ".exe" : "";
    return join(REPO, "dist", "bin", `wsh-${version}-${os}.${process.arch}${ext}`);
}

// mirrors wconfig.resolveVaultRoot
export async function vaultRoot(h) {
    const settings = (await h.rpc("getfullconfig", null))?.settings ?? {};
    const configured = settings["memory:vaultpath"];
    return configured ? configured.replace(/^~(?=$|[\\/])/, homedir()) : join(homedir(), ".waveterm", "vault");
}

// a vault with a remote is one the app pushes: a dev app pointed at it would publish the fixture note
export function vaultRemote(root) {
    if (!existsSync(join(root, ".git"))) return "";
    return execFileSync("git", ["-C", root, "remote"], { encoding: "utf8" }).trim();
}

// the driver stops after show until the scenario has read the app's own list, then deletes
const driverSource = (cfg) => `import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cfg = ${JSON.stringify(cfg)};
const mark = (name) => writeFileSync(join(cfg.dir, name), "");
const run = (name, args, input) => {
    const r = spawnSync(cfg.wsh, ["note", ...args], { input, encoding: "utf8" });
    const result = { code: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message };
    writeFileSync(join(cfg.dir, name + ".json"), JSON.stringify(result));
    return result;
};

const added = run("add", ["add", cfg.title, "--body", "-"], cfg.body);
const id = added.code === 0 ? added.stdout.trim().split(" ").pop() : "";
if (id) {
    run("list", ["list"]);
    run("show", ["show", id]);
    mark("listed");
    const deadline = Date.now() + cfg.waitMs;
    while (!existsSync(join(cfg.dir, "continue")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    run("delete", ["delete", id]);
    run("show-after", ["show", id]);
}
mark("done");
`;

async function waveService(h, service, method, args) {
    const [endpoint, key] = await h.ev(`[window.api.getEnv("WAVE_SERVER_WEB_ENDPOINT"), window.api.getAuthKey()]`);
    const res = await fetch(`http://${endpoint}/wave/service?service=${service}&method=${method}`, {
        method: "POST",
        headers: { "x-authkey": key },
        body: JSON.stringify({ service, method, args, uicontext: null }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body == null || body.error) throw new Error(`${service}.${method}: ${body?.error ?? `HTTP ${res.status}`}`);
    return body.data;
}

// a tab of its own: deleting the last block of a tab deletes the tab, so the page's tab is not borrowed
async function startDriver(h, ctx) {
    const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
    const wslist = await h.rpc("workspacelist", null);
    const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
    ctx.workspaceId = ws.workspacedata.oid;
    ctx.tabId = await waveService(h, "workspace", "CreateTab", [ctx.workspaceId, "verify-notes-wsh", false]);
    const tab = await waveService(h, "object", "GetObject", [`tab:${ctx.tabId}`]);
    const blockId = tab?.blockids?.[0];
    if (!blockId) throw new Error("the new tab has no block");
    // cmd:jwt puts WAVETERM_JWT in the command's env: nothing runs the shell integration that would swap it in.
    // the cwd is ~, not the temp dir, which the shell would keep locked past teardown
    await h.rpc("setmeta", {
        oref: `block:${blockId}`,
        meta: { view: "term", controller: "cmd", cmd: `node '${ctx.script}'`, "cmd:jwt": true, "cmd:cwd": "~" },
    });
    await h.rpc("controllerresync", { tabid: ctx.tabId, blockid: blockId, forcerestart: true });
}

async function waitForFile(path, ms) {
    for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
        if (existsSync(path)) return true;
        await sleep(POLL_MS);
    }
    return existsSync(path);
}

function result(ctx, name) {
    const path = join(ctx.dir, `${name}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const lines = (text) => (text ?? "").replace(/\r\n/g, "\n");
const show = (r) => JSON.stringify(r);

export const notesWsh = {
    name: "notes-wsh",
    surface: "cockpit",
    async arrange(h) {
        const stamp = Date.now().toString(36);
        const ctx = { stamp, title: `verify notes-wsh ${stamp}`, dir: mkdtempSync(join(tmpdir(), "verify-notes-wsh-")) };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            ctx.vault = await vaultRoot(h);
            const remote = vaultRemote(ctx.vault);
            if (remote) throw new Error(`the vault ${ctx.vault} has a git remote (${remote}): not writing a fixture note into it`);
            ctx.wsh = builtWsh();
            if (!existsSync(ctx.wsh)) throw new Error(`no built wsh at ${ctx.wsh}`);
            ctx.script = join(ctx.dir, "driver.mjs");
            writeFileSync(
                ctx.script,
                driverSource({ wsh: ctx.wsh, dir: ctx.dir, title: ctx.title, body: BODY_LINES.join("\n") + "\n", waitMs: DRIVER_WAIT_MS })
            );
            await startDriver(h, ctx);
        } catch (e) {
            ctx.launchError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        if (ctx.launchError != null) return [{ step: "the driver started", ok: false, detail: ctx.launchError }];
        const steps = [];
        const listed = await waitForFile(join(ctx.dir, "listed"), DRIVER_WAIT_MS);
        const add = result(ctx, "add");
        const id = /^added note (\d{4}-\d{2}-\d{2}-\S+)\r?\n$/.exec(add?.stdout ?? "")?.[1];
        steps.push({ step: "1. wsh note add prints the new note's id", ok: add?.code === 0 && id != null, detail: show(add) });

        const list = result(ctx, "list");
        steps.push({
            step: "2. wsh note list shows it, id then title",
            ok: id != null && list?.code === 0 && lines(list.stdout).split("\n").includes(`${id}\t${ctx.title}`),
            detail: `want "${id}\\t${ctx.title}" in ${show(list)}`,
        });

        const shown = result(ctx, "show");
        steps.push({
            step: "3. wsh note show prints the title heading and the body",
            ok: shown?.code === 0 && lines(shown.stdout) === `# ${ctx.title}\n\n${BODY_LINES.join("\n")}\n`,
            detail: show(shown),
        });

        const inApp = listed ? ((await h.rpc("notelist", null)) ?? []).find((n) => n.id === id) : null;
        steps.push({
            step: "4. the note the command wrote is the one the app lists",
            ok: inApp != null && inApp.title === ctx.title && inApp.body === BODY_LINES.join("\n"),
            detail: `vault ${ctx.vault}: ${show(inApp ?? null)}`,
        });

        writeFileSync(join(ctx.dir, "continue"), "");
        const done = await waitForFile(join(ctx.dir, "done"), DRIVER_WAIT_MS);
        const del = result(ctx, "delete");
        const after = result(ctx, "show-after");
        const left = done ? ((await h.rpc("notelist", null)) ?? []).some((n) => n.id === id) : null;
        steps.push({
            step: "5. wsh note delete removes it",
            ok:
                del?.code === 0 &&
                left === false &&
                after != null &&
                after.code !== 0 &&
                `${after.stdout}${after.stderr}`.includes("not found"),
            detail: `still listed=${left} delete=${show(del)} show=${show(after)}`,
        });
        return steps;
    },
    async teardown(h, ctx) {
        const failed = [];
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                failed.push(`${what}: ${e?.message ?? e}`);
            }
        };
        // lets a driver still waiting run on to its exit before its tab closes
        await step("release the driver", () => writeFileSync(join(ctx.dir, "continue"), ""));
        if (ctx.tabId) {
            await step("close the driver's tab", () => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, ctx.tabId, false]));
        }
        await step("delete the notes this run left", async () => {
            for (const n of (await h.rpc("notelist", null)) ?? []) {
                if (n.title.includes(ctx.stamp)) await h.rpc("notedelete", { id: n.id });
            }
        });
        await step("remove the temp dir", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
        if (failed.length > 0) throw new Error(failed.join("; "));
    },
};
