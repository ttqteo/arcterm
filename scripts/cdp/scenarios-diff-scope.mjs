// diff-scope and diff-compare-refresh: what the Diff surface reads for its subject (an agent, a landed run bounded at its
// own tip, a pinned project), what it says when a read fails or its agent has ended, what a comparison opens on, and the
// page's heap around the Diff's history (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 11;
// the fork's 239572820, 5d94a7493, 7607e68b8, a760de47e, fba263531, b5710027a and 47f904422, and the steps of its
// diff-scope and diff-compare scenarios in scenarios-files-scope.mjs and scenarios-files.mjs).
//
// Our Diff surface is one panel (a source dropdown over Commit | Log tabs) beside a wide diff, not the fork's history
// column with a rail and an overlay, so the fork's overlay and rail steps have nothing to show here: the heap step
// (plan decision 15) reads the page around opening and leaving the Log tab's history instead.
//
// Seeded like `diff-comments`: temp git repos registered as projects and a fixture roster agent whose transcript names the
// repo as its cwd. A real deferred run is landed by a --no-ff merge with a later commit on main after it, so its tip comes
// from the land commit's parents. The refresh and the compare refresh are driven through the app's own modules (the keys
// that call them are Task 16's, kael-keys).
//
// kits is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }). verify.mjs pins the viewport before a scenario; the
// steps pin it again where a view needs a wider panel.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = "verify-diff-scope";
const AGENT = { id: "fx-diff-scope-agent", name: "scope-writer", blockId: "fx-blk-diff-scope" };
const RUN_CHANNEL = "verify-diff-scope-run";
const RUN_COMMIT = "run: pay out the ledger";
const RUN_FILES = ["audit.txt", "run/payout.txt"];
const LAND_MERGE = "land the payout run";
const AFTER_LAND = "after the run landed";
const AFTER_LAND_FILE = "later.txt";
const FILLER_COMMITS = 6;
const EDITED = "ledger.txt";
const FINAL_SHOTS_UICTX = { windowid: "", activetabid: "" };
const HEAP_GROWTH_LIMIT_MB = 5;

const COMPARE_PROJECT = "verify-diff-compare";
const REMOTE_PROJECT = "verify-diff-remote";
const SIDE_BRANCH = "side/settle-refunds";
const SIDE_COMMIT = "settle refunds on the side branch";
const SIDE_LATER = "settle the late refunds";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;

// in-page: an app module's own instance, so an atom a step reads is the one the surface renders. The dev server serves a
// module at one url, which the page already loaded as a resource (or one beside the store).
const MOD_LIB = `
    const mod = async (path) => {
        const names = performance.getEntriesByType("resource").map((e) => e.name.split("?")[0]);
        const hit = names.filter((n) => n.endsWith("/" + path)).pop();
        const base = names.find((n) => n.endsWith("/app/store/jotaiStore.ts"));
        if (hit == null && base == null) throw new Error("no app module url for " + path);
        return import(hit ?? base.replace("app/store/jotaiStore.ts", path));
    };`;
const modEval = (h, body) => h.ev(`(async () => { ${MOD_LIB} ${body} })()`);

