// Chat's judge for a choice question (docs/superpowers/specs/2026-11-25-chat-choice-judge-design.md), one scenario:
//
//   chat-judge: a fixture Claude agent whose last reply ends as board C's does ("... A sửa đúng gốc nhưng đụng ba nơi gọi
//   parseFrame; B nhỏ hơn. Mình nghiêng A. A hay B?"), so Chat holds a judge record for the turn. The steps cover the
//   chips (this file's first five): the judge's pick is first in the row with the scale and [data-chat-suggest-judged],
//   Ctrl/Cmd+Enter sends it, Tab to it puts the reason in the empty box's line, the option the deep judge added is a chip
//   whose click sends its description and facts too, and answering while the deep judge reads stops it. Then the line under
//   the message (chatjudgeline.tsx, steps 6 to 17): the light line and how it opens, the hover tooltip, the action alone
//   with no pick, reading with its seconds ticking, Stop and the retry after it, the done line with an option the agent
//   did not name (and its cross-fade), a failed judge and Retry, Alt+J, the line staying in history, coming back after
//   an app restart (the records are lost, the pane remounts and reads them again), reduced motion, and the What's new
//   picture.
//
// The model's answer and the judge's three commands come from the DEV-only window.__chatSuggestFake and
// window.__chatJudgeFake (no haiku or sonnet session runs); the deep judge's run goes through the app's own store
// (requestDeepJudge), which the fake answers. The text a send types into the agent's block is recorded by a small RPC mock
// (the block has no controller). Keys are real CDP input events.
//
// A fixture Claude agent over real tabs and the page's dev mock roster, as scenarios-chat-suggest-card.mjs makes them.

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const WAIT_MS = 15000;
const SHORT_MS = 5000;
const PROJECT = "verify-chat-judge";
const NAME = "chat judge";
const MOCK_KEY = "__chatJudgeMock";
const FAKE_KEY = "__cjFake";
const KEYS = {
    tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    j: { key: "j", code: "KeyJ", windowsVirtualKeyCode: 74 },
};
const ALT = 1;
const REDUCE = [{ name: "prefers-reduced-motion", value: "reduce" }];

// what the person asked, and the agent's reply: a choice question written as prose, the agent leaning to A
const REQUEST = "sửa lỗi parseFrame bị crash khi frame rỗng";
const replyOf = (n) =>
    `Lần ${n}: có hai hướng sửa lỗi frame rỗng. A sửa đúng gốc nhưng đụng ba nơi gọi parseFrame; B nhỏ hơn. Mình nghiêng A. A hay B?`;
// the model's chips in its order, and the light pick (not the first chip, so moving it first is seen)
const CHIPS = [
    { text: "B, bỏ cache", desc: "Bỏ cache frame, parseFrame luôn đọc lại từ socket." },
    { text: "A, sửa parseFrame", desc: "Sửa parseFrame để nhận frame rỗng, ở cả ba nơi gọi." },
    { text: "cả hai luôn", desc: "Làm cả A và B trong một lần." },
];
const PICK = "A, sửa parseFrame";
const REASON = "A sửa đúng gốc: frame rỗng lọt vào ở parseFrame, B chỉ che lỗi.";
const ORDER = [PICK, "B, bỏ cache", "cả hai luôn"];
// the option the deep judge adds, and what its chip sends (the label, what it does, its facts in a parenthesis)
const ADDED = {
    label: "C, gom byte ở readLoop",
    desc: "readLoop đã gom đủ byte cho mọi khung khác, sửa ở đó thay vì ở ba nơi gọi parseFrame",
    facts: ["conn.go:212"],
};
const ADDED_SEND = `${ADDED.label}: ${ADDED.desc} (${ADDED.facts.join("; ")})`;
const DEEP_REASON = "readLoop đã gom đủ byte cho mọi khung khác (conn.go:212), nên sửa ở đó là gọn nhất.";
// the deep judge's cost as the line's end reads it (model, files read, seconds), and the error a failed judge gives
const DEEP_COST = "sonnet · 14 file · 41 s";
const JUDGE_ERROR = "hết giờ sau 180 s";
// how far under its message the line sits (chatjudgeline.tsx UNDER_MESSAGE)
const UNDER = 8;

// --- page expressions -------------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const inputOf = (id) => `${layerOf(id)}?.querySelector("[data-chat-input]")`;
// the box's line while it is empty: the sibling the editor draws as its placeholder (the Tab line names what Enter sends)
const hintOf = (id) =>
    `((${inputOf(id)})?.parentElement?.querySelector(":scope > [aria-hidden]")?.textContent ?? null)`;
// the row's chips as drawn: label, where it came from, the judge's mark, and whether Tab picked it
const ROW = (id) => `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return [...(${layerOf(id)}?.querySelectorAll("[data-chat-suggest-chip]") ?? [])].map((b) => ({
        text: flat(b.querySelector("span.truncate") ?? b),
        source: b.getAttribute("data-chat-suggest-chip"),
        judged: b.hasAttribute("data-chat-suggest-judged"),
        scale: !!b.querySelector("svg.lucide-scale"),
        picked: b.hasAttribute("data-chat-suggest-picked"),
        title: b.title,
    }));
})()`;

// The judge's lines as drawn, one per message that holds a record: where each sits (a row of its own right after the
// message's item, never inside it), what it says, its icon, rule and action. What it says is read from the line's live
// row: while a state cross-fades the old row is still in the body, hidden from assistive tech (aria-hidden) and taking
// no presses. `gap` is the space between the message's row and the line's rule. `rule` is the rule's width in CSS px,
// which a zoomed window snaps to a device pixel (0.909 at 110%).
const LINES = (id) => `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return [...(${layerOf(id)}?.querySelectorAll("[data-chat-judge-line]") ?? [])].map((el) => {
        const wrap = el.parentElement;
        const row = wrap?.previousElementSibling ?? null;
        const body = el.querySelector("[data-chat-judge-body]");
        const live = [...(body?.children ?? [])].filter((c) => c.getAttribute("aria-hidden") !== "true").at(-1) ?? el;
        const name = live.querySelector("[data-chat-judge-name]");
        const action = live.querySelector("[data-chat-judge-action]");
        const cs = getComputedStyle(el);
        return {
            key: el.getAttribute("data-chat-judge-line"),
            state: el.getAttribute("data-state"),
            text: flat(live),
            name: name ? flat(name) : null,
            action: action?.getAttribute("data-chat-judge-action") ?? null,
            actionText: action ? flat(action) : null,
            tails: [...live.querySelectorAll("[data-chat-judge-tail]")].map(flat),
            icon: live.querySelector("[data-chat-judge-icon]")?.getAttribute("data-chat-judge-icon") ?? null,
            scale: !!live.querySelector("svg.lucide-scale"),
            ruleWidth: parseFloat(cs.borderTopWidth),
            ruleStyle: cs.borderTopStyle,
            fontSize: cs.fontSize,
            beside: el.closest("[data-chat-item]") == null && row?.hasAttribute("data-chat-item") === true,
            inChat: el.closest("[data-chat-conversation]") != null,
            under: flat(row),
            gap: row ? Math.round(el.getBoundingClientRect().top - row.getBoundingClientRect().bottom) : null,
            kids: el.querySelector("[data-chat-judge-body]")?.children.length ?? 0,
        };
    });
})()`;
const lineExpr = (id, key, test) => `(${LINES(id)}).some((l) => l.key === ${JSON.stringify(key)} && (${test}))`;

