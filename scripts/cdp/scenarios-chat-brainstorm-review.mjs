// The brainstorm's review, builder check and run in Chat (docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md,
// plan 2026-11-12-chat-brainstorm-review.md Task 8). Chat draws the whole brainstorm after its questions: a Confirm the
// design card, Decided so far folded into the question card's footer, the builder check as a card, and the run as a
// card, each folding into a ✓ row anchored to the message that ended its step, with the `brainstorm: …` action lines
// Arc sent hidden. It is written against the spec's DOM contract ("Builder decisions"), not against the components:
//   every card  [data-chat-bscard-kind="question|confirm|check|run"][data-chat-bscard-state="waiting|weighing|working|static"],
//               [data-chat-bscard-open]
//   folds       [data-chat-bscard-fold="decided|yours|calls|spec"] (aria-expanded) and [data-chat-bscard-fold-list="…"]
//   confirm     [data-chat-bscard-review-line], [data-chat-bscard-confirm-all] or [data-chat-bscard-check],
//               [data-chat-bscard-decision="<part>"][data-view="guess|changed"], [data-chat-bscard-new],
//               [data-chat-bscard-right|edit|keep|restore], [data-chat-bscard-editor]; a changed row also draws what
//               changed as the Brainstorm tab's review does: [data-diff-line="removed|added"] (one per sentence that left
//               or came in), [data-chat-bscard-why] and, when its part came from an answered question, [data-brainstorm-said]
//   check      [data-chat-bscard-stage="reading|taking-in|failed|asking|review"], [data-chat-bscard-clock],
//               [data-chat-bscard-check-reason], [data-chat-bscard-retry], [data-chat-bscard-builder="<n>"],
//               [data-chat-bscard-option], [data-chat-bscard-decide], [data-chat-bscard-own], [data-chat-bscard-approve],
//               [data-chat-bscard-approve-reason], [data-chat-bscard-keep-talking]
//   run         [data-chat-bscard-run-stage="<RunStageKey>"], [data-chat-bscard-run-open]
//   ✓ rows      [data-chat-bscard-answered] (a builder answer also [data-kind="builder"]), [data-chat-bscard-done="design|builder|run"]
//
// One fixture Claude agent over a real tab with a shell controller (so a line sent to it has somewhere to go), a fixture
// roster row for it (the page's dev mock roster), a throwaway git project registered with the app, a fixture transcript the
// steps append to the way Claude Code does, and two deferred fixture runs (one orchestrator, one quick). A button is
// clicked and the line Arc sent is read from the page's send record (the record's text), then appended to the transcript
// as the user message the agent received, so it pairs: its ✓ row draws, or, for an action, nothing does. The builder check
// record (what the server writes to the tab's brainstorm:check* keys) rides on the mock roster row as `builderCheck`, since
// a mock row is what Chat reads.
//
// A sub-step (2b, 4b, 9b…) is a button the lead's review asked to be clicked and its record asserted; it has its own shot
// and its own assert, and starts by writing the state it needs, so a failed step does not take the next with it.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat brainstorm review main";
const PROJECT = "verify-chat-brainstorm-review";
const TOPIC = "sync-retry-review";
const SENT_KEY = "chat.brainstorm.sent";
const HINTS_KEY = "brainstorm.hintsSeen";
const WAIT_MS = 15000;
const SHORT_MS = 5000;
const RECORD_WAIT_MS = 8000;
// ids the builder check's record names; nothing real stands behind them
const CHECK_RUN = "6a1f3c9e-2b84-4d07-9e5a-b3c8d1f20a47";
const SHA = "78671429d0c4f1e2a3b4c5d6e7f8091a2b3c4d5e";

// the card copy, as brainstormmodel.ts words it
const READING = "A builder is reading the design.";
const TAKING_IN = "Taking in the builder's questions.";
const FAILED_REASON = "The builder session ended before it wrote its questions.";

// --- the design -----------------------------------------------------------------------------------------------------

// each decision's text. A part carries a `gist` (the row's line); `was` and `why` are what a changed decision shows
const ORDER = ["intent", "scope", "policy", "logging", "cache", "retention", "limits", "timeout"];
const TEXT = {
    intent: { title: "Intent and why", gist: "The sync client survives a flaky network.", more: "A retry that is gentle on the server." },
    scope: { title: "What it covers", gist: "Only the client's own requests; the server is unchanged.", more: "No server change ships with this." },
    policy: { title: "Retry policy", gist: "Exponential backoff, capped at 30 seconds.", more: "A fixed delay hammers a struggling server." },
    logging: { title: "What it logs", gist: "Each attempt, with what was sent and what came back.", more: "So a stuck sync is easy to trace." },
    cache: { title: "Request cache", gist: "Cache nothing; a retry always sends a fresh request.", more: "A cached failure would never recover." },
    retention: {
        title: "Log retention",
        gist: "Keep retry logs for seven days.",
        more: "Long enough to trace a weekend outage.",
        was: "Keep retry logs for three days.",
        why: "Your answer about paging means the logs are read in the field, so they stay longer.",
        from: "your answer 3",
    },
    limits: {
        title: "Retry limits",
        gist: "Five attempts, then give up.",
        more: "A flaky link needs more tries.",
        was: "Three attempts.",
        why: "You said a flaky link needs more tries.",
        from: "your answer 2",
    },
    timeout: {
        title: "Request timeout",
        gist: "Ten seconds per attempt.",
        more: "Five long attempts is too long a wait.",
        was: "Thirty seconds per attempt.",
        why: "Five attempts of thirty seconds is too long a wait.",
    },
};
// what the user types into the Edit field of the logging decision
const EDITED = "Each attempt and its outcome, kept for the audit.";
const BOARDS = ["Main.dc.html", "Alt.dc.html"];

// how a decision is drawn in a file: yours; yours as before the agent changed it (`was`); the agent's guess; a guess that
// changed a decision you had confirmed (its `from` names the answer that caused it, when the text gives one); asked (no
// text yet); yours as the user edited it
function part(id, view, extra = {}) {
    const t = TEXT[id];
    const base = { id, title: t.title, body: `${t.gist} ${t.more}`, gist: t.gist };
    switch (view) {
        case "yours":
            return { ...base, state: "yours", ...extra };
        case "was":
            return { ...base, state: "yours", gist: t.was ?? t.gist, body: t.was ?? t.gist, ...extra };
        case "guess":
            return { ...base, state: "guess", from: "agent's call", ...extra };
        case "changed":
            return { ...base, state: "guess", from: t.from ?? "agent's call", was: t.was, why: t.why, ...extra };
        case "asked":
            return { id, title: t.title, state: "asked", body: "", ...extra };
        case "edited":
            return { ...base, state: "yours", gist: EDITED, body: EDITED, ...extra };
        default:
            throw new Error(`unknown view ${view}`);
    }
}

const Q1 = {
    n: 1,
    part: "policy",
    text: "Which retry policy should the sync client use?",
    why: "A flaky network fails in bursts, so a retry that waits longer each time is gentler on the server than one that retries at once.",
    read: "Backoff is the safe default: a fixed delay hammers a struggling server, and no retry pushes the work onto every caller.",
    options: [
        { label: "Exponential backoff", detail: "Wait twice as long after each failure, up to a cap.", pick: true },
        { label: "Fixed delay", detail: "Wait the same time between every attempt." },
        { label: "No retry", detail: "Fail at once and let the caller decide." },
    ],
};

// the two answers a changed decision came from, as the file's history ties them to it (`into` names the part, and the
// part's `from` names the answer's n): the Confirm card and the check's review draw each as an answer line. The files
// that still ask a question have none: a design that is still being asked has no answer behind its changes
const ANSWER_LIMITS = "A flaky link needs more tries than three.";
const ANSWER_RETENTION = "The logs are read in the field, a few days after.";
const HISTORY = [
    { kind: "question", n: 2, q: "How should the client cope with a flaky link?", a: ANSWER_LIMITS, into: ["limits"] },
    { kind: "question", n: 3, q: "Who reads the retry logs, and when?", a: ANSWER_RETENTION, into: ["retention"] },
];

const designFile = (views, over = {}, extras = {}) => ({
    v: 1,
    title: "Sync client retries",
    spec: "docs/superpowers/specs/2026-11-12-sync-retry-design.md",
    canvas: TOPIC,
    question: null,
    working: null,
    parts: ORDER.filter((id) => id in views).map((id) => part(id, views[id], extras[id] ?? {})),
    history: HISTORY,
    done: true,
    check: null,
    run: null,
    ...over,
});

