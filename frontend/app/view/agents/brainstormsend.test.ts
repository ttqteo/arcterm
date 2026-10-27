// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { brainstormLine, runPrefill, type BrainstormAction, type BrainstormFile } from "./brainstormmodel";
import { approveAndOpenRun, openRunLauncher, sendBrainstorm } from "./brainstormsend";
import {
    attachBrainstorm,
    brainstormsAtom,
    getBrainstorm,
    updateBrainstorm,
    type BrainstormState,
} from "./brainstormstore";
import type { LauncherKind } from "./launcher";
import { launcherPrefillAtom } from "./launcherstore";

const AGENT = { id: "a1", name: "lag-alerts", blockId: "blk-1", project: "siem" } as AgentVM;

const FILE: BrainstormFile = {
    v: 1,
    title: "Consumer lag alerts",
    spec: "docs/specs/lag.md",
    canvas: "lag",
    question: null,
    working: null,
    parts: [{ id: "page", title: "What on-call sees", state: "yours", body: "b", boards: ["Page.dc.html"] }],
    history: [],
    done: true,
    check: null,
    run: null,
};

const STATE = {
    topic: "lag",
    path: "/p/.superpowers/brainstorm/lag/brainstorm.json",
    cwd: "/p",
    file: FILE,
} as BrainstormState;

// the judge weighing an approach question: the file works while the question lists its approaches
const WAIT: BrainstormFile = {
    ...FILE,
    done: false,
    working: "The judge is weighing 2 approaches.",
    question: {
        n: 2,
        text: "How should alerts reach on-call?",
        part: "page",
        approaches: [
            { name: "Page directly", description: "", facts: [] },
            { name: "Via the channel", description: "", facts: [] },
        ],
    },
};

// calls holds every call in order, so a stop can be seen to come before the prompt
function fakeIO(fail = false, stopFails = false) {
    const sent: [string, string][] = [];
    const calls: string[] = [];
    return {
        sent,
        calls,
        prompt: async (blockId: string, text: string) => {
            if (fail) {
                throw new Error("boom");
            }
            calls.push(`prompt ${blockId}`);
            sent.push([blockId, text]);
        },
        stopJudge: async (blockId: string) => {
            if (stopFails) {
                throw new Error("no such tab");
            }
            calls.push(`stop ${blockId}`);
        },
    };
}

function fakeModel(): AgentsViewModel {
    return { launcherAtom: atom<LauncherKind | null>(null) } as unknown as AgentsViewModel;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    attachBrainstorm(AGENT.id, { topic: "lag", cwd: "/p" }, 0);
    updateBrainstorm(AGENT.id, (s) => ({ ...s, modifiedMs: 500 }));
});

afterEach(() => {
    globalStore.set(launcherPrefillAtom, null);
    globalStore.set(brainstormsAtom, {});
});

