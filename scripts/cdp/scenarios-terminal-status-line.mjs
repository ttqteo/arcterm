// terminal-status-line: the second line a plain terminal's row in the Agent tree draws under its name, saying what the
// terminal's shell runs (ported from the fork's commit 82bd4a83f, onto our rows: frontend/app/view/agents/agenttree.tsx
// TerminalRow, terminalstatus.ts). A dot, the foreground command with its run time or "idle", and a chip with the TCP
// port the command's processes listen on.
// Two real terminals made as the rail scenarios make them (CreateTab, a shell controller): one is given a node one-liner
// that listens on a port, the other stays at its prompt. The command and port are read by the Resource Manager's sampler,
// which exists on Windows only; steps 1 and 2 are skipped on another host. Steps 3 and 4 pin a snapshot the way the Consumers
// scenarios do (window.__resmonFixture), so they run anywhere. kit is scenarios.mjs's RT_KIT.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NAME = "terminal-status-line";
const PROJECT = "verify-terminal-status-line";
const BUSY_LABEL = "tsl busy";
const IDLE_LABEL = "tsl idle";
const SAMPLES = process.platform === "win32";
const ROW_WAIT_MS = 20_000;
const SHELL_WAIT_MS = 30_000;
const COMMAND_WAIT_MS = 30_000;

