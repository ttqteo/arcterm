// later-section: the Brief's Later section and Ask agent (docs/superpowers/specs/2026-11-27-ask-later-design.md decisions 5
// and 6, Builder's calls 11 and 12; board B-later-section). Three initiatives made through effortcreate/effortmutate as
// the cockpit writes them (author "you", so the ops' session and conversation land on each chunk's first note):
//   A  a plan chunk and three later items: one due today whose note names the live fixture agent (its tab and its
//      conversation), one with no mark of an agent, one whose note names an agent tab that is gone and no conversation
//   B  one later item, saved after A's, so its group is the newest
//   C  a blocked plan chunk, so the Waiting on you strip is drawn and reads 1
// and one live fixture Claude agent over a real tab (a terminal block with no controller, so nothing runs in it) whose
// transcript's stem is the conversation id A's due item names. No real agent is launched, and nothing is resumed:
// Ask agent on an item whose agent has ended and whose conversation is in History opens a new tab through
// reopenSessionById, which runs the session's resume command, so that path is covered by askagentlater.test.ts and a
// hand check (docs/hand-checks.md) instead.
// kit is scenarios.mjs's JARVIS_KIT (waveService, briefNap, briefViewport, briefSeedInitiative, briefDeleteEfforts,
// polishWaitFor, polishReload).
//
// Steps:
//   1. the Brief shows "Later 4" right after the Waiting strip, which still reads 1; B's group is first, then A's, whose
//      due item is first with its chip; every row has an age, a tick and Ask agent
//   2. no later label is in the Waiting strip or in Needs you's list, and the due item raises no chunk-due there
//   3. the tick marks the chunk done on the server and its row leaves; the strip still reads 1; Undo brings the row back
//      and the server's chunk is pending again, the strip still reading 1
//   4. Ask agent on the live agent's item switches to that agent, whose chat box holds the passage as a quote
//   5. Ask agent on the item whose agent has ended says so, and goes nowhere
//   6. with no item left the region is absent

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "later-section";
const TITLE_A = "verify-later-section-a";
const TITLE_B = "verify-later-section-b";
const TITLE_C = "verify-later-section-c";
const TITLES = [TITLE_A, TITLE_B, TITLE_C];
const AGENT_NAME = "later source agent";
// the fixture transcript's stem (later-section-live.jsonl): the conversation id the due item's note names
const CONVERSATION = "later-section-live";
const GONE_TAB = "later-section-gone-tab";
const GRID_KEY = "agent.grids";
const GRID_EMPTY = { project: null, grids: {} };

const DUE_LABEL = "Decide which parser takes the audit logs";
const TICK_LABEL = "Push DEV to origin";
const ENDED_LABEL = "Delete the backup branch";
const OTHER_LABEL = "Ask again about the heavy-job cap";
const PLAN_LABEL = "Plan one";
const BLOCKED_LABEL = "Stuck";
const PASSAGE = "Decide whether 9306 or 1050 takes the audit logs; talk it over with a colleague.";

const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const localDay = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// the region as drawn: header count, each group's title and rows, and where it sits against the Waiting strip
const READ = `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const region = document.querySelector('[data-jarvis-brief-region="later-chunks"]');
    const strip = document.querySelector('[data-jarvis-brief-region="waiting"]');
    const head = document.querySelector('[data-jarvis-waiting-head]');
    const stripCount = /Waiting on you\\s*(\\d+)/.exec(flat(head));
    const base = { stripCount: stripCount ? Number(stripCount[1]) : null, stripText: flat(strip) };
    if (!region) return { ...base, region: false };
    const main = document.querySelector('[data-jarvis-brief-main]');
    return {
        ...base,
        region: true,
        header: flat(region.firstElementChild),
        count: flat(region.querySelector('[data-later-count]')),
        groups: [...region.querySelectorAll('[data-later-group]')].map((g) => ({
            oref: g.dataset.laterGroup,
            title: flat(g.firstElementChild),
            rows: [...g.querySelectorAll('[data-later-row]')].map((r) => ({
                label: r.dataset.laterLabel,
                due: flat(r.querySelector('[data-later-due]')) || null,
                age: flat(r.querySelector('[data-later-age]')),
                tick: !!r.querySelector('[data-later-tick]'),
                ask: flat(r.querySelector('[data-later-ask]')),
            })),
        })),
        inMain: main?.contains(region) === true,
        afterStrip: !!strip && !!(strip.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING),
        rightAfterStrip: strip?.nextElementSibling?.contains(region) === true,
    };
})()`;

