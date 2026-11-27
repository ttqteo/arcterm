// sleep-keeps-ask: a sleeping agent keeps its question and its permission request in Chat
// (docs/superpowers/specs/2026-11-27-sleep-keeps-ask-design.md, builder's calls 10-13; frontend/app/view/agents/
// sleepheld.ts, sleepheldview.tsx, permissionmodel.ts permissionReadOnly / rowPermission, chatpane.tsx's ChatAsk).
// One real tab with no controller: its block meta carries cmd claude, cmd:cwd (what makes the block a session terminal,
// so a roster row), agent:sleeping and agent:sleepasking (the marks wavesrv writes when it puts an agent to sleep while
// it asks), and wavesrv holds a real pending ask for it (the `ask` RPC), so the roster, the kept question and the held
// answer all come from the app, not from a roster fixture. The answer is really held: AnswerAgentCommand finds the block
// asleep with its asking mark (jarvis answerHeld) and keeps the answer for the wake instead of typing it. Only the
// permission queue is a fixture (window.__arcAgentPermission), as sidebar-permission-row's is: wavesrv drops a request
// when the agent wakes or restarts, and nothing runs here. Nothing is woken: a wake would relaunch claude. Nothing is
// written to disk. kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor, polishNap).

import { focusAgent, tabFixtures } from "./agent-page-fixtures.mjs";

const NAME = "sleep-keeps-ask";
const LABEL = "sleep-keeps-ask";
const WAIT_MS = 15_000;
// the held answer's block grows in on the spring (springReveal, MOTION.spring ~ durMacro): well over before this
const SETTLE_MS = 600;
const SLEPT_FOR_MS = 5 * 60_000;
const FREED_BYTES = 330 * 2 ** 20;
const QUESTION = "Which migration order should I use?";
const OPTIONS = ["Schema first", "Data first"];
const PERMISSION = "npm run build";
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

// the ask the sleeping agent was waiting on: one question, two bare options (a click on one sends it)
const ASK = { header: "Migration", question: QUESTION, options: OPTIONS.map((label) => ({ label })) };

const setQueue = (h, blockId, requests) =>
    h.ev(
        `(() => { window.__arcAgentPermission.set(${JSON.stringify(`block:${blockId}`)}, ${JSON.stringify(requests)}); return true; })()`
    );

// what Chat on the agent draws: the kept question, the answer waiting for the wake, the sleeping line and the box's Wake,
// and the permission card with its buttons
const chatState = (id) => `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const chat = document.querySelector('[data-agent-chat="${id}"]');
    if (!chat) return { chat: false };
    const ask = chat.querySelector('[data-chat-ask="${id}"]');
    const held = chat.querySelector('[data-chat-held="${id}"]');
    const card = chat.querySelector('[data-permission-card="${id}"]');
    return {
        chat: true,
        asleep: flat(chat.querySelector("[data-chat-asleep]")),
        send: flat(chat.querySelector("[data-chat-send]")),
        ask: ask ? flat(ask) : null,
        options: ask ? [...ask.querySelectorAll("button")].map(flat) : [],
        held: held != null,
        heldLines: held ? [...held.querySelectorAll("[data-chat-held-line]")].map(flat) : [],
        heldNote: held ? flat(held.querySelector("[data-chat-held-note]")) : null,
        card: card != null,
        cardSummary: card ? flat(card.querySelector("[data-permission-summary]")) : null,
        cardWake: card ? flat(card.querySelector("[data-permission-wake]")) : null,
        cardAsleepNote: card ? flat(card.querySelector("[data-permission-asleep]")) : null,
        cardAllow: card?.querySelector("[data-permission-allow]") != null,
        cardDeny: card?.querySelector("[data-permission-deny]") != null,
        cardTerminal: card?.querySelector("[data-permission-terminal]") != null,
        toast: document.body.textContent.includes("The answer did not reach the agent"),
    };
})()`;

// what the agent's sidebar row says: the second line's note and the third line's parts
const rowState = (id) => `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const row = document.querySelector('[data-agent-tree] [data-agent-row="${id}"]');
    if (!row) return { row: false };
    const line = row.querySelector("[data-agent-perm-line]");
    const wake = line?.querySelector("[data-agent-perm-wake]");
    return {
        row: true,
        moon: row.querySelector("[data-agent-sleeping]") != null,
        note: row.querySelector("[data-agent-perm-note]") ? flat(row.querySelector("[data-agent-perm-note]")) : null,
        line: line != null,
        wake: wake ? flat(wake) : null,
        wakeDisabled: wake?.disabled ?? null,
        allow: line?.querySelector("[data-agent-perm-allow]") != null,
        deny: line?.querySelector("[data-agent-perm-deny]") != null,
        chat: line?.querySelector("[data-agent-perm-chat]") != null,
        wait: line?.querySelector("[data-agent-perm-wait]") ? flat(line.querySelector("[data-agent-perm-wait]")) : null,
    };
})()`;

