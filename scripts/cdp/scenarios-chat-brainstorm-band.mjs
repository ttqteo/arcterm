// The brainstorm part of the Chat band (docs/superpowers/specs/2026-11-14-chat-brainstorm-status-design.md, plan
// 2026-11-14-chat-brainstorm-status.md Task 4): while a brainstorm is attached to an agent, one band under its Chat header
// always says how many boards it has (with a dot for the ones that are new since the Brainstorm tab was last looked at) and
// how many decisions are the user's, opens in place (pushing the conversation, never covering it), and the header's
// Brainstorm tab carries the same new-board dot. It is written against the plan's DOM contract (decision 5), not against the
// components:
//   [data-chat-band="<agentId>"][data-chat-band-open="initiative|brainstorm"]  every band root; also
//   [data-initiative-band][data-band-open][data-band-narrow] on the root of a band that has an initiative part,
//   [data-brainstorm-band="<agentId>"] (aria-expanded), [data-bsband-title], [data-bsband-boards], [data-bsband-new],
//   [data-bsband-decided], [data-bsband-body], [data-bsband-decision="<part id>"], [data-bsband-board="<file name>"][data-new],
//   [data-bsband-open-brainstorm], [data-band-mark-done], [data-band-on], and the header's [data-brainstorm-tab-new].
//
// Two fixture Claude agents over real tabs and a fixture roster (the page's dev mock roster): the first is linked to a fixture
// initiative and has a brainstorm.json attached that names a canvas, 3 boards over 2 parts and 4 decisions that are the user's,
// with `chat.brainstorm.seenBoards` preset to 2 of the 3 names (the seen names are read once, at module load, so the preset
// is written and the page reloaded before step 1); the second has a brainstorm of its own with no boards and no decision. A
// throwaway git project is registered with the app so the brainstorm files resolve. No real agent is launched. Keys and clicks
// are real CDP input events: the band's keys need focus, and a script's .click() does not take it.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME_A = "band bs main";
const NAME_B = "band bs only";
const PROJECT = "verify-chat-brainstorm-band";
const TOPIC_A = "band-boards";
const TOPIC_B = "band-only";
const WAIT_MS = 15000;
const SHORT_MS = 5000;
const BAND_KEY = "chat.initiative.band";
const PENDING_KEY = "chat.initiative.pending";
const SEEN_KEY = "chat.brainstorm.seenBoards";
const SENT_KEY = "chat.brainstorm.sent";
const HINTS_KEY = "brainstorm.hintsSeen";
// the band is narrow below this width, and the step narrows the window until the band is about NARROW_WANT
const NARROW_PX = 640;
const NARROW_WANT = 540;
const NARROW_PASSES = 6;
const NARROW_TOLERANCE = 24;
// the mid-width step: wide (not narrow), yet under the ~710px where the initiative part still holds its 380px basis
const MID_MIN = 640;
const MID_MAX = 700;
const MID_WANT = 660;
const MID_TOLERANCE = 12;

// the initiative the first agent works on: it holds the first chunk
const TITLE = "Band: boards in Chat";
const C = { one: "Draw the boards band", two: "Wire the boards band", three: "Write the boards docs" };

// --- the brainstorms ------------------------------------------------------------------------------------------------------

const BOARDS = ["Main.dc.html", "Alt.dc.html", "Timeout.dc.html"];
const SEEN = BOARDS.slice(0, 2);
const NEW_BOARD = "Page.dc.html";
const PART_A = { policy: "Retry policy", timeout: "Request timeout", logging: "What it logs" };

const part = (id, title, state, extra = {}) => ({
    id,
    title,
    state,
    body: state === "asked" ? "" : `${title}: the decision, in a sentence or two. It is settled.`,
    ...(state === "asked" ? {} : { gist: `${title}: settled.` }),
    ...(state === "guess" ? { from: "agent's call" } : {}),
    ...extra,
});

// the agent works between two questions: `working` set, no question open, one answered in `history`. Three boards over two
// parts (policy lists two, timeout one) and four decisions that are the user's; `extraBoard` adds a fourth, under a third part
const fileA = (extraBoard = null) => ({
    v: 1,
    title: "Page on-call: who is paged first",
    spec: "docs/superpowers/specs/2026-11-14-band-design.md",
    canvas: TOPIC_A,
    question: null,
    working: "Drawing a board for each way to page.",
    parts: [
        part("intent", "Intent and why", "yours"),
        part("scope", "What it covers", "yours"),
        part("policy", PART_A.policy, "yours", { boards: [BOARDS[0], BOARDS[1]] }),
        part("timeout", PART_A.timeout, "yours", { boards: [BOARDS[2]] }),
        part("logging", PART_A.logging, "guess", extraBoard != null ? { boards: [extraBoard] } : {}),
    ],
    history: [
        {
            kind: "question",
            n: 1,
            q: "Which retry policy should the client use?",
            a: "Exponential backoff",
            into: ["policy"],
            part: "policy",
        },
    ],
    done: false,
    check: null,
    run: null,
});

