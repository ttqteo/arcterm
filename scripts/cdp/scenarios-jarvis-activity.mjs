// jarvis-brief-activity: Activity in the Brief's side column, live and earlier runs and councils under one filter
// (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md decision 5, plan docs/superpowers/plans/2026-11-05-jarvis-revamp.md
// Task 5). kit is scenarios.mjs's JARVIS_KIT.
//
// Seeds a live run (a real orchestrator run held in planning), a second run it then cancels, a running council and two
// ended ones (the done and the failed fixtures). The cancelled run and the two ended councils are the Earlier lines: a
// cancelled run reaches the Brief through jarvisstate.Ended (fix round, plan
// docs/superpowers/plans/2026-11-05-jarvis-revamp-round.md Task 1), and its line opens the run sheet on it.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arrangeCouncilProject, teardownCouncilProject, writeCouncil } from "./council/fixtures.mjs";

const RUN_LABEL = "activity-run";
const RUN_GOAL = `verify ${RUN_LABEL}: do nothing`;
const RUN_LEAD = "activity lead";
const ENDED_LABEL = "activity-ended";
const ENDED_GOAL = `verify ${ENDED_LABEL}: do nothing`;
const TITLES = {
    live: "Activity live council",
    done: "Activity done council",
    failed: "Activity failed council",
};

const ACTIVITY = `document.querySelector('[data-jarvis-activity]')`;

// what Activity draws: its cards and Earlier lines (source and text), the tabs' counts, and Shipped's rows
const READ_ACTIVITY = `(() => {
    const region = ${ACTIVITY};
    if (!region) return null;
    const item = (el) => ({ source: el.dataset.jarvisActivityCard ?? el.dataset.jarvisActivityLine, id: el.dataset.jarvisActivityId, text: el.innerText });
    const shipped = document.querySelector('[data-jarvis-brief-region="shipped"]');
    return {
        cards: [...region.querySelectorAll('[data-jarvis-activity-card]')].map(item),
        lines: [...region.querySelectorAll('[data-jarvis-activity-line]')].map(item),
        tabs: Object.fromEntries([...region.querySelectorAll('[data-jarvis-activity-tab]')].map((t) => [t.dataset.jarvisActivityTab, t.getAttribute('aria-pressed') === 'true'])),
        shippedRows: shipped ? shipped.querySelectorAll('[data-jarvis-brief-row="shipped"]').length : null,
        shippedEmpty: shipped ? !!shipped.querySelector('[data-jarvis-brief-empty="shipped"]') : null,
    };
})()`;

const has = (items, text) => items.some((i) => i.text.includes(text));

