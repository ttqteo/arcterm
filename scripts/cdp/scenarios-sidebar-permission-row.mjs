// sidebar-permission-row: an agent's sidebar row answering its permission prompt
// (docs/superpowers/specs/2026-11-27-sidebar-permission-row-design.md; frontend/app/view/agents/permissionrow.tsx,
// permissionmodel.ts rowPermission / permissionRowLabel). Two real tabs with no controller under a page roster fixture:
// the asking agent whose row is read, and an idle one that holds the focus, so a click on the row's buttons is seen not
// to select it. Each queue is a fixture set with window.__arcAgentPermission.set; wavesrv's own queue for the block stays
// empty, so the row's Allow is refused for real ("that request is no longer waiting") and its refusal line shows.
// Nothing runs and nothing is written to disk. kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor, polishNap).

import { agentPage, focusAgent, restoreRoster, setRoster, tabFixtures } from "./agent-page-fixtures.mjs";

const NAME = "sidebar-permission-row";
const WAIT_MS = 6_000;
// the refusal line goes after REFUSAL_MS (8 s, permissionmodel.ts), then leaves on the reveal motion
const REFUSAL_GONE_MS = 12_000;
// the reveal (composerReveal, MOTION.durMicro) is over well before this
const SETTLE_MS = 400;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const perm = (id, toolname, summary, { answerable = true, screenpick, ageMs = 0 } = {}) => ({
    id,
    toolname,
    summary,
    answerable,
    ...(screenpick ? { screenpick } : {}),
    ts: Date.now() - ageMs,
});

const setQueue = (h, blockId, requests) =>
    h.ev(`(() => { window.__arcAgentPermission.set(${JSON.stringify(`block:${blockId}`)}, ${JSON.stringify(requests)}); return true; })()`);

const LINE = (id) => `document.querySelector('[data-agent-tree] [data-agent-perm-line="${id}"]')`;

