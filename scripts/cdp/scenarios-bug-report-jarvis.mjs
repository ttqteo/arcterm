// Jarvis's bug-report row: one row in Waiting on you while reports wait, in its three forms (Xử lý, Mở agent,
// Chọn thư mục…) (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The Jarvis row"; plan
// docs/superpowers/plans/2026-11-19-bug-report.md).
//
//   Task 5 — bug-report-jarvis: the row shows for waiting reports, Xử lý launches the agent (through the DEV-only
//            __bugReportLaunchFake, never a real Claude agent) and the row turns into Mở agent; with no repo it asks for
//            Chọn thư mục….
//
// Nothing here starts a real agent: the "agent" Xử lý opens is a plain terminal tab this file makes, handed back by
// window.__bugReportLaunchFake, and the folder dialog is window.__bugReportPickFake. The reports are real ones, saved
// through bugreportsave with no screenshot, into the dev app's own data dir.
//
// A store that already holds bug reports (waiting or handling) is skipped, not worked around: the steps count exactly two
// and mark every report they find as done, which would be the person's own reports.
//
// `kit` is scenarios.mjs's RUN_START_KIT (see scenarios-run-start-choice.mjs for what it holds): kit.rt carries waveService,
// kit.jarvis the Brief's naps and viewport. This file imports agent-page-fixtures.mjs itself for the page's own modules.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const RPC = { timeout: 30000 };
const TEXT_MARK = "verify bug-report-jarvis";
const TERMINAL_PROJECT = "verify-bug-report-jarvis";
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

// The Brief's Waiting list: its queue rows (the strip folds behind Show all when more than a few wait), and the bug row,
// told by any of its three texts. The strip's head line is a row too: with one item waiting it is the only one (no Show
// all, no queue rows), and it carries that item's acts (waitingstrip.tsx)
const BRIEF_ROWS = `[...document.querySelectorAll('[data-jarvis-waiting-strip] [data-jarvis-brief-row="queue"], [data-jarvis-waiting-strip] [data-jarvis-waiting-head]')]`;
const BRIEF_ROW = `${BRIEF_ROWS}.find((r) => /báo lỗi|Không tìm thấy repo arcterm/.test(r.innerText))`;
const SHOW_ALL = `document.querySelector('[data-jarvis-strip-show-all="shut"]')?.click()`;
// the Cockpit's Needs-you strip row for the same item (needsyoustripmodel.ts keys it "bug-reports")
const STRIP_ROW = `document.querySelector('[data-cockpit-needs-you] [data-needs-you-row="bug-reports"]')`;

const briefFacts = (h) =>
    h.ev(`(() => {
        ${SHOW_ALL};
        const row = ${BRIEF_ROW};
        if (!row) return null;
        return {
            text: row.innerText.replace(/\\s+/g, ' ').trim(),
            acts: [...row.querySelectorAll('[data-jarvis-queue-act]')].map((b) => b.dataset.jarvisQueueAct + ':' + b.textContent.trim()),
        };
    })()`);

const stripFacts = (h) =>
    h.ev(`(() => {
        const row = ${STRIP_ROW};
        if (!row) return null;
        return {
            text: row.innerText.replace(/\\s+/g, ' ').trim(),
            acts: [...row.querySelectorAll('[data-strip-act]')].map((b) => b.dataset.stripAct + ':' + b.textContent.trim()),
            open: row.querySelector('[data-needs-you-open]')?.dataset.needsYouOpen ?? null,
        };
    })()`);

// the attention list is polled every few seconds: a wait asks for it itself, so no wait is longer than its own call
const refreshAttention = (h) =>
    AC.agentPage(h, `const m = await mod("app/view/agents/attentionstore.ts"); await m.loadAttention(); return true;`).catch(
        () => false
    );

async function waitFor(h, expr, ms) {
    for (const end = Date.now() + ms; ; ) {
        await refreshAttention(h);
        if (await h.ev(expr).catch(() => false)) return true;
        if (Date.now() >= end) return false;
        await nap(500);
    }
}

const focusId = (h) => AC.agentPage(h, `return globalStore.get(agentsModel().focusIdAtom);`);
const surface = (h) => h.activeSurfaceLabel();

