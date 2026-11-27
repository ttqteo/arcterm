// The Agent rail's Brainstorm and Initiative tabs (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md;
// frontend/app/view/agents/railbrainstormpane.tsx, railinitiativepane.tsx), which took the Chat band's two parts and the
// header's ◇ popover, and the ◇ chip and `i` that open the Initiative tab (from Chat the key is its twin Alt+I: a bare letter
// there is text). Three scenarios, each on fixture Claude agents over
// real tabs and the page's dev mock roster (no real agent is launched), keys and clicks as real CDP input events:
//
//   rail-brainstorm-tab   the timeline of a brainstorm in the rail (the tab and its dot, the numbered decisions, a board under
//                         its decision with `new`, Open parts), the board dialog over Chat and over the terminal (focus, ← / →,
//                         Esc, `b`), and the tab's empty and error states. Also the What's new picture.
//   rail-initiative-tab   a linked agent: Alt+I, the head, the three sections, `m`, `n`, `w` (the waiting line, a failed switch,
//                         told at once), the status menu, `All chunks`, Plan to review (Accept), folding, `i` back, the ◇ chip,
//                         the header's "N to review" chip, Terminal view, no chunk (Pick a chunk…), a failed read and its
//                         Retry, and the chunk chips the box offers (done: / go on with:). It carries over what the Chat band's
//                         scenarios (chat-initiative-band, chat-brainstorm-band) and the popover's checked that has a home here.
//   rail-tabs-split       a split of four with two linked agents: the ◇ chip and the Brainstorm switch's dot in the header of
//                         each linked cell as it takes the focus (the surface has one AgentHeader, for the focused agent), the
//                         chip and the Brainstorm marker with its dot in each linked cell's own 26px bar, read on cells that do
//                         not have the focus, the strip at the rail's 300px with Council, Brainstorm, Initiative and the Verify
//                         count (no clip), and the bar's chip and marker taking their cell and the rail's tab.
//
// DOM contract (the panes' own markers): the rail is aside[aria-label="Agent details"]; its tabs [data-rail-tab="…"] with
// [data-rail-tab-dot]; the panes [data-rail-brainstorm="<id>"] (rows [data-rail-brainstorm-row="<n>"][data-has-new], chips
// [data-rail-board="<name>"][data-new], [data-rail-brainstorm-open-parts], [data-rail-brainstorm-state="reading|error|empty"])
// and [data-rail-initiative="<id>"] (head [data-rail-initiative-head|-title|-progress|-on|-mark-done|-pick|-error|-scroll], sections
// [data-rail-initiative-section="initiative-chunks|initiative-plan|initiative-note"] over section[data-rail-section][data-open],
// rows [data-rail-initiative-row="<label>"][data-rail-initiative-row-kind], [data-rail-initiative-work-on|-all|-all-list|-menu|
// -note|-add-note|-retry]); the board dialog [data-chat-board-dialog="<id>"] holding [data-bsband-preview="<name>"]; the header's
// [data-initiative-link-open] and [data-plan-review-chip]; a split cell's bar [data-agent-cell-bar="<id>"] with its chip
// [data-agent-cell-initiative="<id>"] ([data-agent-cell-initiative-title|-progress]) and marker [data-agent-cell-brainstorm="<id>"]
// ([data-agent-cell-brainstorm-dot="new|asking"]). The band and the popover are gone: no step may find
// [data-chat-band], [data-initiative-band] or [data-initiative-popover] in the page, which every step checks after it runs.
//
// kit is scenarios.mjs's CR_KIT.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import { writeCouncil } from "./council/fixtures.mjs";

const WAIT_MS = 15000;
const SHORT_MS = 5000;
const RPC = { timeout: 30_000 };

const RAIL_VISIBLE_KEY = "agent.rail.visible";
const RAIL_TAB_KEY = "agent.rail.tab";
const RAIL_SECTIONS_KEY = "cockpit.rail.sections";
const CHATMODE_KEY = "agent.chatmode";
const PENDING_KEY = "chat.initiative.pending";
const SEEN_KEY = "chat.brainstorm.seenBoards";
const SENT_KEY = "chat.brainstorm.sent";
const HINTS_KEY = "brainstorm.hintsSeen";
const MOCK_KEY = "__railTabsInputMock";

// --- page expressions -----------------------------------------------------------------------------------------------------

const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const tabOf = (tab) => `${ASIDE}?.querySelector('[data-rail-tab="${tab}"]')`;
const SELECTED = `${ASIDE}?.querySelector('[role="tab"][aria-selected="true"]')?.dataset.railTab ?? null`;
const BS = (id) => `${ASIDE}?.querySelector('[data-rail-brainstorm="${id}"]')`;
const IN = (id) => `${ASIDE}?.querySelector('[data-rail-initiative="${id}"]')`;
const DIALOG = (id) => `document.querySelector('[data-chat-board-dialog="${id}"]')`;
const PREVIEW = (id) => `${DIALOG(id)}?.querySelector("[data-bsband-preview]")`;
const CHIP = (name) => `${ASIDE}?.querySelector('[data-rail-board="${name}"]')`;
const LINK_CHIP = `document.querySelector("[data-agent-header] [data-initiative-link-open]")`;
const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const inputOf = (id) => `${layerOf(id)}?.querySelector("[data-chat-input]")`;
// what the band and the popover drew: none of it may be in the page now
const GONE = `!!document.querySelector("[data-chat-band], [data-initiative-band], [data-initiative-popover], [data-brainstorm-band]")`;
const pendingBubbles = (id) => `[...(${layerOf(id)}?.querySelectorAll("[data-chat-pending]") ?? [])].map((p) => p.firstElementChild?.textContent.trim())`;
const youBubbles = (id) => `[...(${layerOf(id)}?.querySelectorAll("[data-chat-you]") ?? [])].map(${FLAT})`;