// a brainstorm with no canvas, no board and no decision of the user's yet
const fileB = () => ({
    v: 1,
    title: "Alert routing",
    spec: "docs/superpowers/specs/2026-11-14-routing-design.md",
    question: null,
    working: "Reading the code before the first question.",
    parts: [part("intent", "Intent and why", "asked")],
    history: [],
    done: false,
    check: null,
    run: null,
});

// --- page expressions -----------------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const bandOf = (id) => `document.querySelector('[data-chat-band="${id}"]')`;
const bsBandOf = (id) => `document.querySelector('[data-brainstorm-band="${id}"]')`;
// the conversation's scroller: the band is above it, and holds no scroller of its own in the brainstorm part, but the initiative
// part's All chunks list does, so the first match outside the band
const scrollerOf = (id) =>
    `((layer) => [...(layer?.querySelectorAll(".overflow-y-auto") ?? [])].find((el) => !el.closest("[data-chat-band]")))(${layerOf(id)})`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const TAB_DOT = `!!document.querySelector("[data-agent-header] [data-brainstorm-tab-new]")`;

const VK = { Enter: 13, Escape: 27 };

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, UI_ROUTE, GRID_KEY, GRID_EMPTY, bsSeeHints } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", BAND_KEY, PENDING_KEY, SEEN_KEY, SENT_KEY, HINTS_KEY];

    // --- input -------------------------------------------------------------------------------------------------------------

    // A key as a person types it: a letter goes as keyDown with its text, Enter and Escape as rawKeyDown
    async function press(h, key, nap = 300) {
        const vk = VK[key];
        if (vk == null) {
            const code = `Key${key.toUpperCase()}`;
            const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, windowsVirtualKeyCode });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
        } else {
            await h.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: vk });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: vk });
        }
        await polishNap(nap);
    }

    // A mouse click at the middle of the element `expr` evaluates to; false when none is drawn. A part still springing into
    // place is clicked where it settles, not where it was.
    async function click(h, expr) {
        const measure = () =>
            h.ev(`(() => {
                const el = ${expr};
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
            })()`);
        let box = await measure();
        for (let i = 0; i < 8 && box != null; i++) {
            await polishNap(120);
            const again = await measure();
            const steady = again != null && again.x === box.x && again.y === box.y;
            box = again;
            if (steady) break;
        }
        if (box == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
        await polishNap(300);
        return true;
    }

    // the keys the surface answers to need focus off the message box, which a click on the header's blank does for a person
    const focusSurface = (h) => h.ev(`document.querySelector("[data-cockpit-surface-wrap]")?.focus()`);
    // the band's root takes the focus, as a Tab to it does; true when the focus is in the band afterwards
    const focusBand = (h, id) =>
        h.ev(`(() => { const b = ${bandOf(id)}; b?.focus({ preventScroll: true }); return !!b && b.contains(document.activeElement); })()`);

    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/chat-brainstorm-band-${name}.png`);
        } catch (e) {
            console.error(`chat-brainstorm-band: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    // polls a Node-side check (an RPC read) until it holds
    async function until(check, ms = SHORT_MS) {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await check()) return true;
            await polishNap(250);
        }
        return false;
    }

    // --- the page's stores ---------------------------------------------------------------------------------------------------

    const setBandPart = (h, id, p) =>
        AC.agentPage(h, `const S = await mod("app/view/agents/initiativebandstore.ts"); S.setBandPart(${JSON.stringify(id)}, ${JSON.stringify(p)}); return true;`);
    // the Brainstorm tab's mode: "brainstorm" when the tab is the shown view
    const modeOf = (h, id) =>
        AC.agentPage(h, `const S = await mod("app/view/agents/brainstormstore.ts"); return S.getBrainstorm(${JSON.stringify(id)})?.mode ?? null;`);
    // back to Chat from the Brainstorm tab, as the header's Chat option does
    const backToChat = (h, id) =>
        AC.agentPage(h, `const S = await mod("app/view/agents/chatmodestore.ts"); S.selectCellView(${JSON.stringify(id)}, "chat", Date.now()); return true;`);
    const seenNames = (h, path) =>
        h.ev(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SEEN_KEY)}) ?? "{}")[${JSON.stringify(path)}]?.names ?? null; } catch { return null; } })()`);

    // --- the initiative's store ----------------------------------------------------------------------------------------------

    const getEffort = async (h, oid) => (await h.rpc("effortget", { effortoid: oid }))?.effort;
    // label -> its status
    const chunkStatus = async (h, oid) => Object.fromEntries(((await getEffort(h, oid))?.chunks ?? []).map((c) => [c.label, c.status]));

    // --- the band's DOM, read in one call ------------------------------------------------------------------------------------

    const readBand = (h, id) =>
        h.ev(`(() => {
            const flat = ${FLAT};
            const band = ${bandOf(id)};
            if (!band) return null;
            const q = (s) => band.querySelector(s);
            const text = (s) => { const e = q(s); return e ? flat(e) : null; };
            const boards = [...band.querySelectorAll("[data-bsband-board]")];
            const link = q("[data-bsband-open-brainstorm]");
            const last = boards[boards.length - 1];
            const bs = q("[data-brainstorm-band]");
            const body = q("[data-bsband-body]");
            const br = band.getBoundingClientRect();
            const sc = ${scrollerOf(id)};
            return {
                open: band.getAttribute("data-chat-band-open"),
                initiativeRoot: band.hasAttribute("data-initiative-band"),
                narrow: band.hasAttribute("data-band-narrow"),
                width: Math.round(br.width),
                bottom: Math.round(br.bottom),
                scrollerTop: sc ? Math.round(sc.getBoundingClientRect().top) : null,
                bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : null,
                // the brainstorm part's right edge stays inside the band: the chevron is not clipped
                fits: bs ? Math.round(bs.getBoundingClientRect().right) <= Math.round(br.right) + 1 && band.scrollWidth <= band.clientWidth + 1 : null,
                expanded: bs?.getAttribute("aria-expanded") ?? null,
                title: text("[data-bsband-title]"),
                boardsText: text("[data-bsband-boards]"),
                newText: text("[data-bsband-new]"),
                decidedText: text("[data-bsband-decided]"),
                markDoneOnBand: !!q("[data-band-mark-done]"),
                on: text("[data-band-on]"),
                decisions: [...band.querySelectorAll("[data-bsband-decision]")].map((d) => d.getAttribute("data-bsband-decision")),
                boardRows: boards.map((b) => ({ name: b.getAttribute("data-bsband-board"), isNew: b.hasAttribute("data-new"), part: flat(b.lastElementChild?.lastElementChild) })),
                linkCount: band.querySelectorAll("[data-bsband-open-brainstorm]").length,
                linkAfterBoards: link && last ? !!(last.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
                initiativeRows: band.querySelectorAll("[data-band-row]").length,
                questionCards: ${layerOf(id)}?.querySelectorAll("[data-chat-bscard-kind]").length ?? 0,
                focusInBand: band.contains(document.activeElement),
                tabDot: ${TAB_DOT},
            };
        })()`);

    // the band once its body has stopped moving (the part springs open), so a height and a position read are the settled ones
    async function settled(h, id) {
        let prev = null;
        for (let i = 0; i < 12; i++) {
            await polishNap(150);
            const now = await readBand(h, id);
            if (prev != null && now != null && now.scrollerTop === prev.scrollerTop && now.bodyHeight === prev.bodyHeight) return now;
            prev = now;
        }
        return prev;
    }

    // The window resized until the band is about `want` wide (the band follows the window while the layout holds); the
    // window's size is kept in ctx.viewport for the step to put back, and the band as it was before is returned.
    async function fitBandWidth(h, ctx, id, want, tolerance) {
        ctx.viewport ??= await h.ev("({ width: window.innerWidth, height: window.innerHeight })");
        const wide = await readBand(h, id);
        let width = ctx.viewport.width;
        let bandW = wide?.width ?? 0;
        for (let pass = 0; pass < NARROW_PASSES && Math.abs(bandW - want) > tolerance; pass++) {
            width += want - bandW;
            await h.cdp("Emulation.setDeviceMetricsOverride", { width, height: ctx.viewport.height, deviceScaleFactor: 1, mobile: false });
            await polishNap(700);
            bandW = (await readBand(h, id))?.width ?? 0;
        }
        return wide;
    }
    async function restoreViewport(h, ctx) {
        await h.cdp("Emulation.clearDeviceMetricsOverride", {});
        ctx.viewport = null;
        await polishNap(700);
    }

    const scenario = {
        name: "chat-brainstorm-band",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-cbb-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-cbb-project-")),
                prev: {},
                oids: [],
            };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "making the project";
                const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.cwd, "README.md"), "# band\n");
                git("add", ".");
                git("commit", "-qm", "seed");
                ctx.fileA = join(ctx.cwd, ".superpowers", "brainstorm", TOPIC_A, "brainstorm.json");
                ctx.fileB = join(ctx.cwd, ".superpowers", "brainstorm", TOPIC_B, "brainstorm.json");
                // the canvas the first file names, with the four boards the steps use, so the Brainstorm tab opens onto something
                const project = join(ctx.cwd, ".superpowers", "design", TOPIC_A, "project");
                mkdirSync(project, { recursive: true });
                const all = [...BOARDS, NEW_BOARD];
                for (const b of all) writeFileSync(join(project, b), `<!doctype html><title>${b}</title><p>${b}</p>`);
                writeFileSync(join(project, "canvas.json"), JSON.stringify({ boards: Object.fromEntries(all.map((b) => [b, { w: 1440 }])), order: all }));
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                at = "writing the transcripts";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const mk = (name, tag) => {
                    const lines = [];
                    for (let i = 0; i < 24; i++) {
                        lines.push(AC.userText(`question ${i}: how does part ${i} of the ${tag} work?`, o(i * 10)));
                        lines.push(AC.assistantText(`Reply ${i}. The ${tag} reads what the agent has decided and shows it, so a reader never has to open another tab to find out. `.repeat(3), o(i * 10 + 2)));
                    }
                    lines.push(AC.userText(`go on with the ${tag}`, o(300)));
                    return AC.writeTranscript(ctx.dir, name, lines);
                };
                ctx.transcriptA = mk("chat-brainstorm-band-main", "boards band");
                ctx.transcriptB = mk("chat-brainstorm-band-only", "routing");

                at = "presetting the seen board names";
                // the key is the file's path as the page spells it
                ctx.pathA = await AC.agentPage(h, `const M = await mod("app/view/agents/brainstormmodel.ts"); return M.brainstormFilePath(${JSON.stringify(ctx.cwd)}, ${JSON.stringify(TOPIC_A)});`);
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                // all of these are read once, when the page loads: no band part is open, no line waits, and the first brainstorm
                // has seen two of its three boards
                await h.ev(`localStorage.removeItem(${JSON.stringify(BAND_KEY)})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(PENDING_KEY)})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(SENT_KEY)})`);
                await h.ev(`localStorage.setItem(${JSON.stringify(SEEN_KEY)}, ${JSON.stringify(JSON.stringify({ [ctx.pathA]: { names: SEEN, at: Date.now() } }))})`);
                // the Brainstorm pane's first-open hint card is not what this scenario reads
                if (typeof bsSeeHints === "function") await bsSeeHints(h);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here with none: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");

                at = "making the tabs";
                // a shell controller, as the brainstorm scenarios give their agent, so the tab is one a brainstorm attaches to
                const blockMeta = { view: "term", controller: "shell", "cmd:cwd": "~" };
                ctx.tabA = await makeTab(h, ctx, { label: NAME_A, blockMeta });
                ctx.tabB = await makeTab(h, ctx, { label: NAME_B, blockMeta });

                at = "making the initiative";
                const made = await h.rpc("effortcreate", { title: TITLE, project: PROJECT, chunks: Object.values(C).map((label) => ({ label })) });
                ctx.oid = made.effortoid;
                ctx.oids.push(ctx.oid);
                await h.rpc("effortmutate", {
                    effortoid: ctx.oid,
                    author: "you",
                    ops: [
                        { op: "setChunkStatus", chunk: C.one, status: "active" },
                        { op: "attachWork", chunk: C.one, kind: "agent", oref: `agent:${ctx.tabA.tabId}` },
                    ],
                });

                at = "setting the roster";
                await AC.setRoster(h, rosterOf(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents, their project, their initiative and their transcripts", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tabA.tabId;
            const B = ctx.tabB.tabId;
            // a step that throws is a failed step, not the end of the run: the ones after it read what they need themselves
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            // writes a brainstorm file and has the page read it now: the agent's hook reveals after each write, which attaches
            // the brainstorm (the first time) and polls it
            async function write(file, path, agentCtx) {
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, JSON.stringify(file, null, 2));
                await h.rpc("uireveal", { address: `brainstorm:${path.includes(TOPIC_A) ? TOPIC_A : TOPIC_B}`, callerblockid: agentCtx.blockId, callercwd: ctx.cwd }, UI_ROUTE);
            }
            const writeA = (extra = null) => write(fileA(extra), ctx.fileA, ctx.tabA);
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, A);
            await polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-item]").length ?? 0) >= 6`, WAIT_MS);
            // the first agent's band, with its two parts drawn: the initiative's title and the brainstorm's boards
            async function startA() {
                await AC.focusAgent(h, A);
                await setBandPart(h, A, null);
                await writeA();
                return polishWaitFor(
                    h,
                    `${bandOf(A)}?.querySelector("[data-band-title]")?.textContent === ${JSON.stringify(TITLE)} && !!${bandOf(A)}.querySelector("[data-bsband-boards]")`,
                    WAIT_MS
                );
            }
            // the page's tab is back on Chat with the band drawn
            const chatShown = (id) => polishWaitFor(h, `((b) => !!b && b.getBoundingClientRect().width > 0)(${bandOf(id)})`, WAIT_MS);

            // 1. both parts on one line
            await run("1. collapsed", async (name) => {
                const up = await startA();
                await polishNap(500);
                const got = await readBand(h, A);
                ctx.collapsedTop = got?.scrollerTop ?? null;
                await shot(h, "1-collapsed");
                rec(
                    `${name}: the band holds both parts on one line: [data-bsband-boards] reads "3 boards", [data-bsband-new] "1 new", [data-bsband-decided] "Decided 4"; no [data-band-mark-done] on the line; the Brainstorm tab carries [data-brainstorm-tab-new]; the brainstorm part is collapsed`,
                    up &&
                        got?.initiativeRoot === true &&
                        got.open === null &&
                        got.expanded === "false" &&
                        got.boardsText === "3 boards" &&
                        got.newText === "1 new" &&
                        got.decidedText === "Decided 4" &&
                        got.markDoneOnBand === false &&
                        got.tabDot === true &&
                        got.fits === true,
                    { up, ...got }
                );
            });

            // 2. the brainstorm part opens in place
            await run("2. brainstorm-open", async (name) => {
                await startA();
                await polishNap(400);
                const before = await readBand(h, A);
                const clicked = await click(h, bsBandOf(A));
                const opened = await polishWaitFor(h, `!!${bandOf(A)}?.querySelector("[data-bsband-body]")`, SHORT_MS);
                const got = await settled(h, A);
                await shot(h, "2-brainstorm-open");
                const decided = ["intent", "scope", "policy", "timeout"];
                const pushed = got?.scrollerTop != null && before?.scrollerTop != null && got.bodyHeight != null ? got.scrollerTop - before.scrollerTop : null;
                rec(
                    `${name}: a click on [data-brainstorm-band] opens [data-bsband-body] with 4 [data-bsband-decision] and 3 [data-bsband-board] rows, exactly one with data-new, and one [data-bsband-open-brainstorm] after them; data-chat-band-open="brainstorm"; no question card is drawn; the conversation's top moved down by the body's height (the band's bottom is at or above it); the tab dot is still there`,
                    clicked &&
                        opened &&
                        got?.open === "brainstorm" &&
                        got.expanded === "true" &&
                        got.decisions.join() === decided.join() &&
                        got.boardRows.map((b) => b.name).join() === BOARDS.join() &&
                        got.boardRows.filter((b) => b.isNew).map((b) => b.name).join() === BOARDS[2] &&
                        got.boardRows.map((b) => b.part).join() === [PART_A.policy, PART_A.policy, PART_A.timeout].join() &&
                        got.linkCount === 1 &&
                        got.linkAfterBoards &&
                        got.questionCards === 0 &&
                        pushed != null &&
                        Math.abs(pushed - got.bodyHeight) <= 3 &&
                        got.bottom <= got.scrollerTop + 1 &&
                        got.tabDot === true &&
                        got.focusInBand === true,
                    { clicked, opened, pushed, ...got }
                );
            });

            // 3. `i` opens the initiative part over the brainstorm part; Esc closes it
            await run("3. initiative-over", async (name) => {
                // the brainstorm part is still open, with the focus in the band
                const before = await readBand(h, A);
                await press(h, "i");
                await polishWaitFor(h, `${bandOf(A)}?.getAttribute("data-chat-band-open") === "initiative"`, SHORT_MS);
                const got = await settled(h, A);
                await shot(h, "3-initiative-over");
                const hasMarkDone = await h.ev(`!!${bandOf(A)}?.querySelector("[data-band-mark-done]")`);
                await press(h, "Escape");
                await polishWaitFor(h, `${bandOf(A)}?.getAttribute("data-chat-band-open") == null`, SHORT_MS);
                const closed = await readBand(h, A);
                rec(
                    `${name}: with the brainstorm part open, i makes data-chat-band-open="initiative", [data-bsband-body] gone and the initiative's expanded view show, with a [data-band-mark-done] in it; Esc closes the part and the keyboard goes to the message box`,
                    before?.open === "brainstorm" &&
                        got?.open === "initiative" &&
                        got.initiativeRows > 0 &&
                        got.boardRows.length === 0 &&
                        hasMarkDone &&
                        closed?.open === null &&
                        closed.focusInBand === false,
                    { before: before?.open, open: got?.open, rows: got?.initiativeRows, bodyBoards: got?.boardRows.length, hasMarkDone, closed: closed?.open, focusInBand: closed?.focusInBand }
                );
            });

            // 3b. m with the band collapsed and focused
            await run("3b. mark-done-key", async (name) => {
                await setBandPart(h, A, null);
                await polishNap(400);
                const inBand = await focusBand(h, A);
                const state = await readBand(h, A);
                await press(h, "m", 500);
                const done = await until(async () => (await chunkStatus(h, ctx.oid))[C.one] === "done", WAIT_MS);
                const status = await chunkStatus(h, ctx.oid);
                await shot(h, "3b-mark-done-key");
                rec(
                    `${name}: with the band collapsed and the keyboard in it (no [data-band-mark-done] on the line), m marks the agent's chunk "${C.one}" done`,
                    inBand && state?.focusInBand === true && state.open === null && state.markDoneOnBand === false && done,
                    { inBand, focusInBand: state?.focusInBand, markDoneOnBand: state?.markDoneOnBand, done, status }
                );
            });

            // 4. a click on the new board opens the Brainstorm tab, which clears the dots
            await run("4. board-click", async (name) => {
                await startA();
                await setBandPart(h, A, null);
                await polishNap(300);
                const opened = await click(h, bsBandOf(A));
                await polishWaitFor(h, `!!${bandOf(A)}?.querySelector("[data-bsband-board][data-new]")`, SHORT_MS);
                await settled(h, A);
                const dotBefore = await h.ev(TAB_DOT);
                const clicked = await click(h, `${bandOf(A)}?.querySelector("[data-bsband-board][data-new]")`);
                const shown = await until(async () => (await modeOf(h, A)) === "brainstorm");
                await polishNap(500);
                await shot(h, "4-brainstorm-tab");
                await backToChat(h, A);
                await chatShown(A);
                await polishWaitFor(h, `!!${bandOf(A)}?.querySelector("[data-bsband-board]")`, SHORT_MS);
                await settled(h, A);
                const got = await readBand(h, A);
                const names = await seenNames(h, ctx.pathA);
                await shot(h, "4-back-in-chat");
                rec(
                    `${name}: a click on the new board's row opens the Brainstorm tab; back in Chat [data-bsband-new] and [data-brainstorm-tab-new] are gone, no row has data-new, and all three names are stored as seen`,
                    opened &&
                        dotBefore === true &&
                        clicked &&
                        shown &&
                        got?.newText === null &&
                        got.tabDot === false &&
                        got.boardRows.length === 3 &&
                        got.boardRows.every((b) => !b.isNew) &&
                        Array.isArray(names) &&
                        BOARDS.every((n) => names.includes(n)),
                    { opened, dotBefore, clicked, shown, newText: got?.newText, tabDot: got?.tabDot, rows: got?.boardRows, names }
                );
            });

            // 4b. b from inside the band
            await run("4b. b-key", async (name) => {
                await setBandPart(h, A, null);
                await polishNap(300);
                const opened = await click(h, bsBandOf(A));
                await polishWaitFor(h, `!!${bandOf(A)}?.querySelector("[data-bsband-body]")`, SHORT_MS);
                await settled(h, A);
                const state = await readBand(h, A);
                await press(h, "b", 500);
                const shown = await until(async () => (await modeOf(h, A)) === "brainstorm");
                await shot(h, "4b-b-key");
                await backToChat(h, A);
                await chatShown(A);
                rec(
                    `${name}: with the brainstorm part open and the keyboard in the band, b makes the Brainstorm tab the shown view (the global b stands down in the band, so the band answers it)`,
                    opened && state?.open === "brainstorm" && state.focusInBand === true && shown,
                    { opened, open: state?.open, focusInBand: state?.focusInBand, shown }
                );
            });

            // 5. a board written while Chat is shown
            await run("5. new-board", async (name) => {
                await AC.focusAgent(h, A);
                await setBandPart(h, A, "brainstorm");
                await chatShown(A);
                const before = await readBand(h, A);
                await writeA(NEW_BOARD);
                const arrived = await polishWaitFor(h, `${FLAT}(${bandOf(A)}?.querySelector("[data-bsband-new]")) === "1 new"`, WAIT_MS);
                await polishWaitFor(h, TAB_DOT, SHORT_MS);
                await settled(h, A);
                const got = await readBand(h, A);
                await shot(h, "5-new-board");
                rec(
                    `${name}: while the agent's Chat is shown, a fourth board written into brainstorm.json makes [data-bsband-new] read "1 new" within the poll interval, [data-bsband-boards] "4 boards", the new row carry data-new and the tab dot come back`,
                    before?.newText === null &&
                        before.tabDot === false &&
                        arrived &&
                        got?.boardsText === "4 boards" &&
                        got.tabDot === true &&
                        got.boardRows.filter((b) => b.isNew).map((b) => b.name).join() === NEW_BOARD,
                    { before: { newText: before?.newText, tabDot: before?.tabDot }, arrived, boardsText: got?.boardsText, tabDot: got?.tabDot, rows: got?.boardRows }
                );
            });

            // 6. an agent with only a brainstorm
            await run("6. brainstorm-only", async (name) => {
                await AC.focusAgent(h, B);
                await write(fileB(), ctx.fileB, ctx.tabB);
                const up = await polishWaitFor(h, `!!${bandOf(B)}?.querySelector("[data-bsband-title]")`, WAIT_MS);
                await setBandPart(h, B, null);
                await polishNap(500);
                const got = await readBand(h, B);
                await shot(h, "6-brainstorm-only");
                await focusSurface(h);
                await press(h, "i");
                const picker = await polishWaitFor(h, `!!document.querySelector("[data-initiative-picker]")`, SHORT_MS);
                await polishNap(300);
                await press(h, "Escape");
                const closed = await polishWaitFor(h, `!document.querySelector("[data-initiative-picker]")`, SHORT_MS);
                rec(
                    `${name}: the second agent's band has [data-chat-band] and no [data-initiative-band], its [data-bsband-title] ("Alert routing"), no [data-bsband-boards] and "Decided 0"; i opens the Link to initiative picker`,
                    up &&
                        got != null &&
                        got.initiativeRoot === false &&
                        got.title === "Alert routing" &&
                        got.boardsText === null &&
                        got.decidedText === "Decided 0" &&
                        picker &&
                        closed,
                    { up, initiativeRoot: got?.initiativeRoot, title: got?.title, boardsText: got?.boardsText, decidedText: got?.decidedText, picker, closed }
                );
            });

            // 7. a narrow cell
            await run("7. narrow", async (name) => {
                await AC.focusAgent(h, A);
                await setBandPart(h, A, null);
                await chatShown(A);
                // the window narrowed until the band is about NARROW_WANT wide
                const wide = await fitBandWidth(h, ctx, A, NARROW_WANT, NARROW_TOLERANCE);
                await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-narrow") === true`, SHORT_MS);
                await polishNap(400);
                const narrow = await readBand(h, A);
                await shot(h, "7-narrow");
                await restoreViewport(h, ctx);
                rec(
                    `${name}: with the band under ${NARROW_PX}px it has data-band-narrow and no chunk label ([data-band-on] reads only "On <n>"); the brainstorm part keeps [data-bsband-boards] and [data-bsband-new] (the dot) and [data-bsband-decided], all inside the band`,
                    narrow != null &&
                        narrow.width < NARROW_PX &&
                        narrow.narrow &&
                        /^On\b/.test(narrow.on ?? "") &&
                        !Object.values(C).some((label) => (narrow.on ?? "").includes(label)) &&
                        narrow.boardsText != null &&
                        narrow.newText != null &&
                        narrow.decidedText === "Decided 4" &&
                        narrow.fits === true &&
                        wide?.narrow === false,
                    { wide: { width: wide?.width, narrow: wide?.narrow, on: wide?.on }, narrow: { width: narrow?.width, narrow: narrow?.narrow, on: narrow?.on, boards: narrow?.boardsText, newText: narrow?.newText, decided: narrow?.decidedText, fits: narrow?.fits } }
                );
            });

            // 8. between the narrow cell and a roomy one, the initiative part has given way and the body follows the brainstorm part
            await run("8. mid-width-body", async (name) => {
                await AC.focusAgent(h, A);
                await setBandPart(h, A, null);
                await chatShown(A);
                await fitBandWidth(h, ctx, A, MID_WANT, MID_TOLERANCE);
                await polishNap(400);
                await setBandPart(h, A, "brainstorm");
                await polishWaitFor(h, `!!${bandOf(A)}?.querySelector("[data-bsband-body]")`, SHORT_MS);
                const got = await settled(h, A);
                // where the part's content starts on the line (its lightbulb, after the part's own padding) against where the
                // body's first column starts; `old` is where the fixed 395px offset this replaced would have put the column
                const geo = await h.ev(`(() => {
                    const band = ${bandOf(A)};
                    const part = band?.querySelector("[data-brainstorm-band]");
                    const bulb = part?.querySelector("svg");
                    const column = band?.querySelector("[data-bsband-body]")?.firstElementChild;
                    const initiative = band?.querySelector("[data-band-line]");
                    if (!band || !part || !bulb || !column || !initiative) return null;
                    const left = (el) => el.getBoundingClientRect().left;
                    return {
                        contentLeft: Math.round(left(bulb) * 10) / 10,
                        columnLeft: Math.round(left(column) * 10) / 10,
                        old: Math.round((left(band) + 395) * 10) / 10,
                        initiativeWidth: Math.round(initiative.getBoundingClientRect().width),
                    };
                })()`);
                await shot(h, "8-mid-width-body");
                await restoreViewport(h, ctx);
                rec(
                    `${name}: with the band ${MID_MIN}-${MID_MAX}px wide (not data-band-narrow), both parts drawn, the initiative part narrower than its 380px basis and the brainstorm part open, the left of [data-bsband-body]'s first column is within 2px of the left of the brainstorm part's content on the line`,
                    got != null &&
                        got.width >= MID_MIN &&
                        got.width < MID_MAX &&
                        got.narrow === false &&
                        got.initiativeRoot === true &&
                        got.open === "brainstorm" &&
                        geo != null &&
                        geo.initiativeWidth < 375 &&
                        Math.abs(geo.columnLeft - geo.contentLeft) <= 2,
                    { width: got?.width, narrow: got?.narrow, open: got?.open, ...geo, off: geo != null ? Math.round((geo.columnLeft - geo.contentLeft) * 10) / 10 : null, wasOff: geo != null ? Math.round((geo.old - geo.contentLeft) * 10) / 10 : null }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-brainstorm-band teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("remove the probes", () => h.ev(`(() => { delete window.__chatSuggestFake; return true; })()`));
            await step("put the window back", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
            await step("close an open picker", async () => {
                if (await h.ev(`!!document.querySelector("[data-initiative-picker]")`)) await press(h, "Escape");
            });
            const ids = [ctx.tabA?.tabId, ctx.tabB?.tabId].filter(Boolean);
            if (ids.length > 0) {
                await step("put the band, the waiting lines and the brainstorms back", () =>
                    AC.agentPage(
                        h,
                        `const B = await mod("app/view/agents/initiativebandstore.ts");
                        const I = await mod("app/view/agents/chatinitiativestore.ts");
                        const S = await mod("app/view/agents/brainstormstore.ts");
                        for (const id of ${JSON.stringify(ids)}) { B.setBandPart(id, null); I.takeResultLines(id); S.detachBrainstorm(id); }
                        return true;`
                    )
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            for (const oid of ctx.oids ?? []) {
                await step(`delete ${oid}`, () => h.rpc("effortdelete", { effortoid: oid }));
            }
            await step("close the fixture tabs", () => closeTabs(h, ctx));
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
            // wavesrv's transcript watch and the canvas server can hold a fixture for a moment after their agent is gone
            for (const dir of [ctx.dir, ctx.cwd]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    // the roster rows: the first agent, linked to the initiative, and the second, linked to nothing
    function rosterOf(ctx) {
        const row = (tab, name, transcriptPath, extra = {}) => ({
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 42 },
            id: tab.tabId,
            name,
            blockId: tab.blockId,
            transcriptPath,
            ...extra,
        });
        return [row(ctx.tabA, NAME_A, ctx.transcriptA, { effortId: ctx.oid }), row(ctx.tabB, NAME_B, ctx.transcriptB)];
    }

    return [scenario];
}