describe("sendBrainstorm", () => {
    const actions: BrainstormAction[] = [
        { kind: "answer", text: "first line\n\tsecond  line" },
        { kind: "guess" },
        { kind: "skip" },
        { kind: "confirm", part: "current" },
        { kind: "confirm-all" },
        { kind: "edit", part: "constraints", text: "No new\nservice." },
        { kind: "keep", part: "constraints" },
        { kind: "restore", part: "constraints" },
        { kind: "keep-all" },
        { kind: "check" },
        { kind: "builder-answer", text: "Only report." },
        { kind: "approved" },
        { kind: "keep-talking" },
        { kind: "run", runId: "r1" },
    ];

    it.each(actions)("sends the $kind line to the agent's block as a prompt", async (action) => {
        const io = fakeIO();
        await sendBrainstorm(AGENT, action, io);
        expect(io.sent).toEqual([["blk-1", brainstormLine(action)]]);
    });

    it("sends a multi-line answer as one line", async () => {
        const io = fakeIO();
        await sendBrainstorm(AGENT, { kind: "answer", text: "  one\n\ntwo\tthree " }, io);
        expect(io.sent).toEqual([["blk-1", "one two three"]]);
    });

    it("records the sent line against the file as it was, an answer as an answer", async () => {
        await sendBrainstorm(AGENT, { kind: "answer", text: "yes" }, fakeIO(), 1000);
        expect(getBrainstorm(AGENT.id)?.sent).toEqual({ at: 1000, modifiedMs: 500, kind: "answer" });
        await sendBrainstorm(AGENT, { kind: "confirm", part: "x" }, fakeIO(), 2000);
        expect(getBrainstorm(AGENT.id)?.sent).toEqual({ at: 2000, modifiedMs: 500, kind: "line" });
        await sendBrainstorm(AGENT, { kind: "check" }, fakeIO(), 3000);
        expect(getBrainstorm(AGENT.id)?.sent).toEqual({ at: 3000, modifiedMs: 500, kind: "check" });
    });

    it("sends a line typed with no question open as the raw text, recorded as an answer", async () => {
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: FILE }));
        const io = fakeIO();
        await sendBrainstorm(AGENT, { kind: "answer", text: "why not use the\nclarify artifact?" }, io, 1000);
        expect(io.sent).toEqual([["blk-1", "why not use the clarify artifact?"]]);
        expect(getBrainstorm(AGENT.id)?.sent).toEqual({ at: 1000, modifiedMs: 500, kind: "answer" });
    });

    it("refuses a second check while the first is underway, sending nothing", async () => {
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: FILE }));
        await sendBrainstorm(AGENT, { kind: "check" }, fakeIO(), 1000);
        expect(getBrainstorm(AGENT.id)?.sent).toEqual({ at: 1000, modifiedMs: 500, kind: "check" });
        const io = fakeIO();
        await expect(sendBrainstorm(AGENT, { kind: "check" }, io, 2000)).rejects.toThrow("still working");
        expect(io.sent).toEqual([]);
        expect(getBrainstorm(AGENT.id)?.sent?.at).toBe(1000);
    });

    it.each([
        { kind: "answer", text: " \n\t " },
        { kind: "edit", part: "x", text: "" },
        { kind: "builder-answer", text: "\n" },
    ] as BrainstormAction[])("a blank $kind throws and sends nothing", async (action) => {
        const io = fakeIO();
        await expect(sendBrainstorm(AGENT, action, io)).rejects.toThrow("Nothing to send");
        expect(io.sent).toEqual([]);
        expect(getBrainstorm(AGENT.id)?.sent).toBeNull();
    });

    it("refuses an agent with no terminal", async () => {
        const io = fakeIO();
        await expect(sendBrainstorm({ ...AGENT, blockId: undefined }, { kind: "guess" }, io)).rejects.toThrow(
            "This agent has no terminal to send to"
        );
        expect(io.sent).toEqual([]);
    });

    it("names the agent when sending fails, and records nothing as sent", async () => {
        await expect(sendBrainstorm(AGENT, { kind: "guess" }, fakeIO(true))).rejects.toThrow(
            "Couldn't send to lag-alerts: boom"
        );
        expect(getBrainstorm(AGENT.id)?.sent).toBeNull();
    });

    describe("during the judge's wait", () => {
        beforeEach(() => updateBrainstorm(AGENT.id, (s) => ({ ...s, file: WAIT })));

        it.each([{ kind: "answer", text: "Page directly" }, { kind: "skip" }] as BrainstormAction[])(
            "a $kind stops the judge before it sends",
            async (action) => {
                const io = fakeIO();
                await sendBrainstorm(AGENT, action, io);
                expect(io.calls).toEqual(["stop blk-1", "prompt blk-1"]);
                expect(io.sent).toEqual([["blk-1", brainstormLine(action)]]);
            }
        );

        it("a confirm leaves the judge running", async () => {
            const io = fakeIO();
            await sendBrainstorm(AGENT, { kind: "confirm", part: "page" }, io);
            expect(io.calls).toEqual(["prompt blk-1"]);
        });

        it("a stop that fails sends nothing, and says the judge could not be stopped", async () => {
            const io = fakeIO(false, true);
            await expect(sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, io)).rejects.toThrow(
                /^Couldn't stop the judge: no such tab$/
            );
            expect(io.sent).toEqual([]);
            expect(getBrainstorm(AGENT.id)?.sent).toBeNull();
        });

        it("a line already pending ends the wait: the next answer does not stop the judge", async () => {
            const io = fakeIO();
            await sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, io, 1000);
            await sendBrainstorm(AGENT, { kind: "answer", text: "Via the channel" }, io, 2000);
            expect(io.calls).toEqual(["stop blk-1", "prompt blk-1", "prompt blk-1"]);
        });
    });

    it.each([
        ["no question", FILE],
        ["working with no approaches", { ...WAIT, question: { ...WAIT.question!, approaches: undefined } }],
        ["approaches but nothing working", { ...WAIT, working: null }],
    ] as [string, BrainstormFile][])("outside the wait (%s) an answer does not stop the judge", async (_, f) => {
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: f }));
        const io = fakeIO();
        await sendBrainstorm(AGENT, { kind: "answer", text: "yes" }, io);
        expect(io.calls).toEqual(["prompt blk-1"]);
    });
});

