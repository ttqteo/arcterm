// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council scenarios (docs/superpowers/plans/2026-10-21-council.md, Tasks 13 to 16) share. The scenarios never
// spend tokens or start a real agent, so a council is a JSON file written straight into <data dir>/councils (the six
// rail-apps-*.json fixtures, the canvas's Rail apps content), and every action that would call a model has its RpcApi
// command replaced in the page (stubRpc), the way the dag-peek scenario replaces DagActionCommand.
//
//   arrangeCouncilProject  a registered temp git repo with a terminal in it (so the project has a folder in the Agent
//                          tree even with no council), and a reload so the page boots with the project known
//   writeCouncil / seedCouncil  one fixture council into the data dir, moved to where it should sit on the clock
//   openCouncil / openCouncilSetup  the DEV hook window.__arcCouncil (councilpane.tsx), then the view's root
//   stubRpc, resolveStub, rejectStub, rpcCalls, unstubRpc  the page-side stand-ins for RpcApi commands
//   teardownCouncilProject  the reverse of all of it
//
// scenarios.mjs hands the helpers it owns in through `fx`: waitForProjectInConfig, polishReload, openRailTerminal,
// waveService (and openPalette, for the scenarios that drive the palette). They are kept on the ctx the arrange returns,
// so a teardown(h, ctx) needs nothing else.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "../attach.mjs";

export const COUNCIL_PROJECT = "council-fixture";
export const COUNCIL_FIXTURES = ["round1", "round2", "awaiting", "done", "failed", "notrun"];
export const COUNCIL_ID_PREFIX = "fx-council-";
export const councilFixtureId = (name) => `${COUNCIL_ID_PREFIX}${name}`;

const STUB_KEY = "__arcCouncilStub";
const MINUTE = 60_000;
const ROOT_WAIT_MS = 10_000;

// Where each fixture sits on the clock. A running council's clock is `now - started`, so those two end at "now" and
// their header reads 3:48 and 7:20 whenever the scenario looks; the rest are placed by when they were created, so the
// tree (newest created first) lists round1, round2, awaiting, failed, done, notrun.
const PLACE = {
    round1: { updatedAgoMs: 0 },
    round2: { updatedAgoMs: 0 },
    awaiting: { createdAgoMs: 15 * MINUTE },
    failed: { createdAgoMs: 25 * MINUTE },
    done: { createdAgoMs: 40 * MINUTE },
    notrun: { createdAgoMs: 60 * MINUTE },
};

/** The fixture as authored (project empty, times around 2026-10-21 09:00 UTC). */
export function loadCouncilFixture(name) {
    if (!COUNCIL_FIXTURES.includes(name)) {
        throw new Error(`no council fixture "${name}" (have ${COUNCIL_FIXTURES.join(", ")})`);
    }
    return JSON.parse(readFileSync(new URL(`./rail-apps-${name}.json`, import.meta.url), "utf8"));
}

/** A copy of the fixture in `project`, every time on it (created, updated, started, proposal and reply times, the
 *  summary's) moved by the same amount, so the gaps between them stay as authored. */
export function placeCouncil(raw, name, project, now = Date.now()) {
    const place = PLACE[name];
    const delta =
        "updatedAgoMs" in place ? now - place.updatedAgoMs - raw.updated : now - place.createdAgoMs - raw.created;
    const c = structuredClone(raw);
    c.project = project;
    c.created += delta;
    c.updated += delta;
    if (c.started) c.started += delta;
    for (const p of c.proposals ?? []) p.ts += delta;
    for (const r of c.replies ?? []) r.ts += delta;
    if (c.summary) c.summary.at += delta;
    return c;
}

const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

function makeRepo(dir) {
    mkdirSync(dir, { recursive: true });
    const git = (...args) =>
        execFileSync("git", ["-C", dir, "-c", "user.name=verify", "-c", "user.email=verify@example.invalid", ...args], {
            stdio: "pipe",
        });
    git("init", "-q");
    writeFileSync(join(dir, "README.md"), "# council fixture\n");
    git("add", "README.md");
    git("commit", "-q", "-m", "init");
    return dir;
}

// the fixture councils an earlier run left (it died before its teardown), and whatever a rename left half-way
function clearCouncilFiles(dataDir, ids = []) {
    const dir = join(dataDir, "councils");
    const names = new Set(ids.map((id) => `${id}.json`));
    if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
            if (f.startsWith(COUNCIL_ID_PREFIX)) names.add(f);
        }
    }
    for (const f of names) rmSync(join(dir, f), { force: true });
}

