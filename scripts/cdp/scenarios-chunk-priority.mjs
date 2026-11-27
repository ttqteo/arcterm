// chunk-priority and chunk-priority-rail: a level on each chunk of an initiative that decides which chunk opens next
// (docs/superpowers/specs/2026-11-27-chunk-priority-design.md, plan docs/superpowers/plans/2026-11-27-chunk-priority.md).
// The board is .superpowers/design/chunk-priority/project/A-word-chip.dc.html (gitignored, so a checkout without it reads the
// spec's "Badge on the row"). kit is scenarios.mjs's { ...CR_KIT, ...JARVIS_KIT }.
//
// chunk-priority (surface jarvis): initiatives of its own in the initiative sheet (window.__openAddress, as any route opens
// one), every write through effortmutate, all deleted in teardown.
//   1. The plan's badges: six chunks, among them pending ones at critical, high, none, low and information and a blocked
//      high one. Each badge's word and tone class, no badge on the unset chunk, the "next" arrow on the critical chunk (the
//      sixth, not the first by position), and in a row the due chip, then the badge, then the notes count (the information
//      chunk has a due date, the critical one two notes). It also takes the What's new picture.
//   2. The Priority menu on a chunk at `low`: its Priority section ahead of Status, the five levels highest first, `low`
//      ticked, then No priority; choosing `high` writes the level and a `priority: high` note on the server and the badge
//      reads `high`.
//   3. A flat plan of twelve pending chunks whose twelfth is critical: the card folds at ten chunks, and the next chunk's row
//      shows just before "+1 more chunk".
//
// chunk-priority-rail (surface agent): the Agent rail's Initiative tab for a fixture Claude agent over a real tab whose
// session:effort names an initiative the scenario makes (no real agent is launched, AGENTS.md: a real agent costs tokens).
// The agent holds chunk 1 (active); chunks 2 (low), 3 (no level) and 4 (critical) are pending. `i` opens the tab and its
// Chunks section lists chunks 3 and 4 as next (the order of work), not chunk 2. It passes once the plan's Task 3 has landed.

import * as AC from "./agent-page-fixtures.mjs";
import { waitFor } from "./attach.mjs";

const q = (s) => JSON.stringify(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (h, expr, ms = 10_000) => waitFor((e) => h.ev(e), expr, ms);

const SHEET = '[data-jarvis-brief-sheet="effort"]';
const PLAN = `${SHEET} [data-jarvis-initiative-detail="sheet"]`;
const chunkRow = (label) => `document.querySelector(${q(`${PLAN} [data-jarvis-tracker-chunk="${label}"]`)})`;
const serverChunks = async (h, oid) => (await h.rpc("effortget", { effortoid: oid }))?.effort?.chunks ?? [];
const mutate = (h, oid, ops) => h.rpc("effortmutate", { effortoid: oid, author: "you", ops });

// today and `days` on, as a chunk's due date is spelled (YYYY-MM-DD, local time: the day the server holds Due against)
function dayIn(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// a real key through CDP, as a person types it (the binding registry listens on the window)
async function pressLetter(h, key) {
    const code = `Key${key.toUpperCase()}`;
    const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
    await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, windowsVirtualKeyCode });
    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}

