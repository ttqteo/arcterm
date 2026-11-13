// chat-bg-tasks: the chat box's background line (docs/superpowers/specs/2026-11-13-chat-background-tasks-design.md,
// frontend/app/view/agents/chatbgline.tsx). One fixture Claude agent over a real tab, whose transcript (a temp file) holds
// a running run_in_background Bash call, a running Monitor, a background subagent with its own file and a foreground
// subagent the turn still waits on. The box's line names the newest (the shell) "and 2 more"; a press opens the list of
// three (the foreground subagent is not background work); a shell row opens the task peek above the row, which the Agent
// tree does not draw a second time; the header folds it again. Nothing runs and nothing is written into ~/.claude/projects.
// kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor, polishNap).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat-bg-tasks";
const AGENT_NAME = "bg line parent";
const SESSION = "parent";
const SHELL = { id: "bchatbg01", command: "task tauri:build", agoMs: 30_000 };
const MONITOR = { id: "mchatbg01", description: "Wait for CI on fd41aca53", agoMs: 4 * 60_000 };
const BG_SUB = { spawnId: "toolu_chatbg_explore", childId: "cbexplore", type: "Explore", prompt: "find the composer footer", agoMs: 2 * 60_000 };
const FG_SUB = { spawnId: "toolu_chatbg_review", childId: "cbreview", type: "code-reviewer", prompt: "review the diff", agoMs: 60_000 };
const WAIT_MS = 15_000;

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const SEEN = `((el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })`;

// what the box shows of its background line, read in one call
const seen = (id) => `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const layer = ${layerOf(id)};
    const box = layer?.querySelector("[data-chat-box]");
    const bg = box?.querySelector("[data-chat-bg]");
    const rows = [...(box?.querySelectorAll("[data-chat-bg-row]") ?? [])];
    return {
        box: box != null,
        state: bg?.getAttribute("data-chat-bg") ?? null,
        shown: ${SEEN}(bg),
        count: Number(bg?.getAttribute("data-chat-bg-count") ?? 0),
        text: flat(bg),
        name: flat(bg?.querySelector("[data-chat-bg-name]")),
        nameMono: (bg?.querySelector("[data-chat-bg-name]")?.className ?? "").includes("font-mono"),
        more: flat(bg?.querySelector("[data-chat-bg-more]")),
        rows: rows.map((r) => ({ kind: r.getAttribute("data-chat-bg-row"), name: flat(r.querySelector("[data-chat-bg-row-name]")), stop: r.querySelector("[data-chat-bg-stop]") != null })),
        peeks: document.querySelectorAll('[data-testid="background-task-peek"]').length,
        win: /Win/i.test(navigator.platform),
    };
})()`;

