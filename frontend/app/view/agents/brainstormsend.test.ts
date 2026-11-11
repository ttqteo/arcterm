// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsViewModel } from "./agents";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import {
    approveBlocker,
    brainstormLine,
    RUN_STARTING,
    runPrefill,
    type BrainstormAction,
    type BrainstormFile,
} from "./brainstormmodel";
import { approveAndOpenRun, openRunLauncher, sendBrainstorm } from "./brainstormsend";
import {
    attachBrainstorm,
    brainstormsAtom,
    getBrainstorm,
    shownBrainstormFile,
    updateBrainstorm,
    type BrainstormState,
} from "./brainstormstore";
import { brainstormAnswers, brainstormSentAtom, SENT_STORAGE_KEY } from "./chatbrainstormstore";
import type { LauncherKind } from "./launcher";
import { launcherPrefillAtom } from "./launcherstore";

// the loaded transcript comes from the Chat window's cache (railtranscript.tsx); a test passes its own entries through
// the io, so the pane's module graph is not loaded for it
vi.mock("./railtranscript", () => ({ cachedTranscriptEntries: () => null }));

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

// an open question with two answers, as the agent leaves it for the user
const ASKING: BrainstormFile = {
    ...FILE,
    done: false,
    question: {
        n: 2,
        text: "How should alerts reach on-call?",
        part: "page",
        options: [
            { label: "Page directly", detail: "", pick: true },
            { label: "Via the channel", detail: "" },
        ],
    },
};

// calls holds every call in order, so a stop can be seen to come before the prompt; entries is the loaded transcript
function fakeIO(fail = false, stopFails = false, armFails = false, entries: AgentEntry[] | null = null) {
    const sent: [string, string][] = [];
    const armed: [string, string, string][] = [];
    const woken: [string, string][] = [];
    const calls: string[] = [];
    return {
        sent,
        woken,
        calls,
        armed,
        sleepAfterRun: async (tabId: string, runId: string, path: string) => {
            if (armFails) {
                throw new Error("tab is not a live agent session");
            }
            calls.push(`arm ${tabId}`);
            armed.push([tabId, runId, path]);
        },
        wake: async (tabId: string, text: string) => {
            if (fail) {
                throw new Error("the session file is gone");
            }
            calls.push(`wake ${tabId}`);
            woken.push([tabId, text]);
        },
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
        entries: () => entries,
    };
}

