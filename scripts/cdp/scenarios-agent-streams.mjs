// agent-streams-offsurface: the shell owns the transcript streams and the subagent / background-task tracking, so the
// Agent surface fills its details rail's live Tools, Subagents and Background tasks without the Cockpit ever opening, and
// a Cockpit visit and return ends nothing (ported from the fork's commit 4ae707e98, onto our rail:
// frontend/app/view/agents/agentdetailsrail.tsx. Ours has no shell-task chip or "Tools used" section: the rail's
// Background tasks and Subagents come from backgroundTasksByIdAtom / subagentsByIdAtom, and the Status section's Tools
// chips from the agent's live transcript entries, which only an open stream fills). One fixture agent, a real tab with no
// controller, whose transcript is a temp file holding a few tool calls, a running run_in_background Bash call and a
// background subagent spawn with its own file. Nothing runs and nothing is written into ~/.claude/projects.
// kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor).

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    agentPage,
    assistantText,
    focusAgent,
    restoreRoster,
    setRoster,
    tabFixtures,
    toolResult,
    toolUse,
    userText,
    writeSubagent,
    writeTranscript,
} from "./agent-page-fixtures.mjs";

const NAME = "agent-streams-offsurface";
const AGENT_NAME = "streams parent";
const SESSION = "parent";
const NARRATION = "Streams fixture: reading the config before the edit.";
const SHELL_TASK_ID = "bstreams01";
const SHELL_TASK_LABEL = "dev server";
const SUB = {
    spawnId: "toolu_streams_explore",
    childId: "stexplore",
    type: "Explore",
    prompt: "survey the config for stale keys",
    read: "config.ts",
};
const WAIT_MS = 15_000;

const RAIL = `document.querySelector('aside[aria-label="Agent details"]')`;
const COCKPIT_CARD = (id) => `document.querySelector('[data-cockpit-surface] [data-agent-id="${id}"]')`;

// what the rail shows: its Background tasks rows, its Subagents section text, and its Tools chip verbs (a chip is the verb,
// then its count as "×n"); and whether the Cockpit is on screen
const seen = `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const rail = ${RAIL};
    const tools = [...(rail?.querySelectorAll("span.rounded-sm") ?? [])]
        .filter((chip) => flat(chip.lastElementChild).startsWith("×"))
        .map((chip) => flat(chip.firstElementChild));
    return {
        rail: rail != null,
        cockpit: document.querySelector("[data-cockpit-surface]") != null,
        bg: [...(rail?.querySelectorAll('[data-rail-section="bgtasks"] [data-bg-task]') ?? [])].map(flat),
        subs: flat(rail?.querySelector('[data-rail-section="subagents"]')),
        tools,
    };
})()`;
const hasBg = (s) => s.bg.length === 1 && s.bg[0].includes(SHELL_TASK_LABEL);
const hasSub = (s) => s.subs.includes(SUB.type);
const hasTools = (s, verbs) => verbs.every((v) => s.tools.includes(v));

const toolCall = (id, name, input, result, o) => [toolUse(id, name, input, o), toolResult(id, result, o)];

function writeFixture(dir) {
    const o = { cwd: dir };
    const parentPath = writeTranscript(dir, SESSION, [
        userText("Start the dev server and tidy the config.", o),
        assistantText(NARRATION, o),
        ...toolCall("toolu_read1", "Read", { file_path: join(dir, SUB.read) }, "export const a = 1;", o),
        ...toolCall("toolu_edit1", "Edit", { file_path: join(dir, SUB.read) }, "edited", o),
        toolUse(
            "toolu_bg1",
            "Bash",
            { command: "npm run dev", description: SHELL_TASK_LABEL, run_in_background: true },
            o
        ),
        toolResult("toolu_bg1", `Command running in background with ID: ${SHELL_TASK_ID}.`, {
            toolUseResult: { backgroundTaskId: SHELL_TASK_ID },
            ...o,
        }),
        toolUse(
            SUB.spawnId,
            "Agent",
            {
                subagent_type: SUB.type,
                description: "survey the config",
                prompt: SUB.prompt,
                run_in_background: true,
            },
            o
        ),
        toolResult(SUB.spawnId, "Async agent launched successfully", {
            toolUseResult: { isAsync: true, status: "async_launched", agentId: SUB.childId },
            ...o,
        }),
    ]);
    // its last record is a tool result that is not a handback's, so the child reads as still working
    writeSubagent(dir, SESSION, SUB.childId, [
        userText(SUB.prompt, o),
        toolUse(`toolu_${SUB.childId}_read`, "Read", { file_path: join(dir, SUB.read) }, o),
        toolResult(`toolu_${SUB.childId}_read`, "export const a = 1;", o),
    ]);
    return parentPath;
}

