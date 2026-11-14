// overlays-frost-palette: the command palette's panel frosted over today's dialog scrim (board B-todays-scrim.dc.html in
// the overlays-chat-look canvas; spec docs/superpowers/specs/2026-11-14-overlays-chat-look-design.md section 3, the
// plan's Task 3).
//
// The palette stays a ModalShell dialog with the scrim it has today (black 60% with a blur). ModalShell's `frosted` prop
// makes that scrim a sibling layer behind the panel's click-through positioning container, so the panel's own blur samples
// the dimmed, blurred cockpit instead of the scrim's black (a scrim's backdrop-filter makes it a backdrop root). Seven steps:
//   1. the palette opens over a working agent
//   2. the panel is drawn on `frost` with no backdrop root above it, and the scrim still draws black 60% with its blur
//   3. the open motion ran: the panel's opacity went from below 1 to 1
//   4. Tab and Shift+Tab keep focus inside the panel
//   5. Escape closes it: the panel and the scrim are gone
//   6. a click on the scrim, outside the panel, closes it
//   7. a click inside the panel keeps it open
//
// The DOM contract it reads: the panel is the [role="dialog"] holding input[data-palette-input]; the scrim is
// [data-modal-scrim] (frosted ModalShell only), and neither contains the other.
//
// One fixture Claude agent over a real tab with a short transcript, a roster row for it in state working (the page's dev mock
// roster), the Agent surface showing it. kit is scenarios.mjs's OF_KIT (CR_KIT and scenario(name)).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "../agent-page-fixtures.mjs";
import { frostProbe, frostVerdict } from "./frostcheck.mjs";

const NAME = "overlays-frost-palette";
const LABEL = "overlays-frost palette";
const PROJECT = "verify-overlays-frost";
const WAIT_MS = 15000;
const SHORT_MS = 5000;
// ModalShell's scrim is bg-black/60: black at 60%, which is alpha 153 of 255. Tailwind 4 computes it as oklab(0 0 0 / 0.6) and
// an older build as rgba(0, 0, 0, 0.6), so the page reads it back as RGBA through a canvas rather than comparing text.
const SCRIM_ALPHA = 153;

const DIALOG = `[role="dialog"]:has(input[data-palette-input])`;
const SCRIM = `[data-modal-scrim]`;
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;

const KEYS = {
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    shiftTab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 },
};

// one sample per frame of the panel's and the scrim's computed opacity, while either is in the page: the open motion is
// the climb from below 1 to 1, the exit the fall back. Capped, and reset before an open that wants a clean record.
const SAMPLER_ON = `(() => {
    if (window.__ofPal) window.__ofPal.on = false;
    const s = (window.__ofPal = { frames: [], on: true });
    const op = (sel) => { const el = document.querySelector(sel); return el ? Number(getComputedStyle(el).opacity) : null; };
    const tick = () => {
        if (window.__ofPal !== s || !s.on) return;
        const panel = op(${JSON.stringify(DIALOG)});
        const scrim = op(${JSON.stringify(SCRIM)});
        if ((panel != null || scrim != null) && s.frames.length < 900) s.frames.push({ panel, scrim });
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
})()`;
const SAMPLER_RESET = `(() => { if (window.__ofPal) window.__ofPal.frames.length = 0; return true; })()`;
const SAMPLER_OFF = `(() => { if (window.__ofPal) window.__ofPal.on = false; const f = window.__ofPal?.frames ?? []; delete window.__ofPal; return f.length; })()`;
const SAMPLER_FRAMES = `(window.__ofPal?.frames ?? [])`;

