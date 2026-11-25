// kael1125-label: the fast track label's scenario for the 2026-11-25 Kael sync (docs/superpowers/plans/
// 2026-11-25-kael-sync-fast-track.md). Task 1 created it empty and registered it in scenarios.mjs; Task 6 fills it with
// `kael1125-fast-track-label`. kits is scenarios.mjs's KAEL_KITS plus `run`: RUN_KIT, the dag seeding helpers; the
// fixture-run helpers are kits.jarvis's. `wsh runs show`'s route line is a Go unit test (wshcmd-runs_test.go), not a step.
//
// One deferred orchestrator run with a three-task dag submitted as JSON (so the engine never sets `fasttrack` on it: only
// a plan-file submit does), whose t-1 dispatches a real worker that does nothing and is the engine's. The flag is seeded
// into the stored dag (`seedDag`: a seeded dag proves how the cockpit draws that state, not what the engine does with it;
// Task 5's Go tests own the engine's side). The engine's tick can write the dag it read first over a seed, so a seed is read
// back after a pause and written again until it has stayed, and `until` writes it again if the tick takes it later.
//   1. the dag carries fasttrack: the run sheet's settings line shows the `fast track` chip, last before adjust and right
//      after the approvals word
//   2. the same dag with fasttrack cleared: no chip, and the line still ends at adjust
//   3. a fixture Claude agent whose brainstorm file names the run draws Chat's run card (the same card a `wsh runs start`
//      call draws): its head reads `Orchestrator run` for the full-track dag and `Orchestrator run · fast track` once
//      the flag is set, whole, not cut by the head's truncation
// Every click is the DOM's own, so the page's listeners are what run.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const WAIT_MS = 15_000;

const NAME = "kael1125 label agent";
const PROJECT = "verify-kael1125-label";
const TOPIC = "kael1125-label";
const FULL_HEAD = "Orchestrator run";
const FAST_HEAD = "Orchestrator run · fast track";

// the page's own keys and the cockpit route the agent's hook reveals through, as scenarios.mjs holds them (it cannot be
// imported from here)
const GRID_KEY = "agent.grids";
const GRID_EMPTY = { project: null, grids: {} };
const CHAT_MODE_KEY = "agent.chatmode";
const SENT_KEY = "chat.brainstorm.sent";
const HINTS_KEY = "brainstorm.hintsSeen";
const UI_ROUTE = { route: "cockpit", timeout: 15_000 };
const LS_KEYS = [GRID_KEY, CHAT_MODE_KEY, SENT_KEY, HINTS_KEY];

const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const SHEET_CONFIG = `document.querySelector('[data-run-sheet] [data-jarvis-brief-sheet-config="editable"]')`;

// the run sheet's settings line: whether the fast track chip is on it and where, and the words around it
const READ_SHEET = `(() => {
    const flat = ${FLAT};
    const cfg = ${SHEET_CONFIG};
    const chip = cfg?.querySelector("[data-jarvis-brief-sheet-fasttrack]") ?? null;
    const kids = [...(cfg?.children ?? [])];
    const at = chip ? kids.indexOf(chip) : -1;
    const box = chip?.getBoundingClientRect();
    return {
        row: cfg != null,
        chips: cfg?.querySelectorAll("[data-jarvis-brief-sheet-fasttrack]").length ?? 0,
        chip: chip ? flat(chip) : null,
        afterApprovals: at > 0 && kids[at - 1].hasAttribute("data-jarvis-brief-sheet-approvals"),
        beforeAdjust: at >= 0 && at === kids.length - 2 && flat(kids[kids.length - 1]) === "adjust",
        approvals: flat(cfg?.querySelector("[data-jarvis-brief-sheet-approvals]")) || null,
        last: kids.length > 0 ? flat(kids[kids.length - 1]) : null,
        drawn: !!box && box.width > 0 && box.right <= window.innerWidth,
        bordered: chip ? getComputedStyle(chip).borderTopWidth === "1px" : false,
    };
})()`;

