// diff-agent-edits: a Claude agent's Diff opens on "Agent's edits", the files it changed itself, rebuilt by the backend
// from its transcript, with a switch to "Since session start" and back (docs/superpowers/specs/2026-11-19-kael-sync-agent-edits-and-fixes-design.md,
// "Diff surface (rewrite for main)"; the fork's scenarios-files-edits.mjs is the fixture's reference).
//
// Seeded like `diff-scope`: a temp git repo registered as a project, and fixture roster agents whose transcripts live in a
// temp dir and name the repo as their cwd. Nothing is written under ~/.claude: the transcript uses only the cases that
// need no backup file on disk (a created file whose file-history record has no backup, a file with no record at all, a
// foreign edit between two of the agent's edits), beside an unrelated edit the agent never made and one Bash call.
//
// kits is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }). verify.mjs pins the viewport before a scenario; the
// steps pin it again, since the panel folds below 1000 CSS px.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentPage, assistantText, focusAgent, toolResult, toolUse, userText, writeTranscript } from "./agent-page-fixtures.mjs";

const NAME = "diff-agent-edits";
const PROJECT = "verify-diff-agent-edits";
const SEED = "seed the edits fixture";
const CREATED = "created.txt";
const APPROX = "edited.txt";
const OUTSIDE = "drifted.txt";
const UNRELATED = "unrelated.txt";
const AGENT_FILES = [CREATED, OUTSIDE, APPROX];
const EDITS_AGENT = { id: "fx-diff-agent-edits", name: "agent-edits-writer", blockId: "fx-blk-diff-agent-edits" };
const QUIET_AGENT = { id: "fx-diff-agent-quiet", name: "agent-edits-quiet", blockId: "fx-blk-diff-agent-quiet" };
const PI_AGENT = { id: "fx-diff-agent-pi", name: "agent-edits-pi", blockId: "fx-blk-diff-agent-pi" };
const LOAD_MS = 20_000;
// the transcript's records sit a minute after the seed commit, so the session-start anchor is that commit whatever the
// clocks' rounding
const AHEAD_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const SUMMARY = "[data-files-range-summary]";
const PANE = "[data-commit-pane]";
const DIFF_PANE = "[data-diff-pane]";
// the diff pane's empty state for a list with no files
const DIFF_EMPTY = `${DIFF_PANE} [data-diff-empty="nofiles"]`;
// the open file's diff has drawn: the editor holds text, not the pane's skeleton bars or an empty editor
const DIFF_DRAWN = `[...document.querySelectorAll(${JSON.stringify(`${DIFF_PANE} .monaco-diff-editor .view-line`)})].some((l) => l.textContent.trim() !== "")`;
// the Diff surface: the panel (switch, caption, rows) and the pane beside it, whose root is the panel's parent
const SURFACE = 'div:has(> [data-diff-panel="open"])';const pressed = (choice) => `${q(`[data-range-choice=${JSON.stringify(choice)}]`)}?.getAttribute("aria-pressed") === "true"`;
const FILE_ROWS = `[...document.querySelectorAll("[data-changed-file-row]")].map((r) => r.getAttribute("data-changed-file-row")).sort()`;
const flagOf = (path) =>
    `document.querySelector(${JSON.stringify(`[data-changed-file-row=${JSON.stringify(path)}]`)})?.getAttribute("data-edit-flag") ?? null`;

// in-page: an app module's own instance, so an atom a step reads is the one the surface renders. The dev server serves a
// module at one url, which the page already loaded as a resource (or one beside the store).
const MOD_LIB = `
    const mod = async (path) => {
        // the url as loaded, ?t= stamp kept: a module Vite hot-updated before the page loaded is served stamped, and
        // importing it bare loads a second instance whose atoms the app never reads
        const names = performance.getEntriesByType("resource").map((e) => e.name);
        const bare = (n) => n.split("?")[0];
        const hit = names.filter((n) => bare(n).endsWith("/" + path)).pop();
        const base = names.map(bare).find((n) => n.endsWith("/app/store/jotaiStore.ts"));
        if (hit == null && base == null) throw new Error("no app module url for " + path);
        return import(hit ?? base.replace("app/store/jotaiStore.ts", path));
    };`;
