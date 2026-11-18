// sidecar-orbit and sidecar-compact: the Sidecar window's dashboard, drawn two ways (docs/superpowers/specs/
// 2026-11-17-sidecar-orbit-dashboard-design.md; the boards P-calm, P-orbit-dashboard, P-high, P-critical, P-failed,
// P-live and Q-compact-live under .superpowers/design/cockpit-window/project/). Both drive the real Tauri host (host:
// true scenarios): Ctrl+P → Open Sidecar opens the second window, whose page this attaches to by url (attach.mjs
// attachByUrl) next to the main page, and the roster is a generated fixture (public/cockpit-fixtures/active.json, loaded
// with window.__reloadDevMockRoster). The bridge in the main window turns it into the snapshot the page draws.
//
// sidecar-orbit is P, the full window (the page pinned to 1920x1080, the board's size): the window calls (step 2 of the
// wall's scenario, kept), the waiting state before the first snapshot, F11, the strain band, the parked agents that get no
// node, then the five states (P-calm, P-orbit-dashboard and its keys, P-high, P-critical, P-failed) and P-live, which
// plays them in turn through the bridge's seams with no reload. sidecar-compact is Q, the small form: at 900 px wide, the
// real S button (the window shrinks to 340x440 and pins), the same five states in that window, Q's keys, the pin, S again
// and the line for nothing waiting. The wall's tiling, tile arrows, per-tile answers, scrollback and the small form's
// cards went with the wall (plan 2026-11-17-sidecar-orbit-dashboard.md, Task 11).
//
// One roster, `dashboard` (dashboardRoster): two working agents (work1 leads the run), an agent asking with an answerable
// ask (`Merge into main?`, Merge / Keep the branch), one asking with a multi-select ask, a finished agent whose last
// message ends `Xong. Bạn chọn (a) hay (b)?` (the question row), a finished one whose last message ends in a period, and
// the two PARKED agents (idle 40 min, asleep), which the orbit leaves out. Its calm form keeps only the working agents and
// the period-ending one. Everything that waits on you beyond the agents comes through the bridge's DEV seams on the main
// page (frontend/app/cockpit/sidecarbridge.tsx): window.__sidecarAttention (the Jarvis rows: a plan gate, and a blocked
// task of the run, which is what fails it), window.__sidecarRun (the run box and its lead, since a fixture roster has no
// server run in lineageAtom), window.__sidecarMachine / __sidecarHeavy / __sidecarFeed / __sidecarRefresh (the strain),
// __sidecarHold and __sidecarActs (the hold, and every act the page sent). Real keys go to the Sidecar page with
// Input.dispatchKeyEvent. The scenario changes only the roster file, the seams and the two windows; teardown puts them back,
// closes Sidecar with its own close button (so it does not reopen at the next launch) and reloads the main page onto the live
// roster. The small form is reached with the real S button, which calls the host's `sidecar_form` command, so teardown leaves
// the small form and unpins if a step failed.
//
// A scenario's ask ids carry its own tag (askIdOf): the main window keeps an answered ask's id in its sent set for as long
// as it runs, so the compact scenario would otherwise open on an ask the orbit scenario already answered.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attachByUrl, waitFor } from "./attach.mjs";

