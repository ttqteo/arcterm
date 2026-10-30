// A question the judge weighed (.superpowers/design/brainstorm-judge): the read and pick are labelled the judge's, one
// line under the answers says how it got there, and what it dropped sits behind a toggle that starts closed. A failed
// judge keeps the agent's labels and says why; once answered, the rail row keeps the judge's pick. kit holds
// scenarios.mjs's brainstorm helpers.

const TOPIC = "agent-messages-judge";
const NAME = "brainstorm-judged-question";

const OPTIONS = [
    {
        label: "No forwarding from an agent-started turn",
        detail: "The server flags a turn an agent message started, and refuses wsh agents send from it.",
        pick: true,
        pros: [
            "Ends loops of any length (A→B→A, A→B→C→A) with no counters or send graph.",
            "Fits the read-based reply model: a target never needs to send to answer.",
            "Small: agentctl.Send is the one entry point, and the UserPromptSubmit hook already marks new turns.",
        ],
        cons: [
            "An agent that another agent woke can't delegate onward.",
            "The orchestrator's pushes (wake.go overStream) must count as human-started.",
        ],
    },
    {
        label: "Inbox, no wake",
        detail: "Agent messages never start a turn: they join a running one or wait for the target's next human-started turn.",
        pros: ["Strongest guarantee: only humans start turns.", "Reuses Msg.MidTurn and the atPrompt check in wake.go."],
        cons: [
            "A message to an idle agent does nothing until a human prompts it.",
            "Needs a new inbox store; agentctl streams are memory-only, capped at 16.",
        ],
    },
    {
        label: "Hop count carried in the message",
        detail: "Each send from an agent-started turn carries the incoming hop plus one; the server refuses past a named maximum.",
        pros: ["Allows bounded delegation chains (A→B→C).", "Still stops any cycle at the limit."],
        cons: ["No message type has a hop or sender field today, so the types, the server command and the mod all change."],
    },
    {
        label: "Per-pair rate cap",
        detail: "The server counts sends per sender and target over a time window and refuses past a limit.",
        pros: ["Easy on top of the refuse-and-report agentctl.Send already does."],
        cons: ["A slow loop under the cap is never stopped.", "New window and count constants to tune."],
    },
];
const DROPPED = [
    {
        name: "Refuse a send back to a sender whose request is still open",
        reason: "misses longer cycles; A→B→C→A needs the whole send graph, not only the reverse edge.",
    },
    {
        name: "Human approval for chained sends",
        reason: "stalls automation on a human, against your “Orchestrator wall-clock matters” note.",
    },
    { name: "Prompt wording plus docs only", reason: "enforces nothing." },
];
const APPROACHES = [
    ...OPTIONS.map((o) => ({ name: o.label, description: o.detail, facts: [] })),
    ...DROPPED.map((d) => ({ name: d.name, description: "", facts: [] })),
];
const READ =
    "Only the one-hop and inbox rules end every cycle by construction, and only the one-hop rule still wakes an idle agent; it rests on agentctl.Send being the one place an engine prompt enters a session.";
const WEIGHED = { added: [], dropped: DROPPED };
const FAILED_REASON = "Arc restarted before the judge started.";

const Q4 = {
    n: 4,
    part: "guard",
    text: "How should agent-to-agent prompt loops be stopped?",
    why: "Agents answer by being read (wsh agents read), so a target never has to send back to reply. What I can't tell is whether an agent that another agent woke should be able to delegate onward.",
    read: READ,
    options: OPTIONS,
    approaches: APPROACHES,
    judge: WEIGHED,
};