// a real click at the middle-left of the element `expr` evaluates to; false when none is drawn
async function mouse(h, expr) {
    const at = await h.ev(`(() => {
        const el = ${expr};
        if (!el) return null;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x + Math.min(40, b.width / 2)), y: Math.round(b.y + b.height / 2) };
    })()`);
    if (at == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    return true;
}

// a step that throws is a failed step, not the end of the run
function stepper(steps) {
    return async (name, run) => {
        try {
            const r = await run();
            steps.push({ step: name, ok: r.ok === true, detail: r.detail });
        } catch (e) {
            steps.push({ step: name, ok: false, detail: `the step threw: ${String(e?.message ?? e)}` });
        }
    };
}

// --- chunk-priority --------------------------------------------------------------------------------------------------------

const TITLE = "verify-chunk-priority";
const FLAT_TITLE = "verify-chunk-priority flat";

// plan order: [label, status, priority]. The first by position is blocked (parked work opens only when nothing is pending);
// the first pending one has no level (it ranks as medium); the critical one is last, so the "next" arrow cannot be where
// plan order alone would put it.
const BLOCKED = "Rotate the staging keys";
const UNSET = "Tidy the changelog";
const HIGH = "Fix the crash on resume";
const LOW = "Write the migration";
const INFO = "The 90-day re-measure";
const CRIT = "Unusable replies";
const CHUNKS = [
    [BLOCKED, "blocked", "high"],
    [UNSET, "pending", ""],
    [HIGH, "pending", "high"],
    [LOW, "pending", "low"],
    [INFO, "pending", "information"],
    [CRIT, "pending", "critical"],
];
const CRIT_NOTES = ["Replies that cannot be read are scanned again on every pass.", "Seen on three sessions so far."];

// the theme-token classes a badge carries per level (chunkorder.ts priorityBadge), and ones it must not
const TONE = {
    critical: ["text-error", "font-semibold"],
    high: ["text-ink-hi", "font-semibold"],
    medium: ["text-ink-mid"],
    low: ["text-muted"],
    information: ["text-ink-faint"],
};

const FLAT_N = 12;
const flatLabel = (n) => `Flat chunk ${String(n).padStart(2, "0")}`;

// what the sheet's plan draws, read in one pass: each chunk row with its badge, due chip and notes count and where they sit
const readPlan = (h) =>
    h.ev(`(() => {
        const sheet = document.querySelector(${q(SHEET)});
        if (!sheet) return null;
        const t = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
        const before = (a, b) => a != null && b != null && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const more = sheet.querySelector("[data-jarvis-stage-more]");
        const rows = [...sheet.querySelectorAll("[data-jarvis-tracker-chunk]")].map((r) => {
            const badge = r.querySelector("[data-jarvis-chunk-priority-badge]");
            const due = r.querySelector("[data-jarvis-chunk-due]");
            const notes = r.querySelector("[data-jarvis-chunk-notes]");
            return {
                label: r.getAttribute("data-jarvis-tracker-chunk"),
                next: r.getAttribute("data-jarvis-next-chunk") === "true",
                arrow: !!r.querySelector("svg.text-accent"),
                status: t(r.querySelector("[data-jarvis-chunk-status]")),
                badge: badge ? t(badge) : null,
                badgeLevel: badge?.getAttribute("data-jarvis-chunk-priority-badge") ?? null,
                classes: badge ? [...badge.classList] : [],
                fontSize: badge ? getComputedStyle(badge).fontSize : null,
                due: due ? t(due) : null,
                notes: notes ? t(notes) : null,
                dueBeforeBadge: before(due, badge),
                badgeBeforeNotes: before(badge, notes),
                beforeMore: before(r, more),
            };
        });
        return {
            rows,
            more: more ? { n: more.getAttribute("data-jarvis-stage-more"), text: t(more) } : null,
        };
    })()`);

// the Priority menu open on a row, read in one pass
const readMenu = (h) =>
    h.ev(`(() => {
        const menu = document.querySelector(${q(`${SHEET} [data-jarvis-tracker-menu]`)});
        if (!menu) return null;
        // MenuHead is upper-cased by CSS, so its text is read from textContent
        const head = (name) => [...menu.querySelectorAll("div")].find((d) => d.children.length === 0 && d.textContent.trim() === name) ?? null;
        const follows = (a, b) => a != null && b != null && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const items = [...menu.querySelectorAll("[data-jarvis-chunk-priority]")];
        const r = menu.getBoundingClientRect();
        return {
            values: items.map((b) => b.getAttribute("data-jarvis-chunk-priority")),
            texts: items.map((b) => b.textContent.trim()),
            checked: items.filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.getAttribute("data-jarvis-chunk-priority")),
            ticks: items.filter((b) => b.querySelector("svg")).map((b) => b.getAttribute("data-jarvis-chunk-priority")),
            priorityHead: !!head("Priority"),
            statusHead: !!head("Status"),
            priorityBeforeStatus: follows(head("Priority"), head("Status")),
            itemsBeforeStatus: items.every((b) => follows(b, head("Status"))),
            headBeforeItems: items.every((b) => follows(head("Priority"), b)),
            statusButtons: menu.querySelectorAll("button:not([data-jarvis-chunk-priority])").length,
            bottom: Math.round(r.bottom),
            viewport: window.innerHeight,
        };
    })()`);

const chunkPriority = (kit) => ({
    name: "chunk-priority",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { oids: [] };
        await h.goto("jarvis");
        // a run that stopped half way left these behind
        await h.rpc("effortlist", {}).then(async (r) => {
            for (const e of (r?.efforts ?? []).filter((x) => x.title === TITLE || x.title === FLAT_TITLE)) {
                await h.rpc("effortdelete", { effortoid: e.oref.replace(/^effort:/, "") }).catch(() => {});
            }
        });
        try {
            const made = await h.rpc("effortcreate", { title: TITLE, chunks: CHUNKS.map(([label]) => ({ label })) });
            ctx.oid = made.effortoid;
            ctx.oids.push(ctx.oid);
            ctx.due = dayIn(30);
            await mutate(h, ctx.oid, [
                { op: "setChunkStatus", chunk: BLOCKED, status: "blocked" },
                ...CHUNKS.filter(([, , p]) => p !== "").map(([chunk, , priority]) => ({ op: "setChunkPriority", chunk, priority })),
                { op: "setChunkDue", chunk: INFO, due: ctx.due },
                ...CRIT_NOTES.map((note) => ({ op: "appendNote", chunk: CRIT, note })),
            ]);
            const flat = await h.rpc("effortcreate", {
                title: FLAT_TITLE,
                chunks: Array.from({ length: FLAT_N }, (_, i) => ({ label: flatLabel(i + 1) })),
            });
            ctx.flatOid = flat.effortoid;
            ctx.oids.push(ctx.flatOid);
            await mutate(h, ctx.flatOid, [{ op: "setChunkPriority", chunk: flatLabel(FLAT_N), priority: "critical" }]);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },

    async assert(h, ctx) {
        if (ctx.arrangeError != null) {
            return [{ step: "0. the initiatives were made", ok: false, detail: ctx.arrangeError }];
        }
        // the briefing is read at boot: reload so it holds what was seeded
        await kit.briefReload(h);
        const steps = [];
        const step = stepper(steps);
        const open = async (oid, firstLabel) => {
            await until(h, `typeof window.__openAddress === "function"`, 5_000);
            const opened = await h.ev(`window.__openAddress(${q("effort:" + oid)})`);
            const drew = await until(h, `!!${chunkRow(firstLabel)}`);
            // a row that arrives opens on the spring: read the plan once it has settled
            await sleep(600);
            return { opened, drew };
        };

        await step("1. badges: each level's word and tone, none on an unset chunk, the next arrow on the critical chunk", async () => {
            const { opened, drew } = await open(ctx.oid, BLOCKED);
            if (!drew) return { ok: false, detail: `the sheet drew no plan (open: ${JSON.stringify(opened)})` };
            await h.shot("cdp-shots/chunk-priority-badges.png");
            const r = await readPlan(h);
            const problems = [];
            const row = (label) => r.rows.find((x) => x.label === label);
            if (r.rows.length !== CHUNKS.length) problems.push(`${r.rows.length} chunk rows`);
            for (const [label, , level] of CHUNKS) {
                const x = row(label);
                if (x == null) {
                    problems.push(`no row for "${label}"`);
                    continue;
                }
                if (level === "") {
                    if (x.badge != null) problems.push(`"${label}" has no level but shows "${x.badge}"`);
                    continue;
                }
                if (x.badge !== level || x.badgeLevel !== level) problems.push(`"${label}" badge "${x.badge}" (level attr ${x.badgeLevel}), want ${level}`);
                for (const cls of TONE[level]) {
                    if (!x.classes.includes(cls)) problems.push(`"${label}" ${level} badge lacks ${cls} (${x.classes.join(" ")})`);
                }
                if (level !== "critical" && level !== "high" && x.classes.includes("font-semibold")) problems.push(`${level} badge is semibold`);
                if (x.fontSize !== "10.5px") problems.push(`"${label}" badge is ${x.fontSize}, want 10.5px`);
            }
            // the "next" arrow: on the critical chunk, which is the last by position; the first by position (blocked) has none
            const next = r.rows.filter((x) => x.next).map((x) => x.label);
            if (next.join() !== CRIT) problems.push(`next arrow on [${next.join(" | ")}], want ${CRIT}`);
            const crit = row(CRIT);
            if (crit != null && (!crit.arrow || crit.status !== "next")) problems.push(`critical row: arrow ${crit.arrow}, status word "${crit.status}"`);
            if (r.rows[0]?.next) problems.push("the first chunk by position is marked next");
            // a row reads: label, due chip, priority word, notes count
            const info = row(INFO);
            if (info != null) {
                if (info.due == null || !info.due.startsWith("due ") || !info.due.includes(ctx.due.slice(5))) problems.push(`information row's due chip "${info.due}"`);
                if (!info.dueBeforeBadge) problems.push("information row: the due chip does not come before the badge");
                if (!info.badgeBeforeNotes) problems.push("information row: the badge does not come before the notes count");
            }
            if (crit != null) {
                if (!crit.badgeBeforeNotes) problems.push("critical row: the badge does not come before the notes count");
                const n = Number.parseInt(crit.notes ?? "", 10);
                if (!(n >= CRIT_NOTES.length)) problems.push(`critical row's notes count "${crit.notes}", want at least ${CRIT_NOTES.length}`);
            }
            // the picture of the feature for What's new (scripts/whatsnew-shot.mjs); a failed picture does not fail the step
            let picture;
            try {
                await h.ev(`(() => { for (const b of document.querySelectorAll("[data-notification-close]")) b.click(); return true; })()`);
                picture = await h.whatsnewShot("chunk-priority", { selector: SHEET });
            } catch (e) {
                picture = { error: String(e?.message ?? e) };
            }
            return {
                ok: problems.length === 0,
                detail: problems.join("; ") || `badges ${r.rows.map((x) => `${x.label}: ${x.badge ?? "-"}`).join(", ")}; next ${next.join()}; picture ${JSON.stringify(picture)}`,
            };
        });

        await step("2. the Priority menu: its section first, the level held ticked; choosing high writes it", async () => {
            const before = (await serverChunks(h, ctx.oid)).find((c) => c.label === LOW);
            const status = `${chunkRow(LOW)}?.querySelector("[data-jarvis-chunk-status]")`;
            await h.ev(`${status}?.click()`);
            const up = await until(h, `!!document.querySelector(${q(`${SHEET} [data-jarvis-tracker-menu]`)})`, 5_000);
            if (!up) return { ok: false, detail: "the status button opened no menu" };
            // the menu reveals on a spring: read and click it once it has settled
            await sleep(500);
            const m = await readMenu(h);
            await h.shot("cdp-shots/chunk-priority-menu.png");
            const problems = [];
            const want = ["critical", "high", "medium", "low", "information", "none"];
            if (m.values.join() !== want.join()) problems.push(`Priority items ${m.values.join()}, want ${want.join()}`);
            if (m.texts.join() !== [...want.slice(0, 5), "No priority"].join()) problems.push(`item texts ${m.texts.join(" | ")}`);
            if (m.checked.join() !== "low") problems.push(`ticked [${m.checked.join()}], want low`);
            if (m.ticks.join() !== "low") problems.push(`check marks on [${m.ticks.join()}], want low`);
            if (!m.priorityHead || !m.statusHead) problems.push(`menu heads: Priority ${m.priorityHead}, Status ${m.statusHead}`);
            if (!m.priorityBeforeStatus || !m.headBeforeItems || !m.itemsBeforeStatus) problems.push("the Priority section does not come before the Status items");
            if (m.statusButtons < 6) problems.push(`${m.statusButtons} other buttons in the menu (Status, Rename, Move… must still be there)`);
            if (before?.priority !== "low") problems.push(`the server holds "${before?.priority}" on the chunk, want low`);

            // choose high: a real click on its item
            const item = `document.querySelector(${q(`${SHEET} [data-jarvis-tracker-menu] [data-jarvis-chunk-priority="high"]`)})`;
            const held = async () => {
                const c = (await serverChunks(h, ctx.oid)).find((x) => x.label === LOW);
                return c?.priority === "high" && (c.notes ?? []).some((n) => String(n.text ?? n).startsWith("priority: high"));
            };
            let by = "a click";
            await mouse(h, item);
            let wrote = false;
            for (let waited = 0; waited < 4_000 && !wrote; waited += 250) {
                await sleep(250);
                wrote = await held();
            }
            if (!wrote) {
                // the menu may sit under the window's edge: say so, and still choose with a scripted click
                by = "a scripted click (the real one did not land)";
                await h.ev(`${item}?.click()`);
                for (let waited = 0; waited < 4_000 && !wrote; waited += 250) {
                    await sleep(250);
                    wrote = await held();
                }
            }
            const after = (await serverChunks(h, ctx.oid)).find((c) => c.label === LOW);
            if (!wrote) problems.push(`choosing high left the server at priority "${after?.priority}", notes ${JSON.stringify((after?.notes ?? []).map((n) => n.text ?? n))}`);
            // the menu closes and the badge reads high
            const shown = await until(h, `${chunkRow(LOW)}?.querySelector("[data-jarvis-chunk-priority-badge]")?.textContent.trim() === "high"`, 5_000);
            const menuGone = await until(h, `!document.querySelector(${q(`${SHEET} [data-jarvis-tracker-menu]`)})`, 3_000);
            await sleep(300);
            await h.shot("cdp-shots/chunk-priority-chosen.png");
            if (!shown) problems.push("the badge never read high");
            if (!menuGone) problems.push("the menu stayed open after the choice");
            return {
                ok: problems.length === 0,
                detail: problems.join("; ") || `menu ${m.values.join()} with ${m.checked.join()} ticked; chose high by ${by}; server priority ${after?.priority}; menu bottom ${m.bottom} of ${m.viewport}px`,
            };
        });

        await step("3. a folded plan: the next chunk's row shows just before the +N more", async () => {
            const { opened, drew } = await open(ctx.flatOid, flatLabel(1));
            if (!drew) return { ok: false, detail: `the sheet drew no flat plan (open: ${JSON.stringify(opened)})` };
            await h.shot("cdp-shots/chunk-priority-folded.png");
            const r = await readPlan(h);
            const problems = [];
            const labels = r.rows.map((x) => x.label);
            const last = r.rows.find((x) => x.label === flatLabel(FLAT_N));
            // ten chunks of the preview, the next chunk, and one hidden chunk behind "+1 more"
            if (last == null) problems.push(`the critical chunk "${flatLabel(FLAT_N)}" has no row (rows: ${labels.length})`);
            else {
                if (!last.next) problems.push("the critical chunk's row is not marked next");
                if (last.badge !== "critical") problems.push(`its badge "${last.badge}", want critical`);
                if (!last.beforeMore) problems.push("its row does not come before the +N more");
            }
            if (labels.length !== 11) problems.push(`${labels.length} chunk rows, want 11 (the first 10 and the next chunk)`);
            if (labels.includes(flatLabel(FLAT_N - 1))) problems.push(`"${flatLabel(FLAT_N - 1)}" is drawn, it should be the one hidden`);
            if (r.more == null || r.more.n !== "1" || !/\+1 more chunk$/.test(r.more.text)) problems.push(`the more row ${JSON.stringify(r.more)}, want +1 more chunk`);
            return { ok: problems.length === 0, detail: problems.join("; ") || `${labels.length} rows, "${flatLabel(FLAT_N)}" next before "${r.more?.text}"` };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-initiative-sheet-head] button[aria-label="Close (Esc)"]`)})?.click()`).catch(() => {});
        for (const oid of ctx.oids ?? []) {
            await h.rpc("effortdelete", { effortoid: oid }).catch(() => {});
        }
    },
});

// --- chunk-priority-rail ---------------------------------------------------------------------------------------------------

const RAIL_TITLE = "verify-chunk-priority rail";
const RAIL_PROJECT = "verify-chunk-priority";
const RAIL_NAME = "chunk priority in the rail";
const R = {
    own: "Chunk one held by the agent",
    low: "Chunk two at low",
    unset: "Chunk three with no level",
    crit: "Chunk four at critical",
};

const RAIL_VISIBLE_KEY = "agent.rail.visible";
const RAIL_TAB_KEY = "agent.rail.tab";
const RAIL_SECTIONS_KEY = "cockpit.rail.sections";
const CHATMODE_KEY = "agent.chatmode";
const PENDING_KEY = "chat.initiative.pending";

const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const SELECTED = `${ASIDE}?.querySelector('[role="tab"][aria-selected="true"]')?.dataset.railTab ?? null`;
const IN = (id) => `${ASIDE}?.querySelector('[data-rail-initiative="${id}"]')`;
const LINK_CHIP = `document.querySelector("[data-agent-header] [data-initiative-link-open]")`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;

const chunkPriorityRail = (kit) => {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const rosterRow = (ctx) => ({
        project: RAIL_PROJECT,
        task: "",
        agent: "claude",
        model: "opus",
        state: "idle",
        idleSince: Date.now() - 60_000,
        usage: { contextpct: 42 },
        id: ctx.tab.tabId,
        name: RAIL_NAME,
        blockId: ctx.tab.blockId,
        effortId: ctx.oid,
    });

    return {
        name: "chunk-priority-rail",
        surface: "agent",
        async arrange(h) {
            const ctx = { oids: [], prev: {} };
            let at = "reading the keys";
            try {
                // the keys the scenario touches, put back in teardown; the rail visible, on Overview, over an empty grid
                const keys = [RAIL_VISIBLE_KEY, RAIL_TAB_KEY, RAIL_SECTIONS_KEY, CHATMODE_KEY, GRID_KEY, PENDING_KEY];
                for (const k of keys) ctx.prev[k] = await h.ev(`localStorage.getItem(${q(k)})`);
                await h.ev(`(() => {
                    localStorage.setItem(${q(RAIL_VISIBLE_KEY)}, "true");
                    for (const k of [${q(RAIL_TAB_KEY)}, ${q(RAIL_SECTIONS_KEY)}, ${q(CHATMODE_KEY)}, ${q(PENDING_KEY)}]) localStorage.removeItem(k);
                    localStorage.setItem(${q(GRID_KEY)}, ${q(JSON.stringify(GRID_EMPTY))});
                    return true;
                })()`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here with none: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the initiative";
                // an initiative of the agent's project; chunk 1 is the agent's own, the rest wait their turn
                const made = await h.rpc("effortcreate", {
                    title: RAIL_TITLE,
                    project: RAIL_PROJECT,
                    chunks: [R.own, R.low, R.unset, R.crit].map((label) => ({ label })),
                });
                ctx.oid = made.effortoid;
                ctx.oids.push(ctx.oid);
                at = "making the tab";
                // a real tab whose session:effort names the initiative
                ctx.tab = await makeTab(h, ctx, { label: RAIL_NAME, tabMeta: { "session:project": RAIL_PROJECT, "session:effort": `effort:${ctx.oid}` } });
                at = "writing the chunks";
                await mutate(h, ctx.oid, [
                    { op: "setChunkStatus", chunk: R.own, status: "active" },
                    { op: "attachWork", chunk: R.own, kind: "agent", oref: `agent:${ctx.tab.tabId}` },
                    { op: "setChunkPriority", chunk: R.low, priority: "low" },
                    { op: "setChunkPriority", chunk: R.crit, priority: "critical" },
                ]);
                at = "setting the roster";
                await AC.setRoster(h, [rosterRow(ctx)]);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            if (ctx.arrangeError != null) {
                return [{ step: "0. the initiative, the fixture agent and its tab", ok: false, detail: ctx.arrangeError }];
            }
            const steps = [];
            const step = stepper(steps);
            const A = ctx.tab.tabId;

            await step("1. i opens the Initiative tab; its Chunks section lists chunks 3 and 4 as next, not chunk 2", async () => {
                await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
                await AC.focusAgent(h, A);
                // the page reads the initiative (an effort made after it loaded) before the chip can name it
                await AC.agentPage(h, `const S = await mod("app/view/jarvis/effortstore.ts"); await S.loadEffortDetail(${q("effort:" + ctx.oid)}, Number.MAX_SAFE_INTEGER); return true;`);
                const linked = await polishWaitFor(h, `${FLAT}(${LINK_CHIP}).includes(${q(RAIL_TITLE)})`, 15_000);
                if (!linked) return { ok: false, detail: "the header's initiative chip never named the initiative: the agent is not linked to it" };
                await h.ev(`document.activeElement?.blur?.(); document.querySelector("[data-cockpit-surface-wrap]")?.focus()`);
                await pressLetter(h, "i");
                await polishNap(600);
                const up = await polishWaitFor(h, `!!${IN(A)} && ${IN(A)}.querySelector("[data-rail-initiative-row]") != null`, 15_000);
                await polishNap(600);
                await h.ev(`(() => { for (const b of document.querySelectorAll("[data-notification-close]")) b.click(); return true; })()`);
                await h.shot("cdp-shots/chunk-priority-rail.png");
                if (!up) return { ok: false, detail: "i opened no Initiative tab with rows" };
                const got = await h.ev(`(() => {
                    const pane = ${IN(A)};
                    return {
                        selected: ${SELECTED},
                        title: ${FLAT}(pane?.querySelector("[data-rail-initiative-title]")),
                        rows: [...(pane?.querySelectorAll("[data-rail-initiative-row]") ?? [])]
                            .filter((r) => !r.closest("[data-rail-initiative-all-list]"))
                            .map((r) => ({ label: r.getAttribute("data-rail-initiative-row"), kind: r.getAttribute("data-rail-initiative-row-kind") })),
                    };
                })()`);
                const problems = [];
                const kind = (label) => got.rows.find((r) => r.label === label)?.kind ?? null;
                if (got.selected !== "initiative") problems.push(`the selected tab is ${got.selected}`);
                if (got.title !== RAIL_TITLE) problems.push(`title "${got.title}"`);
                if (kind(R.own) !== "mine") problems.push(`the agent's own chunk is "${kind(R.own)}", want mine`);
                // the next rows are the open chunks of highest rank, not the first two by position: chunk 2 (low) is no longer
                // among them. The window lists its rows in plan order, so 3 comes before 4 on screen; the pair is what is checked.
                const next = got.rows.filter((r) => r.kind === "next").map((r) => r.label);
                if (next.slice().sort().join() !== [R.unset, R.crit].sort().join()) problems.push(`next rows [${next.join(" | ")}], want ${R.unset} and ${R.crit}`);
                if (got.rows.some((r) => r.label === R.low)) problems.push(`"${R.low}" is listed (as ${kind(R.low)}), it ranks below both`);
                return { ok: problems.length === 0, detail: problems.join("; ") || `rows ${got.rows.map((r) => `${r.kind}: ${r.label}`).join(" | ")}` };
            });

            return steps;
        },

        async teardown(h, ctx) {
            const tryStep = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chunk-priority-rail teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await tryStep("remove the probe", () => h.ev(`(() => { delete window.__chatSuggestFake; return true; })()`));
            if (ctx.tab != null) {
                await tryStep("put the view and the waiting lines back", () =>
                    AC.agentPage(
                        h,
                        `const S = await mod("app/view/agents/chatinitiativestore.ts");
                        const M = await mod("app/view/agents/chatmodestore.ts");
                        S.takeResultLines(${q(ctx.tab.tabId)}); M.setChatMode(${q(ctx.tab.tabId)}, "chat");
                        return true;`
                    )
                );
            }
            await tryStep("restore the roster", () => AC.restoreRoster(h));
            for (const oid of ctx.oids ?? []) await tryStep(`delete ${oid}`, () => h.rpc("effortdelete", { effortoid: oid }));
            await tryStep("close the fixture tab", () => closeTabs(h, ctx));
            await tryStep("restore the keys", () =>
                h.ev(`(() => {
                    for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                        if (v == null) localStorage.removeItem(k);
                        else localStorage.setItem(k, v);
                    }
                    return true;
                })()`)
            );
            await tryStep("reload onto the live roster", () => ahReload(h));
            await tryStep("go home", () => h.goto("cockpit"));
        },
    };
};

export default function (kit) {
    return [chunkPriority(kit), chunkPriorityRail(kit)];
}
