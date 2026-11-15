// sidecar-wall: the Sidecar window's wall (docs/superpowers/specs/2026-11-13-sidecar-design.md, sections 1-3 and Testing;
// prototype board D-fit-by-count.dc.html). It drives the real Tauri host (a host: true scenario): Ctrl+P → Open Sidecar
// opens the second window, whose page this attaches to by url (attach.mjs attachByUrl) next to the main page, and the
// roster is a generated fixture (public/cockpit-fixtures/active.json, loaded with window.__reloadDevMockRoster) of n
// agents in mixed states: the bridge in the main window turns it into the snapshot the page draws.
//
// The test seams are the bridge's DEV ones (frontend/app/cockpit/sidecarbridge.tsx): window.__sidecarActs on the main
// page holds every act the page sent, and window.__sidecarHold = true stops the bridge so the page stays on its waiting
// state. Real keys go to the Sidecar page with Input.dispatchKeyEvent. It changes only the roster file and the two
// windows; teardown puts the file back, closes Sidecar with its own close button (so it does not reopen at the next
// launch) and reloads the main page onto the live roster. Step 2 does not assert the 340x440 minimum: see its comment.
//
// Part 2 (docs/superpowers/plans/2026-11-16-sidecar-part-2.md, task 9) adds steps 14-30 after step 13, on a roster of its
// own (`part2`: part 1's four agents, a scroll agent with 14 message rows, and a second asleep agent whose transcript is
// the checked-in fixtures/sidecar-tail.jsonl, so the bridge's real tail read runs). The strain band is driven through the
// bridge's DEV seams on the main page, none of which waits on a poll: window.__sidecarMachine (the machine reading, and
// the memorypressure event while it is set), window.__sidecarHeavy (the consumers and per-agent CPU readings; with it set
// a Stop or Sleep act is logged and not run, and the row's note says so), window.__sidecarRefresh() (read the seams and
// rebuild now) and window.__sidecarFeed(readings) (push readings through the strain track, to reach the 120 s CPU streak
// without waiting). The small form is reached with the real S button, which calls the host's `sidecar_form` command: the
// window really shrinks to 340x440, pins and comes back, so teardown leaves the small form and unpins if a step failed.
// New step k of the plan is step 13+k here.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { attachByUrl, waitFor } from "./attach.mjs";

const NAME = "sidecar-wall";
const FIXTURE = new URL("../../public/cockpit-fixtures/active.json", import.meta.url);
const SIDECAR_URL = /\/sidecar\.html(?:[?#]|$)/i;
// Sidecar's page is drawn when its title bar is: it has no nav and no RPC client, which the main page's readiness needs
const SIDECAR_READY = `!!document.querySelector("[data-sidecar-titlebar]")`;
// the size every shape assert is made at (the board's, and what the wall's tests pin): the page is pinned to it so the
// grid does not depend on the screen the window opened on
const WALL_VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };
const MIN_WINDOW = { w: 340, h: 440 };
const MIN_TILE = { w: 300, h: 170 };
// a tile's box is fractional (a column is a share of the width); half a pixel is rounding, not a smaller tile
const PX_SLACK = 0.5;
const MIN = 60_000;
const MB = 1024 * 1024;
const GIB = 1024 ** 3;
const ON_MAC = process.platform === "darwin";

// part 2: what the layout switch, the small frame and the readings are
const SMALL_BREAK_PX = 1100; // layoutFor (sidecarlayout.ts): the wall from this width, the small form under it
const NARROW_VIEWPORT = { width: 900, height: 800, deviceScaleFactor: 1, mobile: false };
const SIZE_SLACK = 2; // px: the window's size read back through the screen's scale
const SCROLL_ID = "fx-sc-scroll"; // the agent with 14 message rows
const SCROLL_ROWS = 14;
const SNAPSHOT_ROWS = 8; // MAX_TILE_MESSAGES: what a snapshot carries of them; one older page returns the other 6
const SLEEP2_ID = "fx-sc-sleep2"; // asleep, no entries, a transcript file: the bridge's tail read gives it two rows
const TAIL_FILE = fileURLToPath(new URL("./fixtures/sidecar-tail.jsonl", import.meta.url));
// the last two messages of the fixture file, and one from the front that a two-row tail must not show
const TAIL_SAYS = ["Tail fixture: the next to last message, a test run that failed once.", "Tail fixture: the last message, every test passes now."];
const TAIL_FRONT_SAY = "Reading the retry loop in the price feed client first.";
const NOT_RUN = "Not run (fixture)"; // the note a Stop or Sleep act leaves on its row while __sidecarHeavy is set

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
    "All green. Checking the docs for any place that names the old delay.",
    "Found one line in the README that says the delay is fixed; rewriting it to say the delay grows and resets.",
    "Committed the change. Looking at the open issue about the flaky reconnect test.",
    "That test fails one run in ten; I can reproduce it with -count=20 and will bisect the sleep.",
];
const TOOLS = [
    ["read", "feed/client.go"],
    ["read", "feed/backoff.go"],
    ["edited", "feed/backoff.go", "ok"],
    ["ran", "go test ./feed/ -run Retry", "fail"],
    ["ran", "go test ./feed/...", "ok"],
    ["edited", "README.md", "ok"],
    ["ran", "git push origin main", "blocked"],
    ["ran", "go test ./feed/ -run Reconnect -count=20", "fail"],
];

// n message-and-tool pairs, starting at a seed so neighbouring tiles do not repeat each other
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

const TERMINAL_ID = "fx-sc-term";
// the ids steps 10-12 name: the first two tiles of every wall, whatever its size (longest blocked first)
const ASK_ID = "fx-sc-ask1";
const TWO_Q_ID = "fx-sc-ask2";
const ASK_OPTIONS = ["Rebase onto main", "Merge main in", "Leave it as it is"];