// the decisions after each action, one view-set per step (step 17 starts over from V2)
const YOURS2 = { intent: "yours", scope: "yours" };
const V1 = { ...YOURS2, policy: "asked", logging: "guess", cache: "guess", retention: "guess", limits: "was", timeout: "was" };
const V2 = { ...YOURS2, policy: "guess", logging: "guess", cache: "guess", retention: "guess", limits: "changed", timeout: "changed" };
const V3 = { ...V2, cache: "yours" }; // after That's right on cache
const V4 = { ...V3, logging: "edited" }; // after Edit on logging
const V5 = { ...V4, limits: "yours" }; // after Keep the change on limits
const V6 = { ...V5, timeout: "was" }; // after Put mine back on timeout
const V7 = { ...V6, policy: "yours", retention: "yours" }; // after Confirm all 2 guesses: every decision is yours
const DECISIONS = Object.keys(V7).length;
const F1 = designFile(V1, { question: Q1, done: false, history: [] }, { policy: { boards: BOARDS } });
const F2 = designFile(V2);
const F3 = designFile(V3);
const F4 = designFile(V4);
const F5 = designFile(V5);
const F6 = designFile(V6);
const F7 = designFile(V7);
// the titles the Decided fold lists in step 1: the decisions whose state is yours in F1
const DECIDED = ["intent", "scope", "limits", "timeout"];

// the builder check: three questions for the user (the first has options), three calls of the agent's, two answered by the spec
const Y1 = {
    q: "When the server answers 429, should the client wait as long as it says or use its own backoff?",
    label: "What a 429 does to the backoff",
    why: "A 429 asks clients to slow down, and the header says how long.",
    part: "policy",
    options: [
        { label: "Honor Retry-After", detail: "Wait as long as the server says.", pick: true },
        { label: "Use our own backoff", detail: "Ignore the header." },
        { label: "Give up at once", detail: "Treat a 429 as a failure." },
    ],
};
const Y2 = { q: "Should a sync that keeps failing page on-call, or only log?", label: "Paging", why: "Paging needs the client to hold the on-call credentials.", part: "logging" };
const Y3 = { q: "How long may one sync keep retrying before it is abandoned?", label: "A sync's total time", why: "Five attempts of ten seconds add up to a long wait.", part: "limits" };
const ANSWER1 = Y1.options[1].label;
const ANSWER3 = "Abandon a sync after two minutes.";
const CALLS = [
    { text: "Retries share one budget per sync, not one per request.", part: "limits" },
    { text: "The log line carries the attempt number.", part: "logging" },
    { text: "Retry-After wins over our own backoff.", part: "policy" },
];
const SPEC_ANSWERED = ["The retry count lives in one place.", "Requests already carry an idempotency key."];
const checkOf = (answers) => ({
    yours: [Y1, Y2, Y3].map((y, i) => (answers[i] != null ? { ...y, a: answers[i], into: [y.part] } : y)),
    calls: CALLS,
    answered: SPEC_ANSWERED,
    touched: [],
});
const ANSWER2 = "Decided by the agent: log only.";
const withCheck = (check, views = V7) => designFile(views, { check });
const C0 = withCheck(checkOf([])); // the builder's questions, none answered
const C1 = withCheck(checkOf([ANSWER1])); // question 2 open
const C2 = withCheck(checkOf([ANSWER1, ANSWER2])); // question 3 open
const C3 = withCheck(checkOf([ANSWER1, ANSWER2, ANSWER3]), { ...V7, retention: "changed" }); // all answered, one decision changed by them
const C4 = withCheck(checkOf([ANSWER1, ANSWER2, ANSWER3])); // settled
// keep talking sets `check` back to null and the agent asks again: the same n as the builder question the user answered
const F13 = designFile(V7, { question: Q1, done: false, history: [] });

const GOALS = {
    orchestrator: "verify chat-brainstorm-review: the orchestrator fixture run",
    quick: "verify chat-brainstorm-review: the quick fixture run",
};

