// diff-comments: comments on the Diff pane's lines, pending in a store and sent to an agent (docs/superpowers/plans/
// 2026-11-12-kael-sync-code-diff-usage-setup.md, Task 10; the fork's 1f397273f, 07b1ff962, d6dbf519f, 3baf6632f, 22ff2cb3f,
// 73e5e44b5, 0d1404f44 and a08c22835, and the steps of its diff-comments scenario in scenarios-files.mjs).
//
// Seeded like `line-review` (scenarios.mjs): a temp git repo whose working tree holds three changes (README.md edited,
// src/retry/policy.go edited with a function added, src/retry/legacy.go deleted), registered as a project, with a fixture
// roster agent whose transcript names the repo as its cwd and whose block is a fake one, so the Diff scopes to it and it is
// a live recipient. Nothing is typed into a terminal: the page's own agentprompt call is recorded and never forwarded.
//
// The steps press only what this task binds: the editor's own `m` (Monaco action, diffcommentlayer.ts) and the send bar's
// button. The surface's `m` and Shift+Enter bindings are Task 16's (kael-keys).
//
// kits is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }). verify.mjs pins the viewport before a scenario; the steps
// pin it again where a view needs a wider pane.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const PROJECT = "verify-diff-comments";
const AGENT = { id: "fx-dc-agent", name: "retry-writer", blockId: "fx-blk-dc-agent" };
const POLICY = "src/retry/policy.go";
const LEGACY = "src/retry/legacy.go";
const README = "README.md";
const STORAGE_KEY = "diff.comments.pending";
const CTRL = 2; // CDP Input.dispatchKeyEvent modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
const SHIFT = 8;
const PLUS_HOVER_TRIES = 3;
// the working tree's policy.go, as the Prompt board draws it: line 4 is the edited return, 7-9 the added function
const POLICY_BOARD = "package retry\n\nfunc Budget() int {\n    return 8\n}\n\nfunc Floor() int {\n    return 1\n}\n";
const NOTE_RETURN = "Why 8? The incident note says five retries were enough. Put the reason in a comment above the return.";
const NOTE_FLOOR = "A floor of 1 means a zero budget can never be configured. Return 0 here and let Budget enforce the minimum.";
const NOTE_LEGACY = "Keep Legacy() for one release; the scheduler still calls it.";
const BAR = "[data-comment-send-bar]";
const DRAFT = "[data-diff-comment-draft]";
const TEXTAREA = `${DRAFT} textarea`;

// in-page: where line n's number sits in one side's editor of the diff pane, and where that editor's text starts
const DIFF_LINE_LIB = `
const lineBox = (side, n) => {
    const ed = document.querySelector('[data-diff-pane] .editor.' + side);
    const el = ed && [...ed.querySelectorAll('.margin-view-overlays .line-numbers')]
        .find((e) => e.textContent.trim() === String(n));
    if (!el || el.getBoundingClientRect().height === 0) return null;
    const r = el.getBoundingClientRect();
    const text = ed.querySelector('.view-lines').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2, textLeft: text.left };
};`;

