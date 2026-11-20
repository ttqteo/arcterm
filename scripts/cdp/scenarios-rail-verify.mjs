// The agent rail's Verify tile, the header's Verify chip and the strip's Verify count, in each state of the spec's table
// (docs/superpowers/specs/2026-11-20-rail-verify-design.md; frontend/app/view/agents/railverify.tsx, verifymodel.ts), and the
// two buttons a row carries: Ask the agent to rerun and Skip.
// One fixture agent over a real tab (a terminal block with no controller, so nothing runs in it and nothing is typed into
// it) whose folder is a throwaway git repo holding `.arc/verify.json` (watch `frontend/**/*.tsx`) and `frontend/x.tsx`.
// The runs are reported to wavesrv the way the harness reports them (`verifyreport`, the RPC `wsh verify report` calls), for the
// fixture's block; a change after a run is a write to frontend/x.tsx whose mtime this file sets, since wavesrv judges "out of
// date" by the file's mtime against the run's last report. Between states the block's file under `<data dir>/verify/` is
// removed and the page reads the state again (verifystore.ts loadVerify), which is what a remount of the tile does: wavesrv
// publishes `verify:changed` for a report or a skip, never for a file that changed, so a change on its own shows at the next read.
// A line Ask the agent to rerun sends is recorded in the page and never forwarded, so no terminal receives it; the one
// forwarded, for the failed send, is sent to a block that does not exist and fails at the server as it should.
// kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor, polishNap, ahReload).
//
// Steps (each with a shot):
//   1. failed + no result + out of date: the head, the open failed row, the warning line, the header chip and the red strip count
//   2. a row opens and closes on a click; the out-of-date row's note
//   3. the chip and the strip count open the rail on Overview with the tile in view (from another tab; from a closed rail)
//   4. Ask the agent to rerun sends the failed row's line; a send that fails shows its error under the row's buttons
//   5. Skip sets the no-result row aside (Skipped, Undo, the head drops it); Undo brings it back
//   6. running: `1 of 2`, a pulsing dot, no chip
//   7. a run whose process is gone with no end: No result, chip and strip amber
//   8. out of date alone: chip `Verify: out of date`, strip `!`
//   9. everything passed: the tile folds to `Verify · 2 passed`; a click opens it
//  10. not run: only the warning line, chip `Verify: not run`; Skip clears the chip, Undo brings it back
//  11. nothing changed or run: no tile, no chip, no strip count; and a repo without `.arc/verify.json`: the same

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "rail-verify";
const AGENT_NAME = "rail verify main";
const PROJECT = "verify-rail-verify";
const WAIT_MS = 15_000;
const RPC = { timeout: 30_000 };
const X_REL = "frontend/x.tsx";
const CONFIG = { watch: ["frontend/**/*.tsx", "frontend/**/*.css"], rerun: "task verify:ui -- <name>" };
const KEYS = ["agent.rail.visible", "agent.rail.tab", "cockpit.rail.sections", "agent.chatmode"];
// a block id no block has: the server refuses a prompt to it ("no longer exists: nothing was sent")
const GONE_BLOCK = "00000000-0000-4000-8000-000000000000";

// the scenarios the fixture agent's runs name
const FAILED = "chat-council-card";
const NORES = "rail-council-tab";
const OLD = "agent-rail-tabs";

// the steps of a run, as a harness reports them
const TITLES = [
    "the starter agent is on the rail",
    "a council started through Bash draws its card",
    "the card names its seats",
    "the card shows round 1",
    "the card shows round 2",
    "Open shows the full Discussion",
    "a council started through PowerShell draws its card",
    "its seats name themselves",
    "the card folds once the report lands",
];
const stepsOf = (n, failFrom = Infinity) =>
    Array.from({ length: n }, (_, i) => ({ step: `${i + 1}. ${TITLES[i % TITLES.length]}`, state: i + 1 >= failFrom ? "fail" : "pass" }));
const filesOf = (name, n) => Array.from({ length: n }, (_, i) => `${name}-${String(i + 1).padStart(2, "0")}.png`);

// --- page expressions -----------------------------------------------------------------------------------------------

const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const TILE = `${ASIDE}?.querySelector("[data-verify-tile]")`;
const HEADER = `document.querySelector("[data-agent-header]")`;
const STRIP = `${ASIDE}?.querySelector('[data-rail-stat="verify"]')`;
const SELECTED_TAB = `${ASIDE}?.querySelector('[role="tab"][aria-selected="true"]')?.dataset.railTab ?? null`;
// the tile is drawn, and some of it is inside the rail's scrolling body
const TILE_IN_VIEW = `(() => {
    const t = ${TILE};
    const sc = t?.closest("[data-rail-scroll]");
    if (!t || !sc) return false;
    const a = t.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    return a.height > 0 && a.bottom > b.top + 8 && a.top < b.bottom - 8;
})()`;

