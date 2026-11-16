// The queue's re-check when an entry's turn comes: an entry whose files a later live run also edits waits for that run
// too (docs/superpowers/specs/2026-11-16-run-start-choice-design.md, "Re-check when an entry's turn comes"; plan
// docs/superpowers/plans/2026-11-16-run-start-choice.md).
//
//   Task 4 — run-queue-recheck: an entry gains a run created after it in its After, and its queue sheet in Brief names
//            the run and the reason ("Waiting for … too: both edit …").
//
// `kit` is scenarios.mjs's RUN_START_KIT (see scenarios-run-start-choice.mjs for what it holds). A scenario that lacks a
// small helper copies it here rather than editing scenarios.mjs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = { timeout: 30000 };
const PROJECT = "verify-run-queue-recheck";
// the file both goals name: the re-check reads mentions in the goal, and no git is needed for it
const FILE = "pkg/verifyrecheck/recheckdemo.go";
const ENTRY_GOAL = `verify run-queue-recheck: queued entry that edits ${FILE}`;
const FIXTURE_GOAL = `verify run-queue-recheck: later run that edits ${FILE}`;
const FILL_GOAL = "verify run-queue-recheck: the run that fills the cap";

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(h, expr, ms) {
    for (let waited = 0; waited < ms; waited += 250) {
        if (await h.ev(expr).catch(() => false)) return true;
        await nap(250);
    }
    return false;
}

// a reload gives the Brief the runs made since it last read its briefing; the marker keeps the wait off the old page
async function reload(h) {
    try {
        await h.ev("window.__cdpReloading = true; location.reload()");
    } catch {
        /* the evaluate is cut off by the navigation it just started */
    }
    await waitFor(h, "!window.__cdpReloading && !!window.TabRpcClient && !!document.querySelector('nav button')", 30000);
}

const ACTIVITY_TAB_ALL = `document.querySelector('[data-jarvis-activity-tab="all"]')`;
const QUEUED_LINE = `document.querySelector('[data-jarvis-brief-region="activity"] [data-jarvis-activity-queued]')`;
const REASON = `(document.querySelector('[data-queue-sheet-reason]')?.textContent ?? '').replace(/\\s+/g, ' ').trim()`;