// a real click at the element's centre: press and release, as the person's mouse
async function mouse(h, expr) {
    const at = await h.ev(`(() => {
        const r = (${expr})?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (at == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", {
            type,
            x: at.x,
            y: at.y,
            button: "left",
            buttons: type === "mousePressed" ? 1 : 0,
            clickCount: 1,
        });
    }
    return true;
}

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = tabFixtures(kit);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = {};
                // a throw past this point still returns ctx, so teardown undoes whatever was already set
                try {
                    await h.goto("agent");
                    const since = Date.now() - SLEPT_FOR_MS;
                    // the block as sleepAgent leaves it: no process (nothing starts one for a sleeping block), the resume
                    // command a wake would run, and both marks. makeTab sets the meta and reloads the block in the page.
                    // cmd:cwd is the agent's folder, and the roster needs it: the sidebar counts a block as a session
                    // terminal only when it is view term with a non-empty cmd:cwd (findSessionTermBlock), and a tab with no
                    // terminal block is no row and no Chat.
                    const tab = await makeTab(h, ctx, {
                        label: LABEL,
                        blockMeta: {
                            view: "term",
                            cmd: "claude",
                            "cmd:cwd": "~",
                            "cmd:args": ["--resume", "arc-verify-sleep-keeps-ask"],
                            "agent:sleeping": since,
                            "agent:sleepfreed": FREED_BYTES,
                            "agent:sleepasking": true,
                        },
                    });
                    Object.assign(ctx, { tabId: tab.tabId, blockId: tab.blockId });
                    // wavesrv's own pending ask for the block, as the agent's `wsh ask` registered it before the sleep
                    await h.rpc("ask", { oref: `block:${tab.blockId}`, questions: [ASK] });
                    ctx.askRaised = true;
                    await focusAgent(h, tab.tabId);
                    // Chat is the agent's default, pinned here so the steps never depend on a stored mode. The mode it had
                    // is kept for teardown (ctx.chatMode is set before the pin, so a throw in it is still undone).
                    ctx.chatMode = await h.ev(`window.__arcChatMode.get(${JSON.stringify(tab.tabId)})`);
                    await h.ev(`(() => { window.__arcChatMode.set(${JSON.stringify(tab.tabId)}, "chat"); return true; })()`);
                    // the roster and Chat are there before a step reads them: a failure now names where it stopped
                    // instead of surfacing as four steps that read { chat: false } / { row: false }
                    const row = `[data-agent-tree] [data-agent-row="${tab.tabId}"]`;
                    const layer = `[data-agent-chat="${tab.tabId}"]`;
                    if (!(await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(row)})`, WAIT_MS))) {
                        ctx.arrangeError = `the agent's row never reached the sidebar tree (${row}): the block is no session terminal, or the roster did not take the tab`;
                    } else if (!(await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(layer)})`, WAIT_MS))) {
                        ctx.arrangeError = `the agent's row is in the tree but its Chat layer never drew (${layer}): the agent is not focused in Chat`;
                    }
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                if (ctx.arrangeError != null) {
                    rec("arrange the sleeping agent and its ask", false, ctx.arrangeError);
                    return steps;
                }
                const id = ctx.tabId;
                const read = () => h.ev(chatState(id));
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    // 1. the kept question, drawn in Chat as an awake agent's is, beside the Asleep line and Wake
                    await polishWaitFor(
                        h,
                        `!!document.querySelector('[data-agent-chat="${id}"] [data-chat-ask="${id}"]')`,
                        WAIT_MS
                    );
                    await polishNap(SETTLE_MS);
                    const s1 = await read();
                    await shot(h, "1-question");
                    rec(
                        "1. Chat on the sleeping agent shows its kept question with both options beside the Asleep line, and the box offers Wake",
                        s1.chat &&
                            (s1.ask ?? "").includes(QUESTION) &&
                            OPTIONS.every((o) => s1.options.some((b) => b.includes(o))) &&
                            s1.asleep.startsWith("Asleep since") &&
                            s1.send.includes("Wake") &&
                            !s1.held,
                        JSON.stringify(s1)
                    );

                    // 2. an option picked on the card: wavesrv holds the answer for the wake, the card gives way to the
                    //    answer and the line that says when it goes in, and the agent stays asleep
                    const clicked = await mouse(
                        h,
                        `[...document.querySelectorAll('[data-agent-chat="${id}"] [data-chat-ask="${id}"] button')].find((b) => (b.textContent ?? "").includes(${JSON.stringify(OPTIONS[0])}))`
                    );
                    const held = await polishWaitFor(
                        h,
                        `!!document.querySelector('[data-agent-chat="${id}"] [data-chat-held="${id}"]')`,
                        WAIT_MS
                    );
                    await polishNap(SETTLE_MS);
                    const s2 = await read();
                    const pending = await h.rpc("agentaskpending", `block:${ctx.blockId}`);
                    if (held) ctx.answered = true;
                    await shot(h, "2-held");
                    rec(
                        "2. A picked option is accepted, not refused: the answer shows as `<question> → <option>` with `Goes in when <name> wakes`, the question card is gone, wavesrv no longer holds the ask, and the agent still sleeps",
                        clicked &&
                            held &&
                            s2.heldLines.length === 1 &&
                            s2.heldLines[0] === `${QUESTION} → ${OPTIONS[0]}` &&
                            /^Goes in when .+ wakes$/.test(s2.heldNote ?? "") &&
                            s2.ask == null &&
                            !s2.toast &&
                            (pending ?? "") === "" &&
                            s2.asleep.startsWith("Asleep since"),
                        JSON.stringify({ ...s2, clicked, pending })
                    );

                    // 3. a permission request the agent waited on: its card is read-only, the summary and Wake alone
                    await setQueue(h, ctx.blockId, [
                        {
                            id: "perm-sleep-1",
                            toolname: "Bash",
                            summary: PERMISSION,
                            answerable: true,
                            ts: Date.now() - 90_000,
                        },
                    ]);
                    await polishWaitFor(
                        h,
                        `!!document.querySelector('[data-agent-chat="${id}"] [data-permission-card="${id}"]')`,
                        WAIT_MS
                    );
                    await polishNap(SETTLE_MS);
                    const s3 = await read();
                    await shot(h, "3-permission");
                    rec(
                        "3. The sleeping agent's permission card shows what it waited on (the Bash command) and a Wake button, with no Allow, Deny or Answer in Terminal",
                        s3.card &&
                            s3.cardSummary === `$ ${PERMISSION}` &&
                            (s3.cardWake ?? "").includes("Wake") &&
                            !s3.cardAllow &&
                            !s3.cardDeny &&
                            !s3.cardTerminal &&
                            (s3.cardAsleepNote ?? "").startsWith("Asleep"),
                        JSON.stringify(s3)
                    );

                    // 4. the same agent's sidebar row: its note reads the command, its third line Wake with the wait
                    await polishWaitFor(
                        h,
                        `!!document.querySelector('[data-agent-tree] [data-agent-row="${id}"] [data-agent-perm-line="${id}"] [data-agent-perm-wake]')`,
                        WAIT_MS
                    );
                    await polishNap(SETTLE_MS);
                    const s4 = await h.ev(rowState(id));
                    await shot(h, "4-row");
                    rec(
                        "4. The same agent's sidebar row shows its moon and the command it waited on, and a third line with Wake and how long it waited, with no Allow or Deny",
                        s4.row &&
                            s4.moon &&
                            s4.note === `$ ${PERMISSION}` &&
                            s4.line &&
                            (s4.wake ?? "").includes("Wake") &&
                            s4.wakeDisabled === false &&
                            !s4.allow &&
                            !s4.deny &&
                            !s4.chat &&
                            /^waiting \d+[smh]$/.test(s4.wait ?? ""),
                        JSON.stringify(s4)
                    );
                } catch (e) {
                    rec("the scenario ran to its end", false, String(e?.message ?? e));
                }
                return steps;
            },
            // best-effort, so one failed step does not strand the rest
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                if (ctx.blockId) await step("clear the queue", () => setQueue(h, ctx.blockId, []));
                // the mode the tab had before the pin (Chat is the default, which setChatMode stores as no entry)
                if (ctx.tabId != null && ctx.chatMode != null) {
                    await step("put the chat mode back", () =>
                        h.ev(
                            `(() => { window.__arcChatMode.set(${JSON.stringify(ctx.tabId)}, ${JSON.stringify(ctx.chatMode)}); return true; })()`
                        )
                    );
                }
                // an ask the scenario never answered still sits in the registry
                if (ctx.askRaised && !ctx.answered) {
                    await step("clear the ask", () => h.rpc("agentaskclear", `block:${ctx.blockId}`));
                }
                await step("close the fixture tab", () => closeTabs(h, ctx));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