// the panel's and the scrim's geometry and paint, read in one call
const READ_LAYERS = `(() => {
    const panel = ${q(DIALOG)};
    const scrim = ${q(SCRIM)};
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const cs = scrim ? getComputedStyle(scrim) : null;
    const blur = cs ? cs.backdropFilter || cs.webkitBackdropFilter || "none" : null;
    // a color the canvas cannot parse leaves its fillStyle opaque black, which fails the alpha check
    const rgba = (css) => {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.fillStyle = css;
        x.fillRect(0, 0, 1, 1);
        return [...x.getImageData(0, 0, 1, 1).data];
    };
    return {
        scrimRgba: cs ? rgba(cs.backgroundColor) : null,
        panel: !!panel,
        scrim: !!scrim,
        panelRect: rect(panel),
        scrimRect: rect(scrim),
        panelOpacity: panel ? Number(getComputedStyle(panel).opacity) : null,
        scrimOpacity: cs ? Number(cs.opacity) : null,
        scrimBackground: cs ? cs.backgroundColor : null,
        scrimBlur: blur,
        scrimContainsPanel: !!(panel && scrim && scrim.contains(panel)),
        panelContainsScrim: !!(panel && scrim && panel.contains(scrim)),
        input: !!${q("input[data-palette-input]")},
        viewport: { w: innerWidth, h: innerHeight },
    };
})()`;

// where focus is, against the panel
const FOCUS_NOW = `(() => {
    const panel = ${q(DIALOG)};
    const a = document.activeElement;
    return {
        panel: !!panel,
        inside: !!(panel && a && a !== document.body && panel.contains(a)),
        at: a == null ? "none" : a === document.body ? "body" : a.tagName.toLowerCase() + (a.hasAttribute("data-palette-input") ? "[data-palette-input]" : ""),
        scope: panel?.querySelector('[data-palette-scope][aria-pressed="true"]')?.getAttribute("data-palette-scope") ?? null,
    };
})()`;

// a point on the scrim that the panel does not cover: the page hit-tests it to the scrim, which proves the positioning
// container in front of it lets the press through
const SCRIM_POINT = `(() => {
    const panel = ${q(DIALOG)};
    if (!panel) return null;
    const r = panel.getBoundingClientRect();
    const cands = [
        [r.left - 24, r.top + r.height / 2],
        [r.right + 24, r.top + r.height / 2],
        [r.left + r.width / 2, r.bottom + 24],
        [r.left + r.width / 2, r.top - 8],
        [8, innerHeight - 8],
    ];
    for (const [x, y] of cands) {
        if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest("[data-modal-scrim]") && !panel.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
})()`;