/** Makes the fixture project(s), each a temp git repo registered with createproject and holding one terminal, then
 *  reloads so the page boots knowing them. `opts.name` renames the first project (default COUNCIL_PROJECT);
 *  `opts.extraProjects` is more project names, each the same, for a tree that needs a project with no council. The
 *  ctx has `project` / `repo` (the first), `projects` ([{ name, repo }]), `dataDir`, `workspaceId`, `terminals`,
 *  `written` ({ id: project path } of the councils writeCouncil made) and `fx`. A throw tears down what it made. */
export async function arrangeCouncilProject(h, fx, opts = {}) {
    const base = mkdtempSync(join(tmpdir(), "verify-council-"));
    const ctx = { fx, base, projects: [], terminals: [], written: {}, dataDir: null, workspaceId: null };
    try {
        ctx.dataDir = (await h.rpc("waveinfo", null)).datadir;
        clearCouncilFiles(ctx.dataDir);
        for (const name of [opts.name ?? COUNCIL_PROJECT, ...(opts.extraProjects ?? [])]) {
            const repo = makeRepo(join(base, name));
            // a project an earlier run left behind would make createproject refuse
            await h.rpc("deleteproject", { name }).catch(() => {});
            await h.rpc("createproject", { name, path: repo });
            ctx.projects.push({ name, repo });
            await fx.waitForProjectInConfig(h, name);
        }
        ctx.project = ctx.projects[0].name;
        ctx.repo = ctx.projects[0].repo;
        const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
        const wslist = await h.rpc("workspacelist", null);
        const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
        ctx.workspaceId = ws.workspacedata.oid;
        // projectTree builds a folder only for a project with agents, terminals, a queue or services
        for (const p of ctx.projects) await fx.openRailTerminal(h, ctx, p.name);
        await fx.polishReload(h);
        return ctx;
    } catch (e) {
        await teardownCouncilProject(h, ctx).catch(() => {});
        throw e;
    }
}

/** The reverse of arrangeCouncilProject: the page's stubs, the terminals, the fixture councils, the projects (and the
 *  channels createproject made), the temp dir, then a reload onto the restored state. Each step is its own, so one that
 *  fails still lets the rest run. */
export async function teardownCouncilProject(h, ctx) {
    const step = async (what, fn) => {
        try {
            await fn();
        } catch (e) {
            console.error(`council fixtures teardown: ${what} failed: ${e?.message ?? e}`);
        }
    };
    await step("restore the RpcApi commands", () => unstubRpc(h));
    for (const t of ctx.terminals ?? []) {
        await step(`close the terminal ${t.tabId}`, () =>
            ctx.fx.waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false])
        );
    }
    if (ctx.dataDir) {
        await step("delete the fixture councils", () => clearCouncilFiles(ctx.dataDir, Object.keys(ctx.written ?? {})));
    }
    for (const p of ctx.projects ?? []) {
        await step(`remove the project ${p.name}`, async () => {
            await h.rpc("deleteproject", { name: p.name });
            // deleteproject leaves the channel createproject made, so that goes too
            const channels = (await h.rpc("getchannels", null))?.channels ?? [];
            for (const c of channels.filter((c) => norm(c.projectpath) === norm(p.repo))) {
                await h.rpc("deletechannel", { channelid: c.oid });
            }
        });
    }
    await step("remove the temp dir", () =>
        rmSync(ctx.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    );
    await step("reload onto the restored state", () => ctx.fx.polishReload(h));
}

/** Writes a fixture council into the data dir, in `opts.repo` (default the ctx's first project), at `opts.now`, and
 *  answers its id. `opts.id` writes it under another id (the same fixture twice), `opts.edit(c)` changes the record
 *  before it is written. The file goes in by a rename, so wavesrv never reads half of one. It publishes nothing:
 *  announceCouncil does, for a page that has the council or its list loaded already. */
