// kael1113-dag: the DAG modal's scenario for the 2026-11-13 Kael sync (docs/superpowers/plans/
// 2026-11-13-kael-sync-engine-runviews-rpc.md, Task 13). Task 1 created it empty and registered it in scenarios.mjs. kits is
// scenarios.mjs's KAEL_KITS plus `run`: RUN_KIT, the dag seeding helpers; the fixture-run helpers are kits.jarvis's.
//
// One scenario, `kael1113-dag-modal`, on one deferred orchestrator run with a chain of three noop tasks (t-1 dispatches a
// real worker that does nothing; t-2 and t-3 wait on it). Each step seeds the stored dag into the state it is about
// (`seedDag`: a seeded dag proves how the cockpit draws that state, not what the engine does with it), opens the DAG modal
// from the run sheet's dock, and reads the page:
//   1. an ended dag states what is true: a failed and a skipped task read "run cancelled", the chip says failed rather than
//      need you, and the failed task's peek offers no Retry, Skip or Escalate (7477f4a27)
//   2. a dag in plan review reads plan review, not running: its pill, its waiting cards and its stage line (7477f4a27)
//   3. a blocked dag: the header's Adjust opens the run settings dials and a second press closes them (aca599018). Not asserted:
//      a Cancel on a blocked dag, which c3d092f4f added and our dagCancellable test forbids (named under Differs from plan)
//   4. a stage line too long for the header wraps inside it, and the graph refits to a narrower window with no node clipped
//      (072d27962); the size is restored
//   5. a route picker open above the modal owns Tab, Escape and the arrows: the graph's selection and the modal stay
//      (8c544f72c, 7c9976ed1, 92b5b04fa)
//   6. a timeline hover does not outlive the rail: closing the modal under the pointer leaves no card hovered on reopening
//      (c4f14e608)
// Every key is a real CDP key event and every click a real mouse event, so the page's own listeners are what run.

const WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const NARROW = { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false };

const MODAL = `document.querySelector("[data-dag-modal-kind]")`;
const OPEN_DAG = `document.querySelector("[data-run-sheet] [data-run-sheet-open-dag]")`;
const PANE = `${MODAL}?.querySelector(".react-flow")`;
const node = (id) => `${MODAL}?.querySelector('[data-dag-node="${id}"]')`;
// a card's fact without the separator the card draws before it
const fact = (id) =>
    `(${node(id)}?.querySelector("[data-dag-node-fact]")?.textContent ?? "").replace(/\\s+/g, " ").replace(/^\\s*·\\s*/, "").trim()`;
const word = (id) => `(${node(id)}?.querySelector("[data-dag-node-word]")?.textContent ?? "").replace(/\\s+/g, " ").trim()`;
const PILL = `(${MODAL}?.querySelector("[data-dag-status-pill]")?.textContent ?? "").replace(/\\s+/g, " ").trim().toLowerCase()`;
const CHIP_TITLES = `[...(${MODAL}?.querySelectorAll("button[title^='Select the next task that is']") ?? [])].map((b) => b.title.slice("Select the next task that is ".length))`;
// the graph's selection: aria-pressed mirrors a card's selected border
const PRESSED = `[...(${MODAL}?.querySelectorAll("[data-dag-node][aria-pressed='true']") ?? [])].map((n) => n.getAttribute("data-dag-node"))`;
const PEEK = (id) => `${MODAL}?.querySelector('[data-dag-task-peek="${id}"]')`;
// the popover's wrapper is always mounted; its filter box is there only while the picker is open
const PICKER_POPOVER = `document.querySelector('[data-owns-arrows] input[aria-label="Filter models"]')`;
const HOVERED = `[...(${MODAL}?.querySelectorAll("[data-dag-node-hovered]") ?? [])].map((n) => n.getAttribute("data-dag-node"))`;

// every card against the graph pane: which sit outside it
const GEOMETRY = `(() => {
    const paneEl = ${PANE};
    if (!paneEl) return null;
    const pane = paneEl.getBoundingClientRect();
    const cards = [...${MODAL}.querySelectorAll("[data-dag-node]")].map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.getAttribute("data-dag-node"), l: r.left, r: r.right, t: r.top, b: r.bottom };
    });
    const clipped = cards
        .filter((c) => c.l < pane.left - 1 || c.r > pane.right + 1 || c.t < pane.top - 1 || c.b > pane.bottom + 1)
        .map((c) => c.id);
    return { pane: { w: Math.round(pane.width), h: Math.round(pane.height) }, cards: cards.length, clipped };
})()`;