describe("approveAndOpenRun", () => {
    it("sends brainstorm: approved before it prefills and opens the launcher", async () => {
        const model = fakeModel();
        const seen: unknown[] = [];
        const io = {
            prompt: async (blockId: string, text: string) => {
                seen.push([blockId, text, globalStore.get(launcherPrefillAtom), globalStore.get(model.launcherAtom)]);
            },
            stopJudge: async () => {},
        };
        await approveAndOpenRun(model, AGENT, STATE, io);
        expect(seen).toEqual([["blk-1", "brainstorm: approved", null, null]]);
        expect(globalStore.get(launcherPrefillAtom)).toMatchObject(
            runPrefill(FILE, { projectName: "siem", cwd: "/p" })
        );
        expect(globalStore.get(model.launcherAtom)).toBe("run");
    });

    it("leaves the launcher closed when the line cannot be sent", async () => {
        const model = fakeModel();
        await expect(approveAndOpenRun(model, AGENT, STATE, fakeIO(true))).rejects.toThrow("Couldn't send to");
        expect(globalStore.get(launcherPrefillAtom)).toBeNull();
        expect(globalStore.get(model.launcherAtom)).toBeNull();
    });
});

describe("openRunLauncher", () => {
    it("prefills an orchestrator run for the agent's project, its goal naming the spec and its prototype the first board", () => {
        const model = fakeModel();
        openRunLauncher(model, AGENT, STATE, fakeIO());
        expect(globalStore.get(launcherPrefillAtom)).toMatchObject({
            projectName: "siem",
            shape: "orchestrator",
            goal: "Build Consumer lag alerts as specified in /p/docs/specs/lag.md.",
            prototype: "/p/.superpowers/design/lag/project/Page.dc.html",
        });
    });

    it("opens the launcher on the run half without sending", () => {
        const model = fakeModel();
        const io = fakeIO();
        openRunLauncher(model, AGENT, STATE, io);
        expect(globalStore.get(launcherPrefillAtom)).toMatchObject(
            runPrefill(FILE, { projectName: "siem", cwd: "/p" })
        );
        expect(globalStore.get(model.launcherAtom)).toBe("run");
        expect(io.sent).toEqual([]);
    });

    it("opens nothing for a brainstorm with no file yet", () => {
        const model = fakeModel();
        openRunLauncher(model, AGENT, { ...STATE, file: null }, fakeIO());
        expect(globalStore.get(launcherPrefillAtom)).toBeNull();
        expect(globalStore.get(model.launcherAtom)).toBeNull();
    });

    it("tells the agent the id of the run the launcher starts", async () => {
        const io = fakeIO();
        openRunLauncher(fakeModel(), AGENT, STATE, io);
        globalStore.get(launcherPrefillAtom)!.onStarted!("run-42");
        await flush();
        expect(io.sent).toEqual([["blk-1", "brainstorm: run run-42"]]);
    });
});
