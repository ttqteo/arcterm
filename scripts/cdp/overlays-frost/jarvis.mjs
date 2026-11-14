// overlays-frost-jarvis: the Jobs popover first, then Jarvis' and Code's popovers, frosted, one step per changed site
// (docs/superpowers/specs/2026-11-14-overlays-chat-look-design.md section 2, the plan's Task 6).
//
// One fixture Claude agent over a real tab with a fixture roster row in state working (the page's dev mock roster) and a
// throwaway git project registered with the app, plus one real initiative with two chunks (the Jarvis steps). Every panel
// goes through frostVerdict (frostcheck.mjs): drawn on the `frost` class, and under no ancestor that is a backdrop root.
// A panel that is a PopoverReveal's motion.div has no marker of its own, so it is found as the parent of the marker child
// the caller puts in it (`*:has(> [data-…])`); the step waits until that panel and every ancestor are at opacity 1 before it
// probes, since a PopoverReveal fade makes its motion.div a backdrop root while it runs. Steps:
//   1. the Jobs popover (cockpit/jobqueuepanel.tsx) over the working agent, a running and a queued heavy job injected through
//      the chip's dev hook (the way the jobqueue-chip scenario's later steps do)
//   2. Jarvis' pet, on the Agent surface: its bubble (a notify), its peek (the creature clicked), the peek's stay-put menu
//      and its hide menu. The bubble, the peek and the stay menu draw a solid fill in the folded window (the see-through
//      mini window, sprout-mini.tsx), which a CDP page cannot be: that variant is read in the code, not here
//   3. the terminal's find bar (element/search.tsx), opened as a server's Log opens it (termsearch.ts)
//   4. Chat's initiative picker (jarvis/initiativepicker.tsx), from the Chat header's link chip
//   5. the Brief's autonomy ladder (jarvis/autonomyladderview.tsx)
//   6. the initiative sheet's chunk status menu (jarvis/inlinetrackerview.tsx), then, in the chunk's own view, its status
//      menu (jarvis/chunkview.tsx)
//   7. the Code surface: the project picker, the review list, Send review's agent list and the unsaved-edits menu
//      (code/codesurface.tsx, code/codereviewbar.tsx)
// Each step screenshots. kit is scenarios.mjs's CR_KIT (+ scenario(name), unused here).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "../agent-page-fixtures.mjs";
import { frostProbe, frostVerdict } from "./frostcheck.mjs";

const NAME = "overlays frost jarvis";
const PROJECT = "verify-of-jarvis";
const INITIATIVE = "verify-of-jarvis initiative";
// [label, stage, status]
const CHUNKS = [
    ["Wire", "Build", "active"],
    ["Ship", "Build", "pending"],
];
const WAIT_MS = 15000;
const SHORT_MS = 5000;

const FILES = ["src/sync/client.ts", "src/sync/retry.ts", "README.md"];

// the panels, each as the selector of the element that carries the frost (a PopoverReveal's motion.div is the parent of
// the child the caller puts in it)
const PANEL = {
    jobs: "*:has(> [data-job-queue-panel])",
    bubble: "*:has(> * > [data-pet-bubble])",
    peek: "*:has(> [data-pet-peek])",
    stay: "*:has(> [data-pet-stay-menu])",
    hide: "*:has(> [data-pet-hide-menu])",
    search: ".search-container",
    picker: "[data-initiative-picker]",
    autonomy: "*:has(> [data-jarvis-autonomy='panel'])",
    trackerMenu: "[data-jarvis-tracker-menu]",
    chunkMenu: "[data-jarvis-chunk-status-menu]",
    codeProject: "*:has(> [data-code-picker-path])",
    codeList: "*:has(> [data-code-review-list])",
    codeSend: "*:has(> [data-code-agent-picker-row]), *:has(> [data-code-agent-picker-empty])",
    codeUnsaved: "*:has(> [data-code-unsaved-row])",
};

const SHEET = '[data-jarvis-brief-sheet="effort"]';