const ORBIT = "sidecar-orbit";
const COMPACT = "sidecar-compact";
const FIXTURE = new URL("../../public/cockpit-fixtures/active.json", import.meta.url);
const SIDECAR_URL = /\/sidecar\.html(?:[?#]|$)/i;
// Sidecar's page is drawn when its title bar is: it has no nav and no RPC client, which the main page's readiness needs
const SIDECAR_READY = `!!document.querySelector("[data-sidecar-titlebar]")`;
// the size every shape assert of P is made at (the board's): the page is pinned to it so the layout does not depend on the
// screen the window opened on
const ORBIT_VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };
const NARROW_VIEWPORT = { width: 900, height: 800, deviceScaleFactor: 1, mobile: false };
const MIN_WINDOW = { w: 340, h: 440 };
const SMALL_BREAK_PX = 1100; // layoutFor (sidecarlayout.ts): P from this width, Q under it
const SIZE_SLACK = 2; // px: the window's size read back through the screen's scale
const MIN = 60_000;
const MB = 1024 * 1024;
const GIB = 1024 ** 3;
const ON_MAC = process.platform === "darwin";
const ORBIT_MAX = 8; // ORBIT_MAX (sidecarsnapshot.ts): the nodes the orbit holds
// P-live: the page follows a change of the bridge's seams within this long, with no reload
const REACT_MS = 2000;
const NOT_RUN = "Not run (fixture)"; // the note a Stop or Sleep act leaves on its row while __sidecarHeavy is set
// the host gives Sidecar its own AppUserModelID (src-tauri/src/sidecar.rs): <identifier>.sidecar, the dev identifier here
const APP_ID = "dev.arc.app-dev.sidecar";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// polls an async check until it is truthy, false past ms (attach.mjs waitFor, which takes an expression, over a function)
const until = (check, ms, pollMs = 250) => waitFor(check, "", ms, pollMs);

// ---- the roster -------------------------------------------------------------------------------------------------------

const PROJECTS = ["arcterm", "vnstock-js", "mit-thesis", "cuscofi-app", "portfolio-journal"];
const RUNTIMES = [
    { agent: "claude", model: "opus 5.5" },
    { agent: "claude", model: "sonnet 5.5" },
    { agent: "pi" },
    { agent: "codex", model: "gpt-5" },
];
const NAMES = ["quill", "loom", "pike", "ember", "cobalt", "sable", "fennel", "lumen", "mica", "orrin"];
const SAYS = [
    "Read the failing test and traced it to the retry loop in the price feed client.",
    "The backoff never resets after a success, so one outage slows every request that comes after it.",
    "Added a reset on success and a cap of 30 seconds. Running the package tests next.",
    "Two tests still fail: both assume the old fixed delay. Updating them to read the clock they are given.",
];
const TOOLS = [
    ["read", "feed/client.go"],
    ["read", "feed/backoff.go"],
    ["edited", "feed/backoff.go", "ok"],
    ["ran", "go test ./feed/ -run Retry", "fail"],
];

// n message-and-tool pairs, starting at a seed so neighbouring agents do not repeat each other
function narration(seed, pairs) {
    const out = [];
    for (let k = 0; k < pairs; k++) {
        const j = (seed + k) % SAYS.length;
        const [verb, target, outcome] = TOOLS[j];
        out.push({ kind: "message", text: SAYS[j] });
        out.push({ kind: "action", verb, target, ...(outcome ? { outcome } : {}) });
    }
    return out;
}

const blockOf = (id) => id.replace("fx-sc-", "fx-sc-blk-");
const TERMINAL_ID = "fx-sc-term";
const WORK_ID = "fx-sc-work1"; // working 90 min, the run's lead
const WORK2_ID = "fx-sc-work2";
const ASK_ID = "fx-sc-ask1"; // asking, answerable with 1-9
const MULTI_ID = "fx-sc-ask2"; // asking, a multi-select ask: answered in the main window
const QUESTION_ID = "fx-sc-askq"; // finished, its last message asks something
const DONE_ID = "fx-sc-done"; // finished, its last message ends in a period
// the two agents the orbit leaves out, as the Cockpit folds them into its Idle list: one idle 40 min, one asleep
const PARKED_ID = "fx-sc-parked";
const ASLEEP_ID = "fx-sc-asleep";
const PARKED_IDS = [PARKED_ID, ASLEEP_ID];
const RUN_ID = "fx-sc-run";
const ASK_QUESTION = "Merge into main?";
const ASK_OPTIONS = ["Merge", "Keep the branch"];
const QUESTION_SAY = "Xong. Bạn chọn (a) hay (b)?";
const QUESTION_ROW = "Bạn chọn (a) hay (b)?"; // the last sentence of it: the row's text
const DONE_SAY = "Done. The branch is ready and every test passes.";
// the ids of the Needs you rows (sidecarneeds.ts): `ask:<agent>`, `q:<agent>`, a Jarvis row's own key
const NEED = {
    ask: `ask:${ASK_ID}`,
    multi: `ask:${MULTI_ID}`,
    gate: `dag-gate:${RUN_ID}:1`,
    question: `q:${QUESTION_ID}`,
    failed: `dag-blocked:${RUN_ID}:t3`,
};

const askIdOf = (id, tag) => `fx-sc-a-${id}-${tag}`;

// one agent as the cockpit's roster has it (AgentVM, frontend/app/view/agents/agentsviewmodel.ts). Every age is fixed
// (stateSince, idleSince, sleeping.since): the bridge re-emits on any change, and an age that moves with `now` would make
// every build of the snapshot differ
function agentOf(kind, i, now, id, extra = {}) {
    const rt = RUNTIMES[i % RUNTIMES.length];
    const base = {
        id,
        name: NAMES[i % NAMES.length],
        task: `Task ${i + 1}`,
        project: PROJECTS[i % PROJECTS.length],
        ...rt,
        blockId: blockOf(id),
        usage: { contextpct: 18 + ((i * 7) % 70) },
    };
    switch (kind) {
        case "ask":
            return {
                ...base,
                state: "asking",
                blockedMs: extra.blockedMs,
                stateSince: now - extra.blockedMs,
                previousInfo: narration(i, 3),
                ask: { askId: extra.askId, oref: `block:${base.blockId}`, questions: extra.questions },
            };
        case "work":
            return { ...base, state: "working", activeMs: extra.activeMs, stateSince: now - extra.activeMs, previousInfo: narration(i, 3) };
        case "review":
            // just finished, inside the Cockpit's 5 minute grace (IDLE_GRACE_MS), with something edited: a review tile. The
            // last message is the one the question heuristic reads, with no user entry after it
            return {
                ...base,
                state: "idle",
                idleSince: now - extra.agoMs,
                edited: true,
                previousInfo: [...narration(i, 2), { kind: "message", text: extra.say }],
            };
        case "idle":
            // past the grace: parked in the Cockpit's Idle list, off the orbit
            return { ...base, state: "idle", idleSince: now - 40 * MIN, previousInfo: narration(i, 3) };
        case "sleep":
            // asleep, long idle: parked too
            return { ...base, state: "idle", idleSince: now - 120 * MIN, sleeping: { since: now - 30 * MIN, freedBytes: 250 * MB } };
        default:
            throw new Error(`unknown agent kind ${kind}`);
    }
}

const terminalOf = () => ({ id: TERMINAL_ID, name: "zsh", task: "", state: "idle", kind: "terminal", project: "arcterm", blockId: "fx-sc-blk-term", running: false });
const parked = (now) => [agentOf("idle", 7, now, PARKED_ID), agentOf("sleep", 8, now, ASLEEP_ID)];

// `calm` keeps the two working agents and the period-ending one (nothing of them waits on you); `full` is the roster
function dashboardRoster(now, tag, kind) {
    const work = agentOf("work", 2, now, WORK_ID, { activeMs: 90 * MIN });
    const work2 = agentOf("work", 3, now, WORK2_ID, { activeMs: 14 * MIN });
    const done = agentOf("review", 5, now, DONE_ID, { agoMs: 50_000, say: DONE_SAY });
    if (kind === "calm") return [terminalOf(), work, work2, done, ...parked(now)];
    const ask = agentOf("ask", 0, now, ASK_ID, {
        blockedMs: 20 * MIN,
        askId: askIdOf(ASK_ID, tag),
        questions: [{ header: "MERGE", question: ASK_QUESTION, options: ASK_OPTIONS.map((label) => ({ label })) }],
    });
    const multi = agentOf("ask", 1, now, MULTI_ID, {
        blockedMs: 12 * MIN,
        askId: askIdOf(MULTI_ID, tag),
        questions: [
            {
                header: "CHECKS",
                question: "Which checks should run before the merge?",
                multiSelect: true,
                options: [{ label: "Unit tests" }, { label: "Typecheck" }, { label: "Lint" }],
            },
        ],
    });
    const question = agentOf("review", 4, now, QUESTION_ID, { agoMs: 30_000, say: QUESTION_SAY });
    return [terminalOf(), ask, multi, work, work2, question, done, ...parked(now)];
}

// the agents the orbit draws, in its order: asking (longest blocked first), working (longest running first), finished
const ORBIT_FULL = [ASK_ID, MULTI_ID, WORK_ID, WORK2_ID, QUESTION_ID, DONE_ID];
const ORBIT_CALM = [WORK_ID, WORK2_ID, DONE_ID];

// the Jarvis rows, with fixed ages (relative to the roster's `now`, so the rows sort the same whenever the roster is built)
const gateItem = (now) => ({
    kind: "dag-gate",
    key: NEED.gate,
    channelid: "fx-sc-chan",
    channelname: "Sidecar orbit",
    runid: RUN_ID,
    source: "Sidecar orbit",
    text: "Plan gate: approve phase 2 before the workers start?",
    action: "Review",
    phaseidx: 1,
    waitingsince: now - 9 * MIN,
});
// a task of the run that failed its check: what fails the run (a dag-blocked item with retry), the oldest thing waiting
const failedItem = (now) => ({
    kind: "dag-blocked",
    key: NEED.failed,
    channelid: "fx-sc-chan",
    channelname: "Sidecar orbit",
    runid: RUN_ID,
    taskid: "t3",
    source: "Sidecar orbit",
    text: "Task 3 failed its check twice",
    action: "Retry",
    phaseidx: 0,
    waitingsince: now - 25 * MIN,
    retry: true,
});
const runBox = (since) => ({ id: RUN_ID, leadId: WORK_ID, title: "Sidecar orbit", done: 7, total: 9, since });

// ---- the five states --------------------------------------------------------------------------------------------------

// what each state is made of and what it shows: the roster, the attention items, the strain, the Needs you rows in order,
// the core's tone and the alert frame (sidecarorbitmodel.ts screenState, frameOf, coreTone)
const STATES = {
    calm: { roster: "calm", attention: () => [], strain: null, needs: [], tone: "muted", frame: "none" },
    normal: {
        roster: "full",
        attention: (now) => [gateItem(now)],
        strain: null,
        needs: [NEED.ask, NEED.multi, NEED.gate, NEED.question],
        tone: "warning",
        frame: "none",
    },
    high: {
        roster: "full",
        attention: (now) => [gateItem(now)],
        strain: "amber",
        needs: [NEED.ask, NEED.multi, NEED.gate, NEED.question],
        tone: "warning",
        frame: "warning",
    },
    critical: {
        roster: "full",
        attention: (now) => [gateItem(now)],
        strain: "red",
        needs: [NEED.ask, NEED.multi, NEED.gate, NEED.question],
        tone: "warning",
        frame: "error",
    },
    failed: {
        roster: "full",
        attention: (now) => [gateItem(now), failedItem(now)],
        strain: null,
        needs: [NEED.failed, NEED.ask, NEED.multi, NEED.gate, NEED.question],
        tone: "error",
        frame: "error",
    },
};
const orbitIdsOf = (name) => (STATES[name].roster === "calm" ? ORBIT_CALM : ORBIT_FULL);

// ---- the strain's readings (the band's seams) -------------------------------------------------------------------------

// the three agents the band names. By RAM the heaviest first is the working lead; by CPU it is the asking one, so a step
// can tell which measure drew the rows. The third is the parked idle agent: the band ranks the whole roster, since an idle
// agent holding memory is the one to put to sleep, though the orbit draws no node for it
const HEAVY = [
    { id: WORK_ID, ram: 3.2 * GIB, procRam: 2.6 * GIB, ramPid: 4101, ramCommand: "node vite dev", cpu: 55, procCpu: 48, cpuPid: 5101, cpuCommand: "esbuild --watch" },
    { id: ASK_ID, ram: 1.9 * GIB, procRam: 1.4 * GIB, ramPid: 4102, ramCommand: "go test ./...", cpu: 80, procCpu: 74, cpuPid: 5102, cpuCommand: "go test ./feed/..." },
    // under half a GB, so the band prints it in whole MB (formatBytes)
    { id: PARKED_ID, ram: 420 * MB, procRam: 300 * MB, ramPid: 4103, ramCommand: "cargo build", cpu: 20, procCpu: 17, cpuPid: 5103, cpuCommand: "cargo check" },
];
const HEAVY_BY_RAM = HEAVY.map((h) => h.id);
const HEAVY_BY_CPU = [...HEAVY].sort((a, b) => b.cpu - a.cpu).map((h) => h.id);

// what GetConsumersCommand and AgentCpuCommand answer (frontend/types/gotypes.d.ts), for the bridge's __sidecarHeavy seam
const consumersOf = (rows) => ({
    totalbytes: 32 * GIB,
    availablebytes: 2 * GIB,
    windowms: 0,
    swapusedbytes: 0,
    agents: rows.map((h) => ({
        tabid: h.id,
        blockid: blockOf(h.id),
        rambytes: h.ram,
        tokensread: false,
        heaviest: { pid: h.ramPid, command: h.ramCommand, bytes: h.procRam },
    })),
});
const agentCpuOf = (rows) => ({
    supported: true,
    ready: true,
    agents: rows.map((h) => ({ blockid: blockOf(h.id), cpu: h.cpu, top: { pid: h.cpuPid, command: h.cpuCommand, cpu: h.procCpu } })),
});
const heavyFixture = () => ({ consumers: consumersOf(HEAVY), agentcpu: agentCpuOf(HEAVY) });
// one agent named: the lead, by RAM (P-critical)
const heavyOne = () => ({ consumers: consumersOf([HEAVY[0]]), agentcpu: agentCpuOf([HEAVY[0]]) });
// the bridge's machine seam: a MachineStatsData
const machineOf = (o) => ({ memtotal: 32 * GIB, memavailable: 14 * GIB, pressure: "normal", cpupct: 20, swaptotal: 16 * GIB, swapused: 0, disks: [], ...o });
const MACHINE_AMBER = machineOf({ pressure: "high", memavailable: 2.1 * GIB, cpupct: 30 });
const MACHINE_CPU = machineOf({ pressure: "normal", memavailable: 14 * GIB, cpupct: 95 });
const MACHINE_RED = machineOf({ pressure: "critical", memavailable: 0.6 * GIB, swapused: 9.2 * GIB, cpupct: 95 });
const MACHINE_CALM = machineOf({});
// board E's red line names the OS: strainmodel's osName
const OS_NAME = process.platform === "win32" ? "Windows" : ON_MAC ? "macOS" : "The system";

// ---- driving the two pages ---------------------------------------------------------------------------------------------

// Writes the roster file and has the page read it. Vite serves a file made after it started only once its watcher has
// seen it, and a read before then is dropped silently (devmock.ts), so the roster is read once the server answers with
// exactly the text written.
async function loadRoster(h, agents) {
    mkdirSync(new URL(".", FIXTURE), { recursive: true });
    const text = JSON.stringify(agents, null, 2);
    writeFileSync(FIXTURE, text);
    const served = await waitFor(
        h.ev,
        `fetch("/cockpit-fixtures/active.json", { cache: "no-store" })
            .then((r) => (r.ok ? r.text() : null))
            .then((t) => t === ${JSON.stringify(text)})
            .catch(() => false)`,
        15_000
    );
    if (!served) throw new Error("the dev server did not serve the roster file just written");
    await h.ev("window.__reloadDevMockRoster()");
}

// Mod+P as the palette's own handler reads it, then the row by its binding id
const PALETTE_INPUT = `document.querySelector('input[data-palette-input]')`;
const PALETTE_TOGGLE = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ${ON_MAC ? "metaKey" : "ctrlKey"}: true, bubbles: true }))`;
const PALETTE_CLOSE = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`;
const PALETTE_TYPE = (text) => `(() => {
    const el = ${PALETTE_INPUT};
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
})()`;
const SIDECAR_ROW = `document.querySelector('button[data-palette-key="open-sidecar"]')`;

// Ctrl+P, "Open Sidecar", the row. Returns what went wrong, or null
async function openSidecarFromPalette(h) {
    // Ctrl+P toggles, so a palette an earlier step left open is closed first
    if (await h.ev(`!!${PALETTE_INPUT}`)) {
        await h.ev(PALETTE_CLOSE);
        await waitFor(h.ev, `!${PALETTE_INPUT}`, 2000);
    }
    await h.ev(PALETTE_TOGGLE);
    if (!(await waitFor(h.ev, `!!${PALETTE_INPUT}`, 4000))) return "Ctrl+P did not open the palette";
    await h.ev(PALETTE_TYPE("Open Sidecar"));
    if (!(await waitFor(h.ev, `!!${SIDECAR_ROW}`, 4000))) return "the palette has no Open Sidecar row";
    await h.ev(`${SIDECAR_ROW}.click()`);
    return null;
}

// the keys the page's handlers read (sidecar.tsx: F11; sidecarorbit.tsx and sidecarcompact.tsx: arrows, Enter, 1-9)
const KEYS = {
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowDown: { code: "ArrowDown", vk: 40 },
    Enter: { code: "Enter", vk: 13, text: "\r" },
    F11: { code: "F11", vk: 122 },
    1: { code: "Digit1", vk: 49, text: "1" },
    2: { code: "Digit2", vk: 50, text: "2" },
};
// a real key press on the page: keyDown then keyUp
async function press(side, key) {
    const k = KEYS[key];
    const base = { key, code: k.code, windowsVirtualKeyCode: k.vk };
    await side.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.text ? { text: k.text } : {}) });
    await side.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// the window calls the page itself may make (capabilities/sidecar.json): the Tauri bridge the page already has