const VK = { Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

// a Claude transcript long enough that Chat scrolls, then the request this run answers
function writeTranscripts(ctx, tag, names) {
    const base = Date.now() - 3_600_000;
    const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
    const out = {};
    for (const name of names) {
        const lines = [];
        for (let i = 0; i < 24; i++) {
            lines.push(AC.userText(`question ${i}: how does part ${i} of the ${tag} work?`, o(i * 10)));
            lines.push(AC.assistantText(`Reply ${i}. The rail reads what the agent has and shows it, so a reader never has to open another view to find out. `.repeat(3), o(i * 10 + 2)));
        }
        lines.push(AC.userText(`go on with the ${tag}`, o(300)));
        out[name] = AC.writeTranscript(ctx.dir, `rail-tabs-${tag}-${name}`, lines);
    }
    return out;
}

// the roster row of one fixture agent
const rosterRow = (ctx, project, tab, name, transcriptPath, extra = {}) => ({
    project,
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

// --- the brainstorm fixtures --------------------------------------------------------------------------------------------------

const BOARDS = ["Main.dc.html", "Alt.dc.html", "Timeout.dc.html"];
const OPEN_BOARD = "Page.dc.html";
const PART = { intent: "Intent and why", scope: "What it covers", policy: "Retry policy", timeout: "Request timeout", logging: "What it logs" };

const part = (id, title, state, extra = {}) => ({
    id,
    title,
    state,
    body: state === "asked" ? "" : `${title}: the decision, in a sentence or two. It is settled.`,
    ...(state === "asked" ? {} : { gist: `${title}: settled.` }),
    ...(state === "guess" ? { from: "agent's call" } : {}),
    ...extra,
});

// Four decisions that are the user's (intent, scope, policy with two boards, timeout with one) and a fifth, the agent's guess,
// whose board is therefore on an open part: the timeline's four rows, a board under two of them and Open parts
const fileOf = (topic, canvas) => ({
    v: 1,
    title: "Page on-call: who is paged first",
    spec: "docs/superpowers/specs/2026-11-20-rail-tabs-design.md",
    canvas,
    question: null,
    working: "Drawing a board for each way to page.",
    parts: [
        part("intent", PART.intent, "yours"),
        part("scope", PART.scope, "yours"),
        part("policy", PART.policy, "yours", { boards: [BOARDS[0], BOARDS[1]] }),
        part("timeout", PART.timeout, "yours", { boards: [BOARDS[2]] }),
        part("logging", PART.logging, "guess", { boards: [OPEN_BOARD] }),
    ],
    history: [{ kind: "question", n: 1, q: "Which retry policy should the client use?", a: "Exponential backoff", into: ["policy"], part: "policy" }],
    done: false,
    check: null,
    run: null,
});

// no decision is the user's: every board is on an open part
const fileNoDecision = (canvas) => ({
    ...fileOf(null, canvas),
    parts: [part("intent", PART.intent, "guess", { boards: [BOARDS[0]] }), part("policy", PART.policy, "asked", { boards: [BOARDS[1]] })],
    history: [],
});

// a throwaway git project with the brainstorm's canvas folders (so the boards open), registered with the app
function makeProject(ctx, readme) {
    const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
    git("init", "-q", "--initial-branch=main");
    writeFileSync(join(ctx.cwd, "README.md"), `# ${readme}\n`);
    git("add", ".");
    git("commit", "-qm", "seed");
    return git;
}
function makeCanvas(ctx, topic, names) {
    const project = join(ctx.cwd, ".superpowers", "design", topic, "project");
    mkdirSync(project, { recursive: true });
    for (const b of names) writeFileSync(join(project, b), `<!doctype html><title>${b}</title><p>${b}</p>`);
    writeFileSync(join(project, "canvas.json"), JSON.stringify({ boards: Object.fromEntries(names.map((b) => [b, { w: 1440 }])), order: names }));
}

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, UI_ROUTE, GRID_KEY, GRID_EMPTY, bsSeeHints } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    // --- input ---------------------------------------------------------------------------------------------------------------

    // A key as a person types it: a letter goes as keyDown with its text; Enter and the arrows as rawKeyDown (Enter with its
    // character, which an input needs)
    async function press(h, key, nap = 300) {
        const vk = VK[key];
        if (vk == null) {
            const code = `Key${key.toUpperCase()}`;
            const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, windowsVirtualKeyCode });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
        } else {
            await h.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: vk });
            if (key === "Enter") await h.cdp("Input.dispatchKeyEvent", { type: "char", key, code: key, text: "\r", windowsVirtualKeyCode: vk });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: vk });
        }
        await polishNap(nap);
    }

    // The Alt twin of a bare agent key, as a person holds Alt (Option on a Mac) and types the letter: keyDown and keyUp with
    // the Alt bit and no text. With the agent in Chat the bare letters are text (chatTakesLetters in bindings.ts: `i` from
    // the surface types into the message box), and each button's key acts there through its twin (ALT_TWINS: Alt+I is
    // agent:initiative-alt, the same run as `i`).
    async function pressAlt(h, key, nap = 300) {
        const code = `Key${key.toUpperCase()}`;
        const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers: 1 });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers: 1 });
        await polishNap(nap);
    }

    // A mouse click at the middle of the element `expr` evaluates to (hover first, as a person's pointer); false when none is
    // drawn. A part still moving is clicked where it settles.
    async function click(h, expr) {
        const measure = () =>
            h.ev(`(() => {
                const el = ${expr};
                if (!el) return null;
                // inside a scrolling pane the element may be scrolled out of sight, where a click would land on what covers it
                el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
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

    // the keys the surface answers to need focus off the message box
    const focusSurface = (h) => h.ev(`document.activeElement?.blur?.(); document.querySelector("[data-cockpit-surface-wrap]")?.focus()`);
    const page = (h, body) => AC.agentPage(h, body);
    const setRail = (h, on) => page(h, `const R = await mod("app/view/agents/railstore.ts"); globalStore.set(R.railVisibleAtom, ${on}); return true;`);
    const railOpen = (h) => page(h, `const R = await mod("app/view/agents/railstore.ts"); return globalStore.get(R.railVisibleAtom);`);
    const setMode = (h, id, mode) => page(h, `const S = await mod("app/view/agents/chatmodestore.ts"); S.setChatMode(${JSON.stringify(id)}, ${JSON.stringify(mode)}); return true;`);
    const focusedAgent = (h) => page(h, `return globalStore.get(agentsModel().focusIdAtom) ?? null;`);
    // the reveal's toast would cover the panel in the pictures
    const closeToasts = (h) => h.ev(`(() => { for (const b of document.querySelectorAll("[data-notification-close]")) b.click(); return true; })()`);
    const selectTab = (h, tab) => click(h, tabOf(tab));

    // polls a Node-side check (an RPC read) until it holds
    async function until(check, ms = SHORT_MS) {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await check()) return true;
            await polishNap(250);
        }
        return false;
    }

    // the steps' recorder: a step that throws is a failed step, not the end of the run; after each, the band and the popover
    // must still be gone
    function recorder(h, label) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        const run = async (name, fn) => {
            try {
                await fn(name);
            } catch (e) {
                rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
            }
            if (await h.ev(GONE)) rec(`${name}: no [data-chat-band], [data-initiative-band] or [data-initiative-popover] in the page`, false, "the band or the popover is drawn");
        };
        const shot = async (name) => {
            try {
                await h.shot(`cdp-shots/${label}-${name}.png`);
            } catch (e) {
                console.error(`${label}: the shot ${name} failed: ${e?.message ?? e}`);
            }
        };
        return { steps, rec, run, shot };
    }

    // the keys a scenario touches, saved in arrange and put back in teardown; the rail is made visible and left on Overview
    async function saveKeys(h, ctx, extra = []) {
        ctx.prev = {};
        for (const k of [RAIL_VISIBLE_KEY, RAIL_TAB_KEY, RAIL_SECTIONS_KEY, CHATMODE_KEY, GRID_KEY, PENDING_KEY, SEEN_KEY, SENT_KEY, HINTS_KEY, ...extra]) {
            ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
        }
        await h.ev(`(() => {
            localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true");
            for (const k of [${JSON.stringify(RAIL_TAB_KEY)}, ${JSON.stringify(RAIL_SECTIONS_KEY)}, ${JSON.stringify(CHATMODE_KEY)}, ${JSON.stringify(PENDING_KEY)}, ${JSON.stringify(SENT_KEY)}]) localStorage.removeItem(k);
            localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))});
            return true;
        })()`);
    }
    const restoreKeys = (h, ctx) =>
        h.ev(`(() => {
            for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                if (v == null) localStorage.removeItem(k);
                else localStorage.setItem(k, v);
            }
            return true;
        })()`);

    // a teardown step that never ends the teardown
    const stepper = (label) => async (what, fn) => {
        try {
            await fn();
        } catch (e) {
            console.error(`${label} teardown: ${what} failed: ${e?.message ?? e}`);
        }
    };

    const removeProject = async (h, ctx) => {
        // deleteproject leaves the channel createproject made, so that goes too
        await h.rpc("deleteproject", { name: ctx.project });
        const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        const channels = (await h.rpc("getchannels", null))?.channels ?? [];
        for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.cwd))) {
            await h.rpc("deletechannel", { channelid: c.oid });
        }
    };

    // --- the initiative's store --------------------------------------------------------------------------------------------

    const mutate = (h, oid, ops) => h.rpc("effortmutate", { effortoid: oid, author: "you", ops });
    const getEffort = async (h, oid) => (await h.rpc("effortget", { effortoid: oid }))?.effort;
    // label -> its status, the orefs holding it and its notes
    const chunkState = async (h, oid) =>
        Object.fromEntries(
            ((await getEffort(h, oid))?.chunks ?? []).map((c) => [c.label, { status: c.status, holders: (c.workrefs ?? []).map((w) => w.oref), notes: (c.notes ?? []).map((n) => n.text) }])
        );
    // The page reads an initiative when its agent's state changes, and nothing pushes a write made over RPC: this reads it again.
    const refreshEffort = (h, oid) =>
        page(h, `const S = await mod("app/view/jarvis/effortstore.ts"); await S.loadEffortDetail(${JSON.stringify("effort:" + oid)}, Number.MAX_SAFE_INTEGER); return true;`);

    // =========================================================================================================================
    // rail-brainstorm-tab
    // =========================================================================================================================

    const NAME_BS = "rail bs main";
    const PROJECT_BS = "verify-rail-brainstorm";
    const TOPIC_BS = "rail-boards";
    const TITLE_BS = "Rail tabs: boards in the rail";
    const C_BS = { one: "Draw the timeline", two: "Wire the timeline", three: "Write the timeline docs" };

    const brainstormTab = {
        name: "rail-brainstorm-tab",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-rbt-")), cwd: mkdtempSync(join(tmpdir(), "verify-rbt-project-")), oids: [] };
            let at = "reading the keys";
            try {
                await saveKeys(h, ctx);
                at = "making the project";
                makeProject(ctx, "rail brainstorm");
                ctx.file = join(ctx.cwd, ".superpowers", "brainstorm", TOPIC_BS, "brainstorm.json");
                makeCanvas(ctx, TOPIC_BS, [...BOARDS, OPEN_BOARD]);
                await h.rpc("createproject", { name: PROJECT_BS, path: ctx.cwd });
                ctx.project = PROJECT_BS;
                await waitForProjectInConfig(h, PROJECT_BS);
                at = "writing the transcript";
                ctx.transcript = writeTranscripts(ctx, "boards", ["a"]).a;
                at = "presetting the seen board names";
                // the key is the file's path as the page spells it; the names are read once, at module load, hence the reload
                ctx.path = await page(h, `const M = await mod("app/view/agents/brainstormmodel.ts"); return M.brainstormFilePath(${JSON.stringify(ctx.cwd)}, ${JSON.stringify(TOPIC_BS)});`);
                // all but Timeout have been seen: one new board, under the "Request timeout" decision
                await h.ev(`localStorage.setItem(${JSON.stringify(SEEN_KEY)}, ${JSON.stringify(JSON.stringify({ [ctx.path]: { names: [BOARDS[0], BOARDS[1], OPEN_BOARD], at: Date.now() } }))})`);
                // the Brainstorm pane's first-open hint card is not what this scenario reads
                if (typeof bsSeeHints === "function") await bsSeeHints(h);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here with none: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the tab";
                // a shell controller, as the brainstorm scenarios give their agent, so the tab is one a brainstorm attaches to
                ctx.tab = await makeTab(h, ctx, { label: NAME_BS, blockMeta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
                at = "making the initiative";
                // linked too, so the strip shows both new tabs, as the What's new picture does
                const made = await h.rpc("effortcreate", { title: TITLE_BS, project: PROJECT_BS, chunks: Object.values(C_BS).map((label) => ({ label })) });
                ctx.oid = made.effortoid;
                ctx.oids.push(ctx.oid);
                await mutate(h, ctx.oid, [
                    { op: "setChunkStatus", chunk: C_BS.one, status: "active" },
                    { op: "attachWork", chunk: C_BS.one, kind: "agent", oref: `agent:${ctx.tab.tabId}` },
                ]);
                at = "setting the roster";
                await AC.setRoster(h, [rosterRow(ctx, PROJECT_BS, ctx.tab, NAME_BS, ctx.transcript, { effortId: ctx.oid })]);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const { steps, rec, run, shot } = recorder(h, "rail-brainstorm-tab");
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent, its project, its initiative and its transcript", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tab.tabId;
            const write = async (file) => {
                mkdirSync(dirname(ctx.file), { recursive: true });
                writeFileSync(ctx.file, typeof file === "string" ? file : JSON.stringify(file, null, 2));
                // the agent's hook reveals after each write, which attaches the brainstorm (the first time) and reads it
                await h.rpc("uireveal", { address: `brainstorm:${TOPIC_BS}`, callerblockid: ctx.tab.blockId, callercwd: ctx.cwd }, UI_ROUTE);
            };
            // wavesrv serves the canvas once the file lists a board: a board opens over the cell only after that
            const baseUp = () => page(h, `const S = await mod("app/view/agents/brainstormstore.ts"); const s = S.getBrainstorm(${JSON.stringify(A)}); return !!s && s.base != null && s.file?.canvas != null;`);
            const modeOf = (h2) => page(h2, `const S = await mod("app/view/agents/brainstormstore.ts"); return S.getBrainstorm(${JSON.stringify(A)})?.mode ?? null;`);
            const seenNames = () => h.ev(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SEEN_KEY)}) ?? "{}")[${JSON.stringify(ctx.path)}]?.names ?? null; } catch { return null; } })()`);

            const read = () =>
                h.ev(`(() => {
                    const flat = ${FLAT};
                    const pane = ${BS(A)};
                    const tab = ${tabOf("brainstorm")};
                    const dlg = ${DIALOG(A)};
                    const prev = dlg?.querySelector("[data-bsband-preview]");
                    const chip = (b) => ({ name: b.getAttribute("data-rail-board"), isNew: b.hasAttribute("data-new"), text: flat(b) });
                    const row = (r) => {
                        const circle = r.firstElementChild?.firstElementChild;
                        return {
                            n: r.getAttribute("data-rail-brainstorm-row"),
                            numText: flat(circle),
                            hasNew: r.hasAttribute("data-has-new"),
                            filled: circle?.classList.contains("bg-accent") === true,
                            head: flat(r.children[1]?.firstElementChild),
                            boards: [...r.querySelectorAll("[data-rail-board]")].map(chip),
                        };
                    };
                    const heading = pane?.querySelector("[data-rail-brainstorm-open-parts]");
                    const state = pane?.querySelector("[data-rail-brainstorm-state]");
                    const firstChip = pane?.querySelector("[data-rail-board]");
                    const cell = document.querySelector('[data-agent-terminal="${A}"]');
                    const dr = dlg?.getBoundingClientRect();
                    const cr = cell?.getBoundingClientRect();
                    return {
                        tab: !!tab,
                        tabDot: !!tab?.querySelector("[data-rail-tab-dot]"),
                        selected: ${SELECTED},
                        pane: !!pane,
                        title: flat(pane?.querySelector("[data-rail-brainstorm-title]")),
                        meta: flat(pane?.querySelector("[data-rail-brainstorm-meta]")),
                        rows: [...(pane?.querySelectorAll("[data-rail-brainstorm-row]") ?? [])].map(row),
                        openHead: flat(heading),
                        openBoards: [...(heading?.parentElement?.querySelectorAll("[data-rail-board]") ?? [])].map(chip),
                        stateKind: state?.getAttribute("data-rail-brainstorm-state") ?? null,
                        stateText: flat(state),
                        stateAboveBoards: state && firstChip ? !!(state.compareDocumentPosition(firstChip) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
                        preview: prev?.getAttribute("data-bsband-preview") ?? null,
                        focusInDialog: !!dlg && dlg.contains(document.activeElement),
                        coversCell: !!dr && !!cr && Math.abs(dr.left - cr.left) < 3 && Math.abs(dr.top - cr.top) < 3 && Math.abs(dr.width - cr.width) < 3 && Math.abs(dr.height - cr.height) < 3,
                        focusChip: document.activeElement?.getAttribute?.("data-rail-board") ?? null,
                        headerDot: !!document.querySelector("[data-agent-header] [data-brainstorm-tab-new]"),
                    };
                })()`);

            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, A);
            await polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-item]").length ?? 0) >= 6`, WAIT_MS);

            // 1. the tab, its dot and the timeline
            await run("1. timeline", async (name) => {
                await write(fileOf(TOPIC_BS, TOPIC_BS));
                const up = await polishWaitFor(h, `!!${tabOf("brainstorm")} && !!${tabOf("brainstorm")}.querySelector("[data-rail-tab-dot]")`, WAIT_MS);
                const stripTabs = await h.ev(`[...(${ASIDE}?.querySelectorAll('[role="tab"]') ?? [])].map((t) => t.dataset.railTab)`);
                const before = await read();
                await selectTab(h, "brainstorm");
                await polishWaitFor(h, `!!${BS(A)} && ${BS(A)}.querySelectorAll("[data-rail-brainstorm-row]").length === 4`, WAIT_MS);
                await polishNap(400);
                const got = await read();
                await closeToasts(h);
                await polishNap(400);
                await shot("1-timeline");
                // The What's new picture is 2:1 and a tall rail would lose its strip off the top of it, so the window is made 2:1
                // for it and the picture is the whole window: the rail with both new tabs, the chip in the header, Chat beside it
                let picture = "none";
                try {
                    await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1200, height: 600, deviceScaleFactor: 1, mobile: false });
                    await polishNap(900);
                    picture = (await h.whatsnewShot("rail-tabs")).comment;
                } catch (e) {
                    picture = `the What's new picture failed: ${e?.message ?? e}`;
                } finally {
                    await h.cdp("Emulation.clearDeviceMetricsOverride", {});
                    await polishNap(700);
                }
                const rows = got.rows;
                const r3 = rows[2];
                const r4 = rows[3];
                rec(
                    `${name}: the strip has a Brainstorm tab (after Changes and Transcript, before Initiative) with its accent dot while a board is new, the tab's body is the timeline: 4 rows numbered 1-4 over the decisions "${PART.intent}", "${PART.scope}", "${PART.policy}", "${PART.timeout}", with the two seen boards under "${PART.policy}" and the new one under "${PART.timeout}" carrying "new" and its number filled; "Open parts" lists ${OPEN_BOARD}; the head reads the title and "Decided 4 · 4 boards"; the header's Brainstorm switch has its dot`,
                    up &&
                        stripTabs.indexOf("brainstorm") > stripTabs.indexOf("changes") &&
                        stripTabs.indexOf("brainstorm") < stripTabs.indexOf("initiative") &&
                        before.tabDot === true &&
                        got.selected === "brainstorm" &&
                        got.tabDot === true &&
                        got.title === "Page on-call: who is paged first" &&
                        /Decided 4 · 4 boards/.test(got.meta) &&
                        rows.map((r) => r.n).join() === "1,2,3,4" &&
                        rows.every((r) => r.numText === r.n) &&
                        rows.map((r) => r.head.replace(/ ?new$/, "")).join("|") === [PART.intent, PART.scope, PART.policy, PART.timeout].join("|") &&
                        rows[0].boards.length === 0 &&
                        rows[1].boards.length === 0 &&
                        r3.boards.map((b) => b.name).join() === [BOARDS[0], BOARDS[1]].join() &&
                        r3.boards.every((b) => !b.isNew) &&
                        r3.hasNew === false &&
                        r3.filled === false &&
                        r4.boards.map((b) => b.name).join() === BOARDS[2] &&
                        r4.boards[0].isNew === true &&
                        /new$/.test(r4.boards[0].text) &&
                        r4.hasNew === true &&
                        r4.filled === true &&
                        /new$/.test(r4.head) &&
                        got.openHead === "Open parts" &&
                        got.openBoards.map((b) => b.name).join() === OPEN_BOARD &&
                        got.openBoards[0].isNew === false &&
                        got.headerDot === true,
                    { up, stripTabs, before: { tabDot: before.tabDot }, got, picture }
                );
            });

            // 2. a chip opens the board over Chat; ← / → step in the timeline's order, Esc closes
            await run("2. board dialog over Chat", async (name) => {
                const based = await until(baseUp, WAIT_MS);
                const clicked = await click(h, CHIP(BOARDS[2]));
                const opened = await polishWaitFor(h, `!!${PREVIEW(A)}`, SHORT_MS);
                await polishNap(700);
                const view = await read();
                const preview = () => h.ev(`${PREVIEW(A)}?.getAttribute("data-bsband-preview") ?? null`);
                const first = await preview();
                const names = await seenNames();
                await shot("2-board-over-chat");
                // timeline order: Main, Alt, Timeout, then the open part's Page
                await press(h, "ArrowRight");
                const toPage = await preview();
                await press(h, "ArrowRight");
                const stays = await preview();
                await press(h, "ArrowLeft");
                const backOne = await preview();
                await press(h, "ArrowLeft");
                const backTwo = await preview();
                await shot("2-arrow-boards");
                // Esc closes it, and the chip that had the focus when it opened gets it back
                await press(h, "Escape", 600);
                const closed = await polishWaitFor(h, `!${PREVIEW(A)}`, SHORT_MS);
                const after = await read();
                rec(
                    `${name}: a click on the new board's chip opens [data-bsband-preview="${BOARDS[2]}"] in [data-chat-board-dialog] over the whole cell and the focus is inside the dialog; the chip loses "new", the row its fill and the tab its dot, and the name is stored as seen; → steps to ${OPEN_BOARD} and stops there, ← steps back to ${BOARDS[2]} and ${BOARDS[1]}; Esc closes it and the focus is back on the chip that opened it`,
                    based &&
                        clicked &&
                        opened &&
                        first === BOARDS[2] &&
                        view.coversCell === true &&
                        view.focusInDialog === true &&
                        Array.isArray(names) &&
                        names.includes(BOARDS[2]) &&
                        toPage === OPEN_BOARD &&
                        stays === OPEN_BOARD &&
                        backOne === BOARDS[2] &&
                        backTwo === BOARDS[1] &&
                        closed &&
                        after.rows[3].boards[0].isNew === false &&
                        after.rows[3].hasNew === false &&
                        after.rows[3].filled === false &&
                        after.tabDot === false &&
                        after.focusChip === BOARDS[2],
                    { based, clicked, opened, first, view: { cover: view.coversCell, focusIn: view.focusInDialog }, names, toPage, stays, backOne, backTwo, closed, after: { newTag: after.rows[3].boards[0].isNew, hasNew: after.rows[3].hasNew, filled: after.rows[3].filled, tabDot: after.tabDot, focusChip: after.focusChip } }
                );
            });

            // 3. the same in Terminal view: the dialog is the cell's, over the terminal; `b` closes it and opens the Brainstorm view
            await run("3. board dialog over the terminal", async (name) => {
                await setMode(h, A, "terminal");
                await polishWaitFor(h, `(() => { const p = document.querySelector('[data-agent-terminal="${A}"]'); return p != null && !p.classList.contains("hidden"); })()`, SHORT_MS);
                await polishNap(600);
                const clicked = await click(h, CHIP(BOARDS[0]));
                const opened = await polishWaitFor(h, `!!${PREVIEW(A)}`, SHORT_MS);
                await polishNap(700);
                const view = await read();
                await shot("3-board-over-terminal");
                await press(h, "b", 600);
                const closed = await polishWaitFor(h, `!${PREVIEW(A)}`, SHORT_MS);
                const mode = await modeOf(h);
                await shot("3-brainstorm-view");
                // back to Chat, with the rail on the Brainstorm tab for the steps that follow
                await page(h, `const S = await mod("app/view/agents/chatmodestore.ts"); S.selectCellView(${JSON.stringify(A)}, "chat", Date.now()); return true;`);
                await polishWaitFor(h, `!!${layerOf(A)} && ${layerOf(A)}.getBoundingClientRect().width > 0`, WAIT_MS);
                rec(
                    `${name}: with the agent in Terminal view the same chip opens the board in the dialog over the terminal cell (it covers the cell, the focus inside it); b closes it and the agent's view is Brainstorm`,
                    clicked && opened && view.coversCell === true && view.focusInDialog === true && closed && mode === "brainstorm",
                    { clicked, opened, view: { cover: view.coversCell, focusIn: view.focusInDialog, board: view.preview }, closed, mode }
                );
            });

            // 4. no decision is the user's yet: the line above the boards, which are all on open parts
            await run("4. nothing decided yet", async (name) => {
                if ((await h.ev(SELECTED)) !== "brainstorm") await selectTab(h, "brainstorm");
                await write(fileNoDecision(TOPIC_BS));
                const up = await polishWaitFor(h, `${BS(A)}?.querySelector("[data-rail-brainstorm-state]")?.getAttribute("data-rail-brainstorm-state") === "empty"`, WAIT_MS);
                await polishNap(400);
                const got = await read();
                await shot("4-nothing-decided");
                rec(
                    `${name}: with no decision of the user's the body reads "Nothing decided yet" above the boards, no numbered row, and "Open parts" lists both boards`,
                    up &&
                        got.stateText === "Nothing decided yet" &&
                        got.stateAboveBoards === true &&
                        got.rows.length === 0 &&
                        got.openHead === "Open parts" &&
                        got.openBoards.map((b) => b.name).join() === [BOARDS[0], BOARDS[1]].join(),
                    { up, state: got.stateText, above: got.stateAboveBoards, rows: got.rows.length, open: got.openBoards.map((b) => b.name) }
                );
            });

            // 5. a brainstorm.json that cannot be read: its error text (the store shows it after two failed reads)
            await run("5. unreadable file", async (name) => {
                await write("{ this is not json");
                let up = false;
                // the second failed read is the poller's, so the reveal is repeated until it has had its two
                for (let i = 0; i < 6 && !up; i++) {
                    up = await polishWaitFor(h, `${BS(A)}?.querySelector("[data-rail-brainstorm-state]")?.getAttribute("data-rail-brainstorm-state") === "error"`, 4000);
                    if (!up) await h.rpc("uireveal", { address: `brainstorm:${TOPIC_BS}`, callerblockid: ctx.tab.blockId, callercwd: ctx.cwd }, UI_ROUTE);
                }
                await polishNap(300);
                const got = await read();
                await shot("5-unreadable");
                // a good file again, so the pane recovers
                await write(fileOf(TOPIC_BS, TOPIC_BS));
                const back = await polishWaitFor(h, `${BS(A)}?.querySelectorAll("[data-rail-brainstorm-row]").length === 4 && !${BS(A)}.querySelector("[data-rail-brainstorm-state]")`, WAIT_MS);
                rec(
                    `${name}: an unreadable brainstorm.json shows the error text ("brainstorm.json is not valid JSON…") in the tab, and the timeline is back once the file is good`,
                    up && /^brainstorm\.json is not valid JSON/.test(got.stateText) && back,
                    { up, stateKind: got.stateKind, stateText: got.stateText, back }
                );
            });

            // 6. the question card's boards (Chat's, not the rail's): a Board chip on each option row when the asked part has a
            // board per option, which opens that option's board in the cell's dialog over Chat; a row of chips over the options
            // when the counts differ
            await run("6. question card boards", async (name) => {
                await AC.focusAgent(h, A);
                const CARD = `${layerOf(A)}?.querySelector('[data-chat-bscard-kind="question"]')`;
                const ask = (options) => {
                    const f = fileOf(TOPIC_BS, TOPIC_BS);
                    return {
                        ...f,
                        working: null,
                        question: {
                            n: 2,
                            text: "Which retry policy should the client use?",
                            part: "policy",
                            why: "Each way is drawn on its own board.",
                            options: options.map((label, i) => ({ label, detail: `The ${label.toLowerCase()} way.`, pick: i === 0 })),
                        },
                        parts: f.parts.map((p) => (p.id === "policy" ? { ...p, state: "asked" } : p)),
                    };
                };
                const readCard = () =>
                    h.ev(`(() => {
                        const c = ${CARD};
                        if (!c) return null;
                        return {
                            rows: [...c.querySelectorAll("[data-chat-bscard-option]")].map((o) => o.parentElement?.querySelector("[data-chat-bscard-board]")?.getAttribute("data-chat-bscard-board") ?? null),
                            strip: [...(c.querySelector("[data-chat-bscard-boardstrip]")?.querySelectorAll("[data-chat-bscard-board]") ?? [])].map((b) => b.getAttribute("data-chat-bscard-board")),
                        };
                    })()`);
                await write(ask(["Exponential", "Fixed"]));
                const up = await polishWaitFor(h, `(${CARD}?.querySelectorAll("[data-chat-bscard-option] ~ * [data-chat-bscard-board]").length ?? 0) === 2`, WAIT_MS);
                await polishNap(500);
                const linked = await readCard();
                await shot("6-option-boards");
                const clicked = await click(h, `${CARD}?.querySelectorAll("[data-chat-bscard-board]")[1]`);
                const dialog = await polishWaitFor(h, `${PREVIEW(A)}?.getAttribute("data-bsband-preview") === ${JSON.stringify(BOARDS[1])}`, SHORT_MS);
                const mode = await modeOf(h);
                await polishNap(600);
                const view = await read();
                await shot("6-option-board-open");
                await press(h, "Escape", 600);
                const closed = await polishWaitFor(h, `!${PREVIEW(A)}`, SHORT_MS);
                await write(ask(["Exponential", "Fixed", "None"]));
                const stripUp = await polishWaitFor(h, `(${CARD}?.querySelectorAll("[data-chat-bscard-option]").length ?? 0) === 3 && !!${CARD}?.querySelector("[data-chat-bscard-boardstrip]")`, WAIT_MS);
                await polishNap(400);
                const unlinked = await readCard();
                await shot("6-board-strip");
                // a good file again, with no question
                await write(fileOf(TOPIC_BS, TOPIC_BS));
                rec(
                    `${name}: a question on a part with 2 boards and 2 options draws a [data-chat-bscard-board] on each option row (board i on row i) and no strip; a click on row B's chip opens [data-bsband-preview="${BOARDS[1]}"] in the cell's dialog over Chat (the agent stays in Chat, the focus inside the dialog) and Esc closes it; with 3 options the rows have no chip and [data-chat-bscard-boardstrip] holds both boards`,
                    up &&
                        linked?.rows.join() === [BOARDS[0], BOARDS[1]].join() &&
                        linked.strip.length === 0 &&
                        clicked &&
                        dialog &&
                        mode !== "brainstorm" &&
                        view.focusInDialog === true &&
                        closed &&
                        stripUp &&
                        unlinked?.rows.every((r) => r === null) &&
                        unlinked.strip.join() === [BOARDS[0], BOARDS[1]].join(),
                    { up, linked, clicked, dialog, mode, focusIn: view.focusInDialog, closed, stripUp, unlinked }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = stepper("rail-brainstorm-tab");
            await step("remove the probes", () => h.ev(`(() => { delete window.__chatSuggestFake; return true; })()`));
            if (ctx.tab != null) {
                await step("put the view and the brainstorm back", () =>
                    page(
                        h,
                        `const S = await mod("app/view/agents/brainstormstore.ts");
                        const M = await mod("app/view/agents/chatmodestore.ts");
                        M.setChatMode(${JSON.stringify(ctx.tab.tabId)}, "chat");
                        S.detachBrainstorm(${JSON.stringify(ctx.tab.tabId)});
                        return true;`
                    )
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            for (const oid of ctx.oids ?? []) await step(`delete ${oid}`, () => h.rpc("effortdelete", { effortoid: oid }));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            if (ctx.project != null) await step("remove the project", () => removeProject(h, ctx));
            await step("restore the keys", () => restoreKeys(h, ctx));
            await step("reload onto the live roster", () => ahReload(h));
            // wavesrv's transcript watch and the canvas server can hold a fixture for a moment after their agent is gone
            for (const dir of [ctx.dir, ctx.cwd]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    // =========================================================================================================================
    // rail-initiative-tab
    // =========================================================================================================================

    const NAME_A = "rail in main";
    const NAME_B = "rail in other";
    const PROJECT_IN = "verify-rail-initiative";
    const TITLE = "Rail: the initiative tab";
    const C = {
        spec: "Spec the tab",
        draw: "Draw the tab",
        keys: "Wire the tab keys",
        docs: "Write the tab docs",
        other: "Tune the tab for others",
        free1: "Free chunk one",
        free2: "Free chunk two",
    };
    const PROPOSED = ["Proposed one", "Proposed two", "Proposed three"];
    const NOTE = "Drew the rows, the keys are next.";
    const NOTE2 = "Wired the keys, the docs are next.";
    const RENAMED = "Free chunk two, renamed";
    const MESSAGE = "carry on with the docs";
    // a half-typed message: Work on this then leaves the line waiting for it instead of telling the agent at once
    const DRAFT = "a draft of mine";
    // chatinitiative.ts SWITCH_NOTE: what the switch sends on its own when the box is empty
    const SWITCH_NOTE = "Go on with this chunk.";
    const FAIL = "verify: the switch was refused";
    const READ_FAIL = "verify: the initiative could not be read";

    const initiativeTab = {
        name: "rail-initiative-tab",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-rit-")), oids: [], patchA: {} };
            let at = "reading the keys";
            try {
                await saveKeys(h, ctx);
                at = "writing the transcripts";
                const t = writeTranscripts(ctx, "initiative", ["a", "b"]);
                ctx.transcriptA = t.a;
                ctx.transcriptB = t.b;
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here with none: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the tabs";
                ctx.tabA = await makeTab(h, ctx, { label: NAME_A });
                ctx.tabB = await makeTab(h, ctx, { label: NAME_B });
                at = "installing the input mock";
                // what the page types into the main agent's block is recorded (the block has no controller, so a send would
                // otherwise have nowhere to go), and a read of an initiative fails while window.__railReadFail is set
                const mock = await page(
                    h,
                    `const api = (await mod("app/store/wshclientapi.ts")).RpcApi;
                    if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
                    if (window.${MOCK_KEY}) return "already-installed";
                    const prev = api.mockClient ?? null;
                    const m = { api, prev, inputs: [] };
                    api.setMockRpcClient({
                        mockWshRpcCall(client, command, data, opts) {
                            if (command === "controllerinput" && data?.blockid === ${JSON.stringify(ctx.tabA.blockId)}) {
                                m.inputs.push(atob(data.inputdata64 ?? ""));
                                return Promise.resolve(null);
                            }
                            if (command === "effortget" && window.__railReadFail) return Promise.reject(new Error(window.__railReadFail));
                            return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
                        },
                        mockWshRpcStream(client, command, data, opts) {
                            return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
                        },
                    });
                    window.${MOCK_KEY} = m;
                    return "installed";`
                );
                if (mock !== "installed") throw new Error(`input mock: ${mock}`);
                at = "setting the roster";
                await AC.setRoster(h, initiativeRoster(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const { steps, rec, run, shot } = recorder(h, "rail-initiative-tab");
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents, their transcripts and the input mock", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tabA.tabId;
            const B = ctx.tabB.tabId;
            const refA = `agent:${A}`;
            const refB = `agent:${B}`;
            const ts = (offsetMs = 0) => ({ cwd: ctx.dir, ts: new Date(Date.now() + offsetMs).toISOString() });
            const append = (...lines) => appendFileSync(ctx.transcriptA, lines.join("\n") + "\n");
            // the main agent's roster row, with the state under test kept between calls
            const setA = (patch) => {
                ctx.patchA = { ...ctx.patchA, ...patch };
                return AC.setRoster(h, initiativeRoster(ctx, ctx.patchA));
            };
            // An initiative with the chunks of `specs` ({ label, status?, hold?: "A" | "B", note? }), made over RPC. The done
            // ones go first, so an agent that holds a finished chunk and then a live one is never refused.
            async function makeEffort(title, specs, proposed = []) {
                const made = await h.rpc("effortcreate", { title, project: PROJECT_IN, chunks: specs.map((s) => ({ label: s.label })) });
                const oid = made.effortoid;
                ctx.oids.push(oid);
                const ordered = [...specs.filter((s) => s.status === "done"), ...specs.filter((s) => s.status !== "done")];
                for (const s of ordered) {
                    const ops = [];
                    if (s.status != null && s.status !== "pending") ops.push({ op: "setChunkStatus", chunk: s.label, status: s.status });
                    if (s.hold != null) ops.push({ op: "attachWork", chunk: s.label, kind: "agent", oref: s.hold === "A" ? refA : refB });
                    if (s.note != null) ops.push({ op: "appendNote", chunk: s.label, note: s.note });
                    if (ops.length > 0) await mutate(h, oid, ops);
                }
                if (proposed.length > 0) await mutate(h, oid, proposed.map((label) => ({ op: "addChunk", label, stage: "Build", status: "proposed" })));
                return oid;
            }
            // the steps' own initiative: the agent finished the spec and is on the drawing, the other agent is on its own, and
            // the agent proposed three chunks nobody has decided on
            const makeMain = (title = TITLE) =>
                makeEffort(
                    title,
                    [
                        { label: C.spec, status: "done", hold: "A" },
                        { label: C.draw, status: "active", hold: "A", note: NOTE },
                        { label: C.keys },
                        { label: C.docs },
                        { label: C.other, status: "active", hold: "B" },
                        { label: C.free1 },
                        { label: C.free2 },
                    ],
                    PROPOSED
                );
            // links the agent to an initiative and waits for its chip to read it
            async function link(oid, title) {
                await takePending();
                await setA({ effortId: oid });
                return polishWaitFor(h, `${FLAT}(${LINK_CHIP}).includes(${JSON.stringify(title)})`, WAIT_MS);
            }
            const takePending = () => page(h, `const S = await mod("app/view/agents/chatinitiativestore.ts"); S.takeResultLines(${JSON.stringify(A)}); return true;`);
            const pendingLines = async () => (await h.ev(`JSON.parse(localStorage.getItem(${JSON.stringify(PENDING_KEY)}) ?? "{}")[${JSON.stringify(A)}] ?? []`)) ?? [];
            const switchLines = async () => (await pendingLines()).filter((l) => l.startsWith("initiative: switched "));
            // what the page typed into the main agent's block, as the person's text: the bytes read with atob are Latin-1, the
            // bracketed-paste markers go and xterm's "\r" line ends read as "\n"
            const ESC = String.fromCharCode(27);
            const unbracket = (i) => Buffer.from(i, "latin1").toString("utf8").replace(`${ESC}[200~`, "").replace(`${ESC}[201~`, "").replace(/\r/g, "\n");
            const typedInputs = async () => ((await h.ev(`window.${MOCK_KEY}?.inputs ?? []`)) ?? []).filter((i) => i !== "" && i !== "\r" && i !== `${ESC}[I` && i !== `${ESC}[O`).map(unbracket);
            const setBox = (text) => page(h, `const S = await mod("app/view/agents/chatinsert.ts"); return S.replaceChatBox(${JSON.stringify(A)}, ${JSON.stringify(text)});`);
            const typeInBox = async (text) => {
                await h.ev(`(${inputOf(A)})?.focus()`);
                await h.cdp("Input.insertText", { text });
            };
            const enterInBox = async () => {
                for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
                await polishNap(400);
            };

            // --- the tab's DOM ---
            const rowOf = (label) => `${IN(A)}?.querySelector('[data-rail-initiative-row="${label}"]')`;
            const workOnBtn = (label) => `${rowOf(label)}?.querySelector("[data-rail-initiative-work-on]")`;
            const sectionOf = (id) => `${IN(A)}?.querySelector('[data-rail-initiative-section="${id}"]')`;
            const cursorLabel = () => h.ev(`${IN(A)}?.querySelector('[data-rail-initiative-row][aria-current="true"]')?.getAttribute("data-rail-initiative-row") ?? null`);
            const read = () =>
                h.ev(`(() => {
                    const flat = ${FLAT};
                    const pane = ${IN(A)};
                    const tab = ${tabOf("initiative")};
                    const rowOf = (r) => ({
                        kind: r.getAttribute("data-rail-initiative-row-kind"),
                        label: r.getAttribute("data-rail-initiative-row"),
                        tag: flat(r.querySelector("[data-rail-initiative-tag]")),
                        workOn: !!r.querySelector("[data-rail-initiative-work-on]"),
                        // the label's own span: the row on the cursor shows its whole title, without the truncate class
                        struck: getComputedStyle(r.querySelector("[data-rail-initiative-label]") ?? r).textDecorationLine.includes("line-through"),
                    });
                    const sec = (id) => {
                        const s = pane?.querySelector('[data-rail-initiative-section="' + id + '"]');
                        return s ? { open: s.querySelector("section[data-rail-section]")?.getAttribute("data-open") === "true", head: flat(s.querySelector("h3")) } : null;
                    };
                    const mark = pane?.querySelector("[data-rail-initiative-mark-done]");
                    const pick = pane?.querySelector("[data-rail-initiative-pick]");
                    const all = pane?.querySelector("[data-rail-initiative-all]");
                    const dot = tab?.querySelector("[data-rail-tab-dot]");
                    return {
                        tab: !!tab,
                        tabDot: !!dot,
                        tabDotAsking: dot?.classList.contains("bg-asking") === true,
                        selected: ${SELECTED},
                        pane: !!pane,
                        focusIn: !!pane && pane.contains(document.activeElement),
                        title: flat(pane?.querySelector("[data-rail-initiative-title]")),
                        progress: flat(pane?.querySelector("[data-rail-initiative-progress]")),
                        on: flat(pane?.querySelector("[data-rail-initiative-on]")),
                        onState: pane?.querySelector("[data-rail-initiative-on]")?.getAttribute("data-rail-initiative-state") ?? null,
                        paneState: pane?.querySelector("[data-rail-initiative-state]")?.getAttribute("data-rail-initiative-state") ?? null,
                        markDone: mark ? flat(mark) : null,
                        pick: pick ? flat(pick) : null,
                        chunks: sec("initiative-chunks"),
                        plan: sec("initiative-plan"),
                        note: sec("initiative-note"),
                        rows: [...(pane?.querySelectorAll("[data-rail-initiative-row]") ?? [])].filter((r) => !r.closest("[data-rail-initiative-all-list]")).map(rowOf),
                        allRows: [...(pane?.querySelectorAll("[data-rail-initiative-all-list] [data-rail-initiative-row]") ?? [])].map(rowOf),
                        allText: flat(all),
                        allListOpen: !!pane?.querySelector("[data-rail-initiative-all-list]"),
                        noteText: flat(pane?.querySelector("[data-rail-initiative-note]")),
                        addNote: !!pane?.querySelector("[data-rail-initiative-add-note]"),
                        openJarvis: !!pane?.querySelector("[data-rail-initiative-open-jarvis]"),
                        error: flat(pane?.querySelector("[data-rail-initiative-error]")),
                        errorState: flat(pane?.querySelector('[data-rail-initiative-state="error"]')),
                        retry: !!pane?.querySelector("[data-rail-initiative-retry]"),
                        planRows: [...(pane?.querySelectorAll("[data-plan-row]") ?? [])].map((r) => r.getAttribute("data-plan-row")),
                    };
                })()`);
            const labels = (rows) => rows.map((r) => r.label).join(" | ");

            // the tab on show with the keyboard in it: Alt+I from the surface (the agent is in Chat, where a bare `i` is text),
            // or already there
            async function openTab() {
                if ((await h.ev(SELECTED)) !== "initiative" || !(await railOpen(h))) {
                    await focusSurface(h);
                    await pressAlt(h, "i", 500);
                }
                await polishWaitFor(h, `!!${IN(A)}`, WAIT_MS);
                await focusPane();
            }
            const focusPane = () => h.ev(`(() => { const p = ${IN(A)}; p?.focus({ preventScroll: true }); return !!p && p.contains(document.activeElement); })()`);
            // the full list open: a click on the All chunks row when it is not
            async function ensureAll() {
                if (!(await h.ev(`!!${IN(A)}?.querySelector("[data-rail-initiative-all-list]")`))) {
                    await click(h, `${IN(A)}?.querySelector("[data-rail-initiative-all]")`);
                }
                return polishWaitFor(h, `!!${IN(A)}?.querySelector("[data-rail-initiative-all-list]")`, SHORT_MS);
            }
            // moves the cursor to the row with this label: the arrows stop at the ends, so it goes to the top first and then down
            async function cursorTo(label) {
                for (let i = 0; i < 12; i++) await press(h, "ArrowUp", 50);
                for (let i = 0; i < 14; i++) {
                    if ((await cursorLabel()) === label) return true;
                    await press(h, "ArrowDown", 120);
                }
                return (await cursorLabel()) === label;
            }
            // a proposed row's buttons are folded to no width until the pointer is over the row
            const planRow = (label) => `[...(${IN(A)}?.querySelectorAll("[data-plan-row]") ?? [])].find((r) => (r.querySelector(":scope > div > span")?.textContent ?? "") === ${JSON.stringify(label)})`;
            async function planAct(label, buttonName) {
                const at = await h.ev(`(() => {
                    const r = ${planRow(label)};
                    if (!r) return null;
                    r.scrollIntoView({ block: "center", behavior: "instant" });
                    const b = r.getBoundingClientRect();
                    return { x: Math.round(b.x + 24), y: Math.round(b.y + b.height / 2) };
                })()`);
                if (at == null) return false;
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
                await polishNap(150);
                return click(h, `(${planRow(label)})?.querySelector('button[aria-label="${buttonName}"]')`);
            }

            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            ctx.main = await makeMain();
            await AC.focusAgent(h, A);
            await polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-item]").length ?? 0) >= 6`, WAIT_MS);
            await link(ctx.main, TITLE);
            await refreshEffort(h, ctx.main);

            // 1. Alt+I shows the tab and the keyboard is in it. The agent is in Chat, where the bare `i` types into the message
            // box. The click on Overview first is the person's own pick: an agent whose tab nobody set opens on its initiative
            // (contextPanel), and from the Initiative tab the key would step back.
            await run("1. Alt+I opens the tab", async (name) => {
                await selectTab(h, "overview");
                const before = await h.ev(SELECTED);
                await focusSurface(h);
                await pressAlt(h, "i", 600);
                const up = await polishWaitFor(h, `!!${IN(A)} && ${IN(A)}.querySelector("[data-rail-initiative-row]") != null`, WAIT_MS);
                await polishNap(600);
                const got = await read();
                await closeToasts(h);
                await shot("1-open");
                rec(
                    `${name}: from Overview, Alt+I (the twin of i, which in Chat types into the box) selects the Initiative tab (the rail visible, the keyboard inside the tab); its head reads the title, "1/7" and "On 2 ${C.draw}" with Mark done and its m key; Chunks lists done · mine · next · next · other (${NAME_B}'s) and "All chunks (7)"; Plan to review is there with its count 3 and the tab's dot is the asking colour; the latest note is the one on the chunk, headed "Latest note on 2"; Open in Jarvis and Add note show; no [data-chat-band] or [data-initiative-popover]`,
                    before === "overview" &&
                        up &&
                        got.selected === "initiative" &&
                        got.focusIn === true &&
                        got.title === TITLE &&
                        got.progress === "1/7" &&
                        /^On 2 ·\s*Draw the tab/.test(got.on) &&
                        got.onState === "ready" &&
                        /Mark done/.test(got.markDone ?? "") &&
                        got.rows.map((r) => r.kind).join() === "done,mine,next,next,other" &&
                        labels(got.rows) === [C.spec, C.draw, C.keys, C.docs, C.other].join(" | ") &&
                        got.rows[0].struck === true &&
                        got.rows.filter((r) => r.workOn).map((r) => r.label).join() === [C.keys, C.docs].join() &&
                        got.rows[4].tag.includes(NAME_B) &&
                        got.allText.includes("All chunks (7)") &&
                        got.chunks?.open === true &&
                        got.plan?.open === true &&
                        /Plan to review\s*3/.test(got.plan.head) &&
                        got.planRows.join() === "proposed,proposed,proposed" &&
                        got.tabDot === true &&
                        got.tabDotAsking === true &&
                        got.note?.head.startsWith("Latest note on 2") &&
                        got.noteText === NOTE &&
                        got.addNote &&
                        got.openJarvis,
                    { before, up, got }
                );
            });

            // 2. m marks the agent's chunk done and carries it on
            await run("2. m marks done", async (name) => {
                await openTab();
                const before = await read();
                await press(h, "m", 500);
                const done = await until(async () => {
                    const st = await chunkState(h, ctx.main);
                    return st[C.draw]?.status === "done" && st[C.keys]?.status === "active" && st[C.keys].holders.includes(refA);
                }, WAIT_MS);
                await polishWaitFor(h, `${FLAT}(${IN(A)}?.querySelector("[data-rail-initiative-progress]")) === "2/7"`, SHORT_MS);
                await polishNap(400);
                const got = await read();
                await shot("2-marked-done");
                rec(
                    `${name}: with the keyboard in the tab, m marks "${C.draw}" done and carries the agent to "${C.keys}": the head reads "2/7" and "On 3 ${C.keys}", and the row of "${C.draw}" is struck`,
                    before.progress === "1/7" &&
                        done &&
                        got.progress === "2/7" &&
                        /^On 3 ·\s*Wire the tab keys/.test(got.on) &&
                        got.rows.find((r) => r.label === C.draw)?.struck === true &&
                        got.rows.find((r) => r.kind === "mine")?.label === C.keys,
                    { before: before.progress, done, progress: got.progress, on: got.on, rows: got.rows.map((r) => `${r.kind}:${r.label}`) }
                );
            });

            // 3. n adds a note
            await run("3. n adds a note", async (name) => {
                await openTab();
                await press(h, "n", 400);
                const inputExpr = `${IN(A)}?.querySelector('input[aria-label^="Add a note to"]')`;
                const inputUp = await polishWaitFor(h, `!!${inputExpr}`, SHORT_MS);
                await h.cdp("Input.insertText", { text: NOTE2 });
                await polishNap(200);
                await press(h, "Enter", 500);
                const noted = await until(async () => (await chunkState(h, ctx.main))[C.keys]?.notes.includes(NOTE2), WAIT_MS);
                const shown = await polishWaitFor(h, `${FLAT}(${IN(A)}?.querySelector("[data-rail-initiative-note]")) === ${JSON.stringify(NOTE2)}`, SHORT_MS);
                await polishNap(300);
                const got = await read();
                await shot("3-note");
                rec(
                    `${name}: n opens the Add note input on the chunk the agent is on, the typed text and Enter append it to that chunk, Latest note shows it, the input closes and the keyboard is back in the tab`,
                    inputUp && noted && shown && got.focusIn === true && !(await h.ev(`!!${inputExpr}`)),
                    { inputUp, noted, shown, focusIn: got.focusIn, note: got.noteText }
                );
            });

            // 3b. All chunks unfolds the whole plan (it stays open for the steps that follow: a chunk the window no longer lists
            // is reached through it)
            await run("3b. All chunks", async (name) => {
                await openTab();
                const closedBefore = !(await h.ev(`!!${IN(A)}?.querySelector("[data-rail-initiative-all-list]")`));
                const opened = await ensureAll();
                await polishNap(400);
                const all = await read();
                await shot("3b-all-chunks");
                rec(
                    `${name}: a click on "All chunks (7)" unfolds the full list: the 7 chunks in plan order (the window's rows keeping their kinds), none of them a proposed one`,
                    closedBefore &&
                        opened &&
                        all.allText.includes("All chunks (7)") &&
                        all.allRows.length === 7 &&
                        labels(all.allRows) === [C.spec, C.draw, C.keys, C.docs, C.other, C.free1, C.free2].join(" | "),
                    { closedBefore, opened, allText: all.allText, rows: all.allRows.map((r) => `${r.kind}:${r.label}`) }
                );
            });

            // 4. w switches the agent's chunk; with a draft in the box the line waits for the person's message
            await run("4. w switches, the line waits", async (name) => {
                await setBox(DRAFT);
                await openTab();
                await ensureAll();
                const onCursor = await cursorTo(C.docs);
                await press(h, "w", 500);
                const moved = await until(async () => {
                    const st = await chunkState(h, ctx.main);
                    return st[C.docs]?.status === "active" && st[C.docs].holders.includes(refA) && st[C.keys]?.status === "pending" && !st[C.keys].holders.includes(refA);
                }, WAIT_MS);
                const onRow = await polishWaitFor(h, `${FLAT}(${IN(A)}?.querySelector("[data-rail-initiative-on]")).includes(${JSON.stringify(C.docs)})`, SHORT_MS);
                const lineUp = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`, SHORT_MS);
                await polishNap(500);
                const lineText = await h.ev(`${FLAT}(${layerOf(A)}?.querySelector("[data-chat-switch-line]"))`);
                const queued1 = await switchLines();
                await shot("4-waiting-line");
                // ✕ drops it, and only it
                const dropClicked = await click(h, `${layerOf(A)}?.querySelector("[data-chat-switch-drop]")`);
                const lineGone = await polishWaitFor(h, `!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`, SHORT_MS);
                const dropped = (await switchLines()).length === 0;
                // another w (keys again): one line waits; a third switch, by the button, replaces it
                await focusPane();
                const onKeys = await cursorTo(C.keys);
                await press(h, "w", 500);
                const movedAgain = await until(async () => (await chunkState(h, ctx.main))[C.keys]?.holders.includes(refA) === true, WAIT_MS);
                const queued2 = await switchLines();
                const clicked3 = await click(h, workOnBtn(C.free1));
                const movedThird = await until(async () => (await chunkState(h, ctx.main))[C.free1]?.holders.includes(refA) === true, WAIT_MS);
                const queued3 = await switchLines();
                // a message: the line goes in front of it and leaves the queue; the bubble is the person's own text
                await setBox("");
                await typeInBox(MESSAGE);
                await enterInBox();
                const bubble = await polishWaitFor(h, `${pendingBubbles(A)}.includes(${JSON.stringify(MESSAGE)})`, SHORT_MS);
                const keyAfter = await pendingLines();
                const sentOk = await until(async () => (await typedInputs()).some((t) => t.includes(MESSAGE)), SHORT_MS);
                const typed = (await typedInputs()).find((t) => t.includes(MESSAGE)) ?? "";
                const bubbleTexts = await h.ev(pendingBubbles(A));
                // the transcript line Claude Code writes for it, with the line in front: the conversation draws only the text
                append(AC.userText(typed, ts(0)));
                const youShown = await polishWaitFor(h, `${youBubbles(A)}.some((t) => t.includes(${JSON.stringify(MESSAGE)}))`, WAIT_MS);
                const youTexts = await h.ev(youBubbles(A));
                await polishNap(400);
                await shot("4-sent");
                rec(
                    `${name}: with a draft in the box, w on "${C.docs}" makes it active with the agent and "${C.keys}" pending without it, the head reads it and [data-chat-switch-line] waits with one initiative: switched line queued; its ✕ drops the line; w again and a third switch (the row's Work on this button) leave still one line; a message takes the line out of the queue, it goes in front of the typed text, and the bubble shows the text without it`,
                    onCursor &&
                        moved &&
                        onRow &&
                        lineUp &&
                        /Switched to chunk 4 Write the tab docs\. The agent is told with your next message/.test(lineText) &&
                        queued1.length === 1 &&
                        queued1[0].startsWith(`initiative: switched you to chunk 4 ${C.docs}`) &&
                        dropClicked &&
                        lineGone &&
                        dropped &&
                        onKeys &&
                        movedAgain &&
                        queued2.length === 1 &&
                        queued2[0].startsWith(`initiative: switched you to chunk 3 ${C.keys}`) &&
                        clicked3 &&
                        movedThird &&
                        queued3.length === 1 &&
                        queued3[0].startsWith(`initiative: switched you to chunk 6 ${C.free1}`) &&
                        bubble &&
                        keyAfter.length === 0 &&
                        sentOk &&
                        typed.indexOf("initiative: switched you to chunk 6") >= 0 &&
                        typed.indexOf("initiative: switched you to chunk 6") < typed.indexOf(MESSAGE) &&
                        bubbleTexts.includes(MESSAGE) &&
                        !bubbleTexts.some((t) => (t ?? "").includes("initiative:")) &&
                        youShown &&
                        !youTexts.some((t) => t.includes("initiative: switched")),
                    { onCursor, moved, onRow, lineUp, lineText, queued1, dropClicked, lineGone, dropped, onKeys, movedAgain, queued2, clicked3, movedThird, queued3, bubble, keyAfter, sentOk, typed, bubbleTexts, youShown, youTexts }
                );
            });

            // 5. a failed switch leaves the agent where it was and says why in the tab
            await run("5. failed switch", async (name) => {
                await setBox("");
                await openTab();
                await ensureAll();
                await h.ev(`window.__initiativeSwitchFail = ${JSON.stringify(FAIL)}`);
                try {
                    const before = await chunkState(h, ctx.main);
                    const clicked = await click(h, workOnBtn(C.docs));
                    const shown = await polishWaitFor(h, `${FLAT}(${IN(A)}?.querySelector("[data-rail-initiative-error]")).includes(${JSON.stringify(FAIL)})`, SHORT_MS);
                    // the rollback runs for real, so read the store once it has
                    await polishNap(800);
                    const st = await chunkState(h, ctx.main);
                    const lineShown = await h.ev(`!!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`);
                    const queued = await switchLines();
                    await shot("5-failed-switch");
                    rec(
                        `${name}: with window.__initiativeSwitchFail set, Work on "${C.docs}" leaves the agent on "${C.free1}" (active, its workref kept; "${C.docs}" has none), [data-rail-initiative-error] shows the message, and no waiting line appears`,
                        clicked &&
                            shown &&
                            st[C.free1]?.status === "active" &&
                            st[C.free1].holders.includes(refA) &&
                            !st[C.docs]?.holders.includes(refA) &&
                            JSON.stringify(st[C.docs]) === JSON.stringify(before[C.docs]) &&
                            !lineShown &&
                            queued.length === 0,
                        { clicked, shown, st: { free1: st[C.free1], docs: st[C.docs] }, lineShown, queued }
                    );
                } finally {
                    await h.ev(`delete window.__initiativeSwitchFail`);
                }
            });

            // 6. an empty box: Work on this tells the agent at once
            await run("6. told at once", async (name) => {
                await setBox("");
                await takePending();
                await openTab();
                await ensureAll();
                const before = (await typedInputs()).length;
                const clicked = await click(h, workOnBtn(C.docs));
                const sent = await until(async () => (await typedInputs()).slice(before).some((t) => t.includes(SWITCH_NOTE)), SHORT_MS);
                const typed = (await typedInputs()).slice(before).find((t) => t.includes(SWITCH_NOTE)) ?? "";
                const lineShown = await h.ev(`!!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`);
                const queued = await pendingLines();
                // the transcript line Claude Code writes for it: Chat draws a divider and arcterm's row, no bubble of yours
                append(AC.userText(typed, ts(0)), AC.assistantText("On the docs now.", ts(500)));
                const drawn = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-chunk-divider="4"]') && !!${layerOf(A)}?.querySelector('[data-chat-switch-note="4"]')`, WAIT_MS);
                const youTexts = await h.ev(youBubbles(A));
                const noteText = await h.ev(`${FLAT}(${layerOf(A)}?.querySelector("[data-chat-switch-note]"))`);
                await polishNap(400);
                await shot("6-told-at-once");
                rec(
                    `${name}: with an empty box, Work on "${C.docs}" types the switched line in front of "${SWITCH_NOTE}" at once, no waiting line shows and none stays queued; once the transcript holds it, Chat draws [data-chat-chunk-divider="4"] and the "Moved to chunk 4 · sent by arcterm" row, and no bubble of yours reads "${SWITCH_NOTE}"`,
                    clicked &&
                        sent &&
                        typed.indexOf(`initiative: switched you to chunk 4 ${C.docs}`) >= 0 &&
                        typed.indexOf("initiative: switched") < typed.indexOf(SWITCH_NOTE) &&
                        !lineShown &&
                        queued.length === 0 &&
                        drawn &&
                        noteText === "Moved to chunk 4 · sent by arcterm" &&
                        !youTexts.some((t) => t.includes(SWITCH_NOTE)),
                    { clicked, sent, typed, lineShown, queued, drawn, noteText, youTexts }
                );
            });

            // 7. the status menu and a rename, on a row of the full list
            await run("7. status menu, rename", async (name) => {
                await openTab();
                const allUp = await ensureAll();
                await polishNap(400);
                // a row of the full list: its status menu sets it blocked. The click goes on the title: on the cursor's row
                // Work on this sits on a line under it, where a click in the middle of the row would land
                const menuClicked = await click(h, `${IN(A)}?.querySelector('[data-rail-initiative-all-list] [data-rail-initiative-row="${C.free2}"] [data-rail-initiative-label]')`);
                const menuUp = await polishWaitFor(h, `!!${IN(A)}?.querySelector("[data-rail-initiative-menu]")`, SHORT_MS);
                const items = await h.ev(`[...(${IN(A)}?.querySelectorAll("[data-rail-initiative-menu] [data-menu-item]") ?? [])].map((i) => i.dataset.menuItem)`);
                await shot("7-status-menu");
                const blockedClicked = await click(h, `${IN(A)}?.querySelector('[data-rail-initiative-menu] [data-menu-item="blocked"]')`);
                const blocked = await until(async () => (await chunkState(h, ctx.main))[C.free2]?.status === "blocked", WAIT_MS);
                // and the same chunk renamed through the menu's last row
                await polishWaitFor(h, `!${IN(A)}?.querySelector("[data-rail-initiative-menu]")`, SHORT_MS);
                await click(h, `${IN(A)}?.querySelector('[data-rail-initiative-all-list] [data-rail-initiative-row="${C.free2}"] [data-rail-initiative-label]')`);
                await polishWaitFor(h, `!!${IN(A)}?.querySelector("[data-rail-initiative-menu]")`, SHORT_MS);
                await click(h, `${IN(A)}?.querySelector('[data-rail-initiative-menu] [data-menu-item="rename"]')`);
                const inputExpr = `${IN(A)}?.querySelector('input[aria-label="Rename ${C.free2}"]')`;
                const inputUp = await polishWaitFor(h, `!!${inputExpr}`, SHORT_MS);
                await h.ev(`(${inputExpr})?.select()`);
                await h.cdp("Input.insertText", { text: RENAMED });
                await polishNap(200);
                await press(h, "Enter", 500);
                const renamed = await until(async () => Object.keys(await chunkState(h, ctx.main)).includes(RENAMED), WAIT_MS);
                const shown = await polishWaitFor(h, `!!${IN(A)}?.querySelector('[data-rail-initiative-all-list] [data-rail-initiative-row="${RENAMED}"]')`, SHORT_MS);
                const after = await read();
                await shot("7-renamed");
                rec(
                    `${name}: a click on a row of the full list opens its status menu (pending, active, blocked, deferred, skipped, rename), Blocked sets the chunk's status, and Rename edits its title in place: "${C.free2}" becomes "${RENAMED}" in the store and in the list; the keyboard is back in the tab`,
                    allUp &&
                        menuClicked &&
                        menuUp &&
                        items.join() === "pending,active,blocked,deferred,skipped,rename" &&
                        blockedClicked &&
                        blocked &&
                        inputUp &&
                        renamed &&
                        shown &&
                        after.focusIn === true,
                    { allUp, menuClicked, menuUp, items, blocked, inputUp, renamed, shown, focusIn: after.focusIn }
                );
            });

            // 8. Plan to review: Accept on a proposed row
            await run("8. Plan to review accepts", async (name) => {
                await openTab();
                const before = await read();
                const acted = await planAct(PROPOSED[0], "Accept");
                const accepted = await until(async () => (await chunkState(h, ctx.main))[PROPOSED[0]]?.status !== "proposed", WAIT_MS);
                await polishWaitFor(h, `${IN(A)}?.querySelectorAll('[data-plan-row="accepted"]').length === 1`, SHORT_MS);
                await polishNap(400);
                const got = await read();
                // the section's count and the tab's dot follow what is still proposed once the page reads it again
                await refreshEffort(h, ctx.main);
                await polishNap(300);
                const later = await read();
                await shot("8-plan-accepted");
                rec(
                    `${name}: Accept on a proposed row of Plan to review (the row's buttons show under the pointer) accepts that chunk in the store, the row stays as accepted for Undo, and the section keeps its other two rows to decide; the tab's dot is still there while two wait`,
                    before.planRows.length === 3 &&
                        acted &&
                        accepted &&
                        got.planRows.join() === "accepted,proposed,proposed" &&
                        later.tabDot === true &&
                        /Plan to review\s*2/.test(later.plan?.head ?? ""),
                    { before: before.planRows, acted, accepted, planRows: got.planRows, tabDot: later.tabDot, planHead: later.plan?.head }
                );
            });

            // 9. folding Chunks hides its rows
            await run("9. fold Chunks", async (name) => {
                await openTab();
                const clicked = await click(h, `${sectionOf("initiative-chunks")}?.querySelector("h3 button")`);
                await polishNap(400);
                const got = await read();
                await shot("9-chunks-folded");
                rec(
                    `${name}: a click on the Chunks header folds the section (no row of it in the page; Plan to review and the latest note stay)`,
                    clicked && got.chunks?.open === false && got.rows.length === 0 && got.plan?.open === true && got.note != null,
                    { clicked, chunks: got.chunks, rows: got.rows.length, plan: got.plan?.open }
                );
            });

            // 10. i again: back to the tab before it, the keyboard to the message box
            await run("10. i goes back", async (name) => {
                await openTab();
                await press(h, "i", 600);
                const back = await polishWaitFor(h, `(${SELECTED}) === "overview"`, SHORT_MS);
                const focus = await h.ev(`(() => { const a = document.activeElement; return { box: a?.hasAttribute?.("data-chat-input") === true, pane: !!${IN(A)}?.contains(a) }; })()`);
                rec(`${name}: with the keyboard in the tab, i selects the tab it came from (Overview) and gives the keyboard to the message box`, back && focus.box === true, { back, focus });
            });

            // 11. the header's ◇ chip
            await run("11. the ◇ chip", async (name) => {
                const chipText = await h.ev(`${FLAT}(${LINK_CHIP})`);
                const clicked = await click(h, LINK_CHIP);
                const up = await polishWaitFor(h, `(${SELECTED}) === "initiative" && !!${IN(A)}`, SHORT_MS);
                await polishNap(400);
                const got = await read();
                const focused = await focusedAgent(h);
                // a second click leaves it open (the chip opens, `i` toggles)
                await click(h, LINK_CHIP);
                await polishNap(300);
                const still = await h.ev(SELECTED);
                await shot("11-chip");
                rec(
                    `${name}: a click on the header's ◇ chip ("${TITLE} · done/total") focuses the agent's cell, shows the rail and selects the Initiative tab with the keyboard in it; a second click leaves it open`,
                    clicked && /· \d+\/\d+$/.test(chipText) && chipText.includes(TITLE) && up && got.selected === "initiative" && got.focusIn === true && focused === A && still === "initiative" && (await railOpen(h)) === true,
                    { chipText, clicked, up, selected: got.selected, focusIn: got.focusIn, focused, still }
                );
            });

            // 12. the "N to review" chip with the rail hidden: Plan to review unfolded and in view
            await run("12. N to review", async (name) => {
                await openTab();
                // Plan to review folded, the rail hidden and on another tab: the chip has to bring all of it back
                await click(h, `${sectionOf("initiative-plan")}?.querySelector("h3 button")`);
                await polishNap(300);
                const folded = (await read()).plan?.open === false;
                await selectTab(h, "overview");
                await setRail(h, false);
                await polishNap(500);
                const hidden = (await railOpen(h)) === false;
                const chipText = await h.ev(`${FLAT}(document.querySelector("[data-agent-header] [data-plan-review-chip]"))`);
                const clicked = await click(h, `document.querySelector("[data-agent-header] [data-plan-review-chip]")`);
                const up = await polishWaitFor(h, `${IN(A)}?.querySelector('[data-rail-initiative-section="initiative-plan"] section[data-rail-section]')?.getAttribute("data-open") === "true"`, WAIT_MS);
                await polishNap(600);
                const got = await read();
                const view = await h.ev(`(() => {
                    const plan = ${IN(A)}?.querySelector('[data-rail-initiative-section="initiative-plan"]');
                    const sc = ${IN(A)}?.querySelector("[data-rail-initiative-scroll]");
                    if (!plan || !sc) return null;
                    const r = plan.getBoundingClientRect();
                    const b = sc.getBoundingClientRect();
                    return r.height > 0 && r.top >= b.top - 2 && r.top < b.bottom;
                })()`);
                await shot("12-n-to-review");
                rec(
                    `${name}: with the rail hidden, on Overview and Plan to review folded, a click on the header's "2 to review" chip shows the rail on the Initiative tab with Plan to review unfolded and in view, the keyboard in the tab`,
                    folded && hidden && chipText === "2 to review" && clicked && up && got.selected === "initiative" && (await railOpen(h)) === true && got.focusIn === true && view === true,
                    { folded, hidden, chipText, clicked, up, selected: got.selected, focusIn: got.focusIn, view }
                );
            });

            // 13. Terminal view: the chip and i open and close the tab there too
            await run("13. Terminal view", async (name) => {
                await setMode(h, A, "terminal");
                await polishWaitFor(h, `(() => { const p = document.querySelector('[data-agent-terminal="${A}"]'); return p != null && !p.classList.contains("hidden"); })()`, SHORT_MS);
                await polishNap(600);
                await selectTab(h, "overview");
                const chipClicked = await click(h, LINK_CHIP);
                const viaChip = await polishWaitFor(h, `(${SELECTED}) === "initiative" && !!${IN(A)}`, SHORT_MS);
                await polishNap(300);
                await shot("13-terminal-chip");
                // i with the keyboard in the tab goes back; i from the surface opens it again
                await press(h, "i", 500);
                const closed = await polishWaitFor(h, `(${SELECTED}) === "overview"`, SHORT_MS);
                await focusSurface(h);
                await press(h, "i", 600);
                const reopened = await polishWaitFor(h, `(${SELECTED}) === "initiative" && !!${IN(A)}`, SHORT_MS);
                const got = await read();
                rec(
                    `${name}: with the agent in Terminal view a click on the ◇ chip selects the Initiative tab, i (the keyboard in the tab) goes back to Overview, and i from the surface opens the tab again`,
                    chipClicked && viaChip && closed && reopened && got.focusIn === true,
                    { chipClicked, viaChip, closed, reopened, focusIn: got.focusIn }
                );
                await setMode(h, A, "chat");
                await polishWaitFor(h, `!!${layerOf(A)} && ${layerOf(A)}.getBoundingClientRect().width > 0`, WAIT_MS);
            });

            // 14. an agent on no chunk: Pick a chunk…
            await run("14. no chunk", async (name) => {
                const oid = await makeEffort("Rail: no chunk for the agent", [{ label: "No chunk one" }, { label: "No chunk two" }, { label: "No chunk three" }]);
                const up = await link(oid, "Rail: no chunk for the agent");
                await refreshEffort(h, oid);
                await openTab();
                await polishWaitFor(h, `${IN(A)}?.querySelector("[data-rail-initiative-on]")?.getAttribute("data-rail-initiative-state") === "no-chunk"`, WAIT_MS);
                await polishNap(300);
                const none = await read();
                await shot("14-no-chunk");
                const picked = await click(h, `${IN(A)}?.querySelector("[data-rail-initiative-pick]")`);
                await polishNap(500);
                const cursor = await cursorLabel();
                const focus = await h.ev(`!!${IN(A)}?.contains(document.activeElement)`);
                await shot("14-pick");
                // an initiative whose chunks all have holders or are settled: nothing to pick
                const oid2 = await makeEffort("Rail: nothing to pick", [
                    { label: "Held by the other", status: "active", hold: "B" },
                    { label: "Already done", status: "done" },
                    { label: "Skipped one", status: "skipped" },
                ]);
                await link(oid2, "Rail: nothing to pick");
                await refreshEffort(h, oid2);
                await polishWaitFor(h, `${IN(A)}?.querySelector("[data-rail-initiative-on]")?.getAttribute("data-rail-initiative-state") === "no-chunk"`, WAIT_MS);
                await polishNap(300);
                const nothing = await read();
                rec(
                    `${name}: on no chunk the head reads "No chunk for this agent" with Pick a chunk… and no Mark done; Pick a chunk… puts the cursor on the first row that offers Work on this ("No chunk one", the keyboard in the tab); where no chunk offers it there is no Pick a chunk…`,
                    up &&
                        none.onState === "no-chunk" &&
                        /No chunk for this agent/.test(none.on) &&
                        /Pick a chunk/.test(none.pick ?? "") &&
                        none.markDone == null &&
                        picked &&
                        cursor === "No chunk one" &&
                        focus &&
                        /No chunk for this agent/.test(nothing.on) &&
                        nothing.pick == null &&
                        nothing.markDone == null,
                    { up, none: { state: none.onState, on: none.on, pick: none.pick, markDone: none.markDone }, picked, cursor, focus, nothing: { on: nothing.on, pick: nothing.pick } }
                );
            });

            // 15. a failed read: the error line and its Retry
            await run("15. failed read and Retry", async (name) => {
                // an initiative nothing has read yet, so the tab has to: the read fails until the flag is cleared
                const oid = await makeEffort("Rail: the read that fails", [{ label: "Read one" }, { label: "Read two" }]);
                await h.ev(`window.__railReadFail = ${JSON.stringify(READ_FAIL)}`);
                try {
                    await setA({ effortId: oid });
                    await polishNap(300);
                    await selectTab(h, "overview");
                    await focusSurface(h);
                    await pressAlt(h, "i", 600);
                    const errorUp = await polishWaitFor(h, `!!${IN(A)}?.querySelector('[data-rail-initiative-state="error"]')`, WAIT_MS);
                    await polishNap(300);
                    const err = await read();
                    await shot("15-read-error");
                    // the flag goes and Retry is clicked in one evaluation, so no read of the page's own lands between
                    const retried = await h.ev(`(() => {
                        window.__railReadFail = "";
                        const b = ${IN(A)}?.querySelector("[data-rail-initiative-retry]");
                        if (!b) return false;
                        b.click();
                        return true;
                    })()`);
                    const loaded = await polishWaitFor(h, `!${IN(A)}?.querySelector('[data-rail-initiative-state="error"]') && ${FLAT}(${IN(A)}?.querySelector("[data-rail-initiative-title]")) === "Rail: the read that fails"`, WAIT_MS);
                    await polishNap(300);
                    const ok = await read();
                    await shot("15-retried");
                    rec(
                        `${name}: when the initiative cannot be read the tab says "This initiative could not be read." with the message and a Retry; once the read works again, Retry loads it (its title and chunks show)`,
                        errorUp &&
                            /This initiative could not be read\./.test(err.errorState) &&
                            err.errorState.includes(READ_FAIL) &&
                            err.retry === true &&
                            retried &&
                            loaded &&
                            ok.title === "Rail: the read that fails" &&
                            ok.rows.length > 0,
                        { errorUp, errorState: err.errorState, retry: err.retry, retried, loaded, title: ok.title, rows: ok.rows.length }
                    );
                } finally {
                    await h.ev(`delete window.__railReadFail`);
                }
            });

            // 16. the chunk chips the box offers: done: on a held chunk after a commit, go on with: on a finished one
            await run("16. chunk chips", async (name) => {
                const chipOf = (kind) => `${layerOf(A)}?.querySelector('[data-chat-suggest-kind="${kind}"]')`;
                const chipKinds = () => h.ev(`[...(${layerOf(A)}?.querySelectorAll("[data-chat-suggest-chip]") ?? [])].map((b) => b.getAttribute("data-chat-suggest-kind"))`);
                const X = ["Build the chips", "Run the scenario", "Ship the chips"];
                // a. a committed turn on a held chunk offers done:; its click marks it done and carries the agent on
                const oidA = await makeEffort("Rail: chips on a held chunk", [{ label: X[0], status: "active", hold: "A" }, { label: X[1] }, { label: X[2] }]);
                await takePending();
                // the turn ended after the agent took the chunk, so the chunk is that turn's work
                append(AC.userText("commit it", ts(0)), AC.assistantText("Committed 1a2b3c4: the chips' first cut.", ts(500)));
                await setA({ effortId: oidA, committed: true, idleSince: Date.now() });
                const doneChip = await polishWaitFor(h, `${FLAT}(${chipOf("done")}).startsWith(${JSON.stringify(`done: ${X[0]}`)})`, WAIT_MS);
                await polishNap(400);
                const kindsBefore = await chipKinds();
                await shot("16-chip-done");
                const clickedDone = await click(h, chipOf("done"));
                const carried = await until(async () => {
                    const st = await chunkState(h, oidA);
                    return st[X[0]]?.status === "done" && st[X[1]]?.status === "active" && st[X[1]].holders.includes(refA);
                }, WAIT_MS);
                await openTab();
                const onRow = await polishWaitFor(h, `${FLAT}(${IN(A)}?.querySelector("[data-rail-initiative-on]")).includes(${JSON.stringify(X[1])})`, SHORT_MS);
                // the chip belongs to the turn: none for the chunk the agent was just carried to, now or a moment later
                await polishNap(700);
                const kindsAfter = await chipKinds();

                // b. an agent that holds only done chunks is offered go on with:, whose click switches and sends
                await setA({ committed: false });
                const Y = ["Spec the chips", "Draw the chips", "Test the chips"];
                const oidB = await makeEffort("Rail: chips on a finished chunk", [{ label: Y[0], status: "done", hold: "A" }, { label: Y[1] }, { label: Y[2] }]);
                await takePending();
                const before = (await typedInputs()).length;
                append(AC.userText("finish the spec", ts(1000)), AC.assistantText("The spec for the chips is done.", ts(1500)));
                await setA({ effortId: oidB, idleSince: Date.now() });
                const nextChip = await polishWaitFor(h, `${FLAT}(${chipOf("next")}).startsWith(${JSON.stringify(`go on with: ${Y[1]}`)})`, WAIT_MS);
                await polishNap(400);
                const kindsGoOn = await chipKinds();
                await shot("16-chip-go-on");
                const clickedNext = await click(h, chipOf("next"));
                const switched = await until(async () => {
                    const st = await chunkState(h, oidB);
                    return st[Y[1]]?.status === "active" && st[Y[1]].holders.includes(refA);
                }, WAIT_MS);
                const sent = await until(async () => (await typedInputs()).slice(before).some((t) => t.includes(`go on with: ${Y[1]}`)), WAIT_MS);
                const typed = (await typedInputs()).slice(before).find((t) => t.includes(`go on with: ${Y[1]}`)) ?? "";
                const bubbleTexts = await h.ev(pendingBubbles(A));
                const lineNow = await h.ev(`!!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`);
                const queued = await switchLines();
                await polishNap(400);
                await shot("16-chip-go-on-sent");
                rec(
                    `${name}: a committed turn on a held chunk offers [data-chat-suggest-kind="done"] "done: ${X[0]}"; its click marks it done and carries the agent to "${X[1]}" (the tab's head reads it, no done: chip for it); an agent holding only done chunks is offered "go on with: ${Y[1]}", whose click makes it active with the agent and sends the text with the switched line in front, the waiting line never staying`,
                    doneChip &&
                        kindsBefore.includes("done") &&
                        clickedDone &&
                        carried &&
                        onRow &&
                        !kindsAfter.includes("done") &&
                        nextChip &&
                        kindsGoOn.join() === "next" &&
                        clickedNext &&
                        switched &&
                        sent &&
                        typed.indexOf(`initiative: switched you to chunk 2 ${Y[1]}`) >= 0 &&
                        typed.indexOf(`initiative: switched you to chunk 2 ${Y[1]}`) < typed.indexOf(`go on with: ${Y[1]}`) &&
                        bubbleTexts.includes(`go on with: ${Y[1]}`) &&
                        !lineNow &&
                        queued.length === 0,
                    { doneChip, kindsBefore, clickedDone, carried, onRow, kindsAfter, nextChip, kindsGoOn, clickedNext, switched, sent, typed, bubbleTexts, lineNow, queued }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = stepper("rail-initiative-tab");
            await step("remove the probes", () => h.ev(`(() => { delete window.__initiativeSwitchFail; delete window.__railReadFail; delete window.__chatSuggestFake; return true; })()`));
            if (ctx.tabA != null) {
                await step("put the view and the waiting lines back", () =>
                    page(
                        h,
                        `const S = await mod("app/view/agents/chatinitiativestore.ts");
                        const M = await mod("app/view/agents/chatmodestore.ts");
                        for (const id of ${JSON.stringify([ctx.tabA.tabId, ctx.tabB?.tabId].filter(Boolean))}) { S.takeResultLines(id); M.setChatMode(id, "chat"); }
                        return true;`
                    )
                );
                await step("remove the input mock", () =>
                    page(
                        h,
                        `const m = window.${MOCK_KEY};
                        if (m) { m.api.setMockRpcClient(m.prev); delete window.${MOCK_KEY}; }
                        return true;`
                    )
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            for (const oid of ctx.oids ?? []) await step(`delete ${oid}`, () => h.rpc("effortdelete", { effortoid: oid }));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
            await step("restore the keys", () => restoreKeys(h, ctx));
            await step("reload onto the live roster", () => ahReload(h));
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    // the roster rows: the main agent (`patch` is the state under test: its initiative, its turn) and the one holding a chunk
    // of its own
    function initiativeRoster(ctx, patch = {}) {
        return [
            rosterRow(ctx, PROJECT_IN, ctx.tabA, NAME_A, ctx.transcriptA, patch),
            rosterRow(ctx, PROJECT_IN, ctx.tabB, NAME_B, ctx.transcriptB, { usage: { contextpct: 12 } }),
        ];
    }

    // =========================================================================================================================
    // rail-tabs-split
    // =========================================================================================================================

    const NAMES_SP = { a: "split bs a", b: "split council b", c: "split plain c", d: "split plain d" };
    const PROJECT_SP = "verify-rail-split";
    const TOPIC_SPA = "split-a";
    const TOPIC_SPB = "split-b";
    const SESSION = "fx-rail-split-session";
    const COUNCIL = "fx-council-rail-split";
    const TITLE_SPA = "Split: the A initiative";
    const TITLE_SPB = "Split: the B initiative";
    const SPLIT_WIDTH = 1900;
    const VERIFY_SCENARIO = "chat-council-card";
    const VERIFY_CONFIG = { watch: ["frontend/**/*.tsx"], rerun: "task verify:ui -- <name>" };

    const splitTabs = {
        name: "rail-tabs-split",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-rts-")), cwd: mkdtempSync(join(tmpdir(), "verify-rts-project-")), oids: [], councilCtx: null };
            let at = "reading the keys";
            try {
                await saveKeys(h, ctx);
                at = "making the project";
                makeProject(ctx, "rail split");
                mkdirSync(join(ctx.cwd, ".arc"), { recursive: true });
                mkdirSync(join(ctx.cwd, "frontend"), { recursive: true });
                writeFileSync(join(ctx.cwd, ".arc", "verify.json"), JSON.stringify(VERIFY_CONFIG));
                writeFileSync(join(ctx.cwd, "frontend", "x.tsx"), "export const x = 0;\n");
                ctx.files = {
                    a: join(ctx.cwd, ".superpowers", "brainstorm", TOPIC_SPA, "brainstorm.json"),
                    b: join(ctx.cwd, ".superpowers", "brainstorm", TOPIC_SPB, "brainstorm.json"),
                };
                makeCanvas(ctx, TOPIC_SPA, [...BOARDS, OPEN_BOARD]);
                makeCanvas(ctx, TOPIC_SPB, [...BOARDS, OPEN_BOARD]);
                await h.rpc("createproject", { name: PROJECT_SP, path: ctx.cwd });
                ctx.project = PROJECT_SP;
                await waitForProjectInConfig(h, PROJECT_SP);
                at = "writing the transcripts";
                ctx.transcripts = writeTranscripts(ctx, "split", ["a", "b", "c", "d"]);
                at = "presetting the seen board names";
                const M = (topic) => page(h, `const M = await mod("app/view/agents/brainstormmodel.ts"); return M.brainstormFilePath(${JSON.stringify(ctx.cwd)}, ${JSON.stringify(topic)});`);
                const pa = await M(TOPIC_SPA);
                const pb = await M(TOPIC_SPB);
                // the first agent's brainstorm has one board it has not seen, the second has seen them all
                await h.ev(`localStorage.setItem(${JSON.stringify(SEEN_KEY)}, ${JSON.stringify(JSON.stringify({ [pa]: { names: [BOARDS[0], BOARDS[1], OPEN_BOARD], at: Date.now() }, [pb]: { names: [...BOARDS, OPEN_BOARD], at: Date.now() } }))})`);
                if (typeof bsSeeHints === "function") await bsSeeHints(h);
                at = "writing the council";
                // the second agent started it: the council names that agent's session. It is read when the page loads
                ctx.dataDir = (await h.rpc("waveinfo", null)).datadir;
                ctx.councilCtx = { dataDir: ctx.dataDir, repo: ctx.cwd, written: {} };
                writeCouncil(ctx.councilCtx, "round2", { id: COUNCIL, edit: (c) => (c.sessionid = SESSION) });
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "widening the window";
                // four cells, a rail and a tree: a cell's header keeps its ◇ chip's title and count only from 480px
                ctx.viewport = await h.ev("({ width: window.innerWidth, height: window.innerHeight })");
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: SPLIT_WIDTH, height: ctx.viewport.height, deviceScaleFactor: 1, mobile: false });
                await polishNap(700);
                at = "making the tabs";
                // a shell controller in the project, so a brainstorm attaches to the tab and a Verify run reads its folder
                const blockMeta = { view: "term", controller: "shell", "cmd:cwd": ctx.cwd };
                ctx.tabs = {};
                for (const k of ["a", "b", "c", "d"]) ctx.tabs[k] = await makeTab(h, ctx, { label: NAMES_SP[k], blockMeta });
                at = "making the initiatives";
                for (const [k, title] of [["a", TITLE_SPA], ["b", TITLE_SPB]]) {
                    const made = await h.rpc("effortcreate", { title, project: PROJECT_SP, chunks: [{ label: `${k} one` }, { label: `${k} two` }, { label: `${k} three` }] });
                    ctx[`oid${k}`] = made.effortoid;
                    ctx.oids.push(made.effortoid);
                    await mutate(h, made.effortoid, [
                        { op: "setChunkStatus", chunk: `${k} one`, status: "done" },
                        { op: "setChunkStatus", chunk: `${k} two`, status: "active" },
                        { op: "attachWork", chunk: `${k} two`, kind: "agent", oref: `agent:${ctx.tabs[k].tabId}` },
                    ]);
                }
                at = "setting the roster";
                await AC.setRoster(h, splitRoster(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const { steps, rec, run, shot } = recorder(h, "rail-tabs-split");
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents, their project, initiatives, brainstorms, council and Verify run", false, ctx.arrangeError);
                return steps;
            }
            const T = Object.fromEntries(Object.entries(ctx.tabs).map(([k, v]) => [k, v.tabId]));
            const cellOf = (k) => `document.querySelector('[data-agent-terminal="${T[k]}"]')`;
            const write = async (k, topic, file) => {
                mkdirSync(dirname(ctx.files[k]), { recursive: true });
                writeFileSync(ctx.files[k], JSON.stringify(file, null, 2));
                await h.rpc("uireveal", { address: `brainstorm:${topic}`, callerblockid: ctx.tabs[k].blockId, callercwd: ctx.cwd }, UI_ROUTE);
            };
            // one Verify run as the harness reports it: start, a progress for the scenario that finished, an end
            const reportFailedRun = async () => {
                const runid = randomUUID();
                const steps9 = Array.from({ length: 9 }, (_, i) => ({ step: `${i + 1}. a step of the council card`, state: i + 1 >= 7 ? "fail" : "pass" }));
                const files = Array.from({ length: 9 }, (_, i) => `${VERIFY_SCENARIO}-${String(i + 1).padStart(2, "0")}.png`);
                const base = { blockid: ctx.tabs.b.blockId, runid, pid: process.pid, cwd: ctx.cwd, command: `task verify:ui -- ${VERIFY_SCENARIO}`, shotsdir: join(ctx.dir, "cdp-shots") };
                const done = { name: VERIFY_SCENARIO, files, steps: steps9, done: true };
                await h.rpc("verifyreport", { ...base, phase: "start", scenarios: [{ name: VERIFY_SCENARIO }] }, RPC);
                await h.rpc("verifyreport", { ...base, phase: "progress", scenarios: [done] }, RPC);
                await h.rpc("verifyreport", { ...base, phase: "end", scenarios: [done] }, RPC);
                await page(h, `const V = await mod("app/view/agents/verifystore.ts"); await V.loadVerify(${JSON.stringify(ctx.tabs.b.blockId)}, ${JSON.stringify(ctx.cwd)}); return true;`);
            };
            ctx.verifyFile = join(ctx.dataDir, "verify", `${ctx.tabs.b.blockId}.json`);
            // The surface has ONE AgentHeader, for the focused agent, above the grid, so the header's ◇ chip and Brainstorm dot
            // are read while that cell has the focus. Every cell also has its own 26px GridCellBar (name, the chip and the
            // Brainstorm marker when it has them, Chat | Terminal, ×): barOf reads what one says, whichever cell has the focus.
            const barOf = (k) =>
                h.ev(`(() => {
                    const flat = ${FLAT};
                    const bar = document.querySelector('[data-agent-cell-bar="${T[k]}"]');
                    const chip = bar?.querySelector("[data-agent-cell-initiative]");
                    const mark = bar?.querySelector("[data-agent-cell-brainstorm]");
                    const dot = mark?.querySelector("[data-agent-cell-brainstorm-dot]");
                    const rect = (el) => { const r = el?.getBoundingClientRect(); return r ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } : null; };
                    const br = rect(bar);
                    const cr = rect(chip);
                    const mr = rect(mark);
                    const dr = rect(dot);
                    const inside = (a, b) => !!a && !!b && a.l >= b.l - 0.5 && a.r <= b.r + 0.5 && a.t >= b.t - 0.5 && a.b <= b.b + 0.5;
                    const progress = chip?.querySelector("[data-agent-cell-initiative-progress]");
                    return {
                        bar: !!bar,
                        barHeight: br ? Math.round(br.h) : 0,
                        // nothing in the bar spills out of it or wraps onto a second line
                        barFits: !!bar && bar.scrollWidth <= bar.clientWidth + 1 && bar.scrollHeight <= bar.clientHeight + 1,
                        nameWidth: Math.round(bar?.querySelector("span.truncate")?.getBoundingClientRect().width ?? 0),
                        chip: !!chip,
                        chipOf: chip?.getAttribute("data-agent-cell-initiative") ?? null,
                        chipTitle: chip ? flat(chip.querySelector("[data-agent-cell-initiative-title]")) : null,
                        chipProgress: progress ? flat(progress) : null,
                        chipLabel: chip?.getAttribute("aria-label") ?? null,
                        chipInBar: inside(cr, br),
                        chipOneLine: !!cr && cr.h <= 19,
                        progressVisible: !!progress && progress.getBoundingClientRect().right <= (chip?.getBoundingClientRect().right ?? 0) + 0.5,
                        mark: !!mark,
                        markLabel: mark?.getAttribute("aria-label") ?? null,
                        markInBar: inside(mr, br),
                        dot: dot?.getAttribute("data-agent-cell-brainstorm-dot") ?? null,
                        dotOnMark: inside(dr, mr),
                        dotSize: dr ? Math.round(dr.w) : null,
                        cellFocused: document.querySelector('[data-agent-terminal="${T[k]}"]')?.getAttribute("data-agent-focused") === "true",
                    };
                })()`);
            const hdr = (k) =>
                h.ev(`(() => {
                    const flat = ${FLAT};
                    const header = document.querySelector("[data-agent-header]");
                    const chip = header?.querySelector("[data-initiative-link-open]");
                    const cell = ${cellOf(k)};
                    return {
                        cell: !!cell,
                        chip: chip ? flat(chip) : null,
                        unlinkedChip: !!header?.querySelector('[data-initiative-link="${T[k]}"]'),
                        dot: !!header?.querySelector("[data-brainstorm-tab-new]"),
                        width: Math.round(header?.getBoundingClientRect().width ?? 0),
                        cellFocused: cell?.getAttribute("data-agent-focused") === "true",
                        headerName: flat(header),
                    };
                })()`);
            // focuses the agent's cell and reads the header once it names it
            async function focusAndRead(k) {
                await AC.focusAgent(h, T[k]);
                await polishWaitFor(h, `${cellOf(k)}?.getAttribute("data-agent-focused") === "true"`, SHORT_MS);
                await polishNap(600);
                return hdr(k);
            }

            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, T.a);
            await polishWaitFor(h, `!!${cellOf("a")}`, WAIT_MS);
            // the two brainstorms: the first has a board its person has not seen, the second has seen its boards; the second
            // agent's run of the Verify scenarios failed
            await write("a", TOPIC_SPA, fileOf(TOPIC_SPA, TOPIC_SPA));
            await write("b", TOPIC_SPB, fileOf(TOPIC_SPB, TOPIC_SPB));
            await reportFailedRun();
            // the split of four, the first agent focused
            const grown = await page(
                h,
                `const G = await mod("app/view/agents/gridstore.ts");
                const model = agentsModel();
                return [G.openInSplit(model, ${JSON.stringify(T.b)}), G.openInSplit(model, ${JSON.stringify(T.c)}), G.openInSplit(model, ${JSON.stringify(T.d)})];`
            );
            const four = await polishWaitFor(h, `document.querySelector("[data-agent-grid]")?.dataset.agentGridCount === "4"`, WAIT_MS);
            await AC.focusAgent(h, T.a);
            await polishNap(1000);

            // 1. each linked cell's chip and the Brainstorm switch's dot, in the header as the cell takes the focus
            await run("1. the chip and the dot of each cell", async (name) => {
                const a = await focusAndRead("a");
                await polishWaitFor(h, `${FLAT}(document.querySelector("[data-agent-header] [data-initiative-link-open]")).includes("·")`, WAIT_MS);
                const a2 = await hdr("a");
                await closeToasts(h);
                await shot("1-split-a");
                const b = await focusAndRead("b");
                await polishWaitFor(h, `${FLAT}(document.querySelector("[data-agent-header] [data-initiative-link-open]")).includes("·")`, WAIT_MS);
                const b2 = await hdr("b");
                await shot("1-split-b");
                const c = await focusAndRead("c");
                const d = await focusAndRead("d");
                rec(
                    `${name}: in a split of four ${four ? "(4 cells)" : "(NOT 4 cells)"} the header of each linked cell, once the cell has the focus (data-agent-focused), holds the ◇ chip with "<initiative> · done/total" (here "· 1/3") and no link chip; the cell whose brainstorm has a new board has the dot on the header's Brainstorm switch, the other has none; the two plain cells' headers hold the link chip and no ◇ chip`,
                    grown.every((x) => x === true) &&
                        four &&
                        a.cellFocused &&
                        a2.chip?.includes(TITLE_SPA) &&
                        /· 1\/3$/.test(a2.chip) &&
                        a2.unlinkedChip === false &&
                        a2.dot === true &&
                        b.cellFocused &&
                        b2.chip?.includes(TITLE_SPB) &&
                        /· 1\/3$/.test(b2.chip) &&
                        b2.dot === false &&
                        c.cellFocused &&
                        c.unlinkedChip &&
                        c.chip == null &&
                        d.cellFocused &&
                        d.unlinkedChip &&
                        d.chip == null,
                    { grown, four, a: { chip: a2.chip, dot: a2.dot, width: a2.width, focused: a.cellFocused }, b: { chip: b2.chip, dot: b2.dot, focused: b.cellFocused }, c: { unlinked: c.unlinkedChip, focused: c.cellFocused }, d: { unlinked: d.unlinkedChip, focused: d.cellFocused } }
                );
            });

            // 1b. what a cell's own bar says, read on cells that do NOT have the focus: the chip and the marker with its dot
            await run("1b. the chip and the dot in an unfocused cell's bar", async (name) => {
                // the first cell has the focus: read the second (linked, brainstorm seen) and the two plain cells
                await AC.focusAgent(h, T.a);
                await polishWaitFor(h, `${cellOf("a")}?.getAttribute("data-agent-focused") === "true"`, SHORT_MS);
                await polishWaitFor(h, `!!document.querySelector('[data-agent-cell-initiative="${T.b}"] [data-agent-cell-initiative-progress]')`, WAIT_MS);
                await polishNap(500);
                const b = await barOf("b");
                const c = await barOf("c");
                const d = await barOf("d");
                const aFocused = await barOf("a");
                // the second has the focus: the first, a cell without it, holds the chip and the marker with a board new to it
                await AC.focusAgent(h, T.b);
                await polishWaitFor(h, `${cellOf("b")}?.getAttribute("data-agent-focused") === "true"`, SHORT_MS);
                await polishWaitFor(h, `!!document.querySelector('[data-agent-cell-initiative="${T.a}"] [data-agent-cell-initiative-progress]')`, WAIT_MS);
                await polishNap(500);
                const a = await barOf("a");
                await closeToasts(h);
                await polishNap(300);
                await shot("1b-cell-bars");
                rec(
                    `${name}: with another cell focused, the unfocused linked cell's bar (26px, nothing wrapped or spilling) holds [data-agent-cell-initiative] reading "${TITLE_SPB}" and "· 1/3" (and the first cell's reads "${TITLE_SPA}" and "· 1/3"); the first cell's bar holds [data-agent-cell-brainstorm] with the accent dot [data-agent-cell-brainstorm-dot="new"] on it, the second's marker has no dot (its boards are seen); a plain cell's bar has neither the chip nor the marker`,
                    b.bar &&
                        b.cellFocused === false &&
                        b.barHeight === 26 &&
                        b.barFits === true &&
                        b.chip === true &&
                        b.chipOf === T.b &&
                        b.chipTitle === TITLE_SPB &&
                        b.chipProgress === "· 1/3" &&
                        b.chipLabel === `${TITLE_SPB}, 1/3 chunks done. Open the Initiative tab` &&
                        b.chipInBar === true &&
                        b.chipOneLine === true &&
                        b.progressVisible === true &&
                        b.nameWidth > 0 &&
                        b.mark === true &&
                        b.markInBar === true &&
                        b.dot === null &&
                        c.bar &&
                        c.barHeight === 26 &&
                        c.barFits === true &&
                        c.chip === false &&
                        c.mark === false &&
                        d.bar &&
                        d.chip === false &&
                        d.mark === false &&
                        // the focused cell's own bar says the same
                        aFocused.cellFocused === true &&
                        aFocused.chip === true &&
                        aFocused.chipProgress === "· 1/3" &&
                        aFocused.dot === "new" &&
                        a.cellFocused === false &&
                        a.barHeight === 26 &&
                        a.barFits === true &&
                        a.chip === true &&
                        a.chipTitle === TITLE_SPA &&
                        a.chipProgress === "· 1/3" &&
                        a.chipInBar === true &&
                        a.chipOneLine === true &&
                        a.progressVisible === true &&
                        a.mark === true &&
                        a.markInBar === true &&
                        a.dot === "new" &&
                        a.dotOnMark === true &&
                        a.dotSize === 5 &&
                        /^Brainstorm: 1 new board\. Open the Brainstorm tab$/.test(a.markLabel ?? ""),
                    { b, c: { chip: c.chip, mark: c.mark, h: c.barHeight }, d: { chip: d.chip, mark: d.mark }, aFocused: { chip: aFocused.chip, progress: aFocused.chipProgress, dot: aFocused.dot }, a }
                );
            });

            // 2. the strip at the rail's 300px with every tab and the Verify count
            await run("2. the strip at 300px", async (name) => {
                await AC.focusAgent(h, T.b);
                await polishWaitFor(h, `!!${tabOf("council")} && !!${tabOf("brainstorm")} && !!${tabOf("initiative")} && !!${ASIDE}?.querySelector('[data-rail-stat="verify"]')`, WAIT_MS);
                await click(h, tabOf("overview"));
                await polishNap(700);
                const got = await h.ev(`(() => {
                    const aside = ${ASIDE};
                    if (!aside) return null;
                    const ar = aside.getBoundingClientRect();
                    const tabs = [...aside.querySelectorAll('[role="tablist"] [role="tab"]')];
                    const last = tabs[tabs.length - 1];
                    const collapse = aside.querySelector('button[aria-label="Collapse panel"]');
                    const verify = aside.querySelector('[data-rail-stat="verify"]');
                    const counts = aside.querySelector('[role="group"][aria-label="Agent counts"]');
                    const lr = last?.getBoundingClientRect();
                    const cr = collapse?.getBoundingClientRect();
                    const vr = verify?.getBoundingClientRect();
                    return {
                        width: Math.round(ar.width),
                        tabs: tabs.map((t) => t.dataset.railTab),
                        selected: ${SELECTED},
                        lastRight: lr ? Math.round(lr.right * 10) / 10 : null,
                        collapseLeft: cr ? Math.round(cr.left * 10) / 10 : null,
                        verifyLabel: verify?.getAttribute("data-count") ?? null,
                        verifyInside: !!vr && vr.width > 0 && vr.left >= ar.left - 0.5 && vr.right <= ar.right + 0.5,
                        verifyRight: vr ? Math.round(vr.right) : null,
                        asideRight: Math.round(ar.right),
                        wrapped: counts?.getAttribute("data-rail-counts-wrapped") ?? null,
                    };
                })()`);
                await shot("2-strip-300");
                const order = (got?.tabs ?? []).filter((t) => ["council", "brainstorm", "initiative"].includes(t));
                rec(
                    `${name}: with the council agent selected on Overview (the panel ${got?.width}px, 300 wide) the strip holds Council, Brainstorm and Initiative in that order and the Verify count; the last tab's right edge is at or left of the Collapse button's left edge and the Verify count lies inside the rail (counts wrapped: ${got?.wrapped})`,
                    got != null &&
                        got.selected === "overview" &&
                        Math.abs(got.width - 300) <= 2 &&
                        order.join() === "council,brainstorm,initiative" &&
                        got.verifyLabel != null &&
                        got.lastRight != null &&
                        got.collapseLeft != null &&
                        got.lastRight <= got.collapseLeft + 0.5 &&
                        got.verifyInside === true,
                    got
                );
            });

            // 3. the chip in the bar of a cell that does NOT have the focus: it takes the cell, shows the rail and opens its own Initiative tab
            await run("3. the chip in an unfocused cell's bar", async (name) => {
                await AC.focusAgent(h, T.b);
                await polishNap(400);
                await click(h, tabOf("overview"));
                await setRail(h, false);
                await polishNap(400);
                // the first cell is not the one in focus, and its bar's chip is clicked
                const before = { focused: await focusedAgent(h), rail: await railOpen(h), cellFocused: await h.ev(`${cellOf("a")}?.getAttribute("data-agent-focused") === "true"`) };
                const clicked = await click(h, `document.querySelector('[data-agent-cell-initiative="${T.a}"]')`);
                const up = await polishWaitFor(h, `(${SELECTED}) === "initiative" && !!${IN(T.a)}`, WAIT_MS);
                await polishNap(500);
                const after = await h.ev(`({ selected: ${SELECTED}, pane: !!${IN(T.a)}, other: !!${IN(T.b)}, focusIn: !!${IN(T.a)}?.contains(document.activeElement), cellFocused: ${cellOf("a")}?.getAttribute("data-agent-focused") === "true", headerChip: ${FLAT}(${LINK_CHIP}) })`);
                const focused = await focusedAgent(h);
                await shot("3-bar-chip-in-split");
                rec(
                    `${name}: with the rail hidden and the second cell focused, a click on the ◇ chip in the FIRST cell's bar (not focused) focuses that cell (focusIdAtom and data-agent-focused), shows the rail and selects the Initiative tab of that agent (its pane, none of another agent's), the keyboard in it`,
                    before.focused === T.b &&
                        before.rail === false &&
                        before.cellFocused === false &&
                        clicked &&
                        up &&
                        focused === T.a &&
                        (await railOpen(h)) === true &&
                        after.selected === "initiative" &&
                        after.pane === true &&
                        after.other === false &&
                        after.focusIn === true &&
                        after.cellFocused === true &&
                        after.headerChip.includes(TITLE_SPA),
                    { before, clicked, up, focused, after }
                );
            });

            // 3b. the Brainstorm marker in the bar of a cell that does NOT have the focus: it takes the cell and opens its Brainstorm tab
            await run("3b. the Brainstorm marker in an unfocused cell's bar", async (name) => {
                // the second cell has the focus now; the first cell's marker (the dot is on it) is clicked
                await AC.focusAgent(h, T.b);
                await polishWaitFor(h, `${cellOf("b")}?.getAttribute("data-agent-focused") === "true"`, SHORT_MS);
                await polishNap(400);
                const before = { focused: await focusedAgent(h), cellFocused: await h.ev(`${cellOf("a")}?.getAttribute("data-agent-focused") === "true"`) };
                const clicked = await click(h, `document.querySelector('[data-agent-cell-brainstorm="${T.a}"]')`);
                const up = await polishWaitFor(h, `(${SELECTED}) === "brainstorm" && !!${BS(T.a)}`, WAIT_MS);
                await polishNap(500);
                const after = await h.ev(`({ selected: ${SELECTED}, pane: !!${BS(T.a)}, other: !!${BS(T.b)}, cellFocused: ${cellOf("a")}?.getAttribute("data-agent-focused") === "true" })`);
                // the brainstorm's mode is "brainstorm" only while the cell shows the Brainstorm view
                const mode = await page(h, `const S = await mod("app/view/agents/brainstormstore.ts"); return S.getBrainstorm(${JSON.stringify(T.a)})?.mode ?? null;`);
                const focused = await focusedAgent(h);
                const rail = await railOpen(h);
                await shot("3b-bar-marker-in-split");
                rec(
                    `${name}: with the second cell focused, a click on the Brainstorm marker in the FIRST cell's bar (not focused) focuses that cell and selects the Brainstorm tab of that agent on the rail (its timeline, none of another agent's); the cell itself stays on Chat, it never shows the Brainstorm view`,
                    before.focused === T.b &&
                        before.cellFocused === false &&
                        clicked &&
                        up &&
                        focused === T.a &&
                        rail === true &&
                        after.selected === "brainstorm" &&
                        after.pane === true &&
                        after.other === false &&
                        after.cellFocused === true &&
                        mode !== "brainstorm",
                    { before, clicked, up, focused, rail, after, mode }
                );
            });

            // 3c. the chip of the cell that has the focus, in the header: its cell, the rail and its own Initiative tab
            await run("3c. the chip in a split", async (name) => {
                await AC.focusAgent(h, T.b);
                await polishNap(400);
                await click(h, tabOf("overview"));
                await setRail(h, false);
                // another cell takes the focus, and the header now names it
                await AC.focusAgent(h, T.a);
                await polishWaitFor(h, `${FLAT}(document.querySelector("[data-agent-header] [data-initiative-link-open]")).includes(${JSON.stringify(TITLE_SPA)})`, WAIT_MS);
                await polishNap(400);
                const before = { focused: await focusedAgent(h), rail: await railOpen(h) };
                const clicked = await click(h, `document.querySelector("[data-agent-header] [data-initiative-link-open]")`);
                const up = await polishWaitFor(h, `(${SELECTED}) === "initiative" && !!${IN(T.a)}`, WAIT_MS);
                await polishNap(500);
                const after = await h.ev(`({ selected: ${SELECTED}, pane: !!${IN(T.a)}, other: !!${IN(T.b)}, focusIn: !!${IN(T.a)}?.contains(document.activeElement), cellFocused: ${cellOf("a")}?.getAttribute("data-agent-focused") === "true" })`);
                const focused = await focusedAgent(h);
                await shot("3-chip-in-split");
                rec(
                    `${name}: with the rail hidden and the first agent's cell focused, a click on the ◇ chip in the header keeps that cell focused (data-agent-focused), shows the rail and selects the Initiative tab of that agent (its pane, none of another agent's), the keyboard in it`,
                    before.focused === T.a &&
                        before.rail === false &&
                        clicked &&
                        up &&
                        focused === T.a &&
                        (await railOpen(h)) === true &&
                        after.selected === "initiative" &&
                        after.pane === true &&
                        after.other === false &&
                        after.focusIn === true &&
                        after.cellFocused === true,
                    { before, clicked, up, focused, after }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = stepper("rail-tabs-split");
            await step("remove the probes", () => h.ev(`(() => { delete window.__chatSuggestFake; return true; })()`));
            await step("put the window back", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
            await step("end the split and put the views and the brainstorms back", () =>
                page(
                    h,
                    `const G = await mod("app/view/agents/gridstore.ts");
                    const S = await mod("app/view/agents/brainstormstore.ts");
                    const M = await mod("app/view/agents/chatmodestore.ts");
                    G.endSplit(agentsModel());
                    for (const id of ${JSON.stringify(Object.values(ctx.tabs ?? {}).map((t) => t.tabId))}) { M.setChatMode(id, "chat"); S.detachBrainstorm(id); }
                    return true;`
                )
            );
            await step("restore the roster", () => AC.restoreRoster(h));
            for (const oid of ctx.oids ?? []) await step(`delete ${oid}`, () => h.rpc("effortdelete", { effortoid: oid }));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
            await step("delete the fixture council and the Verify file", () => {
                if (ctx.dataDir) {
                    rmSync(join(ctx.dataDir, "councils", `${COUNCIL}.json`), { force: true, maxRetries: 5, retryDelay: 200 });
                    if (ctx.verifyFile) rmSync(ctx.verifyFile, { force: true, maxRetries: 5, retryDelay: 200 });
                }
            });
            if (ctx.project != null) await step("remove the project", () => removeProject(h, ctx));
            await step("restore the keys", () => restoreKeys(h, ctx));
            await step("reload onto the live roster", () => ahReload(h));
            for (const dir of [ctx.dir, ctx.cwd]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    // the four agents: the first linked to its initiative, the second linked and the one that started the council (its
    // session) with the project's folder for Verify, the other two plain
    function splitRoster(ctx) {
        const row = (k, extra = {}) => rosterRow(ctx, PROJECT_SP, ctx.tabs[k], NAMES_SP[k], ctx.transcripts[k], { cwd: ctx.cwd, ...extra });
        return [
            row("a", { effortId: ctx.oida }),
            row("b", { effortId: ctx.oidb, sessionId: SESSION }),
            row("c"),
            row("d"),
        ];
    }

    return [brainstormTab, initiativeTab, splitTabs];
}
