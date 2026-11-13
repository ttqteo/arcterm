// The reviewer's verdict, the plan handoff and the runs a conversation started, as cards in Chat
// (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md, plan 2026-11-13-chat-verdict-handoff-part2.md Task 1).
// Chat draws an ```arc-review block or a `ReportFindings` call as a verdict card with ticks and Fix / Skip, the AskUserQuestion
// with header `Handoff` as a four-row handoff card, and every run the conversation started as a run card at the
// `wsh runs start` call that started it (queued state included); each folds into its own ✓ row. It is written against the
// plan's DOM contract, not against the components:
//   verdict card   [data-chat-bscard-kind="verdict"][data-chat-bscard-state="waiting|working|static"][data-chat-vcard="<key>"]
//                  [data-chat-vcard-chip="changes|approved"], [data-chat-vcard-note], [data-chat-vcard-open] (Open the review)
//                  [data-chat-vcard-finding="<i>"][data-severity="Critical|Important|Minor"]
//                    [data-chat-vcard-tick][aria-checked], [data-chat-vcard-loc] (file:line link), [data-chat-vcard-summary]
//                  [data-chat-vcard-fix] ("Fix N selected" / "Fix none"), [data-chat-vcard-skip], [data-chat-vcard-error]
//   handoff card   [data-chat-bscard-kind="handoff"][data-chat-bscard-state="waiting|static"], in the dock's [data-chat-ask] while
//                  the agent waits; [data-chat-hcard-plan-open], [data-chat-hcard-title], [data-chat-hcard-facts],
//                  [data-chat-hcard-row="A|B|C|D"][data-choice="<label>"] (a button, disabled when not offered),
//                  [data-chat-hcard-recommended] inside the recommended row
//   run card       [data-chat-bscard-kind="run"][data-chat-run-card="<runId or entryId>"], [data-chat-bscard-run-stage="<stage>|queued"],
//                  [data-chat-run-queued] (the Queued line), [data-chat-bscard-run-open]
//   ✓ rows         [data-chat-bscard-done="verdict|handoff|run"]; a run row with an ended message also
//                  [data-chat-run-ended][aria-expanded] and, open, [data-chat-run-ended-text]
//
// One fixture Claude agent over a real tab with a shell controller (so a line sent to it has somewhere to go; the shell's
// folder is the project, so a relative path resolves), a mock roster row for it, a throwaway git project registered with the
// app, a fixture transcript the steps append to the way Claude Code writes it, a reviewer subagent's transcript beside it,
// and fixture runs (deferred, so nothing starts them) in a channel of their own. A button is clicked and the line Arc sent
// is read from the page's send record (`chat.brainstorm.sent`), then appended to the transcript as the user message the agent
// received, so it pairs. The page's own answeragent call is recorded and never forwarded, so no real agent gets an answer.
// Every fixture run a step puts in the conversation is made with `origintabid` set to the fixture tab, whose block meta names
// the fixture transcript (`agent:transcriptpath`), so the server sets `origintranscript` as CreateRunCommand does: the origin
// index (runoriginstore.ts) keeps only runs with an origintabid.
//
// A sub-step (1b, 2b, 3b, 7b, 7c) has its own shot and its own assert, and starts by writing the state it needs, so a failed
// step does not take the next with it. Steps 7, 7b and 7c have the agent write on after the Bash call that started the run
// before the `[arc] Run …` message arrives, so the run's item is not the last item.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat verdict handoff main";
const PROJECT = "verify-chat-verdict-handoff";
const TOPIC = "sync-retry-handoff";
const SESSION = "chat-verdict-handoff-main";
const SENT_KEY = "chat.brainstorm.sent";
const HINTS_KEY = "brainstorm.hintsSeen";
const VERDICT_TOPIC = "arc:verdict";
const WAIT_MS = 15000;
const SHORT_MS = 5000;
const RECORD_WAIT_MS = 8000;
const RPC = { timeout: 30000 };
const SHA = "78671429d0c4f1e2a3b4c5d6e7f8091a2b3c4d5e";

const CLIENT = "src/sync/client.ts";
const PLAN_REL = "docs/superpowers/plans/2026-11-13-sync-retry.md";
const PLAN_TITLE = "Sync client retries";

// what the reviewers were asked; a subagent's file is paired with its Agent call by this text, word for word
const P1 = "Review the retry loop in src/sync/client.ts for correctness bugs and report each finding with its severity.";
const P2 = "Review the retry change in src/sync/retry.ts for naming and style and report each finding with its severity.";
const DESC1 = "review the sync client";
const DESC2 = "review the retry change";

// the verdicts the agent writes
const V1 = {
    kind: "code",
    reviewer: "code-reviewer",
    pass: false,
    note: "Two things to fix before this lands.",
    subagent: DESC1,
    findings: [
        { severity: "Important", file: CLIENT, line: 12, summary: "The retry loop never stops when the server answers 401." },
        { severity: "Important", file: CLIENT, line: 31, summary: "A cancelled request still schedules its next attempt." },
        { severity: "Minor", file: CLIENT, line: 48, summary: "The attempt counter is logged before it is incremented." },
    ],
};
const V2 = {
    kind: "code",
    reviewer: "code-reviewer",
    pass: false,
    note: "One blocker.",
    findings: [{ severity: "Critical", file: CLIENT, line: 7, summary: "The backoff delay overflows after thirty attempts." }],
};
const V3 = {
    kind: "code",
    reviewer: "code-reviewer",
    pass: false,
    note: "Two naming nits.",
    subagent: DESC2,
    findings: [
        { severity: "Minor", file: "src/sync/retry.ts", line: 4, summary: "retryCount reads as a total, not a limit." },
        { severity: "Minor", file: "src/sync/retry.ts", line: 19, summary: "The helper name says nothing about backoff." },
    ],
};
const RF_FINDINGS = [
    { file: CLIENT, line: 20, summary: "The jitter is added after the cap, so a delay can pass it.", verdict: "CONFIRMED" },
    { file: CLIENT, line: 55, summary: "The retry log line has no attempt number.", verdict: "PLAUSIBLE" },
];
// the line Fix sends for the Minor finding of V1 alone (chatverdict.ts fixLine)
const FIX_LINE_MINOR = ["Fix these review findings:", `- ${CLIENT}:48 — ${V1.findings[2].summary}`].join("\n");
const SKIP_LINE = "Skip the review: go on without these changes.";

// the plan the handoff names: 5 tasks, Tasks 2 and 3 side by side
const PLAN_TEXT = [
    `# ${PLAN_TITLE}`,
    "",
    "**Goal:** a sync client that survives a flaky network.",
    "",
    "### Task 1: The retry policy",
    "**Depends on:** none",
    "",
    "Write the policy.",
    "",
    "### Task 2: Backoff",
    "**Depends on:** Task 1",
    "",
    "Wait longer after each failure.",
    "",
    "### Task 3: The retry log",
    "**Depends on:** Task 1",
    "",
    "Log each attempt.",
    "",
    "### Task 4: Wire it in",
    "**Depends on:** Task 2, Task 3",
    "",
    "Use both in the client.",
    "",
    "### Task 5: Docs",
    "**Depends on:** Task 4",
    "",
    "Say what changed.",
    "",
].join("\n");

