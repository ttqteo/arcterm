// kael-keys: the keybindings this sync's features add, pressed in the app (docs/superpowers/plans/
// 2026-11-12-kael-sync-code-diff-usage-setup.md, Task 16). Every other task exports the functions and atoms its commits' bindings
// need and binds nothing; Task 16 wires them, so a step that presses a key a feature task does not bind lives here.
// kits is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).
//
// One scenario, `kael-keys`, over three surfaces. Code: Alt+O opens the finder seeded with `@`, F12 and Shift+F12 on a word,
// Alt+M starts a review comment and Alt+Shift+M opens the send bar, then in a plain folder (no git) `d` passes through and
// Alt+arrows work from inside the editor (4c026402d). Diff: `m` starts a comment on the open diff, Shift+Enter sends the
// batch to the fixture agent, and Shift+D declines while the pane is too narrow to draw split (dc26b2004). Usage: j / k and
// Enter walk By work's cards and rows, and Escape goes back a level at a time, then home.
//
// Not here: the fork's `r` in compare (ours already re-reads the pair there), and its Diff history overlay keys (ours has the
// Commit | Log panel; no overlay exists to open). Each is named under Differs from plan in the Task 16 report.
//
// Each press is a real CDP key event. Code and Diff run on one temp repo registered as a project, with a fixture roster agent on
// it (the `diff-comments` and `code-review-send` pattern: a block no terminal holds, the page's own agentprompt call recorded and
// never forwarded). Usage runs on the dev-only seeded usage fixture (the localStorage seam usagestore.ts reads).

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SURFACE_LABEL } from "./attach.mjs";

const PROJECT = "verify-kael-keys";
const AGENT = { id: "fx-kk-agent", name: "key-writer", blockId: "fx-blk-kk-agent" };
const ALT = 1; // CDP Input.dispatchKeyEvent modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
const CTRL = 2;
const SHIFT = 8;

const REVIEW_KEY = "code.reviews";
const LAST_PROJECT_KEY = "code.project.last";
const DIFF_KEY = "diff.comments.pending";
const USAGE_KEY = "wave:dev-usage-buckets";

// line numbers the steps assert against: alpha 5, beta 9, epsilon 13
const MAIN_GO = [
    "package main",
    "",
    'import "fmt"',
    "",
    "func alpha() {",
    "\tfmt.Println(beta(), epsilon())",
    "}",
    "",
    "func beta() string {",
    '\treturn "b"',
    "}",
    "",
    "func epsilon() int {",
    "\treturn 1",
    "}",
    "",
].join("\n");
const CALL_LINE = "fmt.Println(beta(), epsilon())";
const POLICY = "src/retry/policy.go";
const LEGACY = "src/retry/legacy.go";
const README = "README.md";
const POLICY_BOARD = "package retry\n\nfunc Budget() int {\n    return 8\n}\n\nfunc Floor() int {\n    return 1\n}\n";
const NOTE_CODE = "Why a bare beta()? Wrap the call.";
const NOTE_DIFF = "Why 8? Put the reason in a comment above the return.";

// By work's fixture: a project of three sessions and a smaller one of one. The paths use forward slashes and an upper-case
// drive letter, the form the surface normalises a project to, so data-usage-project equals what was seeded
const ARC = "C:/work/arc";
const SIEM = "C:/work/siem";
const OPUS = "claude-opus-5-5";
const ARC_SCOPE = `project:${ARC}`;

const dayAgo = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function usageFixture() {
    const buckets = [];
    const sessions = [];
    const add = (session, units, meta) => {
        buckets.push({
            harness: "claude",
            provider: "anthropic",
            model: OPUS,
            session,
            day: dayAgo(1),
            input: 10_000 * units,
            output: 2_000 * units,
            reasoning: 0,
            cacheread: 100_000 * units,
            cachecreate: 5_000 * units,
            cachecreate1h: 0,
            msgs: units,
        });
        sessions.push({ harness: "claude", session, ...meta });
    };
    add("fx-kk-1", 6, { title: "Trace the usage scan", project: ARC, projectname: "Arc" });
    add("fx-kk-2", 5, { title: "Rename the bucket key", project: ARC, projectname: "Arc" });
    add("fx-kk-3", 4, { title: "Read the price table", project: ARC, projectname: "Arc" });
    add("fx-kk-4", 1, { title: "A smaller project's session", project: SIEM, projectname: "Siem" });
    return { buckets, sessions, efforts: [] };
}