// the Brief's toast as drawn: its kind, its message and whether it holds Undo. The message is read without the Undo button,
// whose label sits in the same element (the toast's textContent reads "Done · Push DEV to originUndo"). Null with no toast.
export const READ_TOAST = `(() => {
    const t = document.querySelector('[data-jarvis-brief-toast]');
    if (!t) return null;
    const message = t.cloneNode(true);
    message.querySelectorAll('[data-jarvis-toast-undo]').forEach((b) => b.remove());
    return {
        kind: t.dataset.jarvisBriefToast,
        text: (message.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        undo: !!t.querySelector('[data-jarvis-toast-undo]'),
    };
})()`;

const rowCount = (r) => (r?.groups ?? []).reduce((n, g) => n + g.rows.length, 0);
const labelsOf = (r) => (r?.groups ?? []).map((g) => g.rows.map((x) => x.label));

const rowSel = (label) => `[data-later-row][data-later-label=${JSON.stringify(label)}]`;
const clickIn = (h, label, part) => h.ev(`document.querySelector(${JSON.stringify(rowSel(label))})?.querySelector('[${part}]')?.click() ?? null`);

export default function (kit) {
    const { waveService, briefNap, briefViewport, briefSeedInitiative, briefDeleteEfforts, polishWaitFor, polishReload } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    const readRegion = (h) => h.ev(READ).catch(() => null);
    async function waitRegion(h, ok, ms = 8000) {
        let last = null;
        for (let waited = 0; waited < ms; waited += 200) {
            last = await readRegion(h);
            if (last != null && ok(last)) return last;
            await nap(200);
        }
        return last;
    }
    const serverChunk = async (h, oid, label) => {
        const effort = (await h.rpc("effortget", { effortoid: oid }))?.effort;
        return (effort?.chunks ?? []).find((c) => c.label === label) ?? null;
    };
    const boxText = (h, tabId) =>
        AC.agentPage(h, `const I = await mod("app/view/agents/chatinsert.ts"); return I.chatBoxText(${JSON.stringify(tabId)});`);
    const agentState = (h) =>
        AC.agentPage(
            h,
            `const model = agentsModel();
            return { surface: globalStore.get(model.surfaceAtom), focus: globalStore.get(model.focusIdAtom) };`
        );

    const scenario = {
        name: NAME,
        surface: "jarvis",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-later-section-")),
                prevGrid: await h.ev(`localStorage.getItem(${JSON.stringify(GRID_KEY)})`),
                prevModes: await h.ev(`localStorage.getItem("agent.chatmode")`),
                oids: {},
            };
            let at = "writing the transcript";
            try {
                const base = Date.now() - 7_200_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                ctx.transcript = AC.writeTranscript(ctx.dir, CONVERSATION, [
                    AC.userText("what is left to decide about the parsers?", { ...o(0), uuid: "u1" }),
                    AC.assistantText(PASSAGE, { ...o(2), uuid: "a1" }),
                ]);
                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                await polishReload(h);
                await h.goto("agent");
                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, { label: AGENT_NAME });
                at = "setting the roster";
                const now = Date.now();
                await AC.setRoster(h, [
                    {
                        project: "arcterm",
                        state: "idle",
                        idleSince: now - 3_600_000,
                        task: "Check the parsers",
                        agent: "claude",
                        model: "opus",
                        id: ctx.tab.tabId,
                        name: AGENT_NAME,
                        blockId: ctx.tab.blockId,
                        transcriptPath: ctx.transcript,
                        sleeping: { since: now - 3_600_000, freedBytes: 0 },
                    },
                ]);
                // the agent's cell is drawn, so its chat box is registered before the Brief asks it to take a quote
                await AC.focusAgent(h, ctx.tab.tabId);
                at = "waiting for the agent's chat";
                ctx.chatUp = await polishWaitFor(h, `!!document.querySelector('[data-agent-chat="${ctx.tab.tabId}"]')`, 20_000);

                const today = localDay();
                const from = `From agent "${AGENT_NAME}" (agent:${ctx.tab.tabId}), ${today}`;
                const note = (passage, agent = from) => `${agent}\n\n> ${passage}`;
                at = "seeding the blocked initiative";
                ctx.oids.c = await briefSeedInitiative(h, TITLE_C, [BLOCKED_LABEL], [
                    { op: "setChunkStatus", chunk: BLOCKED_LABEL, status: "blocked" },
                ]);
                at = "seeding the first initiative";
                ctx.oids.a = await briefSeedInitiative(h, TITLE_A, [PLAN_LABEL], [
                    {
                        op: "addChunk",
                        label: DUE_LABEL,
                        later: true,
                        due: today,
                        note: note(PASSAGE),
                        session: `agent:${ctx.tab.tabId}`,
                        conversation: CONVERSATION,
                    },
                    { op: "addChunk", label: TICK_LABEL, later: true, note: "Push the local DEV branch, one commit ahead of origin/DEV." },
                    {
                        op: "addChunk",
                        label: ENDED_LABEL,
                        later: true,
                        note: note("Delete the backup branch once the push has landed.", `From agent "gone", ${today}`),
                        session: `agent:${GONE_TAB}`,
                    },
                ]);
                // a second apart from A's, so B's items are the newest and its group comes first
                await nap(40);
                at = "seeding the second initiative";
                ctx.oids.b = await briefSeedInitiative(h, TITLE_B, [], [
                    { op: "addChunk", label: OTHER_LABEL, later: true, note: "Measure the RAM first, then ask the cap again." },
                ]);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) =>
                steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent and the three initiatives", false, ctx.arrangeError);
                return steps;
            }
            const tabId = ctx.tab.tabId;
            const today = localDay();
            const dueChip = `due ${today.slice(5)}`;
            try {
                await briefViewport(h, 1600, 1000);
                await h.goto("jarvis");
                // a freshly booted app draws the Brief's skeleton until its first briefing lands
                const first = await waitRegion(h, (r) => r.region === true && rowCount(r) === 4, 20_000);
                await h.ev(`document.querySelector('[data-jarvis-brief-region="later-chunks"]')?.scrollIntoView({ block: 'center' })`);
                await briefNap(300);
                await h.shot("cdp-shots/later-section-brief.png");

                // 1. Later 4 right after the Waiting strip (which reads 1), groups in call 11's order, the due chip, ages, Ask agent
                const groups = first?.groups ?? [];
                const rows = groups.flatMap((g) => g.rows);
                rec(
                    "1. the Brief shows Later 4 right after the Waiting strip, which reads 1; B's group first, then A's with its due item first and its chip; an age, a tick and Ask agent on every row",
                    first?.region === true &&
                        first.header.startsWith("Later") &&
                        first.count === "4" &&
                        first.inMain === true &&
                        first.afterStrip === true &&
                        first.rightAfterStrip === true &&
                        first.stripCount === 1 &&
                        groups.length === 2 &&
                        groups[0].title === TITLE_B &&
                        groups[1].title === TITLE_A &&
                        JSON.stringify(labelsOf(first)) === JSON.stringify([[OTHER_LABEL], [DUE_LABEL, TICK_LABEL, ENDED_LABEL]]) &&
                        rows.find((r) => r.label === DUE_LABEL)?.due === dueChip &&
                        rows.filter((r) => r.due != null).length === 1 &&
                        rows.every((r) => /^(<1m|\d+[a-z]+)$/.test(r.age) && r.tick && r.ask === "Ask agent"),
                    { dueChip, ...first }
                );

                // 2. nothing of Later in Waiting on you or Needs you, and the due item raises no chunk-due there
                const attention = await AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/attentionstore.ts");
                    await S.loadAttention();
                    return globalStore.get(S.attentionAtom).map((a) => ({ kind: a.kind, effortoid: a.effortoid ?? null, text: a.text, chunk: a.chunklabel ?? null }));`
                );
                const labels = [DUE_LABEL, TICK_LABEL, ENDED_LABEL, OTHER_LABEL];
                const mentions = (s) => labels.some((l) => (s ?? "").includes(l));
                rec(
                    "2. no later label is in the Waiting strip or in Needs you's list, and the due item raises no chunk-due",
                    !mentions(first?.stripText) &&
                        attention.every((a) => !mentions(a.text) && !mentions(a.chunk)) &&
                        !attention.some((a) => a.kind === "chunk-due" && (a.effortoid === ctx.oids.a || a.effortoid === ctx.oids.b)) &&
                        // what the strip does hold is the blocked chunk of the third initiative
                        (first?.stripText.includes(TITLE_C) === true || first?.stripText.includes(BLOCKED_LABEL) === true),
                    { stripText: first?.stripText, attention }
                );

                // 3. the tick: done on the server, the row leaves, the strip stays at 1; Undo brings the row back
                await clickIn(h, TICK_LABEL, "data-later-tick");
                const ticked = await waitRegion(h, (r) => rowCount(r) === 3, 4000);
                const toast = (await h.ev(READ_TOAST)) ?? { kind: null, text: "", undo: false };
                let done = null;
                for (let waited = 0; waited < 4000 && done?.status !== "done"; waited += 200) {
                    done = await serverChunk(h, ctx.oids.a, TICK_LABEL);
                    if (done?.status !== "done") await nap(200);
                }
                await h.shot("cdp-shots/later-section-ticked.png");
                await h.ev(`document.querySelector('[data-jarvis-toast-undo]')?.click()`);
                const back = await waitRegion(h, (r) => rowCount(r) === 4, 6000);
                let again = null;
                for (let waited = 0; waited < 4000 && again?.status !== "pending"; waited += 200) {
                    again = await serverChunk(h, ctx.oids.a, TICK_LABEL);
                    if (again?.status !== "pending") await nap(200);
                }
                rec(
                    "3. the tick marks the chunk done on the server and the row leaves with the strip still at 1; Undo brings the row back, the chunk is pending again and the strip still reads 1",
                    ticked?.count === "3" &&
                        !labelsOf(ticked).flat().includes(TICK_LABEL) &&
                        ticked.stripCount === 1 &&
                        done?.status === "done" &&
                        done?.later === true &&
                        toast.text === `Done · ${TICK_LABEL}` &&
                        toast.undo === true &&
                        back?.count === "4" &&
                        labelsOf(back).flat().includes(TICK_LABEL) &&
                        back.stripCount === 1 &&
                        again?.status === "pending" &&
                        again?.later === true,
                    { ticked: ticked && { count: ticked.count, stripCount: ticked.stripCount, labels: labelsOf(ticked) }, done: done?.status, toast, back: back && { count: back.count, stripCount: back.stripCount }, again: again?.status }
                );

                // 4. Ask agent on the live agent's item: its cell comes forward and its chat box holds the passage as a quote
                const boxBefore = await boxText(h, tabId);
                await clickIn(h, DUE_LABEL, "data-later-ask");
                let jumped = null;
                for (let waited = 0; waited < 8000; waited += 250) {
                    const state = await agentState(h);
                    const text = await boxText(h, tabId);
                    jumped = { ...state, text };
                    if (state.surface === "agent" && state.focus === tabId && text.includes(`> ${PASSAGE}`)) break;
                    await nap(250);
                }
                await briefNap(300);
                await h.shot("cdp-shots/later-section-ask-live.png");
                rec(
                    "4. Ask agent on the live agent's item switches to that agent, whose chat box holds the passage as a quote",
                    ctx.chatUp === true &&
                        jumped?.surface === "agent" &&
                        jumped.focus === tabId &&
                        jumped.text.startsWith(`> ${PASSAGE}`),
                    { chatUp: ctx.chatUp, boxBefore, ...jumped }
                );

                // 5. Ask agent on the item whose agent tab is gone, with no conversation to resume: it says so and goes nowhere
                await h.goto("jarvis");
                const at5 = await waitRegion(h, (r) => r.region === true && rowCount(r) === 4, 10_000);
                const boxAfterJump = await boxText(h, tabId);
                const rosterIds = () => AC.agentPage(h, `return globalStore.get(agentsModel().agentsAtom).map((a) => a.id).sort();`);
                const tabs0 = await rosterIds();
                await clickIn(h, ENDED_LABEL, "data-later-ask");
                let toast5 = null;
                for (let waited = 0; waited < 4000; waited += 200) {
                    toast5 = await h.ev(READ_TOAST);
                    if (toast5?.text) break;
                    await nap(200);
                }
                const state5 = await agentState(h);
                const tabs5 = await rosterIds();
                await h.shot("cdp-shots/later-section-ask-ended.png");
                rec(
                    "5. Ask agent on the item whose agent has ended says \"That agent session has ended\", stays on Jarvis and opens no tab",
                    at5?.region === true &&
                        toast5?.kind === "error" &&
                        toast5.text === "That agent session has ended" &&
                        state5.surface === "jarvis" &&
                        tabs0.includes(tabId) &&
                        JSON.stringify(tabs5) === JSON.stringify(tabs0) &&
                        (await boxText(h, tabId)) === boxAfterJump,
                    { toast5, state5, tabs0, tabs5 }
                );

                // 6. with no item left the region is absent: the four items done through the store, as the tick writes them
                await AC.agentPage(
                    h,
                    `const E = await mod("app/view/jarvis/effortstore.ts");
                    await E.setChunkStatus("effort:${ctx.oids.a}", ${JSON.stringify(DUE_LABEL)}, "done");
                    await E.setChunkStatus("effort:${ctx.oids.a}", ${JSON.stringify(TICK_LABEL)}, "done");
                    await E.setChunkStatus("effort:${ctx.oids.a}", ${JSON.stringify(ENDED_LABEL)}, "done");
                    await E.setChunkStatus("effort:${ctx.oids.b}", ${JSON.stringify(OTHER_LABEL)}, "done");
                    return true;`
                );
                const empty = await waitRegion(h, (r) => r.region === false, 8000);
                const gone = await h.ev(
                    `document.querySelector('[data-jarvis-brief-region="later-chunks"]') == null && document.querySelector('[data-jarvis-brief-region-reveal="later-chunks"]') == null`
                );
                await h.shot("cdp-shots/later-section-empty.png");
                rec(
                    "6. with no item left the region is absent, and the Waiting strip still reads 1",
                    empty?.region === false && gone === true && empty.stripCount === 1,
                    { empty, gone }
                );
            } catch (e) {
                rec("the steps ran to the end", false, String(e?.message ?? e));
            }
            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`later-section teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("delete the initiatives", async () => {
                for (const title of TITLES) await briefDeleteEfforts(h, title);
            });
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            await step("restore the grid and the chat modes", () =>
                h.ev(`(() => {
                    for (const [key, prev] of [[${JSON.stringify(GRID_KEY)}, ${JSON.stringify(ctx.prevGrid ?? null)}], ["agent.chatmode", ${JSON.stringify(ctx.prevModes ?? null)}]]) {
                        if (prev == null) localStorage.removeItem(key);
                        else localStorage.setItem(key, prev);
                    }
                    return true;
                })()`)
            );
            await step("remove the fixture transcript", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride"));
            await step("reload onto the live roster", () => polishReload(h));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
