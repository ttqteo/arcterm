// A switch back to an agent shown before leaves its rail's Overview standing (docs/superpowers/specs/
// 2026-11-26-calmer-transitions-design.md; railstore.ts, transcriptusagestore.ts, cachestatusstore.ts, agentmemory.ts).
// Two fixture agents over real tabs (terminal blocks with no controller, so nothing runs in them), each in a throwaway
// git repo whose one changed file its transcript edited (a.txt, b.txt), and a transcript with spend, a model the roster
// does not name (the roster says Sonnet, the transcript Opus 4.1, so a usage that went null would swap the label) and a
// 1-hour cache write just now (so the status line counts down).
// The switch back is watched frame by frame: a requestAnimationFrame loop in the page reads the rail on every frame.
// kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor, polishNap, ahReload).
//
// Steps:
//   1. agent A's first view lists a.txt, its branch, its spend, Opus 4.1 and the cache countdown
//   2. agent B's first view does the same with b.txt
//   3. back to A: no frame draws a skeleton or loses Files changed, the branch, the spend, the model or the countdown;
//      every frame is B's whole rail (the frame before the switch lands) or A's whole rail, and once A's, it stays A's

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "rail-switch-back";
const PROJECT = "verify-rail-switch-back";
const WAIT_MS = 15_000;
const WATCH_MS = 2_000;
const KEYS = ["agent.rail.visible", "agent.rail.tab", "cockpit.rail.sections", "agent.chatmode"];
const AGENTS = [
    { key: "a", name: "switch back A", file: "a.txt" },
    { key: "b", name: "switch back B", file: "b.txt" },
];

const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;

// what one frame of the rail shows of the parts a switch used to blank
const SIG = `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const aside = ${ASIDE};
    const files = aside?.querySelector('[data-rail-section="files"]');
    const session = aside?.querySelector("[data-rail-session]");
    const facts = aside?.querySelector("[data-rail-facts]");
    const state = aside?.querySelector("[data-rail-state]");
    return {
        files: !files ? "gone" : files.querySelector(".animate-pulse") ? "skeleton" : (/\\b[ab]\\.txt\\b/.exec(flat(files))?.[0] ?? "none"),
        sessionSkeleton: !!session?.querySelector(".animate-pulse"),
        facts: flat(facts),
        spend: /\\$[\\d.,]+/.exec(flat(session))?.[0] ?? null,
        cache: /cache (\\d+m|<1m) left/.test(flat(state)),
    };
})()`;