// Monaco's caret line, as its gutter marks it
const CARET_LINE = `(() => { const el = document.querySelector(".monaco-editor .active-line-number"); return el ? Number(el.textContent.trim()) : null; })()`;
const INPUT = `document.querySelector('[data-code-comment-input]')`;
const OPEN_PATH = `document.querySelector("[data-code-path]")?.getAttribute("data-code-path") ?? null`;
const PALETTE_INPUT = `document.querySelector('input[data-palette-input]')`;

// in-page: whether line n's number is drawn in one side's editor of the diff pane (the pair is open and laid out)
const HAS_LINE = (side, n) => `(() => {
    const ed = document.querySelector('[data-diff-pane] .editor.${side}');
    const el = ed && [...ed.querySelectorAll('.margin-view-overlays .line-numbers')].find((e) => e.textContent.trim() === "${n}");
    return !!el && el.getBoundingClientRect().height > 0;
})()`;

export default function (kits) {
    const { rt, code, files, jarvis } = kits;
    const { git, chooseProjectNamed, polishWaitFor, polishNap } = code;
    const { pickFilesSource, showLogTab, reloadApp, restoreLocalStorage } = files;
    const { waitForProjectInConfig, TREE_RAIL_FIXTURE } = rt;
    const { teardownFixtureRun } = jarvis;

    // The fixture roster: one agent with a block (so a live recipient), working. Its transcript names the repo as its cwd, so
    // the Diff scopes to it; the project name puts it in Code's Send review picker.
    const writeRoster = (ctx) => {
        mkdirSync(new URL("./", TREE_RAIL_FIXTURE), { recursive: true });
        writeFileSync(
            TREE_RAIL_FIXTURE,
            JSON.stringify(
                [
                    {
                        id: AGENT.id,
                        name: AGENT.name,
                        project: PROJECT,
                        task: "tune the retry budget",
                        state: "working",
                        agent: "claude",
                        model: "opus",
                        blockId: AGENT.blockId,
                        activeMs: 30_000,
                        transcriptPath: ctx.transcriptPath,
                        previousInfo: [{ kind: "message", text: "Raised the budget." }],
                    },
                ],
                null,
                2
            )
        );
    };

    // a chord carries no `text`: with one, CDP would type the character into whatever field is focused if no binding took the key
    const key = async (h, k, code, vk, modifiers = 0, text) => {
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
    };
    const blur = (h) => h.ev("document.activeElement?.blur?.()");

    // the keys that reached the page's listeners: the app's dispatcher claims a key it runs with stopImmediatePropagation, so a
    // probe registered after it (at boot) sees only the keys no binding took
    const installProbe = (h) =>
        h.ev(`(() => {
            window.__kkSeen = [];
            if (!window.__kkProbe) {
                window.__kkProbe = (e) => window.__kkSeen.push(e.key);
                window.addEventListener("keydown", window.__kkProbe, true);
            }
            return true;
        })()`);
    const seenAfter = async (h, k, codeName, vk) => {
        await h.ev("window.__kkSeen = []");
        await key(h, k, codeName, vk, 0, k);
        await polishNap(450);
        return JSON.parse(await h.ev("JSON.stringify(window.__kkSeen || [])"));
    };

    // where a word of a rendered editor line is, or null while the line is not drawn
    const wordPoint = (h, lineText, word) =>
        h.ev(`(() => {
            const line = [...document.querySelectorAll(".monaco-editor .view-line")].find((l) => l.textContent.replace(/\\u00a0/g, " ").includes(${JSON.stringify(lineText)}));
            if (!line) return null;
            const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                const i = n.textContent.indexOf(${JSON.stringify(word)});
                if (i < 0) continue;
                const r = document.createRange();
                r.setStart(n, i + 1);
                r.setEnd(n, i + 2);
                const b = r.getBoundingClientRect();
                return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
            }
            return null;
        })()`);
    const click = async (h, pt) => {
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
        }
    };
    // a real click on a word puts Monaco's caret there and focus in the editor
    const clickWord = async (h, lineText, word) => {
        const pt = await wordPoint(h, lineText, word);
        if (pt == null) return false;
        await click(h, pt);
        await polishNap(250);
        return true;
    };
    const waitCaret = async (h, line) => {
        await polishWaitFor(h, `${CARET_LINE} === ${line}`, 6000);
        return h.ev(CARET_LINE);
    };
    const editorFocused = (h) => h.ev(`!!document.activeElement?.closest?.(".monaco-editor")`);

    // types into the open comment input and presses a key on it, with the input focused as typing leaves it
    const answer = async (h, note, k) => {
        const ok = await h.ev(`(() => {
            const input = ${INPUT};
            if (!input) return false;
            input.focus();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(note)});
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        })()`);
        await polishNap(100);
        await h.ev(`${INPUT}?.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
        await polishNap(200);
        return ok === true;
    };

    const openTreeFile = (h, name) =>
        polishWaitFor(
            h,
            `(() => {
                const r = [...document.querySelectorAll('[data-code-tree] [role="treeitem"]')].find((x) => x.textContent.trim() === ${JSON.stringify(name)});
                if (!r) return false;
                r.click();
                return true;
            })()`,
            10000
        );

    const scenario = {
        name: "kael-keys",
        surface: "code",
        async arrange(h) {
            const base = mkdtempSync(join(tmpdir(), "verify-kael-keys-"));
            const dir = join(base, "repo");
            const ctx = { cwd: base, dir, plain: join(base, "plain"), project: null };
            try {
                mkdirSync(join(dir, "src", "retry"), { recursive: true });
                mkdirSync(join(dir, "sub"), { recursive: true });
                writeFileSync(join(dir, "main.go"), MAIN_GO);
                writeFileSync(join(dir, "sub", "x.go"), "package sub\n\nfunc epsilon() int { return 2 }\n");
                writeFileSync(join(dir, README), "# retry\n");
                writeFileSync(join(dir, POLICY), "package retry\n\nfunc Budget() int {\n    return 3\n}\n");
                writeFileSync(join(dir, LEGACY), "package retry\n\nfunc Legacy() {}\n");
                git(dir, "init", "-q", "--initial-branch=main");
                git(dir, "add", ".");
                git(dir, "commit", "-q", "-m", "seed the keys fixture");
                // the working tree the Diff shows: one file edited, one edited with a function added, one deleted
                writeFileSync(join(dir, README), "# retry\n\nBudgets and backoff for job submission.\n");
                writeFileSync(join(dir, POLICY), POLICY_BOARD);
                rmSync(join(dir, LEGACY));

                // a folder git does not know, typed into Code's picker like any directory
                mkdirSync(ctx.plain, { recursive: true });
                writeFileSync(join(ctx.plain, "a.txt"), "first file\nsecond line\n");
                writeFileSync(join(ctx.plain, "b.txt"), "other file\nanother line\n");

                // the Diff resolves an agent's repo from its block or its transcript; the fixture's block is not real
                ctx.transcriptPath = join(base, "session.jsonl");
                writeFileSync(
                    ctx.transcriptPath,
                    JSON.stringify({ type: "user", cwd: dir, message: { role: "user", content: "tune the retry budget" } }) + "\n"
                );
                await h.rpc("createproject", { name: PROJECT, path: dir });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);

                // the review and comment stores and the usage seam read localStorage at module load: the keys are set before the
                // reload that gives this scenario fresh module state, and teardown puts back whatever the user had
                ctx.prev = {};
                for (const k of [REVIEW_KEY, LAST_PROJECT_KEY, DIFF_KEY, USAGE_KEY]) {
                    ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                }
                await h.ev(`localStorage.removeItem(${JSON.stringify(REVIEW_KEY)})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(DIFF_KEY)})`);
                await h.ev(`localStorage.setItem(${JSON.stringify(USAGE_KEY)}, ${JSON.stringify(JSON.stringify(usageFixture()))})`);
                writeRoster(ctx);
                ctx.wroteFixture = true;
                await reloadApp(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError != null) {
                return [{ step: "0. the repo, the project, the fixture roster and the usage seed", ok: false, detail: ctx.arrangeError }];
            }
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            const shot = (name) => h.shot(`cdp-shots/kael-keys-${name}.png`);
            const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
            const pin = (width = 1600) => h.cdp("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });

            try {
                await pin();
                await installProbe(h);

                // ---- Code: the repo project, main.go in the editor ----
                await h.goto("code");
                const onProject = (name) =>
                    h.ev(`(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(name)})`);
                if ((await onProject(PROJECT)) !== true) {
                    await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
                    await polishNap(300);
                    await chooseProjectNamed(h, PROJECT);
                    await polishWaitFor(h, `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(PROJECT)})`, 8000);
                }
                await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
                const opened = await openTreeFile(h, "main.go");
                const editor = opened && (await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line")`, 10000));

                // 1. Alt+O from the editor: the finder, seeded with @ and listing the file's symbols
                const placed = await clickWord(h, CALL_LINE, "beta");
                const focused = await editorFocused(h);
                await key(h, "o", "KeyO", 79, ALT);
                const paletteUp = await polishWaitFor(h, `!!${PALETTE_INPUT}`, 4000);
                const seeded = paletteUp && (await h.ev(`${PALETTE_INPUT}.value`)) === "@";
                const listed = paletteUp && (await polishWaitFor(h, `document.body.textContent.includes("Symbols in main.go")`, 4000));
                await shot("symbols");
                rec(
                    "1. Alt+O with the caret in the editor opens the finder seeded with @, listing Symbols in main.go",
                    opened === true && editor === true && placed === true && focused === true && paletteUp === true && seeded === true && listed === true,
                    JSON.stringify({ opened, editor, placed, focused, paletteUp, seeded, listed, value: paletteUp ? await h.ev(`${PALETTE_INPUT}.value`) : null })
                );
                await key(h, "Escape", "Escape", 27);
                await polishWaitFor(h, `!${PALETTE_INPUT}`, 4000);
                await polishNap(400);

                // 2. F12 on a name with one definition jumps to it; Shift+F12 lists its references
                const onBeta = await clickWord(h, CALL_LINE, "beta");
                const before = await waitCaret(h, 6);
                await key(h, "F12", "F12", 123);
                const afterDef = await waitCaret(h, 9);
                rec(
                    "2. F12 on beta in alpha's call jumps to func beta (line 9)",
                    onBeta === true && before === 6 && afterDef === 9,
                    JSON.stringify({ onBeta, before, afterDef })
                );
                const onBeta2 = await clickWord(h, CALL_LINE, "beta");
                await key(h, "F12", "F12", 123, SHIFT);
                const refTitle = await polishWaitFor(h, `(${q("[data-code-search-title]")}?.textContent?.trim() ?? "") === "References to beta"`, 8000);
                await shot("references");
                rec("3. Shift+F12 on beta lists References to beta in Search", onBeta2 === true && refTitle === true, JSON.stringify({ onBeta2, refTitle }));
                await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);

                // 4. Alt+M starts a review comment on the caret's line; the toolbar counts it
                const onLine = await clickWord(h, CALL_LINE, "Println");
                await key(h, "m", "KeyM", 77, ALT);
                const input = await polishWaitFor(h, `!!${INPUT}`, 4000);
                const label = input ? await h.ev(`${INPUT}?.getAttribute("aria-label") ?? null`) : null;
                const saved = input && (await answer(h, NOTE_CODE, "Enter"));
                const counted = saved && (await polishWaitFor(h, `${q("[data-code-review-count]")}?.getAttribute("data-code-review-count") === "1"`, 4000));
                await shot("comment");
                rec(
                    "4. Alt+M on line 6 opens the review comment input, Enter saves it, and the toolbar counts 1",
                    onLine === true && input === true && /^Comment on line 6/.test(label ?? "") && saved === true && counted === true,
                    JSON.stringify({ onLine, input, label, saved, counted })
                );

                // 5. Alt+Shift+M opens the send bar: the agent picker lists the fixture agent
                await blur(h);
                await key(h, "M", "KeyM", 77, ALT | SHIFT);
                const sendBar = await polishWaitFor(h, `!!${q(`[data-code-agent-picker-row=${JSON.stringify(AGENT.name)}]`)}`, 5000);
                const owns = await h.ev(`${q("[data-code-review-bar]")}?.hasAttribute("data-owns-keys") === true`);
                await shot("send-bar");
                rec(
                    "5. Alt+Shift+M with a comment present opens Send review's picker, listing the project's agent",
                    sendBar === true && owns === true,
                    JSON.stringify({ sendBar, owns })
                );
                await key(h, "Escape", "Escape", 27);
                const closed = await polishWaitFor(h, `!${q("[data-code-agent-picker-row]")}`, 4000);
                await h.ev(`document.querySelector("[data-code-review-clear]")?.click()`);
                const CONFIRM = `[...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent || "").trim().startsWith("Clear"))`;
                await polishWaitFor(h, `!!${CONFIRM}`, 4000);
                await h.ev(`${CONFIRM}?.click()`);
                const cleared = await polishWaitFor(h, `${q("[data-code-review-count]")} === null`, 4000);
                rec(
                    "5b. Escape closes the picker and leaves Code where it is; Clear then drops the review",
                    closed === true && cleared === true && (await h.activeSurfaceLabel()) === SURFACE_LABEL.code,
                    JSON.stringify({ closed, cleared, surface: await h.activeSurfaceLabel() })
                );

                // ---- Code: a plain folder, no git ----
                await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
                const pathInput = await polishWaitFor(h, `!!${q("[data-code-picker-path] input")}`, 5000);
                await h.ev(`(() => {
                    const i = ${q("[data-code-picker-path] input")};
                    if (!i) return;
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(ctx.plain)});
                    i.dispatchEvent(new Event("input", { bubbles: true }));
                })()`);
                await polishNap(150);
                await h.ev(`${q("[data-code-picker-path]")}?.requestSubmit()`);
                const plainTree = await polishWaitFor(
                    h,
                    `[...document.querySelectorAll('[data-code-tree] [role="treeitem"]')].some((r) => r.textContent.trim() === "a.txt")`,
                    10000
                );
                const plainOpened = plainTree && (await openTreeFile(h, "a.txt"));
                const plainEditor = plainOpened && (await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line")`, 10000));
                await blur(h);
                // the control: a bare letter another binding owns is claimed (the probe sees nothing); d is let through
                const seenR = await seenAfter(h, "r", "KeyR", 82);
                const seenD = await seenAfter(h, "d", "KeyD", 68);
                await shot("plain-d");
                rec(
                    "6. in a plain folder, d passes through to the page (r, a control, is claimed) and does not cycle a diff",
                    plainEditor === true && seenR.length === 0 && seenD.join() === "d" && (await h.ev(`${q('[data-code-view-mode="diff"]')}?.disabled ?? null`)) === true,
                    JSON.stringify({ pathInput, plainTree, plainOpened, plainEditor, seenR, seenD })
                );

                // 7. Alt+arrows from inside the editor go back and forward through the opened files
                const openedB = await openTreeFile(h, "b.txt");
                await polishWaitFor(h, `${OPEN_PATH} === "b.txt"`, 6000);
                // the editor swaps its model a moment after the path bar changes: wait for b.txt's own line
                await polishWaitFor(
                    h,
                    `[...document.querySelectorAll(".monaco-editor .view-line")].some((x) => x.textContent.replace(/\\u00a0/g, " ").includes("another line"))`,
                    6000
                );
                const lineAt = await h.ev(`(() => {
                    const l = [...document.querySelectorAll(".monaco-editor .view-line")].find((x) => x.textContent.replace(/\\u00a0/g, " ").includes("another line"));
                    const b = l?.getBoundingClientRect();
                    return b ? { x: b.left + 12, y: b.top + b.height / 2 } : null;
                })()`);
                if (lineAt != null) await click(h, lineAt);
                await polishNap(300);
                const inEditor = await editorFocused(h);
                await key(h, "ArrowLeft", "ArrowLeft", 37, ALT);
                const back = await polishWaitFor(h, `${OPEN_PATH} === "a.txt"`, 6000);
                await key(h, "ArrowRight", "ArrowRight", 39, ALT);
                const forward = await polishWaitFor(h, `${OPEN_PATH} === "b.txt"`, 6000);
                await shot("alt-arrows");
                rec(
                    "7. with the caret in the editor, Alt+← goes back to a.txt and Alt+→ forward to b.txt",
                    openedB === true && lineAt != null && inEditor === true && back === true && forward === true,
                    JSON.stringify({ openedB, lineAt, inEditor, back, forward, path: await h.ev(OPEN_PATH) })
                );

                // ---- Diff: m starts a comment, Shift+Enter sends the batch, Shift+D declines while narrow ----
                await h.goto("files");
                await polishNap(800);
                const until = (expr, ms = 8000) => polishWaitFor(h, expr, ms);
                const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;
                const picked = await (async () => {
                    if (!(await pickFilesSource(h, AGENT.name, PROJECT))) return false;
                    // the surface picks the panel's tab once the agent's list has landed, and a click before then is overridden
                    await until(`!!${q('[data-panel-tab="log"]')}`, 15000);
                    await polishNap(1500);
                    await showLogTab(h);
                    if (!(await until(`${q('[data-panel-tab="log"]')}?.getAttribute("aria-selected") === "true"`, 5000))) return false;
                    if (!(await until(`!!${q('[data-history-row="worktree"] button')}`, 15000))) return false;
                    await h.ev(`${q('[data-history-row="worktree"] button')}?.click()`);
                    return until(`document.querySelectorAll('[data-changed-file-row]').length === 3`, 15000);
                })();
                await h.ev(`${q(rowSel(POLICY))}?.click()`);
                const diffOpen = await until(
                    `${q(rowSel(POLICY))}?.getAttribute("aria-current") === "true" && (${HAS_LINE("modified", 1)} || ${HAS_LINE("original", 1)})`,
                    10000
                );
                await blur(h);
                await key(h, "m", "KeyM", 77, 0, "m");
                const drafted = await until(`!!${q("[data-diff-comment-draft]")}`, 4000);
                const draftTitle = drafted ? await h.ev(`${q("[data-diff-comment-draft] label")}?.textContent ?? ""`) : null;
                await shot("diff-draft");
                rec(
                    "8. m with the diff pane on screen (focus out of the editor) opens a comment draft on the cursor's line",
                    picked === true && diffOpen === true && drafted === true && /^Comment on line /.test(draftTitle ?? ""),
                    JSON.stringify({ picked, diffOpen, drafted, draftTitle })
                );
                await h.cdp("Input.insertText", { text: NOTE_DIFF });
                await key(h, "Enter", "Enter", 13, CTRL);
                const pending = await until(
                    `!${q("[data-diff-comment-draft]")} && document.querySelectorAll('[data-diff-comment-card][data-comment-state="pending"]').length === 1`,
                    4000
                );

                // the page's own agentprompt calls are recorded and resolved here, never forwarded, so nothing is typed into a shell
                await h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (!c.__kkOrig) {
                        c.__kkOrig = c.wshRpcCall;
                        const call = c.wshRpcCall.bind(c);
                        c.wshRpcCall = (command, data, opts) => {
                            if (command !== "agentprompt") return call(command, data, opts);
                            window.__kkPrompts.push(data);
                            return Promise.resolve(null);
                        };
                    }
                    window.__kkPrompts = [];
                })()`);
                await until(`${q("[data-comment-detail]")}?.textContent === "working, joins its turn"`, 8000);
                await blur(h);
                await key(h, "Enter", "Enter", 13, SHIFT);
                const sent = await until(`!!${q("[data-comment-sent-note]")}`, 6000);
                await polishNap(300);
                const prompts = JSON.parse(await h.ev("JSON.stringify(window.__kkPrompts)"));
                const left = await h.ev(`document.querySelectorAll("[data-diff-comment-card]").length`);
                await shot("diff-sent");
                rec(
                    "9. Shift+Enter sends the pending comment to the agent as one prompt, and the card leaves",
                    pending === true &&
                        sent === true &&
                        prompts.length === 1 &&
                        prompts[0].blockid === AGENT.blockId &&
                        (prompts[0].text ?? "").includes(NOTE_DIFF) &&
                        left === 0,
                    JSON.stringify({ pending, sent, prompts: prompts.length, block: prompts[0]?.blockid, hasNote: (prompts[0]?.text ?? "").includes(NOTE_DIFF), cardsLeft: left })
                );

                // 10. Shift+D while the pane is too narrow to draw split leaves the view unified: the choice is not stored where
                // widening would show it. The pane draws split from SPLIT_MIN_PX (900px, diffoptions.ts); with the panel open
                // (340px, and folded only below a 1000px surface, difflayout.ts) that is a window of about 1200px, so the
                // steps look for a width whose pane measures under it rather than assume one.
                // Monaco puts side-by-side on the diff editor's root only while it draws two editors (its own effective setting:
                // the pane's choice and the width it has)
                const SIDE = `!!document.querySelector("[data-diff-pane] .monaco-diff-editor.side-by-side")`;
                const PANE_WIDTH = `Math.round(document.querySelector("[data-diff-pane]")?.getBoundingClientRect().width ?? 0)`;
                let narrowWindow = null;
                let narrowPane = null;
                for (const width of [1200, 1150, 1250, 1100, 1300, 1050]) {
                    await pin(width);
                    await polishNap(700);
                    const pane = await h.ev(PANE_WIDTH);
                    if (pane > 300 && pane < 880) {
                        narrowWindow = width;
                        narrowPane = pane;
                        break;
                    }
                }
                await blur(h);
                const unifiedAtStart = (await h.ev(SIDE)) === false;
                await key(h, "D", "KeyD", 68, SHIFT);
                await polishNap(500);
                const narrowSplit = await h.ev(SIDE);
                await pin(2000);
                await polishNap(900);
                const widePane = await h.ev(PANE_WIDTH);
                const wideAfterDecline = await h.ev(SIDE);
                await blur(h);
                await key(h, "D", "KeyD", 68, SHIFT);
                const wideSplit = await until(SIDE, 5000);
                await shot("diff-split");
                rec(
                    `10. Shift+D with the pane too narrow for split (${narrowPane}px in a ${narrowWindow}px window) does nothing, so widening does not flip to split by itself; with the pane ${widePane}px wide Shift+D then splits`,
                    diffOpen === true &&
                        narrowWindow != null &&
                        unifiedAtStart === true &&
                        narrowSplit === false &&
                        widePane >= 900 &&
                        wideAfterDecline === false &&
                        wideSplit === true,
                    JSON.stringify({ narrowWindow, narrowPane, unifiedAtStart, narrowSplit, widePane, wideAfterDecline, wideSplit })
                );
                await key(h, "D", "KeyD", 68, SHIFT);
                await pin();

                // ---- Usage: By work ----
                await h.goto("usage");
                const lens = await polishWaitFor(
                    h,
                    `(() => { const b = [...document.querySelectorAll('[aria-label="Lens"] button')].find((x) => x.textContent.trim() === "By work"); if (!b) return false; b.click(); return true; })()`,
                    10000
                );
                const scopeNow = () => h.ev(`document.querySelector("[data-usage-detail]")?.getAttribute("data-usage-detail") ?? null`);
                const cursorNow = () => h.ev(`document.querySelector("[data-usage-detail] [data-usage-cursor]")?.getAttribute("data-usage-item") ?? null`);
                const rowKeys = () =>
                    h.ev(`JSON.stringify([...document.querySelectorAll("[data-usage-detail] [data-usage-list] [data-usage-item]")].map((r) => r.getAttribute("data-usage-item")))`).then(JSON.parse);
                const atAll = await polishWaitFor(h, `document.querySelector("[data-usage-detail]")?.getAttribute("data-usage-detail") === "all"`, 10000);
                await blur(h);

                // 11. j moves the cursor onto the first project card, which selects it; Enter drops it onto the first row; j and k walk the rows
                await key(h, "j", "KeyJ", 74, 0, "j");
                const onArc = await polishWaitFor(h, `document.querySelector("[data-usage-detail]")?.getAttribute("data-usage-detail") === ${JSON.stringify(ARC_SCOPE)}`, 6000);
                await polishNap(300);
                const rows = await rowKeys();
                await key(h, "Enter", "Enter", 13);
                const firstRow = await polishWaitFor(h, `!!document.querySelector("[data-usage-detail] [data-usage-cursor]")`, 4000);
                const c1 = await cursorNow();
                await key(h, "j", "KeyJ", 74, 0, "j");
                await polishNap(300);
                const c2 = await cursorNow();
                await key(h, "k", "KeyK", 75, 0, "k");
                await polishNap(300);
                const c3 = await cursorNow();
                await shot("usage-cursor");
                rec(
                    "11. on By work, j selects the next scope card, Enter puts the cursor on the first row, and j / k walk the rows",
                    lens === true && atAll === true && onArc === true && rows.length >= 2 && firstRow === true && c1 === rows[0] && c2 === rows[1] && c3 === rows[0],
                    JSON.stringify({ lens, atAll, onArc, rows, c1, c2, c3 })
                );

                // 12. Enter opens the row; Escape goes back a level at a time: item -> its scope -> All usage -> home
                await key(h, "Enter", "Enter", 13);
                const inItem = await polishWaitFor(h, `(document.querySelector("[data-usage-detail]")?.getAttribute("data-usage-detail") ?? "") === ${JSON.stringify(rows[0])} || (document.querySelector("[data-usage-detail]")?.getAttribute("data-usage-detail") ?? "").startsWith("session:")`, 6000);
                const itemScope = await scopeNow();
                await key(h, "Escape", "Escape", 27);
                const backToProject = await polishWaitFor(h, `document.querySelector("[data-usage-detail]")?.getAttribute("data-usage-detail") === ${JSON.stringify(ARC_SCOPE)}`, 6000);
                const stillUsage = (await h.activeSurfaceLabel()) === SURFACE_LABEL.usage;
                await key(h, "Escape", "Escape", 27);
                const backToAll = await polishWaitFor(h, `document.querySelector("[data-usage-detail]")?.getAttribute("data-usage-detail") === "all"`, 6000);
                const stillUsage2 = (await h.activeSurfaceLabel()) === SURFACE_LABEL.usage;
                await shot("usage-back");
                rec(
                    "12. Escape from an opened item goes back to its project, then to All usage, staying on Usage",
                    inItem === true && itemScope !== ARC_SCOPE && itemScope !== "all" && backToProject === true && stillUsage && backToAll === true && stillUsage2,
                    JSON.stringify({ inItem, itemScope, backToProject, stillUsage, backToAll, stillUsage2 })
                );
                await key(h, "Escape", "Escape", 27);
                let home = false;
                for (let waited = 0; waited < 4000 && !home; waited += 250) {
                    home = (await h.activeSurfaceLabel()) === SURFACE_LABEL.cockpit;
                    if (!home) await polishNap(250);
                }
                rec("13. Escape on All usage, where there is nothing to go back to, still leaves for the Cockpit", home === true, `surface=${await h.activeSurfaceLabel()}`);
            } catch (e) {
                rec("scenario aborted", false, String(e?.stack ?? e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`kael-keys teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("clear the page's hooks", () =>
                h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (c?.__kkOrig) { c.wshRpcCall = c.__kkOrig; delete c.__kkOrig; }
                    if (window.__kkProbe) { window.removeEventListener("keydown", window.__kkProbe, true); delete window.__kkProbe; }
                    delete window.__kkPrompts;
                    delete window.__kkSeen;
                    document.activeElement?.blur?.();
                })()`)
            );
            await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride"));
            await step("put the stored keys back", async () => {
                for (const [k, v] of Object.entries(ctx.prev ?? {})) {
                    await h.ev(restoreLocalStorage(k, v ?? null));
                }
            });
            if (ctx.project) {
                // deleteproject leaves the channel createproject made, so that goes too
                await step("remove the project", async () => {
                    await h.rpc("deleteproject", { name: ctx.project });
                    const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.dir))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                });
            }
            // removes the fixture roster, reloads onto the live one and removes the temp dir
            await teardownFixtureRun(h, ctx, "kael-keys");
            if (existsSync(ctx.cwd)) console.error(`kael-keys teardown: ${ctx.cwd} is still there`);
        },
    };
    return [scenario];
}
