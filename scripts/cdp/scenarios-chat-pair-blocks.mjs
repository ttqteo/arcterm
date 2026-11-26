// chat-pair-blocks: Chat's pair cards (docs/superpowers/specs/2026-11-25-chat-pair-blocks-design.md,
// frontend/app/view/agents/pairblocks.ts / chatpairblock.tsx). One fixture Claude agent over a real tab, whose transcript
// (a temp file) holds two replies that end with a ```arc-pair list, and a third that holds a ```arc-judge fence (a judge
// writes it in its own Chat; drawn here beside the lists so one agent shows every card). The agent is the working agent of
// a pair in the page's dev mock (devMockPairsAtom), whose server view is the newest list with the judge's marks overlaid:
// D2 reopened, a judge's new point, A6 not answered yet. The newest list draws in full with Agreed folded (and opened on a
// press), the earlier list as one folded row (opened on a press), the judge's fence as its card, and a chip answers both
// sides through PairSayCommand (stubbed: nothing is sent). Nothing runs and nothing is written into ~/.claude/projects.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap, waveService).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import { pairRpcCalls, restorePairRpc, seedPair, stubPairRpc } from "./pair-fixtures.mjs";

const NAME = "chat-pair-blocks";
const AGENT_NAME = "pair blocks";
const SESSION = "chat-pair-blocks";
const PAIR_ID = "pair-fx-chat-blocks";
const JUDGE_TAB = "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6";
const WAIT_MS = 15_000;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const fence = (lang, ...lines) => ["```" + lang, ...lines, "```"].join("\n");

const OLDER = fence(
    "arc-pair",
    "D1 Lock the §16 threshold before the pilot",
    "O2 Pilot cases outside the 305 test split",
    "O3 Estimate the Docker hours",
    "A4 Run the probe now or after the benign gate? [Now | After the gate]"
);
const NEWEST = fence(
    "arc-pair",
    "D1 Lock the §16 threshold before the pilot — you sign §16",
    "D2 Pilot cases outside the 305 test split",
    "D3 Docker hours are 11 for the full run",
    "O5 Does §16.8 cover PREREG §16.5?",
    "A6 Is a 50% compliance threshold fine? -- the judge said 'for example 50%' [50%, go on | Keep 70%]"
);
const JUDGE = fence(
    "arc-judge",
    "reopen D2: the dev split overlaps the test split on 9 cases",
    "new: McNemar needs paired cases; log the two dropped ones first"
);

function writeFixture(dir) {
    const at = (agoMs) => ({ cwd: dir, ts: new Date(Date.now() - agoMs).toISOString() });
    return AC.writeTranscript(dir, SESSION, [
        AC.userText("Plan the oracle-tightening run with the judge.", at(30 * 60_000)),
        AC.assistantText(`Read the judge's three points.\n\n${OLDER}`, at(29 * 60_000)),
        AC.userText("Go on.", at(20 * 60_000)),
        AC.assistantText(`Checked the Docker cost and the split.\n\n${NEWEST}`, at(19 * 60_000)),
        AC.assistantText(`The judge's marks, as it wrote them:\n\n${JUDGE}`, at(18 * 60_000)),
    ]);
}

const item = (num, kind, text, extra = {}) => ({
    num,
    kind,
    text,
    note: "",
    chips: [],
    msgid: "",
    reopenedby: "",
    newby: "",
    answer: "",
    ...extra,
});

// the pair as wavesrv would send it: the newest list is its anchor, and the judge's marks are overlaid on it
function pairOf(workerTab, now) {
    const side = (tab, name) => ({ tab, name, harness: "claude" });
    return {
        id: PAIR_ID,
        project: "fx-chat-pair",
        worker: side(workerTab, AGENT_NAME),
        judges: [side(JUDGE_TAB, `Judge: ${AGENT_NAME}`)],
        state: "relaying",
        stopreason: "",
        owed: false,
        messagecount: 0,
        lastts: now,
        holdheavy: false,
        tokencap: 0,
        tokens: 0,
        note: "",
        createdts: now - 30 * 60_000,
        messages: [],
        decided: {
            asks: [
                item(6, "asks", "Is a 50% compliance threshold fine?", {
                    note: "the judge said 'for example 50%'",
                    chips: ["50%, go on", "Keep 70%"],
                }),
            ],
            agreed: [
                item(1, "agreed", "Lock the §16 threshold before the pilot", { note: "you sign §16" }),
                item(3, "agreed", "Docker hours are 11 for the full run"),
            ],
            open: [
                item(2, "open", "Pilot cases outside the 305 test split", { reopenedby: JUDGE_TAB }),
                item(5, "open", "Does §16.8 cover PREREG §16.5?"),
                item(0, "open", "McNemar needs paired cases; log the two dropped ones first", { newby: JUDGE_TAB }),
            ],
        },
    };
}

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;

