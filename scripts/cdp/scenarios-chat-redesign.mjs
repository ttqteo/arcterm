// The Chat redesign (docs/superpowers/specs/2026-11-11-chat-redesign-design.md, plan 2026-11-11-chat-redesign.md Task 7):
// a floating message box that changes shape by state, step lines that fold into `Worked for…`, the frosted suggestion
// panel, the type rhythm, the brainstorm question card in the conversation, the jump button, and frame timing while
// blocks stream in. It is written against the spec's DOM contract ("Builder decisions"), not against the components:
// [data-chat-box][data-chat-box-state], [data-chat-fade], [data-chat-send], [data-chat-stop], [data-chat-action-chip],
// [data-chat-suggest-chip] (step 18, the suggested replies; window.__chatSuggestFake answers their model call),
// [data-chat-suggest-panel], [data-chat-step][data-chat-step-running], [data-chat-step-chip], [data-chat-step-more],
// [data-chat-bscard][data-chat-bscard-state], [data-chat-bscard-option], [data-chat-bscard-send],
// [data-chat-bscard-open], [data-chat-bscard-kind], [data-chat-bscard-answered], [data-chat-jump], and the existing
// data-chat-* attributes agent-chat reads. ([data-chat-bscard-pointer] is read only to assert it is gone: the builder check
// and the run are cards now, which scenarios-chat-brainstorm-review.mjs reads.)
//
// One fixture Claude agent over a real tab, a fixture roster row for it (the page's dev mock roster), a throwaway git
// project registered with the app (the `@` list needs a registered project), and a fixture transcript the steps append
// to the way Claude Code does. kit holds scenarios.mjs's helpers.
//
// Frame timing (step 16): `requestAnimationFrame` intervals while 30 assistant blocks land ~150 ms apart and the
// view follows the tail. It passes at p95 <= 20 ms and reports p95 and the worst frame in its detail.
//   main baseline (before the redesign, measured 2026-11-11 on main at 741a8c38a in a dev app of its own, one run on a
//   machine shared with other agents; steps 1-15 fail there except 8, since main has today's Chat):
//   p95 26.7 ms, worst frame 53.5 ms, p50 13.4 ms over 503 frames. main is already over the 20 ms bar at the p95.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat redesign main";
const PROJECT = "verify-chat-redesign";
const TOPIC = "sync-retry-policy";
const SENT_KEY = "chat.brainstorm.sent";
const HINTS_KEY = "brainstorm.hintsSeen";
const WAIT_MS = 15000;
const SHORT_MS = 5000;

// the frame-timing step: how many blocks, how far apart, and the bar
const BLOCKS = 30;
const BLOCK_GAP_MS = 150;
const FRAME_P95_MAX_MS = 20;
const FRAME_SETTLE_MS = 1500;

// --- the fixture transcript ---------------------------------------------------------------------------------------

const MARK_READ = "RETRY_MARK_READ";
const FILES = ["src/sync/client.ts", "src/sync/retry.ts", "src/sync/log.ts", "src/sync/config.ts", "src/sync/queue.ts"];
const ANSWER = "Exponential backoff";
const PROSE =
    "The sync client retries a failed request, and each attempt logs what it sent and what came back, so a stuck sync is easy to trace in the field. ";

// a reply with a heading and a paragraph: the type rhythm step reads both
const REPLY = `## What changed\n\nThe client now retries three times with exponential backoff. ${PROSE.repeat(2)}The retry count lives in one place, so changing it later is a one-line edit.`;

// --- the brainstorm fixtures --------------------------------------------------------------------------------------

const PARTS = [
    { id: "intent", title: "Intent and why", state: "yours", body: "The sync client survives a flaky network." },
    { id: "policy", title: "Retry policy", state: "asked", body: "" },
    { id: "logging", title: "What it logs", state: "open", body: "" },
];
const OPTIONS = [
    {
        label: "Exponential backoff",
        detail: "Wait twice as long after each failure, up to a cap.",
        pick: true,
        pros: ["Gentle on a struggling server.", "Needs no tuning per environment."],
        cons: ["Slower to recover from a one-off blip."],
    },
    { label: "Fixed delay", detail: "Wait the same time between every attempt." },
    { label: "No retry", detail: "Fail at once and let the caller decide." },
];
const READ = "Backoff is the safe default: a fixed delay is simpler but hammers a struggling server, and no retry pushes the work onto every caller.";
const Q1 = {
    n: 1,
    part: "policy",
    text: "Which retry policy should the sync client use?",
    why: "A flaky network fails in bursts, so a retry that waits longer each time is gentler on the server than one that retries at once.",
    read: READ,
    options: OPTIONS,
};
const APPROACHES = ["Backoff with jitter", "Fixed delay", "Circuit breaker", "Retry budget", "Queue and replay"].map((name) => ({
    name,
    description: `${name} for the sync client's requests.`,
    facts: ["The client has one entry point for requests."],
}));
const WEIGHING = { n: 1, part: "policy", text: Q1.text, why: Q1.why, approaches: APPROACHES };
const brainstormFile = (over) => ({
    v: 1,
    title: "Sync client retries",
    spec: "docs/superpowers/specs/2026-11-11-sync-retry-design.md",
    question: Q1,
    working: null,
    parts: PARTS,
    history: [],
    done: false,
    check: null,
    run: null,
    ...over,
});
const ANSWERED_PARTS = PARTS.map((p) => (p.id === "intent" ? p : { ...p, state: "yours", body: "Exponential backoff, capped at 30 seconds." }));
const ANSWERED_HISTORY = [{ kind: "question", n: 1, q: Q1.text, a: ANSWER, into: ["policy"], options: OPTIONS, picked: 0, part: "policy" }];
const CHECK_STAGE = brainstormFile({
    question: null,
    done: true,
    parts: ANSWERED_PARTS,
    history: ANSWERED_HISTORY,
    check: {
        yours: [{ q: "Should a failed sync also page on-call, or only log?", why: "Paging needs the client to hold the on-call credentials." }],
        calls: [],
        answered: [],
        touched: [],
    },
});
const FILES_BRAINSTORM = {
    open: brainstormFile({}),
    weighing: brainstormFile({ question: WEIGHING, working: "The judge is weighing 5 approaches." }),
    multi: brainstormFile({ question: { ...Q1, multi: true } }),
    answered: brainstormFile({ question: null, parts: ANSWERED_PARTS, history: ANSWERED_HISTORY }),
    check: CHECK_STAGE,
};
const QUESTION_PLACEHOLDER = "Answer question 1 in your own words, or pick A–C above";

