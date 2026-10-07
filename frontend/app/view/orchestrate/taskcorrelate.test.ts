// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsViewModel } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { jumpToAgent } from "../agents/channelsprimitives";
import { openOrPeek } from "../jarvis/openref";
import {
    enterOpensTask,
    openTaskWorker,
    resolveTaskWorker,
    taskWorkerTarget,
    workerActivityText,
    type TaskWorkerView,
} from "./taskcorrelate";

vi.mock("../jarvis/openref", () => ({ openOrPeek: vi.fn(async () => ({ ok: true })) }));
vi.mock("../agents/channelsprimitives", () => ({ jumpToAgent: vi.fn() }));

function agent(id: string): AgentVM {
    return { id, name: id, task: "", state: "working" };
}

function run(runId: string, workerorefs: string[]): Run {
    return {
        oid: runId,
        id: runId,
        version: 1,
        goal: "g",
        status: "executing",
        createdts: 1,
        phases: [{ kind: "execute", state: "running", workerorefs }],
        meta: {},
    } as Run;
}

describe("resolveTaskWorker", () => {
    it("resolves a dispatched task with its tab and agent", () => {
        const view = resolveTaskWorker({ id: "t-0", runid: "r1" }, run("r1", ["tab:t1"]), [agent("t1")]);
        expect(view).toEqual<TaskWorkerView>({ state: "dispatched", tabId: "t1", runId: "r1", agent: agent("t1") });
    });

    it("reports pending for a task with no child run yet", () => {
        const view = resolveTaskWorker({ id: "t-0" }, undefined, [agent("t1")]);
        expect(view.state).toBe("pending");
        expect(view.tabId).toBeUndefined();
    });

    it("reports unavailable when the child run has no worker oref", () => {
        const view = resolveTaskWorker({ id: "t-0", runid: "r1" }, run("r1", []), [agent("t1")]);
        expect(view).toEqual<TaskWorkerView>({ state: "unavailable", runId: "r1" });
    });

    it("reports unavailable when the worker session is closed (no roster row)", () => {
        const view = resolveTaskWorker({ id: "t-0", runid: "r1" }, run("r1", ["tab:gone"]), [agent("t1")]);
        expect(view.state).toBe("unavailable");
        expect(view.runId).toBe("r1");
        expect(view.agent).toBeUndefined();
    });

    it("never resolves a worker for a run that did not load", () => {
        const view = resolveTaskWorker({ id: "t-0", runid: "r_missing" }, undefined, [agent("t1")]);
        expect(view.state).toBe("unavailable");
        expect(view.runId).toBe("r_missing");
    });
});

describe("workerActivityText", () => {
    it("defers to the agent's own activity when a worker session is reachable", () => {
        expect(workerActivityText({ state: "dispatched", tabId: "t1", agent: agent("t1") })).toBeNull();
    });

    it("says the activity is unavailable rather than showing a fabricated idle state", () => {
        expect(workerActivityText({ state: "pending" })).toBe("Not dispatched yet");
        expect(workerActivityText({ state: "unavailable", runId: "r-1" })).toBe("Activity unavailable");
    });
});

// Element stubs rather than jsdom, as in dispatcher.test.ts: the suite runs in vitest's node environment.
function focused(tagName: string): Element {
    return { tagName, closest: () => null } as unknown as Element;
}

describe("enterOpensTask", () => {
    it("opens when focus is on nothing or on the graph itself", () => {
        expect(enterOpensTask(null)).toBe(true);
        expect(enterOpensTask(focused("DIV"))).toBe(true);
    });

    // Enter already activates a focused control: opening the worker too would do two things on one press
    it("leaves Enter to a focused button, link or text field", () => {
        expect(enterOpensTask(focused("BUTTON"))).toBe(false);
        expect(enterOpensTask(focused("A"))).toBe(false);
        expect(enterOpensTask(focused("INPUT"))).toBe(false);
        expect(enterOpensTask(focused("TEXTAREA"))).toBe(false);
    });
});

describe("taskWorkerTarget", () => {
    it("is the agent tab when dispatched, the child run when unavailable, and nothing when pending", () => {
        expect(taskWorkerTarget({ state: "dispatched", tabId: "t1", runId: "r1" })).toEqual({
            kind: "agent",
            tabId: "t1",
        });
        expect(taskWorkerTarget({ state: "unavailable", runId: "r1" })).toEqual({ kind: "run", runId: "r1" });
        expect(taskWorkerTarget({ state: "pending" })).toBeNull();
    });
});

describe("openTaskWorker", () => {
    const model = {} as AgentsViewModel;
    const gesture = (ctrlKey: boolean) => ({ ctrlKey, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    beforeEach(() => setPlatform("win32"));
    afterEach(() => {
        setPlatform("darwin");
        vi.mocked(openOrPeek).mockClear();
        vi.mocked(jumpToAgent).mockClear();
    });

    it("jumps to a dispatched worker's agent on a plain click", () => {
        openTaskWorker({ state: "dispatched", tabId: "t1" }, model, gesture(false));
        expect(jumpToAgent).toHaveBeenCalledWith(model, "t1");
        expect(openOrPeek).not.toHaveBeenCalled();
    });

    it("hands a Ctrl+click on a dispatched worker to openOrPeek, which peeks its agent", () => {
        const e = gesture(true);
        openTaskWorker({ state: "dispatched", tabId: "t1" }, model, e);
        expect(jumpToAgent).not.toHaveBeenCalled();
        expect(openOrPeek).toHaveBeenCalledWith(model, { kind: "agent", tabId: "t1" }, e);
    });

    it("routes an unavailable worker's child run through openOrPeek with the click", () => {
        const e = gesture(false);
        openTaskWorker({ state: "unavailable", runId: "r1" }, model, e);
        expect(openOrPeek).toHaveBeenCalledWith(model, { kind: "run", runId: "r1" }, e);
    });

    it("does nothing for a pending worker", () => {
        openTaskWorker({ state: "pending" }, model, gesture(true));
        expect(openOrPeek).not.toHaveBeenCalled();
        expect(jumpToAgent).not.toHaveBeenCalled();
    });
});