// a TCP port nothing listens on right now: the OS hands one out, and it is let go before the terminal's server takes it
function freePort() {
    return new Promise((resolve, reject) => {
        const s = createServer();
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

// A terminal's escape sequences (OSC and DCS strings, CSI, the two-byte forms) and every other control character. The
// pattern has to name ESC and the controls: no-control-regex guards against one typed by accident, which this is not
// (the same pattern is uploadsPlainText's in scenarios.mjs).
const TERMINAL_ESCAPES = /\x1b[\]P_^X][^\x1b\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]|[\x00-\x1f\x7f]/g; // eslint-disable-line no-control-regex

// what the shell has printed, kept by wavesrv in the block's "term" file, without its escape sequences and blanks
const plainText = (raw) => raw.replace(TERMINAL_ESCAPES, "").replace(/\s+/g, "");

// runs IN THE PAGE: what a terminal's tree row draws
const rowOf = (tabId) => `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const row = document.querySelector('[data-tree-terminal-row="${tabId}"]');
    if (!row) return { row: false };
    const line = row.querySelector("[data-terminal-status]");
    const dot = line?.querySelector("span[aria-hidden]");
    const chip = line?.querySelector("[data-terminal-ports]");
    return {
        row: true,
        text: flat(row),
        // the first line holds the name; the status line is under it, not beside it
        name: flat(row.querySelector("span[title]")),
        status: line?.getAttribute("data-terminal-status") ?? null,
        line: line ? flat(line) : null,
        command: line?.querySelector("[data-terminal-command]") ? flat(line.querySelector("[data-terminal-command]")) : null,
        commandTitle: line?.querySelector("[data-terminal-command]")?.getAttribute("title") ?? null,
        age: line?.querySelector("[data-terminal-age]") ? flat(line.querySelector("[data-terminal-age]")) : null,
        chip: chip ? flat(chip) : null,
        chipTitle: chip?.getAttribute("title") ?? null,
        dotFilled: dot ? getComputedStyle(dot).backgroundColor !== "rgba(0, 0, 0, 0)" : null,
        below: line != null && line.getBoundingClientRect().top >= (row.querySelector("span[title]")?.getBoundingClientRect().bottom ?? 0) - 1,
        pulse: !!row.querySelector('[aria-label="running a command"]'),
        height: Math.round(row.getBoundingClientRect().height),
    };
})()`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, openRailTerminal } = kit;

    // the row's second line has `status` ("running" / "idle"), and for "running" the chip too when `port` is given
    const lineUp = (h, tabId, status, port) =>
        polishWaitFor(
            h,
            `(() => {
                const line = document.querySelector('[data-tree-terminal-row="${tabId}"] [data-terminal-status="${status}"]');
                return line != null && (${port == null} || (line.querySelector("[data-terminal-ports]")?.textContent ?? "").trim() === ":${port}");
            })()`,
            COMMAND_WAIT_MS
        );

    // The shell has printed its prompt. The sampler sees the shell's process before that, but a command typed while it is
    // still starting can be missed, so the command goes in only once there is a prompt.
    async function shellPrinted(h, blockId) {
        const [endpoint, key] = await h.ev(`[window.api.getEnv("WAVE_SERVER_WEB_ENDPOINT"), window.api.getAuthKey()]`);
        for (let waited = 0; waited < SHELL_WAIT_MS; waited += 500) {
            try {
                const res = await fetch(`http://${endpoint}/wave/file?zoneid=${blockId}&name=term`, { headers: { "x-authkey": key } });
                if (res.status === 200 && plainText(Buffer.from(await res.arrayBuffer()).toString("utf8")) !== "") return true;
            } catch {
                /* wavesrv is not answering yet */
            }
            await polishNap(500);
        }
        return false;
    }

    // pins a snapshot the page's poll leaves alone (resmonstore.ts, dev builds): one shell group for the block
    const pinSnapshot = (h, groups) =>
        h.ev(
            `window.__resmonFixture?.set(${JSON.stringify({
                supported: true,
                ready: true,
                ts: Date.now(),
                cpu: 0,
                mem: 0,
                totalmem: 0,
                busycpu: false,
                busymem: false,
                groups,
            })})`
        );

    // a terminal's group the way the sampler reports it: the shell, and a job under it
    const shellGroup = (blockId, job) => ({
        key: `fx-tsl-${blockId}`,
        ownerkind: "agenttab",
        ownerid: blockId,
        label: BUSY_LABEL,
        killable: true,
        cpu: 0,
        mem: 0,
        rows: [
            { pid: 9001, name: "pwsh.exe", depth: 0, tag: "shell", mem: 0, mempct: 0, cpu: 0, numthreads: 1 },
            ...(job == null
                ? []
                : [
                      {
                          pid: 9002,
                          name: "node.exe",
                          command: job.command,
                          createts: job.createts,
                          depth: 1,
                          mem: 0,
                          mempct: 0,
                          cpu: 0,
                          numthreads: 1,
                          ports: job.ports,
                      },
                  ]),
        ],
    });

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { terminals: [], cwd: mkdtempSync(join(tmpdir(), "verify-terminal-status-line-")) };
                // a throw past this point still returns ctx, so teardown closes whatever was already made
                try {
                    ctx.port = await freePort();
                    await h.goto("agent");
                    const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                    const wslist = await h.rpc("workspacelist", null);
                    const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
                    ctx.workspaceId = ws.workspacedata.oid;
                    for (const label of [BUSY_LABEL, IDLE_LABEL]) {
                        await openRailTerminal(h, ctx, PROJECT);
                        const t = ctx.terminals.at(-1);
                        // the tab's label is what the row names it by
                        await h.rpc("setmeta", { oref: `tab:${t.tabId}`, meta: { "session:label": label } });
                        await h.rpc("setmeta", { oref: `block:${t.blockId}`, meta: { "cmd:cwd": ctx.cwd } });
                        await h.rpc("controllerresync", { tabid: t.tabId, blockid: t.blockId, forcerestart: true });
                    }
                    [ctx.busy, ctx.idle] = ctx.terminals;
                    ctx.rowsUp = await polishWaitFor(
                        h,
                        `${JSON.stringify(ctx.terminals.map((t) => t.tabId))}.every((id) => !!document.querySelector('[data-tree-terminal-row="' + id + '"]'))`,
                        ROW_WAIT_MS
                    );
                    // the pointer off the tree, so no hover tooltip is in a shot
                    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 600 });
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail, extra = {}) => steps.push({ step, ok, detail, ...extra });
                if (ctx.arrangeError != null || !ctx.rowsUp) {
                    rec("0. the two terminals are in the tree", false, ctx.arrangeError ?? JSON.stringify({ rowsUp: ctx.rowsUp }));
                    return steps;
                }
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    if (!SAMPLES) {
                        const why = "the Resource Manager samples a terminal's processes on Windows only; this run is not on it";
                        rec("1. a terminal running a node server: its row's second line has a dot, the command, its run time and the port chip", true, why, { skip: true });
                        rec("2. a terminal at its prompt: its row's second line reads idle, with no chip", true, why, { skip: true });
                    } else {
                        // 1. the busy terminal runs a node one-liner that listens on a port
                        const shellUp = (await lineUp(h, ctx.busy.tabId, "idle")) && (await shellPrinted(h, ctx.busy.blockId));
                        await h.rpc("controllerinput", {
                            blockid: ctx.busy.blockId,
                            inputdata64: Buffer.from(`node -e "require('net').createServer().listen(${ctx.port})"\r`).toString("base64"),
                        });
                        const running = shellUp && (await lineUp(h, ctx.busy.tabId, "running", ctx.port));
                        // the run time is read off the sampler's clock: let it show a few seconds
                        await polishNap(2500);
                        const busy = await h.ev(rowOf(ctx.busy.tabId));
                        // what the sampler reported for the terminal, so a row that reads wrong can be traced to its rows
                        const sampled = await h
                            .rpc("resmonsnapshot", {})
                            .then((s) =>
                                (s?.groups ?? [])
                                    .filter((g) => g.ownerid === ctx.busy.blockId)
                                    .map((g) => g.rows.map((r) => ({ pid: r.pid, ppid: r.ppid, name: r.name, depth: r.depth, tag: r.tag, ports: r.ports, command: (r.command ?? "").slice(0, 80) })))
                            )
                            .catch((e) => String(e?.message ?? e));
                        await h.shot("cdp-shots/terminal-status-line-1-running.png");
                        rec(
                            "1. a terminal running a node server: under its name the row's second line has a filled dot, `node -e …` and a run time, and a chip reading the port it listens on, with every port in its title",
                            shellUp &&
                                running &&
                                busy.row &&
                                busy.name === BUSY_LABEL &&
                                busy.status === "running" &&
                                busy.below &&
                                busy.dotFilled === true &&
                                (busy.command ?? "").startsWith("node -e") &&
                                busy.command.includes(String(ctx.port)) &&
                                busy.commandTitle === busy.command &&
                                /^\d+[smhd]$/.test(busy.age ?? "") &&
                                busy.chip === `:${ctx.port}` &&
                                busy.chipTitle === `Listening on :${ctx.port}` &&
                                busy.pulse === false,
                            JSON.stringify({ shellUp, running, busy, sampled })
                        );

                        // 2. the other terminal sits at its prompt
                        const idle = await h.ev(rowOf(ctx.idle.tabId));
                        await h.shot("cdp-shots/terminal-status-line-2-idle.png");
                        rec(
                            "2. a terminal at its prompt: its row's second line reads idle on a hollow dot, with no run time and no chip",
                            idle.row &&
                                idle.name === IDLE_LABEL &&
                                idle.status === "idle" &&
                                idle.below &&
                                idle.line === "idle" &&
                                idle.dotFilled === false &&
                                idle.age == null &&
                                idle.chip == null &&
                                idle.pulse === false,
                            JSON.stringify(idle)
                        );
                    }

                    // 3. a sample that cannot say what a terminal runs draws no second line: a host that samples nothing (the
                    // snapshot of a Mac), then a group with no shell row
                    await pinSnapshot(h, []);
                    await polishWaitFor(h, `!document.querySelector('[data-tree-terminal-row] [data-terminal-status]')`, 5000);
                    const noGroup = await h.ev(`[${rowOf(ctx.busy.tabId)}, ${rowOf(ctx.idle.tabId)}]`);
                    const noShell = shellGroup(ctx.busy.blockId, null);
                    noShell.rows = [];
                    await pinSnapshot(h, [noShell]);
                    await polishNap(400);
                    const noRows = await h.ev(rowOf(ctx.busy.tabId));
                    await h.shot("cdp-shots/terminal-status-line-3-none.png");
                    rec(
                        "3. no second line when the sample cannot say what the terminal runs: with no group, or a group holding no shell row, both rows are the single line they were",
                        noGroup.every((r) => r.row && r.status == null && r.line == null && r.chip == null) &&
                            noRows.row &&
                            noRows.status == null &&
                            noRows.line == null,
                        JSON.stringify({ noGroup, noRows })
                    );

                    // 4. a command listening on several ports: the chip names the lowest and counts the rest
                    await pinSnapshot(h, [
                        shellGroup(ctx.busy.blockId, {
                            command: '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\app\\node_modules\\vite\\bin\\vite.js --host',
                            createts: Date.now() - 38 * 60_000,
                            ports: [5173, 24678],
                        }),
                        shellGroup(ctx.idle.blockId, null),
                    ]);
                    const several = await lineUp(h, ctx.busy.tabId, "running", "5173 +1");
                    const many = await h.ev(rowOf(ctx.busy.tabId));
                    await h.shot("cdp-shots/terminal-status-line-4-ports.png");
                    rec(
                        "4. a command listening on two ports: the second line reads `vite --host` and 38m, the chip reads :5173 +1 and its title lists both ports",
                        several &&
                            many.status === "running" &&
                            many.command === "vite --host" &&
                            many.age === "38m" &&
                            many.chip === ":5173 +1" &&
                            many.chipTitle === "Listening on :5173, :24678" &&
                            many.below &&
                            // the second line is what makes the row taller than the single line step 3 saw
                            many.height > noGroup[0].height,
                        JSON.stringify({ many, singleLine: noGroup[0].height })
                    );
                } catch (e) {
                    rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
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
                await step("let the page's poll back in", () => h.ev(`window.__resmonFixture?.clear()`));
                // the terminal's server ends with its tab: the shell's job holds it
                for (const t of ctx.terminals ?? []) {
                    await step(`close the terminal tab ${t.tabId}`, () =>
                        waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false])
                    );
                }
                await step("go home", () => h.goto("cockpit"));
                // the shell that held the folder is gone with its tab, but Windows lets go a moment later
                await step("remove the temp dir", () =>
                    rmSync(ctx.cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
                );
            },
        },
    ];
}
