// The builder check's review of what it changed (the Check-Review board). kit holds scenarios.mjs's brainstorm helpers.

// the board's copy: detector-engine-models after its builder check, with question 16 still open
const CR_TOPIC = "detector-engine-models";
const CR_CHANGED = [
    {
        id: "constraints",
        title: "Constraints",
        why: "answer 12: your boss wants PyTorch",
        was: "Unsupervised, tenant-scoped, one more detector behind _run_detector_safely.",
        now: "Same, and PyTorch becomes the engine’s ML framework, adopted step by step; this build adds torch.",
    },
    {
        id: "direction",
        title: "Which blind spot first",
        why: "answer 15: decide both models at a high level now",
        was: "Both a graph model and a forecast model, as separate detectors.",
        now: "One PyTorch roadmap: the event_count forecaster, then the autoencoder port, then the graph model.",
    },
    {
        id: "grain",
        title: "Forecast grain",
        why: "builder question 1 and 3",
        was: "Daily, for every numeric field, with a weekday cycle and trend.",
        now: "Daily event_count per HIGH-tier entity; a day with no row counts as zero.",
    },
    {
        id: "role",
        title: "Where the forecast sits",
        why: "builder question 1",
        was: "One more detector with its own “forecast” weight in the tier weight table.",
        now: "Grades a new event_count field through the existing evidence adapter; the z-scored fields are untouched.",
    },
    {
        id: "damping",
        title: "Damping",
        why: "builder question 1",
        was: "Worth doing at the evidence level, never at the modifier stage.",
        now: "Dropped: the z-scored fields are per-event averages, so a count forecast says nothing about them.",
    },
    {
        id: "purpose",
        title: "What the forecast adds",
        why: "builder questions 1 and 2",
        was: "No weight of its own: it damps or raises the existing z-score evidence only.",
        now: "Severity from where the day’s count falls in the forecast range; the bands are settings.",
    },
    {
        id: "evaluation",
        title: "How we know it is better",
        why: "builder question 1",
        was: "Live from day one; the stored undamped strength is the safety net.",
        now: "Live behind a setting; each event_count row stores the expected value, range and model version.",
    },
    {
        id: "model",
        title: "The forecast model",
        why: "you asked for an ML model, not a statistical profile",
        was: "Robust weekday profile: median and MAD of the last N weeks, no trend.",
        now: "A small DeepAR-style GRU per tenant and entity type, with a negative-binomial output, trained on CPU.",
    },
];
const CR_CALLS = [
    { part: "purpose", text: "seasonal_raise takes its Evidence.direction from the seasonal residual, so the classifier doesn’t drop it." },
    { part: "purpose", text: "HIGH-tier-only is enforced by the plumbing, and the reshaping is idempotent, because scoring runs twice." },
    { part: "evaluation", text: "The audit is field-level (undamped vs stored strength plus the stored score). It does not replay the full pipeline." },
    { part: "evaluation", text: "Confidence-band shifts from damping are accepted." },
    { part: "model", text: "Zero spread (MAD = 0) leaves the field-day unchanged, matching modified_zscore’s existing guard." },
    { part: "model", text: "Reuse volume_anomaly.robust_median_mad for the profile instead of writing a second one." },
    { part: "model", text: "Build the profile from per-field (date, value) pairs, because the existing numeric lists are not date-aligned." },
    {
        part: "model",
        text: "Always store the profile. Baselines from fallback windows, the ES fallback or the tenant path get none and score unchanged.",
    },
];
const CR_GUESS = {
    id: "torch",
    title: "The move to PyTorch",
    state: "guess",
    from: "answer 12",
    gist: "A shared torch base, built with the forecaster; the autoencoder port next; the graph model later.",
    body: "A shared torch base, built with the forecaster; the autoencoder port next; the graph model later.",
};
const CR_GRAPH = { id: "graph", title: "Graph model", state: "asked", gist: "Not written yet: question 16 asks what it is for.", body: "" };
const CR_UNCHANGED = [
    { id: "intent", title: "Intent and why", body: "The engine misses entities whose volume follows a weekly rhythm." },
    { id: "order", title: "Order and packaging", from: "answer 9", body: "One PR per model, the forecaster first." },
    { id: "builder", title: "Left to the builder", body: "File layout, test fixtures, the setting names." },
];
const CR_NOTES = [
    "What the engine runs today",
    "What the research says",
    "Pros and cons of each direction",
    "Evidence-level damping, step by step",
    "Forecast model options",
    "Hardware: what PyTorch needs",
].map((title, i) => ({ id: `note${i + 1}`, title, kind: "note", state: "yours", body: `${title}: the agent’s notes.` }));
const CR_ANSWERED = [
    {
        q: "What should the forecast act on: the averaged fields, a new event_count, or entity-level volume?",
        label: "What the forecast acts on",
        part: "role",
        a: "Add a per-entity event_count field",
        into: ["grain", "role", "damping", "purpose", "evaluation"],
    },
    {
        q: "Re-grade severity so a high-for-this-weekday day is stored, or keep the forecast damping-only?",
        label: "Re-grade severity or damp only",
        part: "purpose",
        a: "Neither: event_count is a new field, so a busy day is an ordinary non-normal row",
        into: ["purpose"],
    },
    { q: "A day with no aggregate row: zero, or missing?", label: "A day with no row", part: "grain", a: "Zero, which is true for a count", into: ["grain"] },
];
const CR_Q16 = {
    n: 16,
    text: "What is the graph model for: lateral movement between hosts, or new access paths for a user?",
    part: "graph",
    options: [
        { label: "Lateral movement", detail: "Host to host.", pick: true },
        { label: "New access paths", detail: "User to service." },
    ],
};
// the answers the guess and the unchanged decision name in from, which each shows as said
const CR_HISTORY = [
    { kind: "question", n: 9, q: "One PR for everything, or one per model?", a: "One per model, forecaster first", into: ["order"] },
    { kind: "question", n: 12, q: "Which ML framework?", a: "My boss wants PyTorch", into: ["constraints", "torch"] },
    { kind: "question", n: 15, q: "Decide both models now, or only the first?", a: "Both, at a high level.", into: ["direction"] },
];
const CR_BLOCKER = "Review 8 changes, confirm 1 guess, answer question 16";
const CR_CHANGED_LINKS = [
    "Changed Forecast grain, Where the forecast sits, Damping, What the forecast adds, How we know it is better",
    "Changed What the forecast adds",
    "Changed Forecast grain",
];
const CR_HINTS = "j k Next or previous decision Enter Show what it was y Keep the change u Put mine back b Back to the terminal";