const windowCall = (side, command, args) =>
    side.ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(`plugin:window|${command}`)}, ${JSON.stringify({ label: "sidecar", ...args })})`);
const isFullscreen = (side) => windowCall(side, "is_fullscreen");
const setLogicalSize = (side, w, h) => windowCall(side, "set_size", { value: { Logical: { width: w, height: h } } });
const innerSize = (side) => side.ev("({ w: window.innerWidth, h: window.innerHeight })");

// the acts the main page's bridge received after the first `from`, the page's hello left out (it is not an action)
const actsSince = async (h, from) => ((await h.ev("window.__sidecarActs ?? []")) ?? []).slice(from).filter((a) => a?.kind !== "hello");
const actCount = async (h) => (await h.ev("(window.__sidecarActs ?? []).length")) ?? 0;

const has = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
const countOf = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
// true when the element was there and was clicked (a real click event: React's onClick runs, the buttons keep no focus)
const clickIn = (side, selector) =>
    side.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el == null) return false; el.click(); return true; })()`);
const near = (a, b) => Math.abs(a - b) <= SIZE_SLACK;
const rowSel = (id) => `[data-sidecar-heavy="${id}"]`;
const nodeSel = (id) => `[data-sidecar-node="${id}"]`;
const needSel = (key) => `[data-sidecar-need="${key}"]`;

// the dashboard as the page draws it, P or Q: its attributes, the core, the Needs you rows, the nodes (P) or dots (Q), the
// lanes (P), the run, the band (P) or the strain line (Q). `.animate-sidecar-ping` is on a child ring, so a ping is the
// element having one inside it
const DASH_READ = `(() => {
    const q = (s) => document.querySelector(s);
    const all = (s) => [...document.querySelectorAll(s)];
    const txt = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const pinged = (el) => el != null && el.querySelector(".animate-sidecar-ping") != null;
    const dash = q("[data-sidecar-dashboard]");
    const core = q("[data-sidecar-core]");
    const run = q("[data-sidecar-run]");
    const band = q("[data-sidecar-band]");
    const line = q("[data-sidecar-strainline]");
    const bar = q("[data-sidecar-titlebar]");
    const btn = (n) => q('[data-sidecar-btn="' + n + '"]');
    const page = document.scrollingElement;
    return {
        kind: dash?.dataset.sidecarDashboard ?? null,
        state: dash?.dataset.sidecarState ?? null,
        frame: dash?.dataset.sidecarFrame ?? null,
        waiting: !!q("[data-sidecar-waiting]"),
        titlebar: bar != null,
        layout: bar?.dataset.sidecarLayout ?? null,
        footer: !!q("[data-sidecar-footer]"),
        core: core == null ? null : { n: txt(core), tone: core.dataset.coreTone ?? null },
        coreWords: q("[data-sidecar-core-words]") == null ? null : txt(q("[data-sidecar-core-words]")),
        coreAlert: q("[data-sidecar-core-alert]") == null ? null : txt(q("[data-sidecar-core-alert]")),
        coreFailed: q("[data-sidecar-core-failed]") == null ? null : txt(q("[data-sidecar-core-failed]")),
        allClear: q("[data-sidecar-allclear]") == null ? null : txt(q("[data-sidecar-allclear]")),
        pingCount: document.querySelectorAll(".animate-sidecar-ping").length,
        needs: all("[data-sidecar-need]").map((r) => {
            // P's row is head, text, how; Q's is a marker and a column holding the same three
            const box = r.querySelector(":scope > div.flex-col") ?? r;
            return {
                key: r.dataset.sidecarNeed,
                kind: r.dataset.needKind,
                failed: r.dataset.needFailed === "true",
                selected: r.dataset.selected === "true",
                ping: pinged(r),
                tinted: r.classList.contains("bg-errorbg"),
                leadsFailed: txt(r).startsWith("Failed"),
                text: txt(box.children[1]),
                how: txt(box.lastElementChild),
            };
        }),
        nodes: all("[data-sidecar-node]").map((n) => ({
            id: n.dataset.sidecarNode,
            tone: n.dataset.nodeTone,
            ping: pinged(n),
            selected: n.dataset.selected === "true",
            heavy: n.querySelector("[data-sidecar-node-heavy]")?.textContent ?? null,
            line: n.querySelector("[title]")?.getAttribute("title") ?? null,
        })),
        dots: all("[data-sidecar-dot]").map((d) => ({ id: d.dataset.sidecarDot, tone: d.dataset.nodeTone, ping: pinged(d), heavy: d.dataset.heavy === "true", tip: d.getAttribute("title") })),
        lanes: all("[data-sidecar-lane]").map((l) => ({ id: l.dataset.sidecarLane, bars: [...l.querySelectorAll("[data-span-state]")].map((b) => b.dataset.spanState) })),
        more: q("[data-sidecar-more]") == null ? null : txt(q("[data-sidecar-more]")),
        empty: q("[data-sidecar-empty]") == null ? null : txt(q("[data-sidecar-empty]")),
        run: run == null ? null : { text: txt(run), failed: run.dataset.runFailed === "true" },
        band: band == null ? null : { level: band.dataset.level, stop: !!band.querySelector("[data-sidecar-heavy-stop]"), sleep: !!band.querySelector("[data-sidecar-heavy-sleep]") },
        strainLine:
            line == null
                ? null
                : {
                      level: line.dataset.level,
                      title: txt(line.querySelector("[data-sidecar-strainline-title]")),
                      stop: !!line.querySelector("[data-sidecar-heavy-stop]"),
                      sleep: !!line.querySelector("[data-sidecar-heavy-sleep]"),
                  },
        w: window.innerWidth,
        h: window.innerHeight,
        s: btn("small")?.getAttribute("aria-pressed") ?? null,
        pin: btn("pin")?.getAttribute("aria-pressed") ?? null,
        bar: bar == null ? null : { scrollW: bar.scrollWidth, clientW: bar.clientWidth },
        windowButtons: ["minimize", "maximize", "fullscreen"].filter((n) => !!btn(n)),
        machine: q("[data-sidecar-machine]")?.textContent ?? null,
        overflows: page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1,
    };
})()`;
const readDash = (side) => side.ev(DASH_READ);

// the band, and the title bar's readout with its tones, as P shows them now
const BAND_READ = `(() => {
    const band = document.querySelector("[data-sidecar-band]");
    const machine = document.querySelector("[data-sidecar-machine]");
    return {
        band: band == null ? null : {
            level: band.dataset.level,
            title: band.querySelector("[data-sidecar-band-title]")?.textContent ?? "",
            why: band.querySelector("[data-sidecar-band-why]")?.textContent ?? "",
            finding: band.querySelector("[data-sidecar-band-finding]")?.textContent ?? null,
            rows: [...band.querySelectorAll("[data-sidecar-heavy]")].map((r) => ({
                id: r.dataset.sidecarHeavy,
                text: r.textContent ?? "",
                process: r.querySelector("[data-sidecar-heavy-process]")?.textContent ?? null,
                stop: !!r.querySelector("[data-sidecar-heavy-stop]"),
                sleep: !!r.querySelector("[data-sidecar-heavy-sleep]"),
                confirm: !!r.querySelector("[data-sidecar-confirm]"),
                note: r.querySelector("[data-sidecar-heavy-note]")?.textContent ?? null,
            })),
        },
        ramTone: machine?.dataset.ramTone ?? null,
        cpuTone: machine?.dataset.cpuTone ?? null,
        machine: machine?.textContent ?? null,
    };
})()`;
const readBand = (side) => side.ev(BAND_READ);
const BAND_LEVEL = `document.querySelector("[data-sidecar-band]")?.dataset.level ?? null`;

// the host's form, through its own command (what the S and pin buttons call): null reads it, {small} / {pinned} change it
const sidecarForm = (side, change) => side.ev(`window.__TAURI_INTERNALS__.invoke("sidecar_form", { change: ${JSON.stringify(change)} })`);
// the main window's size and whether it holds the focus: pressing S or the pin must not move either
const mainState = (h) => h.ev("({ w: window.innerWidth, h: window.innerHeight, focus: document.hasFocus() })");

// the bridge's seams on the main page: each sets only what it is given
const setSeams = (h, { machine, heavy }) =>
    h.ev(`(() => {
        ${machine === undefined ? "" : `window.__sidecarMachine = ${JSON.stringify(machine)};`}
        ${heavy === undefined ? "" : `window.__sidecarHeavy = ${JSON.stringify(heavy)};`}
    })()`);
const refresh = (h) => h.ev("window.__sidecarRefresh()");
const setAttention = (h, items) => h.ev(`window.__sidecarAttention(${JSON.stringify(items)})`);
const setRun = (h, box) => h.ev(`window.__sidecarRun(${JSON.stringify(box)})`);
// the strain track started over, so a band the red level is holding steps down at once instead of after 60 s
const resetStrain = (h) => h.ev("window.__sidecarFeed([])");
// 27 readings 5 s apart ending now, every one at 95% CPU: the strain model's 120 s CPU streak with no wait. The machine seam
// is set first, with the same CPU and a normal pressure, so no poll between the feed and the refresh reads another one
const feedCpu = (h) =>
    h.ev(`(async () => {
        window.__sidecarMachine = ${JSON.stringify(MACHINE_CPU)};
        const n = Date.now();
        const readings = [];
        for (let i = 0; i < 27; i++) {
            readings.push({ at: n - (26 - i) * 5000 - 1, pressure: "normal", memFree: ${14 * GIB}, memTotal: ${32 * GIB}, cpuPct: 95 });
        }
        window.__sidecarFeed(readings);
        await window.__sidecarRefresh();
    })()`);