const GOALS = {
    plan: "verify chat-verdict-handoff: the plan's engine run",
    plain: "verify chat-verdict-handoff: the plain run",
    held: "verify chat-verdict-handoff: the held run",
    brainstorm: "verify chat-verdict-handoff: the brainstorm's held run",
    after: "verify chat-verdict-handoff: the run the queue waits on",
    queued: "verify chat-verdict-handoff: the queued run",
};

// --- page expressions -----------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const scrollerOf = (id) => `document.querySelector('[data-agent-chat="${id}"] .overflow-y-auto')`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const cardOf = (id, kind) => `${layerOf(id)}?.querySelector('[data-chat-bscard-kind="${kind}"]')`;
// helpers every reading shares: a node or one inside it, a button's text and off state, an attribute of either
const HELP = `
const flat = ${FLAT};
const pick = (el, sel) => (el ? (el.matches(sel) ? el : el.querySelector(sel)) : null);
const btn = (root, sel) => { const e = pick(root, sel); return e ? { text: flat(e), disabled: e.disabled === true } : null; };
const attr = (root, sel, name) => pick(root, sel)?.getAttribute(name) ?? null;
`;
// the interior of a subagent: the breadcrumb's bar sits in its pane (scenarios-agent-subagents.mjs)
const INTERIOR = `document.querySelector('button[title="Back to parent (Esc)"]')?.parentElement?.parentElement`;
// the open file tabs of the Agent panel, as absolute paths with forward slashes
const RAIL_FILES = `[...document.querySelectorAll("[data-rail-file]")].map((e) => (e.getAttribute("data-rail-file") ?? "").replace(/\\\\/g, "/").toLowerCase())`;

const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const id8 = (runId) => runId.slice(0, 8);

