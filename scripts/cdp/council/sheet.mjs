// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// jarvis-council-sheet (docs/superpowers/plans/2026-11-05-jarvis-revamp.md, Task 3; spec decision 8, board
// Council.dc.html): a council's report in the Brief's 640px sheet. A finished council is seeded (the `done` fixture with
// a first step on each direction and a saved report path), opened through the page's own openCouncilSheet, and read:
// the head, the verdict block, the ranked directions with their First step and both actions, Ask next and the foot. Work
// on opens the New dialog's agent half with the direction in its Task box and starts nothing. A running council (the
// `round2` fixture) shows its round instead of a verdict.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Nothing here
// calls a model or starts an agent; teardownCouncilProject reloads the page, which drops the launcher's draft and the
// sheet with the rest of the in-memory state.

import { join } from "node:path";
import { waitFor } from "../attach.mjs";
import { arrangeCouncilProject, COUNCIL_PROJECT, loadCouncilFixture, seedCouncil, teardownCouncilProject } from "./fixtures.mjs";

const WAIT_MS = 10_000;
const q = (s) => JSON.stringify(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);

const SHEET = '[data-jarvis-brief-sheet="council"]';
const BODY = (id) => `${SHEET} [data-council-sheet-body][data-council-id=${q(id)}]`;
const STEPS = [
    "Put the pinned app ids in settings.json under apps.rail",
    "Draw a moon badge on an asleep app's rail icon",
    "Measure an awake app's RAM after an hour",
    "Draw a dashed slot with Pin an app",
];
const REPORT = "docs/council/2026-11-05-rail-apps.md";
const TITLES = loadCouncilFixture("done").summary.directions.map((d) => d.title);

// runs `body` in the page with the app's module at `path` (under frontend/) imported as `mod`. The url is the one the
// app loaded, so the import is its own instance (fixtures.mjs inPageApi does the same for RpcApi): the page's resource
// list when it still holds the module, else the same path under the base the app's wshclientapi was served from (the
// resource list keeps the first 250 entries only, and a module loaded late falls past it).
const inPageModule = (path, body) => `(async () => {
    const names = performance.getEntriesByType("resource").map((e) => e.name);
    const own = names.filter((n) => n.split("?")[0].endsWith(${q(path)}));
    let url = own[own.length - 1];
    if (!url) {
        const api = names.find((n) => /\\/app\\/store\\/wshclientapi\\.ts(\\?|$)/.test(n));
        if (!api) return { ok: false, why: "no wshclientapi module in the page's resources to find the base by" };
        url = api.split("?")[0].replace(/\\/app\\/store\\/wshclientapi\\.ts$/, ${q(path)});
    }
    const mod = await import(url);
    ${body}
})()`;

// opens the Brief's sheet on a council the way the Activity line does, and waits for its body
async function openSheet(h, id) {
    const r = await h.ev(
        inPageModule("/app/view/jarvis/councilsheetstore.ts", `mod.openCouncilSheet(${q(id)}); return { ok: true };`)
    );
    if (!r?.ok) throw new Error(`openCouncilSheet: ${r?.why ?? "no answer from the page"}`);
    if (!(await until(h, `!!document.querySelector(${q(BODY(id))})`))) {
        throw new Error(`the council sheet did not draw ${id}`);
    }
}

// the workspace's tab ids: an agent spawned is a new tab
async function tabIds(h, ctx) {
    const list = await h.rpc("workspacelist", null);
    return list.find((w) => w.workspacedata?.oid === ctx.workspaceId)?.workspacedata?.tabids ?? [];
}