const PARTS = [
    { id: "intent", title: "Intent and why", state: "yours", body: "Agents can message each other without looping." },
    { id: "reply", title: "How a target replies", state: "yours", body: "By being read: wsh agents read." },
    { id: "guard", title: "Loop guard", state: "asked", body: "" },
    { id: "delivery", title: "Delivery", state: "guess", body: "A message joins the target's running turn." },
    { id: "ui", title: "What the cockpit shows", state: "open", body: "" },
];
const HISTORY = [
    { kind: "question", n: 1, q: "What should agent messages let you do?", a: "Hand work between agents.", into: ["intent"] },
    { kind: "question", n: 2, q: "How does a target answer?", a: "By being read.", into: ["reply"] },
    { kind: "question", n: 3, q: "Where does a message land?", a: "In the running turn.", into: ["delivery"] },
];
const ANSWERED = {
    kind: "question",
    n: 4,
    q: Q4.text,
    a: OPTIONS[0].label,
    into: ["guard"],
    options: OPTIONS,
    picked: 0,
    judge: WEIGHED,
};

const file = (over) => ({
    v: 1,
    title: "Agent messages",
    spec: "docs/superpowers/specs/2026-10-23-agent-messages-design.md",
    question: Q4,
    working: null,
    parts: PARTS,
    history: HISTORY,
    done: false,
    check: null,
    run: null,
    ...over,
});
const JUDGED = file({});
const FAILED = file({ question: { ...Q4, judge: { failed: FAILED_REASON } } });
const DONE = file({
    question: null,
    parts: PARTS.map((p) => (p.id === "guard" ? { ...p, state: "yours", body: OPTIONS[0].detail, from: "answer 4" } : p)),
    history: [...HISTORY, ANSWERED],
});

// --- the judge's wait (.superpowers/design/brainstorm-judge-wait, Main): the question, the judge's status line, the
// approaches it weighs as rows, the box open; an answer or Skip sent during the wait stops the judge first.
const WAIT_TOPIC = "pane-interaction-judge-wait";
const WAIT_NAME = "brainstorm-judge-wait";
const WAIT_WORKING = "The judge is weighing 7 approaches.";
const WAIT_PLACEHOLDER = "Or answer now in your own words…";
const WAIT_APPROACHES = [
    { name: "Live activity line", description: "The Working view shows what the agent is doing right now.", facts: ["Arc has the activity line.", "The pane uses none of it."] },
    { name: "Agent narrates progress", description: "The agent writes short progress steps mid-turn.", facts: ["The file is written once per turn.", "Steps would need a new field."] },
    { name: "Question streams in", description: "The question text lands first; options fill in after.", facts: ["The file is written whole."] },
    { name: "Transcript peek", description: "The tail of the agent’s reply, read from its transcript.", facts: ["wsh transcript-tail reads it."] },
    { name: "Terminal peek", description: "A toggle reveals the agent’s live terminal.", facts: ["The pane covers the terminal."] },
    { name: "Design stays usable", description: "Confirm, edit and browse the design while it works.", facts: ["Actions queue as lines.", "The design is drawn from the file."] },
    { name: "Stop and redirect", description: "Cancel the turn and send a correction straight away.", facts: ["Arc has a Stop for each agent."] },
];
const WAIT_Q = {
    n: 2,
    part: "wait",
    text: "What should the pane give you while the agent is generating?",
    why: "You are not sure, so I listed what could fill the wait and handed the list to the judge.",
    approaches: WAIT_APPROACHES,
};
const waitFile = (over) => ({
    v: 1,
    title: "More interaction on the brainstorm pane",
    spec: "docs/superpowers/specs/2026-10-26-brainstorm-pane-interaction-design.md",
    question: WAIT_Q,
    working: WAIT_WORKING,
    parts: [
        { id: "intent", title: "Intent and why", state: "yours", body: "Interaction while the model generates.", from: "answer 1" },
        { id: "wait", title: "What the wait offers", state: "asked", body: "" },
    ],
    history: [{ kind: "question", n: 1, q: "What is missing today?", a: "Interaction while the model generates.", into: ["intent"] }],
    done: false,
    check: null,
    run: null,
    ...over,
});
const WAIT = waitFile({});
const WAIT_IN_CHECK = waitFile({ check: { yours: [], calls: [], answered: [], touched: [] } });
const WAIT_NO_APPROACHES = waitFile({ question: { ...WAIT_Q, approaches: undefined } });
const WAIT_STOP_ERROR = "verify: the stop failed";

