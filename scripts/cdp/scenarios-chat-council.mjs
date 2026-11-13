// The council the agent started and the Doc review it asks, as cards in Chat
// (docs/superpowers/specs/2026-11-14-chat-council-design.md, plan 2026-11-14-chat-council.md Task 5).
// Chat draws a council the agent started with `wsh council start` as a card at the end of the conversation while it runs,
// waits on you after round 1, or is queued, and as a one-line row at the start call once it ended; a Doc review ask is a
// card in the dock while it waits and one row in place once answered. It is written against the plan's DOM contract, not
// against the components:
//   council card   [data-chat-bscard-kind="council"][data-chat-council="<id>"][data-chat-council-state="running|awaiting|queued"]
//                  in a [data-chat-council-tail] wrapper at the end of the conversation; the shell's data-chat-bscard-state
//                  (working: running or queued, waiting: awaiting, static: the agent exited) and [data-chat-bscard-tag] (the
//                  council's word); [data-chat-council-open], [data-chat-council-stop], [data-chat-council-continue],
//                  [data-chat-council-seat="<expert>"][data-seat-state="done|working|waiting"], [data-chat-council-round],
//                  [data-chat-council-elapsed], [data-chat-council-estimate], [data-chat-council-queued],
//                  [data-chat-council-error]
//   council row    [data-chat-bscard-done="council"][data-chat-council-row="<id>"][data-chat-council-end="done|stopped|failed|not-run|running"]
//                  in the [data-chat-item] that holds the call, with [data-chat-council-report] (Open report) or
//                  [data-chat-council-open], and its mark in [data-chat-bscard-mark]
//   Doc review     [data-chat-bscard-kind="docreview"][data-chat-bscard-state="waiting|static"] with [data-chat-drcard-path],
//   card           -pages, -intro, -item, -review, -approve and -note; in the dock's [data-chat-ask] while the agent waits
//   Doc review row [data-chat-bscard-done="docreview"][data-chat-drcard-outcome="approved|changes"]
//
// One fixture Claude agent over a real tab with a shell controller (the shell's folder is the project, so the Doc review's
// file shows relative to it), a mock roster row for it, a throwaway git project registered with the app, and a fixture
// transcript the steps append to the way Claude Code writes it (scenarios-chat-verdict-handoff.mjs has the same
// base). The councils are JSON files written into the data dir the way ./council/fixtures.mjs does it, each under an id of its
// own and moved through the states a step needs; `council:changed` makes the page reload one it knows, and a step
// starts by deleting the councils of the step before it, so the end of the conversation holds only what the step wrote. CouncilStopCommand,
// CouncilContinueCommand and AnswerAgentCommand are stubbed in the page (stubRpc): no council, model or agent is touched.
//
// A sub-step (1b, 1c, 7a, 7b) has its own shot and its own assert, and starts by writing the state it needs, so a failed
// step does not take the next with it.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import * as CF from "./council/fixtures.mjs";

const NAME = "chat council main";
const PROJECT = "verify-chat-council";
const SESSION = "chat-council-main";
const HINTS_KEY = "brainstorm.hintsSeen";
const WAIT_MS = 15000;
const SHORT_MS = 5000;

// the council ids: one per step, so a step never meets the council of the one before it. A council file the other council
// scenarios clear is one that starts with `fx-council-`, so a run that died leaves nothing a later one trips on
const ID = {
    running: "fx-council-chat-running",
    exited: "fx-council-chat-exited",
    refused: "fx-council-chat-refused",
    paused: "fx-council-chat-paused",
    queued: "fx-council-chat-queued",
    holder: "fx-council-chat-holder",
    done: "fx-council-chat-done",
    stopped: "fx-council-chat-stopped",
    failed: "fx-council-chat-failed",
    notrun: "fx-council-chat-notrun",
    again: "fx-council-chat-again",
};
const FEATURE = "Rail apps";
const HOLDER_FEATURE = "Sync retry policy";
const QUESTION = "Which changes to pinned apps on the nav rail are worth making first?";
// the cost the start line quotes (cmd/wsh/cmd/wshcmd-council.go councilStartedLine)
const ESTIMATE = "≈ 14 calls · ~0.9M tokens";
const STOPPED_ERROR = "Stopped by you while the seats were replying.";
const FAILED_ERROR = "The synthesis failed: the coordinator's reply was not valid JSON.";
const REFUSAL_FIRST = "this council would use about 1.8M tokens, over the 1M the Token burn gate lets an agent start";
const REFUSAL = `Not run: ${REFUSAL_FIRST}. Start it from the app if you want it.`;
const STOP_ERROR = "the council is not running any more";

// the Doc review's options, as the skill asks them: Approve first, then Request changes
const DR_OPTIONS = [
    { label: "Approve", description: "The section reads well." },
    { label: "Request changes", description: "Comment on the passages in the review view." },
];
const DR_INTRO = "The retry section now says why the loop stops after five attempts.";
const DR_ITEMS = ["§3.2 Retry policy: rewritten to name the cap", "§4 Results: new table for the backoff run"];

// the answer the review view sends for two comments (proseanchor.ts formatRequest)
const CHANGES_ANSWER = [
    "Request changes",
    '1. [Method ¶3] "We train for ten epochs."',
    "   Say why ten.",
    '2. [Results ¶1] "The model wins."',
    "   By how much?",
    "General: tighten the abstract.",
].join("\n");

// --- page expressions -----------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const scrollerOf = (id) => `document.querySelector('[data-agent-chat="${id}"] .overflow-y-auto')`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
// helpers every reading shares: a node or one inside it, a button's text and off state, an attribute of either
const HELP = `
const flat = ${FLAT};
const pick = (el, sel) => (el ? (el.matches(sel) ? el : el.querySelector(sel)) : null);
const btn = (root, sel) => { const e = pick(root, sel); return e ? { text: flat(e), disabled: e.disabled === true } : null; };
const attr = (root, sel, name) => pick(root, sel)?.getAttribute(name) ?? null;
`;

