// The run launcher's When row (Run now / After run… / Queue, with Jarvis's suggestion) and the brainstorm card that
// waits on a queued run: docs/superpowers/specs/2026-11-16-run-start-choice-design.md, plan
// docs/superpowers/plans/2026-11-16-run-start-choice.md.
//
//   Task 5 — run-start-choice: the steps that hold whichever answer the suggestion RPC gives (in a tree before Task 4 it
//            is the stub's "Couldn't check: …", at Final the real one).
//   Task 6 — run-start-choice-live and run-start-choice-brainstorm: the steps that need the real RPC and the
//            brainstorm notice.
//
// `kit` is scenarios.mjs's RUN_START_KIT: the brainstorm helpers (BS_KIT), the Kael kits (kit.rt, kit.code, kit.files,
// kit.jarvis), the run-seeding helpers (kit.run), the launcher's (openLauncherStart, OPEN_NEW_RUN, NEW_BUTTON) and
// fixture-run arrangers (arrangeFixtureRun, arrangeSheetDagRun), and the Brief's queue-sheet helpers (bqOpenQueued,
// bqCloseSheet, bqSheetFacts, bqClickExpr, bqPoll, bqWaitList, rqList). A scenario that lacks a small helper copies it
// here rather than editing scenarios.mjs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = { timeout: 30000 };
const PROJECT = "verify-run-start-choice";
const GOAL = "verify run-start-choice: do nothing and change no file";
const FILL_GOAL = "verify run-start-choice: the run that fills the cap";
// the page's own key for the launcher's recent-projects list (scenarios.mjs RECENT_PROJECTS_KEY)
const RECENT_KEY = "agent.launch.recentprojects";
// the goal box's pause before the row asks again is 400 ms (launcherwhenrow.tsx CHECK_PAUSE_MS)
const CHECK_PAUSE_MS = 400;

const LAUNCHER = `document.querySelector('[data-launcher]')`;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

async function waitFor(h, expr, ms) {
    for (let waited = 0; waited < ms; waited += 250) {
        if (await h.ev(expr).catch(() => false)) return true;
        await nap(250);
    }
    return false;
}

// createproject only writes projects.json; the server's config watcher picks it up a moment later
async function waitForProject(h, name) {
    for (let waited = 0; waited < 30000; waited += 250) {
        if ((await h.rpc("getfullconfig", null))?.projects?.[name] != null) return true;
        await nap(250);
    }
    return false;
}

// a reload gives the page the new project list and the recent list this scenario wrote; the marker keeps the wait off
// the old page, which still has its nav until the reload commits
async function reload(h) {
    try {
        await h.ev("window.__cdpReloading = true; location.reload()");
    } catch {
        /* the evaluate is cut off by the navigation it just started */
    }
    await waitFor(h, "!window.__cdpReloading && !!window.TabRpcClient && !!document.querySelector('nav button')", 30000);
    await h.goto("cockpit");
}

