// chat-steps: Chat's step checklist (docs/superpowers/specs/2026-11-13-chat-task-checklist-design.md,
// frontend/app/view/agents/chatsteplist.ts / chatsteplistview.tsx). One fixture Claude agent over a real tab, whose
// transcript (a temp file) holds two turns. The first, finished turn wrote three ```arc-steps blocks across three replies
// and a compaction: one list, at the first block, showing the last (all ticked), and the later blocks draw nothing. The
// second turn, under way, wrote one block with a step in progress: its list pulses that step while the agent works,
// keeps the green ring still while it asks, and draws it as not started once the agent is idle. The agent card's
// done/total list (tasksByIdAtom) reads the latest block. Nothing runs and nothing is written into ~/.claude/projects.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap, waveService).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat-steps";
const AGENT_NAME = "steps checklist";
const SESSION = "chat-steps";
const WAIT_MS = 15_000;

const FIRST = ["Look at the disk use and the sessions", "Find the orphan sessions", "Propose a cleanup"];
const SECOND = ["Back up the sessions", "Delete the orphans", "Import the rest again"];

const block = (...lines) => ["```arc-steps", ...lines, "```"].join("\n");

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;

// what the agent's Chat shows of its step lists, read in one call: each list's phase, rows, where it sits, and the
// arc-steps code blocks left (none should be)
const seen = (id) => `(() => {
    const layer = ${layerOf(id)};
    const proses = [...(layer?.querySelectorAll("[data-chat-prose]") ?? [])];
    const lists = [...(layer?.querySelectorAll("[data-chat-steps]") ?? [])];
    return {
        lists: lists.map((l) => ({
            phase: l.getAttribute("data-chat-steps"),
            prose: proses.findIndex((p) => p.contains(l)),
            rows: [...l.querySelectorAll("[data-chat-step]")].map((r) => ({
                state: r.getAttribute("data-chat-step"),
                text: r.textContent.trim(),
                label: r.querySelector('[role="img"]')?.getAttribute("aria-label") ?? null,
                pulse: r.querySelector(".pulse-soft") != null,
            })),
        })),
        proses: proses.length,
        stepCode: [...(layer?.querySelectorAll("[data-code-head]") ?? [])].filter((c) => c.textContent.includes("arc-steps")).length,
    };
})()`;