// --- page expressions -----------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const scrollerOf = (id) => `document.querySelector('[data-agent-chat="${id}"] .overflow-y-auto')`;
const boxOf = (id) => `${layerOf(id)}?.querySelector("[data-chat-box]")`;
const stateOf = (id) => `${boxOf(id)}?.getAttribute("data-chat-box-state") ?? null`;
const inputOf = (id) => `${layerOf(id)}?.querySelector("[data-chat-input]")`;
// an element a reader can see: it has a size and is not faded out or hidden
const SEEN = `((el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; })`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const lastFold = (id) => `[...(${layerOf(id)}?.querySelectorAll("[data-chat-work]") ?? [])].pop()?.querySelector("[data-fold]")`;

const KEYS = {
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
};

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, UI_ROUTE, GRID_KEY, GRID_EMPTY, bsSeeHints } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", SENT_KEY, HINTS_KEY];

    const ts = (ctx, offsetMs = 0) => ({ cwd: ctx.dir, ts: new Date(Date.now() + offsetMs).toISOString() });
    const append = (ctx, ...lines) => appendFileSync(ctx.transcript, lines.join("\n") + "\n");

    // the roster row of the one agent; `patch` is the state under test (working, with its activity)
    const roster = (ctx, patch = {}) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 42 },
            id: ctx.tab.tabId,
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
            ...patch,
        },
    ];
    const WORKING = { state: "working", activity: "Reading retry.ts", activeMs: 30_000, idleSince: undefined };

    async function key(h, k) {
        for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k });
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
    async function typeInBox(h, id, text) {
        await h.ev(`(${inputOf(id)})?.focus()`);
        await h.cdp("Input.insertText", { text });
    }
    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/chat-redesign-${name}.png`);
        } catch (e) {
            console.error(`chat-redesign: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    // writes the brainstorm file and has the page read it now: the agent's hook reveals after each write, which attaches
    // the brainstorm (the first time) and polls it
    async function writeBrainstorm(h, ctx, file) {
        mkdirSync(dirname(ctx.bsFile), { recursive: true });
        writeFileSync(ctx.bsFile, JSON.stringify(file, null, 2));
        await h.rpc("uireveal", { address: `brainstorm:${TOPIC}`, callerblockid: ctx.tab.blockId, callercwd: ctx.cwd }, UI_ROUTE);
    }
    // the card's state and what is in it, read in one call
    const readCard = (h, id) =>
        h.ev(`(() => {
            const flat = ${FLAT};
            const layer = ${layerOf(id)};
            const card = layer?.querySelector("[data-chat-bscard]");
            return {
                card: !!card,
                state: card?.getAttribute("data-chat-bscard-state") ?? null,
                options: layer?.querySelectorAll("[data-chat-bscard-option]").length ?? 0,
                ticks: card?.querySelectorAll('input[type="checkbox"], [role="checkbox"], [aria-checked]').length ?? 0,
                send: !!layer?.querySelector("[data-chat-bscard-send]"),
                open: !!layer?.querySelector("[data-chat-bscard-open]"),
                pointer: !!layer?.querySelector("[data-chat-bscard-pointer]"),
                checkCard: !!layer?.querySelector('[data-chat-bscard-kind="check"]'),
                answered: [...(layer?.querySelectorAll("[data-chat-bscard-answered]") ?? [])].map(flat),
                amber: !!card?.querySelector('[class*="bg-asking"], [class*="bg-warning"]'),
                waitingText: flat(card).includes("Waiting on you"),
                text: flat(card).slice(0, 200),
            };
        })()`);

    const scenario = {
        name: "chat-redesign",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-chat-redesign-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-chat-redesign-project-")),
                prev: {},
            };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                at = "making the project";
                const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                for (const f of [...FILES, "README.md", "notes.txt"]) {
                    mkdirSync(dirname(join(ctx.cwd, f)), { recursive: true });
                    writeFileSync(join(ctx.cwd, f), `// ${f}\nexport const retries = 0;\n`);
                }
                git("add", ".");
                git("commit", "-qm", "seed");
                ctx.bsFile = join(ctx.cwd, ".superpowers", "brainstorm", TOPIC, "brainstorm.json");
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                at = "writing the transcript";
                // 24 earlier turns, so the conversation scrolls, then the request this run answers
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 24; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the sync client work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. ${PROSE.repeat(4)}`, o(i * 10 + 2)));
                }
                lines.push(AC.userText("make the sync client retry a failed request", o(300)));
                ctx.transcript = AC.writeTranscript(ctx.dir, "chat-redesign-main", lines);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(SENT_KEY)})`);
                // the Brainstorm pane's first-open hint card is not what this scenario reads
                if (typeof bsSeeHints === "function") await bsSeeHints(h);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here, empty until step 18 sets its answers: no haiku call
                // runs, and no chip the steps before do not expect lands in the box
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, { label: NAME });
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
            const setRoster = (patch) => AC.setRoster(h, roster(ctx, patch));
            const toState = (want, ms = WAIT_MS) => polishWaitFor(h, `(${stateOf(A)}) === ${JSON.stringify(want)}`, ms);
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            // 1. the box, idle: the floating pill with its fade and Send
            await run("1. box idle", async (name) => {
                await AC.focusAgent(h, A);
                await polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-item]").length ?? 0) >= 6`, WAIT_MS);
                const idle = await toState("idle");
                const got = await h.ev(`(() => {
                    const layer = ${layerOf(A)};
                    const box = layer?.querySelector("[data-chat-box]");
                    const cs = box ? getComputedStyle(box) : null;
                    return {
                        state: box?.getAttribute("data-chat-box-state") ?? null,
                        radii: cs ? [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius] : null,
                        fade: !!layer?.querySelector("[data-chat-fade]"),
                        send: !!layer?.querySelector("[data-chat-send]"),
                    };
                })()`);
                await shot(h, "1-box-idle");
                rec(
                    `${name}: [data-chat-box] is in state idle with radius 22px, the fade under it and a Send button`,
                    idle && got.state === "idle" && got.radii?.every((r) => r === "22px") && got.fade && got.send,
                    got
                );
            });

            // 2. the agent working: the box runs, with its action chips and Stop in place of Send
            await run("2. box running", async (name) => {
                await setRoster(WORKING);
                const running = await toState("running");
                await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-chat-action-chip]")`, SHORT_MS);
                const got = await h.ev(`(() => {
                    const layer = ${layerOf(A)};
                    return {
                        state: layer?.querySelector("[data-chat-box]")?.getAttribute("data-chat-box-state") ?? null,
                        actions: [...(layer?.querySelectorAll("[data-chat-action-chip]") ?? [])].map(${FLAT}),
                        stop: !!layer?.querySelector("[data-chat-stop]"),
                        send: !!layer?.querySelector("[data-chat-send]"),
                    };
                })()`);
                await shot(h, "2-box-running");
                rec(
                    `${name}: state running, an Open the terminal chip with its name and Stop`,
                    running && got.state === "running" && got.actions.includes("Open the terminal") && got.stop,
                    got
                );
            });

            // 3. files dragged over the box: a drop zone; leaving puts the state back
            await run("3. box drop", async (name) => {
                await setRoster({});
                await toState("idle");
                const fire = (target, type) =>
                    h.ev(`(() => {
                        const layer = ${layerOf(A)};
                        const el = ${target === "box" ? `layer?.querySelector("[data-chat-box]")` : `layer?.querySelector("[data-chat-input]")`};
                        if (!el) return false;
                        window.__crDrag ??= (() => { const dt = new DataTransfer(); dt.items.add(new File(["drop body"], "drop-note.txt", { type: "text/plain" })); return dt; })();
                        el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: window.__crDrag }));
                        return true;
                    })()`);
                await fire("box", "dragenter");
                await fire("box", "dragover");
                let over = await toState("drop", 2000);
                let via = "the box";
                if (!over) {
                    // a handler on a descendant of the box
                    await fire("input", "dragenter");
                    await fire("input", "dragover");
                    over = await toState("drop", 2000);
                    via = "the editor";
                }
                const during = await h.ev(`({ state: ${stateOf(A)}, text: ${FLAT}(${boxOf(A)}).slice(0, 160) })`);
                await shot(h, "3-box-drop");
                await fire(via === "the box" ? "box" : "input", "dragleave");
                const back = await toState("idle", SHORT_MS);
                await h.ev(`delete window.__crDrag`);
                rec(`${name}: dragenter and dragover with a file put the box in state drop (a zone saying so); dragleave puts it back to idle`, over && back, { via, during, back });
            });

            // 4. `/` opens the frosted panel above the box
            await run("4. slash panel open", async (name) => {
                await typeInBox(h, A, "/");
                const up = await polishWaitFor(h, `!!document.querySelector("[data-chat-suggest-panel] [data-chat-slash]")`, SHORT_MS);
                const suggest = await toState("suggest", SHORT_MS);
                // the panel springs in: read it once it has settled
                await polishNap(600);
                const got = await h.ev(`(() => {
                    const seen = ${SEEN};
                    const panel = document.querySelector("[data-chat-suggest-panel]");
                    const list = panel?.querySelector("[data-chat-slash]");
                    // the panel itself or the list inside it carries the blur
                    const blurs = [panel, list].filter(Boolean).map((el) => getComputedStyle(el).backdropFilter);
                    return { visible: seen(list), blurs, state: ${stateOf(A)}, rows: panel?.querySelectorAll("[data-chat-slash-item]").length ?? 0, panel: !!panel, listAnywhere: !!document.querySelector("[data-chat-slash]") };
                })()`);
                await shot(h, "4-slash-panel");
                await key(h, KEYS.escape);
                const closed = await polishWaitFor(h, `!document.querySelector("[data-chat-suggest-panel]")`, SHORT_MS);
                await clearBox(h, A);
                const idle = await toState("idle", SHORT_MS);
                rec(
                    `${name}: / opens [data-chat-suggest-panel] holding [data-chat-slash], visible, with a blur(18px) backdrop-filter and the box in state suggest; Escape closes it`,
                    up && suggest && got.visible && got.blurs.some((b) => (b ?? "").includes("blur(18px)")) && got.state === "suggest" && closed && idle,
                    { ...got, closed, idle }
                );
            });

            // 4b. a command Chat answers itself runs on one click: /cont, then the context row, empties the box and draws the
            // context card, with nothing sent to the agent
            await run("4b. in-chat command runs on pick", async (name) => {
                await clearBox(h, A);
                await typeInBox(h, A, "/cont");
                const up = await polishWaitFor(h, `!!document.querySelector('[data-chat-suggest-panel] [data-chat-slash-item="context"]')`, SHORT_MS);
                const group = await h.ev(`document.querySelector("[data-chat-suggest-panel] [data-chat-slash-group]")?.getAttribute("data-chat-slash-group") ?? null`);
                // a row picks on mousedown (the box keeps the focus), as a real click starts
                await h.ev(`document.querySelector('[data-chat-suggest-panel] [data-chat-slash-item="context"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))`);
                const card = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-local="context"]')`, SHORT_MS);
                const got = await h.ev(`({ text: (${inputOf(A)})?.innerText.replace(/\\n$/, "") ?? null, panel: !!document.querySelector("[data-chat-suggest-panel]") })`);
                await shot(h, "4b-in-chat-run");
                rec(
                    `${name}: /cont lists context under In Chat; a click on it draws the [data-chat-local="context"] card and leaves the box empty with the panel shut`,
                    up && group === "In Chat" && card && got.text === "" && !got.panel,
                    { up, group, card, ...got }
                );
            });

            // 5. `@` opens the same panel with the mention list
            await run("5. mention panel open", async (name) => {
                await typeInBox(h, A, "@");
                const up = await polishWaitFor(h, `!!document.querySelector("[data-chat-suggest-panel] [data-chat-mentions]")`, SHORT_MS);
                const suggest = await toState("suggest", SHORT_MS);
                await polishNap(600);
                const got = await h.ev(`(() => {
                    const seen = ${SEEN};
                    const panel = document.querySelector("[data-chat-suggest-panel]");
                    const list = panel?.querySelector("[data-chat-mentions]");
                    const blurs = [panel, list].filter(Boolean).map((el) => getComputedStyle(el).backdropFilter);
                    return { visible: seen(list), blurs, state: ${stateOf(A)}, rows: panel?.querySelectorAll("[data-chat-mention]").length ?? 0, note: list?.querySelector("[data-picker-note]")?.textContent.trim() ?? null, panel: !!panel, listAnywhere: !!document.querySelector("[data-chat-mentions]") };
                })()`);
                await shot(h, "5-mention-panel");
                await key(h, KEYS.escape);
                const closed = await polishWaitFor(h, `!document.querySelector("[data-chat-suggest-panel]")`, SHORT_MS);
                await clearBox(h, A);
                const idle = await toState("idle", SHORT_MS);
                rec(
                    `${name}: @ opens [data-chat-suggest-panel] holding the mention list, visible, with the same blur(18px) and the box in state suggest; Escape closes it`,
                    up && suggest && got.visible && got.blurs.some((b) => (b ?? "").includes("blur(18px)")) && got.state === "suggest" && closed && idle,
                    { ...got, closed, idle }
                );
            });

            // 6. a working agent whose last stretch has a tool in flight: step lines, one running
            await run("6. steps running", async (name) => {
                const u = (sec) => ts(ctx, sec * 1000);
                const file = (f) => join(ctx.cwd, f);
                append(
                    ctx,
                    AC.assistantText("I will read the sync client and search for its retries first.", u(-20)),
                    AC.toolUse("toolu_cr_read", "Read", { file_path: file(FILES[0]) }, u(-18)),
                    AC.toolResult("toolu_cr_read", `${MARK_READ}\nexport const retries = 0;`, u(-17)),
                    AC.toolUse("toolu_cr_grep", "Grep", { pattern: "retries" }, u(-15)),
                    AC.toolResult("toolu_cr_grep", FILES.map((f, i) => `${f}:${i + 1}:export const retries = 0;`).join("\n"), u(-14)),
                    ...FILES.slice(0, 4).flatMap((f, i) => [
                        AC.toolUse(`toolu_cr_edit${i}`, "Edit", { file_path: file(f), old_string: "export const retries = 0;", new_string: "export const retries = 3;\nexport const backoff = true;" }, u(-12 + i)),
                        AC.toolResult(`toolu_cr_edit${i}`, "The file has been updated successfully.", u(-11 + i)),
                    ]),
                    // the last call has no result yet: it is in flight
                    AC.toolUse("toolu_cr_inflight", "Read", { file_path: file(FILES[1]) }, u(-3))
                );
                await setRoster(WORKING);
                const up = await polishWaitFor(h, `(${lastFold(A)}?.textContent ?? "").startsWith("Working for")`, WAIT_MS);
                const lines = await polishWaitFor(h, `${layerOf(A)}?.querySelectorAll("[data-chat-tools] [data-chat-step]").length >= 5`, SHORT_MS);
                await h.ev(`(() => { const r = ${layerOf(A)}?.querySelector("[data-chat-step-running]"); r?.scrollIntoView({ block: "center" }); return true; })()`);
                await polishNap(400);
                const got = await h.ev(`(() => {
                    const layer = ${layerOf(A)};
                    const running = [...(layer?.querySelectorAll("[data-chat-step-running]") ?? [])];
                    return {
                        fold: ${FLAT}(${lastFold(A)}),
                        steps: layer?.querySelectorAll("[data-chat-tools] [data-chat-step]").length ?? 0,
                        running: running.length,
                        runningHasToolRunning: running.every((r) => r.hasAttribute("data-tool-running") || !!r.querySelector("[data-tool-running]") || !!r.closest("[data-tool-running]")),
                        runningText: ${FLAT}(running[0]).slice(0, 120),
                    };
                })()`);
                await shot(h, "6-steps-running");
                rec(
                    `${name}: [data-chat-step] lines sit inside [data-chat-tools], exactly one [data-chat-step-running] also carries data-tool-running, and the [data-chat-work] [data-fold] header reads Working for`,
                    up && lines && got.steps >= 5 && got.running === 1 && got.runningHasToolRunning && got.fold.startsWith("Working for"),
                    got
                );
            });

            // 7. a call that touched many files shows chips and +N; clicking a finished step opens its output under it
            await run("7. step detail", async (name) => {
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const steps = [...(${layerOf(A)}?.querySelectorAll("[data-chat-tools] [data-chat-step]") ?? [])];
                    return steps.map((s) => ({ text: flat(s).slice(0, 90), chips: s.querySelectorAll("[data-chat-step-chip]").length, more: s.querySelector("[data-chat-step-more]")?.textContent.trim() ?? null, running: s.hasAttribute("data-chat-step-running") }));
                })()`);
                // the Grep listed hits in five files: three chips and +2
                const many = got.find((s) => s.chips >= 3 && s.more != null && /^\+\d+/.test(s.more));
                const markBefore = await h.ev(`(${FLAT}(${layerOf(A)}?.querySelector("[data-chat-tools]"))).includes(${JSON.stringify(MARK_READ)})`);
                const spot = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const step = [...(${layerOf(A)}?.querySelectorAll("[data-chat-tools] [data-chat-step]") ?? [])].find((s) => !s.hasAttribute("data-chat-step-running") && /read/i.test(flat(s)) && flat(s).includes("client.ts"));
                    if (!step) return null;
                    step.scrollIntoView({ block: "center" });
                    const r = step.getBoundingClientRect();
                    // the left end of the line (its icon and verb), clear of the chips
                    return { x: r.left + 24, y: r.top + r.height / 2 };
                })()`);
                let opened = false;
                let under = null;
                if (spot != null) {
                    await polishNap(300);
                    const p = await h.ev(`(() => { const s = [...(${layerOf(A)}?.querySelectorAll("[data-chat-tools] [data-chat-step]") ?? [])].find((s) => !s.hasAttribute("data-chat-step-running") && ${FLAT}(s).includes("client.ts")); const r = s.getBoundingClientRect(); return { x: r.left + 24, y: r.top + r.height / 2 }; })()`);
                    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
                    await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
                    await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
                    opened = await polishWaitFor(h, `(${FLAT}(${layerOf(A)}?.querySelector("[data-chat-tools]"))).includes(${JSON.stringify(MARK_READ)})`, SHORT_MS);
                    await polishNap(500);
                    // the output is below the step it belongs to
                    under = await h.ev(`(() => {
                        const flat = ${FLAT};
                        const layer = ${layerOf(A)};
                        const step = [...(layer?.querySelectorAll("[data-chat-tools] [data-chat-step]") ?? [])].find((s) => !s.hasAttribute("data-chat-step-running") && flat(s).includes("client.ts"));
                        const hit = [...(layer?.querySelectorAll("[data-chat-tools] *") ?? [])].filter((e) => e.children.length === 0 && (e.textContent ?? "").includes(${JSON.stringify(MARK_READ)})).pop();
                        if (!step || !hit) return null;
                        return { below: hit.getBoundingClientRect().top >= step.getBoundingClientRect().top + step.getBoundingClientRect().height / 2 - 1, inside: step.contains(hit) || !!(step.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_FOLLOWING) };
                    })()`);
                }
                await shot(h, "7-step-detail");
                rec(
                    `${name}: a step shows [data-chat-step-chip]s and a [data-chat-step-more] +N; clicking a finished step opens its output under it`,
                    many != null && markBefore === false && spot != null && opened && under?.below === true && under.inside === true,
                    { many, markBefore, spot, opened, under, steps: got.slice(0, 8) }
                );
            });

            // 8. the tools finish and the reply lands: the stretch folds into Worked for…
            await run("8. steps folded", async (name) => {
                const u = (sec) => ts(ctx, sec * 1000);
                append(ctx, AC.toolResult("toolu_cr_inflight", "export const delay = 100;", u(0)), AC.assistantText(REPLY, u(1)));
                await setRoster({});
                // the fold flips with the roster, before the transcript re-read draws the reply row: wait for both, then for the arrival spring (0.35 s) to finish
                const folded = await polishWaitFor(h, `(${lastFold(A)}?.textContent ?? "").startsWith("Worked for") && (${layerOf(A)}?.textContent ?? "").includes("What changed")`, WAIT_MS);
                await polishNap(700);
                await h.ev(`(() => { const s = ${scrollerOf(A)}; if (s) s.scrollTop = s.scrollHeight; return true; })()`);
                await polishNap(400);
                const got = await h.ev(`(() => {
                    const layer = ${layerOf(A)};
                    return { fold: ${FLAT}(${lastFold(A)}), steps: layer?.querySelectorAll("[data-chat-step]").length ?? 0, reply: (layer?.textContent ?? "").includes("What changed") };
                })()`);
                await shot(h, "8-steps-folded");
                rec(`${name}: with the reply landed the stretch is the [data-chat-work] [data-fold] line reading Worked for… and no [data-chat-step] is left`, folded && got.fold.startsWith("Worked for") && got.steps === 0 && got.reply, got);
            });

            // 9. the type rhythm of the Chat column
            await run("9. type rhythm", async (name) => {
                const got = await h.ev(`(() => {
                    const layer = ${layerOf(A)};
                    const style = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { size: cs.fontSize, line: cs.lineHeight, weight: cs.fontWeight, radius: cs.borderTopLeftRadius, spacing: cs.letterSpacing }; };
                    const proses = [...(layer?.querySelectorAll("[data-chat-prose]") ?? [])];
                    const reply = proses.find((p) => (p.textContent ?? "").includes("What changed")) ?? proses.at(-1);
                    const para = reply?.querySelector("p") ?? reply;
                    const heading = reply?.querySelector("h1, h2, h3, h4");
                    const you = layer?.querySelector("[data-chat-you]");
                    // the bubble is the element with the radius: the wrapper or the first element inside it
                    const bubble = [you, you?.firstElementChild, you?.querySelector("div")].filter(Boolean).find((e) => getComputedStyle(e).borderTopLeftRadius === "16px") ?? you;
                    return { para: style(para), heading: style(heading), headingTag: heading?.tagName ?? null, root: style(layer?.querySelector("[data-chat-conversation]")), bubble: style(bubble) };
                })()`);
                await shot(h, "9-type-rhythm");
                const px = (v) => parseFloat(v ?? "");
                const line = px(got.para?.line);
                const spacing = px(got.root?.spacing);
                // -0.01em on a 16px root computes -0.16px, the band's edge: the epsilon keeps float rounding from failing it
                const EPS = 1e-6;
                rec(
                    `${name}: prose computes 14px with line-height 22.4-23.1px, a reply heading 15px weight 600, [data-chat-conversation] letter-spacing -0.14px (±0.02), a user bubble radius 16px`,
                    got.para?.size === "14px" && line >= 22.4 && line <= 23.1 && got.heading?.size === "15px" && Number(got.heading?.weight) === 600 &&
                        Math.abs(spacing + 0.14) <= 0.02 + EPS && got.bubble?.radius === "16px",
                    got
                );
            });

            // 10-14b. the brainstorm question card
            await run("10. brainstorm card open", async (name) => {
                await writeBrainstorm(h, ctx, FILES_BRAINSTORM.open);
                const up = await polishWaitFor(h, `${layerOf(A)}?.querySelector('[data-chat-bscard][data-chat-bscard-state="waiting"]') != null`, WAIT_MS);
                await polishNap(600);
                await h.ev(`(() => { const s = ${scrollerOf(A)}; if (s) s.scrollTop = s.scrollHeight; return true; })()`);
                await polishNap(400);
                const card = await readCard(h, A);
                // the placeholder is the sibling the editor draws while the box is empty; any aria-hidden text in the box counts
                const holders = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const layer = ${layerOf(A)};
                    const input = layer?.querySelector("[data-chat-input]");
                    const near = [...(input?.parentElement?.querySelectorAll(":scope > [aria-hidden]") ?? [])].map(flat);
                    const inBox = [...(layer?.querySelector("[data-chat-box]")?.querySelectorAll("[aria-hidden]") ?? [])].map(flat);
                    return { near, inBox: inBox.filter((t) => t !== "").slice(0, 6), attr: input?.getAttribute("aria-placeholder") ?? input?.getAttribute("data-placeholder") ?? null };
                })()`);
                const placeholder = [...holders.near, ...holders.inBox, holders.attr].includes(QUESTION_PLACEHOLDER);
                await shot(h, "10-brainstorm-card-open");
                rec(
                    `${name}: [data-chat-bscard] in state waiting with three [data-chat-bscard-option] rows, and the box's placeholder reads "${QUESTION_PLACEHOLDER}"`,
                    up && card.state === "waiting" && card.options === 3 && placeholder,
                    { card, holders }
                );
            });

            await run("11. brainstorm card weighing", async (name) => {
                await writeBrainstorm(h, ctx, FILES_BRAINSTORM.weighing);
                const weighing = await polishWaitFor(h, `${layerOf(A)}?.querySelector('[data-chat-bscard][data-chat-bscard-state="weighing"]') != null`, WAIT_MS);
                await polishNap(600);
                const card = await readCard(h, A);
                await shot(h, "11-brainstorm-card-weighing");
                rec(`${name}: the question with no options yet is in state weighing and draws no option rows`, weighing && card.state === "weighing" && card.options === 0, card);
            });

            await run("12. brainstorm card multi", async (name) => {
                await writeBrainstorm(h, ctx, FILES_BRAINSTORM.multi);
                const up = await polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-bscard-option]").length ?? 0) === 3 && ${layerOf(A)}?.querySelector("[data-chat-bscard-send]") != null`, WAIT_MS);
                await polishNap(600);
                const card = await readCard(h, A);
                await shot(h, "12-brainstorm-card-multi");
                rec(`${name}: a multi-answer question draws tick boxes on its three options and a [data-chat-bscard-send] button`, up && card.options === 3 && card.ticks >= 3 && card.send, card);
            });

            await run("13. brainstorm card static", async (name) => {
                // back to the plain question, then the agent's process exits (the event the Brainstorm pane reads for its exited card)
                await writeBrainstorm(h, ctx, FILES_BRAINSTORM.open);
                await polishWaitFor(h, `${layerOf(A)}?.querySelector('[data-chat-bscard][data-chat-bscard-state="waiting"]') != null`, WAIT_MS);
                await h.rpc("eventpublish", {
                    event: "controllerstatus",
                    scopes: [`block:${ctx.tab.blockId}`],
                    data: { blockid: ctx.tab.blockId, shellprocstatus: "done", shellprocexitcode: 1 },
                });
                ctx.exited = true;
                const isStatic = await polishWaitFor(h, `${layerOf(A)}?.querySelector('[data-chat-bscard][data-chat-bscard-state="static"]') != null`, WAIT_MS);
                await polishNap(600);
                const card = await readCard(h, A);
                await shot(h, "13-brainstorm-card-static");
                await h.rpc("eventpublish", {
                    event: "controllerstatus",
                    scopes: [`block:${ctx.tab.blockId}`],
                    data: { blockid: ctx.tab.blockId, shellprocstatus: "running", shellprocexitcode: 0 },
                });
                ctx.exited = false;
                rec(`${name}: once the agent has exited the card is in state static with no amber dot, and [data-chat-bscard-open] is still there`, isStatic && card.state === "static" && !card.amber && !card.waitingText && card.open, card);
            });

            await run("14. brainstorm card folded", async (name) => {
                await polishWaitFor(h, `${layerOf(A)}?.querySelector('[data-chat-bscard][data-chat-bscard-state="waiting"]') != null`, WAIT_MS);
                // what Arc stores when the answer goes to the agent: the first user message with this text after the record is the answer
                const record = { topic: TOPIC, n: 1, part: "policy", text: ANSWER, sentAt: Date.now(), seen: 0 };
                const wrote = await h.ev(`(() => {
                    try {
                        const all = JSON.parse(localStorage.getItem(${JSON.stringify(SENT_KEY)}) ?? "{}");
                        all[${JSON.stringify(A)}] = [...(all[${JSON.stringify(A)}] ?? []), ${JSON.stringify(record)}];
                        localStorage.setItem(${JSON.stringify(SENT_KEY)}, JSON.stringify(all));
                        return true;
                    } catch (e) { return String(e); }
                })()`);
                // the store reads the key again (no reload: that drops the injected roster): its reader through the page
                const reread = await AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/chatbrainstormstore.ts");
                    const got = S.brainstormAnswers(${JSON.stringify(A)});
                    return Array.isArray(got) ? got.length : -1;`
                ).catch((e) => `unreadable: ${String(e?.message ?? e)}`);
                append(ctx, AC.userText(ANSWER, ts(ctx)));
                await writeBrainstorm(h, ctx, FILES_BRAINSTORM.answered);
                const row = `(${layerOf(A)}?.querySelectorAll("[data-chat-bscard-answered]").length ?? 0) >= 1`;
                let via = "the stored record";
                let folded = await polishWaitFor(h, row, 8000);
                if (!folded) {
                    // the store holds its records in memory and was not told of the write: record it as a send does, to judge the fold itself
                    via = "recordBrainstormAnswer (the store did not re-read localStorage)";
                    await AC.agentPage(
                        h,
                        `const S = await mod("app/view/agents/chatbrainstormstore.ts");
                        S.recordBrainstormAnswer(${JSON.stringify(A)}, ${JSON.stringify(record)});
                        return true;`
                    ).catch(() => {});
                    folded = await polishWaitFor(h, row, WAIT_MS);
                }
                await polishNap(700);
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const layer = ${layerOf(A)};
                    return {
                        answered: [...(layer?.querySelectorAll("[data-chat-bscard-answered]") ?? [])].map(flat),
                        bubbles: [...(layer?.querySelectorAll("[data-chat-you]") ?? [])].filter((e) => (e.textContent ?? "").includes(${JSON.stringify(ANSWER)})).length,
                        waitingCard: !!layer?.querySelector("[data-chat-bscard]"),
                    };
                })()`);
                await shot(h, "14-brainstorm-card-folded");
                rec(
                    `${name}: the answered question folds into a [data-chat-bscard-answered] row naming question 1 and the answer, and no user bubble with that text is left`,
                    wrote === true && folded && got.answered.some((t) => t.includes("Question 1") && t.includes(ANSWER)) && got.bubbles === 0,
                    { wrote, reread, via, ...got }
                );
            });

            await run("14b. brainstorm card builder check", async (name) => {
                // the builder check: no open question, the check is a card of its own in Chat (chat-brainstorm-review reads it
                // in full); the one-line pointer to the Brainstorm tab is gone
                await writeBrainstorm(h, ctx, FILES_BRAINSTORM.check);
                const up = await polishWaitFor(h, `${layerOf(A)}?.querySelector('[data-chat-bscard-kind="check"]') != null`, WAIT_MS);
                await polishNap(600);
                const card = await readCard(h, A);
                await shot(h, "14b-brainstorm-card-check");
                rec(
                    `${name}: at the builder check the card is [data-chat-bscard-kind="check"], there is no [data-chat-bscard-pointer] line, and no [data-chat-bscard-option] row is drawn`,
                    up && card.checkCard && !card.pointer && card.options === 0,
                    card
                );
            });

            // 14c. a question typed back while the card waits is no answer: the card goes (the reply is the agent's to take),
            // and comes back once the agent rewrites the file still asking it; the typed message's ✓ row says "You replied"
            // and a clicked option's says "You picked"
            await run("14c. brainstorm card typed reply", async (name) => {
                const TYPED = "should the cap stay at 30 seconds?";
                const questionCard = `${layerOf(A)}?.querySelector('[data-chat-bscard-kind="question"]')`;
                // the answered rows as [text, label at the row's end], read from the page
                const rows = () =>
                    h.ev(`(() => {
                        const flat = ${FLAT};
                        return [...(${layerOf(A)}?.querySelectorAll("[data-chat-bscard-answered]") ?? [])].map((r) => ({
                            text: flat(r),
                            label: flat(r.lastElementChild),
                        }));
                    })()`);
                // step 14 left an answer to question 1 on record; a file written since, asking 1, brings the card back
                await writeBrainstorm(h, ctx, FILES_BRAINSTORM.open);
                const waiting = await polishWaitFor(h, `${questionCard}?.getAttribute("data-chat-bscard-state") === "waiting"`, WAIT_MS);
                await polishNap(600);
                // 1. a question typed back in the box, sent
                await clearBox(h, A);
                await typeInBox(h, A, TYPED);
                await key(h, KEYS.enter);
                // the box empties once the message went (an empty editor reads "\\n")
                const sentOk = await polishWaitFor(h, `((${inputOf(A)})?.innerText ?? "x").trim() === ""`, SHORT_MS);
                // the message lands in the transcript the way the harness writes it
                append(ctx, AC.userText(TYPED, ts(ctx)));
                const hidden = await polishWaitFor(h, `${questionCard} == null`, WAIT_MS);
                const replied = await polishWaitFor(
                    h,
                    `[...(${layerOf(A)}?.querySelectorAll("[data-chat-bscard-answered]") ?? [])].some((r) => (r.textContent ?? "").includes(${JSON.stringify(TYPED)}))`,
                    WAIT_MS
                );
                await polishNap(500);
                const whileHidden = await rows();
                await shot(h, "14c-typed-reply-hidden");
                // 2. the agent rewrites the file, still asking question 1, later than the record
                await polishNap(400);
                await writeBrainstorm(
                    h,
                    ctx,
                    brainstormFile({ question: { ...Q1, why: "The cap is one constant either way, so keeping it at 30 seconds costs nothing." } })
                );
                // 3. the question card is drawn again
                const back = await polishWaitFor(h, `${questionCard}?.getAttribute("data-chat-bscard-state") === "waiting"`, WAIT_MS);
                await polishNap(600);
                const whenBack = await rows();
                await shot(h, "14c-typed-reply-back");
                // 4. the typed message's row reads "You replied"; step 14's answer, a record with no flag, still "You picked"
                // (reported in the detail, not judged here: that row belongs to step 14)
                const typedRow = whenBack.find((r) => r.text.includes(TYPED));
                const oldRow = whenBack.find((r) => r.text.includes(ANSWER));
                // 5. a click on an option of the card the agent asked again: its row reads "You picked"
                const OPTION = "Fixed delay";
                const clicked = await h.ev(`(() => {
                    const b = ${layerOf(A)}?.querySelector('[data-chat-bscard-kind="question"] [data-chat-bscard-option="1"]');
                    if (!b || b.disabled) return false;
                    b.click();
                    return true;
                })()`);
                append(ctx, AC.userText(OPTION, ts(ctx)));
                const picked = await polishWaitFor(
                    h,
                    `[...(${layerOf(A)}?.querySelectorAll("[data-chat-bscard-answered]") ?? [])].some((r) => (r.textContent ?? "").includes(${JSON.stringify(OPTION)}))`,
                    WAIT_MS
                );
                await polishNap(500);
                const whenPicked = await rows();
                await shot(h, "14c-picked");
                const pickedRow = whenPicked.find((r) => r.text.includes(OPTION));
                rec(
                    `${name}: a question typed in the box hides the card and its [data-chat-bscard-answered] row reads "You replied"; once the file is rewritten still asking question 1 [data-chat-bscard-kind="question"] is drawn again; a clicked option's row reads "You picked"`,
                    waiting && sentOk && hidden && replied && back && typedRow?.label === "You replied" && clicked && picked &&
                        pickedRow?.label === "You picked",
                    { waiting, sentOk, hidden, replied, whileHidden, back, whenBack, oldRow, clicked, picked, whenPicked }
                );
            });

            // 15. the jump button: scrolled up it shows, a click goes back to the tail
            await run("15. jump button", async (name) => {
                // the brainstorm is not what these last steps measure: detach it
                await AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/brainstormstore.ts");
                    S.detachBrainstorm(${JSON.stringify(A)});
                    return true;`
                ).catch(() => {});
                await polishNap(500);
                await h.ev(`(() => { const s = ${scrollerOf(A)}; if (s) s.scrollTop = s.scrollHeight; return true; })()`);
                await polishNap(500);
                const scrolled = await h.ev(`(() => {
                    const s = ${scrollerOf(A)};
                    if (!s) return null;
                    s.scrollTop = 0;
                    s.dispatchEvent(new Event("scroll"));
                    return { top: Math.round(s.scrollTop), height: s.scrollHeight, client: s.clientHeight };
                })()`);
                const shown = await polishWaitFor(h, `${SEEN}(${layerOf(A)}?.querySelector("[data-chat-jump]"))`, SHORT_MS);
                await polishNap(500);
                const geo = await h.ev(`(() => {
                    const j = ${layerOf(A)}?.querySelector("[data-chat-jump]");
                    const b = ${boxOf(A)};
                    if (!j) return null;
                    const r = j.getBoundingClientRect();
                    const br = b?.getBoundingClientRect();
                    return { w: Math.round(r.width), h: Math.round(r.height), aboveBox: br ? r.bottom <= br.top + 1 : null, key: j.querySelector("kbd")?.textContent ?? null };
                })()`);
                await shot(h, "15-jump-visible");
                await h.ev(`${layerOf(A)}?.querySelector("[data-chat-jump]")?.click()`);
                const atEnd = await polishWaitFor(h, `(() => { const s = ${scrollerOf(A)}; return !!s && s.scrollHeight - s.scrollTop - s.clientHeight <= 8; })()`, SHORT_MS);
                const gone = await polishWaitFor(h, `!${SEEN}(${layerOf(A)}?.querySelector("[data-chat-jump]"))`, SHORT_MS);
                await shot(h, "15-jump-gone");
                rec(`${name}: scrolled up [data-chat-jump] is visible (a 32px-high pill above the box naming its key); a click returns to the end and it leaves`, shown && geo?.h === 32 && geo.w > 32 && /End/.test(geo.key ?? "") && geo.aboveBox === true && atEnd && gone, { scrolled, shown, geo, atEnd, gone });
            });

            // 16. frame timing while 30 blocks stream in
            await run("16. frame timing", async (name) => {
                await setRoster(WORKING);
                await h.ev(`(() => { const s = ${scrollerOf(A)}; if (s) s.scrollTop = s.scrollHeight; return true; })()`);
                await polishNap(800);
                await h.ev(`(() => {
                    const f = { on: true, last: 0, deltas: [] };
                    window.__crFrames = f;
                    const tick = (t) => {
                        if (!f.on) return;
                        if (f.last) f.deltas.push(t - f.last);
                        f.last = t;
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                    return true;
                })()`);
                for (let i = 0; i < BLOCKS; i++) {
                    append(ctx, AC.assistantText(`Block ${i + 1} of ${BLOCKS}. ${PROSE}`, ts(ctx)));
                    await polishNap(BLOCK_GAP_MS);
                }
                await polishNap(FRAME_SETTLE_MS);
                const stats = await h.ev(`(() => {
                    const f = window.__crFrames;
                    f.on = false;
                    const d = [...f.deltas].sort((a, b) => a - b);
                    delete window.__crFrames;
                    if (d.length === 0) return null;
                    const at = (q) => d[Math.min(d.length - 1, Math.ceil(q * d.length) - 1)];
                    const s = ${scrollerOf(A)};
                    return { frames: d.length, p50: at(0.5), p95: at(0.95), worst: d[d.length - 1], atEnd: !!s && s.scrollHeight - s.scrollTop - s.clientHeight <= 8 };
                })()`);
                const shown = await h.ev(`(${FLAT}(${layerOf(A)})).includes("Block ${BLOCKS} of ${BLOCKS}.")`);
                await shot(h, "16-frame-timing");
                const round = (v) => Math.round(v * 10) / 10;
                rec(
                    `${name}: while ${BLOCKS} blocks land ${BLOCK_GAP_MS} ms apart the p95 frame interval is at most ${FRAME_P95_MAX_MS} ms and the view follows the tail to the end`,
                    stats != null && stats.frames > 30 && stats.p95 <= FRAME_P95_MAX_MS && shown && stats.atEnd,
                    stats == null ? "no frames were recorded" : { p95Ms: round(stats.p95), worstMs: round(stats.worst), p50Ms: round(stats.p50), frames: stats.frames, followedTail: stats.atEnd, lastBlockShown: shown }
                );
            });

            // 17. an image pasted into the box: its chip opens it full size, and Escape closes it with the image still attached
            await run("17. pasted image opens", async (name) => {
                const pasted = await h.ev(`(() => {
                    const box = ${inputOf(A)};
                    if (!box) return { ok: false, why: "no box" };
                    box.focus();
                    // a 320x200 picture drawn here, so the zoom has something to fit
                    const c = document.createElement("canvas");
                    c.width = 320;
                    c.height = 200;
                    const g = c.getContext("2d");
                    g.fillStyle = "#d97757";
                    g.fillRect(0, 0, 320, 200);
                    g.fillStyle = "#30302e";
                    g.fillRect(40, 40, 240, 120);
                    const bin = atob(c.toDataURL("image/png").split(",")[1]);
                    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
                    const dt = new DataTransfer();
                    dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
                    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
                    box.dispatchEvent(ev);
                    return { ok: true, taken: ev.defaultPrevented };
                })()`);
                const chip = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-attachment-chip] [data-attachment-open]")`, SHORT_MS);
                await h.ev(`${layerOf(A)}?.querySelector("[data-attachment-open]")?.click()`);
                const opened = await polishWaitFor(h, `!!document.querySelector("[data-image-zoom] [data-image-zoom-img]")`, SHORT_MS);
                await polishNap(400);
                const zoom = await h.ev(`(() => {
                    const img = document.querySelector("[data-image-zoom-img]");
                    const r = img?.getBoundingClientRect();
                    return img ? { src: img.getAttribute("src")?.slice(0, 5), w: Math.round(r.width), h: Math.round(r.height) } : null;
                })()`);
                await shot(h, "17-image-zoom");
                await key(h, KEYS.escape);
                const closed = await polishWaitFor(h, `!document.querySelector("[data-image-zoom]")`, SHORT_MS);
                const kept = await h.ev(`!!${layerOf(A)}?.querySelector("[data-attachment-chip] [data-attachment-open]")`);
                // take the image back out, so the box is as the steps before left it
                await h.ev(`${layerOf(A)}?.querySelector('[data-attachment-chip] button[title="Remove"]')?.click()`);
                rec(
                    `${name}: a pasted image shows a chip whose [data-attachment-open] opens [data-image-zoom] with the image drawn; Escape closes it and the image stays attached`,
                    pasted.ok && chip && opened && zoom != null && zoom.w > 0 && closed && kept,
                    { pasted, chip, opened, zoom, closed, kept }
                );
            });

            // 18. suggested replies: a turn that ends on a question offers the model's answers (the recommended one spelled
            // out first), a click sends one; a turn that ends on a statement offers the one next step the model names
            await run("18. suggested replies", async (name) => {
                await clearBox(h, A);
                await h.ev(`(() => {
                    window.__crSuggestAsked = [];
                    window.__chatSuggestFake = (d) => {
                        window.__crSuggestAsked.push(d);
                        return d.question ? ["B, ẩn thẻ Pin", "A", "C"] : ["vẽ tôi xem"];
                    };
                    return true;
                })()`);
                const chipsNow = `[...(${layerOf(A)}?.querySelectorAll("[data-chat-suggest-chip]") ?? [])].map((b) => ({ text: ${FLAT}(b), source: b.getAttribute("data-chat-suggest-chip") }))`;
                append(
                    ctx,
                    AC.userText("vẽ 3 phương án bố cục cho trang Jarvis", ts(ctx, -2000)),
                    AC.assistantText(
                        'Ba phương án: A cột phải tự cuộn, B cột phải thành tab, C cân lại hai cột. Theo tôi B gọn nhất.\n\nBạn chọn A, B hay C, và có ẩn thẻ "Pin an initiative" không?',
                        ts(ctx, -1000)
                    )
                );
                await setRoster({ idleSince: Date.now() });
                const shown = await polishWaitFor(h, `(${chipsNow}).length === 3`, WAIT_MS);
                await polishNap(400);
                const question = await h.ev(`({ chips: ${chipsNow}, asked: window.__crSuggestAsked.at(-1) ?? null })`);
                await shot(h, "18-suggest-question");
                await h.ev(`${layerOf(A)}?.querySelector("[data-chat-suggest-chip]")?.click()`);
                const sent = await polishWaitFor(
                    h,
                    `[...(${layerOf(A)}?.querySelectorAll("[data-chat-you], [data-chat-pending]") ?? [])].some((el) => ${FLAT}(el).includes("B, ẩn thẻ Pin")) && (${chipsNow}).length === 0`,
                    WAIT_MS
                );
                append(
                    ctx,
                    AC.userText("B, ẩn thẻ Pin", ts(ctx, 0)),
                    AC.assistantText("Xong: trang Jarvis giờ có bốn tab, và thẻ Pin ẩn khi đã ghim một initiative.", ts(ctx, 500))
                );
                await setRoster({ idleSince: Date.now() + 1000 });
                const next = await polishWaitFor(h, `(${chipsNow}).some((c) => c.text === "vẽ tôi xem")`, WAIT_MS);
                await polishNap(300);
                const statement = await h.ev(`({ chips: ${chipsNow}, asked: window.__crSuggestAsked.at(-1) ?? null })`);
                await shot(h, "18-suggest-next");
                const q = question.chips;
                rec(
                    `${name}: a question offers [data-chat-suggest-chip="model"] B, ẩn thẻ Pin · A · C, asked as a question with the person's last message; a click sends it (its bubble, pending or landed) and the chips go; a statement offers vẽ tôi xem`,
                    shown &&
                        q.map((c) => c.text).join(" · ") === "B, ẩn thẻ Pin · A · C" &&
                        q.every((c) => c.source === "model") &&
                        question.asked?.question === true &&
                        (question.asked?.recent ?? []).includes("vẽ 3 phương án bố cục cho trang Jarvis") &&
                        sent &&
                        next &&
                        statement.chips.length === 1 &&
                        statement.asked?.question !== true,
                    { question, sent, statement }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-redesign teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("remove the probes", () =>
                h.ev(
                    `(() => { if (window.__crFrames) window.__crFrames.on = false; delete window.__crFrames; delete window.__crDrag; delete window.__chatSuggestFake; delete window.__crSuggestAsked; return true; })()`
                )
            );
            if (ctx.tab != null) {
                await step("clear the exit", () =>
                    h.rpc("eventpublish", {
                        event: "controllerstatus",
                        scopes: [`block:${ctx.tab.blockId}`],
                        data: { blockid: ctx.tab.blockId, shellprocstatus: "running", shellprocexitcode: 0 },
                    })
                );
                await step("detach the brainstorm", () =>
                    AC.agentPage(h, `const S = await mod("app/view/agents/brainstormstore.ts"); S.detachBrainstorm(${JSON.stringify(ctx.tab.tabId)}); return true;`)
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