export default function (kit) {
    const { polishWaitFor } = kit;
    const { makeTab, closeTabs } = tabFixtures(kit);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-agent-streams-")) };
                // a throw past this point still returns ctx, so teardown undoes whatever was already set
                try {
                    ctx.path = writeFixture(ctx.dir);
                    // the page lands on the Cockpit: leave it first, so the agent below exists only while the Cockpit
                    // is unmounted and any stream it gets is the shell's
                    await h.goto("agent");
                    const { tabId, blockId } = await makeTab(h, ctx, { label: AGENT_NAME });
                    ctx.id = tabId;
                    ctx.prevRail = await agentPage(
                        h,
                        `const R = await mod("app/view/agents/railstore.ts");
                        const S = await mod("app/element/railsections.ts");
                        const prev = { visible: globalStore.get(R.railVisibleAtom), sections: globalStore.get(S.railSectionOpenAtom) };
                        globalStore.set(R.railVisibleAtom, true);
                        globalStore.set(S.railSectionOpenAtom, { ...prev.sections, subagents: true, bgtasks: true, status: true });
                        return prev;`
                    );
                    await setRoster(h, [
                        {
                            id: tabId,
                            name: AGENT_NAME,
                            project: "fx-streams",
                            task: "",
                            state: "working",
                            agent: "claude",
                            model: "opus",
                            activeMs: 60_000,
                            blockId,
                            transcriptPath: ctx.path,
                        },
                    ]);
                    await focusAgent(h, tabId);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                if (ctx.arrangeError != null) {
                    rec(`${NAME}: arrange`, false, ctx.arrangeError);
                    return steps;
                }
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    const until = (cond) => polishWaitFor(h, `((s) => ${cond})(${seen})`, WAIT_MS);
                    const append = (...lines) => appendFileSync(ctx.path, lines.join("\n") + "\n");
                    const o = { cwd: ctx.dir };

                    await until(
                        `s.bg.length > 0 && s.subs.includes(${JSON.stringify(SUB.type)}) && ["read", "edited", "ran"].every((v) => s.tools.includes(v))`
                    );
                    const first = await h.ev(seen);
                    await h.shot("cdp-shots/agent-streams-offsurface-1-no-cockpit.png");
                    rec(
                        "1. with no Cockpit visit, the rail's Background tasks lists the dev server, its Subagents the Explore agent, and its Tools the transcript's calls",
                        first.rail && !first.cockpit && hasBg(first) && hasSub(first) && hasTools(first, ["read", "edited", "ran"]),
                        JSON.stringify(first)
                    );

                    append(...toolCall("toolu_grep1", "Grep", { pattern: SHELL_TASK_LABEL }, "config.ts:1", o));
                    await until(`s.tools.includes("grep")`);
                    const second = await h.ev(seen);
                    await h.shot("cdp-shots/agent-streams-offsurface-2-appended.png");
                    rec(
                        "2. a line appended to the transcript reaches the rail's Tools on the Agent surface",
                        hasTools(second, ["grep"]) && hasBg(second) && hasSub(second),
                        JSON.stringify(second)
                    );

                    await h.goto("cockpit");
                    const carded = await polishWaitFor(
                        h,
                        `(${COCKPIT_CARD(ctx.id)}?.textContent ?? "").includes(${JSON.stringify(NARRATION)})`,
                        WAIT_MS
                    );
                    await h.shot("cdp-shots/agent-streams-offsurface-3-cockpit-card.png");
                    await h.goto("agent");
                    await focusAgent(h, ctx.id);
                    append(...toolCall("toolu_glob1", "Glob", { pattern: "**/*.ts" }, "config.ts", o));
                    await until(`s.bg.length > 0 && s.subs.includes(${JSON.stringify(SUB.type)}) && s.tools.includes("glob")`);
                    const back = await h.ev(seen);
                    await h.shot("cdp-shots/agent-streams-offsurface-4-back.png");
                    rec(
                        "3. after a Cockpit visit (its card showed the transcript) and back, the rail's Background tasks, Subagents and Tools stay and the stream still delivers",
                        carded && !back.cockpit && hasBg(back) && hasSub(back) && hasTools(back, ["read", "edited", "ran", "grep", "glob"]),
                        JSON.stringify({ carded, ...back })
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
                await step("restore the roster", () => restoreRoster(h));
                await step("drop the focus", () =>
                    agentPage(h, `globalStore.set(agentsModel().focusIdAtom, undefined); return true;`)
                );
                await step("close the fixture tab", () => closeTabs(h, ctx));
                if (ctx.prevRail !== undefined) {
                    await step("restore the rail", () =>
                        agentPage(
                            h,
                            `const R = await mod("app/view/agents/railstore.ts");
                            const S = await mod("app/element/railsections.ts");
                            globalStore.set(R.railVisibleAtom, ${JSON.stringify(ctx.prevRail?.visible)});
                            globalStore.set(S.railSectionOpenAtom, ${JSON.stringify(ctx.prevRail?.sections ?? {})});
                            return true;`
                        )
                    );
                }
                await step("remove the fixture transcripts", () => rmSync(ctx.dir, { recursive: true, force: true }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