// A scenario's steps, numbered as they are recorded so a step added or dropped needs no renumbering
function recorder() {
    const steps = [];
    let n = 0;
    const rec = (step, ok, detail) => steps.push({ step: `${++n}. ${step}`, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    return { steps, rec };
}

// ---- the five states --------------------------------------------------------------------------------------------------

// Puts the app in one of the five states through the roster file and the seams (the roster is only rewritten when its kind
// changes). The attention items are dated from the roster's `now`, so the rows sort the same whenever it was built.
async function applyState(h, ctx, name) {
    const spec = STATES[name];
    if (ctx.rosterKind !== spec.roster) {
        ctx.rosterNow = Date.now();
        await loadRoster(h, dashboardRoster(ctx.rosterNow, ctx.tag, spec.roster));
        ctx.rosterKind = spec.roster;
    }
    // the track starts over first: a held red band would not step down for a minute
    await resetStrain(h);
    if (spec.strain === "amber") await setSeams(h, { machine: MACHINE_AMBER, heavy: heavyFixture() });
    else if (spec.strain === "red") await setSeams(h, { machine: MACHINE_RED, heavy: heavyOne() });
    else await setSeams(h, { machine: MACHINE_CALM, heavy: null });
    await setAttention(h, spec.attention(ctx.rosterNow));
    await refresh(h);
}

// waits for the page to show a state with its core and its drawn agents, then for the 500 ms eases to finish
async function settleState(side, name, kind) {
    const spec = STATES[name];
    const drawn = kind === "orbit" ? "[data-sidecar-node]" : "[data-sidecar-dot]";
    const shown = await waitFor(
        side.ev,
        `(() => {
            const d = document.querySelector("[data-sidecar-dashboard=${kind}]");
            return d != null &&
                d.dataset.sidecarState === ${JSON.stringify(name)} &&
                document.querySelector("[data-sidecar-core]")?.textContent?.trim() === ${JSON.stringify(String(spec.needs.length))} &&
                document.querySelectorAll(${JSON.stringify(drawn)}).length === ${orbitIdsOf(name).length};
        })()`,
        15_000
    );
    await sleep(800);
    return shown;
}

// the checks every state shares, on P and on Q: the attributes, the core's number and tone, the Needs you rows in order,
// and the agents drawn (nodes or dots) in the orbit's order
function shapeOk(name, got, kind) {
    const spec = STATES[name];
    const drawn = (kind === "orbit" ? got.nodes : got.dots).map((d) => d.id);
    return (
        got.kind === kind &&
        got.state === name &&
        got.frame === spec.frame &&
        got.core?.n === String(spec.needs.length) &&
        got.core.tone === spec.tone &&
        JSON.stringify(got.needs.map((n) => n.key)) === JSON.stringify(spec.needs) &&
        JSON.stringify(drawn) === JSON.stringify(orbitIdsOf(name))
    );
}
const row = (got, key) => got.needs.find((n) => n.key === key);
const drawnOf = (got, id) => got.nodes.find((n) => n.id === id) ?? got.dots.find((d) => d.id === id);

// ---- steps both scenarios share ---------------------------------------------------------------------------------------

// Ctrl+P → Open Sidecar and attach to its page. Returns the page, or null with the failed step recorded
async function openSidecar(h, ctx, rec) {
    const failed = await openSidecarFromPalette(h);
    ctx.opened = failed == null;
    const what = "Ctrl+P → Open Sidecar opens the Sidecar window, and its page can be driven";
    if (failed != null) {
        rec(what, false, failed);
        return null;
    }
    let side;
    try {
        // shots go into the main handle's list, so the contact sheet and shots.json carry them
        side = await attachByUrl(SIDECAR_URL, { pageReady: SIDECAR_READY, shots: h.shots });
        ctx.side = side;
        // the page is not the focused one of the OS: its keys need a page that believes it is
        await side.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
        await side.ready();
    } catch (e) {
        rec(what, false, String(e?.message ?? e));
        return null;
    }
    rec(what, /sidecar\.html/.test(side.url) && (await side.ev("document.title")) === "arcterm Sidecar", { url: side.url, title: await side.ev("document.title") });
    return side;
}

const LOG_LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) (.*)$/;
// the lines of a host log with their time (written in local time by applog.rs)
function logLines(path) {
    return readFileSync(path, "utf8")
        .split(/\r?\n/)
        .flatMap((line) => {
            const m = LOG_LINE.exec(line);
            if (m == null) return [];
            const [, y, mo, d, hh, mm, ss, ms, text] = m;
            return [{ at: new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss), Number(ms)).getTime(), text }];
        });
}

// Windows only: the host gives the Sidecar window its own AppUserModelID when it builds it, and says so in the dev app's
// own log (src-tauri/src/sidecar.rs). The log is $ARC_DEV_DATA_DIR/data/waveapp.log, set by final-verify.mjs for the app it
// starts; with it unset this fails rather than read the person's own dev log
async function taskbarIdStep(rec, openedAt) {
    const what = `the host gives Sidecar its own taskbar identity: the dev app's waveapp.log says \`[sidecar] app id ${APP_ID}\` after the open`;
    if (process.platform !== "win32") {
        rec(`${what} (skipped: Windows only)`, true, "skipped: the AppUserModelID and the taskbar button are Windows only");
        return;
    }
    const dir = process.env.ARC_DEV_DATA_DIR;
    if (!dir) {
        rec(
            what,
            false,
            "ARC_DEV_DATA_DIR is not set, so there is no log of this dev app's own to read (scripts/cdp/final-verify.mjs sets it for the app it starts); the person's own dev log under %LOCALAPPDATA% is never read"
        );
        return;
    }
    const path = join(dir, "data", "waveapp.log");
    let after = [];
    let readError = null;
    // written from the main thread a moment after the window is built
    const wrote = await until(
        async () => {
            try {
                after = logLines(path).filter((l) => l.at >= openedAt);
                readError = null;
            } catch (e) {
                readError = String(e?.message ?? e);
                return false;
            }
            return after.some((l) => l.text.startsWith("[sidecar] app id "));
        },
        15_000,
        500
    );
    const idLines = after.filter((l) => l.text.startsWith("[sidecar] app id ")).map((l) => l.text);
    const troubles = after.filter((l) => /setting the window's app id|no window handle for the app id|no memory for the window's app id|making its \d+px icon failed|its icon has no frame/.test(l.text)).map((l) => l.text);
    rec(what, wrote && idLines.length >= 1 && idLines.every((l) => l === `[sidecar] app id ${APP_ID}`) && troubles.length === 0, {
        log: path,
        idLines,
        troubles,
        readError,
    });
}

// the page's own window calls (capabilities/sidecar.json) work: leave full screen (a reopened window may be in it), ask for
// 200x200, put the first size back. The page's innerWidth and innerHeight are logical px, read before any device override
// pins them. Whether the host holds the 340x440 minimum against this call is recorded, not asserted: on Windows
// `min_inner_size` clamps a person dragging an edge and not a programmatic set_size (a live run read 200x207 back), so the
// minimum on a real drag is a hand check (docs/hand-checks.md)
async function windowCallsStep(side, rec) {
    const wasFullscreen = await isFullscreen(side);
    if (wasFullscreen) {
        await windowCall(side, "set_fullscreen", { value: false });
        await until(async () => !(await isFullscreen(side)), 5000);
        await sleep(700);
    }
    const first = await innerSize(side);
    await setLogicalSize(side, 200, 200);
    await sleep(900);
    const small = await innerSize(side);
    // what the host itself reports (physical px) beside the page's logical read
    const smallPhysical = await windowCall(side, "inner_size");
    const dpr = await side.ev("window.devicePixelRatio");
    await setLogicalSize(side, first.w, first.h);
    await sleep(900);
    const back = await innerSize(side);
    // a window already at the minimum cannot get smaller where the host clamps
    const atMin = first.w <= MIN_WINDOW.w && first.h <= MIN_WINDOW.h;
    const resized = atMin || small.w < first.w || small.h < first.h;
    const restored = Math.abs(back.w - first.w) <= 2 && Math.abs(back.h - first.h) <= 2;
    rec("the page's own window calls work: it is out of full screen, set_size changes the window's size, and the first size comes back", (await isFullscreen(side)) === false && resized && restored, {
        wasFullscreen,
        first,
        asked: { w: 200, h: 200 },
        small,
        smallPhysical,
        dpr,
        restored: back,
        hostClampedToMinimum: small.w >= MIN_WINDOW.w && small.h >= MIN_WINDOW.h,
    });
}

// ---- sidecar-orbit ----------------------------------------------------------------------------------------------------