// records every line the page sends an agent, as scenarios.mjs's BS_TYPED_INSTALL does
const WAIT_TYPED_INSTALL = `(() => {
    const c = window.TabRpcClient;
    if (!c) return false;
    if (c.__bsOrig) return true;
    c.__bsOrig = c.wshRpcCall;
    const call = c.wshRpcCall.bind(c);
    window.__bsTyped = [];
    c.wshRpcCall = (command, data, opts) => {
        if (command === "agentprompt") window.__bsTyped.push({ block: data?.blockid, text: data?.text });
        return call(command, data, opts);
    };
    return true;
})()`;
const WAIT_TYPED_REMOVE = `(() => {
    const c = window.TabRpcClient;
    if (c?.__bsOrig) {
        c.wshRpcCall = c.__bsOrig;
        delete c.__bsOrig;
    }
    return true;
})()`;
// the stop RPC fails while this is on; every other call goes through
const WAIT_STOP_FAIL = `(() => {
    const c = window.TabRpcClient;
    if (!c || c.__bsStopOrig) return false;
    c.__bsStopOrig = c.wshRpcCall;
    const call = c.wshRpcCall.bind(c);
    c.wshRpcCall = (command, data, opts) =>
        command === "brainstormjudgestop" ? Promise.reject(new Error(${JSON.stringify(WAIT_STOP_ERROR)})) : call(command, data, opts);
    return true;
})()`;
const WAIT_STOP_RESTORE = `(() => {
    const c = window.TabRpcClient;
    if (c?.__bsStopOrig) {
        c.wshRpcCall = c.__bsStopOrig;
        delete c.__bsStopOrig;
    }
    return true;
})()`;
const WAIT_PROMPT = /[>$#%]$/;
const WAIT_PROMPT_WAIT_MS = 20000;
const WAIT_KEY_C = { key: "c", code: "KeyC", windowsVirtualKeyCode: 67, text: "c" };

export default function (kit) {
    const { bsBoardScenario, bsWrite, bsUntil, bsBrief, bsClick, BS_PANE } = kit;

    const WORK = `${BS_PANE}?.querySelector("[data-brainstorm-judge-work]")`;
    const readJudge = (h) =>
        h.ev(`(() => {
            const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
            const pane = ${BS_PANE};
            const question = flat(pane?.querySelector("[data-brainstorm-question]"));
            const toggle = pane?.querySelector("[data-brainstorm-judge-dropped-toggle]");
            const list = pane?.querySelector("[data-brainstorm-judge-dropped]");
            return {
                read: flat(pane?.querySelector("[data-brainstorm-read]")),
                work: flat(${WORK}),
                judgePicks: (question.match(/Judge’s pick/g) ?? []).length,
                agentPicks: (question.match(/Agent’s pick/g) ?? []).length,
                agents: question.includes("Agent’s"),
                toggle: toggle ? { text: flat(toggle), expanded: toggle.getAttribute("aria-expanded") } : null,
                dropped: list
                    ? [...list.querySelectorAll("li")].map((li) => ({ name: flat(li.firstElementChild), reason: flat(li.lastElementChild) }))
                    : null,
            };
        })()`);
    const showWork = (h) => h.ev(`${WORK}?.scrollIntoView({ block: "center" })`);
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    return [
        judgeWaitScenario(kit),
        bsBoardScenario(NAME, TOPIC, JUDGED, async (h, ctx, rec) => {
            const s1 = await bsUntil(h, ctx, (s) => s.question.includes(Q4.text) && s.options.length === OPTIONS.length);
            await showWork(h);
            const m1 = await readJudge(h);
            await h.shot("cdp-shots/brainstorm-judged-question.png");
            rec(
                "1. a weighed question: Judge’s read, one Judge’s pick, no Agent’s, the judge's work line, and the dropped list closed behind Show the 3 dropped",
                s1.ok &&
                    m1.read === `Judge’s read: ${READ}` &&
                    m1.judgePicks === 1 &&
                    !m1.agents &&
                    m1.work === "Judge’s work: weighed the 7 approaches the agent listed, added none, dropped 3." &&
                    m1.dropped === null &&
                    m1.toggle?.text === "Show the 3 dropped" &&
                    m1.toggle.expanded === "false",
                { ...bsBrief(s1), marks: m1 }
            );

            const clicked = await bsClick(h, BS_PANE, "Show the 3 dropped");
            await showWork(h);
            const m2 = await readJudge(h);
            await h.shot("cdp-shots/brainstorm-judged-question-dropped.png");
            rec(
                "2. Show the 3 dropped opens the list: each dropped approach with its Dropped: reason, and the toggle reads Hide the 3 dropped",
                clicked === "clicked" &&
                    eq(m2.dropped, DROPPED.map((d) => ({ name: d.name, reason: `Dropped: ${d.reason}` }))) &&
                    m2.toggle?.text === "Hide the 3 dropped" &&
                    m2.toggle.expanded === "true",
                { clicked, marks: m2 }
            );

            bsWrite(ctx, FAILED);
            const s3 = await bsUntil(h, ctx, (s) => s.question.includes("the judge failed"));
            await showWork(h);
            const m3 = await readJudge(h);
            await h.shot("cdp-shots/brainstorm-judged-question-failed.png");
            rec(
                "3. a failed judge: Agent’s read and Agent’s pick, and the work line says the judge failed and why, with no dropped toggle",
                s3.ok &&
                    m3.read === `Agent’s read: ${READ}` &&
                    m3.agentPicks === 1 &&
                    m3.judgePicks === 0 &&
                    m3.work === `Judge’s work: the judge failed, so the read and pick are the agent’s: ${FAILED_REASON}` &&
                    m3.toggle === null &&
                    m3.dropped === null,
                { ...bsBrief(s3), marks: m3 }
            );

            bsWrite(ctx, DONE);
            const s4 = await bsUntil(h, ctx, (s) => s.history.some((r) => r.label.startsWith("Q4")));
            const row = s4.history.find((r) => r.label.startsWith("Q4"));
            await h.shot("cdp-shots/brainstorm-judged-question-answered.png");
            rec(
                "4. answered: the rail's Q4 row marks the picked answer as the Judge’s pick, not the Agent’s",
                s4.ok &&
                    eq(row?.picked, [`${OPTIONS[0].label} Judge’s pick ${OPTIONS[0].detail}`]) &&
                    !row.text.includes("Agent’s pick"),
                { ...bsBrief(s4), row }
            );
        }),
    ];
}

// as bsBoardScenario, with a step that can be skipped when CDP keys cannot reach the page. Before each send the wait's
// file is written back and the tab gets a reading judge record with no run, as the server writes one; the stop the
// pane calls then turns it stopped
function judgeWaitScenario(kit) {
    const { bsArrangeAgent, bsShowFile, bsTeardownAgent, skipStep, waveService, polishWaitFor, polishNap } = kit;
    const { bsWrite, bsUntil, bsBrief, bsClick, bsMouseClick, bsMark, bsTyped, bsNothingTyped, bsAgentTook } = kit;
    const { bsOpenDesign, bsCloseDesign, bsKeysArrive, bsKey, bsFill, bsTermText, BS_PANE, BS_ANSWER, BS_TREE_LINE } = kit;
    const name = WAIT_NAME;

    const readWait = (h) =>
        h.ev(`(() => {
            const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
            const pane = ${BS_PANE};
            const box = pane?.querySelector("[data-brainstorm-answer]");
            return {
                view: pane?.getAttribute("data-brainstorm-view") ?? null,
                judging: !!pane?.querySelector("[data-brainstorm-judging]"),
                status: flat(pane?.querySelector("[data-brainstorm-judge-status]")),
                list: flat(pane?.querySelector("[data-brainstorm-judge-list]")),
                rows: [...(pane?.querySelectorAll("[data-brainstorm-approach]") ?? [])].map((b) => ({
                    option: b.getAttribute("data-brainstorm-option"),
                    text: flat(b),
                })),
                focused: document.activeElement?.getAttribute?.("data-brainstorm-option") ?? null,
                placeholder: box?.getAttribute("placeholder") ?? null,
                boxDisabled: box?.disabled ?? null,
                buttons: [...(pane?.querySelectorAll("button") ?? [])].map(flat),
                error: flat(pane?.querySelector("[data-brainstorm-judging] .text-error")),
                working: flat(pane?.querySelector("[data-brainstorm-working]")),
                back: flat(pane?.querySelector("[data-brainstorm-back]")),
                treeLine: flat(${BS_TREE_LINE}),
            };
        })()`);
    const rowText = (a, i) => `${String.fromCharCode(65 + i)} ${a.name} ${a.description} ${a.facts.length} ${a.facts.length === 1 ? "fact" : "facts"}`;
    const wantRows = WAIT_APPROACHES.map((a, i) => ({ option: String(i), text: rowText(a, i) }));
    const drawn = (w) => w.judging && w.status === WAIT_WORKING && eqJson(w.rows, wantRows);
    const ROW = (i) => `${BS_PANE}?.querySelector('[data-brainstorm-approach][data-brainstorm-option="${i}"]')`;

    const setReading = (h, ctx) =>
        h.rpc("setmeta", {
            oref: `tab:${ctx.tabId}`,
            meta: {
                "brainstorm:judgestate": "reading",
                "brainstorm:judgets": Date.now(),
                "brainstorm:judgerun": "",
                "brainstorm:judgechannel": "",
                "brainstorm:judgereason": "",
            },
        });
    const judgeState = async (h, ctx) =>
        (await waveService(h, "object", "GetObject", [`tab:${ctx.tabId}`]))?.meta?.["brainstorm:judgestate"] ?? null;
    const stateBecomes = async (h, ctx, want) => {
        let state = null;
        for (const start = Date.now(); Date.now() - start < 3000; await polishNap(200)) {
            state = await judgeState(h, ctx).catch((e) => `error: ${e?.message ?? e}`);
            if (state === want) break;
        }
        return state;
    };
    // the wait as the agent left it: its file written back and the judge reading again
    const rearm = async (h, ctx, file = WAIT) => {
        bsWrite(ctx, file);
        await setReading(h, ctx);
        return polishWaitFor(h, `!!${BS_PANE}?.querySelector("[data-brainstorm-judging]") && !${BS_PANE}?.querySelector("[data-brainstorm-working]")`, 7000);
    };
    // a sent line is read in the terminal, and a line typed before the shell's first prompt can be lost
    const atPrompt = async (h, ctx) => {
        for (const start = Date.now(); Date.now() - start < WAIT_PROMPT_WAIT_MS; await polishNap(250)) {
            const rows = (await bsTermText(h, ctx, "\n").catch(() => "")).split("\n").filter((r) => r.trim() !== "");
            if (WAIT_PROMPT.test(rows.at(-1)?.trim() ?? "")) return true;
        }
        return false;
    };
    const waitFor = async (h, want, ms = 5000) => {
        let w;
        for (const start = Date.now(); Date.now() - start < ms; await polishNap(200)) {
            w = await readWait(h);
            if (want(w)) return { ...w, ok: true };
        }
        return { ...w, ok: false };
    };

    async function check(h, ctx, rec, skip) {
        const prompt = await atPrompt(h, ctx);
        await h.ev(WAIT_TYPED_INSTALL);
        try {
            // 1. the wait
            const s1 = await bsUntil(h, ctx, (s) => s.question.includes(WAIT_Q.text) && s.options.length === WAIT_APPROACHES.length);
            const w1 = await waitFor(h, drawn);
            await h.shot("cdp-shots/brainstorm-judge-wait-1.png");
            rec(
                "1. the wait: the question and its why, the status line, What the judge is weighing · 7, the 7 approaches in file order with their facts counts and a letter on each, the box open with its placeholder, no Guess for me, and the agent's tree line names the judge",
                s1.ok &&
                    w1.ok &&
                    w1.treeLine === `judge weighing question ${WAIT_Q.n}` &&
                    s1.why === WAIT_Q.why &&
                    w1.list === `What the judge is weighing · ${WAIT_APPROACHES.length}` &&
                    w1.placeholder === WAIT_PLACEHOLDER &&
                    w1.boxDisabled === false &&
                    !w1.buttons.includes("Guess for me") &&
                    w1.buttons.includes("Skip the questions"),
                { ...bsBrief(s1), why: s1.why, wait: w1 }
            );

            // 2. Design over the wait, and back
            const opened = await bsOpenDesign(h);
            const w2 = await readWait(h);
            await h.shot("cdp-shots/brainstorm-judge-wait-2-design.png");
            const closed = await bsCloseDesign(h);
            const w2b = await waitFor(h, drawn, 3000);
            rec(
                `2. Design over the wait shows the design with Back to question ${WAIT_Q.n}; Back returns to the wait`,
                opened && !w2.judging && w2.back === `Back to question ${WAIT_Q.n}` && closed && w2b.ok,
                { opened, back: w2.back, judgingUnder: w2.judging, closed, returned: w2b.ok }
            );

            // 3. a click on the second row sends its name and stops the judge
            await setReading(h, ctx);
            const picked = WAIT_APPROACHES[1].name;
            let mark = await bsMark(h, ctx, picked);
            const clicked = await h.ev(`(() => { const b = ${ROW(1)}; if (!b) return "missing"; b.click(); return "clicked"; })()`);
            const typed3 = await bsTyped(h, ctx, mark, picked);
            const state3 = await stateBecomes(h, ctx, "stopped");
            const w3 = await waitFor(h, (w) => w.working.includes("Writing up your answer."));
            await h.shot("cdp-shots/brainstorm-judge-wait-3-row.png");
            rec(
                "3. a click on the second row sends exactly its name, the judge's record turns stopped, and the pane shows Writing up your answer.",
                prompt && clicked === "clicked" && typed3.ok && state3 === "stopped" && w3.ok && !w3.judging,
                { prompt, clicked, ...typed3.detail, judgestate: state3, working: w3.working }
            );
            await bsAgentTook(h, ctx);

            // 4. the letter c focuses the third row and Enter sends it
            const armed4 = await rearm(h, ctx);
            const focusClick = await bsMouseClick(h, `${BS_PANE}?.querySelector("[data-brainstorm-judging] h1")`);
            if (!(focusClick && (await bsKeysArrive(h)))) {
                skip("4. the letter c focuses the third row and Enter sends its name", `could not verify: CDP keys do not reach the page (armed ${armed4}, clicked ${focusClick})`);
            } else {
                const third = WAIT_APPROACHES[2].name;
                mark = await bsMark(h, ctx, third);
                await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...WAIT_KEY_C });
                await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...WAIT_KEY_C });
                await polishNap(300);
                const w4 = await readWait(h);
                await h.shot("cdp-shots/brainstorm-judge-wait-4-key.png");
                await bsKey(h, null, "Enter", "keys");
                const typed4 = await bsTyped(h, ctx, mark, third);
                rec("4. the letter c focuses the third row and Enter sends its name", armed4 && w4.focused === "2" && typed4.ok, {
                    armed: armed4,
                    focused: w4.focused,
                    ...typed4.detail,
                });
                await bsAgentTook(h, ctx);
            }

            // 5. a typed line, sent
            const armed5 = await rearm(h, ctx);
            const line = "Show me the transcript tail, nothing more.";
            mark = await bsMark(h, ctx, line);
            const via = await bsFill(h, BS_ANSWER, line);
            await bsKey(h, BS_ANSWER, "Enter", via);
            const typed5 = await bsTyped(h, ctx, mark, line);
            const w5 = await waitFor(h, (w) => w.working.includes("Writing up your answer."));
            await h.shot("cdp-shots/brainstorm-judge-wait-5-typed.png");
            rec("5. a line typed in the box is sent as it is, and the pane shows Writing up your answer.", armed5 && typed5.ok && w5.ok, {
                armed: armed5,
                keys: via,
                ...typed5.detail,
                working: w5.working,
                judgestate: await judgeState(h, ctx).catch(() => null),
            });
            await bsAgentTook(h, ctx);

            // 6. Skip the questions
            const armed6 = await rearm(h, ctx);
            mark = await bsMark(h, ctx, "brainstorm: skip questions");
            const skipped = await bsClick(h, BS_PANE, "Skip the questions");
            const typed6 = await bsTyped(h, ctx, mark, "brainstorm: skip questions");
            const w6 = await waitFor(h, (w) => w.working.includes("Taking in your change."));
            await h.shot("cdp-shots/brainstorm-judge-wait-6-skip.png");
            rec("6. Skip the questions sends brainstorm: skip questions, and the pane shows Taking in your change., not the open box", armed6 && skipped === "clicked" && typed6.ok && w6.ok && !w6.judging, {
                armed: armed6,
                skipped,
                ...typed6.detail,
                working: w6.working,
                judgestate: await judgeState(h, ctx).catch(() => null),
            });
            await bsAgentTook(h, ctx);

            // 7. a stop that fails sends nothing and shows why
            const armed7 = await rearm(h, ctx);
            mark = await bsMark(h, ctx, null);
            const wrapped = await h.ev(WAIT_STOP_FAIL);
            let clicked7, quiet, w7;
            try {
                clicked7 = await h.ev(`(() => { const b = ${ROW(0)}; if (!b) return "missing"; b.click(); return "clicked"; })()`);
                quiet = await bsNothingTyped(h, mark);
                w7 = await waitFor(h, (w) => w.error.startsWith("Couldn't stop the judge:"), 3000);
            } finally {
                await h.ev(WAIT_STOP_RESTORE);
            }
            await h.shot("cdp-shots/brainstorm-judge-wait-7-stop-failed.png");
            rec(
                "7. a stop that fails: a row click sends nothing, the wait stays, and the pane shows Couldn't stop the judge: and why",
                armed7 && wrapped === true && clicked7 === "clicked" && quiet.ok && w7.ok && w7.error === `Couldn't stop the judge: ${WAIT_STOP_ERROR}` && w7.judging,
                { armed: armed7, wrapped, clicked: clicked7, sent: quiet.sent, error: w7.error, judging: w7.judging }
            );

            // 8. the same wait in the builder check's pane
            bsWrite(ctx, WAIT_IN_CHECK);
            const w8 = await waitFor(h, (w) => w.view === "check" && drawn(w), 7000);
            await h.shot("cdp-shots/brainstorm-judge-wait-8-check.png");
            rec("8. the builder check's pane shows the wait: the status line, the heading and the 7 rows", w8.ok && w8.list === `What the judge is weighing · ${WAIT_APPROACHES.length}`, {
                view: w8.view,
                status: w8.status,
                list: w8.list,
                rows: w8.rows?.length,
            });

            // 9. working with no approaches is any other wait
            bsWrite(ctx, WAIT_NO_APPROACHES);
            const w9 = await waitFor(h, (w) => w.working !== "", 7000);
            await h.shot("cdp-shots/brainstorm-judge-wait-9-working.png");
            rec("9. working set over a question with no approaches shows the Working view, no rows, and the tree line reads working, not an answer", w9.ok && !w9.judging && w9.rows.length === 0 && w9.working.includes(WAIT_WORKING) && w9.treeLine === "working", {
                working: w9.working,
                treeLine: w9.treeLine,
                judging: w9.judging,
                rows: w9.rows?.length,
            });
        } finally {
            await h.ev(WAIT_TYPED_REMOVE);
        }
    }

    return {
        name,
        surface: "agent",
        arrange: (h) => bsArrangeAgent(h, WAIT_TOPIC, WAIT),
        async assert(h, ctx) {
            const missing = await bsShowFile(h, ctx);
            if (missing != null) return [skipStep(name, `could not verify: ${missing}`)];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            const skip = (step, why) => steps.push(skipStep(step, why));
            // the record the scenario writes is reading, as the server's is once the judge starts
            await setReading(h, ctx);
            await check(h, ctx, rec, skip);
            return steps;
        },
        teardown: (h, ctx) => bsTeardownAgent(h, ctx, name),
    };
}

function eqJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