// The hover tooltip of a line's name: its text (the reason, then the dim source), its box and its colours against the
// tokens a solid raised chip wears (a probe element resolves the tokens the way the page does).
const TIP = `(() => {
    const body = document.querySelector("[data-chat-judge-tip]");
    if (!body) return null;
    const chip = body.closest("[data-chart-tooltip]");
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;background-color:var(--color-surface-raised);border:1px solid var(--color-edge-strong)";
    document.body.appendChild(probe);
    const want = getComputedStyle(probe);
    const cs = getComputedStyle(chip);
    const out = {
        text: flat(body),
        reason: flat(body.children[0]),
        source: flat(body.children[1]),
        width: Math.round(chip.getBoundingClientRect().width),
        opacity: cs.opacity,
        bg: cs.backgroundColor,
        bgWant: want.backgroundColor,
        border: cs.borderTopColor,
        borderWant: want.borderTopColor,
        reasonColor: getComputedStyle(body.children[0]).color,
        sourceColor: body.children[1] ? getComputedStyle(body.children[1]).color : null,
    };
    probe.remove();
    return out;
})()`;

// Samples, frame by frame, the wrapper of the first line that is new after this call: its opacity, height and margin.
// window.__cjSamples.done is true 1.6 s after the line first draws (or after 30 s with none), so a step can start
// it, bring the line in and read how it opened.
const SAMPLE = `(() => {
    const keys = () => [...document.querySelectorAll("[data-chat-judge-line]")].map((e) => e.getAttribute("data-chat-judge-line"));
    const S = (window.__cjSamples = { seen: new Set(keys()), key: null, t0: null, frames: [], done: false });
    const until = performance.now() + 30000;
    const tick = () => {
        const now = performance.now();
        if (S.key == null) S.key = keys().find((k) => !S.seen.has(k)) ?? null;
        const el = S.key == null ? null : [...document.querySelectorAll("[data-chat-judge-line]")].find((e) => e.getAttribute("data-chat-judge-line") === S.key);
        const wrap = el?.parentElement;
        if (wrap) {
            S.t0 ??= now;
            const cs = getComputedStyle(wrap);
            S.frames.push({
                t: Math.round(now - S.t0),
                opacity: Number(cs.opacity),
                height: Math.round(wrap.getBoundingClientRect().height * 10) / 10,
                mt: Math.round(parseFloat(cs.marginTop)),
            });
        }
        if ((S.t0 != null && now - S.t0 > 1600) || now > until) {
            S.done = true;
            return;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
})()`;