function writeFixture(dir) {
    const at = (agoMs) => ({ cwd: dir, ts: new Date(Date.now() - agoMs).toISOString() });
    const parentPath = AC.writeTranscript(dir, SESSION, [
        AC.userText("Build the release and check CI.", at(5 * 60_000)),
        AC.toolUse("toolu_chatbg_mon", "Monitor", { description: MONITOR.description, timeout_ms: 30 * 60_000, command: "gh run watch" }, at(MONITOR.agoMs)),
        AC.toolResult(
            "toolu_chatbg_mon",
            `Monitor started (task ${MONITOR.id}, expires in 30m unless the source ends first; events arrive as notifications.)`,
            { toolUseResult: { taskId: MONITOR.id, timeoutMs: 30 * 60_000, persistent: false }, ...at(MONITOR.agoMs) }
        ),
        AC.toolUse(BG_SUB.spawnId, "Agent", { subagent_type: BG_SUB.type, description: "find the footer", prompt: BG_SUB.prompt, run_in_background: true }, at(BG_SUB.agoMs)),
        AC.toolResult(BG_SUB.spawnId, "Async agent launched successfully", {
            toolUseResult: { isAsync: true, status: "async_launched", agentId: BG_SUB.childId },
            ...at(BG_SUB.agoMs),
        }),
        AC.toolUse("toolu_chatbg_sh", "Bash", { command: SHELL.command, run_in_background: true }, at(SHELL.agoMs)),
        AC.toolResult("toolu_chatbg_sh", `Command running in background with ID: ${SHELL.id}.`, {
            toolUseResult: { backgroundTaskId: SHELL.id },
            ...at(SHELL.agoMs),
        }),
        // a foreground subagent the turn waits on: no result yet, so it is working, but it is not background work
        AC.toolUse(FG_SUB.spawnId, "Agent", { subagent_type: FG_SUB.type, description: "review", prompt: FG_SUB.prompt }, at(FG_SUB.agoMs)),
    ]);
    // each child's last record is a tool result that is not a handback's, so it reads as still working
    for (const s of [BG_SUB, FG_SUB]) {
        AC.writeSubagent(dir, SESSION, s.childId, [
            AC.userText(s.prompt, at(s.agoMs)),
            AC.toolUse(`toolu_${s.childId}_read`, "Read", { file_path: join(dir, "a.ts") }, at(s.agoMs)),
            AC.toolResult(`toolu_${s.childId}_read`, "export const a = 1;", at(s.agoMs)),
        ]);
    }
    return parentPath;
}

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures(kit);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-bg-")) };
                try {
                    ctx.path = writeFixture(ctx.dir);
                    await h.goto("agent");
                    const { tabId, blockId } = await makeTab(h, ctx, { label: AGENT_NAME });
                    ctx.id = tabId;
                    await AC.setRoster(h, [
                        {
                            id: tabId,
                            name: AGENT_NAME,
                            project: "fx-chat-bg",
                            task: "",
                            state: "working",
                            activity: "Building",
                            agent: "claude",
                            model: "opus",
                            activeMs: 60_000,
                            blockId,
                            transcriptPath: ctx.path,
                        },
                    ]);
                    // Chat, not the terminal, in the agent's centre
                    await AC.agentPage(h, `const M = await mod("app/view/agents/chatmodestore.ts"); M.setChatMode(${JSON.stringify(tabId)}, "chat"); return true;`);
                    await AC.focusAgent(h, tabId);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec(`${NAME}: arrange`, false, ctx.arrangeError);
                    return steps;
                }
                const id = ctx.id;
                const until = (cond) => polishWaitFor(h, `((s) => ${cond})(${seen(id)})`, WAIT_MS);
                const run = async (name, fn) => {
                    try {
                        await fn(name);
                    } catch (e) {
                        rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                    }
                };

                await run("1. collapsed line", async (name) => {
                    await until(`s.state === "closed" && s.count === 3`);
                    await polishNap(400);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-bg-tasks-1-collapsed.png");
                    rec(
                        `${name}: the box's line names the newest running task (the shell command, in mono) and "and 2 more"; the foreground subagent is not counted`,
                        s.shown && s.state === "closed" && s.count === 3 && s.name === SHELL.command && s.nameMono && s.more.endsWith("and 2 more") && s.text.includes("running"),
                        s
                    );
                });

                await run("2. open list", async (name) => {
                    await h.ev(`${layerOf(id)}?.querySelector('[data-chat-bg="closed"]')?.click()`);
                    await until(`s.state === "open" && s.rows.length === 3`);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-bg-tasks-2-open.png");
                    const kinds = s.rows.map((r) => r.kind).join(",");
                    const stops = s.rows.filter((r) => r.kind !== "subagent").every((r) => r.stop) && !s.rows.find((r) => r.kind === "subagent")?.stop;
                    rec(
                        `${name}: the line unfolds into "3 running in the background" and a row each, newest first (shell, subagent, Monitor), with Stop on the shell and the Monitor (Windows, live session)`,
                        s.state === "open" && s.text.startsWith("3 running in the background") && kinds === "shell,subagent,monitor" &&
                            s.rows[1].name === BG_SUB.type && s.rows[2].name === MONITOR.description && (stops || !s.win),
                        s
                    );
                });

                await run("3. peek above the row", async (name) => {
                    await h.ev(`${layerOf(id)}?.querySelector('[data-chat-bg-row="shell"] button')?.click()`);
                    const opened = await polishWaitFor(h, `document.querySelector('[data-testid="background-task-peek"]') != null`, WAIT_MS);
                    await polishNap(400);
                    const got = await h.ev(`(() => {
                        const row = ${layerOf(id)}?.querySelector('[data-chat-bg-row="shell"]');
                        const peeks = [...document.querySelectorAll('[data-testid="background-task-peek"]')];
                        const p = peeks[0]?.getBoundingClientRect();
                        const r = row?.getBoundingClientRect();
                        return {
                            peeks: peeks.length,
                            title: (peeks[0]?.querySelector('[data-testid="background-task-peek-title"]')?.textContent ?? "").trim(),
                            above: p != null && r != null && p.bottom <= r.top + 1,
                            pressed: row?.querySelector("button")?.getAttribute("aria-expanded") === "true",
                        };
                    })()`);
                    await h.shot("cdp-shots/chat-bg-tasks-3-peek.png");
                    rec(
                        `${name}: a press on the shell row opens one task peek, for that task, above the row (the Agent tree draws no second one)`,
                        opened && got.peeks === 1 && got.title === SHELL.command && got.above && got.pressed,
                        got
                    );
                    await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                    await polishWaitFor(h, `document.querySelector('[data-testid="background-task-peek"]') == null`, WAIT_MS);
                });

                await run("4. fold", async (name) => {
                    await h.ev(`${layerOf(id)}?.querySelector("[data-chat-bg-fold]")?.click()`);
                    const folded = await until(`s.state === "closed"`);
                    const s = await h.ev(seen(id));
                    rec(`${name}: the header's chevron folds the list back into the one line, with no peek left open`, folded && s.state === "closed" && s.peeks === 0, s);
                });
                return steps;
            },
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                await step("close the peek", () =>
                    AC.agentPage(h, `const S = await mod("app/view/agents/subagentsstore.ts"); globalStore.set(S.monitorPeekAtom, null); return true;`)
                );
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("drop the focus", () => AC.agentPage(h, `globalStore.set(agentsModel().focusIdAtom, undefined); return true;`));
                await step("close the fixture tab", () => closeTabs(h, ctx));
                await step("remove the fixture transcripts", () => rmSync(ctx.dir, { recursive: true, force: true }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
