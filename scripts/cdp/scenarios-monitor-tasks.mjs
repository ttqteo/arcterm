// monitor-tasks: the Monitors and background shell commands an agent left running, as rows under it in the Agent tree and
// the Events / Output peek that opens beside a row (ported from the fork's commit 798335c28, onto our rows and peek:
// frontend/app/view/agents/agenttree.tsx BackgroundTaskRows, backgroundtaskpeek.tsx). One fixture agent whose terminal is a
// real block (so the scenario can see opening a peek leave its xterm alone) and whose transcript holds a background shell, a
// Monitor that reported events, a quiet Monitor, one past its timeout and one whose stream ended: the last two must not list.
// kit is scenarios.mjs's RT_KIT.

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT = "fx-monitor-tasks";
const AGENT_NAME = "monitor-tasks agent";
const PROJECT = "verify-monitor-tasks";
const MIN = 60_000;
const STRAY_LINE = "grep: warning: stray \\ before -";

// the Stop in the peek draws where the kill exists (isWindows in the app); the browser app on a Mac does not
const STOP_DRAWS = process.platform === "win32";

const SHELL = {
    id: "bmtshell",
    description: "serve the preview",
    command: "npm run preview",
    startedAgo: 14 * MIN,
    output: ["preview on :4173", "ready in 312 ms", "dist/assets/redux-selector-B5jgC3IP.svg                     1.51 kB │ gzip:     0.77 kB"],
};
// the build line wider than the peek's default 560px: it wraps there, and reads on one line once the peek is dragged wider
const WIDE_LINE = SHELL.output[2];
// where the peek keeps its dragged size (backgroundtaskpeek.tsx)
const PEEK_SIZE_KEY = "bgtaskpeek.size";
// a line as the page's text() reads it: runs of spaces squashed to one
const squash = (s) => s.replace(/\s+/g, " ").trim();
const MONITORS = [
    {
        id: "bmtevents",
        description: "final-verify PASS/FAIL lines",
        command: 'tail -f final-verify.log | grep --line-buffered -E "PASS|FAIL\\-"',
        startedAgo: 12 * MIN,
        timeoutMs: 30 * MIN,
        events: [
            { ago: 10 * MIN, lines: ["PASS surface-smoke"] },
            { ago: 7 * MIN, lines: ["FAIL shell-tasks", "3b. Kill: the X shows on the hovered row only"] },
            { ago: 4 * MIN, lines: ["PASS shell-tasks"] },
            { ago: 1.5 * MIN, lines: ["PASS monitor-tasks"] },
        ],
        // A real running Monitor's start result names no output file, so it reads "No output yet" (bmtquiet). This one
        // names its file the way a shell task's start result does, so the Output tab's read, tail and footer are seen on
        // a Monitor too.
        output: true,
    },
    {
        id: "bmtquiet",
        description: "errors in waveapp.log",
        command: 'tail -f waveapp.log | grep --line-buffered "error"',
        startedAgo: 2 * MIN,
        timeoutMs: 30 * MIN,
        events: [],
    },
    // started 40m ago with a 30m timeout: it writes no record when it expires, and the transcript read says so
    {
        id: "bmtexpired",
        description: "tail the old build log",
        command: "tail -f build.log",
        startedAgo: 40 * MIN,
        timeoutMs: 30 * MIN,
        events: [],
    },
    // its stream ended: a status notification names its output file
    {
        id: "bmtended",
        description: "watch the deploy stream",
        command: "./deploy-stream.sh",
        startedAgo: 35 * MIN,
        timeoutMs: 60 * MIN,
        events: [],
        endedAgo: 30 * MIN,
    },
];
const EVENTS = MONITORS[0];
const QUIET = MONITORS[1];
const GONE = MONITORS.filter((m) => m.endedAgo != null || m.id === "bmtexpired");
const LIVE_IDS = [SHELL.id, EVENTS.id, QUIET.id];

const iso = (ms) => new Date(ms).toISOString();
const outFile = (cwd, id) => join(cwd, `${id}.output`);

// the assistant tool_use and the user record of its start result
function shellStart(t, cwd, now) {
    const toolUseId = `toolu_${t.id}`;
    const timestamp = iso(now - t.startedAgo);
    return [
        {
            type: "assistant",
            timestamp,
            message: {
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        id: toolUseId,
                        name: "Bash",
                        input: { command: t.command, description: t.description, run_in_background: true },
                    },
                ],
            },
        },
        {
            type: "user",
            timestamp,
            message: {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: toolUseId,
                        content: `Command running in background with ID: ${t.id}. Output is being written to: ${outFile(cwd, t.id)}. You will be notified when it completes.`,
                    },
                ],
            },
            toolUseResult: { backgroundTaskId: t.id },
        },
    ];
}

