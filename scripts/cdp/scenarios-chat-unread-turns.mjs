// chat-unread-turns: unread turns read one by one in Chat (docs/superpowers/specs/2026-11-26-unread-read-progress-design.md,
// frontend/app/view/agents/unreadturns.ts, chatunread.ts). One fixture Claude agent over a real tab, whose transcript (a
// temp file) holds six turns with replies taller than the view. With 3 unread, opening it in Chat lands on the fourth
// turn under a "3 new turns" rule; scrolling the fourth's last line into view drops the count to 2, scrolling to the end
// to 0, the rule keeping its 3. Opened again with nothing unread there is no rule. In Terminal the count clears at once.
// The count is set on the page's unread atom while the agent is off screen. Nothing runs and nothing is written into
// ~/.claude/projects.
// kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor, polishNap).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat-unread-turns";
const AGENT_NAME = "unread turns";
const SESSION = "unread";
const TURNS = 6;
const UNREAD = 3;
const PARAGRAPHS = 40; // per reply: taller than the view, so a turn's end needs a scroll
const WAIT_MS = 15_000;

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;

// what Chat and the count show, read in one call
const seen = (id) => `(async () => {
    ${AC.PAGE_LIB}
    const U = await mod("app/view/agents/unreadagentsstore.ts");
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const layer = ${layerOf(id)};
    const scroller = layer?.querySelector("[data-chat-scroller]");
    const rule = layer?.querySelector("[data-chat-unread-rule]");
    const after = rule?.nextElementSibling;
    const s = scroller?.getBoundingClientRect();
    const row = document.querySelector('[data-agent-row="${id}"] [data-agent-unread]');
    return {
        count: globalStore.get(U.unreadAgentsAtom).get(${JSON.stringify(id)}) ?? 0,
        row: row != null ? Number(row.getAttribute("data-agent-unread")) : 0,
        items: layer?.querySelectorAll("[data-chat-item]").length ?? 0,
        rule: rule != null ? Number(rule.getAttribute("data-chat-unread-rule")) : null,
        label: flat(rule),
        ruleTop: rule != null && s != null ? Math.round(rule.getBoundingClientRect().top - s.top) : null,
        after: flat(after).slice(0, 40),
        atEnd: scroller != null && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24,
    };
})()`;

