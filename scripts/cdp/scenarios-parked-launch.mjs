// parked-launch: a New agent launch parked for later while the machine is busy (parkedmodel.ts, parkedstore.ts). The
// machine is made to read busy through the DEV seam window.__arcMachineBusy, so nothing loads it; a mock roster of one
// agent makes the Agent surface draw its tree. The dialog opens on Home (No folder) with claude and a task.
// Steps: the busy dialog (Park for later, Start anyway, the busy line), Enter parks it (the workspace's launch:parked
// and a Parked row in Home's folder), a screenshot path added to the entry shows on the row and comes back as a
// thumbnail when the row opens the dialog, the calm dialog (Launch agent, Park), Add to initiative… opens the picker,
// and Remove with its Undo. Teardown puts the workspace's own parked list, the roster and the machine reading back.
// kit is unused: this scenario imports nothing from scenarios.mjs.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentPage, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";

const NAME = "parked-launch";
const PROJECT = "fx-parked";
const TASK = "Tighten the Agent tree's row spacing\nrows sit 2px too close under the project folder";
const TITLE = "Tighten the Agent tree's row spacing";
const BUSY = "Memory pressure is high";
const IMAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/logos/arcterm.png");
const WAIT_MS = 8_000;

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(h, expr, ms = WAIT_MS) {
    let last = null;
    for (let waited = 0; waited < ms; waited += 150) {
        last = await h.ev(expr).catch(() => null);
        if (last) return last;
        await nap(150);
    }
    return last;
}

// the workspace's oid and parked list as the page holds them
const readParked = (h) =>
    agentPage(
        h,
        `const { atoms } = await mod("app/store/global-atoms.ts");
        const ws = globalStore.get(atoms.workspace);
        return { oid: ws?.oid ?? null, parked: ws?.meta?.["launch:parked"] ?? null };`
    );

const writeParked = (h, oid, list) => h.rpc("setmeta", { oref: `workspace:${oid}`, meta: { "launch:parked": list } });

const setBusy = (h, reason) =>
    h.ev(`(() => { window.__arcMachineBusy?.set(${reason === undefined ? "undefined" : JSON.stringify(reason)}); return !!window.__arcMachineBusy; })()`);

// the New dialog on the agent half, claude on Home with TASK in the Task box
const openDialog = (h) =>
    agentPage(
        h,
        `const L = await mod("app/view/agents/launcherstore.ts");
        const model = agentsModel();
        L.clearLauncherDraft();
        L.openLauncher(model, "agent");
        L.pickLauncherRuntime("claude");
        L.pickLauncherProject("~", globalStore.get(L.launcherProjectAtom));
        globalStore.set(L.launcherTaskAtom, ${JSON.stringify(TASK)});
        return true;`
    );

const closeDialog = (h) =>
    agentPage(
        h,
        `const L = await mod("app/view/agents/launcherstore.ts");
        L.clearLauncherDraft();
        L.closeLauncher(agentsModel());
        return true;`
    );

// the dialog's footer and busy line as drawn
const readDialog = (h) =>
    h.ev(`(() => {
        const root = document.querySelector('[data-launcher]');
        if (!root) return null;
        const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const primary = root.querySelector('[data-launcher-primary]');
        return {
            primary: primary?.dataset.launcherPrimary ?? null,
            primaryText: flat(primary),
            anyway: !!root.querySelector('[data-launcher-anyway]'),
            park: !!root.querySelector('[data-launcher-park]'),
            warn: flat(root.querySelector('[data-ram-warn]')) || null,
            task: root.querySelector('textarea')?.value ?? null,
            images: [...root.querySelectorAll('[data-task-image]')].map((el) => ({
                state: el.dataset.taskImageState,
                blob: (el.querySelector('img')?.getAttribute('src') ?? '').startsWith('blob:'),
            })),
        };
    })()`);

// the Parked rows as drawn
const readRows = (h) =>
    h.ev(`(() => [...document.querySelectorAll('[data-parked-row]')].map((r) => ({
        id: r.dataset.parkedRow,
        title: (r.querySelector('.truncate')?.textContent ?? '').trim(),
        meta: (r.querySelector('[data-parked-meta]')?.textContent ?? '').trim(),
    })))()`);