// the stage line: its entries on how many lines, how tall each is, and whether it spills sideways
const STAGE_LINE = `(() => {
    const first = ${MODAL}?.querySelector("[data-dag-stage-entry]");
    const bar = first?.parentElement;
    if (!bar) return null;
    const box = bar.getBoundingClientRect();
    const kids = [...bar.children].map((el) => el.getBoundingClientRect());
    return {
        entries: bar.querySelectorAll("[data-dag-stage-entry], [data-plan-reviewer]").length,
        lines: new Set(kids.map((r) => Math.round(r.top))).size,
        tallest: Math.round(Math.max(...kids.map((r) => r.height))),
        spills: bar.scrollWidth > bar.clientWidth + 1 || kids.some((r) => r.right > box.right + 1 || r.left < box.left - 1),
    };
})()`;

const LENSES = ["full", "second", "spec", "order", "tests", "final", "followup"];
// what a task's peek offers on a live dag: the dag actions an ended dag must not
const ACTION_WORDS = /^(Retry|Skip|Escalate|Approve|Send back|Merge|Resolve)/i;

// a real key through CDP: the page's listeners hear it as they hear a person's
async function press(h, key, { code = key, vk = 0 } = {}) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
    }
}
const ESCAPE = { code: "Escape", vk: 27 };
const TAB = { code: "Tab", vk: 9 };
const ARROW_DOWN = { code: "ArrowDown", vk: 40 };

// the centre of an element as a point (not scrolled into view: a graph card sits in a transformed pane that a scroll would shift)
const centre = (expr) => `(() => {
    const el = ${expr};
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
})()`;

