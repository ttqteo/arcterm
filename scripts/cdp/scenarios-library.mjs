// library-tabs: the Library surface (docs/superpowers/specs/2026-11-19-library-surface-design.md). What is over lives here,
// off the Agent tree: Conversation History, the Canvas gallery and every council, as tabs of one surface (the fourth, Boards,
// is walked by boards-library; here only its tab key and button are). The steps
// walk the rail and the chord into it, the list cursor and the tab keys, the gallery and its viewer, a session opened from
// outside Library (full width, Back to where it came from, Escape the same), and the councils: a closed one opens inside
// Library on Library's own selection (Agent's stays put), a live one opened by address lands on Agent.
//
// Fixtures: three ended sessions answered in-page (the getsessionsactivity mock agent-history uses, with a transcript each
// on disk), a temp project holding two canvases (lt-alpha has two boards), and the council fixtures (council/fixtures.mjs):
// a done council three days old and already opened (so the Agent tree no longer lists it), a recent one the tree keeps, and
// two that end while Library shows one of them. Nothing is written into ~/.claude/projects; teardown puts everything back.
// kit is scenarios.mjs's LIBRARY_KIT.
//
// Also exported: openLibraryTab, which the scenarios that used to click the History, Canvas gallery or Councils row of the
// Agent tree call instead (the tab is module-level state, so it opens a tab explicitly rather than trusting the last one).

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "./attach.mjs";
import { agentPage } from "./agent-page-fixtures.mjs";
import {
    announceCouncil,
    arrangeCouncilProject,
    COUNCIL_ID_PREFIX,
    seedCouncil,
    teardownCouncilProject,
    writeCouncil,
} from "./council/fixtures.mjs";

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const LIBRARY_TAB_NAMES = ["conversations", "canvases", "councils", "boards"];

/** Opens Library on `tab` (Conversations by default) from wherever the page is, by the rail and then the tab's own button,
 *  and waits for the tab's body. True when the tab is the one selected. */
export async function openLibraryTab(h, tab = "conversations") {
    if (!LIBRARY_TAB_NAMES.includes(tab)) {
        throw new Error(`no Library tab "${tab}"`);
    }
    await h.goto("library");
    await h.ev(`document.querySelector('[data-library-tab="${tab}"]')?.click()`);
    return waitFor(
        (e) => h.ev(e),
        `document.querySelector('[data-library-tab="${tab}"]')?.getAttribute("aria-selected") === "true" && document.querySelector("[data-library]")?.getAttribute("data-library-active") === "${tab}"`,
        5000
    );
}