const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, GRID_KEY, GRID_EMPTY, bsSeeHints } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", HINTS_KEY];

    // a record's time: real time, strictly after the one before, so the transcript reads in the order it was written
    const stamp = (ctx) => {
        ctx.last = Math.max((ctx.last ?? 0) + 1, Date.now());
        return { cwd: ctx.cwd, ts: new Date(ctx.last).toISOString() };
    };
    const append = (ctx, ...lines) => appendFileSync(ctx.transcript, lines.join("\n") + "\n");

    // the roster row of the one agent: idle since `ctx.idleSince`, or asking `ctx.ask` (a Doc review) with no idle stamp
    const rosterRows = (ctx) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: ctx.ask != null ? "asking" : "idle",
            ...(ctx.ask != null ? { blockedMs: 30_000, ask: ctx.ask } : { idleSince: ctx.idleSince }),
            usage: { contextpct: 42 },
            id: ctx.tab.tabId,
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
        },
    ];

    const scenario = {
        name: "chat-council",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-cc-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-cc-project-")),
                prev: {},
                idleSince: Date.now() - 60_000,
                ask: null,
                turns: 0,
                ids: new Set(),
                exited: false,
            };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                ctx.prevRail = await AC.agentPage(h, `const R = await mod("app/view/agents/railstore.ts"); return globalStore.get(R.railVisibleAtom);`);

                at = "making the project";
                const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.cwd, "README.md"), "# paper\n");
                // the file the Review step opens: committed, then changed, so the review view has a diff to show
                ctx.outline = join(ctx.cwd, "notes", "outline.md");
                mkdirSync(dirname(ctx.outline), { recursive: true });
                writeFileSync(ctx.outline, "# Outline\n\nThe sync client retries a failed request.\n");
                git("add", ".");
                git("commit", "-qm", "seed");
                writeFileSync(ctx.outline, "# Outline\n\nThe sync client retries a failed request.\n\nIt gives up after five attempts.\n");
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);
                ctx.dataDir = (await h.rpc("waveinfo", null)).datadir;
                // what CF.writeCouncil / announceCouncil read of a ctx: where the councils go, which project, what was written
                ctx.cf = { dataDir: ctx.dataDir, repo: ctx.cwd, written: {} };

                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.cwd, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 3; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the paper work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. The paper describes the sync client, and each section says what it measured.`, o(i * 10 + 2)));
                }
                ctx.transcript = AC.writeTranscript(ctx.dir, SESSION, lines);
                ctx.last = Date.now();

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                // the Brainstorm pane's first-open hint card is not what this scenario reads
                if (typeof bsSeeHints === "function") await bsSeeHints(h);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tab";
                // a shell controller in the project's folder: the card reads the agent's folder from it
                ctx.tab = await makeTab(h, ctx, {
                    label: NAME,
                    blockMeta: { view: "term", controller: "shell", "cmd:cwd": ctx.cwd, "agent:transcriptpath": ctx.transcript },
                });

                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));

                at = "stubbing the commands";
                // Stop, Continue and Approve are recorded in the page and answered with nothing; no council is stopped, no
                // agent gets an answer
                await CF.stubRpc(h, ["CouncilStopCommand", "CouncilContinueCommand", "AnswerAgentCommand"]);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent, its project and its transcript", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tab.tabId;
            // a step that throws is a failed step, not the end of the run: the ones after it start from their own state
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            const shot = async (name) => {
                try {
                    await h.shot(`cdp-shots/chat-council-${name}.png`);
                } catch (e) {
                    console.error(`chat-council: the shot ${name} failed: ${e?.message ?? e}`);
                }
            };
            const scrollEnd = async () => {
                await h.ev(`(() => { const s = ${scrollerOf(A)}; if (s) s.scrollTop = s.scrollHeight; return true; })()`);
                await polishNap(300);
            };
            const until = async (fn, ms = WAIT_MS) => {
                for (let waited = 0; waited < ms; waited += 250) {
                    if (await fn()) return true;
                    await polishNap(250);
                }
                return false;
            };
            const exitAgent = (status, code) =>
                h.rpc("eventpublish", {
                    event: "controllerstatus",
                    scopes: [`block:${ctx.tab.blockId}`],
                    data: { blockid: ctx.tab.blockId, shellprocstatus: status, shellprocexitcode: code },
                });
            // the agent's side: whether its turn has ended (idle since now) and the Doc review it is waiting on, if any
            const setAgent = async ({ ends = false, ask } = {}) => {
                if (ask !== undefined) ctx.ask = ask;
                if (ends) ctx.idleSince = Date.now();
                await AC.setRoster(h, rosterRows(ctx));
            };
            // a click on an element of the layer: "clicked", "missing" or "disabled"
            const click = (sel) =>
                h.ev(`(() => {
                    const el = ${layerOf(A)}?.querySelector(${JSON.stringify(sel)});
                    if (!el) return "missing";
                    if (el.disabled) return "disabled";
                    el.click();
                    return "clicked";
                })()`);

            // --- the councils ---
            // a fixture council under `id`, written for a conversation that has `byagent` set (wsh council start's), and the
            // page told; a council the page knows reloads, one it does not is read when a card names it
            const putCouncil = async (name, id, edit) => {
                ctx.ids.add(id);
                CF.writeCouncil(ctx.cf, name, {
                    id,
                    edit: (c) => {
                        c.byagent = true;
                        c.mode = "review";
                        edit?.(c);
                    },
                });
                await CF.announceCouncil(h, ctx.cf, id);
                return id;
            };
            // every council the steps before wrote goes: the file, and the page's copy (deleted: true), so their cards and rows
            // leave the conversation and the end of it holds only what the step writes. A not-run line still draws its row
            // from the anchor alone, which is why the steps read a row by its council's id
            const dropCouncils = async () => {
                for (const id of [...ctx.ids]) {
                    rmSync(join(ctx.dataDir, "councils", `${id}.json`), { force: true });
                    await h.rpc("eventpublish", { event: "council:changed", data: { id, project: ctx.cwd, deleted: true } });
                    ctx.ids.delete(id);
                    delete ctx.cf.written[id];
                }
            };
            const calls = async (name) => (await CF.rpcCalls(h, name)) ?? [];

            // --- the transcript ---
            const say = (text) => append(ctx, AC.assistantText(text, stamp(ctx)));
            const said = (text) => append(ctx, AC.userText(text, stamp(ctx)));
            const startCall = (callId, output, feature = FEATURE) => {
                const command = `wsh council start --feature "${feature}" --question "${QUESTION}"`;
                return [
                    AC.toolUse(callId, "Bash", { command, description: "Start the council" }, stamp(ctx)),
                    AC.toolResult(callId, output, stamp(ctx)),
                ];
            };
            // what `wsh council start` prints (cmd/wsh/cmd/wshcmd-council.go): the started line, the queued line, the refusal
            const startedOut = (id, estimate = ESTIMATE) =>
                [`council ${id} started: ${FEATURE} · review · ui-feature · 4 experts · ${estimate}`, `Read it back with: wsh council wait ${id}`, ""].join("\n");
            const queuedOut = (id, holderId) => `Queued after ${holderId} (${HOLDER_FEATURE}) · council ${id} starts by itself when it ends\n`;
            const notRunOut = (id) => `${REFUSAL}\ncouncil ${id} saved as not run; Start council in the app runs it\n`;
            // a turn: the person's line, the agent's words before the call (unique, so the row's item can be found by it)
            const turn = (line, marker) => {
                said(line);
                say(marker);
            };

            // --- waits and readings ---
            const cardSel = (id) => `[data-chat-bscard-kind="council"][data-chat-council="${id}"]`;
            const rowSel = (id, end) => `[data-chat-bscard-done="council"][data-chat-council-row="${id}"]${end != null ? `[data-chat-council-end="${end}"]` : ""}`;
            const waitSel = (sel, ms = WAIT_MS) => polishWaitFor(h, `!!${layerOf(A)}?.querySelector(${JSON.stringify(sel)})`, ms);
            const noSel = (sel, ms = WAIT_MS) => polishWaitFor(h, `!${layerOf(A)}?.querySelector(${JSON.stringify(sel)})`, ms);
            const waitText = (text, ms = WAIT_MS) => polishWaitFor(h, `(${layerOf(A)}?.textContent ?? "").includes(${JSON.stringify(text)})`, ms);

            // a step starts here: the councils of the step before are gone and have left, the agent is there and not asking
            const begin = async () => {
                await dropCouncils();
                if (ctx.exited) {
                    await exitAgent("running", 0);
                    ctx.exited = false;
                }
                await setAgent({ ask: null, ends: true });
                // the Chat, not a council's report or the review view the step before opened
                await AC.agentPage(
                    h,
                    `const C = await mod("app/view/agents/agentcenter.ts");
                    const S = await mod("app/view/agents/docreviewstore.ts");
                    S.setDocReviewMode(${JSON.stringify(A)}, "terminal", Date.now());
                    C.showTerminal();
                    return true;`
                );
                await AC.focusAgent(h, A);
                await noSel("[data-chat-council-tail]", SHORT_MS);
            };

            // the council card as it is drawn now
            const readCard = (id) =>
                h.ev(`(() => {
                    ${HELP}
                    const layer = ${layerOf(A)};
                    const card = layer?.querySelector(${JSON.stringify(cardSel(id))});
                    const items = layer?.querySelectorAll("[data-chat-item]") ?? [];
                    const last = items[items.length - 1] ?? null;
                    const tail = card?.closest("[data-chat-council-tail]") ?? null;
                    return {
                        found: !!card,
                        tails: layer?.querySelectorAll("[data-chat-council-tail]").length ?? 0,
                        cards: layer?.querySelectorAll('[data-chat-bscard-kind="council"]').length ?? 0,
                        inTail: !!tail,
                        afterConversation: tail && last ? !!(last.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
                        state: card?.getAttribute("data-chat-council-state") ?? null,
                        shell: card?.getAttribute("data-chat-bscard-state") ?? null,
                        head: flat(pick(card, "[data-chat-bscard-head]")),
                        tag: flat(pick(card, "[data-chat-bscard-tag]")),
                        title: flat(pick(card, "[data-chat-council-title]")),
                        question: flat(pick(card, "[data-chat-council-question]")),
                        line: flat(pick(card, "[data-chat-council-line]")),
                        round: flat(pick(card, "[data-chat-council-round]")),
                        elapsed: flat(pick(card, "[data-chat-council-elapsed]")),
                        estimate: flat(pick(card, "[data-chat-council-estimate]")),
                        queued: flat(pick(card, "[data-chat-council-queued]")),
                        error: flat(pick(card, "[data-chat-council-error]")),
                        seats: [...(card?.querySelectorAll("[data-chat-council-seat]") ?? [])].map((s) => ({
                            id: s.getAttribute("data-chat-council-seat"),
                            state: s.getAttribute("data-seat-state"),
                        })),
                        stop: btn(card, "[data-chat-council-stop]"),
                        cont: btn(card, "[data-chat-council-continue]"),
                        open: btn(card, "[data-chat-council-open]"),
                    };
                })()`);
            // the row of a council that ended, with the item it is drawn in
            const readRow = (id) =>
                h.ev(`(() => {
                    ${HELP}
                    const layer = ${layerOf(A)};
                    const row = layer?.querySelector(${JSON.stringify(rowSel(id))});
                    const item = row?.closest("[data-chat-item]") ?? null;
                    return {
                        found: !!row,
                        end: row?.getAttribute("data-chat-council-end") ?? null,
                        text: flat(row),
                        mark: pick(row, "[data-chat-bscard-mark]") ? flat(pick(row, "[data-chat-bscard-mark]")) : null,
                        report: btn(row, "[data-chat-council-report]"),
                        open: btn(row, "[data-chat-council-open]"),
                        item: flat(item),
                        inAgentColumn: !!row?.closest("[data-chat-agent]"),
                        tails: layer?.querySelectorAll("[data-chat-council-tail]").length ?? 0,
                        cards: layer?.querySelectorAll('[data-chat-bscard-kind="council"]').length ?? 0,
                    };
                })()`);

            const seatMap = (card) => card.seats.map((s) => `${s.id}:${s.state}`).join(",");

            // 1. the running council: the call, then the card at the end with the seats, the step, the clock, the estimate, Stop
            await run("1. running council", async (name) => {
                await begin();
                // the council is written before the call is, so the first read of it finds it
                await putCouncil("round1", ID.running);
                turn("ask a council which rail changes come first", "Starting the rail apps council for step 1.");
                append(ctx, ...startCall("toolu_cc_run", startedOut(ID.running)));
                say("The council is running. I will wait for it.");
                await setAgent({ ends: true });
                const up = await waitSel(cardSel(ID.running));
                await polishNap(600);
                await scrollEnd();
                const card = await readCard(ID.running);
                await shot("1-running");
                // Stop records one command with the council's id and goes dead until the council changes
                const before = (await calls("CouncilStopCommand")).length;
                const clicked = await click("[data-chat-council-stop]");
                const recorded = await until(async () => (await calls("CouncilStopCommand")).length > before, SHORT_MS);
                const dead = await until(async () => (await readCard(ID.running)).stop?.disabled === true, SHORT_MS);
                const second = await click("[data-chat-council-stop]");
                await polishNap(400);
                const stops = (await calls("CouncilStopCommand")).slice(before);
                await shot("1-stopped-pressed");
                rec(
                    `${name}: the card is in [data-chat-council-tail] after the last item, state running and working, "${FEATURE}" with its question, seats ux and newuser done and ram and skeptic working, the step "Round 1 of N", the elapsed time, "${ESTIMATE}", Stop and Open council; Stop records one CouncilStopCommand with the council's id and goes dead`,
                    up &&
                        card.found &&
                        card.inTail &&
                        card.afterConversation === true &&
                        card.tails === 1 &&
                        card.state === "running" &&
                        card.shell === "working" &&
                        card.head === "Council · review" &&
                        card.title === FEATURE &&
                        card.question.includes("Which changes to pinned apps") &&
                        seatMap(card) === "ux:done,ram:working,newuser:done,skeptic:working" &&
                        /^Round 1 of \d$/.test(card.round) &&
                        card.tag.includes(card.round) &&
                        /^(\d+ min( \d+ s)?|\d+ s)$/.test(card.elapsed) &&
                        card.estimate === ESTIMATE &&
                        card.stop?.disabled === false &&
                        card.open != null &&
                        card.cont == null &&
                        clicked === "clicked" &&
                        recorded &&
                        dead &&
                        second === "disabled" &&
                        stops.length === 1 &&
                        stops[0].data?.id === ID.running,
                    { up, card, clicked, recorded, dead, second, stops }
                );
            });

            // 1b. the same running council, the agent gone: static, the step still in the header, Open council kept, no Stop
            await run("1b. static running council", async (name) => {
                await begin();
                await putCouncil("round1", ID.exited);
                turn("ask a council which rail changes come first", "Starting the rail apps council for step 1b.");
                append(ctx, ...startCall("toolu_cc_exited", startedOut(ID.exited)));
                say("The council is running. I will wait for it.");
                await setAgent({ ends: true });
                const live = await waitSel(`${cardSel(ID.exited)}[data-chat-bscard-state="working"]`);
                await exitAgent("done", 1);
                ctx.exited = true;
                const isStatic = await waitSel(`${cardSel(ID.exited)}[data-chat-bscard-state="static"]`);
                await polishNap(600);
                await scrollEnd();
                const card = await readCard(ID.exited);
                await shot("1b-static");
                await exitAgent("running", 0);
                ctx.exited = false;
                rec(
                    `${name}: once the agent has exited the card is state static, its header still reads the step "Round 1 of N", Open council is kept and there is no Stop`,
                    live &&
                        isStatic &&
                        card.shell === "static" &&
                        card.state === "running" &&
                        /^Round 1 of \d$/.test(card.round) &&
                        card.tag.includes(card.round) &&
                        card.open != null &&
                        card.stop == null &&
                        card.cont == null,
                    { live, isStatic, card }
                );
            });

            // 1c. a Stop wavesrv refuses: its reason on the card, the card as it was
            await run("1c. failed Stop", async (name) => {
                await begin();
                await putCouncil("round1", ID.refused);
                turn("ask a council which rail changes come first", "Starting the rail apps council for step 1c.");
                append(ctx, ...startCall("toolu_cc_refused", startedOut(ID.refused)));
                say("The council is running. I will wait for it.");
                await setAgent({ ends: true });
                const up = await waitSel(cardSel(ID.refused));
                await polishNap(500);
                await CF.stubRpc(h, ["CouncilStopCommand"], { CouncilStopCommand: { reject: STOP_ERROR } });
                try {
                    const before = (await calls("CouncilStopCommand")).length;
                    const clicked = await click("[data-chat-council-stop]");
                    const failed = await waitSel(`${cardSel(ID.refused)} [data-chat-council-error]`, SHORT_MS);
                    await polishNap(400);
                    await scrollEnd();
                    const card = await readCard(ID.refused);
                    await shot("1c-stop-failed");
                    const stops = (await calls("CouncilStopCommand")).slice(before);
                    rec(
                        `${name}: Stop refused shows "Stop failed: ${STOP_ERROR}" in [data-chat-council-error] and the card stays as it was: still running, its seats and Stop (live again) in place`,
                        up &&
                            clicked === "clicked" &&
                            failed &&
                            stops.length === 1 &&
                            card.error === `Stop failed: ${STOP_ERROR}` &&
                            card.state === "running" &&
                            card.shell === "working" &&
                            card.seats.length === 4 &&
                            card.stop?.disabled === false,
                        { up, clicked, failed, stops: stops.length, card }
                    );
                } finally {
                    await CF.stubRpc(h, ["CouncilStopCommand"], { CouncilStopCommand: {} });
                }
            });

            // 2. paused after round 1: Waiting on you, the experts and ideas, Continue and Stop; Continue records the council's id
            await run("2. paused after round 1", async (name) => {
                await begin();
                await putCouncil("awaiting", ID.paused, (c) => {
                    c.pauseafterround1 = true;
                });
                turn("ask a council which rail changes come first", "Starting the rail apps council for step 2.");
                append(ctx, ...startCall("toolu_cc_paused", startedOut(ID.paused)));
                say("The council paused after round 1. I will wait for you.");
                await setAgent({ ends: true });
                const up = await waitSel(cardSel(ID.paused));
                await polishNap(600);
                await scrollEnd();
                const card = await readCard(ID.paused);
                await shot("2-paused");
                const before = (await calls("CouncilContinueCommand")).length;
                const clicked = await click("[data-chat-council-continue]");
                const recorded = await until(async () => (await calls("CouncilContinueCommand")).length > before, SHORT_MS);
                await polishNap(400);
                const after = await readCard(ID.paused);
                const continues = (await calls("CouncilContinueCommand")).slice(before);
                await shot("2-continue-pressed");
                rec(
                    `${name}: the card is state awaiting and waiting, its header reads "Waiting on you", the line says "Paused after round 1 · 4 experts sent 6 ideas", Continue and Stop are live; Continue records one CouncilContinueCommand with the council's id`,
                    up &&
                        card.inTail &&
                        card.state === "awaiting" &&
                        card.shell === "waiting" &&
                        card.tag === "Waiting on you" &&
                        card.line.includes("Paused after round 1 · 4 experts sent 6 ideas") &&
                        card.cont?.text === "Continue" &&
                        card.cont.disabled === false &&
                        card.stop?.text === "Stop" &&
                        card.stop.disabled === false &&
                        card.seats.length === 0 &&
                        card.open != null &&
                        clicked === "clicked" &&
                        recorded &&
                        continues.length === 1 &&
                        continues[0].data?.id === ID.paused &&
                        after.cont?.disabled === true,
                    { up, card, clicked, recorded, continues, afterContinue: after.cont }
                );
            });

            // 3. queued: a card naming the council it waits for; the holder is a council no call here names, so it draws none
            await run("3. queued council", async (name) => {
                await begin();
                await putCouncil("round1", ID.holder, (c) => {
                    c.feature = HOLDER_FEATURE;
                });
                await putCouncil("round1", ID.queued, (c) => {
                    c.state = "queued";
                    c.queuedafter = ID.holder;
                    c.round = 0;
                    c.proposals = [];
                    c.stats = {};
                    delete c.activity;
                    delete c.started;
                });
                turn("ask a council about the queue too", "Starting the queued council for step 3.");
                append(ctx, ...startCall("toolu_cc_queued", queuedOut(ID.queued, ID.holder)));
                say("It is queued; it starts by itself when the one before it ends.");
                await setAgent({ ends: true });
                const up = await waitSel(cardSel(ID.queued));
                // the holder is read by the card once it shows
                const named = await polishWaitFor(h, `(${FLAT}(${layerOf(A)}?.querySelector("[data-chat-council-queued]"))).includes(${JSON.stringify(HOLDER_FEATURE)})`, WAIT_MS);
                await polishNap(500);
                await scrollEnd();
                const card = await readCard(ID.queued);
                const holderCards = await h.ev(`${layerOf(A)}?.querySelectorAll('[data-chat-council="${ID.holder}"]').length ?? 0`);
                await shot("3-queued");
                rec(
                    `${name}: the queued card is state queued and working, its header reads "Queued after "${HOLDER_FEATURE}" · starts by itself" and holds Open council with no Stop, no seats and no round; the running council it waits for draws no card here`,
                    up &&
                        named &&
                        card.inTail &&
                        card.state === "queued" &&
                        card.shell === "working" &&
                        card.queued === `Queued after "${HOLDER_FEATURE}" · starts by itself` &&
                        card.tag.includes("starts by itself") &&
                        card.open != null &&
                        card.stop == null &&
                        card.cont == null &&
                        card.seats.length === 0 &&
                        card.round === "" &&
                        holderCards === 0 &&
                        card.cards === 1 &&
                        card.tails === 1,
                    { up, named, card, holderCards }
                );
            });

            // 4. done: no card at the end, the ✓ row at the call with the mode, the count, the time and Open report
            await run("4. done council", async (name) => {
                await begin();
                await putCouncil("done", ID.done);
                const marker = "Starting the rail apps council for step 4.";
                turn("ask a council which rail changes come first", marker);
                append(ctx, ...startCall("toolu_cc_done", startedOut(ID.done)));
                say("The council is done. Here is what it found.");
                await setAgent({ ends: true });
                const up = await waitSel(rowSel(ID.done, "done"));
                const noTail = await noSel("[data-chat-council-tail]", SHORT_MS);
                await polishNap(500);
                await scrollEnd();
                const row = await readRow(ID.done);
                await shot("4-done-row");
                // Open report opens the council's report view
                const clicked = await click(`${rowSel(ID.done)} [data-chat-council-report]`);
                const shown = await polishWaitFor(h, `!!document.querySelector("[data-council-summary]")`, WAIT_MS);
                const view = await AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/councilstore.ts");
                    return { sel: globalStore.get(S.councilSelAtom), view: globalStore.get(S.councilViewAtom) };`
                );
                await polishNap(500);
                await shot("4-report-open");
                // back to the Chat for the steps after
                await AC.agentPage(h, `const C = await mod("app/view/agents/agentcenter.ts"); C.showTerminal(); return true;`);
                await AC.focusAgent(h, A);
                rec(
                    `${name}: no card at the end; the row at the start call's item reads "Council · review · 4 directions · 11 min", "${FEATURE}" and Open report, with the ✓ and no mark glyph; clicking Open report shows the report view of the council`,
                    up &&
                        noTail &&
                        row.found &&
                        row.end === "done" &&
                        row.tails === 0 &&
                        row.cards === 0 &&
                        row.inAgentColumn &&
                        row.item.includes(marker) &&
                        row.text.includes("Council · review · 4 directions · 11 min") &&
                        row.text.includes(FEATURE) &&
                        row.mark === null &&
                        row.report?.text === "Open report" &&
                        row.open == null &&
                        clicked === "clicked" &&
                        shown &&
                        view.sel === ID.done &&
                        view.view === "summary",
                    { up, noTail, row, clicked, shown, view }
                );
            });

            // 5. stopped, failed and not run: three calls, three councils, each row with its mark, what happened and the reason
            await run("5. stopped, failed and not run", async (name) => {
                await begin();
                await putCouncil("round2", ID.stopped, (c) => {
                    c.state = "stopped";
                    c.round = 2;
                    c.error = STOPPED_ERROR;
                    delete c.activity;
                });
                await putCouncil("failed", ID.failed);
                await putCouncil("notrun", ID.notrun);
                // each call has its own words before it, so each row's item is found by them
                const markers = ["Starting the first council for step 5.", "Starting the second council for step 5.", "Starting the third council for step 5."];
                said("ask three councils about the rail");
                say(markers[0]);
                append(ctx, ...startCall("toolu_cc_stopped", startedOut(ID.stopped)));
                say(markers[1]);
                append(ctx, ...startCall("toolu_cc_failed", startedOut(ID.failed)));
                say(markers[2]);
                append(ctx, ...startCall("toolu_cc_notrun", notRunOut(ID.notrun)));
                say("That is all three.");
                await setAgent({ ends: true });
                const up = await waitSel(rowSel(ID.stopped, "stopped"));
                const upFailed = await waitSel(rowSel(ID.failed, "failed"));
                const upNotRun = await waitSel(rowSel(ID.notrun, "not-run"));
                const noTail = await noSel("[data-chat-council-tail]", SHORT_MS);
                await polishNap(500);
                await scrollEnd();
                const stopped = await readRow(ID.stopped);
                const failed = await readRow(ID.failed);
                const notRun = await readRow(ID.notrun);
                await shot("5-ended-rows");
                // each row sits in the item that holds its own call
                const inItem = [stopped, failed, notRun].every((r, i) => r.item.includes(markers[i]));
                rec(
                    `${name}: three rows at their calls, no card at the end: ■ "Council · stopped in round 2" with "${STOPPED_ERROR}", ! "Council · failed in round 3" with the council's error, – "Council · not run" with the refusal's first sentence, each with Open council and no Open report`,
                    up &&
                        upFailed &&
                        upNotRun &&
                        noTail &&
                        inItem &&
                        stopped.mark === "■" &&
                        stopped.text.includes("Council · stopped in round 2") &&
                        stopped.text.includes(STOPPED_ERROR) &&
                        failed.mark === "!" &&
                        failed.text.includes("Council · failed in round 3") &&
                        failed.text.includes(FAILED_ERROR) &&
                        notRun.mark === "–" &&
                        notRun.text.includes("Council · not run") &&
                        notRun.text.includes(REFUSAL_FIRST) &&
                        [stopped, failed, notRun].every((r) => r.open?.text === "Open council" && r.report == null && r.tails === 0 && r.cards === 0),
                    { up, upFailed, upNotRun, noTail, inItem, stopped, failed, notRun }
                );
            });

            // 6. running again after done: the row stays at its call and reads running again; no card comes back at the end
            await run("6. running again", async (name) => {
                await begin();
                // done first, as a brainstorm: its row counts ideas
                await putCouncil("done", ID.again, (c) => {
                    c.mode = "brainstorm";
                });
                const marker = "Starting the rail apps council for step 6.";
                turn("ask a council which rail changes come first", marker);
                append(ctx, ...startCall("toolu_cc_again", startedOut(ID.again)));
                say("The council is done. Here is what it found.");
                await setAgent({ ends: true });
                const done = await waitSel(rowSel(ID.again, "done"));
                await polishNap(400);
                await scrollEnd();
                const first = await readRow(ID.again);
                await shot("6-done-before");
                // a follow-up: the council runs again with its summary kept
                await putCouncil("done", ID.again, (c) => {
                    c.mode = "brainstorm";
                    c.state = "running";
                });
                const again = await waitSel(rowSel(ID.again, "running"));
                await polishNap(500);
                await scrollEnd();
                const row = await readRow(ID.again);
                await shot("6-running-again");
                rec(
                    `${name}: the done brainstorm reads "Council · brainstorm · 4 ideas · 11 min"; once it runs again (a summary kept) the same row reads "Council · running again", keeps Open council and its place at the call, and no card comes back at the end`,
                    done &&
                        first.found &&
                        first.text.includes("Council · brainstorm · 4 ideas · 11 min") &&
                        first.report != null &&
                        again &&
                        row.found &&
                        row.end === "running" &&
                        row.text.includes("Council · running again") &&
                        row.open?.text === "Open council" &&
                        row.report == null &&
                        row.item.includes(marker) &&
                        row.tails === 0 &&
                        row.cards === 0,
                    { done, first, again, row }
                );
            });

            // --- the Doc review ---
            const drPath = (...rel) => join(ctx.cwd, ...rel);
            const drQuestion = (path) => ({
                question: [path, DR_INTRO, "Pages: 12", ...DR_ITEMS.map((i) => `- ${i}`)].join("\n"),
                header: "Doc review",
                multiSelect: false,
                options: DR_OPTIONS,
            });
            // the ask the roster holds while the agent waits: it needs its id and the agent's oref to be answered
            const drAsk = (askId, q) => ({ askId, oref: `block:${ctx.tab.blockId}`, questions: [q] });
            const askCall = (callId, q) => AC.toolUse(callId, "AskUserQuestion", { questions: [q] }, stamp(ctx));
            // the answer the agent receives: a picked label, or the text typed under "Other"
            const answered = (callId, q, answer) =>
                AC.toolResult(callId, `User has answered your questions: "${q.question}"="${answer}". You can now continue with the user's answers in mind.`, {
                    toolUseResult: { questions: [q], answers: { [q.question]: answer } },
                    ...stamp(ctx),
                });
            const readDocReview = () =>
                h.ev(`(() => {
                    ${HELP}
                    const layer = ${layerOf(A)};
                    const all = [...(layer?.querySelectorAll('[data-chat-bscard-kind="docreview"]') ?? [])];
                    const card = all[0] ?? null;
                    return {
                        cards: all.length,
                        dock: !!layer?.querySelector("[data-chat-ask]"),
                        inDock: !!card?.closest("[data-chat-ask]"),
                        state: card?.getAttribute("data-chat-bscard-state") ?? null,
                        path: flat(pick(card, "[data-chat-drcard-path]")),
                        pages: flat(pick(card, "[data-chat-drcard-pages]")),
                        intro: flat(pick(card, "[data-chat-drcard-intro]")),
                        items: [...(card?.querySelectorAll("[data-chat-drcard-item]") ?? [])].map((e) => flat(e)),
                        review: btn(card, "[data-chat-drcard-review]"),
                        approve: btn(card, "[data-chat-drcard-approve]"),
                        note: flat(pick(card, "[data-chat-drcard-note]")),
                    };
                })()`);
            const readDocRows = () =>
                h.ev(`(() => {
                    ${HELP}
                    return [...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="docreview"]') ?? [])].map((r) => ({
                        outcome: r.getAttribute("data-chat-drcard-outcome"),
                        text: flat(r),
                        mark: pick(r, "[data-chat-bscard-mark]") ? flat(pick(r, "[data-chat-bscard-mark]")) : null,
                    }));
                })()`);
            const waitDocRow = (needle, ms = WAIT_MS) =>
                polishWaitFor(h, `[...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="docreview"]') ?? [])].some((e) => ${FLAT}(e).includes(${JSON.stringify(needle)}))`, ms);
            // a Doc review the agent asks and waits on: the call in the transcript and the ask on the roster
            const startDocReview = async (callId, askId, q, marker) => {
                turn("review the section when it is ready", marker);
                append(ctx, askCall(callId, q));
                await setAgent({ ask: drAsk(askId, q) });
                await AC.focusAgent(h, A);
            };
            // the first line of the card's file as the card shows it: relative to the agent's folder once it is known
            const waitDocPath = (rel) =>
                polishWaitFor(h, `(${FLAT}(${layerOf(A)}?.querySelector('[data-chat-bscard-kind="docreview"] [data-chat-drcard-path]'))) === ${JSON.stringify(rel)}`, WAIT_MS);
            const bubbles = (needle) =>
                h.ev(`(() => {
                    ${HELP}
                    return [...(${layerOf(A)}?.querySelectorAll("[data-chat-you]") ?? [])].filter((e) => flat(e).includes(${JSON.stringify(needle)})).length;
                })()`);

            // 7. a Doc review waiting: the card in the dock with the file, the pages, the items, Review, Approve and the note; Approve answers
            await run("7. Doc review waiting", async (name) => {
                await begin();
                const file = drPath("sections", "method.tex");
                const q = drQuestion(file);
                await startDocReview("toolu_cc_dr1", "cc-ask-1", q, "Reviewing the method section for step 7.");
                const up = await waitSel('[data-chat-ask] [data-chat-bscard-kind="docreview"]');
                const pathUp = await waitDocPath("sections/method.tex");
                await polishNap(500);
                await scrollEnd();
                const card = await readDocReview();
                await shot("7-docreview-waiting");
                // Approve answers the ask with the agent's own Approve option, once
                const before = (await calls("AnswerAgentCommand")).length;
                const clicked = await click("[data-chat-drcard-approve]");
                const recorded = await until(async () => (await calls("AnswerAgentCommand")).length > before, SHORT_MS);
                await polishNap(400);
                const after = await readDocReview();
                const answers = (await calls("AnswerAgentCommand")).slice(before);
                await shot("7-approve-pressed");
                // the agent takes the answer: the ask is over
                append(ctx, answered("toolu_cc_dr1", q, "Approve"));
                say("Approved. I will go on to the next section.");
                await setAgent({ ask: null, ends: true });
                rec(
                    `${name}: the card is in [data-chat-ask] (the only one), state waiting, with "sections/method.tex", "Pages: 12", the intro, two items, Review, Approve and the note "Request changes from Review: each comment sits on a passage"; Approve records one answer with the Approve option, [0], and goes dead`,
                    up &&
                        pathUp &&
                        card.dock &&
                        card.cards === 1 &&
                        card.inDock &&
                        card.state === "waiting" &&
                        card.path === "sections/method.tex" &&
                        card.pages === "Pages: 12" &&
                        card.intro === DR_INTRO &&
                        card.items.length === 2 &&
                        card.items.every((t, i) => t.includes(DR_ITEMS[i])) &&
                        card.review?.text === "Review" &&
                        card.review.disabled === false &&
                        card.approve?.text === "Approve" &&
                        card.approve.disabled === false &&
                        card.note === "Request changes from Review: each comment sits on a passage" &&
                        clicked === "clicked" &&
                        recorded &&
                        answers.length === 1 &&
                        answers[0].data?.oref === `block:${ctx.tab.blockId}` &&
                        answers[0].data?.answers?.length === 1 &&
                        JSON.stringify(answers[0].data.answers[0].selectedindexes) === "[0]" &&
                        after.approve?.disabled === true,
                    { up, pathUp, card, clicked, recorded, answers, approveAfter: after.approve }
                );
            });

            // 7a. Review on a fresh ask opens the review view in place of the conversation
            await run("7a. Review", async (name) => {
                await begin();
                const q = drQuestion(ctx.outline);
                await startDocReview("toolu_cc_dr2", "cc-ask-2", q, "Reviewing the outline for step 7a.");
                const up = await waitSel('[data-chat-ask] [data-chat-bscard-kind="docreview"]');
                await polishNap(500);
                const clicked = await click("[data-chat-drcard-review]");
                const shown = await polishWaitFor(h, `!!document.querySelector("[data-doc-review-pane]")`, WAIT_MS);
                await polishNap(600);
                await shot("7a-review-view");
                // back to the Chat, and the ask over (the person asked for changes in the box)
                await AC.agentPage(h, `const S = await mod("app/view/agents/docreviewstore.ts"); S.setDocReviewMode(${JSON.stringify(A)}, "terminal", Date.now()); return true;`);
                append(ctx, answered("toolu_cc_dr2", q, "Request changes"));
                say("I will rework the outline.");
                await setAgent({ ask: null, ends: true });
                rec(
                    `${name}: Review on a fresh ask (a note, notes/outline.md) opens the review view, [data-doc-review-pane]`,
                    up && clicked === "clicked" && shown,
                    { up, clicked, shown }
                );
            });

            // 7b. an unanswered Doc review and the agent gone: the card draws in the conversation, static, with the path and the items
            await run("7b. static Doc review", async (name) => {
                await begin();
                const q = drQuestion(drPath("sections", "related.tex"));
                // the agent asked, and the ask is gone with it: the roster holds none, the conversation has the call alone
                turn("review the related work when it is ready", "Reviewing the related work for step 7b.");
                append(ctx, askCall("toolu_cc_dr3", q));
                await setAgent({ ask: null, ends: true });
                await AC.focusAgent(h, A);
                await exitAgent("done", 1);
                ctx.exited = true;
                const up = await waitSel('[data-chat-bscard-kind="docreview"][data-chat-bscard-state="static"]');
                const pathUp = await waitDocPath("sections/related.tex");
                await polishNap(500);
                await scrollEnd();
                const card = await readDocReview();
                await shot("7b-docreview-static");
                await exitAgent("running", 0);
                ctx.exited = false;
                // the agent is back and takes an answer: the card folds
                append(ctx, answered("toolu_cc_dr3", q, "Approve"));
                say("Approved.");
                await setAgent({ ends: true });
                rec(
                    `${name}: once the agent has exited the unanswered ask draws in the conversation, not in the dock: state static, with "sections/related.tex", the pages, the intro, two items and no Review, Approve or note`,
                    up &&
                        pathUp &&
                        card.cards === 1 &&
                        !card.inDock &&
                        card.state === "static" &&
                        card.path === "sections/related.tex" &&
                        card.pages === "Pages: 12" &&
                        card.intro === DR_INTRO &&
                        card.items.length === 2 &&
                        card.review == null &&
                        card.approve == null &&
                        card.note === "",
                    { up, pathUp, card }
                );
            });

            // 8. the answered Doc review, approved: the ask folds in place into its ✓ row
            await run("8. Doc review approved", async (name) => {
                await begin();
                const q = drQuestion(drPath("notes", "plan.md"));
                turn("review the plan note", "Reviewing the plan note for step 8.");
                append(ctx, askCall("toolu_cc_dr4", q), answered("toolu_cc_dr4", q, "Approve"));
                say("Approved. I will carry on.");
                await setAgent({ ask: null, ends: true });
                const rowUp = await waitDocRow("Doc review · approved · notes/plan.md");
                await polishNap(500);
                await scrollEnd();
                const rows = (await readDocRows()).filter((r) => r.text.includes("notes/plan.md"));
                const card = await readDocReview();
                await shot("8-docreview-approved");
                rec(
                    `${name}: the answered ask (the tool result picks Approve) is the row "Doc review · approved · notes/plan.md" with data-chat-drcard-outcome approved, and no card of it is left`,
                    rowUp &&
                        rows.length === 1 &&
                        rows[0].outcome === "approved" &&
                        rows[0].text.includes("Doc review · approved · notes/plan.md") &&
                        rows[0].mark === null &&
                        card.cards === 0 &&
                        !card.dock,
                    { rowUp, rows, cards: card.cards, dock: card.dock }
                );
            });

            // 9. the answered Doc review, changes requested: the answer in formatRequest's shape with two comments folds into its row
            await run("9. Doc review changes requested", async (name) => {
                await begin();
                const q = drQuestion(drPath("sections", "discussion.tex"));
                turn("review the discussion section", "Reviewing the discussion for step 9.");
                append(ctx, askCall("toolu_cc_dr5", q), answered("toolu_cc_dr5", q, CHANGES_ANSWER));
                say("I will go through the two comments.");
                await setAgent({ ask: null, ends: true });
                const rowUp = await waitDocRow("Doc review · changes requested · 2 comments · sections/discussion.tex");
                await polishNap(500);
                await scrollEnd();
                const rows = (await readDocRows()).filter((r) => r.text.includes("sections/discussion.tex"));
                const card = await readDocReview();
                const bubbleRequest = await bubbles("Request changes");
                const bubbleNote = await bubbles("Say why ten.");
                await shot("9-docreview-changes");
                rec(
                    `${name}: the answer with two numbered comments is the row "Doc review · changes requested · 2 comments · sections/discussion.tex" with the ↺ mark and data-chat-drcard-outcome changes; no message bubble carries the answer's text and no card of it is left`,
                    rowUp &&
                        rows.length === 1 &&
                        rows[0].outcome === "changes" &&
                        // the row's text starts with its mark's glyph, ↺
                        rows[0].text.endsWith("Doc review · changes requested · 2 comments · sections/discussion.tex") &&
                        rows[0].mark === "↺" &&
                        card.cards === 0 &&
                        bubbleRequest === 0 &&
                        bubbleNote === 0,
                    { rowUp, rows, cards: card.cards, bubbleRequest, bubbleNote }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-council teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            if (ctx.tab != null) {
                await step("clear the exit", () =>
                    h.rpc("eventpublish", {
                        event: "controllerstatus",
                        scopes: [`block:${ctx.tab.blockId}`],
                        data: { blockid: ctx.tab.blockId, shellprocstatus: "running", shellprocexitcode: 0 },
                    })
                );
                await step("leave the review view", () =>
                    AC.agentPage(h, `const S = await mod("app/view/agents/docreviewstore.ts"); S.setDocReviewMode(${JSON.stringify(ctx.tab.tabId)}, "terminal", Date.now()); return true;`)
                );
            }
            await step("show the terminal", () => AC.agentPage(h, `const C = await mod("app/view/agents/agentcenter.ts"); C.showTerminal(); return true;`));
            await step("restore the commands", () => CF.unstubRpc(h));
            if (ctx.dataDir != null) {
                // the councils this run wrote, and any a run that died left under this scenario's ids
                await step("delete the fixture councils", () => {
                    const dir = join(ctx.dataDir, "councils");
                    const names = new Set([...(ctx.ids ?? [])].map((id) => `${id}.json`));
                    for (const id of Object.values(ID)) names.add(`${id}.json`);
                    for (const f of readdirSync(dir)) {
                        if (f.startsWith("fx-council-chat-")) names.add(f);
                    }
                    for (const f of names) rmSync(join(dir, f), { force: true });
                });
            }
            if (ctx.prevRail !== undefined) {
                await step("restore the panel", () =>
                    AC.agentPage(h, `const R = await mod("app/view/agents/railstore.ts"); globalStore.set(R.railVisibleAtom, ${JSON.stringify(ctx.prevRail)}); return true;`)
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            if (ctx.project != null) {
                // deleteproject leaves the channel createproject made, so that goes too
                await step("remove the project", async () => {
                    await h.rpc("deleteproject", { name: ctx.project });
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
            // wavesrv's transcript watch can hold a fixture for a moment after its agent is gone
            for (const dir of [ctx.dir, ctx.cwd]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