// what the asking row shows: its second line's note, its third line's parts, the buttons' height and the colors the
// browser computes for the note, the error line and the theme's warning and error tokens
const rowState = (id) => `(() => {
    const row = document.querySelector('[data-agent-tree] [data-agent-row="${id}"]');
    if (!row) return { row: false };
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const color = (v) => {
        const p = document.createElement("span");
        p.style.color = v;
        document.body.appendChild(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
    };
    const note = row.querySelector("[data-agent-perm-note]");
    const ask = row.querySelector("[data-agent-ask-note]");
    const line = row.querySelector("[data-agent-perm-line]");
    const allow = line?.querySelector("[data-agent-perm-allow]");
    const err = line?.querySelector("[data-agent-perm-error]");
    return {
        row: true,
        note: note ? flat(note) : null,
        noteTitle: note?.getAttribute("title") ?? null,
        noteMono: note ? /mono/i.test(getComputedStyle(note).fontFamily) || note.classList.contains("font-mono") : null,
        noteWarning: note ? getComputedStyle(note).color === color("var(--color-warning)") : null,
        askNote: ask ? flat(ask) : null,
        line: line != null,
        allow: allow != null,
        allowDisabled: allow?.disabled ?? null,
        deny: line?.querySelector("[data-agent-perm-deny]") != null,
        allowHeight: allow ? Math.round(allow.getBoundingClientRect().height) : null,
        chat: line?.querySelector("[data-agent-perm-chat]") ? flat(line.querySelector("[data-agent-perm-chat]")) : null,
        wait: line?.querySelector("[data-agent-perm-wait]") ? flat(line.querySelector("[data-agent-perm-wait]")) : null,
        error: err ? flat(err) : null,
        errorColor: err ? getComputedStyle(err).color === color("var(--color-error)") : null,
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
        await h.cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    }
    return true;
}

const focusState = (h) =>
    agentPage(
        h,
        `const model = agentsModel();
        return { focus: globalStore.get(model.focusIdAtom) ?? null };`
    );

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = tabFixtures(kit);

    const roster = (ctx, askHold) => [
        {
            id: ctx.askingId,
            name: "perm-row asking",
            project: "waveterm",
            task: "update the board scenarios",
            state: "asking",
            agent: "claude",
            model: "opus",
            blockId: ctx.askingBlock,
            stateSince: Date.now() - 60_000,
            ...(askHold
                ? {
                      ask: {
                          questions: [{ question: "Start a subagent?", header: "Token burn", multiSelect: false, options: [] }],
                          hold: true,
                      },
                  }
                : {}),
        },
        {
            id: ctx.otherId,
            name: "perm-row other",
            project: "waveterm",
            task: "relay retry",
            state: "idle",
            agent: "claude",
            model: "opus",
            blockId: ctx.otherBlock,
            idleSince: Date.now() - 120_000,
        },
    ];

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = {};
                // a throw past this point still returns ctx, so teardown undoes whatever was already set
                try {
                    await h.goto("agent");
                    const a = await makeTab(h, ctx, { label: "perm-row asking" });
                    const b = await makeTab(h, ctx, { label: "perm-row other" });
                    Object.assign(ctx, { askingId: a.tabId, askingBlock: a.blockId, otherId: b.tabId, otherBlock: b.blockId });
                    await setRoster(h, roster(ctx, false));
                    await focusAgent(h, ctx.otherId);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                if (ctx.arrangeError != null) {
                    rec("arrange the fixture agents", false, ctx.arrangeError);
                    return steps;
                }
                const id = ctx.askingId;
                const read = () => h.ev(rowState(id));
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    // 1. at rest: a subagent prompt with one more behind it
                    await setQueue(h, ctx.askingBlock, [
                        perm("pr-1", "Agent", "Update board CDP scenarios (Explore on haiku)", { ageMs: 65_000 }),
                        perm("pr-2", "Bash", "git status --short"),
                    ]);
                    await polishWaitFor(h, `!!${LINE(id)}?.querySelector("[data-agent-perm-allow]")`, WAIT_MS);
                    await polishNap(SETTLE_MS);
                    const s1 = await read();
                    await shot(h, "1-at-rest");
                    // What's new's picture of the feature: the tree with the asking row on top (CHANGELOG reads shot: none
                    // until this file is put in public/whatsnew/)
                    let picture;
                    try {
                        picture = await h.whatsnewShot("sidebar-permission-row", { selector: "[data-agent-tree]", pad: 40 });
                    } catch (e) {
                        picture = { error: String(e?.message ?? e) };
                    }
                    s1.picture = picture;
                    rec(
                        "1. the asking row reads what the subagent prompt asks in amber on its second line, and a third line holds Allow and Deny (22 px) with +1 more · waiting 1m",
                        s1.note === "subagent · Update board CDP scenarios" &&
                            s1.noteWarning === true &&
                            s1.askNote == null &&
                            s1.allow &&
                            s1.deny &&
                            s1.allowDisabled === false &&
                            s1.allowHeight === 22 &&
                            s1.wait === "+1 more · waiting 1m",
                        JSON.stringify(s1)
                    );

                    // 2. a Bash head reads its command in mono, its full line as the title
                    await setQueue(h, ctx.askingBlock, [perm("pr-3", "Bash", "task check:ts && npx vitest run frontend/app/view/sidecar")]);
                    await polishWaitFor(h, `(${LINE(id)}?.closest("[data-agent-row]")?.querySelector("[data-agent-perm-note]")?.textContent ?? "").startsWith("$ ")`, WAIT_MS);
                    const s2 = await read();
                    await shot(h, "2-bash");
                    rec(
                        "2. a Bash head reads $ <command> in mono, with no +N more behind it",
                        s2.note === "$ task check:ts && npx vitest run frontend/app/view/sidecar" &&
                            s2.noteMono === true &&
                            s2.noteTitle === "$ task check:ts && npx vitest run frontend/app/view/sidecar" &&
                            s2.allow &&
                            /^waiting \d+s$/.test(s2.wait ?? ""),
                        JSON.stringify(s2)
                    );

                    // 3. a head the row may not allow: a short name, and Answer in chat
                    await setQueue(h, ctx.askingBlock, [
                        perm("pr-4", "ExitPlanMode", 'ExitPlanMode {"plan":"# Retry the sync client"}', { answerable: false }),
                    ]);
                    await polishWaitFor(h, `!!${LINE(id)}?.querySelector("[data-agent-perm-chat]")`, WAIT_MS);
                    await polishNap(SETTLE_MS);
                    const s3 = await read();
                    await shot(h, "3-answer-in-chat");
                    rec(
                        "3. a plan approval reads plan approval, never its input as JSON, and its third line is Answer in chat with no Allow",
                        s3.note === "plan approval" && s3.chat === "Answer in chat ↗" && !s3.allow && !s3.deny,
                        JSON.stringify(s3)
                    );

                    // 4. an AskUserQuestion head is a question: the row stays as it is today
                    await setQueue(h, ctx.askingBlock, [perm("pr-5", "AskUserQuestion", "{}", { answerable: false }), perm("pr-6", "Bash", "ls")]);
                    await polishWaitFor(h, `${LINE(id)} == null`, WAIT_MS);
                    const s4 = await read();
                    rec(
                        "4. an AskUserQuestion at the head leaves the row reading asking, with no third line",
                        s4.askNote === "asking" && s4.note == null && !s4.line,
                        JSON.stringify(s4)
                    );

                    // 5. a held card (Token burn) on the row keeps its note and offers no Allow
                    await setRoster(h, roster(ctx, true));
                    await setQueue(h, ctx.askingBlock, [perm("pr-7", "Agent", "Spawn a reviewer (general-purpose)")]);
                    await polishWaitFor(h, `(document.querySelector('[data-agent-row="${id}"] [data-agent-ask-note]')?.textContent ?? "") === "Token burn"`, WAIT_MS);
                    await polishNap(SETTLE_MS);
                    const s5 = await read();
                    await shot(h, "5-held-card");
                    rec(
                        "5. while a held card asks on the row, it keeps its note and the row shows no Allow",
                        s5.askNote === "Token burn" && s5.note == null && !s5.line,
                        JSON.stringify(s5)
                    );
                    await setRoster(h, roster(ctx, false));

                    // 6. Allow pressed on a request wavesrv no longer holds: refused, the line says so, the row stays unselected
                    await setQueue(h, ctx.askingBlock, [perm("pr-8", "Bash", "rm -rf dist/bin")]);
                    await polishWaitFor(h, `!!${LINE(id)}?.querySelector("[data-agent-perm-allow]")`, WAIT_MS);
                    await polishNap(SETTLE_MS);
                    const clicked = await mouse(h, `${LINE(id)}?.querySelector("[data-agent-perm-allow]")`);
                    await polishWaitFor(h, `!!${LINE(id)}?.querySelector("[data-agent-perm-error]")`, WAIT_MS);
                    const s6 = await read();
                    const f6 = await focusState(h);
                    await shot(h, "6-refused");
                    rec(
                        "6. a refused Allow shows the agent's refusal line in the error color on the third line, and the click selected nothing",
                        clicked &&
                            /no longer waiting/i.test(s6.error ?? "") &&
                            s6.errorColor === true &&
                            f6.focus === ctx.otherId,
                        JSON.stringify({ ...s6, focus: f6.focus, clicked })
                    );
                    const gone = await polishWaitFor(h, `${LINE(id)} == null`, REFUSAL_GONE_MS);
                    rec("6b. the refusal line goes by the card's rule (REFUSAL_MS), and the third line with it", gone, JSON.stringify(await read()));

                    // 7. Answer in chat opens the agent's chat
                    await setQueue(h, ctx.askingBlock, [perm("pr-9", "mcp__stitch__get_project", 'mcp__stitch__get_project {"id":1}', { answerable: false })]);
                    await polishWaitFor(h, `!!${LINE(id)}?.querySelector("[data-agent-perm-chat]")`, WAIT_MS);
                    await polishNap(SETTLE_MS);
                    const s7 = await read();
                    await mouse(h, `${LINE(id)}?.querySelector("[data-agent-perm-chat]")`);
                    await polishWaitFor(h, `window.__arcChatMode?.get(${JSON.stringify(id)}) === "chat"`, WAIT_MS);
                    const f7 = await focusState(h);
                    const mode = await h.ev(`window.__arcChatMode?.get(${JSON.stringify(id)}) ?? null`);
                    await shot(h, "7-opened-chat");
                    rec(
                        "7. an MCP tool's head reads its tool name, and Answer in chat focuses the agent in Chat",
                        s7.note === "mcp__stitch__get_project" && f7.focus === id && mode === "chat",
                        JSON.stringify({ note: s7.note, focus: f7.focus, mode })
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
                if (ctx.askingBlock) await step("clear the queue", () => setQueue(h, ctx.askingBlock, []));
                await step("restore the roster", () => restoreRoster(h));
                await step("close the fixture tabs", () => closeTabs(h, ctx));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