// the repo, its edit and the transcript, for one agent
function fixture(dir, { key, file }) {
    const repo = join(dir, `repo-${key}`);
    mkdirSync(repo, { recursive: true });
    const git = (...args) =>
        execFileSync("git", ["-C", repo, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
    git("init", "-q", "--initial-branch=main");
    writeFileSync(join(repo, file), "one\ntwo\n");
    git("add", ".");
    git("commit", "-qm", "seed");
    writeFileSync(join(repo, file), "one\nTWO\n");
    const ts = new Date().toISOString();
    const rec = (o) => JSON.stringify({ cwd: repo, timestamp: ts, sessionId: `rsb-${key}`, ...o });
    const lines = [
        rec({ type: "user", message: { role: "user", content: [{ type: "text", text: "capitalise line two" }] } }),
        rec({
            type: "assistant",
            requestId: `req-${key}-1`,
            message: {
                id: `msg-${key}-1`,
                role: "assistant",
                model: "claude-opus-4-1",
                content: [
                    { type: "tool_use", id: `e-${key}`, name: "Edit", input: { file_path: join(repo, file), old_string: "two", new_string: "TWO" } },
                ],
                usage: {
                    input_tokens: 40_000,
                    output_tokens: 6_000,
                    cache_read_input_tokens: 0,
                    cache_creation_input_tokens: 20_000,
                    cache_creation: { ephemeral_1h_input_tokens: 20_000 },
                },
            },
        }),
        rec({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `e-${key}`, is_error: false }] } }),
    ];
    const transcript = join(dir, `agent-${key}.jsonl`);
    writeFileSync(transcript, lines.join("\n") + "\n");
    return { repo, transcript };
}

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    const rosterRows = (ctx) =>
        ctx.agents.map((a) => ({
            project: PROJECT,
            task: "",
            agent: "claude",
            // the roster's family, which the rail falls back to while the transcript's usage is not read
            model: "sonnet",
            state: "idle",
            idleSince: Date.now() - 60_000,
            id: a.tab.tabId,
            name: a.name,
            blockId: a.tab.blockId,
            transcriptPath: a.transcript,
            cwd: a.repo,
        }));

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = { prev: {}, dir: mkdtempSync(join(tmpdir(), "verify-rsb-")), agents: [] };
            let at = "reading the keys";
            try {
                for (const k of KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "making the repos";
                for (const a of AGENTS) ctx.agents.push({ ...a, ...fixture(ctx.dir, a) });

                at = "resetting the panel";
                await h.ev(`(() => {
                    localStorage.setItem("agent.rail.visible", "true");
                    for (const k of ["agent.rail.tab", "cockpit.rail.sections", "agent.chatmode"]) localStorage.removeItem(k);
                    return true;
                })()`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tabs";
                for (const a of ctx.agents) {
                    a.tab = await makeTab(h, ctx, { label: a.name, blockMeta: { view: "term", "cmd:cwd": a.repo } });
                }

                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));
                // Terminal, not Chat: the rail's Overview is what this checks, and a Claude agent opens in Chat
                await AC.agentPage(
                    h,
                    `const { setChatMode } = await mod("app/view/agents/chatmodestore.ts");
                    for (const id of ${JSON.stringify(ctx.agents.map((a) => a.tab.tabId))}) setChatMode(id, "terminal");
                    return true;`
                );
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) =>
                steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the two fixture agents and their repos are in place", false, ctx.arrangeError);
                return steps;
            }
            const shot = async (name) => {
                try {
                    await h.shot(`cdp-shots/${NAME}-${name}.png`);
                } catch (e) {
                    console.error(`${NAME}: the shot ${name} failed: ${e?.message ?? e}`);
                }
            };
            const [A, B] = ctx.agents;
            const whole = (s, a) =>
                s.files === a.file && !s.sessionSkeleton && s.spend != null && s.cache && s.facts.includes("main") && s.facts.includes("Opus 4.1");
            const firstView = async (a) => {
                await AC.focusAgent(h, a.tab.tabId);
                const ok = await polishWaitFor(h, `(() => { const s = ${SIG}; return s.files === ${JSON.stringify(a.file)} && s.spend != null && s.cache && s.facts.includes("Opus 4.1"); })()`, WAIT_MS);
                // the reads have landed; one more beat for the last of them to draw
                await polishNap(400);
                return { ok, sig: await h.ev(SIG) };
            };

            // 1 and 2. each agent's first view
            const shown = {};
            for (const [i, a] of [A, B].entries()) {
                const { ok, sig } = await firstView(a);
                shown[a.key] = sig;
                await shot(`${i + 1}-${a.key}`);
                rec(
                    `${i + 1}. ${a.name}'s first view lists ${a.file}, the branch main, its spend, Opus 4.1 (not the roster's Sonnet) and the cache countdown`,
                    ok && whole(sig, a),
                    sig
                );
            }

            // 3. back to A, every frame read
            try {
                await h.ev(`(() => {
                    window.__rsbFrames = [];
                    window.__rsbStop = false;
                    const tick = () => {
                        window.__rsbFrames.push(${SIG});
                        if (!window.__rsbStop) requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                    return true;
                })()`);
                await AC.focusAgent(h, A.tab.tabId);
                await polishNap(WATCH_MS);
                const frames = await h.ev(`(() => { window.__rsbStop = true; return window.__rsbFrames; })()`);
                await shot("3-back-to-a");
                const sameAs = (s, ref) => s.files === ref.files && s.facts === ref.facts && s.spend === ref.spend && s.cache === ref.cache && !s.sessionSkeleton;
                const kinds = frames.map((s) => (sameAs(s, shown.a) ? "A" : sameAs(s, shown.b) ? "B" : "other"));
                const firstA = kinds.indexOf("A");
                const bad = frames.filter((_, i) => kinds[i] === "other" || (firstA >= 0 && i > firstA && kinds[i] !== "A"));
                rec(
                    `3. back to ${A.name}: over ${WATCH_MS} ms no frame draws a skeleton or drops Files changed, the branch, the spend, the model or the cache countdown; each frame is B's whole rail or A's, and A's from the first A frame on`,
                    frames.length > 10 && firstA >= 0 && bad.length === 0,
                    { frames: frames.length, firstA, kinds: kinds.join("").replace(/(.)\1+/g, (m, c) => `${c}×${m.length} `), bad: bad.slice(0, 3) }
                );
            } catch (e) {
                rec("3. back to A, every frame read", false, `the step threw: ${String(e?.message ?? e)}`);
            }
            return steps;
        },

        async teardown(h, ctx) {
            const failures = [];
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    failures.push(`${what}: ${e?.message ?? e}`);
                }
            };
            await step("stop the frame reader", () => h.ev(`(() => { window.__rsbStop = true; delete window.__rsbFrames; return true; })()`));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
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
            // wavesrv's watch on the repos can hold them for a moment after their agents are gone
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
            if (failures.length > 0) throw new Error(failures.join("; "));
        },
    };

    return [scenario];
}