const KEYS = {
    1: { key: "1", code: "Digit1", windowsVirtualKeyCode: 49 },
    2: { key: "2", code: "Digit2", windowsVirtualKeyCode: 50 },
    3: { key: "3", code: "Digit3", windowsVirtualKeyCode: 51 },
    4: { key: "4", code: "Digit4", windowsVirtualKeyCode: 52 },
    7: { key: "7", code: "Digit7", windowsVirtualKeyCode: 55 },
    j: { key: "j", code: "KeyJ", windowsVirtualKeyCode: 74 },
    k: { key: "k", code: "KeyK", windowsVirtualKeyCode: 75 },
    c: { key: "c", code: "KeyC", windowsVirtualKeyCode: 67 },
    m: { key: "m", code: "KeyM", windowsVirtualKeyCode: 77 },
    r: { key: "r", code: "KeyR", windowsVirtualKeyCode: 82 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    "[": { key: "[", code: "BracketLeft", windowsVirtualKeyCode: 219 },
    "]": { key: "]", code: "BracketRight", windowsVirtualKeyCode: 221 },
    Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
};

const DAY = 86_400_000;
const PROJECT = "verify-library-tabs";
const SESSION_PROJECT = "lt-proj";
const ANSWER = "library seed answer";
const CLOSED = `${COUNCIL_ID_PREFIX}lt-closed`;
const TREE = `${COUNCIL_ID_PREFIX}lt-tree`;
const SEEN = `${COUNCIL_ID_PREFIX}lt-seen`;
const UNSEEN = `${COUNCIL_ID_PREFIX}lt-unseen`;

const turn = (type, content) => JSON.stringify({ type, message: { role: type, content } }) + "\n";

// the three ended sessions the page's scan answers with, newest first; lt-1's transcript holds an answer
function sessionsOf(cwd, now) {
    const base = {
        runtime: "claude",
        projectpath: "C:/lt/proj",
        projectname: SESSION_PROJECT,
        branch: "main",
        model: "opus",
        tokenstotal: 1200,
        status: "done",
        startedts: now - 3_600_000,
        durationms: 60_000,
        events: [],
    };
    return [1, 2, 3].map((n) => ({
        ...base,
        id: `lt-${n}`,
        task: `library seed ${n}`,
        lastactivets: now - n * 600_000,
        resumecommand: `claude --resume lt-${n}`,
        transcriptpath: join(cwd, `lt-${n}.jsonl`),
    }));
}

// one canvas topic as the arc:design skill leaves it: a canvas.json and a file per board, every mtime `at`
function writeTopic(cwd, topic, boards, at) {
    const dir = join(cwd, ".superpowers", "design", topic);
    const project = join(dir, "project");
    mkdirSync(project, { recursive: true });
    const files = boards.map((b) => `${b}.dc.html`);
    writeFileSync(
        join(project, "canvas.json"),
        JSON.stringify({
            boards: Object.fromEntries(files.map((f, i) => [f, { x: i * 720, y: 0, w: 640, h: 480, title: boards[i] }])),
            order: files,
        })
    );
    for (const b of boards) {
        writeFileSync(
            join(project, `${b}.dc.html`),
            `<!doctype html><title>${b}</title><body style="margin:0;padding:32px;background:#fff;color:#111;font:20px system-ui"><h1>${b}</h1><p>${topic} board</p>`
        );
    }
    for (const path of [...readdirSync(project).map((f) => join(project, f)), project, dir]) {
        utimesSync(path, new Date(at), new Date(at));
    }
}

const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export default function (kit) {
    const { ahResolveModules, installAhMock, removeAhMock, waitForProjectInConfig, MOD_BIT, UI_ROUTE } = kit;

    // the app's own modules and model, with Library's store, Agent's centre and the council store in reach
    const page = (h, body) =>
        agentPage(
            h,
            `const L = await mod("app/view/library/librarystore.ts");
            const C = await mod("app/view/agents/agentcenter.ts");
            const S = await mod("app/view/agents/councilstore.ts");
            const model = agentsModel();
            ${body}`
        );
    const until = (h, expr, ms = 8000) => waitFor((e) => h.ev(e), expr, ms);
    const press = async (h, name, { mods = 0, blur = true } = {}) => {
        if (blur) await h.ev("document.activeElement?.blur?.()");
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, ...KEYS[name], ...(mods ? { modifiers: mods } : {}) });
        }
        await nap(300);
    };
    const shot = (h, name) => h.shot(`cdp-shots/library-tabs-${name}.png`);
    const surface = (h) => h.activeSurfaceLabel();
    const active = (h) => h.ev(`document.querySelector("[data-library]")?.getAttribute("data-library-active") ?? null`);
    // the card the Conversations list has selected (the cursor is the selection), by its text
    const selectedCard = (h) =>
        h.ev(
            `(document.querySelector("[data-history-list] .bg-surface-selected")?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 60)`
        );
    const cursorTopics = (h) =>
        h.ev(`[...document.querySelectorAll("[data-canvas-card][data-cursor]")].map((c) => c.getAttribute("data-canvas-card"))`);
    const viewerTabs = (h) =>
        h.ev(
            `[...document.querySelectorAll("[data-canvas-viewer-tab]")].map((t) => t.getAttribute("data-canvas-viewer-tab") + ":" + t.getAttribute("aria-selected"))`
        );
    const libraryState = (h) =>
        page(
            h,
            `return {
                tab: globalStore.get(L.libraryTabAtom),
                conv: globalStore.get(L.libraryConvViewAtom),
                council: globalStore.get(L.libraryCouncilSelAtom),
                councilView: globalStore.get(L.libraryCouncilViewAtom),
            };`
        );
    const agentState = (h) =>
        page(
            h,
            `return {
                sel: globalStore.get(S.councilSelAtom),
                view: globalStore.get(S.councilViewAtom),
                mode: globalStore.get(C.centerModeAtom),
            };`
        );

    const libraryTabs = {
        name: "library-tabs",
        surface: "cockpit",
        async arrange(h) {
            const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-library-tabs-")) };
            try {
                const now = Date.now();
                for (const n of [1, 2, 3]) {
                    writeFileSync(
                        join(ctx.cwd, `lt-${n}.jsonl`),
                        turn("user", `library seed ${n}`) + turn("assistant", [{ type: "text", text: `${ANSWER} ${n}` }])
                    );
                }
                ctx.sessions = sessionsOf(ctx.cwd, now);
                // the canvases: a registered project holding lt-beta (newest, one board) and lt-alpha (Main and States)
                ctx.canvasDir = join(ctx.cwd, "canvas-project");
                mkdirSync(ctx.canvasDir);
                writeTopic(ctx.canvasDir, "lt-beta", ["Main"], now);
                writeTopic(ctx.canvasDir, "lt-alpha", ["Main", "States"], now - 5 * 60_000);
                // the councils: a project and a reload, so the page boots knowing it (the page keeps no council across it)
                ctx.council = await arrangeCouncilProject(h, kit);
                await h.rpc("createproject", { name: PROJECT, path: ctx.canvasDir });
                ctx.registered = true;
                await waitForProjectInConfig(h, PROJECT);
                // a done council from three days back that the person has already opened: out of the Agent tree, in Library's list
                const opened = `window.__arcCouncil.setOpened({ ...window.__arcCouncil.opened(), opened: { ...window.__arcCouncil.opened().opened, ${JSON.stringify(CLOSED)}: ${now} } })`;
                await h.ev(`(() => { ${opened} })()`);
                ctx.closed = await seedCouncil(h, ctx.council, "done", { id: CLOSED, now: now - 3 * DAY });
                ctx.tree = await seedCouncil(h, ctx.council, "done", { id: TREE });
                // the sessions mock goes in last: it lives in the document, and the reloads above end the earlier one
                ctx.modules = await ahResolveModules(h);
                ctx.mock = ctx.modules.urls
                    ? await installAhMock(h, ctx.sessions, ctx.modules.urls.api, "lt-1")
                    : `no-module-url (${ctx.modules.error})`;
                // Library starts where a fresh page does: Conversations, its list, no council open, the merged feed selected
                await page(
                    h,
                    `globalStore.set(L.libraryTabAtom, "conversations");
                    globalStore.set(L.libraryConvViewAtom, "list");
                    globalStore.set(L.libraryCouncilSelAtom, null);
                    globalStore.set(model.sessionsSelAtom, "all");
                    return true;`
                );
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
            try {
                rec(
                    "0. the sessions mock, the two canvases and the council fixtures are in place",
                    ctx.arrangeError == null && ctx.mock === "ok",
                    ctx.arrangeError ?? `mock=${ctx.mock}`
                );
                if (ctx.arrangeError != null || ctx.mock !== "ok") return steps;

                // 1. the rail's Library opens Conversations: Conversation History's list with the seeded sessions in it
                await h.goto("library");
                const listed = await until(
                    h,
                    `[...document.querySelectorAll("[data-history-list] button")].some((b) => b.textContent.includes("library seed 3"))`,
                    10_000
                );
                const first = await h.ev(`(() => ({
                    active: document.querySelector("[data-library]")?.getAttribute("data-library-active") ?? null,
                    selected: document.querySelector('[data-library-tab="conversations"]')?.getAttribute("aria-selected") ?? null,
                    tabs: [...document.querySelectorAll("[data-library-tab]")].map((t) => t.getAttribute("data-library-tab")),
                    history: document.querySelector("[data-agent-history]") != null,
                    cards: [...document.querySelectorAll("[data-history-list] button")].filter((b) => /library seed \\d/.test(b.textContent)).length,
                }))()`);
                await shot(h, "1-rail");
                rec(
                    "1. the rail's Library opens on Conversations: the tab strip reads Conversations, Canvases, Councils, Boards, and Conversation History lists the three seeded sessions",
                    (await surface(h)) === "Library" &&
                        listed &&
                        first.active === "conversations" &&
                        first.selected === "true" &&
                        JSON.stringify(first.tabs) === JSON.stringify(["conversations", "canvases", "councils", "boards"]) &&
                        first.history &&
                        first.cards === 3,
                    JSON.stringify(first)
                );

                // 2. j and k move the list's cursor, which is its selection: the merged feed, then each session in turn
                const c0 = await selectedCard(h);
                await press(h, "j");
                const c1 = await selectedCard(h);
                await press(h, "j");
                const c2 = await selectedCard(h);
                await press(h, "k");
                const c3 = await selectedCard(h);
                await shot(h, "2-jk");
                rec(
                    "2. j and k move the Conversations list cursor: All activity, then library seed 1, library seed 2, and k back to library seed 1",
                    /^All activity/.test(c0) && /library seed 1/.test(c1) && /library seed 2/.test(c2) && /library seed 1/.test(c3),
                    JSON.stringify({ c0, c1, c2, c3 })
                );

                // 3. Ctrl+7 opens Library from another surface (it sits fifth on the rail, seventh on the chords)
                await h.goto("cockpit");
                await press(h, "7", { mods: MOD_BIT });
                const viaChord = await until(h, `!!document.querySelector("[data-library]")`, 5000);
                await shot(h, "3-chord");
                rec(
                    "3. Ctrl+7 opens Library from the Cockpit",
                    viaChord && (await surface(h)) === "Library",
                    JSON.stringify({ viaChord, surface: await surface(h), tab: await active(h) })
                );

                // 4. the keys 1 2 3 4 switch the tabs
                const seen = [];
                for (const [key, want] of [
                    ["2", "canvases"],
                    ["4", "boards"],
                    ["3", "councils"],
                    ["1", "conversations"],
                ]) {
                    await press(h, key);
                    seen.push(`${key}:${await active(h)}:${want}`);
                }
                await shot(h, "4-tab-keys");
                rec(
                    "4. the keys 1, 2, 3 and 4 show Conversations, Canvases, Councils and Boards in turn (2, 4, 3, 1 walked here), and the strip marks the one shown",
                    seen.every((s) => s.split(":")[1] === s.split(":")[2]) &&
                        (await h.ev(`document.querySelector('[data-library-tab="conversations"]')?.getAttribute("aria-selected")`)) === "true",
                    JSON.stringify(seen)
                );

                // 5. the Canvases tab shows the gallery, with both seeded canvases in it
                await press(h, "2");
                const gallery = await until(
                    h,
                    `document.querySelector("[data-canvas-gallery]") != null && document.querySelector('[data-canvas-card="lt-alpha"]') != null && document.querySelector('[data-canvas-card="lt-beta"]') != null`,
                    10_000
                );
                await shot(h, "5-gallery");
                rec(
                    "5. the Canvases tab shows the Canvas gallery with lt-alpha and lt-beta",
                    gallery && (await active(h)) === "canvases" && (await surface(h)) === "Library",
                    JSON.stringify({ gallery, tab: await active(h) })
                );

                // 6. the arrow keys move the gallery's card cursor (a key that is also the list cursor's on Conversations)
                const at0 = await cursorTopics(h);
                await press(h, "ArrowRight");
                const at1 = await cursorTopics(h);
                await press(h, "ArrowLeft");
                const at2 = await cursorTopics(h);
                await shot(h, "6-cursor");
                rec(
                    "6. → moves the gallery's card cursor to another card and ← brings it back",
                    at0.length === 1 && at1.length === 1 && at1[0] !== at0[0] && JSON.stringify(at2) === JSON.stringify(at0),
                    JSON.stringify({ at0, at1, at2 })
                );

                // 7. [ and ] page the boards of an open canvas, and Escape returns to the grid, all inside Library
                await h.ev(`document.querySelector('[data-canvas-card="lt-alpha"]')?.click()`);
                const viewer = await until(h, `document.querySelector("[data-canvas-viewer]") != null`, 10_000);
                const tabs0 = await viewerTabs(h);
                await press(h, "]");
                const tabs1 = await viewerTabs(h);
                await shot(h, "7-viewer");
                await press(h, "[");
                const tabs2 = await viewerTabs(h);
                const stayed = (await surface(h)) === "Library" && (await h.ev(`document.querySelector("[data-library]") != null`));
                await press(h, "Escape");
                const grid = await until(h, `document.querySelector("[data-canvas-viewer]") == null && document.querySelector("[data-canvas-grid]") != null`, 5000);
                rec(
                    "7. with lt-alpha open, ] moves to its States board and [ back to Main without leaving Library, and Escape returns to the gallery",
                    viewer &&
                        JSON.stringify(tabs0) === JSON.stringify(["Main:true", "States:false"]) &&
                        JSON.stringify(tabs1) === JSON.stringify(["Main:false", "States:true"]) &&
                        JSON.stringify(tabs2) === JSON.stringify(["Main:true", "States:false"]) &&
                        stayed &&
                        grid &&
                        (await surface(h)) === "Library",
                    JSON.stringify({ viewer, tabs0, tabs1, tabs2, stayed, grid })
                );

                // 8. the Councils tab shows the list, with the closed council in it
                await press(h, "3");
                const row = `[data-council-history-row="${CLOSED}"]`;
                const councils = await until(h, `document.querySelector(${JSON.stringify(row)}) != null`, 10_000);
                await shot(h, "8-councils");
                rec(
                    "8. the Councils tab lists every council, the done one three days old among them",
                    councils && (await active(h)) === "councils",
                    JSON.stringify({ councils, tab: await active(h) })
                );

                // 9. a session opened from Usage reads full width (no list beside it), and Back returns to Usage
                await h.goto("usage");
                await page(h, `L.showLibrarySession(model, "claude:lt-1"); return true;`);
                const pane = await until(h, `document.querySelector("[data-library] [data-agent-session]") != null`, 8000);
                await until(h, `document.querySelector("[data-agent-session]")?.textContent?.includes(${JSON.stringify(ANSWER)})`, 8000);
                const width = await h.ev(`(() => {
                    const lib = document.querySelector("[data-library]")?.getBoundingClientRect().width ?? 0;
                    const pane = document.querySelector("[data-agent-session]")?.getBoundingClientRect().width ?? 0;
                    return { lib: Math.round(lib), pane: Math.round(pane), list: document.querySelector("[data-agent-history]") != null };
                })()`);
                await shot(h, "9-from-usage");
                const onLibrary = (await surface(h)) === "Library";
                await h.ev(`document.querySelector("[data-agent-session-back]")?.click()`);
                await until(h, `!document.querySelector("[data-library]")`, 5000);
                const backOn = await surface(h);
                rec(
                    "9. a session opened from Usage reads at Library's full width with no list beside it, and its Back returns to Usage",
                    pane && onLibrary && width.pane > 0 && width.pane >= width.lib * 0.95 && !width.list && backOn === "Usage",
                    JSON.stringify({ pane, onLibrary, ...width, backOn })
                );

                // 10. Escape from a session opened in Library goes back to where it came from
                await h.goto("cockpit");
                await page(h, `L.showLibrarySession(model, "claude:lt-2"); return true;`);
                const open10 = await until(h, `document.querySelector("[data-library] [data-agent-session]") != null`, 8000);
                await shot(h, "10-session");
                await press(h, "Escape");
                const gone10 = await until(h, `!document.querySelector("[data-library]")`, 5000);
                const state10 = await libraryState(h);
                rec(
                    "10. Escape from a session opened in Library returns to the Cockpit it came from, and Library's Conversations is back on its list",
                    open10 && gone10 && (await surface(h)) === "Cockpit" && state10.conv === "list",
                    JSON.stringify({ open10, gone10, surface: await surface(h), ...state10 })
                );

                // 11. a closed council opens inside Library, under Back to the list, and Agent's own selection never moves
                await page(
                    h,
                    `globalStore.set(S.councilSelAtom, null);
                    globalStore.set(L.libraryCouncilSelAtom, null);
                    return true;`
                );
                const agentBefore = await agentState(h);
                await openLibraryTab(h, "councils");
                await until(h, `document.querySelector(${JSON.stringify(row)}) != null`, 10_000);
                await h.ev(`document.querySelector(${JSON.stringify(row)})?.click()`);
                const inside = await until(
                    h,
                    `document.querySelector("[data-library] [data-library-council-back]") != null && (document.querySelector("[data-library] [data-council-summary]") != null || document.querySelector("[data-library] [data-council-discussion]") != null)`,
                    10_000
                );
                const afterOpen = { lib: await libraryState(h), agent: await agentState(h), surface: await surface(h) };
                await shot(h, "11-council");
                await h.ev(`document.querySelector("[data-library-council-back]")?.click()`);
                const listAgain = await until(h, `document.querySelector(${JSON.stringify(row)}) != null && document.querySelector("[data-library-council-back]") == null`, 5000);
                const afterBack = { lib: await libraryState(h), agent: await agentState(h) };
                rec(
                    "11. the done council three days old opens inside Library under Back, Back returns to the Councils list, and Agent's council selection, view and centre are the same throughout",
                    inside &&
                        afterOpen.surface === "Library" &&
                        afterOpen.lib.council === CLOSED &&
                        JSON.stringify(afterOpen.agent) === JSON.stringify(agentBefore) &&
                        listAgain &&
                        afterBack.lib.council === null &&
                        JSON.stringify(afterBack.agent) === JSON.stringify(agentBefore),
                    JSON.stringify({ agentBefore, inside, afterOpen, listAgain, afterBack })
                );

                // 12. its views switch inside Library, by click and by r c m, on Library's own view atom
                await h.ev(`document.querySelector(${JSON.stringify(row)})?.click()`);
                await until(h, `document.querySelector("[data-library] [data-library-council-back]") != null`, 10_000);
                const root = (view) => `document.querySelector("[data-library] [data-council-${view}]") != null`;
                const viewNow = async () => (await libraryState(h)).councilView;
                await h.ev(`document.querySelector('[data-library] [data-council-tab="map"]')?.click()`);
                const byClickMap = (await until(h, root("map"), 5000)) && (await viewNow()) === "map";
                await h.ev(`document.querySelector('[data-library] [data-council-tab="summary"]')?.click()`);
                const byClickSummary = (await until(h, root("summary"), 5000)) && (await viewNow()) === "summary";
                await press(h, "c");
                const byKeyC = (await until(h, root("discussion"), 5000)) && (await viewNow()) === "discussion";
                await press(h, "m");
                const byKeyM = (await until(h, root("map"), 5000)) && (await viewNow()) === "map";
                await shot(h, "12-views");
                await press(h, "r");
                const byKeyR = (await until(h, root("summary"), 5000)) && (await viewNow()) === "summary";
                const agent12 = await agentState(h);
                rec(
                    "12. the council's Map and Summary tabs switch inside Library by click, and c, m and r (Discussion, Map, Report) by key, with Agent's council selection, view and centre unchanged",
                    byClickMap &&
                        byClickSummary &&
                        byKeyC &&
                        byKeyM &&
                        byKeyR &&
                        JSON.stringify(agent12) === JSON.stringify(agentBefore) &&
                        (await surface(h)) === "Library",
                    JSON.stringify({ byClickMap, byClickSummary, byKeyC, byKeyM, byKeyR, agent12, agentBefore })
                );
                await h.ev(`document.querySelector("[data-library-council-back]")?.click()`);

                // 13. a council that ends while Library shows it counts as seen: no toast and no unread dot, where one that ends
                // off screen gets its dot. Both start running, so the page's list has each as running before it ends
                const placed = (id, answer) => ({ id, edit: (c) => c.summary && (c.summary.answer = answer) });
                await seedCouncil(h, ctx.council, "round1", { id: SEEN });
                await seedCouncil(h, ctx.council, "round1", { id: UNSEEN });
                const running = await page(
                    h,
                    `const have = () => ["${SEEN}", "${UNSEEN}"].every((id) => globalStore.get(S.councilListAtom(""))?.find((c) => c.id === id)?.state === "running");
                    return await until(have, 8000);`
                );
                await page(h, `L.showLibraryCouncil(model, ${JSON.stringify(SEEN)}, "discussion"); return true;`);
                await until(h, `document.querySelector("[data-library] [data-library-council-back]") != null`, 8000);
                await nap(500);
                writeCouncil(ctx.council, "done", placed(SEEN, "LT seen answer"));
                await announceCouncil(h, ctx.council, SEEN);
                writeCouncil(ctx.council, "done", placed(UNSEEN, "LT unseen answer"));
                await announceCouncil(h, ctx.council, UNSEEN);
                const marked = await page(
                    h,
                    `return await until(() => globalStore.get(S.councilUnreadAtom).has("${UNSEEN}"), 8000);`
                );
                await nap(1500);
                const seen13 = await page(
                    h,
                    `return {
                        seenUnread: globalStore.get(S.councilUnreadAtom).has("${SEEN}"),
                        unseenUnread: globalStore.get(S.councilUnreadAtom).has("${UNSEEN}"),
                    };`
                );
                const toasts = await h.ev(
                    `[...document.querySelectorAll("[data-notification-toast]")].map((t) => t.textContent || "").filter((t) => t.includes("LT seen answer")).length`
                );
                await shot(h, "13-seen");
                rec(
                    "13. a council that ends while it is open in Library gets no toast and no unread dot, and one that ends off screen gets its dot",
                    running === true && marked === true && seen13.seenUnread === false && seen13.unseenUnread === true && toasts === 0,
                    JSON.stringify({ running, marked, ...seen13, seenToasts: toasts })
                );
                await h.ev(`document.querySelector("[data-library-council-back]")?.click()`);

                // 14. a council the Agent tree still keeps, opened by address from Jarvis (the route the Brief's rows take),
                // lands on Agent's centre, and Library's selection stays where it was
                await h.goto("jarvis");
                await h.rpc("uireveal", { address: `council:${TREE}` }, UI_ROUTE);
                const onAgent = await until(
                    h,
                    `document.querySelector("[data-council-discussion], [data-council-summary]") != null`,
                    10_000
                );
                const agent14 = await agentState(h);
                const lib14 = await libraryState(h);
                await shot(h, "14-tree-council");
                rec(
                    "14. a council the Agent tree keeps, opened from Jarvis by its address, lands on Agent with it in the centre, and Library's council selection is untouched",
                    onAgent &&
                        (await surface(h)) === "Agent" &&
                        agent14.sel === TREE &&
                        agent14.mode === "council" &&
                        lib14.council === null,
                    JSON.stringify({ onAgent, surface: await surface(h), agent14, lib14 })
                );
            } catch (e) {
                rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`library-tabs teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("remove the sessions mock", () => removeAhMock(h));
            await step("leave Agent's centre on its terminal", () =>
                page(h, `C.showTerminal(); globalStore.set(S.councilSelAtom, null); return true;`)
            );
            await step("reset Library", () =>
                page(
                    h,
                    `globalStore.set(L.libraryTabAtom, "conversations");
                    globalStore.set(L.libraryConvViewAtom, "list");
                    globalStore.set(L.libraryCouncilSelAtom, null);
                    globalStore.set(model.sessionsSelAtom, "all");
                    return true;`
                )
            );
            if (ctx.registered) {
                await step("delete the canvas project", async () => {
                    await h.rpc("deleteproject", { name: PROJECT });
                    // deleteproject leaves the channel createproject made
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.canvasDir))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                });
            }
            if (ctx.council != null) {
                await step("tear down the council project", () => teardownCouncilProject(h, ctx.council));
            }
            await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
            await step("leave on the Cockpit", () => h.goto("cockpit"));
        },
    };

    return [libraryTabs];
}