const runQueueRecheckScenario = (kit) => ({
    name: "run-queue-recheck",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { dirs: [], channelIds: [], entryIds: [] };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            // entries an earlier, interrupted run of this scenario left in the shared dev store
            for (const e of await kit.rqList(h)) {
                if (e.data?.goal === ENTRY_GOAL) await h.rpc("runqueueremove", { id: e.id });
            }
            const dir = mkdtempSync(join(tmpdir(), `${PROJECT}-`));
            const fillDir = mkdtempSync(join(tmpdir(), `${PROJECT}-fill-`));
            ctx.dirs.push(dir, fillDir);
            ctx.prevMax = (await h.rpc("getfullconfig", null))?.settings?.["runs:maxactive"] ?? null;
            const wslist = await h.rpc("workspacelist", null);
            ctx.workspaceId = wslist[0].workspacedata.oid;

            // The cap is held full by a quick run held by deferstart (it spawns nothing and counts as active), in a
            // channel of its own so it is no live run of the project the entry belongs to.
            const fillCh = await h.rpc("createchannel", { name: `${PROJECT}-fill`, projectpath: fillDir });
            ctx.fillChannelId = fillCh.oid;
            ctx.channelIds.push(fillCh.oid);
            await h.rpc(
                "createrun",
                { channelid: fillCh.oid, workspaceid: ctx.workspaceId, goal: FILL_GOAL, runtime: "claude", mode: "quick", deferstart: true },
                RPC
            );
            ctx.active = (await h.rpc("runqueuelist", null))?.active ?? 0;
            if (ctx.active < 1) throw new Error("the run that fills the cap is not counted as active");
            await h.rpc("setconfig", { "runs:maxactive": ctx.active });

            // the project's channel: the entry and the later run both belong to it
            const ch = await h.rpc("createchannel", { name: PROJECT, projectpath: dir });
            ctx.channelId = ch.oid;
            ctx.channelIds.push(ch.oid);
            const data = { channelid: ctx.channelId, workspaceid: ctx.workspaceId, runtime: "claude", mode: "quick", deferstart: true };
            const entry = await h.rpc("runqueueadd", { data: { ...data, goal: ENTRY_GOAL } }, RPC);
            ctx.entryId = entry.id;
            ctx.entryTitle = entry.title;
            ctx.entryIds.push(entry.id);

            // the run is created after the entry: a run the person saw and passed over is never added back, so the
            // entry's queuedts has to be older than the run's createdts
            await nap(1200);
            const fixture = await h.rpc("createrun", { ...data, goal: FIXTURE_GOAL }, RPC);
            ctx.fixtureRunId = fixture.run.id ?? fixture.run.oid;
            const now = await h.rpc("runqueuelist", null);
            ctx.activeWithFixture = now?.active ?? 0;
            if (ctx.activeWithFixture !== ctx.active + 1) {
                throw new Error(`the later run is not counted as active: ${ctx.active} before, ${ctx.activeWithFixture} after`);
            }
            // room for the entry, so its turn comes and the re-check runs (the change pokes the loop)
            await h.rpc("setconfig", { "runs:maxactive": ctx.activeWithFixture + 1 });
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        rec(
            "0. the cap was full when the entry was queued, a run that names the same file was made after it, and the cap was then raised",
            ctx.arrangeError == null,
            ctx.arrangeError ?? { active: ctx.active, activeWithFixture: ctx.activeWithFixture, entry: ctx.entryId, run: ctx.fixtureRunId }
        );
        if (ctx.arrangeError != null) return steps;

        try {
            // 1. the entry's turn came and the re-check held it: its After gained the run, with the reason, and no run
            // was started from it
            let entry = null;
            for (let waited = 0; waited < 40000; waited += 500) {
                entry = (await kit.rqList(h)).find((e) => e.id === ctx.entryId) ?? null;
                if (entry == null || entry.after?.includes(ctx.fixtureRunId)) break;
                await nap(500);
            }
            const wantReason = `Waiting for ${FIXTURE_GOAL} too: both edit ${FILE}`;
            const runs = (await h.rpc("getchannelruns", { channelid: ctx.channelId }))?.runs ?? [];
            rec(
                "1. when its turn came the queue re-checked the entry: it gained the later run in its After with the reason, kept waiting, and no run was made from it",
                entry != null &&
                    JSON.stringify(entry.after) === JSON.stringify([ctx.fixtureRunId]) &&
                    entry.state === "waiting" &&
                    entry.reason === wantReason &&
                    runs.length === 1,
                { entry: entry && { state: entry.state, after: entry.after, reason: entry.reason }, runsInChannel: runs.length, wantReason }
            );
            if (entry == null) return steps;

            // 2. the entry's queue sheet in the Brief names the run it waits on and the reason. The Brief reads its runs
            // when it mounts, so it leaves and comes back; Activity's tab is chosen while waiting, as it may render late
            await h.goto("cockpit");
            await reload(h);
            await h.goto("jarvis");
            await kit.bqCloseSheet(h);
            const lineUp = await waitFor(
                h,
                `(() => {
                    const all = ${ACTIVITY_TAB_ALL};
                    if (all && all.getAttribute("aria-pressed") !== "true") all.click();
                    return ${QUEUED_LINE} != null;
                })()`,
                30000
            );
            const opened = lineUp && (await kit.bqOpenQueued(h, ctx.entryTitle));
            const f = opened ? await kit.bqSheetFacts(h) : null;
            const reason = opened ? await h.ev(REASON) : null;
            await h.shot("cdp-shots/run-queue-recheck-sheet.png");
            rec(
                "2. the entry's queue sheet in Brief names the later run in its waits line (a link to the run) and the reason line reads \"Waiting for … too: both edit …\"",
                opened &&
                    f?.face === "queued" &&
                    f.waits?.includes(FIXTURE_GOAL) &&
                    f.waitsLink === true &&
                    f.acts.includes("start") &&
                    f.acts.includes("remove") &&
                    reason === wantReason,
                { lineUp, opened, waits: f?.waits ?? null, waitsLink: f?.waitsLink ?? null, acts: f?.acts ?? null, reason }
            );
        } catch (err) {
            rec("the scenario stopped early: a page call failed", false, String(err?.message ?? err));
        }
        return steps;
    },
    async teardown(h, ctx) {
        const failures = [];
        const attempt = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                failures.push(`${what}: ${String(e?.message ?? e)}`);
            }
        };
        // an open sheet outlives the scenario
        await attempt("close the sheet", () => kit.bqCloseSheet(h));
        // the entry goes before the cap is restored, so restoring it cannot start it
        await attempt("remove the entries", async () => {
            for (const e of await kit.rqList(h)) {
                if (ctx.entryIds.includes(e.id) || e.data?.goal === ENTRY_GOAL) await h.rpc("runqueueremove", { id: e.id });
            }
        });
        for (const channelId of ctx.channelIds) {
            await attempt("cancel the runs", async () => {
                const runs = (await h.rpc("getchannelruns", { channelid: channelId }))?.runs ?? [];
                for (const run of runs) {
                    if (run.status !== "cancelled") await h.rpc("cancelrun", { channelid: channelId, runid: run.id });
                }
            });
            await attempt("delete the channel", () => h.rpc("deletechannel", { channelid: channelId }));
        }
        if ("prevMax" in ctx) {
            await attempt("restore runs:maxactive", () => h.rpc("setconfig", { "runs:maxactive": ctx.prevMax }));
        }
        for (const dir of ctx.dirs) {
            await attempt("remove the temp dir", () => rmSync(dir, { recursive: true, force: true }));
        }
        await attempt("go home", () => h.goto("cockpit"));
        if (failures.length > 0) throw new Error(failures.join("; "));
    },
});

export default function (kit) {
    return [runQueueRecheckScenario(kit)];
}