// kept: the part yours again, still touched, with nothing it was
function crFile(kept = []) {
    const changed = CR_CHANGED.map((c) =>
        kept.includes(c.id)
            ? { id: c.id, title: c.title, state: "yours", gist: c.now, body: c.now }
            : { id: c.id, title: c.title, state: "guess", gist: c.now, body: c.now, was: c.was, why: c.why }
    );
    return {
        v: 1,
        title: "Detector engine models",
        spec: "docs/superpowers/specs/2026-10-20-detector-engine-models-design.md",
        question: CR_Q16,
        working: null,
        parts: [...changed, CR_GUESS, CR_GRAPH, ...CR_UNCHANGED.map((p) => ({ ...p, state: "yours" })), ...CR_NOTES],
        history: CR_HISTORY,
        done: false,
        check: { yours: CR_ANSWERED, calls: CR_CALLS, answered: [], touched: CR_CHANGED.map((c) => c.id) },
        run: null,
    };
}

// a helper the kit does not carry, copied from scenarios.mjs: records every line the page sends an agent
const CR_TYPED_INSTALL = `(() => {
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
const CR_TYPED_REMOVE = `(() => {
    const c = window.TabRpcClient;
    if (c?.__bsOrig) {
        c.wshRpcCall = c.__bsOrig;
        delete c.__bsOrig;
    }
    return true;
})()`;
const CR_PROMPT = /[>$#%]$/;
const CR_PROMPT_WAIT_MS = 20000;
const CR_KEYS = {
    j: { key: "j", code: "KeyJ", windowsVirtualKeyCode: 74, text: "j" },
    y: { key: "y", code: "KeyY", windowsVirtualKeyCode: 89, text: "y" },
    u: { key: "u", code: "KeyU", windowsVirtualKeyCode: 85, text: "u" },
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
};

export default function (kit) {
    const { bsArrangeAgent, bsShowFile, bsTeardownAgent, skipStep, bsWrite, bsUntil, bsBrief, bsClick, bsMouseClick, bsKeysArrive, bsMark, bsTyped, bsAgentTook, bsRail } = kit;
    const { bsOpenDesign, bsTermText, polishWaitFor, polishNap, BS_PANE, BS_POLL_WAIT_MS } = kit;
    const ROW = (id) => `${BS_PANE}?.querySelector('[data-brainstorm-review-row="${id}"]')`;
    const REVIEW = `${BS_PANE}?.querySelector("[data-brainstorm-review]")`;

    const read = (h) =>
        h.ev(`(() => {
            const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
            const pane = ${BS_PANE};
            const review = pane?.querySelector("[data-brainstorm-review]");
            const section = (key) => review?.querySelector('[data-brainstorm-review-section="' + key + '"]');
            const rows = (key) =>
                [...(section(key)?.querySelectorAll("[data-brainstorm-review-row]") ?? [])].map((r) => ({
                    id: r.getAttribute("data-brainstorm-review-row"),
                    state: r.getAttribute("data-state"),
                    cursor: r.hasAttribute("data-cursor"),
                    gist: flat(r.querySelector("[data-brainstorm-gist]")),
                    cause: flat(r.querySelector("[data-brainstorm-review-cause]")),
                    said: flat(r.querySelector("[data-brainstorm-said]")),
                    buttons: [...r.querySelectorAll("button")].map(flat).filter((t) => t !== ""),
                    calls: r.querySelectorAll("[data-brainstorm-review-call]").length,
                    toggle: r.querySelector("[data-brainstorm-review-toggle]")?.getAttribute("aria-label") ?? null,
                    expanded: r.querySelector("[data-brainstorm-review-toggle]")?.getAttribute("aria-expanded") ?? null,
                    diff: flat(r.querySelector("[data-brainstorm-review-diff]")),
                    dot: r.firstElementChild ? getComputedStyle(r.firstElementChild).backgroundColor : null,
                    right: flat(r.children[3]),
                }));
            const links = (kind) => {
                const s = review?.querySelector('[data-brainstorm-review-links="' + kind + '"]');
                return { head: flat(s?.querySelector("h2")), links: [...(s?.querySelectorAll("[data-brainstorm-review-link]") ?? [])].map(flat) };
            };
            const rail = pane?.querySelector('aside[aria-label="The builder check"]');
            return {
                title: flat(review?.querySelector("h1")),
                summary: flat(review?.querySelector("[data-brainstorm-review-summary]")),
                changedHead: flat(section("changed")?.firstElementChild),
                keepAll: flat(section("changed")?.querySelector("[data-brainstorm-keep-all]")),
                freshHead: flat(section("fresh")?.firstElementChild),
                changed: rows("changed"),
                fresh: rows("fresh"),
                unchanged: links("unchanged"),
                notes: links("notes"),
                railHead: flat(rail?.querySelector("h2")),
                railLine: flat(rail?.querySelector("[data-brainstorm-answered-line]")),
                answered: [...(rail?.querySelectorAll("[data-brainstorm-answered]") ?? [])].map((a) => ({
                    text: flat(a),
                    changed: flat(a.lastElementChild),
                })),
                hints: flat(pane?.querySelector("[data-brainstorm-review-hints]")),
                blocker: flat(pane?.querySelector("[data-brainstorm-approve-reason]")),
                question: !!pane?.querySelector("[data-brainstorm-question]"),
                back: !!pane?.querySelector("[data-brainstorm-back]"),
                success: getComputedStyle(document.documentElement).getPropertyValue("--color-success").trim(),
            };
        })()`);

    // the open row's − and + lines: their marks' colors against the diff tokens'
    const readDiff = (h, id) =>
        h.ev(`(() => {
            const rgb = (c) => { const d = document.createElement("span"); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
            const root = getComputedStyle(document.documentElement);
            const lines = [...(${ROW(id)}?.querySelectorAll("[data-brainstorm-review-diff] > div") ?? [])];
            return {
                lines: lines.map((l) => ({ mark: (l.firstElementChild?.textContent ?? "").trim(), color: l.firstElementChild ? getComputedStyle(l.firstElementChild).color : null })),
                added: rgb(root.getPropertyValue("--color-diff-added").trim()),
                removed: rgb(root.getPropertyValue("--color-diff-removed").trim()),
            };
        })()`);

    async function key(h, name) {
        const { text, ...def } = CR_KEYS[name];
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...def, text });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...def });
        await polishNap(300);
    }

    const cursorOn = (h, id) => polishWaitFor(h, `${ROW(id)}?.hasAttribute("data-cursor") === true`, 2000);

    // a sent line is read in the terminal, and a line typed before the shell's first prompt can be lost
    async function atPrompt(h, ctx) {
        for (const start = Date.now(); Date.now() - start < CR_PROMPT_WAIT_MS; await polishNap(250)) {
            const rows = (await bsTermText(h, ctx, "\n").catch(() => "")).split("\n").filter((r) => r.trim() !== "");
            if (CR_PROMPT.test(rows.at(-1)?.trim() ?? "")) return true;
        }
        return false;
    }

    // one line sent by `act`, checked, then settled as the agent having taken it
    async function sends(h, ctx, line, act) {
        const mark = await bsMark(h, ctx, line);
        await act();
        const typed = await bsTyped(h, ctx, mark, line);
        await bsAgentTook(h, ctx);
        return typed;
    }

    // as bsBoardScenario, with a step that can be skipped when CDP keys cannot reach the page
    const checkReview = crScenario("brainstorm-check-review", CR_TOPIC, crFile(), async (h, ctx, rec, skip) => {
        const prompt = await atPrompt(h, ctx);
        await h.ev(CR_TYPED_INSTALL);
        try {
            const drawn = await bsUntil(h, ctx, (s) => s.question.includes(CR_Q16.text));
            const opened = await bsOpenDesign(h);
            const shown = await polishWaitFor(h, `!!${REVIEW}`, 3000);
            const r = await read(h);
            await h.shot("cdp-shots/brainstorm-check-review.png");
            const model = r.changed.find((x) => x.id === "model");
            rec(
                "1. the review draws as the board: 8 changed rows with causes and Keep all 8 changes, the calls under The forecast model, 2 new with Answer question 16, the two link lines, the rail's three answers with Changed, the hints bar and the blocker",
                drawn.ok &&
                    opened &&
                    shown &&
                    r.title === "Review what the check changed" &&
                    r.summary !== "" &&
                    r.changedHead === "Changed since you confirmed · 8 open one to see what it was Keep all 8 changes" &&
                    JSON.stringify(r.changed.map((x) => [x.id, x.gist, x.cause])) ===
                        JSON.stringify(CR_CHANGED.map((c) => [c.id, c.now, c.why])) &&
                    r.changed.every((x) => x.buttons.includes("Keep the change") && x.buttons.includes("Put mine back")) &&
                    model?.calls === 4 &&
                    r.changed.find((x) => x.id === "purpose")?.calls === 2 &&
                    r.freshHead === "New since the check · 2" &&
                    JSON.stringify(r.fresh.map((x) => [x.id, x.buttons])) ===
                        JSON.stringify([
                            ["torch", ["That’s right", "Edit"]],
                            ["graph", ["Answer question 16"]],
                        ]) &&
                    r.unchanged.head === "Yours, unchanged · 3" &&
                    JSON.stringify(r.unchanged.links) === JSON.stringify(CR_UNCHANGED.map((p) => p.title)) &&
                    r.notes.head === "What the agent found · 6" &&
                    JSON.stringify(r.notes.links) === JSON.stringify(CR_NOTES.map((p) => p.title)) &&
                    r.railHead === "A builder read the design" &&
                    r.railLine === "It had 11 questions: 3 for you, all answered; the agent decided 8, shown under their decisions." &&
                    JSON.stringify(r.answered.map((a) => a.changed)) === JSON.stringify(CR_CHANGED_LINKS) &&
                    r.hints === CR_HINTS &&
                    r.blocker === CR_BLOCKER,
                { ...bsBrief(drawn), opened, shown, read: r }
            );

            const torch = r.fresh.find((x) => x.id === "torch");
            rec(
                "1b. a decision an answer made shows that answer as said in place of its from; one with a why or no answer shows none",
                torch?.said === "answer 12: “My boss wants PyTorch”" &&
                    torch?.cause === "" &&
                    r.changed.every((x) => x.said === "") &&
                    r.fresh.find((x) => x.id === "graph")?.said === "",
                { torch, changedSaid: r.changed.map((x) => x.said) }
            );

            await h.ev(`${ROW("constraints")}?.querySelector("[data-brainstorm-review-toggle]")?.click()`);
            await polishNap(300);
            const d = await readDiff(h, "constraints");
            const after = (await read(h)).changed.find((x) => x.id === "constraints");
            await h.shot("cdp-shots/brainstorm-check-review-open.png");
            rec(
                "2. the expand arrow opens − was / + now in the diff tokens, and its label flips",
                d.lines.length >= 2 &&
                    d.lines.some((l) => l.mark === "−" && l.color === d.removed) &&
                    d.lines.some((l) => l.mark === "+" && l.color === d.added) &&
                    d.lines.every((l) => (l.mark === "−" ? l.color === d.removed : l.color === d.added)) &&
                    after?.toggle === "Hide what it was" &&
                    after?.expanded === "true" &&
                    after?.diff.includes(CR_CHANGED[0].was),
                { diff: d, row: after }
            );
            await h.ev(`${ROW("constraints")}?.querySelector("[data-brainstorm-review-toggle]")?.click()`);

            // a real click on the row's cause line, which also gives the page focus for the keys. With the details rail open
            // (it stays beside a brainstorm on main) the review column is too narrow for a row's text: its buttons take the
            // row and the cause line draws no width, so the rail is hidden for the click and the keys, then put back
            const railWas = await bsRail(h, false);
            const clicked = await bsMouseClick(h, `${ROW("direction")}?.querySelector("[data-brainstorm-review-cause]")`);
            const clickCursor = await cursorOn(h, "direction");
            const keysArrive = clicked && (await bsKeysArrive(h));
            if (!keysArrive) {
                const probe = await h.ev(`(() => {
                    const row = ${ROW("direction")};
                    const cause = row?.querySelector("[data-brainstorm-review-cause]");
                    const box = (el) => { const r = el?.getBoundingClientRect(); return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null; };
                    return { row: box(row), cause: box(cause), causeText: (cause?.textContent ?? "").slice(0, 60), focus: document.hasFocus() };
                })()`);
                skip("3. clicking a row moves the cursor; j, Enter, y and u act on it", `could not verify: CDP keys do not reach the page (clicked ${clicked}, cursor ${clickCursor}, ${JSON.stringify(probe)})`);
            } else {
                await key(h, "j");
                const jCursor = await cursorOn(h, "grain");
                await key(h, "Enter");
                const entered = await polishWaitFor(h, `${ROW("grain")}?.querySelector("[data-brainstorm-review-toggle]")?.getAttribute("aria-expanded") === "true"`, 2000);
                const yTyped = await sends(h, ctx, "brainstorm: keep grain", () => key(h, "y"));
                await key(h, "j");
                const jCursor2 = await cursorOn(h, "role");
                const uTyped = await sends(h, ctx, "brainstorm: restore role", () => key(h, "u"));
                rec(
                    "3. clicking a row moves the cursor to it; j moves it on, Enter opens it, y keeps it and u on the next row puts mine back",
                    prompt && clickCursor && jCursor && entered && yTyped.ok && jCursor2 && uTyped.ok,
                    { prompt, clickCursor, jCursor, entered, y: yTyped.detail, jCursor2, u: uTyped.detail }
                );
            }
            await bsRail(h, railWas);

            const keep = await sends(h, ctx, "brainstorm: keep damping", () => bsClick(h, ROW("damping"), "Keep the change"));
            const restore = await sends(h, ctx, "brainstorm: restore model", () => bsClick(h, ROW("model"), "Put mine back"));
            const confirm = await sends(h, ctx, "brainstorm: confirm torch", () => bsClick(h, ROW("torch"), "That’s right"));
            const editClicked = await bsClick(h, ROW("torch"), "Edit");
            const editOpen = await polishWaitFor(h, `${ROW("torch")}?.querySelector("[data-brainstorm-edit]")?.value === ${JSON.stringify(CR_GUESS.body)}`, 2000);
            rec(
                "4. Keep the change, Put mine back and That’s right send their lines by click; Edit opens the edit box",
                prompt && keep.ok && restore.ok && confirm.ok && editClicked === "clicked" && editOpen,
                { keep: keep.detail, restore: restore.detail, confirm: confirm.detail, editClicked, editOpen }
            );
            await h.ev(`${ROW("torch")}?.querySelector("[data-brainstorm-edit]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`);

            const keepAll = await sends(h, ctx, "brainstorm: keep every change", () =>
                bsClick(h, `${REVIEW}?.querySelector('[data-brainstorm-review-section="changed"]')`, "Keep all 8 changes")
            );
            rec("4b. Keep all 8 changes sends brainstorm: keep every change", prompt && keepAll.ok, keepAll.detail);

            const openLink = async (kind, title, id) => {
                await bsClick(h, `${REVIEW}?.querySelector('[data-brainstorm-review-links="${kind}"]')`, title);
                return polishWaitFor(h, `!!${REVIEW}?.querySelector('[data-brainstorm-review-links="${kind}"] [data-brainstorm-review-body="${id}"]')`, 2000);
            };
            const unchangedBody = await openLink("unchanged", "Order and packaging", "order");
            const noteBody = await openLink("notes", CR_NOTES[3].title, CR_NOTES[3].id);
            const bodies = await h.ev(`[...(${REVIEW}?.querySelectorAll("[data-brainstorm-review-body]") ?? [])].map((b) => b.innerText.trim())`);
            const said = await h.ev(`${REVIEW}?.querySelector('[data-brainstorm-review-links="unchanged"] [data-brainstorm-said]')?.innerText.trim() ?? ""`);
            rec(
                "5. a Yours, unchanged link and a What the agent found link each open that part's body under the line, the unchanged one with the answer it came from",
                unchangedBody &&
                    noteBody &&
                    JSON.stringify(bodies) === JSON.stringify([CR_UNCHANGED[1].body, CR_NOTES[3].body]) &&
                    said === "answer 9: “One per model, forecaster first”",
                { unchangedBody, noteBody, bodies, said }
            );

            bsWrite(ctx, crFile(["constraints"]));
            const keptDrawn = await polishWaitFor(h, `${ROW("constraints")}?.getAttribute("data-state") === "yours"`, BS_POLL_WAIT_MS);
            const k = await read(h);
            const kept = k.changed.find((x) => x.id === "constraints");
            const successRgb = await h.ev(`(() => { const d = document.createElement("span"); d.style.color = ${JSON.stringify(k.success)}; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; })()`);
            await h.shot("cdp-shots/brainstorm-check-review-kept.png");
            rec(
                "6. once the file records the keep, the row reads Yours with a success dot and no buttons, and Keep all counts 7",
                keptDrawn &&
                    kept?.right === "Yours" &&
                    kept?.dot === successRgb &&
                    !kept?.buttons.includes("Keep the change") &&
                    k.changed.length === 8 &&
                    k.keepAll === "Keep all 7 changes" &&
                    k.blocker === "Review 7 changes, confirm 1 guess, answer question 16",
                { keptDrawn, kept, successRgb, blocker: k.blocker, keepAll: k.keepAll }
            );

            const answerClicked = await bsClick(h, ROW("graph"), "Answer question 16");
            const back = await polishWaitFor(h, `!${REVIEW} && !!${BS_PANE}?.querySelector("[data-brainstorm-question]")`, 3000);
            const q = await bsUntil(h, ctx, (s) => s.question.includes(CR_Q16.text), 2000);
            await h.shot("cdp-shots/brainstorm-check-review-answer.png");
            rec("7. Answer question 16 returns the main area to question 16", answerClicked === "clicked" && back && q.ok, {
                answerClicked,
                back,
                ...bsBrief(q),
            });
        } finally {
            await h.ev(CR_TYPED_REMOVE);
        }
    });

    return [checkReview];

    function crScenario(name, topic, file, check) {
        return {
            name,
            surface: "agent",
            arrange: (h) => bsArrangeAgent(h, topic, file),
            async assert(h, ctx) {
                const missing = await bsShowFile(h, ctx);
                if (missing != null) return [skipStep(name, `could not verify: ${missing}`)];
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                const skip = (step, why) => steps.push(skipStep(step, why));
                await check(h, ctx, rec, skip);
                return steps;
            },
            teardown: (h, ctx) => bsTeardownAgent(h, ctx, name),
        };
    }
}