// the strain band on P: it sits on top of the right column (the run box steps aside while it shows), with the heavy jobs
async function bandSteps(h, side, rec, shot) {
    // a strained machine whose heaviest agents are not read yet: the amber band says it is finding them
    await setSeams(h, { machine: MACHINE_AMBER, heavy: { consumers: consumersOf([]) } });
    await refresh(h);
    const finding = await waitFor(side.ev, has('[data-sidecar-band][data-level="amber"] [data-sidecar-band-finding]'), 10_000);
    let got = await readBand(side);
    await shot(side, "band-finding");
    rec(
        "with the memory pressure high and no heaviest agent read yet, the amber band says `Finding the heaviest agents…`",
        finding && got.band?.level === "amber" && got.band.finding === "Finding the heaviest agents…" && got.band.rows.length === 0,
        { band: got.band }
    );

    // the readings come in: three rows by RAM, heaviest first, each with its process and Stop and Sleep; the readout is amber
    await setSeams(h, { heavy: heavyFixture() });
    await refresh(h);
    const rowsShown = await waitFor(side.ev, `${countOf("[data-sidecar-heavy]")} === 3`, 10_000);
    got = await readBand(side);
    await shot(side, "band-amber");
    const ids = got.band?.rows.map((r) => r.id) ?? [];
    const parkedNode = await side.ev(has(nodeSel(PARKED_ID)));
    rec(
        "the readings fill the band: 3 rows by RAM (3.2 GB, 1.9 GB, 420 MB), each with its heaviest process, Stop and Sleep agent, the third the idle agent the orbit has no node for, and the title bar's RAM figure is amber",
        rowsShown &&
            parkedNode === false &&
            got.band?.level === "amber" &&
            got.band.finding == null &&
            JSON.stringify(ids) === JSON.stringify(HEAVY_BY_RAM) &&
            got.band.rows.every((r) => r.stop && r.sleep && r.process != null) &&
            /3\.2 GB/.test(got.band.rows[0].text) &&
            got.band.rows[0].process.includes("node vite dev") &&
            /420 MB/.test(got.band.rows[2].text) &&
            got.ramTone === "amber" &&
            got.cpuTone === "normal" &&
            /2\.1 GB/.test(got.machine ?? ""),
        { ids, want: HEAVY_BY_RAM, parkedNode, rows: got.band?.rows, ramTone: got.ramTone, cpuTone: got.cpuTone, machine: got.machine }
    );

    // the CPU over 90% for 2 minutes (27 readings 5 s apart, fed in one go) with the memory fine: the band says so, the CPU
    // figure is amber and the rows are the CPU's, in the CPU's order
    await feedCpu(h);
    const cpuSaid = await waitFor(side.ev, `(document.querySelector("[data-sidecar-band-why]")?.textContent ?? "").includes("CPU over 90% for 2 min")`, 10_000);
    const cpuRows = await waitFor(side.ev, `JSON.stringify([...document.querySelectorAll("[data-sidecar-heavy]")].map((r) => r.dataset.sidecarHeavy)) === ${JSON.stringify(JSON.stringify(HEAVY_BY_CPU))}`, 10_000);
    got = await readBand(side);
    await shot(side, "band-cpu");
    rec(
        "the CPU over 90% for 2 minutes keeps the amber band up and says `CPU over 90% for 2 min`; the CPU figure turns amber, the memory one goes back to normal, and the rows are the CPU's (80%, 55%, 20%)",
        cpuSaid &&
            cpuRows &&
            got.band?.level === "amber" &&
            got.cpuTone === "amber" &&
            got.ramTone === "normal" &&
            got.band.rows.length === 3 &&
            /80%/.test(got.band.rows[0].text) &&
            /20%/.test(got.band.rows[2].text) &&
            got.band.rows.every((r) => r.stop && r.sleep),
        { cpuSaid, cpuRows, why: got.band?.why, rows: got.band?.rows, ramTone: got.ramTone, cpuTone: got.cpuTone, machine: got.machine }
    );

    // Stop asks in place, on the row, about the row's process; Cancel puts the buttons back and sends nothing
    const stopId = HEAVY_BY_CPU[0];
    const stopPid = HEAVY.find((x) => x.id === stopId).cpuPid;
    const before17 = await actCount(h);
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-heavy-stop]`);
    const asked = await waitFor(side.ev, has(`${rowSel(stopId)} [data-sidecar-confirm]`), 3000);
    const confirmText = (await side.ev(`document.querySelector(${JSON.stringify(`${rowSel(stopId)} [data-sidecar-confirm]`)})?.textContent ?? ""`)) ?? "";
    await shot(side, "band-stop-confirm");
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-confirm-cancel]`);
    const cancelled = await waitFor(side.ev, `!${has(`${rowSel(stopId)} [data-sidecar-confirm]`)} && ${has(`${rowSel(stopId)} [data-sidecar-heavy-stop]`)}`, 3000);
    await sleep(600);
    const strays = await actsSince(h, before17);
    rec(
        "Stop asks in place (`Stop <command>? … the agent keeps running.` with Stop and Cancel) and Cancel puts the row's buttons back with no act sent",
        asked && confirmText.includes("go test ./feed/...") && confirmText.includes("build ends; the agent keeps running") && cancelled && strays.length === 0,
        { asked, confirmText, cancelled, strays }
    );

    // Stop → Stop: the act names the row's process, the bridge does not run it (a fixture) and says so on the row
    const before18 = await actCount(h);
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-heavy-stop]`);
    await waitFor(side.ev, has(`${rowSel(stopId)} [data-sidecar-confirm]`), 3000);
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-confirm-stop]`);
    let acts18 = [];
    await until(async () => (acts18 = await actsSince(h, before18)).length > 0, 5000);
    const noted18 = await waitFor(side.ev, `(document.querySelector(${JSON.stringify(`${rowSel(stopId)} [data-sidecar-heavy-note]`)})?.textContent ?? "") === ${JSON.stringify(NOT_RUN)}`, 5000);
    got = await readBand(side);
    await shot(side, "band-stop-sent");
    rec(
        `confirming Stop sends one stop act for the row's process and the row says \`${NOT_RUN}\`, the confirm gone`,
        acts18.length === 1 &&
            acts18[0]?.kind === "stop" &&
            acts18[0].id === stopId &&
            acts18[0].pid === stopPid &&
            noted18 &&
            got.band?.rows.find((r) => r.id === stopId)?.confirm === false,
        { acts: acts18, wantPid: stopPid, noted: noted18, row: got.band?.rows.find((r) => r.id === stopId) }
    );

    // Sleep agent on another row: a sleep act for it and the same note
    const sleepId = HEAVY_BY_CPU[1];
    const before19 = await actCount(h);
    await clickIn(side, `${rowSel(sleepId)} [data-sidecar-heavy-sleep]`);
    let acts19 = [];
    await until(async () => (acts19 = await actsSince(h, before19)).length > 0, 5000);
    const noted19 = await waitFor(side.ev, `(document.querySelector(${JSON.stringify(`${rowSel(sleepId)} [data-sidecar-heavy-note]`)})?.textContent ?? "") === ${JSON.stringify(NOT_RUN)}`, 5000);
    await shot(side, "band-sleep-sent");
    rec(
        `Sleep agent on a row sends one sleep act for that agent and the row says \`${NOT_RUN}\``,
        acts19.length === 1 && acts19[0]?.kind === "sleep" && acts19[0].id === sleepId && noted19,
        { acts: acts19, noted: noted19 }
    );

    // the × hides the band until its level changes: it stays hidden through a rebuild, the readout stays amber
    await clickIn(side, "[data-sidecar-band-close]");
    const hid = await waitFor(side.ev, `!${has("[data-sidecar-band]")}`, 3000);
    await refresh(h);
    await sleep(1500);
    const stillHidden = await side.ev(`!${has("[data-sidecar-band]")}`);
    got = await readBand(side);
    await shot(side, "band-hidden");
    rec(
        "the × hides the band, and it stays hidden through the next reading while the level is the same; the title bar's CPU figure stays amber",
        hid && stillHidden === true && got.band == null && got.cpuTone === "amber",
        { hid, stillHidden, cpuTone: got.cpuTone }
    );

    // the pressure turns critical: the level changed, so the band is back, red, saying what is coming and naming the OS
    await setSeams(h, { machine: MACHINE_RED });
    await refresh(h);
    const red = await waitFor(side.ev, has('[data-sidecar-band][data-level="red"]'), 10_000);
    await waitFor(side.ev, `${countOf("[data-sidecar-heavy]")} === 3`, 5000);
    got = await readBand(side);
    await shot(side, "band-red");
    rec(
        `critical memory pressure shows the band again, red: \`The machine is about to run out of memory\`, \`RAM critical (0.6 GB free, swap 9.2 GB)\` and \`${OS_NAME} may start killing processes\`, the RAM figure red, the rows by RAM`,
        red &&
            got.band?.level === "red" &&
            got.band.title === "The machine is about to run out of memory" &&
            got.band.why.includes("RAM critical (0.6 GB free, swap 9.2 GB)") &&
            got.band.why.includes(`${OS_NAME} may start killing processes`) &&
            got.ramTone === "red" &&
            JSON.stringify(got.band.rows.map((r) => r.id)) === JSON.stringify(HEAVY_BY_RAM),
        { title: got.band?.title, why: got.band?.why, ramTone: got.ramTone, rows: got.band?.rows.map((r) => r.id), machine: got.machine }
    );

    // back to normal at 20% CPU: the band holds 30 s, steps down to amber, holds 30 s more and clears. A reading is taken
    // every 2.5 s here rather than waiting for the bridge's 5 s poll, so the hold is the only wait.
    await setSeams(h, { machine: MACHINE_CALM });
    const t0 = Date.now();
    await refresh(h);
    let first = "not read";
    let firstRead = false;
    let amberAfter = null;
    let goneAfter = null;
    while (Date.now() - t0 < 100_000) {
        const level = await side.ev(BAND_LEVEL);
        if (!firstRead) {
            first = level;
            firstRead = true;
        }
        if (level === "amber" && amberAfter == null) {
            amberAfter = Date.now() - t0;
            await shot(side, "band-steps-down");
        }
        if (level == null && amberAfter != null) {
            goneAfter = Date.now() - t0;
            break;
        }
        await sleep(2500);
        await refresh(h);
    }
    await sleep(500);
    got = await readBand(side);
    await shot(side, "band-clear");
    rec(
        "back to a calm machine the red band holds, steps down to amber after 30 s, and clears 30 s after that, with both figures normal again",
        first === "red" && amberAfter != null && amberAfter >= 29_000 && goneAfter != null && goneAfter >= 59_000 && got.band == null && got.ramTone === "normal" && got.cpuTone === "normal",
        { first, amberAfterMs: amberAfter, goneAfterMs: goneAfter, ramTone: got.ramTone, cpuTone: got.cpuTone }
    );
}