// the bracketed-paste marks a long send is wrapped in, so a recorded input reads as the text sent
const bare = (s) => String(s).replace(/\x1b\[20[01]~/g, "");

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    const ts = (ctx, offsetMs = 0) => ({ cwd: ctx.dir, ts: new Date(Date.now() + offsetMs).toISOString() });
    const roster = (ctx, patch = {}) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 20 },
            id: ctx.tab.tabId,
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
            // the project the deep judge reads: without one the line shows what was judged and offers no action
            cwd: ctx.dir,
            ...patch,
        },
    ];

    async function key(h, k, modifiers = 0) {
        for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k, modifiers });
        await polishNap(300);
    }
    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/chat-judge-${name}.png`);
        } catch (e) {
            console.error(`chat-judge: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    // --- the RPC mock -----------------------------------------------------------------------------------------------

    // Stands in for wavesrv on what a send types into the agent's block (it has no controller): each controllerinput for
    // that block is recorded in window.<MOCK_KEY>.inputs, decoded, and answered with null; every other call goes on to
    // whatever client was installed before.
    async function installMock(h, blockId) {
        const got = await AC.agentPage(
            h,
            `const api = (await mod("app/store/wshclientapi.ts")).RpcApi;
            if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
            if (window.${MOCK_KEY}) return "already-installed";
            const prev = api.mockClient ?? null;
            const m = { api, prev, inputs: [] };
            api.setMockRpcClient({
                mockWshRpcCall(client, command, data, opts) {
                    if (command === "controllerinput" && data?.blockid === ${JSON.stringify(blockId)}) {
                        // base64 of the text's UTF-8 bytes: atob alone would read them as Latin-1 and garble every accent
                        m.inputs.push(new TextDecoder().decode(Uint8Array.from(atob(data.inputdata64 ?? ""), (c) => c.charCodeAt(0))));
                        return Promise.resolve(null);
                    }
                    return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
                },
                mockWshRpcStream(client, command, data, opts) {
                    return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
                },
            });
            window.${MOCK_KEY} = m;
            return "installed";`
        );
        if (got !== "installed") throw new Error(`the RPC mock: ${got}`);
    }
    const removeMock = (h) =>
        AC.agentPage(
            h,
            `const m = window.${MOCK_KEY};
            if (m) { m.api.setMockRpcClient(m.prev); delete window.${MOCK_KEY}; }
            return true;`
        );
    // what has been typed into the block, as the texts sent (a bare "\r" is the Enter that follows each)
    const sentTexts = async (h) =>
        ((await h.ev(`window.${MOCK_KEY}?.inputs ?? []`)) ?? []).map(bare).filter((s) => s !== "\r");

    // --- the fakes --------------------------------------------------------------------------------------------------

    // The model's answer is the chips with a judge record for the turn (a light pick, or none while F.bare is set); the
    // judge's commands are answered by window.<FAKE_KEY>.judge (set by the steps that start a deep judge), and every call is
    // kept to read back. F.records is what wavesrv would have stored, which the list command answers (an app restart).
    // F.hold() makes the deep judge a call that reads until F.release(record) lets it go.
    const FAKES = `(() => {
        const CHIPS = ${JSON.stringify(CHIPS)};
        const F = (window.${FAKE_KEY} = { asked: [], judges: [], stops: [], lists: [], judge: null, release: null, holds: [], records: {}, bare: false });
        F.record = (key) => ({
            key,
            ts: Date.now(),
            question: "A hay B?",
            recent: [${JSON.stringify(REQUEST)}],
            options: CHIPS,
            pick: ${JSON.stringify(PICK)},
            reason: ${JSON.stringify(REASON)},
        });
        F.hold = () => {
            F.judge = (d) => new Promise((res) => { F.holds.push((rec) => res(rec ?? F.record(d.key))); });
            F.release = (rec) => { for (const go of F.holds.splice(0)) go(rec); };
        };
        window.__chatSuggestFake = (d) => {
            F.asked.push({ key: d.key, choice: d.choice, question: d.question });
            const judge = F.bare ? { ...F.record(d.key), pick: undefined, reason: undefined } : F.record(d.key);
            F.records[d.key] = judge;
            return { replies: CHIPS.map((c) => c.text), judge };
        };
        window.__chatJudgeFake = (cmd, data) => {
            if (cmd === "list") {
                F.lists.push(data);
                return { records: Object.values(F.records).filter((r) => r.key.startsWith(data.agentid + ":")) };
            }
            if (cmd === "stop") {
                F.stops.push(data);
                return null;
            }
            F.judges.push(data);
            return F.judge(data);
        };
        return true;
    })()`;

    const scenario = {
        name: "chat-judge",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-judge-")), prev: {}, turn: 1 };
            let at = "reading the keys";
            try {
                for (const k of [GRID_KEY, "agent.chatmode"]) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "writing the transcript";
                ctx.transcript = AC.writeTranscript(ctx.dir, "chat-judge-session", [
                    AC.userText(REQUEST, { cwd: ctx.dir, ts: new Date(Date.now() - 600_000).toISOString() }),
                    AC.assistantText(replyOf(ctx.turn), { cwd: ctx.dir, ts: new Date(Date.now() - 598_000).toISOString() }),
                ]);

                at = "resetting the stores";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, { label: NAME });

                // installed before the roster, so the pane's first ask and its list of judge records are answered by them
                at = "installing the fakes and the RPC mock";
                await h.ev(FAKES);
                await installMock(h, ctx.tab.blockId);

                at = "setting the roster";
                await AC.setRoster(h, roster(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            // a step that throws is a failed step, not the end of the run: the ones after it read what they need themselves
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent, its transcript, the fakes and the RPC mock", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tab.tabId;
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, A);
            const mac = await h.ev(`/Mac/i.test(navigator.platform)`);
            const MOD = mac ? 4 : 2;

            const row = () => h.ev(ROW(A));
            const asked = () => h.ev(`window.${FAKE_KEY}.asked`);
            // the agent's next turn: the text the person sent lands, then the agent asks its question again (worded
            // differently, so the turn has a key of its own and the model is asked afresh)
            // (`judged` false for a record with no pick: no chip is marked then)
            async function nextTurn(sent, judged = true) {
                ctx.turn += 1;
                appendFileSync(
                    ctx.transcript,
                    [AC.userText(sent ?? "tiếp đi", ts(ctx, 0)), AC.assistantText(replyOf(ctx.turn), ts(ctx, 800))].join("\n") + "\n"
                );
                await AC.setRoster(h, roster(ctx, { idleSince: Date.now() + 1000 }));
                // the row of this turn: asked for it, and its chips drawn with the judge's pick first
                const want = ctx.turn;
                return polishWaitFor(
                    h,
                    `window.${FAKE_KEY}.asked.length >= ${want} && (${ROW(A)}).length >= 3${judged ? ` && (${ROW(A)})[0]?.judged === true` : ""}`,
                    WAIT_MS
                );
            }
            // the deep judge for the live turn's record, through the app's own store (the fake answers its command)
            const startDeep = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/chatsuggeststore.ts");
                    const key = window.${FAKE_KEY}.asked.at(-1)?.key;
                    if (key == null) return "no-key";
                    S.requestDeepJudge(key, ${JSON.stringify(ctx.dir)});
                    return key;`
                );
            const deepState = (key) =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/agents/chatsuggeststore.ts");
                    return globalStore.get(S.chatJudgeAtom)[${JSON.stringify(key)}]?.deep?.state ?? null;`
                );

            // wait for the first turn's chips: the model's three, the judge's pick among them
            const first = await polishWaitFor(h, `(${ROW(A)}).length >= 3 && (${ROW(A)})[0]?.judged === true`, WAIT_MS);
            await polishNap(500);

            // 1. the light pick's chip is the row's first, with the scale icon and data-chat-suggest-judged: the model's
            // order was B, A, cả hai, so it moved
            await run("1. judged chip first", async (name) => {
                const got = await row();
                const ask = (await asked()).at(-1);
                await shot(h, "1-judged-first");
                rec(
                    `${name}: the row reads ${ORDER.join(" · ")} (the model said B first), only ${PICK} is [data-chat-suggest-judged] with the scale icon, the others have neither, and the model was asked with its turn's key and choice true`,
                    first &&
                        got.map((c) => c.text).join(" · ") === ORDER.join(" · ") &&
                        got[0].judged &&
                        got[0].scale &&
                        got.filter((c) => c.judged).length === 1 &&
                        got.filter((c) => c.scale).length === 1 &&
                        got.every((c) => c.source === "model") &&
                        ask?.choice === true &&
                        typeof ask?.key === "string" &&
                        ask.key.startsWith(`${A}:`),
                    { first, got, ask }
                );
            });

            // 2. Ctrl+Enter (Cmd+Enter on a Mac) over the empty box takes the row's first chip, the judged one: what is typed
            // into the agent is that chip's text and no other
            await run("2. Cmd+Enter sends the judged chip", async (name) => {
                const before = (await sentTexts(h)).length;
                const chip = (await row())[0]?.text ?? null;
                await h.ev(`(${inputOf(A)})?.focus()`);
                await key(h, { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, MOD);
                const sent = await polishWaitFor(h, `(window.${MOCK_KEY}?.inputs ?? []).some((s) => s.includes(${JSON.stringify(PICK)}))`, SHORT_MS);
                const texts = (await sentTexts(h)).slice(before);
                await shot(h, "2-quick-send");
                rec(
                    `${name}: Ctrl/Cmd+Enter over the empty box types exactly ${JSON.stringify(PICK)}, the text of the first chip, and none of the other chips' texts`,
                    sent && chip === PICK && texts.length === 1 && texts[0] === chip,
                    { sent, chip, texts }
                );
            });

            // 3. Tab to the judged chip: the empty box's line says what Enter sends and why the judge picked it; the next
            // chip's line has no reason
            await run("3. Tab shows the reason", async (name) => {
                const up = await nextTurn(PICK);
                await polishNap(500);
                await h.ev(`(${inputOf(A)})?.focus()`);
                await key(h, KEYS.tab);
                const onJudged = await row();
                const hintJudged = await h.ev(hintOf(A));
                await shot(h, "3-tab-reason");
                await key(h, KEYS.tab);
                const onNext = await row();
                const hintNext = await h.ev(hintOf(A));
                await key(h, KEYS.escape);
                rec(
                    `${name}: Tab picks ${PICK} (the first chip) and the empty box's line reads it sends it with the reason "${REASON}"; the next Tab picks ${ORDER[1]} and its line says what it sends with no reason`,
                    up &&
                        onJudged[0]?.picked === true &&
                        onJudged[0]?.judged === true &&
                        (hintJudged ?? "").includes(`sends “${PICK}”`) &&
                        (hintJudged ?? "").includes(REASON) &&
                        onNext[1]?.picked === true &&
                        (hintNext ?? "").includes(`sends “${ORDER[1]}”`) &&
                        !(hintNext ?? "").includes(REASON),
                    { up, hintJudged, hintNext, picked: onJudged.map((c) => c.picked), pickedNext: onNext.map((c) => c.picked) }
                );
            });

            // 4. the deep judge finishes with an option the agent never named, and picks it: its chip is first (the scale
            // moves to it from the light pick's), and a click sends its label with the description and facts
            await run("4. added chip sends its full text", async (name) => {
                const up = await nextTurn(null);
                await polishNap(300);
                await h.ev(
                    `(() => { const F = window.${FAKE_KEY}; F.judge = (d) => ({ ...F.record(d.key), deep: { state: "done", startts: Date.now() - 41000, endts: Date.now(), pick: ${JSON.stringify(ADDED.label)}, reason: ${JSON.stringify(DEEP_REASON)}, added: ${JSON.stringify(ADDED)}, model: "sonnet", tokens: 52000, files: 14 } }); return true; })()`
                );
                const key4 = await startDeep();
                const shown = await polishWaitFor(h, `(${ROW(A)})[0]?.text === ${JSON.stringify(ADDED.label)}`, WAIT_MS);
                await polishNap(500);
                const got = await row();
                const before = (await sentTexts(h)).length;
                await shot(h, "4-added-chip");
                await h.ev(`${layerOf(A)}?.querySelector('[data-chat-suggest-chip="judge"]')?.click()`);
                const sent = await polishWaitFor(h, `(window.${MOCK_KEY}?.inputs ?? []).some((s) => s.includes(${JSON.stringify(ADDED.label)}))`, SHORT_MS);
                const texts = (await sentTexts(h)).slice(before);
                rec(
                    `${name}: once the deep judge is done the first chip is ${JSON.stringify(ADDED.label)} ([data-chat-suggest-chip="judge"], judged, with the scale) and ${PICK} has lost its mark; a click types ${JSON.stringify(ADDED_SEND)}`,
                    up &&
                        typeof key4 === "string" &&
                        shown &&
                        got[0].source === "judge" &&
                        got[0].judged &&
                        got[0].scale &&
                        got.filter((c) => c.judged).length === 1 &&
                        got.filter((c) => c.scale).length === 1 &&
                        got.find((c) => c.text === PICK)?.judged !== true &&
                        got[0].title.includes(ADDED_SEND) &&
                        sent &&
                        texts.length === 1 &&
                        texts[0] === ADDED_SEND,
                    { up, key4, shown, got, sent, texts }
                );
            });

            // 5. with the deep judge reading, sending a chip answers the turn: the judge is told to stop (the fake's stop
            // gets the turn's key) and its record goes stopped
            await run("5. answering stops the judge", async (name) => {
                const up = await nextTurn(ADDED_SEND);
                await polishNap(300);
                // a judge that never answers on its own: it reads until the step lets it go
                await h.ev(
                    `(() => { const F = window.${FAKE_KEY}; F.stops.length = 0; F.judge = () => new Promise((res) => { F.release = () => res(F.record("")); }); return true; })()`
                );
                const judgesBefore = await h.ev(`window.${FAKE_KEY}.judges.length`);
                const key5 = await startDeep();
                const reading = await polishWaitFor(h, `window.${FAKE_KEY}.judges.length > ${judgesBefore}`, SHORT_MS);
                const stateBefore = await deepState(key5);
                const before = (await sentTexts(h)).length;
                await shot(h, "5-reading");
                await h.ev(`${layerOf(A)}?.querySelector('[data-chat-suggest-chip="model"]:not([data-chat-suggest-judged])')?.click()`);
                const stopped = await polishWaitFor(h, `window.${FAKE_KEY}.stops.length === 1`, SHORT_MS);
                const stops = await h.ev(`window.${FAKE_KEY}.stops`);
                const stateAfter = await deepState(key5);
                const texts = (await sentTexts(h)).slice(before);
                // let the held call go; the app has forgotten it, so its late answer is not kept
                await h.ev(`(() => { window.${FAKE_KEY}.release?.(); return true; })()`);
                rec(
                    `${name}: with the record's deep judge reading, sending a chip calls the judge's stop once with this turn's key, the record goes from reading to stopped, and the chip's text is what was sent`,
                    up &&
                        typeof key5 === "string" &&
                        reading &&
                        stateBefore === "reading" &&
                        stopped &&
                        stops.length === 1 &&
                        stops[0].key === key5 &&
                        stateAfter === "stopped" &&
                        texts.length === 1 &&
                        CHIPS.some((c) => c.text === texts[0]),
                    { up, key5, reading, stateBefore, stopped, stops, stateAfter, texts }
                );
            });

            // --- the line under the message (steps 6 to 17) -----------------------------------------------------------------

            const lines = () => h.ev(LINES(A));
            const lineFor = async (tk) => (await lines()).find((l) => l.key === tk) ?? null;
            const liveKey = async () => (await asked()).at(-1)?.key ?? null;
            // the line's action button, pressed as a click does
            const pressAction = (action) =>
                h.ev(`(() => { const b = ${layerOf(A)}?.querySelector('[data-chat-judge-action="${action}"]'); b?.click(); return !!b; })()`);
            const waitState = (tk, state, ms = WAIT_MS) => polishWaitFor(h, lineExpr(A, tk, `l.state === ${JSON.stringify(state)}`), ms);
            const judgeCalls = () => h.ev(`window.${FAKE_KEY}.judges.length`);
            // the pointer onto a line's name (from above it, so the tooltip opens as it does for a hand), and away from it
            async function hoverName(tk) {
                const at = await h.ev(`(() => {
                    const line = [...document.querySelectorAll("[data-chat-judge-line]")].find((e) => e.getAttribute("data-chat-judge-line") === ${JSON.stringify(tk)});
                    const name = line?.querySelector("[data-chat-judge-name]");
                    if (!name) return null;
                    name.scrollIntoView({ block: "center" });
                    const r = name.getBoundingClientRect();
                    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
                })()`);
                if (at == null) return false;
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y - 60 });
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
                return true;
            }
            const leaveName = () => h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 });

            // 6. under the question message the light line: "Gợi ý" + the light pick + the hover hint, a hairline rule above, the
            // scale icon, Judge kỹ at its end, and nothing of it in the composer. Its opening is sampled frame by frame
            await run("6. light line", async (name) => {
                await h.ev(SAMPLE);
                const up = await nextTurn("tiếp tục");
                const sampled = await polishWaitFor(h, "window.__cjSamples?.done === true", WAIT_MS * 2);
                const tk = await liveKey();
                const all = await lines();
                const l = all.find((x) => x.key === tk) ?? null;
                const frames = (await h.ev(`window.__cjSamples?.frames ?? []`)) ?? [];
                await shot(h, "6-light-line");
                rec(
                    `${name}: the line is a row of its own right after the question message's item (${UNDER} px under it, never inside it) and reads "Gợi ý ${PICK} · rê vào để xem lý do": state light, a solid hairline rule above it (one device pixel), the scale icon, 12.5 px text, Judge kỹ as its action; every judge line is in the conversation, none in the composer`,
                    up &&
                        sampled &&
                        l != null &&
                        l.state === "light" &&
                        l.beside &&
                        l.under.includes(replyOf(ctx.turn)) &&
                        Math.abs((l.gap ?? 99) - UNDER) <= 1 &&
                        l.text.startsWith(`Gợi ý ${PICK}`) &&
                        l.name === PICK &&
                        l.text.includes("· rê vào để xem lý do") &&
                        l.ruleWidth > 0.5 &&
                        l.ruleWidth <= 1 &&
                        l.ruleStyle === "solid" &&
                        l.fontSize === "12.5px" &&
                        l.icon === "scale" &&
                        l.scale &&
                        l.action === "judge" &&
                        l.actionText === "Judge kỹ" &&
                        all.every((x) => x.inChat),
                    { up, sampled, l, lines: all.length, inChat: all.map((x) => x.inChat) }
                );
                // the opening: from nearly closed and transparent, its margin pulled up by the column's gap, on the spring, to
                // its own height and a place UNDER px under the message, with no overshoot
                const last = frames.at(-1);
                const monotone = frames.every((f, i) => i === 0 || f.opacity >= frames[i - 1].opacity - 0.001);
                rec(
                    `${name} (opening): the line opens under its message on the spring: its first frame is transparent and under half its height with its margin pulled up past ${UNDER} px, a frame between shows it part way, it ends at opacity 1 and ${UNDER} px under the message, and its height never passes the end`,
                    frames.length >= 4 &&
                        frames[0].opacity <= 0.5 &&
                        frames[0].height <= last.height / 2 &&
                        frames[0].mt < -UNDER &&
                        frames.some((f) => (f.opacity > 0.05 && f.opacity < 0.95) || (f.height > 0 && f.height < last.height - 1)) &&
                        last.opacity === 1 &&
                        last.mt === -UNDER &&
                        last.height > 0 &&
                        frames.every((f) => f.height <= last.height + 1) &&
                        monotone,
                    { frames: frames.length, first: frames[0], mid: frames[Math.floor(frames.length / 3)], last }
                );
            });

            // 7. hovering the pick's name opens the app's tooltip: a solid raised chip, the strong edge, at most 420 px wide, the
            // reason and under it the dim source
            await run("7. hover shows the reason", async (name) => {
                const tk = await liveKey();
                const hovered = await hoverName(tk);
                const shown = await polishWaitFor(h, `(${TIP})?.opacity === "1"`, SHORT_MS);
                const tip = await h.ev(TIP);
                await shot(h, "7-tip");
                await leaveName();
                const gone = await polishWaitFor(h, `!document.querySelector("[data-chat-judge-tip]")`, SHORT_MS);
                rec(
                    `${name}: hovering the name opens a solid raised chip (the surface-raised fill, the strong edge, at most 420 px wide) holding the light reason and then "haiku, chỉ đọc reply" in a dimmer ink, and it is gone once the pointer leaves`,
                    hovered &&
                        shown &&
                        tip != null &&
                        tip.reason === REASON &&
                        tip.source === "haiku, chỉ đọc reply" &&
                        tip.width <= 421 &&
                        tip.bg === tip.bgWant &&
                        tip.border === tip.borderWant &&
                        tip.sourceColor !== tip.reasonColor &&
                        gone,
                    { hovered, shown, tip, gone }
                );
            });

            // 8. a record with no light pick, on the live turn: the deep judge stays reachable, as the action alone
            await run("8. no pick still offers Judge kỹ", async (name) => {
                await h.ev(`window.${FAKE_KEY}.bare = true`);
                const up = await nextTurn("tiếp", false);
                await polishNap(900);
                const tk = await liveKey();
                const l = await lineFor(tk);
                await h.ev(`window.${FAKE_KEY}.bare = false`);
                const chips = await row();
                await shot(h, "8-no-pick");
                rec(
                    `${name}: a record with no light pick on the live turn draws the action alone: the line's text is exactly "Judge kỹ", with no name, no icon and no hint, and no chip is marked judged`,
                    up &&
                        l != null &&
                        l.state === "light" &&
                        l.text === "Judge kỹ" &&
                        l.name == null &&
                        l.icon == null &&
                        l.action === "judge" &&
                        chips.every((c) => !c.judged),
                    { up, l, chips: chips.map((c) => c.judged) }
                );
            });

            // 9. Judge kỹ: the line reads while the deep judge works, the spinner in place of the scale, its seconds ticking, and Dừng
            await run("9. reading ticks", async (name) => {
                const up = await nextTurn("tiếp");
                await polishNap(900);
                const tk = await liveKey();
                await h.ev(`window.${FAKE_KEY}.hold()`);
                const before = await judgeCalls();
                const pressed = await pressAction("judge");
                const reading = await waitState(tk, "reading", SHORT_MS);
                const first = await lineFor(tk);
                await polishNap(1300);
                const second = await lineFor(tk);
                await shot(h, "9-reading");
                const calls = await judgeCalls();
                const seconds = (l) => Number(/^(\d+) s$/.exec(l?.tails?.[0] ?? "")?.[1] ?? NaN);
                rec(
                    `${name}: pressing Judge kỹ makes the line read "Judge đang đọc code, không thấy agent khuyên gì · N s": the spinner replaces the scale, the seconds go up between two reads 1.3 s apart, the action is Dừng, and the judge was asked once`,
                    up &&
                        pressed &&
                        reading &&
                        first?.state === "reading" &&
                        first.icon === "spin" &&
                        first.scale === false &&
                        first.text.startsWith("Judge đang đọc code, không thấy agent khuyên gì · ") &&
                        second?.icon === "spin" &&
                        seconds(first) >= 0 &&
                        seconds(second) > seconds(first) &&
                        second.action === "stop" &&
                        second.actionText === "Dừng" &&
                        calls === before + 1,
                    { up, pressed, reading, first, second, before, calls }
                );
            });

            // 10. Dừng stops the judge and the line goes back to the light mark; Judge kỹ again runs it again, with retry
            await run("10. Stop returns to light", async (name) => {
                const tk = await liveKey();
                const stopsBefore = await h.ev(`window.${FAKE_KEY}.stops.length`);
                const pressedStop = await pressAction("stop");
                const light = await waitState(tk, "light", SHORT_MS);
                const l = await lineFor(tk);
                const stops = await h.ev(`window.${FAKE_KEY}.stops`);
                const state = await deepState(tk);
                const callsBefore = await judgeCalls();
                const pressedAgain = await pressAction("judge");
                const again = await waitState(tk, "reading", SHORT_MS);
                const judges = await h.ev(`window.${FAKE_KEY}.judges`);
                await shot(h, "10-stop-retry");
                rec(
                    `${name}: Dừng calls the judge's stop once with this turn's key and the line is the light mark again (state light, "Gợi ý ${PICK}", Judge kỹ back); pressing Judge kỹ again asks the judge once more with retry true`,
                    pressedStop &&
                        light &&
                        stops.length === stopsBefore + 1 &&
                        stops.at(-1).key === tk &&
                        state === "stopped" &&
                        l?.state === "light" &&
                        l.name === PICK &&
                        l.action === "judge" &&
                        l.actionText === "Judge kỹ" &&
                        pressedAgain &&
                        again &&
                        judges.length === callsBefore + 1 &&
                        judges.at(-1).retry === true &&
                        judges.at(-1).key === tk,
                    { pressedStop, light, stops, state, l, pressedAgain, again, callsBefore, last: judges.at(-1) }
                );
            });

            // 11. the judge on this turn answers with an option the agent never named, and picks it: the line says so, no action is
            // left, its text cross-fades, and the tooltip holds the deep reason and the cost
            await run("11. done with an added option", async (name) => {
                const tk = await liveKey();
                ctx.doneKey = tk;
                // the call stopped in step 10 answers late and is not kept; the one reading now answers with the added option
                const frames = await h.ev(`new Promise((resolve) => {
                    const F = window.${FAKE_KEY};
                    const line = [...document.querySelectorAll("[data-chat-judge-line]")].find((e) => e.getAttribute("data-chat-judge-line") === ${JSON.stringify(tk)});
                    const body = line.querySelector("[data-chat-judge-body]");
                    const done = { ...F.record(${JSON.stringify(tk)}), deep: { state: "done", startts: Date.now() - 41000, endts: Date.now(), pick: ${JSON.stringify(ADDED.label)}, reason: ${JSON.stringify(DEEP_REASON)}, added: ${JSON.stringify(ADDED)}, model: "sonnet", tokens: 52000, files: 14 } };
                    F.records[done.key] = done;
                    const out = [];
                    const t0 = performance.now();
                    F.release(done);
                    const tick = () => {
                        out.push({ t: Math.round(performance.now() - t0), kids: [...body.children].map((c) => Number(getComputedStyle(c).opacity)) });
                        if (performance.now() - t0 < 700) requestAnimationFrame(tick);
                        else resolve(out);
                    };
                    requestAnimationFrame(tick);
                })`);
                const done = await waitState(tk, "done", SHORT_MS);
                const l = await lineFor(tk);
                const chips = await row();
                const hovered = await hoverName(tk);
                const shown = await polishWaitFor(h, `(${TIP})?.opacity === "1"`, SHORT_MS);
                const tip = await h.ev(TIP);
                await shot(h, "11-done-added");
                await leaveName();
                const last = frames.at(-1);
                rec(
                    `${name}: the line reads "Judge chọn ${ADDED.label} (agent không nêu)" with ${JSON.stringify(DEEP_COST)} at its end and no action, the scale icon, and the added chip first in the row; its tooltip holds the deep reason and the cost`,
                    done &&
                        l?.state === "done" &&
                        l.text.startsWith(`Judge chọn ${ADDED.label} (agent không nêu)`) &&
                        l.name === ADDED.label &&
                        l.tails.length === 1 &&
                        l.tails[0] === DEEP_COST &&
                        l.action == null &&
                        l.icon === "scale" &&
                        chips[0]?.text === ADDED.label &&
                        hovered &&
                        shown &&
                        tip?.reason === DEEP_REASON &&
                        tip.source === DEEP_COST &&
                        // a reason of this length fills the chip to its 420 px (the tooltip's own default is 320)
                        tip.width > 330 &&
                        tip.width <= 421,
                    { done, l, chips: chips.map((c) => c.text), hovered, shown, tip }
                );
                rec(
                    `${name} (cross-fade): while reading turns into done the old text and the new draw together for a few frames (two children in the line's body, one of them part way), and at the end one child at opacity 1 is left`,
                    frames.length > 3 &&
                        frames.some((f) => f.kids.length === 2) &&
                        frames.some((f) => f.kids.some((o) => o > 0.05 && o < 0.95)) &&
                        last.kids.length === 1 &&
                        last.kids[0] === 1,
                    { frames: frames.length, two: frames.filter((f) => f.kids.length === 2).length, last }
                );
            });

            // 12. a judge that fails: the light mark stays, the error and Thử lại show, and Thử lại asks again with retry
            await run("12. failed offers Retry", async (name) => {
                const up = await nextTurn("tiếp");
                await polishNap(900);
                const tk = await liveKey();
                await h.ev(`(() => { window.${FAKE_KEY}.judge = () => Promise.reject(new Error(${JSON.stringify(JUDGE_ERROR)})); return true; })()`);
                const pressed = await pressAction("judge");
                const failed = await waitState(tk, "failed", SHORT_MS);
                const l = await lineFor(tk);
                const chips = await row();
                await shot(h, "12-failed");
                await h.ev(`window.${FAKE_KEY}.hold()`);
                const callsBefore = await judgeCalls();
                const retried = await pressAction("retry");
                const reading = await waitState(tk, "reading", SHORT_MS);
                const judges = await h.ev(`window.${FAKE_KEY}.judges`);
                // left stopped, so no step after this one meets a judge still reading
                await pressAction("stop");
                const back = await waitState(tk, "light", SHORT_MS);
                rec(
                    `${name}: a judge that fails leaves the light mark ("Gợi ý ${PICK}", the judged chip still first), says "Judge không xong: ${JUDGE_ERROR}" and offers Thử lại; Thử lại asks the judge again with retry true`,
                    up &&
                        pressed &&
                        failed &&
                        l?.state === "failed" &&
                        l.text.includes(`Gợi ý ${PICK}`) &&
                        l.text.includes(`Judge không xong: ${JUDGE_ERROR}`) &&
                        l.icon === "scale" &&
                        l.action === "retry" &&
                        l.actionText === "Thử lại" &&
                        chips[0]?.judged === true &&
                        retried &&
                        reading &&
                        judges.length === callsBefore + 1 &&
                        judges.at(-1).retry === true &&
                        judges.at(-1).key === tk &&
                        back,
                    { up, pressed, failed, l, retried, reading, last: judges.at(-1), back }
                );
            });

            // 13. Alt+J starts the judge on a fresh turn, from the chat box; with the judge reading, the key does nothing (Stop is the
            // line's own button)
            await run("13. Alt+J judges", async (name) => {
                const up = await nextTurn("tiếp");
                await polishNap(900);
                const tk = await liveKey();
                await h.ev(`window.${FAKE_KEY}.hold()`);
                const before = await judgeCalls();
                await h.ev(`(${inputOf(A)})?.focus()`);
                await key(h, KEYS.j, ALT);
                const started = await polishWaitFor(h, `window.${FAKE_KEY}.judges.length === ${before + 1}`, SHORT_MS);
                const reading = await waitState(tk, "reading", SHORT_MS);
                const call = (await h.ev(`window.${FAKE_KEY}.judges`)).at(-1);
                await key(h, KEYS.j, ALT);
                const after = await judgeCalls();
                await shot(h, "13-alt-j");
                // the judge answers with the light record alone, so the line is the light mark again
                await h.ev(`window.${FAKE_KEY}.release()`);
                const back = await waitState(tk, "light", SHORT_MS);
                rec(
                    `${name}: with focus in the chat box Alt+J asks the judge once for this turn's key and the project (retry false) and the line reads; Alt+J while it reads asks nothing more`,
                    up &&
                        started &&
                        reading &&
                        call?.key === tk &&
                        call.cwd === ctx.dir &&
                        call.retry === false &&
                        after === before + 1 &&
                        back,
                    { up, started, reading, call, before, after, back }
                );
            });

            // 14. after a chip answers the question, the old message still shows what the judge said, with nothing to press
            await run("14. history keeps the line", async (name) => {
                const oldKey = await liveKey();
                const oldReply = replyOf(ctx.turn);
                const before = (await sentTexts(h)).length;
                const clicked = await h.ev(
                    `(() => { const b = ${layerOf(A)}?.querySelector('[data-chat-suggest-chip="model"]:not([data-chat-suggest-judged])'); b?.click(); return !!b; })()`
                );
                const sent = await polishWaitFor(h, `(window.${MOCK_KEY}?.inputs ?? []).length > ${before}`, SHORT_MS);
                const texts = (await sentTexts(h)).slice(before);
                const up = await nextTurn(texts[0] ?? "tiếp");
                await polishNap(900);
                const old = await lineFor(oldKey);
                const doneOld = await lineFor(ctx.doneKey);
                const live = await lineFor(await liveKey());
                await shot(h, "14-history");
                rec(
                    `${name}: once a chip answered, the old message keeps its line ("Gợi ý ${PICK}", under its own message) with no action, the older deep result still reads "Judge chọn ${ADDED.label}", and only the new turn's line offers Judge kỹ`,
                    clicked &&
                        sent &&
                        up &&
                        old != null &&
                        old.state === "light" &&
                        old.text.startsWith(`Gợi ý ${PICK}`) &&
                        old.under.includes(oldReply) &&
                        old.action == null &&
                        doneOld?.state === "done" &&
                        doneOld.text.startsWith(`Judge chọn ${ADDED.label}`) &&
                        doneOld.action == null &&
                        live?.action === "judge",
                    { clicked, sent, up, old, doneOld, live }
                );
            });

            // 15. an app restart loses the records Chat holds; the pane mounting again reads them back from wavesrv, and the lines (and the
            // judged chip) are back. The fake's list answers what the turns stored
            await run("15. the line survives a restart", async (name) => {
                const tk = await liveKey();
                const listsBefore = await h.ev(`window.${FAKE_KEY}.lists.length`);
                const had = (await lines()).length;
                await h.ev(`(() => { ${layerOf(A)}.__cjMark = true; window.__chatJudgeReset(); return true; })()`);
                const emptied = await polishWaitFor(h, `(${LINES(A)}).length === 0`, SHORT_MS);
                // the pane mounts again: to Terminal and back to Chat (the layer exists only while Chat is shown)
                await h.ev(`window.__arcChatMode.set(${JSON.stringify(A)}, "terminal")`);
                await polishWaitFor(h, `!${layerOf(A)}`, SHORT_MS);
                await h.ev(`window.__arcChatMode.set(${JSON.stringify(A)}, "chat")`);
                const remounted = await polishWaitFor(h, `!!${layerOf(A)} && ${layerOf(A)}.__cjMark !== true`, WAIT_MS);
                const back = await polishWaitFor(h, lineExpr(A, tk, "true"), WAIT_MS);
                await polishNap(600);
                const lists = await h.ev(`window.${FAKE_KEY}.lists`);
                const l = await lineFor(tk);
                const doneOld = await lineFor(ctx.doneKey);
                const chips = await row();
                await shot(h, "15-restart");
                rec(
                    `${name}: after the records are lost and the pane mounts again (the layer is a new element), the list command is asked once more for this agent and the line under the question message is back ("Gợi ý ${PICK}", Judge kỹ), so is the older "Judge chọn ${ADDED.label}" line, and the judged chip is first`,
                    had >= 2 &&
                        emptied &&
                        remounted &&
                        back &&
                        lists.length === listsBefore + 1 &&
                        lists.at(-1).agentid === A &&
                        l?.state === "light" &&
                        l.text.startsWith(`Gợi ý ${PICK}`) &&
                        l.action === "judge" &&
                        doneOld?.state === "done" &&
                        doneOld.text.startsWith(`Judge chọn ${ADDED.label}`) &&
                        chips[0]?.judged === true,
                    { had, emptied, remounted, back, lists: lists.length, listsBefore, l, doneOld, chips: chips.map((c) => c.judged) }
                );
            });

            // 16. under reduced motion the line mounts at its end state (no opening, no margin travel) and a state change
            // is at its end state within two frames (no old text fading out beside the new)
            await run("16. reduced motion", async (name) => {
                let up = false;
                let sampled = false;
                let frames = [];
                let change = null;
                let emulated = false;
                try {
                    await h.cdp("Emulation.setEmulatedMedia", { features: REDUCE });
                    // motion reads reduced motion from the media query's change event, which fires on the next frame
                    emulated = await h.ev(`new Promise((resolve) => {
                        const mq = matchMedia("(prefers-reduced-motion: reduce)");
                        const t0 = performance.now();
                        const poll = () => {
                            if (mq.matches) requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
                            else if (performance.now() - t0 > 2000) resolve(false);
                            else requestAnimationFrame(poll);
                        };
                        poll();
                    })`);
                    // useReducedMotion reads the setting when a component mounts, so the pane mounts again under it: Terminal and
                    // back to Chat (the layer exists only while Chat is shown). The records stay in the store
                    await h.ev(`window.__arcChatMode.set(${JSON.stringify(A)}, "terminal")`);
                    await polishWaitFor(h, `!${layerOf(A)}`, SHORT_MS);
                    await h.ev(`window.__arcChatMode.set(${JSON.stringify(A)}, "chat")`);
                    await polishWaitFor(h, `!!${layerOf(A)} && (${ROW(A)}).length >= 3`, WAIT_MS);
                    await h.ev(SAMPLE);
                    up = await nextTurn("tiếp");
                    sampled = await polishWaitFor(h, "window.__cjSamples?.done === true", WAIT_MS * 2);
                    frames = (await h.ev(`window.__cjSamples?.frames ?? []`)) ?? [];
                    const tk = await liveKey();
                    await h.ev(`window.${FAKE_KEY}.hold()`);
                    change = await h.ev(`new Promise((resolve) => {
                        const line = [...document.querySelectorAll("[data-chat-judge-line]")].find((e) => e.getAttribute("data-chat-judge-line") === ${JSON.stringify(tk)});
                        line.querySelector('[data-chat-judge-action="judge"]').click();
                        requestAnimationFrame(() => requestAnimationFrame(() => {
                            const body = line.querySelector("[data-chat-judge-body]");
                            resolve({
                                state: line.getAttribute("data-state"),
                                kids: body.children.length,
                                opacity: Number(getComputedStyle(body.firstElementChild).opacity),
                                icon: line.querySelector("[data-chat-judge-icon]")?.getAttribute("data-chat-judge-icon") ?? null,
                            });
                        }));
                    })`);
                    await pressAction("stop");
                    await waitState(tk, "light", SHORT_MS);
                } finally {
                    await h.cdp("Emulation.setEmulatedMedia", { features: [] });
                }
                const last = frames.at(-1);
                rec(
                    `${name}: with reduced motion emulated the line's first frame is already its end state (opacity 1, ${UNDER} px under the message, its final height, and no frame in between), and Judge kỹ turns it to reading within two frames with one child in its body at opacity 1`,
                    emulated &&
                        up &&
                        sampled &&
                        frames.length >= 3 &&
                        frames.every((f) => f.opacity === 1 && f.mt === -UNDER && Math.abs(f.height - last.height) <= 1) &&
                        change?.state === "reading" &&
                        change.kids === 1 &&
                        change.opacity === 1 &&
                        change.icon === "spin",
                    { emulated, up, sampled, frames: frames.length, first: frames[0], last, change }
                );
            });

            // 17. the What's new picture: the question message, its line and the tooltip over the pick's name
            await run("17. the What's new picture", async (name) => {
                const up = await nextTurn("tiếp");
                await polishNap(900);
                const tk = await liveKey();
                const hovered = await hoverName(tk);
                const shown = await polishWaitFor(h, `(${TIP})?.opacity === "1"`, SHORT_MS);
                // the message's row is the item just before the line's wrapper
                const selector = `[data-chat-item]:has(+ * > [data-chat-judge-line=${JSON.stringify(tk)}])`;
                let picture = null;
                let error = null;
                try {
                    picture = await h.whatsnewShot("chat-judge", { selector, pad: 40 });
                } catch (e) {
                    error = String(e?.message ?? e);
                }
                await leaveName();
                rec(
                    `${name}: the picture of the question message with its line and the reason on hover is written (public/whatsnew/<version>-chat-judge.webp)`,
                    up && hovered && shown && picture?.file != null,
                    { up, hovered, shown, picture, error }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-judge teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("let a held judge call go", () => h.ev(`(() => { window.${FAKE_KEY}?.release?.(); return true; })()`));
            // an emulation left on would turn off motion for every later scenario
            await step("clear the reduced-motion emulation", () => h.cdp("Emulation.setEmulatedMedia", { features: [] }));
            await step("remove the fakes", () =>
                h.ev(`(() => { delete window.__chatSuggestFake; delete window.__chatJudgeFake; delete window.${FAKE_KEY}; window.__chatJudgeReset?.(); return true; })()`)
            );
            await step("remove the RPC mock", () => removeMock(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
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
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