async function moveTo(h, x, y) {
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

async function click(h, expr) {
    const at = await h.ev(centre(expr));
    if (at == null) return false;
    await moveTo(h, at.x, at.y);
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    return true;
}

export default function (kits) {
    const { arrangeSheetDagRun, teardownFixtureRun, waitForDispatch, RUN_SHEET_POLISH_TASKS, polishWaitFor, polishNap } =
        kits.jarvis;
    const { seedDag } = kits.run;

    // what a seed must hold: the dag's status and plan review, and every task's state but t-1's, which the engine owns
    const fingerprint = (dag) =>
        JSON.stringify([
            dag?.status,
            dag?.planreview?.state ?? null,
            dag?.planreview?.reviewers?.length ?? 0,
            (dag?.tasks ?? []).map((t) => [t.id, t.id === "t-1" ? "" : t.state]),
        ]);

    // Seeds the stored dag: `edit` maps one task, `top` the dag's own fields. The engine's tick holds the dag lock for
    // seconds while it spawns t-1's worker and then writes the dag it read first, over a seed that landed meanwhile, so
    // the seed is read back after a pause and written again until it has stayed.
    async function seed(h, ctx, top, edit) {
        const want = fingerprint({
            status: top.status,
            planreview: top.planreview,
            tasks: ["t-1", "t-2", "t-3"].map((id) => ({ id, state: edit[id]?.state ?? "" })),
        });
        for (let round = 0; round < 4; round++) {
            await seedDag(
                h,
                ctx,
                (dag) => ({ ...dag, ...top, tasks: dag.tasks.map((t) => ({ ...t, ...(edit[t.id] ?? {}) })) }),
                fingerprint
            );
            await polishNap(2500);
            const stored = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
            if (fingerprint(stored) === want) return;
        }
        throw new Error(`the dag did not keep its seed: want ${want}`);
    }

    // opens the run's DAG from the sheet's dock; true once the graph shows its cards
    async function openDag(h) {
        const dock = await polishWaitFor(h, `!!${OPEN_DAG}`, 15000);
        if (dock) await h.ev(`${OPEN_DAG}.click()`);
        return dock && (await polishWaitFor(h, `${MODAL}?.querySelectorAll("[data-dag-node]").length >= 4`, 10000));
    }

    // Escape until the modal is gone: a selection takes the first press
    async function closeDag(h) {
        for (let i = 0; i < 4 && (await h.ev(`!!${MODAL}`)); i++) {
            await press(h, "Escape", ESCAPE);
            await polishNap(400);
        }
        return polishWaitFor(h, `!${MODAL}`, 3000);
    }

    const scenario = {
        name: "kael1113-dag-modal",
        surface: "jarvis",
        async arrange(h) {
            await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            const ctx = await arrangeSheetDagRun(h, "kael1113-dag-modal", RUN_SHEET_POLISH_TASKS);
            if (ctx.arrangeError != null) return ctx;
            try {
                await waitForDispatch(h, ctx, "t-1");
                ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group.id;
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: JSON.stringify(detail) });
            rec(
                "0. the run's sheet opened and t-1 dispatched its worker",
                ctx.arrangeError == null && ctx.opened?.ok === true && ctx.dispatched === true,
                ctx.arrangeError ?? { opened: ctx.opened, dispatched: ctx.dispatched }
            );
            if (ctx.arrangeError != null) return steps;

            // 1. ended: t-2 failed, t-3 skipped, the dag cancelled
            await seed(h, ctx, { status: "cancelled", planreview: null }, { "t-2": { state: "failed", attempts: 1 }, "t-3": { state: "skipped" } });
            const opened1 = await openDag(h);
            const ended = opened1
                ? {
                      t2: await h.ev(fact("t-2")),
                      t3: await h.ev(fact("t-3")),
                      t2Word: await h.ev(word("t-2")),
                      pill: await h.ev(PILL),
                      chips: await h.ev(CHIP_TITLES),
                  }
                : null;
            await h.shot("cdp-shots/kael1113-dag-modal-1-ended.png");
            let peeked = false;
            let offered = null;
            if (opened1) {
                await h.ev(`${node("t-2")}?.click()`);
                peeked = await polishWaitFor(h, `!!${PEEK("t-2")}`, 5000);
                offered = await h.ev(
                    `[...(${PEEK("t-2")}?.querySelectorAll("button") ?? [])].map((b) => b.textContent.trim()).filter((t) => ${ACTION_WORDS}.test(t))`
                );
            }
            rec(
                "1. an ended dag: its failed and skipped cards read run cancelled, the chip says failed not need you, and the failed task's peek offers no action",
                opened1 &&
                    ended?.t2 === "run cancelled" &&
                    ended.t3 === "run cancelled" &&
                    ended.t2Word.includes("failed") &&
                    ended.pill === "cancelled" &&
                    ended.chips.includes("failed") &&
                    !ended.chips.includes("need you") &&
                    peeked &&
                    offered.length === 0,
                { opened1, ended, peeked, offered }
            );
            await closeDag(h);

            // 2. plan review: the review failed, so the plan holds dispatch
            await seed(
                h,
                ctx,
                {
                    status: "plan-review",
                    planreview: { state: "failed", round: 1, findings: "verify kael1113: the plan is held", reviewers: [{ lens: "full", state: "failed" }] },
                },
                { "t-2": { state: "pending", attempts: 0 }, "t-3": { state: "pending", attempts: 0 } }
            );
            const opened2 = await openDag(h);
            const review = opened2
                ? {
                      pill: await h.ev(PILL),
                      t2: await h.ev(fact("t-2")),
                      t3: await h.ev(fact("t-3")),
                      stage: await h.ev(`(${MODAL}?.querySelector('[data-dag-stage-entry="planreview"]')?.textContent ?? "").replace(/\\s+/g, " ").trim()`),
                  }
                : null;
            await h.shot("cdp-shots/kael1113-dag-modal-2-plan-review.png");
            rec(
                "2. a dag in plan review reads plan review, not running: its pill, its waiting cards and its stage line",
                opened2 &&
                    review?.pill.includes("plan review") &&
                    !review.pill.includes("running") &&
                    review.t2 === "waits on plan review" &&
                    review.t3 === "waits on plan review" &&
                    review.stage.startsWith("plan review"),
                { opened2, review }
            );
            await closeDag(h);

            // 3. blocked: Adjust opens the run settings under the header, and a second press puts them away
            await seed(h, ctx, { status: "blocked", planreview: null }, { "t-2": { state: "failed", attempts: 1 }, "t-3": { state: "pending", attempts: 0 } });
            const opened3 = await openDag(h);
            const DIALS = `${MODAL}?.querySelector('[data-jarvis-brief-sheet-config="editable"] input[type="number"]')`;
            const ADJUST = `${MODAL}?.querySelector("[data-dag-adjust]")`;
            let adjust = null;
            if (opened3) {
                const shut = !(await h.ev(`!!${DIALS}`));
                const label = await h.ev(`${ADJUST}?.textContent?.trim() ?? null`);
                await h.ev(`${ADJUST}?.click()`);
                const shown = await polishWaitFor(h, `!!${DIALS}`, 8000);
                const labelOpen = await h.ev(`${ADJUST}?.textContent?.trim() ?? null`);
                await h.shot("cdp-shots/kael1113-dag-modal-3-adjust.png");
                await h.ev(`${ADJUST}?.click()`);
                const gone = await polishWaitFor(h, `!${DIALS}`, 5000);
                adjust = { pill: await h.ev(PILL), shut, label, shown, labelOpen, gone };
            }
            rec(
                "3. a blocked dag: the header's Adjust opens the run settings dials under it, and a second press puts them away",
                opened3 && adjust?.pill === "blocked" && adjust.shut && adjust.label === "Adjust" && adjust.shown && adjust.labelOpen === "Done" && adjust.gone,
                { opened3, adjust }
            );
            await closeDag(h);

            // 4. a long stage line, then a narrower window
            await seed(
                h,
                ctx,
                {
                    status: "plan-review",
                    planreview: { state: "failed", round: 1, findings: "verify kael1113: wrap", reviewers: LENSES.map((lens) => ({ lens, state: "passed" })) },
                },
                { "t-2": { state: "pending", attempts: 0 }, "t-3": { state: "pending", attempts: 0 } }
            );
            const opened4 = await openDag(h);
            let resized = null;
            if (opened4) {
                await polishNap(1500);
                const wide = { geometry: await h.ev(GEOMETRY), line: await h.ev(STAGE_LINE) };
                await h.cdp("Emulation.setDeviceMetricsOverride", NARROW);
                await polishNap(2000);
                const narrow = { geometry: await h.ev(GEOMETRY), line: await h.ev(STAGE_LINE) };
                await h.shot("cdp-shots/kael1113-dag-modal-4-narrow.png");
                await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
                await polishNap(1500);
                resized = { wide, narrow, restored: await h.ev(GEOMETRY) };
            }
            rec(
                "4. a long stage line wraps inside the header, and the graph refits to the narrower window with no card clipped",
                opened4 &&
                    resized?.wide.geometry?.clipped.length === 0 &&
                    resized.narrow.geometry?.pane.w < resized.wide.geometry.pane.w &&
                    resized.narrow.geometry.clipped.length === 0 &&
                    resized.narrow.geometry.cards >= 4 &&
                    resized.narrow.line?.entries >= LENSES.length + 1 &&
                    resized.narrow.line.lines >= 2 &&
                    resized.narrow.line.tallest <= 26 &&
                    !resized.narrow.line.spills &&
                    resized.restored?.clipped.length === 0,
                { opened4, resized }
            );
            await closeDag(h);

            // 5. a route picker above the modal: Escalate on the failed t-2
            await seed(h, ctx, { status: "blocked", planreview: null }, { "t-2": { state: "failed", attempts: 1 }, "t-3": { state: "pending", attempts: 0 } });
            const opened5 = await openDag(h);
            const picker = { opened5 };
            if (opened5) {
                await click(h, node("t-2"));
                picker.peek = await polishWaitFor(h, `!!${PEEK("t-2")}`, 5000);
                picker.escalate = await click(
                    h,
                    `[...(${PEEK("t-2")}?.querySelectorAll("button") ?? [])].find((b) => /^Escalate/i.test(b.textContent.trim()))`
                );
                picker.trigger = await polishWaitFor(h, `!!${PEEK("t-2")}?.querySelector('[data-testid="route-picker"]')`, 5000);
                await click(h, `${PEEK("t-2")}?.querySelector('[data-testid="route-picker"]')`);
                picker.open = await polishWaitFor(h, `!!${PICKER_POPOVER}`, 5000);
                // the filter box has focus as the popover opens; if it does not, take it
                await h.ev(`(() => { const i = document.querySelector('[data-owns-arrows] input[aria-label="Filter models"]'); if (i && !document.activeElement?.closest("[data-owns-arrows]")) i.focus(); })()`);
                const inPopover = `!!document.activeElement?.closest("[data-owns-arrows]")`;
                picker.focused = await h.ev(inPopover);
                // Tab walks the popover's own controls: the modal's focus trap would jump it to Close
                await press(h, "Tab", TAB);
                picker.tabStays = await h.ev(inPopover);
                picker.tabAt = await h.ev(`document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 30) ?? null`);
                // ArrowDown from the filter box walks the rows; the graph's arrows must not select a neighbouring task
                await h.ev(`document.querySelector('[data-owns-arrows] input[aria-label="Filter models"]')?.focus()`);
                await press(h, "ArrowDown", ARROW_DOWN);
                await press(h, "ArrowDown", ARROW_DOWN);
                picker.rowFocused = await h.ev(`document.activeElement?.getAttribute("data-testid")?.startsWith("route-option") ?? false`);
                picker.selection = await h.ev(PRESSED);
                picker.peekStill = await h.ev(`!!${PEEK("t-2")}`);
                await h.shot("cdp-shots/kael1113-dag-modal-5-picker.png");
                // Escape closes the popover, not the modal and not the selection under it
                await press(h, "Escape", ESCAPE);
                picker.closed = await polishWaitFor(h, `!${PICKER_POPOVER}`, 5000);
                picker.modalStays = await h.ev(`!!${MODAL}`);
                picker.selectionAfter = await h.ev(PRESSED);
            }
            rec(
                "5. a route picker above the modal owns Tab, Escape and the arrows: the focus stays in it, the selection stays on t-2, and Escape closes only the picker",
                opened5 &&
                    picker.peek &&
                    picker.escalate &&
                    picker.open &&
                    picker.focused &&
                    picker.tabStays &&
                    picker.rowFocused &&
                    picker.selection?.length === 1 &&
                    picker.selection[0] === "t-2" &&
                    picker.peekStill &&
                    picker.closed &&
                    picker.modalStays &&
                    picker.selectionAfter?.length === 1 &&
                    picker.selectionAfter[0] === "t-2",
                picker
            );
            await closeDag(h);

            // 6. a hover on a timeline row, then the rail unmounts under the pointer
            const opened6 = await openDag(h);
            const hover = { opened6 };
            if (opened6) {
                await polishNap(1000);
                const rows = await h.ev(`${MODAL}?.querySelectorAll("[data-timeline-row]").length ?? 0`);
                hover.rows = rows;
                for (let i = 0; i < Math.min(rows, 14) && !(hover.lit?.length > 0); i++) {
                    const at = await h.ev(centre(`${MODAL}?.querySelectorAll("[data-timeline-row]")[${i}]`));
                    if (at == null) continue;
                    await moveTo(h, at.x, at.y);
                    await polishNap(250);
                    hover.lit = await h.ev(HOVERED);
                    hover.row = i;
                }
                await h.shot("cdp-shots/kael1113-dag-modal-6-hover.png");
                // closing with the keyboard leaves the pointer where it was: no pointer-leave reaches the unmounted row
                hover.closed = await closeDag(h);
                await moveTo(h, 4, 4);
                await polishNap(300);
                hover.reopened = await openDag(h);
                await polishNap(800);
                hover.after = await h.ev(HOVERED);
                await h.shot("cdp-shots/kael1113-dag-modal-6-reopened.png");
            }
            rec(
                "6. a card the timeline hover lit is not left hovered when the modal closes under the pointer and opens again",
                opened6 && hover.lit?.length > 0 && hover.closed && hover.reopened && hover.after?.length === 0,
                hover
            );
            await closeDag(h);
            return steps;
        },
        async teardown(h, ctx) {
            await teardownFixtureRun(h, ctx, "kael1113-dag-modal", {
                what: "clear the viewport override",
                fn: () => h.cdp("Emulation.clearDeviceMetricsOverride", {}),
            });
        },
    };
    return [scenario];
}