// P's five states and its keys, then P-live
async function orbitStates(h, ctx, side, rec, shot) {
    // the band steps loaded the roster at arrange: each state builds its own, dated now (a finished agent leaves the orbit
    // 5 minutes after it finished)
    ctx.rosterKind = null;

    // P-calm (board P-calm): nothing waits, so nothing moves: the core says 0, the frame is off and no ring pings
    await applyState(h, ctx, "calm");
    let settled = await settleState(side, "calm", "orbit");
    let got = await readDash(side);
    await shot(side, "p-calm");
    rec(
        "P-calm (board P-calm): with nothing waiting the page is calm: the core reads 0 in muted, `All clear` in the Needs you box, no alert frame, and not one element has `animate-sidecar-ping`",
        settled &&
            shapeOk("calm", got, "orbit") &&
            got.allClear != null &&
            got.allClear.includes("All clear") &&
            got.pingCount === 0 &&
            got.band == null &&
            got.run != null,
        { state: got.state, frame: got.frame, core: got.core, allClear: got.allClear, pingCount: got.pingCount, nodes: got.nodes.map((n) => n.id), needs: got.needs.map((n) => n.key) }
    );

    // P-orbit-dashboard (board P-orbit-dashboard): 2 asks, a question and a gate wait on you
    await applyState(h, ctx, "normal");
    settled = await settleState(side, "normal", "orbit");
    got = await readDash(side);
    await shot(side, "p-orbit-dashboard");
    const askRow = row(got, NEED.ask);
    const questionRow = row(got, NEED.question);
    const pingingNodes = [ASK_ID, MULTI_ID, QUESTION_ID];
    const quietNodes = [WORK_ID, WORK2_ID, DONE_ID];
    rec(
        "P-orbit-dashboard (board P-orbit-dashboard): the core counts 4 (2 asks, 1 question, 1 gate) over the rows oldest first, the question row reads `Bạn chọn (a) hay (b)?` with `Enter: reply in the main window`, the answerable ask `1 Merge · 2 Keep the branch`, and the frame is off",
        settled &&
            shapeOk("normal", got, "orbit") &&
            askRow?.text === ASK_QUESTION &&
            askRow.how === ASK_OPTIONS.map((o, i) => `${i + 1} ${o}`).join(" · ") &&
            questionRow?.text === QUESTION_ROW &&
            questionRow.how === "Enter: reply in the main window" &&
            row(got, NEED.multi)?.how === "Enter: reply in the main window" &&
            row(got, NEED.gate)?.how === "Enter: open in the main window",
        { state: got.state, frame: got.frame, core: got.core, rows: got.needs.map((n) => ({ key: n.key, text: n.text, how: n.how })) }
    );
    rec(
        "P-orbit-dashboard: at most 8 nodes (here 6, none for the two parked agents), one lane per node in the same order, the lead's line reads `run · 7 of 9`, and the run box says `7 of 9 tasks`",
        got.nodes.length <= ORBIT_MAX &&
            !got.nodes.some((n) => PARKED_IDS.includes(n.id)) &&
            JSON.stringify(got.lanes.map((l) => l.id)) === JSON.stringify(got.nodes.map((n) => n.id)) &&
            /run · 7 of 9 · 1h \d+m/.test(drawnOf(got, WORK_ID)?.line ?? "") &&
            got.run != null &&
            got.run.text.includes("7 of 9 tasks") &&
            got.run.failed === false &&
            got.band == null,
        { nodes: got.nodes.map((n) => n.id), lanes: got.lanes.map((l) => l.id), lead: drawnOf(got, WORK_ID)?.line, run: got.run }
    );
    rec(
        "P-orbit-dashboard: each asking node, the finished agent with a question and each ask or question row carries `animate-sidecar-ping`, and no working or quiet finished node does",
        pingingNodes.every((id) => drawnOf(got, id)?.ping === true) &&
            quietNodes.every((id) => drawnOf(got, id)?.ping === false) &&
            [NEED.ask, NEED.multi, NEED.question].every((key) => row(got, key)?.ping === true),
        { nodes: got.nodes.map((n) => `${n.id}:${n.tone}:${n.ping}`), rows: got.needs.map((n) => `${n.key}:${n.ping}`) }
    );

    // the keys (real key events): ArrowDown selects the first row, which is the answerable ask, and 2 answers it with its
    // second option (`option` is 0-based: key 2 sends 1); ArrowDown again to the gate and Enter opens it in the main window
    const before = await actCount(h);
    await press(side, "ArrowDown");
    await sleep(300);
    const selectedFirst = (await readDash(side)).needs.find((n) => n.selected)?.key ?? null;
    await press(side, "2");
    let answered = [];
    await until(async () => (answered = await actsSince(h, before)).length > 0, 5000);
    const sentShown = await waitFor(side.ev, `[...document.querySelectorAll(${JSON.stringify(needSel(NEED.ask))})].some((r) => r.textContent.includes("Sent"))`, 5000);
    // an answer that went out no longer waits: the row and the node of that ask stop pinging
    const sentView = await readDash(side);
    const sentQuiet = row(sentView, NEED.ask)?.ping === false && drawnOf(sentView, ASK_ID)?.ping === false;
    let toGate = null;
    for (let i = 0; i < 5 && toGate !== NEED.gate; i++) {
        await press(side, "ArrowDown");
        await sleep(250);
        toGate = (await readDash(side)).needs.find((n) => n.selected)?.key ?? null;
    }
    await shot(side, "p-keys");
    const beforeEnter = await actCount(h);
    await press(side, "Enter");
    let entered = [];
    await until(async () => (entered = await actsSince(h, beforeEnter)).length > 0, 5000);
    rec(
        "P-orbit-dashboard keys: ArrowDown selects the answerable ask, 2 sends `{answer, option: 1}` naming its ask and the row then says Sent and, with its node, stops pinging, and Enter on the gate sends `{need, key}`",
        selectedFirst === NEED.ask &&
            answered.length === 1 &&
            answered[0]?.kind === "answer" &&
            answered[0].id === ASK_ID &&
            answered[0].option === 1 &&
            answered[0].key === askIdOf(ASK_ID, ctx.tag) &&
            sentShown &&
            sentQuiet &&
            toGate === NEED.gate &&
            entered.length === 1 &&
            entered[0]?.kind === "need" &&
            entered[0].key === NEED.gate,
        { selectedFirst, answered, sentShown, sentQuiet, toGate, entered }
    );
    // the gate opened in the main window (a fixture run: it may say so in a toast): back on the Cockpit
    await h.goto("cockpit");

    // P-high (board P-high): the memory pressure turns high: the band shows and the run box steps aside
    await applyState(h, ctx, "high");
    settled = await settleState(side, "high", "orbit");
    await waitFor(side.ev, `${countOf("[data-sidecar-heavy]")} === 3`, 8000);
    got = await readDash(side);
    await shot(side, "p-high");
    rec(
        "P-high (board P-high): at RAM high the state is `high` with a 3 px warning frame, the amber band shows and the run box does not, and the core reads `⚠ RAM high`",
        settled &&
            shapeOk("high", got, "orbit") &&
            got.band?.level === "amber" &&
            got.run == null &&
            got.coreAlert === "⚠ RAM high",
        { state: got.state, frame: got.frame, band: got.band, run: got.run, coreAlert: got.coreAlert }
    );

    // P-critical (board P-critical): RAM critical with one heavy agent: the band is red, the heavy node names its weight
    await applyState(h, ctx, "critical");
    settled = await settleState(side, "critical", "orbit");
    await waitFor(side.ev, `${countOf("[data-sidecar-heavy]")} === 1`, 8000);
    got = await readDash(side);
    await shot(side, "p-critical");
    rec(
        "P-critical (board P-critical): at RAM critical the state is `critical` with an error frame, the red band has Stop and Sleep, the core reads `⚠ RAM critical`, and the heavy agent's node says `3.2 GB · node vite dev`",
        settled &&
            shapeOk("critical", got, "orbit") &&
            got.band?.level === "red" &&
            got.band.stop &&
            got.band.sleep &&
            got.run == null &&
            got.coreAlert === "⚠ RAM critical" &&
            drawnOf(got, WORK_ID)?.heavy === "3.2 GB · node vite dev" &&
            got.nodes.filter((n) => n.heavy != null).length === 1,
        { state: got.state, frame: got.frame, band: got.band, coreAlert: got.coreAlert, heavy: got.nodes.filter((n) => n.heavy != null).map((n) => `${n.id}: ${n.heavy}`) }
    );

    // P-failed (board P-failed): RAM back to normal; a task of the run failed, and it fails the run
    await applyState(h, ctx, "failed");
    settled = await settleState(side, "failed", "orbit");
    // A fixture run has no engine events to date its failure, so the lead's lane turns red from the build that saw it, and
    // that red span starts at the bridge's Date.now(), a moment after the snapshot's own `now`: `laneBars` clamps an open
    // span's start to the page's `now`, so the bar draws with the snapshot, not on the page's next 30 s clock tick
    const redBarAt = Date.now();
    const redBar = await waitFor(
        side.ev,
        `[...(document.querySelector(${JSON.stringify(`[data-sidecar-lane="${WORK_ID}"]`)})?.querySelectorAll("[data-span-state]") ?? [])].at(-1)?.dataset.spanState === "failed"`,
        REACT_MS,
        100
    );
    const redBarMs = Date.now() - redBarAt;
    await sleep(600);
    got = await readDash(side);
    await shot(side, "p-failed");
    const lead = drawnOf(got, WORK_ID);
    const leadLane = got.lanes.find((l) => l.id === WORK_ID);
    rec(
        "P-failed (board P-failed): with a task of the run failed the state is `failed` with an error frame and the core in error (`1 run failed`); the first row leads with Failed on `bg-errorbg`, the lead's node is `error` and pings, and its lane's last bar is failed (with the snapshot, no clock tick needed)",
        settled &&
            redBar &&
            shapeOk("failed", got, "orbit") &&
            got.coreFailed === "1 run failed" &&
            got.needs[0]?.failed === true &&
            got.needs[0].leadsFailed === true &&
            got.needs[0].tinted === true &&
            lead?.tone === "error" &&
            lead.ping === true &&
            leadLane?.bars.at(-1) === "failed" &&
            got.run?.failed === true &&
            got.band == null,
        { state: got.state, frame: got.frame, core: got.core, coreFailed: got.coreFailed, first: got.needs[0], lead, leadLane, run: got.run, redBarAfterMs: redBarMs }
    );

    // P-live (board P-live): normal → high → critical → normal → failed through the seams with no reload; each change
    // reaches the page within 2 s, and the row that arrives is added to the list, not drawn over a new one
    await applyState(h, ctx, "normal");
    await settleState(side, "normal", "orbit");
    await side.ev(`(() => { const r = document.querySelector(${JSON.stringify(needSel(NEED.multi))}); if (r) r.dataset.probe = "1"; })()`);
    const live = [];
    const transitions = [
        [
            "high",
            async () => {
                await resetStrain(h);
                await setSeams(h, { machine: MACHINE_AMBER, heavy: heavyFixture() });
                await refresh(h);
            },
        ],
        [
            "critical",
            async () => {
                await setSeams(h, { machine: MACHINE_RED, heavy: heavyOne() });
                await refresh(h);
            },
        ],
        [
            "normal",
            async () => {
                await resetStrain(h);
                await setSeams(h, { machine: MACHINE_CALM, heavy: null });
                await refresh(h);
            },
        ],
        ["failed", () => setAttention(h, STATES.failed.attention(ctx.rosterNow))],
    ];
    for (const [name, change] of transitions) {
        const t0 = Date.now();
        await change();
        const reached = await waitFor(
            side.ev,
            `(() => { const d = document.querySelector("[data-sidecar-dashboard=orbit]"); return d?.dataset.sidecarState === ${JSON.stringify(name)} && d.dataset.sidecarFrame === ${JSON.stringify(STATES[name].frame)}; })()`,
            REACT_MS,
            100
        );
        live.push({ name, reached, ms: Date.now() - t0 });
        await shot(side, `p-live-${name}`);
    }
    const probe = await side.ev(`document.querySelector('[data-probe="1"]')?.dataset.sidecarNeed ?? null`);
    const after = await readDash(side);
    rec(
        "P-live (board P-live): through normal → high → critical → normal → failed the page follows each change within 2 s with no reload (state and frame), and the failed row arrives as a new row: the row marked before is the same element after, the list one longer",
        live.every((l) => l.reached) &&
            probe === NEED.multi &&
            after.needs.length === STATES.failed.needs.length &&
            after.needs[0]?.key === NEED.failed,
        { live, probe, needs: after.needs.map((n) => n.key) }
    );
}

// ---- sidecar-compact --------------------------------------------------------------------------------------------------