export default function (kits) {
    const { rt, files, jarvis } = kits;
    const { git, pickFilesSource, showLogTab, reloadApp, restoreLocalStorage } = files;
    const { waitForProjectInConfig, TREE_RAIL_FIXTURE, waveService } = rt;
    const { teardownFixtureRun } = jarvis;

    const rev = (dir, ref) => git(dir, "rev-parse", ref).toString().trim();
    const until = async (h, expr, ms = 8000) => {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await h.ev(expr).catch(() => false)) return true;
            await sleep(250);
        }
        return false;
    };
    const click = (h, sel) => h.ev(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
    const pin = (h, width = 1600) =>
        h.cdp("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
    const text = (h, sel) => h.ev(`(${q(sel)}?.innerText ?? "").trim()`);
    // a value once it has held across one half-second poll
    const settled = async (h, expr, ms = 8000) => {
        let last = null;
        for (let waited = 0; waited < ms; waited += 500) {
            const now = await h.ev(expr);
            if (now && now === last) return now;
            last = now;
            await sleep(500);
        }
        return last;
    };
    const trigger = (h) => text(h, "[data-source-picker-trigger]");
    const panelText = (h) => h.ev(`(${q("[data-diff-panel]")}?.innerText ?? "")`);
    const historyHas = (subject) =>
        `[...document.querySelectorAll("[data-history-row]")].some((r) => r.textContent.includes(${JSON.stringify(subject)}))`;
    const fileRows = (h) =>
        h.ev(`[...document.querySelectorAll("[data-changed-file-row]")].map((r) => r.getAttribute("data-changed-file-row"))`);
    const selectedRow = (h) =>
        h.ev(`[...document.querySelectorAll("[data-history-row] > button")].filter((b) => b.className.includes("bg-surface-selected")).map((b) => b.textContent).join(" | ")`);

    // the Log tab, once the surface has chosen its own tab for the subject (difflayout.panelTabToApply) and a click would
    // not be overridden
    async function openLog(h) {
        await until(h, `!!${q('[data-panel-tab="log"]')}`, 15000);
        await sleep(1200);
        await showLogTab(h);
        return until(h, `${q('[data-panel-tab="log"]')}?.getAttribute("aria-selected") === "true"`, 5000);
    }
    const pickHistoryRow = async (h, which) => {
        const clicked = await h.ev(`(() => {
            const row = [...document.querySelectorAll("[data-history-row]")].find((r) =>
                ${JSON.stringify(which)} === "worktree" ? r.getAttribute("data-history-row") === "worktree" : r.textContent.includes(${JSON.stringify(which)}));
            const b = row?.querySelector("button");
            if (!b) return false;
            b.click();
            return true;
        })()`);
        if (!clicked) return false;
        await sleep(400);
        return true;
    };

    // the roster file: one agent working in the repo, or none (the agent has ended)
    function writeRoster(ctx, present) {
        writeFileSync(
            TREE_RAIL_FIXTURE,
            JSON.stringify(
                present
                    ? [
                          {
                              id: AGENT.id,
                              name: AGENT.name,
                              project: PROJECT,
                              task: "settle the ledger",
                              state: "working",
                              agent: "claude",
                              model: "opus",
                              blockId: AGENT.blockId,
                              activeMs: 30_000,
                              transcriptPath: ctx.transcriptPath,
                              previousInfo: [{ kind: "message", text: "Edited the ledger." }],
                          },
                      ]
                    : [],
                null,
                2
            )
        );
    }

    async function removeProjects(h, ctx, names, label) {
        for (const name of names) {
            try {
                await h.rpc("deleteproject", { name });
            } catch (e) {
                console.error(`${label} teardown: remove the project ${name} failed: ${e?.message ?? e}`);
            }
        }
        const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        try {
            const channels = (await h.rpc("getchannels", null))?.channels ?? [];
            for (const c of channels.filter((c) => (ctx.dirs ?? []).some((d) => norm(c.projectpath) === norm(d)))) {
                await h.rpc("deletechannel", { channelid: c.oid });
            }
        } catch (e) {
            console.error(`${label} teardown: remove the channels failed: ${e?.message ?? e}`);
        }
    }

    // A real run record held by deferstart, so no lead starts. Its landing tree gets the run's commit, main merges it
    // --no-ff the way a land does, and a later commit lands on main; the record then reads done and landed at that merge,
    // with sealed evidence so the run sheet draws its diff link. endcommit stays unset: the tip must come from the land
    // commit's parents. Fills `ctx.run` as it goes, so teardown removes whatever was made before a failure.
    async function seedLandedRun(h, ctx) {
        const dir = ctx.dir;
        const run = ctx.run;
        const wslist = await h.rpc("workspacelist", null);
        const ch = await h.rpc("createchannel", { name: RUN_CHANNEL, projectpath: dir });
        ctx.channelId = ch.oid;
        const created = await h.rpc("createrun", {
            channelid: ch.oid,
            workspaceid: wslist[0].workspacedata.oid,
            goal: "verify diff-scope: do nothing, make no file changes, stop immediately",
            runtime: "claude",
            mode: "orchestrator",
            deferstart: true,
        });
        ctx.runId = created.run.id;
        ctx.landPath = created.run.landpath;
        run.base = created.run.basecommit || rev(dir, "HEAD");
        const tree = ctx.landPath;
        if (!tree) throw new Error("createrun made no landing tree");
        mkdirSync(join(tree, "run"), { recursive: true });
        writeFileSync(join(tree, "run", "payout.txt"), "payouts settle here\n");
        writeFileSync(join(tree, "audit.txt"), "audited\n");
        git(tree, "add", ...RUN_FILES);
        git(tree, "commit", "-q", "-m", RUN_COMMIT);
        run.tip = rev(tree, "HEAD");
        git(dir, "merge", "-q", "--no-ff", "-m", LAND_MERGE, run.tip);
        run.merge = rev(dir, "HEAD");
        writeFileSync(join(dir, AFTER_LAND_FILE), "later\n");
        git(dir, "add", AFTER_LAND_FILE);
        git(dir, "commit", "-q", "-m", AFTER_LAND);
        const oref = `run:${ctx.runId}`;
        const evidence = {
            capturedts: Date.now(),
            hash: "",
            files: RUN_FILES.map((path) => ({ path, stat: "A", add: 1, del: 0 })),
            addtotal: 2,
            deltotal: 0,
            runtimems: 0,
            durationms: 0,
        };
        const stored = await waveService(h, "object", "GetObject", [oref]);
        await waveService(
            h,
            "object",
            "UpdateObject",
            [{ ...stored, otype: "run", status: "done", report: "", evidence, land: { state: "landed", commit: run.merge } }, false],
            FINAL_SHOTS_UICTX
        );
    }

    // ---- diff-scope ------------------------------------------------------------------------------------------------

    const diffScope = {
        name: "diff-scope",
        surface: "files",
        async arrange(h) {
            const base = mkdtempSync(join(tmpdir(), "verify-diff-scope-"));
            const dir = join(base, "repo");
            const ctx = { cwd: base, dir, dirs: [dir], project: null, run: {}, wroteFixture: false };
            try {
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, EDITED), "ledger v1\n");
                writeFileSync(join(dir, "notes.txt"), "notes\n");
                git(dir, "init", "-q", "--initial-branch=main");
                git(dir, "add", ".");
                git(dir, "commit", "-q", "-m", "seed the ledger");
                for (let i = 0; i < FILLER_COMMITS; i++) {
                    writeFileSync(join(dir, "notes.txt"), `notes\nfiller ${i}\n`);
                    git(dir, "commit", "-q", "-am", `filler commit ${i}`);
                }
                // the project and the agent first: the landed run is seeded after them, so a failure there leaves the
                // earlier steps their fixture
                ctx.transcriptPath = join(base, "session.jsonl");
                writeFileSync(
                    ctx.transcriptPath,
                    JSON.stringify({ type: "user", cwd: dir, message: { role: "user", content: "settle the ledger" } }) + "\n"
                );
                await h.rpc("createproject", { name: PROJECT, path: dir });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);
                try {
                    await seedLandedRun(h, ctx);
                } catch (e) {
                    ctx.runError = String(e?.message ?? e);
                }
                // an uncommitted edit, so the working tree has a row to keep on screen
                writeFileSync(join(dir, EDITED), "ledger v1\nledger v2, edited\n");
                mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
                writeRoster(ctx, true);
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
            try {
                await pin(h);
                await sleep(400);

                // 1. an agent as the source: its session has no start commit yet, so the panel says what it measures from
                const pickedAgent = await pickFilesSource(h, AGENT.name, PROJECT);
                const logOn = pickedAgent && (await openLog(h));
                const onRow = logOn && (await until(h, historyHas("Since session start") + " || " + historyHas("Uncommitted changes"), 15000));
                const wtPicked = onRow && (await pickHistoryRow(h, "worktree"));
                const agentCaption = wtPicked ? await settled(h, `(${panelText0()}).match(/measured from [^\\n]*/)?.[0] ?? ""`) : "";
                const names = await trigger(h);
                await h.shot("cdp-shots/diff-scope-agent.png");
                rec(
                    "1. the agent as the source: the source button names it, and a session with no start yet is measured from HEAD, says so",
                    pickedAgent && logOn && names.includes(AGENT.name) && /no session start yet/.test(agentCaption),
                    JSON.stringify({ pickedAgent, logOn, onRow, names, agentCaption })
                );

                // 2-3. the landed run, opened from its sheet over a commit picked on the project
                if (ctx.runError) {
                    rec("2-3. the landed run fixture", false, ctx.runError);
                } else {
                    const onProject = await pickFilesSource(h, PROJECT, PROJECT);
                    await openLog(h);
                    const projectRows = onProject && (await until(h, historyHas("filler commit 3"), 15000));
                    const picked = projectRows && (await pickHistoryRow(h, "filler commit 3"));
                    const pickedRow = picked ? await settled(h, `${SELECTED_JS}`) : "";
                    const opened = await openRunFromSheet(h, ctx.runId);
                    const onRun = opened && (await until(h, `${SELECTED_JS}.includes("Run changes")`, 20000));
                    await sleep(600);
                    const caption = onRun ? await settled(h, `(${panelText0()}).match(/measured from run base [^\\n]*/)?.[0] ?? ""`) : "";
                    const listed = onRun ? await settled(h, `JSON.stringify([...document.querySelectorAll("[data-changed-file-row]")].map((r) => r.getAttribute("data-changed-file-row")).sort())`) : "";
                    const commitListed = await h.ev(historyHas(RUN_COMMIT));
                    const laterListed = await h.ev(historyHas(AFTER_LAND));
                    const label = await trigger(h);
                    await h.shot("cdp-shots/diff-scope-run-bounded.png");
                    const want = `measured from run base ${ctx.run.base.slice(0, 7)} to its landed tip ${ctx.run.tip.slice(0, 7)}`;
                    rec(
                        "2. a landed run opens on the checkout's repo root, bounded at its own tip: the caption names base and tip, the list holds only the run's files, and the commit landed after it is not counted",
                        opened && onRun && caption.includes(want) && listed === JSON.stringify([...RUN_FILES].sort()) && label.startsWith("run "),
                        JSON.stringify({ opened, onRun, caption, want, listed, label })
                    );
                    rec(
                        "3. a run link selects Run changes: the commit picked on the project gives way to the run's own row, and its history starts at the run's tip",
                        pickedRow.includes("filler commit 3") && onRun && commitListed && !laterListed,
                        JSON.stringify({ pickedRow, onRun, commitListed, laterListed })
                    );

                    // 3b. Review on the run's row reads base..tip as its list does: the run's files, not the commit landed after
                    // it or the checkout's uncommitted edit (it read base against the working tree before)
                    const reviewOn = onRun && (await click(h, '[data-diff-mode-option="review"]'));
                    const sections = reviewOn && (await until(h, `document.querySelectorAll("[data-review-file]").length > 0`, 15000));
                    const reviewed = sections
                        ? await settled(h, `JSON.stringify([...document.querySelectorAll("[data-review-file]")].map((r) => r.getAttribute("data-review-file")).sort())`)
                        : "";
                    await h.shot("cdp-shots/diff-scope-run-review.png");
                    await click(h, '[data-diff-mode-option="file"]');
                    rec(
                        "3b. Review on a landed run's row lists only the run's files (base..tip), not the commit landed after it or the checkout's uncommitted edit",
                        reviewOn && sections && reviewed === JSON.stringify([...RUN_FILES].sort()),
                        JSON.stringify({ reviewOn, sections, reviewed, want: [...RUN_FILES].sort() })
                    );
                }

                // 4. a card's Diff chip scopes to its agent, over a project pinned on the Diff
                const pinned = await pickFilesSource(h, PROJECT, PROJECT);
                await h.goto("cockpit");
                const chip = await until(h, `!!${q('button[title="Review changes in Diff"]')}`, 20000);
                const chipClicked = chip && (await click(h, 'button[title="Review changes in Diff"]'));
                const onDiff = chipClicked && (await until(h, `!!${q("[data-source-picker-trigger]")}`, 15000));
                const chipLabel = onDiff ? await settled(h, `(${q("[data-source-picker-trigger]")}?.innerText ?? "").trim()`) : "";
                await h.shot("cdp-shots/diff-scope-card-chip.png");
                rec(
                    "4. the Cockpit card's Diff chip opens the Diff scoped to its agent, not the project that was pinned there",
                    pinned && chip && onDiff && chipLabel.includes(AGENT.name),
                    JSON.stringify({ pinned, chip, chipClicked, onDiff, chipLabel })
                );

                // 5. a history read that fails over a good change list keeps the working tree on screen
                steps.push(...(await historyFailureStep(h, ctx)));

                // 6. a refresh that fails keeps the last read and says so
                steps.push(...(await refreshFailureStep(h, ctx)));

                // 7. an agent that has left the roster: the surface says so and points at its folder
                steps.push(...(await endedAgentStep(h, ctx)));

                // 8. the page's heap around the Diff's history (decision 15)
                steps.push(...(await heapStep(h, ctx)));
            } catch (e) {
                rec("scenario aborted", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            await refuseRpc(h, "", false).catch(() => {});
            // cancels the run, deletes its channel and landing tree, removes the fixture roster, reloads onto the live roster
            // and removes the temp dir; the projects go after it, since their channels share the run's directory and the
            // run's cancel needs its own channel
            await teardownFixtureRun(h, ctx, "diff-scope");
            await removeProjects(h, ctx, ctx.project ? [PROJECT] : [], "diff-scope");
        },
    };

    // the selected history row's text, and the panel's text, as in-page expressions
    const SELECTED_JS = `[...document.querySelectorAll("[data-history-row] > button")].filter((b) => b.className.includes("bg-surface-selected")).map((b) => b.textContent).join(" | ")`;
    function panelText0() {
        return `(document.querySelector("[data-diff-panel]")?.innerText ?? "")`;
    }

    // opens the run's sheet the way a finished run is reached and follows its diff link, which calls openRunDiff
    async function openRunFromSheet(h, runId) {
        await h.goto("jarvis");
        if (!(await until(h, `typeof window.__openAddress === "function"`, 8000))) return false;
        await h.ev(`window.__openAddress(${JSON.stringify(`run:${runId}`)})`);
        const link = `[...document.querySelectorAll("[data-evidence-block] button")].find((b) => /open the repository diff/.test(b.textContent || ""))`;
        if (!(await until(h, `!!(${link})`, 15000))) return false;
        await h.ev(`${link}.click()`);
        return until(h, `!!${q("[data-source-picker-trigger]")} && (${q("[data-source-picker-trigger]")}?.innerText ?? "").startsWith("run ")`, 20000);
    }

    async function historyFailureStep(h, ctx) {
        const out = [];
        const rec = (step, ok, detail) => out.push({ step, ok, detail });
        try {
            await pin(h);
            // the history read alone fails (a ref to a missing object breaks the change list's reads too, so the failure is
            // put in at the page's RPC client): the change list of the working tree answers
            await pickFilesSource(h, AGENT.name, PROJECT);
            await refuseRpc(h, "githistory", true);
            const onProject = await pickFilesSource(h, PROJECT, PROJECT);
            await openLog(h);
            const failed = onProject && (await until(h, `!!${q("[data-git-failure-column]")}`, 20000));
            const wholeBody = await h.ev(`!!${q("[data-git-failure]")}`);
            const wtRow = await h.ev(`!!${q('[data-history-row="worktree"]')}`);
            const listKept = await until(h, `!!${q(rowSel(EDITED))}`, 10000);
            const diffKept = await until(h, `!!${q("[data-diff-pane]")}`, 10000);
            await h.shot("cdp-shots/diff-scope-history-failure.png");
            await refuseRpc(h, "githistory", false);
            const retried = failed && (await click(h, "[data-git-failure-column-retry]"));
            const recovered = retried && (await until(h, `!${q("[data-git-failure-column]")} && ${historyHas("filler commit 3")}`, 20000));
            rec(
                "5. a history read that fails keeps the working tree on screen: the failure takes the commit list's place with Retry, the working-tree row, the change list and the diff stay, and Retry reads the history again",
                failed && !wholeBody && wtRow && listKept && diffKept && recovered,
                JSON.stringify({ onProject, failed, wholeBody, wtRow, listKept, diffKept, recovered })
            );
        } catch (e) {
            rec("5. history failure", false, String(e?.message ?? e));
        } finally {
            await refuseRpc(h, "githistory", false).catch(() => {});
        }
        return out;
    }

    // The page's RPC client refuses one command while this is on: the failure a read can meet (a timeout, a dropped
    // socket) put in directly. Step 6b breaks the repository itself (a corrupt .git/index), which fails the read the same way.
    const refuseRpc = (h, command, on) =>
        h.ev(
            on
                ? `(() => { const c = window.TabRpcClient; if (!c.__rfOrig) { c.__rfOrig = c.wshRpcCall;
                    c.wshRpcCall = function (cmd, ...a) { return cmd === ${JSON.stringify(command)} ? Promise.reject(new Error("git timed out")) : c.__rfOrig.call(this, cmd, ...a); }; } })()`
                : `(() => { const c = window.TabRpcClient; if (c.__rfOrig) { c.wshRpcCall = c.__rfOrig; delete c.__rfOrig; } })()`
        );

    async function refreshFailureStep(h, ctx) {
        const out = [];
        const rec = (step, ok, detail) => out.push({ step, ok, detail });
        const refuse = (on) => refuseRpc(h, "gitchanges", on);
        try {
            await pin(h);
            await pickFilesSource(h, PROJECT, PROJECT);
            await openLog(h);
            const onRow = (await until(h, `!!${q('[data-history-row="worktree"]')}`, 15000)) && (await pickHistoryRow(h, "worktree"));
            const hasFile = onRow && (await until(h, `!!${q(rowSel(EDITED))}`, 10000));
            await refuse(true);
            await modEval(h, `const m = await mod("app/view/agents/filesstore.ts"); await m.reloadChanges(${JSON.stringify(ctx.dir)});`);
            const notice = await until(h, `!!${q("[data-refresh-failed]")}`, 10000);
            const noticeText = notice ? await text(h, "[data-refresh-failed]") : "";
            const stays = (await h.ev(`!!${q('[data-history-row="worktree"]')}`)) && (await h.ev(`!!${q(rowSel(EDITED))}`));
            await h.shot("cdp-shots/diff-scope-refresh-failed.png");
            await refuse(false);
            await modEval(h, `const m = await mod("app/view/agents/filesstore.ts"); await m.reloadChanges(${JSON.stringify(ctx.dir)});`);
            const cleared = await until(h, `!${q("[data-refresh-failed]")}`, 10000);
            rec(
                "6. a refresh that fails keeps the last read and says so (the working-tree row and its list stay), and the next good read takes the notice away",
                hasFile && notice && /Couldn’t refresh/.test(noticeText) && stays && cleared,
                JSON.stringify({ hasFile, notice, noticeText, stays, cleared })
            );

            // 6b. the repository's own index corrupt: git status fails ("index file corrupt") while rev-parse still finds a work
            // tree, so the refresh is a failed read with the same notice, not "not a repository"; the index put back clears it
            const indexPath = join(ctx.dir, ".git", "index");
            const goodIndex = readFileSync(indexPath);
            let corrupt = {};
            try {
                writeFileSync(indexPath, "this is not an index file, not even close to one");
                await modEval(h, `const m = await mod("app/view/agents/filesstore.ts"); await m.reloadChanges(${JSON.stringify(ctx.dir)});`);
                const cNotice = await until(h, `!!${q("[data-refresh-failed]")}`, 10000);
                corrupt = {
                    notice: cNotice,
                    text: cNotice ? await text(h, "[data-refresh-failed]") : "",
                    notARepo: await h.ev(`/not a (git )?repository/i.test(document.body.innerText)`),
                    stays: await h.ev(`!!${q(rowSel(EDITED))}`),
                };
                await h.shot("cdp-shots/diff-scope-corrupt-index.png");
            } finally {
                writeFileSync(indexPath, goodIndex);
            }
            await modEval(h, `const m = await mod("app/view/agents/filesstore.ts"); await m.reloadChanges(${JSON.stringify(ctx.dir)});`);
            corrupt.cleared = await until(h, `!${q("[data-refresh-failed]")}`, 10000);
            rec(
                "6b. a corrupt .git/index reads as a failed refresh (Couldn’t refresh, the last read kept), not as not a repository, and putting the index back clears it",
                corrupt.notice === true && /Couldn’t refresh/.test(corrupt.text) && corrupt.notARepo === false && corrupt.stays === true && corrupt.cleared === true,
                JSON.stringify(corrupt)
            );
        } catch (e) {
            rec("6. refresh failure", false, String(e?.message ?? e));
        } finally {
            await refuse(false).catch(() => {});
        }
        return out;
    }

    async function endedAgentStep(h, ctx) {
        const out = [];
        const rec = (step, ok, detail) => out.push({ step, ok, detail });
        try {
            await pin(h);
            const onAgent = await pickFilesSource(h, AGENT.name, PROJECT);
            await until(h, `(${q("[data-source-picker-trigger]")}?.innerText ?? "").includes(${JSON.stringify(AGENT.name)})`, 10000);
            // the agent leaves: the roster is read again in place, with nobody in it
            writeRoster(ctx, false);
            await h.ev(`window.__reloadDevMockRoster?.()`);
            const ended = await until(h, `!!${q("[data-subject-ended]")}`, 15000);
            const message = ended ? await text(h, "[data-subject-ended]") : "";
            await h.shot("cdp-shots/diff-scope-ended-agent.png");
            const opened = ended && (await h.ev(`(() => { const b = [...document.querySelectorAll("[data-subject-ended] button")].find((x) => /Open its folder/.test(x.textContent)); b?.click(); return !!b; })()`));
            const onFolder = opened && (await until(h, `(${q("[data-source-picker-trigger]")}?.innerText ?? "").includes(${JSON.stringify(PROJECT)}) && !${q("[data-subject-ended]")}`, 15000));
            rec(
                "7. an agent that has left the roster: the surface says it has ended and where its changes are, and Open its folder re-scopes to that project",
                onAgent && ended && /This agent has ended/.test(message) && message.includes(ctx.dir.split(/[\\/]/).pop()) && onFolder,
                JSON.stringify({ onAgent, ended, message: message.slice(0, 200), opened, onFolder })
            );
        } catch (e) {
            rec("7. ended agent", false, String(e?.message ?? e));
        } finally {
            writeRoster(ctx, true);
            await h.ev(`window.__reloadDevMockRoster?.()`).catch(() => {});
        }
        return out;
    }

    // Decision 15 of the plan: the Diff keeps a history in module-level stores while it is mounted. The page's JS heap is read
    // after a forced collection before the Diff is opened, while its Log tab is open on a loaded history, and after leaving
    // it. A first visit loads the Diff's lazy code (Monaco), which stays resident by design, so the surface is visited once
    // first and the three numbers are of the warm page.
    async function heapStep(h, ctx) {
        const out = [];
        const rec = (step, ok, detail) => out.push({ step, ok, detail });
        const heapMb = async () => {
            await h.cdp("HeapProfiler.collectGarbage");
            await sleep(300);
            await h.cdp("HeapProfiler.collectGarbage");
            const u = await h.cdp("Runtime.getHeapUsage");
            return Math.round((u.usedSize / 1048576) * 10) / 10;
        };
        try {
            await pin(h);
            // the warm-up visit
            await pickFilesSource(h, PROJECT, PROJECT);
            await openLog(h);
            await until(h, historyHas("filler commit 3"), 15000);
            await h.goto("cockpit");
            await sleep(1500);
            const before = await heapMb();
            await h.goto("files");
            await pickFilesSource(h, PROJECT, PROJECT);
            const logged = await openLog(h);
            const loaded = logged && (await until(h, historyHas("filler commit 3"), 15000));
            await sleep(1000);
            const during = await heapMb();
            await h.shot("cdp-shots/diff-scope-heap-open.png");
            await h.goto("cockpit");
            await sleep(1500);
            const after = await heapMb();
            rec(
                `8. the page's heap around the Diff's history: ${before} MB before opening it, ${during} MB with the Log history loaded, ${after} MB after leaving it; it must not keep more than ${HEAP_GROWTH_LIMIT_MB} MB`,
                loaded && after - before <= HEAP_GROWTH_LIMIT_MB,
                JSON.stringify({ before, during, after, growthMb: Math.round((after - before) * 10) / 10, limitMb: HEAP_GROWTH_LIMIT_MB, loaded })
            );
        } catch (e) {
            rec("8. heap", false, String(e?.message ?? e));
        }
        return out;
    }

    // ---- diff-compare-refresh --------------------------------------------------------------------------------------

    const diffCompareRefresh = {
        name: "diff-compare-refresh",
        surface: "files",
        async arrange(h) {
            const base = mkdtempSync(join(tmpdir(), "verify-diff-compare-"));
            const dir = join(base, "repo");
            const originDir = join(base, "origin.git");
            const cloneDir = join(base, "clone");
            const ctx = { cwd: base, dir, cloneDir, dirs: [dir, cloneDir], projects: [], wroteFixture: false };
            try {
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, "ledger.txt"), "ledger v1\n");
                git(dir, "init", "-q", "--initial-branch=main");
                git(dir, "add", ".");
                git(dir, "commit", "-q", "-m", "seed the ledger");
                // main is checked out and is the default branch, so the pair must come from the other local branch
                git(dir, "branch", SIDE_BRANCH);
                git(dir, "switch", "-q", SIDE_BRANCH);
                writeFileSync(join(dir, "refunds.txt"), "refunds settle here\n");
                git(dir, "add", ".");
                git(dir, "commit", "-q", "-m", SIDE_COMMIT);
                git(dir, "switch", "-q", "main");
                // a clone of a bare origin, so one repository has a remote and the other does not
                git(base, "init", "-q", "--bare", "--initial-branch=main", originDir);
                git(dir, "push", "-q", originDir, "main");
                git(base, "clone", "-q", originDir, cloneDir);
                await h.rpc("createproject", { name: COMPARE_PROJECT, path: dir });
                ctx.projects.push(COMPARE_PROJECT);
                await h.rpc("createproject", { name: REMOTE_PROJECT, path: cloneDir });
                ctx.projects.push(REMOTE_PROJECT);
                await waitForProjectInConfig(h, COMPARE_PROJECT);
                await waitForProjectInConfig(h, REMOTE_PROJECT);
                // no fixture agent: the sources are the two projects. The page reloads onto a clean surface.
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
                return [{ step: "0. the repos and the projects", ok: false, detail: ctx.arrangeError }];
            }
            try {
                await pin(h);
                await sleep(400);
                const picked = await pickFilesSource(h, COMPARE_PROJECT, COMPARE_PROJECT);
                await openLog(h);
                await until(h, `!!${q("[data-sync-counts]")}`, 15000);
                // the branch list and its remote answer come with the first read of the repository
                await sleep(1500);
                const fetchOnNoRemote = await h.ev(`!!${q('[data-sync="fetch"]')}`);

                // 1. compare opens on the default pair: on main, head is the other local branch, not main against main
                await click(h, "[data-compare-button]");
                const comparing = await until(h, `!!${q("[data-compare-bar]")} && !!${q("[data-compare-column]")}`, 15000);
                // the picker opens for editing, so the pair is its two fields' values; closed, it is the chip's text
                const pair = comparing
                    ? await settled(
                          h,
                          `([...document.querySelectorAll("[data-compare-bar] input")].map((i) => i.value).join(" … ") || (${q("[data-ref-pair]")}?.innerText ?? ""))`
                      )
                    : "";
                const sideListed = comparing && (await until(h, `[...document.querySelectorAll("[data-compare-commit]")].some((b) => b.textContent.includes(${JSON.stringify(SIDE_COMMIT)}))`, 15000));
                await h.shot("cdp-shots/diff-compare-default-pair.png");
                rec(
                    "1. compare opens on the default pair: with main checked out, the head is the most recent other local branch, and its commit is listed",
                    picked && comparing && pair.includes("main") && pair.includes(SIDE_BRANCH) && sideListed,
                    JSON.stringify({ picked, comparing, pair: pair.slice(0, 120), sideListed })
                );

                // 2. refresh re-reads the pair on screen after a commit made under it
                const sideTip = rev(ctx.dir, SIDE_BRANCH);
                const tree = rev(ctx.dir, `${SIDE_BRANCH}^{tree}`);
                const later = git(ctx.dir, "commit-tree", tree, "-p", sideTip, "-m", SIDE_LATER).toString().trim();
                git(ctx.dir, "update-ref", `refs/heads/${SIDE_BRANCH}`, later);
                const before = await h.ev(`document.querySelectorAll("[data-compare-commit]").length`);
                await modEval(h, `const m = await mod("app/view/agents/comparestore.ts"); await m.refreshCompare(${JSON.stringify(ctx.dir)});`);
                const reread = await until(h, `[...document.querySelectorAll("[data-compare-commit]")].some((b) => b.textContent.includes(${JSON.stringify(SIDE_LATER)}))`, 15000);
                const after = await h.ev(`document.querySelectorAll("[data-compare-commit]").length`);
                await h.shot("cdp-shots/diff-compare-refreshed.png");
                rec(
                    "2. the refresh re-reads the pair on screen: a commit made on the head branch since shows in the comparison",
                    comparing && reread && after === before + 1,
                    JSON.stringify({ before, after, reread })
                );

                // 3. the ref picker's suggestions close when its field loses focus
                if (await h.ev(`!!${q("[data-ref-pair]")}`)) await click(h, "[data-ref-pair]");
                const editing = await until(h, `!!${q("[data-compare-bar] input")}`, 5000);
                // Final's dev app window is often not the foreground one, where Chromium never fires
                // focus events; emulate a focused page, and refocus so the field's onFocus runs.
                await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
                await h.ev(`document.activeElement?.blur()`);
                await h.ev(`${q("[data-compare-bar] input")}?.focus()`);
                const suggestions = await until(h, `!!${q("[data-ref-suggestion]")}`, 5000);
                await h.ev(`document.activeElement?.blur()`);
                const closed = await until(h, `!${q("[data-ref-suggestion]")}`, 5000);
                await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
                await h.shot("cdp-shots/diff-compare-suggestions.png");
                rec(
                    "3. the ref picker's suggestions open with the field and close when it loses focus",
                    editing && suggestions && closed,
                    JSON.stringify({ editing, suggestions, closed })
                );
                await h.ev(`document.activeElement?.blur()`);
                await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });

                // 4. Fetch follows whether the repository has a remote at all
                await pickFilesSource(h, REMOTE_PROJECT, REMOTE_PROJECT);
                await openLog(h);
                await until(h, `!!${q("[data-sync-counts]")}`, 15000);
                await sleep(1500);
                const fetchOnClone = await h.ev(`!!${q('[data-sync="fetch"]')}`);
                await h.shot("cdp-shots/diff-compare-fetch-remote.png");
                await pickFilesSource(h, COMPARE_PROJECT, COMPARE_PROJECT);
                await openLog(h);
                await until(h, `!!${q("[data-sync-counts]")}`, 15000);
                await sleep(1500);
                const fetchOnNoRemoteAgain = await h.ev(`!!${q('[data-sync="fetch"]')}`);
                await h.shot("cdp-shots/diff-compare-fetch-none.png");
                rec(
                    "4. a repository with no remote shows no Fetch, and a clone of one shows it",
                    !fetchOnNoRemote && fetchOnClone && !fetchOnNoRemoteAgain,
                    JSON.stringify({ fetchOnNoRemote, fetchOnClone, fetchOnNoRemoteAgain })
                );
            } catch (e) {
                rec("scenario aborted", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            try {
                await h.ev("document.activeElement?.blur?.()");
            } catch {
                /* the page reloads below */
            }
            await teardownFixtureRun(h, ctx, "diff-compare-refresh");
            await removeProjects(h, ctx, ctx.projects ?? [], "diff-compare-refresh");
            if (existsSync(ctx.cwd)) {
                rmSync(ctx.cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
            }
        },
    };

    return [diffScope, diffCompareRefresh];
}