export default function () {
    const parkedLaunch = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = {};
            try {
                const { oid, parked } = await readParked(h);
                if (oid == null) throw new Error("no workspace in the page");
                ctx.oid = oid;
                ctx.prevParked = parked;
                await writeParked(h, oid, null);
                await setRoster(h, [
                    {
                        id: "fx-parked-agent",
                        name: "parked fixture agent",
                        project: PROJECT,
                        task: "keeps the tree drawn",
                        state: "idle",
                        agent: "claude",
                        model: "opus",
                    },
                ]);
                ctx.roster = true;
                if (!(await setBusy(h, BUSY))) throw new Error("no window.__arcMachineBusy: not a DEV build");
                ctx.busy = true;
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null) {
                rec("0. the workspace, the mock roster and the busy seam are ready", false, ctx.arrangeError);
                return steps;
            }
            await h.goto("agent");
            await waitFor(h, `!!document.querySelector('[data-agent-active-rows]')`);

            // 1. busy: Enter reads Park for later, Start anyway sits beside it, the busy line names both keys
            await openDialog(h);
            const busy = await waitFor(
                h,
                `(() => { const d = document.querySelector('[data-launcher-primary]'); return d?.dataset.launcherPrimary === 'park' && !!document.querySelector('[data-ram-warn]'); })()`
            ).then(() => readDialog(h));
            await nap(250);
            await h.shot("cdp-shots/parked-launch-busy.png");
            rec(
                "1. busy machine: Park for later is Enter, Start anyway beside it, the busy line says why and how",
                busy?.primary === "park" &&
                    busy.primaryText.startsWith("Park for later") &&
                    busy.anyway &&
                    !busy.park &&
                    (busy.warn ?? "").startsWith(`${BUSY}:`) &&
                    (busy.warn ?? "").includes("parks this agent for later"),
                JSON.stringify(busy)
            );

            // 2. Enter parks it: the dialog closes, the workspace holds one entry, and a Parked row sits in Home's folder
            await h.ev(`document.querySelector('[data-launcher-primary]')?.click()`);
            await waitFor(h, `!document.querySelector('[data-launcher]') && !!document.querySelector('[data-parked-row]')`);
            const afterPark = await readParked(h);
            const entry = afterPark.parked?.[0] ?? null;
            const rows = await readRows(h);
            await nap(250);
            await h.shot("cdp-shots/parked-launch-row.png");
            rec(
                "2. parked: one entry on Home with the task and the reason, and its row reads Parked · claude",
                afterPark.parked?.length === 1 &&
                    entry?.project === "Home" &&
                    entry?.runtime === "claude" &&
                    entry?.task === TASK &&
                    entry?.reason === BUSY &&
                    rows?.length === 1 &&
                    rows[0].title === TITLE &&
                    rows[0].meta.startsWith("Parked · claude ·"),
                JSON.stringify({ parked: afterPark.parked, rows })
            );
            if (entry == null) {
                return steps;
            }

            // 3. a screenshot on the entry: the row counts it, and opening the row fills the dialog with the task and
            //    the image read back from disk
            await writeParked(h, ctx.oid, [{ ...entry, images: [IMAGE] }]);
            await waitFor(h, `(document.querySelector('[data-parked-meta]')?.textContent ?? '').includes('1 image')`);
            // the hover's buttons float over the row's end: the meta line keeps its full width, hovered or not
            const metaFits = await h.ev(
                `(() => { const m = document.querySelector('[data-parked-meta]'); return !!m && m.scrollWidth <= m.clientWidth; })()`
            );
            const box = await h.ev(
                `(() => { const r = document.querySelector('[data-parked-row]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`
            );
            if (box != null) {
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
                await nap(250);
            }
            await h.shot("cdp-shots/parked-launch-hover.png");
            const hoverShown = await h.ev(
                `getComputedStyle(document.querySelector('[data-parked-act="open"]').parentElement).opacity === '1'`
            );
            rec(
                "3a. the row's meta reads in full (Parked · claude · 1 image · age), and hovering shows Open, Add to initiative and Remove",
                metaFits === true && hoverShown === true,
                JSON.stringify({ metaFits, hoverShown })
            );
            await h.ev(`document.querySelector('[data-parked-row]')?.click()`);
            await waitFor(
                h,
                `(() => { const i = document.querySelector('[data-launcher] [data-task-image] img'); return !!i && (i.getAttribute('src') ?? '').startsWith('blob:'); })()`
            );
            const reopened = await readDialog(h);
            await nap(250);
            await h.shot("cdp-shots/parked-launch-reopen.png");
            rec(
                "3. the row opens the dialog filled: the task, the image thumbnail loaded, still Park while busy",
                reopened?.task === TASK &&
                    reopened.images.length === 1 &&
                    reopened.images[0].state === "ready" &&
                    reopened.images[0].blob &&
                    reopened.primary === "park",
                JSON.stringify(reopened)
            );

            // 4. calm: Enter launches again, and Park waits in the footer for a park by hand
            await setBusy(h, null);
            const calm = await waitFor(
                h,
                `document.querySelector('[data-launcher-primary]')?.dataset.launcherPrimary === 'start'`
            ).then(() => readDialog(h));
            await nap(250);
            await h.shot("cdp-shots/parked-launch-calm.png");
            rec(
                "4. calm machine: Launch agent is Enter, Park beside it, no Start anyway and no busy line",
                calm?.primary === "start" &&
                    calm.primaryText.startsWith("Launch agent") &&
                    calm.park &&
                    !calm.anyway &&
                    !(calm.warn ?? "").includes("parks this agent"),
                JSON.stringify(calm)
            );
            await closeDialog(h);
            await setBusy(h, BUSY);

            // 5. Add to initiative… opens the initiative picker over the tree; Escape closes it and the row stays
            await waitFor(h, `!document.querySelector('[data-launcher]')`);
            await h.ev(`document.querySelector('[data-parked-act="initiative"]')?.click()`);
            const picker = await waitFor(h, `!!document.querySelector('[data-initiative-picker]')`);
            await nap(300);
            await h.shot("cdp-shots/parked-launch-initiative.png");
            const pickerLaunched = await h.ev(`!!document.querySelector('[data-launcher]')`);
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            const pickerGone = await waitFor(h, `!document.querySelector('[data-initiative-picker]')`);
            rec(
                "5. Add to initiative… opens the picker (not the dialog), and Escape closes it with the row kept",
                !!picker && !pickerLaunched && !!pickerGone && (await readRows(h))?.length === 1,
                JSON.stringify({ picker, pickerLaunched, pickerGone })
            );

            // 6. Remove drops the row with an Undo toast, and Undo puts it back
            await h.ev(`document.querySelector('[data-parked-act="remove"]')?.click()`);
            const removed = await waitFor(
                h,
                `!document.querySelector('[data-parked-row]') && !!document.querySelector('[data-notification-action]')`
            );
            await h.ev(`document.querySelector('[data-notification-action]')?.click()`);
            const restored = await waitFor(h, `!!document.querySelector('[data-parked-row]')`);
            const afterUndo = await readParked(h);
            rec(
                "6. Remove drops the row with an Undo, and Undo brings the entry back",
                !!removed && !!restored && afterUndo.parked?.length === 1 && afterUndo.parked[0].id === entry.id,
                JSON.stringify({ removed, restored, parked: afterUndo.parked })
            );
            return steps;
        },
        async teardown(h, ctx) {
            await closeDialog(h).catch(() => {});
            if (ctx.busy) {
                await setBusy(h, undefined).catch(() => {});
            }
            if (ctx.oid != null) {
                await writeParked(h, ctx.oid, ctx.prevParked ?? null).catch(() => {});
            }
            if (ctx.roster) {
                await restoreRoster(h).catch(() => {});
            }
            await h.goto("cockpit");
        },
    };

    return [parkedLaunch];
}