// one agent as the cockpit's roster has it (AgentVM, frontend/app/view/agents/agentsviewmodel.ts). Every age is fixed
// (stateSince, idleSince, sleeping.since): the bridge re-emits on any change, and an age that moves with `now` would make
// every build of the snapshot differ
function agentOf(kind, i, now, id = `fx-sc-${i}`) {
    const rt = RUNTIMES[i % RUNTIMES.length];
    const name = i < NAMES.length ? NAMES[i] : `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`;
    const base = {
        id,
        name,
        task: `Task ${i + 1}`,
        project: PROJECTS[i % PROJECTS.length],
        ...rt,
        blockId: id.replace("fx-sc-", "fx-sc-blk-"),
        usage: { contextpct: 18 + ((i * 7) % 70) },
    };
    const pairs = 6 + (i % 3);
    switch (kind) {
        case "ask":
        case "ask2": {
            const blockedMs = id === ASK_ID ? 20 * MIN : id === TWO_Q_ID ? 12 * MIN : (2 + (i % 8)) * MIN;
            const questions =
                kind === "ask2"
                    ? [
                          { header: "BRANCH", question: "Which branch should the fix land on?", options: [{ label: "main" }, { label: "release/0.15" }] },
                          { header: "TESTS", question: "Run the whole suite before the commit?", options: [{ label: "Yes" }, { label: "No" }] },
                      ]
                    : [
                          {
                              header: "NEXT",
                              question: "The branch is behind main by 6 commits. How should I bring it up to date?",
                              options: ASK_OPTIONS.map((label) => ({ label })),
                          },
                      ];
            return {
                ...base,
                state: "asking",
                blockedMs,
                stateSince: now - blockedMs,
                previousInfo: narration(i, pairs),
                ask: { askId: `fx-sc-a-${id}`, oref: `block:${base.blockId}`, questions },
            };
        }
        case "work": {
            const activeMs = id === "fx-sc-work1" ? 90 * MIN : (3 + (i % 9)) * MIN;
            return { ...base, state: "working", activeMs, stateSince: now - activeMs, previousInfo: narration(i, pairs) };
        }
        case "review":
            return { ...base, state: "idle", idleSince: now - (5 + (i % 20)) * MIN, edited: true, previousInfo: narration(i, pairs) };
        case "idle":
            return { ...base, state: "idle", idleSince: now - (40 + (i % 50)) * MIN, previousInfo: narration(i, pairs) };
        case "sleep":
            // asleep with no entries at all: its tile has no rows to show, so it says so (step 6)
            return { ...base, state: "idle", idleSince: now - 120 * MIN, sleeping: { since: now - (30 + (i % 40)) * MIN, freedBytes: 250 * MB } };
        default:
            throw new Error(`unknown agent kind ${kind}`);
    }
}

// the four tiles of the 2x2 wall: an agent asking with three options, one asking two questions, one working, one asleep
function core(now) {
    return [
        agentOf("ask", 0, now, ASK_ID),
        agentOf("ask2", 1, now, TWO_Q_ID),
        agentOf("work", 2, now, "fx-sc-work1"),
        agentOf("sleep", 3, now, "fx-sc-sleep1"),
    ];
}
const FILL = ["work", "review", "idle", "ask", "work", "idle", "sleep", "review"];

// a plain terminal beside n agents: the wall must draw no tile for it
function roster(n, now) {
    const terminal = { id: TERMINAL_ID, name: "zsh", task: "", state: "idle", kind: "terminal", project: "arcterm", blockId: "fx-sc-blk-term", running: false };
    const agents = n === 0 ? [] : core(now).slice(0, Math.min(n, 4));
    for (let i = 4; i < n; i++) agents.push(agentOf(FILL[(i - 4) % FILL.length], i, now));
    return [terminal, ...agents];
}

// ---- part 2's roster and readings -------------------------------------------------------------------------------------

const scrollSay = (n) => `Scroll row ${String(n).padStart(2, "0")} of ${SCROLL_ROWS}: ${SAYS[(n - 1) % SAYS.length]}`;

// 14 message-and-tool pairs with a number each, so a loaded row can be told from the snapshot's and the paging seam checked
function scrollNarration() {
    const out = [];
    for (let n = 1; n <= SCROLL_ROWS; n++) {
        out.push({ kind: "message", text: scrollSay(n) });
        out.push({ kind: "action", verb: "read", target: `scroll/file${String(n).padStart(2, "0")}.go`, outcome: "ok" });
    }
    return out;
}

// Part 1's four agents, a scroll agent and a second asleep agent. The two asks get an ask id of their own: step 12 of part 1
// answered the first, and the main window keeps an answered ask's id in its sent set for as long as it runs, so with the
// old id the card would read Sent and a digit would send nothing.
function part2Roster(now) {
    const fresh = (a) => ({ ...a, ask: { ...a.ask, askId: `${a.ask.askId}-p2` } });
    const [ask, ask2, work, sleep1] = core(now);
    const scroll = { ...agentOf("idle", 4, now, SCROLL_ID), previousInfo: scrollNarration() };
    const sleep2 = { ...agentOf("sleep", 5, now, SLEEP2_ID), agent: "claude", model: "sonnet 5.5", transcriptPath: TAIL_FILE };
    const terminal = { id: TERMINAL_ID, name: "zsh", task: "", state: "idle", kind: "terminal", project: "arcterm", blockId: "fx-sc-blk-term", running: false };
    return [terminal, fresh(ask), fresh(ask2), work, sleep1, scroll, sleep2];
}
// the same agents with nothing asking, for the small form's empty line
const withoutAsks = (agents) => agents.filter((a) => a.state !== "asking");