const setField = (elExpr, value) => `(() => {
    const el = ${elExpr};
    if (!el) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;

// what the dialog's When row and Start button show, in one evaluate
const WHEN_FACTS = `(() => {
    const d = ${LAUNCHER};
    const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const row = d?.querySelector('[data-launcher-when]');
    const primary = d?.querySelector('[data-launcher-primary]');
    // on screen, not just in the DOM: what is drawn at the element's centre is the element (a row clipped by a scroller,
    // or below its fold, has something else there)
    const seen = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        if (r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return hit != null && el.contains(hit);
    };
    return {
        open: d != null,
        row: row != null,
        seen: {
            row: seen(row),
            buttons: [...(row?.querySelectorAll('[data-when-choice]') ?? [])].map(seen),
            reason: row?.querySelector('[data-when-reason]') ? seen(row.querySelector('[data-when-reason]')) : null,
            list: row?.querySelector('[data-when-list]') ? seen(row.querySelector('[data-when-list]')) : null,
        },
        buttons: [...(row?.querySelectorAll('[data-when-choice]') ?? [])].map((b) => ({
            id: b.getAttribute('data-when-choice'),
            label: (b.firstChild?.textContent ?? '').trim(),
            pressed: b.getAttribute('aria-pressed') === 'true',
            suggested: b.querySelector('[data-when-suggested]') != null,
        })),
        reason: [...(row?.querySelectorAll('[data-when-reason] > span') ?? [])].map(flat),
        listed: [...(row?.querySelectorAll('[data-when-run]') ?? [])].map((r) => r.getAttribute('data-when-run')),
        listNote: flat(row?.querySelector('[data-when-list]')),
        primary: primary ? { label: (primary.firstChild?.textContent ?? '').trim(), disabled: primary.disabled } : null,
        footer: flat(d?.querySelector('[data-launcher-footer]')),
    };
})()`;

const pressWhen = (id) => `${LAUNCHER}?.querySelector('[data-when-choice="${id}"]')?.click()`;
const pressed = (f, id) => f?.buttons?.find((b) => b.id === id)?.pressed === true;
// the reason line has settled once it says something other than Checking…
const REASON_SETTLED = `(() => {
    const spans = [...(${LAUNCHER}?.querySelectorAll('[data-launcher-when] [data-when-reason] > span') ?? [])];
    return spans.length > 0 && !spans.some((s) => s.textContent.trim() === 'Checking…');
})()`;

// the project's channel, found by its folder: createproject made it; "" when there is none
async function ownChannel(h, ctx) {
    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
    return channels.find((c) => norm(c.projectpath) === norm(ctx.dir))?.oid ?? "";
}

const runStartChoiceScenario = (kit) => ({
    name: "run-start-choice",
    surface: "cockpit",
    async arrange(h) {
        const ctx = { dirs: [], entryIds: [] };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            const dir = mkdtempSync(join(tmpdir(), `${PROJECT}-`));
            const fillDir = mkdtempSync(join(tmpdir(), `${PROJECT}-fill-`));
            ctx.dirs.push(dir, fillDir);
            ctx.dir = dir;
            // entries an earlier, interrupted run of this scenario left in the shared dev store
            for (const e of await kit.rqList(h)) {
                if (e.data?.goal === GOAL || e.title === GOAL) await h.rpc("runqueueremove", { id: e.id });
            }
            await h.rpc("createproject", { name: PROJECT, path: dir });
            ctx.project = PROJECT;
            if (!(await waitForProject(h, PROJECT))) throw new Error(`project ${PROJECT} never reached the config`);

            // The cap is held full, so Start on Queue leaves the entry waiting instead of starting a real run: a quick
            // run held by deferstart spawns nothing and counts as active, in a channel of its own so it is no live run
            // of the project the launcher is checking, and the cap is set to what is active now.
            ctx.prevMax = (await h.rpc("getfullconfig", null))?.settings?.["runs:maxactive"] ?? null;
            const wslist = await h.rpc("workspacelist", null);
            ctx.workspaceId = wslist[0].workspacedata.oid;
            const ch = await h.rpc("createchannel", { name: `${PROJECT}-fill`, projectpath: fillDir });
            ctx.fillChannelId = ch.oid;
            await h.rpc(
                "createrun",
                {
                    channelid: ctx.fillChannelId,
                    workspaceid: ctx.workspaceId,
                    goal: FILL_GOAL,
                    runtime: "claude",
                    mode: "quick",
                    deferstart: true,
                },
                RPC
            );
            ctx.active = (await h.rpc("runqueuelist", null))?.active ?? 0;
            if (ctx.active < 1) throw new Error("the run that fills the cap is not counted as active");
            await h.rpc("setconfig", { "runs:maxactive": ctx.active });

            // our project first in the launcher's recent list, the developer's own list put back in teardown
            ctx.prevRecent = await h.ev(`localStorage.getItem(${JSON.stringify(RECENT_KEY)})`);
            const recent = [PROJECT, ...JSON.parse(ctx.prevRecent ?? "[]")];
            await h.ev(`localStorage.setItem(${JSON.stringify(RECENT_KEY)}, ${JSON.stringify(JSON.stringify(recent))})`);
            await reload(h);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
        rec(
            "0. a project is registered and the cap is held full by a run that spawns nothing",
            ctx.arrangeError == null,
            ctx.arrangeError ?? JSON.stringify({ active: ctx.active, maxactive: ctx.active })
        );
        if (ctx.arrangeError != null) return steps;

        // 1. + Run with a goal: the When row and its reason line
        await h.goto("cockpit");
        await h.ev(kit.OPEN_NEW_RUN);
        const opened = await waitFor(h, `!!${LAUNCHER}`, 8000);
        const projectRow = `${LAUNCHER}?.querySelector('[data-project-row="${PROJECT}"]')`;
        await waitFor(h, `!!${projectRow}`, 8000);
        await h.ev(`${projectRow}?.click()`);
        const picked = await waitFor(h, `${projectRow}?.getAttribute('aria-checked') === 'true'`, 4000);
        // a Quick run: one goal box, no plan to write
        await h.ev(`${LAUNCHER}?.querySelector('[data-start-row="quick"]')?.click()`);
        await waitFor(h, `${LAUNCHER}?.querySelector('[data-start-row="quick"]')?.getAttribute('aria-checked') === 'true'`, 4000);
        await h.ev(setField(`${LAUNCHER}?.querySelector('textarea[aria-label="Goal"]')`, GOAL));
        // the row asks again once the goal has sat still for its pause: wait that out, then for the answer
        await nap(CHECK_PAUSE_MS + 300);
        const settled = await waitFor(h, REASON_SETTLED, 10000);
        await nap(300);
        let f = await h.ev(WHEN_FACTS);
        await h.shot("cdp-shots/run-start-choice-1-row.png");
        const labels = (f?.buttons ?? []).map((b) => b.label);
        rec(
            "1. + Run with a goal: the When row, on screen, holds Run now, After run… and Queue, one of them pressed, with a reason line under it",
            opened &&
                picked &&
                f?.row === true &&
                f.seen.row &&
                f.seen.buttons.length === 3 &&
                f.seen.buttons.every(Boolean) &&
                f.seen.reason === true &&
                JSON.stringify(labels) === JSON.stringify(["Run now", "After run…", "Queue"]) &&
                f.buttons.filter((b) => b.pressed).length === 1 &&
                settled &&
                f.reason.length > 0 &&
                f.reason[0] !== "",
            JSON.stringify(f)
        );
        if (!opened || f?.row !== true) return steps;

        // 2. After run… with no run ticked: Start waits and says why
        await h.ev(pressWhen("after"));
        await waitFor(h, `${LAUNCHER}?.querySelector('[data-when-choice="after"]')?.getAttribute('aria-pressed') === 'true'`, 3000);
        await nap(300);
        f = await h.ev(WHEN_FACTS);
        await h.shot("cdp-shots/run-start-choice-2-after-empty.png");
        rec(
            "2. After run… picked with nothing ticked: its list is on screen, Start is disabled and the footer says Pick a run to wait for",
            pressed(f, "after") &&
                f.seen.list === true &&
                f.primary?.disabled === true &&
                f.footer === "Pick a run to wait for" &&
                f.primary.label === "Queue after…",
            JSON.stringify(f)
        );

        // 3. Queue: Start reads Queue and is ready
        await h.ev(pressWhen("queue"));
        await waitFor(h, `${LAUNCHER}?.querySelector('[data-when-choice="queue"]')?.getAttribute('aria-pressed') === 'true'`, 3000);
        await nap(300);
        f = await h.ev(WHEN_FACTS);
        await h.shot("cdp-shots/run-start-choice-3-queue.png");
        rec(
            "3. Queue picked: Start reads Queue and is enabled",
            pressed(f, "queue") && f.seen.row && f.primary?.label === "Queue" && f.primary.disabled === false,
            JSON.stringify(f)
        );

        // 4. Start: the dialog closes and the queue holds the entry, waiting, with no run made for it
        await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-primary]')?.click()`);
        const closed = await waitFor(h, `${LAUNCHER} == null`, 10000);
        let entry = null;
        for (let waited = 0; waited < 10000 && entry == null; waited += 250) {
            entry = (await kit.rqList(h)).find((e) => e.data?.goal === GOAL) ?? null;
            if (entry == null) await nap(250);
        }
        if (entry != null) ctx.entryIds.push(entry.id);
        const rowShown =
            entry != null &&
            (await waitFor(h, `document.querySelector('[data-run-queue-row="${entry.id}"]') != null`, 10000));
        // no run in the project's channel: the entry waits for room, it did not start. -1 when the channel is not found
        const channelId = await ownChannel(h, ctx);
        const made = channelId === "" ? -1 : ((await h.rpc("getchannelruns", { channelid: channelId }))?.runs ?? []).length;
        await h.shot("cdp-shots/run-start-choice-4-queued.png");
        rec(
            "4. Start pressed on Queue: the dialog closes, the queue holds the entry waiting, its row is on the Agent tree and no run was made",
            closed && entry?.state === "waiting" && rowShown && made === 0,
            JSON.stringify({ closed, entry: entry && { id: entry.id, state: entry.state, after: entry.after }, rowShown, made })
        );
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
        // an open dialog first, so the next scenario starts on a clean page
        await attempt("close the dialog", () =>
            h.ev(`${LAUNCHER}?.querySelector('button[aria-label="Close"]')?.click()`)
        );
        // the entries go before the cap is restored, so restoring it cannot start one
        await attempt("remove the entries", async () => {
            for (const e of await kit.rqList(h)) {
                if (ctx.entryIds.includes(e.id) || e.data?.goal === GOAL) await h.rpc("runqueueremove", { id: e.id });
            }
        });
        if (ctx.fillChannelId) {
            await attempt("cancel the run that fills the cap", async () => {
                const runs = (await h.rpc("getchannelruns", { channelid: ctx.fillChannelId }))?.runs ?? [];
                for (const run of runs) {
                    if (run.status !== "cancelled") {
                        await h.rpc("cancelrun", { channelid: ctx.fillChannelId, runid: run.id });
                    }
                }
            });
            await attempt("delete its channel", () => h.rpc("deletechannel", { channelid: ctx.fillChannelId }));
        }
        if ("prevMax" in ctx) {
            await attempt("restore runs:maxactive", () => h.rpc("setconfig", { "runs:maxactive": ctx.prevMax }));
        }
        if ("prevRecent" in ctx) {
            await attempt("restore the recent projects", () =>
                h.ev(
                    ctx.prevRecent == null
                        ? `localStorage.removeItem(${JSON.stringify(RECENT_KEY)})`
                        : `localStorage.setItem(${JSON.stringify(RECENT_KEY)}, ${JSON.stringify(ctx.prevRecent)})`
                )
            );
        }
        if (ctx.project) {
            // deleteproject leaves the channel createproject made, so that goes too
            await attempt("remove the project", async () => {
                await h.rpc("deleteproject", { name: ctx.project });
                const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.dir))) {
                    await h.rpc("deletechannel", { channelid: c.oid });
                }
            });
        }
        for (const dir of ctx.dirs) {
            await attempt("remove the temp dir", () => rmSync(dir, { recursive: true, force: true }));
        }
        if (failures.length > 0) throw new Error(failures.join("; "));
    },
});

export default function (kit) {
    return [runStartChoiceScenario(kit)];
}
