// parked-launch: an agent arcterm holds while the machine is busy (parkedmodel.ts, parkedstore.ts, heldpane.tsx; canvas
// .superpowers/design/pending-agent). The machine is made to read busy or calm through the DEV seam
// window.__arcMachineBusy, so nothing loads it; a mock roster of one agent in PROJECT makes the Agent surface draw its
// tree, and one initiative in PROJECT is made for the suggestion.
// Steps: the busy New dialog (Launch agent as ever, the hold line, no extra button); Launch agent holds it (the entry,
// the dashed row selected, the held view in the centre); a held agent with a screenshot in PROJECT (the row under the
// mock agent, the hover's buttons, the divider line, the task and its thumbnail, how the machine is now, Add to the
// suggested initiative); the one-click Add (the chunk and its note in the initiative, the held agent gone) and its
// Undo; Remove and its Undo; Start now is only checked to be there, since a click would start a real claude.
// Teardown puts the workspace's own held list, the roster and the machine reading back, and deletes the initiative.
// kit is unused: this scenario imports nothing from scenarios.mjs.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentPage, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";

const NAME = "parked-launch";
const PROJECT = "fx-parked";
const TASK = "Tighten the Agent tree's row spacing\nrows sit 2px too close under the project folder";
const TITLE = "Tighten the Agent tree's row spacing";
const BUSY = "Memory pressure is high";
const INITIATIVE = "Agent tree polish";
const IMAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/logos/arcterm.png");
const SEEDED = "fx-parked-held-0000-4000-8000-000000000001";
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

// the workspace's oid and held list as the page holds them
const readParked = (h) =>
    agentPage(
        h,
        `const { atoms } = await mod("app/store/global-atoms.ts");
        const ws = globalStore.get(atoms.workspace);
        return { oid: ws?.oid ?? null, parked: ws?.meta?.["launch:parked"] ?? null };`
    );

const writeParked = (h, oid, list) => h.rpc("setmeta", { oref: `workspace:${oid}`, meta: { "launch:parked": list } });

const setBusy = (h, reason) =>
    h.ev(
        `(() => { window.__arcMachineBusy?.set(${reason === undefined ? "undefined" : JSON.stringify(reason)}); return !!window.__arcMachineBusy; })()`
    );

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

const flat = `const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();`;

// the dialog's footer and warning line as drawn
const readDialog = (h) =>
    h.ev(`(() => {
        ${flat}
        const root = document.querySelector('[data-launcher]');
        if (!root) return null;
        const primary = root.querySelector('[data-launcher-primary]');
        return {
            primary: primary?.dataset.launcherPrimary ?? null,
            primaryText: flat(primary),
            extra: !!root.querySelector('[data-launcher-anyway], [data-launcher-park]'),
            warn: flat(root.querySelector('[data-ram-warn]')) || null,
        };
    })()`);

// the held rows as drawn
const readRows = (h) =>
    h.ev(`(() => {
        ${flat}
        return [...document.querySelectorAll('[data-parked-row]')].map((r) => ({
            id: r.dataset.parkedRow,
            selected: r.hasAttribute('data-parked-selected'),
            title: flat(r.querySelector('.truncate')),
            meta: flat(r.querySelector('[data-parked-meta]')),
            dashed: getComputedStyle(r).borderStyle === 'dashed',
            // the row right above it, to see it sits under the project's agents
            above: r.parentElement?.previousElementSibling?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 40) ?? null,
        }));
    })()`);

// the held view as drawn
const readPane = (h) =>
    h.ev(`(() => {
        ${flat}
        const pane = document.querySelector('[data-held-pane]');
        if (!pane) return null;
        const now = pane.querySelector('[data-held-now]');
        return {
            id: pane.dataset.heldPane,
            line: flat(pane.querySelector('[data-held-line]')),
            task: flat(pane.querySelector('[data-held-task]')),
            thumbs: [...pane.querySelectorAll('[data-held-task] [data-prompt-images] img')].map((i) => (i.getAttribute('src') ?? '').startsWith('blob:')),
            now: now?.dataset.heldNow ?? null,
            nowText: flat(now),
            add: flat(pane.querySelector('[data-held-act="add"]')),
            start: !!pane.querySelector('[data-held-act="start"]:not([disabled])'),
        };
    })()`);