// a point inside the panel on something that does nothing when pressed: the search box, then the strip along the bottom
const PANEL_POINTS = `(() => {
    const panel = ${q(DIALOG)};
    if (!panel) return [];
    const out = [];
    const input = panel.querySelector("input[data-palette-input]");
    if (input) {
        const r = input.getBoundingClientRect();
        out.push({ what: "the search box", x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    }
    const r = panel.getBoundingClientRect();
    const x = Math.round(r.left + 20);
    const y = Math.round(r.bottom - 8);
    const hit = document.elementFromPoint(x, y);
    if (hit && panel.contains(hit) && !hit.closest("button, a, input, textarea, [role='option']")) out.push({ what: "the strip along the bottom", x, y });
    return out;
})()`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode"];

    const roster = (ctx) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "working",
            activity: "Reading retry.ts",
            activeMs: 30_000,
            usage: { contextpct: 42 },
            id: ctx.tab.tabId,
            name: LABEL,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
        },
    ];

    async function key(h, k) {
        for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k });
    }
    // a press as a person makes it: the pointer moves there, goes down and comes up
    async function click(h, x, y) {
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    }
    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/${NAME}-${name}.png`);
        } catch (e) {
            console.error(`${NAME}: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }
    const setOpen = (h, open) => AC.agentPage(h, `globalStore.set(agentsModel().paletteOpenAtom, ${open}); return true;`);
    const gone = (h, ms = SHORT_MS) => polishWaitFor(h, `${q(DIALOG)} == null && ${q(SCRIM)} == null`, ms);
    // opened: the panel and the scrim are in the page, the search box is there and has focus
    const opened = (h, ms = WAIT_MS) =>
        polishWaitFor(h, `${q(DIALOG)} != null && ${q(SCRIM)} != null && document.activeElement === ${q("input[data-palette-input]")}`, ms);
    // settled: the open motion has ended on both layers
    const settled = (h, ms = SHORT_MS) =>
        polishWaitFor(h, `(() => { const p = ${q(DIALOG)}; const s = ${q(SCRIM)}; return !!p && !!s && Number(getComputedStyle(p).opacity) === 1 && Number(getComputedStyle(s).opacity) === 1; })()`, ms);
    async function open(h) {
        await setOpen(h, true);
        const up = await opened(h);
        const still = up && (await settled(h));
        return { up, still };
    }

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-overlays-frost-palette-")), prev: {} };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 8; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the sync client work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. The sync client retries a failed request, and each attempt logs what it sent and what came back.`, o(i * 10 + 2)));
                }
                lines.push(AC.userText("make the sync client retry a failed request", o(300)));
                ctx.transcript = AC.writeTranscript(ctx.dir, "overlays-frost-palette", lines);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");
                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, { label: LABEL });
                at = "setting the roster";
                await AC.setRoster(h, roster(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent, its tab and its transcript", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tab.tabId;
            // a step that throws is a failed step, not the end of the run: the ones after it read what they need themselves
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await h.ev(SAMPLER_ON);

            // 1. the palette opens over a working agent
            await run("1. the palette opens over a working agent", async (name) => {
                await AC.focusAgent(h, A);
                const behind = await polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-item]").length ?? 0) >= 3`, WAIT_MS);
                await h.ev(SAMPLER_RESET);
                const o = await open(h);
                const got = await h.ev(READ_LAYERS);
                await shot(h, "1-open");
                rec(
                    `${name}: the agent's conversation is behind it, and the dialog, the scrim and the search box (with focus) are up`,
                    behind && o.up && got.panel && got.scrim && got.input && (got.panelRect?.width ?? 0) > 0 && (got.panelRect?.height ?? 0) > 0,
                    { behind, ...o, panel: got.panel, scrim: got.scrim, input: got.input, panelRect: got.panelRect }
                );
            });

            // 2. the panel is frosted and the scrim is today's
            await run("2. the panel is frosted, the scrim is today's", async (name) => {
                const still = await settled(h);
                const r = await h.ev(frostProbe(DIALOG));
                const v = frostVerdict(r);
                const got = await h.ev(READ_LAYERS);
                const blurPx = Number(/^blur\((\d+(?:\.\d+)?)px\)$/.exec(String(got.scrimBlur ?? "").trim())?.[1] ?? 0);
                const [sr, sg, sb, sa] = got.scrimRgba ?? [255, 255, 255, 255];
                const black60 = sr === 0 && sg === 0 && sb === 0 && Math.abs(sa - SCRIM_ALPHA) <= 1;
                await shot(h, "2-frost");
                rec(
                    `${name}: the dialog panel draws blur(18px) over the panel color with no backdrop root above it (frostVerdict), and the scrim, a sibling that does not contain it, still draws black at 60% with a blur`,
                    still && v.ok && got.scrim && !got.scrimContainsPanel && !got.panelContainsScrim && black60 && blurPx > 0,
                    {
                        settled: still,
                        frost: v.detail,
                        blockedBy: r.blockedBy,
                        scrimBackground: got.scrimBackground,
                        scrimRgba: got.scrimRgba,
                        scrimBlur: got.scrimBlur,
                        scrimContainsPanel: got.scrimContainsPanel,
                        panelContainsScrim: got.panelContainsScrim,
                    }
                );
            });

            // 3. the open motion ran
            await run("3. the open motion ran", async (name) => {
                const frames = await h.ev(SAMPLER_FRAMES);
                const panel = frames.map((f) => f.panel).filter((x) => x != null);
                const scrim = frames.map((f) => f.scrim).filter((x) => x != null);
                const climbed = panel.length > 0 && Math.min(...panel) < 1 && panel[panel.length - 1] === 1;
                const faded = scrim.length > 0 && Math.min(...scrim) < 1 && scrim[scrim.length - 1] === 1;
                rec(
                    `${name}: the panel's opacity went from below 1 to 1, and so did the scrim's`,
                    climbed && faded,
                    { frames: frames.length, panelFirst: panel[0] ?? null, panelMin: panel.length ? Math.min(...panel) : null, panelLast: panel.at(-1) ?? null, scrimMin: scrim.length ? Math.min(...scrim) : null, scrimLast: scrim.at(-1) ?? null }
                );
            });

            // 4. Tab and Shift+Tab keep focus in the panel (the search box owns Tab: it walks the scopes)
            await run("4. focus stays in the panel", async (name) => {
                const before = await h.ev(FOCUS_NOW);
                const trail = [];
                for (const k of [KEYS.tab, KEYS.tab, KEYS.tab, KEYS.tab, KEYS.shiftTab, KEYS.shiftTab]) {
                    await key(h, k);
                    await polishNap(80);
                    trail.push(await h.ev(FOCUS_NOW));
                }
                await shot(h, "4-tabbed");
                const moved = trail.some((t) => t.scope !== before.scope);
                rec(
                    `${name}: after four Tab and two Shift+Tab presses focus is on an element inside the panel each time (and the keys reached the palette: its scope moved)`,
                    before.inside && trail.every((t) => t.inside) && moved,
                    { before, trail: trail.map((t) => `${t.at}${t.inside ? "" : " OUTSIDE"} ${t.scope}`) }
                );
            });

            // 5. Escape closes it
            await run("5. Escape closes it", async (name) => {
                await key(h, KEYS.escape);
                const closed = await gone(h);
                const got = await h.ev(READ_LAYERS);
                await shot(h, "5-closed");
                rec(`${name}: the panel and the scrim are both out of the page`, closed && !got.panel && !got.scrim, { closed, panel: got.panel, scrim: got.scrim });
            });

            // 6. a click on the scrim, outside the panel, closes it
            await run("6. a click on the scrim closes it", async (name) => {
                const o = await open(h);
                const at = await h.ev(SCRIM_POINT);
                if (!o.up || at == null) {
                    rec(`${name}: a press on the scrim outside the panel closes the palette`, false, { ...o, at, why: o.up ? "no point outside the panel hit-tests to the scrim" : "the palette did not open" });
                    return;
                }
                await shot(h, "6-before-scrim-click");
                await click(h, at.x, at.y);
                const closed = await gone(h);
                rec(`${name}: a press on the scrim outside the panel (the page hit-tests it to the scrim) closes the palette`, closed, { ...o, at, closed });
            });

            // 7. a click inside the panel keeps it open
            await run("7. a click inside the panel keeps it open", async (name) => {
                const o = await open(h);
                const points = await h.ev(PANEL_POINTS);
                if (!o.up || points.length === 0) {
                    rec(`${name}: a press inside the panel keeps the palette open`, false, { ...o, points, why: o.up ? "no point inside the panel to press" : "the palette did not open" });
                    return;
                }
                const results = [];
                for (const p of points) {
                    await click(h, p.x, p.y);
                    await polishNap(450);
                    const got = await h.ev(READ_LAYERS);
                    results.push({ what: p.what, panel: got.panel, scrim: got.scrim });
                }
                await shot(h, "7-after-inside-click");
                rec(`${name}: a press on ${points.map((p) => p.what).join(" and on ")} leaves the dialog and the scrim in the page`, results.every((r) => r.panel && r.scrim), { ...o, results });
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the palette", async () => {
                await setOpen(h, false);
                await gone(h);
            });
            await step("remove the sampler", () => h.ev(SAMPLER_OFF));
            if (ctx.tab != null) {
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("close the fixture tab", () => closeTabs(h, ctx));
            }
            await step("restore the keys", () =>
                h.ev(`(() => {
                    for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                        if (v == null) localStorage.removeItem(k);
                        else localStorage.setItem(k, v);
                    }
                    return true;
                })()`)
            );
            await step("reload onto the live roster", () => ahReload(h));
            // wavesrv's transcript watch can hold the fixture file for a moment after its agent is gone
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