export default function (kit) {
    const { arrangeFixtureRun, teardownFixtureRun, briefReload, briefViewport, polishWaitFor, briefNap } = kit;

    const tab = (h, f) => h.ev(`document.querySelector('[data-jarvis-activity-tab="${f}"]')?.click()`);

    // a run that ended without shipping: created held, as arrangeFixtureRun creates one, then cancelled. Its own
    // channel, and no roster fixture (arrangeFixtureRun's roster names the live run's lead), so teardownFixtureRun
    // takes it apart like the live one.
    async function arrangeEndedRun(h, ctx) {
        const wslist = await h.rpc("workspacelist", null);
        const ch = await h.rpc("createchannel", { name: `verify-${ENDED_LABEL}`, projectpath: ctx.cwd });
        ctx.channelId = ch.oid;
        const created = await h.rpc(
            "createrun",
            {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: ENDED_GOAL,
                runtime: "claude",
                mode: "orchestrator",
                deferstart: true,
            },
            { timeout: 30000 }
        );
        ctx.runId = created.run.id;
        ctx.landPath = created.run.landpath;
        await h.rpc("cancelrun", { channelid: ctx.channelId, runid: ctx.runId });
    }

    const jarvisBriefActivity = {
        name: "jarvis-brief-activity",
        surface: "jarvis",
        async arrange(h) {
            const ctx = {
                run: { cwd: mkdtempSync(join(tmpdir(), "verify-activity-")) },
                ended: { cwd: mkdtempSync(join(tmpdir(), "verify-activity-ended-")) },
                council: null,
            };
            // a throw past this point still returns ctx, so teardown removes whatever was already made
            try {
                ctx.council = await arrangeCouncilProject(h, kit);
                // the council sheet's head names the question, Activity the feature: one title for both
                const titled = (title) => ({
                    edit: (c) => {
                        c.feature = title;
                        c.question = title;
                    },
                });
                ctx.councilIds = {
                    live: writeCouncil(ctx.council, "round1", titled(TITLES.live)),
                    done: writeCouncil(ctx.council, "done", titled(TITLES.done)),
                    failed: writeCouncil(ctx.council, "failed", titled(TITLES.failed)),
                };
                await arrangeFixtureRun(h, ctx.run, RUN_LABEL, RUN_LEAD);
                await arrangeEndedRun(h, ctx.ended);
                await briefViewport(h, 1600, 1000);
                // the roster fixture is read once at boot, and the councils are read on the first list
                await briefReload(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null) {
                rec("arrange", false, ctx.arrangeError);
                return steps;
            }

            // activity: the live run and the running council are cards; the cancelled run and the done and failed
            // councils Earlier lines
            const seeded = `(() => {
                const r = ${ACTIVITY};
                if (!r) return false;
                const t = r.innerText;
                return ${JSON.stringify([RUN_GOAL, ENDED_GOAL, ...Object.values(TITLES)])}.every((s) => t.includes(s));
            })()`;
            await polishWaitFor(h, seeded, 20000);
            await h.ev(`${ACTIVITY}?.scrollIntoView({ block: "start" })`);
            await briefNap(300);
            await h.shot("cdp-shots/jarvis-brief-activity.png");
            const all = await h.ev(READ_ACTIVITY);
            rec(
                "activity: the live run and the running council are live cards, the cancelled run and the done and failed councils Earlier lines",
                all != null &&
                    all.cards.some((c) => c.source === "run" && c.text.includes(RUN_GOAL)) &&
                    all.cards.some((c) => c.source === "council" && c.text.includes(TITLES.live)) &&
                    all.lines.some((l) => l.source === "run" && l.text.includes(ENDED_GOAL)) &&
                    all.lines.some((l) => l.source === "council" && l.text.includes(TITLES.done)) &&
                    all.lines.some((l) => l.source === "council" && l.text.includes(TITLES.failed)) &&
                    !has(all.lines, RUN_GOAL) &&
                    !has(all.cards, ENDED_GOAL) &&
                    !has(all.cards, TITLES.done) &&
                    !has(all.cards, TITLES.failed),
                JSON.stringify(all)
            );
            if (all == null) return steps;

            // open ended run: the cancelled run's Earlier line opens the run sheet on that run
            await h.ev(`[...(${ACTIVITY}?.querySelectorAll('[data-jarvis-activity-line="run"]') ?? [])]
                .find((l) => l.innerText.includes(${JSON.stringify(ENDED_GOAL)}))?.click()`);
            const runSheet = `document.querySelector('[data-jarvis-brief-sheet] [data-run-id]')?.getAttribute('data-run-id') === ${JSON.stringify(ctx.ended.runId)}`;
            const runOpened = await polishWaitFor(h, runSheet, 10000);
            await briefNap(300);
            await h.shot("cdp-shots/jarvis-brief-activity-ended-run.png");
            rec(
                "open ended run: clicking the cancelled run's Earlier line opens the run sheet on it",
                runOpened,
                JSON.stringify({
                    runId: ctx.ended.runId,
                    sheetRunId: await h.ev(
                        `document.querySelector('[data-jarvis-brief-sheet] [data-run-id]')?.getAttribute('data-run-id') ?? null`
                    ),
                })
            );
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await polishWaitFor(h, `!document.querySelector('[data-jarvis-brief-sheet]')`, 5000);

            // councils tab: only councils show, and Shipped narrows to its no-match sentence
            await tab(h, "councils");
            await polishWaitFor(h, `!${ACTIVITY}?.querySelector('[data-jarvis-activity-card="run"], [data-jarvis-activity-card="agent"], [data-jarvis-activity-line="run"]')`, 5000);
            await briefNap(300);
            await h.shot("cdp-shots/jarvis-brief-activity-councils.png");
            const councils = await h.ev(READ_ACTIVITY);
            rec(
                "councils tab: only councils show, and Shipped shows no run",
                councils != null &&
                    councils.tabs.councils === true &&
                    [...councils.cards, ...councils.lines].every((i) => i.source === "council") &&
                    has(councils.cards, TITLES.live) &&
                    has(councils.lines, TITLES.done) &&
                    has(councils.lines, TITLES.failed) &&
                    councils.shippedRows === 0 &&
                    councils.shippedEmpty === true,
                JSON.stringify({ councils, shippedRowsUnderAll: all.shippedRows })
            );

            // open council line: the finished council's line opens the council sheet
            await h.ev(`[...(${ACTIVITY}?.querySelectorAll('[data-jarvis-activity-line="council"]') ?? [])]
                .find((l) => l.innerText.includes(${JSON.stringify(TITLES.done)}))?.click()`);
            const sheet = `(() => {
                const s = document.querySelector('[data-jarvis-brief-sheet="council"]');
                return s != null && s.innerText.includes(${JSON.stringify(TITLES.done)});
            })()`;
            const opened = await polishWaitFor(h, sheet, 10000);
            await h.shot("cdp-shots/jarvis-brief-activity-council-sheet.png");
            rec(
                "open council line: clicking the finished council's line opens its council sheet",
                opened,
                JSON.stringify({
                    councilId: ctx.councilIds.done,
                    councilSheet: await h.ev(`!!document.querySelector('[data-jarvis-brief-sheet="council"]')`),
                    briefSheet: await h.ev(`!!document.querySelector('[data-jarvis-brief-sheet]')`),
                })
            );
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await tab(h, "all");
            return steps;
        },
        async teardown(h, ctx) {
            const errors = [];
            try {
                await teardownFixtureRun(h, ctx.run, "jarvis-brief-activity");
            } catch (e) {
                errors.push(String(e?.message ?? e));
            }
            try {
                await teardownFixtureRun(h, ctx.ended, "jarvis-brief-activity (ended run)");
            } catch (e) {
                errors.push(String(e?.message ?? e));
            }
            if (ctx.council != null) await teardownCouncilProject(h, ctx.council);
            if (errors.length) throw new Error(errors.join("; "));
        },
    };

    return [jarvisBriefActivity];
}