// the reports this scenario saved, whatever state they reached (a done one lives under reports/done/)
async function ourReports(h, states = ["waiting", "handling", "done"]) {
    const out = [];
    for (const state of states) {
        const list = await h.rpc("bugreportlist", { state }, RPC).catch(() => []);
        out.push(...(list ?? []).filter((r) => (r.text ?? "").startsWith(TEXT_MARK)));
    }
    return out;
}

const installFakes = (h, { pickDir, tabId }) =>
    h.ev(`(() => {
        window.__bugLaunches = [];
        window.__bugReportPickFake = async () => ${JSON.stringify(pickDir)};
        window.__bugReportLaunchFake = async (opts) => {
            window.__bugLaunches.push({ label: opts.label, projectName: opts.projectName, projectPath: opts.projectPath, task: opts.task });
            return ${JSON.stringify(tabId)};
        };
        return true;
    })()`);

export default function (kit) {
    const waveService = kit.rt?.waveService ?? kit.waveService;
    const { briefNap, briefViewport } = kit.jarvis ?? kit;

    // a plain terminal tab, the way launchAgent makes one (CreateTab, then the terminal meta); tracked on ctx the moment it
    // exists so a failure after it still lets teardown close it
    const makeTerminal = async (h, ctx) => {
        const tabId = await waveService(h, "workspace", "CreateTab", [ctx.workspaceId, TERMINAL_PROJECT, false]);
        ctx.tabs.push(tabId);
        const tab = await waveService(h, "object", "GetObject", [`tab:${tabId}`]);
        const blockId = tab?.blockids?.[0];
        if (!blockId) throw new Error(`the new tab ${tabId} has no block`);
        await h.rpc("setmeta", { oref: `block:${blockId}`, meta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
        await h.rpc("setmeta", { oref: `tab:${tabId}`, meta: { "session:project": TERMINAL_PROJECT } });
        return tabId;
    };
    const closeTab = (h, ctx, tabId) => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, tabId, false]);

    const scenario = {
        name: "bug-report-jarvis",
        surface: "jarvis",
        async arrange(h) {
            const ctx = { tabs: [], closed: [], ids: [] };
            // a throw past this point still returns ctx, so teardown removes whatever was already made
            try {
                const status = await h.rpc("bugreportstatus", null, RPC);
                if ((status?.waiting ?? 0) + (status?.handling ?? 0) > 0) {
                    ctx.skip = "the dev store holds bug reports of its own: this scenario counts exactly two and marks them done";
                    return ctx;
                }
                ctx.pickDir = mkdtempSync(join(tmpdir(), "verify-bug-repo-"));
                const cfg = await h.rpc("getfullconfig", null);
                ctx.prevRepo = cfg?.settings?.["bugreport:repo"] ?? "";
                ctx.prevProjects = Object.keys(cfg?.projects ?? {});
                ctx.prevView = await AC.agentPage(
                    h,
                    `const O = await mod("app/view/agents/officestore.ts"); return globalStore.get(O.cockpitViewAtom);`
                );
                const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                const wslist = await h.rpc("workspacelist", null);
                const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
                ctx.workspaceId = ws.workspacedata.oid;
                for (const which of ["A", "B"]) {
                    await h.rpc(
                        "bugreportsave",
                        { text: `${TEXT_MARK} report ${which}`, ts: Date.now(), version: "verify", surface: "jarvis" },
                        RPC
                    );
                }
                ctx.ids = (await ourReports(h, ["waiting"])).map((r) => r.id);
                ctx.tabA = await makeTerminal(h, ctx);
                ctx.tabB = await makeTerminal(h, ctx);
                // the missing folder step 1 points the setting at
                ctx.missingDir = join(tmpdir(), `verify-bug-repo-missing-${Date.now()}`);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail: JSON.stringify(detail) });
            if (ctx.skip != null) {
                return [{ step: "arrange: a dev store with no bug reports of its own", skip: true, detail: ctx.skip }];
            }
            if (ctx.arrangeError != null || ctx.ids.length !== 2) {
                return [
                    {
                        step: "arrange: save two reports and make the fake agents' tabs",
                        ok: false,
                        detail: ctx.arrangeError ?? `saved ${ctx.ids.length} reports, wanted 2`,
                    },
                ];
            }
            await briefViewport(h, 1600, 1000);
            await h.goto("jarvis");

            // 1. no arcterm repo (the setting names a folder that does not exist): the Brief's Waiting list asks for the folder
            await h.rpc("setconfig", { "bugreport:repo": ctx.missingDir });
            const noRepo = await waitFor(h, `(() => { ${SHOW_ALL}; return !!(${BRIEF_ROW}) && /Không tìm thấy repo arcterm/.test((${BRIEF_ROW}).innerText); })()`, 40000);
            await briefNap(300);
            const row1 = noRepo ? await briefFacts(h) : null;
            await h.shot("cdp-shots/bug-report-jarvis-1-no-repo.png");
            rec(
                '1. with no repo the Brief\'s Waiting list reads "Không tìm thấy repo arcterm" with a "Chọn thư mục…" button',
                row1 != null && row1.acts.join("|") === "pick-repo:Chọn thư mục…",
                row1 ?? { noRepo }
            );

            // 2. Chọn thư mục… keeps the folder as the setting and registers it as a project, and the row turns into Xử lý
            await installFakes(h, { pickDir: ctx.pickDir, tabId: ctx.tabA });
            await h.ev(`${BRIEF_ROW}?.querySelector('[data-jarvis-queue-act="pick-repo"]')?.click()`);
            let repoSet = false;
            let project = null;
            for (const end = Date.now() + 40000; Date.now() < end && !(repoSet && project); ) {
                const cfg = await h.rpc("getfullconfig", null);
                repoSet = norm(cfg?.settings?.["bugreport:repo"]) === norm(ctx.pickDir);
                project = Object.entries(cfg?.projects ?? {}).find(([, p]) => norm(p?.path) === norm(ctx.pickDir))?.[0] ?? null;
                if (!(repoSet && project)) await nap(500);
            }
            ctx.project = project;
            const readyRow = await waitFor(
                h,
                `(() => { ${SHOW_ALL}; const r = ${BRIEF_ROW}; return !!r && r.innerText.includes('2 báo lỗi arcterm chờ xử lý') && !!r.querySelector('[data-jarvis-queue-act="process-reports"]'); })()`,
                40000
            );
            await briefNap(300);
            const row2 = readyRow ? await briefFacts(h) : null;
            await h.shot("cdp-shots/bug-report-jarvis-2-process.png");
            rec(
                '2. Chọn thư mục… keeps the folder as bugreport:repo and registers a project at it, and the row reads "2 báo lỗi arcterm chờ xử lý" with Xử lý',
                repoSet && project != null && row2 != null && row2.acts.join("|") === "process-reports:Xử lý",
                { repoSet, project, row: row2 }
            );

            // 3. the creature's peek lists the row with one Open that lands on the Brief (the folder picker and Xử lý stay there)
            await h.goto("cockpit");
            await AC.agentPage(h, `const O = await mod("app/view/agents/officestore.ts"); globalStore.set(O.cockpitViewAtom, "cards"); return true;`);
            await briefNap(500);
            await h.ev(`document.querySelector('[aria-label="Jarvis condition"]')?.click()`);
            const peekRow = await waitFor(h, `!!document.querySelector('[data-pet-row="bug-reports"]')`, 40000);
            const peek = peekRow
                ? await h.ev(`(() => {
                      const row = document.querySelector('[data-pet-row="bug-reports"]');
                      return {
                          text: row.innerText.replace(/\\s+/g, ' ').trim(),
                          acts: [...row.querySelectorAll('[data-pet-act]')].map((b) => b.dataset.petAct + ':' + b.textContent.trim()),
                      };
                  })()`)
                : null;
            await briefNap(300);
            await h.shot("cdp-shots/bug-report-jarvis-3-peek.png");
            await h.ev(`document.querySelector('[data-pet-row="bug-reports"] [data-pet-act="bug-reports:open-brief"]')?.click()`);
            await nap(800);
            const onBrief = await surface(h);
            rec(
                "3. the creature's peek lists the row with one Open, which lands on the Jarvis surface",
                peek != null &&
                    peek.acts.join("|") === "bug-reports:open-brief:Open" &&
                    peek.text.includes("2 báo lỗi arcterm chờ xử lý") &&
                    onBrief === "Jarvis",
                { peek, onBrief }
            );

            // 4. the Cockpit's Needs-you strip shows the same row with Xử lý; pressing it launches the agent (the fake) and claims both
            await h.goto("cockpit");
            const stripReady = await waitFor(
                h,
                `(() => { const r = ${STRIP_ROW}; return !!r && r.innerText.includes('2 báo lỗi arcterm chờ xử lý') && !!r.querySelector('[data-strip-act="process-reports"]'); })()`,
                40000
            );
            const strip4 = stripReady ? await stripFacts(h) : null;
            await h.shot("cdp-shots/bug-report-jarvis-4-strip.png");
            await h.ev(`${STRIP_ROW}?.querySelector('[data-strip-act="process-reports"]')?.click()`);
            const handling = await waitFor(
                h,
                `(() => { const r = ${STRIP_ROW}; return !!r && r.innerText.includes('Đang xử lý 2 báo lỗi'); })()`,
                40000
            );
            const strip4b = handling ? await stripFacts(h) : null;
            const launches = await h.ev(`window.__bugLaunches ?? []`);
            const held = await ourReports(h, ["handling"]);
            await h.shot("cdp-shots/bug-report-jarvis-4-strip-handling.png");
            rec(
                '4. the Needs-you strip shows Xử lý on the row; pressing it opens the agent in arcterm\'s repo and the row turns "Đang xử lý 2 báo lỗi" with Mở agent, both reports handling under that tab',
                strip4 != null &&
                    strip4.acts.join("|") === "process-reports:Xử lý" &&
                    strip4b != null &&
                    strip4b.acts.join("|") === "open:Mở agent" &&
                    launches.length === 1 &&
                    launches[0].label === "Báo lỗi arcterm" &&
                    launches[0].projectName === project &&
                    norm(launches[0].projectPath) === norm(ctx.pickDir) &&
                    ctx.ids.every((id) => launches[0].task.includes(id)) &&
                    held.length === 2 &&
                    held.every((r) => r.state === "handling" && r.handler === ctx.tabA),
                { strip4, strip4b, launches: launches.map((l) => ({ ...l, task: `${l.task.length} chars` })), held: held.map((r) => [r.id, r.state, r.handler]) }
            );

            // 5. the Brief reads the same handling row, and its Mở agent opens the agent
            await h.goto("jarvis");
            const briefHandling = await waitFor(
                h,
                `(() => { ${SHOW_ALL}; const r = ${BRIEF_ROW}; return !!r && r.innerText.includes('Đang xử lý 2 báo lỗi') && !!r.querySelector('[data-jarvis-queue-act="open"]'); })()`,
                40000
            );
            await briefNap(300);
            const row5 = briefHandling ? await briefFacts(h) : null;
            await h.shot("cdp-shots/bug-report-jarvis-5-handling.png");
            await h.ev(`${BRIEF_ROW}?.querySelector('[data-jarvis-queue-act="open"]')?.click()`);
            let onAgent = false;
            for (const end = Date.now() + 10000; Date.now() < end && !onAgent; ) {
                onAgent = (await surface(h)) === "Agent" && (await focusId(h)) === ctx.tabA;
                if (!onAgent) await nap(300);
            }
            rec(
                '5. the Brief reads "Đang xử lý 2 báo lỗi" with Mở agent, which opens the agent: the Agent surface, focus on its tab',
                row5 != null && row5.acts.join("|") === "open:Mở agent" && onAgent,
                { row5, surface: await surface(h), focus: await focusId(h) }
            );

            // 6. the strip's Mở agent does the same from the Cockpit, which has no card for a terminal
            await AC.agentPage(h, `agentsModel().openTerminal(${JSON.stringify(ctx.tabB)}); return true;`);
            await h.goto("cockpit");
            const stripOpen = await waitFor(
                h,
                `(() => { const r = ${STRIP_ROW}; return !!r && !!r.querySelector('[data-strip-act="open"]'); })()`,
                40000
            );
            await h.ev(`${STRIP_ROW}?.querySelector('[data-strip-act="open"]')?.click()`);
            let stripLanded = false;
            for (const end = Date.now() + 10000; Date.now() < end && !stripLanded; ) {
                stripLanded = (await surface(h)) === "Agent" && (await focusId(h)) === ctx.tabA;
                if (!stripLanded) await nap(300);
            }
            rec(
                "6. the strip's Mở agent opens the agent too: the Agent surface, focus on its tab (from another terminal's)",
                stripOpen && stripLanded,
                { stripOpen, surface: await surface(h), focus: await focusId(h) }
            );

            // 7. closing the agent's tab sends the reports back to waiting, and the row to Xử lý, on the next poll
            await h.goto("jarvis");
            await closeTab(h, ctx, ctx.tabA);
            ctx.closed.push(ctx.tabA);
            const back = await waitFor(
                h,
                `(() => { ${SHOW_ALL}; const r = ${BRIEF_ROW}; return !!r && r.innerText.includes('2 báo lỗi arcterm chờ xử lý') && !!r.querySelector('[data-jarvis-queue-act="process-reports"]'); })()`,
                60000
            );
            const waiting = await ourReports(h, ["waiting"]);
            rec(
                '7. closing the agent\'s tab puts both reports back to waiting and the row back to "2 báo lỗi arcterm chờ xử lý"',
                back && waiting.length === 2 && waiting.every((r) => !r.handler),
                { back, waiting: waiting.map((r) => [r.id, r.state, r.handler ?? ""]) }
            );

            // 8. Xử lý in the Brief with a second tab, then both reports marked done: the row is gone
            await installFakes(h, { pickDir: ctx.pickDir, tabId: ctx.tabB });
            await h.ev(`${BRIEF_ROW}?.querySelector('[data-jarvis-queue-act="process-reports"]')?.click()`);
            const again = await waitFor(
                h,
                `(() => { ${SHOW_ALL}; const r = ${BRIEF_ROW}; return !!r && r.innerText.includes('Đang xử lý 2 báo lỗi'); })()`,
                40000
            );
            const underB = await ourReports(h, ["handling"]);
            for (const r of underB) {
                await h.rpc(
                    "bugreportdone",
                    { id: r.id, outcome: { text: "verify: handled by the scenario" } },
                    RPC
                );
            }
            const gone = await waitFor(h, `(() => { ${SHOW_ALL}; return !(${BRIEF_ROW}); })()`, 40000);
            await briefNap(300);
            await h.shot("cdp-shots/bug-report-jarvis-8-done.png");
            const done = await ourReports(h, ["done"]);
            rec(
                "8. Xử lý in the Brief holds both reports under the second tab; once both are marked done the row is gone and both are listed done",
                again &&
                    underB.length === 2 &&
                    underB.every((r) => r.handler === ctx.tabB) &&
                    gone &&
                    done.length === 2 &&
                    done.every((r) => r.state === "done" && (r.outcome?.text ?? "") !== ""),
                {
                    again,
                    underB: underB.map((r) => [r.id, r.handler]),
                    gone,
                    done: done.map((r) => [r.id, r.state, r.outcome?.text ?? ""]),
                }
            );
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`bug-report-jarvis teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("remove the fakes", () =>
                h.ev(`delete window.__bugReportLaunchFake; delete window.__bugReportPickFake; delete window.__bugLaunches; true`)
            );
            await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
            for (const tabId of ctx?.tabs ?? []) {
                if (!(ctx.closed ?? []).includes(tabId)) {
                    await step(`close tab ${tabId}`, () => closeTab(h, ctx, tabId));
                }
            }
            if (ctx?.prevRepo != null) {
                await step("restore bugreport:repo", () => h.rpc("setconfig", { "bugreport:repo": ctx.prevRepo }));
            }
            // the project the picker registered, found again by its path in case step 2 failed before recording it
            await step("remove the project the picker registered", async () => {
                if (ctx?.prevProjects == null) return;
                const cfg = await h.rpc("getfullconfig", null);
                for (const [name, p] of Object.entries(cfg?.projects ?? {})) {
                    if (!ctx.prevProjects.includes(name) && norm(p?.path) === norm(ctx.pickDir)) {
                        await h.rpc("deleteproject", { name });
                    }
                }
            });
            // the reports' folders, wherever they ended up (done ones moved under reports/done/); only a folder named by one
            // of this scenario's report ids is removed
            await step("delete the reports' folders", async () => {
                for (const r of await ourReports(h)) {
                    if (r.dir && basename(r.dir) === r.id && existsSync(r.dir)) {
                        rmSync(r.dir, { recursive: true, force: true });
                    }
                }
            });
            if (ctx?.pickDir) await step("remove the temp folder", () => rmSync(ctx.pickDir, { recursive: true, force: true }));
            if (ctx?.prevView != null) {
                await step("restore the Cockpit's view", () =>
                    AC.agentPage(
                        h,
                        `const O = await mod("app/view/agents/officestore.ts"); globalStore.set(O.cockpitViewAtom, ${JSON.stringify(ctx.prevView)}); return true;`
                    )
                );
            }
            await step("refresh the attention list", () => refreshAttention(h));
            await step("land on the cockpit", () => h.goto("cockpit"));
        },
    };
    return [scenario];
}