// Q's five states in the real small window, then its keys
async function compactStates(h, ctx, side, rec, shot) {
    ctx.rosterKind = null;
    for (const name of ["calm", "normal", "high", "critical", "failed"]) {
        await applyState(h, ctx, name);
        const settled = await settleState(side, name, "compact");
        if (STATES[name].strain != null) await waitFor(side.ev, has("[data-sidecar-strainline] [data-sidecar-heavy-stop]"), 8000);
        const got = await readDash(side);
        await shot(side, `q-${name}`);
        const spec = STATES[name];
        const common = settled && shapeOk(name, got, "compact") && got.dots.length === orbitIdsOf(name).length;
        const strainWanted = spec.strain != null;
        // the strain is one line with the heaviest job's Stop and Sleep, only in high and critical
        const strainOk =
            strainWanted === (got.strainLine != null) &&
            (!strainWanted ||
                (got.strainLine.level === spec.strain && got.strainLine.title.startsWith(spec.strain === "red" ? "RAM critical" : "RAM high") && got.strainLine.stop && got.strainLine.sleep));
        // a waiting row and its dot ping (the asks, and the question row's agent); a quiet dot does not
        const pingOk =
            name !== "normal" ||
            ([NEED.ask, NEED.multi, NEED.question].every((key) => row(got, key)?.ping === true) &&
                [ASK_ID, MULTI_ID, QUESTION_ID].every((id) => drawnOf(got, id)?.ping === true) &&
                [WORK_ID, WORK2_ID, DONE_ID].every((id) => drawnOf(got, id)?.ping === false));
        let extra = true;
        let what = "";
        switch (name) {
            case "calm":
                what = "Q-calm: with nothing waiting the page shows `All clear` and `Nothing waits on you.`, the core reads 0, no frame, one dot per agent (3) and no strain line";
                extra = got.allClear != null && got.allClear.includes("All clear") && got.allClear.includes("Nothing waits on you.") && got.pingCount === 0 && got.coreWords === "0 need you";
                break;
            case "normal":
                what = "Q-normal: the core reads 4 with `4 need you`, four rows oldest first (the question reads `Bạn chọn (a) hay (b)?`, the answerable ask `1 Merge · 2 Keep the branch`), the ask rows and the question row ping, one dot per agent (6), `Run 7 of 9`, no strain line";
                extra =
                    got.allClear == null &&
                    got.coreWords === "4 need you" &&
                    row(got, NEED.question)?.text === QUESTION_ROW &&
                    row(got, NEED.ask)?.how === ASK_OPTIONS.map((o, i) => `${i + 1} ${o}`).join(" · ") &&
                    /^Run 7 of 9/.test(got.run?.text ?? "");
                break;
            case "high":
                what = "Q-high: at RAM high the state is `high` with a warning frame, the strain is one line (`RAM high`) with the heaviest job's Stop and Sleep, and the core's RAM line reads `⚠ RAM high`";
                extra = got.allClear == null && /⚠ RAM high/.test(await side.ev(`document.querySelector("[data-sidecar-ram]")?.textContent ?? ""`));
                break;
            case "critical":
                what = "Q-critical: at RAM critical the state is `critical` with an error frame, the strain line is red (`RAM critical`) with Stop and Sleep, and the core's RAM line reads `⚠ RAM critical`";
                extra = got.allClear == null && /⚠ RAM critical/.test(await side.ev(`document.querySelector("[data-sidecar-ram]")?.textContent ?? ""`));
                break;
            default:
                what = "Q-failed: with a task of the run failed the state is `failed` with an error frame, the core reads 5 with `5 need you · 1 failed` in error, the first row leads with Failed on `bg-errorbg`, the run line says `Run 7 of 9 · failed`, and there is no strain line";
                extra =
                    got.coreWords === "5 need you · 1 failed" &&
                    got.needs[0]?.failed === true &&
                    got.needs[0].leadsFailed === true &&
                    got.needs[0].tinted === true &&
                    got.run?.failed === true &&
                    got.run.text === "Run 7 of 9 · failed";
        }
        rec(
            `${what} (board Q-compact-live)`,
            common && strainOk && pingOk && extra,
            {
                state: got.state,
                frame: got.frame,
                core: got.core,
                words: got.coreWords,
                rows: got.needs.map((n) => `${n.key}${n.failed ? " (failed)" : ""}${n.ping ? " ~" : ""}`),
                dots: got.dots.map((d) => `${d.id}:${d.tone}${d.ping ? " ~" : ""}`),
                allClear: got.allClear,
                strainLine: got.strainLine,
                run: got.run,
                size: { w: got.w, h: got.h },
                overflows: got.overflows,
            }
        );
    }

    // Q's keys, from the normal state: ArrowDown selects the first row, the answerable ask; 1 answers it with its first
    // option (`option` 0); the question row is answered in the main window, where a digit sends nothing
    await applyState(h, ctx, "normal");
    await settleState(side, "normal", "compact");
    const before = await actCount(h);
    await press(side, "ArrowDown");
    await sleep(300);
    const first = (await readDash(side)).needs.find((n) => n.selected)?.key ?? null;
    await press(side, "1");
    let answered = [];
    await until(async () => (answered = await actsSince(h, before)).length > 0, 5000);
    // the answer went out: the ask's row and its dot stop pinging once the main window's next snapshot marks it sent.
    // Q shows no `Sent` to wait on as P does, so wait on the ping itself: a fixed 400 ms read it before the snapshot came
    const quiet = (got) => row(got, NEED.ask)?.ping === false && drawnOf(got, ASK_ID)?.ping === false;
    let sentView = await readDash(side);
    await until(async () => quiet((sentView = await readDash(side))), 5000);
    const sentQuiet = quiet(sentView);
    await press(side, "ArrowDown");
    await press(side, "ArrowDown");
    await press(side, "ArrowDown");
    await sleep(300);
    const onQuestion = (await readDash(side)).needs.find((n) => n.selected)?.key ?? null;
    const mark = await actCount(h);
    await press(side, "1");
    await sleep(900);
    const strays = await actsSince(h, mark);
    await shot(side, "q-keys");
    await press(side, "Enter");
    let opens = [];
    await until(async () => (opens = await actsSince(h, mark)).length > 0, 5000);
    rec(
        "Q's keys: ArrowDown selects the answerable ask and 1 sends `{answer, option: 0}` naming its ask, after which its row and dot stop pinging; on the question row a digit sends nothing and Enter opens its agent in the main window",
        first === NEED.ask &&
            answered.length === 1 &&
            answered[0]?.kind === "answer" &&
            answered[0].id === ASK_ID &&
            answered[0].option === 0 &&
            answered[0].key === askIdOf(ASK_ID, ctx.tag) &&
            sentQuiet &&
            onQuestion === NEED.question &&
            strays.length === 0 &&
            opens.length === 1 &&
            opens[0]?.kind === "open" &&
            opens[0].id === QUESTION_ID,
        { first, answered, sentQuiet, onQuestion, strays, opens }
    );
    // Enter opened the agent in the main window: back on the Cockpit
    await h.goto("cockpit");
}

// ---- the scenarios ----------------------------------------------------------------------------------------------------

// best-effort, so one failed step does not strand the rest
async function teardown(name, h, ctx) {
    const step = async (what, fn) => {
        try {
            await fn();
        } catch (e) {
            console.error(`${name} teardown: ${what} failed: ${e?.message ?? e}`);
        }
    };
    await step("clear the hold, the seams and the act log", () =>
        h.ev(`(() => {
            window.__sidecarHold = false;
            window.__sidecarAttention?.(null);
            window.__sidecarRun?.(null);
            delete window.__sidecarActs;
            delete window.__sidecarMachine;
            delete window.__sidecarHeavy;
        })()`)
    );
    // a window the scenario opened but never attached to (the attach failed) is found again by url
    if (ctx.opened && ctx.side == null) {
        await step("find the Sidecar window", async () => {
            ctx.side = await attachByUrl(SIDECAR_URL, { pageReady: SIDECAR_READY, shots: h.shots, waitMs: 1500 });
        });
    }
    if (ctx.side != null) {
        const side = ctx.side;
        // a step that failed between S and S again leaves the real window small and on top of everything: put it back (the
        // host's own command, as the buttons call it), before full screen is looked at
        await step("leave the small form and unpin", async () => {
            let form = await sidecarForm(side, null);
            if (form?.small) form = await sidecarForm(side, { small: false });
            if (form?.pinned) await sidecarForm(side, { pinned: false });
        });
        await step("leave full screen", async () => {
            if (await isFullscreen(side)) await windowCall(side, "set_fullscreen", { value: false });
        });
        await step("clear the device override", () => side.cdp("Emulation.clearDeviceMetricsOverride", {}));
        // the title bar's own close is the person's close: the host keeps Sidecar shut at the next launch
        await step("close Sidecar", () => side.ev(`document.querySelector('[data-sidecar-btn="close"]')?.click()`));
        await sleep(500);
        await step("detach", () => side.close());
    }
    await step("put the roster file back", () => {
        if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
        else rmSync(FIXTURE, { force: true });
    });
    // an absent file leaves the atom on the last roster, so the page itself is reloaded onto the live one
    await step("reload onto the live roster", () => h.reload());
    await step("go home", () => h.goto("cockpit"));
}

// the roster, the seams and the run every state starts from: the full roster with its gate, a calm machine, the run
async function arrange(name, tag, h) {
    const ctx = { prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null, side: null, opened: false, tag, rosterKind: null };
    // a throw past this point still returns ctx, so teardown puts back whatever was already changed
    try {
        ctx.now = Date.now();
        ctx.rosterNow = ctx.now;
        // the seams of an earlier run that did not tear down would shape the first snapshot
        await h.ev("window.__sidecarHold = false; window.__sidecarActs = []; delete window.__sidecarMachine; delete window.__sidecarHeavy");
        const seamsHere = await h.ev(`typeof window.__sidecarAttention === "function" && typeof window.__sidecarRun === "function" && typeof window.__sidecarFeed === "function"`);
        if (seamsHere !== true) throw new Error("the main page has no Sidecar bridge seams (window.__sidecarAttention / __sidecarRun / __sidecarFeed): is it a dev build?");
        await loadRoster(h, dashboardRoster(ctx.rosterNow, tag, "full"));
        ctx.rosterKind = "full";
        await setSeams(h, { machine: MACHINE_CALM, heavy: null });
        await setAttention(h, STATES.normal.attention(ctx.rosterNow));
        await setRun(h, runBox(ctx.now - 94 * MIN));
    } catch (e) {
        ctx.arrangeError = String(e?.message ?? e);
    }
    return ctx;
}

