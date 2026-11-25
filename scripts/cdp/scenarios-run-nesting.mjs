// run-nesting: a quick run started from an agent's session (`wsh runs start` in its tab, which the run records as
// origintabid) nests under that agent in the Agent tree, and a run its agent started nests one level further
// (docs/superpowers/specs/2026-11-25-kael-sync-agent-tree-nesting-design.md; frontend/app/view/agents/agenttreemodel.ts
// buildAgentTree, runlineage.ts lineageOf, agenttree.tsx Guides). Ported from the fork's agent-workers scenario.
//
// No agent runs: the roster goes in the page's dev mock roster, and each fixture agent's run is a run object seeded in the
// page's object cache only (wavesrv never sees it), which is all lineageOf reads. The agents carry no block, so no terminal
// resyncs, and none is focused.
//   1. the tree draws the starter, its run one level in, that run's own run two levels in, then a run started from the
//      cockpit and one whose origin tab is gone, both at the top; each nested row on one guide per level, 28px and 45px in
//   2. the starter's tab gone from the roster: its run is a top-level row again, and the run under it is one level in
//
// DOM contract: the tree is [data-agent-tree], an agent's row [data-agent-row="<tab>"] with [data-tree-depth].
// kit is scenarios.mjs's RT_KIT (polishWaitFor).

import * as AC from "./agent-page-fixtures.mjs";

const NAME = "run-nesting";
const WAIT_MS = 8_000;
const PROJECT = "verify-run-nesting";
const IDS = {
    starter: "fx-nest-starter",
    run: "fx-nest-run",
    grand: "fx-nest-grand",
    cockpit: "fx-nest-cockpit",
    orphan: "fx-nest-orphan",
};
const ORDER = [IDS.starter, IDS.run, IDS.grand, IDS.cockpit, IDS.orphan];
const runOf = (id) => `fx-run-${id.slice("fx-nest-".length)}`;

// the roster in the order the tree must not simply copy: the nested runs come after the top-level rows they go under
const roster = (now, without = []) =>
    [
        { id: IDS.starter, name: "Plan the release", task: "Plan the release", state: "idle", idleSince: now - 120_000 },
        { id: IDS.cockpit, name: "Cockpit quick run", task: "Tidy the docs", state: "working", activeMs: 90_000, runId: runOf(IDS.cockpit) },
        { id: IDS.run, name: "Started by the planner", task: "Write the notes", state: "working", activeMs: 60_000, runId: runOf(IDS.run) },
        { id: IDS.orphan, name: "Origin gone", task: "Check links", state: "idle", idleSince: now - 30_000, runId: runOf(IDS.orphan) },
        { id: IDS.grand, name: "Started by the notes run", task: "Count the words", state: "working", activeMs: 20_000, runId: runOf(IDS.grand) },
    ]
        .filter((a) => !without.includes(a.id))
        .map((a) => ({ agent: "claude", model: "sonnet 4.5", project: PROJECT, ...a }));

// each fixture agent's run: what lineageOf reads its origin from
const runs = (now) =>
    [
        [IDS.run, IDS.starter],
        [IDS.grand, IDS.run],
        [IDS.cockpit, ""],
        [IDS.orphan, "fx-nest-closed-tab"],
    ].map(([agent, origin]) => ({
        otype: "run",
        oid: runOf(agent),
        version: 1,
        goal: "fixture quick run",
        mode: "quick",
        status: "running",
        phases: [],
        createdts: now,
        ...(origin ? { origintabid: origin } : {}),
    }));

const seedRuns = (h, objs) =>
    AC.agentPage(
        h,
        `for (const obj of ${JSON.stringify(objs)}) {
            const oref = WOS.makeORef(obj.otype, obj.oid);
            await WOS.loadAndPinWaveObject(oref).catch(() => null);
            WOS.setObjectValue(obj);
        }
        return true;`
    );

// the fixture's rows in the tree's order: each one's level, left padding and the guides drawn on it
const READ_ROWS = `(() => {
    const ids = ${JSON.stringify(ORDER)};
    return [...document.querySelectorAll("[data-agent-tree] [data-agent-row]")]
        .filter((el) => ids.includes(el.getAttribute("data-agent-row")))
        .map((el) => ({
            id: el.getAttribute("data-agent-row"),
            depth: Number(el.getAttribute("data-tree-depth")),
            pad: Math.round(parseFloat(getComputedStyle(el).paddingLeft)),
            guides: [...el.children].filter((c) => c.tagName === "SPAN" && getComputedStyle(c).position === "absolute" && c.getBoundingClientRect().width <= 1.5).length,
        }));
})()`;

const shape = (rows) => (rows ?? []).map((r) => `${r.id}@${r.depth}`).join(" ");

export default function (kit) {
    const { polishWaitFor } = kit;
    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { now: Date.now() };
                try {
                    await h.goto("agent");
                    await seedRuns(h, runs(ctx.now));
                    await AC.setRoster(h, roster(ctx.now));
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },

            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec("0. the fixture roster and its runs", false, ctx.arrangeError);
                    return steps;
                }
                const wantFull = `${IDS.starter}@0 ${IDS.run}@1 ${IDS.grand}@2 ${IDS.cockpit}@0 ${IDS.orphan}@0`;
                const up = await polishWaitFor(h, `${READ_ROWS}.map((r) => r.id + "@" + r.depth).join(" ") === ${JSON.stringify(wantFull)}`, WAIT_MS);
                const full = await h.ev(READ_ROWS);
                await h.shot(`cdp-shots/${NAME}-1-nested.png`);
                const at = (rows, id) => rows?.find((r) => r.id === id);
                rec(
                    "1. a quick run sits under the agent whose session started it, a run of its agent one level further, each on one guide per level (28px, 45px in); a run from the cockpit and one whose origin tab is gone stay top-level rows",
                    up &&
                        shape(full) === wantFull &&
                        at(full, IDS.run)?.pad === 28 &&
                        at(full, IDS.run)?.guides === 1 &&
                        at(full, IDS.grand)?.pad === 45 &&
                        at(full, IDS.grand)?.guides === 2 &&
                        at(full, IDS.cockpit)?.guides === 0 &&
                        at(full, IDS.orphan)?.guides === 0,
                    { up, rows: full }
                );

                await AC.setRoster(h, roster(ctx.now, [IDS.starter]));
                const wantGone = `${IDS.cockpit}@0 ${IDS.run}@0 ${IDS.grand}@1 ${IDS.orphan}@0`;
                const moved = await polishWaitFor(h, `${READ_ROWS}.map((r) => r.id + "@" + r.depth).join(" ") === ${JSON.stringify(wantGone)}`, WAIT_MS);
                const gone = await h.ev(READ_ROWS);
                await h.shot(`cdp-shots/${NAME}-2-origin-gone.png`);
                rec(
                    "2. with the starter's tab gone, its run is a top-level row in roster order and the run under it is one level in",
                    moved && shape(gone) === wantGone && at(gone, IDS.run)?.guides === 0 && at(gone, IDS.grand)?.pad === 28,
                    { moved, rows: gone }
                );
                return steps;
            },

            async teardown(h) {
                // the seeded runs stay in the page's cache under ids nothing else names; the roster goes back
                await AC.restoreRoster(h);
                await h.goto("cockpit");
            },
        },
    ];
}