const blockOf = (id) => id.replace("fx-sc-", "fx-sc-blk-");
// the three agents the band names. By RAM the heaviest first is the working agent; by CPU it is the asking one, so a step
// can tell which measure drew the rows
const HEAVY = [
    { id: "fx-sc-work1", ram: 3.2 * GIB, procRam: 2.6 * GIB, ramPid: 4101, ramCommand: "node vite dev", cpu: 55, procCpu: 48, cpuPid: 5101, cpuCommand: "esbuild --watch" },
    { id: ASK_ID, ram: 1.9 * GIB, procRam: 1.4 * GIB, ramPid: 4102, ramCommand: "go test ./...", cpu: 80, procCpu: 74, cpuPid: 5102, cpuCommand: "go test ./feed/..." },
    // under half a GB, so the band prints it in whole MB (formatBytes)
    { id: SCROLL_ID, ram: 420 * MB, procRam: 300 * MB, ramPid: 4103, ramCommand: "cargo build", cpu: 20, procCpu: 17, cpuPid: 5103, cpuCommand: "cargo check" },
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
// the bridge's machine seam: a MachineStatsData
const machineOf = (o) => ({ memtotal: 32 * GIB, memavailable: 14 * GIB, pressure: "normal", cpupct: 20, swaptotal: 16 * GIB, swapused: 0, disks: [], ...o });
const MACHINE_AMBER = machineOf({ pressure: "high", memavailable: 2.1 * GIB, cpupct: 30 });
const MACHINE_CPU = machineOf({ pressure: "normal", memavailable: 14 * GIB, cpupct: 95 });
const MACHINE_RED = machineOf({ pressure: "critical", memavailable: 0.6 * GIB, swapused: 9.2 * GIB, cpupct: 95 });
const MACHINE_CALM = machineOf({});
// board E's red line names the OS: strainmodel's osName
const OS_NAME = process.platform === "win32" ? "Windows" : ON_MAC ? "macOS" : "The system";

// the title bar's three counts for a roster, as the snapshot builds them: asleep and review agents count as idle
function expectedCounts(agents) {
    const real = agents.filter((a) => a.kind !== "terminal");
    return {
        asking: real.filter((a) => a.state === "asking").length,
        working: real.filter((a) => a.state === "working").length,
        idle: real.filter((a) => a.state === "idle").length,
    };
}

// ---- driving the two pages ---------------------------------------------------------------------------------------------

// Writes the roster file and has the page read it. Vite serves a file made after it started only once its watcher has
// seen it, and a read before then is dropped silently (devmock.ts), so the roster is read once the server answers with
// these ids (the first Final run drew an empty wall for its first roster).
async function loadRoster(h, agents) {
    mkdirSync(new URL(".", FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, JSON.stringify(agents, null, 2));
    const ids = JSON.stringify(agents.map((a) => a.id));
    const served = await waitFor(
        h.ev,
        `fetch("/cockpit-fixtures/active.json", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => Array.isArray(j) && JSON.stringify(j.map((a) => a.id)) === ${JSON.stringify(ids)})
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

// the keys the page's handlers read (sidecar.tsx: F11; sidecarwall.tsx: arrows, Enter, 1-9)
const KEYS = {
    ArrowLeft: { code: "ArrowLeft", vk: 37 },
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowRight: { code: "ArrowRight", vk: 39 },
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

// the wall as the page draws it: its shape attributes, every tile's state, box and contents, and whether the page scrolls
const READ = `(() => {
    const wall = document.querySelector("[data-sidecar-wall]");
    const page = document.scrollingElement;
    const count = (kind) => {
        const text = document.querySelector('[data-sidecar-count="' + kind + '"]')?.textContent ?? null;
        return text == null ? null : parseInt(text, 10);
    };
    return {
        waiting: !!document.querySelector("[data-sidecar-waiting]"),
        titlebar: !!document.querySelector("[data-sidecar-titlebar]"),
        footer: !!document.querySelector("[data-sidecar-footer]"),
        counts: { asking: count("asking"), working: count("working"), idle: count("idle") },
        wall: wall == null ? null : {
            cols: Number(wall.dataset.cols),
            rows: Number(wall.dataset.rows),
            msgs: Number(wall.dataset.msgs),
            scroll: wall.dataset.scroll,
            empty: !!wall.querySelector("[data-sidecar-empty]"),
            scrollH: wall.scrollHeight,
            clientH: wall.clientHeight,
        },
        page: {
            overflows: page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1,
            scrollTop: page.scrollTop,
            w: window.innerWidth,
            h: window.innerHeight,
        },
        tiles: [...document.querySelectorAll("[data-sidecar-tile]")].map((t) => {
            const r = t.getBoundingClientRect();
            return {
                id: t.dataset.sidecarTile,
                state: t.dataset.state,
                selected: t.dataset.selected === "true",
                w: r.width,
                h: r.height,
                msgs: t.querySelectorAll("[data-sidecar-msg]").length,
                nomsgs: !!t.querySelector("[data-sidecar-nomsgs]"),
                options: t.querySelectorAll("[data-sidecar-option]").length,
                sent: !!t.querySelector("[data-sidecar-sent]"),
                elsewhere: !!t.querySelector("[data-sidecar-elsewhere]"),
            };
        }),
    };
})()`;
const read = (side) => side.ev(READ);

// waits for the wall to show n tiles (no tiles: its empty state) and for the grid to settle on them
async function settleOn(side, n, ms = 10_000) {
    const shown = await waitFor(
        side.ev,
        n === 0
            ? `!!document.querySelector("[data-sidecar-wall] [data-sidecar-empty]")`
            : `document.querySelectorAll("[data-sidecar-tile]").length === ${n}`,
        ms
    );
    await sleep(500);
    return shown;
}

const selectedIndex = (got) => got.tiles.findIndex((t) => t.selected);
// the acts the main page's bridge received after the first `from`, the page's hello left out (it is not an action)
const actsSince = async (h, from) => ((await h.ev("window.__sidecarActs ?? []")) ?? []).slice(from).filter((a) => a?.kind !== "hello");
const actCount = async (h) => (await h.ev("(window.__sidecarActs ?? []).length")) ?? 0;

// ---- part 2: the band, the scroll lists and the small form as the page draws them ------------------------------------

const has = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
const countOf = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
const textsOf = (side, selector) => side.ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent ?? "")`);
// true when the element was there and was clicked (a real click event: React's onClick runs, the buttons keep no focus)
const clickIn = (side, selector) =>
    side.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el == null) return false; el.click(); return true; })()`);
const near = (a, b) => Math.abs(a - b) <= SIZE_SLACK;
const rowSel = (id) => `[data-sidecar-heavy="${id}"]`;
const tileSel = (id) => `[data-sidecar-tile="${id}"]`;

// the band, and the title bar's readout with its tones, as the page shows them now
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

// the small form and the title bar around it: the layout, the S and pin buttons, the bar's fit, the cards
const SMALL_READ = `(() => {
    const bar = document.querySelector("[data-sidecar-titlebar]");
    const btn = (n) => document.querySelector('[data-sidecar-btn="' + n + '"]');
    const count = (kind) => {
        const text = document.querySelector('[data-sidecar-count="' + kind + '"]')?.textContent ?? null;
        return text == null ? null : parseInt(text, 10);
    };
    const page = document.scrollingElement;
    return {
        w: window.innerWidth,
        h: window.innerHeight,
        layout: bar?.dataset.sidecarLayout ?? null,
        small: !!document.querySelector("[data-sidecar-small]"),
        wall: !!document.querySelector("[data-sidecar-wall]"),
        s: btn("small")?.getAttribute("aria-pressed") ?? null,
        pin: btn("pin")?.getAttribute("aria-pressed") ?? null,
        bar: bar == null ? null : { scrollW: bar.scrollWidth, clientW: bar.clientWidth },
        windowButtons: ["minimize", "maximize", "fullscreen"].filter((n) => !!btn(n)),
        machine: document.querySelector("[data-sidecar-machine]")?.textContent ?? null,
        counts: { asking: count("asking"), working: count("working"), idle: count("idle") },
        cards: [...document.querySelectorAll("[data-sidecar-card]")].map((c) => ({
            id: c.dataset.sidecarCard,
            selected: c.dataset.selected === "true",
            options: c.querySelectorAll("[data-sidecar-option]").length,
            elsewhere: !!c.querySelector("[data-sidecar-elsewhere]"),
            sent: !!c.querySelector("[data-sidecar-sent]"),
        })),
        empty: document.querySelector("[data-sidecar-small-empty]")?.textContent ?? null,
        overflows: page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1,
    };
})()`;
const readSmall = (side) => side.ev(SMALL_READ);

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

// The number in a row of the scroll agent ("Scroll row 07 of 14: ..."), as text
const scrollNumbers = (texts) => texts.map((t) => /Scroll row (\d+) of/.exec(t)?.[1] ?? "?");
const numbered = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, "0"));

// Steps 14-30: the strain band, scrollback, the tail read and the small form (plan task 9). `rec` records a step and
// `shot` takes a Sidecar screenshot into the contact sheet. The window is at WALL_VIEWPORT until step 25 clears it.
async function part2Steps(h, ctx, side, rec, shot) {
    const agents = part2Roster(ctx.now);
    ctx.part2Agents = agents;
    // a Sidecar left small or pinned by an earlier run would turn the S button's first press into a restore
    const start = await sidecarForm(side, null);
    if (start?.small) await sidecarForm(side, { small: false });
    if ((await sidecarForm(side, null))?.pinned) await sidecarForm(side, { pinned: false });

    await loadRoster(h, agents);
    const drew = await settleOn(side, 6, 15_000);
    const tiles = (await read(side)).tiles.map((t) => t.id);

    // 14. a strained machine whose heaviest agents are not read yet: the amber band says it is finding them
    await setSeams(h, { machine: MACHINE_AMBER, heavy: { consumers: consumersOf([]) } });
    await refresh(h);
    const finding = await waitFor(side.ev, has('[data-sidecar-band][data-level="amber"] [data-sidecar-band-finding]'), 10_000);
    let got = await readBand(side);
    await shot(side, "p2-1-band-finding");
    rec(
        "14. with the memory pressure high and no heaviest agent read yet, the amber band says `Finding the heaviest agents…` over the 6 tiles",
        drew && tiles.length === 6 && finding && got.band?.level === "amber" && got.band.finding === "Finding the heaviest agents…" && got.band.rows.length === 0,
        { drew, tiles, band: got.band }
    );

    // 15. the readings come in: three rows by RAM, heaviest first, each with its process and Stop and Sleep; the readout is amber
    await setSeams(h, { heavy: heavyFixture() });
    await refresh(h);
    const rowsShown = await waitFor(side.ev, `${countOf("[data-sidecar-heavy]")} === 3`, 10_000);
    got = await readBand(side);
    await shot(side, "p2-2-band-amber");
    const ids15 = got.band?.rows.map((r) => r.id) ?? [];
    rec(
        "15. the readings fill the band: 3 rows by RAM (3.2 GB, 1.9 GB, 420 MB), each with its heaviest process, Stop and Sleep agent, and the title bar's RAM figure is amber",
        rowsShown &&
            got.band?.level === "amber" &&
            got.band.finding == null &&
            JSON.stringify(ids15) === JSON.stringify(HEAVY_BY_RAM) &&
            got.band.rows.every((r) => r.stop && r.sleep && r.process != null) &&
            /3\.2 GB/.test(got.band.rows[0].text) &&
            got.band.rows[0].process.includes("node vite dev") &&
            /420 MB/.test(got.band.rows[2].text) &&
            got.ramTone === "amber" &&
            got.cpuTone === "normal" &&
            /2\.1 GB/.test(got.machine ?? ""),
        { ids: ids15, want: HEAVY_BY_RAM, rows: got.band?.rows, ramTone: got.ramTone, cpuTone: got.cpuTone, machine: got.machine }
    );

    // 16. the CPU over 90% for 2 minutes (27 readings 5 s apart, fed in one go) with the memory fine: the band says so, the
    // CPU figure is amber and the rows are the CPU's, in the CPU's order
    await feedCpu(h);
    const cpuSaid = await waitFor(side.ev, `(document.querySelector("[data-sidecar-band-why]")?.textContent ?? "").includes("CPU over 90% for 2 min")`, 10_000);
    const cpuRows = await waitFor(side.ev, `JSON.stringify([...document.querySelectorAll("[data-sidecar-heavy]")].map((r) => r.dataset.sidecarHeavy)) === ${JSON.stringify(JSON.stringify(HEAVY_BY_CPU))}`, 10_000);
    got = await readBand(side);
    await shot(side, "p2-3-band-cpu");
    rec(
        "16. the CPU over 90% for 2 minutes keeps the amber band up and says `CPU over 90% for 2 min`; the CPU figure turns amber, the memory one goes back to normal, and the rows are the CPU's (80%, 55%, 20%)",
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

    // 17. Stop asks in place, on the row, about the row's process; Cancel puts the buttons back and sends nothing
    const stopId = HEAVY_BY_CPU[0];
    const stopPid = HEAVY.find((x) => x.id === stopId).cpuPid;
    const before17 = await actCount(h);
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-heavy-stop]`);
    const asked = await waitFor(side.ev, has(`${rowSel(stopId)} [data-sidecar-confirm]`), 3000);
    const confirmText = (await side.ev(`document.querySelector(${JSON.stringify(`${rowSel(stopId)} [data-sidecar-confirm]`)})?.textContent ?? ""`)) ?? "";
    await shot(side, "p2-4-stop-confirm");
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-confirm-cancel]`);
    const cancelled = await waitFor(side.ev, `!${has(`${rowSel(stopId)} [data-sidecar-confirm]`)} && ${has(`${rowSel(stopId)} [data-sidecar-heavy-stop]`)}`, 3000);
    await sleep(600);
    const strays17 = await actsSince(h, before17);
    rec(
        "17. Stop asks in place (`Stop <command>? … the agent keeps running.` with Stop and Cancel) and Cancel puts the row's buttons back with no act sent",
        asked && confirmText.includes("go test ./feed/...") && confirmText.includes("build ends; the agent keeps running") && cancelled && strays17.length === 0,
        { asked, confirmText, cancelled, strays: strays17 }
    );

    // 18. Stop → Stop: the act names the row's process, the bridge does not run it (a fixture) and says so on the row
    const before18 = await actCount(h);
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-heavy-stop]`);
    await waitFor(side.ev, has(`${rowSel(stopId)} [data-sidecar-confirm]`), 3000);
    await clickIn(side, `${rowSel(stopId)} [data-sidecar-confirm-stop]`);
    let acts18 = [];
    await until(async () => (acts18 = await actsSince(h, before18)).length > 0, 5000);
    const noted18 = await waitFor(side.ev, `(document.querySelector(${JSON.stringify(`${rowSel(stopId)} [data-sidecar-heavy-note]`)})?.textContent ?? "") === ${JSON.stringify(NOT_RUN)}`, 5000);
    got = await readBand(side);
    await shot(side, "p2-5-stop-sent");
    rec(
        `18. confirming Stop sends one stop act for the row's process and the row says \`${NOT_RUN}\`, the confirm gone`,
        acts18.length === 1 &&
            acts18[0]?.kind === "stop" &&
            acts18[0].id === stopId &&
            acts18[0].pid === stopPid &&
            noted18 &&
            got.band?.rows.find((r) => r.id === stopId)?.confirm === false,
        { acts: acts18, wantPid: stopPid, noted: noted18, row: got.band?.rows.find((r) => r.id === stopId) }
    );

    // 19. Sleep agent on another row: a sleep act for it and the same note
    const sleepId = HEAVY_BY_CPU[1];
    const before19 = await actCount(h);
    await clickIn(side, `${rowSel(sleepId)} [data-sidecar-heavy-sleep]`);
    let acts19 = [];
    await until(async () => (acts19 = await actsSince(h, before19)).length > 0, 5000);
    const noted19 = await waitFor(side.ev, `(document.querySelector(${JSON.stringify(`${rowSel(sleepId)} [data-sidecar-heavy-note]`)})?.textContent ?? "") === ${JSON.stringify(NOT_RUN)}`, 5000);
    await shot(side, "p2-6-sleep-sent");
    rec(
        `19. Sleep agent on a row sends one sleep act for that agent and the row says \`${NOT_RUN}\``,
        acts19.length === 1 && acts19[0]?.kind === "sleep" && acts19[0].id === sleepId && noted19,
        { acts: acts19, noted: noted19 }
    );

    // 20. the × hides the band until its level changes: it stays hidden through a rebuild, the readout stays amber
    await clickIn(side, "[data-sidecar-band-close]");
    const hid = await waitFor(side.ev, `!${has("[data-sidecar-band]")}`, 3000);
    await refresh(h);
    await sleep(1500);
    const stillHidden = await side.ev(`!${has("[data-sidecar-band]")}`);
    got = await readBand(side);
    await shot(side, "p2-7-band-hidden");
    rec(
        "20. the × hides the band, and it stays hidden through the next reading while the level is the same; the title bar's CPU figure stays amber",
        hid && stillHidden === true && got.band == null && got.cpuTone === "amber",
        { hid, stillHidden, cpuTone: got.cpuTone }
    );

    // 21. the pressure turns critical: the level changed, so the band is back, red, saying what is coming and naming the OS
    await setSeams(h, { machine: MACHINE_RED });
    await refresh(h);
    const red = await waitFor(side.ev, has('[data-sidecar-band][data-level="red"]'), 10_000);
    await waitFor(side.ev, `${countOf("[data-sidecar-heavy]")} === 3`, 5000);
    got = await readBand(side);
    await shot(side, "p2-8-band-red");
    rec(
        `21. critical memory pressure shows the band again, red: \`The machine is about to run out of memory\`, \`RAM critical (0.6 GB free, swap 9.2 GB)\` and \`${OS_NAME} may start killing processes\`, the RAM figure red, the rows by RAM`,
        red &&
            got.band?.level === "red" &&
            got.band.title === "The machine is about to run out of memory" &&
            got.band.why.includes("RAM critical (0.6 GB free, swap 9.2 GB)") &&
            got.band.why.includes(`${OS_NAME} may start killing processes`) &&
            got.ramTone === "red" &&
            JSON.stringify(got.band.rows.map((r) => r.id)) === JSON.stringify(HEAVY_BY_RAM),
        { title: got.band?.title, why: got.band?.why, ramTone: got.ramTone, rows: got.band?.rows.map((r) => r.id), machine: got.machine }
    );

    // 22. back to normal at 20% CPU: the band holds 30 s, steps down to amber, holds 30 s more and clears. A reading is
    // taken every 2.5 s here rather than waiting for the bridge's 5 s poll, so the hold is the only wait.
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
            await shot(side, "p2-9-band-steps-down");
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
    await shot(side, "p2-10-band-clear");
    rec(
        "22. back to a calm machine the red band holds, steps down to amber after 30 s, and clears 30 s after that, with both figures normal again",
        first === "red" && amberAfter != null && amberAfter >= 29_000 && goneAfter != null && goneAfter >= 59_000 && got.band == null && got.ramTone === "normal" && got.cpuTone === "normal",
        { first, amberAfterMs: amberAfter, goneAfterMs: goneAfter, ramTone: got.ramTone, cpuTone: got.cpuTone }
    );

    // 23. scrollback: scrolling the scroll agent's list to its top asks for older rows and the 6 rows above the snapshot's 8
    // join it, then `Start of what arcterm holds`; back at the bottom both go. The list may not overflow at this size (no
    // scroll event), so a real wheel event at its centre asks too: one older act either way.
    const scrollTile = tileSel(SCROLL_ID);
    const list = `${scrollTile} [data-sidecar-msgs]`;
    const msgs = `${scrollTile} [data-sidecar-msg]`;
    const olderRows = `${scrollTile} [data-sidecar-older]`;
    const histStart = `${scrollTile} [data-sidecar-history-start]`;
    const before23 = await actCount(h);
    const initial = await textsOf(side, msgs);
    const box = await side.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(list)});
        const r = el.getBoundingClientRect();
        el.scrollTop = 0;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, overflows: el.scrollHeight > el.clientHeight };
    })()`);
    await side.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -120 });
    const loaded = await waitFor(side.ev, `${countOf(olderRows)} > 0`, 8000);
    const atStart = await waitFor(side.ev, has(histStart), 5000);
    const older = await textsOf(side, olderRows);
    const snapshotRows = (await textsOf(side, msgs)).slice(older.length);
    // look at the top of the loaded rows for the shot
    await side.ev(`document.querySelector(${JSON.stringify(list)}).scrollTop = 0`);
    await sleep(400);
    await shot(side, "p2-11-scrollback");
    const olderActs = (await actsSince(h, before23)).filter((a) => a?.kind === "older");
    // back to the bottom: scrolled up first (a list that did not overflow was at the bottom the whole time), then down
    await sleep(300);
    await side.ev(`(() => { const el = document.querySelector(${JSON.stringify(list)}); el.scrollTop = el.scrollHeight; })()`);
    const dropped = await waitFor(side.ev, `${countOf(olderRows)} === 0 && !${has(histStart)}`, 5000);
    const after = await textsOf(side, msgs);
    rec(
        "23. scrolling a tile to its top asks for older rows (one older act): the 6 rows above the snapshot's 8 load in order above them with `Start of what arcterm holds`, and back at the bottom both go",
        loaded &&
            atStart &&
            olderActs.length === 1 &&
            olderActs[0].id === SCROLL_ID &&
            olderActs[0].before === null &&
            olderActs[0].count === 10 &&
            JSON.stringify(scrollNumbers(initial)) === JSON.stringify(numbered(7, 14)) &&
            JSON.stringify(scrollNumbers(older)) === JSON.stringify(numbered(1, 6)) &&
            JSON.stringify(scrollNumbers(snapshotRows)) === JSON.stringify(numbered(7, 14)) &&
            dropped &&
            JSON.stringify(scrollNumbers(after)) === JSON.stringify(numbered(7, 14)),
        {
            overflowsAtStart: box.overflows,
            olderActs,
            initial: scrollNumbers(initial),
            older: scrollNumbers(older),
            snapshotRows: scrollNumbers(snapshotRows),
            dropped,
            after: scrollNumbers(after),
        }
    );

    // 24. an agent the main window does not stream, asleep with no entries but a transcript file, shows the file's last 2 rows
    const tail = `${tileSel(SLEEP2_ID)} [data-sidecar-msg]`;
    const tailShown = await waitFor(side.ev, `${countOf(tail)} === 2`, 15_000);
    const tailRows = await textsOf(side, tail);
    const tailNoMsgs = await side.ev(has(`${tileSel(SLEEP2_ID)} [data-sidecar-nomsgs]`));
    await shot(side, "p2-12-tail-rows");
    rec(
        "24. the asleep agent with only a transcript file shows that file's last 2 messages (the bridge's tail read) and none from its front",
        tailShown &&
            tailRows.length === 2 &&
            tailRows[0].includes(TAIL_SAYS[0]) &&
            tailRows[1].includes(TAIL_SAYS[1]) &&
            tailRows[1].includes("go test ./feed/...") &&
            !tailRows.some((t) => t.includes(TAIL_FRONT_SAY)) &&
            tailNoMsgs === false,
        { tailShown, rows: tailRows, nomsgs: tailNoMsgs, file: TAIL_FILE }
    );

    // 25. narrower than 1100 px (900 wide, by the device override) the page is the small form: the asks, oldest first
    await side.cdp("Emulation.setDeviceMetricsOverride", NARROW_VIEWPORT);
    const smallShown = await waitFor(side.ev, `${has("[data-sidecar-small]")} && ${has("[data-sidecar-card]")}`, 5000);
    await waitFor(side.ev, has('[data-sidecar-card][data-selected="true"]'), 3000);
    got = await readSmall(side);
    await shot(side, "p2-13-narrow-small-form");
    rec(
        "25. at 900 px wide the page is the small form: the asking cards oldest first (the 20 min ask, then the 12 min one), the first selected, no wall, S and the pin both unpressed",
        smallShown &&
            got.layout === "small" &&
            got.small &&
            !got.wall &&
            JSON.stringify(got.cards.map((c) => c.id)) === JSON.stringify([ASK_ID, TWO_Q_ID]) &&
            got.cards[0].selected &&
            got.cards[0].options === ASK_OPTIONS.length &&
            got.s === "false" &&
            got.pin === "false",
        { layout: got.layout, cards: got.cards, s: got.s, pin: got.pin, counts: got.counts, machine: got.machine }
    );

    // 26. S: the real window shrinks to 340x440, the small form shows, S and the pin read pressed, the host says small and
    // pinned, the title bar fits and keeps only S, the pin and close; the main window's size and focus do not move
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
    got = await readSmall(side);
    let form = await sidecarForm(side, null);
    let mainNow = await mainState(h);
    await shot(side, "p2-14-small-s");
    rec(
        "26. S shrinks the window to 340x440 and pins it: the small form shows, S and the pin are pressed, the host's form says small and pinned, the title bar fits and shows no minimize, maximize or full screen, and the main window's size and focus are untouched",
        shrunk &&
            near(got.w, MIN_WINDOW.w) &&
            near(got.h, MIN_WINDOW.h) &&
            got.layout === "small" &&
            got.small &&
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
        { beforeS, after: { w: got.w, h: got.h }, s: got.s, pin: got.pin, form, bar: got.bar, windowButtons: got.windowButtons, overflows: got.overflows, machine: got.machine, mainBeforeS, mainNow }
    );

    // 27. the small form's keys (real key events): 1 answers the selected, answerable card (option 0); ArrowDown selects the
    // card that Enter answers in the main window, where a digit sends nothing; Enter opens that agent in the main window
    const before27 = await actCount(h);
    await press(side, "1");
    let acts27 = [];
    await until(async () => (acts27 = await actsSince(h, before27)).length > 0, 5000);
    await sleep(400);
    await press(side, "ArrowDown");
    await sleep(400);
    const afterDown = await readSmall(side);
    const mark27 = await actCount(h);
    await press(side, "1");
    await sleep(1200);
    const strays27 = await actsSince(h, mark27);
    await shot(side, "p2-15-small-keys");
    await press(side, "Enter");
    let opens27 = [];
    await until(async () => (opens27 = await actsSince(h, mark27)).length > 0, 5000);
    rec(
        "27. in the small form 1 answers the selected card with its first option, ArrowDown selects the two-question card (answered in the main window: a digit sends nothing) and Enter opens that agent in the main window",
        acts27.length === 1 &&
            acts27[0]?.kind === "answer" &&
            acts27[0].id === ASK_ID &&
            acts27[0].option === 0 &&
            afterDown.cards[1]?.id === TWO_Q_ID &&
            afterDown.cards[1].selected === true &&
            afterDown.cards[1].elsewhere === true &&
            strays27.length === 0 &&
            opens27.length === 1 &&
            opens27[0]?.kind === "open" &&
            opens27[0].id === TWO_Q_ID,
        { answer: acts27, cardsAfterDown: afterDown.cards, strayAfterDigit: strays27, open: opens27 }
    );

    // 28. the pin button turns the pin off and on, and aria and the host's form follow each press
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
    await shot(side, "p2-16-small-pin");
    rec(
        "28. the pin button unpins and pins again: aria-pressed and the host's form follow each press, and the window stays in the small form",
        off && on && offState.form?.small === true && onState.form?.small === true,
        { off: offState, on: onState }
    );

    // 29. S again puts the window back to the size read before S, in the wall if that size is wide enough, unpinned
    const mainBeforeBack = await mainState(h);
    await clickIn(side, '[data-sidecar-btn="small"]');
    const back = await until(async () => {
        const s = await innerSize(side);
        return near(s.w, beforeS.w) && near(s.h, beforeS.h);
    }, 10_000);
    await sleep(700);
    got = await readSmall(side);
    form = await sidecarForm(side, null);
    mainNow = await mainState(h);
    await shot(side, "p2-17-back");
    const wantLayout = beforeS.w >= SMALL_BREAK_PX ? "wall" : "small";
    rec(
        `29. S again returns the window to the size it had before S, unpinned and out of the small form, showing the ${wantLayout} at that width, with the main window's size and focus untouched`,
        back &&
            near(got.w, beforeS.w) &&
            near(got.h, beforeS.h) &&
            form?.small === false &&
            form.pinned === false &&
            got.s === "false" &&
            got.layout === wantLayout &&
            (wantLayout === "wall" ? got.wall && got.pin === null : got.small) &&
            mainNow.w === mainBeforeBack.w &&
            mainNow.h === mainBeforeBack.h &&
            mainNow.focus === mainBeforeBack.focus,
        { beforeS, after: { w: got.w, h: got.h }, form, layout: got.layout, wantLayout, s: got.s, pin: got.pin, mainBeforeBack, mainNow }
    );

    // 30. with nothing asking, the small form says so in one line: the same agents without their asks, at a narrow width.
    // The main window is the size it was before S the whole way through.
    await side.cdp("Emulation.setDeviceMetricsOverride", NARROW_VIEWPORT);
    await sleep(400);
    await loadRoster(h, withoutAsks(agents));
    const emptyShown = await waitFor(side.ev, has("[data-sidecar-small-empty]"), 10_000);
    got = await readSmall(side);
    mainNow = await mainState(h);
    await shot(side, "p2-18-small-empty");
    rec(
        "30. with no ask waiting the small form shows `Nothing waits on you.` and no card, its head counts 0 need you, and the main window's size is what it was before S",
        emptyShown &&
            got.layout === "small" &&
            got.empty === "Nothing waits on you." &&
            got.cards.length === 0 &&
            got.counts.asking === 0 &&
            mainNow.w === mainBeforeS.w &&
            mainNow.h === mainBeforeS.h,
        { empty: got.empty, cards: got.cards.length, counts: got.counts, mainBeforeS, mainNow }
    );
}