export function writeCouncil(ctx, name, opts = {}) {
    const c = placeCouncil(loadCouncilFixture(name), name, opts.repo ?? ctx.repo, opts.now);
    if (opts.id) c.id = opts.id;
    opts.edit?.(c);
    const dir = join(ctx.dataDir, "councils");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${c.id}.json`);
    const body = JSON.stringify(c, null, 2) + "\n";
    writeFileSync(`${file}.tmp`, body);
    try {
        renameSync(`${file}.tmp`, file);
    } catch {
        // Windows refuses to replace a file wavesrv has open at that moment: write over it instead
        writeFileSync(file, body);
        rmSync(`${file}.tmp`, { force: true });
    }
    ctx.written[c.id] = c.project;
    return c.id;
}

/** Tells the page a council changed (`council:changed`, as wavesrv does after a save), so its tree row and open view
 *  reload. The page subscribes once it has read a council or a list, so before that this changes nothing and the first
 *  read finds the file anyway. */
export async function announceCouncil(h, ctx, id) {
    await h.rpc("eventpublish", { event: "council:changed", data: { id, project: ctx.written[id] ?? ctx.repo } });
}

/** writeCouncil, then announceCouncil. */
export async function seedCouncil(h, ctx, name, opts = {}) {
    const id = writeCouncil(ctx, name, opts);
    await announceCouncil(h, ctx, id);
    return id;
}

async function councilHook(h) {
    if (!(await h.ev("!!window.__arcCouncil"))) {
        throw new Error("window.__arcCouncil is missing: the DEV build installs it (councilpane.tsx)");
    }
}

async function showRoot(h, view) {
    const root = `[data-council-${view}]`;
    if (!(await waitFor((e) => h.ev(e), `!!document.querySelector(${JSON.stringify(root)})`, ROOT_WAIT_MS))) {
        throw new Error(`${root} did not show within ${ROOT_WAIT_MS / 1000}s`);
    }
}

/** Opens a council in the Agent surface's centre, on its Discussion or its Summary, and waits for the view's root. */
export async function openCouncil(h, id, view = "discussion") {
    if (view !== "discussion" && view !== "summary") {
        throw new Error(`openCouncil opens the discussion or the summary, not "${view}" (openCouncilSetup opens Setup)`);
    }
    await councilHook(h);
    await h.ev(`window.__arcCouncil.showCouncil(${JSON.stringify(id)}, ${JSON.stringify(view)})`);
    await showRoot(h, view);
}

/** Opens a project's council Setup, its draft started again from `prefill` (a Partial<CouncilSetupDraft>) when given. */
export async function openCouncilSetup(h, project, prefill) {
    await councilHook(h);
    const draft = prefill == null ? "undefined" : JSON.stringify(prefill);
    await h.ev(`window.__arcCouncil.showCouncilSetup(${JSON.stringify(project)}, ${draft})`);
    await showRoot(h, "setup");
}

/** Opens a project's council Setup the way a person does: New, the Council row, the project, Set up council. Returns
 *  what each part did, `ok` when Setup shows and the dialog has closed. The dialog is opened through its DEV seam
 *  (`__openLauncher`), which the app bar's New button calls the same way. It opens with the Start column folded into a
 *  chip, so the Council row is clicked after fx.openLauncherStart (scenarios.mjs) opens it; the click folds it again,
 *  and the chip then names the pick. */
export async function openSetupFromNew(h, project, fx) {
    const until = (expr, ms = 5_000) => waitFor((e) => h.ev(e), expr, ms);
    const opened =
        (await h.ev(`(() => {
            if (typeof window.__openLauncher !== "function") return false;
            window.__openLauncher("agent");
            return true;
        })()`)) && (await until(`!!document.querySelector("[data-launcher]")`));
    await fx.openLauncherStart(h);
    await h.ev(`document.querySelector('[data-start-row="council"]')?.click()`);
    const picked = await until(`document.querySelector("[data-launcher-chip]")?.getAttribute("data-launcher-chip") === "council"`);
    await h.ev(`document.querySelector(${JSON.stringify(`[data-project-row="${project}"]`)})?.click()`);
    const inProject = await until(
        `document.querySelector(${JSON.stringify(`[data-project-row="${project}"]`)})?.getAttribute("aria-checked") === "true"`
    );
    const label = await h.ev(`(() => {
        const b = [...document.querySelectorAll("[data-launcher] button")].find((x) => (x.textContent ?? "").includes("Set up council"));
        if (!b) return "";
        b.click();
        // the button's key-hint chip (a kbd) is not part of its label
        const own = b.cloneNode(true);
        own.querySelectorAll("kbd").forEach((k) => k.remove());
        return (own.textContent ?? "").replace(/\\s+/g, " ").trim();
    })()`);
    const setup = await until(`!!document.querySelector("[data-council-setup]") && !document.querySelector("[data-launcher]")`);
    return { ok: opened && picked && inProject && label !== "" && setup, opened, picked, inProject, label, setup };
}

// runs `body` in the page with `RpcApi` bound to the instance the app loaded: the module url is the one the app
// imported, so the import is its instance (dag-peek does the same for DagActionCommand)
const inPageApi = (body) => `(async () => {
    const hits = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\/wshclientapi\\.ts(\\?|$)/.test(n));
    const url = hits[hits.length - 1];
    if (!url) return { ok: false, why: "no wshclientapi module in the page's resources" };
    const { RpcApi } = await import(url);
    ${body}
})()`;

/** Replaces RpcApi commands (their method names: `CouncilStartCommand`) in the page, so nothing reaches wavesrv and a
 *  model is never called. Each records its calls (`rpcCalls`) and answers by `opts[name]`:
 *    { value }    resolves with `value` (default null), a copy each time
 *    { pending }  stays open until resolveStub(h, name, value) or rejectStub(h, name, message)
 *    { reject }   rejects with an Error of that message
 *  The council store reads RpcApi.<X>Command when an action runs, so the next click takes the stand-in. Stubbing a
 *  name again changes how it answers and keeps the original to restore. */
export async function stubRpc(h, names, opts = {}) {
    const modes = {};
    for (const name of names) {
        const o = opts[name] ?? {};
        modes[name] = { value: o.value ?? null, pending: o.pending === true, reject: o.reject ?? null };
    }
    const r = await h.ev(
        inPageApi(`
    const names = ${JSON.stringify(names)};
    const modes = ${JSON.stringify(modes)};
    const missing = names.filter((n) => typeof RpcApi[n] !== "function");
    if (missing.length > 0) return { ok: false, why: "no RpcApi." + missing.join(", RpcApi.") };
    const st = (window.${STUB_KEY} ??= { api: RpcApi, saved: {}, calls: [], waiting: [] });
    st.api = RpcApi;
    for (const name of names) {
        if (!(name in st.saved)) st.saved[name] = Object.prototype.hasOwnProperty.call(RpcApi, name) ? RpcApi[name] : null;
        const mode = modes[name];
        RpcApi[name] = function (client, data) {
            st.calls.push({ name, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) });
            if (mode.reject != null) return Promise.reject(new Error(mode.reject));
            if (mode.pending) return new Promise((resolve, reject) => st.waiting.push({ name, resolve, reject }));
            return Promise.resolve(structuredClone(mode.value));
        };
    }
    return { ok: true };`)
    );
    if (!r?.ok) throw new Error(`stubRpc: ${r?.why ?? "the page gave no answer"}`);
}

/** The calls the stand-ins took, oldest first, as `{ name, data }` (`data` null for a command with none); one command's
 *  when `name` is given. */
export function rpcCalls(h, name) {
    const only = name == null ? "true" : `c.name === ${JSON.stringify(name)}`;
    return h.ev(`(window.${STUB_KEY}?.calls ?? []).filter((c) => ${only})`);
}

function settleStub(h, name, how, value) {
    return h.ev(`(() => {
        const st = window.${STUB_KEY};
        if (!st) return 0;
        const v = ${JSON.stringify(value ?? null)};
        const mine = st.waiting.filter((w) => w.name === ${JSON.stringify(name)});
        st.waiting = st.waiting.filter((w) => w.name !== ${JSON.stringify(name)});
        for (const w of mine) ${how === "resolve" ? "w.resolve(structuredClone(v))" : "w.reject(new Error(v))"};
        return mine.length;
    })()`);
}

/** Resolves every call of a `pending` stand-in that is still open with `value`; answers how many were open. */
export const resolveStub = (h, name, value = null) => settleStub(h, name, "resolve", value);

/** Rejects every call of a `pending` stand-in that is still open with an Error of `message`; answers how many. */
export const rejectStub = (h, name, message) => settleStub(h, name, "reject", message);

/** Puts every replaced command back (a call still open is dropped) and forgets the recorded calls. Safe to call twice,
 *  and after a reload took the stand-ins with it. */
export function unstubRpc(h) {
    return h.ev(`(() => {
        const st = window.${STUB_KEY};
        if (!st) return "absent";
        for (const [name, original] of Object.entries(st.saved)) {
            if (original != null) st.api[name] = original;
            else delete st.api[name];
        }
        delete window.${STUB_KEY};
        return "restored";
    })()`);
}
