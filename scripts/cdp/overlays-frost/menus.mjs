// overlays-frost-menus: context menus (with a submenu) and the PickerList dropdowns, frosted, over a working agent
// (docs/superpowers/specs/2026-11-14-overlays-chat-look-design.md section 2, the plan's Task 2).
//
// One fixture Claude agent over a real tab with a fixture roster row in state working (the page's dev mock roster), and a
// throwaway git project registered with the app (the launcher's `@` list needs one). Every panel goes through frostVerdict
// (frostcheck.mjs): drawn on the `frost` class, and under no ancestor that is a backdrop root. Steps:
//   1. a context menu (element/contextmenu.tsx), opened through its store the way the `context-menu` scenario's assert opens
//      it (that scenario's arrange is a no-op), with a row that has a submenu
//   2. hovering that row opens the submenu: both levels are frosted, and the submenu is the root panel's sibling in the menu's
//      floating element, not a descendant of it, placed beside its row as before
//   3. the keys: ↓ ↑ move in the submenu, ← closes it, → opens it again, Escape closes the menu
//   4. Chat's slash panel (PickerList, look "frosted")
//   5. the launcher's `@` list (PickerList, plain look, the list alone)
//   6. Chat's bash-mode Tab list (PickerList, plain look, the boxed list with groups and a footer), its shell completions
//      answered by a mock of the wshrpc call
// Each step screenshots. kit is scenarios.mjs's CR_KIT (+ scenario(name), unused here).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "../agent-page-fixtures.mjs";
import { frostProbe, frostVerdict } from "./frostcheck.mjs";

const NAME = "overlays frost menus";
const PROJECT = "verify-of-menus";
const WAIT_MS = 15000;
const SHORT_MS = 5000;

const FILES = ["src/sync/client.ts", "src/sync/retry.ts", "src/sync/log.ts", "README.md"];
const SHELL_FILES = ["frontend/app/view/agents/chatpane.tsx", "frontend/app/view/agents/chatpanes/", "frontend/app/view/agents/chatpending.ts"];
const BASH_TEXT = "!npx vitest run frontend/app/view/agents/chatp";

// the menu: a header, accelerators, a separator, a row with a submenu (radio rows), a sublabel and a danger row
const MENU_ITEMS = [
    { type: "header", label: "fixture agent" },
    { label: "Open terminal", accel: "Enter" },
    { label: "Rename…", accel: "F2" },
    { type: "separator" },
    {
        label: "Sort by",
        submenu: [
            { label: "Last activity", type: "radio", checked: true },
            { label: "Name", type: "radio", checked: false },
            { label: "Project", type: "radio", checked: false },
        ],
    },
    { label: "Copy session id", sublabel: "8f3a2c1e" },
    { label: "Kill agent", danger: true },
];

// the menu's root panel is the first child of its floating element ([data-context-menu]); a submenu is a later sibling
const ROOT = "[data-context-menu] > div:not([data-context-submenu])";
const SUB = "[data-context-submenu]";
const ROW = (label) => `[data-menu-item=${JSON.stringify(label)}]`;
// the rows drawn highlighted, in the whole menu (the root's and the open submenu's), in document order
const HIGHLIGHTED = `[...document.querySelectorAll("[data-context-menu] [data-menu-item]")].filter((r) => r.classList.contains("bg-accent/12") || r.classList.contains("bg-error/10")).map((r) => r.getAttribute("data-menu-item"))`;

