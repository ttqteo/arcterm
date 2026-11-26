// chat-pair-relay: Chat draws what a pair relays as the sender's turn (docs/superpowers/specs/
// 2026-11-26-chat-pair-relay-design.md, frontend/app/view/agents/pairrelay.ts / chatpairrelay.tsx; boards F and G of
// .superpowers/design/chat-pair-relay). Two fixture Claude agents over real tabs, the working agent `thesis-draft` and its
// judge `mit-thesis`, in one live pair of the page's dev mock (devMockPairsAtom). Their transcripts (temp files) hold the
// prompts the pair relays, read from the texts Go writes (claude/arc-view-mod/testdata/pair-*.txt, written by
// pkg/orchestrate/viewmod_fixtures_test.go from the real functions), so this shows exactly what the agents are sent:
//   working agent  its own reply ending in an arc-pair list, the first relay (the pair brief, then the judge's reply with an
//                  arc-judge fence), its next reply, and a second relay (the judge's reply, then your answer to A3)
//   judge          the judge's brief with the working agent's latest reply in it, its reply, and the working agent's next
//                  reply as a relay
// Chat draws the judge's reply as the judge's own card (name, time, the line it answers, its text whole, its fence as the
// Judge marks card), the brief as one folded line, your words as your bubble, and in the judge's Chat the working agent's
// replies as its cards, the newest list in full: it is the seeded pair's anchor list (the same items and text as its fence), so
// its A item keeps the answer chips and a press answers through the pair (the stubbed PairSayCommand records it). Nothing runs
// and nothing is written into ~/.claude/projects.
// Step 7 ("older reply", docs/superpowers/specs/2026-11-26-judge-on-reply-design.md) comes last: a pair that started from a
// reply the working agent had gone on from sends two prompts a little different (pair-relay-first-older.txt,
// pair-judge-brief-older.txt). They are appended to the two transcripts after the steps above, so those keep what they read.
// The first relay's brief is still one folded line, and the note "judging your reply from" is in the text it opens; the
// judge's brief is still one line, and the reply it pastes is the working agent's card.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap, waveService).

import { appendFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import { pairRpcCalls, restorePairRpc, seedPair, stubPairRpc } from "./pair-fixtures.mjs";

const NAME = "chat-pair-relay";
const WORKER_NAME = "thesis-draft";
const JUDGE_NAME = "mit-thesis";
const PAIR_ID = "pair-fx-chat-relay";
const WAIT_MS = 15_000;
const DOT = "·";
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const fixture = (name) => readFileSync(new URL(`../../claude/arc-view-mod/testdata/${name}.txt`, import.meta.url), "utf8");

const fence = (lang, ...lines) => ["```" + lang, ...lines, "```"].join("\n");

// the working agent's own reply, ending in the list the pair keeps
const OWN_LIST = fence("arc-pair", "D1 Pilot on 40 transcripts", "O2 Lock the 0.8 threshold");

// the transcripts: each relayed prompt is the user record Claude writes for it, so Chat reads it as it does a live one
function writeFixtures(dir, workerTab) {
    const at = (agoMs) => ({ cwd: dir, ts: new Date(Date.now() - agoMs).toISOString() });
    // the judge's brief names the working agent's tab, which the fixture text keeps as a placeholder
    const judgeBrief = fixture("pair-judge-brief").replace("tab-worker", workerTab);
    return {
        worker: AC.writeTranscript(dir, "chat-pair-relay-worker", [
            AC.userText("Plan the pilot with the judge.", at(40 * 60_000)),
            AC.assistantText(`Drafted the plan and put the points to the judge.\n\n${OWN_LIST}`, at(39 * 60_000)),
            AC.userText(fixture("pair-relay-first"), at(30 * 60_000)),
            AC.assistantText("Swapped the steps.", at(29 * 60_000)),
            AC.userText(fixture("pair-relay-batch"), at(20 * 60_000)),
        ]),
        judge: AC.writeTranscript(dir, "chat-pair-relay-judge", [
            AC.userText(judgeBrief, at(38 * 60_000)),
            AC.assistantText("> Swapped …\nNo new points.", at(37 * 60_000)),
            AC.userText(fixture("pair-relay-worker"), at(25 * 60_000)),
        ]),
    };
}

// the prompts of a pair that started from an older reply, as records to append: the judge's brief names the working agent's
// tab like the one above
function olderRecords(dir, workerTab) {
    const at = (agoMs) => ({ cwd: dir, ts: new Date(Date.now() - agoMs).toISOString() });
    return {
        worker: [AC.userText(fixture("pair-relay-first-older"), at(10 * 60_000))],
        judge: [AC.userText(fixture("pair-judge-brief-older").replace("tab-worker", workerTab), at(8 * 60_000))],
    };
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

// the pair as wavesrv would send it: the names the relayed heads carry are what find the tabs
function pairOf(workerTab, judgeTab, now) {
    const side = (tab, name) => ({ tab, name, harness: "claude" });
    return {
        id: PAIR_ID,
        project: "fx-chat-pair-relay",
        worker: side(workerTab, WORKER_NAME),
        judges: [side(judgeTab, JUDGE_NAME)],
        state: "relaying",
        stopreason: "",
        owed: false,
        messagecount: 0,
        lastts: now,
        holdheavy: false,
        tokencap: 0,
        tokens: 0,
        note: "",
        createdts: now - 40 * 60_000,
        messages: [],
        decided: {
            asks: [item(3, "asks", "Keep the 0.8 threshold?", { chips: ["Yes", "No, change it"] })],
            agreed: [item(1, "agreed", "Pilot on 40 transcripts")],
            // the anchor of the working agent's relayed list (pair-relay-worker.txt: D1, O2, A3): wavesrv cuts O2's line at its
            // " — ", so the item's text is the part before it and the note the rest, and isAnchorList (pairblocks.ts) holds
            open: [item(2, "open", "Lock the threshold from the labelled set", { note: "before the pilot runs" })],
        },
    };
}

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;

// what an agent's Chat shows of the relayed prompts, read in one call
const seen = (id) => `(() => {
    const layer = ${layerOf(id)};
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const heads = (el) => [...(el?.querySelectorAll("[data-code-head]") ?? [])].map(flat);
    const msg = (el) => ({
        from: el.getAttribute("data-chat-relay-msg"),
        name: flat(el.querySelector("[data-chat-relay-name]")),
        link: el.querySelector("[data-chat-relay-open]") != null,
        quote: flat(el.querySelector("[data-chat-relay-quote]")),
        text: flat(el),
        marks: el.querySelector('[data-chat-judge="marks"]') != null,
        latest: el.querySelector('[data-chat-pair="latest"]') != null,
        older: el.querySelector('[data-chat-pair="older"]') != null,
        card: (() => {
            const c = el.querySelector('[data-chat-pair="latest"]');
            return c == null ? null : {
                current: c.getAttribute("data-chat-pair-current"),
                // An A item's AskBox and the NumberedRow inside it both carry the hook: count the outer one.
                asks: [...c.querySelectorAll('[data-chat-pair-section="asks"] [data-chat-pair-item]')]
                    .filter((r) => r.parentElement?.closest("[data-chat-pair-item]") == null)
                    .map((r) => r.getAttribute("data-chat-pair-item")),
                chips: [...c.querySelectorAll("[data-chat-pair-chip]")].map((x) => x.getAttribute("data-chat-pair-chip")),
                other: c.querySelector("[data-chat-pair-other]") != null,
            };
        })(),
        items: [...el.querySelectorAll("li")].map(flat),
        rawOpen: el.querySelector("[data-chat-relay-raw]") != null,
        raw: flat(el.querySelector("[data-chat-relay-raw]")),
    });
    const relay = (el) => {
        const brief = el.querySelector("[data-chat-relay-brief]");
        const text = brief?.querySelector("[data-chat-relay-brief-text]");
        return {
            kind: el.getAttribute("data-chat-relay"),
            brief: brief == null ? null : {
                line: flat(brief.querySelector("[data-chat-relay-brief-toggle]")),
                open: brief.hasAttribute("data-chat-relay-brief-open"),
                text: text == null ? null : {
                    text: flat(text),
                    heads: heads(text),
                    pair: text.querySelector("[data-chat-pair]") != null,
                    judge: text.querySelector("[data-chat-judge]") != null,
                },
            },
            msgs: [...el.querySelectorAll("[data-chat-relay-msg]")].map(msg),
        };
    };
    return {
        layer: layer != null,
        relays: [...(layer?.querySelectorAll("[data-chat-relay]") ?? [])].map(relay),
        heads: heads(layer),
        generic: [...(layer?.querySelectorAll("*") ?? [])].filter((e) => flat(e) === "message ${DOT} from arcterm pair").length,
    };
})()`;

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures(kit);

    // fresh: a turn that ended after the first roster, so Chat reads the transcripts again
    const roster = (ctx, paths, fresh = false) => [
        {
            id: ctx.workerTab,
            name: WORKER_NAME,
            project: "fx-chat-pair-relay",
            task: "",
            state: "idle",
            idleSince: fresh ? Date.now() + 1000 : Date.now() - 30_000,
            agent: "claude",
            model: "opus",
            blockId: ctx.workerBlock,
            transcriptPath: paths.worker,
        },
        {
            id: ctx.judgeTab,
            name: JUDGE_NAME,
            project: "fx-chat-pair-relay",
            task: "",
            state: "idle",
            idleSince: fresh ? Date.now() + 1000 : Date.now() - 40_000,
            agent: "claude",
            model: "opus",
            blockId: ctx.judgeBlock,
            transcriptPath: paths.judge,
        },
    ];

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-pair-relay-")) };
                try {
                    await h.goto("agent");
                    const worker = await makeTab(h, ctx, { label: WORKER_NAME });
                    const judge = await makeTab(h, ctx, { label: JUDGE_NAME });
                    ctx.workerTab = worker.tabId;
                    ctx.workerBlock = worker.blockId;
                    ctx.judgeTab = judge.tabId;
                    ctx.judgeBlock = judge.blockId;
                    const paths = writeFixtures(ctx.dir, ctx.workerTab);
                    ctx.paths = paths;
                    await AC.setRoster(h, roster(ctx, paths));
                    await stubPairRpc(h);
                    await seedPair(h, [pairOf(ctx.workerTab, ctx.judgeTab, Date.now())]);
                    for (const tab of [ctx.workerTab, ctx.judgeTab]) {
                        await AC.agentPage(h, `const M = await mod("app/view/agents/chatmodestore.ts"); M.setChatMode(${JSON.stringify(tab)}, "chat"); return true;`);
                    }
                    await AC.focusAgent(h, ctx.workerTab);
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
                const w = ctx.workerTab;
                const j = ctx.judgeTab;
                const until = (id, cond) => polishWaitFor(h, `((s) => ${cond})(${seen(id)})`, WAIT_MS);
                const run = async (name, fn) => {
                    try {
                        await fn(name);
                    } catch (e) {
                        rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                    }
                };
                const scrollTo = (id, sel) =>
                    h.ev(`(() => { const el = ${layerOf(id)}?.querySelector(${JSON.stringify(sel)}); el?.scrollIntoView({ block: "center" }); return !!el; })()`);
                const click = (id, sel) =>
                    h.ev(`(() => { const el = ${layerOf(id)}?.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el; })()`);
                const msgOf = (r, from, at = 0) => r?.msgs.filter((m) => m.from === from)[at];
                const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

                await run("1. worker: judge's reply", async (name) => {
                    await until(w, `s.relays.length >= 2`);
                    await scrollTo(w, '[data-chat-relay="relay"] [data-chat-relay-msg="judge"]');
                    await polishNap(600);
                    const s = await h.ev(seen(w));
                    await shot(h, "1-judge-reply");
                    const r = s.relays[0];
                    const m = msgOf(r, "judge");
                    rec(
                        `${name}: the first relay draws the judge's reply as its own turn (board F): the pair brief is one folded line "arcterm paired this agent with ${JUDGE_NAME} ${DOT} 14:02", then a card from the judge ${JUDGE_NAME} (14:02) whose name opens its conversation, the line it answers above its text, its text whole and its arc-judge fence as the Judge marks card; no arc-judge block is left as code, and no "message ${DOT} from arcterm pair" card`,
                        r?.kind === "relay" && r.brief != null && r.brief.open === false &&
                            r.brief.line.includes(`arcterm paired this agent with ${JUDGE_NAME} ${DOT} 14:02`) &&
                            m != null && m.name === JUDGE_NAME && m.link && m.text.includes("14:02") &&
                            m.quote === "then I lock the 0.8 threshold and run the full set" &&
                            m.text.includes("The pilot measures before") && m.marks &&
                            !s.heads.some((x) => x.includes("arc-judge")) && s.generic === 0,
                        { relay: r, heads: s.heads, generic: s.generic }
                    );
                });

                await run("2. worker: brief opened", async (name) => {
                    await scrollTo(w, "[data-chat-relay-brief-toggle]");
                    await click(w, "[data-chat-relay-brief-toggle]");
                    const ok = await until(w, `s.relays[0]?.brief?.open === true && s.relays[0].brief.text != null`);
                    await polishNap(700);
                    const s = await h.ev(seen(w));
                    await shot(h, "2-brief-open");
                    const t = s.relays[0]?.brief?.text;
                    rec(
                        `${name}: pressing Brief opens the brief under the line ("End every reply with an arc-pair block…"), its arc-pair example stays a code block (no Pair list card inside it)`,
                        ok && t != null && t.text.includes("End every reply with an") &&
                            t.heads.some((x) => x.includes("arc-pair")) && !t.pair && !t.judge,
                        t
                    );
                });

                await run("3. worker: text as relayed", async (name) => {
                    await scrollTo(w, '[data-chat-relay-msg="judge"] [data-chat-relay-raw-toggle]');
                    await click(w, '[data-chat-relay-msg="judge"] [data-chat-relay-raw-toggle]');
                    const ok = await until(w, `s.relays[0] != null && s.relays[0].msgs.some((m) => m.from === "judge" && m.rawOpen)`);
                    await polishNap(700);
                    const s = await h.ev(seen(w));
                    await shot(h, "3-text-as-relayed");
                    const m = msgOf(s.relays[0], "judge");
                    rec(
                        `${name}: Text as relayed opens the part as the agent read it: its head line From the judge "${JUDGE_NAME}", 14:02: and its arc-judge fence`,
                        ok && m != null && m.raw.includes(`From the judge "${JUDGE_NAME}", 14:02:`) && m.raw.includes("```arc-judge"),
                        m?.raw
                    );
                });

                await run("4. worker: batch", async (name) => {
                    await scrollTo(w, '[data-chat-relay-msg="person"]');
                    await polishNap(500);
                    const s = await h.ev(seen(w));
                    await shot(h, "4-batch");
                    const r = s.relays[1];
                    const m = msgOf(r, "judge");
                    const you = msgOf(r, "person");
                    rec(
                        `${name}: the second relay (no brief) holds a judge card (14:09) whose list item reads data/labels-v2.csv, then your own words as your bubble: "Keep 0.8." under "You, answered A3 in the pair ${DOT} 14:10"`,
                        r?.kind === "relay" && r.brief == null && m != null && m.text.includes("14:09") &&
                            m.items.some((x) => x.includes("data/labels-v2.csv")) && you != null &&
                            you.text.includes("Keep 0.8.") && you.text.includes(`You, answered A3 in the pair ${DOT} 14:10`),
                        r
                    );
                });

                await run("5. judge: the working agent's reply", async (name) => {
                    await AC.focusAgent(h, j);
                    await until(j, `s.layer && s.relays.length >= 2 && s.relays.flatMap((r) => r.msgs).filter((m) => m.from === "worker").length >= 2`);
                    await scrollTo(j, '[data-chat-pair="latest"]');
                    await polishNap(700);
                    const s = await h.ev(seen(j));
                    await shot(h, "5-judge-side");
                    const brief = s.relays.find((r) => r.kind === "judgeBrief");
                    const workers = s.relays.flatMap((r) => r.msgs).filter((m) => m.from === "worker");
                    const last = workers[workers.length - 1];
                    rec(
                        `${name}: in the judge's Chat (board G) the brief is one line "arcterm made this agent the judge of ${WORKER_NAME}", and the working agent's replies are cards from ${WORKER_NAME} that open its conversation: the newest holds the Pair list in full as the pair's current list (A3 waits on you, with the chips Yes and No, change it), the earlier one (the brief's reply) a folded older list`,
                        brief?.brief != null && brief.brief.line.includes(`arcterm made this agent the judge of ${WORKER_NAME}`) &&
                            workers.length === 2 && last.name === WORKER_NAME && last.link && last.latest &&
                            workers[0].older && !workers[0].latest &&
                            last.card?.current === "true" && eq(last.card.asks, ["A3"]) &&
                            eq(last.card.chips, ["Yes", "No, change it"]),
                        { brief: brief?.brief?.line, workers }
                    );
                });

                await run("5b. judge: a chip answers", async (name) => {
                    // the stub arrange installed records the call; count before the press so this step reads only its own
                    const before = (await pairRpcCalls(h, "PairSayCommand")).length;
                    const chip = '[data-chat-pair="latest"] [data-chat-pair-chip="Yes"]';
                    await scrollTo(j, chip);
                    await polishNap(300);
                    const pressed = await click(j, chip);
                    let calls = [];
                    for (let i = 0; i < 20 && calls.length === 0; i++) {
                        calls = (await pairRpcCalls(h, "PairSayCommand")).slice(before);
                        if (calls.length === 0) await polishNap(250);
                    }
                    await polishNap(500);
                    await shot(h, "5b-judge-chip");
                    rec(
                        `${name}: pressing Yes on the working agent's list in the judge's Chat answers through the pair, both sides, tagged with its A item (PairSayCommand {pairid ${PAIR_ID}, text "Yes", to both, item 3}), once`,
                        pressed === true && calls.length === 1 && calls[0].pairid === PAIR_ID && calls[0].text === "Yes" &&
                            calls[0].to === "both" && calls[0].item === 3,
                        calls
                    );
                });

                await run("6. motion", async (name) => {
                    await AC.focusAgent(h, w);
                    await until(w, `s.layer && s.relays.length >= 1 && s.relays[0].brief != null`);
                    const isOpen = async () => (await h.ev(seen(w))).relays[0]?.brief?.open === true;
                    if (!(await isOpen())) {
                        await scrollTo(w, "[data-chat-relay-brief-toggle]");
                        await click(w, "[data-chat-relay-brief-toggle]");
                        await until(w, `s.relays[0]?.brief?.open === true`);
                        await polishNap(700);
                    }
                    await scrollTo(w, "[data-chat-relay-brief-toggle]");
                    await polishNap(300);
                    // fold it and read the box's height as it falls: the spring passes through values between full and gone
                    const fold = await h.ev(`(async () => {
                        const layer = ${layerOf(w)};
                        const toggle = layer?.querySelector("[data-chat-relay-brief-toggle]");
                        const boxH = () => layer?.querySelector("[data-chat-relay-brief] .overflow-hidden")?.getBoundingClientRect().height ?? null;
                        const full = boxH();
                        const t0 = performance.now();
                        toggle?.click();
                        const heights = [];
                        for (const at of [0, 60, 120, 240, 400]) {
                            const wait = t0 + at - performance.now();
                            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
                            heights.push(boxH());
                        }
                        let gone = false;
                        for (let i = 0; i < 40 && !gone; i++) {
                            gone = boxH() == null;
                            if (!gone) await new Promise((r) => setTimeout(r, 50));
                        }
                        return { full, heights, gone };
                    })()`);
                    const shown = fold.heights.map((v) => v ?? 0);
                    const falling = shown.every((v, i) => i === 0 || v <= shown[i - 1] + 0.5);
                    const between = shown.some((v) => v > 1 && v < fold.full - 1);
                    await shot(h, "6-brief-folded");
                    rec(
                        `${name}: folding the brief runs on the spring, not at once: its box's height at 0, 60, 120, 240 and 400 ms only falls and passes through values between full and gone, and the box is gone when it settles`,
                        fold.full > 1 && shown[0] > 1 && falling && between && fold.gone,
                        fold
                    );
                });

                // the n-th relay of a kind in an agent's Chat: scroll to its brief's line and press it
                const pressBrief = (id, kind, n) =>
                    h.ev(`(() => {
                        const rel = [...(${layerOf(id)}?.querySelectorAll('[data-chat-relay="${kind}"]') ?? [])][${n}];
                        const el = rel?.querySelector("[data-chat-relay-brief-toggle]");
                        el?.scrollIntoView({ block: "center" });
                        el?.click();
                        return !!el;
                    })()`);
                const briefsOf = `s.relays.filter((r) => r.kind === "judgeBrief")`;
                let appended = false;
                const appendOlder = async () => {
                    if (appended) return;
                    appended = true;
                    const more = olderRecords(ctx.dir, w);
                    appendFileSync(ctx.paths.worker, more.worker.join("\n") + "\n");
                    appendFileSync(ctx.paths.judge, more.judge.join("\n") + "\n");
                    await AC.setRoster(h, roster(ctx, ctx.paths, true));
                };

                await run("7. older reply: worker", async (name) => {
                    await appendOlder();
                    await AC.focusAgent(h, w);
                    await until(w, `s.layer && s.relays.length >= 3`);
                    const folded = (await h.ev(seen(w))).relays[2];
                    const pressed = await pressBrief(w, "relay", 2);
                    const ok = await until(w, `s.relays[2]?.brief?.open === true && s.relays[2].brief.text != null`);
                    await polishNap(700);
                    const s = await h.ev(seen(w));
                    await shot(h, "7-older-reply-worker");
                    const r = s.relays[2];
                    const t = r?.brief?.text;
                    const m = msgOf(r, "judge");
                    rec(
                        `${name}: the first relay of a pair that started from an older reply folds its brief into one line "arcterm paired this agent with ${JUDGE_NAME} ${DOT} 14:02" (the pair's own relay, no extra card), and pressing it opens the brief with the note "judging your reply from 13:40" in it, after the worker brief ("arcterm has paired you with"); the judge's card follows as before`,
                        folded?.kind === "relay" && folded.brief != null && folded.brief.open === false &&
                            folded.brief.line.includes(`arcterm paired this agent with ${JUDGE_NAME} ${DOT} 14:02`) &&
                            pressed === true && ok && t != null &&
                            t.text.includes("arcterm has paired you with") && t.text.includes("judging your reply from 13:40") &&
                            t.text.indexOf("arcterm has paired you with") < t.text.indexOf("judging your reply from 13:40") &&
                            m != null && m.name === JUDGE_NAME && m.text.includes("14:02") && m.marks && s.generic === 0,
                        { folded: folded?.brief, text: t?.text, judge: m?.text, generic: s.generic }
                    );
                });

                await run("7b. older reply: judge", async (name) => {
                    await appendOlder();
                    await AC.focusAgent(h, j);
                    await until(j, `s.layer && ${briefsOf}.length >= 2`);
                    const folded = ((await h.ev(seen(j))).relays.filter((r) => r.kind === "judgeBrief"))[1];
                    const pressed = await pressBrief(j, "judgeBrief", 1);
                    const ok = await until(j, `${briefsOf}[1]?.brief?.open === true && ${briefsOf}[1].brief.text != null`);
                    await polishNap(700);
                    const s = await h.ev(seen(j));
                    await shot(h, "7b-older-reply-judge");
                    const older = s.relays.filter((r) => r.kind === "judgeBrief")[1];
                    const t = older?.brief?.text;
                    const card = msgOf(older, "worker");
                    rec(
                        `${name}: the brief of an older reply is one line "arcterm made this agent the judge of ${WORKER_NAME}" and the reply it pastes is the working agent's card from ${WORKER_NAME} (it opens its conversation, no "--- the agent's reply ---" left in the text); pressing the line opens the brief with its paragraph "The agent has gone on since this reply" and the transcript path in it`,
                        folded?.brief != null && folded.brief.open === false &&
                            folded.brief.line.includes(`arcterm made this agent the judge of ${WORKER_NAME}`) &&
                            older.msgs.length === 1 && card != null && card.name === WORKER_NAME && card.link &&
                            card.text.includes("Swapped: O2 now locks the threshold") &&
                            pressed === true && ok && t != null &&
                            t.text.includes("The agent has gone on since this reply") && t.text.includes(".jsonl") &&
                            !t.text.includes("--- the agent's reply ---") && !t.text.includes("--- end of the reply ---"),
                        { folded: folded?.brief, text: t?.text, card: card?.text, msgs: older?.msgs.length }
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
                await step("close the fixture tabs", () => closeTabs(h, ctx));
                await step("remove the fixture transcripts", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
