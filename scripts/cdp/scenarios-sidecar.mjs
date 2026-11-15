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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const ON_MAC = process.platform === "darwin";

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
                    await h.ev("window.__sidecarHold = false; window.__sidecarActs = []");
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
                await step("clear the hold and the act log", () => h.ev("window.__sidecarHold = false; delete window.__sidecarActs"));
                // a window the scenario opened but never attached to (the attach failed) is found again by url
                if (ctx.opened && ctx.side == null) {
                    await step("find the Sidecar window", async () => {
                        ctx.side = await attachByUrl(SIDECAR_URL, { pageReady: SIDECAR_READY, shots: h.shots, waitMs: 1500 });
                    });
                }
                if (ctx.side != null) {
                    const side = ctx.side;
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