function writeFixture(dir) {
    const at = (agoMs) => ({ cwd: dir, ts: new Date(Date.now() - agoMs).toISOString() });
    return AC.writeTranscript(dir, SESSION, [
        AC.userText("Can we clear out the orphan sessions?", at(20 * 60_000)),
        AC.assistantText(`I'll check the disk use first.\n\n${block(`[>] ${FIRST[0]}`, `[ ] ${FIRST[1]}`, `[ ] ${FIRST[2]}`)}`, at(19 * 60_000)),
        AC.toolUse("toolu_steps_du", "Bash", { command: "du -sh ~/.claude/projects" }, at(18 * 60_000)),
        AC.toolResult("toolu_steps_du", "1.9G\t/home/me/.claude/projects", at(18 * 60_000)),
        AC.assistantText(`1.9 GB in all. Now the orphans.\n\n${block(`[x] ${FIRST[0]}`, `[>] ${FIRST[1]}`, `[ ] ${FIRST[2]}`)}`, at(17 * 60_000)),
        AC.assistantText(
            `${block(`[x] ${FIRST[0]}`, `[x] ${FIRST[1]}`, `[x] ${FIRST[2]}`)}\n\n312 sessions have no project folder left, 1.4 GB. I'd delete them and keep the 40 of open projects.`,
            at(16 * 60_000)
        ),
        AC.userText("Yes, go ahead.", at(10 * 60_000)),
        AC.assistantText(`On it.\n\n${block(`[x] ${SECOND[0]}`, `[>] ${SECOND[1]}`, `[ ] ${SECOND[2]}`)}`, at(9 * 60_000)),
        AC.toolUse("toolu_steps_rm", "Bash", { command: "node clean-orphans.mjs" }, at(8 * 60_000)),
    ]);
}

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures(kit);

    const roster = (ctx, state) => [
        {
            id: ctx.id,
            name: AGENT_NAME,
            project: "fx-chat-steps",
            task: "",
            state,
            ...(state === "working" ? { activity: "Deleting", activeMs: 60_000 } : {}),
            ...(state === "idle" ? { idleSince: Date.now() - 30_000 } : {}),
            ...(state === "asking" ? { blockedMs: 20_000 } : {}),
            agent: "claude",
            model: "opus",
            blockId: ctx.blockId,
            transcriptPath: ctx.path,
        },
    ];

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-steps-")) };
                try {
                    ctx.path = writeFixture(ctx.dir);
                    await h.goto("agent");
                    const { tabId, blockId } = await makeTab(h, ctx, { label: AGENT_NAME });
                    ctx.id = tabId;
                    ctx.blockId = blockId;
                    await AC.setRoster(h, roster(ctx, "working"));
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
                const states = (list) => (list?.rows ?? []).map((r) => r.state).join(",");
                const texts = (list) => (list?.rows ?? []).map((r) => r.text);
                const scrollTo = (n) =>
                    h.ev(`(() => { const l = ${layerOf(id)}?.querySelectorAll("[data-chat-steps]")[${n}]; l?.scrollIntoView({ block: "center" }); return !!l; })()`);

                await run("1. finished turn", async (name) => {
                    await until(`s.lists.length === 2`);
                    await scrollTo(0);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-steps-1-finished-turn.png");
                    const first = s.lists[0];
                    rec(
                        `${name}: the first turn draws one list, in its first reply (where it first wrote a block), showing its last block: the three steps ticked in muted, each labelled Done; the two later blocks draw nothing and no arc-steps block is left as code`,
                        s.lists.length === 2 && first.prose === 0 && first.phase === "over" &&
                            states(first) === "done,done,done" && JSON.stringify(texts(first)) === JSON.stringify(FIRST) &&
                            first.rows.every((r) => r.label === "Done") && s.stepCode === 0,
                        s
                    );
                });

                await run("2. step in progress", async (name) => {
                    await scrollTo(1);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-steps-2-in-progress.png");
                    const second = s.lists[1];
                    rec(
                        `${name}: the turn under way draws its own list in its reply: a ticked step, the step in progress with the pulsing green ring (In progress), and one not started in a dashed ring (Not started)`,
                        second != null && second.phase === "live" && states(second) === "done,working,pending" &&
                            JSON.stringify(texts(second)) === JSON.stringify(SECOND) &&
                            second.rows[1].pulse && !second.rows[0].pulse && !second.rows[2].pulse &&
                            JSON.stringify(second.rows.map((r) => r.label)) === JSON.stringify(["Done", "In progress", "Not started"]),
                        s
                    );
                });

                await run("3. card chip", async (name) => {
                    let tasks = null;
                    for (let i = 0; i < 30 && tasks == null; i++) {
                        tasks = await AC.agentPage(h, `const L = await mod("app/view/agents/livetranscriptatoms.ts"); return globalStore.get(L.tasksByIdAtom)[${JSON.stringify(id)}] ?? null;`);
                        if (tasks == null) await polishNap(500);
                    }
                    rec(
                        `${name}: the agent card's task list (its done/total chip) reads the latest block: 1 of 3 done`,
                        Array.isArray(tasks) && tasks.length === 3 && tasks.filter((t) => t.done).length === 1 && tasks[0].text === SECOND[0],
                        { tasks }
                    );
                });

                await run("4. agent asks", async (name) => {
                    await AC.setRoster(h, roster(ctx, "asking"));
                    const ok = await until(`s.lists[1]?.phase === "waiting"`);
                    await scrollTo(1);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-steps-4-asking.png");
                    const second = s.lists[1];
                    rec(
                        `${name}: while the agent waits on you, the step in progress keeps its green ring but stops pulsing`,
                        ok && states(second) === "done,working,pending" && !second.rows[1].pulse,
                        s
                    );
                });

                await run("5. agent idle", async (name) => {
                    await AC.setRoster(h, roster(ctx, "idle"));
                    const ok = await until(`s.lists[1]?.phase === "over"`);
                    await scrollTo(1);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-steps-5-idle.png");
                    const second = s.lists[1];
                    rec(
                        `${name}: once the agent is idle, the step it left in progress draws as not started (dashed ring, Not started)`,
                        ok && states(second) === "done,pending,pending" && second.rows[1].label === "Not started" && !second.rows[1].pulse,
                        s
                    );
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
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("drop the focus", () => AC.agentPage(h, `globalStore.set(agentsModel().focusIdAtom, undefined); return true;`));
                await step("close the fixture tab", () => closeTabs(h, ctx));
                await step("remove the fixture transcript", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