function writeFixture(dir) {
    const lines = [];
    for (let t = 1; t <= TURNS; t++) {
        const at = { cwd: dir, ts: new Date(Date.now() - (TURNS - t + 1) * 60_000).toISOString() };
        lines.push(AC.userText(`Question ${t}: walk me through part ${t}.`, at));
        const body = Array.from({ length: PARAGRAPHS }, (_, p) => `Turn ${t}, point ${p + 1}: one line of the reply.`);
        lines.push(AC.assistantText([...body, `End of turn ${t}.`].join("\n\n"), at));
    }
    return AC.writeTranscript(dir, SESSION, lines);
}

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures(kit);

    // off the Agent surface (its panes stay mounted, off screen), the agent's count set, then back on it, focused
    const openWith = async (h, id, count, mode) => {
        await h.goto("cockpit");
        await AC.agentPage(
            h,
            `const U = await mod("app/view/agents/unreadagentsstore.ts");
            const M = await mod("app/view/agents/chatmodestore.ts");
            M.setChatMode(${JSON.stringify(id)}, ${JSON.stringify(mode)});
            const next = new Map(globalStore.get(U.unreadAgentsAtom));
            if (${count} > 0) next.set(${JSON.stringify(id)}, ${count}); else next.delete(${JSON.stringify(id)});
            globalStore.set(U.unreadAgentsAtom, next);
            return true;`
        );
        await AC.focusAgent(h, id);
    };

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-unread-")) };
                try {
                    ctx.path = writeFixture(ctx.dir);
                    await h.goto("agent");
                    const { tabId, blockId } = await makeTab(h, ctx, { label: AGENT_NAME });
                    ctx.id = tabId;
                    await AC.setRoster(h, [
                        {
                            id: tabId,
                            name: AGENT_NAME,
                            project: "fx-chat-unread",
                            task: "",
                            state: "idle",
                            agent: "claude",
                            model: "opus",
                            activeMs: 60_000,
                            blockId,
                            transcriptPath: ctx.path,
                        },
                    ]);
                    // reading needs the window's focus (atoms.documentHasFocus): the dev window may sit behind another
                    await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
                    await h.ev('window.dispatchEvent(new Event("focus"))');
                    await openWith(h, tabId, UNREAD, "chat");
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) =>
                    steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec(`${NAME}: arrange`, false, ctx.arrangeError);
                    return steps;
                }
                const id = ctx.id;
                const until = (cond) => polishWaitFor(h, `(async () => ((s) => ${cond})(await ${seen(id)}))()`, WAIT_MS);
                const run = async (name, fn) => {
                    try {
                        await fn(name);
                    } catch (e) {
                        rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                    }
                };

                await run("1. opens at the first unread turn", async (name) => {
                    await until(`s.rule === ${UNREAD}`);
                    await polishNap(400);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-unread-turns-1-open.png");
                    rec(
                        `${name}: Chat opens with the "${UNREAD} new turns" rule at the top of the view, over turn ${TURNS - UNREAD + 1}; the count stays ${UNREAD} (its long reply's end is below)`,
                        s.rule === UNREAD &&
                            s.label === `${UNREAD} new turns` &&
                            s.ruleTop != null &&
                            s.ruleTop >= 0 &&
                            s.ruleTop <= 80 &&
                            s.after.startsWith(`Question ${TURNS - UNREAD + 1}`) &&
                            s.count === UNREAD &&
                            !s.atEnd,
                        s
                    );
                });

                await run("2. one turn read", async (name) => {
                    // the first unread turn's reply: its last line 40px above the view's end (the dock's padding)
                    await h.ev(`(() => {
                        const layer = ${layerOf(id)};
                        const scroller = layer.querySelector("[data-chat-scroller]");
                        const items = [...layer.querySelectorAll("[data-chat-conversation] > [data-chat-item]")];
                        const q = items.findIndex((el) => el.textContent.includes("Question ${TURNS - UNREAD + 1}:"));
                        const reply = items[q + 1];
                        const viewBottom = scroller.getBoundingClientRect().bottom - parseFloat(getComputedStyle(scroller).paddingBottom);
                        scroller.scrollTop += reply.getBoundingClientRect().bottom - viewBottom + 40;
                        return true;
                    })()`);
                    const dropped = await until(`s.count === ${UNREAD - 1}`);
                    await polishNap(300);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-unread-turns-2-one-read.png");
                    rec(
                        `${name}: scrolling turn ${TURNS - UNREAD + 1}'s last line into view drops the count to ${UNREAD - 1}, on the sidebar row too; the rule keeps its ${UNREAD}`,
                        dropped && s.count === UNREAD - 1 && (s.row === UNREAD - 1 || s.row === 0) && s.rule === UNREAD,
                        s
                    );
                });

                await run("3. read to the end", async (name) => {
                    await h.ev(`(() => { const s = ${layerOf(id)}.querySelector("[data-chat-scroller]"); s.scrollTop = s.scrollHeight; return true; })()`);
                    const cleared = await until(`s.count === 0`);
                    await polishNap(300);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-unread-turns-3-all-read.png");
                    rec(`${name}: at the end every unread turn is read: the count is 0, the row's badge gone, the rule still says ${UNREAD}`, cleared && s.count === 0 && s.row === 0 && s.rule === UNREAD, s);
                });

                await run("4. opened again with nothing unread", async (name) => {
                    await openWith(h, id, 0, "chat");
                    await until(`s.items > 0`);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    rec(`${name}: back on the agent with nothing unread, Chat has no rule and is at the end`, s.rule == null && s.atEnd && s.count === 0, s);
                });

                await run("5. Terminal clears at once", async (name) => {
                    await openWith(h, id, 2, "terminal");
                    const cleared = await until(`s.count === 0`);
                    const s = await h.ev(seen(id));
                    rec(`${name}: an agent in Terminal coming into view with 2 unread drops to 0 at once`, cleared && s.count === 0, s);
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
                await step("chat mode back", () =>
                    AC.agentPage(h, `const M = await mod("app/view/agents/chatmodestore.ts"); M.setChatMode(${JSON.stringify(ctx.id ?? "")}, "chat"); return true;`)
                );
                await step("end the focus emulation", () => h.cdp("Emulation.setFocusEmulationEnabled", { enabled: false }));
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("drop the focus", () => AC.agentPage(h, `globalStore.set(agentsModel().focusIdAtom, undefined); return true;`));
                await step("close the fixture tab", () => closeTabs(h, ctx));
                await step("remove the fixture transcript", () => rmSync(ctx.dir, { recursive: true, force: true }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