const KEYS = {
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    left: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    up: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    right: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    down: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
};

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const inputOf = (id) => `${layerOf(id)}?.querySelector("[data-chat-input]")`;
// a panel's fade has ended: a PopoverReveal's or a spring pop's opacity is 1
const FADED_IN = (sel) => `Number(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).opacity) === 1`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode"];

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
    async function typeInBox(h, id, text) {
        await h.ev(`(${inputOf(id)})?.focus()`);
        await h.cdp("Input.insertText", { text });
    }
    // the box emptied as a person does it: focus, Ctrl/Cmd+A, Backspace
    async function clearBox(h, id) {
        await h.ev(`(${inputOf(id)})?.focus()`);
        const mac = await h.ev(`/Mac/i.test(navigator.platform)`);
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: mac ? 4 : 2, commands: ["selectAll"] });
        }
        await key(h, KEYS.backspace);
        await polishNap(150);
    }
    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/overlays-frost-menus-${name}.png`);
        } catch (e) {
            console.error(`overlays-frost-menus: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    const openMenu = (h) =>
        AC.agentPage(
            h,
            `const C = await mod("app/store/contextmenu.ts");
            const items = ${JSON.stringify(MENU_ITEMS)}.map((i) => ({ ...i, click: () => {} }));
            globalStore.set(C.contextMenuAtom, { items, x: Math.round(window.innerWidth / 3), y: 200 });
            return until(() => document.querySelector(${JSON.stringify(ROOT)}) != null, 3000);`
        );
    const closeMenu = (h) => AC.agentPage(h, `const C = await mod("app/store/contextmenu.ts"); C.closeContextMenu(); return true;`);
    const closeLauncher = (h) =>
        AC.agentPage(
            h,
            `const L = await mod("app/view/agents/launcherstore.ts"); L.clearLauncherDraft(); L.closeLauncher(agentsModel()); return true;`
        );
    // the wshrpc call behind the bash Tab list is answered here; every other command goes down to wavesrv as before
    const mockShell = (h) =>
        AC.agentPage(
            h,
            `const { RpcApi } = await mod("app/store/wshclientapi.ts");
            if (window.__ofShell) return "already";
            const prev = RpcApi.mockClient ?? null;
            window.__ofShell = { api: RpcApi, prev };
            RpcApi.setMockRpcClient({
                mockWshRpcCall(client, command, data, opts) {
                    if (command === "shellcomplete") return Promise.resolve(${JSON.stringify(SHELL_FILES)});
                    return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
                },
                mockWshRpcStream(client, command, data, opts) {
                    return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
                },
            });
            return "installed";`
        );
    const unmockShell = (h) =>
        h.ev(`(() => { const m = window.__ofShell; if (!m) return "absent"; m.api.setMockRpcClient(m.prev); delete window.__ofShell; return "restored"; })()`);

    const scenario = {
        name: "overlays-frost-menus",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-of-menus-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-of-menus-project-")),
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

                at = "writing the transcript";
                const base = Date.now() - 600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 4; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the sync client work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. The sync client retries a failed request and logs what it sent.`, o(i * 10 + 2)));
                }
                lines.push(AC.userText("make the sync client retry a failed request", o(100)));
                ctx.transcript = AC.writeTranscript(ctx.dir, "overlays-frost-menus", lines);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here, empty: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the tab";
                // cmd:cwd is the agent's folder: the bash Tab list asks the shell there. No controller, so nothing runs.
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
                rec("0. the fixture agent, its project and its transcript", false, ctx.arrangeError);
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
            // one panel through the shared check: found, on the frost class, under no backdrop root
            const verdict = async (selector) => {
                const r = await h.ev(frostProbe(selector));
                return { ...frostVerdict(r), r };
            };
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, A);
            await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-chat-box]")`, WAIT_MS);

            // 1. a context menu, frosted
            await run("1. context menu", async (name) => {
                await closeMenu(h);
                const up = await openMenu(h);
                const faded = await polishWaitFor(h, FADED_IN(ROOT), SHORT_MS);
                const v = await verdict(ROOT);
                const rows = await h.ev(`document.querySelectorAll("[data-context-menu] [data-menu-item]").length`);
                await shot(h, "1-context-menu");
                rec(`${name}: a context menu opens over the working agent; its panel draws blur(18px) over --color-panel with no backdrop root above it`, up && faded && rows > 0 && v.ok, { rows, ...v });
            });

            // 2. the submenu opens beside its row, outside the parent panel; both levels are frosted
            await run("2. submenu", async (name) => {
                const at = await h.ev(`(() => { const r = document.querySelector(${JSON.stringify(ROW("Sort by"))})?.getBoundingClientRect(); return r ? { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) } : null; })()`);
                if (at == null) throw new Error("the Sort by row is not there");
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
                const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(SUB)})`, SHORT_MS);
                const faded = await polishWaitFor(h, FADED_IN(ROOT), SHORT_MS);
                const root = await verdict(ROOT);
                const sub = await verdict(SUB);
                const geo = await h.ev(`(() => {
                    const root = document.querySelector(${JSON.stringify(ROOT)});
                    const sub = document.querySelector(${JSON.stringify(SUB)});
                    if (!root || !sub) return null;
                    const pr = root.getBoundingClientRect();
                    const sr = sub.getBoundingClientRect();
                    const row = document.querySelector(${JSON.stringify(ROW("Sort by"))}).getBoundingClientRect();
                    const first = sub.querySelector(${JSON.stringify(ROW("Last activity"))})?.getBoundingClientRect();
                    return {
                        nested: root.contains(sub),
                        sibling: sub.parentElement === root.parentElement && sub.parentElement.hasAttribute("data-context-menu"),
                        gap: Math.round(sr.left - pr.right),
                        rowDelta: first ? Math.round(first.top - row.top) : null,
                        rows: sub.querySelectorAll("[data-menu-item]").length,
                    };
                })()`);
                await shot(h, "2-submenu");
                rec(
                    `${name}: hovering Sort by opens a submenu that is no descendant of the root panel (a sibling in the menu's floating element), beside its row (its first row level with Sort by, touching the panel's edge), and both panels draw the frost with no backdrop root above`,
                    up && faded && root.ok && sub.ok && geo != null && !geo.nested && geo.sibling && Math.abs(geo.gap) <= 3 && Math.abs(geo.rowDelta) <= 1 && geo.rows === 3,
                    { root, sub, geo }
                );
            });

            // 3. the keys: ↓ ↑ in the submenu, ← closes it, → opens it again, Escape closes the menu
            await run("3. submenu keys", async (name) => {
                await h.ev(`document.querySelector("[data-context-menu]")?.focus()`);
                const seen = [];
                const expect = async (label, want) => {
                    const got = await polishWaitFor(h, `JSON.stringify(${HIGHLIGHTED}) === ${JSON.stringify(JSON.stringify(want))}`, 3000);
                    seen.push({ label, ok: got, now: await h.ev(HIGHLIGHTED) });
                    return got;
                };
                const subOpen = (want) => polishWaitFor(h, `${want ? "!!" : "!"}document.querySelector(${JSON.stringify(SUB)})`, 3000);
                const start = await expect("opened by hover", ["Sort by", "Last activity"]);
                await key(h, KEYS.down);
                const down1 = await expect("↓", ["Sort by", "Name"]);
                await key(h, KEYS.down);
                const down2 = await expect("↓", ["Sort by", "Project"]);
                await key(h, KEYS.up);
                const up1 = await expect("↑", ["Sort by", "Name"]);
                await shot(h, "3-submenu-keys");
                await key(h, KEYS.left);
                const closed = await subOpen(false);
                const rootStays = await expect("←", ["Sort by"]);
                const rootUp = await h.ev(`!!document.querySelector(${JSON.stringify(ROOT)})`);
                await key(h, KEYS.right);
                const reopened = await subOpen(true);
                const reopenedAt = await expect("→", ["Sort by", "Last activity"]);
                const subFrost = await verdict(SUB);
                await key(h, KEYS.left);
                const closedAgain = await subOpen(false);
                await key(h, KEYS.escape);
                const gone = await polishWaitFor(h, `!document.querySelector("[data-context-menu]")`, SHORT_MS);
                rec(
                    `${name}: ↓ ↑ move the highlight in the submenu, ← closes it and leaves the menu, → opens it again (frosted), ← closes it, Escape closes the menu`,
                    start && down1 && down2 && up1 && closed && rootStays && rootUp && reopened && reopenedAt && subFrost.ok && closedAgain && gone,
                    { seen, closed, rootUp, reopened, subFrost: subFrost.detail, closedAgain, gone }
                );
            });

            // 4. Chat's slash panel, the frosted PickerList look
            await run("4. slash panel", async (name) => {
                await AC.focusAgent(h, A);
                await typeInBox(h, A, "/");
                const up = await polishWaitFor(h, `!!document.querySelector("[data-chat-suggest-panel] [data-chat-slash]")`, SHORT_MS);
                // the panel springs in: it is read once its fade has ended
                const faded = up && (await polishWaitFor(h, FADED_IN("[data-chat-suggest-panel]"), SHORT_MS));
                const v = await verdict("[data-chat-suggest-panel]");
                const rows = await h.ev(`document.querySelectorAll("[data-chat-suggest-panel] [data-chat-slash-item]").length`);
                await shot(h, "4-slash-panel");
                await key(h, KEYS.escape);
                const closed = await polishWaitFor(h, `!document.querySelector("[data-chat-suggest-panel]")`, SHORT_MS);
                await clearBox(h, A);
                rec(`${name}: / opens Chat's suggestion panel, which draws the frost class with no backdrop root above it, and Escape closes it`, up && faded && rows > 0 && v.ok && closed, { rows, closed, ...v });
            });

            // 5. the launcher's `@` list, the plain PickerList look (the list alone)
            await run("5. launcher @ list", async (name) => {
                await AC.agentPage(
                    h,
                    `const L = await mod("app/view/agents/launcherstore.ts");
                    L.clearLauncherDraft();
                    L.openLauncher(agentsModel(), "agent", undefined, ${JSON.stringify(PROJECT)});
                    L.pickLauncherRuntime("claude");
                    return true;`
                );
                const dialog = await polishWaitFor(h, `!!document.querySelector("[data-launcher] #launcher-task")`, SHORT_MS);
                await h.ev(`document.querySelector("#launcher-task")?.focus()`);
                await h.cdp("Input.insertText", { text: "@" });
                const up = await polishWaitFor(h, `!!document.querySelector("[data-launcher-mentions]") && document.querySelectorAll("[data-launcher-mention]").length > 0`, WAIT_MS);
                const v = await verdict("[data-launcher-mentions]");
                const rows = await h.ev(`document.querySelectorAll("[data-launcher-mention]").length`);
                await shot(h, "5-launcher-mentions");
                await key(h, KEYS.escape);
                await closeLauncher(h);
                rec(`${name}: @ in the launcher's Task box lists the project's files in a plain-look PickerList that draws the frost class with no backdrop root above it`, dialog && up && rows > 0 && v.ok, { rows, ...v });
            });

            // 6. Chat's bash-mode Tab list: the plain look, boxed (groups and a footer)
            await run("6. bash Tab list", async (name) => {
                await AC.focusAgent(h, A);
                await clearBox(h, A);
                const mocked = await mockShell(h);
                await typeInBox(h, A, BASH_TEXT);
                await polishWaitFor(h, `((${inputOf(A)})?.innerText ?? "").replace(/\\u00a0/g, " ").startsWith(${JSON.stringify(BASH_TEXT)})`, SHORT_MS);
                await key(h, KEYS.tab);
                const up = await polishWaitFor(h, `!!document.querySelector("[data-chat-bash-list]")`, SHORT_MS);
                await polishNap(250);
                const v = await verdict("[data-chat-bash-list]");
                const rows = await h.ev(`document.querySelectorAll("[data-chat-bash-item]").length`);
                await shot(h, "6-bash-tab-list");
                await key(h, KEYS.escape);
                const closed = await polishWaitFor(h, `!document.querySelector("[data-chat-bash-list]")`, SHORT_MS);
                await clearBox(h, A);
                rec(`${name}: Tab in bash mode opens the boxed plain-look PickerList (the shell's answers mocked), which draws the frost class with no backdrop root above it`, up && rows === SHELL_FILES.length && v.ok && closed, { mocked, rows, closed, ...v });
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`overlays-frost-menus teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the menu", () => closeMenu(h));
            await step("close the launcher", () => closeLauncher(h));
            await step("restore the rpc client", () => unmockShell(h));
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