// what the agent's Chat shows of its pair cards, read in one call
const seen = (id) => `(() => {
    const layer = ${layerOf(id)};
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const latest = layer?.querySelector('[data-chat-pair="latest"]');
    const older = layer?.querySelector('[data-chat-pair="older"]');
    const judge = layer?.querySelector('[data-chat-judge="marks"]');
    const labels = (id) => [...(latest?.querySelector('[data-chat-pair-section="' + id + '"]')?.querySelectorAll("[data-chat-pair-item]") ?? [])]
        // An A item's AskBox and the NumberedRow inside it both carry the hook: count the outer one.
        .filter((r) => r.parentElement?.closest("[data-chat-pair-item]") == null)
        .map((r) => r.getAttribute("data-chat-pair-item"));
    const agreed = latest?.querySelector('[data-chat-pair-section="agreed"]');
    return {
        latest: latest == null ? null : {
            current: latest.getAttribute("data-chat-pair-current"),
            head: flat(latest.querySelector("[data-chat-bscard-head]")?.parentElement),
            asks: labels("asks"),
            open: labels("open"),
            openText: flat(latest.querySelector('[data-chat-pair-section="open"]')),
            agreedOpen: agreed?.hasAttribute("data-chat-pair-open") ?? null,
            agreedToggle: flat(agreed?.querySelector("[data-chat-pair-agreed-toggle]")),
            agreed: labels("agreed"),
            chips: [...latest.querySelectorAll("[data-chat-pair-chip]")].map((c) => c.getAttribute("data-chat-pair-chip")),
            other: latest.querySelector("[data-chat-pair-other]") != null,
        },
        older: older == null ? null : { open: older.hasAttribute("data-chat-pair-open"), text: flat(older) },
        judge: judge == null ? null : {
            head: flat(judge.querySelector("[data-chat-bscard-head]")?.parentElement),
            marks: [...judge.querySelectorAll("[data-chat-judge-mark]")].map((m) => ({ kind: m.getAttribute("data-chat-judge-mark"), text: flat(m) })),
        },
        olderCount: layer?.querySelectorAll('[data-chat-pair="older"]').length ?? 0,
        latestCount: layer?.querySelectorAll('[data-chat-pair="latest"]').length ?? 0,
        code: [...(layer?.querySelectorAll("[data-code-head]") ?? [])].filter((c) => /arc-pair|arc-judge/.test(c.textContent)).length,
    };
})()`;

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures(kit);

    const roster = (ctx) => [
        {
            id: ctx.id,
            name: AGENT_NAME,
            project: "fx-chat-pair",
            task: "",
            state: "idle",
            idleSince: Date.now() - 30_000,
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
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-pair-")) };
                try {
                    ctx.path = writeFixture(ctx.dir);
                    await h.goto("agent");
                    const { tabId, blockId } = await makeTab(h, ctx, { label: AGENT_NAME });
                    ctx.id = tabId;
                    ctx.blockId = blockId;
                    await AC.setRoster(h, roster(ctx));
                    await stubPairRpc(h);
                    await seedPair(h, [pairOf(tabId, Date.now())]);
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
                const scrollTo = (sel) =>
                    h.ev(`(() => { const el = ${layerOf(id)}?.querySelector(${JSON.stringify(sel)}); el?.scrollIntoView({ block: "center" }); return !!el; })()`);
                const click = (sel) =>
                    h.ev(`(() => { const el = ${layerOf(id)}?.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el; })()`);
                const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

                await run("1. newest list", async (name) => {
                    await until(`s.latest?.current === "true" && s.judge != null`);
                    await scrollTo('[data-chat-pair="latest"]');
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await shot(h, "1-newest");
                    const l = s.latest;
                    rec(
                        `${name}: the newest arc-pair list draws as the Pair list card, the pair's current list: head "2 agreed · 3 open" and "1 waits on you"; Waits on you holds A6 with its two chips and other…; Still open holds D2 (reopened by judge 4c6ba858), O5 and the judge's unnumbered new point; Agreed is folded to one row naming D3 as agreed in this reply; no arc-pair or arc-judge block is left as code`,
                        l != null && s.latestCount === 1 && l.head.includes("2 agreed · 3 open") && l.head.includes("1 waits on you") &&
                            eq(l.asks, ["A6"]) && eq(l.chips, ["50%, go on", "Keep 70%"]) && l.other &&
                            eq(l.open, ["D2", "O5", "new"]) && l.openText.includes("reopened by judge 4c6ba858") &&
                            l.agreedOpen === false && eq(l.agreed, []) && l.agreedToggle.includes("Agreed2") &&
                            l.agreedToggle.includes("D3 agreed in this reply") && s.code === 0,
                        s
                    );
                });

                await run("2. Agreed opened", async (name) => {
                    await click("[data-chat-pair-agreed-toggle]");
                    const ok = await until(`s.latest?.agreedOpen === true && s.latest.agreed.length === 2`);
                    await polishNap(700);
                    const s = await h.ev(seen(id));
                    await shot(h, "2-agreed-open");
                    rec(`${name}: pressing Agreed opens its list in the card: D1 and D3`, ok && eq(s.latest?.agreed, ["D1", "D3"]), s);
                });

                await run("3. older list", async (name) => {
                    await scrollTo('[data-chat-pair="older"]');
                    await polishNap(400);
                    const before = await h.ev(seen(id));
                    await shot(h, "3-older-folded");
                    await click('[data-chat-pair="older"] > button');
                    const ok = await until(`s.older?.open === true`);
                    await polishNap(700);
                    const s = await h.ev(seen(id));
                    await shot(h, "3-older-open");
                    rec(
                        `${name}: the earlier list draws as one folded row ("Pair list", "1 agreed · 2 open · 1 waits on you", "a newer list replaced it"), and a press opens its lines (D1, O2, O3, A4)`,
                        s.olderCount === 1 && before.older?.open === false &&
                            before.older.text.includes("1 agreed · 2 open · 1 waits on you") &&
                            before.older.text.includes("a newer list replaced it") && ok &&
                            ["D1", "O2", "O3", "A4"].every((l) => s.older.text.includes(l)),
                        { before: before.older, after: s.older }
                    );
                });

                await run("4. judge marks", async (name) => {
                    await scrollTo('[data-chat-judge="marks"]');
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await shot(h, "4-judge");
                    const j = s.judge;
                    rec(
                        `${name}: the arc-judge fence draws as the Judge marks card: head "1 reopened · 1 new point", a Reopens D2 row with its reason and the item as the pair's list has it (D2 · Pilot cases…), then a New point row`,
                        j != null && j.head.includes("1 reopened · 1 new point") && j.marks.length === 2 &&
                            j.marks[0].kind === "reopen" && j.marks[0].text.includes("Reopens D2") &&
                            j.marks[0].text.includes("the dev split overlaps") && j.marks[0].text.includes("D2 · Pilot cases outside the 305 test split") &&
                            j.marks[1].kind === "new" && j.marks[1].text.includes("New point"),
                        s.judge
                    );
                });

                await run("5. chip answers", async (name) => {
                    await scrollTo('[data-chat-pair="latest"]');
                    await click('[data-chat-pair-chip="50%, go on"]');
                    let calls = [];
                    for (let i = 0; i < 20 && calls.length === 0; i++) {
                        calls = await pairRpcCalls(h, "PairSayCommand");
                        if (calls.length === 0) await polishNap(250);
                    }
                    rec(
                        `${name}: a chip on the newest card answers both sides, tagged with its A item (PairSayCommand {pairid, text "50%, go on", to both, item 6})`,
                        calls.length === 1 && calls[0].pairid === PAIR_ID && calls[0].text === "50%, go on" && calls[0].to === "both" && calls[0].item === 6,
                        calls
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
                await step("clear the pair", () => seedPair(h, null));
                await step("restore the pair commands", () => restorePairRpc(h));
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("drop the focus", () => AC.agentPage(h, `globalStore.set(agentsModel().focusIdAtom, undefined); return true;`));
                await step("close the fixture tab", () => closeTabs(h, ctx));
                await step("remove the fixture transcript", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