function monitorStart(m, cwd, now) {
    const toolUseId = `toolu_${m.id}`;
    const timestamp = iso(now - m.startedAgo);
    const input = { description: m.description, timeout_ms: m.timeoutMs, command: m.command };
    const named = m.output ? ` Output is being written to: ${outFile(cwd, m.id)}. You will be notified when it completes.` : "";
    return [
        {
            type: "assistant",
            timestamp,
            message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "Monitor", input }] },
        },
        {
            type: "user",
            timestamp,
            message: {
                role: "user",
                content: [
                    {
                        tool_use_id: toolUseId,
                        type: "tool_result",
                        content: `Monitor started (task ${m.id}, expires in ${m.timeoutMs / MIN}m unless the source ends first; events arrive as notifications.)${named}`,
                    },
                ],
            },
            toolUseResult: { taskId: m.id, timeoutMs: m.timeoutMs, persistent: false },
        },
    ];
}

// an event is written twice: the queue-operation enqueue, then the user record a turn delivers it in
function monitorEvent(m, ev, now) {
    const content = [
        "<task-notification>",
        `<task-id>${m.id}</task-id>`,
        `<summary>Monitor event: "${m.description}"</summary>`,
        `<event>${ev.lines.join("\n")}</event>`,
        "</task-notification>",
    ].join("\n");
    return [
        { type: "queue-operation", operation: "enqueue", timestamp: iso(now - ev.ago), content },
        { type: "user", timestamp: iso(now - ev.ago + 1000), message: { role: "user", content } },
    ];
}

// a stream-ended notification: it names the tool use, the status and the output file
function monitorEnded(m, cwd, now) {
    return [
        {
            type: "queue-operation",
            operation: "enqueue",
            timestamp: iso(now - m.endedAgo),
            content: [
                "<task-notification>",
                `<task-id>${m.id}</task-id>`,
                `<tool-use-id>toolu_${m.id}</tool-use-id>`,
                `<output-file>${outFile(cwd, m.id)}</output-file>`,
                "<status>completed</status>",
                `<summary>Monitor "${m.description}" stream ended</summary>`,
                "</task-notification>",
            ].join("\n"),
        },
    ];
}

// what claude writes after a TaskStop: the tool use and its success result
function taskStopRecords(m, now) {
    const timestamp = iso(now);
    const toolUseId = `toolu_stop_${m.id}`;
    const message = `Successfully stopped task: ${m.id} (${m.command})`;
    return [
        {
            type: "assistant",
            timestamp,
            message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "TaskStop", input: { task_id: m.id } }] },
        },
        {
            type: "user",
            timestamp,
            message: {
                role: "user",
                content: [{ tool_use_id: toolUseId, type: "tool_result", content: JSON.stringify({ message, task_id: m.id }) }],
            },
            toolUseResult: { message, task_id: m.id, command: m.command },
        },
    ];
}

const jsonl = (records) => records.map((r) => JSON.stringify(r) + "\n").join("");

// writes the transcript and the output files its tasks name; returns the transcript's path
function writeTranscript(cwd) {
    const now = Date.now();
    const records = [...shellStart(SHELL, cwd, now)];
    writeFileSync(outFile(cwd, SHELL.id), SHELL.output.map((l) => l + "\n").join(""));
    for (const m of MONITORS) {
        records.push(...monitorStart(m, cwd, now));
        for (const ev of m.events) records.push(...monitorEvent(m, ev, now));
        if (m.endedAgo != null) records.push(...monitorEnded(m, cwd, now));
        if (m.output) writeFileSync(outFile(cwd, m.id), [STRAY_LINE, ...m.events.flatMap((e) => e.lines)].map((l) => l + "\n").join(""));
    }
    // a real transcript is in time order; the shell task's start lands between the monitors'
    records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const first = { type: "user", cwd, timestamp: iso(now - 50 * MIN), message: { role: "user", content: "verify monitor-tasks" } };
    const transcript = join(cwd, "monitor-tasks.jsonl");
    writeFileSync(transcript, jsonl([first, ...records]));
    return transcript;
}