const modEval = (h, body) => h.ev(`(async () => { ${MOD_LIB} ${body} })()`);

// A Claude agent's Diff opens on Agent's edits, rebuilt from its transcript. A scenario whose fixture agent gets its files
// from writes to disk, not from Edit calls in its transcript, and asserts on the session range's list, sets that agent's
// choice to Since session start first, after the arrange's last reload (the choice lives in a module-level atom, which a
// reload empties), so it keeps testing what it tested before the range existed.
export function chooseSessionRange(h, agentId) {
    return agentPage(
        h,
        `const m = await mod("app/view/agents/diffrangechoice.ts");
         m.setRangeChoice(${JSON.stringify(agentId)}, "session");
         if (m.rangeChoiceFor(${JSON.stringify(agentId)}) !== "session") throw new Error("the range choice did not stick");
         return true;`
    );
}

// The transcript lines of a fixture Claude agent whose files a scenario writes to disk. The Diff surface's Agent's edits,
// the cockpit card, the details rail and the Hub peek all count only the agent's own edits, rebuilt from its Edit and Write
// calls, so a transcript with none lists nothing however many files are dirty. `edits` names each file with its committed
// text (`before`) and the text the scenario then wrote (`after`): an Edit with no file-history record is read against the
// committed text (flagged approximate), and its result is the written one. The records start at `startMs`, by default a
// minute after the seed commit, so the session-start anchor is that commit whatever the clocks' rounding; a scenario that
// places the session start among its own commits passes it.
export function ownEditLines(cwd, edits, { prompt = "make the edits", startMs = Date.now() + AHEAD_MS } = {}) {
    const t0 = startMs;
    let n = 0;
    const at = () => ({ cwd, ts: new Date(t0 + n++ * 1000).toISOString() });
    return [
        userText(prompt, at()),
        ...edits.flatMap((e, i) => [
            toolUse(`tu-own-${i}`, "Edit", { file_path: join(cwd, e.file), old_string: e.before, new_string: e.after }, at()),
            toolResult(`tu-own-${i}`, "ok", at()),
        ]),
    ];
}