// --- page expressions -----------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const scrollerOf = (id) => `document.querySelector('[data-agent-chat="${id}"] .overflow-y-auto')`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const cardOf = (id, kind) => `${layerOf(id)}?.querySelector('[data-chat-bscard-kind="${kind}"]')`;
const LAUNCHER = `document.querySelector('[data-launcher]')`;
const ESCAPE = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`;
// helpers every reading shares: a node or one inside it, a button's text and off state, a fold's toggle and list
const HELP = `
const flat = ${FLAT};
const pick = (el, sel) => (el ? (el.matches(sel) ? el : el.querySelector(sel)) : null);
const btn = (root, sel) => { const e = pick(root, sel); return e ? { text: flat(e), disabled: e.disabled === true } : null; };
const attr = (root, sel, name) => pick(root, sel)?.getAttribute(name) ?? null;
const fold = (root, name) => {
    const t = root?.querySelector('[data-chat-bscard-fold="' + name + '"]');
    const l = root?.querySelector('[data-chat-bscard-fold-list="' + name + '"]');
    return t ? { text: flat(t), expanded: t.getAttribute("aria-expanded"), list: l ? { lines: l.querySelectorAll("li").length || l.children.length, text: flat(l) } : null } : null;
};
`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, UI_ROUTE, GRID_KEY, GRID_EMPTY, bsSeeHints, fstWriteRun } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", SENT_KEY, HINTS_KEY];

    const ts = (ctx, offsetMs = 0) => ({ cwd: ctx.dir, ts: new Date(Date.now() + offsetMs).toISOString() });
    const append = (ctx, ...lines) => appendFileSync(ctx.transcript, lines.join("\n") + "\n");

    // the roster row of the one agent: idle since `ctx.idleSince` (a line sent after it is pending until the agent's turn
    // ends after it), with the builder check's record when there is one
    const rosterRows = (ctx) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: ctx.idleSince,
            usage: { contextpct: 42 },
            id: ctx.tab.tabId,
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
            ...(ctx.record != null ? { builderCheck: ctx.record } : {}),
        },
    ];

    // writes the brainstorm file and has the page read it now: the agent's hook reveals after each write, which attaches
    // the brainstorm (the first time) and polls it
    async function writeBrainstorm(h, ctx, file) {
        mkdirSync(dirname(ctx.bsFile), { recursive: true });
        writeFileSync(ctx.bsFile, JSON.stringify(file, null, 2));
        await h.rpc("uireveal", { address: `brainstorm:${TOPIC}`, callerblockid: ctx.tab.blockId, callercwd: ctx.cwd }, UI_ROUTE);
    }

    const scenario = {
        name: "chat-brainstorm-review",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-cbr-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-cbr-project-")),
                runDir: mkdtempSync(join(tmpdir(), "verify-cbr-runs-")),
                prev: {},
                idleSince: Date.now() - 60_000,
                record: null,
                turns: 0,
                runs: {},
            };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                at = "making the project";
                const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.cwd, "README.md"), "# sync client\n");
                git("add", ".");
                git("commit", "-qm", "seed");
                ctx.bsFile = join(ctx.cwd, ".superpowers", "brainstorm", TOPIC, "brainstorm.json");
                // the canvas step 1's file names: the question card counts its asked part's boards
                const project = join(ctx.cwd, ".superpowers", "design", TOPIC, "project");
                mkdirSync(project, { recursive: true });
                for (const b of BOARDS) writeFileSync(join(project, b), `<!doctype html><title>${b}</title><p>${b}</p>`);
                writeFileSync(join(project, "canvas.json"), JSON.stringify({ boards: Object.fromEntries(BOARDS.map((b) => [b, { w: 1440 }])), order: BOARDS }));
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                at = "making the fixture runs";
                // two deferred runs in a channel of their own: nothing ever starts them, so each reads Planning until the
                // steps change it
                const ch = await h.rpc("createchannel", { name: "verify-chat-brainstorm-review", projectpath: ctx.runDir });
                ctx.channelId = ch.oid;
                const wslist = await h.rpc("workspacelist", null);
                for (const mode of ["orchestrator", "quick"]) {
                    const created = await h.rpc("createrun", {
                        channelid: ctx.channelId,
                        workspaceid: wslist[0].workspacedata.oid,
                        goal: GOALS[mode],
                        runtime: "claude",
                        mode,
                        deferstart: true,
                    });
                    ctx.runs[mode] = created.run.id;
                }

                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 6; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the sync client work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. The sync client retries a failed request, and each attempt logs what it sent.`, o(i * 10 + 2)));
                }
                lines.push(AC.userText("make the sync client retry a failed request", o(300)));
                ctx.transcript = AC.writeTranscript(ctx.dir, "chat-brainstorm-review-main", lines);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(SENT_KEY)})`);
                // the Brainstorm pane's first-open hint card is not what this scenario reads
                if (typeof bsSeeHints === "function") await bsSeeHints(h);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");
                at = "making the tab";
                // a shell controller, as bsArrangeAgent / openCanvasTerminal give a terminal: a line sent to the agent is typed there
                ctx.tab = await makeTab(h, ctx, { label: NAME, blockMeta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent, its project, its runs and its transcript", false, ctx.arrangeError);
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
                    await h.shot(`cdp-shots/chat-brainstorm-review-${name}.png`);
                } catch (e) {
                    console.error(`chat-brainstorm-review: the shot ${name} failed: ${e?.message ?? e}`);
                }
            };
            const scrollEnd = async () => {
                await h.ev(`(() => { const s = ${scrollerOf(A)}; if (s) s.scrollTop = s.scrollHeight; return true; })()`);
                await polishNap(300);
            };
            const waitCard = (kind, state, ms = WAIT_MS) =>
                polishWaitFor(h, `(${cardOf(A, kind)}?.getAttribute("data-chat-bscard-state") ?? null) ${state == null ? "!== null" : `=== ${JSON.stringify(state)}`}`, ms);
            const noCard = (kind, ms = WAIT_MS) => polishWaitFor(h, `${cardOf(A, kind)} == null`, ms);
            const waitText = (text, ms = WAIT_MS) => polishWaitFor(h, `(${layerOf(A)}?.textContent ?? "").includes(${JSON.stringify(text)})`, ms);
            // the check card's stage, wherever in the card the attribute sits
            const STAGE = `(() => { const c = ${cardOf(A, "check")}; const e = c ? (c.matches("[data-chat-bscard-stage]") ? c : c.querySelector("[data-chat-bscard-stage]")) : null; return e?.getAttribute("data-chat-bscard-stage") ?? null; })()`;
            const waitStage = (stage, ms = WAIT_MS) => polishWaitFor(h, `${STAGE} === ${JSON.stringify(stage)}`, ms);
            // at least n elements of a kind: a ✓ row is waited for by its own attribute, not by text a card's head can share
            const waitCount = (sel, n, ms = WAIT_MS) => polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll(${JSON.stringify(sel)}).length ?? 0) >= ${n}`, ms);
            const BUILDER_ROWS = '[data-chat-bscard-answered][data-kind="builder"]';

            // the agent's side: its builder check record (what the server writes to the tab) and whether its turn has ended
            // (idle since now: a line sent before it is taken). `record` is undefined to leave it, null to clear it
            const setAgent = async ({ record, ends = false } = {}) => {
                const at = Date.now();
                if (record !== undefined) ctx.record = record == null ? null : { runId: CHECK_RUN, ...record, ts: record.ts ?? (ends ? at - 1 : at) };
                if (ends) ctx.idleSince = at;
                await AC.setRoster(h, rosterRows(ctx));
            };
            // the Chat and the file at a step's start: the agent focused, its side set, the file written
            const put = async (file, agent = {}) => {
                await AC.focusAgent(h, A);
                await setAgent(agent);
                await writeBrainstorm(h, ctx, file);
            };
            // the agent takes a line: the user message lands in the transcript with a reply after it (its text is what proves
            // the line was read), then its turn ends and it writes the file, as a real agent does
            const turn = async (line, { file, ends = true, record } = {}) => {
                ctx.turns += 1;
                const marker = `Noted ${ctx.turns}: the line was taken in.`;
                append(ctx, ...(line != null ? [AC.userText(line, ts(ctx))] : []), AC.assistantText(marker, ts(ctx, 1)));
                await setAgent({ record, ends });
                if (file != null) await writeBrainstorm(h, ctx, file);
                return waitText(marker);
            };

            // the send record of this agent, newest last: the page's store, or localStorage where the store is out of reach
            const records = async () => {
                const viaModule = await AC.agentPage(h, `const S = await mod("app/view/agents/chatbrainstormstore.ts"); return S.brainstormAnswers(${JSON.stringify(A)});`).catch(() => null);
                const viaStorage = await h.ev(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SENT_KEY)}) ?? "{}")[${JSON.stringify(A)}] ?? []; } catch { return []; } })()`);
                return Array.isArray(viaModule) && viaModule.length >= viaStorage.length ? viaModule : viaStorage;
            };
            // a click on a button of the layer: "clicked", "missing" or "disabled"
            const click = (sel) =>
                h.ev(`(() => {
                    const el = ${layerOf(A)}?.querySelector(${JSON.stringify(sel)});
                    if (!el) return "missing";
                    if (el.disabled) return "disabled";
                    el.click();
                    return "clicked";
                })()`);
            // the own-answer field's Send: the button inside [data-chat-bscard-own], or beside it when that is the field itself
            const clickOwnSend = () =>
                h.ev(`(() => {
                    const own = ${layerOf(A)}?.querySelector("[data-chat-bscard-own]");
                    const b = own ? (own.matches("input, textarea") ? own.parentElement?.querySelector("button") : own.querySelector("button")) : null;
                    if (!b) return "missing";
                    if (b.disabled) return "disabled";
                    b.click();
                    return "clicked";
                })()`);
            // a click (a selector, or a function that does it), then the record it left: { clicked, text, kind, count }
            const sendVia = async (target) => {
                const before = (await records()).length;
                const clicked = await (typeof target === "function" ? target() : click(target));
                let fresh = [];
                for (let waited = 0; waited < RECORD_WAIT_MS; waited += 250) {
                    fresh = (await records()).slice(before);
                    if (fresh.length > 0) break;
                    await polishNap(250);
                }
                return { clicked, text: fresh[0]?.text ?? null, kind: fresh[0]?.kind ?? null, count: fresh.length };
            };

            const readCard = (kind) =>
                h.ev(`(() => {
                    ${HELP}
                    const layer = ${layerOf(A)};
                    const card = layer?.querySelector('[data-chat-bscard-kind="${kind}"]');
                    const rows = [...(card?.querySelectorAll("[data-chat-bscard-decision]") ?? [])].map((r) => ({
                        id: r.getAttribute("data-chat-bscard-decision"),
                        view: r.getAttribute("data-view"),
                        isNew: !!r.querySelector("[data-chat-bscard-new]"),
                        right: btn(r, "[data-chat-bscard-right]"),
                        edit: btn(r, "[data-chat-bscard-edit]"),
                        keep: btn(r, "[data-chat-bscard-keep]"),
                        restore: btn(r, "[data-chat-bscard-restore]"),
                    }));
                    const builder = pick(card, "[data-chat-bscard-builder]");
                    const own = pick(card, "[data-chat-bscard-own]");
                    const editor = pick(card, "[data-chat-bscard-editor]");
                    const clock = pick(card, "[data-chat-bscard-clock]");
                    const field = (el) => (el ? (el.matches("input, textarea") ? el : el.querySelector("input, textarea")) : null);
                    return {
                        kinds: [...(layer?.querySelectorAll("[data-chat-bscard-kind]") ?? [])].map((c) => c.getAttribute("data-chat-bscard-kind") + ":" + c.getAttribute("data-chat-bscard-state")),
                        card: !!card,
                        state: card?.getAttribute("data-chat-bscard-state") ?? null,
                        n: card?.getAttribute("data-chat-bscard-n") ?? null,
                        stage: attr(card, "[data-chat-bscard-stage]", "data-chat-bscard-stage"),
                        runStage: attr(card, "[data-chat-bscard-run-stage]", "data-chat-bscard-run-stage"),
                        text: flat(card).slice(0, 360),
                        line: flat(pick(card, "[data-chat-bscard-review-line]")),
                        confirmAll: btn(card, "[data-chat-bscard-confirm-all]"),
                        check: btn(card, "[data-chat-bscard-check]"),
                        rows,
                        news: card?.querySelectorAll("[data-chat-bscard-new]").length ?? 0,
                        decided: fold(card, "decided"),
                        yours: fold(card, "yours"),
                        calls: fold(card, "calls"),
                        spec: fold(card, "spec"),
                        boards: btn(card, "[data-chat-bscard-boards]"),
                        sendButtons: [...(card?.querySelectorAll("[data-chat-bscard-right], [data-chat-bscard-edit], [data-chat-bscard-keep], [data-chat-bscard-restore], [data-chat-bscard-confirm-all], [data-chat-bscard-check]") ?? [])].map((b) => b.disabled === true),
                        editor: editor ? { value: field(editor)?.value ?? null, send: [...editor.querySelectorAll("button")].map(flat) } : null,
                        clock: clock ? flat(clock) : null,
                        reason: flat(pick(card, "[data-chat-bscard-check-reason]")),
                        retry: btn(card, "[data-chat-bscard-retry]"),
                        builder: builder ? { n: builder.getAttribute("data-chat-bscard-builder"), text: flat(builder).slice(0, 240) } : null,
                        options: card?.querySelectorAll("[data-chat-bscard-option]").length ?? 0,
                        decide: btn(card, "[data-chat-bscard-decide]"),
                        own: own ? { field: !!field(own), send: btn(own, "button") } : null,
                        approve: btn(card, "[data-chat-bscard-approve]"),
                        approveReason: flat(pick(card, "[data-chat-bscard-approve-reason]")),
                        keepTalking: btn(card, "[data-chat-bscard-keep-talking]"),
                        runOpen: btn(card, "[data-chat-bscard-run-open]"),
                        open: !!pick(card, "[data-chat-bscard-open]"),
                        amber: !!card?.querySelector('[class*="bg-asking"], [class*="bg-warning"]'),
                        waitingText: flat(card).includes("Waiting on you"),
                    };
                })()`);
            // the thread around the cards: the bubbles holding a line, the ✓ rows, and the end rows
            const readThread = (needle = null) =>
                h.ev(`(() => {
                    ${HELP}
                    const layer = ${layerOf(A)};
                    const needle = ${JSON.stringify(needle)};
                    const all = (sel) => [...(layer?.querySelectorAll(sel) ?? [])].map(flat);
                    const root = layer?.querySelector("[data-chat-conversation]");
                    const rows = [...(root?.children ?? [])].filter((c) => c.hasAttribute("data-chat-brainstorm-row"));
                    const last = root?.lastElementChild;
                    return {
                        bubbles: needle == null ? null : [...(layer?.querySelectorAll("[data-chat-you]") ?? [])].filter((e) => flat(e).includes(needle)).length,
                        design: all('[data-chat-bscard-done="design"]'),
                        builder: all('[data-chat-bscard-done="builder"]'),
                        run: all('[data-chat-bscard-done="run"]'),
                        builderAnswers: all('[data-chat-bscard-answered][data-kind="builder"]'),
                        endRows: rows.length,
                        emptyEndRows: rows.filter((r) => flat(r) === "" || r.getBoundingClientRect().height === 0).length,
                        lastEmpty: last == null ? null : flat(last) === "" && last.getBoundingClientRect().height === 0,
                    };
                })()`);
            const openFold = async (kind, name) => {
                const got = await h.ev(`(() => {
                    const t = ${cardOf(A, kind)}?.querySelector('[data-chat-bscard-fold="${name}"]');
                    if (!t) return "missing";
                    if (t.getAttribute("aria-expanded") !== "true") t.click();
                    return "ok";
                })()`);
                await polishNap(400);
                return got;
            };
            const rowOf = (card, id) => card.rows.find((r) => r.id === id);
            // what a decision row of a card draws of its change: the sentences that left and came in (without their − / +),
            // the cause, the answer line, and whether any `Was:` text is left
            const readChange = (kind, id) =>
                h.ev(`(() => {
                    ${HELP}
                    const row = ${cardOf(A, kind)}?.querySelector('[data-chat-bscard-decision="${id}"]');
                    const lines = (k) => [...(row?.querySelectorAll('[data-diff-line="' + k + '"]') ?? [])].map((e) => flat(e).replace(/^[+\\u2212]\\s*/, ""));
                    return {
                        row: !!row,
                        view: row?.getAttribute("data-view") ?? null,
                        removed: lines("removed"),
                        added: lines("added"),
                        why: flat(row?.querySelector("[data-chat-bscard-why]")),
                        said: flat(row?.querySelector("[data-brainstorm-said]")),
                        saidCount: row?.querySelectorAll("[data-brainstorm-said]").length ?? 0,
                        wasText: /\\bWas:/.test(flat(row)),
                    };
                })()`);
            const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
            // a changed decision as its row must draw it: the old sentence removed, the new body's sentences added, the cause
            const drewChange = (c, id) => c.view === "changed" && sameList(c.removed, [TEXT[id].was]) && sameList(c.added, [TEXT[id].gist, TEXT[id].more]) && c.why === `Why: ${TEXT[id].why}` && !c.wasText;
            // the layer's text typed into a field the way a person does: focus, select what is there, type over it
            const typeInto = async (selector, text) => {
                const ok = await h.ev(`(() => {
                    ${HELP}
                    const root = ${layerOf(A)}?.querySelector(${JSON.stringify(selector)});
                    const f = root?.matches("input, textarea") ? root : root?.querySelector("input, textarea");
                    if (!f) return false;
                    f.focus();
                    f.select();
                    return true;
                })()`);
                if (ok) await h.cdp("Input.insertText", { text });
                await polishNap(200);
                return ok;
            };

            // 1. the question card's footer: Decided N before Compare N boards, closed, then open
            await run("1. question card: Decided fold", async (name) => {
                await put(F1);
                const up = await waitCard("question", "waiting");
                await polishNap(600);
                await scrollEnd();
                const closed = await readCard("question");
                const before = await h.ev(`(() => {
                    const c = ${cardOf(A, "question")};
                    const t = c?.querySelector('[data-chat-bscard-fold="decided"]');
                    const b = c?.querySelector("[data-chat-bscard-boards]");
                    return t && b ? !!(t.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
                })()`);
                await openFold("question", "decided");
                const open = await readCard("question");
                await shot("1-decided-fold");
                rec(
                    `${name}: Decided ${DECIDED.length} comes before Compare 2 boards and starts closed with no list; opened it lists one line per decided part`,
                    up &&
                        /^Decided\s+4\b/.test(closed.decided?.text ?? "") &&
                        closed.decided.expanded === "false" &&
                        closed.decided.list == null &&
                        /Compare 2 boards/.test(closed.boards?.text ?? "") &&
                        before === true &&
                        open.decided?.expanded === "true" &&
                        open.decided.list?.lines === DECIDED.length &&
                        DECIDED.every((id) => open.decided.list.text.includes(TEXT[id].title)),
                    { closed: closed.decided, boards: closed.boards, before, open: open.decided }
                );
            });

            // 2. the Confirm card: two kinds of row, a New label on the unseen guess, the yours fold
            await run("2. confirm card", async (name) => {
                await put(F2);
                const up = await waitCard("confirm", "waiting");
                await polishNap(600);
                await scrollEnd();
                const closed = await readCard("confirm");
                await openFold("confirm", "yours");
                const card = await readCard("confirm");
                await shot("2-confirm-card");
                const views = card.rows.map((r) => `${r.id}:${r.view}`).sort();
                rec(
                    `${name}: [data-chat-bscard-kind="confirm"] in state waiting, no question card, Confirm all 4 guesses, a row per guess and per changed decision, New on the unseen guess only, 2 yours opening to two lines`,
                    up &&
                        !card.kinds.some((k) => k.startsWith("question")) &&
                        /Confirm all 4 guesses/.test(card.confirmAll?.text ?? "") &&
                        card.line.includes("still the agent") &&
                        card.line.includes("changed since you confirmed") &&
                        JSON.stringify(views) === JSON.stringify(["cache:guess", "limits:changed", "logging:guess", "policy:guess", "retention:guess", "timeout:changed"]) &&
                        rowOf(card, "policy")?.isNew === true &&
                        ["logging", "cache", "retention"].every((id) => rowOf(card, id)?.isNew === false) &&
                        /^2 yours\b/.test(closed.yours?.text ?? "") &&
                        closed.yours.expanded === "false" &&
                        closed.yours.list == null &&
                        card.yours?.expanded === "true" &&
                        card.yours.list?.lines === 2 &&
                        card.open,
                    { kinds: card.kinds, confirmAll: card.confirmAll, line: card.line, views, news: card.news, rows: card.rows.map((r) => [r.id, r.isNew]), yoursClosed: closed.yours, yours: card.yours }
                );
            });

            // 2a. a changed decision draws what changed, as the Brainstorm tab's review does: the − / + sentence lines, the
            // cause, and the answer it came from (limits came from answer 2, timeout from the agent's own change)
            await run("2a. confirm card: changed decisions", async (name) => {
                await put(F2);
                const up = await waitCard("confirm", "waiting");
                await polishNap(600);
                await scrollEnd();
                const limits = await readChange("confirm", "limits");
                const timeout = await readChange("confirm", "timeout");
                const guess = await readChange("confirm", "logging");
                // the limits row from its top (under the pane's sticky first message), so the shot holds its answer line
                // and both changed rows
                await h.ev(`(() => {
                    const s = ${scrollerOf(A)};
                    const r = ${cardOf(A, "confirm")}?.querySelector('[data-chat-bscard-decision="limits"]');
                    if (s && r) { r.scrollIntoView({ block: "start" }); s.scrollTop -= 56; }
                    return !!r;
                })()`);
                await polishNap(300);
                await shot("2a-confirm-diff");
                rec(
                    `${name}: the changed limits and timeout rows draw [data-diff-line="removed"] with the old sentence, [data-diff-line="added"] with the new body's sentences, [data-chat-bscard-why] with the cause and no Was: text; limits, which came from answer 2, also draws [data-brainstorm-said]; timeout and a guess row draw none, and the guess draws no diff or why`,
                    up &&
                        drewChange(limits, "limits") &&
                        limits.saidCount === 1 &&
                        limits.said === `answer 2: “${ANSWER_LIMITS}”` &&
                        drewChange(timeout, "timeout") &&
                        timeout.saidCount === 0 &&
                        guess.view === "guess" &&
                        guess.removed.length === 0 &&
                        guess.added.length === 0 &&
                        guess.why === "" &&
                        guess.saidCount === 0,
                    { up, limits, timeout, guess }
                );
            });

            // 2b. That's right on a guess sends confirm <id>
            await run("2b. That's right", async (name) => {
                await put(F2);
                await waitCard("confirm", "waiting");
                await polishNap(400);
                const sent = await sendVia('[data-chat-bscard-decision="cache"] [data-chat-bscard-right]');
                const line = "brainstorm: confirm cache";
                const taken = await turn(line, { file: F3 });
                // a row leaves on a spring height collapse (the rows sit in an AnimatePresence), so it stays in the page for
                // some hundred ms after the card has taken the new file: wait for it to go, not a fixed time
                const gone = await polishWaitFor(h, `!${cardOf(A, "confirm")}?.querySelector('[data-chat-bscard-decision="cache"]')`, WAIT_MS);
                await polishNap(200);
                const card = await readCard("confirm");
                const thread = await readThread(line);
                await scrollEnd();
                await shot("2b-thats-right");
                rec(
                    `${name}: That's right on cache records "${line}"; once the agent has it the line draws no bubble and the cache row is gone`,
                    sent.clicked === "clicked" && sent.text === line && taken && thread.bubbles === 0 && card.card && gone && !rowOf(card, "cache"),
                    { sent, taken, bubbles: thread.bubbles, gone, rows: card.rows.map((r) => r.id) }
                );
            });

            // 3. Edit opens the inline editor; Send records edit <id>: …
            await run("3. edit", async (name) => {
                await put(F3);
                await waitCard("confirm", "waiting");
                await polishNap(400);
                const opened = await click('[data-chat-bscard-decision="logging"] [data-chat-bscard-edit]');
                const editorUp = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-bscard-decision="logging"] [data-chat-bscard-editor]')`, SHORT_MS);
                const editor = (await readCard("confirm")).editor;
                const typed = await typeInto('[data-chat-bscard-decision="logging"] [data-chat-bscard-editor]', EDITED);
                await shot("3-edit");
                const sendLabel = await h.ev(`(() => {
                    ${HELP}
                    const ed = ${layerOf(A)}?.querySelector('[data-chat-bscard-decision="logging"] [data-chat-bscard-editor]');
                    return [...(ed?.querySelectorAll("button") ?? [])].map(flat);
                })()`);
                const before = (await records()).length;
                const sentOk = await h.ev(`(() => {
                    ${HELP}
                    const ed = ${layerOf(A)}?.querySelector('[data-chat-bscard-decision="logging"] [data-chat-bscard-editor]');
                    const b = [...(ed?.querySelectorAll("button") ?? [])].find((x) => flat(x) === "Send");
                    if (!b) return "missing";
                    if (b.disabled) return "disabled";
                    b.click();
                    return "clicked";
                })()`);
                let fresh = [];
                for (let waited = 0; waited < RECORD_WAIT_MS && fresh.length === 0; waited += 250) {
                    fresh = (await records()).slice(before);
                    if (fresh.length === 0) await polishNap(250);
                }
                const line = `brainstorm: edit logging: ${EDITED}`;
                const taken = await turn(line, { file: F4 });
                await polishNap(600);
                const thread = await readThread("brainstorm: edit");
                rec(
                    `${name}: Edit opens [data-chat-bscard-editor] on the row, prefilled; Send records "${line}"; appended, it draws no bubble`,
                    opened === "clicked" &&
                        editorUp &&
                        editor?.value != null &&
                        editor.value.trim() !== "" &&
                        typed &&
                        sentOk === "clicked" &&
                        fresh[0]?.text === line &&
                        taken &&
                        thread.bubbles === 0,
                    { opened, editorUp, editor, typed, sendLabel, sentOk, sent: fresh[0]?.text ?? null, taken, bubbles: thread.bubbles }
                );
            });

            // 4. Keep the change on a changed decision sends keep <id>; the card stays, working
            await run("4. keep the change", async (name) => {
                await put(F4);
                await waitCard("confirm", "waiting");
                await polishNap(400);
                const sent = await sendVia('[data-chat-bscard-decision="limits"] [data-chat-bscard-keep]');
                const working = await waitCard("confirm", "working", SHORT_MS);
                const card = await readCard("confirm");
                await scrollEnd();
                await shot("4-keep-working");
                const line = "brainstorm: keep limits";
                const taken = await turn(line, { file: F5 });
                await polishNap(400);
                const settled = await waitCard("confirm", "waiting");
                const thread = await readThread(line);
                rec(
                    `${name}: Keep the change on limits records "${line}"; until the agent writes, the Confirm card stays in state working with its buttons off; then it is waiting again and the line draws no bubble`,
                    sent.clicked === "clicked" &&
                        sent.text === line &&
                        working &&
                        card.state === "working" &&
                        card.sendButtons.length > 0 &&
                        card.sendButtons.every((d) => d === true) &&
                        taken &&
                        settled &&
                        thread.bubbles === 0,
                    { sent, working, state: card.state, sendButtons: card.sendButtons, taken, settled, bubbles: thread.bubbles }
                );
            });

            // 4b. Put mine back sends restore <id>
            await run("4b. put mine back", async (name) => {
                await put(F5);
                await waitCard("confirm", "waiting");
                await polishNap(400);
                const row = rowOf(await readCard("confirm"), "timeout");
                const sent = await sendVia('[data-chat-bscard-decision="timeout"] [data-chat-bscard-restore]');
                const line = "brainstorm: restore timeout";
                const taken = await turn(line, { file: F6 });
                await polishNap(400);
                const card = await readCard("confirm");
                const thread = await readThread(line);
                await shot("4b-put-mine-back");
                rec(
                    `${name}: Put mine back on timeout records "${line}"; the line draws no bubble and the timeout row is gone`,
                    row?.view === "changed" && sent.clicked === "clicked" && sent.text === line && taken && thread.bubbles === 0 && !rowOf(card, "timeout"),
                    { row, sent, taken, bubbles: thread.bubbles, rows: card.rows.map((r) => r.id) }
                );
            });

            // 5. Confirm all N guesses sends confirm every guess
            await run("5. confirm all", async (name) => {
                await put(F6);
                await waitCard("confirm", "waiting");
                await polishNap(600);
                await scrollEnd();
                const before = await readCard("confirm");
                await shot("5-confirm-all");
                const sent = await sendVia("[data-chat-bscard-confirm-all]");
                const line = "brainstorm: confirm every guess";
                const taken = await turn(line, { file: F7 });
                await polishNap(400);
                const thread = await readThread(line);
                rec(
                    `${name}: Confirm all 2 guesses records "${line}"`,
                    /Confirm all 2 guesses/.test(before.confirmAll?.text ?? "") && sent.clicked === "clicked" && sent.text === line && taken && thread.bubbles === 0,
                    { confirmAll: before.confirmAll, sent, taken, bubbles: thread.bubbles }
                );
            });

            // 6. every decision yours: the rows fold into N yours, Check with a builder is the action; a click records check
            await run("6. check with a builder", async (name) => {
                await put(F7);
                await waitCard("confirm", "waiting");
                await polishNap(600);
                await scrollEnd();
                const card = await readCard("confirm");
                await shot("6-check-offered");
                const sent = await sendVia("[data-chat-bscard-check]");
                rec(
                    `${name}: every decision is yours: no decision row, ${DECISIONS} yours, Check with a builder and no Confirm all; a click records "brainstorm: check"`,
                    card.rows.length === 0 &&
                        new RegExp(`^${DECISIONS} yours\\b`).test(card.yours?.text ?? "") &&
                        /Check with a builder/.test(card.check?.text ?? "") &&
                        card.confirmAll == null &&
                        sent.clicked === "clicked" &&
                        sent.text === "brainstorm: check",
                    { rows: card.rows.length, yours: card.yours, check: card.check, confirmAll: card.confirmAll, sent }
                );
            });

            // 7. right after the click: the check card reading with the pending line and no clock, the Confirm card gone;
            // the appended check line is the design's ✓ row
            await run("7. check card reading", async (name) => {
                const reading = await waitCard("check", "working", SHORT_MS);
                const gone = await noCard("confirm", SHORT_MS);
                const card = await readCard("check");
                const line = "brainstorm: check";
                const taken = await turn(line, { ends: false });
                const row = await waitCount('[data-chat-bscard-done="design"]', 1);
                await polishNap(500);
                await scrollEnd();
                const thread = await readThread(line);
                await shot("7-check-reading");
                rec(
                    `${name}: no Confirm card; the check card in stage reading with "${READING}" and no clock; the appended line draws "✓ Design confirmed · ${DECISIONS} decisions" in place of its bubble`,
                    reading &&
                        gone &&
                        card.stage === "reading" &&
                        card.text.includes(READING) &&
                        card.clock == null &&
                        taken &&
                        row &&
                        thread.design.length === 1 &&
                        thread.design[0].includes("Design confirmed") &&
                        thread.design[0].includes(`${DECISIONS} decisions`) &&
                        thread.bubbles === 0,
                    { reading, gone, stage: card.stage, clock: card.clock, text: card.text, design: thread.design, bubbles: thread.bubbles }
                );
            });

            // 8. Arc's record of the check says reading, stamped after the send: the clock shows
            await run("8. check clock", async (name) => {
                await setAgent({ record: { state: "reading" } });
                const clock = await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector("[data-chat-bscard-clock]")`, WAIT_MS);
                await polishNap(1500);
                const card = await readCard("check");
                await scrollEnd();
                await shot("8-check-clock");
                rec(
                    `${name}: with the check record reading, [data-chat-bscard-clock] shows an elapsed time and the stage is still reading`,
                    clock && card.stage === "reading" && /\d+:\d\d/.test(card.clock ?? ""),
                    { clock, stage: card.stage, text: card.clock }
                );
            });

            // 9. the builder's answer is in and the agent is not done: taking in
            await run("9. check taking in", async (name) => {
                await setAgent({ record: { state: "answered" } });
                const taking = await waitStage("taking-in");
                const card = await readCard("check");
                await scrollEnd();
                await shot("9-taking-in");
                rec(`${name}: with the record answered and the agent not done the stage is taking-in, with "${TAKING_IN}"`, taking && card.stage === "taking-in" && card.text.includes(TAKING_IN), { taking, stage: card.stage, text: card.text });
            });

            // 9b. a failed check with no file.check: the reason and Try again
            await run("9b. check failed", async (name) => {
                // the agent's turn ends (the sent check line is taken) and it writes the file again
                await setAgent({ record: { state: "failed", reason: FAILED_REASON }, ends: true });
                await writeBrainstorm(h, ctx, F7);
                const failed =
                    (await waitStage("failed")) &&
                    (await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector("[data-chat-bscard-retry]") && !${cardOf(A, "check")}?.querySelector("[data-chat-bscard-retry]")?.disabled`, WAIT_MS));
                await polishNap(400);
                const card = await readCard("check");
                await scrollEnd();
                await shot("9b-check-failed");
                rec(
                    `${name}: a failed record with no file.check: stage failed, its reason and an enabled Try again`,
                    failed && card.stage === "failed" && card.reason.includes(FAILED_REASON) && card.retry != null && card.retry.disabled === false,
                    { failed, stage: card.stage, reason: card.reason, retry: card.retry }
                );
            });

            // 9c. Try again sends check again; once appended it draws no second Design confirmed row
            await run("9c. try again", async (name) => {
                const sent = await sendVia("[data-chat-bscard-retry]");
                const line = "brainstorm: check";
                const taken = await turn(line, { ends: false });
                await polishNap(600);
                const thread = await readThread(line);
                await scrollEnd();
                await shot("9c-try-again");
                rec(
                    `${name}: Try again records "${line}" a second time; once appended there is still one [data-chat-bscard-done="design"] row and no bubble`,
                    sent.clicked === "clicked" && sent.text === line && taken && thread.design.length === 1 && thread.bubbles === 0,
                    { sent, taken, design: thread.design, bubbles: thread.bubbles }
                );
            });

            // 10. file.check with the builder's questions: question 1 with its options; a pick records builder answer: …
            await run("10. builder question", async (name) => {
                await put(C0, { record: { state: "answered" }, ends: true });
                const asking = (await waitStage("asking")) && (await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector('[data-chat-bscard-builder="1"]')`, WAIT_MS));
                await polishNap(600);
                await scrollEnd();
                const card = await readCard("check");
                await shot("10-builder-question");
                const sent = await sendVia('[data-chat-bscard-option="1"]');
                const line = `brainstorm: builder answer: ${ANSWER1}`;
                const taken = await turn(line, { file: C1 });
                const rowUp = await waitCount(BUILDER_ROWS, 1);
                await polishNap(600);
                const after = await readCard("check");
                const thread = await readThread(line);
                rec(
                    `${name}: Builder question 1 with ${Y1.options.length} options, Decide for me and the own-answer field; a pick records "${line}"; appended, the file on question 2, "✓ Builder question 1 · ${TEXT.policy.title} — ${ANSWER1}" in its place`,
                    asking &&
                        card.builder?.text.includes("Builder question 1") &&
                        card.builder.text.includes(TEXT.policy.title) &&
                        card.options === Y1.options.length &&
                        card.decide != null &&
                        card.own?.field === true &&
                        sent.clicked === "clicked" &&
                        sent.text === line &&
                        taken &&
                        rowUp &&
                        thread.builderAnswers.length === 1 &&
                        thread.builderAnswers[0].includes("Builder question 1") &&
                        thread.builderAnswers[0].includes(TEXT.policy.title) &&
                        thread.builderAnswers[0].includes(ANSWER1) &&
                        !thread.builderAnswers[0].includes("brainstorm: builder answer") &&
                        thread.bubbles === 0 &&
                        after.builder?.n === "2",
                    { asking, builder: card.builder, options: card.options, decide: card.decide, own: card.own, sent, taken, answered: thread.builderAnswers, bubbles: thread.bubbles, next: after.builder?.n }
                );
            });

            // 10b. Decide for me sends builder decide, which draws nothing
            await run("10b. decide for me", async (name) => {
                await put(C1, { record: { state: "answered" }, ends: true });
                await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector('[data-chat-bscard-builder="2"]')`, WAIT_MS);
                await polishNap(400);
                const sent = await sendVia("[data-chat-bscard-decide]");
                const line = "brainstorm: builder decide";
                const taken = await turn(line, { file: C2 });
                await polishNap(600);
                const after = await readCard("check");
                const thread = await readThread(line);
                await scrollEnd();
                await shot("10b-decide");
                rec(
                    `${name}: Decide for me records "${line}"; it draws no bubble and no ✓ row (one builder answer row stays), and the card moves on to question 3`,
                    sent.clicked === "clicked" && sent.text === line && taken && thread.bubbles === 0 && thread.builderAnswers.length === 1 && after.builder?.n === "3",
                    { sent, taken, bubbles: thread.bubbles, answered: thread.builderAnswers, next: after.builder?.n }
                );
            });

            // 10c. the own-answer field sends builder answer: <text>; the ✓ row shows the text without the prefix
            await run("10c. own words", async (name) => {
                await put(C2, { record: { state: "answered" }, ends: true });
                await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector('[data-chat-bscard-builder="3"]')`, WAIT_MS);
                await polishNap(400);
                const typed = await typeInto("[data-chat-bscard-own]", ANSWER3);
                const sent = await sendVia(clickOwnSend);
                const line = `brainstorm: builder answer: ${ANSWER3}`;
                const taken = await turn(line, { file: C3 });
                const rowUp = await waitCount(BUILDER_ROWS, 2);
                await polishNap(600);
                const after = await readCard("check");
                const thread = await readThread(line);
                await scrollEnd();
                await shot("10c-own-words");
                const row = thread.builderAnswers.find((t) => t.includes("Builder question 3"));
                rec(
                    `${name}: the own-answer field and its Send record "${line}"; the ✓ row reads "Builder question 3 · ${TEXT.limits.title} — ${ANSWER3}" without the prefix, and the stage is review`,
                    typed &&
                        sent.clicked === "clicked" &&
                        sent.text === line &&
                        taken &&
                        rowUp &&
                        row != null &&
                        row.includes(TEXT.limits.title) &&
                        row.includes(ANSWER3) &&
                        !row.includes("brainstorm: builder answer") &&
                        thread.bubbles === 0 &&
                        after.stage === "review",
                    { typed, sent, taken, answered: thread.builderAnswers, bubbles: thread.bubbles, stage: after.stage }
                );
            });

            // 11. the agent's calls and what the spec answered fold open
            await run("11. calls and spec folds", async (name) => {
                await put(C1, { record: { state: "answered" }, ends: true });
                await waitCard("check", "waiting");
                await polishNap(600);
                await scrollEnd();
                const closed = await readCard("check");
                await openFold("check", "calls");
                await openFold("check", "spec");
                const card = await readCard("check");
                await scrollEnd();
                await shot("11-calls-spec");
                rec(
                    `${name}: Agent's calls ${CALLS.length} and Answered by the spec ${SPEC_ANSWERED.length} start closed and open to one line per item`,
                    new RegExp(`Agent.s calls ${CALLS.length}\\b`).test(closed.calls?.text ?? "") &&
                        closed.calls.expanded === "false" &&
                        closed.calls.list == null &&
                        new RegExp(`Answered by the spec ${SPEC_ANSWERED.length}\\b`).test(closed.spec?.text ?? "") &&
                        closed.spec.expanded === "false" &&
                        card.calls?.expanded === "true" &&
                        card.calls.list?.lines === CALLS.length &&
                        CALLS.every((c) => card.calls.list.text.includes(c.text)) &&
                        card.spec?.expanded === "true" &&
                        card.spec.list?.lines === SPEC_ANSWERED.length &&
                        SPEC_ANSWERED.every((t) => card.spec.list.text.includes(t)),
                    { closedCalls: closed.calls, closedSpec: closed.spec, calls: card.calls, spec: card.spec }
                );
            });

            // 12a. the builder check's review draws a changed decision the same way: the − / + lines, the cause, and the
            // answer retention came from (answer 3)
            await run("12a. review: changed decision", async (name) => {
                await put(C3, { record: { state: "answered" }, ends: true });
                const review = (await waitStage("review")) && (await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector('[data-chat-bscard-decision="retention"]')`, WAIT_MS));
                await polishNap(600);
                await scrollEnd();
                const retention = await readChange("check", "retention");
                await shot("12a-review-diff");
                rec(
                    `${name}: the check's review draws the changed retention row with [data-diff-line="removed"] for the old sentence, [data-diff-line="added"] for the new body's sentences, [data-chat-bscard-why] with the cause, no Was: text and [data-brainstorm-said] for answer 3`,
                    review && drewChange(retention, "retention") && retention.saidCount === 1 && retention.said === `answer 3: “${ANSWER_RETENTION}”`,
                    { review, retention }
                );
            });

            // 12. the review with a changed row: Approve is off with its reason; once the change is kept it is on
            await run("12. review and approve", async (name) => {
                await put(C3, { record: { state: "answered" }, ends: true });
                const review = (await waitStage("review")) && (await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector('[data-chat-bscard-decision="retention"]')`, WAIT_MS));
                await polishNap(600);
                await scrollEnd();
                const blocked = await readCard("check");
                await shot("12-approve-blocked");
                const sent = await sendVia('[data-chat-bscard-decision="retention"] [data-chat-bscard-keep]');
                const line = "brainstorm: keep retention";
                const taken = await turn(line, { file: C4 });
                const on = await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector("[data-chat-bscard-approve]") && !${cardOf(A, "check")}?.querySelector("[data-chat-bscard-approve]")?.disabled`, WAIT_MS);
                const settled = await readCard("check");
                rec(
                    `${name}: with a changed row Approve is off and [data-chat-bscard-approve-reason] says why; Keep the change records "${line}"; with the file settled Approve is on and the reason is gone`,
                    review &&
                        rowOf(blocked, "retention")?.view === "changed" &&
                        blocked.approve?.disabled === true &&
                        /review 1 change/i.test(blocked.approveReason) &&
                        sent.clicked === "clicked" &&
                        sent.text === line &&
                        taken &&
                        on &&
                        settled.approve?.disabled === false &&
                        settled.approveReason === "",
                    { review, row: rowOf(blocked, "retention"), approve: blocked.approve, reason: blocked.approveReason, sent, taken, on, settledApprove: settled.approve, settledReason: settled.approveReason }
                );
            });

            // 12b. Approve (on) sends approved and opens the run launcher with the spec attached
            await run("12b. approve", async (name) => {
                await put(C4, { record: { state: "answered" }, ends: true });
                const on = await polishWaitFor(h, `!!${cardOf(A, "check")}?.querySelector("[data-chat-bscard-approve]") && !${cardOf(A, "check")}?.querySelector("[data-chat-bscard-approve]")?.disabled`, WAIT_MS);
                await polishNap(400);
                const sent = await sendVia("[data-chat-bscard-approve]");
                const launcher = await polishWaitFor(h, `!!${LAUNCHER}`, WAIT_MS);
                await polishNap(600);
                await shot("12b-approve-launcher");
                await h.ev(ESCAPE);
                const closed = await polishWaitFor(h, `!${LAUNCHER}`, SHORT_MS);
                const line = "brainstorm: approved";
                const taken = await turn(line, { file: C4 });
                const rowUp = await polishWaitFor(h, `[...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="builder"]') ?? [])].length >= 1`, SHORT_MS);
                const thread = await readThread(line);
                rec(
                    `${name}: Approve records "${line}" and opens the run launcher (closed after); once appended the line is "✓ Builder check · ${C4.check.yours.length} questions, ${CALLS.length} calls", with no bubble`,
                    on &&
                        sent.clicked === "clicked" &&
                        sent.text === line &&
                        launcher &&
                        closed &&
                        taken &&
                        rowUp &&
                        thread.builder.some((t) => t.includes("Builder check") && t.includes(`${C4.check.yours.length} questions`) && t.includes(`${CALLS.length} calls`) && !t.includes("kept talking")) &&
                        thread.bubbles === 0,
                    { on, sent, launcher, closed, taken, builder: thread.builder, bubbles: thread.bubbles }
                );
            });

            // 13. Keep talking sends keep talking; appended, it is the builder row marked kept talking
            await run("13. keep talking", async (name) => {
                await put(C4, { record: { state: "answered" }, ends: true });
                await waitCard("check", "waiting");
                await polishNap(600);
                const before = await readCard("check");
                const sent = await sendVia("[data-chat-bscard-keep-talking]");
                const line = "brainstorm: keep talking";
                const taken = await turn(line, { file: F13 });
                const rowUp = await polishWaitFor(h, `[...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="builder"]') ?? [])].some((r) => (r.textContent ?? "").includes("kept talking"))`, WAIT_MS);
                await polishNap(600);
                await scrollEnd();
                const question = await readCard("question");
                const thread = await readThread(line);
                await shot("13-keep-talking");
                const kept = thread.builder.filter((t) => t.includes("kept talking"));
                const counts = `${C4.check.yours.length} questions, ${CALLS.length} calls`;
                rec(
                    `${name}: Keep talking records "${line}"; appended, "✓ Builder check · ${counts} · kept talking" with no bubble; the agent's new question 1 is not hidden by the builder answer 1`,
                    before.keepTalking != null &&
                        sent.clicked === "clicked" &&
                        sent.text === line &&
                        taken &&
                        rowUp &&
                        kept.length === 1 &&
                        kept[0].includes(counts) &&
                        thread.bubbles === 0 &&
                        question.card &&
                        question.n === "1",
                    { keepTalking: before.keepTalking, sent, taken, builder: thread.builder, bubbles: thread.bubbles, question: { card: question.card, n: question.n, state: question.state } }
                );
            });

            // the line Arc sends when a run starts: sent through the page's own sendBrainstorm, since only the launcher's Start
            // sends it (and Start would start a real run)
            const sendRun = (runId) =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/brainstormsend.ts");
                    const D = await mod("app/view/agents/devmock.ts");
                    const agent = (globalStore.get(D.devMockAgentsAtom) ?? []).find((a) => a.id === ${JSON.stringify(A)});
                    if (!agent) return "no agent in the mock roster";
                    await S.sendBrainstorm(agent, { kind: "run", runId: ${JSON.stringify(runId)} });
                    return "sent";`
                ).catch((e) => `threw: ${String(e?.message ?? e)}`);
            // a run's card as the step reads it: the card, its stage, its kind line, Open run, nothing else at the end
            const runStep = async (mode, label, shotName, name) => {
                const runId = ctx.runs[mode];
                await put(designFile(V7, { run: runId }), { record: null, ends: true });
                const up = await waitCard("run");
                await polishNap(600);
                await scrollEnd();
                const card = await readCard("run");
                const line = `brainstorm: run ${runId}`;
                const before = (await records()).length;
                const said = await sendRun(runId);
                const fresh = (await records()).slice(before);
                const taken = await turn(line, { file: designFile(V7, { run: runId }) });
                await polishNap(500);
                const thread = await readThread(line);
                await scrollEnd();
                await shot(shotName);
                rec(
                    `${name}: file.run set to the ${mode} fixture run: the run card reads "${label}" and its stage, with Open run; the run line Arc sent (live run) draws neither a bubble nor a ✓ row`,
                    up &&
                        card.kinds.length === 1 &&
                        card.text.includes(label) &&
                        card.text.includes(GOALS[mode]) &&
                        card.runStage === "planning" &&
                        card.runOpen != null &&
                        said === "sent" &&
                        fresh[0]?.text === line &&
                        taken &&
                        thread.bubbles === 0 &&
                        thread.run.length === 0,
                    { up, kinds: card.kinds, stage: card.runStage, runOpen: card.runOpen, text: card.text, said, sent: fresh[0] ?? null, taken, bubbles: thread.bubbles, run: thread.run }
                );
            };

            // 14. the orchestrator run
            await run("14. orchestrator run card", (name) => runStep("orchestrator", "Orchestrator run", "14-run-orchestrator", name));

            // 14b. Open run goes to the run
            await run("14b. open run", async (name) => {
                await put(designFile(V7, { run: ctx.runs.orchestrator }), { record: null, ends: true });
                await waitCard("run");
                await polishNap(400);
                const from = await h.activeSurfaceLabel();
                const clicked = await click("[data-chat-bscard-run-open]");
                const sheet = await polishWaitFor(h, `!!document.querySelector("[data-run-sheet]")`, WAIT_MS);
                await polishNap(400);
                const to = await h.activeSurfaceLabel();
                await shot("14b-open-run");
                // back to the Agent surface for the steps after
                await AC.focusAgent(h, A);
                await waitCard("run");
                rec(`${name}: Open run leaves the Agent surface for the run's sheet`, clicked === "clicked" && sheet && from === "Agent" && to !== "Agent", { clicked, sheet, from, to });
            });

            // 15. the quick run
            await run("15. quick run card", (name) => runStep("quick", "Quick run", "15-run-quick", name));

            // 16. the run landed: no card and no empty end row; the run line is "✓ Run · <name> · Landed"
            await run("16. run landed", async (name) => {
                const runId = ctx.runs.quick;
                await put(designFile(V7, { run: runId }), { record: null, ends: true });
                await waitCard("run");
                await fstWriteRun(h, runId, (run) => ({ ...run, status: "done", completedts: Date.now(), basebranch: "main", land: { state: "landed", commit: SHA } }));
                const gone = await noCard("run");
                const rowUp = await waitCount('[data-chat-bscard-done="run"]', 1);
                await polishNap(700);
                await scrollEnd();
                const card = await readCard("run");
                const thread = await readThread(`brainstorm: run ${runId}`);
                const orch = await readThread(`brainstorm: run ${ctx.runs.orchestrator}`);
                await shot("16-run-landed");
                rec(
                    `${name}: with the run landed there is no run card and no empty end row; "✓ Run · ${GOALS.quick} · Landed" draws in place of the appended run line, and the live orchestrator run's line still draws nothing`,
                    gone &&
                        rowUp &&
                        !card.card &&
                        thread.endRows === 0 &&
                        thread.emptyEndRows === 0 &&
                        thread.lastEmpty === false &&
                        thread.run.length === 1 &&
                        thread.run[0].includes("Run") &&
                        thread.run[0].includes(GOALS.quick) &&
                        thread.run[0].includes("Landed") &&
                        thread.bubbles === 0 &&
                        orch.bubbles === 0,
                    { gone, rowUp, card: card.card, endRows: thread.endRows, emptyEndRows: thread.emptyEndRows, lastEmpty: thread.lastEmpty, run: thread.run, bubbles: thread.bubbles, orchBubbles: orch.bubbles }
                );
            });

            // 17. a Confirm state and the agent gone: static, no amber dot, every send button off, Open in Brainstorm kept
            await run("17. confirm card static", async (name) => {
                await put(F2, { record: null, ends: true });
                await waitCard("confirm", "waiting");
                await h.rpc("eventpublish", {
                    event: "controllerstatus",
                    scopes: [`block:${ctx.tab.blockId}`],
                    data: { blockid: ctx.tab.blockId, shellprocstatus: "done", shellprocexitcode: 1 },
                });
                ctx.exited = true;
                const isStatic = await waitCard("confirm", "static");
                await polishNap(600);
                await scrollEnd();
                const card = await readCard("confirm");
                await shot("17-confirm-static");
                await h.rpc("eventpublish", {
                    event: "controllerstatus",
                    scopes: [`block:${ctx.tab.blockId}`],
                    data: { blockid: ctx.tab.blockId, shellprocstatus: "running", shellprocexitcode: 0 },
                });
                ctx.exited = false;
                rec(
                    `${name}: once the agent has exited the Confirm card is in state static with no amber dot, every send button off, and [data-chat-bscard-open] still there`,
                    isStatic &&
                        card.state === "static" &&
                        !card.amber &&
                        !card.waitingText &&
                        card.sendButtons.length > 0 &&
                        card.sendButtons.every((d) => d === true) &&
                        card.open,
                    { isStatic, state: card.state, amber: card.amber, waitingText: card.waitingText, sendButtons: card.sendButtons, open: card.open }
                );
            });

            // 18. a brainstorm: line typed by hand has no record: it stays a bubble, and the lines Arc sent stay hidden
            await run("18. typed line stays a bubble", async (name) => {
                const line = "brainstorm: check";
                const taken = await turn(line, { ends: false });
                await polishNap(700);
                await scrollEnd();
                const thread = await readThread(line);
                await shot("18-typed-bubble");
                rec(
                    `${name}: a "${line}" appended after the two Arc sent has no record, so it is the one bubble holding that text`,
                    taken && thread.bubbles === 1,
                    { taken, bubbles: thread.bubbles }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-brainstorm-review teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the launcher", () => h.ev(`(() => { if (${LAUNCHER}) ${ESCAPE}; return true; })()`));
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
            if (ctx.channelId != null) {
                // a landed run refuses a cancel; the rest are deferred and cancel at once
                for (const runId of Object.values(ctx.runs ?? {})) {
                    await step(`cancel run ${runId}`, () => h.rpc("cancelrun", { channelid: ctx.channelId, runid: runId }));
                }
                await step("delete the runs' channel", () => h.rpc("deletechannel", { channelid: ctx.channelId }));
            }
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
            // wavesrv's transcript watch and the canvas server can hold a fixture for a moment after their agent is gone
            for (const dir of [ctx.dir, ctx.cwd, ctx.runDir]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