// runs IN THE PAGE: the tree's rows for the fixture agent, the peek and the pane
const LIB = `
    const text = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn, ms = 8000) => {
        for (const t0 = Date.now(); Date.now() - t0 < ms; await nap(120)) if (fn()) return true;
        return !!fn();
    };
    const rowsBox = () => document.querySelector('[data-testid="background-task-rows"][data-task-agent="${AGENT}"]');
    const rows = () => [...(rowsBox()?.querySelectorAll('[data-testid="background-task-row"]') ?? [])];
    const row = (id) => rows().find((r) => r.getAttribute("data-task-id") === id) ?? null;
    const peek = () => document.querySelector('[data-testid="background-task-peek"]');
    const tid = (el, id) => el?.querySelector('[data-testid="' + id + '"]') ?? null;
    const pane = () => document.querySelector('[data-agent-terminal="${AGENT}"]');
    // the selected agent row is the one filled row: focusIdAtom, as the tree draws it
    const focusRow = () =>
        [...document.querySelectorAll("[data-agent-row]")].find((r) => r.className.includes("bg-surface-selected"))?.getAttribute("data-agent-row") ?? null;
`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, openRailTerminal, ahReload, TREE_RAIL_FIXTURE, UI_ROUTE } = kit;

    async function key(h, k, code, keyCode) {
        const e = { key: k, code, windowsVirtualKeyCode: keyCode, modifiers: 0 };
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...e });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...e });
        await polishNap(300);
    }

    // the agent's pane is the one shown
    async function show(h) {
        await h.rpc("uireveal", { address: `agent:${AGENT}` }, UI_ROUTE);
        return polishWaitFor(h, `(() => { const p = document.querySelector('[data-agent-terminal="${AGENT}"]'); return p != null && !p.classList.contains("hidden"); })()`, 10000);
    }

    // presses a row, then waits for the peek `ready` (an expression over `p`, the peek's root) says is drawn, and reads it
    async function openPeek(h, id, ready = "true") {
        await h.ev(`(() => { ${LIB} row(${JSON.stringify(id)})?.click(); })()`);
        return readPeek(h, ready);
    }

    async function readPeek(h, ready = "true") {
        return h.ev(`(async () => {
            ${LIB}
            await until(() => { const p = peek(); return p != null && (${ready}); }, 10000);
            await nap(400);
            const p = peek();
            if (!p) return null;
            const tab = (name) => {
                const t = tid(p, "background-task-peek-tab-" + name);
                return t ? { text: text(t), selected: t.getAttribute("aria-selected"), role: t.getAttribute("role") } : null;
            };
            const footer = tid(p, "background-task-peek-footer");
            const body = (id) => (tid(p, id) ? text(tid(p, id)) : null);
            return {
                kind: p.getAttribute("data-task-kind"),
                state: p.getAttribute("data-task-state"),
                role: p.getAttribute("role"),
                title: body("background-task-peek-title"),
                stateText: body("background-task-peek-state"),
                command: body("background-task-peek-command"),
                tablist: p.querySelector('[role="tablist"]')?.getAttribute("aria-label") ?? null,
                events: tab("events"),
                output: tab("output"),
                eventRows: [...p.querySelectorAll('[data-testid="background-task-peek-event"]')].map((e) => ({ time: text(e.children[0]), body: text(e.children[1]) })),
                eventsEmpty: body("background-task-peek-events-empty"),
                outputBody: body("background-task-peek-output"),
                outputEmpty: body("background-task-peek-output-empty"),
                footer: footer ? [...footer.children].map((c) => ({ text: text(c), title: c.getAttribute("title") })) : [],
                stop: tid(p, "background-task-peek-stop") != null,
                hasFocus: p.contains(document.activeElement),
            };
        })()`);
    }

    const selectTab = (h, name) =>
        h.ev(`(async () => {
            ${LIB}
            tid(peek(), "background-task-peek-tab-${name}")?.click();
            await until(() => tid(peek(), "background-task-peek-tab-${name}")?.getAttribute("aria-selected") === "true", 3000);
        })()`);

    // true once the peek is gone
    const closed = (h) => h.ev(`(async () => { ${LIB} return await until(() => peek() == null, 4000); })()`);

    // the row's own state: whether it is pressed open
    const rowOpen = (h, id) => h.ev(`(() => { ${LIB} return row(${JSON.stringify(id)})?.getAttribute("aria-expanded") ?? null; })()`);

    const scenario = {
        name: "monitor-tasks",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                cwd: mkdtempSync(join(tmpdir(), "verify-monitor-tasks-")),
                terminals: [],
                prevFixture: existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE, "utf8") : null,
            };
            try {
                // the peek opens at its default size: a size the app kept from an earlier drag is set aside until teardown
                ctx.prevPeekSize = await h.ev(`(() => {
                    const v = localStorage.getItem(${JSON.stringify(PEEK_SIZE_KEY)});
                    localStorage.removeItem(${JSON.stringify(PEEK_SIZE_KEY)});
                    return v;
                })()`);
                ctx.transcript = writeTranscript(ctx.cwd);
                const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                const wslist = await h.rpc("workspacelist", null);
                const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
                ctx.workspaceId = ws.workspacedata.oid;
                await openRailTerminal(h, ctx, PROJECT);
                mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
                writeFileSync(
                    TREE_RAIL_FIXTURE,
                    JSON.stringify(
                        [
                            {
                                id: AGENT,
                                name: AGENT_NAME,
                                project: PROJECT,
                                task: "watch final-verify and stand by",
                                state: "idle",
                                agent: "claude",
                                model: "opus",
                                idleSince: Date.now() - 60_000,
                                blockId: ctx.terminals[0].blockId,
                                transcriptPath: ctx.transcript,
                            },
                        ],
                        null,
                        2
                    )
                );
                ctx.wroteFixture = true;
                // the fixture roster is read once at boot
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");
                ctx.inRoster = await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${AGENT}"]')`, 20000);
                ctx.shown = ctx.inRoster && (await show(h));
                ctx.xterm = ctx.shown && (await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${AGENT}"] .xterm')`, 15000));
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail, extra = {}) => steps.push({ step, ok, detail, ...extra });
            if (ctx.arrangeError != null || !ctx.xterm) {
                rec("0. the fixture transcript, its agent and the agent's terminal are in place", false, ctx.arrangeError ?? JSON.stringify({ inRoster: ctx.inRoster, shown: ctx.shown, xterm: ctx.xterm }));
                return steps;
            }
            // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
            try {
                // 1. one row per running task under the agent; the expired and the ended Monitor are not listed
                const tree = await h.ev(`(async () => {
                    ${LIB}
                    const ids = ${JSON.stringify(LIVE_IDS)};
                    // three running tasks fold behind the agent row's "3 running" chip (tasksShown): open it
                    const chip = () => document.querySelector('[data-agent-row="${AGENT}"] button[aria-label="Show background tasks"]');
                    await until(() => chip() != null, 20000);
                    chip()?.click();
                    await until(() => ids.every((id) => row(id) != null), 20000);
                    await nap(400);
                    const agentRow = document.querySelector('[data-agent-row="${AGENT}"]');
                    const box = rowsBox();
                    const one = (id) => {
                        const r = row(id);
                        if (!r) return null;
                        const left = tid(r, "background-task-row-left");
                        return {
                            kind: r.getAttribute("data-task-kind"),
                            label: text(tid(r, "background-task-row-label")),
                            sub: text(tid(r, "background-task-row-sub")),
                            left: left ? { text: text(left), title: left.getAttribute("title") } : null,
                            title: r.getAttribute("title"),
                            mark: r.querySelector("svg[aria-label]")?.getAttribute("aria-label") ?? null,
                            role: r.getAttribute("role"),
                            expanded: r.getAttribute("aria-expanded"),
                        };
                    };
                    // what the pane step compares against after a peek opens
                    const p = pane();
                    window.__mtPane = { pane: p, xterm: p?.querySelector(".xterm") ?? null, focus: focusRow() };
                    return {
                        ids: rows().map((r) => r.getAttribute("data-task-id")),
                        all: [...document.querySelectorAll('[data-testid="background-task-row"]')].map((r) => r.getAttribute("data-task-id")),
                        beside: !!agentRow && !!box && !agentRow.contains(box) && !!(agentRow.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING),
                        rows: Object.fromEntries(ids.map((id) => [id, one(id)])),
                        peekOpen: peek() != null,
                    };
                })()`);
                await h.shot("cdp-shots/monitor-tasks-1.png");
                const r = tree.rows;
                const timeLeft = (x) => x?.left != null && /^(\d+m|<1m) left$/.test(x.left.text) && /^expires \d\d:\d\d:\d\d$/.test(x.left.title ?? "");
                rec(
                    "1. Tree: under the agent, in the order they started, rows for the shell command, the Monitor with events and the quiet Monitor (Terminal / Radio marks, their commands as titles, a time left on each Monitor); the expired and the ended Monitor are absent; no peek is open",
                    tree.beside &&
                        tree.ids.join(",") === LIVE_IDS.join(",") &&
                        GONE.every((m) => !tree.all.includes(m.id)) &&
                        r[SHELL.id]?.kind === "shell" &&
                        r[EVENTS.id]?.kind === "monitor" &&
                        r[QUIET.id]?.kind === "monitor" &&
                        r[SHELL.id].mark === "Shell task" &&
                        r[EVENTS.id].mark === "Monitor" &&
                        r[QUIET.id].mark === "Monitor" &&
                        r[SHELL.id].label === SHELL.description &&
                        r[EVENTS.id].label === EVENTS.description &&
                        r[QUIET.id].label === QUIET.description &&
                        r[SHELL.id].title === SHELL.command &&
                        r[EVENTS.id].title === EVENTS.command &&
                        r[QUIET.id].title === QUIET.command &&
                        r[SHELL.id].sub.startsWith("running ·") &&
                        r[EVENTS.id].sub.startsWith(`${EVENTS.events.length} events ·`) &&
                        r[QUIET.id].sub.startsWith("no events yet ·") &&
                        r[SHELL.id].left === null &&
                        timeLeft(r[EVENTS.id]) &&
                        timeLeft(r[QUIET.id]) &&
                        LIVE_IDS.every((id) => r[id].role === "button" && r[id].expanded === "false") &&
                        tree.peekOpen === false,
                    JSON.stringify(tree)
                );

                // 2. Events: the Monitor's header, command line, tabs, one row per event, and a footer with what it reported and when it expires
                const events = await openPeek(h, EVENTS.id, `p.getAttribute("data-task-kind") === "monitor" && p.querySelectorAll('[data-testid="background-task-peek-event"]').length > 0`);
                const rowState = await rowOpen(h, EVENTS.id);
                await h.shot("cdp-shots/monitor-tasks-2.png");
                const spoken = (e) => e.lines.every((l) => events?.eventRows.some((x) => x.body.includes(l)));
                rec(
                    "2. Events: pressing the Monitor's row opens a dialog beside it, watching, with the $ command line, a Monitor view tablist on Events 4, four timed events with their text, and a footer of 4 events · and expires in …m; the row reads pressed",
                    events != null &&
                        events.role === "dialog" &&
                        events.kind === "monitor" &&
                        events.state === "watching" &&
                        events.stateText === "watching" &&
                        events.title === EVENTS.description &&
                        events.command === `$ ${EVENTS.command}` &&
                        events.tablist === "Monitor view" &&
                        events.events?.role === "tab" &&
                        events.events.selected === "true" &&
                        events.events.text === `Events ${EVENTS.events.length}` &&
                        events.output?.selected === "false" &&
                        events.eventRows.length === EVENTS.events.length &&
                        events.eventRows.every((x) => /^\d\d:\d\d:\d\d$/.test(x.time)) &&
                        EVENTS.events.every(spoken) &&
                        events.footer[0]?.text.startsWith(`${EVENTS.events.length} events ·`) &&
                        /^expires in \d+m$/.test(events.footer[1]?.text ?? "") &&
                        /^expires \d\d:\d\d:\d\d$/.test(events.footer[1]?.title ?? "") &&
                        events.hasFocus === true &&
                        rowState === "true",
                    JSON.stringify({ events, rowState })
                );

                // 3. the peek is a popover: the agent's xterm is the node it was, the agent is still the selected one, and the pane is still showing
                const pane = await h.ev(`(() => {
                    ${LIB}
                    const was = window.__mtPane;
                    const p = pane();
                    return {
                        samePane: p != null && p === was?.pane,
                        sameXterm: was?.xterm != null && p?.querySelector(".xterm") === was.xterm && was.xterm.isConnected,
                        focusBefore: was?.focus ?? null,
                        focusAfter: focusRow(),
                        shown: p != null && !p.classList.contains("hidden") && p.checkVisibility(),
                    };
                })()`);
                await h.shot("cdp-shots/monitor-tasks-3.png");
                rec(
                    "3. Pane: with the peek open, the agent's terminal pane and its xterm are the same nodes as before, the agent is still the selected one and its pane is still showing",
                    pane.samePane && pane.sameXterm && pane.focusBefore === AGENT && pane.focusAfter === pane.focusBefore && pane.shown,
                    JSON.stringify(pane)
                );

                // 4. Output: the output file's tail, its stray grep warning included, followed live
                await selectTab(h, "output");
                const output = await readPeek(h, `(tid(p, "background-task-peek-output")?.textContent ?? "").includes("grep: warning: stray")`);
                await h.shot("cdp-shots/monitor-tasks-4.png");
                rec(
                    "4. Output: the Output tab is selected, its body holds the grep warning and every event line, and the footer names bmtevents.output and last 64 KB · live",
                    output != null &&
                        output.output?.selected === "true" &&
                        output.events?.selected === "false" &&
                        output.eventRows.length === 0 &&
                        output.outputBody.includes("grep: warning: stray") &&
                        EVENTS.events.every((e) => e.lines.every((l) => output.outputBody.includes(l))) &&
                        output.footer[0]?.text === `${EVENTS.id}.output` &&
                        output.footer[1]?.text === "last 64 KB · live",
                    JSON.stringify(output)
                );

                // 5. Escape closes the peek and only the peek: the row takes focus back, and the pane and the selected agent stay
                await key(h, "Escape", "Escape", 27);
                const esc = await h.ev(`(async () => {
                    ${LIB}
                    const gone = await until(() => peek() == null, 3000);
                    await nap(300);
                    const r = row(${JSON.stringify(EVENTS.id)});
                    const p = pane();
                    return {
                        gone,
                        expanded: r?.getAttribute("aria-expanded") ?? null,
                        rowFocused: r != null && document.activeElement === r,
                        samePane: p != null && p === window.__mtPane?.pane && p.querySelector(".xterm") === window.__mtPane?.xterm,
                        shown: p != null && !p.classList.contains("hidden") && p.checkVisibility(),
                        focus: focusRow(),
                        tree: !!document.querySelector("[data-agent-tree]"),
                    };
                })()`);
                await h.shot("cdp-shots/monitor-tasks-5.png");
                rec(
                    "5. Escape: pressing it in the peek closes it, the Monitor's row reads not pressed and holds focus, and the agent surface is as it was (the pane showing, the same agent selected)",
                    esc.gone && esc.expanded === "false" && esc.rowFocused && esc.samePane && esc.shown && esc.focus === AGENT && esc.tree,
                    JSON.stringify(esc)
                );

                // 6. a Monitor that has reported nothing and has no output file: both tabs say so
                const quiet = await openPeek(h, QUIET.id, `tid(p, "background-task-peek-events-empty") != null`);
                await h.shot("cdp-shots/monitor-tasks-6a.png");
                await selectTab(h, "output");
                const quietOut = await readPeek(h, `tid(p, "background-task-peek-output-empty") != null`);
                await h.shot("cdp-shots/monitor-tasks-6b.png");
                rec(
                    "6. Quiet Monitor: its Events tab reads Events 0 and No events yet. over a footer of watching since …; its Output tab reads No output yet. over no output file",
                    quiet != null &&
                        quiet.kind === "monitor" &&
                        quiet.state === "watching" &&
                        quiet.title === QUIET.description &&
                        quiet.events?.text === "Events 0" &&
                        quiet.events.selected === "true" &&
                        quiet.eventsEmpty === "No events yet." &&
                        quiet.eventRows.length === 0 &&
                        quiet.footer[0]?.text.startsWith("watching since ") &&
                        quietOut != null &&
                        quietOut.output?.selected === "true" &&
                        quietOut.outputEmpty === "No output yet." &&
                        quietOut.footer[0]?.text === "no output file",
                    JSON.stringify({ quiet, quietOut })
                );
                await h.ev(`(() => { ${LIB} tid(peek(), "background-task-peek-close")?.click(); })()`);
                const closedByButton = await closed(h);

                // 7. a background shell has no tabs: its output, followed live; pressing its row again closes the peek
                const shell = await openPeek(h, SHELL.id, `(tid(p, "background-task-peek-output")?.textContent ?? "").includes(${JSON.stringify(SHELL.output[0])})`);
                await h.shot("cdp-shots/monitor-tasks-7.png");
                // the peek opens at its default size whatever its output: the build line wraps at 560px. Then its right
                // edge and its corner are dragged, and a double click on an edge puts the default back
                const measure = () =>
                    h.ev(`(() => {
                    ${LIB}
                    const p = peek();
                    const body = p?.querySelector("[data-peek-body]");
                    const line = [...(tid(p, "background-task-peek-output")?.querySelectorAll("div > div") ?? [])].find((d) => text(d) === ${JSON.stringify(squash(WIDE_LINE))});
                    const lh = line ? parseFloat(getComputedStyle(line).lineHeight) : NaN;
                    return {
                        width: p ? Math.round(p.getBoundingClientRect().width) : null,
                        body: body ? Math.round(body.getBoundingClientRect().height) : null,
                        oneLine: line != null && line.getBoundingClientRect().height < lh * 1.5,
                        inView: p != null && p.getBoundingClientRect().right <= window.innerWidth,
                        stored: localStorage.getItem(${JSON.stringify(PEEK_SIZE_KEY)}),
                    };
                })()`);
                const gripAt = (axis) =>
                    h.ev(`(() => {
                    ${LIB}
                    const r = tid(peek(), "background-task-peek-resize-${axis}")?.getBoundingClientRect();
                    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
                })()`);
                // a move while the button is held says so (buttons: 1), or Chromium reads it as a hover and the drag is lost
                const mouse = (type, x, y, clickCount = 1, held = type === "mousePressed") =>
                    h.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: held ? 1 : 0, clickCount });
                const dragGrip = async (axis, dx, dy) => {
                    const at = await gripAt(axis);
                    if (at == null) return false;
                    await mouse("mouseMoved", at.x, at.y);
                    await mouse("mousePressed", at.x, at.y);
                    for (let i = 1; i <= 5; i++) await mouse("mouseMoved", at.x + (dx * i) / 5, at.y + (dy * i) / 5, 1, true);
                    await mouse("mouseReleased", at.x + dx, at.y + dy);
                    await polishNap(250);
                    return true;
                };
                const fitDefault = await measure();
                const draggedX = await dragGrip("x", 240, 0);
                const fitWide = await measure();
                const draggedXY = await dragGrip("xy", 0, 80);
                const fitTall = await measure();
                const at = await gripAt("x");
                if (at != null) {
                    await mouse("mouseMoved", at.x, at.y);
                    await mouse("mousePressed", at.x, at.y, 1);
                    await mouse("mouseReleased", at.x, at.y, 1);
                    await mouse("mousePressed", at.x, at.y, 2);
                    await mouse("mouseReleased", at.x, at.y, 2);
                    await polishNap(250);
                }
                const fitReset = await measure();
                await h.shot("cdp-shots/monitor-tasks-7b.png");
                rec(
                    "7b. Size: the shell's peek opens 560px wide with its build line wrapped; dragging its right edge 240px widens it to fit that line on one line and on screen, dragging its corner down makes its body taller, the size is stored, and a double click on the edge puts the default back",
                    fitDefault.width === 560 &&
                        !fitDefault.oneLine &&
                        draggedX &&
                        Math.abs(fitWide.width - 800) <= 2 &&
                        fitWide.oneLine &&
                        fitWide.inView &&
                        draggedXY &&
                        fitTall.body != null &&
                        fitWide.body != null &&
                        fitTall.body > fitWide.body &&
                        fitTall.stored != null &&
                        JSON.parse(fitTall.stored).width === fitTall.width &&
                        fitReset.width === 560 &&
                        JSON.parse(fitReset.stored ?? "{}").body === null,
                    JSON.stringify({ fitDefault, fitWide, fitTall, fitReset })
                );
                await h.ev(`(() => { ${LIB} row(${JSON.stringify(SHELL.id)})?.click(); })()`);
                const closedByRow = await closed(h);
                rec(
                    "7. Shell: the peek of the background command has no tablist, reads running with its $ command line and output, over a footer of bmtshell.output and last 64 KB · live; the Close button closes the Monitor's peek and pressing the open row again closes this one",
                    closedByButton &&
                        shell != null &&
                        shell.kind === "shell" &&
                        shell.state === "running" &&
                        shell.title === SHELL.description &&
                        shell.command === `$ ${SHELL.command}` &&
                        shell.tablist === null &&
                        shell.events === null &&
                        shell.output === null &&
                        SHELL.output.every((l) => shell.outputBody?.includes(squash(l))) &&
                        shell.footer[0]?.text === `${SHELL.id}.output` &&
                        shell.footer[1]?.text === "last 64 KB · live" &&
                        closedByRow,
                    JSON.stringify({ closedByButton, shell, closedByRow })
                );

                // 8. Stop: two presses, then the row leaves the tree and the peek closes. The fixture block runs no such process, so the
                // kill is answered here as killed and the call it sent is read back; claude then writes the TaskStop
                if (!STOP_DRAWS) {
                    rec("8. Stop: its two presses end the Monitor, its row leaves the tree and the peek closes", true, "the peek draws Stop where the kill exists (Windows); this run is not on it", { skip: true });
                } else {
                    await h.ev(`(() => {
                        const c = window.TabRpcClient;
                        const own = Object.prototype.hasOwnProperty.call(c, "wshRpcCall");
                        const orig = c.wshRpcCall;
                        const calls = [];
                        c.wshRpcCall = function (command, data, opts) {
                            if (command === "resmonkillshelltask") {
                                calls.push(data);
                                return Promise.resolve({ outcome: "killed", killed: 1 });
                            }
                            return orig.call(this, command, data, opts);
                        };
                        window.__mtKill = { calls, restore: () => (own ? (c.wshRpcCall = orig) : delete c.wshRpcCall) };
                    })()`);
                    const armed = await openPeek(h, QUIET.id, `tid(p, "background-task-peek-stop") != null`);
                    const stopButton = `tid(peek(), "background-task-peek-stop")?.querySelector("button")`;
                    const before = await h.ev(`(() => { ${LIB} const b = ${stopButton}; return b ? { label: b.getAttribute("aria-label"), text: text(b) } : null; })()`);
                    await h.ev(`(() => { ${LIB} ${stopButton}?.click(); })()`);
                    await polishNap(300);
                    const confirming = await h.ev(`(() => { ${LIB} const b = ${stopButton}; return b ? { label: b.getAttribute("aria-label"), text: text(b) } : null; })()`);
                    await h.shot("cdp-shots/monitor-tasks-8a.png");
                    await h.ev(`(() => { ${LIB} ${stopButton}?.click(); })()`);
                    appendFileSync(ctx.transcript, jsonl(taskStopRecords(QUIET, Date.now())));
                    const after = await h.ev(`(async () => {
                        ${LIB}
                        const gone = await until(() => row(${JSON.stringify(QUIET.id)}) == null && peek() == null, 5000);
                        await nap(300);
                        return { gone, ids: rows().map((r) => r.getAttribute("data-task-id")), peek: peek() != null, calls: window.__mtKill.calls };
                    })()`);
                    await h.shot("cdp-shots/monitor-tasks-8b.png");
                    const call = after.calls[0];
                    rec(
                        "8. Stop: the first press reads Confirm stop, the second ends the Monitor: its row leaves the tree, the peek closes, the kill named this agent's terminal block and the task, and the other two rows stay",
                        armed != null &&
                            armed.stop &&
                            before?.label === "Stop" &&
                            confirming?.label === "Confirm stop" &&
                            confirming.text === "Stop" &&
                            after.gone &&
                            after.peek === false &&
                            after.ids.join(",") === [SHELL.id, EVENTS.id].join(",") &&
                            after.calls.length === 1 &&
                            call.ownerid === ctx.terminals[0].blockId &&
                            call.taskid === QUIET.id &&
                            call.command === QUIET.command &&
                            call.startedts > 0,
                        JSON.stringify({ armed: armed && { stop: armed.stop, state: armed.state }, before, confirming, after })
                    );
                }
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
                    console.error(`monitor-tasks teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("put the page's rpc client back", () => h.ev(`(() => { window.__mtKill?.restore(); delete window.__mtKill; })()`));
            await step("put the peek's kept size back", () =>
                h.ev(`(() => {
                    const k = ${JSON.stringify(PEEK_SIZE_KEY)}, v = ${JSON.stringify(ctx.prevPeekSize ?? null)};
                    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
                })()`)
            );
            for (const t of ctx.terminals ?? []) {
                await step("close the terminal", () => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false]));
            }
            if (ctx.wroteFixture) {
                await step("restore the fixture roster", () =>
                    ctx.prevFixture != null ? writeFileSync(TREE_RAIL_FIXTURE, ctx.prevFixture) : rmSync(TREE_RAIL_FIXTURE, { force: true })
                );
            }
            await step("reload onto the restored roster", () => ahReload(h));
            await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
        },
    };
    return [scenario];
}