// a localStorage that holds what is written, as the webview's does
function mockLocalStorage(): Record<string, string> {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
    };
    return store;
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
    globalStore.set(brainstormSentAtom, {});
    delete (globalThis as any).localStorage;
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

    it("wakes a sleeping agent with the line instead of typing into its stopped terminal", async () => {
        const io = fakeIO();
        const asleep = { ...AGENT, sleeping: { since: 1, freedBytes: 0 } };
        await sendBrainstorm(asleep, { kind: "answer", text: "yes" }, io, 1000);
        expect(io.sent).toEqual([]);
        expect(io.woken).toEqual([["a1", "yes"]]);
        expect(getBrainstorm(AGENT.id)?.sent).toEqual({ at: 1000, modifiedMs: 500, kind: "answer" });
    });

    it("a wake that fails throws with its reason and records nothing", async () => {
        const asleep = { ...AGENT, sleeping: { since: 1, freedBytes: 0 } };
        await expect(sendBrainstorm(asleep, { kind: "guess" }, fakeIO(true))).rejects.toThrow(
            "Couldn't wake lag-alerts: the session file is gone"
        );
        expect(getBrainstorm(AGENT.id)?.sent).toBeNull();
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

describe("recording an answer for Chat", () => {
    const user = (text: string): AgentEntry => ({ kind: "user", text });
    const asking = () => updateBrainstorm(AGENT.id, (s) => ({ ...s, file: ASKING }));

    it("records the question, the exact line sent and how many same-text messages were there", async () => {
        asking();
        const store = mockLocalStorage();
        const io = fakeIO(false, false, false, [user("hello"), user("Page directly"), user("later")]);
        await sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, io, 1000);
        expect(io.sent).toEqual([["blk-1", "Page directly"]]);
        expect(brainstormAnswers(AGENT.id)).toEqual([
            { topic: "lag", n: 2, part: "What on-call sees", text: "Page directly", sentAt: 1000, seen: 1 },
        ]);
        // and it is kept for a reload
        expect(JSON.parse(store[SENT_STORAGE_KEY])).toEqual({ [AGENT.id]: brainstormAnswers(AGENT.id) });
    });

    it("records the line as sent: a multi-line answer is one line", async () => {
        asking();
        await sendBrainstorm(AGENT, { kind: "answer", text: "  one\n\ntwo " }, fakeIO(), 1000);
        expect(brainstormAnswers(AGENT.id)[0]).toMatchObject({ n: 2, text: "one two", seen: 0 });
    });

    it("counts none already there when no transcript is loaded", async () => {
        asking();
        const io = fakeIO(false, false, false, null);
        await sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, io, 1000);
        expect(brainstormAnswers(AGENT.id)[0].seen).toBe(0);
    });

    it("records an answer that wakes a sleeping agent", async () => {
        asking();
        const asleep = { ...AGENT, sleeping: { since: 1, freedBytes: 0 } };
        await sendBrainstorm(asleep, { kind: "answer", text: "Via the channel" }, fakeIO(), 1000);
        expect(brainstormAnswers(AGENT.id)).toHaveLength(1);
    });

    it("records an answer sent during the judge's wait, against the question the judge is weighing", async () => {
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: WAIT }));
        await sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, fakeIO(), 1000);
        expect(brainstormAnswers(AGENT.id)).toMatchObject([{ n: 2, text: "Page directly" }]);
    });

    it("records a second answer to the same question once only: the first already hides it", async () => {
        asking();
        await sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, fakeIO(), 1000);
        await sendBrainstorm(AGENT, { kind: "answer", text: "Via the channel" }, fakeIO(), 2000);
        expect(brainstormAnswers(AGENT.id).map((r) => r.text)).toEqual(["Page directly"]);
    });

    it("records nothing for an answer typed with no question open", async () => {
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: FILE }));
        await sendBrainstorm(AGENT, { kind: "answer", text: "why not the clarify artifact?" }, fakeIO(), 1000);
        expect(brainstormAnswers(AGENT.id)).toEqual([]);
    });

    it.each([
        { kind: "guess" },
        { kind: "skip" },
        { kind: "confirm", part: "page" },
        { kind: "builder-answer", text: "Only report." },
        { kind: "check" },
        { kind: "approved" },
    ] as BrainstormAction[])("records nothing for a $kind line", async (action) => {
        asking();
        await sendBrainstorm(AGENT, action, fakeIO(), 1000);
        expect(brainstormAnswers(AGENT.id)).toEqual([]);
    });

    it("records nothing when the line cannot be sent", async () => {
        asking();
        await expect(sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, fakeIO(true))).rejects.toThrow();
        expect(brainstormAnswers(AGENT.id)).toEqual([]);
    });

    it("still sends and records for the session when storage throws", async () => {
        asking();
        (globalThis as any).localStorage = {
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
        };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const io = fakeIO();
        await sendBrainstorm(AGENT, { kind: "answer", text: "Page directly" }, io, 1000);
        expect(io.sent).toHaveLength(1);
        expect(brainstormAnswers(AGENT.id)).toHaveLength(1);
        warn.mockRestore();
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
            wake: async () => {},
            stopJudge: async () => {},
            sleepAfterRun: async () => {},
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
        globalStore.get(launcherPrefillAtom)!.handback!.started("run-42");
        await flush();
        expect(io.sent).toEqual([["blk-1", "brainstorm: run run-42"]]);
    });

    it("arms the agent's sleep once, before the run's id is sent", async () => {
        const io = fakeIO();
        openRunLauncher(fakeModel(), AGENT, STATE, io);
        globalStore.get(launcherPrefillAtom)!.handback!.started("run-42");
        await flush();
        expect(io.armed).toEqual([["a1", "run-42", STATE.path]]);
        expect(io.calls).toEqual(["arm a1", "prompt blk-1"]);
    });

    it("still sends the run's id when the arm fails", async () => {
        const io = fakeIO(false, false, true);
        openRunLauncher(fakeModel(), AGENT, STATE, io);
        globalStore.get(launcherPrefillAtom)!.handback!.started("run-42");
        await flush();
        expect(io.armed).toEqual([]);
        expect(io.sent).toEqual([["blk-1", "brainstorm: run run-42"]]);
    });

    // the duplicate run: CreateRun took ~20s, the approved line settled when the agent's turn ended, and Approve lit
    // again before the agent had heard the run's id
    it("keeps Approve off from the launcher's Start until the agent records the run", async () => {
        const io = fakeIO();
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: FILE }));
        openRunLauncher(fakeModel(), AGENT, getBrainstorm(AGENT.id)!, io);
        const handback = globalStore.get(launcherPrefillAtom)!.handback!;
        const approve = () => {
            const s = getBrainstorm(AGENT.id)!;
            return approveBlocker(shownBrainstormFile(s)!, s.starting);
        };
        expect(approve()).toBeNull();
        handback.handedOff!();
        expect(approve()).toBe(RUN_STARTING);
        // CreateRun returned: the pane shows the run before the agent writes it down
        handback.started("run-42");
        await flush();
        expect(shownBrainstormFile(getBrainstorm(AGENT.id))?.run).toBe("run-42");
        expect(approve()).toBeNull();
        // the file's own run wins once the agent has written it
        updateBrainstorm(AGENT.id, (s) => ({ ...s, sent: null, file: { ...FILE, run: "run-42" } }));
        expect(shownBrainstormFile(getBrainstorm(AGENT.id))?.run).toBe("run-42");
    });

    it("turns Approve back on when the start fails or is cancelled", () => {
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: FILE }));
        openRunLauncher(fakeModel(), AGENT, getBrainstorm(AGENT.id)!, fakeIO());
        const handback = globalStore.get(launcherPrefillAtom)!.handback!;
        handback.handedOff!();
        expect(getBrainstorm(AGENT.id)!.starting).toEqual({ runId: null });
        handback.stopped!();
        expect(getBrainstorm(AGENT.id)!.starting).toBeNull();
    });

    it("leaves a brainstorm attached in the approved one's place alone", () => {
        updateBrainstorm(AGENT.id, (s) => ({ ...s, file: FILE }));
        openRunLauncher(fakeModel(), AGENT, getBrainstorm(AGENT.id)!, fakeIO());
        const handback = globalStore.get(launcherPrefillAtom)!.handback!;
        attachBrainstorm(AGENT.id, { topic: "other", cwd: "/p" }, 0);
        handback.handedOff!();
        expect(getBrainstorm(AGENT.id)!.starting).toBeNull();
    });
});
