// Verification scenario manifest. Each entry: { name, surface, arrange(h)->ctx, assert(h,ctx)->steps,
// teardown(h,ctx) }. arrange/assert/teardown run in Node and drive the browser via h (see attach.mjs).
// Asserts are RPC-based (backend state) or DOM-based (h.ev) — NOT jotai atom reads (globalStore is not
// exposed on window). steps are { step, ok, detail }.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_LABEL } from "./attach.mjs";
import { narrationFeed } from "./narrationfeed.mjs";
import { notesWsh, vaultRemote, vaultRoot } from "./notes-wsh.mjs";

// A step this profile cannot run: no scan report to cite, no pi session focused. Neither a pass nor a
// failure — report.mjs tallies it apart and exitCode ignores it. The detail must name what to seed, so a
// skip stays a standing invitation to make the step real rather than a permanent shrug.
const skipStep = (step, detail) => ({ step, skip: true, detail });

const workerOf = (phase) => phase && phase.workerorefs && phase.workerorefs[0];

// a channel's runs are their own rows: the getchannels reply is channel metadata, with no run list
async function channelRuns(h, channelId) {
    return (await h.rpc("getchannelruns", { channelid: channelId }))?.runs ?? [];
}

// --- exemplar: visual + DOM --------------------------------------------------------------------
// Navigate each key surface, screenshot it, and assert (a) the active nav label matches and (b) the
// content region rendered non-empty text — which catches a surface that blanks out on render. No
// arrange needed; a populated-roster visual still relies on the manual inject-live-agents path.
// Channels/Graph/Tasks merged into Jarvis and have no nav button left, so listing one here would make
// h.goto throw before any step is recorded.
const SMOKE_SURFACES = ["cockpit", "jarvis", "radar", "usage", "files", "settings", "code", "setup"];

const surfaceSmoke = {
    name: "surface-smoke",
    surface: "cockpit",
    async arrange() {
        return { cwd: mkdtempSync(join(tmpdir(), "verify-surface-smoke-")) };
    },
    async assert(h, ctx) {
        const steps = [];
        for (const surface of SMOKE_SURFACES) {
            await h.goto(surface);
            const active = await h.activeSurfaceLabel();
            const contentLen = await h.ev(
                `(() => { const n=document.querySelector('nav'); const c=n&&n.nextElementSibling; return c?(c.textContent||'').trim().length:0; })()`
            );
            const expected = SURFACE_LABEL[surface];
            steps.push({
                step: `goto ${surface} -> active nav "${expected}", content non-empty`,
                ok: active === expected && contentLen > 0,
                detail: `active=${active} contentLen=${contentLen}`,
            });
            await h.shot(`cdp-shots/surface-${surface}.png`);
        }
        // B3: a notify (wsh notify / wave_notify) is spoken by the avatar, which is its only voice: the
        // bubble carries the title and leaves after 6s, and no corner toast repeats it underneath.
        await h.goto("cockpit");
        await h.rpc("notify", { title: "cdp surface-smoke", level: "info" });
        await h.ev("new Promise((r) => setTimeout(r, 600))");
        const spoken = await h.ev(`(() => ({
            bubble: document.querySelector('[data-pet-bubble]')?.textContent?.includes('cdp surface-smoke') ?? false,
            toast: !!document.querySelector('[data-notification-toast]'),
        }))()`);
        await h.ev("new Promise((r) => setTimeout(r, 7000))");
        const bubbleGone = await h.ev(`(() => !document.querySelector('[data-pet-bubble]'))()`);
        steps.push({
            step: "wsh notify -> the avatar says it once, with no toast, and the bubble leaves",
            ok: spoken.bubble === true && spoken.toast === false && bubbleGone === true,
            detail: `bubble=${spoken.bubble} toast=${spoken.toast} gone=${bubbleGone}`,
        });
        // B2: the steer input renders on a pi session card (AgentDetailsRail, Agent surface). Dev
        // runs rarely have a live pi session focused, so this is conditional: no steer input -> SKIP
        // (the manual round-trip covers it).
        await h.goto("agent");
        const steerFound = await h.ev(
            `(() => !!document.querySelector('input[placeholder^="Steer this Pi session"]'))()`
        );
        steps.push(
            steerFound
                ? { step: "steer input visible on a pi session card", ok: true, detail: "found on the Agent surface" }
                : skipStep(
                      "steer input visible on a pi session card",
                      "no pi session focused in this run - focus one before reading this as a pass (the manual round-trip covers it)"
                  )
        );
        // last: these swap the live roster for a fixture one, which the steps above must not see
        steps.push(...(await cacheMissNoticeSteps(h, ctx)));
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "surface-smoke");
        await h.goto("cockpit"); // leave the app where a human expects it
    },
};

// A said-once notice from an agent's block (the cache miss notice): the bubble names the agent, nothing is kept
// once it leaves, and a click on it opens the agent. The titles and the long name are the canvas's own
// (.superpowers/design/cache-miss-notice).
const CACHE_MISS_LEAD = "Release checkpoint";
const CACHE_MISS_LONG_LEAD = "Arc Claude mod: usage and ask through Claude Code function hooks";
const CACHE_MISS_TITLE = "Cache miss: 85k tokens re-billed after 12m idle";
const CACHE_MISS_TWO_TITLE = "2 cache misses: 140k tokens re-billed (85k after 12m idle, 55k after a model switch)";
// treeRailRoster's lead block
const CACHE_MISS_OREF = "block:fx-blk-lead";
// the agent line is 12px text: one line is under this, two are over
const ONE_LINE_MAX_PX = 24;
const CACHE_MISS_STEPS = [
    "said-once notify from an agent's block -> the bubble names the agent and its project above the title",
    "the said-once bubble leaves -> no unread marker, and the popup does not list it",
    "a long agent name is cut on one line and the project stays inside the bubble",
    "clicking a said-once bubble opens its agent, with the bubble gone and the popup shut",
];

async function cacheMissNoticeSteps(h, ctx) {
    const steps = [];
    const rec = (step, ok, detail) => steps.push({ step, ok, detail });
    const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
    // the fixture roster is read once at boot
    const reload = async () => {
        await h.ev("location.reload()");
        await polishWaitFor(h, `!!document.querySelector("nav button")`, 30000);
        await polishWaitFor(h, `!!document.querySelector('[aria-label="Jarvis condition"]')`, 10000);
        await settle(1500);
    };
    const say = (title) =>
        h.rpc("notify", { title, level: "warn", oref: CACHE_MISS_OREF, transient: true });
    const BUBBLE = `(() => {
        const bubble = document.querySelector('[data-pet-bubble]');
        const line = bubble?.querySelector('[data-pet-bubble-agent]');
        const name = line?.querySelector('[data-pet-bubble-agent-name]');
        const project = line?.querySelector('[data-pet-bubble-agent-project]');
        if (!bubble || !line || !name || !project) return null;
        const box = bubble.getBoundingClientRect();
        const proj = project.getBoundingClientRect();
        return {
            text: bubble.textContent,
            name: name.textContent,
            project: project.textContent,
            nameCut: name.scrollWidth > name.clientWidth,
            lineHeight: Math.round(line.getBoundingClientRect().height),
            projectInside: proj.width > 0 && proj.left >= box.left && proj.right <= box.right,
        };
    })()`;
    // the roster lands a moment after boot, and the agent line with it
    const bubbleWithAgent = async () => {
        await polishWaitFor(h, `!!document.querySelector('[data-pet-bubble] [data-pet-bubble-agent]')`, 4000);
        return h.ev(BUBBLE);
    };
    const closePopup = async () => {
        await h.ev(`document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click()`);
        return polishWaitFor(h, `!document.querySelector('[data-pet-peek]')`, 3000);
    };
    const openPopup = async () => {
        await h.ev(`document.querySelector('[aria-label="Jarvis condition"]')?.click()`);
        return polishWaitFor(h, `!!document.querySelector('[data-pet-peek]')`, 3000);
    };

    try {
        await arrangeFixtureRun(h, ctx, "surface-smoke", CACHE_MISS_LEAD);
        await reload();
    } catch (e) {
        // no roster agent to send from is a failure of every step, never a skip
        for (const step of CACHE_MISS_STEPS) rec(step, false, `arrange failed: ${e?.message ?? e}`);
        return steps;
    }
    await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
    await h.goto("cockpit");

    // a kept notice first, opened and shut: it clears the marker, and gives step 2 a title the popup does list
    const KEPT = "cdp surface-smoke kept";
    await h.rpc("notify", { title: KEPT, level: "info" });
    await settle(600);
    await openPopup();
    await closePopup();

    await say(CACHE_MISS_TITLE);
    const first = await bubbleWithAgent();
    await settle(400);
    await h.shot("cdp-shots/pet-cache-miss-bubble.png");
    rec(
        CACHE_MISS_STEPS[0],
        first != null &&
            first.name === CACHE_MISS_LEAD &&
            first.project === "waveterm" &&
            first.text.includes(CACHE_MISS_TITLE),
        JSON.stringify(first)
    );

    await settle(7000);
    const left = await h.ev(`(() => ({
        bubbleGone: !document.querySelector('[data-pet-bubble]'),
        unread: !!document.querySelector('[data-pet-unread]'),
    }))()`);
    const opened = await openPopup();
    await h.ev(`(() => {
        const toggle = document.querySelector('[data-pet-updates] button[aria-expanded="false"]');
        toggle?.click();
    })()`);
    await settle(500);
    const listed = await h.ev(`(() => {
        const text = document.querySelector('[data-pet-peek]')?.textContent ?? '';
        return { kept: text.includes(${JSON.stringify(KEPT)}), once: text.includes(${JSON.stringify(CACHE_MISS_TITLE)}) };
    })()`);
    await h.shot("cdp-shots/pet-cache-miss-gone.png");
    rec(
        CACHE_MISS_STEPS[1],
        left.bubbleGone === true && left.unread === false && opened === true && listed.kept === true && listed.once === false,
        JSON.stringify({ ...left, opened, listed })
    );
    await closePopup();

    writeFileSync(
        TREE_RAIL_FIXTURE,
        JSON.stringify(treeRailRoster(ctx.runId, Date.now(), CACHE_MISS_LONG_LEAD), null, 2)
    );
    await reload();
    await h.goto("cockpit");
    await say(CACHE_MISS_TWO_TITLE);
    const long = await bubbleWithAgent();
    await settle(400);
    await h.shot("cdp-shots/pet-cache-miss-long-name.png");
    rec(
        CACHE_MISS_STEPS[2],
        long != null &&
            long.name === CACHE_MISS_LONG_LEAD &&
            long.nameCut === true &&
            long.lineHeight < ONE_LINE_MAX_PX &&
            long.projectInside === true &&
            long.text.includes(CACHE_MISS_TWO_TITLE),
        JSON.stringify(long)
    );

    await say(CACHE_MISS_TITLE);
    await bubbleWithAgent();
    const clicked = await h.ev(`(() => {
        const bubble = document.querySelector('[data-pet-bubble]');
        bubble?.click();
        return !!bubble;
    })()`);
    await polishWaitFor(h, `!document.querySelector('[data-pet-bubble]')`, 3000);
    const after = await h.ev(`(() => ({
        bubbleGone: !document.querySelector('[data-pet-bubble]'),
        popup: !!document.querySelector('[data-pet-peek]'),
        header: document.querySelector('[data-agent-header]')?.textContent ?? '',
    }))()`);
    const active = await h.activeSurfaceLabel();
    let selection;
    try {
        selection = (await h.rpc("uistate", null, UI_ROUTE))?.selection ?? [];
    } catch (e) {
        selection = [`uistate failed: ${e?.message ?? e}`];
    }
    await h.shot("cdp-shots/pet-cache-miss-click.png");
    rec(
        CACHE_MISS_STEPS[3],
        clicked === true &&
            active === SURFACE_LABEL.agent &&
            selection[0] === `agent:${TREE_RAIL_LEAD_ID}` &&
            after.header.includes(CACHE_MISS_LONG_LEAD) &&
            after.bubbleGone === true &&
            after.popup === false,
        JSON.stringify({ clicked, active, selection, ...after })
    );
    return steps;
}

// --- jarvis fleet, the rail's roster and the ambient feeds: RETIRED BY B5 -----------------------
// Their subjects are gone with the retired panes: the per-worker fleet roster and the ambient rail's
// resume/proactive cards were mounted only by the context rail, and the layout scenarios
// (jarvis-collapse-order, jarvis-narrow, jarvis-measure, jarvis-drawer) existed only to assert the
// three-pane allocation. Their capabilities are recorded as deferred in docs/deferred.md rather than
// re-homed, so there is nothing left here to assert against.

// --- jarvis attribution: RETIRED by B5, subject re-homed -------------------------------------------
// This scenario walked the Subjects column's Records group, selected each record until one had an attributed
// run, then corrected it from the run rows on the record's thread ("not this record") and put it back. B5
// deleted all three of those surfaces: the column, the record thread, and the run row inside it.
//
// The CAPABILITY survives: the same detach/restore controls are on the record band that the run's sheet
// renders (recordbandview.tsx EdgeControls, reached through the sheet's body). What is gone is the
// navigation that used to reach them, and this round trip WRITES TO THE USER'S OWN VAULT — so it is not
// something to re-author blind from a deleted-surface diff. Recorded in docs/deferred.md as needing
// re-authoring against the sheet: record peek -> attributed run -> the run's sheet -> its band -> detach,
// restore, and the two lists agreeing at each end.
//
// The two halves of the walk B5 re-homed ARE asserted live, which is why retiring this is a coverage note
// rather than a silent loss: brief-peek step 3 (a record's attributed run opens the run's sheet and
// resolves) and brief-surface step 4 (a queue row opens what it names).

// The design's narrow-window collapse order (JC16). This is the check the previous conformance pass
// could not make: "the thread is still mounted" passed on the broken layout, where the chrome held a
// constant 572px and the Stage went 1270 -> 70px. So rule 5 is asserted as a *width* — the Stage never
// drops below its floor while the order still has a region left to yield — plus the order itself, which
// must run rail-then-Subjects and never the other way round.

// stageRailOpenAtom is persisted, and the surface writes it false the first time it collapses. So any run
// that drove a narrow width - including a previous run of one of these two scenarios - leaves the rail
// already collapsed at 1920, where step 3 then cannot observe it yield. Pin the flag and reload so the
// width scan starts from a known rail, rather than inheriting a preference formed at some other width.

// The width no longer has a vote on the rail (jarvissurface.tsx), so a scenario about the Stage's floor has
// to pin the rail itself: with a 300px rail the user opened, the floor is legitimately unreachable below a
// ~1074px window and that is the design's answer, not a regression.

// --- jarvis-states: RETIRED BY B5 ----------------------------------------------------------------------
// It drove the fixture bar's `data-fixture` row — nine fabricated CONVERSATIONS — and asserted the content
// region rendered non-empty text for each. That mechanism is gone: the conversation fixtures were read by
// `activeConversationAtom`, whose only renderer was the Stage's ConversationView, so B5 deleted the atom and
// the row with them, and the fixture set followed once its own test was the only thing left reading it.
// What this scenario was protecting — that each surface state renders something rather than an empty region
// — is covered against the Brief by its own seam: `data-briefing-fixture` buttons and `brief-surface`'s
// steps 1-3 and 6 walk the seeded, empty and stale states on the live surface.

// --- brief surface: the Brief is the Jarvis surface ----------------------------------------------
// B5 retired the three-pane composition, so the Brief is the whole surface. Against the briefing fixtures
// this walks its four regions, the compact Waiting summary and the queue rows it reveals (each opens what
// it names and carries the design's one action), the j/k cursor, an initiative expanding in place, and
// a blocked chunk opening its initiative's sheet.

const briefSurface = {
    name: "brief-surface",
    surface: "jarvis",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        await h.goto("jarvis");

        // B5 retired the three-pane composition, so the Brief is no longer one of two: the region every
        // other jarvis-* scenario selects against is gone, and nothing may still offer to switch to it.
        const dflt = await h.ev(`(() => ({
            surface: !!document.querySelector('[data-jarvis-region="surface"]'),
            brief: !!document.querySelector('[data-jarvis-region="brief"]'),
            toggles: [...document.querySelectorAll('[data-jarvis-composition]')].length,
        }))()`);
        steps.push({
            step: "1. the Brief is the surface, and nothing still offers to switch composition",
            ok: dflt.brief === true && dflt.surface === false && dflt.toggles === 0,
            detail: JSON.stringify(dflt),
        });

        // the fixture seam bypasses the rpc, so these checks do not race FetchWorkState (which walks
        // transcript scans over ~/.claude and is documented at ~14s warm).
        await h.ev(`document.querySelector('[data-briefing-fixture="normal"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 900))");
        const regions = await h.ev(
            `[...document.querySelectorAll('[data-jarvis-brief-region]')].map((s) => s.dataset.jarvisBriefRegion)`
        );
        steps.push({
            step: "2. the Brief renders its four regions",
            ok: ["waiting", "initiatives", "sessions", "behind"].every((r) => regions.includes(r)),
            detail: JSON.stringify(regions),
        });

        // the disclosure is module state, so normalize it closed before asserting the compact default.
        await h.ev(`document.querySelector('[data-jarvis-brief-attention-summary][aria-expanded="true"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 300))");
        const seeded = await h.ev(`(() => {
            const m = {};
            document.querySelectorAll('[data-jarvis-brief-row]').forEach((r) => {
                const k = r.dataset.jarvisBriefRow;
                m[k] = (m[k] || 0) + 1;
            });
            const summary = document.querySelector('[data-jarvis-brief-attention-summary]');
            return {
                rows: m,
                summary: summary != null,
                open: summary?.getAttribute('aria-expanded') ?? null,
                queueRows: document.querySelectorAll('[data-jarvis-brief-row="queue"]').length,
            };
        })()`);
        steps.push({
            step: "3. attention starts compact while the other seeded regions stay visible",
            ok:
                seeded.summary === true &&
                seeded.open === "false" &&
                seeded.queueRows === 0 &&
                ["initiative", "session", "delta", "shipped"].every((kind) => (seeded.rows[kind] ?? 0) > 0),
            detail: JSON.stringify(seeded),
        });

        // Review reveals the existing actionable rows; the disclosure changes presentation, not where a
        // decision lands. A row opens what it names, and carries the design's one action (Approve, Open,
        // Retry) as its only control.
        await h.ev(`document.querySelector('[data-jarvis-brief-attention-summary]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 300))");
        const q = await h.ev(`(() => {
            const summary = document.querySelector('[data-jarvis-brief-attention-summary]');
            const rows = [...document.querySelectorAll('[data-jarvis-brief-row="queue"]')];
            const controls = (r) => r.querySelectorAll('button, a, input, select, textarea');
            return {
                expanded: summary?.getAttribute('aria-expanded') ?? null,
                rows: rows.length,
                openable: rows.filter((r) => r.classList.contains('cursor-pointer')).length,
                oneAction: rows.filter((r) => controls(r).length === 1 && r.querySelector('[data-jarvis-queue-act]')).length,
            };
        })()`);
        steps.push({
            step: "4. Review reveals queue rows that open what they name, each with its one action",
            ok: q.expanded === "true" && q.rows > 0 && q.openable === q.rows && q.oneAction === q.rows,
            detail: JSON.stringify(q),
        });

        const fleet = await h.ev(
            `(document.querySelector('[data-jarvis-brief-band="fleet"]') || {}).innerText ?? null`
        );
        steps.push({
            step: "5. the header fleet line is derived, not hardcoded",
            ok: typeof fleet === "string" && fleet.trim() !== "" && !/\$2\.41/.test(fleet),
            detail: JSON.stringify(fleet),
        });

        // j/k is the surface's only list navigation once the subjects column is gone (meta spec 4a
        // item 9). The cursor has to cross region boundaries, because the four regions are one column.
        const cursorNow = `(() => {
            const el = document.querySelector('[data-jarvis-brief-cursor="true"]');
            if (!el) return null;
            return {
                row: el.dataset.jarvisBriefRow,
                text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 32),
                n: document.querySelectorAll('[data-jarvis-brief-cursor="true"]').length,
            };
        })()`;
        const press = async (key) => {
            await h.ev(
                `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`
            );
            await h.ev("new Promise((r) => setTimeout(r, 150))");
        };
        // the cursor is module state and outlives a scenario run, so walk it back to the top first:
        // otherwise this step asserts where the PREVIOUS run left it. k clamps at the first row.
        for (let i = 0; i < 15; i++) {
            await press("k");
        }
        const trail = [await h.ev(cursorNow)];
        await press("j");
        trail.push(await h.ev(cursorNow));
        await press("j");
        trail.push(await h.ev(cursorNow));
        await press("k");
        trail.push(await h.ev(cursorNow));
        const text = trail.map((t) => (t == null ? null : t.text));
        steps.push({
            step: "6. j/k walk the cursor down the column and back, one cursor at a time",
            ok:
                trail.every((t) => t != null && t.n === 1) &&
                trail[0].row === "queue" && // the cursor starts on the first row of "Waiting on you"
                text[0] !== text[1] &&
                text[1] !== text[2] &&
                text[3] === text[1], // k returns to the row j came from
            detail: JSON.stringify(trail.map((t) => (t == null ? null : `${t.row}/${t.text}`))),
        });

        // An initiative row is one line, and a click expands its plan in place (cd1a9ce4): it has no sheet to
        // open any more. A row nesting no control of its own is the point: the row is the one affordance.
        // The expansion and the sheet are module state, so whatever a previous run left open is closed first.
        await h.ev(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close detail sheet')?.click()`);
        await h.ev(`document.querySelector('[data-jarvis-brief-row="initiative"][aria-expanded="true"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 300))");
        await h.ev(`document.querySelector('[data-jarvis-brief-row="initiative"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 900))");
        const card = await h.ev(`(() => {
            const rows = [...document.querySelectorAll('[data-jarvis-brief-row="initiative"]')];
            return {
                rows: rows.length,
                buttons: rows.filter((r) => r.getAttribute('role') === 'button').length,
                nested: rows.reduce((n, r) => n + r.querySelectorAll('button, a, input, select, textarea').length, 0),
                expanded: rows[0]?.getAttribute('aria-expanded') ?? null,
                sheet: !!document.querySelector('[data-jarvis-brief-sheet]'),
            };
        })()`);
        steps.push({
            step: "7. an initiative row is one line that expands in place and opens no sheet",
            ok:
                card.rows > 0 &&
                card.buttons === card.rows &&
                card.nested === 0 &&
                card.expanded === "true" &&
                card.sheet === false,
            detail: JSON.stringify(card),
        });
        await h.ev(`document.querySelector('[data-jarvis-brief-row="initiative"][aria-expanded="true"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 300))");

        // The sideways arm into the effort sheet is still the one a blocked chunk takes, and it is still
        // the only arm the fixture can drive end to end: the sheet's own chrome names the record it is
        // showing whether or not the detail behind it resolves.
        await h.ev(`document.querySelector('[data-jarvis-brief-row="queue"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 500))");
        const sheet = await h.ev(`(() => {
            const el = document.querySelector('[data-jarvis-brief-sheet]');
            return {
                face: el ? el.dataset.jarvisBriefSheet : null,
                label: el ? (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 10).toLowerCase() : null,
            };
        })()`);
        steps.push({
            step: "8. a blocked chunk still opens the initiative's own sheet",
            ok: sheet.face === "effort" && sheet.label === "initiative",
            detail: JSON.stringify(sheet),
        });
        await h.ev(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close detail sheet')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 300))");

        // F8: the row states what it is waiting on and what it belongs to, on its one line. The "attention"
        // fixture is the one that carries wire attention items; "normal" has none, so the queue there is only
        // blocked chunks, which carry no attribution by design. The row itself opens (step 4), so its one
        // nested control is its action. A one-line row has no room for cites, so it no longer draws them.
        await h.ev(`document.querySelector('[data-briefing-fixture="attention"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 600))");
        const ctx = await h.ev(`(() => {
            const rows = [...document.querySelectorAll('[data-jarvis-brief-row="queue"]')];
            const txt = (e) => (e.innerText || "").replace(/\\s+/g, " ").trim();
            return {
                rows: rows.length,
                oneAction: rows.filter(
                    (r) => r.querySelectorAll('button, a, input, select, textarea').length === 1 && r.querySelector('[data-jarvis-queue-act]')
                ).length,
                first: rows.length ? txt(rows[0]) : null,
            };
        })()`);
        steps.push({
            step: "9. a queue row names its initiative and why it is waiting, on one line",
            ok:
                ctx.rows >= 3 &&
                ctx.oneAction === ctx.rows &&
                // the effort title is joined on the frontend from the efforts already on the surface,
                // so a raw oid here would mean the join silently failed
                (ctx.first ?? "").includes("Scenario gate clearance \u00b7 Phase 3") &&
                /2 of 4 tasks done/.test(ctx.first ?? ""),
            detail: JSON.stringify(ctx),
        });
        await h.shot("cdp-shots/brief-queue-context.png");

        await h.shot("cdp-shots/brief-surface.png");
        await h.ev(`document.querySelector('[data-jarvis-brief-attention-summary][aria-expanded="true"]')?.click()`);
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// --- brief-peek: a record oref lands in the Brief's peek, not on a Stage that is not there ------
// The only in-app path from the Brief to a record is the palette's Records group (B1's palette
// extension), because nothing on the Brief itself names a record: the Behind-you rows open runs, channels
// and initiatives, and the queue's rows address channels, runs and scan reports. So this drives that path.
// A profile with zero records fails step 2 with that stated in the detail rather than passing vacuously —
// read it as an environment gap, not a regression. A fresh store (the Final stage's) has no run for any record to
// attribute, so the arrange creates one: CreateRun captures a dossier that references it, and records list newest
// first, so that dossier is the first row step 2 opens. Held by deferstart, the run spawns nothing.
const BRIEF_PEEK_GOAL = "verify brief-peek: an attributed run, do nothing";
// the record CreateRun captures for that goal: jarvisdossier names it by the goal's slug
const BRIEF_PEEK_RECORD = "verify-brief-peek-an-attributed-run-do-nothing";

const briefPeek = {
    name: "brief-peek",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-brief-peek-")) };
        try {
            const wslist = await h.rpc("workspacelist", null);
            const ch = await h.rpc("createchannel", { name: "verify-brief-peek", projectpath: ctx.cwd });
            ctx.channelId = ch.oid;
            const created = await h.rpc("createrun", {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: BRIEF_PEEK_GOAL,
                runtime: "claude",
                mode: "quick",
                deferstart: true,
            });
            ctx.runId = created.run.id;
            // the capture names the record by its goal's slug, so a later run finds it already there and its capture
            // fails ("already exists"): attach this run to the record explicitly
            await h.rpc("acceptdossieredge", { dossierid: BRIEF_PEEK_RECORD, runoref: `run:${ctx.runId}` });
            // the Brief reads a boot-primed snapshot, so the RPC-created channel needs a reload
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        // the peek is session state, so a scenario that left one open would fail this one's first step.
        // Start from the state the scenario asserts into existence rather than from whatever ran before.
        await h.goto("jarvis");
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
        );
        await h.ev("new Promise((r) => setTimeout(r, 400))");
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        await h.goto("jarvis");
        await h.ev("new Promise((r) => setTimeout(r, 700))");
        steps.push({
            step: "1. the Brief is showing and no peek is open yet",
            ok:
                (await h.ev(`!!document.querySelector('[data-jarvis-region="brief"]')`)) === true &&
                (await h.ev(`!document.querySelector('[data-jarvis-brief-band="peek"]')`)) === true,
            detail: "",
        });

        // Ctrl+P, not Ctrl+SHIFT+P: `bindings.ts` puts ONE chord on the search. Scenarios that dispatched
        // Ctrl+SHIFT+P matched no binding, so these steps had never once exercised the palette. All shows
        // only Recent and Go to until something is typed, so the Records scope chip is what lists records.
        // The entity sources load lazily on open, hence the settle before the group is looked for.
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }))`
        );
        await h.ev("new Promise((r) => setTimeout(r, 300))");
        await h.ev(`document.querySelector('[data-palette-scope="records"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 900))");
        // the arrange reloaded the page, so the first record's detail is uncached and its skeleton draws before the
        // read lands: too briefly to poll for, so an observer records that it appeared
        await h.ev(`(() => {
            window.__briefPeekSawLoading = false;
            window.__briefPeekLoadingObs?.disconnect();
            window.__briefPeekLoadingObs = new MutationObserver(() => {
                if (document.querySelector('[data-jarvis-brief-band="peek"] [data-jarvis-peek-loading]')) {
                    window.__briefPeekSawLoading = true;
                }
            });
            window.__briefPeekLoadingObs.observe(document.body, { childList: true, subtree: true });
        })()`);
        const picked = await h.ev(`(() => {
            // scoped to the Records group's own container rather than a document-wide button query: the
            // palette renders several groups and the first button on the page is the app bar's search.
            const headers = [...document.querySelectorAll("div")].filter(
                (d) => (d.textContent || "").trim().toLowerCase() === "records"
            );
            if (headers.length === 0) return { ok: false, why: "no Records group in this profile" };
            const group = headers[0].parentElement;
            const row = group ? group.querySelector("button[data-idx]") : null;
            if (!row) return { ok: false, why: "Records group rendered no row" };
            const label = (row.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 40);
            row.click();
            return { ok: true, why: label };
        })()`);
        // the record's detail loads after the peek opens, so wait for its status toggle rather than a fixed sleep
        await h.ev(`(async () => {
            for (let i = 0; i < 40 && !document.querySelector('[data-jarvis-brief-band="peek"] [data-jarvis-peek-status-toggle]'); i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
        })()`);
        const peek = await h.ev(`(() => {
            const band = document.querySelector('[data-jarvis-brief-band="peek"]');
            if (!band) return null;
            const text = (band.innerText || "").replace(/\\s+/g, " ").trim();
            return {
                text: text.slice(0, 400),
                runsBand: /Runs on this record/.test(text),
                // updated, never a freshness word: a record carries no freshness reading
                updated: /updated (just now|.+ ago)|never updated/.test(text),
                fresh: /\\bFresh\\b/.test(text),
                statusToggle: !!band.querySelector("[data-jarvis-peek-status-toggle]"),
            };
        })()`);
        steps.push({
            step: "2. a record row in the palette opens the peek, with its updated stamp and status toggle",
            ok:
                picked.ok === true &&
                peek != null &&
                peek.updated === true &&
                peek.fresh === false &&
                peek.statusToggle === true,
            detail: JSON.stringify({ picked, peek }),
        });
        const loading = await h.ev(`(() => {
            window.__briefPeekLoadingObs?.disconnect();
            window.__briefPeekLoadingObs = undefined;
            return {
                saw: window.__briefPeekSawLoading === true,
                still: document.querySelector('[data-jarvis-brief-band="peek"] [data-jarvis-peek-loading]') != null,
            };
        })()`);
        steps.push({
            step: "2a. the body draws skeleton lines while the record loads",
            ok: loading.saw === true && loading.still === false,
            detail: JSON.stringify(loading),
        });
        // The runs band's content is data-dependent: a record with sessions attributed to it names them, and
        // one without says so instead. The band itself always renders (its rows, or the runs-absent line),
        // so its label is what the step reads, whichever of the two the data calls for.
        steps.push({
            step: "2b. the peek names the record's runs or says it has none",
            ok: peek != null && peek.runsBand === true,
            detail: JSON.stringify({ runsBand: peek?.runsBand ?? null }),
        });

        // The peek's run list is the record's attributed sessions, and clicking one is the path B5 re-homed
        // from the deleted record thread into the detail sheet: record -> attributed run -> the run's own
        // body. Not every record has one, so walk the Records rows the way the retired attribution scenario
        // walked the subjects column, until one opens a peek that lists a session.
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        // the peek lists its runs only after ResolveFocusScope returns, which reads each stored run's commit range
        // (about a second cold), so give the seeded record time before walking on
        let runRowId = await h.ev(`(async () => {
            for (let i = 0; i < 40; i++) {
                const b = document.querySelector('[data-jarvis-peek-run]');
                if (b) return b.dataset.jarvisPeekRun;
                await new Promise((r) => setTimeout(r, 250));
            }
            return null;
        })()`);
        const firstPeek =
            runRowId == null
                ? await h.ev(
                      `(document.querySelector('[data-jarvis-brief-band="peek"]')?.innerText || "").replace(/\\s+/g, " ").slice(0, 300)`
                  )
                : "";
        let tried = 1;
        for (let attempt = 1; attempt < 6 && runRowId == null; attempt++) {
            await h.ev(
                `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
            );
            await settle(300);
            await h.ev(
                `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }))`
            );
            await settle(300);
            await h.ev(`document.querySelector('[data-palette-scope="records"]')?.click()`);
            await settle(500);
            const next = await h.ev(`(() => {
                const headers = [...document.querySelectorAll("div")].filter(
                    (d) => (d.textContent || "").trim().toLowerCase() === "records"
                );
                const group = headers[0]?.parentElement;
                const row = group ? [...group.querySelectorAll("button[data-idx]")][${attempt}] : null;
                if (!row) return false;
                row.click();
                return true;
            })()`);
            if (next !== true) break;
            await settle(900);
            tried += 1;
            runRowId = await h.ev(
                `(() => { const b = document.querySelector('[data-jarvis-peek-run]'); return b ? b.dataset.jarvisPeekRun : null; })()`
            );
        }
        // 2b passes on the band's label alone. The count beside it is the rollup itself: the arranged record has one
        // attributed run, so a rollup that finds the run's owning channel reads "1 channel" and one that does not
        // reads "0 channels".
        const fleetLine = await h.ev(`(() => {
            const text = (document.querySelector('[data-jarvis-brief-band="peek"]')?.innerText || "").replace(/\\s+/g, " ");
            return (text.match(/\\d+ working · \\d+ channels?/) || [null])[0];
        })()`);
        steps.push({
            step: "2c. the fleet line counts the channel that owns the record's run",
            ok: runRowId != null && typeof fleetLine === "string" && /· 1 channel$/.test(fleetLine),
            detail: JSON.stringify({ fleetLine, runRowId }),
        });

        if (runRowId == null) {
            steps.push({
                step: "3. the peek's attributed run opens the run's sheet",
                ok: false,
                detail: `no attributed run in the first ${tried} records — seed one before reading this as a pass${ctx.arrangeError ? `; seeding failed: ${ctx.arrangeError}` : ""}; first peek: ${firstPeek}`,
            });
        } else {
            await h.ev(`document.querySelector('[data-jarvis-peek-run]').click()`);
            await settle(1200);
            // the sheet is keyed by its SUBJECT (a channel), and the settings panel only renders when the
            // body resolved to the run itself rather than the launcher for a channel with nothing to show
            // The channel read is a pin plus the active-channel streams, so it lands in its own time — a
            // single read after a fixed sleep would call a slow channel a hung one. Poll for the sheet to
            // resolve, and only then judge it (the retired record-thread scenario polled for exactly this).
            const readSheet = () =>
                h.ev(`(() => {
                const el = document.querySelector('[data-jarvis-brief-sheet="channel"]');
                return el
                    ? {
                          face: el.dataset.jarvisBriefSheet,
                          state: el.querySelector('[data-jarvis-brief-sheet-state]')?.dataset.jarvisBriefSheetState ?? null,
                          runBody: el.querySelector('[data-jarvis-brief-sheet-face="settings"]') != null,
                          text: (el.innerText || '').slice(0, 80),
                          // the record modal sits above the sheet, so a sheet in the DOM can still be out of sight
                          // behind it: what is at the sheet's centre is what the user sees
                          peekOpen: document.querySelector('[data-jarvis-brief-band="peek"]') != null,
                          onTop: (() => {
                              const r = el.getBoundingClientRect();
                              return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
                          })(),
                      }
                    : null;
            })()`);
            let sheet = null;
            for (let waited = 0; waited <= 12000; waited += 400) {
                sheet = await readSheet();
                if (sheet != null && sheet.state !== "loading") break;
                await settle(400);
            }
            // The invariant is that the sheet RESOLVES: either the run's own body, or an explicit
            // "no longer available" when the channel a historical run names is gone. What it must never do
            // is sit under "Reading this channel…" — this profile's oldest records do name deleted channels,
            // which is exactly the case a skeleton-for-both-states hid.
            steps.push({
                step: "3. the peek's attributed run opens the run's sheet, resolved rather than pending",
                ok:
                    sheet?.face === "channel" &&
                    (sheet?.runBody === true || sheet?.state === "unavailable") &&
                    sheet?.state !== "loading",
                detail: JSON.stringify({ runRowId, sheet }),
            });
            steps.push({
                step: "3b. the peek steps aside, so the run's sheet is in sight rather than behind it",
                ok: sheet?.peekOpen === false && sheet?.onTop === true,
                detail: JSON.stringify({ peekOpen: sheet?.peekOpen ?? null, onTop: sheet?.onTop ?? null }),
            });
            await h.ev(`(() => {
                const b = document.querySelector('[aria-label="Close detail sheet"]');
                if (b) b.click();
                return true;
            })()`);
            await settle(400);
            // the run's open closed the peek, so the status steps reopen the same record: the walk's last row
            await h.ev(
                `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }))`
            );
            await settle(300);
            await h.ev(`document.querySelector('[data-palette-scope="records"]')?.click()`);
            await settle(500);
            await h.ev(`(() => {
                const headers = [...document.querySelectorAll("div")].filter(
                    (d) => (d.textContent || "").trim().toLowerCase() === "records"
                );
                const group = headers[0]?.parentElement;
                group?.querySelectorAll("button[data-idx]")[${tried - 1}]?.click();
            })()`);
            await h.ev(`(async () => {
                for (let i = 0; i < 40 && !document.querySelector('[data-jarvis-brief-band="peek"] [data-jarvis-peek-status-toggle]'); i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
            })()`);
        }

        const BAND = `[data-jarvis-brief-band="peek"]`;
        const readSegments = () =>
            h.ev(`[...document.querySelectorAll('${BAND} [data-jarvis-peek-status-toggle] [data-jarvis-peek-status]')].map((el) => ({
                status: el.dataset.jarvisPeekStatus,
                control: el.tagName === "BUTTON",
                svg: el.querySelector("svg") != null,
                text: (el.textContent || "").trim(),
                pending: el.dataset.jarvisPeekPending ?? null,
            }))`);
        const currentStatus = async () => ((await readSegments()) ?? []).find((s) => !s.control)?.status ?? null;
        const waitCurrent = (status, ms) =>
            polishWaitFor(h, `document.querySelector('${BAND} span[data-jarvis-peek-status="${status}"]') != null`, ms);
        const clickSegment = (status) =>
            h.ev(`(() => {
                const b = document.querySelector('${BAND} button[data-jarvis-peek-status="${status}"]');
                if (b) b.click();
                return b != null;
            })()`);
        const clickConfirm = (label) =>
            h.ev(`(() => {
                const c = document.querySelector('${BAND} [data-jarvis-peek-confirm]');
                const b = c ? [...c.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === ${JSON.stringify(label)}) : null;
                if (b) b.click();
                return b != null;
            })()`);
        const storedStatus = async () =>
            (await h.rpc("getdossier", { dossierid: BRIEF_PEEK_RECORD }).catch((e) => ({ status: `error: ${e?.message ?? e}` })))
                ?.status ?? null;
        const pressEscape = () =>
            h.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);

        // the options are always on screen: no click opens them
        const rows = (await readSegments()) ?? [];
        const current = rows.filter((r) => !r.control);
        steps.push({
            step: "4. the status toggle offers only legal transitions, and the current status is a marked label",
            ok:
                rows.length >= 2 &&
                current.length === 1 &&
                current[0].svg === true &&
                rows.every((r) => ["active", "paused", "completed", "archived"].includes(r.status)) &&
                rows.every((r) => /^[A-Z][a-z]+$/.test(r.text)),
            detail: JSON.stringify(rows),
        });

        // the reopen above went through the palette, whose exit still fades over the modal's entrance
        await settle(600);
        await h.shot("cdp-shots/brief-peek.png");

        // the writes touch only the record this scenario seeded: the walk above can end on a user's record
        const openRecord = await h.ev(`document.querySelector('${BAND} [data-jarvis-peek-record]')?.dataset.jarvisPeekRecord ?? null`);
        if (openRecord !== BRIEF_PEEK_RECORD) {
            const detail = `the open record is ${openRecord}, not the seeded one; status writes skipped`;
            steps.push({ step: "4b. a terminal pick asks inline; Cancel writes nothing", ok: false, detail });
            steps.push({ step: "4c. Yes archives; only reactivating is offered", ok: false, detail });
            steps.push({ step: "4d. reactivating writes at once, no confirm", ok: false, detail });
        } else {
            const before = await currentStatus();
            if (before !== "active") {
                await clickSegment("active");
                await waitCurrent("active", 5000);
            }

            await clickSegment("archived");
            await settle(300);
            const asked = await h.ev(`(() => {
                const c = document.querySelector('${BAND} [data-jarvis-peek-confirm="archived"]');
                return {
                    confirm: c != null,
                    text: c ? (c.innerText || "").replace(/\\s+/g, " ").trim() : null,
                    pending: document.querySelector('${BAND} [data-jarvis-peek-status="archived"]')?.dataset.jarvisPeekPending ?? null,
                };
            })()`);
            await h.shot("cdp-shots/brief-peek-confirm.png");
            const cancelled = await clickConfirm("Cancel");
            await settle(300);
            const afterCancel = {
                confirmGone: await h.ev(`document.querySelector('${BAND} [data-jarvis-peek-confirm]') == null`),
                current: await currentStatus(),
                stored: await storedStatus(),
            };
            steps.push({
                step: "4b. a terminal pick asks inline; Cancel writes nothing",
                ok:
                    asked.confirm === true &&
                    (asked.text ?? "").includes("Mark this record archived?") &&
                    asked.pending === "archived" &&
                    cancelled === true &&
                    afterCancel.confirmGone === true &&
                    afterCancel.current === "active" &&
                    afterCancel.stored === "active",
                detail: JSON.stringify({ before, asked, cancelled, afterCancel }),
            });

            await clickSegment("archived");
            await settle(300);
            const confirmed = await clickConfirm("Yes, archived");
            const archived = await waitCurrent("archived", 5000);
            const archivedRows = (await readSegments()) ?? [];
            steps.push({
                step: "4c. Yes archives; only reactivating is offered",
                ok:
                    confirmed === true &&
                    archived === true &&
                    JSON.stringify(archivedRows.map((r) => [r.status, r.control])) ===
                        JSON.stringify([
                            ["active", true],
                            ["archived", false],
                        ]),
                detail: JSON.stringify({ confirmed, archived, archivedRows }),
            });
            await h.shot("cdp-shots/brief-peek-archived.png");

            // a confirm can come and go between two polls, so an observer records whether one ever appeared
            await h.ev(`(() => {
                window.__briefPeekSawConfirm = false;
                window.__briefPeekConfirmObs?.disconnect();
                window.__briefPeekConfirmObs = new MutationObserver(() => {
                    if (document.querySelector('${BAND} [data-jarvis-peek-confirm]')) window.__briefPeekSawConfirm = true;
                });
                window.__briefPeekConfirmObs.observe(document.body, { childList: true, subtree: true });
            })()`);
            const reactivated = (await clickSegment("active")) && (await waitCurrent("active", 5000));
            const sawConfirm = await h.ev(`(() => {
                window.__briefPeekConfirmObs?.disconnect();
                window.__briefPeekConfirmObs = undefined;
                return window.__briefPeekSawConfirm === true || document.querySelector('${BAND} [data-jarvis-peek-confirm]') != null;
            })()`);
            const storedAfter = await storedStatus();
            steps.push({
                step: "4d. reactivating writes at once, no confirm",
                ok: reactivated === true && sawConfirm === false && storedAfter === "active",
                detail: JSON.stringify({ reactivated, sawConfirm, stored: storedAfter }),
            });
        }

        await pressEscape();
        await h.ev("new Promise((r) => setTimeout(r, 400))");
        steps.push({
            step: "5. Escape closes the peek and leaves the Brief behind it",
            ok:
                (await h.ev(`!document.querySelector('[data-jarvis-brief-band="peek"]')`)) === true &&
                (await h.ev(`!!document.querySelector('[data-jarvis-region="brief"]')`)) === true,
            detail: "",
        });

        // the avatar popup's record item mounts the same body, without a close of its own
        const ITEM = `[data-pet-peek-item="record"]`;
        const peekHook = await polishWaitFor(h, `typeof window.__peekAddress === 'function'`, 5000);
        if (peekHook) await h.ev(`window.__peekAddress(${JSON.stringify("task:" + BRIEF_PEEK_RECORD)})`);
        const popupReady = peekHook && (await polishWaitFor(h, `document.querySelector('${ITEM} [data-jarvis-peek-status-toggle]') != null`, 6000));
        const popupRuns = popupReady && (await polishWaitFor(h, `document.querySelector('${ITEM} [data-jarvis-peek-run]') != null`, 10000));
        const popup = await h.ev(`(() => {
            const body = document.querySelector('${ITEM} [data-jarvis-peek-record]');
            return body
                ? { record: body.dataset.jarvisPeekRecord, close: body.querySelector('[aria-label="Close"]') != null }
                : null;
        })()`);
        await h.shot("cdp-shots/brief-peek-popup.png");
        await h.ev(`document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click()`);
        const popupClosed = await polishWaitFor(h, `!document.querySelector('[data-pet-peek-item]')`, 3000);
        steps.push({
            step: "6. the avatar popup's record item draws the same body",
            ok:
                popupReady === true &&
                popupRuns === true &&
                popup?.record === BRIEF_PEEK_RECORD &&
                popup?.close === false &&
                popupClosed === true,
            detail: JSON.stringify({ peekHook, popupReady, popupRuns, popup, popupClosed }),
        });

        const recordHook = await polishWaitFor(h, `typeof window.__recordPeekFor === 'function'`, 5000);
        if (recordHook) await h.ev(`window.__recordPeekFor('verify-brief-peek-no-such-record')`);
        const errored = recordHook && (await polishWaitFor(h, `document.querySelector('${BAND} [data-jarvis-peek-error]') != null`, 6000));
        const failedRead = await h.ev(`(() => {
            const el = document.querySelector('${BAND} [data-jarvis-peek-error]');
            return {
                text: el ? (el.innerText || "").trim().slice(0, 200) : null,
                loading: document.querySelector('${BAND} [data-jarvis-peek-loading]') != null,
            };
        })()`);
        await h.shot("cdp-shots/brief-peek-error.png");
        await pressEscape();
        const errorClosed = await polishWaitFor(h, `!document.querySelector('${BAND}')`, 3000);
        steps.push({
            step: "7. a record that cannot be read says so instead of loading forever",
            ok:
                errored === true &&
                (failedRead.text ?? "").startsWith("Could not read this record") &&
                failedRead.loading === false &&
                errorClosed === true,
            detail: JSON.stringify({ recordHook, errored, failedRead, errorClosed }),
        });

        // a real read lands too quickly to photograph, so a held one on a made-up id keeps the skeleton up
        if (recordHook) await h.ev(`window.__recordPeekFor('verify-brief-peek-loading', { hold: true })`);
        await settle(300);
        const held = await h.ev(`({
            loading: document.querySelector('${BAND} [data-jarvis-peek-loading]') != null,
            error: document.querySelector('${BAND} [data-jarvis-peek-error]') != null,
        })`);
        await h.shot("cdp-shots/brief-peek-loading.png");
        await pressEscape();
        const heldClosed = await polishWaitFor(h, `!document.querySelector('${BAND}')`, 3000);
        steps.push({
            step: "7b. a record still loading holds its skeleton, not an error",
            ok: recordHook === true && held.loading === true && held.error === false && heldClosed === true,
            detail: JSON.stringify({ held, heldClosed }),
        });

        // a record with no objective, no decisions and no runs: no RPC can make one, so the detail is seeded
        const EMPTY_ID = "verify-brief-peek-empty";
        const emptyDetail = {
            id: EMPTY_ID,
            ticket: "",
            objective: "",
            acceptance: [],
            confidence: "",
            status: "active",
            created: 0,
            updated: 0,
            state: "",
            blockers: [],
            refs: [],
            notes: "",
            decisions: [],
        };
        if (recordHook) await h.ev(`window.__recordPeekFor(${JSON.stringify(EMPTY_ID)}, { detail: ${JSON.stringify(emptyDetail)} })`);
        const emptyReady =
            recordHook && (await polishWaitFor(h, `document.querySelector('${BAND} [data-jarvis-peek-status-toggle]') != null`, 6000));
        const empty = await h.ev(`(() => {
            const band = document.querySelector('${BAND}');
            if (!band) return null;
            const title = band.querySelector("[data-jarvis-peek-title]");
            const body = band.querySelector("[data-jarvis-peek-body]");
            const probe = document.createElement("span");
            probe.className = "text-muted";
            band.appendChild(probe);
            const muted = getComputedStyle(probe).color;
            probe.remove();
            return {
                title: title ? (title.textContent || "").trim() : null,
                titleFont: title ? getComputedStyle(title).fontFamily : null,
                body: body ? (body.textContent || "").trim() : null,
                bodyColor: body ? getComputedStyle(body).color : null,
                muted,
                text: (band.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 400),
            };
        })()`);
        steps.push({
            step: "8. a record with nothing yet titles itself by its id and says what it lacks",
            ok:
                emptyReady === true &&
                empty != null &&
                empty.title === EMPTY_ID &&
                /mono/i.test(empty.titleFont ?? "") &&
                empty.body === "This record states no objective yet." &&
                empty.bodyColor === empty.muted &&
                empty.text.includes("No session has ever been attributed to this record.") &&
                empty.text.includes("never updated") &&
                empty.text.includes("no decisions yet"),
            detail: JSON.stringify({ emptyReady, empty }),
        });
        // the toggle mounts on the panel's first frame, so the wait above ends while the modal still fades in
        await settle(600);
        await h.shot("cdp-shots/brief-peek-empty.png");
        await pressEscape();
        await polishWaitFor(h, `!document.querySelector('${BAND}')`, 3000);
        return steps;
    },
    async teardown(h, ctx) {
        // best-effort, so one failed step does not strand the rest; the run's dossier stays in the vault
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`brief-peek teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("close the popup", () =>
            h.ev(`document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click()`)
        );
        // a failure between 4c's archive and 4d's reactivation must not leave the seeded record archived
        await step("reactivate the record", () =>
            h.rpc("setdossierstatus", { dossierid: BRIEF_PEEK_RECORD, status: "active" })
        );
        // detached, so the record keeps one run ref across runs rather than growing one per run
        if (ctx?.runId) {
            await step("detach the run from the record", () =>
                h.rpc("detachdossieredge", { dossierid: BRIEF_PEEK_RECORD, runoref: `run:${ctx.runId}` })
            );
            await step("cancel the run", () => h.rpc("cancelrun", { channelid: ctx.channelId, runid: ctx.runId }));
        }
        if (ctx?.channelId) await step("delete the channel", () => h.rpc("deletechannel", { channelid: ctx.channelId }));
        if (ctx?.cwd) await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
        await h.goto("cockpit");
    },
};

// --- peek-ctrl-click: Ctrl+click on a Brief run row peeks it in the avatar popup and writes no selection ---
// A peek is a look, not a landing: the host surface, its active subject, the open-sheet flag and the Brief list's
// scroll must be exactly what they were, both while the item view is up and after Escape closes it.
// The row is selected on the bare [data-peek] attribute, never a value: the Brief's rows set it as "" and the
// fleet row as "true".
const PEEK_CTRL_BRIEF = `document.querySelector('[data-jarvis-region="brief"]')`;
const PEEK_CTRL_GOAL = "verify peek-ctrl-click: do nothing";

const peekCtrlClick = {
    name: "peek-ctrl-click",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-peek-ctrl-")) };
        try {
            const wslist = await h.rpc("workspacelist", null);
            const ch = await h.rpc("createchannel", { name: "verify-peek-ctrl", projectpath: ctx.cwd });
            ctx.channelId = ch.oid;
            const created = await h.rpc("createrun", {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: PEEK_CTRL_GOAL,
                runtime: "claude",
                mode: "quick",
                deferstart: true,
            });
            ctx.runId = created.run.id;
            // the Brief reads a boot-primed snapshot, so the RPC-created channel needs a reload
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        await h.goto("jarvis");
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
        );
        await h.ev("new Promise((r) => setTimeout(r, 400))");
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        // a wide window: the popup's 560px cap only shows when the viewport leaves room for it
        await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
        await h.goto("jarvis");
        await settle(900);

        // the probe is installed by the Brief once it mounts
        const probeReady = await h.ev(`(async () => {
            for (let i = 0; i < 20 && typeof window.__peekProbe !== "function"; i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            return typeof window.__peekProbe === "function";
        })()`);
        const hostState = () =>
            h.ev(`(() => {
                const scroller = ${PEEK_CTRL_BRIEF}?.querySelector(".overflow-y-auto");
                const p = window.__peekProbe();
                return JSON.stringify({
                    surface: p.surface,
                    subject: p.subject,
                    sheetOpen: p.sheetOpen,
                    scrollTop: scroller ? scroller.scrollTop : null,
                });
            })()`);

        // the briefing loads after the Brief mounts, and on a freshly booted app its rows can take seconds
        await polishWaitFor(h, `!!${PEEK_CTRL_BRIEF}?.querySelector("[data-peek]")`, 15000);
        const box = await h.ev(`(() => {
            const region = ${PEEK_CTRL_BRIEF};
            const row =
                region?.querySelector('[data-jarvis-brief-row="session"][data-peek]') ??
                region?.querySelector("[data-peek]");
            if (!row) return null;
            row.scrollIntoView({ block: "nearest" });
            const r = row.getBoundingClientRect();
            return { x: Math.round(r.x + 40), y: Math.round(r.y + r.height / 2), row: row.dataset.jarvisBriefRow ?? null };
        })()`);
        steps.push({
            step: "1. the Brief shows a peekable run row",
            ok: probeReady === true && box != null,
            detail: JSON.stringify({ probeReady, box, arrangeError: ctx.arrangeError ?? null }),
        });
        if (box == null || probeReady !== true) return steps;

        // Ctrl held over a peekable link (ctrlheld.ts): the [data-peek] rule in tailwindsetup.css underlines it in the
        // accent and turns the cursor to zoom-in, and the footer lights its peek chip. Colors are compared resolved,
        // against a probe painted with the accent token.
        const ctrlMod = 2;
        const ctrlKey = { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 };
        const affordance = () =>
            h.ev(`(() => {
                const region = ${PEEK_CTRL_BRIEF};
                const row =
                    region?.querySelector('[data-jarvis-brief-row="session"][data-peek]') ??
                    region?.querySelector("[data-peek]");
                const probe = document.createElement("span");
                probe.style.color = "var(--color-accent)";
                document.body.appendChild(probe);
                const accent = getComputedStyle(probe).color;
                probe.remove();
                const cs = row ? getComputedStyle(row) : null;
                const glyph = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "space · ctrl+click");
                return {
                    flag: document.documentElement.hasAttribute("data-ctrl-held"),
                    hovered: row?.matches(":hover") ?? false,
                    underline: cs?.textDecorationLine ?? null,
                    underlineAccent: cs != null && cs.textDecorationColor === accent,
                    cursor: cs?.cursor ?? null,
                    chip: glyph == null ? null : getComputedStyle(glyph).borderTopColor === accent ? "lit" : "unlit",
                };
            })()`);
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        await h.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...ctrlKey, modifiers: ctrlMod });
        await settle(250);
        const held = await affordance();
        await h.shot("cdp-shots/peek-ctrl-held.png");
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...ctrlKey });
        await settle(250);
        const released = await affordance();
        steps.push({
            step: "2. holding Ctrl over the row underlines it in the accent, shows zoom-in and lights the footer's peek chip",
            ok:
                held.flag === true &&
                held.hovered === true &&
                held.underline === "underline" &&
                held.underlineAccent === true &&
                held.cursor === "zoom-in" &&
                held.chip === "lit" &&
                released.flag === false &&
                released.underline !== "underline" &&
                released.chip === "unlit",
            detail: JSON.stringify({ held, released }),
        });

        await settle(200);
        const before = await hostState();
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, modifiers: ctrlMod });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", {
                type,
                x: box.x,
                y: box.y,
                button: "left",
                clickCount: 1,
                modifiers: ctrlMod,
            });
        }
        const ready = await h.ev(`(async () => {
            for (let i = 0; i < 40; i++) {
                const el = document.querySelector('[data-pet-peek-item="run"][data-pet-peek-status="ready"]');
                if (el) return true;
                await new Promise((r) => setTimeout(r, 250));
            }
            return false;
        })()`);
        // let the reveal and size-layout animations finish before measuring
        await settle(600);
        // the 560px cap is on the dialog's parent (the popup's outer box); the dialog itself is 2px narrower
        const panel = await h.ev(`(() => {
            const el = document.querySelector('[data-pet-peek-item="run"]');
            const outer = el?.parentElement;
            return el && outer ? { status: el.dataset.petPeekStatus, shape: el.dataset.petPeekShape, width: Math.round(outer.getBoundingClientRect().width) } : null;
        })()`);
        await h.shot("cdp-shots/peek-ctrl-click.png");
        steps.push({
            step: "3. Ctrl+click opens a ready run item view in the 560px popup",
            ok: ready === true && panel?.shape === "item" && panel?.width === 560,
            detail: JSON.stringify(panel),
        });

        const during = await hostState();
        steps.push({
            step: "4. the host surface, subject, sheet flag and scroll are unchanged while the peek is up",
            ok: before === during,
            detail: JSON.stringify({ before, during }),
        });

        // a real key event: the popup handles Escape on its dialog, which holds focus, not on the document
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        }
        await settle(500);
        const closed = await h.ev(`!document.querySelector('[data-pet-peek-item]')`);
        const after = await hostState();
        steps.push({
            step: "5. Escape closes the popup and the host's state still matches",
            ok: closed === true && before === after,
            detail: JSON.stringify({ closed, before, after }),
        });
        return steps;
    },
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`peek-ctrl-click teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await h.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
        if (ctx?.runId) {
            await step("cancel the run", () => h.rpc("cancelrun", { channelid: ctx.channelId, runid: ctx.runId }));
        }
        if (ctx?.channelId) await step("delete the channel", () => h.rpc("deletechannel", { channelid: ctx.channelId }));
        if (ctx?.cwd) await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
        await h.goto("cockpit");
    },
};

// --- peek-item-views: the avatar popup's item view for each peekable kind ----------------------------------
// The cockpit-peek mockup's PeekAgent, PeekEffort, PeekRadar, PeekNote, PeekRun and States boards. Each kind is
// peeked through the one router (linkingdevhooks.ts's __peekAddress) on a fixture: the fixture roster's lead for
// the agent, its deferred orchestrator run for the phase strip, an initiative made here, and a radar report written
// straight into the dev store, since only a model-backed scan makes one. The note is arrangePeekItemsNote's.
// __peekLoading holds the loading frame a real
// load leaves too quickly to photograph, and the gone line is the initiative peeked again after it was deleted: the
// peek's load trusts the cached entry, and the body's own refetch finds it missing.
const PEEK_ITEMS_LEAD = "peek-items lead";
const PEEK_ITEMS_EFFORT = "Peek item views initiative";
const PEEK_ITEMS_RISK = "Peek fixture: the retry loop swallows a cancelled context";
const PEEK_ITEMS_FINDING = "f-peek-items";

const RADAR_FIXTURE_COMMIT = "c0ffee5a".padEnd(40, "0");
const RADAR_FIXTURE_SUBJECT = "fix(orchestrate): the dispatch loop stops when its context is cancelled";
const RADAR_FIXTURE_ROOT_CAUSE =
    "A loop that sleeps between attempts checked its context only before the sleep, so a cancel during the backoff was not seen until the cap.";

// A report as the fix-commit audit writes it: one audited commit, and one finding with its sites in one file.
// finding is { id, risk, file, lines }.
function radarFixtureReport(oid, projectname, projectpath, now, finding) {
    const signal = {
        id: "s-fixture-fix",
        collector: "git",
        sourceref: RADAR_FIXTURE_COMMIT,
        observedts: now - 3_600_000,
        summary: RADAR_FIXTURE_SUBJECT,
        contenthash: "s-fixture-fix",
    };
    return {
        otype: "radarreport",
        oid,
        version: 1,
        projectname,
        projectpath,
        status: "completed",
        startedts: now - 120_000,
        clusterstartedts: now - 110_000,
        completedts: now - 60_000,
        signals: [signal],
        audits: [
            {
                commit: RADAR_FIXTURE_COMMIT,
                subject: RADAR_FIXTURE_SUBJECT,
                committs: signal.observedts,
                files: [finding.file],
                status: "ok",
                rootcause: RADAR_FIXTURE_ROOT_CAUSE,
                hitcount: finding.lines.length,
                keptcount: finding.lines.length,
            },
        ],
        findings: [
            {
                id: finding.id,
                fingerprint: `RAD-${finding.id}`,
                group: "new",
                riskkind: "sibling-bug",
                subsystem: finding.file.slice(0, finding.file.lastIndexOf("/")),
                risk: finding.risk,
                severity: "high",
                signalids: [signal.id],
                files: [finding.file],
                mission: "Check whether the loop honours a cancelled context.",
                sourcecommit: RADAR_FIXTURE_COMMIT,
                sourcesubject: RADAR_FIXTURE_SUBJECT,
                rootcause: RADAR_FIXTURE_ROOT_CAUSE,
                sites: finding.lines.map((line) => ({
                    line,
                    trigger: `A cancel while the loop at line ${line} is in its backoff.`,
                    actual: "The loop keeps retrying until the backoff cap.",
                    expected: "The loop returns as soon as the context is done.",
                    whynotcovered: "The fix added the check to the dispatch loop only.",
                })),
            },
        ],
        meta: {},
    };
}

function peekItemsReport(oid, cwd, now) {
    return radarFixtureReport(oid, "peek-fixture", cwd, now, {
        id: PEEK_ITEMS_FINDING,
        risk: PEEK_ITEMS_RISK,
        file: "pkg/orchestrate/retry.go",
        lines: [41, 67],
    });
}

async function peekItemsDb(h) {
    const { DatabaseSync } = await import("node:sqlite");
    const info = await h.rpc("waveinfo", null);
    const path = join(info.datadir, "db", "waveterm.db");
    if (!existsSync(path)) throw new Error(`no dev store at ${path}`);
    const db = new DatabaseSync(path);
    // wavesrv holds the same WAL database open, so a write may have to wait for its lock
    db.exec("PRAGMA busy_timeout = 5000");
    return db;
}

// writes the report build(oid) returns straight into the dev store, and returns its oid
async function seedRadarReport(h, build) {
    const oid = randomUUID();
    const db = await peekItemsDb(h);
    try {
        db.prepare("INSERT INTO db_radarreport (oid, version, data) VALUES (?, 1, ?)").run(
            oid,
            JSON.stringify(build(oid))
        );
    } finally {
        db.close();
    }
    return oid;
}

async function seedPeekItemsRadar(h, ctx) {
    ctx.radarReportId = await seedRadarReport(h, (oid) => peekItemsReport(oid, ctx.cwd, Date.now()));
}

async function dropPeekItemsRadar(h, oid) {
    const db = await peekItemsDb(h);
    try {
        db.prepare("DELETE FROM db_radarreport WHERE oid = ?").run(oid);
    } finally {
        db.close();
    }
}

const PEEK_ITEMS_NOTE = "peek-items-fixture";
const PEEK_ITEMS_NOTE_TITLE = "Peek fixture note";

const newestMemoryNote = async (h) => {
    const nodes = (await h.rpc("vaultgraph", null))?.nodes ?? [];
    const note = nodes.filter((n) => n.kind === "memory").sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))[0];
    return note ? { id: note.id, label: note.label } : null;
};

// The newest memory note already in the vault, read and never written. A vault with none, which is the fresh
// profile's default vault under a Final, gets one fixture note, removed in teardown. The root mirrors
// wconfig.resolveVaultRoot, and the vault graph must then list the note, so a wrong root fails here instead of
// leaving a stray file.
async function arrangePeekItemsNote(h, ctx) {
    ctx.note = await newestMemoryNote(h);
    if (ctx.note != null) return;
    const settings = (await h.rpc("getfullconfig", null))?.settings ?? {};
    const configured = settings["memory:vaultpath"] || settings["jarvis:vaultpath"];
    const root = configured ? configured.replace(/^~(?=$|[\\/])/, homedir()) : join(homedir(), ".waveterm", "vault");
    ctx.noteFile = join(root, "memory", `${PEEK_ITEMS_NOTE}.md`);
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(
        ctx.noteFile,
        `---\ntitle: ${PEEK_ITEMS_NOTE_TITLE}\n---\n\nA memory note the peek-item-views scenario writes into an empty vault and removes after.\n`
    );
    ctx.note = await newestMemoryNote(h);
    if (ctx.note?.id !== PEEK_ITEMS_NOTE) throw new Error(`the vault graph does not list the note written to ${ctx.noteFile}`);
}

const peekItemViews = {
    name: "peek-item-views",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-peek-items-")) };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await arrangeFixtureRun(h, ctx, "peek-items", PEEK_ITEMS_LEAD);
            const effort = await h.rpc("effortcreate", {
                title: PEEK_ITEMS_EFFORT,
                chunks: [{ label: "Fixture" }, { label: "Peek" }, { label: "Verify" }],
            });
            ctx.effortId = effort.effortoid;
            await h.rpc("effortmutate", {
                effortoid: ctx.effortId,
                author: "you",
                ops: [
                    { op: "setChunkStatus", chunk: "Fixture", status: "done", note: "Fixtures arranged." },
                    { op: "setChunkStatus", chunk: "Peek", status: "active" },
                ],
            });
            await seedPeekItemsRadar(h, ctx);
            await arrangePeekItemsNote(h, ctx);
            // the fixture roster is read once at boot
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
        await h.goto("jarvis");
        const hooks = await polishWaitFor(
            h,
            `typeof window.__peekAddress === 'function' && typeof window.__peekLoading === 'function'`,
            5000
        );
        rec(
            "1. the fixtures are arranged and the Brief installed the peek hooks",
            ctx.arrangeError == null && hooks === true,
            JSON.stringify({ arrangeError: ctx.arrangeError ?? null, hooks, note: ctx.note })
        );
        if (ctx.arrangeError != null || hooks !== true) return steps;

        const closePopup = async () => {
            await h.ev(`document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click()`);
            await polishWaitFor(h, `!document.querySelector('[data-pet-peek]')`, 3000);
        };
        // ready is the item settled and its body reported; check reads the body's text and DOM as `body`
        const peek = async (address, hint, kind, check, shot) => {
            await closePopup();
            const result = await h.ev(`window.__peekAddress(${JSON.stringify(address)}, ${JSON.stringify(hint ?? null)})`);
            const ready = await polishWaitFor(
                h,
                `(() => {
                    const el = document.querySelector('[data-pet-peek-item="${kind}"][data-pet-peek-status="ready"]');
                    const body = el?.querySelector('[data-pet-peek-body]');
                    if (!body || body.querySelector('[data-pet-peek-gone]')) return false;
                    const text = body.innerText || '';
                    return ${check};
                })()`,
                10000
            );
            // the reveal and the size-layout animation finish before the shot
            await settle(600);
            const view = await h.ev(`(() => {
                const el = document.querySelector('[data-pet-peek-item]');
                const body = el?.querySelector('[data-pet-peek-body]');
                return el ? {
                    kind: el.dataset.petPeekItem,
                    status: el.dataset.petPeekStatus,
                    width: Math.round(el.parentElement.getBoundingClientRect().width),
                    phases: [...el.querySelectorAll('[data-peek-run-phase]')].map((p) => p.dataset.peekRunPhase),
                    text: (body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
                } : null;
            })()`);
            await h.shot(shot);
            return { result, ready, view };
        };

        const agent = await peek(
            `agent:${TREE_RAIL_LEAD_ID}`,
            null,
            "agent",
            `text.includes(${JSON.stringify(PEEK_ITEMS_LEAD)})`,
            "cdp-shots/peek-item-agent.png"
        );
        rec("2. an agent peeks as its item view", agent.ready === true, JSON.stringify(agent));

        const effort = await peek(
            `effort:${ctx.effortId}`,
            null,
            "effort",
            `text.includes(${JSON.stringify(PEEK_ITEMS_EFFORT)})`,
            "cdp-shots/peek-item-initiative.png"
        );
        rec("3. an initiative peeks as its item view", effort.ready === true, JSON.stringify(effort));

        const radar = await peek(
            `radarreport:${ctx.radarReportId}`,
            { sourceType: "radar", anchor: PEEK_ITEMS_FINDING },
            "radar",
            // a site row is its file:line and nothing else
            `text.includes(${JSON.stringify(PEEK_ITEMS_RISK)}) &&
                [...body.querySelectorAll('[data-peek-radar-sites] div')].filter(
                    (d) => d.children.length === 0 && /:\\d+$/.test((d.textContent || '').trim())
                ).length === 2`,
            "cdp-shots/peek-item-radar.png"
        );
        rec("4. a radar finding peeks as its item view", radar.ready === true, JSON.stringify(radar));

        const note = await peek(
            `memnote:${ctx.note.id}`,
            { sourceType: "memory" },
            "note",
            `text.includes(${JSON.stringify(ctx.note.label)})`,
            "cdp-shots/peek-item-note.png"
        );
        rec("5. a memory note peeks as its item view", note.ready === true, JSON.stringify(note));

        // an orchestrator run reads Plan, Review, Tasks and Final; a quick run has no strip
        const run = await peek(
            `run:${ctx.runId}`,
            null,
            "run",
            `body.querySelectorAll('[data-peek-run-phase]').length === 4`,
            "cdp-shots/peek-item-run.png"
        );
        rec("6. an orchestrator run peeks with its four-phase strip", run.ready === true, JSON.stringify(run));

        await closePopup();
        await h.ev(`window.__peekLoading({ kind: "effort", effortId: ${JSON.stringify(ctx.effortId)} })`);
        const loading = await polishWaitFor(
            h,
            `(() => {
                const el = document.querySelector('[data-pet-peek-item="effort"][data-pet-peek-status="loading"]');
                const skeleton = el?.querySelector('[data-pet-peek-skeleton]');
                return !!skeleton && /initiative/i.test(skeleton.innerText || '');
            })()`,
            3000
        );
        await settle(600);
        await h.shot("cdp-shots/peek-item-loading.png");
        rec("7. a loading peek shows the skeleton under its kind", loading === true, String(loading));

        await closePopup();
        await h.rpc("effortdelete", { effortoid: ctx.effortId });
        ctx.effortDeleted = true;
        await h.ev(`window.__peekAddress(${JSON.stringify(`effort:${ctx.effortId}`)})`);
        const gone = await polishWaitFor(
            h,
            `(() => {
                const el = document.querySelector('[data-pet-peek-item="effort"][data-pet-peek-status="ready"]');
                return (el?.querySelector('[data-pet-peek-gone]')?.innerText || '').trim() === 'That initiative no longer exists';
            })()`,
            10000
        );
        await settle(600);
        await h.shot("cdp-shots/peek-item-gone.png");
        rec("8. a deleted target's peek says it no longer exists", gone === true, String(gone));
        await closePopup();
        return steps;
    },
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`peek-item-views teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("close the popup", () =>
            h.ev(`document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click()`)
        );
        if (ctx.effortId && !ctx.effortDeleted) {
            await step("delete the initiative", () => h.rpc("effortdelete", { effortoid: ctx.effortId }));
        }
        if (ctx.radarReportId) await step("delete the radar report", () => dropPeekItemsRadar(h, ctx.radarReportId));
        if (ctx.noteFile) await step("remove the fixture note", () => rmSync(ctx.noteFile, { force: true }));
        await teardownFixtureRun(h, ctx, "peek-item-views");
        await h.goto("cockpit");
    },
};

// The two layers added on top of the collapse order: the nav rail collapsing itself below a narrow window
// (navrailwidth.ts, the design's step 4) and the context rail leaving the flow entirely once collapsing
// both regions to strips is still not enough (jarvislayout.ts's railOverlay). jarvis-collapse-order owns
// the *order*; this owns the two widths where the new steps fire.

// One gutter, one header band (jarvis/stagemeasure.ts). The surface was assembled by merging three
// destinations, and each region kept the padding, header height and divider tone it had as its own screen:
// measured at 1500px, the Stage's stacked bands started their content at 366 (header, px-4), 382 (thread,
// max-w-[900px] px-8) and 370 (composer, px-5), the record subject added 432 (max-w-[720px] centred) over a
// full-bleed 18, and the three columns' header rules landed at y=44, 81 and 96 in two tones. Nothing here is
// derivable from a unit test — it is where the boxes actually are.
//
// The first version of this asserted one left edge across the elements carrying the shared measure's class,
// which is circular: a sealed run's header band did not carry it, kept its own px-6, and put the largest
// text on the Stage 20px left of everything else while this scenario stayed green. So the probe below finds
// bands by geometry, and the loop walks every subject kind rather than only the fixture conversation.

// --- usage charts: the meter primitives + the visx DailyChart actually render -------------------
// Class names asserted below were read off the installed packages, not guessed: @visx/axis puts
// `visx-axis visx-axis-left` on the axis group and `visx-axis-tick` on each tick, and @visx/tooltip
// puts `visx-tooltip` on the portal. Step 5 is scoped to the chart's own <svg> — a page-wide title
// query would trip over icon <title> elements that have nothing to do with the chart.
// Deterministic Usage surface: seed wave:dev-usage-buckets (the dev-only fixture the store reads)
// and wave:ratelimits (the persisted Claude quota snapshot), reload so savedRateLimitsAtom seeds from
// the snapshot, then let the Usage surface's mount load consume the historical fixture.
// Local day keys relative to "now" so the default 7-day view always has recent records.
const dayAgo = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
};

const buildUsageFixture = () => {
    const buckets = [];
    // Claude/Anthropic/Opus across 16 days so All-time renders the brush.
    for (let n = 0; n < 16; n++) {
        buckets.push({
            harness: "claude",
            provider: "anthropic",
            session: "fx-claude",
            model: "claude-opus-4-8",
            day: dayAgo(n),
            input: 1000,
            output: 200,
            reasoning: 0,
            cacheread: 3000,
            cachecreate: 0,
            cachecreate1h: 0,
            msgs: 4,
        });
    }
    // Codex/OpenAI with known pricing.
    buckets.push({
        harness: "codex",
        provider: "openai",
        session: "fx-codex",
        model: "gpt-5.5",
        day: dayAgo(2),
        input: 500,
        output: 120,
        reasoning: 0,
        cacheread: 900,
        cachecreate: 0,
        cachecreate1h: 0,
        msgs: 3,
    });
    // OpenCode/OpenAI with reasoning and a REPORTED ZERO cost (present zero, not absent).
    buckets.push({
        harness: "opencode",
        provider: "openai",
        session: "fx-opencode",
        model: "gpt-5.5",
        day: dayAgo(1),
        input: 700,
        output: 150,
        reasoning: 400,
        cacheread: 900,
        cachecreate: 0,
        cachecreate1h: 0,
        reportedcostusd: 0,
        msgs: 2,
    });
    // OpenCode/OpenCode-Go with UNKNOWN pricing and non-zero reported cost (coverage < 100%). The model
    // id is deliberately synthetic: this bucket exists to exercise priceFor()'s unknown-model path, and
    // naming a real model here is what rotted the assertion last time — the bundled table gained a
    // deepseek-v4-pro row, coverage silently became 100%, and step 11 started failing.
    buckets.push({
        harness: "opencode",
        provider: "opencode-go",
        session: "fx-opencode-go",
        model: "unpriced-test-model",
        day: dayAgo(3),
        input: 2000,
        output: 500,
        reasoning: 0,
        cacheread: 0,
        cachecreate: 0,
        cachecreate1h: 0,
        reportedcostusd: 1.25,
        msgs: 5,
    });
    // Pi/OpenAI-Codex: the same model id as Codex's openai bucket but a DISTINCT provider, so the
    // harness and provider dimensions stay separate (pi -> openai-codex, codex -> openai).
    buckets.push({
        harness: "pi",
        provider: "openai-codex",
        session: "fx-pi",
        model: "gpt-5.5",
        day: dayAgo(1),
        input: 900,
        output: 200,
        reasoning: 300,
        cacheread: 1200,
        cachecreate: 400,
        cachecreate1h: 100,
        reportedcostusd: 0.42,
        msgs: 4,
    });
    buckets.push({
        harness: "pi",
        provider: "openai-codex",
        session: "fx-pi",
        model: "gpt-5.5",
        day: dayAgo(2),
        input: 400,
        output: 90,
        reasoning: 120,
        cacheread: 600,
        cachecreate: 150,
        cachecreate1h: 0,
        reportedcostusd: 0.18,
        msgs: 2,
    });
    // the directory GetUsageStatsCommand returns beside the buckets: one entry per session above
    const sessions = [...new Set(buckets.map((b) => `${b.harness}:${b.session}`))].map((key) => {
        const [harness, session] = key.split(":");
        return { harness, session, title: `${harness} fixture session` };
    });
    return { buckets, sessions };
};

const usageCharts = {
    name: "usage-charts",
    surface: "usage",
    async arrange(h) {
        const ctx = {
            prevUsage: await h.ev(`localStorage.getItem('wave:dev-usage-buckets')`),
            prevRate: await h.ev(`localStorage.getItem('wave:ratelimits')`),
        };
        const nowSec = Math.floor(Date.now() / 1000);
        // a current Claude snapshot with FUTURE reset epochs, so the donut renders and its countdown is live
        const rateLimits = {
            claude: {
                fivehourpct: 62,
                fivehourreset: nowSec + 3 * 3600,
                weekpct: 41,
                weekreset: nowSec + 6 * 24 * 3600,
                capturedAt: Date.now(),
            },
        };
        await h.ev(
            `localStorage.setItem('wave:dev-usage-buckets', ${JSON.stringify(JSON.stringify(buildUsageFixture()))})`
        );
        await h.ev(`localStorage.setItem('wave:ratelimits', ${JSON.stringify(JSON.stringify(rateLimits))})`);
        // reload so savedRateLimitsAtom (module-load seeded) and the Usage surface both read the snapshot
        await h.ev("location.reload()");
        await new Promise((r) => setTimeout(r, 2500));
        return ctx;
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);

        // The surface fetches its stats over RPC and shows a skeleton until they land, so the chart is
        // NOT in the DOM the instant goto returns. Poll for it instead of sleeping a fixed amount —
        // the all-time scan's duration depends on how many transcripts exist.
        let ready = false;
        for (let waited = 0; waited <= 10000 && !ready; waited += 250) {
            ready = (await h.ev(`document.querySelectorAll(".visx-axis-left .visx-axis-tick").length`)) > 0;
            if (!ready) await settle(250);
        }
        rec("0. usage surface loaded and the chart mounted", ready, ready ? "chart present" : "timed out after 10s");

        // the visx chart renders an <svg> with axis ticks and at least one bar rect
        const chart = await h.ev(`(() => {
            const svgs = [...document.querySelectorAll("svg")];
            const withTicks = svgs.filter((s) => s.querySelectorAll(".visx-axis-left .visx-axis-tick").length > 0);
            const s = withTicks[0];
            if (!s) return { found: false };
            return {
                found: true,
                leftTicks: s.querySelectorAll(".visx-axis-left .visx-axis-tick").length,
                bottomTicks: s.querySelectorAll(".visx-axis-bottom .visx-axis-tick").length,
                bars: s.querySelectorAll("path[fill^='var(--color-']").length,
            };
        })()`);
        rec(
            "1. DailyChart renders a visx svg with axes and bars",
            chart.found && chart.leftTicks >= 2 && chart.bars >= 1,
            JSON.stringify(chart)
        );

        // the tokens the chart and the class bars paint with all resolve (no invented chart palette —
        // these are the pre-existing design-system tokens, so a rename would break the fills silently)
        const palette = await h.ev(`(() => {
            const cs = getComputedStyle(document.documentElement);
            const names = ["--color-cacheread","--color-accent","--color-warning","--color-success","--color-accent-200","--color-accent-800","--color-accent-300","--color-rt-opencode","--color-rt-pi"];
            return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
        })()`);
        rec(
            "2. the design-system tokens the chart paints with all resolve",
            Object.values(palette).every((v) => /^#[0-9a-f]{6}$/i.test(v)),
            JSON.stringify(palette)
        );

        // Live limits render one Meter bar per window (the redesign traded the ArcMeter rings for bars),
        // and the seeded claude snapshot is 62%/41% so both bars must have a non-zero width.
        const limits = await h.ev(`(() => {
            const cards = [...document.querySelectorAll("[data-usage-limit]")];
            return cards.map((c) => {
                const fill = c.querySelector("div[style*='width']");
                return { kind: c.getAttribute("data-usage-limit"), width: fill ? fill.style.width : "" };
            });
        })()`);
        rec(
            "3. Live limits render a 5-hour and a weekly bar with a real width",
            limits.length === 2 &&
                limits.some((l) => l.kind === "fivehour") &&
                limits.some((l) => l.kind === "week") &&
                limits.every((l) => /^[0-9.]+%$/.test(l.width) && parseFloat(l.width) > 0),
            JSON.stringify(limits)
        );

        // hovering a column opens the visx tooltip (replacing the old native title attribute). React
        // delegates pointer events from a child rect, so dispatch there rather than on the <g>.
        const tip = await h.ev(`(() => {
            const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector(".visx-axis-left"));
            const r = svg && svg.querySelector("path[fill^='var(--color-']");
            if (!r) return { hovered: false };
            for (const type of ["pointerover", "mouseover", "mouseenter"]) {
                r.dispatchEvent(new MouseEvent(type, { bubbles: true }));
            }
            return { hovered: true };
        })()`);
        await settle(250);
        const tipText = await h.ev(
            `(() => { const t = document.querySelector("[class*='visx-tooltip']"); return t ? t.textContent : ""; })()`
        );
        rec("4. hover opens a styled tooltip", tip.hovered && tipText.length > 0, JSON.stringify({ tipText }));

        // no native title tooltips left on the chart itself
        const titles = await h.ev(`(() => {
            const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector(".visx-axis-left"));
            if (!svg) return -1;
            return svg.querySelectorAll("[title], title").length;
        })()`);
        rec("5. no native title tooltips on the chart", titles === 0, String(titles));

        // verify.mjs shoots before assert, which catches the skeleton; take our own once loaded.
        await h.shot("cdp-shots/usage-charts-loaded.png");

        // The brush only exists on All-time with >14 days, so the default 7d window never renders it.
        const clicked = await h.ev(`(() => {
            const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "All time");
            if (!b) return false;
            b.click();
            return true;
        })()`);
        let brush = { skipped: true };
        if (clicked) {
            for (let waited = 0; waited <= 20000; waited += 500) {
                brush = await h.ev(`(() => {
                    const svgs = [...document.querySelectorAll("svg")];
                    const chart = svgs.find((s) => s.querySelector(".visx-axis-left"));
                    if (!chart) return { loaded: false };
                    const strip = svgs.find((s) => s.querySelector(".visx-brush"));
                    // the chart card's own label, NOT the first "Daily" on the page (the "Daily avg" stat card)
                    const h3 = [...document.querySelectorAll("h3")].find((x) => x.textContent.trim() === "Daily");
                    return {
                        loaded: true,
                        bars: chart.querySelectorAll("path[fill^='var(--color-']").length,
                        brushStrip: !!strip,
                        brushOverlay: !!document.querySelector(".visx-brush-overlay"),
                        label: h3 && h3.nextElementSibling ? h3.nextElementSibling.textContent.trim() : "",
                    };
                })()`);
                if (brush.loaded && brush.brushStrip) break;
                await settle(500);
            }
            await h.shot("cdp-shots/usage-charts-alltime.png");
        }
        rec("6. All-time renders the brush strip under the chart", !!brush.brushStrip, JSON.stringify(brush));

        // The scope picker is now the master rail, keyed by data-usage-harness (a text query would match
        // the detail pane's own copy of a provider name). Every seeded harness needs a row plus the
        // pinned aggregate.
        const railKeys = await h.ev(
            `[...document.querySelectorAll("[data-usage-harness]")].map((b) => b.getAttribute("data-usage-harness"))`
        );
        rec(
            "7. the rail lists all, claude, codex, opencode, and pi",
            ["all", "claude", "codex", "opencode", "pi"].every((k) => railKeys.includes(k)),
            JSON.stringify(railKeys)
        );

        // select the OpenCode rail row, then assert only OpenCode history remains
        const clickedOpenCode = await h.ev(`(() => {
            const b = document.querySelector('[data-usage-harness="opencode"]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await settle(400);
        const openCodeState = await h.ev(`(() => {
            const h3s = [...document.querySelectorAll("h3")].map((x) => (x.textContent || "").trim());
            const body = document.body.textContent || "";
            return {
                hasOpenaiModel: body.includes("openai/gpt-5.5"),
                hasUnpricedModel: body.includes("opencode-go/unpriced-test-model"),
                hasAnthropicHeading: h3s.includes("anthropic"),
                hasReasoning: body.includes("Reasoning"),
                hasReportedCostLabel: body.includes("Reported cost"),
                hasEstimateLabel: body.includes("API-equivalent"),
            };
        })()`);
        rec(
            "8. selecting OpenCode leaves only OpenCode model cards and totals",
            clickedOpenCode &&
                openCodeState.hasOpenaiModel &&
                openCodeState.hasUnpricedModel &&
                !openCodeState.hasAnthropicHeading,
            JSON.stringify(openCodeState)
        );
        rec(
            "9. the token-class section shows Reasoning",
            openCodeState.hasReasoning,
            `reasoning=${openCodeState.hasReasoning}`
        );
        rec(
            "10. reported cost and API-equivalent estimate are separate labels",
            openCodeState.hasReportedCostLabel && openCodeState.hasEstimateLabel,
            JSON.stringify({ reported: openCodeState.hasReportedCostLabel, estimated: openCodeState.hasEstimateLabel })
        );

        // one OpenCode bucket is intentionally unpriced, so priced-token coverage must be below 100%
        const coverage = await h.ev(`(() => {
            const owners = [...document.querySelectorAll("div")].filter(
                (d) => /% of tokens priced/.test(d.textContent || "") && d.children.length === 0
            );
            const m = owners.length ? (owners[0].textContent || "").match(/(\\d+)% of tokens priced/) : null;
            return m ? Number(m[1]) : null;
        })()`);
        rec(
            "11. pricing coverage is below 100% because one model is unpriced",
            coverage != null && coverage < 100,
            `coverage=${coverage}%`
        );

        // Master-detail INVERTS the old rule: limits are now scoped to the selection, so OpenCode (which
        // publishes no quota) must show the no-reading note rather than borrowing Claude's bars, and the
        // aggregate must bring the bars back. A scope switch changing the limits is the feature.
        const limitsOpenCode = await h.ev(`(() => {
            const d = document.querySelector("[data-usage-detail]");
            return {
                scope: d ? d.getAttribute("data-usage-detail") : null,
                bars: document.querySelectorAll("[data-usage-limit]").length,
                note: (d ? d.textContent || "" : "").includes("No quota reading"),
            };
        })()`);
        await h.ev(`(() => {
            const b = document.querySelector('[data-usage-harness="all"]');
            if (b) b.click();
        })()`);
        await settle(400);
        const limitsAll = await h.ev(`(() => {
            const d = document.querySelector("[data-usage-detail]");
            return {
                scope: d ? d.getAttribute("data-usage-detail") : null,
                bars: document.querySelectorAll("[data-usage-limit]").length,
            };
        })()`);
        rec(
            "12. live limits follow the selected scope",
            limitsOpenCode.scope === "opencode" &&
                limitsOpenCode.bars === 0 &&
                limitsOpenCode.note &&
                limitsAll.scope === "all" &&
                limitsAll.bars === 2,
            JSON.stringify({ limitsOpenCode, limitsAll })
        );

        // the rail selection IS the harness filter, and it lives in the long-lived view model, so it
        // survives the surface unmounting on a nav switch
        await h.ev(`(() => {
            const b = document.querySelector('[data-usage-harness="opencode"]');
            if (b) b.click();
        })()`);
        await settle(400);
        await h.goto("cockpit");
        await h.goto("usage");
        await settle(600);
        const filterSurvived = await h.ev(`(() => {
            const b = document.querySelector('[data-usage-harness="opencode"]');
            const d = document.querySelector("[data-usage-detail]");
            return {
                pressed: b ? b.getAttribute("aria-pressed") : null,
                scope: d ? d.getAttribute("data-usage-detail") : null,
            };
        })()`);
        rec(
            "13. OpenCode selection survives a surface switch",
            filterSurvived.pressed === "true" && filterSurvived.scope === "opencode",
            JSON.stringify(filterSurvived)
        );

        // the app bar must have no usage control at all, and its native window controls must remain
        const appBar = await h.ev(`(() => {
            const bar = document.querySelector("[data-tauri-drag-region]");
            if (!bar) return { found: false };
            const usageArcs = [...bar.querySelectorAll("*")].filter(
                (e) => e.style && e.style.getPropertyValue("--usage-arc")
            ).length;
            const hasLimitText = (bar.textContent || "").includes("5h limit");
            const min = !!bar.querySelector('[aria-label="Minimize"]');
            const max = !!bar.querySelector('[aria-label="Maximize"]');
            const close = !!bar.querySelector('[aria-label="Close"]');
            return { found: true, usageArcs, hasLimitText, min, max, close };
        })()`);
        rec(
            "14. the app bar has no usage signal and keeps native window controls",
            appBar.found && appBar.usageArcs === 0 && !appBar.hasLimitText && appBar.min && appBar.max && appBar.close,
            JSON.stringify(appBar)
        );

        // Reset the filter to All (the OpenCode filter survived the surface switch above), then read the
        // DailyChart legend: each harness's swatch is a 9px span whose inline background resolves to its
        // runtime token, followed by its label span. OpenCode and Pi must both appear with local marks.
        await h.ev(`(() => {
            const b = document.querySelector('[data-usage-harness="all"]');
            if (b) b.click();
        })()`);
        await settle(400);
        const legend = await h.ev(`(() => {
            const swatches = [...document.querySelectorAll("span[style]")].filter((s) => {
                const bg = s.style && s.style.background ? s.style.background : "";
                return bg.includes("--color-rt-opencode") || bg.includes("--color-rt-pi");
            });
            const labels = swatches.map((s) => (s.parentElement ? (s.parentElement.textContent || "").trim() : ""));
            return { count: swatches.length, labels };
        })()`);
        rec(
            "15. the chart legend names OpenCode and Pi",
            legend.count >= 2 && legend.labels.includes("OpenCode") && legend.labels.includes("Pi"),
            JSON.stringify(legend)
        );

        // select the Pi rail row, then assert only Pi history remains and its provider/model stays
        // distinct from Codex's openai bucket and OpenCode's opencode-go bucket.
        const clickedPi = await h.ev(`(() => {
            const b = document.querySelector('[data-usage-harness="pi"]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await settle(400);
        const piState = await h.ev(`(() => {
            const h3s = [...document.querySelectorAll("h3")].map((x) => (x.textContent || "").trim());
            const body = document.body.textContent || "";
            return {
                hasPiProvider: body.includes("openai-codex"),
                hasPiModelRow: body.includes("openai-codex/gpt-5.5"),
                noCodexCard: !body.includes("openai/gpt-5.5"),
                noOpenCodeCard: !body.includes("opencode-go"),
                noAnthropicHeading: !h3s.includes("anthropic"),
            };
        })()`);
        rec(
            "16. selecting Pi leaves only Pi model cards with a provider/model distinct from Codex and OpenCode",
            clickedPi &&
                piState.hasPiProvider &&
                piState.hasPiModelRow &&
                piState.noCodexCard &&
                piState.noOpenCodeCard &&
                piState.noAnthropicHeading,
            JSON.stringify(piState)
        );

        // By provider is the default lens, and its detail page has no ranked list: that is By work's
        const lens = await h.ev(`(() => {
            const pressed = (key) =>
                document.querySelector('[data-usage-lens="' + key + '"]')?.getAttribute("aria-pressed") ?? null;
            return {
                provider: pressed("provider"),
                work: pressed("work"),
                lists: document.querySelectorAll("[data-usage-detail] [data-usage-list]").length,
            };
        })()`);
        rec(
            "17. the lens switch shows By provider pressed, and the detail page has no ranked list",
            lens.provider === "true" && lens.work === "false" && lens.lists === 0,
            JSON.stringify(lens)
        );

        return steps;
    },
    // Restore the developer's pre-existing quota + fixture snapshots (delete only absent keys), reload so
    // savedRateLimitsAtom returns to the original value, then select the 7-day window and return to Cockpit.
    async teardown(h, ctx) {
        await h.ev(restoreLocalStorage("wave:dev-usage-buckets", ctx.prevUsage));
        await h.ev(restoreLocalStorage("wave:ratelimits", ctx.prevRate));
        await h.ev("location.reload()");
        await new Promise((r) => setTimeout(r, 2500));
        await h.goto("usage");
        await h.ev(`(() => {
            const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "7 days");
            if (b) b.click();
        })()`);
        await h.goto("cockpit");
    },
};

// an expression that puts a localStorage key back as it was read, removing one that was absent
function restoreLocalStorage(key, prev) {
    return prev === null ? `localStorage.removeItem('${key}')` : `localStorage.setItem('${key}', ${JSON.stringify(prev)})`;
}

// --- usage-work: the Usage surface's By work lens ----------------------------------------------
// What the window's usage was spent on (docs/superpowers/specs/2026-10-08-usage-attribution-design.md): the
// project rail, the ranked list with its toggle, and the project, run and session pages, on a seeded
// {buckets, sessions} fixture. Paths use forward slashes and an upper-case drive letter, the form the surface
// normalises a project to, so data-usage-project equals what was seeded.
const USAGE_WORK_ARC = "C:/work/arc";
const USAGE_WORK_SIEM = "C:/work/siem";
const USAGE_WORK_SCRATCH = "C:/work/scratch";
// names no stored run or channel: Open run reaches the router, whose notice says so
const USAGE_WORK_RUN = "fx-usage-run";
const USAGE_WORK_CHANNEL = "fx-usage-channel";
const USAGE_WORK_GONE = "That channel no longer exists";
const USAGE_WORK_RUN_ITEM = `run:${USAGE_WORK_RUN}`;
const USAGE_WORK_SESSION_ITEM = "session:claude:fx-arc-1";
const USAGE_WORK_PI_ITEM = "session:pi:fx-pi-local";
const USAGE_WORK_PI_COST = 0.37;
const USAGE_WORK_OPUS = "claude-opus-5-5";
const USAGE_WORK_SONNET = "claude-sonnet-5-5";
const USAGE_WORK_COLLAPSED_ROWS = 8;
const USAGE_WORK_CLASSES = ["cacheRead", "reasoning", "output", "cacheWrite", "input"];

// Eleven work items. arc: an orchestrator run of four sessions on two models, a quick run, three sessions no run
// started and the pi session. siem: three sessions. scratch holds under 1% of spend, so it folds into "other
// folders" with the one session the directory does not list.
function buildUsageWorkFixture() {
    const buckets = [];
    const sessions = [];
    // units sizes a session: one unit prices at $0.125 on opus and $0.0725 on sonnet
    const add = (session, model, units, meta) => {
        buckets.push({
            harness: "claude",
            provider: "anthropic",
            model,
            session,
            day: dayAgo(1),
            input: 10_000 * units,
            output: 2_000 * units,
            reasoning: 0,
            cacheread: 100_000 * units,
            cachecreate: 5_000 * units,
            cachecreate1h: 0,
            msgs: units,
        });
        if (meta != null) sessions.push({ harness: "claude", session, ...meta });
    };
    const inRun = (role, taskid) => ({
        project: USAGE_WORK_ARC,
        runid: USAGE_WORK_RUN,
        channelid: USAGE_WORK_CHANNEL,
        rungoal: "Usage attribution fixture run",
        runmode: "orchestrator",
        role,
        ...(taskid ? { taskid } : {}),
    });
    add("fx-run-lead", USAGE_WORK_OPUS, 40, { title: "Lead session", ...inRun("lead") });
    add("fx-run-worker-1", USAGE_WORK_SONNET, 40, { title: "Wire types", ...inRun("worker", "t-1") });
    add("fx-run-worker-2", USAGE_WORK_SONNET, 30, { title: "By work lens", ...inRun("worker", "t-2") });
    add("fx-run-reviewer", USAGE_WORK_OPUS, 8, { title: "Review of wire types", ...inRun("reviewer", "t-1") });
    add("fx-quick", USAGE_WORK_OPUS, 16, {
        title: "Quick fix session",
        project: USAGE_WORK_ARC,
        runid: "fx-usage-quick",
        rungoal: "Fix the rail's truncated label",
        runmode: "quick",
    });
    add("fx-arc-1", USAGE_WORK_OPUS, 12, { title: "Trace the usage scan", project: USAGE_WORK_ARC });
    add("fx-arc-2", USAGE_WORK_SONNET, 20, { title: "Rename the bucket key", project: USAGE_WORK_ARC });
    add("fx-arc-3", USAGE_WORK_OPUS, 6, { title: "Read the price table", project: USAGE_WORK_ARC });
    add("fx-siem-1", USAGE_WORK_OPUS, 24, { title: "Detector backfill", project: USAGE_WORK_SIEM });
    add("fx-siem-2", USAGE_WORK_SONNET, 10, { title: "Kafka topic audit", project: USAGE_WORK_SIEM });
    add("fx-siem-3", USAGE_WORK_OPUS, 4, { title: "Avro schema check", project: USAGE_WORK_SIEM });
    add("fx-scratch", USAGE_WORK_SONNET, 1, { title: "Scratch note", project: USAGE_WORK_SCRATCH });
    add("fx-unlisted", USAGE_WORK_OPUS, 1, null);
    // an unpriced model that reports its own cost: the row shows that figure, marked "reported"
    buckets.push({
        harness: "pi",
        provider: "fx-local",
        model: "unpriced-test-model",
        session: "fx-pi-local",
        day: dayAgo(1),
        input: 40_000,
        output: 9_000,
        reasoning: 0,
        cacheread: 0,
        cachecreate: 0,
        cachecreate1h: 0,
        reportedcostusd: USAGE_WORK_PI_COST,
        msgs: 6,
    });
    sessions.push({ harness: "pi", session: "fx-pi-local", title: "Local model spike", project: USAGE_WORK_ARC });
    return { buckets, sessions };
}

// page-side helpers: every query is scoped to the surface's own data-* containers
const USAGE_WORK_LIB = `
    const text = (el) => (el?.textContent || "").replace(/\\s+/g, " ").trim();
    const detail = () => document.querySelector("[data-usage-detail]");
    // the surface's root: the header with the window switch sits beside the rail and the detail
    const surface = () => detail()?.parentElement?.parentElement ?? null;
    const windowButton = (label) =>
        [...(surface()?.querySelectorAll("button[aria-pressed]") ?? [])].find((b) => text(b) === label);
    const press = (el) => {
        if (!el) return false;
        el.click();
        return true;
    };
    const until = async (ok, ms = 8000) => {
        for (let waited = 0; waited < ms && !ok(); waited += 100) {
            await new Promise((r) => setTimeout(r, 100));
        }
        return !!ok();
    };
    const snapshot = () => {
        const d = detail();
        const list = d?.querySelector("[data-usage-list]");
        const rows = [...(list?.querySelectorAll("[data-usage-item]") ?? [])];
        // read off the stat card's own sub line: the detail's joined text runs the card's value into it
        const share = (of) => {
            const sub = [...(d?.querySelectorAll("div") ?? [])].find(
                (el) => el.childElementCount === 0 && text(el).includes(of)
            );
            return (text(sub).match(new RegExp("[\\\\d.<]+% " + of)) ?? [null])[0];
        };
        return {
            scope: d?.getAttribute("data-usage-detail") ?? null,
            lens:
                document.querySelector('[data-usage-lens][aria-pressed="true"]')?.getAttribute("data-usage-lens") ??
                null,
            title: text(d?.querySelector("h2")),
            sections: [...(d?.querySelectorAll("h3") ?? [])].map(text),
            list: list
                ? {
                      title: text(list.querySelector("h3")),
                      rows: rows.map((r) => r.getAttribute("data-usage-item")),
                      rowText: rows.map(text),
                      more: text(list.querySelector("[data-usage-more]")) || null,
                  }
                : null,
            split: [...(d?.querySelectorAll("[data-usage-split-part]") ?? [])].map((p) =>
                p.getAttribute("data-usage-split-part")
            ),
            back: text(d?.querySelector("[data-usage-back]")) || null,
            openRun: text(d?.querySelector("[data-usage-open-run]")) || null,
            shares: {
                usage: share("of all usage"),
                spend: share("of all spend"),
            },
            projects: [...document.querySelectorAll("[data-usage-project]")].map((b) => ({
                key: b.getAttribute("data-usage-project"),
                pressed: b.getAttribute("aria-pressed") === "true",
                text: text(b),
            })),
            other: text(document.querySelector("[data-usage-other]")) || null,
            harnesses: [...document.querySelectorAll("[data-usage-harness]")].map((b) =>
                b.getAttribute("data-usage-harness")
            ),
            window: text([...(surface()?.querySelectorAll("button[aria-pressed='true']") ?? [])].find((b) =>
                ["7 days", "All time"].includes(text(b))
            )) || null,
        };
    };
`;

// Runs `act` (an expression that is true once it clicked what it was after), waits for `ready` (an expression
// over the snapshot `s`), and returns the page as it then stands.
const usageWorkView = (h, act, ready) =>
    h.ev(`(async () => {
        ${USAGE_WORK_LIB}
        const clicked = ${act};
        const settled = await until(() => {
            const s = snapshot();
            return ${ready};
        });
        return { clicked, settled, ...snapshot() };
    })()`);
const usageWorkClick = (selector) => `press(document.querySelector(${JSON.stringify(selector)}))`;
const usageWorkScope = (scope) => `s.scope === ${JSON.stringify(scope)}`;

const usageWork = {
    name: "usage-work",
    surface: "usage",
    async arrange(h) {
        const ctx = { prevUsage: await h.ev(`localStorage.getItem('wave:dev-usage-buckets')`) };
        await h.ev(
            `localStorage.setItem('wave:dev-usage-buckets', ${JSON.stringify(JSON.stringify(buildUsageWorkFixture()))})`
        );
        // the lens, window and selection atoms are module state: a reload starts them at By provider, 7 days
        await h.ev("location.reload()");
        await h.ev(`(async () => {
            for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                await new Promise((r) => setTimeout(r, 500));
            }
        })()`);
        return ctx;
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const view = (act, ready) => usageWorkView(h, act, ready);
        const arcScope = `project:${USAGE_WORK_ARC}`;
        const openArc = () => view(usageWorkClick(`[data-usage-project="${USAGE_WORK_ARC}"]`), usageWorkScope(arcScope));
        const openRunPage = () =>
            view(usageWorkClick(`[data-usage-item="${USAGE_WORK_RUN_ITEM}"]`), usageWorkScope(USAGE_WORK_RUN_ITEM));
        const allUsage = () => view(usageWorkClick('[data-usage-harness="all"]'), `s.scope === "all" && s.list != null`);
        const brief = (s) =>
            JSON.stringify({ clicked: s.clicked, settled: s.settled, scope: s.scope, lens: s.lens, title: s.title });

        await h.cdp("Emulation.setDeviceMetricsOverride", OBS_WIDE);
        const loaded = await view("true", `s.lens === "provider" && s.split.length > 0`);
        rec(
            "0. the Usage surface loaded the fixture on the By provider lens",
            loaded.settled,
            JSON.stringify({ lens: loaded.lens, scope: loaded.scope, split: loaded.split })
        );

        const all = await view(usageWorkClick('[data-usage-lens="work"]'), `s.lens === "work" && s.list != null`);
        const railProjects = all.projects.map((p) => p.key);
        rec(
            "1a. By work lists the two projects above 1% of spend, each with a share pill, and an other-folders line",
            all.settled &&
                JSON.stringify(railProjects) === JSON.stringify([USAGE_WORK_ARC, USAGE_WORK_SIEM]) &&
                all.projects.every((p) => /\d%/.test(p.text)) &&
                /other folders? hold/.test(all.other ?? ""),
            JSON.stringify({ projects: all.projects, other: all.other })
        );
        rec(
            "1b. All usage has no Live limits, a Spent on list of eight rows, and a split by project",
            all.scope === "all" &&
                !all.sections.includes("Live limits") &&
                all.list?.title === "Spent on" &&
                all.list.rows.length === USAGE_WORK_COLLAPSED_ROWS &&
                JSON.stringify(all.split) === JSON.stringify([USAGE_WORK_ARC, USAGE_WORK_SIEM, "other"]),
            JSON.stringify({ scope: all.scope, sections: all.sections, list: all.list?.title, rows: all.list?.rows, split: all.split })
        );
        await h.shot("cdp-shots/usage-work-all.png");

        const more = usageWorkClick("[data-usage-detail] [data-usage-more]");
        const expanded = await view(more, `(s.list?.rows.length ?? 0) > ${USAGE_WORK_COLLAPSED_ROWS}`);
        await h.shot("cdp-shots/usage-work-expanded.png");
        const collapsed = await view(more, `s.list?.rows.length === ${USAGE_WORK_COLLAPSED_ROWS}`);
        rec(
            "2. the toggle expands the list past eight rows and collapses it again",
            expanded.clicked && expanded.settled && collapsed.clicked && collapsed.settled,
            JSON.stringify({
                before: all.list?.more,
                expandedRows: expanded.list?.rows.length,
                expandedLabel: expanded.list?.more,
                collapsedRows: collapsed.list?.rows.length,
                collapsedLabel: collapsed.list?.more,
            })
        );

        const project = await openArc();
        rec(
            "3. a project page has its header, its share of all usage and spend, Runs and sessions, and a split by kind",
            project.clicked &&
                project.settled &&
                project.title === "arc" &&
                project.shares.usage != null &&
                project.shares.spend != null &&
                project.list?.title === "Runs and sessions" &&
                JSON.stringify(project.split) === JSON.stringify(["orchestrator", "quick", "session"]),
            JSON.stringify({ title: project.title, shares: project.shares, list: project.list?.title, rows: project.list?.rows, split: project.split })
        );
        await h.shot("cdp-shots/usage-work-project.png");

        const run = await openRunPage();
        const roles = ["lead", "worker", "reviewer"];
        rec(
            "4. a run page has Back to its project, Open run, its sessions with their roles, and a split by role",
            run.clicked &&
                run.settled &&
                run.back === "Back to arc" &&
                run.openRun === "Open run" &&
                run.list?.title === "Sessions in this run" &&
                run.list.rows.length === 4 &&
                roles.every((r) => run.list.rowText.some((t) => t.includes(`${r} ·`))) &&
                roles.every((r) => run.split.includes(r)),
            JSON.stringify({ back: run.back, openRun: run.openRun, list: run.list, split: run.split })
        );
        await h.shot("cdp-shots/usage-work-run.png");

        const back = await view(
            usageWorkClick("[data-usage-detail] [data-usage-back]"),
            `${usageWorkScope(arcScope)} && s.list?.title === "Runs and sessions"`
        );
        rec(
            "5. Back returns to the project page with its list",
            back.clicked && back.settled && back.back == null,
            JSON.stringify({ scope: back.scope, list: back.list?.title, rows: back.list?.rows })
        );
        await h.shot("cdp-shots/usage-work-back.png");

        const allAgain = await allUsage();
        const session = await view(
            usageWorkClick(`[data-usage-item="${USAGE_WORK_SESSION_ITEM}"]`),
            usageWorkScope(USAGE_WORK_SESSION_ITEM)
        );
        rec(
            "6. a session page has no ranked list and no open button, and splits by token class",
            allAgain.settled &&
                session.clicked &&
                session.settled &&
                session.list == null &&
                session.openRun == null &&
                session.split.length > 0 &&
                session.split.every((k) => USAGE_WORK_CLASSES.includes(k)),
            JSON.stringify({ title: session.title, back: session.back, list: session.list, openRun: session.openRun, split: session.split })
        );
        await h.shot("cdp-shots/usage-work-session.png");

        // the unpriced session ranks last by estimate, so its row is past the first eight
        await allUsage();
        await view(more, `(s.list?.rows.length ?? 0) > ${USAGE_WORK_COLLAPSED_ROWS}`);
        const reported = await h.ev(`(() => {
            ${USAGE_WORK_LIB}
            const row = detail()?.querySelector(${JSON.stringify(`[data-usage-item="${USAGE_WORK_PI_ITEM}"]`)});
            if (!row) return null;
            row.scrollIntoView({ block: "center" });
            return { mark: text(row.querySelector("[data-usage-reported]")), row: text(row) };
        })()`);
        rec(
            "7. the unpriced pi session's row shows its reported cost, marked reported",
            reported?.mark === "reported" &&
                reported.row.includes(`$${USAGE_WORK_PI_COST}`) &&
                !reported.row.includes(`≈ $${USAGE_WORK_PI_COST}`),
            JSON.stringify(reported)
        );
        await h.shot("cdp-shots/usage-work-reported.png");

        const selected = await openArc();
        const allTime = await view(
            `press(windowButton("All time"))`,
            `s.window === "All time" && s.scope === "all" && s.list != null`
        );
        rec(
            "8. changing the window with a project selected returns By work to All usage",
            selected.settled &&
                selected.projects.some((p) => p.pressed) &&
                allTime.clicked &&
                allTime.settled &&
                allTime.lens === "work" &&
                allTime.projects.length > 0 &&
                allTime.projects.every((p) => !p.pressed),
            JSON.stringify({
                before: { scope: selected.scope, window: selected.window },
                after: { scope: allTime.scope, window: allTime.window, lens: allTime.lens, projects: allTime.projects.map((p) => [p.key, p.pressed]) },
            })
        );
        await h.shot("cdp-shots/usage-work-window-reset.png");
        const week = await view(`press(windowButton("7 days"))`, `s.window === "7 days" && s.list != null`);

        const provider = await view(
            usageWorkClick('[data-usage-lens="provider"]'),
            `s.lens === "provider" && s.sections.includes("Live limits")`
        );
        rec(
            "9. By provider restores the harness rail and the Live limits section",
            week.settled &&
                provider.clicked &&
                provider.settled &&
                ["all", "claude", "pi"].every((k) => provider.harnesses.includes(k)) &&
                provider.projects.length === 0 &&
                provider.list == null,
            JSON.stringify({ window: week.window, harnesses: provider.harnesses, sections: provider.sections, scope: provider.scope })
        );
        await h.shot("cdp-shots/usage-work-provider.png");

        // last, because it leaves the surface or raises the router's notice
        await view(usageWorkClick('[data-usage-lens="work"]'), `s.lens === "work" && s.list != null`);
        await openArc();
        const runPage = await openRunPage();
        const opened = await h.ev(`(async () => {
            ${USAGE_WORK_LIB}
            const errors = [];
            window.addEventListener("error", (e) => errors.push(String(e.message)));
            window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason?.message ?? e.reason)));
            const activeNav = () => {
                const b = [...document.querySelectorAll("nav button")].find((x) =>
                    (x.className || "").includes("text-accent-soft")
                );
                return b ? b.getAttribute("aria-label") || text(b) : null;
            };
            const toasts = () => [...document.querySelectorAll("[data-notification-toast]")].map(text);
            const from = activeNav();
            const clicked = press(detail()?.querySelector("[data-usage-open-run]"));
            const reached = await until(() => activeNav() !== from || toasts().length > 0);
            // an error thrown by the click's own handlers would have landed by now
            await new Promise((r) => setTimeout(r, 500));
            return { clicked, reached, from, surface: activeNav(), toasts: toasts(), errors };
        })()`);
        rec(
            "10. Open run goes through the router, which says the fixture's channel is gone, and nothing throws",
            runPage.settled &&
                opened.clicked &&
                opened.reached &&
                (opened.surface !== opened.from || opened.toasts.includes(USAGE_WORK_GONE)) &&
                opened.errors.length === 0,
            `${brief(runPage)} ${JSON.stringify(opened)}`
        );
        await h.shot("cdp-shots/usage-work-open-run.png");

        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(restoreLocalStorage("wave:dev-usage-buckets", ctx.prevUsage));
        await h.ev("location.reload()");
        await new Promise((r) => setTimeout(r, 2500));
        await h.goto("cockpit");
    },
};

// --- the review-gate blind spot ----------------------------------------------------------------
// The whole defect in three steps: hold a run's DAG at a gate in one channel, make a DIFFERENT channel
// the active subject, then walk away to Usage and read the Jarvis nav badge. Before the attention list
// moved server-side this read zero — the badge counted only live `asking` workers, and a gate has none
// (its task finished and it is waiting on a human), while the frontend's cross-channel list came from a
// channel snapshot refetched only on create/delete/rename/archive.
//
// The gate is seeded, not reached: a deferred orchestrator run (no lead) is given a two-task plan whose
// first task is gated, and once that task's worker has dispatched the stored DAG is written to
// awaiting-review with the task done and unreleased. The seeded task carries no child run id, so no later
// tick can re-derive its state from the worker, and a DAG parked with no task in flight is one the
// watchdog does not tick. A blocked DAG was the other choice; its failed task keeps a child run a tick
// can read. Teardown cancels the run and deletes the worker's block.
//
// The poll wait is a 500ms loop rather than a flat 10s sleep so the step is not flaky at the interval
// boundary, and so a stalled poller fails HERE — distinguishable from the badge assertion failing, which
// means detection broke. The two halves of this change fail differently and must stay tellable apart.
const ATTN_GATE_TASK = "t-1";
const ATTN_TASKS = [
    { id: ATTN_GATE_TASK, label: "gated noop", description: "do nothing, stop immediately", deps: [], gate: true, state: "" },
    { id: "t-2", label: "noop 2", description: "do nothing, stop immediately", deps: [ATTN_GATE_TASK], gate: false, state: "" },
];
const ATTN_DAG_STATUS = "awaiting-review";
const ATTN_KIND = "dag-gate";
// long enough for a tick that read the dag before the seed to have written it back
const ATTN_TICK_SETTLE_MS = 2000;

const attnParkAtGate = (dag) => ({
    ...dag,
    status: ATTN_DAG_STATUS,
    tasks: (dag.tasks ?? []).map((t) =>
        t.id === ATTN_GATE_TASK ? { ...t, state: "done", runid: "", released: false } : t
    ),
});
const attnGateFingerprint = (dag) =>
    JSON.stringify([dag?.status, (dag?.tasks ?? []).map((t) => [t.id, t.state, t.runid ?? "", t.released === true])]);

const attentionCrossChannel = {
    name: "attention-cross-channel",
    surface: "usage",
    async arrange(h) {
        const ctx = await arrangeSheetDagRun(h, "attn-probe", ATTN_TASKS);
        if (ctx.arrangeError != null) return ctx;
        try {
            // its own path: a second channel at the probe's path is the probe channel itself
            ctx.otherCwd = mkdtempSync(join(tmpdir(), "attn-other-"));
            const other = await h.rpc("createchannel", { name: "attn-other", projectpath: ctx.otherCwd });
            ctx.otherId = other.oid;
            // the dispatching tick holds the dag for as long as the spawn takes and would land over a seed made under it
            await waitForDispatch(h, ctx, ATTN_GATE_TASK);
            if (!ctx.dispatched) throw new Error(`${ATTN_GATE_TASK} did not dispatch in ${ctx.dispatchMs}ms`);
            ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.oid;
            if (!ctx.dagId) throw new Error("the run has no dag");
            await seedDag(h, ctx, attnParkAtGate, attnGateFingerprint);
            // a tick the worker's first events started can outlast the seed's own read-back, so it is seeded again
            await new Promise((r) => setTimeout(r, ATTN_TICK_SETTLE_MS));
            await seedDag(h, ctx, attnParkAtGate, attnGateFingerprint);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);

        // 1. the probe channel's run holds a dag at its gate, read back from the store
        const parkedStep = "1. the probe channel's run holds a DAG parked at its gate";
        if (ctx.arrangeError != null) {
            rec(parkedStep, false, ctx.arrangeError);
            return steps;
        }
        const runId = ctx.runId;
        const group = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: runId })).group;
        const gate = group?.tasks?.find((t) => t.id === ATTN_GATE_TASK);
        rec(
            parkedStep,
            group?.status === ATTN_DAG_STATUS && gate?.gate === true && gate?.state === "done" && gate?.released !== true,
            JSON.stringify({ status: group?.status, tasks: group?.tasks?.map((t) => [t.id, t.state, t.runid ?? ""]) })
        );

        // 2. the server reports it as a gate item — the backend half, asserted before any DOM reading so a
        // failure here is never mistaken for a delivery problem
        const attention = await h.rpc("getattention", null);
        const item = (attention.items || []).find((x) => x.runid === runId);
        rec(
            "2. GetAttention reports the gate with its channel and wait time",
            item != null && item.kind === ATTN_KIND && item.channelid === ctx.channelId && item.waitingsince > 0,
            JSON.stringify(item ?? { items: (attention.items || []).length })
        );

        // 3. a DIFFERENT channel is the active one, so the gate is in a non-active channel. Nothing in the
        // Brief selects a channel by hand: a load with no active channel takes the newest (loadChannels), and
        // attn-other was created after the probe.
        await h.ev("location.reload()");
        await settle(2500);
        await h.goto("jarvis");
        await settle(600);
        const newest = ((await h.rpc("getchannels", null))?.channels ?? [])[0]?.oid;
        rec(
            "3. a different channel is the active one",
            newest === ctx.otherId && ctx.otherId !== ctx.channelId,
            JSON.stringify({ newest, other: ctx.otherId, probe: ctx.channelId })
        );

        // 4. leave for a surface nowhere near Jarvis, then wait for one poll tick
        await h.goto("usage");
        await settle(400);
        const jarvisBadge = () =>
            h.ev(`(() => {
                const b = document.querySelector('nav button[aria-label="Jarvis"]');
                if (!b) return null;
                const s = [...b.querySelectorAll('span')].find((x) => /^\\d+$/.test((x.textContent || '').trim()));
                return s ? Number(s.textContent.trim()) : 0;
            })()`);
        let badge = await jarvisBadge();
        for (let i = 0; i < 30 && !(badge >= 1); i++) {
            await settle(500);
            badge = await jarvisBadge();
        }
        rec(
            "4. a poll delivered a non-empty attention list to the nav rail",
            typeof badge === "number" && badge >= 1,
            `badge=${JSON.stringify(badge)} (waited up to 15s for a 10s poll)`
        );

        // 5. the assertion the defect failed: the badge is lit from a surface that is not Jarvis, for a
        // gate in a channel that is not active
        const onUsage = await h.activeSurfaceLabel();
        rec(
            "5. the Jarvis badge counts a review gate in a non-active channel, read from Usage",
            onUsage === "Usage" && badge >= 1,
            `surface=${onUsage} badge=${badge}`
        );
        await h.shot("cdp-shots/attention-cross-channel.png");

        return steps;
    },
    async teardown(h, ctx) {
        // before the fixture run's teardown, which reloads onto the roster this channel must be gone from
        if (ctx.otherId) {
            try {
                await h.rpc("deletechannel", { channelid: ctx.otherId });
            } catch (e) {
                console.error(`attention-cross-channel teardown: delete attn-other failed: ${e?.message ?? e}`);
            }
        }
        if (ctx.otherCwd) rmSync(ctx.otherCwd, { recursive: true, force: true });
        await teardownFixtureRun(h, ctx, "attention-cross-channel");
    },
};

// --- attention-popup: a new waiting item, while Arc is unfocused, shows as a bubble in a window of its own ---
// (docs/superpowers/specs/2026-10-08-attention-desktop-popup.md). The popup is a second page target on the
// CDP port, reached with h.page. "The popup window is visible" is always the window plugin's is_visible read on
// the popup's own target: the card can sit in the DOM of a hidden webview.
//
// The gates are seeded the way attention-cross-channel seeds its one. Arc is made to look unfocused by
// overriding document.hasFocus on the main page, which is what the poller reads (attentionpoller.tsx); the
// override is installed for new documents before the reload, so the reloaded poller's first load sees it too.
// Each item is raised just after one of the page's own polls has landed, so it is new in the poll after it and
// the seed has the whole interval to settle.
const POPUP_URL = "popup.html";
const POPUP_LABEL = "attention-popup";
const POPUP_CARD = `document.querySelector("button[data-attention-popup]")`;
// BUBBLE_MS in frontend/app/view/jarvis/bubblecard.tsx: how long a bubble stays up
const POPUP_BUBBLE_MS = 6000;
const POPUP_LEAVE_SLACK_MS = 3000;
// POPUP_MARGIN in frontend/app/view/agents/attentionpopup.ts, in logical px
const POPUP_MARGIN = 16;
// physical px: the popup rounds its size and its position to the scale factor
const POPUP_EDGE_TOLERANCE = 2;
// one 10s poll and room for it to land
const POPUP_RAISE_WAIT_MS = 15_000;
const POPUP_OPEN_WAIT_MS = 5000;
const POPUP_HIDE_WAIT_MS = 3000;
const POPUP_FOCUS_HIDE_MS = 2000;
const POPUP_QUIET_MS = 12_000;
const POPUP_TASK_IDS = ["t-1", "t-2", "t-3", "t-4"];
const POPUP_TASKS = POPUP_TASK_IDS.map((id, i) => ({
    id,
    label: `gated noop ${i + 1}`,
    description: "do nothing, stop immediately",
    deps: [],
    gate: true,
    state: "",
}));
const POPUP_QUESTION = "Which port should the popup probe use?";
const POPUP_FLASH_REFUSED = /request_user_attention|not allowed|Permissions associated/i;

const popupSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const popupPark = (ids) => (dag) => ({
    ...dag,
    status: ATTN_DAG_STATUS,
    tasks: (dag.tasks ?? []).map((t) => (ids.includes(t.id) ? { ...t, state: "done", runid: "", released: false } : t)),
});

// runs in every new document of the main page: Arc reads as unfocused, and what the page logs as an error is
// kept. fireAndForget (frontend/util/util.ts) reports a refused window call through console.log.
const POPUP_UNFOCUS_SCRIPT = `(() => {
    document.hasFocus = () => false;
    window.__popupErrors = [];
    const text = (a) => {
        if (a instanceof Error) return a.message;
        if (typeof a === "string") return a;
        try {
            return JSON.stringify(a);
        } catch {
            return String(a);
        }
    };
    const keep = (line) => window.__popupErrors.push(line.slice(0, 400));
    for (const level of ["error", "log"]) {
        const write = console[level].bind(console);
        console[level] = (...args) => {
            if (level === "error" || args[0] === "fireAndForget error") keep(args.map(text).join(" "));
            write(...args);
        };
    }
    window.addEventListener("unhandledrejection", (e) => keep("unhandledrejection " + text(e.reason)));
})()`;

// counts the page's own attention polls and keeps the keys of the last one. The poller passes no opts and the
// harness's h.rpc always passes an object, which is how the two are told apart.
const POPUP_COUNT_POLLS = `(() => {
    const c = window.TabRpcClient;
    if (!c) return false;
    if (c.__popupCounted) return true;
    const call = c.wshRpcCall.bind(c);
    window.__popupPolls = 0;
    c.wshRpcCall = (command, data, opts) => {
        const p = call(command, data, opts);
        if (command === "getattention" && opts == null) {
            p.then(
                (r) => {
                    window.__popupPolled = (r?.items ?? []).map((i) => i.key);
                    window.__popupPolls++;
                },
                () => {}
            );
        }
        return p;
    };
    c.__popupCounted = true;
    return true;
})()`;

// the keys the page's next poll delivered, once the poller has acted on them; null when none landed
const popupNextPoll = (h) =>
    h.ev(`(async () => {
        const from = window.__popupPolls;
        if (typeof from !== "number") return null;
        for (let i = 0; i < 56 && window.__popupPolls === from; i++) await new Promise((r) => setTimeout(r, 250));
        if (window.__popupPolls === from) return null;
        await new Promise((r) => setTimeout(r, 300));
        return window.__popupPolled;
    })()`);

const POPUP_STATE = `(async () => ({
    card: ${POPUP_CARD} != null,
    visible: await window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: ${JSON.stringify(POPUP_LABEL)} }),
}))()`;

// everything steps 3 and 4 judge, in one read: the bubble is up for BUBBLE_MS only
const POPUP_DETAIL = `(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const label = ${JSON.stringify(POPUP_LABEL)};
    const card = ${POPUP_CARD};
    const [visible, position, size, monitor] = await Promise.all([
        invoke("plugin:window|is_visible", { label }),
        invoke("plugin:window|outer_position", { label }),
        invoke("plugin:window|outer_size", { label }),
        invoke("plugin:window|primary_monitor"),
    ]);
    const text = (el) => (el ? (el.textContent || "").trim() : null);
    // the card's label and text lines carry no marker of their own: they are its unmarked children, in that order
    const plain = card
        ? [...card.children].filter(
              (c) => !c.hasAttribute("data-attention-popup-agent") && !c.hasAttribute("data-attention-popup-more")
          )
        : [];
    const name = card?.querySelector("[data-attention-popup-agent-name]");
    return {
        card: card != null,
        visible,
        hasFocus: document.hasFocus(),
        position,
        size,
        monitor,
        label: text(plain[0]),
        name: text(name),
        text: text(plain[1]),
        more: text(card?.querySelector("[data-attention-popup-more]")),
        background: card ? getComputedStyle(card.parentElement).backgroundColor : null,
        color: name ? getComputedStyle(name).color : null,
    };
})()`;

const popupShown = (s) => s.card === true && s.visible === true;
const popupGone = (s) => s.card === false && s.visible === false;

// polls the popup's own target until its state satisfies want; the last state read, whether it did, and the wait
async function popupUntil(popup, want, ms) {
    const start = Date.now();
    let state;
    do {
        state = await popup.ev(POPUP_STATE).catch((e) => ({ error: String(e?.message ?? e) }));
        if (want(state)) return { ...state, ok: true, ms: Date.now() - start };
        await popupSleep(150);
    } while (Date.now() - start < ms);
    return { ...state, ok: false, ms: Date.now() - start };
}

// how far, in physical px, the window's right and bottom edges are from where the 16px rule puts them
function popupEdgeError(d) {
    const scale = d?.monitor?.scaleFactor;
    const area = d?.monitor?.workArea;
    if (!scale || !area || !d.position || !d.size) return null;
    return {
        right: area.position.x + area.size.width - (d.position.x + d.size.width) - POPUP_MARGIN * scale,
        bottom: area.position.y + area.size.height - (d.position.y + d.size.height) - POPUP_MARGIN * scale,
    };
}

const popupRunItems = async (h, ctx) =>
    ((await h.rpc("getattention", null)).items || []).filter((i) => i.runid === ctx.runId && i.kind === ATTN_KIND);

// the block of the fixture run's one dispatched worker. Its tab is read as an object: no wshrpc command returns a tab.
async function popupWorkerBlock(h, ctx) {
    ctx.workerSeen = [];
    for (const run of await channelRuns(h, ctx.channelId)) {
        for (const phase of run.phases || []) {
            for (const oref of phase.workerorefs || []) {
                const tab = await waveService(h, "object", "GetObject", [oref]).catch((e) => ({
                    error: String(e?.message ?? e),
                }));
                ctx.workerSeen.push({ run: run.id, oref, blockids: tab?.blockids, error: tab?.error });
                if (tab?.blockids?.[0]) return tab.blockids[0];
            }
        }
    }
    return null;
}

const POPUP_MAIN_STATE = `(async () => ({
    sheet: document.querySelector('[data-jarvis-brief-sheet] > header [data-run-id]')?.getAttribute('data-run-id') ?? null,
    focused: await window.__TAURI_INTERNALS__.invoke("plugin:window|is_focused", { label: "main" }),
}))()`;

const attentionPopup = {
    name: "attention-popup",
    surface: "usage",
    async arrange(h) {
        const ctx = await arrangeSheetDagRun(h, "attention-popup", POPUP_TASKS);
        if (ctx.arrangeError != null) return ctx;
        try {
            // the dispatching tick holds the dag for as long as the spawn takes and would land over a seed made under it
            await waitForDispatch(h, ctx, POPUP_TASK_IDS[0]);
            if (!ctx.dispatched) throw new Error(`${POPUP_TASK_IDS[0]} did not dispatch in ${ctx.dispatchMs}ms`);
            ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.oid;
            if (!ctx.dagId) throw new Error("the run has no dag");
            // the worker's tab can trail the task's run id
            for (let i = 0; i < 20 && !ctx.workerBlockId; i++) {
                ctx.workerBlockId = await popupWorkerBlock(h, ctx);
                if (!ctx.workerBlockId) await popupSleep(500);
            }
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const [first, second, third, fourth] = POPUP_TASK_IDS;

        const builtStep = "1. a run holds a DAG of four gated tasks with no dependencies, its first one dispatched";
        if (ctx.arrangeError != null) {
            rec(builtStep, false, ctx.arrangeError);
            return steps;
        }
        const built = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
        rec(
            builtStep,
            built?.tasks?.length === POPUP_TASKS.length &&
                built.tasks.every((t) => t.gate === true && (t.deps ?? []).length === 0) &&
                ctx.dispatched === true,
            JSON.stringify({ dispatchMs: ctx.dispatchMs, tasks: built?.tasks?.map((t) => [t.id, t.gate, t.state]) })
        );

        // 2. unfocused from the reloaded page's first load on, then the first gate, parked after a poll has landed
        const raisedStep = "2. with the main page reporting no focus, a poll raises the popup for the first gate";
        let popup;
        try {
            popup = ctx.popup = await h.page(POPUP_URL);
        } catch (e) {
            rec(raisedStep, false, String(e?.message ?? e));
            return steps;
        }
        ctx.unfocusScript = (
            await h.cdp("Page.addScriptToEvaluateOnNewDocument", { source: POPUP_UNFOCUS_SCRIPT })
        ).identifier;
        await h.ev("location.reload()");
        let counting = false;
        for (let i = 0; i < 120 && !counting; i++) {
            // the reload destroys the execution context, which is not an answer either way
            counting = await h
                .ev(`!!document.querySelector("nav button") && ${POPUP_COUNT_POLLS}`)
                .catch(() => false);
            if (!counting) await popupSleep(250);
        }
        await h.goto("usage");
        const settled = await popupNextPoll(h);
        // a vite fallback serves the cockpit's index.html at any path, so the url alone does not say which page loaded
        const page = await popup.ev(`({
            cockpit: !!document.querySelector("nav button"),
            entry: !!document.querySelector('script[src*="popup"]'),
            card: ${POPUP_CARD} != null,
        })`);
        const before = { surface: await h.activeSurfaceLabel(), ...(await h.ev(POPUP_MAIN_STATE)) };
        const unfocused = await h.ev("document.hasFocus()");
        await seedDag(h, ctx, popupPark([first]), attnGateFingerprint);
        // a tick the worker's first events started can outlast the seed's own read-back, so it is seeded again
        await popupSleep(ATTN_TICK_SETTLE_MS);
        await seedDag(h, ctx, popupPark([first]), attnGateFingerprint);
        const raised = await popupUntil(popup, popupShown, POPUP_RAISE_WAIT_MS);

        // steps 3 to 5 read and click inside the bubble's lifetime, and are judged after
        let gate = null;
        if (raised.ok) {
            await popup.shot("cdp-shots/attention-popup-gate.png");
            gate = await popup.ev(POPUP_DETAIL);
            await popup.ev(`${POPUP_CARD}?.click()`);
        }
        const clickedAt = Date.now();
        const gateItem = (await popupRunItems(h, ctx)).find((i) => i.taskid === first);
        rec(
            raisedStep,
            counting &&
                Array.isArray(settled) &&
                gateItem != null &&
                !settled.includes(gateItem.key) &&
                unfocused === false &&
                page.cockpit === false &&
                page.entry === true &&
                page.card === false &&
                raised.ok,
            JSON.stringify({ counting, settledPoll: settled, gate: gateItem?.key, unfocused, page, raised })
        );
        if (!raised.ok) return steps;

        const edges = popupEdgeError(gate);
        rec(
            "3. the popup reads Review, the run's source and the gate's text, themed, 16px inside the work area's corner",
            gate.label === "Review" &&
                gate.name === gateItem?.source &&
                gate.text === gateItem?.text &&
                gate.text.includes(POPUP_TASKS[0].label) &&
                gate.more === null &&
                !["rgba(0, 0, 0, 0)", "transparent", null].includes(gate.background) &&
                !["rgb(0, 0, 0)", null].includes(gate.color) &&
                edges != null &&
                Math.abs(edges.right) <= POPUP_EDGE_TOLERANCE &&
                Math.abs(edges.bottom) <= POPUP_EDGE_TOLERANCE,
            JSON.stringify({
                label: gate.label,
                name: gate.name,
                text: gate.text,
                more: gate.more,
                background: gate.background,
                color: gate.color,
                edgeErrorPx: edges,
                position: gate.position,
                size: gate.size,
                workArea: gate.monitor?.workArea,
                scale: gate.monitor?.scaleFactor,
            })
        );
        rec(
            "4. the popup did not take focus while it was showing",
            gate.visible === true && gate.card === true && gate.hasFocus === false,
            JSON.stringify({ visible: gate.visible, hasFocus: gate.hasFocus })
        );

        let landed;
        do {
            landed = { surface: await h.activeSurfaceLabel(), ...(await h.ev(POPUP_MAIN_STATE)) };
            if (landed.surface === SURFACE_LABEL.jarvis && landed.sheet === ctx.runId && landed.focused === true) break;
            await popupSleep(200);
        } while (Date.now() - clickedAt < POPUP_OPEN_WAIT_MS);
        rec(
            "5. a click on the card opens the run's sheet on Jarvis and brings the main window forward",
            before.surface === SURFACE_LABEL.usage &&
                before.sheet !== ctx.runId &&
                landed.surface === SURFACE_LABEL.jarvis &&
                landed.sheet === ctx.runId &&
                landed.focused === true,
            JSON.stringify({ before, landed, runId: ctx.runId })
        );

        const closed = await popupUntil(popup, popupGone, POPUP_HIDE_WAIT_MS);
        rec("6. after the click the popup holds no card and its window is hidden", closed.ok, JSON.stringify(closed));

        // 7. the override is still on this document: no reload since step 2. Two gates new in one poll make one bubble.
        const stillUnfocused = await h.ev("document.hasFocus()");
        await popupNextPoll(h);
        await seedDag(h, ctx, popupPark([first, second, third]), attnGateFingerprint);
        const more = await popupUntil(popup, popupShown, POPUP_RAISE_WAIT_MS);
        const moreAt = Date.now();
        let moreCard = null;
        if (more.ok) {
            await popup.shot("cdp-shots/attention-popup-more.png");
            moreCard = await popup.ev(POPUP_DETAIL);
        }
        // the list is in rank order, so the first of the two is the one the bubble names
        const fresh = (await popupRunItems(h, ctx)).filter((i) => [second, third].includes(i.taskid));
        rec(
            "7. two gates new in one poll raise one popup naming the first, with +1 more waiting",
            stillUnfocused === false &&
                more.ok &&
                fresh.length === 2 &&
                moreCard?.label === "Review" &&
                moreCard?.text === fresh[0].text &&
                moreCard?.more === "+1 more waiting" &&
                moreCard?.visible === true,
            JSON.stringify({
                unfocused: stillUnfocused,
                raised: more,
                first: fresh[0]?.text,
                card: moreCard && { label: moreCard.label, text: moreCard.text, more: moreCard.more },
            })
        );

        const leaveBy = POPUP_BUBBLE_MS + POPUP_LEAVE_SLACK_MS;
        const left = more.ok
            ? await popupUntil(popup, popupGone, Math.max(0, moreAt + leaveBy - Date.now()))
            : { ok: false, why: "no popup to leave" };
        rec(
            "8. with nothing clicked, the popup leaves by itself within BUBBLE_MS plus 3s",
            left.ok,
            JSON.stringify({ ...left, sinceShownMs: Date.now() - moreAt, limitMs: leaveBy })
        );

        // 9 and 10. an ask on the fixture run's worker block; Arc gaining focus hides the bubble well inside BUBBLE_MS
        const askStep = "9. an ask raises a popup reading Asking you, the worker's name and the question";
        const focusStep = "10. the popup leaves when Arc gains focus";
        if (!ctx.workerBlockId) {
            rec(askStep, false, `the fixture run has no worker block to raise an ask on: ${JSON.stringify(ctx.workerSeen)}`);
            rec(focusStep, false, "no popup to hide");
        } else {
            const askORef = `block:${ctx.workerBlockId}`;
            await popupNextPoll(h);
            await h.rpc("ask", {
                oref: askORef,
                questions: [{ header: "Port", question: POPUP_QUESTION, options: [{ label: "9222" }, { label: "9223" }] }],
            });
            ctx.askORef = askORef;
            const asked = await popupUntil(popup, popupShown, POPUP_RAISE_WAIT_MS);
            const askedAt = Date.now();
            let askCard = null;
            let hidden = { ok: false, why: "no popup to hide" };
            if (asked.ok) {
                await popup.shot("cdp-shots/attention-popup-ask.png");
                askCard = await popup.ev(POPUP_DETAIL);
                await h.ev(`window.dispatchEvent(new Event("focus"))`);
                hidden = await popupUntil(popup, popupGone, POPUP_FOCUS_HIDE_MS);
            }
            const sinceShownMs = Date.now() - askedAt;
            const askItem = ((await h.rpc("getattention", null)).items || []).find((i) => i.key === `ask:${askORef}`);
            rec(
                askStep,
                asked.ok &&
                    askItem?.kind === "ask" &&
                    askCard?.label === "Asking you" &&
                    askCard?.name === askItem.source &&
                    askCard?.text === askItem.text &&
                    askCard?.text.includes(POPUP_QUESTION) &&
                    askCard?.more === null,
                JSON.stringify({
                    raised: asked,
                    item: askItem && { kind: askItem.kind, source: askItem.source, text: askItem.text },
                    card: askCard && { label: askCard.label, name: askCard.name, text: askCard.text, more: askCard.more },
                })
            );
            rec(
                focusStep,
                hidden.ok && sinceShownMs < POPUP_BUBBLE_MS,
                JSON.stringify({ ...hidden, sinceShownMs, bubbleMs: POPUP_BUBBLE_MS })
            );
        }

        // 11. focused again, a new item raises nothing
        await h.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: ctx.unfocusScript });
        ctx.unfocusScript = null;
        await h.ev("delete document.hasFocus");
        let focused = await h.ev("document.hasFocus()");
        if (!focused) {
            // the dev app's window is behind another under the harness
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            ctx.focusEmulated = true;
            focused = await h.ev("document.hasFocus()");
        }
        await popupNextPoll(h);
        await seedDag(h, ctx, popupPark(POPUP_TASK_IDS), attnGateFingerprint);
        let reported = false;
        for (let i = 0; i < 20 && !reported; i++) {
            reported = (await popupRunItems(h, ctx)).some((item) => item.taskid === fourth);
            if (!reported) await popupSleep(500);
        }
        const quietFrom = Date.now();
        let noise = null;
        while (noise == null && Date.now() - quietFrom < POPUP_QUIET_MS) {
            const s = await popup.ev(POPUP_STATE);
            if (s.card || s.visible) noise = { ...s, afterMs: Date.now() - quietFrom };
            else await popupSleep(500);
        }
        rec(
            "11. with Arc focused, a new gate raises no popup within one poll",
            focused === true && reported && noise == null,
            JSON.stringify({ focused, emulated: ctx.focusEmulated === true, reported, noise, watchedMs: Date.now() - quietFrom })
        );
        if (ctx.focusEmulated) {
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
            ctx.focusEmulated = false;
        }

        // 12. the flash shares the popup's condition, so every popup above also asked for one
        const errors = (await h.ev("window.__popupErrors")) ?? null;
        const refused = (errors ?? []).filter((line) => POPUP_FLASH_REFUSED.test(line));
        const direct = await h.ev(`(async () => {
            const invoke = window.__TAURI_INTERNALS__.invoke;
            try {
                await invoke("plugin:window|request_user_attention", { label: "main", value: { type: "Informational" } });
                await invoke("plugin:window|request_user_attention", { label: "main", value: null });
                return "accepted";
            } catch (e) {
                return "refused: " + String(e?.message ?? e);
            }
        })()`);
        rec(
            "12. the taskbar flash request is accepted in the dev app",
            Array.isArray(errors) && refused.length === 0 && direct === "accepted",
            `CDP cannot see the taskbar button itself: this checks only that the request is accepted. ${JSON.stringify({
                direct,
                refused,
                pageErrors: errors?.length ?? null,
            })}`
        );
        return steps;
    },
    async teardown(h, ctx) {
        const undo = [
            [
                "restore document.hasFocus",
                async () => {
                    if (ctx.unfocusScript) {
                        await h.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: ctx.unfocusScript });
                    }
                    await h.ev("delete document.hasFocus");
                },
            ],
            [
                "turn focus emulation off",
                () => ctx.focusEmulated && h.cdp("Emulation.setFocusEmulationEnabled", { enabled: false }),
            ],
            ["clear the ask", () => ctx.askORef && h.rpc("agentaskclear", ctx.askORef)],
            // the app's own hide: the main window gaining focus
            ["hide the popup", () => h.ev(`window.dispatchEvent(new Event("focus"))`)],
            ["close the popup's session", () => ctx.popup?.close()],
            // the worker holds the temp dir open until its block goes
            ["delete the worker's block", () => ctx.workerBlockId && h.rpc("deleteblock", { blockid: ctx.workerBlockId })],
        ];
        for (const [what, fn] of undo) {
            try {
                await fn();
            } catch (e) {
                console.error(`attention-popup teardown: ${what} failed: ${e?.message ?? e}`);
            }
        }
        await teardownFixtureRun(h, ctx, "attention-popup");
    },
};

// The Cockpit's "need you" count leaves out an ask Jarvis already answered, and the answer card can sit in any
// channel: the count reads every channel's messages (channelMessagesAtom), not the active channel's. A fixture
// roster holds the one asking agent; the card is posted into the older of two channels, the one a load never
// selects.
const NEEDS_YOU_AGENT_ID = "fx-needs-you";
const NEEDS_YOU_ASK_ID = "fx-needs-you-ask";

const cockpitNeedsYouCrossChannel = {
    name: "cockpit-needs-you-cross-channel",
    surface: "cockpit",
    async arrange(h) {
        const ctx = { channelIds: [], cwds: [] };
        try {
            for (const name of ["needs-you-answered", "needs-you-newest"]) {
                const cwd = mkdtempSync(join(tmpdir(), `${name}-`));
                ctx.cwds.push(cwd);
                ctx.channelIds.push((await h.rpc("createchannel", { name, projectpath: cwd })).oid);
            }
            mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
            writeFileSync(
                TREE_RAIL_FIXTURE,
                JSON.stringify(
                    [
                        {
                            id: NEEDS_YOU_AGENT_ID,
                            name: "needs-you worker",
                            project: "waveterm",
                            task: "wait on an answer",
                            state: "asking",
                            agent: "claude",
                            model: "opus",
                            blockedMs: 60_000,
                            blockId: "fx-blk-needs-you",
                            ask: {
                                askId: NEEDS_YOU_ASK_ID,
                                oref: "block:fx-blk-needs-you",
                                questions: [
                                    { header: "Port", question: "Which port?", options: [{ label: "9222" }, { label: "9223" }] },
                                ],
                            },
                        },
                    ],
                    null,
                    2
                )
            );
            ctx.wroteFixture = true;
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const openStep = "1. the Cockpit counts the fixture's asking agent as needing you";
        if (ctx.arrangeError != null) {
            rec(openStep, false, ctx.arrangeError);
            return steps;
        }
        // the header's count, read off the words beside it; null while the header is not there
        const needYou = () =>
            h.ev(`(() => {
                const s = [...document.querySelectorAll('span')].find((x) => /^\\s*\\d+\\s*need you\\s*$/.test(x.textContent || ''));
                return s ? Number(s.textContent.match(/\\d+/)[0]) : null;
            })()`);
        const reloadToCockpit = async () => {
            await h.ev("location.reload()");
            await settle(2500);
            await h.goto("cockpit");
            await settle(800);
        };

        await reloadToCockpit();
        const before = await needYou();
        rec(openStep, before === 1, `need you=${JSON.stringify(before)}`);

        // 2. the answer card goes into the older channel; the newest is the one a load would select
        const [answeredIn, newest] = ctx.channelIds;
        const listed = ((await h.rpc("getchannels", null))?.channels ?? []).sort((a, b) => b.createdts - a.createdts);
        const posted = await h.rpc("postchannelmessage", {
            channelid: answeredIn,
            kind: "jarvis-answered",
            author: "jarvis",
            text: 'Answered → "9222"',
            // the fields a card must carry to be read as one (parseCardData)
            data: JSON.stringify({
                askId: NEEDS_YOU_ASK_ID,
                askORef: "block:fx-blk-needs-you",
                question: "Which port?",
                options: [{ label: "9222" }, { label: "9223" }],
                choice: 0,
            }),
        });
        rec(
            "2. Jarvis's answer card is stored in a channel that is not the newest",
            posted?.kind === "jarvis-answered" && listed[0]?.oid === newest && answeredIn !== newest,
            JSON.stringify({ posted: posted?.oid, answeredIn, newest: listed[0]?.oid })
        );

        // 3. the agent is still asking, and the count drops: the card was read from a channel nothing selected
        await reloadToCockpit();
        const after = await needYou();
        rec("3. the answered ask no longer counts as needing you", after === 0, `need you=${JSON.stringify(after)}`);
        await h.shot("cdp-shots/cockpit-needs-you-cross-channel.png");
        return steps;
    },
    async teardown(h, ctx) {
        if (ctx.wroteFixture) rmSync(TREE_RAIL_FIXTURE, { force: true });
        for (const id of ctx.channelIds) {
            try {
                await h.rpc("deletechannel", { channelid: id });
            } catch (e) {
                console.error(`cockpit-needs-you-cross-channel teardown: delete ${id} failed: ${e?.message ?? e}`);
            }
        }
        for (const cwd of ctx.cwds) rmSync(cwd, { recursive: true, force: true });
        // onto the live roster again, and settled: the next scenario's first act is a nav click
        await h.ev("location.reload()");
        await h.ev("new Promise((r) => setTimeout(r, 2500))");
    },
};

// --- git history: filters, paging, the two repository-failure panels, persistence ----------------
// Every state is arranged for real — globalStore is not on window, so nothing can be injected. The
// broken repo is a genuine failure: its ref file resolves but the object it names is gone, so
// `git log` fails while the directory is still a work tree.
const git = (dir, ...args) =>
    execFileSync("git", ["-C", dir, ...args], {
        stdio: "pipe",
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: "dana k",
            GIT_AUTHOR_EMAIL: "dana@example.com",
            GIT_COMMITTER_NAME: "dana k",
            GIT_COMMITTER_EMAIL: "dana@example.com",
        },
    });

const gitHistory = {
    name: "git-history",
    surface: "files",
    async arrange(h) {
        const good = mkdtempSync(join(tmpdir(), "verify-git-good-"));
        git(good, "init", "-q", "--initial-branch=main");
        writeFileSync(join(good, "refunds.txt"), "refunds\n");
        git(good, "add", ".");
        git(good, "commit", "-q", "-m", "split refund path from capture path");
        // 60 empty commits so the second page has something in it (page size is 50)
        for (let i = 0; i < 60; i++) {
            git(good, "commit", "-q", "--allow-empty", "-m", `filler commit ${i}`);
        }

        const broken = mkdtempSync(join(tmpdir(), "verify-git-broken-"));
        git(broken, "init", "-q", "--initial-branch=main");
        git(broken, "commit", "-q", "--allow-empty", "-m", "only commit");
        // Emptied, not removed: without an objects directory git stops recognising the place as a
        // repository at all ("fatal: not a git repository"), which is the calm not-a-repo state, not
        // the failure one. Keeping the directory and dropping its contents leaves a repo git still
        // recognises but can no longer read — `git log` exits 128 with "fatal: bad object HEAD" while
        // HEAD itself still resolves, which is what tells a broken read from an unborn branch.
        rmSync(join(broken, ".git", "objects"), { recursive: true, force: true });
        mkdirSync(join(broken, ".git", "objects"));

        const notRepo = mkdtempSync(join(tmpdir(), "verify-git-plain-"));

        const names = { good: "verify-git-good", broken: "verify-git-broken", notRepo: "verify-git-plain" };
        await h.rpc("createproject", { name: names.good, path: good });
        await h.rpc("createproject", { name: names.broken, path: broken });
        await h.rpc("createproject", { name: names.notRepo, path: notRepo });
        return { dirs: [good, broken, notRepo], names };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const pick = async (name) => {
            await h.ev(`document.querySelector('[data-files-source-picker]').click()`);
            await sleep(150);
            const ok = await h.ev(
                `(() => { const b = document.querySelector('[data-files-source-option=${JSON.stringify(name)}]');
                  if (!b) return false; b.click(); return true; })()`
            );
            if (!ok) throw new Error(`source option "${name}" not in the picker`);
            await sleep(1200); // change list + history page
        };
        const rowCount = () => h.ev(`document.querySelectorAll('[data-history-row]').length`);
        const text = (sel) => h.ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').trim()`);
        const present = (sel) => h.ev(`!!document.querySelector(${JSON.stringify(sel)})`);

        await pick(ctx.names.good);
        const first = await rowCount();
        const gutter = await present("[data-graph-gutter]");
        rec(
            "1. history populated: a full page of rows, graph gutter drawn",
            first === 50 && gutter,
            `rows=${first} gutter=${gutter}`
        );
        await h.shot("cdp-shots/git-history-populated.png");

        // paging: scrolling to the bottom appends the next page
        await h.ev(
            `(() => { const el = document.querySelector('[data-history-scroll]'); el.scrollTop = el.scrollHeight; })()`
        );
        await sleep(1500);
        const paged = await rowCount();
        rec("2. scrolling to the bottom appends a second page", paged > first, `rows=${first} -> ${paged}`);

        // filtering: real text into the real field, via a real input event
        await h.ev(`document.querySelector('[data-history-filter]').focus()`);
        await h.cdp("Input.insertText", { text: "refund" });
        await sleep(1200);
        const filtered = await rowCount();
        const countChip = await text("[data-filter-count]");
        const gutterStillThere = await present("[data-graph-gutter]");
        rec(
            "3. filter narrows the list, states the matching count, and hides the graph",
            filtered > 0 && filtered < first && countChip.includes("matching") && !gutterStillThere,
            `rows=${filtered} chip="${countChip}" gutterStillThere=${gutterStillThere}`
        );
        await h.shot("cdp-shots/git-history-filtered.png");

        // Escape clears the filters (the header says "Clear filters" with an esc hint), not navigate home
        await h.ev(`document.querySelector('[data-history-filter]').blur()`);
        await h.cdp("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
        });
        await h.cdp("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
        });
        await sleep(1200);
        const cleared = await rowCount();
        const stillHere = (await h.activeSurfaceLabel()) === SURFACE_LABEL.files;
        rec(
            "4. Escape clears the filters and stays on the surface",
            cleared === 50 && stillHere,
            `rows=${cleared} onSurface=${stillHere}`
        );

        // persistence: leave the surface and come back
        await h.ev(`(() => { const el = document.querySelector('[data-history-scroll]'); el.scrollTop = 300; })()`);
        await sleep(400);
        const before = await text("[data-history-scroll] [data-history-row]:nth-child(1)");
        await h.goto("cockpit");
        await h.goto("files");
        await sleep(1200);
        const scrollBack = await h.ev(`document.querySelector('[data-history-scroll]').scrollTop`);
        const after = await text("[data-history-scroll] [data-history-row]:nth-child(1)");
        rec(
            "5. returning restores the scroll offset and the same top row",
            scrollBack > 0 && after === before,
            `scrollTop=${scrollBack}`
        );

        // The range strip. A chip is drawn only when it has something to switch to: a project has no
        // session and no run, so exactly two ranges apply. The bar this replaced drew three chips
        // regardless of context, two of them permanently inert.
        const chips = await h.ev(
            `Array.from(document.querySelectorAll('[data-range-chip]')).map(e => e.dataset.rangeChip + ':' + (e.disabled ? 'off' : 'on')).join(',')`
        );
        rec("6. a project draws exactly two range chips, both live", chips === "working:on,compare:on", chips);

        // Every chip drawn must be operable — the whole point of the change.
        const deadChips = await h.ev(
            `Array.from(document.querySelectorAll('[data-range-chip]')).filter(e => !e.disabled && e.offsetParent === null).length`
        );
        rec("7. no chip is drawn enabled but invisible", deadChips === 0, `hiddenButEnabled=${deadChips}`);

        // Switching range is a chip click, it restates the read in words, and the reader keeps their
        // place across it: the history read is keyed on directory and filters, so a range change costs
        // one change-list call and zero history calls.
        await h.ev(`(() => { const el = document.querySelector('[data-history-scroll]'); el.scrollTop = 900; })()`);
        await sleep(400);
        const scrollBeforeRange = await h.ev(`document.querySelector('[data-history-scroll]').scrollTop`);
        const summaryWorking = await text("[data-files-range-summary]");
        await h.ev(`document.querySelector('[data-range-chip="compare"]').click()`);
        await sleep(1800);
        const summaryCompare = await text("[data-files-range-summary]");
        const comparingNow = await present("[data-compare-column]");
        await h.ev(`document.querySelector('[data-range-chip="working"]').click()`);
        await sleep(1800);
        const summaryBack = await text("[data-files-range-summary]");
        const scrollAfterRange = await h.ev(`document.querySelector('[data-history-scroll]').scrollTop`);
        rec(
            "8. the chips switch the read, say so in words, and keep the reader's place",
            summaryWorking.length > 0 &&
                comparingNow &&
                summaryCompare !== summaryWorking &&
                summaryBack === summaryWorking &&
                scrollAfterRange === scrollBeforeRange,
            `working="${summaryWorking}" compare="${summaryCompare}" back="${summaryBack}" scroll=${scrollBeforeRange} -> ${scrollAfterRange}`
        );

        await pick(ctx.names.notRepo);
        const calm = await present("[data-not-a-repo]");
        const noFailure = await present("[data-git-failure]");
        rec(
            "9. a plain directory reads as not-a-repository, not a failure",
            calm && !noFailure,
            `notRepo=${calm} failure=${noFailure}`
        );
        await h.shot("cdp-shots/git-history-notrepo.png");

        await pick(ctx.names.broken);
        const failed = await present("[data-git-failure]");
        const evidence = await text("[data-git-failure]");
        rec(
            "10. an unreadable repository reads as a failure, with git's own message",
            failed && evidence.includes("git log") && evidence.length > 40,
            `failure=${failed} evidence="${evidence.slice(0, 120)}"`
        );
        await h.shot("cdp-shots/git-history-failed.png");

        return steps;
    },
    async teardown(h, ctx) {
        for (const name of Object.values(ctx.names)) {
            try {
                await h.rpc("deleteproject", { name });
            } catch {
                /* leave a stale registry entry rather than failing teardown */
            }
        }
        for (const dir of ctx.dirs) {
            rmSync(dir, { recursive: true, force: true });
        }
    },
};

// --- diff surface: a comparison at the shipped window size ---------------------------------------
// The layout claim the parity plan was written for: at 1000x700 the history column has to fold to a
// rail, or a fixed 460px of commits plus the file list leaves the diff pane about 240px and nothing
// in it can be read. Pinned to that size on purpose - at the harness's roomy 1600x950 default there
// is room for all three columns and the assertion proves nothing.
const diffCompare = {
    name: "diff-compare",
    surface: "files",
    async arrange(h) {
        const dir = mkdtempSync(join(tmpdir(), "verify-diff-compare-"));
        git(dir, "init", "-q", "--initial-branch=main");
        writeFileSync(join(dir, "README.md"), "# retry\n");
        writeFileSync(
            join(dir, "policy.go"),
            `package retry

func Budget() int {
    return 3
}
`
        );
        git(dir, "add", ".");
        git(dir, "commit", "-q", "-m", "seed the retry package");
        git(dir, "checkout", "-q", "-b", "feature");
        writeFileSync(
            join(dir, "policy.go"),
            `package retry

func Budget() int {
    return 8
}
`
        );
        writeFileSync(
            join(dir, "submit.go"),
            `package retry

func Submit(id string) error {
    return nil
}
`
        );
        git(dir, "add", ".");
        git(dir, "commit", "-q", "-m", "raise the budget, add submit");
        const name = "verify-diff-compare";
        await h.rpc("createproject", { name, path: dir });

        // Deterministic entry. historyCollapsedAtom is an explicit override that a resize deliberately
        // cannot undo (difflayout.ts), and it is module-level, so it outlives the surface for the whole
        // life of the page. An earlier run of this scenario would otherwise be the thing that decides
        // what "at 1000x700" means below, and a reload is the only route back to "follow the width".
        try {
            await h.ev("location.reload()");
        } catch {
            /* the evaluate is cut off by the navigation it just started */
        }
        for (let waited = 0; waited < 30000; waited += 500) {
            const up = await h
                .ev("!!window.TabRpcClient && !!document.querySelector('nav button')")
                .catch(() => false);
            if (up) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        return { dir, name };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const present = (sel) => h.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
        const widthOf = (sel) =>
            h.ev(
                `(() => { const el = document.querySelector(${JSON.stringify(sel)});
                  return el ? Math.round(el.getBoundingClientRect().width) : 0; })()`
            );
        const click = async (sel) => {
            const ok = await h.ev(
                `(() => { const el = document.querySelector(${JSON.stringify(sel)});
                  if (!el) return false; el.click(); return true; })()`
            );
            if (!ok) throw new Error(`nothing to click at ${sel}`);
        };
        // a cold dev app compiles the surface's modules on first visit, so the fixed sleeps below are a
        // floor, not a budget - wait for the thing itself rather than guessing how slow the first run is
        const waitFor = async (sel, ms) => {
            for (let waited = 0; waited < ms; waited += 250) {
                if (await present(sel)) return true;
                await sleep(250);
            }
            return false;
        };

        // the shipped window (src-tauri/tauri.conf.json), which is the whole point of this scenario
        await h.cdp("Emulation.setDeviceMetricsOverride", {
            width: 1000,
            height: 700,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await sleep(600);

        await click("[data-files-source-picker]");
        await sleep(200);
        await click(`[data-files-source-option=${JSON.stringify(ctx.name)}]`);
        await sleep(1600); // change list + history page

        const railWidth = await widthOf("[data-history-rail]");
        const expandedRow = await present("[data-history-row]");
        rec(
            "1. at 1000x700 the commit column folds to a rail",
            railWidth > 0 && railWidth <= 48 && !expandedRow,
            `railWidth=${railWidth} expandedRows=${expandedRow}`
        );

        await h.cdp("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "c",
            code: "KeyC",
            text: "c",
            windowsVirtualKeyCode: 67,
        });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
        await sleep(2200); // divergence, then the aggregate's own change list
        const chipOn = await h.ev(
            `document.querySelector('[data-range-chip="compare"]')?.getAttribute('aria-pressed') === 'true'`
        );
        rec("2. c switches the range to a two-ref comparison", chipOn, `compareChipPressed=${chipOn}`);

        // the rail stands in for the compare column at this width too, so prove the column is what it
        // unfolds into rather than a separate history-only affordance
        await click('[data-history-rail] button[title="Expand history"]');
        await sleep(500);
        const column = await present("[data-compare-column]");
        await click('button[title="Collapse history"]');
        await sleep(500);
        const railBack = await present("[data-history-rail]");
        rec(
            "3. the rail unfolds into the compare column and back",
            column && railBack,
            `column=${column} railBack=${railBack}`
        );

        await waitFor('[data-changed-file-row="policy.go"]', 8000);
        const files = await h.ev(
            `Array.from(document.querySelectorAll('[data-changed-file-row]')).map(e => e.dataset.changedFileRow).join(',')`
        );
        rec(
            "4. the aggregate lists what the branch changed",
            files.includes("policy.go") && files.includes("submit.go"),
            `files=${files}`
        );

        // the modified file, not the added one: it is the case that needs both FileAtRef reads. Recorded
        // as part of the step rather than thrown, so a miss here still reports what the four above found.
        const opened = await h.ev(
            `(() => { const el = document.querySelector('[data-changed-file-row="policy.go"]');
              if (!el) return false; el.click(); return true; })()`
        );
        await sleep(2500); // two FileAtRef reads, then Monaco's first mount
        const editor = await present("[data-diff-pane] .monaco-diff-editor");
        const paneWidth = await widthOf("[data-diff-pane]");
        rec(
            "5. the file opens in Monaco, in a pane wide enough to read",
            opened && editor && paneWidth >= 400,
            `clicked=${opened} monaco=${editor} paneWidth=${paneWidth}`
        );
        await h.shot("cdp-shots/diff-compare.png");

        return steps;
    },
    async teardown(h, ctx) {
        // This scenario is the only one that drives module-level Diff state, and both bits it touches
        // OUTLIVE the surface: compare mode, and an explicit collapse that a resize deliberately cannot
        // undo (difflayout.ts). Leaving the column explicitly collapsed makes the next Diff scenario read
        // a rail at 1600x950 and find no [data-history-scroll] at all, which is how this was found.
        const esc = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...esc });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...esc });
        await h.ev(`document.querySelector('[data-history-rail] button[title="Expand history"]')?.click()`);
        try {
            await h.rpc("deleteproject", { name: ctx.name });
        } catch {
            /* leave a stale registry entry rather than failing teardown */
        }
        try {
            // the surface is still scoped here, so wavesrv may hold the repo open a moment longer
            rmSync(ctx.dir, { recursive: true, force: true });
        } catch {
            /* a leftover temp repo is cheaper than a failed teardown */
        }
    },
};

// --- diff surface: review marks in the changed-file list -----------------------------------------
// docs/superpowers/plans/2026-10-12-diff-review-marks.md, end to end on a temp repo: marking from
// the row box, v and the header button, a directory box, a file that changed after it was marked, a
// reload, and a commit and a compare aggregate that keep marks of their own.
const REVIEW_STORAGE_KEY = "diff.review.marks";

// the app's own reload, waited out until the shell is back up
async function reloadApp(h) {
    try {
        await h.ev("location.reload()");
    } catch {
        /* the evaluate is cut off by the navigation it just started */
    }
    for (let waited = 0; waited < 30000; waited += 500) {
        const up = await h.ev("!!window.TabRpcClient && !!document.querySelector('nav button')").catch(() => false);
        if (up) break;
        await new Promise((r) => setTimeout(r, 500));
    }
}

const diffReviewMarks = {
    name: "diff-review-marks",
    surface: "files",
    async arrange(h) {
        const dir = mkdtempSync(join(tmpdir(), "verify-diff-review-"));
        git(dir, "init", "-q", "--initial-branch=main");
        mkdirSync(join(dir, "src", "retry"), { recursive: true });
        writeFileSync(join(dir, "README.md"), "# retry\n");
        writeFileSync(join(dir, "src", "retry", "policy.go"), "package retry\n\nfunc Budget() int {\n    return 3\n}\n");
        writeFileSync(join(dir, "src", "retry", "legacy.go"), "package retry\n\nfunc Legacy() {}\n");
        git(dir, "add", ".");
        git(dir, "commit", "-q", "-m", "seed the retry package");
        git(dir, "checkout", "-q", "-b", "feature");
        writeFileSync(join(dir, "src", "retry", "policy.go"), "package retry\n\nfunc Budget() int {\n    return 8\n}\n");
        writeFileSync(
            join(dir, "src", "retry", "submit.go"),
            "package retry\n\nfunc Submit(id string) error {\n    return nil\n}\n"
        );
        git(dir, "add", ".");
        git(dir, "commit", "-q", "-m", "raise the budget, add submit");
        // the working tree: four files, one of each status the list draws
        writeFileSync(join(dir, "README.md"), "# retry\n\nBudgets and backoff for job submission.\n");
        writeFileSync(
            join(dir, "src", "retry", "policy.go"),
            "package retry\n\nfunc Budget() int {\n    return 8\n}\n\nfunc Floor() int {\n    return 1\n}\n"
        );
        writeFileSync(join(dir, "src", "retry", "backoff.go"), "package retry\n\nfunc Backoff(n int) int {\n    return n * 2\n}\n");
        git(dir, "add", "-N", "src/retry/backoff.go");
        rmSync(join(dir, "src", "retry", "legacy.go"));
        const name = "verify-diff-review-marks";
        await h.rpc("createproject", { name, path: dir });

        // the store reads localStorage once, at module load, so the key is cleared before the reload that
        // gives this scenario fresh module state; teardown puts back whatever the user had
        const prevMarks = await h.ev(`localStorage.getItem(${JSON.stringify(REVIEW_STORAGE_KEY)})`);
        await h.ev(`localStorage.removeItem(${JSON.stringify(REVIEW_STORAGE_KEY)})`);
        await reloadApp(h);
        return { dir, name, prevMarks };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
        const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;
        const boxSel = (path) => `[data-review-toggle=${JSON.stringify(path)}]`;
        const DIR = "src/retry";
        const dirRowSel = `[data-changed-dir-row=${JSON.stringify(DIR)}]`;
        const dirBoxSel = `[data-review-toggle-dir=${JSON.stringify(DIR)}]`;
        const until = async (expr, ms = 8000) => {
            for (let waited = 0; waited < ms; waited += 250) {
                if (await h.ev(expr).catch(() => false)) return true;
                await sleep(250);
            }
            return false;
        };
        const click = (sel) => h.ev(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
        const stateOf = (path) => h.ev(`${q(rowSel(path))}?.dataset.reviewState ?? "absent"`);
        const openRow = () => h.ev(`${q('[data-changed-file-row][aria-current="true"]')}?.dataset.changedFileRow ?? ""`);
        const rows = () =>
            h.ev(`Array.from(document.querySelectorAll('[data-changed-file-row]')).map(e => e.dataset.changedFileRow).join(',')`);
        const progress = async () =>
            JSON.parse(
                await h.ev(`(() => { const el = ${q("[data-files-reviewed]")};
                  return JSON.stringify(el ? { done: el.dataset.done, total: el.dataset.total, text: el.textContent }
                                           : { done: null, total: null, text: "" }); })()`)
            );
        const doneIs = (n) => `${q("[data-files-reviewed]")}?.dataset.done === ${JSON.stringify(String(n))}`;
        const stateIs = (path, state) => `${q(rowSel(path))}?.dataset.reviewState === ${JSON.stringify(state)}`;
        const isOpen = (path) => `${q(rowSel(path))}?.getAttribute("aria-current") === "true"`;
        const press = async (key, code, vk) => {
            // an open diff can hold focus in Monaco, where the dispatcher lets every key through
            await h.ev("document.activeElement?.blur?.()");
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, windowsVirtualKeyCode: vk });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
        };
        const pin = () =>
            h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
        const pick = async () => {
            await click("[data-files-source-picker]");
            const option = `[data-files-source-option=${JSON.stringify(ctx.name)}]`;
            await until(`!!${q(option)}`, 4000);
            await click(option);
            return until(`!!${q(rowSel("src/retry/backoff.go"))}`, 15000);
        };

        try {
            await pin();
            await sleep(400);
            const picked = await pick();
            const listed = await until(`document.querySelectorAll('[data-changed-file-row]').length === 4`, 4000);
            const allNone = await until(
                `Array.from(document.querySelectorAll('[data-changed-file-row]')).every(e => e.dataset.reviewState === "none")`,
                2000
            );
            let p = await progress();
            rec(
                "1. the working tree lists 4 unreviewed files and a progress line at 0/4",
                picked && listed && allNone && p.done === "0" && p.total === "4",
                `rows=${await rows()} progress=${p.done}/${p.total}`
            );
            await h.shot("cdp-shots/diff-review-marks-empty.png");

            await click(rowSel("README.md"));
            const headerUp = await until(`!!${q("[data-review-open]")}`);
            await press("v", "KeyV", 86);
            const advanced = await until(`${stateIs("README.md", "ok")} && ${doneIs(1)} && ${isOpen("src/retry/backoff.go")}`);
            rec(
                "2. v marks README.md and opens the next unreviewed file, wrapping round to src/retry/backoff.go",
                headerUp && advanced,
                `header=${headerUp} README=${await stateOf("README.md")} done=${(await progress()).done} open=${await openRow()}`
            );
            await h.shot("cdp-shots/diff-review-marks-partial.png");

            await click(boxSel("src/retry/policy.go"));
            const boxed = await until(stateIs("src/retry/policy.go", "ok"));
            await sleep(300); // a selection move would land with the mark, so give it a beat to show
            const stayed = (await openRow()) === "src/retry/backoff.go";
            rec(
                "3. a box on another row marks it without moving the open file",
                boxed && stayed,
                `policy=${await stateOf("src/retry/policy.go")} open=${await openRow()}`
            );

            const partialDir = await until(`${q(dirRowSel)}?.textContent.includes("1/3")`, 3000);
            rec(
                "4a. the src/retry directory row reads 1/3",
                partialDir,
                `dirRow="${await h.ev(`${q(dirRowSel)}?.textContent ?? "absent"`)}"`
            );
            await h.shot("cdp-shots/diff-review-marks-dir-partial.png");

            await click(dirBoxSel);
            const allDone = await until(
                `${stateIs("src/retry/backoff.go", "ok")} && ${stateIs("src/retry/legacy.go", "ok")} && ${doneIs(4)}`
            );
            p = await progress();
            rec(
                "4b. the directory box marks the rest, and the progress line reads all 4 reviewed",
                allDone && p.text.includes("all 4 reviewed"),
                `done=${p.done}/${p.total} text="${p.text}"`
            );
            await h.shot("cdp-shots/diff-review-marks-all.png");

            await click(dirRowSel);
            const folded = await until(`!${q(rowSel("src/retry/policy.go"))} && !!${q(dirRowSel)}`, 3000);
            const foldedBox = await h.ev(`${q(dirBoxSel)}?.getAttribute("aria-pressed") === "true"`);
            rec(
                "4c. the collapsed directory keeps its reviewed box",
                folded && foldedBox,
                `collapsed=${folded} boxPressed=${foldedBox}`
            );
            await h.shot("cdp-shots/diff-review-marks-dir-collapsed.png");
            await click(dirRowSel);
            await until(`!!${q(rowSel("src/retry/policy.go"))}`, 3000);

            appendFileSync(join(ctx.dir, "src", "retry", "policy.go"), "\n// floors stay above zero\n");
            await press("r", "KeyR", 82);
            const stale = await until(`${stateIs("src/retry/policy.go", "stale")} && ${doneIs(3)}`, 15000);
            rec(
                "5. a file edited after it was marked reads stale and drops out of the count",
                stale,
                `policy=${await stateOf("src/retry/policy.go")} done=${(await progress()).done}`
            );
            await h.shot("cdp-shots/diff-review-marks-stale.png");

            // the header labels its buttons only on a pane of LABELLED_MIN_PX (diffoptions.ts), which 1600px
            // leaves about 760px of, so this one step widens the window to show the label
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: 2000, height: 950, deviceScaleFactor: 1, mobile: false });
            await click(rowSel("README.md"));
            const pressed = await until(`${q("[data-review-open]")}?.getAttribute("aria-pressed") === "true"`);
            await until(`${q("[data-review-open]")}?.textContent.startsWith("Reviewed")`, 3000);
            const label = await h.ev(`${q("[data-review-open]")}?.textContent ?? ""`);
            await h.shot("cdp-shots/diff-review-marks-header-reviewed.png");
            await pin();
            await click("[data-review-open]");
            const unmarked = await until(stateIs("README.md", "none"));
            await sleep(300);
            const keptOpen = (await openRow()) === "README.md";
            rec(
                "6. the header button reads Reviewed on a marked file, and unmarking it stays on that file",
                pressed && label.startsWith("Reviewed") && unmarked && keptOpen,
                `pressed=${pressed} label="${label}" README=${await stateOf("README.md")} open=${await openRow()}`
            );

            await reloadApp(h);
            await pin();
            await h.goto("files");
            const repicked = await pick();
            const kept = await until(
                `${stateIs("src/retry/backoff.go", "ok")} && ${stateIs("src/retry/policy.go", "stale")}`,
                4000
            );
            rec(
                "7. marks survive a reload",
                repicked && kept,
                `backoff=${await stateOf("src/retry/backoff.go")} policy=${await stateOf("src/retry/policy.go")}`
            );

            const commitClicked = await h.ev(`(() => {
                const row = Array.from(document.querySelectorAll('[data-history-row]'))
                    .find((r) => r.textContent.includes("raise the budget, add submit"));
                const btn = row?.querySelector("button");
                if (!btn) return false;
                btn.click();
                return true;
            })()`);
            const commitRows = await until(
                `!!${q(rowSel("src/retry/submit.go"))} && !${q(rowSel("README.md"))} && document.querySelectorAll('[data-changed-file-row]').length === 2`
            );
            const commitFresh =
                (await stateOf("src/retry/policy.go")) === "none" && (await stateOf("src/retry/submit.go")) === "none";
            // one box at a time: a box on the open file advances the selection, which re-renders the list
            await click(boxSel("src/retry/policy.go"));
            await until(stateIs("src/retry/policy.go", "ok"), 3000);
            await click(boxSel("src/retry/submit.go"));
            const commitAll = await until(`${doneIs(2)} && ${q("[data-files-reviewed]")}?.textContent.includes("all 2 reviewed")`);
            rec(
                "8. the feature commit keeps marks of its own, separate from the working tree",
                commitClicked && commitRows && commitFresh && commitAll,
                `clicked=${commitClicked} rows=${await rows()} startedNone=${commitFresh} text="${(await progress()).text}"`
            );
            await h.shot("cdp-shots/diff-review-marks-commit.png");

            await press("c", "KeyC", 67);
            const comparing = await until(
                `${q('[data-range-chip="compare"]')}?.getAttribute("aria-pressed") === "true" && !!${q(rowSel("src/retry/submit.go"))} && ${doneIs(0)}`,
                10000
            );
            // entering compare opens the ref editor on the pair it already reads; applying that pair as
            // it stands closes the editor, whose suggestions would otherwise cover pane 2 in the shot
            await h.ev(`(() => {
                const root = document.querySelector('input[placeholder="base ref"]')?.parentElement?.parentElement;
                Array.from(root?.querySelectorAll("button") ?? []).find((b) => b.textContent.trim() === "Compare")?.click();
            })()`);
            await until(`!document.querySelector('input[placeholder="base ref"]') && !!${q(boxSel("src/retry/submit.go"))}`, 5000);
            await click(boxSel("src/retry/submit.go"));
            const oneMarked = await until(doneIs(1));
            p = await progress();
            rec(
                "9a. the compare aggregate starts unreviewed, and one mark reads 1/N",
                comparing && oneMarked && p.text.includes(`1/${p.total} reviewed`),
                `rows=${await rows()} done=${p.done}/${p.total} text="${p.text}"`
            );
            await h.shot("cdp-shots/diff-review-marks-compare.png");

            await click("[data-review-clear]");
            const cleared = await until(doneIs(0), 3000);
            rec("9b. Clear drops the aggregate's marks", cleared, `done=${(await progress()).done}`);
        } catch (e) {
            rec("scenario aborted", false, String(e?.message ?? e));
        }
        return steps;
    },
    async teardown(h, ctx) {
        // compare mode and an explicit history collapse both outlive the surface (see diff-compare)
        const esc = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...esc });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...esc });
        await h.ev(`document.querySelector('[data-history-rail] button[title="Expand history"]')?.click()`);
        await h.ev(restoreLocalStorage(REVIEW_STORAGE_KEY, ctx.prevMarks));
        try {
            await h.rpc("deleteproject", { name: ctx.name });
        } catch {
            /* leave a stale registry entry rather than failing teardown */
        }
        try {
            rmSync(ctx.dir, { recursive: true, force: true });
        } catch {
            /* a leftover temp repo is cheaper than a failed teardown */
        }
    },
};

// --- diff surface: review marks on a run's range --------------------------------------------------
// diff-review-marks covers the working tree, a commit and a compare; this one opens the Diff surface the way
// a finished run's sheet does, so the marks land under the run subject (run:<id>:<base>) and survive a reload.
// The run is deferred (no lead) and written done with sealed evidence, which is what draws the sheet's link.
const diffReviewMarksRun = {
    name: "diff-review-marks-run",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-diff-review-run-"));
        const ctx = { cwd };
        try {
            git(cwd, "init", "-q", "--initial-branch=main");
            mkdirSync(join(cwd, "src", "retry"), { recursive: true });
            writeFileSync(join(cwd, "README.md"), "# retry\n");
            writeFileSync(join(cwd, "src", "retry", "policy.go"), "package retry\n\nfunc Budget() int {\n    return 3\n}\n");
            git(cwd, "add", ".");
            git(cwd, "commit", "-q", "-m", "seed the retry package");

            const wslist = await h.rpc("workspacelist", null);
            const ch = await h.rpc("createchannel", { name: "verify-diff-review-marks-run", projectpath: cwd });
            ctx.channelId = ch.oid;
            const created = await h.rpc("createrun", {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: "verify diff-review-marks-run: do nothing, make no file changes, stop immediately",
                runtime: "claude",
                mode: "orchestrator",
                deferstart: true,
            });
            ctx.runId = created.run.id;
            ctx.base = created.run.basecommit;
            if (!ctx.base) throw new Error("createrun recorded no base commit");

            // what the run "landed", after its base, on its own branch tree: that is the tree the run's diff reads
            const tree = created.run.landpath || cwd;
            writeFileSync(join(tree, "src", "retry", "policy.go"), "package retry\n\nfunc Budget() int {\n    return 8\n}\n");
            writeFileSync(join(tree, "src", "retry", "submit.go"), "package retry\n\nfunc Submit(id string) error {\n    return nil\n}\n");
            git(tree, "add", "src");
            git(tree, "commit", "-q", "-m", "raise the budget, add submit");

            const oref = `run:${ctx.runId}`;
            const evidence = {
                capturedts: Date.now(),
                hash: "",
                files: [
                    { path: "src/retry/policy.go", stat: "M", add: 1, del: 1 },
                    { path: "src/retry/submit.go", stat: "A", add: 5, del: 0 },
                ],
                addtotal: 6,
                deltotal: 1,
                runtimems: 0,
                durationms: 0,
            };
            const stored = await waveService(h, "object", "GetObject", [oref]);
            await waveService(
                h,
                "object",
                "UpdateObject",
                [{ ...stored, otype: "run", status: "done", report: "", evidence }, false],
                FINAL_SHOTS_UICTX
            );
            const back = await waveService(h, "object", "GetObject", [oref]);
            if (back?.status !== "done" || back?.evidence == null) {
                throw new Error(`the run did not keep its done state: status=${back?.status}`);
            }
            ctx.runDone = true;

            // the store reads localStorage once, at module load, so the key is cleared before the reload
            ctx.prevMarks = await h.ev(`localStorage.getItem(${JSON.stringify(REVIEW_STORAGE_KEY)})`);
            await h.ev(`localStorage.removeItem(${JSON.stringify(REVIEW_STORAGE_KEY)})`);
            await reloadApp(h);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. arrange", false, ctx.arrangeError);
            return steps;
        }
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
        const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;
        const until = async (expr, ms = 8000) => {
            for (let waited = 0; waited < ms; waited += 250) {
                if (await h.ev(expr).catch(() => false)) return true;
                await sleep(250);
            }
            return false;
        };
        const click = (sel) => h.ev(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
        const progress = () =>
            h.ev(`(() => { const el = ${q("[data-files-reviewed]")}; return el ? el.dataset.done + "/" + el.dataset.total : "absent"; })()`);
        const POLICY = "src/retry/policy.go";
        const SUBMIT = "src/retry/submit.go";
        const subjectSuffix = `|run:${ctx.runId}:${ctx.base}`;
        // opens the run's sheet and follows its "open the repository diff" link onto the Diff surface
        const openRunDiff = async () => {
            await h.goto("jarvis");
            await until(`typeof window.__openAddress === "function"`, 5000);
            await h.ev(`window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)})`);
            const linked = await until(
                `[...document.querySelectorAll("[data-evidence-block] button")].some((b) => /open the repository diff/.test(b.textContent || ""))`,
                10000
            );
            await h.ev(`[...document.querySelectorAll("[data-evidence-block] button")]
                .find((b) => /open the repository diff/.test(b.textContent || ""))?.click()`);
            const listed = await until(`!!${q(rowSel(SUBMIT))} && !!${q(rowSel(POLICY))}`, 15000);
            return { linked, listed };
        };
        const storedSubject = () =>
            h.ev(`(() => {
                const store = JSON.parse(localStorage.getItem(${JSON.stringify(REVIEW_STORAGE_KEY)}) || "{}");
                const key = Object.keys(store).find((k) => k.endsWith(${JSON.stringify(subjectSuffix)}));
                return JSON.stringify({ keys: Object.keys(store), key: key ?? null, files: key ? Object.keys(store[key].files ?? {}) : [] });
            })()`).then((s) => JSON.parse(s));

        try {
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
            const first = await openRunDiff();
            const range = await h.ev(`document.body.innerText.includes("This run")`);
            rec(
                "1. the run sheet's link opens the run's range with both files unreviewed",
                first.linked && first.listed && range && (await progress()) === "0/2",
                `linked=${first.linked} listed=${first.listed} thisRun=${range} progress=${await progress()}`
            );
            await h.shot("cdp-shots/diff-review-marks-run-empty.png");

            await click(`[data-review-toggle=${JSON.stringify(POLICY)}]`);
            const marked = await until(`${q(rowSel(POLICY))}?.dataset.reviewState === "ok"`, 3000);
            const subject = await storedSubject();
            rec(
                "2. a mark on the run range is stored under run:<id>:<base>",
                marked && (await progress()) === "1/2" && subject.key != null && subject.files.includes(POLICY),
                JSON.stringify({ marked, progress: await progress(), want: subjectSuffix, ...subject })
            );
            await h.shot("cdp-shots/diff-review-marks-run-marked.png");

            await reloadApp(h);
            const again = await openRunDiff();
            const kept = await until(`${q(rowSel(POLICY))}?.dataset.reviewState === "ok"`, 3000);
            rec(
                "3. after a reload the run range still reads policy.go reviewed, 1/2",
                again.listed && kept && (await progress()) === "1/2",
                `listed=${again.listed} kept=${kept} progress=${await progress()}`
            );
            await h.shot("cdp-shots/diff-review-marks-run-reloaded.png");
        } catch (e) {
            rec("scenario aborted", false, String(e?.message ?? e));
        }
        return steps;
    },
    async teardown(h, ctx) {
        // a done run cannot be cancelled, so only one that never got that far is
        await teardownFixtureRun(h, ctx.runDone ? { ...ctx, runId: null } : ctx, "diff-review-marks-run", {
            what: "restore the review marks",
            fn: () => h.ev(restoreLocalStorage(REVIEW_STORAGE_KEY, ctx.prevMarks)),
        });
    },
};

// --- jarvis avatar: the hologram in window chrome ----------------------------------------------
// The avatar is a <canvas>, so there are no attributes to read the way the old SVG creature allowed. It
// publishes its last built scene on window in DEV builds instead (petview.tsx), which is a STRONGER
// assertion than the SVG version permitted: the whole scene at once rather than one element's transform.
// A screenshot still goes to the contact sheet for eyeballing the glow.
const jarvisAvatar = {
    name: "jarvis-avatar",
    surface: "cockpit",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });

        const raw = await h.ev("JSON.stringify(window.__jarvisAvatarScene ?? null)");
        const scene = raw ? JSON.parse(raw) : null;
        if (scene == null) {
            rec("1. the avatar publishes a scene", false, "window.__jarvisAvatarScene is null — is the loop running?");
            return steps;
        }

        rec(
            "1. the render loop publishes a non-empty scene",
            scene.segments > 0 && scene.fills > 0,
            `segments=${scene.segments} fills=${scene.fills} renderer=${scene.renderer}`
        );
        // a literal here would silently opt the avatar out of every runtime theme
        rec(
            "2. the tone is a theme token, never a resolved colour",
            String(scene.toneVar).startsWith("--color-"),
            `toneVar=${scene.toneVar} markerVar=${scene.markerVar}`
        );
        rec("3. the form has a non-zero extent", scene.extent > 0, `extent=${scene.extent}`);

        // exactly one control owns each accessible name; two would make a by-label query ambiguous, and
        // h.goto navigates the rail by exactly this label
        const named = await h.ev(`[...document.querySelectorAll('[aria-label="Jarvis condition"]')].length`);
        const navNamed = await h.ev(`[...document.querySelectorAll('[aria-label="Jarvis"]')].length`);
        rec(
            "4. the avatar and the nav rail keep distinct accessible names",
            named === 1 && navNamed === 1,
            `"Jarvis condition"=${named} "Jarvis"=${navNamed}`
        );

        // Two canvases by design: one element can only ever yield contexts of a single kind, so the 2D
        // fallback needs its own. Exactly one is displayed at a time.
        const canvases = JSON.parse(
            await h.ev(`(() => {
                const w = document.querySelector('[aria-label="Jarvis condition"]');
                if (!w) return "[]";
                return JSON.stringify([...w.querySelectorAll('canvas')].map((c) => c.className));
            })()`)
        );
        rec(
            "5. both renderers have a canvas and exactly one is shown",
            canvases.length === 2 && canvases.filter((c) => c === "block").length === 1,
            JSON.stringify(canvases)
        );

        await h.shot("cdp-shots/jarvis-avatar.png");
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit"); // leave the app where a human expects it
    },
};

const JARVIS_PEEK_PROJECT = "verify-jarvis-peek";

// a registered project is the composer's destination (petpeek.tsx: projectListAtom's rows with a channel), and
// createproject makes its channel. The channel snapshot is boot-primed, so the frontend reloads to see it, and
// the reload closes the hub, so it is reopened from the creature the way step 1 opened it. The existing fixture
// helpers (arrangeFixtureRun, brief-peek's createchannel) make a channel with no registered project, which is
// not a destination.
async function arrangeJarvisPeekDest(h, ctx) {
    try {
        ctx.destDir = mkdtempSync(join(tmpdir(), "verify-jarvis-peek-"));
        await h.rpc("createproject", { name: JARVIS_PEEK_PROJECT, path: ctx.destDir });
        ctx.destProject = JARVIS_PEEK_PROJECT;
        await waitForProjectInConfig(h, JARVIS_PEEK_PROJECT);
        // not polishReload: it lands on the Jarvis surface, whose mount selects a channel
        try {
            await h.ev("location.reload()");
        } catch {
            /* the evaluate is cut off by the navigation it just started */
        }
        await polishWaitFor(h, "!!window.TabRpcClient && !!document.querySelector('nav button')", 30000);
        await h.goto("cockpit");
        await h.ev(`(() => {
            const store = globalThis.__wavePetStore;
            store?.resetPeek();
            store?.setAttention([]);
            document.querySelector('[aria-label="Jarvis condition"]')?.focus();
        })()`);
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        }
        const composerEnabled = await polishWaitFor(
            h,
            `(() => { const i = document.querySelector('[data-pet-peek] [data-pet-errand-input]'); return i != null && !i.disabled; })()`,
            10000
        );
        const destLabel = await h.ev(
            `document.querySelector('[data-pet-peek] [data-pet-errand-dest]')?.selectedOptions?.[0]?.textContent?.trim() ?? null`
        );
        return { composerEnabled, destLabel };
    } catch (e) {
        return { composerEnabled: false, error: String(e?.message ?? e) };
    }
}

// deleteproject leaves the channel createproject made, so the channel at the project's path goes too
async function teardownJarvisPeekDest(h, ctx) {
    const step = async (what, fn) => {
        try {
            await fn();
        } catch (e) {
            console.error(`jarvis-peek teardown: ${what} failed: ${e?.message ?? e}`);
        }
    };
    if (ctx?.destProject) await step("delete the project", () => h.rpc("deleteproject", { name: ctx.destProject }));
    if (ctx?.destDir) {
        await step("delete the project's channel", async () => {
            const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
            const channels = (await h.rpc("getchannels", null))?.channels ?? [];
            for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.destDir))) {
                await h.rpc("deletechannel", { channelid: c.oid });
            }
        });
        await step("remove the temp dir", () => rmSync(ctx.destDir, { recursive: true, force: true }));
    }
}

const jarvisPeek = {
    name: "jarvis-peek",
    surface: "cockpit",
    async arrange(h) {
        // petSaidAtom is session-scoped. Reloading gives this scenario a deterministic empty feed while
        // the persisted watermark still prevents old backend facts from speaking again.
        await h.ev("location.reload()");
        await h.ev("new Promise((r) => setTimeout(r, 2500))");
        const reset = await h.ev(`(() => {
            const store = globalThis.__wavePetStore;
            if (typeof store?.resetPeek !== 'function') return false;
            store.resetPeek();
            store.setAttention([]);
            return true;
        })()`);
        return { reset };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const press = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
            for (const type of ["keyDown", "keyUp"]) {
                await h.cdp("Input.dispatchKeyEvent", {
                    type,
                    key,
                    code,
                    windowsVirtualKeyCode,
                    modifiers,
                });
            }
            await settle(350);
        };

        const creatureFocused = await h.ev(`(() => {
            const creature = document.querySelector('[aria-label="Jarvis condition"]');
            if (!creature) return false;
            creature.focus();
            return document.activeElement === creature;
        })()`);
        await press("Enter", "Enter", 13);

        const structure = await h.ev(`(() => {
            const panel = document.querySelector('[data-pet-peek]');
            if (!panel) return null;
            const labelledBy = panel.getAttribute('aria-labelledby');
            const label = labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() : null;
            const input = panel.querySelector('[data-pet-errand-input]');
            const dest = panel.querySelector('[data-pet-errand-dest]');
            const rect = panel.getBoundingClientRect();
            return {
                role: panel.getAttribute('role'),
                label,
                shape: panel.getAttribute('data-pet-peek-shape'),
                close: panel.querySelector('button[aria-label="Close Jarvis panel"]') != null,
                panelFocused: document.activeElement === panel,
                // the panel is header / queue / composer, in that DOM order. Conditions and the updates
                // drawer are conditional and absent in the reset state, which is the point of the redesign.
                header: panel.querySelector('[data-pet-peek-header]') != null,
                queue: panel.querySelector('[data-pet-queue]') != null,
                composer: panel.querySelector('[data-pet-composer]') != null,
                conditions: panel.querySelector('[data-pet-conditions]') != null,
                updatesDrawer: panel.querySelector('[data-pet-updates]') != null,
                rows: panel.querySelectorAll('[data-pet-row]').length,
                // absence must not be rendered: no tile reading "Nothing", no empty-updates card, no
                // health badge restating what the lines below already say (2026-09-04 brief §3, §6).
                text: (panel.innerText || '').trim(),
                height: Math.round(rect.height),
                destPresent: dest != null,
                destLabel: dest?.selectedOptions?.[0]?.textContent?.trim() ?? null,
                inputDisabled: input?.disabled ?? null,
                inputPlaceholder: input?.getAttribute('placeholder') ?? null,
            };
        })()`);
        rec(
            "1. keyboard open renders a labelled dialog of header/queue/composer and focuses its container",
            creatureFocused === true &&
                structure?.role === "dialog" &&
                structure?.label === "Nothing waiting on you" &&
                structure?.shape === "quiet" &&
                structure?.header === true &&
                structure?.queue === true &&
                structure?.composer === true &&
                structure?.close === true &&
                structure?.panelFocused === true,
            JSON.stringify({ creatureFocused, structure })
        );

        await press("Tab", "Tab", 9);
        const firstTab = await h.ev(`(() => ({
            label: document.activeElement?.getAttribute('aria-label') ?? null,
            inside: document.querySelector('[data-pet-peek]')?.contains(document.activeElement) ?? false,
        }))()`);
        await press("Tab", "Tab", 9, 8);
        const wrappedInside = await h.ev(
            `document.querySelector('[data-pet-peek]')?.contains(document.activeElement) ?? false`
        );
        rec(
            "2. Tab starts at Full view and reverse traversal stays inside the dialog",
            firstTab.inside === true && firstTab.label === "Open full Jarvis view" && wrappedInside === true,
            JSON.stringify({ firstTab, wrappedInside })
        );
        // Each string below is one the old three-card panel rendered to report missing telemetry or repeat
        // a disabled composer state. The adaptive card states queue absence once in its title; these older
        // tile-level absence messages must not come back.
        const ABSENCE =
            /No updates yet|No reading|Usage unavailable|No action needed|No destination|No channel selected|Select a channel to ask Jarvis/;
        rec(
            "3. the quiet card states queue absence once, and the composer is live wherever there is a destination",
            ctx.reset === true &&
                structure?.updatesDrawer === false &&
                ABSENCE.test(structure?.text ?? "") === false &&
                structure?.text.includes("Nothing waiting on you") === true &&
                // the fix: dead only when there is genuinely nowhere to send. The composer used to read the
                // Jarvis surface's selection, which nothing sets at boot, so it was dead on every surface.
                structure?.inputDisabled === !structure?.destPresent &&
                // resting height, against the 693px the three-card panel cost. Only asserted with an empty
                // queue: rows are real content and are allowed to make the panel taller.
                (structure?.rows > 0 || (structure?.height > 0 && structure?.height < 320)),
            JSON.stringify(structure)
        );
        await h.shot("cdp-shots/jarvis-peek-empty.png");

        await h.cdp("Emulation.setDeviceMetricsOverride", {
            width: 440,
            height: 420,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await settle(450);
        const narrow = await h.ev(`(() => {
            const panel = document.querySelector('[data-pet-peek]');
            const header = document.querySelector('[data-pet-peek-header]');
            const body = document.querySelector('[data-pet-peek-body]');
            if (!panel || !header || !body) return null;
            const rect = panel.getBoundingClientRect();
            const headerTop = Math.round(header.getBoundingClientRect().top);
            body.scrollTop = body.scrollHeight;
            const headerAfterScroll = Math.round(header.getBoundingClientRect().top);
            return {
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                width: Math.round(rect.width),
                shape: panel.getAttribute('data-pet-peek-shape'),
                horizontalOverflow: panel.scrollWidth - panel.clientWidth,
                bodyScrollable: body.scrollHeight > body.clientHeight,
                headerStayed: headerTop === headerAfterScroll,
            };
        })()`);
        await h.shot("cdp-shots/jarvis-peek-narrow.png");

        const pickerOpened = await h.ev(`(() => {
            const picker = document.querySelector('[data-pet-peek] [data-testid="harness-picker"]');
            if (!picker) return false;
            picker.click();
            return true;
        })()`);
        await settle(350);
        const pickerVisibility = await h.ev(`(() => {
            const options = [...document.querySelectorAll('[data-testid^="harness-option-"]')];
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const visible = options.length > 0 && options.every((option) => {
                const rect = option.getBoundingClientRect();
                const x = Math.round(rect.left + rect.width / 2);
                const y = Math.round(rect.top + rect.height / 2);
                const hit = document.elementFromPoint(x, y);
                return rect.left >= 0 && rect.right <= viewport.width && rect.top >= 0 && rect.bottom <= viewport.height &&
                    (hit === option || option.contains(hit));
            });
            return {
                count: options.length,
                visible,
                rects: options.map((option) => {
                    const rect = option.getBoundingClientRect();
                    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
                }),
            };
        })()`);
        await h.ev(`document.querySelector('[data-pet-peek] [data-testid="harness-picker"]')?.click()`);
        await settle(350);
        rec(
            // bodyScrollable is deliberately no longer required: the resting panel now FITS 440x420, which
            // is the redesign's first success criterion. headerStayed still proves the pin structurally —
            // the header sits outside the scroll container whether or not the queue currently overflows.
            "4. the narrow panel stays bounded with a pinned header, no horizontal overflow, and an unclipped harness picker",
            narrow != null &&
                narrow.left >= 8 &&
                narrow.right <= narrow.viewportWidth - 8 &&
                narrow.top >= 8 &&
                narrow.bottom <= narrow.viewportHeight - 8 &&
                narrow.width <= 420 &&
                narrow.shape === "quiet" &&
                narrow.horizontalOverflow <= 0 &&
                narrow.headerStayed === true &&
                pickerOpened === true &&
                pickerVisibility?.visible === true,
            JSON.stringify({ narrow, pickerOpened, pickerVisibility })
        );

        // the portaled harness menu is inside the dialog's aria scope, and a pick closes it with focus back inside
        // the dialog, so the popup's keys still reach it and one Escape closes it. Real mouse events, because element.click() moves no focus.
        const centerOf = (selector) =>
            h.ev(`(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            })()`);
        const clickAt = async (pt) => {
            await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
            for (const type of ["mousePressed", "mouseReleased"]) {
                await h.cdp("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
            }
        };
        const PICKER = '[data-pet-peek] [data-testid="harness-picker"]';
        ctx.prevHarness = await h.ev(`document.querySelector(${JSON.stringify(PICKER)})?.dataset.harnessRuntime ?? null`);
        const chip = await centerOf(PICKER);
        if (chip != null) await clickAt(chip);
        await settle(400);
        // the current selection when it can be picked, so the pick leaves the preference as it was
        const option = await h.ev(`(() => {
            const options = [...document.querySelectorAll('[data-testid^="harness-option-"]')].filter((o) => !o.disabled);
            const o = options.find((x) => x.getAttribute('aria-pressed') === 'true') ?? options[0];
            if (!o) return null;
            const r = o.getBoundingClientRect();
            return {
                runtime: o.dataset.testid.replace('harness-option-', ''),
                // the modal dialog hides everything outside its scope from assistive tech
                ariaHidden: o.closest('[aria-hidden="true"]') != null,
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2),
            };
        })()`);
        if (option != null) {
            ctx.harnessPicked = option.runtime;
            await clickAt(option);
        }
        await settle(450);
        const afterPick = await h.ev(`(() => {
            const active = document.activeElement;
            return {
                focusInDialog: document.querySelector('[data-pet-peek]')?.contains(active) ?? false,
                focused: active?.getAttribute('data-testid') ?? active?.tagName ?? null,
                menuExpanded: document.querySelector(${JSON.stringify(PICKER)})?.getAttribute('aria-expanded') ?? null,
            };
        })()`);
        await press("Escape", "Escape", 27);
        const closedByOneEscape = await h.ev(`document.querySelector('[data-pet-peek]') == null`);
        rec(
            "5. the harness menu is in the dialog's aria scope, a pick returns focus inside the dialog, and one Escape then closes the popup",
            chip != null &&
                option?.ariaHidden === false &&
                afterPick.focusInDialog === true &&
                closedByOneEscape === true,
            JSON.stringify({ chip, option, afterPick, closedByOneEscape })
        );

        // the Final's fresh profile has no project, so the composer is disabled and `/` cannot focus it. Step 3
        // covered that branch above; register one now so step 6 exercises a live composer.
        const dest = await arrangeJarvisPeekDest(h, ctx);
        const busyArranged = await h.ev(`(() => {
            const store = globalThis.__wavePetStore;
            const panel = document.querySelector('[data-pet-peek]');
            if (typeof store?.setAttention !== 'function' || !panel) return false;
            store.setAttention([
                { key: 'dag-gate:cdp-1', kind: 'dag-gate', source: 'first gate', text: 'Approve the gate before the DAG proceeds.', action: 'Review', waitingsince: Date.now() - 120000, channelid: '', runid: 'cdp-1', phaseidx: 0 },
                { key: 'ask:cdp-2', kind: 'ask', source: 'second ask', text: 'Waiting on your reply', action: 'Answer', waitingsince: Date.now() - 60000, channelid: '', runid: 'cdp-2', phaseidx: 0 },
            ]);
            return true;
        })()`);
        await settle(450);
        const busyBefore = await h.ev(`(() => {
            const panel = document.querySelector('[data-pet-peek]');
            panel?.focus();
            const rect = panel?.getBoundingClientRect();
            return {
                shape: panel?.getAttribute('data-pet-peek-shape') ?? null,
                width: rect == null ? null : Math.round(rect.width),
                cursor: panel?.querySelector('[data-pet-cursor="true"]')?.closest('[data-pet-row]')?.getAttribute('data-pet-row') ?? null,
                focused: document.activeElement === panel,
            };
        })()`);
        await h.shot("cdp-shots/jarvis-peek-busy.png");
        await press("ArrowDown", "ArrowDown", 40);
        const movedCursor = await h.ev(`document.querySelector('[data-pet-cursor="true"]')?.closest('[data-pet-row]')?.getAttribute('data-pet-row') ?? null`);
        await press("/", "Slash", 191);
        const composerFocused = await h.ev(`document.activeElement?.hasAttribute('data-pet-errand-input') ?? false`);
        rec(
            "6. attention keeps the card's width and keyboard navigation moves the cursor then focuses the composer",
            dest.composerEnabled === true &&
                busyArranged === true &&
                busyBefore?.shape === "busy" &&
                busyBefore?.width === narrow?.width &&
                busyBefore?.cursor === "dag-gate:cdp-1" &&
                busyBefore?.focused === true &&
                movedCursor === "ask:cdp-2" &&
                composerFocused === true,
            JSON.stringify({ dest, busyArranged, busyBefore, movedCursor, composerFocused })
        );

        await press("Escape", "Escape", 27);
        const escapeDismissed = await h.ev(`(() => ({
            panelGone: document.querySelector('[data-pet-peek]') == null,
            focusReturned: document.activeElement?.getAttribute('aria-label') === 'Jarvis condition',
        }))()`);

        await press("Enter", "Enter", 13);
        const closeClicked = await h.ev(`(() => {
            const close = document.querySelector('button[aria-label="Close Jarvis panel"]');
            if (!close) return false;
            close.click();
            return true;
        })()`);
        await settle(350);
        const closeDismissed = await h.ev(`(() => ({
            panelGone: document.querySelector('[data-pet-peek]') == null,
            focusReturned: document.activeElement?.getAttribute('aria-label') === 'Jarvis condition',
        }))()`);

        await press("Enter", "Enter", 13);
        const backdropClicked = await h.ev(`(() => {
            const backdrop = document.querySelector('[data-pet-peek-backdrop]');
            if (!backdrop) return false;
            backdrop.click();
            return true;
        })()`);
        await settle(350);
        const backdropDismissed = await h.ev(`(() => ({
            panelGone: document.querySelector('[data-pet-peek]') == null,
            focusReturned: document.activeElement?.getAttribute('aria-label') === 'Jarvis condition',
        }))()`);
        rec(
            "7. Escape, close, and backdrop dismiss only the peek and return focus to the creature",
            escapeDismissed.panelGone === true &&
                escapeDismissed.focusReturned === true &&
                closeClicked === true &&
                closeDismissed.panelGone === true &&
                closeDismissed.focusReturned === true &&
                backdropClicked === true &&
                backdropDismissed.panelGone === true &&
                backdropDismissed.focusReturned === true,
            JSON.stringify({ escapeDismissed, closeClicked, closeDismissed, backdropClicked, backdropDismissed })
        );
        const stayed = (await h.activeSurfaceLabel()) === SURFACE_LABEL.cockpit;
        rec("8. dismissing the global peek stays on the current surface", stayed, String(stayed));
        return steps;
    },
    async teardown(h, ctx) {
        await h.cdp("Emulation.setDeviceMetricsOverride", {
            width: 1600,
            height: 950,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await h.ev(`(() => {
            document.querySelector('button[aria-label="Close Jarvis panel"]')?.click();
            globalThis.__wavePetStore?.setAttention([]);
            return true;
        })()`);
        if (ctx.harnessPicked != null && ctx.prevHarness != null && ctx.harnessPicked !== ctx.prevHarness) {
            try {
                await h.rpc("setconfig", { "harness:preferredruntime": ctx.prevHarness });
            } catch (e) {
                console.error(`jarvis-peek teardown: restore the harness preference failed: ${e?.message ?? e}`);
            }
        }
        await teardownJarvisPeekDest(h, ctx);
        await h.goto("cockpit");
    },
};

// --- jarvis volunteer: the volunteered-knowledge delivery chain ---------------------------------
// The unit tests cover each hop in isolation; what they structurally cannot see is a bad hop BETWEEN
// atoms, which is the defect class this surface's findings keep landing in. So this drives the whole
// chain in the real app: push a knowledge utterance -> the creature speaks it -> the peek lists it with
// Open and no Ask (the recall act was retired) -> Open lands on the Jarvis surface.
//
// It injects the pet event rather than arranging a real utterance. A real one needs a headless CLI judge
// run (up to 90s) behind a 45-minute quiet window, which is the same live-model limit that keeps the
// cancel path and the thread-archive path unit-only (git show a4b5bd4f:docs/jarvis-tab.md). The hook is dev-only, exposed
// by petstore.ts under import.meta.env.DEV.
const jarvisVolunteer = {
    name: "jarvis-volunteer",
    surface: "cockpit", // the creature lives in window chrome, so any surface will do; start neutral
    async arrange() {
        return { id: `loose-end:cdp-probe:${Date.now()}` };
    },
    async assert(h, ctx) {
        const steps = [];

        // The creature's click TOGGLES the peek, so a run that starts with it already open would close it
        // instead and read as "no Open control". Normalise first: without this the scenario passes or
        // fails depending on what the previous run left behind, which is the one thing a regression net
        // must never do.
        await h.ev(`(() => {
            document.querySelector('button[aria-label="Close Jarvis panel"]')?.click();
            return true;
        })()`);
        await h.ev("new Promise((r) => setTimeout(r, 200))");

        const pushed = await h.ev(`(() => {
            const mod = globalThis.__wavePetStore;
            if (mod == null) return "petstore test hook not exposed (dev build?)";
            mod.pushPetEvent({
                id: ${JSON.stringify(ctx.id)},
                at: Date.now(),
                kind: "loose-end",
                text: "CDP probe - untouched for 21 days",
                sources: [{ ref: "task:cdp-probe", title: "CDP probe", sourceType: "dossier" }],
            });
            return true;
        })()`);
        // the speak effect runs on the events atom, then the bubble mounts
        await h.ev("new Promise((r) => setTimeout(r, 400))");
        steps.push({ step: "knowledge utterance pushed to the creature", ok: pushed === true, detail: String(pushed) });
        await h.shot("cdp-shots/jarvis-volunteer-bubble.png");

        // the bubble carries the register's label, which is the compiler-enforced half of the vocabulary.
        // Lowercased before matching: the label is styled `uppercase`, and innerText returns the RENDERED
        // text, so a literal "Still open" never matches.
        const spoke = await h.ev(`(() => {
            const t = (document.body.innerText || "").toLowerCase();
            return t.includes("still open") && t.includes("cdp probe");
        })()`);
        steps.push({
            step: 'bubble speaks it under the "Still open" register',
            ok: spoke === true,
            detail: String(spoke),
        });

        // open the peek: the two verbs live there, not on the bubble, which auto-dismisses after 6s.
        // The creature is a motion.div with role="button", not a <button>, so query the label directly.
        const opened = await h.ev(`(() => {
            const c = document.querySelector('[aria-label="Jarvis condition"]');
            if (!c) return "no creature control";
            c.click();
            return true;
        })()`);
        await h.ev("new Promise((r) => setTimeout(r, 300))");
        // assert the peek is actually OPEN, not merely that the click did not throw. Without this the step
        // passes on a click that toggled it shut, and the close assertion then passes vacuously too.
        const peekOpen = await h.ev(`document.querySelector('[data-pet-peek]') != null`);
        steps.push({
            step: "peek opens from the creature",
            ok: opened === true && peekOpen === true,
            detail: `clicked=${opened} open=${peekOpen}`,
        });
        await h.shot("cdp-shots/jarvis-volunteer-peek.png");

        // with no attention queue, the adaptive card shows the latest update directly. It keeps its Open act:
        // compacting the card must not turn the volunteered fact into a dead readout.
        const verbs = await h.ev(`(() => {
            const panel = document.querySelector('[data-pet-peek]');
            return {
                open: panel?.querySelector('[data-pet-act$=":open"]') != null,
                ask: panel?.querySelector('[data-pet-act$=":ask"]') != null,
            };
        })()`);
        steps.push({
            step: "latest update offers Open, and no retired Ask",
            ok: verbs?.open === true && verbs?.ask === false,
            detail: JSON.stringify(verbs),
        });

        const clicked = await h.ev(`(() => {
            const button = document.querySelector('[data-pet-peek] [data-pet-act$=":open"]');
            if (!button) return "no Open control";
            button.click();
            return true;
        })()`);
        await h.ev("new Promise((r) => setTimeout(r, 500))");
        const landed = await h.activeSurfaceLabel();
        steps.push({
            step: "Open navigates to the Jarvis surface",
            ok: clicked === true && landed === SURFACE_LABEL.jarvis,
            detail: `clicked=${clicked} surface=${landed}`,
        });
        await h.shot("cdp-shots/jarvis-volunteer-opened.png");

        // and it closes the peek on the way out: an overlay anchored to the creature, left open over a
        // surface it just navigated away from, is stranded
        const peekClosed = await h.ev(`document.querySelector('[data-pet-peek]') == null`);
        steps.push({ step: "peek closed on navigation", ok: peekClosed === true, detail: String(peekClosed) });

        return steps;
    },
    async teardown(h) {
        await h.ev(`(() => {
            // close the peek if a failed run left it open, and drop the watermark the injected utterance
            // advanced -- that key is persisted, so leaving it moved is a side effect on the user's own
            // creature rather than a test
            document.querySelector('button[aria-label="Close Jarvis panel"]')?.click();
            try {
                globalThis.localStorage?.removeItem("wave:pet.watermark");
            } catch {}
            return true;
        })()`);
        await h.goto("cockpit");
    },
};

// --- code: content search ----------------------------------------------------------------------
// Drives the real grep RPC, so it needs a backend built with GitGrepCommand (task build:backend).
// The query is a string this repository certainly contains; asserting "some rows" rather than an
// exact count keeps it from breaking on every edit.
const CODE_SEARCH_QUERY = "openInCode";

// Opens the project picker only when no project is loaded yet — the column tabs render only inside
// CodePanes, so their absence is the signal. Returns whether the picker was actually opened, because
// clicking a project row is only safe when it is.
const openProjectPicker = (h) =>
    h.ev(`(() => {
        if (document.querySelector('[data-code-column-tab]')) return false;
        const chip = document.querySelector('[data-code-project-picker]');
        if (!chip) return false;
        chip.click();
        return true;
    })()`);

// Scoped to the picker's own container, never the whole document: the app bar's global search
// button also carries a .font-mono child, so an unscoped query picks THAT and opens the command
// palette instead of selecting a project.
const chooseProjectRow = (h) =>
    h.ev(`(() => {
        const chip = document.querySelector('[data-code-project-picker]');
        const scope = chip && chip.parentElement;
        if (!scope) return false;
        const rows = [...scope.querySelectorAll('button')].filter((b) => b !== chip && b.querySelector('.font-mono'));
        if (!rows.length) return false;
        rows[0].click();
        return true;
    })()`);

const setSearchQuery = (h, text) =>
    h.ev(`(() => {
        const input = document.querySelector('input[placeholder="Search file contents"]');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
    })()`);

const setFinderQuery = (h, text) =>
    h.ev(`(() => {
        const input = document.querySelector('input[data-palette-input]');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        return true;
    })()`);

const codeSearch = {
    name: "code-search",
    surface: "code",
    async arrange() {
        return {};
    },
    async assert(h) {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const steps = [];
        await h.goto("code");
        steps.push({
            step: "Code surface is active",
            ok: (await h.activeSurfaceLabel()) === SURFACE_LABEL.code,
            detail: `active=${await h.activeSurfaceLabel()}`,
        });

        if ((await openProjectPicker(h)) === true) {
            await sleep(300);
            const picked = await chooseProjectRow(h);
            steps.push({ step: "select a project", ok: picked === true, detail: `picked=${picked}` });
            await sleep(1200); // the index is one git ls-files call
        }

        const switched = await h.ev(`(() => {
            const t = document.querySelector('[data-code-column-tab="search"]');
            if (!t) return false;
            t.click();
            return true;
        })()`);
        steps.push({ step: "switch the left column to Search", ok: switched === true, detail: `switched=${switched}` });

        const typed = await setSearchQuery(h, CODE_SEARCH_QUERY);
        steps.push({ step: "type a query and submit", ok: typed === true, detail: `typed=${typed}` });

        // poll rather than sleep a guessed interval: the RPC shells out to git. Take the LAST match so
        // the summary leaf wins over every ancestor div whose textContent also contains it.
        let summary = "";
        for (let i = 0; i < 20; i++) {
            summary = await h.ev(
                `(() => { const els=[...document.querySelectorAll('div')].filter((d)=>/match(es)? in \\d+ file/.test(d.textContent||'')); const el=els[els.length-1]; return el?(el.textContent||'').trim():''; })()`
            );
            if (summary) break;
            await sleep(500);
        }
        steps.push({
            step: `search "${CODE_SEARCH_QUERY}" reports a match summary`,
            ok: summary !== "",
            detail: `summary=${summary || "(none)"}`,
        });

        await h.shot("cdp-shots/code-search.png");
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit"); // leave the app where a human expects it
    },
};

const codeSidebar = {
    name: "code-sidebar",
    surface: "code",
    async arrange(h) {
        // unmount Code before seeding storage so the assertion starts from fresh component state.
        await h.goto("cockpit");
        const previous = await h.ev("localStorage.getItem('code.sidebar.prefs')");
        await h.ev(
            `localStorage.setItem('code.sidebar.prefs', ${JSON.stringify(
                JSON.stringify({ widths: { files: 280, search: 380, changed: 380 }, open: true })
            )})`
        );
        return { previous };
    },
    async assert(h, ctx) {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const steps = [];
        await h.goto("code");
        if ((await openProjectPicker(h)) === true) {
            await sleep(300);
            await chooseProjectRow(h);
            await sleep(1200);
        }
        ctx.previousMode = await h.ev(
            `document.querySelector('[data-code-column-tab][aria-pressed="true"]')?.getAttribute('data-code-column-tab') || null`
        );
        const files = await h.ev(`(() => {
            const button = document.querySelector('[data-code-column-tab="files"]');
            if (!button) return false;
            button.click();
            return true;
        })()`);
        await sleep(100);
        steps.push({ step: "start in Files mode", ok: files === true, detail: `selected=${files}` });
        const probe = () =>
            h.ev(`(() => {
                const sidebar = document.querySelector('[aria-label="Code sidebar"]');
                const grip = document.querySelector('[role="separator"][aria-label="Resize Code sidebar"]');
                return sidebar && grip ? {
                    width: Math.round(sidebar.getBoundingClientRect().width),
                    value: Number(grip.getAttribute('aria-valuenow')),
                    active: document.activeElement?.getAttribute('aria-label') || ''
                } : null;
            })()`);
        let initial = null;
        for (let i = 0; i < 10 && initial == null; i++) {
            initial = await probe();
            if (initial == null) await sleep(200);
        }
        steps.push({
            step: "Files starts at its remembered default width",
            ok: initial?.width === 280 && initial?.value === 280,
            detail: JSON.stringify(initial),
        });

        const search = await h.ev(`(() => {
            const tab = document.querySelector('[data-code-column-tab="search"]');
            if (!tab) return false;
            tab.click();
            return true;
        })()`);
        await sleep(200);
        const searchWidth = await probe();
        steps.push({
            step: "Search keeps its independent remembered width",
            ok: search === true && searchWidth?.width === 380,
            detail: JSON.stringify(searchWidth),
        });

        const gripFocused = await h.ev(`(() => {
            const grip = document.querySelector('[role="separator"][aria-label="Resize Code sidebar"]');
            if (!grip) return false;
            grip.focus();
            return document.activeElement === grip;
        })()`);
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
        await h.cdp("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "ArrowLeft",
            code: "ArrowLeft",
            modifiers: 8,
        });
        await h.cdp("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "ArrowLeft",
            code: "ArrowLeft",
            modifiers: 8,
        });
        const keyboard = gripFocused === true;
        await sleep(100);
        const keyboardWidth = await probe();
        steps.push({
            step: "Focused separator adjusts with keyboard without losing focus",
            ok: keyboard === true && keyboardWidth?.value === 356 && keyboardWidth?.active === "Resize Code sidebar",
            detail: JSON.stringify(keyboardWidth),
        });

        const collapsed = await h.ev(`(() => {
            const button = document.querySelector('button[aria-label="Collapse Code sidebar"]');
            if (!button) return false;
            button.click();
            return true;
        })()`);
        await sleep(200);
        const collapsedWidth = await probe();
        const openerFocused = await h.ev(`document.activeElement?.getAttribute('aria-label') || ''`);
        steps.push({
            step: "Collapse leaves a 36px reachable opener",
            ok: collapsed === true && collapsedWidth?.width === 36 && /Expand Code sidebar/.test(openerFocused),
            detail: JSON.stringify({ collapsedWidth, openerFocused }),
        });

        await h.cdp("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "f",
            code: "KeyF",
            modifiers: 10,
        });
        await h.cdp("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "f",
            code: "KeyF",
            modifiers: 10,
        });
        await sleep(200);
        const searchShortcut = await h.ev(`(() => {
            const tab = document.querySelector('[data-code-column-tab="search"]');
            const sidebar = document.querySelector('[aria-label="Code sidebar"]');
            return tab && sidebar ? {
                selected: tab.getAttribute('aria-pressed') === 'true',
                width: Math.round(sidebar.getBoundingClientRect().width),
                active: document.activeElement?.getAttribute('aria-label') || ''
            } : null;
        })()`);
        steps.push({
            step: "Ctrl+Shift+F expands the collapsed sidebar and selects Search",
            ok: searchShortcut?.selected === true && searchShortcut?.width === 356,
            detail: JSON.stringify(searchShortcut),
        });

        const collapsedForTree = await h.ev(`(() => {
            const button = document.querySelector('button[aria-label="Collapse Code sidebar"]');
            if (!button) return false;
            button.click();
            return true;
        })()`);
        await sleep(200);
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "t", code: "KeyT", modifiers: 1 });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "t", code: "KeyT", modifiers: 1 });
        await sleep(200);
        const treeShortcut = await h.ev(`(() => {
            const tree = document.querySelector('[data-code-tree]');
            const active = document.activeElement;
            return {
                collapsed: Math.round(document.querySelector('[aria-label="Code sidebar"]')?.getBoundingClientRect().width || 0) === 36,
                expanded: !!tree && !!active && tree.contains(active),
                active: active?.getAttribute('aria-label') || ''
            };
        })()`);
        steps.push({
            step: "Alt+T expands the collapsed sidebar before focusing the tree",
            ok: collapsedForTree === true && treeShortcut?.expanded === true,
            detail: JSON.stringify(treeShortcut),
        });

        await h.ev(`document.querySelector('button[aria-label="Collapse Code sidebar"]')?.click()`);
        await sleep(200);
        await h.ev(`document.querySelector('button[aria-label="Expand Code sidebar"]')?.click()`);
        await sleep(200);
        const reopened = await probe();
        steps.push({
            step: "Opener restores the selected mode width and focus",
            ok: reopened?.width === 280 && reopened?.active === "Collapse Code sidebar",
            detail: JSON.stringify(reopened),
        });

        await h.cdp("Emulation.setDeviceMetricsOverride", {
            width: 520,
            height: 950,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await sleep(300);
        const narrow = await probe();
        steps.push({
            step: "Narrow viewport temporarily compacts without changing the preference",
            ok: narrow?.width === 36 && /wider/.test(narrow?.active || ""),
            detail: JSON.stringify(narrow),
        });
        await h.cdp("Emulation.setDeviceMetricsOverride", {
            width: 1600,
            height: 950,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await sleep(300);
        const restored = await probe();
        steps.push({
            step: "Widening restores the open preference and remembered width",
            ok: restored?.width === 280 && restored?.active === "Collapse Code sidebar",
            detail: JSON.stringify(restored),
        });
        await h.shot("cdp-shots/code-sidebar.png");
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(
            `(() => {
                const previousMode = ${JSON.stringify(ctx.previousMode ?? null)};
                if (previousMode === 'files' || previousMode === 'search' || previousMode === 'changed') {
                    document.querySelector(
                        '[data-code-column-tab="' + previousMode + '"]'
                    )?.click();
                }
                const previous = ${JSON.stringify(ctx.previous)};
                if (previous == null) localStorage.removeItem('code.sidebar.prefs');
                else localStorage.setItem('code.sidebar.prefs', previous);
            })()`
        );
        await h.goto("cockpit");
    },
};

const codeGitStatus = {
    name: "code-git-status",
    surface: "code",
    async arrange() {
        return {};
    },
    async assert(h) {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const steps = [];
        await h.goto("code");
        steps.push({
            step: "Code surface is active",
            ok: (await h.activeSurfaceLabel()) === SURFACE_LABEL.code,
            detail: `active=${await h.activeSurfaceLabel()}`,
        });

        if ((await openProjectPicker(h)) === true) {
            await sleep(300);
            const picked = await chooseProjectRow(h);
            steps.push({ step: "select a project", ok: picked === true, detail: `picked=${picked}` });
            await sleep(1200); // the index is one git ls-files call, status one git status call
        }

        const switched = await h.ev(`(() => {
            const t = document.querySelector('[data-code-column-tab="changed"]');
            if (!t) return false;
            t.click();
            return true;
        })()`);
        steps.push({
            step: "switch the left column to Changed",
            ok: switched === true,
            detail: `switched=${switched}`,
        });

        // poll rather than sleep a guessed interval: status shells out to git
        let rowPath = "";
        for (let i = 0; i < 20; i++) {
            rowPath = await h.ev(
                `(() => { const r = document.querySelector('[data-code-changed-row]'); return r ? r.getAttribute('data-code-changed-row') : ''; })()`
            );
            if (rowPath) break;
            await sleep(500);
        }
        steps.push({
            step: "the Changed column lists at least one changed file",
            ok: rowPath !== "",
            detail: `first=${rowPath || "(none)"}`,
        });

        const counts = await h.ev(
            `(() => { const r = document.querySelector('[data-code-changed-row]'); return r ? (r.textContent || '').trim() : ''; })()`
        );
        steps.push({
            step: "a changed row carries its +/- counts",
            ok: /\+\d+/.test(counts) && /-\d+/.test(counts),
            detail: `row="${counts}"`,
        });
        await h.shot("cdp-shots/code-changed.png");

        // scoped to the row container, never a document-wide button query
        const clicked = await h.ev(`(() => {
            const r = document.querySelector('[data-code-changed-row]');
            if (!r) return false;
            r.click();
            return true;
        })()`);
        steps.push({ step: "click the first changed row", ok: clicked === true, detail: `clicked=${clicked}` });
        await sleep(900); // one stat-then-read round trip

        const openPath = await h.ev(
            `(() => { const p = document.querySelector('[data-code-path]'); return p ? p.getAttribute('data-code-path') : ''; })()`
        );
        steps.push({
            step: "the editor opened on that path",
            ok: openPath === rowPath,
            detail: `open=${openPath} want=${rowPath}`,
        });

        const backToFiles = await h.ev(`(() => {
            const t = document.querySelector('[data-code-column-tab="files"]');
            if (!t) return false;
            t.click();
            return true;
        })()`);
        await sleep(400);
        const letters = await h.ev(`(() => document.querySelectorAll('[data-code-status]').length)()`);
        steps.push({
            step: "the tree paints a status letter on the revealed file",
            ok: backToFiles === true && letters > 0,
            detail: `letters=${letters}`,
        });
        await h.shot("cdp-shots/code-git-status.png");
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit"); // leave the app where a human expects it
    },
};

const codeDiff = {
    name: "code-diff",
    surface: "code",
    // its own repo with exactly one uncommitted edit: final-verify boots a fresh store with no projects
    async arrange(h) {
        const dir = mkdtempSync(join(tmpdir(), "verify-code-diff-"));
        git(dir, "init", "-q", "--initial-branch=main");
        writeFileSync(
            join(dir, "policy.go"),
            `package retry

func Budget() int {
    return 3
}
`
        );
        git(dir, "add", ".");
        git(dir, "commit", "-q", "-m", "seed the retry package");
        writeFileSync(
            join(dir, "policy.go"),
            `package retry

func Budget() int {
    return 8
}
`
        );
        const name = "verify-code-diff";
        await h.rpc("createproject", { name, path: dir });
        await waitForProjectInConfig(h, name);
        try {
            await h.ev("location.reload()");
        } catch {
            /* the evaluate is cut off by the navigation it just started */
        }
        for (let waited = 0; waited < 30000; waited += 500) {
            const up = await h
                .ev("!!window.TabRpcClient && !!document.querySelector('nav button')")
                .catch(() => false);
            if (up) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        return { dir, name };
    },
    async assert(h, ctx) {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const steps = [];
        await h.goto("code");
        if ((await openProjectPicker(h)) === true) {
            await sleep(300);
            // not chooseProjectRow: rows[0] may be any registered project, and the step-1 check pins policy.go
            await h.ev(`(() => {
                const chip = document.querySelector('[data-code-project-picker]');
                const scope = chip && chip.parentElement;
                if (!scope) return false;
                const row = [...scope.querySelectorAll('button')].find(
                    (b) => b !== chip && (b.textContent || '').includes(${JSON.stringify(ctx.name)})
                );
                if (!row) return false;
                row.click();
                return true;
            })()`);
            await sleep(1200);
        }

        // the Changed column guarantees the file we open actually differs from HEAD
        await h.ev(`(() => {
            const t = document.querySelector('[data-code-column-tab="changed"]');
            if (t) t.click();
            return true;
        })()`);
        let rowPath = "";
        for (let i = 0; i < 20; i++) {
            rowPath = await h.ev(
                `(() => { const r = document.querySelector('[data-code-changed-row]'); return r ? r.getAttribute('data-code-changed-row') : ''; })()`
            );
            if (rowPath) break;
            await sleep(500);
        }
        const opened = await h.ev(`(() => {
            const r = document.querySelector('[data-code-changed-row]');
            if (!r) return false;
            r.click();
            return true;
        })()`);
        steps.push({
            step: "open a file that differs from HEAD",
            ok: opened === true && rowPath === "policy.go",
            detail: `path=${rowPath || "(none)"}`,
        });
        await sleep(900);

        const toDiff = await h.ev(`(() => {
            const b = document.querySelector('[data-code-view-mode="diff"]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await sleep(1500); // monaco is lazy, and the HEAD read is one git call
        const mounted = await h.ev(`(() => !!document.querySelector('.monaco-diff-editor'))()`);
        steps.push({
            step: "Diff mounts the Monaco diff editor",
            ok: toDiff === true && mounted === true,
            detail: `toggled=${toDiff} mounted=${mounted}`,
        });
        await h.shot("cdp-shots/code-diff.png");

        // `d` is gated on !editable, so focus has to leave Monaco first
        await h.ev(`(() => {
            const t = document.querySelector('[data-code-tree]');
            if (t) t.focus();
            return true;
        })()`);
        await h.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }))`);
        await sleep(800);
        const back = await h.ev(
            `(() => ({ diff: !!document.querySelector('.monaco-diff-editor'), plain: !!document.querySelector('.monaco-editor') }))()`
        );
        steps.push({
            step: "pressing d again returns to the single editor",
            ok: back.diff === false && back.plain === true,
            detail: `diff=${back.diff} plain=${back.plain}`,
        });
        return steps;
    },
    async teardown(h, ctx) {
        await h.goto("cockpit"); // leave the app where a human expects it
        try {
            await h.rpc("deleteproject", { name: ctx.name });
        } catch {
            /* leave a stale registry entry rather than failing teardown */
        }
        try {
            rmSync(ctx.dir, { recursive: true, force: true });
        } catch {
            /* a leftover temp repo is cheaper than a failed teardown */
        }
    },
};

// --- terminal palette follows the cockpit theme -------------------------------------------------
// Asserts against window.term (term.tsx assigns it) + the resolved custom properties, NOT pixels:
// reading the applied xterm theme is exact, where a screenshot sample is not. The shots are for a
// human to judge whether Claude Code's own diff colors read well, which no assertion can decide.
const terminalTheme = {
    name: "terminal-theme",
    surface: "agent",
    async arrange(h) {
        // step 4 reads window.term, which an HMR can leave pointing at a detached TermWrap — see freshBoot
        return { booted: await freshBoot(h) };
    },
    async assert(h, ctx) {
        const steps = [];
        steps.push({
            step: "0. fresh boot, so window.term is the mounted terminal",
            ok: ctx.booted === true,
            detail: `reloaded=${ctx.booted}`,
        });
        const readVar = (name) =>
            h.ev(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);
        const readTheme = (field) => h.ev(`window.term?.terminal?.options?.theme?.${field} ?? null`);
        // Scoped to the theme grid: a document-wide button query picks the app bar's global search
        // button instead of the preset the name belongs to (see cdp-scenario-unscoped-button-query).
        const pickPreset = (name) =>
            h.ev(`(() => {
                const scope = document.querySelector('[data-theme-presets]') || document;
                const b = [...scope.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(name)});
                if (!b) return false;
                b.click();
                return true;
            })()`);

        await h.goto("agent");
        const bg = await readTheme("background");
        const cssBg = await readVar("--color-background");
        steps.push({
            step: "1. xterm background === --color-background (the black seam is gone)",
            ok: !!bg && bg.toLowerCase() === cssBg.toLowerCase(),
            detail: `xterm=${bg} css=${cssBg}`,
        });

        const blue = await readTheme("blue");
        const cssAccent = await readVar("--color-accent");
        steps.push({
            step: "2. xterm ANSI blue === --color-accent (palette derives from theme roles)",
            ok: !!blue && blue.toLowerCase() === cssAccent.toLowerCase(),
            detail: `blue=${blue} accent=${cssAccent}`,
        });

        steps.push({
            step: "3. xterm background is opaque (#rrggbb, never #00000000)",
            ok: typeof bg === "string" && /^#[0-9a-f]{6}$/i.test(bg),
            detail: `background=${bg}`,
        });
        await h.shot("cdp-shots/terminal-theme-midnight.png");

        // switch presets in Settings, return to the Agent surface, and confirm the TUI re-skinned
        await h.goto("settings");
        const picked = await pickPreset("Monokai");
        await h.goto("agent");
        const bg2 = await readTheme("background");
        steps.push({
            step: "4. switching preset re-skins the live TUI with no remount",
            ok: picked && !!bg2 && bg2.toLowerCase() !== bg.toLowerCase(),
            detail: `picked=${picked} before=${bg} after=${bg2}`,
        });
        await h.shot("cdp-shots/terminal-theme-monokai.png");
        return steps;
    },
    async teardown(h) {
        // restore the default preset so a later scenario is not judged against Monokai
        await h.goto("settings");
        await h.ev(`(() => {
            const scope = document.querySelector('[data-theme-presets]') || document;
            const b = [...scope.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Midnight');
            if (b) b.click();
            return true;
        })()`);
        await h.goto("cockpit");
    },
};

// --- cockpit chords reach through a focused TUI -------------------------------------------------
// The leak is the failure mode that matters, so every step below asserts CONSUMPTION as well as
// effect. How consumption is observed, and why it is not a terminal-buffer diff:
//
// The dispatcher listens on window CAPTURE and calls stopImmediatePropagation() for a key it claims
// (dispatcher.ts). A sibling window-capture listener registered afterwards therefore fires only for
// keys the cockpit did NOT claim — and a claimed key raises no event anywhere, so it cannot reach
// xterm's textarea handler and cannot reach the PTY. Every step carries a control press through the
// same probe, so "consumed" can never be a silent no-op.
//
// Two observables that look more direct are unusable here. A terminal-buffer diff only moves when a
// live shell echoes, and the dev app's terminals are frequently idle — the diff then reads "no leak"
// for every key, including one that leaked. A probe on the xterm textarea is worse: xterm's own
// handler is registered on that element first and stops immediate propagation, so an unclaimed key
// looks identical to a claimed one.
const CTRL = 2; // CDP Input.dispatchKeyEvent modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8

// Focus the terminal by clicking its body: terminal.focus() alone leaves document.activeElement on
// BODY, which would make every assertion below run in the wrong (non-editable) posture.
const focusTui = async (h) => {
    await h.goto("agent");
    const box = await h.ev(`(() => {
        const el = document.querySelector('.cockpit-focus-pane .xterm-screen') || document.querySelector('.cockpit-focus-pane');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!box) return false;
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
    await new Promise((r) => setTimeout(r, 500));
    return h.ev(
        `(() => { const a = document.activeElement; return !!(a && a.classList && a.classList.contains('xterm-helper-textarea')); })()`
    );
};

// A full page reload, for two reasons that both bite only after a dev-session hot reload:
//
//  1. Probe ordering. Capture-phase listeners on the same target run in REGISTRATION order, so the
//     consumption probe below is valid only when the dispatcher registered first. Boot registers it;
//     an HMR of a keybinding file re-registers it at the BACK of the queue, after the probe, and every
//     "consumed" step then reports a leak that is not real.
//  2. window.term freshness. term.tsx assigns window.term on mount. After an HMR the global can point
//     at a DETACHED TermWrap whose TermThemeUpdater is gone, so its options.theme never changes again
//     and "switching preset re-skins the TUI" fails against a terminal that is no longer on screen.
//
// Both failure modes are safe in direction (no false PASS) but waste a run, so pay the reload.
const freshBoot = async (h) => {
    await h.ev("location.reload()");
    for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const ready = await h.ev(`document.querySelectorAll('nav button').length > 0`).catch(() => false);
        if (ready) {
            await new Promise((r) => setTimeout(r, 1500)); // let boot settle before driving it
            return true;
        }
    }
    return false;
};

const installProbe = (h) =>
    h.ev(`(() => {
        window.__seen = [];
        window.__probeFn = (e) => window.__seen.push((e.ctrlKey ? "Ctrl+" : "") + e.key);
        window.addEventListener("keydown", window.__probeFn, true);
        return true;
    })()`);

// Returns the keys the probe saw: [] means the cockpit consumed the press.
const pressKey = async (h, { key, code, keyCode, modifiers = 0 }) => {
    await h.ev("window.__seen = []");
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, modifiers, windowsVirtualKeyCode: keyCode });
    }
    await new Promise((r) => setTimeout(r, 450));
    return JSON.parse(await h.ev("JSON.stringify(window.__seen || [])"));
};
const whichKeyOpen = (h) => h.ev(`document.body.innerText.includes('Cockpit (home)')`);
const treeVisible = (h) => h.ev(`!!document.querySelector('[data-agent-tree]')`);

const tuiLeader = {
    name: "tui-leader",
    surface: "agent",
    async arrange(h) {
        const booted = await freshBoot(h);
        const focused = await focusTui(h);
        await installProbe(h);
        return { booted, focused };
    },
    async assert(h, ctx) {
        const steps = [];
        steps.push({
            step: "0. the terminal holds focus, so these run in the editable posture",
            ok: ctx.booted === true && ctx.focused === true,
            detail: `reloaded=${ctx.booted} xterm textarea focused=${ctx.focused}`,
        });

        // Control press. Without this, every "consumed" verdict below could be a dead probe.
        const seenX = await pressKey(h, { key: "x", code: "KeyX", keyCode: 88 });
        steps.push({
            step: "1. control: an unclaimed key is NOT consumed (the probe is live)",
            ok: seenX.length > 0,
            detail: `probe saw ${JSON.stringify(seenX)}`,
        });

        // The pre-existing posture must not regress: a bare letter still belongs to the agent.
        const seenG = await pressKey(h, { key: "g", code: "KeyG", keyCode: 71 });
        const wkBare = await whichKeyOpen(h);
        steps.push({
            step: "2. a bare g still reaches the agent and opens no leader",
            ok: seenG.length > 0 && wkBare === false,
            detail: `probe saw ${JSON.stringify(seenG)}, which-key=${wkBare}`,
        });

        const seenCtrlG = await pressKey(h, { key: "g", code: "KeyG", keyCode: 71, modifiers: CTRL });
        const wkChord = await whichKeyOpen(h);
        steps.push({
            step: "3. Ctrl+G opens the which-key bar and is consumed (no ^G to the PTY)",
            ok: seenCtrlG.length === 0 && wkChord === true,
            detail: `probe saw ${JSON.stringify(seenCtrlG)}, which-key=${wkChord}`,
        });

        // singles fallback: `]` is a navigate-guarded single, dormant in the TUI without a leader
        const surfBefore = await h.activeSurfaceLabel();
        const seenBracket = await pressKey(h, { key: "]", code: "BracketRight", keyCode: 221 });
        const surfAfter = await h.activeSurfaceLabel();
        steps.push({
            step: "4. under the leader, the singles fallback runs ']' and consumes it",
            ok: seenBracket.length === 0 && surfAfter !== surfBefore,
            detail: `${surfBefore} -> ${surfAfter}, probe saw ${JSON.stringify(seenBracket)}`,
        });

        // sequence continuation from inside the terminal
        await focusTui(h);
        await pressKey(h, { key: "g", code: "KeyG", keyCode: 71, modifiers: CTRL });
        const seenC = await pressKey(h, { key: "c", code: "KeyC", keyCode: 67 });
        const surfC = await h.activeSurfaceLabel();
        steps.push({
            step: "5. Ctrl+G then c teleports to Jarvis from inside the terminal",
            ok: seenC.length === 0 && surfC === SURFACE_LABEL.jarvis,
            detail: `active=${surfC}, probe saw ${JSON.stringify(seenC)}`,
        });

        // Escape means cancel while the which-key bar is showing — never navigate (spec decision 8)
        await focusTui(h);
        await pressKey(h, { key: "g", code: "KeyG", keyCode: 71, modifiers: CTRL });
        const wkOn = await whichKeyOpen(h);
        const escFrom = await h.activeSurfaceLabel();
        await pressKey(h, { key: "Escape", code: "Escape", keyCode: 27 });
        const wkOff = await whichKeyOpen(h);
        const escTo = await h.activeSurfaceLabel();
        steps.push({
            step: "6. Ctrl+G then Escape cancels the leader without navigating",
            ok: wkOn === true && wkOff === false && escTo === escFrom,
            detail: `which-key ${wkOn}->${wkOff}, surface ${escFrom}->${escTo}`,
        });

        await h.shot("cdp-shots/tui-leader.png");
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

const tuiFullscreen = {
    name: "tui-fullscreen",
    surface: "agent",
    async arrange(h) {
        await freshBoot(h);
        const focused = await focusTui(h);
        await installProbe(h);
        return { focused };
    },
    async assert(h, ctx) {
        const steps = [];
        // fullscreen unmounts the agent tree (agentsurface.tsx); its absence is the observable
        const before = await treeVisible(h);
        const winBefore = await h.ev(
            `JSON.stringify({fullscreenEl: !!document.fullscreenElement, w: window.innerWidth, h: window.innerHeight})`
        );
        const seen = await pressKey(h, { key: "F11", code: "F11", keyCode: 122 });
        const after = await treeVisible(h);
        const winAfter = await h.ev(
            `JSON.stringify({fullscreenEl: !!document.fullscreenElement, w: window.innerWidth, h: window.innerHeight})`
        );
        steps.push({
            step: "1. F11 toggles terminal fullscreen and is consumed (no F11 to the PTY)",
            ok: ctx.focused === true && seen.length === 0 && after !== before,
            detail: `focused=${ctx.focused}, treeVisible ${before} -> ${after}, probe saw ${JSON.stringify(seen)}`,
        });
        // the specific worry about F11: that WebView2 answers it with its own fullscreen, the way an
        // unclaimed Ctrl+P once reached it and raised a print dialog (ccc90133)
        steps.push({
            step: "2. no WebView2 fullscreen default fired (viewport unchanged)",
            ok: winBefore === winAfter,
            detail: `${winBefore} -> ${winAfter}`,
        });
        await h.shot("cdp-shots/tui-fullscreen.png");
        await pressKey(h, { key: "F11", code: "F11", keyCode: 122 });
        const restored = await treeVisible(h);
        steps.push({
            step: "3. F11 again restores the split view",
            ok: restored === before,
            detail: `treeVisible=${restored}`,
        });
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// --- harness picker: shared preference, composer blocking, one-off ask, legacy labels --------------
// Drives the Launch composer's harness picker and the shared preference atom. No worker is ever spawned:
// the goal stays a draft, and the one real Run this scenario creates is a legacy object injected via
// eventpublish (missing runtime), so the header/summary labels are exercised without a harness.
const harnessPicker = {
    name: "harness-picker",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-harness-"));
        const wslist = await h.rpc("workspacelist", null);
        const workspaceId = wslist[0].workspacedata.oid;
        const ch = await h.rpc("createchannel", { name: "verify-harness", projectpath: cwd });
        // save + clear the shared preference so the scenario starts from "choose a harness"
        const cfg = await h.rpc("getfullconfig", null);
        const prev = cfg?.settings?.["harness:preferredruntime"] ?? "";
        if (prev !== "") {
            await h.rpc("setconfig", { "harness:preferredruntime": "" });
        }
        return { cwd, workspaceId, channelId: ch.oid, prev };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const picker = (operation) =>
            h.ev(`(() => {
                const p = [...document.querySelectorAll('[data-testid="harness-picker"]')]
                    .find((x) => x.getAttribute('data-harness-operation') === ${JSON.stringify(operation)});
                return p ? {
                    runtime: p.getAttribute('data-harness-runtime') || '',
                    label: (p.textContent || '').trim(),
                } : null;
            })()`);
        const submitDisabled = () =>
            h.ev(`(() => {
                const b = document.querySelector('[data-testid="composer-action"]');
                return b ? b.disabled : null;
            })()`);

        await h.goto("jarvis");
        // open the Launch composer: select the channel in the Subjects column
        await h.ev(`(() => {
            const b = [...document.querySelectorAll('[data-jarvis-subject-kind]')]
                .find((x) => (x.textContent || '').includes('verify-harness'));
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await settle(900);

        const empty = await picker("run-worker");
        rec(
            "1. Launch composer shows 'Choose harness' with the preference cleared",
            empty != null && empty.runtime === "" && empty.label.includes("Choose harness"),
            JSON.stringify(empty)
        );
        const disabledEmpty = await submitDisabled();
        rec("2. Run action disabled without a harness", disabledEmpty === true, `disabled=${disabledEmpty}`);

        // footer order: picker (footerLeft) before attachment (footerRight) before the action button
        const order = await h.ev(`(() => {
            const shell = document.querySelector('[data-testid="composer-action"]')?.closest('.flex.items-center.gap-2\\\\.5');
            if (!shell) return null;
            const tags = [...shell.children].map((c) =>
                c.getAttribute('data-testid') || c.textContent.trim().slice(0, 24));
            return tags;
        })()`);
        rec(
            "3. footer order: picker, behavior, attachment, action",
            Array.isArray(order) &&
                order[0].includes("harness-picker") &&
                order.some((t) => t.includes("composer-attachment")),
            JSON.stringify(order)
        );

        // open the picker, assert installed/disabled rows, then select OpenCode
        await h.ev(`(() => {
            const b = document.querySelector('[data-testid="harness-picker"][data-harness-operation="run-worker"]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await settle(300);
        const rows = await h.ev(`(() => {
            const opts = [...document.querySelectorAll('[data-testid^="harness-option-"]')].map((o) => ({
                runtime: o.getAttribute('data-testid').replace('harness-option-', ''),
                disabled: o.disabled,
            }));
            return opts;
        })()`);
        rec(
            "4. picker lists catalog rows incl. pi, uninstalled disabled",
            Array.isArray(rows) &&
                rows.length >= 3 &&
                rows.some((r) => r.disabled) &&
                rows.some((r) => r.runtime === "pi"),
            JSON.stringify(rows)
        );

        // every catalog row renders its brand mark as a LOCAL bundled asset (same-origin in dev), and
        // the OpenCode and Pi marks must actually decode (naturalWidth > 0), not be dead srcs.
        const marks = await h.ev(`(() => {
            const imgs = [...document.querySelectorAll('[data-testid^="harness-option-"] img')];
            const sameOrigin = (src) => { try { return new URL(src).origin === location.origin; } catch { return false; } };
            return {
                count: imgs.length,
                opencode: imgs.some((i) => i.src.includes("opencode") && i.naturalWidth > 0),
                pi: imgs.some((i) => i.src.includes("pi.svg") && i.naturalWidth > 0),
                remote: imgs.filter((i) => !sameOrigin(i.src)).length,
            };
        })()`);
        rec(
            "5. picker rows render local loaded runtime marks for OpenCode and Pi",
            marks.count >= 2 && marks.opencode && marks.pi && marks.remote === 0,
            JSON.stringify(marks)
        );
        const picked = await h.ev(`(() => {
            const o = document.querySelector('[data-testid="harness-option-opencode"]');
            if (!o) return false;
            o.click();
            return true;
        })()`);
        await settle(600); // wait for SetConfigCommand to persist
        const afterOpen = await picker("run-worker");
        rec(
            "6. selecting OpenCode persists it as the shared preference",
            picked && afterOpen != null && afterOpen.runtime === "opencode",
            JSON.stringify(afterOpen)
        );

        // bare ask uses the preferred runtime; an explicit @ask override is one-off
        const ta = () =>
            h.ev(`(() => {
                const t = document.querySelector('[data-jarvis-composer] textarea');
                if (!t) return false;
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                setter.call(t, ${JSON.stringify("inspect the auth path")});
                t.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            })()`);
        await ta();
        await settle(200);
        const footerText = await h.ev(`(() => {
            const shell = document.querySelector('[data-testid="composer-action"]')?.closest('.flex.items-center.gap-2\\\\.5');
            return shell ? shell.textContent.trim() : '';
        })()`);
        rec(
            "7. bare goal footer names the preferred harness",
            footerText.includes("OpenCode"),
            `footer=${footerText.slice(0, 80)}`
        );
        const oneOff = await h.ev(`(() => {
            const t = document.querySelector('[data-jarvis-composer] textarea');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(t, ${JSON.stringify("@ask codex inspect")});
            t.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);
        await settle(200);
        const footerOneOff = await h.ev(`(() => {
            const shell = document.querySelector('[data-testid="composer-action"]')?.closest('.flex.items-center.gap-2\\\\.5');
            return shell ? shell.textContent.trim() : '';
        })()`);
        rec(
            "8. explicit @ask shows Codex · one-off, preference unchanged",
            oneOff &&
                footerOneOff.includes("one-off") &&
                footerOneOff.includes("OpenCode") &&
                !footerOneOff.includes("preferred codex"),
            `footer=${footerOneOff.slice(0, 100)}`
        );

        // Pi selection is conditional on installation: the row always exists (step 4), but selecting it
        // only when pi is on PATH. Restore OpenCode afterward so the remaining steps keep their
        // expected preference.
        const piRow = await h.ev(`(() => {
            const o = document.querySelector('[data-testid="harness-option-pi"]');
            return o ? { disabled: o.disabled } : null;
        })()`);
        let piPicked = null;
        if (piRow != null && !piRow.disabled) {
            await h.ev(`(() => {
                const o = document.querySelector('[data-testid="harness-option-pi"]');
                o.click();
                return true;
            })()`);
            await settle(600); // wait for SetConfigCommand to persist
            piPicked = await picker("run-worker");
            const restored = await h.ev(`(() => {
                const o = document.querySelector('[data-testid="harness-option-opencode"]');
                if (!o) return false;
                o.click();
                return true;
            })()`);
            await settle(600);
            rec(
                "9. selecting Pi persists it as the shared preference when installed",
                piPicked != null && piPicked.runtime === "pi" && restored,
                JSON.stringify({ picked: piPicked, restored })
            );
        } else {
            rec(
                "9. selecting Pi persists it as the shared preference when installed",
                piRow != null,
                "pi uninstalled — row asserted only"
            );
        }

        // blocked submission preserves draft + attachment: attach a file, submit, then assert both remain
        await h.ev(`(() => {
            const t = document.querySelector('[data-jarvis-composer] textarea');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(t, ${JSON.stringify("this must not dispatch")});
            t.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);
        const draftBefore = await h.ev(`document.querySelector('[data-jarvis-composer] textarea')?.value || ''`);
        await h.ev(`(() => {
            const a = document.querySelector('[data-testid="composer-attachment"] input');
            if (!a) return false;
            a.disabled = false;
            return true;
        })()`);
        await h.ev(`(() => {
            const b = document.querySelector('[data-testid="composer-action"]');
            b.click();
            return true;
        })()`);
        await settle(300);
        const draftAfter = await h.ev(`document.querySelector('[data-jarvis-composer] textarea')?.value || ''`);
        rec(
            "10. a blocked dispatch preserves the draft",
            draftBefore.includes("this must not dispatch") && draftAfter === draftBefore,
            `before=${draftBefore.length} after=${draftAfter.length}`
        );

        // legacy label: inject a Run object with no runtime via eventpublish, then assert the header label
        const legacyId = "00000000-0000-0000-0000-0000000000ff";
        await h.rpc("eventpublish", {
            event: "waveobj:update",
            scopes: [`run:${legacyId}`],
            data: {
                updatetype: "update",
                otype: "run",
                oid: legacyId,
                obj: {
                    otype: "run",
                    oid: legacyId,
                    version: 1,
                    meta: {},
                    id: legacyId,
                    goal: "legacy run",
                    workspaceid: ctx.workspaceId,
                    projectpath: ctx.cwd,
                    status: "done",
                    phases: [],
                    createdts: Date.now(),
                },
            },
        });
        const legacy = await h.ev(`(() => {
            const el = document.querySelector('[data-testid="run-runtime"]');
            return el ? { label: el.textContent.trim(), legacy: el.getAttribute('data-run-legacy') } : null;
        })()`);
        rec(
            "11. a missing-runtime Run renders Claude · legacy",
            legacy != null && legacy.label.includes("Claude · legacy") && legacy.legacy === "true",
            JSON.stringify(legacy)
        );

        return steps;
    },
    async teardown(h, ctx) {
        // restore the prior preference and drop the fixture channel
        if (ctx.prev !== "") {
            try {
                await h.rpc("setconfig", { "harness:preferredruntime": ctx.prev });
            } catch {
                // best-effort cleanup
            }
        } else {
            try {
                await h.rpc("setconfig", { "harness:preferredruntime": "" });
            } catch {
                // best-effort cleanup
            }
        }
        try {
            await h.rpc("deletechannel", { channelid: ctx.channelId });
        } catch {
            // best-effort cleanup
        }
        try {
            rmSync(ctx.cwd, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
        await h.goto("cockpit");
    },
};

const codeMarkdown = {
    name: "code-markdown",
    surface: "code",
    async arrange() {
        return {};
    },
    async assert(h) {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const steps = [];
        await h.goto("code");
        steps.push({
            step: "Code surface is active",
            ok: (await h.activeSurfaceLabel()) === SURFACE_LABEL.code,
            detail: `active=${await h.activeSurfaceLabel()}`,
        });

        if ((await openProjectPicker(h)) === true) {
            await sleep(300);
            const picked = await chooseProjectRow(h);
            steps.push({ step: "select a project", ok: picked === true, detail: `picked=${picked}` });
            await sleep(1200); // the index is one git ls-files call
        }

        // Ctrl+P on Code opens the search on its Files scope; Enter opens the top-ranked match
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }))`
        );
        await sleep(300);
        const typed = await setFinderQuery(h, "README.md");
        steps.push({
            step: "open the finder with Ctrl+P and open README.md",
            ok: typed === true,
            detail: `typed=${typed}`,
        });
        await sleep(800); // one stat-then-read round trip

        const heading = await h.ev(`(() => {
            const h = document.querySelector('.markdown .heading');
            return h ? (h.textContent || '').trim() : null;
        })()`);
        steps.push({
            step: "markdown file renders as a document (a heading is present)",
            ok: heading != null && heading.length > 0,
            detail: `heading=${heading}`,
        });
        await h.shot("cdp-shots/code-markdown-preview.png");

        await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
        await sleep(100);
        const filesSelected = await h.ev(
            `document.querySelector('[data-code-column-tab="files"]')?.getAttribute('aria-pressed') === 'true'`
        );
        await h.ev(`(() => {
            window.__codeMarkdownNodes = [
                document.querySelector('.markdown .heading'),
                document.querySelector('.markdown .paragraph'),
            ];
            document.querySelector('[data-code-column-tab="changed"]')?.click();
        })()`);
        await sleep(100);
        const stableRender = await h.ev(`(() => {
            const before = window.__codeMarkdownNodes;
            delete window.__codeMarkdownNodes;
            return {
                changedSelected: document.querySelector('[data-code-column-tab="changed"]')?.getAttribute('aria-pressed') === 'true',
                nodesPreserved: Array.isArray(before)
                    && before[0] != null
                    && before[1] != null
                    && before[0] === document.querySelector('.markdown .heading')
                    && before[1] === document.querySelector('.markdown .paragraph'),
            };
        })()`);
        steps.push({
            step: "unrelated Code pane updates preserve the rendered document nodes",
            ok:
                filesSelected === true &&
                stableRender?.changedSelected === true &&
                stableRender?.nodesPreserved === true,
            detail: JSON.stringify({ filesSelected, ...stableRender }),
        });

        const toSource = await h.ev(`(() => {
            const b = document.querySelector('[data-code-view-mode="source"]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await sleep(600);
        const editor = await h.ev(`(() => !!document.querySelector('.monaco-editor'))()`);
        steps.push({
            step: "toggle to Source mounts the Monaco editor",
            ok: toSource === true && editor === true,
            detail: `toggled=${toSource} editor=${editor}`,
        });

        const backToPreview = await h.ev(`(() => {
            const b = document.querySelector('[data-code-view-mode="preview"]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await sleep(400);
        const previewAgain = await h.ev(`(() => !!document.querySelector('.markdown .heading'))()`);
        steps.push({
            step: "toggle back to Preview re-renders the document",
            ok: backToPreview === true && previewAgain === true,
            detail: `toggled=${backToPreview} preview=${previewAgain}`,
        });

        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// --- dag lifecycle: engine + graph surface ----------------------------------------------------
// Drives the real DagSubmit/DagAction/DagMerge RPCs through an orchestrator-mode run, then opens
// the graph surface and asserts the ReactFlow canvas renders the submitted nodes. Blast radius is
// contained: temp-dir project, worker blocks killed in teardown (deleteblock -> ShellProc.Close), channel deleted.
const dagLifecycle = {
    name: "dag-lifecycle",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-dag-"));
        const wslist = await h.rpc("workspacelist", null);
        const workspaceId = wslist[0].workspacedata.oid;
        const ch = await h.rpc("createchannel", { name: "verify-dag", projectpath: cwd });
        return { cwd, workspaceId, channelId: ch.oid };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const getRun = async (runId) => (await channelRuns(h, ctx.channelId)).find((x) => x.id === runId);
        const getChannelRunCount = async () => (await channelRuns(h, ctx.channelId)).length;

        const clickRetry = (findJs, tries = 8) =>
            h.ev(`(async () => {
                for (let i = 0; i < ${tries}; i++) {
                    const b = ${findJs};
                    if (b) { b.click(); return true; }
                    await new Promise((r) => setTimeout(r, 500));
                }
                return false;
            })()`);

        // The draft-first DAG composer no longer exists: 4296d92d removed the draft modal and the
        // `kind: "draft"` state it was driven through, leaving the live modal as the only DAG UI. So a
        // DAG is created here the way the lead creates one — an orchestrator run held in planning by
        // DeferStart, then an explicit DagSubmit — and the DOM half below asserts only what survived.
        const beforePlanning = await getChannelRunCount();
        const parentGoal = "verify dag: do nothing, make no file changes, stop immediately";
        const dagTitle = "verify dag";
        const dagParallelism = 2;
        const dagTasks = [
            { id: "t-0", label: "noop", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
            {
                id: "t-1",
                label: "review",
                description: "review only, make no changes",
                deps: ["t-0"],
                gate: true,
                state: "",
            },
            {
                id: "t-2",
                label: "noop 2",
                description: "do nothing, stop immediately",
                deps: ["t-1"],
                gate: false,
                state: "",
            },
        ];
        const createdParent = await h.rpc("createrun", {
            channelid: ctx.channelId,
            workspaceid: ctx.workspaceId,
            goal: parentGoal,
            runtime: "claude",
            mode: "orchestrator",
            deferstart: true,
        });
        const runId = createdParent.run.id;
        const afterPlanning = await getChannelRunCount();
        rec(
            "1. DeferStart -> one orchestrator Run held in planning, no phase worker spawned",
            createdParent.run.mode === "orchestrator" &&
                createdParent.run.status === "planning" &&
                afterPlanning === beforePlanning + 1 &&
                (createdParent.run.phases || []).every((p) => !workerOf(p)),
            JSON.stringify({
                beforePlanning,
                afterPlanning,
                mode: createdParent.run.mode,
                status: createdParent.run.status,
            })
        );

        await h.rpc("dagsubmit", {
            channelid: ctx.channelId,
            runid: runId,
            title: dagTitle,
            parallelism: dagParallelism,
            tasks: dagTasks,
        });

        // DagStatus returns { group, digest } since 5a863daa — the group is the snapshot this asserts.
        const g = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: runId })).group;
        // a JSON dag gets no plan gate: DagSubmit dispatches t-0 before it returns, so t-0 may already run
        const taskState = (group, id) => (group.tasks.find((t) => t.id === id) || {}).state;
        rec(
            "2. DagSubmit -> group with 3 tasks, no plan gate, t-1/t-2 pending",
            g.tasks.length === 3 &&
                g.status !== "awaiting-plan" &&
                g.status !== "plan-review" &&
                taskState(g, "t-1") === "pending" &&
                taskState(g, "t-2") === "pending",
            JSON.stringify({ id: g.id, status: g.status, tasks: g.tasks.map((t) => [t.id, t.state]) })
        );
        const rAfter = await getRun(runId);
        rec(
            "3. run.dagoref links the group",
            rAfter && rAfter.dagoref === g.id,
            JSON.stringify({ dagoref: rAfter && rAfter.dagoref })
        );

        const beforeRetryCount = await getChannelRunCount();
        const retry = await h.rpc("dagsubmit", {
            channelid: ctx.channelId,
            runid: runId,
            title: dagTitle,
            parallelism: dagParallelism,
            tasks: dagTasks,
        });
        const afterRetryCount = await getChannelRunCount();
        rec(
            "identical DagSubmit retry returns the same DAG without creating Runs",
            retry.id === g.id && retry.tasks.length === g.tasks.length && afterRetryCount === beforeRetryCount,
            JSON.stringify({ first: g.id, retry: retry.id, beforeRetryCount, afterRetryCount })
        );

        let st = null;
        for (let i = 0; i < 20; i++) {
            await h.ev("new Promise((r) => setTimeout(r, 700))");
            st = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: runId })).group;
            if (taskState(st, "t-0") !== "pending") break;
        }
        rec(
            "4. DagSubmit dispatches t-0 (running) or it already finished, t-1/t-2 pending",
            st != null &&
                (taskState(st, "t-0") === "running" || taskState(st, "t-0") === "done") &&
                taskState(st, "t-1") === "pending" &&
                taskState(st, "t-2") === "pending",
            JSON.stringify(st == null ? null : st.tasks.map((t) => ({ id: t.id, state: t.state })))
        );

        // graph surface: the run header has an Open DAG button. The Brief's Sessions region is how a
        // LIVE run is reached now — its row carries the run oref and opens the sheet on that run — so
        // there is no channel row to click first. Reload to pick up the RPC-created channel (the Brief
        // reads a boot-primed snapshot the same way the subjects column did), and open the region's
        // overflow first: Sessions caps at ACTIVE_CAP and this DAG adds a parent plus its children.
        await h.ev("location.reload()");
        await h.ev("new Promise((r) => setTimeout(r, 4500))");
        await h.goto("jarvis");
        // the overflow is expanded in the same loop as the row is looked for: on a loaded machine the region renders
        // after a separate short "more" retry gave up, and the run then sat past the cap for every try
        const runClicked = await h.ev(`(async () => {
            for (let i = 0; i < 30; i++) {
                const row = [...document.querySelectorAll('[data-jarvis-brief-row="session"]')]
                    .find((x) => (x.textContent || '').includes(${JSON.stringify(parentGoal)}));
                if (row) { row.click(); return true; }
                [...document.querySelectorAll('[data-jarvis-brief-more="more"]')]
                    .find((b) => b.closest('[data-jarvis-brief-region="sessions"]'))?.click();
                await new Promise((r) => setTimeout(r, 500));
            }
            return false;
        })()`);
        const sessionRows = await h.ev(
            `[...document.querySelectorAll('[data-jarvis-brief-row="session"]')].map((x) => (x.textContent || '').slice(0, 60))`
        );
        await h.ev("new Promise((r) => setTimeout(r, 1200))");
        // task 9 removed the cockpit takeover: Open DAG opens a surface-local modal (the Brief stays
        // mounted underneath) instead of replacing the fleet view.
        const openClicked = await clickRetry(
            `[...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Open DAG'))`
        );
        await h.ev("new Promise((r) => setTimeout(r, 1200))");
        const modalKindAfterOpen = await h.ev(
            `(() => (document.querySelector('[data-dag-modal-kind]') || {}).getAttribute?.('data-dag-modal-kind') || null)()`
        );
        const nodeCount = await h.ev(`(() => document.querySelectorAll('.react-flow__node').length)()`);
        const modalHeading = await h.ev(
            `(() => (document.querySelector('#dag-modal-heading') || {}).textContent || '')()`
        );
        const closeBtn = await h.ev(
            `(() => [...document.querySelectorAll('button')].some((x) => (x.textContent || '').includes('Close')))()`
        );
        rec(
            "5. Open DAG -> surface-local modal shows the live graph (3 nodes) with a heading",
            openClicked === true && modalKindAfterOpen === "live" && nodeCount >= 3 && modalHeading === "Route DAG",
            JSON.stringify({
                runClicked,
                sessionRows,
                openClicked,
                modalKind: modalKindAfterOpen,
                nodeCount,
                modalHeading,
                closeBtn,
            })
        );
        await h.shot("cdp-shots/dag-modal.png");

        // the graph column once had no min-w-0, so its header's min-content width shoved the rail past the
        // panel's clipped right edge
        const railFit = await h.ev(`(() => {
            const panel = document.querySelector('[data-dag-modal-kind] [role="dialog"]');
            const rail = document.querySelector('[data-dag-modal-kind] [data-timeline-rail]');
            if (!panel || !rail) return null;
            return { panelRight: panel.getBoundingClientRect().right, railRight: rail.getBoundingClientRect().right };
        })()`);
        rec(
            "5f. The timeline rail sits inside the modal panel",
            railFit != null && railFit.railRight <= railFit.panelRight + 1,
            JSON.stringify(railFit)
        );

        // spec D7: a native title inside a node opens over the hover peek
        const titledInNode = await h.ev(
            `(() => document.querySelectorAll('[data-dag-modal-kind] .react-flow__node [title]').length)()`
        );
        rec("5a. No node carries a native tooltip", titledInNode === 0, JSON.stringify({ titledInNode }));

        // React synthesizes onPointerEnter from pointerover/mouseover; the peek's floating-ui hover listens for a
        // native mouseenter on the card's wrapper, which the bubbling dispatch reaches
        const hoverPeek = await h.ev(`(async () => {
            const card = document.querySelector('[data-dag-modal-kind] [data-dag-node]:not([data-dag-node="final"])');
            if (!card) return { card: null };
            for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) {
                const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent;
                card.dispatchEvent(new Ev(type, { bubbles: true }));
            }
            await new Promise((r) => setTimeout(r, 700));
            const peek = !!document.querySelector('[data-dag-peek]');
            const titled = document.querySelectorAll('[data-dag-modal-kind] .react-flow__node [title]').length;
            for (const type of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) {
                const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent;
                card.dispatchEvent(new Ev(type, { bubbles: true }));
            }
            return { card: card.getAttribute('data-dag-node'), peek, titled };
        })()`);
        rec("5b. Hover opens the peek", hoverPeek.peek === true && hoverPeek.titled === 0, JSON.stringify(hoverPeek));

        const liveDag = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: runId })).group;
        const depPairs = liveDag.tasks.flatMap((t) => (t.deps || []).map((d) => [d, t.id]));
        const pairLefts = await h.ev(`(() => {
            const left = (id) => {
                const el = document.querySelector('[data-dag-modal-kind] [data-dag-node="' + CSS.escape(id) + '"]');
                return el ? el.getBoundingClientRect().left : null;
            };
            return ${JSON.stringify(depPairs)}.map(([dep, dependent]) => ({ dep, dependent, depLeft: left(dep), left: left(dependent) }));
        })()`);
        rec(
            "5c. Dependents sit to the right of their dependencies",
            pairLefts.length > 0 && pairLefts.every((p) => p.depLeft != null && p.left != null && p.left > p.depLeft),
            JSON.stringify(pairLefts)
        );

        // aria-pressed mirrors the card's selected border (DagCardNode)
        const escSelection = await h.ev(`(async () => {
            const pressed = () => document.querySelectorAll('[data-dag-modal-kind] [data-dag-node]:not([data-dag-node="final"])[aria-pressed="true"]').length;
            const card = document.querySelector('[data-dag-modal-kind] [data-dag-node]:not([data-dag-node="final"])');
            if (!card) return { card: null };
            card.click();
            await new Promise((r) => setTimeout(r, 200));
            const selectedBefore = pressed();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise((r) => setTimeout(r, 300));
            return {
                card: card.getAttribute('data-dag-node'),
                selectedBefore,
                selectedAfter: pressed(),
                modalOpen: !!document.querySelector('[data-dag-modal-kind]'),
            };
        })()`);
        rec(
            "5d. Esc clears a selection before closing",
            escSelection.selectedBefore === 1 && escSelection.selectedAfter === 0 && escSelection.modalOpen === true,
            JSON.stringify(escSelection)
        );

        // a narrow window renders the rail as a drawer, collapsed until toggled
        const timeline = await h.ev(`(async () => {
            const rail = document.querySelector('[data-dag-modal-kind] [data-timeline-rail]');
            const layout = rail ? rail.getAttribute('data-timeline-rail') : null;
            if (layout === 'drawer') rail.querySelector('button[aria-expanded="false"]')?.click();
            let rows = 0;
            for (let i = 0; i < 10 && rows === 0; i++) {
                await new Promise((r) => setTimeout(r, 300));
                rows = document.querySelectorAll('[data-dag-modal-kind] [data-timeline-row]').length;
            }
            return { layout, rows };
        })()`);
        rec("5e. Timeline rows render", timeline.rows > 0, JSON.stringify(timeline));

        // escape dismisses the modal (the modal state machine refuses close while launching, which is
        // not in play here; the Close button and backdrop click share the same path)
        const esc = await h.ev(`(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise((r) => setTimeout(r, 300));
            return true;
        })()`);
        const modalGone = await h.ev(`(() => !document.querySelector('[data-dag-modal-kind]'))()`);
        rec("6. Escape -> modal closes, no cockpit takeover", modalGone === true, JSON.stringify({ esc, modalGone }));

        // one DAG cancellation command owns the parent, children, and worker shutdown.
        await h.rpc("dagaction", { channelid: ctx.channelId, runid: runId, taskid: "", action: "cancel" });
        const cancelledRuns = await channelRuns(h, ctx.channelId);
        const cancelledOwner = cancelledRuns.find((run) => run.id === runId);
        const cancelledChildren = cancelledRuns.filter((run) => run.dagoref === g.id && run.id !== runId);
        const cancelledDag = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: runId })).group;
        const cascadeOk =
            cancelledOwner &&
            cancelledOwner.status === "cancelled" &&
            cancelledChildren.length > 0 &&
            cancelledChildren.every((run) => run.status === "cancelled") &&
            cancelledDag.status === "cancelled";
        rec(
            "7. DagAction cancel terminally cancels owner, children, and DAG",
            cascadeOk,
            JSON.stringify({
                owner: cancelledOwner && cancelledOwner.status,
                children: cancelledChildren.map((run) => ({ id: run.id, status: run.status })),
                dag: cancelledDag.status,
            })
        );

        await h.rpc("dagaction", { channelid: ctx.channelId, runid: runId, taskid: "", action: "cancel" });
        const repeatedDag = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: runId })).group;
        const repeatedOwner = await getRun(runId);
        rec(
            "8. repeated DAG cancellation is idempotent",
            repeatedDag.status === "cancelled" && repeatedOwner && repeatedOwner.status === "cancelled",
            JSON.stringify({ owner: repeatedOwner && repeatedOwner.status, dag: repeatedDag.status })
        );
        return steps;
    },
    async teardown(h, ctx) {
        try {
            await deleteChannelWorkerBlocks(h, ctx.channelId);
        } catch (e) {
            console.error(`dag-lifecycle teardown: delete the worker blocks failed: ${e?.message ?? e}`);
        }
        try {
            await h.rpc("deletechannel", { channelid: ctx.channelId });
        } catch {
            // best-effort cleanup
        }
        try {
            rmSync(ctx.cwd, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
    },
};

const routePickerFlat = {
    name: "route-picker-flat",
    surface: "cockpit",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const pressKey = async (key, windowsVirtualKeyCode) => {
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode });
        };
        await h.goto("settings");
        // the two-pane Settings surface renders one section at a time; the route picker lives in Run defaults
        await h.ev(
            `(() => { const b = document.querySelector('[data-section="run"]'); if (b) b.click(); return true; })()`
        );
        await settle(200);
        const pickerPresent = await h.ev(`(() => !!document.querySelector('[data-testid="route-picker"]'))()`);
        await h.ev(
            `(() => { document.querySelector('[data-testid="route-picker"]')?.scrollIntoView({ block: "center" }); return true; })()`
        );
        await settle(200);
        await h.ev(
            `(() => { const b = document.querySelector('[data-testid="route-picker"]'); if (b) b.click(); return true; })()`
        );
        await settle(400);
        const rowCount = await h.ev(`(() => document.querySelectorAll('[data-testid^="route-option-"]').length)()`);
        rec(
            "route picker opens with flat model rows",
            pickerPresent === true && rowCount > 0,
            `picker=${pickerPresent} rows=${rowCount}`
        );
        const layout = await h.ev(`(() => {
            const group = document.querySelector('[aria-label="Available routes"]');
            const panel = group?.parentElement;
            const scroll = document.querySelector('[data-testid="route-picker-scroll"]');
            if (!panel || !scroll) return null;
            const rect = panel.getBoundingClientRect();
            return {
                top: rect.top,
                bottom: rect.bottom,
                height: rect.height,
                viewportHeight: window.innerHeight,
                overflowY: getComputedStyle(scroll).overflowY,
                scrollHeight: scroll.scrollHeight,
                clientHeight: scroll.clientHeight,
            };
        })()`);
        rec(
            "route picker stays within the viewport and scrolls model rows",
            layout != null &&
                layout.top >= 8 &&
                layout.bottom <= layout.viewportHeight - 8 &&
                layout.height <= 360 &&
                layout.overflowY === "auto" &&
                layout.scrollHeight > layout.clientHeight,
            JSON.stringify(layout)
        );
        const openFocus = await h.ev(`document.activeElement?.getAttribute('aria-label') ?? ''`);
        rec("opening the route picker focuses its filter", openFocus === "Filter models", `focus="${openFocus}"`);
        await pressKey("ArrowDown", 40);
        await settle(100);
        const arrowFocus = await h.ev(`document.activeElement?.getAttribute('data-testid') ?? ''`);
        rec(
            "ArrowDown moves focus from the filter to a model row",
            arrowFocus.startsWith("route-option-"),
            `focus="${arrowFocus}"`
        );
        await pressKey("Escape", 27);
        await settle(100);
        const escapeState = await h.ev(`(() => {
            const picker = document.querySelector('[data-testid="route-picker"]');
            return { expanded: picker?.getAttribute('aria-expanded'), focused: document.activeElement === picker };
        })()`);
        rec(
            "Escape closes the route picker and restores trigger focus",
            escapeState?.expanded === "false" && escapeState.focused === true,
            JSON.stringify(escapeState)
        );
        await h.ev(`document.querySelector('[data-testid="route-picker"]')?.click()`);
        await settle(400);
        await h.shot("cdp-shots/route-picker-flat.png");
        // filter shrinks the row set
        const filterTyped = await h.ev(`(() => {
            const input = document.querySelector('input[aria-label="Filter models"]');
            if (!input) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, "opus");
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);
        await settle(300);
        const filteredCount = await h.ev(
            `(() => document.querySelectorAll('[data-testid^="route-option-"]').length)()`
        );
        rec(
            "filter shrinks model rows",
            filterTyped === true && filteredCount > 0 && filteredCount < rowCount,
            `rows=${rowCount} filtered=${filteredCount}`
        );
        // choosing a row updates the face off "capable"
        await h.ev(`(() => {
            const input = document.querySelector('input[aria-label="Filter models"]');
            if (input) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, "");
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const row = document.querySelector('[data-testid^="route-option-"]');
            if (row) row.click();
            return true;
        })()`);
        await settle(400);
        const face = await h.ev(
            `((document.querySelector('[data-testid="route-picker"]')||{}).textContent||'').trim()`
        );
        rec("face shows the chosen model", !face.includes("· capable"), `face="${face}"`);
        return steps;
    },
};

// --- route-picker-refused: a route its provider refused is dimmed and named in the picker ----------------------
// Run bf3a2fe3 met a lapsed OpenCode Go plan: every turn came back 403. The engine records such a refusal in
// refused-routes.json in the data dir; this seeds one for a real catalog model and checks the row says so.
const routePickerRefused = {
    name: "route-picker-refused",
    surface: "cockpit",
    async arrange(h) {
        const info = await h.rpc("waveinfo", null);
        const catalog = await h.rpc("listharnesses", null, { timeout: 30000 });
        const capability = (catalog?.harnesses ?? [])
            .filter((x) => x.installed && x.runworkercapable)
            .flatMap((x) => x.routecapabilities ?? [])
            .find((c) => c.model);
        const file = join(info.datadir, "refused-routes.json");
        // the dev store's own refusals are put back in teardown
        const saved = existsSync(file) ? readFileSync(file, "utf8") : null;
        if (capability) {
            const mark = {
                runtime: capability.runtime,
                model: capability.model,
                text: "403: An active subscription is required",
                ts: Date.now(),
            };
            writeFileSync(file, JSON.stringify([mark], null, 2));
        }
        return { file, saved, runtime: capability?.runtime, model: capability?.model };
    },
    async assert(h, ctx) {
        if (!ctx.model) {
            return [skipStep("a refused catalog row is dimmed and named", "no installed run-worker harness lists a model")];
        }
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const row = `document.querySelector('[data-testid=${JSON.stringify(`route-option-${ctx.runtime}-${ctx.model}`)}]')`;
        await h.goto("settings");
        await h.ev(`(() => { document.querySelector('[data-section="run"]')?.click(); return true; })()`);
        await settle(200);
        await h.ev(`(() => {
            const b = document.querySelector('[data-testid="route-picker"]');
            b?.scrollIntoView({ block: "center" });
            b?.click();
            return true;
        })()`);
        await settle(400);
        // the filter brings the seeded row to the top of a catalog that can run to hundreds of rows
        await h.ev(`(() => {
            const input = document.querySelector('input[aria-label="Filter models"]');
            if (!input) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, ${JSON.stringify(ctx.model)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);
        await settle(400);
        const state = await h.ev(`(() => {
            const r = ${row};
            if (!r) return null;
            return {
                refused: r.getAttribute('data-refused'),
                text: r.textContent,
                title: r.getAttribute('title'),
                opacity: getComputedStyle(r).opacity,
            };
        })()`);
        rec(
            "a refused catalog row is dimmed and names the refusal",
            state != null &&
                state.refused === "true" &&
                /refused 403 · \w{3} \d{1,2}/.test(state.text ?? "") &&
                Number(state.opacity) < 1 &&
                (state.title ?? "").startsWith("403:"),
            JSON.stringify(state)
        );
        await h.shot("cdp-shots/route-picker-refused.png");
        await h.ev(`(() => { ${row}?.click(); return true; })()`);
        await settle(400);
        const face = await h.ev(`((document.querySelector('[data-testid="route-picker"]')||{}).textContent||'').trim()`);
        rec("choosing the refused route warns on the picker's face", face.endsWith("refused"), `face="${face}"`);
        await h.shot("cdp-shots/route-picker-refused-face.png");
        return steps;
    },
    async teardown(_h, ctx) {
        if (ctx.saved != null) {
            writeFileSync(ctx.file, ctx.saved);
        } else {
            // wavesrv may be mid-read of it for the picker, which Windows reports as EBUSY
            rmSync(ctx.file, { force: true, maxRetries: 10, retryDelay: 200 });
        }
    },
};

// --- brief-contextual-map: the Brief's honest graph exits ---------------------------------------------
// The graph peek mounts with the Brief's own exits: a record closes into the peek, and a run offers no
// control at all because B5 has not given runs a Stage sheet yet. It used to open by priming an attached
// thread from a memory note's "Ask Jarvis"; that entry point went with the Vault surface, and the exits
// below never depended on it. The surviving contextual entries are a radar finding and a run.
const briefContextualMap = {
    name: "brief-contextual-map",
    surface: "jarvis",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);

        // arrange: a reloaded surface, so the restore below is the only thing that has run
        await h.ev("location.reload()");
        await settle(2600);

        await h.goto("jarvis");
        await settle(500);

        // 1. Shift+G mounts the graph peek in Brief mode. The Stage-only keys must stay absent: the Brief
        //    has no rail to toggle and no Stage thread to start.
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', code: 'KeyG', shiftKey: true, bubbles: true }))`
        );
        await settle(900);
        const peek = await h.ev(`(() => {
            const el = document.querySelector('[data-jarvis-graph-peek]');
            if (!el) return null;
            const text = el.innerText || '';
            return {
                text: text.slice(0, 200),
                actions: [...el.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
            };
        })()`);
        rec(
            "1. Shift+G opens the graph peek over the Brief",
            peek != null && /\bgraph\b/i.test(peek.text) && /\d+ nodes/.test(peek.text),
            JSON.stringify(peek)
        );

        // 2. With nothing selected the overlay offers no node actions at all — the two exits are asserted
        //    where they can exist, on a focused task node (4b). Asserting them here would be asserting them
        //    against a state the graph deliberately does not have.
        const runControl = await h.ev(`(() => {
            const el = document.querySelector('[data-jarvis-graph-peek]');
            if (!el) return null;
            const runs = [...el.querySelectorAll('button')].filter((b) => /open run/i.test(b.innerText || '')).length;
            const ask = [...el.querySelectorAll('button')].filter((b) => /ask jarvis about this node/i.test(b.innerText || '')).length;
            return { runs, ask };
        })()`);
        rec(
            "2. the graph peek opens over the Brief with no node selected, so no node action is offered",
            runControl != null && runControl.runs === 0 && runControl.ask === 0,
            JSON.stringify(runControl)
        );

        // 3. a task node closes into the record peek rather than onto a Stage that is not there. Reached
        //    through the record peek's own map button, which is the one route that names a record to focus.
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
        );
        await settle(500);
        const closed = await h.ev(`document.querySelector('[data-jarvis-graph-peek]') == null`);
        rec("3a. Escape closes the graph peek and leaves the Brief", closed === true, "");

        const listed = await h.rpc("listtaskdossiers", null);
        if ((listed?.dossiers ?? []).length === 0) {
            rec("3b. a task node closes into the record peek", false, "no dossier in this profile - seed one before reading this as a pass");
            return steps;
        }
        // the palette is the only in-app route from the Brief to a record (see brief-peek for the full
        // explanation): nothing on the Brief itself names one.
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }))`
        );
        await settle(300);
        await h.ev(`document.querySelector('[data-palette-scope="records"]')?.click()`);
        await settle(900);
        await h.ev(`(() => {
            const headers = [...document.querySelectorAll('div')].filter(
                (d) => (d.textContent || '').trim().toLowerCase() === 'records'
            );
            const group = headers[0] ? headers[0].parentElement : null;
            const row = group ? group.querySelector('button[data-idx]') : null;
            if (row) row.click();
            return true;
        })()`);
        await settle(900);
        const mapClicked = await h.ev(`(() => {
            const b = document.querySelector('[data-jarvis-peek-open-graph]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await settle(1200);
        const focused = await h.ev(`(() => {
            const el = document.querySelector('[data-jarvis-graph-peek]');
            if (!el) return null;
            const open = [...el.querySelectorAll('button')].filter((b) => /^open record$/i.test((b.innerText || '').trim()));
            const runs = [...el.querySelectorAll('button')].filter((b) => /open run/i.test(b.innerText || '')).length;
            return { open: open.length, runs };
        })()`);
        rec(
            "3b. the record peek's map button focuses its task node: one Open record, no run control",
            mapClicked === true && focused != null && focused.open === 1 && focused.runs === 0,
            JSON.stringify({ mapClicked, focused })
        );

        const backToPeek = await h.ev(`(() => {
            const el = document.querySelector('[data-jarvis-graph-peek]');
            if (!el) return false;
            const b = [...el.querySelectorAll('button')].find((x) => /^open record$/i.test((x.innerText || '').trim()));
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await settle(900);
        const landed = await h.ev(`(() => ({
            peek: !!document.querySelector('[data-jarvis-brief-band="peek"]'),
            graph: !!document.querySelector('[data-jarvis-graph-peek]'),
        }))()`);
        rec(
            "3c. Open record closes the graph into the Brief's record peek",
            backToPeek === true && landed.peek === true && landed.graph === false,
            JSON.stringify({ backToPeek, landed })
        );
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// --- brief-composer-steer-only: no composer without a live lead to message --------------------------
// The Brief's composer only steers a running session's lead (briefcomposertarget.ts); the Ask audiences it
// used to have were retired. So with no session sheet open there is no composer at all. The "composer
// present" half needs a live worker, so it is checked by hand at the final verification.
const briefComposerSteerOnly = {
    name: "brief-composer-steer-only",
    surface: "jarvis",
    async arrange(h) {
        // start with no sheet open: Escape closes whatever a previous scenario left behind
        await h.goto("jarvis");
        await h.ev(
            `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
        );
        await h.ev("new Promise((r) => setTimeout(r, 400))");
        return {};
    },
    async assert(h) {
        const steps = [];
        await h.goto("jarvis");
        await h.ev("new Promise((r) => setTimeout(r, 700))");
        steps.push({
            step: "1. the Brief shows no composer while no session sheet is open",
            ok:
                (await h.ev(`!!document.querySelector('[data-jarvis-region="brief"]')`)) === true &&
                (await h.ev(`document.querySelector('[data-jarvis-brief-composer]') == null`)) === true,
            detail: "",
        });
        await h.shot("cdp-shots/brief-composer-steer-only.png");
        return steps;
    },
    async teardown(h) {},
};

// --- brief-restore: the stored subject, landed three different ways -------------------------------
// What the same stored value means now (briefrestore.ts): a dossier opens the record peek, while a channel
// and a conversation left over from before Ask was retired are cleared. Each case needs its
// own reload, because the restore is once per frontend load by design.
const briefRestore = {
    name: "brief-restore",
    surface: "jarvis",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        await h.ev(`localStorage.setItem('jarvis.subject.last', null)`);

        // a fresh load is what makes the restore one-shot, so each case reloads
        const withStored = async (stored) => {
            await h.ev(`localStorage.setItem('jarvis.subject.last', ${JSON.stringify(JSON.stringify(stored))})`);
            await h.ev("location.reload()");
            await settle(2800);
            await h.goto("jarvis");
            await settle(900);
        };

        // 1. a dossier opens the record peek, exactly once
        const listed = await h.rpc("listtaskdossiers", null);
        const dossier = (listed?.dossiers ?? [])[0];
        if (dossier == null) {
            rec(
                "1. a stored dossier restores to the record peek",
                false,
                "Vault Records requires at least one dossier"
            );
        } else {
            await withStored({ kind: "dossier", id: dossier.id });
            const opened = await h.ev(`(() => {
                const band = document.querySelector('[data-jarvis-brief-band="peek"]');
                return band ? { text: (band.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200) } : null;
            })()`);
            await h.ev(
                `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
            );
            await settle(500);
            // re-enter the surface: the restore must not run a second time, or closing a peek would be
            // undone by the next nav switch
            await h.goto("cockpit");
            await settle(400);
            await h.goto("jarvis");
            await settle(900);
            const reopened = await h.ev(`!!document.querySelector('[data-jarvis-brief-band="peek"]')`);
            rec(
                "1. a stored dossier restores to the record peek once and does not reopen",
                opened != null && opened.text.includes(dossier.objective.slice(0, 24)) && reopened === false,
                JSON.stringify({ objective: dossier.objective.slice(0, 40), opened, reopened })
            );
        }

        // 2. a conversation stored before Ask was retired clears rather than waiting on a list that no longer
        //    loads: no subject selected, nothing opened, no error overlay
        await withStored({ kind: "conversation", id: "gone" });
        const cleared = await h.ev(`(() => ({
            stored: localStorage.getItem('jarvis.subject.last'),
            brief: !!document.querySelector('[data-jarvis-region="brief"]'),
            peek: !!document.querySelector('[data-jarvis-brief-band="peek"]'),
            sheet: !!document.querySelector('[data-jarvis-brief-sheet]'),
            overlay: !!document.querySelector('vite-error-overlay'),
        }))()`);
        rec(
            "2. a stored conversation from before Ask was retired is cleared",
            cleared.brief === true &&
                cleared.peek === false &&
                cleared.sheet === false &&
                cleared.overlay === false &&
                (cleared.stored == null || cleared.stored === "null"),
            JSON.stringify(cleared)
        );

        // 3. a stored channel is forgotten: reopening its sheet on launch covered the Brief with a run that
        //    had usually ended days ago. A live channel is the case that proves it, not a deleted one.
        const chans = await h.rpc("getchannels", null);
        const channel = (chans?.channels ?? [])[0];
        if (channel == null) {
            rec(
                "3. a stored channel is cleared, its sheet left closed",
                false,
                "no channel in this profile — seed one before reading this as a pass"
            );
        } else {
            await withStored({ kind: "channel", id: channel.oid });
            const after = await h.ev(`(() => ({
                stored: localStorage.getItem('jarvis.subject.last'),
                brief: !!document.querySelector('[data-jarvis-region="brief"]'),
                peek: !!document.querySelector('[data-jarvis-brief-band="peek"]'),
                sheet: !!document.querySelector('[data-jarvis-brief-sheet]'),
            }))()`);
            rec(
                "3. a stored channel is cleared, its sheet left closed",
                after.brief === true &&
                    after.sheet === false &&
                    after.peek === false &&
                    (after.stored == null || after.stored === "null"),
                JSON.stringify({ channel: channel.oid, ...after })
            );
        }
        return steps;
    },
    async teardown(h) {
        await h.ev(`localStorage.removeItem('jarvis.subject.last')`);
        await h.goto("cockpit");
    },
};

// --- brief-profile: both scopes of the profile modal, and the playbook override -----------------
// F4's re-home. The playbook editor and the global face lost their mount when B5 deleted profilepanel.tsx,
// which left a custom playbook and the global principles reachable only over the RPC. Read-only on purpose:
// it never presses Save, so it asserts the editors exist and the override toggles without writing a
// profile into whatever config dir the dev app is pointed at.
const briefProfile = {
    name: "brief-profile",
    surface: "jarvis",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        await h.goto("jarvis");
        await h.ev(`document.querySelector('[data-jarvis-brief-profile]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 1200))");

        const STATE = `(() => {
            // the hook is now INSIDE ModalShell's panel, which is itself the [role="dialog"] — the
            // profile stopped hand-rolling its own scrim and dialog when it moved onto the shell.
            const dlg = document.querySelector('[data-jarvis-brief-modal="profile"]');
            const txt = (el) => (el?.innerText || "").replace(/\\s+/g, " ").trim();
            return {
                scope: dlg ? dlg.dataset.jarvisProfileScope : null,
                title: txt(dlg?.querySelector("header")),
                tabs: [...document.querySelectorAll('[data-jarvis-profile-tab]')].map((b) => b.dataset.jarvisProfileTab),
                sections: [...(dlg?.querySelectorAll("section") ?? [])].map((s) => txt(s).slice(0, 14)),
                editors: document.querySelectorAll('[data-jarvis-playbook="editor"]').length,
                summary: document.querySelectorAll('[data-jarvis-playbook="summary"]').length,
                phases: document.querySelectorAll('[data-jarvis-playbook="phase"]').length,
                globalPrinciples: document.querySelectorAll('[data-jarvis-global-principles="editor"] textarea').length,
                save: txt([...(dlg?.querySelectorAll("footer button") ?? [])][0]),
                saveDisabled: [...(dlg?.querySelectorAll("footer button") ?? [])][0]?.disabled ?? null,
            };
        })()`;

        const project = await h.ev(STATE);
        steps.push({
            step: "1. the modal opens on this project, with both scopes offered",
            ok:
                project.scope === "project" &&
                project.tabs.join(",") === "project,global" &&
                project.sections.length === 3 &&
                project.saveDisabled === true,
            detail: JSON.stringify(project),
        });

        // an inherited playbook is stated, not editable: the project has not said anything different yet
        steps.push({
            step: "2. the inherited playbook reads as a summary, with no editor under it",
            ok: project.summary === 1 && project.editors === 0 && project.phases === 0,
            detail: JSON.stringify({ summary: project.summary, editors: project.editors, phases: project.phases }),
        });

        await h.ev(
            `[...document.querySelectorAll('[data-jarvis-brief-modal="profile"] button')].find((b) => b.innerText.trim() === 'customize')?.click()`
        );
        await h.ev("new Promise((r) => setTimeout(r, 400))");
        const customized = await h.ev(STATE);
        steps.push({
            step: "3. customize copies the inherited phases into an editable override",
            ok:
                customized.editors === 1 &&
                customized.summary === 0 &&
                customized.phases > 0 &&
                customized.saveDisabled === false,
            detail: JSON.stringify(customized),
        });

        await h.ev(
            `[...document.querySelectorAll('[data-jarvis-brief-modal="profile"] section button')].find((b) => b.innerText.trim() === 'reset')?.click()`
        );
        await h.ev("new Promise((r) => setTimeout(r, 400))");
        const resetted = await h.ev(STATE);
        steps.push({
            step: "4. reset drops the override, so the draft is clean again",
            ok: resetted.summary === 1 && resetted.editors === 0 && resetted.saveDisabled === true,
            detail: JSON.stringify(resetted),
        });

        await h.ev(`document.querySelector('[data-jarvis-profile-tab="global"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 600))");
        const global = await h.ev(STATE);
        steps.push({
            step: "5. the global face edits the playbook and the principles every project inherits",
            ok:
                global.scope === "global" &&
                global.title.toLowerCase().includes("global defaults") &&
                global.editors === 1 &&
                global.globalPrinciples > 0 &&
                global.save.toLowerCase() === "save global defaults" &&
                global.saveDisabled === true,
            detail: JSON.stringify(global),
        });

        await h.shot("cdp-shots/brief-profile.png");
        return steps;
    },
    async teardown(h) {
        await h.ev(
            `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close profile')?.click()`
        );
        await h.goto("cockpit");
    },
};

// --- jarvis-motion: the structural facts the motion pass rests on -------------------------------
// The animations themselves are not assertable here — a tween is a sequence of transient computed
// styles, and reading one mid-flight is a race rather than a check. What IS assertable is the
// structure each moment depends on, which is also the half a later refactor can quietly break with
// nothing failing: the detail sheet's surface scoping, the freshness mark's presence and its cap, and
// the updates drawer's split between the element whose height animates and the inner scroller.
// --- the Brief's inline initiative tracker ------------------------------------------------------
// An initiative expands IN PLACE instead of opening the detail sheet, and its chunks join the Brief's
// own j/k list so one cursor walks rows and chunks alike. The chunk rows need the effort DETAIL, which
// the briefing fixture does not carry (it seeds summaries only) — so the plan-dependent steps SKIP when
// the dev store has no real initiative with chunks, rather than failing on an empty dev database.
const briefInlineTracker = {
    name: "brief-inline-tracker",
    surface: "jarvis",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        await h.goto("jarvis");
        await h.ev(`document.querySelector('[data-briefing-fixture="normal"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 900))");

        // 1. an initiative row no longer opens the modal sheet
        const row = `[...document.querySelectorAll('[data-jarvis-brief-row="initiative"]')][0]`;
        const before = await h.ev(`(() => ({
            rows: document.querySelectorAll('[data-jarvis-brief-row="initiative"]').length,
            expanded: !!document.querySelector('[data-jarvis-initiative-detail]'),
        }))()`);
        await h.ev(`${row}?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 700))");
        const after = await h.ev(`(() => ({
            detail: !!document.querySelector('[data-jarvis-initiative-detail]'),
            sheet: !!document.querySelector('[data-jarvis-brief-sheet-face]'),
            aria: document.querySelector('[data-jarvis-brief-row="initiative"]')?.getAttribute('aria-expanded') ?? null,
        }))()`);
        steps.push({
            step: "1. clicking an initiative expands it in place and opens no sheet",
            ok: before.rows > 0 && after.detail === true && after.sheet === false && after.aria === "true",
            detail: JSON.stringify({ before, after }),
        });
        await h.shot("cdp-shots/brief-inline-tracker-expanded.png");

        // 2. only the stage holding the next chunk starts open
        const stages = await h.ev(`[...document.querySelectorAll('[data-jarvis-tracker-stage]')].map((b) => b.getAttribute('aria-expanded'))`);
        const chunks = await h.ev(`[...document.querySelectorAll('[data-jarvis-tracker-chunk]')].length`);
        const hasPlan = Array.isArray(stages) && stages.length > 0;
        steps.push(
            hasPlan
                ? {
                      step: "2. exactly one stage starts expanded, and it is the only one contributing chunk rows",
                      ok: stages.filter((a) => a === "true").length === 1 && chunks > 0,
                      detail: JSON.stringify({ stages, chunks }),
                  }
                : skipStep(
                      "2. exactly one stage starts expanded, and it is the only one contributing chunk rows",
                      "no initiative with chunks in this dev store - the fixture seeds summaries only"
                  )
        );

        // 3. a chunk row takes the Brief's cursor and opens its Chunk sidebar
        let sidebar = { panel: false, cursorOnChunk: false };
        if (hasPlan && chunks > 0) {
            await h.ev(`[...document.querySelectorAll('[data-jarvis-tracker-chunk]')][0]?.click()`);
            await h.ev("new Promise((r) => setTimeout(r, 500))");
            sidebar = await h.ev(`(() => ({
                panel: !!document.querySelector('[data-jarvis-chunk-sidebar]'),
                cursorOnChunk: !!document.querySelector('[data-jarvis-tracker-chunk][aria-pressed="true"]'),
            }))()`);
        }
        steps.push(
            hasPlan && chunks > 0
                ? {
                      step: "3. selecting a chunk opens the Chunk sidebar and marks that row selected",
                      ok: sidebar.panel === true && sidebar.cursorOnChunk === true,
                      detail: JSON.stringify(sidebar),
                  }
                : skipStep(
                      "3. selecting a chunk opens the Chunk sidebar and marks that row selected",
                      "no chunk rows to select - seed an initiative carrying a plan"
                  )
        );
        await h.shot("cdp-shots/brief-inline-tracker-notes.png");

        // 4. Escape backs out one rung at a time and never leaves the surface while a note is open
        let esc = { afterFirst: null, surface: null };
        if (hasPlan && chunks > 0) {
            // real key events, not synthetic DOM ones: the binding registry listens on the window
            for (const type of ["keyDown", "keyUp"]) {
                await h.cdp("Input.dispatchKeyEvent", {
                    type,
                    key: "Escape",
                    code: "Escape",
                    windowsVirtualKeyCode: 27,
                });
            }
            await h.ev("new Promise((r) => setTimeout(r, 400))");
            esc = await h.ev(`(() => ({
                afterFirst: !!document.querySelector('[data-jarvis-chunk-sidebar]'),
                surface: !!document.querySelector('[data-jarvis-region="brief"]'),
            }))()`);
        }
        steps.push(
            hasPlan && chunks > 0
                ? {
                      step: "4. Escape closes the sidebar and stays on the Brief",
                      ok: esc.afterFirst === false && esc.surface === true,
                      detail: JSON.stringify(esc),
                  }
                : skipStep(
                      "4. Escape closes the sidebar and stays on the Brief",
                      "sidebar never opened - step 3 had no chunk row to select"
                  )
        );

        // 5-8. the editing layer. Every step asserts and none commits a write: the delete is taken back
        // with Undo inside its window, so no RPC is ever sent against the dev store.
        if (hasPlan && chunks > 0) {
            // 5. the status pill opens a menu with the six statuses
            await h.ev(`document.querySelector('[data-jarvis-chunk-status]')?.click()`);
            await h.ev("new Promise((r) => setTimeout(r, 200))");
            // each item leads with a glyph span, so read the label span rather than the whole button
            const menu = await h.ev(`(() => {
                const m = document.querySelector('[data-jarvis-tracker-menu]');
                return m ? [...m.querySelectorAll('button')].map((b) => b.querySelector('.flex-1')?.textContent.trim() ?? "") : null;
            })()`);
            await h.shot("cdp-shots/brief-inline-tracker-menu.png");
            // real keys again: the menu's Escape rung is a window-capture binding, and it must close the
            // menu without also backing out of the surface
            for (const type of ["keyDown", "keyUp"]) {
                await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            }
            await h.ev("new Promise((r) => setTimeout(r, 300))");
            const afterEsc = await h.ev(`(() => ({
                menu: !!document.querySelector('[data-jarvis-tracker-menu]'),
                brief: !!document.querySelector('[data-jarvis-region="brief"]'),
                chunks: document.querySelectorAll('[data-jarvis-tracker-chunk]').length,
            }))()`);
            const six = ["pending", "active", "blocked", "deferred", "skipped", "done"];
            steps.push({
                step: "5. the status pill opens a menu listing all six statuses, and Escape closes only the menu",
                ok:
                    Array.isArray(menu) &&
                    six.every((s) => menu.includes(s)) &&
                    afterEsc.menu === false &&
                    afterEsc.brief === true &&
                    afterEsc.chunks === chunks,
                detail: JSON.stringify({ menu, afterEsc }),
            });

            // 6. double-click renames in place, and Escape leaves the label untouched
            await h.ev(`document.querySelector('[data-jarvis-tracker-chunk]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
            await h.ev("new Promise((r) => setTimeout(r, 200))");
            const renaming = await h.ev(`!!document.querySelector('[data-jarvis-rename-input]')`);
            steps.push({ step: "6. double-clicking a chunk opens its rename input", ok: renaming === true, detail: String(renaming) });
            await h.ev(`document.querySelector('[data-jarvis-rename-input]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
            await h.ev("new Promise((r) => setTimeout(r, 150))");

            // 7. delete hides the row at once, and Undo brings it back without a write
            const label = await h.ev(`document.querySelectorAll('[data-jarvis-tracker-chunk]').length > 1 ? document.querySelector('[data-jarvis-tracker-chunk]').getAttribute('data-jarvis-tracker-chunk') : null`);
            if (label != null) {
                const sel = `document.querySelector('[data-jarvis-tracker-chunk="' + CSS.escape(${JSON.stringify(label)}) + '"]')`;
                await h.ev(`document.querySelector('[data-jarvis-chunk-status]')?.click()`);
                await h.ev("new Promise((r) => setTimeout(r, 200))");
                await h.ev(`[...document.querySelectorAll('[data-jarvis-tracker-menu] button')].find((b) => b.textContent.trim() === 'Delete chunk')?.click()`);
                await h.ev("new Promise((r) => setTimeout(r, 200))");
                const gone = await h.ev(`!${sel} && !!document.querySelector('[data-jarvis-toast-undo]')`);
                await h.ev(`document.querySelector('[data-jarvis-toast-undo]')?.click()`);
                await h.ev("new Promise((r) => setTimeout(r, 300))");
                const back = await h.ev(`!!${sel}`);
                steps.push({
                    step: "7. delete hides the chunk behind an Undo toast, and Undo restores it",
                    ok: gone === true && back === true,
                    detail: JSON.stringify({ label, gone, back }),
                });
            } else {
                steps.push(skipStep("7. delete hides the chunk behind an Undo toast, and Undo restores it", "the plan has one chunk"));
            }

            // 8. the footer's delete asks first
            await h.ev(`document.querySelector('[data-jarvis-initiative-action="delete"]')?.click()`);
            await h.ev("new Promise((r) => setTimeout(r, 200))");
            const confirm = await h.ev(`document.querySelector('[data-jarvis-delete-confirm]')?.textContent ?? null`);
            steps.push({
                step: "8. deleting an initiative asks for confirmation first",
                ok: typeof confirm === "string" && confirm.includes("Delete this initiative"),
                detail: String(confirm),
            });
            await h.shot("cdp-shots/brief-inline-tracker-confirm.png");
            await h.ev(`[...document.querySelectorAll('[data-jarvis-delete-confirm] button')].find((b) => b.textContent.trim() === 'cancel')?.click()`);
            await h.ev("new Promise((r) => setTimeout(r, 150))");
        } else {
            steps.push(skipStep("5-8. the editing layer: status menu, rename, delete + undo, delete confirm", "no initiative with chunks in this dev store"));
        }

        // 9. collapsing removes the chunk rows again, so a stale cursor cannot survive on one
        await h.ev(`[...document.querySelectorAll('[data-jarvis-brief-row="initiative"]')][0]?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 500))");
        const collapsed = await h.ev(`(() => ({
            detail: !!document.querySelector('[data-jarvis-initiative-detail]'),
            chunks: document.querySelectorAll('[data-jarvis-tracker-chunk]').length,
        }))()`);
        steps.push({
            step: "9. collapsing the initiative removes its plan rows",
            ok: collapsed.detail === false && collapsed.chunks === 0,
            detail: JSON.stringify(collapsed),
        });

        return steps;
    },
};

// --- brief-design-parity: the Brief drawn to its handoff design ----------------------------------
// The structural half of the parity review against docs/prototype/jarvis-brief-editing.dc.html
// (variant A); the visual half is cdp-shots/design/ (scripts/cdp/design-states.mjs) beside these shots.
// Runs against the design's data: seed it first with `node scripts/cdp/seed-brief.mjs`.
const PARITY_INITIATIVE = "Scenario gate clearance";
const PARITY_CHUNK = "N1 box upgrade";
const parityNap = (h, ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);

const briefDesignParity = {
    name: "brief-design-parity",
    surface: "jarvis",
    async arrange(h) {
        const { efforts = [] } = (await h.rpc("effortlist", {})) ?? {};
        if (!efforts.some((e) => e.title === PARITY_INITIATIVE)) {
            throw new Error(`no "${PARITY_INITIATIVE}" initiative - run node scripts/cdp/seed-brief.mjs first`);
        }
        return {};
    },
    async assert(h, ctx) {
        const steps = [];
        await h.goto("jarvis");
        // a briefing fixture another scenario left on hides the live data, and only a reload clears it
        const fixtureOn = await h.ev(
            `[...document.querySelectorAll('[data-briefing-fixture]')].some((b) => b.className.includes('bg-accentbg'))`
        );
        if (fixtureOn) {
            try {
                await h.ev("location.reload()");
            } catch {
                /* the evaluate is cut off by the navigation it just started */
            }
            for (let waited = 0; waited < 30000; waited += 500) {
                const up = await h.ev("!!window.TabRpcClient && !!document.querySelector('nav button')").catch(() => false);
                if (up) break;
                await new Promise((r) => setTimeout(r, 500));
            }
            await h.goto("jarvis");
        }
        // a cold dev app draws the regions as empty skeletons first; wait for the seeded initiative's row
        for (let waited = 0; waited < 15000; waited += 500) {
            const up = await h.ev(
                `[...document.querySelectorAll('[data-jarvis-brief-row="initiative"]')].some((r) => r.innerText.includes(${JSON.stringify(PARITY_INITIATIVE)}))`
            );
            if (up) break;
            await parityNap(h, 500);
        }
        await parityNap(h, 900);

        // (a) the four region labels, as rendered (uppercase comes from CSS, which innerText applies).
        // a region's head is its first child: a button for waiting/initiatives, the button beside the kind
        // filter for runs, a div for behind; the label is its first span with text
        const labels = await h.ev(`[...document.querySelectorAll('section[data-jarvis-brief-region]')].map((s) =>
            [...s.querySelectorAll(':scope > :first-child span')].map((x) => x.innerText.trim()).find((t) => t !== '') ?? null)`);
        await h.shot("cdp-shots/brief-design-parity-a-regions.png");
        steps.push({
            step: "a. the region labels read WAITING ON YOU, INITIATIVES, RUNS, BEHIND YOU",
            ok: JSON.stringify(labels) === JSON.stringify(["WAITING ON YOU", "INITIATIVES", "RUNS", "BEHIND YOU"]),
            detail: JSON.stringify(labels),
        });

        // (b) header order, by document position inside the header
        const order = await h.ev(`(() => {
            const header = document.querySelector('[data-jarvis-region="brief"] > header');
            if (!header) return null;
            const all = [...header.querySelectorAll('*')];
            const at = (sel) => all.indexOf(header.querySelector(sel));
            return {
                fleet: at('[data-jarvis-brief-band="fleet"]'),
                filter: at('[data-jarvis-brief-filter]'),
                tier: at('[data-jarvis-autonomy="chip"]'),
                profile: at('[data-jarvis-brief-profile]'),
                initiative: at('[data-jarvis-new-initiative]'),
            };
        })()`);
        const seq = order ? [order.fleet, order.filter, order.tier, order.profile, order.initiative] : [];
        await h.shot("cdp-shots/brief-design-parity-b-header.png");
        steps.push({
            step: "b. the header runs fleet line, filter, autonomy, Profile, New initiative",
            ok: seq.length === 5 && seq.every((i, n) => i >= 0 && (n === 0 || i > seq[n - 1])),
            detail: JSON.stringify(order),
        });

        // (c) the expanded initiative: the row head carries the fraction, next chunk and blocked count, so the
        // plan beneath does not repeat them; its stages carry n/m fractions
        const ROW = `[...document.querySelectorAll('[data-jarvis-brief-row="initiative"]')].find((r) => r.innerText.includes(${JSON.stringify(PARITY_INITIATIVE)}))`;
        const DETAIL = `${ROW}?.parentElement?.querySelector('[data-jarvis-initiative-detail="true"]')`;
        ctx.wasExpanded = (await h.ev(`${ROW}?.getAttribute('aria-expanded') ?? null`)) === "true";
        if (!ctx.wasExpanded) await h.ev(`${ROW}?.click()`);
        for (let waited = 0; waited < 3000 && !(await h.ev(`!!${DETAIL}`)); waited += 250) await parityNap(h, 250);
        const card = await h.ev(`(() => {
            const d = ${DETAIL};
            if (!d) return null;
            const text = d.innerText.replace(/\\s+/g, " ");
            const head = (${ROW}?.innerText ?? "").replace(/\\s+/g, " ");
            return {
                head: /2\\/6/.test(head) && /— N1 box upgrade/.test(head) && /1 blocked/.test(head),
                repeated: /of 6 done|Next:/.test(text),
                // a stage head's direct spans are the empty bar, then the fraction
                fractions: [...d.querySelectorAll('[data-jarvis-tracker-stage]')].map((s) =>
                    [...s.querySelectorAll(':scope > span')].map((x) => x.innerText.trim()).find((t) => t !== "") ?? null),
                footerId: d.querySelector('button[title="copy this initiative\\'s id"]')?.innerText.trim() ?? null,
            };
        })()`);
        await h.shot("cdp-shots/brief-design-parity-c-initiative.png");
        steps.push({
            step: `c. "${PARITY_INITIATIVE}" heads with 2/6, N1 box upgrade and 1 blocked, unrepeated below, with n/m stage fractions`,
            ok:
                card != null &&
                card.head &&
                !card.repeated &&
                card.fractions.length > 0 &&
                card.fractions.every((f) => typeof f === "string" && /^\d+\/\d+$/.test(f)),
            detail: JSON.stringify(card),
        });

        // (d) the footer id is the short oid
        await h.shot("cdp-shots/brief-design-parity-d-footer.png");
        steps.push({
            step: "d. the initiative footer shows an 8-character id",
            ok: typeof card?.footerId === "string" && /^[0-9a-f]{8}$/.test(card.footerId),
            detail: String(card?.footerId),
        });

        // (e) a Runs row carries its type badge
        const badges = await h.ev(`[...document.querySelectorAll('[data-jarvis-brief-row="session"]')]
            .map((r) => r.querySelector(':scope > div > div > span')?.innerText.trim() ?? null)`);
        await h.shot("cdp-shots/brief-design-parity-e-runs.png");
        steps.push(
            badges.length > 0
                ? {
                      step: "e. a Runs row leads with a quick run / orchestrator / agent badge",
                      ok: badges.every((b) => ["quick run", "orchestrator", "agent"].includes(b)),
                      detail: JSON.stringify(badges),
                  }
                : skipStep(
                      "e. a Runs row leads with a quick run / orchestrator / agent badge",
                      "no run in this dev store - start any quick run (+ Run) and rerun"
                  )
        );

        // (f) Behind you's meta names the window it covers
        const behindMeta = await h.ev(
            `document.querySelector('section[data-jarvis-brief-region="behind"] > div:first-child > span:last-of-type')?.innerText.trim() ?? null`
        );
        await h.shot("cdp-shots/brief-design-parity-f-behind.png");
        steps.push({
            step: "f. Behind you's meta reads since … or the last 7 days",
            ok: typeof behindMeta === "string" && /^since |^the last 7 days$/.test(behindMeta),
            detail: String(behindMeta),
        });

        // (g) the Chunk sidebar's position
        await h.ev(`${DETAIL}?.querySelector('[data-jarvis-tracker-chunk="' + CSS.escape(${JSON.stringify(PARITY_CHUNK)}) + '"]')?.click()`);
        await parityNap(h, 500);
        const position = await h.ev(
            `document.querySelector('[data-jarvis-chunk-sidebar]')?.querySelector(':scope > div > span:nth-of-type(2)')?.innerText.trim() ?? null`
        );
        await h.shot("cdp-shots/brief-design-parity-g-sidebar.png");
        steps.push({
            step: "g. the Chunk sidebar shows its position as n / total",
            ok: typeof position === "string" && /^\d+ \/ \d+$/.test(position),
            detail: String(position),
        });

        // (h) the Runs kind filter narrows Runs to one badge, then all brings every row back
        const KIND = (k) => `[...document.querySelectorAll('[data-jarvis-run-kind] button')].find((b) => b.innerText.trim() === '${k}')`;
        const runBadges = `[...document.querySelectorAll('[data-jarvis-brief-row="session"]')].map((r) => r.querySelector(':scope > div > div > span')?.innerText.trim() ?? null)`;
        const before = await h.ev(runBadges);
        await h.ev(`${KIND("orchestrator")}?.click()`);
        await parityNap(h, 700);
        const orchOnly = await h.ev(runBadges);
        await h.shot("cdp-shots/brief-design-parity-h-runkind.png");
        await h.ev(`${KIND("all")}?.click()`);
        await parityNap(h, 700);
        const after = await h.ev(runBadges);
        steps.push({
            step: "h. the orchestrator filter leaves only orchestrator runs, and all restores the list",
            ok: orchOnly.every((b) => b === "orchestrator") && after.length === before.length,
            detail: JSON.stringify({ before: before.length, orchOnly, after: after.length }),
        });

        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(
            `[...(document.querySelector('[data-jarvis-chunk-sidebar]')?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Close')?.click()`
        );
        if (ctx.wasExpanded === false) {
            await h.ev(
                `[...document.querySelectorAll('[data-jarvis-brief-row="initiative"][aria-expanded="true"]')].find((r) => r.innerText.includes(${JSON.stringify(PARITY_INITIATIVE)}))?.click()`
            );
        }
        await h.goto("cockpit");
    },
};

const jarvisMotion = {
    name: "jarvis-motion",
    surface: "jarvis",
    async arrange() {
        return { id: `loose-end:cdp-motion:${Date.now()}` };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);

        // 1. ModalShell variant="sheet" is `absolute z-20`, not the dialog's `fixed z-[70]` — that is
        //    what keeps a detail sheet scoped to the Brief and the nav rail reachable underneath it.
        //    Driven through the router because no fixture state carries a queue `nav`, so no fixture
        //    row is a button that opens anything.
        const chans = await h.rpc("getchannels", null);
        const channel = (chans?.channels ?? [])[0];
        if (channel == null) {
            rec(
                "1. the sheet mounts inside a Brief-scoped backdrop",
                false,
                "no channel in this profile — seed one before reading this as a pass"
            );
        } else {
            await h.ev(`(async () => {
                for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                return window.__openAddress?.(${JSON.stringify(`channel:${channel.oid}`)});
            })()`);
            await settle(1200);
            const scoped = await h.ev(`(() => {
                const sheet = document.querySelector('[data-jarvis-brief-sheet]');
                // the panel IS the [role="dialog"]; the backdrop is the element it sits in
                const backdrop = sheet?.closest('[role="dialog"]')?.parentElement ?? null;
                const rail = document.querySelector('nav button[aria-label="Cockpit"]');
                const r = rail?.getBoundingClientRect();
                const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
                return {
                    sheet: sheet != null,
                    position: backdrop ? getComputedStyle(backdrop).position : null,
                    // the claim itself rather than a proxy for it: a click on the rail still lands there
                    railReachable: rail != null && hit != null && rail.contains(hit),
                };
            })()`);
            rec(
                "1. the sheet mounts inside a Brief-scoped backdrop, nav rail still hit-testable",
                scoped.sheet === true && scoped.position === "absolute" && scoped.railReachable === true,
                JSON.stringify(scoped)
            );
            await h.shot("cdp-shots/jarvis-motion-sheet.png");
            await h.ev(
                `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close detail sheet')?.click()`
            );
            await settle(500);
        }

        // 2. freshness against a visit cursor older than the rows. The `normal` fixture's cursor is
        //    seven days back and every initiative and session row it carries is one to three days old,
        //    so each of those regions must mark, and must mark no more rows than it has.
        await h.ev(`document.querySelector('[data-briefing-fixture="normal"]')?.click()`);
        await settle(900);
        const TALLY = `(() => {
            const per = {};
            document.querySelectorAll('[data-jarvis-brief-row]').forEach((r) => {
                const k = r.dataset.jarvisBriefRow;
                per[k] = per[k] || { rows: 0, marked: 0 };
                per[k].rows += 1;
                if (r.classList.contains('fresh-mark')) per[k].marked += 1;
            });
            return per;
        })()`;
        const marked = await h.ev(TALLY);
        const region = (k) => marked[k] ?? { rows: 0, marked: 0 };
        rec(
            "2. rows newer than the visit cursor carry the freshness mark",
            region("initiative").marked > 0 && region("session").marked > 0,
            JSON.stringify(marked)
        );
        await h.shot("cdp-shots/jarvis-motion-fresh.png");

        // 3. the cap, per region. freshrows.ts suppresses the mark entirely above FRESH_MARK_CAP,
        //    because a week away that lights up every row is decoration rather than a reading aid.
        //    Asserted per region, not in total: the three marked regions each call freshKeys with
        //    their own list, so the cap is three separate budgets and a summed check would be wrong.
        const FRESH_MARK_CAP = 6;
        const capped = ["queue", "initiative", "session"].every((k) => region(k).marked <= FRESH_MARK_CAP);
        rec(
            `3. no region marks more than ${FRESH_MARK_CAP} rows`,
            capped,
            JSON.stringify({ cap: FRESH_MARK_CAP, ...marked })
        );

        // 4. the negative. The plan asked for a fixture whose rows all PREDATE the cursor; no fixture
        //    supplies one — every loaded state hangs its timestamps one to three days off `now` while
        //    the cursor sits seven days back. So the deterministic negative the design actually states
        //    stands in for it: the `behind` region is since-your-last-visit by construction, which is
        //    why it is excluded from the mark — marking it would mark every row, and the region's own
        //    label already says the thing the mark would be saying. `empty` is kept alongside it as
        //    the trivial case: no rows, therefore no marks, therefore no mark leaking from elsewhere.
        const behind = region("delta").marked + region("shipped").marked;
        rec(
            "4. the behind region carries no mark, though every row in it postdates the cursor",
            behind === 0 && region("delta").rows + region("shipped").rows > 0,
            JSON.stringify({ delta: region("delta"), shipped: region("shipped") })
        );

        await h.ev(`document.querySelector('[data-briefing-fixture="empty"]')?.click()`);
        await settle(700);
        const emptyMarks = await h.ev(`document.querySelectorAll('.fresh-mark').length`);
        rec("5. a state with no rows marks nothing", emptyMarks === 0, String(emptyMarks));

        // 6. the updates drawer. Task 14 moved the scroll container to an inner div: paneReveal
        //    animates the outer element's height and needs overflow-hidden there, which on the same
        //    element would fight overflow-y-auto and clip the scrollbar mid-tween. TWO injected pet
        //    events guarantee the drawer exists at all: the peek gives the newest update its own
        //    LatestUpdate row and the drawer holds only updates.slice(1), so one event fills the
        //    former and leaves the latter unmounted. One used to be enough because the pet had other
        //    update sources; those were memory-derived and went with the memvault removal.
        await h.ev(`(() => {
            document.querySelector('button[aria-label="Close Jarvis panel"]')?.click();
            return true;
        })()`);
        await settle(200);
        const pushed = await h.ev(`(() => {
            const mod = globalThis.__wavePetStore;
            if (mod == null) return "petstore test hook not exposed (dev build?)";
            for (const n of [1, 2]) {
                mod.pushPetEvent({
                    id: ${JSON.stringify(ctx.id)} + ":" + n,
                    at: Date.now() + n,
                    kind: "loose-end",
                    text: "CDP motion probe " + n + " - untouched for 21 days",
                    sources: [{ ref: "task:cdp-motion-" + n, title: "CDP motion probe " + n, sourceType: "dossier" }],
                });
            }
            // and the busy shape, which is the only one that renders the drawer: the quiet card keeps the
            // latest update alone. Cleared in teardown.
            if (typeof mod.setAttention !== "function") return "petstore setAttention hook not exposed";
            mod.setAttention([
                { key: "dag-gate:cdp-motion", kind: "dag-gate", source: "CDP motion gate", text: "Approve the gate before the DAG proceeds.", action: "Review", waitingsince: Date.now() - 120000, channelid: "", runid: "cdp-motion", phaseidx: 0 },
            ]);
            return true;
        })()`);
        await settle(400);
        await h.ev(`document.querySelector('[aria-label="Jarvis condition"]')?.click()`);
        await settle(300);
        const DRAWER = `(() => {
            const box = document.querySelector('[data-pet-updates]');
            const toggle = box?.querySelector('button[aria-expanded]');
            // the revealing element is the toggle's sibling; the scroller is its only child
            const pane = toggle?.nextElementSibling ?? null;
            const scroller = pane?.firstElementChild ?? null;
            return {
                expanded: toggle?.getAttribute('aria-expanded') ?? null,
                rows: scroller ? scroller.children.length : 0,
                paneOverflow: pane ? getComputedStyle(pane).overflow : null,
                scrollerOverflowY: scroller ? getComputedStyle(scroller).overflowY : null,
            };
        })()`;
        const shut = await h.ev(DRAWER);
        await h.ev(`(() => {
            const toggle = document.querySelector('[data-pet-updates] button[aria-expanded]');
            if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
            return true;
        })()`);
        await settle(500);
        const opened = await h.ev(DRAWER);
        rec(
            "6. the drawer toggles its updates list, height on the outside and the scroller within",
            pushed === true &&
                shut.expanded === "false" &&
                shut.rows === 0 &&
                opened.expanded === "true" &&
                opened.rows > 0 &&
                opened.paneOverflow === "hidden" &&
                opened.scrollerOverflowY === "auto",
            JSON.stringify({ pushed, shut, opened })
        );
        await h.shot("cdp-shots/jarvis-motion-drawer.png");

        return steps;
    },
    async teardown(h) {
        await h.ev(`(() => {
            // the injected utterance advanced a PERSISTED watermark, so leaving it moved is a side
            // effect on the user's own creature rather than a test (jarvis-volunteer's rule)
            document.querySelector('button[aria-label="Close Jarvis panel"]')?.click();
            // the injected gate is what put the peek in its busy shape; left behind it would follow the
            // user out of the run as a waiting item that nothing can answer
            globalThis.__wavePetStore?.setAttention?.([]);
            try {
                globalThis.localStorage?.removeItem("wave:pet.watermark");
                globalThis.localStorage?.removeItem("jarvis.subject.last");
            } catch {}
            return true;
        })()`);
        await h.goto("cockpit");
    },
};

// --- resource linking: an address opens what it names --------------------------------------------------------
// The router's live check, driven through the DEV hook in linkingdevhooks.ts (the citation chips that used to
// carry these addresses went with the Ask thread). The addresses name real objects read from this profile,
// because every landing proves its target exists first — invented ids would only ever exercise the failure
// path. Nothing here writes. A profile missing a kind (no record holding a
// decision, no scan report, no investigated finding) SKIPS that step and names what to seed: the landing was
// never attempted, so neither a pass nor a failure would be a true reading of it.
const resourceLinking = {
    name: "resource-linking",
    surface: "jarvis",
    async arrange(h) {
        const dossiers = (await h.rpc("listtaskdossiers", null))?.dossiers ?? [];
        let decided = null;
        for (const d of dossiers.slice(0, 25)) {
            const detail = await h.rpc("getdossier", { dossierid: d.id }).catch(() => null);
            const decision = detail?.decisions?.[0];
            if (decision) {
                decided = { dossierId: d.id, objective: d.objective, decisionId: decision.id };
                break;
            }
        }
        const reports = (await h.rpc("listradarreports", { projectpath: "" }))?.reports ?? [];
        const newest = new Map();
        for (const r of reports) {
            const prior = newest.get(r.projectpath);
            if (!prior || r.startedts > prior.startedts) newest.set(r.projectpath, r);
        }
        const scanned = reports.filter((r) => (r.findings ?? []).length > 0);
        // an older report is the case the Radar landing exists for: initRadarScope selects the NEWEST, so only
        // an older one tells a landing that held apart from one that was overwritten
        const cited = scanned.find((r) => newest.get(r.projectpath)?.oid !== r.oid) ?? scanned[0] ?? null;
        let investigated = null;
        for (const r of reports) {
            const f = (r.findings ?? []).find((x) => x.investigation && x.investigation.status !== "orphaned");
            if (f) {
                investigated = { reportId: r.oid, findingId: f.id };
                break;
            }
        }
        return {
            dossier: dossiers[0] ? { id: dossiers[0].id, objective: dossiers[0].objective } : null,
            decided,
            radar: cited
                ? {
                      reportId: cited.oid,
                      findingId: cited.findings[0].id,
                      newest: newest.get(cited.projectpath)?.oid === cited.oid,
                  }
                : null,
            investigated,
        };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const waitFor = async (expr, ms) => {
            for (let waited = 0; waited < ms; waited += 250) {
                if ((await h.ev(expr)) === true) return true;
                await settle(250);
            }
            return false;
        };
        const present = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
        const toastText = () =>
            h.ev(`[...document.querySelectorAll('[data-notification-toast]')].map((t) => t.innerText).join(' | ')`);
        // the hook installs when the Brief mounts, and a reload undoes it, so every step re-arms it first
        const open = async (address, hint) => {
            await h.goto("jarvis");
            if (!(await waitFor(`typeof window.__openAddress === 'function'`, 5000))) return null;
            return h.ev(`window.__openAddress(${JSON.stringify(address)}, ${JSON.stringify(hint ?? null)})`);
        };
        const peekShows = (objective) =>
            waitFor(
                `(document.querySelector('[data-jarvis-brief-band="peek"]')?.innerText || '').includes(${JSON.stringify(
                    (objective || "").slice(0, 40)
                )})`,
                5000
            );
        // Escape closes the peek (and the run sheet in step 6); waiting on the peek band keeps the next step from
        // reading the previous step's overlay
        const dismissOverlay = async () => {
            await h.ev(
                `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
            );
            await waitFor(`!document.querySelector('[data-jarvis-brief-band="peek"]')`, 2000);
        };

        await h.goto("jarvis");
        rec(
            "1. the DEV hook that opens an address is installed on the Brief",
            (await waitFor(`typeof window.__openAddress === 'function'`, 5000)) === true,
            ""
        );

        if (!ctx.dossier) {
            rec(
                "2. a record address opens the record's peek",
                false,
                "no record in this profile - seed one before reading this as a pass"
            );
        } else {
            const result = await open(`task:${ctx.dossier.id}`, { sourceType: "dossier" });
            const shown = await peekShows(ctx.dossier.objective);
            rec(
                "2. a record address opens the record's peek",
                result?.ok === true && shown,
                JSON.stringify({ result, shown, toasts: await toastText() })
            );
            await dismissOverlay();
        }

        if (!ctx.decided) {
            steps.push(
                skipStep(
                    "3. a decision address opens its record's peek",
                    "no record with a decision among the first 25 - record one before reading this as a pass"
                )
            );
        } else {
            const result = await open(`task:${ctx.decided.dossierId}`, {
                sourceType: "decision",
                anchor: ctx.decided.decisionId,
            });
            const shown = await peekShows(ctx.decided.objective);
            rec(
                "3. a decision address opens its record's peek",
                result?.ok === true && shown,
                JSON.stringify({ result, shown, toasts: await toastText() })
            );
            await dismissOverlay();
        }

        {
            // persisted work refs still carry memnote: addresses; one the vault no longer serves toasts and
            // opens nothing (a note that exists shows in the avatar popup)
            const result = await open("memnote:a-note-the-vault-no-longer-serves", { sourceType: "memory" });
            const surface = await h.activeSurfaceLabel();
            rec(
                "4. a memory address opens nothing and leaves the surface where it was",
                result?.ok === false && surface === SURFACE_LABEL.jarvis,
                JSON.stringify({ result, surface })
            );
        }

        if (!ctx.radar) {
            steps.push(
                skipStep(
                    "5. a finding address lands on that finding on a first Radar visit",
                    "no scan report with findings in this profile - run a Radar scan before reading this as a pass"
                )
            );
        } else {
            // a reload is what makes this Radar's first visit: its scope lives in module state
            await h.ev("location.reload()");
            await settle(2800);
            const result = await open(`radarreport:${ctx.radar.reportId}`, {
                sourceType: "radar",
                anchor: ctx.radar.findingId,
            });
            const selector = `[data-radar-finding-detail="${ctx.radar.findingId}"][data-radar-report="${ctx.radar.reportId}"]`;
            const shown = await waitFor(present(selector), 8000);
            const surface = await h.activeSurfaceLabel();
            rec(
                "5. a finding address lands on that finding on a first Radar visit",
                result?.ok === true && shown && surface === SURFACE_LABEL.radar,
                JSON.stringify({ result, shown, surface, olderThanNewest: !ctx.radar.newest, toasts: await toastText() })
            );
        }

        if (!ctx.investigated) {
            steps.push(
                skipStep(
                    "6. Radar's Open run lands on the run's sheet",
                    "no investigated finding in this profile - start an investigation from Radar before reading this as a pass"
                )
            );
        } else {
            const { reportId, findingId } = ctx.investigated;
            const result = await open(`radarreport:${reportId}`, { sourceType: "radar", anchor: findingId });
            const detail = `[data-radar-finding-detail="${findingId}"]`;
            const onFinding = await waitFor(present(detail), 8000);
            const opened =
                onFinding &&
                (await h.ev(`(() => {
                    const b = [...document.querySelectorAll(${JSON.stringify(`${detail} button`)})]
                        .find((x) => (x.textContent || '').trim() === 'Open run');
                    if (!b) return false;
                    b.click();
                    return true;
                })()`));
            const runBody = await waitFor(
                present('[data-jarvis-brief-sheet="channel"] [data-jarvis-brief-sheet-face="settings"]'),
                10000
            );
            const surface = await h.activeSurfaceLabel();
            rec(
                "6. Radar's Open run lands on the run's sheet",
                result?.ok === true && opened && runBody && surface === SURFACE_LABEL.jarvis,
                JSON.stringify({ result, onFinding, opened, runBody, surface, toasts: await toastText() })
            );
            await dismissOverlay();
        }

        await h.goto("jarvis");
        await waitFor(`typeof window.__openAddress === 'function'`, 5000);
        const result = await h.ev(`window.__openAddress("bogus:resource-linking-probe")`);
        await settle(400);
        const toasts = await toastText();
        const surface = await h.activeSurfaceLabel();
        rec(
            "7. an address nothing can open shows the toast and leaves the surface where it was",
            result?.reason === "unsupported" &&
                toasts.includes("This item can't be opened") &&
                surface === SURFACE_LABEL.jarvis,
            JSON.stringify({ result, toasts, surface })
        );
        await h.shot("cdp-shots/resource-linking.png");
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// --- cockpit UI API (wsh ui) ----------------------------------------------------------------------
// Calls the real FE handlers on the fixed "cockpit" route. The FE router delivers a same-window call
// locally, so the wavesrv routing hop that a real `wsh ui` takes is NOT under test here — the manual
// wsh smoke in the plan covers it; wshcmd-ui_test.go covers the CLI's own logic.
const UI_ROUTE = { route: "cockpit", timeout: 15000 };

const uiApi = {
    name: "ui-api",
    surface: "cockpit",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const call = async (command, data) => {
            try {
                return { value: await h.rpc(command, data, UI_ROUTE) };
            } catch (e) {
                return { error: String(e?.message ?? e) };
            }
        };
        const toastCount = () => h.ev(`document.querySelectorAll('[data-notification-toast]').length`);
        const toastWith = (text) =>
            h.ev(
                `[...document.querySelectorAll('[data-notification-toast]')].some((t) => (t.textContent || '').includes(${JSON.stringify(text)}))`
            );
        // a keystroke an earlier scenario sent would otherwise hold the first call in the busy wait
        await settle(1600);

        const s1 = await call("uistate", null);
        rec(
            "1. uistate reports the surface the harness is on, with actions",
            s1.value?.surface === "cockpit" && Array.isArray(s1.value?.actions) && s1.value.actions.length > 0,
            JSON.stringify({ surface: s1.value?.surface, actions: s1.value?.actions?.length, error: s1.error })
        );

        const r2 = await call("uireveal", { address: "surface:usage" });
        await settle(400);
        const active2 = await h.activeSurfaceLabel();
        rec(
            "2. uireveal surface:usage lands Usage",
            !r2.error && active2 === SURFACE_LABEL.usage,
            `active=${active2} error=${r2.error}`
        );

        const before3 = await toastCount();
        const r3 = await call("uireveal", { address: "run:00000000-0000-0000-0000-000000000000" });
        await settle(400);
        const after3 = await toastCount();
        rec(
            "3. uireveal of a missing run errors to the caller and pushes no toast",
            !!r3.error && after3 <= before3,
            `error=${r3.error} toasts ${before3}->${after3}`
        );

        const r4 = await call("uiinvoke", { actionid: "go:cockpit" });
        await settle(400);
        const active4 = await h.activeSurfaceLabel();
        const trail4 = await toastWith("Cockpit (home)");
        rec(
            "4. uiinvoke go:cockpit lands Cockpit and leaves a trail toast",
            !r4.error && active4 === SURFACE_LABEL.cockpit && trail4 === true,
            `active=${active4} trail=${trail4} error=${r4.error}`
        );

        const r5 = await call("uiinvoke", { actionid: "no-such-action" });
        rec(
            "5. uiinvoke of an unavailable id errors with the actions hint",
            /see wsh ui actions/.test(r5.error ?? ""),
            `error=${r5.error}`
        );

        // bare Shift has no binding, so this only marks the user as active
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft", modifiers: 8 });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft" });
        const t0 = Date.now();
        const r6 = await call("uireveal", { address: "surface:usage" });
        const waited = Date.now() - t0;
        rec(
            "6. a reveal right after a keystroke waits out the idle window",
            !r6.error && waited >= 1300,
            `waited=${waited}ms error=${r6.error}`
        );
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit"); // leave the app where a human expects it
    },
};

// The Agent tree and the details rail on the brief type scale (docs/superpowers/specs/2026-09-29-agent-tree-rail-
// polish-design.md): lucide marks instead of text glyphs, and nothing smaller than 10.5px. The roster is a dev
// fixture; the lead's run is a real orchestrator run held by deferstart, so the tree nests the fixture lead under it
// and the rail shows its Run section. agent-tree-rail also gives that run a chained plan, which dispatches one real
// worker (t-1) that teardown deletes, and gives the lead a temp transcript with one working subagent, so the worker
// row, its guide, the task strip and the subagent row are all rendered for the sweeps.
const TREE_RAIL_FIXTURE = new URL("../../public/cockpit-fixtures/active.json", import.meta.url);
const TREE_RAIL_LEAD = "tree-rail lead";
const RAIL_VISIBLE_KEY = "agent.rail.visible";
// the text glyphs the polish replaced with lucide icons
const TREE_RAIL_GLYPHS = ["↳", "◆", "▸", "▾", "›_", "↗", "‹"];
const MIN_FONT_PX = 10.5;
const TREE_RAIL_LEAD_ID = "fx-lead";

function treeRailRoster(runId, now, leadName = TREE_RAIL_LEAD, leadExtra = {}) {
    return [
        {
            id: TREE_RAIL_LEAD_ID,
            name: leadName,
            project: "waveterm",
            task: "verify tree rail",
            state: "working",
            agent: "claude",
            model: "opus",
            activeMs: 240_000,
            runId,
            blockId: "fx-blk-lead",
            ...leadExtra,
        },
        {
            id: "fx-ask-wave",
            name: "wave asker",
            project: "waveterm",
            task: "pick a packaging track",
            state: "asking",
            model: "opus",
            blockedMs: 120_000,
            blockId: "fx-blk-ask-wave",
        },
        {
            id: "fx-ask-siem",
            name: "siem asker",
            project: "siem-platform",
            task: "pick a detector track",
            state: "asking",
            model: "opus",
            blockedMs: 60_000,
            blockId: "fx-blk-ask-siem",
        },
        {
            id: "fx-idle",
            name: "idle scribe",
            project: "siem-platform",
            task: "release notes",
            state: "idle",
            model: "sonnet",
            idleSince: now - 60_000,
            blockId: "fx-blk-idle",
        },
    ];
}

// a real orchestrator run held in planning, and the fixture roster whose lead carries its id
async function arrangeFixtureRun(h, ctx, label, leadName, leadExtra, runExtra) {
    const wslist = await h.rpc("workspacelist", null);
    const ch = await h.rpc("createchannel", { name: `verify-${label}`, projectpath: ctx.cwd });
    ctx.channelId = ch.oid;
    const created = await h.rpc("createrun", {
        channelid: ctx.channelId,
        workspaceid: wslist[0].workspacedata.oid,
        goal: `verify ${label}: do nothing`,
        runtime: "claude",
        mode: "orchestrator",
        deferstart: true,
        ...runExtra,
    });
    ctx.runId = created.run.id;
    ctx.landPath = created.run.landpath;
    mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
    writeFileSync(
        TREE_RAIL_FIXTURE,
        JSON.stringify(treeRailRoster(ctx.runId, Date.now(), leadName, leadExtra), null, 2)
    );
    ctx.wroteFixture = true;
}

// t-1's dispatch has taken anywhere from 0.2s to 28s on the dev app, the slow ones right after another scenario
const DISPATCH_WAIT_MS = 60_000;

// polls the run's DAG until the task has a worker run, recording the outcome and the wait on ctx
async function waitForDispatch(h, ctx, taskId) {
    const start = Date.now();
    while (!ctx.dispatched && Date.now() - start < DISPATCH_WAIT_MS) {
        const group = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
        ctx.dispatched = !!group?.tasks?.find((t) => t.id === taskId)?.runid;
        if (!ctx.dispatched) await new Promise((r) => setTimeout(r, 500));
    }
    ctx.dispatchMs = Date.now() - start;
}

// best-effort, so one failed worker does not strand the rest; the failures are thrown after, for the caller to log
async function deleteChannelWorkerBlocks(h, channelId) {
    const failed = [];
    for (const run of await channelRuns(h, channelId)) {
        for (const phase of run.phases || []) {
            for (const oref of phase.workerorefs || []) {
                try {
                    const tab = await waveService(h, "object", "GetObject", [oref]);
                    const bid = tab && tab.blockids && tab.blockids[0];
                    if (bid) await h.rpc("deleteblock", { blockid: bid });
                } catch (e) {
                    failed.push(`${oref}: ${e?.message ?? e}`);
                }
            }
        }
    }
    if (failed.length) throw new Error(failed.join("; "));
}

// the root engine trees live under, as pkg/orchestrate/worktreeroot.go resolves it from os.UserCacheDir
function arcWorktreeRoot() {
    const cache =
        process.platform === "win32"
            ? process.env.LOCALAPPDATA
            : process.platform === "darwin"
              ? join(homedir(), "Library", "Caches")
              : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    return join(cache, "arc-wt");
}

// a fixture repo's linked worktrees: the run's landing tree and its lanes' trees
function linkedWorktrees(cwd) {
    if (!cwd || !existsSync(join(cwd, ".git"))) return [];
    const out = execFileSync("git", ["-C", cwd, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    const trees = out
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => resolve(line.slice("worktree ".length).trim()));
    // the first is the repo's own checkout
    return trees.slice(1);
}

async function teardownFixtureRun(h, ctx, name, restore) {
    const step = async (what, fn) => {
        try {
            await fn();
        } catch (e) {
            console.error(`${name} teardown: ${what} failed: ${e?.message ?? e}`);
        }
    };
    if (ctx.wroteFixture) await step("remove the fixture roster", () => rmSync(TREE_RAIL_FIXTURE, { force: true }));
    if (restore) await step(restore.what, restore.fn);
    if (ctx.runId) {
        await step("cancel the run", () => h.rpc("cancelrun", { channelid: ctx.channelId, runid: ctx.runId }));
    }
    if (ctx.channelId) {
        // cancelling a run stops its workers but leaves their blocks
        await step("delete the worker blocks", () => deleteChannelWorkerBlocks(h, ctx.channelId));
        await step("delete the channel", () => h.rpc("deletechannel", { channelid: ctx.channelId }));
    }
    await step("reload onto the live roster", async () => {
        await h.ev("location.reload()");
        await new Promise((r) => setTimeout(r, 2500));
    });
    // engine trees live under the arc-wt root, not the temp dir, and a cancel leaves the landing tree: only a land
    // removes it. A worker just stopped holds its lane's tree for a moment, hence the retries.
    const trees = new Set(ctx.landPath ? [resolve(ctx.landPath)] : []);
    await step("list the run's trees", () => linkedWorktrees(ctx.cwd).forEach((tree) => trees.add(tree)));
    for (const tree of trees) {
        await step(`remove the run tree ${tree}`, () =>
            rmSync(tree, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
        );
    }
    await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
    const left = [...trees].filter((tree) => existsSync(tree));
    if (left.length) throw new Error(`${name} teardown: run trees left behind: ${left.join(", ")}`);
    if (trees.size) console.log(`${name} teardown: run trees gone: ${[...trees].join(", ")}`);
}

const TREE_RAIL_SUBAGENT_PROMPT = "survey the tree rail";

// a parent transcript with one subagent file whose last record is not an assistant turn, so it reads as working
function writeLeadTranscript(cwd) {
    const parent = join(cwd, "lead.jsonl");
    const subs = join(cwd, "lead", "subagents");
    mkdirSync(subs, { recursive: true });
    const userTurn = (content) => JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
    writeFileSync(parent, userTurn("verify tree rail"));
    writeFileSync(join(subs, "agent-fxsub.jsonl"), userTurn(TREE_RAIL_SUBAGENT_PROMPT));
    return parent;
}

async function arrangeTreeRail(h, ctx) {
    await arrangeFixtureRun(h, ctx, "tree-rail", TREE_RAIL_LEAD, { transcriptPath: writeLeadTranscript(ctx.cwd) });
    await h.rpc("dagsubmit", {
        channelid: ctx.channelId,
        runid: ctx.runId,
        title: "verify tree-rail",
        parallelism: 1,
        tasks: RUN_SHEET_POLISH_TASKS,
    });
    // a queued task folds away, so t-1 has a worker row only once it dispatches
    await waitForDispatch(h, ctx, "t-1");
    // the rail is off by default and persisted, and the fixture roster is read once at boot
    await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
    await h.ev("location.reload()");
    await h.ev(`(async () => {
        for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
            await new Promise((r) => setTimeout(r, 500));
        }
    })()`);
    await h.goto("agent");
    // the lead row nests once its run loads, which is when its mark turns from a dot into the Workflow icon
    ctx.leadFocused = await h.ev(`(async () => {
        const leadRow = () => {
            const tree = document.querySelector("[data-agent-tree]");
            const name = tree && [...tree.querySelectorAll("div")].find(
                (d) => d.textContent.trim() === ${JSON.stringify(TREE_RAIL_LEAD)} && d.children.length === 0
            );
            return name ? name.closest(".cursor-pointer") : null;
        };
        for (let i = 0; i < 40; i++) {
            const row = leadRow();
            if (row && row.firstElementChild?.firstElementChild?.tagName.toLowerCase() === "svg") {
                row.click();
                return true;
            }
            await new Promise((r) => setTimeout(r, 250));
        }
        return false;
    })()`);
    // let the rail's width slide and the run section settle before the shot
    await new Promise((r) => setTimeout(r, 1200));
}

const agentTreeRail = {
    name: "agent-tree-rail",
    surface: "agent",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-tree-rail-"));
        const ctx = { cwd, prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`) };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await arrangeTreeRail(h, ctx);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const RAIL = `document.querySelector('aside[aria-label="Agent details"]')`;
        const TREE = `document.querySelector("[data-agent-tree]")`;
        const HEADER = `document.querySelector("[data-agent-header]")`;
        rec(
            "0. the lead row nested under its run and was focused, and t-1 dispatched",
            ctx.arrangeError == null && ctx.leadFocused === true && ctx.dispatched === true,
            ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, dispatched: ctx.dispatched, dispatchMs: ctx.dispatchMs })
        );

        const badges = await h.ev(`(() => {
            const tree = ${TREE};
            if (!tree) return null;
            return [...tree.querySelectorAll("span")]
                .map((s) => s.textContent.trim())
                .filter((t) => /^\\d+ asking$/.test(t));
        })()`);
        rec(
            "1. each live project's group carries an asking badge",
            Array.isArray(badges) && badges.filter((t) => t === "1 asking").length === 2,
            `badges=${JSON.stringify(badges)}`
        );

        const glyphs = await h.ev(`(() => {
            const glyphs = ${JSON.stringify(TREE_RAIL_GLYPHS)};
            const hits = [];
            for (const root of [${TREE}, ${RAIL}, ${HEADER}]) {
                if (!root) continue;
                const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                    if (glyphs.some((g) => n.data.includes(g))) hits.push(n.data.trim());
                }
            }
            return { tree: !!${TREE}, rail: !!${RAIL}, header: !!${HEADER}, hits };
        })()`);
        rec(
            "2. no text glyph survives in the tree, the rail or the focused lead's header",
            glyphs.tree && glyphs.rail && glyphs.header && glyphs.hits.length === 0,
            JSON.stringify(glyphs)
        );

        const mark = await h.ev(`(() => {
            const tree = ${TREE};
            const name = tree && [...tree.querySelectorAll("div")].find(
                (d) => d.textContent.trim() === ${JSON.stringify(TREE_RAIL_LEAD)} && d.children.length === 0
            );
            const row = name && name.closest(".cursor-pointer");
            const slot = row && row.firstElementChild;
            const first = slot && slot.firstElementChild;
            return {
                tag: first ? first.tagName.toLowerCase() : null,
                slotWidth: slot ? getComputedStyle(slot).width : null,
            };
        })()`);
        rec(
            "3. the lead row's mark is an svg in the 14px leading column",
            mark.tag === "svg" && mark.slotWidth === "14px",
            JSON.stringify(mark)
        );

        const labels = await h.ev(`(() => {
            const rail = ${RAIL};
            if (!rail) return null;
            const out = {};
            for (const h3 of rail.querySelectorAll("h3")) {
                const t = h3.textContent.trim();
                if (t === "Details" || t === "Run") {
                    const cs = getComputedStyle(h3);
                    out[t] = { size: cs.fontSize, weight: cs.fontWeight };
                }
            }
            return out;
        })()`);
        const onScale = (l) => l != null && l.size === `${MIN_FONT_PX}px` && l.weight === "700";
        rec(
            "4. the rail's Details and Run headings are 10.5px bold",
            labels != null && onScale(labels.Details) && onScale(labels.Run),
            JSON.stringify(labels)
        );

        const small = await h.ev(`(() => {
            const min = ${MIN_FONT_PX};
            const offenders = [];
            let seen = 0;
            for (const root of [${TREE}, ${RAIL}]) {
                if (!root) continue;
                const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                    const text = n.data.trim();
                    if (!text) continue;
                    const range = document.createRange();
                    range.selectNodeContents(n);
                    const r = range.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    const cs = getComputedStyle(n.parentElement);
                    if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
                    seen++;
                    const px = parseFloat(cs.fontSize);
                    if (px < min) offenders.push(text.slice(0, 40) + " @" + cs.fontSize);
                }
            }
            return { seen, offenders };
        })()`);
        rec(
            "5. no visible text in the tree or the rail is under 10.5px",
            small.seen > 0 && small.offenders.length === 0,
            `checked ${small.seen} text nodes; offenders=${JSON.stringify(small.offenders)}`
        );

        const collapse = await h.ev(`(() => {
            const b = ${RAIL}?.querySelector('[aria-label="Collapse panel"]');
            return b ? !!b.querySelector("svg") : null;
        })()`);
        rec("6. the rail's collapse control is an icon", collapse === true, `svg=${collapse}`);

        // the rows the sweeps above only cover when they render: a nested row's guide is a 1px line in its first column
        const nested = await h.ev(`(() => {
            const tree = ${TREE};
            if (!tree) return null;
            const rowOf = (text) => {
                const name = [...tree.querySelectorAll("div")].find(
                    (d) => d.textContent.trim() === text && d.children.length === 0
                );
                return name ? name.closest(".relative") : null;
            };
            const guides = (row) =>
                row ? [...row.children].filter((c) => c.tagName === "SPAN" && getComputedStyle(c).width === "1px").length : 0;
            const lead = rowOf(${JSON.stringify(TREE_RAIL_LEAD)});
            const worker = rowOf(${JSON.stringify(RUN_SHEET_POLISH_TASKS[0].label)});
            const sub = rowOf(${JSON.stringify(TREE_RAIL_SUBAGENT_PROMPT)});
            return {
                strip: lead?.querySelector("[role=img]")?.getAttribute("aria-label") ?? null,
                workersChip: lead?.querySelector('button[aria-label="Hide workers"]')?.textContent.trim() ?? null,
                progress: (() => {
                    const s = lead?.querySelector("span.truncate.text-muted");
                    return s ? { text: s.textContent.trim(), clipped: s.scrollWidth > s.clientWidth } : null;
                })(),
                worker: !!worker,
                workerGuides: guides(worker),
                sub: !!sub,
                subGuides: guides(sub),
            };
        })()`);
        rec(
            "7. the lead's run line carries its workers chip, unclipped progress and the task strip",
            nested != null &&
                /^\d+ of 3 tasks done/.test(nested.strip ?? "") &&
                /workers?$/.test(nested.workersChip ?? "") &&
                nested.progress != null &&
                !nested.progress.clipped,
            JSON.stringify(nested)
        );
        rec(
            "8. t-1's worker row sits under the lead with one guide line",
            nested != null && nested.worker && nested.workerGuides === 1,
            JSON.stringify(nested)
        );
        rec(
            "9. the lead's working subagent is listed under it with one guide line",
            nested != null && nested.sub && nested.subGuides === 1,
            JSON.stringify(nested)
        );
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "agent-tree-rail", {
            what: "restore the rail preference",
            fn: () =>
                h.ev(
                    ctx.prevRail == null
                        ? `localStorage.removeItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`
                        : `localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, ${JSON.stringify(ctx.prevRail)})`
                ),
        });
    },
};

// Leaving the Agent surface and coming straight back must not replay a slide on the tree. The switch commit that
// hides the surface (display:none) used to re-render the tree, so motion measured every layout="position" row at
// (0,0) and began tweening it there; back within ~400ms, the list visibly shrank into place. Needs a roster with
// at least two rows (live, or a cockpit fixture).
const QUICK_RETURN_DWELL_MS = 250;
const QUICK_RETURN_SAMPLE_MS = 600;

const agentTreeQuickReturn = {
    name: "agent-tree-quick-return",
    surface: "agent",
    async arrange() {
        return {};
    },
    async assert(h) {
        const rows = await h.ev(`document.querySelectorAll("[data-agent-tree] .overflow-y-auto > div").length`);
        if (rows < 2) {
            return [
                skipStep(
                    "rows hold still on a quick return",
                    `${rows} tree rows; seed a roster (npm run cockpit:fixtures -- mixed)`
                ),
            ];
        }
        const r = await h.ev(`new Promise((resolve) => {
            const nav = (label) => [...document.querySelectorAll("nav button")]
                .find((x) => x.getAttribute("aria-label") === label || (x.textContent || "").trim() === label)
                .click();
            nav(${JSON.stringify(SURFACE_LABEL.code)});
            setTimeout(() => {
                nav(${JSON.stringify(SURFACE_LABEL.agent)});
                let max = 0;
                const t0 = performance.now();
                const tick = () => {
                    for (const el of document.querySelectorAll("[data-agent-tree] .overflow-y-auto > div")) {
                        const tf = getComputedStyle(el).transform;
                        if (tf && tf !== "none") {
                            const m = new DOMMatrix(tf);
                            max = Math.max(max, Math.abs(m.m41), Math.abs(m.m42));
                        }
                    }
                    if (performance.now() - t0 < ${QUICK_RETURN_SAMPLE_MS}) requestAnimationFrame(tick);
                    else resolve(Math.round(max * 10) / 10);
                };
                requestAnimationFrame(tick);
            }, ${QUICK_RETURN_DWELL_MS});
        })`);
        return [
            {
                step: `rows hold still on a return within ${QUICK_RETURN_DWELL_MS}ms`,
                ok: r < 1,
                detail: `${rows} rows; max row offset ${r}px over ${QUICK_RETURN_SAMPLE_MS}ms`,
            },
        ];
    },
    async teardown() {},
};

// A lead's Spec review ask opens as the review dialog over whatever agent is focused (git show a4b5bd4f:
// docs/superpowers/plans/2026-09-30-doc-review-dialog.md). Same setup as agent-tree-rail, with a roster of a working agent and a lead
// asking a Spec review whose document the scenario writes. The working agent comes in through its Cockpit card, so
// the Agent surface never defaults onto the lead and spends its one auto-open before step 4. Nothing is answered:
// the fixture ask has no live block.
const DOC_REVIEW_LEAD = "doc-review lead";
const DOC_REVIEW_LEAD_ID = "fx-doc-lead";
const DOC_REVIEW_WORKER = "doc-review worker";
const DOC_REVIEW_WORKER_ID = "fx-doc-worker";
const DOC_REVIEW_HEADING = "Doc review fixture spec";
const DOC_REVIEW_DECISIONS = [
    "The dialog opens over any focused agent",
    "Esc hides it and the ask stays open",
    "It auto-opens once on the lead",
];
const DOC_REVIEW_TAG_TITLE = "Open the spec review";
const DOC_REVIEW_CHIP = "Spec review";
const DOC_REVIEW_PANEL = `document.querySelector("[data-doc-review]")?.closest('[role="dialog"]')`;

function docReviewRoster(runId, docPath, decisions = DOC_REVIEW_DECISIONS) {
    return [
        {
            id: DOC_REVIEW_WORKER_ID,
            name: DOC_REVIEW_WORKER,
            project: "waveterm",
            task: "keep working",
            state: "working",
            agent: "claude",
            model: "opus",
            activeMs: 90_000,
            blockId: "fx-blk-doc-worker",
            // the Cockpit leaves an agent with nothing to show off its grid (cardHasContent)
            previousInfo: [{ kind: "message", text: "Working through the fixture task." }],
        },
        {
            id: DOC_REVIEW_LEAD_ID,
            name: DOC_REVIEW_LEAD,
            project: "waveterm",
            task: "verify doc review",
            state: "asking",
            agent: "claude",
            model: "opus",
            blockedMs: 60_000,
            runId,
            blockId: "fx-blk-doc-lead",
            ask: {
                askId: `fx-doc-review-${Date.now()}`,
                oref: "block:fx-blk-doc-lead",
                questions: [
                    {
                        header: DOC_REVIEW_CHIP,
                        question: [docPath, ...decisions.map((d) => `- ${d}`)].join("\n"),
                        options: [{ label: "Approve" }, { label: "Request changes" }],
                    },
                ],
            },
        },
    ];
}

// the lead's row in the Agent tree, found by its name leaf as agent-tree-rail does
const docReviewTreeRow = (name) => `(() => {
    const tree = document.querySelector("[data-agent-tree]");
    const leaf = tree && [...tree.querySelectorAll("div")].find(
        (d) => d.textContent.trim() === ${JSON.stringify(name)} && d.children.length === 0
    );
    return leaf ? leaf.closest(".cursor-pointer") : null;
})()`;

// polls a boolean page expression; resolves to its last value
const docReviewWait = (h, expr, ms = 5000) =>
    h.ev(`(async () => {
        const t0 = performance.now();
        for (;;) {
            const v = !!(${expr});
            if (v || performance.now() - t0 > ${ms}) return v;
            await new Promise((r) => setTimeout(r, 150));
        }
    })()`);

// Escape where the user's focus is, so ModalShell's window listener sees it the way a keypress would reach it
const docReviewEscape = (h) =>
    h.ev(`(document.activeElement || document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })
    )`);

const docReviewHeaderNames = (h) =>
    h.ev(`(() => {
        const t = document.querySelector("[data-agent-header]")?.textContent ?? "";
        return { worker: t.includes(${JSON.stringify(DOC_REVIEW_WORKER)}), lead: t.includes(${JSON.stringify(DOC_REVIEW_LEAD)}) };
    })()`);

// focus the lead through its tree row with nothing editable focused, so auto-open is allowed to fire
const docReviewFocusRow = (h, name) =>
    h.ev(`(() => {
        document.activeElement?.blur?.();
        document.querySelector("[data-cockpit-surface-wrap]")?.focus();
        const row = ${docReviewTreeRow(name)};
        if (!row) return false;
        row.click();
        return true;
    })()`);

const docReview = {
    name: "doc-review",
    surface: "cockpit",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-doc-review-"));
        const ctx = { cwd };
        try {
            await arrangeFixtureRun(h, ctx, "doc-review", DOC_REVIEW_LEAD);
            ctx.specPath = join(cwd, "doc-review-spec.md");
            writeFileSync(
                ctx.specPath,
                `# ${DOC_REVIEW_HEADING}\n\nA small spec the doc-review scenario writes for the dialog to render.\n`
            );
            writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(docReviewRoster(ctx.runId, ctx.specPath), null, 2));
            // the fixture roster is read once at boot
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("cockpit");
            ctx.rosterLoaded = await docReviewWait(
                h,
                `document.querySelector('[data-cockpit-surface] [data-agent-id="${DOC_REVIEW_WORKER_ID}"]')`,
                15000
            );
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const nap = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        const dialogOpen = () => h.ev(`!!${DOC_REVIEW_PANEL}`);
        const dialogGone = (ms) => docReviewWait(h, `!${DOC_REVIEW_PANEL}`, ms);
        if (ctx.arrangeError != null || !ctx.rosterLoaded) {
            return [{ step: "0. the fixture roster loaded", ok: false, detail: ctx.arrangeError ?? "no worker card" }];
        }

        // the card's terminal button focuses the worker and switches to the Agent surface in one step
        const opened = await h.ev(`(() => {
            const b = document.querySelector(
                '[data-cockpit-surface] [data-agent-id="${DOC_REVIEW_WORKER_ID}"] button[title="Open terminal (T)"]'
            );
            if (!b) return false;
            b.click();
            return true;
        })()`);
        const tagged = await docReviewWait(
            h,
            `${docReviewTreeRow(DOC_REVIEW_LEAD)}?.querySelector('button[title="${DOC_REVIEW_TAG_TITLE}"]')`
        );
        await nap(500);
        const names1 = await docReviewHeaderNames(h);
        const anyDialog1 = await h.ev(`!!document.querySelector('[role="dialog"]')`);
        rec(
            "1. on the working agent: no dialog, and the lead's tree row has the review tag",
            opened && names1.worker && !anyDialog1 && tagged,
            JSON.stringify({ opened, header: names1, dialog: anyDialog1, tagged })
        );

        await h.ev(`${docReviewTreeRow(DOC_REVIEW_LEAD)}?.querySelector('button[title="${DOC_REVIEW_TAG_TITLE}"]')?.click()`);
        const open2 = await docReviewWait(h, DOC_REVIEW_PANEL);
        // the document is read over RPC, so its heading lands after the panel
        await docReviewWait(h, `${DOC_REVIEW_PANEL}?.querySelector("h1")`);
        const panel2 = await h.ev(`(() => {
            const p = ${DOC_REVIEW_PANEL};
            if (!p) return null;
            return {
                kind: p.querySelector("[data-doc-review]").getAttribute("data-doc-review"),
                heading: p.querySelector("h1")?.textContent.trim() ?? null,
                items: p.querySelectorAll("ol > li").length,
            };
        })()`);
        const names2 = await docReviewHeaderNames(h);
        await h.shot("cdp-shots/doc-review-dialog.png");
        rec(
            "2. the tag opens the dialog over the working agent: the spec on the left, 3 decisions on the right",
            open2 &&
                panel2?.kind === "spec" &&
                panel2?.heading === DOC_REVIEW_HEADING &&
                panel2?.items === DOC_REVIEW_DECISIONS.length &&
                names2.worker &&
                !names2.lead,
            JSON.stringify({ panel: panel2, header: names2 })
        );

        await docReviewEscape(h);
        const gone3 = await dialogGone(3000);
        const names3 = await docReviewHeaderNames(h);
        rec(
            "3. Escape hides the dialog and leaves the working agent focused",
            gone3 && names3.worker && !names3.lead,
            JSON.stringify({ gone: gone3, header: names3 })
        );

        const clicked4 = await docReviewFocusRow(h, DOC_REVIEW_LEAD);
        const auto4 = await docReviewWait(h, DOC_REVIEW_PANEL);
        const names4 = await docReviewHeaderNames(h);
        rec(
            "4a. focusing the lead with nothing editable focused opens the dialog by itself",
            clicked4 && auto4 && names4.lead,
            JSON.stringify({ clicked: clicked4, open: auto4, header: names4 })
        );

        await docReviewEscape(h);
        const gone4 = await dialogGone(3000);
        await docReviewFocusRow(h, DOC_REVIEW_WORKER);
        await nap(400);
        await docReviewFocusRow(h, DOC_REVIEW_LEAD);
        await nap(1200);
        const reopened = await dialogOpen();
        const names4b = await docReviewHeaderNames(h);
        rec(
            "4b. after Escape, refocusing the lead does not reopen it",
            gone4 && !reopened && names4b.lead,
            JSON.stringify({ gone: gone4, reopened, header: names4b })
        );

        const chipped = await h.ev(`(() => {
            const b = [...(document.querySelector("[data-agent-header]")?.querySelectorAll("button") ?? [])]
                .find((x) => x.textContent.trim() === ${JSON.stringify(DOC_REVIEW_CHIP)});
            if (!b) return false;
            b.click();
            return true;
        })()`);
        const open4 = await docReviewWait(h, DOC_REVIEW_PANEL);
        rec("4c. the header chip reopens it", chipped && open4, JSON.stringify({ chip: chipped, open: open4 }));
        await docReviewEscape(h);
        await dialogGone(3000);
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "doc-review");
    },
};

// Quoting passages of the reviewed document (docs/superpowers/plans/2026-10-05-highlight-to-quote.md): a selection
// in the document opens a note field, notes collect in the rail and travel with either answer. Same roster as
// doc-review, on the mockup's document and decisions. Selections, typing and keys are made in the page, since CDP
// input does not reliably reach the WebView. Nothing is delivered: the fixture ask has no live block, so a send
// shows the cockpit's own sent lock.
const DOC_NOTES_HEADING = "Highlight-to-quote in the review dialog";
const DOC_NOTES_FIELD = "A note field opens under the selection";
const DOC_NOTES_STAYS = "The passage stays highlighted in the document until its note is removed.";
const DOC_NOTES_REWORD = "A note can be reworded on the right afterwards.";
const DOC_NOTES_ORDER = "in document order";
const DOC_NOTES_CUT = "A long passage is cut to its first and last lines.";
const DOC_NOTES_KEYBOARD = "Selecting with the keyboard";
const DOC_NOTES_LAST = "The last round ends when every note is applied.";
// one token on a fenced block's second line, so a selection up to it crosses the block's header and a line number
const DOC_NOTES_FENCE = "quotedfence";
// enough one-line paragraphs after the mockup's text that the document pane scrolls
const DOC_NOTES_FILLER_ROUNDS = 16;
const DOC_NOTES_SPEC = [
    `# ${DOC_NOTES_HEADING}`,
    "## Goal",
    "Request changes is free text that points at nothing, so a change request has to describe the passage it means. Selecting a passage in the document and writing a note on it lets the answer carry the passage with it.",
    "## Gesture",
    `Select text in the document. ${DOC_NOTES_FIELD}: Enter adds the passage and what you wrote to your notes on the right, under the decisions, Esc drops it. ${DOC_NOTES_STAYS} ${DOC_NOTES_REWORD}`,
    "## Delivery",
    `Request changes sends each note as the quoted passage followed by what you wrote, ${DOC_NOTES_ORDER}, through the ask's own answer path. Approve sends them too, after the approval. ${DOC_NOTES_CUT} The whole answer is one message to the lead.`,
    "## Out of scope",
    `The Code surface's markdown preview and the run report. Quoting from the decisions list on the right. ${DOC_NOTES_KEYBOARD}: the passage is picked with the mouse, then everything after is keys.`,
    `\`\`\`ts\nalpha\n${DOC_NOTES_FENCE}\n\`\`\``,
    "## Review rounds",
    ...Array.from(
        { length: DOC_NOTES_FILLER_ROUNDS },
        (_, i) => `Round ${i + 1}: the lead applies the quoted notes and asks for the review again.`
    ),
    DOC_NOTES_LAST,
].join("\n\n");
const DOC_NOTES_DECISIONS = [
    "Quoting is built on the dialog's own light renderer; the shared Code-preview renderer is left alone.",
    "Highlights are painted over the rendered text, not wrapped into it, so the markdown output is untouched.",
    "Notes are kept per ask, survive hiding the dialog, and are cleared once the ask is answered.",
    "Approve carries any notes with it, and its button shows how many. Nothing you wrote is dropped.",
];
const DOC_NOTES_DECISIONS_CROWDED = [
    ...DOC_NOTES_DECISIONS,
    "A selection that crosses a code block or a table quotes its text only.",
    "Notes are sent in document order, not the order they were written.",
    "The same gesture works in the plan review; its findings are not quotable.",
    "A passage quoted twice makes two notes.",
    "Selecting inside the decisions list does nothing.",
];
const DOC_NOTES_STAYS_NOTE = "Keep it highlighted after sending too, until the lead picks it up.";
const DOC_NOTES_CUT_NOTE = "Don't cut it. Send the whole passage.";
const DOC_NOTES_REWORD_NOTE = "Clicking a note should scroll the document to its passage.";
const DOC_NOTES_REWORD_EDIT = "Scroll the document to the passage when its note is clicked.";
// the Crowded board's notes, in document order
const DOC_NOTES_CROWDED = [
    [DOC_NOTES_FIELD, "Open it above when the selection is near the bottom."],
    [DOC_NOTES_STAYS, DOC_NOTES_STAYS_NOTE],
    [DOC_NOTES_REWORD, DOC_NOTES_REWORD_NOTE],
    [DOC_NOTES_ORDER, "Yes. Not the order I wrote them in."],
    [DOC_NOTES_CUT, DOC_NOTES_CUT_NOTE],
    [DOC_NOTES_KEYBOARD, ""],
];
// the order they are written in
const DOC_NOTES_WRITTEN = [4, 1, 5, 0, 3, 2];
const DOC_NOTES_LIST_CAP = 300;
const DOC_NOTES_PANEL_WIDTH = 1240;
const DOC_NOTES_RAIL_WIDTH = 460;
const DOC_NOTES_EMPTY = "No note yet";

// page-side helpers, prefixed to every evaluated body. Every query is under the dialog panel.
const DOC_NOTES_LIB = `
    const panel = () => ${DOC_REVIEW_PANEL};
    const docRoot = () => panel()?.querySelector("[data-doc-review-doc]");
    const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
    const ranges = (name) => CSS.highlights.get(name)?.size ?? 0;
    const box = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    const ownText = (el) =>
        [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("").trim();
    const textNode = (root, passage) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const at = n.nodeValue.indexOf(passage);
            if (at >= 0) return { node: n, at };
        }
        return null;
    };
    const rangeOf = (passage) => {
        const hit = docRoot() && textNode(docRoot(), passage);
        if (!hit) return null;
        const range = document.createRange();
        range.setStart(hit.node, hit.at);
        range.setEnd(hit.node, hit.at + passage.length);
        return range;
    };
    const selectRange = (range) => {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        docRoot().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    };
    const select = (passage) => {
        const range = rangeOf(passage);
        if (!range) return null;
        selectRange(range);
        return box(range.getBoundingClientRect());
    };
    const type = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const key = (el, k, mods) =>
        el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true, cancelable: true, ...mods }));
    const fieldInput = () => panel()?.querySelector("[data-doc-note-field] input");
    const rowOf = (passage) =>
        [...panel().querySelectorAll("[data-doc-note-row]")].find((r) => r.textContent.includes(passage));
    const button = (label) => [...panel().querySelectorAll("button")].find((b) => ownText(b) === label);
    const addNote = async (passage, note) => {
        select(passage);
        await settle();
        const input = fieldInput();
        if (!input) return false;
        if (note) {
            type(input, note);
            await settle();
        }
        key(input, "Enter");
        await settle();
        return true;
    };
    const state = () => {
        const p = panel();
        if (!p) return { open: false };
        const notes = p.querySelector("[data-doc-notes]");
        const toggle = notes?.querySelector("[data-doc-notes-toggle]");
        const list = toggle?.nextElementSibling;
        const field = p.querySelector("[data-doc-note-field]");
        const decisions = p.querySelector("ol")?.parentElement;
        return {
            open: true,
            panel: box(p.getBoundingClientRect()),
            panelWidth: p.offsetWidth,
            railWidth: decisions?.parentElement.offsetWidth ?? null,
            heading: p.querySelector("[data-doc-review-doc] h1")?.textContent.trim() ?? null,
            items: p.querySelectorAll("ol > li").length,
            decisions: decisions ? { client: decisions.clientHeight, scroll: decisions.scrollHeight } : null,
            header: toggle?.querySelector("span")?.textContent.trim() ?? null,
            expanded: toggle?.getAttribute("aria-expanded") ?? null,
            list: list ? { client: list.clientHeight, scroll: list.scrollHeight } : null,
            rows: [...(notes?.querySelectorAll("[data-doc-note-row]") ?? [])].map((row) => {
                const edit = row.querySelector('button[aria-label="Edit this note"]');
                const input = row.querySelector("input");
                return {
                    open: row.getAttribute("data-open") === "true",
                    passage: (edit ?? row.firstElementChild)?.firstElementChild?.textContent ?? null,
                    note: input ? input.value : (edit?.children[1]?.textContent ?? null),
                    input: !!input,
                    locked: edit?.disabled ?? false,
                    remove: !!row.querySelector('button[aria-label="Remove this note"]'),
                };
            }),
            field: field ? box(field.getBoundingClientRect()) : null,
            fieldFocused: !!field && document.activeElement === field.querySelector("input"),
            quoted: ranges("doc-review-quoted"),
            pending: ranges("doc-review-pending"),
            buttons: [...p.querySelectorAll("button")].map(ownText).filter(Boolean),
            sent: [...p.querySelectorAll("span")].find((s) => s.textContent.startsWith("Sent: "))?.textContent ?? null,
        };
    };
`;

// runs a body in the page (it may await, and set out), lets React settle, and resolves to the dialog's state
const docNotesAct = (h, body = "") =>
    h.ev(`(async () => {
        ${DOC_NOTES_LIB}
        let out = null;
        ${body}
        await settle();
        return { ...state(), out };
    })()`);

const docNotesJson = (v) => JSON.stringify(v);

// what a step's detail keeps of the dialog's state
const docNotesBrief = (s, out) =>
    JSON.stringify({
        open: s.open,
        header: s.header,
        rows: (s.rows ?? []).map((r) => [r.passage, r.note, r.open ? "open" : r.locked ? "locked" : "compact"]),
        field: s.field != null,
        quoted: s.quoted,
        pending: s.pending,
        buttons: s.buttons,
        sent: s.sent,
        ...out,
    });

// the fixture roster is read once at boot
async function docNotesReload(h, ctx, decisions) {
    writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(docReviewRoster(ctx.runId, ctx.specPath, decisions), null, 2));
    await h.ev("location.reload()");
    await h.ev(`(async () => {
        for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
            await new Promise((r) => setTimeout(r, 500));
        }
    })()`);
    await h.goto("cockpit");
    return docReviewWait(
        h,
        `document.querySelector('[data-cockpit-surface] [data-agent-id="${DOC_REVIEW_WORKER_ID}"]')`,
        15000
    );
}

const docNotesTag = `${docReviewTreeRow(DOC_REVIEW_LEAD)}?.querySelector('button[title="${DOC_REVIEW_TAG_TITLE}"]')`;

// through the lead's tree tag, and resolved once the document is rendered and the panel has stopped scaling
async function docNotesOpenByTag(h) {
    const tagged = await docReviewWait(h, docNotesTag);
    await h.ev(`${docNotesTag}?.click()`);
    const open = await docReviewWait(h, DOC_REVIEW_PANEL);
    const rendered = await docReviewWait(h, `${DOC_REVIEW_PANEL}?.querySelector("[data-doc-review-doc] h1")`);
    await h.ev(`new Promise((r) => setTimeout(r, 500))`);
    return tagged && open && rendered;
}

// from the Cockpit: the worker's card leads to the Agent surface without spending the lead's auto-open
async function docNotesOpen(h) {
    await h.ev(`document.querySelector(
        '[data-cockpit-surface] [data-agent-id="${DOC_REVIEW_WORKER_ID}"] button[title="Open terminal (T)"]'
    )?.click()`);
    return docNotesOpenByTag(h);
}

const docReviewNotes = {
    name: "doc-review-notes",
    surface: "cockpit",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-doc-review-notes-"));
        const ctx = { cwd };
        try {
            await arrangeFixtureRun(h, ctx, "doc-review-notes", DOC_REVIEW_LEAD);
            ctx.specPath = join(cwd, "2026-10-05-highlight-to-quote-design.md");
            writeFileSync(ctx.specPath, `${DOC_NOTES_SPEC}\n`);
            // the panel and rail widths asserted below need the room, and verify.mjs restores its own pin after
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
            ctx.rosterLoaded = await docNotesReload(h, ctx, DOC_NOTES_DECISIONS);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
        const has = (s, label) => (s.buttons ?? []).includes(label);
        const passages = (s) => (s.rows ?? []).map((r) => r.passage);
        if (ctx.arrangeError != null || !ctx.rosterLoaded) {
            return [{ step: "0. the fixture roster loaded", ok: false, detail: ctx.arrangeError ?? "no worker card" }];
        }

        const opened1 = await docNotesOpen(h);
        const s1 = await docNotesAct(h);
        rec(
            "1. the dialog is open on the fixture spec: 4 decisions, no notes, Approve and Request changes, 1240 wide with a 460 rail",
            opened1 &&
                s1.heading === DOC_NOTES_HEADING &&
                s1.items === DOC_NOTES_DECISIONS.length &&
                s1.header == null &&
                s1.rows.length === 0 &&
                has(s1, "Approve") &&
                has(s1, "Request changes") &&
                s1.panelWidth === DOC_NOTES_PANEL_WIDTH &&
                s1.railWidth === DOC_NOTES_RAIL_WIDTH,
            docNotesBrief(s1, {
                opened: opened1,
                heading: s1.heading,
                items: s1.items,
                panelWidth: s1.panelWidth,
                railWidth: s1.railWidth,
            })
        );

        const s2 = await docNotesAct(h, `out = select(${docNotesJson(DOC_NOTES_STAYS)});`);
        rec(
            "2. selecting a passage opens the note field under it, focused, and tints the passage",
            s2.out != null && s2.field != null && s2.field.top >= s2.out.bottom && s2.fieldFocused && s2.pending === 1,
            docNotesBrief(s2, { selection: s2.out, fieldRect: s2.field, focused: s2.fieldFocused })
        );

        const s3 = await docNotesAct(
            h,
            `type(fieldInput(), ${docNotesJson(DOC_NOTES_STAYS_NOTE)});
            await settle();
            key(fieldInput(), "Enter");`
        );
        rec(
            "3. a note and Enter: the field closes, the rail lists the note, the passage stays painted, the footer counts it, nothing is sent",
            s3.open &&
                s3.field == null &&
                s3.header === "Your notes · 1" &&
                s3.rows.length === 1 &&
                s3.rows[0].passage === DOC_NOTES_STAYS &&
                s3.rows[0].note === DOC_NOTES_STAYS_NOTE &&
                s3.quoted === 1 &&
                s3.pending === 0 &&
                has(s3, "Approve with 1 note") &&
                has(s3, "Request changes · 1 note") &&
                s3.sent == null,
            docNotesBrief(s3)
        );
        const draft3 = await docNotesAct(
            h,
            `select(${docNotesJson(DOC_NOTES_CUT)});
            await settle();
            type(fieldInput(), ${docNotesJson(DOC_NOTES_CUT_NOTE)});`
        );
        await h.shot("cdp-shots/doc-review-notes-main.png");
        rec(
            "3b. the Main board: one kept note, and the field open with a draft under a second, tinted passage",
            draft3.field != null && draft3.pending === 1 && draft3.quoted === 1 && draft3.rows.length === 1,
            docNotesBrief(draft3)
        );

        const s4 = await docNotesAct(h, `key(fieldInput(), "Escape");`);
        rec(
            "4. Escape in the field drops it and leaves the note and the dialog",
            s4.open && s4.field == null && s4.rows.length === 1 && s4.pending === 0,
            docNotesBrief(s4)
        );

        const s4b = await docNotesAct(
            h,
            `const from = textNode(docRoot(), ${docNotesJson(DOC_NOTES_KEYBOARD)});
            const to = textNode(docRoot(), ${docNotesJson(DOC_NOTES_FENCE)});
            const range = document.createRange();
            range.setStart(from.node, from.at);
            range.setEnd(to.node, to.at + ${DOC_NOTES_FENCE.length});
            selectRange(range);
            await settle();
            key(fieldInput(), "Enter");`
        );
        const removed4b = await docNotesAct(
            h,
            `rowOf(${docNotesJson(DOC_NOTES_FENCE)})?.querySelector('button[aria-label="Remove this note"]')?.click();`
        );
        rec(
            "4b. a passage quoted through a fenced code block is painted, and removing its note unpaints it",
            s4b.rows.length === 2 &&
                s4b.rows[1].passage.endsWith(`keys. alpha ${DOC_NOTES_FENCE}`) &&
                s4b.quoted === 2 &&
                removed4b.rows.length === 1 &&
                removed4b.quoted === 1,
            docNotesBrief(s4b, { afterRemove: removed4b.quoted })
        );

        const s5 = await docNotesAct(
            h,
            `const from = textNode(docRoot(), ${docNotesJson(DOC_NOTES_REWORD)});
            const to = textNode(panel().querySelector("ol"), ${docNotesJson(DOC_NOTES_DECISIONS[0])});
            const range = document.createRange();
            range.setStart(from.node, from.at);
            range.setEnd(to.node, to.at + 7);
            selectRange(range);
            out = { selected: getSelection().toString().length, endsInDoc: docRoot().contains(range.endContainer) };`
        );
        await h.ev("getSelection().removeAllRanges()");
        rec(
            "5. a selection that starts in the document and ends in the decisions opens nothing",
            s5.out.selected > 0 && !s5.out.endsInDoc && s5.field == null && s5.pending === 0,
            docNotesBrief(s5, s5.out)
        );

        const s6 = await docNotesAct(
            h,
            `const scroller = docRoot().parentElement;
            const pane = scroller.getBoundingClientRect();
            scroller.scrollTop += rangeOf(${docNotesJson(DOC_NOTES_LAST)}).getBoundingClientRect().bottom - pane.bottom;
            await settle();
            out = {
                scrolls: scroller.scrollHeight > scroller.clientHeight,
                scrollTop: scroller.scrollTop,
                paneBottom: pane.bottom,
                selection: select(${docNotesJson(DOC_NOTES_LAST)}),
            };`
        );
        await h.shot("cdp-shots/doc-review-notes-flip.png");
        const inside6 =
            s6.field != null &&
            s6.field.top >= s6.panel.top &&
            s6.field.bottom <= s6.panel.bottom &&
            s6.field.left >= s6.panel.left &&
            s6.field.right <= s6.panel.right;
        rec(
            "6. with no room below, the field opens above a selection at the pane's bottom edge, inside the dialog",
            s6.out.scrolls && s6.out.scrollTop > 0 && s6.field != null && s6.field.bottom <= s6.out.selection.top && inside6,
            docNotesBrief(s6, { ...s6.out, fieldRect: s6.field, panelRect: s6.panel })
        );
        const dropped6 = await docNotesAct(h, `key(fieldInput(), "Escape"); docRoot().parentElement.scrollTop = 0;`);

        await docReviewEscape(h);
        const gone7 = await docReviewWait(h, `!${DOC_REVIEW_PANEL}`, 3000);
        const reopened7 = await docNotesOpenByTag(h);
        const s7 = await docNotesAct(h);
        rec(
            "7. Escape hides the dialog; reopened, the note is still listed and its passage painted again",
            dropped6.field == null &&
                gone7 &&
                reopened7 &&
                s7.rows.length === 1 &&
                s7.rows[0].passage === DOC_NOTES_STAYS &&
                s7.rows[0].note === DOC_NOTES_STAYS_NOTE &&
                s7.quoted === 1,
            docNotesBrief(s7, { gone: gone7, reopened: reopened7 })
        );

        const request8 = await docNotesAct(h, `button("Request changes · 1 note")?.click();`);
        const s8 = await docNotesAct(
            h,
            `const send = button("Send 1 note to the lead");
            out = { textarea: panel().querySelector("#doc-review-note")?.value ?? null, enabled: !!send && !send.disabled };
            send?.click();`
        );
        await h.shot("cdp-shots/doc-review-notes-request-sent.png");
        const locked8 = await docNotesAct(
            h,
            `const row = rowOf(${docNotesJson(DOC_NOTES_STAYS)});
            row?.querySelector('button[aria-label="Edit this note"]')?.click();
            row?.querySelector('button[aria-label="Remove this note"]')?.click();
            await settle();
            select(${docNotesJson(DOC_NOTES_CUT)});`
        );
        await h.ev("getSelection().removeAllRanges()");
        rec(
            "8. Request changes with the textarea empty sends the one note: the sent line counts it, the row locks, a selection opens nothing",
            has(request8, "Send 1 note to the lead") &&
                s8.out.textarea === "" &&
                s8.out.enabled &&
                s8.sent === "Sent: Request changes, with 1 note" &&
                locked8.sent === s8.sent &&
                locked8.rows.length === 1 &&
                locked8.rows[0].locked &&
                !locked8.rows[0].remove &&
                !locked8.rows[0].open &&
                locked8.field == null &&
                locked8.pending === 0,
            docNotesBrief(locked8, s8.out)
        );

        // a new askId, so the sent lock is gone; the reload empties the notes too
        const loaded9 = await docNotesReload(h, ctx, DOC_NOTES_DECISIONS_CROWDED);
        const opened9 = loaded9 && (await docNotesOpen(h));
        const fresh9 = await docNotesAct(h);
        const written9 = DOC_NOTES_WRITTEN.map((i) => DOC_NOTES_CROWDED[i]);
        const s9 = await docNotesAct(
            h,
            `out = { added: [] };
            for (const [passage, note] of ${docNotesJson(written9)}) out.added.push(await addNote(passage, note));
            rowOf(${docNotesJson(DOC_NOTES_REWORD)})?.querySelector('button[aria-label="Edit this note"]')?.click();`
        );
        await h.shot("cdp-shots/doc-review-notes-crowded.png");
        const open9 = s9.rows.filter((r) => r.open);
        rec(
            "9. the Crowded board: six notes in document order, one empty, one open, the list capped at 300 and the decisions scrolling above it",
            opened9 &&
                fresh9.items === DOC_NOTES_DECISIONS_CROWDED.length &&
                fresh9.rows.length === 0 &&
                s9.out.added.every(Boolean) &&
                docNotesJson(passages(s9)) === docNotesJson(DOC_NOTES_CROWDED.map(([passage]) => passage)) &&
                s9.rows.at(-1).note === DOC_NOTES_EMPTY &&
                open9.length === 1 &&
                open9[0].passage === DOC_NOTES_REWORD &&
                open9[0].input &&
                open9[0].note === DOC_NOTES_REWORD_NOTE &&
                s9.rows.filter((r) => r.input).length === 1 &&
                s9.list.client <= DOC_NOTES_LIST_CAP &&
                s9.list.scroll > s9.list.client &&
                s9.decisions.scroll > s9.decisions.client &&
                s9.quoted === DOC_NOTES_CROWDED.length &&
                has(s9, "Approve with 6 notes") &&
                has(s9, "Request changes · 6 notes"),
            docNotesBrief(s9, {
                opened: opened9,
                items: fresh9.items,
                startedWith: fresh9.rows.length,
                list: s9.list,
                decisions: s9.decisions,
            })
        );

        const openInput = `panel().querySelector('[data-doc-note-row][data-open="true"] input')`;
        const s10 = await docNotesAct(
            h,
            `type(${openInput}, ${docNotesJson(DOC_NOTES_REWORD_EDIT)});
            await settle();
            key(${openInput}, "Enter");`
        );
        const esc10 = await docNotesAct(
            h,
            `rowOf(${docNotesJson(DOC_NOTES_REWORD)})?.querySelector('button[aria-label="Edit this note"]')?.click();
            await settle();
            out = { reopened: !!${openInput} };
            key(${openInput}, "Escape");`
        );
        const reworded = (s) => s.rows.find((r) => r.passage === DOC_NOTES_REWORD)?.note;
        rec(
            "10. in the open row, Enter keeps the new note and closes the row, Escape closes it; neither sends nor hides the dialog",
            s10.open &&
                !s10.rows.some((r) => r.open) &&
                reworded(s10) === DOC_NOTES_REWORD_EDIT &&
                s10.sent == null &&
                esc10.out.reopened &&
                esc10.open &&
                !esc10.rows.some((r) => r.open) &&
                reworded(esc10) === DOC_NOTES_REWORD_EDIT &&
                esc10.sent == null,
            docNotesBrief(esc10, { afterEnter: s10.rows.map((r) => r.open), reopened: esc10.out.reopened })
        );

        const toggle = `panel().querySelector("[data-doc-notes-toggle]").click();`;
        const collapsed11 = await docNotesAct(h, toggle);
        const expanded11 = await docNotesAct(h, toggle);
        const remove = `panel().querySelector('[data-doc-note-row] button[aria-label="Remove this note"]')`;
        const five11 = await docNotesAct(h, `${remove}.click();`);
        const none11 = await docNotesAct(h, `for (let i = 0; i < 10 && ${remove}; i++) { ${remove}.click(); await settle(); }`);
        const kept = [DOC_NOTES_CROWDED[4], DOC_NOTES_CROWDED[1]];
        const two11 = await docNotesAct(h, `for (const [passage, note] of ${docNotesJson(kept)}) await addNote(passage, note);`);
        rec(
            "11. the header collapses and expands the list; removing a note drops its row and its highlight, removing all drops the section",
            collapsed11.expanded === "false" &&
                collapsed11.rows.length === 0 &&
                collapsed11.header === "Your notes · 6" &&
                expanded11.expanded === "true" &&
                expanded11.rows.length === 6 &&
                five11.rows.length === 5 &&
                five11.quoted === 5 &&
                has(five11, "Approve with 5 notes") &&
                none11.header == null &&
                none11.rows.length === 0 &&
                none11.quoted === 0 &&
                has(none11, "Approve") &&
                has(none11, "Request changes") &&
                docNotesJson(passages(two11)) === docNotesJson([DOC_NOTES_STAYS, DOC_NOTES_CUT]),
            docNotesBrief(two11, {
                collapsed: [collapsed11.expanded, collapsed11.rows.length],
                expanded: [expanded11.expanded, expanded11.rows.length],
                afterOne: [five11.rows.length, five11.quoted, five11.buttons],
                afterAll: [none11.header, none11.quoted, none11.buttons],
            })
        );

        const s12 = await docNotesAct(
            h,
            `button("Request changes · 2 notes")?.click();
            await settle();
            const area = panel().querySelector("#doc-review-note");
            const send = button("Send 2 notes to the lead");
            out = {
                label: panel().querySelector('label[for="doc-review-note"]')?.textContent ?? null,
                placeholder: area?.placeholder ?? null,
                value: area?.value ?? null,
                enabled: !!send && !send.disabled,
            };`
        );
        await h.shot("cdp-shots/doc-review-notes-request.png");
        const cancel12 = await docNotesAct(h, `button("Cancel")?.click();`);
        rec(
            "12. Request changes with notes: the textarea is optional and Send 2 notes is enabled while it is empty; Cancel returns",
            s12.out.label === "Anything beyond your 2 notes?" &&
                s12.out.placeholder === "Optional" &&
                s12.out.value === "" &&
                s12.out.enabled &&
                has(cancel12, "Approve with 2 notes") &&
                has(cancel12, "Request changes · 2 notes") &&
                cancel12.sent == null,
            docNotesBrief(cancel12, s12.out)
        );

        // ctrl+enter while the field holds a draft: the draft joins the notes, then the answer leaves
        const s13 = await docNotesAct(
            h,
            `select(${docNotesJson(DOC_NOTES_ORDER)});
            await settle();
            type(fieldInput(), ${docNotesJson(DOC_NOTES_CROWDED[3][1])});
            await settle();
            out = { focusInField: document.activeElement === fieldInput() };
            key(document.activeElement || document.body, "Enter", { ctrlKey: true });`
        );
        await h.shot("cdp-shots/doc-review-notes-sent.png");
        const locked13 = await docNotesAct(
            h,
            `for (const row of panel().querySelectorAll("[data-doc-note-row]")) {
                row.querySelector('button[aria-label="Edit this note"]')?.click();
                row.querySelector('button[aria-label="Remove this note"]')?.click();
            }
            await settle();
            select(${docNotesJson(DOC_NOTES_REWORD)});`
        );
        await h.ev("getSelection().removeAllRanges()");
        const order13 = docNotesJson([DOC_NOTES_STAYS, DOC_NOTES_ORDER, DOC_NOTES_CUT]);
        rec(
            "13. Ctrl+Enter with a draft in the field adds it and approves: the sent line counts 3 notes, the rows lock, a selection opens nothing",
            s13.out.focusInField &&
                s13.sent === "Sent: Approve, with 3 notes" &&
                s13.field == null &&
                docNotesJson(passages(s13)) === order13 &&
                s13.rows[1].note === DOC_NOTES_CROWDED[3][1] &&
                locked13.sent === s13.sent &&
                docNotesJson(passages(locked13)) === order13 &&
                locked13.rows.every((r) => r.locked && !r.remove && !r.open) &&
                locked13.field == null &&
                locked13.pending === 0,
            docNotesBrief(locked13, s13.out)
        );

        await docReviewEscape(h);
        await docReviewWait(h, `!${DOC_REVIEW_PANEL}`, 3000);
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "doc-review-notes");
    },
};

// A mockup-settled Spec review names the mockup's .dc.html board, not a spec file: the dialog's left pane is the
// canvas (its path and Open canvas), not the board's HTML rendered as markdown, and Open canvas lands on the lead
// in canvas mode. Same roster as doc-review, with the board written under the scenario's own design folder.
const DOC_REVIEW_CANVAS_TOPIC = "fx-doc-review";
const DOC_REVIEW_CANVAS_PANE = `${DOC_REVIEW_PANEL}?.querySelector("[data-doc-review-canvas]")`;

const docReviewCanvas = {
    name: "doc-review-canvas",
    surface: "cockpit",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-doc-review-canvas-"));
        const ctx = { cwd };
        try {
            await arrangeFixtureRun(h, ctx, "doc-review-canvas", DOC_REVIEW_LEAD);
            const project = join(cwd, ".superpowers", "design", DOC_REVIEW_CANVAS_TOPIC, "project");
            mkdirSync(project, { recursive: true });
            ctx.boardPath = join(project, "Main.dc.html");
            writeFileSync(ctx.boardPath, `<!doctype html><h1>${DOC_REVIEW_HEADING}</h1>\n`);
            writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(docReviewRoster(ctx.runId, ctx.boardPath), null, 2));
            // the fixture roster is read once at boot
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("cockpit");
            ctx.rosterLoaded = await docReviewWait(
                h,
                `document.querySelector('[data-cockpit-surface] [data-agent-id="${DOC_REVIEW_WORKER_ID}"]')`,
                15000
            );
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null || !ctx.rosterLoaded) {
            return [{ step: "0. the fixture roster loaded", ok: false, detail: ctx.arrangeError ?? "no worker card" }];
        }

        // through the worker's card, as doc-review does, so the lead's auto-open is not spent before the tag
        await h.ev(`document.querySelector(
            '[data-cockpit-surface] [data-agent-id="${DOC_REVIEW_WORKER_ID}"] button[title="Open terminal (T)"]'
        )?.click()`);
        const tagged = await docReviewWait(
            h,
            `${docReviewTreeRow(DOC_REVIEW_LEAD)}?.querySelector('button[title="${DOC_REVIEW_TAG_TITLE}"]')`
        );
        await h.ev(`${docReviewTreeRow(DOC_REVIEW_LEAD)}?.querySelector('button[title="${DOC_REVIEW_TAG_TITLE}"]')?.click()`);
        const open1 = await docReviewWait(h, DOC_REVIEW_CANVAS_PANE);
        const panel1 = await h.ev(`(() => {
            const p = ${DOC_REVIEW_PANEL};
            if (!p) return null;
            const pane = p.querySelector("[data-doc-review-canvas]");
            return {
                kind: p.querySelector("[data-doc-review]").getAttribute("data-doc-review"),
                canvas: !!pane,
                path: pane?.textContent.includes(${JSON.stringify(ctx.boardPath)}) ?? false,
                open: [...(pane?.querySelectorAll("button") ?? [])].some((b) => b.textContent.trim() === "Open canvas"),
                rendered: !!p.querySelector("h1"),
                items: p.querySelectorAll("ol > li").length,
            };
        })()`);
        await h.shot("cdp-shots/doc-review-canvas-dialog.png");
        rec(
            "1. the review tag opens the dialog with the canvas pane: its path and Open canvas, no rendered board",
            tagged &&
                open1 &&
                panel1?.kind === "spec" &&
                panel1.path &&
                panel1.open &&
                !panel1.rendered &&
                panel1.items === DOC_REVIEW_DECISIONS.length,
            JSON.stringify({ tagged, open: open1, panel: panel1 })
        );

        await h.ev(`[...(${DOC_REVIEW_CANVAS_PANE}?.querySelectorAll("button") ?? [])]
            .find((b) => b.textContent.trim() === "Open canvas")?.click()`);
        const gone2 = await docReviewWait(h, `!${DOC_REVIEW_PANEL}`, 3000);
        const canvas2 = await docReviewWait(
            h,
            `document.querySelector("[data-canvas-pane]")?.textContent.includes(${JSON.stringify(DOC_REVIEW_CANVAS_TOPIC)})`
        );
        const names2 = await docReviewHeaderNames(h);
        await h.shot("cdp-shots/doc-review-canvas-open.png");
        rec(
            "2. Open canvas closes the dialog and shows the canvas on the lead",
            gone2 && canvas2 && names2.lead,
            JSON.stringify({ gone: gone2, canvas: canvas2, header: names2 })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "doc-review-canvas");
    },
};

// The Cockpit on the brief type scale (docs/superpowers/specs/2026-09-29-cockpit-polish-design.md): nothing under
// 10.5px, and the lead card leads with the Workflow icon. Same setup as agent-tree-rail: a fixture roster whose lead
// carries a real orchestrator run held in planning. No dagsubmit (see TREE_RAIL_FIXTURE), so the card has no plan
// and no bar; the bar is covered by leadcardmodel.test.ts.
const COCKPIT_POLISH_LEAD = "cockpit-polish lead";
const COCKPIT = `document.querySelector("[data-cockpit-surface]")`;
const COCKPIT_LEAD_CARD = `${COCKPIT}?.querySelector('[data-agent-id="${TREE_RAIL_LEAD_ID}"]')`;

// the first thing the lead card's header draws: an svg, or the element holding the first text
const LEAD_MARK_EXPR = `(() => {
    const header = ${COCKPIT_LEAD_CARD}?.firstElementChild;
    if (!header) return null;
    const walk = (el) => {
        for (const c of el.children) {
            if (c.tagName.toLowerCase() === "svg") return "svg";
            const text = [...c.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.data.trim());
            if (text) return "text:" + text.data.trim().slice(0, 20);
            const found = walk(c);
            if (found) return found;
        }
        return null;
    };
    return walk(header);
})()`;

const cockpitPolish = {
    name: "cockpit-polish",
    surface: "cockpit",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-cockpit-polish-"));
        const ctx = { cwd };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await arrangeFixtureRun(h, ctx, "cockpit-polish", COCKPIT_POLISH_LEAD);
            // the fixture roster is read once at boot
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("cockpit");
            // the fixture lead first renders as a plain agent card; it becomes the lead card once its run loads
            ctx.leadCard = await h.ev(`(async () => {
                for (let i = 0; i < 60; i++) {
                    const card = ${COCKPIT_LEAD_CARD};
                    if (card && (${LEAD_MARK_EXPR} === "svg" || card.textContent.includes("no plan submitted"))) {
                        return true;
                    }
                    await new Promise((r) => setTimeout(r, 250));
                }
                return false;
            })()`);
            // let the card's enter motion settle
            await new Promise((r) => setTimeout(r, 800));
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec(
            "0. the fixture lead renders as its run's lead card on the Cockpit",
            ctx.arrangeError == null && ctx.leadCard === true,
            ctx.arrangeError ?? `runId=${ctx.runId}`
        );

        const small = await h.ev(`(() => {
            const root = ${COCKPIT};
            if (!root) return null;
            const min = ${MIN_FONT_PX};
            const offenders = [];
            let seen = 0;
            const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                const text = n.data.trim();
                if (!text) continue;
                const range = document.createRange();
                range.selectNodeContents(n);
                const r = range.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                const cs = getComputedStyle(n.parentElement);
                if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
                seen++;
                const px = parseFloat(cs.fontSize);
                if (px < min) offenders.push(text.slice(0, 40) + " @" + cs.fontSize);
            }
            return { seen, offenders };
        })()`);
        rec(
            "1. no visible text on the Cockpit is under 10.5px",
            small != null && small.seen > 0 && small.offenders.length === 0,
            small == null
                ? "no [data-cockpit-surface]"
                : `checked ${small.seen} text nodes; offenders=${JSON.stringify(small.offenders)}`
        );

        const mark = await h.ev(LEAD_MARK_EXPR);
        rec("2. the lead card's header leads with an svg (the Workflow icon)", mark === "svg", `mark=${mark}`);
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "cockpit-polish");
    },
};

// The lead card's merge gate (effort 4d24005d): a finished lane tip the engine has not landed reads live, toned wait,
// with how long it has waited, opens its ended worker, and stays out of the cancel count. The run lands in the
// checkout of a temp repository whose index holds a staged file, so the engine holds every merge and the tip stays
// ready. Both tasks point at deferred quick runs that never start; marking t-1's run done lets the engine move the
// task to done itself, which writes the task-done event the gate's age is read from. t-2 stays running.
const MERGE_GATE_LEAD = "merge-gate lead";
const MERGE_GATE_LABEL = "merge gate lane";
const MERGE_GATE_LIVE_LABEL = "running lane";
const MERGE_GATE_TASKS = [
    ["t-1", MERGE_GATE_LABEL],
    ["t-2", MERGE_GATE_LIVE_LABEL],
].map(([id, label]) => ({ id, label, description: "do nothing, stop immediately", deps: [], gate: false, state: "" }));
// the engine ticks a dag at most every 30 seconds, and the card then waits on the run's digest
const MERGE_GATE_WAIT_MS = 90_000;
const mergeGateRow = (label) =>
    `[...(${COCKPIT_LEAD_CARD}?.querySelectorAll("[data-row-key]") ?? [])]` +
    `.find((r) => r.textContent.includes(${JSON.stringify(label)}))`;
// the row's dot, tag and the card's cancel panel text, as the assertions read them
const MERGE_GATE_READ = `(() => {
    const row = ${mergeGateRow(MERGE_GATE_LABEL)};
    const grid = row?.firstElementChild;
    return {
        row: row != null,
        dot: grid?.children[0]?.className ?? null,
        tag: grid?.children[2]?.textContent.trim() ?? null,
        live: ${mergeGateRow(MERGE_GATE_LIVE_LABEL)} != null,
    };
})()`;

// a deferred quick run in the fixture's channel: a task's child run that never starts a session
async function mergeGateStandIn(h, ctx, taskId) {
    const wslist = await h.rpc("workspacelist", null);
    const created = await h.rpc("createrun", {
        channelid: ctx.channelId,
        workspaceid: wslist[0].workspacedata.oid,
        goal: `verify merge-gate: stand-in child run of ${taskId}`,
        runtime: "claude",
        mode: "quick",
        deferstart: true,
    });
    return created.run.id;
}

const leadCardMergeGate = {
    name: "lead-card-merge-gate",
    surface: "cockpit",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-merge-gate-"));
        const ctx = { cwd };
        try {
            fstGitInit(cwd);
            // a staged file: the engine will not squash a lane over it, so it holds the merge
            writeFileSync(join(cwd, "held.txt"), "staged by the merge-gate fixture\n");
            execFileSync("git", ["add", "held.txt"], { cwd, stdio: "pipe" });
            await arrangeFixtureRun(h, ctx, "merge-gate", MERGE_GATE_LEAD, undefined, { landing: "checkout" });
            ctx.gateRun = await mergeGateStandIn(h, ctx, "t-1");
            ctx.liveRun = await mergeGateStandIn(h, ctx, "t-2");
            await h.rpc("dagsubmit", {
                channelid: ctx.channelId,
                runid: ctx.runId,
                title: "verify merge-gate",
                parallelism: 1,
                tasks: MERGE_GATE_TASKS,
            });
            ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.oid;
            // over whatever the engine dispatched first: teardown deletes a real worker's block with the channel's
            const runOf = { "t-1": ctx.gateRun, "t-2": ctx.liveRun };
            await seedDag(
                h,
                ctx,
                (dag) => ({
                    ...dag,
                    mergerequired: true,
                    tasks: dag.tasks.map((t) => ({ ...t, state: "running", runid: runOf[t.id] })),
                }),
                (dag) => JSON.stringify([dag?.mergerequired, (dag?.tasks ?? []).map((t) => [t.id, t.state, t.runid])])
            );
            await fstWriteRun(h, ctx.gateRun, (r) => ({ ...r, status: "done", completedts: Date.now() }));
            // the merge gate needs t-1 done by the engine (its task-done event) and the merge held
            const start = Date.now();
            while (Date.now() - start < MERGE_GATE_WAIT_MS) {
                const group = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
                ctx.gateState = group?.tasks?.find((t) => t.id === "t-1")?.state;
                if (ctx.gateState === "done") break;
                await new Promise((r) => setTimeout(r, 1000));
            }
            ctx.doneMs = Date.now() - start;
            // the fixture roster is read once at boot
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("cockpit");
            ctx.shown = await h.ev(`(async () => {
                for (let i = 0; i < ${MERGE_GATE_WAIT_MS / 500}; i++) {
                    const r = ${MERGE_GATE_READ};
                    if (r.row && /^merge waiting \\d/.test(r.tag ?? "")) return r;
                    await new Promise((res) => setTimeout(res, 500));
                }
                return ${MERGE_GATE_READ};
            })()`);
            // let the card's enter motion settle
            await new Promise((r) => setTimeout(r, 800));
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const shown = ctx.shown ?? {};
        rec(
            "0. the engine finishes t-1 and the lead card draws its row",
            ctx.arrangeError == null && ctx.gateState === "done" && shown.row === true,
            ctx.arrangeError ?? `t-1 ${ctx.gateState} after ${ctx.doneMs}ms; ${JSON.stringify(shown)}`
        );
        await h.shot("cdp-shots/lead-card-merge-gate.png");
        rec(
            "1. the merge-ready row is tagged with the gate's age",
            /^merge waiting \d+(s|m|h\d+m)$/.test(shown.tag ?? ""),
            `tag=${JSON.stringify(shown.tag)}`
        );
        rec(
            "2. its dot is the hollow wait dot, not the pulsing run dot",
            (shown.dot ?? "").includes("--color-muted") && !(shown.dot ?? "").includes("pulse-dot"),
            `dot=${shown.dot}`
        );

        // the cancel panel counts the running row and leaves the gate out
        const cancel = await h.ev(`(async () => {
            const card = ${COCKPIT_LEAD_CARD};
            const btn = card && [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel run");
            if (!btn) return { error: "no Cancel run button on the card" };
            btn.click();
            await new Promise((r) => setTimeout(r, 400));
            const text = [...card.querySelectorAll("span")].map((s) => s.textContent).find((t) => t.startsWith("Stop "));
            return { text: text ?? null };
        })()`);
        await h.shot("cdp-shots/lead-card-merge-gate-cancel.png");
        rec(
            "3. the cancel panel counts only the running task",
            shown.live === true && /^Stop 1 running tasks/.test(cancel.text ?? ""),
            JSON.stringify({ live: shown.live, ...cancel })
        );
        await h.ev(`(() => {
            const card = ${COCKPIT_LEAD_CARD};
            [...(card?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "Keep running")?.click();
        })()`);

        // focusing the row offers Open, which lands on the ended worker's transcript on the Agent surface
        const opened = await h.ev(`(async () => {
            const row = ${mergeGateRow(MERGE_GATE_LABEL)};
            if (!row) return { error: "no merge-ready row" };
            row.click();
            await new Promise((r) => setTimeout(r, 400));
            const sub = row.querySelector(":scope > div:nth-child(2) > div")?.textContent.trim() ?? null;
            const open = [...row.querySelectorAll("button")].find((b) => b.textContent.includes("Open"));
            if (!open) return { sub, error: "no Open button on the focused row" };
            open.click();
            await new Promise((r) => setTimeout(r, 1200));
            return { sub };
        })()`);
        const surface = await h.activeSurfaceLabel();
        const header = await h.ev(`document.body.innerText.includes(${JSON.stringify(MERGE_GATE_LABEL)})`);
        await h.shot("cdp-shots/lead-card-merge-gate-open.png");
        rec(
            "4. Open on the merge-ready row shows its ended worker on the Agent surface",
            opened.error == null &&
                /merge ready$/.test(opened.sub ?? "") &&
                surface === SURFACE_LABEL.agent &&
                header === true,
            JSON.stringify({ ...opened, surface, header })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "lead-card-merge-gate");
    },
};

// The Jarvis run sheet on the brief type scale (docs/superpowers/specs/2026-09-29-run-sheet-polish-design.md):
// nothing under 10.5px in the sheet body or its header, the shared task strip under the verb, and the compact
// lifecycle timeline. The run is a real orchestrator run held by deferstart, then given a chained three-task plan,
// so only t-1 dispatches a worker; teardown cancels the run, which cancels its DAG and that worker.
const RUN_SHEET_POLISH_TASKS = [
    { id: "t-1", label: "noop", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
    { id: "t-2", label: "noop 2", description: "do nothing, stop immediately", deps: ["t-1"], gate: false, state: "" },
    { id: "t-3", label: "noop 3", description: "do nothing, stop immediately", deps: ["t-2"], gate: false, state: "" },
];

// A deferred orchestrator run in a temp dir, given a plan, with its sheet opened on the Brief. A throw lands in
// ctx.arrangeError and still returns ctx, so teardown removes whatever was already made.
async function arrangeSheetDagRun(h, label, tasks) {
    const cwd = mkdtempSync(join(tmpdir(), `verify-${label}-`));
    const ctx = { cwd };
    try {
        const wslist = await h.rpc("workspacelist", null);
        const ch = await h.rpc("createchannel", { name: `verify-${label}`, projectpath: cwd });
        ctx.channelId = ch.oid;
        const created = await h.rpc("createrun", {
            channelid: ctx.channelId,
            workspaceid: wslist[0].workspacedata.oid,
            goal: `verify ${label}: do nothing, make no file changes, stop immediately`,
            runtime: "claude",
            mode: "orchestrator",
            deferstart: true,
        });
        ctx.runId = created.run.id;
        await h.rpc("dagsubmit", {
            channelid: ctx.channelId,
            runid: ctx.runId,
            title: `verify ${label}`,
            parallelism: 1,
            tasks,
        });
        // the Brief reads a boot-primed snapshot, so the RPC-created channel needs a reload
        await h.ev("location.reload()");
        await h.ev(`(async () => {
            for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                await new Promise((r) => setTimeout(r, 500));
            }
        })()`);
        await h.goto("jarvis");
        ctx.opened = await h.ev(`(async () => {
            for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            if (typeof window.__openAddress !== "function") return { ok: false, why: "no __openAddress hook" };
            return window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)});
        })()`);
    } catch (e) {
        ctx.arrangeError = String(e?.message ?? e);
    }
    return ctx;
}

const runSheetPolish = {
    name: "run-sheet-polish",
    surface: "jarvis",
    async arrange(h) {
        const ctx = await arrangeSheetDagRun(h, "run-sheet-polish", RUN_SHEET_POLISH_TASKS);
        if (ctx.arrangeError != null) return ctx;
        try {
            ctx.timelineOpened = await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector('[data-run-sheet] [role="img"]'); i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                for (let i = 0; i < 40; i++) {
                    const toggle = [...document.querySelectorAll("[data-run-sheet] button[aria-expanded]")].find((b) =>
                        (b.textContent || "").trim().startsWith("timeline")
                    );
                    if (toggle) {
                        if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
                        return true;
                    }
                    await new Promise((r) => setTimeout(r, 250));
                }
                return false;
            })()`);
            await new Promise((r) => setTimeout(r, 600));
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec(
            "0. the run's sheet opened on the Brief",
            ctx.arrangeError == null && ctx.opened?.ok === true,
            ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, opened: ctx.opened })
        );

        const small = await h.ev(`(() => {
            const roots = [
                document.querySelector("[data-run-sheet]"),
                document.querySelector("[data-jarvis-brief-sheet] > header"),
            ];
            if (roots.some((r) => r == null)) return null;
            const min = ${MIN_FONT_PX};
            const offenders = [];
            let seen = 0;
            for (const root of roots) {
                const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                    const text = n.data.trim();
                    if (!text) continue;
                    const range = document.createRange();
                    range.selectNodeContents(n);
                    const r = range.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    const cs = getComputedStyle(n.parentElement);
                    if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
                    seen++;
                    const px = parseFloat(cs.fontSize);
                    if (px < min) offenders.push(text.slice(0, 40) + " @" + cs.fontSize);
                }
            }
            return { seen, offenders };
        })()`);
        rec(
            "1. no visible text on the run sheet or its header is under 10.5px",
            small != null && small.seen > 0 && small.offenders.length === 0,
            small == null
                ? "no [data-run-sheet] or [data-jarvis-brief-sheet] > header"
                : `checked ${small.seen} text nodes; offenders=${JSON.stringify(small.offenders)}`
        );

        const bar = await h.ev(`document.querySelector("[data-run-sheet] [role=img]")?.getAttribute("aria-label") ?? null`);
        rec(
            "2. the task strip under the verb carries its done/total label",
            typeof bar === "string" && /^\d+ of \d+ tasks done/.test(bar),
            `aria-label=${JSON.stringify(bar)}`
        );

        const timeline = await h.ev(`!!document.querySelector("[data-run-sheet-timeline]")`);
        rec(
            "3. the compact timeline opened from the tasks heading",
            timeline === true,
            JSON.stringify({ toggled: ctx.timelineOpened, timeline })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "run-sheet-polish");
    },
};

// The run sheet's Timing section (docs/superpowers/plans/2026-10-01-run-timing.md) on a live orchestrator run:
// collapsed with an elapsed header, then expanded to the per-activity bars. Planning is the one activity a
// freshly submitted plan always has; the live overlap sentence depends on dispatch timing, so only the
// always-present note is asserted.
const RUN_TIMING_SECTION = `document.querySelector("[data-run-sheet] [data-run-timing]")`;
const RUN_TIMING_NOTE = "Elapsed since launch. Activities overlap; do not add these rows.";

const runTimingScenario = {
    name: "run-timing",
    surface: "jarvis",
    async arrange(h) {
        const ctx = await arrangeSheetDagRun(h, "run-timing", RUN_SHEET_POLISH_TASKS);
        if (ctx.arrangeError != null) return ctx;
        try {
            ctx.sectionShown = await h.ev(`(async () => {
                for (let i = 0; i < 60 && !${RUN_TIMING_SECTION}?.querySelector("button[aria-expanded]"); i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                return !!${RUN_TIMING_SECTION};
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec(
            "0. the run's sheet opened on the Brief with a Timing section",
            ctx.arrangeError == null && ctx.opened?.ok === true && ctx.sectionShown === true,
            ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, opened: ctx.opened, section: ctx.sectionShown })
        );

        const collapsed = await h.ev(`(() => {
            const btn = ${RUN_TIMING_SECTION}?.querySelector("button[aria-expanded]");
            if (!btn) return null;
            const spans = btn.querySelectorAll("span");
            return {
                expanded: btn.getAttribute("aria-expanded"),
                label: spans[0]?.textContent.trim() ?? null,
                header: spans[spans.length - 1]?.textContent.trim() ?? null,
            };
        })()`);
        rec(
            "1. the live run's Timing toggle is collapsed with an elapsed header",
            collapsed?.expanded === "false" && collapsed.label === "Timing" && /elapsed$/.test(collapsed.header ?? ""),
            JSON.stringify(collapsed)
        );

        const expanded = await h.ev(`(async () => {
            const section = ${RUN_TIMING_SECTION};
            const btn = section?.querySelector("button[aria-expanded]");
            if (!btn) return null;
            btn.click();
            for (let i = 0; i < 20 && !section.querySelector('[data-run-timing-row="planning"]'); i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            const row = section.querySelector('[data-run-timing-row="planning"]');
            const bar = row?.querySelector(":scope > div > span");
            const cells = row ? row.querySelectorAll(":scope > span") : [];
            section.scrollIntoView({ block: "start" });
            return {
                expanded: btn.getAttribute("aria-expanded"),
                rows: [...section.querySelectorAll("[data-run-timing-row]")].map((r) => r.getAttribute("data-run-timing-row")),
                barWidth: bar ? bar.getBoundingClientRect().width : null,
                duration: cells.length > 0 ? cells[cells.length - 1].textContent.trim() : null,
                note: (section.innerText || "").includes(${JSON.stringify(RUN_TIMING_NOTE)}),
            };
        })()`);
        rec(
            "2. a click expands it: aria-expanded flips to true",
            expanded?.expanded === "true",
            JSON.stringify({ expanded: expanded?.expanded })
        );
        rec(
            "3. a planning row draws a bar of nonzero width and a duration",
            expanded != null && expanded.rows.includes("planning") && expanded.barWidth > 0 && !!expanded.duration,
            JSON.stringify(expanded)
        );
        rec("4. the always-present overlap note shows", expanded?.note === true, JSON.stringify({ note: expanded?.note }));
        await new Promise((r) => setTimeout(r, 300));
        await h.shot("cdp-shots/run-timing-expanded.png");
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "run-timing");
    },
};

// A finished orchestrator run's dock carries its configuration forward: a Ran with row over the dock's buttons
// whose Use for new runs writes the project's Profile override, then links to that Profile. The run is cancelled
// first, which stops its dag and the t-1 worker, then stored as done so the sheet draws the finished dock. Its dir
// is registered as a project, as a real run's is, or the Profile the confirmation opens has no project to show.
const RUN_CARRY_PROJECT = "verify-run-sheet-carry";
const RUN_CARRY_ROW = `document.querySelector("[data-run-sheet] [data-run-sheet-carry]")`;

const runSheetCarryScenario = {
    name: "run-sheet-carry",
    surface: "jarvis",
    async arrange(h) {
        const ctx = await arrangeSheetDagRun(h, "run-sheet-carry", RUN_SHEET_POLISH_TASKS);
        if (ctx.arrangeError != null) return ctx;
        try {
            await h.rpc("cancelrun", { channelid: ctx.channelId, runid: ctx.runId });
            await h.rpc("createproject", { name: RUN_CARRY_PROJECT, path: ctx.cwd });
            ctx.projectMade = true;
            await waitForProjectInConfig(h, RUN_CARRY_PROJECT);
            const oref = `run:${ctx.runId}`;
            const stored = await waveService(h, "object", "GetObject", [oref]);
            await waveService(
                h,
                "object",
                "UpdateObject",
                [{ ...stored, otype: "run", status: "done" }, false],
                FINAL_SHOTS_UICTX
            );
            // the Brief reads a boot-primed snapshot, so the done status and the project need a reload and a reopen
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("jarvis");
            ctx.opened = await h.ev(`(async () => {
                for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                return window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)});
            })()`);
            ctx.rowShown = await h.ev(`(async () => {
                for (let i = 0; i < 60 && !${RUN_CARRY_ROW}; i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                return !!${RUN_CARRY_ROW};
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec(
            "0. the finished run's sheet shows the Ran with row in its dock",
            ctx.arrangeError == null && ctx.opened?.ok === true && ctx.rowShown === true,
            ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, opened: ctx.opened, row: ctx.rowShown })
        );
        if (ctx.arrangeError != null || ctx.rowShown !== true) return steps;

        const read = () =>
            h.ev(`(() => {
                const row = ${RUN_CARRY_ROW};
                const btn = row?.querySelector("button");
                const dock = row?.parentElement;
                return {
                    text: row?.innerText ?? "",
                    button: btn?.textContent.trim() ?? null,
                    title: btn?.getAttribute("title") ?? null,
                    dockButtons: [
                        ...(dock?.querySelectorAll(":scope > div:not([data-run-sheet-carry]) button") ?? []),
                    ].map((b) => b.textContent.trim()),
                };
            })()`);
        const before = await read();
        rec(
            "1. the row names the run's settings and offers Use for new runs, pointing at the Profile",
            before.text.includes("Ran with") &&
                before.text.includes("orchestrator") &&
                before.text.includes("parallelism 1") &&
                before.button === "Use for new runs" &&
                (before.title ?? "").includes("Profile"),
            JSON.stringify(before)
        );
        rec(
            "2. the dock's button row no longer carries the save",
            before.dockButtons.includes("Open DAG") && !before.dockButtons.some((t) => /project defaults|new runs/i.test(t)),
            JSON.stringify(before.dockButtons)
        );
        await h.shot("cdp-shots/run-sheet-carry-1-idle.png");

        await h.ev(`${RUN_CARRY_ROW}.querySelector("button").click()`);
        const saved = await h.ev(`(async () => {
            for (let i = 0; i < 40; i++) {
                const t = ${RUN_CARRY_ROW}?.querySelector("button")?.textContent.trim();
                if (t === "Saved to this project's Profile") return t;
                await new Promise((r) => setTimeout(r, 250));
            }
            return ${RUN_CARRY_ROW}?.innerText ?? null;
        })()`);
        const profile = await h.rpc("getjarvisprofile", { channelid: ctx.channelId });
        const o = profile?.override ?? {};
        rec(
            "3. a click saves: the row confirms and the project's override holds the run's shape and parallelism",
            saved === "Saved to this project's Profile" && o.defaultmode === "orchestrator" && o.parallelism === 1,
            JSON.stringify({ saved, override: o })
        );
        await h.shot("cdp-shots/run-sheet-carry-2-saved.png");

        await h.ev(`${RUN_CARRY_ROW}.querySelector("button").click()`);
        const modal = await h.ev(`(async () => {
            for (let i = 0; i < 20; i++) {
                const m = document.querySelector('[data-jarvis-brief-modal="profile"]');
                if (m) return { scope: m.getAttribute("data-jarvis-profile-scope") };
                await new Promise((r) => setTimeout(r, 250));
            }
            return null;
        })()`);
        rec("4. the confirmation opens this project's Profile", modal?.scope === "project", JSON.stringify(modal));
        await h.shot("cdp-shots/run-sheet-carry-3-profile.png");
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(
            h,
            ctx,
            "run-sheet-carry",
            ctx.projectMade
                ? { what: "remove the project", fn: () => h.rpc("deleteproject", { name: RUN_CARRY_PROJECT }) }
                : undefined
        );
    },
};

// --- run-cost: the API-equivalent estimate of a run's tokens on the run surfaces ------------------------
// The run sheet, the DAG header, the run peek and the details rail's Task section each price the same usage rows
// (docs/superpowers/specs/2026-10-08-usage-attribution-design.md). The rows are seeded as the run's sealed
// evidence, which RunUsageCommand returns as it stands. A deferred run has no lead, so the rail is reached
// through t-1's dispatched worker.
const RUN_COST_TASK = "t-1";
// At the bundled prices (usagepricing.ts) opus-5-5 is $4 in, $20 out, $0.20 cache read and $5 cache write per
// million tokens; sonnet-5 is $2, $10, $0.20 and $2.50. The lead row prices to $3.10, the worker's to $1.20 and
// the reviewer's to $0.50.
const RUN_COST_USAGE = [
    { role: "lead", model: "claude-opus-5-5", input: 200_000, output: 50_000, cacheread: 4_000_000, cachewrite: 100_000, cachewrite1h: 0, msgs: 40 },
    { role: "worker", taskid: RUN_COST_TASK, model: "claude-sonnet-5-5", input: 100_000, output: 40_000, cacheread: 2_000_000, cachewrite: 80_000, cachewrite1h: 0, msgs: 30 },
    { role: "reviewer", taskid: RUN_COST_TASK, model: "claude-opus-5-5", input: 50_000, output: 10_000, cacheread: 500_000, cachewrite: 0, cachewrite1h: 0, msgs: 8 },
];
const RUN_COST_RUN_USD = "$4.80";
const RUN_COST_TASK_USD = "$1.70";
const RUN_COST_SPEND = new RegExp(`^[\\d.]+[kM]? tok · ≈ \\${RUN_COST_RUN_USD}$`);
const RUN_COST_WAIT_MS = 20_000;
const RUN_COST_RAIL = `document.querySelector('aside[aria-label="Agent details"]')`;
const RUN_COST_LIB = `
    const text = (el) => (el?.textContent || "").replace(/\\s+/g, " ").trim();
    const until = async (ok, ms = ${RUN_COST_WAIT_MS}) => {
        for (let waited = 0; waited < ms && !ok(); waited += 250) {
            await new Promise((r) => setTimeout(r, 250));
        }
        return !!ok();
    };
`;

// Writes the rows as the run's evidence and reads them back, again if a write of the engine's landed over them:
// it writes a live run, and one that read the run before this write puts its own copy back.
async function seedRunUsage(h, ctx, usage) {
    const oref = `run:${ctx.runId}`;
    const kept = (run) => JSON.stringify(run?.evidence?.usage ?? null) === JSON.stringify(usage);
    let stored = await waveService(h, "object", "GetObject", [oref]);
    for (let i = 0; i < 3 && !kept(stored); i++) {
        const evidence = { capturedts: Date.now(), hash: "", addtotal: 0, deltotal: 0, runtimems: 0, durationms: 0, usage };
        await waveService(h, "object", "UpdateObject", [{ ...stored, otype: "run", evidence }, false], FINAL_SHOTS_UICTX);
        stored = await waveService(h, "object", "GetObject", [oref]);
    }
    if (!kept(stored)) {
        throw new Error(`the run did not keep its seeded usage: stored ${JSON.stringify(stored?.evidence?.usage ?? null)}`);
    }
}

const runCost = {
    name: "run-cost",
    surface: "jarvis",
    async arrange(h) {
        await h.cdp("Emulation.setDeviceMetricsOverride", OBS_WIDE);
        const prevRail = await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`);
        const ctx = await arrangeSheetDagRun(h, "run-cost", RUN_SHEET_POLISH_TASKS);
        ctx.prevRail = prevRail;
        if (ctx.arrangeError != null) return ctx;
        try {
            // the dispatching tick holds the run for as long as the spawn takes and would land over a seed made under it
            await waitForDispatch(h, ctx, RUN_COST_TASK);
            if (!ctx.dispatched) throw new Error(`${RUN_COST_TASK} did not dispatch in ${ctx.dispatchMs}ms`);
            const group = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
            ctx.workerRunId = group?.tasks?.find((t) => t.id === RUN_COST_TASK)?.runid;
            await seedRunUsage(h, ctx, RUN_COST_USAGE);
            // a write the worker's first events started can outlast the seed's own read-back
            await new Promise((r) => setTimeout(r, ATTN_TICK_SETTLE_MS));
            await seedRunUsage(h, ctx, RUN_COST_USAGE);
            // the rail is off by default and persisted; and a run's usage loads when a surface showing it mounts,
            // then once a minute, so the page is reloaded and the run reopened to read the seed
            await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("jarvis");
            ctx.opened = await h.ev(`(async () => {
                for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                if (typeof window.__openAddress !== "function") return { ok: false, why: "no __openAddress hook" };
                return window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)});
            })()`);
            ctx.usageShown = await h.ev(`(async () => {
                ${RUN_COST_LIB}
                return until(() => text(document.querySelector("[data-run-sheet] [data-run-sheet-usage]")).includes("≈"));
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec(
            "0. the run's sheet opened, t-1 dispatched, and the sheet shows the seeded usage",
            ctx.arrangeError == null && ctx.opened?.ok === true && ctx.dispatched === true && ctx.usageShown === true,
            ctx.arrangeError ??
                JSON.stringify({ runId: ctx.runId, worker: ctx.workerRunId, opened: ctx.opened, dispatchMs: ctx.dispatchMs, usageShown: ctx.usageShown })
        );
        if (ctx.arrangeError != null) return steps;

        const sheet = await h.ev(`(() => {
            ${RUN_COST_LIB}
            return text(document.querySelector("[data-run-sheet] [data-run-sheet-usage]"));
        })()`);
        rec(
            `1. the run sheet's meta reads "<n> tok · ≈ ${RUN_COST_RUN_USD}", every seeded row priced`,
            RUN_COST_SPEND.test(sheet),
            JSON.stringify(sheet)
        );
        await h.shot("cdp-shots/run-cost-sheet.png");

        const header = await h.ev(`(async () => {
            ${RUN_COST_LIB}
            const open = [...(document.querySelector("[data-run-sheet]")?.querySelectorAll("button") ?? [])].find(
                (b) => text(b) === "Open DAG"
            );
            if (!open) return { opened: false };
            open.click();
            const line = () =>
                [...(document.querySelector("[data-dag-modal-kind]")?.querySelectorAll("div") ?? [])].find(
                    (d) => d.children.length === 0 && text(d).startsWith("parallelism")
                );
            const shown = await until(() => text(line()).includes("≈"));
            return { opened: !!document.querySelector("[data-dag-modal-kind]"), shown, line: text(line()) };
        })()`);
        rec(
            `2. the DAG header's usage text ends "· ≈ ${RUN_COST_RUN_USD}"`,
            header.opened === true && (header.line ?? "").endsWith(`· ≈ ${RUN_COST_RUN_USD}`),
            JSON.stringify(header)
        );
        await h.shot("cdp-shots/run-cost-dag-header.png");
        const modalClosed = await h.ev(`(async () => {
            ${RUN_COST_LIB}
            const close = [...(document.querySelector("[data-dag-modal-kind]")?.querySelectorAll("button") ?? [])].find(
                (b) => text(b).startsWith("Close")
            );
            close?.click();
            return until(() => !document.querySelector("[data-dag-modal-kind]"), 5000);
        })()`);

        const peek = await h.ev(`(async () => {
            ${RUN_COST_LIB}
            if (!(await until(() => typeof window.__peekAddress === "function", 5000))) return { hook: false };
            const result = await window.__peekAddress(${JSON.stringify(`run:${ctx.runId}`)});
            const body = () =>
                document.querySelector('[data-pet-peek-item="run"][data-pet-peek-status="ready"] [data-pet-peek-body]');
            const meta = () => [...(body()?.querySelectorAll("span") ?? [])].map(text).find((t) => / tok · ≈ /.test(t));
            const shown = await until(() => meta() != null);
            return { hook: true, result, shown, meta: meta() ?? null };
        })()`);
        rec(
            `3. the run peek's meta holds "tok · ≈ ${RUN_COST_RUN_USD}"`,
            modalClosed === true && peek.hook === true && RUN_COST_SPEND.test(peek.meta ?? ""),
            JSON.stringify({ modalClosed, ...peek })
        );
        await h.shot("cdp-shots/run-cost-peek.png");
        const peekClosed = await h.ev(`(async () => {
            ${RUN_COST_LIB}
            document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click();
            return until(() => !document.querySelector("[data-pet-peek]"), 5000);
        })()`);

        await h.goto("agent");
        // the task's row is titled by its label; the rail is the worker's once its Task section prices the task
        const taskLabel = RUN_SHEET_POLISH_TASKS.find((t) => t.id === RUN_COST_TASK).label;
        const rail = await h.ev(`(async () => {
            ${RUN_COST_LIB}
            const rail = () => ${RUN_COST_RAIL};
            const cost = () => text(rail()?.querySelector("[data-run-cost]"));
            const rows = () =>
                [...(document.querySelector("[data-agent-tree]")?.querySelectorAll("div") ?? [])]
                    .filter((d) => d.children.length === 0 && text(d) === ${JSON.stringify(taskLabel)})
                    .map((d) => d.closest(".cursor-pointer"))
                    .filter((row) => row != null && text(row).includes(${JSON.stringify(RUN_COST_TASK)}));
            if (!(await until(() => rows().length > 0))) return { rows: 0 };
            // another run's ${RUN_COST_TASK} would carry the same label, so a row counts once its rail prices this task
            let selected = false;
            for (const row of rows()) {
                row.click();
                selected = await until(() => cost().includes(${JSON.stringify(RUN_COST_TASK_USD)}), 5000);
                if (selected) break;
            }
            const fact = (label) => {
                const name = [...(rail()?.querySelectorAll("span") ?? [])].find(
                    (s) => s.children.length === 0 && text(s) === label
                );
                return name ? text(name.nextElementSibling) : null;
            };
            return {
                rows: rows().length,
                selected,
                headings: [...(rail()?.querySelectorAll("h3") ?? [])].map(text),
                tokens: fact("Tokens"),
                cost: cost(),
            };
        })()`);
        rec(
            `4. the worker's Task section has a Tokens row with no estimate and a Cost row of ≈ ${RUN_COST_TASK_USD} API-equiv`,
            peekClosed === true &&
                rail.selected === true &&
                rail.headings.includes("Task") &&
                / tok · \d+% cached/.test(rail.tokens ?? "") &&
                !(rail.tokens ?? "").includes("≈") &&
                rail.cost === `≈ ${RUN_COST_TASK_USD} API-equiv`,
            JSON.stringify({ peekClosed, ...rail })
        );
        await h.shot("cdp-shots/run-cost-rail.png");
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "run-cost", {
            what: "restore the rail's visibility",
            fn: () => h.ev(restoreLocalStorage(RAIL_VISIBLE_KEY, ctx.prevRail)),
        });
    },
};

// --- record-band-detach-restore: correcting a run's record from the run sheet, and undoing it ----------
// The band's EdgeControls on a run with one attributed record: Not this record moves the edge to the Detached
// group, Restore brings it back. The edge is accepted in the arrange, so it is confirmed and the detach asks
// first. The ambient re-read behind every band update is slow (it sweeps every record), so each wait polls for
// 25s, under the 30s cap on one evaluate.
const RECORD_BAND_GOAL = "verify record-band: an attributed run, do nothing";
// the record CreateRun captures for that goal, as BRIEF_PEEK_RECORD
const RECORD_BAND_RECORD = "verify-record-band-an-attributed-run-do-nothing";
const RECORD_BAND = `document.querySelector("[data-jarvis-record-band]")`;
const RECORD_BAND_POLLS = 100;
const RECORD_BAND_LIB = `
    const bandButton = (label) =>
        [...(${RECORD_BAND}?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").trim() === label);
    const bandText = () => (${RECORD_BAND}?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 300);
    const until = async (fn) => {
        for (let i = 0; i < ${RECORD_BAND_POLLS} && !fn(); i++) {
            await new Promise((r) => setTimeout(r, 250));
        }
        return !!fn();
    };
`;

const recordBandDetachRestore = {
    name: "record-band-detach-restore",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-record-band-")) };
        try {
            const wslist = await h.rpc("workspacelist", null);
            const ch = await h.rpc("createchannel", { name: "verify-record-band", projectpath: ctx.cwd });
            ctx.channelId = ch.oid;
            const created = await h.rpc("createrun", {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: RECORD_BAND_GOAL,
                runtime: "claude",
                mode: "quick",
                deferstart: true,
            });
            ctx.runId = created.run.id;
            ctx.runORef = `run:${ctx.runId}`;
            // a later run finds the record already there and its capture fails, so attach explicitly
            await h.rpc("acceptdossieredge", { dossierid: RECORD_BAND_RECORD, runoref: ctx.runORef });
            // the Brief reads a boot-primed snapshot, so the RPC-created channel needs a reload
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("jarvis");
            ctx.opened = await h.ev(`(async () => {
                for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                if (typeof window.__openAddress !== "function") return { ok: false, why: "no __openAddress hook" };
                return window.__openAddress(${JSON.stringify(ctx.runORef)});
            })()`);
            ctx.bandShown = await h.ev(`(async () => {
                ${RECORD_BAND_LIB}
                return until(() => ${RECORD_BAND}?.querySelector("[data-jarvis-band-toggle]"));
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const detachedIds = async () =>
            ((await h.rpc("listdetachededges", { runoref: ctx.runORef }))?.edges ?? []).map((e) => e.dossierid);
        rec(
            "0. the run's sheet opened with its record on the band",
            ctx.arrangeError == null && ctx.opened?.ok === true && ctx.bandShown === true,
            ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, opened: ctx.opened, band: ctx.bandShown })
        );

        const expanded = await h.ev(`(async () => {
            ${RECORD_BAND_LIB}
            const toggle = ${RECORD_BAND}?.querySelector("[data-jarvis-band-toggle]");
            if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
            const ok = await until(() => bandButton("Not this record"));
            return { ok, restore: !!bandButton("Restore"), text: bandText() };
        })()`);
        rec(
            "1. expanding the band shows the edge with Not this record and no Restore",
            expanded.ok === true && expanded.restore === false,
            JSON.stringify(expanded)
        );

        const detached = await h.ev(`(async () => {
            ${RECORD_BAND_LIB}
            bandButton("Not this record")?.click();
            // a confirmed edge asks first; the dialog is outside the band, and its button's text ends in a key hint
            const dialogButton = () =>
                [...document.querySelectorAll("button")].find(
                    (b) => (b.textContent || "").trim().startsWith("Detach") && !${RECORD_BAND}?.contains(b)
                );
            for (let i = 0; i < 12 && !dialogButton(); i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            const confirm = dialogButton();
            confirm?.click();
            const ok = await until(() => bandButton("Restore") && !bandButton("Not this record"));
            return { ok, asked: !!confirm, detachedRow: bandText().includes("Detached"), text: bandText() };
        })()`);
        const afterDetach = await detachedIds();
        await h.shot("cdp-shots/record-band-detached.png");
        rec(
            "2. Not this record moves the edge to a Detached row that offers Restore",
            detached.ok === true && detached.detachedRow === true && afterDetach.includes(RECORD_BAND_RECORD),
            JSON.stringify({ ...detached, stored: afterDetach })
        );

        const restored = await h.ev(`(async () => {
            ${RECORD_BAND_LIB}
            const restore = bandButton("Restore");
            restore?.click();
            const ok = !!restore && (await until(() => bandButton("Not this record") && !bandButton("Restore")));
            return { ok, clicked: !!restore, detachedRow: bandText().includes("Detached"), text: bandText() };
        })()`);
        const afterRestore = await detachedIds();
        await h.shot("cdp-shots/record-band-restored.png");
        rec(
            "3. Restore puts the edge back and empties the Detached group",
            restored.ok === true && restored.detachedRow === false && !afterRestore.includes(RECORD_BAND_RECORD),
            JSON.stringify({ ...restored, stored: afterRestore })
        );
        return steps;
    },
    async teardown(h, ctx) {
        // detached, so the record keeps one run ref across runs rather than growing one per run
        await teardownFixtureRun(h, ctx, "record-band-detach-restore", {
            what: "detach the run from the record",
            fn: () => (ctx.runORef ? h.rpc("detachdossieredge", { dossierid: RECORD_BAND_RECORD, runoref: ctx.runORef }) : null),
        });
    },
};

// --- agent-rail-file-link: a file clicked in the agent rail is the file the Diff surface opens on ----------
// Issue 8 (2026-08-03): the rail's file link switched to the Diff surface and landed on the scope's first changed
// file. A fixture agent whose transcript names a temp repo with three modified files; the third is clicked, so
// landing on the first reads as the defect. The link is claimed once: a later visit keeps the row picked there.
const RAIL_LINK_AGENT = "rail-link agent";
const RAIL_LINK_FILES = ["alpha.txt", "bravo.txt", "charlie.txt"];
const RAIL_LINK_RAIL = `document.querySelector('aside[aria-label="Agent details"]')`;
const RAIL_LINK_LIB = `
    const railFile = (name) =>
        [...(${RAIL_LINK_RAIL}?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").includes(name));
    const diffRow = (name) => document.querySelector('[data-changed-file-row="' + name + '"]');
    const selectedRows = () =>
        [...document.querySelectorAll("[data-changed-file-row]")]
            .filter((r) => r.getAttribute("aria-current") === "true")
            .map((r) => r.getAttribute("data-changed-file-row"));
    const until = async (fn) => {
        for (let i = 0; i < 80 && !fn(); i++) {
            await new Promise((r) => setTimeout(r, 250));
        }
        return !!fn();
    };
`;

function writeRailLinkRepo(cwd) {
    const git = (...args) =>
        execFileSync("git", ["-C", cwd, "-c", "user.name=verify", "-c", "user.email=verify@example.invalid", "-c", "core.autocrlf=false", ...args]);
    git("init", "-q");
    for (const f of RAIL_LINK_FILES) writeFileSync(join(cwd, f), `${f} one\n`);
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    for (const f of RAIL_LINK_FILES) writeFileSync(join(cwd, f), `${f} one\n${f} two\n`);
    // outside the repo's file list: the transcript only names the working directory
    const transcript = join(cwd, ".git", "rail-link.jsonl");
    writeFileSync(
        transcript,
        JSON.stringify({ type: "user", cwd, message: { role: "user", content: "verify the rail file link" } }) + "\n"
    );
    return transcript;
}

const agentRailFileLink = {
    name: "agent-rail-file-link",
    surface: "agent",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-rail-link-"));
        const ctx = { cwd, prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`) };
        try {
            const transcriptPath = writeRailLinkRepo(cwd);
            mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
            writeFileSync(
                TREE_RAIL_FIXTURE,
                JSON.stringify(
                    [
                        {
                            id: "fx-rail-link",
                            name: RAIL_LINK_AGENT,
                            project: "verify-rail-link",
                            task: "verify the rail file link",
                            state: "working",
                            agent: "claude",
                            model: "opus",
                            activeMs: 60_000,
                            blockId: "fx-blk-rail-link",
                            transcriptPath,
                        },
                    ],
                    null,
                    2
                )
            );
            ctx.wroteFixture = true;
            // the rail is off by default and persisted, and the fixture roster is read once at boot
            await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            await h.goto("agent");
            ctx.railFiles = await h.ev(`(async () => {
                ${RAIL_LINK_LIB}
                const row = () => {
                    const tree = document.querySelector("[data-agent-tree]");
                    const name = tree && [...tree.querySelectorAll("div")].find(
                        (d) => d.textContent.trim() === ${JSON.stringify(RAIL_LINK_AGENT)} && d.children.length === 0
                    );
                    return name ? name.closest(".cursor-pointer") : null;
                };
                if (!(await until(row))) return { ok: false, why: "no agent row in the tree" };
                row().click();
                const names = ${JSON.stringify(RAIL_LINK_FILES)};
                const ok = await until(() => names.every((n) => railFile(n)));
                return { ok, why: (${RAIL_LINK_RAIL}?.innerText || "").replace(/\\s+/g, " ").trim().slice(-300) };
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const [first, , third] = RAIL_LINK_FILES;
        rec(
            "0. the focused agent's rail lists its three modified files",
            ctx.arrangeError == null && ctx.railFiles?.ok === true,
            ctx.arrangeError ?? JSON.stringify(ctx.railFiles)
        );
        await h.shot("cdp-shots/agent-rail-file-link-rail.png");

        const landed = await h.ev(`(async () => {
            ${RAIL_LINK_LIB}
            const link = railFile(${JSON.stringify(third)});
            link?.click();
            const ok = !!link && (await until(() => selectedRows().length > 0));
            // the surface settles on the first file before a late claim could move it, so read after a beat
            await new Promise((r) => setTimeout(r, 1500));
            return { ok, clicked: !!link, selected: selectedRows(), rows: document.querySelectorAll("[data-changed-file-row]").length };
        })()`);
        await h.shot("cdp-shots/agent-rail-file-link-diff.png");
        rec(
            "1. clicking the third file opens the Diff surface on that file, not the first",
            landed.ok === true && landed.rows === RAIL_LINK_FILES.length && landed.selected.join() === third,
            JSON.stringify(landed)
        );

        await h.ev(`(async () => {
            ${RAIL_LINK_LIB}
            diffRow(${JSON.stringify(first)})?.click();
            await until(() => selectedRows().join() === ${JSON.stringify(first)});
        })()`);
        await h.goto("agent");
        await h.ev("new Promise((r) => setTimeout(r, 600))");
        await h.goto("files");
        const kept = await h.ev(`(async () => {
            ${RAIL_LINK_LIB}
            await until(() => selectedRows().length > 0);
            await new Promise((r) => setTimeout(r, 1500));
            return { selected: selectedRows() };
        })()`);
        rec(
            "2. the link is claimed once: coming back keeps the row picked on the surface",
            kept.selected.join() === first,
            JSON.stringify(kept)
        );
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "agent-rail-file-link", {
            what: "restore the rail's visibility",
            fn: () =>
                h.ev(
                    ctx.prevRail == null
                        ? `localStorage.removeItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`
                        : `localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, ${JSON.stringify(ctx.prevRail)})`
                ),
        });
    },
};

// --- dag-observability: what the run sheet and the DAG modal claim about a live DAG ------------------
// The orchestrator observability checks (spec 10.3, once scripts/cdp/orchestrator-observability-e2e.mjs) on
// today's surfaces: a run reads on the Jarvis run sheet, and the DAG opens from its dock. The chained plan
// dispatches only t-1, so t-3 is the undispatched task; teardown cancels the run and deletes t-1's worker.
// Open in Agent leaves the Brief, so it runs last.
const OBS_WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
// below TIMELINE_RAIL_MIN_PX (1100), where the lifecycle rail collapses into a drawer
const OBS_NARROW = { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false };
const OBS_MODAL = `document.querySelector('[data-dag-modal-kind]')`;
const OBS_RAIL = `document.querySelector('[data-timeline-rail]')`;
// a row that renders its raw event kind means the projection is missing that kind's title
const OBS_RAW_KIND = /\b(task|dag|child|lead)-[a-z-]+\b/;

const dagObservability = {
    name: "dag-observability",
    surface: "jarvis",
    async arrange(h) {
        await h.cdp("Emulation.setDeviceMetricsOverride", OBS_WIDE);
        const ctx = await arrangeSheetDagRun(h, "dag-observability", RUN_SHEET_POLISH_TASKS);
        if (ctx.arrangeError != null) return ctx;
        try {
            await waitForDispatch(h, ctx, "t-1");
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec(
            "0. the run's sheet opened and t-1 dispatched",
            ctx.arrangeError == null && ctx.opened?.ok === true && ctx.dispatched === true,
            ctx.arrangeError ??
                JSON.stringify({ runId: ctx.runId, opened: ctx.opened, dispatched: ctx.dispatched, dispatchMs: ctx.dispatchMs })
        );

        const sheet = await h.ev(`(async () => {
            for (let i = 0; i < 40 && !document.querySelector("[data-run-sheet] [data-run-sheet-row]"); i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            const root = document.querySelector("[data-run-sheet]");
            if (!root) return null;
            const nextEl = [...root.querySelectorAll("div")].find(
                (d) => d.children.length === 1 && d.firstElementChild.textContent === "next: "
            );
            return {
                strip: root.querySelector("[role=img]")?.getAttribute("aria-label") ?? null,
                rows: root.querySelectorAll("[data-run-sheet-row]").length,
                verb: root.querySelector("[data-run-sheet-verb]")?.textContent.trim() ?? null,
                next: nextEl ? nextEl.textContent.slice("next: ".length).trim() : null,
            };
        })()`);
        rec(
            "1. the sheet reads the real task group: a done/total strip and one row per task",
            sheet != null && /^\d+ of 3 tasks done/.test(sheet.strip ?? "") && sheet.rows === 3,
            JSON.stringify(sheet)
        );
        const degraded = sheet?.verb === "Status is stale";
        rec(
            "2. the sheet states the engine's next move, and a stale read calls it unknown",
            sheet != null && !!sheet.next && (!degraded || sheet.next.startsWith("unknown")),
            JSON.stringify({ verb: sheet?.verb, next: sheet?.next })
        );

        const modalOpened = await h.ev(`(async () => {
            const btn = [...(document.querySelector("[data-run-sheet]")?.querySelectorAll("button") ?? [])].find(
                (b) => b.textContent.trim() === "Open DAG"
            );
            if (!btn) return false;
            btn.click();
            for (let i = 0; i < 20 && !document.querySelector("[data-dag-modal-kind] [data-dag-node]"); i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            return !!document.querySelector("[data-dag-modal-kind] [data-dag-node]");
        })()`);

        const history = await h.ev(`(async () => {
            for (let i = 0; i < 40 && !${OBS_RAIL}?.querySelector("[data-timeline-row][data-timeline-task]"); i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            const rail = ${OBS_RAIL};
            if (!rail) return null;
            const rows = [...rail.querySelectorAll("[data-timeline-row]")].map((b) => (b.innerText || "").trim());
            return { layout: rail.getAttribute("data-timeline-rail"), rows };
        })()`);
        const rawRows = (history?.rows ?? []).filter((r) => OBS_RAW_KIND.test(r));
        rec(
            "3. Open DAG shows the lifecycle as a rail of titled history rows",
            modalOpened === true &&
                history?.layout === "rail" &&
                history.rows.length > 0 &&
                rawRows.length === 0,
            JSON.stringify({ modalOpened, layout: history?.layout, rows: history?.rows.length, rawRows })
        );

        const deeplink = await h.ev(`(async () => {
            const row = ${OBS_RAIL}?.querySelector("[data-timeline-row][data-timeline-task]");
            if (!row) return null;
            const task = row.getAttribute("data-timeline-task");
            row.click();
            await new Promise((r) => setTimeout(r, 500));
            const chip = [...${OBS_RAIL}.querySelectorAll("button")].find((b) => /^Task/.test((b.innerText || "").trim()));
            return { task, chip: chip ? chip.innerText.trim() : null };
        })()`);
        rec(
            "4. a task-scoped event selects its task",
            deeplink != null && (deeplink.chip ?? "").includes(deeplink.task),
            JSON.stringify(deeplink)
        );

        const explicit = await h.ev(`(async () => {
            const node = ${OBS_MODAL}?.querySelector('[data-dag-node="t-3"]');
            if (!node) return null;
            node.click();
            await new Promise((r) => setTimeout(r, 500));
            const text = ${OBS_MODAL}.innerText || "";
            return {
                pending: text.includes("Not dispatched yet"),
                live: text.includes("● live"),
                failed: text.includes("load failed"),
            };
        })()`);
        rec(
            "5. the undispatched t-3 says so, and the rail names its connection state",
            explicit != null && explicit.pending && (explicit.live || explicit.failed),
            JSON.stringify(explicit)
        );

        await h.cdp("Emulation.setDeviceMetricsOverride", OBS_NARROW);
        await new Promise((r) => setTimeout(r, 900));
        const drawer = await h.ev(`(() => {
            const rail = ${OBS_RAIL};
            if (!rail) return null;
            const toggle = rail.querySelector('button[aria-label$="lifecycle"]');
            return { layout: rail.getAttribute("data-timeline-rail"), toggle: toggle?.getAttribute("aria-label") ?? null };
        })()`);
        await h.cdp("Emulation.setDeviceMetricsOverride", OBS_WIDE);
        await new Promise((r) => setTimeout(r, 900));
        rec(
            "6. a narrow window collapses the lifecycle into a drawer with an expand control",
            drawer != null && drawer.layout === "drawer" && drawer.toggle != null,
            JSON.stringify(drawer)
        );

        const worker = await h.ev(`(async () => {
            const node = ${OBS_MODAL}?.querySelector('[data-dag-node="t-1"]');
            if (!node) return null;
            node.click();
            const openBtn = () =>
                [...(${OBS_MODAL}?.querySelectorAll("button") ?? [])].find((b) => /open in agent/i.test(b.innerText || ""));
            for (let i = 0; i < 40 && !openBtn(); i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            const text = ${OBS_MODAL}?.innerText || "";
            return {
                openable: !!openBtn(),
                pending: text.includes("Not dispatched yet"),
                unavailable: text.includes("Worker session unavailable"),
            };
        })()`);
        rec(
            "7. the dispatched t-1 resolves its own worker, with Open in Agent",
            worker != null && worker.openable,
            JSON.stringify(worker)
        );

        const landed = await h.ev(`(async () => {
            const btn = [...(${OBS_MODAL}?.querySelectorAll("button") ?? [])].find((b) => /open in agent/i.test(b.innerText || ""));
            if (!btn) return null;
            btn.click();
            await new Promise((r) => setTimeout(r, 1200));
            return {
                modalGone: ${OBS_MODAL} == null,
                onAgent: !!document.querySelector('nav button[aria-label="Agent"]')?.classList.contains("text-accent-soft"),
            };
        })()`);
        rec(
            "8. Open in Agent closes the modal and lands on the Agent surface",
            landed != null && landed.modalGone && landed.onAgent,
            JSON.stringify(landed)
        );
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "dag-observability");
    },
};

// --- final-shots: the Final check row, dock button and viewer (.superpowers/design/final-shots) ------------
// A deferred run's dag is rewritten through object.UpdateObject with a Final command, a failed round 1 kept in
// pastfinals and an unverified round 2, both carrying the Viewer board's manifest. Their out dirs are temp dirs of
// PNGs captured from the app itself, with round 1's jarvis-peek-narrow left off disk. The dag is then re-seeded for
// the States board's rows. Nothing touches its tasks or status, so it is never finalizing and the engine never
// starts a final stage on it; the chained plan dispatches t-1, which teardown's run cancel stops.
const FINAL_SHOTS_CMD = "node scripts/cdp/final-verify.mjs final-shots";
const FINAL_SHOTS_SEED_KEY = "verify:finalshots-seed";
const FINAL_SHOTS_UICTX = { windowid: "", activetabid: "" };
const FINAL_SHOTS_MISSING = "jarvis-peek-narrow";
// the fix round's row counts one shot more than round 1 had (States board: 17 shots)
const FINAL_SHOTS_EXTRA = { "surface-smoke": ["surface-agent"] };
const FINAL_SHOTS_PLAIN = ["checkout-empty", "checkout-filled", "receipt"];
// the fixture PNGs, by the surface each is captured on. Never through h.shot, which records evidence shots
const FINAL_SHOTS_CAPTURES = {
    cockpit: ["surface-smoke", "surface-cockpit"],
    jarvis: [
        "surface-jarvis",
        "brief-peek",
        "peek-ctrl-click",
        "jarvis-peek",
        "jarvis-peek-narrow",
        "jarvis-peek-busy",
        "jarvis-peek-empty",
        "resource-linking",
    ],
    radar: ["surface-radar", "receipt"],
    usage: ["surface-usage", "checkout-filled"],
    files: ["surface-files"],
    settings: ["surface-settings", "checkout-empty"],
    code: ["surface-code"],
    setup: ["surface-setup"],
    agent: ["surface-agent"],
};
// crops, so the shots differ in size the way real ones do; the rest are the whole viewport
const FINAL_SHOTS_CLIPS = {
    "brief-peek": { x: 800, y: 0, width: 800, height: 950 },
    "peek-ctrl-click": { x: 520, y: 150, width: 560, height: 640 },
    "jarvis-peek-narrow": { x: 1160, y: 530, width: 440, height: 420 },
    "jarvis-peek-busy": { x: 0, y: 0, width: 1200, height: 760 },
    receipt: { x: 400, y: 100, width: 800, height: 600 },
};
const FS_P = "pass";
const FS_F = "fail";
const FS_S = "skip";
// the Viewer board's five scenarios; round 2 passed the two jarvis-peek steps the fix round fixed
const FINAL_SHOTS_BOARD = [
    {
        name: "surface-smoke",
        shots: ["surface-smoke", "surface-cockpit", "surface-jarvis", "surface-radar", "surface-usage", "surface-files", "surface-settings", "surface-code", "surface-setup"],
        steps: [
            [FS_P, 'goto cockpit -> active nav "Cockpit", content non-empty', "active=Cockpit contentLen=1643"],
            [FS_P, 'goto jarvis -> active nav "Jarvis", content non-empty', "active=Jarvis contentLen=1378"],
            [FS_P, 'goto radar -> active nav "Radar", content non-empty', "active=Radar contentLen=1775"],
            [FS_P, 'goto usage -> active nav "Usage", content non-empty', "active=Usage contentLen=1909"],
            [FS_P, 'goto files -> active nav "Diff", content non-empty', "active=Diff contentLen=1349"],
            [FS_P, 'goto settings -> active nav "Settings", content non-empty', "active=Settings contentLen=2036"],
            [FS_P, 'goto code -> active nav "Code", content non-empty', "active=Code contentLen=1377"],
            [FS_P, 'goto setup -> active nav "Setup", content non-empty', "active=Setup contentLen=2123"],
            [FS_P, "wsh notify -> the avatar says it once, with no toast, and the bubble leaves", "bubble=true toast=false gone=true"],
            [FS_S, "steer input visible on a pi session card", "no pi session focused in this run - focus one before reading this as a pass (the manual round-trip covers it)"],
        ],
    },
    {
        name: "brief-peek",
        shots: ["brief-peek"],
        steps: [
            [FS_P, "1. the Brief is showing and no peek is open yet"],
            [FS_P, "2. a record row in the palette opens the peek, with its updated stamp and status toggle"],
            [FS_P, "2b. the peek names the record's fleet or says it has none"],
            [FS_P, "3. the peek's attributed run opens the run's sheet, resolved rather than pending"],
            [FS_P, "4. the status picker offers only legal transitions, and the current status is a label"],
            [FS_P, "5. Escape closes the peek and leaves the Brief behind it"],
        ],
    },
    {
        name: "peek-ctrl-click",
        shots: ["peek-ctrl-click"],
        steps: [
            [FS_P, "1. the Brief shows a peekable run row"],
            [FS_P, "2. Ctrl+click opens a ready run item view in the 560px popup"],
            [FS_P, "3. the host surface, subject, sheet flag and scroll are unchanged while the peek is up"],
            [FS_P, "4. Escape closes the popup and the host's state still matches"],
        ],
    },
    {
        name: "jarvis-peek",
        shots: ["jarvis-peek", "jarvis-peek-narrow", "jarvis-peek-busy", "jarvis-peek-empty"],
        steps: [
            [FS_P, "1. keyboard open renders a labelled dialog of header/queue/composer and focuses its container"],
            [FS_P, "2. Tab starts at Full view and reverse traversal stays inside the dialog"],
            [FS_P, "3. the quiet card states queue absence once, and the composer is live wherever there is a destination"],
            [FS_F, "4. the narrow panel stays bounded with a pinned header, no horizontal overflow, and an unclipped harness picker"],
            [FS_F, "5. attention expands the card and keyboard navigation moves the cursor then focuses the composer"],
            [FS_P, "6. Escape, close, and backdrop dismiss only the peek and return focus to the creature"],
            [FS_P, "7. dismissing the global peek stays on the current surface"],
        ],
    },
    {
        name: "resource-linking",
        shots: ["resource-linking"],
        steps: [
            [FS_P, "1. the DEV hook that opens an address is installed on the Brief"],
            [FS_P, "2. a record address opens the record's peek"],
            [FS_S, "3. a decision address opens its record's peek"],
            [FS_P, "4. a memory address opens nothing and leaves the surface where it was"],
            [FS_S, "5. a finding address lands on that finding on a first Radar visit"],
            [FS_S, "6. Radar's Open run lands on the run's sheet"],
            [FS_P, "7. an address nothing can open shows the toast and leaves the surface where it was"],
        ],
    },
];

function finalShotsManifest(round, extra = {}) {
    return FINAL_SHOTS_BOARD.map((sc) => ({
        name: sc.name,
        files: [...sc.shots, ...(extra[sc.name] ?? [])].map((f) => `cdp-shots/${f}.png`),
        steps: sc.steps.map(([state, step, detail]) => ({
            step,
            state: round === 2 && state === FS_F ? FS_P : state,
            ...(detail ? { detail } : {}),
        })),
    }));
}

async function captureFinalShotsFixture(h) {
    const pngs = {};
    for (const [surface, names] of Object.entries(FINAL_SHOTS_CAPTURES)) {
        await h.goto(surface);
        for (const name of names) {
            const clip = FINAL_SHOTS_CLIPS[name];
            const { data } = await h.cdp("Page.captureScreenshot", {
                format: "png",
                ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
            });
            pngs[name] = Buffer.from(data, "base64");
        }
    }
    return pngs;
}

// the out dirs the engine would have made: <out>/<round>/cdp-shots/*.png, and the plain listing's PNGs at its top
function writeFinalShotsFixture(out, pngs) {
    for (const round of [1, 2]) {
        mkdirSync(join(out, String(round), "cdp-shots"), { recursive: true });
        for (const sc of finalShotsManifest(round, FINAL_SHOTS_EXTRA)) {
            for (const file of sc.files) {
                const name = file.slice("cdp-shots/".length, -".png".length);
                if (round === 1 && name === FINAL_SHOTS_MISSING) continue;
                writeFileSync(join(out, String(round), file), pngs[name]);
            }
        }
    }
    mkdirSync(join(out, "plain"), { recursive: true });
    for (const name of FINAL_SHOTS_PLAIN) writeFileSync(join(out, "plain", `${name}.png`), pngs[name]);
    mkdirSync(join(out, "empty"), { recursive: true });
}

// the stages of every seed, by the board row each one draws
function finalShotsStages(out) {
    const dir = (sub) => `${out.replace(/\\/g, "/")}/${sub}`;
    const round1 = (extra) => ({
        state: "failed",
        round: 1,
        outdir: dir(1),
        shots: finalShotsManifest(1, extra),
        shotsmanifest: true,
    });
    return {
        main: {
            final: { state: "unverified", round: 2, outdir: dir(2), shots: finalShotsManifest(2), shotsmanifest: true },
            pastfinals: [round1()],
        },
        fixing: { final: { state: "", round: 2 }, pastfinals: [round1(FINAL_SHOTS_EXTRA)] },
        passed: {
            final: { state: "passed", round: 1, outdir: dir(2), shots: finalShotsManifest(2), shotsmanifest: true },
            pastfinals: [],
        },
        empty: { final: { state: "unverified", round: 1, outdir: dir("empty"), shotsmanifest: false }, pastfinals: [] },
        plain: {
            final: {
                state: "passed",
                round: 1,
                outdir: dir("plain"),
                shots: FINAL_SHOTS_PLAIN.map((name) => ({ name, files: [`${name}.png`] })),
                shotsmanifest: false,
            },
            pastfinals: [],
        },
    };
}

const finalFingerprint = (final, past) =>
    JSON.stringify([final?.state, final?.round, final?.shots?.length ?? 0, (past ?? []).map((p) => p.shots?.length ?? 0)]);

// Puts the stored dag into a state the engine has not reached: change maps the dag as read to the dag to
// write, and print reduces a dag to what the seed must hold.
async function seedDag(h, ctx, change, print) {
    const oref = `dag:${ctx.dagId}`;
    let want = null;
    let stored = null;
    // the watchdog ticks a running dag, and a tick that read the dag before this write lands over it
    for (let i = 0; i < 3 && (stored == null || print(stored) !== want); i++) {
        const next = { ...change(await waveService(h, "object", "GetObject", [oref])), otype: "dag" };
        want = print(next);
        await waveService(h, "object", "UpdateObject", [next, false], FINAL_SHOTS_UICTX);
        stored = await waveService(h, "object", "GetObject", [oref]);
    }
    if (print(stored) !== want) {
        throw new Error(`the dag did not keep its seed: want ${want}, stored ${print(stored)}`);
    }
    // UpdateObject publishes nothing; a meta write sends the whole stored dag to the page
    ctx.seeds = (ctx.seeds ?? 0) + 1;
    await h.rpc("setmeta", { oref, meta: { [FINAL_SHOTS_SEED_KEY]: ctx.seeds } });
}

const seedFinalShots = (h, ctx, { final, pastfinals }) =>
    seedDag(
        h,
        ctx,
        (dag) => ({ ...dag, finalcmd: FINAL_SHOTS_CMD, final, pastfinals }),
        (dag) => finalFingerprint(dag?.final, dag?.pastfinals)
    );

const FS_ROW = `document.querySelector("[data-run-sheet] [data-run-sheet-final-shots]")`;
const FS_DOCK = `document.querySelector("[data-run-sheet] [data-run-sheet-final-shots-dock]")`;
const FS_VIEWER = `document.querySelector("[data-final-shots-viewer]")`;
// the viewer is portaled to body, so it is read on its own, not inside the run sheet
const FS_READ = `(() => {
    const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
    const row = ${FS_ROW};
    const header = row?.querySelector(":scope > button[aria-expanded]");
    const dock = ${FS_DOCK};
    const v = ${FS_VIEWER};
    let viewer = null;
    if (v) {
        const film = [...v.querySelectorAll('button[aria-pressed][aria-label$=".png"]')];
        const zoom = [...v.querySelectorAll("button[aria-pressed]")].find((b) => /^(Fit|Actual size)$/.test(flat(b)));
        const steps = v.querySelector("button[aria-expanded]");
        const drawer = v.querySelector('aside[aria-label="Steps"]');
        const img = v.querySelector("img[alt]:not([alt=''])");
        viewer = {
            text: flat(v.firstElementChild),
            rounds: [...v.querySelectorAll('[role="group"][aria-label="Round"] button')].map((b) => ({
                text: flat(b),
                on: b.getAttribute("aria-pressed") === "true",
            })),
            tabs: [...v.querySelectorAll('[role="tab"]')].map((t) => ({
                text: flat(t),
                on: t.getAttribute("aria-selected") === "true",
                hollow: t.querySelector("span.border-muted") != null,
            })),
            film: film.map((b) => ({ name: b.getAttribute("aria-label"), on: b.getAttribute("aria-pressed") === "true" })),
            path: film[0]?.parentElement?.querySelector(":scope > span")?.textContent ?? null,
            zoom: zoom ? { text: flat(zoom), on: zoom.getAttribute("aria-pressed") === "true" } : null,
            steps: steps ? { text: flat(steps), expanded: steps.getAttribute("aria-expanded") } : null,
            drawer: drawer ? { fails: [...drawer.querySelectorAll("span")].filter((s) => s.textContent === "FAIL").length } : null,
            img: img ? { loaded: img.complete && img.naturalWidth > 0, alt: img.alt } : null,
            missing: flat(v.querySelector("[data-final-shots-missing]")) || null,
        };
    }
    const link = row ? [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "Open the viewer") : null;
    return {
        sheet: document.querySelector("[data-run-sheet]") != null,
        row: header ? { expanded: header.getAttribute("aria-expanded"), text: flat(header) } : null,
        thumbs: row
            ? [...row.querySelectorAll('button[aria-label^="Open "]')].map((b) => ({
                  name: b.getAttribute("aria-label").slice("Open ".length),
                  img: b.querySelector("img") != null,
              }))
            : [],
        caption: link ? flat(link.parentElement) : null,
        dock: dock
            ? {
                  text: flat(dock),
                  disabled: dock.disabled,
                  accent: dock.classList.contains("border-accent"),
                  focused: document.activeElement === dock,
              }
            : null,
        viewer,
    };
})()`;
// what the Jarvis surface under the viewer has selected: its list cursor and the run its sheet shows
const FS_JARVIS = `(() => ({
    cursor: document.querySelector("[data-jarvis-brief-cursor]")?.textContent.trim().slice(0, 80) ?? null,
    sheet: (document.querySelector("[data-jarvis-brief-sheet] > header")?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 160),
}))()`;
const FS_KEYS = {
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowRight: "ArrowRight",
    z: "KeyZ",
    s: "KeyS",
    Escape: "Escape",
};
const FS_WAIT_MS = 8000;

// polls the run sheet and viewer until ok holds or the wait runs out, and returns the last read either way
async function finalShotsUntil(h, ok, ms = FS_WAIT_MS) {
    for (let waited = 0; ; waited += 250) {
        const s = await h.ev(FS_READ).catch(() => null);
        if ((s != null && ok(s)) || waited >= ms) return s;
        await polishNap(250);
    }
}

const finalShotsClick = (h, expr) =>
    h.ev(`(() => {
        const el = ${expr};
        if (!el) return false;
        // a real click focuses its button, and the viewer hands focus back to whatever held it
        el.focus();
        el.click();
        return true;
    })()`);

// a DOM key event at the focused element: CDP's Input.dispatchKeyEvent often never reaches the WebView, and the
// keybinding dispatcher and the run sheet's Escape both listen on window, which this reaches the same way
const finalShotsKey = (h, key) =>
    h.ev(`(() => {
        const target = document.activeElement ?? document.body;
        const init = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(FS_KEYS[key])}, bubbles: true, cancelable: true };
        const down = new KeyboardEvent("keydown", init);
        target.dispatchEvent(down);
        target.dispatchEvent(new KeyboardEvent("keyup", init));
        return down.defaultPrevented;
    })()`);

const FS_BOARD_ORDER = ["surface-smoke", "brief-peek", "peek-ctrl-click", "jarvis-peek", "resource-linking"];

const finalShotsScenario = {
    name: "final-shots",
    surface: "jarvis",
    async arrange(h) {
        const out = mkdtempSync(join(tmpdir(), "verify-final-shots-out-"));
        let pngs;
        try {
            // before the run exists: arrangeSheetDagRun ends on the Brief with the sheet open
            pngs = await captureFinalShotsFixture(h);
            writeFinalShotsFixture(out, pngs);
        } catch (e) {
            return { out, arrangeError: String(e?.message ?? e) };
        }
        const ctx = await arrangeSheetDagRun(h, "final-shots", RUN_SHEET_POLISH_TASKS);
        ctx.out = out;
        ctx.stages = finalShotsStages(out);
        if (ctx.arrangeError != null) return ctx;
        try {
            ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.oid;
            if (!ctx.dagId) throw new Error("the run has no dag");
            await seedFinalShots(h, ctx, ctx.stages.main);
            ctx.rowShown = (await finalShotsUntil(h, (s) => s.row != null, 15_000))?.row != null;
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec(
            "0. the run's sheet opened on a dag seeded with two finished rounds",
            ctx.arrangeError == null && ctx.opened?.ok === true && ctx.rowShown === true,
            ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, dagId: ctx.dagId, opened: ctx.opened })
        );
        if (ctx.arrangeError != null) return steps;

        let s = await finalShotsUntil(h, (x) => x.row?.text.includes("16 shots") && x.dock != null);
        rec(
            "1. the row is collapsed with unverified · 5 scenarios and 16 shots · 2 rounds; the dock reads Screenshots · 16",
            s?.row?.expanded === "false" &&
                s.row.text.includes("unverified · 5 scenarios") &&
                s.row.text.includes("16 shots · 2 rounds") &&
                s.dock?.text === "Screenshots · 16" &&
                !s.dock.disabled &&
                !s.dock.accent,
            JSON.stringify({ row: s?.row, dock: s?.dock })
        );
        await h.shot("cdp-shots/final-shots-1-row-closed.png");

        await finalShotsClick(h, `${FS_ROW}?.querySelector(":scope > button[aria-expanded]")`);
        s = await finalShotsUntil(h, (x) => x.row?.expanded === "true" && x.thumbs.length > 0 && x.thumbs.every((t) => t.img));
        rec(
            "2. the opened row shows one thumbnail per scenario and the round-1 caption",
            s?.row?.expanded === "true" &&
                JSON.stringify(s.thumbs.map((t) => t.name)) === JSON.stringify(FS_BOARD_ORDER) &&
                s.thumbs.every((t) => t.img) &&
                (s.caption ?? "").includes("Round 1 failed on jarvis-peek steps 4 and 5."),
            JSON.stringify({ thumbs: s?.thumbs, caption: s?.caption })
        );
        await h.shot("cdp-shots/final-shots-2-row-open.png");
        // the States rows below are drawn collapsed
        await finalShotsClick(h, `${FS_ROW}?.querySelector(":scope > button[aria-expanded]")`);

        await finalShotsClick(h, FS_DOCK);
        s = await finalShotsUntil(h, (x) => x.viewer?.img?.loaded === true && x.viewer.film.length > 0);
        let v = s?.viewer;
        rec(
            "3. the dock opens the viewer on round 2: tabs, shot, filmstrip and path, the drawer closed on a passing scenario",
            v != null &&
                v.rounds.length === 2 &&
                v.rounds.find((r) => r.on)?.text === "Round 2 unverified" &&
                v.tabs.length === 5 &&
                v.tabs[0].on &&
                v.tabs[0].text.startsWith("surface-smoke") &&
                v.img?.loaded === true &&
                v.film.length === 9 &&
                v.film[0].on &&
                (v.path ?? "").endsWith("/2/cdp-shots/surface-smoke.png") &&
                v.steps?.expanded === "false" &&
                v.drawer == null,
            JSON.stringify(v)
        );
        await h.shot("cdp-shots/final-shots-3-viewer.png");

        await finalShotsClick(
            h,
            `[...(${FS_VIEWER}?.querySelectorAll('[role="group"][aria-label="Round"] button') ?? [])].find((b) => b.innerText.trim().startsWith("Round 1"))`
        );
        s = await finalShotsUntil(
            h,
            (x) => x.viewer?.tabs[0]?.text.startsWith("jarvis-peek") && x.viewer.drawer != null && x.viewer.img?.loaded === true
        );
        v = s?.viewer;
        rec(
            "4. round 1 puts jarvis-peek first with the drawer open on its two failing steps",
            v != null &&
                v.rounds.find((r) => r.on)?.text === "Round 1 failed" &&
                v.tabs[0].on &&
                v.tabs[0].text.startsWith("jarvis-peek") &&
                v.steps?.expanded === "true" &&
                v.drawer?.fails === 2,
            JSON.stringify({ rounds: v?.rounds, tab: v?.tabs[0], steps: v?.steps, drawer: v?.drawer })
        );
        await h.shot("cdp-shots/final-shots-4-round-1.png");

        // ArrowUp/Down are the Jarvis list's keys too, and with the sheet open they would open the next run
        const before = await h.ev(FS_JARVIS);
        const keys = {};
        await finalShotsKey(h, "ArrowDown");
        keys.down = (await finalShotsUntil(h, (x) => x.viewer?.tabs[1]?.on === true, 2000))?.viewer?.tabs.findIndex((t) => t.on);
        await finalShotsKey(h, "ArrowUp");
        keys.up = (await finalShotsUntil(h, (x) => x.viewer?.tabs[0]?.on === true, 2000))?.viewer?.tabs.findIndex((t) => t.on);
        await finalShotsKey(h, "z");
        keys.zoom = (await finalShotsUntil(h, (x) => x.viewer?.zoom?.on === true, 2000))?.viewer?.zoom;
        await finalShotsKey(h, "s");
        s = await finalShotsUntil(h, (x) => x.viewer?.steps?.expanded === "false" && x.viewer.drawer == null, 2000);
        keys.steps = { steps: s?.viewer?.steps, drawer: s?.viewer?.drawer };
        await h.shot("cdp-shots/final-shots-5-keys.png");
        await finalShotsKey(h, "z");
        keys.fit = (await finalShotsUntil(h, (x) => x.viewer?.zoom?.on === false, 2000))?.viewer?.zoom;
        await finalShotsKey(h, "ArrowRight");
        s = await finalShotsUntil(h, (x) => x.viewer?.film[1]?.on === true, 2000);
        keys.right = s?.viewer?.film.findIndex((f) => f.on);
        const after = await h.ev(FS_JARVIS);
        rec(
            "5. ArrowRight moves the filmstrip, z toggles Actual size, s toggles the drawer, and the Jarvis selection stays put",
            keys.down === 1 &&
                keys.up === 0 &&
                keys.zoom?.text === "Actual size" &&
                keys.steps.steps?.expanded === "false" &&
                keys.steps.drawer == null &&
                keys.fit?.text === "Fit" &&
                keys.right === 1 &&
                JSON.stringify(after) === JSON.stringify(before),
            JSON.stringify({ keys, before, after })
        );

        s = await finalShotsUntil(h, (x) => x.viewer?.missing != null);
        rec(
            "6. the file left off disk shows No longer on disk with its path",
            (s?.viewer?.missing ?? "").includes("No longer on disk") &&
                s.viewer.missing.includes(`/1/cdp-shots/${FINAL_SHOTS_MISSING}.png`),
            JSON.stringify({ missing: s?.viewer?.missing })
        );
        await h.shot("cdp-shots/final-shots-6-missing.png");
        await finalShotsClick(h, `${FS_VIEWER}?.querySelector('button[aria-label="Close"]')`);
        await finalShotsUntil(h, (x) => x.viewer == null, 3000);

        await seedFinalShots(h, ctx, ctx.stages.fixing);
        s = await finalShotsUntil(h, (x) => x.row?.text.includes("17 shots") === true);
        rec(
            "7. failed during the fix round: failed · jarvis-peek 2 steps, 17 shots · round 1, an accent dock",
            s?.row?.text.includes("failed · jarvis-peek 2 steps") &&
                s.row.text.includes("17 shots · round 1") &&
                s.dock?.text === "Screenshots · 17" &&
                s.dock.accent &&
                !s.dock.disabled,
            JSON.stringify({ row: s?.row, dock: s?.dock })
        );
        await h.shot("cdp-shots/final-shots-7-fixing.png");

        await seedFinalShots(h, ctx, ctx.stages.passed);
        s = await finalShotsUntil(h, (x) => x.row?.text.includes("passed · 5 scenarios") === true);
        rec(
            "8a. passed: passed · 5 scenarios, 16 shots, a plain dock",
            s?.row?.text.includes("passed · 5 scenarios") &&
                s.row.text.endsWith("16 shots") &&
                s.dock?.text === "Screenshots · 16" &&
                !s.dock.accent &&
                !s.dock.disabled,
            JSON.stringify({ row: s?.row, dock: s?.dock })
        );
        await h.shot("cdp-shots/final-shots-8a-passed.png");

        await seedFinalShots(h, ctx, ctx.stages.empty);
        s = await finalShotsUntil(h, (x) => x.row?.text.includes("no screenshots") === true);
        rec(
            "8b. unverified with no shots: unverified · no screenshots, the dock disabled at 0",
            s?.row?.text.includes("unverified · no screenshots") && s.dock?.text === "Screenshots · 0" && s.dock.disabled === true,
            JSON.stringify({ row: s?.row, dock: s?.dock })
        );
        await h.shot("cdp-shots/final-shots-8b-empty.png");

        await seedFinalShots(h, ctx, ctx.stages.plain);
        s = await finalShotsUntil(h, (x) => x.row?.text.includes("passed · 3 screenshots") === true);
        const plainRow = { row: s?.row, dock: s?.dock };
        await finalShotsClick(h, FS_DOCK);
        s = await finalShotsUntil(h, (x) => x.viewer?.img?.loaded === true);
        v = s?.viewer;
        rec(
            "8c. a plain PNG listing: passed · 3 screenshots, hollow-dot entries in the viewer, no Steps button",
            plainRow.row?.text.includes("passed · 3 screenshots") &&
                plainRow.row.text.includes("3 shots") &&
                plainRow.dock?.text === "Screenshots · 3" &&
                v != null &&
                JSON.stringify(v.tabs.map((t) => t.text)) === JSON.stringify(FINAL_SHOTS_PLAIN.map((n) => `${n}.png`)) &&
                v.tabs.every((t) => t.hollow) &&
                v.steps == null &&
                v.drawer == null &&
                v.rounds.length === 0 &&
                v.text.includes("Round 1 passed"),
            JSON.stringify({ ...plainRow, viewer: v })
        );
        await h.shot("cdp-shots/final-shots-8c-plain.png");

        await finalShotsKey(h, "Escape");
        await finalShotsUntil(h, (x) => x.viewer == null, 3000);
        // the run sheet's own Escape would close it a beat later, so the check waits past that
        await polishNap(600);
        s = await h.ev(FS_READ);
        rec(
            "9. Esc closes the viewer, leaves the run sheet open and hands focus back to the dock button",
            s?.viewer == null && s.sheet === true && s.dock?.focused === true,
            JSON.stringify({ viewer: s?.viewer != null, sheet: s?.sheet, dock: s?.dock })
        );
        await h.shot("cdp-shots/final-shots-9-closed.png");
        return steps;
    },
    async teardown(h, ctx) {
        if (ctx.cwd) await teardownFixtureRun(h, ctx, "final-shots");
        rmSync(ctx.out, { recursive: true, force: true });
    },
};

// --- final-stage: the final stage's tree row, pane, rail block and DAG node ---------------------------------
// Two parts on one run (docs/reference/cdp-run-fixtures.md, "A run with a final stage"). Part B comes first: the
// States board's rows, seeded on a dag the engine leaves alone because t-1 is still at work, with each round's
// final-step events published to the page. Part A is last, since it ends the run: every task is seeded done and
// merged, so the engine itself starts round 1, runs Tree and then a Verify that outlasts the scenario, and the
// stage is ended from its pane. The fixture's temp dir is a git repository, which the stage's tree needs.
const FST_VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const FST_LEAD = "final-stage lead";
const FST_VERIFIER = "final-stage verifier";
const FST_VERIFIER_ID = "fx-final-verifier";
// t-1 fans out to two sinks, so the final node takes two edges; at parallelism 1 only t-1 dispatches
const FST_TASKS = [
    { id: "t-1", label: "noop", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
    { id: "t-2", label: "noop 2", description: "do nothing, stop immediately", deps: ["t-1"], gate: false, state: "" },
    { id: "t-3", label: "noop 3", description: "do nothing, stop immediately", deps: ["t-1"], gate: false, state: "" },
];
const FST_SINK_EDGES = ["t-2>final", "t-3>final"];
// Part B's commands are only drawn, never run
const FST_CHECK = "node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit";
const FST_VERIFY = "node scripts/verify.mjs ./pkg/waveobj";
const FST_COMMIT = "c0ffee5a".padEnd(40, "0");
// Part A's commands run. Verify writes three lines and then one every 3s for 15 minutes: the engine publishes the
// tail from the command's own writes, the first one at once and then at most every 10s
const FST_MARK = "final-stage verify";
const FST_LIVE_VERIFY = `printf '${FST_MARK} 1\\n${FST_MARK} 2\\n${FST_MARK} 3\\n'; for i in $(seq 1 300); do sleep 3; echo "${FST_MARK} still running $i"; done`;
const FST_LIVE_FINAL = "true";
const FST_DETAIL = [
    `Final \`${FINAL_SHOTS_CMD}\` failed (exit 1):`,
    "FAIL jarvis-peek 4. the narrow panel stays bounded with a pinned header, no horizontal overflow, and an unclipped harness picker",
    "FAIL jarvis-peek 5. attention expands the card and keyboard navigation moves the cursor then focuses the composer",
    "2 of 43 steps failed across 5 scenarios",
].join("\n");
const FST_UNVERIFIED =
    "verifier: the narrow jarvis-peek panel could not be compared with its board, because the board has no artboard at 440px wide";
const FST_REASON =
    "the Verify loop of the final-stage scenario never ends on its own, so the scenario ends the stage here and records why";
// the Passed row's step times; with the verifier's they total the board's 14m 22s
const FST_STEP_MS = { tree: 22_000, check: 41_000, verify: 431_000, final: 188_000 };
const FST_VERIFIER_MS = 180_000;
const FST_STEP_TEXT = ["passed 22s", "passed 41s", "passed 7m 11s", "passed 3m 08s", "passed 3m 00s"];
const FST_TOTAL = "14m 22s";
const FST_WAIT_MS = 8000;
// a watchdog tick starts the stage (every 30s), then the Tree step and Verify's second publish
const FST_ENGINE_WAIT_MS = 90_000;

const fstHolds = (fn) => {
    try {
        return fn() === true;
    } catch {
        return false;
    }
};
const fstStates = (steps) => (steps ?? []).map((s) => s.state);
const fstRepeat = (state, n) => Array(n).fill(state);
const fstSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fstFlat = (text) => text.replace(/\s+/g, " ").trim();
const fstButton = (rootExpr, text) =>
    `[...(${rootExpr}?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

// page-side readers shared by the two reads below; every element comes through the selectors the plan fixes
const FST_LIB = `
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const stepsOf = (root) =>
        [...(root?.querySelectorAll("[data-final-step]") ?? [])].map((s) => ({
            key: s.getAttribute("data-final-step"),
            state: s.getAttribute("data-final-step-state"),
            text: flat(s.querySelector("span.whitespace-nowrap")),
            command: s.querySelector("span[title]")?.getAttribute("title") ?? null,
        }));
    const pastOf = (root) =>
        [...(root?.querySelectorAll("[data-final-past-round]") ?? [])].map((p) => ({
            round: p.getAttribute("data-final-past-round"),
            text: flat(p),
        }));
    const outputOf = (root) => root?.querySelector("[data-final-output]")?.textContent ?? null;
    const shotsOf = (root) => flat(root?.querySelector("[data-final-shots-link]")) || null;
`;
const FST_TREE = `document.querySelector("[data-agent-tree]")`;
const FST_RAIL = `document.querySelector('aside[aria-label="Agent details"]')`;
const FST_ROW = `${FST_TREE}?.querySelector("[data-final-row]")`;
const FST_PANE = `document.querySelector("[data-final-pane]")`;
const FST_MODAL = `document.querySelector("[data-dag-modal-kind]")`;
const FST_NODE = `${FST_MODAL}?.querySelector('[data-dag-node="final"]')`;
const FST_DAG_RAIL = `${FST_MODAL}?.querySelector("[data-dag-final-rail]")`;
const FST_SHEET = `document.querySelector("[data-run-sheet]")`;
const FST_FOLD = `[...(${FST_TREE}?.querySelectorAll("div.cursor-pointer") ?? [])].find((d) => /^\\d+ (done|reviews?)/.test(d.textContent.trim()))`;
const FST_LEAD_ROW = `(() => {
    const name = [...(${FST_TREE}?.querySelectorAll("div") ?? [])].find(
        (d) => d.children.length === 0 && d.textContent.trim() === ${JSON.stringify(FST_LEAD)}
    );
    return name ? name.closest(".cursor-pointer") : null;
})()`;
// the Agent surface: the tree's row and slot, the stage's pane, and in the details rail the lead's block or the
// stage's own section
const FST_AGENT = `(() => {
    ${FST_LIB}
    const tree = ${FST_TREE};
    const rail = ${FST_RAIL};
    const pane = ${FST_PANE};
    const stage = rail?.querySelector("[data-final-rail]");
    const slot = tree?.querySelector("[data-final-slot]");
    const status = [...(rail?.querySelectorAll("span.font-semibold") ?? [])].find((s) => flat(s) === "Verifying");
    const fold = ${FST_FOLD};
    return {
        rows: [...(tree?.querySelectorAll("[data-final-row]") ?? [])].map((r) => ({
            tone: r.getAttribute("data-final-tone"),
            title: flat(r.querySelector(".truncate")),
            sub: flat(r.querySelector(".font-mono")),
            selected: r.classList.contains("bg-accentbg"),
        })),
        slot: slot?.getAttribute("data-final-slot") ?? null,
        strip: slot?.parentElement?.getAttribute("aria-label") ?? null,
        fold: fold ? flat(fold) : null,
        pane: pane
            ? {
                  text: flat(pane),
                  steps: stepsOf(pane),
                  output: outputOf(pane),
                  end: pane.querySelector("[data-final-end]") != null,
                  form: pane.querySelector("[data-run-sheet-end-final]") != null,
                  past: pastOf(pane),
                  shots: shotsOf(pane),
              }
            : null,
        railSteps: rail?.querySelectorAll("[data-final-step]").length ?? 0,
        stage: stage ? { text: flat(stage), steps: stepsOf(stage), past: pastOf(stage), shots: shotsOf(stage) } : null,
        status: status ? flat(status.parentElement) : null,
        viewer: document.querySelector("[data-final-shots-viewer]") != null,
    };
})()`;
// the DAG modal: the final node, the edges into it, the stage line, and the node's bottom rail
const FST_DAG = `(() => {
    ${FST_LIB}
    const modal = ${FST_MODAL};
    if (!modal) return null;
    const card = ${FST_NODE};
    const rail = ${FST_DAG_RAIL};
    const route = [...modal.querySelectorAll("span")].find((s) => s.textContent.trim().startsWith("Run route ·"));
    return {
        cards: [...modal.querySelectorAll("[data-dag-node]")].map((c) => c.getAttribute("data-dag-node")),
        edges: [...modal.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-id") ?? "").sort(),
        stageLine: route ? flat(route.parentElement) : null,
        node: card
            ? {
                  pressed: card.getAttribute("aria-pressed"),
                  meta: flat(card.querySelector(":scope > span:not([role])")),
                  under: flat(card.parentElement?.querySelector(":scope > span")),
                  strip: stepsOf(card).map((s) => s.state),
              }
            : null,
        rail: rail
            ? {
                  text: flat(rail),
                  steps: stepsOf(rail),
                  output: outputOf(rail),
                  end: rail.querySelector("[data-final-end]") != null,
                  past: pastOf(rail),
                  shots: shotsOf(rail),
                  open: [...rail.querySelectorAll("button")].some((b) => /open in agent/i.test(b.textContent)),
              }
            : null,
        viewer: document.querySelector("[data-final-shots-viewer]") != null,
    };
})()`;

// reads expr until ok holds or the wait runs out, and returns the last read either way. nudge runs every 2s:
// an event published before the run's history loaded is replaced by that load, so it is published again
async function fstUntil(h, expr, ok, { ms = FST_WAIT_MS, nudge } = {}) {
    for (let i = 0; ; i++) {
        const s = await h.ev(expr).catch(() => null);
        if (fstHolds(() => ok(s)) || i * 250 >= ms) return s;
        if (nudge && i % 8 === 7) await nudge();
        await polishNap(250);
    }
}

async function fstAgent(h, ok, opts) {
    if ((await h.activeSurfaceLabel()) !== SURFACE_LABEL.agent) await h.goto("agent");
    return fstUntil(h, FST_AGENT, ok, opts);
}

// the run's graph with the final node selected: the modal belongs to the run's sheet on the Jarvis surface
async function fstDag(h, ctx, ok, opts) {
    if (!(await h.ev(`${FST_MODAL} != null`))) {
        await h.goto("jarvis");
        await polishWaitFor(h, `typeof window.__openAddress === "function"`, 5000);
        await h.ev(`window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)})`);
        const openDag = fstButton(FST_SHEET, "Open DAG");
        await polishWaitFor(h, `!!${openDag}`, 10_000);
        // a modal the last visit left open comes back with the surface
        if (!(await h.ev(`${FST_MODAL} != null`))) await finalShotsClick(h, openDag);
    }
    await polishWaitFor(h, `!!${FST_NODE}`, 10_000);
    await h.ev(`(() => {
        const card = ${FST_NODE};
        if (card && card.getAttribute("aria-pressed") !== "true") card.click();
    })()`);
    return fstUntil(h, FST_DAG, (d) => d.node.pressed === "true" && d.rail != null && ok(d), opts);
}

// A run's events cannot be written through an RPC. The page appends every run:event it receives to that run's
// list, so a published one stands for the engine's until the next reload.
async function fstPublishSteps(h, ctx, round, steps) {
    const ts = Date.now();
    for (const [step, [ms, ok]] of Object.entries(steps)) {
        const event = {
            id: `fst-${round}-${step}`,
            runid: ctx.runId,
            channelid: ctx.channelId,
            ts,
            kind: "final-step",
            detail: JSON.stringify({ round, step, ms, ok }),
        };
        await h.rpc("eventpublish", {
            event: "run:event",
            scopes: [`run:${ctx.runId}`],
            data: { channelid: ctx.channelId, runid: ctx.runId, event },
        });
    }
}

const fstStagePrint = (f) =>
    f == null
        ? null
        : [f.state ?? "", f.round ?? 0, f.step ?? "", f.verifierrunid ?? "", (f.unverified ?? []).length, (f.detail ?? "").length, (f.shots ?? []).length];
const fstSeedPrint = (dag) =>
    JSON.stringify([dag?.check ?? "", dag?.verify ?? "", dag?.finalcmd ?? "", fstStagePrint(dag?.final), (dag?.pastfinals ?? []).map(fstStagePrint)]);
// what Part A's seed must keep: the engine owns the dag's status and its final from the first tick on
const fstLivePrint = (dag) =>
    JSON.stringify([dag?.verify ?? "", dag?.finalcmd ?? "", (dag?.tasks ?? []).map((t) => [t.state, t.merged === true])]);

// one States row: the dag's commands, its final and past finals, and the round's step events
function fstStage(ctx, name, { verifier = true, skip } = {}) {
    const now = Date.now();
    const five = { check: FST_CHECK, verify: FST_VERIFY, finalcmd: FINAL_SHOTS_CMD };
    // where the engine would have made the stage's tree; nothing is there
    const tree = { tree: `${ctx.cwd.replace(/\\/g, "/")}/.waveterm/worktrees/${ctx.runId}-final`, commit: FST_COMMIT };
    const round1 = { ...ctx.shotsRound1, detail: FST_DETAIL, ...tree };
    const past = [round1];
    const ok = (steps) => Object.fromEntries(steps.map((s) => [s, [FST_STEP_MS[s], true]]));
    const commands = ["tree", "check", "verify", "final"].filter((s) => s !== skip);
    const judged = { round: 2, verifierrunid: ctx.verifierRunId, startedts: ctx.verifierStart, ...tree };
    switch (name) {
        case "waiting":
            return { cmds: five };
        case "tree":
            return {
                cmds: five,
                final: { state: "checking", round: 1, step: "tree", stepts: now - 22_000, startedts: now - 22_000 },
            };
        case "alongside":
            return {
                cmds: { check: FST_CHECK, verify: FST_VERIFY },
                final: {
                    state: "checking",
                    round: 1,
                    step: "check",
                    stepts: now - 11_000,
                    startedts: now - 9_000,
                    verifierrunid: ctx.verifierRunId,
                    ...tree,
                },
                events: [1, ok(["tree"])],
            };
        case "reviewing":
            return {
                cmds: five,
                final: {
                    state: "verifying",
                    round: 2,
                    startedts: now - 242_000,
                    ...(verifier ? { verifierrunid: ctx.verifierRunId } : {}),
                    ...tree,
                },
                pastfinals: past,
                events: [2, ok(commands)],
            };
        case "failed":
            return { cmds: five, final: round1, events: [1, { ...ok(["tree", "check", "verify"]), final: [125_000, false] }] };
        case "fixing":
            return { cmds: five, final: { state: "", round: 2 }, pastfinals: past };
        case "unverified":
            return {
                cmds: five,
                final: { state: "unverified", unverified: [FST_UNVERIFIED], ...judged },
                pastfinals: past,
                events: [2, ok(commands)],
            };
        case "passed":
            return { cmds: five, final: { state: "passed", ...judged }, pastfinals: past, events: [2, ok(commands)] };
    }
    throw new Error(`no final-stage row named ${name}`);
}

// seeds a States row and publishes its events; returns the publish, for fstUntil to repeat
async function fstShow(h, ctx, name, opts) {
    const { cmds, final, pastfinals, events } = fstStage(ctx, name, opts);
    await seedDag(
        h,
        ctx,
        (dag) => {
            const { final: _final, pastfinals: _past, check: _check, verify: _verify, finalcmd: _cmd, ...rest } = dag;
            return { ...rest, ...cmds, ...(final ? { final } : {}), ...(pastfinals ? { pastfinals } : {}) };
        },
        fstSeedPrint
    );
    const publish = events ? () => fstPublishSteps(h, ctx, ...events) : undefined;
    if (publish) await publish();
    return { nudge: publish };
}

// object.UpdateObject publishes nothing, so the stored run is sent to the page as the update it would have been
async function fstWriteRun(h, runId, change) {
    const oref = `run:${runId}`;
    const next = { ...change(await waveService(h, "object", "GetObject", [oref])), otype: "run" };
    await waveService(h, "object", "UpdateObject", [next, false], FINAL_SHOTS_UICTX);
    const stored = await waveService(h, "object", "GetObject", [oref]);
    await h.rpc("eventpublish", {
        event: "waveobj:update",
        scopes: [oref],
        data: { updatetype: "update", otype: "run", oid: runId, obj: { ...stored, otype: "run" } },
    });
    return stored;
}

function fstGitInit(cwd) {
    const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.name", "verify");
    git("config", "user.email", "verify@example.invalid");
    git("config", "commit.gpgsign", "false");
    // the engine's trees live under the project only in the legacy layout, used when there is no user cache dir
    writeFileSync(join(cwd, ".gitignore"), ".waveterm/\n");
    writeFileSync(join(cwd, "README.md"), "final-stage fixture\n");
    git("add", ".");
    git("commit", "-q", "-m", "final-stage fixture");
}

// The roster is read once at boot: the lead alone, or with the tab of the verifier's session. Reloads onto it,
// which also drops every event published to the page, and focuses the lead, whose rail reads the run's events.
async function fstBoot(h, ctx, withVerifier) {
    const roster = treeRailRoster(ctx.runId, Date.now(), FST_LEAD).filter((a) => a.id === TREE_RAIL_LEAD_ID);
    if (withVerifier) {
        roster.push({
            id: FST_VERIFIER_ID,
            name: FST_VERIFIER,
            project: "waveterm",
            task: "judge the merged result",
            state: "working",
            agent: "claude",
            model: "opus",
            activeMs: 60_000,
            runId: ctx.verifierRunId,
            blockId: "fx-blk-final-verifier",
        });
    }
    writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(roster, null, 2));
    await h.ev("location.reload()");
    await polishWaitFor(h, `!!document.querySelector("nav button")`, 30_000);
    await h.cdp("Emulation.setDeviceMetricsOverride", FST_VIEWPORT);
    await h.goto("agent");
    return fstFocusLead(h);
}

async function fstFocusLead(h) {
    if (!(await polishWaitFor(h, `!!${FST_LEAD_ROW}`, 15_000))) return false;
    await finalShotsClick(h, FST_LEAD_ROW);
    return polishWaitFor(h, `[...(${FST_RAIL}?.querySelectorAll("h3") ?? [])].some((el) => el.textContent.trim() === "Run")`, 15_000);
}

// Part A's seed: every task done and merged with no child run to derive a state from, a Final command so no
// verifier is tended while the commands run, and no final at all, so the next tick starts round 1 itself.
// Waits for what that tick does: the Tree step, then Verify with its three opening lines published.
async function fstStartLive(h, ctx) {
    await seedDag(
        h,
        ctx,
        (dag) => {
            const { final: _final, pastfinals: _past, check: _check, setup: _setup, ...rest } = dag;
            return {
                ...rest,
                status: "finalizing",
                verify: FST_LIVE_VERIFY,
                finalcmd: FST_LIVE_FINAL,
                tasks: dag.tasks.map(({ runid: _run, reviewrunid: _review, ...t }) => ({ ...t, state: "done", merged: true })),
            };
        },
        fstLivePrint
    );
    const start = Date.now();
    let group = null;
    while (Date.now() - start < FST_ENGINE_WAIT_MS) {
        group = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
        if (group?.final?.step === "verify" && (group.final.output ?? "").includes(`${FST_MARK} 3`)) break;
        await polishNap(500);
    }
    const f = group?.final;
    return {
        status: group?.status,
        state: f?.state,
        step: f?.step,
        tree: f?.tree ?? "",
        verifierrunid: f?.verifierrunid ?? "",
        output: f?.output ?? "",
        waitedMs: Date.now() - start,
    };
}

async function arrangeFinalStage(h, ctx) {
    await h.cdp("Emulation.setDeviceMetricsOverride", FST_VIEWPORT);
    // before the run exists, as final-shots does: the captures walk every surface
    writeFinalShotsFixture(ctx.out, await captureFinalShotsFixture(h));
    ctx.shotsRound1 = finalShotsStages(ctx.out).fixing.pastfinals[0];
    fstGitInit(ctx.cwd);
    await arrangeFixtureRun(h, ctx, "final-stage", FST_LEAD);
    await h.rpc("dagsubmit", {
        channelid: ctx.channelId,
        runid: ctx.runId,
        title: "verify final-stage",
        parallelism: 1,
        tasks: FST_TASKS,
    });
    // a seed written while t-1 is still being dispatched would be overwritten by that tick
    await waitForDispatch(h, ctx, "t-1");
    ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.oid;
    if (!ctx.dagId) throw new Error("the run has no dag");
    // the verifier's session is seeded, never spawned: a deferred quick run that carries the stage's role
    const wslist = await h.rpc("workspacelist", null);
    const created = await h.rpc("createrun", {
        channelid: ctx.channelId,
        workspaceid: wslist[0].workspacedata.oid,
        goal: "verify final-stage: the verifier's seeded run",
        runtime: "claude",
        mode: "quick",
        deferstart: true,
    });
    ctx.verifierRunId = created.run.id;
    ctx.verifierStart = Date.now() - 20 * 60_000;
    const verifierRun = await fstWriteRun(h, ctx.verifierRunId, (run) => ({ ...run, stagerole: "verifier", dagoref: ctx.dagId }));
    ctx.verifierSeeded = verifierRun?.stagerole === "verifier" && verifierRun.dagoref === ctx.dagId && !verifierRun.completedts;
    await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
    await fstShow(h, ctx, "waiting");
    ctx.leadFocused = await fstBoot(h, ctx, false);
}

const finalStageScenario = {
    name: "final-stage",
    surface: "agent",
    async arrange(h) {
        const ctx = {
            out: mkdtempSync(join(tmpdir(), "verify-final-stage-out-")),
            cwd: mkdtempSync(join(tmpdir(), "verify-final-stage-")),
            prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`),
        };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await arrangeFinalStage(h, ctx);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: fstHolds(ok), detail: JSON.stringify(detail) });
        const shot = (name) => h.shot(`cdp-shots/final-stage-${name}.png`);
        const clickRow = () => finalShotsClick(h, FST_ROW);
        const closeViewer = async () => {
            await finalShotsClick(h, `document.querySelector("[data-final-shots-viewer]")?.querySelector('button[aria-label="Close"]')`);
            await polishWaitFor(h, `document.querySelector("[data-final-shots-viewer]") == null`, 3000);
        };
        rec(
            "0. a git project's run with a dispatched t-1, a seeded verifier run, and the lead focused with its rail open",
            () => ctx.arrangeError == null && ctx.dispatched && ctx.verifierSeeded && ctx.leadFocused,
            ctx.arrangeError ?? {
                runId: ctx.runId,
                dagId: ctx.dagId,
                verifierRunId: ctx.verifierRunId,
                dispatched: ctx.dispatched,
                dispatchMs: ctx.dispatchMs,
                verifierSeeded: ctx.verifierSeeded,
                leadFocused: ctx.leadFocused,
            }
        );
        if (ctx.arrangeError != null) return steps;
        const wtRoot = arcWorktreeRoot();
        rec(
            "0b. the run's landing tree is under the user cache dir's arc-wt root, named by its run id's first 8 chars (or the whole id), not in the temp dir",
            () =>
                !!ctx.landPath &&
                existsSync(ctx.landPath) &&
                [ctx.runId.slice(0, 8), ctx.runId].includes(relative(wtRoot, ctx.landPath)),
            { landPath: ctx.landPath, root: wtRoot, cwd: ctx.cwd }
        );

        // --- Part B: the States rows, on a dag the engine leaves alone ---
        let a = await fstAgent(h, (s) => s.rows.length === 0 && s.railSteps === 0);
        let d = await fstDag(h, ctx, (s) => s.node.meta === "waits on every task");
        rec(
            "B1. tasks still running: no tree row and no slot; the last node reads waits on every task over five waiting segments",
            () =>
                a.rows.length === 0 &&
                a.slot == null &&
                d.cards[d.cards.length - 1] === "final" &&
                d.node.meta === "waits on every task" &&
                d.node.under === "on the merged result" &&
                fstSame(d.node.strip, fstRepeat("waiting", 5)),
            { rows: a?.rows, slot: a?.slot, cards: d?.cards, node: d?.node }
        );
        await shot("b1-waiting-dag");

        await fstShow(h, ctx, "tree");
        a = await fstAgent(h, (s) => s.rows.length === 1 && s.rows[0].sub.startsWith("Tree"));
        await clickRow();
        a = await fstUntil(h, FST_AGENT, (s) => s.rows[0].selected && s.pane != null && s.stage != null);
        await shot("b2-tree-pane");
        d = await fstDag(h, ctx, (s) => s.node.meta.startsWith("round 1 · Tree"));
        rec(
            "B2. preparing the tree: Tree · <time> · step 1 of 5, the step list with Tree running, no output box, and End final stage",
            () =>
                a.rows.length === 1 &&
                a.rows[0].title === "Final verification" &&
                /^Tree · \d+s · step 1 of 5$/.test(a.rows[0].sub) &&
                a.rows[0].tone === "run" &&
                a.slot === "run" &&
                fstSame(fstStates(a.pane.steps), ["running", ...fstRepeat("waiting", 4)]) &&
                a.pane.output == null &&
                a.pane.end &&
                fstSame(fstStates(a.stage.steps), ["running", ...fstRepeat("waiting", 4)]) &&
                /^round 1 · Tree · \d+s$/.test(d.node.meta) &&
                fstSame(d.node.strip, ["running", ...fstRepeat("waiting", 4)]) &&
                d.rail.output == null &&
                d.rail.steps[0].command === "prepares the tree the stage runs in" &&
                d.rail.steps[1].command === FST_CHECK,
            { row: a?.rows, slot: a?.slot, pane: a?.pane, node: d?.node, rail: d?.rail?.steps }
        );
        await shot("b2-tree-dag");

        let wait = await fstShow(h, ctx, "alongside");
        a = await fstAgent(h, (s) => s.rows[0].sub.startsWith("Check") && s.pane.steps[0].text === "passed 22s", wait);
        await shot("b3-alongside-pane");
        d = await fstDag(h, ctx, (s) => s.node.meta === "round 1 · Check · verifier");
        rec(
            "B3. verifier alongside (no Final command): four steps, the Verifier running beside Check, Tree's time from its event",
            () =>
                /^Check · \d+s · verifier alongside$/.test(a.rows[0].sub) &&
                a.rows[0].tone === "run" &&
                fstSame(fstStates(a.pane.steps), ["passed", "running", "waiting", "running"]) &&
                fstSame(a.pane.steps.map((s) => s.key), ["tree", "check", "verify", "verifier"]) &&
                a.pane.steps[0].text === "passed 22s" &&
                d.node.meta === "round 1 · Check · verifier" &&
                fstSame(d.node.strip, ["passed", "running", "waiting", "running"]),
            { row: a?.rows, pane: a?.pane?.steps, node: d?.node }
        );
        await shot("b3-alongside-dag");

        wait = await fstShow(h, ctx, "reviewing");
        a = await fstAgent(h, (s) => s.rows[0].sub.startsWith("verifier reviewing") && s.pane.steps[3].state === "passed", wait);
        await shot("b4-reviewing-pane");
        d = await fstDag(h, ctx, (s) => s.node.meta.startsWith("round 2 · verifier"));
        rec(
            "B4. verifier reviewing with its tab gone: the row is the stage's own, every command passed, the Verifier running, round 1 one line",
            () =>
                a.rows.length === 1 &&
                a.rows[0].selected &&
                a.pane != null &&
                /^verifier reviewing · 4m \d\ds$/.test(a.rows[0].sub) &&
                fstSame(fstStates(a.pane.steps), [...fstRepeat("passed", 4), "running"]) &&
                a.pane.output == null &&
                fstSame(a.stage.past, [{ round: "1", text: "round 1 · failed at Final" }]) &&
                /^round 2 · verifier · 4m \d\ds$/.test(d.node.meta) &&
                fstSame(d.node.strip, [...fstRepeat("passed", 4), "running"]) &&
                d.rail.open === false,
            { row: a?.rows, pane: a?.pane?.steps, past: a?.stage?.past, node: d?.node, open: d?.rail?.open }
        );
        await shot("b4-reviewing-dag");

        wait = await fstShow(h, ctx, "failed");
        a = await fstAgent(h, (s) => s.rows[0].tone === "fail" && s.pane.steps[3].state === "failed", wait);
        await shot("b5-failed-pane");
        await finalShotsClick(h, `${FST_PANE}?.querySelector("[data-final-shots-link]")`);
        const paneViewer = (await fstUntil(h, FST_AGENT, (s) => s.viewer))?.viewer;
        await closeViewer();
        d = await fstDag(h, ctx, (s) => s.node.meta === "round 1 · failed at Final");
        await shot("b5-failed-dag");
        await finalShotsClick(h, `${FST_DAG_RAIL}?.querySelector("[data-final-shots-link]")`);
        const railViewer = (await fstUntil(h, FST_DAG, (s) => s.viewer))?.viewer;
        await shot("b5-failed-viewer");
        await closeViewer();
        rec(
            "B5. failed at Final in round 1: the detail whole, the Verifier not run, the lead has it, and the screenshots open the viewer from the pane and the DAG rail",
            () =>
                a.rows[0].sub === "failed at Final · round 1" &&
                a.rows[0].tone === "fail" &&
                a.slot === "fail" &&
                fstSame(fstStates(a.pane.steps), [...fstRepeat("passed", 3), "failed", "notrun"]) &&
                a.pane.text.includes(fstFlat(FST_DETAIL)) &&
                a.pane.text.includes("The lead has this failure") &&
                !a.pane.end &&
                a.pane.shots != null &&
                paneViewer &&
                d.node.meta === "round 1 · failed at Final" &&
                fstSame(d.node.strip, [...fstRepeat("passed", 3), "failed", "notrun"]) &&
                d.rail.text.includes(fstFlat(FST_DETAIL)) &&
                d.rail.shots != null &&
                railViewer,
            { row: a?.rows, slot: a?.slot, pane: a?.pane, paneViewer, node: d?.node, rail: d?.rail, railViewer }
        );

        await fstShow(h, ctx, "fixing");
        a = await fstAgent(h, (s) => s.rows[0].sub.startsWith("round 2") && s.rows[0].tone === "wait");
        await shot("b6-fixing-pane");
        d = await fstDag(h, ctx, (s) => s.node.meta.startsWith("round 2 waits on"));
        rec(
            "B6. fix round under way: round 2 waits on the unfinished tasks, every step waiting, round 1 one past-round line",
            () =>
                a.rows[0].sub === "round 2 after 3 fix tasks" &&
                a.rows[0].tone === "wait" &&
                fstSame(fstStates(a.pane.steps), fstRepeat("waiting", 5)) &&
                fstSame(a.stage.past, [{ round: "1", text: "round 1 · failed at Final" }]) &&
                d.node.meta === "round 2 waits on t-1, t-2, t-3" &&
                fstSame(d.node.strip, fstRepeat("waiting", 5)) &&
                fstSame(d.rail.past, [{ round: "1", text: "round 1 · failed at Final" }]),
            { row: a?.rows, pane: a?.pane, past: a?.stage?.past, node: d?.node, rail: d?.rail }
        );
        await shot("b6-fixing-dag");

        // the verifier's tab joins the roster. Until the stage names its run, that tab is a stage row an earlier
        // round left, and the stage's row is its own
        await fstShow(h, ctx, "reviewing", { verifier: false });
        const rebooted = await fstBoot(h, ctx, true);
        await fstAgent(h, (s) => s.rows.length === 1);
        await clickRow();
        const own = await fstUntil(h, FST_AGENT, (s) => s.rows[0].selected && s.pane != null);
        wait = await fstShow(h, ctx, "reviewing");
        // the stage's own row leaves through the tree's exit animation, so one row is waited for, not read at once
        a = await fstUntil(h, FST_AGENT, (s) => s.pane == null && s.rows.length === 1 && s.rows[0].selected && s.stage.steps[3].state === "passed", wait);
        rec(
            "B7a. the row becomes the verifier's session: a focus on the stage's own row moves to the agent, one row, its rail keeps the step list",
            () =>
                rebooted &&
                own.rows.length === 1 &&
                own.rows[0].selected &&
                own.pane != null &&
                a.rows.length === 1 &&
                a.rows[0].selected &&
                a.pane == null &&
                a.rows[0].sub.startsWith("verifier reviewing") &&
                fstSame(fstStates(a.stage.steps), [...fstRepeat("passed", 4), "running"]),
            { rebooted, own: { rows: own?.rows, pane: own?.pane != null }, rows: a?.rows, pane: a?.pane != null, stage: a?.stage }
        );
        await shot("b7-session-agent");
        // away from the row, so landing on it is the Enter's doing
        await fstFocusLead(h);
        const away = await fstUntil(h, FST_AGENT, (s) => s.rows[0].selected === false);
        d = await fstDag(h, ctx, (s) => s.rail.open === true);
        await shot("b7-session-dag");
        const entered = await h.ev(`(() => {
            const node = ${FST_NODE}?.closest(".react-flow__node");
            if (!node) return false;
            // Enter on a focused button is the button's own
            node.focus({ preventScroll: true });
            const init = { key: "Enter", code: "Enter", bubbles: true, cancelable: true };
            (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", init));
            return true;
        })()`);
        const landed = await fstUntil(
            h,
            `({ modal: ${FST_MODAL} != null, agent: ${FST_AGENT} })`,
            (s) => !s.modal && s.agent.rows[0].selected
        );
        const onAgent = await h.activeSurfaceLabel();
        rec(
            "B7b. the final node's rail has Open in Agent, and Enter on the node lands on the Agent surface with the verifier's session focused",
            () =>
                away.rows[0].selected === false &&
                d.rail.open === true &&
                entered &&
                !landed.modal &&
                onAgent === SURFACE_LABEL.agent &&
                landed.agent.rows.length === 1 &&
                landed.agent.rows[0].selected &&
                landed.agent.pane == null,
            { away: away?.rows, open: d?.rail?.open, entered, onAgent, modal: landed?.modal, rows: landed?.agent?.rows }
        );

        // the verifier gave its verdict: its run is over
        await fstWriteRun(h, ctx.verifierRunId, (run) => ({ ...run, completedts: ctx.verifierStart + FST_VERIFIER_MS }));
        wait = await fstShow(h, ctx, "unverified");
        a = await fstAgent(h, (s) => s.rows[0].tone === "warn" && s.stage.steps[4].state === "unverified", wait);
        await shot("b8-unverified-agent");
        d = await fstDag(h, ctx, (s) => s.node.meta === "round 2 · unverified");
        rec(
            "B8. unverified in round 2 on the verifier's verdict: unverified · 1 reason, the reason whole, the Verifier unverified, round 1 one line",
            () =>
                a.rows.length === 1 &&
                a.rows[0].sub === "unverified · 1 reason" &&
                a.rows[0].tone === "warn" &&
                a.slot === "warn" &&
                fstSame(fstStates(a.stage.steps), [...fstRepeat("passed", 4), "unverified"]) &&
                d.node.meta === "round 2 · unverified" &&
                fstSame(d.node.strip, [...fstRepeat("passed", 4), "unverified"]) &&
                d.rail.text.includes(FST_UNVERIFIED) &&
                !d.rail.end &&
                fstSame(d.rail.past, [{ round: "1", text: "round 1 · failed at Final" }]),
            { row: a?.rows, slot: a?.slot, stage: a?.stage, node: d?.node, rail: d?.rail }
        );
        await shot("b8-unverified-dag");

        wait = await fstShow(h, ctx, "passed");
        await h.goto("agent");
        // off the row, or the fold stays open under the reader
        await fstFocusLead(h);
        const folded = await fstUntil(h, FST_AGENT, (s) => s.rows.length === 0 && s.fold != null);
        await shot("b9-passed-folded");
        await finalShotsClick(h, FST_FOLD);
        await fstUntil(h, FST_AGENT, (s) => s.rows.length === 1);
        await clickRow();
        a = await fstUntil(h, FST_AGENT, (s) => s.rows[0].sub === `passed · ${FST_TOTAL}` && s.stage != null, wait);
        await shot("b9-passed-agent");
        d = await fstDag(h, ctx, (s) => s.node.meta === `round 2 · passed · ${FST_TOTAL}`);
        rec(
            "B9. passed in round 2: the row is inside the run's finished group, every step shows its time, and the row and the node show the total",
            () =>
                folded.rows.length === 0 &&
                /review/.test(folded.fold) &&
                a.rows.length === 1 &&
                a.rows[0].sub === `passed · ${FST_TOTAL}` &&
                a.rows[0].tone === "pass" &&
                a.slot === "pass" &&
                fstSame(a.stage.steps.map((s) => s.text), FST_STEP_TEXT) &&
                d.node.meta === `round 2 · passed · ${FST_TOTAL}` &&
                fstSame(d.node.strip, fstRepeat("passed", 5)) &&
                fstSame(d.rail.steps.map((s) => s.text), FST_STEP_TEXT),
            { folded: { rows: folded?.rows, fold: folded?.fold }, row: a?.rows, slot: a?.slot, stage: a?.stage, node: d?.node, rail: d?.rail?.steps }
        );
        await shot("b9-passed-dag");

        // a reload drops the published events; without Check's the stage has no total, and every state stands
        const reloaded = await fstBoot(h, ctx, true);
        wait = await fstShow(h, ctx, "passed", { skip: "check" });
        if (await h.ev(`${FST_ROW} == null && ${FST_FOLD} != null`)) await finalShotsClick(h, FST_FOLD);
        await fstUntil(h, FST_AGENT, (s) => s.rows.length === 1);
        await clickRow();
        a = await fstUntil(h, FST_AGENT, (s) => s.rows[0].sub === "passed" && s.stage.steps[0].text === "passed 22s", wait);
        await shot("b10-no-total-agent");
        d = await fstDag(h, ctx, (s) => s.node.meta === "round 2 · passed");
        rec(
            "B10. with one step's event gone: the total leaves the row and the node, that step shows no time, and every state stays passed",
            () =>
                reloaded &&
                a.rows[0].sub === "passed" &&
                a.rows[0].tone === "pass" &&
                fstSame(fstStates(a.stage.steps), fstRepeat("passed", 5)) &&
                fstSame(a.stage.steps.map((s) => s.text), FST_STEP_TEXT.map((t, i) => (i === 1 ? "passed" : t))) &&
                d.node.meta === "round 2 · passed" &&
                fstSame(d.node.strip, fstRepeat("passed", 5)),
            { reloaded, row: a?.rows, stage: a?.stage, node: d?.node }
        );
        await shot("b10-no-total-dag");

        // --- Part A: a dag really finalizing, run by the engine ---
        const live = await fstStartLive(h, ctx);
        const liveBoot = await fstBoot(h, ctx, false);
        rec(
            "A0. the engine started round 1 on the seeded dag: Verify running with output, no tree on the stage and no verifier",
            () =>
                liveBoot &&
                live.status === "finalizing" &&
                live.state === "checking" &&
                live.step === "verify" &&
                live.output.includes(`${FST_MARK} 3`) &&
                live.tree === "" &&
                live.verifierrunid === "",
            { liveBoot, ...live }
        );
        a = await fstAgent(h, (s) => s.rows.length === 1 && /step 2 of 4$/.test(s.rows[0].sub) && s.status != null, {
            ms: 20_000,
        });
        rec(
            "A1. the tree has one Final verification row naming the running step, and the run's strip has its final slot",
            () =>
                a.rows.length === 1 &&
                a.rows[0].title === "Final verification" &&
                /^Verify · \S.* · step 2 of 4$/.test(a.rows[0].sub) &&
                a.rows[0].tone === "run" &&
                a.slot === "run" &&
                /final verification/i.test(a.strip),
            { rows: a?.rows, slot: a?.slot, strip: a?.strip }
        );
        rec(
            "A2. the lead's rail draws no step of the stage, the tree's row carries it, and the Run status reads Verifying",
            () =>
                a.railSteps === 0 &&
                a.status.startsWith("Verifying") &&
                a.status.includes("next Final, then the verifier"),
            { railSteps: a?.railSteps, status: a?.status }
        );
        await shot("a1-row-and-lead-rail");

        // the form the run sheet shares with the pane, opened where it always was and left without ending
        await h.goto("jarvis");
        await polishWaitFor(h, `typeof window.__openAddress === "function"`, 5000);
        await h.ev(`window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)})`);
        const sheetEnd = fstButton(FST_SHEET, "End final stage");
        await polishWaitFor(h, `!!${sheetEnd}`, 10_000);
        await finalShotsClick(h, sheetEnd);
        const sheetFormExpr = `(() => {
            const form = ${FST_SHEET}?.querySelector("[data-run-sheet-end-final]");
            return form
                ? {
                      reason: form.querySelector("textarea") != null,
                      buttons: [...form.querySelectorAll("button")].map((b) => b.textContent.trim()),
                  }
                : null;
        })()`;
        const sheetForm = await fstUntil(h, sheetFormExpr, (s) => s.reason);
        await shot("a3-run-sheet-end-form");
        await finalShotsClick(h, fstButton(`${FST_SHEET}?.querySelector("[data-run-sheet-end-final]")`, "Keep running"));
        const sheetClosed = await polishWaitFor(h, `${FST_SHEET} != null && ${sheetFormExpr} == null`, 5000);
        const stillRunning = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.final?.state;
        rec(
            "A3. the run sheet's End final stage opens the shared form with its reason box and both outcomes, and Keep running closes it",
            () =>
                sheetForm.reason &&
                fstSame(sheetForm.buttons, ["Pass unverified", "Fail", "Keep running"]) &&
                sheetClosed &&
                stillRunning === "checking",
            { sheetForm, sheetClosed, stillRunning }
        );

        await h.goto("agent");
        await finalShotsClick(h, `${FST_TREE}?.querySelector("[data-final-row]")`);
        a = await fstUntil(h, FST_AGENT, (s) => s.rows[0].selected && s.pane.output != null && s.stage != null);
        rec(
            "A4. clicking the tree's row focuses it: the pipeline, the running command and its output, the stage's facts and step list once, and End final stage",
            () =>
                a.rows[0].selected &&
                a.railSteps === a.stage.steps.length &&
                fstSame(fstStates(a.pane.steps), ["passed", "running", "waiting", "waiting"]) &&
                a.pane.text.includes(`$ ${FST_LIVE_VERIFY}`) &&
                a.pane.output.includes(`${FST_MARK} 3`) &&
                a.pane.end &&
                fstSame(fstStates(a.stage.steps), ["passed", "running", "waiting", "waiting"]) &&
                ["Commit", "Tree", "Reviewers"].every((fact) => a.stage.text.includes(fact)) &&
                !a.stage.text.includes("Round"),
            { rows: a?.rows, pane: a?.pane, stage: a?.stage, railSteps: a?.railSteps }
        );
        await shot("a4-pane");

        d = await fstDag(h, ctx, (s) => s.rail.output != null);
        rec(
            "A5. the DAG's last node is the final stage, with an edge from each sink task, and the stage line has no final verify entry",
            () =>
                d.cards[d.cards.length - 1] === "final" &&
                fstSame(d.edges.filter((e) => e.endsWith(">final")), FST_SINK_EDGES) &&
                /^round 1 · Verify · /.test(d.node.meta) &&
                fstSame(d.node.strip, ["passed", "running", "waiting", "waiting"]) &&
                d.stageLine.startsWith("Run route ·") &&
                !/final verify/i.test(d.stageLine),
            { cards: d?.cards, edges: d?.edges, node: d?.node, stageLine: d?.stageLine }
        );
        rec(
            "A6. selecting the node opens its rail: each step's command and state, the output tail and End final stage",
            () =>
                d.node.pressed === "true" &&
                fstSame(d.rail.steps.map((s) => s.command), [
                    "prepares the tree the stage runs in",
                    FST_LIVE_VERIFY,
                    FST_LIVE_FINAL,
                    "judges the merged result",
                ]) &&
                fstSame(fstStates(d.rail.steps), ["passed", "running", "waiting", "waiting"]) &&
                d.rail.output.includes(FST_MARK) &&
                d.rail.end,
            { node: d?.node, rail: d?.rail }
        );
        await shot("a6-dag-rail");

        // the rail's minimum height is what keeps the form below End final stage in view; nothing else measures it
        const RAIL_FORM = `document.querySelector("[data-dag-final-rail] [data-run-sheet-end-final]")`;
        await finalShotsClick(h, `document.querySelector("[data-dag-final-rail] [data-final-end]")`);
        await polishWaitFor(h, `${RAIL_FORM} != null`, 3000);
        const railForm = await h.ev(`(() => {
            const form = ${RAIL_FORM};
            if (!form) return null;
            const box = form.parentElement.getBoundingClientRect();
            const clippedBy = [];
            for (let el = form.parentElement.parentElement; el && el !== document.body; el = el.parentElement) {
                const cs = getComputedStyle(el);
                if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
                const r = el.getBoundingClientRect();
                if (box.top < r.top - 0.5 || box.bottom > r.bottom + 0.5 || box.left < r.left - 0.5 || box.right > r.right + 0.5) {
                    clippedBy.push((el.className || el.tagName).toString().slice(0, 60));
                }
            }
            // what sits on the form's bottom corners: the form itself unless something covers or cuts it
            const corner = (x, y) => form.parentElement.contains(document.elementFromPoint(x, y));
            return {
                box: { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) },
                viewport: innerHeight,
                clippedBy,
                corners: corner(box.left + 4, box.bottom - 4) && corner(box.right - 4, box.bottom - 4),
            };
        })()`);
        await shot("a6-dag-rail-end-form");
        await finalShotsClick(h, fstButton(RAIL_FORM, "Keep running"));
        const railFormClosed = await polishWaitFor(h, `${RAIL_FORM} == null`, 3000);
        rec(
            "A6b. End final stage in the DAG rail opens its form whole: no scrolling or clipping ancestor cuts it, nothing covers its bottom, and Keep running closes it",
            () => railForm != null && railForm.clippedBy.length === 0 && railForm.corners && railForm.box.bottom <= railForm.viewport && railFormClosed,
            { railForm, railFormClosed }
        );

        await h.goto("agent");
        await finalShotsClick(h, `${FST_PANE}?.querySelector("[data-final-end]")`);
        const paneForm = (await fstUntil(h, FST_AGENT, (s) => s.pane.form))?.pane?.form;
        const typed = await h.ev(`(() => {
            const box = ${FST_PANE}?.querySelector("[data-run-sheet-end-final] textarea");
            if (!box) return false;
            // a controlled input takes a value only through the native setter and an input event
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(FST_REASON)});
            box.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        })()`);
        const unverifiedBtn = fstButton(`${FST_PANE}?.querySelector("[data-run-sheet-end-final]")`, "Pass unverified");
        await polishWaitFor(h, `${unverifiedBtn}?.disabled === false`, 3000);
        await shot("a7-end-form");
        await finalShotsClick(h, unverifiedBtn);
        a = await fstUntil(h, FST_AGENT, (s) => s.rows[0].tone === "warn" && s.pane.steps[1].state === "stopped", { ms: 20_000 });
        await shot("a7-ended-pane");
        d = await fstDag(h, ctx, (s) => s.node.meta === "round 1 · unverified");
        rec(
            "A7. End final stage, as unverified with a reason: the row, the pane and the node read unverified, the reason is whole, and Verify reads stopped",
            () =>
                paneForm &&
                typed &&
                a.rows.length === 1 &&
                a.rows[0].sub === "unverified · 1 reason" &&
                a.rows[0].tone === "warn" &&
                a.slot === "warn" &&
                fstSame(fstStates(a.pane.steps), ["passed", "stopped", "notrun", "notrun"]) &&
                a.pane.text.includes(`ended by the human: ${FST_REASON}`) &&
                !a.pane.end &&
                d.node.meta === "round 1 · unverified" &&
                fstSame(d.node.strip, ["passed", "stopped", "notrun", "notrun"]) &&
                d.rail.text.includes(`ended by the human: ${FST_REASON}`) &&
                !d.rail.end,
            { paneForm, typed, rows: a?.rows, slot: a?.slot, pane: a?.pane, node: d?.node, rail: d?.rail }
        );
        await shot("a7-ended-dag");
        return steps;
    },
    async teardown(h, ctx) {
        await teardownFixtureRun(h, ctx, "final-stage", {
            what: "cancel the channel's other runs and restore the rail preference",
            fn: async () => {
                try {
                    // the verifier's seeded run, and t-1's child run, which Part A unlinked from its task with its
                    // worker still at work in the lane's tree
                    const runs = ctx.channelId ? await channelRuns(h, ctx.channelId) : [];
                    for (const run of runs) {
                        if (run.id === ctx.runId) {
                            // the engine completed the run when the stage was ended, and a finished run is not cancelled
                            if (run.status === "done") ctx.runId = null;
                        } else if (run.status !== "done" && run.status !== "cancelled") {
                            await h.rpc("cancelrun", { channelid: ctx.channelId, runid: run.id });
                        }
                    }
                } finally {
                    await h.ev(
                        ctx.prevRail == null
                            ? `localStorage.removeItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`
                            : `localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, ${JSON.stringify(ctx.prevRail)})`
                    );
                }
            },
        });
        rmSync(ctx.out, { recursive: true, force: true });
        // a worker that was just stopped holds its lane's tree for a moment, and a tree left behind fails the scenario
        rmSync(ctx.cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
    },
};

// --- brief-initiatives-polish: a staged and a flat initiative, their sidebar and activity ---------
// Two throwaway efforts made over RPC: one staged (with an unstaged tail), one flat whose feed holds a
// note-carrying status change, a bare one, and a long note. Every surface it opens is swept for text
// under MIN_FONT_PX.
const POLISH_STAGED = "verify initiatives polish · staged";
const POLISH_FLAT = "verify initiatives polish · flat";
const POLISH_ADDED = "F4 added by the scenario";
const polishNap = (ms) => new Promise((r) => setTimeout(r, ms));
const polishRow = (title) =>
    `[...document.querySelectorAll('[data-jarvis-brief-row="initiative"]')].find((r) => r.innerText.includes(${JSON.stringify(title)}))`;
const polishDetail = (title) => `${polishRow(title)}?.parentElement?.querySelector('[data-jarvis-initiative-detail="true"]')`;

// every element whose own text is under the floor; svg is drawn, not read
const polishSweep = (rootExpr) => `(() => {
    const root = ${rootExpr};
    if (!root) return null;
    const offenders = [];
    let seen = 0;
    for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el.closest('svg')) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim() !== '');
        if (!own) continue;
        seen++;
        if (parseFloat(getComputedStyle(el).fontSize) < ${MIN_FONT_PX}) {
            const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('').trim();
            offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 80), text: text.slice(0, 40) });
        }
    }
    return { seen, offenders: offenders.slice(0, 5), count: offenders.length };
})()`;
const sweptOk = (s) => s != null && s.seen > 0 && s.count === 0;

async function polishWaitFor(h, expr, ms) {
    for (let waited = 0; waited < ms; waited += 250) {
        if (await h.ev(expr).catch(() => false)) return true;
        await polishNap(250);
    }
    return false;
}

// createproject only writes projects.json; the server's config watcher picks it up a moment later, and a reload
// before then boots a frontend whose project list lacks it until the next config event
async function waitForProjectInConfig(h, name) {
    for (let waited = 0; waited < 10000; waited += 250) {
        const cfg = await h.rpc("getfullconfig", null);
        if (cfg?.projects?.[name] != null) return;
        await polishNap(250);
    }
    throw new Error(`project ${name} never reached the config`);
}

async function polishReload(h) {
    try {
        await h.ev("location.reload()");
    } catch {
        /* the evaluate is cut off by the navigation it just started */
    }
    await polishWaitFor(h, "!!window.TabRpcClient && !!document.querySelector('nav button')", 30000);
    await h.goto("jarvis");
}

const briefInitiativesPolish = {
    name: "brief-initiatives-polish",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { oids: [] };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            const staged = await h.rpc("effortcreate", {
                title: POLISH_STAGED,
                chunks: [{ label: "S1" }, { label: "S2" }, { label: "U1" }],
            });
            ctx.staged = staged.effortoid;
            ctx.oids.push(ctx.staged);
            await h.rpc("effortmutate", {
                effortoid: ctx.staged,
                author: "you",
                ops: [
                    { op: "setChunkStage", chunk: "S1", stage: "Stage one" },
                    { op: "setChunkStage", chunk: "S2", stage: "Stage one" },
                ],
            });
            const flat = await h.rpc("effortcreate", {
                title: POLISH_FLAT,
                chunks: [{ label: "F1" }, { label: "F2" }, { label: "F3" }],
            });
            ctx.flat = flat.effortoid;
            ctx.oids.push(ctx.flat);
            await h.rpc("effortmutate", {
                effortoid: ctx.flat,
                author: "you",
                ops: [
                    {
                        op: "setChunkStatus",
                        chunk: "F1",
                        status: "done",
                        note: "Landed the first slice. The rest waits on review. Nothing else moved.",
                    },
                    { op: "setChunkStatus", chunk: "F2", status: "active" },
                    {
                        op: "appendNote",
                        chunk: "F2",
                        note:
                            "Started on the second slice. " +
                            "It touches the feed model, the view and the scenario, and each of those reads the others. ".repeat(12),
                    },
                ],
            });
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. the two initiatives were made", false, ctx.arrangeError);
            return steps;
        }
        await h.goto("jarvis");
        // a briefing fixture another scenario left on hides the live data, and only a reload clears it
        const fixtureOn = await h.ev(
            `[...document.querySelectorAll('[data-briefing-fixture]')].some((b) => b.className.includes('bg-accentbg'))`
        );
        if (fixtureOn) await polishReload(h);
        const both = `!!${polishRow(POLISH_STAGED)} && !!${polishRow(POLISH_FLAT)}`;
        // the Brief may hold a snapshot from before the efforts existed; one reload picks them up
        if (!(await polishWaitFor(h, both, 8000))) {
            await polishReload(h);
        }
        const rows = await polishWaitFor(h, both, 15000);
        rec("0. both initiatives show on the Brief", rows, JSON.stringify({ staged: ctx.staged, flat: ctx.flat }));
        if (!rows) return steps;

        // 1. the staged plan keeps its stage header
        await h.ev(`${polishRow(POLISH_STAGED)}?.click()`);
        await polishWaitFor(h, `!!${polishDetail(POLISH_STAGED)}`, 3000);
        await polishNap(400);
        const stagedHeads = await h.ev(`${polishDetail(POLISH_STAGED)}?.querySelectorAll('[data-jarvis-tracker-stage]').length ?? 0`);
        const stagedSweep = await h.ev(polishSweep(polishDetail(POLISH_STAGED)));
        await h.shot("cdp-shots/brief-initiatives-polish-1-staged.png");
        rec(
            "1. a staged initiative draws a stage header, and nothing in it is under 10.5px",
            stagedHeads >= 1 && sweptOk(stagedSweep),
            JSON.stringify({ stagedHeads, sweep: stagedSweep })
        );

        // 2. the flat plan draws no header, every chunk, and "+ Add chunk" after the last one
        await h.ev(`${polishRow(POLISH_FLAT)}?.click()`);
        await polishWaitFor(h, `!!${polishDetail(POLISH_FLAT)}`, 3000);
        await polishNap(400);
        const flat = await h.ev(`(() => {
            const d = ${polishDetail(POLISH_FLAT)};
            if (!d) return null;
            const chunks = [...d.querySelectorAll('[data-jarvis-tracker-chunk]')];
            const add = d.querySelector('[data-jarvis-add-chunk]');
            const last = chunks[chunks.length - 1];
            return {
                stages: d.querySelectorAll('[data-jarvis-tracker-stage]').length,
                chunks: chunks.length,
                add: add != null,
                afterLast: add != null && last != null && !!(last.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING),
            };
        })()`);
        const flatSweep = await h.ev(polishSweep(polishDetail(POLISH_FLAT)));
        await h.shot("cdp-shots/brief-initiatives-polish-2-flat.png");
        rec(
            "2. a flat initiative draws no stage header, all 3 chunks and + Add chunk after the last, nothing under 10.5px",
            flat != null && flat.stages === 0 && flat.chunks === 3 && flat.add && flat.afterLast && sweptOk(flatSweep),
            JSON.stringify({ flat, sweep: flatSweep })
        );

        // 2b. that "+ Add chunk" adds to stage "" (the add is a real write on a throwaway effort)
        let added = null;
        if (flat?.add) {
            await h.ev(`${polishDetail(POLISH_FLAT)}?.querySelector('[data-jarvis-add-chunk]')?.click()`);
            await polishNap(200);
            await h.ev(`(() => {
                const input = ${polishDetail(POLISH_FLAT)}?.querySelector('input');
                if (!input) return false;
                const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                set.call(input, ${JSON.stringify(POLISH_ADDED)});
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                return true;
            })()`);
            for (let waited = 0; waited < 5000 && added == null; waited += 250) {
                await polishNap(250);
                const { effort } = (await h.rpc("effortget", { effortoid: ctx.flat })) ?? {};
                const chunks = effort?.chunks ?? [];
                const at = chunks.findIndex((c) => c.label === POLISH_ADDED);
                if (at >= 0) added = { at, of: chunks.length, stage: chunks[at].stage ?? "" };
            }
        }
        rec(
            "2b. + Add chunk on a flat initiative adds the chunk at the end, to stage \"\"",
            added != null && added.stage === "" && added.at === added.of - 1,
            JSON.stringify(added)
        );

        // 3. a flat chunk's sidebar names no stage
        await h.ev(
            `${polishDetail(POLISH_FLAT)}?.querySelector('[data-jarvis-tracker-chunk="F1"]')?.click()`
        );
        const sidebarUp = await polishWaitFor(h, `!!document.querySelector('[data-jarvis-chunk-sidebar]')`, 3000);
        await polishNap(300);
        const crumb = await h.ev(`document.querySelector('[data-jarvis-chunk-sidebar]')?.innerText ?? ''`);
        const sidebarSweep = await h.ev(polishSweep(`document.querySelector('[data-jarvis-chunk-sidebar]')`));
        await h.shot("cdp-shots/brief-initiatives-polish-3-sidebar.png");
        rec(
            "3. a flat chunk opens the Chunk sidebar with no \"unstaged\" crumb, nothing under 10.5px",
            sidebarUp && !/unstaged/i.test(crumb) && sweptOk(sidebarSweep),
            JSON.stringify({ sidebarUp, unstaged: /unstaged/i.test(crumb), sweep: sidebarSweep })
        );

        // 4. its activity link opens the grouped feed
        await h.ev(
            `[...(document.querySelector('[data-jarvis-chunk-sidebar]')?.querySelectorAll('button') ?? [])].find((b) => /^activity/i.test(b.innerText.trim()) || /activity/i.test(b.getAttribute('aria-label') ?? ''))?.click()`
        );
        const SHEET = `document.querySelector('[data-jarvis-brief-sheet="effort"]')`;
        const sheetUp = await polishWaitFor(h, `!!${SHEET}?.querySelector('[data-jarvis-effort-note]')`, 5000);
        await polishNap(300);
        const feed = await h.ev(`(() => {
            const s = ${SHEET};
            return s
                ? {
                      today: s.textContent.includes('Today'),
                      notes: s.querySelectorAll('[data-jarvis-effort-note]').length,
                      next: !!s.querySelector('[data-jarvis-effort-section="next"]'),
                      bar: !!s.querySelector('[role="img"][aria-label*="done"]'),
                  }
                : null;
        })()`);
        const sheetSweep = await h.ev(polishSweep(SHEET));
        await h.shot("cdp-shots/brief-initiatives-polish-4-activity.png");
        rec(
            "4. the activity sheet opens on its progress bar, a Next card, a Today divider and note lines, nothing under 10.5px",
            sheetUp && feed != null && feed.today && feed.notes >= 1 && feed.next && feed.bar && sweptOk(sheetSweep),
            JSON.stringify({ feed, sweep: sheetSweep })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await h
            .ev(`document.querySelector('[data-jarvis-brief-sheet] button[aria-label="Close detail sheet"]')?.click()`)
            .catch(() => {});
        await h
            .ev(
                `[...(document.querySelector('[data-jarvis-chunk-sidebar]')?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Close')?.click()`
            )
            .catch(() => {});
        for (const effortoid of ctx.oids ?? []) {
            await h.rpc("effortdelete", { effortoid }).catch(() => {});
        }
        await h.goto("cockpit");
    },
};

// --- brief-peeks-polish: the record peek and the graph peek on the brief scale ----------------------
// docs/superpowers/specs/2026-09-29-brief-peeks-polish-design.md. A record whose objective is over 400 characters:
// its peek titles by the first sentence and clamps the rest; the graph peek focused on it prints the objective
// neither in its header nor on the canvas, and keeps Open record on screen. A profile with no such record gets one
// from a deferred run (run creation captures a dossier from the goal); the dossier stays in the vault afterwards,
// as run-sheet-polish's does, since no RPC deletes one.
const PEEKS_LONG = 400;
const PEEKS_GOAL =
    "verify brief-peeks-polish: do nothing, make no file changes, stop immediately. " +
    "This goal is long on purpose, so the record it captures has an objective the peek must clamp. ".repeat(6);
const PEEKS_ESC = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`;
const PEEKS_RECORD = `document.querySelector('[data-jarvis-brief-band="peek"]')`;
const PEEKS_GRAPH = `document.querySelector('[data-jarvis-graph-peek]')`;
const PEEKS_OPEN = `[...(${PEEKS_GRAPH}?.querySelectorAll('button') ?? [])].find((b) => /^open record$/i.test((b.innerText || '').trim()))`;

const briefPeeksPolish = {
    name: "brief-peeks-polish",
    surface: "jarvis",
    async arrange(h) {
        const ctx = {};
        const long = (d) => (d.objective ?? "").trim().length > PEEKS_LONG;
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            let found = ((await h.rpc("listtaskdossiers", null))?.dossiers ?? []).find(long);
            if (found == null) {
                ctx.cwd = mkdtempSync(join(tmpdir(), "verify-brief-peeks-polish-"));
                const wslist = await h.rpc("workspacelist", null);
                const ch = await h.rpc("createchannel", { name: "verify-brief-peeks-polish", projectpath: ctx.cwd });
                ctx.channelId = ch.oid;
                const created = await h.rpc("createrun", {
                    channelid: ctx.channelId,
                    workspaceid: wslist[0].workspacedata.oid,
                    goal: PEEKS_GOAL,
                    runtime: "claude",
                    mode: "orchestrator",
                    deferstart: true,
                });
                ctx.runId = created.run.id;
                found = ((await h.rpc("listtaskdossiers", null))?.dossiers ?? []).find(
                    (d) => (d.objective ?? "").trim() === PEEKS_GOAL.trim()
                );
            }
            if (found == null) throw new Error("no record has an objective over 400 characters, and seeding made none");
            ctx.recordId = found.id;
            ctx.objective = found.objective.trim();
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. a record with an objective over 400 characters", false, ctx.arrangeError);
            return steps;
        }
        // narrow columns defeat by-name clicks, and verify.mjs clears any earlier override
        await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
        await h.goto("jarvis");
        await h.ev(PEEKS_ESC);
        await polishNap(400);

        const opened = await h.ev(`(async () => {
            for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
                await new Promise((r) => setTimeout(r, 250));
            }
            if (typeof window.__openAddress !== "function") return "no __openAddress hook";
            await window.__openAddress(${JSON.stringify(`task:${ctx.recordId}`)});
            return "ok";
        })()`);
        const shown = await polishWaitFor(h, `!!${PEEKS_RECORD}?.querySelector('[data-jarvis-peek-body]')`, 6000);
        rec("1. the record peek opens on the long record, with a body", opened === "ok" && shown, `opened=${opened} record=${ctx.recordId}`);
        if (!shown) return steps;
        await h.shot("cdp-shots/brief-peeks-polish-1-record.png");

        const text = (sel) => `(${PEEKS_RECORD}?.querySelector('${sel}')?.innerText ?? '').replace(/\\s+/g, ' ').trim()`;
        const split = await h.ev(`({ title: ${text("[data-jarvis-peek-title]")}, body: ${text("[data-jarvis-peek-body]")} })`);
        rec(
            "2. the peek's title is not its body",
            split.title !== "" && split.title !== split.body,
            JSON.stringify({ title: split.title.slice(0, 80), body: split.body.slice(0, 80) })
        );
        const clamped = await h.ev(polishSweep(PEEKS_RECORD));
        rec("3. nothing in the record peek is under 10.5px", sweptOk(clamped), JSON.stringify(clamped));

        const toggled = await h.ev(`(() => {
            const b = ${PEEKS_RECORD}?.querySelector('[data-jarvis-peek-body-toggle]');
            if (!b) return false;
            b.click();
            return true;
        })()`);
        await polishNap(300);
        const expanded = await h.ev(polishSweep(PEEKS_RECORD));
        rec(
            "4. the long objective has a show-full link, and nothing is under 10.5px with it open",
            toggled === true && sweptOk(expanded),
            JSON.stringify({ toggled, expanded })
        );

        await h.ev(`${PEEKS_RECORD}?.querySelector('[data-jarvis-peek-open-graph]')?.click()`);
        const focused = await polishWaitFor(h, `!!${PEEKS_OPEN}`, 8000);
        const panel = focused
            ? ""
            : await h.ev(`(${PEEKS_GRAPH}?.innerText ?? 'no graph peek').replace(/\\s+/g, ' ').slice(0, 160)`);
        rec("5. the map button opens the graph peek with the record selected", focused, panel);
        if (!focused) return steps;
        await polishNap(800);
        await h.shot("cdp-shots/brief-peeks-polish-2-graph.png");

        // the canvas element holds no text node, so the sweep passes over it
        const graphSweep = await h.ev(polishSweep(PEEKS_GRAPH));
        rec("6. nothing in the graph peek is under 10.5px", sweptOk(graphSweep), JSON.stringify(graphSweep));

        const probe = JSON.stringify(ctx.objective.replace(/\s+/g, " ").slice(0, 40));
        const graph = await h.ev(`(() => {
            const root = ${PEEKS_GRAPH};
            const flat = (el) => (el?.innerText ?? '').replace(/\\s+/g, ' ');
            const pane = root.querySelector('[data-jarvis-graph-canvas]');
            const r = ${PEEKS_OPEN}.getBoundingClientRect();
            return {
                header: flat(root.firstElementChild).includes(${probe}),
                pane: pane != null,
                card: flat(pane).includes(${probe}),
                openInView: r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight,
            };
        })()`);
        rec("7. the graph header prints no objective", graph.header === false, JSON.stringify(graph));
        rec("8. the side panel's Open record button is inside the viewport", graph.openInView === true, JSON.stringify(graph));
        rec("9. the canvas draws no selection card", graph.pane === true && graph.card === false, JSON.stringify(graph));
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(PEEKS_ESC).catch(() => {});
        await polishNap(300);
        await h.ev(PEEKS_ESC).catch(() => {});
        // cwd is made first, so a seed that threw before createrun returned still has its channel and dir removed
        if (ctx.cwd != null) await teardownFixtureRun(h, ctx, "brief-peeks-polish");
    },
};

// --- new-run-window, model-picks: a model per task (docs/superpowers/specs/2026-09-29-worker-reviewer-models-design.md)
// Both read one three-task plan of noops: Task 1 has a Model line, Tasks 2 and 3 are left to the plan reviewer.
const MODELS_PLAN = fileURLToPath(new URL("./fixtures/models-plan.md", import.meta.url));
// narrow columns defeat by-name clicks, and verify.mjs clears any earlier override
const MODELS_VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const MODELS_RPC = { timeout: 30000 };
const setInputExpr = (elExpr, value) => `(() => {
    const el = ${elExpr};
    if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;
const flatText = (elExpr) => `(${elExpr}?.textContent ?? '').replace(/\\s+/g, ' ').trim()`;

// the window's header carries the marker, so its dialog scopes every query to it
const NEW_RUN = `document.querySelector('[data-new-run-window]')?.closest('[role="dialog"]')`;
const NEW_RUN_FIELD = `${NEW_RUN}?.querySelector('button[aria-haspopup="listbox"]')`;
const NEW_RUN_LIST = `${NEW_RUN}?.querySelector('[role="listbox"][aria-label="Projects"]')`;
const NEW_RUN_WORKERS = `${NEW_RUN}?.querySelector('[data-testid="route-picker"][aria-label="Workers model"]')`;
const NEW_RUN_PROJECT = "verify-new-run-window";
const RECENT_PROJECTS_KEY = "agent.launch.recentprojects";

// the list's group labels in order, and whether the project is listed under Recent
const newRunListExpr = (name) => `(() => {
    const list = ${NEW_RUN_LIST};
    if (!list) return null;
    const items = [...list.children].map((el) =>
        el.tagName === 'SPAN' ? { label: el.textContent.trim() } : { option: el.getAttribute('data-project-option') }
    );
    const at = items.findIndex((i) => i.option === ${JSON.stringify(name)});
    const recentAt = items.findIndex((i) => i.label === 'Recent');
    const allAt = items.findIndex((i) => i.label === 'All projects');
    return {
        labels: items.filter((i) => i.label != null).map((i) => i.label),
        listed: at >= 0,
        inRecent: recentAt >= 0 && at > recentAt && (allAt < 0 || at < allAt),
    };
})()`;

// a row's first cell is its task id; the needs cell can also read t-N, so only a first child counts
const NEW_RUN_PLAN = `(() => {
    const ready = ${NEW_RUN}?.querySelector('[data-jarvis-plan-preview="ready"]');
    if (!ready) return { error: (${NEW_RUN}?.querySelector('[data-jarvis-plan-preview="error"]')?.textContent ?? null) };
    const spans = [...ready.querySelectorAll('span')];
    const rows = spans
        .filter((s) => s.parentElement.firstElementChild === s && /^t-\\d+$/.test(s.textContent.trim()))
        .map((s) => {
            const cell = s.parentElement.lastElementChild;
            return {
                id: s.textContent.trim(),
                model: cell.textContent.trim(),
                struck: getComputedStyle(cell).textDecorationLine.includes('line-through'),
            };
        });
    const mix = spans.find((s) => /set by the plan|^all on /.test(s.textContent.trim()));
    return { rows, mix: mix ? mix.textContent.trim() : null };
})()`;

// the picker's rows are portaled out of the window, but only one picker is open at a time
async function pickWorkers(h, testId) {
    await h.ev(`${NEW_RUN_WORKERS}?.click()`);
    if (await polishWaitFor(h, `!!document.querySelector('[data-testid="${testId}"]')`, 3000)) {
        await h.ev(`document.querySelector('[data-testid="${testId}"]').click()`);
    }
    await polishNap(400);
    return h.ev(flatText(NEW_RUN_WORKERS));
}

async function channelRunCount(h, channelId) {
    return (await channelRuns(h, channelId)).length;
}

const newRunWindow = {
    name: "new-run-window",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-new-run-window-"));
        const ctx = { cwd };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await h.rpc("createproject", { name: NEW_RUN_PROJECT, path: cwd });
            ctx.project = NEW_RUN_PROJECT;
            await waitForProjectInConfig(h, NEW_RUN_PROJECT);
            const wslist = await h.rpc("workspacelist", null);
            const ch = await h.rpc("createchannel", { name: "verify-new-run-window", projectpath: cwd });
            ctx.channelId = ch.oid;
            // a run held in planning makes the project recent without starting a worker
            const created = await h.rpc("createrun", {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: "verify new-run-window: do nothing, make no file changes, stop immediately",
                runtime: "claude",
                mode: "orchestrator",
                deferstart: true,
            });
            ctx.runId = created.run.id;
            // recent is the shared recent-projects list (projectsstore's recentProjectsAtom), which a launch
            // writes; seed it rather than launch, and put the developer's own list back in teardown
            ctx.prevRecent = await h.ev(`localStorage.getItem(${JSON.stringify(RECENT_PROJECTS_KEY)})`);
            const recent = [NEW_RUN_PROJECT, ...JSON.parse(ctx.prevRecent ?? "[]")];
            await h.ev(`localStorage.setItem(${JSON.stringify(RECENT_PROJECTS_KEY)}, ${JSON.stringify(JSON.stringify(recent))})`);
            // the window reads the boot-primed channel list
            await polishReload(h);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. the project, its channel, a planning run and its recent entry were made", false, ctx.arrangeError);
            return steps;
        }
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        // off the Brief on purpose: the app-bar button has to work where the Brief never loaded the channels
        await h.goto("files");
        await h.ev(`document.querySelector('[data-new-run]')?.click()`);
        const opened = await polishWaitFor(h, `!!${NEW_RUN}`, 5000);
        rec("1. New run opens the window from the app bar", opened, `dialog=${opened}`);
        if (!opened) return steps;

        await h.ev(`${NEW_RUN_FIELD}?.click()`);
        await polishWaitFor(h, `!!${NEW_RUN_LIST}`, 3000);
        const listed = await h.ev(newRunListExpr(NEW_RUN_PROJECT));
        await h.shot("cdp-shots/new-run-window-1-picker.png");
        rec(
            "2. the project picker lists Recent, holding the project, then All projects",
            listed != null && listed.labels[0] === "Recent" && listed.labels.includes("All projects") && listed.inRecent,
            JSON.stringify(listed)
        );

        await h.ev(setInputExpr(`${NEW_RUN}?.querySelector('input[aria-label="Search projects"]')`, NEW_RUN_PROJECT));
        await polishNap(300);
        const searched = await h.ev(newRunListExpr(NEW_RUN_PROJECT));
        rec(
            "3. a query drops Recent and shows Matches",
            searched != null && !searched.labels.includes("Recent") && searched.labels[0] === "Matches" && searched.listed,
            JSON.stringify(searched)
        );

        await h.ev(`${NEW_RUN_LIST}?.querySelector('[data-project-option="${NEW_RUN_PROJECT}"]')?.click()`);
        await polishNap(300);
        const field = await h.ev(`({ expanded: ${NEW_RUN_FIELD}?.getAttribute('aria-expanded'), text: ${flatText(NEW_RUN_FIELD)} })`);
        rec(
            "4. picking the project closes the list on it",
            field.expanded === "false" && field.text.startsWith(NEW_RUN_PROJECT),
            JSON.stringify(field)
        );

        await h.ev(
            `[...(${NEW_RUN}?.querySelectorAll('button[aria-pressed]') ?? [])].find((b) => b.firstElementChild?.textContent.trim() === 'orchestrator')?.click()`
        );
        await polishNap(200);
        await h.ev(
            `[...(${NEW_RUN}?.querySelectorAll('[role="group"][aria-label="Start from"] button') ?? [])].find((b) => b.textContent.trim() === 'Plan file')?.click()`
        );
        await polishWaitFor(h, `!!${NEW_RUN}?.querySelector('[data-jarvis-plan-path]')`, 3000);
        await h.ev(setInputExpr(`${NEW_RUN}?.querySelector('[data-jarvis-plan-path]')`, MODELS_PLAN));
        // the profile may name a workers route, so Same as lead is chosen rather than assumed
        const sameAsLead = await pickWorkers(h, "route-option-inherit");
        await polishWaitFor(h, `!!${NEW_RUN}?.querySelector('[data-jarvis-plan-preview="ready"]')`, 10000);
        const onLead = await h.ev(NEW_RUN_PLAN);
        const planRow = (table) => table?.rows?.find((r) => r.id === "t-1");
        rec(
            "5. a plan file shows 3 rows, its Model line `sonnet · plan` struck through on Same as lead",
            sameAsLead.includes("Same as lead") &&
                onLead.rows?.length === 3 &&
                planRow(onLead)?.model === "sonnet · plan" &&
                planRow(onLead).struck === true,
            JSON.stringify({ workers: sameAsLead, plan: MODELS_PLAN, ...onLead })
        );

        const reviewerPicks = await pickWorkers(h, "route-option-extra");
        await polishNap(300);
        const onPicks = await h.ev(NEW_RUN_PLAN);
        const others = onPicks.rows?.filter((r) => r.id !== "t-1") ?? [];
        await h.shot("cdp-shots/new-run-window-2-picks.png");
        rec(
            "6. on Reviewer picks the Model line counts, the rest read `at review`, and the mix line says so",
            reviewerPicks.includes("Reviewer picks") &&
                planRow(onPicks)?.model === "sonnet · plan" &&
                planRow(onPicks).struck === false &&
                others.length === 2 &&
                others.every((r) => r.model === "at review") &&
                onPicks.mix === "1 set by the plan · 2 picked at review",
            JSON.stringify({ workers: reviewerPicks, ...onPicks })
        );

        const runsBefore = await channelRunCount(h, ctx.channelId);
        await h.ev(`[...(${NEW_RUN}?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Cancel')?.click()`);
        const closed = await polishWaitFor(h, `!${NEW_RUN}`, 3000);
        const runsAfter = await channelRunCount(h, ctx.channelId);
        rec(
            "7. Cancel closes the window and starts no run",
            closed && runsAfter === runsBefore,
            JSON.stringify({ closed, runsBefore, runsAfter })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(PEEKS_ESC).catch(() => {});
        if (ctx.prevRecent !== undefined) {
            const key = JSON.stringify(RECENT_PROJECTS_KEY);
            await h.ev(
                ctx.prevRecent === null
                    ? `localStorage.removeItem(${key})`
                    : `localStorage.setItem(${key}, ${JSON.stringify(ctx.prevRecent)})`
            );
        }
        await teardownFixtureRun(h, ctx, "new-run-window", {
            what: "delete the project",
            fn: () => (ctx.project ? h.rpc("deleteproject", { name: ctx.project }) : null),
        });
    },
};

// --- new-run-attachments: a pasted image and a picked file reach the run as paths in its goal
// The native file dialog cannot be driven over CDP, so a picked path goes through window.__newRunAttachPaths, the
// handler the paperclip's dialog calls. The run is a real quick run, so one lead starts; teardown cancels it.
const NEW_RUN_ATTACH_PROJECT = "verify-new-run-attachments";
const NEW_RUN_ATTACH_GOAL = "verify new-run-attachments: do nothing, make no file changes, stop immediately";
const NEW_RUN_GOAL = `${NEW_RUN}?.querySelector('textarea[aria-label="Goal"]')`;
const NEW_RUN_CHIPS = `[...(${NEW_RUN}?.querySelectorAll('[data-attachment-chip]') ?? [])]`;
const NEW_RUN_START = `[...(${NEW_RUN}?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Start run')`;
const ONE_PX_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const OVER_CAP_BYTES = 10 * 1024 * 1024 + 1;

// dispatches a paste carrying either text or one file on the goal box; returns whether the page took it over
const pasteOnGoal = (what) => `(() => {
    const ta = ${NEW_RUN_GOAL};
    if (!ta) return null;
    ta.focus();
    const dt = new DataTransfer();
    const what = ${JSON.stringify(what)};
    if (what.text != null) {
        dt.setData('text/plain', what.text);
    } else {
        const bytes = what.png ? Uint8Array.from(atob(what.png), (c) => c.charCodeAt(0)) : new Uint8Array(what.size);
        dt.items.add(new File([bytes], what.name, { type: 'image/png' }));
    }
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    return ev.defaultPrevented;
})()`;
const chipsExpr = `${NEW_RUN_CHIPS}.map((c) => ({
    state: c.getAttribute('data-attachment-chip'),
    path: c.getAttribute('data-attachment-path'),
    name: c.querySelector('.font-mono')?.textContent ?? null,
    thumb: !!c.querySelector('img'),
}))`;
const newRunFooter = `({
    start: ${NEW_RUN_START}?.disabled ?? null,
    footer: ${flatText(`${NEW_RUN}?.querySelector('[data-new-run-footer]')`)},
})`;

const newRunAttachments = {
    name: "new-run-attachments",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-new-run-attachments-"));
        const ctx = { cwd, picked: join(cwd, "notes.txt") };
        try {
            writeFileSync(ctx.picked, "picked through the dialog's handler\n");
            await h.rpc("createproject", { name: NEW_RUN_ATTACH_PROJECT, path: cwd });
            ctx.project = NEW_RUN_ATTACH_PROJECT;
            await waitForProjectInConfig(h, NEW_RUN_ATTACH_PROJECT);
            const ch = await h.rpc("createchannel", { name: "verify-new-run-attachments", projectpath: cwd });
            ctx.channelId = ch.oid;
            // the window opens on the most recent project, so it is seeded first and put back in teardown
            ctx.prevRecent = await h.ev(`localStorage.getItem(${JSON.stringify(RECENT_PROJECTS_KEY)})`);
            const recent = [NEW_RUN_ATTACH_PROJECT, ...JSON.parse(ctx.prevRecent ?? "[]")];
            await h.ev(`localStorage.setItem(${JSON.stringify(RECENT_PROJECTS_KEY)}, ${JSON.stringify(JSON.stringify(recent))})`);
            await polishReload(h);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. the project, its channel, a picked file and the recent entry were made", false, ctx.arrangeError);
            return steps;
        }
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        await h.ev(`document.querySelector('[data-new-run]')?.click()`);
        const opened = await polishWaitFor(h, `!!${NEW_RUN_GOAL}`, 5000);
        // quick, so the run is one lead and the goal is its whole input
        await h.ev(
            `[...(${NEW_RUN}?.querySelectorAll('button[aria-pressed]') ?? [])].find((b) => b.firstElementChild?.textContent === 'quick')?.click()`
        );
        await polishNap(300);
        const field = await h.ev(flatText(NEW_RUN_FIELD));
        rec(
            "1. New run opens on the project, with the paperclip beside the goal",
            opened &&
                field.startsWith(NEW_RUN_ATTACH_PROJECT) &&
                (await h.ev(`!!${NEW_RUN}?.querySelector('[data-goal-attachments] [data-attach-files]')`)),
            JSON.stringify({ opened, field })
        );
        if (!opened) return steps;

        await h.ev(`(() => {
            const ta = ${NEW_RUN_GOAL};
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(NEW_RUN_ATTACH_GOAL)});
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        const textTaken = await h.ev(pasteOnGoal({ text: "plain words" }));
        const imageTaken = await h.ev(pasteOnGoal({ png: ONE_PX_PNG, name: "pasted.png" }));
        const ready = await polishWaitFor(h, `${NEW_RUN_CHIPS}.some((c) => c.getAttribute('data-attachment-chip') === 'ready')`, 8000);
        const pasted = (await h.ev(chipsExpr))[0] ?? null;
        ctx.pastedPath = pasted?.path ?? null;
        rec(
            "2. a text paste is left to the goal box; an image paste becomes a ready chip with a thumbnail and a temp copy",
            textTaken === false &&
                imageTaken === true &&
                ready &&
                pasted?.thumb === true &&
                pasted?.name === "pasted.png" &&
                (pasted?.path ?? "").includes("waveterm-attach-") &&
                pasted.path.endsWith("pasted.png"),
            JSON.stringify({ textTaken, imageTaken, ready, pasted })
        );

        // over the cap: rejected before any RPC, and the launch waits on it rather than dropping it
        await h.ev(pasteOnGoal({ size: OVER_CAP_BYTES, name: "too-big.png" }));
        await polishWaitFor(h, `${NEW_RUN_CHIPS}.some((c) => c.getAttribute('data-attachment-chip') === 'error')`, 3000);
        const failed = await h.ev(`({ chips: ${chipsExpr}, ...${newRunFooter} })`);
        await h.shot("cdp-shots/new-run-attachments-error.png");
        rec(
            "3. a failed attachment shows as an error chip and holds Start run, saying why",
            failed.chips.some((c) => c.state === "error" && c.name === "too-big.png") &&
                failed.start === true &&
                failed.footer.includes("Retry or remove the failed attachment"),
            JSON.stringify(failed)
        );
        await h.ev(
            `${NEW_RUN_CHIPS}.find((c) => c.getAttribute('data-attachment-chip') === 'error')?.querySelector('button[title="Remove"]')?.click()`
        );

        await h.ev(`window.__newRunAttachPaths?.(${JSON.stringify([ctx.picked])})`);
        await h.ev(`window.__newRunAttachPaths?.(${JSON.stringify([ctx.picked])})`);
        await polishNap(300);
        const both = await h.ev(`({ chips: ${chipsExpr}, ...${newRunFooter} })`);
        await h.shot("cdp-shots/new-run-attachments-chips.png");
        rec(
            "4. a picked path is a ready chip referenced in place, once; removing the failed chip frees Start run",
            both.chips.length === 2 &&
                both.chips[1].state === "ready" &&
                both.chips[1].path === ctx.picked &&
                both.chips[1].name === "notes.txt" &&
                both.start === false,
            JSON.stringify(both)
        );

        // a route picked by hand is the launch's route as it stands; the project's own is resolved against the
        // boot-time harness catalog, which an isolated Final store may not have loaded yet (one run failed with
        // "Selected route is unavailable"). So the lead's shown route is picked again by hand: the selected row,
        // else the first the picker lists
        await h.ev(`${NEW_RUN}?.querySelector('[data-testid="route-picker"][aria-label="Lead model"]')?.click()`);
        const routes = `[...document.querySelectorAll('[data-testid^="route-option-"]')].filter((o) => !/-(inherit|extra)$/.test(o.dataset.testid))`;
        const pickedRoute = (await polishWaitFor(h, `${routes}.length > 0`, 8000))
            ? await h.ev(`(() => {
                const opts = ${routes};
                const opt = opts.find((o) => o.getAttribute('aria-pressed') === 'true') ?? opts[0];
                opt.click();
                return opt.dataset.testid;
            })()`)
            : null;
        await polishNap(300);
        const runsBefore = (await channelRuns(h, ctx.channelId)).map((r) => r.id);
        await h.ev(`${NEW_RUN_START}?.click()`);
        let run = null;
        for (let waited = 0; waited < 20000 && run == null; waited += 500) {
            run = (await channelRuns(h, ctx.channelId)).find((r) => !runsBefore.includes(r.id)) ?? null;
            if (run == null) await polishNap(500);
        }
        ctx.runId = run?.id;
        // a launch that failed before the run existed keeps the window open with its error in the footer
        const after = await h.ev(`({ open: !!${NEW_RUN}, ...${newRunFooter} })`);
        if (run == null) await h.shot("cdp-shots/new-run-attachments-start.png");
        const expected = `${NEW_RUN_ATTACH_GOAL}\n\nAttachments (read these files):\n- ${ctx.pastedPath}\n- ${ctx.picked}`;
        rec(
            "5. Start run sends the typed goal with both paths appended",
            run != null && run.goal === expected,
            JSON.stringify({ goal: run?.goal ?? null, expected, pickedRoute, window: run == null ? after : undefined })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(PEEKS_ESC).catch(() => {});
        if (ctx.prevRecent !== undefined) {
            const key = JSON.stringify(RECENT_PROJECTS_KEY);
            await h.ev(
                ctx.prevRecent === null
                    ? `localStorage.removeItem(${key})`
                    : `localStorage.setItem(${key}, ${JSON.stringify(ctx.prevRecent)})`
            );
        }
        // the temp copy sits in its own waveterm-attach-* dir, which the 24h sweep would otherwise reap
        if (ctx.pastedPath) rmSync(dirname(ctx.pastedPath), { recursive: true, force: true });
        await teardownFixtureRun(h, ctx, "new-run-attachments", {
            what: "delete the project",
            fn: () => (ctx.project ? h.rpc("deleteproject", { name: ctx.project }) : null),
        });
    },
};

// --- palette-actions, palette-goal: Ctrl+P acting on things (docs/superpowers/specs/2026-09-30-palette-actions-design.md)
// Every query is scoped to the palette's own dialog: the app bar's search button and the Brief also render rows.
const PALETTE_INPUT = `document.querySelector('input[data-palette-input]')`;
const PALETTE = `${PALETTE_INPUT}?.closest('[role="dialog"]')`;
// React reads keys off the input's own keydown, so they are dispatched there rather than relying on page focus
const paletteKey = (key, mods = {}) => `(() => {
    const el = ${PALETTE_INPUT};
    if (!el) return false;
    el.dispatchEvent(new KeyboardEvent('keydown', { ...${JSON.stringify(mods)}, key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true }));
    return true;
})()`;
// a key sent to the note editor's title or body; true when the editor took it (prevented its default)
const noteKeyIn = (field, key, mods = {}) => `(() => {
    const el = ${PALETTE}?.querySelector(${JSON.stringify(field === "body" ? "[data-note-body]" : "input[data-palette-input]")});
    if (!el) return null;
    return !el.dispatchEvent(new KeyboardEvent('keydown', { ...${JSON.stringify(mods)}, key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
})()`;
const PALETTE_TOGGLE = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }))`;
// the listbox's children are its groups, each led by its label; a row is a data-idx button
const PALETTE_STATE = `(() => {
    const d = ${PALETTE};
    if (!d) return null;
    const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const input = d.querySelector('input[data-palette-input]');
    const list = d.querySelector('[role="listbox"][aria-label="Results"]');
    const sel = list?.querySelector('button[data-idx][aria-selected="true"]');
    return {
        token: d.querySelector('[data-palette-token]') ? flat(d.querySelector('[data-palette-token]')) : null,
        drill: d.querySelector('[data-palette-drill]') ? flat(d.querySelector('[data-palette-drill]')) : null,
        query: input?.value ?? null,
        placeholder: input?.placeholder ?? null,
        groups: [...(list?.children ?? [])].map((g) => ({
            label: flat(g.firstElementChild),
            rows: [...g.querySelectorAll('button[data-idx]')].map((b) => flat(b)),
        })),
        selected: sel ? flat(sel) : null,
        chip: sel ? /→ \\d+ actions/.test(flat(sel)) : false,
        text: (d.innerText ?? '').replace(/\\s+/g, ' ').trim(),
    };
})()`;

async function openPalette(h) {
    // Ctrl+P toggles, so a palette an earlier step left open is closed first
    if (await h.ev(`!!${PALETTE_INPUT}`)) {
        await h.ev(PEEKS_ESC);
        await polishWaitFor(h, `!${PALETTE_INPUT}`, 2000);
    }
    await h.ev(PALETTE_TOGGLE);
    return polishWaitFor(h, `!!${PALETTE_INPUT}`, 3000);
}

async function paletteStateWhen(h, ok, ms) {
    let state = null;
    for (let waited = 0; waited <= ms; waited += 250) {
        state = await h.ev(PALETTE_STATE).catch(() => null);
        if (state != null && ok(state)) break;
        await polishNap(250);
    }
    return state;
}

// A run held in planning by deferstart is only a record: no worker spawns, so no lead joins the roster and none
// of Steer's actions (message, focus, workers, relaunch, resume) applies. Its list is Open and Stop, and Steer's
// actions are named on the Not now line instead.
const paletteActions = {
    name: "palette-actions",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-palette-actions-"));
        const stamp = `palacts${Date.now() % 100000}`;
        const ctx = { cwd, stamp };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            const wslist = await h.rpc("workspacelist", null);
            const ch = await h.rpc("createchannel", { name: "verify-palette-actions", projectpath: cwd });
            ctx.channelId = ch.oid;
            const created = await h.rpc("createrun", {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: `verify ${stamp}: do nothing, make no file changes, stop immediately`,
                runtime: "claude",
                mode: "orchestrator",
                deferstart: true,
            });
            ctx.runId = created.run.id;
            // the palette lists runs from the boot-primed channel list
            await polishReload(h);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. a channel with one planning run was made", false, ctx.arrangeError);
            return steps;
        }
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        await h.goto("jarvis");
        const opened = await openPalette(h);
        rec("1. Ctrl+P opens the palette", opened, `open=${opened}`);
        if (!opened) return steps;

        await h.ev(setInputExpr(PALETTE_INPUT, "r:"));
        const scoped = await paletteStateWhen(h, (s) => s.token === "Runs", 2000);
        const runsTab = await h.ev(`${PALETTE}?.querySelector('[data-palette-scope="runs"]')?.getAttribute('aria-pressed')`);
        rec(
            "2. typing r: narrows to Runs: the token names it, the field empties",
            scoped?.token === "Runs" && scoped.query === "" && runsTab === "true",
            JSON.stringify({ token: scoped?.token, query: scoped?.query, runsTab })
        );

        // the row's action count shows only once the kinds' sources load, so wait for it rather than sleep
        await h.ev(setInputExpr(PALETTE_INPUT, ctx.stamp));
        const listed = await paletteStateWhen(h, (s) => (s.selected ?? "").includes(ctx.stamp) && s.chip, 8000);
        rec(
            "3. the run's row is selected and says → N actions",
            (listed?.selected ?? "").includes(ctx.stamp) && listed.chip === true,
            JSON.stringify({ selected: listed?.selected, groups: listed?.groups })
        );

        await h.ev(paletteKey("ArrowRight"));
        const acts = await paletteStateWhen(h, (s) => s.drill != null && s.groups.length > 0, 3000);
        await h.shot("cdp-shots/palette-actions-list.png");
        const labels = acts?.groups.map((g) => g.label) ?? [];
        const rows = acts?.groups.flatMap((g) => g.rows) ?? [];
        rec(
            "4. → opens the run's actions: Open then Stop, Cancel run among them, Steer's under Not now",
            acts != null &&
                acts.token == null &&
                acts.drill.startsWith("Run") &&
                acts.drill.includes(ctx.stamp) &&
                acts.placeholder === "Filter Run actions…" &&
                labels.join(",") === "Open,Stop" &&
                rows.some((r) => r.startsWith("Open in Jarvis")) &&
                rows.some((r) => r.startsWith("Cancel run")) &&
                /Not now: .*Message the lead/.test(acts.text),
            JSON.stringify({ drill: acts?.drill, placeholder: acts?.placeholder, groups: acts?.groups })
        );

        await h.ev(paletteKey("Backspace"));
        const back = await paletteStateWhen(h, (s) => s.drill == null, 2000);
        rec(
            "5. Backspace on the empty filter returns to the run list, the query and the run's selection kept",
            back != null &&
                back.drill == null &&
                back.token === "Runs" &&
                back.query === ctx.stamp &&
                (back.selected ?? "").includes(ctx.stamp),
            JSON.stringify({ token: back?.token, query: back?.query, selected: back?.selected })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(PEEKS_ESC).catch(() => {});
        await teardownFixtureRun(h, ctx, "palette-actions");
    },
};

const PALETTE_GOAL_PROJECT = "verify-palette-goal";

// Orchestrate opens the New run window rather than starting a run, so firing it here spawns nothing; the
// Ctrl+Enter handler itself is covered by palette-launch.test.ts.
const paletteGoal = {
    name: "palette-goal",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-palette-goal-"));
        const ctx = { cwd };
        try {
            await h.rpc("createproject", { name: PALETTE_GOAL_PROJECT, path: cwd });
            ctx.project = PALETTE_GOAL_PROJECT;
            await waitForProjectInConfig(h, PALETTE_GOAL_PROJECT);
            const ch = await h.rpc("createchannel", { name: "verify-palette-goal", projectpath: cwd });
            ctx.channelId = ch.oid;
            await polishReload(h);
            // the launch block starts in the active project, so the channel is made active the way an agent's
            // reveal does, and the sheet that opens with it is closed again
            await h.rpc("uireveal", { address: `channel:${ctx.channelId}` }, UI_ROUTE);
            await polishNap(600);
            await h.ev(PEEKS_ESC);
            await polishNap(300);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. an active project with no runs was made", false, ctx.arrangeError);
            return steps;
        }
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        await h.goto("jarvis");
        const runsBefore = await channelRunCount(h, ctx.channelId);
        const opened = await openPalette(h);
        rec("1. Ctrl+P opens the palette", opened, `open=${opened}`);
        if (!opened) return steps;

        // a goal that names nothing: a made-up first word, so no verb row and no name match either
        const goal = `zqvx${Date.now() % 100000} tidy the palette fixture`;
        await h.ev(setInputExpr(PALETTE_INPUT, goal));
        const launch = await paletteStateWhen(h, (s) => s.groups[0]?.label.startsWith("Start in"), 3000);
        await h.shot("cdp-shots/palette-goal-launch.png");
        const block = launch?.groups[0];
        rec(
            "2. the launch block leads, in the active project, with Quick selected",
            block != null &&
                block.label === `Start in #${PALETTE_GOAL_PROJECT}` &&
                (block.rows[0] ?? "").startsWith("Quick") &&
                (launch.selected ?? "").startsWith("Quick") &&
                block.rows.some((r) => r.startsWith("Orchestrate")),
            JSON.stringify({ groups: launch?.groups, selected: launch?.selected })
        );
        rec(
            "3. the footer names Ctrl+Enter's Orchestrate",
            launch != null && launch.text.includes("ctrl ⏎") && launch.text.includes("Opens an orchestrator run instead"),
            launch?.text.slice(-240) ?? ""
        );

        // Quick → Orchestrate
        await h.ev(paletteKey("ArrowDown"));
        const onOrch = await paletteStateWhen(h, (s) => (s.selected ?? "").startsWith("Orchestrate"), 2000);
        await h.ev(paletteKey("Enter"));
        const windowOpen = await polishWaitFor(h, `!!${NEW_RUN}`, 5000);
        // the window fills the goal once its project list loads
        await polishWaitFor(
            h,
            `${NEW_RUN}?.querySelector('textarea[aria-label="Goal"]')?.value === ${JSON.stringify(goal)}`,
            3000
        );
        // the palette closes before the window opens, but its exit animation keeps the input mounted briefly
        const paletteGone = await polishWaitFor(h, `!${PALETTE_INPUT}`, 2000);
        const filled = await h.ev(`({
            palette: !!${PALETTE_INPUT},
            goal: ${NEW_RUN}?.querySelector('textarea[aria-label="Goal"]')?.value ?? null,
            project: ${flatText(NEW_RUN_FIELD)},
            text: ${flatText(NEW_RUN)},
        })`);
        const runsAfter = await channelRunCount(h, ctx.channelId);
        await h.shot("cdp-shots/palette-goal-window.png");
        rec(
            "4. Orchestrate opens the New run window with the goal, the project and the orchestrator shape filled, and starts nothing",
            (onOrch?.selected ?? "").startsWith("Orchestrate") &&
                windowOpen &&
                paletteGone &&
                filled.palette === false &&
                filled.goal === goal &&
                filled.project.startsWith(PALETTE_GOAL_PROJECT) &&
                filled.text.includes(`orchestrator × `) &&
                runsAfter === runsBefore,
            JSON.stringify({ selected: onOrch?.selected, windowOpen, paletteGone, ...filled, runsBefore, runsAfter })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(PEEKS_ESC).catch(() => {});
        await teardownFixtureRun(h, ctx, "palette-goal", {
            what: "delete the project",
            fn: () => (ctx.project ? h.rpc("deleteproject", { name: ctx.project }) : null),
        });
    },
};

// --- palette-notes: the Notes scope of Ctrl+P (docs/superpowers/plans/2026-10-08-user-notes-palette.md)
// The vault may already hold notes, some of today's: rows are found by the run's stamp, and arrange adds its own
// last so they lead the list.
const NOTES_STATE = `(() => {
    const d = ${PALETTE};
    if (!d) return null;
    const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const rows = [...d.querySelectorAll('[data-note-row]')].map((b) => ({
        id: b.dataset.noteRow,
        text: flat(b),
        selected: b.getAttribute('aria-selected') === 'true',
        hit: [...b.querySelectorAll('span.font-semibold')].map((s) => s.textContent).join(''),
    }));
    const pane = d.querySelector('[data-note-preview]');
    const arm = d.querySelector('[data-palette-arm]');
    const alert = d.querySelector('[role="alert"]');
    const fresh = d.querySelector('[data-note-new]');
    const body = d.querySelector('[data-note-body]');
    const title = d.querySelector('input[data-palette-input]');
    return {
        newRow: fresh
            ? {
                  text: flat(fresh),
                  selected: fresh.getAttribute('aria-selected') === 'true',
                  last: [...d.querySelectorAll('[role="option"]')].pop() === fresh,
              }
            : null,
        editor: body
            ? {
                  chip: flat(d.querySelector('[data-palette-drill]')),
                  title: title?.value ?? null,
                  titleLabel: title?.getAttribute('aria-label') ?? null,
                  body: body.value,
                  focus: document.activeElement === body ? 'body' : document.activeElement === title ? 'title' : null,
                  scopeRow: !!d.querySelector('[role="group"][aria-label="Scope"]'),
                  results: !!d.querySelector('[role="listbox"]'),
              }
            : null,
        token: d.querySelector('[data-palette-token]') ? flat(d.querySelector('[data-palette-token]')) : null,
        query: d.querySelector('input[data-palette-input]')?.value ?? null,
        split: !!d.querySelector('[data-palette-notes]'),
        rows,
        selected: rows.find((r) => r.selected)?.id ?? null,
        preview: pane
            ? {
                  text: flat(pane),
                  steps: [...pane.querySelectorAll('ol > li')].map(flat),
                  code: [...pane.querySelectorAll('[data-code-head]')].map((el) => flat(el.parentElement)),
                  scrollTop: pane.scrollTop,
                  hidden: pane.scrollHeight - pane.clientHeight,
              }
            : null,
        arm: arm ? { key: arm.dataset.paletteArm, text: flat(arm) } : null,
        error: alert ? flat(alert) : null,
        text: (d.innerText ?? '').replace(/\\s+/g, ' ').trim(),
    };
})()`;

async function notesStateWhen(h, ok, ms) {
    let state = null;
    for (let waited = 0; waited <= ms; waited += 250) {
        state = await h.ev(NOTES_STATE).catch(() => null);
        if (state != null && ok(state)) break;
        await polishNap(250);
    }
    return state;
}

// paletteKey's event is not cancelable, so it cannot tell whether the palette took the key
const NOTES_DEL_TAKEN = `(() => {
    const el = ${PALETTE_INPUT};
    if (!el) return null;
    return !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }));
})()`;
const notesCaretExpr = (at) => `(() => {
    const el = ${PALETTE_INPUT};
    if (!el) return null;
    const pos = ${at === "end" ? "el.value.length" : at};
    el.setSelectionRange(pos, pos);
    return el.selectionStart;
})()`;
// an own property over Clipboard.prototype's: never the real write, which a window without OS focus rejects and
// which would overwrite the user's clipboard
const notesClipStub = (rejects) => `(() => {
    window.__notesClip = [];
    navigator.clipboard.writeText = (text) => {
        window.__notesClip.push(text);
        return ${rejects ? `Promise.reject(new Error('denied'))` : `Promise.resolve()`};
    };
    return true;
})()`;
const NOTES_CLIP_RESTORE = `(() => { delete navigator.clipboard.writeText; delete window.__notesClip; return true; })()`;
// setInputExpr's setter is the input's; the editor's body is a textarea
const noteBodyExpr = (value) => `(() => {
    const el = ${PALETTE}?.querySelector('[data-note-body]');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;
// the scrim is the dialog's parent, and it leaves only on a press that lands on itself
const NOTES_BACKDROP_PRESS = `(() => {
    const scrim = ${PALETTE}?.parentElement;
    if (!scrim) return false;
    scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
})()`;

const NOTES_LONG_PARAGRAPHS = 120;

const paletteNotes = {
    name: "palette-notes",
    surface: "jarvis",
    async arrange(h) {
        const stamp = `palnotes${Date.now().toString(36)}`;
        // newest first, as the list shows them: arrange adds them in reverse
        const fixtures = {
            markdown: {
                title: `verify ${stamp} markdown zebra`,
                body: `Steps of ${stamp}:\n\n1. first step alpha\n2. second step beta\n\n\`\`\`sh\necho fenced-${stamp}\n\`\`\``,
            },
            quokka: { title: `verify ${stamp} quokka`, body: `the quokka body of ${stamp}` },
            narwhal: { title: `verify ${stamp} narwhal`, body: `the narwhal body of ${stamp}` },
            long: {
                title: `verify ${stamp} long walrus`,
                body: Array.from({ length: NOTES_LONG_PARAGRAPHS }, (_, i) => `paragraph ${i + 1} of the long note`).join("\n\n"),
            },
        };
        const ctx = { stamp, fixtures, ids: {} };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            ctx.vault = await vaultRoot(h);
            const remote = vaultRemote(ctx.vault);
            if (remote) throw new Error(`the vault ${ctx.vault} has a git remote (${remote}): not writing fixture notes into it`);
            for (const name of ["long", "narwhal", "quokka", "markdown"]) {
                ctx.ids[name] = (await h.rpc("noteadd", fixtures[name])).id;
                // a file time of its own, so the order by modified time is the order added
                await polishNap(50);
            }
            await polishReload(h);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. four notes were added", false, ctx.arrangeError);
            return steps;
        }
        const { stamp, fixtures, ids } = ctx;
        const stamped = (s) => (s?.rows ?? []).filter((r) => r.text.includes(stamp)).map((r) => r.id);
        const exists = async (id) => ((await h.rpc("notelist", null)) ?? []).some((n) => n.id === id);
        const key = (k, mods) => h.ev(paletteKey(k, mods));
        const type = (text) => h.ev(setInputExpr(PALETTE_INPUT, text));
        const CTRL = { ctrlKey: true };
        const editorKey = (field, k, mods) => h.ev(noteKeyIn(field, k, mods));
        const typeBody = (text) => h.ev(noteBodyExpr(text));
        const inEditor = (s) => s.editor != null;
        const inList = (s) => s.editor == null && s.split;
        const noteOf = async (id) => ((await h.rpc("notelist", null)) ?? []).find((n) => n.id === id) ?? null;
        const editorBrief = (s) => JSON.stringify({ editor: s?.editor, arm: s?.arm, error: s?.error, split: s?.split, selected: s?.selected });
        const selectedIs = (id) => (s) => s.split && s.selected === id;
        const brief = (s) => JSON.stringify({ token: s?.token, query: s?.query, split: s?.split, selected: s?.selected, rows: stamped(s), arm: s?.arm, error: s?.error });

        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        await h.goto("jarvis");
        if (!(await openPalette(h))) {
            rec("0. Ctrl+P opens the palette", false, "the palette never opened");
            return steps;
        }

        await h.ev(`${PALETTE}?.querySelector('[data-palette-scope="notes"]')?.click()`);
        const order = [ids.markdown, ids.quokka, ids.narwhal, ids.long];
        const list = await notesStateWhen(h, (s) => s.split && stamped(s).length === 4, 8000);
        await h.shot("cdp-shots/palette-notes-list.png");
        rec(
            "1. the Notes scope lists the notes beside a preview",
            list?.token === "Notes" && list.split && stamped(list).join() === order.join() && list.selected === ids.markdown,
            `want ${order.join()} with the first selected: ${brief(list)}`
        );

        rec(
            "2. the preview renders the selected note's markdown",
            list?.preview != null &&
                list.preview.steps.join("|") === "first step alpha|second step beta" &&
                list.preview.code.some((c) => c.includes(`echo fenced-${stamp}`)) &&
                !list.preview.text.includes("```"),
            JSON.stringify(list?.preview)
        );

        await key("ArrowDown");
        const second = await notesStateWhen(h, selectedIs(ids.quokka), 3000);
        rec(
            "3. ↓ moves the preview to the next note",
            second?.selected === ids.quokka && second.preview?.text === fixtures.quokka.body,
            JSON.stringify({ selected: second?.selected, preview: second?.preview?.text })
        );

        await type(`${stamp} quokka`);
        const filtered = await notesStateWhen(h, (s) => s.split && s.rows.length === 1, 3000);
        rec(
            "4. typing filters by title",
            filtered?.rows.length === 1 && filtered.rows[0].id === ids.quokka && filtered.rows[0].hit.includes("quokka"),
            JSON.stringify(filtered?.rows)
        );

        // each open starts fresh on All
        await openPalette(h);
        await type("no:");
        const prefixed = await notesStateWhen(h, (s) => s.token === "Notes", 3000);
        rec("5. no: from All narrows to Notes", prefixed?.token === "Notes" && prefixed.query === "", brief(prefixed));

        await openPalette(h);
        await type(`${stamp} narwhal`);
        const inAll = await paletteStateWhen(h, (s) => s.groups.some((g) => g.label === "Notes"), 5000);
        const notesGroup = inAll?.groups.find((g) => g.label === "Notes");
        const foundInAll =
            inAll?.token == null && notesGroup?.rows.some((r) => r.includes(fixtures.narwhal.title)) && (inAll.selected ?? "").includes(fixtures.narwhal.title);
        await key("Enter");
        const shown = await notesStateWhen(h, selectedIs(ids.narwhal), 3000);
        rec(
            "6. a note is found from All and Enter shows it in Notes",
            foundInAll && shown?.token === "Notes" && shown.selected === ids.narwhal && shown.preview?.text === fixtures.narwhal.body,
            `in All: ${JSON.stringify({ selected: inAll?.selected, groups: inAll?.groups })} then ${brief(shown)}`
        );

        // the whole list again, on the narwhal note: a neighbour on each side
        await type("");
        await notesStateWhen(h, (s) => s.split && stamped(s).length === 4, 3000);
        await key("ArrowDown");
        await key("ArrowDown");
        await notesStateWhen(h, selectedIs(ids.narwhal), 3000);
        await key("Delete");
        const armed = await notesStateWhen(h, (s) => s.arm != null, 3000);
        const armedExists = await exists(ids.narwhal);
        await key("ArrowDown");
        const disarmed = await notesStateWhen(h, (s) => s.arm == null && s.selected === ids.long, 3000);
        const disarmedExists = await exists(ids.narwhal);
        rec(
            "7. one del arms, another key disarms",
            armed?.arm?.key === "del" &&
                armed.arm.text.includes(`del again deletes “${fixtures.narwhal.title}”`) &&
                armedExists &&
                disarmed?.arm == null &&
                disarmed?.selected === ids.long &&
                disarmedExists,
            JSON.stringify({ armed: armed?.arm, armedExists, after: disarmed?.arm, selected: disarmed?.selected, disarmedExists })
        );

        await key("ArrowUp");
        await notesStateWhen(h, selectedIs(ids.narwhal), 3000);
        await key("Delete");
        await notesStateWhen(h, (s) => s.arm != null, 3000);
        await key("Delete");
        const deleted = await notesStateWhen(h, (s) => !stamped(s).includes(ids.narwhal), 5000);
        await h.shot("cdp-shots/palette-notes-deleted.png");
        const deletedExists = await exists(ids.narwhal);
        rec(
            "8. del twice deletes the note",
            deleted != null && stamped(deleted).join() === [ids.markdown, ids.quokka, ids.long].join() && deleted.selected === ids.long && !deletedExists,
            `still listed by RPC=${deletedExists} ${brief(deleted)}`
        );

        const top = await notesStateWhen(h, (s) => s.selected === ids.long && s.preview?.hidden > 0, 3000);
        await key("PageDown");
        const down = await notesStateWhen(h, (s) => s.preview?.scrollTop > 0, 3000);
        await key("PageUp");
        const up = await notesStateWhen(h, (s) => s.preview?.scrollTop === 0, 3000);
        rec(
            "9. PageDown and PageUp scroll a long note's preview",
            top?.preview?.scrollTop === 0 &&
                top.preview.hidden > 0 &&
                down?.preview?.scrollTop > 0 &&
                down.selected === ids.long &&
                up?.preview?.scrollTop === 0 &&
                up.selected === ids.long,
            JSON.stringify({
                hidden: top?.preview?.hidden,
                scroll: [top?.preview?.scrollTop, down?.preview?.scrollTop, up?.preview?.scrollTop],
                selected: [top?.selected, down?.selected, up?.selected],
            })
        );

        await type(stamp);
        await notesStateWhen(h, (s) => s.split && s.rows.length === 3 && s.selected != null, 3000);
        const caret = await h.ev(notesCaretExpr(0));
        const takenMid = await h.ev(NOTES_DEL_TAKEN);
        const mid = await h.ev(NOTES_STATE);
        const midExists = mid?.selected != null && (await exists(mid.selected));
        // the same key with the caret at the end is taken, so a false above is the caret's doing
        await h.ev(notesCaretExpr("end"));
        const takenEnd = await h.ev(NOTES_DEL_TAKEN);
        const endArmed = await notesStateWhen(h, (s) => s.arm != null, 3000);
        await key("Shift");
        await notesStateWhen(h, (s) => s.arm == null, 3000);
        rec(
            "10. del with the caret mid-query edits the text and arms nothing",
            caret === 0 && takenMid === false && mid?.arm == null && mid?.query === stamp && midExists && takenEnd === true && endArmed?.arm != null,
            JSON.stringify({ caret, takenMid, arm: mid?.arm, query: mid?.query, midExists, takenEnd, endArm: endArmed?.arm })
        );

        await type("");
        await notesStateWhen(h, (s) => s.split && stamped(s).length === 3, 3000);
        await key("ArrowDown");
        const onGone = await notesStateWhen(h, selectedIs(ids.quokka), 3000);
        await h.rpc("notedelete", { id: ids.quokka });
        await key("Delete");
        await notesStateWhen(h, (s) => s.arm != null, 3000);
        await key("Delete");
        const failed = await notesStateWhen(h, (s) => s.error != null && !stamped(s).includes(ids.quokka), 5000);
        rec(
            "11. deleting a note that is already gone says so and reloads the list",
            onGone?.selected === ids.quokka &&
                (failed?.error ?? "").startsWith("Delete failed") &&
                stamped(failed).join() === [ids.markdown, ids.long].join(),
            brief(failed)
        );

        rec(
            "12. the New note row sits last and is not the default",
            list?.selected === ids.markdown &&
                list.newRow?.last === true &&
                list.newRow.text.includes("New note") &&
                !list.newRow.selected &&
                list.text.includes("ctrl ⏎ Edits it"),
            JSON.stringify({ selected: list?.selected, newRow: list?.newRow, text: list?.text.slice(-260) })
        );

        // a fresh open: the markdown note leads and is selected
        await openPalette(h);
        await h.ev(`${PALETTE}?.querySelector('[data-palette-scope="notes"]')?.click()`);
        await notesStateWhen(h, (s) => selectedIs(ids.markdown)(s) && stamped(s).length === 2, 5000);
        await key("Enter", CTRL);
        const opened = await notesStateWhen(h, (s) => inEditor(s) && s.editor.focus === "body", 3000);
        await h.shot("cdp-shots/palette-notes-editor.png");
        rec(
            "13. ctrl ⏎ opens the note in the editor",
            opened?.editor != null &&
                /^Notes\s*›\s*Edit$/.test(opened.editor.chip) &&
                opened.editor.titleLabel === "Title" &&
                opened.editor.title === fixtures.markdown.title &&
                opened.editor.body.includes("```sh") &&
                opened.editor.body.includes(`echo fenced-${stamp}`) &&
                opened.editor.focus === "body" &&
                !opened.editor.scopeRow &&
                !opened.editor.results &&
                opened.text.includes(`Saves “${fixtures.markdown.title}”`),
            editorBrief(opened)
        );

        const focusAfter = async (field, k, mods) => {
            const taken = await editorKey(field, k, mods);
            const s = await h.ev(NOTES_STATE);
            return { taken, focus: s?.editor?.focus ?? null, title: s?.editor?.title, body: s?.editor?.body };
        };
        const toTitle = await focusAfter("body", "Tab");
        const toBody = await focusAfter("title", "Tab");
        const backToTitle = await focusAfter("body", "Tab", { shiftKey: true });
        const enterInTitle = await focusAfter("title", "Enter");
        rec(
            "14. Tab moves between title and body, and Enter in the title moves to the body",
            toTitle.focus === "title" &&
                toBody.focus === "body" &&
                backToTitle.focus === "title" &&
                enterInTitle.taken === true &&
                enterInTitle.focus === "body" &&
                enterInTitle.title === opened?.editor?.title &&
                enterInTitle.body === opened?.editor?.body,
            JSON.stringify({ focus: [toTitle.focus, toBody.focus, backToTitle.focus, enterInTitle.focus], enterTaken: enterInTitle.taken })
        );

        await h.ev(PEEKS_ESC);
        const escBack = await notesStateWhen(h, inList, 3000);
        await key("Enter", CTRL);
        const reopened = await notesStateWhen(h, inEditor, 3000);
        await h.ev(`${PALETTE}?.querySelector('[data-palette-drill]')?.click()`);
        const chipBack = await notesStateWhen(h, inList, 3000);
        rec(
            "15. esc on an unchanged draft goes straight back, and so does the chip",
            // Tab never cycled the scope: both leaves land on Notes
            escBack?.editor == null &&
                escBack?.token === "Notes" &&
                escBack.selected === ids.markdown &&
                reopened?.editor != null &&
                chipBack?.editor == null &&
                chipBack?.token === "Notes" &&
                chipBack.selected === ids.markdown,
            `after esc: ${editorBrief(escBack)} reopened: ${editorBrief(reopened)} after the chip: ${editorBrief(chipBack)}`
        );

        // the list wraps: ↑ from the first note is the New note row
        await key("ArrowUp");
        const onNew = await notesStateWhen(h, (s) => s.newRow?.selected === true, 3000);
        await key("Enter");
        const blank = await notesStateWhen(h, (s) => inEditor(s) && s.editor.focus === "title", 3000);
        await h.ev(PEEKS_ESC);
        const blankLeft = await notesStateWhen(h, inList, 3000);
        rec(
            "16. New note from an empty query opens on an empty title, and leaves without asking",
            onNew?.newRow?.selected === true &&
                onNew.preview?.text === "" &&
                onNew.text.includes("Writes a new note") &&
                blank?.editor != null &&
                /^Notes\s*›\s*New$/.test(blank.editor.chip) &&
                blank.editor.title === "" &&
                blank.editor.body === "" &&
                blank.editor.focus === "title" &&
                blank.text.includes("Saves the note") &&
                blankLeft?.editor == null &&
                blankLeft?.token === "Notes" &&
                stamped(blankLeft).length === 2,
            `row: ${JSON.stringify({ newRow: onNew?.newRow, preview: onNew?.preview?.text })} editor: ${editorBrief(blank)} left: ${editorBrief(blankLeft)}`
        );

        const edited = { title: `verify ${stamp} edited walrus`, body: `the edited body of ${stamp}` };
        await key("ArrowUp");
        await notesStateWhen(h, selectedIs(ids.long), 3000);
        await key("Enter", CTRL);
        await notesStateWhen(h, inEditor, 3000);
        await type(edited.title);
        await typeBody(edited.body);
        await editorKey("body", "Enter", CTRL);
        const saved = await notesStateWhen(h, (s) => inList(s) && s.preview?.text === edited.body, 5000);
        const savedNote = await noteOf(ids.long);
        rec(
            "17. ctrl ⏎ saves the edit",
            savedNote?.title === edited.title &&
                (savedNote.body ?? "").trim() === edited.body &&
                saved?.editor == null &&
                saved?.token === "Notes" &&
                saved.query === "" &&
                saved.selected === ids.long &&
                saved.preview?.text === edited.body,
            `by RPC: ${JSON.stringify(savedNote)} ${editorBrief(saved)} preview=${JSON.stringify(saved?.preview?.text)}`
        );

        await key("Enter", CTRL);
        await notesStateWhen(h, inEditor, 3000);
        const armedBy = async (text, leave) => {
            await typeBody(text);
            await notesStateWhen(h, (s) => s.arm == null && s.editor?.body === text, 3000);
            await h.ev(leave);
            const s = await notesStateWhen(h, (st) => st.arm != null || st.editor == null, 3000);
            return { open: await h.ev(`!!${PALETTE_INPUT}`), body: s?.editor?.body ?? null, arm: s?.arm ?? null };
        };
        const byEsc = await armedBy("typed, then esc", PEEKS_ESC);
        const byToggle = await armedBy("typed, then ctrl p", PALETTE_TOGGLE);
        const byBackdrop = await armedBy("typed, then a click outside", NOTES_BACKDROP_PRESS);
        await h.ev(PEEKS_ESC);
        const discarded = await notesStateWhen(h, inList, 3000);
        const keptNote = await noteOf(ids.long);
        const armedOk = (r, text) =>
            r.open === true && r.body === text && r.arm?.key === "esc" && r.arm.text.includes("esc again discards your changes");
        rec(
            "18. esc on a changed draft asks once, and so do Ctrl+P and a click outside",
            armedOk(byEsc, "typed, then esc") &&
                armedOk(byToggle, "typed, then ctrl p") &&
                armedOk(byBackdrop, "typed, then a click outside") &&
                discarded?.editor == null &&
                discarded?.token === "Notes" &&
                (keptNote?.body ?? "").trim() === edited.body,
            `${JSON.stringify({ byEsc, byToggle, byBackdrop })} then ${editorBrief(discarded)} by RPC: ${JSON.stringify(keptNote?.body)}`
        );

        await notesStateWhen(h, selectedIs(ids.long), 3000);
        await key("Enter", CTRL);
        await notesStateWhen(h, inEditor, 3000);
        const orphan = `typed for a note that is gone ${stamp}`;
        await typeBody(orphan);
        await h.rpc("notedelete", { id: ids.long });
        await editorKey("body", "Enter", CTRL);
        const saveFailed = await notesStateWhen(h, (s) => s.error != null, 5000);
        await h.ev(PEEKS_ESC);
        await notesStateWhen(h, (s) => s.arm != null, 3000);
        await h.ev(PEEKS_ESC);
        const afterGone = await notesStateWhen(h, inList, 3000);
        rec(
            "19. saving a note that is already gone says so and keeps the text",
            (saveFailed?.error ?? "").startsWith("Save failed") &&
                saveFailed.editor?.body === orphan &&
                afterGone?.editor == null &&
                stamped(afterGone).join() === ids.markdown,
            `${editorBrief(saveFailed)} then rows=${stamped(afterGone).join()}`
        );

        const freshTitle = `zzqx ${stamp} fresh`;
        const freshBody = `the body of a note written here, ${stamp}`;
        await type(freshTitle);
        const noMatch = await notesStateWhen(h, (s) => s.split && s.rows.length === 0 && s.newRow?.selected === true, 3000);
        await key("Enter");
        const fresh = await notesStateWhen(h, (s) => inEditor(s) && s.editor.focus === "body", 3000);
        await typeBody(freshBody);
        await notesStateWhen(h, (s) => s.editor?.body === freshBody, 3000);
        await h.shot("cdp-shots/palette-notes-new.png");
        await editorKey("body", "Enter", CTRL);
        const created = await notesStateWhen(h, (s) => inList(s) && s.preview?.text === freshBody, 5000);
        const createdNote = ((await h.rpc("notelist", null)) ?? []).find((n) => n.title === freshTitle) ?? null;
        rec(
            "20. New note takes the typed text as its title",
            noMatch?.rows.length === 0 &&
                noMatch.newRow?.selected === true &&
                noMatch.text.includes(`Writes a new note titled “${freshTitle}”`) &&
                fresh?.editor != null &&
                /^Notes\s*›\s*New$/.test(fresh.editor.chip) &&
                fresh.editor.title === freshTitle &&
                createdNote != null &&
                (createdNote.body ?? "").trim() === freshBody &&
                created?.selected === createdNote.id &&
                created.query === "",
            `no match: ${JSON.stringify({ rows: noMatch?.rows, newRow: noMatch?.newRow })} editor: ${editorBrief(fresh)} by RPC: ${JSON.stringify(createdNote)} ${editorBrief(created)}`
        );

        await key("Enter", CTRL);
        await notesStateWhen(h, inEditor, 3000);
        const keptText = `text kept through a refused title, ${stamp}`;
        await typeBody(keptText);
        await type("");
        await editorKey("title", "Enter", CTRL);
        const refusedTitle = await notesStateWhen(h, (s) => s.error != null, 3000);
        const untitled = createdNote != null ? await noteOf(createdNote.id) : null;
        await h.ev(PEEKS_ESC);
        await notesStateWhen(h, (s) => s.arm != null, 3000);
        await h.ev(PEEKS_ESC);
        await notesStateWhen(h, inList, 3000);
        rec(
            "21. a title the store refuses is named and the text kept",
            refusedTitle?.error === "A note needs a title." &&
                refusedTitle.editor?.title === "" &&
                refusedTitle.editor.body === keptText &&
                untitled?.title === freshTitle,
            `${editorBrief(refusedTitle)} by RPC: ${JSON.stringify(untitled)}`
        );

        await type(`${stamp} markdown`);
        const onCopy = await notesStateWhen(h, selectedIs(ids.markdown), 3000);
        await h.ev(notesClipStub(true));
        await key("Enter");
        const refused = await notesStateWhen(h, (s) => (s.error ?? "").startsWith("Copy failed"), 3000);
        rec(
            "22. a copy the clipboard refuses says so and keeps the palette open",
            onCopy?.selected === ids.markdown && (refused?.error ?? "").startsWith("Copy failed") && refused.selected === ids.markdown,
            brief(refused)
        );

        await h.ev(notesClipStub(false));
        await key("Enter");
        const closed = await polishWaitFor(h, `!${PALETTE_INPUT}`, 3000);
        const copied = await h.ev(`window.__notesClip ?? null`);
        const lingering = await h.ev(`[...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent).join(' | ')`);
        await h.ev(NOTES_CLIP_RESTORE);
        const want = `# ${fixtures.markdown.title}\n\n${fixtures.markdown.body}\n`;
        rec(
            "23. Enter copies the note and closes the palette",
            closed && copied?.length === 1 && copied[0] === want && !lingering.includes("failed"),
            JSON.stringify({ closed, copied, want, lingering })
        );
        return steps;
    },
    async teardown(h, ctx) {
        const failed = [];
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                failed.push(`${what}: ${e?.message ?? e}`);
            }
        };
        await step("restore the clipboard", () => h.ev(NOTES_CLIP_RESTORE));
        await step("close the palette", () => h.ev(PEEKS_ESC));
        await step("delete the notes this run left", async () => {
            for (const n of (await h.rpc("notelist", null)) ?? []) {
                if (n.title.includes(ctx.stamp)) await h.rpc("notedelete", { id: n.id });
            }
        });
        if (failed.length > 0) throw new Error(failed.join("; "));
    },
};

const PICKS_BANNER = `document.querySelector('[data-dag-modal-kind] [data-model-picks-banner]')`;
// the pick row lives in the selected task's rail, so only the selected task's row is ever on screen
const PICK_ROWS = `[...document.querySelectorAll('[data-dag-modal-kind] [data-model-pick]')]`;
const pickRowExpr = (id) => `document.querySelector('[data-dag-modal-kind] [data-model-pick="${id}"]')`;
const pickToggleExpr = (id, sonnet) =>
    `[...(${pickRowExpr(id)}?.querySelectorAll('[role="group"] button') ?? [])].find((b) => (b.textContent.trim() === 'sonnet') === ${sonnet})`;
const dagCardExpr = (id) => `document.querySelector('[data-dag-modal-kind] [data-dag-node="${id}"]')`;
// a card's model tag is its own span, `<model> · <source>`
const cardTagExpr = (id) =>
    `([...(${dagCardExpr(id)}?.querySelectorAll('span') ?? [])].map((s) => s.textContent.trim()).find((t) => / · (plan|review|you|escalated|pinned)$/.test(t)) ?? null)`;
// the detail rail's worker line carries the same route attribute as the cards
const DAG_RAIL_ROUTE = `document.querySelector('[data-dag-modal-kind] [data-dag-node-route]:not([data-dag-node])')`;
const railExpr = `({ route: ${DAG_RAIL_ROUTE}?.getAttribute('data-dag-node-route') ?? null, text: ${flatText(DAG_RAIL_ROUTE)} })`;
// Task 1's Model line leaves it off the picks; one sonnet pick and one lead pick make the banner "1 of 3"
const MODEL_PICKS = [
    { taskid: "t-2", model: "sonnet", reason: "a noop needs no deep reasoning" },
    { taskid: "t-3", model: "lead", reason: "kept on the lead, so its rail must show no pick" },
];

async function dagTask(h, ctx, id) {
    const g = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
    return (g?.tasks ?? []).find((t) => t.id === id) ?? null;
}

async function waitDagTask(h, ctx, id, ok) {
    let task = null;
    for (let waited = 0; waited < 8000; waited += 250) {
        task = await dagTask(h, ctx, id);
        if (task != null && ok(task)) break;
        await polishNap(250);
    }
    return task;
}

const taskFacts = (t) =>
    t && { state: t.state, modelsource: t.modelsource ?? "", runtime: t.runspec?.runtime ?? "", model: t.runspec?.model ?? "" };

const modelPicks = {
    name: "model-picks",
    surface: "jarvis",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-model-picks-"));
        const ctx = { cwd };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            const wslist = await h.rpc("workspacelist", null);
            const ch = await h.rpc("createchannel", { name: "verify-model-picks", projectpath: cwd });
            ctx.channelId = ch.oid;
            const created = await h.rpc("createrun", {
                channelid: ctx.channelId,
                workspaceid: wslist[0].workspacedata.oid,
                goal: "verify model-picks: do nothing, make no file changes, stop immediately",
                runtime: "claude",
                mode: "orchestrator",
                deferstart: true,
                reviewerpicks: true,
                parallelism: 1,
            });
            ctx.runId = created.run.id;
            await h.rpc(
                "dagsubmit",
                { channelid: ctx.channelId, runid: ctx.runId, parallelism: 1, planpath: MODELS_PLAN },
                MODELS_RPC
            );
            // the plan reviewer is a real session, spawned after the submit returns; its verdict is recorded
            // here, in its name, before it can send one
            let reviewer = null;
            for (let waited = 0; waited < 90000 && reviewer == null; waited += 1000) {
                const pr = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.planreview;
                reviewer = pr?.state === "reviewing" && pr.runid ? pr.runid : null;
                if (reviewer == null) await polishNap(1000);
            }
            if (reviewer == null) throw new Error("the plan reviewer never started");
            await h.rpc(
                "dagaction",
                {
                    channelid: ctx.channelId,
                    runid: reviewer,
                    taskid: "",
                    action: "planreview-pass",
                    notes: "verify model-picks: three noops",
                    picks: MODEL_PICKS,
                },
                MODELS_RPC
            );
            // the Brief reads a boot-primed snapshot, so the RPC-created channel needs a reload
            await polishReload(h);
            ctx.opened = await h.ev(`(async () => {
                for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                if (typeof window.__openAddress !== "function") return { ok: false, why: "no __openAddress hook" };
                return window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)});
            })()`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. a Reviewer picks run passed its plan review with picks", false, ctx.arrangeError);
            return steps;
        }
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        const openDag = `[...(document.querySelector('[data-jarvis-brief-sheet]')?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Open DAG')`;
        const sheet = await polishWaitFor(h, `!!${openDag}`, 15000);
        if (sheet) await h.ev(`${openDag}.click()`);
        const graph = await polishWaitFor(
            h,
            `!!document.querySelector('[data-dag-modal-kind="live"]') && document.querySelectorAll('[data-dag-modal-kind] [data-dag-node]:not([data-dag-node="final"])').length === 3`,
            10000
        );
        rec(
            "0. the run's graph opened with its 3 tasks",
            ctx.opened?.ok === true && sheet && graph,
            JSON.stringify({ runId: ctx.runId, opened: ctx.opened, sheet, graph })
        );
        if (!graph) return steps;

        await polishWaitFor(h, `!!${PICKS_BANNER}`, 5000);
        const banner = await h.ev(flatText(PICKS_BANNER));
        await h.shot("cdp-shots/model-picks-1-banner.png");
        rec("1. the banner reads `1 of 3 tasks on sonnet`", banner.includes("1 of 3 tasks on sonnet"), `banner=${JSON.stringify(banner)}`);

        await h.ev(`${dagCardExpr("t-3")}?.click()`);
        await polishWaitFor(h, `!!${DAG_RAIL_ROUTE}`, 3000);
        const leadRows = await h.ev(`${PICK_ROWS}.map((r) => r.getAttribute('data-model-pick'))`);
        await h.ev(`${dagCardExpr("t-2")}?.click()`);
        await polishWaitFor(h, `!!${pickRowExpr("t-2")}`, 3000);
        const rail = await h.ev(`({
            rows: ${PICK_ROWS}.map((r) => r.getAttribute('data-model-pick')),
            pressed: ${pickRowExpr("t-2")}?.querySelector('[role="group"] button[aria-pressed="true"]')?.textContent.trim() ?? null,
            reason: ${flatText(pickRowExpr("t-2"))}.includes(${JSON.stringify(MODEL_PICKS[0].reason)}),
            sideRail: !!document.querySelector('[data-dag-modal-kind] [data-timeline-rail] [data-model-pick]'),
        })`);
        rec(
            "2. only the sonnet pick shows a model row in the task rail, on sonnet, with its reason",
            leadRows.length === 0 &&
                rail.rows.length === 1 &&
                rail.rows[0] === "t-2" &&
                rail.pressed === "sonnet" &&
                rail.reason &&
                !rail.sideRail,
            JSON.stringify({ leadRows, ...rail })
        );

        const picked = await h.ev(`({
            t1: ${cardTagExpr("t-1")},
            t2: ${cardTagExpr("t-2")},
            t3: ${cardTagExpr("t-3")},
            rail: ${railExpr},
        })`);
        rec(
            "3. the cards tag the plan's and the reviewer's picks, and the rail names the reviewer",
            picked.t1 === "sonnet · plan" &&
                picked.t2 === "sonnet · review" &&
                picked.t3 == null &&
                picked.rail.route === "reviewer:claude:sonnet" &&
                picked.rail.text.includes("worker · reviewer's pick"),
            JSON.stringify(picked)
        );

        await h.ev(`${pickToggleExpr("t-2", false)}?.click()`);
        const onLead = await waitDagTask(h, ctx, "t-2", (t) => t.modelsource === "owner");
        await polishWaitFor(h, `${flatText(pickRowExpr("t-2"))}.includes('you changed it')`, 3000);
        const leadRow = await h.ev(flatText(pickRowExpr("t-2")));
        rec(
            "4. toggling the pick to the lead's model writes modelsource owner and clears the pin",
            onLead?.modelsource === "owner" && !onLead.runspec?.model && leadRow.includes("you changed it"),
            JSON.stringify({ task: taskFacts(onLead), row: leadRow })
        );

        await h.ev(`${pickToggleExpr("t-2", true)}?.click()`);
        const onSonnet = await waitDagTask(h, ctx, "t-2", (t) => t.modelsource === "owner" && t.runspec?.model === "sonnet");
        await polishWaitFor(h, `${cardTagExpr("t-2")} === 'sonnet · you'`, 3000);
        const yours = await h.ev(`({ tag: ${cardTagExpr("t-2")}, rail: ${railExpr} })`);
        await h.shot("cdp-shots/model-picks-2-yours.png");
        rec(
            "5. toggling it back to sonnet tags the card `sonnet · you` and the rail names your pick",
            onSonnet?.modelsource === "owner" &&
                onSonnet.runspec?.model === "sonnet" &&
                yours.tag === "sonnet · you" &&
                yours.rail.route === "owner:claude:sonnet" &&
                yours.rail.text.includes("worker · your pick"),
            JSON.stringify({ task: taskFacts(onSonnet), ...yours })
        );
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(PEEKS_ESC).catch(() => {});
        await teardownFixtureRun(h, ctx, "model-picks");
    },
};

// --- radar-start-investigation: the draft lands on the launcher, not on a past run -----------------
// Start investigation hands the finding to its project's channel sheet. With a run selected in that channel
// (one the user had looked at, or a live one) the sheet opened on that run's report and the launcher holding
// the draft sat behind New run, so the button read as doing nothing. Selecting a past run first is that case.
const radarStartInvestigation = {
    name: "radar-start-investigation",
    surface: "jarvis",
    async arrange(h) {
        const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "");
        const reports = (await h.rpc("listradarreports", { projectpath: "" }))?.reports ?? [];
        const channels = (await h.rpc("getchannels", null))?.channels ?? [];
        for (const r of reports) {
            const finding = (r.findings ?? []).find((f) => f.investigation?.status !== "executing");
            // the landing resolves the FIRST channel on the project, so the past run has to come from that one
            const channel = channels.find((c) => norm(c.projectpath) === norm(r.projectpath));
            if (!finding || !channel) continue;
            const runs = (await h.rpc("getchannelruns", { channelid: channel.oid }))?.runs ?? [];
            if (runs.length === 0) continue;
            return { reportId: r.oid, findingId: finding.id, mission: finding.mission, runId: runs[0].id };
        }
        return { reportId: null };
    },
    async assert(h, ctx) {
        const step = "1. Start investigation opens the launcher holding the draft, over a selected past run";
        if (!ctx.reportId) {
            return [skipStep(step, "no radar finding whose project channel has a run - scan a project with runs")];
        }
        const open = async (address, hint) => {
            await h.goto("jarvis");
            await polishWaitFor(h, `typeof window.__openAddress === 'function'`, 5000);
            return h.ev(`window.__openAddress(${JSON.stringify(address)}, ${JSON.stringify(hint ?? null)})`);
        };
        const ranOpen = await open(`run:${ctx.runId}`);
        await polishNap(1500);
        const radarOpen = await open(`radarreport:${ctx.reportId}`, { sourceType: "radar", anchor: ctx.findingId });
        const detail = `[data-radar-finding-detail="${ctx.findingId}"]`;
        await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(detail)})`, 8000);
        const clicked = await h.ev(`(() => {
            const b = [...document.querySelectorAll(${JSON.stringify(`${detail} button`)})]
                .find((x) => /^(Start investigation|Investigate again)/.test((x.textContent || '').trim()));
            if (!b) return false;
            b.click();
            return true;
        })()`);
        const want = (ctx.mission || "").slice(0, 40);
        const landed = await polishWaitFor(
            h,
            `[...document.querySelectorAll('[data-jarvis-brief-sheet="channel"] input, [data-jarvis-brief-sheet="channel"] textarea')]
                .some((x) => x.value.startsWith(${JSON.stringify(want)}))`,
            8000
        );
        const runFace = await h.ev(`!!document.querySelector('[data-jarvis-brief-sheet-face="settings"]')`);
        const surface = await h.activeSurfaceLabel();
        await h.shot("cdp-shots/radar-start-investigation.png");
        return [
            {
                step,
                ok: ranOpen?.ok === true && clicked && landed && !runFace && surface === SURFACE_LABEL.jarvis,
                detail: JSON.stringify({ ranOpen, radarOpen, clicked, landed, runFace, surface }),
            },
        ];
    },
    // the draft and the channel's composing flag outlive the sheet by design; a reload drops both
    async teardown(h) {
        await polishReload(h);
    },
};

// --- radar-report, radar-scan-states: the sibling-audit surface (.superpowers/design/radar-sibling-audit) ----
// Every board is drawn from the dev fixtures of radardevmock.ts through window.__setRadarScenario, which only
// replaces the report the surface reads. What a fixture cannot show is a disposition, since the RPC refuses a
// report the store does not hold: Intentional, Reopen finding and the site link run on a report seeded into
// the dev store for this checkout, so the link has a real file to open.
// the surface has no hook of its own; its body does, once the load phase is ready
const RADAR_ROOT = `document.querySelector('[data-radar-view]')?.parentElement`;
const RADAR_SCOPE_KEY = "radar.scope.project";
const RADAR_SEED_FINDING = "f-radar-report";
const RADAR_SEED_FILE = "pkg/reporadar/scan.go";
const RADAR_SEED_LINE = 122;
const RADAR_DISMISS_REASONS = ["False positive", "Low priority", "Resolved elsewhere", "Intentional"];
const RADAR_DISMISS_FOOTNOTE =
    "Closes this finding. Its fix commit is audited once, so it stays closed until you reopen it from Dismissed.";
const RADAR_REMOVED_TEXT = [
    "collectors",
    "Suppress pattern",
    "Suppressed",
    "Recurring",
    "No longer detected",
    "Evidence",
    "Affected files",
    "Suggested investigation",
];
const RADAR_PARTIAL_FAILED = ["7927fb68", "9caee0d3"];
const RADAR_AUDIT_ERROR = "Timed out after 10 minutes.";

const radarOpen = async (h) => {
    await h.goto("radar");
    return polishWaitFor(h, `typeof window.__setRadarScenario === 'function'`, 8000);
};

// draws a fixture and waits for the body it should land on
async function radarMock(h, name, view) {
    await h.ev(
        `window.__setRadarScenario(${JSON.stringify(name)}, ${JSON.stringify({ projectPath: process.cwd() })})`
    );
    const shown = await polishWaitFor(h, `!!document.querySelector('[data-radar-view="${view}"]')`, 8000);
    // the body cross-fades between the report, a panel and the skeleton
    await polishNap(600);
    return shown;
}

const radarFacts = (h) =>
    h.ev(`(() => {
        const root = ${RADAR_ROOT};
        if (!root) return null;
        const text = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const all = (sel, from) => [...from.querySelectorAll(sel)];
        const body = root.querySelector('[data-radar-view]');
        const strip = root.querySelector('[data-radar-health-strip]');
        const retry = root.querySelector('[data-radar-retry-audits]');
        const toggle = root.querySelector('[data-radar-audits-toggle]');
        return {
            view: body.getAttribute('data-radar-view'),
            title: text(body.querySelector('h2')),
            bodyText: text(body),
            rootText: text(root),
            buttons: all('button', body).map(text),
            auditList: !!body.querySelector('[data-radar-audit-list]'),
            audits: all('[data-radar-audit-row]', body).map((r) => ({
                sha: r.getAttribute('data-radar-audit-row'),
                state: r.getAttribute('data-audit-state'),
                text: text(r),
            })),
            strip: strip ? text(strip) : null,
            retry: retry ? !retry.disabled : null,
            toggle: toggle ? text(toggle) : null,
            project: root.querySelector('button[aria-label^="Scanned project:"]')?.getAttribute('aria-label') ?? null,
            rescan: !!root.querySelector('[data-radar-rescan]'),
            findingRows: all('[data-radar-finding-row]', root).length,
            groups: Object.fromEntries(
                all('[data-radar-group]', root).map((g) => [
                    g.getAttribute('data-radar-group'),
                    all('[data-radar-finding-row]', g).map((r) => ({
                        id: r.getAttribute('data-radar-finding-row'),
                        text: text(r),
                        isNew: !!r.querySelector('[data-radar-new]'),
                        current: r.getAttribute('aria-current') === 'true',
                    })),
                ])
            ),
        };
    })()`);

const radarDetail = (h) =>
    h.ev(`(() => {
        const d = ${RADAR_ROOT}?.querySelector('[data-radar-finding-detail]');
        if (!d) return null;
        const text = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        return {
            id: d.getAttribute('data-radar-finding-detail'),
            siteLink: text(d.querySelector('[data-radar-site-link]')),
            cards: [...d.querySelectorAll('[data-radar-site-card]')].map(text),
            headings: [...d.querySelectorAll('h3')].map(text),
            sourceFix: text(d.querySelector('[data-radar-source-fix]')),
            text: text(d),
        };
    })()`);

const radarClick = (h, selector) =>
    h.ev(`(() => {
        const el = ${RADAR_ROOT}?.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
    })()`);

// the detail's buttons carry no hook: the one whose whole text is the label
const radarDetailButton = (h, label) =>
    h.ev(`(() => {
        const b = [...(${RADAR_ROOT}?.querySelectorAll('[data-radar-finding-detail] button') ?? [])]
            .find((x) => (x.textContent || '').trim() === ${JSON.stringify(label)});
        if (!b) return false;
        b.click();
        return true;
    })()`);

const radarHas = (selector) => `!!${RADAR_ROOT}?.querySelector(${JSON.stringify(selector)})`;
const radarStates = (facts) => facts?.audits.map((a) => a.state) ?? [];
const fixSha = (rowText) => /fix ([0-9a-f]{8})/.exec(rowText ?? "")?.[1] ?? null;
const hasAll = (text, words) => words.every((w) => (text ?? "").includes(w));

async function radarOpenDismissMenu(h) {
    const clicked = await radarDetailButton(h, "Dismiss");
    const open = clicked && (await polishWaitFor(h, radarHas("[data-radar-dismiss-menu]"), 3000));
    // the popover's reveal finishes before a shot or a click on a reason
    await polishNap(300);
    return open;
}

const radarReport = {
    name: "radar-report",
    surface: "radar",
    async arrange(h) {
        const ctx = { cwd: process.cwd() };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            // landing on the seeded report persists its project as Radar's scope
            ctx.priorScope = await h.ev(`localStorage.getItem(${JSON.stringify(RADAR_SCOPE_KEY)})`);
            ctx.reportId = await seedRadarReport(h, (oid) =>
                radarFixtureReport(oid, "radar-report-fixture", ctx.cwd, Date.now(), {
                    id: RADAR_SEED_FINDING,
                    risk: "Radar fixture: the scan loop outlives a cancelled context",
                    file: RADAR_SEED_FILE,
                    lines: [RADAR_SEED_LINE, 140],
                })
            );
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const hook = await radarOpen(h);

        {
            const shown = await radarMock(h, "results", "report");
            const f = await radarFacts(h);
            const open = f?.groups.open ?? [];
            const dismissed = f?.groups.dismissed ?? [];
            const sited = open.find((r) => /\.\w+:\d+/.test(r.text) && fixSha(r.text) != null);
            await h.shot("cdp-shots/radar-report.png");
            rec(
                "1. a report lists Open and Dismissed with site, title, severity and source fix",
                hook &&
                    shown &&
                    sited != null &&
                    open.some((r) => r.isNew) &&
                    dismissed.length === 2 &&
                    f.project === "Scanned project: waveterm" &&
                    f.rescan,
                JSON.stringify({
                    hook,
                    view: f?.view ?? null,
                    open: open.length,
                    newChips: open.filter((r) => r.isNew).length,
                    dismissed: dismissed.length,
                    row: sited?.text ?? null,
                    project: f?.project ?? null,
                    rescan: f?.rescan ?? null,
                })
            );

            const d = await radarDetail(h);
            const row = [...open, ...dismissed].find((r) => r.id === d?.id);
            const sha = fixSha(row?.text);
            rec(
                "2. the detail shows the site link, site cards, root cause and source fix",
                d != null &&
                    /:\d+$/.test(d.siteLink) &&
                    d.cards.length > 0 &&
                    d.cards.every((c) => hasAll(c, ["Actual", "Expected", "Fix gap"])) &&
                    d.headings.includes("Root cause") &&
                    sha != null &&
                    d.sourceFix.includes(sha),
                JSON.stringify({
                    finding: d?.id ?? null,
                    siteLink: d?.siteLink ?? null,
                    cards: d?.cards.length ?? 0,
                    headings: d?.headings ?? null,
                    rowSha: sha,
                    sourceFix: d?.sourceFix.slice(0, 120) ?? null,
                })
            );
        }

        {
            const clicked = await radarClick(h, "[data-radar-audits-toggle]");
            const opened = clicked && (await polishWaitFor(h, radarHas("[data-radar-audits-popover]"), 3000));
            await polishNap(300);
            const rows = await h.ev(
                `[...(${RADAR_ROOT}?.querySelectorAll('[data-radar-audits-popover] [data-radar-audit-row]') ?? [])]
                    .map((r) => r.getAttribute('data-audit-state'))`
            );
            await h.shot("cdp-shots/radar-audits.png");
            await radarClick(h, "[data-radar-audits-toggle]");
            const closed = await polishWaitFor(h, `!(${radarHas("[data-radar-audits-popover]")})`, 3000);
            rec(
                "3. the header's audit summary opens the audited-commit list",
                opened && rows.length === 8 && rows.filter((s) => s === "hits").length === 2 && closed,
                JSON.stringify({ clicked, opened, rows, closed })
            );
        }

        {
            const opened = await radarOpenDismissMenu(h);
            const menu = await h.ev(`(() => {
                const m = ${RADAR_ROOT}?.querySelector('[data-radar-dismiss-menu]');
                if (!m) return null;
                return {
                    reasons: [...m.querySelectorAll('[data-radar-dismiss-reason]')]
                        .map((b) => b.getAttribute('data-radar-dismiss-reason')),
                    text: (m.textContent ?? '').replace(/\\s+/g, ' ').trim(),
                };
            })()`);
            await h.shot("cdp-shots/radar-dismiss.png");
            await radarDetailButton(h, "Dismiss");
            const closed = await polishWaitFor(h, `!(${radarHas("[data-radar-dismiss-menu]")})`, 3000);
            rec(
                "4. the Dismiss menu offers four reasons and the reworded footnote",
                opened &&
                    JSON.stringify(menu?.reasons) === JSON.stringify(RADAR_DISMISS_REASONS) &&
                    menu.text.includes(RADAR_DISMISS_FOOTNOTE) &&
                    closed,
                JSON.stringify({ opened, reasons: menu?.reasons ?? null, text: menu?.text ?? null, closed })
            );
        }

        {
            const shown = await radarMock(h, "partial", "report");
            const f = await radarFacts(h);
            await h.shot("cdp-shots/radar-partial.png");
            // the fixture's oid is not in the store, so the RPC is refused and no audit starts
            const dispatched = await h.ev(`(() => {
                const b = ${RADAR_ROOT}?.querySelector('[data-radar-retry-audits]');
                if (!b) return false;
                let fired = false;
                b.addEventListener('click', () => { fired = true; }, { once: true });
                b.click();
                return fired;
            })()`);
            await polishNap(1500);
            const after = await radarFacts(h);
            rec(
                "5. a partial scan names the failed commits and offers Retry failed audits",
                shown &&
                    hasAll(f?.strip, RADAR_PARTIAL_FAILED) &&
                    f.retry === true &&
                    (f.toggle ?? "").endsWith("2 failed") &&
                    dispatched &&
                    after?.view === "report" &&
                    hasAll(after.strip, RADAR_PARTIAL_FAILED),
                JSON.stringify({
                    strip: f?.strip ?? null,
                    retryEnabled: f?.retry ?? null,
                    summary: f?.toggle ?? null,
                    dispatched,
                    after: { view: after?.view ?? null, strip: after?.strip ?? null },
                })
            );
        }

        const detail = `[data-radar-finding-detail="${RADAR_SEED_FINDING}"][data-radar-report="${ctx.reportId}"]`;
        const seededRow = (group) =>
            radarHas(`[data-radar-group="${group}"] [data-radar-finding-row="${RADAR_SEED_FINDING}"]`);
        {
            await h.ev(`window.__setRadarScenario('live')`);
            // __openAddress exists only once the Brief has mounted
            await h.goto("jarvis");
            const opener = await polishWaitFor(h, `typeof window.__openAddress === 'function'`, 5000);
            const opened =
                ctx.arrangeError == null && opener
                    ? await h.ev(
                          `window.__openAddress(${JSON.stringify(`radarreport:${ctx.reportId}`)}, ${JSON.stringify({ sourceType: "radar", anchor: RADAR_SEED_FINDING })})`
                      )
                    : null;
            const landed = opened?.ok === true && (await polishWaitFor(h, radarHas(detail), 8000));
            const menu = landed && (await radarOpenDismissMenu(h));
            const picked = menu && (await radarClick(h, '[data-radar-dismiss-reason="Intentional"]'));
            const dismissed = picked && (await polishWaitFor(h, seededRow("dismissed"), 8000));
            const label = (await radarDetail(h))?.text.includes("Dismissed: intentional") ?? false;
            const reopened = dismissed && (await radarDetailButton(h, "Reopen finding"));
            const backOpen = reopened && (await polishWaitFor(h, seededRow("open"), 8000));
            const newChip = await h.ev(
                radarHas(`[data-radar-finding-row="${RADAR_SEED_FINDING}"] [data-radar-new]`)
            );
            rec(
                "6. Intentional closes a finding into Dismissed, and Reopen finding returns it",
                dismissed === true && label && backOpen === true && newChip === false,
                JSON.stringify({
                    arrangeError: ctx.arrangeError ?? null,
                    opener,
                    opened,
                    landed,
                    menu,
                    picked,
                    dismissed,
                    label,
                    reopened,
                    backOpen,
                    newChip,
                })
            );
        }

        {
            const clicked = await radarClick(h, `${detail} [data-radar-site-link]`);
            const openFile = `(document.querySelector('[data-code-path]')?.getAttribute('data-code-path') ?? '').replace(/\\\\/g, '/')`;
            const opened =
                clicked && (await polishWaitFor(h, `${openFile}.endsWith(${JSON.stringify(RADAR_SEED_FILE)})`, 10000));
            const surface = await h.activeSurfaceLabel();
            // the viewer scrolls to the line once the text lands
            await polishNap(800);
            await h.shot("cdp-shots/radar-site-in-code.png");
            rec(
                "7. the site link opens Code at the line",
                opened === true && surface === SURFACE_LABEL.code,
                JSON.stringify({ clicked, surface, file: await h.ev(openFile), line: RADAR_SEED_LINE })
            );
        }

        {
            await radarOpen(h);
            const shown = await radarMock(h, "results", "report");
            const read = () =>
                h.ev(`(() => {
                    const root = ${RADAR_ROOT};
                    if (!root) return null;
                    return {
                        text: (root.textContent ?? '').toLowerCase(),
                        lens: !!root.querySelector('[aria-label="Lens"]'),
                        evidenceTitles: [...root.querySelectorAll('[title]')]
                            .map((el) => el.getAttribute('title'))
                            .filter((t) => / evidence$/i.test(t)),
                    };
                })()`);
            // an open finding's detail, then the one closed as Intentional, which used to read Suppressed
            const views = [await read()];
            const suppressed = await radarClick(h, '[data-radar-group="dismissed"] [data-radar-finding-row]:last-child');
            await polishNap(300);
            views.push(await read());
            const found = RADAR_REMOVED_TEXT.filter((t) => views.some((v) => v?.text.includes(t.toLowerCase())));
            const lens = views.some((v) => v?.lens);
            const evidenceTitles = views.flatMap((v) => v?.evidenceTitles ?? []);
            rec(
                "8. nothing the Removed board marks is on the surface",
                shown &&
                    suppressed &&
                    views.every((v) => v != null) &&
                    found.length === 0 &&
                    !lens &&
                    evidenceTitles.length === 0,
                JSON.stringify({ shown, suppressed, found, lens, evidenceTitles })
            );
        }

        {
            const shown = await radarMock(h, "carried", "report");
            const f = await radarFacts(h);
            rec(
                "9. carried findings with nothing new to audit",
                shown && f.rootText.includes("no new fix commits") && f.toggle == null && f.strip == null,
                JSON.stringify({
                    view: f?.view ?? null,
                    metaLine: f?.rootText.includes("no new fix commits") ?? null,
                    toggle: f?.toggle ?? null,
                    strip: f?.strip ?? null,
                    findings: f?.findingRows ?? null,
                })
            );
        }
        return steps;
    },
    async teardown(h, ctx) {
        try {
            await h.ev(`window.__setRadarScenario?.('live')`);
            if ("priorScope" in ctx) {
                await h.ev(
                    ctx.priorScope == null
                        ? `localStorage.removeItem(${JSON.stringify(RADAR_SCOPE_KEY)})`
                        : `localStorage.setItem(${JSON.stringify(RADAR_SCOPE_KEY)}, ${JSON.stringify(ctx.priorScope)})`
                );
            }
        } finally {
            try {
                if (ctx.reportId) await dropPeekItemsRadar(h, ctx.reportId);
            } finally {
                await polishReload(h);
            }
        }
    },
};

const radarScanStates = {
    name: "radar-scan-states",
    surface: "radar",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const hook = await radarOpen(h);
        // draws the fixture, reads the surface and takes the step's shot
        const draw = async (name, view, shot) => {
            const shown = await radarMock(h, name, view);
            const f = await radarFacts(h);
            await h.shot(`cdp-shots/${shot}.png`);
            return { shown: hook && shown && f != null, f };
        };
        const states = (f) => JSON.stringify(radarStates(f));

        {
            const { shown, f } = await draw("scanning", "scanning", "radar-scanning");
            const seen = radarStates(f);
            rec(
                "1. a scan in progress lists each commit as audited, auditing or queued, with hits",
                shown &&
                    seen.length === 8 &&
                    ["queued", "running", "hits"].every((s) => seen.includes(s)) &&
                    hasAll(f.bodyText, ["3 of 8 audited", "2 hits"]) &&
                    f.buttons.includes("Cancel scan"),
                JSON.stringify({ hook, view: f?.view ?? null, states: seen, buttons: f?.buttons ?? null })
            );
        }
        {
            const { shown, f } = await draw("selecting", "scanning", "radar-selecting");
            rec(
                "2. selecting commits shows the scan panel with no rows",
                shown && f.audits.length === 0 && f.bodyText.includes("selecting fix commits"),
                `rows=${f?.audits.length ?? null} text="${f?.bodyText.slice(0, 200) ?? ""}"`
            );
        }
        {
            const { shown, f } = await draw("clean", "audits", "radar-clean");
            rec(
                "3. a clean scan says no sibling bugs and lists the audited commits",
                shown &&
                    f.title === "No sibling bugs in 5 fix commits" &&
                    f.audits.length === 5 &&
                    f.audits.every((a) => a.state === "clean") &&
                    f.strip == null &&
                    f.project === "Scanned project: waveterm" &&
                    f.rescan,
                `title="${f?.title ?? ""}" states=${states(f)} strip=${f?.strip ?? null} project="${f?.project ?? ""}" rescan=${f?.rescan ?? null}`
            );
        }
        {
            const { shown, f } = await draw("failed", "audits", "radar-failed");
            rec(
                "4. a fully failed scan shows the strip and each commit's error",
                shown &&
                    f.strip != null &&
                    f.retry === true &&
                    f.audits.length > 0 &&
                    f.audits.every((a) => a.state === "failed" && a.text.includes(RADAR_AUDIT_ERROR)),
                `strip="${f?.strip ?? ""}" retryEnabled=${f?.retry ?? null} states=${states(f)} row="${f?.audits[0]?.text ?? ""}"`
            );
        }
        {
            const { shown, f } = await draw("no-commits", "audits", "radar-no-commits");
            rec(
                "5. no new fix commits",
                shown && f.title === "No new fix commits to audit" && !f.auditList,
                `title="${f?.title ?? ""}" auditList=${f?.auditList ?? null}`
            );
        }
        {
            const { shown, f } = await draw("fatal", "fatal", "radar-fatal");
            rec(
                "6. a fatal failure shows the error",
                shown && f.bodyText.includes("not a readable git repository") && f.buttons.includes("Scan again"),
                `title="${f?.title ?? ""}" text="${f?.bodyText.slice(0, 200) ?? ""}" buttons=${JSON.stringify(f?.buttons ?? null)}`
            );
        }
        {
            const { shown, f } = await draw("cancelled", "cancelled", "radar-cancelled");
            rec("7. a cancelled scan", shown, `view=${f?.view ?? null} title="${f?.title ?? ""}"`);
        }
        {
            const { shown, f } = await draw("old-format", "old-format", "radar-old-format");
            rec(
                "8. an old-format report asks for a re-scan",
                shown &&
                    f.title === "This report was written by an older Radar" &&
                    f.buttons.includes("Re-scan") &&
                    f.findingRows === 0,
                `title="${f?.title ?? ""}" buttons=${JSON.stringify(f?.buttons ?? null)} findingRows=${f?.findingRows ?? null}`
            );
        }
        {
            const { shown, f } = await draw("never-scanned", "never-scanned", "radar-never-scanned");
            rec(
                "9. a project never scanned",
                shown &&
                    f.title.endsWith("hasn't been scanned") &&
                    f.buttons.includes("Scan repository") &&
                    !/collector/i.test(f.bodyText),
                `title="${f?.title ?? ""}" buttons=${JSON.stringify(f?.buttons ?? null)} text="${f?.bodyText.slice(0, 240) ?? ""}"`
            );
        }
        return steps;
    },
    // the fixtures live in module state; a reload drops whatever one left drawn
    async teardown(h) {
        try {
            await h.ev(`window.__setRadarScenario?.('live')`);
        } finally {
            await polishReload(h);
        }
    },
};

// --- canvas mode swaps with the terminal, which stays mounted ----------------------------------------
// final-verify boots a fresh store with no agents, so the scenario opens its own plain terminal tab the way
// launchAgent does (CreateTab, then the terminal meta) and reveals a temp canvas as that terminal's. CreateTab is
// a wavesrv service call, which the page cannot reach cross-origin, so Node makes it with the page's auth key.
// wavesrv serves the fixture board, so the pane shows it; the swap is under test, not the board.
const CANVAS_TOPIC = "verify-canvas";
const CANVAS_BOARD = "Main.dc.html";
const CANVAS_PANE = `document.querySelector("[data-canvas-pane]")`;
const CANVAS_SWAP = `document.querySelector('[role="group"][aria-label="Show terminal or canvas"]')`;
const CANVAS_TREE_TAG = `[...document.querySelectorAll("[data-agent-tree] button[aria-pressed]")].find((b) => (b.textContent || "").trim().startsWith("canvas"))`;
// the poller ticks every 3s (CANVAS_POLL_MS), so one tick always lands inside this
const CANVAS_REMOVED_WAIT_MS = 5000;
const CANVAS_ROSTER_WAIT_MS = 10000;
const CANVAS_KEYS = { c: { key: "c", code: "KeyC", keyCode: 67 }, x: { key: "x", code: "KeyX", keyCode: 88 } };

// a method that takes a UIContext (object.UpdateObject) refuses a call without one
async function waveService(h, service, method, args, uicontext = null) {
    const [endpoint, key] = await h.ev(`[window.api.getEnv("WAVE_SERVER_WEB_ENDPOINT"), window.api.getAuthKey()]`);
    const res = await fetch(`http://${endpoint}/wave/service?service=${service}&method=${method}`, {
        method: "POST",
        headers: { "x-authkey": key },
        body: JSON.stringify({ service, method, args, uicontext }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body == null || body.error) {
        throw new Error(`${service}.${method}: ${body?.error ?? `HTTP ${res.status}`}`);
    }
    return body.data;
}

// the workspace of the page's own tab, so the terminal lands in the window under test
async function openCanvasTerminal(h, ctx) {
    const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
    const wslist = await h.rpc("workspacelist", null);
    const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
    ctx.workspaceId = ws.workspacedata.oid;
    ctx.tabId = await waveService(h, "workspace", "CreateTab", [ctx.workspaceId, CANVAS_TOPIC, false]);
    const tab = await waveService(h, "object", "GetObject", [`tab:${ctx.tabId}`]);
    ctx.blockId = tab?.blockids?.[0];
    if (!ctx.blockId) throw new Error("the new tab has no block");
    // the shell starts in ~, not the temp dir: something in the app tree keeps its cwd locked until the app exits,
    // so teardown could not delete it. The reveal names its cwd itself (callercwd), so this changes nothing tested
    await h.rpc("setmeta", {
        oref: `block:${ctx.blockId}`,
        meta: { view: "term", controller: "shell", "cmd:cwd": "~" },
    });
    await h.rpc("setmeta", { oref: `tab:${ctx.tabId}`, meta: { "session:project": CANVAS_TOPIC } });
}

const pressCanvasKey = async (h, { key, code, keyCode }) => {
    await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, windowsVirtualKeyCode: keyCode });
    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    await polishNap(500);
};

const clickCanvasSwap = (h, label) =>
    h.ev(`(() => {
        const b = [...(${CANVAS_SWAP}?.querySelectorAll("button") ?? [])]
            .find((x) => (x.textContent || "").trim() === ${JSON.stringify(label)});
        if (!b) return false;
        b.click();
        return true;
    })()`);

const canvasSwap = {
    name: "canvas-swap",
    surface: "agent",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-canvas-"));
        const project = join(cwd, ".superpowers", "design", CANVAS_TOPIC, "project");
        mkdirSync(project, { recursive: true });
        writeFileSync(
            join(project, "canvas.json"),
            JSON.stringify({ boards: { [CANVAS_BOARD]: { w: 1440 } }, order: [CANVAS_BOARD] })
        );
        writeFileSync(join(project, CANVAS_BOARD), "<!doctype html><title>verify canvas</title><p>verify canvas</p>");
        const ctx = { cwd };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await openCanvasTerminal(h, ctx);
        } catch (e) {
            ctx.launchError = String(e?.message ?? e);
            return ctx;
        }
        await h.goto("agent");
        ctx.inRoster = await polishWaitFor(
            h,
            `!!document.querySelector('[data-agent-terminal="${ctx.tabId}"]')`,
            CANVAS_ROSTER_WAIT_MS
        );
        return ctx;
    },
    async assert(h, ctx) {
        if (ctx.launchError != null) {
            return [skipStep("canvas swap", `could not verify: the terminal launch failed: ${ctx.launchError}`)];
        }
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const TERM = `document.querySelector('[data-agent-terminal="${ctx.tabId}"]')`;
        rec("0. the launched terminal is in the roster", ctx.inRoster === true, `tab=${ctx.tabId}`);
        if (!ctx.inRoster) return steps;

        // tagged before any swap: a remount would drop the attribute with the node
        const tagged = await h.ev(`(() => {
            const t = ${TERM};
            t.setAttribute("data-verify-mark", "canvas-swap");
            const x = t.querySelector(".xterm");
            if (x) x.setAttribute("data-verify-mark", "canvas-swap");
            return { xterm: !!x };
        })()`);

        let revealError = null;
        try {
            await h.rpc(
                "uireveal",
                { address: `canvas:${CANVAS_TOPIC}`, callerblockid: ctx.blockId, callercwd: ctx.cwd },
                UI_ROUTE
            );
        } catch (e) {
            revealError = String(e?.message ?? e);
        }
        // an agent's reveal only attaches; the user opens the canvas from the row's tag
        const attached = await polishWaitFor(h, `!!${CANVAS_TREE_TAG}`, 3000);
        const paneAfterReveal = await h.ev(`!!${CANVAS_PANE}`);
        rec(
            "1. uireveal canvas:<topic> from the terminal attaches the canvas without switching to it",
            revealError == null && attached && !paneAfterReveal,
            `tag=${attached} pane=${paneAfterReveal} error=${revealError}`
        );
        await h.ev(`${CANVAS_TREE_TAG}?.click()`);
        const paneUp = await polishWaitFor(h, `!!${CANVAS_PANE}`, 3000);
        const swap = await h.ev(`(() => {
            const g = ${CANVAS_SWAP};
            return g ? [...g.querySelectorAll("button")].map((b) => (b.textContent || "").trim()) : null;
        })()`);
        const treeKept = await h.ev(`!!document.querySelector("[data-agent-tree]")`);
        rec("1b. the row's canvas tag shows the canvas pane in the terminal's place", paneUp, `pane=${paneUp}`);
        rec("2. canvas mode keeps the agent tree", treeKept === true, `treeKept=${treeKept}`);
        rec(
            "3. the header swaps between Terminal and Canvas",
            JSON.stringify(swap) === JSON.stringify(["Terminal", "Canvas"]),
            `buttons=${JSON.stringify(swap)}`
        );
        await h.shot("cdp-shots/canvas-swap-canvas.png");

        // a real click puts the page in focus, which CDP key events need to reach it at all
        const box = await h.ev(`(() => {
            const r = ${CANVAS_PANE}?.querySelector("span")?.getBoundingClientRect();
            return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
        })()`);
        if (box) {
            for (const type of ["mousePressed", "mouseReleased"]) {
                await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
            }
        }
        // x is bound nowhere, so the probe seeing it proves key events arrive: a c that then does nothing is a
        // real failure, not an undelivered key
        await h.ev(`(() => {
            window.__canvasSeen = [];
            window.__canvasProbe = (e) => window.__canvasSeen.push(e.key);
            window.addEventListener("keydown", window.__canvasProbe, true);
            return true;
        })()`);
        await pressCanvasKey(h, CANVAS_KEYS.x);
        const delivered = await h.ev(`window.__canvasSeen.includes("x")`);
        await h.ev(`window.removeEventListener("keydown", window.__canvasProbe, true)`);

        const toTerminal = delivered ? await pressCanvasKey(h, CANVAS_KEYS.c) : await clickCanvasSwap(h, "Terminal");
        await polishNap(300);
        const back = await h.ev(`(() => {
            const t = ${TERM};
            const x = t?.querySelector(".xterm");
            return {
                pane: !!${CANVAS_PANE},
                visible: !!t && !t.classList.contains("hidden"),
                sameNode: t?.getAttribute("data-verify-mark") === "canvas-swap",
                sameXterm: x == null ? null : x.getAttribute("data-verify-mark") === "canvas-swap",
            };
        })()`);
        const keyed = delivered ? "c" : "the Terminal button (CDP keys did not reach the page)";
        rec(
            `4. ${keyed} returns to the terminal`,
            toTerminal !== false && !back.pane && back.visible,
            JSON.stringify({ delivered, ...back })
        );
        rec(
            "5. the terminal was hidden, not remounted",
            back.sameNode && (tagged.xterm ? back.sameXterm === true : true),
            JSON.stringify({ taggedXterm: tagged.xterm, sameNode: back.sameNode, sameXterm: back.sameXterm })
        );
        const tag = await h.ev(`!!${CANVAS_TREE_TAG}`);
        rec("6. the agent tree tags the terminal's row canvas", tag === true, `tag=${tag}`);
        if (!delivered) {
            steps.push(skipStep("4b. the c key itself", "CDP key events never reached the page; drove the header instead"));
        }

        // back in the terminal the xterm holds focus and would take the c; leave it the way Esc does
        await h.ev(`(() => {
            document.activeElement?.blur?.();
            document.querySelector("[data-cockpit-surface-wrap]")?.focus();
            return true;
        })()`);
        if (delivered) await pressCanvasKey(h, CANVAS_KEYS.c);
        else await clickCanvasSwap(h, "Canvas");
        const again = await polishWaitFor(h, `!!${CANVAS_PANE}`, 2000);
        rec(`7. ${delivered ? "c" : "the Canvas button"} brings the canvas back`, again, `pane=${again}`);

        rmSync(join(ctx.cwd, ".superpowers", "design", CANVAS_TOPIC), { recursive: true, force: true });
        const removed = await polishWaitFor(
            h,
            `(${CANVAS_PANE}?.textContent || "").includes(${JSON.stringify(`${CANVAS_TOPIC} was removed`)})`,
            CANVAS_REMOVED_WAIT_MS
        );
        rec("8. deleting the canvas folder shows the removed state", removed, `removed=${removed}`);
        await h.shot("cdp-shots/canvas-swap-removed.png");
        return steps;
    },
    // best-effort, so one failed step does not strand the rest
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`canvas-swap teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("leave the canvas", () =>
            h.ev(`(() => {
                const b = [...(${CANVAS_PANE}?.querySelectorAll("button") ?? [])]
                    .find((x) => (x.textContent || "").trim() === "Back to terminal");
                if (b) b.click();
                return true;
            })()`)
        );
        if (ctx.tabId) {
            await step("close the terminal tab", () =>
                waveService(h, "workspace", "CloseTab", [ctx.workspaceId, ctx.tabId, false])
            );
        }
        await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
        await step("go home", () => h.goto("cockpit"));
    },
};

// --- canvas board tabs: each board on its own tab, and All lays them side by side -------------------------
// Unlike canvas-swap, the boards are under test: wavesrv serves them from the fixture's design folder.
const CANVAS_TABS_TOPIC = "verify-canvas-tabs";
const CANVAS_TABS = `document.querySelector('[role="tablist"][aria-label="Boards"]')`;
// the serve call, a canvas.json read and the board HEADs all land inside one 3s poll tick; two ticks is the margin
const CANVAS_TABS_WAIT_MS = 8000;

const canvasTabFrames = (h) =>
    h.ev(`(() => ({
        tabs: [...(${CANVAS_TABS}?.querySelectorAll('[role="tab"]') ?? [])].map((b) => (b.textContent || "").trim()),
        frames: [...document.querySelectorAll("[data-canvas-frame]")].map((f) => f.getAttribute("data-canvas-frame")),
    }))()`);

const clickCanvasTab = async (h, label) => {
    await h.ev(`[...(${CANVAS_TABS}?.querySelectorAll('[role="tab"]') ?? [])].find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)})?.click()`);
    await polishNap(400);
    return canvasTabFrames(h);
};

const canvasTabsScenario = {
    name: "canvas-tabs",
    surface: "agent",
    async arrange(h) {
        const cwd = mkdtempSync(join(tmpdir(), "verify-canvas-tabs-"));
        const project = join(cwd, ".superpowers", "design", CANVAS_TABS_TOPIC, "project");
        mkdirSync(project, { recursive: true });
        writeFileSync(
            join(project, "canvas.json"),
            JSON.stringify({
                boards: {
                    "Main.dc.html": { x: 0, y: 0, w: 640, h: 480, title: "A" },
                    "Cards.dc.html": { x: 720, y: 0, w: 640, h: 480, title: "B" },
                },
                order: ["Main.dc.html", "Cards.dc.html"],
            })
        );
        for (const name of ["Main", "Cards"]) {
            writeFileSync(join(project, `${name}.dc.html`), `<!doctype html><title>${name}</title><p>${name} board</p>`);
        }
        const ctx = { cwd };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await openCanvasTerminal(h, ctx);
        } catch (e) {
            ctx.launchError = String(e?.message ?? e);
            return ctx;
        }
        await h.goto("agent");
        ctx.inRoster = await polishWaitFor(
            h,
            `!!document.querySelector('[data-agent-terminal="${ctx.tabId}"]')`,
            CANVAS_ROSTER_WAIT_MS
        );
        return ctx;
    },
    async assert(h, ctx) {
        if (ctx.launchError != null) {
            return [skipStep("canvas tabs", `could not verify: ${ctx.launchError}`)];
        }
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec("0. the launched terminal is in the roster", ctx.inRoster === true, `tab=${ctx.tabId}`);
        if (!ctx.inRoster) return steps;

        await h.rpc(
            "uireveal",
            { address: `canvas:${CANVAS_TABS_TOPIC}`, callerblockid: ctx.blockId, callercwd: ctx.cwd },
            UI_ROUTE
        );
        await polishWaitFor(h, `!!${CANVAS_TREE_TAG}`, 3000);
        await h.ev(`${CANVAS_TREE_TAG}?.click()`);
        const loaded = await polishWaitFor(
            h,
            `(${CANVAS_TABS}?.querySelectorAll('[role="tab"]').length ?? 0) === 3`,
            CANVAS_TABS_WAIT_MS
        );
        const first = await canvasTabFrames(h);
        rec(
            "1. the header offers All and one tab per board, and opens on the first board alone",
            loaded && JSON.stringify(first.tabs) === JSON.stringify(["All", "Main", "Cards"]) &&
                JSON.stringify(first.frames) === JSON.stringify(["Main.dc.html"]),
            JSON.stringify({ loaded, ...first })
        );
        const all = await clickCanvasTab(h, "All");
        await h.shot("cdp-shots/canvas-tabs-all.png");
        rec(
            "2. All lays every board out side by side",
            JSON.stringify(all.frames) === JSON.stringify(["Main.dc.html", "Cards.dc.html"]),
            JSON.stringify(all)
        );
        const cards = await clickCanvasTab(h, "Cards");
        await h.shot("cdp-shots/canvas-tabs-cards.png");
        rec(
            "3. a board's tab shows that board alone",
            JSON.stringify(cards.frames) === JSON.stringify(["Cards.dc.html"]),
            JSON.stringify(cards)
        );
        return steps;
    },
    // best-effort, so one failed step does not strand the rest
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`canvas-tabs teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("leave the canvas", () => clickCanvasSwap(h, "Terminal"));
        if (ctx.tabId) {
            await step("close the terminal tab", () =>
                waveService(h, "workspace", "CloseTab", [ctx.workspaceId, ctx.tabId, false])
            );
        }
        await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
        await step("go home", () => h.goto("cockpit"));
    },
};

// The Cockpit's j/k/n/Enter are the container's own onKeyDown (usecockpitkeyboard.ts), so they work only
// while focus is inside it. Arriving from the Agent surface left focus on <body> (the palette's restore
// target, the xterm, is display:none by then) or on the nav button, and every Cockpit key was dead until a
// click. A key is dispatched at whatever holds focus, which is where a real keypress would land.
const COCKPIT_SURFACE = `document.querySelector('[data-cockpit-surface]')`;
const cockpitKeyReach = `(() => {
    const c = ${COCKPIT_SURFACE};
    if (!c) return { reached: false, active: 'no cockpit surface' };
    let reached = false;
    const probe = (e) => { if (e.key === 'j') reached = true; };
    c.addEventListener('keydown', probe, true);
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true, cancelable: true }));
    c.removeEventListener('keydown', probe, true);
    return { reached, active: target.tagName + (target.getAttribute('data-cockpit-surface') != null ? '[cockpit]' : '') };
})()`;
const focusAgentXterm = `(() => {
    const t = [...document.querySelectorAll('.xterm-helper-textarea')].find((x) => x.checkVisibility());
    t?.focus();
    return t != null;
})()`;

const cockpitKeysOnArrival = {
    name: "cockpit-keys-on-arrival",
    surface: "cockpit",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);

        await h.goto("agent");
        await h.ev(focusAgentXterm);
        const opened = await openPalette(h);
        await h.ev(setInputExpr(PALETTE_INPUT, "cockpit"));
        await polishNap(300);
        await h.ev(paletteKey("Enter"));
        await polishWaitFor(h, `!!${COCKPIT_SURFACE}`, 3000);
        await polishNap(300);
        const viaPalette = await h.ev(cockpitKeyReach);
        steps.push({
            step: "Agent -> Ctrl+P 'cockpit' -> Enter: j reaches the Cockpit",
            ok: opened === true && viaPalette.reached === true,
            detail: `palette=${opened} active=${viaPalette.active}`,
        });

        await h.goto("agent");
        await h.ev(focusAgentXterm);
        await h.goto("cockpit");
        const viaNav = await h.ev(cockpitKeyReach);
        steps.push({
            step: "Agent -> nav click Cockpit: j reaches the Cockpit",
            ok: viaNav.reached === true,
            detail: `active=${viaNav.active}`,
        });
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// The Agent surface stays mounted, so its focus effects never re-run on a switch back: arriving left focus on
// <body> and typing reached the agent only after a click on its terminal.
const agentTerminalFocused = `(() => {
    const t = [...document.querySelectorAll('.xterm-helper-textarea')].find((x) => x.checkVisibility());
    if (!t) return { terminal: false, focused: false, active: document.activeElement?.tagName };
    return { terminal: true, focused: document.activeElement === t, active: document.activeElement?.tagName };
})()`;

const agentTerminalOnArrival = {
    name: "agent-terminal-on-arrival",
    surface: "agent",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        await h.goto("agent");
        if (!(await h.ev(agentTerminalFocused)).terminal) {
            return [skipStep("the Agent surface shows a live terminal", "no agent terminal: launch one agent first")];
        }

        await h.goto("cockpit");
        await h.goto("agent");
        const viaNav = await h.ev(agentTerminalFocused);
        steps.push({
            step: "Cockpit -> nav click Agent: the terminal has focus",
            ok: viaNav.focused === true,
            detail: `active=${viaNav.active}`,
        });

        await h.goto("cockpit");
        const opened = await openPalette(h);
        await h.ev(setInputExpr(PALETTE_INPUT, "agent"));
        await polishNap(300);
        // "New agent…" outranks the go-to row, so step down to the row that is the surface itself
        const goRow = await h.ev(
            `[...(${PALETTE}?.querySelectorAll('button[data-idx]') ?? [])].findIndex((b) => /^Agent\\s*ga$/.test((b.textContent || '').replace(/\\s+/g, '')))`
        );
        for (let i = 0; i < goRow; i++) {
            await h.ev(paletteKey("ArrowDown"));
        }
        const row = await h.ev(`(${PALETTE_STATE})?.selected ?? null`);
        await h.ev(paletteKey("Enter"));
        await polishWaitFor(h, `(${agentTerminalFocused}).terminal`, 3000);
        await polishNap(300);
        const viaPalette = await h.ev(agentTerminalFocused);
        steps.push({
            step: "Cockpit -> Ctrl+P 'agent' -> Enter: the terminal has focus",
            ok: opened === true && viaPalette.focused === true,
            detail: `row=${row} active=${viaPalette.active}`,
        });
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// The Code tree's keys are gated on the tree holding focus (codeTreeFocusedAtom); arriving left it on
// <body>, so j/k/arrows/Enter were dead until a click or Alt+T.
const codeTreeOnArrival = {
    name: "code-tree-on-arrival",
    surface: "code",
    async arrange() {
        return {};
    },
    async assert(h) {
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        // the tree learns it has focus from its focus event, which Chromium holds back while the dev
        // window is behind another one
        await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
        await h.goto("code");
        if (!(await h.ev(`document.querySelector('[data-code-tree]')?.checkVisibility() ?? false`))) {
            return [skipStep("the Code surface shows its file tree", "no tree: pick a project on Code first")];
        }
        await h.goto("agent");
        await h.ev(focusAgentXterm);
        await h.goto("code");
        const r = await h.ev(`(() => {
            const a = document.activeElement;
            const e = new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true, cancelable: true });
            (a ?? document.body).dispatchEvent(e);
            return { inTree: a?.closest?.('[data-code-tree]') != null, claimed: e.defaultPrevented, active: a?.tagName };
        })()`);
        return [
            {
                step: "Agent -> nav click Code: the tree has focus and j moves its cursor",
                ok: r.inTree === true && r.claimed === true,
                detail: `active=${r.active} inTree=${r.inTree} claimed=${r.claimed}`,
            },
        ];
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};

// --- settings-radar-audit: the Radar audit route row in Settings > Headless AI ------------------------
// The row's picker offers claude and pi only (an audit session needs tools) and writes radar:auditruntime
// and radar:auditmodel. The picker panel is portalled to the body, so its options are scoped to the panel
// and everything else to the section pane.
const RADAR_AUDIT_KEYS = ["radar:auditruntime", "radar:auditmodel"];
const RADAR_AUDIT_PANE = `document.querySelector('[data-settings-section="headless"]')`;
const RADAR_AUDIT_ROW = `${RADAR_AUDIT_PANE}?.querySelector('[data-setting-row="headless.radaraudit"]')`;
const RADAR_AUDIT_TRIGGER = `${RADAR_AUDIT_ROW}?.querySelector('[data-testid="route-picker"]')`;
const RADAR_AUDIT_PANEL = `document.querySelector('[aria-label="Available routes"]')`;
// a cold app is still enumerating the installed CLIs' models when the picker opens, so the panel has no chip
// or row until ListHarnessesCommand answers; twice its client timeout (CATALOG_RPC_TIMEOUT_MS, harnessstore.ts)
const RADAR_AUDIT_CATALOG_WAIT_MS = 60_000;
const RADAR_AUDIT_CATALOG_UP = `${RADAR_AUDIT_PANEL}?.querySelector('[data-testid^="route-harness-"], [data-testid^="route-option-"]') != null`;
const radarAuditFace = (h) => h.ev(`(${RADAR_AUDIT_TRIGGER}?.textContent || "").trim()`);

const settingsRadarAudit = {
    name: "settings-radar-audit",
    surface: "settings",
    async arrange(h) {
        const settings = (await h.rpc("getfullconfig", null))?.settings ?? {};
        const prev = Object.fromEntries(RADAR_AUDIT_KEYS.map((k) => [k, settings[k] ?? null]));
        await h.rpc("setconfig", Object.fromEntries(RADAR_AUDIT_KEYS.map((k) => [k, null])));
        return { prev };
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });

        await h.goto("settings");
        await h.ev(`document.querySelector('[data-section="headless"]')?.click()`);
        const paneUp = await polishWaitFor(h, `${RADAR_AUDIT_PANE} != null`, 5000);
        rec("1. Settings opens on the Headless AI section", paneUp, `pane=${paneUp}`);

        await polishWaitFor(h, `(${RADAR_AUDIT_TRIGGER}?.textContent || "").includes("sonnet")`, 5000);
        const title = await h.ev(`(${RADAR_AUDIT_ROW}?.textContent || "").includes("Radar audit")`);
        const unsetFace = await radarAuditFace(h);
        rec(
            "2. the Radar audit row shows claude on sonnet when both keys are unset",
            title === true && /claude/i.test(unsetFace) && unsetFace.includes("sonnet"),
            `row=${title} face="${unsetFace}"`
        );
        await h.ev(`${RADAR_AUDIT_ROW}?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await h.shot("cdp-shots/settings-radar-audit-closed.png");

        await h.ev(`${RADAR_AUDIT_TRIGGER}?.click()`);
        const catalogStart = Date.now();
        const catalogUp = await polishWaitFor(h, RADAR_AUDIT_CATALOG_UP, RADAR_AUDIT_CATALOG_WAIT_MS);
        const catalogMs = Date.now() - catalogStart;
        // "Loading models…" or "No run routes available.": tells a catalog that never answered from a slow one
        const emptyText = catalogUp
            ? ""
            : await h.ev(`(${RADAR_AUDIT_PANEL}?.querySelector('[data-testid="route-picker-scroll"]')?.textContent || "").trim()`);
        // the harness chips name every runtime the picker offers; the rows only the scoped one
        const offered = await h.ev(`(() => {
            const panel = ${RADAR_AUDIT_PANEL};
            if (!panel) return null;
            return [...panel.querySelectorAll('[data-testid^="route-harness-"]')]
                .map((c) => c.getAttribute("data-testid").slice("route-harness-".length))
                .filter((r) => r !== "all")
                .sort();
        })()`);
        rec(
            "3. the picker offers claude and pi and no other runtime",
            JSON.stringify(offered) === JSON.stringify(["claude", "pi"]),
            catalogUp
                ? `offered=${JSON.stringify(offered)} catalog=${catalogMs}ms`
                : `offered=${JSON.stringify(offered)} no routes after ${catalogMs}ms, panel reads "${emptyText}"`
        );
        await h.shot("cdp-shots/settings-radar-audit-open.png");

        await h.ev(`${RADAR_AUDIT_PANEL}?.querySelector('[data-testid="route-harness-pi"]')?.click()`);
        await polishWaitFor(h, `${RADAR_AUDIT_PANEL}?.querySelector('[data-testid^="route-option-pi-"]') != null`, 3000);
        const picked = await h.ev(`(() => {
            const row = ${RADAR_AUDIT_PANEL}?.querySelector('[data-testid^="route-option-pi-"]');
            if (!row) return null;
            row.click();
            return row.getAttribute("data-testid").slice("route-option-pi-".length);
        })()`);
        let stored = {};
        for (let waited = 0; waited < 5000 && stored["radar:auditruntime"] !== "pi"; waited += 250) {
            await polishNap(250);
            stored = (await h.rpc("getfullconfig", null))?.settings ?? {};
        }
        await polishWaitFor(h, `(${RADAR_AUDIT_TRIGGER}?.textContent || "").includes(${JSON.stringify(picked ?? "\u0000")})`, 5000);
        const piFace = await radarAuditFace(h);
        rec(
            "4. picking a pi route stores radar:auditruntime as pi and the row shows it",
            picked != null &&
                stored["radar:auditruntime"] === "pi" &&
                stored["radar:auditmodel"] === picked &&
                /^pi\b/i.test(piFace) &&
                piFace.includes(picked),
            `picked=${picked} runtime=${stored["radar:auditruntime"]} model=${stored["radar:auditmodel"]} face="${piFace}"`
        );

        const mid = await h.ev(`(() => {
            const pane = ${RADAR_AUDIT_PANE};
            if (!pane) return null;
            return {
                row: pane.querySelector('[data-setting-row="headless.mid"]') != null,
                text: /mid model/i.test(pane.textContent || ""),
                rows: [...pane.querySelectorAll("[data-setting-row]")].map((r) => r.getAttribute("data-setting-row")),
            };
        })()`);
        rec(
            "5. the section has no Mid model row",
            mid != null && mid.row === false && mid.text === false && mid.rows.includes("headless.cheap"),
            JSON.stringify(mid)
        );
        return steps;
    },
    async teardown(h, ctx) {
        await h.rpc("setconfig", ctx.prev);
        await h.goto("cockpit");
    },
};

// --- settings-vault-sync: the Sync now button on Settings > Vault's Sync remote row ---------------------
// The dev app is pointed at a throwaway vault (wavevault opens the configured root on every call), first with
// no remote, then with a bare temp remote, then with a remote that does not exist. The configured vault is
// never touched: under a plain `task dev` it may be the user's real one. The error note renders as a sibling
// after the row, so its absence is checked in the whole section pane.
const VAULT_PANE = `document.querySelector('[data-settings-section="memory"]')`;
const VAULT_ROW = `${VAULT_PANE}?.querySelector('[data-setting-row="memory.remote"]')`;
const VAULT_SYNC_BTN = `${VAULT_PANE}?.querySelector('[data-testid="vault-sync-now"]')`;
const VAULT_SYNC_STATUS = `${VAULT_PANE}?.querySelector('[data-testid="vault-sync-status"]')`;
const VAULT_SYNC_ERROR = `${VAULT_PANE}?.querySelector('[data-testid="vault-sync-error"]')`;
// a first push to an empty bare remote is quick; a sync that takes longer is a failure worth seeing
const VAULT_SYNC_WAIT_MS = 30_000;
const vaultSyncState = (h) =>
    h.ev(`(() => {
        const b = ${VAULT_SYNC_BTN};
        const s = ${VAULT_SYNC_STATUS};
        return {
            button: b ? { label: (b.textContent || "").trim(), disabled: b.disabled } : null,
            status: s ? (s.textContent || "").trim() : null,
            note: ${VAULT_SYNC_ERROR} != null,
        };
    })()`);

// the section loads the vault status once, on mount, so a remote set over RPC shows only after a remount
async function openVaultSection(h) {
    await h.goto("cockpit");
    await h.goto("settings");
    await h.ev(`document.querySelector('[data-section="memory"]')?.click()`);
    return polishWaitFor(h, `${VAULT_ROW} != null && ${VAULT_SYNC_STATUS} != null`, 5000);
}

async function teardownVaultSync(h, ctx) {
    if (ctx.vaultConfigured) {
        await h.rpc("vaultsetremote", { url: "" });
        await h.rpc("setconfig", { "memory:vaultpath": ctx.prevVaultPath });
    }
    for (const dir of [ctx.vault, ctx.remote]) {
        if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
}

const settingsVaultSync = {
    name: "settings-vault-sync",
    surface: "settings",
    async arrange(h) {
        const settings = (await h.rpc("getfullconfig", null))?.settings ?? {};
        const ctx = { prevVaultPath: settings["memory:vaultpath"] ?? null };
        try {
            ctx.vault = mkdtempSync(join(tmpdir(), "verify-vault-"));
            ctx.remote = mkdtempSync(join(tmpdir(), "verify-vault-remote-"));
            execFileSync("git", ["init", "--bare", ctx.remote], { stdio: "ignore" });
            await h.rpc("setconfig", { "memory:vaultpath": ctx.vault });
            ctx.vaultConfigured = true;
        } catch (e) {
            await teardownVaultSync(h, ctx);
            throw e;
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });

        const opened = await openVaultSection(h);
        await polishWaitFor(h, `(${VAULT_SYNC_STATUS}?.textContent || "").includes("Sync off")`, 5000);
        const off = await vaultSyncState(h);
        rec(
            "1. with no remote the Sync now button is disabled and the status reads Sync off",
            opened &&
                off.button?.label === "Sync now" &&
                off.button.disabled === true &&
                off.status === "Sync off — no remote",
            JSON.stringify(off)
        );
        await h.ev(`${VAULT_ROW}?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await h.shot("cdp-shots/settings-vault-sync-off.png");

        await h.rpc("vaultsetremote", { url: ctx.remote });
        await openVaultSection(h);
        await polishWaitFor(h, `${VAULT_SYNC_BTN}?.disabled === false`, 5000);
        const idle = await vaultSyncState(h);
        rec(
            "2. with a remote the Sync now button is enabled",
            idle.button?.label === "Sync now" && idle.button.disabled === false,
            JSON.stringify(idle)
        );
        await h.ev(`${VAULT_ROW}?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await h.shot("cdp-shots/settings-vault-sync-idle.png");

        // the local in-flight flag renders before the rpc returns, so one frame after the click shows it
        const clicked = await h.ev(`(async () => {
            const b = ${VAULT_SYNC_BTN};
            if (!b) return null;
            b.click();
            await new Promise((r) => requestAnimationFrame(() => r()));
            const n = ${VAULT_SYNC_BTN};
            return { label: (n?.textContent || "").trim(), disabled: n?.disabled ?? null };
        })()`);
        rec(
            "3. a click marks the button Syncing… and disables it at once",
            clicked?.label === "Syncing…" && clicked.disabled === true,
            JSON.stringify(clicked)
        );
        await h.shot("cdp-shots/settings-vault-sync-syncing.png");

        await polishWaitFor(
            h,
            `(${VAULT_SYNC_STATUS}?.textContent || "").trim() === "Last synced just now" && ${VAULT_SYNC_BTN}?.disabled === false`,
            VAULT_SYNC_WAIT_MS
        );
        const synced = await vaultSyncState(h);
        rec(
            "4. the sync lands: Last synced just now, the button enabled, no error note",
            synced.status === "Last synced just now" && synced.button?.disabled === false && synced.note === false,
            JSON.stringify(synced)
        );

        await h.rpc("vaultsetremote", { url: join(ctx.remote, "missing") });
        await h.ev(`${VAULT_SYNC_BTN}?.click()`);
        await polishWaitFor(
            h,
            `(${VAULT_SYNC_STATUS}?.textContent || "").startsWith("Sync failed:") && ${VAULT_SYNC_BTN}?.disabled === false`,
            VAULT_SYNC_WAIT_MS
        );
        const failed = await vaultSyncState(h);
        const colors = await h.ev(`(() => {
            const s = ${VAULT_SYNC_STATUS};
            const probe = document.createElement("span");
            probe.style.color = "var(--color-error)";
            document.body.appendChild(probe);
            const token = getComputedStyle(probe).color;
            probe.remove();
            return { status: s ? getComputedStyle(s).color : null, token };
        })()`);
        rec(
            "5. a failed sync shows once, in the status line in the error color, and the button allows a retry",
            failed.status?.startsWith("Sync failed:") === true &&
                colors.status === colors.token &&
                failed.button?.label === "Sync now" &&
                failed.button.disabled === false &&
                failed.note === false,
            `${JSON.stringify(failed)} colors=${JSON.stringify(colors)}`
        );
        await h.ev(`${VAULT_ROW}?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await h.shot("cdp-shots/settings-vault-sync-failed.png");
        return steps;
    },
    async teardown(h, ctx) {
        await teardownVaultSync(h, ctx);
        await h.goto("cockpit");
    },
};

// --- settings-claude-account: Settings > Claude account lists saved logins -----------------------------
// The dev app reads the real ~/.claude, so the live row is whatever the user has. Two fake saved accounts
// are seeded into the dev app's own secret store (one valid, one expired) to show the other states. It never
// clicks Switch: that would rewrite the real ~/.claude. Remove touches only the secret store. Error notes
// render under the list, so their absence is checked in the whole section pane.
const CLAUDE_ACCT_PANE = `document.querySelector('[data-settings-section="claudeaccount"]')`;
const CLAUDE_ACCT_ERROR = `${CLAUDE_ACCT_PANE}?.querySelector('[data-testid="claude-account-error"]')`;
const CLAUDE_ACCT_CHECK = `${CLAUDE_ACCT_PANE}?.querySelector('[data-testid="claude-account-check"]')`;
const CLAUDE_ACCT_SEEDS = {
    valid: { uuid: "00000000-0000-4000-8000-0000000a0001", email: "seed-valid@example.com", expiresInMs: 86_400_000 },
    expired: { uuid: "00000000-0000-4000-8000-0000000a0002", email: "seed-expired@example.com", expiresInMs: -86_400_000 },
};
// pkg/jarvis claudeAccountSecretName
const claudeAcctSecretName = (uuid) => `claudeacct_${uuid.replaceAll("-", "_")}`;
const claudeAcctRow = (uuid) => `${CLAUDE_ACCT_PANE}?.querySelector('[data-testid="claude-account-row"][data-account-uuid="${uuid}"]')`;
const claudeAcctRowState = (h, uuid) =>
    h.ev(`(() => {
        const r = ${claudeAcctRow(uuid)};
        if (!r) return null;
        const sw = r.querySelector('[data-testid="claude-account-switch"]');
        const rm = r.querySelector('[data-testid="claude-account-remove"]');
        const exp = r.querySelector('[data-testid="claude-account-expired"]');
        return {
            active: r.hasAttribute("data-active"),
            text: (r.textContent || "").trim(),
            switch: sw ? { disabled: sw.disabled } : null,
            remove: rm ? { disabled: rm.disabled } : null,
            expired: exp ? { text: (exp.textContent || "").trim(), color: getComputedStyle(exp).color } : null,
        };
    })()`);

const settingsClaudeAccount = {
    name: "settings-claude-account",
    surface: "settings",
    async arrange(h) {
        const now = Date.now();
        const secrets = {};
        for (const s of Object.values(CLAUDE_ACCT_SEEDS)) {
            secrets[claudeAcctSecretName(s.uuid)] = JSON.stringify({
                oauth: {
                    accessToken: "seed-access",
                    refreshToken: "seed-refresh",
                    expiresAt: now + s.expiresInMs,
                    refreshTokenExpiresAt: now + s.expiresInMs,
                    scopes: ["user:inference"],
                    subscriptionType: "pro",
                },
                account: { accountUuid: s.uuid, emailAddress: s.email, organizationName: "Seed Org" },
                lastusedts: now - 3 * 3600_000,
            });
        }
        await h.rpc("setsecrets", secrets);
        return { seedNames: Object.keys(secrets) };
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const { valid, expired } = CLAUDE_ACCT_SEEDS;

        await h.goto("cockpit");
        await h.goto("settings");
        await h.ev(`document.querySelector('[data-section="claudeaccount"]')?.click()`);
        const listed = await polishWaitFor(h, `${claudeAcctRow(valid.uuid)} != null && ${claudeAcctRow(expired.uuid)} != null`, 10_000);
        const top = await h.ev(`(() => {
            const pane = ${CLAUDE_ACCT_PANE};
            if (!pane) return null;
            return {
                active: pane.querySelector('[data-testid="claude-account-row"][data-active]') != null,
                nologin: pane.querySelector('[data-testid="claude-account-nologin"]') != null,
                check: ${CLAUDE_ACCT_CHECK} != null,
                rows: pane.querySelectorAll('[data-testid="claude-account-row"]').length,
                error: (${CLAUDE_ACCT_ERROR}?.textContent || "").trim() || null,
            };
        })()`);
        rec(
            "1. the Accounts row shows an active account or the no-login note, and Check now",
            listed && top != null && (top.active || top.nologin) && top.check,
            JSON.stringify(top)
        );

        const v = await claudeAcctRowState(h, valid.uuid);
        rec(
            "2. the valid seed is not active, shows its last use, and offers Switch and Remove",
            v != null && !v.active && v.text.includes("last used") && v.switch?.disabled === false && v.remove?.disabled === false,
            JSON.stringify(v)
        );

        const e = await claudeAcctRowState(h, expired.uuid);
        const warning = await h.ev(`(() => {
            const probe = document.createElement("span");
            probe.style.color = "var(--color-warning)";
            document.body.appendChild(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        })()`);
        rec(
            "3. the expired seed shows the expired line in the warning color, a disabled Switch and an enabled Remove",
            e != null &&
                e.expired?.text === "Sign-in expired. Run /login with this account to save it again." &&
                e.expired.color === warning &&
                e.switch?.disabled === true &&
                e.remove?.disabled === false,
            `${JSON.stringify(e)} warning=${warning}`
        );
        await h.ev(`${CLAUDE_ACCT_PANE}?.querySelector('[data-setting-row="claudeaccount.accounts"]')?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await h.shot("cdp-shots/settings-claude-account.png");

        await h.ev(`${CLAUDE_ACCT_CHECK}?.click()`);
        const noNew = await polishWaitFor(h, `${CLAUDE_ACCT_PANE}?.querySelector('[data-testid="claude-account-nonew"]') != null`, 10_000);
        const checkErr = await h.ev(`(${CLAUDE_ACCT_ERROR}?.textContent || "").trim() || null`);
        rec("4. Check now finds no new login and shows no error", noNew && checkErr == null, `nonew=${noNew} error=${checkErr}`);

        for (const [n, seed] of [
            ["5", valid],
            ["6", expired],
        ]) {
            await h.ev(`${claudeAcctRow(seed.uuid)}?.querySelector('[data-testid="claude-account-remove"]')?.click()`);
            const gone = await polishWaitFor(h, `${claudeAcctRow(seed.uuid)} == null`, 10_000);
            const err = await h.ev(`(${CLAUDE_ACCT_ERROR}?.textContent || "").trim() || null`);
            rec(`${n}. Remove takes ${seed.email} off the list with no error`, gone && err == null, `gone=${gone} error=${err}`);
        }

        const rest = await h.ev(`(() => {
            const pane = ${CLAUDE_ACCT_PANE};
            return {
                rows: pane ? pane.querySelectorAll('[data-testid="claude-account-row"]').length : null,
                hint: pane?.querySelector('[data-testid="claude-account-hint"]') != null,
            };
        })()`);
        rec(
            "7. with one account left the one-account hint shows",
            rest.rows !== 1 || rest.hint,
            JSON.stringify(rest)
        );
        await h.ev(`${CLAUDE_ACCT_PANE}?.querySelector('[data-setting-row="claudeaccount.accounts"]')?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await h.shot("cdp-shots/settings-claude-account-one.png");
        return steps;
    },
    async teardown(h, ctx) {
        // deleting a missing secret is a no-op, so this is safe after the Remove steps
        await h.rpc("setsecrets", Object.fromEntries((ctx.seedNames ?? []).map((n) => [n, null])));
        await h.goto("cockpit");
    },
};

// --- motion gaps ---------------------------------------------------------------------------------
// The cockpit toast and the Setup tab panel used to cut in and out. Each check samples in-page, in one
// evaluation, because a CDP round trip per sample is slower than the animations it measures: an observer
// reads the opacity an element mounts with, and a timer reads a leaving toast mid-exit.
const motionGaps = {
    name: "motion-gaps",
    surface: "cockpit",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        // a keystroke an earlier scenario sent would otherwise hold the call in the busy wait
        await settle(1600);

        // 1. a toast mounts transparent and fades in. go:cockpit leaves a trail toast (see ui-api).
        await h.ev(`(() => {
            window.__motionToast = [];
            new MutationObserver((muts, obs) => {
                for (const m of muts) for (const n of m.addedNodes) {
                    if (n instanceof Element && n.matches('[data-notification-toast]')) {
                        window.__motionToast.push(getComputedStyle(n).opacity);
                        obs.disconnect();
                    }
                }
            }).observe(document.body, { childList: true, subtree: true });
        })()`);
        await h.rpc("uiinvoke", { actionid: "go:cockpit" }, UI_ROUTE);
        await settle(600);
        const enter = await h.ev(`(() => ({
            first: window.__motionToast[0] ?? null,
            settled: (() => {
                const t = [...document.querySelectorAll('[data-notification-toast]')].at(-1);
                return t ? getComputedStyle(t).opacity : null;
            })(),
        }))()`);
        rec(
            "1. a cockpit toast mounts at opacity 0 and settles at 1",
            enter.first === "0" && enter.settled === "1",
            JSON.stringify(enter)
        );
        await h.shot("cdp-shots/motion-gaps-toast.png");

        // 2. a dismissed toast stays attached while it fades, then leaves
        const exit = await h.ev(`(async () => {
            const t = [...document.querySelectorAll('[data-notification-toast]')].at(-1);
            if (!t) return null;
            t.click();
            await new Promise((r) => setTimeout(r, 120));
            const mid = { attached: t.isConnected, opacity: Number(getComputedStyle(t).opacity) };
            await new Promise((r) => setTimeout(r, 700));
            return { mid, goneAfter: !t.isConnected };
        })()`);
        rec(
            "2. a dismissed toast fades out while still attached, then is removed",
            exit != null && exit.mid.attached && exit.mid.opacity > 0 && exit.mid.opacity < 1 && exit.goneAfter,
            JSON.stringify(exit)
        );

        // 3. a Setup tab swap fades the new panel in instead of cutting to it
        await h.goto("setup");
        await settle(800);
        const fade = await h.ev(`(async () => {
            const seen = [];
            const obs = new MutationObserver((muts) => {
                for (const m of muts) for (const n of m.addedNodes) {
                    if (n instanceof Element && n.id === 'setup-tabpanel') seen.push(getComputedStyle(n).opacity);
                }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            document.getElementById('setup-tab-skills')?.click();
            await new Promise((r) => setTimeout(r, 400));
            obs.disconnect();
            const panel = document.getElementById('setup-tabpanel');
            return {
                first: seen[0] ?? null,
                settled: panel ? getComputedStyle(panel).opacity : null,
                tab: panel?.getAttribute('aria-labelledby') ?? null,
            };
        })()`);
        rec(
            "3. switching Setup to Skills fades the panel in from 0 to 1",
            fade.first === "0" && fade.settled === "1" && fade.tab === "setup-tab-skills",
            JSON.stringify(fade)
        );
        await h.shot("cdp-shots/motion-gaps-setup.png");
        return steps;
    },
    async teardown(h) {
        await h.ev(`document.getElementById('setup-tab-instructions')?.click()`);
        await h.goto("cockpit");
    },
};

// The Resource Manager (footer readout + popover). Data comes only from window.__resmonFixture (resmonstore.ts),
// modelled on the canvas (.superpowers/design/resource-manager): a pinned snapshot is never overwritten by the
// live poll, and an armed outcome answers the next confirm without touching a process.
const RESMON_VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const RESMON_MIB = 1024 * 1024;
// the snapshot's totals: the canvas's 60.6% and 7.4 GiB
const RESMON_TOTAL_CPU = 60.6;
const RESMON_TOTAL_MEM = 7945689498;
const RESMON_FOOTER = `document.querySelector('[data-hints-footer]')`;
const RESMON_COCKPIT_HINTS = `document.querySelector('[data-cockpit-hints]')`;
const RESMON_POPOVER = `document.querySelector('[data-resmon-popover]')`;
const RESMON_GROUP_ORDER = ["arc", "job:14820", "job:13060", "job:22410", "job:7716"];
// the popover grows in with a scale reveal; measure after it settles
const RESMON_REVEAL_MS = 500;
const RESMON_CURSOR_MAX_PRESSES = 40;
const resmonNap = (ms) => new Promise((r) => setTimeout(r, ms));

function resmonRows(now, rows) {
    return rows.map(([pid, depth, name, args, cpu, mb, extra]) => ({
        pid,
        depth,
        name,
        command: args ? `${name} ${args}` : name,
        createts: now - (extra?.ageMin ?? 5) * 60_000,
        cpu,
        mem: Math.round(mb * RESMON_MIB),
        mempct: 0,
        numthreads: 1,
        ...(extra?.tag ? { tag: extra.tag } : {}),
        ...(extra?.role ? { role: extra.role } : {}),
    }));
}

function resmonGroup(key, ownerkind, label, runtime, killable, rows) {
    return {
        key,
        ownerkind,
        ownerid: key,
        label,
        ...(runtime ? { runtime } : {}),
        killable,
        cpu: Math.round(rows.reduce((n, r) => n + r.cpu, 0) * 10) / 10,
        mem: rows.reduce((n, r) => n + r.mem, 0),
        rows,
    };
}

function resmonArcGroup(now) {
    const webview = (role) => ({ role, ageMin: 340 });
    return resmonGroup("arc", "arc", "Arc", "", false, resmonRows(now, [
        [2476, 0, "wave-tauri.exe", "", 0.1, 38, webview("Host")],
        [23360, 1, "msedgewebview2.exe", "", 0.4, 141, webview("WebView browser")],
        [20028, 2, "msedgewebview2.exe", "--type=renderer", 3.1, 337, webview("Renderer")],
        [24188, 2, "msedgewebview2.exe", "--type=gpu-process", 1.9, 298, webview("GPU")],
        [25364, 2, "msedgewebview2.exe", "--type=renderer", 0.2, 74, { role: "Renderer", ageMin: 62 }],
        [27348, 2, "msedgewebview2.exe", "--type=utility --utility-sub-type=network.mojom.NetworkService", 0.1, 43, webview("Network service")],
        [4040, 2, "msedgewebview2.exe", "--type=utility --utility-sub-type=storage.mojom.StorageService", 0.0, 20, webview("Storage service")],
        [1788, 2, "msedgewebview2.exe", "--type=crashpad-handler", 0.0, 13, webview("Crash handler")],
        [27152, 1, "wavesrv.x64.exe", "", 0.9, 219, webview("Backend")],
    ]));
}

function resmonFixture(now = Date.now()) {
    return {
        supported: true,
        ready: true,
        ts: now,
        cpu: RESMON_TOTAL_CPU,
        mem: RESMON_TOTAL_MEM,
        totalmem: 32 * 1024 * RESMON_MIB,
        busycpu: false,
        busymem: false,
        groups: [
            resmonArcGroup(now),
            resmonGroup("job:14820", "agenttab", "waveterm", "claude", true, resmonRows(now, [
                [14820, 0, "claude.exe", "--resume", 1.2, 486, { tag: "agent", ageMin: 42 }],
                [14832, 1, "conhost.exe", "", 0.0, 9, { tag: "console", ageMin: 42 }],
                [18240, 1, "bash.exe", "-c go test ./pkg/orchestrate/... -run TestLiveness", 0.0, 6, { ageMin: 2 }],
                [18244, 2, "go.exe", "test ./pkg/orchestrate/...", 0.6, 152, { ageMin: 2 }],
                [18311, 3, "orchestrate.test.exe", "-test.run TestLiveness", 28.9, 1904, { ageMin: 2 }],
                [9932, 1, "cmd.exe", "/c npm run dev", 0.0, 4, { ageMin: 38 }],
                [9958, 2, "node.exe", "vite --port 5174", 1.1, 846, { ageMin: 38 }],
            ])),
            resmonGroup("job:13060", "runworker", "cache-miss notice · Task 2", "pi", true, resmonRows(now, [
                [13060, 0, "cmd.exe", "/c pi.cmd", 0.0, 4, { tag: "launcher", ageMin: 16 }],
                [13072, 1, "conhost.exe", "", 0.0, 8, { tag: "console", ageMin: 16 }],
                [13104, 1, "node.exe", "pi", 0.9, 274, { tag: "agent", ageMin: 16 }],
                [21876, 2, "bash.exe", "-c npx vitest run frontend/app/view/agents", 0.0, 6, { ageMin: 1 }],
                [21890, 3, "node.exe", "vitest run frontend/app/view/agents", 13.7, 802, { ageMin: 1 }],
            ])),
            resmonGroup("job:22410", "runcmd", "cleanup round · Verify", "", false, resmonRows(now, [
                [22410, 0, "bash.exe", "-c node scripts/verify.mjs ./pkg/orchestrate ./pkg/jarvis", 0.0, 6, { ageMin: 4 }],
                [22418, 1, "node.exe", "scripts/verify.mjs", 0.3, 58, { ageMin: 4 }],
                [22502, 2, "go.exe", "test ./pkg/jarvis", 0.4, 140, { ageMin: 3 }],
                [22590, 3, "jarvis.test.exe", "-test.count=1", 6.7, 1200, { ageMin: 3 }],
            ])),
            resmonGroup("job:7716", "agenttab", "obsidian-notes", "claude", true, resmonRows(now, [
                [7716, 0, "claude.exe", "", 0.1, 303, { tag: "agent", ageMin: 192 }],
                [7724, 1, "conhost.exe", "", 0.0, 9, { tag: "console", ageMin: 192 }],
            ])),
        ],
    };
}

const resmonSet = (h, snap) => h.ev(`window.__resmonFixture.set(${JSON.stringify(snap)})`);
const resmonArm = (h, outcome) => h.ev(`window.__resmonFixture.killOutcome(${JSON.stringify(outcome)})`);
const resmonClick = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`;
const resmonReadout = (scope) => `${scope}?.querySelector('[data-resmon-readout]')`;
// the readout's words as a reader sees them: the flex gaps between its spans carry no text
const resmonReadoutText = (scope) => `(() => {
    const r = ${resmonReadout(scope)};
    return r ? [...r.children].filter((c) => c.tagName === 'SPAN').map((c) => c.textContent.trim()).join(' ') : null;
})()`;
const resmonGroupButton = (key, text) =>
    `[...document.querySelectorAll('[data-resmon-popover] [data-resmon-group="${key}"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
const resmonConfirmButton = (text) =>
    `[...document.querySelectorAll('[data-resmon-popover] [data-resmon-confirm] button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
const resmonRowKill = (pid) => `document.querySelector('[data-resmon-popover] [data-resmon-row="${pid}"] button')`;
const resmonChevron = (key) =>
    `document.querySelector('[data-resmon-popover] [data-resmon-group="${key}"] button[aria-expanded]')`;

const RESMON_KEYS = {
    Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    g: { key: "g", code: "KeyG", windowsVirtualKeyCode: 71, text: "g" },
    m: { key: "m", code: "KeyM", windowsVirtualKeyCode: 77, text: "m" },
    x: { key: "x", code: "KeyX", windowsVirtualKeyCode: 88, text: "x" },
    X: { key: "X", code: "KeyX", windowsVirtualKeyCode: 88, text: "X", shift: true },
};
const RESMON_SHIFT_MODIFIER = 8;

// Input.dispatchKeyEvent often never reaches a WebView without OS focus: probe once, then send every key the same
// way, falling back to a KeyboardEvent on window, where the keybinding dispatcher listens
async function resmonKeyPath(h) {
    await h.ev(`(() => {
        window.__resmonKeyProbe = false;
        const f = (e) => { if (e.key === 'F20') { window.__resmonKeyProbe = true; window.removeEventListener('keydown', f, true); } };
        window.addEventListener('keydown', f, true);
    })()`);
    await h.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "F20", code: "F20", windowsVirtualKeyCode: 131 });
    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "F20", code: "F20", windowsVirtualKeyCode: 131 });
    await resmonNap(150);
    return (await h.ev("window.__resmonKeyProbe === true")) ? "cdp" : "window";
}

async function resmonKey(h, ctx, name) {
    const { shift, text, ...k } = RESMON_KEYS[name];
    if (ctx.keyPath === "cdp") {
        const modifiers = shift ? RESMON_SHIFT_MODIFIER : 0;
        await h.cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...k, text, modifiers });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k, modifiers });
    } else {
        await h.ev(
            `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k.key)}, code: ${JSON.stringify(k.code)}, shiftKey: ${!!shift}, bubbles: true, cancelable: true }))`
        );
    }
    await resmonNap(200);
}

// keys must not land in a field: the Agent surface's terminal would take them
const resmonBlur = (h) => h.ev(`document.activeElement?.blur?.()`);

const RESMON_POPOVER_STATE = `(() => {
    const p = ${RESMON_POPOVER};
    if (!p) return null;
    const r = p.getBoundingClientRect();
    const where = (el) => el.getAttribute('data-resmon-row') ?? el.closest('[data-resmon-group]')?.getAttribute('data-resmon-group');
    const cursor = p.querySelector('[data-resmon-cursor]');
    const confirm = p.querySelector('[data-resmon-confirm]');
    return {
        width: Math.round(r.width),
        right: Math.round(window.innerWidth - r.right),
        bottom: r.bottom,
        groups: [...p.querySelectorAll('[data-resmon-group]')].map((g) => ({
            key: g.getAttribute('data-resmon-group'),
            rows: g.querySelectorAll('[data-resmon-row]').length,
            tags: [...g.querySelectorAll('[data-resmon-row]')].filter((row) => !row.querySelector('button')).length,
            kills: g.querySelectorAll('[data-resmon-row] button[aria-label^="Kill"]').length,
            buttons: g.querySelectorAll('button').length,
        })),
        order: [...p.querySelectorAll('[data-resmon-group] > div:first-child, [data-resmon-row]')].map(where),
        cursor: cursor ? where(cursor) : null,
        confirm: confirm ? (confirm.querySelector('span')?.textContent ?? '') : null,
        status: [...p.querySelectorAll('[role="status"]')].map((n) => n.textContent.trim()),
        alert: [...p.querySelectorAll('[role="alert"]')].map((n) => n.textContent.trim()),
        text: p.textContent,
    };
})()`;
const resmonPopover = (h) => h.ev(RESMON_POPOVER_STATE);

// walks the cursor with the arrows onto the row with that pid, or the header of the group with that key
async function resmonCursorTo(h, ctx, target) {
    for (let i = 0; i < RESMON_CURSOR_MAX_PRESSES; i++) {
        const s = await resmonPopover(h);
        if (s == null) return false;
        const at = s.cursor == null ? -1 : s.order.indexOf(s.cursor);
        const want = s.order.indexOf(String(target));
        if (want < 0) return false;
        if (at === want) return true;
        await resmonKey(h, ctx, want > at ? "ArrowDown" : "ArrowUp");
    }
    return false;
}

async function resmonArrange(h) {
    await h.cdp("Emulation.setDeviceMetricsOverride", RESMON_VIEWPORT);
    await h.goto("agent");
    const ready = await polishWaitFor(h, `!!window.__resmonFixture`, 10000);
    const keyPath = await resmonKeyPath(h);
    if (ready) {
        await resmonSet(h, resmonFixture());
        await resmonNap(300);
    }
    return { ready, keyPath };
}

// The Cockpit draws its hints bar, and so its readout, only over a roster: an empty store shows the empty state
// alone. The fixture roster is read once at boot, and the reload drops the pinned snapshot, so it is set again.
async function resmonSeedRoster(h, ctx) {
    if (existsSync(TREE_RAIL_FIXTURE)) return;
    mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
    writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(treeRailRoster(undefined, Date.now()), null, 2));
    ctx.wroteFixture = true;
    await h.ev("location.reload()");
    await polishWaitFor(h, `!!document.querySelector("nav button") && !!window.__resmonFixture`, 30000);
    await resmonSet(h, resmonFixture());
}

async function resmonTeardown(h, ctx) {
    await h.ev(`window.__resmonFixture?.clear()`).catch(() => {});
    if (ctx?.wroteFixture) {
        rmSync(TREE_RAIL_FIXTURE, { force: true });
        await h.ev("location.reload()");
        await polishWaitFor(h, `!!document.querySelector("nav button")`, 30000);
    }
    await h.goto("cockpit");
}

const RESMON_NO_HOOK = [{ step: "the dev fixture hook is on window", ok: false, detail: "no window.__resmonFixture" }];

const resmonFooter = {
    name: "resmon-footer",
    surface: "agent",
    arrange: resmonArrange,
    async assert(h, ctx) {
        if (!ctx.ready) return RESMON_NO_HOOK;
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const shot = (n) => h.shot(`cdp-shots/resmon-footer-${n}.png`);

        await resmonBlur(h);
        const rest = await h.ev(`(() => ({
            last: !!${RESMON_FOOTER}?.lastElementChild?.matches('[data-resmon-readout]'),
            text: ${resmonReadoutText(RESMON_FOOTER)},
        }))()`);
        await shot("1-rest");
        rec("1. Agent at rest: the readout ends the footer and reads Arc 61% CPU · 7.4 GB",
            rest.last && rest.text === "Arc 61% CPU · 7.4 GB", JSON.stringify(rest));

        await resmonKey(h, ctx, "g");
        const leader = await h.ev(`(() => {
            const f = ${RESMON_FOOTER};
            const spans = [...(f?.querySelectorAll('span') ?? [])].map((s) => s.textContent.trim());
            return { readout: !!${resmonReadout(RESMON_FOOTER)}, m: spans.includes('mResource Manager'), leader: spans.includes('g →') };
        })()`);
        await shot("2-leader");
        rec("2. g: the leader posture keeps the readout and lists m Resource Manager",
            leader.readout && leader.m && leader.leader, JSON.stringify(leader));

        await resmonKey(h, ctx, "m");
        await resmonNap(RESMON_REVEAL_MS);
        const opened = await h.ev(`!!${RESMON_POPOVER}`);
        await shot("3-gm-open");
        rec("3. m: the popover opens", opened, `popover=${opened}`);

        await resmonKey(h, ctx, "Escape");
        await resmonNap(RESMON_REVEAL_MS);
        const closed = await h.ev(`!${RESMON_POPOVER}`);
        await shot("4-esc-closed");
        rec("4. Esc: the popover closes", closed, `closed=${closed}`);

        const dim = await h.ev(`new Promise((resolve) => {
            const input = document.createElement('input');
            input.setAttribute('data-resmon-probe', '');
            document.body.appendChild(input);
            input.focus();
            setTimeout(() => {
                const chips = ${RESMON_FOOTER}?.querySelector('[data-footer-chips]');
                const readout = ${resmonReadout(RESMON_FOOTER)};
                resolve({ chips: chips ? getComputedStyle(chips).opacity : null, readout: readout ? getComputedStyle(readout).opacity : null });
            }, 300);
        })`);
        await shot("5-editable");
        await h.ev(`document.querySelector('[data-resmon-probe]')?.remove()`);
        rec("5. focus in a field: the chips dim to 0.6, the readout stays at 1",
            dim.chips === "0.6" && dim.readout === "1", JSON.stringify(dim));

        if (!existsSync(TREE_RAIL_FIXTURE)) {
            await h.goto("cockpit");
            await polishWaitFor(h, `!!${RESMON_COCKPIT_HINTS}`, 10000);
            const bare = await h.ev(`(() => {
                const bar = ${RESMON_COCKPIT_HINTS};
                return {
                    readout: !!${resmonReadout(RESMON_COCKPIT_HINTS)},
                    help: [...(bar?.querySelectorAll('button') ?? [])].some((b) => b.textContent.trim() === '?'),
                };
            })()`);
            await shot("5b-cockpit-empty");
            rec("5b. Cockpit with no roster: the hints bar shows the readout alone, no triage hints or ?",
                bare.readout && !bare.help, JSON.stringify(bare));
        }

        await resmonSeedRoster(h, ctx);
        await h.goto("cockpit");
        await polishWaitFor(h, `!!${RESMON_COCKPIT_HINTS}`, 10000);
        const cockpit = await h.ev(`(() => {
            const r = ${resmonReadout(RESMON_COCKPIT_HINTS)};
            return { readout: !!r, afterHelp: r?.previousElementSibling?.textContent.trim() === '?', footer: !!${RESMON_FOOTER} };
        })()`);
        await shot("6-cockpit");
        rec("6. Cockpit: the readout sits in the cockpit hints bar, after ?",
            cockpit.readout && cockpit.afterHelp && !cockpit.footer, JSON.stringify(cockpit));

        await resmonBlur(h);
        await resmonKey(h, ctx, "g");
        const cockpitLeader = await h.ev(`(() => ({
            leader: [...(${RESMON_FOOTER}?.querySelectorAll('span') ?? [])].some((s) => s.textContent.trim() === 'g →'),
            readouts: document.querySelectorAll('[data-resmon-readout]').length,
            inBar: !!${resmonReadout(RESMON_COCKPIT_HINTS)},
        }))()`);
        await shot("6a-cockpit-leader");
        rec("6a. Cockpit under the g leader: one readout, in the hints bar, and the footer's own yields",
            cockpitLeader.leader && cockpitLeader.readouts === 1 && cockpitLeader.inBar, JSON.stringify(cockpitLeader));
        await resmonKey(h, ctx, "Escape");

        await h.ev(resmonClick(resmonReadout(RESMON_COCKPIT_HINTS)));
        await resmonNap(RESMON_REVEAL_MS);
        const above = await h.ev(`(() => {
            const p = ${RESMON_POPOVER};
            const bar = ${RESMON_COCKPIT_HINTS};
            if (!p || !bar) return { open: !!p, bar: !!bar };
            return { open: true, bottom: p.getBoundingClientRect().bottom, barTop: bar.getBoundingClientRect().top };
        })()`);
        await shot("6b-cockpit-open");
        rec("6b. Cockpit: clicking that readout opens the popover above the hints bar",
            above.open && above.bottom <= above.barTop, JSON.stringify(above));
        await resmonBlur(h);
        await resmonKey(h, ctx, "Escape");
        await resmonNap(RESMON_REVEAL_MS);

        await h.goto("agent");
        await resmonBlur(h);
        const busy = [
            ["7", { busycpu: true }, "high CPU"],
            ["8", { busymem: true }, "high memory"],
            ["9", { busycpu: true, busymem: true }, "high CPU and memory"],
        ];
        for (const [n, flags, words] of busy) {
            await resmonSet(h, { ...resmonFixture(), ...flags });
            await resmonNap(200);
            const text = await h.ev(resmonReadoutText(RESMON_FOOTER));
            await shot(`${n}-busy`);
            rec(`${n}. ${Object.keys(flags).join(" + ")}: the readout shows ${words}`,
                text === `Arc 61% CPU · 7.4 GB ${words}`, text);
        }

        await resmonSet(h, null);
        await resmonNap(200);
        const pending = await h.ev(resmonReadoutText(RESMON_FOOTER));
        await shot("10-pending");
        rec("10. pinned null: the readout shows Arc –", pending === "Arc –", pending);

        await resmonSet(h, { ...resmonFixture(), supported: false });
        await resmonNap(200);
        const footerGone = await h.ev(`!!${RESMON_FOOTER} && !${resmonReadout(RESMON_FOOTER)}`);
        await shot("11a-unsupported-agent");
        await h.goto("cockpit");
        await polishWaitFor(h, `!!${RESMON_COCKPIT_HINTS}`, 10000);
        const barGone = await h.ev(`!!${RESMON_COCKPIT_HINTS} && !${resmonReadout(RESMON_COCKPIT_HINTS)}`);
        await shot("11b-unsupported-cockpit");
        rec("11. supported: false: no readout in the footer or the cockpit hints bar",
            footerGone && barGone, `footer=${footerGone} cockpit=${barGone}`);
        return steps;
    },
    teardown: resmonTeardown,
};

// The one Resource Manager check that touches no fixture: a real runaway process in a real shell block, found by the
// backend's own sampler and killed from the popover. Node reads the pid's liveness from the OS, the only witness that
// does not go through the code under test.
const RESMON_LIVE_WAIT_MS = 30000;
const RESMON_LIVE_POLL_MS = 500;
const RESMON_LIVE_CMD = `node -e "for(;;){}"`;
// sent apart from the command: pwsh reads a burst ending in Enter as a paste and does not run it
const RESMON_LIVE_ENTER = String.fromCharCode(13);

async function resmonLiveRunaway(h, blockId) {
    const snap = await h.rpc("resmonsnapshot", {});
    const group = (snap?.groups ?? []).find((g) => g.ownerid === blockId);
    const row = (group?.rows ?? []).filter((r) => /^node/i.test(r.name ?? "")).sort((a, b) => b.cpu - a.cpu)[0];
    return row == null ? null : { group: group.key, pid: row.pid, cpu: row.cpu };
}

const pidAlive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const resmonLive = {
    name: "resmon-live",
    surface: "agent",
    async arrange(h) {
        await h.cdp("Emulation.setDeviceMetricsOverride", RESMON_VIEWPORT);
        const ctx = {};
        try {
            await openCanvasTerminal(h, ctx);
        } catch (e) {
            ctx.launchError = String(e?.message ?? e);
            return ctx;
        }
        await h.goto("agent");
        ctx.keyPath = await resmonKeyPath(h);
        return ctx;
    },
    async assert(h, ctx) {
        if (ctx.launchError != null) {
            return [skipStep("live kill", `could not verify: the terminal launch failed: ${ctx.launchError}`)];
        }
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const shot = (n) => h.shot(`cdp-shots/resmon-live-${n}.png`);

        await resmonNap(RESMON_LIVE_WAIT_MS / 6);
        const type = (text) =>
            h.rpc("controllerinput", { blockid: ctx.blockId, inputdata64: Buffer.from(text).toString("base64") });
        await type(RESMON_LIVE_CMD);
        await resmonNap(RESMON_LIVE_POLL_MS);
        await type(RESMON_LIVE_ENTER);
        const deadline = Date.now() + RESMON_LIVE_WAIT_MS;
        let found = null;
        while (found == null && Date.now() < deadline) {
            await resmonNap(RESMON_LIVE_POLL_MS);
            found = await resmonLiveRunaway(h, ctx.blockId);
        }
        const seen = found ?? (await h.rpc("resmonsnapshot", {}))?.groups?.map((g) => ({
            key: g.key,
            ownerid: g.ownerid,
            rows: g.rows.map((r) => `${r.pid}:${r.name}`),
        }));
        rec("1. the sampler lists the runaway node under the shell block's group", found != null, JSON.stringify({ block: ctx.blockId, seen }));
        if (found == null) {
            await shot("0-not-found");
            return steps;
        }
        ctx.pid = found.pid;
        rec("2. the process is alive before the kill", pidAlive(found.pid), `pid=${found.pid}`);

        await resmonBlur(h);
        await h.ev(resmonClick(resmonReadout(RESMON_FOOTER)));
        await polishWaitFor(h, `!!document.querySelector('[data-resmon-row="${found.pid}"]')`, 10000);
        await shot("1-listed");
        const clicked = await h.ev(
            resmonClick(`document.querySelector('[data-resmon-row="${found.pid}"] button[aria-label^="Kill"]')`)
        );
        await resmonNap(300);
        const asked = await h.ev(`!!document.querySelector('[data-resmon-confirm]')`);
        await shot("2-confirm");
        rec("3. the row's x opens a confirm", clicked && asked, `clicked=${clicked} confirm=${asked}`);
        if (!asked) return steps;

        await h.ev(resmonClick(`document.querySelector('[data-resmon-confirm] button')`));
        await polishWaitFor(h, `!document.querySelector('[data-resmon-row="${found.pid}"]')`, 10000);
        await resmonNap(RESMON_LIVE_POLL_MS);
        const gone = !pidAlive(found.pid);
        await shot("3-killed");
        rec("4. confirming kills the process: the OS no longer has the pid", gone, `pid=${found.pid} alive=${!gone}`);
        const after = await h.ev(`!document.querySelector('[data-resmon-row="${found.pid}"]')`);
        rec("5. the popover no longer lists the row", after, `rowGone=${after}`);
        return steps;
    },
    async teardown(h, ctx) {
        await resmonKey(h, ctx, "Escape").catch(() => {});
        if (ctx.pid != null && pidAlive(ctx.pid)) {
            try {
                process.kill(ctx.pid);
            } catch {}
        }
        if (ctx.tabId) {
            await waveService(h, "workspace", "CloseTab", [ctx.workspaceId, ctx.tabId, false]).catch((e) =>
                console.error(`resmon-live teardown: close the terminal tab failed: ${e?.message ?? e}`)
            );
        }
        await h.goto("cockpit");
    },
};

const resmonMain = {
    name: "resmon-main",
    surface: "agent",
    arrange: resmonArrange,
    async assert(h, ctx) {
        if (!ctx.ready) return RESMON_NO_HOOK;
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const shot = (n) => h.shot(`cdp-shots/resmon-main-${n}.png`);
        const arcRows = async () => (await resmonPopover(h))?.groups.find((g) => g.key === "arc")?.rows;

        await h.ev(resmonClick(resmonReadout(RESMON_FOOTER)));
        await resmonNap(RESMON_REVEAL_MS);
        const s1 = await resmonPopover(h);
        const readoutTop = await h.ev(`${resmonReadout(RESMON_FOOTER)}?.getBoundingClientRect().top`);
        await shot("1-open");
        const by = (k) => s1?.groups.find((g) => g.key === k) ?? {};
        const ok1 =
            s1 != null &&
            s1.width === 700 &&
            Math.abs(s1.right - 12) <= 1 &&
            s1.bottom <= readoutTop - 5 &&
            JSON.stringify(s1.groups.map((g) => g.key)) === JSON.stringify(RESMON_GROUP_ORDER) &&
            by("arc").rows === 0 &&
            by("job:14820").tags === 2 && by("job:14820").kills === 5 &&
            by("job:13060").tags === 3 && by("job:13060").kills === 2 &&
            by("job:22410").rows === 4 && by("job:22410").buttons === 1 &&
            by("job:7716").tags === 2 && by("job:7716").kills === 0;
        rec("1. click the readout: 700px, bottom-right; Arc first and collapsed; by CPU; tags on core rows, × on the rest; Verify has no action",
            ok1, JSON.stringify({ width: s1?.width, right: s1?.right, bottom: s1?.bottom, readoutTop, groups: s1?.groups }));

        await h.ev(resmonClick(resmonChevron("arc")));
        await resmonNap(200);
        const expanded = await arcRows();
        await shot("2a-arc-expanded");
        await h.ev(resmonClick(resmonChevron("arc")));
        await resmonNap(200);
        const collapsed = await arcRows();
        await shot("2b-arc-collapsed");
        rec("2. Arc's chevron expands it, a second click collapses it", expanded === 9 && collapsed === 0,
            `expanded=${expanded} collapsed=${collapsed}`);

        await resmonKey(h, ctx, "ArrowDown");
        const c3 = (await resmonPopover(h))?.cursor;
        await resmonKey(h, ctx, "Enter");
        const opened3 = await arcRows();
        await shot("3-cursor-enter");
        rec("3. ↓ puts the cursor on Arc's header, ⏎ expands it", c3 === "arc" && opened3 === 9,
            `cursor=${c3} arcRows=${opened3}`);

        await h.ev(resmonClick(resmonRowKill(18311)));
        await resmonNap(200);
        const c4 = (await resmonPopover(h))?.confirm;
        await shot("4-row-confirm");
        rec("4. × on orchestrate.test.exe asks to kill it alone",
            c4 === "Kill orchestrate.test.exe (18311)? It has no child processes.", c4);

        await resmonBlur(h);
        await resmonKey(h, ctx, "Escape");
        const s5 = await resmonPopover(h);
        await shot("5-esc-cancel");
        rec("5. Esc removes the confirm and leaves the popover open", s5 != null && s5.confirm == null,
            `open=${s5 != null} confirm=${s5?.confirm}`);

        const reached = await resmonCursorTo(h, ctx, 18244);
        await resmonKey(h, ctx, "x");
        const c6 = (await resmonPopover(h))?.confirm;
        await resmonArm(h, { outcome: "killed", killed: 2 });
        await resmonKey(h, ctx, "Enter");
        await resmonNap(200);
        const s6 = await resmonPopover(h);
        await shot("6-killed");
        rec("6. x on go.exe asks for it and its child; ⏎ kills and notes it",
            reached && c6 === "Kill go.exe (18244) and its 1 child process?" &&
                s6?.status.includes("Killed go.exe (18244) and 1 child process."),
            JSON.stringify({ reached, confirm: c6, status: s6?.status }));

        await resmonKey(h, ctx, "Escape");
        await resmonNap(RESMON_REVEAL_MS);
        const gone7 = await h.ev(`!${RESMON_POPOVER}`);
        await shot("7-esc-close");
        rec("7. Esc closes the popover", gone7, `closed=${gone7}`);

        await h.ev(resmonClick(resmonReadout(RESMON_FOOTER)));
        await resmonNap(RESMON_REVEAL_MS);
        const reopened = await h.ev(`!!${RESMON_POPOVER}`);
        // a real pointer press on the Agent surface, clear of the popover and the footer
        const press = { x: 400, y: 300, button: "left", clickCount: 1 };
        await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...press });
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...press });
        await resmonNap(RESMON_REVEAL_MS);
        const gone8 = await h.ev(`!${RESMON_POPOVER}`);
        await shot("8-outside-click");
        rec("8. a click outside the popover and the readout closes it", reopened && gone8,
            `reopened=${reopened} closed=${gone8}`);
        return steps;
    },
    teardown: resmonTeardown,
};

const resmonStates = {
    name: "resmon-states",
    surface: "agent",
    arrange: resmonArrange,
    async assert(h, ctx) {
        if (!ctx.ready) return RESMON_NO_HOOK;
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const shot = (n) => h.shot(`cdp-shots/resmon-states-${n}.png`);

        await resmonSet(h, null);
        await h.ev(`window.__resmonFixture.open()`);
        await resmonNap(RESMON_REVEAL_MS);
        const s1 = await resmonPopover(h);
        await shot("1-loading");
        rec("1. pinned null: the loading body",
            s1?.status.includes("Reading agent processes…") && s1.groups.length === 0, JSON.stringify(s1?.status));

        await resmonSet(h, { ...resmonFixture(), groups: [resmonArcGroup(Date.now())] });
        await resmonNap(200);
        const s2 = await resmonPopover(h);
        await shot("2-empty");
        rec("2. Arc only: the empty body",
            s2?.groups.length === 1 && s2.text.includes("No agent processes") &&
                s2.text.includes("Agent tabs, run workers and run commands show here while they run."),
            JSON.stringify(s2?.groups));

        await resmonSet(h, resmonFixture());
        await resmonNap(200);
        await resmonBlur(h);
        const onHeader = await resmonCursorTo(h, ctx, "job:14820");
        await resmonKey(h, ctx, "X");
        const c3 = (await resmonPopover(h))?.confirm;
        const want3 = "Kill 5 processes under waveterm? claude.exe and its console keep running.";
        await shot("3a-children-confirm");
        await h.ev(resmonClick(resmonConfirmButton("Cancel")));
        await resmonNap(200);
        const cancelled = (await resmonPopover(h))?.confirm == null;
        await shot("3b-cancelled");
        rec("3. ⇧X on waveterm's header asks to kill its 5 children; Cancel closes it",
            onHeader && c3 === want3 && cancelled, JSON.stringify({ onHeader, confirm: c3, cancelled }));

        await h.ev(resmonClick(resmonGroupButton("job:14820", "Kill children")));
        await resmonNap(200);
        const c4 = (await resmonPopover(h))?.confirm;
        await resmonArm(h, { outcome: "killed", killed: 5 });
        const clicked4 = await h.ev(resmonClick(resmonConfirmButton("Kill 5")));
        await resmonNap(300);
        const s4 = await resmonPopover(h);
        await shot("4-children-killed");
        rec("4. Kill children opens the same confirm; Kill 5 notes Killed 5 processes.",
            c4 === want3 && clicked4 && s4?.status.includes("Killed 5 processes."),
            JSON.stringify({ confirm: c4, clicked: clicked4, status: s4?.status }));

        await resmonArm(h, { outcome: "gone", killed: 0 });
        await h.ev(resmonClick(resmonRowKill(21890)));
        await resmonNap(200);
        const clicked5 = await h.ev(resmonClick(resmonConfirmButton("Kill")));
        await resmonNap(300);
        const s5 = await resmonPopover(h);
        await shot("5-gone");
        rec("5. gone: node.exe (21890) had already exited.",
            clicked5 && s5?.status.includes("node.exe (21890) had already exited."), JSON.stringify(s5?.status));

        // the × above left the cursor on node.exe (21890), so x asks for it again
        const alerts = [
            ["6-refused", { outcome: "refused", killed: 0 },
                (a) => a === "Not killed: pid 21890 no longer belongs to this run worker. The list refreshes in 2s.",
                "6. refused: the alert says the pid left this run worker"],
            ["7-protected", { outcome: "protected", killed: 0 },
                (a) => a.startsWith("Not killed: node.exe (21890) is the agent's own process."),
                "7. protected: the alert names the agent's own process"],
            ["8-failed", { outcome: "failed", killed: 0, error: "Access is denied." },
                (a) => /^Could not kill .+: Access is denied\. It is still running\.$/.test(a),
                "8. failed: the alert carries the OS error and says it is still running"],
        ];
        for (const [n, outcome, check, step] of alerts) {
            await resmonBlur(h);
            await resmonArm(h, outcome);
            await resmonKey(h, ctx, "x");
            const confirm = (await resmonPopover(h))?.confirm;
            await resmonKey(h, ctx, "Enter");
            await resmonNap(300);
            const alert = (await resmonPopover(h))?.alert ?? [];
            await shot(n);
            rec(step, confirm != null && alert.length === 1 && check(alert[0]), JSON.stringify({ confirm, alert }));
        }
        return steps;
    },
    teardown: resmonTeardown,
};

export const SCENARIOS = [
    cockpitKeysOnArrival,
    agentTerminalOnArrival,
    codeTreeOnArrival,
    briefContextualMap,
    briefRestore,
    briefComposerSteerOnly,
    terminalTheme,
    tuiLeader,
    tuiFullscreen,
    gitHistory,
    diffCompare,
    diffReviewMarks,
    diffReviewMarksRun,
    surfaceSmoke,
    codeSearch,
    codeSidebar,
    codeGitStatus,
    codeDiff,
    codeMarkdown,
    jarvisAvatar,
    briefSurface,
    briefPeek,
    peekCtrlClick,
    peekItemViews,
    briefProfile,
    jarvisPeek,
    jarvisVolunteer,
    usageCharts,
    usageWork,
    attentionCrossChannel,
    attentionPopup,
    cockpitNeedsYouCrossChannel,
    harnessPicker,
    dagLifecycle,
    routePickerFlat,
    routePickerRefused,
    settingsRadarAudit,
    settingsVaultSync,
    settingsClaudeAccount,
    jarvisMotion,
    // before brief-inline-tracker, which leaves a briefing fixture on over the seeded data
    briefDesignParity,
    briefInlineTracker,
    resourceLinking,
    radarStartInvestigation,
    radarReport,
    radarScanStates,
    uiApi,
    motionGaps,
    narrationFeed,
    notesWsh,
    agentTreeRail,
    agentTreeQuickReturn,
    docReview,
    docReviewNotes,
    docReviewCanvas,
    cockpitPolish,
    leadCardMergeGate,
    runSheetPolish,
    runTimingScenario,
    runSheetCarryScenario,
    runCost,
    dagObservability,
    recordBandDetachRestore,
    agentRailFileLink,
    finalShotsScenario,
    finalStageScenario,
    briefInitiativesPolish,
    briefPeeksPolish,
    newRunWindow,
    newRunAttachments,
    paletteActions,
    paletteGoal,
    paletteNotes,
    modelPicks,
    canvasSwap,
    canvasTabsScenario,
    resmonFooter,
    resmonMain,
    resmonStates,
    resmonLive,
];