// the run's card in the agent's Chat: its head as drawn (and whether the head's truncation cuts it), its name and stage
const readCard = (tabId, runId) => `(() => {
    const flat = ${FLAT};
    const layer = document.querySelector('[data-agent-chat="${tabId}"]');
    const cards = [...(layer?.querySelectorAll('[data-chat-bscard-kind="run"]') ?? [])];
    const card = cards.find((c) => c.getAttribute("data-chat-run-card") === ${JSON.stringify(runId)}) ?? null;
    const head = card?.querySelector("[data-chat-bscard-head]") ?? null;
    return {
        cards: cards.length,
        card: card != null,
        head: head ? flat(head) : null,
        headFits: head ? head.scrollWidth <= head.clientWidth + 1 : null,
        name: flat(card?.querySelector("[data-chat-bscard-run-name]")) || null,
        stage: card?.querySelector("[data-chat-bscard-run-stage]")?.getAttribute("data-chat-bscard-run-stage") ?? null,
    };
})()`;

// the brainstorm file that names the run: done, so the one card Chat draws is the run's
const brainstormFile = (runId) => ({
    v: 1,
    title: "Fast track label",
    spec: "docs/superpowers/specs/2026-11-25-kael-sync-fast-track-design.md",
    canvas: TOPIC,
    question: null,
    working: null,
    parts: [
        { id: "intent", title: "Intent and why", body: "The run says which track it took.", gist: "The run says which track it took.", state: "yours" },
        { id: "scope", title: "Where it shows", body: "The run sheet, wsh runs show and Chat's run card.", gist: "The run sheet, wsh runs show and Chat's run card.", state: "yours" },
    ],
    history: [],
    done: true,
    check: null,
    run: runId,
});

const restoreKeys = (prev) =>
    `(() => {
        for (const [k, v] of Object.entries(${JSON.stringify(prev ?? {})})) {
            if (v == null) localStorage.removeItem(k);
            else localStorage.setItem(k, v);
        }
        return true;
    })()`;