export default function () {
    return [
        {
            name: ORBIT,
            surface: "cockpit",
            host: true,
            // the surface's own shot would be the main cockpit; every shot of this scenario is Sidecar's
            gotoShot: false,
            arrange: (h) => arrange(ORBIT, "o", h),
            async assert(h, ctx) {
                const { steps, rec } = recorder();
                if (ctx.arrangeError != null) {
                    rec("the fixture roster is in place", false, ctx.arrangeError);
                    return steps;
                }
                const shot = (side, name) => side.shot(`cdp-shots/${ORBIT}-${name}.png`);
                try {
                    const openedAt = Date.now();
                    const side = await openSidecar(h, ctx, rec);
                    if (side == null) return steps;

                    await taskbarIdStep(rec, openedAt);
                    await windowCallsStep(side, rec);
                    // only now pin the page: every shape assert below is made at 1920x1080
                    await side.cdp("Emulation.setDeviceMetricsOverride", ORBIT_VIEWPORT);
                    await sleep(400);

                    // before the first snapshot the page says it is waiting, with the title bar and no dashboard; clearing the
                    // hold lets the page's next hello through and the dashboard appears within 5 s
                    await h.ev("window.__sidecarHold = true");
                    await side.reload();
                    await side.cdp("Emulation.setDeviceMetricsOverride", ORBIT_VIEWPORT);
                    // past the page's 2 s hello resend, so a hold that let one through would show here
                    await sleep(2600);
                    const waiting = await readDash(side);
                    await shot(side, "waiting");
                    await h.ev("window.__sidecarHold = false");
                    const dashShown = await waitFor(side.ev, has('[data-sidecar-dashboard="orbit"]'), 5000);
                    rec(
                        "before its first snapshot the page shows its waiting state (title bar, no dashboard, no core); with the hold cleared the orbit dashboard appears within 5s",
                        waiting.waiting && waiting.titlebar && waiting.kind == null && waiting.core == null && dashShown,
                        { waiting: waiting.waiting, titlebar: waiting.titlebar, kind: waiting.kind, core: waiting.core, dashShown }
                    );

                    // F11 toggles full screen: on, then off after a second press
                    const startedFullscreen = await isFullscreen(side);
                    await press(side, "F11");
                    const on = await until(async () => (await isFullscreen(side)) === !startedFullscreen, 5000);
                    const afterFirst = await isFullscreen(side);
                    await press(side, "F11");
                    const off = await until(async () => (await isFullscreen(side)) === startedFullscreen, 5000);
                    const afterSecond = await isFullscreen(side);
                    rec("F11 toggles full screen: isFullscreen() is true after one press and false after a second", startedFullscreen === false && on && afterFirst === true && off && afterSecond === false, {
                        startedFullscreen,
                        afterFirst,
                        afterSecond,
                    });
                    await sleep(500);

                    await bandSteps(h, side, rec, shot);

                    // the agents the Cockpit folds into its Idle list (idle 40 min, asleep) have no node, and the orbit holds the
                    // rest, with a lane each
                    const parkedGot = await readDash(side);
                    await shot(side, "parked");
                    rec(
                        `the agents the Cockpit folds into its Idle list (idle 40 min, asleep) have no node: the orbit holds the other ${ORBIT_FULL.length} in order, each with a lane, and the core's line counts the 4 idle (2 finished, 2 parked)`,
                        JSON.stringify(parkedGot.nodes.map((n) => n.id)) === JSON.stringify(ORBIT_FULL) &&
                            !parkedGot.nodes.some((n) => PARKED_IDS.includes(n.id)) &&
                            JSON.stringify(parkedGot.lanes.map((l) => l.id)) === JSON.stringify(ORBIT_FULL) &&
                            (await side.ev(`document.body.textContent.includes("4 idle")`)) === true,
                        { nodes: parkedGot.nodes.map((n) => n.id), lanes: parkedGot.lanes.map((l) => l.id) }
                    );

                    await orbitStates(h, ctx, side, rec, shot);
                } catch (e) {
                    rec("the steps ran to the end", false, String(e?.message ?? e));
                }
                return steps;
            },
            teardown: (h, ctx) => teardown(ORBIT, h, ctx),
        },
        {
            name: COMPACT,
            surface: "cockpit",
            host: true,
            gotoShot: false,
            arrange: (h) => arrange(COMPACT, "c", h),
            async assert(h, ctx) {
                const { steps, rec } = recorder();
                if (ctx.arrangeError != null) {
                    rec("the fixture roster is in place", false, ctx.arrangeError);
                    return steps;
                }
                const shot = (side, name) => side.shot(`cdp-shots/${COMPACT}-${name}.png`);
                try {
                    const side = await openSidecar(h, ctx, rec);
                    if (side == null) return steps;

                    // a Sidecar left small or pinned by an earlier run would turn the S button's first press into a restore
                    const start = await sidecarForm(side, null);
                    if (start?.small) await sidecarForm(side, { small: false });
                    if ((await sidecarForm(side, null))?.pinned) await sidecarForm(side, { pinned: false });
                    await side.cdp("Emulation.clearDeviceMetricsOverride", {});
                    await waitFor(side.ev, has("[data-sidecar-dashboard]"), 15_000);

                    // narrower than 1100 px (900 wide, by the device override) the page is the small form: the compact dashboard
                    await side.cdp("Emulation.setDeviceMetricsOverride", NARROW_VIEWPORT);
                    const compactShown = await waitFor(side.ev, has('[data-sidecar-dashboard="compact"]'), 5000);
                    await settleState(side, "normal", "compact");
                    let got = await readDash(side);
                    await shot(side, "narrow");
                    rec(
                        "at 900 px wide the page is the small form: the compact dashboard (`data-sidecar-dashboard=\"compact\"`), no orbit, the core and the rows of the normal state, S and the pin both unpressed",
                        compactShown &&
                            got.layout === "small" &&
                            got.kind === "compact" &&
                            !(await side.ev(has('[data-sidecar-dashboard="orbit"]'))) &&
                            got.core?.n === "4" &&
                            JSON.stringify(got.needs.map((n) => n.key)) === JSON.stringify(STATES.normal.needs) &&
                            got.s === "false" &&
                            got.pin === "false",
                        { layout: got.layout, kind: got.kind, core: got.core, rows: got.needs.map((n) => n.key), s: got.s, pin: got.pin }
                    );

                    // S: the real window shrinks to 340x440, the compact dashboard shows, S and the pin read pressed, the host
                    // says small and pinned, the title bar fits and keeps only S, the pin and close; the main window's size and
                    // focus do not move
                    await side.cdp("Emulation.clearDeviceMetricsOverride", {});
                    await sleep(600);
                    const beforeS = await innerSize(side);
                    const mainBeforeS = await mainState(h);
                    await clickIn(side, '[data-sidecar-btn="small"]');
                    const shrunk = await until(async () => {
                        const s = await innerSize(side);
                        return near(s.w, MIN_WINDOW.w) && near(s.h, MIN_WINDOW.h);
                    }, 10_000);
                    await waitFor(side.ev, `document.querySelector('[data-sidecar-btn="pin"]')?.getAttribute("aria-pressed") === "true"`, 5000);
                    await sleep(500);
                    got = await readDash(side);
                    let form = await sidecarForm(side, null);
                    let mainNow = await mainState(h);
                    await shot(side, "small-s");
                    rec(
                        "S shrinks the window to 340x440 and pins it: the compact dashboard shows, S and the pin are pressed, the host's form says small and pinned, the title bar fits and shows no minimize, maximize or full screen, and the main window's size and focus are untouched",
                        shrunk &&
                            near(got.w, MIN_WINDOW.w) &&
                            near(got.h, MIN_WINDOW.h) &&
                            got.layout === "small" &&
                            got.kind === "compact" &&
                            got.s === "true" &&
                            got.pin === "true" &&
                            form?.small === true &&
                            form.pinned === true &&
                            got.bar != null &&
                            got.bar.scrollW <= got.bar.clientW &&
                            got.windowButtons.length === 0 &&
                            mainNow.w === mainBeforeS.w &&
                            mainNow.h === mainBeforeS.h &&
                            mainNow.focus === mainBeforeS.focus,
                        { beforeS, after: { w: got.w, h: got.h }, s: got.s, pin: got.pin, form, bar: got.bar, windowButtons: got.windowButtons, overflows: got.overflows, mainBeforeS, mainNow }
                    );

                    // Q-compact-live: the five states in turn in that window, and the keys
                    await compactStates(h, ctx, side, rec, shot);

                    // the pin button turns the pin off and on, and aria and the host's form follow each press
                    const pinState = async () => ({
                        form: await sidecarForm(side, null),
                        aria: await side.ev(`document.querySelector('[data-sidecar-btn="pin"]')?.getAttribute("aria-pressed") ?? null`),
                    });
                    await clickIn(side, '[data-sidecar-btn="pin"]');
                    const off = await until(async () => {
                        const p = await pinState();
                        return p.form?.pinned === false && p.aria === "false";
                    }, 5000);
                    const offState = await pinState();
                    await clickIn(side, '[data-sidecar-btn="pin"]');
                    const on = await until(async () => {
                        const p = await pinState();
                        return p.form?.pinned === true && p.aria === "true";
                    }, 5000);
                    const onState = await pinState();
                    await shot(side, "small-pin");
                    rec(
                        "the pin button unpins and pins again: aria-pressed and the host's form follow each press, and the window stays in the small form",
                        off && on && offState.form?.small === true && onState.form?.small === true,
                        { off: offState, on: onState }
                    );

                    // S again puts the window back to the size read before S, in P if that size is wide enough, unpinned
                    const mainBeforeBack = await mainState(h);
                    await clickIn(side, '[data-sidecar-btn="small"]');
                    const back = await until(async () => {
                        const s = await innerSize(side);
                        return near(s.w, beforeS.w) && near(s.h, beforeS.h);
                    }, 10_000);
                    await sleep(700);
                    got = await readDash(side);
                    form = await sidecarForm(side, null);
                    mainNow = await mainState(h);
                    await shot(side, "back");
                    const wantLayout = beforeS.w >= SMALL_BREAK_PX ? "wall" : "small";
                    const wantKind = wantLayout === "wall" ? "orbit" : "compact";
                    rec(
                        `S again returns the window to the size it had before S, unpinned and out of the small form, showing the ${wantKind} dashboard at that width, with the main window's size and focus untouched`,
                        back &&
                            near(got.w, beforeS.w) &&
                            near(got.h, beforeS.h) &&
                            form?.small === false &&
                            form.pinned === false &&
                            got.s === "false" &&
                            got.layout === wantLayout &&
                            got.kind === wantKind &&
                            got.pin === "false" &&
                            mainNow.w === mainBeforeBack.w &&
                            mainNow.h === mainBeforeBack.h &&
                            mainNow.focus === mainBeforeBack.focus,
                        { beforeS, after: { w: got.w, h: got.h }, form, layout: got.layout, kind: got.kind, wantLayout, s: got.s, pin: got.pin, mainBeforeBack, mainNow }
                    );

                    // with nothing waiting the compact dashboard says so in one line: the calm roster, at a narrow width. The
                    // main window is the size it was before S the whole way through.
                    await side.cdp("Emulation.setDeviceMetricsOverride", NARROW_VIEWPORT);
                    await sleep(400);
                    await applyState(h, ctx, "calm");
                    const calmShown = await waitFor(side.ev, has("[data-sidecar-allclear]"), 10_000);
                    await sleep(600);
                    got = await readDash(side);
                    mainNow = await mainState(h);
                    await shot(side, "small-calm");
                    rec(
                        "with nothing waiting the compact dashboard shows `All clear` and `Nothing waits on you.` and no row, its core reads 0, and the main window's size is what it was before S",
                        calmShown &&
                            got.layout === "small" &&
                            got.kind === "compact" &&
                            got.allClear?.includes("All clear") === true &&
                            got.allClear.includes("Nothing waits on you.") &&
                            got.needs.length === 0 &&
                            got.core?.n === "0" &&
                            mainNow.w === mainBeforeS.w &&
                            mainNow.h === mainBeforeS.h,
                        { allClear: got.allClear, rows: got.needs.length, core: got.core, mainBeforeS, mainNow }
                    );
                } catch (e) {
                    rec("the steps ran to the end", false, String(e?.message ?? e));
                }
                return steps;
            },
            teardown: (h, ctx) => teardown(COMPACT, h, ctx),
        },
    ];
}