export default function () {
    return [
        {
            name: NAME,
            surface: "cockpit",
            host: true,
            // the surface's own shot would be the main cockpit; every shot of this scenario is Sidecar's
            gotoShot: false,
            async arrange(h) {
                const ctx = { prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null, side: null, opened: false };
                // a throw past this point still returns ctx, so teardown puts back whatever was already changed
                try {
                    ctx.now = Date.now();
                    ctx.core = roster(4, ctx.now);
                    // the seams of an earlier run that did not tear down would shape the first snapshot
                    await h.ev("window.__sidecarHold = false; window.__sidecarActs = []; delete window.__sidecarMachine; delete window.__sidecarHeavy");
                    await loadRoster(h, ctx.core);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec("0. the fixture roster is in place", false, ctx.arrangeError);
                    return steps;
                }
                const shot = (side, name) => side.shot(`cdp-shots/${NAME}-${name}.png`);
                try {
                    // 1. Ctrl+P → Open Sidecar: a sidecar.html page target exists afterwards (an open one is brought forward)
                    const failed = await openSidecarFromPalette(h);
                    ctx.opened = failed == null;
                    let side = null;
                    if (failed == null) {
                        try {
                            // shots go into the main handle's list, so the contact sheet and shots.json carry them
                            side = await attachByUrl(SIDECAR_URL, { pageReady: SIDECAR_READY, shots: h.shots });
                            ctx.side = side;
                            // the page is not the focused one of the OS: the wall's keys need a page that believes it is
                            await side.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
                            await side.ready();
                        } catch (e) {
                            rec("1. Ctrl+P → Open Sidecar opens the Sidecar window, and its page can be driven", false, String(e?.message ?? e));
                        }
                    } else {
                        rec("1. Ctrl+P → Open Sidecar opens the Sidecar window, and its page can be driven", false, failed);
                    }
                    if (side == null) return steps;
                    rec(
                        "1. Ctrl+P → Open Sidecar opens the Sidecar window, and its page can be driven",
                        /sidecar\.html/.test(side.url) && (await side.ev("document.title")) === "arcterm Sidecar",
                        { url: side.url, title: await side.ev("document.title") }
                    );

                    // 2. the page's own window calls (capabilities/sidecar.json: the S button's, part 2) work: leave full screen
                    // (a reopened window may be in it), ask for 200x200, put the first size back. The page's innerWidth and
                    // innerHeight are logical px, read before any device override pins them. Whether the host holds the
                    // 340x440 minimum against this call is recorded, not asserted: on Windows `min_inner_size` clamps a person
                    // dragging an edge and not a programmatic set_size (a live run read 200x207 back), so the minimum on a
                    // real drag is a hand check (docs/hand-checks.md)
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
                    rec(
                        "2. the page's own window calls work: it is out of full screen, set_size changes the window's size, and the first size comes back",
                        (await isFullscreen(side)) === false && resized && restored,
                        {
                            wasFullscreen,
                            first,
                            asked: { w: 200, h: 200 },
                            small,
                            smallPhysical,
                            dpr,
                            restored: back,
                            hostClampedToMinimum: small.w >= MIN_WINDOW.w && small.h >= MIN_WINDOW.h,
                        }
                    );
                    // only now pin the page: every shape assert below is made at 1920x1080
                    await side.cdp("Emulation.setDeviceMetricsOverride", WALL_VIEWPORT);
                    await sleep(400);

                    // 3. before the first snapshot the page says it is waiting, with the title bar and no counts; clearing the
                    // hold lets the page's next hello through and the wall appears within 5 s
                    await h.ev("window.__sidecarHold = true");
                    await side.reload();
                    await side.cdp("Emulation.setDeviceMetricsOverride", WALL_VIEWPORT);
                    // past the page's 2 s hello resend, so a hold that let one through would show here
                    await sleep(2600);
                    const waiting = await read(side);
                    await shot(side, "1-waiting");
                    await h.ev("window.__sidecarHold = false");
                    const wallShown = await waitFor(side.ev, `!!document.querySelector("[data-sidecar-wall]")`, 5000);
                    rec(
                        "3. before its first snapshot the page shows its waiting state (title bar, no counts, no wall); with the hold cleared the wall appears within 5s",
                        waiting.waiting && waiting.titlebar && waiting.wall == null && waiting.counts.asking == null && wallShown,
                        { waiting: waiting.waiting, titlebar: waiting.titlebar, wall: waiting.wall, counts: waiting.counts, wallShown }
                    );

                    // 4. the title bar's counts match the roster, and the terminal has no tile
                    await settleOn(side, 4);
                    let got = await read(side);
                    const want = expectedCounts(ctx.core);
                    rec(
                        "4. the title bar's counts match the roster (2 need you, 1 working, 1 idle) and the plain terminal has no tile",
                        got.tiles.length === 4 &&
                            !got.tiles.some((t) => t.id === TERMINAL_ID) &&
                            got.counts.asking === want.asking &&
                            got.counts.working === want.working &&
                            got.counts.idle === want.idle &&
                            got.footer,
                        { counts: got.counts, want, tiles: got.tiles.map((t) => `${t.id}:${t.state}`), footer: got.footer }
                    );

                    // 5. no agents: the wall says so
                    await loadRoster(h, roster(0, ctx.now));
                    await settleOn(side, 0);
                    got = await read(side);
                    await shot(side, "2-empty");
                    rec(
                        "5. with no agents the wall shows its empty state, no tile, and the counts read 0",
                        got.wall?.empty === true && got.tiles.length === 0 && got.counts.asking === 0 && got.counts.working === 0 && got.counts.idle === 0,
                        { wall: got.wall, tiles: got.tiles.length, counts: got.counts }
                    );

                    // 6. 4 agents: 2x2 and at least 5 message rows a tile, the page not scrolled, the asleep tile saying it has none
                    await loadRoster(h, ctx.core);
                    await settleOn(side, 4);
                    got = await read(side);
                    const asleep = got.tiles.find((t) => t.id === "fx-sc-sleep1");
                    await shot(side, "3-four");
                    rec(
                        "6. 4 agents fit 2x2 with at least 5 message rows a tile and no page scroll; the asleep tile says it has no messages",
                        got.wall?.cols === 2 &&
                            got.wall.rows === 2 &&
                            got.wall.msgs >= 5 &&
                            got.wall.scroll === "false" &&
                            !got.page.overflows &&
                            asleep?.nomsgs === true,
                        { wall: got.wall, overflows: got.page.overflows, asleep }
                    );

                    // 7. 12 agents: 4x3, two rows a tile
                    await loadRoster(h, roster(12, ctx.now));
                    await settleOn(side, 12);
                    got = await read(side);
                    await shot(side, "4-twelve");
                    rec(
                        "7. 12 agents fit 4x3 with 2 message rows a tile",
                        got.wall?.cols === 4 && got.wall.rows === 3 && got.wall.msgs === 2 && got.wall.scroll === "false" && !got.page.overflows,
                        { wall: got.wall, overflows: got.page.overflows }
                    );

                    // 8. 20 agents: 5x4, one row a tile, the page not scrolled
                    await loadRoster(h, roster(20, ctx.now));
                    await settleOn(side, 20);
                    got = await read(side);
                    await shot(side, "5-twenty");
                    rec(
                        "8. 20 agents fit 5x4 with 1 message row a tile and no page scroll",
                        got.wall?.cols === 5 && got.wall.rows === 4 && got.wall.msgs === 1 && got.wall.scroll === "false" && !got.page.overflows,
                        { wall: got.wall, overflows: got.page.overflows }
                    );

                    // 9. 40 agents: no shape fits at the smallest readable tile, so the tiles keep that size and the wall scrolls
                    // inside itself, the page not at all
                    await loadRoster(h, roster(40, ctx.now));
                    await settleOn(side, 40);
                    got = await read(side);
                    await shot(side, "6-forty");
                    const smallest = got.tiles.reduce((m, t) => ({ w: Math.min(m.w, t.w), h: Math.min(m.h, t.h) }), { w: Infinity, h: Infinity });
                    rec(
                        "9. 40 agents scroll inside the wall at tiles no smaller than 300x170, the page itself not scrolled",
                        got.wall?.scroll === "true" &&
                            got.wall.scrollH > got.wall.clientH &&
                            smallest.w >= MIN_TILE.w - PX_SLACK &&
                            smallest.h >= MIN_TILE.h - PX_SLACK &&
                            !got.page.overflows &&
                            got.page.scrollTop === 0,
                        { wall: got.wall, smallest, page: got.page }
                    );

                    // back to the 4-agent roster, so steps 10-12 run on 2x2 tiles where the answer buttons fit
                    await loadRoster(h, ctx.core);
                    await settleOn(side, 4);
                    const ids = (await read(side)).tiles.map((t) => t.id);
                    // the selection may have moved with the 40-tile wall: the arrows stop at the first tile, so this lands on it
                    for (let i = 0; i < 4; i++) {
                        await press(side, "ArrowLeft");
                        await sleep(120);
                    }
                    await sleep(200);
                    got = await read(side);
                    const startAt = selectedIndex(got);

                    // 10. the arrows move the selection: Right one tile, Left back, Down a whole row (data-cols), Right again
                    const trail = [startAt];
                    for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowRight"]) {
                        await press(side, key);
                        await sleep(250);
                        trail.push(selectedIndex(await read(side)));
                    }
                    await shot(side, "7-selected");
                    rec(
                        "10. the arrows move the selection: Right one tile, Left back, Down a row of data-cols, Right again",
                        startAt === 0 && JSON.stringify(trail) === JSON.stringify([0, 1, 0, 2, 3]),
                        { cols: got.wall?.cols, trail, want: [0, 1, 0, 2, 3], ids }
                    );

                    // 11. Enter opens the selected agent in the main window: the bridge holds the act, the main page shows Agent.
                    // The working agent is the one opened: the fixture's blocks do not exist, so the Agent surface's terminal
                    // for the agent fails to start and the agent reads idle (withStartError), which would end an ask
                    await press(side, "ArrowLeft"); // 3 -> 2, the working agent
                    await sleep(250);
                    const before11 = await actCount(h);
                    const first11 = selectedIndex(await read(side));
                    await press(side, "Enter");
                    let acts = [];
                    await until(async () => (acts = await actsSince(h, before11)).length > 0, 5000);
                    await until(async () => (await h.activeSurfaceLabel()) === "Agent", 5000);
                    const surface = await h.activeSurfaceLabel();
                    rec(
                        "11. Enter on the selected tile opens that agent in the main window: an open act, and the main page is on Agent",
                        first11 === 2 && acts.length === 1 && acts[0]?.kind === "open" && acts[0].id === ids[2] && surface === "Agent",
                        { selected: first11, acts, surface }
                    );

                    // 12. 2 answers the asking tile with its second option, and the tile then says Sent; the two-question ask is
                    // answered in the main window: no buttons, and a digit sends nothing
                    await press(side, "ArrowUp"); // 2 -> 0, the asking agent with three options
                    await sleep(300);
                    const before12 = await actCount(h);
                    await press(side, "2");
                    let answered = [];
                    await until(async () => (answered = await actsSince(h, before12)).length > 0, 5000);
                    await waitFor(
                        side.ev,
                        `!!document.querySelector('[data-sidecar-tile="${ASK_ID}"] [data-sidecar-sent]')`,
                        5000
                    );
                    const sentTile = (await read(side)).tiles.find((t) => t.id === ASK_ID);
                    await press(side, "ArrowRight"); // onto the two-question ask
                    await sleep(300);
                    const before12b = await actCount(h);
                    await press(side, "1");
                    await sleep(1000);
                    const twoQ = (await read(side)).tiles.find((t) => t.id === TWO_Q_ID);
                    const strayActs = await actsSince(h, before12b);
                    await shot(side, "8-answered");
                    rec(
                        "12. 2 answers the asking tile with its second option and the tile shows Sent; the two-question ask shows `Enter answers it in the main window`, no option buttons, and a digit sends nothing",
                        answered.length === 1 &&
                            answered[0]?.kind === "answer" &&
                            answered[0].id === ASK_ID &&
                            answered[0].option === 1 &&
                            sentTile?.sent === true &&
                            sentTile.options === 0 &&
                            twoQ?.elsewhere === true &&
                            twoQ.options === 0 &&
                            twoQ.sent === false &&
                            strayActs.length === 0,
                        { answered, sentTile, twoQ, strayActs }
                    );

                    // 13. F11 toggles full screen: on, then off after a second press
                    const startedFullscreen = await isFullscreen(side);
                    await press(side, "F11");
                    const on = await until(async () => (await isFullscreen(side)) === !startedFullscreen, 5000);
                    const afterFirst = await isFullscreen(side);
                    await press(side, "F11");
                    const off = await until(async () => (await isFullscreen(side)) === startedFullscreen, 5000);
                    const afterSecond = await isFullscreen(side);
                    rec(
                        "13. F11 toggles full screen: isFullscreen() is true after one press and false after a second",
                        startedFullscreen === false && on && afterFirst === true && off && afterSecond === false,
                        { startedFullscreen, afterFirst, afterSecond }
                    );

                    // 14-30. part 2, on a roster of its own: the strain band, scrollback, the tail read and the small form
                    await part2Steps(h, ctx, side, rec, shot);
                } catch (e) {
                    rec("the steps ran to the end", false, String(e?.message ?? e));
                }
                return steps;
            },
            // best-effort, so one failed step does not strand the rest
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                await step("clear the hold, the seams and the act log", () =>
                    h.ev("window.__sidecarHold = false; delete window.__sidecarActs; delete window.__sidecarMachine; delete window.__sidecarHeavy")
                );
                // a window the scenario opened but never attached to (the attach failed) is found again by url
                if (ctx.opened && ctx.side == null) {
                    await step("find the Sidecar window", async () => {
                        ctx.side = await attachByUrl(SIDECAR_URL, { pageReady: SIDECAR_READY, shots: h.shots, waitMs: 1500 });
                    });
                }
                if (ctx.side != null) {
                    const side = ctx.side;
                    // a step that failed between S and S again leaves the real window small and on top of everything: put
                    // it back (the host's own command, as the buttons call it), before full screen is looked at
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
            },
        },
    ];
}