const block = (obj) => ["```arc-review", JSON.stringify(obj), "```"].join("\n");

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, waitForProjectInConfig, UI_ROUTE, GRID_KEY, GRID_EMPTY, bsSeeHints, fstWriteRun } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", SENT_KEY, HINTS_KEY];

    // a record's time: real time, strictly after the one before, so the transcript reads in the order it was written
    const stamp = (ctx) => {
        ctx.last = Math.max((ctx.last ?? 0) + 1, Date.now());
        return { cwd: ctx.cwd, ts: new Date(ctx.last).toISOString() };
    };
    const append = (ctx, ...lines) => appendFileSync(ctx.transcript, lines.join("\n") + "\n");

    // the roster row of the one agent: idle since `ctx.idleSince`, or asking `ctx.ask` (the handoff) with no idle stamp
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

    // the brainstorm file of step 7c, written and read by the page now: the agent's hook reveals after each write
    async function writeBrainstorm(h, ctx, file) {
        mkdirSync(dirname(ctx.bsFile), { recursive: true });
        writeFileSync(ctx.bsFile, JSON.stringify(file, null, 2));
        await h.rpc("uireveal", { address: `brainstorm:${TOPIC}`, callerblockid: ctx.tab.blockId, callercwd: ctx.cwd }, UI_ROUTE);
    }
    const brainstormFile = (run) => ({
        v: 1,
        title: PLAN_TITLE,
        spec: "docs/superpowers/specs/2026-11-12-sync-retry-design.md",
        canvas: TOPIC,
        question: null,
        working: null,
        parts: [
            { id: "intent", title: "Intent and why", body: "The sync client survives a flaky network.", gist: "The sync client survives a flaky network.", state: "yours" },
            { id: "scope", title: "What it covers", body: "Only the client's own requests.", gist: "Only the client's own requests.", state: "yours" },
        ],
        history: [],
        done: true,
        check: null,
        run,
    });

    const scenario = {
        name: "chat-verdict-handoff",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-cvh-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-cvh-project-")),
                runDir: mkdtempSync(join(tmpdir(), "verify-cvh-runs-")),
                prev: {},
                idleSince: Date.now() - 60_000,
                ask: null,
                turns: 0,
                runs: {},
                entries: [],
            };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                ctx.prevRail = await AC.agentPage(h, `const R = await mod("app/view/agents/railstore.ts"); return globalStore.get(R.railVisibleAtom);`);

                at = "making the project";
                const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.cwd, "README.md"), "# sync client\n");
                for (const rel of [CLIENT, "src/sync/retry.ts"]) {
                    mkdirSync(dirname(join(ctx.cwd, rel)), { recursive: true });
                    writeFileSync(join(ctx.cwd, rel), Array.from({ length: 60 }, (_, i) => `// ${rel} line ${i + 1}`).join("\n") + "\n");
                }
                ctx.plan = join(ctx.cwd, ...PLAN_REL.split("/"));
                mkdirSync(dirname(ctx.plan), { recursive: true });
                writeFileSync(ctx.plan, PLAN_TEXT);
                git("add", ".");
                git("commit", "-qm", "seed");
                ctx.bsFile = join(ctx.cwd, ".superpowers", "brainstorm", TOPIC, "brainstorm.json");
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.cwd, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 4; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the sync client work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. The sync client retries a failed request, and each attempt logs what it sent.`, o(i * 10 + 2)));
                }
                lines.push(AC.userText("review the retry loop in the sync client", o(300)));
                lines.push(AC.assistantText("A reviewer will read the retry loop.", o(302)));
                lines.push(AC.toolUse("toolu_cvh_review1", "Agent", { subagent_type: "superpowers:code-reviewer", description: DESC1, prompt: P1 }, o(304)));
                lines.push(AC.toolResult("toolu_cvh_review1", "The review found three things.", o(330)));
                lines.push(AC.assistantText(`The reviewer is done. Here is what it found.\n\n${block(V1)}\n\nTell me which of these to fix.`, o(332)));
                ctx.transcript = AC.writeTranscript(ctx.dir, SESSION, lines);
                ctx.last = Date.now();
                // the reviewer's own transcript, where Claude Code writes it: its first prompt is the Agent call's, word for word
                AC.writeSubagent(ctx.dir, SESSION, "cvhrev1", [
                    AC.userText(P1, o(305)),
                    AC.toolUse("toolu_cvhrev1_read", "Read", { file_path: join(ctx.cwd, CLIENT) }, o(310)),
                    AC.toolResult("toolu_cvhrev1_read", "export function sync() {}", o(311)),
                    AC.assistantText("Three findings in the retry loop.", o(320)),
                ]);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(SENT_KEY)})`);
                // the Brainstorm pane's first-open hint card is not what this scenario reads
                if (typeof bsSeeHints === "function") await bsSeeHints(h);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tab";
                // a shell controller in the project's folder: a line sent to the agent is typed there, and a relative path the
                // agent names resolves against it. The block names the fixture transcript, so a run made with this tab as its
                // origin gets origintranscript from the server
                ctx.tab = await makeTab(h, ctx, {
                    label: NAME,
                    blockMeta: { view: "term", controller: "shell", "cmd:cwd": ctx.cwd, "agent:transcriptpath": ctx.transcript },
                });

                at = "making the runs' channel";
                const ch = await h.rpc("createchannel", { name: "verify-chat-verdict-handoff", projectpath: ctx.runDir });
                ctx.channelId = ch.oid;

                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));

                at = "recording the ask answers";
                // the page's own answeragent call is recorded and resolved here, never forwarded
                await h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (!c.__cvhOrig) {
                        c.__cvhOrig = c.wshRpcCall;
                        const call = c.wshRpcCall.bind(c);
                        c.wshRpcCall = (command, data, opts) => {
                            if (command !== "answeragent") return call(command, data, opts);
                            window.__cvhAnswers.push(data);
                            return Promise.resolve(null);
                        };
                    }
                    window.__cvhAnswers = [];
                    return true;
                })()`);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent, its project, its channel and its transcript", false, ctx.arrangeError);
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
                    await h.shot(`cdp-shots/chat-verdict-handoff-${name}.png`);
                } catch (e) {
                    console.error(`chat-verdict-handoff: the shot ${name} failed: ${e?.message ?? e}`);
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
            const waitCard = (kind, state, ms = WAIT_MS) =>
                polishWaitFor(h, `(${cardOf(A, kind)}?.getAttribute("data-chat-bscard-state") ?? null) ${state == null ? "!== null" : `=== ${JSON.stringify(state)}`}`, ms);
            const noCard = (kind, ms = WAIT_MS) => polishWaitFor(h, `${cardOf(A, kind)} == null`, ms);
            const waitText = (text, ms = WAIT_MS) => polishWaitFor(h, `(${layerOf(A)}?.textContent ?? "").includes(${JSON.stringify(text)})`, ms);
            // a ✓ row of a kind whose text holds the needle
            const waitRow = (kind, needle, ms = WAIT_MS) =>
                polishWaitFor(h, `[...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="${kind}"]') ?? [])].some((e) => ${FLAT}(e).includes(${JSON.stringify(needle)}))`, ms);
            const waitRunCard = (runId, ms = WAIT_MS) => polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-run-card="${runId}"]')`, ms);
            const noRunCard = (runId, ms = WAIT_MS) => polishWaitFor(h, `!${layerOf(A)}?.querySelector('[data-chat-run-card="${runId}"]')`, ms);

            // the agent's side: whether its turn has ended (idle since now) and the ask it is waiting on, if any
            const setAgent = async ({ ends = false, ask } = {}) => {
                if (ask !== undefined) ctx.ask = ask;
                if (ends) ctx.idleSince = Date.now();
                await AC.setRoster(h, rosterRows(ctx));
            };
            // the agent takes a line: the user message lands in the transcript with a reply after it (its text is what proves
            // the line was read), then its turn ends
            const turn = async (line, { ends = true } = {}) => {
                ctx.turns += 1;
                const marker = `Noted ${ctx.turns}: the line was taken in.`;
                append(ctx, ...(line != null ? [AC.userText(line, stamp(ctx))] : []), AC.assistantText(marker, stamp(ctx)));
                await setAgent({ ends });
                return waitText(marker);
            };

            // the send record of this agent, newest last: the page's store, or localStorage where the store is out of reach
            const records = async () => {
                const viaModule = await AC.agentPage(h, `const S = await mod("app/view/agents/chatbrainstormstore.ts"); return S.brainstormAnswers(${JSON.stringify(A)});`).catch(() => null);
                const viaStorage = await h.ev(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SENT_KEY)}) ?? "{}")[${JSON.stringify(A)}] ?? []; } catch { return []; } })()`);
                return Array.isArray(viaModule) && viaModule.length >= viaStorage.length ? viaModule : viaStorage;
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
            // a click, then the record it left: { clicked, record, count }
            const sendVia = async (sel) => {
                const before = (await records()).length;
                const clicked = await click(sel);
                let fresh = [];
                for (let waited = 0; waited < RECORD_WAIT_MS; waited += 250) {
                    fresh = (await records()).slice(before);
                    if (fresh.length > 0) break;
                    await polishNap(250);
                }
                return { clicked, record: fresh[0] ?? null, count: fresh.length };
            };

            // the verdict card as it is drawn now
            const readVerdict = () =>
                h.ev(`(() => {
                    ${HELP}
                    const layer = ${layerOf(A)};
                    const cards = [...(layer?.querySelectorAll('[data-chat-bscard-kind="verdict"]') ?? [])];
                    const card = cards[0] ?? null;
                    return {
                        cards: cards.length,
                        state: card?.getAttribute("data-chat-bscard-state") ?? null,
                        key: card?.getAttribute("data-chat-vcard") ?? null,
                        chip: attr(card, "[data-chat-vcard-chip]", "data-chat-vcard-chip"),
                        note: flat(pick(card, "[data-chat-vcard-note]")),
                        open: !!pick(card, "[data-chat-vcard-open]"),
                        findings: [...(card?.querySelectorAll("[data-chat-vcard-finding]") ?? [])].map((r) => ({
                            i: r.getAttribute("data-chat-vcard-finding"),
                            severity: r.getAttribute("data-severity"),
                            hasTick: !!pick(r, "[data-chat-vcard-tick]"),
                            ticked: attr(r, "[data-chat-vcard-tick]", "aria-checked"),
                            loc: flat(pick(r, "[data-chat-vcard-loc]")),
                            summary: flat(pick(r, "[data-chat-vcard-summary]")),
                        })),
                        fix: btn(card, "[data-chat-vcard-fix]"),
                        skip: btn(card, "[data-chat-vcard-skip]"),
                        error: flat(pick(card, "[data-chat-vcard-error]")),
                        ticksInLayer: layer?.querySelectorAll("[data-chat-vcard-tick]").length ?? 0,
                    };
                })()`);
            // the handoff card in the dock, the ones in the conversation, and what the dock's card shows
            const readHandoff = () =>
                h.ev(`(() => {
                    ${HELP}
                    const layer = ${layerOf(A)};
                    const dock = layer?.querySelector("[data-chat-ask]");
                    const card = dock?.querySelector('[data-chat-bscard-kind="handoff"]') ?? null;
                    return {
                        dock: !!dock,
                        cards: layer?.querySelectorAll('[data-chat-bscard-kind="handoff"]').length ?? 0,
                        state: card?.getAttribute("data-chat-bscard-state") ?? null,
                        planOpen: btn(card, "[data-chat-hcard-plan-open]"),
                        title: flat(pick(card, "[data-chat-hcard-title]")),
                        facts: flat(pick(card, "[data-chat-hcard-facts]")),
                        rows: [...(card?.querySelectorAll("[data-chat-hcard-row]") ?? [])].map((r) => ({
                            letter: r.getAttribute("data-chat-hcard-row"),
                            choice: r.getAttribute("data-choice"),
                            disabled: r.disabled === true,
                            recommended: !!r.querySelector("[data-chat-hcard-recommended]"),
                            text: flat(r),
                        })),
                        recommended: card?.querySelectorAll("[data-chat-hcard-recommended]").length ?? 0,
                    };
                })()`);
            // every run card of the layer
            const readRuns = () =>
                h.ev(`(() => {
                    ${HELP}
                    return [...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-kind="run"]') ?? [])].map((c) => ({
                        id: c.getAttribute("data-chat-run-card"),
                        state: c.getAttribute("data-chat-bscard-state"),
                        stage: attr(c, "[data-chat-bscard-run-stage]", "data-chat-bscard-run-stage"),
                        queued: pick(c, "[data-chat-run-queued]") ? flat(pick(c, "[data-chat-run-queued]")) : null,
                        open: !!pick(c, "[data-chat-bscard-run-open]"),
                        text: flat(c).slice(0, 300),
                    }));
                })()`);
            const readRows = (kind) =>
                h.ev(`(() => {
                    ${HELP}
                    return [...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="${kind}"]') ?? [])].map((r) => ({
                        text: flat(r),
                        ended: pick(r, "[data-chat-run-ended]") ? { expanded: attr(r, "[data-chat-run-ended]", "aria-expanded") } : null,
                    }));
                })()`);
            // the bubbles holding a text, the other lines Arc hid, and whether anything is last but empty
            const readBubbles = (needle) =>
                h.ev(`(() => {
                    ${HELP}
                    return [...(${layerOf(A)}?.querySelectorAll("[data-chat-you]") ?? [])].filter((e) => flat(e).includes(${JSON.stringify(needle)})).length;
                })()`);
            // the cards' order in the document: whether the first element comes before the second
            const before = (firstSel, secondSel) =>
                h.ev(`(() => {
                    const layer = ${layerOf(A)};
                    const a = layer?.querySelector(${JSON.stringify(firstSel)});
                    const b = layer?.querySelector(${JSON.stringify(secondSel)});
                    return a && b ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
                })()`);
            const tick = (i) => `[data-chat-vcard-finding="${i}"] [data-chat-vcard-tick]`;
            const focusSub = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/subagentsstore.ts");
                    const f = globalStore.get(S.focusSubagentAtom);
                    return f ? { parentId: f.parentId, agentId: f.agentId, transcriptPath: f.transcriptPath, label: f.label } : null;`
                );
            const closeSub = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/subagentsstore.ts");
                    globalStore.set(S.focusSubagentAtom, null);
                    return true;`
                );
            const exitAgent = (status, code) =>
                h.rpc("eventpublish", {
                    event: "controllerstatus",
                    scopes: [`block:${ctx.tab.blockId}`],
                    data: { blockid: ctx.tab.blockId, shellprocstatus: status, shellprocexitcode: code },
                });
            // the line Arc sends when a run starts, sent through the page's own sendBrainstorm
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

            // a fixture run: deferred, so nothing starts it. With an origin it is the fixture tab's (the server sets
            // origintranscript from the block's agent:transcriptpath); without, it is one the cockpit launcher made
            const makeRun = async (key, { goal, mode, origin = true }) => {
                const created = await h.rpc(
                    "createrun",
                    {
                        channelid: ctx.channelId,
                        workspaceid: ctx.workspaceId,
                        goal,
                        runtime: "claude",
                        mode,
                        deferstart: true,
                        ...(origin ? { origintabid: A } : {}),
                    },
                    RPC
                );
                const id = created.run.id;
                ctx.runs[key] = id;
                if (origin && norm(created.run.origintranscript) !== norm(ctx.transcript)) {
                    throw new Error(`the run ${key} has origintranscript ${JSON.stringify(created.run.origintranscript ?? null)}, not the fixture transcript`);
                }
                return id;
            };
            const heldLand = (runId, reason) =>
                fstWriteRun(h, runId, (r) => ({ ...r, land: { state: "held", reason, fixture: true } }));
            // the Bash call that started a run, and its output
            const startCall = (callId, command, output) => [
                AC.toolUse(callId, "Bash", { command, description: "Start the run" }, stamp(ctx)),
                AC.toolResult(callId, output, stamp(ctx)),
            ];
            const startedOut = (runId, mode) => `started run ${runId} (${mode}, planning) in ${PROJECT}`;

            // 1. the verdict card, waiting: the block after a reviewer's Agent call, three findings
            await run("1. verdict card waiting", async (name) => {
                await AC.focusAgent(h, A);
                await setAgent({ ends: true });
                const up = await waitCard("verdict", "waiting");
                // the card finds its reviewer once the subagent list has loaded
                const open = await polishWaitFor(h, `!!${cardOf(A, "verdict")}?.querySelector("[data-chat-vcard-open]")`, WAIT_MS);
                await polishNap(500);
                await scrollEnd();
                const card = await readVerdict();
                await shot("1-verdict-waiting");
                rec(
                    `${name}: the card is waiting, chip changes, its note, 3 findings (Important, Important, Minor) with the two Important ticked, Fix 2 selected, Skip the review and Open the review`,
                    up &&
                        open &&
                        card.cards === 1 &&
                        card.state === "waiting" &&
                        (card.key ?? "").startsWith("verdict:") &&
                        card.chip === "changes" &&
                        card.note.includes(V1.note) &&
                        card.findings.length === 3 &&
                        card.findings.map((f) => f.severity).join() === "Important,Important,Minor" &&
                        card.findings.every((f) => f.hasTick) &&
                        card.findings.map((f) => f.ticked).join() === "true,true,false" &&
                        card.findings.every((f, i) => f.loc.includes(`${CLIENT}:${V1.findings[i].line}`) && f.summary.includes(V1.findings[i].summary)) &&
                        card.fix?.text === "Fix 2 selected" &&
                        card.fix.disabled === false &&
                        card.skip?.text === "Skip the review" &&
                        card.skip.disabled === false &&
                        card.open,
                    { up, open, ...card }
                );
            });

            // 1b. Open the review opens the subagent's interior; a finding's file:line opens the file
            await run("1b. open the review and the file", async (name) => {
                await AC.focusAgent(h, A);
                await waitCard("verdict", "waiting");
                await polishWaitFor(h, `!!${cardOf(A, "verdict")}?.querySelector("[data-chat-vcard-open]")`, WAIT_MS);
                const opened = await click("[data-chat-vcard-open]");
                let sub = null;
                const focused = await until(async () => (sub = await focusSub()) != null);
                const interiorUp = await polishWaitFor(h, `(${FLAT}(${INTERIOR})).includes("client.ts")`, WAIT_MS);
                const interior = await h.ev(`${FLAT}(${INTERIOR})`);
                await polishNap(300);
                await shot("1b-review-interior");
                // back to the Chat for the file link
                await closeSub();
                await AC.focusAgent(h, A);
                const backUp = await waitCard("verdict", "waiting");
                await polishNap(400);
                const loc = await click('[data-chat-vcard-finding="0"] [data-chat-vcard-loc]');
                const fileOpen = await polishWaitFor(h, `${RAIL_FILES}.some((p) => p.endsWith(${JSON.stringify(CLIENT)}))`, WAIT_MS);
                await polishNap(400);
                await shot("1b-file-open");
                const files = await h.ev(RAIL_FILES);
                rec(
                    `${name}: Open the review focuses the reviewer's subagent under this agent and its interior shows what it read; the first finding's file:line opens ${CLIENT} in the agent's panel`,
                    opened === "clicked" &&
                        focused &&
                        sub?.parentId === A &&
                        String(sub?.transcriptPath ?? "").replace(/\\/g, "/").endsWith("/agent-cvhrev1.jsonl") &&
                        interiorUp &&
                        backUp &&
                        loc === "clicked" &&
                        fileOpen,
                    { opened, focused, sub, interiorUp, interior: interior.slice(0, 200), backUp, loc, fileOpen, files }
                );
            });

            // 2. untick both Important and tick the Minor: Fix 1 selected; Fix records and sends the line, which folds the card
            await run("2. Fix", async (name) => {
                await AC.focusAgent(h, A);
                await waitCard("verdict", "waiting");
                await polishNap(400);
                const key = (await readVerdict()).key;
                const clicks = [await click(tick(2)), await click(tick(0)), await click(tick(1))];
                const label = await until(async () => (await readVerdict()).fix?.text === "Fix 1 selected", SHORT_MS);
                const ticked = await readVerdict();
                await scrollEnd();
                await shot("2-fix-one");
                const sent = await sendVia("[data-chat-vcard-fix]");
                const r = sent.record;
                const taken = await turn(r?.text ?? FIX_LINE_MINOR);
                const rowUp = await waitRow("verdict", "— Fix 1");
                const gone = await noCard("verdict", SHORT_MS);
                await polishNap(500);
                await scrollEnd();
                const rows = await readRows("verdict");
                const bubbles = await readBubbles("Fix these review findings");
                await shot("2-fix-folded");
                rec(
                    `${name}: the Minor ticked and both Important unticked read Fix 1 selected; Fix records topic ${VERDICT_TOPIC} kind verdict outcome fix fixed 1 with the line "${FIX_LINE_MINOR.replace(/\n/g, " ⏎ ")}"; once appended the card is gone, "Code review · Changes requested · 3 findings — Fix 1" is its ✓ row and the line draws no bubble`,
                    clicks.every((c) => c === "clicked") &&
                        label &&
                        ticked.findings.map((f) => f.ticked).join() === "false,false,true" &&
                        sent.clicked === "clicked" &&
                        sent.count === 1 &&
                        r?.topic === VERDICT_TOPIC &&
                        r.kind === "verdict" &&
                        r.verdictOutcome === "fix" &&
                        r.fixed === 1 &&
                        r.verdictKey === key &&
                        r.text === FIX_LINE_MINOR &&
                        taken &&
                        rowUp &&
                        gone &&
                        rows.length === 1 &&
                        rows[0].text.includes("Code review · Changes requested · 3 findings — Fix 1") &&
                        bubbles === 0,
                    { clicks, label, ticked: ticked.findings.map((f) => f.ticked), key, sent, taken, rowUp, gone, rows, bubbles }
                );
            });

            // 2b. a second waiting verdict (a new reply with another block): Skip records skip and sends its line
            await run("2b. Skip", async (name) => {
                append(ctx, AC.assistantText(`That is fixed. I had the reviewer look at the backoff as well.\n\n${block(V2)}`, stamp(ctx)));
                await setAgent({ ends: true });
                await AC.focusAgent(h, A);
                const up = await waitCard("verdict", "waiting");
                await polishNap(500);
                await scrollEnd();
                const card = await readVerdict();
                await shot("2b-second-verdict");
                const sent = await sendVia("[data-chat-vcard-skip]");
                const r = sent.record;
                const taken = await turn(r?.text ?? SKIP_LINE);
                const rowUp = await waitRow("verdict", "— Skipped");
                const gone = await noCard("verdict", SHORT_MS);
                await polishNap(500);
                await scrollEnd();
                const rows = await readRows("verdict");
                const bubbles = await readBubbles(SKIP_LINE);
                await shot("2b-skipped");
                const skipped = rows.filter((x) => x.text.includes("— Skipped"));
                rec(
                    `${name}: the second verdict (1 Critical finding, ticked) is waiting; Skip the review records outcome skip and the line "${SKIP_LINE}"; once appended the card is gone, its ✓ row ends "— Skipped" and the line draws no bubble`,
                    up &&
                        card.state === "waiting" &&
                        card.findings.length === 1 &&
                        card.findings[0].severity === "Critical" &&
                        card.findings[0].ticked === "true" &&
                        card.fix?.text === "Fix 1 selected" &&
                        sent.clicked === "clicked" &&
                        sent.count === 1 &&
                        r?.topic === VERDICT_TOPIC &&
                        r.kind === "verdict" &&
                        r.verdictOutcome === "skip" &&
                        r.text === SKIP_LINE &&
                        taken &&
                        rowUp &&
                        gone &&
                        skipped.length === 1 &&
                        /1 finding — Skipped$/.test(skipped[0].text.trim()) &&
                        rows.length === 2 &&
                        bubbles === 0,
                    { up, card: { state: card.state, findings: card.findings, fix: card.fix }, sent, taken, rowUp, gone, rows, bubbles }
                );
            });

            // 3. a ReportFindings verdict the agent wrote on after: folded at once, no ticks
            await run("3. ReportFindings verdict folded", async (name) => {
                append(
                    ctx,
                    AC.toolUse("toolu_cvh_rf1", "ReportFindings", { findings: RF_FINDINGS }, stamp(ctx)),
                    AC.toolResult("toolu_cvh_rf1", "Findings reported.", stamp(ctx)),
                    AC.assistantText("I will take the confirmed one first.", stamp(ctx))
                );
                await setAgent({ ends: true });
                await AC.focusAgent(h, A);
                const rowUp = await waitRow("verdict", "· 2 findings");
                await polishNap(500);
                await scrollEnd();
                const rows = await readRows("verdict");
                const card = await readVerdict();
                await shot("3-reportfindings-folded");
                const row = rows.find((x) => x.text.includes("· 2 findings"));
                rec(
                    `${name}: the call draws "Code review · Changes requested · 2 findings" as a ✓ row at once (no tail, the agent went on): no verdict card and no tick anywhere`,
                    rowUp &&
                        row != null &&
                        row.text.includes("Code review · Changes requested · 2 findings") &&
                        !row.text.includes("—") &&
                        rows.length === 3 &&
                        card.cards === 0 &&
                        card.ticksInLayer === 0,
                    { rowUp, rows, cards: card.cards, ticks: card.ticksInLayer }
                );
            });

            // 3b. a waiting verdict and the agent gone: static, no ticks, no buttons, the link to the review kept
            await run("3b. static verdict", async (name) => {
                AC.writeSubagent(ctx.dir, SESSION, "cvhrev2", [
                    AC.userText(P2, stamp(ctx)),
                    AC.toolUse("toolu_cvhrev2_read", "Read", { file_path: join(ctx.cwd, "src/sync/retry.ts") }, stamp(ctx)),
                    AC.toolResult("toolu_cvhrev2_read", "export function retry() {}", stamp(ctx)),
                    AC.assistantText("Two naming nits.", stamp(ctx)),
                ]);
                append(
                    ctx,
                    AC.toolUse("toolu_cvh_review2", "Agent", { subagent_type: "superpowers:code-reviewer", description: DESC2, prompt: P2 }, stamp(ctx)),
                    AC.toolResult("toolu_cvh_review2", "The review found two nits.", stamp(ctx)),
                    AC.assistantText(`The second reviewer is done.\n\n${block(V3)}`, stamp(ctx))
                );
                await setAgent({ ends: true });
                await AC.focusAgent(h, A);
                const waiting = await waitCard("verdict", "waiting");
                const open = await polishWaitFor(h, `!!${cardOf(A, "verdict")}?.querySelector("[data-chat-vcard-open]")`, WAIT_MS);
                await exitAgent("done", 1);
                ctx.exited = true;
                const isStatic = await waitCard("verdict", "static");
                await polishNap(600);
                await scrollEnd();
                const card = await readVerdict();
                await shot("3b-verdict-static");
                await exitAgent("running", 0);
                ctx.exited = false;
                rec(
                    `${name}: once the agent has exited the waiting verdict is in state static: no tick, no Fix and no Skip, and Open the review is kept`,
                    waiting &&
                        open &&
                        isStatic &&
                        card.state === "static" &&
                        card.findings.length === 2 &&
                        card.findings.every((f) => !f.hasTick) &&
                        card.ticksInLayer === 0 &&
                        card.fix == null &&
                        card.skip == null &&
                        card.open,
                    { waiting, open, isStatic, state: card.state, findings: card.findings, ticks: card.ticksInLayer, fix: card.fix, skip: card.skip, open2: card.open }
                );
            });

            // the handoff's question, as the agent asks it: its own order of options, Arc engine first with (Recommended)
            // (the question names the plan by its absolute path, in backticks)
            const HANDOFF_Q = {
                question: `The plan is ready at \`${ctx.plan}\`. How should it be built?`,
                header: "Handoff",
                multiSelect: false,
                options: [
                    { label: "Arc engine (Recommended)", description: "Run it now with the engine." },
                    { label: "Inline in this session" },
                    { label: "Arc engine, queued" },
                    { label: "Subagent-driven" },
                ],
            };
            const ASK = () => ({ askId: "cvh-ask-1", oref: `block:${ctx.tab.blockId}`, questions: [HANDOFF_Q] });

            // 4. the handoff card, waiting in the dock: the plan's title and facts, four rows in the fixed order
            await run("4. handoff card waiting", async (name) => {
                append(ctx, AC.toolUse("toolu_cvh_ask1", "AskUserQuestion", { questions: [HANDOFF_Q] }, stamp(ctx)));
                await setAgent({ ask: ASK() });
                await AC.focusAgent(h, A);
                const up = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-ask] [data-chat-bscard-kind="handoff"]')`, WAIT_MS);
                // the plan's file is read once the card shows
                const factsUp = await polishWaitFor(h, `(${FLAT}(${layerOf(A)}?.querySelector("[data-chat-hcard-facts]"))).includes("5 tasks")`, WAIT_MS);
                await polishNap(500);
                const slotsBefore = await h.rpc("runqueuelist", null);
                await scrollEnd();
                const card = await readHandoff();
                const slotsAfter = await h.rpc("runqueuelist", null);
                await shot("4-handoff-waiting");
                const planName = PLAN_REL.split("/").pop();
                // the runs part: counts the queue lists, left out when there is no cap
                const runsOk = (slots) => (slots.maxactive > 0 ? card.facts.includes(`${slots.active} of ${slots.maxactive} run`) && card.facts.includes("active") : !/\bruns? active\b/.test(card.facts));
                rec(
                    `${name}: the handoff card is in [data-chat-ask] (the only one in the conversation), state waiting, with the plan link, the plan's title, "${planName} · 5 tasks, up to 2 at once" and the runs the queue lists, rows A–D in the fixed order with Recommended on A only`,
                    up &&
                        factsUp &&
                        card.dock &&
                        card.cards === 1 &&
                        card.state === "waiting" &&
                        card.planOpen != null &&
                        card.title === PLAN_TITLE &&
                        card.facts.includes(planName) &&
                        card.facts.includes("5 tasks") &&
                        card.facts.includes("up to 2 at once") &&
                        (runsOk(slotsBefore) || runsOk(slotsAfter)) &&
                        card.rows.map((r) => `${r.letter}:${r.choice}`).join("|") === "A:Arc engine|B:Arc engine, queued|C:Inline in this session|D:Subagent-driven" &&
                        card.rows.every((r) => !r.disabled) &&
                        card.rows[0].recommended &&
                        card.rows[0].text.includes("Run it now with the engine.") &&
                        card.recommended === 1,
                    { up, factsUp, dock: card.dock, cards: card.cards, state: card.state, planOpen: card.planOpen, title: card.title, facts: card.facts, slotsBefore, slotsAfter, rows: card.rows, recommended: card.recommended }
                );
            });

            // 4b. Open the plan opens the plan file
            await run("4b. open the plan", async (name) => {
                await AC.focusAgent(h, A);
                await polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-ask] [data-chat-hcard-plan-open]')`, WAIT_MS);
                const clicked = await click("[data-chat-hcard-plan-open]");
                const fileOpen = await polishWaitFor(h, `${RAIL_FILES}.some((p) => p.endsWith(${JSON.stringify(PLAN_REL)}))`, WAIT_MS);
                await polishNap(500);
                await shot("4b-plan-open");
                const files = await h.ev(RAIL_FILES);
                // back to the Chat, with the card still asking
                await AC.focusAgent(h, A);
                rec(`${name}: Open the plan opens ${PLAN_REL} in the agent's panel`, clicked === "clicked" && fileOpen, { clicked, fileOpen, files });
            });

            // 5. a row sends the agent's own option index for its choice
            await run("5. pick a row", async (name) => {
                await AC.focusAgent(h, A);
                await polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-ask] [data-chat-hcard-row="A"]')`, WAIT_MS);
                await h.ev(`(window.__cvhAnswers = [], true)`);
                const clicked = await click('[data-chat-hcard-row="A"]');
                const got = await polishWaitFor(h, `(window.__cvhAnswers ?? []).length >= 1`, SHORT_MS);
                const answers = await h.ev(`JSON.parse(JSON.stringify(window.__cvhAnswers ?? []))`);
                await shot("5-picked");
                rec(
                    `${name}: row A (Arc engine) answers the ask with the agent's own option index, [0]`,
                    clicked === "clicked" &&
                        got &&
                        answers.length === 1 &&
                        answers[0].oref === `block:${ctx.tab.blockId}` &&
                        answers[0].answers?.length === 1 &&
                        JSON.stringify(answers[0].answers[0].selectedindexes) === "[0]",
                    { clicked, got, answers }
                );
            });

            // 6. the handoff answered and the engine run started: ✓ Handoff · Arc engine, then the run's card
            await run("6. handoff folded, run card", async (name) => {
                const runId = await makeRun("plan", { goal: GOALS.plan, mode: "orchestrator" });
                append(
                    ctx,
                    AC.toolResult(
                        "toolu_cvh_ask1",
                        `User has answered your questions: "${HANDOFF_Q.question}"="Arc engine (Recommended)". You can now continue with the user's answers in mind.`,
                        { toolUseResult: { questions: [HANDOFF_Q], answers: { [HANDOFF_Q.question]: "Arc engine (Recommended)" } }, ...stamp(ctx) }
                    ),
                    ...startCall("toolu_cvh_start1", `wsh runs start --plan "${ctx.plan}"`, startedOut(runId, "orchestrator")),
                    AC.assistantText(`Started run ${id8(runId)}. I will report when it lands.`, stamp(ctx))
                );
                await setAgent({ ask: null, ends: true });
                await AC.focusAgent(h, A);
                const rowUp = await waitRow("handoff", "Handoff · Arc engine");
                const cardUp = await waitRunCard(runId);
                await polishNap(600);
                await scrollEnd();
                const handoff = await readHandoff();
                const rows = await readRows("handoff");
                const runs = await readRuns();
                const order = await before('[data-chat-bscard-done="handoff"]', `[data-chat-run-card="${runId}"]`);
                await shot("6-handoff-folded");
                const card = runs.find((c) => c.id === runId);
                rec(
                    `${name}: the answered ask is "✓ Handoff · Arc engine" (no Recommended, no card in the dock), followed by the run card of run ${id8(runId)} in its planning stage with Open run`,
                    rowUp &&
                        cardUp &&
                        rows.length === 1 &&
                        rows[0].text.includes("Handoff · Arc engine") &&
                        !rows[0].text.includes("Recommended") &&
                        handoff.cards === 0 &&
                        !handoff.dock &&
                        card != null &&
                        card.stage === "planning" &&
                        card.open &&
                        order === true,
                    { rowUp, cardUp, rows, handoffCards: handoff.cards, dock: handoff.dock, runs, order }
                );
            });

            // 7. a run started with no ask before it draws its card; landed, with its [arc] message, it folds into a ✓ row
            await run("7. plain run, landed", async (name) => {
                const runId = await makeRun("plain", { goal: GOALS.plain, mode: "quick" });
                const short = id8(runId);
                append(
                    ctx,
                    AC.userText("start the plain run for the sync client", stamp(ctx)),
                    ...startCall("toolu_cvh_start2", `wsh runs start "${GOALS.plain}"`, startedOut(runId, "quick")),
                    AC.assistantText(`Started run ${short}. I will wait for it to land.`, stamp(ctx))
                );
                await setAgent({ ends: true });
                await AC.focusAgent(h, A);
                const cardUp = await waitRunCard(runId);
                await polishNap(500);
                await scrollEnd();
                const live = (await readRuns()).find((c) => c.id === runId);
                const handoffRows = (await readRows("handoff")).length;
                await shot("7-plain-run-card");
                // landed: the run is over, then the message wavesrv types into the session arrives
                await fstWriteRun(h, runId, (r) => ({ ...r, status: "done", completedts: Date.now(), basebranch: "main", land: { state: "landed", commit: SHA } }));
                const foldedAlone = await noRunCard(runId, SHORT_MS);
                const message = [`[arc] Run ${short} "${GOALS.plain}" landed: merged into main.`, `Plan: ${PLAN_REL}`].join("\n");
                append(ctx, AC.userText(message, stamp(ctx)));
                await setAgent({ ends: true });
                const want = `Run ${short} landed · merged into main`;
                const rowUp = await waitRow("run", want);
                await polishNap(500);
                await scrollEnd();
                const goneCard = (await readRuns()).every((c) => c.id !== runId);
                const row = (await readRows("run")).find((r) => r.text.includes(`Run ${short}`));
                const bubbles = await readBubbles(`[arc] Run ${short}`);
                await shot("7-plain-run-landed");
                // the caret opens the message as written
                const clicked = await h.ev(`(() => {
                    ${HELP}
                    const row = [...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="run"]') ?? [])].find((r) => flat(r).includes(${JSON.stringify(want)}));
                    const el = pick(row, "[data-chat-run-ended]");
                    if (!el) return "missing";
                    el.click();
                    return "clicked";
                })()`);
                const textUp = await polishWaitFor(h, `[...(${layerOf(A)}?.querySelectorAll("[data-chat-run-ended-text]") ?? [])].some((e) => ${FLAT}(e).includes(${JSON.stringify(message.split("\n")[0])}))`, SHORT_MS);
                const expanded = await h.ev(`(() => {
                    const row = [...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="run"]') ?? [])].find((r) => (r.textContent ?? "").includes(${JSON.stringify(want)}));
                    return (row?.matches("[data-chat-run-ended]") ? row : row?.querySelector("[data-chat-run-ended]"))?.getAttribute("aria-expanded") ?? null;
                })()`);
                await polishNap(300);
                await shot("7-plain-run-ended-open");
                rec(
                    `${name}: a plain wsh runs start call draws the card of run ${short} (stage planning, Open run, no new Handoff row); landed with its message the card folds into "✓ ${want}", the message draws no bubble, and clicking [data-chat-run-ended] opens [data-chat-run-ended-text] with the message`,
                    cardUp &&
                        live != null &&
                        live.stage === "planning" &&
                        live.open &&
                        handoffRows === 1 &&
                        rowUp &&
                        goneCard &&
                        row != null &&
                        row.ended != null &&
                        row.ended.expanded === "false" &&
                        bubbles === 0 &&
                        clicked === "clicked" &&
                        textUp &&
                        expanded === "true",
                    { cardUp, live, handoffRows, foldedAlone, rowUp, goneCard, row, bubbles, clicked, textUp, expanded }
                );
            });

            // 7b. a held run: its card stays until its [arc] message folds it into "Run <id> held: <reason>"
            await run("7b. held run", async (name) => {
                const reason = "the checkout has uncommitted changes";
                const runId = await makeRun("held", { goal: GOALS.held, mode: "orchestrator" });
                const short = id8(runId);
                await heldLand(runId, reason);
                append(
                    ctx,
                    AC.userText("start the held run for the retry log", stamp(ctx)),
                    ...startCall("toolu_cvh_start3", `wsh runs start "${GOALS.held}"`, startedOut(runId, "orchestrator")),
                    AC.assistantText(`Started run ${short}. I will check on it.`, stamp(ctx))
                );
                await setAgent({ ends: true });
                await AC.focusAgent(h, A);
                const cardUp = await waitRunCard(runId);
                await polishNap(500);
                await scrollEnd();
                const live = (await readRuns()).find((c) => c.id === runId);
                await shot("7b-held-run-card");
                const message = [`[arc] Run ${short} "${GOALS.held}" held: ${reason}.`, `Diagnose with wsh runs show ${short}. Do not force the land; propose the fix to the user.`].join("\n");
                append(ctx, AC.userText(message, stamp(ctx)));
                await setAgent({ ends: true });
                const want = `Run ${short} held: ${reason}`;
                const rowUp = await waitRow("run", want);
                const gone = await noRunCard(runId, SHORT_MS);
                await polishNap(500);
                await scrollEnd();
                const bubbles = await readBubbles(`[arc] Run ${short}`);
                const row = (await readRows("run")).find((r) => r.text.includes(want));
                await shot("7b-held-run-folded");
                rec(
                    `${name}: the held run (not landed) draws a run card; once its message arrives the card folds into "✓ ${want}" and the message draws no bubble`,
                    cardUp && live != null && live.open && rowUp && gone && row != null && !row.text.includes("landed") && bubbles === 0,
                    { cardUp, live, rowUp, gone, row, bubbles }
                );
            });

            // 7c. a held brainstorm run: its live card goes and its `brainstorm: run` line draws the ✓ row
            await run("7c. held brainstorm run", async (name) => {
                const reason = "the merge conflicts in CHANGELOG.md";
                // a run the cockpit launcher made has no origin: the brainstorm file names it
                const runId = await makeRun("brainstorm", { goal: GOALS.brainstorm, mode: "orchestrator", origin: false });
                const short = id8(runId);
                await heldLand(runId, reason);
                await AC.focusAgent(h, A);
                await setAgent({ ends: true });
                await writeBrainstorm(h, ctx, brainstormFile(runId));
                // the brainstorm's card: the run card that names this run's goal (a card of its own, among the others)
                const cardByGoal = () => readRuns().then((cs) => cs.find((c) => c.text.includes(GOALS.brainstorm)) ?? null);
                const cardUp = await until(async () => (await cardByGoal()) != null);
                await polishNap(500);
                await scrollEnd();
                const live = await cardByGoal();
                await shot("7c-brainstorm-run-card");
                // the line Arc sent when the run began, appended: a live run's line draws nothing
                const line = `brainstorm: run ${runId}`;
                const said = await sendRun(runId);
                const taken = await turn(line);
                await polishNap(500);
                const bubblesLine = await readBubbles(line);
                const message = `[arc] Run ${short} "${GOALS.brainstorm}" held: ${reason}.`;
                append(ctx, AC.userText(message, stamp(ctx)));
                await setAgent({ ends: true });
                const want = `Run ${short} held: ${reason}`;
                const rowUp = await waitRow("run", want);
                const gone = await until(async () => (await cardByGoal()) == null, SHORT_MS);
                await polishNap(500);
                await scrollEnd();
                const bubbles = await readBubbles(`[arc] Run ${short}`);
                const rows = (await readRows("run")).filter((r) => r.text.includes(`Run ${short}`));
                await shot("7c-brainstorm-run-folded");
                rec(
                    `${name}: the brainstorm names the held run: its live card is there until the message; then the card is gone, the "brainstorm: run" line draws "✓ ${want}" and neither it nor the message draws a bubble`,
                    cardUp &&
                        live != null &&
                        said === "sent" &&
                        taken &&
                        bubblesLine === 0 &&
                        rowUp &&
                        gone &&
                        rows.length === 1 &&
                        bubbles === 0,
                    { cardUp, live, said, taken, bubblesLine, rowUp, gone, rows, bubbles }
                );
            });

            // 8. a queued start: the card's own Queued line, after the run it waits on
            await run("8. queued run", async (name) => {
                // the run it waits on never lands, so the entry stays queued
                const afterId = await makeRun("after", { goal: GOALS.after, mode: "quick" });
                const entry = await h.rpc(
                    "runqueueadd",
                    {
                        data: { channelid: ctx.channelId, workspaceid: ctx.workspaceId, runtime: "claude", mode: "quick", deferstart: true, goal: GOALS.queued },
                        after: afterId,
                    },
                    RPC
                );
                ctx.entries.push(entry.id);
                append(
                    ctx,
                    AC.userText("queue the follow-up run", stamp(ctx)),
                    ...startCall("toolu_cvh_start4", `wsh runs start --queue "${GOALS.queued}"`, `queued ${entry.id} (#1 in line) — waiting for ${GOALS.after} to finish`),
                    AC.assistantText("It is queued; it starts when the run before it is over.", stamp(ctx))
                );
                await setAgent({ ends: true });
                await AC.focusAgent(h, A);
                const cardUp = await waitRunCard(entry.id);
                await polishNap(600);
                await scrollEnd();
                const card = (await readRuns()).find((c) => c.id === entry.id);
                await shot("8-queued-run");
                rec(
                    `${name}: the queued start draws its own card (stage queued) whose Queued line reads "Queued · after ${GOALS.after}"`,
                    cardUp && card != null && card.stage === "queued" && card.queued != null && card.queued.includes(`Queued · after ${GOALS.after}`),
                    { cardUp, card, entry: { id: entry.id, title: entry.title } }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-verdict-handoff teardown: ${what} failed: ${e?.message ?? e}`);
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
                await step("close the subagent interior", () =>
                    AC.agentPage(h, `const S = await mod("app/view/agents/subagentsstore.ts"); globalStore.set(S.focusSubagentAtom, null); return true;`)
                );
                await step("detach the brainstorm", () =>
                    AC.agentPage(h, `const S = await mod("app/view/agents/brainstormstore.ts"); S.detachBrainstorm(${JSON.stringify(ctx.tab.tabId)}); return true;`)
                );
            }
            await step("stop recording the ask answers", () =>
                h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (c?.__cvhOrig) { c.wshRpcCall = c.__cvhOrig; delete c.__cvhOrig; }
                    delete window.__cvhAnswers;
                    return true;
                })()`)
            );
            if (ctx.prevRail !== undefined) {
                await step("restore the panel", () =>
                    AC.agentPage(h, `const R = await mod("app/view/agents/railstore.ts"); globalStore.set(R.railVisibleAtom, ${JSON.stringify(ctx.prevRail)}); return true;`)
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            // the queued entries go before the runs they wait on, or the queue would start them when those are cancelled
            for (const id of ctx.entries ?? []) {
                await step(`remove the queue entry ${id}`, () => h.rpc("runqueueremove", { id }));
            }
            if (ctx.channelId != null) {
                // a done run (step 7 lands one) refuses a cancel ("a finished run cannot be cancelled"), so only a run
                // that is not done is cancelled; the done ones go with the channel below, which removes its runs. A
                // failed read leaves the set empty, so every run is tried and a failure is logged as before
                const done = new Set();
                await step("read the runs' states", async () => {
                    for (const r of (await h.rpc("getchannelruns", { channelid: ctx.channelId }))?.runs ?? []) {
                        if (r.status === "done") done.add(r.id);
                    }
                });
                // the rest are deferred and cancel at once
                for (const runId of Object.values(ctx.runs ?? {})) {
                    if (done.has(runId)) continue;
                    await step(`cancel run ${runId}`, () => h.rpc("cancelrun", { channelid: ctx.channelId, runid: runId }));
                }
                await step("delete the runs' channel", () => h.rpc("deletechannel", { channelid: ctx.channelId }));
            }
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
            for (const dir of [ctx.dir, ctx.cwd, ctx.runDir]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