const KEYS = {
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
};

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
// the panel is up, and so is every ancestor of it at opacity 1: nothing above it is a fade's backdrop root any more
const FADED_IN = (sel) =>
    `(() => {
        let el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return false;
        for (; el && el !== document.documentElement; el = el.parentElement) {
            if (Number(getComputedStyle(el).opacity) < 1) return false;
        }
        return true;
    })()`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    // the keys the steps change and teardown puts back. code.drafts and code.reviews are not here: the Code stores write
    // them on pagehide, so the atoms are put back instead (teardown)
    const LS_KEYS = [GRID_KEY, "agent.chatmode", "code.project.last", "code.project.recents"];

    // the roster row of the one agent, working: the backdrop every panel is drawn over
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
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
        },
    ];

    async function key(h, k) {
        for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k });
    }
    // a real click at the left of an element (the way scenarios-jarvis-sheet.mjs clicks a row), so its own click timing runs
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
        await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
        return true;
    }
    const click = (h, sel) => h.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); b?.click(); return !!b; })()`);
    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/overlays-frost-jarvis-${name}.png`);
        } catch (e) {
            console.error(`overlays-frost-jarvis: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }
    // waits for a panel to be up and faded in, reads it through the shared check, and screenshots it
    async function look(h, sel, shotName) {
        const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(sel)})`, SHORT_MS);
        const faded = up && (await polishWaitFor(h, FADED_IN(sel), SHORT_MS));
        const verdict = frostVerdict(await h.ev(frostProbe(sel)));
        await shot(h, shotName);
        return { up, faded, ...verdict };
    }
    const gone = (h, sel) => polishWaitFor(h, `!document.querySelector(${JSON.stringify(sel)})`, SHORT_MS);

    const scenario = {
        name: "overlays-frost-jarvis",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-of-jarvis-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-of-jarvis-project-")),
                prev: {},
            };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                at = "making the project";
                const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                for (const f of FILES) {
                    mkdirSync(dirname(join(ctx.cwd, f)), { recursive: true });
                    writeFileSync(join(ctx.cwd, f), `// ${f}\nexport const retries = 0;\n`);
                }
                git("add", ".");
                git("commit", "-qm", "seed");
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                at = "making the initiative";
                // the Brief reads a boot-primed snapshot, so the initiative is made before the reload below
                for (const e of ((await h.rpc("effortlist", {}))?.efforts ?? []).filter((x) => x.title === INITIATIVE)) {
                    await h.rpc("effortdelete", { effortoid: e.oref.replace(/^effort:/, "") }).catch(() => {});
                }
                const made = await h.rpc("effortcreate", { title: INITIATIVE, chunks: CHUNKS.map(([label]) => ({ label })) });
                ctx.effort = made.effortoid;
                await h.rpc("effortmutate", {
                    effortoid: ctx.effort,
                    author: "you",
                    ops: [
                        ...CHUNKS.map(([chunk, stage]) => ({ op: "setChunkStage", chunk, stage })),
                        ...CHUNKS.filter(([, , status]) => status !== "pending").map(([chunk, , status]) => ({ op: "setChunkStatus", chunk, status })),
                    ],
                });

                at = "writing the transcript";
                const base = Date.now() - 600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 4; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the sync client work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. The sync client retries a failed request and logs what it sent.`, o(i * 10 + 2)));
                }
                lines.push(AC.userText("make the sync client retry a failed request", o(100)));
                ctx.transcript = AC.writeTranscript(ctx.dir, "overlays-frost-jarvis", lines);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here, empty: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the tab";
                // cmd:cwd is the agent's folder. No controller, so nothing runs.
                ctx.tab = await makeTab(h, ctx, { label: NAME, blockMeta: { view: "term", "cmd:cwd": ctx.cwd.replace(/\\/g, "/") } });
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
                rec("0. the fixture agent, its project, its initiative and its transcript", false, ctx.arrangeError);
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
            const chatMode = (mode) => AC.agentPage(h, `const M = await mod("app/view/agents/chatmodestore.ts"); M.setChatMode(${JSON.stringify(A)}, ${JSON.stringify(mode)}); return true;`);
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, A);
            await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-chat-box]")`, WAIT_MS);

            // 1. the Jobs popover, over the working agent
            await run("1. Jobs popover", async (name) => {
                await h.ev(`window.__jobQueueInject({
                    slots: 1,
                    mode: "auto",
                    jobs: [
                        { id: "ofj1", name: "task check:ts", bytes: 3221225472, running: true, queuedts: Date.now(), startedts: Date.now() },
                        { id: "ofj2", name: "go test ./...", bytes: 2147483648, position: 1, reason: "slot busy", queuedts: Date.now() },
                    ],
                })`);
                const chip = await polishWaitFor(h, `!!document.querySelector("[data-job-queue-chip]")`, SHORT_MS);
                const clicked = await click(h, "[data-job-queue-chip]");
                const v = await look(h, PANEL.jobs, "1-jobs");
                const rows = await h.ev(`document.querySelectorAll("[data-job-queue-panel] [data-job-row]").length`);
                // a click away closes it: on the Agent surface the surface's own Escape ("back") takes the key before the panel's
                // listener, so Escape is left to the jobqueue-chip scenario, which runs on the Cockpit
                const away = await click(h, "[data-job-queue-backdrop]");
                const closed = await gone(h, "[data-job-queue-panel]");
                await h.ev(`window.__jobQueueInject({ slots: 1, jobs: [] })`);
                rec(`${name}: the Jobs chip opens the popover over the working agent, which draws the frost class with no backdrop root above it, and a click away closes it`, chip && clicked && rows === 2 && v.up && v.faded && v.ok && away && closed, { rows, away, closed, ...v });
            });

            // 2. Jarvis' pet: the bubble, the peek and the peek's two menus
            const creature = await polishWaitFor(h, `!!document.querySelector('[aria-label="Jarvis condition"]')`, SHORT_MS);
            const noCreature = "no Jarvis creature on the Agent surface";
            await run("2a. pet bubble", async (name) => {
                if (!creature) return rec(`${name}: a notify opens the bubble beside the pet`, false, noCreature);
                await h.rpc("notify", { title: "overlays frost: a bubble", level: "info" });
                const shown = await polishWaitFor(h, `document.querySelector("[data-pet-bubble]")?.textContent?.includes("overlays frost: a bubble") ?? false`, SHORT_MS);
                // the pointer off the corner: a hovered bubble stays, an unhovered one has its own 6 s
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
                const v = await look(h, PANEL.bubble, "2a-pet-bubble");
                await click(h, "[data-pet-bubble-close]");
                const closed = await gone(h, "[data-pet-bubble]");
                rec(`${name}: a notify opens the bubble beside the pet, which draws the frost class with no backdrop root above it`, shown && v.up && v.faded && v.ok && closed, { shown, closed, ...v });
            });
            await run("2b. pet peek", async (name) => {
                if (!creature) return rec(`${name}: a click on the pet opens its peek`, false, noCreature);
                await click(h, '[aria-label="Jarvis condition"]');
                const v = await look(h, PANEL.peek, "2b-pet-peek");
                rec(`${name}: a click on the pet opens its peek, which draws the frost class with no backdrop root above it`, v.up && v.faded && v.ok, v);
            });
            await run("2c. pet stay menu", async (name) => {
                if (!creature) return rec(`${name}: the peek's pin opens the stay menu`, false, noCreature);
                const pinned = await polishWaitFor(h, `!!document.querySelector("[data-pet-peek] [data-pet-stay-pin]")`, SHORT_MS);
                await click(h, "[data-pet-peek] [data-pet-stay-pin]");
                const v = await look(h, PANEL.stay, "2c-pet-stay-menu");
                await key(h, KEYS.escape);
                const closed = await gone(h, "[data-pet-stay-menu]");
                const peekStays = await h.ev(`!!document.querySelector("[data-pet-peek]")`);
                rec(`${name}: the peek's pin opens the stay menu, which draws the frost class with no backdrop root above it (the frosted peek is no ancestor of it), and Escape closes only the menu`, pinned && v.up && v.faded && v.ok && closed && peekStays, { pinned, closed, peekStays, ...v });
            });
            await run("2d. pet hide menu", async (name) => {
                if (!creature) return rec(`${name}: the peek's Hide button opens the hide menu`, false, noCreature);
                const there = await polishWaitFor(h, `!!document.querySelector("[data-pet-peek] [data-pet-hide-button]")`, SHORT_MS);
                await click(h, "[data-pet-peek] [data-pet-hide-button]");
                const v = await look(h, PANEL.hide, "2d-pet-hide-menu");
                await key(h, KEYS.escape);
                const closed = await gone(h, "[data-pet-hide-menu]");
                // the peek has served its steps: Escape closes it
                await key(h, KEYS.escape);
                const peekGone = await gone(h, "[data-pet-peek]");
                rec(`${name}: the peek's Hide button opens the hide menu, which draws the frost class with no backdrop root above it, and Escape closes it`, there && v.up && v.faded && v.ok && closed && peekGone, { there, closed, peekGone, ...v });
            });

            // 3. the terminal's find bar, opened as a server's Log opens it
            await run("3. terminal find bar", async (name) => {
                await chatMode("terminal");
                const pane = await polishWaitFor(h, `(() => { const p = document.querySelector('[data-agent-terminal="${A}"]'); return !!p && p.getClientRects().length > 0; })()`, WAIT_MS);
                await AC.agentPage(h, `const T = await mod("app/view/term/termsearch.ts"); T.requestTermSearch(${JSON.stringify(ctx.tab.blockId)}); return true;`);
                const up = await polishWaitFor(h, `!!document.querySelector(".search-container")`, WAIT_MS);
                // the bar places itself against its pane a frame after it opens
                await polishNap(400);
                const v = await look(h, PANEL.search, "3-terminal-find-bar");
                await key(h, KEYS.escape);
                let closed = await gone(h, ".search-container");
                if (!closed) {
                    await click(h, '.search-container button[aria-label="Close (Esc)"]');
                    closed = await gone(h, ".search-container");
                }
                await chatMode("chat");
                rec(`${name}: the terminal's find bar draws the frost class with no backdrop root above it, over the terminal, and Escape closes it`, pane && up && v.ok && closed, { pane, up, closed, ...v });
            });

            // 4. Chat's initiative picker, from the header's link chip
            await run("4. initiative picker", async (name) => {
                await AC.focusAgent(h, A);
                await polishWaitFor(h, `!!document.querySelector("[data-agent-header] [data-initiative-link]")`, WAIT_MS);
                const clicked = await click(h, "[data-agent-header] [data-initiative-link]");
                const v = await look(h, PANEL.picker, "4-initiative-picker");
                await key(h, KEYS.escape);
                const closed = await gone(h, "[data-initiative-picker]");
                rec(`${name}: the Chat header's link chip opens the initiative picker, which draws the frost class with no backdrop root above it once its fade ends, and Escape closes it`, clicked && v.up && v.faded && v.ok && closed, { clicked, closed, ...v });
            });

            // 5-6. the Jarvis surface: the autonomy ladder, then the sheet's tracker menu and the chunk view's status menu
            await h.goto("jarvis");
            await run("5. autonomy ladder", async (name) => {
                const chip = await polishWaitFor(h, `!!document.querySelector('[data-jarvis-autonomy="chip"]')`, WAIT_MS);
                await click(h, '[data-jarvis-autonomy="chip"]');
                const v = await look(h, PANEL.autonomy, "5-autonomy-ladder");
                await key(h, KEYS.escape);
                let closed = await gone(h, '[data-jarvis-autonomy="panel"]');
                if (!closed) {
                    await click(h, '[data-jarvis-autonomy="chip"]');
                    closed = await gone(h, '[data-jarvis-autonomy="panel"]');
                }
                rec(`${name}: the Brief's autonomy chip opens the ladder, which draws the frost class with no backdrop root above it`, chip && v.up && v.faded && v.ok && closed, { chip, closed, ...v });
            });

            const opened = await h
                .ev(`window.__openAddress(${JSON.stringify("effort:" + ctx.effort)}).then(() => true)`)
                .catch(() => false);
            const sheetUp = opened && (await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(`${SHEET} [data-jarvis-tracker-chunk="Wire"]`)})`, WAIT_MS));
            await polishNap(400);
            await run("6a. sheet status menu", async (name) => {
                if (!sheetUp) return rec(`${name}: a chunk's status pill opens the sheet's status menu`, false, "the initiative's sheet did not open");
                const pill = `${SHEET} [data-jarvis-tracker-chunk="Wire"] [data-jarvis-chunk-status]`;
                const clicked = await click(h, pill);
                const v = await look(h, PANEL.trackerMenu, "6a-sheet-status-menu");
                await key(h, KEYS.escape);
                const closed = await gone(h, "[data-jarvis-tracker-menu]");
                const sheetStays = await h.ev(`!!document.querySelector(${JSON.stringify(SHEET)})`);
                rec(`${name}: a chunk's status pill opens the sheet's menu, which draws the frost class with no backdrop root above it once its fade ends, and Escape closes only the menu`, clicked && v.up && v.faded && v.ok && closed && sheetStays, { clicked, closed, sheetStays, ...v });
            });
            await run("6b. chunk status menu", async (name) => {
                if (!sheetUp) return rec(`${name}: the chunk view's status pill opens its status menu`, false, "the initiative's sheet did not open");
                await mouse(h, `document.querySelector(${JSON.stringify(`${SHEET} [data-jarvis-tracker-chunk="Wire"]`)})`);
                const view = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(`${SHEET} [data-jarvis-chunk-view]`)})`, SHORT_MS);
                await polishNap(300);
                const clicked = await click(h, `${SHEET} [data-jarvis-chunk-status]`);
                const v = await look(h, PANEL.chunkMenu, "6b-chunk-status-menu");
                const options = await h.ev(`document.querySelectorAll("[data-jarvis-chunk-status-option]").length`);
                rec(`${name}: a click on a chunk opens its view, and its status pill opens a menu of the six statuses that draws the frost class with no backdrop root above it`, view && clicked && options === 6 && v.up && v.ok, { view, clicked, options, ...v });
                // out of the menu, the chunk view and the sheet
                await key(h, KEYS.escape);
                await key(h, KEYS.escape);
                await polishNap(250);
                await click(h, `${SHEET} [data-jarvis-initiative-sheet-head] button[aria-label="Close (Esc)"]`);
                await gone(h, SHEET);
            });

            // 7. the Code surface: the project picker, the review list, Send review's agent list, the unsaved-edits menu
            await h.goto("code");
            await run("7a. Code project picker", async (name) => {
                const chip = await polishWaitFor(h, `!!document.querySelector("[data-code-project-picker]")`, WAIT_MS);
                await click(h, "[data-code-project-picker]");
                const v = await look(h, PANEL.codeProject, "7a-code-project-picker");
                // the fixture project is picked, so the review and unsaved-edits controls below have a project to belong to
                const picked = await h.ev(`(() => {
                    const chip = document.querySelector("[data-code-project-picker]");
                    const scope = chip && chip.parentElement;
                    const row = scope && [...scope.querySelectorAll("button")].find((b) => b !== chip && (b.textContent || "").includes(${JSON.stringify(PROJECT)}));
                    row?.click();
                    return !!row;
                })()`);
                const closed = await gone(h, "[data-code-picker-path]");
                const named = await polishWaitFor(h, `(document.querySelector("[data-code-project-picker]")?.textContent ?? "").includes(${JSON.stringify(PROJECT)})`, WAIT_MS);
                rec(`${name}: the Code header's project picker draws the frost class with no backdrop root above it, and picking the fixture project closes it`, chip && v.up && v.faded && v.ok && picked && closed && named, { chip, picked, closed, named, ...v });
            });
            // a review of two comments and one unsaved edit, put into the stores the controls read
            const seeded = await AC.agentPage(
                h,
                `const S = await mod("app/view/code/codestore.ts");
                const R = await mod("app/view/code/codereviewstore.ts");
                const project = globalStore.get(S.codeProjectAtom);
                if (!project) return false;
                window.__ofJarvisPrev = {
                    drafts: globalStore.get(S.codeDraftsAtom),
                    reviews: globalStore.get(R.codeReviewsAtom),
                };
                const reviews = new Map(window.__ofJarvisPrev.reviews);
                reviews.set(project.path, [
                    { id: "of1", path: "src/sync/client.ts", startLine: 1, endLine: 1, anchor: "// src/sync/client.ts", note: "retry on a 503 as well" },
                    { id: "of2", path: "src/sync/retry.ts", startLine: 2, endLine: 2, anchor: "export const retries = 0;", note: "make the count a setting" },
                ]);
                globalStore.set(R.codeReviewsAtom, reviews);
                const drafts = new Map(window.__ofJarvisPrev.drafts);
                drafts.set(S.draftKey(project, "README.md"), { text: "// README.md\\nchanged\\n", base: { text: "// README.md\\n", size: 14, modtime: 1 } });
                globalStore.set(S.codeDraftsAtom, drafts);
                return true;`
            ).catch(() => false);
            await run("7b. Code review list", async (name) => {
                const there = seeded && (await polishWaitFor(h, `!!document.querySelector("[data-code-review-count]")`, SHORT_MS));
                await click(h, "[data-code-review-count]");
                const v = await look(h, PANEL.codeList, "7b-code-review-list");
                const rows = await h.ev(`document.querySelectorAll("[data-code-review-row]").length`);
                // the count button toggles it (the Code surface's own Escape goes home when focus is not in the bar)
                await click(h, "[data-code-review-count]");
                const closed = await gone(h, "[data-code-review-list]");
                rec(`${name}: the review count opens the list of comments, which draws the frost class with no backdrop root above it, and the button closes it`, there && rows === 2 && v.up && v.faded && v.ok && closed, { seeded, there, rows, closed, ...v });
            });
            await run("7c. Code send review", async (name) => {
                const there = await polishWaitFor(h, `!!document.querySelector("[data-code-review-send]")`, SHORT_MS);
                await click(h, "[data-code-review-send]");
                const v = await look(h, PANEL.codeSend, "7c-code-send-review");
                await click(h, "[data-code-review-send]");
                const closed = await polishWaitFor(h, `!document.querySelector("[data-code-agent-picker-row], [data-code-agent-picker-empty]")`, SHORT_MS);
                rec(`${name}: Send review opens its list of agents, which draws the frost class with no backdrop root above it, and the button closes it`, there && v.up && v.faded && v.ok && closed, { there, closed, ...v });
            });
            await run("7d. Code unsaved edits", async (name) => {
                const there = await polishWaitFor(h, `!!document.querySelector("[data-code-unsaved-count]")`, SHORT_MS);
                await click(h, "[data-code-unsaved-count]");
                const v = await look(h, PANEL.codeUnsaved, "7d-code-unsaved-edits");
                await click(h, "[data-code-unsaved-count]");
                const closed = await gone(h, "[data-code-unsaved-row]");
                rec(`${name}: the unsaved-edits chip opens its menu, which draws the frost class with no backdrop root above it, and the chip closes it`, there && v.up && v.faded && v.ok && closed, { there, closed, ...v });
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`overlays-frost-jarvis teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the popovers", async () => {
                await h.ev(`window.__jobQueueInject?.({ slots: 1, jobs: [] })`);
                for (let i = 0; i < 2; i++) await key(h, KEYS.escape);
            });
            await step("put the Code stores back", () =>
                AC.agentPage(
                    h,
                    `const P = window.__ofJarvisPrev;
                    if (!P) return "absent";
                    const S = await mod("app/view/code/codestore.ts");
                    const R = await mod("app/view/code/codereviewstore.ts");
                    globalStore.set(R.codeReviewsAtom, P.reviews);
                    globalStore.set(S.codeDraftsAtom, P.drafts);
                    globalStore.set(S.codeProjectAtom, null);
                    delete window.__ofJarvisPrev;
                    return "restored";`
                )
            );
            await step("remove the probes", () => h.ev(`(() => { delete window.__chatSuggestFake; return true; })()`));
            if (ctx.tab != null) {
                await step("clear the exit", () =>
                    h.rpc("eventpublish", {
                        event: "controllerstatus",
                        scopes: [`block:${ctx.tab.blockId}`],
                        data: { blockid: ctx.tab.blockId, shellprocstatus: "running", shellprocexitcode: 0 },
                    })
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            if (ctx.effort != null) {
                await step("remove the initiative", () => h.rpc("effortdelete", { effortoid: ctx.effort }));
            }
            if (ctx.project != null) {
                // deleteproject leaves the channel createproject made, so that goes too
                await step("remove the project", async () => {
                    await h.rpc("deleteproject", { name: ctx.project });
                    const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.cwd))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                });
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
            for (const dir of [ctx.dir, ctx.cwd]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