export default function (kits) {
    const { rt, files, jarvis } = kits;
    const { git, pickFilesSource, showLogTab, reloadApp, restoreLocalStorage } = files;
    const { waitForProjectInConfig, TREE_RAIL_FIXTURE } = rt;
    const { teardownFixtureRun } = jarvis;

    // The fixture roster: one agent with a block (so a live recipient), working or asking. Re-read in place by
    // window.__reloadDevMockRoster, which keeps the page's state (the comments, the open file) under test.
    function writeRoster(ctx, ask) {
        writeFileSync(
            TREE_RAIL_FIXTURE,
            JSON.stringify(
                [
                    {
                        id: AGENT.id,
                        name: AGENT.name,
                        project: PROJECT,
                        task: "tune the retry budget",
                        state: ask ? "asking" : "working",
                        agent: "claude",
                        model: "opus",
                        blockId: AGENT.blockId,
                        ...(ask ? { blockedMs: 60_000, ask } : { activeMs: 30_000 }),
                        transcriptPath: ctx.transcriptPath,
                        previousInfo: [{ kind: "message", text: "Raised the budget." }],
                    },
                ],
                null,
                2
            )
        );
    }

    const scenario = {
        name: "diff-comments",
        surface: "files",
        async arrange(h) {
            const base = mkdtempSync(join(tmpdir(), "verify-diff-comments-"));
            const dir = join(base, "repo");
            const ctx = { cwd: base, dir, project: null };
            try {
                mkdirSync(join(dir, "src", "retry"), { recursive: true });
                writeFileSync(join(dir, README), "# retry\n");
                writeFileSync(join(dir, POLICY), "package retry\n\nfunc Budget() int {\n    return 3\n}\n");
                writeFileSync(join(dir, LEGACY), "package retry\n\nfunc Legacy() {}\n");
                git(dir, "init", "-q", "--initial-branch=main");
                git(dir, "add", ".");
                git(dir, "commit", "-q", "-m", "seed the retry package");
                ctx.head = git(dir, "rev-parse", "HEAD").toString().trim();
                // the working tree: one file edited, one edited with a function added, one deleted
                writeFileSync(join(dir, README), "# retry\n\nBudgets and backoff for job submission.\n");
                writeFileSync(join(dir, POLICY), POLICY_BOARD);
                rmSync(join(dir, LEGACY));

                // the Diff resolves an agent's repo from its block or its transcript; the fixture's block is not real
                ctx.transcriptPath = join(base, "session.jsonl");
                writeFileSync(
                    ctx.transcriptPath,
                    JSON.stringify({ type: "user", cwd: dir, message: { role: "user", content: "tune the retry budget" } }) +
                        "\n"
                );
                await h.rpc("createproject", { name: PROJECT, path: dir });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                // the comment store reads localStorage once, at module load, so the key is cleared before the reload that
                // gives this scenario fresh module state; teardown puts back whatever the user had
                ctx.prevComments = await h.ev(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(STORAGE_KEY)})`);
                mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
                writeRoster(ctx, null);
                ctx.wroteFixture = true;
                await reloadApp(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null) {
                return [{ step: "0. the repo, the project and the fixture roster", ok: false, detail: ctx.arrangeError }];
            }
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
            const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;
            const until = async (expr, ms = 8000) => {
                for (let waited = 0; waited < ms; waited += 250) {
                    if (await h.ev(expr).catch(() => false)) return true;
                    await sleep(250);
                }
                return false;
            };
            const click = (sel) => h.ev(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
            const pin = (width = 1600) =>
                h.cdp("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
            const lineBox = async (side, n) =>
                JSON.parse(
                    await h.ev(`(() => { ${DIFF_LINE_LIB} return JSON.stringify(lineBox(${JSON.stringify(side)}, ${n})); })()`)
                );
            const rectOf = async (sel) =>
                JSON.parse(
                    await h.ev(`(() => { const el = ${q(sel)}; if (!el) return "null";
                      const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, mid: r.top + r.height / 2 }); })()`)
                );
            const cards = async () =>
                JSON.parse(
                    await h.ev(`JSON.stringify([...document.querySelectorAll('[data-diff-comment-card]')].map((c) => ({
                        id: c.dataset.diffCommentCard,
                        state: c.dataset.commentState,
                        label: c.querySelector('[data-diff-comment-label]')?.textContent ?? "",
                        note: c.querySelector('[data-diff-comment-note]')?.textContent ?? "",
                        original: !!c.closest('.editor.original'),
                    })))`)
                );
            const draftTitle = () => h.ev(`${q(`${DRAFT} label`)}?.textContent ?? ""`);
            const titleIs = (t) => `${q(`${DRAFT} label`)}?.textContent === ${JSON.stringify(t)}`;
            // the first card's top sits just below line n's bottom: the zone hangs under the line, after its padding
            const cardUnder = (side, n) => `(() => { ${DIFF_LINE_LIB}
                const l = lineBox(${JSON.stringify(side)}, ${n});
                const c = document.querySelector(".editor.${side} [data-diff-comment-card]");
                if (!l || !c) return false;
                const gap = c.getBoundingClientRect().top - l.bottom;
                return gap >= -1 && gap < 20; })()`;
            const mouse = (type, x, y, extra = {}) => h.cdp("Input.dispatchMouseEvent", { type, x, y, ...extra });
            const clickAt = async (x, y) => {
                await mouse("mousePressed", x, y, { button: "left", buttons: 1, clickCount: 1 });
                await mouse("mouseReleased", x, y, { button: "left", clickCount: 1 });
            };
            const drag = async (from, to) => {
                await mouse("mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1 });
                await mouse("mouseMoved", (from.x + to.x) / 2, (from.y + to.y) / 2, { button: "left", buttons: 1 });
                await mouse("mouseMoved", to.x, to.y, { button: "left", buttons: 1 });
                await mouse("mouseReleased", to.x, to.y, { button: "left", clickCount: 1 });
            };
            const key = async (k, code, vk, modifiers = 0, text) => {
                await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, text });
                await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
            };
            const ctrlEnter = () => key("Enter", "Enter", 13, CTRL);
            // after a view switch the diff editor re-aligns the two sides over a few frames, and a drag measured mid-way
            // starts on the wrong line: wait for two reads of the line to agree
            const settledLineBox = async (side, n) => {
                let last = null;
                for (let waited = 0; waited < 3000; waited += 250) {
                    const now = await lineBox(side, n);
                    if (now != null && JSON.stringify(now) === JSON.stringify(last)) return now;
                    last = now;
                    await sleep(250);
                }
                return last;
            };
            // a selection over lines from..to of one side, with focus left in that side's editor
            const selectLines = async (side, from, to) => {
                const a = await settledLineBox(side, from);
                const b = await lineBox(side, to);
                if (a == null || b == null) return false;
                await drag({ x: a.textLeft + 2, y: a.mid }, { x: b.textLeft + 300, y: b.mid });
                return h.ev(`!!document.activeElement?.closest('[data-diff-pane] .editor.${side}')`);
            };
            // The first move onto a freshly opened pair can reach Monaco without an onMouseMove the layer sees, and the
            // line can shift a row while the diff settles; a user's pointer keeps moving, so this re-measures and moves a
            // few pixels on until the + shows.
            const plusOn = async (n) => {
                for (let attempt = 0; attempt < PLUS_HOVER_TRIES; attempt++) {
                    const l = await lineBox("modified", n);
                    if (l == null) return null;
                    await mouse("mouseMoved", l.textLeft + 40 + attempt * 3, l.mid);
                    if (await until(`!!${q("[data-diff-comment-plus]")}`, 1500)) {
                        return { plus: await rectOf("[data-diff-comment-plus]"), line: l };
                    }
                }
                return null;
            };
            const openFile = async (path) => {
                await click(rowSel(path));
                return until(
                    `${q(rowSel(path))}?.getAttribute("aria-current") === "true" && (() => { ${DIFF_LINE_LIB} return !!lineBox("modified", 1) || !!lineBox("original", 1); })()`,
                    10000
                );
            };
            const bar = async () =>
                JSON.parse(
                    await h.ev(`(() => { const b = ${q(BAR)}; if (!b) return "null";
                        const t = (s) => b.querySelector(s)?.textContent ?? null;
                        const send = b.querySelector("[data-comment-send]");
                        return JSON.stringify({ kind: b.dataset.recipientKind, text: b.textContent, count: t("[data-comment-count]"),
                            recipient: t("[data-comment-recipient]"), detail: t("[data-comment-detail]"), hint: t("[data-comment-hint]"),
                            sent: t("[data-comment-sent-note]"), error: t("[data-comment-error]"),
                            send: send?.textContent ?? null, sendDisabled: send?.disabled ?? null }); })()`)
                );
            const badge = (path) =>
                h.ev(`(() => { const b = ${q(`${rowSel(path)} [data-changed-file-comments]`)}; return b ? b.title : null; })()`);
            const comment = async (note) => {
                await h.cdp("Input.insertText", { text: note });
                await ctrlEnter();
                return until(`!${q(DRAFT)}`, 3000);
            };
            const commentOnLine = async (n, note) => {
                const at = await plusOn(n);
                if (at == null) return false;
                await clickAt(at.plus.x, at.plus.mid);
                return (await until(titleIs(`Comment on line ${n}`), 3000)) && comment(note);
            };
            const commentOnRange = async (side, from, to, title, note) => {
                if (!(await selectLines(side, from, to))) return false;
                await key("m", "KeyM", 77, 0, "m");
                return (await until(titleIs(title), 3000)) && comment(note);
            };
            const toggleSplit = async () => {
                await h.ev("document.activeElement?.blur?.()");
                await key("D", "KeyD", 68, SHIFT, "D");
            };
            // the fixture roster read again in place: the agent working, or asking a question
            const setAgent = async (ask) => {
                writeRoster(ctx, ask);
                await h.ev(`window.__reloadDevMockRoster?.()`);
            };
            const pick = async () => {
                if (!(await pickFilesSource(h, AGENT.name, PROJECT))) return false;
                // The surface picks the panel's tab once the agent's list has landed (difflayout.panelTabToApply), and a click
                // before then is overridden: let it settle, then open the Log tab's Uncommitted changes row, whose file list
                // is the shared changed-file list that badges comments (the Commit tab draws its own rows, committab.tsx).
                // The root commit lists the same three paths as added; the row's list has them modified and deleted.
                await until(`!!${q('[data-panel-tab="log"]')}`, 15000);
                await sleep(1500);
                await showLogTab(h);
                if (!(await until(`${q('[data-panel-tab="log"]')}?.getAttribute("aria-selected") === "true"`, 5000))) return false;
                if (!(await until(`!!${q('[data-history-row="worktree"] button')}`, 15000))) return false;
                await click('[data-history-row="worktree"] button');
                return until(
                    `document.querySelectorAll('[data-changed-file-row]').length === 3 && ${q(`${rowSel(POLICY)} span`)}?.textContent === "M" && ${q(`${rowSel(LEGACY)} span`)}?.textContent === "D"`,
                    15000
                );
            };
            const stored = async () => JSON.parse(await h.ev(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || "{}"`));

            try {
                await pin();
                await sleep(400);
                const picked = await pick();
                const opened = await openFile(POLICY);
                // the bar before the first comment, read now and recorded in order after step 3
                const hinted = (await until(`!!${q("[data-comment-hint]")}`, 5000)) ? await bar() : null;
                await h.shot("cdp-shots/diff-comments-hint.png");

                // 1. the + on a hovered line, in the glyph margin
                const hovered = await plusOn(3);
                const onLine3 = hovered != null && Math.abs(hovered.plus.mid - hovered.line.mid) < 4;
                await h.shot("cdp-shots/diff-comments-plus.png");
                if (hovered != null) await clickAt(hovered.plus.x, hovered.plus.mid);
                const drafted = await until(titleIs("Comment on line 3"), 3000);
                await h.shot("cdp-shots/diff-comments-draft-line3.png");
                await key("Escape", "Escape", 27);
                const cancelled = await until(`!${q(DRAFT)}`, 3000);
                rec(
                    "1. hovering line 3 of src/retry/policy.go shows the + in the glyph margin; clicking it opens a draft titled Comment on line 3, and Esc cancels it",
                    picked && opened && onLine3 && drafted && cancelled,
                    `picked=${picked} opened=${opened} plus=${JSON.stringify(hovered)} drafted=${drafted} cancelled=${cancelled}`
                );

                // 2. a range: m in the editor, the bar on the range, a note that keeps its m
                const selected = await selectLines("modified", 7, 9);
                await key("m", "KeyM", 77, 0, "m");
                const ranged = await until(titleIs("Comment on lines 7–9"), 3000);
                const bars = await h.ev(`document.querySelectorAll("[data-diff-pane] .editor.modified .diff-comment-range").length`);
                rec(
                    "2. selecting lines 7-9 and pressing m in the editor opens a draft titled Comment on lines 7–9, and the range wears the accent bar",
                    selected && ranged && bars >= 1,
                    `focusInEditor=${selected} title="${await draftTitle()}" rangeBars=${bars}`
                );
                await h.shot("cdp-shots/diff-comments-composer.png");

                const NOTE = "A floor of 1 means a zero budget can never be configured. Return 0 here and let Budget enforce the minimu";
                const focused = await h.ev(`document.activeElement === ${q(TEXTAREA)}`);
                await h.cdp("Input.insertText", { text: NOTE });
                await key("m", "KeyM", 77, 0, "m");
                await sleep(300);
                const typed = await h.ev(`${q(TEXTAREA)}?.value ?? ""`);
                const oneDraft = await h.ev(
                    `document.querySelectorAll(${JSON.stringify(DRAFT)}).length === 1 && ${titleIs("Comment on lines 7–9")}`
                );
                await ctrlEnter();
                const added = await until(
                    `!${q(DRAFT)} && document.querySelectorAll('[data-diff-comment-card][data-comment-state="pending"]').length === 1`
                );
                const under9 = await until(cardUnder("modified", 9), 3000);
                const [first] = await cards();
                const handedBack = await h.ev(`document.activeElement === document.body`);
                const barsAfter = await h.ev(`document.querySelectorAll("[data-diff-pane] .editor.modified .diff-comment-range").length`);
                rec(
                    "3. a note typed with an m keeps every character, and Ctrl+Enter adds a pending card under line 9 with the range bar kept",
                    focused && typed === `${NOTE}m` && oneDraft && added && first?.label === "Lines 7–9" && under9 && handedBack && barsAfter >= 1,
                    `focused=${focused} typed="${typed}" oneDraft=${oneDraft} card=${JSON.stringify(first)} focusOnBody=${handedBack} rangeBars=${barsAfter}`
                );
                await h.shot("cdp-shots/diff-comments-pending.png");

                // 4. edit keeps the comment, delete removes the card
                const EDITED = NOTE_FLOOR;
                await click(`[data-diff-comment-card=${JSON.stringify(first?.id ?? "")}] [data-diff-comment-edit]`);
                const editing = await until(`document.activeElement === ${q(TEXTAREA)}`, 3000);
                await h.ev(`${q(TEXTAREA)}?.select()`);
                await h.cdp("Input.insertText", { text: EDITED });
                await ctrlEnter();
                const edited = await until(`!${q(DRAFT)} && ${q("[data-diff-comment-note]")}?.textContent === ${JSON.stringify(EDITED)}`);
                const afterEdit = await cards();
                const again = await plusOn(3);
                if (again != null) await clickAt(again.plus.x, again.plus.mid);
                await until(titleIs("Comment on line 3"), 3000);
                await h.cdp("Input.insertText", { text: "drop me" });
                await ctrlEnter();
                await until(`document.querySelectorAll('[data-diff-comment-card]').length === 2`, 3000);
                const extra = (await cards()).find((c) => c.label === "Line 3");
                await click(`[data-diff-comment-card=${JSON.stringify(extra?.id ?? "")}] [data-diff-comment-delete]`);
                const deleted = await until(
                    `document.querySelectorAll('[data-diff-comment-card]').length === 1 && !!${q(`[data-diff-comment-card=${JSON.stringify(first?.id ?? "")}]`)}`,
                    3000
                );
                rec(
                    "4. edit changes the note and keeps the comment; delete removes the card",
                    editing && edited && afterEdit.length === 1 && afterEdit[0].id === first?.id && extra != null && deleted,
                    `editing=${editing} cards=${JSON.stringify(afterEdit)} extra=${extra?.id} deleted=${deleted}`
                );
                await h.shot("cdp-shots/diff-comments-deleted.png");

                // 5. the deleted file: the unified view hints at split, and its left side takes a comment there
                const legacy = await openFile(LEGACY);
                const hintShown = await until(`!!${q("[data-diff-split-hint]")}`, 5000);
                const hintText = await h.ev(`${q("[data-diff-split-hint]")}?.textContent ?? ""`);
                await h.shot("cdp-shots/diff-comments-split-hint.png");
                // split needs a pane of SPLIT_MIN_PX (diffoptions.ts), which 1600px with the panel open does not leave
                await pin(2000);
                await sleep(500);
                await toggleSplit();
                const split = await until(`(() => { ${DIFF_LINE_LIB} return !!lineBox("original", 3); })()`, 5000);
                const leftSelected = await selectLines("original", 1, 3);
                await key("m", "KeyM", 77, 0, "m");
                const leftTitled = await until(titleIs("Comment on removed lines 1–3"), 3000);
                const leftTitle = await draftTitle();
                await h.cdp("Input.insertText", { text: NOTE_LEGACY });
                await ctrlEnter();
                const leftAdded = await until(`!${q(DRAFT)} && ${cardUnder("original", 3)}`, 3000);
                const removed = (await cards()).find((c) => c.label === "Removed lines 1–3");
                rec(
                    "5. unified view hints at split on the deleted legacy.go; after Shift+D its left side takes a comment reading Removed lines 1–3",
                    legacy && hintShown && split && leftSelected && leftTitled && leftAdded && removed?.original === true,
                    `hint="${hintText}" split=${split} focusInLeft=${leftSelected} title="${leftTitle}" underLine3=${leftAdded} card=${JSON.stringify(removed)}`
                );
                await h.shot("cdp-shots/diff-comments-removed.png");
                await toggleSplit();
                await pin();

                // 6. one more on policy.go, so two files carry comments; the rows badge them
                await openFile(POLICY);
                const third = await commentOnLine(4, NOTE_RETURN);
                // step 4 left the floor comment on 7-9 and this one on 4, with the legacy one on the other file
                const badges = { policy: await badge(POLICY), legacy: await badge(LEGACY), readme: await badge(README) };
                rec(
                    "6. with comments on two files the list badges them: 2 pending comments on policy.go, 1 on legacy.go, none on README.md",
                    third && badges.policy === "2 pending comments" && badges.legacy === "1 pending comment" && badges.readme === null,
                    JSON.stringify({ third, badges })
                );
                await h.shot("cdp-shots/diff-comments-badges.png");

                // 7. the bar before any of that, then with the batch: the recipient is the agent, working
                const folder = basename(ctx.dir);
                rec(
                    `7. before any comment the bar is the hint "Press m or click a line's + to comment for ${folder}"`,
                    hinted?.kind === "none" && typeof hinted?.hint === "string" && hinted.hint.startsWith("Press m or click a line's + to comment for "),
                    JSON.stringify(hinted)
                );
                await until(`${q("[data-comment-detail]")}?.textContent === "working, joins its turn"`, 8000);
                const working = await bar();
                rec(
                    `8. on a live agent working, the bar reads 3 comments in 2 files · to ${AGENT.name}, working, joins its turn, with Send 3 comments`,
                    working?.kind === "live" &&
                        working.count === "3 comments" &&
                        working.text.includes("in 2 files · to") &&
                        working.recipient === AGENT.name &&
                        working.detail === "working, joins its turn" &&
                        working.send === "Send 3 comments⇧↵" &&
                        working.sendDisabled === false,
                    JSON.stringify(working)
                );
                await h.shot("cdp-shots/diff-comments-live-working.png");

                // 9. the agent asking a question: its open ask would take the prompt as the answer, so the send waits
                await setAgent({
                    askId: `fx-dc-ask-${Date.now()}`,
                    questions: [{ header: "Question", question: "Which budget reads better?", options: [{ label: "5" }, { label: "8" }] }],
                });
                const waitText = `${AGENT.name} is asking a question — answer it first`;
                const waited = await until(`${q("[data-comment-detail]")}?.textContent === ${JSON.stringify(waitText)}`, 8000);
                const asking = await bar();
                rec(
                    `9. with the agent asking, the send waits: ${waitText}, Send disabled, the comments kept`,
                    waited && asking?.kind === "wait" && asking.sendDisabled === true && asking.send === "Send 3 comments" && asking.count === "3 comments",
                    JSON.stringify(asking)
                );
                await h.shot("cdp-shots/diff-comments-asking.png");
                await setAgent(null);
                const resumed = await until(`${q("[data-comment-detail]")}?.textContent === "working, joins its turn"`, 8000);

                // 10. a refused send keeps the batch; the next one delivers one message and clears it. The page's own
                // agentprompt calls are recorded and resolved here, never forwarded, so nothing is typed into a shell
                await h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (!c.__dcOrig) {
                        c.__dcOrig = c.wshRpcCall;
                        const call = c.wshRpcCall.bind(c);
                        c.wshRpcCall = (command, data, opts) => {
                            if (command !== "agentprompt") return call(command, data, opts);
                            window.__dcPrompts.push(data);
                            if (window.__dcRefuse) {
                                window.__dcRefuse = false;
                                return Promise.reject(new Error("verify refused the prompt"));
                            }
                            return Promise.resolve(null);
                        };
                    }
                    window.__dcPrompts = [];
                    window.__dcRefuse = true;
                })()`);
                await click("[data-comment-send]");
                const errored = await until(`!!${q("[data-comment-error]")}`, 5000);
                const failed = await bar();
                const storedAfterFail = Object.values(await stored()).flatMap((b) => b.comments).length;
                rec(
                    `10. a refused send shows Couldn't send to ${AGENT.name}: … with Send again, and the three comments stay`,
                    resumed &&
                        errored &&
                        (failed?.error ?? "").startsWith(`Couldn't send to ${AGENT.name}: `) &&
                        failed.send === "Send again⇧↵" &&
                        failed.count === "3 comments" &&
                        storedAfterFail === 3,
                    JSON.stringify({ resumed, bar: failed, storedAfterFail })
                );
                await h.shot("cdp-shots/diff-comments-send-failed.png");

                await h.ev("window.__dcPrompts = []");
                // the ref the pair was read against, which an agent's scope takes from its session (state.ref), else the HEAD sha
                const anchor = Object.values(await stored()).flatMap((b) => b.comments)[0]?.refs?.original?.ref ?? "";
                await click("[data-comment-send]");
                const sentShown = await until(`!!${q("[data-comment-sent-note]")}`, 5000);
                await sleep(300);
                const prompts = JSON.parse(await h.ev(`JSON.stringify(window.__dcPrompts)`));
                const short = /^[0-9a-f]{40}$/.test(anchor) ? anchor.slice(0, 7) : anchor;
                const want = [
                    `Review comments on your changes (worktree against ${short}), 3 comments:`,
                    "",
                    // in the order they were added: step 3's floor note, step 5's removed lines, step 6's return note
                    `  ${POLICY}:7-9`,
                    "  > func Floor() int {",
                    `  ${NOTE_FLOOR}`,
                    "",
                    `  ${LEGACY}: removed lines 1-3 of ${short}`,
                    "  > package retry",
                    `  ${NOTE_LEGACY}`,
                    "",
                    `  ${POLICY}:4`,
                    "  >     return 8",
                    `  ${NOTE_RETURN}`,
                    "",
                    "  Line numbers are the file as shown in the diff. Address each comment, then say which you changed.",
                ].join("\n");
                const text = prompts[0]?.text ?? "";
                mkdirSync("cdp-shots", { recursive: true });
                writeFileSync("cdp-shots/diff-comments-prompt.txt", text);
                const sentBar = await bar();
                const left = await h.ev(`document.querySelectorAll("[data-diff-comment-card]").length`);
                const storedAfterSend = Object.values(await stored()).flatMap((b) => b.comments).length;
                rec(
                    `11. Send delivers exactly one agentprompt holding each file, line range and comment, the cards and the batch leave, and Sent 3 comments to ${AGENT.name} shows`,
                    sentShown &&
                        anchor !== "" &&
                        anchor !== "HEAD" &&
                        prompts.length === 1 &&
                        prompts[0].blockid === AGENT.blockId &&
                        text === want &&
                        left === 0 &&
                        storedAfterSend === 0 &&
                        sentBar?.sent?.startsWith(`Sent 3 comments to ${AGENT.name}`),
                    JSON.stringify({ prompts: prompts.length, block: prompts[0]?.blockid, matches: text === want, sentBar, cardsLeft: left, storedAfterSend }) +
                        "\nprompt:\n" +
                        text +
                        (text === want ? "" : "\nwant:\n" + want)
                );
                await h.shot("cdp-shots/diff-comments-sent.png");
            } catch (e) {
                rec("scenario aborted", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            try {
                await h.ev("document.activeElement?.blur?.()");
                await h.ev(
                    `(() => { const c = window.TabRpcClient; if (c?.__dcOrig) { c.wshRpcCall = c.__dcOrig; delete c.__dcOrig; } delete window.__dcPrompts; delete window.__dcRefuse; })()`
                );
                await h.ev(restoreLocalStorage(STORAGE_KEY, ctx.prevComments ?? null));
            } catch (e) {
                console.error(`diff-comments teardown: restore the page failed: ${e?.message ?? e}`);
            }
            if (ctx.project) {
                // deleteproject leaves the channel createproject made, so that goes too
                try {
                    await h.rpc("deleteproject", { name: ctx.project });
                    const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.dir))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                } catch (e) {
                    console.error(`diff-comments teardown: remove the project failed: ${e?.message ?? e}`);
                }
            }
            // removes the fixture roster, reloads onto the live one (which also drops the store's in-memory batch before it
            // can be written back over the restored key) and removes the temp dir
            await teardownFixtureRun(h, ctx, "diff-comments");
        },
    };
    return [scenario];
}