const effortChunks = async (h, oid) => {
    const rtn = await h.rpc("effortget", { effortoid: oid });
    return (rtn?.effort?.chunks ?? []).map((c) => ({ label: c.label, notes: (c.notes ?? []).map((n) => n.text) }));
};

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
                const made = await h.rpc("effortcreate", {
                    title: INITIATIVE,
                    project: PROJECT,
                    chunks: [{ label: "Row spacing in the project folders" }],
                });
                ctx.effortOid = made?.effortoid ?? null;
                if (ctx.effortOid == null) throw new Error("the initiative was not made");
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
                rec("0. the workspace, the mock roster, the initiative and the busy seam are ready", false, ctx.arrangeError);
                return steps;
            }
            await h.goto("agent");
            await waitFor(h, `!!document.querySelector('[data-agent-active-rows]')`);

            // 1. busy: the dialog is as ever (Launch agent, no extra button); only its warning line says it will hold
            await openDialog(h);
            await waitFor(h, `document.querySelector('[data-launcher-primary]')?.dataset.launcherPrimary === 'hold'`);
            const dialog = await readDialog(h);
            await nap(250);
            await h.shot("cdp-shots/parked-launch-busy.png");
            rec(
                "1. busy machine: Launch agent as ever, no extra button, and the line says arcterm will hold it",
                dialog?.primary === "hold" &&
                    dialog.primaryText.startsWith("Launch agent") &&
                    !dialog.extra &&
                    dialog.warn === `${BUSY}: arcterm will hold this agent until you start it from its row.`,
                JSON.stringify(dialog)
            );

            // 2. Launch agent holds it: the entry keeps what New would start, its dashed row is selected, the centre shows it
            await h.ev(`document.querySelector('[data-launcher-primary]')?.click()`);
            await waitFor(h, `!document.querySelector('[data-launcher]') && !!document.querySelector('[data-held-pane]')`);
            const afterHold = await readParked(h);
            const held = afterHold.parked?.[0] ?? null;
            const rows = await readRows(h);
            const pane = await readPane(h);
            await nap(250);
            await h.shot("cdp-shots/parked-launch-held.png");
            rec(
                "2. held: one entry (Home, its folder, the claude command, the task, the reason), its dashed row selected, the held view in the centre",
                afterHold.parked?.length === 1 &&
                    held?.project === "Home" &&
                    (held?.projectpath ?? "") !== "" &&
                    (held?.command ?? "").includes("claude") &&
                    held?.task === TASK &&
                    held?.reason === BUSY &&
                    rows?.length === 1 &&
                    rows[0].selected &&
                    rows[0].dashed &&
                    rows[0].meta === "held for RAM" &&
                    pane?.id === held?.id,
                JSON.stringify({ parked: afterHold.parked, rows, pane })
            );
            if (held == null) {
                return steps;
            }

            // 3. a held agent with a screenshot in PROJECT: its row right under the project's agent, the hover's buttons
            //    over its end, and in the centre the divider, the task with its thumbnail, the machine now and the
            //    suggested initiative
            // held 3h10m ago: the page's clock ticks behind Date.now(), and a seed at exactly 3h reads 2h before its next tick
            const seeded = { ...held, id: SEEDED, project: PROJECT, images: [IMAGE], ts: Date.now() - 190 * 60_000 };
            await writeParked(h, ctx.oid, [held, seeded]);
            await waitFor(h, `!!document.querySelector('[data-parked-row="${SEEDED}"]')`);
            // the tree's rows slide into place when one comes: measure the row once it has settled
            await nap(700);
            const seededRow = (await readRows(h))?.find((r) => r.id === SEEDED) ?? null;
            const metaFits = await h.ev(
                `(() => { const m = document.querySelector('[data-parked-row="${SEEDED}"] [data-parked-meta]'); return !!m && m.scrollWidth <= m.clientWidth; })()`
            );
            const box = await h.ev(
                `(() => { const r = document.querySelector('[data-parked-row="${SEEDED}"]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`
            );
            if (box != null) {
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
                await nap(250);
            }
            await h.shot("cdp-shots/parked-launch-hover.png");
            const hoverShown = await h.ev(
                `getComputedStyle(document.querySelector('[data-parked-row="${SEEDED}"] [data-parked-act="start"]').parentElement).opacity === '1'`
            );
            rec(
                "3a. its row sits under the project's agent, dashed, reads held for RAM · 1 image in full, and hovering shows Start now and Remove",
                seededRow != null &&
                    seededRow.dashed &&
                    seededRow.meta === "held for RAM · 1 image" &&
                    (seededRow.above ?? "").includes("parked fixture agent") &&
                    metaFits === true &&
                    hoverShown === true,
                JSON.stringify({ seededRow, metaFits, hoverShown })
            );

            await setBusy(h, null);
            await h.ev(`document.querySelector('[data-parked-row="${SEEDED}"]')?.click()`);
            await waitFor(
                h,
                `(() => { const p = document.querySelector('[data-held-pane="${SEEDED}"]'); const i = p?.querySelector('[data-held-task] [data-prompt-images] img'); return !!i && (i.getAttribute('src') ?? '').startsWith('blob:') && p.querySelector('[data-held-act="add"]')?.textContent?.includes(${JSON.stringify(INITIATIVE)}); })()`
            );
            const seen = await readPane(h);
            await nap(300);
            await h.shot("cdp-shots/parked-launch-pane.png");
            rec(
                "3b. the held view: the divider says held 3h ago and why, the task with its thumbnail, memory normal now, Add to the matching initiative, Start now ready",
                seen?.id === SEEDED &&
                    // the parts sit in spans apart, their dots drawn between them, so the text runs them together
                    seen.line.startsWith("Held 3h ago") &&
                    seen.line.includes("memory pressure was high") &&
                    seen.line.endsWith("uses no memory until you start it") &&
                    seen.task.startsWith(TITLE) &&
                    seen.thumbs.length === 1 &&
                    seen.thumbs[0] &&
                    seen.now === "calm" &&
                    seen.nowText.startsWith("Memory normal now ·") &&
                    seen.add === `Add to ${INITIATIVE}` &&
                    seen.start,
                JSON.stringify(seen)
            );

            // 4. busy again: the bar warns before Start now
            await setBusy(h, BUSY);
            const busyNow = await waitFor(
                h,
                `document.querySelector('[data-held-now]')?.dataset.heldNow === 'busy' ? document.querySelector('[data-held-now]').textContent.trim() : null`
            );
            rec(
                "4. busy again: the bar says the pressure is high still, before Start now",
                typeof busyNow === "string" && busyNow.startsWith(`${BUSY} still`),
                JSON.stringify({ busyNow })
            );
            await setBusy(h, null);

            // 5. one click adds it: a chunk named by the task with the rest in its note, the held agent gone, the centre back
            //    to the terminal; Undo takes the chunk out and the held agent back
            await h.ev(`document.querySelector('[data-held-act="add"]')?.click()`);
            await waitFor(
                h,
                `!document.querySelector('[data-parked-row="${SEEDED}"]') && !document.querySelector('[data-held-pane]') && !!document.querySelector('[data-notification-action]')`
            );
            const chunks = await effortChunks(h, ctx.effortOid);
            const added = chunks.find((c) => c.label === TITLE) ?? null;
            const afterAdd = await readParked(h);
            await nap(250);
            await h.shot("cdp-shots/parked-launch-added.png");
            rec(
                "5. Add: the initiative has the chunk with the rest of the task and the screenshot in its note; the held agent and its view are gone",
                added != null &&
                    added.notes.some((n) => n.includes("rows sit 2px too close") && n.includes(IMAGE)) &&
                    !(afterAdd.parked ?? []).some((p) => p.id === SEEDED),
                JSON.stringify({ chunks, parked: afterAdd.parked })
            );
            await h.ev(`document.querySelector('[data-notification-action]')?.click()`);
            await waitFor(h, `!!document.querySelector('[data-parked-row="${SEEDED}"]')`);
            const undoneChunks = await effortChunks(h, ctx.effortOid);
            rec(
                "5b. Undo: the chunk is out of the initiative and the held agent is back",
                !undoneChunks.some((c) => c.label === TITLE) &&
                    ((await readParked(h)).parked ?? []).some((p) => p.id === SEEDED),
                JSON.stringify({ undoneChunks })
            );

            // 6. Remove from the row drops it with an Undo, and Undo brings it back
            await h.ev(`document.querySelector('[data-parked-row="${SEEDED}"] [data-parked-act="remove"]')?.click()`);
            const removed = await waitFor(
                h,
                `!document.querySelector('[data-parked-row="${SEEDED}"]') && !!document.querySelector('[data-notification-action]')`
            );
            await h.ev(
                `[...document.querySelectorAll('[data-notification-action]')].pop()?.click()`
            );
            const restored = await waitFor(h, `!!document.querySelector('[data-parked-row="${SEEDED}"]')`);
            rec(
                "6. Remove drops the row with an Undo, and Undo brings it back",
                !!removed && !!restored,
                JSON.stringify({ removed, restored })
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
            if (ctx.effortOid != null) {
                await h.rpc("effortdelete", { effortoid: ctx.effortOid }).catch(() => {});
            }
            if (ctx.roster) {
                await restoreRoster(h).catch(() => {});
            }
            await h.goto("cockpit");
        },
    };

    return [parkedLaunch];
}