export default function (kits) {
    const { rt, files } = kits;
    const { git, pickFilesSource, reloadApp } = files;
    const { waitForProjectInConfig, TREE_RAIL_FIXTURE } = rt;
    const { teardownFixtureRun } = kits.jarvis;

    const until = async (h, expr, ms = 8000) => {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await h.ev(expr).catch(() => false)) return true;
            await sleep(250);
        }
        return false;
    };
    const click = (h, sel) => h.ev(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
    const pin = (h, width = 1600, height = 950) =>
        h.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const text = (h, sel) => h.ev(`(${q(sel)}?.innerText ?? "").trim()`);

    // The What's new picture: the whole Diff surface, so the Agent's edits / Since session start switch, the caption, the
    // flagged rows and the diff beside them are all in it. The window is sized so the surface is exactly 2:1 (as the
    // picture is) and waits for the diff to draw again after the resize; the 1600x950 window comes back for the steps after.
    // The panel folds when the surface is under 1000 px (difflayout.PANEL_FOLD_PX), the page's own width comes out narrower
    // than the one pinned, and the commit pane under the history needs about 235 px for its caption and three rows, which
    // the log's 55% share leaves only in a tall enough surface. So widths are tried from the tightest picture up, the height
    // corrected from what is measured, until the panel is open and every part of the picture sits inside the frame.
    async function agentEditsPicture(h) {
        const WIDTHS = [1160, 1300, 1400, 1500, 1600];
        const SETTLE_MS = 600; // over MonacoDiffViewer's 100ms layout debounce plus a ResizeObserver frame
        const surfaceBox = () =>
            h.ev(`(() => { const r = ${q(SURFACE)}?.getBoundingClientRect(); return r ? { w: r.width, h: r.height, bottom: r.bottom } : null; })()`);
        const seenNow = () =>
            h.ev(
                `({ panels: [...document.querySelectorAll("[data-diff-panel]")].map((e) => e.getAttribute("data-diff-panel")), width: window.innerWidth, height: window.innerHeight })`
            );
        // which of the switch, the caption and the three rows end inside the frame
        const insideFrame = (bottom) =>
            h.ev(
                `[${q("[data-range-switch]")}, ${q(SUMMARY)}, ...document.querySelectorAll("[data-changed-file-row]")].map((el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().bottom <= ${bottom})`
            );
        try {
            const tried = [];
            for (const width of WIDTHS) {
                await pin(h, width);
                await sleep(SETTLE_MS);
                let box = await surfaceBox();
                if (box == null) {
                    tried.push({ width, folded: await seenNow() });
                    continue;
                }
                // the surface is exactly 2:1 once its height is half its width; the height tracks the window's, so measure
                // and correct until it is
                let height = 950;
                for (let i = 0; i < 4 && box != null && Math.abs(box.w / 2 - box.h) > 2; i++) {
                    height += Math.round(box.w / 2 - box.h);
                    await pin(h, width, height);
                    await sleep(SETTLE_MS);
                    box = await surfaceBox();
                }
                if (box == null) {
                    tried.push({ width, height, gone: await seenNow() });
                    continue;
                }
                const inside = await insideFrame(box.bottom);
                if (inside.length < 2 + AGENT_FILES.length || !inside.every(Boolean)) {
                    tried.push({ width, height, surface: box, inside });
                    continue;
                }
                if (!(await until(h, DIFF_DRAWN, LOAD_MS))) throw new Error(`the diff did not draw at ${width}x${height}`);
                // the window as it stands, to read the picture against
                await h.shot("cdp-shots/diff-agent-edits-picture-window.png");
                const shot = await h.whatsnewShot("agent-edits", { selector: SURFACE, pad: 0 });
                return { ...shot, pinned: { width, height }, surface: box, tried };
            }
            throw new Error(`no window size holds the switch, the caption and the rows in a 2:1 surface: ${JSON.stringify(tried)}`);
        } finally {
            await pin(h).catch((e) => console.error(`${NAME}: put the window back failed: ${e?.message ?? e}`));
            await sleep(SETTLE_MS);
        }
    }

    // the Log tab is where the scope's own row and its commit pane are; an agent's Diff opens on it
    async function onLogTab(h) {
        return until(h, `${q('[data-panel-tab="log"]')}?.getAttribute("aria-selected") === "true"`, LOAD_MS);
    }

    function seedRepo(dir) {
        mkdirSync(dir, { recursive: true });
        git(dir, "init", "-q", "--initial-branch=main");
        writeFileSync(join(dir, APPROX), "one\ntwo\nthree\n");
        writeFileSync(join(dir, OUTSIDE), "alpha\nbeta\ngamma\n");
        writeFileSync(join(dir, UNRELATED), "left alone\n");
        git(dir, "add", ".");
        git(dir, "commit", "-q", "-m", SEED);
    }

    // The agent Writes a new file (a file-history record with no backup: it did not exist), Edits a file with no record
    // (approximate), Edits a file twice where the second old_string no longer matches (changed outside), and runs one Bash
    // call. The working tree then holds those results, a foreign edit to the drifted file and an unrelated edit.
    function seedEditsTranscript(base, dir) {
        const t0 = Date.now() + AHEAD_MS;
        let n = 0;
        const at = () => ({ cwd: dir, ts: new Date(t0 + n++ * 1000).toISOString() });
        const call = (id, name, input) => [toolUse(id, name, input, at()), toolResult(id, "ok", at())];
        const created = "made by the agent\n";
        const lines = [
            userText("Tidy the fixture files.", at()),
            JSON.stringify({
                type: "file-history-delta",
                timestamp: at().ts,
                trackingPath: join(dir, CREATED),
                backup: { backupFileName: null, version: 1 },
            }),
            ...call("tu-write", "Write", { file_path: join(dir, CREATED), content: created }),
            ...call("tu-edit-approx", "Edit", { file_path: join(dir, APPROX), old_string: "two", new_string: "two, by the agent" }),
            ...call("tu-edit-drift-1", "Edit", { file_path: join(dir, OUTSIDE), old_string: "beta", new_string: "beta, by the agent" }),
            // someone else rewrote gamma in between, so this old_string is no longer in the file
            ...call("tu-edit-drift-2", "Edit", {
                file_path: join(dir, OUTSIDE),
                old_string: "GAMMA, by someone else",
                new_string: "gamma, by the agent",
            }),
            ...call("tu-bash", "Bash", { command: "npm test" }),
            assistantText("Done.", at()),
        ];
        writeFileSync(join(dir, CREATED), created);
        writeFileSync(join(dir, APPROX), "one\ntwo, by the agent\nthree\n");
        writeFileSync(join(dir, OUTSIDE), "alpha\nbeta, by the agent\nGAMMA, by someone else\n");
        writeFileSync(join(dir, UNRELATED), "left alone\nedited by the user\n");
        return writeTranscript(join(base, "transcripts"), "edits-session", lines);
    }

    // timestamped records, no Edit or Write call
    function seedQuietTranscript(base, dir, name) {
        const ts = new Date(Date.now() + AHEAD_MS).toISOString();
        return writeTranscript(join(base, "transcripts"), name, [
            userText("What does this repo do?", { cwd: dir, ts }),
            assistantText("It holds three text files.", { cwd: dir, ts }),
        ]);
    }

    const rosterAgent = (a, transcriptPath, extra = {}) => ({
        id: a.id,
        name: a.name,
        project: PROJECT,
        task: "agent edits fixture",
        state: "working",
        agent: "claude",
        model: "claude-opus-5-5",
        blockId: a.blockId,
        activeMs: 60_000,
        transcriptPath,
        ...extra,
    });

    async function removeProject(h) {
        try {
            await h.rpc("deleteproject", { name: PROJECT });
        } catch (e) {
            console.error(`${NAME} teardown: remove the project ${PROJECT} failed: ${e?.message ?? e}`);
        }
    }

    const diffAgentEdits = {
        name: NAME,
        surface: "files",
        async arrange(h) {
            const base = mkdtempSync(join(tmpdir(), "verify-diff-agent-edits-"));
            const dir = join(base, "repo");
            const ctx = { cwd: base, dir, project: null, wroteFixture: false };
            try {
                seedRepo(dir);
                ctx.editsTranscript = seedEditsTranscript(base, dir);
                ctx.quietTranscript = seedQuietTranscript(base, dir, "quiet-session");
                ctx.piTranscript = seedQuietTranscript(base, dir, "pi-session");
                await h.rpc("createproject", { name: PROJECT, path: dir });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);
                mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
                writeFileSync(
                    TREE_RAIL_FIXTURE,
                    JSON.stringify(
                        [
                            rosterAgent(EDITS_AGENT, ctx.editsTranscript),
                            rosterAgent(QUIET_AGENT, ctx.quietTranscript),
                            rosterAgent(PI_AGENT, ctx.piTranscript, { agent: "pi" }),
                        ],
                        null,
                        2
                    )
                );
                ctx.wroteFixture = true;
                await reloadApp(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail: JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the repo, the project and the fixture roster", false, ctx.arrangeError);
                return steps;
            }
            try {
                await pin(h);
                await sleep(400);

                // 1. the agent's Diff opens on its own edits
                const picked = await pickFilesSource(h, EDITS_AGENT.name, PROJECT);
                const listed =
                    picked &&
                    (await until(h, `${pressed("edits")} && ${FILE_ROWS}.length === ${AGENT_FILES.length}`, LOAD_MS));
                const logOn = listed && (await onLogTab(h));
                const paneUp = logOn && (await until(h, `!!${q(PANE)} && !!${q(SUMMARY)}`, LOAD_MS));
                // the open file's diff has drawn, so neither the shot nor the picture catches the pane's skeleton
                const diffDrawn = paneUp && (await until(h, DIFF_DRAWN, LOAD_MS));
                const rows = await h.ev(FILE_ROWS);
                const flags = { [CREATED]: await h.ev(flagOf(CREATED)), [APPROX]: await h.ev(flagOf(APPROX)), [OUTSIDE]: await h.ev(flagOf(OUTSIDE)) };
                const summary = await text(h, SUMMARY);
                const pane = paneUp ? await text(h, PANE) : "";
                const switchState = await h.ev(
                    `[...document.querySelectorAll("[data-range-choice]")].map((b) => ({ choice: b.dataset.rangeChoice, pressed: b.getAttribute("aria-pressed"), text: b.textContent.trim() }))`
                );
                await h.shot("cdp-shots/diff-agent-edits-open.png");
                let picture = null;
                try {
                    // the What's new picture: the panel with the agent's flagged files, and the diff beside it
                    picture = diffDrawn ? await agentEditsPicture(h) : { error: "the diff never drew" };
                } catch (e) {
                    picture = { error: String(e?.message ?? e) };
                }
                rec(
                    "1. an agent's Diff opens on Agent's edits: the edits button is pressed, the list is exactly its three files (not the unrelated one), the approximate and the outside rows are flagged, the caption says 3 files and 1 Bash call, the commit pane's label reads Agent's edits, the open file's diff has drawn, and the What's new picture was taken of it",
                    listed &&
                        paneUp &&
                        diffDrawn &&
                        picture?.error == null &&
                        switchState.find((b) => b.choice === "edits")?.pressed === "true" &&
                        switchState.find((b) => b.choice === "session")?.pressed === "false" &&
                        JSON.stringify(rows) === JSON.stringify([...AGENT_FILES].sort()) &&
                        flags[CREATED] == null &&
                        flags[APPROX] === "approximate" &&
                        flags[OUTSIDE] === "outside" &&
                        /^3 files by this agent\b/.test(summary) &&
                        /\b1 Bash call\b/.test(summary) &&
                        // innerText of the label is drawn uppercase by its CSS
                        /agent's edits/i.test(pane) &&
                        !/working tree/i.test(pane),
                    { picked, listed, logOn, paneUp, diffDrawn, switchState, rows, flags, summary, pane: pane.slice(0, 200), picture }
                );

                // 2. Since session start lists what the working tree changed, the unrelated edit too
                const toSession = await click(h, '[data-range-choice="session"]');
                const widened =
                    toSession && (await until(h, `${pressed("session")} && ${FILE_ROWS}.includes(${JSON.stringify(UNRELATED)})`, LOAD_MS));
                const sessionRows = await h.ev(FILE_ROWS);
                await h.shot("cdp-shots/diff-agent-edits-session.png");
                rec(
                    "2. Since session start lists the unrelated edit too, beside the agent's three files",
                    widened && AGENT_FILES.every((p) => sessionRows.includes(p)),
                    { toSession, widened, sessionRows }
                );

                // 3. the choice outlives the surface: after a switch away and back Since session start is still pressed,
                // and a scope built again from the agent (a card's Diff chip, the rail) reads it; then Agent's edits is the
                // way back to exactly the agent's files
                await h.goto("cockpit");
                await sleep(800);
                await h.goto("files");
                const stillSession = await until(h, `${pressed("session")}`, LOAD_MS);
                const rebuilt = await modEval(
                    h,
                    `const m = await mod("app/view/agents/agentdiffnav.ts");
                     return m.agentDiffScope(${JSON.stringify(EDITS_AGENT.id)}, ${JSON.stringify(EDITS_AGENT.name)}, "claude").range.kind;`
                );
                await h.shot("cdp-shots/diff-agent-edits-kept.png");
                const toEdits = stillSession && (await click(h, '[data-range-choice="edits"]'));
                const back =
                    toEdits && (await until(h, `${pressed("edits")} && JSON.stringify(${FILE_ROWS}) === ${JSON.stringify(JSON.stringify([...AGENT_FILES].sort()))}`, LOAD_MS));
                const backRows = await h.ev(FILE_ROWS);
                await h.shot("cdp-shots/diff-agent-edits-back.png");
                rec(
                    "3. after a switch to another surface and back, Since session start is still pressed (and a rebuilt scope reads it); Agent's edits then lists exactly the agent's three files again",
                    stillSession && rebuilt === "session" && back && JSON.stringify(backRows) === JSON.stringify([...AGENT_FILES].sort()),
                    { stillSession, rebuilt, toEdits, back, backRows }
                );

                // 4. an agent whose transcript has no Edit or Write call: the switch is there, the list is empty, and the
                // caption is the backend's reason (or "no edits to show")
                const reply = await h.rpc("gitagentedits", { cwd: ctx.dir, transcriptpath: ctx.quietTranscript });
                const wantCaption = reply?.reason || "no edits to show";
                const quietPicked = await pickFilesSource(h, QUIET_AGENT.name, PROJECT);
                const quiet =
                    quietPicked &&
                    (await until(h, `${pressed("edits")} && (${q(SUMMARY)}?.textContent ?? "").trim() === ${JSON.stringify(wantCaption)}`, LOAD_MS));
                // the diff pane says the agent has made no edits, with the read's reason under it, not the commit's words
                const emptyPane = quiet && (await until(h, `/No edits by this agent yet/.test(${q(DIFF_EMPTY)}?.innerText ?? "")`, LOAD_MS));
                // the list stays empty past a poll's worth of settling, never falling back to the working tree
                await sleep(1000);
                const quietRows = await h.ev(FILE_ROWS);
                const quietCaption = await text(h, SUMMARY);
                const quietSwitch = await h.ev(`!!${q("[data-range-switch]")}`);
                const emptyText = await text(h, DIFF_PANE);
                await h.shot("cdp-shots/diff-agent-edits-nothing.png");
                rec(
                    "4. a second agent with no Edit or Write call opens on Agent's edits with the switch shown, an empty file list, the no-edits caption, and a diff pane that reads \"No edits by this agent yet\" with the read's reason (never \"This commit changes no files\")",
                    quiet &&
                        emptyPane &&
                        quietSwitch &&
                        quietRows.length === 0 &&
                        !reply?.base &&
                        emptyText.includes("No edits by this agent yet") &&
                        (!reply?.reason || emptyText.includes(reply.reason)) &&
                        !/This commit changes no files/.test(emptyText),
                    { quietPicked, reply, quietCaption, wantCaption, quietRows, quietSwitch, emptyPane, emptyText: emptyText.slice(0, 200) }
                );

                // 5. a pi agent has no file-history backups: no switch, and its range is Since session start
                const piPicked = await pickFilesSource(h, PI_AGENT.name, PROJECT);
                const piLoaded = piPicked && (await until(h, `!${q("[data-range-switch]")} && !!${q(SUMMARY)}`, LOAD_MS));
                const piSwitch = await h.ev(`!!${q("[data-range-switch]")} || !!${q("[data-range-choice]")}`);
                const piCaption = await text(h, SUMMARY);
                await h.shot("cdp-shots/diff-agent-edits-pi.png");
                rec(
                    "5. a pi agent shows no switch and measures from the session start, not by its edits",
                    piLoaded && !piSwitch && /measured from/.test(piCaption) && !/by this agent/.test(piCaption),
                    { piPicked, piLoaded, piSwitch, piCaption }
                );

                // 6-8. the views that count an agent's changes read its own edits too: the card, the details rail and the Hub
                // peek each show the three files, not the four the working tree holds. The line counts are B..H's, read
                // here from git
                const editsReply = await h.rpc("gitagentedits", { cwd: ctx.dir, transcriptpath: ctx.editsTranscript });
                const numstat = editsReply?.base
                    ? git(ctx.dir, "diff", "--numstat", editsReply.base, editsReply.end)
                          .toString()
                          .trim()
                          .split("\n")
                          .filter(Boolean)
                          .map((l) => l.split("\t").map(Number))
                    : [];
                const wantLines = `+${numstat.reduce((n, l) => n + l[0], 0)}−${numstat.reduce((n, l) => n + l[1], 0)}`;
                const wantRows = JSON.stringify([...AGENT_FILES].sort());

                // 6. the cockpit card's diff chip counts 3 files and their lines
                const PILL = `[data-cockpit-surface] [data-agent-id="${EDITS_AGENT.id}"] [data-diff-files]`;
                await h.goto("cockpit");
                const pillCounted = await until(h, `${q(PILL)}?.getAttribute("data-diff-files") === "${AGENT_FILES.length}"`, LOAD_MS);
                const pill = await h.ev(
                    `({ files: ${q(PILL)}?.getAttribute("data-diff-files") ?? null, text: (${q(PILL)}?.innerText ?? "").replace(/\\s+/g, "") })`
                );
                await h.shot("cdp-shots/diff-agent-edits-card.png");
                rec(
                    "6. the edits agent's cockpit card counts its three files and their B..H lines, not the four of the working tree",
                    pillCounted && pill.files === String(AGENT_FILES.length) && pill.text === wantLines,
                    { pillCounted, pill, wantLines, numstat }
                );

                // 7. the Agent details rail lists exactly the three files
                ctx.prevRail = await agentPage(
                    h,
                    `const R = await mod("app/view/agents/railstore.ts");
                     const prev = globalStore.get(R.railVisibleAtom);
                     globalStore.set(R.railVisibleAtom, true);
                     return prev;`
                );
                await focusAgent(h, EDITS_AGENT.id);
                const RAIL_ROWS = `[...document.querySelectorAll('aside[aria-label="Agent details"] [data-rail-file-row]')].map((b) => b.getAttribute("data-rail-file-row")).sort()`;
                const railListed = await until(h, `JSON.stringify(${RAIL_ROWS}) === ${JSON.stringify(wantRows)}`, LOAD_MS);
                // a settled beat: the unrelated file must not join the list when the poll or a late read lands
                await sleep(1000);
                const railRows = await h.ev(RAIL_ROWS);
                await h.shot("cdp-shots/diff-agent-edits-rail.png");
                rec(
                    "7. the edits agent's details rail lists exactly its three files, not the unrelated one",
                    railListed && JSON.stringify(railRows) === wantRows,
                    { railListed, railRows }
                );

                // 8. the Hub peek counts the same three files
                await h.goto("jarvis");
                const hook = await until(h, `typeof window.__peekAddress === "function"`, 8000);
                const peeked = hook && (await h.ev(`window.__peekAddress(${JSON.stringify(`agent:${EDITS_AGENT.id}`)}).then(() => true)`));
                const PEEK_BODY = `[data-pet-peek-item="agent"][data-pet-peek-status="ready"] [data-pet-peek-body]`;
                const PEEK_ROWS = `[...(${q(PEEK_BODY)}?.querySelectorAll("[data-peek-file]") ?? [])].map((r) => r.getAttribute("data-peek-file")).sort()`;
                const peekListed = peeked && (await until(h, `JSON.stringify(${PEEK_ROWS}) === ${JSON.stringify(wantRows)}`, LOAD_MS));
                await sleep(800);
                const peekRows = await h.ev(PEEK_ROWS);
                const peekText = await h.ev(`(${q(PEEK_BODY)}?.innerText ?? "").replace(/\\s+/g, " ")`);
                await h.shot("cdp-shots/diff-agent-edits-peek.png");
                await h.ev(`document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click()`);
                rec(
                    "8. the Hub peek of the edits agent counts exactly its three files",
                    peekListed &&
                        JSON.stringify(peekRows) === wantRows &&
                        new RegExp(`\\b${AGENT_FILES.length} files\\b`).test(peekText),
                    { hook, peeked, peekListed, peekRows, peekText: peekText.slice(0, 200) }
                );
            } catch (e) {
                rec("scenario aborted", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            await h.cdp("Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
            // step 7 opens the details rail; the choice is stored, so it goes back before the reload
            if (ctx.prevRail !== undefined) {
                await agentPage(
                    h,
                    `const R = await mod("app/view/agents/railstore.ts");
                     globalStore.set(R.railVisibleAtom, ${JSON.stringify(ctx.prevRail)});
                     return true;`
                ).catch((e) => console.error(`${NAME} teardown: restore the rail failed: ${e?.message ?? e}`));
            }
            // removes the fixture roster, reloads onto the live roster and removes the temp dir; the project goes after it
            await teardownFixtureRun(h, ctx, NAME);
            await removeProject(h);
        },
    };

    return [diffAgentEdits];
}