export const councilSheet = {
    surface: "jarvis",

    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.doneId = await seedCouncil(h, ctx, "done", {
                edit: (c) => {
                    c.summary.directions.forEach((d, i) => {
                        d.firststep = STEPS[i];
                    });
                    c.docpath = join(ctx.repo, ...REPORT.split("/"));
                },
            });
            ctx.runningId = await seedCouncil(h, ctx, "round2");
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const step = async (name, run) => {
            try {
                const r = await run();
                steps.push({ step: name, ok: r.ok === true, detail: r.detail });
            } catch (e) {
                steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
            }
        };

        await step("council sheet open", async () => {
            await openSheet(h, ctx.doneId);
            await h.shot("cdp-shots/jarvis-council-sheet.png");
            const read = await h.ev(`(() => {
                const sheet = document.querySelector(${q(SHEET)});
                const t = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
                const dirs = [...sheet.querySelectorAll("[data-council-sheet-direction]")];
                const foot = sheet.querySelector("[data-council-sheet-foot]");
                return {
                    chip: t(sheet.querySelector("[data-council-sheet-head] span")),
                    meta: t(sheet.querySelector("[data-council-sheet-meta]")),
                    verdict: t(sheet.querySelector('[data-council-sheet-verdict="verdict"] [data-council-sheet-answer]')),
                    ranks: dirs.map((d) => d.dataset.councilSheetDirection),
                    steps: dirs.map((d) => t(d.querySelector("[data-council-sheet-step]"))),
                    outcome: t(dirs[0]?.querySelector("[data-council-sheet-outcome]")),
                    workOn: dirs.filter((d) => d.querySelector("[data-council-sheet-work-on]")).length,
                    add: dirs.filter((d) => d.querySelector("[data-council-sheet-add]")).length,
                    asks: [...sheet.querySelectorAll("[data-council-sheet-ask]")].map((a) => ({
                        text: t(a),
                        chat: !!a.querySelector("[data-council-sheet-ask-chat]"),
                    })),
                    fold: t(sheet.querySelector("[data-council-sheet-fold-toggle]")),
                    chat: !!foot?.querySelector("[data-council-sheet-chat]"),
                    report: foot?.querySelector("[data-council-sheet-report]")?.disabled === false,
                    path: t(foot?.querySelector("[data-council-sheet-path]")),
                };
            })()`);
            const problems = [];
            if (read.chip !== "council · review") problems.push(`chip "${read.chip}"`);
            if (!read.meta.startsWith(`${COUNCIL_PROJECT} · 4 experts · done`)) problems.push(`meta "${read.meta}"`);
            if (read.verdict === "") problems.push("no verdict line");
            if (read.ranks.join(",") !== "1,2,3,4") problems.push(`ranks ${read.ranks.join(",")}`);
            STEPS.forEach((s, i) => {
                if (!read.steps[i]?.includes(s)) problems.push(`direction ${i + 1}'s First step "${read.steps[i]}"`);
            });
            if (read.outcome !== "✓ Agreed") problems.push(`direction 1's outcome "${read.outcome}"`);
            if (read.workOn !== 4 || read.add !== 4) problems.push(`actions: ${read.workOn} Work on, ${read.add} Add`);
            if (read.asks.length === 0 || read.asks.some((a) => !a.chat)) problems.push("Ask next rows");
            if (!read.fold.includes("Matrix")) problems.push(`fold "${read.fold}"`);
            if (!read.chat || !read.report || read.path !== REPORT) {
                problems.push(`foot: chat ${read.chat}, report ${read.report}, path "${read.path}"`);
            }
            return { ok: problems.length === 0, detail: problems.length === 0 ? `${read.asks.length} asks` : problems.join("; ") };
        });

        await step("work on prefills", async () => {
            const before = await tabIds(h, ctx);
            await h.ev(`document.querySelector(${q(`${SHEET} [data-council-sheet-direction="1"] [data-council-sheet-work-on]`)})?.click()`);
            if (!(await until(h, `!!document.querySelector("[data-launcher] #launcher-task")`))) {
                return { ok: false, detail: "the New dialog's agent half did not open" };
            }
            await sleep(500);
            await h.shot("cdp-shots/jarvis-council-sheet-work-on.png");
            const read = await h.ev(`(() => ({
                heading: document.querySelector("[data-launcher] h2")?.innerText?.trim() ?? "",
                task: document.querySelector("[data-launcher] #launcher-task")?.value ?? "",
                project: document.querySelector(${q(`[data-project-row="${COUNCIL_PROJECT}"]`)})?.getAttribute("aria-checked") ?? "",
            }))()`);
            await sleep(1000);
            const after = await tabIds(h, ctx);
            const want = `${TITLES[0]}\n\nFirst step: ${STEPS[0]}`;
            const problems = [];
            if (read.heading !== "New agent") problems.push(`heading "${read.heading}"`);
            if (read.task !== want) problems.push(`task box ${q(read.task)}`);
            if (read.project !== "true") problems.push(`${COUNCIL_PROJECT} not picked`);
            if (after.length !== before.length) problems.push(`tabs ${before.length} -> ${after.length}: something spawned`);
            // close the dialog for the step after; the reload in teardown drops its draft
            for (const type of ["keyDown", "keyUp"]) {
                await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            }
            await until(h, `!document.querySelector("[data-launcher]")`, 3_000);
            return { ok: problems.length === 0, detail: problems.join("; ") || "agent half, task filled, nothing spawned" };
        });

        await step("running council", async () => {
            await openSheet(h, ctx.runningId);
            await h.shot("cdp-shots/jarvis-council-sheet-running.png");
            const read = await h.ev(`(() => {
                const sheet = document.querySelector(${q(SHEET)});
                return {
                    working: !!sheet.querySelector('[data-council-sheet-verdict="working"]'),
                    verdict: !!sheet.querySelector('[data-council-sheet-verdict="verdict"]'),
                    round: sheet.querySelector("[data-council-sheet-round]")?.innerText?.trim() ?? "",
                    live: !!sheet.querySelector("[data-council-sheet-live]"),
                };
            })()`);
            const ok = read.working && !read.verdict && /^Round \d+ of \d+/.test(read.round) && read.live;
            return { ok, detail: `round "${read.round}", verdict ${read.verdict}, live link ${read.live}` };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await h.ev(`document.querySelector('${SHEET} [data-council-sheet-head] button[aria-label="Close (Esc)"]')?.click()`).catch(() => {});
        await teardownCouncilProject(h, ctx);
    },
};