export default function (kits) {
    const { arrangeSheetDagRun, waitForDispatch, teardownFixtureRun, waitForProjectInConfig, polishReload, polishWaitFor, polishNap, waveService, RUN_SHEET_POLISH_TASKS } = kits.jarvis;
    const { seedDag } = kits.run;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    // what a seed must hold: the dag's flag, and nothing else the engine's tick writes
    const flagPrint = (dag) => String(dag?.fasttrack === true);
    // the seed's keeper: what `until` runs between its looks to write the flag again once the stored dag has lost it
    let keeper = null;

    // Seeds the stored dag's flag. The engine's tick holds the dag lock for seconds while it spawns t-1's worker and then
    // writes the dag it read first, over a seed that landed meanwhile, so the seed is read back after a pause and written
    // again until it has stayed.
    async function setFastTrack(h, ctx, on) {
        const want = String(on);
        const write = () => seedDag(h, ctx, (dag) => ({ ...dag, fasttrack: on }), flagPrint);
        keeper = async () => {
            const stored = await waveService(h, "object", "GetObject", [`dag:${ctx.dagId}`]);
            if (flagPrint(stored) !== want) await write();
        };
        for (let round = 0; round < 4; round++) {
            await write();
            await polishNap(2500);
            const stored = await waveService(h, "object", "GetObject", [`dag:${ctx.dagId}`]);
            if (flagPrint(stored) === want) return;
        }
        throw new Error(`the dag did not keep fasttrack=${want}`);
    }

    // polls expr until ok holds; on every fourth look it writes the flag again if the tick took it
    async function until(h, expr, ok, ms = WAIT_MS) {
        let last = null;
        for (let i = 0; i * 250 < ms; i++) {
            last = await h.ev(expr).catch(() => null);
            if (last != null && ok(last)) return last;
            if (i % 4 === 3) {
                try {
                    await keeper?.();
                } catch (e) {
                    console.error(`kael1125-fast-track-label: writing the flag again failed: ${e?.message ?? e}`);
                }
            }
            await polishNap(250);
        }
        return last;
    }

    // the run's sheet on the Jarvis surface; true once its rows are drawn
    async function openSheet(h, ctx) {
        await h.goto("jarvis");
        await polishWaitFor(h, `typeof window.__openAddress === "function"`, 8000);
        await h.ev(`window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)})`);
        return polishWaitFor(h, `!!document.querySelector("[data-run-sheet-rows]")`, 15_000);
    }

    // the agent's roster row: idle since a minute ago
    const rosterRows = (ctx) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: ctx.idleSince,
            usage: { contextpct: 42 },
            id: ctx.tab.tabId,
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
        },
    ];

    // writes the brainstorm file and has the page read it now: the agent's hook reveals after each write, which attaches
    // the brainstorm (the first time) and polls it
    async function writeBrainstorm(h, ctx, file) {
        mkdirSync(dirname(ctx.bsFile), { recursive: true });
        writeFileSync(ctx.bsFile, JSON.stringify(file, null, 2));
        await h.rpc("uireveal", { address: `brainstorm:${TOPIC}`, callerblockid: ctx.tab.blockId, callercwd: ctx.projectDir }, UI_ROUTE);
    }

    const scenario = {
        name: "kael1125-fast-track-label",
        surface: "jarvis",
        async arrange(h) {
            await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            // the run, in a temp dir of its own, with the sheet opened; a throw lands in ctx.arrangeError and still returns ctx
            const ctx = await arrangeSheetDagRun(h, "kael1125-label", RUN_SHEET_POLISH_TASKS);
            if (ctx.arrangeError != null) return ctx;
            Object.assign(ctx, {
                dir: mkdtempSync(join(tmpdir(), "verify-k1125-")),
                projectDir: mkdtempSync(join(tmpdir(), "verify-k1125-project-")),
                prev: {},
                idleSince: Date.now() - 60_000,
            });
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "reading the run's dag";
                ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group.id;
                await waitForDispatch(h, ctx, "t-1");

                at = "making the agent's project";
                const git = (...args) => execFileSync("git", ["-C", ctx.projectDir, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.projectDir, "README.md"), "# fast track label\n");
                git("add", ".");
                git("commit", "-qm", "seed");
                ctx.bsFile = join(ctx.projectDir, ".superpowers", "brainstorm", TOPIC, "brainstorm.json");
                await h.rpc("createproject", { name: PROJECT, path: ctx.projectDir });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 3; i++) {
                    lines.push(AC.userText(`question ${i}: which track does a small run take?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. A run of a few tasks takes the fast track, and says so.`, o(i * 10 + 2)));
                }
                ctx.transcript = AC.writeTranscript(ctx.dir, "kael1125-label-main", lines);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(CHAT_MODE_KEY)})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(SENT_KEY)})`);
                // the Brainstorm pane's first-open hint card is not what this scenario reads
                await h.ev(`localStorage.setItem(${JSON.stringify(HINTS_KEY)}, "1")`);
                await polishReload(h);
                await h.goto("agent");

                at = "making the tab";
                // a shell controller, as the other Chat scenarios give a terminal: a line sent to the agent is typed there
                ctx.tab = await makeTab(h, ctx, { label: NAME, blockMeta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            rec(
                "0. the fixture run (a JSON dag, so no flag of the engine's), its t-1 worker and the Chat agent",
                ctx.arrangeError == null && ctx.dispatched === true && ctx.tab != null,
                ctx.arrangeError ?? { runId: ctx.runId, dagId: ctx.dagId, dispatched: ctx.dispatched, tab: ctx.tab?.tabId }
            );
            if (ctx.arrangeError != null || ctx.dispatched !== true) return steps;
            // a step that throws is a failed step, not the end of the run: the ones after it start from their own state
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };

            // 1. the dag carries the flag: the chip is last on the settings line before adjust, right after the approvals word
            await run("1", async (name) => {
                await setFastTrack(h, ctx, true);
                const opened = await openSheet(h, ctx);
                const read = opened ? await until(h, READ_SHEET, (s) => s.chips === 1) : null;
                await h.shot("cdp-shots/kael1125-fast-track-label-1-sheet.png");
                rec(
                    `${name}. a fast-track dag's run sheet shows 'fast track' as the last item before adjust on the settings line, right after the approvals word, drawn and bordered`,
                    opened && read?.chips === 1 && read.chip === "fast track" && read.afterApprovals === true && read.beforeAdjust === true && read.drawn === true && read.bordered === true,
                    { opened, read }
                );
            });

            // 2. the same run with the flag cleared: the chip goes, the line keeps its approvals word and still ends at adjust
            await run("2", async (name) => {
                await setFastTrack(h, ctx, false);
                const read = await until(h, READ_SHEET, (s) => s.row && s.chips === 0);
                await h.shot("cdp-shots/kael1125-fast-track-label-2-sheet-full-track.png");
                rec(
                    `${name}. the same run with fasttrack cleared shows no chip, and its settings line still ends at the approvals word and adjust`,
                    read?.row === true && read.chips === 0 && read.approvals != null && read.last === "adjust",
                    { read }
                );
            });

            // 3. Chat's run card: the full-track head first (the flag is still cleared), then the fast-track one once it is set
            await run("3", async (name) => {
                const A = ctx.tab.tabId;
                await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
                await AC.focusAgent(h, A);
                await writeBrainstorm(h, ctx, brainstormFile(ctx.runId));
                const up = await polishWaitFor(h, `${readCard(A, ctx.runId)}.card === true`, WAIT_MS);
                const full = up ? await until(h, readCard(A, ctx.runId), (c) => c.head === FULL_HEAD) : null;
                await h.shot("cdp-shots/kael1125-fast-track-label-3-card-full-track.png");
                await setFastTrack(h, ctx, true);
                const fast = await until(h, readCard(A, ctx.runId), (c) => c.head === FAST_HEAD);
                await h.shot("cdp-shots/kael1125-fast-track-label-3-card-fast-track.png");
                rec(
                    `${name}. Chat's run card for the run reads '${FULL_HEAD}' on the full track and '${FAST_HEAD}' once the dag carries the flag, whole in the head`,
                    up && full?.head === FULL_HEAD && full.headFits === true && fast?.head === FAST_HEAD && fast.headFits === true && fast.cards === 1,
                    { up, full, fast }
                );
            });
            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`kael1125-fast-track-label teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            keeper = null;
            // the Chat agent, its project and the page's keys go first, as the shared teardown's `restore`; it then cancels the
            // run, deletes its channel, reloads the page and removes the run's temp dir
            const restore = {
                what: "close the fixture agent, remove its project and restore the keys and the viewport",
                fn: async () => {
                    if (ctx.tab != null) {
                        await step("clear the exit", () =>
                            h.rpc("eventpublish", {
                                event: "controllerstatus",
                                scopes: [`block:${ctx.tab.blockId}`],
                                data: { blockid: ctx.tab.blockId, shellprocstatus: "running", shellprocexitcode: 0 },
                            })
                        );
                        await step("detach the brainstorm", () =>
                            AC.agentPage(h, `const S = await mod("app/view/agents/brainstormstore.ts"); S.detachBrainstorm(${JSON.stringify(ctx.tab.tabId)}); return true;`)
                        );
                    }
                    await step("restore the roster", () => AC.restoreRoster(h));
                    await step("close the fixture tab", () => closeTabs(h, ctx));
                    if (ctx.project != null) {
                        // deleteproject leaves the channel createproject made, so that goes too
                        await step("remove the project", async () => {
                            await h.rpc("deleteproject", { name: ctx.project });
                            const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                            const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                            for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.projectDir))) {
                                await h.rpc("deletechannel", { channelid: c.oid });
                            }
                        });
                    }
                    await step("restore the keys", () => h.ev(restoreKeys(ctx.prev)));
                    await step("restore the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
                },
            };
            try {
                // it throws when a run tree is left behind, so the folders below go either way
                await teardownFixtureRun(h, ctx, "kael1125-fast-track-label", restore);
            } finally {
                // wavesrv's transcript watch can hold a fixture for a moment after its agent is gone
                for (const dir of [ctx.dir, ctx.projectDir]) {
                    if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
                }
                await step("go home", () => h.goto("cockpit"));
            }
        },
    };

    return [scenario];
}