// everything the steps read of the tile, the chip and the strip count, in one evaluation
const READ = `(() => {
    const flat = ${FLAT};
    const tile = ${TILE} ?? null;
    const head = tile?.querySelector("[data-verify-head]") ?? null;
    const warn = tile?.querySelector("[data-verify-warning]") ?? null;
    const chip = ${HEADER}?.querySelector("[data-verify-chip]") ?? null;
    const strip = ${STRIP} ?? null;
    return {
        tile: !!tile,
        head: flat(head),
        folded: head?.hasAttribute("data-verify-folded") ?? false,
        verdicts: [...(head?.querySelectorAll("[data-verify-verdict]") ?? [])].map(flat),
        warning: warn
            ? {
                  kind: warn.getAttribute("data-verify-kind"),
                  text: flat(warn.firstElementChild),
                  full: flat(warn),
                  rerun: !!warn.querySelector("[data-verify-rerun]"),
                  skip: !!warn.querySelector("[data-verify-skip]"),
                  undo: !!warn.querySelector("[data-verify-undo]"),
              }
            : null,
        rows: [...(tile?.querySelectorAll("[data-verify-row]") ?? [])].map((r) => {
            const open = r.querySelector("[data-verify-open]");
            const note = r.querySelector("[data-verify-note]");
            const shots = r.querySelector("[data-verify-shots]");
            const error = r.querySelector("[data-verify-error]");
            return {
                key: r.getAttribute("data-verify-row"),
                state: r.getAttribute("data-verify-state"),
                expanded: open ? open.getAttribute("aria-expanded") === "true" : null,
                result: flat(r.querySelector("[data-verify-result]")),
                pulse: !!r.querySelector("[data-verify-dot].pulse-dot-slow"),
                note: note ? flat(note) : null,
                steps: [...r.querySelectorAll("[data-verify-step]")].map(flat),
                more: /\\+ \\d+ passed/.exec(flat(r))?.[0] ?? null,
                shots: shots ? flat(shots) : null,
                rerun: r.querySelector("[data-verify-rerun]") ? flat(r.querySelector("[data-verify-rerun]")) : null,
                skip: !!r.querySelector("[data-verify-skip]"),
                undo: !!r.querySelector("[data-verify-undo]"),
                error: error ? flat(error) : null,
                text: flat(r),
            };
        }),
        chip: chip ? { text: flat(chip), tone: chip.getAttribute("data-verify-tone"), title: chip.title } : null,
        strip: strip
            ? {
                  count: strip.getAttribute("data-count"),
                  tone: strip.getAttribute("data-verify-tone"),
                  pulsing: strip.getAttribute("data-verify-pulsing"),
                  title: strip.title,
              }
            : null,
    };
})()`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    const rosterRows = (ctx) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 42 },
            id: ctx.tab.tabId,
            name: AGENT_NAME,
            blockId: ctx.tab.blockId,
            // the checkout the header's chip reads Verify against while the rail has not resolved one
            cwd: ctx.repo,
        },
    ];

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = { prev: {}, dir: mkdtempSync(join(tmpdir(), "verify-rv-")), changes: 0 };
            ctx.repo = join(ctx.dir, "repo");
            ctx.shotsDir = join(ctx.dir, "cdp-shots");
            let at = "reading the keys";
            try {
                for (const k of KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                ctx.prevRail = await AC.agentPage(h, `const R = await mod("app/view/agents/railstore.ts"); return globalStore.get(R.railVisibleAtom);`);

                at = "making the repo";
                mkdirSync(join(ctx.repo, "frontend"), { recursive: true });
                mkdirSync(join(ctx.repo, ".arc"), { recursive: true });
                ctx.git = (...args) => execFileSync("git", ["-C", ctx.repo, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                ctx.git("init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.repo, "README.md"), "# verify fixture\n");
                writeFileSync(join(ctx.repo, ".arc", "verify.json"), JSON.stringify(CONFIG));
                writeFileSync(join(ctx.repo, ...X_REL.split("/")), "export const x = 0;\n");
                ctx.git("add", ".");
                ctx.git("commit", "-qm", "seed");

                at = "finding wavesrv's data dir";
                ctx.dataDir = (await h.rpc("waveinfo", null)).datadir;
                if (!ctx.dataDir) throw new Error("waveinfo has no datadir");
                // a process id that is gone: a run reported with it and no end is a run that stopped
                ctx.deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
                if (!ctx.deadPid) throw new Error("could not make a process id that is gone");

                at = "resetting the panel";
                await h.ev(`(() => {
                    localStorage.setItem("agent.rail.visible", "true");
                    for (const k of ["agent.rail.tab", "cockpit.rail.sections", "agent.chatmode"]) localStorage.removeItem(k);
                    return true;
                })()`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tab";
                // no controller: nothing starts in the block, and a prompt to it is refused at the server. Its cwd is the repo
                ctx.tab = await makeTab(h, ctx, { label: AGENT_NAME, blockMeta: { view: "term", "cmd:cwd": ctx.repo } });
                ctx.blockFile = join(ctx.dataDir, "verify", `${ctx.tab.blockId}.json`);

                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));

                at = "recording the prompts";
                // a prompt to the agent is recorded and resolved here; once __rvForward is set it goes to a block that is gone
                await h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (!c.__rvOrig) {
                        c.__rvOrig = c.wshRpcCall;
                        const call = c.wshRpcCall.bind(c);
                        c.wshRpcCall = (command, data, opts) => {
                            if (command !== "agentprompt") return call(command, data, opts);
                            window.__rvPrompts.push(data);
                            return window.__rvForward ? call(command, { ...data, blockid: ${JSON.stringify(GONE_BLOCK)} }, opts) : Promise.resolve(null);
                        };
                    }
                    window.__rvPrompts = [];
                    window.__rvForward = false;
                    return true;
                })()`);

                at = "showing the agent";
                await AC.agentPage(
                    h,
                    `const { setChatMode } = await mod("app/view/agents/chatmodestore.ts");
                    setChatMode(${JSON.stringify(ctx.tab.tabId)}, "terminal");
                    return true;`
                );
                await AC.focusAgent(h, ctx.tab.tabId);
                ctx.shown = await polishWaitFor(h, `!!${ASIDE} && !!${HEADER}`, WAIT_MS);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null || !ctx.shown) {
                rec("0. the fixture agent, its repo and its rail are in place", false, ctx.arrangeError ?? "the rail or the header never drew");
                return steps;
            }
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            const shot = async (name) => {
                try {
                    await h.shot(`cdp-shots/${NAME}-${name}.png`);
                } catch (e) {
                    console.error(`${NAME}: the shot ${name} failed: ${e?.message ?? e}`);
                }
            };
            const blockId = ctx.tab.blockId;
            const page = (body) => AC.agentPage(h, body);

            // --- state: runs, changes, reads ---------------------------------------------------------------------------

            // the page reads the agent's state again, as a remount of the tile does
            const refresh = () =>
                page(`const V = await mod("app/view/agents/verifystore.ts"); await V.loadVerify(${JSON.stringify(blockId)}, ${JSON.stringify(ctx.repo)}); return true;`);
            // a write to frontend/x.tsx git lists as modified, with the mtime wavesrv compares the runs against: `offsetMs`
            // from now (a run reported after it passed it, a run reported before it is out of date)
            const dirty = (offsetMs = 0) => {
                ctx.changes += 1;
                const file = join(ctx.repo, ...X_REL.split("/"));
                writeFileSync(file, `export const x = ${ctx.changes};\n`);
                const t = new Date(Date.now() + offsetMs);
                utimesSync(file, t, t);
            };
            // no run, no skip, no change: a block that never ran a scenario
            const reset = async () => {
                rmSync(ctx.blockFile, { force: true, maxRetries: 10, retryDelay: 100 });
                ctx.git("checkout", "--", X_REL);
                await refresh();
            };
            // one run as the harness reports it: start, a progress for each scenario that finished, and an end. A scenario
            // with `done: false` has not finished: it only starts. `end: false` leaves the run open (running, or stopped)
            const seed = async ({ scenarios, command, pid = process.pid, end = true }) => {
                const runid = randomUUID();
                const base = { blockid: blockId, runid, pid, cwd: ctx.repo, command, shotsdir: ctx.shotsDir };
                const finished = scenarios.filter((s) => s.done !== false).map((s) => ({ name: s.name, files: s.files, steps: s.steps, done: true }));
                await h.rpc("verifyreport", { ...base, phase: "start", scenarios: scenarios.map((s) => ({ name: s.name })) }, RPC);
                for (const s of finished) await h.rpc("verifyreport", { ...base, phase: "progress", scenarios: [s] }, RPC);
                if (end) await h.rpc("verifyreport", { ...base, phase: "end", scenarios: finished }, RPC);
                return runid;
            };
            const failedRun = () => seed({ scenarios: [{ name: FAILED, steps: stepsOf(9, 7), files: filesOf(FAILED, 9) }], command: `task verify:ui -- ${FAILED}` });
            const stoppedRun = () => seed({ scenarios: [{ name: NORES, done: false }], command: `task verify:ui -- ${NORES}`, pid: ctx.deadPid, end: false });
            const passedRun = (name, n) => seed({ scenarios: [{ name, steps: stepsOf(n), files: filesOf(name, n) }], command: `task verify:ui -- ${name}` });

            const readTile = () => h.ev(READ);
            // polls the page's reading until `pred` holds: { ok, tile } with the last reading for the step's detail
            const untilTile = async (pred, ms = WAIT_MS) => {
                let tile = null;
                for (let waited = 0; waited < ms; waited += 250) {
                    tile = await readTile();
                    if (pred(tile)) return { ok: true, tile };
                    await polishNap(250);
                }
                return { ok: false, tile };
            };
            const row = (tile, key) => tile?.rows.find((r) => r.key === key) ?? null;
            const click = (root, sel) =>
                h.ev(`(() => {
                    const el = (${root})?.querySelector(${JSON.stringify(sel)});
                    if (!el) return "missing";
                    el.click();
                    return "clicked";
                })()`);
            const clickTile = (sel) => click(TILE, sel);
            const toggleRow = (key) => clickTile(`[data-verify-row="${key}"] [data-verify-open]`);
            const prompts = () => h.ev(`JSON.parse(JSON.stringify(window.__rvPrompts ?? []))`);
            const railOpen = () => page(`const R = await mod("app/view/agents/railstore.ts"); return globalStore.get(R.railVisibleAtom);`);
            const setRail = (on) => page(`const R = await mod("app/view/agents/railstore.ts"); globalStore.set(R.railVisibleAtom, ${on}); return true;`);
            const selectTab = (tab) => click(ASIDE, `[data-rail-tab="${tab}"]`);

            // 1. a failed run, a run that stopped and a run that passed before a UI file changed
            await run("1. failed, no result and out of date", async (name) => {
                await reset();
                await failedRun();
                await stoppedRun();
                await passedRun(OLD, 12);
                // x.tsx changes after the last report
                await polishNap(120);
                dirty(0);
                await refresh();
                const { ok } = await untilTile((t) => t.rows.length === 3 && row(t, OLD)?.state === "outofdate" && t.chip != null);
                await polishNap(700);
                const t = await readTile();
                const failed = row(t, FAILED);
                await shot("1-failed-noresult-outofdate");
                let picture = "none";
                try {
                    picture = (await h.whatsnewShot("rail-verify", { selector: "[data-verify-tile]" })).comment;
                } catch (e) {
                    picture = `the What's new picture failed: ${e?.message ?? e}`;
                }
                rec(
                    `${name}: the head reads "1 failed · 1 no result · 1 out of date" over 3 scenarios; the failed row is open with steps 7, 8 and 9, "+ 6 passed" and "Open the 9 screenshots"; the warning line names x.tsx and ${OLD}; the header chip reads "Verify: 1 failed" (red) and the strip count is red`,
                    ok &&
                        t.verdicts.join(" · ") === "1 failed · 1 no result · 1 out of date" &&
                        t.head.includes("3 scenarios") &&
                        t.rows.map((r) => `${r.key}:${r.state}`).join() === `${FAILED}:failed,${NORES}:noresult,${OLD}:outofdate` &&
                        failed?.expanded === true &&
                        failed.result === "6/9" &&
                        failed.steps.length === 3 &&
                        failed.steps.map((s) => s.slice(0, 2)).join() === "7.,8.,9." &&
                        failed.steps[0].includes("a council started through PowerShell draws its card") &&
                        failed.more === "+ 6 passed" &&
                        failed.shots === "Open the 9 screenshots" &&
                        t.warning?.kind === "outofdate" &&
                        t.warning.text === `x.tsx changed after ${OLD} last ran.` &&
                        t.chip?.text === "Verify: 1 failed" &&
                        t.chip.tone === "red" &&
                        t.chip.title.includes(FAILED) &&
                        t.strip?.count === "1" &&
                        t.strip.tone === "red",
                    { ok, picture, ...t, rows: t.rows.map((r) => ({ key: r.key, state: r.state, expanded: r.expanded, result: r.result, steps: r.steps, more: r.more, shots: r.shots })) }
                );
            });

            // 2. a row opens and closes on a click; the out-of-date row's note says what changed
            await run("2. a row opens and closes", async (name) => {
                const before = row(await readTile(), NORES);
                const opened = await toggleRow(NORES);
                const up = await untilTile((t) => row(t, NORES)?.expanded === true && row(t, NORES).note != null);
                await polishNap(500);
                await shot("2-row-open");
                const closed = await toggleRow(NORES);
                const down = await untilTile((t) => row(t, NORES)?.expanded === false && row(t, NORES).note == null);
                const old = await toggleRow(OLD);
                const oldUp = await untilTile((t) => row(t, OLD)?.expanded === true && row(t, OLD).note != null);
                await polishNap(500);
                await shot("2-outofdate-note");
                const note = row(oldUp.tile, OLD)?.note ?? "";
                rec(
                    `${name}: the no-result row opens on a click (its note "Stopped during ${NORES}: the run ended without a result…") and closes on the next; the out-of-date row, opened, reads "Passed … before x.tsx changed."`,
                    before?.expanded === false &&
                        opened === "clicked" &&
                        up.ok &&
                        row(up.tile, NORES).note.startsWith(`Stopped during ${NORES}: the run ended without a result`) &&
                        closed === "clicked" &&
                        down.ok &&
                        old === "clicked" &&
                        oldUp.ok &&
                        /^Passed .+ before x\.tsx changed\.$/.test(note),
                    { before: before?.expanded, opened, up: up.ok, note1: row(up.tile, NORES)?.note, closed, down: down.ok, old, oldUp: oldUp.ok, note }
                );
            });

            // 3. the chip and the strip count open the rail on Overview with the tile in view
            await run("3. the chip and the strip count open the tile", async (name) => {
                const tabs = await h.ev(`[...(${ASIDE}?.querySelectorAll('[role="tab"]') ?? [])].map((t) => t.dataset.railTab)`);
                const other = tabs.includes("changes") ? "changes" : tabs.find((t) => t !== "overview");
                if (other == null) throw new Error(`the rail has no tab but Overview: ${JSON.stringify(tabs)}`);

                // the rail on another tab, and the chip brings Overview back with the tile
                const sel1 = await selectTab(other);
                const away1 = await polishWaitFor(h, `(${SELECTED_TAB}) === ${JSON.stringify(other)}`, WAIT_MS);
                await shot("3-rail-on-other-tab");
                const chip1 = await click(HEADER, "[data-verify-chip]");
                const back1 = await polishWaitFor(h, `(${SELECTED_TAB}) === "overview" && ${TILE_IN_VIEW}`, WAIT_MS);
                await polishNap(500);
                await shot("3-chip-opened-overview");

                // the rail closed: the chip opens it
                await setRail(false);
                await polishNap(400);
                const closed2 = (await railOpen()) === false;
                const chip2 = await click(HEADER, "[data-verify-chip]");
                const open2 = await polishWaitFor(h, `(${SELECTED_TAB}) === "overview" && ${TILE_IN_VIEW}`, WAIT_MS);
                const railNow = await railOpen();
                await polishNap(400);
                await shot("3-chip-opened-closed-rail");

                // the strip count: from another tab it brings Overview and the tile back
                const sel3 = await selectTab(other);
                const away3 = await polishWaitFor(h, `(${SELECTED_TAB}) === ${JSON.stringify(other)}`, WAIT_MS);
                const strip3 = await click(ASIDE, '[data-rail-stat="verify"]');
                const back3 = await polishWaitFor(h, `(${SELECTED_TAB}) === "overview" && ${TILE_IN_VIEW}`, WAIT_MS);
                await polishNap(400);
                await shot("3-strip-opened-overview");
                rec(
                    `${name}: with the rail on the ${other} tab a click on the header chip opens Overview with the tile in view; with the rail closed it opens the rail; a click on the strip count from the ${other} tab does the same`,
                    sel1 === "clicked" &&
                        away1 &&
                        chip1 === "clicked" &&
                        back1 &&
                        closed2 &&
                        chip2 === "clicked" &&
                        open2 &&
                        railNow === true &&
                        sel3 === "clicked" &&
                        away3 &&
                        strip3 === "clicked" &&
                        back3,
                    { tabs, other, sel1, away1, chip1, back1, closed2, chip2, open2, railNow, sel3, away3, strip3, back3 }
                );
            });

            // 4. Ask the agent to rerun sends the failed row's line; a send that fails says so under the row's buttons
            await run("4. Ask the agent to rerun", async (name) => {
                await selectTab("overview");
                const rerunSel = `[data-verify-row="${FAILED}"] [data-verify-rerun="${FAILED}"]`;
                await untilTile((t) => row(t, FAILED)?.expanded === true && row(t, FAILED).rerun != null);
                await h.ev(`(window.__rvPrompts = [], window.__rvForward = false, true)`);
                const sent = await clickTile(rerunSel);
                // the button reads Sent for a couple of seconds once the send went through
                const afterSend = await untilTile((t) => row(t, FAILED)?.rerun === "Sent", 4000);
                const got = await polishWaitFor(h, `(window.__rvPrompts ?? []).length >= 1`, WAIT_MS);
                const calls = await prompts();
                await shot("4-rerun-sent");
                const want = `Run \`task verify:ui -- ${FAILED}\` again and fix the steps that fail: 7, 8, 9.`;

                // the same click with the agent's block gone: the server refuses and the row says so
                await untilTile((t) => row(t, FAILED)?.rerun === "Ask the agent to rerun", 6000);
                await h.ev(`(window.__rvForward = true, true)`);
                const sent2 = await clickTile(rerunSel);
                const failedSend = await untilTile((t) => row(t, FAILED)?.error != null);
                await polishNap(300);
                await shot("4-rerun-failed");
                await h.ev(`(window.__rvForward = false, true)`);
                const errRow = row(failedSend.tile, FAILED);
                // the error sits under the row's buttons
                const underButtons = await h.ev(`(() => {
                    const r = ${TILE}?.querySelector('[data-verify-row="${FAILED}"]');
                    const b = r?.querySelector("[data-verify-rerun]");
                    const e = r?.querySelector("[data-verify-error]");
                    return b && e ? !!(b.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
                })()`);
                rec(
                    `${name}: the failed row's Ask the agent to rerun sends "${want}" to the agent's block (and reads Sent); with the block gone the send fails at the server and its message shows under the row's buttons`,
                    sent === "clicked" &&
                        got &&
                        calls.length === 1 &&
                        calls[0].blockid === blockId &&
                        calls[0].text === want &&
                        afterSend.ok &&
                        sent2 === "clicked" &&
                        failedSend.ok &&
                        errRow.error.includes(`Couldn't send to ${AGENT_NAME}`) &&
                        /no longer exists|nothing was sent/.test(errRow.error) &&
                        underButtons === true,
                    { sent, got, calls, sent2, afterSend: afterSend.ok, error: errRow?.error ?? null, underButtons }
                );
            });

            // 5. Skip sets the no-result row aside; Undo brings it back
            await run("5. Skip and Undo", async (name) => {
                await selectTab("overview");
                await untilTile((t) => row(t, NORES) != null);
                const t0 = await readTile();
                if (row(t0, NORES)?.expanded !== true) await toggleRow(NORES);
                await untilTile((t) => row(t, NORES)?.skip === true);
                const skipped = await clickTile(`[data-verify-row="${NORES}"] [data-verify-skip="${NORES}"]`);
                const up = await untilTile((t) => row(t, NORES)?.state === "skipped" && t.verdicts.join(" · ") === "1 failed · 1 out of date");
                await polishNap(400);
                await shot("5-skipped");
                const s = row(up.tile, NORES);
                const undone = await clickTile(`[data-verify-row="${NORES}"] [data-verify-undo="${NORES}"]`);
                const down = await untilTile((t) => row(t, NORES)?.state === "noresult" && t.verdicts.join(" · ") === "1 failed · 1 no result · 1 out of date");
                await polishNap(400);
                await shot("5-undone");
                rec(
                    `${name}: Skip on the no-result row makes it read "Skipped" with Undo and no more buttons, and the head drops "1 no result"; Undo brings the row and the head part back`,
                    skipped === "clicked" &&
                        up.ok &&
                        s.text.includes("Skipped") &&
                        s.undo &&
                        !s.skip &&
                        s.expanded === null &&
                        undone === "clicked" &&
                        down.ok,
                    { skipped, up: up.ok, skippedRow: s && { state: s.state, text: s.text, undo: s.undo }, verdicts: up.tile.verdicts, undone, down: down.ok, verdictsAfter: down.tile.verdicts }
                );
            });

            // 6. a run that is still going: its scenarios finished so far, a pulsing dot, nothing wrong to flag
            await run("6. running", async (name) => {
                await reset();
                await seed({
                    scenarios: [
                        { name: OLD, steps: stepsOf(12), files: filesOf(OLD, 12) },
                        { name: NORES, done: false },
                    ],
                    command: `task verify:ui -- ${OLD} ${NORES}`,
                    pid: process.pid,
                    end: false,
                });
                const { ok } = await untilTile((t) => t.rows.length === 2 && t.rows.every((r) => r.state === "running"));
                await polishNap(500);
                const t = await readTile();
                await shot("6-running");
                rec(
                    `${name}: a run with one of its two scenarios finished reads "1 of 2" on a pulsing dot, the head says "running", and the header has no chip`,
                    ok &&
                        t.rows.every((r) => r.result === "1 of 2" && r.pulse) &&
                        t.verdicts.join(" · ") === "running" &&
                        t.chip == null &&
                        t.strip?.pulsing === "true" &&
                        t.strip.tone === "green",
                    { ok, verdicts: t.verdicts, chip: t.chip, strip: t.strip, rows: t.rows.map((r) => ({ key: r.key, state: r.state, result: r.result, pulse: r.pulse })) }
                );
            });

            // 7. a run whose process is gone and that never ended
            await run("7. a run that stopped", async (name) => {
                await reset();
                await stoppedRun();
                const { ok } = await untilTile((t) => t.rows.length === 1 && t.rows[0].state === "noresult" && t.chip != null);
                await polishNap(500);
                const t = await readTile();
                await shot("7-noresult");
                rec(
                    `${name}: a run whose process is gone with no end reads "No result"; the chip reads "Verify: no result" (amber) and the strip count is 1, amber`,
                    ok &&
                        t.rows[0].result === "No result" &&
                        t.verdicts.join(" · ") === "1 no result" &&
                        t.chip?.text === "Verify: no result" &&
                        t.chip.tone === "amber" &&
                        t.strip?.count === "1" &&
                        t.strip.tone === "amber",
                    { ok, verdicts: t.verdicts, chip: t.chip, strip: t.strip, row: t.rows[0] && { state: t.rows[0].state, result: t.rows[0].result } }
                );
            });

            // 8. a run that passed before a UI file changed, and nothing else
            await run("8. out of date alone", async (name) => {
                await reset();
                await passedRun(OLD, 12);
                await polishNap(120);
                dirty(0);
                await refresh();
                const { ok } = await untilTile((t) => row(t, OLD)?.state === "outofdate" && t.chip != null);
                await polishNap(500);
                const t = await readTile();
                await shot("8-outofdate");
                rec(
                    `${name}: a run that passed before x.tsx changed reads 12/12 as out of date; the chip reads "Verify: out of date" (amber), the strip count "!" (amber) and the warning line names x.tsx`,
                    ok &&
                        row(t, OLD).result === "12/12" &&
                        t.verdicts.join(" · ") === "1 out of date" &&
                        t.warning?.kind === "outofdate" &&
                        t.warning.text === `x.tsx changed after ${OLD} last ran.` &&
                        t.chip?.text === "Verify: out of date" &&
                        t.chip.tone === "amber" &&
                        t.strip?.count === "!" &&
                        t.strip.tone === "amber",
                    { ok, verdicts: t.verdicts, warning: t.warning, chip: t.chip, strip: t.strip }
                );
            });

            // 9. everything passed: the tile folds to one line that opens it
            await run("9. all passed", async (name) => {
                await reset();
                await passedRun(OLD, 12);
                await passedRun(FAILED, 14);
                const folded = await untilTile((t) => t.tile && t.folded && t.verdicts.join(" · ") === "2 passed");
                await polishNap(500);
                const f = await readTile();
                await shot("9-folded");
                const open = await clickTile("[data-verify-head]");
                const opened = await untilTile((t) => !t.folded && t.rows.length === 2);
                await polishNap(500);
                await shot("9-opened");
                const close = await clickTile("[data-verify-head]");
                const closed = await untilTile((t) => t.folded && t.rows.length === 0);
                rec(
                    `${name}: with both runs passed and nothing changed the tile is one line, "Verify · 2 passed", with no chip and a muted strip count 2; a click opens its 2 rows, the next folds it`,
                    folded.ok &&
                        /^Verify\s*·\s*2 passed$/.test(f.head) &&
                        f.rows.length === 0 &&
                        f.chip == null &&
                        f.strip?.count === "2" &&
                        f.strip.tone === "muted" &&
                        open === "clicked" &&
                        opened.ok &&
                        opened.tile.rows.map((r) => r.result).sort().join() === "12/12,14/14" &&
                        close === "clicked" &&
                        closed.ok,
                    { folded: folded.ok, head: f.head, chip: f.chip, strip: f.strip, open, opened: opened.ok, close, closed: closed.ok }
                );
            });

            // 10. a UI file changed and no scenario has run: the warning line alone
            await run("10. not run", async (name) => {
                await reset();
                dirty(0);
                await refresh();
                const up = await untilTile((t) => t.warning?.kind === "notrun" && t.chip != null);
                await polishNap(500);
                const t = await readTile();
                await shot("10-notrun");
                const skipped = await clickTile('[data-verify-skip="notrun"]');
                const cleared = await untilTile((t2) => t2.chip == null && t2.folded);
                await polishNap(400);
                await shot("10-skipped");
                // the skipped tile is one line; its warning, with Undo, is inside it
                await clickTile("[data-verify-head]");
                const undoUp = await untilTile((t2) => t2.warning?.undo === true);
                const undone = await clickTile('[data-verify-undo="notrun"]');
                const back = await untilTile((t2) => t2.chip?.text === "Verify: not run");
                rec(
                    `${name}: with x.tsx changed and no run, the tile is the warning line alone ("x.tsx changed, and no scenario has run in this session.", with Ask the agent to rerun and Skip) and no row; the chip reads "Verify: not run" (amber), the strip count "!"; Skip clears the chip and Undo brings it back`,
                    up.ok &&
                        t.rows.length === 0 &&
                        t.warning.text === "x.tsx changed, and no scenario has run in this session." &&
                        t.warning.rerun &&
                        t.warning.skip &&
                        t.verdicts.join(" · ") === "not run" &&
                        t.chip?.text === "Verify: not run" &&
                        t.chip.tone === "amber" &&
                        t.strip?.count === "!" &&
                        t.strip.tone === "amber" &&
                        skipped === "clicked" &&
                        cleared.ok &&
                        undoUp.ok &&
                        undone === "clicked" &&
                        back.ok,
                    { up: up.ok, warning: t.warning, verdicts: t.verdicts, chip: t.chip, strip: t.strip, skipped, cleared: cleared.ok, undoUp: undoUp.ok, undone, back: back.ok }
                );
            });

            // 11. nothing changed and nothing run, then a repo that did not opt in: no tile, no chip and no strip count
            await run("11. nothing to show", async (name) => {
                await reset();
                const none = await untilTile((t) => !t.tile && t.chip == null && t.strip == null, 6000);
                await shot("11-nothing");
                // a run and a change are there, and show; the repo's config goes, and so does all of it
                await failedRun();
                dirty(0);
                await refresh();
                const shows = await untilTile((t) => t.tile && t.chip != null && t.strip != null);
                rmSync(join(ctx.repo, ".arc", "verify.json"), { force: true });
                await refresh();
                const gone = await untilTile((t) => !t.tile && t.chip == null && t.strip == null, 6000);
                await polishNap(300);
                await shot("11-no-config");
                rec(
                    `${name}: with .arc/verify.json present and nothing run or changed there is no tile, no chip and no strip count; with a run and a change they show, and once the repo has no .arc/verify.json they are gone again`,
                    none.ok && shows.ok && gone.ok,
                    { none: none.ok && none.tile, shows: shows.ok, gone: gone.ok && gone.tile }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const failures = [];
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    failures.push(`${what}: ${e?.message ?? e}`);
                }
            };
            await step("stop recording the prompts", () =>
                h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (c?.__rvOrig) { c.wshRpcCall = c.__rvOrig; delete c.__rvOrig; }
                    delete window.__rvPrompts;
                    delete window.__rvForward;
                    return true;
                })()`)
            );
            if (ctx.prevRail !== undefined) {
                await step("restore the panel", () =>
                    AC.agentPage(h, `const R = await mod("app/view/agents/railstore.ts"); globalStore.set(R.railVisibleAtom, ${JSON.stringify(ctx.prevRail)}); return true;`)
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            // the block's closing makes wavesrv drop its file; it goes here too, so a missed event leaves nothing
            if (ctx.blockFile) await step("remove the block's Verify file", () => rmSync(ctx.blockFile, { force: true, maxRetries: 10, retryDelay: 100 }));
            await step("restore the keys", () =>
                h.ev(`(() => {
                    for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                        if (v == null) localStorage.removeItem(k);
                        else localStorage.setItem(k, v);
                    }
                    return true;
                })()`)
            );
            await step("reload onto the live roster", () => ahReload(h));
            // wavesrv's watch on the repo can hold it for a moment after its agent is gone
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
            if (failures.length > 0) throw new Error(failures.join("; "));
        },
    };

    return [scenario];
}
